"""
Painel 43 - Gestão Nutrição
Relatórios, analytics, exportação CSV e configurações do sistema de dietas.
"""
import csv
import io
from datetime import datetime, date

from flask import Blueprint, jsonify, request, send_from_directory, session, current_app, Response
from backend.database import get_db_cursor
from backend.middleware.decorators import login_required, panel_permission_required
from backend.cache import cache_delete_pattern

painel43_bp = Blueprint('painel43', __name__)

# Whitelists — segurança SQL injection em UPDATEs dinâmicos
_CAMPOS_EQUIPE      = ('nome', 'matricula', 'funcao', 'turno', 'ativo')
_CAMPOS_TIPO_DIETA  = ('nome', 'descricao', 'icone', 'cor', 'ativo', 'ordem')
_CAMPOS_REFEICAO    = ('nome', 'horario_inicio', 'horario_fim', 'icone', 'ativo', 'ordem')
_CAMPOS_RESTRICAO   = ('nome', 'sigla', 'icone', 'cor', 'ativo', 'ordem')


@painel43_bp.route('/painel/painel43')
@login_required
@panel_permission_required('painel43')
def painel43():
    return send_from_directory('paineis/painel43', 'index.html')


# =========================================================
# DASHBOARD — KPIs do dia
# =========================================================

@painel43_bp.route('/api/paineis/painel43/dashboard', methods=['GET'])
@login_required
def api_p43_dashboard():
    try:
        with get_db_cursor() as cursor:
            cursor.execute("""
                SELECT
                    COUNT(*) AS total,
                    COUNT(*) FILTER (WHERE status='entregue')  AS entregues,
                    COUNT(*) FILTER (WHERE status='cancelado') AS cancelados,
                    COUNT(*) FILTER (WHERE status NOT IN ('entregue','cancelado')) AS em_aberto,
                    COUNT(*) FILTER (WHERE prioridade='urgente') AS urgentes,
                    ROUND(AVG(CASE WHEN dt_entrega IS NOT NULL
                        THEN EXTRACT(EPOCH FROM (dt_entrega - criado_em))/60 END)::numeric,1) AS media_min_total,
                    ROUND(AVG(CASE WHEN dt_aceite IS NOT NULL
                        THEN EXTRACT(EPOCH FROM (dt_aceite - criado_em))/60 END)::numeric,1) AS media_min_aceite,
                    ROUND(AVG(CASE WHEN dt_inicio_preparo IS NOT NULL AND dt_aceite IS NOT NULL
                        THEN EXTRACT(EPOCH FROM (dt_inicio_preparo - dt_aceite))/60 END)::numeric,1) AS media_min_espera_preparo,
                    ROUND(AVG(CASE WHEN dt_entrega IS NOT NULL AND dt_pronto IS NOT NULL
                        THEN EXTRACT(EPOCH FROM (dt_entrega - dt_pronto))/60 END)::numeric,1) AS media_min_entrega
                FROM nutricao_solicitacoes
                WHERE DATE(criado_em) = CURRENT_DATE
            """)
            resumo = dict(cursor.fetchone() or {})

            # Ativos por status (fila em andamento)
            cursor.execute("""
                SELECT id, codigo_entrega, nm_paciente, leito, setor_nome,
                    tipo_dieta_nome, refeicao_nome, prioridade, status,
                    responsavel_nome,
                    TO_CHAR(criado_em, 'HH24:MI') AS criado_em,
                    EXTRACT(EPOCH FROM (NOW() - criado_em))::int / 60 AS minutos_espera
                FROM nutricao_solicitacoes
                WHERE status NOT IN ('entregue', 'cancelado')
                ORDER BY
                    CASE prioridade WHEN 'urgente' THEN 0 ELSE 1 END,
                    criado_em ASC
            """)
            ativos = [dict(r) for r in cursor.fetchall()]

        return jsonify({'success': True, 'resumo': resumo, 'ativos': ativos})
    except Exception as e:
        current_app.logger.error('Erro dashboard p43: %s', e, exc_info=True)
        return jsonify({'success': False, 'error': 'Erro ao buscar dashboard'}), 500


# =========================================================
# LISTAGEM FILTRADA
# =========================================================

@painel43_bp.route('/api/paineis/painel43/solicitacoes', methods=['GET'])
@login_required
def api_p43_solicitacoes():
    dias           = int(request.args.get('dias') or 7)
    setor          = request.args.get('setor') or None
    status         = request.args.get('status') or None
    tipo_dieta_id  = request.args.get('tipo_dieta_id') or None
    responsavel_id = request.args.get('responsavel_id') or None

    where  = ["criado_em >= NOW() - INTERVAL '%s days'" ]
    params = [dias]

    if setor:
        where.append("setor_nome ILIKE %s")
        params.append(f'%{setor}%')
    if status:
        where.append("status = %s")
        params.append(status)
    if tipo_dieta_id:
        where.append("tipo_dieta_id = %s")
        params.append(tipo_dieta_id)
    if responsavel_id:
        where.append("responsavel_id = %s")
        params.append(responsavel_id)

    sql = """
        SELECT id, codigo_entrega, nm_paciente, leito, setor_nome, ds_clinica,
            tipo_dieta_nome, refeicao_nome, quantidade, restricoes, observacao,
            prioridade, status, solicitante_nome, responsavel_nome, entregue_por,
            TO_CHAR(criado_em,          'DD/MM HH24:MI') AS criado_em,
            TO_CHAR(dt_aceite,          'HH24:MI')       AS dt_aceite,
            TO_CHAR(dt_inicio_preparo,  'HH24:MI')       AS dt_inicio_preparo,
            TO_CHAR(dt_pronto,          'HH24:MI')       AS dt_pronto,
            TO_CHAR(dt_entrega,         'HH24:MI')       AS dt_entrega,
            TO_CHAR(dt_cancelamento,    'HH24:MI')       AS dt_cancelamento,
            motivo_cancelamento,
            CASE WHEN dt_entrega IS NOT NULL
                THEN ROUND(EXTRACT(EPOCH FROM (dt_entrega - criado_em))/60)::int
            END AS t_total_min
        FROM nutricao_solicitacoes
        WHERE """ + " AND ".join(where) + """
        ORDER BY criado_em DESC
        LIMIT 500
    """

    try:
        with get_db_cursor() as cursor:
            cursor.execute(sql, params)
            solicitacoes = [dict(r) for r in cursor.fetchall()]
        return jsonify({'success': True, 'solicitacoes': solicitacoes})
    except Exception as e:
        current_app.logger.error('Erro solicitacoes p43: %s', e, exc_info=True)
        return jsonify({'success': False, 'error': 'Erro ao buscar solicitações'}), 500


# =========================================================
# ANALYTICS — Por Refeição
# =========================================================

@painel43_bp.route('/api/paineis/painel43/por-refeicao', methods=['GET'])
@login_required
def api_p43_por_refeicao():
    dias = int(request.args.get('dias') or 30)
    try:
        with get_db_cursor() as cursor:
            cursor.execute("""
                SELECT refeicao_nome,
                    COUNT(*) AS total,
                    COUNT(*) FILTER (WHERE status='entregue')  AS entregues,
                    COUNT(*) FILTER (WHERE status='cancelado') AS cancelados,
                    COUNT(*) FILTER (WHERE prioridade='urgente') AS urgentes,
                    ROUND(AVG(CASE WHEN dt_entrega IS NOT NULL
                        THEN EXTRACT(EPOCH FROM (dt_entrega - criado_em))/60 END)::numeric,1) AS media_min
                FROM nutricao_solicitacoes
                WHERE criado_em >= NOW() - (%s || ' days')::INTERVAL
                  AND refeicao_nome IS NOT NULL
                GROUP BY refeicao_nome ORDER BY total DESC
            """, (str(dias),))
            dados = [dict(r) for r in cursor.fetchall()]
        return jsonify({'success': True, 'dados': dados})
    except Exception as e:
        current_app.logger.error('Erro por-refeicao p43: %s', e, exc_info=True)
        return jsonify({'success': False, 'error': 'Erro ao buscar dados'}), 500


# =========================================================
# ANALYTICS — Por Tipo de Dieta
# =========================================================

@painel43_bp.route('/api/paineis/painel43/por-dieta', methods=['GET'])
@login_required
def api_p43_por_dieta():
    dias = int(request.args.get('dias') or 30)
    try:
        with get_db_cursor() as cursor:
            cursor.execute("""
                SELECT tipo_dieta_nome,
                    COUNT(*) AS total,
                    COUNT(*) FILTER (WHERE status='entregue')  AS entregues,
                    COUNT(*) FILTER (WHERE status='cancelado') AS cancelados,
                    COUNT(*) FILTER (WHERE prioridade='urgente') AS urgentes,
                    ROUND(AVG(CASE WHEN dt_entrega IS NOT NULL
                        THEN EXTRACT(EPOCH FROM (dt_entrega - criado_em))/60 END)::numeric,1) AS media_min
                FROM nutricao_solicitacoes
                WHERE criado_em >= NOW() - (%s || ' days')::INTERVAL
                  AND tipo_dieta_nome IS NOT NULL
                GROUP BY tipo_dieta_nome ORDER BY total DESC
            """, (str(dias),))
            dados = [dict(r) for r in cursor.fetchall()]
        return jsonify({'success': True, 'dados': dados})
    except Exception as e:
        current_app.logger.error('Erro por-dieta p43: %s', e, exc_info=True)
        return jsonify({'success': False, 'error': 'Erro ao buscar dados'}), 500


# =========================================================
# ANALYTICS — Por Setor
# =========================================================

@painel43_bp.route('/api/paineis/painel43/por-setor', methods=['GET'])
@login_required
def api_p43_por_setor():
    dias = int(request.args.get('dias') or 30)
    try:
        with get_db_cursor() as cursor:
            cursor.execute("""
                SELECT COALESCE(setor_nome, '(sem setor)') AS setor,
                    COUNT(*) AS total,
                    COUNT(*) FILTER (WHERE status='entregue')  AS entregues,
                    COUNT(*) FILTER (WHERE status='cancelado') AS cancelados,
                    COUNT(*) FILTER (WHERE prioridade='urgente') AS urgentes
                FROM nutricao_solicitacoes
                WHERE criado_em >= NOW() - (%s || ' days')::INTERVAL
                GROUP BY setor_nome ORDER BY total DESC LIMIT 20
            """, (str(dias),))
            dados = [dict(r) for r in cursor.fetchall()]
        return jsonify({'success': True, 'dados': dados})
    except Exception as e:
        current_app.logger.error('Erro por-setor p43: %s', e, exc_info=True)
        return jsonify({'success': False, 'error': 'Erro ao buscar dados'}), 500


# =========================================================
# ANALYTICS — Por Responsável
# =========================================================

@painel43_bp.route('/api/paineis/painel43/por-responsavel', methods=['GET'])
@login_required
def api_p43_por_responsavel():
    dias = int(request.args.get('dias') or 30)
    try:
        with get_db_cursor() as cursor:
            cursor.execute("""
                SELECT responsavel_nome,
                    COUNT(*) AS total,
                    COUNT(*) FILTER (WHERE status='entregue')  AS entregues,
                    COUNT(*) FILTER (WHERE status='cancelado') AS cancelados,
                    ROUND(AVG(CASE WHEN dt_entrega IS NOT NULL
                        THEN EXTRACT(EPOCH FROM (dt_entrega - criado_em))/60 END)::numeric,1) AS media_min_total,
                    ROUND(AVG(CASE WHEN dt_inicio_preparo IS NOT NULL AND dt_aceite IS NOT NULL
                        THEN EXTRACT(EPOCH FROM (dt_inicio_preparo - dt_aceite))/60 END)::numeric,1) AS media_min_espera_preparo
                FROM nutricao_solicitacoes
                WHERE criado_em >= NOW() - (%s || ' days')::INTERVAL
                  AND responsavel_nome IS NOT NULL
                GROUP BY responsavel_nome ORDER BY total DESC
            """, (str(dias),))
            dados = [dict(r) for r in cursor.fetchall()]
        return jsonify({'success': True, 'dados': dados})
    except Exception as e:
        current_app.logger.error('Erro por-responsavel p43: %s', e, exc_info=True)
        return jsonify({'success': False, 'error': 'Erro ao buscar dados'}), 500


# =========================================================
# ANALYTICS — Por Hora
# =========================================================

@painel43_bp.route('/api/paineis/painel43/por-hora', methods=['GET'])
@login_required
def api_p43_por_hora():
    dias = int(request.args.get('dias') or 1)
    try:
        with get_db_cursor() as cursor:
            cursor.execute("""
                SELECT EXTRACT(HOUR FROM criado_em)::int AS hora,
                    COUNT(*) AS total,
                    COUNT(*) FILTER (WHERE status='entregue')    AS entregues,
                    COUNT(*) FILTER (WHERE prioridade='urgente') AS urgentes
                FROM nutricao_solicitacoes
                WHERE criado_em >= NOW() - (%s || ' days')::INTERVAL
                GROUP BY 1 ORDER BY 1
            """, (str(dias),))
            dados = [dict(r) for r in cursor.fetchall()]
        return jsonify({'success': True, 'dados': dados})
    except Exception as e:
        current_app.logger.error('Erro por-hora p43: %s', e, exc_info=True)
        return jsonify({'success': False, 'error': 'Erro ao buscar dados'}), 500


# =========================================================
# CANCELAMENTO ADMINISTRATIVO
# =========================================================

@painel43_bp.route('/api/paineis/painel43/solicitacoes/<int:sid>/cancelar', methods=['PUT'])
@login_required
def api_p43_cancelar(sid):
    dados  = request.get_json(silent=True) or {}
    motivo = (dados.get('motivo') or '').strip()
    if len(motivo) < 10:
        return jsonify({'success': False, 'error': 'Motivo deve ter pelo menos 10 caracteres'}), 400

    try:
        with get_db_cursor() as cursor:
            cursor.execute("""
                UPDATE nutricao_solicitacoes
                SET status = 'cancelado',
                    dt_cancelamento = NOW(),
                    motivo_cancelamento = %s,
                    atualizado_em = NOW()
                WHERE id = %s AND status != 'entregue'
            """, (motivo, sid))
            if cursor.rowcount == 0:
                return jsonify({'success': False, 'error': 'Solicitação não encontrada ou já entregue'}), 400
        return jsonify({'success': True})
    except Exception as e:
        current_app.logger.error('Erro cancelar p43 id=%s: %s', sid, e, exc_info=True)
        return jsonify({'success': False, 'error': 'Erro ao cancelar'}), 500


# =========================================================
# EXPORTAÇÃO CSV
# =========================================================

@painel43_bp.route('/api/paineis/painel43/exportar', methods=['GET'])
@login_required
def api_p43_exportar():
    dias = int(request.args.get('dias') or 30)
    now  = datetime.now()

    try:
        with get_db_cursor() as cursor:
            cursor.execute("""
                SELECT id, codigo_entrega, nm_paciente, leito, setor_nome, ds_clinica,
                    tipo_dieta_nome, refeicao_nome, quantidade, restricoes, observacao,
                    prioridade, status, solicitante_nome, responsavel_nome, entregue_por,
                    TO_CHAR(criado_em,         'DD/MM/YYYY HH24:MI') AS criado_em,
                    TO_CHAR(dt_aceite,         'DD/MM/YYYY HH24:MI') AS dt_aceite,
                    TO_CHAR(dt_inicio_preparo, 'DD/MM/YYYY HH24:MI') AS dt_inicio_preparo,
                    TO_CHAR(dt_pronto,         'DD/MM/YYYY HH24:MI') AS dt_pronto,
                    TO_CHAR(dt_inicio_entrega, 'DD/MM/YYYY HH24:MI') AS dt_inicio_entrega,
                    TO_CHAR(dt_entrega,        'DD/MM/YYYY HH24:MI') AS dt_entrega,
                    TO_CHAR(dt_cancelamento,   'DD/MM/YYYY HH24:MI') AS dt_cancelamento,
                    motivo_cancelamento, observacao_entrega,
                    CASE WHEN dt_entrega IS NOT NULL
                        THEN ROUND(EXTRACT(EPOCH FROM (dt_entrega - criado_em))/60)::int
                    END AS t_total_min
                FROM nutricao_solicitacoes
                WHERE criado_em >= NOW() - (%s || ' days')::INTERVAL
                ORDER BY criado_em DESC
            """, (str(dias),))
            rows = cursor.fetchall()

        output = io.StringIO()
        writer = csv.writer(output)
        writer.writerow([
            'ID', 'Código', 'Paciente', 'Leito', 'Setor', 'Clínica',
            'Dieta', 'Refeição', 'Qtd', 'Restrições', 'Observação',
            'Prioridade', 'Status', 'Solicitante', 'Responsável', 'Entregue Por',
            'Criado', 'Aceito', 'Início Preparo', 'Pronto', 'Início Entrega',
            'Entregue', 'Cancelado', 'Motivo Cancelamento', 'Obs. Entrega', 'T.Total(min)'
        ])
        for r in rows:
            writer.writerow([
                r['id'], r['codigo_entrega'], r['nm_paciente'], r['leito'] or '',
                r['setor_nome'] or '', r['ds_clinica'] or '',
                r['tipo_dieta_nome'] or '', r['refeicao_nome'] or '',
                r['quantidade'] or 1, r['restricoes'] or '', r['observacao'] or '',
                r['prioridade'], r['status'],
                r['solicitante_nome'] or '', r['responsavel_nome'] or '', r['entregue_por'] or '',
                r['criado_em'] or '', r['dt_aceite'] or '', r['dt_inicio_preparo'] or '',
                r['dt_pronto'] or '', r['dt_inicio_entrega'] or '', r['dt_entrega'] or '',
                r['dt_cancelamento'] or '', r['motivo_cancelamento'] or '',
                r['observacao_entrega'] or '', r['t_total_min'] or ''
            ])

        bom      = b'\xef\xbb\xbf'
        conteudo = bom + output.getvalue().encode('utf-8')
        nome     = 'nutricao_hac_{}.csv'.format(now.strftime('%d%m%Y'))

        return Response(
            conteudo,
            mimetype='text/csv',
            headers={'Content-Disposition': 'attachment; filename="{}"'.format(nome)}
        )
    except Exception as e:
        current_app.logger.error('Erro exportar p43: %s', e, exc_info=True)
        return jsonify({'success': False, 'error': 'Erro ao exportar'}), 500


# =========================================================
# CONFIG — EQUIPE
# =========================================================

@painel43_bp.route('/api/paineis/painel43/config/equipe', methods=['GET'])
@login_required
def api_p43_equipe_list():
    try:
        with get_db_cursor() as cursor:
            cursor.execute("""
                SELECT id, nome, matricula, funcao, turno, ativo,
                    TO_CHAR(criado_em, 'DD/MM/YYYY') AS criado_em
                FROM nutricao_cadastros ORDER BY nome
            """)
            equipe = [dict(r) for r in cursor.fetchall()]
        return jsonify({'success': True, 'equipe': equipe})
    except Exception as e:
        current_app.logger.error('Erro config/equipe GET p43: %s', e, exc_info=True)
        return jsonify({'success': False, 'error': 'Erro ao buscar equipe'}), 500


@painel43_bp.route('/api/paineis/painel43/config/equipe', methods=['POST'])
@login_required
def api_p43_equipe_create():
    dados = request.get_json(silent=True) or {}
    nome  = (dados.get('nome') or '').strip()
    if not nome:
        return jsonify({'success': False, 'error': 'Nome obrigatório'}), 400

    funcao    = (dados.get('funcao') or 'tecnico').strip()
    turno     = (dados.get('turno') or 'todos').strip()
    matricula = (dados.get('matricula') or '').strip() or None

    try:
        with get_db_cursor() as cursor:
            cursor.execute("""
                INSERT INTO nutricao_cadastros (nome, matricula, funcao, turno)
                VALUES (%s, %s, %s, %s) RETURNING id
            """, (nome, matricula, funcao, turno))
            new_id = cursor.fetchone()['id']
        cache_delete_pattern('p42:*')
        return jsonify({'success': True, 'id': new_id}), 201
    except Exception as e:
        current_app.logger.error('Erro config/equipe POST p43: %s', e, exc_info=True)
        return jsonify({'success': False, 'error': 'Erro ao criar membro'}), 500


@painel43_bp.route('/api/paineis/painel43/config/equipe/<int:eid>', methods=['PUT'])
@login_required
def api_p43_equipe_update(eid):
    dados = request.get_json(silent=True) or {}
    sets, vals = [], []
    for campo in _CAMPOS_EQUIPE:
        if campo in dados:
            sets.append('{} = %s'.format(campo))
            vals.append(dados[campo])

    if not sets:
        return jsonify({'success': False, 'error': 'Nenhum campo para atualizar'}), 400

    sets.append('atualizado_em = NOW()')
    vals.append(eid)

    try:
        with get_db_cursor() as cursor:
            cursor.execute(
                'UPDATE nutricao_cadastros SET {} WHERE id = %s'.format(', '.join(sets)),
                vals
            )
            if cursor.rowcount == 0:
                return jsonify({'success': False, 'error': 'Membro não encontrado'}), 404
        cache_delete_pattern('p42:*')
        return jsonify({'success': True})
    except Exception as e:
        current_app.logger.error('Erro config/equipe PUT p43 id=%s: %s', eid, e, exc_info=True)
        return jsonify({'success': False, 'error': 'Erro ao atualizar membro'}), 500


# =========================================================
# CONFIG — TIPOS DE DIETA
# =========================================================

@painel43_bp.route('/api/paineis/painel43/config/tipos-dieta', methods=['GET'])
@login_required
def api_p43_tipos_dieta_list():
    try:
        with get_db_cursor() as cursor:
            cursor.execute("SELECT id, nome, descricao, icone, cor, ativo, ordem FROM nutricao_tipos_dieta ORDER BY ordem, nome")
            dados = [dict(r) for r in cursor.fetchall()]
        return jsonify({'success': True, 'dados': dados})
    except Exception as e:
        current_app.logger.error('Erro config/tipos-dieta GET p43: %s', e, exc_info=True)
        return jsonify({'success': False, 'error': 'Erro ao buscar'}), 500


@painel43_bp.route('/api/paineis/painel43/config/tipos-dieta', methods=['POST'])
@login_required
def api_p43_tipos_dieta_create():
    dados = request.get_json(silent=True) or {}
    nome  = (dados.get('nome') or '').strip()
    if not nome:
        return jsonify({'success': False, 'error': 'Nome obrigatório'}), 400
    try:
        with get_db_cursor() as cursor:
            cursor.execute("""
                INSERT INTO nutricao_tipos_dieta (nome, descricao, icone, cor, ordem)
                VALUES (%s, %s, %s, %s, %s) RETURNING id
            """, (nome, dados.get('descricao') or None,
                  dados.get('icone') or 'fa-utensils',
                  dados.get('cor') or '#17A2B8',
                  int(dados.get('ordem') or 0)))
            new_id = cursor.fetchone()['id']
        cache_delete_pattern('p41:*')
        return jsonify({'success': True, 'id': new_id}), 201
    except Exception as e:
        current_app.logger.error('Erro config/tipos-dieta POST p43: %s', e, exc_info=True)
        return jsonify({'success': False, 'error': 'Erro ao criar'}), 500


@painel43_bp.route('/api/paineis/painel43/config/tipos-dieta/<int:tid>', methods=['PUT'])
@login_required
def api_p43_tipos_dieta_update(tid):
    dados = request.get_json(silent=True) or {}
    sets, vals = [], []
    for campo in _CAMPOS_TIPO_DIETA:
        if campo in dados:
            sets.append('{} = %s'.format(campo))
            vals.append(dados[campo])
    if not sets:
        return jsonify({'success': False, 'error': 'Nenhum campo para atualizar'}), 400
    vals.append(tid)
    try:
        with get_db_cursor() as cursor:
            cursor.execute('UPDATE nutricao_tipos_dieta SET {} WHERE id = %s'.format(', '.join(sets)), vals)
            if cursor.rowcount == 0:
                return jsonify({'success': False, 'error': 'Não encontrado'}), 404
        cache_delete_pattern('p41:*')
        return jsonify({'success': True})
    except Exception as e:
        current_app.logger.error('Erro config/tipos-dieta PUT p43 id=%s: %s', tid, e, exc_info=True)
        return jsonify({'success': False, 'error': 'Erro ao atualizar'}), 500


# =========================================================
# CONFIG — REFEIÇÕES
# =========================================================

@painel43_bp.route('/api/paineis/painel43/config/refeicoes', methods=['GET'])
@login_required
def api_p43_refeicoes_list():
    try:
        with get_db_cursor() as cursor:
            cursor.execute("""
                SELECT id, nome, icone, ativo, ordem,
                    TO_CHAR(horario_inicio,'HH24:MI') AS horario_inicio,
                    TO_CHAR(horario_fim,   'HH24:MI') AS horario_fim
                FROM nutricao_refeicoes ORDER BY ordem
            """)
            dados = [dict(r) for r in cursor.fetchall()]
        return jsonify({'success': True, 'dados': dados})
    except Exception as e:
        current_app.logger.error('Erro config/refeicoes GET p43: %s', e, exc_info=True)
        return jsonify({'success': False, 'error': 'Erro ao buscar'}), 500


@painel43_bp.route('/api/paineis/painel43/config/refeicoes', methods=['POST'])
@login_required
def api_p43_refeicoes_create():
    dados = request.get_json(silent=True) or {}
    nome  = (dados.get('nome') or '').strip()
    if not nome:
        return jsonify({'success': False, 'error': 'Nome obrigatório'}), 400
    try:
        with get_db_cursor() as cursor:
            cursor.execute("""
                INSERT INTO nutricao_refeicoes (nome, horario_inicio, horario_fim, icone, ordem)
                VALUES (%s, %s, %s, %s, %s) RETURNING id
            """, (nome, dados.get('horario_inicio') or None,
                  dados.get('horario_fim') or None,
                  dados.get('icone') or 'fa-utensils',
                  int(dados.get('ordem') or 0)))
            new_id = cursor.fetchone()['id']
        cache_delete_pattern('p41:*')
        return jsonify({'success': True, 'id': new_id}), 201
    except Exception as e:
        current_app.logger.error('Erro config/refeicoes POST p43: %s', e, exc_info=True)
        return jsonify({'success': False, 'error': 'Erro ao criar'}), 500


@painel43_bp.route('/api/paineis/painel43/config/refeicoes/<int:rid>', methods=['PUT'])
@login_required
def api_p43_refeicoes_update(rid):
    dados = request.get_json(silent=True) or {}
    sets, vals = [], []
    for campo in _CAMPOS_REFEICAO:
        if campo in dados:
            sets.append('{} = %s'.format(campo))
            vals.append(dados[campo] if dados[campo] != '' else None)
    if not sets:
        return jsonify({'success': False, 'error': 'Nenhum campo para atualizar'}), 400
    vals.append(rid)
    try:
        with get_db_cursor() as cursor:
            cursor.execute('UPDATE nutricao_refeicoes SET {} WHERE id = %s'.format(', '.join(sets)), vals)
            if cursor.rowcount == 0:
                return jsonify({'success': False, 'error': 'Não encontrado'}), 404
        cache_delete_pattern('p41:*')
        return jsonify({'success': True})
    except Exception as e:
        current_app.logger.error('Erro config/refeicoes PUT p43 id=%s: %s', rid, e, exc_info=True)
        return jsonify({'success': False, 'error': 'Erro ao atualizar'}), 500


# =========================================================
# CONFIG — RESTRIÇÕES
# =========================================================

@painel43_bp.route('/api/paineis/painel43/config/restricoes', methods=['GET'])
@login_required
def api_p43_restricoes_list():
    try:
        with get_db_cursor() as cursor:
            cursor.execute("SELECT id, nome, sigla, icone, cor, ativo, ordem FROM nutricao_restricoes ORDER BY ordem")
            dados = [dict(r) for r in cursor.fetchall()]
        return jsonify({'success': True, 'dados': dados})
    except Exception as e:
        current_app.logger.error('Erro config/restricoes GET p43: %s', e, exc_info=True)
        return jsonify({'success': False, 'error': 'Erro ao buscar'}), 500


@painel43_bp.route('/api/paineis/painel43/config/restricoes', methods=['POST'])
@login_required
def api_p43_restricoes_create():
    dados = request.get_json(silent=True) or {}
    nome  = (dados.get('nome') or '').strip()
    if not nome:
        return jsonify({'success': False, 'error': 'Nome obrigatório'}), 400
    try:
        with get_db_cursor() as cursor:
            cursor.execute("""
                INSERT INTO nutricao_restricoes (nome, sigla, icone, cor, ordem)
                VALUES (%s, %s, %s, %s, %s) RETURNING id
            """, (nome, dados.get('sigla') or None,
                  dados.get('icone') or 'fa-triangle-exclamation',
                  dados.get('cor') or '#E67E00',
                  int(dados.get('ordem') or 0)))
            new_id = cursor.fetchone()['id']
        cache_delete_pattern('p41:*')
        return jsonify({'success': True, 'id': new_id}), 201
    except Exception as e:
        current_app.logger.error('Erro config/restricoes POST p43: %s', e, exc_info=True)
        return jsonify({'success': False, 'error': 'Erro ao criar'}), 500


@painel43_bp.route('/api/paineis/painel43/config/restricoes/<int:rid>', methods=['PUT'])
@login_required
def api_p43_restricoes_update(rid):
    dados = request.get_json(silent=True) or {}
    sets, vals = [], []
    for campo in _CAMPOS_RESTRICAO:
        if campo in dados:
            sets.append('{} = %s'.format(campo))
            vals.append(dados[campo])
    if not sets:
        return jsonify({'success': False, 'error': 'Nenhum campo para atualizar'}), 400
    vals.append(rid)
    try:
        with get_db_cursor() as cursor:
            cursor.execute('UPDATE nutricao_restricoes SET {} WHERE id = %s'.format(', '.join(sets)), vals)
            if cursor.rowcount == 0:
                return jsonify({'success': False, 'error': 'Não encontrado'}), 404
        cache_delete_pattern('p41:*')
        return jsonify({'success': True})
    except Exception as e:
        current_app.logger.error('Erro config/restricoes PUT p43 id=%s: %s', rid, e, exc_info=True)
        return jsonify({'success': False, 'error': 'Erro ao atualizar'}), 500
