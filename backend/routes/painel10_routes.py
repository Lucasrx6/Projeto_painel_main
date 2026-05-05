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
from datetime import datetime

from flask import Blueprint, jsonify, send_from_directory, session, current_app
from psycopg2.extras import RealDictCursor

from backend.database import get_db_connection, release_connection
from backend.middleware.decorators import login_required
from backend.user_management import verificar_permissao_painel
from backend.cache import cache_route

logger = logging.getLogger(__name__)

painel10_bp = Blueprint('painel10', __name__)


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