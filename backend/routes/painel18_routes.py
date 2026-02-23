# =============================================================================
# PAINEL 18 - PRODUTIVIDADE MEDICA DO PRONTO SOCORRO
# Hospital Anchieta Ceilandia
#
# Combina duas fontes de dados:
#   - medicos_ps: medicos logados nos consultorios (presenca real)
#   - painel17_atendimentos_ps: historico de atendimentos (metricas)
#
# Endpoints:
#   GET /api/paineis/painel18/medicos   - Medicos logados + metricas
#   GET /api/paineis/painel18/ranking   - Ranking de produtividade do dia
#   GET /api/paineis/painel18/stats     - Resumo geral
#
# Threshold "em consulta": 60 minutos (baseado em P75=29min com margem)
#
# FILTRO DE CLINICA: aplicado APENAS no ranking (Produtividade do Dia).
# Medicos nos consultorios e stats gerais sempre mostram tudo.
# =============================================================================

import logging
from datetime import datetime, timedelta

from flask import Blueprint, jsonify, request

from backend.database import get_db_connection

logger = logging.getLogger(__name__)

painel18_bp = Blueprint('painel18', __name__)

# Threshold em minutos: se inicio da consulta > 60 min atras sem fim,
# considera que o medico ja terminou mas esqueceu de fechar
THRESHOLD_EM_CONSULTA_MIN = 60


def _get_filtro_clinica(args):
    """Retorna filtro de clinica se informado."""
    clinica = args.get('clinica', '').strip()
    return clinica if clinica else None


# =============================================================================
# ENDPOINT: MEDICOS LOGADOS NOS CONSULTORIOS
# (sem filtro de clinica - sempre mostra todos os medicos logados)
# =============================================================================

@painel18_bp.route('/api/paineis/painel18/medicos')
def api_painel18_medicos():
    """
    Retorna medicos logados nos consultorios do PS com metricas individuais.

    OTIMIZADO: Usa queries agregadas (4 queries fixas no total) em vez de
    N+1 queries (antes fazia 5 queries POR medico logado, causando timeout).

    Queries:
      1. SELECT dos medicos logados (medicos_ps)
      2. SELECT agregado de metricas do dia (atendimentos + ultimo atend)
      3. SELECT agregado de pacientes em consulta agora
      4. SELECT agregado de clinicas atendidas hoje
    """
    conn = None
    try:
        conn = get_db_connection()
        cur = conn.cursor()

        hoje = datetime.now().replace(hour=0, minute=0, second=0, microsecond=0)
        threshold_dt = datetime.now() - timedelta(minutes=THRESHOLD_EM_CONSULTA_MIN)

        # 1. Buscar medicos logados (query simples, igual painel 3)
        cur.execute("""
            SELECT
                nm_usuario,
                nm_maq_cliente,
                consultorio,
                ds_usuario,
                especialidade,
                logon_time,
                tempo_conectado
            FROM medicos_ps
            ORDER BY nm_maq_cliente
        """)
        colunas_med = [desc[0] for desc in cur.description]
        medicos_logados = [dict(zip(colunas_med, row)) for row in cur.fetchall()]

        if not medicos_logados:
            return jsonify({
                'success': True,
                'dados': [],
                'total': 0
            })

        # 2. Metricas agregadas do dia (1 query para todos os medicos)
        cur.execute("""
            SELECT
                UPPER(nm_medico) as nome_upper,
                COUNT(*) FILTER (
                    WHERE dt_inicio_atendimento_med IS NOT NULL
                ) as atendimentos_hoje,
                MAX(dt_inicio_atendimento_med) as ultimo_atendimento
            FROM painel17_atendimentos_ps
            WHERE dt_entrada >= %s
              AND nm_medico IS NOT NULL
            GROUP BY UPPER(nm_medico)
        """, [hoje])
        metricas = {}
        for row in cur.fetchall():
            metricas[row[0]] = {
                'atendimentos_hoje': row[1] or 0,
                'ultimo_atendimento': row[2]
            }

        # 3. Pacientes em consulta agora (1 query para todos)
        cur.execute("""
            SELECT
                UPPER(nm_medico) as nome_upper,
                COUNT(*) as em_consulta
            FROM painel17_atendimentos_ps
            WHERE dt_inicio_atendimento_med >= %s
              AND dt_fim_atendimento IS NULL
              AND dt_alta IS NULL
              AND nm_medico IS NOT NULL
            GROUP BY UPPER(nm_medico)
        """, [threshold_dt])
        consultas = {}
        for row in cur.fetchall():
            consultas[row[0]] = row[1] or 0

        # 4. Clinicas atendidas hoje (1 query para todos)
        cur.execute("""
            SELECT
                UPPER(nm_medico) as nome_upper,
                ARRAY_AGG(DISTINCT clinica) as clinicas
            FROM painel17_atendimentos_ps
            WHERE dt_entrada >= %s
              AND dt_inicio_atendimento_med IS NOT NULL
              AND clinica IS NOT NULL
              AND nm_medico IS NOT NULL
            GROUP BY UPPER(nm_medico)
        """, [hoje])
        clinicas_map = {}
        for row in cur.fetchall():
            clinicas_map[row[0]] = row[1] or []

        cur.close()

        # Montar resultado cruzando medicos logados com metricas
        resultado = []
        for med in medicos_logados:
            nome_medico = (med.get('ds_usuario') or '').strip().upper()
            if not nome_medico:
                continue

            met = metricas.get(nome_medico, {})
            em_consulta = consultas.get(nome_medico, 0)
            clinicas = clinicas_map.get(nome_medico, [])

            # Calcular minutos desde ultimo atendimento
            ultimo_min = None
            ultimo_dt = met.get('ultimo_atendimento')
            if ultimo_dt:
                delta = datetime.now() - ultimo_dt
                ultimo_min = int(delta.total_seconds() / 60)

            resultado.append({
                'consultorio': med.get('consultorio'),
                'nm_maq_cliente': med.get('nm_maq_cliente'),
                'ds_usuario': med.get('ds_usuario'),
                'nm_usuario': med.get('nm_usuario'),
                'especialidade': med.get('especialidade'),
                'logon_time': med.get('logon_time').strftime('%H:%M') if med.get('logon_time') else None,
                'tempo_conectado': med.get('tempo_conectado'),
                'atendimentos_hoje': met.get('atendimentos_hoje', 0),
                'em_consulta': em_consulta,
                'ultimo_atendimento_min': ultimo_min,
                'clinicas': clinicas
            })

        return jsonify({
            'success': True,
            'dados': resultado,
            'total': len(resultado)
        })

    except Exception as e:
        logger.error('Erro ao buscar medicos painel18: %s', str(e))
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500
    finally:
        if conn:
            conn.close()


# =============================================================================
# ENDPOINT: RANKING DE PRODUTIVIDADE DO DIA
# (com filtro de clinica - unico endpoint que filtra)
# =============================================================================

@painel18_bp.route('/api/paineis/painel18/ranking')
def api_painel18_ranking():
    """
    Ranking de todos os medicos que atenderam hoje, ordenados por volume.

    Inclui medicos que ja sairam (nao estao mais logados).
    Para cada medico:
      - total de atendimentos hoje
      - tempo medio de consulta (mediana)
      - clinica principal
      - status: logado ou nao

    NOTA: Este endpoint APLICA filtro de clinica quando informado.
    """
    conn = None
    try:
        conn = get_db_connection()
        cur = conn.cursor()
        filtro_clinica = _get_filtro_clinica(request.args)

        hoje = datetime.now().replace(hour=0, minute=0, second=0, microsecond=0)

        # Atendimentos do dia agrupados por medico
        filtro_sql = ""
        params = [hoje]
        if filtro_clinica:
            filtro_sql = " AND UPPER(clinica) = UPPER(%s)"
            params.append(filtro_clinica)

        cur.execute("""
            SELECT
                nm_medico,
                COUNT(*) as total_atendimentos,
                PERCENTILE_CONT(0.5) WITHIN GROUP (
                    ORDER BY EXTRACT(EPOCH FROM
                        (dt_fim_atendimento - dt_inicio_atendimento_med)) / 60.0
                ) as mediana_consulta,
                MODE() WITHIN GROUP (ORDER BY clinica) as clinica_principal,
                MAX(dt_inicio_atendimento_med) as ultimo_atendimento
            FROM painel17_atendimentos_ps
            WHERE dt_entrada >= %s
              AND dt_inicio_atendimento_med IS NOT NULL
              AND nm_medico IS NOT NULL
              AND nm_medico != ''
        """ + filtro_sql + """
            GROUP BY nm_medico
            ORDER BY total_atendimentos DESC
        """, params)

        colunas = [desc[0] for desc in cur.description]
        atendimentos = [dict(zip(colunas, row)) for row in cur.fetchall()]

        # Buscar medicos logados para marcar status
        cur.execute("SELECT UPPER(ds_usuario) as nome FROM medicos_ps")
        logados = set(row[0] for row in cur.fetchall() if row[0])

        resultado = []
        total_geral = 0
        for item in atendimentos:
            nome = item.get('nm_medico') or ''
            total = item.get('total_atendimentos') or 0
            total_geral += total
            mediana = item.get('mediana_consulta')
            # Filtrar medianas invalidas
            if mediana and (mediana < 1 or mediana > 300):
                mediana = None

            resultado.append({
                'nm_medico': nome,
                'total_atendimentos': total,
                'tempo_medio_consulta': round(mediana, 0) if mediana else None,
                'clinica_principal': item.get('clinica_principal'),
                'logado': nome.strip().upper() in logados,
                'ultimo_atendimento': item.get('ultimo_atendimento').strftime(
                    '%H:%M') if item.get('ultimo_atendimento') else None
            })

        cur.close()

        return jsonify({
            'success': True,
            'dados': resultado,
            'total_medicos': len(resultado),
            'total_atendimentos': total_geral
        })

    except Exception as e:
        logger.error('Erro ao buscar ranking painel18: %s', str(e))
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500
    finally:
        if conn:
            conn.close()


# =============================================================================
# ENDPOINT: ESTATISTICAS GERAIS
# (sem filtro de clinica - sempre mostra totais gerais)
# =============================================================================

@painel18_bp.route('/api/paineis/painel18/stats')
def api_painel18_stats():
    """
    Resumo geral para o dashboard:
      - medicos_ativos: logados nos consultorios
      - atendimentos_hoje: total geral
      - tempo_medio_geral: mediana geral de consulta
      - em_consulta_agora: pacientes em consulta ativa
      - aguardando_fila: pacientes esperando atendimento
      - consultorios_ocupados: consultorios com medico logado

    NOTA: Este endpoint NAO aplica filtro de clinica.
    As estatisticas gerais sempre refletem o PS inteiro.
    """
    conn = None
    try:
        conn = get_db_connection()
        cur = conn.cursor()

        hoje = datetime.now().replace(hour=0, minute=0, second=0, microsecond=0)
        threshold_dt = datetime.now() - timedelta(minutes=THRESHOLD_EM_CONSULTA_MIN)

        # Medicos logados
        cur.execute("SELECT COUNT(*) FROM medicos_ps")
        medicos_ativos = cur.fetchone()[0] or 0

        # Consultorios ocupados
        cur.execute("SELECT COUNT(DISTINCT nm_maq_cliente) FROM medicos_ps")
        consultorios_ocupados = cur.fetchone()[0] or 0

        # Atendimentos hoje
        cur.execute("""
            SELECT COUNT(*)
            FROM painel17_atendimentos_ps
            WHERE dt_entrada >= %s
              AND dt_inicio_atendimento_med IS NOT NULL
        """, [hoje])
        atend_hoje = cur.fetchone()[0] or 0

        # Tempo medio geral (mediana)
        cur.execute("""
            SELECT PERCENTILE_CONT(0.5) WITHIN GROUP (
                ORDER BY EXTRACT(EPOCH FROM
                    (dt_fim_atendimento - dt_inicio_atendimento_med)) / 60.0
            )
            FROM painel17_atendimentos_ps
            WHERE dt_entrada >= %s
              AND dt_inicio_atendimento_med IS NOT NULL
              AND dt_fim_atendimento IS NOT NULL
              AND dt_fim_atendimento > dt_inicio_atendimento_med
              AND EXTRACT(EPOCH FROM
                  (dt_fim_atendimento - dt_inicio_atendimento_med)) / 60.0
                  BETWEEN 1 AND 300
        """, [hoje])
        tempo_medio = cur.fetchone()[0]
        tempo_medio = round(tempo_medio, 0) if tempo_medio else None

        # Em consulta agora (inicio < 60 min, sem fim, sem alta)
        cur.execute("""
            SELECT COUNT(*)
            FROM painel17_atendimentos_ps
            WHERE dt_inicio_atendimento_med >= %s
              AND dt_fim_atendimento IS NULL
              AND dt_alta IS NULL
        """, [threshold_dt])
        em_consulta = cur.fetchone()[0] or 0

        # Aguardando na fila (tem entrada hoje, sem inicio de atend medico,
        # sem alta, nas ultimas 24h)
        cur.execute("""
            SELECT COUNT(*)
            FROM painel17_atendimentos_ps
            WHERE dt_entrada >= %s
              AND dt_inicio_atendimento_med IS NULL
              AND dt_alta IS NULL
        """, [hoje])
        aguardando = cur.fetchone()[0] or 0

        cur.close()

        return jsonify({
            'success': True,
            'stats': {
                'medicos_ativos': medicos_ativos,
                'consultorios_ocupados': consultorios_ocupados,
                'atendimentos_hoje': atend_hoje,
                'tempo_medio_geral': tempo_medio,
                'em_consulta_agora': em_consulta,
                'aguardando_fila': aguardando
            }
        })

    except Exception as e:
        logger.error('Erro ao buscar stats painel18: %s', str(e))
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500
    finally:
        if conn:
            conn.close()