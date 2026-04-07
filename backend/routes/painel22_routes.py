"""
Painel 22 - Jornada do Paciente PS
Exames de Radiologia e Laboratório
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
    if val is None:
        return None
    if hasattr(val, 'isoformat'):
        return val.isoformat()
    return val


def serializar_dict(d):
    return {k: serializar_valor(v) for k, v in d.items()}


def _parse_datetime(val):
    if val is None:
        return None
    if isinstance(val, datetime):
        return val
    if isinstance(val, str):
        try:
            return datetime.fromisoformat(val)
        except (ValueError, TypeError):
            return None
    return None


def _buscar_dashboard():
    conn = get_db_connection()
    if not conn:
        return None, 'Erro de conexão'
    try:
        cursor = conn.cursor(cursor_factory=RealDictCursor)
        cursor.execute("SELECT * FROM vw_painel22_dashboard")
        row = cursor.fetchone()
        cursor.close()
        conn.close()
        if not row:
            return {
                'total_pacientes': 0, 'total_exames': 0,
                'qt_radiologia': 0, 'qt_laboratorio': 0,
                'qt_pendentes': 0, 'qt_em_andamento': 0, 'qt_concluidos': 0
            }, None
        return serializar_dict(row), None
    except Exception as e:
        logger.error(f'[P22] Erro dashboard: {e}', exc_info=True)
        if conn:
            conn.close()
        return None, str(e)


def _eh_data_sem_hora(dt):
    """
    Detecta datas Oracle 'apenas data' (hora 00:00:00).
    Comum em exames de radiologia onde dt_pedido/dt_resultado nao tem hora real.
    Nesses casos, calcular 'agora - dt' produz valores irreais (ex: 12h).
    """
    if dt is None:
        return False
    return dt.hour == 0 and dt.minute == 0 and dt.second == 0


def _calcular_tempos_exame(exame, agora):
    """
    Calcula campos de tempo para cada exame:
    - horas_espera: tempo total (pedido -> resultado ou pedido -> agora)
    - horas_desde_liberacao: tempo desde a liberação (só concluídos, com hora real)
    - liberacao_apenas_data: True quando dt_resultado nao tem hora (Oracle date-only)
    - liberacao_dias_atras: dias desde a data de liberacao (quando apenas_data)
    """
    dt_pedido = _parse_datetime(exame.get('dt_pedido'))
    status = (exame.get('status_exame') or '').upper()
    concluido = status in ('LAUDADO', 'LIBERADO')

    # horas_espera (tempo total do exame)
    if dt_pedido:
        if concluido:
            dt_resultado = _parse_datetime(exame.get('dt_resultado'))
            if dt_resultado:
                exame['horas_espera'] = round(max((dt_resultado - dt_pedido).total_seconds(), 0) / 3600.0, 2)
            else:
                exame['horas_espera'] = round(max((agora - dt_pedido).total_seconds(), 0) / 3600.0, 2)
        else:
            exame['horas_espera'] = round(max((agora - dt_pedido).total_seconds(), 0) / 3600.0, 2)
    else:
        exame['horas_espera'] = None

    # Tempo desde liberacao - com tratamento especial para datas sem hora
    exame['liberacao_apenas_data'] = False
    exame['liberacao_dias_atras'] = None
    exame['horas_desde_liberacao'] = None

    if concluido:
        dt_resultado = _parse_datetime(exame.get('dt_resultado'))
        if dt_resultado:
            if _eh_data_sem_hora(dt_resultado):
                # Data sem hora real (radiologia) - usa diferenca em dias
                exame['liberacao_apenas_data'] = True
                exame['liberacao_dias_atras'] = (agora.date() - dt_resultado.date()).days
            else:
                # Data com hora real - calcula horas normalmente
                exame['horas_desde_liberacao'] = round(max((agora - dt_resultado).total_seconds(), 0) / 3600.0, 2)


def _buscar_dados():
    conn = get_db_connection()
    if not conn:
        return None, 'Erro de conexão'
    try:
        cursor = conn.cursor(cursor_factory=RealDictCursor)
        cursor.execute("""
            SELECT
                d.*,
                ROUND(EXTRACT(EPOCH FROM (NOW() - d.dt_entrada)) / 3600.0, 1) AS horas_no_ps_atual
            FROM vw_painel22_detalhe d
            ORDER BY d.nr_atendimento, d.prioridade_ordem ASC, d.dt_pedido ASC
        """)
        rows = cursor.fetchall()
        cursor.close()
        conn.close()

        agora = datetime.now()
        pacientes = {}
        ordem = []

        for row in rows:
            exame = serializar_dict(row)
            nr_atend = exame['nr_atendimento']

            _calcular_tempos_exame(exame, agora)

            if nr_atend not in pacientes:
                # Aceita nm_medico ou ds_medico (compatibilidade com views diferentes)
                medico = exame.get('nm_medico') or exame.get('ds_medico')

                pacientes[nr_atend] = {
                    'nr_atendimento': nr_atend,
                    'dt_entrada': exame.get('dt_entrada'),
                    'horas_no_ps': exame.get('horas_no_ps_atual'),
                    'nm_pessoa_fisica': exame.get('nm_pessoa_fisica'),
                    'idade': exame.get('idade'),
                    'ds_convenio': exame.get('ds_convenio'),
                    'ds_clinica': exame.get('ds_clinica'),
                    'nm_medico': medico,
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

        # Regra de 1h: ocultar 100% concluídos há mais de 1h
        limite = agora - timedelta(hours=1)
        resultado = []

        for nr_atend in ordem:
            pac = pacientes[nr_atend]

            if pac['qt_total'] > 0 and pac['qt_concluidos'] == pac['qt_total']:
                dt_ult_parsed = _parse_datetime(pac['dt_ultimo_resultado'])
                if dt_ult_parsed and dt_ult_parsed < limite:
                    continue

            pac['pct_concluido'] = round(
                (pac['qt_concluidos'] / pac['qt_total'] * 100)
                if pac['qt_total'] > 0 else 0
            )
            pac.pop('dt_ultimo_resultado', None)
            resultado.append(pac)

        def _ordenar(p):
            if p['qt_pendentes'] > 0:
                return (0, -p['qt_pendentes'])
            if p['qt_em_andamento'] > 0:
                return (1, -p['qt_em_andamento'])
            return (2, 0)

        resultado.sort(key=_ordenar)
        return resultado, None

    except Exception as e:
        logger.error(f'[P22] Erro dados: {e}', exc_info=True)
        if conn:
            conn.close()
        return None, str(e)


# =========================================================
# ROTAS INTERNAS
# =========================================================

@painel22_bp.route('/painel/painel22')
@login_required
def painel22():
    usuario_id = session.get('usuario_id')
    is_admin = session.get('is_admin', False)
    if not is_admin:
        if not verificar_permissao_painel(usuario_id, 'painel22'):
            current_app.logger.warning(f'Acesso negado ao painel22: {session.get("usuario")}')
            return send_from_directory('frontend', 'acesso-negado.html')
    return send_from_directory('paineis/painel22', 'index.html')


@painel22_bp.route('/api/paineis/painel22/dashboard')
@login_required
def api_painel22_dashboard():
    dados, erro = _buscar_dashboard()
    if erro:
        return jsonify({'success': False, 'error': erro}), 500
    return jsonify({'success': True, 'data': dados})


@painel22_bp.route('/api/paineis/painel22/dados')
@login_required
def api_painel22_dados():
    dados, erro = _buscar_dados()
    if erro:
        return jsonify({'success': False, 'error': erro}), 500
    return jsonify({'success': True, 'data': dados})


# =========================================================
# ROTAS PÚBLICAS
# =========================================================

@painel22_bp.route('/publico/painel22')
def painel22_publico():
    current_app.logger.info(f'[P22] Acesso público de {request.remote_addr}')
    return send_from_directory('paineis/painel22', 'index.html')


@painel22_bp.route('/api/publico/painel22/dashboard')
def api_painel22_dashboard_publico():
    dados, erro = _buscar_dashboard()
    if erro:
        return jsonify({'success': False, 'error': erro}), 500
    return jsonify({'success': True, 'data': dados})


@painel22_bp.route('/api/publico/painel22/dados')
def api_painel22_dados_publico():
    dados, erro = _buscar_dados()
    if erro:
        return jsonify({'success': False, 'error': erro}), 500
    return jsonify({'success': True, 'data': dados})