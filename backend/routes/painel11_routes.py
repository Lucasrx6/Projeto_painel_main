"""
Painel 11 - Monitoramento de Alta do PS
Endpoints para acompanhamento de pacientes com alta para internacao
"""
from flask import Blueprint, jsonify, send_from_directory, request, session, current_app
from datetime import datetime
from statistics import median
from psycopg2.extras import RealDictCursor
from backend.database import get_db_connection
from backend.middleware.decorators import login_required
from backend.user_management import verificar_permissao_painel

# Cria o Blueprint
painel11_bp = Blueprint('painel11', __name__)


# =========================================================
# FUNCOES AUXILIARES
# =========================================================

def _verificar_acesso():
    """Verifica permissao de acesso ao painel"""
    usuario_id = session.get('usuario_id')
    is_admin = session.get('is_admin', False)

    if not is_admin:
        if not verificar_permissao_painel(usuario_id, 'painel11'):
            return False
    return True


def _build_common_filters():
    """
    Constroi filtros compartilhados entre dashboard e lista.
    Garante que KPIs e tabela sempre reflitam os mesmos filtros.
    Retorna (where_clauses, params)
    """
    clauses = []
    params = []

    # Filtro por status de internacao
    status_internacao = request.args.get('status_internacao', '')
    if status_internacao:
        valores = [v.strip() for v in status_internacao.split(',') if v.strip()]
        if valores:
            placeholders = ', '.join(['%s'] * len(valores))
            clauses.append('status_internacao IN ({})'.format(placeholders))
            params.extend(valores)

    # Filtro por status gestao de vagas
    status_gv = request.args.get('cd_status_gv', '')
    if status_gv:
        valores = [v.strip() for v in status_gv.split(',') if v.strip()]
        if valores:
            placeholders = ', '.join(['%s'] * len(valores))
            clauses.append('cd_status_gv IN ({})'.format(placeholders))
            params.extend(valores)

    # Filtro por clinica
    clinica = request.args.get('ds_clinica', '')
    if clinica:
        valores = [v.strip() for v in clinica.split(',') if v.strip()]
        if valores:
            placeholders = ', '.join(['%s'] * len(valores))
            clauses.append('ds_clinica IN ({})'.format(placeholders))
            params.extend(valores)

    # Filtro por convenio
    convenio = request.args.get('ds_convenio', '')
    if convenio:
        valores = [v.strip() for v in convenio.split(',') if v.strip()]
        if valores:
            placeholders = ', '.join(['%s'] * len(valores))
            clauses.append('ds_convenio IN ({})'.format(placeholders))
            params.extend(valores)

    return clauses, params


# =========================================================
# ROTAS DE PAGINA HTML
# =========================================================

@painel11_bp.route('/painel/painel11')
@login_required
def painel11():
    """Pagina principal do Painel 11"""
    if not _verificar_acesso():
        current_app.logger.warning('Acesso negado ao painel11: {}'.format(session.get('usuario')))
        return send_from_directory('frontend', 'acesso-negado.html')

    return send_from_directory('paineis/painel11', 'index.html')


# =========================================================
# ROTAS DE API
# =========================================================

@painel11_bp.route('/api/paineis/painel11/filtros', methods=['GET'])
@login_required
def api_painel11_filtros():
    """
    Retorna valores distintos para popular os filtros dinamicos.
    GET /api/paineis/painel11/filtros
    """
    if not _verificar_acesso():
        return jsonify({'success': False, 'error': 'Sem permissao'}), 403

    conn = get_db_connection()
    if not conn:
        return jsonify({'success': False, 'error': 'Erro de conexao com o banco'}), 500

    try:
        cursor = conn.cursor(cursor_factory=RealDictCursor)

        # Status internacao
        cursor.execute("""
            SELECT DISTINCT status_internacao
            FROM vw_painel_ps_alta_internacao
            WHERE status_internacao IS NOT NULL AND status_internacao <> ''
            ORDER BY status_internacao
        """)
        status_internacao = [r['status_internacao'] for r in cursor.fetchall()]

        # Status gestao de vagas
        cursor.execute("""
            SELECT DISTINCT cd_status_gv, ds_status_gv
            FROM vw_painel_ps_alta_internacao
            WHERE cd_status_gv IS NOT NULL AND cd_status_gv <> ''
            ORDER BY ds_status_gv
        """)
        status_gv = [{'codigo': r['cd_status_gv'], 'descricao': r['ds_status_gv']} for r in cursor.fetchall()]

        # Clinicas
        cursor.execute("""
            SELECT DISTINCT ds_clinica
            FROM vw_painel_ps_alta_internacao
            WHERE ds_clinica IS NOT NULL AND ds_clinica <> ''
            ORDER BY ds_clinica
        """)
        clinicas = [r['ds_clinica'] for r in cursor.fetchall()]

        # Convenios
        cursor.execute("""
            SELECT DISTINCT ds_convenio
            FROM vw_painel_ps_alta_internacao
            WHERE ds_convenio IS NOT NULL AND ds_convenio <> ''
            ORDER BY ds_convenio
        """)
        convenios = [r['ds_convenio'] for r in cursor.fetchall()]

        cursor.close()
        conn.close()

        return jsonify({
            'success': True,
            'data': {
                'status_internacao': status_internacao,
                'status_gv': status_gv,
                'clinicas': clinicas,
                'convenios': convenios
            }
        })

    except Exception as e:
        current_app.logger.error('Erro ao buscar filtros painel11: {}'.format(e), exc_info=True)
        if conn:
            conn.close()
        return jsonify({'success': False, 'error': 'Erro ao buscar filtros'}), 500


@painel11_bp.route('/api/paineis/painel11/dashboard', methods=['GET'])
@login_required
def api_painel11_dashboard():
    """
    Dashboard geral - estatisticas com filtros compartilhados
    Mediana calculada em Python (padrao P17)
    GET /api/paineis/painel11/dashboard?status_internacao=X&cd_status_gv=A,I
    """
    if not _verificar_acesso():
        return jsonify({'success': False, 'error': 'Sem permissao'}), 403

    conn = get_db_connection()
    if not conn:
        return jsonify({'success': False, 'error': 'Erro de conexao com o banco'}), 500

    try:
        cursor = conn.cursor(cursor_factory=RealDictCursor)

        # Filtros compartilhados
        where_clauses, params = _build_common_filters()
        where_sql = ''
        if where_clauses:
            where_sql = 'WHERE ' + ' AND '.join(where_clauses)

        # Query 1: Contagens (SQL puro, sem calculo de tempo)
        query_contagens = """
            SELECT
                COUNT(*) AS total_altas,
                COUNT(*) FILTER (WHERE status_internacao = 'AGUARDANDO_VAGA') AS total_aguardando,
                COUNT(*) FILTER (WHERE status_internacao = 'INTERNADO') AS total_internados,
                COUNT(*) FILTER (WHERE status_internacao = 'ACOMODADO') AS total_acomodados,
                COUNT(*) FILTER (WHERE status_internacao = 'VAGA_APROVADA') AS total_aprovados,
                COUNT(*) FILTER (WHERE status_internacao = 'CHAMADO') AS total_chamados,
                COUNT(*) FILTER (WHERE status_internacao = 'TRANSFERIDO') AS total_transferidos,
                COUNT(*) FILTER (WHERE status_internacao = 'CANCELADO_NEGADO') AS total_cancelados,
                COUNT(*) FILTER (
                    WHERE status_internacao IN ('AGUARDANDO_VAGA', 'CHAMADO')
                    AND minutos_aguardando >= 240
                ) AS total_criticos
            FROM vw_painel_ps_alta_internacao
            {where_sql}
        """.format(where_sql=where_sql)

        cursor.execute(query_contagens, params)
        contagens = cursor.fetchone()

        # Query 2: Tempos individuais dos internados para mediana (Python)
        # Busca dt_alta e dt_internacao dos pacientes que JA internaram
        query_tempos = """
            SELECT
                dt_alta,
                dt_internacao
            FROM vw_painel_ps_alta_internacao
            {where_sql}
        """.format(
            where_sql=('WHERE status_internacao = \'INTERNADO\' AND dt_alta IS NOT NULL AND dt_alta <> \'\' AND dt_internacao IS NOT NULL AND dt_internacao <> \'\''
                        + (' AND ' + ' AND '.join(where_clauses) if where_clauses else ''))
        )

        cursor.execute(query_tempos, params)
        registros_tempo = cursor.fetchall()

        cursor.close()
        conn.close()

        # Calcular mediana em Python (padrao P17)
        minutos_internacao = []
        for reg in registros_tempo:
            try:
                dt_alta = reg['dt_alta']
                dt_inter = reg['dt_internacao']

                # Converter strings para datetime se necessario
                if isinstance(dt_alta, str):
                    dt_alta = datetime.fromisoformat(dt_alta)
                if isinstance(dt_inter, str):
                    dt_inter = datetime.fromisoformat(dt_inter)

                if dt_alta and dt_inter:
                    diff = (dt_inter - dt_alta).total_seconds() / 60.0
                    if diff >= 0:
                        minutos_internacao.append(diff)
            except (ValueError, TypeError):
                continue

        # Formatar mediana
        if minutos_internacao:
            mediana_min = median(minutos_internacao)
            horas = int(mediana_min // 60)
            mins = int(mediana_min % 60)
            tempo_mediana = '{}h {}m'.format(horas, mins)
        else:
            tempo_mediana = '-'

        if not contagens:
            dados = {
                'total_altas': 0,
                'total_aguardando': 0,
                'total_internados': 0,
                'total_acomodados': 0,
                'total_aprovados': 0,
                'total_chamados': 0,
                'total_transferidos': 0,
                'total_cancelados': 0,
                'tempo_mediana_internacao': '-',
                'total_criticos': 0
            }
        else:
            dados = dict(contagens)
            dados['tempo_mediana_internacao'] = tempo_mediana

        return jsonify({
            'success': True,
            'data': dados,
            'timestamp': datetime.now().isoformat()
        })

    except Exception as e:
        current_app.logger.error('Erro ao buscar dashboard painel11: {}'.format(e), exc_info=True)
        if conn:
            conn.close()
        return jsonify({'success': False, 'error': 'Erro ao buscar dados'}), 500


@painel11_bp.route('/api/paineis/painel11/lista', methods=['GET'])
@login_required
def api_painel11_lista():
    """
    Lista de pacientes com alta para internacao
    GET /api/paineis/painel11/lista?status_internacao=AGUARDANDO_VAGA&cd_status_gv=A,I
    """
    if not _verificar_acesso():
        return jsonify({'success': False, 'error': 'Sem permissao'}), 403

    conn = get_db_connection()
    if not conn:
        return jsonify({'success': False, 'error': 'Erro de conexao com o banco'}), 500

    try:
        cursor = conn.cursor(cursor_factory=RealDictCursor)

        # Filtros compartilhados
        where_clauses, params = _build_common_filters()
        where_sql = ''
        if where_clauses:
            where_sql = 'WHERE ' + ' AND '.join(where_clauses)

        query = """
            SELECT
                nr_atendimento,
                nm_pessoa_fisica,
                qt_idade,
                ds_convenio,
                ds_clinica,
                dt_alta,
                ds_necessidade_vaga,
                status_internacao,
                cd_status_gv,
                ds_status_gv,
                nr_atendimento_internado,
                dt_internacao,
                minutos_aguardando
            FROM vw_painel_ps_alta_internacao
            {where_sql}
            ORDER BY
                CASE status_internacao
                    WHEN 'AGUARDANDO_VAGA' THEN 1
                    WHEN 'CHAMADO' THEN 2
                    WHEN 'VAGA_APROVADA' THEN 3
                    WHEN 'ACOMODADO' THEN 4
                    WHEN 'INTERNADO' THEN 5
                    WHEN 'TRANSFERIDO' THEN 6
                    WHEN 'CANCELADO_NEGADO' THEN 7
                    ELSE 8
                END,
                minutos_aguardando DESC NULLS LAST,
                dt_alta ASC
        """.format(where_sql=where_sql)

        cursor.execute(query, params)
        registros = cursor.fetchall()

        # Formatar datas para ISO
        resultado = []
        for reg in registros:
            item = dict(reg)
            for campo in ['dt_alta', 'dt_internacao']:
                if item.get(campo) and hasattr(item[campo], 'isoformat'):
                    item[campo] = item[campo].isoformat()
            resultado.append(item)

        cursor.close()
        conn.close()

        return jsonify({
            'success': True,
            'data': resultado,
            'total': len(resultado),
            'timestamp': datetime.now().isoformat()
        })

    except Exception as e:
        current_app.logger.error('Erro ao buscar lista painel11: {}'.format(e), exc_info=True)
        if conn:
            conn.close()
        return jsonify({'success': False, 'error': 'Erro ao buscar dados'}), 500