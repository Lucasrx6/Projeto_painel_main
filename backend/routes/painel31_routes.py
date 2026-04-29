"""
Painel 31 - Central de Machine Learning
Hub de modelos ML em produção, com previsões, métricas e monitoramento.
"""
from flask import Blueprint, jsonify, send_from_directory, session, current_app, abort
from datetime import datetime, timedelta
from psycopg2.extras import RealDictCursor
from backend.database import get_db_connection, release_connection
from backend.middleware.decorators import login_required
from backend.user_management import verificar_permissao_painel
import statistics

painel31_bp = Blueprint('painel31', __name__)

# =============================================================================
# CONFIGURACAO
# =============================================================================

# Janela padrao para calculo de metricas (em dias)
JANELA_METRICAS_DIAS = 30

# Thresholds de saude do modelo (drift sobre o MAE de treino)
DRIFT_AMARELO_PCT = 20.0
DRIFT_VERMELHO_PCT = 50.0


# =============================================================================
# FUNCOES AUXILIARES
# =============================================================================

def _calcular_status_saude(mae_atual, mae_baseline):
    """
    Calcula status de saude do modelo baseado em drift do MAE.
    Retorna: 'verde', 'amarelo', 'vermelho' ou 'sem_dados'
    """
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
    """
    Calcula MAE, MAPE, RMSE e bias a partir de uma lista de predicoes
    com valor_realizado preenchido.
    """
    if not predicoes_realizadas:
        return None

    erros = []
    erros_pct = []
    erros_quad = []
    erros_signed = []

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
    """Busca um modelo no registry pelo nome (pega versao mais recente ativa)."""
    cursor.execute("""
        SELECT *
        FROM ml_modelos_registry
        WHERE nome_modelo = %s
          AND ie_ativo = TRUE
        ORDER BY dt_criacao DESC
        LIMIT 1
    """, (nome_modelo,))
    return cursor.fetchone()


# =============================================================================
# ROTAS DE PAGINA
# =============================================================================

@painel31_bp.route('/painel/painel31')
@login_required
def painel31_hub():
    """Pagina principal - Hub da Central de ML"""
    usuario_id = session.get('usuario_id')
    is_admin = session.get('is_admin', False)

    if not is_admin:
        if not verificar_permissao_painel(usuario_id, 'painel31'):
            current_app.logger.warning(
                f'Acesso negado ao painel31: {session.get("usuario")}'
            )
            return send_from_directory('frontend', 'acesso-negado.html')

    return send_from_directory('paineis/painel31', 'index.html')


@painel31_bp.route('/painel/painel31/<nome_modelo>')
@login_required
def painel31_detalhe(nome_modelo):
    """Sub-pagina de detalhes de um modelo especifico"""
    usuario_id = session.get('usuario_id')
    is_admin = session.get('is_admin', False)

    if not is_admin:
        if not verificar_permissao_painel(usuario_id, 'painel31'):
            current_app.logger.warning(
                f'Acesso negado ao painel31/{nome_modelo}: {session.get("usuario")}'
            )
            return send_from_directory('frontend', 'acesso-negado.html')

    # Sanitizacao basica do parametro (evita path traversal)
    if not nome_modelo.replace('_', '').isalnum():
        abort(400)

    if nome_modelo == 'ps_volume':
        return send_from_directory('paineis/painel31', 'ps_volume.html')
    if nome_modelo == 'internacoes':
        return send_from_directory('paineis/painel31', 'internacoes.html')

    return send_from_directory('frontend', '404.html')


# =============================================================================
# API - LISTA DE MODELOS (alimenta o hub)
# =============================================================================

@painel31_bp.route('/api/paineis/painel31/modelos', methods=['GET'])
@login_required
def api_painel31_modelos():
    """
    Retorna todos os modelos do registry com snapshot de saude atual.
    Alimenta o hub principal do P31.
    """
    usuario_id = session.get('usuario_id')
    is_admin = session.get('is_admin', False)

    if not is_admin:
        if not verificar_permissao_painel(usuario_id, 'painel31'):
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

        # Lista todos os modelos ativos
        cursor.execute("""
            SELECT
                id, nome_modelo, versao, descricao, categoria, algoritmo,
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

            # Determina qual tabela consultar baseado no nome_modelo
            if modelo['nome_modelo'] == 'internacoes' or modelo['nome_modelo'].startswith('intern_'):
                tabela_preds = 'ml_internacoes_predicoes'
                condicao_id = "segmento = 'total'" # Usa o total como referencia
            else:
                tabela_preds = 'ml_ps_predicoes'
                condicao_id = f"modelo_id = {modelo['id']}"

            # Busca metricas recentes (ultimos N dias) para calcular saude atual
            cursor.execute(f"""
                SELECT valor_previsto, valor_realizado
                FROM {tabela_preds}
                WHERE {condicao_id}
                  AND valor_realizado IS NOT NULL
                  AND dt_alvo >= CURRENT_DATE - INTERVAL '{JANELA_METRICAS_DIAS} days'
                ORDER BY dt_alvo DESC
            """)
            preds_realizadas = cursor.fetchall()

            metricas_atuais = _calcular_metricas_janela(preds_realizadas)
            mae_atual = metricas_atuais['mae'] if metricas_atuais else None
            status_saude = _calcular_status_saude(mae_atual, float(modelo['mae_teste']) if modelo['mae_teste'] else None)

            # Conta total de predicoes ja geradas
            cursor.execute(f"""
                SELECT COUNT(*) AS total
                FROM {tabela_preds}
                WHERE {condicao_id}
            """)
            total_preds = cursor.fetchone()['total']

            # Ultima execucao do worker
            cursor.execute(f"""
                SELECT MAX(dt_geracao) AS ultima
                FROM {tabela_preds}
                WHERE {condicao_id}
            """)
            ultima_exec = cursor.fetchone()['ultima']

            modelo_dict.update({
                'metricas_atuais': metricas_atuais,
                'status_saude': status_saude,
                'total_predicoes': total_preds,
                'ultima_execucao': ultima_exec.isoformat() if ultima_exec else None,
                'mae_baseline': float(modelo['mae_teste']) if modelo['mae_teste'] else None,
                'mae_atual': mae_atual
            })

            # Converte datas para isoformat para serializar
            for campo in ['dt_treino', 'dt_criacao']:
                if modelo_dict.get(campo):
                    modelo_dict[campo] = modelo_dict[campo].isoformat()
            for campo in ['periodo_treino_inicio', 'periodo_treino_fim']:
                if modelo_dict.get(campo):
                    modelo_dict[campo] = modelo_dict[campo].isoformat()

            # Converte numeric para float (JSON serializa)
            for campo in ['mae_teste', 'mape_teste', 'rmse_teste']:
                if modelo_dict.get(campo) is not None:
                    modelo_dict[campo] = float(modelo_dict[campo])

            resultado.append(modelo_dict)

        cursor.close()
        release_connection(conn)

        return jsonify({
            'success': True,
            'modelos': resultado,
            'total': len(resultado),
            'timestamp': datetime.now().isoformat()
        })

    except Exception as e:
        current_app.logger.error(
            f'Erro ao listar modelos do painel31: {e}', exc_info=True
        )
        if conn:
            release_connection(conn)
        return jsonify({
            'success': False,
            'error': 'Erro ao buscar modelos'
        }), 500


# =============================================================================
# API - DETALHE DE UM MODELO
# =============================================================================

@painel31_bp.route('/api/paineis/painel31/modelo/<nome_modelo>', methods=['GET'])
@login_required
def api_painel31_modelo_detalhe(nome_modelo):
    """Retorna metadados completos de um modelo especifico."""
    usuario_id = session.get('usuario_id')
    is_admin = session.get('is_admin', False)

    if not is_admin:
        if not verificar_permissao_painel(usuario_id, 'painel31'):
            return jsonify({'success': False, 'error': 'Sem permissao'}), 403

    conn = get_db_connection()
    if not conn:
        return jsonify({'success': False, 'error': 'Erro de conexao'}), 500

    try:
        cursor = conn.cursor(cursor_factory=RealDictCursor)
        modelo = _buscar_modelo_por_nome(cursor, nome_modelo)

        if not modelo:
            cursor.close()
            release_connection(conn)
            return jsonify({
                'success': False,
                'error': f'Modelo {nome_modelo} nao encontrado'
            }), 404

        modelo_dict = dict(modelo)

        # Serializa datas e numerics
        for campo in ['dt_treino', 'dt_criacao', 'dt_atualizacao']:
            if modelo_dict.get(campo):
                modelo_dict[campo] = modelo_dict[campo].isoformat()
        for campo in ['periodo_treino_inicio', 'periodo_treino_fim']:
            if modelo_dict.get(campo):
                modelo_dict[campo] = modelo_dict[campo].isoformat()
        for campo in ['mae_teste', 'mape_teste', 'rmse_teste']:
            if modelo_dict.get(campo) is not None:
                modelo_dict[campo] = float(modelo_dict[campo])

        cursor.close()
        release_connection(conn)

        return jsonify({
            'success': True,
            'modelo': modelo_dict
        })

    except Exception as e:
        current_app.logger.error(
            f'Erro ao buscar modelo {nome_modelo}: {e}', exc_info=True
        )
        if conn:
            release_connection(conn)
        return jsonify({'success': False, 'error': 'Erro ao buscar modelo'}), 500


# =============================================================================
# API - PREVISOES (futuro + historico realizado)
# =============================================================================

@painel31_bp.route('/api/paineis/painel31/previsoes/<nome_modelo>', methods=['GET'])
@login_required
def api_painel31_previsoes(nome_modelo):
    """
    Retorna:
      - Previsoes futuras (proximos 7 dias) - apenas a versao mais recente por dia
      - Historico realizado (ultimos 30 dias) com previsto vs real
    Alimenta o grafico principal da sub-pagina do modelo.
    """
    usuario_id = session.get('usuario_id')
    is_admin = session.get('is_admin', False)

    if not is_admin:
        if not verificar_permissao_painel(usuario_id, 'painel31'):
            return jsonify({'success': False, 'error': 'Sem permissao'}), 403

    conn = get_db_connection()
    if not conn:
        return jsonify({'success': False, 'error': 'Erro de conexao'}), 500

    try:
        cursor = conn.cursor(cursor_factory=RealDictCursor)
        modelo = _buscar_modelo_por_nome(cursor, nome_modelo)

        if not modelo:
            cursor.close()
            release_connection(conn)
            return jsonify({
                'success': False,
                'error': f'Modelo {nome_modelo} nao encontrado'
            }), 404

        modelo_id = modelo['id']

        # Previsoes futuras: pega a versao mais recente para cada dia futuro
        # (menor horizonte = previsao mais recente para aquele dia)
        cursor.execute("""
            SELECT DISTINCT ON (dt_alvo)
                dt_alvo, horizonte_dias,
                valor_previsto, intervalo_inferior, intervalo_superior,
                dt_geracao
            FROM ml_ps_predicoes
            WHERE modelo_id = %s
              AND dt_alvo >= CURRENT_DATE
            ORDER BY dt_alvo, horizonte_dias ASC
        """, (modelo_id,))
        futuras = cursor.fetchall()

        # Historico realizado: ultimos 30 dias com previsto vs real
        cursor.execute("""
            SELECT DISTINCT ON (dt_alvo)
                dt_alvo, horizonte_dias,
                valor_previsto, valor_realizado,
                erro_absoluto, erro_percentual,
                intervalo_inferior, intervalo_superior
            FROM ml_ps_predicoes
            WHERE modelo_id = %s
              AND valor_realizado IS NOT NULL
              AND dt_alvo >= CURRENT_DATE - INTERVAL '30 days'
            ORDER BY dt_alvo DESC, horizonte_dias ASC
        """, (modelo_id,))
        historico = cursor.fetchall()

        # Serializa
        def serializar(rows):
            resultado = []
            for r in rows:
                d = dict(r)
                if d.get('dt_alvo'):
                    d['dt_alvo'] = d['dt_alvo'].isoformat()
                if d.get('dt_geracao'):
                    d['dt_geracao'] = d['dt_geracao'].isoformat()
                for k in ['valor_previsto', 'valor_realizado', 'intervalo_inferior',
                          'intervalo_superior', 'erro_absoluto', 'erro_percentual']:
                    if d.get(k) is not None:
                        d[k] = float(d[k])
                resultado.append(d)
            return resultado

        cursor.close()
        release_connection(conn)

        return jsonify({
            'success': True,
            'modelo': nome_modelo,
            'modelo_versao': modelo['versao'],
            'previsoes_futuras': serializar(futuras),
            'historico_realizado': serializar(list(reversed(historico))),
            'timestamp': datetime.now().isoformat()
        })

    except Exception as e:
        current_app.logger.error(
            f'Erro ao buscar previsoes de {nome_modelo}: {e}', exc_info=True
        )
        if conn:
            release_connection(conn)
        return jsonify({'success': False, 'error': 'Erro ao buscar previsoes'}), 500


# =============================================================================
# API - METRICAS DE QUALIDADE
# =============================================================================

@painel31_bp.route('/api/paineis/painel31/metricas/<nome_modelo>', methods=['GET'])
@login_required
def api_painel31_metricas(nome_modelo):
    """
    Retorna metricas de qualidade calculadas em janelas moveis (7d, 30d).
    """
    usuario_id = session.get('usuario_id')
    is_admin = session.get('is_admin', False)

    if not is_admin:
        if not verificar_permissao_painel(usuario_id, 'painel31'):
            return jsonify({'success': False, 'error': 'Sem permissao'}), 403

    conn = get_db_connection()
    if not conn:
        return jsonify({'success': False, 'error': 'Erro de conexao'}), 500

    try:
        cursor = conn.cursor(cursor_factory=RealDictCursor)
        modelo = _buscar_modelo_por_nome(cursor, nome_modelo)

        if not modelo:
            cursor.close()
            release_connection(conn)
            return jsonify({
                'success': False,
                'error': f'Modelo {nome_modelo} nao encontrado'
            }), 404

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
                  AND dt_alvo >= CURRENT_DATE - INTERVAL '%s days'
                ORDER BY dt_alvo DESC, horizonte_dias ASC
            """, (modelo_id, dias))
            preds = cursor.fetchall()

            metricas = _calcular_metricas_janela(preds)
            if metricas:
                metricas['status_saude'] = _calcular_status_saude(
                    metricas['mae'], mae_baseline
                )
                if mae_baseline and mae_baseline > 0:
                    metricas['drift_pct'] = round(
                        (metricas['mae'] - mae_baseline) / mae_baseline * 100, 2
                    )
                else:
                    metricas['drift_pct'] = None
            janelas[f'janela_{dias}d'] = metricas

        cursor.close()
        release_connection(conn)

        return jsonify({
            'success': True,
            'modelo': nome_modelo,
            'mae_baseline': mae_baseline,
            'mape_baseline': float(modelo['mape_teste']) if modelo['mape_teste'] else None,
            'metricas': janelas,
            'timestamp': datetime.now().isoformat()
        })

    except Exception as e:
        current_app.logger.error(
            f'Erro ao buscar metricas de {nome_modelo}: {e}', exc_info=True
        )
        if conn:
            release_connection(conn)
        return jsonify({'success': False, 'error': 'Erro ao buscar metricas'}), 500

# =============================================================================
# API - HISTORICO REAL DE ATENDIMENTOS (independente de predicoes)
# =============================================================================

@painel31_bp.route('/api/paineis/painel31/historico-real', methods=['GET'])
@login_required
def api_painel31_historico_real():
    """
    Retorna o historico real de atendimentos do PS dos ultimos N dias,
    direto da tabela de chegadas (independente de existir predicao).
    Usado para exibir os dias passados na visao geral do usuario.
    """
    usuario_id = session.get('usuario_id')
    is_admin = session.get('is_admin', False)

    if not is_admin:
        if not verificar_permissao_painel(usuario_id, 'painel31'):
            return jsonify({'success': False, 'error': 'Sem permissao'}), 403

    conn = get_db_connection()
    if not conn:
        return jsonify({'success': False, 'error': 'Erro de conexao'}), 500

    try:
        cursor = conn.cursor(cursor_factory=RealDictCursor)

        cursor.execute("""
            SELECT * FROM (
                SELECT DISTINCT ON (dt_alvo)
                    dt_alvo AS data,
                    valor_realizado::int AS atendimentos
                FROM ml_ps_predicoes
                WHERE valor_realizado IS NOT NULL
                  AND dt_alvo >= CURRENT_DATE - INTERVAL '14 days'
                  AND dt_alvo < CURRENT_DATE
                ORDER BY dt_alvo DESC, horizonte_dias ASC
            ) sub
            ORDER BY data ASC
        """)
        rows = cursor.fetchall()

        historico = []
        for r in rows:
            historico.append({
                'data': r['data'].isoformat(),
                'atendimentos': r['atendimentos']
            })

        cursor.close()
        release_connection(conn)

        return jsonify({
            'success': True,
            'historico': historico,
            'timestamp': datetime.now().isoformat()
        })

    except Exception as e:
        current_app.logger.error(
            f'Erro ao buscar historico real: {e}', exc_info=True
        )
        if conn:
            release_connection(conn)
        return jsonify({'success': False, 'error': 'Erro ao buscar historico'}), 500


# =============================================================================
# API - PICOS HORARIOS DE HOJE
# =============================================================================

@painel31_bp.route('/api/paineis/painel31/picos-hoje', methods=['GET'])
@login_required
def api_painel31_picos_hoje():
    """
    Retorna a estimativa horaria de atendimentos para hoje, baseada em:
      - Previsao diaria do modelo (valor_previsto para CURRENT_DATE)
      - Distribuicao percentual historica por hora (vw_ps_perfil_horario_semanal)
    """
    usuario_id = session.get('usuario_id')
    is_admin = session.get('is_admin', False)

    if not is_admin:
        if not verificar_permissao_painel(usuario_id, 'painel31'):
            return jsonify({'success': False, 'error': 'Sem permissao'}), 403

    conn = get_db_connection()
    if not conn:
        return jsonify({'success': False, 'error': 'Erro de conexao'}), 500

    try:
        cursor = conn.cursor(cursor_factory=RealDictCursor)

        # 1. Previsao diaria de hoje
        cursor.execute("""
            SELECT valor_previsto
            FROM ml_ps_predicoes
            WHERE dt_alvo = CURRENT_DATE
            ORDER BY horizonte_dias ASC, dt_geracao DESC
            LIMIT 1
        """)
        prev_row = cursor.fetchone()

        if not prev_row:
            cursor.close()
            release_connection(conn)
            return jsonify({
                'success': True,
                'picos': [],
                'mensagem': 'Sem previsao diaria disponivel para hoje'
            })

        previsao_diaria = float(prev_row['valor_previsto'])

        # 2. Perfil horario do dia da semana de hoje
        # PostgreSQL DOW: 0=Dom, 1=Seg, ..., 6=Sab
        cursor.execute("""
            SELECT hora, pct_do_dia
            FROM vw_ps_perfil_horario_semanal
            WHERE dia_semana = EXTRACT(DOW FROM CURRENT_DATE)::int
            ORDER BY hora
        """)
        perfil = cursor.fetchall()

        if not perfil:
            cursor.close()
            release_connection(conn)
            return jsonify({
                'success': True,
                'picos': [],
                'mensagem': 'Sem perfil historico disponivel'
            })

        # 3. Estima atendimentos por hora
        horas_estimativas = []
        for p in perfil:
            estimado = round(previsao_diaria * float(p['pct_do_dia']) / 100)
            horas_estimativas.append({
                'hora': p['hora'],
                'estimado': estimado,
                'pct': float(p['pct_do_dia'])
            })

        # 4. Identifica os 3 maiores picos
        ordenados = sorted(horas_estimativas, key=lambda x: x['estimado'], reverse=True)
        top_picos = ordenados[:3]
        top_picos.sort(key=lambda x: x['hora'])

        # 5. Hora atual e proxima hora de pico relevante
        from datetime import datetime as dt
        hora_atual = dt.now().hour
        proximo_pico = None
        for h in horas_estimativas:
            if h['hora'] >= hora_atual and h['estimado'] >= ordenados[0]['estimado'] * 0.85:
                proximo_pico = h
                break

        cursor.close()
        release_connection(conn)

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
        current_app.logger.error(
            f'Erro ao buscar picos de hoje: {e}', exc_info=True
        )
        if conn:
            release_connection(conn)
        return jsonify({'success': False, 'error': 'Erro ao calcular picos'}), 500

# =============================================================================
# API - INTERNACOES (Previsoes, Metricas, Modelos, Historico)
# =============================================================================

@painel31_bp.route('/api/paineis/painel31/previsoes/internacoes', methods=['GET'])
@login_required
def api_painel31_previsoes_internacoes():
    from flask import request
    usuario_id = session.get('usuario_id')
    is_admin = session.get('is_admin', False)

    if not is_admin and not verificar_permissao_painel(usuario_id, 'painel31'):
        return jsonify({'success': False, 'error': 'Sem permissao'}), 403

    dias = request.args.get('dias', 30, type=int)

    conn = get_db_connection()
    if not conn:
        return jsonify({'success': False, 'error': 'Erro de conexao'}), 500

    try:
        cursor = conn.cursor(cursor_factory=RealDictCursor)

        # Previsoes futuras
        cursor.execute("""
            SELECT DISTINCT ON (dt_alvo, segmento)
                dt_alvo, horizonte_dias, segmento,
                valor_previsto, intervalo_inferior, intervalo_superior,
                dt_geracao
            FROM ml_internacoes_predicoes
            WHERE dt_alvo >= CURRENT_DATE
            ORDER BY dt_alvo, segmento, horizonte_dias ASC
        """)
        futuras = cursor.fetchall()

        # Historico realizado
        cursor.execute("""
            SELECT DISTINCT ON (dt_alvo, segmento)
                dt_alvo, horizonte_dias, segmento,
                valor_previsto, valor_realizado,
                erro_absoluto, erro_percentual,
                intervalo_inferior, intervalo_superior
            FROM ml_internacoes_predicoes
            WHERE valor_realizado IS NOT NULL
              AND dt_alvo >= CURRENT_DATE - %s * INTERVAL '1 day'
            ORDER BY dt_alvo DESC, segmento, horizonte_dias ASC
        """, (dias,))
        historico = cursor.fetchall()

        def serializar(rows):
            resultado = []
            for r in rows:
                d = dict(r)
                if d.get('dt_alvo'): d['dt_alvo'] = d['dt_alvo'].isoformat()
                if d.get('dt_geracao'): d['dt_geracao'] = d['dt_geracao'].isoformat()
                for k in ['valor_previsto', 'valor_realizado', 'intervalo_inferior', 'intervalo_superior', 'erro_absoluto', 'erro_percentual']:
                    if d.get(k) is not None: d[k] = float(d[k])
                resultado.append(d)
            return resultado

        cursor.close()
        release_connection(conn)

        return jsonify({
            'success': True,
            'previsoes_futuras': serializar(futuras),
            'historico_realizado': serializar(list(reversed(historico))),
            'timestamp': datetime.now().isoformat()
        })

    except Exception as e:
        current_app.logger.error(f'Erro ao buscar previsoes de internacoes: {e}', exc_info=True)
        if conn: release_connection(conn)
        return jsonify({'success': False, 'error': 'Erro ao buscar previsoes'}), 500


@painel31_bp.route('/api/paineis/painel31/historico-real/internacoes', methods=['GET'])
@login_required
def api_painel31_historico_real_internacoes():
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
            SELECT
                DATE(i.dt_entrada) AS data,
                COUNT(*)::int AS total,
                SUM(CASE WHEN m.categoria_setor = 'UTI' THEN 1 ELSE 0 END)::int AS uti,
                SUM(CASE WHEN m.categoria_setor = 'INTERNACAO' THEN 1 ELSE 0 END)::int AS enfermaria
            FROM ml_internacoes i
            LEFT JOIN ml_faturamento_setor_mapping m ON i.cd_setor_atendimento = m.cd_setor
            WHERE i.dt_entrada >= CURRENT_DATE - INTERVAL '14 days'
              AND i.dt_entrada < CURRENT_DATE
            GROUP BY DATE(i.dt_entrada)
            ORDER BY data
        """)
        rows = cursor.fetchall()

        historico = []
        for r in rows:
            historico.append({
                'data': r['data'].isoformat(),
                'total': r['total'],
                'uti': r['uti'],
                'enfermaria': r['enfermaria']
            })

        cursor.close()
        release_connection(conn)

        return jsonify({'success': True, 'historico': historico})
    except Exception as e:
        current_app.logger.error(f'Erro ao buscar historico real de internacoes: {e}', exc_info=True)
        if conn: release_connection(conn)
        return jsonify({'success': False, 'error': 'Erro ao buscar historico'}), 500


@painel31_bp.route('/api/paineis/painel31/modelo/internacoes', methods=['GET'])
@login_required
def api_painel31_modelo_internacoes():
    usuario_id = session.get('usuario_id')
    is_admin = session.get('is_admin', False)

    if not is_admin and not verificar_permissao_painel(usuario_id, 'painel31'):
        return jsonify({'success': False, 'error': 'Sem permissao'}), 403

    conn = get_db_connection()
    if not conn:
        return jsonify({'success': False, 'error': 'Erro de conexao'}), 500

    try:
        cursor = conn.cursor(cursor_factory=RealDictCursor)

        def fetch_model(nome):
            cursor.execute("SELECT * FROM ml_modelos_registry WHERE nome_modelo = %s AND ie_ativo = TRUE ORDER BY dt_criacao DESC LIMIT 1", (nome,))
            mod = cursor.fetchone()
            if mod:
                m = dict(mod)
                for k in ['mae_teste', 'mape_teste', 'rmse_teste']:
                    if m.get(k) is not None: m[k] = float(m[k])
                for k in ['dt_treino', 'dt_criacao', 'periodo_treino_inicio', 'periodo_treino_fim']:
                    if m.get(k): m[k] = m[k].isoformat()
                return m
            return None

        modelos = {
            'total': fetch_model('intern_total_v1'),
            'uti': fetch_model('intern_uti_v1'),
            'enfermaria': fetch_model('intern_enf_v1')
        }

        cursor.close()
        release_connection(conn)
        return jsonify({'success': True, 'modelos': modelos})
    except Exception as e:
        current_app.logger.error(f'Erro ao buscar modelos de internacoes: {e}', exc_info=True)
        if conn: release_connection(conn)
        return jsonify({'success': False, 'error': 'Erro ao buscar modelos'}), 500


@painel31_bp.route('/api/paineis/painel31/metricas/internacoes', methods=['GET'])
@login_required
def api_painel31_metricas_internacoes():
    usuario_id = session.get('usuario_id')
    is_admin = session.get('is_admin', False)

    if not is_admin and not verificar_permissao_painel(usuario_id, 'painel31'):
        return jsonify({'success': False, 'error': 'Sem permissao'}), 403

    conn = get_db_connection()
    if not conn:
        return jsonify({'success': False, 'error': 'Erro de conexao'}), 500

    try:
        cursor = conn.cursor(cursor_factory=RealDictCursor)

        def fetch_mae(nome):
            cursor.execute("SELECT mae_teste, mape_teste FROM ml_modelos_registry WHERE nome_modelo = %s AND ie_ativo = TRUE ORDER BY dt_criacao DESC LIMIT 1", (nome,))
            res = cursor.fetchone()
            if res:
                return {'mae': float(res['mae_teste']) if res['mae_teste'] else None, 'mape': float(res['mape_teste']) if res['mape_teste'] else None}
            return None

        metricas_treino = {
            'total': fetch_mae('intern_total_v1'),
            'uti': fetch_mae('intern_uti_v1'),
            'enfermaria': fetch_mae('intern_enf_v1')
        }

        cursor.close()
        release_connection(conn)
        return jsonify({'success': True, 'metricas_treino': metricas_treino})
    except Exception as e:
        current_app.logger.error(f'Erro ao buscar metricas de internacoes: {e}', exc_info=True)
        if conn: release_connection(conn)
        return jsonify({'success': False, 'error': 'Erro ao buscar metricas'}), 500

# =============================================================================
# API - COMPARATIVO PREVISTO vs REALIZADO (PS VOLUME)
# =============================================================================

# =============================================================================
# API - COMPARATIVO PREVISTO vs REALIZADO (PS VOLUME)
# =============================================================================

@painel31_bp.route('/api/paineis/painel31/comparativo/<nome_modelo>', methods=['GET'])
@login_required
def api_painel31_comparativo(nome_modelo):
    from flask import request

    usuario_id = session.get('usuario_id')
    is_admin = session.get('is_admin', False)

    if not is_admin:
        if not verificar_permissao_painel(usuario_id, 'painel31'):
            return jsonify({'success': False, 'error': 'Sem permissao'}), 403

    dias = request.args.get('dias', 30, type=int)

    conn = get_db_connection()
    if not conn:
        return jsonify({'success': False, 'error': 'Erro de conexao'}), 500

    try:
        cursor = conn.cursor(cursor_factory=RealDictCursor)
        modelo = _buscar_modelo_por_nome(cursor, nome_modelo)

        if not modelo:
            cursor.close()
            release_connection(conn)
            return jsonify({'success': False, 'error': 'Modelo nao encontrado'}), 404

        modelo_id = modelo['id']
        janela = dias + 7

        # Realizado (direto da tabela de chegadas)
        cursor.execute("""
            SELECT
                DATE(dt_entrada) AS dt,
                COUNT(*) AS realizado
            FROM ml_ps_historico_chegadas
            WHERE dt_entrada >= CURRENT_DATE - %s * INTERVAL '1 day'
            GROUP BY DATE(dt_entrada)
            ORDER BY dt
        """, (janela,))
        rows_real = cursor.fetchall()
        real_por_dia = {}
        for r in rows_real:
            real_por_dia[r['dt'].isoformat()] = int(r['realizado'])

        # Previsoes (historico + futuro)
        cursor.execute("""
            SELECT DISTINCT ON (dt_alvo)
                dt_alvo, valor_previsto,
                intervalo_inferior, intervalo_superior
            FROM ml_ps_predicoes
            WHERE modelo_id = %s
              AND dt_alvo >= CURRENT_DATE - %s * INTERVAL '1 day'
            ORDER BY dt_alvo, horizonte_dias ASC
        """, (modelo_id, janela))
        rows_pred = cursor.fetchall()
        pred_por_dia = {}
        for p in rows_pred:
            pred_por_dia[p['dt_alvo'].isoformat()] = {
                'previsto': float(p['valor_previsto']) if p['valor_previsto'] else None,
                'inferior': float(p['intervalo_inferior']) if p['intervalo_inferior'] else None,
                'superior': float(p['intervalo_superior']) if p['intervalo_superior'] else None,
            }

        cursor.close()
        release_connection(conn)

        # Monta serie unificada
        from datetime import date
        hoje = date.today()
        inicio = hoje - timedelta(days=dias)
        fim = hoje + timedelta(days=7)

        comparativo = []
        d = inicio
        while d <= fim:
            d_str = d.isoformat()
            real = real_por_dia.get(d_str)
            pred = pred_por_dia.get(d_str, {})
            previsto = pred.get('previsto')
            inferior = pred.get('inferior')
            superior = pred.get('superior')

            if d >= hoje and previsto is not None and real is None:
                status = 'futuro'
                acerto_pct = None
            elif real is not None and previsto is not None and real > 0:
                erro_pct = abs(previsto - real) / real * 100
                acerto_pct = round(max(0, 100 - erro_pct), 1)
                if acerto_pct >= 90:
                    status = 'verde'
                elif acerto_pct >= 75:
                    status = 'amarelo'
                else:
                    status = 'vermelho'
            else:
                status = 'sem_previsao'
                acerto_pct = None

            comparativo.append({
                'dt': d_str,
                'realizado': real,
                'previsto': round(previsto, 1) if previsto else None,
                'inferior': round(inferior, 1) if inferior else None,
                'superior': round(superior, 1) if superior else None,
                'acerto_pct': acerto_pct,
                'status_acerto': status,
            })
            d += timedelta(days=1)

        return jsonify({
            'success': True,
            'modelo': nome_modelo,
            'comparativo': comparativo,
            'dias': dias,
            'timestamp': datetime.now().isoformat()
        })

    except Exception as e:
        current_app.logger.error(
            f'Erro ao buscar comparativo de {nome_modelo}: {e}', exc_info=True
        )
        if conn:
            release_connection(conn)
        return jsonify({'success': False, 'error': 'Erro ao buscar comparativo'}), 500