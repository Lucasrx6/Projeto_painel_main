"""
Rotas de autenticação e gestão de dispositivos TV de plantão (T03)
"""
import secrets
from flask import Blueprint, jsonify, request, session, send_from_directory, current_app
from backend.database import get_db_cursor
from backend.middleware.decorators import admin_required

tv_bp = Blueprint('tv', __name__)


def _paineis_para_lista(paineis_str):
    """Converte 'painel4,painel10' → ['painel4', 'painel10']."""
    if not paineis_str:
        return []
    return [p.strip() for p in paineis_str.split(',') if p.strip()]


# ==============================================================================
# PÁGINA DE SETUP (ONE-TIME CONFIGURATION)
# ==============================================================================

@tv_bp.route('/tv/setup')
def tv_setup_page():
    """Serve a página de configuração de token para terminais de TV."""
    return send_from_directory('frontend', 'tv-setup.html')


# ==============================================================================
# LOGIN VIA TOKEN DE DISPOSITIVO
# ==============================================================================

@tv_bp.route('/api/tv-login', methods=['POST'])
def tv_login():
    """
    Autentica um terminal de TV via token de dispositivo.

    POST /api/tv-login
    Body: {"token": "<uuid-token>"}
    """
    dados = request.get_json() or {}
    token = str(dados.get('token', '')).strip()

    if not token:
        return jsonify({'success': False, 'error': 'Token não fornecido'}), 400

    try:
        with get_db_cursor() as cur:
            cur.execute("""
                SELECT id, nome, ativo, paineis
                FROM dispositivos_tv
                WHERE token = %s
            """, (token,))
            dispositivo = cur.fetchone()

        if not dispositivo:
            current_app.logger.warning(
                'TV login falhou — token inválido (IP: %s)', request.remote_addr
            )
            return jsonify({'success': False, 'error': 'Token inválido'}), 401

        if not dispositivo['ativo']:
            current_app.logger.warning(
                'TV login negado — dispositivo inativo: "%s"', dispositivo['nome']
            )
            return jsonify({'success': False, 'error': 'Dispositivo inativo'}), 403

        with get_db_cursor() as cur:
            cur.execute(
                "UPDATE dispositivos_tv SET ultimo_uso = NOW() WHERE id = %s",
                (dispositivo['id'],)
            )

        paineis = _paineis_para_lista(dispositivo['paineis'])

        session.clear()
        session.permanent = True
        session['usuario_id'] = 'tv:{}'.format(dispositivo['id'])
        session['usuario'] = 'TV:{}'.format(dispositivo['nome'])
        session['is_admin'] = False
        session['is_tv'] = True
        session['permissoes'] = paineis

        current_app.logger.info(
            'TV login OK: "%s" | paineis: %s | IP: %s',
            dispositivo['nome'], paineis, request.remote_addr
        )
        return jsonify({
            'success': True,
            'dispositivo': dispositivo['nome'],
            'paineis': paineis
        })

    except Exception as e:
        current_app.logger.error('Erro TV login: %s', e, exc_info=True)
        return jsonify({'success': False, 'error': 'Erro interno'}), 500


# ==============================================================================
# ADMIN — GESTÃO DE DISPOSITIVOS TV
# ==============================================================================

@tv_bp.route('/api/admin/tv-dispositivos', methods=['GET'])
@admin_required
def listar_tv_dispositivos():
    """Lista todos os dispositivos TV cadastrados."""
    try:
        with get_db_cursor() as cur:
            cur.execute("""
                SELECT id, nome, token, paineis, ativo,
                       TO_CHAR(criado_em, 'DD/MM/YYYY HH24:MI') AS criado_em,
                       TO_CHAR(ultimo_uso, 'DD/MM/YYYY HH24:MI') AS ultimo_uso
                FROM dispositivos_tv
                ORDER BY criado_em DESC
            """)
            dispositivos = [dict(r) for r in cur.fetchall()]
        return jsonify({'success': True, 'dispositivos': dispositivos})
    except Exception as e:
        current_app.logger.error('Erro listar TV dispositivos: %s', e, exc_info=True)
        return jsonify({'success': False, 'error': 'Erro ao listar dispositivos'}), 500


@tv_bp.route('/api/admin/tv-dispositivos', methods=['POST'])
@admin_required
def criar_tv_dispositivo():
    """
    Cria um novo dispositivo TV e retorna o token gerado.

    POST /api/admin/tv-dispositivos
    Body: {"nome": "TV Recepcao", "paineis": "painel4,painel10"}
    """
    try:
        dados = request.get_json() or {}
        nome = str(dados.get('nome', '')).strip()
        paineis = str(dados.get('paineis', '')).strip()

        if not nome:
            return jsonify({'success': False, 'error': 'Nome do dispositivo obrigatório'}), 400

        token = secrets.token_urlsafe(32)

        with get_db_cursor() as cur:
            cur.execute("""
                INSERT INTO dispositivos_tv (nome, token, paineis)
                VALUES (%s, %s, %s)
                RETURNING id
            """, (nome, token, paineis or None))
            novo_id = cur.fetchone()['id']

        current_app.logger.info(
            'TV dispositivo criado: "%s" (id=%s) por %s',
            nome, novo_id, session.get('usuario')
        )
        return jsonify({
            'success': True,
            'id': novo_id,
            'nome': nome,
            'token': token,
            'setup_url': '/tv/setup?token={}'.format(token)
        })
    except Exception as e:
        current_app.logger.error('Erro criar TV dispositivo: %s', e, exc_info=True)
        return jsonify({'success': False, 'error': 'Erro ao criar dispositivo'}), 500


_CAMPOS_TV = ('nome', 'paineis', 'ativo')


@tv_bp.route('/api/admin/tv-dispositivos/<int:dispositivo_id>', methods=['PUT'])
@admin_required
def atualizar_tv_dispositivo(dispositivo_id):
    """
    Atualiza nome, painéis ou status ativo de um dispositivo TV.

    PUT /api/admin/tv-dispositivos/<id>
    Body: {"ativo": false} | {"paineis": "painel4,painel10"} | {"nome": "Novo Nome"}
    """
    try:
        dados = request.get_json() or {}
        sets = []
        vals = []
        for campo in _CAMPOS_TV:
            if campo in dados:
                sets.append('{} = %s'.format(campo))
                vals.append(dados[campo])

        if not sets:
            return jsonify({'success': False, 'error': 'Nenhum campo válido para atualizar'}), 400

        vals.append(dispositivo_id)
        with get_db_cursor() as cur:
            cur.execute(
                'UPDATE dispositivos_tv SET {} WHERE id = %s'.format(', '.join(sets)),
                vals
            )
            if cur.rowcount == 0:
                return jsonify({'success': False, 'error': 'Dispositivo não encontrado'}), 404

        return jsonify({'success': True})
    except Exception as e:
        current_app.logger.error(
            'Erro atualizar TV dispositivo %s: %s', dispositivo_id, e, exc_info=True
        )
        return jsonify({'success': False, 'error': 'Erro ao atualizar'}), 500
