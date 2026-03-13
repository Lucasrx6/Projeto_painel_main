"""
Painel 22 - Jornada do Paciente PS
Exames de Radiologia e Laboratório

Endpoints:
  GET /painel/painel22                    -> Página principal
  GET /api/paineis/painel22/dashboard     -> Cards resumo
  GET /api/paineis/painel22/dados         -> Dados agrupados por paciente
"""

from flask import Blueprint, jsonify, request, session, current_app, send_from_directory
from psycopg2.extras import RealDictCursor
from backend.database import get_db_connection
from backend.middleware.decorators import login_required
from backend.user_management import verificar_permissao_painel
from datetime import datetime, timedelta
import logging

logger = logging.getLogger(__name__)

painel22_bp = Blueprint('painel22', __name__)


def serializar_valor(val):
    """Converte valores para JSON-serializável."""
    if val is None:
        return None
    if hasattr(val, 'isoformat'):
        return val.isoformat()
    return val


def serializar_dict(d):
    """Serializa um RealDictRow."""
    resultado = {}
    for k, v in d.items():
        resultado[k] = serializar_valor(v)
    return resultado


# =========================================================
# PÁGINA PRINCIPAL
# =========================================================

@painel22_bp.route('/painel/painel22')
@login_required
def painel22():
    """Página principal do Painel 22"""
    usuario_id = session.get('usuario_id')
    is_admin = session.get('is_admin', False)

    if not is_admin:
        if not verificar_permissao_painel(usuario_id, 'painel22'):
            current_app.logger.warning(
                f'Acesso negado ao painel22: {session.get("usuario")}'
            )
            return send_from_directory('frontend', 'acesso-negado.html')

    return send_from_directory('paineis/painel22', 'index.html')


# =========================================================
# API: DASHBOARD (cards resumo)
# =========================================================

@painel22_bp.route('/api/paineis/painel22/dashboard')
@login_required
def api_painel22_dashboard():
    """
    Dashboard de resumo: totais de pacientes, exames por status
    GET /api/paineis/painel22/dashboard
    """
    conn = get_db_connection()
    if not conn:
        return jsonify({'success': False, 'error': 'Erro de conexão'}), 500

    try:
        cursor = conn.cursor(cursor_factory=RealDictCursor)
        cursor.execute("SELECT * FROM vw_painel22_dashboard")
        row = cursor.fetchone()

        cursor.close()
        conn.close()

        if not row:
            return jsonify({
                'success': True,
                'data': {
                    'total_pacientes': 0,
                    'total_exames': 0,
                    'qt_radiologia': 0,
                    'qt_laboratorio': 0,
                    'qt_pendentes': 0,
                    'qt_em_andamento': 0,
                    'qt_concluidos': 0
                }
            })

        return jsonify({'success': True, 'data': serializar_dict(row)})

    except Exception as e:
        logger.error(f'[P22] Erro dashboard: {e}', exc_info=True)
        if conn:
            conn.close()
        return jsonify({'success': False, 'error': str(e)}), 500


# =========================================================
# API: DADOS (pacientes com exames agrupados)
# =========================================================

@painel22_bp.route('/api/paineis/painel22/dados')
@login_required
def api_painel22_dados():
    """
    Pacientes do PS com exames agrupados por tipo (Lab/Radio).

    Regra de ocultação: pacientes com TODOS os exames concluídos
    há mais de 1 hora são filtrados para não poluir a tela.

    GET /api/paineis/painel22/dados
    """
    conn = get_db_connection()
    if not conn:
        return jsonify({'success': False, 'error': 'Erro de conexão'}), 500

    try:
        cursor = conn.cursor(cursor_factory=RealDictCursor)

        cursor.execute("""
            SELECT
                d.*,
                ROUND(EXTRACT(EPOCH FROM (NOW() - d.dt_entrada)) / 3600.0, 1)
                    AS horas_no_ps_atual
            FROM vw_painel22_detalhe d
            ORDER BY
                d.nr_atendimento,
                d.prioridade_ordem ASC,
                d.dt_pedido ASC
        """)
        rows = cursor.fetchall()

        cursor.close()
        conn.close()

        # Agrupar por paciente
        pacientes = {}
        ordem = []

        for row in rows:
            exame = serializar_dict(row)
            nr_atend = exame['nr_atendimento']

            if nr_atend not in pacientes:
                pacientes[nr_atend] = {
                    'nr_atendimento': nr_atend,
                    'dt_entrada': exame.get('dt_entrada'),
                    'horas_no_ps': exame.get('horas_no_ps_atual'),
                    'nm_pessoa_fisica': exame.get('nm_pessoa_fisica'),
                    'idade': exame.get('idade'),
                    'ds_convenio': exame.get('ds_convenio'),
                    'exames_lab': [],
                    'exames_radio': [],
                    'qt_total': 0,
                    'qt_pendentes': 0,
                    'qt_em_andamento': 0,
                    'qt_concluidos': 0,
                    'dt_ultimo_resultado': None
                }
                ordem.append(nr_atend)

            pac = pacientes[nr_atend]
            pac['qt_total'] += 1

            status = exame.get('status_exame', '')

            if status in ('LAUDADO', 'LIBERADO'):
                pac['qt_concluidos'] += 1
                dt_res = exame.get('dt_resultado')
                if dt_res:
                    if pac['dt_ultimo_resultado'] is None or dt_res > pac['dt_ultimo_resultado']:
                        pac['dt_ultimo_resultado'] = dt_res
            elif status in ('EXECUTADO', 'COLETADO', 'EM_ANALISE', 'RESULTADO_PARCIAL'):
                pac['qt_em_andamento'] += 1
            else:
                pac['qt_pendentes'] += 1

            tipo = exame.get('tipo_exame', '')
            if tipo == 'LABORATORIO':
                pac['exames_lab'].append(exame)
            else:
                pac['exames_radio'].append(exame)

        # Regra de 1h: ocultar pacientes 100% concluídos há mais de 1h
        limite = datetime.now() - timedelta(hours=1)
        resultado = []

        for nr_atend in ordem:
            pac = pacientes[nr_atend]

            if pac['qt_total'] > 0 and pac['qt_concluidos'] == pac['qt_total']:
                dt_ult = pac['dt_ultimo_resultado']
                if dt_ult:
                    if isinstance(dt_ult, str):
                        try:
                            dt_ult = datetime.fromisoformat(dt_ult)
                        except (ValueError, TypeError):
                            dt_ult = None
                    if dt_ult and dt_ult < limite:
                        continue

            pac['pct_concluido'] = round(
                (pac['qt_concluidos'] / pac['qt_total'] * 100)
                if pac['qt_total'] > 0 else 0
            )

            pac.pop('dt_ultimo_resultado', None)
            resultado.append(pac)

        return jsonify({'success': True, 'data': resultado})

    except Exception as e:
        logger.error(f'[P22] Erro dados: {e}', exc_info=True)
        if conn:
            conn.close()
        return jsonify({'success': False, 'error': str(e)}), 500