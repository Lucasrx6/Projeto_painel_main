# -*- coding: utf-8 -*-
"""
Painel 33 - Autorizacoes de Convenio
Hospital Anchieta

Consulta a view vw_painel33_autorizacoes.
Filtros aceitam valores multiplos separados por virgula.
"""

import io
import csv
import time
import threading
import traceback
import statistics
from datetime import datetime, date
from decimal import Decimal
from flask import Blueprint, request, jsonify, send_from_directory, session, Response
from psycopg2.extras import RealDictCursor
from backend.database import get_db_connection
from backend.middleware.decorators import login_required
from backend.user_management import verificar_permissao_painel
from backend.cache import cache_route

painel33_bp = Blueprint('painel33', __name__)

# Cache para /filtros — evita 7 queries DISTINCT a cada carregamento
_filtros_cache      = {'data': None, 'ts': 0.0}
_filtros_lock       = threading.Lock()
FILTROS_TTL_SEG     = 300  # 5 minutos

# Limite máximo de registros no endpoint /dados
DADOS_LIMITE_PADRAO = 500


# ============================================================
# HELPERS
# ============================================================

def _serial(val):
    if isinstance(val, (datetime, date)):
        return val.isoformat()
    if isinstance(val, Decimal):
        return float(val)
    if isinstance(val, bool):
        return val
    return val


def _serial_row(row):
    return {k: _serial(v) for k, v in row.items()}


def _add_multi(condicoes, params, field, raw):
    """Adiciona filtro IN() aceitando valores separados por virgula."""
    valores = [v.strip() for v in raw.split(',') if v.strip()]
    if not valores:
        return
    ph = ','.join(['%s'] * len(valores))
    condicoes.append('%s IN (%s)' % (field, ph))
    params.extend(valores)


def _build_common_filters():
    """
    Le parametros da query string e devolve (condicoes, params).
    Campos multi-valor: virgula como separador (ex: grupo=autorizado,aguardando).
    """
    condicoes = []
    params = []

    # Regras de negocio fixas: somente estagios ativos (sem Autorizado, Cancelado, Negado)
    condicoes.append("v.ds_estagio NOT IN ('Autorizado', 'Cancelado', 'Negado')")
    condicoes.append("v.nr_seq_estagio NOT IN (1, 2, 7)")

    estagio = request.args.get('estagio', '').strip()
    if estagio:
        _add_multi(condicoes, params, 'v.ds_estagio', estagio)

    semaforo = request.args.get('semaforo', '').strip()
    if semaforo:
        _add_multi(condicoes, params, 'v.status_semaforo', semaforo)

    convenio = request.args.get('convenio', '').strip()
    if convenio:
        _add_multi(condicoes, params, 'v.ds_convenio', convenio)

    tipo_guia = request.args.get('tipo_guia', '').strip()
    if tipo_guia:
        _add_multi(condicoes, params, 'v.ds_tipo_guia', tipo_guia)

    tipo_autorizacao = request.args.get('tipo_autorizacao', '').strip()
    if tipo_autorizacao:
        _add_multi(condicoes, params, 'v.ds_tipo_autorizacao', tipo_autorizacao)

    setor = request.args.get('setor', '').strip()
    if setor:
        _add_multi(condicoes, params, 'v.ds_setor_atendimento', setor)

    medico = request.args.get('medico', '').strip()
    if medico:
        _add_multi(condicoes, params, 'v.nm_medico_solicitante', medico)

    tipo_atendimento = request.args.get('tipo_atendimento', '').strip()
    if tipo_atendimento:
        _add_multi(condicoes, params, 'v.ds_tipo_atendimento', tipo_atendimento)

    periodo = request.args.get('periodo', '').strip()
    if periodo and periodo.isdigit():
        condicoes.append(
            "(v.dt_pedido_medico >= CURRENT_DATE - INTERVAL '%s days' OR v.dt_pedido_medico IS NULL)"
            % int(periodo)
        )

    busca = request.args.get('busca', '').strip()
    if busca:
        condicoes.append("""(
            v.nm_paciente ILIKE %s OR
            v.nr_atendimento::TEXT ILIKE %s OR
            v.ds_convenio ILIKE %s OR
            v.nm_medico_solicitante ILIKE %s OR
            v.ds_setor_origem ILIKE %s OR
            v.ds_tipo_autorizacao ILIKE %s
        )""")
        termo = '%' + busca + '%'
        params.extend([termo, termo, termo, termo, termo, termo])

    return condicoes, params


# ============================================================
# ROTAS HTML / STATIC
# ============================================================

@painel33_bp.route('/painel/painel33')
@login_required
def painel33():
    usuario_id = session.get('usuario_id')
    if usuario_id:
        if not verificar_permissao_painel(usuario_id, 'painel33'):
            return send_from_directory('frontend', 'acesso-negado.html')
    return send_from_directory('paineis/painel33', 'index.html')


@painel33_bp.route('/paineis/painel33/<path:filename>')
def painel33_static(filename):
    return send_from_directory('paineis/painel33', filename)


# ============================================================
# API: DASHBOARD (KPIs)
# ============================================================

@painel33_bp.route('/api/paineis/painel33/dashboard', methods=['GET'])
@login_required
def painel33_dashboard():
    try:
        condicoes, params = _build_common_filters()
        where = ('WHERE ' + ' AND '.join(condicoes)) if condicoes else ''

        sql = """
            SELECT
                COUNT(DISTINCT v.cd_pessoa_fisica) AS total_pacientes,
                COUNT(*) AS total_autorizacoes,
                COUNT(*) FILTER (WHERE v.status_semaforo = 'verde')                    AS autorizados,
                COUNT(*) FILTER (WHERE v.status_semaforo IN ('amarelo', 'laranja'))    AS aguardando,
                COUNT(*) FILTER (WHERE v.status_semaforo = 'vermelho')                AS negados
            FROM vw_painel33_autorizacoes v
            {where}
        """.format(where=where)

        with get_db_connection() as conn:
            with conn.cursor(cursor_factory=RealDictCursor) as cur:
                cur.execute(sql, params)
                row = cur.fetchone()

        return jsonify({'ok': True, 'dados': _serial_row(dict(row)) if row else {}})

    except Exception as e:
        traceback.print_exc()
        return jsonify({'ok': False, 'erro': 'Erro ao carregar dashboard', 'detalhe': str(e)}), 500


# ============================================================
# API: DADOS (lista individual para agrupamento no frontend)
# ============================================================

@painel33_bp.route('/api/paineis/painel33/dados', methods=['GET'])
@login_required
def painel33_dados():
    try:
        condicoes, params = _build_common_filters()
        where = ('WHERE ' + ' AND '.join(condicoes)) if condicoes else ''

        ordem_campo = request.args.get('ordem', 'dt_pedido_medico')
        ordem_dir   = request.args.get('dir', 'desc').lower()
        campos_validos = {
            'nr_sequencia', 'nr_atendimento', 'nm_paciente', 'ds_convenio',
            'ds_tipo_guia', 'ds_tipo_autorizacao', 'ds_estagio', 'grupo_estagio',
            'ds_setor_origem', 'nm_medico_solicitante', 'dt_pedido_medico',
            'dt_autorizacao', 'status_sla', 'horas_em_aberto', 'status_semaforo',
            'qt_materiais', 'qt_procedimentos', 'qt_documentos', 'dias_total_sla',
        }
        if ordem_campo not in campos_validos:
            ordem_campo = 'dt_pedido_medico'
        if ordem_dir not in ('asc', 'desc'):
            ordem_dir = 'desc'

        try:
            limite = min(1000, max(50, int(request.args.get('limite', DADOS_LIMITE_PADRAO) or DADOS_LIMITE_PADRAO)))
        except (ValueError, TypeError):
            limite = DADOS_LIMITE_PADRAO

        # Busca limite+1 para saber se há mais registros sem COUNT(*) extra
        sql = """
            WITH base AS (SELECT * FROM vw_painel33_autorizacoes v {where})
            SELECT * FROM base ORDER BY {campo} {dir} NULLS LAST LIMIT {lim}
        """.format(where=where, campo=ordem_campo, dir=ordem_dir, lim=limite + 1)

        with get_db_connection() as conn:
            with conn.cursor(cursor_factory=RealDictCursor) as cur:
                cur.execute(sql, params)
                rows = cur.fetchall()

        truncado = len(rows) > limite
        if truncado:
            rows = rows[:limite]

        return jsonify({
            'ok':      True,
            'dados':   [_serial_row(dict(r)) for r in rows],
            'total':   len(rows),
            'truncado': truncado,
            'limite':   limite,
        })

    except Exception as e:
        traceback.print_exc()
        return jsonify({'ok': False, 'erro': 'Erro ao carregar dados', 'detalhe': str(e)}), 500


# ============================================================
# API: PACIENTE (todas as autorizacoes + itens por paciente)
# ============================================================

@painel33_bp.route('/api/paineis/painel33/paciente', methods=['GET'])
@login_required
def painel33_paciente():
    try:
        cd = request.args.get('cd', '').strip()
        if not cd:
            return jsonify({'ok': False, 'erro': 'Parametro cd nao informado'}), 400

        condicoes, params = _build_common_filters()
        condicoes.append('v.cd_pessoa_fisica = %s')
        params.append(cd)
        where = 'WHERE ' + ' AND '.join(condicoes)

        sql_aut = """
            SELECT * FROM vw_painel33_autorizacoes v
            {where}
            ORDER BY v.dt_pedido_medico DESC NULLS LAST
        """.format(where=where)

        with get_db_connection() as conn:
            with conn.cursor(cursor_factory=RealDictCursor) as cur:
                cur.execute(sql_aut, params)
                autorizacoes = cur.fetchall()

                seq_list = [r['nr_sequencia'] for r in autorizacoes]

                if seq_list:
                    cur.execute("""
                        SELECT m.*, a.nr_atendimento FROM painel33_autorizacao_materiais m
                        JOIN painel33_autorizacoes_convenio a ON a.nr_sequencia = m.nr_sequencia_autor
                        WHERE m.nr_sequencia_autor = ANY(%s)
                        ORDER BY m.nr_sequencia_autor, m.nr_sequencia
                    """, (seq_list,))
                    materiais = cur.fetchall()

                    cur.execute("""
                        SELECT p.*, a.nr_atendimento FROM painel33_autorizacao_procedimentos p
                        JOIN painel33_autorizacoes_convenio a ON a.nr_sequencia = p.nr_sequencia_autor
                        WHERE p.nr_sequencia_autor = ANY(%s)
                        ORDER BY p.nr_sequencia_autor, p.nr_sequencia
                    """, (seq_list,))
                    procedimentos = cur.fetchall()

                    cur.execute("""
                        SELECT d.*, a.nr_atendimento FROM painel33_autorizacao_documentos d
                        JOIN painel33_autorizacoes_convenio a ON a.nr_sequencia = d.nr_sequencia_autor
                        WHERE d.nr_sequencia_autor = ANY(%s)
                        ORDER BY d.nr_sequencia_autor, d.dt_atualizacao DESC
                    """, (seq_list,))
                    documentos = cur.fetchall()
                else:
                    materiais = procedimentos = documentos = []

        return jsonify({
            'ok': True,
            'autorizacoes':  [_serial_row(dict(r)) for r in autorizacoes],
            'materiais':     [_serial_row(dict(r)) for r in materiais],
            'procedimentos': [_serial_row(dict(r)) for r in procedimentos],
            'documentos':    [_serial_row(dict(r)) for r in documentos]
        })

    except Exception as e:
        traceback.print_exc()
        return jsonify({'ok': False, 'erro': 'Erro ao carregar paciente', 'detalhe': str(e)}), 500


# ============================================================
# API: FILTROS
# ============================================================

@painel33_bp.route('/api/paineis/painel33/filtros', methods=['GET'])
@login_required
def painel33_filtros():
    try:
        agora = time.time()
        with _filtros_lock:
            if _filtros_cache['data'] is not None and (agora - _filtros_cache['ts']) < FILTROS_TTL_SEG:
                return jsonify({'ok': True, 'filtros': _filtros_cache['data'], 'cache': True})

        sql = """
            SELECT
                ARRAY(SELECT DISTINCT ds_estagio FROM vw_painel33_autorizacoes
                      WHERE ds_estagio IS NOT NULL
                        AND ds_estagio NOT IN ('Cancelado', 'Negado')
                      ORDER BY ds_estagio)                                                    AS estagios,
                ARRAY(SELECT DISTINCT ds_convenio FROM vw_painel33_autorizacoes
                      WHERE ds_convenio IS NOT NULL ORDER BY ds_convenio)                     AS convenios,
                ARRAY(SELECT DISTINCT ds_tipo_guia FROM vw_painel33_autorizacoes
                      WHERE ds_tipo_guia IS NOT NULL ORDER BY ds_tipo_guia)                   AS tipos_guia,
                ARRAY(SELECT DISTINCT ds_tipo_autorizacao FROM vw_painel33_autorizacoes
                      WHERE ds_tipo_autorizacao IS NOT NULL ORDER BY ds_tipo_autorizacao)     AS tipos_autorizacao,
                ARRAY(SELECT DISTINCT ds_setor_atendimento FROM vw_painel33_autorizacoes
                      WHERE ds_setor_atendimento IS NOT NULL ORDER BY ds_setor_atendimento)   AS setores,
                ARRAY(SELECT DISTINCT nm_medico_solicitante FROM vw_painel33_autorizacoes
                      WHERE nm_medico_solicitante IS NOT NULL ORDER BY nm_medico_solicitante) AS medicos,
                ARRAY(SELECT DISTINCT ds_tipo_atendimento FROM vw_painel33_autorizacoes
                      WHERE ds_tipo_atendimento IS NOT NULL ORDER BY ds_tipo_atendimento)     AS tipos_atendimento
        """
        with get_db_connection() as conn:
            with conn.cursor(cursor_factory=RealDictCursor) as cur:
                cur.execute(sql)
                row = cur.fetchone()

        filtros = dict(row) if row else {}
        with _filtros_lock:
            _filtros_cache['data'] = filtros
            _filtros_cache['ts']   = time.time()

        return jsonify({'ok': True, 'filtros': filtros})

    except Exception as e:
        traceback.print_exc()
        return jsonify({'ok': False, 'erro': 'Erro ao carregar filtros', 'detalhe': str(e)}), 500


# ============================================================
# API: EXPORT (CSV)
# ============================================================

@painel33_bp.route('/api/paineis/painel33/export', methods=['GET'])
@login_required
def painel33_export():
    try:
        condicoes, params = _build_common_filters()
        where = ('WHERE ' + ' AND '.join(condicoes)) if condicoes else ''

        sql = """
            SELECT
                v.nm_paciente          AS "Paciente",
                v.nr_atendimento       AS "Atendimento",
                v.ds_convenio          AS "Convenio",
                v.ds_tipo_guia         AS "Tipo Guia",
                v.ds_tipo_autorizacao  AS "Tipo Autorizacao",
                v.ds_estagio           AS "Estagio",
                v.grupo_estagio        AS "Grupo",
                v.ds_setor_origem      AS "Setor",
                v.nm_medico_solicitante AS "Medico",
                v.dt_pedido_medico     AS "Dt Pedido",
                v.dt_autorizacao       AS "Dt Autorizacao",
                v.status_sla           AS "SLA",
                v.dias_total_sla       AS "Dias SLA",
                v.qt_materiais         AS "Qt Materiais",
                v.qt_procedimentos     AS "Qt Procedimentos",
                v.qt_documentos        AS "Qt Documentos",
                v.status_semaforo      AS "Semaforo"
            FROM vw_painel33_autorizacoes v
            {where}
            ORDER BY v.nm_paciente, v.dt_pedido_medico DESC NULLS LAST
        """.format(where=where)

        with get_db_connection() as conn:
            with conn.cursor(cursor_factory=RealDictCursor) as cur:
                cur.execute(sql, params)
                rows = cur.fetchall()

        output = io.StringIO()
        if rows:
            writer = csv.DictWriter(output, fieldnames=rows[0].keys())
            writer.writeheader()
            for row in rows:
                writer.writerow({k: (_serial(v) if v is not None else '') for k, v in row.items()})

        output.seek(0)
        ts = datetime.now().strftime('%Y%m%d_%H%M%S')
        return Response(
            output.getvalue().encode('utf-8-sig'),
            mimetype='text/csv',
            headers={'Content-Disposition': 'attachment; filename=autorizacoes_{}.csv'.format(ts)}
        )

    except Exception as e:
        traceback.print_exc()
        return jsonify({'ok': False, 'erro': 'Erro ao exportar', 'detalhe': str(e)}), 500


# ============================================================
# CRUD: RESPONSÁVEIS POR CONVÊNIO
# ============================================================

def _ensure_responsaveis_table(cur):
    cur.execute("""
        CREATE TABLE IF NOT EXISTS painel33_responsaveis_convenio (
            id            SERIAL PRIMARY KEY,
            nm_responsavel VARCHAR(200) NOT NULL,
            ds_convenio    VARCHAR(200) NOT NULL,
            ativo          BOOLEAN      DEFAULT TRUE,
            dt_criacao     TIMESTAMP    DEFAULT NOW()
        )
    """)


@painel33_bp.route('/api/paineis/painel33/responsaveis', methods=['GET'])
@login_required
def painel33_responsaveis_listar():
    try:
        with get_db_connection() as conn:
            with conn.cursor(cursor_factory=RealDictCursor) as cur:
                _ensure_responsaveis_table(cur)
                conn.commit()
                cur.execute("""
                    SELECT nm_responsavel,
                           ARRAY_AGG(ds_convenio ORDER BY ds_convenio) AS convenios,
                           MIN(id) AS id
                    FROM painel33_responsaveis_convenio
                    WHERE ativo = TRUE
                    GROUP BY nm_responsavel
                    ORDER BY nm_responsavel
                """)
                rows = cur.fetchall()
        return jsonify({'ok': True, 'responsaveis': [dict(r) for r in rows]})
    except Exception as e:
        traceback.print_exc()
        return jsonify({'ok': False, 'erro': str(e)}), 500


@painel33_bp.route('/api/paineis/painel33/responsaveis/salvar', methods=['POST'])
@login_required
def painel33_responsaveis_salvar():
    try:
        dados = request.get_json(force=True) or {}
        nm   = (dados.get('nm_responsavel') or '').strip()
        convs = [c.strip() for c in (dados.get('convenios') or []) if str(c).strip()]
        if not nm:
            return jsonify({'ok': False, 'erro': 'Nome obrigatório'}), 400
        with get_db_connection() as conn:
            with conn.cursor() as cur:
                _ensure_responsaveis_table(cur)
                cur.execute(
                    "DELETE FROM painel33_responsaveis_convenio WHERE nm_responsavel = %s", (nm,)
                )
                if convs:
                    cur.executemany(
                        "INSERT INTO painel33_responsaveis_convenio (nm_responsavel, ds_convenio) VALUES (%s, %s)",
                        [(nm, c) for c in convs]
                    )
            conn.commit()
        return jsonify({'ok': True})
    except Exception as e:
        traceback.print_exc()
        return jsonify({'ok': False, 'erro': str(e)}), 500


@painel33_bp.route('/api/paineis/painel33/responsaveis/excluir', methods=['POST'])
@login_required
def painel33_responsaveis_excluir():
    try:
        dados = request.get_json(force=True) or {}
        nm = (dados.get('nm_responsavel') or '').strip()
        if not nm:
            return jsonify({'ok': False, 'erro': 'Nome obrigatório'}), 400
        with get_db_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    "DELETE FROM painel33_responsaveis_convenio WHERE nm_responsavel = %s", (nm,)
                )
            conn.commit()
        return jsonify({'ok': True})
    except Exception as e:
        traceback.print_exc()
        return jsonify({'ok': False, 'erro': str(e)}), 500


# ============================================================
# API: VISÃO GERAL
# ============================================================

@painel33_bp.route('/api/paineis/painel33/visao-geral', methods=['GET'])
@login_required
def painel33_visao_geral():
    try:
        from flask import session as flask_session
        is_admin = flask_session.get('is_admin', False)

        condicoes, params = _build_common_filters()
        where           = ('WHERE ' + ' AND '.join(condicoes)) if condicoes else ''
        where_analitica = ('WHERE ' + ' AND '.join(condicoes + ['v.nr_atendimento IS NOT NULL'])) if condicoes else 'WHERE v.nr_atendimento IS NOT NULL'
        join_val      = 'LEFT JOIN vw_painel33_valores_por_autorizacao val ON val.nr_sequencia_autorizacao = v.nr_sequencia'

        # KPIs: Solicitado / Atenção (≥96h e <120h) / Vencido (≥120h)  +  valores
        sql_kpis = """
            SELECT
                COUNT(*) FILTER (WHERE v.ds_estagio = 'Solicitado')                                                         AS qt_solicitado,
                COALESCE(SUM(val.vl_pendente_autorizacao) FILTER (WHERE v.ds_estagio = 'Solicitado'), 0)                     AS vl_solicitado,
                COUNT(*) FILTER (WHERE v.ds_estagio <> 'Solicitado' AND v.horas_em_aberto >= 96 AND v.horas_em_aberto < 120) AS qt_atencao,
                COALESCE(SUM(val.vl_pendente_autorizacao) FILTER (WHERE v.ds_estagio <> 'Solicitado' AND v.horas_em_aberto >= 96 AND v.horas_em_aberto < 120), 0) AS vl_atencao,
                COUNT(*) FILTER (WHERE v.ds_estagio <> 'Solicitado' AND v.horas_em_aberto >= 120)                            AS qt_vencido,
                COALESCE(SUM(val.vl_pendente_autorizacao) FILTER (WHERE v.ds_estagio <> 'Solicitado' AND v.horas_em_aberto >= 120), 0) AS vl_vencido
            FROM vw_painel33_autorizacoes v
            {join_val}
            {where}
        """.format(join_val=join_val, where=where)

        # Top 5 convênios com mais Atenção + Vencido  +  valores
        sql_convenios = """
            SELECT
                v.ds_convenio,
                COUNT(*)                                                                                                     AS qt_total,
                COUNT(*) FILTER (WHERE v.ds_estagio = 'Solicitado')                                                         AS qt_solicitado,
                COALESCE(SUM(val.vl_pendente_autorizacao) FILTER (WHERE v.ds_estagio = 'Solicitado'), 0)                     AS vl_solicitado,
                COUNT(*) FILTER (WHERE v.ds_estagio <> 'Solicitado' AND v.horas_em_aberto >= 96 AND v.horas_em_aberto < 120) AS qt_atencao,
                COALESCE(SUM(val.vl_pendente_autorizacao) FILTER (WHERE v.ds_estagio <> 'Solicitado' AND v.horas_em_aberto >= 96 AND v.horas_em_aberto < 120), 0) AS vl_atencao,
                COUNT(*) FILTER (WHERE v.ds_estagio <> 'Solicitado' AND v.horas_em_aberto >= 120)                            AS qt_vencido,
                COALESCE(SUM(val.vl_pendente_autorizacao) FILTER (WHERE v.ds_estagio <> 'Solicitado' AND v.horas_em_aberto >= 120), 0) AS vl_vencido
            FROM vw_painel33_autorizacoes v
            {join_val}
            {where}
            GROUP BY v.ds_convenio
            ORDER BY (
                COALESCE(SUM(val.vl_pendente_autorizacao) FILTER (WHERE v.ds_estagio <> 'Solicitado' AND v.horas_em_aberto >= 96), 0)
            ) DESC NULLS LAST
            LIMIT 5
        """.format(join_val=join_val, where=where)

        # Tabela analítica: top 10 pacientes agrupados, autorização mais urgente por paciente
        sql_analitica = """
            WITH base AS (
                SELECT
                    v.cd_pessoa_fisica,
                    v.nm_paciente,
                    v.nr_atendimento,
                    v.ds_convenio,
                    v.ds_estagio,
                    v.ds_setor_atendimento,
                    v.dt_pedido_medico,
                    v.horas_em_aberto,
                    v.status_semaforo,
                    CASE
                        WHEN v.ds_estagio = 'Solicitado'                                         THEN 4
                        WHEN v.ds_estagio <> 'Solicitado' AND v.horas_em_aberto >= 120           THEN 1
                        WHEN v.ds_estagio <> 'Solicitado' AND v.horas_em_aberto >= 96            THEN 2
                        ELSE 3
                    END AS ordem_urgencia
                FROM vw_painel33_autorizacoes v
                {where}
            ),
            contagem AS (
                SELECT cd_pessoa_fisica, COUNT(*) AS qt_autorizacoes
                FROM base
                GROUP BY cd_pessoa_fisica
            ),
            mais_urgente AS (
                SELECT DISTINCT ON (b.cd_pessoa_fisica)
                    b.cd_pessoa_fisica, b.nm_paciente, b.nr_atendimento,
                    b.ds_convenio, b.ds_estagio, b.ds_setor_atendimento,
                    b.dt_pedido_medico, b.horas_em_aberto, b.status_semaforo,
                    b.ordem_urgencia
                FROM base b
                ORDER BY b.cd_pessoa_fisica, b.ordem_urgencia ASC, b.horas_em_aberto DESC NULLS LAST
            )
            SELECT m.*, c.qt_autorizacoes,
                   COALESCE(resp.nm_responsavel, '') AS responsavel
            FROM mais_urgente m
            JOIN contagem c ON c.cd_pessoa_fisica = m.cd_pessoa_fisica
            LEFT JOIN (
                SELECT ds_convenio,
                       STRING_AGG(nm_responsavel, ', ' ORDER BY nm_responsavel) AS nm_responsavel
                FROM painel33_responsaveis_convenio
                WHERE ativo = TRUE
                GROUP BY ds_convenio
            ) resp ON resp.ds_convenio = m.ds_convenio
            ORDER BY m.ordem_urgencia ASC, m.horas_em_aberto DESC NULLS LAST
            LIMIT 10
        """.format(where=where_analitica)

        with get_db_connection() as conn:
            with conn.cursor(cursor_factory=RealDictCursor) as cur:
                _ensure_responsaveis_table(cur)
                conn.commit()
                cur.execute(sql_kpis, params)
                kpis = cur.fetchone()
                cur.execute(sql_convenios, params)
                convenios = cur.fetchall()
                cur.execute(sql_analitica, params)
                analitica = cur.fetchall()

        return jsonify({
            'ok':        True,
            'is_admin':  bool(is_admin),
            'kpis':      _serial_row(dict(kpis)) if kpis else {},
            'convenios': [_serial_row(dict(r)) for r in convenios],
            'analitica': [_serial_row(dict(r)) for r in analitica],
        })

    except Exception as e:
        traceback.print_exc()
        return jsonify({'ok': False, 'erro': 'Erro ao carregar visão geral', 'detalhe': str(e)}), 500


# ============================================================
# API: DIAGNÓSTICO - Colunas da view (temporário)
# ============================================================

@painel33_bp.route('/api/paineis/painel33/debug/view-colunas', methods=['GET'])
@login_required
def painel33_debug_view_colunas():
    try:
        tabelas = [
            'vw_painel33_autorizacoes',
            'vw_painel33_valores_por_autorizacao',
            'painel33_contas_paciente',
            'painel33_materiais_conta',
            'painel33_procedimentos_conta',
        ]
        resultado = {}
        with get_db_connection() as conn:
            with conn.cursor() as cur:
                for t in tabelas:
                    cur.execute("""
                        SELECT column_name, data_type
                        FROM information_schema.columns
                        WHERE table_name = %s
                        ORDER BY ordinal_position
                    """, (t,))
                    resultado[t] = [{'nome': r[0], 'tipo': r[1]} for r in cur.fetchall()]
                # Amostra de 1 linha da view de valores
                cur.execute('SELECT * FROM vw_painel33_valores_por_autorizacao LIMIT 1')
                row = cur.fetchone()
                cols = [d[0] for d in cur.description] if cur.description else []
                resultado['_amostra_valores'] = dict(zip(cols, [str(v) for v in (row or [])])) if row else {}
        return jsonify({'ok': True, 'tabelas': resultado})
    except Exception as e:
        traceback.print_exc()
        return jsonify({'ok': False, 'erro': str(e)}), 500


# ============================================================
# API: VALORES - DASHBOARD (KPIs Financeiros)
# ============================================================

@painel33_bp.route('/api/paineis/painel33/valores/dashboard', methods=['GET'])
@login_required
def painel33_valores_dashboard():
    try:
        condicoes, params = _build_common_filters()
        where = ('WHERE ' + ' AND '.join(condicoes)) if condicoes else ''

        join = 'JOIN vw_painel33_valores_por_autorizacao val ON val.nr_sequencia_autorizacao = v.nr_sequencia'

        sql_kpis = """
            SELECT
                COALESCE(SUM(val.vl_pendente_autorizacao), 0)                                         AS vl_total_pendente_geral,
                COALESCE(SUM(CASE WHEN v.grupo_estagio = 'acao_hospital'
                                  THEN val.vl_pendente_autorizacao ELSE 0 END), 0)                    AS vl_total_pendente_acao_hospital,
                COALESCE(SUM(CASE WHEN v.grupo_estagio = 'aguardando'
                                  THEN val.vl_pendente_autorizacao ELSE 0 END), 0)                    AS vl_total_pendente_aguardando,
                COUNT(*) FILTER (WHERE val.flag_alto_risco)                                           AS qt_autorizacoes_alto_risco,
                COALESCE(SUM(CASE WHEN v.grupo_estagio IN ('acao_hospital','aguardando')
                                  THEN val.vl_total_executado_conta ELSE 0 END), 0)                   AS vl_em_contas_abertas,
                COALESCE(AVG(NULLIF(val.vl_pendente_autorizacao, 0)), 0)                              AS vl_medio
            FROM vw_painel33_autorizacoes v
            {join}
            {where}
        """.format(join=join, where=where)

        sql_convenios = """
            SELECT v.ds_convenio,
                   COALESCE(SUM(val.vl_pendente_autorizacao), 0) AS vl_pendente,
                   COUNT(*)                                       AS qt_autorizacoes
            FROM vw_painel33_autorizacoes v
            {join}
            {where}
            GROUP BY v.ds_convenio
            ORDER BY vl_pendente DESC NULLS LAST
            LIMIT 10
        """.format(join=join, where=where)

        sql_setores = """
            SELECT v.ds_setor_atendimento                         AS ds_setor,
                   COALESCE(SUM(val.vl_pendente_autorizacao), 0) AS vl_pendente,
                   COUNT(*)                                       AS qt_autorizacoes
            FROM vw_painel33_autorizacoes v
            {join}
            {where}
            GROUP BY v.ds_setor_atendimento
            ORDER BY vl_pendente DESC NULLS LAST
            LIMIT 10
        """.format(join=join, where=where)

        with get_db_connection() as conn:
            with conn.cursor(cursor_factory=RealDictCursor) as cur:
                cur.execute(sql_kpis, params)
                kpis = cur.fetchone()
                cur.execute(sql_convenios, params)
                convenios = cur.fetchall()
                cur.execute(sql_setores, params)
                setores = cur.fetchall()

        return jsonify({
            'ok': True,
            'kpis':          _serial_row(dict(kpis)) if kpis else {},
            'top_convenios': [_serial_row(dict(r)) for r in convenios],
            'top_setores':   [_serial_row(dict(r)) for r in setores]
        })

    except Exception as e:
        traceback.print_exc()
        return jsonify({'ok': False, 'erro': 'Erro ao carregar dashboard de valores', 'detalhe': str(e)}), 500


# ============================================================
# API: VALORES - LISTA PAGINADA
# ============================================================

@painel33_bp.route('/api/paineis/painel33/valores/lista', methods=['GET'])
@login_required
def painel33_valores_lista():
    try:
        condicoes, params = _build_common_filters()

        vl_minimo = request.args.get('vl_minimo', '').strip()
        if vl_minimo:
            try:
                vl_min = float(vl_minimo)
                if vl_min > 0:
                    condicoes.append('val.vl_pendente_autorizacao >= %s')
                    params.append(vl_min)
            except ValueError:
                pass

        if request.args.get('apenas_alto_risco', '').lower() in ('1', 'true'):
            condicoes.append('val.flag_alto_risco = TRUE')

        if request.args.get('apenas_com_conta', '').lower() in ('1', 'true'):
            condicoes.append('val.nr_interno_conta IS NOT NULL')

        where = ('WHERE ' + ' AND '.join(condicoes)) if condicoes else ''
        join  = 'JOIN vw_painel33_valores_por_autorizacao val ON val.nr_sequencia_autorizacao = v.nr_sequencia'

        try:
            pagina = max(1, int(request.args.get('pagina', 1) or 1))
        except (ValueError, TypeError):
            pagina = 1
        try:
            por_pagina = min(200, max(10, int(request.args.get('por_pagina', 100) or 100)))
        except (ValueError, TypeError):
            por_pagina = 100
        offset = (pagina - 1) * por_pagina

        sql_count = """
            SELECT COUNT(*) AS total
            FROM vw_painel33_autorizacoes v
            {join}
            {where}
        """.format(join=join, where=where)

        sql_lista = """
            SELECT
                v.nr_sequencia, v.nr_atendimento, v.nm_paciente,
                v.cd_pessoa_fisica, v.ds_convenio, v.ds_estagio, v.grupo_estagio,
                v.ds_setor_atendimento, v.dt_pedido_medico, v.dt_autorizacao,
                v.status_semaforo, v.horas_em_aberto,
                val.nr_interno_conta,
                ROUND(val.vl_total_conta::NUMERIC,            2) AS vl_total_conta,
                ROUND(val.vl_total_executado_conta::NUMERIC,  2) AS vl_total_executado_conta,
                ROUND(val.vl_total_vinculado::NUMERIC,        2) AS vl_total_vinculado,
                ROUND(val.vl_total_por_codigo::NUMERIC,       2) AS vl_total_por_codigo,
                ROUND(val.vl_pendente_autorizacao::NUMERIC,   2) AS vl_pendente_autorizacao,
                val.flag_alto_risco
            FROM vw_painel33_autorizacoes v
            {join}
            {where}
            ORDER BY val.vl_pendente_autorizacao DESC NULLS LAST
            LIMIT {lim} OFFSET {off}
        """.format(join=join, where=where, lim=por_pagina, off=offset)

        with get_db_connection() as conn:
            with conn.cursor(cursor_factory=RealDictCursor) as cur:
                cur.execute(sql_count, params)
                total = int((cur.fetchone() or {}).get('total', 0))
                cur.execute(sql_lista, params)
                rows = cur.fetchall()

        total_paginas = max(1, (total + por_pagina - 1) // por_pagina)

        return jsonify({
            'ok': True,
            'items':         [_serial_row(dict(r)) for r in rows],
            'total':         total,
            'pagina':        pagina,
            'total_paginas': total_paginas
        })

    except Exception as e:
        traceback.print_exc()
        return jsonify({'ok': False, 'erro': 'Erro ao carregar lista de valores', 'detalhe': str(e)}), 500


# ============================================================
# API: VALORES - DETALHE POR AUTORIZAÇÃO
# ============================================================

@painel33_bp.route('/api/paineis/painel33/valores/detalhe/<int:nr_sequencia>', methods=['GET'])
@login_required
def painel33_valores_detalhe(nr_sequencia):
    try:
        with get_db_connection() as conn:
            with conn.cursor(cursor_factory=RealDictCursor) as cur:

                cur.execute("""
                    SELECT
                        v.nr_sequencia, v.nr_atendimento, v.nm_paciente, v.ds_convenio,
                        v.ds_estagio, v.grupo_estagio, v.ds_setor_atendimento,
                        v.dt_pedido_medico, v.dt_autorizacao, v.status_semaforo, v.horas_em_aberto,
                        v.nr_seq_autorizacao,
                        val.nr_interno_conta,
                        ROUND(val.vl_total_conta::NUMERIC,            2) AS vl_total_conta,
                        ROUND(val.vl_total_executado_conta::NUMERIC,  2) AS vl_total_executado_conta,
                        ROUND(val.vl_total_vinculado::NUMERIC,        2) AS vl_total_vinculado,
                        ROUND(val.vl_total_por_codigo::NUMERIC,       2) AS vl_total_por_codigo,
                        ROUND(val.vl_pendente_autorizacao::NUMERIC,   2) AS vl_pendente_autorizacao,
                        val.flag_alto_risco,
                        val.status_conta, val.protocolo_conta,
                        val.dt_conta_inicial, val.dt_conta_final
                    FROM vw_painel33_autorizacoes v
                    JOIN vw_painel33_valores_por_autorizacao val ON val.nr_sequencia_autorizacao = v.nr_sequencia
                    WHERE v.nr_sequencia = %s
                """, (nr_sequencia,))
                aut = cur.fetchone()
                if not aut:
                    return jsonify({'ok': False, 'erro': 'Autorização não encontrada'}), 404
                aut = _serial_row(dict(aut))

                nr_interno_conta  = aut.get('nr_interno_conta')
                nr_seq_autorizacao = aut.get('nr_seq_autorizacao')
                conta = None
                materiais_direto = procedimentos_direto = []
                materiais_codigo = procedimentos_codigo = []

                if nr_interno_conta:
                    cur.execute("""
                        SELECT nr_interno_conta, dt_periodo_inicial, dt_periodo_final,
                               ROUND(vl_conta::NUMERIC, 2) AS vl_total_conta
                        FROM painel33_contas_paciente
                        WHERE nr_interno_conta = %s LIMIT 1
                    """, (nr_interno_conta,))
                    row_conta = cur.fetchone()
                    if row_conta:
                        conta = _serial_row(dict(row_conta))

                    cur.execute("""
                        SELECT cd_material, ds_material,
                               qt_material AS qt,
                               ROUND(vl_material::NUMERIC, 2) AS vl_item
                        FROM painel33_materiais_conta
                        WHERE nr_interno_conta = %s AND nr_seq_mat_autor = %s
                        ORDER BY vl_material DESC NULLS LAST
                    """, (nr_interno_conta, nr_sequencia))
                    materiais_direto = [_serial_row(dict(r)) for r in cur.fetchall()]

                    if nr_seq_autorizacao:
                        cur.execute("""
                            SELECT cd_material, ds_material,
                                   qt_material AS qt,
                                   ROUND(vl_material::NUMERIC, 2) AS vl_item
                            FROM painel33_materiais_conta
                            WHERE nr_interno_conta = %s
                              AND nr_seq_autorizacao = %s
                              AND (nr_seq_mat_autor IS NULL OR nr_seq_mat_autor <> %s)
                            ORDER BY vl_material DESC NULLS LAST
                        """, (nr_interno_conta, nr_seq_autorizacao, nr_sequencia))
                        materiais_codigo = [_serial_row(dict(r)) for r in cur.fetchall()]

                    cur.execute("""
                        SELECT cd_procedimento, ds_procedimento, ie_origem_proced,
                               qt_procedimento AS qt,
                               ROUND(vl_procedimento::NUMERIC, 2) AS vl_item
                        FROM painel33_procedimentos_conta
                        WHERE nr_interno_conta = %s AND nr_seq_proc_autor = %s
                        ORDER BY vl_procedimento DESC NULLS LAST
                    """, (nr_interno_conta, nr_sequencia))
                    procedimentos_direto = [_serial_row(dict(r)) for r in cur.fetchall()]

                    if nr_seq_autorizacao:
                        cur.execute("""
                            SELECT cd_procedimento, ds_procedimento, ie_origem_proced,
                                   qt_procedimento AS qt,
                                   ROUND(vl_procedimento::NUMERIC, 2) AS vl_item
                            FROM painel33_procedimentos_conta
                            WHERE nr_interno_conta = %s
                              AND nr_seq_autorizacao = %s
                              AND (nr_seq_proc_autor IS NULL OR nr_seq_proc_autor <> %s)
                            ORDER BY vl_procedimento DESC NULLS LAST
                        """, (nr_interno_conta, nr_seq_autorizacao, nr_sequencia))
                        procedimentos_codigo = [_serial_row(dict(r)) for r in cur.fetchall()]

                def _soma(lst):
                    return round(sum(float(r.get('vl_item') or 0) for r in lst), 2)

                vl_direto = _soma(materiais_direto) + _soma(procedimentos_direto)
                vl_codigo = _soma(materiais_codigo) + _soma(procedimentos_codigo)

                return jsonify({
                    'ok': True,
                    'autorizacao':                aut,
                    'conta':                      conta,
                    'materiais_match_direto':     materiais_direto,
                    'materiais_match_codigo':     materiais_codigo,
                    'procedimentos_match_direto': procedimentos_direto,
                    'procedimentos_match_codigo': procedimentos_codigo,
                    'totais': {
                        'vl_match_direto':      vl_direto,
                        'vl_match_codigo':      vl_codigo,
                        'vl_pendente_estimado': round(max(vl_direto, vl_codigo), 2)
                    }
                })

    except Exception as e:
        traceback.print_exc()
        return jsonify({'ok': False, 'erro': 'Erro ao carregar detalhe de valores', 'detalhe': str(e)}), 500
