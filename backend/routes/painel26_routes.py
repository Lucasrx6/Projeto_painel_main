"""
Painel 26 - Central de Notificacoes
Endpoints para configuracao de destinatarios, tipos e historico
"""
from flask import Blueprint, jsonify, send_from_directory, request, session, current_app
from datetime import datetime
from psycopg2.extras import RealDictCursor
from backend.database import get_db_connection, release_connection
from backend.middleware.decorators import login_required
from backend.user_management import verificar_permissao_painel

painel26_bp = Blueprint('painel26', __name__)


# =========================================================
# FUNCOES AUXILIARES
# =========================================================

def _verificar_acesso():
    """Verifica permissao de acesso ao painel"""
    usuario_id = session.get('usuario_id')
    is_admin = session.get('is_admin', False)
    if not is_admin:
        if not verificar_permissao_painel(usuario_id, 'painel26'):
            return False
    return True


# =========================================================
# ROTA DE PAGINA HTML
# =========================================================

@painel26_bp.route('/painel/painel26')
@login_required
def painel26():
    """Pagina principal do Painel 26"""
    if not _verificar_acesso():
        return send_from_directory('frontend', 'acesso-negado.html')
    return send_from_directory('paineis/painel26', 'index.html')


# =========================================================
# DASHBOARD - KPIs e Resumo
# =========================================================

@painel26_bp.route('/api/paineis/painel26/dashboard', methods=['GET'])
@login_required
def api_painel26_dashboard():
    """Retorna KPIs e resumo para dashboard"""
    if not _verificar_acesso():
        return jsonify({'success': False, 'error': 'Sem permissao'}), 403

    conn = get_db_connection()
    if not conn:
        return jsonify({'success': False, 'error': 'Erro de conexao'}), 500

    try:
        cursor = conn.cursor(cursor_factory=RealDictCursor)

        # KPIs - Resumo por tipo
        cursor.execute("SELECT * FROM vw_notificacoes_resumo")
        resumo = cursor.fetchall()

        # Total de destinatarios ativos
        cursor.execute("""
            SELECT COUNT(*) AS total_destinatarios
            FROM notificacoes_destinatarios
            WHERE ativo = true
        """)
        total_dest = cursor.fetchone()

        # Tipos de evento ativos
        cursor.execute("""
            SELECT COUNT(*) AS total_tipos
            FROM notificacoes_tipos_evento
            WHERE ativo = true
        """)
        total_tipos = cursor.fetchone()

        # Envios hoje
        cursor.execute("""
            SELECT
                COUNT(*) AS total_hoje,
                COUNT(*) FILTER (WHERE sucesso = true) AS sucesso_hoje,
                COUNT(*) FILTER (WHERE sucesso = false) AS erro_hoje
            FROM notificacoes_historico
            WHERE dt_envio::date = CURRENT_DATE
        """)
        hoje = cursor.fetchone()

        cursor.close()
        release_connection(conn)

        return jsonify({
            'success': True,
            'resumo': [dict(r) for r in resumo],
            'total_destinatarios': total_dest['total_destinatarios'],
            'total_tipos': total_tipos['total_tipos'],
            'envios_hoje': dict(hoje),
            'timestamp': datetime.now().isoformat()
        })

    except Exception as e:
        current_app.logger.error('Erro dashboard painel26: %s', e, exc_info=True)
        if conn:
            release_connection(conn)
        return jsonify({'success': False, 'error': 'Erro ao buscar dados'}), 500


# =========================================================
# TIPOS DE EVENTO
# =========================================================

@painel26_bp.route('/api/paineis/painel26/tipos', methods=['GET'])
@login_required
def api_painel26_tipos():
    """Lista tipos de evento"""
    if not _verificar_acesso():
        return jsonify({'success': False, 'error': 'Sem permissao'}), 403

    conn = get_db_connection()
    if not conn:
        return jsonify({'success': False, 'error': 'Erro de conexao'}), 500

    try:
        cursor = conn.cursor(cursor_factory=RealDictCursor)
        cursor.execute("""
            SELECT id, codigo, nome, descricao, icone, cor, tabela_origem, ativo
            FROM notificacoes_tipos_evento
            ORDER BY nome
        """)
        tipos = cursor.fetchall()
        cursor.close()
        release_connection(conn)

        return jsonify({
            'success': True,
            'data': [dict(t) for t in tipos]
        })

    except Exception as e:
        current_app.logger.error('Erro tipos painel26: %s', e, exc_info=True)
        if conn:
            release_connection(conn)
        return jsonify({'success': False, 'error': 'Erro ao buscar dados'}), 500


# =========================================================
# DESTINATARIOS - CRUD
# =========================================================

@painel26_bp.route('/api/paineis/painel26/destinatarios', methods=['GET'])
@login_required
def api_painel26_destinatarios():
    """Lista destinatarios com filtros"""
    if not _verificar_acesso():
        return jsonify({'success': False, 'error': 'Sem permissao'}), 403

    conn = get_db_connection()
    if not conn:
        return jsonify({'success': False, 'error': 'Erro de conexao'}), 500

    try:
        cursor = conn.cursor(cursor_factory=RealDictCursor)

        # Filtros opcionais
        tipo_evento = request.args.get('tipo_evento', '')
        especialidade = request.args.get('especialidade', '')
        ativo = request.args.get('ativo', '')

        query = "SELECT * FROM vw_destinatarios_completo WHERE 1=1"
        params = []

        if tipo_evento:
            query += " AND tipo_evento = %s"
            params.append(tipo_evento)

        if especialidade:
            query += " AND especialidade = %s"
            params.append(especialidade)

        if ativo == 'true':
            query += " AND ativo = true"
        elif ativo == 'false':
            query += " AND ativo = false"

        cursor.execute(query, params)
        destinatarios = cursor.fetchall()

        # Busca especialidades distintas para filtro
        cursor.execute("""
            SELECT DISTINCT especialidade
            FROM notificacoes_destinatarios
            WHERE especialidade IS NOT NULL
            ORDER BY especialidade
        """)
        especialidades = [r['especialidade'] for r in cursor.fetchall()]

        cursor.close()
        release_connection(conn)

        return jsonify({
            'success': True,
            'data': [dict(d) for d in destinatarios],
            'filtros': {
                'especialidades': especialidades
            }
        })

    except Exception as e:
        current_app.logger.error('Erro destinatarios painel26: %s', e, exc_info=True)
        if conn:
            release_connection(conn)
        return jsonify({'success': False, 'error': 'Erro ao buscar dados'}), 500


@painel26_bp.route('/api/paineis/painel26/destinatarios', methods=['POST'])
@login_required
def api_painel26_destinatarios_criar():
    """Cria novo destinatario"""
    if not _verificar_acesso():
        return jsonify({'success': False, 'error': 'Sem permissao'}), 403

    dados = request.get_json()
    if not dados:
        return jsonify({'success': False, 'error': 'Dados invalidos'}), 400

    campos_obrigatorios = ['tipo_evento', 'nome', 'email']
    for campo in campos_obrigatorios:
        if not dados.get(campo, '').strip():
            return jsonify({'success': False, 'error': 'Campo obrigatorio: {}'.format(campo)}), 400

    conn = get_db_connection()
    if not conn:
        return jsonify({'success': False, 'error': 'Erro de conexao'}), 500

    try:
        cursor = conn.cursor(cursor_factory=RealDictCursor)

        # Verifica duplicata
        cursor.execute("""
            SELECT id FROM notificacoes_destinatarios
            WHERE tipo_evento = %s AND email = %s
        """, (dados['tipo_evento'], dados['email']))

        if cursor.fetchone():
            cursor.close()
            release_connection(conn)
            return jsonify({'success': False, 'error': 'Email ja cadastrado para este tipo de evento'}), 409

        cursor.execute("""
                    INSERT INTO notificacoes_destinatarios
                        (tipo_evento, nome, email, destino, especialidade, setor, canal, descricao, ativo, criado_por)
                    VALUES
                        (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                    RETURNING id
                """, (
            dados['tipo_evento'],
            dados['nome'].strip(),
            dados['email'].strip().lower(),
            dados['email'].strip().lower(),
            dados.get('especialidade', '').strip() or None,
            dados.get('setor', '').strip() or None,
            dados.get('canal', 'email'),
            dados.get('descricao', '').strip() or None,
            dados.get('ativo', True),
            session.get('usuario', 'sistema')
        ))

        novo_id = cursor.fetchone()['id']
        conn.commit()
        cursor.close()
        release_connection(conn)

        return jsonify({
            'success': True,
            'id': novo_id,
            'mensagem': 'Destinatario criado com sucesso'
        }), 201

    except Exception as e:
        current_app.logger.error('Erro criar destinatario: %s', e, exc_info=True)
        if conn:
            release_connection(conn)
        return jsonify({'success': False, 'error': 'Erro ao criar destinatario'}), 500


@painel26_bp.route('/api/paineis/painel26/destinatarios/<int:dest_id>', methods=['PUT'])
@login_required
def api_painel26_destinatarios_editar(dest_id):
    """Edita destinatario existente"""
    if not _verificar_acesso():
        return jsonify({'success': False, 'error': 'Sem permissao'}), 403

    dados = request.get_json()
    if not dados:
        return jsonify({'success': False, 'error': 'Dados invalidos'}), 400

    conn = get_db_connection()
    if not conn:
        return jsonify({'success': False, 'error': 'Erro de conexao'}), 500

    try:
        cursor = conn.cursor()

        cursor.execute("""
                    UPDATE notificacoes_destinatarios
                    SET nome = %s,
                        email = %s,
                        destino = %s,
                        especialidade = %s,
                        setor = %s,
                        canal = %s,
                        descricao = %s,
                        ativo = %s,
                        dt_atualizacao = CURRENT_TIMESTAMP
                    WHERE id = %s
                """, (
            dados.get('nome', '').strip(),
            dados.get('email', '').strip().lower(),
            dados.get('email', '').strip().lower(),
            dados.get('especialidade', '').strip() or None,
            dados.get('setor', '').strip() or None,
            dados.get('canal', 'email'),
            dados.get('descricao', '').strip() or None,
            dados.get('ativo', True),
            dest_id
        ))

        if cursor.rowcount == 0:
            cursor.close()
            release_connection(conn)
            return jsonify({'success': False, 'error': 'Destinatario nao encontrado'}), 404

        conn.commit()
        cursor.close()
        release_connection(conn)

        return jsonify({
            'success': True,
            'mensagem': 'Destinatario atualizado com sucesso'
        })

    except Exception as e:
        current_app.logger.error('Erro editar destinatario: %s', e, exc_info=True)
        if conn:
            release_connection(conn)
        return jsonify({'success': False, 'error': 'Erro ao editar'}), 500


@painel26_bp.route('/api/paineis/painel26/destinatarios/<int:dest_id>/toggle', methods=['PUT'])
@login_required
def api_painel26_destinatarios_toggle(dest_id):
    """Ativa/desativa destinatario"""
    if not _verificar_acesso():
        return jsonify({'success': False, 'error': 'Sem permissao'}), 403

    conn = get_db_connection()
    if not conn:
        return jsonify({'success': False, 'error': 'Erro de conexao'}), 500

    try:
        cursor = conn.cursor(cursor_factory=RealDictCursor)

        cursor.execute("""
            UPDATE notificacoes_destinatarios
            SET ativo = NOT ativo,
                dt_atualizacao = CURRENT_TIMESTAMP
            WHERE id = %s
            RETURNING id, ativo
        """, (dest_id,))

        resultado = cursor.fetchone()

        if not resultado:
            cursor.close()
            release_connection(conn)
            return jsonify({'success': False, 'error': 'Destinatario nao encontrado'}), 404

        conn.commit()
        cursor.close()
        release_connection(conn)

        return jsonify({
            'success': True,
            'ativo': resultado['ativo'],
            'mensagem': 'Ativado' if resultado['ativo'] else 'Desativado'
        })

    except Exception as e:
        current_app.logger.error('Erro toggle destinatario: %s', e, exc_info=True)
        if conn:
            release_connection(conn)
        return jsonify({'success': False, 'error': 'Erro ao alternar'}), 500


@painel26_bp.route('/api/paineis/painel26/destinatarios/<int:dest_id>', methods=['DELETE'])
@login_required
def api_painel26_destinatarios_excluir(dest_id):
    """Exclui destinatario"""
    if not _verificar_acesso():
        return jsonify({'success': False, 'error': 'Sem permissao'}), 403

    conn = get_db_connection()
    if not conn:
        return jsonify({'success': False, 'error': 'Erro de conexao'}), 500

    try:
        cursor = conn.cursor()

        cursor.execute("DELETE FROM notificacoes_destinatarios WHERE id = %s", (dest_id,))

        if cursor.rowcount == 0:
            cursor.close()
            release_connection(conn)
            return jsonify({'success': False, 'error': 'Destinatario nao encontrado'}), 404

        conn.commit()
        cursor.close()
        release_connection(conn)

        return jsonify({
            'success': True,
            'mensagem': 'Destinatario excluido'
        })

    except Exception as e:
        current_app.logger.error('Erro excluir destinatario: %s', e, exc_info=True)
        if conn:
            release_connection(conn)
        return jsonify({'success': False, 'error': 'Erro ao excluir'}), 500


# =========================================================
# HISTORICO DE ENVIOS
# =========================================================

@painel26_bp.route('/api/paineis/painel26/historico', methods=['GET'])
@login_required
def api_painel26_historico():
    """Lista historico de envios com filtros"""
    if not _verificar_acesso():
        return jsonify({'success': False, 'error': 'Sem permissao'}), 403

    conn = get_db_connection()
    if not conn:
        return jsonify({'success': False, 'error': 'Erro de conexao'}), 500

    try:
        cursor = conn.cursor(cursor_factory=RealDictCursor)

        tipo_evento = request.args.get('tipo_evento', '')
        limite = request.args.get('limite', '50')

        try:
            limite = min(int(limite), 200)
        except ValueError:
            limite = 50

        query = """
            SELECT * FROM vw_notificacoes_timeline
            WHERE 1=1
        """
        params = []

        if tipo_evento:
            query += " AND tipo_evento = %s"
            params.append(tipo_evento)

        query += " LIMIT %s"
        params.append(limite)

        cursor.execute(query, params)
        historico = cursor.fetchall()

        cursor.close()
        release_connection(conn)

        return jsonify({
            'success': True,
            'data': [dict(h) for h in historico],
            'total': len(historico)
        })

    except Exception as e:
        current_app.logger.error('Erro historico painel26: %s', e, exc_info=True)
        if conn:
            release_connection(conn)
        return jsonify({'success': False, 'error': 'Erro ao buscar dados'}), 500


# =========================================================
# ESPECIALIDADES DISPONIVEIS (para dropdown)
# =========================================================

@painel26_bp.route('/api/paineis/painel26/especialidades', methods=['GET'])
@login_required
def api_painel26_especialidades():
    """Lista especialidades disponiveis dos pareceres"""
    if not _verificar_acesso():
        return jsonify({'success': False, 'error': 'Sem permissao'}), 403

    conn = get_db_connection()
    if not conn:
        return jsonify({'success': False, 'error': 'Erro de conexao'}), 500

    try:
        cursor = conn.cursor(cursor_factory=RealDictCursor)

        cursor.execute("""
            SELECT DISTINCT especialidade_destino AS especialidade
            FROM pareceres_pendentes
            WHERE especialidade_destino IS NOT NULL
              AND especialidade_destino != ''
            ORDER BY especialidade_destino
        """)

        especialidades = [r['especialidade'] for r in cursor.fetchall()]

        cursor.close()
        release_connection(conn)

        return jsonify({
            'success': True,
            'data': especialidades
        })

    except Exception as e:
        current_app.logger.error('Erro especialidades painel26: %s', e, exc_info=True)
        if conn:
            release_connection(conn)
        return jsonify({'success': False, 'error': 'Erro ao buscar dados'}), 500