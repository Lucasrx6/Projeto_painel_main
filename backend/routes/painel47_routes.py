"""
Painel 47 - Gestão de Radiologia
Dashboard, histórico e relatórios do sistema de fluxo de radiologia.
"""
from flask import Blueprint, jsonify, send_from_directory, request, current_app, Response
from datetime import datetime
from decimal import Decimal
import csv
import io
from backend.database import get_db_cursor
from backend.middleware.decorators import login_required, panel_permission_required
from backend.cache import cache_route, cache_delete_pattern

painel47_bp = Blueprint('painel47', __name__)


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

@painel47_bp.route('/painel/painel47')
@login_required
@panel_permission_required('painel47')
def painel47():
    return send_from_directory('paineis/painel47', 'index.html')


# ── Dashboard ────────────────────────────────────────────────

@painel47_bp.route('/api/paineis/painel47/dashboard')
@login_required
@panel_permission_required('painel47')
@cache_route(ttl=60, key_prefix='painel47:dashboard')
def api_p47_dashboard():
    """Contadores gerais: hoje, semana, por status, por prioridade."""
    try:
        with get_db_cursor() as cursor:
            cursor.execute("""
                SELECT
                    COUNT(*) FILTER (WHERE DATE(criado_em) = CURRENT_DATE) AS hoje_total,
                    COUNT(*) FILTER (WHERE status = 'pendente')             AS pendentes,
                    COUNT(*) FILTER (WHERE status = 'agendado')             AS agendados,
                    COUNT(*) FILTER (WHERE status = 'no_local')             AS no_local,
                    COUNT(*) FILTER (WHERE status = 'executando')           AS executando,
                    COUNT(*) FILTER (WHERE status = 'concluido'
                                     AND DATE(atualizado_em) = CURRENT_DATE) AS concluidos_hoje,
                    COUNT(*) FILTER (WHERE status = 'cancelado'
                                     AND DATE(atualizado_em) = CURRENT_DATE) AS cancelados_hoje,
                    COUNT(*) FILTER (WHERE prioridade = 'urgente'
                                     AND status NOT IN ('concluido','cancelado')) AS urgentes_ativos,
                    COUNT(*) FILTER (WHERE requer_transporte = FALSE
                                     AND status NOT IN ('concluido','cancelado')) AS rx_portatil_ativos,
                    -- Tempo médio (concluídos com slot nos últimos 7 dias)
                    ROUND(AVG(
                        EXTRACT(EPOCH FROM (atualizado_em - criado_em)) / 3600
                    ) FILTER (
                        WHERE status = 'concluido'
                          AND criado_em >= NOW() - INTERVAL '7 days'
                    )::NUMERIC, 1) AS tempo_medio_horas_7d
                FROM radio_agenda
            """)
            dashboard = _serial(dict(cursor.fetchone()))

            # Slots de hoje
            cursor.execute("""
                SELECT
                    COUNT(*) FILTER (WHERE status = 'livre')    AS slots_livres,
                    COUNT(*) FILTER (WHERE status = 'ocupado')  AS slots_ocupados,
                    COUNT(*) FILTER (WHERE status = 'bloqueado') AS slots_bloqueados
                FROM radio_slots
                WHERE DATE(data_hora) = CURRENT_DATE
            """)
            slots_hoje = dict(cursor.fetchone())
            dashboard.update(slots_hoje)

        # Exames ativos hoje (não concluídos/cancelados)
        with get_db_cursor() as cursor:
            cursor.execute("""
                SELECT
                    ra.id, ra.nr_atendimento, ra.nm_paciente, ra.ds_procedimento,
                    ra.leito_origem, ra.setor_origem_nome, ra.prioridade,
                    ra.status, ra.criado_em
                FROM radio_agenda ra
                WHERE ra.status NOT IN ('concluido', 'cancelado')
                ORDER BY ra.prioridade DESC, ra.criado_em
            """)
            ativos = [_serial(dict(r)) for r in cursor.fetchall()]

        return jsonify({
            'success': True,
            'total_hoje':   dashboard.get('hoje_total', 0),
            'pendentes':    dashboard.get('pendentes', 0),
            'executando':   dashboard.get('executando', 0),
            'concluidos':   dashboard.get('concluidos_hoje', 0),
            'cancelados':   dashboard.get('cancelados_hoje', 0),
            'slots_hoje':   (dashboard.get('slots_livres', 0)
                             + dashboard.get('slots_ocupados', 0)
                             + dashboard.get('slots_bloqueados', 0)),
            'urgentes_ativos': dashboard.get('urgentes_ativos', 0),
            'tempo_medio_horas': dashboard.get('tempo_medio_horas_7d'),
            'ativos': ativos,
            'timestamp': datetime.now().isoformat()
        })

    except Exception as e:
        current_app.logger.error(f'Erro dashboard p47: {e}', exc_info=True)
        return jsonify({'success': False, 'error': 'Erro ao buscar dashboard'}), 500


# ── Histórico filtrado ───────────────────────────────────────

@painel47_bp.route('/api/paineis/painel47/chamados')
@login_required
@panel_permission_required('painel47')
def api_p47_chamados():
    """
    Histórico de exames com filtros.
    ?dias=7&status=concluido&setor=texto&limit=200
    """
    try:
        dias       = min(int(request.args.get('dias', 7)), 90)
        status     = request.args.get('status', '')
        setor      = request.args.get('setor', '')
        limit      = min(int(request.args.get('limit', 200)), 500)

        filtros = ["ra.criado_em >= NOW() - INTERVAL %s"]
        params  = [f'{dias} days']

        if status:
            filtros.append("ra.status = %s")
            params.append(status)
        if setor:
            filtros.append("ra.setor_origem_nome ILIKE %s")
            params.append(f'%{setor}%')

        where = 'WHERE ' + ' AND '.join(filtros)

        with get_db_cursor() as cursor:
            cursor.execute(f"""
                SELECT
                    ra.id, ra.nr_atendimento, ra.nm_paciente, ra.ds_procedimento,
                    ra.leito_origem, ra.setor_origem_nome, ra.prioridade,
                    ra.status, ra.requer_transporte,
                    ra.solicitante_nome, ra.observacao, ra.motivo_cancelamento,
                    ra.criado_em, ra.atualizado_em,
                    rs.data_hora AS slot_data_hora,
                    ROUND(
                        EXTRACT(EPOCH FROM (ra.atualizado_em - ra.criado_em)) / 3600
                    ::NUMERIC, 1) AS duracao_horas
                FROM radio_agenda ra
                LEFT JOIN radio_slots rs ON rs.id = ra.slot_id
                {where}
                ORDER BY ra.criado_em DESC
                LIMIT %s
            """, params + [limit])

            historico = [_serial(dict(r)) for r in cursor.fetchall()]

        return jsonify({'success': True, 'data': historico, 'total': len(historico)})

    except Exception as e:
        current_app.logger.error(f'Erro chamados p47: {e}', exc_info=True)
        return jsonify({'success': False, 'error': 'Erro ao buscar histórico'}), 500


# ── Cancelar administrativamente ────────────────────────────

@painel47_bp.route('/api/paineis/painel47/chamados/<int:radio_id>/cancelar', methods=['PUT'])
@login_required
@panel_permission_required('painel47')
def api_p47_cancelar(radio_id):
    """Cancela um exame de forma administrativa (gestão)."""
    try:
        dados = request.get_json() or {}
        motivo = (dados.get('motivo') or '').strip()
        if len(motivo) < 5:
            return jsonify({'success': False, 'error': 'Informe o motivo (mínimo 5 caracteres)'}), 400

        with get_db_cursor(use_dict_cursor=False) as cursor:
            cursor.execute("SELECT status, slot_id FROM radio_agenda WHERE id = %s", (radio_id,))
            row = cursor.fetchone()
            if not row:
                return jsonify({'success': False, 'error': 'Registro não encontrado'}), 404
            if row[0] in ('concluido', 'cancelado'):
                return jsonify({'success': False, 'error': 'Exame já finalizado'}), 409

            slot_id = row[1]
            if slot_id:
                cursor.execute("""
                    UPDATE radio_slots
                    SET status = 'livre', radio_agenda_id = NULL, atualizado_em = NOW()
                    WHERE id = %s
                """, (slot_id,))

            cursor.execute("""
                UPDATE radio_agenda
                SET status = 'cancelado', motivo_cancelamento = %s,
                    slot_id = NULL, atualizado_em = NOW()
                WHERE id = %s
            """, (motivo, radio_id))

        cache_delete_pattern('painel47:*')
        cache_delete_pattern('painel46:*')
        cache_delete_pattern('painel45:*')
        current_app.logger.info(f'P47: Exame {radio_id} cancelado administrativamente')
        return jsonify({'success': True})

    except Exception as e:
        current_app.logger.error(f'Erro cancelar p47: {e}', exc_info=True)
        return jsonify({'success': False, 'error': 'Erro ao cancelar'}), 500


# ── Analytics por modalidade ─────────────────────────────────

@painel47_bp.route('/api/paineis/painel47/por-modalidade')
@login_required
@panel_permission_required('painel47')
@cache_route(ttl=120, key_prefix='painel47:modalidade')
def api_p47_modalidade():
    """Volume e tempo médio por tipo de exame (ds_procedimento) — últimos 30 dias."""
    try:
        with get_db_cursor() as cursor:
            cursor.execute("""
                SELECT
                    ds_procedimento,
                    COUNT(*)                                         AS total,
                    COUNT(*) FILTER (WHERE status = 'concluido')    AS concluidos,
                    COUNT(*) FILTER (WHERE status = 'cancelado')    AS cancelados,
                    COUNT(*) FILTER (WHERE prioridade = 'urgente')  AS urgentes,
                    ROUND(AVG(
                        EXTRACT(EPOCH FROM (atualizado_em - criado_em)) / 3600
                    ) FILTER (WHERE status = 'concluido')::NUMERIC, 1) AS tempo_medio_h
                FROM radio_agenda
                WHERE criado_em >= NOW() - INTERVAL '30 days'
                GROUP BY ds_procedimento
                ORDER BY total DESC
                LIMIT 30
            """)
            return jsonify({'success': True, 'data': [_serial(dict(r)) for r in cursor.fetchall()]})
    except Exception as e:
        current_app.logger.error(f'Erro modalidade p47: {e}', exc_info=True)
        return jsonify({'success': False, 'error': 'Erro'}), 500


# ── Analytics por setor ──────────────────────────────────────

@painel47_bp.route('/api/paineis/painel47/por-setor')
@login_required
@panel_permission_required('painel47')
@cache_route(ttl=120, key_prefix='painel47:setor')
def api_p47_setor():
    """Volume por setor de origem."""
    try:
        dias = min(int(request.args.get('dias', 30)), 90)
        with get_db_cursor() as cursor:
            cursor.execute("""
                SELECT
                    setor_origem_nome,
                    COUNT(*)                                         AS total,
                    COUNT(*) FILTER (WHERE status = 'concluido')    AS concluidos,
                    COUNT(*) FILTER (WHERE prioridade = 'urgente')  AS urgentes,
                    COUNT(*) FILTER (WHERE requer_transporte = FALSE) AS rx_portatil
                FROM radio_agenda
                WHERE criado_em >= NOW() - INTERVAL %s
                GROUP BY setor_origem_nome
                ORDER BY total DESC
            """, (f'{dias} days',))
            return jsonify({'success': True, 'data': [dict(r) for r in cursor.fetchall()]})
    except Exception as e:
        current_app.logger.error(f'Erro setor p47: {e}', exc_info=True)
        return jsonify({'success': False, 'error': 'Erro'}), 500


# ── Exportar CSV ─────────────────────────────────────────────

@painel47_bp.route('/api/paineis/painel47/exportar')
@login_required
@panel_permission_required('painel47')
def api_p47_exportar():
    """Download CSV dos registros — ?dias=30"""
    try:
        dias = min(int(request.args.get('dias', 30)), 90)

        with get_db_cursor() as cursor:
            cursor.execute("""
                SELECT
                    ra.id, ra.criado_em, ra.atualizado_em,
                    ra.nr_atendimento, ra.nm_paciente,
                    ra.leito_origem, ra.setor_origem_nome,
                    ra.ds_procedimento, ra.requer_transporte,
                    ra.prioridade, ra.status,
                    ra.solicitante_nome,
                    rs.data_hora AS slot_agendado,
                    ra.motivo_cancelamento,
                    ROUND(
                        EXTRACT(EPOCH FROM (ra.atualizado_em - ra.criado_em)) / 3600
                    ::NUMERIC, 1) AS duracao_horas
                FROM radio_agenda ra
                LEFT JOIN radio_slots rs ON rs.id = ra.slot_id
                WHERE ra.criado_em >= NOW() - INTERVAL '%s days'
                ORDER BY ra.criado_em DESC
            """, (dias,))
            rows = cursor.fetchall()

        output = io.StringIO()
        output.write('﻿')  # BOM UTF-8
        writer = csv.writer(output, delimiter=';')
        writer.writerow([
            'ID', 'Criado em', 'Atualizado em', 'Atendimento', 'Paciente',
            'Leito', 'Setor', 'Exame', 'Requer Transporte',
            'Prioridade', 'Status', 'Solicitante', 'Slot Agendado',
            'Motivo Cancelamento', 'Duração (h)'
        ])
        for r in rows:
            writer.writerow([
                r['id'],
                r['criado_em'].strftime('%d/%m/%Y %H:%M') if r['criado_em'] else '',
                r['atualizado_em'].strftime('%d/%m/%Y %H:%M') if r['atualizado_em'] else '',
                r['nr_atendimento'], r['nm_paciente'],
                r['leito_origem'], r['setor_origem_nome'],
                r['ds_procedimento'],
                'Não' if not r['requer_transporte'] else 'Sim',
                r['prioridade'], r['status'], r['solicitante_nome'],
                r['slot_agendado'].strftime('%d/%m/%Y %H:%M') if r['slot_agendado'] else '',
                r['motivo_cancelamento'] or '',
                r['duracao_horas'] or ''
            ])

        nome_arquivo = f'radio_exames_{datetime.now().strftime("%Y%m%d_%H%M")}.csv'
        return Response(
            output.getvalue(),
            mimetype='text/csv; charset=utf-8',
            headers={'Content-Disposition': f'attachment; filename="{nome_arquivo}"'}
        )

    except Exception as e:
        current_app.logger.error(f'Erro exportar p47: {e}', exc_info=True)
        return jsonify({'success': False, 'error': 'Erro ao exportar'}), 500
