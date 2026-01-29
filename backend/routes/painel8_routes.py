"""
Painel 8 - Monitoramento de Enfermaria
Endpoints para acompanhamento de pacientes internados
"""
from flask import Blueprint, jsonify, send_from_directory, request, session, current_app
from datetime import datetime
from psycopg2.extras import RealDictCursor
from backend.database import get_db_connection
from backend.middleware.decorators import login_required
from backend.user_management import verificar_permissao_painel

# Cria o Blueprint
painel8_bp = Blueprint('painel8', __name__)


# =========================================================
# ROTAS DE PÁGINA HTML
# =========================================================

@painel8_bp.route('/painel/painel8')
@login_required
def painel8():
    """Página principal do Painel 8"""
    usuario_id = session.get('usuario_id')
    is_admin = session.get('is_admin', False)

    if not is_admin:
        if not verificar_permissao_painel(usuario_id, 'painel8'):
            current_app.logger.warning(f'Acesso negado ao painel8: {session.get("usuario")}')
            return send_from_directory('frontend', 'acesso-negado.html')

    return send_from_directory('paineis/painel8', 'index.html')


# =========================================================
# ROTAS DE API
# =========================================================

@painel8_bp.route('/api/paineis/painel8/enfermaria', methods=['GET'])
@login_required
def api_painel8_enfermaria():
    """
    Retorna dados dos leitos/pacientes
    GET /api/paineis/painel8/enfermaria?setor=...
    Query params:
    - setor: Filtra por setor específico (opcional)
    """
    usuario_id = session.get('usuario_id')
    is_admin = session.get('is_admin', False)

    if not is_admin:
        if not verificar_permissao_painel(usuario_id, 'painel8'):
            return jsonify({
                'success': False,
                'error': 'Sem permissão para acessar este painel'
            }), 403

    conn = get_db_connection()
    if not conn:
        return jsonify({
            'success': False,
            'error': 'Erro de conexão com o banco'
        }), 500

    try:
        cursor = conn.cursor(cursor_factory=RealDictCursor)

        # Filtro por setor (opcional)
        setor = request.args.get('setor', None)

        if setor:
            query = """
                SELECT 
                    cd_unidade as leito,
                    nr_atendimento as atendimento,
                    nm_pessoa_fisica as paciente,
                    nr_anos as idade,
                    qt_dia_permanencia as dias_internado,
                    nr_prescricao,
                    prescrito_lab_dia,
                    prescrito_proc_dia,
                    evol_medico,
                    evol_enfermeiro,
                    evol_tec_enfermagem,
                    evol_nutricionista,
                    evol_fisioterapeuta,
                    parecer_pendente,
                    alergia,
                    score_news,
                    nm_setor,
                    cd_setor_atendimento,
                    ie_status_unidade,
                    ds_tipo_acomodacao,
                    dt_previsto_alta,
                    especialidade
                FROM painel_enfermaria
                WHERE nm_setor = %s
                ORDER BY cd_unidade
            """
            cursor.execute(query, (setor,))
        else:
            query = """
                SELECT 
                    cd_unidade as leito,
                    nr_atendimento as atendimento,
                    nm_pessoa_fisica as paciente,
                    nr_anos as idade,
                    qt_dia_permanencia as dias_internado,
                    nr_prescricao,
                    prescrito_lab_dia,
                    prescrito_proc_dia,
                    evol_medico,
                    evol_enfermeiro,
                    evol_tec_enfermagem,
                    evol_nutricionista,
                    evol_fisioterapeuta,
                    parecer_pendente,
                    alergia,
                    score_news,
                    nm_setor,
                    cd_setor_atendimento,
                    ie_status_unidade,
                    ds_tipo_acomodacao,
                    dt_previsto_alta,
                    especialidade
                FROM painel_enfermaria
                ORDER BY nm_setor, cd_unidade
            """
            cursor.execute(query)

        registros = cursor.fetchall()

        # Limpa espaços do leito
        for registro in registros:
            if registro['leito']:
                registro['leito'] = registro['leito'].strip()

        cursor.close()
        conn.close()

        return jsonify({
            'success': True,
            'data': registros,
            'total': len(registros),
            'setor_filtrado': setor,
            'timestamp': datetime.now().isoformat()
        })

    except Exception as e:
        current_app.logger.error(f'Erro ao buscar dados do painel8: {e}', exc_info=True)
        if conn:
            conn.close()
        return jsonify({
            'success': False,
            'error': 'Erro ao buscar dados'
        }), 500


@painel8_bp.route('/api/paineis/painel8/setores', methods=['GET'])
@login_required
def api_painel8_setores():
    """
    Retorna lista de setores disponíveis
    GET /api/paineis/painel8/setores
    """
    usuario_id = session.get('usuario_id')
    is_admin = session.get('is_admin', False)

    if not is_admin:
        if not verificar_permissao_painel(usuario_id, 'painel8'):
            return jsonify({
                'success': False,
                'error': 'Sem permissão para acessar este painel'
            }), 403

    conn = get_db_connection()
    if not conn:
        return jsonify({
            'success': False,
            'error': 'Erro de conexão com o banco'
        }), 500

    try:
        cursor = conn.cursor(cursor_factory=RealDictCursor)

        query = """
            SELECT DISTINCT 
                nm_setor,
                cd_setor_atendimento
            FROM painel_enfermaria
            WHERE nm_setor IS NOT NULL
            ORDER BY nm_setor
        """

        cursor.execute(query)
        setores = cursor.fetchall()

        cursor.close()
        conn.close()

        return jsonify({
            'success': True,
            'setores': setores,
            'total': len(setores),
            'timestamp': datetime.now().isoformat()
        })

    except Exception as e:
        current_app.logger.error(f'Erro ao buscar setores do painel8: {e}', exc_info=True)
        if conn:
            conn.close()
        return jsonify({
            'success': False,
            'error': 'Erro ao buscar dados'
        }), 500


@painel8_bp.route('/api/paineis/painel8/stats', methods=['GET'])
@login_required
def api_painel8_stats():
    """
    Retorna estatísticas de ocupação
    GET /api/paineis/painel8/stats?setor=...
    Query params:
    - setor: Calcula stats para setor específico (opcional)
    """
    usuario_id = session.get('usuario_id')
    is_admin = session.get('is_admin', False)

    if not is_admin:
        if not verificar_permissao_painel(usuario_id, 'painel8'):
            return jsonify({
                'success': False,
                'error': 'Sem permissão para acessar este painel'
            }), 403

    conn = get_db_connection()
    if not conn:
        return jsonify({
            'success': False,
            'error': 'Erro de conexão com o banco'
        }), 500

    try:
        cursor = conn.cursor(cursor_factory=RealDictCursor)

        setor = request.args.get('setor', None)

        if setor:
            query = """
                SELECT 
                    nm_setor,
                    COUNT(*) as total_leitos,
                    COUNT(nr_atendimento) as leitos_ocupados,
                    COUNT(*) - COUNT(nr_atendimento) as leitos_livres,
                    ROUND(
                        (COUNT(nr_atendimento)::NUMERIC / COUNT(*)::NUMERIC) * 100, 
                        1
                    ) as percentual_ocupacao,
                    SUM(CASE WHEN score_news >= 5 THEN 1 ELSE 0 END) as pacientes_criticos,
                    SUM(CASE WHEN parecer_pendente = 'Sim' THEN 1 ELSE 0 END) as pareceres_pendentes,
                    SUM(CASE WHEN evol_medico = 'X' AND nr_atendimento IS NOT NULL THEN 1 ELSE 0 END) as sem_evolucao_medico
                FROM painel_enfermaria
                WHERE nm_setor = %s
                GROUP BY nm_setor
            """
            cursor.execute(query, (setor,))
            stats = cursor.fetchone()
        else:
            query = """
                SELECT 
                    nm_setor,
                    COUNT(*) as total_leitos,
                    COUNT(nr_atendimento) as leitos_ocupados,
                    COUNT(*) - COUNT(nr_atendimento) as leitos_livres,
                    ROUND(
                        (COUNT(nr_atendimento)::NUMERIC / COUNT(*)::NUMERIC) * 100, 
                        1
                    ) as percentual_ocupacao,
                    SUM(CASE WHEN score_news >= 5 THEN 1 ELSE 0 END) as pacientes_criticos,
                    SUM(CASE WHEN parecer_pendente = 'Sim' THEN 1 ELSE 0 END) as pareceres_pendentes,
                    SUM(CASE WHEN evol_medico = 'X' AND nr_atendimento IS NOT NULL THEN 1 ELSE 0 END) as sem_evolucao_medico
                FROM painel_enfermaria
                GROUP BY nm_setor
                ORDER BY nm_setor
            """
            cursor.execute(query)
            stats = cursor.fetchall()

        cursor.close()
        conn.close()

        return jsonify({
            'success': True,
            'stats': stats,
            'setor_filtrado': setor,
            'timestamp': datetime.now().isoformat()
        })

    except Exception as e:
        current_app.logger.error(f'Erro ao buscar estatísticas do painel8: {e}', exc_info=True)
        if conn:
            conn.close()
        return jsonify({
            'success': False,
            'error': 'Erro ao buscar dados'
        }), 500