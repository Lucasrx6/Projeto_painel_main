"""
Painel 17 - Tempo de Espera do Pronto Socorro
Endpoints para exibicao de tempo estimado de espera por clinica
"""
from flask import Blueprint, jsonify, send_from_directory, session, current_app
from datetime import datetime, timedelta
from psycopg2.extras import RealDictCursor
from backend.database import get_db_connection, release_connection
from backend.middleware.decorators import login_required
from backend.user_management import verificar_permissao_painel
import statistics

painel17_bp = Blueprint('painel17', __name__)

# =============================================================================
# CONFIGURACAO
# =============================================================================

JANELA_RECENTES = 5
MAX_ESPERA_MINUTOS = 300

# Faixa estreita: spread maximo de 5 min em torno da mediana
SPREAD_MAX = 5
SPREAD_MIN = 3

# Clinicas a excluir da exibicao
CLINICAS_EXCLUIR = ['emergencista']


# =============================================================================
# FUNCOES AUXILIARES
# =============================================================================

def _calcular_tempo_espera_minutos(row, campo_fim='dt_inicio_atendimento_med'):
    """
    Calcula tempo de espera em minutos.
    Ponto de partida: retirada_senha (preferencial) ou dt_entrada (fallback)
    Ponto final: campo_fim (dt_inicio_atendimento_med ou dt_inicio_atendimento)
    """
    fim = row.get(campo_fim)
    if not fim:
        return None

    inicio = row.get('retirada_senha') or row.get('dt_entrada')
    if not inicio:
        return None

    diff = (fim - inicio).total_seconds() / 60.0

    if diff <= 0 or diff > MAX_ESPERA_MINUTOS:
        return None

    return round(diff, 1)


def _calcular_metricas_clinica(atendimentos_recentes, atendimentos_1h_atras, campo_fim='dt_inicio_atendimento_med'):
    """
    Calcula mediana e faixa estreita (spread max 5 min) para uma clinica.
    campo_fim: coluna de referencia para o fim da espera.
    """
    tempos = []
    for row in atendimentos_recentes:
        t = _calcular_tempo_espera_minutos(row, campo_fim)
        if t is not None:
            tempos.append(t)

    if not tempos:
        return None

    mediana = statistics.median(tempos)

    # Faixa estreita centrada na mediana
    if len(tempos) >= 3:
        tempos_sorted = sorted(tempos)
        idx_low = max(0, int(len(tempos_sorted) * 0.35))
        idx_high = min(len(tempos_sorted) - 1, int(len(tempos_sorted) * 0.65))
        spread_natural = tempos_sorted[idx_high] - tempos_sorted[idx_low]
    else:
        spread_natural = SPREAD_MIN

    # Limita o spread entre SPREAD_MIN e SPREAD_MAX
    spread = max(SPREAD_MIN, min(SPREAD_MAX, spread_natural))

    # Distribui o spread: 40% abaixo, 60% acima da mediana
    faixa_min = max(1, round(mediana - spread * 0.4))
    faixa_max = round(mediana + spread * 0.6)

    # Garantir minimo de SPREAD_MIN de diferenca
    if faixa_max - faixa_min < SPREAD_MIN:
        faixa_max = faixa_min + SPREAD_MIN

    # Tendencia
    tendencia = 'estavel'
    tempos_1h = []
    for row in atendimentos_1h_atras:
        t = _calcular_tempo_espera_minutos(row, campo_fim)
        if t is not None:
            tempos_1h.append(t)

    if tempos_1h:
        mediana_1h = statistics.median(tempos_1h)
        diff_pct = ((mediana - mediana_1h) / mediana_1h * 100) if mediana_1h > 0 else 0

        if diff_pct > 15:
            tendencia = 'subindo'
        elif diff_pct < -15:
            tendencia = 'descendo'

    return {
        'mediana': round(mediana),
        'faixa_min': faixa_min,
        'faixa_max': faixa_max,
        'tendencia': tendencia,
        'amostra': len(tempos)
    }


# =============================================================================
# ROTAS DE PAGINA
# =============================================================================

@painel17_bp.route('/painel/painel17')
@login_required
def painel17():
    """Pagina principal do Painel 17"""
    usuario_id = session.get('usuario_id')
    is_admin = session.get('is_admin', False)

    if not is_admin:
        if not verificar_permissao_painel(usuario_id, 'painel17'):
            current_app.logger.warning(
                f'Acesso negado ao painel17: {session.get("usuario")}'
            )
            return send_from_directory('frontend', 'acesso-negado.html')

    return send_from_directory('paineis/painel17', 'index.html')


# =============================================================================
# API PRINCIPAL
# =============================================================================

@painel17_bp.route('/api/paineis/painel17/tempos', methods=['GET'])
@login_required
def api_painel17_tempos():
    """
    Retorna tempo estimado de espera por clinica + card de Acolhimento.
    """
    usuario_id = session.get('usuario_id')
    is_admin = session.get('is_admin', False)

    if not is_admin:
        if not verificar_permissao_painel(usuario_id, 'painel17'):
            return jsonify({
                'success': False,
                'error': 'Sem permissao'
            }), 403

    conn = get_db_connection()
    if not conn:
        return jsonify({
            'success': False,
            'error': 'Erro de conexao com o banco'
        }), 500

    try:
        cursor = conn.cursor(cursor_factory=RealDictCursor)
        agora = datetime.now()
        uma_hora_atras = agora - timedelta(hours=1)
        duas_horas_atras = agora - timedelta(hours=2)

        # =====================================================================
        # CLINICAS
        # =====================================================================

        cursor.execute("""
            SELECT DISTINCT cd_clinica, clinica
            FROM painel17_atendimentos_ps
            WHERE dt_entrada >= NOW() - INTERVAL '7 days'
            ORDER BY clinica
        """)
        clinicas = cursor.fetchall()

        resultado = []

        for clin in clinicas:
            cd = clin['cd_clinica']
            nome = clin['clinica']

            # Filtrar clinicas excluidas (ex: Emergencista)
            if nome and nome.strip().lower() in CLINICAS_EXCLUIR:
                continue

            # Ultimos N atendidos
            cursor.execute("""
                SELECT dt_entrada, retirada_senha, dt_inicio_atendimento_med
                FROM painel17_atendimentos_ps
                WHERE cd_clinica = %s
                  AND dt_inicio_atendimento_med IS NOT NULL
                ORDER BY dt_inicio_atendimento_med DESC
                LIMIT %s
            """, (cd, JANELA_RECENTES))
            recentes = cursor.fetchall()

            # Atendidos 1-2h atras (tendencia)
            cursor.execute("""
                SELECT dt_entrada, retirada_senha, dt_inicio_atendimento_med
                FROM painel17_atendimentos_ps
                WHERE cd_clinica = %s
                  AND dt_inicio_atendimento_med IS NOT NULL
                  AND dt_inicio_atendimento_med BETWEEN %s AND %s
                ORDER BY dt_inicio_atendimento_med DESC
                LIMIT %s
            """, (cd, duas_horas_atras, uma_hora_atras, JANELA_RECENTES))
            recentes_1h = cursor.fetchall()

            # Fila
            cursor.execute("""
                SELECT COUNT(*) AS total
                FROM painel17_atendimentos_ps
                WHERE cd_clinica = %s
                  AND dt_inicio_atendimento_med IS NULL
                  AND dt_alta IS NULL
                  AND dt_entrada >= NOW() - INTERVAL '24 hours'
            """, (cd,))
            fila_row = cursor.fetchone()
            fila = fila_row['total'] if fila_row else 0

            # Medicos atendendo
            cursor.execute("""
                SELECT COUNT(DISTINCT nm_medico) AS total
                FROM painel17_atendimentos_ps
                WHERE cd_clinica = %s
                  AND dt_inicio_atendimento_med IS NOT NULL
                  AND dt_fim_atendimento IS NULL
                  AND dt_alta IS NULL
                  AND dt_entrada >= NOW() - INTERVAL '24 hours'
            """, (cd,))
            medicos_row = cursor.fetchone()
            medicos = medicos_row['total'] if medicos_row else 0

            # Metricas
            metricas = _calcular_metricas_clinica(recentes, recentes_1h)

            clinica_data = {
                'cd_clinica': cd,
                'clinica': nome,
                'fila': fila,
                'medicos_atendendo': medicos
            }

            if metricas:
                clinica_data.update(metricas)
            else:
                clinica_data.update({
                    'mediana': None,
                    'faixa_min': None,
                    'faixa_max': None,
                    'tendencia': 'sem_dados',
                    'amostra': 0
                })

            resultado.append(clinica_data)

        # =====================================================================
        # ACOLHIMENTO (card virtual)
        # Tempo: retirada_senha/dt_entrada -> dt_inicio_atendimento
        # Filtro: apenas onde dt_inicio_atendimento < dt_inicio_atendimento_med
        # =====================================================================

        # Recentes para Acolhimento
        cursor.execute("""
            SELECT dt_entrada, retirada_senha, dt_inicio_atendimento
            FROM painel17_atendimentos_ps
            WHERE dt_inicio_atendimento IS NOT NULL
              AND dt_inicio_atendimento_med IS NOT NULL
              AND dt_inicio_atendimento < dt_inicio_atendimento_med
            ORDER BY dt_inicio_atendimento DESC
            LIMIT %s
        """, (JANELA_RECENTES,))
        acolhimento_recentes = cursor.fetchall()

        # Tendencia Acolhimento (1-2h atras)
        cursor.execute("""
            SELECT dt_entrada, retirada_senha, dt_inicio_atendimento
            FROM painel17_atendimentos_ps
            WHERE dt_inicio_atendimento IS NOT NULL
              AND dt_inicio_atendimento_med IS NOT NULL
              AND dt_inicio_atendimento < dt_inicio_atendimento_med
              AND dt_inicio_atendimento BETWEEN %s AND %s
            ORDER BY dt_inicio_atendimento DESC
            LIMIT %s
        """, (duas_horas_atras, uma_hora_atras, JANELA_RECENTES))
        acolhimento_1h = cursor.fetchall()

        # Fila Acolhimento: pacientes que chegaram mas ainda nao iniciaram acolhimento
        cursor.execute("""
            SELECT COUNT(*) AS total
            FROM painel17_atendimentos_ps
            WHERE dt_inicio_atendimento IS NULL
              AND dt_inicio_atendimento_med IS NULL
              AND dt_alta IS NULL
              AND dt_entrada >= NOW() - INTERVAL '24 hours'
        """)
        fila_acolhimento_row = cursor.fetchone()
        fila_acolhimento = fila_acolhimento_row['total'] if fila_acolhimento_row else 0

        metricas_acolhimento = _calcular_metricas_clinica(
            acolhimento_recentes, acolhimento_1h,
            campo_fim='dt_inicio_atendimento'
        )

        acolhimento_data = {
            'cd_clinica': None,
            'clinica': 'Acolhimento',
            'fila': fila_acolhimento,
            'medicos_atendendo': 0
        }

        if metricas_acolhimento:
            acolhimento_data.update(metricas_acolhimento)
        else:
            acolhimento_data.update({
                'mediana': None,
                'faixa_min': None,
                'faixa_max': None,
                'tendencia': 'sem_dados',
                'amostra': 0
            })

        resultado.append(acolhimento_data)

        # =====================================================================
        # ORDENACAO ALFABETICA
        # =====================================================================
        resultado.sort(key=lambda x: (x.get('clinica') or '').strip().lower())

        # =====================================================================
        # TOTAIS
        # =====================================================================

        cursor.execute("""
            SELECT
                COUNT(*) FILTER (
                    WHERE dt_inicio_atendimento_med IS NULL
                      AND dt_alta IS NULL
                      AND dt_entrada >= NOW() - INTERVAL '24 hours'
                ) AS fila_total,
                COUNT(*) FILTER (
                    WHERE dt_inicio_atendimento_med IS NOT NULL
                      AND dt_entrada >= NOW() - INTERVAL '24 hours'
                ) AS atendidos_hoje,
                COUNT(DISTINCT nm_medico) FILTER (
                    WHERE dt_inicio_atendimento_med IS NOT NULL
                      AND dt_fim_atendimento IS NULL
                      AND dt_alta IS NULL
                      AND dt_entrada >= NOW() - INTERVAL '24 hours'
                ) AS medicos_total
            FROM painel17_atendimentos_ps
        """)
        totais = cursor.fetchone()

        cursor.close()
        release_connection(conn)

        return jsonify({
            'success': True,
            'clinicas': resultado,
            'totais': {
                'fila_total': totais['fila_total'] if totais else 0,
                'atendidos_hoje': totais['atendidos_hoje'] if totais else 0,
                'medicos_total': totais['medicos_total'] if totais else 0
            },
            'timestamp': agora.isoformat()
        })

    except Exception as e:
        current_app.logger.error(
            f'Erro ao buscar tempos do painel17: {e}', exc_info=True
        )
        if conn:
            release_connection(conn)
        return jsonify({
            'success': False,
            'error': 'Erro ao buscar dados'
        }), 500