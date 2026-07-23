# -*- coding: utf-8 -*-
import unicodedata
from datetime import timedelta, datetime
from psycopg2.extras import RealDictCursor
from .config import logger, ESPERA_MIN_ALERTA, COOLDOWN_MIN

# Alias de especialidades — mesma logica do painel10_routes.py
_ALIAS_ESPECIALIDADE = {
    'CLINICA GERAL':             'CLINICA MEDICA',
    'CIRURGIAL GERAL':           'CIRURGICA GERAL',
    'GINECOLOGIA E OBSTETRICIA': 'GINECOLOGIA',
    'OBSTETRICIA':               'GINECOLOGIA',
    'ORTOPEDIA E TRAUMATOLOGIA': 'ORTOPEDIA',
    'ORTOPEDIA':                 'ORTOPEDIA',
    'PEDIATRIA':                 'PEDIATRIA',
    'CLINICA MEDICA':            'CLINICA MEDICA',
    'EMERGENCISTA':              'EMERGENCISTA',
}


def _norm(texto):
    """Remove acentos e normaliza para comparacao de nomes de clinicas."""
    if not texto:
        return ''
    nfkd = unicodedata.normalize('NFKD', str(texto).upper().strip())
    return ''.join(c for c in nfkd if not unicodedata.combining(c))


def _clinica_tem_medico(ds_clinica, especialidades_ativas):
    """Verifica se ha medico logado para a clinica dada."""
    ds_norm = _norm(ds_clinica)
    for esp_norm in especialidades_ativas:
        canonical = _ALIAS_ESPECIALIDADE.get(esp_norm, esp_norm)
        if canonical == ds_norm:
            return True
        if ds_norm in esp_norm or esp_norm in ds_norm:
            return True
        if ds_norm in canonical or canonical in ds_norm:
            return True
    return False


def get_connection():
    try:
        from backend.database import get_db_connection
        return get_db_connection()
    except Exception as e:
        logger.error('Erro ao conectar no banco: %s', e)
        return None


def buscar_destinatarios_email(conn):
    """Busca destinatarios ativos para paciente_ps_sem_medico (Painel 26)."""
    cursor = conn.cursor(cursor_factory=RealDictCursor)
    cursor.execute("""
        SELECT DISTINCT ON (email) nome, email
        FROM notificacoes_destinatarios
        WHERE tipo_evento = 'paciente_ps_sem_medico'
          AND canal = 'email'
          AND ativo = true
        ORDER BY email
    """)
    destinatarios = [dict(r) for r in cursor.fetchall()]
    cursor.close()
    return destinatarios


def detectar_alertas(conn):
    """
    Retorna clinicas com paciente aguardando >= ESPERA_MIN_ALERTA min
    e nenhum medico logado.
    """
    cursor = conn.cursor(cursor_factory=RealDictCursor)
    cursor.execute("""
        SELECT
            ds_clinica,
            COUNT(*) AS qt_aguardando,
            ROUND(
                EXTRACT(EPOCH FROM (NOW() - MIN(dt_entrada::timestamptz))) / 60
            )::int AS max_espera_min
        FROM painel_ps_analise
        WHERE (dt_atend_medico IS NULL OR dt_atend_medico = '')
          AND (dt_alta IS NULL OR dt_alta = '')
          AND dt_entrada::timestamptz >= NOW() - INTERVAL '24 hours'
        GROUP BY ds_clinica
        HAVING EXTRACT(EPOCH FROM
            (NOW() - MIN(dt_entrada::timestamptz))
        ) / 60 >= %s
    """, (ESPERA_MIN_ALERTA,))
    clinicas_aguardando = [dict(r) for r in cursor.fetchall()]

    if not clinicas_aguardando:
        cursor.close()
        return []

    cursor.execute("""
        SELECT UPPER(especialidade) AS esp_upper
        FROM medicos_ps
        WHERE especialidade IS NOT NULL AND especialidade != ''
    """)
    especialidades_ativas = {_norm(r['esp_upper']) for r in cursor.fetchall()}
    cursor.close()

    return [c for c in clinicas_aguardando if not _clinica_tem_medico(c['ds_clinica'], especialidades_ativas)]


def _chave_clinica(ds_clinica):
    return 'ps_sem_medico_{}_{}'.format(
        ds_clinica.lower().replace(' ', '_'),
        datetime.now().strftime('%Y%m%d')
    )


def clinica_em_cooldown(conn, ds_clinica):
    """Retorna True se ja enviamos alerta para esta clinica nos ultimos COOLDOWN_MIN min."""
    cutoff = datetime.now() - timedelta(minutes=COOLDOWN_MIN)
    cursor = conn.cursor(cursor_factory=RealDictCursor)
    cursor.execute("""
        SELECT dt_ultima_notificacao
        FROM notificacoes_log
        WHERE chave_evento = %s
          AND status = 'notificado'
          AND dt_ultima_notificacao >= %s
        LIMIT 1
    """, (_chave_clinica(ds_clinica), cutoff))
    result = cursor.fetchone()
    cursor.close()
    return result is not None
