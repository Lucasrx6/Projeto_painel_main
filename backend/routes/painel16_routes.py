"""
Painel 16 - Desempenho da Recepcao
Endpoints para monitoramento de atendentes e atendimentos da recepcao
"""
from flask import Blueprint, jsonify, send_from_directory, request, session, current_app
from datetime import datetime
from psycopg2.extras import RealDictCursor
from backend.database import get_db_connection
from backend.middleware.decorators import login_required
from backend.user_management import verificar_permissao_painel

# Cria o Blueprint
painel16_bp = Blueprint('painel16', __name__)

# =============================================================================
# MAPEAMENTO DE SETORES
# =============================================================================
# Maquinas: setor derivado do NM_MAQ_CLIENTE (FB-D-PS-*, FB-D-AMB-*, FB-D-RAD-*)
# Atendimentos: cd_tipo_atendimento
#   3 = Pronto Socorro    -> setor PS
#   8 = Atend Ambulatorial -> setor AMB
#   7 = Externo           -> setor RAD (Radiologia)
# =============================================================================

SETOR_PARA_TIPOS = {
    'PS': [3],
    'AMB': [8],
    'RAD': [7]
}


def _build_turno_filter(turno, prefix=''):
    """Retorna clausula WHERE e params para filtro de turno"""
    col = prefix + 'dt_entrada' if not prefix else prefix + '.dt_entrada'
    if turno == 'diurno':
        return f"EXTRACT(HOUR FROM {col}) >= 7 AND EXTRACT(HOUR FROM {col}) < 19", []
    elif turno == 'noturno':
        return f"(EXTRACT(HOUR FROM {col}) < 7 OR EXTRACT(HOUR FROM {col}) >= 19)", []
    return None, []


# =========================================================
# ROTAS DE PAGINA HTML
# =========================================================

@painel16_bp.route('/painel/painel16')
@login_required
def painel16():
    """Pagina principal do Painel 16"""
    usuario_id = session.get('usuario_id')
    is_admin = session.get('is_admin', False)

    if not is_admin:
        if not verificar_permissao_painel(usuario_id, 'painel16'):
            current_app.logger.warning(f'Acesso negado ao painel16: {session.get("usuario")}')
            return send_from_directory('frontend', 'acesso-negado.html')

    return send_from_directory('paineis/painel16', 'index.html')


# =========================================================
# ROTAS DE API
# =========================================================

@painel16_bp.route('/api/paineis/painel16/maquinas', methods=['GET'])
@login_required
def api_painel16_maquinas():
    """
    Retorna usuarios conectados nas maquinas de recepcao com contagem de atendimentos
    GET /api/paineis/painel16/maquinas?setor=...&turno=...
    """
    usuario_id = session.get('usuario_id')
    is_admin = session.get('is_admin', False)

    if not is_admin:
        if not verificar_permissao_painel(usuario_id, 'painel16'):
            return jsonify({
                'success': False,
                'error': 'Sem permissao para acessar este painel'
            }), 403

    conn = get_db_connection()
    if not conn:
        return jsonify({
            'success': False,
            'error': 'Erro de conexao com o banco'
        }), 500

    try:
        cursor = conn.cursor(cursor_factory=RealDictCursor)

        setor = request.args.get('setor', None)
        turno = request.args.get('turno', None)

        # Monta filtro de turno para subquery de atendimentos
        turno_where = ""
        if turno in ('diurno', 'noturno'):
            turno_clause, _ = _build_turno_filter(turno, 'a')
            turno_where = f"AND {turno_clause}"

        # Query com LEFT JOIN para contar atendimentos por usuario conectado
        base_query = f"""
            SELECT
                m.nm_usuario,
                m.nm_maq_cliente,
                m.consultorio,
                m.ds_usuario,
                m.especialidade,
                m.machine,
                m.logon_time,
                m.tempo_conectado,
                m.setor,
                CASE
                    WHEN UPPER(m.nm_maq_cliente) LIKE '%%FB-D-PS-%%' THEN 'PS'
                    WHEN UPPER(m.nm_maq_cliente) LIKE '%%FB-D-AMB-%%' THEN 'AMB'
                    WHEN UPPER(m.nm_maq_cliente) LIKE '%%FB-D-RAD-%%' THEN 'RAD'
                    ELSE UPPER(COALESCE(m.setor, ''))
                END AS setor_calc,
                COALESCE(atend.total, 0) AS total_atendimentos
            FROM painel16_maquinas_recepcao m
            LEFT JOIN (
                SELECT usuario, COUNT(*) AS total
                FROM painel16_atendimentos_dia a
                WHERE 1=1 {turno_where}
                GROUP BY usuario
            ) atend ON LOWER(m.nm_usuario) = LOWER(atend.usuario)
        """

        if setor:
            query = f"""
                SELECT * FROM ({base_query}) sub
                WHERE setor_calc = %s
                ORDER BY nm_maq_cliente
            """
            cursor.execute(query, (setor.upper(),))
        else:
            query = f"""
                SELECT * FROM ({base_query}) sub
                ORDER BY setor_calc, nm_maq_cliente
            """
            cursor.execute(query)

        registros = cursor.fetchall()

        for reg in registros:
            if reg.get('logon_time'):
                reg['logon_time'] = reg['logon_time'].strftime('%d/%m/%Y %H:%M')
            reg['setor'] = reg.get('setor_calc', reg.get('setor', ''))

        cursor.close()
        conn.close()

        return jsonify({
            'success': True,
            'dados': registros,
            'total': len(registros),
            'timestamp': datetime.now().isoformat()
        })

    except Exception as e:
        current_app.logger.error(f'Erro ao buscar maquinas do painel16: {e}', exc_info=True)
        if conn:
            conn.close()
        return jsonify({
            'success': False,
            'error': 'Erro ao buscar dados'
        }), 500


@painel16_bp.route('/api/paineis/painel16/atendimentos', methods=['GET'])
@login_required
def api_painel16_atendimentos():
    """
    Retorna contagem de atendimentos por recepcionista no dia
    GET /api/paineis/painel16/atendimentos?setor=...&turno=...
    Query params:
    - setor: PS (tipo 3), AMB (tipo 8), RAD (tipo 7) - opcional
    - turno: diurno, noturno - opcional (padrao: ambos)
    """
    usuario_id = session.get('usuario_id')
    is_admin = session.get('is_admin', False)

    if not is_admin:
        if not verificar_permissao_painel(usuario_id, 'painel16'):
            return jsonify({
                'success': False,
                'error': 'Sem permissao para acessar este painel'
            }), 403

    conn = get_db_connection()
    if not conn:
        return jsonify({
            'success': False,
            'error': 'Erro de conexao com o banco'
        }), 500

    try:
        cursor = conn.cursor(cursor_factory=RealDictCursor)

        setor = request.args.get('setor', None)
        turno = request.args.get('turno', None)

        # Monta clausulas WHERE
        conditions = []
        params = []

        if setor and setor in SETOR_PARA_TIPOS:
            tipos = SETOR_PARA_TIPOS[setor]
            placeholders = ', '.join(['%s'] * len(tipos))
            conditions.append(f"cd_tipo_atendimento IN ({placeholders})")
            params.extend(tipos)

        if turno in ('diurno', 'noturno'):
            turno_clause, _ = _build_turno_filter(turno)
            conditions.append(turno_clause)

        filtro_where = ""
        if conditions:
            filtro_where = "WHERE " + " AND ".join(conditions)

        query = f"""
            SELECT
                usuario,
                usuario_atendimento,
                COUNT(*) AS total_atendimentos,
                MODE() WITHIN GROUP (ORDER BY
                    CASE cd_tipo_atendimento
                        WHEN 3 THEN 'Pronto Socorro'
                        WHEN 8 THEN 'Ambulatorio'
                        WHEN 7 THEN 'Radiologia'
                        ELSE ds_tipo_atendimento
                    END
                ) AS setor_principal,
                COUNT(*) FILTER (
                    WHERE EXTRACT(HOUR FROM dt_entrada) >= 7
                      AND EXTRACT(HOUR FROM dt_entrada) < 19
                ) AS atend_diurno,
                COUNT(*) FILTER (
                    WHERE EXTRACT(HOUR FROM dt_entrada) < 7
                       OR EXTRACT(HOUR FROM dt_entrada) >= 19
                ) AS atend_noturno
            FROM painel16_atendimentos_dia
            {filtro_where}
            GROUP BY usuario, usuario_atendimento
            ORDER BY total_atendimentos DESC
        """
        cursor.execute(query, params)
        registros = cursor.fetchall()

        total_geral = 0
        for reg in registros:
            diurno = reg.get('atend_diurno', 0) or 0
            noturno = reg.get('atend_noturno', 0) or 0
            total_geral += reg.get('total_atendimentos', 0) or 0

            if noturno > diurno:
                reg['turno'] = 'Noturno'
            elif diurno > noturno:
                reg['turno'] = 'Diurno'
            else:
                reg['turno'] = 'Ambos'

        cursor.close()
        conn.close()

        return jsonify({
            'success': True,
            'dados': registros,
            'total_recepcionistas': len(registros),
            'total_atendimentos': total_geral,
            'timestamp': datetime.now().isoformat()
        })

    except Exception as e:
        current_app.logger.error(f'Erro ao buscar atendimentos do painel16: {e}', exc_info=True)
        if conn:
            conn.close()
        return jsonify({
            'success': False,
            'error': 'Erro ao buscar dados'
        }), 500


@painel16_bp.route('/api/paineis/painel16/stats', methods=['GET'])
@login_required
def api_painel16_stats():
    """
    Retorna estatisticas gerais do painel
    GET /api/paineis/painel16/stats?setor=...&turno=...
    """
    usuario_id = session.get('usuario_id')
    is_admin = session.get('is_admin', False)

    if not is_admin:
        if not verificar_permissao_painel(usuario_id, 'painel16'):
            return jsonify({
                'success': False,
                'error': 'Sem permissao para acessar este painel'
            }), 403

    conn = get_db_connection()
    if not conn:
        return jsonify({
            'success': False,
            'error': 'Erro de conexao com o banco'
        }), 500

    try:
        cursor = conn.cursor(cursor_factory=RealDictCursor)

        setor = request.args.get('setor', None)
        turno = request.args.get('turno', None)

        # Guiches conectados
        if setor:
            cursor.execute("""
                SELECT COUNT(*) AS total_conectados
                FROM painel16_maquinas_recepcao
                WHERE CASE
                    WHEN UPPER(nm_maq_cliente) LIKE '%%FB-D-PS-%%' THEN 'PS'
                    WHEN UPPER(nm_maq_cliente) LIKE '%%FB-D-AMB-%%' THEN 'AMB'
                    WHEN UPPER(nm_maq_cliente) LIKE '%%FB-D-RAD-%%' THEN 'RAD'
                    ELSE UPPER(COALESCE(setor, ''))
                END = %s
            """, (setor.upper(),))
        else:
            cursor.execute("""
                SELECT COUNT(*) AS total_conectados
                FROM painel16_maquinas_recepcao
            """)
        stats_maquinas = cursor.fetchone()

        # Atendimentos com filtro de setor e turno
        conditions = []
        params = []

        if setor and setor in SETOR_PARA_TIPOS:
            tipos = SETOR_PARA_TIPOS[setor]
            placeholders = ', '.join(['%s'] * len(tipos))
            conditions.append(f"cd_tipo_atendimento IN ({placeholders})")
            params.extend(tipos)

        if turno in ('diurno', 'noturno'):
            turno_clause, _ = _build_turno_filter(turno)
            conditions.append(turno_clause)

        filtro_where = ""
        if conditions:
            filtro_where = "WHERE " + " AND ".join(conditions)

        cursor.execute(f"""
            SELECT
                COUNT(*) AS total_atendimentos,
                COUNT(DISTINCT usuario) AS total_recepcionistas,
                COUNT(*) FILTER (WHERE cd_tipo_atendimento = 3) AS atend_ps,
                COUNT(*) FILTER (WHERE cd_tipo_atendimento = 8) AS atend_ambulatorial,
                COUNT(*) FILTER (WHERE cd_tipo_atendimento = 7) AS atend_externo
            FROM painel16_atendimentos_dia
            {filtro_where}
        """, params)
        stats_atendimentos = cursor.fetchone()

        cursor.close()
        conn.close()

        return jsonify({
            'success': True,
            'stats': {
                'total_conectados': stats_maquinas['total_conectados'] if stats_maquinas else 0,
                'total_atendimentos': stats_atendimentos['total_atendimentos'] if stats_atendimentos else 0,
                'total_recepcionistas': stats_atendimentos['total_recepcionistas'] if stats_atendimentos else 0,
                'atend_ps': stats_atendimentos['atend_ps'] if stats_atendimentos else 0,
                'atend_ambulatorial': stats_atendimentos['atend_ambulatorial'] if stats_atendimentos else 0,
                'atend_externo': stats_atendimentos['atend_externo'] if stats_atendimentos else 0
            },
            'timestamp': datetime.now().isoformat()
        })

    except Exception as e:
        current_app.logger.error(f'Erro ao buscar stats do painel16: {e}', exc_info=True)
        if conn:
            conn.close()
        return jsonify({
            'success': False,
            'error': 'Erro ao buscar dados'
        }), 500