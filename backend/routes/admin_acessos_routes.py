# -*- coding: utf-8 -*-
"""
Rotas do Painel de Monitoramento de Acessos — Admin.

GET /api/admin/acessos/page          → HTML
GET /api/admin/acessos/conectados    → sessões ativas (memória)
GET /api/admin/acessos/historico     → histórico paginado (banco)
GET /api/admin/acessos/stats         → estatísticas agregadas
GET /api/admin/acessos/exportar      → download CSV filtrado
POST /api/admin/acessos/limpeza      → remove registros > 6 meses
"""

import csv
import io
from datetime import datetime, timedelta

from flask import Blueprint, jsonify, send_from_directory, request, Response

from backend.middleware.decorators import admin_required
from backend.database import get_db_connection
from backend.access_tracker import get_connected_users, PAINEIS_NOMES

acessos_bp = Blueprint('admin_acessos', __name__, url_prefix='/api/admin/acessos')


# ─────────────────────────────────────────────────────────
# PÁGINA HTML
# ─────────────────────────────────────────────────────────

@acessos_bp.route('/page', methods=['GET'])
@admin_required
def render_page():
    return send_from_directory('frontend', 'admin-acessos.html')


# ─────────────────────────────────────────────────────────
# CONECTADOS AGORA (memória)
# ─────────────────────────────────────────────────────────

@acessos_bp.route('/conectados', methods=['GET'])
@admin_required
def get_conectados():
    usuarios  = get_connected_users()
    ativos    = sum(1 for u in usuarios if u['status'] == 'ativo')
    recentes  = sum(1 for u in usuarios if u['status'] == 'recente')
    return jsonify({
        'usuarios':      usuarios,
        'total_ativos':  ativos,
        'total_recentes': recentes,
        'total':         len(usuarios),
        'atualizado_em': datetime.now().strftime('%d/%m/%Y %H:%M:%S'),
    })


# ─────────────────────────────────────────────────────────
# HISTÓRICO PAGINADO (banco)
# ─────────────────────────────────────────────────────────

def _build_historico_query(args, count_only=False):
    """Monta a query de histórico com os filtros da requisição."""
    ip       = args.get('ip', '').strip()
    painel   = args.get('painel', '').strip()
    tipo     = args.get('tipo', '').strip()
    busca    = args.get('busca', '').strip()
    dt_ini   = args.get('dt_inicio', '').strip()
    dt_fim   = args.get('dt_fim', '').strip()

    cond  = ['1=1']
    params = []

    if ip:
        cond.append('ip ILIKE %s')
        params.append('%{}%'.format(ip))
    if painel:
        cond.append('painel_codigo = %s')
        params.append(painel)
    if tipo:
        cond.append('tipo_acesso = %s')
        params.append(tipo)
    if busca:
        cond.append(
            '(descricao ILIKE %s OR ip ILIKE %s OR usuario_nome ILIKE %s '
            'OR COALESCE(painel_nome, \'\') ILIKE %s)')
        term = '%{}%'.format(busca)
        params.extend([term, term, term, term])
    if dt_ini:
        try:
            dt = datetime.strptime(dt_ini, '%Y-%m-%d')
            cond.append('dt_acesso >= %s')
            params.append(dt)
        except ValueError:
            pass
    if dt_fim:
        try:
            dt = datetime.strptime(dt_fim, '%Y-%m-%d') + timedelta(days=1)
            cond.append('dt_acesso < %s')
            params.append(dt)
        except ValueError:
            pass

    where = ' AND '.join(cond)

    if count_only:
        return 'SELECT COUNT(*) FROM access_log WHERE {}'.format(where), params

    return (
        'SELECT id, dt_acesso, ip, painel_codigo, painel_nome, endpoint, '
        'descricao, metodo, status_code, duracao_ms, usuario_nome, tipo_acesso '
        'FROM access_log WHERE {} ORDER BY dt_acesso DESC'.format(where),
        params
    )


@acessos_bp.route('/historico', methods=['GET'])
@admin_required
def get_historico():
    try:
        pagina     = max(1, int(request.args.get('pagina', 1)))
        por_pagina = min(200, max(10, int(request.args.get('por_pagina', 50))))
    except (ValueError, TypeError):
        pagina, por_pagina = 1, 50

    conn = get_db_connection()
    if not conn:
        return jsonify({'erro': 'Banco indisponível'}), 503

    try:
        from psycopg2.extras import RealDictCursor
        cur = conn.cursor(cursor_factory=RealDictCursor)

        # Contagem total
        q_count, params = _build_historico_query(request.args, count_only=True)
        cur.execute(q_count, params)
        total = cur.fetchone()['count']

        # Dados da página
        q_data, params = _build_historico_query(request.args)
        offset = (pagina - 1) * por_pagina
        cur.execute(q_data + ' LIMIT %s OFFSET %s', params + [por_pagina, offset])
        rows = cur.fetchall()

        registros = []
        for r in rows:
            status = r['status_code']
            if status is None:
                status_label = '—'
            elif status < 300:
                status_label = 'Sucesso ({})'.format(status)
            elif status < 400:
                status_label = 'Redirecionamento ({})'.format(status)
            elif status == 401:
                status_label = 'Não autenticado (401)'
            elif status == 403:
                status_label = 'Sem permissão (403)'
            elif status == 404:
                status_label = 'Não encontrado (404)'
            else:
                status_label = 'Erro ({})'.format(status)

            registros.append({
                'id':           r['id'],
                'dt_acesso':    r['dt_acesso'].strftime('%d/%m/%Y %H:%M:%S') if r['dt_acesso'] else '—',
                'dt_acesso_iso': r['dt_acesso'].isoformat() if r['dt_acesso'] else None,
                'ip':           r['ip'],
                'painel_codigo': r['painel_codigo'],
                'painel_nome':  r['painel_nome'] or '—',
                'descricao':    r['descricao'] or '—',
                'status_code':  status,
                'status_label': status_label,
                'duracao_ms':   r['duracao_ms'],
                'usuario_nome': r['usuario_nome'] or 'Não identificado',
                'tipo_acesso':  r['tipo_acesso'] or '—',
            })

        cur.close()
        conn.close()

        total_paginas = max(1, -(-total // por_pagina))  # ceil division

        return jsonify({
            'registros':     registros,
            'total':         total,
            'pagina':        pagina,
            'por_pagina':    por_pagina,
            'total_paginas': total_paginas,
        })

    except Exception as e:
        conn.close()
        return jsonify({'erro': str(e)}), 500


# ─────────────────────────────────────────────────────────
# ESTATÍSTICAS AGREGADAS
# ─────────────────────────────────────────────────────────

@acessos_bp.route('/stats', methods=['GET'])
@admin_required
def get_stats():
    conn = get_db_connection()
    if not conn:
        return jsonify({'erro': 'Banco indisponível'}), 503

    try:
        from psycopg2.extras import RealDictCursor
        cur = conn.cursor(cursor_factory=RealDictCursor)

        # Totais
        cur.execute("""
            SELECT
                COUNT(*)                                            AS total,
                COUNT(*) FILTER (WHERE dt_acesso::date = CURRENT_DATE)                AS hoje,
                COUNT(*) FILTER (WHERE dt_acesso >= NOW() - INTERVAL '7 days')        AS semana,
                COUNT(*) FILTER (WHERE dt_acesso >= NOW() - INTERVAL '30 days')       AS mes,
                COUNT(DISTINCT ip) FILTER (WHERE dt_acesso::date = CURRENT_DATE)      AS ips_hoje,
                COUNT(*) FILTER (WHERE tipo_acesso = 'erro'
                                   AND dt_acesso::date = CURRENT_DATE)                AS erros_hoje
            FROM access_log
        """)
        totais = cur.fetchone()

        # Tipo mais acessado hoje
        cur.execute("""
            SELECT tipo_acesso, COUNT(*) AS n
            FROM access_log
            WHERE dt_acesso::date = CURRENT_DATE
            GROUP BY tipo_acesso
            ORDER BY n DESC
            LIMIT 10
        """)
        tipos_hoje = [dict(r) for r in cur.fetchall()]

        # Top painéis 7 dias
        cur.execute("""
            SELECT painel_codigo, painel_nome,
                   COUNT(*)            AS acessos,
                   COUNT(DISTINCT ip)  AS computadores
            FROM access_log
            WHERE painel_codigo IS NOT NULL
              AND dt_acesso >= NOW() - INTERVAL '7 days'
            GROUP BY painel_codigo, painel_nome
            ORDER BY acessos DESC
            LIMIT 10
        """)
        top_paineis = [dict(r) for r in cur.fetchall()]

        # Acessos por hora hoje (para gráfico)
        cur.execute("""
            SELECT EXTRACT(HOUR FROM dt_acesso)::int AS hora,
                   COUNT(*) AS n
            FROM access_log
            WHERE dt_acesso::date = CURRENT_DATE
            GROUP BY hora
            ORDER BY hora
        """)
        por_hora = {r['hora']: r['n'] for r in cur.fetchall()}
        acessos_por_hora = [por_hora.get(h, 0) for h in range(24)]

        # Top IPs 7 dias
        cur.execute("""
            SELECT ip,
                   COUNT(*)            AS acessos,
                   MAX(dt_acesso)      AS ultimo,
                   COUNT(DISTINCT painel_codigo) AS paineis_distintos
            FROM access_log
            WHERE dt_acesso >= NOW() - INTERVAL '7 days'
            GROUP BY ip
            ORDER BY acessos DESC
            LIMIT 10
        """)
        top_ips = []
        for r in cur.fetchall():
            top_ips.append({
                'ip':              r['ip'],
                'acessos':         r['acessos'],
                'ultimo':          r['ultimo'].strftime('%d/%m %H:%M') if r['ultimo'] else '—',
                'paineis_distintos': r['paineis_distintos'],
            })

        cur.close()
        conn.close()

        return jsonify({
            'totais':           dict(totais),
            'tipos_hoje':       tipos_hoje,
            'top_paineis':      top_paineis,
            'top_ips':          top_ips,
            'acessos_por_hora': acessos_por_hora,
        })

    except Exception as e:
        conn.close()
        return jsonify({'erro': str(e)}), 500


# ─────────────────────────────────────────────────────────
# EXPORTAR CSV
# ─────────────────────────────────────────────────────────

@acessos_bp.route('/exportar', methods=['GET'])
@admin_required
def exportar_csv():
    conn = get_db_connection()
    if not conn:
        return jsonify({'erro': 'Banco indisponível'}), 503

    try:
        from psycopg2.extras import RealDictCursor
        cur = conn.cursor(cursor_factory=RealDictCursor)

        q_data, params = _build_historico_query(request.args)
        # Limita a 50k linhas por segurança
        cur.execute(q_data + ' LIMIT 50000', params)
        rows = cur.fetchall()
        cur.close()
        conn.close()

        output = io.StringIO()
        writer = csv.writer(output, quoting=csv.QUOTE_ALL)

        # Cabeçalho em português, linguagem simples
        writer.writerow([
            'Data e Hora', 'IP do Computador', 'Usuário do Sistema',
            'Painel / Tela Acessada', 'Descrição do Acesso',
            'Tipo de Acesso', 'Resultado', 'Duração (ms)', 'Código HTTP',
        ])

        for r in rows:
            dt = r['dt_acesso'].strftime('%d/%m/%Y %H:%M:%S') if r['dt_acesso'] else ''
            status = r['status_code']
            if status is None:
                resultado = '—'
            elif status < 300:
                resultado = 'Sucesso'
            elif status == 401:
                resultado = 'Não autenticado'
            elif status == 403:
                resultado = 'Sem permissão'
            elif status == 404:
                resultado = 'Não encontrado'
            elif status >= 500:
                resultado = 'Erro no servidor'
            else:
                resultado = str(status)

            tipos_pt = {
                'painel':  'Visualização de Painel',
                'login':   'Login no Sistema',
                'logout':  'Logout do Sistema',
                'admin':   'Ação Administrativa',
                'erro':    'Erro de Acesso',
                'sistema': 'Acesso ao Sistema',
            }
            tipo_pt = tipos_pt.get(r['tipo_acesso'] or '', r['tipo_acesso'] or '—')

            writer.writerow([
                dt,
                r['ip'] or '—',
                r['usuario_nome'] or 'Não identificado',
                r['painel_nome'] or r['painel_codigo'] or 'Sistema',
                r['descricao'] or '—',
                tipo_pt,
                resultado,
                r['duracao_ms'] if r['duracao_ms'] is not None else '—',
                status or '—',
            ])

        # BOM para Excel reconhecer UTF-8 corretamente
        csv_bytes = ('﻿' + output.getvalue()).encode('utf-8')
        nome_arquivo = 'log_acessos_HAC_{}.csv'.format(
            datetime.now().strftime('%Y%m%d_%H%M'))

        return Response(
            csv_bytes,
            mimetype='text/csv; charset=utf-8',
            headers={'Content-Disposition': 'attachment; filename="{}"'.format(nome_arquivo)}
        )

    except Exception as e:
        conn.close()
        return jsonify({'erro': str(e)}), 500


# ─────────────────────────────────────────────────────────
# LIMPEZA MANUAL (> 6 meses)
# ─────────────────────────────────────────────────────────

@acessos_bp.route('/limpeza', methods=['POST'])
@admin_required
def limpeza():
    conn = get_db_connection()
    if not conn:
        return jsonify({'erro': 'Banco indisponível'}), 503
    try:
        cur = conn.cursor()
        cur.execute(
            "DELETE FROM access_log WHERE dt_acesso < NOW() - INTERVAL '6 months'")
        removidos = cur.rowcount
        conn.commit()
        cur.close()
        conn.close()
        return jsonify({
            'removidos': removidos,
            'msg': '{} registro(s) removido(s) (anteriores a 6 meses)'.format(removidos)
        })
    except Exception as e:
        conn.close()
        return jsonify({'erro': str(e)}), 500


# ─────────────────────────────────────────────────────────
# LISTA DE PAINÉIS (para o filtro)
# ─────────────────────────────────────────────────────────

@acessos_bp.route('/paineis-lista', methods=['GET'])
@admin_required
def paineis_lista():
    """Retorna painéis que aparecem no log (para popular o dropdown de filtro)."""
    conn = get_db_connection()
    if not conn:
        return jsonify([])
    try:
        from psycopg2.extras import RealDictCursor
        cur = conn.cursor(cursor_factory=RealDictCursor)
        cur.execute("""
            SELECT painel_codigo, painel_nome, COUNT(*) AS total
            FROM access_log
            WHERE painel_codigo IS NOT NULL
            GROUP BY painel_codigo, painel_nome
            ORDER BY total DESC
        """)
        lista = [dict(r) for r in cur.fetchall()]
        cur.close()
        conn.close()
        return jsonify(lista)
    except Exception as e:
        conn.close()
        return jsonify([])
