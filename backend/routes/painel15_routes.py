"""
Painel 15 - Gatilho de Chamados TI
Endpoints para abertura de chamados pelo operador
Todos os chamados sao de prioridade critica (emergencial)
"""
from flask import Blueprint, jsonify, request, send_from_directory, session, current_app
from datetime import datetime
from psycopg2.extras import RealDictCursor
from backend.database import get_db_connection
from backend.middleware.decorators import login_required
from backend.user_management import verificar_permissao_painel

painel15_bp = Blueprint('painel15', __name__)


# =========================================================
# ROTA DE PAGINA HTML
# =========================================================

@painel15_bp.route('/painel/painel15')
@login_required
def painel15():
    """Pagina principal do Painel 15"""
    usuario_id = session.get('usuario_id')
    is_admin = session.get('is_admin', False)
    if not is_admin:
        if not verificar_permissao_painel(usuario_id, 'painel15'):
            current_app.logger.warning(f'Acesso negado ao painel15: {session.get("usuario")}')
            return send_from_directory('frontend', 'acesso-negado.html')
    return send_from_directory('paineis/painel15', 'index.html')


# =========================================================
# API - LISTAR LOCAIS ATIVOS (para select do operador)
# =========================================================

@painel15_bp.route('/api/paineis/painel15/locais', methods=['GET'])
@login_required
def api_painel15_locais():
    """
    Lista locais ativos agrupados por setor para os selects do formulario
    GET /api/paineis/painel15/locais
    Retorna: { setores: ["PS", "CC"], locais: [{id, setor, local}] }
    """
    usuario_id = session.get('usuario_id')
    is_admin = session.get('is_admin', False)
    if not is_admin and not verificar_permissao_painel(usuario_id, 'painel15'):
        return jsonify({'success': False, 'error': 'Sem permissao'}), 403

    conn = get_db_connection()
    if not conn:
        return jsonify({'success': False, 'error': 'Erro de conexao'}), 500

    try:
        cursor = conn.cursor(cursor_factory=RealDictCursor)
        cursor.execute("""
            SELECT id, setor, local, hostname, ip
            FROM chamados_locais
            WHERE ativo = TRUE
            ORDER BY setor, local
        """)
        locais = [dict(row) for row in cursor.fetchall()]

        # Extrair lista unica de setores
        setores_vistos = {}
        setores = []
        for loc in locais:
            s = loc['setor']
            if s not in setores_vistos:
                setores_vistos[s] = True
                setores.append(s)

        cursor.close()
        conn.close()

        return jsonify({
            'success': True,
            'setores': setores,
            'locais': locais,
            'total': len(locais)
        })

    except Exception as e:
        current_app.logger.error(f'Erro listar locais painel15: {e}', exc_info=True)
        if conn: conn.close()
        return jsonify({'success': False, 'error': 'Erro ao listar locais'}), 500


# =========================================================
# API - LISTAR PROBLEMAS ATIVOS (para select do operador)
# =========================================================

@painel15_bp.route('/api/paineis/painel15/problemas', methods=['GET'])
@login_required
def api_painel15_problemas():
    """Lista tipos de problema ativos para o select"""
    usuario_id = session.get('usuario_id')
    is_admin = session.get('is_admin', False)
    if not is_admin and not verificar_permissao_painel(usuario_id, 'painel15'):
        return jsonify({'success': False, 'error': 'Sem permissao'}), 403

    conn = get_db_connection()
    if not conn:
        return jsonify({'success': False, 'error': 'Erro de conexao'}), 500

    try:
        cursor = conn.cursor(cursor_factory=RealDictCursor)
        cursor.execute("""
            SELECT id, descricao
            FROM chamados_problemas
            WHERE ativo = TRUE
            ORDER BY descricao
        """)
        problemas = [dict(row) for row in cursor.fetchall()]
        cursor.close()
        conn.close()
        return jsonify({'success': True, 'data': problemas, 'total': len(problemas)})

    except Exception as e:
        current_app.logger.error(f'Erro listar problemas painel15: {e}', exc_info=True)
        if conn: conn.close()
        return jsonify({'success': False, 'error': 'Erro ao listar problemas'}), 500


# =========================================================
# API - ABRIR CHAMADO
# =========================================================

@painel15_bp.route('/api/paineis/painel15/abrir', methods=['POST'])
@login_required
def api_painel15_abrir():
    """
    Abre um novo chamado emergencial de TI
    POST /api/paineis/painel15/abrir
    Body: {
        "nome_solicitante": "Nome",
        "local_id": 5,               -- ID do local selecionado
        "problema_id": 2,            -- ID do tipo de problema
        "numero_kora": "123456",
        "observacao": "obs opcional"
    }
    """
    usuario_id = session.get('usuario_id')
    is_admin = session.get('is_admin', False)
    if not is_admin and not verificar_permissao_painel(usuario_id, 'painel15'):
        return jsonify({'success': False, 'error': 'Sem permissao'}), 403

    dados = request.get_json()
    if not dados:
        return jsonify({'success': False, 'error': 'Dados nao fornecidos'}), 400

    nome = (dados.get('nome_solicitante') or '').strip()
    local_id = dados.get('local_id')
    problema_id = dados.get('problema_id')
    numero_kora = (dados.get('numero_kora') or '').strip()
    observacao = (dados.get('observacao') or '').strip() or None

    erros = []
    if not nome:
        erros.append('Nome do solicitante e obrigatorio')
    if not local_id:
        erros.append('Selecione o local do problema')
    if not problema_id:
        erros.append('Selecione o tipo de problema')
    if not numero_kora:
        erros.append('Numero do chamado Kora e obrigatorio')
    elif not numero_kora.isdigit() or len(numero_kora) < 6 or len(numero_kora) > 7:
        erros.append('Numero Kora deve ter 6 ou 7 digitos numericos')

    if erros:
        return jsonify({'success': False, 'errors': erros}), 400

    conn = get_db_connection()
    if not conn:
        return jsonify({'success': False, 'error': 'Erro de conexao com o banco'}), 500

    try:
        cursor = conn.cursor(cursor_factory=RealDictCursor)

        # Buscar dados do local para desnormalizar
        cursor.execute("""
            SELECT setor, local, hostname, ip
            FROM chamados_locais
            WHERE id = %s AND ativo = TRUE
        """, (local_id,))
        local_data = cursor.fetchone()
        if not local_data:
            cursor.close(); conn.close()
            return jsonify({'success': False, 'error': 'Local nao encontrado ou inativo'}), 400

        # Buscar descricao do problema
        cursor.execute("""
            SELECT descricao
            FROM chamados_problemas
            WHERE id = %s AND ativo = TRUE
        """, (problema_id,))
        problema_data = cursor.fetchone()
        if not problema_data:
            cursor.close(); conn.close()
            return jsonify({'success': False, 'error': 'Tipo de problema nao encontrado'}), 400

        # Montar local_problema desnormalizado para exibicao
        local_texto = f"{local_data['setor']} - {local_data['local']}"

        # Verificar duplicata Kora
        cursor.execute("""
            SELECT id, status FROM chamados
            WHERE numero_kora = %s AND status IN ('aberto', 'em_atendimento')
        """, (numero_kora,))
        existente = cursor.fetchone()
        if existente:
            cursor.close(); conn.close()
            return jsonify({
                'success': False,
                'error': f'Ja existe um chamado ativo com o numero Kora {numero_kora} (ID: {existente["id"]})'
            }), 409

        # Inserir chamado com dados desnormalizados
        cursor.execute("""
            INSERT INTO chamados (
                numero_kora, nome_solicitante, local_problema,
                local_id, setor, hostname, ip,
                problema_id, problema_descricao,
                observacao_abertura, prioridade, status, visualizado
            )
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, 'critica', 'aberto', FALSE)
            RETURNING id, data_abertura
        """, (
            numero_kora, nome, local_texto,
            local_id, local_data['setor'], local_data['hostname'], local_data['ip'],
            problema_id, problema_data['descricao'],
            observacao
        ))
        novo = cursor.fetchone()

        # Historico
        descricao_hist = (
            f"CHAMADO EMERGENCIAL aberto por {nome} | "
            f"{local_texto} | Problema: {problema_data['descricao']} | Kora: {numero_kora}"
        )
        cursor.execute("""
            INSERT INTO chamados_historico (chamado_id, acao, status_novo, descricao, usuario)
            VALUES (%s, 'abertura', 'aberto', %s, %s)
        """, (novo['id'], descricao_hist, nome))

        conn.commit()

        chamado_id = novo['id']
        data_abertura = novo['data_abertura'].isoformat() if novo['data_abertura'] else None
        cursor.close(); conn.close()

        current_app.logger.info(
            f'EMERGENCIAL - Chamado #{chamado_id} | {nome} | {local_texto} | '
            f'{problema_data["descricao"]} | Kora: {numero_kora}'
        )

        return jsonify({
            'success': True,
            'message': 'Chamado emergencial aberto com sucesso!',
            'data': {
                'id': chamado_id,
                'numero_kora': numero_kora,
                'data_abertura': data_abertura
            }
        }), 201

    except Exception as e:
        current_app.logger.error(f'Erro abrir chamado painel15: {e}', exc_info=True)
        if conn: conn.rollback(); conn.close()
        return jsonify({'success': False, 'error': 'Erro ao registrar chamado'}), 500


# =========================================================
# API - ACOMPANHAR CHAMADOS
# =========================================================

@painel15_bp.route('/api/paineis/painel15/acompanhar', methods=['GET'])
@login_required
def api_painel15_acompanhar():
    """Lista chamados recentes (ultimas 24h)"""
    usuario_id = session.get('usuario_id')
    is_admin = session.get('is_admin', False)
    if not is_admin and not verificar_permissao_painel(usuario_id, 'painel15'):
        return jsonify({'success': False, 'error': 'Sem permissao'}), 403

    conn = get_db_connection()
    if not conn:
        return jsonify({'success': False, 'error': 'Erro de conexao'}), 500

    try:
        cursor = conn.cursor(cursor_factory=RealDictCursor)
        cursor.execute("SELECT * FROM vw_chamados_recentes")
        chamados = [dict(row) for row in cursor.fetchall()]
        for ch in chamados:
            for campo in ['data_abertura', 'data_fechamento']:
                if ch.get(campo) and isinstance(ch[campo], datetime):
                    ch[campo] = ch[campo].isoformat()
            if ch.get('minutos_total'):
                ch['minutos_total'] = float(ch['minutos_total'])
        cursor.close(); conn.close()

        return jsonify({
            'success': True,
            'data': chamados,
            'total': len(chamados),
            'timestamp': datetime.now().isoformat()
        })

    except Exception as e:
        current_app.logger.error(f'Erro acompanhar painel15: {e}', exc_info=True)
        if conn: conn.close()
        return jsonify({'success': False, 'error': 'Erro ao buscar chamados'}), 500


# =========================================================
# API - STATUS DE UM CHAMADO ESPECIFICO
# =========================================================

@painel15_bp.route('/api/paineis/painel15/status/<int:chamado_id>', methods=['GET'])
@login_required
def api_painel15_status(chamado_id):
    """Retorna status atualizado de um chamado especifico"""
    usuario_id = session.get('usuario_id')
    is_admin = session.get('is_admin', False)
    if not is_admin and not verificar_permissao_painel(usuario_id, 'painel15'):
        return jsonify({'success': False, 'error': 'Sem permissao'}), 403

    conn = get_db_connection()
    if not conn:
        return jsonify({'success': False, 'error': 'Erro de conexao'}), 500

    try:
        cursor = conn.cursor(cursor_factory=RealDictCursor)
        cursor.execute("""
            SELECT
                id, numero_kora, nome_solicitante, local_problema,
                setor, hostname, ip, problema_descricao,
                observacao_abertura, data_abertura, status, prioridade,
                tecnico_atendimento, visualizado,
                data_inicio_atendimento, data_fechamento, observacao_fechamento,
                EXTRACT(EPOCH FROM (COALESCE(data_fechamento, NOW()) - data_abertura)) / 60 AS minutos_total,
                LPAD(FLOOR(EXTRACT(EPOCH FROM (COALESCE(data_fechamento, NOW()) - data_abertura)) / 3600)::TEXT, 2, '0')
                    || ':' ||
                LPAD(FLOOR(MOD(EXTRACT(EPOCH FROM (COALESCE(data_fechamento, NOW()) - data_abertura)) / 60, 60))::TEXT, 2, '0')
                    AS tempo_total_formatado
            FROM chamados WHERE id = %s
        """, (chamado_id,))
        chamado = cursor.fetchone()
        cursor.close(); conn.close()

        if not chamado:
            return jsonify({'success': False, 'error': 'Chamado nao encontrado'}), 404

        chamado = dict(chamado)
        for campo in ['data_abertura', 'data_inicio_atendimento', 'data_fechamento']:
            if chamado.get(campo) and isinstance(chamado[campo], datetime):
                chamado[campo] = chamado[campo].isoformat()
        if chamado.get('minutos_total'):
            chamado['minutos_total'] = float(chamado['minutos_total'])

        return jsonify({'success': True, 'data': chamado, 'timestamp': datetime.now().isoformat()})

    except Exception as e:
        current_app.logger.error(f'Erro status chamado {chamado_id}: {e}', exc_info=True)
        if conn: conn.close()
        return jsonify({'success': False, 'error': 'Erro ao buscar chamado'}), 500