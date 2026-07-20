"""
Painel 17 - Tempo de Espera do Pronto Socorro
Endpoints para exibicao de tempo estimado de espera por clinica
"""
from flask import Blueprint, jsonify, send_from_directory, session, current_app
from datetime import datetime, timedelta
from psycopg2.extras import RealDictCursor
from backend.database import get_db_cursor
from backend.middleware.decorators import login_required, panel_permission_required
from backend.cache import cache_route
import statistics
import unicodedata

painel17_bp = Blueprint('painel17', __name__)


def _norm_nome(texto):
    """Normaliza nome para comparação: maiúsculas + sem acentos."""
    if not texto:
        return ''
    nfkd = unicodedata.normalize('NFKD', str(texto).upper().strip())
    return ''.join(c for c in nfkd if not unicodedata.combining(c))

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

# Apos HORAS_INATIVIDADE sem atendimento, retorna TEMPO_PADRAO_INATIVIDADE em vez dos dados antigos
TEMPO_PADRAO_INATIVIDADE = 15
HORAS_INATIVIDADE = 2

# Correcoes de nome de clinica (chave: nome do banco em lowercase, valor: nome exibido)
RENOMEAR_CLINICAS = {
    'cirurgica geral': 'Cirurgia Geral'
}


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
@panel_permission_required('painel17')
def painel17():
    """Pagina principal do Painel 17"""
    return send_from_directory('paineis/painel17', 'index.html')


# =============================================================================
# API PRINCIPAL
# =============================================================================

@painel17_bp.route('/api/paineis/painel17/tempos', methods=['GET'])
@login_required
@panel_permission_required('painel17')
@cache_route(ttl=120, key_prefix='painel17:tempos', vary_by_user=False, vary_by_query=True)
def api_painel17_tempos():
    """
    Retorna tempo estimado de espera por clinica + card de Acolhimento.
    """
    try:
        with get_db_cursor() as cursor:
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

            # Médicos logados agora (medicos_ps) — fonte de verdade de presença física
            cursor.execute("""
                SELECT ds_usuario FROM medicos_ps WHERE ds_usuario IS NOT NULL
            """)
            logados_set = set(_norm_nome(row['ds_usuario']) for row in cursor.fetchall())

            # Todos os médico-clínica com atendimento iniciado hoje (bulk, evita N queries no loop)
            cursor.execute("""
                SELECT cd_clinica, nm_medico
                FROM painel17_atendimentos_ps
                WHERE dt_entrada >= NOW() - INTERVAL '24 hours'
                  AND dt_inicio_atendimento_med IS NOT NULL
                  AND nm_medico IS NOT NULL
                GROUP BY cd_clinica, nm_medico
            """)
            medicos_por_clinica = {}
            for row in cursor.fetchall():
                chave = row['cd_clinica']
                if chave not in medicos_por_clinica:
                    medicos_por_clinica[chave] = set()
                medicos_por_clinica[chave].add(_norm_nome(row['nm_medico']))

            resultado = []

            for clin in clinicas:
                cd = clin['cd_clinica']
                nome = clin['clinica']

                # Filtrar clinicas excluidas (ex: Emergencista)
                if nome and nome.strip().lower() in CLINICAS_EXCLUIR:
                    continue

                # Corrigir nomes errados vindos do banco
                if nome:
                    nome = RENOMEAR_CLINICAS.get(nome.strip().lower(), nome)

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

                # Médicos atendendo: interseção entre quem atendeu esta clínica hoje
                # e quem está logado num consultório agora (medicos_ps)
                nomes_clinica = medicos_por_clinica.get(cd, set())
                medicos = sum(1 for nm in nomes_clinica if nm in logados_set)

                # Verifica se o ultimo atendimento foi ha menos de HORAS_INATIVIDADE horas.
                # Se a clinica ficou inativa por mais tempo, retorna o tempo padrao
                # em vez de exibir dados de um pico antigo.
                dados_frescos = False
                if recentes:
                    ultimo = recentes[0].get('dt_inicio_atendimento_med')
                    if ultimo and (agora - ultimo) < timedelta(hours=HORAS_INATIVIDADE):
                        dados_frescos = True

                if dados_frescos:
                    metricas = _calcular_metricas_clinica(recentes, recentes_1h)
                elif recentes:
                    metricas = {
                        'mediana': TEMPO_PADRAO_INATIVIDADE,
                        'faixa_min': TEMPO_PADRAO_INATIVIDADE,
                        'faixa_max': TEMPO_PADRAO_INATIVIDADE,
                        'tendencia': 'sem_dados',
                        'amostra': 0
                    }
                else:
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

            dados_frescos_acolhimento = False
            if acolhimento_recentes:
                ultimo_acol = acolhimento_recentes[0].get('dt_inicio_atendimento')
                if ultimo_acol and (agora - ultimo_acol) < timedelta(hours=HORAS_INATIVIDADE):
                    dados_frescos_acolhimento = True

            if dados_frescos_acolhimento:
                metricas_acolhimento = _calcular_metricas_clinica(
                    acolhimento_recentes, acolhimento_1h,
                    campo_fim='dt_inicio_atendimento'
                )
            elif acolhimento_recentes:
                metricas_acolhimento = {
                    'mediana': TEMPO_PADRAO_INATIVIDADE,
                    'faixa_min': TEMPO_PADRAO_INATIVIDADE,
                    'faixa_max': TEMPO_PADRAO_INATIVIDADE,
                    'tendencia': 'sem_dados',
                    'amostra': 0
                }
            else:
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
        return jsonify({
            'success': False,
            'error': 'Erro ao buscar dados'
        }), 500