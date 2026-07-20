"""
Painel 42 - Tela da Nutrição
Endpoints para a equipe de nutrição gerenciar a fila de dietas (Kanban).
"""
from flask import Blueprint, jsonify, request, send_from_directory, session, current_app
from backend.database import get_db_cursor
from backend.middleware.decorators import login_required, panel_permission_required
from backend.cache import cache_route
import re

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
                    id, codigo_entrega, nr_atendimento, nm_paciente, leito, setor_nome, ds_clinica,
                    tipo_dieta_id, tipo_dieta_nome, refeicao_id, refeicao_nome, quantidade, restricoes,
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
    dados                    = request.get_json(silent=True) or {}
    nr_atend_confirmacao     = (dados.get('nr_atendimento_confirmacao') or '').strip()
    observacao_entrega       = (dados.get('observacao_entrega') or '').strip() or None

    if not nr_atend_confirmacao:
        return jsonify({'success': False, 'error': 'Número de atendimento obrigatório'}), 400

    try:
        with get_db_cursor() as cursor:
            cursor.execute(
                "SELECT nr_atendimento FROM nutricao_solicitacoes WHERE id = %s AND status = 'em_entrega'",
                (sid,)
            )
            row = cursor.fetchone()

            if not row:
                return jsonify({'success': False, 'error': 'Solicitação não encontrada ou status inválido'}), 400

            if row['nr_atendimento'].strip() != nr_atend_confirmacao:
                return jsonify({'success': False, 'error': 'Número de atendimento incorreto'}), 400

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
# ENTREGAR COM ASSINATURA DIGITAL (em_entrega → entregue)
# =========================================================

@painel42_bp.route('/api/paineis/painel42/solicitacoes/<int:sid>/entregar-assinado', methods=['PUT'])
@login_required
def api_p42_entregar_assinado(sid):
    dados        = request.get_json(silent=True) or {}
    assinatura_id = dados.get('assinatura_id')

    if not assinatura_id or not str(assinatura_id).isdigit():
        return jsonify({'success': False, 'error': 'assinatura_id inválido'}), 400

    assinatura_id = int(assinatura_id)

    try:
        with get_db_cursor() as cursor:
            # Verifica que a assinatura existe e pertence ao contexto correto
            cursor.execute(
                "SELECT id FROM assinaturas_digitais WHERE id = %s AND contexto = 'entrega_refeicao'",
                (assinatura_id,)
            )
            if not cursor.fetchone():
                return jsonify({'success': False, 'error': 'Assinatura digital não encontrada ou inválida'}), 404

            cursor.execute("""
                UPDATE nutricao_solicitacoes
                SET status = 'entregue',
                    dt_entrega = NOW(),
                    atualizado_em = NOW()
                WHERE id = %s AND status = 'em_entrega'
            """, (sid,))

            if cursor.rowcount == 0:
                return jsonify({'success': False, 'error': 'Solicitação não encontrada ou status inválido'}), 400

        return jsonify({'success': True, 'novo_status': 'entregue'})
    except Exception as e:
        current_app.logger.error('Erro entregar-assinado p42 id=%s: %s', sid, e, exc_info=True)
        return jsonify({'success': False, 'error': 'Erro ao confirmar entrega assinada'}), 500


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
                    SELECT id, codigo_entrega, nr_atendimento, nm_paciente, leito, setor_nome,
                        tipo_dieta_nome, refeicao_nome, restricoes, observacao, prioridade, status,
                        responsavel_nome, entregue_por, motivo_cancelamento,
                        TO_CHAR(criado_em,       'DD/MM/YYYY') AS data_pedido,
                        TO_CHAR(criado_em,       'HH24:MI')   AS criado_em,
                        TO_CHAR(dt_entrega,      'HH24:MI')   AS dt_entrega,
                        TO_CHAR(dt_cancelamento, 'HH24:MI')   AS dt_cancelamento,
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
                    SELECT id, codigo_entrega, nr_atendimento, nm_paciente, leito, setor_nome,
                        tipo_dieta_nome, refeicao_nome, restricoes, observacao, prioridade, status,
                        responsavel_nome, entregue_por, motivo_cancelamento,
                        TO_CHAR(criado_em,       'DD/MM/YYYY') AS data_pedido,
                        TO_CHAR(criado_em,       'HH24:MI')   AS criado_em,
                        TO_CHAR(dt_entrega,      'HH24:MI')   AS dt_entrega,
                        TO_CHAR(dt_cancelamento, 'HH24:MI')   AS dt_cancelamento,
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


# =========================================================
# EDITAR SOLICITAÇÃO (tipo dieta, refeição, observação)
# =========================================================

@painel42_bp.route('/api/paineis/painel42/solicitacoes/<int:sid>/editar', methods=['PUT'])
@login_required
def api_p42_editar(sid):
    dados         = request.get_json(silent=True) or {}
    tipo_dieta_id = dados.get('tipo_dieta_id')
    refeicao_id   = dados.get('refeicao_id')
    observacao    = (dados.get('observacao') or '').strip() or None

    if not tipo_dieta_id or not refeicao_id:
        return jsonify({'success': False, 'error': 'Tipo de dieta e refeição são obrigatórios'}), 400

    try:
        with get_db_cursor() as cursor:
            cursor.execute(
                "SELECT nome FROM nutricao_tipos_dieta WHERE id = %s AND ativo = TRUE",
                (tipo_dieta_id,)
            )
            tipo = cursor.fetchone()
            if not tipo:
                return jsonify({'success': False, 'error': 'Tipo de dieta inválido'}), 400

            cursor.execute(
                "SELECT nome FROM nutricao_refeicoes WHERE id = %s AND ativo = TRUE",
                (refeicao_id,)
            )
            ref = cursor.fetchone()
            if not ref:
                return jsonify({'success': False, 'error': 'Refeição inválida'}), 400

            # Preserve [Retorno:] audit notes written by voltar-status
            cursor.execute(
                "SELECT observacao FROM nutricao_solicitacoes WHERE id = %s AND status NOT IN ('em_entrega', 'entregue', 'cancelado')",
                (sid,)
            )
            obs_row = cursor.fetchone()
            if not obs_row:
                return jsonify({'success': False, 'error': 'Solicitação não encontrada ou já finalizada'}), 400

            obs_atual = obs_row['observacao'] or ''
            notas_audit = re.findall(r'\[Retorno:[^\]]+\]', obs_atual)
            if notas_audit:
                suffix = ' | '.join(notas_audit)
                observacao_final = (observacao + ' | ' + suffix) if observacao else suffix
            else:
                observacao_final = observacao

            cursor.execute("""
                UPDATE nutricao_solicitacoes
                SET tipo_dieta_id   = %s,
                    tipo_dieta_nome = %s,
                    refeicao_id     = %s,
                    refeicao_nome   = %s,
                    observacao      = %s,
                    atualizado_em   = NOW()
                WHERE id = %s AND status NOT IN ('em_entrega', 'entregue', 'cancelado')
            """, (tipo_dieta_id, tipo['nome'], refeicao_id, ref['nome'], observacao_final, sid))

            if cursor.rowcount == 0:
                return jsonify({'success': False, 'error': 'Solicitação não encontrada ou já finalizada'}), 400

        current_app.logger.info('Solicitação %s editada pela nutrição (usuario: %s)',
                                sid, session.get('usuario', '?'))
        return jsonify({'success': True})
    except Exception as e:
        current_app.logger.error('Erro editar p42 id=%s: %s', sid, e, exc_info=True)
        return jsonify({'success': False, 'error': 'Erro ao editar solicitação'}), 500


# =========================================================
# VOLTAR STATUS (com justificativa)
# =========================================================

@painel42_bp.route('/api/paineis/painel42/solicitacoes/<int:sid>/voltar-status', methods=['PUT'])
@login_required
def api_p42_voltar_status(sid):
    dados  = request.get_json(silent=True) or {}
    motivo = (dados.get('motivo') or '').strip()

    if len(motivo) < 10:
        return jsonify({'success': False, 'error': 'Justificativa deve ter pelo menos 10 caracteres'}), 400

    try:
        with get_db_cursor() as cursor:
            cursor.execute(
                "SELECT status FROM nutricao_solicitacoes WHERE id = %s",
                (sid,)
            )
            row = cursor.fetchone()
            if not row:
                return jsonify({'success': False, 'error': 'Solicitação não encontrada'}), 404

            status_atual = row['status']
            nota = '[Retorno: ' + motivo + ']'

            if status_atual == 'aceito':
                cursor.execute("""
                    UPDATE nutricao_solicitacoes
                    SET status = 'aguardando', responsavel_id = NULL, responsavel_nome = NULL,
                        dt_aceite = NULL,
                        observacao = COALESCE(NULLIF(observacao,'') || ' | ' || %s, %s),
                        atualizado_em = NOW()
                    WHERE id = %s AND status = 'aceito'
                """, (nota, nota, sid))
            elif status_atual == 'em_preparo':
                cursor.execute("""
                    UPDATE nutricao_solicitacoes
                    SET status = 'aceito', dt_inicio_preparo = NULL,
                        observacao = COALESCE(NULLIF(observacao,'') || ' | ' || %s, %s),
                        atualizado_em = NOW()
                    WHERE id = %s AND status = 'em_preparo'
                """, (nota, nota, sid))
            elif status_atual == 'pronto':
                cursor.execute("""
                    UPDATE nutricao_solicitacoes
                    SET status = 'em_preparo', dt_pronto = NULL,
                        observacao = COALESCE(NULLIF(observacao,'') || ' | ' || %s, %s),
                        atualizado_em = NOW()
                    WHERE id = %s AND status = 'pronto'
                """, (nota, nota, sid))
            elif status_atual == 'em_entrega':
                cursor.execute("""
                    UPDATE nutricao_solicitacoes
                    SET status = 'pronto', dt_inicio_entrega = NULL, entregue_por = NULL,
                        observacao = COALESCE(NULLIF(observacao,'') || ' | ' || %s, %s),
                        atualizado_em = NOW()
                    WHERE id = %s AND status = 'em_entrega'
                """, (nota, nota, sid))
            else:
                return jsonify({'success': False, 'error': 'Não é possível voltar o status atual'}), 400

            if cursor.rowcount == 0:
                return jsonify({'success': False, 'error': 'Status alterado por outro usuário. Recarregue a página.'}), 409

        current_app.logger.info('Solicitação %s voltou de %s (usuario: %s, motivo: %s)',
                                sid, status_atual, session.get('usuario', '?'), motivo)
        return jsonify({'success': True})
    except Exception as e:
        current_app.logger.error('Erro voltar-status p42 id=%s: %s', sid, e, exc_info=True)
        return jsonify({'success': False, 'error': 'Erro ao voltar status'}), 500


# =========================================================
# IMPRESSÃO ZPL — IMPRESSORA PADRÃO WINDOWS
# =========================================================

@painel42_bp.route('/api/paineis/painel42/imprimir-zpl', methods=['POST'])
@login_required
def api_p42_imprimir_zpl():
    """Envia ZPL direto para a impressora padrão do servidor (sem diálogo no browser)."""
    data = request.get_json() or {}
    zpl = (data.get('zpl') or '').strip()
    if not zpl:
        return jsonify({'success': False, 'error': 'ZPL não informado'}), 400

    try:
        import win32print
        printer_name = win32print.GetDefaultPrinter()
        h = win32print.OpenPrinter(printer_name)
        try:
            j = win32print.StartDocPrinter(h, 1, ('Etiqueta HAC', None, 'RAW'))
            try:
                win32print.StartPagePrinter(h)
                win32print.WritePrinter(h, zpl.encode('utf-8'))
                win32print.EndPagePrinter(h)
            finally:
                win32print.EndDocPrinter(h)
        finally:
            win32print.ClosePrinter(h)
        current_app.logger.info('Etiqueta ZPL → %s (usuario: %s)',
                                printer_name, session.get('usuario', '?'))
        return jsonify({'success': True, 'impressora': printer_name})
    except Exception as e:
        current_app.logger.error('Erro impressao ZPL: %s', e, exc_info=True)
        return jsonify({'success': False, 'error': 'Erro ao enviar impressão'}), 500
