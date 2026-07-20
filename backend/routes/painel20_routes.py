"""
Painel 20 - Pendencias Radiologia Pronto Socorro
Endpoints para monitoramento de exames de radiologia de pacientes no PS

Endpoints:
    GET /painel/painel20                              - Pagina HTML
    GET /paineis/painel20/<filename>                   - Arquivos estaticos (CSS, JS)
    GET /api/paineis/painel20/dashboard                - Cards contadores
    GET /api/paineis/painel20/dados?status=            - Todos exames (sub-linhas)
"""
from flask import Blueprint, jsonify, send_from_directory, request, session, current_app
from datetime import datetime
from decimal import Decimal
from psycopg2.extras import RealDictCursor
from backend.database import get_db_cursor
from backend.middleware.decorators import login_required, panel_permission_required
from backend.cache import cache_route

# Cria o Blueprint
painel20_bp = Blueprint('painel20', __name__)


# =========================================================
# ROTAS DE PAGINA HTML E ESTATICOS
# =========================================================

@painel20_bp.route('/painel/painel20')
@login_required
@panel_permission_required('painel20')
def painel20():
    """Pagina principal do Painel 20"""
    return send_from_directory('paineis/painel20', 'index.html')


@painel20_bp.route('/paineis/painel20/<path:filename>')
@login_required
@panel_permission_required('painel20')
def painel20_static(filename):
    """Serve arquivos estaticos do painel (CSS, JS)"""
    return send_from_directory('paineis/painel20', filename)


# =========================================================
# UTILITARIOS
# =========================================================

def serializar_linha(row):
    """Converte tipos nao serializaveis para JSON"""
    resultado = {}
    for chave, valor in row.items():
        if isinstance(valor, datetime):
            resultado[chave] = valor.isoformat()
        elif isinstance(valor, Decimal):
            resultado[chave] = float(valor)
        else:
            resultado[chave] = valor
    return resultado


# =========================================================
# API - DASHBOARD (CONTADORES)
# =========================================================

@painel20_bp.route('/api/paineis/painel20/dashboard', methods=['GET'])
@login_required
@panel_permission_required('painel20')
@cache_route(ttl=120, key_prefix='painel20:dashboard', vary_by_user=False)
def api_painel20_dashboard():
    """
    Contadores gerais para os cards do dashboard
    GET /api/paineis/painel20/dashboard
    """
    try:
        with get_db_cursor() as cursor:

            query = """
                SELECT
                    COUNT(DISTINCT nr_atendimento) AS total_pacientes,
                    COUNT(*) AS total_exames,
                    COUNT(*) FILTER (WHERE status_radiologia = 'AGUARDANDO') AS qt_aguardando,
                    COUNT(*) FILTER (WHERE status_radiologia = 'EXECUTADO_SEM_LAUDO') AS qt_sem_laudo,
                    COUNT(*) FILTER (WHERE status_radiologia = 'LAUDADO') AS qt_laudado
                FROM painel20_radiologia_ps
            """

            cursor.execute(query)
            result = cursor.fetchone()

            if not result:
                result = {
                    'total_pacientes': 0, 'total_exames': 0,
                    'qt_aguardando': 0, 'qt_sem_laudo': 0, 'qt_laudado': 0
                }


            return jsonify({
                'success': True,
                'data': serializar_linha(dict(result)),
                'timestamp': datetime.now().isoformat()
            })

    except Exception as e:
        current_app.logger.error(f'Erro dashboard painel20: {e}', exc_info=True)
        return jsonify({'success': False, 'error': 'Erro ao buscar dados'}), 500


# =========================================================
# API - DADOS COMPLETOS (EXAMES COM DETALHE)
# =========================================================

@painel20_bp.route('/api/paineis/painel20/dados', methods=['GET'])
@login_required
@panel_permission_required('painel20')
@cache_route(ttl=120, key_prefix='painel20:dados', vary_by_user=False, vary_by_query=True)
def api_painel20_dados():
    """
    Retorna todos os exames de radiologia do PS com detalhes completos.
    O frontend agrupa por paciente e renderiza sub-linhas.
    GET /api/paineis/painel20/dados
    GET /api/paineis/painel20/dados?status=AGUARDANDO
    GET /api/paineis/painel20/dados?status=EXECUTADO_SEM_LAUDO
    GET /api/paineis/painel20/dados?status=LAUDADO
    """
    try:
        with get_db_cursor() as cursor:

            status = request.args.get('status', '')

            filtro_sql = ""
            params = []

            if status:
                filtro_sql = "WHERE status_radiologia = %s"
                params.append(status)

            query = f"""
                SELECT * FROM vw_painel20_radiologia
                {filtro_sql}
                ORDER BY prioridade_ordem, dt_entrada ASC, dt_pedido ASC
            """

            cursor.execute(query, params)
            exames = [serializar_linha(dict(row)) for row in cursor.fetchall()]


            return jsonify({
                'success': True,
                'data': exames,
                'total': len(exames),
                'timestamp': datetime.now().isoformat()
            })

    except Exception as e:
        current_app.logger.error(f'Erro dados painel20: {e}', exc_info=True)
        return jsonify({'success': False, 'error': 'Erro ao buscar dados'}), 500