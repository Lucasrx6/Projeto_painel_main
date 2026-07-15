"""
Painel 45 - Enfermagem / Radiologia
Nova função: enfermagem vê os exames agendados pela radiologia e dá ciência ou recusa.
Não envia mais pacientes — a radiologia cria o agendamento.
"""
from flask import Blueprint, jsonify, send_from_directory, request, session, current_app
from datetime import datetime
from decimal import Decimal
from backend.database import get_db_cursor
from backend.middleware.decorators import login_required, panel_permission_required
from backend.cache import cache_delete_pattern
from backend.routes.painel46_routes import _auto_finalizar_expirados

painel45_bp = Blueprint('painel45', __name__)

_SQL_TIPO_EXAME = """
    CASE
        WHEN ra.ds_procedimento ILIKE 'RX%%'
          OR ra.ds_procedimento ILIKE '%%RADIOGRAF%%'                                        THEN 'RX'
        WHEN ra.ds_procedimento ILIKE '%%RESSONANCI%%'
          OR ra.ds_procedimento ILIKE 'RM %%'
          OR ra.ds_procedimento ILIKE 'RM-%%'
          OR (ra.ds_procedimento ILIKE '%%ANGIO%%' AND ra.ds_procedimento ILIKE '%%RM%%')
          OR (ra.ds_procedimento ILIKE '%%HIDRO%%' AND ra.ds_procedimento ILIKE '%%RM%%')    THEN 'RM'
        WHEN ra.ds_procedimento ILIKE '%%TOMOGRAF%%'
          OR ra.ds_procedimento ILIKE 'TC %%'
          OR ra.ds_procedimento ILIKE 'CT %%'                                                THEN 'TC'
        WHEN ra.ds_procedimento ILIKE '%%ULTRASSOM%%'
          OR ra.ds_procedimento ILIKE 'USG%%'
          OR ra.ds_procedimento ILIKE 'US %%'
          OR ra.ds_procedimento ILIKE 'US-%%'                                                THEN 'USG'
        WHEN ra.ds_procedimento ILIKE '%%MAMOGRAF%%'                                         THEN 'MAM'
        ELSE 'OUTROS'
    END
"""


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


# ── Agendamentos para a enfermagem ──────────────────────────

@painel45_bp.route('/api/paineis/painel45/agendamentos')
@login_required
@panel_permission_required('painel45')
def api_p45_agendamentos():
    """
    Retorna exames agendados pela radiologia para a enfermagem.
    ?data=YYYY-MM-DD     (padrão: hoje)
    ?status_enf=pendente|ciente|recusado  (padrão: todos os ativos)
    """
    try:
        _auto_finalizar_expirados(current_app.logger)
        filtro_enf = request.args.get('status_enf', '').strip()
        data_str   = request.args.get('data', datetime.now().strftime('%Y-%m-%d'))

        filtros = []
        params  = []

        if filtro_enf == 'recusado':
            # Recusados têm status='cancelado' + status_enfermagem='recusado'
            filtros.append("ra.status = 'cancelado'")
            filtros.append("ra.status_enfermagem = 'recusado'")
            filtros.append("DATE(ra.dt_recusa) = %s")
            params.append(data_str)
        else:
            filtros.append("ra.status NOT IN ('cancelado')")
            if filtro_enf in ('pendente', 'ciente'):
                filtros.append("ra.status_enfermagem = %s")
                params.append(filtro_enf)
            # Filtrar pelo dia do slot (ou data de criação se sem slot)
            filtros.append("DATE(COALESCE(rs.data_hora, ra.criado_em)) = %s")
            params.append(data_str)

        where = 'WHERE ' + ' AND '.join(filtros)

        with get_db_cursor() as cursor:
            cursor.execute(f"""
                SELECT
                    ra.id,
                    ra.nr_atendimento,
                    ra.nm_paciente,
                    ra.ds_procedimento,
                    ra.leito_origem,
                    ra.setor_origem_nome,
                    ra.cd_setor_atendimento,
                    ra.prioridade,
                    ra.status,
                    ra.status_enfermagem,
                    ra.motivo_recusa,
                    ra.observacao,
                    ra.criado_em,
                    ra.atualizado_em,
                    ra.dt_ciencia,
                    ra.dt_recusa,
                    ra.dt_no_local,
                    ra.dt_inicio_exame,
                    ra.dt_conclusao_exame,
                    ra.requer_preparo,
                    ra.tipo_preparo,
                    ra.auto_finalizado,
                    ra.auto_finalizado_em,
                    -- Slot
                    rs.id           AS slot_id,
                    rs.data_hora    AS slot_data_hora,
                    rs.duracao_min  AS slot_duracao,
                    rs.modalidade   AS slot_modalidade,
                    -- Tipo do exame (derivado do procedimento)
                    {_SQL_TIPO_EXAME} AS tipo_exame,
                    -- Padioleiro ativo
                    pc.id           AS chamado_id,
                    pc.status       AS chamado_status,
                    pc.padioleiro_nome AS chamado_padioleiro
                FROM radio_agenda ra
                LEFT JOIN radio_slots rs ON rs.id = ra.slot_id
                LEFT JOIN LATERAL (
                    SELECT id, status, padioleiro_nome
                    FROM padioleiro_chamados
                    WHERE nr_atendimento = ra.nr_atendimento
                      AND status NOT IN ('concluido', 'cancelado')
                    ORDER BY criado_em DESC LIMIT 1
                ) pc ON TRUE
                {where}
                ORDER BY
                    CASE ra.status_enfermagem
                        WHEN 'pendente' THEN 1
                        WHEN 'ciente'   THEN 2
                        ELSE 3
                    END,
                    rs.data_hora NULLS LAST,
                    ra.setor_origem_nome,
                    ra.criado_em DESC
            """, params)
            dados = [_serial(dict(r)) for r in cursor.fetchall()]

        return jsonify({'success': True, 'data': dados, 'total': len(dados),
                        'timestamp': datetime.now().isoformat()})

    except Exception as e:
        current_app.logger.error(f'Erro agendamentos p45: {e}', exc_info=True)
        return jsonify({'success': False, 'error': 'Erro ao buscar agendamentos'}), 500


# ── Dar ciência ──────────────────────────────────────────────

@painel45_bp.route('/api/paineis/painel45/exames/<int:radio_id>/ciencia', methods=['PUT'])
@login_required
@panel_permission_required('painel45')
def api_p45_ciencia(radio_id):
    """
    Enfermagem confirma ciência do agendamento.
    Permitido mesmo após o exame estar concluído (ciência retroativa).
    Bloqueado apenas para cancelados.
    """
    try:
        with get_db_cursor(use_dict_cursor=False) as cursor:
            cursor.execute("""
                SELECT id, status, status_enfermagem
                FROM radio_agenda WHERE id = %s
            """, (radio_id,))
            row = cursor.fetchone()
            if not row:
                return jsonify({'success': False, 'error': 'Registro não encontrado'}), 404
            if row[1] == 'cancelado':
                return jsonify({'success': False, 'error': 'Exame cancelado'}), 409
            if row[2] == 'ciente':
                return jsonify({'success': True})  # idempotente

            cursor.execute("""
                UPDATE radio_agenda
                SET status_enfermagem = 'ciente',
                    dt_ciencia        = NOW(),
                    atualizado_em     = NOW()
                WHERE id = %s
            """, (radio_id,))

        cache_delete_pattern('painel45:*')
        cache_delete_pattern('painel46:*')
        usuario = session.get('nome_completo') or session.get('usuario', '')
        current_app.logger.info(f'P45 ciência: id={radio_id} por {usuario}')
        return jsonify({'success': True})

    except Exception as e:
        current_app.logger.error(f'Erro ciência p45: {e}', exc_info=True)
        return jsonify({'success': False, 'error': 'Erro ao registrar ciência'}), 500


# ── Recusar agendamento ──────────────────────────────────────

@painel45_bp.route('/api/paineis/painel45/exames/<int:radio_id>/recusar', methods=['PUT'])
@login_required
@panel_permission_required('painel45')
def api_p45_recusar(radio_id):
    """
    Enfermagem recusa o agendamento com motivo obrigatório.
    Libera o slot e retorna o radio_agenda a 'pendente' para que a radiologia reagende.
    """
    try:
        dados = request.get_json() or {}
        motivo = (dados.get('motivo') or '').strip()
        if len(motivo) < 10:
            return jsonify({'success': False,
                            'error': 'Informe o motivo da recusa (mínimo 10 caracteres)'}), 400

        with get_db_cursor(use_dict_cursor=False) as cursor:
            cursor.execute("""
                SELECT id, status, slot_id FROM radio_agenda WHERE id = %s
            """, (radio_id,))
            row = cursor.fetchone()
            if not row:
                return jsonify({'success': False, 'error': 'Registro não encontrado'}), 404
            if row[1] in ('concluido', 'cancelado'):
                return jsonify({'success': False, 'error': 'Exame já finalizado'}), 409

            slot_id = row[2]

            # Libera o slot
            if slot_id:
                cursor.execute("""
                    UPDATE radio_slots
                    SET status = 'livre', radio_agenda_id = NULL, atualizado_em = NOW()
                    WHERE id = %s
                """, (slot_id,))

            # Recusa: cancela o registro — o slot foi liberado, a prescrição
            # ficará disponível para um novo agendamento limpo no painel 46.
            cursor.execute("""
                UPDATE radio_agenda
                SET status_enfermagem = 'recusado',
                    motivo_recusa     = %s,
                    dt_recusa         = NOW(),
                    slot_id           = NULL,
                    status            = 'cancelado',
                    atualizado_em     = NOW()
                WHERE id = %s
            """, (motivo, radio_id))

        cache_delete_pattern('painel45:*')
        cache_delete_pattern('painel46:*')
        usuario = session.get('nome_completo') or session.get('usuario', '')
        current_app.logger.info(f'P45 recusa: id={radio_id} por {usuario}: {motivo}')
        return jsonify({'success': True})

    except Exception as e:
        current_app.logger.error(f'Erro recusar p45: {e}', exc_info=True)
        return jsonify({'success': False, 'error': 'Erro ao registrar recusa'}), 500


# ── Setores com exames agendados ─────────────────────────────

@painel45_bp.route('/api/paineis/painel45/setores')
@login_required
@panel_permission_required('painel45')
def api_p45_setores():
    try:
        with get_db_cursor() as cursor:
            cursor.execute("""
                SELECT DISTINCT setor_origem_nome AS nm_setor,
                       cd_setor_atendimento,
                       COUNT(*) FILTER (WHERE status_enfermagem = 'pendente') AS qt_pendentes,
                       COUNT(*) AS qt_total
                FROM radio_agenda
                WHERE status NOT IN ('cancelado', 'concluido')
                  AND setor_origem_nome IS NOT NULL
                GROUP BY setor_origem_nome, cd_setor_atendimento
                ORDER BY setor_origem_nome
            """)
            return jsonify({'success': True, 'data': [dict(r) for r in cursor.fetchall()]})
    except Exception as e:
        current_app.logger.error(f'Erro setores p45: {e}', exc_info=True)
        return jsonify({'success': False, 'error': 'Erro ao buscar setores'}), 500


# ── Slots disponíveis (informativo para a enfermagem) ────────

@painel45_bp.route('/api/paineis/painel45/slots-disponiveis')
@login_required
@panel_permission_required('painel45')
def api_p45_slots_disponiveis():
    try:
        data_str = request.args.get('data', datetime.now().strftime('%Y-%m-%d'))
        with get_db_cursor() as cursor:
            cursor.execute("""
                SELECT id, data_hora, duracao_min, modalidade
                FROM radio_slots
                WHERE DATE(data_hora) = %s AND status = 'livre'
                ORDER BY data_hora
            """, (data_str,))
            return jsonify({'success': True,
                            'data': [_serial(dict(r)) for r in cursor.fetchall()]})
    except Exception as e:
        current_app.logger.error(f'Erro slots p45: {e}', exc_info=True)
        return jsonify({'success': False, 'error': 'Erro ao buscar slots'}), 500
