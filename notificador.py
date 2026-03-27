# -*- coding: utf-8 -*-
"""
==============================================================
  NOTIFICADOR - Sistema de Alertas ntfy
  Hospital Anchieta Ceilandia
==============================================================

  Servico independente que monitora o PostgreSQL e envia
  notificacoes via ntfy quando detecta eventos clinicos.

  Eventos monitorados:
  1. ADMISSAO NOVA
     - Detecta pacientes com dt_entrada_unid (data real de
       entrada no hospital, nao movimentacao de setor)
       nos ultimos 30 minutos
     - Notifica uma unica vez por admissao

  2. PARECER PENDENTE
     - Detecta TRANSICAO de parecer_pendente: 'Nao' -> 'Sim'
     - Compara estado atual vs snapshot anterior
     - Sem renotificacao (pareceres podem demorar dias)

  3. PRESCRICAO PENDENTE
     - Paciente NOVO (2h-6h sem prescricao): notifica 1x
     - Paciente EXISTENTE (>6h, apos 11h): renotificacao
     - Usa dt_entrada_unid (data real de admissao)

  Todas as mensagens sao carregadas da tabela notificacoes_config.

  Execucao:
  - Standalone: python notificador.py
  - Servico Windows via NSSM

  Dependencias:
  - psycopg2, requests, schedule, python-dotenv
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
# CONFIGURACAO DO BANCO DE DADOS
# =========================================================

DB_CONFIG = {
    'host': os.getenv('DB_HOST', 'localhost'),
    'database': os.getenv('DB_NAME', 'postgres'),
    'user': os.getenv('DB_USER', 'postgres'),
    'password': os.getenv('DB_PASSWORD', 'postgres'),
    'port': os.getenv('DB_PORT', '5432')
}

INTERVALO_VERIFICACAO = int(os.getenv('NOTIF_INTERVALO_MIN', '15'))


# =========================================================
# CONEXAO COM BANCO
# =========================================================

def get_connection():
    """Abre conexao com PostgreSQL. Retorna None em caso de erro."""
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
    """Carrega configs da tabela notificacoes_config. Retorna dict por tipo_evento."""
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
# VERIFICAR HORARIO PERMITIDO
# =========================================================

def dentro_do_horario(config):
    """Verifica se o horario atual esta dentro da janela de notificacao."""
    agora = datetime.now().time()
    return config['hora_inicio'] <= agora <= config['hora_fim']


# =========================================================
# ENVIAR NOTIFICACAO ntfy
# =========================================================

def enviar_ntfy(config, titulo, mensagem):
    """
    Envia notificacao via HTTP POST para o servidor ntfy.
    Returns: (sucesso: bool, resposta: str)
    """
    url = '{}/{}'.format(config['url_servidor'], config['topico_ntfy'])

    headers = {
        'Title': titulo.encode('utf-8'),
        'Priority': str(config['prioridade_ntfy']),
    }

    if config.get('tags_ntfy'):
        headers['Tags'] = config['tags_ntfy']

    try:
        resp = requests.post(
            url,
            data=mensagem.encode('utf-8'),
            headers=headers,
            timeout=10
        )

        if resp.status_code == 200:
            logger.info('ntfy OK: [%s] %s', config['topico_ntfy'], titulo)
            return True, resp.text
        else:
            logger.warning('ntfy status %s: %s', resp.status_code, resp.text)
            return False, 'HTTP {}: {}'.format(resp.status_code, resp.text)

    except requests.exceptions.Timeout:
        logger.error('Timeout ntfy: %s', url)
        return False, 'Timeout'
    except requests.exceptions.ConnectionError:
        logger.error('Conexao recusada ntfy: %s', url)
        return False, 'ConnectionError'
    except Exception as e:
        logger.error('Erro ntfy: %s', e)
        return False, str(e)


# =========================================================
# SUBSTITUIR PLACEHOLDERS NO TEMPLATE
# =========================================================

def montar_mensagem(template, dados):
    """Substitui {setor}, {leito}, {paciente}, {atendimento} nos templates."""
    if not template:
        return ''

    resultado = template
    resultado = resultado.replace('{setor}', str(dados.get('nm_setor', '-')))
    resultado = resultado.replace('{leito}', str(dados.get('cd_unidade', '-')))
    resultado = resultado.replace('{paciente}', str(dados.get('nm_pessoa_fisica', '-')))
    resultado = resultado.replace('{atendimento}', str(dados.get('nr_atendimento', '-')))

    return resultado


# =========================================================
# VERIFICAR SE JA FOI NOTIFICADO (dedup)
# =========================================================

def ja_notificado(conn, chave_evento):
    """Retorna True se ja existe registro notificado para essa chave."""
    cursor = conn.cursor(cursor_factory=RealDictCursor)
    cursor.execute("""
        SELECT id
        FROM notificacoes_log
        WHERE chave_evento = %s
          AND status IN ('notificado', 'pendente')
        LIMIT 1
    """, (chave_evento,))

    existe = cursor.fetchone()
    cursor.close()
    return existe is not None


# =========================================================
# VERIFICAR RENOTIFICACAO (para prescricao)
# =========================================================

def precisa_renotificar(conn, chave_evento, config):
    """Verifica se evento notificado precisa de renotificacao."""
    cursor = conn.cursor(cursor_factory=RealDictCursor)
    cursor.execute("""
        SELECT id, qt_notificacoes, dt_ultima_notificacao
        FROM notificacoes_log
        WHERE chave_evento = %s
          AND status = 'notificado'
        ORDER BY dt_detectado DESC
        LIMIT 1
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


# =========================================================
# REGISTRAR NOTIFICACAO NO LOG
# =========================================================

def registrar_notificacao(conn, tipo_evento, chave_evento, dados, topico, sucesso, resposta):
    """Registra nova notificacao ou atualiza renotificacao."""
    cursor = conn.cursor(cursor_factory=RealDictCursor)
    agora = datetime.now()

    cursor.execute("""
        SELECT id, qt_notificacoes
        FROM notificacoes_log
        WHERE chave_evento = %s
          AND status IN ('pendente', 'notificado')
        LIMIT 1
    """, (chave_evento,))

    existente = cursor.fetchone()

    if existente:
        novo_status = 'notificado' if sucesso else 'erro'
        cursor.execute("""
            UPDATE notificacoes_log
            SET dt_ultima_notificacao = %s,
                qt_notificacoes = qt_notificacoes + 1,
                status = %s,
                resposta_ntfy = %s
            WHERE id = %s
        """, (agora, novo_status, resposta, existente['id']))
    else:
        novo_status = 'notificado' if sucesso else 'erro'
        dados_extra = dados.get('dados_extra') if dados.get('dados_extra') else None

        cursor.execute("""
            INSERT INTO notificacoes_log
                (tipo_evento, chave_evento, nr_atendimento, nm_paciente,
                 cd_setor_atendimento, nm_setor, cd_unidade, dados_extra,
                 topico_ntfy, status, dt_detectado,
                 dt_primeira_notificacao, dt_ultima_notificacao,
                 qt_notificacoes, resposta_ntfy)
            VALUES
                (%s, %s, %s, %s,
                 %s, %s, %s, %s,
                 %s, %s, %s,
                 %s, %s,
                 %s, %s)
        """, (
            tipo_evento, chave_evento,
            dados.get('nr_atendimento'), dados.get('nm_pessoa_fisica'),
            dados.get('cd_setor_atendimento'), dados.get('nm_setor'),
            dados.get('cd_unidade'),
            json.dumps(dados_extra) if dados_extra else None,
            topico, novo_status, agora,
            agora if sucesso else None,
            agora if sucesso else None,
            1 if sucesso else 0, resposta
        ))

    conn.commit()
    cursor.close()


# =========================================================
# MODULO 1: ADMISSAO NOVA
# =========================================================
# Usa dt_entrada_unid = data real de entrada no hospital
# (vem de ATENDIMENTO_PACIENTE_V.DT_ENTRADA via ETL)
# Janela fixa de 35min (30min + 5min margem)
# Nao confundir com dt_entrada_unidade que muda a cada
# movimentacao de setor (UTI1 -> UTI2 etc)
# =========================================================

def verificar_admissao_nova(configs):
    """
    Detecta novas admissoes: dt_entrada_unid nos ultimos 30 minutos.
    Notifica UMA vez por admissao. Mensagem via template do banco.
    """
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

        # Janela fixa: 30min de deteccao + 5min de margem
        janela_minutos = 35

        cursor.execute("""
            SELECT nr_atendimento, nm_pessoa_fisica, cd_setor_atendimento,
                   nm_setor, cd_unidade, cd_unidade_basica,
                   ds_convenio, nm_guerra, dt_entrada_unid
            FROM painel_enfermaria
            WHERE ie_status_unidade = 'P'
              AND nr_atendimento IS NOT NULL
              AND dt_entrada_unid IS NOT NULL
              AND dt_entrada_unid::timestamp >= (NOW() - INTERVAL '%s minutes')
        """ % janela_minutos)

        pacientes_novos = cursor.fetchall()
        cursor.close()

        notificados = 0

        for pac in pacientes_novos:
            chave = 'admissao_{}'.format(pac['nr_atendimento'])

            if not ja_notificado(conn, chave):
                titulo = montar_mensagem(config['titulo_template'], pac)
                mensagem = montar_mensagem(config['mensagem_template'], pac)

                sucesso, resposta = enviar_ntfy(config, titulo, mensagem)
                registrar_notificacao(
                    conn, 'admissao_nova', chave,
                    dict(pac), config['topico_ntfy'],
                    sucesso, resposta
                )
                notificados += 1

        if notificados > 0:
            logger.info('[admissao_nova] %s novas admissoes notificadas', notificados)
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
    """
    Detecta TRANSICAO de parecer_pendente: 'Nao' -> 'Sim'.
    Compara estado atual vs snapshot. Sem renotificacao.
    Mensagem via template do banco.
    """
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

        cursor.execute("""
            SELECT nr_atendimento, nm_pessoa_fisica, cd_setor_atendimento,
                   nm_setor, cd_unidade, cd_unidade_basica,
                   ds_convenio, nm_guerra, parecer_pendente
            FROM painel_enfermaria
            WHERE ie_status_unidade = 'P'
              AND nr_atendimento IS NOT NULL
        """)

        pacientes_atuais = cursor.fetchall()

        # Busca snapshot anterior
        cursor.execute("""
            SELECT nr_atendimento, dados_snapshot
            FROM notificacoes_snapshot
            WHERE tipo_snapshot = 'parecer_estado'
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

            # Transicao: era 'Nao' e agora e 'Sim'
            if parecer_atual == 'Sim' and parecer_anterior != 'Sim':
                chave = 'parecer_{}_{}'.format(
                    nr_atend,
                    datetime.now().strftime('%Y%m%d_%H%M')
                )

                titulo = montar_mensagem(config['titulo_template'], pac)
                mensagem = montar_mensagem(config['mensagem_template'], pac)

                sucesso, resposta = enviar_ntfy(config, titulo, mensagem)
                registrar_notificacao(
                    conn, 'parecer_pendente', chave,
                    dict(pac), config['topico_ntfy'],
                    sucesso, resposta
                )
                notificados += 1

        # Atualiza snapshot
        cursor.execute("DELETE FROM notificacoes_snapshot WHERE tipo_snapshot = 'parecer_estado'")

        for pac in pacientes_atuais:
            cursor.execute("""
                INSERT INTO notificacoes_snapshot (tipo_snapshot, nr_atendimento, dados_snapshot)
                VALUES ('parecer_estado', %s, %s)
            """, (
                pac['nr_atendimento'],
                json.dumps({'parecer_pendente': pac.get('parecer_pendente', 'Nao')})
            ))

        conn.commit()

        if notificados > 0:
            logger.info('[parecer_pendente] %s novos pareceres detectados', notificados)
        else:
            logger.info('[parecer_pendente] Nenhuma transicao detectada')

    except Exception as e:
        logger.error('[parecer_pendente] Erro: %s', e)
    finally:
        conn.close()


# =========================================================
# MODULO 3: PRESCRICAO PENDENTE
# =========================================================
# Usa dt_entrada_unid = data real de entrada no hospital
# CENARIO A: Paciente novo (entrada entre 2h e 6h atras)
# CENARIO B: Paciente existente (entrada >6h, apos 11h)
# =========================================================

def verificar_prescricao_pendente(configs):
    """
    Detecta pacientes sem prescricao medica.

    CENARIO A - Paciente NOVO (entrada entre 2h e 6h atras):
      Notifica 1x que esta sem prescricao apos 2h de admissao.

    CENARIO B - Paciente EXISTENTE (entrada >6h, apos 11h):
      Notifica + renotifica conforme config do banco.

    Todas as mensagens via template do banco.
    Usa dt_entrada_unid (data real de admissao hospitalar).
    """
    config = configs.get('prescricao_pendente')
    if not config:
        return

    if not dentro_do_horario(config):
        logger.debug('[prescricao_pendente] Fora do horario')
        return

    conn = get_connection()
    if not conn:
        return

    try:
        cursor = conn.cursor(cursor_factory=RealDictCursor)
        agora = datetime.now()
        hoje = agora.strftime('%Y-%m-%d')

        # -------------------------------------------------------
        # CENARIO A: Pacientes NOVOS sem prescricao apos 2h
        # Entrada real no hospital entre 2h e 6h atras
        # -------------------------------------------------------
        cursor.execute("""
            SELECT nr_atendimento, nm_pessoa_fisica, cd_setor_atendimento,
                   nm_setor, cd_unidade, cd_unidade_basica,
                   ds_convenio, nm_guerra, dt_entrada_unid
            FROM painel_enfermaria
            WHERE ie_status_unidade = 'P'
              AND nr_atendimento IS NOT NULL
              AND (nr_prescricao IS NULL OR dt_liberacao_medico IS NULL)
              AND dt_entrada_unid IS NOT NULL
              AND dt_entrada_unid::timestamp >= (NOW() - INTERVAL '6 hours')
              AND dt_entrada_unid::timestamp <= (NOW() - INTERVAL '2 hours')
        """)

        novos_sem_prescricao = cursor.fetchall()
        notificados_novos = 0

        for pac in novos_sem_prescricao:
            chave = 'prescricao_novo_{}_{}'.format(hoje, pac['nr_atendimento'])

            if not ja_notificado(conn, chave):
                titulo = montar_mensagem(config['titulo_template'], pac)
                mensagem = montar_mensagem(config['mensagem_template'], pac)

                sucesso, resposta = enviar_ntfy(config, titulo, mensagem)
                registrar_notificacao(
                    conn, 'prescricao_pendente', chave,
                    dict(pac), config['topico_ntfy'],
                    sucesso, resposta
                )
                notificados_novos += 1

        # -------------------------------------------------------
        # CENARIO B: Pacientes EXISTENTES sem prescricao apos 11h
        # Entrada real no hospital ha mais de 6h
        # -------------------------------------------------------
        notificados_existentes = 0

        if agora.hour >= 11:
            cursor.execute("""
                SELECT nr_atendimento, nm_pessoa_fisica, cd_setor_atendimento,
                       nm_setor, cd_unidade, cd_unidade_basica,
                       ds_convenio, nm_guerra, dt_entrada_unid
                FROM painel_enfermaria
                WHERE ie_status_unidade = 'P'
                  AND nr_atendimento IS NOT NULL
                  AND (nr_prescricao IS NULL OR dt_liberacao_medico IS NULL)
                  AND dt_entrada_unid IS NOT NULL
                  AND dt_entrada_unid::timestamp < (NOW() - INTERVAL '6 hours')
            """)

            existentes_sem_prescricao = cursor.fetchall()

            for pac in existentes_sem_prescricao:
                chave = 'prescricao_dia_{}_{}'.format(hoje, pac['nr_atendimento'])

                if not ja_notificado(conn, chave):
                    titulo = montar_mensagem(config['titulo_template'], pac)
                    mensagem = montar_mensagem(config['mensagem_template'], pac)

                    sucesso, resposta = enviar_ntfy(config, titulo, mensagem)
                    registrar_notificacao(
                        conn, 'prescricao_pendente', chave,
                        dict(pac), config['topico_ntfy'],
                        sucesso, resposta
                    )
                    notificados_existentes += 1

                elif precisa_renotificar(conn, chave, config):
                    titulo = montar_mensagem(config['titulo_template'], pac)
                    mensagem = montar_mensagem(config['mensagem_template'], pac)

                    sucesso, resposta = enviar_ntfy(config, titulo, mensagem)
                    registrar_notificacao(
                        conn, 'prescricao_pendente', chave,
                        dict(pac), config['topico_ntfy'],
                        sucesso, resposta
                    )
                    notificados_existentes += 1

        cursor.close()

        total = notificados_novos + notificados_existentes
        if total > 0:
            logger.info(
                '[prescricao_pendente] %s notificacoes (novos: %s, existentes: %s)',
                total, notificados_novos, notificados_existentes
            )
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
    """Executa todos os modulos de verificacao."""
    logger.info('=' * 50)
    logger.info('Iniciando ciclo de verificacao...')

    try:
        configs = carregar_configs()
        if not configs:
            logger.warning('Nenhuma configuracao ativa encontrada')
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
            UPDATE notificacoes_log
            SET status = 'expirado'
            WHERE tipo_evento = 'prescricao_pendente'
              AND status IN ('pendente', 'notificado')
              AND chave_evento NOT LIKE %s
        """, ('%{}%'.format(hoje),))
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
    """Ponto de entrada do servico notificador."""
    logger.info('=' * 60)
    logger.info('  NOTIFICADOR ntfy - Hospital Anchieta')
    logger.info('  Intervalo: %s minutos', INTERVALO_VERIFICACAO)
    logger.info('  Banco: %s@%s:%s/%s',
                 DB_CONFIG['user'], DB_CONFIG['host'],
                 DB_CONFIG['port'], DB_CONFIG['database'])
    logger.info('=' * 60)

    conn = get_connection()
    if not conn:
        logger.error('Falha na conexao inicial. Encerrando.')
        sys.exit(1)
    conn.close()
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


if __name__ == '__main__':
    main()