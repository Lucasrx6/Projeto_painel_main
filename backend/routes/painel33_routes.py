# -*- coding: utf-8 -*-
"""
Painel 33 - Autorizacoes de Convenio
Hospital Anchieta

Consulta a view vw_painel33_autorizacoes.
Filtros aceitam valores multiplos separados por virgula.
"""

import io
import csv
import traceback
import statistics
from datetime import datetime, date
from decimal import Decimal
from flask import Blueprint, request, jsonify, send_from_directory, session, Response
from psycopg2.extras import RealDictCursor
from backend.database import get_db_connection
from backend.middleware.decorators import login_required
from backend.user_management import verificar_permissao_painel

painel33_bp = Blueprint('painel33', __name__)


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

    grupo = request.args.get('grupo', '').strip()
    if grupo:
        _add_multi(condicoes, params, 'v.grupo_estagio', grupo)

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
        _add_multi(condicoes, params, 'v.ds_setor_origem', setor)

    medico = request.args.get('medico', '').strip()
    if medico:
        _add_multi(condicoes, params, 'v.nm_medico_solicitante', medico)

    periodo = request.args.get('periodo', '').strip()
    if periodo and periodo.isdigit():
        condicoes.append("v.dt_pedido_medico >= CURRENT_DATE - INTERVAL '%s days'" % int(periodo))

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
                COUNT(*) FILTER (WHERE v.grupo_estagio = 'autorizado')    AS autorizados,
                COUNT(*) FILTER (WHERE v.grupo_estagio = 'aguardando')    AS aguardando,
                COUNT(*) FILTER (WHERE v.grupo_estagio = 'negado')        AS negados
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

        sql = """
            WITH base AS (SELECT * FROM vw_painel33_autorizacoes v {where})
            SELECT * FROM base ORDER BY {campo} {dir} NULLS LAST
        """.format(where=where, campo=ordem_campo, dir=ordem_dir)

        with get_db_connection() as conn:
            with conn.cursor(cursor_factory=RealDictCursor) as cur:
                cur.execute(sql, params)
                rows = cur.fetchall()

        return jsonify({'ok': True, 'dados': [_serial_row(dict(r)) for r in rows], 'total': len(rows)})

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
        sql = """
            SELECT
                ARRAY(SELECT DISTINCT ds_convenio FROM vw_painel33_autorizacoes
                      WHERE ds_convenio IS NOT NULL ORDER BY ds_convenio)                     AS convenios,
                ARRAY(SELECT DISTINCT ds_tipo_guia FROM vw_painel33_autorizacoes
                      WHERE ds_tipo_guia IS NOT NULL ORDER BY ds_tipo_guia)                   AS tipos_guia,
                ARRAY(SELECT DISTINCT ds_tipo_autorizacao FROM vw_painel33_autorizacoes
                      WHERE ds_tipo_autorizacao IS NOT NULL ORDER BY ds_tipo_autorizacao)     AS tipos_autorizacao,
                ARRAY(SELECT DISTINCT ds_setor_origem FROM vw_painel33_autorizacoes
                      WHERE ds_setor_origem IS NOT NULL ORDER BY ds_setor_origem)             AS setores,
                ARRAY(SELECT DISTINCT nm_medico_solicitante FROM vw_painel33_autorizacoes
                      WHERE nm_medico_solicitante IS NOT NULL ORDER BY nm_medico_solicitante) AS medicos
        """
        with get_db_connection() as conn:
            with conn.cursor(cursor_factory=RealDictCursor) as cur:
                cur.execute(sql)
                row = cur.fetchone()

        return jsonify({'ok': True, 'filtros': dict(row) if row else {}})

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
