# ============================================================
# PAINEL 30 - CENTRAL DE TRATATIVAS SENTIR E AGIR
# Hospital Anchieta Ceilândia
# Gestão de tratativas para itens críticos
# ============================================================

import os
import traceback
from datetime import datetime, date, timedelta
from decimal import Decimal
from flask import Blueprint, request, jsonify, send_from_directory, session
from psycopg2.extras import RealDictCursor
from backend.database import get_db_connection
from backend.middleware.decorators import login_required
from backend.user_management import verificar_permissao_painel

painel30_bp = Blueprint('painel30', __name__)


# ============================================================
# HELPERS
# ============================================================

def _get_ip():
    return request.headers.get('X-Forwarded-For', request.remote_addr)


def _get_usuario():
    return session.get('usuario', 'sistema')


def _is_admin():
    return session.get('is_admin', False)


def _registrar_log(cursor, entidade, entidade_id, acao, usuario,
                   campo_alterado=None, valor_anterior=None, valor_novo=None,
                   ip_origem=None):
    cursor.execute("""
        INSERT INTO sentir_agir_log
            (entidade, entidade_id, acao, campo_alterado,
             valor_anterior, valor_novo, usuario, ip_origem)
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
    """, (entidade, entidade_id, acao, campo_alterado,
          valor_anterior, valor_novo, usuario, ip_origem))


def serializar_linha(row):
    resultado = {}
    for chave, valor in row.items():
        if isinstance(valor, (datetime, date)):
            resultado[chave] = valor.isoformat()
        elif isinstance(valor, Decimal):
            resultado[chave] = float(valor)
        else:
            resultado[chave] = valor
    return resultado


def _atualizar_status_visita(cursor, visita_id):
    """
    Atualiza o status_tratativa da visita baseado nas tratativas existentes.
    Lógica:
    - sem_pendencia: nenhuma tratativa
    - pendente: pelo menos 1 tratativa pendente
    - em_tratativa: pelo menos 1 em tratativa, nenhuma pendente
    - regularizado: todas regularizadas/canceladas
    """
    cursor.execute("""
        SELECT
            COUNT(*) AS total,
            SUM(CASE WHEN status = 'pendente' THEN 1 ELSE 0 END) AS pendentes,
            SUM(CASE WHEN status = 'em_tratativa' THEN 1 ELSE 0 END) AS em_tratativa,
            SUM(CASE WHEN status IN ('regularizado', 'cancelado') THEN 1 ELSE 0 END) AS resolvidas
        FROM sentir_agir_tratativas
        WHERE visita_id = %s
    """, (visita_id,))
    stats = cursor.fetchone()

    total = stats['total'] or 0
    pendentes = stats['pendentes'] or 0
    em_tratativa = stats['em_tratativa'] or 0

    if total == 0:
        novo_status = 'sem_pendencia'
    elif pendentes > 0:
        novo_status = 'pendente'
    elif em_tratativa > 0:
        novo_status = 'em_tratativa'
    else:
        novo_status = 'regularizado'

    cursor.execute("""
        UPDATE sentir_agir_visitas
        SET status_tratativa = %s, atualizado_em = NOW()
        WHERE id = %s
    """, (novo_status, visita_id))

    return novo_status


def _build_filtros_tratativas():
    """Constrói filtros compartilhados entre dashboard e listagem."""
    condicoes = []
    params = []

    # Status
    status = request.args.get('status', None)
    if status:
        valores = [s.strip() for s in status.split(',') if s.strip()]
        if valores:
            placeholders = ','.join(['%s'] * len(valores))
            condicoes.append("t.status IN (" + placeholders + ")")
            params.extend(valores)

    # Categoria
    categoria = request.args.get('categoria', None)
    if categoria:
        condicoes.append("t.categoria_id = %s")
        params.append(int(categoria))

    # Responsavel
    responsavel = request.args.get('responsavel', None)
    if responsavel:
        if responsavel == 'sem':
            condicoes.append("t.responsavel_id IS NULL")
        else:
            condicoes.append("t.responsavel_id = %s")
            params.append(int(responsavel))

    # Setor
    setor = request.args.get('setor', None)
    if setor:
        condicoes.append("v.setor_id = %s")
        params.append(int(setor))

    # Periodo
    dias = request.args.get('dias', None)
    dt_inicio = request.args.get('dt_inicio', None)
    dt_fim = request.args.get('dt_fim', None)

    if dt_inicio:
        condicoes.append("t.criado_em >= %s")
        params.append(dt_inicio)
    if dt_fim:
        condicoes.append("t.criado_em <= %s::date + INTERVAL '1 day'")
        params.append(dt_fim)
    if dias and not dt_inicio and not dt_fim:
        condicoes.append("t.criado_em >= NOW() - %s * INTERVAL '1 day'")
        params.append(int(dias))

    # Busca livre
    busca = request.args.get('busca', '').strip()
    if busca:
        condicoes.append("""(
            v.leito ILIKE %s OR
            v.nm_paciente ILIKE %s OR
            v.nr_atendimento ILIKE %s OR
            t.descricao_problema ILIKE %s OR
            t.plano_acao ILIKE %s OR
            i.descricao ILIKE %s
        )""")
        termo = '%' + busca + '%'
        params.extend([termo] * 6)

    return condicoes, params


# ============================================================
# ROTAS HTML / ESTÁTICOS
# ============================================================

@painel30_bp.route('/painel/painel30')
@login_required
def painel30():
    usuario_id = session.get('usuario_id')
    is_admin = session.get('is_admin', False)
    if not is_admin:
        if not verificar_permissao_painel(usuario_id, 'painel30'):
            return send_from_directory('frontend', 'acesso-negado.html')
    return send_from_directory('paineis/painel30', 'index.html')


@painel30_bp.route('/paineis/painel30/<path:filename>')
@login_required
def painel30_static(filename):
    return send_from_directory('paineis/painel30', filename)


# ============================================================
# API: DASHBOARD (KPIs)
# ============================================================

@painel30_bp.route('/api/paineis/painel30/dashboard', methods=['GET'])
@login_required
def dashboard():
    try:
        conn = get_db_connection()
        cursor = conn.cursor(cursor_factory=RealDictCursor)

        condicoes, params = _build_filtros_tratativas()
        where = " AND ".join(condicoes) if condicoes else "TRUE"

        sql = """
            SELECT
                COUNT(*) AS total,
                SUM(CASE WHEN t.status = 'pendente' THEN 1 ELSE 0 END) AS pendentes,
                SUM(CASE WHEN t.status = 'em_tratativa' THEN 1 ELSE 0 END) AS em_tratativa,
                SUM(CASE WHEN t.status = 'regularizado' THEN 1 ELSE 0 END) AS regularizadas,
                SUM(CASE WHEN t.status = 'cancelado' THEN 1 ELSE 0 END) AS canceladas,
                SUM(CASE WHEN t.responsavel_id IS NULL AND t.status IN ('pendente', 'em_tratativa') THEN 1 ELSE 0 END) AS sem_responsavel,
                SUM(CASE WHEN t.criado_em < NOW() - INTERVAL '3 days' AND t.status = 'pendente' THEN 1 ELSE 0 END) AS atrasadas
            FROM sentir_agir_tratativas t
            JOIN sentir_agir_visitas v ON v.id = t.visita_id
            JOIN sentir_agir_itens i ON i.id = t.item_id
            WHERE """ + where

        cursor.execute(sql, params)
        stats = cursor.fetchone()

        # Top 5 categorias com mais tratativas pendentes
        cursor.execute("""
            SELECT
                c.nome AS categoria,
                COUNT(*) AS total
            FROM sentir_agir_tratativas t
            JOIN sentir_agir_categorias c ON c.id = t.categoria_id
            WHERE t.status IN ('pendente', 'em_tratativa')
            GROUP BY c.nome
            ORDER BY total DESC
            LIMIT 5
        """)
        top_categorias = [serializar_linha(r) for r in cursor.fetchall()]

        cursor.close()
        conn.close()

        resultado = serializar_linha(stats) if stats else {}
        resultado['top_categorias'] = top_categorias
        resultado['is_admin'] = _is_admin()

        return jsonify({'success': True, 'data': resultado})
    except Exception as e:
        traceback.print_exc()
        return jsonify({'success': False, 'error': str(e)}), 500


# ============================================================
# API: LISTAGEM DE TRATATIVAS
# ============================================================

@painel30_bp.route('/api/paineis/painel30/tratativas', methods=['GET'])
@login_required
def listar_tratativas():
    try:
        conn = get_db_connection()
        cursor = conn.cursor(cursor_factory=RealDictCursor)

        condicoes, params = _build_filtros_tratativas()
        where = " AND ".join(condicoes) if condicoes else "TRUE"

        sql = """
            SELECT
                t.id AS tratativa_id,
                t.visita_id,
                t.status,
                t.prioridade,
                t.descricao_problema,
                t.plano_acao,
                t.data_inicio_tratativa,
                t.data_resolucao,
                t.resolvido_por,
                t.criado_em AS tratativa_criada_em,
                EXTRACT(EPOCH FROM (NOW() - t.criado_em)) / 86400.0 AS dias_em_aberto,
                i.descricao AS item_descricao,
                COALESCE(i.tipo, 'semaforo') AS item_tipo,
                c.id AS categoria_id,
                c.nome AS categoria_nome,
                c.cor AS categoria_cor,
                t.responsavel_id,
                r.nome AS responsavel_nome,
                t.responsavel_nome_manual,
                COALESCE(r.nome, t.responsavel_nome_manual, 'Sem responsavel') AS responsavel_display,
                v.leito,
                v.nr_atendimento,
                v.nm_paciente,
                v.setor_ocupacao,
                s.nome AS setor_sa_nome,
                s.sigla AS setor_sa_sigla,
                ro.data_ronda,
                d.nome_visitante_1 || ' e ' || d.nome_visitante_2 AS dupla_nome
            FROM sentir_agir_tratativas t
            JOIN sentir_agir_visitas v ON v.id = t.visita_id
            JOIN sentir_agir_itens i ON i.id = t.item_id
            JOIN sentir_agir_categorias c ON c.id = t.categoria_id
            JOIN sentir_agir_setores s ON s.id = v.setor_id
            JOIN sentir_agir_rondas ro ON ro.id = v.ronda_id
            JOIN sentir_agir_duplas d ON d.id = ro.dupla_id
            LEFT JOIN sentir_agir_responsaveis r ON r.id = t.responsavel_id
            WHERE """ + where + """
            ORDER BY
                CASE t.status
                    WHEN 'pendente' THEN 1
                    WHEN 'em_tratativa' THEN 2
                    WHEN 'regularizado' THEN 3
                    WHEN 'cancelado' THEN 4
                END,
                t.criado_em DESC
        """

        cursor.execute(sql, params)
        rows = cursor.fetchall()

        cursor.close()
        conn.close()

        dados = []
        for row in rows:
            item = serializar_linha(row)
            if item.get('dias_em_aberto') is not None:
                item['dias_em_aberto'] = round(float(item['dias_em_aberto']), 1)
            dados.append(item)

        return jsonify({
            'success': True,
            'data': dados,
            'total': len(dados),
            'is_admin': _is_admin()
        })
    except Exception as e:
        traceback.print_exc()
        return jsonify({'success': False, 'error': str(e)}), 500


# ============================================================
# API: DETALHE DE UMA TRATATIVA
# ============================================================

@painel30_bp.route('/api/paineis/painel30/tratativas/<int:tratativa_id>', methods=['GET'])
@login_required
def detalhe_tratativa(tratativa_id):
    try:
        conn = get_db_connection()
        cursor = conn.cursor(cursor_factory=RealDictCursor)

        cursor.execute("""
            SELECT
                t.*,
                i.descricao AS item_descricao,
                COALESCE(i.tipo, 'semaforo') AS item_tipo,
                c.nome AS categoria_nome,
                c.cor AS categoria_cor,
                c.icone AS categoria_icone,
                r.nome AS responsavel_nome,
                r.email AS responsavel_email,
                r.cargo AS responsavel_cargo,
                v.leito,
                v.nr_atendimento,
                v.nm_paciente,
                v.setor_ocupacao,
                v.qt_dias_internacao,
                v.observacoes AS visita_observacoes,
                v.avaliacao_final,
                s.nome AS setor_sa_nome,
                ro.data_ronda,
                d.nome_visitante_1 || ' e ' || d.nome_visitante_2 AS dupla_nome
            FROM sentir_agir_tratativas t
            JOIN sentir_agir_visitas v ON v.id = t.visita_id
            JOIN sentir_agir_itens i ON i.id = t.item_id
            JOIN sentir_agir_categorias c ON c.id = t.categoria_id
            JOIN sentir_agir_setores s ON s.id = v.setor_id
            JOIN sentir_agir_rondas ro ON ro.id = v.ronda_id
            JOIN sentir_agir_duplas d ON d.id = ro.dupla_id
            LEFT JOIN sentir_agir_responsaveis r ON r.id = t.responsavel_id
            WHERE t.id = %s
        """, (tratativa_id,))
        tratativa = cursor.fetchone()

        if not tratativa:
            cursor.close()
            conn.close()
            return jsonify({'success': False, 'error': 'Tratativa nao encontrada'}), 404

        # Histórico de alterações
        cursor.execute("""
            SELECT acao, campo_alterado, valor_anterior, valor_novo, usuario, criado_em
            FROM sentir_agir_log
            WHERE entidade = 'tratativa' AND entidade_id = %s
            ORDER BY criado_em DESC
            LIMIT 30
        """, (tratativa_id,))
        historico = cursor.fetchall()

        cursor.close()
        conn.close()

        resultado = serializar_linha(tratativa)
        resultado['historico'] = [serializar_linha(h) for h in historico]
        resultado['is_admin'] = _is_admin()

        # Extrai obs_item de descricao_problema (formato: "... | Observacao do item: TEXT")
        desc = resultado.get('descricao_problema') or ''
        if ' | Observacao do item: ' in desc:
            resultado['obs_item'] = desc.split(' | Observacao do item: ', 1)[1].strip()
        else:
            resultado['obs_item'] = None

        return jsonify({'success': True, 'data': resultado})
    except Exception as e:
        traceback.print_exc()
        return jsonify({'success': False, 'error': str(e)}), 500


# ============================================================
# API: ATUALIZAR TRATATIVA
# ============================================================

@painel30_bp.route('/api/paineis/painel30/tratativas/<int:tratativa_id>', methods=['PUT'])
@login_required
def atualizar_tratativa(tratativa_id):
    try:
        dados = request.get_json()
        if not dados:
            return jsonify({'success': False, 'error': 'Dados nao fornecidos'}), 400

        usuario = _get_usuario()
        ip = _get_ip()

        conn = get_db_connection()
        cursor = conn.cursor(cursor_factory=RealDictCursor)

        cursor.execute("SELECT * FROM sentir_agir_tratativas WHERE id = %s", (tratativa_id,))
        tratativa = cursor.fetchone()
        if not tratativa:
            cursor.close()
            conn.close()
            return jsonify({'success': False, 'error': 'Tratativa nao encontrada'}), 404

        alteracoes = []
        sets = []
        params = []

        # Plano de ação
        if 'plano_acao' in dados:
            novo = (dados['plano_acao'] or '').strip() or None
            if novo != tratativa['plano_acao']:
                sets.append("plano_acao = %s")
                params.append(novo)
                alteracoes.append({
                    'campo': 'plano_acao',
                    'anterior': tratativa['plano_acao'] or '',
                    'novo': novo or ''
                })

        # Status
        if 'status' in dados:
            novo_status = dados['status']
            if novo_status not in ('pendente', 'em_tratativa', 'regularizado', 'cancelado'):
                cursor.close()
                conn.close()
                return jsonify({'success': False, 'error': 'Status invalido'}), 400

            if novo_status != tratativa['status']:
                sets.append("status = %s")
                params.append(novo_status)
                alteracoes.append({
                    'campo': 'status',
                    'anterior': tratativa['status'],
                    'novo': novo_status
                })

                # Se mudou para em_tratativa e ainda não tem data_inicio
                if novo_status == 'em_tratativa' and not tratativa['data_inicio_tratativa']:
                    sets.append("data_inicio_tratativa = NOW()")

                # Se mudou para regularizado/cancelado, registrar resolução
                if novo_status in ('regularizado', 'cancelado'):
                    sets.append("data_resolucao = NOW()")
                    sets.append("resolvido_por = %s")
                    params.append(usuario)

        # Responsável (manual ou por ID)
        if 'responsavel_id' in dados:
            novo_resp = dados['responsavel_id']
            novo_resp = int(novo_resp) if novo_resp else None
            if novo_resp != tratativa['responsavel_id']:
                sets.append("responsavel_id = %s")
                params.append(novo_resp)
                alteracoes.append({
                    'campo': 'responsavel_id',
                    'anterior': str(tratativa['responsavel_id'] or ''),
                    'novo': str(novo_resp or '')
                })

        if 'responsavel_nome_manual' in dados:
            novo_nome = (dados['responsavel_nome_manual'] or '').strip() or None
            if novo_nome != tratativa['responsavel_nome_manual']:
                sets.append("responsavel_nome_manual = %s")
                params.append(novo_nome)
                alteracoes.append({
                    'campo': 'responsavel_nome_manual',
                    'anterior': tratativa['responsavel_nome_manual'] or '',
                    'novo': novo_nome or ''
                })

        # Prioridade
        if 'prioridade' in dados:
            novo_pri = dados['prioridade']
            if novo_pri in ('baixa', 'normal', 'alta', 'urgente') and novo_pri != tratativa['prioridade']:
                sets.append("prioridade = %s")
                params.append(novo_pri)
                alteracoes.append({
                    'campo': 'prioridade',
                    'anterior': tratativa['prioridade'],
                    'novo': novo_pri
                })

        # Observações de resolução
        if 'observacoes_resolucao' in dados:
            novo_obs = (dados['observacoes_resolucao'] or '').strip() or None
            if novo_obs != tratativa['observacoes_resolucao']:
                sets.append("observacoes_resolucao = %s")
                params.append(novo_obs)
                alteracoes.append({
                    'campo': 'observacoes_resolucao',
                    'anterior': tratativa['observacoes_resolucao'] or '',
                    'novo': novo_obs or ''
                })

        if not sets:
            cursor.close()
            conn.close()
            return jsonify({'success': True, 'message': 'Nenhuma alteracao realizada'})

        sets.append("atualizado_em = NOW()")
        params.append(tratativa_id)

        cursor.execute(
            "UPDATE sentir_agir_tratativas SET " + ", ".join(sets) + " WHERE id = %s",
            params
        )

        # Registrar logs de cada alteração
        for alt in alteracoes:
            _registrar_log(
                cursor, 'tratativa', tratativa_id, 'edicao', usuario,
                campo_alterado=alt['campo'],
                valor_anterior=alt['anterior'][:500] if alt['anterior'] else None,
                valor_novo=alt['novo'][:500] if alt['novo'] else None,
                ip_origem=ip
            )

        # Atualizar status_tratativa da visita pai
        novo_status_visita = _atualizar_status_visita(cursor, tratativa['visita_id'])

        conn.commit()
        cursor.close()
        conn.close()

        return jsonify({
            'success': True,
            'message': '%d campo(s) atualizado(s)' % len(alteracoes),
            'alteracoes': len(alteracoes),
            'novo_status_visita': novo_status_visita
        })
    except Exception as e:
        traceback.print_exc()
        return jsonify({'success': False, 'error': str(e)}), 500


# ============================================================
# API: FILTROS (valores distintos)
# ============================================================

@painel30_bp.route('/api/paineis/painel30/filtros', methods=['GET'])
@login_required
def filtros():
    try:
        conn = get_db_connection()
        cursor = conn.cursor(cursor_factory=RealDictCursor)

        cursor.execute("""
            SELECT id, nome FROM sentir_agir_categorias WHERE ativo = TRUE ORDER BY ordem
        """)
        categorias = cursor.fetchall()

        cursor.execute("""
            SELECT id, nome, sigla FROM sentir_agir_setores WHERE ativo = TRUE ORDER BY ordem
        """)
        setores = cursor.fetchall()

        cursor.execute("""
            SELECT id, nome, cargo FROM sentir_agir_responsaveis WHERE ativo = TRUE ORDER BY nome
        """)
        responsaveis = cursor.fetchall()

        cursor.close()
        conn.close()

        return jsonify({
            'success': True,
            'data': {
                'categorias': [serializar_linha(c) for c in categorias],
                'setores': [serializar_linha(s) for s in setores],
                'responsaveis': [serializar_linha(r) for r in responsaveis],
                'status': ['pendente', 'em_tratativa', 'regularizado', 'cancelado']
            }
        })
    except Exception as e:
        traceback.print_exc()
        return jsonify({'success': False, 'error': str(e)}), 500


# ============================================================
# API: RESPONSÁVEIS - CRUD
# ============================================================

@painel30_bp.route('/api/paineis/painel30/responsaveis', methods=['GET'])
@login_required
def listar_responsaveis():
    try:
        conn = get_db_connection()
        cursor = conn.cursor(cursor_factory=RealDictCursor)

        todas = request.args.get('todas', '0')
        sql = """
            SELECT r.id, r.nome, r.email, r.telefone, r.cargo,
                   r.categoria_id, c.nome AS categoria_nome,
                   r.setor_id, s.nome AS setor_nome,
                   r.observacoes, r.ativo, r.criado_em
            FROM sentir_agir_responsaveis r
            LEFT JOIN sentir_agir_categorias c ON c.id = r.categoria_id
            LEFT JOIN sentir_agir_setores s ON s.id = r.setor_id
        """
        if todas != '1':
            sql += " WHERE r.ativo = TRUE"
        sql += " ORDER BY r.nome"

        cursor.execute(sql)
        rows = cursor.fetchall()
        cursor.close()
        conn.close()

        return jsonify({'success': True, 'data': [serializar_linha(r) for r in rows]})
    except Exception as e:
        traceback.print_exc()
        return jsonify({'success': False, 'error': str(e)}), 500


@painel30_bp.route('/api/paineis/painel30/responsaveis', methods=['POST'])
@login_required
def criar_responsavel():
    try:
        if not _is_admin():
            return jsonify({'success': False, 'error': 'Apenas administradores'}), 403

        dados = request.get_json()
        if not dados:
            return jsonify({'success': False, 'error': 'Dados nao fornecidos'}), 400

        nome = (dados.get('nome') or '').strip()
        if not nome:
            return jsonify({'success': False, 'error': 'Nome obrigatorio'}), 400

        email = (dados.get('email') or '').strip() or None
        telefone = (dados.get('telefone') or '').strip() or None
        cargo = (dados.get('cargo') or '').strip() or None
        categoria_id = dados.get('categoria_id')
        setor_id = dados.get('setor_id')
        observacoes = (dados.get('observacoes') or '').strip() or None

        usuario = _get_usuario()
        ip = _get_ip()

        conn = get_db_connection()
        cursor = conn.cursor(cursor_factory=RealDictCursor)

        cursor.execute("""
            INSERT INTO sentir_agir_responsaveis
                (nome, email, telefone, cargo, categoria_id, setor_id, observacoes, ativo)
            VALUES (%s, %s, %s, %s, %s, %s, %s, TRUE)
            RETURNING id
        """, (nome, email, telefone, cargo, categoria_id, setor_id, observacoes))
        resp_id = cursor.fetchone()['id']

        _registrar_log(cursor, 'responsavel', resp_id, 'criacao', usuario, ip_origem=ip)

        conn.commit()
        cursor.close()
        conn.close()

        return jsonify({'success': True, 'data': {'id': resp_id}, 'message': 'Responsavel criado'}), 201
    except Exception as e:
        traceback.print_exc()
        return jsonify({'success': False, 'error': str(e)}), 500


@painel30_bp.route('/api/paineis/painel30/responsaveis/<int:resp_id>', methods=['PUT'])
@login_required
def editar_responsavel(resp_id):
    try:
        if not _is_admin():
            return jsonify({'success': False, 'error': 'Apenas administradores'}), 403

        dados = request.get_json()
        if not dados:
            return jsonify({'success': False, 'error': 'Dados nao fornecidos'}), 400

        usuario = _get_usuario()
        ip = _get_ip()

        conn = get_db_connection()
        cursor = conn.cursor(cursor_factory=RealDictCursor)

        cursor.execute("SELECT * FROM sentir_agir_responsaveis WHERE id = %s", (resp_id,))
        resp = cursor.fetchone()
        if not resp:
            cursor.close()
            conn.close()
            return jsonify({'success': False, 'error': 'Responsavel nao encontrado'}), 404

        sets = []
        params = []
        campos = ['nome', 'email', 'telefone', 'cargo', 'categoria_id', 'setor_id', 'observacoes']
        for campo in campos:
            if campo in dados:
                valor = dados[campo]
                if isinstance(valor, str):
                    valor = valor.strip() or None
                sets.append(campo + " = %s")
                params.append(valor)

        if not sets:
            cursor.close()
            conn.close()
            return jsonify({'success': True, 'message': 'Nenhuma alteracao'})

        sets.append("atualizado_em = NOW()")
        params.append(resp_id)

        cursor.execute(
            "UPDATE sentir_agir_responsaveis SET " + ", ".join(sets) + " WHERE id = %s",
            params
        )

        _registrar_log(cursor, 'responsavel', resp_id, 'edicao', usuario, ip_origem=ip)

        conn.commit()
        cursor.close()
        conn.close()

        return jsonify({'success': True, 'message': 'Responsavel atualizado'})
    except Exception as e:
        traceback.print_exc()
        return jsonify({'success': False, 'error': str(e)}), 500


@painel30_bp.route('/api/paineis/painel30/responsaveis/<int:resp_id>/toggle', methods=['PUT'])
@login_required
def toggle_responsavel(resp_id):
    try:
        if not _is_admin():
            return jsonify({'success': False, 'error': 'Apenas administradores'}), 403

        usuario = _get_usuario()
        ip = _get_ip()

        conn = get_db_connection()
        cursor = conn.cursor(cursor_factory=RealDictCursor)

        cursor.execute("SELECT id, ativo FROM sentir_agir_responsaveis WHERE id = %s", (resp_id,))
        resp = cursor.fetchone()
        if not resp:
            cursor.close()
            conn.close()
            return jsonify({'success': False, 'error': 'Responsavel nao encontrado'}), 404

        novo_status = not resp['ativo']
        cursor.execute("""
            UPDATE sentir_agir_responsaveis
            SET ativo = %s, atualizado_em = NOW()
            WHERE id = %s
        """, (novo_status, resp_id))

        _registrar_log(
            cursor, 'responsavel', resp_id, 'alteracao_status', usuario,
            campo_alterado='ativo',
            valor_anterior=str(resp['ativo']),
            valor_novo=str(novo_status),
            ip_origem=ip
        )

        conn.commit()
        cursor.close()
        conn.close()

        msg = 'Responsavel ativado' if novo_status else 'Responsavel desativado'
        return jsonify({'success': True, 'message': msg})
    except Exception as e:
        traceback.print_exc()
        return jsonify({'success': False, 'error': str(e)}), 500