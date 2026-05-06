"""
Painel 39 - Interacoes Medicamentosas Ativas
Endpoints para a aba Dieta (farmaco x dieta) e placeholder da aba Medicamento
"""
from flask import Blueprint, jsonify, send_from_directory, request, session, current_app
from psycopg2.extras import RealDictCursor
from backend.database import get_db_connection, release_connection
from backend.middleware.decorators import login_required
from backend.user_management import verificar_permissao_painel
from datetime import datetime

painel39_bp = Blueprint('painel39', __name__)


def _check_acesso():
    """Retorna True se o usuario logado tem acesso ao painel39."""
    usuario_id = session.get('usuario_id')
    is_admin = session.get('is_admin', False)
    return is_admin or verificar_permissao_painel(usuario_id, 'painel39')


def _build_common_filters_dieta(args):
    """
    Constroi cláusula WHERE + params compartilhados por todos os endpoints /dieta/*.
    Retorna (where_sql, params) onde where_sql começa com 'WHERE ...' ou '' se sem filtros.
    """
    condicoes = []
    params = []

    setor = args.get('setor', '').strip()
    if setor:
        ids = [s.strip() for s in setor.split(',') if s.strip()]
        if ids:
            placeholders = ','.join(['%s'] * len(ids))
            condicoes.append('cd_setor_atendimento IN (' + placeholders + ')')
            params.extend(ids)

    material = args.get('material', '').strip()
    if material:
        ids = [s.strip() for s in material.split(',') if s.strip()]
        if ids:
            placeholders = ','.join(['%s'] * len(ids))
            condicoes.append('cd_material IN (' + placeholders + ')')
            params.extend(ids)

    dieta = args.get('dieta', '').strip()
    if dieta:
        ids = [s.strip() for s in dieta.split(',') if s.strip()]
        if ids:
            placeholders = ','.join(['%s'] * len(ids))
            condicoes.append('cd_dieta IN (' + placeholders + ')')
            params.extend(ids)

    busca = args.get('busca', '').strip()
    if busca:
        condicoes.append(
            "(UPPER(nm_pessoa_fisica) LIKE UPPER(%s) OR nr_atendimento::TEXT = %s)"
        )
        params.append('%' + busca + '%')
        params.append(busca)

    where_sql = ('WHERE ' + ' AND '.join(condicoes)) if condicoes else ''
    return where_sql, params


# =========================================================
# ROTA HTML
# =========================================================

@painel39_bp.route('/painel/painel39')
@login_required
def painel39():
    if not _check_acesso():
        current_app.logger.warning('Acesso negado ao painel39: %s', session.get('usuario'))
        return send_from_directory('frontend', 'acesso-negado.html')
    return send_from_directory('paineis/painel39', 'index.html')


@painel39_bp.route('/paineis/painel39/<path:filename>')
@login_required
def painel39_static(filename):
    if not _check_acesso():
        return jsonify({'error': 'Sem permissao'}), 403
    return send_from_directory('paineis/painel39', filename)


# =========================================================
# API - KPIs (ABA DIETA)
# =========================================================

@painel39_bp.route('/api/paineis/painel39/dieta/dashboard', methods=['GET'])
@login_required
def api_p39_dieta_dashboard():
    if not _check_acesso():
        return jsonify({'success': False, 'error': 'Sem permissao'}), 403

    where_sql, params = _build_common_filters_dieta(request.args)

    conn = get_db_connection()
    if not conn:
        return jsonify({'success': False, 'error': 'Erro de conexao'}), 500

    try:
        cursor = conn.cursor(cursor_factory=RealDictCursor)

        cursor.execute("""
            SELECT
                COUNT(*)                              AS total_interacoes,
                COUNT(DISTINCT nr_atendimento)        AS total_pacientes,
                COUNT(DISTINCT cd_material)           AS total_medicamentos,
                COUNT(DISTINCT cd_setor_atendimento)  AS total_setores,
                MAX(dt_carga)                         AS ultima_carga
            FROM painel39_interacoes_dieta
            """ + where_sql, params)
        kpis = dict(cursor.fetchone() or {})

        if kpis.get('ultima_carga') and isinstance(kpis['ultima_carga'], datetime):
            kpis['ultima_carga'] = kpis['ultima_carga'].isoformat()

        cursor.execute("""
            SELECT cd_material, ds_material, COUNT(*) AS qtd
            FROM painel39_interacoes_dieta
            """ + where_sql + """
            GROUP BY cd_material, ds_material
            ORDER BY qtd DESC
            LIMIT 10
        """, params)
        top_medicamentos = [dict(r) for r in cursor.fetchall()]

        cursor.execute("""
            SELECT cd_setor_atendimento AS cd_setor, ds_setor, COUNT(*) AS qtd
            FROM painel39_interacoes_dieta
            """ + where_sql + """
            GROUP BY cd_setor_atendimento, ds_setor
            ORDER BY qtd DESC
        """, params)
        por_setor = [dict(r) for r in cursor.fetchall()]

        cursor.close()
        release_connection(conn)
        return jsonify({
            'success': True,
            'total_interacoes': kpis.get('total_interacoes', 0),
            'total_pacientes': kpis.get('total_pacientes', 0),
            'total_medicamentos': kpis.get('total_medicamentos', 0),
            'total_setores': kpis.get('total_setores', 0),
            'top_medicamentos': top_medicamentos,
            'por_setor': por_setor,
            'ultima_carga': kpis.get('ultima_carga')
        })

    except Exception as e:
        current_app.logger.error('Erro dashboard painel39: %s', e, exc_info=True)
        if conn:
            release_connection(conn)
        return jsonify({'success': False, 'error': 'Erro ao buscar dados'}), 500


# =========================================================
# API - TABELA COMPLETA (ABA DIETA)
# =========================================================

@painel39_bp.route('/api/paineis/painel39/dieta/dados', methods=['GET'])
@login_required
def api_p39_dieta_dados():
    if not _check_acesso():
        return jsonify({'success': False, 'error': 'Sem permissao'}), 403

    where_sql, params = _build_common_filters_dieta(request.args)

    conn = get_db_connection()
    if not conn:
        return jsonify({'success': False, 'error': 'Erro de conexao'}), 500

    try:
        cursor = conn.cursor(cursor_factory=RealDictCursor)

        cursor.execute("""
            SELECT
                *,
                CASE
                    WHEN dt_nascimento IS NOT NULL
                    THEN DATE_PART('year', AGE(dt_nascimento))::INT
                END AS idade
            FROM painel39_interacoes_dieta
            """ + where_sql + """
            ORDER BY cd_setor_atendimento ASC, nr_atendimento ASC, ds_material ASC
        """, params)

        dados = []
        for row in cursor.fetchall():
            r = dict(row)
            for campo in ['dt_nascimento', 'dt_prescricao', 'dt_carga']:
                if r.get(campo) and isinstance(r[campo], datetime):
                    r[campo] = r[campo].isoformat()
            dados.append(r)

        cursor.close()
        release_connection(conn)
        return jsonify({'success': True, 'dados': dados})

    except Exception as e:
        current_app.logger.error('Erro dados painel39: %s', e, exc_info=True)
        if conn:
            release_connection(conn)
        return jsonify({'success': False, 'error': 'Erro ao buscar dados'}), 500


# =========================================================
# API - FILTROS DINAMICOS (ABA DIETA)
# =========================================================

@painel39_bp.route('/api/paineis/painel39/dieta/filtros', methods=['GET'])
@login_required
def api_p39_dieta_filtros():
    if not _check_acesso():
        return jsonify({'success': False, 'error': 'Sem permissao'}), 403

    conn = get_db_connection()
    if not conn:
        return jsonify({'success': False, 'error': 'Erro de conexao'}), 500

    try:
        cursor = conn.cursor(cursor_factory=RealDictCursor)

        cursor.execute("""
            SELECT DISTINCT cd_setor_atendimento AS id, ds_setor AS nome
            FROM painel39_interacoes_dieta
            WHERE ds_setor IS NOT NULL
            ORDER BY nome
        """)
        setores = [dict(r) for r in cursor.fetchall()]

        cursor.execute("""
            SELECT DISTINCT cd_material AS id, ds_material AS nome
            FROM painel39_interacoes_dieta
            WHERE ds_material IS NOT NULL
            ORDER BY nome
        """)
        medicamentos = [dict(r) for r in cursor.fetchall()]

        cursor.execute("""
            SELECT DISTINCT cd_dieta AS id, dieta AS nome
            FROM painel39_interacoes_dieta
            WHERE dieta IS NOT NULL
            ORDER BY nome
        """)
        dietas = [dict(r) for r in cursor.fetchall()]

        cursor.close()
        release_connection(conn)
        return jsonify({
            'success': True,
            'setores': setores,
            'medicamentos': medicamentos,
            'dietas': dietas
        })

    except Exception as e:
        current_app.logger.error('Erro filtros painel39: %s', e, exc_info=True)
        if conn:
            release_connection(conn)
        return jsonify({'success': False, 'error': 'Erro ao buscar filtros'}), 500
