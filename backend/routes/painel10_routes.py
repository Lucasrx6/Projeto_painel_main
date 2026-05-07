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
        # Isolado em try-except para não derrubar o endpoint se a tabela/coluna diferir
        tempo_ultimo_rows = {}
        try:
            cursor.execute("""
                SELECT DISTINCT ON (ds_clinica)
                    ds_clinica,
                    ROUND(
                        EXTRACT(EPOCH FROM (
                            dt_inicio_atendimento_med - COALESCE(retirada_senha, dt_entrada)
                        )) / 60
                    )::int AS tempo_ultimo_atendido_min
                FROM painel_ps_analise
                WHERE dt_inicio_atendimento_med IS NOT NULL
                  AND dt_entrada >= NOW() - INTERVAL '24 hours'
                ORDER BY ds_clinica, dt_inicio_atendimento_med DESC
            """)
            tempo_ultimo_rows = {r['ds_clinica']: r['tempo_ultimo_atendido_min'] for r in cursor.fetchall()}
        except Exception as e_max:
            logger.warning('Tempo Maximo indisponivel (painel_ps_analise): %s', str(e_max))
            conn.rollback()

        # Mapa nome_clinica -> cd_clinica a partir de painel17_atendimentos_ps (para mediana)
        clinica_cd_map = {}
        try:
            cursor.execute("""
                SELECT DISTINCT cd_clinica, LOWER(TRIM(clinica)) AS clinica_key
                FROM painel17_atendimentos_ps
                WHERE dt_entrada >= NOW() - INTERVAL '1 day'
            """)
            clinica_cd_map = {r['clinica_key']: r['cd_clinica'] for r in cursor.fetchall()}
        except Exception as e_med:
            logger.warning('Mediana indisponivel (painel17_atendimentos_ps): %s', str(e_med))
            conn.rollback()

        def _calcular_mediana(cd_clinica):
            try:
                cursor.execute("""
                    SELECT dt_entrada, retirada_senha, dt_inicio_atendimento_med
                    FROM painel17_atendimentos_ps
                    WHERE cd_clinica = %s
                      AND dt_inicio_atendimento_med IS NOT NULL
                    ORDER BY dt_inicio_atendimento_med DESC
                    LIMIT %s
                """, (cd_clinica, _JANELA_MEDIANA))
                tempos = []
                for r in cursor.fetchall():
                    inicio = r.get('retirada_senha') or r.get('dt_entrada')
                    t = _tempo_minutos(inicio, r.get('dt_inicio_atendimento_med'))
                    if t is not None:
                        tempos.append(t)
                return round(statistics.median(tempos)) if tempos else None
            except Exception:
                return None

        todas_clinicas = sorted(set(list(tempo_rows.keys()) + list(aguardando_rows.keys())))
        resultado = []

        for ds_clinica in todas_clinicas:
            tp = tempo_rows.get(ds_clinica, {})
            ag = aguardando_rows.get(ds_clinica, {})

            cd = clinica_cd_map.get((ds_clinica or '').lower().strip())
            mediana = _calcular_mediana(cd) if cd is not None else None

            aguardando = ag.get('total_aguardando') if ag.get('total_aguardando') is not None else tp.get('aguardando_atendimento', 0)
            tempo_max = tempo_ultimo_rows.get(ds_clinica)

            resultado.append({
                'ds_clinica': ds_clinica,
                'aguardando_atendimento': aguardando,
                'total_atendimentos': tp.get('total_atendimentos', 0),
                'atendimentos_realizados': tp.get('atendimentos_realizados', 0),
                'tempo_medio_espera_min': tp.get('tempo_medio_espera_min', 0),
                'mediana_espera_min': mediana,
                'tempo_max_espera_min': tempo_max,
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
        rows = []

        # Tentativa 1: query completa com retirada_senha
        try:
            cursor.execute("""
                SELECT
                    nm_pessoa_fisica,
                    nr_atendimento,
                    dt_entrada,
                    COALESCE(retirada_senha, dt_entrada) AS inicio_espera,
                    ROUND(
                        EXTRACT(EPOCH FROM (NOW() - COALESCE(retirada_senha, dt_entrada))) / 60
                    )::int AS tempo_espera_min
                FROM painel_ps_analise
                WHERE ds_clinica = %s
                  AND dt_inicio_atendimento_med IS NULL
                  AND dt_alta IS NULL
                  AND dt_entrada >= NOW() - INTERVAL '24 hours'
                ORDER BY COALESCE(retirada_senha, dt_entrada) ASC
            """, (ds_clinica,))
            rows = cursor.fetchall()
        except Exception as e1:
            logger.warning('pacientes-clinica tentativa 1 falhou: %s', str(e1))
            conn.rollback()

            # Tentativa 2: sem retirada_senha (usa só dt_entrada)
            try:
                cursor.execute("""
                    SELECT
                        nm_pessoa_fisica,
                        nr_atendimento,
                        dt_entrada,
                        dt_entrada AS inicio_espera,
                        ROUND(
                            EXTRACT(EPOCH FROM (NOW() - dt_entrada)) / 60
                        )::int AS tempo_espera_min
                    FROM painel_ps_analise
                    WHERE ds_clinica = %s
                      AND dt_inicio_atendimento_med IS NULL
                      AND dt_alta IS NULL
                      AND dt_entrada >= NOW() - INTERVAL '24 hours'
                    ORDER BY dt_entrada ASC
                """, (ds_clinica,))
                rows = cursor.fetchall()
            except Exception as e2:
                logger.warning('pacientes-clinica tentativa 2 falhou: %s', str(e2))
                conn.rollback()

                # Tentativa 3: query mínima para descobrir colunas disponíveis
                try:
                    cursor.execute("""
                        SELECT *
                        FROM painel_ps_analise
                        WHERE ds_clinica = %s
                          AND dt_entrada >= NOW() - INTERVAL '24 hours'
                        LIMIT 0
                    """, (ds_clinica,))
                    cols = [d.name for d in cursor.description] if cursor.description else []
                    logger.warning('pacientes-clinica: colunas disponíveis em painel_ps_analise: %s', cols)
                except Exception as e3:
                    logger.error('pacientes-clinica: painel_ps_analise inacessível: %s', str(e3))
                    conn.rollback()

        resultado = []
        for r in rows:
            inicio = r.get('inicio_espera')
            entrada = r.get('dt_entrada')
            resultado.append({
                'nm_paciente': (r.get('nm_pessoa_fisica') or '').strip() or '-',
                'nr_atendimento': str(r.get('nr_atendimento') or ''),
                'dt_entrada': entrada.strftime('%d/%m %H:%M') if entrada else '-',
                'inicio_espera': inicio.strftime('%H:%M') if inicio else '-',
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