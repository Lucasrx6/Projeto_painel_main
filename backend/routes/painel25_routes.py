"""
Painel 25 - Exames do PS (Visao Medica)
Monitoramento de resultados de exames (Radiologia + Laboratorio) para medicos do PS

Endpoints:
    GET /painel/painel25                              - Pagina HTML
    GET /api/paineis/painel25/dashboard                - Cards resumo
    GET /api/paineis/painel25/dados                    - Pacientes + exames agrupados
    GET /api/paineis/painel25/filtros                  - Medicos e clinicas disponiveis
"""
from flask import Blueprint, jsonify, send_from_directory, request, session, current_app
from datetime import datetime
from decimal import Decimal
from psycopg2.extras import RealDictCursor
from backend.database import get_db_connection, release_connection
from backend.middleware.decorators import login_required
from backend.user_management import verificar_permissao_painel

# Cria o Blueprint
painel25_bp = Blueprint('painel25', __name__)


# =========================================================
# FUNCOES AUXILIARES
# =========================================================

def _verificar_acesso():
    """Verifica permissao de acesso ao painel."""
    usuario_id = session.get('usuario_id')
    is_admin = session.get('is_admin', False)

    if not is_admin:
        if not verificar_permissao_painel(usuario_id, 'painel25'):
            return False
    return True


def serializar_linha(row):
    """Converte uma row RealDictCursor em dicionario serializavel."""
    if row is None:
        return None
    resultado = {}
    for chave, valor in row.items():
        if isinstance(valor, Decimal):
            resultado[chave] = float(valor)
        elif isinstance(valor, datetime):
            resultado[chave] = valor.strftime('%d/%m/%Y %H:%M')
        else:
            resultado[chave] = valor
    return resultado


def _build_common_filters(args):
    """
    Constroi filtros compartilhados entre dashboard, dados e filtros.
    Garante que KPIs e tabela sempre reflitam os mesmos criterios.

    Parametros aceitos via query string:
        medico      - Nome do medico (LIKE %termo%)
        clinica     - Clinica exata
        atendimento - Numero do atendimento exato
        tipo_exame  - RADIOLOGIA ou LABORATORIO
        status      - Status do exame (LAUDADO, AGUARDANDO, etc.)
    """
    where_clauses = []
    params = []

    # Filtro por medico (busca parcial, case-insensitive)
    medico = (args.get('medico') or '').strip()
    if medico:
        where_clauses.append("UPPER(nm_medico_resp) LIKE UPPER(%s)")
        params.append('%' + medico + '%')

    # Filtro por clinica (exato)
    clinica = (args.get('clinica') or '').strip()
    if clinica:
        where_clauses.append("ds_clinica = %s")
        params.append(clinica)

    # Filtro por atendimento (exato)
    atendimento = (args.get('atendimento') or '').strip()
    if atendimento:
        where_clauses.append("nr_atendimento::TEXT = %s")
        params.append(atendimento)

    # Filtro por tipo de exame
    tipo_exame = (args.get('tipo_exame') or '').strip().upper()
    if tipo_exame in ('RADIOLOGIA', 'LABORATORIO'):
        where_clauses.append("tipo_exame = %s")
        params.append(tipo_exame)

    # Filtro por status
    status = (args.get('status') or '').strip().upper()
    if status:
        where_clauses.append("status_exame = %s")
        params.append(status)

    where_sql = ''
    if where_clauses:
        where_sql = 'WHERE ' + ' AND '.join(where_clauses)

    return where_sql, params


# =========================================================
# ROTA DE PAGINA HTML
# =========================================================

@painel25_bp.route('/painel/painel25')
@login_required
def painel25():
    """Pagina principal do Painel 25."""
    if not _verificar_acesso():
        current_app.logger.warning(
            'Acesso negado ao painel25: %s', session.get('usuario')
        )
        return send_from_directory('frontend', 'acesso-negado.html')

    return send_from_directory('paineis/painel25', 'index.html')


# =========================================================
# ENDPOINT: DASHBOARD (cards resumo)
# =========================================================

@painel25_bp.route('/api/paineis/painel25/dashboard', methods=['GET'])
@login_required
def api_painel25_dashboard():
    """
    Cards de resumo com contadores.
    GET /api/paineis/painel25/dashboard?medico=&clinica=&atendimento=&tipo_exame=&status=

    Retorna:
        qt_pacientes        - Total de pacientes distintos
        qt_exames_total     - Total de exames
        qt_prontos          - Exames com resultado (LAUDADO + LIBERADO)
        qt_pendentes        - Exames aguardando (AGUARDANDO + SOLICITADO)
        qt_em_andamento     - Exames em progresso (EXECUTADO + COLETADO + EM_ANALISE + RESULTADO_PARCIAL)
        qt_radio            - Total exames de radiologia
        qt_lab              - Total exames de laboratorio
    """
    if not _verificar_acesso():
        return jsonify({'success': False, 'error': 'Acesso negado'}), 403

    conn = None
    try:
        conn = get_db_connection()
        cur = conn.cursor(cursor_factory=RealDictCursor)

        where_sql, params = _build_common_filters(request.args)

        sql = """
            SELECT
                COUNT(DISTINCT nr_atendimento)                   AS qt_pacientes,
                COUNT(*)                                         AS qt_exames_total,
                SUM(CASE WHEN status_exame IN ('LAUDADO','LIBERADO')
                    THEN 1 ELSE 0 END)                           AS qt_prontos,
                SUM(CASE WHEN status_exame IN ('AGUARDANDO','SOLICITADO')
                    THEN 1 ELSE 0 END)                           AS qt_pendentes,
                SUM(CASE WHEN status_exame IN ('EXECUTADO','COLETADO','EM_ANALISE','RESULTADO_PARCIAL')
                    THEN 1 ELSE 0 END)                           AS qt_em_andamento,
                SUM(CASE WHEN tipo_exame = 'RADIOLOGIA'
                    THEN 1 ELSE 0 END)                           AS qt_radio,
                SUM(CASE WHEN tipo_exame = 'LABORATORIO'
                    THEN 1 ELSE 0 END)                           AS qt_lab
            FROM painel25_ps_exames_medico
            {where}
        """.format(where=where_sql)

        cur.execute(sql, params)
        row = cur.fetchone()

        dashboard = serializar_linha(row) if row else {
            'qt_pacientes': 0,
            'qt_exames_total': 0,
            'qt_prontos': 0,
            'qt_pendentes': 0,
            'qt_em_andamento': 0,
            'qt_radio': 0,
            'qt_lab': 0
        }

        return jsonify({'success': True, 'data': dashboard})

    except Exception as e:
        current_app.logger.error('[P25] Erro dashboard: %s', e, exc_info=True)
        return jsonify({'success': False, 'error': str(e)}), 500
    finally:
        if conn:
            release_connection(conn)


# =========================================================
# ENDPOINT: DADOS (pacientes + exames agrupados)
# =========================================================

@painel25_bp.route('/api/paineis/painel25/dados', methods=['GET'])
@login_required
def api_painel25_dados():
    """
    Lista de pacientes com seus exames agrupados.
    GET /api/paineis/painel25/dados?medico=&clinica=&atendimento=&tipo_exame=&status=

    Retorna lista de pacientes, cada um com:
        - dados do paciente (nome, idade, sexo, convenio, medico, clinica, CID)
        - situacao_geral (TODOS_PRONTOS / PARCIAL / NENHUM_PRONTO)
        - lista de exames com status individual
    """
    if not _verificar_acesso():
        return jsonify({'success': False, 'error': 'Acesso negado'}), 403

    conn = None
    try:
        conn = get_db_connection()
        cur = conn.cursor(cursor_factory=RealDictCursor)

        where_sql, params = _build_common_filters(request.args)

        # Query unica: busca todos os exames ja ordenados
        sql = """
            SELECT
                nr_atendimento,
                dt_entrada,
                tempo_no_ps,
                nm_pessoa_fisica,
                idade,
                ie_sexo,
                ds_convenio,
                cd_medico_resp,
                nm_medico_resp,
                ds_clinica,
                cd_cid_principal,
                nr_seq_classificacao,
                tipo_exame,
                ds_procedimento,
                ds_material,
                dt_pedido,
                dt_coleta_execucao,
                dt_resultado,
                status_exame,
                ds_status,
                tempo_espera,
                prioridade_ordem
            FROM painel25_ps_exames_medico
            {where}
            ORDER BY nr_atendimento, prioridade_ordem ASC, dt_pedido ASC
        """.format(where=where_sql)

        cur.execute(sql, params)
        rows = cur.fetchall()

        # Agrupar por paciente (nr_atendimento) em Python
        pacientes_dict = {}
        for row in rows:
            r = serializar_linha(row)
            nr = r['nr_atendimento']

            if nr not in pacientes_dict:
                pacientes_dict[nr] = {
                    'nr_atendimento': nr,
                    'dt_entrada': r['dt_entrada'],
                    'tempo_no_ps': r['tempo_no_ps'],
                    'nm_pessoa_fisica': r['nm_pessoa_fisica'],
                    'idade': r['idade'],
                    'ie_sexo': r['ie_sexo'],
                    'ds_convenio': r['ds_convenio'],
                    'cd_medico_resp': r['cd_medico_resp'],
                    'nm_medico_resp': r['nm_medico_resp'],
                    'ds_clinica': r['ds_clinica'],
                    'cd_cid_principal': r['cd_cid_principal'],
                    'nr_seq_classificacao': r['nr_seq_classificacao'],
                    'exames': [],
                    'qt_total': 0,
                    'qt_prontos': 0,
                    'qt_pendentes': 0,
                    'qt_em_andamento': 0
                }

            pac = pacientes_dict[nr]
            pac['exames'].append({
                'tipo_exame': r['tipo_exame'],
                'ds_procedimento': r['ds_procedimento'],
                'ds_material': r['ds_material'],
                'dt_pedido': r['dt_pedido'],
                'dt_coleta_execucao': r['dt_coleta_execucao'],
                'dt_resultado': r['dt_resultado'],
                'status_exame': r['status_exame'],
                'ds_status': r['ds_status'],
                'tempo_espera': r['tempo_espera'],
                'prioridade_ordem': r['prioridade_ordem']
            })

            pac['qt_total'] += 1
            if r['status_exame'] in ('LAUDADO', 'LIBERADO'):
                pac['qt_prontos'] += 1
            elif r['status_exame'] in ('AGUARDANDO', 'SOLICITADO'):
                pac['qt_pendentes'] += 1
            else:
                pac['qt_em_andamento'] += 1

        # Calcular situacao_geral e montar lista
        pacientes = []
        for pac in pacientes_dict.values():
            if pac['qt_total'] == pac['qt_prontos']:
                pac['situacao_geral'] = 'TODOS_PRONTOS'
            elif pac['qt_prontos'] > 0:
                pac['situacao_geral'] = 'PARCIAL'
            else:
                pac['situacao_geral'] = 'NENHUM_PRONTO'
            pacientes.append(pac)

        # Ordenar: TODOS_PRONTOS primeiro (destaque verde), depois PARCIAL, depois NENHUM_PRONTO
        ordem_situacao = {
            'TODOS_PRONTOS': 1,
            'PARCIAL': 2,
            'NENHUM_PRONTO': 3
        }
        pacientes.sort(key=lambda p: (
            ordem_situacao.get(p['situacao_geral'], 9),
            p['dt_entrada'] or ''
        ))

        return jsonify({
            'success': True,
            'data': pacientes,
            'total_pacientes': len(pacientes)
        })

    except Exception as e:
        current_app.logger.error('[P25] Erro dados: %s', e, exc_info=True)
        return jsonify({'success': False, 'error': str(e)}), 500
    finally:
        if conn:
            release_connection(conn)


# =========================================================
# ENDPOINT: FILTROS (medicos e clinicas disponiveis)
# =========================================================

@painel25_bp.route('/api/paineis/painel25/filtros', methods=['GET'])
@login_required
def api_painel25_filtros():
    """
    Lista medicos e clinicas disponiveis para popular os selects.
    GET /api/paineis/painel25/filtros

    Retorna:
        medicos  - Lista de {cd_medico_resp, nm_medico_resp, qt_pacientes}
        clinicas - Lista de {ds_clinica, qt_pacientes}
    """
    if not _verificar_acesso():
        return jsonify({'success': False, 'error': 'Acesso negado'}), 403

    conn = None
    try:
        conn = get_db_connection()
        cur = conn.cursor(cursor_factory=RealDictCursor)

        # Medicos com contagem de pacientes distintos
        cur.execute("""
            SELECT
                cd_medico_resp,
                nm_medico_resp,
                COUNT(DISTINCT nr_atendimento) AS qt_pacientes
            FROM painel25_ps_exames_medico
            WHERE nm_medico_resp IS NOT NULL
              AND nm_medico_resp <> ''
            GROUP BY cd_medico_resp, nm_medico_resp
            ORDER BY nm_medico_resp
        """)
        medicos = [serializar_linha(r) for r in cur.fetchall()]

        # Clinicas com contagem de pacientes distintos
        cur.execute("""
            SELECT
                ds_clinica,
                COUNT(DISTINCT nr_atendimento) AS qt_pacientes
            FROM painel25_ps_exames_medico
            WHERE ds_clinica IS NOT NULL
              AND ds_clinica <> ''
            GROUP BY ds_clinica
            ORDER BY ds_clinica
        """)
        clinicas = [serializar_linha(r) for r in cur.fetchall()]

        return jsonify({
            'success': True,
            'medicos': medicos,
            'clinicas': clinicas
        })

    except Exception as e:
        current_app.logger.error('[P25] Erro filtros: %s', e, exc_info=True)
        return jsonify({'success': False, 'error': str(e)}), 500
    finally:
        if conn:
            release_connection(conn)