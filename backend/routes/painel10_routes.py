# =============================================================================
# PAINEL 10 - ANALISE DO PRONTO SOCORRO
# Hospital Anchieta Ceilandia
#
# Dashboard analitico com metricas de desempenho do PS:
#   - Resumo geral do dia (total, realizados, aguardando, alta, tempos)
#   - Tempo medio de espera por clinica
#   - Pacientes aguardando por clinica
#   - Atendimentos por hora (grafico)
#   - Desempenho por medico
#   - Desempenho da recepcao
#
# Dados: Views PostgreSQL (vw_ps_*)
# =============================================================================

import logging
import statistics
from datetime import datetime

from flask import Blueprint, jsonify, request, send_from_directory, session, current_app
from psycopg2.extras import RealDictCursor

from backend.database import get_db_connection, release_connection
from backend.middleware.decorators import login_required
from backend.user_management import verificar_permissao_painel
from backend.cache import cache_route

logger = logging.getLogger(__name__)

painel10_bp = Blueprint('painel10', __name__)

_JANELA_MEDIANA = 10
_MAX_ESPERA_MIN = 300


def _tempo_minutos(inicio, fim):
    """Calcula diferença em minutos entre dois datetimes. Retorna None se inválido."""
    if not inicio or not fim:
        return None
    diff = (fim - inicio).total_seconds() / 60.0
    return round(diff, 1) if 0 < diff < _MAX_ESPERA_MIN else None


# =============================================================================
# HELPERS
# =============================================================================

def _verificar_acesso():
    """Verifica permissao de acesso ao painel. Retorna True se autorizado."""
    is_admin = session.get('is_admin', False)
    if is_admin:
        return True
    usuario_id = session.get('usuario_id')
    return verificar_permissao_painel(usuario_id, 'painel10')


_VIEWS_PERMITIDAS = frozenset({
    'vw_ps_dashboard_dia',
    'vw_ps_tempo_por_clinica',
    'vw_ps_aguardando_por_clinica',
    'vw_ps_atendimentos_por_hora',
    'vw_ps_desempenho_medico',
    'vw_ps_desempenho_recepcao',
})


def _consultar_view(view_name, fetchone=False):
    """
    Consulta uma view PostgreSQL e retorna os dados.
    Retorna (dados, None) em sucesso ou (None, response_erro) em falha.
    """
    if view_name not in _VIEWS_PERMITIDAS:
        logger.error('View nao permitida solicitada: %s', view_name)
        return None, (jsonify({'success': False, 'error': 'View invalida'}), 400)

    conn = get_db_connection()
    if not conn:
        return None, (jsonify({
            'success': False,
            'error': 'Erro de conexao com o banco'
        }), 500)

    try:
        cursor = conn.cursor(cursor_factory=RealDictCursor)
        cursor.execute(f"SELECT * FROM {view_name}")

        if fetchone:
            resultado = cursor.fetchone()
            dados = dict(resultado) if resultado else None
        else:
            resultados = cursor.fetchall()
            dados = [dict(row) for row in resultados]

        cursor.close()
        return dados, None

    except Exception as e:
        logger.error('Erro ao consultar %s: %s', view_name, str(e), exc_info=True)
        return None, (jsonify({
            'success': False,
            'error': 'Erro ao buscar dados'
        }), 500)
    finally:
        if conn:
            release_connection(conn)


# =============================================================================
# ROTA DE PAGINA HTML
# =============================================================================

@painel10_bp.route('/painel/painel10')
@login_required
def painel10():
    """Pagina principal do Painel 10"""
    if not _verificar_acesso():
        logger.warning('Acesso negado ao painel10: %s', session.get('usuario'))
        return send_from_directory('frontend', 'acesso-negado.html')

    return send_from_directory('paineis/painel10', 'index.html')


# =============================================================================
# ENDPOINT: DASHBOARD GERAL DO DIA
# =============================================================================

@painel10_bp.route('/api/paineis/painel10/dashboard', methods=['GET'])
@login_required
@cache_route(ttl=120, key_prefix='painel10:dashboard')
def api_painel10_dashboard():
    """
    Resumo geral do dia.
    Retorna: total_atendimentos, realizados, aguardando, alta, tempos medios.
    """
    if not _verificar_acesso():
        return jsonify({'success': False, 'error': 'Sem permissao'}), 403

    dados, erro = _consultar_view('vw_ps_dashboard_dia', fetchone=True)
    if erro:
        return erro

    if not dados:
        dados = {
            'total_atendimentos_dia': 0,
            'atendimentos_realizados': 0,
            'aguardando_atendimento': 0,
            'pacientes_alta': 0,
            'tempo_medio_permanencia_min': 0,
            'tempo_medio_espera_consulta_min': 0
        }

    return jsonify({
        'success': True,
        'data': dados,
        'timestamp': datetime.now().isoformat()
    })


# =============================================================================
# ENDPOINT: TEMPO MEDIO POR CLINICA
# =============================================================================

@painel10_bp.route('/api/paineis/painel10/tempo-clinica', methods=['GET'])
@login_required
@cache_route(ttl=120, key_prefix='painel10:tempo-clinica', vary_by_query=True)
def api_painel10_tempo_clinica():
    """
    Tempo medio de espera por clinica.
    Retorna lista com: ds_clinica, total, realizados, aguardando, tempo_medio.
    """
    if not _verificar_acesso():
        return jsonify({'success': False, 'error': 'Sem permissao'}), 403

    dados, erro = _consultar_view('vw_ps_tempo_por_clinica')
    if erro:
        return erro

    return jsonify({
        'success': True,
        'data': dados or [],
        'total': len(dados or []),
        'timestamp': datetime.now().isoformat()
    })


# =============================================================================
# ENDPOINT: PACIENTES AGUARDANDO POR CLINICA
# =============================================================================

@painel10_bp.route('/api/paineis/painel10/aguardando-clinica', methods=['GET'])
@login_required
@cache_route(ttl=90, key_prefix='painel10:aguardando-clinica', vary_by_query=True)
def api_painel10_aguardando_clinica():
    """
    Pacientes aguardando atendimento por clinica.
    Retorna lista com: ds_clinica, total_aguardando, tempo_espera, tempo_max.
    """
    if not _verificar_acesso():
        return jsonify({'success': False, 'error': 'Sem permissao'}), 403

    dados, erro = _consultar_view('vw_ps_aguardando_por_clinica')
    if erro:
        return erro

    return jsonify({
        'success': True,
        'data': dados or [],
        'total': len(dados or []),
        'timestamp': datetime.now().isoformat()
    })


# =============================================================================
# ENDPOINT: ATENDIMENTOS POR HORA
# =============================================================================

@painel10_bp.route('/api/paineis/painel10/atendimentos-hora', methods=['GET'])
@login_required
@cache_route(ttl=120, key_prefix='painel10:atendimentos-hora')
def api_painel10_atendimentos_hora():
    """
    Distribuicao de atendimentos por hora do dia.
    Retorna lista com: hora, total_atendimentos.
    """
    if not _verificar_acesso():
        return jsonify({'success': False, 'error': 'Sem permissao'}), 403

    dados, erro = _consultar_view('vw_ps_atendimentos_por_hora')
    if erro:
        return erro

    return jsonify({
        'success': True,
        'data': dados or [],
        'total': len(dados or []),
        'timestamp': datetime.now().isoformat()
    })


# =============================================================================
# ENDPOINT: DESEMPENHO POR MEDICO
# =============================================================================

@painel10_bp.route('/api/paineis/painel10/desempenho-medico', methods=['GET'])
@login_required
@cache_route(ttl=180, key_prefix='painel10:desempenho-medico', vary_by_query=True)
def api_painel10_desempenho_medico():
    """
    Desempenho dos medicos do dia.
    Retorna lista com: cd_medico, nm_guerra, total, tempo_medio, finalizados.
    """
    if not _verificar_acesso():
        return jsonify({'success': False, 'error': 'Sem permissao'}), 403

    dados, erro = _consultar_view('vw_ps_desempenho_medico')
    if erro:
        return erro

    return jsonify({
        'success': True,
        'data': dados or [],
        'total': len(dados or []),
        'timestamp': datetime.now().isoformat()
    })


# =============================================================================
# ENDPOINT: DESEMPENHO DA RECEPCAO
# =============================================================================

@painel10_bp.route('/api/paineis/painel10/desempenho-recepcao', methods=['GET'])
@login_required
@cache_route(ttl=180, key_prefix='painel10:desempenho-recepcao')
def api_painel10_desempenho_recepcao():
    """
    Metricas de desempenho da recepcao.
    Retorna: total_recebidos, tempo_medio_recepcao, aguardando_recepcao.
    """
    if not _verificar_acesso():
        return jsonify({'success': False, 'error': 'Sem permissao'}), 403

    dados, erro = _consultar_view('vw_ps_desempenho_recepcao', fetchone=True)
    if erro:
        return erro

    if not dados:
        dados = {
            'total_recebidos': 0,
            'tempo_medio_recepcao_min': 0,
            'aguardando_recepcao': 0
        }

    return jsonify({
        'success': True,
        'data': dados,
        'timestamp': datetime.now().isoformat()
    })


# =============================================================================
# ENDPOINT: CLINICAS CONSOLIDADO (aguardando + tempo + mediana)
# =============================================================================

@painel10_bp.route('/api/paineis/painel10/clinicas-consolidado', methods=['GET'])
@login_required
@cache_route(ttl=90, key_prefix='painel10:clinicas-consolidado')
def api_painel10_clinicas_consolidado():
    """
    Endpoint unificado que combina dados de aguardando, tempo por clínica e mediana.
    Retorna lista com: ds_clinica, aguardando, total, realizados, tempo_medio, mediana, tempo_max.
    """
    if not _verificar_acesso():
        return jsonify({'success': False, 'error': 'Sem permissao'}), 403

    conn = get_db_connection()
    if not conn:
        return jsonify({'success': False, 'error': 'Erro de conexao com o banco'}), 500

    try:
        cursor = conn.cursor(cursor_factory=RealDictCursor)

        # Dados de tempo por clínica (fonte primária)
        cursor.execute("SELECT * FROM vw_ps_tempo_por_clinica")
        tempo_rows = {r['ds_clinica']: dict(r) for r in cursor.fetchall()}

        # Dados de aguardando por clínica
        cursor.execute("SELECT * FROM vw_ps_aguardando_por_clinica")
        aguardando_rows = {r['ds_clinica']: dict(r) for r in cursor.fetchall()}

        # Tempo do último paciente atendido por clínica (Tempo Máximo = referência fixa)
        # painel_ps_analise: dt_entrada e dt_atend_medico são character varying → cast ::timestamptz
        tempo_ultimo_rows = {}
        try:
            cursor.execute("""
                SELECT DISTINCT ON (ds_clinica)
                    ds_clinica,
                    ROUND(
                        EXTRACT(EPOCH FROM (
                            dt_atend_medico::timestamptz - dt_entrada::timestamptz
                        )) / 60
                    )::int AS tempo_ultimo_atendido_min
                FROM painel_ps_analise
                WHERE dt_atend_medico IS NOT NULL
                  AND dt_atend_medico != ''
                  AND dt_entrada::timestamptz >= NOW() - INTERVAL '24 hours'
                ORDER BY ds_clinica, dt_atend_medico::timestamptz DESC
            """)
            tempo_ultimo_rows = {r['ds_clinica']: r['tempo_ultimo_atendido_min'] for r in cursor.fetchall()}
        except Exception as e_max:
            logger.warning('Tempo Maximo indisponivel (painel_ps_analise): %s', str(e_max))
            conn.rollback()

        # Mediana de espera por clínica via PERCENTILE_CONT em painel_ps_analise
        # Usa ds_clinica direto → sem ambiguidade de join com painel17
        mediana_rows = {}
        try:
            cursor.execute("""
                SELECT
                    ds_clinica,
                    ROUND(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY
                        EXTRACT(EPOCH FROM (
                            dt_atend_medico::timestamptz - dt_entrada::timestamptz
                        )) / 60
                    ))::int AS mediana_espera_min
                FROM painel_ps_analise
                WHERE dt_atend_medico IS NOT NULL
                  AND dt_atend_medico != ''
                  AND dt_entrada::timestamptz >= NOW() - INTERVAL '24 hours'
                GROUP BY ds_clinica
            """)
            mediana_rows = {r['ds_clinica']: r['mediana_espera_min'] for r in cursor.fetchall()}
        except Exception as e_med:
            logger.warning('Mediana indisponivel (painel_ps_analise): %s', str(e_med))
            conn.rollback()

        # Médicos ativos por clínica: médicos logados em medicos_ps, atribuídos à
        # clínica do atendimento mais recente deles hoje em painel17_atendimentos_ps
        medicos_ativos_rows = {}
        try:
            cursor.execute("""
                SELECT
                    UPPER(sub.clinica) AS clinica_upper,
                    COUNT(DISTINCT sub.nm_usuario) AS medicos_ativos
                FROM (
                    SELECT DISTINCT ON (UPPER(mp.ds_usuario))
                        mp.nm_usuario,
                        p17.clinica
                    FROM medicos_ps mp
                    JOIN painel17_atendimentos_ps p17
                        ON UPPER(mp.ds_usuario) = UPPER(p17.nm_medico)
                       AND p17.dt_inicio_atendimento_med IS NOT NULL
                       AND p17.dt_entrada >= NOW() - INTERVAL '24 hours'
                    WHERE p17.clinica IS NOT NULL
                    ORDER BY UPPER(mp.ds_usuario), p17.dt_inicio_atendimento_med DESC NULLS LAST
                ) sub
                GROUP BY UPPER(sub.clinica)
            """)
            medicos_ativos_rows = {r['clinica_upper']: r['medicos_ativos'] for r in cursor.fetchall()}
        except Exception as e_med_at:
            logger.warning('Medicos ativos indisponivel (medicos_ps/painel17): %s', str(e_med_at))
            conn.rollback()

        todas_clinicas = sorted(set(list(tempo_rows.keys()) + list(aguardando_rows.keys())))
        resultado = []

        for ds_clinica in todas_clinicas:
            tp = tempo_rows.get(ds_clinica, {})
            ag = aguardando_rows.get(ds_clinica, {})

            aguardando = ag.get('total_aguardando') if ag.get('total_aguardando') is not None else tp.get('aguardando_atendimento', 0)
            tempo_max = tempo_ultimo_rows.get(ds_clinica)
            mediana = mediana_rows.get(ds_clinica)
            medicos_ativos = medicos_ativos_rows.get((ds_clinica or '').upper(), 0)

            resultado.append({
                'ds_clinica': ds_clinica,
                'aguardando_atendimento': aguardando,
                'total_atendimentos': tp.get('total_atendimentos', 0),
                'atendimentos_realizados': tp.get('atendimentos_realizados', 0),
                'mediana_espera_min': mediana,
                'tempo_max_espera_min': tempo_max,
                'medicos_ativos': medicos_ativos,
            })

        cursor.close()
        return jsonify({
            'success': True,
            'data': resultado,
            'total': len(resultado),
            'timestamp': datetime.now().isoformat()
        })

    except Exception as e:
        logger.error('Erro ao buscar clinicas-consolidado: %s', str(e), exc_info=True)
        return jsonify({'success': False, 'error': 'Erro ao buscar dados'}), 500
    finally:
        if conn:
            release_connection(conn)


# =============================================================================
# ENDPOINT: PACIENTES AGUARDANDO POR CLINICA (sub-painel)
# =============================================================================

@painel10_bp.route('/api/paineis/painel10/pacientes-clinica', methods=['GET'])
@login_required
def api_painel10_pacientes_clinica():
    """
    Retorna lista individual de pacientes aguardando em uma clínica.
    Query param: ?clinica=<nome_da_clinica>
    """
    if not _verificar_acesso():
        return jsonify({'success': False, 'error': 'Sem permissao'}), 403

    ds_clinica = request.args.get('clinica', '').strip()
    if not ds_clinica:
        return jsonify({'success': False, 'error': 'Parametro clinica obrigatorio'}), 400

    conn = get_db_connection()
    if not conn:
        return jsonify({'success': False, 'error': 'Erro de conexao com o banco'}), 500

    try:
        cursor = conn.cursor(cursor_factory=RealDictCursor)

        # painel_ps_analise: dt_entrada, dt_atend_medico, dt_alta são character varying
        # Pacientes aguardando = sem dt_atend_medico preenchido e sem alta
        cursor.execute("""
            SELECT
                nm_pessoa_fisica,
                nr_atendimento,
                dt_entrada,
                ROUND(
                    EXTRACT(EPOCH FROM (NOW() - dt_entrada::timestamptz)) / 60
                )::int AS tempo_espera_min
            FROM painel_ps_analise
            WHERE ds_clinica = %s
              AND (dt_atend_medico IS NULL OR dt_atend_medico = '')
              AND (dt_alta IS NULL OR dt_alta = '')
              AND dt_entrada::timestamptz >= NOW() - INTERVAL '24 hours'
            ORDER BY dt_entrada::timestamptz ASC
        """, (ds_clinica,))

        rows = cursor.fetchall()
        resultado = []
        for r in rows:
            entrada_str = r.get('dt_entrada') or ''
            # Formata dd/mm HH:MM a partir da string "2026-04-15 16:27:31-03"
            try:
                dt_fmt = entrada_str[8:10] + '/' + entrada_str[5:7] + ' ' + entrada_str[11:16]
                hora_fmt = entrada_str[11:16]
            except Exception:
                dt_fmt = entrada_str[:16] if entrada_str else '-'
                hora_fmt = '-'

            resultado.append({
                'nm_paciente': (r.get('nm_pessoa_fisica') or '').strip() or '-',
                'nr_atendimento': str(r.get('nr_atendimento') or ''),
                'dt_entrada': dt_fmt or '-',
                'inicio_espera': hora_fmt or '-',
                'tempo_espera_min': r.get('tempo_espera_min') or 0,
            })

        cursor.close()
        return jsonify({
            'success': True,
            'data': resultado,
            'total': len(resultado),
            'clinica': ds_clinica,
            'timestamp': datetime.now().isoformat()
        })

    except Exception as e:
        logger.error('Erro ao buscar pacientes da clinica %s: %s', ds_clinica, str(e), exc_info=True)
        return jsonify({
            'success': True,
            'data': [],
            'total': 0,
            'clinica': ds_clinica,
            'aviso': 'dados_indisponiveis',
            'timestamp': datetime.now().isoformat()
        })
    finally:
        if conn:
            release_connection(conn)


# =============================================================================
# ENDPOINT: DIAGNOSTICO DA TABELA painel_ps_analise (admin)
# =============================================================================

@painel10_bp.route('/api/paineis/painel10/diagnostico-ps', methods=['GET'])
@login_required
def api_painel10_diagnostico_ps():
    """Inspeciona colunas e sample de painel_ps_analise para depuracao."""
    if not session.get('is_admin', False):
        return jsonify({'success': False, 'error': 'Apenas administradores'}), 403

    conn = get_db_connection()
    if not conn:
        return jsonify({'success': False, 'error': 'Sem conexao'}), 500

    try:
        cursor = conn.cursor(cursor_factory=RealDictCursor)
        resultado = {}

        # Colunas de painel_ps_analise
        try:
            cursor.execute("""
                SELECT column_name, data_type
                FROM information_schema.columns
                WHERE table_name = 'painel_ps_analise'
                ORDER BY ordinal_position
            """)
            resultado['colunas_painel_ps_analise'] = [dict(r) for r in cursor.fetchall()]
        except Exception as e:
            resultado['colunas_painel_ps_analise'] = str(e)
            conn.rollback()

        # Colunas de painel17_atendimentos_ps
        try:
            cursor.execute("""
                SELECT column_name, data_type
                FROM information_schema.columns
                WHERE table_name = 'painel17_atendimentos_ps'
                ORDER BY ordinal_position
            """)
            resultado['colunas_painel17'] = [dict(r) for r in cursor.fetchall()]
        except Exception as e:
            resultado['colunas_painel17'] = str(e)
            conn.rollback()

        # Sample de 2 linhas de painel_ps_analise
        try:
            cursor.execute("SELECT * FROM painel_ps_analise LIMIT 2")
            sample = cursor.fetchall()
            # Converte datetimes para string para serializar
            resultado['sample_painel_ps_analise'] = [
                {k: (str(v) if v is not None else None) for k, v in dict(r).items()}
                for r in sample
            ]
        except Exception as e:
            resultado['sample_painel_ps_analise'] = str(e)
            conn.rollback()

        # Contagem geral de painel_ps_analise (ultimas 24h)
        try:
            cursor.execute("SELECT COUNT(*) AS total FROM painel_ps_analise WHERE dt_entrada >= NOW() - INTERVAL '24 hours'")
            resultado['total_24h'] = dict(cursor.fetchone())
        except Exception as e:
            resultado['total_24h'] = str(e)
            conn.rollback()

        cursor.close()
        return jsonify({'success': True, 'diagnostico': resultado})

    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500
    finally:
        if conn:
            release_connection(conn)