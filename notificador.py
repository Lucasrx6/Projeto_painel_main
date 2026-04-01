# -*- coding: utf-8 -*-
"""
==============================================================
  NOTIFICADOR - Sistema de Alertas ntfy
  Hospital Anchieta Ceilandia
==============================================================

  Servico independente que monitora o PostgreSQL e envia
  notificacoes via ntfy quando detecta eventos clinicos.

  Topicos ntfy lidos da tabela notificacoes_destinatarios.
  Suporta multiplos topicos por tipo de evento.
  Tudo configuravel via Painel 26.

  Eventos monitorados:
  1. ADMISSAO NOVA - dt_entrada_unid nos ultimos 30min
  2. PARECER PENDENTE - Transicao 'Nao' -> 'Sim'
  3. PRESCRICAO PENDENTE - Cenarios novo (2h) e existente (11h)

  CREDENCIAIS:
  - Banco via .env (DB_HOST, DB_NAME, DB_USER, DB_PASSWORD)
  - Topicos ntfy via tabela notificacoes_destinatarios
  - ZERO credenciais hardcoded no codigo

  Execucao:
  - Standalone: python notificador.py
  - Servico Windows via NSSM
==============================================================
"""

import psycopg2
from psycopg2.extras import RealDictCursor
import requests
import schedule
import time
import logging
import logging.handlers
import os
import sys
import json
from datetime import datetime, timedelta
from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(os.path.abspath(__file__)), '.env'))


# =========================================================
# CONFIGURACAO DE LOGGING
# =========================================================

LOG_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'logs')
if not os.path.exists(LOG_DIR):
    os.makedirs(LOG_DIR)

logger = logging.getLogger('notificador')
logger.setLevel(logging.INFO)

file_handler = logging.handlers.RotatingFileHandler(
    os.path.join(LOG_DIR, 'notificador.log'),
    maxBytes=5 * 1024 * 1024,
    backupCount=5,
    encoding='utf-8'
)
file_handler.setFormatter(logging.Formatter(
    '%(asctime)s [%(levelname)s] %(message)s',
    datefmt='%Y-%m-%d %H:%M:%S'
))
logger.addHandler(file_handler)

console_handler = logging.StreamHandler(sys.stdout)
console_handler.setFormatter(logging.Formatter(
    '%(asctime)s [%(levelname)s] %(message)s',
    datefmt='%H:%M:%S'
))
logger.addHandler(console_handler)


# =========================================================
# CONFIGURACOES (sem credenciais hardcoded)
# =========================================================

DB_CONFIG = {
    'host': os.getenv('DB_HOST', 'localhost'),
    'database': os.getenv('DB_NAME', ''),
    'user': os.getenv('DB_USER', ''),
    'password': os.getenv('DB_PASSWORD', ''),
    'port': os.getenv('DB_PORT', '5432')
}

# ntfy - URL base (topicos vem do banco via Painel 26)
NTFY_URL = os.getenv('NTFY_URL', 'https://ntfy.sh')

# Intervalo de verificacao
INTERVALO_VERIFICACAO = int(os.getenv('NOTIF_INTERVALO_MIN', '15'))

# Janelas de tempo para deteccao de eventos clinicos
JANELA_ADMISSAO_MINUTOS = 35          # Janela de admissao nova
JANELA_PRESCRICAO_NOVA_MAX_HORAS = 6  # Paciente novo: no banco ha no max 6h
JANELA_PRESCRICAO_NOVA_MIN_HORAS = 2  # Paciente novo: aguarda 2h antes de alertar
HORA_INICIO_CENARIO_EXISTENTE = 11    # Cenario B: verificar apenas apos 11h
RETENCAO_LOG_DIAS = 30                # Retencao de registros no log


# =========================================================
# CONEXAO COM BANCO
# =========================================================

def get_connection():
    """Abre conexao com PostgreSQL."""
    try:
        conn = psycopg2.connect(**DB_CONFIG)
        return conn
    except Exception as e:
        logger.error('Erro ao conectar no banco: %s', e)
        return None


# =========================================================
# CARREGAR CONFIGURACOES
# =========================================================

def carregar_configs():
    """Carrega configs da tabela notificacoes_config."""
    conn = get_connection()
    if not conn:
        return {}

    try:
        cursor = conn.cursor(cursor_factory=RealDictCursor)
        cursor.execute("SELECT * FROM notificacoes_config WHERE ativo = true")
        rows = cursor.fetchall()
        cursor.close()
        conn.close()

        configs = {}
        for row in rows:
            configs[row['tipo_evento']] = dict(row)

        logger.info('Configuracoes carregadas: %s tipos ativos', len(configs))
        return configs

    except Exception as e:
        logger.error('Erro ao carregar configs: %s', e)
        if conn:
            conn.close()
        return {}


# =========================================================
# BUSCAR TOPICOS NTFY DO BANCO
# =========================================================

def buscar_topicos_ntfy(conn, tipo_evento):
    """
    Busca topicos ntfy da tabela notificacoes_destinatarios.
    Configuravel via Painel 26.
    Retorna lista de topicos ativos para o tipo de evento.
    """
    cursor = conn.cursor(cursor_factory=RealDictCursor)

    cursor.execute("""
        SELECT email AS topico
        FROM notificacoes_destinatarios
        WHERE tipo_evento = %s
          AND canal = 'ntfy'
          AND ativo = true
    """, (tipo_evento,))

    topicos = [row['topico'] for row in cursor.fetchall() if row['topico']]
    cursor.close()

    return topicos


# =========================================================
# VERIFICAR HORARIO PERMITIDO
# =========================================================

def dentro_do_horario(config):
    """Verifica se o horario atual esta dentro da janela."""
    agora = datetime.now().time()
    return config['hora_inicio'] <= agora <= config['hora_fim']


# =========================================================
# ENVIAR NTFY - PARA MULTIPLOS TOPICOS
# =========================================================

def enviar_ntfy_topicos(topicos, titulo, mensagem, prioridade='3'):
    """
    Envia notificacao para todos os topicos ntfy configurados.
    Trata erros individualmente por topico.
    """
    if not topicos:
        logger.debug('Nenhum topico ntfy configurado')
        return True, 'Sem topicos ntfy'

    enviados = 0
    erros = 0
    erros_detalhe = []

    for topico in topicos:
        url = '{}/{}'.format(NTFY_URL, topico)

        headers = {
            'Title': titulo.encode('utf-8'),
            'Priority': str(prioridade),
        }

        try:
            resp = requests.post(
                url,
                data=mensagem.encode('utf-8'),
                headers=headers,
                timeout=10
            )

            if resp.status_code == 200:
                logger.info('ntfy OK: [%s] %s', topico, titulo)
                enviados += 1
            else:
                logger.warning('ntfy [%s] status %s', topico, resp.status_code)
                erros += 1
                erros_detalhe.append('[{}] HTTP {}'.format(topico, resp.status_code))

        except requests.exceptions.Timeout:
            logger.error('Timeout ntfy: %s', topico)
            erros += 1
            erros_detalhe.append('[{}] Timeout'.format(topico))
        except requests.exceptions.ConnectionError:
            logger.error('Conexao recusada ntfy: %s', topico)
            erros += 1
            erros_detalhe.append('[{}] Conexao recusada'.format(topico))
        except Exception as e:
            logger.error('Erro ntfy [%s]: %s', topico, e)
            erros += 1
            erros_detalhe.append('[{}] {}'.format(topico, str(e)))

    if erros > 0:
        resposta = 'ntfy: {} OK, {} erros - {}'.format(enviados, erros, '; '.join(erros_detalhe))
    else:
        resposta = 'ntfy: {} enviados para {} topicos'.format(enviados, len(topicos))

    return erros == 0, resposta


# =========================================================
# SUBSTITUIR PLACEHOLDERS
# =========================================================

def montar_mensagem(template, dados):
    """Substitui {setor}, {leito}, {paciente}, {atendimento}."""
    if not template:
        return ''
    resultado = template
    resultado = resultado.replace('{setor}', str(dados.get('nm_setor', '-')))
    resultado = resultado.replace('{leito}', str(dados.get('cd_unidade', '-')))
    resultado = resultado.replace('{paciente}', str(dados.get('nm_pessoa_fisica', '-')))
    resultado = resultado.replace('{atendimento}', str(dados.get('nr_atendimento', '-')))
    return resultado


# =========================================================
# DEDUP E LOG
# =========================================================

def ja_notificado(conn, chave_evento):
    """Retorna True se ja existe registro notificado."""
    cursor = conn.cursor(cursor_factory=RealDictCursor)
    cursor.execute("""
        SELECT id FROM notificacoes_log
        WHERE chave_evento = %s AND status IN ('notificado', 'pendente')
        LIMIT 1
    """, (chave_evento,))
    existe = cursor.fetchone()
    cursor.close()
    return existe is not None


def precisa_renotificar(conn, chave_evento, config):
    """Verifica se precisa renotificar."""
    cursor = conn.cursor(cursor_factory=RealDictCursor)
    cursor.execute("""
        SELECT id, qt_notificacoes, dt_ultima_notificacao
        FROM notificacoes_log
        WHERE chave_evento = %s AND status = 'notificado'
        ORDER BY dt_detectado DESC LIMIT 1
    """, (chave_evento,))
    registro = cursor.fetchone()
    cursor.close()

    if not registro:
        return False

    max_renotif = config.get('max_renotificacoes', 0)
    intervalo_min = config.get('intervalo_renotificacao_min', 0)

    if max_renotif == 0 or intervalo_min == 0:
        return False
    if registro['qt_notificacoes'] >= (max_renotif + 1):
        return False
    if registro['dt_ultima_notificacao']:
        proxima = registro['dt_ultima_notificacao'] + timedelta(minutes=intervalo_min)
        if datetime.now() < proxima:
            return False
    return True


def registrar_notificacao(conn, tipo_evento, chave_evento, dados, topicos_str, sucesso, resposta):
    """Registra notificacao no log com detalhes."""
    cursor = conn.cursor(cursor_factory=RealDictCursor)
    agora = datetime.now()

    cursor.execute("""
        SELECT id, qt_notificacoes FROM notificacoes_log
        WHERE chave_evento = %s AND status IN ('pendente', 'notificado')
        LIMIT 1
    """, (chave_evento,))

    existente = cursor.fetchone()

    if existente:
        novo_status = 'notificado' if sucesso else 'erro'
        cursor.execute("""
            UPDATE notificacoes_log
            SET dt_ultima_notificacao = %s, qt_notificacoes = qt_notificacoes + 1,
                status = %s, resposta_ntfy = %s
            WHERE id = %s
        """, (agora, novo_status, resposta, existente['id']))
    else:
        novo_status = 'notificado' if sucesso else 'erro'

        # Monta dados_extra com informacoes uteis
        dados_extra = json.dumps({
            'topicos_ntfy': topicos_str,
            'setor': dados.get('nm_setor', '-'),
            'convenio': dados.get('ds_convenio', '-')
        })

        cursor.execute("""
            INSERT INTO notificacoes_log
                (tipo_evento, chave_evento, nr_atendimento, nm_paciente,
                 cd_setor_atendimento, nm_setor, cd_unidade, dados_extra,
                 topico_ntfy, status, dt_detectado,
                 dt_primeira_notificacao, dt_ultima_notificacao,
                 qt_notificacoes, resposta_ntfy)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
        """, (
            tipo_evento, chave_evento,
            dados.get('nr_atendimento'), dados.get('nm_pessoa_fisica'),
            dados.get('cd_setor_atendimento'), dados.get('nm_setor'),
            dados.get('cd_unidade'), dados_extra,
            topicos_str, novo_status, agora,
            agora if sucesso else None,
            agora if sucesso else None,
            1 if sucesso else 0, resposta
        ))

    conn.commit()
    cursor.close()


# =========================================================
# MODULO 1: ADMISSAO NOVA
# =========================================================

def verificar_admissao_nova(configs):
    """Detecta novas admissoes e envia para todos os topicos ntfy."""
    config = configs.get('admissao_nova')
    if not config:
        return
    if not dentro_do_horario(config):
        return

    conn = get_connection()
    if not conn:
        return

    try:
        cursor = conn.cursor(cursor_factory=RealDictCursor)
        topicos = buscar_topicos_ntfy(conn, 'admissao_nova')

        cursor.execute("""
            SELECT nr_atendimento, nm_pessoa_fisica, cd_setor_atendimento,
                   nm_setor, cd_unidade, cd_unidade_basica,
                   ds_convenio, nm_guerra, dt_entrada_unid
            FROM painel_enfermaria
            WHERE ie_status_unidade = 'P'
              AND nr_atendimento IS NOT NULL
              AND dt_entrada_unid IS NOT NULL
              AND dt_entrada_unid::timestamp >= (NOW() - INTERVAL '35 minutes')  -- JANELA_ADMISSAO_MINUTOS
        """)

        pacientes_novos = cursor.fetchall()
        cursor.close()
        notificados = 0

        for pac in pacientes_novos:
            chave = 'admissao_{}'.format(pac['nr_atendimento'])

            if not ja_notificado(conn, chave):
                titulo = montar_mensagem(config['titulo_template'], pac)
                mensagem = montar_mensagem(config['mensagem_template'], pac)

                sucesso, resposta = enviar_ntfy_topicos(
                    topicos, titulo, mensagem,
                    str(config.get('prioridade_ntfy', 3))
                )

                topicos_str = ','.join(topicos) if topicos else 'nenhum'
                registrar_notificacao(
                    conn, 'admissao_nova', chave,
                    dict(pac), topicos_str,
                    sucesso, resposta
                )
                notificados += 1

        if notificados > 0:
            logger.info('[admissao_nova] %s notificadas -> %s topicos', notificados, len(topicos))
        else:
            logger.info('[admissao_nova] Nenhuma admissao recente')

    except Exception as e:
        logger.error('[admissao_nova] Erro: %s', e)
    finally:
        conn.close()


# =========================================================
# MODULO 2: PARECER PENDENTE
# =========================================================

def verificar_parecer_pendente(configs):
    """Detecta transicao de parecer e envia para topicos ntfy."""
    config = configs.get('parecer_pendente')
    if not config:
        return
    if not dentro_do_horario(config):
        return

    conn = get_connection()
    if not conn:
        return

    try:
        cursor = conn.cursor(cursor_factory=RealDictCursor)
        topicos = buscar_topicos_ntfy(conn, 'parecer_pendente')

        cursor.execute("""
            SELECT nr_atendimento, nm_pessoa_fisica, cd_setor_atendimento,
                   nm_setor, cd_unidade, cd_unidade_basica,
                   ds_convenio, nm_guerra, parecer_pendente
            FROM painel_enfermaria
            WHERE ie_status_unidade = 'P' AND nr_atendimento IS NOT NULL
        """)

        pacientes_atuais = cursor.fetchall()

        cursor.execute("""
            SELECT nr_atendimento, dados_snapshot
            FROM notificacoes_snapshot WHERE tipo_snapshot = 'parecer_estado'
        """)

        snapshot_rows = cursor.fetchall()
        estado_anterior = {}
        for row in snapshot_rows:
            dados = row['dados_snapshot'] if row['dados_snapshot'] else {}
            estado_anterior[row['nr_atendimento']] = dados.get('parecer_pendente', 'Nao')

        notificados = 0

        for pac in pacientes_atuais:
            nr_atend = pac['nr_atendimento']
            parecer_atual = pac.get('parecer_pendente', 'Nao')
            parecer_anterior = estado_anterior.get(nr_atend, 'Nao')

            if parecer_atual == 'Sim' and parecer_anterior != 'Sim':
                chave = 'parecer_{}_{}'.format(nr_atend, datetime.now().strftime('%Y%m%d_%H%M'))

                titulo = montar_mensagem(config['titulo_template'], pac)
                mensagem = montar_mensagem(config['mensagem_template'], pac)

                sucesso, resposta = enviar_ntfy_topicos(
                    topicos, titulo, mensagem,
                    str(config.get('prioridade_ntfy', 3))
                )

                topicos_str = ','.join(topicos) if topicos else 'nenhum'
                registrar_notificacao(
                    conn, 'parecer_pendente', chave,
                    dict(pac), topicos_str,
                    sucesso, resposta
                )
                notificados += 1

        cursor.execute("DELETE FROM notificacoes_snapshot WHERE tipo_snapshot = 'parecer_estado'")
        for pac in pacientes_atuais:
            cursor.execute("""
                INSERT INTO notificacoes_snapshot (tipo_snapshot, nr_atendimento, dados_snapshot)
                VALUES ('parecer_estado', %s, %s)
            """, (pac['nr_atendimento'], json.dumps({'parecer_pendente': pac.get('parecer_pendente', 'Nao')})))

        conn.commit()

        if notificados > 0:
            logger.info('[parecer_pendente] %s detectados -> %s topicos', notificados, len(topicos))
        else:
            logger.info('[parecer_pendente] Nenhuma transicao')

    except Exception as e:
        logger.error('[parecer_pendente] Erro: %s', e)
    finally:
        conn.close()


# =========================================================
# MODULO 3: PRESCRICAO PENDENTE
# =========================================================

def verificar_prescricao_pendente(configs):
    """Detecta pacientes sem prescricao e envia para topicos ntfy."""
    config = configs.get('prescricao_pendente')
    if not config:
        return
    if not dentro_do_horario(config):
        return

    conn = get_connection()
    if not conn:
        return

    try:
        cursor = conn.cursor(cursor_factory=RealDictCursor)
        agora = datetime.now()
        hoje = agora.strftime('%Y-%m-%d')

        topicos = buscar_topicos_ntfy(conn, 'prescricao_pendente')

        # CENARIO A: Novos sem prescricao (2h-6h)
        cursor.execute("""
            SELECT nr_atendimento, nm_pessoa_fisica, cd_setor_atendimento,
                   nm_setor, cd_unidade, cd_unidade_basica,
                   ds_convenio, nm_guerra, dt_entrada_unid
            FROM painel_enfermaria
            WHERE ie_status_unidade = 'P'
              AND nr_atendimento IS NOT NULL
              AND (nr_prescricao IS NULL OR dt_liberacao_medico IS NULL)
              AND dt_entrada_unid IS NOT NULL
              AND dt_entrada_unid::timestamp >= (NOW() - INTERVAL '6 hours')   -- JANELA_PRESCRICAO_NOVA_MAX_HORAS
              AND dt_entrada_unid::timestamp <= (NOW() - INTERVAL '2 hours')   -- JANELA_PRESCRICAO_NOVA_MIN_HORAS
        """)

        novos_sem = cursor.fetchall()
        notificados_novos = 0

        for pac in novos_sem:
            chave = 'prescricao_novo_{}_{}'.format(hoje, pac['nr_atendimento'])
            if not ja_notificado(conn, chave):
                titulo = montar_mensagem(config['titulo_template'], pac)
                mensagem = montar_mensagem(config['mensagem_template'], pac)
                sucesso, resposta = enviar_ntfy_topicos(topicos, titulo, mensagem, str(config.get('prioridade_ntfy', 4)))
                topicos_str = ','.join(topicos) if topicos else 'nenhum'
                registrar_notificacao(conn, 'prescricao_pendente', chave, dict(pac), topicos_str, sucesso, resposta)
                notificados_novos += 1

        # CENARIO B: Existentes sem prescricao (apos 11h)
        notificados_exist = 0

        if agora.hour >= HORA_INICIO_CENARIO_EXISTENTE:
            cursor.execute("""
                SELECT nr_atendimento, nm_pessoa_fisica, cd_setor_atendimento,
                       nm_setor, cd_unidade, cd_unidade_basica,
                       ds_convenio, nm_guerra, dt_entrada_unid
                FROM painel_enfermaria
                WHERE ie_status_unidade = 'P'
                  AND nr_atendimento IS NOT NULL
                  AND (nr_prescricao IS NULL OR dt_liberacao_medico IS NULL)
                  AND dt_entrada_unid IS NOT NULL
                  AND dt_entrada_unid::timestamp < (NOW() - INTERVAL '6 hours')  -- JANELA_PRESCRICAO_NOVA_MAX_HORAS
            """)

            existentes_sem = cursor.fetchall()

            for pac in existentes_sem:
                chave = 'prescricao_dia_{}_{}'.format(hoje, pac['nr_atendimento'])
                titulo = montar_mensagem(config['titulo_template'], pac)
                mensagem = montar_mensagem(config['mensagem_template'], pac)

                if not ja_notificado(conn, chave):
                    sucesso, resposta = enviar_ntfy_topicos(topicos, titulo, mensagem, str(config.get('prioridade_ntfy', 4)))
                    topicos_str = ','.join(topicos) if topicos else 'nenhum'
                    registrar_notificacao(conn, 'prescricao_pendente', chave, dict(pac), topicos_str, sucesso, resposta)
                    notificados_exist += 1
                elif precisa_renotificar(conn, chave, config):
                    sucesso, resposta = enviar_ntfy_topicos(topicos, titulo, mensagem, str(config.get('prioridade_ntfy', 4)))
                    topicos_str = ','.join(topicos) if topicos else 'nenhum'
                    registrar_notificacao(conn, 'prescricao_pendente', chave, dict(pac), topicos_str, sucesso, resposta)
                    notificados_exist += 1

        cursor.close()

        total = notificados_novos + notificados_exist
        if total > 0:
            logger.info('[prescricao] %s notificacoes (novos: %s, exist: %s) -> %s topicos',
                         total, notificados_novos, notificados_exist, len(topicos))
        else:
            logger.info('[prescricao_pendente] Nenhuma notificacao necessaria')

    except Exception as e:
        logger.error('[prescricao_pendente] Erro: %s', e)
    finally:
        conn.close()


# =========================================================
# CICLO PRINCIPAL
# =========================================================

def ciclo_verificacao():
    """Executa todos os modulos."""
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


# =========================================================
# LIMPEZA DIARIA
# =========================================================

def limpeza_diaria():
    """Remove registros antigos e expira prescricoes do dia anterior."""
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
              AND dt_criacao < CURRENT_TIMESTAMP - INTERVAL '30 days'  -- RETENCAO_LOG_DIAS
        """)
        removidos = cursor.rowcount

        conn.commit()
        cursor.close()
        logger.info('[limpeza] Expirados: %s, Removidos: %s', expirados, removidos)

    except Exception as e:
        logger.error('[limpeza] Erro: %s', e)
    finally:
        conn.close()


# =========================================================
# MAIN
# =========================================================

def main():
    """Ponto de entrada."""
    logger.info('=' * 60)
    logger.info('  NOTIFICADOR ntfy - Hospital Anchieta')
    logger.info('  Intervalo: %s minutos', INTERVALO_VERIFICACAO)
    logger.info('  ntfy base: %s', NTFY_URL)
    logger.info('  Topicos: lidos da tabela notificacoes_destinatarios')
    logger.info('  Banco: %s@%s:%s/%s',
                 DB_CONFIG['user'] or '(nao configurado)',
                 DB_CONFIG['host'],
                 DB_CONFIG['port'],
                 DB_CONFIG['database'] or '(nao configurado)')
    logger.info('=' * 60)

    # Valida banco
    if not DB_CONFIG['database'] or not DB_CONFIG['user']:
        logger.error('DB_NAME e/ou DB_USER nao configurados no .env')
        logger.error('Adicione ao .env: DB_NAME=postgres DB_USER=postgres DB_PASSWORD=suasenha')
        sys.exit(1)

    if not DB_CONFIG['password']:
        logger.warning('DB_PASSWORD vazio no .env - pode falhar a conexao')

    # Testa conexao
    conn = get_connection()
    if not conn:
        logger.error('Falha na conexao inicial. Encerrando.')
        sys.exit(1)

    # Valida se existem topicos ntfy configurados
    cursor = conn.cursor(cursor_factory=RealDictCursor)
    cursor.execute("""
        SELECT
            tipo_evento,
            COUNT(*) AS qt_topicos
        FROM notificacoes_destinatarios
        WHERE canal = 'ntfy' AND ativo = true
        GROUP BY tipo_evento
        ORDER BY tipo_evento
    """)
    topicos_resumo = cursor.fetchall()
    cursor.close()
    conn.close()

    if topicos_resumo:
        for t in topicos_resumo:
            logger.info('  Topicos [%s]: %s configurados', t['tipo_evento'], t['qt_topicos'])
    else:
        logger.warning('ATENCAO: Nenhum topico ntfy configurado no Painel 26!')
        logger.warning('Cadastre topicos em: Central de Notificacoes > Novo > Canal: ntfy')

    logger.info('Conexao com banco OK')

    # Primeiro ciclo imediato
    ciclo_verificacao()

    # Agenda ciclos
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


if __name__ == '__main__':
    main()