"""
Painel 36 - Gestao e Relatorios do Sistema Padioleiro
Endpoints para gestao analitica, relatorios e configuracao do sistema
"""
from flask import Blueprint, jsonify, request, send_from_directory, session, current_app, Response
from datetime import datetime, date
from psycopg2.extras import RealDictCursor
from backend.database import get_db_cursor
from backend.middleware.decorators import login_required, panel_permission_required
import io
import openpyxl
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
from openpyxl.utils import get_column_letter
from openpyxl.chart import BarChart, Reference
from openpyxl.formatting.rule import ColorScaleRule

painel36_bp = Blueprint('painel36', __name__)

# Whitelists de colunas permitidas nos UPDATEs dinâmicos.
# Nunca iterar sobre dados do request — sempre sobre estas constantes.
_CAMPOS_PADIOLEIRO     = ('nome', 'matricula', 'turno')
_CAMPOS_TIPO_MOVIMENTO = ('nome', 'icone', 'cor', 'ordem')
_CAMPOS_DESTINO        = ('nome', 'tipo_movimento_id', 'ordem')
_CAMPOS_ORIGEM         = ('nome', 'ordem')

# ── Helpers Excel (exportação) ────────────────────────────────
_X_HAC      = "9B1C24"
_X_VERDE    = "28A745"
_X_VERMELHO = "DC3545"
_X_LARANJA  = "E67E00"
_X_AZUL     = "17A2B8"
_X_BRANCO   = "FFFFFF"
_X_ZEBRA    = "FEF0F0"
_X_FUNDO_H  = "F5D0D3"
_X_STATUS   = {
    'concluido': _X_VERDE, 'cancelado': _X_VERMELHO,
    'aguardando': _X_HAC,  'aceito': _X_AZUL, 'em_transporte': _X_LARANJA
}

def _x_hdr(cell, cor=_X_HAC):
    cell.font = Font(bold=True, color=_X_BRANCO, size=11)
    cell.fill = PatternFill("solid", fgColor=cor)
    cell.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
    _x_borda(cell)

def _x_borda(cell):
    s = Side(style="thin", color="CCCCCC")
    cell.border = Border(left=s, right=s, top=s, bottom=s)

def _x_autowidth(ws, min_w=10, max_w=45):
    for col in ws.columns:
        letra = get_column_letter(col[0].column)
        w = max((len(str(c.value or '')) for c in col), default=0)
        ws.column_dimensions[letra].width = min(max(w + 3, min_w), max_w)

def _x_titulo(ws, texto, ncols, row=1):
    ws.merge_cells(start_row=row, start_column=1, end_row=row, end_column=ncols)
    c = ws.cell(row=row, column=1, value=texto)
    c.font = Font(bold=True, color=_X_BRANCO, size=13)
    c.fill = PatternFill("solid", fgColor=_X_HAC)
    c.alignment = Alignment(horizontal="center", vertical="center")
    ws.row_dimensions[row].height = 28

def _x_cor_tempo(ws, col_letra, row_ini, row_fim):
    ws.conditional_formatting.add(
        f"{col_letra}{row_ini}:{col_letra}{row_fim}",
        ColorScaleRule(
            start_type='num', start_value=0,  start_color="63BE7B",
            mid_type='num',   mid_value=20,   mid_color="FFEB84",
            end_type='num',   end_value=60,   end_color="F8696B",
        )
    )


def _periodo_where(req):
    """
    Retorna (where_list, params_list) para filtro de período.
    Aceita data_inicio + data_fim (YYYY-MM-DD) ou cai para dias.
    """
    data_inicio = req.args.get('data_inicio', '').strip()
    data_fim    = req.args.get('data_fim', '').strip()
    if data_inicio and data_fim:
        return (
            ["criado_em >= %s::date", "criado_em < (%s::date + INTERVAL '1 day')"],
            [data_inicio, data_fim]
        )
    dias = min(int(req.args.get('dias', 30)), 365)
    return (
        ["criado_em >= NOW() - (%s || ' days')::INTERVAL"],
        [str(dias)]
    )


@painel36_bp.route('/painel/painel36')
@login_required
@panel_permission_required('painel36')
def painel36():
    return send_from_directory('paineis/painel36', 'index.html')


# =========================================================
# API - DASHBOARD (ESTATISTICAS + CHAMADOS ATIVOS)
# =========================================================

@painel36_bp.route('/api/paineis/painel36/dashboard', methods=['GET'])
@login_required
@panel_permission_required('painel36')
def api_painel36_dashboard():
    try:
        with get_db_cursor() as cursor:

            cursor.execute("""
                SELECT
                    COUNT(*) FILTER (WHERE status = 'aguardando')                              AS aguardando,
                    COUNT(*) FILTER (WHERE status = 'aceito')                                  AS aceito,
                    COUNT(*) FILTER (WHERE status = 'em_transporte')                           AS em_transporte,
                    COUNT(*) FILTER (WHERE status = 'concluido'  AND criado_em >= CURRENT_DATE) AS concluidos_hoje,
                    COUNT(*) FILTER (WHERE status = 'cancelado'  AND criado_em >= CURRENT_DATE) AS cancelados_hoje,
                    COUNT(*) FILTER (WHERE criado_em >= CURRENT_DATE)                          AS total_hoje,
                    COUNT(*) FILTER (WHERE prioridade = 'urgente' AND status = 'aguardando')   AS urgentes_aguardando,
                    ROUND(AVG(EXTRACT(EPOCH FROM (dt_conclusao - criado_em)) / 60)
                        FILTER (WHERE status = 'concluido' AND criado_em >= CURRENT_DATE
                                AND dt_conclusao IS NOT NULL
                                AND EXTRACT(EPOCH FROM (dt_conclusao - criado_em)) / 60 <= 300), 1) AS tempo_medio_total_hoje,
                    ROUND(AVG(EXTRACT(EPOCH FROM (dt_aceite - criado_em)) / 60)
                        FILTER (WHERE dt_aceite IS NOT NULL AND criado_em >= CURRENT_DATE
                                AND EXTRACT(EPOCH FROM (dt_aceite - criado_em)) / 60 <= 300), 1)    AS tempo_medio_aceite_hoje,
                    ROUND(AVG(EXTRACT(EPOCH FROM (dt_inicio_transporte - dt_aceite)) / 60)
                        FILTER (WHERE dt_inicio_transporte IS NOT NULL AND dt_aceite IS NOT NULL
                                AND criado_em >= CURRENT_DATE
                                AND EXTRACT(EPOCH FROM (dt_inicio_transporte - dt_aceite)) / 60 <= 300), 1) AS tempo_medio_deslocamento_hoje,
                    ROUND(AVG(EXTRACT(EPOCH FROM (dt_conclusao - dt_inicio_transporte)) / 60)
                        FILTER (WHERE status = 'concluido' AND dt_inicio_transporte IS NOT NULL
                                AND dt_conclusao IS NOT NULL AND criado_em >= CURRENT_DATE
                                AND EXTRACT(EPOCH FROM (dt_conclusao - criado_em)) / 60 <= 300), 1) AS tempo_medio_transporte_hoje
                FROM padioleiro_chamados
            """)
            stats = dict(cursor.fetchone() or {})
            for k, v in stats.items():
                if v is not None and hasattr(v, '__float__'):
                    stats[k] = float(v)

            cursor.execute("""
                SELECT
                    id, tipo_movimento_nome, nm_paciente, nr_atendimento,
                    leito_origem, setor_origem_nome, destino_nome,
                    prioridade, status, solicitante_nome, padioleiro_nome,
                    criado_em, dt_aceite, dt_inicio_transporte,
                    ROUND(EXTRACT(EPOCH FROM (NOW() - criado_em)) / 60, 1) AS minutos_espera
                FROM padioleiro_chamados
                WHERE status IN ('aguardando', 'aceito', 'em_transporte')
                ORDER BY
                    CASE prioridade WHEN 'urgente' THEN 0 ELSE 1 END,
                    criado_em ASC
            """)
            ativos = []
            for row in cursor.fetchall():
                c = dict(row)
                for campo in ['criado_em', 'dt_aceite', 'dt_inicio_transporte']:
                    if c.get(campo) and isinstance(c[campo], datetime):
                        c[campo] = c[campo].isoformat()
                if c.get('minutos_espera') is not None:
                    c['minutos_espera'] = float(c['minutos_espera'])
                ativos.append(c)

            return jsonify({
                'success': True,
                'stats': stats,
                'ativos': ativos,
                'timestamp': datetime.now().isoformat()
            })

    except Exception as e:
        current_app.logger.error(f'Erro dashboard painel36: {e}', exc_info=True)
        return jsonify({'success': False, 'error': 'Erro ao buscar dados'}), 500


# =========================================================
# API - LISTAGEM COM FILTROS
# =========================================================

@painel36_bp.route('/api/paineis/painel36/chamados', methods=['GET'])
@login_required
@panel_permission_required('painel36')
def api_painel36_chamados():
    setor         = request.args.get('setor', '').strip()
    padioleiro_id = request.args.get('padioleiro_id', '').strip()
    tipo_id       = request.args.get('tipo_id', '').strip()
    status        = request.args.get('status', '').strip()
    prioridade    = request.args.get('prioridade', '').strip()

    try:
        with get_db_cursor() as cursor:

            where, params = _periodo_where(request)

            if setor:
                where.append("setor_origem_nome ILIKE %s")
                params.append(f'%{setor}%')
            if padioleiro_id:
                where.append("padioleiro_id = %s")
                params.append(padioleiro_id)
            if tipo_id:
                where.append("tipo_movimento_id = %s")
                params.append(tipo_id)
            if status:
                where.append("status = %s")
                params.append(status)
            if prioridade:
                where.append("prioridade = %s")
                params.append(prioridade)

            cursor.execute("""
                SELECT
                    id, tipo_movimento_nome, nm_paciente, nr_atendimento,
                    leito_origem, setor_origem_nome, destino_nome, destino_complemento,
                    prioridade, status, solicitante_nome, padioleiro_nome, observacao,
                    criado_em, dt_aceite, dt_inicio_transporte, dt_conclusao, dt_cancelamento,
                    motivo_cancelamento,
                    CASE
                        WHEN dt_aceite IS NOT NULL
                        THEN ROUND(EXTRACT(EPOCH FROM (dt_aceite - criado_em)) / 60, 1)
                    END AS tempo_aceite_min,
                    CASE
                        WHEN dt_inicio_transporte IS NOT NULL AND dt_aceite IS NOT NULL
                        THEN ROUND(EXTRACT(EPOCH FROM (dt_inicio_transporte - dt_aceite)) / 60, 1)
                    END AS tempo_deslocamento_min,
                    CASE
                        WHEN dt_conclusao IS NOT NULL AND dt_inicio_transporte IS NOT NULL
                        THEN ROUND(EXTRACT(EPOCH FROM (dt_conclusao - dt_inicio_transporte)) / 60, 1)
                    END AS tempo_transporte_min,
                    CASE
                        WHEN dt_conclusao IS NOT NULL
                        THEN ROUND(EXTRACT(EPOCH FROM (dt_conclusao - criado_em)) / 60, 1)
                    END AS tempo_total_min
                FROM padioleiro_chamados
                WHERE """ + ' AND '.join(where) + """
                ORDER BY criado_em DESC
                LIMIT 500
            """, params)

            chamados = []
            for row in cursor.fetchall():
                c = dict(row)
                for campo in ['criado_em', 'dt_aceite', 'dt_inicio_transporte',
                              'dt_conclusao', 'dt_cancelamento']:
                    if c.get(campo) and isinstance(c[campo], datetime):
                        c[campo] = c[campo].isoformat()
                for campo in ['tempo_aceite_min', 'tempo_deslocamento_min',
                              'tempo_transporte_min', 'tempo_total_min']:
                    if c.get(campo) is not None:
                        c[campo] = float(c[campo])
                chamados.append(c)

            return jsonify({'success': True, 'chamados': chamados, 'total': len(chamados)})

    except Exception as e:
        current_app.logger.error(f'Erro chamados painel36: {e}', exc_info=True)
        return jsonify({'success': False, 'error': 'Erro ao buscar chamados'}), 500


# =========================================================
# API - CANCELAR CHAMADO (Gestão)
# =========================================================

@painel36_bp.route('/api/paineis/painel36/chamados/<int:chamado_id>/cancelar', methods=['PUT'])
@login_required
@panel_permission_required('painel36')
def api_painel36_cancelar(chamado_id):
    usuario_id = session.get('usuario_id')
    is_admin = session.get('is_admin', False)
    dados = request.get_json() or {}
    motivo = (dados.get('motivo') or '').strip()

    if len(motivo) < 10:
        return jsonify({'success': False, 'error': 'O motivo do cancelamento deve ter pelo menos 10 caracteres'}), 400

    try:
        with get_db_cursor() as cursor:
        
            cursor.execute("SELECT status FROM padioleiro_chamados WHERE id = %s", (chamado_id,))
            chamado = cursor.fetchone()
        
            if not chamado:
                return jsonify({'success': False, 'error': 'Chamado nao encontrado'}), 404

            if chamado['status'] in ('concluido', 'cancelado'):
                return jsonify({'success': False, 'error': f'Chamado nao pode ser cancelado no status atual: {chamado["status"]}'}), 400

            cursor.execute("""
                UPDATE padioleiro_chamados
                SET status = 'cancelado',
                    dt_cancelamento = NOW(),
                    motivo_cancelamento = %s,
                    atualizado_em = NOW()
                WHERE id = %s
            """, (f"[Cancelado pela Gestão] {motivo}", chamado_id))

            return jsonify({'success': True, 'message': 'Chamado cancelado administrativamente com sucesso'})

    except Exception as e:
        current_app.logger.error(f'Erro cancelar painel36: {e}', exc_info=True)
        return jsonify({'success': False, 'error': 'Erro ao cancelar chamado'}), 500


# =========================================================
# API - ANALYTICS POR SETOR
# =========================================================

@painel36_bp.route('/api/paineis/painel36/por-setor', methods=['GET'])
@login_required
@panel_permission_required('painel36')
def api_painel36_por_setor():
    try:
        with get_db_cursor() as cursor:
            where, params = _periodo_where(request)
            cursor.execute("""
                SELECT
                    setor_origem_nome                                                           AS setor,
                    COUNT(*)                                                                    AS total,
                    COUNT(*) FILTER (WHERE status = 'concluido')                               AS concluidos,
                    COUNT(*) FILTER (WHERE status = 'cancelado')                               AS cancelados,
                    COUNT(*) FILTER (WHERE prioridade = 'urgente')                             AS urgentes,
                    ROUND(AVG(EXTRACT(EPOCH FROM (dt_aceite - criado_em)) / 60)
                        FILTER (WHERE dt_aceite IS NOT NULL), 1)                               AS tempo_medio_aceite_min,
                    ROUND(AVG(EXTRACT(EPOCH FROM (dt_inicio_transporte - dt_aceite)) / 60)
                        FILTER (WHERE dt_inicio_transporte IS NOT NULL AND dt_aceite IS NOT NULL), 1) AS tempo_medio_deslocamento_min,
                    ROUND(AVG(EXTRACT(EPOCH FROM (dt_conclusao - criado_em)) / 60)
                        FILTER (WHERE status = 'concluido' AND dt_conclusao IS NOT NULL), 1)   AS tempo_medio_total_min
                FROM padioleiro_chamados
                WHERE """ + ' AND '.join(where) + """
                GROUP BY setor_origem_nome
                ORDER BY total DESC
            """, params)
            setores = []
            for row in cursor.fetchall():
                s = dict(row)
                for k in ['tempo_medio_aceite_min', 'tempo_medio_deslocamento_min', 'tempo_medio_total_min']:
                    if s.get(k) is not None:
                        s[k] = float(s[k])
                setores.append(s)
            return jsonify({'success': True, 'setores': setores})

    except Exception as e:
        current_app.logger.error(f'Erro por-setor painel36: {e}', exc_info=True)
        return jsonify({'success': False, 'error': 'Erro ao buscar dados'}), 500


# =========================================================
# API - ANALYTICS POR PADIOLEIRO
# =========================================================

@painel36_bp.route('/api/paineis/painel36/por-padioleiro', methods=['GET'])
@login_required
@panel_permission_required('painel36')
def api_painel36_por_padioleiro():
    try:
        with get_db_cursor() as cursor:
            where, params = _periodo_where(request)
            where.append("padioleiro_nome IS NOT NULL")
            cursor.execute("""
                SELECT
                    padioleiro_nome                                                             AS padioleiro,
                    COUNT(*)                                                                    AS total,
                    COUNT(*) FILTER (WHERE status = 'concluido')                               AS concluidos,
                    COUNT(*) FILTER (WHERE status = 'cancelado')                               AS cancelados,
                    COUNT(*) FILTER (WHERE prioridade = 'urgente')                             AS urgentes,
                    ROUND(AVG(EXTRACT(EPOCH FROM (dt_aceite - criado_em)) / 60)
                        FILTER (WHERE dt_aceite IS NOT NULL), 1)                               AS tempo_medio_aceite_min,
                    ROUND(AVG(EXTRACT(EPOCH FROM (dt_inicio_transporte - dt_aceite)) / 60)
                        FILTER (WHERE dt_inicio_transporte IS NOT NULL AND dt_aceite IS NOT NULL), 1) AS tempo_medio_deslocamento_min,
                    ROUND(AVG(EXTRACT(EPOCH FROM (dt_conclusao - dt_inicio_transporte)) / 60)
                        FILTER (WHERE status = 'concluido' AND dt_conclusao IS NOT NULL
                                AND dt_inicio_transporte IS NOT NULL), 1)                      AS tempo_medio_transporte_min,
                    ROUND(AVG(EXTRACT(EPOCH FROM (dt_conclusao - criado_em)) / 60)
                        FILTER (WHERE status = 'concluido' AND dt_conclusao IS NOT NULL), 1)   AS tempo_medio_total_min
                FROM padioleiro_chamados
                WHERE """ + ' AND '.join(where) + """
                GROUP BY padioleiro_nome
                ORDER BY concluidos DESC
            """, params)
            padioleiros = []
            for row in cursor.fetchall():
                p = dict(row)
                for k in ['tempo_medio_aceite_min', 'tempo_medio_deslocamento_min',
                          'tempo_medio_transporte_min', 'tempo_medio_total_min']:
                    if p.get(k) is not None:
                        p[k] = float(p[k])
                padioleiros.append(p)
            return jsonify({'success': True, 'padioleiros': padioleiros})

    except Exception as e:
        current_app.logger.error(f'Erro por-padioleiro painel36: {e}', exc_info=True)
        return jsonify({'success': False, 'error': 'Erro ao buscar dados'}), 500


# =========================================================
# API - EXPORTAR CSV
# =========================================================

@painel36_bp.route('/api/paineis/painel36/exportar', methods=['GET'])
@login_required
@panel_permission_required('painel36')
def api_painel36_exportar():
    status     = request.args.get('status', '').strip()
    prioridade = request.args.get('prioridade', '').strip()
    setor      = request.args.get('setor', '').strip()
    data_inicio = request.args.get('data_inicio', '').strip()
    data_fim    = request.args.get('data_fim', '').strip()

    try:
        with get_db_cursor() as cursor:
            where, params = _periodo_where(request)
            if status:
                where.append("status = %s"); params.append(status)
            if prioridade:
                where.append("prioridade = %s"); params.append(prioridade)
            if setor:
                where.append("setor_origem_nome ILIKE %s"); params.append(f'%{setor}%')
            where_sql = ' AND '.join(where)

            # ── Chamados detalhados ──────────────────────────────
            cursor.execute(f"""
                SELECT
                    id, tipo_movimento_nome, nm_paciente, nr_atendimento,
                    leito_origem, setor_origem_nome, destino_nome, destino_complemento,
                    prioridade, status, solicitante_nome, padioleiro_nome, observacao,
                    TO_CHAR(criado_em,            'DD/MM/YYYY HH24:MI') AS criado_em,
                    TO_CHAR(dt_aceite,            'DD/MM/YYYY HH24:MI') AS dt_aceite,
                    TO_CHAR(dt_inicio_transporte, 'DD/MM/YYYY HH24:MI') AS dt_inicio_transporte,
                    TO_CHAR(dt_conclusao,         'DD/MM/YYYY HH24:MI') AS dt_conclusao,
                    TO_CHAR(dt_cancelamento,      'DD/MM/YYYY HH24:MI') AS dt_cancelamento,
                    motivo_cancelamento,
                    CASE WHEN dt_aceite IS NOT NULL
                         THEN ROUND(EXTRACT(EPOCH FROM (dt_aceite - criado_em)) / 60, 1) END AS t_aceite_min,
                    CASE WHEN dt_inicio_transporte IS NOT NULL AND dt_aceite IS NOT NULL
                         THEN ROUND(EXTRACT(EPOCH FROM (dt_inicio_transporte - dt_aceite)) / 60, 1) END AS t_deslocamento_min,
                    CASE WHEN dt_conclusao IS NOT NULL AND dt_inicio_transporte IS NOT NULL
                         THEN ROUND(EXTRACT(EPOCH FROM (dt_conclusao - dt_inicio_transporte)) / 60, 1) END AS t_transporte_min,
                    CASE WHEN dt_conclusao IS NOT NULL
                         THEN ROUND(EXTRACT(EPOCH FROM (dt_conclusao - criado_em)) / 60, 1)
                         WHEN status = 'cancelado' AND dt_cancelamento IS NOT NULL
                         THEN ROUND(EXTRACT(EPOCH FROM (dt_cancelamento - criado_em)) / 60, 1)
                    END AS t_total_min
                FROM padioleiro_chamados
                WHERE {where_sql}
                ORDER BY criado_em DESC
            """, params)
            chamados = [dict(r) for r in cursor.fetchall()]

            # ── Por padioleiro ───────────────────────────────────
            cursor.execute(f"""
                SELECT
                    COALESCE(padioleiro_nome,'(não atribuído)') AS padioleiro,
                    COUNT(*) AS total,
                    COUNT(*) FILTER (WHERE status='concluido')   AS concluidos,
                    COUNT(*) FILTER (WHERE status='cancelado')   AS cancelados,
                    COUNT(*) FILTER (WHERE prioridade='urgente') AS urgentes,
                    ROUND(AVG(CASE WHEN dt_aceite IS NOT NULL
                        THEN EXTRACT(EPOCH FROM (dt_aceite - criado_em))/60 END)::numeric,1) AS media_aceite_min,
                    ROUND(AVG(CASE WHEN dt_inicio_transporte IS NOT NULL AND dt_aceite IS NOT NULL
                        THEN EXTRACT(EPOCH FROM (dt_inicio_transporte - dt_aceite))/60 END)::numeric,1) AS media_deslocamento_min,
                    ROUND(AVG(CASE WHEN dt_conclusao IS NOT NULL AND dt_inicio_transporte IS NOT NULL
                        THEN EXTRACT(EPOCH FROM (dt_conclusao - dt_inicio_transporte))/60 END)::numeric,1) AS media_transporte_min,
                    ROUND(AVG(CASE WHEN dt_conclusao IS NOT NULL
                        THEN EXTRACT(EPOCH FROM (dt_conclusao - criado_em))/60 END)::numeric,1) AS media_total_min
                FROM padioleiro_chamados
                WHERE {where_sql}
                GROUP BY padioleiro_nome ORDER BY total DESC
            """, params)
            por_padioleiro = [dict(r) for r in cursor.fetchall()]

            # ── Por setor ────────────────────────────────────────
            cursor.execute(f"""
                SELECT
                    COALESCE(setor_origem_nome,'(sem setor)') AS setor,
                    COUNT(*) AS total,
                    COUNT(*) FILTER (WHERE status='concluido')   AS concluidos,
                    COUNT(*) FILTER (WHERE status='cancelado')   AS cancelados,
                    COUNT(*) FILTER (WHERE prioridade='urgente') AS urgentes
                FROM padioleiro_chamados
                WHERE {where_sql}
                GROUP BY setor_origem_nome ORDER BY total DESC LIMIT 30
            """, params)
            por_setor = [dict(r) for r in cursor.fetchall()]

        # ── Gerar Excel ──────────────────────────────────────────
        now = datetime.now()
        if data_inicio and data_fim:
            di = datetime.strptime(data_inicio, '%Y-%m-%d').strftime('%d/%m/%Y')
            df = datetime.strptime(data_fim,    '%Y-%m-%d').strftime('%d/%m/%Y')
            filtros_txt = f"Período: {di} a {df}"
        else:
            dias = int(request.args.get('dias', 30))
            filtros_txt = f"Últimos {dias} dia(s)"
        if status:     filtros_txt += f"  |  Status: {status}"
        if prioridade: filtros_txt += f"  |  Prioridade: {prioridade}"
        if setor:      filtros_txt += f"  |  Setor: {setor}"

        wb = openpyxl.Workbook()
        wb.remove(wb.active)

        # ── Aba 1: Chamados ──────────────────────────────────────
        ws1 = wb.create_sheet("Chamados")
        ws1.sheet_view.showGridLines = False
        ws1.freeze_panes = "A3"

        _x_titulo(ws1, f"CHAMADOS PADIOLEIRO — HAC — {now.strftime('%d/%m/%Y %H:%M')}  |  {filtros_txt}", 22)

        hdrs = [
            "#", "Tipo Movimento", "Paciente", "Atendimento", "Leito Origem",
            "Setor Origem", "Destino", "Compl. Destino", "Prioridade", "Status",
            "Solicitante", "Padioleiro", "Observação",
            "Criado Em", "Aceito Em", "Ini. Transporte", "Conclusão", "Cancelado Em",
            "Motivo Cancelamento", "T.Aceite(min)", "T.Desloc.(min)", "T.Transp.(min)"
        ]
        # Adiciona T.Total apenas se a versão 22 cols ficar pequena demais — inclui direto
        hdrs.append("T.Total(min)")

        for j, h in enumerate(hdrs, 1):
            _x_hdr(ws1.cell(row=2, column=j, value=h))
        ws1.row_dimensions[2].height = 22

        keys = [
            'id','tipo_movimento_nome','nm_paciente','nr_atendimento','leito_origem',
            'setor_origem_nome','destino_nome','destino_complemento',
            'prioridade','status','solicitante_nome','padioleiro_nome','observacao',
            'criado_em','dt_aceite','dt_inicio_transporte','dt_conclusao','dt_cancelamento',
            'motivo_cancelamento','t_aceite_min','t_deslocamento_min','t_transporte_min','t_total_min'
        ]
        for i, row in enumerate(chamados, 3):
            zebra = i % 2 == 0
            for j, key in enumerate(keys, 1):
                v = row.get(key)
                cell = ws1.cell(row=i, column=j, value=v)
                _x_borda(cell)
                cell.alignment = Alignment(vertical="center", wrap_text=(j in (13, 19)))
                if zebra and key not in ('prioridade', 'status'):
                    cell.fill = PatternFill("solid", fgColor=_X_ZEBRA)
                if key == 'status' and v in _X_STATUS:
                    cell.font = Font(bold=True, color=_X_BRANCO)
                    cell.fill = PatternFill("solid", fgColor=_X_STATUS[v])
                elif key == 'prioridade' and v == 'urgente':
                    cell.font = Font(bold=True, color=_X_BRANCO)
                    cell.fill = PatternFill("solid", fgColor=_X_LARANJA)

        last_row = 2 + len(chamados)
        if chamados:
            # Formatação condicional nos tempos (colunas 20-23)
            for col_n in range(20, 24):
                _x_cor_tempo(ws1, get_column_letter(col_n), 3, last_row)

        _x_autowidth(ws1)

        # ── Aba 2: Por Padioleiro ────────────────────────────────
        ws2 = wb.create_sheet("Por Padioleiro")
        ws2.sheet_view.showGridLines = False

        hv = ["Padioleiro", "Total", "Concluídos", "Cancelados", "Urgentes",
              "T.Aceite(min)", "T.Desloc.(min)", "T.Transp.(min)", "T.Total(min)"]
        _x_titulo(ws2, f"POR PADIOLEIRO — {filtros_txt}", len(hv))
        for j, h in enumerate(hv, 1):
            _x_hdr(ws2.cell(row=2, column=j, value=h))

        pad_keys_cor = [
            ('padioleiro', None), ('total', None), ('concluidos', _X_VERDE),
            ('cancelados', _X_VERMELHO), ('urgentes', _X_LARANJA),
            ('media_aceite_min', None), ('media_deslocamento_min', None),
            ('media_transporte_min', None), ('media_total_min', None),
        ]
        for i, p in enumerate(por_padioleiro, 3):
            zebra = i % 2 == 0
            for j, (key, cor_txt) in enumerate(pad_keys_cor, 1):
                v = p.get(key)
                cell = ws2.cell(row=i, column=j, value=float(v) if v is not None and j > 5 else v)
                _x_borda(cell)
                if zebra: cell.fill = PatternFill("solid", fgColor=_X_ZEBRA)
                if j == 1: cell.font = Font(bold=True)
                elif cor_txt: cell.font = Font(bold=True, color=cor_txt)

        last_pad = 2 + len(por_padioleiro)
        if por_padioleiro:
            for col_l in ['F', 'G', 'H', 'I']:
                _x_cor_tempo(ws2, col_l, 3, last_pad)
            c = BarChart()
            c.type = "bar"; c.grouping = "clustered"
            c.title = "Movimentos por Padioleiro"
            c.style = 10; c.height = 12; c.width = 22
            c.x_axis.title = "Quantidade"
            c.add_data(Reference(ws2, min_col=2, max_col=5, min_row=2, max_row=last_pad), titles_from_data=True)
            c.set_categories(Reference(ws2, min_col=1, min_row=3, max_row=last_pad))
            for idx, cor in enumerate([_X_HAC, _X_VERDE, _X_VERMELHO, _X_LARANJA]):
                if idx < len(c.series):
                    c.series[idx].graphicalProperties.solidFill = cor
            ws2.add_chart(c, f"A{last_pad + 3}")

        _x_autowidth(ws2)

        # ── Aba 3: Por Setor ─────────────────────────────────────
        ws3 = wb.create_sheet("Por Setor")
        ws3.sheet_view.showGridLines = False

        hs = ["Setor", "Total", "Concluídos", "Cancelados", "Urgentes"]
        _x_titulo(ws3, f"POR SETOR — {filtros_txt}", len(hs))
        for j, h in enumerate(hs, 1):
            _x_hdr(ws3.cell(row=2, column=j, value=h))

        for i, s in enumerate(por_setor, 3):
            zebra = i % 2 == 0
            for j, (key, cor_txt) in enumerate([
                ('setor', None), ('total', None), ('concluidos', _X_VERDE),
                ('cancelados', _X_VERMELHO), ('urgentes', _X_LARANJA)
            ], 1):
                cell = ws3.cell(row=i, column=j, value=s.get(key))
                _x_borda(cell)
                if zebra: cell.fill = PatternFill("solid", fgColor=_X_ZEBRA)
                if j == 1: cell.font = Font(bold=True)
                elif cor_txt: cell.font = Font(bold=True, color=cor_txt)

        last_set = 2 + len(por_setor)
        if por_setor:
            c2 = BarChart()
            c2.type = "bar"; c2.grouping = "clustered"
            c2.title = "Chamados por Setor"
            c2.style = 10; c2.height = max(12, len(por_setor) * 0.9); c2.width = 22
            c2.x_axis.title = "Quantidade"
            c2.add_data(Reference(ws3, min_col=2, max_col=5, min_row=2, max_row=last_set), titles_from_data=True)
            c2.set_categories(Reference(ws3, min_col=1, min_row=3, max_row=last_set))
            for idx, cor in enumerate([_X_HAC, _X_VERDE, _X_VERMELHO, _X_LARANJA]):
                if idx < len(c2.series):
                    c2.series[idx].graphicalProperties.solidFill = cor
            ws3.add_chart(c2, f"A{last_set + 3}")

        _x_autowidth(ws3)

        # ── Retornar arquivo ─────────────────────────────────────
        buf = io.BytesIO()
        wb.save(buf)
        buf.seek(0)

        nome_arquivo = f'chamados_padioleiro_{date.today().strftime("%Y%m%d")}.xlsx'
        return Response(
            buf.getvalue(),
            mimetype='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            headers={'Content-Disposition': f'attachment; filename={nome_arquivo}'}
        )

    except Exception as e:
        current_app.logger.error(f'Erro exportar painel36: {e}', exc_info=True)
        return jsonify({'success': False, 'error': 'Erro ao exportar'}), 500


# =========================================================
# CONFIG: PADIOLEIROS
# =========================================================

@painel36_bp.route('/api/paineis/painel36/config/padioleiros', methods=['GET'])
@login_required
@panel_permission_required('painel36')
def api_painel36_cfg_pad_listar():
    try:
        with get_db_cursor() as cursor:
            cursor.execute("""
                SELECT id, nome, matricula, turno, ativo,
                       TO_CHAR(criado_em, 'DD/MM/YYYY') AS criado_em
                FROM padioleiro_cadastros
                ORDER BY nome
            """)
            padioleiros = [dict(r) for r in cursor.fetchall()]
            return jsonify({'success': True, 'padioleiros': padioleiros})
    except Exception as e:
        current_app.logger.error(f'Erro listar padioleiros painel36: {e}', exc_info=True)
        return jsonify({'success': False, 'error': 'Erro ao buscar padioleiros'}), 500


@painel36_bp.route('/api/paineis/painel36/config/padioleiros', methods=['POST'])
@login_required
@panel_permission_required('painel36')
def api_painel36_cfg_pad_criar():
    usuario_id = session.get('usuario_id')
    is_admin = session.get('is_admin', False)
    dados = request.get_json() or {}
    nome = (dados.get('nome') or '').strip()
    if not nome:
        return jsonify({'success': False, 'error': 'Nome e obrigatorio'}), 400

    matricula = (dados.get('matricula') or '').strip() or None
    turno = dados.get('turno', 'todos')

    try:
        with get_db_cursor() as cursor:
            cursor.execute("""
                INSERT INTO padioleiro_cadastros (nome, matricula, turno, ativo, criado_em)
                VALUES (%s, %s, %s, TRUE, NOW())
                RETURNING id
            """, (nome, matricula, turno))
            row = cursor.fetchone()
            return jsonify({'success': True, 'id': row['id'], 'message': 'Padioleiro cadastrado'}), 201
    except Exception as e:
        current_app.logger.error(f'Erro criar padioleiro painel36: {e}', exc_info=True)
        return jsonify({'success': False, 'error': 'Erro ao cadastrar padioleiro'}), 500


@painel36_bp.route('/api/paineis/painel36/config/padioleiros/<int:padioleiro_id>', methods=['PUT'])
@login_required
@panel_permission_required('painel36')
def api_painel36_cfg_pad_atualizar(padioleiro_id):
    usuario_id = session.get('usuario_id')
    is_admin = session.get('is_admin', False)
    dados = request.get_json() or {}
    try:
        with get_db_cursor(use_dict_cursor=False) as cursor:
            fields, params = [], []

            for campo in _CAMPOS_PADIOLEIRO:
                if campo in dados:
                    val = (dados[campo] or '').strip() if isinstance(dados[campo], str) else dados[campo]
                    if campo == 'nome' and not val:
                        return jsonify({'success': False, 'error': 'Nome nao pode ser vazio'}), 400
                    fields.append(f'{campo} = %s')
                    params.append(val or None)
            if 'ativo' in dados:
                fields.append('ativo = %s')
                params.append(bool(dados['ativo']))

            if not fields:
                return jsonify({'success': False, 'error': 'Nada para atualizar'}), 400

            fields.append('atualizado_em = NOW()')
            params.append(padioleiro_id)
            cursor.execute(f"UPDATE padioleiro_cadastros SET {', '.join(fields)} WHERE id = %s", params)
            return jsonify({'success': True, 'message': 'Padioleiro atualizado'})
    except Exception as e:
        current_app.logger.error(f'Erro atualizar padioleiro painel36: {e}', exc_info=True)
        return jsonify({'success': False, 'error': 'Erro ao atualizar padioleiro'}), 500


# =========================================================
# CONFIG: TIPOS DE MOVIMENTO
# =========================================================

@painel36_bp.route('/api/paineis/painel36/config/tipos-movimento', methods=['GET'])
@login_required
@panel_permission_required('painel36')
def api_painel36_cfg_tipos_listar():
    try:
        with get_db_cursor() as cursor:
            cursor.execute("SELECT id, nome, icone, cor, ativo, ordem FROM padioleiro_tipos_movimento ORDER BY ordem, nome")
            tipos = [dict(r) for r in cursor.fetchall()]
            return jsonify({'success': True, 'tipos': tipos})
    except Exception as e:
        current_app.logger.error(f'Erro listar tipos painel36: {e}', exc_info=True)
        return jsonify({'success': False, 'error': 'Erro ao buscar tipos'}), 500


@painel36_bp.route('/api/paineis/painel36/config/tipos-movimento', methods=['POST'])
@login_required
@panel_permission_required('painel36')
def api_painel36_cfg_tipos_criar():
    usuario_id = session.get('usuario_id')
    is_admin = session.get('is_admin', False)
    dados = request.get_json() or {}
    nome = (dados.get('nome') or '').strip()
    if not nome:
        return jsonify({'success': False, 'error': 'Nome e obrigatorio'}), 400

    try:
        with get_db_cursor() as cursor:
            cursor.execute("""
                INSERT INTO padioleiro_tipos_movimento (nome, icone, cor, ativo, ordem)
                VALUES (%s, %s, %s, TRUE, %s) RETURNING id
            """, (nome, dados.get('icone', 'fa-ambulance'), dados.get('cor', '#dc3545'), dados.get('ordem', 0)))
            row = cursor.fetchone()
            return jsonify({'success': True, 'id': row['id']}), 201
    except Exception as e:
        current_app.logger.error(f'Erro criar tipo painel36: {e}', exc_info=True)
        return jsonify({'success': False, 'error': 'Erro ao criar tipo'}), 500


@painel36_bp.route('/api/paineis/painel36/config/tipos-movimento/<int:tipo_id>', methods=['PUT'])
@login_required
@panel_permission_required('painel36')
def api_painel36_cfg_tipos_atualizar(tipo_id):
    usuario_id = session.get('usuario_id')
    is_admin = session.get('is_admin', False)
    dados = request.get_json() or {}
    try:
        with get_db_cursor(use_dict_cursor=False) as cursor:
            fields, params = [], []
            for campo in _CAMPOS_TIPO_MOVIMENTO:
                if campo in dados:
                    fields.append(f'{campo} = %s')
                    params.append(dados[campo])
            if 'ativo' in dados:
                fields.append('ativo = %s')
                params.append(bool(dados['ativo']))

            if not fields:
                return jsonify({'success': False, 'error': 'Nada para atualizar'}), 400

            params.append(tipo_id)
            cursor.execute(f"UPDATE padioleiro_tipos_movimento SET {', '.join(fields)} WHERE id = %s", params)
            return jsonify({'success': True, 'message': 'Tipo atualizado'})
    except Exception as e:
        current_app.logger.error(f'Erro atualizar tipo painel36: {e}', exc_info=True)
        return jsonify({'success': False, 'error': 'Erro ao atualizar tipo'}), 500


# =========================================================
# CONFIG: DESTINOS
# =========================================================

@painel36_bp.route('/api/paineis/painel36/config/destinos', methods=['GET'])
@login_required
@panel_permission_required('painel36')
def api_painel36_cfg_dest_listar():
    usuario_id = session.get('usuario_id')
    is_admin = session.get('is_admin', False)
    tipo_id = request.args.get('tipo_id', '').strip()
    try:
        with get_db_cursor() as cursor:
            if tipo_id:
                cursor.execute("""
                    SELECT d.id, d.nome, d.tipo_movimento_id, t.nome AS tipo_nome, d.ativo, d.ordem
                    FROM padioleiro_destinos d
                    JOIN padioleiro_tipos_movimento t ON t.id = d.tipo_movimento_id
                    WHERE d.tipo_movimento_id = %s
                    ORDER BY d.ordem, d.nome
                """, (tipo_id,))
            else:
                cursor.execute("""
                    SELECT d.id, d.nome, d.tipo_movimento_id, t.nome AS tipo_nome, d.ativo, d.ordem
                    FROM padioleiro_destinos d
                    JOIN padioleiro_tipos_movimento t ON t.id = d.tipo_movimento_id
                    ORDER BY t.ordem, d.ordem, d.nome
                """)
            destinos = [dict(r) for r in cursor.fetchall()]
            return jsonify({'success': True, 'destinos': destinos})
    except Exception as e:
        current_app.logger.error(f'Erro listar destinos painel36: {e}', exc_info=True)
        return jsonify({'success': False, 'error': 'Erro ao buscar destinos'}), 500


@painel36_bp.route('/api/paineis/painel36/config/destinos', methods=['POST'])
@login_required
@panel_permission_required('painel36')
def api_painel36_cfg_dest_criar():
    usuario_id = session.get('usuario_id')
    is_admin = session.get('is_admin', False)
    dados = request.get_json() or {}
    nome = (dados.get('nome') or '').strip()
    tipo_movimento_id = dados.get('tipo_movimento_id')

    if not nome or not tipo_movimento_id:
        return jsonify({'success': False, 'error': 'Nome e tipo de movimento sao obrigatorios'}), 400

    try:
        with get_db_cursor() as cursor:
            cursor.execute("""
                INSERT INTO padioleiro_destinos (nome, tipo_movimento_id, ativo, ordem)
                VALUES (%s, %s, TRUE, %s) RETURNING id
            """, (nome, tipo_movimento_id, dados.get('ordem', 0)))
            row = cursor.fetchone()
            return jsonify({'success': True, 'id': row['id']}), 201
    except Exception as e:
        current_app.logger.error(f'Erro criar destino painel36: {e}', exc_info=True)
        return jsonify({'success': False, 'error': 'Erro ao criar destino'}), 500


@painel36_bp.route('/api/paineis/painel36/config/destinos/<int:destino_id>', methods=['PUT'])
@login_required
@panel_permission_required('painel36')
def api_painel36_cfg_dest_atualizar(destino_id):
    usuario_id = session.get('usuario_id')
    is_admin = session.get('is_admin', False)
    dados = request.get_json() or {}
    try:
        with get_db_cursor(use_dict_cursor=False) as cursor:
            fields, params = [], []
            for campo in _CAMPOS_DESTINO:
                if campo in dados:
                    fields.append(f'{campo} = %s')
                    params.append(dados[campo])
            if 'ativo' in dados:
                fields.append('ativo = %s')
                params.append(bool(dados['ativo']))

            if not fields:
                return jsonify({'success': False, 'error': 'Nada para atualizar'}), 400

            params.append(destino_id)
            cursor.execute(f"UPDATE padioleiro_destinos SET {', '.join(fields)} WHERE id = %s", params)
            return jsonify({'success': True, 'message': 'Destino atualizado'})
    except Exception as e:
        current_app.logger.error(f'Erro atualizar destino painel36: {e}', exc_info=True)
        return jsonify({'success': False, 'error': 'Erro ao atualizar destino'}), 500


# =========================================================
# CONFIG: ORIGENS
# =========================================================

@painel36_bp.route('/api/paineis/painel36/config/origens', methods=['GET'])
@login_required
@panel_permission_required('painel36')
def api_painel36_cfg_orig_listar():
    try:
        with get_db_cursor() as cursor:
            cursor.execute("SELECT id, nome, ativo, ordem FROM padioleiro_origens ORDER BY ordem, nome")
            origens = [dict(r) for r in cursor.fetchall()]
            return jsonify({'success': True, 'origens': origens})
    except Exception as e:
        current_app.logger.error(f'Erro listar origens painel36: {e}', exc_info=True)
        return jsonify({'success': False, 'error': 'Erro ao buscar origens'}), 500


@painel36_bp.route('/api/paineis/painel36/config/origens', methods=['POST'])
@login_required
@panel_permission_required('painel36')
def api_painel36_cfg_orig_criar():
    dados = request.get_json() or {}
    nome = (dados.get('nome') or '').strip()
    if not nome:
        return jsonify({'success': False, 'error': 'Nome e obrigatorio'}), 400

    try:
        with get_db_cursor() as cursor:
            cursor.execute("""
                INSERT INTO padioleiro_origens (nome, ativo, ordem)
                VALUES (%s, TRUE, %s) RETURNING id
            """, (nome, dados.get('ordem', 0)))
            row = cursor.fetchone()
            return jsonify({'success': True, 'id': row['id']}), 201
    except Exception as e:
        current_app.logger.error(f'Erro criar origem painel36: {e}', exc_info=True)
        return jsonify({'success': False, 'error': 'Erro ao criar origem'}), 500


@painel36_bp.route('/api/paineis/painel36/config/origens/<int:origem_id>', methods=['PUT'])
@login_required
@panel_permission_required('painel36')
def api_painel36_cfg_orig_atualizar(origem_id):
    dados = request.get_json() or {}
    try:
        with get_db_cursor(use_dict_cursor=False) as cursor:
            fields, params = [], []
            for campo in _CAMPOS_ORIGEM:
                if campo in dados:
                    val = (dados[campo] or '').strip() if isinstance(dados[campo], str) else dados[campo]
                    if campo == 'nome' and not val:
                        return jsonify({'success': False, 'error': 'Nome nao pode ser vazio'}), 400
                    fields.append(f'{campo} = %s')
                    params.append(val)
            if 'ativo' in dados:
                fields.append('ativo = %s')
                params.append(bool(dados['ativo']))

            if not fields:
                return jsonify({'success': False, 'error': 'Nada para atualizar'}), 400

            params.append(origem_id)
            cursor.execute(f"UPDATE padioleiro_origens SET {', '.join(fields)} WHERE id = %s", params)
            return jsonify({'success': True, 'message': 'Origem atualizada'})
    except Exception as e:
        current_app.logger.error(f'Erro atualizar origem painel36: {e}', exc_info=True)
        return jsonify({'success': False, 'error': 'Erro ao atualizar origem'}), 500
