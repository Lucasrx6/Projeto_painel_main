"""
Painel 40 - Requisicoes Urgentes de Materiais/Medicamentos
Endpoints para exibicao em TV na Central de Abastecimento.
Mostra requisicoes urgentes liberadas e nao baixadas (IE_URGENTE='S').
"""
from flask import Blueprint, jsonify, send_from_directory, session, current_app
from psycopg2.extras import RealDictCursor
from backend.database import get_db_connection, release_connection
from backend.middleware.decorators import login_required
from backend.user_management import verificar_permissao_painel
from datetime import datetime
from collections import OrderedDict

painel40_bp = Blueprint('painel40', __name__)


def _check_acesso():
    """Retorna True se o usuario logado tem acesso ao painel40."""
    usuario_id = session.get('usuario_id')
    is_admin = session.get('is_admin', False)
    return is_admin or verificar_permissao_painel(usuario_id, 'painel40')


# =========================================================
# ROTA HTML
# =========================================================

@painel40_bp.route('/painel/painel40')
@login_required
def painel40():
    if not _check_acesso():
        current_app.logger.warning('Acesso negado ao painel40: %s', session.get('usuario'))
        return send_from_directory('frontend', 'acesso-negado.html')
    return send_from_directory('paineis/painel40', 'index.html')


@painel40_bp.route('/paineis/painel40/<path:filename>')
@login_required
def painel40_static(filename):
    if not _check_acesso():
        return jsonify({'error': 'Sem permissao'}), 403
    return send_from_directory('paineis/painel40', filename)


# =========================================================
# API - KPIs (DASHBOARD)
# =========================================================

@painel40_bp.route('/api/paineis/painel40/dashboard', methods=['GET'])
@login_required
def api_p40_dashboard():
    if not _check_acesso():
        return jsonify({'success': False, 'error': 'Sem permissao'}), 403

    conn = get_db_connection()
    if not conn:
        return jsonify({'success': False, 'error': 'Erro de conexao'}), 500

    try:
        cursor = conn.cursor(cursor_factory=RealDictCursor)

        # Total de requisicoes distintas
        cursor.execute("""
            SELECT
                COUNT(DISTINCT nr_requisicao) AS total_requisicoes,
                COUNT(*) AS total_itens,
                COUNT(*) FILTER (WHERE dt_atendimento IS NULL) AS itens_pendentes,
                COUNT(*) FILTER (WHERE dt_atendimento IS NOT NULL) AS itens_atendidos,
                MAX(dt_carga) AS ultima_carga
            FROM painel40_requisicoes_urgentes
        """)
        kpis = dict(cursor.fetchone() or {})

        # Maior tempo de espera em minutos (apenas requisicoes com algum item pendente)
        cursor.execute("""
            SELECT
                EXTRACT(EPOCH FROM (NOW() - MIN(dt_liberacao))) / 60.0 AS max_espera_min
            FROM painel40_requisicoes_urgentes
            WHERE nr_requisicao IN (
                SELECT DISTINCT nr_requisicao
                FROM painel40_requisicoes_urgentes
                WHERE dt_atendimento IS NULL
            )
            GROUP BY nr_requisicao
            ORDER BY max_espera_min DESC
            LIMIT 1
        """)
        row_espera = cursor.fetchone()
        tempo_max = 0
        if row_espera and row_espera.get('max_espera_min') is not None:
            tempo_max = int(row_espera['max_espera_min'])

        cursor.close()

        # Serializar datas
        ultima_carga = kpis.get('ultima_carga')
        if ultima_carga and isinstance(ultima_carga, datetime):
            ultima_carga = ultima_carga.isoformat()

        return jsonify({
            'success': True,
            'total_requisicoes': kpis.get('total_requisicoes', 0),
            'total_itens': kpis.get('total_itens', 0),
            'itens_pendentes': kpis.get('itens_pendentes', 0),
            'itens_atendidos': kpis.get('itens_atendidos', 0),
            'tempo_max_espera_min': tempo_max,
            'ultima_carga': ultima_carga
        })

    except Exception as e:
        current_app.logger.error('Erro dashboard painel40: %s', e, exc_info=True)
        return jsonify({'success': False, 'error': 'Erro ao buscar dados'}), 500
    finally:
        if conn:
            release_connection(conn)


# =========================================================
# API - DADOS AGRUPADOS POR REQUISICAO
# =========================================================

@painel40_bp.route('/api/paineis/painel40/dados', methods=['GET'])
@login_required
def api_p40_dados():
    if not _check_acesso():
        return jsonify({'success': False, 'error': 'Sem permissao'}), 403

    conn = get_db_connection()
    if not conn:
        return jsonify({'success': False, 'error': 'Erro de conexao'}), 500

    try:
        cursor = conn.cursor(cursor_factory=RealDictCursor)

        cursor.execute("""
            SELECT *
            FROM painel40_requisicoes_urgentes
            ORDER BY nr_requisicao, cd_material
        """)

        linhas = cursor.fetchall()
        cursor.close()

        # Agrupar por nr_requisicao em Python
        agora = datetime.now()
        grupos = OrderedDict()

        for row in linhas:
            r = dict(row)
            nr = r.get('nr_requisicao')

            if nr not in grupos:
                # Calcular minutos aguardando
                dt_lib = r.get('dt_liberacao')
                minutos_aguardando = 0
                if dt_lib and isinstance(dt_lib, datetime):
                    diff = agora - dt_lib
                    minutos_aguardando = int(diff.total_seconds() / 60)

                # Serializar datas do cabecalho
                dt_sol = r.get('dt_solicitacao_requisicao')
                if dt_sol and isinstance(dt_sol, datetime):
                    dt_sol = dt_sol.isoformat()
                dt_lib_str = dt_lib.isoformat() if dt_lib and isinstance(dt_lib, datetime) else dt_lib

                grupos[nr] = {
                    'nr_requisicao': nr,
                    'cd_local_estoque': r.get('cd_local_estoque'),
                    'ds_local_estoque': r.get('ds_local_estoque'),
                    'cd_local_estoque_destino': r.get('cd_local_estoque_destino'),
                    'ds_local_estoque_destino': r.get('ds_local_estoque_destino'),
                    'nm_requisitante': r.get('nm_requisitante'),
                    'ds_operacao_estoque': r.get('ds_operacao_estoque'),
                    'dt_solicitacao_requisicao': dt_sol,
                    'dt_liberacao': dt_lib_str,
                    'total_itens': 0,
                    'itens_pendentes': 0,
                    'itens_atendidos': 0,
                    'minutos_aguardando': minutos_aguardando,
                    'itens': []
                }

            # Determinar status do item
            dt_atend = r.get('dt_atendimento')
            status = 'atendido' if dt_atend is not None else 'pendente'

            # Serializar datas do item
            if dt_atend and isinstance(dt_atend, datetime):
                dt_atend = dt_atend.isoformat()

            dt_carga = r.get('dt_carga')
            if dt_carga and isinstance(dt_carga, datetime):
                dt_carga = dt_carga.isoformat()

            item = {
                'cd_material': r.get('cd_material'),
                'ds_material': r.get('ds_material'),
                'qt_material_requisitada': r.get('qt_material_requisitada'),
                'cd_unidade_medida': r.get('cd_unidade_medida'),
                'dt_atendimento': dt_atend,
                'nm_pessoa_atende': r.get('nm_pessoa_atende'),
                'nr_seq_lote_fornec': r.get('nr_seq_lote_fornec'),
                'cd_barras': r.get('cd_barras'),
                'ds_motivo_baixa': r.get('ds_motivo_baixa'),
                'status': status
            }

            grupos[nr]['itens'].append(item)
            grupos[nr]['total_itens'] += 1
            if status == 'pendente':
                grupos[nr]['itens_pendentes'] += 1
            else:
                grupos[nr]['itens_atendidos'] += 1

        # Ordenar: mais itens pendentes primeiro; empate por dt_liberacao ASC (mais antiga primeiro)
        requisicoes = list(grupos.values())
        requisicoes.sort(key=lambda x: (-x['itens_pendentes'], x.get('dt_liberacao') or ''))

        return jsonify({
            'success': True,
            'requisicoes': requisicoes
        })

    except Exception as e:
        current_app.logger.error('Erro dados painel40: %s', e, exc_info=True)
        return jsonify({'success': False, 'error': 'Erro ao buscar dados'}), 500
    finally:
        if conn:
            release_connection(conn)
