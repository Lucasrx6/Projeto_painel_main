"""
Painel 36 - Gestao e Relatorios do Sistema Padioleiro
Endpoints para gestao analitica, relatorios e configuracao do sistema
"""
from flask import Blueprint, jsonify, request, send_from_directory, session, current_app, Response
from datetime import datetime, date
from psycopg2.extras import RealDictCursor
from backend.database import get_db_cursor
from backend.middleware.decorators import login_required, panel_permission_required
import csv
import io

painel36_bp = Blueprint('painel36', __name__)

# Whitelists de colunas permitidas nos UPDATEs dinâmicos.
# Nunca iterar sobre dados do request — sempre sobre estas constantes.
_CAMPOS_PADIOLEIRO     = ('nome', 'matricula', 'turno')
_CAMPOS_TIPO_MOVIMENTO = ('nome', 'icone', 'cor', 'ordem')
_CAMPOS_DESTINO        = ('nome', 'tipo_movimento_id', 'ordem')
_CAMPOS_ORIGEM         = ('nome', 'ordem')


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
    usuario_id = session.get('usuario_id')
    is_admin = session.get('is_admin', False)
    dias         = min(int(request.args.get('dias', 7)), 365)
    setor        = request.args.get('setor', '').strip()
    padioleiro_id = request.args.get('padioleiro_id', '').strip()
    tipo_id      = request.args.get('tipo_id', '').strip()
    status       = request.args.get('status', '').strip()
    prioridade   = request.args.get('prioridade', '').strip()

    try:
        with get_db_cursor() as cursor:

            where  = [
                "criado_em >= NOW() - (%s || ' days')::INTERVAL",
                "(dt_conclusao IS NULL OR EXTRACT(EPOCH FROM (dt_conclusao - criado_em)) / 60 <= 300)"
            ]
            params = [str(dias)]

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
    usuario_id = session.get('usuario_id')
    is_admin = session.get('is_admin', False)
    dias = min(int(request.args.get('dias', 30)), 365)
    try:
        with get_db_cursor() as cursor:
            cursor.execute(f"""
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
                WHERE criado_em >= NOW() - (%s || ' days')::INTERVAL
                  AND (dt_conclusao IS NULL OR EXTRACT(EPOCH FROM (dt_conclusao - criado_em)) / 60 <= 300)
                GROUP BY setor_origem_nome
                ORDER BY total DESC
            """, (str(dias),))
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
    usuario_id = session.get('usuario_id')
    is_admin = session.get('is_admin', False)
    dias = min(int(request.args.get('dias', 30)), 365)
    try:
        with get_db_cursor() as cursor:
            cursor.execute(f"""
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
                WHERE criado_em >= NOW() - (%s || ' days')::INTERVAL
                  AND padioleiro_nome IS NOT NULL
                  AND (dt_conclusao IS NULL OR EXTRACT(EPOCH FROM (dt_conclusao - criado_em)) / 60 <= 300)
                GROUP BY padioleiro_nome
                ORDER BY concluidos DESC
            """, (str(dias),))
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
    dias      = min(int(request.args.get('dias', 30)), 365)
    status    = request.args.get('status', '').strip()
    prioridade = request.args.get('prioridade', '').strip()
    setor     = request.args.get('setor', '').strip()
    try:
        with get_db_cursor() as cursor:
            where  = ["criado_em >= NOW() - (%s || ' days')::INTERVAL"]
            params = [str(dias)]

            if status:
                where.append("status = %s")
                params.append(status)
            if prioridade:
                where.append("prioridade = %s")
                params.append(prioridade)
            if setor:
                where.append("setor_origem_nome ILIKE %s")
                params.append(f'%{setor}%')

            cursor.execute("""
                SELECT
                    id,
                    tipo_movimento_nome,
                    nm_paciente,
                    nr_atendimento,
                    leito_origem,
                    setor_origem_nome,
                    destino_nome,
                    destino_complemento,
                    prioridade,
                    status,
                    solicitante_nome,
                    padioleiro_nome,
                    observacao,
                    TO_CHAR(criado_em,            'DD/MM/YYYY HH24:MI') AS criado_em,
                    TO_CHAR(dt_aceite,            'DD/MM/YYYY HH24:MI') AS dt_aceite,
                    TO_CHAR(dt_inicio_transporte, 'DD/MM/YYYY HH24:MI') AS dt_inicio_transporte,
                    TO_CHAR(dt_conclusao,         'DD/MM/YYYY HH24:MI') AS dt_conclusao,
                    TO_CHAR(dt_cancelamento,      'DD/MM/YYYY HH24:MI') AS dt_cancelamento,
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
                        WHEN status = 'cancelado' AND dt_cancelamento IS NOT NULL
                        THEN ROUND(EXTRACT(EPOCH FROM (dt_cancelamento - criado_em)) / 60, 1)
                    END AS tempo_total_min
                FROM padioleiro_chamados
                WHERE """ + ' AND '.join(where) + """
                ORDER BY criado_em DESC
            """, params)
            rows = cursor.fetchall()

            output = io.StringIO()
            writer = csv.writer(output, delimiter=';')
            writer.writerow([
                'ID', 'Tipo Movimento', 'Paciente', 'Atendimento', 'Leito Origem',
                'Setor Origem', 'Destino', 'Compl. Destino', 'Prioridade', 'Status',
                'Solicitante', 'Padioleiro', 'Observacao',
                'Criado Em', 'Aceito Em', 'Inicio Transporte', 'Conclusao', 'Cancelado Em',
                'Motivo Cancelamento',
                'T. Aceite (min)', 'T. Deslocamento (min)', 'T. Transporte (min)', 'T. Total (min)'
            ])
            for row in rows:
                writer.writerow([
                    row.get('id'), row.get('tipo_movimento_nome'), row.get('nm_paciente'),
                    row.get('nr_atendimento'), row.get('leito_origem'), row.get('setor_origem_nome'),
                    row.get('destino_nome'), row.get('destino_complemento'),
                    row.get('prioridade'), row.get('status'),
                    row.get('solicitante_nome'), row.get('padioleiro_nome'), row.get('observacao'),
                    row.get('criado_em'), row.get('dt_aceite'), row.get('dt_inicio_transporte'),
                    row.get('dt_conclusao'), row.get('dt_cancelamento'),
                    row.get('motivo_cancelamento'),
                    row.get('tempo_aceite_min'), row.get('tempo_deslocamento_min'),
                    row.get('tempo_transporte_min'), row.get('tempo_total_min')
                ])

            output.seek(0)
            nome_arquivo = f'chamados_padioleiro_{date.today().strftime("%Y%m%d")}.csv'
            return Response(
                '﻿' + output.getvalue(),
                mimetype='text/csv; charset=utf-8-sig',
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
