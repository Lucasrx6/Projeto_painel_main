"""
Painel 42 - Tela da Nutrição
Endpoints para a equipe de nutrição gerenciar a fila de dietas (Kanban).
"""
from flask import Blueprint, jsonify, request, send_from_directory, session, current_app
from backend.database import get_db_cursor
from backend.middleware.decorators import login_required, panel_permission_required
from backend.cache import cache_route

painel42_bp = Blueprint('painel42', __name__)


@painel42_bp.route('/painel/painel42')
@login_required
@panel_permission_required('painel42')
def painel42():
    return send_from_directory('paineis/painel42', 'index.html')


# =========================================================
# EQUIPE DE NUTRIÇÃO
# =========================================================

@painel42_bp.route('/api/paineis/painel42/equipe', methods=['GET'])
@login_required
@cache_route(ttl=120, key_prefix='p42:equipe')
def api_p42_equipe():
    try:
        with get_db_cursor() as cursor:
            cursor.execute("""
                SELECT id, nome, funcao, turno
                FROM nutricao_cadastros
                WHERE ativo = TRUE
                ORDER BY nome
            """)
            equipe = [dict(r) for r in cursor.fetchall()]
        return jsonify({'success': True, 'equipe': equipe})
    except Exception as e:
        current_app.logger.error('Erro equipe p42: %s', e, exc_info=True)
        return jsonify({'success': False, 'error': 'Erro ao buscar equipe'}), 500


# =========================================================
# FILA DE SOLICITAÇÕES (ao vivo, sem cache)
# =========================================================

@painel42_bp.route('/api/paineis/painel42/fila', methods=['GET'])
@login_required
def api_p42_fila():
    try:
        with get_db_cursor() as cursor:
            cursor.execute("""
                SELECT
                    id, codigo_entrega, nm_paciente, leito, setor_nome, ds_clinica,
                    tipo_dieta_nome, refeicao_nome, quantidade, restricoes,
                    observacao, prioridade, status, responsavel_nome,
                    solicitante_nome,
                    TO_CHAR(criado_em,         'HH24:MI') AS criado_em,
                    TO_CHAR(dt_aceite,         'HH24:MI') AS dt_aceite,
                    TO_CHAR(dt_inicio_preparo, 'HH24:MI') AS dt_inicio_preparo,
                    TO_CHAR(dt_pronto,         'HH24:MI') AS dt_pronto,
                    TO_CHAR(dt_inicio_entrega, 'HH24:MI') AS dt_inicio_entrega,
                    EXTRACT(EPOCH FROM (NOW() - criado_em))::int / 60 AS minutos_espera
                FROM nutricao_solicitacoes
                WHERE status NOT IN ('entregue', 'cancelado')
                ORDER BY
                    CASE prioridade WHEN 'urgente' THEN 0 ELSE 1 END,
                    criado_em ASC
            """)
            fila = [dict(r) for r in cursor.fetchall()]

            # Contadores por status
            cursor.execute("""
                SELECT status, COUNT(*) AS total
                FROM nutricao_solicitacoes
                WHERE status NOT IN ('entregue', 'cancelado')
                GROUP BY status
            """)
            contadores_raw = cursor.fetchall()

        contadores = {
            'aguardando': 0, 'aceito': 0,
            'em_preparo': 0, 'pronto': 0, 'em_entrega': 0
        }
        for row in contadores_raw:
            if row['status'] in contadores:
                contadores[row['status']] = row['total']

        return jsonify({'success': True, 'fila': fila, 'contadores': contadores})
    except Exception as e:
        current_app.logger.error('Erro fila p42: %s', e, exc_info=True)
        return jsonify({'success': False, 'error': 'Erro ao buscar fila'}), 500


# =========================================================
# ACEITAR (aguardando → aceito)
# =========================================================

@painel42_bp.route('/api/paineis/painel42/solicitacoes/<int:sid>/aceitar', methods=['PUT'])
@login_required
def api_p42_aceitar(sid):
    dados         = request.get_json(silent=True) or {}
    responsavel_id = dados.get('responsavel_id')

    if not responsavel_id:
        return jsonify({'success': False, 'error': 'responsavel_id obrigatório'}), 400

    try:
        with get_db_cursor() as cursor:
            cursor.execute(
                "SELECT id FROM nutricao_cadastros WHERE id = %s AND ativo = TRUE",
                (responsavel_id,)
            )
            if not cursor.fetchone():
                return jsonify({'success': False, 'error': 'Membro da equipe inválido'}), 400

            cursor.execute("""
                UPDATE nutricao_solicitacoes
                SET status = 'aceito',
                    dt_aceite = NOW(),
                    responsavel_id = %s,
                    responsavel_nome = (SELECT nome FROM nutricao_cadastros WHERE id = %s),
                    atualizado_em = NOW()
                WHERE id = %s AND status = 'aguardando'
            """, (responsavel_id, responsavel_id, sid))

            if cursor.rowcount == 0:
                return jsonify({'success': False, 'error': 'Solicitação não encontrada ou já processada'}), 400

        return jsonify({'success': True, 'novo_status': 'aceito'})
    except Exception as e:
        current_app.logger.error('Erro aceitar p42 id=%s: %s', sid, e, exc_info=True)
        return jsonify({'success': False, 'error': 'Erro ao aceitar'}), 500


# =========================================================
# INICIAR PREPARO (aceito → em_preparo)
# =========================================================

@painel42_bp.route('/api/paineis/painel42/solicitacoes/<int:sid>/iniciar-preparo', methods=['PUT'])
@login_required
def api_p42_iniciar_preparo(sid):
    try:
        with get_db_cursor() as cursor:
            cursor.execute("""
                UPDATE nutricao_solicitacoes
                SET status = 'em_preparo',
                    dt_inicio_preparo = NOW(),
                    atualizado_em = NOW()
                WHERE id = %s AND status = 'aceito'
            """, (sid,))

            if cursor.rowcount == 0:
                return jsonify({'success': False, 'error': 'Solicitação não encontrada ou status inválido'}), 400

        return jsonify({'success': True, 'novo_status': 'em_preparo'})
    except Exception as e:
        current_app.logger.error('Erro iniciar-preparo p42 id=%s: %s', sid, e, exc_info=True)
        return jsonify({'success': False, 'error': 'Erro ao iniciar preparo'}), 500


# =========================================================
# PRONTO (em_preparo → pronto)
# =========================================================

@painel42_bp.route('/api/paineis/painel42/solicitacoes/<int:sid>/pronto', methods=['PUT'])
@login_required
def api_p42_pronto(sid):
    try:
        with get_db_cursor() as cursor:
            cursor.execute("""
                UPDATE nutricao_solicitacoes
                SET status = 'pronto',
                    dt_pronto = NOW(),
                    atualizado_em = NOW()
                WHERE id = %s AND status = 'em_preparo'
            """, (sid,))

            if cursor.rowcount == 0:
                return jsonify({'success': False, 'error': 'Solicitação não encontrada ou status inválido'}), 400

        return jsonify({'success': True, 'novo_status': 'pronto'})
    except Exception as e:
        current_app.logger.error('Erro pronto p42 id=%s: %s', sid, e, exc_info=True)
        return jsonify({'success': False, 'error': 'Erro ao marcar como pronto'}), 500


# =========================================================
# INICIAR ENTREGA (pronto → em_entrega)
# =========================================================

@painel42_bp.route('/api/paineis/painel42/solicitacoes/<int:sid>/iniciar-entrega', methods=['PUT'])
@login_required
def api_p42_iniciar_entrega(sid):
    dados       = request.get_json(silent=True) or {}
    entregue_por = (dados.get('entregue_por') or '').strip() or None

    try:
        with get_db_cursor() as cursor:
            cursor.execute("""
                UPDATE nutricao_solicitacoes
                SET status = 'em_entrega',
                    dt_inicio_entrega = NOW(),
                    entregue_por = %s,
                    atualizado_em = NOW()
                WHERE id = %s AND status = 'pronto'
            """, (entregue_por, sid))

            if cursor.rowcount == 0:
                return jsonify({'success': False, 'error': 'Solicitação não encontrada ou status inválido'}), 400

        return jsonify({'success': True, 'novo_status': 'em_entrega'})
    except Exception as e:
        current_app.logger.error('Erro iniciar-entrega p42 id=%s: %s', sid, e, exc_info=True)
        return jsonify({'success': False, 'error': 'Erro ao iniciar entrega'}), 500


# =========================================================
# ENTREGAR — valida código (em_entrega → entregue)
# =========================================================

@painel42_bp.route('/api/paineis/painel42/solicitacoes/<int:sid>/entregar', methods=['PUT'])
@login_required
def api_p42_entregar(sid):
    dados               = request.get_json(silent=True) or {}
    codigo_confirmacao  = (dados.get('codigo_confirmacao') or '').strip().upper()
    observacao_entrega  = (dados.get('observacao_entrega') or '').strip() or None

    if not codigo_confirmacao:
        return jsonify({'success': False, 'error': 'Código de entrega obrigatório'}), 400

    try:
        with get_db_cursor() as cursor:
            # Busca o código real para comparação case-insensitive
            cursor.execute(
                "SELECT codigo_entrega FROM nutricao_solicitacoes WHERE id = %s AND status = 'em_entrega'",
                (sid,)
            )
            row = cursor.fetchone()

            if not row:
                return jsonify({'success': False, 'error': 'Solicitação não encontrada ou status inválido'}), 400

            if row['codigo_entrega'].upper() != codigo_confirmacao:
                return jsonify({'success': False, 'error': 'Código de entrega inválido'}), 400

            cursor.execute("""
                UPDATE nutricao_solicitacoes
                SET status = 'entregue',
                    dt_entrega = NOW(),
                    observacao_entrega = %s,
                    atualizado_em = NOW()
                WHERE id = %s AND status = 'em_entrega'
            """, (observacao_entrega, sid))

        return jsonify({'success': True, 'novo_status': 'entregue'})
    except Exception as e:
        current_app.logger.error('Erro entregar p42 id=%s: %s', sid, e, exc_info=True)
        return jsonify({'success': False, 'error': 'Erro ao confirmar entrega'}), 500


# =========================================================
# CANCELAR (qualquer etapa exceto entregue)
# =========================================================

@painel42_bp.route('/api/paineis/painel42/solicitacoes/<int:sid>/cancelar', methods=['PUT'])
@login_required
def api_p42_cancelar(sid):
    dados  = request.get_json(silent=True) or {}
    motivo = (dados.get('motivo') or '').strip()

    if len(motivo) < 10:
        return jsonify({'success': False, 'error': 'Motivo deve ter pelo menos 10 caracteres'}), 400

    try:
        with get_db_cursor() as cursor:
            cursor.execute("""
                UPDATE nutricao_solicitacoes
                SET status = 'cancelado',
                    dt_cancelamento = NOW(),
                    motivo_cancelamento = %s,
                    atualizado_em = NOW()
                WHERE id = %s AND status != 'entregue'
            """, (motivo, sid))

            if cursor.rowcount == 0:
                return jsonify({'success': False, 'error': 'Solicitação não encontrada ou já entregue'}), 400

        return jsonify({'success': True})
    except Exception as e:
        current_app.logger.error('Erro cancelar p42 id=%s: %s', sid, e, exc_info=True)
        return jsonify({'success': False, 'error': 'Erro ao cancelar'}), 500


# =========================================================
# HISTÓRICO DO DIA (entregues + cancelados)
# =========================================================

@painel42_bp.route('/api/paineis/painel42/historico-hoje', methods=['GET'])
@login_required
def api_p42_historico_hoje():
    responsavel_id = request.args.get('responsavel_id')

    try:
        with get_db_cursor() as cursor:
            if responsavel_id:
                cursor.execute("""
                    SELECT id, codigo_entrega, nm_paciente, leito, setor_nome,
                        tipo_dieta_nome, refeicao_nome, prioridade, status,
                        responsavel_nome, entregue_por, motivo_cancelamento,
                        TO_CHAR(criado_em,       'HH24:MI') AS criado_em,
                        TO_CHAR(dt_entrega,      'HH24:MI') AS dt_entrega,
                        TO_CHAR(dt_cancelamento, 'HH24:MI') AS dt_cancelamento,
                        CASE WHEN dt_entrega IS NOT NULL
                            THEN ROUND(EXTRACT(EPOCH FROM (dt_entrega - criado_em)) / 60)::int
                        END AS t_total_min
                    FROM nutricao_solicitacoes
                    WHERE DATE(criado_em) = CURRENT_DATE
                      AND status IN ('entregue', 'cancelado')
                      AND responsavel_id = %s
                    ORDER BY COALESCE(dt_entrega, dt_cancelamento) DESC
                """, (responsavel_id,))
            else:
                cursor.execute("""
                    SELECT id, codigo_entrega, nm_paciente, leito, setor_nome,
                        tipo_dieta_nome, refeicao_nome, prioridade, status,
                        responsavel_nome, entregue_por, motivo_cancelamento,
                        TO_CHAR(criado_em,       'HH24:MI') AS criado_em,
                        TO_CHAR(dt_entrega,      'HH24:MI') AS dt_entrega,
                        TO_CHAR(dt_cancelamento, 'HH24:MI') AS dt_cancelamento,
                        CASE WHEN dt_entrega IS NOT NULL
                            THEN ROUND(EXTRACT(EPOCH FROM (dt_entrega - criado_em)) / 60)::int
                        END AS t_total_min
                    FROM nutricao_solicitacoes
                    WHERE DATE(criado_em) = CURRENT_DATE
                      AND status IN ('entregue', 'cancelado')
                    ORDER BY COALESCE(dt_entrega, dt_cancelamento) DESC
                """)
            historico = [dict(r) for r in cursor.fetchall()]

        return jsonify({'success': True, 'historico': historico})
    except Exception as e:
        current_app.logger.error('Erro historico-hoje p42: %s', e, exc_info=True)
        return jsonify({'success': False, 'error': 'Erro ao buscar histórico'}), 500
