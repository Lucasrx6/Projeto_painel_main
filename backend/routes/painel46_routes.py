"""
Painel 46 - Radiologia (Agenda + Fila do Dia)
Visão da radiologia: fila de pacientes agendados e gestão de slots de horário.
"""
from flask import Blueprint, jsonify, send_from_directory, request, session, current_app
from datetime import datetime, timedelta
from decimal import Decimal
from psycopg2.extras import RealDictCursor
from backend.database import get_db_cursor
from backend.middleware.decorators import login_required, panel_permission_required
from backend.cache import cache_route, cache_delete_pattern

painel46_bp = Blueprint('painel46', __name__)

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
        data_str = request.args.get('data', datetime.now().strftime('%Y-%m-%d'))

        with get_db_cursor() as cursor:
            # Agendados para a data (com slot)
            cursor.execute("""
                SELECT
                    ra.id, ra.nr_atendimento, ra.nm_paciente, ra.ds_procedimento,
                    ra.leito_origem, ra.setor_origem_nome, ra.prioridade,
                    ra.status, ra.requer_transporte, ra.observacao,
                    ra.criado_em, ra.atualizado_em,
                    rs.id         AS slot_id,
                    rs.data_hora  AS slot_data_hora,
                    rs.duracao_min AS slot_duracao,
                    rs.modalidade AS slot_modalidade,
                    -- Padioleiro ativo
                    pc.id         AS chamado_id,
                    pc.status     AS chamado_status,
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
                      -- Agendados nesta data
                      (rs.id IS NOT NULL AND DATE(rs.data_hora) = %s)
                      -- Ou chegaram/estão em execução hoje (independente do slot)
                      OR (ra.status IN ('no_local', 'executando')
                          AND DATE(ra.atualizado_em) = %s)
                      -- Concluídos hoje
                      OR (ra.status = 'concluido' AND DATE(ra.atualizado_em) = %s)
                  )
                ORDER BY rs.data_hora NULLS LAST, ra.prioridade DESC, ra.criado_em
            """, (data_str, data_str, data_str))
            agendados = [_serial(dict(r)) for r in cursor.fetchall()]

            # Pendentes sem slot (qualquer data, não concluídos/cancelados)
            cursor.execute("""
                SELECT
                    ra.id, ra.nr_atendimento, ra.nm_paciente, ra.ds_procedimento,
                    ra.leito_origem, ra.setor_origem_nome, ra.prioridade,
                    ra.status, ra.requer_transporte, ra.observacao,
                    ra.criado_em, ra.atualizado_em,
                    pc.id         AS chamado_id,
                    pc.status     AS chamado_status,
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
                  AND ra.status IN ('pendente')
                ORDER BY ra.prioridade DESC, ra.criado_em
            """)
            pendentes = [_serial(dict(r)) for r in cursor.fetchall()]

        return jsonify({
            'success': True,
            'agendados': agendados,
            'pendentes': pendentes,
            'data': data_str,
            'timestamp': datetime.now().isoformat()
        })

    except Exception as e:
        current_app.logger.error(f'Erro fila p46: {e}', exc_info=True)
        return jsonify({'success': False, 'error': 'Erro ao buscar fila'}), 500


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
                    SET slot_id = %s, status = 'agendado', atualizado_em = NOW()
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
                ra.status       AS radio_status
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
        dt_atual = dt_inicio

        with get_db_cursor(use_dict_cursor=False) as cursor:
            while dt_atual < dt_fim:
                # Pula horários que já passaram
                if dt_atual < agora:
                    slots_ignorados += 1
                    dt_atual += timedelta(minutes=duracao_min)
                    continue

                # Ignora se já existe slot no mesmo horário e modalidade
                cursor.execute("""
                    SELECT id FROM radio_slots
                    WHERE data_hora = %s
                      AND (modalidade = %s OR (%s IS NULL AND modalidade IS NULL))
                """, (dt_atual, modalidade, modalidade))
                if cursor.fetchone():
                    slots_ignorados += 1
                else:
                    cursor.execute("""
                        INSERT INTO radio_slots (data_hora, duracao_min, modalidade, criado_por_id)
                        VALUES (%s, %s, %s, %s)
                    """, (dt_atual, duracao_min, modalidade, session.get('usuario_id')))
                    slots_criados += 1
                dt_atual += timedelta(minutes=duracao_min)

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
