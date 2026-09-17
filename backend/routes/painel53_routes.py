"""
Painel 53 - Tela do Motorista
Subsistema de Transporte de Material — HAC
"""
from flask import Blueprint, jsonify, request, send_from_directory, session, current_app
from datetime import datetime
import hashlib
import json as _json
from backend.database import get_db_cursor
from backend.middleware.decorators import login_required, panel_permission_required
from backend.cache import cache_delete_pattern

painel53_bp = Blueprint('painel53', __name__)


def _serial_dt(row):
    out = {}
    for k, v in row.items():
        if isinstance(v, datetime):
            out[k] = v.isoformat()
        else:
            out[k] = v
    return out


# =========================================================
# PÁGINA
# =========================================================

@painel53_bp.route('/painel/painel53')
@login_required
@panel_permission_required('painel53')
def painel53():
    return send_from_directory('paineis/painel53', 'index.html')


# =========================================================
# LISTAR VEÍCULOS ATIVOS
# =========================================================

@painel53_bp.route('/api/paineis/painel53/veiculos', methods=['GET'])
@login_required
@panel_permission_required('painel53')
def api_painel53_veiculos():
    try:
        with get_db_cursor() as cursor:
            cursor.execute("""
                SELECT id, tipo, placa, descricao, km_max_dia
                FROM transporte_material_veiculos
                WHERE ativo = TRUE
                ORDER BY tipo, placa
            """)
            veiculos = [dict(r) for r in cursor.fetchall()]
            for v in veiculos:
                if v.get('km_max_dia') is not None:
                    v['km_max_dia'] = float(v['km_max_dia'])
        return jsonify({'success': True, 'veiculos': veiculos})
    except Exception as e:
        current_app.logger.error('Erro veiculos painel53: %s', e, exc_info=True)
        return jsonify({'success': False, 'error': 'Erro ao buscar veiculos'}), 500


# =========================================================
# LISTAR MOTORISTAS ATIVOS
# =========================================================

@painel53_bp.route('/api/paineis/painel53/motoristas', methods=['GET'])
@login_required
@panel_permission_required('painel53')
def api_painel53_motoristas():
    try:
        with get_db_cursor() as cursor:
            cursor.execute("""
                SELECT id, nome, matricula, turno
                FROM transporte_material_motoristas
                WHERE ativo = TRUE
                ORDER BY nome
            """)
            motoristas = [dict(r) for r in cursor.fetchall()]
        return jsonify({'success': True, 'motoristas': motoristas})
    except Exception as e:
        current_app.logger.error('Erro motoristas painel53: %s', e, exc_info=True)
        return jsonify({'success': False, 'error': 'Erro ao buscar motoristas'}), 500


# =========================================================
# FILA DE CHAMADOS + CHAMADOS ATIVOS DO MOTORISTA
# =========================================================

@painel53_bp.route('/api/paineis/painel53/fila', methods=['GET'])
@login_required
@panel_permission_required('painel53')
def api_painel53_fila():
    motorista_id = request.args.get('motorista_id')
    try:
        with get_db_cursor() as cursor:
            cursor.execute("""
                SELECT
                    s.id, s.nr_protocolo,
                    s.tipo_carga_nome, tc.icone AS tipo_carga_icone, tc.cor AS tipo_carga_cor,
                    tc.requer_assinatura, tc.requer_lista_itens, tc.requer_foto,
                    tc.requer_assinatura_motorista, tc.requer_foto_inicio,
                    s.descricao, s.setor_origem_nome, s.destino_nome, s.destino_complemento,
                    s.prioridade, s.status, s.solicitante_nome, s.observacao,
                    s.foto_carga,
                    s.criado_em,
                    ROUND(EXTRACT(EPOCH FROM (NOW() - s.criado_em)) / 60, 1) AS minutos_espera
                FROM transporte_material_solicitacoes s
                JOIN transporte_material_tipos_carga tc ON tc.id = s.tipo_carga_id
                WHERE s.status = 'aguardando'
                ORDER BY
                    CASE s.prioridade WHEN 'urgente' THEN 0 ELSE 1 END,
                    s.criado_em ASC
            """)
            fila = []
            for row in cursor.fetchall():
                c = _serial_dt(dict(row))
                if c.get('minutos_espera') is not None:
                    c['minutos_espera'] = float(c['minutos_espera'])
                fila.append(c)

            chamados_ativos = []
            chamado_ativo   = None   # compat com versão anterior
            if motorista_id:
                cursor.execute("""
                    SELECT
                        s.id, s.nr_protocolo, s.viagem_id,
                        s.tipo_carga_nome, tc.icone AS tipo_carga_icone, tc.cor AS tipo_carga_cor,
                        tc.requer_assinatura, tc.requer_lista_itens, tc.requer_foto,
                        tc.requer_assinatura_motorista, tc.requer_foto_inicio,
                        s.descricao, s.setor_origem_nome, s.destino_nome, s.destino_complemento,
                        s.prioridade, s.status, s.solicitante_nome, s.observacao,
                        s.foto_carga,
                        s.criado_em, s.dt_aceite, s.dt_inicio_transporte,
                        ROUND(EXTRACT(EPOCH FROM (NOW() - s.criado_em)) / 60, 1) AS minutos_espera
                    FROM transporte_material_solicitacoes s
                    JOIN transporte_material_tipos_carga tc ON tc.id = s.tipo_carga_id
                    WHERE s.motorista_id = %s AND s.status = 'em_transporte'
                    ORDER BY s.dt_inicio_transporte ASC
                """, (motorista_id,))
                for row in cursor.fetchall():
                    c = _serial_dt(dict(row))
                    if c.get('minutos_espera') is not None:
                        c['minutos_espera'] = float(c['minutos_espera'])
                    chamados_ativos.append(c)
                if chamados_ativos:
                    chamado_ativo = chamados_ativos[0]

        return jsonify({
            'success': True,
            'fila': fila,
            'chamados_ativos': chamados_ativos,
            'chamado_ativo': chamado_ativo,
            'total_fila': len(fila),
            'timestamp': datetime.now().isoformat()
        })
    except Exception as e:
        current_app.logger.error('Erro fila painel53: %s', e, exc_info=True)
        return jsonify({'success': False, 'error': 'Erro ao buscar fila'}), 500


# =========================================================
# ITENS DE UMA SOLICITAÇÃO (manifesto)
# =========================================================

@painel53_bp.route('/api/paineis/painel53/chamados/<int:chamado_id>/itens', methods=['GET'])
@login_required
@panel_permission_required('painel53')
def api_painel53_itens(chamado_id):
    try:
        with get_db_cursor() as cursor:
            cursor.execute("""
                SELECT id, descricao, quantidade, unidade, observacao, nr_identificador,
                       aceito, motivo_recusa
                FROM transporte_material_itens
                WHERE solicitacao_id = %s
                ORDER BY ordem
            """, (chamado_id,))
            itens = [dict(r) for r in cursor.fetchall()]
            for item in itens:
                if item.get('quantidade') is not None:
                    item['quantidade'] = float(item['quantidade'])
        return jsonify({'success': True, 'itens': itens})
    except Exception as e:
        current_app.logger.error('Erro itens painel53: %s', e, exc_info=True)
        return jsonify({'success': False, 'error': 'Erro ao buscar itens'}), 500


# =========================================================
# INICIAR VIAGEM (multi-chamado, com assinatura do motorista)
# =========================================================

@painel53_bp.route('/api/paineis/painel53/viagem/iniciar', methods=['POST'])
@login_required
@panel_permission_required('painel53')
def api_painel53_viagem_iniciar():
    dados               = request.get_json() or {}
    motorista_id        = dados.get('motorista_id')
    veiculo_id          = dados.get('veiculo_id') or None
    veiculo_placa       = (dados.get('veiculo_placa') or '').strip() or None
    chamado_ids         = dados.get('chamado_ids') or []
    assinatura_motorista = (dados.get('assinatura_motorista') or '').strip() or None
    foto_inicio         = (dados.get('foto_inicio') or '').strip() or None
    itens_recusados     = dados.get('itens_recusados') or []   # [{id, motivo}]

    if not motorista_id:
        return jsonify({'success': False, 'error': 'Informe o motorista_id'}), 400
    if not chamado_ids or not isinstance(chamado_ids, list):
        return jsonify({'success': False, 'error': 'Selecione pelo menos um chamado'}), 400

    if assinatura_motorista and not assinatura_motorista.startswith('data:image/png;base64,'):
        assinatura_motorista = None
    if foto_inicio and not foto_inicio.startswith('data:image/'):
        foto_inicio = None

    try:
        chamado_ids_int = [int(c) for c in chamado_ids]
    except (ValueError, TypeError):
        return jsonify({'success': False, 'error': 'IDs de chamados invalidos'}), 400

    try:
        with get_db_cursor() as cursor:
            cursor.execute(
                "SELECT id, nome FROM transporte_material_motoristas WHERE id = %s AND ativo = TRUE",
                (motorista_id,)
            )
            motorista = cursor.fetchone()
            if not motorista:
                return jsonify({'success': False, 'error': 'Motorista nao encontrado'}), 404
            motorista_nome = motorista['nome']

            # Verificar que todos os chamados ainda estão aguardando
            cursor.execute("""
                SELECT id, status, nr_protocolo FROM transporte_material_solicitacoes
                WHERE id = ANY(%s)
            """, (chamado_ids_int,))
            encontrados = cursor.fetchall()
            if len(encontrados) != len(chamado_ids_int):
                return jsonify({'success': False,
                                'error': 'Um ou mais chamados nao foram encontrados'}), 404
            for c in encontrados:
                if c['status'] != 'aguardando':
                    return jsonify({'success': False,
                                    'error': 'Chamado ' + str(c['nr_protocolo']) +
                                             ' nao esta mais disponivel (status: ' + str(c['status']) + ')'}), 409

            # Criar a viagem
            cursor.execute("""
                INSERT INTO transporte_material_viagens
                    (motorista_id, motorista_nome, veiculo_id, veiculo_placa,
                     status, foto_inicio, assinatura_motorista, dt_assinatura, criado_em, dt_inicio)
                VALUES (%s, %s, %s, %s, 'em_andamento', %s, %s, NOW(), NOW(), NOW())
                RETURNING id
            """, (motorista_id, motorista_nome, veiculo_id, veiculo_placa,
                  foto_inicio, assinatura_motorista))
            viagem_id = cursor.fetchone()['id']

            # Atualizar todos os chamados selecionados
            cursor.execute("""
                UPDATE transporte_material_solicitacoes
                SET status               = 'em_transporte',
                    motorista_id         = %s,
                    motorista_nome       = %s,
                    veiculo_id           = %s,
                    veiculo_placa        = %s,
                    viagem_id            = %s,
                    dt_aceite            = NOW(),
                    dt_inicio_transporte = NOW(),
                    atualizado_em        = NOW()
                WHERE id = ANY(%s) AND status = 'aguardando'
                RETURNING id
            """, (motorista_id, motorista_nome, veiculo_id, veiculo_placa,
                  viagem_id, chamado_ids_int))
            atualizados = len(cursor.fetchall())

            # Salvar itens recusados pelo motorista
            for item_rec in itens_recusados:
                try:
                    item_id = int(item_rec.get('id'))
                    motivo  = (item_rec.get('motivo') or 'Nao aceito pelo motorista').strip()
                    cursor.execute("""
                        UPDATE transporte_material_itens
                        SET aceito = FALSE, motivo_recusa = %s
                        WHERE id = %s AND solicitacao_id = ANY(%s)
                    """, (motivo[:300], item_id, chamado_ids_int))
                except (TypeError, ValueError):
                    pass

        cache_delete_pattern('painel54:*')
        current_app.logger.info(
            'Viagem iniciada: viagem=%s motorista=%s chamados=%s',
            viagem_id, motorista_nome, chamado_ids_int
        )
        return jsonify({
            'success': True,
            'viagem_id': viagem_id,
            'chamados_iniciados': atualizados,
            'message': 'Viagem iniciada com ' + str(atualizados) + ' chamado(s)'
        })
    except Exception as e:
        current_app.logger.error('Erro viagem-iniciar painel53: %s', e, exc_info=True)
        return jsonify({'success': False, 'error': 'Erro ao iniciar viagem'}), 500


# =========================================================
# ENTREGAR SEM ASSINATURA
# =========================================================

@painel53_bp.route('/api/paineis/painel53/chamados/<int:chamado_id>/entregar', methods=['PUT'])
@login_required
@panel_permission_required('painel53')
def api_painel53_entregar(chamado_id):
    dados           = request.get_json() or {}
    motorista_id    = dados.get('motorista_id')
    nm_destinatario = (dados.get('nm_destinatario') or '').strip()
    cpf_destinatario = (dados.get('cpf_destinatario') or '').strip() or None
    dt_nasc_dest    = dados.get('dt_nascimento_destinatario') or None
    obs_entrega     = (dados.get('observacao_entrega') or '').strip()
    veiculo_id      = dados.get('veiculo_id') or None
    veiculo_placa   = (dados.get('veiculo_placa') or '').strip() or None
    entrega_parcial = bool(dados.get('entrega_parcial', False))
    obs_parcial     = (dados.get('obs_entrega_parcial') or '').strip()

    if not motorista_id:
        return jsonify({'success': False, 'error': 'Informe o motorista_id'}), 400

    try:
        with get_db_cursor() as cursor:
            cursor.execute(
                "SELECT motorista_id, status, viagem_id FROM transporte_material_solicitacoes WHERE id = %s",
                (chamado_id,)
            )
            chamado = cursor.fetchone()
            if not chamado:
                return jsonify({'success': False, 'error': 'Chamado nao encontrado'}), 404
            if str(chamado['motorista_id']) != str(motorista_id):
                return jsonify({'success': False, 'error': 'Sem permissao para este chamado'}), 403
            if chamado['status'] != 'em_transporte':
                return jsonify({'success': False, 'error': 'Chamado nao esta em transporte'}), 400

            cursor.execute("""
                UPDATE transporte_material_solicitacoes
                SET status                      = 'entregue',
                    dt_entrega                  = NOW(),
                    nm_destinatario             = %s,
                    cpf_destinatario            = %s,
                    dt_nascimento_destinatario  = %s,
                    observacao_entrega          = %s,
                    veiculo_id                  = COALESCE(%s, veiculo_id),
                    veiculo_placa               = COALESCE(%s, veiculo_placa),
                    entrega_parcial             = %s,
                    obs_entrega_parcial         = %s,
                    atualizado_em               = NOW()
                WHERE id = %s
            """, (nm_destinatario or None, cpf_destinatario, dt_nasc_dest,
                  obs_entrega or None, veiculo_id, veiculo_placa,
                  entrega_parcial, obs_parcial or None, chamado_id))

            # Verificar se todos os chamados da viagem foram entregues
            if chamado.get('viagem_id'):
                _verificar_concluir_viagem(cursor, chamado['viagem_id'])

        cache_delete_pattern('painel54:*')
        return jsonify({'success': True, 'message': 'Entrega registrada com sucesso'})
    except Exception as e:
        current_app.logger.error('Erro entregar painel53: %s', e, exc_info=True)
        return jsonify({'success': False, 'error': 'Erro ao registrar entrega'}), 500


# =========================================================
# ENTREGAR COM ASSINATURA
# =========================================================

@painel53_bp.route('/api/paineis/painel53/chamados/<int:chamado_id>/entregar-com-assinatura', methods=['POST'])
@login_required
@panel_permission_required('painel53')
def api_painel53_entregar_com_assinatura(chamado_id):
    dados           = request.get_json() or {}
    motorista_pin   = (dados.get('motorista_pin') or '').strip()
    nm_destinatario = (dados.get('nm_destinatario') or '').strip()
    cpf_destinatario = (dados.get('cpf_destinatario') or '').strip() or None
    dt_nasc_dest    = dados.get('dt_nascimento_destinatario') or None
    assinatura_img  = (dados.get('assinatura_img') or '').strip()
    obs_entrega     = (dados.get('observacao_entrega') or '').strip()
    veiculo_id      = dados.get('veiculo_id') or None
    veiculo_placa   = (dados.get('veiculo_placa') or '').strip() or None
    entrega_parcial = bool(dados.get('entrega_parcial', False))
    obs_parcial     = (dados.get('obs_entrega_parcial') or '').strip()

    if not motorista_pin:
        return jsonify({'success': False, 'error': 'PIN do motorista obrigatorio'}), 400
    if not nm_destinatario:
        return jsonify({'success': False, 'error': 'Nome do destinatario obrigatorio'}), 400
    if assinatura_img and not assinatura_img.startswith('data:image/png;base64,'):
        return jsonify({'success': False, 'error': 'Imagem de assinatura invalida'}), 400

    try:
        with get_db_cursor() as cursor:
            cursor.execute("""
                SELECT id, nome, matricula FROM transporte_material_motoristas
                WHERE matricula = %s AND ativo = TRUE LIMIT 1
            """, (motorista_pin,))
            motorista = cursor.fetchone()
            if not motorista:
                return jsonify({'success': False, 'error': 'PIN invalido ou motorista inativo'}), 403

            cursor.execute("""
                SELECT s.id, s.status, s.nr_protocolo, s.tipo_carga_nome,
                       s.setor_origem_nome, s.destino_nome, s.viagem_id,
                       tc.requer_assinatura
                FROM transporte_material_solicitacoes s
                JOIN transporte_material_tipos_carga tc ON tc.id = s.tipo_carga_id
                WHERE s.id = %s
            """, (chamado_id,))
            chamado = cursor.fetchone()
            if not chamado:
                return jsonify({'success': False, 'error': 'Chamado nao encontrado'}), 404
            if chamado['status'] != 'em_transporte':
                return jsonify({'success': False, 'error': 'Chamado nao esta em transporte'}), 400
            if chamado['requer_assinatura'] and not assinatura_img:
                return jsonify({'success': False,
                                'error': 'Este tipo de carga exige assinatura do destinatario'}), 400

            cursor.execute("""
                SELECT descricao, quantidade, unidade
                FROM transporte_material_itens
                WHERE solicitacao_id = %s ORDER BY ordem
            """, (chamado_id,))
            itens_list = []
            for r in cursor.fetchall():
                it = dict(r)
                if it.get('quantidade') is not None:
                    it['quantidade'] = float(it['quantidade'])
                itens_list.append(it)

        viagem_id_para_verificar = chamado.get('viagem_id')

        conteudo = {
            'protocolo':                chamado['nr_protocolo'],
            'tipo_carga':               chamado['tipo_carga_nome'],
            'origem':                   chamado['setor_origem_nome'],
            'destino':                  chamado['destino_nome'],
            'itens':                    itens_list,
            'motorista':                motorista['nome'],
            'nm_destinatario':          nm_destinatario,
            'cpf_destinatario':         cpf_destinatario,
            'dt_nascimento_destinatario': str(dt_nasc_dest) if dt_nasc_dest else None,
            'entrega_parcial':          entrega_parcial,
            'dt_entrega':               datetime.now().isoformat()
        }
        conteudo_json = _json.dumps(conteudo, ensure_ascii=False)
        hash_conteudo = hashlib.sha256(conteudo_json.encode('utf-8')).hexdigest()
        ip = request.headers.get('X-Forwarded-For', request.remote_addr)
        ua = request.headers.get('User-Agent', '')

        with get_db_cursor(use_dict_cursor=False) as cursor:
            cursor.execute("""
                INSERT INTO assinaturas_digitais
                    (contexto, ref_tabela, ref_id,
                     nm_signatario, qualidade_signatario,
                     assinatura_img, hash_conteudo, conteudo_json,
                     ip_origem, user_agent,
                     coletado_por_id, coletado_por_nome,
                     coletado_por_matricula, coletado_por_nome_equipe)
                VALUES
                    ('transporte_material', 'transporte_material_solicitacoes', %s,
                     %s, 'destinatario',
                     %s, %s, %s,
                     %s, %s,
                     %s, %s, %s, %s)
                RETURNING id
            """, (
                chamado_id,
                nm_destinatario,
                assinatura_img or None,
                hash_conteudo, conteudo_json,
                ip, ua,
                session.get('usuario_id'), session.get('nome_completo'),
                motorista['matricula'], motorista['nome']
            ))
            assinatura_id = cursor.fetchone()[0]

            cursor.execute("""
                UPDATE transporte_material_solicitacoes
                SET status                      = 'entregue',
                    dt_entrega                  = NOW(),
                    assinatura_id               = %s,
                    nm_destinatario             = %s,
                    cpf_destinatario            = %s,
                    dt_nascimento_destinatario  = %s,
                    observacao_entrega          = %s,
                    veiculo_id                  = COALESCE(%s, veiculo_id),
                    veiculo_placa               = COALESCE(%s, veiculo_placa),
                    entrega_parcial             = %s,
                    obs_entrega_parcial         = %s,
                    atualizado_em               = NOW()
                WHERE id = %s
            """, (assinatura_id, nm_destinatario, cpf_destinatario, dt_nasc_dest,
                  obs_entrega or None, veiculo_id, veiculo_placa,
                  entrega_parcial, obs_parcial or None, chamado_id))

        # Verificar viagem após o commit do bloco anterior
        if viagem_id_para_verificar:
            with get_db_cursor() as cursor:
                _verificar_concluir_viagem(cursor, viagem_id_para_verificar)

        cache_delete_pattern('painel54:*')
        current_app.logger.info(
            'Entrega c/ assinatura: chamado=%s protocolo=%s assinatura=%s motorista=%s parcial=%s',
            chamado_id, chamado['nr_protocolo'], assinatura_id, motorista['nome'], entrega_parcial
        )
        return jsonify({'success': True, 'message': 'Entrega registrada com assinatura'})

    except Exception as e:
        current_app.logger.error('Erro entregar-com-assinatura painel53: %s', e, exc_info=True)
        return jsonify({'success': False, 'error': 'Erro ao registrar entrega'}), 500


def _verificar_concluir_viagem(cursor, viagem_id):
    """Marca a viagem como concluída se todos os seus chamados foram entregues."""
    cursor.execute("""
        SELECT COUNT(*) AS total,
               SUM(CASE WHEN status = 'entregue' THEN 1 ELSE 0 END) AS entregues
        FROM transporte_material_solicitacoes
        WHERE viagem_id = %s AND status != 'cancelado'
    """, (viagem_id,))
    row = cursor.fetchone()
    if row and row['total'] > 0 and row['total'] == row['entregues']:
        cursor.execute("""
            UPDATE transporte_material_viagens
            SET status = 'concluida', dt_conclusao = NOW()
            WHERE id = %s AND status = 'em_andamento'
        """, (viagem_id,))


# =========================================================
# VALIDAR PIN (matrícula do motorista)
# =========================================================

@painel53_bp.route('/api/paineis/painel53/validar-pin', methods=['POST'])
@login_required
@panel_permission_required('painel53')
def api_painel53_validar_pin():
    dados     = request.get_json() or {}
    matricula = (dados.get('matricula') or '').strip()
    if not matricula:
        return jsonify({'success': False, 'error': 'Matricula nao informada'}), 400
    try:
        with get_db_cursor() as cursor:
            cursor.execute("""
                SELECT id, nome, matricula, turno
                FROM transporte_material_motoristas
                WHERE matricula = %s AND ativo = TRUE LIMIT 1
            """, (matricula,))
            motorista = cursor.fetchone()
        if not motorista:
            return jsonify({'success': False, 'error': 'Matricula nao encontrada ou inativa'}), 404
        return jsonify({'success': True, 'motorista': dict(motorista)})
    except Exception as e:
        current_app.logger.error('Erro validar-pin painel53: %s', e, exc_info=True)
        return jsonify({'success': False, 'error': 'Erro ao validar matricula'}), 500


# =========================================================
# CANCELAR CHAMADO (motorista)
# =========================================================

@painel53_bp.route('/api/paineis/painel53/chamados/<int:chamado_id>/cancelar', methods=['PUT'])
@login_required
@panel_permission_required('painel53')
def api_painel53_cancelar(chamado_id):
    dados        = request.get_json() or {}
    motorista_id = dados.get('motorista_id')
    motivo       = (dados.get('motivo') or '').strip()

    if not motorista_id:
        return jsonify({'success': False, 'error': 'Informe o motorista_id'}), 400
    if len(motivo) < 10:
        return jsonify({'success': False, 'error': 'O motivo deve ter pelo menos 10 caracteres'}), 400

    try:
        with get_db_cursor() as cursor:
            cursor.execute(
                "SELECT status, motorista_id, viagem_id FROM transporte_material_solicitacoes WHERE id = %s",
                (chamado_id,)
            )
            chamado = cursor.fetchone()
            if not chamado:
                return jsonify({'success': False, 'error': 'Chamado nao encontrado'}), 404
            if chamado['status'] not in ('aguardando', 'em_transporte'):
                return jsonify({'success': False,
                                'error': 'Chamado nao pode ser cancelado no status: ' + chamado['status']}), 400
            if chamado['motorista_id'] is not None and str(chamado['motorista_id']) != str(motorista_id):
                return jsonify({'success': False,
                                'error': 'Este chamado esta sob responsabilidade de outro motorista'}), 403

            cursor.execute("""
                UPDATE transporte_material_solicitacoes
                SET status = 'cancelado',
                    dt_cancelamento = NOW(),
                    motivo_cancelamento = %s,
                    atualizado_em = NOW()
                WHERE id = %s
            """, ('[Cancelado pelo Motorista] ' + motivo, chamado_id))

        cache_delete_pattern('painel54:*')
        return jsonify({'success': True, 'message': 'Chamado cancelado com sucesso'})
    except Exception as e:
        current_app.logger.error('Erro cancelar painel53: %s', e, exc_info=True)
        return jsonify({'success': False, 'error': 'Erro ao cancelar chamado'}), 500


# =========================================================
# HISTÓRICO DO DIA
# =========================================================

@painel53_bp.route('/api/paineis/painel53/historico-hoje', methods=['GET'])
@login_required
@panel_permission_required('painel53')
def api_painel53_historico_hoje():
    motorista_id = request.args.get('motorista_id')
    if not motorista_id:
        return jsonify({'success': False, 'error': 'Informe o motorista_id'}), 400
    try:
        with get_db_cursor() as cursor:
            cursor.execute("""
                SELECT
                    id, nr_protocolo, tipo_carga_nome,
                    setor_origem_nome, destino_nome, prioridade, status,
                    nm_destinatario, entrega_parcial,
                    criado_em, dt_aceite, dt_inicio_transporte, dt_entrega,
                    CASE
                        WHEN dt_entrega IS NOT NULL AND dt_inicio_transporte IS NOT NULL
                        THEN ROUND(EXTRACT(EPOCH FROM (dt_entrega - dt_inicio_transporte)) / 60, 1)
                    END AS tempo_entrega_min
                FROM transporte_material_solicitacoes
                WHERE motorista_id = %s
                  AND criado_em >= CURRENT_DATE
                ORDER BY criado_em DESC
            """, (motorista_id,))
            chamados = []
            for row in cursor.fetchall():
                c = _serial_dt(dict(row))
                if c.get('tempo_entrega_min') is not None:
                    c['tempo_entrega_min'] = float(c['tempo_entrega_min'])
                chamados.append(c)
        return jsonify({'success': True, 'chamados': chamados, 'total': len(chamados)})
    except Exception as e:
        current_app.logger.error('Erro historico-hoje painel53: %s', e, exc_info=True)
        return jsonify({'success': False, 'error': 'Erro ao buscar historico'}), 500
