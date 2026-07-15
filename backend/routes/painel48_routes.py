"""
Painel 48 - HUB de Assinaturas Digitais
Coleta e armazena assinaturas eletrônicas simples (AES) via Signature Pad JS.
Nível legal: AES (Lei 14.063/2020) - suficiente para uso hospitalar interno.
PIN de coleta = matrícula do funcionário em nutricao_cadastros.
"""
from flask import Blueprint, jsonify, send_from_directory, session, request, current_app
from datetime import datetime, date
from decimal import Decimal
from backend.database import get_db_cursor
from backend.middleware.decorators import login_required, panel_permission_required, admin_required
import hashlib

painel48_bp = Blueprint('painel48', __name__)


def _serial(row):
    resultado = {}
    for k, v in row.items():
        if isinstance(v, (datetime, date)):
            resultado[k] = v.isoformat()
        elif isinstance(v, Decimal):
            resultado[k] = float(v)
        else:
            resultado[k] = v
    return resultado


# ── Página HTML ───────────────────────────────────────────────

@painel48_bp.route('/painel/painel48')
@login_required
@panel_permission_required('painel48')
def painel48():
    return send_from_directory('paineis/painel48', 'index.html')


# ── Contextos disponíveis para o usuário ─────────────────────

@painel48_bp.route('/api/paineis/painel48/contextos')
@login_required
@panel_permission_required('painel48')
def api_p48_contextos():
    """
    Retorna os contextos de assinatura disponíveis para o usuário.
    Admins veem todos; outros usuários veem apenas os que têm permissão.
    """
    try:
        usuario_id = session.get('usuario_id')
        is_admin   = session.get('is_admin', False)

        with get_db_cursor() as cursor:
            if is_admin:
                cursor.execute("""
                    SELECT id, codigo, nome, descricao, icone, cor, ativo, ordem
                    FROM assinaturas_contextos
                    WHERE ativo = TRUE
                    ORDER BY ordem, nome
                """)
            else:
                cursor.execute("""
                    SELECT ac.id, ac.codigo, ac.nome, ac.descricao, ac.icone, ac.cor, ac.ativo, ac.ordem
                    FROM assinaturas_contextos ac
                    JOIN assinaturas_permissoes_contexto apc
                      ON apc.contexto_codigo = ac.codigo
                     AND apc.usuario_id = %s
                     AND apc.ativo = TRUE
                    WHERE ac.ativo = TRUE
                    ORDER BY ac.ordem, ac.nome
                """, (usuario_id,))

            contextos = [dict(r) for r in cursor.fetchall()]

        return jsonify({'success': True, 'contextos': contextos})

    except Exception as e:
        current_app.logger.error('Erro contextos p48: %s', e, exc_info=True)
        return jsonify({'success': False, 'error': 'Erro ao buscar contextos'}), 500


# ── Validar PIN (matrícula) ───────────────────────────────────

@painel48_bp.route('/api/paineis/painel48/validar-pin', methods=['POST'])
@login_required
@panel_permission_required('painel48')
def api_p48_validar_pin():
    """
    Valida a matrícula do funcionário (PIN) antes de registrar a assinatura.
    Consulta nutricao_cadastros (equipe da nutrição no painel 43).
    """
    try:
        dados = request.get_json() or {}
        matricula = (dados.get('matricula') or '').strip()
        if not matricula:
            return jsonify({'success': False, 'error': 'Matrícula não informada'}), 400

        with get_db_cursor() as cursor:
            cursor.execute("""
                SELECT id, nome, matricula, funcao, turno
                FROM nutricao_cadastros
                WHERE matricula = %s AND ativo = TRUE
                LIMIT 1
            """, (matricula,))
            membro = cursor.fetchone()

        if not membro:
            return jsonify({'success': False, 'error': 'Matrícula não encontrada ou inativa'}), 404

        return jsonify({
            'success': True,
            'membro': {
                'id':        membro['id'],
                'nome':      membro['nome'],
                'matricula': membro['matricula'],
                'funcao':    membro['funcao'],
                'turno':     membro['turno']
            }
        })

    except Exception as e:
        current_app.logger.error('Erro validar-pin p48: %s', e, exc_info=True)
        return jsonify({'success': False, 'error': 'Erro ao validar matrícula'}), 500


# ── Registrar assinatura ──────────────────────────────────────

@painel48_bp.route('/api/paineis/painel48/assinar', methods=['POST'])
@login_required
@panel_permission_required('painel48')
def api_p48_assinar():
    """
    Salva uma assinatura eletrônica simples (AES).
    Auditoria: timestamp servidor, IP, usuário logado, matrícula validada.
    """
    try:
        dados = request.get_json() or {}

        assinatura_img = (dados.get('assinatura_img') or '').strip()
        if assinatura_img and not assinatura_img.startswith('data:image/png;base64,'):
            return jsonify({'success': False, 'error': 'Imagem de assinatura inválida'}), 400

        contexto = (dados.get('contexto') or '').strip()
        if not contexto:
            return jsonify({'success': False, 'error': 'Contexto obrigatório'}), 400

        nm_signatario = (dados.get('nm_signatario') or '').strip()
        if not nm_signatario:
            return jsonify({'success': False, 'error': 'Nome do assinante obrigatório'}), 400

        matricula_pin = (dados.get('matricula_pin') or '').strip()
        if not matricula_pin:
            return jsonify({'success': False, 'error': 'PIN (matrícula) obrigatório'}), 400

        # Validar PIN
        with get_db_cursor() as cursor:
            cursor.execute("""
                SELECT id, nome, matricula FROM nutricao_cadastros
                WHERE matricula = %s AND ativo = TRUE LIMIT 1
            """, (matricula_pin,))
            membro = cursor.fetchone()

        if not membro:
            return jsonify({'success': False, 'error': 'PIN (matrícula) inválido ou inativo'}), 403

        # Montar conteúdo do documento para hash de integridade
        conteudo_json = dados.get('conteudo_json') or '{}'
        hash_conteudo = hashlib.sha256(conteudo_json.encode('utf-8')).hexdigest()

        ip = request.headers.get('X-Forwarded-For', request.remote_addr)
        ua = request.headers.get('User-Agent', '')

        ref_id = dados.get('ref_id')
        if ref_id is not None:
            try:
                ref_id = int(ref_id)
            except (ValueError, TypeError):
                ref_id = None

        nm_signatario_cpf = (dados.get('nm_signatario_cpf') or '').strip() or None

        # AES: ao menos assinatura desenhada OU CPF identificado
        if not assinatura_img and not nm_signatario_cpf:
            return jsonify({'success': False,
                            'error': 'Informe a assinatura manuscrita ou o CPF do assinante'}), 400

        with get_db_cursor(use_dict_cursor=False) as cursor:
            cursor.execute("""
                INSERT INTO assinaturas_digitais
                    (contexto, ref_tabela, ref_id, nr_atendimento,
                     nm_signatario, nm_signatario_cpf, qualidade_signatario,
                     assinatura_img, foto_signatario,
                     hash_conteudo, conteudo_json,
                     ip_origem, user_agent,
                     coletado_por_id, coletado_por_nome,
                     coletado_por_matricula, coletado_por_nome_equipe)
                VALUES (%s, %s, %s, %s,
                        %s, %s, %s,
                        %s, %s,
                        %s, %s,
                        %s, %s,
                        %s, %s,
                        %s, %s)
                RETURNING id, criado_em
            """, (
                contexto,
                dados.get('ref_tabela'),
                ref_id,
                dados.get('nr_atendimento'),
                nm_signatario,
                nm_signatario_cpf,
                dados.get('qualidade_signatario', 'paciente'),
                assinatura_img or None,
                dados.get('foto_signatario'),
                hash_conteudo,
                conteudo_json,
                ip, ua,
                session.get('usuario_id'),
                session.get('nome_completo'),
                membro['matricula'],
                membro['nome']
            ))
            row = cursor.fetchone()

        usuario = session.get('nome_completo') or session.get('usuario', '')
        current_app.logger.info(
            'P48 assinatura: id=%s contexto=%s ref_id=%s por=%s pin=%s',
            row[0], contexto, ref_id, usuario, matricula_pin
        )

        return jsonify({
            'success':   True,
            'id':        row[0],
            'criado_em': row[1].isoformat(),
            'coletor':   membro['nome']
        })

    except Exception as e:
        current_app.logger.error('Erro assinar p48: %s', e, exc_info=True)
        return jsonify({'success': False, 'error': 'Erro ao registrar assinatura'}), 500


# ── Fila de entregas aguardando assinatura (entrega_refeicao) ──

@painel48_bp.route('/api/paineis/painel48/fila-entrega')
@login_required
def api_p48_fila_entrega():
    """Retorna solicitações em status 'em_entrega' com flag se já possuem assinatura."""
    try:
        with get_db_cursor() as cursor:
            cursor.execute("""
                SELECT
                    ns.id,
                    ns.codigo_entrega,
                    ns.nm_paciente,
                    ns.nr_atendimento,
                    ns.leito,
                    ns.setor_nome,
                    ns.tipo_dieta_nome,
                    ns.refeicao_nome,
                    ns.prioridade,
                    ns.responsavel_nome,
                    ns.entregue_por,
                    TO_CHAR(ns.dt_inicio_entrega, 'HH24:MI') AS dt_inicio_entrega,
                    GREATEST(
                        EXTRACT(EPOCH FROM (NOW() - ns.dt_inicio_entrega))::int / 60,
                        0
                    ) AS minutos,
                    CASE WHEN ad.id IS NOT NULL THEN TRUE ELSE FALSE END AS ja_assinado
                FROM nutricao_solicitacoes ns
                LEFT JOIN assinaturas_digitais ad
                    ON ad.ref_id = ns.id AND ad.contexto = 'entrega_refeicao'
                WHERE ns.status = 'em_entrega'
                ORDER BY
                    CASE ns.prioridade WHEN 'urgente' THEN 0 ELSE 1 END,
                    ns.dt_inicio_entrega ASC
            """)
            fila = [dict(r) for r in cursor.fetchall()]
        return jsonify({'success': True, 'fila': fila})
    except Exception as e:
        current_app.logger.error('Erro fila-entrega p48: %s', e, exc_info=True)
        return jsonify({'success': False, 'error': 'Erro ao buscar fila'}), 500


# ── Buscar assinatura por contexto + ref_id ───────────────────

@painel48_bp.route('/api/paineis/painel48/assinatura')
@login_required
@panel_permission_required('painel48')
def api_p48_buscar():
    contexto = request.args.get('contexto', '')
    ref_id   = request.args.get('ref_id', '')
    if not contexto or not ref_id:
        return jsonify({'success': False, 'error': 'Parâmetros obrigatórios: contexto, ref_id'}), 400
    try:
        with get_db_cursor() as cursor:
            cursor.execute("""
                SELECT id, nm_signatario, nm_signatario_cpf, qualidade_signatario, assinatura_img,
                       criado_em, coletado_por_nome, coletado_por_nome_equipe,
                       nr_atendimento, contexto, hash_conteudo
                FROM assinaturas_digitais
                WHERE contexto = %s AND ref_id = %s
                ORDER BY criado_em DESC LIMIT 1
            """, (contexto, int(ref_id)))
            row = cursor.fetchone()

        if not row:
            return jsonify({'success': True, 'assinatura': None})
        return jsonify({'success': True, 'assinatura': _serial(dict(row))})

    except Exception as e:
        current_app.logger.error('Erro buscar assinatura p48: %s', e, exc_info=True)
        return jsonify({'success': False, 'error': 'Erro ao buscar assinatura'}), 500


# ── Histórico de assinaturas ──────────────────────────────────

@painel48_bp.route('/api/paineis/painel48/historico')
@login_required
@panel_permission_required('painel48')
def api_p48_historico():
    """
    Lista assinaturas registradas.
    ?contexto=  (obrigatório)
    ?data=YYYY-MM-DD  (padrão: hoje)
    ?nr_atendimento=
    """
    try:
        contexto        = request.args.get('contexto', '')
        data_str        = request.args.get('data', datetime.now().strftime('%Y-%m-%d'))
        nr_atendimento  = request.args.get('nr_atendimento', '').strip()

        if not contexto:
            return jsonify({'success': False, 'error': 'Parâmetro contexto obrigatório'}), 400

        filtros = ['contexto = %s', 'DATE(criado_em) = %s']
        params  = [contexto, data_str]

        if nr_atendimento:
            filtros.append('nr_atendimento = %s')
            params.append(nr_atendimento)

        with get_db_cursor() as cursor:
            cursor.execute("""
                SELECT id, nm_signatario, qualidade_signatario,
                       nr_atendimento, ref_id,
                       coletado_por_nome, coletado_por_nome_equipe,
                       hash_conteudo, criado_em
                FROM assinaturas_digitais
                WHERE {}
                ORDER BY criado_em DESC
                LIMIT 200
            """.format(' AND '.join(filtros)), params)
            historico = [_serial(dict(r)) for r in cursor.fetchall()]

        return jsonify({'success': True, 'historico': historico, 'total': len(historico)})

    except Exception as e:
        current_app.logger.error('Erro historico p48: %s', e, exc_info=True)
        return jsonify({'success': False, 'error': 'Erro ao buscar histórico'}), 500


# ── Visualizar assinatura por ID (para comprovante) ───────────

@painel48_bp.route('/api/paineis/painel48/assinatura/<int:assinatura_id>')
@login_required
@panel_permission_required('painel48')
def api_p48_detalhe(assinatura_id):
    try:
        with get_db_cursor() as cursor:
            cursor.execute("""
                SELECT id, contexto, ref_id, nm_signatario, qualidade_signatario,
                       assinatura_img, nr_atendimento, hash_conteudo, conteudo_json,
                       coletado_por_nome, coletado_por_nome_equipe,
                       ip_origem, criado_em
                FROM assinaturas_digitais WHERE id = %s
            """, (assinatura_id,))
            row = cursor.fetchone()

        if not row:
            return jsonify({'success': False, 'error': 'Assinatura não encontrada'}), 404
        return jsonify({'success': True, 'assinatura': _serial(dict(row))})

    except Exception as e:
        current_app.logger.error('Erro detalhe p48: %s', e, exc_info=True)
        return jsonify({'success': False, 'error': 'Erro ao buscar assinatura'}), 500


# ── Admin: gerenciar contextos ────────────────────────────────

@painel48_bp.route('/api/paineis/painel48/admin/contextos', methods=['GET', 'POST'])
@login_required
@admin_required
def api_p48_admin_contextos():
    if request.method == 'GET':
        try:
            with get_db_cursor() as cursor:
                cursor.execute("""
                    SELECT id, codigo, nome, descricao, icone, cor, ativo, ordem
                    FROM assinaturas_contextos ORDER BY ordem, nome
                """)
                return jsonify({'success': True, 'contextos': [dict(r) for r in cursor.fetchall()]})
        except Exception as e:
            current_app.logger.error('Erro admin contextos GET p48: %s', e, exc_info=True)
            return jsonify({'success': False, 'error': 'Erro ao buscar contextos'}), 500

    # POST — criar novo contexto
    try:
        dados  = request.get_json() or {}
        codigo = (dados.get('codigo') or '').strip()
        nome   = (dados.get('nome')   or '').strip()
        if not codigo or not nome:
            return jsonify({'success': False, 'error': 'Código e nome são obrigatórios'}), 400

        with get_db_cursor(use_dict_cursor=False) as cursor:
            cursor.execute("""
                INSERT INTO assinaturas_contextos (codigo, nome, descricao, icone, cor, ativo, ordem)
                VALUES (%s, %s, %s, %s, %s, %s, %s)
                RETURNING id
            """, (
                codigo, nome,
                dados.get('descricao'),
                dados.get('icone', 'fa-signature'),
                dados.get('cor', '#0d6efd'),
                bool(dados.get('ativo', True)),
                int(dados.get('ordem', 0))
            ))
            novo_id = cursor.fetchone()[0]

        return jsonify({'success': True, 'id': novo_id})

    except Exception as e:
        current_app.logger.error('Erro admin contextos POST p48: %s', e, exc_info=True)
        return jsonify({'success': False, 'error': 'Erro ao criar contexto'}), 500


_CAMPOS_CONTEXTO = ('nome', 'descricao', 'icone', 'cor', 'ativo', 'ordem')


@painel48_bp.route('/api/paineis/painel48/admin/contextos/<int:ctx_id>', methods=['PUT'])
@login_required
@admin_required
def api_p48_admin_contexto_update(ctx_id):
    try:
        dados = request.get_json() or {}
        sets, vals = [], []
        for campo in _CAMPOS_CONTEXTO:
            if campo in dados:
                sets.append('{} = %s'.format(campo))
                vals.append(dados[campo])
        if not sets:
            return jsonify({'success': False, 'error': 'Nenhum campo para atualizar'}), 400
        vals.append(ctx_id)
        with get_db_cursor(use_dict_cursor=False) as cursor:
            cursor.execute(
                'UPDATE assinaturas_contextos SET {} WHERE id = %s'.format(', '.join(sets)),
                vals
            )
        return jsonify({'success': True})
    except Exception as e:
        current_app.logger.error('Erro admin contexto PUT p48: %s', e, exc_info=True)
        return jsonify({'success': False, 'error': 'Erro ao atualizar contexto'}), 500


# ── Admin: gerenciar permissões de usuários ───────────────────

@painel48_bp.route('/api/paineis/painel48/admin/permissoes', methods=['GET', 'POST'])
@login_required
@admin_required
def api_p48_admin_permissoes():
    if request.method == 'GET':
        try:
            contexto = request.args.get('contexto', '')
            filtro   = 'WHERE apc.contexto_codigo = %s' if contexto else ''
            params   = [contexto] if contexto else []
            with get_db_cursor() as cursor:
                cursor.execute("""
                    SELECT apc.id, apc.usuario_id, u.usuario, u.nome_completo,
                           apc.contexto_codigo, ac.nome AS contexto_nome,
                           apc.ativo, apc.criado_em
                    FROM assinaturas_permissoes_contexto apc
                    JOIN usuarios u ON u.id = apc.usuario_id
                    JOIN assinaturas_contextos ac ON ac.codigo = apc.contexto_codigo
                    {}
                    ORDER BY ac.nome, u.nome_completo
                """.format(filtro), params)
                return jsonify({'success': True, 'permissoes': [_serial(dict(r)) for r in cursor.fetchall()]})
        except Exception as e:
            current_app.logger.error('Erro admin permissoes GET p48: %s', e, exc_info=True)
            return jsonify({'success': False, 'error': 'Erro ao buscar permissões'}), 500

    # POST — conceder permissão
    try:
        dados      = request.get_json() or {}
        usuario_id = dados.get('usuario_id')
        codigo     = (dados.get('contexto_codigo') or '').strip()
        if not usuario_id or not codigo:
            return jsonify({'success': False, 'error': 'usuario_id e contexto_codigo obrigatórios'}), 400

        with get_db_cursor(use_dict_cursor=False) as cursor:
            cursor.execute("""
                INSERT INTO assinaturas_permissoes_contexto (usuario_id, contexto_codigo, ativo)
                VALUES (%s, %s, TRUE)
                ON CONFLICT (usuario_id, contexto_codigo)
                DO UPDATE SET ativo = TRUE
                RETURNING id
            """, (int(usuario_id), codigo))
            perm_id = cursor.fetchone()[0]

        return jsonify({'success': True, 'id': perm_id})

    except Exception as e:
        current_app.logger.error('Erro admin permissoes POST p48: %s', e, exc_info=True)
        return jsonify({'success': False, 'error': 'Erro ao conceder permissão'}), 500


@painel48_bp.route('/api/paineis/painel48/admin/permissoes/<int:perm_id>', methods=['DELETE'])
@login_required
@admin_required
def api_p48_admin_permissao_delete(perm_id):
    try:
        with get_db_cursor(use_dict_cursor=False) as cursor:
            cursor.execute(
                'UPDATE assinaturas_permissoes_contexto SET ativo = FALSE WHERE id = %s',
                (perm_id,)
            )
        return jsonify({'success': True})
    except Exception as e:
        current_app.logger.error('Erro admin permissao DELETE p48: %s', e, exc_info=True)
        return jsonify({'success': False, 'error': 'Erro ao revogar permissão'}), 500


# ── Admin: listar usuários (para seletor de permissões) ──────

@painel48_bp.route('/api/paineis/painel48/admin/usuarios')
@login_required
@admin_required
def api_p48_admin_usuarios():
    try:
        with get_db_cursor() as cursor:
            cursor.execute("""
                SELECT id, usuario, nome_completo
                FROM usuarios WHERE ativo = TRUE
                ORDER BY nome_completo
            """)
            return jsonify({'success': True, 'usuarios': [dict(r) for r in cursor.fetchall()]})
    except Exception as e:
        current_app.logger.error('Erro admin usuarios p48: %s', e, exc_info=True)
        return jsonify({'success': False, 'error': 'Erro ao buscar usuários'}), 500
