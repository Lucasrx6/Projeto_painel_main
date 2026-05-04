"""
Painel 37 - Plano Terapeutico de Enfermagem
Monitoramento de avaliacoes 1633 (plano terapeutico) por paciente internado.
"""
from flask import Blueprint, jsonify, request, send_from_directory, session, current_app
from datetime import datetime, date
from psycopg2.extras import RealDictCursor
from backend.database import get_db_connection, release_connection
from backend.middleware.decorators import login_required
from backend.user_management import verificar_permissao_painel

painel37_bp = Blueprint('painel37', __name__)

_VALID_STATUS = frozenset(['SEM_AVALIACAO', 'SEM_PRAZO', 'VENCIDO', 'PROXIMO', 'NO_PRAZO'])


# =========================================================
# HELPERS
# =========================================================

def _check_permissao():
    usuario_id = session.get('usuario_id')
    is_admin = session.get('is_admin', False)
    if is_admin:
        return True
    return verificar_permissao_painel(usuario_id, 'painel37')


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

    status_raw = args.get('status_prazo', '').strip()
    if status_raw:
        codigos = [s.strip() for s in status_raw.split(',') if s.strip() in _VALID_STATUS]
        if codigos:
            placeholders = ','.join(['%s'] * len(codigos))
            conditions.append('ie_status_prazo IN ({})'.format(placeholders))
            params.extend(codigos)

    busca = args.get('busca', '').strip()
    if busca:
        conditions.append('UPPER(nm_pessoa_fisica) LIKE UPPER(%s)')
        params.append('%{}%'.format(busca))

    where = ('WHERE ' + ' AND '.join(conditions)) if conditions else ''
    return where, params


def _serializar_valor(valor):
    if isinstance(valor, (datetime, date)):
        return valor.isoformat()
    return valor


# =========================================================
# SERVIR HTML / ESTATICOS
# =========================================================

@painel37_bp.route('/painel/painel37')
@login_required
def painel37_home():
    if not _check_permissao():
        current_app.logger.warning(
            'Acesso negado ao painel37: {}'.format(session.get('usuario'))
        )
        return send_from_directory('frontend', 'acesso-negado.html')
    return send_from_directory('paineis/painel37', 'painel37.html')


@painel37_bp.route('/paineis/painel37/<path:filename>')
@login_required
def painel37_static(filename):
    return send_from_directory('paineis/painel37', filename)


# =========================================================
# API - FILTROS DINAMICOS
# =========================================================

@painel37_bp.route('/api/paineis/painel37/filtros', methods=['GET'])
@login_required
def api_painel37_filtros():
    if not _check_permissao():
        return jsonify({'success': False, 'error': 'Sem permissao'}), 403

    conn = get_db_connection()
    if not conn:
        return jsonify({'success': False, 'error': 'Erro de conexao'}), 500

    try:
        cursor = conn.cursor(cursor_factory=RealDictCursor)
        cursor.execute("""
            SELECT DISTINCT cd_setor_atendimento AS codigo, ds_setor AS nome
            FROM painel_plano_terapeutico_enfermagem
            WHERE ds_setor IS NOT NULL
            ORDER BY ds_setor
        """)
        setores = [dict(r) for r in cursor.fetchall()]
        cursor.close()
        release_connection(conn)

        return jsonify({
            'success': True,
            'setores': setores,
            'status_prazo': [
                {'codigo': 'VENCIDO',      'label': 'Vencido'},
                {'codigo': 'PROXIMO',      'label': 'Proximo do vencimento'},
                {'codigo': 'NO_PRAZO',     'label': 'No prazo'},
                {'codigo': 'SEM_PRAZO',    'label': 'Sem prazo definido'},
                {'codigo': 'SEM_AVALIACAO','label': 'Sem avaliacao'},
            ]
        })
    except Exception as e:
        current_app.logger.error('Erro filtros painel37: {}'.format(e), exc_info=True)
        if conn:
            release_connection(conn)
        return jsonify({'success': False, 'error': 'Erro ao buscar filtros'}), 500


# =========================================================
# API - DASHBOARD (KPIs agregados)
# =========================================================

@painel37_bp.route('/api/paineis/painel37/dashboard', methods=['GET'])
@login_required
def api_painel37_dashboard():
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
                COUNT(*)                                                     AS total_pacientes,
                COUNT(*) FILTER (WHERE ie_status_prazo = 'SEM_AVALIACAO')   AS sem_avaliacao,
                COUNT(*) FILTER (WHERE ie_status_prazo = 'VENCIDO')         AS vencido,
                COUNT(*) FILTER (WHERE ie_status_prazo = 'PROXIMO')         AS proximo,
                COUNT(*) FILTER (WHERE ie_status_prazo = 'NO_PRAZO')        AS no_prazo,
                COUNT(*) FILTER (WHERE ie_status_prazo = 'SEM_PRAZO')       AS sem_prazo,
                MAX(dt_carga)                                                AS dt_carga
            FROM painel_plano_terapeutico_enfermagem
            {where}
        """.format(where=where)

        cursor.execute(sql, params)
        row = cursor.fetchone()
        cursor.close()
        release_connection(conn)

        total   = int(row['total_pacientes']) if row['total_pacientes'] else 0
        vencido = int(row['vencido'])         if row['vencido']         else 0
        no_prazo = int(row['no_prazo'])       if row['no_prazo']        else 0

        return jsonify({
            'success':            True,
            'total_pacientes':    total,
            'sem_avaliacao':      int(row['sem_avaliacao']) if row['sem_avaliacao'] else 0,
            'vencido':            vencido,
            'proximo':            int(row['proximo'])       if row['proximo']       else 0,
            'no_prazo':           no_prazo,
            'sem_prazo':          int(row['sem_prazo'])     if row['sem_prazo']     else 0,
            'percentual_vencido': round(vencido  / total * 100, 1) if total else 0.0,
            'percentual_no_prazo': round(no_prazo / total * 100, 1) if total else 0.0,
            'dt_carga': row['dt_carga'].isoformat() if row['dt_carga'] else None,
        })
    except Exception as e:
        current_app.logger.error('Erro dashboard painel37: {}'.format(e), exc_info=True)
        if conn:
            release_connection(conn)
        return jsonify({'success': False, 'error': 'Erro ao buscar KPIs'}), 500


# =========================================================
# API - DADOS (lista de pacientes)
# =========================================================

@painel37_bp.route('/api/paineis/painel37/dados', methods=['GET'])
@login_required
def api_painel37_dados():
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
                nm_pessoa_fisica,
                EXTRACT(YEAR FROM AGE(dt_nascimento))::int  AS idade,
                ie_sexo,
                ds_setor,
                cd_unidade_basica,
                dt_entrada_unid,
                qt_dia_permanencia,
                nm_medico,
                ds_convenio,
                ds_clinica,
                ie_status_prazo,
                ds_meta,
                dt_prazo,
                ds_prazo_str,
                (dt_prazo - CURRENT_DATE)::int              AS dias_para_prazo,
                dt_avaliacao,
                nm_usuario_aval,
                cd_setor_atendimento
            FROM painel_plano_terapeutico_enfermagem
            {where}
            ORDER BY
                CASE ie_status_prazo
                    WHEN 'VENCIDO'       THEN 1
                    WHEN 'PROXIMO'       THEN 2
                    WHEN 'SEM_AVALIACAO' THEN 3
                    WHEN 'SEM_PRAZO'     THEN 4
                    WHEN 'NO_PRAZO'      THEN 5
                END,
                cd_setor_atendimento,
                nm_pessoa_fisica
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
        current_app.logger.error('Erro dados painel37: {}'.format(e), exc_info=True)
        if conn:
            release_connection(conn)
        return jsonify({'success': False, 'error': 'Erro ao buscar dados'}), 500
