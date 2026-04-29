"""
Painel 24 - Estoque-Dia (Controle de Ressuprimento)
Endpoints para monitoramento de estoque por setor e ressuprimento a 3 dias

Endpoints:
    GET /painel/painel24                        - Pagina HTML
    GET /paineis/painel24/<filename>             - Arquivos estaticos (CSS, JS)
    GET /api/paineis/painel24/dashboard          - Cards KPI agregados (todos filtros)
    GET /api/paineis/painel24/dados              - Listagem completa (todos filtros)
    GET /api/paineis/painel24/filtros            - Valores distintos para filtros
"""
from flask import Blueprint, jsonify, send_from_directory, request, session, current_app
from datetime import datetime
from decimal import Decimal
from psycopg2.extras import RealDictCursor
from backend.database import get_db_connection, release_connection
from backend.middleware.decorators import login_required
from backend.user_management import verificar_permissao_painel

# Cria o Blueprint
painel24_bp = Blueprint('painel24', __name__)


# =========================================================
# ROTAS DE PAGINA HTML E ESTATICOS
# =========================================================

@painel24_bp.route('/painel/painel24')
@login_required
def painel24():
    """Pagina principal do Painel 24"""
    usuario_id = session.get('usuario_id')
    is_admin = session.get('is_admin', False)

    if not is_admin:
        if not verificar_permissao_painel(usuario_id, 'painel24'):
            current_app.logger.warning(f'Acesso negado ao painel24: {session.get("usuario")}')
            return send_from_directory('frontend', 'acesso-negado.html')

    return send_from_directory('paineis/painel24', 'index.html')


@painel24_bp.route('/paineis/painel24/<path:filename>')
@login_required
def painel24_static(filename):
    """Serve arquivos estaticos do painel (CSS, JS)"""
    return send_from_directory('paineis/painel24', filename)


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
    Consulta a view vw_painel24_detalhe que ja tem colunas calculadas.
    """
    condicoes = []
    params = []

    # Multi-filtro: Local de Estoque
    locais = _parse_multi_param('local_estoque')
    _add_multi_filter_int(condicoes, params, 'cd_local_estoque', locais)

    # Multi-filtro: Tipo Local (FARMACIA, CAF, CARRINHO, MALETA, OUTRO)
    tipos_local = _parse_multi_param('tipo_local')
    _add_multi_filter(condicoes, params, 'tipo_local', tipos_local)

    # Multi-filtro: Grupo
    grupos = _parse_multi_param('grupo')
    _add_multi_filter(condicoes, params, 'grupo', grupos)

    # Multi-filtro: Subgrupo
    subgrupos = _parse_multi_param('subgrupo')
    _add_multi_filter(condicoes, params, 'subgrupo', subgrupos)

    # Multi-filtro: Classificacao
    classificacoes = _parse_multi_param('classificacao')
    _add_multi_filter(condicoes, params, 'classificacao', classificacoes)

    # Toggle: Ocultar itens sem consumo
    ocultar_sem_consumo = request.args.get('ocultar_sem_consumo', '')
    if ocultar_sem_consumo == '1':
        condicoes.append('consumo_dia > 0')

    # Toggle: Ocultar carrinhos e maletas
    ocultar_carrinhos = request.args.get('ocultar_carrinhos', '')
    if ocultar_carrinhos == '1':
        condicoes.append("tipo_local NOT IN ('CARRINHO', 'MALETA')")

    # Toggle: Apenas itens abaixo de 3 dias (com consumo)
    apenas_criticos = request.args.get('apenas_criticos', '')
    if apenas_criticos == '1':
        condicoes.append("classificacao IN ('DEVEDOR','ZERADO','CRITICO','URGENTE','ATENCAO')")

    # Busca livre (nome do item ou codigo)
    busca = request.args.get('busca', '')
    if busca:
        condicoes.append('(CAST(codigo_material AS TEXT) LIKE %s OR UPPER(item) LIKE UPPER(%s))')
        params.append(f'%{busca}%')
        params.append(f'%{busca}%')

    return condicoes, params


# =========================================================
# API - DASHBOARD (KPIs AGREGADOS)
# =========================================================

@painel24_bp.route('/api/paineis/painel24/dashboard', methods=['GET'])
@login_required
def api_painel24_dashboard():
    """
    KPIs agregados para os cards do dashboard.
    Recebe TODOS os filtros para refletir exatamente o que esta na tabela.
    """
    usuario_id = session.get('usuario_id')
    is_admin = session.get('is_admin', False)

    if not is_admin:
        if not verificar_permissao_painel(usuario_id, 'painel24'):
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
                COUNT(*)::INTEGER                                               AS total_itens,
                COUNT(DISTINCT codigo_material)::INTEGER                        AS total_materiais,
                COUNT(DISTINCT cd_local_estoque)::INTEGER                       AS total_locais,

                COUNT(*) FILTER (WHERE classificacao = 'DEVEDOR')::INTEGER      AS qt_devedor,
                COUNT(*) FILTER (WHERE classificacao = 'ZERADO')::INTEGER       AS qt_zerado,
                COUNT(*) FILTER (WHERE classificacao = 'CRITICO')::INTEGER      AS qt_critico,
                COUNT(*) FILTER (WHERE classificacao = 'URGENTE')::INTEGER      AS qt_urgente,
                COUNT(*) FILTER (WHERE classificacao = 'ATENCAO')::INTEGER      AS qt_atencao,
                COUNT(*) FILTER (WHERE classificacao = 'ADEQUADO')::INTEGER     AS qt_adequado,
                COUNT(*) FILTER (WHERE classificacao = 'CONFORTAVEL')::INTEGER  AS qt_confortavel,
                COUNT(*) FILTER (WHERE classificacao = 'EXCESSO')::INTEGER      AS qt_excesso,
                COUNT(*) FILTER (WHERE classificacao = 'SEM CONSUMO')::INTEGER  AS qt_sem_consumo,

                COUNT(*) FILTER (
                    WHERE classificacao IN ('DEVEDOR','ZERADO','CRITICO','URGENTE','ATENCAO')
                )::INTEGER                                                      AS qt_abaixo_3d,

                COUNT(*) FILTER (WHERE saldo_disponivel < 0)::INTEGER           AS qt_saldo_negativo,

                COUNT(*) FILTER (WHERE tem_origem = TRUE)::INTEGER              AS qt_com_origem,

                COUNT(*) FILTER (
                    WHERE classificacao IN ('DEVEDOR','ZERADO','CRITICO','URGENTE','ATENCAO')
                      AND tem_origem = FALSE
                )::INTEGER                                                      AS qt_sem_origem_critico,

                COALESCE(SUM(qt_ressuprimento_3d) FILTER (
                    WHERE qt_ressuprimento_3d > 0
                ), 0)                                                           AS qt_total_ressuprimento,

                COUNT(DISTINCT cd_local_estoque) FILTER (
                    WHERE classificacao IN ('DEVEDOR','ZERADO','CRITICO','URGENTE')
                )::INTEGER                                                      AS qt_locais_criticos,

                MAX(dt_carga)                                                   AS ultima_atualizacao

            FROM public.vw_painel24_detalhe
            {filtro_where}
        """

        cursor.execute(query, params)
        result = cursor.fetchone()

        cursor.close()
        release_connection(conn)

        if not result:
            result = {
                'total_itens': 0, 'total_materiais': 0, 'total_locais': 0,
                'qt_abaixo_3d': 0, 'qt_saldo_negativo': 0
            }

        return jsonify({
            'success': True,
            'data': serializar_linha(dict(result)),
            'timestamp': datetime.now().isoformat()
        })

    except Exception as e:
        current_app.logger.error(f'Erro dashboard painel24: {e}', exc_info=True)
        if conn:
            release_connection(conn)
        return jsonify({'success': False, 'error': 'Erro ao buscar dados'}), 500


# =========================================================
# API - DADOS COMPLETOS (LISTAGEM)
# =========================================================

@painel24_bp.route('/api/paineis/painel24/dados', methods=['GET'])
@login_required
def api_painel24_dados():
    """
    Retorna itens de estoque com filtros server-side.
    Todos os filtros multi-valor sao separados por virgula.
    """
    usuario_id = session.get('usuario_id')
    is_admin = session.get('is_admin', False)

    if not is_admin:
        if not verificar_permissao_painel(usuario_id, 'painel24'):
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
                id,
                mes_estoque,
                cd_local_estoque,
                local_estoque,
                tipo_local,
                grupo,
                subgrupo,
                codigo_material,
                item,
                consumo_dia,
                saldo_disponivel,
                dias_estoque,
                classificacao,
                ordem_classificacao,
                qt_ressuprimento_3d,
                cd_local_origem,
                local_origem_sugerido,
                saldo_origem,
                dias_estoque_origem,
                tem_origem
            FROM public.vw_painel24_detalhe
            {filtro_sql}
            ORDER BY ordem_classificacao ASC, dias_estoque ASC NULLS LAST, local_estoque, item
            LIMIT 10000
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
        current_app.logger.error(f'Erro dados painel24: {e}', exc_info=True)
        if conn:
            release_connection(conn)
        return jsonify({'success': False, 'error': 'Erro ao buscar dados'}), 500


# =========================================================
# API - FILTROS (valores distintos para selects)
# =========================================================

@painel24_bp.route('/api/paineis/painel24/filtros', methods=['GET'])
@login_required
def api_painel24_filtros():
    """
    Retorna valores distintos para popular os multi-selects.
    """
    usuario_id = session.get('usuario_id')
    is_admin = session.get('is_admin', False)

    if not is_admin:
        if not verificar_permissao_painel(usuario_id, 'painel24'):
            return jsonify({'success': False, 'error': 'Sem permissao'}), 403

    conn = get_db_connection()
    if not conn:
        return jsonify({'success': False, 'error': 'Erro de conexao com o banco'}), 500

    try:
        cursor = conn.cursor()

        filtros = {}

        # Locais de estoque (retorna codigo + nome para o multi-select)
        cursor.execute("""
            SELECT DISTINCT cd_local_estoque, local_estoque
            FROM public.vw_painel24_detalhe
            WHERE local_estoque IS NOT NULL AND local_estoque != ''
            ORDER BY local_estoque
        """)
        filtros['locais'] = [
            {'cd': row[0], 'nome': row[1]} for row in cursor.fetchall()
        ]

        # Campos simples (string)
        campos_simples = [
            ('tipos_local', 'tipo_local'),
            ('grupos', 'grupo'),
            ('subgrupos', 'subgrupo'),
            ('classificacoes', 'classificacao')
        ]

        for nome, coluna in campos_simples:
            cursor.execute(f"""
                SELECT DISTINCT {coluna}
                FROM public.vw_painel24_detalhe
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
        current_app.logger.error(f'Erro filtros painel24: {e}', exc_info=True)
        if conn:
            release_connection(conn)
        return jsonify({'success': False, 'error': 'Erro ao buscar filtros'}), 500