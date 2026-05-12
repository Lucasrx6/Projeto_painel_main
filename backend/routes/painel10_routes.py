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
import unicodedata
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


def _norm(texto):
    """Remove acentos e normaliza para comparação de nomes de clínicas."""
    if not texto:
        return ''
    nfkd = unicodedata.normalize('NFKD', str(texto).upper().strip())
    return ''.join(c for c in nfkd if not unicodedata.combining(c))


# Mapeamento de variações conhecidas de especialidade → fragmento canônico de ds_clinica
# Edite aqui sempre que uma nova variação aparecer no sistema.
_ALIAS_ESPECIALIDADE = {
    'CLINICA GERAL':             'CLINICA MEDICA',
    'CIRURGIA GERAL':            'CIRURGICA GERAL',   # especialidade no medicos_ps → nome da clínica
    'CIRURGIAL GERAL':           'CIRURGICA GERAL',   # typo frequente
    'CIRURGICA GERAL':           'CIRURGICA GERAL',
    'GINECOLOGIA E OBSTETRICIA': 'GINECOLOGIA',
    'OBSTETRICIA':               'GINECOLOGIA',
    'ORTOPEDIA E TRAUMATOLOGIA': 'ORTOPEDIA',
    'ORTOPEDIA':                 'ORTOPEDIA',
    'PEDIATRIA':                 'PEDIATRIA',
    'CLINICA MEDICA':            'CLINICA MEDICA',
    'EMERGENCISTA':              'EMERGENCISTA',
}


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

        # Tempo do paciente que está aguardando há mais tempo por clínica
        # MIN(dt_entrada) entre os aguardando → diferença até NOW() = maior espera atual
        tempo_ultimo_rows = {}
        try:
            cursor.execute("""
                SELECT
                    ds_clinica,
                    ROUND(
                        EXTRACT(EPOCH FROM (NOW() - MIN(dt_entrada::timestamptz))) / 60
                    )::int AS tempo_max_aguardando_min
                FROM painel_ps_analise
                WHERE (dt_atend_medico IS NULL OR dt_atend_medico = '')
                  AND (dt_alta IS NULL OR dt_alta = '')
                  AND dt_entrada::timestamptz >= NOW() - INTERVAL '24 hours'
                  AND EXTRACT(EPOCH FROM (NOW() - dt_entrada::timestamptz)) / 60 <= %s
                GROUP BY ds_clinica
            """, (_MAX_ESPERA_MIN,))
            tempo_ultimo_rows = {r['ds_clinica']: r['tempo_max_aguardando_min'] for r in cursor.fetchall()}
        except Exception as e_max:
            logger.warning('Maior espera indisponivel (painel_ps_analise): %s', str(e_max))
            conn.rollback()

        # Mediana de espera por clínica — mesma lógica do painel17:
        # painel17_atendimentos_ps com COALESCE(retirada_senha, dt_entrada) como início
        mediana_rows = {}
        try:
            cursor.execute("""
                SELECT
                    clinica,
                    ROUND(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY
                        EXTRACT(EPOCH FROM (
                            dt_inicio_atendimento_med - COALESCE(retirada_senha, dt_entrada)
                        )) / 60
                    ))::int AS mediana_espera_min
                FROM painel17_atendimentos_ps
                WHERE dt_inicio_atendimento_med IS NOT NULL
                  AND dt_entrada >= NOW() - INTERVAL '24 hours'
                  AND clinica IS NOT NULL
                  AND EXTRACT(EPOCH FROM (
                      dt_inicio_atendimento_med - COALESCE(retirada_senha, dt_entrada)
                  )) / 60 BETWEEN 1 AND 300
                GROUP BY clinica
            """)
            mediana_rows = {_norm(r['clinica']): r['mediana_espera_min'] for r in cursor.fetchall()}
        except Exception as e_med:
            logger.warning('Mediana indisponivel (painel17_atendimentos_ps): %s', str(e_med))
            conn.rollback()

        # Médicos ativos por clínica: usa consultório (sala) de medicos_ps.
        # Consultórios são fixos por clínica → mapeamento confiável independente do
        # cadastro de especialidade do médico.
        # Salas: 9,10=Pediatria | 7,8=Ortopedia | 3=Cirúrgica Geral | 6=Gineco | 0,1,2,4,5=Clínica Médica
        canonical_medicos = {}
        try:
            cursor.execute("""
                SELECT clinica_canonical, COUNT(*) AS medicos_ativos
                FROM (
                    SELECT CASE
                        WHEN REGEXP_REPLACE(consultorio, '[^0-9]', '', 'g') IN ('09', '10') THEN 'PEDIATRIA'
                        WHEN REGEXP_REPLACE(consultorio, '[^0-9]', '', 'g') IN ('07', '08') THEN 'ORTOPEDIA'
                        WHEN REGEXP_REPLACE(consultorio, '[^0-9]', '', 'g') IN ('03')       THEN 'CIRURGICA GERAL'
                        WHEN REGEXP_REPLACE(consultorio, '[^0-9]', '', 'g') IN ('06')       THEN 'GINECOLOGIA'
                        WHEN REGEXP_REPLACE(consultorio, '[^0-9]', '', 'g') IN ('00', '01', '02', '04', '05') THEN 'CLINICA MEDICA'
                    END AS clinica_canonical
                    FROM medicos_ps
                    WHERE consultorio IS NOT NULL
                ) sub
                WHERE clinica_canonical IS NOT NULL
                GROUP BY clinica_canonical
            """)
            canonical_medicos = {r['clinica_canonical']: r['medicos_ativos'] for r in cursor.fetchall()}
        except Exception as e_med_at:
            logger.warning('Medicos ativos indisponivel (medicos_ps): %s', str(e_med_at))
            conn.rollback()

        def _match_clinica(ds_clinica, mapa):
            """Match genérico com normalização + alias + parcial."""
            ds_norm = _norm(ds_clinica)
            if ds_norm in mapa:
                return mapa[ds_norm]
            # Aplica alias: se a chave do mapa tem alias que bate com ds_norm
            for key_norm, val in mapa.items():
                alias_norm = _ALIAS_ESPECIALIDADE.get(key_norm)
                if alias_norm and (alias_norm == ds_norm or alias_norm in ds_norm or ds_norm in alias_norm):
                    return val
            # Fallback parcial
            for key_norm, val in mapa.items():
                if ds_norm in key_norm or key_norm in ds_norm:
                    return val
            return None

        def _match_medicos(ds_clinica):
            return _match_clinica(ds_clinica, canonical_medicos) or 0

        todas_clinicas = sorted(set(list(tempo_rows.keys()) + list(aguardando_rows.keys())))
        resultado = []

        for ds_clinica in todas_clinicas:
            tp = tempo_rows.get(ds_clinica, {})
            ag = aguardando_rows.get(ds_clinica, {})

            aguardando = ag.get('total_aguardando') if ag.get('total_aguardando') is not None else tp.get('aguardando_atendimento', 0)
            tempo_max = tempo_ultimo_rows.get(ds_clinica)
            mediana = _match_clinica(ds_clinica, mediana_rows)
            medicos_ativos = _match_medicos(ds_clinica)

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
              AND EXTRACT(EPOCH FROM (NOW() - dt_entrada::timestamptz)) / 60 <= %s
            ORDER BY dt_entrada::timestamptz ASC
        """, (ds_clinica, _MAX_ESPERA_MIN))

        rows = cursor.fetchall()
        resultado = []
        for r in rows:
            tempo_min = r.get('tempo_espera_min') or 0
            if tempo_min > _MAX_ESPERA_MIN:
                continue
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
                'tempo_espera_min': tempo_min,
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

        # ── Diagnóstico medicos_ps ────────────────────────────────────────
        # Colunas da tabela
        try:
            cursor.execute("""
                SELECT column_name, data_type
                FROM information_schema.columns
                WHERE table_name = 'medicos_ps'
                ORDER BY ordinal_position
            """)
            resultado['colunas_medicos_ps'] = [dict(r) for r in cursor.fetchall()]
        except Exception as e:
            resultado['colunas_medicos_ps'] = str(e)
            conn.rollback()

        # Sample de 5 linhas completas (todos os campos)
        try:
            cursor.execute("SELECT * FROM medicos_ps LIMIT 5")
            resultado['sample_medicos_ps'] = [
                {k: (str(v) if v is not None else None) for k, v in dict(r).items()}
                for r in cursor.fetchall()
            ]
        except Exception as e:
            resultado['sample_medicos_ps'] = str(e)
            conn.rollback()

        # Valores distintos e contagem por consultorio (vê exatamente o que está no banco)
        try:
            cursor.execute("""
                SELECT
                    consultorio,
                    LENGTH(CAST(consultorio AS TEXT)) AS len,
                    COUNT(*) AS total
                FROM medicos_ps
                GROUP BY consultorio
                ORDER BY consultorio
            """)
            resultado['consultorio_distinct'] = [
                {k: (str(v) if v is not None else None) for k, v in dict(r).items()}
                for r in cursor.fetchall()
            ]
        except Exception as e:
            resultado['consultorio_distinct'] = str(e)
            conn.rollback()

        # Resultado da query atual de médicos ativos (o que o painel está recebendo)
        try:
            cursor.execute("""
                SELECT clinica_canonical, COUNT(*) AS medicos_ativos
                FROM (
                    SELECT CASE
                        WHEN REGEXP_REPLACE(consultorio, '[^0-9]', '', 'g') IN ('09', '10') THEN 'PEDIATRIA'
                        WHEN REGEXP_REPLACE(consultorio, '[^0-9]', '', 'g') IN ('07', '08') THEN 'ORTOPEDIA'
                        WHEN REGEXP_REPLACE(consultorio, '[^0-9]', '', 'g') IN ('03')       THEN 'CIRURGICA GERAL'
                        WHEN REGEXP_REPLACE(consultorio, '[^0-9]', '', 'g') IN ('06')       THEN 'GINECOLOGIA'
                        WHEN REGEXP_REPLACE(consultorio, '[^0-9]', '', 'g') IN ('00', '01', '02', '04', '05') THEN 'CLINICA MEDICA'
                        ELSE '(sem match: ' || consultorio || ')'
                    END AS clinica_canonical
                    FROM medicos_ps
                    WHERE consultorio IS NOT NULL
                ) sub
                GROUP BY clinica_canonical
                ORDER BY clinica_canonical
            """)
            resultado['medicos_por_clinica_atual'] = [dict(r) for r in cursor.fetchall()]
        except Exception as e:
            resultado['medicos_por_clinica_atual'] = str(e)
            conn.rollback()

        cursor.close()
        return jsonify({'success': True, 'diagnostico': resultado})

    except Exception as e:
        return jsonify({'success': False, 'error': 'Erro interno do servidor'}), 500
    finally:
        if conn:
            release_connection(conn)