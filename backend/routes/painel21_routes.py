"""
Painel 21 - Evolucao de Contas
Endpoints para monitoramento do ciclo de faturamento hospitalar

Endpoints:
    GET /painel/painel21                                - Pagina HTML
    GET /paineis/painel21/<filename>                     - Arquivos estaticos (CSS, JS)
    GET /api/paineis/painel21/dashboard?dias=            - Cards KPI agregados
    GET /api/paineis/painel21/dados?dias=&status=&legenda=&tipo=  - Listagem completa
    GET /api/paineis/painel21/filtros                    - Valores distintos para filtros
"""
from flask import Blueprint, jsonify, send_from_directory, request, session, current_app
from datetime import datetime, timedelta
from decimal import Decimal
from psycopg2.extras import RealDictCursor
from backend.database import get_db_connection
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


def _obter_filtro_periodo(dias):
    """Retorna clausula SQL e parametro para filtro de periodo"""
    if not dias:
        return '', []

    try:
        dias = int(dias)
        if dias <= 0:
            return '', []
    except (ValueError, TypeError):
        return '', []

    dt_limite = datetime.now() - timedelta(days=dias)
    return 'WHERE dt_periodo_inicial >= %s', [dt_limite]


# =========================================================
# API - DASHBOARD (KPIs AGREGADOS)
# =========================================================

@painel21_bp.route('/api/paineis/painel21/dashboard', methods=['GET'])
@login_required
def api_painel21_dashboard():
    """
    KPIs agregados para os cards do dashboard.
    GET /api/paineis/painel21/dashboard
    GET /api/paineis/painel21/dashboard?dias=30
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

        dias = request.args.get('dias', '')
        dt_inicio = request.args.get('dt_inicio', '')
        dt_fim = request.args.get('dt_fim', '')

        condicoes = []
        params = []

        if dias:
            try:
                dias_int = int(dias)
                if dias_int > 0:
                    dt_limite = datetime.now() - timedelta(days=dias_int)
                    condicoes.append('dt_conta >= %s')
                    params.append(dt_limite)
            except (ValueError, TypeError):
                pass

        if dt_inicio:
            try:
                dt_ini_parsed = datetime.strptime(dt_inicio, '%Y-%m-%d')
                condicoes.append('dt_conta >= %s')
                params.append(dt_ini_parsed)
            except (ValueError, TypeError):
                pass

        if dt_fim:
            try:
                dt_fim_parsed = datetime.strptime(dt_fim, '%Y-%m-%d').replace(
                    hour=23, minute=59, second=59
                )
                condicoes.append('dt_conta <= %s')
                params.append(dt_fim_parsed)
            except (ValueError, TypeError):
                pass

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
        conn.close()

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
            conn.close()
        return jsonify({'success': False, 'error': 'Erro ao buscar dados'}), 500


# =========================================================
# API - DADOS COMPLETOS (LISTAGEM)
# =========================================================

@painel21_bp.route('/api/paineis/painel21/dados', methods=['GET'])
@login_required
def api_painel21_dados():
    """
    Retorna contas com filtros server-side.
    GET /api/paineis/painel21/dados
    GET /api/paineis/painel21/dados?dias=30
    GET /api/paineis/painel21/dados?dias=30&status_conta=Provisório
    GET /api/paineis/painel21/dados?dias=30&legenda=SEM NOTA/TITULO
    GET /api/paineis/painel21/dados?dias=30&tipo=1
    GET /api/paineis/painel21/dados?dias=30&status_protocolo=Fora Remessa
    GET /api/paineis/painel21/dados?busca=123456
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

        # Construir filtros
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

        # Data início (filtro de intervalo por dt_conta)
        dt_inicio = request.args.get('dt_inicio', '')
        if dt_inicio:
            try:
                dt_ini_parsed = datetime.strptime(dt_inicio, '%Y-%m-%d')
                condicoes.append('dt_conta >= %s')
                params.append(dt_ini_parsed)
            except (ValueError, TypeError):
                pass

        # Data fim (filtro de intervalo por dt_conta)
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

        # Status Conta
        status_conta = request.args.get('status_conta', '')
        if status_conta:
            condicoes.append('status_conta = %s')
            params.append(status_conta)

        # Legenda
        legenda = request.args.get('legenda', '')
        if legenda:
            condicoes.append('legenda_conta = %s')
            params.append(legenda)

        # Tipo Atendimento
        tipo = request.args.get('tipo', '')
        if tipo:
            try:
                condicoes.append('ie_tipo = %s')
                params.append(int(tipo))
            except (ValueError, TypeError):
                pass

        # Status Protocolo
        status_protocolo = request.args.get('status_protocolo', '')
        if status_protocolo:
            condicoes.append('status_protocolo = %s')
            params.append(status_protocolo)

        # Convenio
        convenio = request.args.get('convenio', '')
        if convenio:
            condicoes.append('convenio = %s')
            params.append(convenio)

        # Setor
        setor = request.args.get('setor', '')
        if setor:
            condicoes.append('setor_atendimento = %s')
            params.append(setor)

        # Etapa
        etapa = request.args.get('etapa', '')
        if etapa:
            condicoes.append('etapa_conta = %s')
            params.append(etapa)

        # Busca livre (nr_atendimento ou pessoa_fisica)
        busca = request.args.get('busca', '')
        if busca:
            condicoes.append('(CAST(nr_atendimento AS TEXT) LIKE %s OR UPPER(pessoa_fisica) LIKE UPPER(%s))')
            params.append(f'%{busca}%')
            params.append(f'%{busca}%')

        # Montar WHERE
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
        conn.close()

        return jsonify({
            'success': True,
            'data': registros,
            'total': len(registros),
            'timestamp': datetime.now().isoformat()
        })

    except Exception as e:
        current_app.logger.error(f'Erro dados painel21: {e}', exc_info=True)
        if conn:
            conn.close()
        return jsonify({'success': False, 'error': 'Erro ao buscar dados'}), 500


# =========================================================
# API - FILTROS (valores distintos para selects)
# =========================================================

@painel21_bp.route('/api/paineis/painel21/filtros', methods=['GET'])
@login_required
def api_painel21_filtros():
    """
    Retorna valores distintos para popular os selects de filtro.
    GET /api/paineis/painel21/filtros
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
            ('auditorias', 'auditoria')
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
        conn.close()

        return jsonify({
            'success': True,
            'filtros': filtros,
            'timestamp': datetime.now().isoformat()
        })

    except Exception as e:
        current_app.logger.error(f'Erro filtros painel21: {e}', exc_info=True)
        if conn:
            conn.close()
        return jsonify({'success': False, 'error': 'Erro ao buscar filtros'}), 500