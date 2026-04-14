# ============================================================
# PAINEL 28 - HUB CENTRALIZADOR + FORMULÁRIO SENTIR E AGIR
# Hospital Anchieta Ceilândia
# V2 - Com fila de pacientes, itens sim/nao, campos expandidos
# ============================================================

import os
import uuid
import traceback
from datetime import datetime, date
from flask import Blueprint, request, jsonify, send_from_directory
from psycopg2.extras import RealDictCursor
from backend.database import get_db_connection
from backend.middleware.decorators import login_required
from backend.user_management import verificar_permissao_painel

painel28_bp = Blueprint(
    'painel28',
    __name__,
    url_prefix='/api/paineis/painel28'
)

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
    try:
        return request.user.get('nome', 'sistema') if hasattr(request, 'user') else 'sistema'
    except Exception:
        return 'sistema'


# ============================================================
# ROTAS DE ARQUIVOS ESTÁTICOS (HTML, CSS, JS)
# ============================================================

@painel28_bp.route('/index', endpoint='index_html', methods=['GET'])
@login_required
def servir_hub():
    if not verificar_permissao_painel(28):
        return jsonify({'error': 'Sem permissao para este painel'}), 403
    return send_from_directory(PAINEL_DIR, 'index.html')


@painel28_bp.route('/formulario', endpoint='formulario_html', methods=['GET'])
@login_required
def servir_formulario():
    if not verificar_permissao_painel(28):
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
        cursor.execute("SELECT id, nome_visitante_1, nome_visitante_2 FROM sentir_agir_duplas WHERE id = %s", (dupla_id,))
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
        cursor.execute("UPDATE sentir_agir_duplas SET ativo = %s, atualizado_em = NOW() WHERE id = %s", (novo_status, dupla_id))
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
                   COALESCE(tipo, 'semaforo') AS tipo
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
                'tipo': item['tipo']
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
        cursor.execute("""
            SELECT nr_atendimento, nm_paciente, leito, setor_ocupacao,
                   cd_setor_atendimento, setor_sa_id, setor_sa_nome, setor_sa_sigla,
                   dt_entrada_unidade, qt_dia_permanencia, ds_clinica,
                   medico_responsavel, ds_convenio, ds_tipo_acomodacao,
                   ultima_ronda_em, horas_desde_ultima_ronda, prioridade
            FROM vw_sentir_agir_fila_pacientes LIMIT %s
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
            if item.get('qt_dia_permanencia') is not None:
                item['qt_dia_permanencia'] = int(item['qt_dia_permanencia'])
            resultado.append(item)

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
        cursor.execute("""
            SELECT nr_atendimento, nm_paciente, leito, setor_ocupacao,
                   cd_setor_atendimento, setor_sa_id, setor_sa_nome, setor_sa_sigla,
                   dt_entrada_unidade, qt_dia_permanencia, ds_clinica,
                   medico_responsavel, ds_convenio, ds_tipo_acomodacao,
                   ultima_ronda_em, horas_desde_ultima_ronda, prioridade
            FROM vw_sentir_agir_fila_pacientes LIMIT 1
        """)
        paciente = cursor.fetchone()
        cursor.close()
        conn.close()

        if not paciente:
            return jsonify({'success': True, 'data': None, 'message': 'Nenhum paciente na fila'})

        item = dict(paciente)
        for campo in ('dt_entrada_unidade', 'ultima_ronda_em'):
            if item.get(campo):
                item[campo] = item[campo].isoformat()
        if item.get('horas_desde_ultima_ronda') is not None:
            item['horas_desde_ultima_ronda'] = round(float(item['horas_desde_ultima_ronda']), 1)
        if item.get('qt_dia_permanencia') is not None:
            item['qt_dia_permanencia'] = int(item['qt_dia_permanencia'])

        return jsonify({'success': True, 'data': item})
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
        cursor.execute("UPDATE sentir_agir_rondas SET status = 'concluida', atualizado_em = NOW() WHERE id = %s", (ronda_id,))
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

        # Inserir avaliações e detectar items críticos
        avaliacoes_criticas = []  # lista de (avaliacao_id, item_id)

        for av in avaliacoes:
            cursor.execute("""
                INSERT INTO sentir_agir_avaliacoes (visita_id, item_id, resultado)
                VALUES (%s, %s, %s)
                RETURNING id
            """, (visita_id, av['item_id'], av['resultado']))
            avaliacao_id = cursor.fetchone()['id']

            # Se for critico ou nao, marcar pra criar tratativa
            if av['resultado'] in ('critico', 'nao'):
                avaliacoes_criticas.append((avaliacao_id, av['item_id']))

        # Verificar se criação automática está ativa
        auto_criar = _get_config(cursor, 'tratativa_auto_criar', 'true')
        tratativas_criadas = 0

        if auto_criar == 'true' and avaliacoes_criticas:
            for avaliacao_id, item_id in avaliacoes_criticas:
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

                # Tentar encontrar responsável: primeiro por categoria, depois por setor
                responsavel_id = None
                cursor.execute("""
                    SELECT id FROM sentir_agir_responsaveis
                    WHERE categoria_id = %s AND ativo = TRUE
                    ORDER BY id LIMIT 1
                """, (item_info['categoria_id'],))
                resp = cursor.fetchone()
                if resp:
                    responsavel_id = resp['id']
                else:
                    # Fallback: por setor
                    cursor.execute("""
                        SELECT id FROM sentir_agir_responsaveis
                        WHERE setor_id = %s AND ativo = TRUE
                        ORDER BY id LIMIT 1
                    """, (setor_id,))
                    resp = cursor.fetchone()
                    if resp:
                        responsavel_id = resp['id']

                # Montar descricao do problema
                desc = 'Item: ' + item_info['item_descricao']
                desc += ' | Categoria: ' + item_info['categoria_nome']
                desc += ' | Paciente: ' + (nm_paciente or 'N/I')
                desc += ' | Leito: ' + leito
                if observacoes:
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
        return jsonify({'success': True, 'data': {'id': imagem_id, 'caminho': caminho_relativo}, 'message': 'Imagem enviada'}), 201
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

        # Remover tratativas e avaliacoes antigas
        cursor.execute("DELETE FROM sentir_agir_tratativas WHERE visita_id = %s", (visita_id,))
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
            if av['resultado'] in ('critico', 'nao'):
                avaliacoes_criticas.append((avaliacao_id, av['item_id']))

        auto_criar = _get_config(cursor, 'tratativa_auto_criar', 'true')
        tratativas_criadas = 0

        if auto_criar == 'true' and avaliacoes_criticas:
            for avaliacao_id, item_id in avaliacoes_criticas:
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
                responsavel_id = None
                cursor.execute("""
                    SELECT id FROM sentir_agir_responsaveis
                    WHERE categoria_id = %s AND ativo = TRUE ORDER BY id LIMIT 1
                """, (item_info['categoria_id'],))
                resp = cursor.fetchone()
                if resp:
                    responsavel_id = resp['id']
                else:
                    cursor.execute("""
                        SELECT id FROM sentir_agir_responsaveis
                        WHERE setor_id = %s AND ativo = TRUE ORDER BY id LIMIT 1
                    """, (visita['setor_id'],))
                    resp = cursor.fetchone()
                    if resp:
                        responsavel_id = resp['id']

                cursor.execute("""
                    INSERT INTO sentir_agir_tratativas
                        (visita_id, avaliacao_id, item_id, categoria_id, responsavel_id, descricao_problema, status)
                    VALUES (%s, %s, %s, %s, %s, %s, 'pendente')
                """, (visita_id, avaliacao_id, item_id, item_info['categoria_id'], responsavel_id,
                      'Item: %s | Categoria: %s | Obs: %s' % (
                          item_info['item_descricao'], item_info['categoria_nome'], observacoes or '')))
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
            msg += '. %d tratativa(s) recriada(s).' % tratativas_criadas
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