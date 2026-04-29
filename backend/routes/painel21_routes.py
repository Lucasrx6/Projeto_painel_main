"""
Painel 21 - Evolucao de Contas
Endpoints para monitoramento do ciclo de faturamento hospitalar

Endpoints:
    GET /painel/painel21                                - Pagina HTML
    GET /paineis/painel21/<filename>                     - Arquivos estaticos (CSS, JS)
    GET /api/paineis/painel21/dashboard                  - Cards KPI agregados (todos filtros)
    GET /api/paineis/painel21/dados                      - Listagem completa (todos filtros)
    GET /api/paineis/painel21/filtros                    - Valores distintos para filtros
"""
from flask import Blueprint, jsonify, send_from_directory, request, session, current_app
from datetime import datetime, timedelta
from decimal import Decimal
from psycopg2.extras import RealDictCursor
from backend.database import get_db_connection, release_connection
from backend.middleware.decorators import login_required
from backend.user_management import verificar_permissao_painel

# Cria o Blueprint
painel21_bp = Blueprint('painel21', __name__)


# =========================================================
# ROTAS DE PAGINA HTML E ESTATICOS
# =========================================================

@painel21_bp.route('/painel/painel21')
@login_required
def painel21():
    """Pagina principal do Painel 21"""
    usuario_id = session.get('usuario_id')
    is_admin = session.get('is_admin', False)

    if not is_admin:
        if not verificar_permissao_painel(usuario_id, 'painel21'):
            current_app.logger.warning(f'Acesso negado ao painel21: {session.get("usuario")}')
            return send_from_directory('frontend', 'acesso-negado.html')

    return send_from_directory('paineis/painel21', 'index.html')


@painel21_bp.route('/paineis/painel21/<path:filename>')
@login_required
def painel21_static(filename):
    """Serve arquivos estaticos do painel (CSS, JS)"""
    return send_from_directory('paineis/painel21', filename)


# =========================================================
# UTILITARIOS
# =========================================================

def serializar_linha(row):
    """Converte tipos nao serializaveis para JSON"""
    resultado = {}
    for chave, valor in row.items():
        if isinstance(valor, datetime):
            resultado[chave] = valor.isoformat()
        elif isinstance(valor, Decimal):
            resultado[chave] = float(valor)
        else:
            resultado[chave] = valor
    return resultado


def _parse_multi_param(param_name):
    """
    Extrai lista de valores do parametro (query string).
    Suporta valor unico ou multiplos separados por virgula.
    Retorna lista ou None.
    """
    raw = request.args.get(param_name, None)
    if not raw or raw.strip() == '':
        return None

    valores = [v.strip() for v in raw.split(',') if v.strip()]
    return valores if valores else None


def _add_multi_filter(condicoes, params, coluna, valores):
    """Adiciona clausula de filtro para lista de valores string."""
    if not valores:
        return

    if len(valores) == 1:
        condicoes.append(f'{coluna} = %s')
        params.append(valores[0])
    else:
        placeholders = ', '.join(['%s'] * len(valores))
        condicoes.append(f'{coluna} IN ({placeholders})')
        params.extend(valores)


def _add_multi_filter_int(condicoes, params, coluna, valores):
    """Mesmo que _add_multi_filter mas converte valores para int."""
    if not valores:
        return

    int_vals = []
    for v in valores:
        try:
            int_vals.append(int(v))
        except (ValueError, TypeError):
            pass

    if not int_vals:
        return

    if len(int_vals) == 1:
        condicoes.append(f'{coluna} = %s')
        params.append(int_vals[0])
    else:
        placeholders = ', '.join(['%s'] * len(int_vals))
        condicoes.append(f'{coluna} IN ({placeholders})')
        params.extend(int_vals)


def _build_common_filters():
    """
    Constroi filtros comuns usados tanto por /dados quanto por /dashboard.
    Retorna tupla (condicoes, params).
    """
    condicoes = []
    params = []

    # Periodo (dias)
    dias = request.args.get('dias', '')
    if dias:
        try:
            dias_int = int(dias)
            if dias_int > 0:
                dt_limite = datetime.now() - timedelta(days=dias_int)
                condicoes.append('dt_conta >= %s')
                params.append(dt_limite)
        except (ValueError, TypeError):
            pass

    # Data inicio
    dt_inicio = request.args.get('dt_inicio', '')
    if dt_inicio:
        try:
            dt_ini_parsed = datetime.strptime(dt_inicio, '%Y-%m-%d')
            condicoes.append('dt_conta >= %s')
            params.append(dt_ini_parsed)
        except (ValueError, TypeError):
            pass

    # Data fim
    dt_fim = request.args.get('dt_fim', '')
    if dt_fim:
        try:
            dt_fim_parsed = datetime.strptime(dt_fim, '%Y-%m-%d').replace(
                hour=23, minute=59, second=59
            )
            condicoes.append('dt_conta <= %s')
            params.append(dt_fim_parsed)
        except (ValueError, TypeError):
            pass

    # Multi-filtro: Status Conta
    status_list = _parse_multi_param('status_conta')
    _add_multi_filter(condicoes, params, 'status_conta', status_list)

    # Multi-filtro: Legenda
    legendas = _parse_multi_param('legenda')
    _add_multi_filter(condicoes, params, 'legenda_conta', legendas)

    # Multi-filtro: Tipo Atendimento
    tipos = _parse_multi_param('tipo')
    _add_multi_filter_int(condicoes, params, 'ie_tipo', tipos)

    # Multi-filtro: Status Protocolo
    protocolos = _parse_multi_param('status_protocolo')
    _add_multi_filter(condicoes, params, 'status_protocolo', protocolos)

    # Multi-filtro: Convenio
    convenios = _parse_multi_param('convenio')
    _add_multi_filter(condicoes, params, 'convenio', convenios)

    # Multi-filtro: Setor
    setores = _parse_multi_param('setor')
    _add_multi_filter(condicoes, params, 'setor_atendimento', setores)

    # Multi-filtro: Etapa
    etapas = _parse_multi_param('etapa')
    _add_multi_filter(condicoes, params, 'etapa_conta', etapas)

    # Excluir zerados
    excluir_zerados = request.args.get('excluir_zerados', '')
    if excluir_zerados == '1':
        condicoes.append('vl_conta > 0')

    # Valor minimo
    vl_min = request.args.get('vl_min', '')
    if vl_min:
        try:
            vl_min_float = float(vl_min)
            if vl_min_float >= 0:
                condicoes.append('vl_conta >= %s')
                params.append(vl_min_float)
        except (ValueError, TypeError):
            pass

    # Valor maximo
    vl_max = request.args.get('vl_max', '')
    if vl_max:
        try:
            vl_max_float = float(vl_max)
            if vl_max_float > 0:
                condicoes.append('vl_conta <= %s')
                params.append(vl_max_float)
        except (ValueError, TypeError):
            pass

    # Busca livre
    busca = request.args.get('busca', '')
    if busca:
        condicoes.append('(CAST(nr_atendimento AS TEXT) LIKE %s OR UPPER(pessoa_fisica) LIKE UPPER(%s))')
        params.append(f'%{busca}%')
        params.append(f'%{busca}%')

    return condicoes, params


# =========================================================
# API - DASHBOARD (KPIs AGREGADOS)
# =========================================================

@painel21_bp.route('/api/paineis/painel21/dashboard', methods=['GET'])
@login_required
def api_painel21_dashboard():
    """
    KPIs agregados para os cards do dashboard.
    Recebe TODOS os filtros para refletir exatamente o que esta na tabela.
    """
    usuario_id = session.get('usuario_id')
    is_admin = session.get('is_admin', False)

    if not is_admin:
        if not verificar_permissao_painel(usuario_id, 'painel21'):
            return jsonify({'success': False, 'error': 'Sem permissao'}), 403

    conn = get_db_connection()
    if not conn:
        return jsonify({'success': False, 'error': 'Erro de conexao com o banco'}), 500

    try:
        cursor = conn.cursor(cursor_factory=RealDictCursor)

        condicoes, params = _build_common_filters()

        filtro_where = ''
        if condicoes:
            filtro_where = 'WHERE ' + ' AND '.join(condicoes)

        query = f"""
            SELECT
                COUNT(*)::INTEGER                                           AS total_contas,
                COUNT(DISTINCT nr_atendimento)::INTEGER                     AS total_atendimentos,
                COALESCE(SUM(vl_conta), 0)                                  AS vl_total,

                COUNT(*) FILTER (WHERE status_conta = 'Provisório')::INTEGER    AS qt_provisorio,
                COUNT(*) FILTER (WHERE status_conta = 'Definitivo')::INTEGER    AS qt_definitivo,
                COALESCE(SUM(vl_conta) FILTER (WHERE status_conta = 'Provisório'), 0) AS vl_provisorio,
                COALESCE(SUM(vl_conta) FILTER (WHERE status_conta = 'Definitivo'), 0) AS vl_definitivo,

                COUNT(*) FILTER (WHERE legenda_conta = 'SEM NOTA/TITULO')::INTEGER  AS qt_sem_nf_titulo,
                COUNT(*) FILTER (WHERE legenda_conta = 'EM PROTOCOLO')::INTEGER     AS qt_em_protocolo,
                COUNT(*) FILTER (WHERE legenda_conta = 'NOTA FISCAL')::INTEGER      AS qt_nota_fiscal,
                COUNT(*) FILTER (WHERE legenda_conta = 'TITULO GERADO')::INTEGER    AS qt_titulo_gerado,
                COUNT(*) FILTER (WHERE legenda_conta = 'PROT.C /NF')::INTEGER       AS qt_prot_nf,
                COUNT(*) FILTER (WHERE legenda_conta = 'PROT.C /TITULO')::INTEGER   AS qt_prot_titulo,
                COALESCE(SUM(vl_conta) FILTER (WHERE legenda_conta = 'SEM NOTA/TITULO'), 0) AS vl_sem_nf_titulo,
                COALESCE(SUM(vl_conta) FILTER (WHERE legenda_conta = 'EM PROTOCOLO'), 0)    AS vl_em_protocolo,

                COUNT(*) FILTER (WHERE status_protocolo = 'Fora Remessa')::INTEGER  AS qt_fora_remessa,

                COUNT(*) FILTER (WHERE ie_tipo = 1)::INTEGER    AS qt_internacao,
                COUNT(*) FILTER (WHERE ie_tipo = 3)::INTEGER    AS qt_pronto_socorro,
                COUNT(*) FILTER (WHERE ie_tipo = 7)::INTEGER    AS qt_externo,
                COUNT(*) FILTER (WHERE ie_tipo = 8)::INTEGER    AS qt_ambulatorial,

                MAX(dt_carga) AS ultima_atualizacao
            FROM public.painel21_contas
            {filtro_where}
        """

        cursor.execute(query, params)
        result = cursor.fetchone()

        cursor.close()
        release_connection(conn)

        if not result:
            result = {
                'total_contas': 0, 'total_atendimentos': 0, 'vl_total': 0,
                'qt_provisorio': 0, 'qt_definitivo': 0,
                'qt_sem_nf_titulo': 0, 'qt_em_protocolo': 0
            }

        return jsonify({
            'success': True,
            'data': serializar_linha(dict(result)),
            'timestamp': datetime.now().isoformat()
        })

    except Exception as e:
        current_app.logger.error(f'Erro dashboard painel21: {e}', exc_info=True)
        if conn:
            release_connection(conn)
        return jsonify({'success': False, 'error': 'Erro ao buscar dados'}), 500


# =========================================================
# API - DADOS COMPLETOS (LISTAGEM)
# =========================================================

@painel21_bp.route('/api/paineis/painel21/dados', methods=['GET'])
@login_required
def api_painel21_dados():
    """
    Retorna contas com filtros server-side.
    Todos os filtros multi-valor sao separados por virgula.
    """
    usuario_id = session.get('usuario_id')
    is_admin = session.get('is_admin', False)

    if not is_admin:
        if not verificar_permissao_painel(usuario_id, 'painel21'):
            return jsonify({'success': False, 'error': 'Sem permissao'}), 403

    conn = get_db_connection()
    if not conn:
        return jsonify({'success': False, 'error': 'Erro de conexao com o banco'}), 500

    try:
        cursor = conn.cursor(cursor_factory=RealDictCursor)

        condicoes, params = _build_common_filters()

        filtro_sql = ''
        if condicoes:
            filtro_sql = 'WHERE ' + ' AND '.join(condicoes)

        query = f"""
            SELECT
                id, nr_conta, nr_atendimento, estabelecimento, pessoa_fisica,
                tipo_atend, ie_tipo, status_conta, legenda_conta,
                convenio, protocolo, status_protocolo, entrega_convenio,
                vl_conta, dt_conta, dt_periodo_inicial, dt_periodo_final,
                dt_mesano_referencia, nr_seq_etapa, etapa_conta,
                cd_setor_atendimento, setor_atendimento, auditoria,
                EXTRACT(DAY FROM (CURRENT_TIMESTAMP - dt_periodo_inicial))::INTEGER AS dias_aging
            FROM public.painel21_contas
            {filtro_sql}
            ORDER BY dt_conta DESC, nr_atendimento
            LIMIT 5000
        """

        cursor.execute(query, params)
        registros = [serializar_linha(dict(row)) for row in cursor.fetchall()]

        cursor.close()
        release_connection(conn)

        return jsonify({
            'success': True,
            'data': registros,
            'total': len(registros),
            'timestamp': datetime.now().isoformat()
        })

    except Exception as e:
        current_app.logger.error(f'Erro dados painel21: {e}', exc_info=True)
        if conn:
            release_connection(conn)
        return jsonify({'success': False, 'error': 'Erro ao buscar dados'}), 500


# =========================================================
# API - FILTROS (valores distintos para selects)
# =========================================================

@painel21_bp.route('/api/paineis/painel21/filtros', methods=['GET'])
@login_required
def api_painel21_filtros():
    """
    Retorna valores distintos para popular os multi-selects.
    """
    usuario_id = session.get('usuario_id')
    is_admin = session.get('is_admin', False)

    if not is_admin:
        if not verificar_permissao_painel(usuario_id, 'painel21'):
            return jsonify({'success': False, 'error': 'Sem permissao'}), 403

    conn = get_db_connection()
    if not conn:
        return jsonify({'success': False, 'error': 'Erro de conexao com o banco'}), 500

    try:
        cursor = conn.cursor()

        filtros = {}

        campos = [
            ('convenios', 'convenio'),
            ('setores', 'setor_atendimento'),
            ('etapas', 'etapa_conta'),
            ('legendas', 'legenda_conta'),
            ('auditorias', 'auditoria'),
            ('protocolos', 'status_protocolo')
        ]

        for nome, coluna in campos:
            cursor.execute(f"""
                SELECT DISTINCT {coluna}
                FROM public.painel21_contas
                WHERE {coluna} IS NOT NULL AND {coluna} != ''
                ORDER BY {coluna}
            """)
            filtros[nome] = [row[0] for row in cursor.fetchall()]

        cursor.close()
        release_connection(conn)

        return jsonify({
            'success': True,
            'filtros': filtros,
            'timestamp': datetime.now().isoformat()
        })

    except Exception as e:
        current_app.logger.error(f'Erro filtros painel21: {e}', exc_info=True)
        if conn:
            release_connection(conn)
        return jsonify({'success': False, 'error': 'Erro ao buscar filtros'}), 500