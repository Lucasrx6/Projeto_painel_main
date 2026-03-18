"""
Painel 23 - Atendimentos Ambulatoriais
Endpoints para dashboard de tempos e atendimentos do ambulatorio
"""
from flask import Blueprint, jsonify, request, send_from_directory, session, current_app
from datetime import datetime, timedelta
from psycopg2.extras import RealDictCursor
from backend.database import get_db_connection
from backend.middleware.decorators import login_required
from backend.user_management import verificar_permissao_painel
import statistics

painel23_bp = Blueprint('painel23', __name__)

# =============================================================================
# CONFIGURACAO
# =============================================================================

MAX_ESPERA_MINUTOS = 300
LIMITE_REGISTROS = 5000
JANELA_RECENTES = 8
SPREAD_MAX = 5
SPREAD_MIN = 3


# =============================================================================
# FUNCOES AUXILIARES
# =============================================================================

def serializar_linha(row):
    """Converte campos datetime para ISO string."""
    resultado = {}
    for chave, valor in row.items():
        if isinstance(valor, datetime):
            resultado[chave] = valor.isoformat()
        else:
            resultado[chave] = valor
    return resultado


def _mediana(valores):
    """Calcula mediana de uma lista, retorna None se vazia."""
    if not valores:
        return None
    return round(statistics.median(valores))


def _calcular_medianas_especialidade(rows):
    """
    Recebe lista de rows de uma especialidade e calcula medianas.
    Filtra outliers (> MAX_ESPERA_MINUTOS) e valores <= 0.
    """
    tempos_recepcao = []
    tempos_espera_medico = []
    tempos_consulta = []

    for r in rows:
        t = r.get('tempo_senha_recepcao_min')
        if t is not None and t > 0:
            tempos_recepcao.append(float(t))

        t = r.get('tempo_espera_medico_min')
        if t is not None and t > 0 and t < MAX_ESPERA_MINUTOS:
            tempos_espera_medico.append(float(t))

        t = r.get('tempo_consulta_min')
        if t is not None and t > 0 and t < MAX_ESPERA_MINUTOS:
            tempos_consulta.append(float(t))

    return {
        'mediana_senha_recepcao': _mediana(tempos_recepcao),
        'mediana_espera_medico': _mediana(tempos_espera_medico),
        'mediana_consulta': _mediana(tempos_consulta)
    }


def _calcular_metricas_fila(recentes, recentes_1h):
    """
    Calcula mediana e faixa estreita para uma fila.
    Mesmo algoritmo do P17.
    """
    tempos = []
    for r in recentes:
        t = r.get('tempo_senha_recepcao_min')
        if t is not None and float(t) > 0 and float(t) < MAX_ESPERA_MINUTOS:
            tempos.append(float(t))

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

    spread = max(SPREAD_MIN, min(SPREAD_MAX, spread_natural))

    faixa_min = max(1, round(mediana - spread * 0.4))
    faixa_max = round(mediana + spread * 0.6)

    if faixa_max - faixa_min < SPREAD_MIN:
        faixa_max = faixa_min + SPREAD_MIN

    # Tendencia
    tendencia = 'estavel'
    tempos_1h = []
    for r in recentes_1h:
        t = r.get('tempo_senha_recepcao_min')
        if t is not None and float(t) > 0 and float(t) < MAX_ESPERA_MINUTOS:
            tempos_1h.append(float(t))

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

@painel23_bp.route('/painel/painel23')
@login_required
def painel23():
    """Pagina principal do Painel 23"""
    usuario_id = session.get('usuario_id')
    is_admin = session.get('is_admin', False)

    if not is_admin:
        if not verificar_permissao_painel(usuario_id, 'painel23'):
            current_app.logger.warning(
                'Acesso negado ao painel23: %s', session.get('usuario')
            )
            return send_from_directory('frontend', 'acesso-negado.html')

    return send_from_directory('paineis/painel23', 'index.html')


# =============================================================================
# API - DASHBOARD (cards topo + filas + tabela especialidades)
# =============================================================================

@painel23_bp.route('/api/paineis/painel23/dashboard', methods=['GET'])
@login_required
def api_painel23_dashboard():
    """
    Retorna totalizadores, metricas por fila e por especialidade.
    """
    usuario_id = session.get('usuario_id')
    is_admin = session.get('is_admin', False)

    if not is_admin:
        if not verificar_permissao_painel(usuario_id, 'painel23'):
            return jsonify({'success': False, 'error': 'Sem permissao'}), 403

    conn = get_db_connection()
    if not conn:
        return jsonify({'success': False, 'error': 'Erro de conexao com o banco'}), 500

    try:
        cursor = conn.cursor(cursor_factory=RealDictCursor)

        data_inicio = request.args.get('data_inicio')
        data_fim = request.args.get('data_fim')

        if not data_inicio:
            data_inicio = datetime.now().strftime('%Y-%m-%d')
        if not data_fim:
            data_fim = datetime.now().strftime('%Y-%m-%d')

        # =============================================================
        # 1. Dados gerais do periodo (query unica)
        # =============================================================
        cursor.execute("""
            SELECT
                especialidade,
                medico,
                dt_inicio_consulta,
                dt_fim_consulta,
                dt_alta,
                tempo_senha_recepcao_min,
                tempo_espera_medico_min,
                tempo_consulta_min,
                producao,
                conversao
            FROM painel23_atendimentos_amb
            WHERE dt_abertura_atendimento >= %s::DATE
              AND dt_abertura_atendimento < %s::DATE + INTERVAL '1 day'
        """, (data_inicio, data_fim))

        registros = cursor.fetchall()

        # =============================================================
        # 2. Dados por fila (para cards de tempo real)
        # =============================================================
        agora = datetime.now()
        uma_hora_atras = agora - timedelta(hours=1)
        duas_horas_atras = agora - timedelta(hours=2)

        # Filas ativas nos ultimos 7 dias
        cursor.execute("""
            SELECT DISTINCT nr_seq_fila, ds_fila
            FROM painel23_atendimentos_amb
            WHERE nr_seq_fila IS NOT NULL
              AND ds_fila IS NOT NULL
              AND dt_abertura_atendimento >= NOW() - INTERVAL '7 days'
            ORDER BY ds_fila
        """)
        filas = cursor.fetchall()

        resultado_filas = []

        for fila in filas:
            nr_fila = fila['nr_seq_fila']
            ds_fila = fila['ds_fila']

            # Ultimos N atendidos com senha nessa fila
            cursor.execute("""
                SELECT tempo_senha_recepcao_min
                FROM painel23_atendimentos_amb
                WHERE nr_seq_fila = %s
                  AND dt_chamada_recepcao IS NOT NULL
                  AND tempo_senha_recepcao_min IS NOT NULL
                ORDER BY dt_chamada_recepcao DESC
                LIMIT %s
            """, (nr_fila, JANELA_RECENTES))
            recentes = cursor.fetchall()

            # Atendidos 1-2h atras (tendencia)
            cursor.execute("""
                SELECT tempo_senha_recepcao_min
                FROM painel23_atendimentos_amb
                WHERE nr_seq_fila = %s
                  AND dt_chamada_recepcao IS NOT NULL
                  AND tempo_senha_recepcao_min IS NOT NULL
                  AND dt_chamada_recepcao BETWEEN %s AND %s
                ORDER BY dt_chamada_recepcao DESC
                LIMIT %s
            """, (nr_fila, duas_horas_atras, uma_hora_atras, JANELA_RECENTES))
            recentes_1h = cursor.fetchall()

            # Aguardando na fila (tem senha, sem inicio consulta, sem alta, hoje)
            cursor.execute("""
                SELECT COUNT(*) AS total
                FROM painel23_atendimentos_amb
                WHERE nr_seq_fila = %s
                  AND dt_geracao_senha IS NOT NULL
                  AND dt_inicio_consulta IS NULL
                  AND dt_alta IS NULL
                  AND dt_abertura_atendimento >= CURRENT_DATE
            """, (nr_fila,))
            fila_row = cursor.fetchone()
            fila_aguardando = fila_row['total'] if fila_row else 0

            # Ultimo chamado
            cursor.execute("""
                SELECT dt_chamada_recepcao
                FROM painel23_atendimentos_amb
                WHERE nr_seq_fila = %s
                  AND dt_chamada_recepcao IS NOT NULL
                ORDER BY dt_chamada_recepcao DESC
                LIMIT 1
            """, (nr_fila,))
            ultimo_row = cursor.fetchone()
            ultimo_chamado_min = None
            if ultimo_row and ultimo_row['dt_chamada_recepcao']:
                diff = (agora - ultimo_row['dt_chamada_recepcao']).total_seconds() / 60
                ultimo_chamado_min = round(diff)

            # Atendidos hoje nessa fila
            cursor.execute("""
                SELECT COUNT(*) AS total
                FROM painel23_atendimentos_amb
                WHERE nr_seq_fila = %s
                  AND dt_chamada_recepcao IS NOT NULL
                  AND dt_abertura_atendimento >= CURRENT_DATE
            """, (nr_fila,))
            atend_row = cursor.fetchone()
            atendidos_hoje = atend_row['total'] if atend_row else 0

            # Metricas
            metricas = _calcular_metricas_fila(recentes, recentes_1h)

            fila_data = {
                'nr_seq_fila': nr_fila,
                'ds_fila': ds_fila,
                'aguardando': fila_aguardando,
                'atendidos_hoje': atendidos_hoje,
                'ultimo_chamado_min': ultimo_chamado_min
            }

            if metricas:
                fila_data.update(metricas)
            else:
                fila_data.update({
                    'mediana': None,
                    'faixa_min': None,
                    'faixa_max': None,
                    'tendencia': 'sem_dados',
                    'amostra': 0
                })

            resultado_filas.append(fila_data)

        cursor.close()
        conn.close()

        # =============================================================
        # 3. Processar totalizadores e especialidades em Python
        # =============================================================
        por_especialidade = {}
        for r in registros:
            esp = r.get('especialidade') or 'SEM ESPECIALIDADE'
            if esp not in por_especialidade:
                por_especialidade[esp] = []
            por_especialidade[esp].append(r)

        total_atendimentos = len(registros)
        aguardando_medico = 0
        em_consulta = 0
        finalizados = 0
        medicos_atendendo = set()
        medicos_total = set()
        producao_total = 0
        conversoes_total = 0
        tempos_espera_geral = []
        tempos_recepcao_geral = []
        tempos_consulta_geral = []

        for r in registros:
            tem_inicio = r.get('dt_inicio_consulta') is not None
            tem_fim = r.get('dt_fim_consulta') is not None
            tem_alta = r.get('dt_alta') is not None
            med = r.get('medico')

            if not tem_inicio and not tem_alta:
                aguardando_medico += 1
            elif tem_inicio and not tem_fim and not tem_alta:
                em_consulta += 1
                if med:
                    medicos_atendendo.add(med)
            else:
                finalizados += 1

            if med:
                medicos_total.add(med)

            try:
                val = r.get('producao')
                if val is not None and val != '':
                    producao_total += float(val)
            except (ValueError, TypeError):
                pass

            if r.get('conversao') == 'SIM':
                conversoes_total += 1

            t = r.get('tempo_espera_medico_min')
            if t is not None and t > 0 and t < MAX_ESPERA_MINUTOS:
                tempos_espera_geral.append(float(t))

            t = r.get('tempo_senha_recepcao_min')
            if t is not None and t > 0:
                tempos_recepcao_geral.append(float(t))

            t = r.get('tempo_consulta_min')
            if t is not None and t > 0 and t < MAX_ESPERA_MINUTOS:
                tempos_consulta_geral.append(float(t))

        totais = {
            'total_atendimentos': total_atendimentos,
            'aguardando_medico': aguardando_medico,
            'em_consulta': em_consulta,
            'finalizados': finalizados,
            'medicos_atendendo': len(medicos_atendendo),
            'medicos_total': len(medicos_total),
            'mediana_espera_geral': _mediana(tempos_espera_geral),
            'mediana_recepcao_geral': _mediana(tempos_recepcao_geral),
            'mediana_consulta_geral': _mediana(tempos_consulta_geral),
            'producao_total': round(producao_total, 2),
            'conversoes_total': conversoes_total
        }

        # Especialidades
        especialidades = []
        for esp_nome, rows in por_especialidade.items():
            esp_aguardando = 0
            esp_em_consulta = 0
            esp_finalizados = 0
            esp_medicos_atendendo = set()
            esp_medicos_total = set()
            esp_producao = 0

            for r in rows:
                tem_inicio = r.get('dt_inicio_consulta') is not None
                tem_fim = r.get('dt_fim_consulta') is not None
                tem_alta = r.get('dt_alta') is not None
                med = r.get('medico')

                if not tem_inicio and not tem_alta:
                    esp_aguardando += 1
                elif tem_inicio and not tem_fim and not tem_alta:
                    esp_em_consulta += 1
                    if med:
                        esp_medicos_atendendo.add(med)
                else:
                    esp_finalizados += 1

                if med:
                    esp_medicos_total.add(med)

                try:
                    val = r.get('producao')
                    if val is not None and val != '':
                        esp_producao += float(val)
                except (ValueError, TypeError):
                    pass

            medianas = _calcular_medianas_especialidade(rows)

            especialidades.append({
                'especialidade': esp_nome,
                'total_atendimentos': len(rows),
                'aguardando_medico': esp_aguardando,
                'em_consulta': esp_em_consulta,
                'finalizados': esp_finalizados,
                'medicos_atendendo': len(esp_medicos_atendendo),
                'medicos_total': len(esp_medicos_total),
                'mediana_senha_recepcao': medianas['mediana_senha_recepcao'],
                'mediana_espera_medico': medianas['mediana_espera_medico'],
                'mediana_consulta': medianas['mediana_consulta'],
                'producao_total': round(esp_producao, 2)
            })

        especialidades.sort(key=lambda x: x['total_atendimentos'], reverse=True)

        return jsonify({
            'success': True,
            'totais': totais,
            'filas': resultado_filas,
            'especialidades': especialidades,
            'filtros': {
                'data_inicio': data_inicio,
                'data_fim': data_fim
            },
            'timestamp': datetime.now().isoformat()
        })

    except Exception as e:
        current_app.logger.error(
            'Erro ao buscar dashboard do painel23: %s', e, exc_info=True
        )
        if conn:
            conn.close()
        return jsonify({'success': False, 'error': 'Erro ao buscar dados'}), 500


# =============================================================================
# API - ATENDIMENTOS (lista detalhada)
# =============================================================================

@painel23_bp.route('/api/paineis/painel23/atendimentos', methods=['GET'])
@login_required
def api_painel23_atendimentos():
    """
    Retorna lista de atendimentos com filtros.
    """
    usuario_id = session.get('usuario_id')
    is_admin = session.get('is_admin', False)

    if not is_admin:
        if not verificar_permissao_painel(usuario_id, 'painel23'):
            return jsonify({'success': False, 'error': 'Sem permissao'}), 403

    conn = get_db_connection()
    if not conn:
        return jsonify({'success': False, 'error': 'Erro de conexao com o banco'}), 500

    try:
        cursor = conn.cursor(cursor_factory=RealDictCursor)

        data_inicio = request.args.get('data_inicio')
        data_fim = request.args.get('data_fim')
        especialidade = request.args.get('especialidade')
        convenio = request.args.get('convenio')
        status = request.args.get('status')

        if not data_inicio:
            data_inicio = datetime.now().strftime('%Y-%m-%d')
        if not data_fim:
            data_fim = datetime.now().strftime('%Y-%m-%d')

        query = """
            SELECT *
            FROM painel23_detalhe_v
            WHERE dt_abertura_atendimento >= %s::DATE
              AND dt_abertura_atendimento < %s::DATE + INTERVAL '1 day'
        """
        params = [data_inicio, data_fim]

        if especialidade:
            query += " AND especialidade = %s"
            params.append(especialidade)

        if convenio:
            query += " AND convenio = %s"
            params.append(convenio)

        if status:
            query += " AND status_atendimento = %s"
            params.append(status)

        query += " ORDER BY dt_abertura_atendimento DESC LIMIT %s"
        params.append(LIMITE_REGISTROS)

        cursor.execute(query, params)
        atendimentos = cursor.fetchall()

        cursor.close()
        conn.close()

        return jsonify({
            'success': True,
            'atendimentos': [serializar_linha(a) for a in atendimentos],
            'total': len(atendimentos),
            'timestamp': datetime.now().isoformat()
        })

    except Exception as e:
        current_app.logger.error(
            'Erro ao buscar atendimentos do painel23: %s', e, exc_info=True
        )
        if conn:
            conn.close()
        return jsonify({'success': False, 'error': 'Erro ao buscar dados'}), 500


# =============================================================================
# API - FILTROS (listas para selects)
# =============================================================================

@painel23_bp.route('/api/paineis/painel23/filtros', methods=['GET'])
@login_required
def api_painel23_filtros():
    """
    Retorna listas de especialidades e convenios disponiveis.
    """
    usuario_id = session.get('usuario_id')
    is_admin = session.get('is_admin', False)

    if not is_admin:
        if not verificar_permissao_painel(usuario_id, 'painel23'):
            return jsonify({'success': False, 'error': 'Sem permissao'}), 403

    conn = get_db_connection()
    if not conn:
        return jsonify({'success': False, 'error': 'Erro de conexao com o banco'}), 500

    try:
        cursor = conn.cursor(cursor_factory=RealDictCursor)

        cursor.execute("""
            SELECT DISTINCT especialidade
            FROM painel23_atendimentos_amb
            WHERE especialidade IS NOT NULL
            ORDER BY especialidade
        """)
        especialidades = [r['especialidade'] for r in cursor.fetchall()]

        cursor.execute("""
            SELECT DISTINCT convenio
            FROM painel23_atendimentos_amb
            WHERE convenio IS NOT NULL
            ORDER BY convenio
        """)
        convenios = [r['convenio'] for r in cursor.fetchall()]

        cursor.close()
        conn.close()

        return jsonify({
            'success': True,
            'especialidades': especialidades,
            'convenios': convenios
        })

    except Exception as e:
        current_app.logger.error(
            'Erro ao buscar filtros do painel23: %s', e, exc_info=True
        )
        if conn:
            conn.close()
        return jsonify({'success': False, 'error': 'Erro ao buscar dados'}), 500