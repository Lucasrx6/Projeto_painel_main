# ============================================================
# PAINEL 30 - CENTRAL DE TRATATIVAS SENTIR E AGIR
# Hospital Anchieta Ceilândia
# Gestão de tratativas para itens críticos
# ============================================================

import os
import json
import traceback
from datetime import datetime, date, timedelta
from decimal import Decimal
from flask import Blueprint, request, jsonify, send_from_directory, session
from psycopg2.extras import RealDictCursor
from backend.database import get_db_connection, release_connection
from backend.middleware.decorators import login_required
from backend.user_management import verificar_permissao_painel

try:
    import apprise as _apprise_lib
    from urllib.parse import quote as _url_encode
    _APPRISE_OK = True
except ImportError:
    _APPRISE_OK = False

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


def _encontrar_responsavel_auto(cursor, categoria_id, setor_id):
    """
    Encontra o responsavel ativo mais adequado para uma tratativa.
    Prioridade:
    1. Vinculado a categoria E setor (match exato)
    2. Vinculado a categoria sem restricao de setor (responsavel geral)
    3. Vinculado a categoria (qualquer setor)
    4. Fallback: vinculado apenas ao setor
    """
    cursor.execute("""
        SELECT r.id FROM sentir_agir_responsaveis r
        JOIN sentir_agir_responsavel_categorias rc ON rc.responsavel_id = r.id
        JOIN sentir_agir_responsavel_setores rs ON rs.responsavel_id = r.id
        WHERE rc.categoria_id = %s AND rs.setor_id = %s AND r.ativo = TRUE
        ORDER BY r.nome LIMIT 1
    """, (categoria_id, setor_id))
    resp = cursor.fetchone()
    if resp:
        return resp['id']

    cursor.execute("""
        SELECT r.id FROM sentir_agir_responsaveis r
        JOIN sentir_agir_responsavel_categorias rc ON rc.responsavel_id = r.id
        WHERE rc.categoria_id = %s AND r.ativo = TRUE
          AND NOT EXISTS (
              SELECT 1 FROM sentir_agir_responsavel_setores rs2
              WHERE rs2.responsavel_id = r.id
          )
        ORDER BY r.nome LIMIT 1
    """, (categoria_id,))
    resp = cursor.fetchone()
    if resp:
        return resp['id']

    cursor.execute("""
        SELECT r.id FROM sentir_agir_responsaveis r
        JOIN sentir_agir_responsavel_categorias rc ON rc.responsavel_id = r.id
        WHERE rc.categoria_id = %s AND r.ativo = TRUE
        ORDER BY r.nome LIMIT 1
    """, (categoria_id,))
    resp = cursor.fetchone()
    if resp:
        return resp['id']

    cursor.execute("""
        SELECT r.id FROM sentir_agir_responsaveis r
        JOIN sentir_agir_responsavel_setores rs ON rs.responsavel_id = r.id
        WHERE rs.setor_id = %s AND r.ativo = TRUE
        ORDER BY r.nome LIMIT 1
    """, (setor_id,))
    resp = cursor.fetchone()
    return resp['id'] if resp else None


def _enviar_notificacao_tratativa(dados):
    """
    Envia email de notificacao para responsaveis de uma tratativa via Apprise.
    dados deve conter: tratativa_id, item_descricao, categoria_nome, setor_nome,
                       nm_paciente, nr_atendimento, leito, data_ronda_fmt, dupla_nome,
                       destinatarios=[{email, nome}]
    """
    if not _APPRISE_OK:
        return False, 'Apprise nao disponivel'

    smtp_host = os.getenv('SMTP_HOST', '')
    smtp_port = os.getenv('SMTP_PORT', '587')
    smtp_user = os.getenv('SMTP_USER', '')
    smtp_pass = os.getenv('SMTP_PASS', '')
    smtp_from = os.getenv('SMTP_FROM', '') or smtp_user

    if not smtp_host or not smtp_user or not smtp_pass:
        return False, 'SMTP nao configurado'

    destinatarios = dados.get('destinatarios', [])
    if not destinatarios:
        return False, 'Sem destinatarios'

    app_base_url = os.getenv('APP_BASE_URL', '').rstrip('/')
    cor = '#dc3545'
    bloco_link = ''
    if app_base_url:
        link = '{}/painel/painel30?abrir={}'.format(app_base_url, dados['tratativa_id'])
        bloco_link = (
            '<div style="text-align:center;margin-top:18px;">'
            '<a href="{link}" style="display:inline-block;padding:10px 24px;'
            'background:{cor};color:white;border-radius:6px;font-weight:bold;'
            'text-decoration:none;font-size:14px;">Abrir Tratativa</a></div>'
        ).format(link=link, cor=cor)

    titulo = 'Sentir e Agir - CRITICO - {} - {}'.format(
        dados.get('categoria_nome', '-'), dados.get('setor_nome', '-')
    )

    html = (
        '<div style="font-family:-apple-system,BlinkMacSystemFont,\'Segoe UI\',Roboto,sans-serif;'
        'max-width:600px;margin:0 auto;padding:20px;">'
        '<div style="background:{cor};color:white;padding:15px 20px;border-radius:8px 8px 0 0;">'
        '<h2 style="margin:0;font-size:18px;">Nova Tratativa - CRITICO</h2>'
        '<p style="margin:5px 0 0;font-size:13px;opacity:0.9;">Hospital Anchieta Ceilandia - Projeto Sentir e Agir</p>'
        '</div>'
        '<div style="border:1px solid #dee2e6;border-top:none;padding:20px;border-radius:0 0 8px 8px;">'
        '<div style="background:#fff0f0;border-left:4px solid {cor};padding:12px 16px;border-radius:4px;margin-bottom:16px;">'
        '<strong style="color:{cor};font-size:15px;">{item}</strong><br>'
        '<small style="color:#555;margin-top:4px;display:block;">Categoria: {categoria}</small>'
        '</div>'
        '<table style="width:100%%;border-collapse:collapse;font-size:14px;margin-top:8px;">'
        '<tr><td style="padding:6px 0;color:#6c757d;width:130px;">Paciente:</td>'
        '<td style="padding:6px 0;font-weight:bold;">{paciente}</td></tr>'
        '<tr><td style="padding:6px 0;color:#6c757d;">Atendimento:</td>'
        '<td style="padding:6px 0;">{atendimento}</td></tr>'
        '<tr><td style="padding:6px 0;color:#6c757d;">Setor:</td>'
        '<td style="padding:6px 0;">{setor}</td></tr>'
        '<tr><td style="padding:6px 0;color:#6c757d;">Leito:</td>'
        '<td style="padding:6px 0;">{leito}</td></tr>'
        '<tr><td style="padding:6px 0;color:#6c757d;">Data da Ronda:</td>'
        '<td style="padding:6px 0;">{data_ronda}</td></tr>'
        '<tr><td style="padding:6px 0;color:#6c757d;">Dupla:</td>'
        '<td style="padding:6px 0;">{dupla}</td></tr>'
        '</table>'
        '{bloco_link}'
        '<hr style="border:none;border-top:1px solid #eee;margin:18px 0;">'
        '<p style="font-size:11px;color:#999;margin:0;text-align:center;">'
        'Notificacao automatica - Sistema de Paineis HAC<br>Enviado em {enviado_em}</p>'
        '</div></div>'
    ).format(
        cor=cor,
        item=dados.get('item_descricao', '-'),
        categoria=dados.get('categoria_nome', '-'),
        paciente=dados.get('nm_paciente', 'N/I'),
        atendimento=dados.get('nr_atendimento', '--') or '--',
        setor=dados.get('setor_nome', '-'),
        leito=dados.get('leito', '-'),
        data_ronda=dados.get('data_ronda_fmt', '--'),
        dupla=dados.get('dupla_nome', '-'),
        bloco_link=bloco_link,
        enviado_em=datetime.now().strftime('%d/%m/%Y %H:%M')
    )

    try:
        ap = _apprise_lib.Apprise()
        user_enc = _url_encode(smtp_user, safe='')
        pass_enc = _url_encode(smtp_pass, safe='')
        for dest in destinatarios:
            url = 'mailtos://{u}:{p}@{h}:{port}?from={f}&to={t}&name=Notificacao+HAC'.format(
                u=user_enc, p=pass_enc, h=smtp_host, port=smtp_port,
                f=_url_encode(smtp_from, safe=''), t=_url_encode(dest['email'], safe='')
            )
            ap.add(url)
        ok = ap.notify(
            title=titulo, body=html,
            body_format=_apprise_lib.NotifyFormat.HTML,
            notify_type=_apprise_lib.NotifyType.WARNING
        )
        return ok, 'OK' if ok else 'Falha no envio'
    except Exception as e:
        return False, str(e)


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
        release_connection(conn)

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
                t.observacoes_resolucao,
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
                    WHEN 'impossibilitado' THEN 4
                    WHEN 'cancelado' THEN 5
                END,
                t.criado_em DESC
        """

        cursor.execute(sql, params)
        rows = cursor.fetchall()

        cursor.close()
        release_connection(conn)

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
# API: RESUMO DE CRÍTICOS (sintético + analítico)
# ============================================================

@painel30_bp.route('/api/paineis/painel30/criticos-resumo', methods=['GET'])
@login_required
def criticos_resumo():
    try:
        conn = get_db_connection()
        cursor = conn.cursor(cursor_factory=RealDictCursor)

        dias = request.args.get('dias', '30')

        sql = """
            SELECT
                s.id AS setor_id,
                s.nome AS setor_nome,
                s.sigla AS setor_sigla,
                c.nome AS categoria_nome,
                c.icone AS categoria_icone,
                i.descricao AS item_descricao,
                t.id AS tratativa_id,
                t.status,
                t.descricao_problema,
                t.plano_acao,
                t.observacoes_resolucao,
                t.criado_em AS tratativa_criada_em,
                EXTRACT(EPOCH FROM (NOW() - t.criado_em)) / 86400.0 AS dias_em_aberto,
                v.leito,
                v.nm_paciente,
                v.nr_atendimento,
                ro.data_ronda,
                COALESCE(r.nome, t.responsavel_nome_manual, 'Sem responsavel') AS responsavel_display,
                d.nome_visitante_1 || ' e ' || d.nome_visitante_2 AS dupla_nome
            FROM sentir_agir_tratativas t
            JOIN sentir_agir_visitas v ON v.id = t.visita_id
            JOIN sentir_agir_itens i ON i.id = t.item_id
            JOIN sentir_agir_categorias c ON c.id = t.categoria_id
            JOIN sentir_agir_setores s ON s.id = v.setor_id
            JOIN sentir_agir_rondas ro ON ro.id = v.ronda_id
            JOIN sentir_agir_duplas d ON d.id = ro.dupla_id
            LEFT JOIN sentir_agir_responsaveis r ON r.id = t.responsavel_id
            WHERE t.status NOT IN ('cancelado')
        """
        params = []
        if dias:
            sql += " AND t.criado_em >= NOW() - %s * INTERVAL '1 day'"
            params.append(int(dias))

        sql += " ORDER BY s.nome, t.status, c.nome, t.criado_em DESC"

        cursor.execute(sql, params)
        rows = [serializar_linha(r) for r in cursor.fetchall()]

        for r in rows:
            if r.get('dias_em_aberto') is not None:
                r['dias_em_aberto'] = round(float(r['dias_em_aberto']), 1)

        cursor.close()
        release_connection(conn)

        STATUS_ABERTO = ('pendente', 'em_tratativa')

        # Agrupar por setor → categoria (sintético)
        from collections import OrderedDict
        setores_map = OrderedDict()
        for row in rows:
            sn = row['setor_nome']
            cn = row['categoria_nome']
            eh_aberto = row['status'] in STATUS_ABERTO
            if sn not in setores_map:
                setores_map[sn] = {
                    'setor_id': row['setor_id'],
                    'setor_nome': sn,
                    'setor_sigla': row['setor_sigla'],
                    'total': 0,
                    'total_aberto': 0,
                    'total_tratado': 0,
                    'categorias': OrderedDict()
                }
            if cn not in setores_map[sn]['categorias']:
                setores_map[sn]['categorias'][cn] = {
                    'categoria_nome': cn,
                    'categoria_icone': row['categoria_icone'],
                    'total': 0,
                    'total_aberto': 0,
                    'total_tratado': 0,
                }
            setores_map[sn]['categorias'][cn]['total'] += 1
            setores_map[sn]['total'] += 1
            if eh_aberto:
                setores_map[sn]['total_aberto'] += 1
                setores_map[sn]['categorias'][cn]['total_aberto'] += 1
            else:
                setores_map[sn]['total_tratado'] += 1
                setores_map[sn]['categorias'][cn]['total_tratado'] += 1

        sintetico = []
        for sn, sd in setores_map.items():
            sintetico.append({
                'setor_id': sd['setor_id'],
                'setor_nome': sd['setor_nome'],
                'setor_sigla': sd['setor_sigla'],
                'total': sd['total'],
                'total_aberto': sd['total_aberto'],
                'total_tratado': sd['total_tratado'],
                'categorias': list(sd['categorias'].values())
            })

        total_aberto = sum(1 for r in rows if r['status'] in STATUS_ABERTO)

        return jsonify({
            'success': True,
            'data': {
                'sintetico': sintetico,
                'analitico': rows,
                'total': total_aberto,
                'total_geral': len(rows)
            }
        })
    except Exception as e:
        traceback.print_exc()
        return jsonify({'success': False, 'error': str(e)}), 500


# ============================================================
# API: CATEGORIAS CRÍTICAS (gráfico + análise IA semanal)
# ============================================================

@painel30_bp.route('/api/paineis/painel30/categorias-criticas', methods=['GET'])
@login_required
def categorias_criticas():
    try:
        conn = get_db_connection()
        cursor = conn.cursor(cursor_factory=RealDictCursor)

        periodo = request.args.get('periodo', '30')

        sql = """
            SELECT
                c.id     AS categoria_id,
                c.nome   AS categoria_nome,
                c.icone  AS categoria_icone,
                c.cor    AS categoria_cor,
                COUNT(*) FILTER (WHERE t.status = 'pendente')                        AS total_pendente,
                COUNT(*) FILTER (WHERE t.status = 'em_tratativa')                    AS total_tratativa,
                COUNT(*) FILTER (WHERE t.status IN ('pendente', 'em_tratativa'))     AS total_aberto,
                COUNT(*) FILTER (WHERE t.status IN ('regularizado', 'cancelado'))    AS total_tratado,
                COUNT(*)                                                              AS total_geral
            FROM sentir_agir_tratativas t
            JOIN sentir_agir_categorias c ON c.id = t.categoria_id
            WHERE 1=1
        """
        params = []
        if periodo:
            sql += " AND t.criado_em >= NOW() - %s * INTERVAL '1 day'"
            params.append(int(periodo))

        sql += """
            GROUP BY c.id, c.nome, c.icone, c.cor, c.ordem
            HAVING COUNT(*) FILTER (WHERE t.status IN ('pendente', 'em_tratativa')) > 0
            ORDER BY total_aberto DESC, c.ordem
        """
        cursor.execute(sql, params)
        categorias = [serializar_linha(r) for r in cursor.fetchall()]

        # Última análise IA semanal (tabela pode ainda não existir)
        analise_ia = None
        try:
            cursor.execute("""
                SELECT data_referencia, periodo_dias, analise_texto, gerado_em
                FROM sentir_agir_analises_categorias
                ORDER BY data_referencia DESC
                LIMIT 1
            """)
            row = cursor.fetchone()
            if row:
                analise_ia = serializar_linha(row)
        except Exception:
            pass

        cursor.close()
        release_connection(conn)

        return jsonify({
            'success': True,
            'categorias': categorias,
            'analise_ia': analise_ia,
            'periodo': periodo
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
            release_connection(conn)
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
        release_connection(conn)

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
            release_connection(conn)
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
            if novo_status not in ('pendente', 'em_tratativa', 'regularizado', 'impossibilitado', 'cancelado'):
                cursor.close()
                release_connection(conn)
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
            release_connection(conn)
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
        release_connection(conn)

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
# API: RECLASSIFICAR CRÍTICA (mover para outro item) — admin
# ============================================================

@painel30_bp.route('/api/paineis/painel30/categorias-itens', methods=['GET'])
@login_required
def categorias_itens():
    if not _is_admin():
        return jsonify({'success': False, 'error': 'Apenas administradores'}), 403
    try:
        conn = get_db_connection()
        cursor = conn.cursor(cursor_factory=RealDictCursor)
        cursor.execute("""
            SELECT c.id AS categoria_id, c.nome AS categoria_nome,
                   i.id AS item_id, i.descricao AS item_descricao
            FROM sentir_agir_itens i
            JOIN sentir_agir_categorias c ON c.id = i.categoria_id
            WHERE i.ativo = TRUE AND c.ativo = TRUE
            ORDER BY c.ordem, c.nome, i.ordem, i.descricao
        """)
        rows = cursor.fetchall()
        cursor.close()
        release_connection(conn)

        cats = {}
        cats_ordem = []
        for row in rows:
            cid = row['categoria_id']
            if cid not in cats:
                cats[cid] = {'id': cid, 'nome': row['categoria_nome'], 'itens': []}
                cats_ordem.append(cid)
            cats[cid]['itens'].append({'id': row['item_id'], 'descricao': row['item_descricao']})

        return jsonify({'success': True, 'data': [cats[c] for c in cats_ordem]})
    except Exception as e:
        traceback.print_exc()
        return jsonify({'success': False, 'error': str(e)}), 500


@painel30_bp.route('/api/paineis/painel30/tratativas/<int:tratativa_id>/mover', methods=['POST'])
@login_required
def mover_tratativa(tratativa_id):
    """
    Admin: move a tratativa para outro item.
    Atualiza: sentir_agir_tratativas (item_id, categoria_id, descricao_problema, responsavel_id)
              sentir_agir_avaliacoes (item_id) para manter integridade historica
    """
    if not _is_admin():
        return jsonify({'success': False, 'error': 'Apenas administradores'}), 403

    dados = request.get_json()
    if not dados:
        return jsonify({'success': False, 'error': 'Dados nao fornecidos'}), 400

    novo_item_id = dados.get('item_id')
    motivo = (dados.get('motivo') or '').strip()

    if not novo_item_id:
        return jsonify({'success': False, 'error': 'item_id obrigatorio'}), 400

    try:
        usuario = _get_usuario()
        ip = _get_ip()

        conn = get_db_connection()
        cursor = conn.cursor(cursor_factory=RealDictCursor)

        cursor.execute("""
            SELECT t.id, t.avaliacao_id, t.item_id, t.categoria_id,
                   t.descricao_problema, t.visita_id,
                   i.descricao AS item_descricao,
                   c.nome AS categoria_nome,
                   v.setor_id
            FROM sentir_agir_tratativas t
            JOIN sentir_agir_itens i ON i.id = t.item_id
            JOIN sentir_agir_categorias c ON c.id = t.categoria_id
            JOIN sentir_agir_visitas v ON v.id = t.visita_id
            WHERE t.id = %s
        """, (tratativa_id,))
        tratativa = cursor.fetchone()

        if not tratativa:
            cursor.close()
            release_connection(conn)
            return jsonify({'success': False, 'error': 'Tratativa nao encontrada'}), 404

        if tratativa['item_id'] == int(novo_item_id):
            cursor.close()
            release_connection(conn)
            return jsonify({'success': False, 'error': 'Item ja atribuido a esta tratativa'}), 400

        cursor.execute("""
            SELECT i.id, i.descricao, i.categoria_id, c.nome AS categoria_nome
            FROM sentir_agir_itens i
            JOIN sentir_agir_categorias c ON c.id = i.categoria_id
            WHERE i.id = %s AND i.ativo = TRUE
        """, (int(novo_item_id),))
        novo_item = cursor.fetchone()

        if not novo_item:
            cursor.close()
            release_connection(conn)
            return jsonify({'success': False, 'error': 'Item nao encontrado ou inativo'}), 404

        # Reconstruir descricao_problema preservando sufixo (Paciente, Leito, Obs)
        old_desc = tratativa.get('descricao_problema', '') or ''
        idx = old_desc.find(' | Paciente:')
        suffix = old_desc[idx:] if idx != -1 else ''
        nova_desc = 'Item critico: {item} | Categoria: {cat}{suffix}'.format(
            item=novo_item['descricao'],
            cat=novo_item['categoria_nome'],
            suffix=suffix
        )
        if motivo:
            nova_desc += ' | Reclassificado: ' + motivo

        # Auto-atribuir responsavel para nova categoria/setor
        novo_resp_id = _encontrar_responsavel_auto(cursor, novo_item['categoria_id'], tratativa['setor_id'])

        # Atualizar tratativa
        cursor.execute("""
            UPDATE sentir_agir_tratativas
            SET item_id = %s, categoria_id = %s, descricao_problema = %s,
                responsavel_id = %s, atualizado_em = NOW()
            WHERE id = %s
        """, (novo_item['id'], novo_item['categoria_id'], nova_desc, novo_resp_id, tratativa_id))

        # Corrigir avaliacao original para apontar ao item correto
        if tratativa.get('avaliacao_id'):
            cursor.execute("""
                UPDATE sentir_agir_avaliacoes
                SET item_id = %s
                WHERE id = %s
            """, (novo_item['id'], tratativa['avaliacao_id']))

        # Log da reclassificacao
        _registrar_log(
            cursor, 'tratativa', tratativa_id, 'reclassificacao', usuario,
            campo_alterado='item_id',
            valor_anterior='{} [cat: {}]'.format(
                tratativa['item_descricao'], tratativa['categoria_nome']
            )[:500],
            valor_novo='{} [cat: {}]'.format(
                novo_item['descricao'], novo_item['categoria_nome']
            )[:500],
            ip_origem=ip
        )
        if motivo:
            _registrar_log(
                cursor, 'tratativa', tratativa_id, 'reclassificacao', usuario,
                campo_alterado='motivo', valor_novo=motivo[:500], ip_origem=ip
            )

        # Permitir renotificacao com novo item
        cursor.execute(
            "DELETE FROM notificacoes_log WHERE chave_evento = %s",
            ('sentir_agir_trat_{}'.format(tratativa_id),)
        )

        conn.commit()
        cursor.close()
        release_connection(conn)

        return jsonify({
            'success': True,
            'message': 'Critica reclassificada para: ' + novo_item['descricao'],
            'novo_item_id': novo_item['id'],
            'nova_categoria_id': novo_item['categoria_id']
        })

    except Exception as e:
        traceback.print_exc()
        return jsonify({'success': False, 'error': str(e)}), 500


# ============================================================
# API: ATUALIZAR RESPONSÁVEL AUTOMATICAMENTE
# ============================================================

@painel30_bp.route('/api/paineis/painel30/tratativas/<int:tratativa_id>/atualizar-responsavel', methods=['POST'])
@login_required
def atualizar_responsavel_auto(tratativa_id):
    """
    Busca automaticamente o melhor responsavel para a tratativa
    (categoria → setor), atribui e reenvia o email de notificacao.
    """
    try:
        usuario = _get_usuario()
        ip = _get_ip()

        conn = get_db_connection()
        cursor = conn.cursor(cursor_factory=RealDictCursor)

        cursor.execute("""
            SELECT
                t.id, t.responsavel_id, t.categoria_id, t.visita_id,
                t.descricao_problema,
                i.descricao AS item_descricao,
                c.nome AS categoria_nome,
                v.setor_id,
                v.nm_paciente, v.nr_atendimento, v.leito,
                s.nome AS setor_nome,
                ro.data_ronda,
                d.nome_visitante_1 || ' e ' || d.nome_visitante_2 AS dupla_nome
            FROM sentir_agir_tratativas t
            JOIN sentir_agir_visitas v ON v.id = t.visita_id
            JOIN sentir_agir_itens i ON i.id = t.item_id
            JOIN sentir_agir_categorias c ON c.id = t.categoria_id
            JOIN sentir_agir_setores s ON s.id = v.setor_id
            JOIN sentir_agir_rondas ro ON ro.id = v.ronda_id
            JOIN sentir_agir_duplas d ON d.id = ro.dupla_id
            WHERE t.id = %s
        """, (tratativa_id,))
        tratativa = cursor.fetchone()

        if not tratativa:
            cursor.close()
            release_connection(conn)
            return jsonify({'success': False, 'error': 'Tratativa nao encontrada'}), 404

        novo_resp_id = _encontrar_responsavel_auto(cursor, tratativa['categoria_id'], tratativa['setor_id'])

        responsavel_nome = None
        destinatarios = []
        if novo_resp_id:
            cursor.execute(
                "SELECT id, nome, email FROM sentir_agir_responsaveis WHERE id = %s",
                (novo_resp_id,)
            )
            resp_row = cursor.fetchone()
            if resp_row:
                responsavel_nome = resp_row['nome']
                if resp_row.get('email'):
                    destinatarios = [{'email': resp_row['email'], 'nome': resp_row['nome']}]

        anterior_resp_id = tratativa['responsavel_id']
        if novo_resp_id != anterior_resp_id:
            cursor.execute("""
                UPDATE sentir_agir_tratativas
                SET responsavel_id = %s, atualizado_em = NOW()
                WHERE id = %s
            """, (novo_resp_id, tratativa_id))
            _registrar_log(
                cursor, 'tratativa', tratativa_id, 'auto_atribuicao', usuario,
                campo_alterado='responsavel_id',
                valor_anterior=str(anterior_resp_id or ''),
                valor_novo=str(novo_resp_id or ''),
                ip_origem=ip
            )

        # Remover log de notificacao anterior para permitir reenvio pelo notificador
        cursor.execute(
            "DELETE FROM notificacoes_log WHERE chave_evento = %s",
            ('sentir_agir_trat_{}'.format(tratativa_id),)
        )

        conn.commit()
        cursor.close()
        release_connection(conn)

        email_enviado = False
        email_msg = 'Sem destinatario com email cadastrado'

        if destinatarios:
            dr = tratativa.get('data_ronda')
            if hasattr(dr, 'strftime'):
                data_ronda_fmt = dr.strftime('%d/%m/%Y')
            elif dr:
                partes = str(dr).split('T')[0].split('-')
                data_ronda_fmt = '{}/{}/{}'.format(partes[2], partes[1], partes[0]) if len(partes) == 3 else str(dr)
            else:
                data_ronda_fmt = '--'

            dados_email = {
                'tratativa_id': tratativa_id,
                'item_descricao': tratativa.get('item_descricao', '-'),
                'categoria_nome': tratativa.get('categoria_nome', '-'),
                'setor_nome': tratativa.get('setor_nome', '-'),
                'nm_paciente': tratativa.get('nm_paciente', 'N/I'),
                'nr_atendimento': tratativa.get('nr_atendimento'),
                'leito': tratativa.get('leito', '-'),
                'data_ronda_fmt': data_ronda_fmt,
                'dupla_nome': tratativa.get('dupla_nome', '-'),
                'destinatarios': destinatarios
            }
            email_enviado, email_msg = _enviar_notificacao_tratativa(dados_email)

            if email_enviado:
                try:
                    conn2 = get_db_connection()
                    cur2 = conn2.cursor()
                    agora = datetime.now()
                    cur2.execute("""
                        INSERT INTO notificacoes_log
                            (tipo_evento, chave_evento, nr_atendimento, nm_setor,
                             dados_extra, topico_ntfy, status, dt_detectado,
                             dt_primeira_notificacao, dt_ultima_notificacao,
                             qt_notificacoes, resposta_ntfy)
                        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                    """, (
                        'sentir_agir_tratativa',
                        'sentir_agir_trat_{}'.format(tratativa_id),
                        str(tratativa.get('nr_atendimento') or ''),
                        tratativa.get('setor_nome', ''),
                        json.dumps({
                            'destinatarios_email': ', '.join(d['email'] for d in destinatarios),
                            'categoria': tratativa.get('categoria_nome', ''),
                            'setor': tratativa.get('setor_nome', ''),
                            'acao_manual': True
                        }, ensure_ascii=False),
                        '', 'notificado', agora, agora, agora, 1, email_msg
                    ))
                    conn2.commit()
                    cur2.close()
                    conn2.close()
                except Exception:
                    traceback.print_exc()

        msg = 'Responsavel atualizado'
        if email_enviado:
            msg += ' e email enviado para ' + responsavel_nome
        elif destinatarios:
            msg += ' (falha no email: ' + email_msg + ')'

        return jsonify({
            'success': True,
            'responsavel_id': novo_resp_id,
            'responsavel_nome': responsavel_nome or 'Nenhum responsavel encontrado',
            'email_enviado': email_enviado,
            'message': msg
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
        release_connection(conn)

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
                   r.observacoes, r.ativo, r.criado_em
            FROM sentir_agir_responsaveis r
        """
        if todas != '1':
            sql += " WHERE r.ativo = TRUE"
        sql += " ORDER BY r.nome"

        cursor.execute(sql)
        rows = cursor.fetchall()

        # Buscar categorias e setores N:M para cada responsavel
        resultado = []
        for row in rows:
            item = serializar_linha(row)
            resp_id = row['id']

            cursor.execute("""
                SELECT c.id, c.nome
                FROM sentir_agir_responsavel_categorias rc
                JOIN sentir_agir_categorias c ON c.id = rc.categoria_id
                WHERE rc.responsavel_id = %s
                ORDER BY c.ordem
            """, (resp_id,))
            item['categorias'] = [dict(c) for c in cursor.fetchall()]

            cursor.execute("""
                SELECT s.id, s.nome, s.sigla
                FROM sentir_agir_responsavel_setores rs
                JOIN sentir_agir_setores s ON s.id = rs.setor_id
                WHERE rs.responsavel_id = %s
                ORDER BY s.ordem
            """, (resp_id,))
            item['setores'] = [dict(s) for s in cursor.fetchall()]

            # Retrocompatibilidade: campos singulares para filtros
            item['categoria_id'] = item['categorias'][0]['id'] if item['categorias'] else None
            item['categoria_nome'] = item['categorias'][0]['nome'] if item['categorias'] else None
            item['setor_id'] = item['setores'][0]['id'] if item['setores'] else None
            item['setor_nome'] = item['setores'][0]['nome'] if item['setores'] else None

            resultado.append(item)

        cursor.close()
        release_connection(conn)

        return jsonify({'success': True, 'data': resultado})
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
        observacoes = (dados.get('observacoes') or '').strip() or None

        # Suporte a multiplas categorias e setores (N:M)
        categoria_ids = dados.get('categoria_ids', [])
        setor_ids = dados.get('setor_ids', [])
        # Retrocompatibilidade: campo singular
        if not categoria_ids and dados.get('categoria_id'):
            categoria_ids = [dados['categoria_id']]
        if not setor_ids and dados.get('setor_id'):
            setor_ids = [dados['setor_id']]

        usuario = _get_usuario()
        ip = _get_ip()

        conn = get_db_connection()
        cursor = conn.cursor(cursor_factory=RealDictCursor)

        cursor.execute("""
            INSERT INTO sentir_agir_responsaveis
                (nome, email, telefone, cargo, observacoes, ativo)
            VALUES (%s, %s, %s, %s, %s, TRUE)
            RETURNING id
        """, (nome, email, telefone, cargo, observacoes))
        resp_id = cursor.fetchone()['id']

        # Inserir vinculos N:M de categorias
        for cat_id in categoria_ids:
            if cat_id:
                cursor.execute("""
                    INSERT INTO sentir_agir_responsavel_categorias (responsavel_id, categoria_id)
                    VALUES (%s, %s) ON CONFLICT DO NOTHING
                """, (resp_id, int(cat_id)))

        # Inserir vinculos N:M de setores
        for set_id in setor_ids:
            if set_id:
                cursor.execute("""
                    INSERT INTO sentir_agir_responsavel_setores (responsavel_id, setor_id)
                    VALUES (%s, %s) ON CONFLICT DO NOTHING
                """, (resp_id, int(set_id)))

        _registrar_log(cursor, 'responsavel', resp_id, 'criacao', usuario, ip_origem=ip)

        conn.commit()
        cursor.close()
        release_connection(conn)

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
            release_connection(conn)
            return jsonify({'success': False, 'error': 'Responsavel nao encontrado'}), 404

        sets = []
        params = []
        campos = ['nome', 'email', 'telefone', 'cargo', 'observacoes']
        for campo in campos:
            if campo in dados:
                valor = dados[campo]
                if isinstance(valor, str):
                    valor = valor.strip() or None
                sets.append(campo + " = %s")
                params.append(valor)

        if sets:
            sets.append("atualizado_em = NOW()")
            params.append(resp_id)
            cursor.execute(
                "UPDATE sentir_agir_responsaveis SET " + ", ".join(sets) + " WHERE id = %s",
                params
            )

        # Atualizar vinculos N:M de categorias
        if 'categoria_ids' in dados:
            cursor.execute(
                "DELETE FROM sentir_agir_responsavel_categorias WHERE responsavel_id = %s",
                (resp_id,)
            )
            for cat_id in (dados['categoria_ids'] or []):
                if cat_id:
                    cursor.execute("""
                        INSERT INTO sentir_agir_responsavel_categorias (responsavel_id, categoria_id)
                        VALUES (%s, %s) ON CONFLICT DO NOTHING
                    """, (resp_id, int(cat_id)))

        # Atualizar vinculos N:M de setores
        if 'setor_ids' in dados:
            cursor.execute(
                "DELETE FROM sentir_agir_responsavel_setores WHERE responsavel_id = %s",
                (resp_id,)
            )
            for set_id in (dados['setor_ids'] or []):
                if set_id:
                    cursor.execute("""
                        INSERT INTO sentir_agir_responsavel_setores (responsavel_id, setor_id)
                        VALUES (%s, %s) ON CONFLICT DO NOTHING
                    """, (resp_id, int(set_id)))

        _registrar_log(cursor, 'responsavel', resp_id, 'edicao', usuario, ip_origem=ip)

        conn.commit()
        cursor.close()
        release_connection(conn)

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
            release_connection(conn)
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
        release_connection(conn)

        msg = 'Responsavel ativado' if novo_status else 'Responsavel desativado'
        return jsonify({'success': True, 'message': msg})
    except Exception as e:
        traceback.print_exc()
        return jsonify({'success': False, 'error': str(e)}), 500