# -*- coding: utf-8 -*-
import sys
import time
import schedule
from datetime import datetime
from .config import logger, DB_CONFIG, NTFY_URL, INTERVALO_VERIFICACAO
from .banco import get_connection, carregar_configs
from .admissao import verificar_admissao_nova
from .parecer import verificar_parecer_pendente
from .prescricao import verificar_prescricao_pendente

_ciclo_em_execucao = False  # evita sobreposicao de ciclos


def ciclo_verificacao():
    """Executa todos os modulos em sequencia."""
    global _ciclo_em_execucao
    if _ciclo_em_execucao:
        logger.warning('Ciclo anterior ainda em execucao — pulando.')
        return
    _ciclo_em_execucao = True

    logger.info('=' * 50)
    logger.info('Iniciando ciclo de verificacao...')

    try:
        configs = carregar_configs()
        if not configs:
            logger.warning('Nenhuma configuracao ativa')
            return

        verificar_admissao_nova(configs)
        verificar_parecer_pendente(configs)
        verificar_prescricao_pendente(configs)

        logger.info('Ciclo concluido')
    except Exception as e:
        logger.error('Erro no ciclo: %s', e)
    finally:
        _ciclo_em_execucao = False


def limpeza_diaria():
    """Expira prescricoes do dia anterior e remove registros muito antigos."""
    conn = get_connection()
    if not conn:
        return
    try:
        cursor = conn.cursor()
        hoje = datetime.now().strftime('%Y-%m-%d')
        cursor.execute("""
            UPDATE notificacoes_log SET status = 'expirado'
            WHERE tipo_evento = 'prescricao_pendente'
              AND status IN ('pendente', 'notificado')
              AND chave_evento NOT LIKE %s
        """, ('%%{}%%'.format(hoje),))
        expirados = cursor.rowcount
        cursor.execute("""
            DELETE FROM notificacoes_log
            WHERE status IN ('resolvido', 'expirado')
              AND dt_criacao < CURRENT_TIMESTAMP - INTERVAL '30 days'
        """)
        removidos = cursor.rowcount
        conn.commit()
        cursor.close()
        logger.info('[limpeza] Expirados: %s, Removidos: %s', expirados, removidos)
    except Exception as e:
        logger.error('[limpeza] Erro: %s', e)
    finally:
        conn.close()


def main():
    """Ponto de entrada standalone."""
    logger.info('=' * 60)
    logger.info('  NOTIFICADOR ntfy - Hospital Anchieta')
    logger.info('  Intervalo: %s minutos', INTERVALO_VERIFICACAO)
    logger.info('  ntfy base: %s', NTFY_URL)
    logger.info('  Topicos: lidos da tabela notificacoes_destinatarios')
    logger.info('  Banco: %s@%s:%s/%s',
                DB_CONFIG['user'], DB_CONFIG['host'],
                DB_CONFIG['port'], DB_CONFIG['database'])
    logger.info('=' * 60)

    if not DB_CONFIG.get('database') or not DB_CONFIG.get('user'):
        logger.error('DB_NAME e/ou DB_USER nao configurados no .env')
        sys.exit(1)

    conn = get_connection()
    if not conn:
        logger.error('Falha na conexao inicial. Encerrando.')
        sys.exit(1)

    from psycopg2.extras import RealDictCursor
    cursor = conn.cursor(cursor_factory=RealDictCursor)
    cursor.execute("""
        SELECT tipo_evento, COUNT(*) AS qt_topicos
        FROM notificacoes_destinatarios
        WHERE canal = 'ntfy' AND ativo = true
        GROUP BY tipo_evento ORDER BY tipo_evento
    """)
    topicos_resumo = cursor.fetchall()
    cursor.close()
    conn.close()

    if topicos_resumo:
        for t in topicos_resumo:
            logger.info('  Topicos [%s]: %s configurados', t['tipo_evento'], t['qt_topicos'])
    else:
        logger.warning('ATENCAO: Nenhum topico ntfy configurado no Painel 26!')

    logger.info('Conexao com banco OK')

    ciclo_verificacao()

    schedule.every(INTERVALO_VERIFICACAO).minutes.do(ciclo_verificacao)
    schedule.every().day.at('06:00').do(limpeza_diaria)
    logger.info('Scheduler ativo. Proximo ciclo em %s min...', INTERVALO_VERIFICACAO)

    try:
        while True:
            schedule.run_pending()
            time.sleep(30)
    except KeyboardInterrupt:
        logger.info('Encerrado pelo usuario (Ctrl+C)')
    except Exception as e:
        logger.error('Erro fatal: %s', e)
        sys.exit(1)
