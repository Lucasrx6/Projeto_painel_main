from flask import Flask, jsonify, request, send_from_directory, session
from flask_cors import CORS
from functools import wraps
import os
from datetime import datetime, timedelta
from dotenv import load_dotenv
from backend.database import get_db_connection, init_db
from backend.auth import verificar_usuario, criar_usuario
import secrets

load_dotenv()

app = Flask(__name__)
app.secret_key = os.getenv('SECRET_KEY', secrets.token_hex(32))
app.config['PERMANENT_SESSION_LIFETIME'] = timedelta(hours=8)

CORS(app, supports_credentials=True)

# Inicializa o banco de dados
init_db()


# ==================== DECORADORES ====================

def login_required(f):
    """Decorator para proteger rotas que precisam de autenticação"""

    @wraps(f)
    def decorated_function(*args, **kwargs):
        if 'usuario_id' not in session:
            return jsonify({'success': False, 'error': 'Não autenticado'}), 401
        return f(*args, **kwargs)

    return decorated_function


def admin_required(f):
    """Decorator para rotas que precisam de permissão de admin"""

    @wraps(f)
    def decorated_function(*args, **kwargs):
        if 'usuario_id' not in session:
            return jsonify({'success': False, 'error': 'Não autenticado'}), 401

        if not session.get('is_admin', False):
            return jsonify({'success': False, 'error': 'Sem permissão de administrador'}), 403

        return f(*args, **kwargs)

    return decorated_function


# ==================== ROTAS PÚBLICAS ====================

@app.route('/')
def index():
    """Redireciona para login se não estiver autenticado"""
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


# ==================== API DE AUTENTICAÇÃO ====================

@app.route('/api/login', methods=['POST'])
def login():
    """Endpoint de login"""
    try:
        dados = request.get_json()
        usuario = dados.get('usuario')
        senha = dados.get('senha')

        if not usuario or not senha:
            return jsonify({'success': False, 'error': 'Usuário e senha são obrigatórios'}), 400

        resultado = verificar_usuario(usuario, senha)

        if resultado['success']:
            session.permanent = True
            session['usuario_id'] = resultado['usuario_id']
            session['usuario'] = resultado['usuario']
            session['is_admin'] = resultado['is_admin']

            return jsonify({
                'success': True,
                'usuario': resultado['usuario'],
                'is_admin': resultado['is_admin']
            })
        else:
            return jsonify({'success': False, 'error': 'Usuário ou senha inválidos'}), 401

    except Exception as e:
        print(f"❌ Erro no login: {e}")
        return jsonify({'success': False, 'error': str(e)}), 500


@app.route('/api/logout', methods=['POST'])
def logout():
    """Endpoint de logout"""
    session.clear()
    return jsonify({'success': True})


@app.route('/api/cadastro', methods=['POST'])
@admin_required
def cadastro():
    """Endpoint de cadastro (apenas admin)"""
    try:
        dados = request.get_json()
        usuario = dados.get('usuario')
        senha = dados.get('senha')
        email = dados.get('email')
        is_admin = dados.get('is_admin', False)

        if not usuario or not senha or not email:
            return jsonify({'success': False, 'error': 'Todos os campos são obrigatórios'}), 400

        resultado = criar_usuario(usuario, senha, email, is_admin)

        if resultado['success']:
            return jsonify({'success': True, 'message': 'Usuário criado com sucesso'})
        else:
            return jsonify({'success': False, 'error': resultado['error']}), 400

    except Exception as e:
        print(f"❌ Erro no cadastro: {e}")
        return jsonify({'success': False, 'error': str(e)}), 500


@app.route('/api/verificar-sessao', methods=['GET'])
def verificar_sessao():
    """Verifica se o usuário está autenticado"""
    if 'usuario_id' in session:
        return jsonify({
            'success': True,
            'autenticado': True,
            'usuario': session.get('usuario'),
            'is_admin': session.get('is_admin', False)
        })
    return jsonify({'success': True, 'autenticado': False})


# ==================== ROTAS DOS PAINÉIS ====================

@app.route('/painel/<painel_nome>')
@login_required
def painel(painel_nome):
    """Serve o painel específico"""
    painel_path = f'paineis/{painel_nome}/index.html'
    if os.path.exists(painel_path):
        return send_from_directory(f'paineis/{painel_nome}', 'index.html')
    return jsonify({'error': 'Painel não encontrado'}), 404


@app.route('/paineis/<painel_nome>/<path:path>')
@login_required
def serve_painel_files(painel_nome, path):
    """Serve arquivos estáticos dos painéis"""
    return send_from_directory(f'paineis/{painel_nome}', path)


# ==================== API DOS PAINÉIS ====================

@app.route('/api/paineis/painel2/evolucoes', methods=['GET'])
@login_required
def get_evolucoes():
    """Retorna registros de evolução de turno"""
    conn = get_db_connection()
    if not conn:
        return jsonify({
            'success': False,
            'error': 'Erro de conexão com o banco'
        }), 500

    try:
        cursor = conn.cursor()

        query = """
SELECT 
    nr_atendimento, 
    ds_convenio, 
    nm_paciente, 
    idade, 
    dt_entrada, 
    medico_responsavel, 
    medico_atendimento, 
    dias_internado, 
    TO_CHAR(data_turno::TIMESTAMP, 'DD/MM/YYYY HH24:MI:SS') as data_turno, 
    turno, 
    setor, 
    unidade, 
    dt_admissao_unidade, 
    evol_medico, 
    evol_enfermeiro, 
    evol_tec_enfermagem, 
    evol_nutricionista, 
    evol_fisioterapeuta, 
    dt_carga
FROM public.evolucao_turno
WHERE 1=1
AND SETOR IS NOT NULL
ORDER BY data_turno::TIMESTAMP DESC, turno ASC, nr_atendimento
                """

        cursor.execute(query)
        colunas = [desc[0] for desc in cursor.description]
        evolucoes = [dict(zip(colunas, row)) for row in cursor.fetchall()]

        cursor.close()
        conn.close()

        return jsonify({
            'success': True,
            'data': evolucoes,
            'total': len(evolucoes),
            'timestamp': datetime.now().isoformat()
        })

    except Exception as e:
        print(f"❌ Erro ao buscar dados: {e}")
        if conn:
            conn.close()
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500


@app.route('/api/paineis/painel3/medicos', methods=['GET'])
@login_required
def get_medicos_ps():
    """Retorna registros de médicos logados no PS"""
    conn = get_db_connection()
    if not conn:
        return jsonify({
            'success': False,
            'error': 'Erro de conexão com o banco'
        }), 500

    try:
        cursor = conn.cursor()

        # Query para buscar médicos logados
        # AJUSTE OS NOMES DAS COLUNAS DE ACORDO COM SUA TABELA medicos_ps
        query = """
SELECT 
    consultorio,
    nome_medico,
    crm,
    especialidade,
    status,
    data_login,
    tempo_logado,
    dt_carga
FROM public.medicos_ps
WHERE 1=1
ORDER BY 
    CASE WHEN status = 'LOGADO' THEN 0 ELSE 1 END,
    consultorio,
    nome_medico
                """

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
        print(f"❌ Erro ao buscar dados de médicos: {e}")
        if conn:
            conn.close()
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500


# ==================== INICIALIZAÇÃO ====================

if __name__ == '__main__':
    import socket

    # Obtém o IP local da máquina
    hostname = socket.gethostname()
    local_ip = socket.gethostbyname(hostname)

    print("\n" + "=" * 60)
    print("🚀 SERVIDOR PRINCIPAL INICIADO")
    print("=" * 60)
    print("🔐 Sistema de autenticação ativo")
    print("📊 Painéis disponíveis:")
    print("   • Evolução de Turno: /painel/painel2")
    print("   • Médicos PS:         /painel/painel3")
    print("\n🌐 URLs de Acesso:")
    print(f"   • Local:        http://localhost:5000")
    print(f"   • Local (IP):   http://127.0.0.1:5000")
    print(f"   • Rede Local:   http://{local_ip}:5000")
    print(f"   • Rede (fixo):  http://172.16.1.75:5000")
    print("\n💡 Compartilhe o link da rede local com outros computadores!")
    print("=" * 60 + "\n")

    app.run(debug=True, host='0.0.0.0', port=5000)