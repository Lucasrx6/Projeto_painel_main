"""
Painel 38 - Score Farmaceutico Clinico
Monitoramento de score farmaceutico e visitas por paciente internado.
Priorizacao de visitas pela Farmacia Clinica.
"""
from flask import Blueprint, jsonify, request, send_from_directory, session, current_app
from datetime import datetime, date
from psycopg2.extras import RealDictCursor
from backend.database import get_db_connection, release_connection
from backend.middleware.decorators import login_required
from backend.user_management import verificar_permissao_painel

painel38_bp = Blueprint('painel38', __name__)

_VALID_CLASSIFICACAO = frozenset(['LEVE', 'MEDIO', 'CRITICO'])
_VALID_STATUS_VISITA = frozenset(['RECENTE', 'ATENCAO', 'ATRASADA', 'SEM_VISITA'])


# =========================================================
# HELPERS
# =========================================================

def _check_permissao():
    usuario_id = session.get('usuario_id')
    is_admin = session.get('is_admin', False)
    if is_admin:
        return True
    return verificar_permissao_painel(usuario_id, 'painel38')


def _build_common_filters(args):
    """Monta clausula WHERE + lista de params a partir dos query args."""
    conditions = []
    params = []

    setor_raw = args.get('setor', '').strip()
    if setor_raw:
        ids = [s.strip() for s in setor_raw.split(',') if s.strip().isdigit()]
        if ids:
            placeholders = ','.join(['%s'] * len(ids))
            conditions.append('cd_setor_atendimento IN ({})'.format(placeholders))
            params.extend(int(i) for i in ids)

    classif_raw = args.get('classificacao', '').strip()
    if classif_raw:
        codigos = [s.strip() for s in classif_raw.split(',') if s.strip() in _VALID_CLASSIFICACAO]
        if codigos:
            placeholders = ','.join(['%s'] * len(codigos))
            conditions.append('ie_classificacao IN ({})'.format(placeholders))
            params.extend(codigos)

    status_raw = args.get('status_visita', '').strip()
    if status_raw:
        codigos = [s.strip() for s in status_raw.split(',') if s.strip() in _VALID_STATUS_VISITA]
        if codigos:
            placeholders = ','.join(['%s'] * len(codigos))
            conditions.append('ie_status_visita IN ({})'.format(placeholders))
            params.extend(codigos)

    busca = args.get('busca', '').strip()
    if busca:
        conditions.append('UPPER(nm_paciente) LIKE UPPER(%s)')
        params.append('%%{}%%'.format(busca))

    pt_min = args.get('pt_min', '').strip()
    if pt_min and pt_min.isdigit():
        conditions.append('pt_total >= %s')
        params.append(int(pt_min))

    where = ('WHERE ' + ' AND '.join(conditions)) if conditions else ''
    return where, params


def _serializar_valor(valor):
    if isinstance(valor, (datetime, date)):
        return valor.isoformat()
    return valor


# =========================================================
# SERVIR HTML / ESTATICOS
# =========================================================

@painel38_bp.route('/painel/painel38')
@login_required
def painel38_home():
    if not _check_permissao():
        current_app.logger.warning(
            'Acesso negado ao painel38: {}'.format(session.get('usuario'))
        )
        return send_from_directory('frontend', 'acesso-negado.html')
    return send_from_directory('paineis/painel38', 'painel38.html')


@painel38_bp.route('/paineis/painel38/<path:filename>')
@login_required
def painel38_static(filename):
    return send_from_directory('paineis/painel38', filename)


# =========================================================
# API - FILTROS DINAMICOS
# =========================================================

@painel38_bp.route('/api/paineis/painel38/filtros', methods=['GET'])
@login_required
def api_painel38_filtros():
    if not _check_permissao():
        return jsonify({'success': False, 'error': 'Sem permissao'}), 403

    conn = get_db_connection()
    if not conn:
        return jsonify({'success': False, 'error': 'Erro de conexao'}), 500

    try:
        cursor = conn.cursor(cursor_factory=RealDictCursor)
        cursor.execute("""
            SELECT DISTINCT cd_setor_atendimento AS codigo, ds_setor_atendimento AS nome
            FROM painel_score_farmaceutico
            WHERE ds_setor_atendimento IS NOT NULL
            ORDER BY ds_setor_atendimento
        """)
        setores = [dict(r) for r in cursor.fetchall()]
        cursor.close()
        release_connection(conn)

        return jsonify({
            'success': True,
            'setores': setores,
            'classificacoes': [
                {'codigo': 'CRITICO', 'label': 'Crítico'},
                {'codigo': 'MEDIO',   'label': 'Médio'},
                {'codigo': 'LEVE',    'label': 'Leve'},
            ],
            'status_visita': [
                {'codigo': 'SEM_VISITA', 'label': 'Sem visita registrada'},
                {'codigo': 'ATRASADA',   'label': 'Atrasada (>3 dias)'},
                {'codigo': 'ATENCAO',    'label': 'Atenção (2-3 dias)'},
                {'codigo': 'RECENTE',    'label': 'Recente (≤1 dia)'},
            ]
        })
    except Exception as e:
        current_app.logger.error('Erro filtros painel38: {}'.format(e), exc_info=True)
        if conn:
            release_connection(conn)
        return jsonify({'success': False, 'error': 'Erro ao buscar filtros'}), 500


# =========================================================
# API - DASHBOARD (KPIs agregados)
# =========================================================

@painel38_bp.route('/api/paineis/painel38/dashboard', methods=['GET'])
@login_required
def api_painel38_dashboard():
    if not _check_permissao():
        return jsonify({'success': False, 'error': 'Sem permissao'}), 403

    conn = get_db_connection()
    if not conn:
        return jsonify({'success': False, 'error': 'Erro de conexao'}), 500

    try:
        cursor = conn.cursor(cursor_factory=RealDictCursor)
        where, params = _build_common_filters(request.args)

        sql = """
            SELECT
                COUNT(*)                                                            AS total_pacientes,
                COUNT(*) FILTER (WHERE ie_classificacao = 'LEVE')                  AS leve,
                COUNT(*) FILTER (WHERE ie_classificacao = 'MEDIO')                 AS medio,
                COUNT(*) FILTER (WHERE ie_classificacao = 'CRITICO')               AS critico,
                AVG(pt_total)::numeric(5,1)                                         AS score_medio,
                MAX(pt_total)                                                       AS score_max,
                COUNT(*) FILTER (WHERE ie_status_visita = 'SEM_VISITA')            AS sem_visita,
                COUNT(*) FILTER (WHERE ie_status_visita = 'ATRASADA')              AS atrasada,
                COUNT(*) FILTER (WHERE ie_status_visita = 'ATENCAO')               AS atencao,
                COUNT(*) FILTER (WHERE ie_status_visita = 'RECENTE')               AS recente,
                COUNT(*) FILTER (
                    WHERE ie_classificacao = 'CRITICO'
                      AND ie_status_visita IN ('ATRASADA', 'SEM_VISITA')
                )                                                                   AS criticos_sem_visita_recente,
                COALESCE(SUM(qt_visitas_30d), 0)                                   AS visitas_30d_total,
                MAX(dt_carga)                                                       AS dt_carga
            FROM painel_score_farmaceutico
            {where}
        """.format(where=where)

        cursor.execute(sql, params)
        row = cursor.fetchone()
        cursor.close()
        release_connection(conn)

        total = int(row['total_pacientes']) if row['total_pacientes'] else 0

        return jsonify({
            'success':                    True,
            'total_pacientes':            total,
            'leve':                       int(row['leve'])    if row['leve']    else 0,
            'medio':                      int(row['medio'])   if row['medio']   else 0,
            'critico':                    int(row['critico']) if row['critico'] else 0,
            'score_medio':                float(row['score_medio']) if row['score_medio'] else 0.0,
            'score_max':                  int(row['score_max']) if row['score_max'] else 0,
            'sem_visita':                 int(row['sem_visita'])  if row['sem_visita']  else 0,
            'atrasada':                   int(row['atrasada'])    if row['atrasada']    else 0,
            'atencao':                    int(row['atencao'])     if row['atencao']     else 0,
            'recente':                    int(row['recente'])     if row['recente']     else 0,
            'criticos_sem_visita_recente': int(row['criticos_sem_visita_recente']) if row['criticos_sem_visita_recente'] else 0,
            'visitas_30d_total':          int(row['visitas_30d_total']) if row['visitas_30d_total'] else 0,
            'dt_carga':                   row['dt_carga'].isoformat() if row['dt_carga'] else None,
        })
    except Exception as e:
        current_app.logger.error('Erro dashboard painel38: {}'.format(e), exc_info=True)
        if conn:
            release_connection(conn)
        return jsonify({'success': False, 'error': 'Erro ao buscar KPIs'}), 500


# =========================================================
# API - DADOS (lista de pacientes)
# =========================================================

@painel38_bp.route('/api/paineis/painel38/dados', methods=['GET'])
@login_required
def api_painel38_dados():
    if not _check_permissao():
        return jsonify({'success': False, 'error': 'Sem permissao'}), 403

    conn = get_db_connection()
    if not conn:
        return jsonify({'success': False, 'error': 'Erro de conexao'}), 500

    try:
        cursor = conn.cursor(cursor_factory=RealDictCursor)
        where, params = _build_common_filters(request.args)

        sql = """
            SELECT
                nr_atendimento,
                nm_paciente,
                EXTRACT(YEAR FROM AGE(dt_nascimento))::int  AS idade,
                ie_sexo,
                ds_setor_atendimento,
                cd_setor_atendimento,
                cd_unidade_basica,
                qt_dia_permanencia,
                nm_medico,
                ds_convenio,
                ds_clinica,
                pt_total,
                qt_criterios,
                ie_classificacao,
                ds_criterios,
                dt_ultima_visita,
                nm_farmaceutico,
                qt_visitas_30d,
                qt_dias_sem_visita,
                ie_status_visita
            FROM painel_score_farmaceutico
            {where}
            ORDER BY
                CASE
                    WHEN ie_classificacao = 'CRITICO' AND ie_status_visita IN ('ATRASADA','SEM_VISITA') THEN 1
                    WHEN ie_classificacao = 'CRITICO'                                                    THEN 2
                    WHEN ie_classificacao = 'MEDIO'   AND ie_status_visita IN ('ATRASADA','SEM_VISITA') THEN 3
                    WHEN ie_classificacao = 'MEDIO'                                                      THEN 4
                    ELSE 5
                END,
                pt_total DESC,
                qt_dias_sem_visita DESC NULLS FIRST,
                nm_paciente
        """.format(where=where)

        cursor.execute(sql, params)
        rows = cursor.fetchall()
        cursor.close()
        release_connection(conn)

        pacientes = []
        for r in rows:
            p = {}
            for k, v in r.items():
                p[k] = _serializar_valor(v)
            pacientes.append(p)

        return jsonify({'success': True, 'pacientes': pacientes, 'total': len(pacientes)})

    except Exception as e:
        current_app.logger.error('Erro dados painel38: {}'.format(e), exc_info=True)
        if conn:
            release_connection(conn)
        return jsonify({'success': False, 'error': 'Erro ao buscar dados'}), 500
