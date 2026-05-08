"""
Painel 34 - Solicitacao de Padioleiro
Endpoints para solicitacao de transporte de pacientes pelos enfermeiros/usuarios
"""
from flask import Blueprint, jsonify, request, send_from_directory, session, current_app
from datetime import datetime
from psycopg2.extras import RealDictCursor
from backend.database import get_db_connection, release_connection
from backend.middleware.decorators import login_required
from backend.user_management import verificar_permissao_painel

painel34_bp = Blueprint('painel34', __name__)


@painel34_bp.route('/painel/painel34')
@login_required
def painel34():
    usuario_id = session.get('usuario_id')
    is_admin = session.get('is_admin', False)
    if not is_admin:
        if not verificar_permissao_painel(usuario_id, 'painel34'):
            current_app.logger.warning(f'Acesso negado ao painel34: {session.get("usuario")}')
            return send_from_directory('frontend', 'acesso-negado.html')
    return send_from_directory('paineis/painel34', 'index.html')


# =========================================================
# API - TIPOS DE MOVIMENTO
# =========================================================

@painel34_bp.route('/api/paineis/painel34/tipos-movimento', methods=['GET'])
@login_required
def api_painel34_tipos_movimento():
    usuario_id = session.get('usuario_id')
    is_admin = session.get('is_admin', False)
    if not is_admin and not verificar_permissao_painel(usuario_id, 'painel34'):
        return jsonify({'success': False, 'error': 'Sem permissao'}), 403

    conn = get_db_connection()
    if not conn:
        return jsonify({'success': False, 'error': 'Erro de conexao'}), 500

    try:
        cursor = conn.cursor(cursor_factory=RealDictCursor)
        cursor.execute("""
            SELECT id, nome, icone, cor
            FROM padioleiro_tipos_movimento
            WHERE ativo = TRUE
            ORDER BY ordem, nome
        """)
        tipos = [dict(r) for r in cursor.fetchall()]
        cursor.close()
        release_connection(conn)
        return jsonify({'success': True, 'tipos': tipos})
    except Exception as e:
        current_app.logger.error(f'Erro tipos-movimento painel34: {e}', exc_info=True)
        if conn:
            release_connection(conn)
        return jsonify({'success': False, 'error': 'Erro ao buscar dados'}), 500


# =========================================================
# API - PACIENTES INTERNADOS (vw_ocupacao_hospitalar)
# =========================================================

@painel34_bp.route('/api/paineis/painel34/pacientes', methods=['GET'])
@login_required
def api_painel34_pacientes():
    usuario_id = session.get('usuario_id')
    is_admin = session.get('is_admin', False)
    if not is_admin and not verificar_permissao_painel(usuario_id, 'painel34'):
        return jsonify({'success': False, 'error': 'Sem permissao'}), 403

    q = (request.args.get('q') or '').strip()
    conn = get_db_connection()
    if not conn:
        return jsonify({'success': False, 'error': 'Erro de conexao'}), 500

    try:
        cursor = conn.cursor(cursor_factory=RealDictCursor)
        if q:
            cursor.execute("""
                SELECT nr_atendimento, paciente, leito, setor, clinica
                FROM vw_ocupacao_hospitalar
                WHERE status_leito = 'P'
                  AND (
                    LOWER(COALESCE(paciente, '')) LIKE LOWER(%s)
                    OR COALESCE(nr_atendimento, '') LIKE %s
                  )
                ORDER BY paciente
                LIMIT 30
            """, (f'%{q}%', f'%{q}%'))
        else:
            cursor.execute("""
                SELECT nr_atendimento, paciente, leito, setor, clinica
                FROM vw_ocupacao_hospitalar
                WHERE status_leito = 'P'
                ORDER BY paciente
                LIMIT 100
            """)
        pacientes = [dict(r) for r in cursor.fetchall()]
        cursor.close()
        release_connection(conn)
        return jsonify({'success': True, 'pacientes': pacientes})
    except Exception as e:
        current_app.logger.error(f'Erro pacientes painel34: {e}', exc_info=True)
        if conn:
            release_connection(conn)
        return jsonify({'success': False, 'error': 'Erro ao buscar pacientes'}), 500


# =========================================================
# API - SETORES DO HOSPITAL (vw_ocupacao_hospitalar)
# =========================================================

@painel34_bp.route('/api/paineis/painel34/setores', methods=['GET'])
@login_required
def api_painel34_setores():
    usuario_id = session.get('usuario_id')
    is_admin = session.get('is_admin', False)
    if not is_admin and not verificar_permissao_painel(usuario_id, 'painel34'):
        return jsonify({'success': False, 'error': 'Sem permissao'}), 403

    conn = get_db_connection()
    if not conn:
        return jsonify({'success': False, 'error': 'Erro de conexao'}), 500

    try:
        cursor = conn.cursor(cursor_factory=RealDictCursor)
        cursor.execute("""
            SELECT DISTINCT setor AS nome
            FROM vw_ocupacao_hospitalar
            WHERE setor IS NOT NULL AND TRIM(setor) != ''
            ORDER BY setor
        """)
        setores = [dict(r) for r in cursor.fetchall()]
        cursor.close()
        release_connection(conn)
        return jsonify({'success': True, 'setores': setores})
    except Exception as e:
        current_app.logger.error(f'Erro setores painel34: {e}', exc_info=True)
        if conn:
            release_connection(conn)
        return jsonify({'success': False, 'error': 'Erro ao buscar setores'}), 500


# =========================================================
# API - SETORES DE DESTINO (vw_ocupacao_hospitalar)
# =========================================================

@painel34_bp.route('/api/paineis/painel34/destinos', methods=['GET'])
@login_required
def api_painel34_destinos():
    usuario_id = session.get('usuario_id')
    is_admin = session.get('is_admin', False)
    if not is_admin and not verificar_permissao_painel(usuario_id, 'painel34'):
        return jsonify({'success': False, 'error': 'Sem permissao'}), 403

    tipo_id = request.args.get('tipo_id')

    conn = get_db_connection()
    if not conn:
        return jsonify({'success': False, 'error': 'Erro de conexao'}), 500

    try:
        cursor = conn.cursor(cursor_factory=RealDictCursor)
        
        # Se um tipo de movimento foi fornecido, tenta buscar os destinos específicos dele (painel 36)
        if tipo_id:
            cursor.execute("""
                SELECT nome
                FROM padioleiro_destinos
                WHERE tipo_movimento_id = %s AND ativo = TRUE
                ORDER BY ordem, nome
            """, (tipo_id,))
            destinos_cadastrados = [dict(r) for r in cursor.fetchall()]
            
            # Se esse tipo de movimento tiver destinos específicos, retorna eles
            if destinos_cadastrados:
                cursor.close()
                release_connection(conn)
                return jsonify({'success': True, 'destinos': destinos_cadastrados})

        # Fallback padrão: Retorna os setores de internação
        cursor.execute("""
            SELECT DISTINCT setor AS nome
            FROM vw_ocupacao_hospitalar
            WHERE setor IS NOT NULL AND TRIM(setor) != ''
            ORDER BY setor
        """)
        destinos = [dict(r) for r in cursor.fetchall()]
        cursor.close()
        release_connection(conn)
        return jsonify({'success': True, 'destinos': destinos})
    except Exception as e:
        current_app.logger.error(f'Erro destinos painel34: {e}', exc_info=True)
        if conn:
            release_connection(conn)
        return jsonify({'success': False, 'error': 'Erro ao buscar destinos'}), 500


# =========================================================
# API - CRIAR CHAMADO
# =========================================================

@painel34_bp.route('/api/paineis/painel34/solicitar', methods=['POST'])
@login_required
def api_painel34_solicitar():
    usuario_id = session.get('usuario_id')
    is_admin = session.get('is_admin', False)
    if not is_admin and not verificar_permissao_painel(usuario_id, 'painel34'):
        return jsonify({'success': False, 'error': 'Sem permissao'}), 403

    dados = request.get_json() or {}

    tipo_movimento_id   = dados.get('tipo_movimento_id')
    tipo_movimento_nome = (dados.get('tipo_movimento_nome') or '').strip()
    nm_paciente         = (dados.get('nm_paciente') or '').strip()
    nr_atendimento      = (dados.get('nr_atendimento') or '').strip()
    leito_origem        = (dados.get('leito_origem') or '').strip()
    setor_origem_nome   = (dados.get('setor_origem_nome') or '').strip()
    destino_nome        = (dados.get('destino_nome') or '').strip()
    destino_complemento = (dados.get('destino_complemento') or '').strip()
    observacao          = (dados.get('observacao') or '').strip()
    prioridade          = dados.get('prioridade', 'normal')

    if not tipo_movimento_id or not setor_origem_nome or not destino_nome:
        return jsonify({'success': False, 'error': 'Tipo de movimento, setor de origem e destino sao obrigatorios'}), 400

    if prioridade not in ('normal', 'urgente'):
        prioridade = 'normal'

    conn = get_db_connection()
    if not conn:
        return jsonify({'success': False, 'error': 'Erro de conexao'}), 500

    try:
        cursor = conn.cursor(cursor_factory=RealDictCursor)
        solicitante_nome = session.get('nome_completo') or session.get('usuario', 'Desconhecido')

        cursor.execute("""
            INSERT INTO padioleiro_chamados (
                tipo_movimento_id, tipo_movimento_nome,
                nm_paciente, nr_atendimento,
                leito_origem, setor_origem_nome,
                destino_nome, destino_complemento,
                observacao, prioridade,
                status, solicitante_id, solicitante_nome,
                criado_em
            ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, 'aguardando', %s, %s, NOW())
            RETURNING id, criado_em
        """, (
            tipo_movimento_id, tipo_movimento_nome,
            nm_paciente or None, nr_atendimento or None,
            leito_origem or None, setor_origem_nome,
            destino_nome, destino_complemento or None,
            observacao or None, prioridade,
            usuario_id, solicitante_nome
        ))

        row = cursor.fetchone()
        conn.commit()
        cursor.close()
        release_connection(conn)

        return jsonify({
            'success': True,
            'chamado_id': row['id'],
            'message': 'Chamado registrado com sucesso'
        }), 201

    except Exception as e:
        current_app.logger.error(f'Erro solicitar painel34: {e}', exc_info=True)
        if conn:
            conn.rollback()
            release_connection(conn)
        return jsonify({'success': False, 'error': 'Erro ao criar chamado'}), 500


# =========================================================
# API - MEUS CHAMADOS (ultimas 24h do usuario logado)
# =========================================================

@painel34_bp.route('/api/paineis/painel34/meus-chamados', methods=['GET'])
@login_required
def api_painel34_meus_chamados():
    usuario_id = session.get('usuario_id')
    is_admin = session.get('is_admin', False)
    if not is_admin and not verificar_permissao_painel(usuario_id, 'painel34'):
        return jsonify({'success': False, 'error': 'Sem permissao'}), 403

    conn = get_db_connection()
    if not conn:
        return jsonify({'success': False, 'error': 'Erro de conexao'}), 500

    try:
        cursor = conn.cursor(cursor_factory=RealDictCursor)
        cursor.execute("""
            SELECT
                id, tipo_movimento_nome, nm_paciente, nr_atendimento,
                leito_origem, setor_origem_nome, destino_nome,
                prioridade, status, solicitante_nome,
                padioleiro_nome, observacao,
                criado_em, dt_aceite, dt_inicio_transporte,
                dt_conclusao, dt_cancelamento, motivo_cancelamento,
                EXTRACT(EPOCH FROM (NOW() - criado_em)) / 60 AS minutos_desde_abertura
            FROM padioleiro_chamados
            WHERE solicitante_id = %s
              AND criado_em >= NOW() - INTERVAL '24 hours'
            ORDER BY criado_em DESC
            LIMIT 20
        """, (usuario_id,))

        chamados = []
        for row in cursor.fetchall():
            c = dict(row)
            for campo in ['criado_em', 'dt_aceite', 'dt_inicio_transporte',
                          'dt_conclusao', 'dt_cancelamento']:
                if c.get(campo) and isinstance(c[campo], datetime):
                    c[campo] = c[campo].isoformat()
            if c.get('minutos_desde_abertura') is not None:
                c['minutos_desde_abertura'] = round(float(c['minutos_desde_abertura']), 1)
            chamados.append(c)

        cursor.close()
        release_connection(conn)
        return jsonify({'success': True, 'chamados': chamados, 'total': len(chamados)})

    except Exception as e:
        current_app.logger.error(f'Erro meus-chamados painel34: {e}', exc_info=True)
        if conn:
            release_connection(conn)
        return jsonify({'success': False, 'error': 'Erro ao buscar chamados'}), 500


# =========================================================
# API - CANCELAR CHAMADO
# =========================================================

@painel34_bp.route('/api/paineis/painel34/chamados/<int:chamado_id>/cancelar', methods=['PUT'])
@login_required
def api_painel34_cancelar(chamado_id):
    usuario_id = session.get('usuario_id')
    is_admin = session.get('is_admin', False)
    if not is_admin and not verificar_permissao_painel(usuario_id, 'painel34'):
        return jsonify({'success': False, 'error': 'Sem permissao'}), 403

    dados = request.get_json() or {}
    motivo = (dados.get('motivo') or 'Cancelado pelo solicitante').strip()

    conn = get_db_connection()
    if not conn:
        return jsonify({'success': False, 'error': 'Erro de conexao'}), 500

    try:
        cursor = conn.cursor(cursor_factory=RealDictCursor)
        cursor.execute(
            "SELECT id, status, solicitante_id FROM padioleiro_chamados WHERE id = %s",
            (chamado_id,)
        )
        chamado = cursor.fetchone()

        if not chamado:
            cursor.close()
            release_connection(conn)
            return jsonify({'success': False, 'error': 'Chamado nao encontrado'}), 404

        if not is_admin and chamado['solicitante_id'] != usuario_id:
            cursor.close()
            release_connection(conn)
            return jsonify({'success': False, 'error': 'Sem permissao para cancelar este chamado'}), 403

        if chamado['status'] not in ('aguardando', 'aceito'):
            cursor.close()
            release_connection(conn)
            return jsonify({
                'success': False,
                'error': f'Chamado nao pode ser cancelado no status: {chamado["status"]}'
            }), 400

        cursor.execute("""
            UPDATE padioleiro_chamados
            SET status = 'cancelado',
                dt_cancelamento = NOW(),
                motivo_cancelamento = %s,
                atualizado_em = NOW()
            WHERE id = %s
        """, (motivo, chamado_id))

        conn.commit()
        cursor.close()
        release_connection(conn)
        return jsonify({'success': True, 'message': 'Chamado cancelado com sucesso'})

    except Exception as e:
        current_app.logger.error(f'Erro cancelar painel34: {e}', exc_info=True)
        if conn:
            conn.rollback()
            release_connection(conn)
        return jsonify({'success': False, 'error': 'Erro ao cancelar chamado'}), 500
