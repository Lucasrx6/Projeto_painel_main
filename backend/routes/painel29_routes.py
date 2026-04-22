# ============================================================
# PAINEL 29 - GESTÃO SENTIR E AGIR
# Hospital Anchieta Ceilândia
# Dashboard, Listagem, Edição (admin), Export Excel
# ============================================================

import os
import io
import traceback
from datetime import datetime, date, timedelta
from decimal import Decimal
from flask import Blueprint, request, jsonify, send_from_directory, send_file, session, current_app
from psycopg2.extras import RealDictCursor
from backend.database import get_db_connection
from backend.middleware.decorators import login_required
from backend.user_management import verificar_permissao_painel

painel29_bp = Blueprint('painel29', __name__)


# ============================================================
# HELPERS
# ============================================================

def _get_ip():
    return request.headers.get('X-Forwarded-For', request.remote_addr)


def _get_usuario():
    return session.get('usuario', 'sistema')


def _is_admin():
    return session.get('is_admin', False)


def _extrair_obs_item_str(descricao_problema):
    if not descricao_problema:
        return None
    if ' | Observacao do item: ' in descricao_problema:
        return descricao_problema.split(' | Observacao do item: ', 1)[1].strip()
    return None


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


def _parse_multi_param(param_name):
    raw = request.args.get(param_name, None)
    if not raw or raw.strip() == '':
        return None
    valores = [v.strip() for v in raw.split(',') if v.strip()]
    return valores if valores else None


def _build_common_filters():
    """Constrói filtros compartilhados entre dashboard e dados."""
    condicoes = ["r.status != 'cancelada'"]
    params = []

    # Periodo
    dias = request.args.get('dias', None)
    dt_inicio = request.args.get('dt_inicio', None)
    dt_fim = request.args.get('dt_fim', None)

    if dt_inicio:
        condicoes.append("r.data_ronda >= %s")
        params.append(dt_inicio)
    if dt_fim:
        condicoes.append("r.data_ronda <= %s")
        params.append(dt_fim)
    if dias and not dt_inicio and not dt_fim:
        condicoes.append("r.data_ronda >= CURRENT_DATE - %s * INTERVAL '1 day'")
        params.append(int(dias))

    # Setor
    setores = _parse_multi_param('setor')
    if setores:
        placeholders = ','.join(['%s'] * len(setores))
        condicoes.append("s.nome IN (" + placeholders + ")")
        params.extend(setores)

    # Dupla
    duplas = _parse_multi_param('dupla')
    if duplas:
        placeholders = ','.join(['%s'] * len(duplas))
        condicoes.append("d.id::text IN (" + placeholders + ")")
        params.extend(duplas)

    # Avaliação final
    avaliacoes = _parse_multi_param('avaliacao')
    if avaliacoes:
        placeholders = ','.join(['%s'] * len(avaliacoes))
        condicoes.append("v.avaliacao_final IN (" + placeholders + ")")
        params.extend(avaliacoes)

    # Status da ronda
    status_ronda = _parse_multi_param('status_ronda')
    if status_ronda:
        # Remove o filtro padrão de cancelada e usa o filtro do usuário
        condicoes = [c for c in condicoes if c != "r.status != 'cancelada'"]
        placeholders = ','.join(['%s'] * len(status_ronda))
        condicoes.append("r.status IN (" + placeholders + ")")
        params.extend(status_ronda)

    # Filtro por status de tratativa
    status_trat = request.args.get('status_trat', '').strip()
    if status_trat:
        condicoes.append("""EXISTS (
            SELECT 1 FROM sentir_agir_tratativas t2
            WHERE t2.visita_id = v.id AND t2.status = %s
        )""")
        params.append(status_trat)

    # Busca livre
    busca = request.args.get('busca', '').strip()
    if busca:
        condicoes.append("""(
            v.leito ILIKE %s OR
            v.nr_atendimento ILIKE %s OR
            v.observacoes ILIKE %s OR
            s.nome ILIKE %s OR
            d.nome_visitante_1 ILIKE %s OR
            d.nome_visitante_2 ILIKE %s
        )""")
        termo = '%' + busca + '%'
        params.extend([termo] * 6)

    return condicoes, params


# ============================================================
# ROTAS HTML / ESTÁTICOS
# ============================================================

@painel29_bp.route('/painel/painel29')
@login_required
def painel29():
    usuario_id = session.get('usuario_id')
    is_admin = session.get('is_admin', False)
    if not is_admin:
        if not verificar_permissao_painel(usuario_id, 'painel29'):
            return send_from_directory('frontend', 'acesso-negado.html')
    return send_from_directory('paineis/painel29', 'index.html')


@painel29_bp.route('/paineis/painel29/<path:filename>')
@login_required
def painel29_static(filename):
    return send_from_directory('paineis/painel29', filename)


# ============================================================
# API: DASHBOARD (KPIs)
# ============================================================

@painel29_bp.route('/api/paineis/painel29/dashboard', methods=['GET'])
@login_required
def dashboard():
    try:
        conn = get_db_connection()
        cursor = conn.cursor(cursor_factory=RealDictCursor)

        condicoes, params = _build_common_filters()
        where = " AND ".join(condicoes) if condicoes else "TRUE"

        sql = """
            SELECT
                COUNT(DISTINCT v.id) AS total_visitas,
                COUNT(DISTINCT r.id) AS total_rondas,
                COUNT(DISTINCT v.leito) AS total_leitos,
                COUNT(DISTINCT r.dupla_id) AS total_duplas_ativas,
                SUM(CASE WHEN v.avaliacao_final = 'critico' THEN 1 ELSE 0 END) AS total_criticos,
                SUM(CASE WHEN v.avaliacao_final = 'atencao' THEN 1 ELSE 0 END) AS total_atencao,
                SUM(CASE WHEN v.avaliacao_final = 'adequado' THEN 1 ELSE 0 END) AS total_adequados,
                (SELECT COUNT(*) FROM sentir_agir_imagens i2
                 JOIN sentir_agir_visitas v2 ON v2.id = i2.visita_id
                 JOIN sentir_agir_rondas r2 ON r2.id = v2.ronda_id
                 WHERE r2.status != 'cancelada') AS total_imagens
            FROM sentir_agir_visitas v
            JOIN sentir_agir_rondas r ON r.id = v.ronda_id
            JOIN sentir_agir_setores s ON s.id = v.setor_id
            JOIN sentir_agir_duplas d ON d.id = r.dupla_id
            WHERE """ + where

        cursor.execute(sql, params)
        stats = cursor.fetchone()

        # KPIs de tratativas (filtradas pelo mesmo período via join)
        cursor.execute("""
            SELECT
                COUNT(*) AS trat_total,
                SUM(CASE WHEN t.status = 'pendente' THEN 1 ELSE 0 END) AS trat_pendentes,
                SUM(CASE WHEN t.status = 'em_tratativa' THEN 1 ELSE 0 END) AS trat_em_tratativa,
                SUM(CASE WHEN t.status = 'regularizado' THEN 1 ELSE 0 END) AS trat_regularizadas,
                SUM(CASE WHEN t.status = 'impossibilitado' THEN 1 ELSE 0 END) AS trat_impossibilitados,
                SUM(CASE WHEN t.status = 'cancelado' THEN 1 ELSE 0 END) AS trat_canceladas
            FROM sentir_agir_tratativas t
            JOIN sentir_agir_visitas v ON v.id = t.visita_id
            JOIN sentir_agir_rondas r ON r.id = v.ronda_id
            JOIN sentir_agir_setores s ON s.id = v.setor_id
            JOIN sentir_agir_duplas d ON d.id = r.dupla_id
            WHERE """ + where, params)
        stats_trat = cursor.fetchone()

        # Top 5 itens mais críticos (ranking)
        cursor.execute("""
            SELECT
                i.descricao AS item,
                c.nome AS categoria,
                COUNT(*) FILTER (WHERE a.resultado = 'critico') AS qtd_critico,
                COUNT(*) FILTER (WHERE a.resultado != 'nao_aplica') AS qtd_total,
                ROUND(
                    100.0 * COUNT(*) FILTER (WHERE a.resultado = 'critico') /
                    NULLIF(COUNT(*) FILTER (WHERE a.resultado != 'nao_aplica'), 0), 1
                ) AS pct_critico
            FROM sentir_agir_avaliacoes a
            JOIN sentir_agir_itens i ON i.id = a.item_id
            JOIN sentir_agir_categorias c ON c.id = i.categoria_id
            JOIN sentir_agir_visitas v ON v.id = a.visita_id
            JOIN sentir_agir_rondas r ON r.id = v.ronda_id
            WHERE r.status != 'cancelada'
            GROUP BY i.descricao, c.nome
            HAVING COUNT(*) FILTER (WHERE a.resultado = 'critico') > 0
            ORDER BY qtd_critico DESC, pct_critico DESC
            LIMIT 5
        """)
        top_criticos = [serializar_linha(r) for r in cursor.fetchall()]

        cursor.close()
        conn.close()

        resultado = serializar_linha(stats) if stats else {}
        resultado['top_criticos'] = top_criticos
        resultado['is_admin'] = _is_admin()

        # Mesclar KPIs de tratativas
        if stats_trat:
            trat = serializar_linha(stats_trat)
            resultado['trat_total'] = trat.get('trat_total', 0) or 0
            resultado['trat_pendentes'] = trat.get('trat_pendentes', 0) or 0
            resultado['trat_em_tratativa'] = trat.get('trat_em_tratativa', 0) or 0
            resultado['trat_regularizadas'] = trat.get('trat_regularizadas', 0) or 0
            resultado['trat_impossibilitados'] = trat.get('trat_impossibilitados', 0) or 0

        return jsonify({'success': True, 'data': resultado})
    except Exception as e:
        traceback.print_exc()
        return jsonify({'success': False, 'error': str(e)}), 500


# ============================================================
# API: DADOS (Listagem com filtros)
# ============================================================

@painel29_bp.route('/api/paineis/painel29/dados', methods=['GET'])
@login_required
def dados():
    try:
        conn = get_db_connection()
        cursor = conn.cursor(cursor_factory=RealDictCursor)

        condicoes, params = _build_common_filters()
        where = " AND ".join(condicoes) if condicoes else "TRUE"

        sql = """
            SELECT
                v.id AS visita_id,
                r.id AS ronda_id,
                r.data_ronda,
                r.status AS status_ronda,
                r.criado_por,
                d.id AS dupla_id,
                d.nome_visitante_1 || ' e ' || d.nome_visitante_2 AS dupla_nome,
                s.nome AS setor_nome,
                s.sigla AS setor_sigla,
                v.leito,
                v.nr_atendimento,
                v.nm_paciente,
                v.avaliacao_final,
                v.observacoes,
                v.criado_em,
                v.status_tratativa,
                (SELECT COUNT(*) FROM sentir_agir_avaliacoes a
                 WHERE a.visita_id = v.id AND a.resultado = 'critico') AS qtd_critico,
                (SELECT COUNT(*) FROM sentir_agir_avaliacoes a
                 WHERE a.visita_id = v.id AND a.resultado = 'atencao') AS qtd_atencao,
                (SELECT COUNT(*) FROM sentir_agir_avaliacoes a
                 WHERE a.visita_id = v.id AND a.resultado = 'adequado') AS qtd_adequado,
                (SELECT COUNT(*) FROM sentir_agir_avaliacoes a
                 WHERE a.visita_id = v.id AND a.resultado = 'nao_aplica') AS qtd_nao_aplica,
                (SELECT COUNT(*) FROM sentir_agir_imagens i
                 WHERE i.visita_id = v.id) AS qtd_imagens,
                (SELECT COUNT(*) FROM sentir_agir_tratativas t
                 WHERE t.visita_id = v.id) AS trat_total,
                (SELECT COUNT(*) FROM sentir_agir_tratativas t
                 WHERE t.visita_id = v.id AND t.status = 'pendente') AS trat_pendentes,
                (SELECT COUNT(*) FROM sentir_agir_tratativas t
                 WHERE t.visita_id = v.id AND t.status = 'em_tratativa') AS trat_em_tratativa,
                (SELECT COUNT(*) FROM sentir_agir_tratativas t
                 WHERE t.visita_id = v.id AND t.status = 'regularizado') AS trat_regularizadas
            FROM sentir_agir_visitas v
            JOIN sentir_agir_rondas r ON r.id = v.ronda_id
            JOIN sentir_agir_setores s ON s.id = v.setor_id
            JOIN sentir_agir_duplas d ON d.id = r.dupla_id
            WHERE """ + where + """
            ORDER BY r.data_ronda DESC, v.criado_em DESC
        """

        cursor.execute(sql, params)
        rows = cursor.fetchall()

        cursor.close()
        conn.close()

        dados_serializados = [serializar_linha(r) for r in rows]

        return jsonify({
            'success': True,
            'data': dados_serializados,
            'total': len(dados_serializados),
            'is_admin': _is_admin()
        })
    except Exception as e:
        traceback.print_exc()
        return jsonify({'success': False, 'error': str(e)}), 500


# ============================================================
# API: FILTROS (valores distintos)
# ============================================================

@painel29_bp.route('/api/paineis/painel29/filtros', methods=['GET'])
@login_required
def filtros():
    try:
        conn = get_db_connection()
        cursor = conn.cursor(cursor_factory=RealDictCursor)

        # Setores
        cursor.execute("""
            SELECT DISTINCT s.nome
            FROM sentir_agir_setores s
            JOIN sentir_agir_visitas v ON v.setor_id = s.id
            ORDER BY s.nome
        """)
        setores = [r['nome'] for r in cursor.fetchall()]

        # Duplas
        cursor.execute("""
            SELECT DISTINCT d.id, d.nome_visitante_1 || ' e ' || d.nome_visitante_2 AS nome
            FROM sentir_agir_duplas d
            JOIN sentir_agir_rondas r ON r.dupla_id = d.id
            ORDER BY nome
        """)
        duplas = cursor.fetchall()

        # Avaliações
        avaliacoes = ['critico', 'atencao', 'adequado']

        # Status ronda
        status_ronda = ['em_andamento', 'concluida', 'cancelada']

        cursor.close()
        conn.close()

        return jsonify({
            'success': True,
            'data': {
                'setores': setores,
                'duplas': [serializar_linha(d) for d in duplas],
                'avaliacoes': avaliacoes,
                'status_ronda': status_ronda
            }
        })
    except Exception as e:
        traceback.print_exc()
        return jsonify({'success': False, 'error': str(e)}), 500


# ============================================================
# API: DETALHE DE VISITA (reusa lógica do P28)
# ============================================================

@painel29_bp.route('/api/paineis/painel29/visitas/<int:visita_id>', methods=['GET'])
@login_required
def detalhe_visita(visita_id):
    try:
        conn = get_db_connection()
        cursor = conn.cursor(cursor_factory=RealDictCursor)

        cursor.execute("""
            SELECT
                v.id, v.ronda_id, v.leito, v.nr_atendimento,
                v.observacoes, v.avaliacao_final, v.setor_id,
                v.criado_em, v.atualizado_em,
                s.nome AS setor_nome, s.sigla AS setor_sigla,
                r.data_ronda, r.status AS status_ronda,
                d.nome_visitante_1 || ' e ' || d.nome_visitante_2 AS dupla_nome
            FROM sentir_agir_visitas v
            JOIN sentir_agir_setores s ON s.id = v.setor_id
            JOIN sentir_agir_rondas r ON r.id = v.ronda_id
            JOIN sentir_agir_duplas d ON d.id = r.dupla_id
            WHERE v.id = %s
        """, (visita_id,))
        visita = cursor.fetchone()

        if not visita:
            cursor.close()
            conn.close()
            return jsonify({'success': False, 'error': 'Visita nao encontrada'}), 404

        # Avaliações agrupadas por categoria (inclui tratativa_id e obs_item)
        cursor.execute("""
            SELECT
                a.id AS avaliacao_id, a.item_id, a.resultado,
                i.descricao AS item_descricao, i.ordem AS item_ordem,
                c.id AS categoria_id, c.nome AS categoria_nome,
                c.icone AS categoria_icone, c.cor AS categoria_cor,
                c.ordem AS categoria_ordem, c.permite_nao_aplica,
                (SELECT t.id FROM sentir_agir_tratativas t
                 WHERE t.visita_id = a.visita_id AND t.item_id = a.item_id
                   AND t.status NOT IN ('cancelado') ORDER BY t.id LIMIT 1) AS tratativa_id,
                (SELECT t.descricao_problema FROM sentir_agir_tratativas t
                 WHERE t.visita_id = a.visita_id AND t.item_id = a.item_id
                   AND t.status NOT IN ('cancelado') ORDER BY t.id LIMIT 1) AS trat_descricao_problema
            FROM sentir_agir_avaliacoes a
            JOIN sentir_agir_itens i ON i.id = a.item_id
            JOIN sentir_agir_categorias c ON c.id = i.categoria_id
            WHERE a.visita_id = %s
            ORDER BY c.ordem, i.ordem
        """, (visita_id,))
        avaliacoes_raw = cursor.fetchall()

        # Imagens
        cursor.execute("""
            SELECT id, caminho_arquivo, nome_original, descricao, criado_em
            FROM sentir_agir_imagens WHERE visita_id = %s ORDER BY criado_em
        """, (visita_id,))
        imagens = cursor.fetchall()

        # Tratativas desta visita
        cursor.execute("""
            SELECT
                t.id AS tratativa_id,
                t.status,
                t.prioridade,
                t.descricao_problema,
                t.plano_acao,
                t.data_resolucao,
                t.criado_em,
                i.descricao AS item_descricao,
                c.nome AS categoria_nome,
                c.icone AS categoria_icone,
                COALESCE(r.nome, t.responsavel_nome_manual, 'Sem responsavel') AS responsavel_display
            FROM sentir_agir_tratativas t
            JOIN sentir_agir_itens i ON i.id = t.item_id
            JOIN sentir_agir_categorias c ON c.id = t.categoria_id
            LEFT JOIN sentir_agir_responsaveis r ON r.id = t.responsavel_id
            WHERE t.visita_id = %s
            ORDER BY
                CASE t.status
                    WHEN 'pendente' THEN 1
                    WHEN 'em_tratativa' THEN 2
                    WHEN 'regularizado' THEN 3
                    WHEN 'cancelado' THEN 4
                END,
                t.criado_em
        """, (visita_id,))
        tratativas = cursor.fetchall()

        # Log de alterações desta visita
        cursor.execute("""
            SELECT acao, campo_alterado, valor_anterior, valor_novo, usuario, criado_em
            FROM sentir_agir_log
            WHERE entidade = 'visita' AND entidade_id = %s
            ORDER BY criado_em DESC LIMIT 20
        """, (visita_id,))
        historico = cursor.fetchall()

        cursor.close()
        conn.close()

        # Serializar visita
        visita_dict = serializar_linha(visita)

        # Agrupar avaliações
        categorias = []
        cat_atual = None
        for av in avaliacoes_raw:
            if cat_atual is None or cat_atual['id'] != av['categoria_id']:
                cat_atual = {
                    'id': av['categoria_id'],
                    'nome': av['categoria_nome'],
                    'icone': av['categoria_icone'],
                    'cor': av['categoria_cor'],
                    'permite_nao_aplica': av['permite_nao_aplica'],
                    'itens': []
                }
                categorias.append(cat_atual)
            cat_atual['itens'].append({
                'avaliacao_id': av['avaliacao_id'],
                'item_id': av['item_id'],
                'descricao': av['item_descricao'],
                'resultado': av['resultado'],
                'tratativa_id': av['tratativa_id'],
                'obs_item': _extrair_obs_item_str(av.get('trat_descricao_problema'))
            })

        visita_dict['categorias'] = categorias
        visita_dict['imagens'] = [
            dict(serializar_linha(img), url='/api/paineis/painel28/imagens/%d' % img['id'])
            for img in imagens
        ]
        visita_dict['tratativas'] = [serializar_linha(t) for t in tratativas]
        visita_dict['historico'] = [serializar_linha(h) for h in historico]
        visita_dict['is_admin'] = _is_admin()

        return jsonify({'success': True, 'data': visita_dict})
    except Exception as e:
        traceback.print_exc()
        return jsonify({'success': False, 'error': str(e)}), 500


# ============================================================
# API: EDITAR VISITA (apenas admin)
# ============================================================

@painel29_bp.route('/api/paineis/painel29/visitas/<int:visita_id>', methods=['PUT'])
@login_required
def editar_visita(visita_id):
    """Edita uma visita. Acessivel a qualquer usuario logado."""
    try:
        dados = request.get_json()
        if not dados:
            return jsonify({'success': False, 'error': 'Dados nao fornecidos'}), 400

        usuario = _get_usuario()
        ip = _get_ip()

        conn = get_db_connection()
        cursor = conn.cursor(cursor_factory=RealDictCursor)

        # Verificar visita
        cursor.execute("SELECT * FROM sentir_agir_visitas WHERE id = %s", (visita_id,))
        visita = cursor.fetchone()
        if not visita:
            cursor.close()
            conn.close()
            return jsonify({'success': False, 'error': 'Visita nao encontrada'}), 404

        # Verificar bloqueio por tempo
        cursor.execute("SELECT valor FROM sentir_agir_config WHERE chave = 'dias_bloquear_edicao'")
        config_dias = cursor.fetchone()
        if config_dias and config_dias['valor'] != '0':
            dias_bloqueio = int(config_dias['valor'])
            if visita['criado_em']:
                limite = visita['criado_em'] + timedelta(days=dias_bloqueio)
                if datetime.now() > limite:
                    cursor.close()
                    conn.close()
                    return jsonify({
                        'success': False,
                        'error': 'Edicao bloqueada. Prazo de %d dias expirado.' % dias_bloqueio
                    }), 403

        alteracoes = []

        # Atualizar campos básicos
        campos_editaveis = {
            'leito': 'leito',
            'nr_atendimento': 'nr_atendimento',
            'observacoes': 'observacoes',
            'avaliacao_final': 'avaliacao_final',
            'setor_id': 'setor_id'
        }

        sets = []
        set_params = []

        for campo_json, campo_db in campos_editaveis.items():
            if campo_json in dados:
                novo_valor = dados[campo_json]
                antigo_valor = visita.get(campo_db)

                if str(novo_valor) != str(antigo_valor):
                    sets.append(campo_db + " = %s")
                    set_params.append(novo_valor)
                    alteracoes.append({
                        'campo': campo_db,
                        'anterior': str(antigo_valor),
                        'novo': str(novo_valor)
                    })

        if sets:
            sets.append("atualizado_em = NOW()")
            set_params.append(visita_id)
            cursor.execute(
                "UPDATE sentir_agir_visitas SET " + ", ".join(sets) + " WHERE id = %s",
                set_params
            )

        # Atualizar avaliações individuais e obs_item das críticas
        if 'avaliacoes' in dados and isinstance(dados['avaliacoes'], list):
            for av in dados['avaliacoes']:
                av_id = av.get('avaliacao_id')
                novo_resultado = av.get('resultado')
                trat_id = av.get('tratativa_id')
                novo_obs = (av.get('obs_item') or '').strip() or None

                if av_id and novo_resultado:
                    cursor.execute(
                        "SELECT resultado FROM sentir_agir_avaliacoes WHERE id = %s AND visita_id = %s",
                        (av_id, visita_id)
                    )
                    av_atual = cursor.fetchone()
                    if av_atual and av_atual['resultado'] != novo_resultado:
                        cursor.execute(
                            "UPDATE sentir_agir_avaliacoes SET resultado = %s WHERE id = %s",
                            (novo_resultado, av_id)
                        )
                        alteracoes.append({
                            'campo': 'avaliacao_' + str(av_id),
                            'anterior': av_atual['resultado'],
                            'novo': novo_resultado
                        })

                # Atualizar obs_item na tratativa, se fornecido
                if trat_id and 'obs_item' in av:
                    cursor.execute(
                        "SELECT descricao_problema FROM sentir_agir_tratativas WHERE id = %s AND visita_id = %s",
                        (trat_id, visita_id)
                    )
                    trat = cursor.fetchone()
                    if trat:
                        desc_atual = trat['descricao_problema'] or ''
                        obs_atual = _extrair_obs_item_str(desc_atual)
                        if obs_atual != novo_obs:
                            if ' | Observacao do item: ' in desc_atual:
                                base_desc = desc_atual.split(' | Observacao do item: ')[0]
                            elif ' | Observacao da visita: ' in desc_atual:
                                base_desc = desc_atual.split(' | Observacao da visita: ')[0]
                            else:
                                base_desc = desc_atual
                            nova_desc = base_desc + (' | Observacao do item: ' + novo_obs if novo_obs else '')
                            cursor.execute(
                                "UPDATE sentir_agir_tratativas SET descricao_problema = %s WHERE id = %s",
                                (nova_desc, trat_id)
                            )
                            alteracoes.append({
                                'campo': 'obs_critica_trat_' + str(trat_id),
                                'anterior': obs_atual or '',
                                'novo': novo_obs or ''
                            })

        # Registrar logs
        for alt in alteracoes:
            _registrar_log(
                cursor, 'visita', visita_id, 'edicao', usuario,
                campo_alterado=alt['campo'],
                valor_anterior=alt['anterior'],
                valor_novo=alt['novo'],
                ip_origem=ip
            )

        conn.commit()
        cursor.close()
        conn.close()

        return jsonify({
            'success': True,
            'message': 'Visita atualizada. %d campo(s) alterado(s).' % len(alteracoes),
            'alteracoes': len(alteracoes)
        })
    except Exception as e:
        traceback.print_exc()
        return jsonify({'success': False, 'error': str(e)}), 500


# ============================================================
# API: ALTERAR STATUS DA RONDA (qualquer usuário logado)
# ============================================================

@painel29_bp.route('/api/paineis/painel29/rondas/<int:ronda_id>/status', methods=['PUT'])
@login_required
def alterar_status_ronda(ronda_id):
    """Altera o status de uma ronda. Acessível a qualquer usuário logado."""
    try:
        dados = request.get_json()
        if not dados:
            return jsonify({'success': False, 'error': 'Dados nao fornecidos'}), 400

        novo_status = dados.get('status', '').strip()
        status_validos = ('em_andamento', 'concluida', 'cancelada')
        if novo_status not in status_validos:
            return jsonify({'success': False, 'error': 'Status invalido. Use: ' + ', '.join(status_validos)}), 400

        usuario = _get_usuario()
        ip = _get_ip()
        conn = get_db_connection()
        cursor = conn.cursor(cursor_factory=RealDictCursor)

        cursor.execute("SELECT id, status FROM sentir_agir_rondas WHERE id = %s", (ronda_id,))
        ronda = cursor.fetchone()
        if not ronda:
            cursor.close()
            conn.close()
            return jsonify({'success': False, 'error': 'Ronda nao encontrada'}), 404

        if ronda['status'] == novo_status:
            cursor.close()
            conn.close()
            return jsonify({'success': True, 'message': 'Ronda ja esta com o status ' + novo_status})

        cursor.execute(
            "UPDATE sentir_agir_rondas SET status = %s, atualizado_em = NOW() WHERE id = %s",
            (novo_status, ronda_id)
        )
        _registrar_log(cursor, 'ronda', ronda_id, 'alteracao_status', usuario,
                       campo_alterado='status',
                       valor_anterior=ronda['status'],
                       valor_novo=novo_status,
                       ip_origem=ip)
        conn.commit()
        cursor.close()
        conn.close()

        labels = {'em_andamento': 'Em andamento', 'concluida': 'Concluida', 'cancelada': 'Cancelada'}
        return jsonify({'success': True, 'message': 'Status alterado para: ' + labels.get(novo_status, novo_status)})
    except Exception as e:
        traceback.print_exc()
        return jsonify({'success': False, 'error': str(e)}), 500


# ============================================================
# API: EXPORTAR EXCEL
# ============================================================

@painel29_bp.route('/api/paineis/painel29/exportar', methods=['GET'])
@login_required
def exportar_excel():
    """Exporta dados filtrados para Excel."""
    try:
        conn = get_db_connection()
        cursor = conn.cursor(cursor_factory=RealDictCursor)

        condicoes, params = _build_common_filters()
        where = " AND ".join(condicoes) if condicoes else "TRUE"

        # Dados principais
        sql = """
            SELECT
                r.data_ronda AS "Data Ronda",
                d.nome_visitante_1 || ' e ' || d.nome_visitante_2 AS "Dupla",
                s.nome AS "Setor",
                v.leito AS "Leito",
                v.nr_atendimento AS "Nr Atendimento",
                v.avaliacao_final AS "Avaliação Final",
                r.status AS "Status Ronda",
                v.observacoes AS "Observações",
                v.criado_em AS "Data Registro",
                (SELECT COUNT(*) FROM sentir_agir_avaliacoes a
                 WHERE a.visita_id = v.id AND a.resultado = 'critico') AS "Qtd Crítico",
                (SELECT COUNT(*) FROM sentir_agir_avaliacoes a
                 WHERE a.visita_id = v.id AND a.resultado = 'atencao') AS "Qtd Atenção",
                (SELECT COUNT(*) FROM sentir_agir_avaliacoes a
                 WHERE a.visita_id = v.id AND a.resultado = 'adequado') AS "Qtd Adequado",
                (SELECT COUNT(*) FROM sentir_agir_imagens i
                 WHERE i.visita_id = v.id) AS "Qtd Imagens"
            FROM sentir_agir_visitas v
            JOIN sentir_agir_rondas r ON r.id = v.ronda_id
            JOIN sentir_agir_setores s ON s.id = v.setor_id
            JOIN sentir_agir_duplas d ON d.id = r.dupla_id
            WHERE """ + where + """
            ORDER BY r.data_ronda DESC, v.criado_em DESC
        """

        cursor.execute(sql, params)
        rows = cursor.fetchall()

        cursor.close()
        conn.close()

        if not rows:
            return jsonify({'success': False, 'error': 'Nenhum dado para exportar'}), 404

        # Gerar CSV (compatível com Excel, sem dependência de openpyxl)
        output = io.StringIO()
        # BOM para Excel reconhecer UTF-8
        output.write('\ufeff')

        # Header
        colunas = list(rows[0].keys())
        output.write(';'.join(colunas) + '\n')

        # Dados
        for row in rows:
            valores = []
            for col in colunas:
                val = row[col]
                if val is None:
                    valores.append('')
                elif isinstance(val, (datetime, date)):
                    valores.append(val.strftime('%d/%m/%Y %H:%M') if isinstance(val, datetime) else val.strftime('%d/%m/%Y'))
                else:
                    valores.append(str(val).replace(';', ',').replace('\n', ' ').replace('\r', ''))
            output.write(';'.join(valores) + '\n')

        output.seek(0)
        bytes_output = io.BytesIO(output.getvalue().encode('utf-8'))

        nome_arquivo = 'sentir_agir_%s.csv' % datetime.now().strftime('%Y%m%d_%H%M%S')

        return send_file(
            bytes_output,
            mimetype='text/csv; charset=utf-8',
            as_attachment=True,
            download_name=nome_arquivo
        )
    except Exception as e:
        traceback.print_exc()
        return jsonify({'success': False, 'error': str(e)}), 500


# ============================================================
# API: CONFIGURAÇÕES DO PAINEL
# ============================================================

@painel29_bp.route('/api/paineis/painel29/config', methods=['GET'])
@login_required
def obter_config():
    try:
        conn = get_db_connection()
        cursor = conn.cursor(cursor_factory=RealDictCursor)
        cursor.execute("SELECT chave, valor FROM sentir_agir_config")
        rows = cursor.fetchall()
        cursor.close()
        conn.close()

        config = {}
        for row in rows:
            config[row['chave']] = row['valor']
        config['is_admin'] = _is_admin()

        return jsonify({'success': True, 'data': config})
    except Exception as e:
        traceback.print_exc()
        return jsonify({'success': False, 'error': str(e)}), 500


@painel29_bp.route('/api/paineis/painel29/config', methods=['PUT'])
@login_required
def atualizar_config():
    """Atualiza configurações. Apenas admin."""
    if not _is_admin():
        return jsonify({'success': False, 'error': 'Apenas administradores'}), 403

    try:
        dados = request.get_json()
        chave = dados.get('chave', '').strip()
        valor = dados.get('valor', '').strip()

        if not chave:
            return jsonify({'success': False, 'error': 'Chave obrigatoria'}), 400

        conn = get_db_connection()
        cursor = conn.cursor(cursor_factory=RealDictCursor)

        cursor.execute("SELECT valor FROM sentir_agir_config WHERE chave = %s", (chave,))
        atual = cursor.fetchone()

        if atual:
            cursor.execute(
                "UPDATE sentir_agir_config SET valor = %s, atualizado_em = NOW() WHERE chave = %s",
                (valor, chave)
            )
            _registrar_log(
                cursor, 'config', None, 'edicao', _get_usuario(),
                campo_alterado=chave, valor_anterior=atual['valor'],
                valor_novo=valor, ip_origem=_get_ip()
            )
        else:
            cursor.execute(
                "INSERT INTO sentir_agir_config (chave, valor) VALUES (%s, %s)",
                (chave, valor)
            )

        conn.commit()
        cursor.close()
        conn.close()

        return jsonify({'success': True, 'message': 'Configuracao atualizada'})
    except Exception as e:
        traceback.print_exc()
        return jsonify({'success': False, 'error': str(e)}), 500