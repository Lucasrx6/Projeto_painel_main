"""
Painel 45 - Radiologia / Enfermagem
Visualização e registro de exames de radiologia que precisam de controle de fluxo.
Lê de painel19_radiologia_pendencias e gerencia radio_agenda.
"""
from flask import Blueprint, jsonify, send_from_directory, request, session, current_app
from datetime import datetime
from decimal import Decimal
from psycopg2.extras import RealDictCursor
from backend.database import get_db_cursor
from backend.middleware.decorators import login_required, panel_permission_required
from backend.cache import cache_route, cache_delete_pattern

painel45_bp = Blueprint('painel45', __name__)

# Exames portáteis (feitos no leito, sem transporte)
def _requer_transporte(ds_procedimento):
    if not ds_procedimento:
        return True
    return not ds_procedimento.upper().strip().startswith('RX')


def _serial(row):
    resultado = {}
    for k, v in row.items():
        if isinstance(v, datetime):
            resultado[k] = v.isoformat()
        elif isinstance(v, Decimal):
            resultado[k] = float(v)
        else:
            resultado[k] = v
    return resultado


# ── Página HTML ──────────────────────────────────────────────

@painel45_bp.route('/painel/painel45')
@login_required
@panel_permission_required('painel45')
def painel45():
    return send_from_directory('paineis/painel45', 'index.html')


# ── Setores disponíveis ──────────────────────────────────────

@painel45_bp.route('/api/paineis/painel45/setores')
@login_required
@panel_permission_required('painel45')
@cache_route(ttl=120, key_prefix='painel45:setores')
def api_p45_setores():
    try:
        with get_db_cursor() as cursor:
            cursor.execute("""
                SELECT DISTINCT cd_setor_atendimento, nm_setor, COUNT(*) AS qt_exames
                FROM painel19_radiologia_pendencias
                GROUP BY cd_setor_atendimento, nm_setor
                ORDER BY nm_setor
            """)
            return jsonify({'success': True, 'data': [dict(r) for r in cursor.fetchall()]})
    except Exception as e:
        current_app.logger.error(f'Erro setores p45: {e}', exc_info=True)
        return jsonify({'success': False, 'error': 'Erro ao buscar setores'}), 500


# ── Lista principal de exames ────────────────────────────────

@painel45_bp.route('/api/paineis/painel45/exames')
@login_required
@panel_permission_required('painel45')
def api_p45_exames():
    """
    Lista todos os exames de radiologia do painel19 com status de:
    - radio_agenda (se já registrado)
    - slot agendado (se houver)
    - padioleiro chamado ativo (qualquer tipo, para o nr_atendimento)
    """
    try:
        setor = request.args.get('setor', '')
        apenas_pendentes = request.args.get('pendentes', '').lower() == '1'

        filtros = []
        params = []

        if setor:
            filtros.append("p.cd_setor_atendimento = %s")
            params.append(int(setor))

        if apenas_pendentes:
            filtros.append("p.status_radiologia = 'AGUARDANDO'")

        where = ('WHERE ' + ' AND '.join(filtros)) if filtros else ''

        with get_db_cursor() as cursor:
            cursor.execute(f"""
                SELECT
                    p.nr_atendimento,
                    p.nm_pessoa_fisica,
                    p.leito,
                    p.leito_base,
                    p.nm_setor,
                    p.cd_setor_atendimento,
                    p.nr_prescricao,
                    p.ds_procedimento,
                    p.status_radiologia,
                    p.dt_pedido,
                    p.dt_execucao,
                    p.horas_espera,
                    p.prioridade_ordem,
                    p.ds_convenio,
                    -- Radio agenda
                    ra.id               AS radio_id,
                    ra.status           AS radio_status,
                    ra.prioridade       AS radio_prioridade,
                    ra.requer_transporte,
                    ra.observacao       AS radio_obs,
                    ra.criado_em        AS radio_criado_em,
                    -- Slot agendado
                    rs.id               AS slot_id,
                    rs.data_hora        AS slot_data_hora,
                    rs.duracao_min      AS slot_duracao,
                    -- Padioleiro: qualquer chamado ativo para este atendimento
                    pc.id               AS chamado_id,
                    pc.status           AS chamado_status,
                    pc.padioleiro_nome  AS chamado_padioleiro,
                    pc.tipo_movimento_nome AS chamado_tipo
                FROM vw_painel19_radiologia p
                LEFT JOIN radio_agenda ra ON (
                    ra.nr_atendimento = p.nr_atendimento
                    AND ra.nr_prescricao = p.nr_prescricao
                    AND ra.status NOT IN ('concluido', 'cancelado')
                )
                LEFT JOIN radio_slots rs ON rs.id = ra.slot_id
                LEFT JOIN LATERAL (
                    SELECT id, status, padioleiro_nome, tipo_movimento_nome
                    FROM padioleiro_chamados
                    WHERE nr_atendimento = p.nr_atendimento
                      AND status NOT IN ('concluido', 'cancelado')
                    ORDER BY criado_em DESC
                    LIMIT 1
                ) pc ON TRUE
                {where}
                ORDER BY p.cd_setor_atendimento, p.leito_base, p.prioridade_ordem, p.dt_pedido
            """, params)

            rows = cursor.fetchall()
            exames = []
            for r in rows:
                item = _serial(dict(r))
                # Detecta se é portátil pelo nome caso radio_agenda ainda não exista
                if item.get('requer_transporte') is None:
                    item['requer_transporte'] = _requer_transporte(item.get('ds_procedimento'))
                exames.append(item)

        return jsonify({'success': True, 'data': exames, 'total': len(exames),
                        'timestamp': datetime.now().isoformat()})

    except Exception as e:
        current_app.logger.error(f'Erro exames p45: {e}', exc_info=True)
        return jsonify({'success': False, 'error': 'Erro ao buscar exames'}), 500


# ── Registrar exame no radio_agenda ─────────────────────────

@painel45_bp.route('/api/paineis/painel45/registrar', methods=['POST'])
@login_required
@panel_permission_required('painel45')
def api_p45_registrar():
    """Cria entrada em radio_agenda para um exame do painel19."""
    try:
        dados = request.get_json() or {}
        nr_atendimento = dados.get('nr_atendimento', '').strip()
        nr_prescricao  = dados.get('nr_prescricao', '').strip()

        if not nr_atendimento or not nr_prescricao:
            return jsonify({'success': False, 'error': 'nr_atendimento e nr_prescricao obrigatórios'}), 400

        ds_procedimento = dados.get('ds_procedimento', '')
        requer = _requer_transporte(ds_procedimento)

        with get_db_cursor(use_dict_cursor=False) as cursor:
            # Evita duplicata ativa
            cursor.execute("""
                SELECT id FROM radio_agenda
                WHERE nr_atendimento = %s AND nr_prescricao = %s
                  AND status NOT IN ('concluido', 'cancelado')
            """, (nr_atendimento, nr_prescricao))
            if cursor.fetchone():
                return jsonify({'success': False, 'error': 'Exame já registrado e em andamento'}), 409

            cursor.execute("""
                INSERT INTO radio_agenda (
                    nr_atendimento, nr_prescricao, ds_procedimento,
                    requer_transporte, nm_paciente, leito_origem,
                    setor_origem_nome, cd_setor_atendimento,
                    nm_medico_solicitante, prioridade,
                    solicitante_id, solicitante_nome, observacao
                ) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
                RETURNING id
            """, (
                nr_atendimento, nr_prescricao, ds_procedimento,
                requer,
                dados.get('nm_paciente', ''),
                dados.get('leito_origem', ''),
                dados.get('setor_origem_nome', ''),
                dados.get('cd_setor_atendimento'),
                dados.get('nm_medico_solicitante', ''),
                dados.get('prioridade', 'normal'),
                session.get('usuario_id'),
                session.get('nome_completo', session.get('usuario', '')),
                dados.get('observacao', '')
            ))
            novo_id = cursor.fetchone()[0]

        cache_delete_pattern('painel45:*')
        cache_delete_pattern('painel46:*')
        current_app.logger.info(f'P45: Exame registrado id={novo_id} atend={nr_atendimento}')
        return jsonify({'success': True, 'id': novo_id})

    except Exception as e:
        current_app.logger.error(f'Erro registrar p45: {e}', exc_info=True)
        return jsonify({'success': False, 'error': 'Erro ao registrar exame'}), 500


# ── Alterar prioridade ───────────────────────────────────────

@painel45_bp.route('/api/paineis/painel45/exames/<int:radio_id>/prioridade', methods=['PUT'])
@login_required
@panel_permission_required('painel45')
def api_p45_prioridade(radio_id):
    try:
        dados = request.get_json() or {}
        prioridade = dados.get('prioridade', 'normal')
        if prioridade not in ('normal', 'urgente'):
            return jsonify({'success': False, 'error': 'Prioridade inválida'}), 400

        with get_db_cursor(use_dict_cursor=False) as cursor:
            cursor.execute("""
                UPDATE radio_agenda SET prioridade = %s, atualizado_em = NOW()
                WHERE id = %s AND status NOT IN ('concluido','cancelado')
            """, (prioridade, radio_id))
            if cursor.rowcount == 0:
                return jsonify({'success': False, 'error': 'Registro não encontrado ou já finalizado'}), 404

        cache_delete_pattern('painel45:*')
        cache_delete_pattern('painel46:*')
        return jsonify({'success': True})

    except Exception as e:
        current_app.logger.error(f'Erro prioridade p45: {e}', exc_info=True)
        return jsonify({'success': False, 'error': 'Erro ao atualizar prioridade'}), 500


# ── Cancelar registro ────────────────────────────────────────

@painel45_bp.route('/api/paineis/painel45/exames/<int:radio_id>/cancelar', methods=['PUT'])
@login_required
@panel_permission_required('painel45')
def api_p45_cancelar(radio_id):
    try:
        dados = request.get_json() or {}
        motivo = (dados.get('motivo') or '').strip()
        if len(motivo) < 5:
            return jsonify({'success': False, 'error': 'Informe o motivo do cancelamento (mínimo 5 caracteres)'}), 400

        with get_db_cursor(use_dict_cursor=False) as cursor:
            # Libera slot se houver
            cursor.execute("SELECT slot_id FROM radio_agenda WHERE id = %s", (radio_id,))
            row = cursor.fetchone()
            if not row:
                return jsonify({'success': False, 'error': 'Registro não encontrado'}), 404

            if row[0]:
                cursor.execute("""
                    UPDATE radio_slots
                    SET status = 'livre', radio_agenda_id = NULL, atualizado_em = NOW()
                    WHERE id = %s
                """, (row[0],))

            cursor.execute("""
                UPDATE radio_agenda
                SET status = 'cancelado', motivo_cancelamento = %s,
                    slot_id = NULL, atualizado_em = NOW()
                WHERE id = %s
            """, (motivo, radio_id))

        cache_delete_pattern('painel45:*')
        cache_delete_pattern('painel46:*')
        return jsonify({'success': True})

    except Exception as e:
        current_app.logger.error(f'Erro cancelar p45: {e}', exc_info=True)
        return jsonify({'success': False, 'error': 'Erro ao cancelar'}), 500


# ── Slots disponíveis para uma data (informativo) ────────────

@painel45_bp.route('/api/paineis/painel45/slots-disponiveis')
@login_required
@panel_permission_required('painel45')
def api_p45_slots_disponiveis():
    """Retorna slots livres de uma data para exibição informativa na enfermagem."""
    try:
        data_str = request.args.get('data', datetime.now().strftime('%Y-%m-%d'))
        with get_db_cursor() as cursor:
            cursor.execute("""
                SELECT id, data_hora, duracao_min, modalidade
                FROM radio_slots
                WHERE DATE(data_hora) = %s AND status = 'livre'
                ORDER BY data_hora
            """, (data_str,))
            return jsonify({'success': True, 'data': [_serial(dict(r)) for r in cursor.fetchall()]})
    except Exception as e:
        current_app.logger.error(f'Erro slots p45: {e}', exc_info=True)
        return jsonify({'success': False, 'error': 'Erro ao buscar slots'}), 500
