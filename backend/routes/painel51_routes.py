"""
Painel 51 — Checagem de Medicamentos à Beira do Leito
Endpoints: /api/paineis/painel51/*
Banco de dados: tabelas/views com prefixo painel41_ (nomenclatura interna de desenvolvimento).
"""
from flask import Blueprint, jsonify, make_response, request, send_from_directory, current_app
from backend.database import get_db_cursor
from backend.middleware.decorators import login_required, panel_permission_required
from backend.cache import cache_route, cache_get, cache_set

painel51_bp = Blueprint('painel51', __name__)

_SITUACOES_VALIDAS = frozenset({
    'CRITICA', 'ATRASADA', 'ABERTA', 'PROXIMA', 'AGENDADA',
    'ADM_NO_PRAZO', 'ADM_ANTECIPADA', 'ADM_ATRASADA', 'JUSTIFICADA', 'SEM_HORARIO'
})


# =============================================================================
# FILTROS COMUNS — função única que alimenta todos os endpoints
# =============================================================================

def _build_common_filters():
    """
    Parseia os query params compartilhados entre todos os endpoints do painel51.
    Retorna quatro valores: (doses_conds, doses_params, leitos_conds, leitos_params)

    *_doses  aplica em vw_painel41_doses (dose individual)
    *_leitos aplica em vw_painel41_leitos (agregação por leito)
    """
    d_conds, d_params = [], []
    l_conds, l_params = [], []

    # setor (códigos inteiros separados por vírgula)
    setor_raw = (request.args.get('setor') or '').strip()
    if setor_raw:
        try:
            setores = [int(s.strip()) for s in setor_raw.split(',') if s.strip()]
        except ValueError:
            setores = []
        if setores:
            ph = ','.join(['%s'] * len(setores))
            d_conds.append('cd_setor IN ({})'.format(ph))
            d_params.extend(setores)
            l_conds.append('cd_setor IN ({})'.format(ph))
            l_params.extend(setores)

    # situacao (whitelist de valores válidos — somente para view de doses)
    situacao_raw = (request.args.get('situacao') or '').strip()
    if situacao_raw:
        sits = [s.strip().upper() for s in situacao_raw.split(',')
                if s.strip().upper() in _SITUACOES_VALIDAS]
        if sits:
            ph = ','.join(['%s'] * len(sits))
            d_conds.append('situacao IN ({})'.format(ph))
            d_params.extend(sits)

    # subgrupo (só para view de doses)
    subgrupo = (request.args.get('subgrupo') or '').strip()
    if subgrupo:
        d_conds.append('ds_subgrupo ILIKE %s')
        d_params.append('%' + subgrupo + '%')

    # busca (leito, paciente, medicamento)
    busca = (request.args.get('busca') or '').strip()
    if busca:
        like = '%' + busca + '%'
        d_conds.append('(cd_leito ILIKE %s OR nm_paciente ILIKE %s OR ds_material ILIKE %s)')
        d_params.extend([like, like, like])
        l_conds.append('(cd_leito ILIKE %s OR nm_paciente ILIKE %s)')
        l_params.extend([like, like])

    # apenas_pendentes
    if (request.args.get('apenas_pendentes') or '0') == '1':
        d_conds.append('severidade >= 3')
        l_conds.append('severidade_max >= 3')

    # janela operacional (padrão) aplica à view de doses; a view de leitos já bake os counts
    janela = (request.args.get('janela') or 'operacional').strip()
    if janela == 'operacional':
        d_conds.append('na_janela_operacional = TRUE')
    elif janela == 'hoje':
        d_conds.append("dt_prevista::DATE = CURRENT_DATE")

    return d_conds, d_params, l_conds, l_params


def _where(conds):
    """Monta cláusula WHERE a partir de lista de condições."""
    if not conds:
        return ''
    return 'WHERE ' + ' AND '.join(conds)


# =============================================================================
# ROTAS ESTÁTICAS
# =============================================================================

@painel51_bp.route('/painel/painel51')
@login_required
@panel_permission_required('painel51')
def painel51():
    return send_from_directory('paineis/painel51', 'index.html')


@painel51_bp.route('/paineis/painel51/<path:filename>')
@login_required
def painel51_static(filename):
    return send_from_directory('paineis/painel51', filename)


# =============================================================================
# GET /api/paineis/painel51/filtros
# Setores ativos com contagens ao vivo + subgrupos disponíveis
# =============================================================================

@painel51_bp.route('/api/paineis/painel51/filtros')
@login_required
@panel_permission_required('painel51')
@cache_route(ttl=30, key_prefix='p51:filtros', vary_by_user=False)
def api_p51_filtros():
    try:
        with get_db_cursor() as cursor:
            cursor.execute("""
                SELECT
                    s.cd_setor, s.nm_setor, s.apelido, s.ordem, s.meta_aderencia,
                    COALESCE(v.qt_leitos, 0)         AS qt_leitos,
                    COALESCE(v.qt_leitos_alerta, 0)  AS qt_leitos_alerta,
                    COALESCE(v.qt_criticas, 0)       AS qt_criticas,
                    COALESCE(v.qt_atrasadas, 0)      AS qt_atrasadas,
                    COALESCE(v.pct_aderencia, 0)     AS pct_aderencia
                FROM painel41_setores s
                LEFT JOIN vw_painel41_setores v ON v.cd_setor = s.cd_setor
                WHERE s.ativo = TRUE
                ORDER BY s.ordem, s.nm_setor
            """)
            setores = [dict(r) for r in cursor.fetchall()]

            cursor.execute("""
                SELECT DISTINCT ds_subgrupo
                FROM painel41_doses
                WHERE ds_subgrupo IS NOT NULL
                  AND dt_prevista::DATE = CURRENT_DATE
                ORDER BY ds_subgrupo
            """)
            subgrupos = [r['ds_subgrupo'] for r in cursor.fetchall()]

        return jsonify({'success': True, 'setores': setores, 'subgrupos': subgrupos})
    except Exception as e:
        current_app.logger.error('Erro filtros p51: %s', e, exc_info=True)
        return jsonify({'success': False, 'error': 'Erro ao buscar filtros'}), 500


# =============================================================================
# GET /api/paineis/painel51/dashboard
# KPIs globais + rodada atual + rodadas do dia
# =============================================================================

@painel51_bp.route('/api/paineis/painel51/dashboard')
@login_required
@panel_permission_required('painel51')
@cache_route(ttl=30, key_prefix='p51:dash', vary_by_user=False, vary_by_query=True)
def api_p51_dashboard():
    _, _, l_conds, l_params = _build_common_filters()

    # Filtro de setor para vw_painel41_rodadas (query separada)
    setor_raw = (request.args.get('setor') or '').strip()
    r_conds, r_params = ['dt_rodada::DATE = CURRENT_DATE'], []
    if setor_raw:
        try:
            setores = [int(s.strip()) for s in setor_raw.split(',') if s.strip()]
        except ValueError:
            setores = []
        if setores:
            ph = ','.join(['%s'] * len(setores))
            r_conds.insert(0, 'cd_setor IN ({})'.format(ph))
            r_params.extend(setores)

    try:
        with get_db_cursor() as cursor:
            # Totais agregados dos leitos filtrados
            cursor.execute("""
                SELECT
                    COUNT(DISTINCT cd_leito)                                    AS qt_leitos,
                    COUNT(DISTINCT cd_leito) FILTER (WHERE severidade_max >= 4) AS qt_leitos_alerta,
                    COALESCE(SUM(qt_doses), 0)                                  AS qt_doses,
                    COALESCE(SUM(qt_criticas), 0)                               AS qt_criticas,
                    COALESCE(SUM(qt_atrasadas), 0)                              AS qt_atrasadas,
                    COALESCE(SUM(qt_abertas), 0)                                AS qt_abertas,
                    COALESCE(SUM(qt_proximas), 0)                               AS qt_proximas,
                    COALESCE(SUM(qt_administradas), 0)                          AS qt_administradas,
                    COALESCE(SUM(qt_justificadas), 0)                           AS qt_justificadas,
                    COALESCE(SUM(qt_sem_dispensacao), 0)                        AS qt_sem_dispensacao,
                    COALESCE(SUM(qt_stat_pendente), 0)                          AS qt_stat_pendente
                FROM vw_painel41_leitos
                {where}
            """.format(where=_where(l_conds)), l_params)
            row = cursor.fetchone()
            totais = dict(row) if row else {}

            # pct_aderencia: administradas / (administradas + criticas + atrasadas)
            adm   = int(totais.get('qt_administradas', 0))
            crit  = int(totais.get('qt_criticas', 0))
            atr   = int(totais.get('qt_atrasadas', 0))
            denom = adm + crit + atr
            totais['pct_aderencia'] = round(100.0 * adm / denom, 1) if denom > 0 else None

            # Rodada atual: mais recente já iniciada (dt_rodada <= NOW())
            rodada_atual_conds  = r_conds + ['dt_rodada <= NOW()']
            rodada_atual_params = list(r_params)
            cursor.execute("""
                SELECT hora_rodada, qt_doses, qt_leitos, qt_administradas,
                    qt_pendentes, qt_atrasadas, pct_concluida
                FROM vw_painel41_rodadas
                {where}
                ORDER BY dt_rodada DESC
                LIMIT 1
            """.format(where=_where(rodada_atual_conds)), rodada_atual_params)
            rodada_row = cursor.fetchone()
            totais['rodada_atual'] = dict(rodada_row) if rodada_row else None

            # Todas as rodadas do dia (para os chips)
            cursor.execute("""
                SELECT hora_rodada, qt_doses, qt_leitos, qt_administradas,
                    qt_pendentes, pct_concluida
                FROM vw_painel41_rodadas
                {where}
                ORDER BY dt_rodada
            """.format(where=_where(r_conds)), list(r_params))
            totais['rodadas_dia'] = [dict(r) for r in cursor.fetchall()]

        return jsonify({'success': True, 'data': totais})
    except Exception as e:
        current_app.logger.error('Erro dashboard p51: %s', e, exc_info=True)
        return jsonify({'success': False, 'error': 'Erro ao buscar dashboard'}), 500


# =============================================================================
# GET /api/paineis/painel51/leitos
# Mural — um registro por leito, ordenado por gravidade
# =============================================================================

@painel51_bp.route('/api/paineis/painel51/leitos')
@login_required
@panel_permission_required('painel51')
@cache_route(ttl=30, key_prefix='p51:leitos', vary_by_user=False, vary_by_query=True)
def api_p51_leitos():
    _, _, l_conds, l_params = _build_common_filters()
    try:
        with get_db_cursor() as cursor:
            cursor.execute("""
                SELECT
                    cd_setor, nm_setor, setor_apelido, cd_leito, nr_atendimento, nm_paciente,
                    severidade_max, maior_atraso_min,
                    qt_doses, qt_criticas, qt_atrasadas, qt_abertas, qt_proximas,
                    qt_administradas, qt_justificadas, qt_sem_dispensacao,
                    qt_alta_vigilancia, qt_stat_pendente,
                    TO_CHAR(dt_proxima_dose, 'YYYY-MM-DD"T"HH24:MI:SS') AS dt_proxima_dose,
                    TO_CHAR(dt_carga, 'YYYY-MM-DD"T"HH24:MI:SS')         AS dt_carga
                FROM vw_painel41_leitos
                {where}
                ORDER BY severidade_max DESC, maior_atraso_min DESC, cd_leito
            """.format(where=_where(l_conds)), l_params)
            leitos = [dict(r) for r in cursor.fetchall()]
        return jsonify({
            'success': True,
            'total': len(leitos),
            'data': leitos
        })
    except Exception as e:
        current_app.logger.error('Erro leitos p51: %s', e, exc_info=True)
        return jsonify({'success': False, 'error': 'Erro ao buscar leitos'}), 500


# =============================================================================
# GET /api/paineis/painel51/rodadas
# Progresso das rodadas de horário do dia por setor
# =============================================================================

@painel51_bp.route('/api/paineis/painel51/rodadas')
@login_required
@panel_permission_required('painel51')
@cache_route(ttl=30, key_prefix='p51:rodadas', vary_by_user=False, vary_by_query=True)
def api_p51_rodadas():
    setor_raw = (request.args.get('setor') or '').strip()
    conds, params = ['dt_rodada::DATE = CURRENT_DATE'], []
    if setor_raw:
        try:
            setores = [int(s.strip()) for s in setor_raw.split(',') if s.strip()]
        except ValueError:
            setores = []
        if setores:
            ph = ','.join(['%s'] * len(setores))
            conds.insert(0, 'cd_setor IN ({})'.format(ph))
            params.extend(setores)
    try:
        with get_db_cursor() as cursor:
            cursor.execute("""
                SELECT cd_setor, nm_setor, hora_rodada,
                    qt_doses, qt_leitos, qt_administradas, qt_justificadas,
                    qt_pendentes, qt_atrasadas, pct_concluida,
                    TO_CHAR(dt_inicio, 'HH24:MI') AS hr_inicio,
                    TO_CHAR(dt_fim,    'HH24:MI') AS hr_fim,
                    dt_rodada <= NOW()             AS rodada_passada
                FROM vw_painel41_rodadas
                {where}
                ORDER BY dt_rodada
            """.format(where=_where(conds)), params)
            rodadas = [dict(r) for r in cursor.fetchall()]
        return jsonify({'success': True, 'data': rodadas})
    except Exception as e:
        current_app.logger.error('Erro rodadas p51: %s', e, exc_info=True)
        return jsonify({'success': False, 'error': 'Erro ao buscar rodadas'}), 500


# =============================================================================
# GET /api/paineis/painel51/timeline
# Matriz leito × hora para a Linha do Tempo
# =============================================================================

@painel51_bp.route('/api/paineis/painel51/timeline')
@login_required
@panel_permission_required('painel51')
@cache_route(ttl=30, key_prefix='p51:tl', vary_by_user=False, vary_by_query=True)
def api_p51_timeline():
    d_conds, d_params, _, _ = _build_common_filters()
    try:
        with get_db_cursor() as cursor:
            cursor.execute("""
                SELECT
                    cd_leito, nm_paciente,
                    EXTRACT(HOUR FROM dt_prevista)::INTEGER AS hora,
                    MAX(severidade)                          AS pior_severidade,
                    COUNT(*)                                 AS qt_doses
                FROM vw_painel41_doses
                {where}
                GROUP BY cd_leito, nm_paciente, EXTRACT(HOUR FROM dt_prevista)::INTEGER
                ORDER BY cd_leito, hora
            """.format(where=_where(d_conds)), d_params)
            rows = [dict(r) for r in cursor.fetchall()]
        return jsonify({'success': True, 'data': rows})
    except Exception as e:
        current_app.logger.error('Erro timeline p51: %s', e, exc_info=True)
        return jsonify({'success': False, 'error': 'Erro ao buscar timeline'}), 500


# =============================================================================
# GET /api/paineis/painel51/paciente/<nr_atendimento>
# Doses do leito para o drawer — já agrupadas por seção
# =============================================================================

@painel51_bp.route('/api/paineis/painel51/paciente/<int:nr_atendimento>')
@login_required
@panel_permission_required('painel51')
def api_p51_paciente(nr_atendimento):
    # Cache manual: @cache_route não inclui o path na chave, então todos os
    # pacientes compartilhariam a mesma entrada. TTL=20s: abaixo do ciclo ETL
    # (5 min) e suficiente para reduzir 95%+ das queries repetidas por TV.
    _cache_key = 'p51:pac:{}'.format(nr_atendimento)
    _cached = cache_get(_cache_key)
    if _cached is not None:
        resp = make_response(jsonify(_cached))
        resp.headers['X-Cache'] = 'HIT'
        return resp

    try:
        with get_db_cursor() as cursor:
            cursor.execute("""
                SELECT
                    id, dt_prevista, ds_horario, ds_material, qt_dose, ds_unidade_medida,
                    ds_intervalo, cd_intervalo, tipo_intervalo, situacao, severidade,
                    min_atraso, alta_vigilancia, classe_vigilancia,
                    pendente_farmacia, gera_alarme,
                    dt_checagem IS NOT NULL                    AS checada,
                    nm_profissional_checagem, ds_evento_beira_leito, evento_rotulo,
                    TO_CHAR(dt_prevista,  'HH24:MI')           AS hora_prevista,
                    TO_CHAR(dt_checagem,  'HH24:MI')           AS hora_checagem,
                    TO_CHAR(dt_prevista,  'DD/MM')             AS data_prevista,
                    dt_prevista::DATE = CURRENT_DATE           AS e_hoje,
                    cd_leito, nm_paciente, cd_setor, nm_setor
                FROM vw_painel41_doses
                WHERE nr_atendimento = %s
                  AND na_janela_operacional = TRUE
                ORDER BY
                    -- Não-administradas sempre antes das administradas
                    CASE WHEN dt_checagem IS NULL THEN 0 ELSE 1 END,
                    -- Dentro das não-administradas: urgência decrescente
                    CASE WHEN situacao IN ('CRITICA','ATRASADA','ABERTA') THEN 0
                         WHEN situacao IN ('PROXIMA','AGENDADA')           THEN 1
                         ELSE 2 END,
                    severidade DESC, dt_prevista
            """, (nr_atendimento,))
            doses = [dict(r) for r in cursor.fetchall()]

        # Separador primário: checada (dt_checagem preenchido) vs. não-checada
        _nao_adm = [d for d in doses if not d.get('checada')]
        _adm     = [d for d in doses if     d.get('checada')]

        # Dentro das não-administradas: urgência vs. agendadas/futuras
        precisa_acao = [d for d in _nao_adm if d['situacao'] in ('CRITICA','ATRASADA','ABERTA')]
        proximas     = [d for d in _nao_adm if d['situacao'] not in ('CRITICA','ATRASADA','ABERTA')]
        resolvidas   = _adm

        info = {'cd_leito': None, 'nm_paciente': None, 'cd_setor': None, 'nm_setor': None}
        if doses:
            info = {k: doses[0].get(k) for k in info}

        result = {
            'success': True,
            'info': info,
            'qt_total': len(doses),
            'precisa_acao': precisa_acao,
            'proximas': proximas,
            'resolvidas': resolvidas
        }
        cache_set(_cache_key, result, ttl=20)
        return jsonify(result)
    except Exception as e:
        current_app.logger.error('Erro paciente p51 nr=%s: %s', nr_atendimento, e, exc_info=True)
        return jsonify({'success': False, 'error': 'Erro ao buscar doses do paciente'}), 500


# =============================================================================
# GET /api/paineis/painel51/tabela
# Visão tabular: pacientes com doses pendentes expandidas (sem clique)
# =============================================================================

@painel51_bp.route('/api/paineis/painel51/tabela')
@login_required
@panel_permission_required('painel51')
@cache_route(ttl=30, key_prefix='p51:tabela', vary_by_user=False, vary_by_query=True)
def api_p51_tabela():
    d_conds, d_params, _, _ = _build_common_filters()
    # Tabela mostra apenas doses que precisam de ação
    tab_conds = list(d_conds) + ["situacao IN ('CRITICA','ATRASADA','ABERTA','PROXIMA')"]
    try:
        with get_db_cursor() as cursor:
            cursor.execute("""
                SELECT
                    cd_leito, nr_atendimento, nm_paciente, nm_setor,
                    situacao, severidade, min_atraso,
                    ds_material, qt_dose, ds_unidade_medida, ds_intervalo,
                    alta_vigilancia, pendente_farmacia,
                    TO_CHAR(dt_prevista, 'HH24:MI') AS hora_prevista
                FROM vw_painel41_doses
                {where}
                ORDER BY severidade DESC, cd_leito, dt_prevista
            """.format(where=_where(tab_conds)), d_params)
            rows = [dict(r) for r in cursor.fetchall()]

        # Agrupa por leito preservando ordem (paciente mais grave primeiro)
        grupos = {}
        ordem  = []
        for r in rows:
            key = r['cd_leito'] or str(r['nr_atendimento'])
            if key not in grupos:
                grupos[key] = {
                    'cd_leito':       r['cd_leito'],
                    'nr_atendimento': r['nr_atendimento'],
                    'nm_paciente':    r['nm_paciente'],
                    'nm_setor':       r['nm_setor'],
                    'severidade_max': 0,
                    'doses':          []
                }
                ordem.append(key)
            sev = int(r.get('severidade') or 0)
            if sev > grupos[key]['severidade_max']:
                grupos[key]['severidade_max'] = sev
            grupos[key]['doses'].append(r)

        return jsonify({
            'success':         True,
            'total_pacientes': len(grupos),
            'total_doses':     len(rows),
            'data':            [grupos[k] for k in ordem]
        })
    except Exception as e:
        current_app.logger.error('Erro tabela p51: %s', e, exc_info=True)
        return jsonify({'success': False, 'error': 'Erro ao buscar tabela'}), 500


# =============================================================================
# GET /api/paineis/painel51/dados
# Lista completa para auditoria e exportação (máx. 1 000 linhas)
# =============================================================================

@painel51_bp.route('/api/paineis/painel51/dados')
@login_required
@panel_permission_required('painel51')
def api_p51_dados():
    d_conds, d_params, _, _ = _build_common_filters()
    try:
        with get_db_cursor() as cursor:
            cursor.execute("""
                SELECT
                    cd_setor, nm_setor, setor_apelido, cd_leito, nr_atendimento, nm_paciente,
                    TO_CHAR(dt_prevista, 'YYYY-MM-DD"T"HH24:MI:SS') AS dt_prevista,
                    ds_horario, ds_material, ds_subgrupo, qt_dose, ds_unidade_medida,
                    ds_intervalo, situacao, severidade, min_atraso,
                    alta_vigilancia, classe_vigilancia, pendente_farmacia,
                    TO_CHAR(dt_checagem, 'YYYY-MM-DD"T"HH24:MI:SS') AS dt_checagem,
                    nm_profissional_checagem, ds_evento_beira_leito
                FROM vw_painel41_doses
                {where}
                ORDER BY cd_setor, cd_leito, dt_prevista
                LIMIT 1000
            """.format(where=_where(d_conds)), d_params)
            dados = [dict(r) for r in cursor.fetchall()]
        return jsonify({'success': True, 'total': len(dados), 'data': dados})
    except Exception as e:
        current_app.logger.error('Erro dados p51: %s', e, exc_info=True)
        return jsonify({'success': False, 'error': 'Erro ao buscar dados'}), 500
