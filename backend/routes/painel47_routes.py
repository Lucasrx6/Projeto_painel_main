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
                    ra.criado_em,
                    ra.dt_no_local,
                    ra.dt_inicio_exame,
                    ra.dt_conclusao_exame,
                    ra.atualizado_em,
                    rs.data_hora AS slot_data_hora,
                    ROUND(
                        (EXTRACT(EPOCH FROM (ra.atualizado_em - ra.criado_em)) / 3600)::NUMERIC, 1
                    ) AS duracao_horas,
                    -- Transporte do padioleiro mais próximo no tempo deste exame (opcional)
                    pc.criado_em          AS transp_solicitado,
                    pc.dt_aceite          AS transp_aceito,
                    pc.dt_inicio_transporte AS transp_inicio,
                    pc.dt_conclusao       AS transp_conclusao,
                    pc.padioleiro_nome    AS transp_padioleiro,
                    pc.status             AS transp_status
                FROM radio_agenda ra
                LEFT JOIN radio_slots rs ON rs.id = ra.slot_id
                LEFT JOIN LATERAL (
                    SELECT criado_em, dt_aceite, dt_inicio_transporte, dt_conclusao,
                           padioleiro_nome, status
                    FROM padioleiro_chamados
                    WHERE nr_atendimento = ra.nr_atendimento
                    ORDER BY ABS(EXTRACT(EPOCH FROM (criado_em - ra.criado_em)))
                    LIMIT 1
                ) pc ON TRUE
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


# ── Exportar CSV ─────────────────────────────────────────────

@painel47_bp.route('/api/paineis/painel47/exportar')
@login_required
@panel_permission_required('painel47')
def api_p47_exportar():
    """Download CSV dos registros — ?dias=30"""
    try:
        dias = min(int(request.args.get('dias', 30)), 90)

        def _fmt(dt):
            return dt.strftime('%d/%m/%Y %H:%M') if dt else ''

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
                    ra.dt_no_local,
                    ra.dt_inicio_exame,
                    ra.dt_conclusao_exame,
                    ROUND(
                        (EXTRACT(EPOCH FROM (ra.atualizado_em - ra.criado_em)) / 3600)::NUMERIC, 1
                    ) AS duracao_horas,
                    pc.criado_em            AS transp_solicitado,
                    pc.dt_aceite            AS transp_aceito,
                    pc.dt_inicio_transporte AS transp_inicio,
                    pc.dt_conclusao         AS transp_conclusao,
                    pc.padioleiro_nome      AS transp_padioleiro,
                    pc.status               AS transp_status
                FROM radio_agenda ra
                LEFT JOIN radio_slots rs ON rs.id = ra.slot_id
                LEFT JOIN LATERAL (
                    SELECT criado_em, dt_aceite, dt_inicio_transporte, dt_conclusao,
                           padioleiro_nome, status
                    FROM padioleiro_chamados
                    WHERE nr_atendimento = ra.nr_atendimento
                    ORDER BY ABS(EXTRACT(EPOCH FROM (criado_em - ra.criado_em)))
                    LIMIT 1
                ) pc ON TRUE
                WHERE ra.criado_em >= NOW() - INTERVAL %s
                ORDER BY ra.criado_em DESC
            """, (f'{dias} days',))
            rows = cursor.fetchall()

        output = io.StringIO()
        output.write('﻿')  # BOM UTF-8
        writer = csv.writer(output, delimiter=';')
        writer.writerow([
            'ID', 'Enviado (Enfermagem)', 'Slot Agendado', 'Atendimento', 'Paciente',
            'Leito', 'Setor', 'Exame', 'Requer Transporte',
            'Prioridade', 'Status',
            'Chegou (No Local)', 'Exame Iniciado', 'Exame Concluído',
            'Transporte Solicitado', 'Transporte Aceito', 'Transporte Iniciado', 'Transporte Concluído',
            'Padioleiro',
            'Solicitante', 'Motivo Cancelamento', 'Duração Total (h)'
        ])
        for r in rows:
            writer.writerow([
                r['id'],
                _fmt(r['criado_em']),
                _fmt(r['slot_agendado']),
                r['nr_atendimento'], r['nm_paciente'],
                r['leito_origem'], r['setor_origem_nome'],
                r['ds_procedimento'],
                'Não' if not r['requer_transporte'] else 'Sim',
                r['prioridade'], r['status'],
                _fmt(r['dt_no_local']),
                _fmt(r['dt_inicio_exame']),
                _fmt(r['dt_conclusao_exame']),
                _fmt(r['transp_solicitado']),
                _fmt(r['transp_aceito']),
                _fmt(r['transp_inicio']),
                _fmt(r['transp_conclusao']),
                r['transp_padioleiro'] or '',
                r['solicitante_nome'] or '',
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


# ── Produção: utilitário de filtro de período ────────────────

def _filtro_periodo(periodo):
    """Retorna (cláusula WHERE str, params list) para o período solicitado."""
    if periodo == 'hoje':
        return "DATE(dt_pedido) = CURRENT_DATE", []
    elif periodo == 'mes':
        return "dt_pedido >= DATE_TRUNC('month', NOW())", []
    else:
        try:
            dias = min(int(periodo), 365)
        except (ValueError, TypeError):
            dias = 30
        return "dt_pedido >= NOW() - INTERVAL %s", [f'{dias} days']


# ── Produção: Sync (UPSERT vw_painel19_radiologia → radio_producao) ──

@painel47_bp.route('/api/paineis/painel47/producao/sync', methods=['POST'])
@login_required
@panel_permission_required('painel47')
def api_p47_producao_sync():
    """
    Sincroniza vw_painel19_radiologia → radio_producao via UPSERT no nr_prescricao.
    Idempotente: pode ser chamado várias vezes sem duplicar registros.
    Preserva timestamps históricos (dt_laudo, dt_execucao) que já foram gravados.
    """
    try:
        with get_db_cursor(use_dict_cursor=False) as cursor:
            cursor.execute("""
                INSERT INTO radio_producao (
                    nr_atendimento, nr_prescricao, nm_pessoa_fisica, ds_procedimento,
                    nm_setor, cd_setor, leito, ds_convenio, ie_urgente,
                    nm_executor, nm_laudador, status_radiologia,
                    dt_pedido, dt_execucao, dt_laudo, dt_laudo_liberacao,
                    horas_espera, sem_envio_enfermagem, ultima_atualizacao
                )
                SELECT DISTINCT ON (p.nr_prescricao)
                    p.nr_atendimento::varchar,
                    p.nr_prescricao::varchar,
                    p.nm_pessoa_fisica,
                    p.ds_procedimento,
                    p.nm_setor,
                    p.cd_setor_atendimento,
                    COALESCE(p.leito_base, p.leito),
                    p.ds_convenio,
                    p.ie_urgente,
                    p.nm_executor,
                    p.nm_laudador,
                    p.status_radiologia,
                    p.dt_pedido,
                    p.dt_execucao,
                    p.dt_laudo,
                    p.dt_laudo_liberacao,
                    p.horas_espera,
                    -- sem_envio_enfermagem: true se exame já executado/laudado sem nenhum radio_agenda
                    (p.status_radiologia <> 'AGUARDANDO'
                     AND NOT EXISTS (
                         SELECT 1 FROM radio_agenda ra
                         WHERE ra.nr_prescricao = p.nr_prescricao::varchar
                     )),
                    NOW()
                FROM vw_painel19_radiologia p
                WHERE p.nr_prescricao IS NOT NULL
                ORDER BY p.nr_prescricao, p.dt_carga DESC
                ON CONFLICT (nr_prescricao) DO UPDATE SET
                    status_radiologia    = EXCLUDED.status_radiologia,
                    dt_execucao          = COALESCE(EXCLUDED.dt_execucao,        radio_producao.dt_execucao),
                    dt_laudo             = COALESCE(EXCLUDED.dt_laudo,           radio_producao.dt_laudo),
                    dt_laudo_liberacao   = COALESCE(EXCLUDED.dt_laudo_liberacao, radio_producao.dt_laudo_liberacao),
                    horas_espera         = EXCLUDED.horas_espera,
                    nm_executor          = COALESCE(EXCLUDED.nm_executor,        radio_producao.nm_executor),
                    nm_laudador          = COALESCE(EXCLUDED.nm_laudador,        radio_producao.nm_laudador),
                    -- uma vez verdadeiro, nunca reverte (histórico preservado)
                    sem_envio_enfermagem = radio_producao.sem_envio_enfermagem OR EXCLUDED.sem_envio_enfermagem,
                    ultima_atualizacao   = NOW()
            """)
            afetados = cursor.rowcount

        cache_delete_pattern('painel47:producao*')
        current_app.logger.info(f'P47 producao sync: {afetados} registros afetados')
        return jsonify({'success': True, 'registros_afetados': afetados,
                        'timestamp': datetime.now().isoformat()})

    except Exception as e:
        current_app.logger.error(f'Erro sync producao p47: {e}', exc_info=True)
        return jsonify({'success': False, 'error': 'Erro ao sincronizar produção'}), 500


# ── Produção: KPIs ───────────────────────────────────────────

@painel47_bp.route('/api/paineis/painel47/producao/kpis')
@login_required
@panel_permission_required('painel47')
def api_p47_producao_kpis():
    """KPIs de produção. ?periodo=hoje|mes|N (N = dias)"""
    try:
        periodo = request.args.get('periodo', 'hoje')
        filtro_dt, params = _filtro_periodo(periodo)

        with get_db_cursor() as cursor:
            cursor.execute(f"""
                SELECT
                    COUNT(*)                                                               AS total_prescritos,
                    COUNT(*) FILTER (WHERE status_radiologia <> 'AGUARDANDO')              AS executados,
                    COUNT(*) FILTER (WHERE status_radiologia = 'LAUDADO')                  AS laudados,
                    COUNT(*) FILTER (WHERE status_radiologia = 'EXECUTADO_SEM_LAUDO')      AS sem_laudo,
                    COUNT(*) FILTER (WHERE sem_envio_enfermagem = TRUE)                    AS sem_envio_enfermagem,
                    ROUND(
                        COUNT(*) FILTER (WHERE status_radiologia = 'LAUDADO')::NUMERIC
                        / NULLIF(COUNT(*) FILTER (WHERE status_radiologia <> 'AGUARDANDO'), 0) * 100
                    , 1)                                                                   AS taxa_laudo_pct,
                    ROUND(AVG(
                        EXTRACT(EPOCH FROM (dt_execucao - dt_pedido)) / 3600
                    ) FILTER (WHERE dt_execucao IS NOT NULL AND dt_pedido IS NOT NULL)::NUMERIC, 1)
                                                                                           AS media_h_presc_exec,
                    ROUND(AVG(
                        EXTRACT(EPOCH FROM (dt_laudo - dt_execucao)) / 3600
                    ) FILTER (WHERE dt_laudo IS NOT NULL AND dt_execucao IS NOT NULL)::NUMERIC, 1)
                                                                                           AS media_h_exec_laudo,
                    MAX(ultima_atualizacao)                                                AS ultima_sync
                FROM radio_producao
                WHERE {filtro_dt}
            """, params)
            row = _serial(dict(cursor.fetchone()))
            row['success'] = True
            row['periodo'] = periodo
            return jsonify(row)

    except Exception as e:
        current_app.logger.error(f'Erro kpis producao p47: {e}', exc_info=True)
        return jsonify({'success': False, 'error': 'Erro ao buscar KPIs'}), 500


# ── Produção: Por setor ──────────────────────────────────────

@painel47_bp.route('/api/paineis/painel47/producao/por-setor')
@login_required
@panel_permission_required('painel47')
def api_p47_producao_por_setor():
    try:
        periodo = request.args.get('periodo', 'hoje')
        filtro_dt, params = _filtro_periodo(periodo)

        with get_db_cursor() as cursor:
            cursor.execute(f"""
                SELECT
                    nm_setor                                                               AS setor,
                    COUNT(*)                                                               AS total,
                    COUNT(*) FILTER (WHERE status_radiologia <> 'AGUARDANDO')              AS executados,
                    COUNT(*) FILTER (WHERE status_radiologia = 'LAUDADO')                  AS laudados,
                    COUNT(*) FILTER (WHERE status_radiologia = 'EXECUTADO_SEM_LAUDO')      AS sem_laudo,
                    ROUND(AVG(
                        EXTRACT(EPOCH FROM (dt_execucao - dt_pedido)) / 3600
                    ) FILTER (WHERE dt_execucao IS NOT NULL AND dt_pedido IS NOT NULL)::NUMERIC, 1)
                                                                                           AS media_h_espera
                FROM radio_producao
                WHERE {filtro_dt}
                GROUP BY nm_setor
                ORDER BY total DESC
                LIMIT 30
            """, params)
            return jsonify({'success': True, 'data': [_serial(dict(r)) for r in cursor.fetchall()]})

    except Exception as e:
        current_app.logger.error(f'Erro setor producao p47: {e}', exc_info=True)
        return jsonify({'success': False, 'error': 'Erro'}), 500


# ── Produção: Por tipo de exame ──────────────────────────────

@painel47_bp.route('/api/paineis/painel47/producao/por-tipo')
@login_required
@panel_permission_required('painel47')
def api_p47_producao_por_tipo():
    try:
        periodo = request.args.get('periodo', 'hoje')
        filtro_dt, params = _filtro_periodo(periodo)

        with get_db_cursor() as cursor:
            cursor.execute(f"""
                SELECT
                    ds_procedimento                                                        AS tipo,
                    COUNT(*)                                                               AS total,
                    COUNT(*) FILTER (WHERE status_radiologia = 'LAUDADO')                  AS laudados,
                    ROUND(AVG(
                        EXTRACT(EPOCH FROM (dt_execucao - dt_pedido)) / 3600
                    ) FILTER (WHERE dt_execucao IS NOT NULL AND dt_pedido IS NOT NULL)::NUMERIC, 1)
                                                                                           AS media_h_espera
                FROM radio_producao
                WHERE {filtro_dt}
                GROUP BY ds_procedimento
                ORDER BY total DESC
                LIMIT 20
            """, params)
            return jsonify({'success': True, 'data': [_serial(dict(r)) for r in cursor.fetchall()]})

    except Exception as e:
        current_app.logger.error(f'Erro tipo producao p47: {e}', exc_info=True)
        return jsonify({'success': False, 'error': 'Erro'}), 500


# ── Produção: Lista de exames ────────────────────────────────

@painel47_bp.route('/api/paineis/painel47/producao/exames')
@login_required
@panel_permission_required('painel47')
def api_p47_producao_exames():
    try:
        periodo = request.args.get('periodo', 'hoje')
        status  = request.args.get('status', '')
        setor   = request.args.get('setor', '')
        limit   = min(int(request.args.get('limit', 200)), 500)

        filtro_dt, params = _filtro_periodo(periodo)
        filtros = [filtro_dt]
        if status:
            filtros.append("status_radiologia = %s")
            params.append(status)
        if setor:
            filtros.append("nm_setor ILIKE %s")
            params.append(f'%{setor}%')
        where = ' AND '.join(filtros)

        with get_db_cursor() as cursor:
            cursor.execute(f"""
                SELECT
                    id, nr_atendimento, nm_pessoa_fisica, ds_procedimento,
                    nm_setor, leito, ds_convenio,
                    ie_urgente, status_radiologia, nm_executor, nm_laudador,
                    sem_envio_enfermagem,
                    dt_pedido, dt_execucao, dt_laudo, dt_laudo_liberacao, horas_espera,
                    ROUND((EXTRACT(EPOCH FROM (dt_execucao - dt_pedido)) / 3600)::NUMERIC, 1)
                        AS h_presc_exec,
                    ROUND((EXTRACT(EPOCH FROM (dt_laudo    - dt_execucao)) / 3600)::NUMERIC, 1)
                        AS h_exec_laudo
                FROM radio_producao
                WHERE {where}
                ORDER BY dt_pedido DESC
                LIMIT %s
            """, params + [limit])
            exames = [_serial(dict(r)) for r in cursor.fetchall()]

            cursor.execute(f"SELECT COUNT(*) AS total FROM radio_producao WHERE {where}", params)
            total = cursor.fetchone()['total']

        return jsonify({'success': True, 'data': exames, 'total': total})

    except Exception as e:
        current_app.logger.error(f'Erro exames producao p47: {e}', exc_info=True)
        return jsonify({'success': False, 'error': 'Erro ao buscar exames'}), 500


# ── Produção: Exportar CSV ───────────────────────────────────

@painel47_bp.route('/api/paineis/painel47/producao/exportar')
@login_required
@panel_permission_required('painel47')
def api_p47_producao_exportar():
    try:
        periodo = request.args.get('periodo', '30')
        status  = request.args.get('status', '')
        setor   = request.args.get('setor', '')

        def _fmt(dt):
            return dt.strftime('%d/%m/%Y %H:%M') if dt else ''

        filtro_dt, params = _filtro_periodo(periodo)
        filtros = [filtro_dt]
        if status:
            filtros.append("status_radiologia = %s")
            params.append(status)
        if setor:
            filtros.append("nm_setor ILIKE %s")
            params.append(f'%{setor}%')
        where = ' AND '.join(filtros)

        with get_db_cursor() as cursor:
            cursor.execute(f"""
                SELECT
                    nr_atendimento, nm_pessoa_fisica, ds_procedimento,
                    nm_setor, leito, ds_convenio, ie_urgente, status_radiologia,
                    nm_executor, nm_laudador,
                    dt_pedido, dt_execucao, dt_laudo, dt_laudo_liberacao, horas_espera
                FROM radio_producao
                WHERE {where}
                ORDER BY dt_pedido DESC
            """, params)
            rows = cursor.fetchall()

        output = io.StringIO()
        output.write('﻿')  # BOM UTF-8
        writer = csv.writer(output, delimiter=';')
        writer.writerow([
            'Atendimento', 'Paciente', 'Exame', 'Setor', 'Leito', 'Convênio',
            'Urgente', 'Status', 'Executor', 'Laudador',
            'Dt Prescrição', 'Dt Execução', 'Dt Laudo', 'Dt Liberação Laudo', 'Horas Espera'
        ])
        for r in rows:
            writer.writerow([
                r['nr_atendimento'], r['nm_pessoa_fisica'], r['ds_procedimento'],
                r['nm_setor'], r['leito'], r['ds_convenio'] or '',
                'Sim' if r['ie_urgente'] == 'S' else 'Não',
                r['status_radiologia'], r['nm_executor'] or '', r['nm_laudador'] or '',
                _fmt(r['dt_pedido']), _fmt(r['dt_execucao']),
                _fmt(r['dt_laudo']), _fmt(r['dt_laudo_liberacao']),
                r['horas_espera'] or ''
            ])

        nome = f'radio_producao_{datetime.now().strftime("%Y%m%d_%H%M")}.csv'
        return Response(
            output.getvalue(),
            mimetype='text/csv; charset=utf-8',
            headers={'Content-Disposition': f'attachment; filename="{nome}"'}
        )

    except Exception as e:
        current_app.logger.error(f'Erro exportar producao p47: {e}', exc_info=True)
        return jsonify({'success': False, 'error': 'Erro ao exportar'}), 500
