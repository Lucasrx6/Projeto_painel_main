# ============================================================
# PAINEL 28 - HUB CENTRALIZADOR + FORMULÁRIO SENTIR E AGIR
# Hospital Anchieta Ceilândia
# V2 - Com fila de pacientes, itens sim/nao, campos expandidos
# ============================================================

import os
import uuid
import threading
import traceback
from datetime import datetime, date
from flask import Blueprint, request, jsonify, send_from_directory, session
from psycopg2.extras import RealDictCursor
from backend.database import get_db_connection
from backend.middleware.decorators import login_required
from backend.user_management import verificar_permissao_painel

painel28_bp = Blueprint(
    'painel28',
    __name__,
    url_prefix='/api/paineis/painel28'
)

# ----------------------------------------------------------
# LOCK EM MEMORIA: pacientes sendo visitados no momento
# Chave: str(nr_atendimento), Valor: {dupla_id, ts}
# TTL de 30 min — expira automaticamente
# ----------------------------------------------------------
_visita_lock = threading.Lock()
_em_visita: dict = {}
_EM_VISITA_TTL_SEG = 600  # 10 minutos


def _limpar_expirados():
    agora = datetime.now()
    with _visita_lock:
        expirados = [k for k, v in _em_visita.items()
                     if (agora - v['ts']).total_seconds() > _EM_VISITA_TTL_SEG]
        for k in expirados:
            del _em_visita[k]


def _get_em_visita_agora() -> set:
    _limpar_expirados()
    with _visita_lock:
        return set(_em_visita.keys())


def _get_em_visita_agora_dict() -> dict:
    _limpar_expirados()
    with _visita_lock:
        return dict(_em_visita)


PAINEL_DIR = os.path.join(os.path.dirname(__file__))


# ============================================================
# HELPERS
# ============================================================

def _get_config(cursor, chave, default=None):
    cursor.execute("SELECT valor FROM sentir_agir_config WHERE chave = %s", (chave,))
    row = cursor.fetchone()
    return row['valor'] if row else default


def _registrar_log(cursor, entidade, entidade_id, acao, usuario,
                   campo_alterado=None, valor_anterior=None, valor_novo=None,
                   ip_origem=None):
    cursor.execute("""
        INSERT INTO sentir_agir_log
            (entidade, entidade_id, acao, campo_alterado,
             valor_anterior, valor_novo, usuario, ip_origem)
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
    """, (entidade, entidade_id, acao, campo_alterado,
          valor_anterior, valor_novo, usuario, ip_origem))


def _get_ip():
    return request.headers.get('X-Forwarded-For', request.remote_addr)


def _get_usuario():
    return session.get('usuario', 'sistema')


def _is_admin():
    return session.get('is_admin', False)


def _encontrar_responsavel_auto(cursor, categoria_id, setor_id):
    """
    Encontra o responsavel ativo mais adequado para uma tratativa.
    Prioridade:
    1. Vinculado a categoria E setor (match exato)
    2. Vinculado a categoria sem restricao de setor (responsavel geral)
    3. Vinculado a categoria (qualquer setor)
    4. Fallback: vinculado apenas ao setor
    """
    # 1. Match exato: categoria + setor
    cursor.execute("""
        SELECT r.id FROM sentir_agir_responsaveis r
        JOIN sentir_agir_responsavel_categorias rc ON rc.responsavel_id = r.id
        JOIN sentir_agir_responsavel_setores rs ON rs.responsavel_id = r.id
        WHERE rc.categoria_id = %s AND rs.setor_id = %s AND r.ativo = TRUE
        ORDER BY r.nome LIMIT 1
    """, (categoria_id, setor_id))
    resp = cursor.fetchone()
    if resp:
        return resp['id']

    # 2. Categoria sem restricao de setor (responsavel geral da categoria)
    cursor.execute("""
        SELECT r.id FROM sentir_agir_responsaveis r
        JOIN sentir_agir_responsavel_categorias rc ON rc.responsavel_id = r.id
        WHERE rc.categoria_id = %s AND r.ativo = TRUE
          AND NOT EXISTS (
              SELECT 1 FROM sentir_agir_responsavel_setores rs2
              WHERE rs2.responsavel_id = r.id
          )
        ORDER BY r.nome LIMIT 1
    """, (categoria_id,))
    resp = cursor.fetchone()
    if resp:
        return resp['id']

    # 3. Qualquer responsavel da categoria
    cursor.execute("""
        SELECT r.id FROM sentir_agir_responsaveis r
        JOIN sentir_agir_responsavel_categorias rc ON rc.responsavel_id = r.id
        WHERE rc.categoria_id = %s AND r.ativo = TRUE
        ORDER BY r.nome LIMIT 1
    """, (categoria_id,))
    resp = cursor.fetchone()
    if resp:
        return resp['id']

    # 4. Fallback: responsavel do setor
    cursor.execute("""
        SELECT r.id FROM sentir_agir_responsaveis r
        JOIN sentir_agir_responsavel_setores rs ON rs.responsavel_id = r.id
        WHERE rs.setor_id = %s AND r.ativo = TRUE
        ORDER BY r.nome LIMIT 1
    """, (setor_id,))
    resp = cursor.fetchone()
    return resp['id'] if resp else None


def _auto_finalizar_rondas_expiradas(cursor):
    """Finaliza automaticamente rondas em_andamento com mais de 10 minutos de inatividade."""
    cursor.execute("""
        UPDATE sentir_agir_rondas
        SET status = 'concluida', atualizado_em = NOW()
        WHERE status = 'em_andamento'
          AND atualizado_em < NOW() - INTERVAL '10 minutes'
    """)


# ============================================================
# ROTAS DE ARQUIVOS ESTÁTICOS (HTML, CSS, JS)
# ============================================================

@painel28_bp.route('/index', endpoint='index_html', methods=['GET'])
@login_required
def servir_hub():
    if not verificar_permissao_painel(session.get('usuario_id'), 'painel28'):
        return jsonify({'error': 'Sem permissao para este painel'}), 403
    return send_from_directory(PAINEL_DIR, 'index.html')


@painel28_bp.route('/formulario', endpoint='formulario_html', methods=['GET'])
@login_required
def servir_formulario():
    if not verificar_permissao_painel(session.get('usuario_id'), 'painel28'):
        return jsonify({'error': 'Sem permissao para este painel'}), 403
    return send_from_directory(PAINEL_DIR, 'formulario.html')


@painel28_bp.route('/style_hub.css', endpoint='style_hub_css', methods=['GET'])
def servir_style_hub():
    return send_from_directory(PAINEL_DIR, 'style_hub.css')


@painel28_bp.route('/style_form.css', endpoint='style_form_css', methods=['GET'])
def servir_style_form():
    return send_from_directory(PAINEL_DIR, 'style_form.css')


@painel28_bp.route('/main_hub.js', endpoint='main_hub_js', methods=['GET'])
def servir_main_hub():
    return send_from_directory(PAINEL_DIR, 'main_hub.js')


@painel28_bp.route('/main_form.js', endpoint='main_form_js', methods=['GET'])
def servir_main_form():
    return send_from_directory(PAINEL_DIR, 'main_form.js')


# ============================================================
# API: HUB - SERVIÇOS
# ============================================================

@painel28_bp.route('/servicos', methods=['GET'])
@login_required
def listar_servicos():
    try:
        conn = get_db_connection()
        cursor = conn.cursor(cursor_factory=RealDictCursor)
        cursor.execute("""
            SELECT id, nome, descricao, icone, cor, url_destino, tipo, ordem
            FROM hub_servicos WHERE ativo = TRUE ORDER BY ordem, nome
        """)
        servicos = cursor.fetchall()
        cursor.close()
        conn.close()
        return jsonify({'success': True, 'data': servicos})
    except Exception as e:
        traceback.print_exc()
        return jsonify({'success': False, 'error': str(e)}), 500


# ============================================================
# API: DUPLAS - CRUD
# ============================================================

@painel28_bp.route('/duplas', methods=['GET'])
@login_required
def listar_duplas():
    try:
        conn = get_db_connection()
        cursor = conn.cursor(cursor_factory=RealDictCursor)
        todas = request.args.get('todas', '0')
        if todas == '1':
            cursor.execute("""
                SELECT id, nome_visitante_1, nome_visitante_2, ordem, ativo
                FROM sentir_agir_duplas ORDER BY ordem, nome_visitante_1
            """)
        else:
            cursor.execute("""
                SELECT id, nome_visitante_1, nome_visitante_2, ordem
                FROM sentir_agir_duplas WHERE ativo = TRUE ORDER BY ordem, nome_visitante_1
            """)
        duplas = cursor.fetchall()
        cursor.close()
        conn.close()
        return jsonify({'success': True, 'data': duplas})
    except Exception as e:
        traceback.print_exc()
        return jsonify({'success': False, 'error': str(e)}), 500


@painel28_bp.route('/duplas', methods=['POST'])
@login_required
def criar_dupla():
    try:
        dados = request.get_json()
        if not dados:
            return jsonify({'success': False, 'error': 'Dados nao fornecidos'}), 400
        nome1 = (dados.get('nome_visitante_1') or '').strip()
        nome2 = (dados.get('nome_visitante_2') or '').strip()
        if not nome1 or not nome2:
            return jsonify({'success': False, 'error': 'Informe os dois nomes'}), 400
        usuario = _get_usuario()
        ip = _get_ip()
        conn = get_db_connection()
        cursor = conn.cursor(cursor_factory=RealDictCursor)
        cursor.execute("SELECT COALESCE(MAX(ordem), 0) + 1 AS prox FROM sentir_agir_duplas")
        prox_ordem = cursor.fetchone()['prox']
        cursor.execute("""
            INSERT INTO sentir_agir_duplas (nome_visitante_1, nome_visitante_2, ordem, ativo)
            VALUES (%s, %s, %s, TRUE) RETURNING id
        """, (nome1, nome2, prox_ordem))
        dupla_id = cursor.fetchone()['id']
        _registrar_log(cursor, 'dupla', dupla_id, 'criacao', usuario, ip_origem=ip)
        conn.commit()
        cursor.close()
        conn.close()
        return jsonify({'success': True, 'data': {'id': dupla_id}, 'message': 'Dupla criada'}), 201
    except Exception as e:
        traceback.print_exc()
        return jsonify({'success': False, 'error': str(e)}), 500


@painel28_bp.route('/duplas/<int:dupla_id>', methods=['PUT'])
@login_required
def editar_dupla(dupla_id):
    try:
        dados = request.get_json()
        if not dados:
            return jsonify({'success': False, 'error': 'Dados nao fornecidos'}), 400
        nome1 = (dados.get('nome_visitante_1') or '').strip()
        nome2 = (dados.get('nome_visitante_2') or '').strip()
        if not nome1 or not nome2:
            return jsonify({'success': False, 'error': 'Informe os dois nomes'}), 400
        usuario = _get_usuario()
        ip = _get_ip()
        conn = get_db_connection()
        cursor = conn.cursor(cursor_factory=RealDictCursor)
        cursor.execute("SELECT id, nome_visitante_1, nome_visitante_2 FROM sentir_agir_duplas WHERE id = %s",
                       (dupla_id,))
        dupla = cursor.fetchone()
        if not dupla:
            cursor.close()
            conn.close()
            return jsonify({'success': False, 'error': 'Dupla nao encontrada'}), 404
        cursor.execute("""
            UPDATE sentir_agir_duplas SET nome_visitante_1 = %s, nome_visitante_2 = %s, atualizado_em = NOW() WHERE id = %s
        """, (nome1, nome2, dupla_id))
        _registrar_log(cursor, 'dupla', dupla_id, 'edicao', usuario,
                       campo_alterado='nomes',
                       valor_anterior=dupla['nome_visitante_1'] + ' e ' + dupla['nome_visitante_2'],
                       valor_novo=nome1 + ' e ' + nome2, ip_origem=ip)
        conn.commit()
        cursor.close()
        conn.close()
        return jsonify({'success': True, 'message': 'Dupla atualizada'})
    except Exception as e:
        traceback.print_exc()
        return jsonify({'success': False, 'error': str(e)}), 500


@painel28_bp.route('/duplas/<int:dupla_id>/toggle', methods=['PUT'])
@login_required
def toggle_dupla(dupla_id):
    try:
        usuario = _get_usuario()
        ip = _get_ip()
        conn = get_db_connection()
        cursor = conn.cursor(cursor_factory=RealDictCursor)
        cursor.execute("SELECT id, ativo FROM sentir_agir_duplas WHERE id = %s", (dupla_id,))
        dupla = cursor.fetchone()
        if not dupla:
            cursor.close()
            conn.close()
            return jsonify({'success': False, 'error': 'Dupla nao encontrada'}), 404
        novo_status = not dupla['ativo']
        cursor.execute("UPDATE sentir_agir_duplas SET ativo = %s, atualizado_em = NOW() WHERE id = %s",
                       (novo_status, dupla_id))
        _registrar_log(cursor, 'dupla', dupla_id, 'alteracao_status', usuario,
                       campo_alterado='ativo', valor_anterior=str(dupla['ativo']),
                       valor_novo=str(novo_status), ip_origem=ip)
        conn.commit()
        cursor.close()
        conn.close()
        return jsonify({'success': True, 'message': 'Dupla ativada' if novo_status else 'Dupla desativada'})
    except Exception as e:
        traceback.print_exc()
        return jsonify({'success': False, 'error': str(e)}), 500


# ============================================================
# API: SETORES
# ============================================================

@painel28_bp.route('/setores', methods=['GET'])
@login_required
def listar_setores():
    try:
        conn = get_db_connection()
        cursor = conn.cursor(cursor_factory=RealDictCursor)
        cursor.execute("""
            SELECT id, nome, sigla, icone, ordem
            FROM sentir_agir_setores WHERE ativo = TRUE ORDER BY ordem, nome
        """)
        setores = cursor.fetchall()
        cursor.close()
        conn.close()
        return jsonify({'success': True, 'data': setores})
    except Exception as e:
        traceback.print_exc()
        return jsonify({'success': False, 'error': str(e)}), 500


# ============================================================
# API: CATEGORIAS E ITENS (com tipo semaforo/sim_nao)
# ============================================================

@painel28_bp.route('/categorias-itens', methods=['GET'])
@login_required
def listar_categorias_itens():
    try:
        conn = get_db_connection()
        cursor = conn.cursor(cursor_factory=RealDictCursor)
        cursor.execute("""
            SELECT id, nome, icone, cor, ordem, permite_nao_aplica
            FROM sentir_agir_categorias WHERE ativo = TRUE ORDER BY ordem
        """)
        categorias = cursor.fetchall()
        cursor.execute("""
            SELECT id, categoria_id, descricao, ordem,
                   COALESCE(tipo, 'semaforo') AS tipo,
                   COALESCE(critico_quando, 'nao') AS critico_quando,
                   COALESCE(permite_nao_aplica, FALSE) AS permite_nao_aplica
            FROM sentir_agir_itens WHERE ativo = TRUE ORDER BY ordem
        """)
        itens = cursor.fetchall()
        cursor.close()
        conn.close()

        itens_por_categoria = {}
        for item in itens:
            cat_id = item['categoria_id']
            if cat_id not in itens_por_categoria:
                itens_por_categoria[cat_id] = []
            itens_por_categoria[cat_id].append({
                'id': item['id'],
                'descricao': item['descricao'],
                'ordem': item['ordem'],
                'tipo': item['tipo'],
                'critico_quando': item['critico_quando'],
                'permite_nao_aplica': item['permite_nao_aplica']
            })

        resultado = []
        for cat in categorias:
            resultado.append({
                'id': cat['id'],
                'nome': cat['nome'],
                'icone': cat['icone'],
                'cor': cat['cor'],
                'ordem': cat['ordem'],
                'permite_nao_aplica': cat['permite_nao_aplica'],
                'itens': itens_por_categoria.get(cat['id'], [])
            })
        return jsonify({'success': True, 'data': resultado})
    except Exception as e:
        traceback.print_exc()
        return jsonify({'success': False, 'error': str(e)}), 500


# ============================================================
# API: CONFIG
# ============================================================

@painel28_bp.route('/config', methods=['GET'])
@login_required
def obter_config():
    try:
        conn = get_db_connection()
        cursor = conn.cursor(cursor_factory=RealDictCursor)
        cursor.execute("SELECT chave, valor FROM sentir_agir_config")
        rows = cursor.fetchall()
        cursor.close()
        conn.close()
        config = {}
        for row in rows:
            config[row['chave']] = row['valor']
        return jsonify({'success': True, 'data': config})
    except Exception as e:
        traceback.print_exc()
        return jsonify({'success': False, 'error': str(e)}), 500


# ============================================================
# API: FILA DE PACIENTES (integração com ocupação hospitalar)
# ============================================================

@painel28_bp.route('/fila-pacientes', methods=['GET'])
@login_required
def fila_pacientes():
    try:
        limite = request.args.get('limite', '20')
        try:
            limite = int(limite)
            if limite < 1 or limite > 100:
                limite = 20
        except (ValueError, TypeError):
            limite = 20

        conn = get_db_connection()
        cursor = conn.cursor(cursor_factory=RealDictCursor)

        # Finaliza rondas esquecidas antes de calcular a fila
        _auto_finalizar_rondas_expiradas(cursor)
        conn.commit()

        cursor.execute("""
            SELECT f.nr_atendimento, f.nm_paciente, f.leito, f.setor_ocupacao,
                   f.cd_setor_atendimento, f.setor_sa_id, f.setor_sa_nome, f.setor_sa_sigla,
                   f.dt_entrada_unidade, f.qt_dia_permanencia, f.ds_clinica,
                   f.medico_responsavel, f.ds_convenio, f.ds_tipo_acomodacao,
                   f.ultima_ronda_em, f.horas_desde_ultima_ronda, f.prioridade,
                   EXISTS (
                       SELECT 1 FROM sentir_agir_visitas v
                       WHERE v.nr_atendimento = f.nr_atendimento
                         AND v.avaliacao_final != 'impossibilitada'
                         AND v.criado_em >= CURRENT_DATE
                   ) AS ja_visitado_hoje,
                   (
                       SELECT EXTRACT(EPOCH FROM (NOW() - v.criado_em)) / 3600
                       FROM sentir_agir_visitas v
                       WHERE v.nr_atendimento = f.nr_atendimento
                         AND v.avaliacao_final != 'impossibilitada'
                         AND v.criado_em >= CURRENT_DATE
                       ORDER BY v.criado_em DESC LIMIT 1
                   ) AS horas_desde_visita_hoje,
                   (
                       SELECT d2.nome_visitante_1 || ' e ' || d2.nome_visitante_2
                       FROM sentir_agir_visitas v2
                       JOIN sentir_agir_rondas r2 ON r2.id = v2.ronda_id
                       JOIN sentir_agir_duplas d2 ON d2.id = r2.dupla_id
                       WHERE v2.nr_atendimento = f.nr_atendimento
                         AND r2.status = 'em_andamento'
                         AND v2.criado_em >= CURRENT_DATE
                       ORDER BY v2.criado_em DESC LIMIT 1
                   ) AS dupla_em_visita,
                   (
                       SELECT d2.id
                       FROM sentir_agir_visitas v2
                       JOIN sentir_agir_rondas r2 ON r2.id = v2.ronda_id
                       JOIN sentir_agir_duplas d2 ON d2.id = r2.dupla_id
                       WHERE v2.nr_atendimento = f.nr_atendimento
                         AND r2.status = 'em_andamento'
                         AND v2.criado_em >= CURRENT_DATE
                       ORDER BY v2.criado_em DESC LIMIT 1
                   ) AS dupla_id_em_visita
            FROM vw_sentir_agir_fila_pacientes f
            WHERE COALESCE(f.setor_ocupacao, '') NOT ILIKE '%%UTI Neo%%'
              AND COALESCE(f.setor_ocupacao, '') NOT ILIKE '%%UTI-NP%%'
              AND COALESCE(f.setor_ocupacao, '') NOT ILIKE '%%UTI Ped%%'
              AND COALESCE(f.ds_clinica, '') NOT ILIKE '%%UTI Neo%%'
              AND COALESCE(f.ds_clinica, '') NOT ILIKE '%%UTI-NP%%'
              AND COALESCE(f.ds_clinica, '') NOT ILIKE '%%UTI Ped%%'
              AND NOT EXISTS (
                  SELECT 1 FROM sentir_agir_precaucao_contato pc
                  WHERE pc.nr_atendimento = CAST(f.nr_atendimento AS VARCHAR)
              )
            ORDER BY
                CASE
                    WHEN EXISTS (
                        SELECT 1 FROM sentir_agir_visitas v
                        WHERE v.nr_atendimento = f.nr_atendimento
                          AND v.avaliacao_final NOT IN ('impossibilitada')
                          AND v.criado_em >= CURRENT_DATE
                    ) THEN 2
                    WHEN EXISTS (
                        SELECT 1 FROM sentir_agir_visitas v
                        WHERE v.nr_atendimento = f.nr_atendimento
                          AND v.avaliacao_final = 'impossibilitada'
                          AND v.criado_em >= CURRENT_DATE
                    ) THEN 1
                    ELSE 0
                END ASC,
                COALESCE(f.horas_desde_ultima_ronda, EXTRACT(EPOCH FROM (NOW() - f.dt_entrada_unidade))/3600) DESC
            LIMIT %s
        """, (limite,))
        pacientes = cursor.fetchall()
        cursor.close()
        conn.close()

        resultado = []
        for pac in pacientes:
            item = dict(pac)
            for campo in ('dt_entrada_unidade', 'ultima_ronda_em'):
                if item.get(campo):
                    item[campo] = item[campo].isoformat()
            if item.get('horas_desde_ultima_ronda') is not None:
                item['horas_desde_ultima_ronda'] = round(float(item['horas_desde_ultima_ronda']), 1)
            if item.get('horas_desde_visita_hoje') is not None:
                item['horas_desde_visita_hoje'] = round(float(item['horas_desde_visita_hoje']), 1)
            if item.get('qt_dia_permanencia') is not None:
                item['qt_dia_permanencia'] = int(item['qt_dia_permanencia'])
            resultado.append(item)

        # Obter pacientes sendo visitados neste exato momento (lock em memoria)
        em_visita_dict = _get_em_visita_agora_dict()
        for p in resultado:
            nr = str(p['nr_atendimento'])
            if nr in em_visita_dict:
                # Sobrescrever o dupla_em_visita (que era do SQL) com a informação mais recente da RAM
                p['dupla_em_visita'] = em_visita_dict[nr].get('nome_dupla', 'Dupla em visita')
                p['dupla_id_em_visita'] = em_visita_dict[nr].get('dupla_id')

        return jsonify({'success': True, 'data': resultado, 'total': len(resultado)})
    except Exception as e:
        traceback.print_exc()
        return jsonify({'success': False, 'error': str(e)}), 500


@painel28_bp.route('/proximo-paciente', methods=['GET'])
@login_required
def proximo_paciente():
    try:
        conn = get_db_connection()
        cursor = conn.cursor(cursor_factory=RealDictCursor)

        # Finaliza rondas esquecidas antes de calcular a fila
        _auto_finalizar_rondas_expiradas(cursor)
        conn.commit()

        cursor.execute("""
            SELECT f.nr_atendimento, f.nm_paciente, f.leito, f.setor_ocupacao,
                   f.cd_setor_atendimento, f.setor_sa_id, f.setor_sa_nome, f.setor_sa_sigla,
                   f.dt_entrada_unidade, f.qt_dia_permanencia, f.ds_clinica,
                   f.medico_responsavel, f.ds_convenio, f.ds_tipo_acomodacao,
                   f.ultima_ronda_em, f.horas_desde_ultima_ronda, f.prioridade,
                   EXISTS (
                       SELECT 1 FROM sentir_agir_visitas v
                       WHERE v.nr_atendimento = f.nr_atendimento
                         AND v.avaliacao_final != 'impossibilitada'
                         AND v.criado_em >= CURRENT_DATE
                   ) AS ja_visitado_hoje,
                   (
                       SELECT EXTRACT(EPOCH FROM (NOW() - v.criado_em)) / 3600
                       FROM sentir_agir_visitas v
                       WHERE v.nr_atendimento = f.nr_atendimento
                         AND v.avaliacao_final != 'impossibilitada'
                         AND v.criado_em >= CURRENT_DATE
                       ORDER BY v.criado_em DESC LIMIT 1
                   ) AS horas_desde_visita_hoje,
                   (
                       SELECT d2.nome_visitante_1 || ' e ' || d2.nome_visitante_2
                       FROM sentir_agir_visitas v2
                       JOIN sentir_agir_rondas r2 ON r2.id = v2.ronda_id
                       JOIN sentir_agir_duplas d2 ON d2.id = r2.dupla_id
                       WHERE v2.nr_atendimento = f.nr_atendimento
                         AND r2.status = 'em_andamento'
                         AND v2.criado_em >= CURRENT_DATE
                       ORDER BY v2.criado_em DESC LIMIT 1
                   ) AS dupla_em_visita,
                   (
                       SELECT d2.id
                       FROM sentir_agir_visitas v2
                       JOIN sentir_agir_rondas r2 ON r2.id = v2.ronda_id
                       JOIN sentir_agir_duplas d2 ON d2.id = r2.dupla_id
                       WHERE v2.nr_atendimento = f.nr_atendimento
                         AND r2.status = 'em_andamento'
                         AND v2.criado_em >= CURRENT_DATE
                       ORDER BY v2.criado_em DESC LIMIT 1
                   ) AS dupla_id_em_visita
            FROM vw_sentir_agir_fila_pacientes f
            WHERE COALESCE(f.setor_ocupacao, '') NOT ILIKE '%%UTI Neo%%'
              AND COALESCE(f.setor_ocupacao, '') NOT ILIKE '%%UTI-NP%%'
              AND COALESCE(f.setor_ocupacao, '') NOT ILIKE '%%UTI Ped%%'
              AND COALESCE(f.ds_clinica, '') NOT ILIKE '%%UTI Neo%%'
              AND COALESCE(f.ds_clinica, '') NOT ILIKE '%%UTI-NP%%'
              AND COALESCE(f.ds_clinica, '') NOT ILIKE '%%UTI Ped%%'
              AND NOT EXISTS (
                  SELECT 1 FROM sentir_agir_precaucao_contato pc
                  WHERE pc.nr_atendimento = CAST(f.nr_atendimento AS VARCHAR)
              )
            ORDER BY
                CASE
                    WHEN EXISTS (
                        SELECT 1 FROM sentir_agir_visitas v
                        WHERE v.nr_atendimento = f.nr_atendimento
                          AND v.avaliacao_final NOT IN ('impossibilitada')
                          AND v.criado_em >= CURRENT_DATE
                    ) THEN 2
                    WHEN EXISTS (
                        SELECT 1 FROM sentir_agir_visitas v
                        WHERE v.nr_atendimento = f.nr_atendimento
                          AND v.avaliacao_final = 'impossibilitada'
                          AND v.criado_em >= CURRENT_DATE
                    ) THEN 1
                    ELSE 0
                END ASC,
                COALESCE(f.horas_desde_ultima_ronda, EXTRACT(EPOCH FROM (NOW() - f.dt_entrada_unidade))/3600) DESC
            LIMIT 1
        """)
        paciente = cursor.fetchone()
        cursor.close()
        conn.close()

        if not paciente:
            return jsonify({'success': True, 'data': None, 'message': 'Nenhum paciente na fila'})

        # Se o primeiro da fila esta sendo visitado por outra dupla, ignorar
        em_visita = _get_em_visita_agora()
        if str(paciente['nr_atendimento']) in em_visita:
            return jsonify({'success': True, 'data': None, 'message': 'Paciente ja em visita por outra dupla'})

        item = dict(paciente)
        for campo in ('dt_entrada_unidade', 'ultima_ronda_em'):
            if item.get(campo):
                item[campo] = item[campo].isoformat()
        if item.get('horas_desde_ultima_ronda') is not None:
            item['horas_desde_ultima_ronda'] = round(float(item['horas_desde_ultima_ronda']), 1)
        if item.get('horas_desde_visita_hoje') is not None:
            item['horas_desde_visita_hoje'] = round(float(item['horas_desde_visita_hoje']), 1)
        if item.get('qt_dia_permanencia') is not None:
            item['qt_dia_permanencia'] = int(item['qt_dia_permanencia'])

        return jsonify({'success': True, 'data': item})
    except Exception as e:
        traceback.print_exc()
        return jsonify({'success': False, 'error': str(e)}), 500


# ============================================================
# API: RESERVA TEMPORARIA DE PACIENTE (anti-duplicacao de fila)
# ============================================================

@painel28_bp.route('/reservar-paciente', methods=['POST'])
@login_required
def reservar_paciente():
    """Marca que a dupla esta preenchendo o formulario para este paciente."""
    dados = request.get_json() or {}
    nr = str(dados.get('nr_atendimento', '')).strip()
    dupla_id = dados.get('dupla_id')
    nome_dupla = dados.get('nome_dupla')

    if not nr:
        return jsonify({'success': False, 'error': 'nr_atendimento obrigatorio'}), 400

    if dupla_id and not nome_dupla:
        # Tenta buscar o nome caso o frontend não mande
        try:
            conn = get_db_connection()
            cursor = conn.cursor()
            cursor.execute("SELECT nome_visitante_1 || ' e ' || nome_visitante_2 FROM sentir_agir_duplas WHERE id = %s",
                           (dupla_id,))
            row = cursor.fetchone()
            if row:
                nome_dupla = row[0]
            cursor.close()
            conn.close()
        except Exception:
            pass

    with _visita_lock:
        if nr in _em_visita and str(_em_visita[nr]['dupla_id']) != str(dupla_id):
            return jsonify({
                'success': False,
                'error': 'Paciente ja esta em visita por outra dupla',
                'dupla_em_visita': _em_visita[nr].get('nome_dupla', 'Outra dupla')
            }), 409

        _em_visita[nr] = {
            'dupla_id': dupla_id,
            'nome_dupla': nome_dupla or 'Dupla em visita',
            'ts': datetime.now()
        }
    return jsonify({'success': True})


@painel28_bp.route('/liberar-paciente', methods=['POST'])
@login_required
def liberar_paciente():
    """Remove a reserva de um paciente (visita salva, pulada ou cancelada)."""
    dados = request.get_json() or {}
    nr = str(dados.get('nr_atendimento', '')).strip()
    if not nr:
        return jsonify({'success': False, 'error': 'nr_atendimento obrigatorio'}), 400
    with _visita_lock:
        _em_visita.pop(nr, None)
    return jsonify({'success': True})


# ============================================================
# API: PRECAUÇÃO DE CONTATO
# ============================================================

@painel28_bp.route('/precaucao-contato', methods=['GET'])
@login_required
def listar_precaucao_contato():
    """Lista pacientes em precaução de contato (somente internados na fila)."""
    try:
        conn = get_db_connection()
        cursor = conn.cursor(cursor_factory=RealDictCursor)
        cursor.execute("""
            SELECT pc.nr_atendimento, pc.nm_paciente, pc.leito,
                   pc.marcado_por, pc.marcado_em
            FROM sentir_agir_precaucao_contato pc
            ORDER BY pc.marcado_em DESC
        """)
        rows = cursor.fetchall()
        cursor.close()
        conn.close()
        resultado = []
        for r in rows:
            item = dict(r)
            if item.get('marcado_em'):
                item['marcado_em'] = item['marcado_em'].isoformat()
            resultado.append(item)
        return jsonify({'success': True, 'data': resultado, 'total': len(resultado)})
    except Exception as e:
        traceback.print_exc()
        return jsonify({'success': False, 'error': str(e)}), 500


@painel28_bp.route('/precaucao-contato', methods=['POST'])
@login_required
def marcar_precaucao_contato():
    """Marca paciente em precaução de contato, removendo-o da fila de visitas."""
    dados = request.get_json() or {}
    nr = str(dados.get('nr_atendimento', '')).strip()
    nm_paciente = (dados.get('nm_paciente') or '').strip() or None
    leito = (dados.get('leito') or '').strip() or None
    if not nr:
        return jsonify({'success': False, 'error': 'nr_atendimento obrigatorio'}), 400

    usuario = _get_usuario()
    try:
        conn = get_db_connection()
        cursor = conn.cursor(cursor_factory=RealDictCursor)
        cursor.execute("""
            INSERT INTO sentir_agir_precaucao_contato
                (nr_atendimento, nm_paciente, leito, marcado_por)
            VALUES (%s, %s, %s, %s)
            ON CONFLICT (nr_atendimento) DO UPDATE
                SET nm_paciente = EXCLUDED.nm_paciente,
                    leito       = EXCLUDED.leito,
                    marcado_por = EXCLUDED.marcado_por,
                    marcado_em  = NOW()
        """, (nr, nm_paciente, leito, usuario))
        # Liberar lock de visita caso exista
        with _visita_lock:
            _em_visita.pop(nr, None)
        conn.commit()
        cursor.close()
        conn.close()
        return jsonify({'success': True, 'message': 'Paciente marcado em precaução de contato. Removido da fila.'})
    except Exception as e:
        traceback.print_exc()
        return jsonify({'success': False, 'error': str(e)}), 500


@painel28_bp.route('/precaucao-contato/<nr_atendimento>', methods=['DELETE'])
@login_required
def remover_precaucao_contato(nr_atendimento):
    """Remove a marcação de precaução de contato, devolvendo o paciente à fila."""
    nr = str(nr_atendimento).strip()
    if not nr:
        return jsonify({'success': False, 'error': 'nr_atendimento obrigatorio'}), 400
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute(
            "DELETE FROM sentir_agir_precaucao_contato WHERE nr_atendimento = %s", (nr,)
        )
        removido = cursor.rowcount > 0
        conn.commit()
        cursor.close()
        conn.close()
        if not removido:
            return jsonify({'success': False, 'error': 'Paciente não encontrado em precaução de contato'}), 404
        return jsonify({'success': True, 'message': 'Precaução de contato removida. Paciente voltou à fila.'})
    except Exception as e:
        traceback.print_exc()
        return jsonify({'success': False, 'error': str(e)}), 500


# ============================================================
# API: RONDAS - CRUD
# ============================================================

@painel28_bp.route('/rondas', methods=['POST'])
@login_required
def criar_ronda():
    try:
        dados = request.get_json()
        if not dados:
            return jsonify({'success': False, 'error': 'Dados nao fornecidos'}), 400
        dupla_id = dados.get('dupla_id')
        data_ronda = dados.get('data_ronda')
        erros = []
        if not dupla_id:
            erros.append('Dupla e obrigatoria')
        if not data_ronda:
            erros.append('Data da ronda e obrigatoria')
        if erros:
            return jsonify({'success': False, 'errors': erros}), 400

        usuario = _get_usuario()
        ip = _get_ip()
        conn = get_db_connection()
        cursor = conn.cursor(cursor_factory=RealDictCursor)

        cursor.execute("SELECT id FROM sentir_agir_duplas WHERE id = %s AND ativo = TRUE", (dupla_id,))
        if not cursor.fetchone():
            cursor.close()
            conn.close()
            return jsonify({'success': False, 'error': 'Dupla nao encontrada ou inativa'}), 404

        cursor.execute("""
            SELECT id FROM sentir_agir_rondas
            WHERE dupla_id = %s AND data_ronda = %s AND status != 'cancelada'
        """, (dupla_id, data_ronda))
        ronda_existente = cursor.fetchone()

        if ronda_existente:
            cursor.close()
            conn.close()
            return jsonify({
                'success': True,
                'data': {'id': ronda_existente['id'], 'existente': True},
                'message': 'Ronda ja existe. Continuando...'
            })

        cursor.execute("""
            INSERT INTO sentir_agir_rondas (data_ronda, dupla_id, criado_por, status)
            VALUES (%s, %s, %s, 'em_andamento') RETURNING id
        """, (data_ronda, dupla_id, usuario))
        ronda_id = cursor.fetchone()['id']
        _registrar_log(cursor, 'ronda', ronda_id, 'criacao', usuario, ip_origem=ip)
        conn.commit()
        cursor.close()
        conn.close()
        return jsonify({'success': True, 'data': {'id': ronda_id, 'existente': False}, 'message': 'Ronda criada'}), 201
    except Exception as e:
        traceback.print_exc()
        return jsonify({'success': False, 'error': str(e)}), 500


@painel28_bp.route('/rondas/<int:ronda_id>/concluir', methods=['PUT'])
@login_required
def concluir_ronda(ronda_id):
    try:
        usuario = _get_usuario()
        ip = _get_ip()
        conn = get_db_connection()
        cursor = conn.cursor(cursor_factory=RealDictCursor)
        cursor.execute("SELECT id, status FROM sentir_agir_rondas WHERE id = %s", (ronda_id,))
        ronda = cursor.fetchone()
        if not ronda:
            cursor.close()
            conn.close()
            return jsonify({'success': False, 'error': 'Ronda nao encontrada'}), 404
        if ronda['status'] == 'concluida':
            cursor.close()
            conn.close()
            return jsonify({'success': True, 'message': 'Ronda ja esta concluida'})
        cursor.execute("UPDATE sentir_agir_rondas SET status = 'concluida', atualizado_em = NOW() WHERE id = %s",
                       (ronda_id,))
        _registrar_log(cursor, 'ronda', ronda_id, 'alteracao_status', usuario,
                       campo_alterado='status', valor_anterior=ronda['status'],
                       valor_novo='concluida', ip_origem=ip)
        conn.commit()
        cursor.close()
        conn.close()
        return jsonify({'success': True, 'message': 'Ronda concluida com sucesso'})
    except Exception as e:
        traceback.print_exc()
        return jsonify({'success': False, 'error': str(e)}), 500


# ============================================================
# API: VISITAS - REGISTRAR (V2 com campos expandidos + sim/nao)
# ============================================================


@painel28_bp.route('/visitas', methods=['POST'])
@login_required
def registrar_visita():
    try:
        dados = request.get_json()
        if not dados:
            return jsonify({'success': False, 'error': 'Dados nao fornecidos'}), 400

        ronda_id = dados.get('ronda_id')
        setor_id = dados.get('setor_id')
        leito = (dados.get('leito') or '').strip()
        nr_atendimento = (dados.get('nr_atendimento') or '').strip() or None
        nm_paciente = (dados.get('nm_paciente') or '').strip() or None
        setor_ocupacao = (dados.get('setor_ocupacao') or '').strip() or None
        qt_dias_internacao = dados.get('qt_dias_internacao')
        observacoes = (dados.get('observacoes') or '').strip() or None
        avaliacao_final = dados.get('avaliacao_final')
        avaliacoes = dados.get('avaliacoes', [])

        erros = []
        if not ronda_id:
            erros.append('Ronda e obrigatoria')
        if not setor_id:
            erros.append('Setor e obrigatorio')
        if not leito:
            erros.append('Leito e obrigatorio')
        if avaliacao_final not in ('critico', 'atencao', 'adequado', 'impossibilitada'):
            erros.append('Avaliacao final invalida')
        if avaliacao_final != 'impossibilitada' and not avaliacoes:
            erros.append('Avaliacoes dos itens sao obrigatorias')

        resultados_validos = ('critico', 'atencao', 'adequado', 'nao_aplica', 'sim', 'nao')
        for av in avaliacoes:
            if not av.get('item_id'):
                erros.append('Item de avaliacao invalido')
                break
            if av.get('resultado') not in resultados_validos:
                erros.append('Resultado invalido: %s' % av.get('resultado'))
                break

        if erros:
            return jsonify({'success': False, 'errors': erros}), 400

        usuario = _get_usuario()
        ip = _get_ip()
        conn = get_db_connection()
        cursor = conn.cursor(cursor_factory=RealDictCursor)

        # Verificar ronda
        cursor.execute("SELECT id, status FROM sentir_agir_rondas WHERE id = %s", (ronda_id,))
        ronda = cursor.fetchone()
        if not ronda:
            cursor.close()
            conn.close()
            return jsonify({'success': False, 'error': 'Ronda nao encontrada'}), 404
        if ronda['status'] == 'cancelada':
            cursor.close()
            conn.close()
            return jsonify({'success': False, 'error': 'Ronda esta cancelada'}), 400

        # Verificar duplicidade: paciente já visitado hoje por outra ronda
        if nr_atendimento and avaliacao_final != 'impossibilitada':
            cursor.execute("""
                SELECT v.id, d.nome_visitante_1 || ' e ' || d.nome_visitante_2 AS dupla_nome
                FROM sentir_agir_visitas v
                JOIN sentir_agir_rondas r ON r.id = v.ronda_id
                JOIN sentir_agir_duplas d ON d.id = r.dupla_id
                WHERE v.nr_atendimento = %s
                  AND v.avaliacao_final != 'impossibilitada'
                  AND v.criado_em >= CURRENT_DATE
                  AND v.ronda_id != %s
                LIMIT 1
            """, (nr_atendimento, ronda_id))
            visita_duplicada = cursor.fetchone()
            if visita_duplicada:
                cursor.close()
                conn.close()
                return jsonify({
                    'success': False,
                    'error': 'Este paciente ja foi visitado hoje pela dupla: %s. '
                             'Selecione o proximo paciente da fila.' % visita_duplicada['dupla_nome'],
                    'duplicado': True
                }), 409

        # Verificar setor
        cursor.execute("SELECT id FROM sentir_agir_setores WHERE id = %s AND ativo = TRUE", (setor_id,))
        if not cursor.fetchone():
            cursor.close()
            conn.close()
            return jsonify({'success': False, 'error': 'Setor nao encontrado ou inativo'}), 404

        # Inserir visita
        cursor.execute("""
            INSERT INTO sentir_agir_visitas
                (ronda_id, setor_id, leito, nr_atendimento,
                 nm_paciente, setor_ocupacao, qt_dias_internacao,
                 observacoes, avaliacao_final, status_tratativa)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, 'sem_pendencia')
            RETURNING id
        """, (ronda_id, setor_id, leito, nr_atendimento,
              nm_paciente, setor_ocupacao, qt_dias_internacao,
              observacoes, avaliacao_final))
        visita_id = cursor.fetchone()['id']

        # Pré-buscar critico_quando dos itens desta visita
        item_ids = [av['item_id'] for av in avaliacoes if av.get('item_id')]
        critico_quando_map = {}
        if item_ids:
            cursor.execute("""
                SELECT id, COALESCE(tipo, 'semaforo') AS tipo,
                       COALESCE(critico_quando, 'nao') AS critico_quando
                FROM sentir_agir_itens WHERE id = ANY(%s)
            """, (item_ids,))
            for row in cursor.fetchall():
                critico_quando_map[row['id']] = row

        # Inserir avaliações e detectar items críticos
        avaliacoes_criticas = []  # lista de (avaliacao_id, item_id, obs_item)

        for av in avaliacoes:
            cursor.execute("""
                INSERT INTO sentir_agir_avaliacoes (visita_id, item_id, resultado)
                VALUES (%s, %s, %s)
                RETURNING id
            """, (visita_id, av['item_id'], av['resultado']))
            avaliacao_id = cursor.fetchone()['id']

            # Detectar se é crítico respeitando critico_quando por item
            resultado = av['resultado']
            item_cfg = critico_quando_map.get(av['item_id'], {})
            eh_critico = (
                    resultado == 'critico' or
                    (item_cfg.get('tipo') == 'sim_nao' and resultado == item_cfg.get('critico_quando', 'nao'))
            )
            if eh_critico:
                obs_item = (av.get('obs_item') or '').strip() or None
                avaliacoes_criticas.append((avaliacao_id, av['item_id'], obs_item))

        # Verificar se criação automática está ativa
        auto_criar = _get_config(cursor, 'tratativa_auto_criar', 'true')
        tratativas_criadas = 0

        if auto_criar == 'true' and avaliacoes_criticas:
            for avaliacao_id, item_id, obs_item in avaliacoes_criticas:
                # Buscar dados do item e categoria
                cursor.execute("""
                    SELECT i.id AS item_id, i.descricao AS item_descricao,
                           c.id AS categoria_id, c.nome AS categoria_nome
                    FROM sentir_agir_itens i
                    JOIN sentir_agir_categorias c ON c.id = i.categoria_id
                    WHERE i.id = %s
                """, (item_id,))
                item_info = cursor.fetchone()

                if not item_info:
                    continue

                # Auto-atribuir responsavel: categoria + setor (logica de prioridade)
                responsavel_id = _encontrar_responsavel_auto(cursor, item_info['categoria_id'], setor_id)

                # Montar descricao do problema — prioriza obs específica do item
                desc = 'Item critico: ' + item_info['item_descricao']
                desc += ' | Categoria: ' + item_info['categoria_nome']
                desc += ' | Paciente: ' + (nm_paciente or 'N/I')
                desc += ' | Leito: ' + leito
                if obs_item:
                    desc += ' | Observacao do item: ' + obs_item
                elif observacoes:
                    desc += ' | Observacao da visita: ' + observacoes

                # Criar tratativa
                cursor.execute("""
                    INSERT INTO sentir_agir_tratativas
                        (visita_id, avaliacao_id, item_id, categoria_id,
                         responsavel_id, descricao_problema, status)
                    VALUES (%s, %s, %s, %s, %s, %s, 'pendente')
                """, (visita_id, avaliacao_id, item_id, item_info['categoria_id'],
                      responsavel_id, desc))
                tratativas_criadas += 1

            # Atualizar status_tratativa da visita para 'pendente'
            cursor.execute("""
                UPDATE sentir_agir_visitas
                SET status_tratativa = 'pendente'
                WHERE id = %s
            """, (visita_id,))

        _registrar_log(cursor, 'visita', visita_id, 'criacao', usuario, ip_origem=ip)

        if tratativas_criadas > 0:
            _registrar_log(
                cursor, 'visita', visita_id, 'tratativas_criadas', usuario,
                valor_novo=str(tratativas_criadas), ip_origem=ip
            )

        conn.commit()
        cursor.close()
        conn.close()

        if avaliacao_final == 'impossibilitada':
            msg = 'Visita impossibilitada registrada. Paciente reposicionado na fila.'
        else:
            msg = 'Visita registrada'
        if tratativas_criadas > 0:
            msg += '. %d tratativa(s) criada(s) para itens criticos.' % tratativas_criadas

        return jsonify({
            'success': True,
            'data': {
                'id': visita_id,
                'tratativas_criadas': tratativas_criadas
            },
            'message': msg
        }), 201

    except Exception as e:
        traceback.print_exc()
        return jsonify({'success': False, 'error': str(e)}), 500


# ============================================================
# API: IMAGENS - UPLOAD / SERVIR / DELETAR
# ============================================================

@painel28_bp.route('/imagens', methods=['POST'])
@login_required
def upload_imagem():
    try:
        visita_id = request.form.get('visita_id')
        descricao = (request.form.get('descricao') or '').strip() or None
        if not visita_id:
            return jsonify({'success': False, 'error': 'Visita e obrigatoria'}), 400
        if 'arquivo' not in request.files:
            return jsonify({'success': False, 'error': 'Arquivo nao fornecido'}), 400
        arquivo = request.files['arquivo']
        if not arquivo.filename:
            return jsonify({'success': False, 'error': 'Arquivo vazio'}), 400

        usuario = _get_usuario()
        ip = _get_ip()
        conn = get_db_connection()
        cursor = conn.cursor(cursor_factory=RealDictCursor)

        cursor.execute("SELECT id FROM sentir_agir_visitas WHERE id = %s", (visita_id,))
        if not cursor.fetchone():
            cursor.close()
            conn.close()
            return jsonify({'success': False, 'error': 'Visita nao encontrada'}), 404

        max_imagens = int(_get_config(cursor, 'max_imagens_por_visita', '5'))
        cursor.execute("SELECT COUNT(*) as total FROM sentir_agir_imagens WHERE visita_id = %s", (visita_id,))
        if cursor.fetchone()['total'] >= max_imagens:
            cursor.close()
            conn.close()
            return jsonify({'success': False, 'error': 'Limite de %d imagens atingido' % max_imagens}), 400

        tipos_permitidos = _get_config(cursor, 'tipos_imagem_permitidos', 'image/jpeg,image/png,image/webp')
        tipos_lista = [t.strip() for t in tipos_permitidos.split(',')]
        tipo_mime = arquivo.content_type or ''
        if tipo_mime not in tipos_lista:
            cursor.close()
            conn.close()
            return jsonify({'success': False, 'error': 'Tipo nao permitido. Aceitos: %s' % tipos_permitidos}), 400

        max_mb = float(_get_config(cursor, 'tamanho_max_imagem_mb', '10'))
        arquivo.seek(0, 2)
        tamanho_bytes = arquivo.tell()
        arquivo.seek(0)
        if tamanho_bytes > max_mb * 1024 * 1024:
            cursor.close()
            conn.close()
            return jsonify({'success': False, 'error': 'Arquivo muito grande. Max: %.0f MB' % max_mb}), 400

        extensao = os.path.splitext(arquivo.filename)[1].lower() or '.jpg'
        nome_unico = '%s_%s%s' % (datetime.now().strftime('%Y%m%d_%H%M%S'), uuid.uuid4().hex[:8], extensao)

        caminho_base = _get_config(cursor, 'caminho_imagens',
                                   os.path.join(os.path.dirname(__file__), '..', '..', 'uploads', 'sentir_agir'))
        subpasta = datetime.now().strftime('%Y/%m')
        caminho_completo = os.path.join(caminho_base, subpasta)
        os.makedirs(caminho_completo, exist_ok=True)

        caminho_arquivo = os.path.join(caminho_completo, nome_unico)
        arquivo.save(caminho_arquivo)
        caminho_relativo = os.path.join(subpasta, nome_unico)

        cursor.execute("""
            INSERT INTO sentir_agir_imagens (visita_id, caminho_arquivo, nome_original, descricao, tamanho_bytes, tipo_mime)
            VALUES (%s, %s, %s, %s, %s, %s) RETURNING id
        """, (visita_id, caminho_relativo, arquivo.filename, descricao, tamanho_bytes, tipo_mime))
        imagem_id = cursor.fetchone()['id']
        _registrar_log(cursor, 'imagem', imagem_id, 'criacao', usuario, ip_origem=ip)
        conn.commit()
        cursor.close()
        conn.close()
        return jsonify(
            {'success': True, 'data': {'id': imagem_id, 'caminho': caminho_relativo}, 'message': 'Imagem enviada'}), 201
    except Exception as e:
        traceback.print_exc()
        return jsonify({'success': False, 'error': str(e)}), 500


@painel28_bp.route('/imagens/<int:imagem_id>', methods=['GET'])
@login_required
def servir_imagem(imagem_id):
    try:
        conn = get_db_connection()
        cursor = conn.cursor(cursor_factory=RealDictCursor)
        cursor.execute("SELECT caminho_arquivo, tipo_mime FROM sentir_agir_imagens WHERE id = %s", (imagem_id,))
        imagem = cursor.fetchone()
        if not imagem:
            cursor.close()
            conn.close()
            return jsonify({'success': False, 'error': 'Imagem nao encontrada'}), 404
        caminho_base = _get_config(cursor, 'caminho_imagens',
                                   os.path.join(os.path.dirname(__file__), '..', '..', 'uploads', 'sentir_agir'))
        cursor.close()
        conn.close()
        caminho_completo = os.path.join(caminho_base, imagem['caminho_arquivo'])
        return send_from_directory(os.path.dirname(caminho_completo), os.path.basename(caminho_completo),
                                   mimetype=imagem['tipo_mime'])
    except Exception as e:
        traceback.print_exc()
        return jsonify({'success': False, 'error': str(e)}), 500


@painel28_bp.route('/imagens/<int:imagem_id>', methods=['DELETE'])
@login_required
def deletar_imagem(imagem_id):
    try:
        usuario = _get_usuario()
        ip = _get_ip()
        conn = get_db_connection()
        cursor = conn.cursor(cursor_factory=RealDictCursor)
        cursor.execute("SELECT id, caminho_arquivo, nome_original FROM sentir_agir_imagens WHERE id = %s", (imagem_id,))
        imagem = cursor.fetchone()
        if not imagem:
            cursor.close()
            conn.close()
            return jsonify({'success': False, 'error': 'Imagem nao encontrada'}), 404

        caminho_base = _get_config(cursor, 'caminho_imagens',
                                   os.path.join(os.path.dirname(__file__), '..', '..', 'uploads', 'sentir_agir'))
        caminho_completo = os.path.join(caminho_base, imagem['caminho_arquivo'])
        try:
            if os.path.exists(caminho_completo):
                os.remove(caminho_completo)
        except Exception as e_file:
            print('Aviso: nao foi possivel remover arquivo: %s' % str(e_file))

        cursor.execute("DELETE FROM sentir_agir_imagens WHERE id = %s", (imagem_id,))
        _registrar_log(cursor, 'imagem', imagem_id, 'exclusao', usuario,
                       valor_anterior=imagem['nome_original'], ip_origem=ip)
        conn.commit()
        cursor.close()
        conn.close()
        return jsonify({'success': True, 'message': 'Imagem removida'})
    except Exception as e:
        traceback.print_exc()
        return jsonify({'success': False, 'error': str(e)}), 500


# ============================================================
# API: VISITAS DE UMA RONDA (resumo)
# ============================================================

@painel28_bp.route('/rondas/<int:ronda_id>/visitas', methods=['GET'])
@login_required
def listar_visitas_ronda(ronda_id):
    try:
        conn = get_db_connection()
        cursor = conn.cursor(cursor_factory=RealDictCursor)
        cursor.execute("""
            SELECT v.id, v.leito, v.nr_atendimento, v.nm_paciente,
                   v.avaliacao_final, v.observacoes, v.criado_em,
                   s.nome AS setor_nome, s.sigla AS setor_sigla,
                   (SELECT COUNT(*) FROM sentir_agir_avaliacoes a WHERE a.visita_id = v.id AND a.resultado = 'critico') AS qtd_critico,
                   (SELECT COUNT(*) FROM sentir_agir_avaliacoes a WHERE a.visita_id = v.id AND a.resultado = 'atencao') AS qtd_atencao,
                   (SELECT COUNT(*) FROM sentir_agir_avaliacoes a WHERE a.visita_id = v.id AND a.resultado = 'adequado') AS qtd_adequado,
                   (SELECT COUNT(*) FROM sentir_agir_imagens i WHERE i.visita_id = v.id) AS qtd_imagens
            FROM sentir_agir_visitas v
            JOIN sentir_agir_setores s ON s.id = v.setor_id
            WHERE v.ronda_id = %s ORDER BY v.criado_em DESC
        """, (ronda_id,))
        visitas = cursor.fetchall()
        cursor.close()
        conn.close()

        resultado = []
        for vis in visitas:
            item = dict(vis)
            if item.get('criado_em'):
                item['criado_em'] = item['criado_em'].isoformat()
            resultado.append(item)
        return jsonify({'success': True, 'data': resultado, 'total': len(resultado)})
    except Exception as e:
        traceback.print_exc()
        return jsonify({'success': False, 'error': str(e)}), 500


# ============================================================
# API: DETALHE DE VISITA
# ============================================================

@painel28_bp.route('/visitas/<int:visita_id>', methods=['GET'])
@login_required
def detalhe_visita(visita_id):
    try:
        conn = get_db_connection()
        cursor = conn.cursor(cursor_factory=RealDictCursor)
        cursor.execute("""
            SELECT v.id, v.ronda_id, v.setor_id, v.leito, v.nr_atendimento,
                   v.nm_paciente, v.setor_ocupacao, v.qt_dias_internacao,
                   v.observacoes, v.avaliacao_final, v.criado_em, v.atualizado_em,
                   s.nome AS setor_nome, s.sigla AS setor_sigla,
                   r.data_ronda,
                   d.nome_visitante_1 || ' e ' || d.nome_visitante_2 AS dupla_nome
            FROM sentir_agir_visitas v
            JOIN sentir_agir_setores s ON s.id = v.setor_id
            JOIN sentir_agir_rondas r ON r.id = v.ronda_id
            JOIN sentir_agir_duplas d ON d.id = r.dupla_id
            WHERE v.id = %s
        """, (visita_id,))
        visita = cursor.fetchone()
        if not visita:
            cursor.close()
            conn.close()
            return jsonify({'success': False, 'error': 'Visita nao encontrada'}), 404

        cursor.execute("""
            SELECT a.id AS avaliacao_id, a.item_id, a.resultado,
                   i.descricao AS item_descricao, i.ordem AS item_ordem,
                   COALESCE(i.tipo, 'semaforo') AS item_tipo,
                   c.id AS categoria_id, c.nome AS categoria_nome,
                   c.icone AS categoria_icone, c.cor AS categoria_cor, c.ordem AS categoria_ordem
            FROM sentir_agir_avaliacoes a
            JOIN sentir_agir_itens i ON i.id = a.item_id
            JOIN sentir_agir_categorias c ON c.id = i.categoria_id
            WHERE a.visita_id = %s ORDER BY c.ordem, i.ordem
        """, (visita_id,))
        avaliacoes = cursor.fetchall()

        cursor.execute("""
            SELECT id, caminho_arquivo, nome_original, descricao, tamanho_bytes, tipo_mime, criado_em
            FROM sentir_agir_imagens WHERE visita_id = %s ORDER BY criado_em
        """, (visita_id,))
        imagens = cursor.fetchall()
        cursor.close()
        conn.close()

        visita_dict = dict(visita)
        for campo in ('criado_em', 'atualizado_em', 'data_ronda'):
            if visita_dict.get(campo):
                val = visita_dict[campo]
                visita_dict[campo] = val.isoformat() if hasattr(val, 'isoformat') else str(val)

        imagens_lista = []
        for img in imagens:
            img_dict = dict(img)
            if img_dict.get('criado_em'):
                img_dict['criado_em'] = img_dict['criado_em'].isoformat()
            img_dict['url'] = '/api/paineis/painel28/imagens/%d' % img_dict['id']
            imagens_lista.append(img_dict)

        categorias_agrupadas = []
        cat_atual = None
        for av in avaliacoes:
            if cat_atual is None or cat_atual['id'] != av['categoria_id']:
                cat_atual = {
                    'id': av['categoria_id'],
                    'nome': av['categoria_nome'],
                    'icone': av['categoria_icone'],
                    'cor': av['categoria_cor'],
                    'itens': []
                }
                categorias_agrupadas.append(cat_atual)
            cat_atual['itens'].append({
                'avaliacao_id': av['avaliacao_id'],
                'item_id': av['item_id'],
                'descricao': av['item_descricao'],
                'resultado': av['resultado'],
                'tipo': av['item_tipo']
            })

        visita_dict['categorias'] = categorias_agrupadas
        visita_dict['imagens'] = imagens_lista
        return jsonify({'success': True, 'data': visita_dict})
    except Exception as e:
        traceback.print_exc()
        return jsonify({'success': False, 'error': str(e)}), 500


# ============================================================
# API: ATUALIZAR VISITA (somente rondas em_andamento)
# ============================================================

@painel28_bp.route('/visitas/<int:visita_id>', methods=['PUT'])
@login_required
def atualizar_visita(visita_id):
    try:
        dados = request.get_json()
        if not dados:
            return jsonify({'success': False, 'error': 'Dados nao fornecidos'}), 400

        avaliacao_final = dados.get('avaliacao_final')
        avaliacoes = dados.get('avaliacoes', [])
        observacoes = (dados.get('observacoes') or '').strip() or None

        erros = []
        if avaliacao_final not in ('critico', 'atencao', 'adequado', 'impossibilitada'):
            erros.append('Avaliacao final invalida')
        if avaliacao_final != 'impossibilitada' and not avaliacoes:
            erros.append('Avaliacoes dos itens sao obrigatorias')

        resultados_validos = ('critico', 'atencao', 'adequado', 'nao_aplica', 'sim', 'nao')
        for av in avaliacoes:
            if not av.get('item_id'):
                erros.append('Item de avaliacao invalido')
                break
            if av.get('resultado') not in resultados_validos:
                erros.append('Resultado invalido: %s' % av.get('resultado'))
                break
        if erros:
            return jsonify({'success': False, 'errors': erros}), 400

        usuario = _get_usuario()
        ip = _get_ip()
        conn = get_db_connection()
        cursor = conn.cursor(cursor_factory=RealDictCursor)

        cursor.execute("""
            SELECT v.id, v.nm_paciente, v.ronda_id, v.setor_id, r.status
            FROM sentir_agir_visitas v
            JOIN sentir_agir_rondas r ON r.id = v.ronda_id
            WHERE v.id = %s
        """, (visita_id,))
        visita = cursor.fetchone()
        if not visita:
            cursor.close()
            conn.close()
            return jsonify({'success': False, 'error': 'Visita nao encontrada'}), 404
        if visita['status'] != 'em_andamento':
            cursor.close()
            conn.close()
            return jsonify({'success': False, 'error': 'Ronda ja concluida, edicao nao permitida'}), 400

        # Pré-buscar critico_quando dos itens desta visita
        item_ids_upd = [av['item_id'] for av in avaliacoes if av.get('item_id')]
        critico_quando_map_upd = {}
        if item_ids_upd:
            cursor.execute("""
                SELECT id, COALESCE(tipo, 'semaforo') AS tipo,
                       COALESCE(critico_quando, 'nao') AS critico_quando
                FROM sentir_agir_itens WHERE id = ANY(%s)
            """, (item_ids_upd,))
            for row in cursor.fetchall():
                critico_quando_map_upd[row['id']] = row

        def _eh_critico_upd(av):
            r = av.get('resultado')
            cfg = critico_quando_map_upd.get(av['item_id'], {})
            return (r == 'critico' or
                    (cfg.get('tipo') == 'sim_nao' and r == cfg.get('critico_quando', 'nao')))

        # Cancelar somente tratativas pendentes cujos itens não serão mais críticos
        itens_criticos_novos = set(
            av['item_id'] for av in avaliacoes if _eh_critico_upd(av)
        )
        cursor.execute("""
            UPDATE sentir_agir_tratativas
            SET status = 'cancelado'
            WHERE visita_id = %s AND status = 'pendente'
              AND item_id NOT IN %s
        """, (visita_id, tuple(itens_criticos_novos) if itens_criticos_novos else (0,)))

        # Remover somente avaliações (não carregam dedup, podem ser recriadas)
        cursor.execute("DELETE FROM sentir_agir_avaliacoes WHERE visita_id = %s", (visita_id,))

        # Atualizar visita
        cursor.execute("""
            UPDATE sentir_agir_visitas
            SET avaliacao_final = %s, observacoes = %s, status_tratativa = 'sem_pendencia', atualizado_em = NOW()
            WHERE id = %s
        """, (avaliacao_final, observacoes, visita_id))

        # Inserir novas avaliacoes e detectar criticos
        avaliacoes_criticas = []
        for av in avaliacoes:
            cursor.execute("""
                INSERT INTO sentir_agir_avaliacoes (visita_id, item_id, resultado)
                VALUES (%s, %s, %s) RETURNING id
            """, (visita_id, av['item_id'], av['resultado']))
            avaliacao_id = cursor.fetchone()['id']
            if _eh_critico_upd(av):
                obs_item = (av.get('obs_item') or '').strip() or None
                avaliacoes_criticas.append((avaliacao_id, av['item_id'], obs_item))

        auto_criar = _get_config(cursor, 'tratativa_auto_criar', 'true')
        tratativas_criadas = 0

        if auto_criar == 'true' and avaliacoes_criticas:
            for avaliacao_id, item_id, obs_item in avaliacoes_criticas:
                # Não recriar se já existe tratativa ativa para este item nesta visita
                cursor.execute("""
                    SELECT id FROM sentir_agir_tratativas
                    WHERE visita_id = %s AND item_id = %s
                      AND status NOT IN ('cancelado')
                    LIMIT 1
                """, (visita_id, item_id))
                if cursor.fetchone():
                    continue  # Tratativa já existe, não duplicar/renotificar

                cursor.execute("""
                    SELECT i.id AS item_id, i.descricao AS item_descricao,
                           c.id AS categoria_id, c.nome AS categoria_nome
                    FROM sentir_agir_itens i
                    JOIN sentir_agir_categorias c ON c.id = i.categoria_id
                    WHERE i.id = %s
                """, (item_id,))
                item_info = cursor.fetchone()
                if not item_info:
                    continue
                # Auto-atribuir responsavel: categoria + setor (logica de prioridade)
                responsavel_id = _encontrar_responsavel_auto(cursor, item_info['categoria_id'], visita['setor_id'])

                desc = 'Item critico: ' + item_info['item_descricao']
                desc += ' | Categoria: ' + item_info['categoria_nome']
                desc += ' | Paciente: ' + (visita['nm_paciente'] or 'N/I')
                if obs_item:
                    desc += ' | Observacao do item: ' + obs_item
                elif observacoes:
                    desc += ' | Observacao da visita: ' + observacoes

                cursor.execute("""
                    INSERT INTO sentir_agir_tratativas
                        (visita_id, avaliacao_id, item_id, categoria_id, responsavel_id, descricao_problema, status)
                    VALUES (%s, %s, %s, %s, %s, %s, 'pendente')
                """, (visita_id, avaliacao_id, item_id, item_info['categoria_id'], responsavel_id, desc))
                tratativas_criadas += 1

            cursor.execute("""
                UPDATE sentir_agir_visitas SET status_tratativa = 'pendente' WHERE id = %s
            """, (visita_id,))

        _registrar_log(cursor, 'visita', visita_id, 'edicao', usuario, ip_origem=ip)
        conn.commit()
        cursor.close()
        conn.close()

        msg = 'Visita atualizada'
        if tratativas_criadas > 0:
            msg += '. %d nova(s) tratativa(s) criada(s).' % tratativas_criadas
        return jsonify({'success': True, 'data': {'id': visita_id}, 'message': msg})
    except Exception as e:
        traceback.print_exc()
        return jsonify({'success': False, 'error': str(e)}), 500


# ============================================================
# API: RONDA EM ANDAMENTO POR DUPLA (cross-device cache)
# ============================================================

@painel28_bp.route('/duplas/<int:dupla_id>/ronda-em-andamento', methods=['GET'])
@login_required
def ronda_em_andamento(dupla_id):
    try:
        conn = get_db_connection()
        cursor = conn.cursor(cursor_factory=RealDictCursor)

        # Finaliza rondas esquecidas antes de consultar
        _auto_finalizar_rondas_expiradas(cursor)
        conn.commit()

        cursor.execute("""
            SELECT r.id, r.data_ronda, r.status, r.criado_em
            FROM sentir_agir_rondas r
            WHERE r.dupla_id = %s AND r.status = 'em_andamento'
            ORDER BY r.criado_em DESC
            LIMIT 1
        """, (dupla_id,))
        ronda = cursor.fetchone()

        if not ronda:
            cursor.close()
            conn.close()
            return jsonify({'success': True, 'data': None})

        cursor.execute("""
            SELECT v.id, v.leito, v.nm_paciente, v.avaliacao_final, v.criado_em,
                   s.nome AS setor_nome, s.sigla AS setor_sigla
            FROM sentir_agir_visitas v
            JOIN sentir_agir_setores s ON s.id = v.setor_id
            WHERE v.ronda_id = %s ORDER BY v.criado_em ASC
        """, (ronda['id'],))
        visitas = cursor.fetchall()
        cursor.close()
        conn.close()

        ronda_dict = dict(ronda)
        if ronda_dict.get('data_ronda'):
            val = ronda_dict['data_ronda']
            ronda_dict['data_ronda'] = val.isoformat() if hasattr(val, 'isoformat') else str(val)
        if ronda_dict.get('criado_em'):
            ronda_dict['criado_em'] = ronda_dict['criado_em'].isoformat()

        visitas_lista = []
        for v in visitas:
            vd = dict(v)
            if vd.get('criado_em'):
                vd['criado_em'] = vd['criado_em'].isoformat()
            visitas_lista.append(vd)

        ronda_dict['visitas'] = visitas_lista
        return jsonify({'success': True, 'data': ronda_dict})
    except Exception as e:
        traceback.print_exc()
        return jsonify({'success': False, 'error': str(e)}), 500


# ============================================================
# API: EXCLUIR VISITA (somente rondas em_andamento)
# ============================================================

@painel28_bp.route('/visitas/<int:visita_id>', methods=['DELETE'])
@login_required
def excluir_visita(visita_id):
    try:
        usuario = _get_usuario()
        ip = _get_ip()
        conn = get_db_connection()
        cursor = conn.cursor(cursor_factory=RealDictCursor)

        cursor.execute("""
            SELECT v.id, v.nm_paciente, v.leito, v.ronda_id, r.status
            FROM sentir_agir_visitas v
            JOIN sentir_agir_rondas r ON r.id = v.ronda_id
            WHERE v.id = %s
        """, (visita_id,))
        visita = cursor.fetchone()

        if not visita:
            cursor.close()
            conn.close()
            return jsonify({'success': False, 'error': 'Visita nao encontrada'}), 404

        if visita['status'] != 'em_andamento':
            cursor.close()
            conn.close()
            return jsonify({'success': False, 'error': 'Nao e possivel excluir visitas de rondas ja concluidas'}), 400

        # Remover arquivos de imagem do disco
        cursor.execute("SELECT id, caminho_arquivo FROM sentir_agir_imagens WHERE visita_id = %s", (visita_id,))
        imagens = cursor.fetchall()
        caminho_base = _get_config(cursor, 'caminho_imagens',
                                   os.path.join(os.path.dirname(__file__), '..', '..', 'uploads', 'sentir_agir'))
        for img in imagens:
            try:
                caminho_completo = os.path.join(caminho_base, img['caminho_arquivo'])
                if os.path.exists(caminho_completo):
                    os.remove(caminho_completo)
            except Exception:
                pass

        cursor.execute("DELETE FROM sentir_agir_imagens WHERE visita_id = %s", (visita_id,))
        cursor.execute("DELETE FROM sentir_agir_tratativas WHERE visita_id = %s", (visita_id,))
        cursor.execute("DELETE FROM sentir_agir_avaliacoes WHERE visita_id = %s", (visita_id,))
        cursor.execute("DELETE FROM sentir_agir_visitas WHERE id = %s", (visita_id,))

        _registrar_log(cursor, 'visita', visita_id, 'exclusao', usuario,
                       valor_anterior='%s - %s' % (visita['nm_paciente'] or '', visita['leito']),
                       ip_origem=ip)
        conn.commit()
        cursor.close()
        conn.close()
        return jsonify({'success': True, 'message': 'Visita removida'})
    except Exception as e:
        traceback.print_exc()
        return jsonify({'success': False, 'error': str(e)}), 500


# ============================================================
# CONFIGURAR FORMULÁRIO - PÁGINA ESTÁTICA
# ============================================================

@painel28_bp.route('/configurar-formulario', endpoint='configurar_formulario_html', methods=['GET'])
@login_required
def servir_configurar_formulario():
    if not verificar_permissao_painel(session.get('usuario_id'), 'painel28'):
        return jsonify({'error': 'Sem permissao para este painel'}), 403
    return send_from_directory(PAINEL_DIR, 'formulario_config.html')


@painel28_bp.route('/main_config.js', endpoint='main_config_js', methods=['GET'])
def servir_main_config():
    return send_from_directory(PAINEL_DIR, 'main_config.js')


@painel28_bp.route('/style_config.css', endpoint='style_config_css', methods=['GET'])
def servir_style_config():
    return send_from_directory(PAINEL_DIR, 'style_config.css')


# ============================================================
# API: CATEGORIAS - CRUD COMPLETO
# ============================================================

@painel28_bp.route('/categorias', methods=['GET'])
@login_required
def listar_categorias():
    """Lista todas as categorias (incluindo inativas) com seus itens."""
    try:
        conn = get_db_connection()
        cursor = conn.cursor(cursor_factory=RealDictCursor)
        cursor.execute("""
            SELECT id, nome, icone, cor, ordem, ativo, permite_nao_aplica
            FROM sentir_agir_categorias ORDER BY ordem, nome
        """)
        categorias = cursor.fetchall()
        cursor.execute("""
            SELECT id, categoria_id, descricao, ordem, ativo,
                   COALESCE(tipo, 'semaforo') AS tipo,
                   COALESCE(critico_quando, 'nao') AS critico_quando,
                   COALESCE(permite_nao_aplica, FALSE) AS permite_nao_aplica
            FROM sentir_agir_itens ORDER BY ordem
        """)
        itens = cursor.fetchall()
        cursor.close()
        conn.close()

        itens_por_cat = {}
        for item in itens:
            cid = item['categoria_id']
            if cid not in itens_por_cat:
                itens_por_cat[cid] = []
            itens_por_cat[cid].append(dict(item))

        resultado = []
        for cat in categorias:
            d = dict(cat)
            d['itens'] = itens_por_cat.get(cat['id'], [])
            resultado.append(d)

        return jsonify({'success': True, 'data': resultado})
    except Exception as e:
        traceback.print_exc()
        return jsonify({'success': False, 'error': str(e)}), 500


@painel28_bp.route('/categorias', methods=['POST'])
@login_required
def criar_categoria():
    try:
        dados = request.get_json()
        if not dados:
            return jsonify({'success': False, 'error': 'Dados nao fornecidos'}), 400
        nome = (dados.get('nome') or '').strip()
        if not nome:
            return jsonify({'success': False, 'error': 'Nome obrigatorio'}), 400
        icone = (dados.get('icone') or 'fa-circle').strip()
        cor = (dados.get('cor') or '#17a2b8').strip()
        permite_nao_aplica = bool(dados.get('permite_nao_aplica', True))
        usuario = _get_usuario()
        ip = _get_ip()
        conn = get_db_connection()
        cursor = conn.cursor(cursor_factory=RealDictCursor)
        cursor.execute("SELECT COALESCE(MAX(ordem), 0) + 1 AS prox FROM sentir_agir_categorias")
        prox_ordem = cursor.fetchone()['prox']
        cursor.execute("""
            INSERT INTO sentir_agir_categorias (nome, icone, cor, ordem, ativo, permite_nao_aplica)
            VALUES (%s, %s, %s, %s, TRUE, %s) RETURNING id
        """, (nome, icone, cor, prox_ordem, permite_nao_aplica))
        cat_id = cursor.fetchone()['id']
        _registrar_log(cursor, 'categoria', cat_id, 'criacao', usuario,
                       valor_novo=nome, ip_origem=ip)
        conn.commit()
        cursor.close()
        conn.close()
        return jsonify({'success': True, 'data': {'id': cat_id}, 'message': 'Categoria criada'}), 201
    except Exception as e:
        traceback.print_exc()
        return jsonify({'success': False, 'error': str(e)}), 500


@painel28_bp.route('/categorias/<int:cat_id>', methods=['PUT'])
@login_required
def editar_categoria(cat_id):
    try:
        dados = request.get_json()
        if not dados:
            return jsonify({'success': False, 'error': 'Dados nao fornecidos'}), 400
        nome = (dados.get('nome') or '').strip()
        if not nome:
            return jsonify({'success': False, 'error': 'Nome obrigatorio'}), 400
        icone = (dados.get('icone') or 'fa-circle').strip()
        cor = (dados.get('cor') or '#17a2b8').strip()
        permite_nao_aplica = bool(dados.get('permite_nao_aplica', True))
        usuario = _get_usuario()
        ip = _get_ip()
        conn = get_db_connection()
        cursor = conn.cursor(cursor_factory=RealDictCursor)
        cursor.execute("SELECT id, nome FROM sentir_agir_categorias WHERE id = %s", (cat_id,))
        cat = cursor.fetchone()
        if not cat:
            cursor.close()
            conn.close()
            return jsonify({'success': False, 'error': 'Categoria nao encontrada'}), 404
        cursor.execute("""
            UPDATE sentir_agir_categorias
            SET nome = %s, icone = %s, cor = %s, permite_nao_aplica = %s
            WHERE id = %s
        """, (nome, icone, cor, permite_nao_aplica, cat_id))
        _registrar_log(cursor, 'categoria', cat_id, 'edicao', usuario,
                       campo_alterado='nome', valor_anterior=cat['nome'],
                       valor_novo=nome, ip_origem=ip)
        conn.commit()
        cursor.close()
        conn.close()
        return jsonify({'success': True, 'message': 'Categoria atualizada'})
    except Exception as e:
        traceback.print_exc()
        return jsonify({'success': False, 'error': str(e)}), 500


@painel28_bp.route('/categorias/<int:cat_id>/toggle', methods=['PUT'])
@login_required
def toggle_categoria(cat_id):
    try:
        usuario = _get_usuario()
        ip = _get_ip()
        conn = get_db_connection()
        cursor = conn.cursor(cursor_factory=RealDictCursor)
        cursor.execute("SELECT id, ativo FROM sentir_agir_categorias WHERE id = %s", (cat_id,))
        cat = cursor.fetchone()
        if not cat:
            cursor.close()
            conn.close()
            return jsonify({'success': False, 'error': 'Categoria nao encontrada'}), 404
        novo_status = not cat['ativo']
        cursor.execute("""
            UPDATE sentir_agir_categorias SET ativo = %s WHERE id = %s
        """, (novo_status, cat_id))
        _registrar_log(cursor, 'categoria', cat_id, 'alteracao_status', usuario,
                       campo_alterado='ativo', valor_anterior=str(cat['ativo']),
                       valor_novo=str(novo_status), ip_origem=ip)
        conn.commit()
        cursor.close()
        conn.close()
        return jsonify({'success': True,
                        'message': 'Categoria ativada' if novo_status else 'Categoria desativada'})
    except Exception as e:
        traceback.print_exc()
        return jsonify({'success': False, 'error': str(e)}), 500


@painel28_bp.route('/categorias/<int:cat_id>/reordenar', methods=['PUT'])
@login_required
def reordenar_categoria(cat_id):
    """Recebe {'direcao': 'cima' | 'baixo'} e troca a ordem com a vizinha."""
    try:
        dados = request.get_json()
        direcao = (dados or {}).get('direcao', '')
        if direcao not in ('cima', 'baixo'):
            return jsonify({'success': False, 'error': 'Direcao invalida'}), 400
        usuario = _get_usuario()
        ip = _get_ip()
        conn = get_db_connection()
        cursor = conn.cursor(cursor_factory=RealDictCursor)
        cursor.execute("SELECT id, ordem FROM sentir_agir_categorias WHERE id = %s", (cat_id,))
        cat = cursor.fetchone()
        if not cat:
            cursor.close()
            conn.close()
            return jsonify({'success': False, 'error': 'Categoria nao encontrada'}), 404
        if direcao == 'cima':
            cursor.execute("""
                SELECT id, ordem FROM sentir_agir_categorias
                WHERE ordem < %s ORDER BY ordem DESC LIMIT 1
            """, (cat['ordem'],))
        else:
            cursor.execute("""
                SELECT id, ordem FROM sentir_agir_categorias
                WHERE ordem > %s ORDER BY ordem ASC LIMIT 1
            """, (cat['ordem'],))
        vizinha = cursor.fetchone()
        if not vizinha:
            cursor.close()
            conn.close()
            return jsonify({'success': False, 'error': 'Ja esta no limite'})
        cursor.execute("UPDATE sentir_agir_categorias SET ordem = %s WHERE id = %s",
                       (vizinha['ordem'], cat_id))
        cursor.execute("UPDATE sentir_agir_categorias SET ordem = %s WHERE id = %s",
                       (cat['ordem'], vizinha['id']))
        _registrar_log(cursor, 'categoria', cat_id, 'reordenacao', usuario, ip_origem=ip)
        conn.commit()
        cursor.close()
        conn.close()
        return jsonify({'success': True, 'message': 'Reordenado'})
    except Exception as e:
        traceback.print_exc()
        return jsonify({'success': False, 'error': str(e)}), 500


# ============================================================
# API: ITENS - CRUD COMPLETO
# ============================================================

@painel28_bp.route('/itens', methods=['POST'])
@login_required
def criar_item():
    try:
        dados = request.get_json()
        if not dados:
            return jsonify({'success': False, 'error': 'Dados nao fornecidos'}), 400
        categoria_id = dados.get('categoria_id')
        descricao = (dados.get('descricao') or '').strip()
        tipo = dados.get('tipo', 'semaforo')
        if not categoria_id or not descricao:
            return jsonify({'success': False, 'error': 'categoria_id e descricao obrigatorios'}), 400
        if tipo not in ('semaforo', 'sim_nao'):
            tipo = 'semaforo'
        critico_quando = dados.get('critico_quando', 'nao')
        if critico_quando not in ('sim', 'nao'):
            critico_quando = 'nao'
        permite_nao_aplica = bool(dados.get('permite_nao_aplica', False)) if tipo == 'sim_nao' else False
        usuario = _get_usuario()
        ip = _get_ip()
        conn = get_db_connection()
        cursor = conn.cursor(cursor_factory=RealDictCursor)
        cursor.execute("SELECT id FROM sentir_agir_categorias WHERE id = %s", (categoria_id,))
        if not cursor.fetchone():
            cursor.close()
            conn.close()
            return jsonify({'success': False, 'error': 'Categoria nao encontrada'}), 404
        cursor.execute("""
            SELECT COALESCE(MAX(ordem), 0) + 1 AS prox
            FROM sentir_agir_itens WHERE categoria_id = %s
        """, (categoria_id,))
        prox_ordem = cursor.fetchone()['prox']
        cursor.execute("""
            INSERT INTO sentir_agir_itens (categoria_id, descricao, tipo, critico_quando, permite_nao_aplica, ordem, ativo)
            VALUES (%s, %s, %s, %s, %s, %s, TRUE) RETURNING id
        """, (categoria_id, descricao, tipo, critico_quando, permite_nao_aplica, prox_ordem))
        item_id = cursor.fetchone()['id']
        _registrar_log(cursor, 'item', item_id, 'criacao', usuario,
                       valor_novo=descricao, ip_origem=ip)
        conn.commit()
        cursor.close()
        conn.close()
        return jsonify({'success': True, 'data': {'id': item_id}, 'message': 'Item criado'}), 201
    except Exception as e:
        traceback.print_exc()
        return jsonify({'success': False, 'error': str(e)}), 500


@painel28_bp.route('/itens/<int:item_id>', methods=['PUT'])
@login_required
def editar_item(item_id):
    try:
        dados = request.get_json()
        if not dados:
            return jsonify({'success': False, 'error': 'Dados nao fornecidos'}), 400
        descricao = (dados.get('descricao') or '').strip()
        if not descricao:
            return jsonify({'success': False, 'error': 'Descricao obrigatoria'}), 400
        tipo = dados.get('tipo', 'semaforo')
        if tipo not in ('semaforo', 'sim_nao'):
            tipo = 'semaforo'
        critico_quando = dados.get('critico_quando', 'nao')
        if critico_quando not in ('sim', 'nao'):
            critico_quando = 'nao'
        permite_nao_aplica = bool(dados.get('permite_nao_aplica', False)) if tipo == 'sim_nao' else False
        usuario = _get_usuario()
        ip = _get_ip()
        conn = get_db_connection()
        cursor = conn.cursor(cursor_factory=RealDictCursor)
        cursor.execute("SELECT id, descricao FROM sentir_agir_itens WHERE id = %s", (item_id,))
        item = cursor.fetchone()
        if not item:
            cursor.close()
            conn.close()
            return jsonify({'success': False, 'error': 'Item nao encontrado'}), 404
        cursor.execute("""
            UPDATE sentir_agir_itens
            SET descricao = %s, tipo = %s, critico_quando = %s, permite_nao_aplica = %s
            WHERE id = %s
        """, (descricao, tipo, critico_quando, permite_nao_aplica, item_id))
        _registrar_log(cursor, 'item', item_id, 'edicao', usuario,
                       campo_alterado='descricao', valor_anterior=item['descricao'],
                       valor_novo=descricao, ip_origem=ip)
        conn.commit()
        cursor.close()
        conn.close()
        return jsonify({'success': True, 'message': 'Item atualizado'})
    except Exception as e:
        traceback.print_exc()
        return jsonify({'success': False, 'error': str(e)}), 500


@painel28_bp.route('/itens/<int:item_id>/toggle', methods=['PUT'])
@login_required
def toggle_item(item_id):
    try:
        usuario = _get_usuario()
        ip = _get_ip()
        conn = get_db_connection()
        cursor = conn.cursor(cursor_factory=RealDictCursor)
        cursor.execute("SELECT id, ativo FROM sentir_agir_itens WHERE id = %s", (item_id,))
        item = cursor.fetchone()
        if not item:
            cursor.close()
            conn.close()
            return jsonify({'success': False, 'error': 'Item nao encontrado'}), 404
        novo_status = not item['ativo']
        cursor.execute("""
            UPDATE sentir_agir_itens SET ativo = %s WHERE id = %s
        """, (novo_status, item_id))
        _registrar_log(cursor, 'item', item_id, 'alteracao_status', usuario,
                       campo_alterado='ativo', valor_anterior=str(item['ativo']),
                       valor_novo=str(novo_status), ip_origem=ip)
        conn.commit()
        cursor.close()
        conn.close()
        return jsonify({'success': True,
                        'message': 'Item ativado' if novo_status else 'Item desativado'})
    except Exception as e:
        traceback.print_exc()
        return jsonify({'success': False, 'error': str(e)}), 500


@painel28_bp.route('/itens/<int:item_id>/reordenar', methods=['PUT'])
@login_required
def reordenar_item(item_id):
    """Recebe {'direcao': 'cima' | 'baixo'} e troca ordem com vizinho na mesma categoria."""
    try:
        dados = request.get_json()
        direcao = (dados or {}).get('direcao', '')
        if direcao not in ('cima', 'baixo'):
            return jsonify({'success': False, 'error': 'Direcao invalida'}), 400
        usuario = _get_usuario()
        ip = _get_ip()
        conn = get_db_connection()
        cursor = conn.cursor(cursor_factory=RealDictCursor)
        cursor.execute("SELECT id, ordem, categoria_id FROM sentir_agir_itens WHERE id = %s",
                       (item_id,))
        item = cursor.fetchone()
        if not item:
            cursor.close()
            conn.close()
            return jsonify({'success': False, 'error': 'Item nao encontrado'}), 404
        if direcao == 'cima':
            cursor.execute("""
                SELECT id, ordem FROM sentir_agir_itens
                WHERE categoria_id = %s AND ordem < %s ORDER BY ordem DESC LIMIT 1
            """, (item['categoria_id'], item['ordem']))
        else:
            cursor.execute("""
                SELECT id, ordem FROM sentir_agir_itens
                WHERE categoria_id = %s AND ordem > %s ORDER BY ordem ASC LIMIT 1
            """, (item['categoria_id'], item['ordem']))
        vizinho = cursor.fetchone()
        if not vizinho:
            cursor.close()
            conn.close()
            return jsonify({'success': False, 'error': 'Ja esta no limite'})
        cursor.execute("UPDATE sentir_agir_itens SET ordem = %s WHERE id = %s",
                       (vizinho['ordem'], item_id))
        cursor.execute("UPDATE sentir_agir_itens SET ordem = %s WHERE id = %s",
                       (item['ordem'], vizinho['id']))
        _registrar_log(cursor, 'item', item_id, 'reordenacao', usuario, ip_origem=ip)
        conn.commit()
        cursor.close()
        conn.close()
        return jsonify({'success': True, 'message': 'Reordenado'})
    except Exception as e:
        traceback.print_exc()
        return jsonify({'success': False, 'error': str(e)}), 500