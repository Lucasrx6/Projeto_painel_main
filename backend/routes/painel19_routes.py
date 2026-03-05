"""
Painel 19 - Pendências Radiologia
Endpoints para monitoramento de exames de radiologia de pacientes internados
"""
from flask import Blueprint, jsonify, send_from_directory, request, session, current_app
from datetime import datetime
from decimal import Decimal
from psycopg2.extras import RealDictCursor
from backend.database import get_db_connection
from backend.middleware.decorators import login_required
from backend.user_management import verificar_permissao_painel

# Cria o Blueprint
painel19_bp = Blueprint('painel19', __name__)


# =========================================================
# ROTAS DE PÁGINA HTML
# =========================================================

@painel19_bp.route('/painel/painel19')
@login_required
def painel19():
    """Página principal do Painel 19"""
    usuario_id = session.get('usuario_id')
    is_admin = session.get('is_admin', False)

    if not is_admin:
        if not verificar_permissao_painel(usuario_id, 'painel19'):
            current_app.logger.warning(f'Acesso negado ao painel19: {session.get("usuario")}')
            return send_from_directory('frontend', 'acesso-negado.html')

    return send_from_directory('paineis/painel19', 'index.html')


# =========================================================
# UTILITÁRIOS
# =========================================================

def serializar_linha(row):
    """Converte tipos não serializáveis para JSON"""
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

@painel19_bp.route('/api/paineis/painel19/dashboard', methods=['GET'])
@login_required
def api_painel19_dashboard():
    """
    Contadores gerais para os cards do dashboard
    GET /api/paineis/painel19/dashboard?setor=41
    """
    usuario_id = session.get('usuario_id')
    is_admin = session.get('is_admin', False)

    if not is_admin:
        if not verificar_permissao_painel(usuario_id, 'painel19'):
            return jsonify({'success': False, 'error': 'Sem permissão'}), 403

    conn = get_db_connection()
    if not conn:
        return jsonify({'success': False, 'error': 'Erro de conexão com o banco'}), 500

    try:
        cursor = conn.cursor(cursor_factory=RealDictCursor)
        setor = request.args.get('setor', '')

        filtro_sql = ""
        params = []
        if setor:
            filtro_sql = "WHERE cd_setor_atendimento = %s"
            params.append(int(setor))

        query = f"""
            SELECT
                COUNT(DISTINCT nr_atendimento) AS total_pacientes,
                COUNT(*) AS total_exames,
                COUNT(*) FILTER (WHERE status_radiologia = 'AGUARDANDO') AS qt_aguardando,
                COUNT(*) FILTER (WHERE status_radiologia = 'EXECUTADO_SEM_LAUDO') AS qt_sem_laudo,
                COUNT(*) FILTER (WHERE status_radiologia = 'LAUDADO') AS qt_laudado
            FROM painel19_radiologia_pendencias
            {filtro_sql}
        """

        cursor.execute(query, params)
        result = cursor.fetchone()

        if not result:
            result = {
                'total_pacientes': 0, 'total_exames': 0,
                'qt_aguardando': 0, 'qt_sem_laudo': 0, 'qt_laudado': 0
            }

        cursor.close()
        conn.close()

        return jsonify({
            'success': True,
            'data': serializar_linha(dict(result)),
            'timestamp': datetime.now().isoformat()
        })

    except Exception as e:
        current_app.logger.error(f'Erro dashboard painel19: {e}', exc_info=True)
        if conn:
            conn.close()
        return jsonify({'success': False, 'error': 'Erro ao buscar dados'}), 500


# =========================================================
# API - DADOS COMPLETOS (EXAMES COM DETALHE)
# =========================================================

@painel19_bp.route('/api/paineis/painel19/dados', methods=['GET'])
@login_required
def api_painel19_dados():
    """
    Retorna todos os exames de radiologia com detalhes completos.
    O frontend agrupa por paciente e renderiza sub-linhas.
    GET /api/paineis/painel19/dados?setor=41&status=AGUARDANDO
    """
    usuario_id = session.get('usuario_id')
    is_admin = session.get('is_admin', False)

    if not is_admin:
        if not verificar_permissao_painel(usuario_id, 'painel19'):
            return jsonify({'success': False, 'error': 'Sem permissão'}), 403

    conn = get_db_connection()
    if not conn:
        return jsonify({'success': False, 'error': 'Erro de conexão com o banco'}), 500

    try:
        cursor = conn.cursor(cursor_factory=RealDictCursor)

        setor = request.args.get('setor', '')
        status = request.args.get('status', '')

        filtros = []
        params = []

        if setor:
            filtros.append("cd_setor_atendimento = %s")
            params.append(int(setor))

        if status:
            filtros.append("status_radiologia = %s")
            params.append(status)

        where_sql = ""
        if filtros:
            where_sql = "WHERE " + " AND ".join(filtros)

        query = f"""
            SELECT * FROM vw_painel19_radiologia
            {where_sql}
            ORDER BY cd_setor_atendimento, leito_base, prioridade_ordem, dt_pedido DESC
        """

        cursor.execute(query, params)
        exames = [serializar_linha(dict(row)) for row in cursor.fetchall()]

        cursor.close()
        conn.close()

        return jsonify({
            'success': True,
            'data': exames,
            'total': len(exames),
            'timestamp': datetime.now().isoformat()
        })

    except Exception as e:
        current_app.logger.error(f'Erro dados painel19: {e}', exc_info=True)
        if conn:
            conn.close()
        return jsonify({'success': False, 'error': 'Erro ao buscar dados'}), 500


# =========================================================
# API - SETORES DISPONÍVEIS (PARA FILTRO)
# =========================================================

@painel19_bp.route('/api/paineis/painel19/setores', methods=['GET'])
@login_required
def api_painel19_setores():
    """
    Lista setores que possuem exames de radiologia
    GET /api/paineis/painel19/setores
    """
    conn = get_db_connection()
    if not conn:
        return jsonify({'success': False, 'error': 'Erro de conexão com o banco'}), 500

    try:
        cursor = conn.cursor(cursor_factory=RealDictCursor)

        query = """
            SELECT DISTINCT
                cd_setor_atendimento,
                nm_setor,
                COUNT(*) AS qt_exames
            FROM painel19_radiologia_pendencias
            GROUP BY cd_setor_atendimento, nm_setor
            ORDER BY nm_setor
        """

        cursor.execute(query)
        setores = [dict(row) for row in cursor.fetchall()]

        cursor.close()
        conn.close()

        return jsonify({
            'success': True,
            'data': setores,
            'timestamp': datetime.now().isoformat()
        })

    except Exception as e:
        current_app.logger.error(f'Erro setores painel19: {e}', exc_info=True)
        if conn:
            conn.close()
        return jsonify({'success': False, 'error': 'Erro ao buscar setores'}), 500