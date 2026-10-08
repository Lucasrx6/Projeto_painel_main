"""
Painel 55 — Auditoria Pré-Faturamento de Contas Hospitalares
Sistema separado: banco 'auditoria' próprio, auth via sistema principal.
"""
import logging
import os
import hashlib
import threading
from contextlib import contextmanager
from datetime import datetime
from decimal import Decimal

import psycopg2
import psycopg2.extras
from flask import (Blueprint, jsonify, send_from_directory,
                   session, request, current_app)

from backend.middleware.decorators import login_required, panel_permission_required
from backend.auditoria.leitor_groq import matar_ia, ia_esta_viva
from backend.text_cleaner import limpar_texto_rtf

painel55_bp = Blueprint('painel55', __name__)

# Logger de módulo — usado dentro de threads (sem contexto Flask)
_log = logging.getLogger(__name__)

# Nomes dos setores usados no painel de auditoria (fallback quando setores_hospital não tem)
_SETORES_HAC = {
    134: 'Berçário Maternidade',
    41:  'Internação Clínica',
    54:  'Internação Maternidade',
    184: 'Internação ALA D',
    168: 'UTI Adulto A',
    201: 'UTI Adulto Transição',
    63:  'UTI Adulto 01',
    105: 'UTI Adulto 02',
    88:  'UTI Pediátrica',
    133: 'Internação Pediátrica',
}

# Limite de jobs simultâneos
_JOBS_MAX    = int(os.getenv('AUDITORIA_JOBS_MAX', '2'))
_jobs_ativos = 0
_jobs_lock   = threading.Lock()


# =============================================================================
# Conexão ao banco auditoria (banco separado)
# =============================================================================

def _get_audit_conn():
    url = os.getenv('AUDITORIA_DB_URL')
    if url:
        return psycopg2.connect(url, connect_timeout=10,
                                options='-c search_path=audit,core,ref,public')
    return psycopg2.connect(
        host=os.getenv('AUDIT_DB_HOST',     os.getenv('DB_HOST',     'localhost')),
        dbname=os.getenv('AUDIT_DB_NAME',   'auditoria'),
        user=os.getenv('AUDIT_DB_USER',     os.getenv('DB_USER',     'postgres')),
        password=os.getenv('AUDIT_DB_PASSWORD', os.getenv('DB_PASSWORD', 'postgres')),
        port=int(os.getenv('AUDIT_DB_PORT', os.getenv('DB_PORT',     5432))),
        connect_timeout=10,
        options='-c search_path=audit,core,ref,public',
    )


@contextmanager
def _cursor(dict_cur=True):
    conn = _get_audit_conn()
    try:
        factory = psycopg2.extras.RealDictCursor if dict_cur else None
        kw = {'cursor_factory': factory} if factory else {}
        with conn.cursor(**kw) as cur:
            yield cur
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def _serial(row: dict) -> dict:
    for k, v in list(row.items()):
        if hasattr(v, 'isoformat'):
            row[k] = v.isoformat()
        elif isinstance(v, Decimal):
            row[k] = float(v)
    return row


def _usuario_pseud() -> str:
    """Retorna HMAC-SHA256 (truncado) do login — nunca o login em claro."""
    login  = session.get('usuario', '')
    segredo = os.getenv('AUDITORIA_HMAC_SECRET', 'default_dev_secret')
    return hashlib.sha256((segredo + login).encode()).hexdigest()[:16]


# =============================================================================
# Pipeline de análise (background thread)
# =============================================================================

def _executar_analise(job_id: int, nr_atendimento: str, nr_interno_conta):
    global _jobs_ativos

    conn = None
    try:
        conn = _get_audit_conn()

        # Marca job como rodando
        with conn.cursor() as cur:
            cur.execute(
                "SELECT audit.atualizar_job(%s, 'rodando', 'regras', %s)",
                (job_id, datetime.now())
            )
        conn.commit()

        # Executa regras determinísticas para o atendimento
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(
                "SELECT audit.executar_regras(%s::bigint) AS total",
                (nr_atendimento,)
            )
            row = cur.fetchone()
            qt_regras = int(row['total'] or 0)
        conn.commit()

        # Tenta etapa de IA (somente se autorizada)
        qt_ia = 0
        qt_eventos = 0
        ia_usada = False
        modelo = None
        ia_autorizada = False

        if ia_esta_viva() and os.getenv('IA_HABILITADA', 'false').lower() in ('true', '1'):
            try:
                with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
                    cur.execute("SELECT valor FROM audit.parametro "
                                "WHERE chave = 'ia_externa_autorizada'")
                    p = cur.fetchone()
                    ia_autorizada = p and p['valor'] in ('true', 't', '1')
            except Exception:
                ia_autorizada = False

        if ia_autorizada:
            # Etapa IA: extrai itens de texto em core.evolucao e persiste em
            # core.evento_documentado, que alimenta as views R17-R19.
            # Só é chamada via clique humano em "Executar Regras" — nunca automático.
            with conn.cursor() as cur:
                cur.execute(
                    "SELECT audit.atualizar_job(%s, 'rodando', 'ia')",
                    (job_id,)
                )
            conn.commit()

            # Período de faturamento desta conta — limita extração de IA ao ciclo correto
            conta_periodo = None
            with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
                cur.execute(
                    "SELECT dt_periodo_inicial, dt_periodo_final "
                    "FROM core.conta WHERE nr_interno_conta = %s LIMIT 1",
                    (nr_interno_conta,)
                )
                cp = cur.fetchone()
                if cp:
                    conta_periodo = dict(cp)

            try:
                from backend.auditoria.leitor_groq import LeitorGroq
                leitor = LeitorGroq()
                leitor.resetar_contador()

                # Remove extrações Groq anteriores para esta conta (re-análise limpa)
                with conn.cursor() as cur:
                    cur.execute(
                        "DELETE FROM core.evento_documentado "
                        "WHERE nr_atendimento = %s AND metodo LIKE %s",
                        (nr_atendimento, 'groq%')
                    )
                conn.commit()

                # Busca evoluções limitadas ao período de faturamento desta conta
                with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
                    if (conta_periodo
                            and conta_periodo.get('dt_periodo_inicial')
                            and conta_periodo.get('dt_periodo_final')):
                        cur.execute("""
                            SELECT cd_evolucao, dt_evolucao,
                                   cd_profissional_pseud, texto_limpo
                            FROM core.evolucao
                            WHERE nr_atendimento = %s
                              AND dt_evolucao >= %s
                              AND dt_evolucao <= %s
                              AND texto_limpo IS NOT NULL
                              AND (ie_situacao IS NULL
                                   OR ie_situacao NOT IN ('I', 'C'))
                        """, (nr_atendimento,
                              conta_periodo['dt_periodo_inicial'],
                              conta_periodo['dt_periodo_final']))
                    else:
                        cur.execute("""
                            SELECT cd_evolucao, dt_evolucao,
                                   cd_profissional_pseud, texto_limpo
                            FROM core.evolucao
                            WHERE nr_atendimento = %s
                              AND texto_limpo IS NOT NULL
                              AND (ie_situacao IS NULL
                                   OR ie_situacao NOT IN ('I', 'C'))
                        """, (nr_atendimento,))
                    evolucoes = [dict(r) for r in cur.fetchall()]

                # Janela de confronto (parâmetro ou padrão 6h)
                janela_h = 6.0
                try:
                    with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
                        cur.execute(
                            "SELECT valor FROM audit.parametro "
                            "WHERE chave = 'janela_evolucao_horas'"
                        )
                        _p = cur.fetchone()
                        if _p:
                            janela_h = float(_p['valor'])
                except Exception:
                    pass

                # Extrai itens de cada evolução e insere em core.evento_documentado
                metodo_tag = 'groq_' + leitor.nome_modelo()[:18]
                qt_evolucoes = len(evolucoes)
                for ev_idx, ev in enumerate(evolucoes):
                    # Atualiza etapa com progresso a cada 3 evoluções (visível no poll do frontend)
                    if ev_idx % 3 == 0:
                        progresso = 'ia_%d_%d' % (ev_idx + 1, qt_evolucoes)
                        with conn.cursor() as cur:
                            cur.execute(
                                "UPDATE audit.analise_job SET etapa = %s WHERE id = %s",
                                (progresso, job_id)
                            )
                        conn.commit()

                    data_ref = (ev['dt_evolucao'].strftime('%Y-%m-%d')
                                if ev['dt_evolucao'] else '')
                    nr_ref = hashlib.md5(
                        str(ev['cd_evolucao']).encode()
                    ).hexdigest()[:8]
                    texto_clean = limpar_texto_rtf(ev.get('texto_limpo') or '')
                    if len(texto_clean) < 10:
                        continue
                    itens = leitor.extrair(texto_clean, data_ref, nr_ref)

                    for item in itens:
                        # Tenta resolver o termo extraído para cd_material via ref.material_alias
                        cd_material_res = None
                        try:
                            with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
                                cur.execute(
                                    "SELECT cd_material FROM ref.material_alias "
                                    "WHERE LOWER(TRIM(termo)) = LOWER(TRIM(%s)) "
                                    "  AND confirmado = TRUE LIMIT 1",
                                    (item.item,)
                                )
                                _alias = cur.fetchone()
                                if _alias:
                                    cd_material_res = _alias['cd_material']
                        except Exception as _ae:
                            _log.warning('alias lookup falhou para "%s": %s',
                                         item.item[:40], type(_ae).__name__)

                        with conn.cursor() as cur:
                            cur.execute("""
                                INSERT INTO core.evento_documentado
                                    (nr_atendimento, origem_tabela, origem_id,
                                     dt_evento, dt_registro,
                                     ds_item, qt_item, unidade,
                                     profissional_pseud, trecho_origem,
                                     metodo, versao_modelo, dt_extracao,
                                     cd_material_resolvido, janela_horas)
                                VALUES (%s, 'evolucao', %s, %s, NOW(),
                                        %s, %s, %s, %s, %s, %s, %s, NOW(),
                                        %s, %s)
                            """, (
                                nr_atendimento,
                                ev['cd_evolucao'],
                                ev['dt_evolucao'],
                                item.item,
                                item.quantidade,
                                item.unidade,
                                ev['cd_profissional_pseud'],
                                item.trecho,
                                metodo_tag,
                                leitor.nome_modelo(),
                                cd_material_res,
                                janela_h,
                            ))
                        conn.commit()
                        qt_eventos += 1

                # Re-executa regras para capturar achados baseados nos eventos extraídos
                with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
                    cur.execute(
                        "SELECT audit.executar_regras(%s::bigint) AS total",
                        (nr_atendimento,)
                    )
                    row2 = cur.fetchone()
                    qt_ia = int(row2['total'] or 0) - qt_regras
                conn.commit()

                ia_usada = True
                modelo   = leitor.nome_modelo()

            except Exception as e:
                _log.error(
                    'Erro etapa IA job %s: %s', job_id, type(e).__name__
                )

        # Conclui o job
        with conn.cursor() as cur:
            cur.execute(
                "SELECT audit.atualizar_job(%s, 'concluida', 'fim', NULL, %s, %s, %s, %s, %s, %s)",
                (job_id, datetime.now(), qt_regras, qt_eventos, qt_ia, ia_usada, modelo)
            )
        conn.commit()

    except Exception as e:
        try:
            if conn:
                try:
                    conn.rollback()
                except Exception:
                    pass
                msg = type(e).__name__ + ': ' + str(e)[:200]
                with conn.cursor() as cur:
                    cur.execute(
                        "SELECT audit.atualizar_job(%s, 'erro', 'erro', NULL, %s, NULL, NULL, NULL, FALSE, NULL, NULL, %s)",
                        (job_id, datetime.now(), msg)
                    )
                conn.commit()
        except Exception:
            pass
    finally:
        if conn:
            try:
                conn.close()
            except Exception:
                pass
        with _jobs_lock:
            _jobs_ativos -= 1


# =============================================================================
# Rota HTML
# =============================================================================

@painel55_bp.route('/painel/painel55')
@login_required
@panel_permission_required('painel55')
def painel55():
    return send_from_directory('paineis/painel55', 'index.html')


# =============================================================================
# Dashboard (stats gerais)
# =============================================================================

@painel55_bp.route('/api/auditoria/dashboard')
@login_required
@panel_permission_required('painel55')
def api_auditoria_dashboard():
    try:
        with _cursor() as cur:
            cur.execute("""
                SELECT
                    COUNT(DISTINCT c.nr_atendimento)                                    AS total_contas,
                    COUNT(a.id)                                                         AS total_achados,
                    SUM(CASE WHEN a.gravidade = 'critica' THEN 1 ELSE 0 END)           AS criticos,
                    SUM(CASE WHEN a.status_tratamento = 'pendente' THEN 1 ELSE 0 END)  AS pendentes,
                    COALESCE(SUM(a.vl_risco), 0)                                       AS vl_risco_total
                FROM core.conta c
                LEFT JOIN audit.achado a ON a.nr_interno_conta = c.nr_interno_conta
                WHERE c.ie_conta_aberta IS DISTINCT FROM 'N'
            """)
            row = cur.fetchone()
        stats = _serial(dict(row)) if row else {}
        return jsonify({'success': True, 'stats': stats})
    except Exception as e:
        current_app.logger.error('Erro dashboard auditoria: %s', e, exc_info=True)
        return jsonify({'success': False, 'error': 'Erro ao buscar dados'}), 500


# =============================================================================
# Listagem de contas (paginada, com filtros)
# =============================================================================

@painel55_bp.route('/api/auditoria/contas')
@login_required
@panel_permission_required('painel55')
def api_auditoria_contas():
    try:
        grav_filtro   = request.args.get('gravidade', '').strip()
        status_filtro = request.args.get('status_job', '').strip()
        so_critica    = request.args.get('so_critica', '').lower() in ('1', 'true')
        busca         = request.args.get('busca', '').strip()
        pagina        = max(1, int(request.args.get('pagina', '1') or '1'))
        por_pagina    = min(100, max(10, int(request.args.get('por_pagina', '50') or '50')))
        offset        = (pagina - 1) * por_pagina

        wheres = ["c.ie_conta_aberta IS DISTINCT FROM 'N'"]
        params = []

        if busca:
            wheres.append("(CAST(c.nr_atendimento AS TEXT) ILIKE %s "
                          "OR CAST(c.nr_interno_conta AS TEXT) ILIKE %s "
                          "OR COALESCE(c.ds_inconsistencia, '') ILIKE %s)")
            params += ['%' + busca + '%', '%' + busca + '%', '%' + busca + '%']

        having_parts = []
        if grav_filtro:
            having_parts.append(
                "CASE MAX(CASE a.gravidade "
                "WHEN 'critica' THEN 4 WHEN 'alta' THEN 3 "
                "WHEN 'media' THEN 2 WHEN 'baixa' THEN 1 ELSE 0 END) "
                "WHEN 4 THEN 'critica' WHEN 3 THEN 'alta' "
                "WHEN 2 THEN 'media' WHEN 1 THEN 'baixa' ELSE NULL END = %s"
            )
            params.append(grav_filtro)
        if so_critica:
            having_parts.append(
                "SUM(CASE WHEN a.gravidade = 'critica' THEN 1 ELSE 0 END) > 0"
            )
        having_sql = ('HAVING ' + ' AND '.join(having_parts)) if having_parts else ''

        # Filtro por status_job embutido direto na query principal (evita subquery)
        if status_filtro:
            wheres.append("(%s = '' OR COALESCE(j.status,'') = %s)")
            params += [status_filtro, status_filtro]

        where_sql = ' AND '.join(wheres)

        sql_base = """
            SELECT
                c.nr_atendimento,
                c.nr_interno_conta,
                c.dt_periodo_final,
                COUNT(a.id)                                                              AS total_achados,
                SUM(CASE WHEN a.gravidade = 'critica' THEN 1 ELSE 0 END)               AS criticos,
                SUM(CASE WHEN a.gravidade = 'alta'    THEN 1 ELSE 0 END)               AS altos,
                SUM(CASE WHEN a.gravidade = 'media'   THEN 1 ELSE 0 END)               AS medios,
                SUM(CASE WHEN a.gravidade = 'baixa'   THEN 1 ELSE 0 END)               AS baixos,
                SUM(CASE WHEN a.status_tratamento = 'pendente' THEN 1 ELSE 0 END)      AS pendentes,
                COALESCE(SUM(a.vl_risco), 0)                                            AS vl_risco_total,
                CASE MAX(CASE a.gravidade
                    WHEN 'critica' THEN 4 WHEN 'alta' THEN 3
                    WHEN 'media'   THEN 2 WHEN 'baixa' THEN 1 ELSE 0 END)
                    WHEN 4 THEN 'critica' WHEN 3 THEN 'alta'
                    WHEN 2 THEN 'media'   WHEN 1 THEN 'baixa' ELSE NULL
                END AS gravidade_maxima,
                j.status  AS status_job,
                j.dt_fim  AS dt_ultima_auditoria
            FROM core.conta c
            LEFT JOIN audit.achado a ON c.nr_atendimento = a.nr_atendimento
            LEFT JOIN LATERAL (
                SELECT status, dt_fim
                FROM audit.analise_job
                WHERE nr_interno_conta = c.nr_interno_conta
                   OR nr_atendimento   = CAST(c.nr_atendimento AS VARCHAR)
                ORDER BY dt_criacao DESC
                LIMIT 1
            ) j ON TRUE
            WHERE """ + where_sql + """
            GROUP BY c.nr_atendimento, c.nr_interno_conta, c.dt_periodo_final,
                     j.status, j.dt_fim
            """ + having_sql

        sql_total = "SELECT COUNT(1) AS total FROM (" + sql_base + ") _cnt"
        sql_pag   = (sql_base + " ORDER BY vl_risco_total DESC, criticos DESC, "
                     "c.dt_periodo_final DESC LIMIT %s OFFSET %s")

        params_total = params[:]
        params_pag   = params + [por_pagina, offset]

        with _cursor() as cur:
            cur.execute(sql_total, params_total if params_total else None)
            total_row = cur.fetchone()
            total = int(total_row[list(total_row.keys())[0]]) if total_row else 0

        with _cursor() as cur:
            cur.execute(sql_pag, params_pag if params_pag else None)
            contas = [_serial(dict(r)) for r in cur.fetchall()]

        return jsonify({
            'success': True,
            'contas':  contas,
            'total':   total,
            'pagina':  pagina,
            'por_pagina': por_pagina,
        })
    except Exception as e:
        current_app.logger.error('Erro listar contas auditoria: %s', e, exc_info=True)
        return jsonify({'success': False, 'error': 'Erro ao buscar contas'}), 500


# =============================================================================
# Listagem de atendimentos agrupados (sidebar UX — 1 item por atendimento)
# =============================================================================

@painel55_bp.route('/api/auditoria/atendimentos')
@login_required
@panel_permission_required('painel55')
def api_auditoria_atendimentos():
    try:
        busca        = request.args.get('busca',     '').strip()
        grav_filtro  = request.args.get('gravidade', '').strip()
        setor_filtro = request.args.get('setor',     '').strip()
        pagina       = max(1, int(request.args.get('pagina',    '1')   or '1'))
        por_pagina   = min(200, max(10, int(request.args.get('por_pagina', '100') or '100')))
        offset       = (pagina - 1) * por_pagina

        # Filtros para a CTE contas_agg
        ca_wheres = ["c.ie_conta_aberta IS DISTINCT FROM 'N'"]
        params    = []
        if busca:
            ca_wheres.append(
                "(CAST(c.nr_atendimento AS TEXT) ILIKE %s "
                "OR CAST(c.nr_interno_conta AS TEXT) ILIKE %s)"
            )
            params += ['%' + busca + '%', '%' + busca + '%']
        ca_where_sql = ' AND '.join(ca_wheres)

        # Filtros externos (aplicados ao join final)
        outer_wheres = []
        outer_params = []
        if setor_filtro:
            outer_wheres.append('sa.cd_setor_atendimento = %s')
            outer_params.append(int(setor_filtro))
        if grav_filtro:
            outer_wheres.append('aa.gravidade_maxima = %s')
            outer_params.append(grav_filtro)
        outer_where_sql = ('WHERE ' + ' AND '.join(outer_wheres)) if outer_wheres else ''

        # CTE principal: achados e setores agregados separadamente para evitar
        # multiplicação de linhas ao cruzar contas × achados
        sql_cte = """
            WITH
            ca AS (
                SELECT
                    c.nr_atendimento,
                    COUNT(DISTINCT c.nr_interno_conta) AS qt_contas,
                    MAX(c.dt_periodo_final)             AS dt_periodo_final_max
                FROM core.conta c
                WHERE {ca_where}
                GROUP BY c.nr_atendimento
            ),
            aa AS (
                SELECT
                    a.nr_atendimento,
                    COUNT(a.id)                                                         AS total_achados,
                    SUM(CASE WHEN a.gravidade = 'critica' THEN 1 ELSE 0 END)           AS criticos,
                    SUM(CASE WHEN a.gravidade = 'alta'    THEN 1 ELSE 0 END)           AS altos,
                    SUM(CASE WHEN a.gravidade = 'media'   THEN 1 ELSE 0 END)           AS medios,
                    SUM(CASE WHEN a.gravidade = 'baixa'   THEN 1 ELSE 0 END)           AS baixos,
                    SUM(CASE WHEN a.status_tratamento = 'pendente' THEN 1 ELSE 0 END)  AS pendentes,
                    COALESCE(SUM(a.vl_risco), 0)                                        AS vl_risco_total,
                    CASE MAX(CASE a.gravidade
                        WHEN 'critica' THEN 4 WHEN 'alta' THEN 3
                        WHEN 'media'   THEN 2 WHEN 'baixa' THEN 1 ELSE 0 END)
                        WHEN 4 THEN 'critica' WHEN 3 THEN 'alta'
                        WHEN 2 THEN 'media'   WHEN 1 THEN 'baixa' ELSE NULL
                    END AS gravidade_maxima
                FROM audit.achado a
                INNER JOIN ca ON ca.nr_atendimento = a.nr_atendimento
                WHERE (
                    a.nr_interno_conta IS NULL
                    OR EXISTS (
                        SELECT 1 FROM core.conta ck
                        WHERE ck.nr_interno_conta = a.nr_interno_conta
                          AND ck.ie_conta_aberta IS DISTINCT FROM 'N'
                    )
                )
                GROUP BY a.nr_atendimento
            ),
            sa AS (
                SELECT DISTINCT ON (nr_atendimento) nr_atendimento, cd_setor_atendimento
                FROM core.item_procedimento
                WHERE nr_atendimento IN (SELECT nr_atendimento FROM ca)
                  AND cd_setor_atendimento IS NOT NULL
                ORDER BY nr_atendimento, cd_setor_atendimento
            )
        """.format(ca_where=ca_where_sql)

        sql_select = """
            SELECT
                ca.nr_atendimento,
                ca.qt_contas,
                ca.dt_periodo_final_max,
                COALESCE(aa.total_achados,  0) AS total_achados,
                COALESCE(aa.criticos,       0) AS criticos,
                COALESCE(aa.altos,          0) AS altos,
                COALESCE(aa.medios,         0) AS medios,
                COALESCE(aa.baixos,         0) AS baixos,
                COALESCE(aa.pendentes,      0) AS pendentes,
                COALESCE(aa.vl_risco_total, 0) AS vl_risco_total,
                aa.gravidade_maxima,
                sa.cd_setor_atendimento,
                (
                    SELECT JSON_AGG(
                        JSON_BUILD_OBJECT(
                            'nr_interno_conta',    c2.nr_interno_conta,
                            'dt_periodo_inicial',  TO_CHAR(c2.dt_periodo_inicial, 'YYYY-MM-DD'),
                            'dt_periodo_final',    TO_CHAR(c2.dt_periodo_final,   'YYYY-MM-DD'),
                            'ie_conta_aberta',     c2.ie_conta_aberta,
                            'status_job',          j2.status,
                            'dt_ultima_auditoria', TO_CHAR(j2.dt_fim, 'YYYY-MM-DD HH24:MI')
                        ) ORDER BY c2.dt_periodo_final DESC
                    )
                    FROM core.conta c2
                    LEFT JOIN LATERAL (
                        SELECT status, dt_fim FROM audit.analise_job
                        WHERE nr_interno_conta = c2.nr_interno_conta
                        ORDER BY dt_criacao DESC LIMIT 1
                    ) j2 ON TRUE
                    WHERE c2.nr_atendimento = ca.nr_atendimento
                      AND c2.ie_conta_aberta IS DISTINCT FROM 'N'
                ) AS contas
            FROM ca
            LEFT JOIN aa ON aa.nr_atendimento = ca.nr_atendimento
            LEFT JOIN sa ON sa.nr_atendimento = ca.nr_atendimento
            {outer_where}
        """.format(outer_where=outer_where_sql)

        all_params = params + outer_params

        sql_count = (sql_cte
                     + "SELECT COUNT(1) AS total FROM ca "
                     + "LEFT JOIN aa ON aa.nr_atendimento = ca.nr_atendimento "
                     + "LEFT JOIN sa ON sa.nr_atendimento = ca.nr_atendimento "
                     + outer_where_sql)
        sql_pag   = (sql_cte + sql_select
                     + " ORDER BY COALESCE(aa.vl_risco_total,0) DESC,"
                       " COALESCE(aa.criticos,0) DESC,"
                       " ca.dt_periodo_final_max DESC LIMIT %s OFFSET %s")

        with _cursor() as cur:
            cur.execute(sql_count, all_params if all_params else None)
            r = cur.fetchone()
            total = int(r['total']) if r else 0

        with _cursor() as cur:
            cur.execute(sql_pag, (all_params + [por_pagina, offset]) if all_params
                        else [por_pagina, offset])
            rows = cur.fetchall()

        atendimentos = []
        for r in rows:
            d = _serial(dict(r))
            if not isinstance(d.get('contas'), list):
                d['contas'] = []
            atendimentos.append(d)

        return jsonify({
            'success':      True,
            'atendimentos': atendimentos,
            'total':        total,
            'pagina':       pagina,
            'por_pagina':   por_pagina,
        })
    except Exception as e:
        current_app.logger.error(
            'Erro listar atendimentos auditoria: %s', e, exc_info=True)
        return jsonify({'success': False, 'error': 'Erro ao buscar atendimentos'}), 500


# =============================================================================
# Setores disponíveis (para filtro da sidebar)
# =============================================================================

@painel55_bp.route('/api/auditoria/setores')
@login_required
@panel_permission_required('painel55')
def api_auditoria_setores():
    try:
        with _cursor() as cur:
            cur.execute("""
                SELECT DISTINCT cd_setor_atendimento
                FROM core.item_procedimento
                WHERE cd_setor_atendimento IS NOT NULL
                ORDER BY cd_setor_atendimento
            """)
            codigos = [r['cd_setor_atendimento'] for r in cur.fetchall()]

        if not codigos:
            return jsonify({'success': True, 'setores': []})

        # Mapa de nomes: _SETORES_HAC (curado) > painel_clinico_tasy (ETL real) > fallback
        setor_map = {}
        try:
            from backend.database import get_db_cursor
            with get_db_cursor() as cur:
                cur.execute(
                    "SELECT DISTINCT ON (cd_setor_atendimento) "
                    "cd_setor_atendimento, nm_setor "
                    "FROM painel_clinico_tasy "
                    "WHERE cd_setor_atendimento = ANY(%s) "
                    "  AND nm_setor IS NOT NULL "
                    "  AND TRIM(nm_setor) <> '' "
                    "ORDER BY cd_setor_atendimento, nm_setor",
                    (codigos,)
                )
                for r in cur.fetchall():
                    setor_map[r['cd_setor_atendimento']] = r['nm_setor']
        except Exception:
            pass

        setores = [
            {'cd': cd, 'nm': _SETORES_HAC.get(cd) or setor_map.get(cd) or 'Setor ' + str(cd)}
            for cd in codigos
        ]
        setores.sort(key=lambda s: s['nm'])
        return jsonify({'success': True, 'setores': setores})
    except Exception as e:
        current_app.logger.error('Erro setores auditoria: %s', e, exc_info=True)
        return jsonify({'success': False, 'error': 'Erro ao buscar setores'}), 500


# =============================================================================
# Achados de uma conta (por nr_interno_conta)
# =============================================================================

@painel55_bp.route('/api/auditoria/contas/<nr_interno_conta>/achados')
@login_required
@panel_permission_required('painel55')
def api_auditoria_achados(nr_interno_conta):
    try:
        grav   = request.args.get('gravidade', '').strip()
        tipo   = request.args.get('tipo', '').strip()
        status = request.args.get('status', '').strip()

        # Busca achados por nr_interno_conta E achados do atendimento sem conta (nr_interno_conta NULL)
        wheres = [
            "(a.nr_interno_conta = %s OR "
            " (a.nr_interno_conta IS NULL AND a.nr_atendimento = "
            "  (SELECT nr_atendimento FROM core.conta "
            "   WHERE nr_interno_conta = %s LIMIT 1)))"
        ]
        params = [nr_interno_conta, nr_interno_conta]

        if grav:
            wheres.append("a.gravidade = %s")
            params.append(grav)
        if tipo:
            wheres.append("a.tipo_achado = %s")
            params.append(tipo)
        if status:
            wheres.append("a.status_tratamento = %s")
            params.append(status)

        where_sql = ' AND '.join(wheres)

        with _cursor() as cur:
            cur.execute("""
                SELECT
                    a.id,
                    a.nr_atendimento,
                    a.nr_interno_conta,
                    a.cd_regra,
                    r.ds_regra,
                    a.tipo_achado,
                    a.gravidade,
                    a.item_tipo,
                    a.item_ref,
                    a.ds_encontrado,
                    a.ds_esperado,
                    a.evidencia_tabela,
                    a.evidencia_id,
                    a.evidencia_trecho,
                    a.vl_risco,
                    a.origem_deteccao,
                    a.status_tratamento,
                    a.dt_achado,
                    a.explicacao_ia,
                    a.recomendacao_ia
                FROM audit.achado a
                LEFT JOIN audit.regra r ON a.cd_regra = r.cd_regra
                WHERE """ + where_sql + """
                ORDER BY
                    CASE a.gravidade
                        WHEN 'critica' THEN 1 WHEN 'alta'  THEN 2
                        WHEN 'media'   THEN 3 WHEN 'baixa' THEN 4 ELSE 5
                    END,
                    a.dt_achado DESC
            """, params)
            achados = [_serial(dict(r)) for r in cur.fetchall()]

        return jsonify({'success': True, 'achados': achados})
    except Exception as e:
        current_app.logger.error('Erro achados conta %s: %s', nr_interno_conta, e, exc_info=True)
        return jsonify({'success': False, 'error': 'Erro ao buscar achados'}), 500


# =============================================================================
# Criar job de auditoria (por nr_interno_conta, idempotente)
# =============================================================================

@painel55_bp.route('/api/auditoria/contas/<nr_interno_conta>/auditar', methods=['POST'])
@login_required
@panel_permission_required('painel55')
def api_auditoria_auditar(nr_interno_conta):
    global _jobs_ativos
    try:
        # Busca nr_atendimento da conta
        with _cursor() as cur:
            cur.execute(
                "SELECT nr_atendimento FROM core.conta WHERE nr_interno_conta = %s LIMIT 1",
                (nr_interno_conta,)
            )
            row = cur.fetchone()
        if not row:
            return jsonify({'success': False, 'error': 'Conta não encontrada'}), 404
        nr_atendimento = row['nr_atendimento']

        # Idempotência: se há job fila|rodando recente (< 10 min), devolve o existente.
        # Jobs mais antigos são considerados órfãos (restart do servidor) e marcados como erro.
        with _cursor() as cur:
            cur.execute("""
                SELECT id, status,
                       (now() - dt_criacao) > interval '10 minutes' AS orfao
                FROM audit.analise_job
                WHERE nr_interno_conta = %s AND status IN ('fila', 'rodando')
                ORDER BY dt_criacao DESC LIMIT 1
            """, (nr_interno_conta,))
            existente = cur.fetchone()

        if existente:
            if existente['orfao']:
                # Job abandonado por restart — marcar como erro e criar novo
                with _cursor() as cur:
                    cur.execute(
                        "UPDATE audit.analise_job SET status = 'erro', etapa = 'erro', "
                        "dt_fim = now(), erro = 'Abandonado por reinicialização do servidor' "
                        "WHERE id = %s",
                        (existente['id'],)
                    )
            else:
                return jsonify({'success': True, 'job_id': existente['id'],
                                'status': existente['status'], 'existente': True}), 202

        # Verifica capacidade
        with _jobs_lock:
            if _jobs_ativos >= _JOBS_MAX:
                return jsonify({'success': False,
                                'error': 'Servidor ocupado — tente em alguns instantes'}), 429
            _jobs_ativos += 1

        # Cria job no banco
        usuario_pseud = _usuario_pseud()
        with _cursor() as cur:
            cur.execute("""
                INSERT INTO audit.analise_job
                    (nr_atendimento, nr_interno_conta, status, usuario_pseud, dt_criacao)
                VALUES (%s, %s, 'fila', %s, NOW())
                RETURNING id
            """, (str(nr_atendimento), nr_interno_conta, usuario_pseud))
            job_id = cur.fetchone()['id']

        t = threading.Thread(
            target=_executar_analise,
            args=(job_id, nr_atendimento, nr_interno_conta),
            daemon=True,
            name='audit-' + str(job_id),
        )
        t.start()

        return jsonify({'success': True, 'job_id': job_id, 'existente': False}), 202

    except Exception as e:
        with _jobs_lock:
            if _jobs_ativos > 0:
                _jobs_ativos -= 1
        current_app.logger.error('Erro criar job auditoria: %s', e, exc_info=True)
        return jsonify({'success': False, 'error': 'Erro ao iniciar auditoria'}), 500


# =============================================================================
# Status de job
# =============================================================================

@painel55_bp.route('/api/auditoria/jobs/<int:job_id>')
@login_required
@panel_permission_required('painel55')
def api_auditoria_job_status(job_id):
    try:
        with _cursor() as cur:
            cur.execute("""
                SELECT id, nr_atendimento, nr_interno_conta, status, etapa,
                       dt_criacao, dt_inicio, dt_fim,
                       qt_achados_regras, qt_eventos_extraidos, qt_achados_ia,
                       ia_usada, modelo, versao_regras, erro
                FROM audit.analise_job
                WHERE id = %s
            """, (job_id,))
            row = cur.fetchone()
        if not row:
            return jsonify({'success': False, 'error': 'Job não encontrado'}), 404
        return jsonify({'success': True, 'job': _serial(dict(row))})
    except Exception as e:
        current_app.logger.error('Erro status job %s: %s', job_id, e, exc_info=True)
        return jsonify({'success': False, 'error': 'Erro ao buscar job'}), 500


# =============================================================================
# Feedback em achado
# =============================================================================

_DECISOES_VALIDAS = frozenset(('procede_corrigido', 'nao_procede', 'ja_justificado'))


@painel55_bp.route('/api/auditoria/achados/<int:achado_id>/feedback', methods=['POST'])
@login_required
@panel_permission_required('painel55')
def api_auditoria_feedback(achado_id):
    try:
        dados = request.get_json(silent=True) or {}
        decisao       = str(dados.get('decisao', '')).strip()
        justificativa = str(dados.get('justificativa', '')).strip()

        if decisao not in _DECISOES_VALIDAS:
            return jsonify({'success': False, 'error': 'Decisão inválida'}), 400
        if len(justificativa) < 10:
            return jsonify({'success': False,
                            'error': 'Justificativa muito curta (mínimo 10 caracteres)'}), 400

        usuario_id   = session.get('usuario_id')
        usuario_nome = session.get('nome_completo') or session.get('usuario', '')

        with _cursor(dict_cur=False) as cur:
            cur.execute("SELECT id FROM audit.achado WHERE id = %s", (achado_id,))
            if not cur.fetchone():
                return jsonify({'success': False, 'error': 'Achado não encontrado'}), 404
            cur.execute(
                "UPDATE audit.achado "
                "SET status_tratamento = %s WHERE id = %s",
                (decisao, achado_id)
            )
            cur.execute(
                "INSERT INTO audit.feedback "
                "(achado_id, decisao, justificativa, usuario_id, usuario_nome, criado_em) "
                "VALUES (%s, %s, %s, %s, %s, NOW())",
                (achado_id, decisao, justificativa, usuario_id, usuario_nome)
            )
        return jsonify({'success': True})
    except Exception as e:
        current_app.logger.error('Erro feedback achado %s: %s', achado_id, e, exc_info=True)
        return jsonify({'success': False, 'error': 'Erro ao registrar feedback'}), 500


# =============================================================================
# Explicação IA sob demanda (por achado com evidência de evolução)
# =============================================================================

@painel55_bp.route('/api/auditoria/achados/<int:achado_id>/explicar-ia', methods=['POST'])
@login_required
@panel_permission_required('painel55')
def api_auditoria_explicar_ia(achado_id):
    try:
        if not ia_esta_viva():
            return jsonify({'success': False, 'error': 'IA desativada (kill switch)'}), 409
        if os.getenv('IA_HABILITADA', 'false').lower() not in ('true', '1'):
            return jsonify({'success': False, 'error': 'IA não habilitada neste ambiente'}), 409

        with _cursor() as cur:
            cur.execute("SELECT valor FROM audit.parametro WHERE chave = 'ia_externa_autorizada'")
            p = cur.fetchone()
        if not (p and p['valor'] in ('true', 't', '1')):
            return jsonify({'success': False, 'error': 'IA externa não autorizada neste ambiente'}), 409

        with _cursor() as cur:
            cur.execute("""
                SELECT a.id, a.cd_regra, r.ds_regra,
                       a.tipo_achado, a.gravidade,
                       a.ds_encontrado, a.ds_esperado,
                       a.vl_risco, a.evidencia_trecho,
                       a.explicacao_ia, a.recomendacao_ia
                FROM audit.achado a
                LEFT JOIN audit.regra r ON a.cd_regra = r.cd_regra
                WHERE a.id = %s
            """, (achado_id,))
            ach = cur.fetchone()
        if not ach:
            return jsonify({'success': False, 'error': 'Achado não encontrado'}), 404
        ach = dict(ach)

        # Cache: já tem explicação salva
        if ach.get('explicacao_ia'):
            return jsonify({
                'success': True,
                'explicacao_ia':   ach['explicacao_ia'],
                'recomendacao_ia': ach.get('recomendacao_ia'),
                'cached': True,
            })

        trecho = ach.get('evidencia_trecho') or None
        if not trecho:
            return jsonify({
                'success': False,
                'error': 'Achado sem trecho de evolução — não é possível gerar explicação com IA',
            }), 422

        from backend.auditoria.leitor_groq import LeitorGroq
        leitor = LeitorGroq()
        nr_ref = hashlib.md5(str(achado_id).encode()).hexdigest()[:8]
        expl, rec = leitor.explicar_achado(ach, nr_ref, trecho=trecho)

        if not expl:
            return jsonify({'success': False, 'error': 'IA não conseguiu gerar explicação para este achado'}), 502

        with _cursor(dict_cur=False) as cur:
            cur.execute(
                "UPDATE audit.achado SET explicacao_ia = %s, recomendacao_ia = %s WHERE id = %s",
                (expl, rec, achado_id)
            )

        return jsonify({'success': True, 'explicacao_ia': expl, 'recomendacao_ia': rec})
    except Exception as e:
        current_app.logger.error('Erro explicar IA achado %s: %s', achado_id, e, exc_info=True)
        return jsonify({'success': False, 'error': 'Erro ao gerar explicação'}), 500


# =============================================================================
# Mapeamentos R28 — CRUD de ref.material_alias
# =============================================================================

@painel55_bp.route('/api/auditoria/material-alias')
@login_required
@panel_permission_required('painel55')
def api_auditoria_material_alias_list():
    busca             = request.args.get('busca',       '').strip()
    so_pendentes      = request.args.get('pendentes',   '').lower() in ('1', 'true')
    so_confirmados    = request.args.get('confirmados', '').lower() in ('1', 'true')
    try:
        wheres, params = ['1=1'], []
        if busca:
            wheres.append(
                "(LOWER(termo) LIKE %s OR LOWER(ds_material) LIKE %s OR cd_material LIKE %s)"
            )
            busca_like = '%' + busca.lower() + '%'
            params += [busca_like, busca_like, '%' + busca + '%']
        if so_pendentes:
            wheres.append('confirmado = FALSE')
        if so_confirmados:
            wheres.append('confirmado = TRUE')
        with _cursor() as cur:
            cur.execute(
                "SELECT id, termo, cd_material, ds_material, confirmado, "
                "       criado_em, atualizado_em "
                "FROM ref.material_alias "
                "WHERE " + ' AND '.join(wheres) +
                " ORDER BY confirmado, LOWER(termo) LIMIT 500",
                params or None
            )
            aliases = [_serial(dict(r)) for r in cur.fetchall()]
        return jsonify({'success': True, 'aliases': aliases})
    except Exception as e:
        current_app.logger.error('Erro listar material-alias: %s', e, exc_info=True)
        return jsonify({'success': False, 'error': 'Erro ao buscar aliases'}), 500


@painel55_bp.route('/api/auditoria/material-alias', methods=['POST'])
@login_required
@panel_permission_required('painel55')
def api_auditoria_material_alias_create():
    dados       = request.get_json(silent=True) or {}
    termo       = (dados.get('termo')       or '').strip()
    cd_material = (dados.get('cd_material') or '').strip()
    ds_material = (dados.get('ds_material') or '').strip() or None
    confirmado  = bool(dados.get('confirmado', False))

    if not termo or not cd_material:
        return jsonify({'success': False, 'error': 'termo e cd_material são obrigatórios'}), 400

    try:
        with _cursor() as cur:
            cur.execute(
                "SELECT id FROM ref.material_alias "
                "WHERE LOWER(TRIM(termo)) = LOWER(TRIM(%s))",
                (termo,)
            )
            existing = cur.fetchone()
            if existing:
                cur.execute(
                    "UPDATE ref.material_alias "
                    "SET cd_material=%s, ds_material=%s, confirmado=%s, atualizado_em=NOW() "
                    "WHERE id=%s RETURNING id",
                    (cd_material, ds_material, confirmado, existing['id'])
                )
            else:
                cur.execute(
                    "INSERT INTO ref.material_alias (termo, cd_material, ds_material, confirmado) "
                    "VALUES (%s, %s, %s, %s) RETURNING id",
                    (termo, cd_material, ds_material, confirmado)
                )
            row = cur.fetchone()
            new_id = row['id'] if row else None
        return jsonify({'success': True, 'id': new_id}), 201
    except Exception as e:
        current_app.logger.error('Erro criar material-alias: %s', e, exc_info=True)
        return jsonify({'success': False, 'error': 'Erro ao criar alias'}), 500


_CAMPOS_ALIAS = ('cd_material', 'ds_material', 'confirmado')


@painel55_bp.route('/api/auditoria/material-alias/<int:alias_id>', methods=['PUT'])
@login_required
@panel_permission_required('painel55')
def api_auditoria_material_alias_update(alias_id):
    dados   = request.get_json(silent=True) or {}
    sets, vals = [], []
    for campo in _CAMPOS_ALIAS:
        if campo in dados:
            sets.append(campo + ' = %s')
            vals.append(dados[campo])
    if not sets:
        return jsonify({'success': False, 'error': 'Nenhum campo para atualizar'}), 400
    sets.append('atualizado_em = NOW()')
    vals.append(alias_id)
    try:
        with _cursor(dict_cur=False) as cur:
            cur.execute(
                'UPDATE ref.material_alias SET ' + ', '.join(sets) + ' WHERE id = %s',
                vals
            )
            if cur.rowcount == 0:
                return jsonify({'success': False, 'error': 'Alias não encontrado'}), 404
        return jsonify({'success': True})
    except Exception as e:
        current_app.logger.error('Erro atualizar material-alias %s: %s', alias_id, e, exc_info=True)
        return jsonify({'success': False, 'error': 'Erro ao atualizar alias'}), 500


@painel55_bp.route('/api/auditoria/material-alias/<int:alias_id>', methods=['DELETE'])
@login_required
@panel_permission_required('painel55')
def api_auditoria_material_alias_delete(alias_id):
    try:
        with _cursor(dict_cur=False) as cur:
            cur.execute('DELETE FROM ref.material_alias WHERE id = %s', (alias_id,))
            if cur.rowcount == 0:
                return jsonify({'success': False, 'error': 'Alias não encontrado'}), 404
        return jsonify({'success': True})
    except Exception as e:
        current_app.logger.error('Erro deletar material-alias %s: %s', alias_id, e, exc_info=True)
        return jsonify({'success': False, 'error': 'Erro ao excluir alias'}), 500


@painel55_bp.route('/api/auditoria/itens-nao-mapeados')
@login_required
@panel_permission_required('painel55')
def api_auditoria_itens_nao_mapeados():
    """Termos extraídos pela IA que não têm alias em ref.material_alias."""
    try:
        with _cursor() as cur:
            cur.execute("""
                SELECT ed.ds_item,
                       COUNT(ed.id)          AS ocorrencias,
                       MAX(ed.dt_extracao)   AS ultima_extracao
                FROM core.evento_documentado ed
                WHERE ed.cd_material_resolvido IS NULL
                  AND ed.ds_item               IS NOT NULL
                  AND NOT EXISTS (
                      SELECT 1 FROM ref.material_alias ma
                      WHERE LOWER(TRIM(ma.termo)) = LOWER(TRIM(ed.ds_item))
                  )
                GROUP BY ed.ds_item
                ORDER BY COUNT(ed.id) DESC, ed.ds_item
                LIMIT 200
            """)
            itens = [_serial(dict(r)) for r in cur.fetchall()]
        return jsonify({'success': True, 'itens': itens})
    except Exception as e:
        current_app.logger.error('Erro itens-nao-mapeados: %s', e, exc_info=True)
        return jsonify({'success': False, 'error': 'Erro ao buscar itens'}), 500


# =============================================================================
# Catálogo de regras
# =============================================================================

@painel55_bp.route('/api/auditoria/regras')
@login_required
@panel_permission_required('painel55')
def api_auditoria_regras():
    try:
        with _cursor() as cur:
            cur.execute("""
                SELECT cd_regra, ds_regra,
                       tipo_achado, gravidade,
                       ativo, vigencia_inicio, vigencia_fim
                FROM audit.regra
                WHERE ativo = TRUE
                ORDER BY cd_regra
            """)
            regras = [_serial(dict(r)) for r in cur.fetchall()]
        return jsonify({'success': True, 'regras': regras})
    except Exception as e:
        current_app.logger.error('Erro listar regras: %s', e, exc_info=True)
        return jsonify({'success': False, 'error': 'Erro ao buscar regras'}), 500


# =============================================================================
# Validação do ambiente (Parte A)
# =============================================================================

@painel55_bp.route('/api/auditoria/validacao')
@login_required
@panel_permission_required('painel55')
def api_auditoria_validacao():
    try:
        from backend.auditoria.validacao import executar
        raiz = os.path.dirname(os.path.dirname(os.path.dirname(
               os.path.abspath(__file__))))
        resultado = executar(raiz)
        return jsonify({'success': True, 'validacao': resultado})
    except Exception as e:
        current_app.logger.error('Erro validação auditoria: %s', e, exc_info=True)
        return jsonify({'success': False, 'error': 'Erro ao executar validação'}), 500


# =============================================================================
# Kill switch da IA (admin)
# =============================================================================

@painel55_bp.route('/api/auditoria/ia/kill', methods=['POST'])
@login_required
@panel_permission_required('painel55')
def api_auditoria_ia_kill():
    if not session.get('is_admin', False):
        return jsonify({'success': False, 'error': 'Somente admins podem acionar o kill switch'}), 403
    matar_ia()
    current_app.logger.warning('Kill switch IA acionado pelo usuário %s', session.get('usuario'))
    return jsonify({'success': True, 'ia_viva': ia_esta_viva(),
                    'mensagem': 'IA desligada até reinicialização do servidor'})


# =============================================================================
# Status da IA
# =============================================================================

@painel55_bp.route('/api/auditoria/ia/status')
@login_required
@panel_permission_required('painel55')
def api_auditoria_ia_status():
    ia_env = os.getenv('IA_HABILITADA', 'false').lower() in ('true', '1')
    groq_key_ok = bool(os.getenv('GROQ_API_KEY', ''))

    # Porta 2: verificar parâmetro no banco auditoria
    db_autorizada = False
    db_erro = None
    try:
        with _cursor() as cur:
            cur.execute(
                "SELECT valor FROM audit.parametro WHERE chave = 'ia_externa_autorizada'"
            )
            p = cur.fetchone()
            if p is None:
                db_erro = 'linha nao encontrada em audit.parametro'
            else:
                db_autorizada = str(p['valor']).strip().lower() in ('true', 't', '1')
    except Exception as exc:
        db_erro = str(exc)

    # Verificar biblioteca groq instalada
    groq_instalada = False
    try:
        import importlib
        groq_instalada = importlib.util.find_spec('groq') is not None
    except Exception:
        pass

    ia_pronta = ia_esta_viva() and ia_env and groq_key_ok and db_autorizada and groq_instalada

    bloqueios = []
    if not ia_esta_viva():
        bloqueios.append('kill_switch_ativado')
    if not ia_env:
        bloqueios.append('IA_HABILITADA nao e true no .env')
    if not groq_key_ok:
        bloqueios.append('GROQ_API_KEY vazia ou ausente no .env')
    if not groq_instalada:
        bloqueios.append('biblioteca groq nao instalada (pip install groq)')
    if not db_autorizada:
        bloqueios.append(
            'audit.parametro ia_externa_autorizada nao e true'
            + (' — ' + db_erro if db_erro else '')
        )

    return jsonify({
        'success': True,
        'ia_pronta': ia_pronta,
        'gates': {
            'kill_switch_vivo':       ia_esta_viva(),
            'ia_habilitada_env':      ia_env,
            'groq_key_configurada':   groq_key_ok,
            'groq_lib_instalada':     groq_instalada,
            'db_ia_externa_autorizada': db_autorizada,
            'db_erro':                db_erro,
        },
        'bloqueios': bloqueios,
    })


# =============================================================================
# Resumo clínico IA por atendimento
# =============================================================================

_SISTEMA_RESUMO_CLINICO = (
    'Você é um auditor hospitalar especialista em faturamento. '
    'Analise as evoluções clínicas a seguir e responda SOMENTE com JSON válido:\n'
    '{"condicao_principal":"...","intervencoes_documentadas":["..."],'
    '"observacao_auditoria":"..."}\n\n'
    '"condicao_principal": em 1-2 frases, qual é a condição clínica principal documentada.\n'
    '"intervencoes_documentadas": lista de até 6 intervenções, procedimentos ou materiais '
    'relevantes para faturamento que aparecem nas evoluções.\n'
    '"observacao_auditoria": em 1-2 frases, aspectos relevantes ao faturamento '
    '(procedimentos específicos, materiais, dieta, suporte ventilatório).\n'
    'Use linguagem hospitalar acessível. '
    'NUNCA mencione nomes de pacientes, datas de nascimento ou documentos pessoais.'
)


@painel55_bp.route('/api/auditoria/atendimentos/<int:nr_atendimento>/resumo')
@login_required
@panel_permission_required('painel55')
def api_auditoria_resumo_paciente(nr_atendimento):
    try:
        if not ia_esta_viva():
            return jsonify({'success': False, 'error': 'IA desativada (kill switch)'}), 409
        if os.getenv('IA_HABILITADA', 'false').lower() not in ('true', '1'):
            return jsonify({'success': False, 'error': 'IA não habilitada neste ambiente'}), 409

        with _cursor() as cur:
            cur.execute(
                "SELECT valor FROM audit.parametro WHERE chave = 'ia_externa_autorizada'"
            )
            p = cur.fetchone()
        if not (p and p['valor'] in ('true', 't', '1')):
            return jsonify({'success': False, 'error': 'IA externa não autorizada neste ambiente'}), 409

        chave = os.getenv('GROQ_API_KEY', '')
        if not chave:
            return jsonify({'success': False, 'error': 'Chave de API não configurada'}), 500

        with _cursor() as cur:
            cur.execute("""
                SELECT e.texto_limpo,
                       e.dt_evolucao,
                       e.ie_evolucao_clinica,
                       t.ds_tipo
                FROM core.evolucao e
                LEFT JOIN ref.tipo_evolucao t ON t.cd_tipo = e.ie_evolucao_clinica
                WHERE e.nr_atendimento = %s
                  AND e.texto_limpo IS NOT NULL
                ORDER BY e.dt_evolucao DESC
                LIMIT 12
            """, (nr_atendimento,))
            evolucoes = [dict(r) for r in cur.fetchall()]

        if not evolucoes:
            return jsonify({
                'success': False,
                'error': 'Nenhuma evolução encontrada para este atendimento',
            }), 404

        trechos = []
        for i, ev in enumerate(evolucoes):
            texto = limpar_texto_rtf(ev.get('texto_limpo') or '')
            if len(texto) < 15:
                continue
            dt_str = ''
            try:
                if ev.get('dt_evolucao'):
                    dt_str = ev['dt_evolucao'].strftime('%d/%m %H:%M')
            except Exception:
                pass
            tipo = ev.get('ds_tipo') or ev.get('ie_evolucao_clinica') or ''
            cab = '[Evo ' + (dt_str or str(i + 1))
            if tipo:
                cab += ' — ' + tipo
            cab += ']'
            trechos.append(cab + '\n' + texto[:1800])

        if not trechos:
            return jsonify({
                'success': False,
                'error': 'Evoluções sem texto útil para análise',
            }), 422

        payload = '\n\n---\n\n'.join(trechos)

        from backend.auditoria.leitor_groq import LeitorGroq
        leitor = LeitorGroq()
        resposta_raw = leitor._chamar_api(chave, payload, sistema=_SISTEMA_RESUMO_CLINICO)
        if resposta_raw is None:
            return jsonify({'success': False, 'error': 'Falha na chamada à IA. Tente novamente.'}), 502

        import json as _json
        import re as _re
        try:
            resultado = _json.loads(resposta_raw)
        except Exception:
            m = _re.search(r'\{.*\}', resposta_raw, _re.DOTALL)
            if m:
                try:
                    resultado = _json.loads(m.group(0))
                except Exception:
                    return jsonify({'success': False, 'error': 'Resposta da IA em formato inválido'}), 502
            else:
                return jsonify({'success': False, 'error': 'Resposta da IA em formato inválido'}), 502

        _log.info('Resumo clínico gerado (nr_atendimento hash=%s)',
                  hashlib.md5(str(nr_atendimento).encode()).hexdigest()[:8])

        return jsonify({
            'success': True,
            'resumo': {
                'condicao_principal':        str(resultado.get('condicao_principal') or '').strip()[:600],
                'intervencoes_documentadas': [str(x)[:200] for x in (resultado.get('intervencoes_documentadas') or [])[:6]],
                'observacao_auditoria':      str(resultado.get('observacao_auditoria') or '').strip()[:600],
            },
            'evolucoes_analisadas': len(trechos),
        })

    except Exception as e:
        current_app.logger.error(
            'Erro resumo paciente (hash=%s): %s',
            hashlib.md5(str(nr_atendimento).encode()).hexdigest()[:8],
            e, exc_info=True,
        )
        return jsonify({'success': False, 'error': 'Erro ao gerar resumo'}), 500
