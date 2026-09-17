"""
Painel 52 - Solicitar Transporte de Material
Subsistema de Transporte de Material — HAC
"""
from flask import Blueprint, jsonify, request, send_from_directory, session, current_app
from datetime import datetime
from backend.database import get_db_cursor
from backend.middleware.decorators import login_required, panel_permission_required
from backend.cache import cache_delete_pattern

painel52_bp = Blueprint('painel52', __name__)


# =========================================================
# PÁGINA
# =========================================================

@painel52_bp.route('/painel/painel52')
@login_required
@panel_permission_required('painel52')
def painel52():
    return send_from_directory('paineis/painel52', 'index.html')


# =========================================================
# TIPOS DE CARGA
# =========================================================

@painel52_bp.route('/api/paineis/painel52/tipos-carga', methods=['GET'])
@login_required
@panel_permission_required('painel52')
def api_painel52_tipos_carga():
    try:
        with get_db_cursor() as cursor:
            cursor.execute("""
                SELECT id, nome, icone, cor, requer_lista_itens, requer_assinatura,
                       requer_foto, foto_obrigatoria
                FROM transporte_material_tipos_carga
                WHERE ativo = TRUE
                ORDER BY ordem, nome
            """)
            tipos = [dict(r) for r in cursor.fetchall()]
        return jsonify({'success': True, 'tipos': tipos})
    except Exception as e:
        current_app.logger.error('Erro tipos-carga painel52: %s', e, exc_info=True)
        return jsonify({'success': False, 'error': 'Erro ao buscar tipos de carga'}), 500


# =========================================================
# ORIGENS
# =========================================================

@painel52_bp.route('/api/paineis/painel52/origens', methods=['GET'])
@login_required
@panel_permission_required('painel52')
def api_painel52_origens():
    try:
        with get_db_cursor() as cursor:
            cursor.execute("""
                SELECT nome FROM transporte_material_origens
                WHERE ativo = TRUE
                ORDER BY ordem, nome
            """)
            origens = [dict(r) for r in cursor.fetchall()]
        return jsonify({'success': True, 'origens': origens})
    except Exception as e:
        current_app.logger.error('Erro origens painel52: %s', e, exc_info=True)
        return jsonify({'success': False, 'error': 'Erro ao buscar origens'}), 500


# =========================================================
# DESTINOS
# =========================================================

@painel52_bp.route('/api/paineis/painel52/destinos', methods=['GET'])
@login_required
@panel_permission_required('painel52')
def api_painel52_destinos():
    tipo_id = request.args.get('tipo_id', '').strip()
    try:
        with get_db_cursor() as cursor:
            if tipo_id:
                cursor.execute("""
                    SELECT nome FROM transporte_material_destinos
                    WHERE tipo_carga_id = %s AND ativo = TRUE
                    ORDER BY ordem, nome
                """, (tipo_id,))
                especificos = [dict(r) for r in cursor.fetchall()]
                if especificos:
                    return jsonify({'success': True, 'destinos': especificos})

            # Fallback: destinos gerais (sem tipo vinculado)
            cursor.execute("""
                SELECT nome FROM transporte_material_destinos
                WHERE tipo_carga_id IS NULL AND ativo = TRUE
                ORDER BY ordem, nome
            """)
            destinos = [dict(r) for r in cursor.fetchall()]
        return jsonify({'success': True, 'destinos': destinos})
    except Exception as e:
        current_app.logger.error('Erro destinos painel52: %s', e, exc_info=True)
        return jsonify({'success': False, 'error': 'Erro ao buscar destinos'}), 500


# =========================================================
# CRIAR SOLICITAÇÃO
# =========================================================

@painel52_bp.route('/api/paineis/painel52/solicitar', methods=['POST'])
@login_required
@panel_permission_required('painel52')
def api_painel52_solicitar():
    usuario_id = session.get('usuario_id')
    dados = request.get_json() or {}

    tipo_carga_id        = dados.get('tipo_carga_id')
    tipo_carga_nome      = (dados.get('tipo_carga_nome') or '').strip()
    descricao            = (dados.get('descricao') or '').strip()
    setor_origem_nome    = (dados.get('setor_origem_nome') or '').strip()
    destino_nome         = (dados.get('destino_nome') or '').strip()
    destino_complemento  = (dados.get('destino_complemento') or '').strip()
    observacao           = (dados.get('observacao') or '').strip()
    prioridade           = dados.get('prioridade', 'normal')
    itens                = dados.get('itens') or []
    foto_carga           = (dados.get('foto_carga') or '').strip() or None
    tipo_solicitacao     = dados.get('tipo_solicitacao', 'imediato')
    dt_agendamento_str   = (dados.get('dt_agendamento') or '').strip() or None

    if foto_carga and not foto_carga.startswith('data:image/'):
        foto_carga = None

    if not tipo_carga_id or not setor_origem_nome or not destino_nome:
        return jsonify({'success': False,
                        'error': 'Tipo de carga, setor de origem e destino sao obrigatorios'}), 400

    if prioridade not in ('normal', 'urgente'):
        prioridade = 'normal'

    if tipo_solicitacao not in ('imediato', 'agendado'):
        tipo_solicitacao = 'imediato'

    dt_agendamento = None
    if tipo_solicitacao == 'agendado':
        if not dt_agendamento_str:
            return jsonify({'success': False,
                            'error': 'Informe a data e hora do agendamento'}), 400
        try:
            dt_agendamento = datetime.fromisoformat(dt_agendamento_str)
            if dt_agendamento <= datetime.now():
                return jsonify({'success': False,
                                'error': 'A data/hora do agendamento deve ser no futuro'}), 400
        except (ValueError, TypeError):
            return jsonify({'success': False, 'error': 'Data de agendamento invalida'}), 400

    try:
        with get_db_cursor() as cursor:
            # Gerar protocolo
            cursor.execute("SELECT gerar_protocolo_transporte() AS proto")
            nr_protocolo = cursor.fetchone()['proto']

            solicitante_nome = session.get('nome_completo') or session.get('usuario', 'Desconhecido')

            cursor.execute("""
                INSERT INTO transporte_material_solicitacoes (
                    nr_protocolo, tipo_carga_id, tipo_carga_nome,
                    descricao, setor_origem_nome, destino_nome, destino_complemento,
                    observacao, prioridade, status,
                    tipo_solicitacao, dt_agendamento,
                    solicitante_id, solicitante_nome, foto_carga, criado_em
                ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, 'aguardando', %s, %s, %s, %s, %s, NOW())
                RETURNING id
            """, (
                nr_protocolo, tipo_carga_id, tipo_carga_nome or None,
                descricao or None, setor_origem_nome, destino_nome, destino_complemento or None,
                observacao or None, prioridade,
                tipo_solicitacao, dt_agendamento,
                usuario_id, solicitante_nome, foto_carga
            ))
            solicitacao_id = cursor.fetchone()['id']

            # Inserir itens do manifesto
            for idx, item in enumerate(itens):
                desc_item = (item.get('descricao') or '').strip()
                if not desc_item:
                    continue
                qtd = item.get('quantidade', 1)
                try:
                    qtd = float(qtd)
                except (ValueError, TypeError):
                    qtd = 1
                unidade = (item.get('unidade') or 'unidade').strip()
                obs_item = (item.get('observacao') or '').strip()
                nr_id = (item.get('nr_identificador') or '').strip() or None
                cursor.execute("""
                    INSERT INTO transporte_material_itens
                        (solicitacao_id, descricao, quantidade, unidade, observacao, nr_identificador, ordem)
                    VALUES (%s, %s, %s, %s, %s, %s, %s)
                """, (solicitacao_id, desc_item, qtd, unidade, obs_item or None, nr_id, idx))

        cache_delete_pattern('painel54:*')
        current_app.logger.info(
            'Solicitacao transporte: id=%s protocolo=%s por=%s',
            solicitacao_id, nr_protocolo, solicitante_nome
        )
        return jsonify({
            'success': True,
            'chamado_id': solicitacao_id,
            'nr_protocolo': nr_protocolo,
            'message': 'Solicitacao registrada com sucesso'
        }), 201

    except Exception as e:
        current_app.logger.error('Erro solicitar painel52: %s', e, exc_info=True)
        return jsonify({'success': False, 'error': 'Erro ao criar solicitacao'}), 500


# =========================================================
# MEUS CHAMADOS (últimas 24h do usuário logado)
# =========================================================

@painel52_bp.route('/api/paineis/painel52/meus-chamados', methods=['GET'])
@login_required
@panel_permission_required('painel52')
def api_painel52_meus_chamados():
    usuario_id = session.get('usuario_id')
    if not usuario_id:
        return jsonify({'success': False, 'error': 'Sessao invalida'}), 401
    try:
        with get_db_cursor() as cursor:
            cursor.execute("""
                SELECT
                    s.id, s.nr_protocolo, s.tipo_carga_nome,
                    s.descricao, s.setor_origem_nome, s.destino_nome,
                    s.prioridade, s.status, s.motorista_nome,
                    s.criado_em, s.dt_aceite, s.dt_inicio_transporte,
                    s.dt_entrega, s.dt_cancelamento, s.motivo_cancelamento,
                    s.nm_destinatario,
                    ROUND(EXTRACT(EPOCH FROM (NOW() - s.criado_em)) / 60, 1) AS minutos_desde_abertura,
                    tc.icone AS tipo_carga_icone, tc.cor AS tipo_carga_cor
                FROM transporte_material_solicitacoes s
                LEFT JOIN transporte_material_tipos_carga tc ON tc.id = s.tipo_carga_id
                WHERE s.solicitante_id = %s
                  AND s.criado_em >= NOW() - INTERVAL '24 hours'
                ORDER BY s.criado_em DESC
                LIMIT 20
            """, (usuario_id,))

            chamados = []
            for row in cursor.fetchall():
                c = dict(row)
                for campo in ['criado_em', 'dt_aceite', 'dt_inicio_transporte',
                              'dt_entrega', 'dt_cancelamento']:
                    if c.get(campo) and isinstance(c[campo], datetime):
                        c[campo] = c[campo].isoformat()
                if c.get('minutos_desde_abertura') is not None:
                    c['minutos_desde_abertura'] = round(float(c['minutos_desde_abertura']), 1)
                chamados.append(c)

        return jsonify({'success': True, 'chamados': chamados, 'total': len(chamados)})
    except Exception as e:
        current_app.logger.error('Erro meus-chamados painel52: %s', e, exc_info=True)
        return jsonify({'success': False, 'error': 'Erro ao buscar chamados'}), 500


# =========================================================
# CANCELAR CHAMADO (pelo solicitante)
# =========================================================

@painel52_bp.route('/api/paineis/painel52/chamados/<int:chamado_id>/cancelar', methods=['PUT'])
@login_required
@panel_permission_required('painel52')
def api_painel52_cancelar(chamado_id):
    usuario_id = session.get('usuario_id')
    is_admin = session.get('is_admin', False)
    dados = request.get_json() or {}
    motivo = (dados.get('motivo') or 'Cancelado pelo solicitante').strip()

    try:
        with get_db_cursor() as cursor:
            cursor.execute(
                "SELECT id, status, solicitante_id FROM transporte_material_solicitacoes WHERE id = %s",
                (chamado_id,)
            )
            chamado = cursor.fetchone()
            if not chamado:
                return jsonify({'success': False, 'error': 'Chamado nao encontrado'}), 404

            if not is_admin and chamado['solicitante_id'] != usuario_id:
                return jsonify({'success': False, 'error': 'Sem permissao para cancelar este chamado'}), 403

            if chamado['status'] not in ('aguardando', 'aceito'):
                return jsonify({
                    'success': False,
                    'error': 'Chamado nao pode ser cancelado no status: ' + chamado['status']
                }), 400

            cursor.execute("""
                UPDATE transporte_material_solicitacoes
                SET status = 'cancelado',
                    dt_cancelamento = NOW(),
                    motivo_cancelamento = %s,
                    atualizado_em = NOW()
                WHERE id = %s
            """, (motivo, chamado_id))

        cache_delete_pattern('painel54:*')
        return jsonify({'success': True, 'message': 'Chamado cancelado com sucesso'})
    except Exception as e:
        current_app.logger.error('Erro cancelar painel52: %s', e, exc_info=True)
        return jsonify({'success': False, 'error': 'Erro ao cancelar chamado'}), 500
