"""
Painel 5 - Cirurgias do Dia
Endpoints para monitoramento de cirurgias agendadas e em andamento
"""
from flask import Blueprint, jsonify, send_from_directory, session, current_app
from datetime import datetime
from backend.database import get_db_connection
from backend.middleware.decorators import login_required
from backend.user_management import verificar_permissao_painel

# Cria o Blueprint
painel5_bp = Blueprint('painel5', __name__)


# =========================================================
# ROTAS DE PÁGINA HTML
# =========================================================

@painel5_bp.route('/painel/painel5')
@login_required
def painel5():
    """Página principal do Painel 5"""
    usuario_id = session.get('usuario_id')
    is_admin = session.get('is_admin', False)

    if not is_admin:
        if not verificar_permissao_painel(usuario_id, 'painel5'):
            current_app.logger.warning(f'Acesso negado ao painel5: {session.get("usuario")}')
            return send_from_directory('frontend', 'acesso-negado.html')

    return send_from_directory('paineis/painel5', 'index.html')


# =========================================================
# ROTAS DE API
# =========================================================

@painel5_bp.route('/api/paineis/painel5/dashboard', methods=['GET'])
@login_required
def api_painel5_dashboard():
    """
    Dashboard de cirurgias
    GET /api/paineis/painel5/dashboard
    """
    usuario_id = session.get('usuario_id')
    is_admin = session.get('is_admin', False)

    if not is_admin:
        if not verificar_permissao_painel(usuario_id, 'painel5'):
            return jsonify({'success': False, 'error': 'Sem permissão'}), 403

    conn = get_db_connection()
    if not conn:
        return jsonify({'success': False, 'error': 'Erro de conexão'}), 500

    try:
        cursor = conn.cursor()
        query = """
            SELECT
                COUNT(*) as total_cirurgias,
                COUNT(*) FILTER (
                    WHERE evento = 'Sem status'
                    OR nr_cirurgia IS NULL
                ) as cirurgias_previstas,
                COUNT(*) FILTER (
                    WHERE evento_codigo IN (12, 13)
                    AND nr_cirurgia IS NOT NULL
                ) as cirurgias_andamento,
                COUNT(*) FILTER (
                    WHERE evento_codigo IN (14, 15, 16)
                    AND nr_cirurgia IS NOT NULL
                ) as cirurgias_realizadas
            FROM vw_cirurgias_dia
        """
        cursor.execute(query)
        resultado = cursor.fetchone()

        dados = {
            'total_cirurgias': resultado[0] or 0,
            'cirurgias_previstas': resultado[1] or 0,
            'cirurgias_andamento': resultado[2] or 0,
            'cirurgias_realizadas': resultado[3] or 0
        }

        cursor.close()
        conn.close()

        return jsonify({
            'success': True,
            'data': dados,
            'timestamp': datetime.now().isoformat()
        })

    except Exception as e:
        current_app.logger.error(f'Erro ao buscar dashboard painel5: {e}', exc_info=True)
        if conn:
            conn.close()
        return jsonify({'success': False, 'error': 'Erro ao buscar dados'}), 500


@painel5_bp.route('/api/paineis/painel5/cirurgias', methods=['GET'])
@login_required
def api_painel5_cirurgias():
    """
    Lista de cirurgias
    GET /api/paineis/painel5/cirurgias
    """
    usuario_id = session.get('usuario_id')
    is_admin = session.get('is_admin', False)

    if not is_admin:
        if not verificar_permissao_painel(usuario_id, 'painel5'):
            return jsonify({'success': False, 'error': 'Sem permissão'}), 403

    conn = get_db_connection()
    if not conn:
        return jsonify({'success': False, 'error': 'Erro de conexão'}), 500

    try:
        cursor = conn.cursor()
        query = """
            SELECT
                dt_agenda,
                evento_codigo,
                ds_agenda,
                cd_agenda,
                nr_minuto_duracao,
                inicio_cirurgia,
                tempo,
                nm_paciente_pf,
                ds_convenio,
                nm_medico,
                ds_idade_abrev,
                setor_cirurgia,
                nm_instrumentador,
                nm_circulante,
                dt_entrada_tasy,
                nr_atendimento,
                nr_cirurgia,
                cd_pessoa_fisica,
                nr_sequencia,
                ie_origem_proced,
                ie_tipo_classif,
                unidade_atendimento,
                ds_tipo_atendimento,
                hr_inicio,
                previsao_termino,
                nr_seq_proc_interno,
                ie_cancelada,
                nr_prescr_agenda,
                ds_proc_cir,
                evento,
                ie_status_cirurgia,
                ds_status,
                nr_prescricao,
                ie_tipo_atendimento,
                cd_medico,
                cd_procedimento,
                ds_carater_cirurgia,
                dt_carga,
                timestamp_completo,
                periodo_dia,
                cirurgia_finalizada,
                cirurgia_em_andamento
            FROM vw_cirurgias_dia
            ORDER BY dt_agenda ASC, hr_inicio ASC
        """
        cursor.execute(query)
        colunas = [desc[0] for desc in cursor.description]
        cirurgias = [dict(zip(colunas, row)) for row in cursor.fetchall()]

        cirurgias_agrupadas = {}
        for cirurgia in cirurgias:
            dia_key = cirurgia['dt_agenda'].strftime('%d/%m/%Y') if cirurgia['dt_agenda'] else 'Sem data'
            if dia_key not in cirurgias_agrupadas:
                cirurgias_agrupadas[dia_key] = {
                    'data': dia_key,
                    'grupo': f"{dia_key} - {cirurgia['periodo_dia']}",
                    'cirurgias': []
                }
            cirurgias_agrupadas[dia_key]['cirurgias'].append(cirurgia)

        resultado = sorted(cirurgias_agrupadas.values(), key=lambda x: x['data'])

        cursor.close()
        conn.close()

        return jsonify({
            'success': True,
            'data': resultado,
            'total': len(cirurgias),
            'timestamp': datetime.now().isoformat()
        })

    except Exception as e:
        current_app.logger.error(f'Erro ao buscar cirurgias painel5: {e}', exc_info=True)
        if conn:
            conn.close()
        return jsonify({'success': False, 'error': 'Erro ao buscar dados'}), 500