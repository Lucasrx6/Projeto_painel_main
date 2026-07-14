"""
Painel 41 - Solicitar Dieta
Endpoints para solicitação de refeições/dietas pelos postos de enfermagem.
"""
from flask import Blueprint, jsonify, request, send_from_directory, session, current_app
from datetime import datetime
from backend.database import get_db_cursor
from backend.middleware.decorators import login_required, panel_permission_required
from backend.cache import cache_route, cache_delete_pattern

painel41_bp = Blueprint('painel41', __name__)


@painel41_bp.route('/painel/painel41')
@login_required
@panel_permission_required('painel41')
def painel41():
    return send_from_directory('paineis/painel41', 'index.html')


# =========================================================
# CONFIGURAÇÕES — TIPOS DE DIETA
# =========================================================

@painel41_bp.route('/api/paineis/painel41/tipos-dieta', methods=['GET'])
@login_required
@cache_route(ttl=300, key_prefix='p41:tipos_dieta')
def api_p41_tipos_dieta():
    try:
        with get_db_cursor() as cursor:
            cursor.execute("""
                SELECT id, nome, icone, cor, descricao
                FROM nutricao_tipos_dieta
                WHERE ativo = TRUE
                ORDER BY ordem, nome
            """)
            tipos = [dict(r) for r in cursor.fetchall()]
        return jsonify({'success': True, 'tipos': tipos})
    except Exception as e:
        current_app.logger.error('Erro tipos-dieta p41: %s', e, exc_info=True)
        return jsonify({'success': False, 'error': 'Erro ao buscar tipos de dieta'}), 500


# =========================================================
# CONFIGURAÇÕES — REFEIÇÕES
# =========================================================

@painel41_bp.route('/api/paineis/painel41/refeicoes', methods=['GET'])
@login_required
@cache_route(ttl=300, key_prefix='p41:refeicoes')
def api_p41_refeicoes():
    try:
        with get_db_cursor() as cursor:
            cursor.execute("""
                SELECT id, nome, icone,
                    TO_CHAR(horario_inicio, 'HH24:MI') AS horario_inicio,
                    TO_CHAR(horario_fim,    'HH24:MI') AS horario_fim
                FROM nutricao_refeicoes
                WHERE ativo = TRUE
                ORDER BY ordem
            """)
            refeicoes = [dict(r) for r in cursor.fetchall()]
        return jsonify({'success': True, 'refeicoes': refeicoes})
    except Exception as e:
        current_app.logger.error('Erro refeicoes p41: %s', e, exc_info=True)
        return jsonify({'success': False, 'error': 'Erro ao buscar refeições'}), 500


# =========================================================
# CONFIGURAÇÕES — RESTRIÇÕES ALIMENTARES
# =========================================================

@painel41_bp.route('/api/paineis/painel41/restricoes', methods=['GET'])
@login_required
@cache_route(ttl=300, key_prefix='p41:restricoes')
def api_p41_restricoes():
    try:
        with get_db_cursor() as cursor:
            cursor.execute("""
                SELECT id, nome, sigla, icone, cor
                FROM nutricao_restricoes
                WHERE ativo = TRUE
                ORDER BY ordem
            """)
            restricoes = [dict(r) for r in cursor.fetchall()]
        return jsonify({'success': True, 'restricoes': restricoes})
    except Exception as e:
        current_app.logger.error('Erro restricoes p41: %s', e, exc_info=True)
        return jsonify({'success': False, 'error': 'Erro ao buscar restrições'}), 500


# =========================================================
# SETORES DO HOSPITAL (distinct da tabela padioleiro)
# =========================================================

@painel41_bp.route('/api/paineis/painel41/setores', methods=['GET'])
@login_required
@cache_route(ttl=180, key_prefix='p41:setores')
def api_p41_setores():
    try:
        with get_db_cursor() as cursor:
            cursor.execute("""
                SELECT DISTINCT setor AS nome
                FROM padioleiro
                WHERE setor IS NOT NULL AND TRIM(setor) != ''
                ORDER BY setor
            """)
            setores = [dict(r) for r in cursor.fetchall()]
        return jsonify({'success': True, 'setores': setores})
    except Exception as e:
        current_app.logger.error('Erro setores p41: %s', e, exc_info=True)
        return jsonify({'success': False, 'error': 'Erro ao buscar setores'}), 500


# =========================================================
# BUSCA DE PACIENTES (tabela padioleiro — mesma fonte do P34)
# =========================================================

@painel41_bp.route('/api/paineis/painel41/pacientes', methods=['GET'])
@login_required
def api_p41_pacientes():
    q = (request.args.get('q') or '').strip()
    if len(q) < 3:
        return jsonify({'success': False, 'error': 'Mínimo 3 caracteres para busca'}), 400

    try:
        with get_db_cursor() as cursor:
            cursor.execute("""
                SELECT DISTINCT
                    nr_atendimento,
                    nm_pessoa_fisica                      AS nm_paciente,
                    TRIM(cd_unidade)                     AS leito,
                    setor                                AS setor_nome,
                    cd_unidade,
                    ds_clinica,
                    ie_sexo,
                    qt_dia_permanencia                   AS dias_internado,
                    TO_CHAR(dt_nascimento, 'YYYY-MM-DD') AS dt_nascimento
                FROM padioleiro
                WHERE (
                    nm_pessoa_fisica   ILIKE %s
                    OR nr_atendimento  ILIKE %s
                    OR TRIM(cd_unidade) ILIKE %s
                )
                ORDER BY nm_pessoa_fisica
                LIMIT 20
            """, (f'%{q}%', f'%{q}%', f'%{q}%'))
            pacientes = [dict(r) for r in cursor.fetchall()]
        return jsonify({'success': True, 'pacientes': pacientes})
    except Exception as e:
        current_app.logger.error('Erro busca pacientes p41: %s', e, exc_info=True)
        return jsonify({'success': False, 'error': 'Erro ao buscar pacientes'}), 500


# =========================================================
# SOLICITAR DIETA
# =========================================================

@painel41_bp.route('/api/paineis/painel41/solicitar', methods=['POST'])
@login_required
def api_p41_solicitar():
    dados = request.get_json(silent=True) or {}

    # Validações obrigatórias
    nr_atendimento = (dados.get('nr_atendimento') or '').strip()
    nm_paciente    = (dados.get('nm_paciente') or '').strip()
    tipo_dieta_id  = dados.get('tipo_dieta_id')
    refeicao_id    = dados.get('refeicao_id')
    try:
        quantidade = int(dados.get('quantidade') or 1)
    except (ValueError, TypeError):
        return jsonify({'success': False, 'error': 'Quantidade deve ser um número inteiro entre 1 e 10'}), 400
    prioridade     = (dados.get('prioridade') or 'normal').strip()

    if not nr_atendimento or not nm_paciente:
        return jsonify({'success': False, 'error': 'Paciente obrigatório'}), 400
    if not tipo_dieta_id:
        return jsonify({'success': False, 'error': 'Tipo de dieta obrigatório'}), 400
    if not refeicao_id:
        return jsonify({'success': False, 'error': 'Refeição obrigatória'}), 400
    if not (1 <= quantidade <= 10):
        return jsonify({'success': False, 'error': 'Quantidade deve ser entre 1 e 10'}), 400
    if prioridade not in ('normal', 'urgente'):
        return jsonify({'success': False, 'error': 'Prioridade inválida'}), 400

    leito         = (dados.get('leito') or '').strip() or None
    setor_nome    = (dados.get('setor_nome') or '').strip() or None
    cd_unidade    = (dados.get('cd_unidade') or '').strip() or None
    ds_clinica    = (dados.get('ds_clinica') or '').strip() or None
    restricoes    = (dados.get('restricoes_txt') or '').strip() or None
    observacao    = (dados.get('observacao') or '').strip() or None
    dt_nascimento = (dados.get('dt_nascimento') or '').strip() or None

    solicitante_id   = session.get('usuario_id')
    solicitante_nome = session.get('nome_completo') or session.get('usuario')

    try:
        with get_db_cursor() as cursor:
            # Valida tipo de dieta
            cursor.execute(
                "SELECT nome FROM nutricao_tipos_dieta WHERE id = %s AND ativo = TRUE",
                (tipo_dieta_id,)
            )
            row_tipo = cursor.fetchone()
            if not row_tipo:
                return jsonify({'success': False, 'error': 'Tipo de dieta inválido'}), 400
            tipo_dieta_nome = row_tipo['nome']

            # Valida refeição
            cursor.execute(
                "SELECT nome FROM nutricao_refeicoes WHERE id = %s AND ativo = TRUE",
                (refeicao_id,)
            )
            row_ref = cursor.fetchone()
            if not row_ref:
                return jsonify({'success': False, 'error': 'Refeição inválida'}), 400
            refeicao_nome = row_ref['nome']

            # Serializa geração do código para evitar duplicatas sob concorrência
            cursor.execute("SELECT pg_advisory_xact_lock(hashtext('nutricao_codigo_diario'))")

            # 1. INSERT com código temporário
            cursor.execute("""
                INSERT INTO nutricao_solicitacoes
                    (codigo_entrega, nr_atendimento, nm_paciente, leito, setor_nome,
                     cd_unidade, ds_clinica, tipo_dieta_id, tipo_dieta_nome,
                     refeicao_id, refeicao_nome, quantidade, restricoes,
                     observacao, prioridade, dt_nascimento, solicitante_id, solicitante_nome, status)
                VALUES
                    ('NUT-PENDING', %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, 'aguardando')
                RETURNING id
            """, (
                nr_atendimento, nm_paciente, leito, setor_nome, cd_unidade, ds_clinica,
                tipo_dieta_id, tipo_dieta_nome, refeicao_id, refeicao_nome,
                quantidade, restricoes, observacao, prioridade, dt_nascimento,
                solicitante_id, solicitante_nome
            ))
            new_id = cursor.fetchone()['id']

            # 2. Sequência diária atômica (conta registros do dia com id <= new_id)
            cursor.execute("""
                SELECT COUNT(*) AS seq FROM nutricao_solicitacoes
                WHERE DATE(criado_em) = CURRENT_DATE AND id <= %s
            """, (new_id,))
            seq = cursor.fetchone()['seq']
            now = datetime.now()
            codigo = 'NUT-{}-{:04d}'.format(now.strftime('%y%m%d'), seq)

            # 3. Atualizar com código definitivo
            cursor.execute(
                "UPDATE nutricao_solicitacoes SET codigo_entrega = %s WHERE id = %s",
                (codigo, new_id)
            )

        return jsonify({
            'success': True,
            'id': new_id,
            'codigo_entrega': codigo,
            'mensagem': 'Solicitação registrada com sucesso'
        }), 201

    except Exception as e:
        current_app.logger.error('Erro solicitar p41: %s', e, exc_info=True)
        return jsonify({'success': False, 'error': 'Erro ao registrar solicitação'}), 500


# =========================================================
# MINHAS SOLICITAÇÕES (últimas 24h do usuário logado)
# =========================================================

@painel41_bp.route('/api/paineis/painel41/minhas-solicitacoes', methods=['GET'])
@login_required
def api_p41_minhas_solicitacoes():
    usuario_id = session.get('usuario_id')
    try:
        with get_db_cursor() as cursor:
            cursor.execute("""
                SELECT id, codigo_entrega, nr_atendimento, nm_paciente, leito, setor_nome,
                    tipo_dieta_nome, refeicao_nome, refeicao_id, prioridade, status,
                    quantidade, restricoes, observacao,
                    TO_CHAR(criado_em, 'DD/MM/YYYY') AS data_pedido,
                    TO_CHAR(criado_em,  'HH24:MI')   AS hora_pedido,
                    TO_CHAR(dt_entrega, 'HH24:MI')   AS dt_entrega,
                    motivo_cancelamento
                FROM nutricao_solicitacoes
                WHERE solicitante_id = %s
                  AND criado_em >= NOW() - INTERVAL '24 hours'
                ORDER BY criado_em DESC
            """, (usuario_id,))
            solicitacoes = [dict(r) for r in cursor.fetchall()]
        return jsonify({'success': True, 'solicitacoes': solicitacoes})
    except Exception as e:
        current_app.logger.error('Erro minhas-solicitacoes p41: %s', e, exc_info=True)
        return jsonify({'success': False, 'error': 'Erro ao buscar solicitações'}), 500


# =========================================================
# CANCELAR (apenas o solicitante, apenas se aguardando)
# =========================================================

@painel41_bp.route('/api/paineis/painel41/solicitacoes/<int:sid>/cancelar', methods=['PUT'])
@login_required
def api_p41_cancelar(sid):
    dados  = request.get_json(silent=True) or {}
    motivo = (dados.get('motivo') or '').strip()

    if len(motivo) < 10:
        return jsonify({'success': False, 'error': 'Motivo deve ter pelo menos 10 caracteres'}), 400

    usuario_id = session.get('usuario_id')
    try:
        with get_db_cursor() as cursor:
            cursor.execute("""
                UPDATE nutricao_solicitacoes
                SET status = 'cancelado',
                    dt_cancelamento = NOW(),
                    motivo_cancelamento = %s,
                    atualizado_em = NOW()
                WHERE id = %s
                  AND solicitante_id = %s
                  AND status = 'aguardando'
            """, (motivo, sid, usuario_id))
            if cursor.rowcount == 0:
                return jsonify({
                    'success': False,
                    'error': 'Solicitação não encontrada, já processada ou não pertence a você'
                }), 400
        return jsonify({'success': True})
    except Exception as e:
        current_app.logger.error('Erro cancelar p41: %s', e, exc_info=True)
        return jsonify({'success': False, 'error': 'Erro ao cancelar'}), 500
