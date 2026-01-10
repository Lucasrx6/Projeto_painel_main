from flask import Flask, jsonify, request, send_from_directory, session
from flask_cors import CORS
from functools import wraps
import os
from datetime import datetime
from dotenv import load_dotenv
from psycopg2.extras import RealDictCursor
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
import sys
import io

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8', errors='replace')
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

    # evita duplicação de logs no console
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


# =========================================================
# 🏠 ROTAS PRINCIPAIS
# =========================================================

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


@app.route('/acesso-negado')
def acesso_negado_page():
    return send_from_directory('frontend', 'acesso-negado.html')


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


@app.route('/paineis/<painel_nome>/<path:path>')
@login_required
def serve_painel_files(painel_nome, path):
    return send_from_directory(f'paineis/{painel_nome}', path)


# =========================================================
# 🔐 AUTENTICAÇÃO
# =========================================================

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


# =========================================================
# 📊 PAINEL 6 - PRIORIZAÇÃO CLÍNICA COM IA
# =========================================================

@app.route('/painel/painel6')
@login_required
def painel6():
    usuario_id = session.get('usuario_id')
    is_admin = session.get('is_admin', False)

    if not is_admin:
        if not verificar_permissao_painel(usuario_id, 'painel6'):
            app.logger.warning(f'Acesso negado ao painel6: {session.get("usuario")}')
            return send_from_directory('frontend', 'acesso-negado.html')

    return send_from_directory('paineis/painel6', 'index.html')


@app.route('/api/paineis/painel6/dashboard', methods=['GET'])
def painel6_dashboard():
    try:
        conn = get_db_connection()
        cursor = conn.cursor(cursor_factory=RealDictCursor)

        query = """
            SELECT 
                COUNT(*) as total,
                COUNT(*) FILTER (WHERE nivel_criticidade = 'CRITICO') as critico,
                COUNT(*) FILTER (WHERE nivel_criticidade = 'ALTO') as alto,
                COUNT(*) FILTER (WHERE nivel_criticidade = 'MODERADO') as moderado,
                COUNT(*) FILTER (WHERE nivel_criticidade = 'BAIXO') as baixo
            FROM public.painel_clinico_analise_ia
            WHERE COALESCE(ie_ativo, TRUE) = TRUE
        """

        cursor.execute(query)
        result = cursor.fetchone()
        cursor.close()
        conn.close()

        if not result:
            result = {'total': 0, 'critico': 0, 'alto': 0, 'moderado': 0, 'baixo': 0}

        return jsonify({
            'success': True,
            'data': dict(result),
            'timestamp': datetime.now().isoformat()
        }), 200

    except Exception as e:
        print(f"[ERRO] /dashboard: {e}")
        return jsonify({'success': False, 'error': str(e)}), 500


@app.route('/api/paineis/painel6/lista', methods=['GET'])
def painel6_lista():
    try:
        limit = request.args.get('limit', 400, type=int)
        offset = request.args.get('offset', 0, type=int)

        if limit > 1000:
            limit = 1000

        conn = get_db_connection()
        cursor = conn.cursor(cursor_factory=RealDictCursor)

        # QUERY SIMPLIFICADA - Busca direto das tabelas
        query = """
            SELECT 
                p.nr_atendimento,
                p.nm_pessoa_fisica,
                p.cd_unidade,
                p.nm_setor,
                ia.analise_ia,
                ia.nivel_criticidade,
                ia.score_ia,
                ia.dt_analise,
                ia.dt_atualizacao,
                p.dt_carga
            FROM public.painel_clinico_tasy p
            INNER JOIN public.painel_clinico_analise_ia ia
                ON p.nr_atendimento = ia.nr_atendimento
            WHERE 
                COALESCE(ia.ie_ativo, TRUE) = TRUE
                AND p.ie_status_unidade = 'P'
            ORDER BY 
                ia.score_ia DESC,
                p.dt_carga DESC
            LIMIT %s OFFSET %s
        """

        cursor.execute(query, (limit, offset))
        pacientes = cursor.fetchall()
        cursor.close()
        conn.close()

        resultado = []
        for p in pacientes:
            paciente_dict = dict(p)

            # Formata datas
            for key in ['dt_analise', 'dt_atualizacao', 'dt_carga']:
                if key in paciente_dict and paciente_dict[key]:
                    if isinstance(paciente_dict[key], datetime):
                        paciente_dict[key] = paciente_dict[key].isoformat()

            # Compatibilidade com frontend
            paciente_dict['nivel_risco_total'] = paciente_dict.get('nivel_criticidade')
            paciente_dict['score_clinico_total'] = paciente_dict.get('score_ia')

            resultado.append(paciente_dict)

        return jsonify({
            'success': True,
            'data': resultado,
            'count': len(resultado),
            'timestamp': datetime.now().isoformat()
        }), 200

    except Exception as e:
        print(f"[ERRO] /lista: {e}")
        import traceback
        traceback.print_exc()

        return jsonify({
            'success': False,
            'error': str(e)
        }), 500


@app.route('/api/paineis/painel6/paciente/<int:nr_atendimento>', methods=['GET'])
def painel6_paciente_detalhe(nr_atendimento):
    """
    Retorna detalhes de um paciente específico
    GET /api/paineis/painel6/paciente/12345
    """
    try:
        conn = get_db_connection()
        cursor = conn.cursor(cursor_factory=RealDictCursor)

        query = """
            SELECT 
                p.*,
                ia.analise_ia,
                ia.nivel_criticidade as ia_criticidade,
                ia.score_ia,
                ia.dt_analise
            FROM vw_painel_clinico_risco p
            LEFT JOIN painel_clinico_analise_ia ia
                ON p.nr_atendimento = ia.nr_atendimento
                AND COALESCE(ia.ie_ativo, TRUE) = TRUE
            WHERE p.nr_atendimento = %s
        """

        cursor.execute(query, (nr_atendimento,))
        paciente = cursor.fetchone()
        cursor.close()
        conn.close()

        if not paciente:
            return jsonify({
                'success': False,
                'error': 'Paciente não encontrado'
            }), 404

        return jsonify({
            'success': True,
            'data': dict(paciente),
            'timestamp': datetime.now().isoformat()
        }), 200

    except Exception as e:
        print(f"❌ Erro em /paciente: {e}")
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500


@app.route('/api/paineis/painel6/analisar/<int:nr_atendimento>', methods=['POST'])
def painel6_forcar_analise(nr_atendimento):
    """
    Força análise IA de um paciente específico
    POST /api/paineis/painel6/analisar/12345
    """
    try:
        conn = get_db_connection()
        cursor = conn.cursor(cursor_factory=RealDictCursor)

        # Marca análise anterior como inativa
        cursor.execute("""
            UPDATE painel_clinico_analise_ia
            SET ie_ativo = FALSE
            WHERE nr_atendimento = %s
        """, (nr_atendimento,))

        conn.commit()
        cursor.close()
        conn.close()

        return jsonify({
            'success': True,
            'message': 'Paciente marcado para reanalise. Aguarde próximo ciclo do worker.',
            'timestamp': datetime.now().isoformat()
        }), 200

    except Exception as e:
        print(f"❌ Erro ao forçar análise: {e}")
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500


# ========================================
# ROTA DE TESTE
# ========================================
@app.route('/api/paineis/painel6/test', methods=['GET'])
def painel6_test():
    """Testa conectividade do Painel 6"""
    try:
        conn = get_db_connection()
        cursor = conn.cursor()

        # Testa se a view existe
        cursor.execute("""
            SELECT COUNT(*) FROM vw_painel_clinico_risco
        """)

        count = cursor.fetchone()[0]
        cursor.close()
        conn.close()

        return jsonify({
            'success': True,
            'message': 'Painel 6 OK!',
            'pacientes_na_view': count,
            'timestamp': datetime.now().isoformat()
        }), 200

    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500


# =========================================================
# 🩺 PAINEL 2 - EVOLUÇÃO DE TURNO
# =========================================================

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


# =========================================================
# 👨‍⚕️ PAINEL 3 - MÉDICOS PS
# =========================================================

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


# =========================================================
# 🏥 PAINEL 4 - OCUPAÇÃO HOSPITALAR
# =========================================================

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


@app.route('/api/paineis/painel4/dashboard', methods=['GET'])
@login_required
def api_painel4_dashboard():
    usuario_id = session.get('usuario_id')
    is_admin = session.get('is_admin', False)

    if not is_admin:
        if not verificar_permissao_painel(usuario_id, 'painel4'):
            return jsonify({'success': False, 'error': 'Sem permissão'}), 403

    conn = get_db_connection()
    if not conn:
        return jsonify({'success': False, 'error': 'Erro de conexão'}), 500

    try:
        cursor = conn.cursor()
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
        return jsonify({'success': False, 'error': 'Erro ao buscar dados'}), 500


@app.route('/api/paineis/painel4/setores', methods=['GET'])
@login_required
def api_painel4_setores():
    usuario_id = session.get('usuario_id')
    is_admin = session.get('is_admin', False)

    if not is_admin:
        if not verificar_permissao_painel(usuario_id, 'painel4'):
            return jsonify({'success': False, 'error': 'Sem permissão'}), 403

    conn = get_db_connection()
    if not conn:
        return jsonify({'success': False, 'error': 'Erro de conexão'}), 500

    try:
        cursor = conn.cursor()
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
        return jsonify({'success': False, 'error': 'Erro ao buscar dados'}), 500


@app.route('/api/paineis/painel4/leitos-ocupados', methods=['GET'])
@login_required
def api_painel4_leitos_ocupados():
    usuario_id = session.get('usuario_id')
    is_admin = session.get('is_admin', False)

    if not is_admin:
        if not verificar_permissao_painel(usuario_id, 'painel4'):
            return jsonify({'success': False, 'error': 'Sem permissão'}), 403

    conn = get_db_connection()
    if not conn:
        return jsonify({'success': False, 'error': 'Erro de conexão'}), 500

    try:
        cursor = conn.cursor()
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
        return jsonify({'success': False, 'error': 'Erro ao buscar dados'}), 500


@app.route('/api/paineis/painel4/leitos-disponiveis', methods=['GET'])
@login_required
def api_painel4_leitos_disponiveis():
    usuario_id = session.get('usuario_id')
    is_admin = session.get('is_admin', False)

    if not is_admin:
        if not verificar_permissao_painel(usuario_id, 'painel4'):
            return jsonify({'success': False, 'error': 'Sem permissão'}), 403

    conn = get_db_connection()
    if not conn:
        return jsonify({'success': False, 'error': 'Erro de conexão'}), 500

    try:
        cursor = conn.cursor()
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
        return jsonify({'success': False, 'error': 'Erro ao buscar dados'}), 500


@app.route('/api/paineis/painel4/todos-leitos', methods=['GET'])
@login_required
def api_painel4_todos_leitos():
    usuario_id = session.get('usuario_id')
    is_admin = session.get('is_admin', False)

    if not is_admin:
        if not verificar_permissao_painel(usuario_id, 'painel4'):
            return jsonify({'success': False, 'error': 'Sem permissão'}), 403

    conn = get_db_connection()
    if not conn:
        return jsonify({'success': False, 'error': 'Erro de conexão'}), 500

    try:
        cursor = conn.cursor()
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
        return jsonify({'success': False, 'error': 'Erro ao buscar dados'}), 500


# =========================================================
# 🏥 PAINEL 5 - CIRURGIAS DO DIA
# =========================================================

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


@app.route('/api/paineis/painel5/dashboard', methods=['GET'])
@login_required
def api_painel5_dashboard():
    usuario_id = session.get('usuario_id')
    is_admin = session.get('is_admin', False)

    if not is_admin:
        if not verificar_permissao_painel(usuario_id, 'painel5'):
            return jsonify({'success': False, 'error': 'Sem permissão'}), 403

    conn = get_db_connection()
    if not conn:
        return jsonify({'success': False, 'error': 'Erro de conexão'}), 500

    try:
        cursor = conn.cursor()
        query = """
            SELECT
                COUNT(*) as total_cirurgias,
                COUNT(*) FILTER (
                    WHERE evento = 'Sem status'
                    OR nr_cirurgia IS NULL
                ) as cirurgias_previstas,
                COUNT(*) FILTER (
                    WHERE evento_codigo IN (12, 13)
                    AND nr_cirurgia IS NOT NULL
                ) as cirurgias_andamento,
                COUNT(*) FILTER (
                    WHERE evento_codigo IN (14, 15,16)
                    AND nr_cirurgia IS NOT NULL
                ) as cirurgias_realizadas
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
        return jsonify({'success': False, 'error': 'Erro ao buscar dados'}), 500


@app.route('/api/paineis/painel5/cirurgias', methods=['GET'])
@login_required
def api_painel5_cirurgias():
    usuario_id = session.get('usuario_id')
    is_admin = session.get('is_admin', False)

    if not is_admin:
        if not verificar_permissao_painel(usuario_id, 'painel5'):
            return jsonify({'success': False, 'error': 'Sem permissão'}), 403

    conn = get_db_connection()
    if not conn:
        return jsonify({'success': False, 'error': 'Erro de conexão'}), 500

    try:
        cursor = conn.cursor()
        query = """
            SELECT
                dt_agenda,
                evento_codigo,
                ds_agenda,
                cd_agenda,
                nr_minuto_duracao,
                nm_paciente_pf,
                ds_convenio,
                nm_medico,
                ds_idade_abrev,
                setor_cirurgia,
                nm_instrumentador,
                nm_circulante,
                dt_entrada_tasy,
                nr_atendimento,
                nr_cirurgia,
                cd_pessoa_fisica,
                nr_sequencia,
                ie_origem_proced,
                ie_tipo_classif,
                unidade_atendimento,
                ds_tipo_atendimento,
                hr_inicio,
                previsao_termino,
                nr_seq_proc_interno,
                ie_cancelada,
                nr_prescr_agenda,
                ds_proc_cir,
                evento,
                ie_status_cirurgia,
                ds_status,
                nr_prescricao,
                ie_tipo_atendimento,
                cd_medico,
                cd_procedimento,
                ds_carater_cirurgia,
                dt_carga,
                timestamp_completo,
                periodo_dia
            FROM vw_cirurgias_dia
            ORDER BY dt_agenda ASC, hr_inicio ASC
        """
        cursor.execute(query)
        colunas = [desc[0] for desc in cursor.description]
        cirurgias = [dict(zip(colunas, row)) for row in cursor.fetchall()]

        cirurgias_agrupadas = {}
        for cirurgia in cirurgias:
            dia_key = cirurgia['dt_agenda'].strftime('%d/%m/%Y') if cirurgia['dt_agenda'] else 'Sem data'
            if dia_key not in cirurgias_agrupadas:
                cirurgias_agrupadas[dia_key] = {
                    'data': dia_key,
                    'grupo': f"{dia_key} - {cirurgia['periodo_dia']}",
                    'cirurgias': []
                }
            cirurgias_agrupadas[dia_key]['cirurgias'].append(cirurgia)

        resultado = sorted(cirurgias_agrupadas.values(), key=lambda x: x['data'])

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
        return jsonify({'success': False, 'error': 'Erro ao buscar dados'}), 500


# =====================================================
# PAINEL 7: DETECÇÃO DE SEPSE
# =====================================================

# =====================================================
# PAINEL 7: DETECÇÃO DE SEPSE
# =====================================================

@app.route('/painel/painel7')
@login_required
def painel7():
    """Página do Painel 7 - Detecção de Sepse"""
    usuario_id = session.get('usuario_id')
    is_admin = session.get('is_admin', False)

    if not is_admin:
        if not verificar_permissao_painel(usuario_id, 'painel7'):
            app.logger.warning(f'Acesso negado ao painel7: {session.get("usuario")}')
            return send_from_directory('frontend', 'acesso-negado.html')

    return send_from_directory('paineis/painel7', 'index.html')


@app.route('/api/paineis/painel7/dashboard', methods=['GET'])
@login_required
def painel7_dashboard():
    """
    Dashboard de sepse
    LEFT JOIN = mostra todos pacientes, com ou sem análise IA
    """
    try:
        conn = get_db_connection()
        cursor = conn.cursor(cursor_factory=RealDictCursor)

        # LEFT JOIN para mostrar TODOS os pacientes
        query = """
            SELECT 
                COUNT(*) as total,
                COUNT(*) FILTER (WHERE v.nivel_risco_sepse = 'CRITICO') as critico,
                COUNT(*) FILTER (WHERE v.nivel_risco_sepse = 'ALTO') as alto,
                COUNT(*) FILTER (WHERE v.nivel_risco_sepse = 'MODERADO') as moderado,
                COUNT(*) FILTER (WHERE v.nivel_risco_sepse = 'BAIXO') as baixo
            FROM public.vw_painel_sepse v
            WHERE v.status_unidade = 'P'
                AND v.nivel_risco_sepse IN ('CRITICO', 'ALTO', 'MODERADO')
        """

        cursor.execute(query)
        result = cursor.fetchone()
        cursor.close()
        conn.close()

        if not result:
            result = {'total': 0, 'critico': 0, 'alto': 0, 'moderado': 0, 'baixo': 0}

        app.logger.info(f"[PAINEL7] Dashboard: {dict(result)}")

        return jsonify({
            'success': True,
            'data': dict(result),
            'timestamp': datetime.now().isoformat()
        }), 200

    except Exception as e:
        app.logger.error(f"[ERRO] /painel7/dashboard: {e}")
        import traceback
        app.logger.error(traceback.format_exc())
        return jsonify({'success': False, 'error': str(e)}), 500


@app.route('/api/paineis/painel7/lista', methods=['GET'])
@login_required
def painel7_lista():
    """
    Lista de pacientes com risco de sepse
    LEFT JOIN = mostra todos, com ou sem análise IA
    """
    try:
        limit = request.args.get('limit', 400, type=int)
        offset = request.args.get('offset', 0, type=int)

        if limit > 1000:
            limit = 1000

        conn = get_db_connection()
        cursor = conn.cursor(cursor_factory=RealDictCursor)

        # LEFT JOIN para pegar análise de IA quando existir
        query = """
            SELECT 
                v.nr_atendimento,
                v.nome_paciente,
                v.dt_nascimento,
                v.sexo,
                v.leito,
                v.setor,
                v.medico_responsavel,
                v.especialidade,
                v.dias_internacao,
                v.ds_convenio,

                v.pressao_sistolica,
                v.frequencia_cardiaca,
                v.frequencia_respiratoria,
                v.temperatura,
                v.saturacao_o2,

                v.leucocitos,
                v.plaquetas,
                v.creatinina,
                v.lactato_arterial,

                v.criterio_hipotensao,
                v.criterio_dessaturacao,
                v.criterio_temperatura,
                v.criterio_leucocitos,
                v.criterio_taquicardia,
                v.criterio_taquipneia,

                v.total_criterios_principais,
                v.total_criterios_adicionais,
                v.qsofa_score,
                v.nivel_risco_sepse,

                ia.analise_ia,
                ia.resumo_clinico,
                ia.modelo_ia,
                ia.data_analise

            FROM public.vw_painel_sepse v

            -- LEFT JOIN: pega análise quando existir
            LEFT JOIN public.painel_sepse_analise_ia ia 
                ON v.nr_atendimento = ia.nr_atendimento 
                AND COALESCE(ia.ie_ativo, TRUE) = TRUE

            WHERE v.status_unidade = 'P'
                AND v.nivel_risco_sepse IN ('CRITICO', 'ALTO', 'MODERADO')

            ORDER BY 
                CASE v.nivel_risco_sepse
                    WHEN 'CRITICO' THEN 1
                    WHEN 'ALTO' THEN 2
                    WHEN 'MODERADO' THEN 3
                END,
                v.total_criterios_principais DESC,
                v.qsofa_score DESC

            LIMIT %s OFFSET %s
        """

        cursor.execute(query, (limit, offset))
        registros = cursor.fetchall()

        app.logger.info(f"[PAINEL7] Query executada: {len(registros)} resultados")

        # Processar resultados
        resultado = []
        for reg in registros:
            item = dict(reg)

            # Calcular idade
            if item.get('dt_nascimento'):
                try:
                    dt_nasc = item['dt_nascimento']
                    hoje = datetime.now().date()

                    if hasattr(dt_nasc, 'date'):
                        dt_nasc = dt_nasc.date()

                    idade = hoje.year - dt_nasc.year
                    if (hoje.month, hoje.day) < (dt_nasc.month, dt_nasc.day):
                        idade -= 1
                    item['idade'] = idade
                except:
                    item['idade'] = None
            else:
                item['idade'] = None

            # Formatar datas para ISO
            for campo in ['data_analise', 'dt_nascimento']:
                if item.get(campo) and hasattr(item[campo], 'isoformat'):
                    item[campo] = item[campo].isoformat()

            resultado.append(item)

        cursor.close()
        conn.close()

        app.logger.info(f"[PAINEL7] Retornando {len(resultado)} pacientes processados")

        return jsonify({
            'success': True,
            'data': resultado,
            'total': len(resultado),
            'limit': limit,
            'offset': offset,
            'timestamp': datetime.now().isoformat()
        }), 200

    except Exception as e:
        app.logger.error(f"[ERRO] /painel7/lista: {e}")
        import traceback
        app.logger.error(traceback.format_exc())
        return jsonify({'success': False, 'error': str(e)}), 500


@app.route('/api/paineis/painel7/detalhes/<nr_atendimento>', methods=['GET'])
@login_required
def painel7_detalhes(nr_atendimento):
    """Detalhes de paciente específico"""
    try:
        conn = get_db_connection()
        cursor = conn.cursor(cursor_factory=RealDictCursor)

        query = """
            SELECT 
                v.*,
                ia.analise_ia,
                ia.recomendacoes_ia,
                ia.resumo_clinico,
                ia.modelo_ia,
                ia.data_analise
            FROM public.vw_painel_sepse v
            LEFT JOIN public.painel_sepse_analise_ia ia 
                ON v.nr_atendimento = ia.nr_atendimento 
                AND COALESCE(ia.ie_ativo, TRUE) = TRUE
            WHERE v.nr_atendimento = %s
        """

        cursor.execute(query, (nr_atendimento,))
        resultado = cursor.fetchone()
        cursor.close()
        conn.close()

        if not resultado:
            return jsonify({
                'success': False,
                'error': 'Paciente não encontrado'
            }), 404

        dados = dict(resultado)

        # Formatar datas
        for campo in ['dt_nascimento', 'dt_entrada_unidade', 'data_analise']:
            if dados.get(campo) and hasattr(dados[campo], 'isoformat'):
                dados[campo] = dados[campo].isoformat()

        return jsonify({
            'success': True,
            'data': dados,
            'timestamp': datetime.now().isoformat()
        }), 200

    except Exception as e:
        app.logger.error(f"[ERRO] /painel7/detalhes: {e}")
        return jsonify({'success': False, 'error': str(e)}), 500


# =========================================================
# 🏥 PAINEL 8 - MONITORAMENTO DE ENFERMARIA
# =========================================================
# INSTRUÇÕES: Adicione este bloco ao arquivo app.py principal
# Localização: Logo após o bloco do Painel 7
# =========================================================

@app.route('/painel/painel8')
@login_required
def painel8():
    """Página do Painel 8 - Monitoramento de Enfermaria"""
    usuario_id = session.get('usuario_id')
    is_admin = session.get('is_admin', False)

    if not is_admin:
        if not verificar_permissao_painel(usuario_id, 'painel8'):
            app.logger.warning(f'Acesso negado ao painel8: {session.get("usuario")}')
            return send_from_directory('frontend', 'acesso-negado.html')

    return send_from_directory('paineis/painel8', 'index.html')


def formatar_nome_paciente_painel8(nome_completo):
    """
    Formata nome do paciente conforme padrão do projeto:
    'MARIA DA SILVA SANTOS' -> 'MARIA DA S. S.'
    """
    if not nome_completo or nome_completo.strip() == '':
        return ''

    partes = nome_completo.strip().split()

    if len(partes) == 0:
        return ''
    elif len(partes) == 1:
        return partes[0]
    elif len(partes) == 2:
        return f"{partes[0]} {partes[1][0]}."
    else:
        # Primeiro nome + iniciais dos demais
        iniciais = ' '.join([p[0] + '.' for p in partes[1:]])
        return f"{partes[0]} {iniciais}"


@app.route('/api/paineis/painel8/enfermaria', methods=['GET'])
@login_required
def api_painel8_enfermaria():
    """
    Retorna dados dos leitos/pacientes
    Query params:
    - setor: Filtra por setor específico (ex: 'Internação Clínica')
    """
    usuario_id = session.get('usuario_id')
    is_admin = session.get('is_admin', False)

    if not is_admin:
        if not verificar_permissao_painel(usuario_id, 'painel8'):
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
        cursor = conn.cursor(cursor_factory=RealDictCursor)

        # Filtro por setor (opcional)
        setor = request.args.get('setor', None)

        if setor:
            query = """
                SELECT 
                    cd_unidade as leito,
                    nr_atendimento as atendimento,
                    nm_pessoa_fisica as paciente,
                    nr_anos as idade,
                    qt_dia_permanencia as dias_internado,
                    nr_prescricao,
                    prescrito_lab_dia,
                    prescrito_proc_dia,
                    evol_medico,
                    evol_enfermeiro,
                    evol_tec_enfermagem,
                    evol_nutricionista,
                    evol_fisioterapeuta,
                    parecer_pendente,
                    alergia,
                    score_news,
                    nm_setor,
                    cd_setor_atendimento,
                    ie_status_unidade,
                    ds_tipo_acomodacao
                FROM painel_enfermaria
                WHERE nm_setor = %s
                ORDER BY cd_unidade
            """
            cursor.execute(query, (setor,))
        else:
            query = """
                SELECT 
                    cd_unidade as leito,
                    nr_atendimento as atendimento,
                    nm_pessoa_fisica as paciente,
                    nr_anos as idade,
                    qt_dia_permanencia as dias_internado,
                    nr_prescricao,
                    prescrito_lab_dia,
                    prescrito_proc_dia,
                    evol_medico,
                    evol_enfermeiro,
                    evol_tec_enfermagem,
                    evol_nutricionista,
                    evol_fisioterapeuta,
                    parecer_pendente,
                    alergia,
                    score_news,
                    nm_setor,
                    cd_setor_atendimento,
                    ie_status_unidade,
                    ds_tipo_acomodacao
                FROM painel_enfermaria
                ORDER BY nm_setor, cd_unidade
            """
            cursor.execute(query)

        registros = cursor.fetchall()

        # Formatar nomes dos pacientes e limpar dados
        for registro in registros:
            if registro['paciente']:
                registro['paciente'] = formatar_nome_paciente_painel8(registro['paciente'])

            # Limpar espaços do leito
            if registro['leito']:
                registro['leito'] = registro['leito'].strip()

        cursor.close()
        conn.close()

        return jsonify({
            'success': True,
            'data': registros,
            'total': len(registros),
            'setor_filtrado': setor,
            'timestamp': datetime.now().isoformat()
        })

    except Exception as e:
        app.logger.error(f'Erro ao buscar dados do painel8: {e}', exc_info=True)
        if conn:
            conn.close()
        return jsonify({
            'success': False,
            'error': 'Erro ao buscar dados'
        }), 500


@app.route('/api/paineis/painel8/setores', methods=['GET'])
@login_required
def api_painel8_setores():
    """Retorna lista de setores disponíveis"""
    usuario_id = session.get('usuario_id')
    is_admin = session.get('is_admin', False)

    if not is_admin:
        if not verificar_permissao_painel(usuario_id, 'painel8'):
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
        cursor = conn.cursor(cursor_factory=RealDictCursor)

        query = """
            SELECT DISTINCT 
                nm_setor,
                cd_setor_atendimento
            FROM painel_enfermaria
            WHERE nm_setor IS NOT NULL
            ORDER BY nm_setor
        """

        cursor.execute(query)
        setores = cursor.fetchall()

        cursor.close()
        conn.close()

        return jsonify({
            'success': True,
            'setores': setores,
            'total': len(setores),
            'timestamp': datetime.now().isoformat()
        })

    except Exception as e:
        app.logger.error(f'Erro ao buscar setores do painel8: {e}', exc_info=True)
        if conn:
            conn.close()
        return jsonify({
            'success': False,
            'error': 'Erro ao buscar dados'
        }), 500


@app.route('/api/paineis/painel8/stats', methods=['GET'])
@login_required
def api_painel8_stats():
    """
    Retorna estatísticas de ocupação
    Query params:
    - setor: Calcula stats para setor específico (opcional)
    """
    usuario_id = session.get('usuario_id')
    is_admin = session.get('is_admin', False)

    if not is_admin:
        if not verificar_permissao_painel(usuario_id, 'painel8'):
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
        cursor = conn.cursor(cursor_factory=RealDictCursor)

        setor = request.args.get('setor', None)

        if setor:
            query = """
                SELECT 
                    nm_setor,
                    COUNT(*) as total_leitos,
                    COUNT(nr_atendimento) as leitos_ocupados,
                    COUNT(*) - COUNT(nr_atendimento) as leitos_livres,
                    ROUND(
                        (COUNT(nr_atendimento)::NUMERIC / COUNT(*)::NUMERIC) * 100, 
                        1
                    ) as percentual_ocupacao,
                    SUM(CASE WHEN score_news >= 5 THEN 1 ELSE 0 END) as pacientes_criticos,
                    SUM(CASE WHEN parecer_pendente = 'Sim' THEN 1 ELSE 0 END) as pareceres_pendentes,
                    SUM(CASE WHEN evol_medico = 'X' AND nr_atendimento IS NOT NULL THEN 1 ELSE 0 END) as sem_evolucao_medico
                FROM painel_enfermaria
                WHERE nm_setor = %s
                GROUP BY nm_setor
            """
            cursor.execute(query, (setor,))
            stats = cursor.fetchone()
        else:
            query = """
                SELECT 
                    nm_setor,
                    COUNT(*) as total_leitos,
                    COUNT(nr_atendimento) as leitos_ocupados,
                    COUNT(*) - COUNT(nr_atendimento) as leitos_livres,
                    ROUND(
                        (COUNT(nr_atendimento)::NUMERIC / COUNT(*)::NUMERIC) * 100, 
                        1
                    ) as percentual_ocupacao,
                    SUM(CASE WHEN score_news >= 5 THEN 1 ELSE 0 END) as pacientes_criticos,
                    SUM(CASE WHEN parecer_pendente = 'Sim' THEN 1 ELSE 0 END) as pareceres_pendentes,
                    SUM(CASE WHEN evol_medico = 'X' AND nr_atendimento IS NOT NULL THEN 1 ELSE 0 END) as sem_evolucao_medico
                FROM painel_enfermaria
                GROUP BY nm_setor
                ORDER BY nm_setor
            """
            cursor.execute(query)
            stats = cursor.fetchall()

        cursor.close()
        conn.close()

        return jsonify({
            'success': True,
            'stats': stats,
            'setor_filtrado': setor,
            'timestamp': datetime.now().isoformat()
        })

    except Exception as e:
        app.logger.error(f'Erro ao buscar estatísticas do painel8: {e}', exc_info=True)
        if conn:
            conn.close()
        return jsonify({
            'success': False,
            'error': 'Erro ao buscar dados'
        }), 500


# =========================================================
# FIM DAS ROTAS DO PAINEL 8
# =========================================================

# =========================================================
# 🧪 PAINEL 9 - PENDÊNCIAS LABORATORIAIS
# =========================================================

@app.route('/painel/painel9')
@login_required
def painel9():
    usuario_id = session.get('usuario_id')
    is_admin = session.get('is_admin', False)

    if not is_admin:
        if not verificar_permissao_painel(usuario_id, 'painel9'):
            app.logger.warning(f'Acesso negado ao painel9: {session.get("usuario")}')
            return send_from_directory('frontend', 'acesso-negado.html')

    return send_from_directory('paineis/painel9', 'index.html')


@app.route('/api/paineis/painel9/lab', methods=['GET'])
@login_required
def api_painel9_lab():
    usuario_id = session.get('usuario_id')
    is_admin = session.get('is_admin', False)

    if not is_admin:
        if not verificar_permissao_painel(usuario_id, 'painel9'):
            return jsonify({'success': False, 'error': 'Sem permissão'}), 403

    conn = get_db_connection()
    if not conn:
        return jsonify({'success': False, 'error': 'Erro de conexão'}), 500

    try:
        cursor = conn.cursor(cursor_factory=RealDictCursor)
        setor = request.args.get('setor', None)

        if setor:
            query = """
                SELECT 
                    cd_unidade,
                    nm_setor,
                    nr_atendimento,
                    nm_pessoa_fisica,
                    EXTRACT(YEAR FROM AGE(CURRENT_DATE, dt_nascimento))::INTEGER AS nr_anos,
                    qt_dia_permanencia,
                    lab_pendentes
                FROM pendencias_lab
                WHERE nm_setor = %s
                  AND lab_pendentes IS NOT NULL
                  AND lab_pendentes <> ''
                ORDER BY cd_unidade
            """
            cursor.execute(query, (setor,))
        else:
            query = """
                SELECT 
                    cd_unidade,
                    nm_setor,
                    nr_atendimento,
                    nm_pessoa_fisica,
                    EXTRACT(YEAR FROM AGE(CURRENT_DATE, dt_nascimento))::INTEGER AS nr_anos,
                    qt_dia_permanencia,
                    lab_pendentes
                FROM pendencias_lab
                WHERE lab_pendentes IS NOT NULL
                  AND lab_pendentes <> ''
                ORDER BY nm_setor, cd_unidade
            """
            cursor.execute(query)

        registros = cursor.fetchall()
        cursor.close()
        conn.close()

        return jsonify({
            'success': True,
            'data': registros,
            'total': len(registros),
            'setor_filtrado': setor,
            'timestamp': datetime.now().isoformat()
        })

    except Exception as e:
        app.logger.error(f'Erro ao buscar lab pendentes: {e}', exc_info=True)
        if conn:
            conn.close()
        return jsonify({'success': False, 'error': str(e)}), 500


@app.route('/api/paineis/painel9/setores', methods=['GET'])
@login_required
def api_painel9_setores():
    usuario_id = session.get('usuario_id')
    is_admin = session.get('is_admin', False)

    if not is_admin:
        if not verificar_permissao_painel(usuario_id, 'painel9'):
            return jsonify({'success': False, 'error': 'Sem permissão'}), 403

    conn = get_db_connection()
    if not conn:
        return jsonify({'success': False, 'error': 'Erro de conexão'}), 500

    try:
        cursor = conn.cursor(cursor_factory=RealDictCursor)
        query = """
            SELECT DISTINCT 
                nm_setor, 
                cd_setor_atendimento
            FROM pendencias_lab
            WHERE nm_setor IS NOT NULL
              AND lab_pendentes IS NOT NULL
              AND lab_pendentes <> ''
            ORDER BY nm_setor
        """
        cursor.execute(query)
        setores = cursor.fetchall()
        cursor.close()
        conn.close()

        return jsonify({
            'success': True,
            'setores': setores,
            'total': len(setores),
            'timestamp': datetime.now().isoformat()
        })

    except Exception as e:
        app.logger.error(f'Erro ao buscar setores painel9: {e}', exc_info=True)
        if conn:
            conn.close()
        return jsonify({'success': False, 'error': str(e)}), 500


# =========================================================
# 📊 PAINEL 10 - ANÁLISE DO PRONTO SOCORRO
# =========================================================

@app.route('/painel/painel10')
@login_required
def painel10():
    """Página do Painel 10 - Análise do Pronto Socorro"""
    usuario_id = session.get('usuario_id')
    is_admin = session.get('is_admin', False)

    if not is_admin:
        if not verificar_permissao_painel(usuario_id, 'painel10'):
            app.logger.warning(f'Acesso negado ao painel10: {session.get("usuario")}')
            return send_from_directory('frontend', 'acesso-negado.html')

    return send_from_directory('paineis/painel10', 'index.html')


@app.route('/api/paineis/painel10/dashboard', methods=['GET'])
@login_required
def api_painel10_dashboard():
    """
    Dashboard geral do dia
    GET /api/paineis/painel10/dashboard
    """
    usuario_id = session.get('usuario_id')
    is_admin = session.get('is_admin', False)

    if not is_admin:
        if not verificar_permissao_painel(usuario_id, 'painel10'):
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
        cursor = conn.cursor(cursor_factory=RealDictCursor)

        query = "SELECT * FROM vw_ps_dashboard_dia"
        cursor.execute(query)
        resultado = cursor.fetchone()

        cursor.close()
        conn.close()

        if not resultado:
            dados = {
                'total_atendimentos_dia': 0,
                'atendimentos_realizados': 0,
                'aguardando_atendimento': 0,
                'pacientes_alta': 0,
                'tempo_medio_permanencia_min': 0,
                'tempo_medio_espera_consulta_min': 0
            }
        else:
            dados = dict(resultado)

        return jsonify({
            'success': True,
            'data': dados,
            'timestamp': datetime.now().isoformat()
        })

    except Exception as e:
        app.logger.error(f'Erro ao buscar dashboard painel10: {e}', exc_info=True)
        if conn:
            conn.close()
        return jsonify({
            'success': False,
            'error': 'Erro ao buscar dados'
        }), 500


@app.route('/api/paineis/painel10/tempo-clinica', methods=['GET'])
@login_required
def api_painel10_tempo_clinica():
    """
    Tempo médio de espera por clínica
    GET /api/paineis/painel10/tempo-clinica
    """
    usuario_id = session.get('usuario_id')
    is_admin = session.get('is_admin', False)

    if not is_admin:
        if not verificar_permissao_painel(usuario_id, 'painel10'):
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
        cursor = conn.cursor(cursor_factory=RealDictCursor)

        query = "SELECT * FROM vw_ps_tempo_por_clinica"
        cursor.execute(query)
        dados = cursor.fetchall()

        cursor.close()
        conn.close()

        return jsonify({
            'success': True,
            'data': [dict(row) for row in dados],
            'total': len(dados),
            'timestamp': datetime.now().isoformat()
        })

    except Exception as e:
        app.logger.error(f'Erro ao buscar tempo por clínica: {e}', exc_info=True)
        if conn:
            conn.close()
        return jsonify({
            'success': False,
            'error': 'Erro ao buscar dados'
        }), 500


@app.route('/api/paineis/painel10/aguardando-clinica', methods=['GET'])
@login_required
def api_painel10_aguardando_clinica():
    """
    Pacientes aguardando por clínica
    GET /api/paineis/painel10/aguardando-clinica
    """
    usuario_id = session.get('usuario_id')
    is_admin = session.get('is_admin', False)

    if not is_admin:
        if not verificar_permissao_painel(usuario_id, 'painel10'):
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
        cursor = conn.cursor(cursor_factory=RealDictCursor)

        query = "SELECT * FROM vw_ps_aguardando_por_clinica"
        cursor.execute(query)
        dados = cursor.fetchall()

        cursor.close()
        conn.close()

        return jsonify({
            'success': True,
            'data': [dict(row) for row in dados],
            'total': len(dados),
            'timestamp': datetime.now().isoformat()
        })

    except Exception as e:
        app.logger.error(f'Erro ao buscar aguardando por clínica: {e}', exc_info=True)
        if conn:
            conn.close()
        return jsonify({
            'success': False,
            'error': 'Erro ao buscar dados'
        }), 500


@app.route('/api/paineis/painel10/atendimentos-hora', methods=['GET'])
@login_required
def api_painel10_atendimentos_hora():
    """
    Atendimentos por hora do dia (para gráfico)
    GET /api/paineis/painel10/atendimentos-hora
    """
    usuario_id = session.get('usuario_id')
    is_admin = session.get('is_admin', False)

    if not is_admin:
        if not verificar_permissao_painel(usuario_id, 'painel10'):
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
        cursor = conn.cursor(cursor_factory=RealDictCursor)

        query = "SELECT * FROM vw_ps_atendimentos_por_hora"
        cursor.execute(query)
        dados = cursor.fetchall()

        cursor.close()
        conn.close()

        return jsonify({
            'success': True,
            'data': [dict(row) for row in dados],
            'total': len(dados),
            'timestamp': datetime.now().isoformat()
        })

    except Exception as e:
        app.logger.error(f'Erro ao buscar atendimentos por hora: {e}', exc_info=True)
        if conn:
            conn.close()
        return jsonify({
            'success': False,
            'error': 'Erro ao buscar dados'
        }), 500


@app.route('/api/paineis/painel10/desempenho-medico', methods=['GET'])
@login_required
def api_painel10_desempenho_medico():
    """
    Desempenho por médico
    GET /api/paineis/painel10/desempenho-medico
    """
    usuario_id = session.get('usuario_id')
    is_admin = session.get('is_admin', False)

    if not is_admin:
        if not verificar_permissao_painel(usuario_id, 'painel10'):
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
        cursor = conn.cursor(cursor_factory=RealDictCursor)

        query = "SELECT * FROM vw_ps_desempenho_medico"
        cursor.execute(query)
        dados = cursor.fetchall()

        cursor.close()
        conn.close()

        return jsonify({
            'success': True,
            'data': [dict(row) for row in dados],
            'total': len(dados),
            'timestamp': datetime.now().isoformat()
        })

    except Exception as e:
        app.logger.error(f'Erro ao buscar desempenho médico: {e}', exc_info=True)
        if conn:
            conn.close()
        return jsonify({
            'success': False,
            'error': 'Erro ao buscar dados'
        }), 500


@app.route('/api/paineis/painel10/desempenho-recepcao', methods=['GET'])
@login_required
def api_painel10_desempenho_recepcao():
    """
    Desempenho da recepção
    GET /api/paineis/painel10/desempenho-recepcao
    """
    usuario_id = session.get('usuario_id')
    is_admin = session.get('is_admin', False)

    if not is_admin:
        if not verificar_permissao_painel(usuario_id, 'painel10'):
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
        cursor = conn.cursor(cursor_factory=RealDictCursor)

        query = "SELECT * FROM vw_ps_desempenho_recepcao"
        cursor.execute(query)
        resultado = cursor.fetchone()

        cursor.close()
        conn.close()

        if not resultado:
            dados = {
                'total_recebidos': 0,
                'tempo_medio_recepcao_min': 0,
                'aguardando_recepcao': 0
            }
        else:
            dados = dict(resultado)

        return jsonify({
            'success': True,
            'data': dados,
            'timestamp': datetime.now().isoformat()
        })

    except Exception as e:
        app.logger.error(f'Erro ao buscar desempenho recepção: {e}', exc_info=True)
        if conn:
            conn.close()
        return jsonify({
            'success': False,
            'error': 'Erro ao buscar dados'
        }), 500


# =========================================================
# FIM DAS ROTAS DO PAINEL 10
# =========================================================


# =========================================================
# 🏥 PAINEL 11 - MONITORAMENTO DE ALTA DO PS
# =========================================================
# INSTRUÇÕES: Adicione este bloco ao arquivo app.py
# Localização: Logo após o bloco do Painel 10
# =========================================================

@app.route('/painel/painel11')
@login_required
def painel11():
    """Página do Painel 11 - Monitoramento de Alta do PS"""
    usuario_id = session.get('usuario_id')
    is_admin = session.get('is_admin', False)

    if not is_admin:
        if not verificar_permissao_painel(usuario_id, 'painel11'):
            app.logger.warning(f'Acesso negado ao painel11: {session.get("usuario")}')
            return send_from_directory('frontend', 'acesso-negado.html')

    return send_from_directory('paineis/painel11', 'index.html')


@app.route('/api/paineis/painel11/dashboard', methods=['GET'])
@login_required
def api_painel11_dashboard():
    """
    Dashboard geral - estatísticas do dia
    GET /api/paineis/painel11/dashboard
    """
    usuario_id = session.get('usuario_id')
    is_admin = session.get('is_admin', False)

    if not is_admin:
        if not verificar_permissao_painel(usuario_id, 'painel11'):
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
        cursor = conn.cursor(cursor_factory=RealDictCursor)

        query = """
            SELECT 
                COUNT(*) AS total_altas,
                COUNT(*) FILTER (WHERE status_internacao = 'AGUARDANDO_VAGA') AS total_aguardando,
                COUNT(*) FILTER (WHERE status_internacao = 'INTERNADO') AS total_internados,
                COUNT(*) FILTER (
                    WHERE status_internacao = 'AGUARDANDO_VAGA' 
                    AND minutos_aguardando >= 240
                ) AS total_criticos,

                -- Tempo médio de espera (somente dos que estão aguardando)
                CASE 
                    WHEN COUNT(*) FILTER (WHERE status_internacao = 'AGUARDANDO_VAGA') > 0 THEN
                        CONCAT(
                            FLOOR(AVG(minutos_aguardando) FILTER (WHERE status_internacao = 'AGUARDANDO_VAGA') / 60), 'h ',
                            FLOOR(AVG(minutos_aguardando) FILTER (WHERE status_internacao = 'AGUARDANDO_VAGA') % 60), 'm'
                        )
                    ELSE '-'
                END AS tempo_medio_espera

            FROM vw_painel_ps_alta_internacao
        """

        cursor.execute(query)
        resultado = cursor.fetchone()
        cursor.close()
        conn.close()

        if not resultado:
            dados = {
                'total_altas': 0,
                'total_aguardando': 0,
                'total_internados': 0,
                'tempo_medio_espera': '-',
                'total_criticos': 0
            }
        else:
            dados = dict(resultado)

        return jsonify({
            'success': True,
            'data': dados,
            'timestamp': datetime.now().isoformat()
        })

    except Exception as e:
        app.logger.error(f'Erro ao buscar dashboard painel11: {e}', exc_info=True)
        if conn:
            conn.close()
        return jsonify({
            'success': False,
            'error': 'Erro ao buscar dados'
        }), 500


@app.route('/api/paineis/painel11/lista', methods=['GET'])
@login_required
def api_painel11_lista():
    """
    Lista de pacientes com alta para internação
    GET /api/paineis/painel11/lista?status=AGUARDANDO_VAGA
    """
    usuario_id = session.get('usuario_id')
    is_admin = session.get('is_admin', False)

    if not is_admin:
        if not verificar_permissao_painel(usuario_id, 'painel11'):
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
        cursor = conn.cursor(cursor_factory=RealDictCursor)

        # Filtro por status (opcional)
        status_filtro = request.args.get('status', None)

        if status_filtro:
            query = """
                SELECT 
                    nr_atendimento,
                    nm_pessoa_fisica,
                    qt_idade,
                    ds_convenio,
                    ds_clinica,
                    dt_alta,
                    ds_necessidade_vaga,
                    status_internacao,
                    nr_atendimento_internado AS atendimento_internado,
                    dt_internacao,
                    minutos_aguardando
                FROM vw_painel_ps_alta_internacao
                WHERE status_internacao = %s
                ORDER BY 
                    CASE 
                        WHEN status_internacao = 'AGUARDANDO_VAGA' THEN minutos_aguardando
                        ELSE 0
                    END DESC,
                    dt_alta ASC
            """
            cursor.execute(query, (status_filtro,))
        else:
            query = """
                SELECT 
                    nr_atendimento,
                    nm_pessoa_fisica,
                    qt_idade,
                    ds_convenio,
                    ds_clinica,
                    dt_alta,
                    ds_necessidade_vaga,
                    status_internacao,
                    nr_atendimento_internado AS atendimento_internado,
                    dt_internacao,
                    minutos_aguardando
                FROM vw_painel_ps_alta_internacao
                ORDER BY 
                    CASE 
                        WHEN status_internacao = 'AGUARDANDO_VAGA' THEN 0
                        ELSE 1
                    END,
                    CASE 
                        WHEN status_internacao = 'AGUARDANDO_VAGA' THEN minutos_aguardando
                        ELSE 0
                    END DESC,
                    dt_alta ASC
            """
            cursor.execute(query)

        registros = cursor.fetchall()

        # Formatar datas para ISO
        resultado = []
        for reg in registros:
            item = dict(reg)

            for campo in ['dt_alta', 'dt_internacao']:
                if item.get(campo) and hasattr(item[campo], 'isoformat'):
                    item[campo] = item[campo].isoformat()

            resultado.append(item)

        cursor.close()
        conn.close()

        return jsonify({
            'success': True,
            'data': resultado,
            'total': len(resultado),
            'status_filtrado': status_filtro,
            'timestamp': datetime.now().isoformat()
        })

    except Exception as e:
        app.logger.error(f'Erro ao buscar lista painel11: {e}', exc_info=True)
        if conn:
            conn.close()
        return jsonify({
            'success': False,
            'error': 'Erro ao buscar dados'
        }), 500


# =========================================================
# FIM DAS ROTAS DO PAINEL 11
# =========================================================






# =========================================================
# 👥 ADMINISTRAÇÃO DE USUÁRIOS
# =========================================================

@app.route('/api/minhas-permissoes', methods=['GET'])
@login_required
def api_minhas_permissoes():
    try:
        usuario_id = session.get('usuario_id')
        is_admin = session.get('is_admin', False)

        if is_admin:
            return jsonify({
                'success': True,
                'permissoes': ['painel2', 'painel3', 'painel4', 'painel5', 'painel6'],
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
            {'nome': 'painel2', 'titulo': 'Evolução de Turno', 'descricao': 'Acompanhamento de evoluções médicas',
             'ativo': True},
            {'nome': 'painel3', 'titulo': 'Médicos PS', 'descricao': 'Monitoramento de médicos logados', 'ativo': True},
            {'nome': 'painel4', 'titulo': 'Ocupação Hospitalar', 'descricao': 'Monitoramento de ocupação de leitos',
             'ativo': True},
            {'nome': 'painel5', 'titulo': 'Cirurgias do Dia', 'descricao': 'Acompanhamento de cirurgias agendadas',
             'ativo': True},
            {'nome': 'painel6', 'titulo': 'Priorização Clínica IA',
             'descricao': 'Análise de risco com inteligência artificial', 'ativo': True},
        ]

        return jsonify({'success': True, 'paineis': paineis}), 200

    except Exception as e:
        app.logger.error(f'Erro ao listar painéis: {e}', exc_info=True)
        return jsonify({'success': False, 'error': 'Erro interno'}), 500


# =========================================================
# 🚀 INICIALIZAÇÃO
# =========================================================

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
    print("   • Evolução de Turno:    /painel/painel2")
    print("   • Médicos PS:           /painel/painel3")
    print("   • Ocupação Hosp.:       /painel/painel4")
    print("   • Cirurgias do Dia:     /painel/painel5")
    print("   • Priorização IA:       /painel/painel6 🤖")
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
