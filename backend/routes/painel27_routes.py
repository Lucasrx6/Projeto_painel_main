"""
Painel 27 - Evolucao Clinica do Paciente
Endpoints para dashboard, dados de pacientes, sinais vitais e exames
"""
from flask import Blueprint, jsonify, send_from_directory, request, session, current_app
from psycopg2.extras import RealDictCursor
from backend.database import get_db_connection, release_connection
from backend.middleware.decorators import login_required
from backend.user_management import verificar_permissao_painel

painel27_bp = Blueprint('painel27', __name__)


def _verificar_acesso():
    usuario_id = session.get('usuario_id')
    is_admin = session.get('is_admin', False)
    if not is_admin:
        if not verificar_permissao_painel(usuario_id, 'painel27'):
            return False
    return True


# =========================================================
# PAGINA HTML
# =========================================================

@painel27_bp.route('/painel/painel27')
@login_required
def painel27():
    if not _verificar_acesso():
        return send_from_directory('frontend', 'acesso-negado.html')
    return send_from_directory('paineis/painel27', 'index.html')


# =========================================================
# DASHBOARD - KPIs
# =========================================================

@painel27_bp.route('/api/paineis/painel27/dashboard', methods=['GET'])
@login_required
def api_painel27_dashboard():
    if not _verificar_acesso():
        return jsonify({'success': False, 'error': 'Sem permissao'}), 403

    conn = get_db_connection()
    if not conn:
        return jsonify({'success': False, 'error': 'Erro de conexao'}), 500

    try:
        cursor = conn.cursor(cursor_factory=RealDictCursor)

        # Filtros
        setor = request.args.get('setor', '')
        status = request.args.get('status', '')

        where = " WHERE 1=1"
        params = []

        if setor:
            where += " AND cd_setor_atendimento = %s"
            params.append(setor)
        if status:
            where += " AND status_paciente = %s"
            params.append(status)

        cursor.execute("""
            SELECT
                COUNT(*) AS total_pacientes,
                COUNT(*) FILTER (WHERE status_paciente = 'INTERNADO') AS internados,
                COUNT(*) FILTER (WHERE status_paciente = 'ALTA') AS altas,
                ROUND(AVG(dias_internacao) FILTER (WHERE status_paciente = 'INTERNADO'), 1) AS media_dias_internacao,
                COUNT(*) FILTER (WHERE pa_sistolica IS NOT NULL) AS com_sinais_vitais,
                COUNT(DISTINCT nm_setor) AS total_setores
            FROM p27_pacientes
        """ + where, params)

        kpis = cursor.fetchone()

        # Exames disponiveis
        cursor.execute("""
            SELECT COUNT(DISTINCT nr_atendimento) AS pacientes_com_exame,
                   COUNT(*) AS total_resultados
            FROM p27_exames_lab
            WHERE rn_recencia = 1
        """)
        exames_kpi = cursor.fetchone()

        cursor.close()
        release_connection(conn)

        return jsonify({
            'success': True,
            'data': {
                'total_pacientes': kpis['total_pacientes'],
                'internados': kpis['internados'],
                'altas': kpis['altas'],
                'media_dias_internacao': float(kpis['media_dias_internacao'] or 0),
                'com_sinais_vitais': kpis['com_sinais_vitais'],
                'total_setores': kpis['total_setores'],
                'pacientes_com_exame': exames_kpi['pacientes_com_exame'],
                'total_resultados': exames_kpi['total_resultados']
            }
        })

    except Exception as e:
        current_app.logger.error('Erro dashboard P27: %s', e, exc_info=True)
        if conn:
            release_connection(conn)
        return jsonify({'success': False, 'error': str(e)}), 500


# =========================================================
# DADOS - Lista de pacientes com sinais e exames
# =========================================================

@painel27_bp.route('/api/paineis/painel27/dados', methods=['GET'])
@login_required
def api_painel27_dados():
    if not _verificar_acesso():
        return jsonify({'success': False, 'error': 'Sem permissao'}), 403

    conn = get_db_connection()
    if not conn:
        return jsonify({'success': False, 'error': 'Erro de conexao'}), 500

    try:
        cursor = conn.cursor(cursor_factory=RealDictCursor)

        # Filtros
        setor = request.args.get('setor', '')
        status = request.args.get('status', '')
        busca = request.args.get('busca', '')

        where = " WHERE 1=1"
        params = []

        if setor:
            where += " AND cd_setor_atendimento = %s"
            params.append(setor)
        if status:
            where += " AND status_paciente = %s"
            params.append(status)
        if busca:
            where += " AND (UPPER(nm_paciente) LIKE UPPER(%s) OR CAST(nr_atendimento AS TEXT) LIKE %s)"
            params.append('%%' + busca + '%%')
            params.append('%%' + busca + '%%')

        # Pacientes com sinais vitais
        cursor.execute("""
            SELECT
                nr_atendimento, cd_paciente, nm_paciente, idade, ie_sexo,
                nr_prontuario, convenio, nm_medico_resp, cd_cid_principal,
                ds_clinica, ds_tipo_atendimento,
                dt_entrada_hosp, dt_alta, ds_motivo_alta, status_paciente,
                cd_setor_atendimento, nm_setor, cd_leito, cd_unidade_basica,
                clinica_setor, dias_internacao,
                dt_ultimo_sinal_vital,
                pa_sistolica, pa_diastolica, pam,
                freq_cardiaca, freq_resp, temperatura,
                saturacao_o2, peso, imc,
                glicemia_capilar, escala_dor
            FROM p27_pacientes
        """ + where + """
            ORDER BY
                CASE WHEN status_paciente = 'INTERNADO' THEN 0 ELSE 1 END,
                nm_setor, cd_leito
        """, params)

        pacientes = cursor.fetchall()

        # Exames por paciente (ultimo de cada tipo)
        if pacientes:
            atendimentos = [p['nr_atendimento'] for p in pacientes]
            placeholders = ','.join(['%s'] * len(atendimentos))

            cursor.execute("""
                SELECT nr_atendimento, cd_exame, nm_exame,
                       resultado_texto, resultado_numerico,
                       dt_coleta, dt_resultado, rn_recencia
                FROM p27_exames_lab
                WHERE nr_atendimento IN ({})
                  AND rn_recencia <= 3
                ORDER BY nr_atendimento, cd_exame, rn_recencia
            """.format(placeholders), atendimentos)

            exames_raw = cursor.fetchall()

            # Agrupa exames por paciente
            exames_por_pac = {}
            for e in exames_raw:
                nr = e['nr_atendimento']
                if nr not in exames_por_pac:
                    exames_por_pac[nr] = []
                exames_por_pac[nr].append(dict(e))

            # Anexa exames a cada paciente
            for p in pacientes:
                p['exames'] = exames_por_pac.get(p['nr_atendimento'], [])
        else:
            for p in pacientes:
                p['exames'] = []

        cursor.close()
        release_connection(conn)

        return jsonify({
            'success': True,
            'data': [dict(p) for p in pacientes],
            'total': len(pacientes)
        })

    except Exception as e:
        current_app.logger.error('Erro dados P27: %s', e, exc_info=True)
        if conn:
            release_connection(conn)
        return jsonify({'success': False, 'error': str(e)}), 500


# =========================================================
# HISTORICO SINAIS - Serie temporal de um paciente
# =========================================================

@painel27_bp.route('/api/paineis/painel27/historico-sinais/<int:nr_atendimento>', methods=['GET'])
@login_required
def api_painel27_historico_sinais(nr_atendimento):
    if not _verificar_acesso():
        return jsonify({'success': False, 'error': 'Sem permissao'}), 403

    conn = get_db_connection()
    if not conn:
        return jsonify({'success': False, 'error': 'Erro de conexao'}), 500

    try:
        cursor = conn.cursor(cursor_factory=RealDictCursor)

        dias = request.args.get('dias', '7')
        try:
            dias = min(int(dias), 30)
        except ValueError:
            dias = 7

        cursor.execute("""
            SELECT
                TO_CHAR(dt_registro, 'DD/MM HH24:MI') AS dt_registro_fmt,
                dt_registro,
                pa_sistolica, pa_diastolica, pam,
                freq_cardiaca, freq_resp, temperatura,
                saturacao_o2, glicemia_capilar, escala_dor
            FROM p27_historico_sinais
            WHERE nr_atendimento = %s
              AND dt_registro >= CURRENT_TIMESTAMP - INTERVAL '%s days'
            ORDER BY dt_registro ASC
        """, (nr_atendimento, dias))

        registros = cursor.fetchall()
        cursor.close()
        release_connection(conn)

        return jsonify({
            'success': True,
            'data': [dict(r) for r in registros],
            'total': len(registros)
        })

    except Exception as e:
        current_app.logger.error('Erro historico sinais P27: %s', e, exc_info=True)
        if conn:
            release_connection(conn)
        return jsonify({'success': False, 'error': str(e)}), 500


# =========================================================
# HISTORICO EXAMES - Serie temporal de um paciente
# =========================================================

@painel27_bp.route('/api/paineis/painel27/historico-exames/<int:nr_atendimento>', methods=['GET'])
@login_required
def api_painel27_historico_exames(nr_atendimento):
    if not _verificar_acesso():
        return jsonify({'success': False, 'error': 'Sem permissao'}), 403

    conn = get_db_connection()
    if not conn:
        return jsonify({'success': False, 'error': 'Erro de conexao'}), 500

    try:
        cursor = conn.cursor(cursor_factory=RealDictCursor)

        cd_exame = request.args.get('cd_exame', '')

        query = """
            SELECT
                TO_CHAR(dt_registro, 'DD/MM HH24:MI') AS dt_registro_fmt,
                dt_registro,
                cd_exame, nm_exame,
                resultado_texto, resultado_numerico,
                nr_prescricao, dt_coleta, dt_resultado
            FROM p27_historico_exames
            WHERE nr_atendimento = %s
        """
        params = [nr_atendimento]

        if cd_exame:
            query += " AND cd_exame = %s"
            params.append(cd_exame)

        query += " ORDER BY cd_exame, dt_registro ASC"

        cursor.execute(query, params)
        registros = cursor.fetchall()
        cursor.close()
        release_connection(conn)

        return jsonify({
            'success': True,
            'data': [dict(r) for r in registros],
            'total': len(registros)
        })

    except Exception as e:
        current_app.logger.error('Erro historico exames P27: %s', e, exc_info=True)
        if conn:
            release_connection(conn)
        return jsonify({'success': False, 'error': str(e)}), 500


# =========================================================
# FILTROS - Setores e clinicas disponiveis
# =========================================================

@painel27_bp.route('/api/paineis/painel27/filtros', methods=['GET'])
@login_required
def api_painel27_filtros():
    if not _verificar_acesso():
        return jsonify({'success': False, 'error': 'Sem permissao'}), 403

    conn = get_db_connection()
    if not conn:
        return jsonify({'success': False, 'error': 'Erro de conexao'}), 500

    try:
        cursor = conn.cursor(cursor_factory=RealDictCursor)

        cursor.execute("""
            SELECT DISTINCT cd_setor_atendimento, nm_setor
            FROM p27_pacientes
            WHERE nm_setor IS NOT NULL
            ORDER BY nm_setor
        """)
        setores = cursor.fetchall()

        cursor.execute("""
            SELECT DISTINCT clinica_setor
            FROM p27_pacientes
            WHERE clinica_setor IS NOT NULL
            ORDER BY clinica_setor
        """)
        clinicas = cursor.fetchall()

        cursor.execute("""
            SELECT DISTINCT cd_exame, nm_exame
            FROM p27_exames_lab
            ORDER BY nm_exame
        """)
        exames = cursor.fetchall()

        cursor.close()
        release_connection(conn)

        return jsonify({
            'success': True,
            'setores': [dict(s) for s in setores],
            'clinicas': [c['clinica_setor'] for c in clinicas],
            'exames': [dict(e) for e in exames]
        })

    except Exception as e:
        current_app.logger.error('Erro filtros P27: %s', e, exc_info=True)
        if conn:
            release_connection(conn)
        return jsonify({'success': False, 'error': str(e)}), 500