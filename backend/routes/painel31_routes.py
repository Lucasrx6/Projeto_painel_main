"""
Painel 31 - Central de Machine Learning
Hub de modelos ML em producao, com previsoes, metricas e monitoramento.
"""
from flask import Blueprint, jsonify, send_from_directory, session, current_app, abort, request
from datetime import datetime, timedelta
from psycopg2.extras import RealDictCursor
from backend.database import get_db_connection
from backend.middleware.decorators import login_required
from backend.user_management import verificar_permissao_painel
import statistics

painel31_bp = Blueprint('painel31', __name__)

# =============================================================================
# CONFIGURACAO
# =============================================================================

JANELA_METRICAS_DIAS = 30
DRIFT_AMARELO_PCT = 20.0
DRIFT_VERMELHO_PCT = 50.0
MIN_AMOSTRAS_SAUDE = 14


# =============================================================================
# FUNCOES AUXILIARES
# =============================================================================

def _calcular_status_saude(mae_atual, mae_baseline):
    if mae_atual is None or mae_baseline is None or mae_baseline == 0:
        return 'sem_dados'
    drift_pct = (mae_atual - mae_baseline) / mae_baseline * 100
    if drift_pct >= DRIFT_VERMELHO_PCT:
        return 'vermelho'
    elif drift_pct >= DRIFT_AMARELO_PCT:
        return 'amarelo'
    else:
        return 'verde'


def _calcular_metricas_janela(predicoes_realizadas):
    if not predicoes_realizadas:
        return None
    erros, erros_pct, erros_quad, erros_signed = [], [], [], []
    for p in predicoes_realizadas:
        previsto = float(p['valor_previsto'])
        real = float(p['valor_realizado'])
        erro = previsto - real
        erro_abs = abs(erro)
        erros.append(erro_abs)
        erros_signed.append(erro)
        erros_quad.append(erro * erro)
        if real > 0:
            erros_pct.append(erro_abs / real * 100)
    n = len(erros)
    mae = sum(erros) / n
    rmse = (sum(erros_quad) / n) ** 0.5
    bias = sum(erros_signed) / n
    mape = sum(erros_pct) / len(erros_pct) if erros_pct else None
    return {
        'mae': round(mae, 2),
        'rmse': round(rmse, 2),
        'mape': round(mape, 2) if mape is not None else None,
        'bias': round(bias, 2),
        'amostras': n
    }


def _buscar_modelo_por_nome(cursor, nome_modelo):
    cursor.execute("""
        SELECT *
        FROM ml_modelos_registry
        WHERE nome_modelo = %s AND ie_ativo = TRUE
        ORDER BY dt_criacao DESC
        LIMIT 1
    """, (nome_modelo,))
    return cursor.fetchone()


def _serializar_data(d):
    """Converte data/datetime para string ISO. Retorna None se input for None."""
    return d.isoformat() if d else None


# =============================================================================
# ROTAS DE PAGINA
# =============================================================================

@painel31_bp.route('/painel/painel31')
@login_required
def painel31_hub():
    usuario_id = session.get('usuario_id')
    is_admin = session.get('is_admin', False)
    if not is_admin and not verificar_permissao_painel(usuario_id, 'painel31'):
        current_app.logger.warning(f'Acesso negado ao painel31: {session.get("usuario")}')
        return send_from_directory('frontend', 'acesso-negado.html')
    return send_from_directory('paineis/painel31', 'index.html')


@painel31_bp.route('/painel/painel31/<nome_modelo>')
@login_required
def painel31_detalhe(nome_modelo):
    usuario_id = session.get('usuario_id')
    is_admin = session.get('is_admin', False)
    if not is_admin and not verificar_permissao_painel(usuario_id, 'painel31'):
        current_app.logger.warning(f'Acesso negado ao painel31/{nome_modelo}: {session.get("usuario")}')
        return send_from_directory('frontend', 'acesso-negado.html')
    if not nome_modelo.replace('_', '').isalnum():
        abort(400)
    if nome_modelo == 'ps_volume':
        return send_from_directory('paineis/painel31', 'ps_volume.html')
    return send_from_directory('frontend', '404.html')


# =============================================================================
# API - LISTA DE MODELOS (hub)
# =============================================================================

@painel31_bp.route('/api/paineis/painel31/modelos', methods=['GET'])
@login_required
def api_painel31_modelos():
    usuario_id = session.get('usuario_id')
    is_admin = session.get('is_admin', False)
    if not is_admin and not verificar_permissao_painel(usuario_id, 'painel31'):
        return jsonify({'success': False, 'error': 'Sem permissao'}), 403

    conn = get_db_connection()
    if not conn:
        return jsonify({'success': False, 'error': 'Erro de conexao com o banco'}), 500

    try:
        cursor = conn.cursor(cursor_factory=RealDictCursor)
        cursor.execute("""
            SELECT id, nome_modelo, versao, descricao, categoria, algoritmo,
                   dt_treino, periodo_treino_inicio, periodo_treino_fim,
                   num_amostras_treino, mae_teste, mape_teste, rmse_teste,
                   num_features, status, dt_criacao
            FROM ml_modelos_registry
            WHERE ie_ativo = TRUE
            ORDER BY status DESC, dt_criacao DESC
        """)
        modelos = cursor.fetchall()
        resultado = []

        for modelo in modelos:
            modelo_dict = dict(modelo)

            cursor.execute("""
                SELECT valor_previsto, valor_realizado
                FROM ml_ps_predicoes
                WHERE modelo_id = %s
                  AND valor_realizado IS NOT NULL
                  AND dt_alvo >= CURRENT_DATE - (INTERVAL '1 day' * %s)
                ORDER BY dt_alvo DESC
            """, (modelo['id'], JANELA_METRICAS_DIAS))
            preds_realizadas = cursor.fetchall()

            metricas_atuais = _calcular_metricas_janela(preds_realizadas)
            mae_atual = metricas_atuais['mae'] if metricas_atuais else None
            mae_baseline = float(modelo['mae_teste']) if modelo['mae_teste'] else None

            # Saude so e calculada se houver amostras suficientes
            if metricas_atuais and metricas_atuais['amostras'] >= MIN_AMOSTRAS_SAUDE:
                status_saude = _calcular_status_saude(mae_atual, mae_baseline)
            else:
                status_saude = 'sem_dados'

            cursor.execute("SELECT COUNT(*) AS total FROM ml_ps_predicoes WHERE modelo_id = %s", (modelo['id'],))
            total_preds = cursor.fetchone()['total']

            cursor.execute("SELECT MAX(dt_geracao) AS ultima FROM ml_ps_predicoes WHERE modelo_id = %s", (modelo['id'],))
            ultima_exec = cursor.fetchone()['ultima']

            modelo_dict.update({
                'metricas_atuais': metricas_atuais,
                'status_saude': status_saude,
                'total_predicoes': total_preds,
                'ultima_execucao': _serializar_data(ultima_exec),
                'mae_baseline': mae_baseline,
                'mae_atual': mae_atual
            })

            for campo in ['dt_treino', 'dt_criacao', 'periodo_treino_inicio', 'periodo_treino_fim']:
                modelo_dict[campo] = _serializar_data(modelo_dict.get(campo))
            for campo in ['mae_teste', 'mape_teste', 'rmse_teste']:
                if modelo_dict.get(campo) is not None:
                    modelo_dict[campo] = float(modelo_dict[campo])

            resultado.append(modelo_dict)

        cursor.close()
        conn.close()
        return jsonify({
            'success': True,
            'modelos': resultado,
            'total': len(resultado),
            'timestamp': datetime.now().isoformat()
        })

    except Exception as e:
        current_app.logger.error(f'Erro ao listar modelos do painel31: {e}', exc_info=True)
        if conn:
            conn.close()
        return jsonify({'success': False, 'error': 'Erro ao buscar modelos'}), 500


# =============================================================================
# API - DETALHE DE UM MODELO
# =============================================================================

@painel31_bp.route('/api/paineis/painel31/modelo/<nome_modelo>', methods=['GET'])
@login_required
def api_painel31_modelo_detalhe(nome_modelo):
    usuario_id = session.get('usuario_id')
    is_admin = session.get('is_admin', False)
    if not is_admin and not verificar_permissao_painel(usuario_id, 'painel31'):
        return jsonify({'success': False, 'error': 'Sem permissao'}), 403

    conn = get_db_connection()
    if not conn:
        return jsonify({'success': False, 'error': 'Erro de conexao'}), 500

    try:
        cursor = conn.cursor(cursor_factory=RealDictCursor)
        modelo = _buscar_modelo_por_nome(cursor, nome_modelo)

        if not modelo:
            cursor.close()
            conn.close()
            return jsonify({'success': False, 'error': f'Modelo {nome_modelo} nao encontrado'}), 404

        modelo_dict = dict(modelo)

        # ⚠️ CORRECAO: buscar "dados_ate" ANTES de fechar o cursor
        cursor.execute("""
            SELECT MAX(DATE(dt_entrada)) AS ultima_data
            FROM ml_ps_historico_chegadas
        """)
        row = cursor.fetchone()
        modelo_dict['dados_ate'] = _serializar_data(row['ultima_data']) if row and row['ultima_data'] else None

        cursor.close()
        conn.close()

        # Serializacao
        for campo in ['dt_treino', 'dt_criacao', 'dt_atualizacao', 'periodo_treino_inicio', 'periodo_treino_fim']:
            if modelo_dict.get(campo):
                modelo_dict[campo] = _serializar_data(modelo_dict[campo])
        for campo in ['mae_teste', 'mape_teste', 'rmse_teste']:
            if modelo_dict.get(campo) is not None:
                modelo_dict[campo] = float(modelo_dict[campo])

        return jsonify({'success': True, 'modelo': modelo_dict})

    except Exception as e:
        current_app.logger.error(f'Erro ao buscar modelo {nome_modelo}: {e}', exc_info=True)
        if conn:
            conn.close()
        return jsonify({'success': False, 'error': 'Erro ao buscar modelo'}), 500


# =============================================================================
# API - PREVISOES (CORRIGIDO: futuras sao futuras, historicas sao historicas)
# =============================================================================

@painel31_bp.route('/api/paineis/painel31/previsoes/<nome_modelo>', methods=['GET'])
@login_required
def api_painel31_previsoes(nome_modelo):
    """
    Retorna:
      - previsoes_futuras: CURRENT_DATE em diante, mais recente por dia
      - historico_realizado: ultimos N dias com valor_realizado preenchido
    """
    try:
        dias_hist = int(request.args.get('dias', 30))
        dias_hist = max(7, min(180, dias_hist))
    except (ValueError, TypeError):
        dias_hist = 30

    usuario_id = session.get('usuario_id')
    is_admin = session.get('is_admin', False)
    if not is_admin and not verificar_permissao_painel(usuario_id, 'painel31'):
        return jsonify({'success': False, 'error': 'Sem permissao'}), 403

    conn = get_db_connection()
    if not conn:
        return jsonify({'success': False, 'error': 'Erro de conexao'}), 500

    try:
        cursor = conn.cursor(cursor_factory=RealDictCursor)
        modelo = _buscar_modelo_por_nome(cursor, nome_modelo)

        if not modelo:
            cursor.close()
            conn.close()
            return jsonify({'success': False, 'error': f'Modelo {nome_modelo} nao encontrado'}), 404

        modelo_id = modelo['id']

        # ==== PREVISOES FUTURAS (dt_alvo >= hoje, sem exigir valor_realizado) ====
        cursor.execute("""
            SELECT DISTINCT ON (dt_alvo)
                dt_alvo, horizonte_dias,
                valor_previsto, intervalo_inferior, intervalo_superior,
                dt_geracao
            FROM ml_ps_predicoes
            WHERE modelo_id = %s
              AND dt_alvo >= CURRENT_DATE
            ORDER BY dt_alvo ASC, horizonte_dias ASC, dt_geracao DESC
        """, (modelo_id,))
        futuras = cursor.fetchall()

        # ==== HISTORICO REALIZADO (dt_alvo passado + valor_realizado preenchido) ====
        cursor.execute("""
            SELECT DISTINCT ON (dt_alvo)
                dt_alvo, horizonte_dias,
                valor_previsto, valor_realizado,
                erro_absoluto, erro_percentual,
                intervalo_inferior, intervalo_superior
            FROM ml_ps_predicoes
            WHERE modelo_id = %s
              AND valor_realizado IS NOT NULL
              AND dt_alvo < CURRENT_DATE
              AND dt_alvo >= CURRENT_DATE - (INTERVAL '1 day' * %s)
            ORDER BY dt_alvo DESC, horizonte_dias ASC
        """, (modelo_id, dias_hist))
        historico = cursor.fetchall()

        def serializar(rows):
            resultado = []
            for r in rows:
                d = dict(r)
                if d.get('dt_alvo'):
                    d['dt_alvo'] = _serializar_data(d['dt_alvo'])
                if d.get('dt_geracao'):
                    d['dt_geracao'] = _serializar_data(d['dt_geracao'])
                for k in ['valor_previsto', 'valor_realizado', 'intervalo_inferior',
                          'intervalo_superior', 'erro_absoluto', 'erro_percentual']:
                    if d.get(k) is not None:
                        d[k] = float(d[k])
                resultado.append(d)
            return resultado

        cursor.close()
        conn.close()

        return jsonify({
            'success': True,
            'modelo': nome_modelo,
            'modelo_versao': modelo['versao'],
            'dias_historico': dias_hist,
            'previsoes_futuras': serializar(futuras),
            'historico_realizado': serializar(list(reversed(historico))),
            'timestamp': datetime.now().isoformat()
        })

    except Exception as e:
        current_app.logger.error(f'Erro ao buscar previsoes de {nome_modelo}: {e}', exc_info=True)
        if conn:
            conn.close()
        return jsonify({'success': False, 'error': 'Erro ao buscar previsoes'}), 500


# =============================================================================
# API - METRICAS
# =============================================================================

@painel31_bp.route('/api/paineis/painel31/metricas/<nome_modelo>', methods=['GET'])
@login_required
def api_painel31_metricas(nome_modelo):
    usuario_id = session.get('usuario_id')
    is_admin = session.get('is_admin', False)
    if not is_admin and not verificar_permissao_painel(usuario_id, 'painel31'):
        return jsonify({'success': False, 'error': 'Sem permissao'}), 403

    conn = get_db_connection()
    if not conn:
        return jsonify({'success': False, 'error': 'Erro de conexao'}), 500

    try:
        cursor = conn.cursor(cursor_factory=RealDictCursor)
        modelo = _buscar_modelo_por_nome(cursor, nome_modelo)

        if not modelo:
            cursor.close()
            conn.close()
            return jsonify({'success': False, 'error': f'Modelo {nome_modelo} nao encontrado'}), 404

        modelo_id = modelo['id']
        mae_baseline = float(modelo['mae_teste']) if modelo['mae_teste'] else None

        janelas = {}
        for dias in [7, 30]:
            cursor.execute("""
                SELECT DISTINCT ON (dt_alvo)
                    valor_previsto, valor_realizado
                FROM ml_ps_predicoes
                WHERE modelo_id = %s
                  AND valor_realizado IS NOT NULL
                  AND dt_alvo < CURRENT_DATE
                  AND dt_alvo >= CURRENT_DATE - (INTERVAL '1 day' * %s)
                ORDER BY dt_alvo DESC, horizonte_dias ASC
            """, (modelo_id, dias))
            preds = cursor.fetchall()

            metricas = _calcular_metricas_janela(preds)
            if metricas and metricas['amostras'] >= MIN_AMOSTRAS_SAUDE:
                metricas['status_saude'] = _calcular_status_saude(metricas['mae'], mae_baseline)
                if mae_baseline and mae_baseline > 0:
                    metricas['drift_pct'] = round((metricas['mae'] - mae_baseline) / mae_baseline * 100, 2)
                else:
                    metricas['drift_pct'] = None
            elif metricas:
                metricas['status_saude'] = 'aguardando'
                metricas['drift_pct'] = None
                metricas['amostras_minimas'] = MIN_AMOSTRAS_SAUDE
            janelas[f'janela_{dias}d'] = metricas

        cursor.close()
        conn.close()

        return jsonify({
            'success': True,
            'modelo': nome_modelo,
            'mae_baseline': mae_baseline,
            'mape_baseline': float(modelo['mape_teste']) if modelo['mape_teste'] else None,
            'metricas': janelas,
            'timestamp': datetime.now().isoformat()
        })

    except Exception as e:
        current_app.logger.error(f'Erro ao buscar metricas de {nome_modelo}: {e}', exc_info=True)
        if conn:
            conn.close()
        return jsonify({'success': False, 'error': 'Erro ao buscar metricas'}), 500


# =============================================================================
# API - HISTORICO REAL
# =============================================================================

@painel31_bp.route('/api/paineis/painel31/historico-real', methods=['GET'])
@login_required
def api_painel31_historico_real():
    usuario_id = session.get('usuario_id')
    is_admin = session.get('is_admin', False)
    if not is_admin and not verificar_permissao_painel(usuario_id, 'painel31'):
        return jsonify({'success': False, 'error': 'Sem permissao'}), 403

    conn = get_db_connection()
    if not conn:
        return jsonify({'success': False, 'error': 'Erro de conexao'}), 500

    try:
        cursor = conn.cursor(cursor_factory=RealDictCursor)
        cursor.execute("""
            SELECT DATE(dt_entrada) AS data, COUNT(*)::int AS atendimentos
            FROM ml_ps_historico_chegadas
            WHERE dt_entrada >= CURRENT_DATE - INTERVAL '14 days'
              AND dt_entrada < CURRENT_DATE
              AND (ds_clinica IS NULL OR ds_clinica <> 'Cardiologia')
            GROUP BY DATE(dt_entrada)
            ORDER BY data
        """)
        rows = cursor.fetchall()
        historico = [{'data': r['data'].isoformat(), 'atendimentos': r['atendimentos']} for r in rows]

        cursor.close()
        conn.close()
        return jsonify({'success': True, 'historico': historico, 'timestamp': datetime.now().isoformat()})

    except Exception as e:
        current_app.logger.error(f'Erro ao buscar historico real: {e}', exc_info=True)
        if conn:
            conn.close()
        return jsonify({'success': False, 'error': 'Erro ao buscar historico'}), 500


# =============================================================================
# API - PICOS HORARIOS DE HOJE
# =============================================================================

@painel31_bp.route('/api/paineis/painel31/picos-hoje', methods=['GET'])
@login_required
def api_painel31_picos_hoje():
    usuario_id = session.get('usuario_id')
    is_admin = session.get('is_admin', False)
    if not is_admin and not verificar_permissao_painel(usuario_id, 'painel31'):
        return jsonify({'success': False, 'error': 'Sem permissao'}), 403

    conn = get_db_connection()
    if not conn:
        return jsonify({'success': False, 'error': 'Erro de conexao'}), 500

    try:
        cursor = conn.cursor(cursor_factory=RealDictCursor)

        # Pega previsao mais recente pro dia de hoje (independente de modelo_id,
        # porque tanto v1 quanto v2 podem ter previsto hoje — queremos a mais recente)
        cursor.execute("""
            SELECT p.valor_previsto
            FROM ml_ps_predicoes p
            JOIN ml_modelos_registry r ON r.id = p.modelo_id
            WHERE p.dt_alvo = CURRENT_DATE
              AND r.ie_ativo = TRUE
            ORDER BY p.dt_geracao DESC, p.horizonte_dias ASC
            LIMIT 1
        """)
        prev_row = cursor.fetchone()

        if not prev_row:
            cursor.close()
            conn.close()
            return jsonify({'success': True, 'picos': [], 'mensagem': 'Sem previsao diaria disponivel para hoje'})

        previsao_diaria = float(prev_row['valor_previsto'])

        cursor.execute("""
            SELECT hora, pct_do_dia
            FROM vw_ps_perfil_horario_semanal
            WHERE dia_semana = EXTRACT(DOW FROM CURRENT_DATE)::int
            ORDER BY hora
        """)
        perfil = cursor.fetchall()

        if not perfil:
            cursor.close()
            conn.close()
            return jsonify({'success': True, 'picos': [], 'mensagem': 'Sem perfil historico disponivel'})

        horas_estimativas = [{
            'hora': p['hora'],
            'estimado': round(previsao_diaria * float(p['pct_do_dia']) / 100),
            'pct': float(p['pct_do_dia'])
        } for p in perfil]

        ordenados = sorted(horas_estimativas, key=lambda x: x['estimado'], reverse=True)
        top_picos = sorted(ordenados[:3], key=lambda x: x['hora'])

        hora_atual = datetime.now().hour
        proximo_pico = None
        for h in horas_estimativas:
            if h['hora'] >= hora_atual and h['estimado'] >= ordenados[0]['estimado'] * 0.85:
                proximo_pico = h
                break

        cursor.close()
        conn.close()

        return jsonify({
            'success': True,
            'previsao_diaria': round(previsao_diaria),
            'horas': horas_estimativas,
            'top_picos': top_picos,
            'proximo_pico': proximo_pico,
            'hora_atual': hora_atual,
            'timestamp': datetime.now().isoformat()
        })

    except Exception as e:
        current_app.logger.error(f'Erro ao buscar picos de hoje: {e}', exc_info=True)
        if conn:
            conn.close()
        return jsonify({'success': False, 'error': 'Erro ao calcular picos'}), 500


# =============================================================================
# API - COMPARATIVO DIARIO (previsto vs realizado unificado)
# =============================================================================

@painel31_bp.route('/api/paineis/painel31/comparativo/<nome_modelo>', methods=['GET'])
@login_required
def api_painel31_comparativo(nome_modelo):
    """
    Retorna, para cada dia dos ultimos N dias + proximos 7 dias:
      - dt: data
      - realizado: atendimentos reais (da ml_ps_historico_chegadas, sem Cardiologia)
      - previsto: valor previsto pelo modelo ativo (menor horizonte = mais recente)
      - erro_pct: |previsto - realizado| / realizado * 100 (se realizado existir)
      - acerto_pct: 100 - erro_pct, clamped 0-100
      - status_acerto: 'verde' / 'amarelo' / 'vermelho' / 'futuro' / 'sem_previsao'
    """
    try:
        dias_hist = int(request.args.get('dias', 30))
        dias_hist = max(7, min(180, dias_hist))
    except (ValueError, TypeError):
        dias_hist = 30

    usuario_id = session.get('usuario_id')
    is_admin = session.get('is_admin', False)
    if not is_admin and not verificar_permissao_painel(usuario_id, 'painel31'):
        return jsonify({'success': False, 'error': 'Sem permissao'}), 403

    conn = get_db_connection()
    if not conn:
        return jsonify({'success': False, 'error': 'Erro de conexao'}), 500

    try:
        cursor = conn.cursor(cursor_factory=RealDictCursor)
        modelo = _buscar_modelo_por_nome(cursor, nome_modelo)

        if not modelo:
            cursor.close()
            conn.close()
            return jsonify({'success': False, 'error': f'Modelo {nome_modelo} nao encontrado'}), 404

        modelo_id = modelo['id']

        # 1. Realizados (historico, sem Cardiologia)
        cursor.execute("""
            SELECT DATE(dt_entrada) AS dt, COUNT(*)::int AS realizado
            FROM ml_ps_historico_chegadas
            WHERE dt_entrada >= CURRENT_DATE - (INTERVAL '1 day' * %s)
              AND dt_entrada < CURRENT_DATE
              AND (ds_clinica IS NULL OR ds_clinica <> 'Cardiologia')
            GROUP BY DATE(dt_entrada)
            ORDER BY dt
        """, (dias_hist,))
        realizados = {r['dt']: r['realizado'] for r in cursor.fetchall()}

        # 2. Previstos (todos dias do periodo + proximos 7, menor horizonte primeiro)
        cursor.execute("""
            SELECT DISTINCT ON (dt_alvo)
                dt_alvo, valor_previsto, intervalo_inferior, intervalo_superior
            FROM ml_ps_predicoes
            WHERE modelo_id = %s
              AND dt_alvo >= CURRENT_DATE - (INTERVAL '1 day' * %s)
              AND dt_alvo <= CURRENT_DATE + INTERVAL '7 days'
            ORDER BY dt_alvo, horizonte_dias ASC, dt_geracao DESC
        """, (modelo_id, dias_hist))
        previstos = {}
        for r in cursor.fetchall():
            previstos[r['dt_alvo']] = {
                'previsto': float(r['valor_previsto']),
                'inferior': float(r['intervalo_inferior']) if r['intervalo_inferior'] else None,
                'superior': float(r['intervalo_superior']) if r['intervalo_superior'] else None,
            }

        # 3. Monta lista unificada cobrindo todo o range
        from datetime import date as date_cls
        hoje = date_cls.today()
        data_inicio = hoje - timedelta(days=dias_hist)
        data_fim = hoje + timedelta(days=7)

        resultado = []
        d = data_inicio
        while d <= data_fim:
            realizado = realizados.get(d)
            prev_data = previstos.get(d)
            previsto = prev_data['previsto'] if prev_data else None

            # Calcula acerto se ambos existirem
            erro_pct = None
            acerto_pct = None
            status_acerto = None

            if d >= hoje:
                status_acerto = 'futuro'
            elif realizado is None:
                status_acerto = None  # dia nao tem dado real ainda
            elif previsto is None:
                status_acerto = 'sem_previsao'
            elif realizado > 0:
                erro_pct = abs(previsto - realizado) / realizado * 100
                acerto_pct = max(0, min(100, 100 - erro_pct))
                if acerto_pct >= 90:
                    status_acerto = 'verde'
                elif acerto_pct >= 75:
                    status_acerto = 'amarelo'
                else:
                    status_acerto = 'vermelho'

            resultado.append({
                'dt': d.isoformat(),
                'realizado': realizado,
                'previsto': round(previsto, 1) if previsto is not None else None,
                'inferior': round(prev_data['inferior'], 1) if prev_data and prev_data['inferior'] else None,
                'superior': round(prev_data['superior'], 1) if prev_data and prev_data['superior'] else None,
                'erro_pct': round(erro_pct, 1) if erro_pct is not None else None,
                'acerto_pct': round(acerto_pct, 1) if acerto_pct is not None else None,
                'status_acerto': status_acerto,
            })
            d += timedelta(days=1)

        cursor.close()
        conn.close()

        return jsonify({
            'success': True,
            'modelo': nome_modelo,
            'versao': modelo['versao'],
            'dias_historico': dias_hist,
            'comparativo': resultado,
            'timestamp': datetime.now().isoformat()
        })

    except Exception as e:
        current_app.logger.error(f'Erro ao buscar comparativo de {nome_modelo}: {e}', exc_info=True)
        if conn:
            conn.close()
        return jsonify({'success': False, 'error': 'Erro ao buscar comparativo'}), 500