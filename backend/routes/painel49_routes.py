from flask import Blueprint, jsonify, send_from_directory, request, current_app
from backend.database import get_db_cursor
from backend.middleware.decorators import login_required, panel_permission_required

painel49_bp = Blueprint('painel49', __name__)


@painel49_bp.route('/painel/painel49')
@login_required
@panel_permission_required('painel49')
def painel49():
    return send_from_directory('paineis/painel49', 'index.html')


@painel49_bp.route('/api/paineis/painel49/resumo')
@login_required
def api_painel49_resumo():
    dt_inicio = request.args.get('dt_inicio', '').strip()
    dt_fim    = request.args.get('dt_fim',    '').strip()
    if not dt_inicio or not dt_fim:
        return jsonify({'success': False, 'error': 'dt_inicio e dt_fim obrigatórios'}), 400
    try:
        with get_db_cursor() as cursor:
            cursor.execute("""
                SELECT
                    ds_agenda,
                    tipo_sala,
                    COUNT(*)                                                AS total_cirurgias,
                    COALESCE(ROUND(SUM(duracao_sala_min)::NUMERIC, 1), 0)  AS total_sala_min,
                    COALESCE(ROUND(AVG(duracao_sala_min)::NUMERIC, 1), 0)  AS avg_sala_min,
                    COALESCE(ROUND(SUM(duracao_real_min)::NUMERIC, 1), 0)  AS total_real_min,
                    COALESCE(ROUND(AVG(duracao_real_min)::NUMERIC, 1), 0)  AS avg_real_min,
                    COALESCE(ROUND(SUM(ociosidade_antes_min)::NUMERIC, 1), 0) AS total_ociosidade_min,
                    COUNT(CASE WHEN ociosidade_antes_min > 0 THEN 1 END)   AS qtd_gaps,
                    COUNT(DISTINCT dt_agenda)                               AS dias_com_cirurgia
                FROM vw_p49_tempo_salas
                WHERE dt_agenda BETWEEN %s AND %s
                  AND status_calculado = 'concluida'
                GROUP BY ds_agenda, tipo_sala
                ORDER BY tipo_sala, ds_agenda
            """, (dt_inicio, dt_fim))
            dados = [dict(r) for r in cursor.fetchall()]
        return jsonify({'success': True, 'dados': dados})
    except Exception as e:
        current_app.logger.error('Erro resumo painel49: %s', e, exc_info=True)
        return jsonify({'success': False, 'error': 'Erro ao buscar resumo'}), 500


@painel49_bp.route('/api/paineis/painel49/detalhe')
@login_required
def api_painel49_detalhe():
    dt_inicio = request.args.get('dt_inicio', '').strip()
    dt_fim    = request.args.get('dt_fim',    '').strip()
    sala      = request.args.get('sala',      '').strip()
    tipo      = request.args.get('tipo',      '').strip()

    if not dt_inicio or not dt_fim:
        return jsonify({'success': False, 'error': 'dt_inicio e dt_fim obrigatórios'}), 400

    conditions = ['dt_agenda BETWEEN %s AND %s']
    params     = [dt_inicio, dt_fim]

    if sala:
        conditions.append('ds_agenda = %s')
        params.append(sala)
    if tipo in ('cc', 'hemo'):
        conditions.append('tipo_sala = %s')
        params.append(tipo)

    sql = (
        'SELECT'
        '  dt_agenda, ds_agenda, tipo_sala, ordem_na_sala,'
        '  hr_inicio, nr_minuto_duracao,'
        '  nm_paciente_pf, nm_medico, ds_proc_cir, ds_carater_cirurgia,'
        '  status_calculado, evento_descricao,'
        '  dt_entrada_cc, dt_inicio_procedimento, dt_fim_cirurgia,'
        '  duracao_sala_min, duracao_real_min, ociosidade_antes_min,'
        '  nm_instrumentador, nm_circulante,'
        '  nr_cirurgia, nr_prescricao, ds_convenio'
        ' FROM vw_p49_tempo_salas'
        ' WHERE ' + ' AND '.join(conditions) +
        ' ORDER BY ds_agenda, dt_agenda, ordem_na_sala'
        ' LIMIT 2000'
    )

    try:
        with get_db_cursor() as cursor:
            cursor.execute(sql, tuple(params))
            dados = [dict(r) for r in cursor.fetchall()]
        return jsonify({'success': True, 'dados': dados, 'total': len(dados)})
    except Exception as e:
        current_app.logger.error('Erro detalhe painel49: %s', e, exc_info=True)
        return jsonify({'success': False, 'error': 'Erro ao buscar detalhe'}), 500


@painel49_bp.route('/api/paineis/painel49/salas')
@login_required
def api_painel49_salas():
    try:
        with get_db_cursor() as cursor:
            cursor.execute("""
                SELECT DISTINCT ds_agenda, tipo_sala
                FROM p49_cirurgias_historico
                ORDER BY tipo_sala, ds_agenda
            """)
            dados = [dict(r) for r in cursor.fetchall()]
        return jsonify({'success': True, 'dados': dados})
    except Exception as e:
        current_app.logger.error('Erro salas painel49: %s', e, exc_info=True)
        return jsonify({'success': False, 'error': 'Erro ao buscar salas'}), 500
