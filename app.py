from flask import Flask, jsonify, request, send_from_directory, session
from flask_cors import CORS
from functools import wraps
import os
from datetime import datetime, timedelta
from dotenv import load_dotenv
from backend.database import get_db_connection, init_db
from backend.auth import verificar_usuario, criar_usuario
from backend.user_management import (
    listar_usuarios,
    obter_usuario,
    editar_usuario,
    alterar_status_usuario,
    resetar_senha,
    obter_permissoes,
    adicionar_permissao,
    remover_permissao,
    obter_historico,
    obter_estatisticas,
    verificar_permissao_painel
)
import logging
from logging.handlers import RotatingFileHandler

from config import get_config, validate_production_config

load_dotenv()

app = Flask(__name__)

config_class = get_config()
app.config.from_object(config_class)

validate_production_config()

print(config_class.info())


def setup_logging():
    if not os.path.exists('logs'):
        os.mkdir('logs')

    log_level = getattr(logging, app.config['LOG_LEVEL'], logging.INFO)

    formatter = logging.Formatter(
        '[%(asctime)s] %(levelname)s in %(module)s: %(message)s'
    )

    file_handler = RotatingFileHandler(
        'logs/painel.log',
        maxBytes=10485760,
        backupCount=10
    )
    file_handler.setFormatter(formatter)
    file_handler.setLevel(log_level)

    console_handler = logging.StreamHandler()
    console_handler.setFormatter(formatter)
    console_handler.setLevel(log_level)

    app.logger.addHandler(file_handler)
    app.logger.addHandler(console_handler)
    app.logger.setLevel(log_level)

    app.logger.handlers = [h for h in app.logger.handlers
                           if not isinstance(h, logging.StreamHandler)
                           or h == console_handler]

    app.logger.info('Sistema de logging configurado')


setup_logging()

CORS(app,
     resources={r"/*": {"origins": "*"}},
     supports_credentials=True,
     allow_headers=["Content-Type", "Authorization"],
     methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"]
     )


@app.after_request
def add_security_headers(response):
    response.headers['X-Frame-Options'] = 'SAMEORIGIN'
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-XSS-Protection'] = '1; mode=block'
    response.headers['Referrer-Policy'] = 'strict-origin-when-cross-origin'

    if app.config.get('SESSION_COOKIE_SECURE', False):
        response.headers['Strict-Transport-Security'] = 'max-age=31536000; includeSubDomains'

    return response


@app.errorhandler(404)
def not_found(error):
    app.logger.warning(f'404 Error: {request.url}')
    return jsonify({
        'success': False,
        'error': 'Recurso não encontrado'
    }), 404


@app.errorhandler(500)
def internal_error(error):
    app.logger.error(f'500 Error: {error}', exc_info=True)

    if app.config.get('DEBUG', False):
        return jsonify({
            'success': False,
            'error': 'Erro interno do servidor',
            'details': str(error)
        }), 500
    else:
        return jsonify({
            'success': False,
            'error': 'Erro interno do servidor'
        }), 500


@app.errorhandler(403)
def forbidden(error):
    app.logger.warning(f'403 Error: {request.url}')
    return jsonify({
        'success': False,
        'error': 'Acesso negado'
    }), 403


@app.errorhandler(401)
def unauthorized(error):
    app.logger.warning(f'401 Error: {request.url}')
    return jsonify({
        'success': False,
        'error': 'Não autenticado',
        'redirect': '/login.html'
    }), 401


@app.errorhandler(Exception)
def handle_exception(error):
    app.logger.error(f'Unhandled Exception: {error}', exc_info=True)

    if app.config.get('DEBUG', False):
        return jsonify({
            'success': False,
            'error': 'Erro inesperado',
            'details': str(error)
        }), 500
    else:
        return jsonify({
            'success': False,
            'error': 'Erro inesperado. Contate o suporte.'
        }), 500


init_db()


def login_required(f):
    @wraps(f)
    def decorated_function(*args, **kwargs):
        if 'usuario_id' not in session:
            app.logger.warning(f'Acesso não autorizado: {request.url}')
            return jsonify({
                'success': False,
                'error': 'Não autenticado',
                'redirect': '/login.html'
            }), 401
        return f(*args, **kwargs)

    return decorated_function


def admin_required(f):
    @wraps(f)
    def decorated_function(*args, **kwargs):
        if 'usuario_id' not in session:
            app.logger.warning(f'Acesso não autorizado (admin): {request.url}')
            return jsonify({
                'success': False,
                'error': 'Não autenticado',
                'redirect': '/login.html'
            }), 401

        if not session.get('is_admin', False):
            app.logger.warning(f'Acesso negado (não admin): {session.get("usuario")}')
            return jsonify({
                'success': False,
                'error': 'Sem permissão de administrador'
            }), 403

        return f(*args, **kwargs)

    return decorated_function


@app.route('/')
def index():
    if 'usuario_id' in session:
        return send_from_directory('frontend', 'dashboard.html')
    return send_from_directory('frontend', 'login.html')


@app.route('/login.html')
def login_page():
    return send_from_directory('frontend', 'login.html')


@app.route('/frontend/<path:path>')
def serve_frontend(path):
    return send_from_directory('frontend', path)


@app.route('/static/<path:path>')
def serve_static(path):
    return send_from_directory('static', path)


@app.route('/admin/usuarios')
@admin_required
def admin_usuarios_page():
    return send_from_directory('frontend', 'admin-usuarios.html')


@app.route('/api/login', methods=['POST'])
def login():
    try:
        dados = request.get_json()

        if not dados:
            return jsonify({'success': False, 'error': 'Dados não fornecidos'}), 400

        usuario = dados.get('usuario')
        senha = dados.get('senha')

        if not usuario or not senha:
            return jsonify({'success': False, 'error': 'Usuário e senha são obrigatórios'}), 400

        app.logger.info(f'Tentativa de login: {usuario}')

        resultado = verificar_usuario(usuario, senha)

        if resultado['success']:
            session.permanent = True
            session['usuario_id'] = resultado['usuario_id']
            session['usuario'] = resultado['usuario']
            session['is_admin'] = resultado['is_admin']

            app.logger.info(f'✅ Login bem-sucedido: {usuario}')

            return jsonify({
                'success': True,
                'usuario': resultado['usuario'],
                'is_admin': resultado['is_admin']
            })
        else:
            app.logger.warning(f'❌ Login falhou: {usuario}')
            return jsonify({'success': False, 'error': 'Usuário ou senha inválidos'}), 401

    except Exception as e:
        app.logger.error(f'Erro no login: {e}', exc_info=True)
        return jsonify({'success': False, 'error': 'Erro interno do servidor'}), 500


@app.route('/api/logout', methods=['POST'])
def logout():
    usuario = session.get('usuario', 'desconhecido')
    session.clear()
    app.logger.info(f'👋 Logout: {usuario}')
    return jsonify({'success': True})


@app.route('/api/cadastro', methods=['POST'])
@admin_required
def cadastro():
    try:
        dados = request.get_json()

        if not dados:
            return jsonify({'success': False, 'error': 'Dados não fornecidos'}), 400

        usuario = dados.get('usuario')
        senha = dados.get('senha')
        email = dados.get('email')
        is_admin = dados.get('is_admin', False)

        if not usuario or not senha or not email:
            return jsonify({'success': False, 'error': 'Todos os campos são obrigatórios'}), 400

        resultado = criar_usuario(usuario, senha, email, is_admin)

        if resultado['success']:
            app.logger.info(f'✅ Usuário criado: {usuario} (admin={is_admin})')
            return jsonify({'success': True, 'message': 'Usuário criado com sucesso'})
        else:
            return jsonify({'success': False, 'error': resultado['error']}), 400

    except Exception as e:
        app.logger.error(f'Erro no cadastro: {e}', exc_info=True)
        return jsonify({'success': False, 'error': 'Erro interno do servidor'}), 500


@app.route('/api/verificar-sessao', methods=['GET'])
def verificar_sessao():
    if 'usuario_id' in session:
        return jsonify({
            'success': True,
            'autenticado': True,
            'usuario': session.get('usuario'),
            'is_admin': session.get('is_admin', False)
        })
    return jsonify({'success': True, 'autenticado': False})


@app.route('/painel/<painel_nome>')
@login_required
def painel(painel_nome):
    usuario_id = session.get('usuario_id')
    is_admin = session.get('is_admin', False)

    if not is_admin:
        if not verificar_permissao_painel(usuario_id, painel_nome):
            app.logger.warning(f'Acesso negado ao painel {painel_nome}: {session.get("usuario")}')
            return send_from_directory('frontend', 'acesso-negado.html')

    painel_path = f'paineis/{painel_nome}/index.html'
    if os.path.exists(painel_path):
        return send_from_directory(f'paineis/{painel_nome}', 'index.html')

    app.logger.warning(f'Painel não encontrado: {painel_nome}')
    return jsonify({'error': 'Painel não encontrado'}), 404


@app.route('/acesso-negado')
def acesso_negado_page():
    return send_from_directory('frontend', 'acesso-negado.html')


@app.route('/paineis/<painel_nome>/<path:path>')
@login_required
def serve_painel_files(painel_nome, path):
    return send_from_directory(f'paineis/{painel_nome}', path)


@app.route('/api/paineis/painel2/evolucoes', methods=['GET'])
@login_required
def get_evolucoes():
    usuario_id = session.get('usuario_id')
    is_admin = session.get('is_admin', False)

    if not is_admin:
        if not verificar_permissao_painel(usuario_id, 'painel2'):
            return jsonify({
                'success': False,
                'error': 'Sem permissão para acessar este painel'
            }), 403

    conn = get_db_connection()
    if not conn:
        return jsonify({
            'success': False,
            'error': 'Erro de conexão com o banco'
        }), 500

    try:
        cursor = conn.cursor()

        query = """
WITH turno_atual AS (
    SELECT 
        CASE 
            WHEN EXTRACT(HOUR FROM CURRENT_TIME) >= 7 
                 AND EXTRACT(HOUR FROM CURRENT_TIME) < 19 
            THEN 'DIURNO'
            ELSE 'NOTURNO'
        END as turno_prioritario
)
SELECT 
    e.nr_atendimento, 
    e.ds_convenio, 
    e.nm_paciente, 
    e.idade, 
    e.dt_entrada, 
    e.medico_responsavel, 
    e.medico_atendimento, 
    e.dias_internado, 
    e.data_turno as data_turno,
    e.turno, 
    e.setor, 
    e.unidade, 
    e.dt_admissao_unidade, 
    e.evol_medico, 
    e.evol_enfermeiro, 
    e.evol_tec_enfermagem, 
    e.evol_nutricionista, 
    e.evol_fisioterapeuta, 
    e.dt_carga,
    CASE 
        WHEN e.turno = (SELECT turno_prioritario FROM turno_atual) THEN 0
        ELSE 1
    END as prioridade_turno
FROM public.evolucao_turno e
CROSS JOIN turno_atual
WHERE e.setor IS NOT NULL
ORDER BY 
    TO_DATE(e.data_turno, 'DD/MM/YYYY') DESC,
    prioridade_turno ASC,
    e.turno ASC,
    e.nr_atendimento ASC
        """

        cursor.execute(query)
        colunas = [desc[0] for desc in cursor.description]

        evolucoes = []
        for row in cursor.fetchall():
            registro = dict(zip(colunas, row))
            registro.pop('prioridade_turno', None)
            evolucoes.append(registro)

        cursor.close()
        conn.close()

        return jsonify({
            'success': True,
            'data': evolucoes,
            'total': len(evolucoes),
            'timestamp': datetime.now().isoformat()
        })

    except Exception as e:
        app.logger.error(f'Erro ao buscar evolucoes: {e}', exc_info=True)
        if conn:
            conn.close()
        return jsonify({
            'success': False,
            'error': 'Erro ao buscar dados'
        }), 500


@app.route('/api/paineis/painel3/medicos', methods=['GET'])
@login_required
def get_medicos_ps():
    usuario_id = session.get('usuario_id')
    is_admin = session.get('is_admin', False)

    if not is_admin:
        if not verificar_permissao_painel(usuario_id, 'painel3'):
            return jsonify({
                'success': False,
                'error': 'Sem permissão para acessar este painel'
            }), 403

    conn = get_db_connection()
    if not conn:
        return jsonify({
            'success': False,
            'error': 'Erro de conexão com o banco'
        }), 500

    try:
        cursor = conn.cursor()

        query = "SELECT * FROM public.medicos_ps"

        cursor.execute(query)
        colunas = [desc[0] for desc in cursor.description]
        medicos = [dict(zip(colunas, row)) for row in cursor.fetchall()]

        cursor.close()
        conn.close()

        return jsonify({
            'success': True,
            'data': medicos,
            'total': len(medicos),
            'timestamp': datetime.now().isoformat()
        })

    except Exception as e:
        app.logger.error(f'Erro ao buscar médicos: {e}', exc_info=True)
        if conn:
            conn.close()
        return jsonify({
            'success': False,
            'error': 'Erro ao buscar dados'
        }), 500


# ==========================================
# 🏥 ROTAS DO PAINEL 4 - OCUPAÇÃO HOSPITALAR
# ==========================================

@app.route('/painel/painel4')
@login_required
def painel4():
    usuario_id = session.get('usuario_id')
    is_admin = session.get('is_admin', False)

    if not is_admin:
        if not verificar_permissao_painel(usuario_id, 'painel4'):
            app.logger.warning(f'Acesso negado ao painel4: {session.get("usuario")}')
            return send_from_directory('frontend', 'acesso-negado.html')

    return send_from_directory('paineis/painel4', 'index.html')


@app.route('/painel/painel4/detalhes')
@login_required
def painel4_detalhes():
    usuario_id = session.get('usuario_id')
    is_admin = session.get('is_admin', False)

    if not is_admin:
        if not verificar_permissao_painel(usuario_id, 'painel4'):
            app.logger.warning(f'Acesso negado ao painel4/detalhes: {session.get("usuario")}')
            return send_from_directory('frontend', 'acesso-negado.html')

    return send_from_directory('paineis/painel4', 'detalhes.html')


# API: Dashboard - Estatísticas Gerais
@app.route('/api/paineis/painel4/dashboard', methods=['GET'])
@login_required
def api_painel4_dashboard():
    usuario_id = session.get('usuario_id')
    is_admin = session.get('is_admin', False)

    if not is_admin:
        if not verificar_permissao_painel(usuario_id, 'painel4'):
            return jsonify({
                'success': False,
                'error': 'Sem permissão para acessar este painel'
            }), 403

    conn = get_db_connection()
    if not conn:
        return jsonify({
            'success': False,
            'error': 'Erro de conexão com o banco'
        }), 500

    try:
        cursor = conn.cursor()

        # Usa a view criada para estatísticas gerais
        cursor.execute("SELECT * FROM vw_ocupacao_dashboard")

        colunas = [desc[0] for desc in cursor.description]
        resultado = cursor.fetchone()

        if resultado:
            dados = dict(zip(colunas, resultado))
        else:
            dados = {
                'total_leitos': 0,
                'leitos_ocupados': 0,
                'leitos_livres': 0,
                'leitos_higienizacao': 0,
                'leitos_interditados': 0,
                'taxa_ocupacao_geral': 0,
                'taxa_disponibilidade': 0,
                'total_setores': 0,
                'media_permanencia_geral': 0,
                'ultima_atualizacao': None
            }

        cursor.close()
        conn.close()

        return jsonify({
            'success': True,
            'data': dados,
            'timestamp': datetime.now().isoformat()
        })

    except Exception as e:
        app.logger.error(f'Erro ao buscar dashboard painel4: {e}', exc_info=True)
        if conn:
            conn.close()
        return jsonify({
            'success': False,
            'error': 'Erro ao buscar dados'
        }), 500


# API: Ocupação por Setor
@app.route('/api/paineis/painel4/setores', methods=['GET'])
@login_required
def api_painel4_setores():
    usuario_id = session.get('usuario_id')
    is_admin = session.get('is_admin', False)

    if not is_admin:
        if not verificar_permissao_painel(usuario_id, 'painel4'):
            return jsonify({
                'success': False,
                'error': 'Sem permissão para acessar este painel'
            }), 403

    conn = get_db_connection()
    if not conn:
        return jsonify({
            'success': False,
            'error': 'Erro de conexão com o banco'
        }), 500

    try:
        cursor = conn.cursor()

        # Usa a view para estatísticas por setor
        cursor.execute("SELECT * FROM vw_ocupacao_por_setor")

        colunas = [desc[0] for desc in cursor.description]
        setores = [dict(zip(colunas, row)) for row in cursor.fetchall()]

        cursor.close()
        conn.close()

        return jsonify({
            'success': True,
            'data': setores,
            'total': len(setores),
            'timestamp': datetime.now().isoformat()
        })

    except Exception as e:
        app.logger.error(f'Erro ao buscar setores painel4: {e}', exc_info=True)
        if conn:
            conn.close()
        return jsonify({
            'success': False,
            'error': 'Erro ao buscar dados'
        }), 500


# API: Leitos Ocupados (com pacientes)
@app.route('/api/paineis/painel4/leitos-ocupados', methods=['GET'])
@login_required
def api_painel4_leitos_ocupados():
    usuario_id = session.get('usuario_id')
    is_admin = session.get('is_admin', False)

    if not is_admin:
        if not verificar_permissao_painel(usuario_id, 'painel4'):
            return jsonify({
                'success': False,
                'error': 'Sem permissão para acessar este painel'
            }), 403

    conn = get_db_connection()
    if not conn:
        return jsonify({
            'success': False,
            'error': 'Erro de conexão com o banco'
        }), 500

    try:
        cursor = conn.cursor()

        # Usa a view para pacientes internados
        cursor.execute("SELECT * FROM vw_pacientes_internados")

        colunas = [desc[0] for desc in cursor.description]
        leitos = [dict(zip(colunas, row)) for row in cursor.fetchall()]

        cursor.close()
        conn.close()

        return jsonify({
            'success': True,
            'data': leitos,
            'total': len(leitos),
            'timestamp': datetime.now().isoformat()
        })

    except Exception as e:
        app.logger.error(f'Erro ao buscar leitos ocupados painel4: {e}', exc_info=True)
        if conn:
            conn.close()
        return jsonify({
            'success': False,
            'error': 'Erro ao buscar dados'
        }), 500


# API: Leitos Disponíveis (livres, higienização, interditados)
@app.route('/api/paineis/painel4/leitos-disponiveis', methods=['GET'])
@login_required
def api_painel4_leitos_disponiveis():
    usuario_id = session.get('usuario_id')
    is_admin = session.get('is_admin', False)

    if not is_admin:
        if not verificar_permissao_painel(usuario_id, 'painel4'):
            return jsonify({
                'success': False,
                'error': 'Sem permissão para acessar este painel'
            }), 403

    conn = get_db_connection()
    if not conn:
        return jsonify({
            'success': False,
            'error': 'Erro de conexão com o banco'
        }), 500

    try:
        cursor = conn.cursor()

        # Usa a view para leitos disponíveis
        cursor.execute("SELECT * FROM vw_leitos_disponiveis")

        colunas = [desc[0] for desc in cursor.description]
        leitos = [dict(zip(colunas, row)) for row in cursor.fetchall()]

        cursor.close()
        conn.close()

        return jsonify({
            'success': True,
            'data': leitos,
            'total': len(leitos),
            'timestamp': datetime.now().isoformat()
        })

    except Exception as e:
        app.logger.error(f'Erro ao buscar leitos disponíveis painel4: {e}', exc_info=True)
        if conn:
            conn.close()
        return jsonify({
            'success': False,
            'error': 'Erro ao buscar dados'
        }), 500


# API: Todos os Leitos (ocupados + disponíveis)
@app.route('/api/paineis/painel4/todos-leitos', methods=['GET'])
@login_required
def api_painel4_todos_leitos():
    usuario_id = session.get('usuario_id')
    is_admin = session.get('is_admin', False)

    if not is_admin:
        if not verificar_permissao_painel(usuario_id, 'painel4'):
            return jsonify({
                'success': False,
                'error': 'Sem permissão para acessar este painel'
            }), 403

    conn = get_db_connection()
    if not conn:
        return jsonify({
            'success': False,
            'error': 'Erro de conexão com o banco'
        }), 500

    try:
        cursor = conn.cursor()

        # Usa a view principal com todos os dados
        cursor.execute("SELECT * FROM vw_ocupacao_hospitalar ORDER BY setor, leito")

        colunas = [desc[0] for desc in cursor.description]
        leitos = [dict(zip(colunas, row)) for row in cursor.fetchall()]

        cursor.close()
        conn.close()

        return jsonify({
            'success': True,
            'data': leitos,
            'total': len(leitos),
            'timestamp': datetime.now().isoformat()
        })

    except Exception as e:
        app.logger.error(f'Erro ao buscar todos leitos painel4: {e}', exc_info=True)
        if conn:
            conn.close()
        return jsonify({
            'success': False,
            'error': 'Erro ao buscar dados'
        }), 500














@app.route('/api/minhas-permissoes', methods=['GET'])
@login_required
def api_minhas_permissoes():
    try:
        usuario_id = session.get('usuario_id')
        is_admin = session.get('is_admin', False)

        if is_admin:
            return jsonify({
                'success': True,
                'permissoes': ['painel2', 'painel3'],
                'is_admin': True
            })

        resultado = obter_permissoes(usuario_id)

        if resultado['success']:
            paineis = [p['painel'] for p in resultado['permissoes']]
            return jsonify({
                'success': True,
                'permissoes': paineis,
                'is_admin': False
            })
        else:
            return jsonify(resultado), 500

    except Exception as e:
        app.logger.error(f'Erro ao obter permissões: {e}', exc_info=True)
        return jsonify({'success': False, 'error': 'Erro interno'}), 500


@app.route('/api/admin/usuarios', methods=['GET'])
@admin_required
def api_listar_usuarios():
    try:
        incluir_inativos = request.args.get('incluir_inativos', 'true').lower() == 'true'
        resultado = listar_usuarios(incluir_inativos=incluir_inativos)

        if resultado['success']:
            return jsonify(resultado), 200
        else:
            return jsonify(resultado), 500

    except Exception as e:
        app.logger.error(f'Erro ao listar usuários: {e}', exc_info=True)
        return jsonify({'success': False, 'error': 'Erro interno'}), 500


@app.route('/api/admin/usuarios/<int:usuario_id>', methods=['GET'])
@admin_required
def api_obter_usuario(usuario_id):
    try:
        resultado = obter_usuario(usuario_id)

        if resultado['success']:
            return jsonify(resultado), 200
        else:
            return jsonify(resultado), 404

    except Exception as e:
        app.logger.error(f'Erro ao obter usuário: {e}', exc_info=True)
        return jsonify({'success': False, 'error': 'Erro interno'}), 500


@app.route('/api/admin/estatisticas', methods=['GET'])
@admin_required
def api_estatisticas():
    try:
        resultado = obter_estatisticas()

        if resultado['success']:
            return jsonify(resultado), 200
        else:
            return jsonify(resultado), 500

    except Exception as e:
        app.logger.error(f'Erro ao obter estatísticas: {e}', exc_info=True)
        return jsonify({'success': False, 'error': 'Erro interno'}), 500


@app.route('/api/admin/usuarios/<int:usuario_id>', methods=['PUT'])
@admin_required
def api_editar_usuario(usuario_id):
    try:
        dados = request.get_json()
        admin_id = session.get('usuario_id')

        if not dados:
            return jsonify({'success': False, 'error': 'Nenhum dado fornecido'}), 400

        resultado = editar_usuario(usuario_id, dados, admin_id)

        if resultado['success']:
            return jsonify(resultado), 200
        else:
            return jsonify(resultado), 400

    except Exception as e:
        app.logger.error(f'Erro ao editar usuário: {e}', exc_info=True)
        return jsonify({'success': False, 'error': 'Erro interno'}), 500


@app.route('/api/admin/usuarios/<int:usuario_id>/status', methods=['PUT'])
@admin_required
def api_alterar_status(usuario_id):
    try:
        dados = request.get_json()
        admin_id = session.get('usuario_id')

        if 'ativo' not in dados:
            return jsonify({'success': False, 'error': 'Campo "ativo" é obrigatório'}), 400

        ativo = dados['ativo']

        if usuario_id == admin_id and not ativo:
            return jsonify({
                'success': False,
                'error': 'Você não pode desativar sua própria conta'
            }), 400

        resultado = alterar_status_usuario(usuario_id, ativo, admin_id)

        if resultado['success']:
            return jsonify(resultado), 200
        else:
            return jsonify(resultado), 400

    except Exception as e:
        app.logger.error(f'Erro ao alterar status: {e}', exc_info=True)
        return jsonify({'success': False, 'error': 'Erro interno'}), 500


@app.route('/api/admin/usuarios/<int:usuario_id>/senha', methods=['PUT'])
@admin_required
def api_resetar_senha(usuario_id):
    try:
        dados = request.get_json()
        admin_id = session.get('usuario_id')

        if 'nova_senha' not in dados:
            return jsonify({'success': False, 'error': 'Campo "nova_senha" é obrigatório'}), 400

        nova_senha = dados['nova_senha']

        resultado = resetar_senha(usuario_id, nova_senha, admin_id)

        if resultado['success']:
            return jsonify(resultado), 200
        else:
            return jsonify(resultado), 400

    except Exception as e:
        app.logger.error(f'Erro ao resetar senha: {e}', exc_info=True)
        return jsonify({'success': False, 'error': 'Erro interno'}), 500


@app.route('/api/admin/usuarios/<int:usuario_id>/permissoes', methods=['GET'])
@admin_required
def api_obter_permissoes(usuario_id):
    try:
        resultado = obter_permissoes(usuario_id)

        if resultado['success']:
            return jsonify(resultado), 200
        else:
            return jsonify(resultado), 500

    except Exception as e:
        app.logger.error(f'Erro ao obter permissões: {e}', exc_info=True)
        return jsonify({'success': False, 'error': 'Erro interno'}), 500


@app.route('/api/admin/usuarios/<int:usuario_id>/permissoes', methods=['POST'])
@admin_required
def api_adicionar_permissao(usuario_id):
    try:
        dados = request.get_json()
        admin_id = session.get('usuario_id')

        if 'painel_nome' not in dados:
            return jsonify({'success': False, 'error': 'Campo "painel_nome" é obrigatório'}), 400

        painel_nome = dados['painel_nome']

        resultado = adicionar_permissao(usuario_id, painel_nome, admin_id)

        if resultado['success']:
            return jsonify(resultado), 201
        else:
            return jsonify(resultado), 400

    except Exception as e:
        app.logger.error(f'Erro ao adicionar permissão: {e}', exc_info=True)
        return jsonify({'success': False, 'error': 'Erro interno'}), 500


@app.route('/api/admin/usuarios/<int:usuario_id>/permissoes/<painel_nome>', methods=['DELETE'])
@admin_required
def api_remover_permissao(usuario_id, painel_nome):
    try:
        admin_id = session.get('usuario_id')

        resultado = remover_permissao(usuario_id, painel_nome, admin_id)

        if resultado['success']:
            return jsonify(resultado), 200
        else:
            return jsonify(resultado), 400

    except Exception as e:
        app.logger.error(f'Erro ao remover permissão: {e}', exc_info=True)
        return jsonify({'success': False, 'error': 'Erro interno'}), 500


@app.route('/api/admin/usuarios/<int:usuario_id>/historico', methods=['GET'])
@admin_required
def api_obter_historico(usuario_id):
    try:
        limite = request.args.get('limite', 50, type=int)
        resultado = obter_historico(usuario_id, limite)

        if resultado['success']:
            return jsonify(resultado), 200
        else:
            return jsonify(resultado), 500

    except Exception as e:
        app.logger.error(f'Erro ao obter histórico: {e}', exc_info=True)
        return jsonify({'success': False, 'error': 'Erro interno'}), 500


@app.route('/api/admin/paineis', methods=['GET'])
@admin_required
def api_listar_paineis():
    try:
        paineis = [
            {
                'nome': 'painel2',
                'titulo': 'Evolução de Turno',
                'descricao': 'Acompanhamento de evoluções médicas',
                'ativo': True
            },
            {
                'nome': 'painel3',
                'titulo': 'Médicos PS',
                'descricao': 'Monitoramento de médicos logados',
                'ativo': True
            },
            {
                'nome': 'painel4',
                'titulo': 'Ocupação Hospitalar',
                'descricao': 'Monitoramento de ocupação de leitos',
                'ativo': True
            },
            {
                'nome': 'painel5',
                'titulo': 'Cirurgias do Dia',
                'descricao': 'Acompanhamento de cirurgias agendadas',
                'ativo': True
            }
        ]

        return jsonify({
            'success': True,
            'paineis': paineis
        }), 200

    except Exception as e:
        app.logger.error(f'Erro ao listar painéis: {e}', exc_info=True)
        return jsonify({'success': False, 'error': 'Erro interno'}), 500


# ==========================================
# 🏥 ROTAS DO PAINEL 5 - CIRURGIAS DO DIA
# ==========================================

@app.route('/painel/painel5')
@login_required
def painel5():
    usuario_id = session.get('usuario_id')
    is_admin = session.get('is_admin', False)

    if not is_admin:
        if not verificar_permissao_painel(usuario_id, 'painel5'):
            app.logger.warning(f'Acesso negado ao painel5: {session.get("usuario")}')
            return send_from_directory('frontend', 'acesso-negado.html')

    return send_from_directory('paineis/painel5', 'index.html')


# API: Dashboard - Estatísticas Gerais das Cirurgias
@app.route('/api/paineis/painel5/dashboard', methods=['GET'])
@login_required
def api_painel5_dashboard():
    usuario_id = session.get('usuario_id')
    is_admin = session.get('is_admin', False)

    if not is_admin:
        if not verificar_permissao_painel(usuario_id, 'painel5'):
            return jsonify({
                'success': False,
                'error': 'Sem permissão para acessar este painel'
            }), 403

    conn = get_db_connection()
    if not conn:
        return jsonify({
            'success': False,
            'error': 'Erro de conexão com o banco'
        }), 500

    try:
        cursor = conn.cursor()

        # ✅ CORREÇÃO: Usar a VIEW ao invés da tabela
        query = """
            SELECT 
                COUNT(*) as total_cirurgias,
                COUNT(*) FILTER (WHERE ie_status_cirurgia in (-1, 1)) as cirurgias_previstas,
                COUNT(*) FILTER (WHERE ie_status_cirurgia NOT IN (-1, 1, 2)) as cirurgias_andamento,
                COUNT(*) FILTER (WHERE ie_status_cirurgia = 2) as cirurgias_realizadas
            FROM vw_cirurgias_dia
        """

        cursor.execute(query)
        resultado = cursor.fetchone()

        dados = {
            'total_cirurgias': resultado[0] or 0,
            'cirurgias_previstas': resultado[1] or 0,
            'cirurgias_andamento': resultado[2] or 0,
            'cirurgias_realizadas': resultado[3] or 0
        }

        cursor.close()
        conn.close()

        return jsonify({
            'success': True,
            'data': dados,
            'timestamp': datetime.now().isoformat()
        })

    except Exception as e:
        app.logger.error(f'Erro ao buscar dashboard painel5: {e}', exc_info=True)
        if conn:
            conn.close()
        return jsonify({
            'success': False,
            'error': 'Erro ao buscar dados'
        }), 500


# API: Lista de Cirurgias Agrupadas por Dia
@app.route('/api/paineis/painel5/cirurgias', methods=['GET'])
@login_required
def api_painel5_cirurgias():
    usuario_id = session.get('usuario_id')
    is_admin = session.get('is_admin', False)

    if not is_admin:
        if not verificar_permissao_painel(usuario_id, 'painel5'):
            return jsonify({
                'success': False,
                'error': 'Sem permissão para acessar este painel'
            }), 403

    conn = get_db_connection()
    if not conn:
        return jsonify({
            'success': False,
            'error': 'Erro de conexão com o banco'
        }), 500

    try:
        cursor = conn.cursor()

        # Busca todas as cirurgias ordenadas
        query = """
            SELECT 
                id,
                grupo_dia,
                data_formatada,
                data_cirurgia,
                hr_inicio,
                previsao_termino,
                setor_cirurgia,
                nm_paciente_pf,
                nm_medico,
                ds_proc_cir,
                ie_status_cirurgia,
                ds_status,
                ds_convenio,
                ds_idade_abrev,
                nr_minuto_duracao,
                nm_instrumentador,
                nm_circulante,
                nr_atendimento,
                nr_cirurgia
            FROM vw_cirurgias_dia
            ORDER BY data_cirurgia ASC, hr_inicio ASC
        """

        cursor.execute(query)
        colunas = [desc[0] for desc in cursor.description]
        cirurgias = [dict(zip(colunas, row)) for row in cursor.fetchall()]

        # Agrupa cirurgias por dia
        cirurgias_agrupadas = {}
        for cirurgia in cirurgias:
            dia = cirurgia['data_formatada']
            grupo = cirurgia['grupo_dia']

            if dia not in cirurgias_agrupadas:
                cirurgias_agrupadas[dia] = {
                    'data': dia,
                    'grupo': grupo,
                    'cirurgias': []
                }

            cirurgias_agrupadas[dia]['cirurgias'].append(cirurgia)

        # Converte para lista ordenada
        resultado = sorted(
            cirurgias_agrupadas.values(),
            key=lambda x: cirurgias[0]['data_cirurgia'] if cirurgias else datetime.now()
        )

        cursor.close()
        conn.close()

        return jsonify({
            'success': True,
            'data': resultado,
            'total': len(cirurgias),
            'timestamp': datetime.now().isoformat()
        })

    except Exception as e:
        app.logger.error(f'Erro ao buscar cirurgias painel5: {e}', exc_info=True)
        if conn:
            conn.close()
        return jsonify({
            'success': False,
            'error': 'Erro ao buscar dados'
        }), 500










if __name__ == '__main__':
    import socket

    hostname = socket.gethostname()
    local_ip = socket.gethostbyname(hostname)

    print("\n" + "=" * 60)
    print("🚀 SERVIDOR PRINCIPAL INICIADO")
    print("=" * 60)
    print("🔐 Sistema de autenticação ativo")
    print("🛡️  Headers de segurança habilitados")
    print("📝 Sistema de logging configurado")
    print("🌐 CORS: Liberado (funciona com VPN/IPs variáveis)")
    print("\n📊 Painéis disponíveis:")
    print("   • Evolução de Turno: /painel/painel2")
    print("   • Médicos PS:         /painel/painel3")
    print("\n🌐 URLs de Acesso:")
    print(f"   • Local:        http://localhost:5000")
    print(f"   • Local (IP):   http://127.0.0.1:5000")
    print(f"   • Rede Local:   http://{local_ip}:5000")
    print(f"   • VPN/Remoto:   http://<IP-VPN>:5000")
    print("\n💡 Dica: Sistema funciona de qualquer IP/rede")
    print("   A segurança é garantida por autenticação obrigatória")
    print("=" * 60 + "\n")

    app.run(
        debug=app.config.get('DEBUG', False),
        host='0.0.0.0',
        port=5000,
        use_reloader=app.config.get('DEBUG', False)
    )