"""
Painel 46 - Radiologia (Agenda + Fila do Dia)
Visão da radiologia: fila de pacientes agendados e gestão de slots de horário.
"""
from flask import Blueprint, jsonify, send_from_directory, request, session, current_app
from datetime import datetime, timedelta
from decimal import Decimal
import threading
from psycopg2.extras import RealDictCursor, execute_values
from backend.database import get_db_cursor
from backend.middleware.decorators import login_required, panel_permission_required
from backend.cache import cache_route, cache_delete_pattern

painel46_bp = Blueprint('painel46', __name__)

# Tipo de exame derivado do nome do procedimento
_SQL_TIPO_EXAME_P = """
    CASE
        WHEN p.ds_procedimento ILIKE 'RX%%'
          OR p.ds_procedimento ILIKE '%%RADIOGRAF%%'                                       THEN 'RX'
        WHEN p.ds_procedimento ILIKE '%%RESSONANCI%%'
          OR p.ds_procedimento ILIKE 'RM %%'
          OR p.ds_procedimento ILIKE 'RM-%%'
          OR (p.ds_procedimento ILIKE '%%ANGIO%%' AND p.ds_procedimento ILIKE '%%RM%%')
          OR (p.ds_procedimento ILIKE '%%HIDRO%%' AND p.ds_procedimento ILIKE '%%RM%%')    THEN 'RM'
        WHEN p.ds_procedimento ILIKE '%%TOMOGRAF%%'
          OR p.ds_procedimento ILIKE 'TC %%'
          OR p.ds_procedimento ILIKE 'CT %%'                                               THEN 'TC'
        WHEN p.ds_procedimento ILIKE '%%ULTRASSOM%%'
          OR p.ds_procedimento ILIKE 'USG%%'
          OR p.ds_procedimento ILIKE 'US %%'
          OR p.ds_procedimento ILIKE 'US-%%'                                               THEN 'USG'
        WHEN p.ds_procedimento ILIKE '%%MAMOGRAF%%'                                        THEN 'MAM'
        ELSE 'OUTROS'
    END
"""

_SQL_TIPO_EXAME_RA = """
    CASE
        WHEN ra.ds_procedimento ILIKE 'RX%%'
          OR ra.ds_procedimento ILIKE '%%RADIOGRAF%%'                                       THEN 'RX'
        WHEN ra.ds_procedimento ILIKE '%%RESSONANCI%%'
          OR ra.ds_procedimento ILIKE 'RM %%'
          OR ra.ds_procedimento ILIKE 'RM-%%'
          OR (ra.ds_procedimento ILIKE '%%ANGIO%%' AND ra.ds_procedimento ILIKE '%%RM%%')
          OR (ra.ds_procedimento ILIKE '%%HIDRO%%' AND ra.ds_procedimento ILIKE '%%RM%%')   THEN 'RM'
        WHEN ra.ds_procedimento ILIKE '%%TOMOGRAF%%'
          OR ra.ds_procedimento ILIKE 'TC %%'
          OR ra.ds_procedimento ILIKE 'CT %%'                                               THEN 'TC'
        WHEN ra.ds_procedimento ILIKE '%%ULTRASSOM%%'
          OR ra.ds_procedimento ILIKE 'USG%%'
          OR ra.ds_procedimento ILIKE 'US %%'
          OR ra.ds_procedimento ILIKE 'US-%%'                                               THEN 'USG'
        WHEN ra.ds_procedimento ILIKE '%%MAMOGRAF%%'                                        THEN 'MAM'
        ELSE 'OUTROS'
    END
"""

# Transições de status permitidas
_TRANSICOES = {
    'pendente':  ['agendado', 'no_local', 'cancelado'],
    'agendado':  ['no_local', 'cancelado'],
    'no_local':  ['executando', 'cancelado'],
    'executando':['concluido', 'cancelado'],
    'concluido': [],
    'cancelado': [],
}

# Campos atualizáveis no slot
_CAMPOS_SLOT = ('modalidade', 'duracao_min', 'obs_bloqueio')


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


# ── Auto-finalização de exames expirados ─────────────────────

_auto_fin_lock  = threading.Lock()
_auto_fin_state = {'last_run': None}
_AUTO_FIN_INTERVALO_S = 300  # executa no máximo 1x a cada 5 minutos


def _auto_finalizar_expirados(logger):
    """
    Finaliza automaticamente agendamentos em que o Tasy já confirmou a execução
    mas o usuário não registrou a conclusão no sistema.

    Regras:
    - Dias anteriores: finaliza imediatamente se Tasy mostra status != AGUARDANDO
    - Hoje: aguarda 30 minutos após o horário do slot antes de auto-finalizar

    Timestamps atribuídos (usando o horário do slot como referência):
      dt_no_local        = slot_data_hora
      dt_inicio_exame    = slot_data_hora + 5 min
      dt_conclusao_exame = slot_data_hora + duracao_min do slot

    Registro: auto_finalizado=TRUE, auto_finalizado_em=NOW()
    Log: aviso com ids afetados para auditoria.
    """
    with _auto_fin_lock:
        agora = datetime.now()
        ultimo = _auto_fin_state['last_run']
        if ultimo and (agora - ultimo).total_seconds() < _AUTO_FIN_INTERVALO_S:
            return 0
        _auto_fin_state['last_run'] = agora

    try:
        ids_afetados = []

        with get_db_cursor(use_dict_cursor=False) as cursor:
            # Passagem 1: exames COM slot vinculado (lógica original).
            cursor.execute("""
                UPDATE radio_agenda
                SET status             = 'concluido',
                    dt_no_local        = COALESCE(dt_no_local,
                                                   rs.data_hora),
                    dt_inicio_exame    = COALESCE(dt_inicio_exame,
                                                   rs.data_hora + INTERVAL '5 minutes'),
                    dt_conclusao_exame = COALESCE(dt_conclusao_exame,
                                                   rs.data_hora
                                                   + COALESCE(rs.duracao_min, 30)
                                                   * INTERVAL '1 minute'),
                    status_enfermagem  = CASE
                                           WHEN status_enfermagem = 'pendente' THEN 'ciente'
                                           ELSE status_enfermagem
                                         END,
                    dt_ciencia         = CASE
                                           WHEN status_enfermagem = 'pendente' THEN NOW()
                                           ELSE dt_ciencia
                                         END,
                    auto_finalizado    = TRUE,
                    auto_finalizado_em = NOW(),
                    atualizado_em      = NOW()
                FROM radio_slots rs
                WHERE radio_agenda.slot_id = rs.id
                  AND radio_agenda.status NOT IN ('concluido', 'cancelado')
                  AND radio_agenda.auto_finalizado = FALSE
                  AND (
                      (DATE(rs.data_hora) < CURRENT_DATE
                       AND EXISTS (
                           SELECT 1 FROM vw_painel19_radiologia p
                           WHERE p.nr_atendimento::varchar = radio_agenda.nr_atendimento
                             AND p.nr_prescricao::varchar  = radio_agenda.nr_prescricao
                             AND p.ds_procedimento         = radio_agenda.ds_procedimento
                             AND p.status_radiologia NOT IN ('AGUARDANDO')
                       )
                      )
                      OR
                      (DATE(rs.data_hora) = CURRENT_DATE
                       AND rs.data_hora <= NOW() - INTERVAL '30 minutes'
                       AND EXISTS (
                           SELECT 1 FROM vw_painel19_radiologia p
                           WHERE p.nr_atendimento::varchar = radio_agenda.nr_atendimento
                             AND p.nr_prescricao::varchar  = radio_agenda.nr_prescricao
                             AND p.ds_procedimento         = radio_agenda.ds_procedimento
                             AND p.status_radiologia NOT IN ('AGUARDANDO')
                       )
                      )
                  )
                RETURNING radio_agenda.id
            """)
            ids_afetados += [r[0] for r in cursor.fetchall()]

            # Passagem 2: exames pendentes SEM slot (fila "Sem Horário Agendado").
            # Esses registros escapam da passagem 1 porque não há slot para fazer JOIN.
            # Regra: Tasy confirma execução E o exame está pendente há mais de 1h
            # (ou é de um dia anterior) → auto-finaliza usando os timestamps do Tasy.
            cursor.execute("""
                UPDATE radio_agenda ra
                SET status             = 'concluido',
                    dt_no_local        = COALESCE(ra.dt_no_local,
                                            (SELECT p.dt_execucao
                                             FROM vw_painel19_radiologia p
                                             WHERE p.nr_atendimento::varchar = ra.nr_atendimento
                                               AND p.nr_prescricao::varchar  = ra.nr_prescricao
                                               AND p.ds_procedimento         = ra.ds_procedimento
                                             LIMIT 1),
                                            NOW()),
                    dt_inicio_exame    = COALESCE(ra.dt_inicio_exame, NOW()),
                    dt_conclusao_exame = COALESCE(ra.dt_conclusao_exame, NOW()),
                    status_enfermagem  = CASE
                                           WHEN ra.status_enfermagem = 'pendente' THEN 'ciente'
                                           ELSE ra.status_enfermagem
                                         END,
                    dt_ciencia         = CASE
                                           WHEN ra.status_enfermagem = 'pendente' THEN NOW()
                                           ELSE ra.dt_ciencia
                                         END,
                    auto_finalizado    = TRUE,
                    auto_finalizado_em = NOW(),
                    atualizado_em      = NOW()
                WHERE ra.slot_id IS NULL
                  AND ra.status = 'pendente'
                  AND ra.auto_finalizado = FALSE
                  AND (DATE(ra.criado_em) < CURRENT_DATE
                       OR ra.criado_em <= NOW() - INTERVAL '1 hour')
                  AND EXISTS (
                      SELECT 1 FROM vw_painel19_radiologia p
                      WHERE p.nr_atendimento::varchar = ra.nr_atendimento
                        AND p.nr_prescricao::varchar  = ra.nr_prescricao
                        AND p.ds_procedimento         = ra.ds_procedimento
                        AND p.status_radiologia NOT IN ('AGUARDANDO')
                  )
                RETURNING ra.id
            """)
            ids_sem_slot = [r[0] for r in cursor.fetchall()]
            ids_afetados += ids_sem_slot

        n = len(ids_afetados)
        if n > 0:
            cache_delete_pattern('painel45:*')
            cache_delete_pattern('painel46:*')
            logger.warning(
                f'[Radio] Auto-finalização: {n} exame(s) concluído(s) pelo sistema '
                f'por falta de ação do usuário. IDs: {ids_afetados}'
            )
        return n

    except Exception as e:
        logger.error(f'[Radio] Erro auto-finalização: {e}', exc_info=True)
        return 0


# ── Página HTML ──────────────────────────────────────────────

@painel46_bp.route('/painel/painel46')
@login_required
@panel_permission_required('painel46')
def painel46():
    return send_from_directory('paineis/painel46', 'index.html')


# ── Fila do dia ──────────────────────────────────────────────

@painel46_bp.route('/api/paineis/painel46/fila')
@login_required
@panel_permission_required('painel46')
def api_p46_fila():
    """
    Retorna exames registrados em radio_agenda para uma data,
    com info de slot e padioleiro ativo.
    ?data=YYYY-MM-DD  (padrão: hoje)
    """
    try:
        _auto_finalizar_expirados(current_app.logger)
        data_str = request.args.get('data', datetime.now().strftime('%Y-%m-%d'))

        with get_db_cursor() as cursor:
            # Agendados para a data (com slot) — inclui ciência/recusa
            cursor.execute(f"""
                SELECT
                    ra.id, ra.nr_atendimento, ra.nr_prescricao, ra.nm_paciente, ra.ds_procedimento,
                    ra.leito_origem, ra.setor_origem_nome, ra.cd_setor_atendimento,
                    ra.prioridade, ra.status, ra.requer_transporte, ra.observacao,
                    ra.status_enfermagem, ra.motivo_recusa, ra.dt_ciencia, ra.dt_recusa,
                    ra.dt_no_local, ra.dt_inicio_exame, ra.dt_conclusao_exame,
                    ra.nm_medico_solicitante, ra.criado_em, ra.atualizado_em,
                    ra.requer_preparo, ra.tipo_preparo,
                    ra.auto_finalizado, ra.auto_finalizado_em,
                    rs.id           AS slot_id,
                    rs.data_hora    AS slot_data_hora,
                    rs.duracao_min  AS slot_duracao,
                    rs.modalidade   AS slot_modalidade,
                    {_SQL_TIPO_EXAME_RA} AS tipo_exame,
                    -- Padioleiro ativo
                    pc.id           AS chamado_id,
                    pc.status       AS chamado_status,
                    pc.padioleiro_nome AS chamado_padioleiro,
                    pc.tipo_movimento_nome AS chamado_tipo
                FROM radio_agenda ra
                LEFT JOIN radio_slots rs ON rs.id = ra.slot_id
                LEFT JOIN LATERAL (
                    SELECT id, status, padioleiro_nome, tipo_movimento_nome
                    FROM padioleiro_chamados
                    WHERE nr_atendimento = ra.nr_atendimento
                      AND status NOT IN ('concluido', 'cancelado')
                    ORDER BY criado_em DESC
                    LIMIT 1
                ) pc ON TRUE
                WHERE ra.status NOT IN ('cancelado')
                  AND (
                      (rs.id IS NOT NULL AND DATE(rs.data_hora) = %s)
                      OR (ra.status IN ('no_local', 'executando')
                          AND DATE(ra.atualizado_em) = %s)
                      OR (ra.status = 'concluido' AND DATE(ra.atualizado_em) = %s)
                  )
                ORDER BY rs.data_hora NULLS LAST, ra.prioridade DESC, ra.criado_em
            """, (data_str, data_str, data_str))
            agendados = [_serial(dict(r)) for r in cursor.fetchall()]

            # Pendentes sem slot (aguardando agendamento pela radiologia / recusados)
            cursor.execute(f"""
                SELECT
                    ra.id, ra.nr_atendimento, ra.nr_prescricao, ra.nm_paciente, ra.ds_procedimento,
                    ra.leito_origem, ra.setor_origem_nome, ra.cd_setor_atendimento,
                    ra.prioridade, ra.status, ra.requer_transporte, ra.observacao,
                    ra.status_enfermagem, ra.motivo_recusa, ra.dt_ciencia, ra.dt_recusa,
                    ra.nm_medico_solicitante, ra.criado_em, ra.atualizado_em,
                    ra.requer_preparo, ra.tipo_preparo,
                    {_SQL_TIPO_EXAME_RA} AS tipo_exame,
                    pc.id           AS chamado_id,
                    pc.status       AS chamado_status,
                    pc.padioleiro_nome AS chamado_padioleiro
                FROM radio_agenda ra
                LEFT JOIN LATERAL (
                    SELECT id, status, padioleiro_nome
                    FROM padioleiro_chamados
                    WHERE nr_atendimento = ra.nr_atendimento
                      AND status NOT IN ('concluido', 'cancelado')
                    ORDER BY criado_em DESC
                    LIMIT 1
                ) pc ON TRUE
                WHERE ra.slot_id IS NULL
                  AND ra.status = 'pendente'
                ORDER BY ra.status_enfermagem DESC, ra.prioridade DESC, ra.criado_em
            """)
            pendentes = [_serial(dict(r)) for r in cursor.fetchall()]

            # Recusados pela enfermagem nas últimas 24h (apenas informativos — sem ações)
            cursor.execute(f"""
                SELECT
                    ra.id, ra.nr_atendimento, ra.nm_paciente, ra.ds_procedimento,
                    ra.leito_origem, ra.setor_origem_nome, ra.prioridade,
                    ra.motivo_recusa, ra.dt_recusa,
                    {_SQL_TIPO_EXAME_RA} AS tipo_exame
                FROM radio_agenda ra
                WHERE ra.status = 'cancelado'
                  AND ra.status_enfermagem = 'recusado'
                  AND ra.atualizado_em >= NOW() - INTERVAL '24 hours'
                ORDER BY ra.dt_recusa DESC
            """)
            recusados = [_serial(dict(r)) for r in cursor.fetchall()]

        return jsonify({
            'success': True,
            'agendados': agendados,
            'pendentes': pendentes,
            'recusados': recusados,
            'data': data_str,
            'timestamp': datetime.now().isoformat()
        })

    except Exception as e:
        current_app.logger.error(f'Erro fila p46: {e}', exc_info=True)
        return jsonify({'success': False, 'error': 'Erro ao buscar fila'}), 500


# ── Exames realizados sem envio prévio da enfermagem ────────

@painel46_bp.route('/api/paineis/painel46/sem-envio')
@login_required
@panel_permission_required('painel46')
@cache_route(ttl=30, key_prefix='painel46:sem-envio', vary_by_user=False, vary_by_query=True)
def api_p46_sem_envio():
    """
    Retorna exames que já foram executados/laudados no Tasy (status != AGUARDANDO)
    mas nunca tiveram um registro de envio pela enfermagem (nenhuma linha em radio_agenda).
    Filtrado para o dia atual por padrão (?data=YYYY-MM-DD).
    """
    try:
        data_str = request.args.get('data', datetime.now().strftime('%Y-%m-%d'))
        with get_db_cursor() as cursor:
            cursor.execute("""
                SELECT
                    p.nr_atendimento,
                    p.nm_pessoa_fisica,
                    p.leito_base,
                    p.leito,
                    p.nm_setor,
                    p.nr_prescricao,
                    p.ds_procedimento,
                    p.status_radiologia,
                    p.dt_pedido,
                    p.dt_execucao,
                    p.dt_laudo,
                    p.ds_convenio,
                    p.ie_urgente
                FROM vw_painel19_radiologia p
                WHERE p.status_radiologia <> 'AGUARDANDO'
                  AND DATE(COALESCE(p.dt_execucao, p.dt_laudo, p.dt_pedido)) = %s
                  AND NOT EXISTS (
                      SELECT 1 FROM radio_agenda ra
                      WHERE ra.nr_atendimento = p.nr_atendimento::varchar
                        AND ra.nr_prescricao  = p.nr_prescricao::varchar
                  )
                ORDER BY p.nm_setor, p.dt_execucao NULLS LAST
            """, (data_str,))
            rows = [_serial(dict(r)) for r in cursor.fetchall()]
        return jsonify({'success': True, 'data': rows, 'data_consulta': data_str})
    except Exception as e:
        current_app.logger.error(f'Erro sem-envio p46: {e}', exc_info=True)
        return jsonify({'success': False, 'error': 'Erro ao buscar sem-envio'}), 500


# ── Atualizar status do exame ────────────────────────────────

@painel46_bp.route('/api/paineis/painel46/exames/<int:radio_id>/status', methods=['PUT'])
@login_required
@panel_permission_required('painel46')
def api_p46_status(radio_id):
    """Avança o status de um exame no radio_agenda."""
    try:
        dados = request.get_json() or {}
        novo_status = (dados.get('status') or '').strip().lower()
        motivo = (dados.get('motivo') or '').strip()

        if not novo_status:
            return jsonify({'success': False, 'error': 'Status obrigatório'}), 400

        if novo_status == 'cancelado' and len(motivo) < 5:
            return jsonify({'success': False, 'error': 'Informe o motivo do cancelamento'}), 400

        with get_db_cursor(use_dict_cursor=False) as cursor:
            cursor.execute("SELECT status, slot_id FROM radio_agenda WHERE id = %s", (radio_id,))
            row = cursor.fetchone()
            if not row:
                return jsonify({'success': False, 'error': 'Registro não encontrado'}), 404

            status_atual, slot_id = row
            transicoes_ok = _TRANSICOES.get(status_atual, [])
            if novo_status not in transicoes_ok:
                return jsonify({
                    'success': False,
                    'error': f"Transição inválida: {status_atual} → {novo_status}"
                }), 400

            extra_sql = ''
            extra_params = []
            if novo_status == 'cancelado':
                extra_sql = ', motivo_cancelamento = %s, slot_id = NULL'
                extra_params.append(motivo)
                # Libera slot
                if slot_id:
                    cursor.execute("""
                        UPDATE radio_slots
                        SET status = 'livre', radio_agenda_id = NULL, atualizado_em = NOW()
                        WHERE id = %s
                    """, (slot_id,))
            elif novo_status == 'no_local':
                extra_sql = ', dt_no_local = NOW()'
            elif novo_status == 'executando':
                extra_sql = ', dt_inicio_exame = NOW()'
            elif novo_status == 'concluido':
                extra_sql = ', dt_conclusao_exame = NOW()'

            cursor.execute(f"""
                UPDATE radio_agenda
                SET status = %s {extra_sql}, atualizado_em = NOW()
                WHERE id = %s
            """, [novo_status] + extra_params + [radio_id])

        cache_delete_pattern('painel45:*')
        cache_delete_pattern('painel46:*')
        current_app.logger.info(f'P46: Exame {radio_id} → {novo_status}')
        return jsonify({'success': True})

    except Exception as e:
        current_app.logger.error(f'Erro status p46: {e}', exc_info=True)
        return jsonify({'success': False, 'error': 'Erro ao atualizar status'}), 500


# ── Vincular / desvincular slot a um exame ──────────────────

@painel46_bp.route('/api/paineis/painel46/exames/<int:radio_id>/agendar', methods=['PUT'])
@login_required
@panel_permission_required('painel46')
def api_p46_agendar(radio_id):
    """Vincula ou desvincula um slot a um radio_agenda."""
    try:
        dados = request.get_json() or {}
        slot_id = dados.get('slot_id')  # None = desvincular

        with get_db_cursor(use_dict_cursor=False) as cursor:
            cursor.execute("""
                SELECT id, status, slot_id FROM radio_agenda
                WHERE id = %s AND status NOT IN ('concluido','cancelado')
            """, (radio_id,))
            row = cursor.fetchone()
            if not row:
                return jsonify({'success': False, 'error': 'Registro não encontrado ou finalizado'}), 404

            slot_id_atual = row[2]

            # Desvincular slot anterior
            if slot_id_atual:
                cursor.execute("""
                    UPDATE radio_slots
                    SET status = 'livre', radio_agenda_id = NULL, atualizado_em = NOW()
                    WHERE id = %s
                """, (slot_id_atual,))

            if slot_id:
                # Verificar disponibilidade
                cursor.execute("""
                    SELECT id, status FROM radio_slots
                    WHERE id = %s
                """, (slot_id,))
                slot = cursor.fetchone()
                if not slot:
                    return jsonify({'success': False, 'error': 'Slot não encontrado'}), 404
                if slot[1] == 'bloqueado':
                    return jsonify({'success': False, 'error': 'Slot bloqueado'}), 409
                if slot[1] == 'ocupado':
                    return jsonify({'success': False, 'error': 'Slot já ocupado por outro paciente'}), 409

                # Vincular
                cursor.execute("""
                    UPDATE radio_slots
                    SET status = 'ocupado', radio_agenda_id = %s, atualizado_em = NOW()
                    WHERE id = %s
                """, (radio_id, slot_id))
                cursor.execute("""
                    UPDATE radio_agenda
                    SET slot_id           = %s,
                        status            = 'agendado',
                        status_enfermagem = 'pendente',
                        motivo_recusa     = NULL,
                        dt_recusa         = NULL,
                        dt_ciencia        = NULL,
                        atualizado_em     = NOW()
                    WHERE id = %s
                """, (slot_id, radio_id))
            else:
                # Apenas desvincula
                cursor.execute("""
                    UPDATE radio_agenda
                    SET slot_id = NULL,
                        status = CASE WHEN status = 'agendado' THEN 'pendente' ELSE status END,
                        atualizado_em = NOW()
                    WHERE id = %s
                """, (radio_id,))

        cache_delete_pattern('painel45:*')
        cache_delete_pattern('painel46:*')
        return jsonify({'success': True})

    except Exception as e:
        current_app.logger.error(f'Erro agendar p46: {e}', exc_info=True)
        return jsonify({'success': False, 'error': 'Erro ao agendar'}), 500


# ── CRUD de Slots ────────────────────────────────────────────

@painel46_bp.route('/api/paineis/painel46/slots')
@login_required
@panel_permission_required('painel46')
def api_p46_slots_get():
    """Retorna slots de uma data com info do paciente vinculado. ?data=YYYY-MM-DD
    Para hoje: exclui automaticamente vagas passadas sem uso (livre/bloqueado)
    e retorna apenas vagas futuras + vagas ocupadas (independente do horário).
    """
    try:
        data_str = request.args.get('data', datetime.now().strftime('%Y-%m-%d'))
        hoje = datetime.now().strftime('%Y-%m-%d')
        eh_hoje = (data_str == hoje)

        _SELECT_SLOTS = """
            SELECT
                rs.id, rs.data_hora, rs.duracao_min, rs.modalidade,
                rs.status, rs.obs_bloqueio,
                ra.id           AS radio_id,
                ra.nm_paciente,
                ra.ds_procedimento,
                ra.leito_origem,
                ra.setor_origem_nome,
                ra.prioridade,
                ra.status       AS radio_status,
                ra.status_enfermagem,
                ra.requer_preparo,
                ra.tipo_preparo
            FROM radio_slots rs
            LEFT JOIN radio_agenda ra ON ra.id = rs.radio_agenda_id
        """

        with get_db_cursor() as cursor:
            if eh_hoje:
                # Remove vagas passadas sem uso para manter a agenda limpa
                cursor.execute("""
                    DELETE FROM radio_slots
                    WHERE DATE(data_hora) = %s
                      AND data_hora < NOW()
                      AND status IN ('livre', 'bloqueado')
                """, (data_str,))

                cursor.execute(_SELECT_SLOTS + """
                    WHERE DATE(rs.data_hora) = %s
                      AND (rs.data_hora >= NOW() OR rs.status = 'ocupado')
                    ORDER BY rs.data_hora
                """, (data_str,))
            else:
                cursor.execute(_SELECT_SLOTS + """
                    WHERE DATE(rs.data_hora) = %s
                    ORDER BY rs.data_hora
                """, (data_str,))

            return jsonify({'success': True, 'data': [_serial(dict(r)) for r in cursor.fetchall()],
                            'data_consultada': data_str})
    except Exception as e:
        current_app.logger.error(f'Erro slots get p46: {e}', exc_info=True)
        return jsonify({'success': False, 'error': 'Erro ao buscar slots'}), 500


@painel46_bp.route('/api/paineis/painel46/slots', methods=['POST'])
@login_required
@panel_permission_required('painel46')
def api_p46_slots_criar():
    """Cria um slot avulso."""
    try:
        dados = request.get_json() or {}
        data_hora_str = dados.get('data_hora', '')
        if not data_hora_str:
            return jsonify({'success': False, 'error': 'data_hora obrigatório'}), 400

        try:
            data_hora = datetime.fromisoformat(data_hora_str)
        except ValueError:
            return jsonify({'success': False, 'error': 'Formato de data inválido (ISO 8601)'}), 400

        if data_hora < datetime.now():
            return jsonify({'success': False, 'error': 'Não é possível criar vaga em horário já passado'}), 400

        with get_db_cursor(use_dict_cursor=False) as cursor:
            cursor.execute("""
                INSERT INTO radio_slots (data_hora, duracao_min, modalidade, criado_por_id)
                VALUES (%s, %s, %s, %s)
                RETURNING id
            """, (
                data_hora,
                dados.get('duracao_min', 30),
                dados.get('modalidade') or None,
                session.get('usuario_id')
            ))
            novo_id = cursor.fetchone()[0]

        cache_delete_pattern('painel46:*')
        cache_delete_pattern('painel45:*')
        return jsonify({'success': True, 'id': novo_id}), 201

    except Exception as e:
        current_app.logger.error(f'Erro criar slot p46: {e}', exc_info=True)
        return jsonify({'success': False, 'error': 'Erro ao criar slot'}), 500


@painel46_bp.route('/api/paineis/painel46/slots/lote', methods=['POST'])
@login_required
@panel_permission_required('painel46')
def api_p46_slots_lote():
    """
    Cria slots em lote para uma data.
    Body: { data, hora_inicio, hora_fim, duracao_min, modalidade }
    Ex: data=2026-07-01, hora_inicio=08:00, hora_fim=17:00, duracao_min=30
    → cria slots às 08:00, 08:30, 09:00 … 16:30
    """
    try:
        dados = request.get_json() or {}
        data_str      = dados.get('data', '')
        hora_inicio   = dados.get('hora_inicio', '08:00')
        hora_fim      = dados.get('hora_fim', '17:00')
        duracao_min   = int(dados.get('duracao_min', 30))
        modalidade    = dados.get('modalidade') or None

        if not data_str:
            return jsonify({'success': False, 'error': 'data obrigatória'}), 400

        try:
            dt_inicio = datetime.fromisoformat(f'{data_str}T{hora_inicio}')
            dt_fim    = datetime.fromisoformat(f'{data_str}T{hora_fim}')
        except ValueError:
            return jsonify({'success': False, 'error': 'Formato de hora inválido (HH:MM)'}), 400

        if duracao_min < 5 or duracao_min > 480:
            return jsonify({'success': False, 'error': 'Duração entre 5 e 480 minutos'}), 400

        slots_criados = 0
        slots_ignorados = 0
        agora = datetime.now()

        # Gera todos os timestamps válidos de uma vez (evita N+1 — P2.17)
        timestamps = []
        dt_atual = dt_inicio
        while dt_atual < dt_fim:
            if dt_atual < agora:
                slots_ignorados += 1
            else:
                timestamps.append(dt_atual)
            dt_atual += timedelta(minutes=duracao_min)

        with get_db_cursor(use_dict_cursor=False) as cursor:
            if timestamps:
                # Busca conflitos em lote — 1 SELECT no lugar de N
                if modalidade is not None:
                    cursor.execute("""
                        SELECT data_hora FROM radio_slots
                        WHERE data_hora = ANY(%s) AND modalidade = %s
                    """, (timestamps, modalidade))
                else:
                    cursor.execute("""
                        SELECT data_hora FROM radio_slots
                        WHERE data_hora = ANY(%s) AND modalidade IS NULL
                    """, (timestamps,))
                existentes = {row[0] for row in cursor.fetchall()}

                novos = [t for t in timestamps if t not in existentes]
                slots_ignorados += len(timestamps) - len(novos)

                # Insere todos de uma vez — 1 INSERT no lugar de N
                if novos:
                    uid = session.get('usuario_id')
                    execute_values(cursor, """
                        INSERT INTO radio_slots (data_hora, duracao_min, modalidade, criado_por_id)
                        VALUES %s
                    """, [(t, duracao_min, modalidade, uid) for t in novos])
                    slots_criados = len(novos)

        cache_delete_pattern('painel46:*')
        cache_delete_pattern('painel45:*')
        return jsonify({'success': True, 'criados': slots_criados, 'ignorados': slots_ignorados})

    except Exception as e:
        current_app.logger.error(f'Erro lote slots p46: {e}', exc_info=True)
        return jsonify({'success': False, 'error': 'Erro ao criar slots em lote'}), 500


@painel46_bp.route('/api/paineis/painel46/slots/<int:slot_id>', methods=['PUT'])
@login_required
@panel_permission_required('painel46')
def api_p46_slots_atualizar(slot_id):
    """
    Atualiza slot: bloquear, desbloquear ou editar campos permitidos.
    Body: { acao: 'bloquear'|'desbloquear'|'editar', obs_bloqueio, modalidade, duracao_min }
    """
    try:
        dados = request.get_json() or {}
        acao = (dados.get('acao') or 'editar').lower()

        with get_db_cursor(use_dict_cursor=False) as cursor:
            cursor.execute("SELECT id, status, radio_agenda_id FROM radio_slots WHERE id = %s", (slot_id,))
            slot = cursor.fetchone()
            if not slot:
                return jsonify({'success': False, 'error': 'Slot não encontrado'}), 404

            status_atual, radio_agenda_id = slot[1], slot[2]

            if acao == 'bloquear':
                if status_atual == 'ocupado':
                    return jsonify({'success': False, 'error': 'Não é possível bloquear slot ocupado'}), 409
                cursor.execute("""
                    UPDATE radio_slots
                    SET status = 'bloqueado', obs_bloqueio = %s, atualizado_em = NOW()
                    WHERE id = %s
                """, (dados.get('obs_bloqueio', ''), slot_id))

            elif acao == 'desbloquear':
                if status_atual != 'bloqueado':
                    return jsonify({'success': False, 'error': 'Slot não está bloqueado'}), 409
                cursor.execute("""
                    UPDATE radio_slots
                    SET status = 'livre', obs_bloqueio = NULL, atualizado_em = NOW()
                    WHERE id = %s
                """, (slot_id,))

            elif acao == 'editar':
                if status_atual == 'ocupado':
                    return jsonify({'success': False, 'error': 'Não é possível editar slot ocupado'}), 409
                sets = []
                vals = []
                for campo in _CAMPOS_SLOT:
                    if campo in dados:
                        sets.append(f'{campo} = %s')
                        vals.append(dados[campo] if dados[campo] != '' else None)
                if not sets:
                    return jsonify({'success': False, 'error': 'Nenhum campo para atualizar'}), 400
                sets.append('atualizado_em = NOW()')
                vals.append(slot_id)
                cursor.execute(f"UPDATE radio_slots SET {', '.join(sets)} WHERE id = %s", vals)

            else:
                return jsonify({'success': False, 'error': 'Ação inválida'}), 400

        cache_delete_pattern('painel46:*')
        cache_delete_pattern('painel45:*')
        return jsonify({'success': True})

    except Exception as e:
        current_app.logger.error(f'Erro update slot p46: {e}', exc_info=True)
        return jsonify({'success': False, 'error': 'Erro ao atualizar slot'}), 500


@painel46_bp.route('/api/paineis/painel46/todos-exames')
@login_required
@panel_permission_required('painel46')
@cache_route(ttl=30, key_prefix='painel46:todos-exames', vary_by_user=False, vary_by_query=True)
def api_p46_todos_exames():
    """
    Retorna todos os exames de radiologia prescritos (vw_painel19_radiologia)
    com status de controle (radio_agenda) e slot vinculado.
    ?setor=nome_setor
    """
    try:
        setor = request.args.get('setor', '').strip()
        filtros = []
        params = []
        if setor:
            filtros.append("p.nm_setor = %s")
            params.append(setor)
        where = ('WHERE ' + ' AND '.join(filtros)) if filtros else ''

        with get_db_cursor() as cursor:
            cursor.execute(f"""
                SELECT
                    p.nr_atendimento, p.nm_pessoa_fisica,
                    p.leito, p.leito_base, p.nm_setor, p.cd_setor_atendimento,
                    p.nr_prescricao, p.ds_procedimento,
                    p.status_radiologia, p.dt_pedido, p.prioridade_ordem,
                    ra.id            AS radio_id,
                    ra.status        AS radio_status,
                    ra.prioridade    AS radio_prioridade,
                    ra.requer_transporte,
                    rs.data_hora     AS slot_data_hora,
                    pc.id            AS chamado_id,
                    pc.status        AS chamado_status
                FROM vw_painel19_radiologia p
                LEFT JOIN radio_agenda ra ON (
                    ra.nr_atendimento = p.nr_atendimento::varchar
                    AND ra.nr_prescricao = p.nr_prescricao::varchar
                    AND ra.status NOT IN ('concluido', 'cancelado')
                )
                LEFT JOIN radio_slots rs ON rs.id = ra.slot_id
                LEFT JOIN LATERAL (
                    SELECT id, status
                    FROM padioleiro_chamados
                    WHERE nr_atendimento = p.nr_atendimento::varchar
                      AND status NOT IN ('concluido', 'cancelado')
                    ORDER BY criado_em DESC LIMIT 1
                ) pc ON TRUE
                {where}
                ORDER BY p.nm_setor, p.leito_base, p.prioridade_ordem, p.dt_pedido
            """, params)
            dados = [_serial(dict(r)) for r in cursor.fetchall()]

        return jsonify({'success': True, 'data': dados, 'total': len(dados),
                        'timestamp': datetime.now().isoformat()})

    except Exception as e:
        current_app.logger.error(f'Erro todos-exames p46: {e}', exc_info=True)
        return jsonify({'success': False, 'error': 'Erro ao buscar exames'}), 500


@painel46_bp.route('/api/paineis/painel46/slots/<int:slot_id>', methods=['DELETE'])
@login_required
@panel_permission_required('painel46')
def api_p46_slots_deletar(slot_id):
    """Remove slot livre ou bloqueado. Não remove slots ocupados."""
    try:
        with get_db_cursor(use_dict_cursor=False) as cursor:
            cursor.execute("SELECT status FROM radio_slots WHERE id = %s", (slot_id,))
            row = cursor.fetchone()
            if not row:
                return jsonify({'success': False, 'error': 'Slot não encontrado'}), 404
            if row[0] == 'ocupado':
                return jsonify({'success': False, 'error': 'Não é possível remover slot ocupado. Desagende o paciente primeiro.'}), 409
            cursor.execute("DELETE FROM radio_slots WHERE id = %s", (slot_id,))

        cache_delete_pattern('painel46:*')
        cache_delete_pattern('painel45:*')
        return jsonify({'success': True})

    except Exception as e:
        current_app.logger.error(f'Erro delete slot p46: {e}', exc_info=True)
        return jsonify({'success': False, 'error': 'Erro ao remover slot'}), 500


@painel46_bp.route('/api/paineis/painel46/slots/<int:slot_id>/desvincular', methods=['PUT'])
@login_required
@panel_permission_required('painel46')
def api_p46_slot_desvincular(slot_id):
    """Desvincula paciente de uma vaga operando pelo slot (não pelo radio_agenda)."""
    try:
        with get_db_cursor(use_dict_cursor=False) as cursor:
            cursor.execute(
                "SELECT id, status, radio_agenda_id FROM radio_slots WHERE id = %s",
                (slot_id,)
            )
            slot = cursor.fetchone()
            if not slot:
                return jsonify({'success': False, 'error': 'Vaga não encontrada'}), 404
            if slot[1] != 'ocupado':
                return jsonify({'success': False, 'error': 'Vaga não está ocupada'}), 409

            radio_id = slot[2]

            cursor.execute("""
                UPDATE radio_slots
                SET status = 'livre', radio_agenda_id = NULL, atualizado_em = NOW()
                WHERE id = %s
            """, (slot_id,))

            if radio_id:
                cursor.execute("""
                    UPDATE radio_agenda
                    SET slot_id           = NULL,
                        status            = CASE WHEN status = 'agendado' THEN 'pendente' ELSE status END,
                        status_enfermagem = 'pendente',
                        dt_ciencia        = NULL,
                        atualizado_em     = NOW()
                    WHERE id = %s AND status NOT IN ('concluido', 'cancelado')
                """, (radio_id,))

        cache_delete_pattern('painel46:*')
        cache_delete_pattern('painel45:*')
        return jsonify({'success': True})

    except Exception as e:
        current_app.logger.error(f'Erro desvincular slot p46: {e}', exc_info=True)
        return jsonify({'success': False, 'error': 'Erro ao desvincular'}), 500


# ── Prescrições Tasy (nova aba principal) ────────────────────

@painel46_bp.route('/api/paineis/painel46/prescricoes')
@login_required
@panel_permission_required('painel46')
def api_p46_prescricoes():
    """
    Todas as prescrições de radiologia (vw_painel19_radiologia) com status de controle
    interno (radio_agenda), slot agendado e tipo_exame.
    ?setor=nome  &tipo=RX|RM|TC|USG|MAM|OUTROS
    """
    try:
        _auto_finalizar_expirados(current_app.logger)
        setor = request.args.get('setor', '').strip()
        tipo  = request.args.get('tipo',  '').strip().upper()

        filtros = []
        params  = []
        if setor:
            filtros.append("p.nm_setor = %s")
            params.append(setor)
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
                    p.dt_laudo,
                    p.prioridade_ordem,
                    p.ie_urgente,
                    p.ds_convenio,
                    p.nm_medico_solicitante,
                    {_SQL_TIPO_EXAME_P} AS tipo_exame,
                    ra.id                AS radio_id,
                    ra.status            AS radio_status,
                    ra.status_enfermagem,
                    ra.motivo_recusa,
                    ra.prioridade        AS radio_prioridade,
                    ra.requer_transporte,
                    ra.observacao        AS radio_obs,
                    ra.requer_preparo,
                    ra.tipo_preparo      AS radio_preparo,
                    rs.id               AS slot_id,
                    rs.data_hora        AS slot_data_hora,
                    rs.duracao_min      AS slot_duracao,
                    rs.modalidade       AS slot_modalidade,
                    EXISTS (
                        SELECT 1 FROM radio_agenda ra2
                        WHERE ra2.nr_atendimento = p.nr_atendimento::varchar
                          AND ra2.nr_prescricao  = p.nr_prescricao::varchar
                          AND ra2.status = 'concluido'
                    ) AS concluido_interno,
                    EXISTS (
                        SELECT 1 FROM radio_agenda ra3
                        WHERE ra3.nr_atendimento = p.nr_atendimento::varchar
                          AND ra3.nr_prescricao  = p.nr_prescricao::varchar
                          AND ra3.status = 'concluido'
                          AND ra3.auto_finalizado = TRUE
                    ) AS auto_finalizado_sistema
                FROM vw_painel19_radiologia p
                LEFT JOIN radio_agenda ra ON (
                    ra.nr_atendimento  = p.nr_atendimento::varchar
                    AND ra.nr_prescricao   = p.nr_prescricao::varchar
                    AND ra.ds_procedimento = p.ds_procedimento
                    AND ra.status NOT IN ('concluido', 'cancelado')
                )
                LEFT JOIN radio_slots rs ON rs.id = ra.slot_id
                {where}
                ORDER BY p.nm_setor, p.leito_base, p.prioridade_ordem, p.dt_pedido
            """, params)
            dados = [_serial(dict(r)) for r in cursor.fetchall()]

        if tipo:
            dados = [d for d in dados if d.get('tipo_exame') == tipo]

        return jsonify({'success': True, 'data': dados, 'total': len(dados),
                        'timestamp': datetime.now().isoformat()})

    except Exception as e:
        current_app.logger.error(f'Erro prescricoes p46: {e}', exc_info=True)
        return jsonify({'success': False, 'error': 'Erro ao buscar prescrições'}), 500


# ── Agendar prescrição (cria/reagenda radio_agenda + atribui slot) ────

@painel46_bp.route('/api/paineis/painel46/agendar-prescricao', methods=['POST'])
@login_required
@panel_permission_required('painel46')
def api_p46_agendar_prescricao():
    """
    Cria ou reagenda um exame a partir de uma prescrição Tasy.
    - Se não existe radio_agenda ativo: cria + vincula slot
    - Se existe radio_agenda pendente/recusado: reusa + vincula novo slot + status_enfermagem=pendente
    Body: { nr_atendimento, nr_prescricao, slot_id,
            nm_paciente, ds_procedimento, leito_origem, setor_origem_nome,
            cd_setor_atendimento, prioridade, requer_transporte, observacao,
            nm_medico_solicitante }
    """
    try:
        dados = request.get_json() or {}
        nr_atendimento  = str(dados.get('nr_atendimento',  '')).strip()
        nr_prescricao   = str(dados.get('nr_prescricao',   '')).strip()
        ds_procedimento = str(dados.get('ds_procedimento', '') or '').strip()
        slot_id         = dados.get('slot_id')
        requer_preparo  = bool(dados.get('requer_preparo', False))
        tipo_preparo    = str(dados.get('tipo_preparo', '') or '').strip()

        if not nr_atendimento or not nr_prescricao:
            return jsonify({'success': False,
                            'error': 'nr_atendimento e nr_prescricao são obrigatórios'}), 400
        if not slot_id:
            return jsonify({'success': False, 'error': 'slot_id é obrigatório'}), 400
        if requer_preparo and len(tipo_preparo) < 15:
            return jsonify({'success': False,
                            'error': 'Descreva o preparo com ao menos 15 caracteres'}), 400

        with get_db_cursor(use_dict_cursor=False) as cursor:
            # Verificar slot
            cursor.execute("SELECT id, status FROM radio_slots WHERE id = %s", (slot_id,))
            slot = cursor.fetchone()
            if not slot:
                return jsonify({'success': False, 'error': 'Slot não encontrado'}), 404
            if slot[1] == 'bloqueado':
                return jsonify({'success': False, 'error': 'Slot bloqueado'}), 409
            if slot[1] == 'ocupado':
                return jsonify({'success': False, 'error': 'Slot já ocupado por outro paciente'}), 409

            # Verificar radio_agenda existente (pendente, agendado, recusado)
            cursor.execute("""
                SELECT id, status, slot_id
                FROM radio_agenda
                WHERE nr_atendimento = %s AND nr_prescricao = %s AND ds_procedimento = %s
                  AND status NOT IN ('concluido', 'cancelado')
                ORDER BY criado_em DESC
                LIMIT 1
            """, (nr_atendimento, nr_prescricao, ds_procedimento))
            existente = cursor.fetchone()

            if existente:
                radio_id      = existente[0]
                slot_id_atual = existente[2]

                # Libera slot anterior
                if slot_id_atual:
                    cursor.execute("""
                        UPDATE radio_slots
                        SET status = 'livre', radio_agenda_id = NULL, atualizado_em = NOW()
                        WHERE id = %s
                    """, (slot_id_atual,))

                cursor.execute("""
                    UPDATE radio_agenda
                    SET slot_id           = %s,
                        status            = 'agendado',
                        status_enfermagem = 'pendente',
                        motivo_recusa     = NULL,
                        dt_recusa         = NULL,
                        dt_ciencia        = NULL,
                        requer_preparo    = %s,
                        tipo_preparo      = %s,
                        atualizado_em     = NOW()
                    WHERE id = %s
                """, (slot_id, requer_preparo, tipo_preparo, radio_id))
            else:
                cursor.execute("""
                    INSERT INTO radio_agenda (
                        nr_atendimento, nr_prescricao, nm_paciente, ds_procedimento,
                        leito_origem, setor_origem_nome, cd_setor_atendimento,
                        prioridade, requer_transporte, observacao, nm_medico_solicitante,
                        requer_preparo, tipo_preparo,
                        slot_id, status, criado_em, atualizado_em
                    ) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,'agendado',NOW(),NOW())
                    RETURNING id
                """, (
                    nr_atendimento,
                    nr_prescricao,
                    dados.get('nm_paciente', ''),
                    dados.get('ds_procedimento', ''),
                    dados.get('leito_origem', ''),
                    dados.get('setor_origem_nome', ''),
                    dados.get('cd_setor_atendimento'),
                    dados.get('prioridade', 'normal'),
                    dados.get('requer_transporte', False),
                    dados.get('observacao', ''),
                    dados.get('nm_medico_solicitante', ''),
                    requer_preparo,
                    tipo_preparo,
                    slot_id,
                ))
                radio_id = cursor.fetchone()[0]

            # Ocupa o slot
            cursor.execute("""
                UPDATE radio_slots
                SET status = 'ocupado', radio_agenda_id = %s, atualizado_em = NOW()
                WHERE id = %s
            """, (radio_id, slot_id))

        cache_delete_pattern('painel46:*')
        cache_delete_pattern('painel45:*')
        usuario = session.get('nome_completo') or session.get('usuario', '')
        current_app.logger.info(
            f'P46 agendar-prescricao: atend={nr_atendimento} presc={nr_prescricao} slot={slot_id} por {usuario}'
        )
        return jsonify({'success': True, 'radio_id': radio_id}), 201

    except Exception as e:
        current_app.logger.error(f'Erro agendar-prescricao p46: {e}', exc_info=True)
        return jsonify({'success': False, 'error': 'Erro ao agendar prescrição'}), 500


# ── Agendar múltiplos exames no mesmo horário ────────────────

@painel46_bp.route('/api/paineis/painel46/agendar-lote', methods=['POST'])
@login_required
@panel_permission_required('painel46')
def api_p46_agendar_lote():
    """
    Agenda vários exames de uma vez, criando um slot individual para cada um.
    Usado após agendar o exame principal para incluir irmãos no mesmo horário.
    Body: {
        exames:          [{nr_atendimento, nr_prescricao, ds_procedimento,
                           nm_paciente, leito_origem, setor_origem_nome,
                           cd_setor_atendimento, nm_medico_solicitante, prioridade}],
        slot_data_hora:  str (ISO 8601),
        slot_duracao_min: int,
        slot_modalidade: str | None
    }
    """
    try:
        dados            = request.get_json() or {}
        exames           = dados.get('exames', [])
        data_hora_str    = dados.get('slot_data_hora', '')
        duracao_min      = int(dados.get('slot_duracao_min', 30))
        modalidade       = dados.get('slot_modalidade') or None

        if not exames:
            return jsonify({'success': False, 'error': 'Nenhum exame informado'}), 400
        if not data_hora_str:
            return jsonify({'success': False, 'error': 'slot_data_hora é obrigatório'}), 400

        try:
            slot_data_hora = datetime.fromisoformat(data_hora_str.replace('Z', ''))
        except ValueError:
            return jsonify({'success': False, 'error': 'Formato de data inválido'}), 400

        agendados = []
        erros     = []
        usuario   = session.get('nome_completo') or session.get('usuario', '')

        for ex in exames:
            nr_at  = str(ex.get('nr_atendimento',  '') or '').strip()
            nr_pr  = str(ex.get('nr_prescricao',   '') or '').strip()
            ds_pr  = str(ex.get('ds_procedimento', '') or '').strip()
            if not nr_at or not nr_pr:
                erros.append({'proc': ds_pr, 'erro': 'nr_atendimento/nr_prescricao ausente'})
                continue

            try:
                with get_db_cursor(use_dict_cursor=False) as cursor:
                    # Verifica registro existente por exame individual
                    cursor.execute("""
                        SELECT id, slot_id FROM radio_agenda
                        WHERE nr_atendimento = %s AND nr_prescricao = %s AND ds_procedimento = %s
                          AND status NOT IN ('concluido', 'cancelado')
                        ORDER BY criado_em DESC LIMIT 1
                    """, (nr_at, nr_pr, ds_pr))
                    existente = cursor.fetchone()

                    # Cria slot para este exame
                    cursor.execute("""
                        INSERT INTO radio_slots (data_hora, duracao_min, modalidade, criado_por_id)
                        VALUES (%s, %s, %s, %s) RETURNING id
                    """, (slot_data_hora, duracao_min, modalidade, session.get('usuario_id')))
                    new_slot_id = cursor.fetchone()[0]

                    if existente:
                        radio_id      = existente[0]
                        slot_id_atual = existente[1]
                        # Libera slot anterior
                        if slot_id_atual:
                            cursor.execute("""
                                UPDATE radio_slots
                                SET status = 'livre', radio_agenda_id = NULL, atualizado_em = NOW()
                                WHERE id = %s
                            """, (slot_id_atual,))
                        cursor.execute("""
                            UPDATE radio_agenda
                            SET slot_id = %s, status = 'agendado', status_enfermagem = 'pendente',
                                motivo_recusa = NULL, dt_recusa = NULL, dt_ciencia = NULL,
                                atualizado_em = NOW()
                            WHERE id = %s
                        """, (new_slot_id, radio_id))
                    else:
                        cursor.execute("""
                            INSERT INTO radio_agenda (
                                nr_atendimento, nr_prescricao, nm_paciente, ds_procedimento,
                                leito_origem, setor_origem_nome, cd_setor_atendimento,
                                prioridade, requer_transporte, observacao, nm_medico_solicitante,
                                requer_preparo, tipo_preparo,
                                slot_id, status, criado_em, atualizado_em
                            ) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,'agendado',NOW(),NOW())
                            RETURNING id
                        """, (
                            nr_at, nr_pr,
                            ex.get('nm_paciente', ''), ds_pr,
                            ex.get('leito_origem', ''), ex.get('setor_origem_nome', ''),
                            ex.get('cd_setor_atendimento'),
                            ex.get('prioridade', 'normal'),
                            bool(ex.get('requer_transporte', True)),
                            '', '', False, '',
                            new_slot_id,
                        ))
                        radio_id = cursor.fetchone()[0]

                    # Ocupa o slot criado
                    cursor.execute("""
                        UPDATE radio_slots
                        SET status = 'ocupado', radio_agenda_id = %s, atualizado_em = NOW()
                        WHERE id = %s
                    """, (radio_id, new_slot_id))

                agendados.append({'proc': ds_pr, 'radio_id': radio_id})
                current_app.logger.info(
                    f'P46 agendar-lote: atend={nr_at} presc={nr_pr} proc="{ds_pr}" '
                    f'slot={new_slot_id} por {usuario}'
                )

            except Exception as ex_err:
                current_app.logger.error(
                    f'[P46] agendar-lote erro em "{ds_pr}": {ex_err}', exc_info=True
                )
                erros.append({'proc': ds_pr, 'erro': 'Erro interno ao agendar'})

        if agendados:
            cache_delete_pattern('painel46:*')
            cache_delete_pattern('painel45:*')

        return jsonify({
            'success': len(agendados) > 0,
            'agendados': len(agendados),
            'erros': erros
        }), (201 if agendados else 400)

    except Exception as e:
        current_app.logger.error(f'Erro agendar-lote p46: {e}', exc_info=True)
        return jsonify({'success': False, 'error': 'Erro ao agendar em lote'}), 500


# ── Slots disponíveis filtrados por tipo de exame ────────────

@painel46_bp.route('/api/paineis/painel46/slots-por-tipo')
@login_required
@panel_permission_required('painel46')
@cache_route(ttl=15, key_prefix='painel46:slots-por-tipo', vary_by_user=False, vary_by_query=True)
def api_p46_slots_por_tipo():
    """
    Slots livres filtrados por tipo de exame e data.
    ?tipo=RX|RM|TC|USG|MAM|OUTROS  &data=YYYY-MM-DD  &primeira_data=true
    Com primeira_data=true: busca o próximo dia com vagas em uma única query (sem loop no frontend).
    OUTROS/vazio: sem filtro de modalidade (qualquer slot aceita).
    """
    try:
        tipo          = request.args.get('tipo', '').strip().upper()
        data_str      = request.args.get('data', '').strip()
        primeira_data = request.args.get('primeira_data', 'false').lower() == 'true'

        # OUTROS/vazio não filtra por modalidade — aceita qualquer slot
        modal = tipo if (tipo and tipo != 'OUTROS') else None

        with get_db_cursor() as cursor:
            if primeira_data:
                # Uma única query para encontrar o próximo dia com vagas
                if modal:
                    cursor.execute("""
                        SELECT DATE(data_hora) AS d
                        FROM radio_slots
                        WHERE status = 'livre' AND data_hora > NOW()
                          AND (modalidade = %s OR modalidade IS NULL)
                        ORDER BY data_hora
                        LIMIT 1
                    """, (modal,))
                else:
                    cursor.execute("""
                        SELECT DATE(data_hora) AS d
                        FROM radio_slots
                        WHERE status = 'livre' AND data_hora > NOW()
                        ORDER BY data_hora
                        LIMIT 1
                    """)
                row = cursor.fetchone()
                if not row or not row['d']:
                    return jsonify({'success': True, 'data': [], 'tipo': tipo,
                                    'data_consulta': None, 'total': 0})
                data_str = str(row['d'])

            if not data_str:
                data_str = datetime.now().strftime('%Y-%m-%d')

            filtros = ["DATE(rs.data_hora) = %s", "rs.status = 'livre'"]
            params  = [data_str]
            if modal:
                filtros.append("(rs.modalidade = %s OR rs.modalidade IS NULL)")
                params.append(modal)

            cursor.execute("""
                SELECT id, data_hora, duracao_min, modalidade
                FROM radio_slots rs
                WHERE {}
                ORDER BY rs.data_hora
            """.format(' AND '.join(filtros)), params)
            slots = [_serial(dict(r)) for r in cursor.fetchall()]

        return jsonify({'success': True, 'data': slots, 'tipo': tipo,
                        'data_consulta': data_str, 'total': len(slots)})

    except Exception as e:
        current_app.logger.error(f'Erro slots-por-tipo p46: {e}', exc_info=True)
        return jsonify({'success': False, 'error': 'Erro ao buscar slots por tipo'}), 500
