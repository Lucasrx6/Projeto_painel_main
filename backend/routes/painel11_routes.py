"""
Painel 11 - Monitoramento de Alta do PS
Endpoints para acompanhamento de pacientes com alta para internação
"""
from flask import Blueprint, jsonify, send_from_directory, request, session, current_app
from datetime import datetime
from psycopg2.extras import RealDictCursor
from backend.database import get_db_connection
from backend.middleware.decorators import login_required
from backend.user_management import verificar_permissao_painel

# Cria o Blueprint
painel11_bp = Blueprint('painel11', __name__)


# =========================================================
# ROTAS DE PÁGINA HTML
# =========================================================

@painel11_bp.route('/painel/painel11')
@login_required
def painel11():
    """Página principal do Painel 11"""
    usuario_id = session.get('usuario_id')
    is_admin = session.get('is_admin', False)

    if not is_admin:
        if not verificar_permissao_painel(usuario_id, 'painel11'):
            current_app.logger.warning(f'Acesso negado ao painel11: {session.get("usuario")}')
            return send_from_directory('frontend', 'acesso-negado.html')

    return send_from_directory('paineis/painel11', 'index.html')


# =========================================================
# ROTAS DE API
# =========================================================

@painel11_bp.route('/api/paineis/painel11/dashboard', methods=['GET'])
@login_required
def api_painel11_dashboard():
    """
    Dashboard geral - estatísticas do dia
    GET /api/paineis/painel11/dashboard
    """
    usuario_id = session.get('usuario_id')
    is_admin = session.get('is_admin', False)

    if not is_admin:
        if not verificar_permissao_painel(usuario_id, 'painel11'):
            return jsonify({
                'success': False,
                'error': 'Sem permissão para acessar este painel'
            }), 403

    conn = get_db_connection()
    if not conn:
        return jsonify({
            'success': False,
            'error': 'Erro de conexão com o banco'
        }), 500

    try:
        cursor = conn.cursor(cursor_factory=RealDictCursor)

        query = """
            SELECT 
                COUNT(*) AS total_altas,
                COUNT(*) FILTER (WHERE status_internacao = 'AGUARDANDO_VAGA') AS total_aguardando,
                COUNT(*) FILTER (WHERE status_internacao = 'INTERNADO') AS total_internados,
                COUNT(*) FILTER (
                    WHERE status_internacao = 'AGUARDANDO_VAGA' 
                    AND minutos_aguardando >= 240
                ) AS total_criticos,
                CASE 
                    WHEN COUNT(*) FILTER (WHERE status_internacao = 'AGUARDANDO_VAGA') > 0 THEN
                        CONCAT(
                            FLOOR(AVG(minutos_aguardando) FILTER (WHERE status_internacao = 'AGUARDANDO_VAGA') / 60), 'h ',
                            FLOOR(AVG(minutos_aguardando) FILTER (WHERE status_internacao = 'AGUARDANDO_VAGA') % 60), 'm'
                        )
                    ELSE '-'
                END AS tempo_medio_espera
            FROM vw_painel_ps_alta_internacao
        """

        cursor.execute(query)
        resultado = cursor.fetchone()
        cursor.close()
        conn.close()

        if not resultado:
            dados = {
                'total_altas': 0,
                'total_aguardando': 0,
                'total_internados': 0,
                'tempo_medio_espera': '-',
                'total_criticos': 0
            }
        else:
            dados = dict(resultado)

        return jsonify({
            'success': True,
            'data': dados,
            'timestamp': datetime.now().isoformat()
        })

    except Exception as e:
        current_app.logger.error(f'Erro ao buscar dashboard painel11: {e}', exc_info=True)
        if conn:
            conn.close()
        return jsonify({
            'success': False,
            'error': 'Erro ao buscar dados'
        }), 500


@painel11_bp.route('/api/paineis/painel11/lista', methods=['GET'])
@login_required
def api_painel11_lista():
    """
    Lista de pacientes com alta para internação
    GET /api/paineis/painel11/lista?status=AGUARDANDO_VAGA
    """
    usuario_id = session.get('usuario_id')
    is_admin = session.get('is_admin', False)

    if not is_admin:
        if not verificar_permissao_painel(usuario_id, 'painel11'):
            return jsonify({
                'success': False,
                'error': 'Sem permissão para acessar este painel'
            }), 403

    conn = get_db_connection()
    if not conn:
        return jsonify({
            'success': False,
            'error': 'Erro de conexão com o banco'
        }), 500

    try:
        cursor = conn.cursor(cursor_factory=RealDictCursor)

        # Filtro por status (opcional)
        status_filtro = request.args.get('status', None)

        if status_filtro:
            query = """
                SELECT 
                    nr_atendimento,
                    nm_pessoa_fisica,
                    qt_idade,
                    ds_convenio,
                    ds_clinica,
                    dt_alta,
                    ds_necessidade_vaga,
                    status_internacao,
                    nr_atendimento_internado AS atendimento_internado,
                    dt_internacao,
                    minutos_aguardando
                FROM vw_painel_ps_alta_internacao
                WHERE status_internacao = %s
                ORDER BY 
                    CASE 
                        WHEN status_internacao = 'AGUARDANDO_VAGA' THEN minutos_aguardando
                        ELSE 0
                    END DESC,
                    dt_alta ASC
            """
            cursor.execute(query, (status_filtro,))
        else:
            query = """
                SELECT 
                    nr_atendimento,
                    nm_pessoa_fisica,
                    qt_idade,
                    ds_convenio,
                    ds_clinica,
                    dt_alta,
                    ds_necessidade_vaga,
                    status_internacao,
                    nr_atendimento_internado AS atendimento_internado,
                    dt_internacao,
                    minutos_aguardando
                FROM vw_painel_ps_alta_internacao
                ORDER BY 
                    CASE 
                        WHEN status_internacao = 'AGUARDANDO_VAGA' THEN 0
                        ELSE 1
                    END,
                    CASE 
                        WHEN status_internacao = 'AGUARDANDO_VAGA' THEN minutos_aguardando
                        ELSE 0
                    END DESC,
                    dt_alta ASC
            """
            cursor.execute(query)

        registros = cursor.fetchall()

        # Formatar datas para ISO
        resultado = []
        for reg in registros:
            item = dict(reg)

            for campo in ['dt_alta', 'dt_internacao']:
                if item.get(campo) and hasattr(item[campo], 'isoformat'):
                    item[campo] = item[campo].isoformat()

            resultado.append(item)

        cursor.close()
        conn.close()

        return jsonify({
            'success': True,
            'data': resultado,
            'total': len(resultado),
            'status_filtrado': status_filtro,
            'timestamp': datetime.now().isoformat()
        })

    except Exception as e:
        current_app.logger.error(f'Erro ao buscar lista painel11: {e}', exc_info=True)
        if conn:
            conn.close()
        return jsonify({
            'success': False,
            'error': 'Erro ao buscar dados'
        }), 500