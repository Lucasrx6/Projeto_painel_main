from flask import Flask, jsonify, request, send_from_directory, session
from flask_cors import CORS
from functools import wraps
import os
from datetime import datetime, timedelta
from dotenv import load_dotenv
from backend.database import get_db_connection, init_db
from backend.auth import verificar_usuario, criar_usuario
import secrets
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
    verificar_permissao_painel  # ← ADICIONAR ESTA LINHA
)

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

@app.route('/admin/usuarios')
@admin_required
def admin_usuarios_page():
    return send_from_directory('frontend', 'admin-usuarios.html')
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
    """Serve o painel específico (verificando permissões)"""
    usuario_id = session.get('usuario_id')
    is_admin = session.get('is_admin', False)

    # Admin tem acesso a tudo
    if not is_admin:
        # Verifica se usuário tem permissão
        if not verificar_permissao_painel(usuario_id, painel_nome):
            # 🆕 Redireciona para página de acesso negado
            return send_from_directory('frontend', 'acesso-negado.html')

    painel_path = f'paineis/{painel_nome}/index.html'
    if os.path.exists(painel_path):
        return send_from_directory(f'paineis/{painel_nome}', 'index.html')
    return jsonify({'error': 'Painel não encontrado'}), 404


# ==================== ROTA PARA SERVIR PÁGINA DE ACESSO NEGADO ====================

@app.route('/acesso-negado')
def acesso_negado_page():
    """Página de acesso negado"""
    return send_from_directory('frontend', 'acesso-negado.html')


@app.route('/paineis/<painel_nome>/<path:path>')
@login_required
def serve_painel_files(painel_nome, path):
    """Serve arquivos estáticos dos painéis"""
    return send_from_directory(f'paineis/{painel_nome}', path)


# ==================== API DOS PAINÉIS ====================

@app.route('/api/paineis/painel2/evolucoes', methods=['GET'])
@login_required
def get_evolucoes():
    """Retorna registros priorizando o turno atual (verificando permissões)"""
    usuario_id = session.get('usuario_id')
    is_admin = session.get('is_admin', False)

    # Admin tem acesso a tudo
    if not is_admin:
        # Verifica permissão
        if not verificar_permissao_painel(usuario_id, 'painel2'):
            return jsonify({
                'success': False,
                'error': 'Sem permissão para acessar este painel'
            }), 403

    # Resto do código permanece igual...
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
    """Retorna registros de médicos logados no PS (verificando permissões)"""
    usuario_id = session.get('usuario_id')
    is_admin = session.get('is_admin', False)

    # Admin tem acesso a tudo
    if not is_admin:
        # Verifica permissão
        if not verificar_permissao_painel(usuario_id, 'painel3'):
            return jsonify({
                'success': False,
                'error': 'Sem permissão para acessar este painel'
            }), 403

    # Resto do código permanece igual...
    conn = get_db_connection()
    if not conn:
        return jsonify({
            'success': False,
            'error': 'Erro de conexão com o banco'
        }), 500

    try:
        cursor = conn.cursor()

        query = """
SELECT *
FROM public.medicos_ps
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


# ==================== NOVA ROTA: OBTER PERMISSÕES DO USUÁRIO LOGADO ====================

@app.route('/api/minhas-permissoes', methods=['GET'])
@login_required
def api_minhas_permissoes():
    """Retorna as permissões do usuário logado"""
    try:
        usuario_id = session.get('usuario_id')
        is_admin = session.get('is_admin', False)

        if is_admin:
            # Admin tem acesso a todos os painéis
            return jsonify({
                'success': True,
                'permissoes': ['painel2', 'painel3'],  # Todos os painéis
                'is_admin': True
            })

        # Busca permissões do usuário
        from backend.user_management import obter_permissoes
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
        print(f"❌ Erro ao obter permissões: {e}")
        return jsonify({'success': False, 'error': str(e)}), 500


# ==================== ROTAS DE GESTÃO DE USUÁRIOS ====================
# Adicionar ao app.py após as rotas de autenticação existentes

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
    obter_estatisticas
)


# ==================== LISTAR E VISUALIZAR ====================

@app.route('/api/admin/usuarios', methods=['GET'])
@admin_required
def api_listar_usuarios():
    """Lista todos os usuários (apenas admin)"""
    try:
        incluir_inativos = request.args.get('incluir_inativos', 'true').lower() == 'true'
        resultado = listar_usuarios(incluir_inativos=incluir_inativos)

        if resultado['success']:
            return jsonify(resultado), 200
        else:
            return jsonify(resultado), 500

    except Exception as e:
        print(f"❌ Erro ao listar usuários: {e}")
        return jsonify({'success': False, 'error': str(e)}), 500


@app.route('/api/admin/usuarios/<int:usuario_id>', methods=['GET'])
@admin_required
def api_obter_usuario(usuario_id):
    """Obtém detalhes de um usuário específico (apenas admin)"""
    try:
        resultado = obter_usuario(usuario_id)

        if resultado['success']:
            return jsonify(resultado), 200
        else:
            return jsonify(resultado), 404

    except Exception as e:
        print(f"❌ Erro ao obter usuário: {e}")
        return jsonify({'success': False, 'error': str(e)}), 500


@app.route('/api/admin/estatisticas', methods=['GET'])
@admin_required
def api_estatisticas():
    """Obtém estatísticas gerais dos usuários (apenas admin)"""
    try:
        resultado = obter_estatisticas()

        if resultado['success']:
            return jsonify(resultado), 200
        else:
            return jsonify(resultado), 500

    except Exception as e:
        print(f"❌ Erro ao obter estatísticas: {e}")
        return jsonify({'success': False, 'error': str(e)}), 500


# ==================== EDITAR USUÁRIO ====================

@app.route('/api/admin/usuarios/<int:usuario_id>', methods=['PUT'])
@admin_required
def api_editar_usuario(usuario_id):
    """Edita informações de um usuário (apenas admin)"""
    try:
        dados = request.get_json()
        admin_id = session.get('usuario_id')

        # Validação básica
        if not dados:
            return jsonify({'success': False, 'error': 'Nenhum dado fornecido'}), 400

        resultado = editar_usuario(usuario_id, dados, admin_id)

        if resultado['success']:
            return jsonify(resultado), 200
        else:
            return jsonify(resultado), 400

    except Exception as e:
        print(f"❌ Erro ao editar usuário: {e}")
        return jsonify({'success': False, 'error': str(e)}), 500


# ==================== STATUS (ATIVAR/DESATIVAR) ====================

@app.route('/api/admin/usuarios/<int:usuario_id>/status', methods=['PUT'])
@admin_required
def api_alterar_status(usuario_id):
    """Ativa ou desativa um usuário (apenas admin)"""
    try:
        dados = request.get_json()
        admin_id = session.get('usuario_id')

        if 'ativo' not in dados:
            return jsonify({'success': False, 'error': 'Campo "ativo" é obrigatório'}), 400

        ativo = dados['ativo']

        # Não permitir que admin desative a si mesmo
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
        print(f"❌ Erro ao alterar status: {e}")
        return jsonify({'success': False, 'error': str(e)}), 500


# ==================== RESET DE SENHA ====================

@app.route('/api/admin/usuarios/<int:usuario_id>/senha', methods=['PUT'])
@admin_required
def api_resetar_senha(usuario_id):
    """Reseta a senha de um usuário (apenas admin)"""
    try:
        dados = request.get_json()
        admin_id = session.get('usuario_id')

        if 'nova_senha' not in dados:
            return jsonify({'success': False, 'error': 'Campo "nova_senha" é obrigatório'}), 400

        nova_senha = dados['nova_senha']

        # Validação de senha
        if len(nova_senha) < 4:
            return jsonify({
                'success': False,
                'error': 'A senha deve ter no mínimo 4 caracteres'
            }), 400

        resultado = resetar_senha(usuario_id, nova_senha, admin_id)

        if resultado['success']:
            return jsonify(resultado), 200
        else:
            return jsonify(resultado), 400

    except Exception as e:
        print(f"❌ Erro ao resetar senha: {e}")
        return jsonify({'success': False, 'error': str(e)}), 500


# ==================== PERMISSÕES ====================

@app.route('/api/admin/usuarios/<int:usuario_id>/permissoes', methods=['GET'])
@admin_required
def api_obter_permissoes(usuario_id):
    """Obtém permissões de um usuário (apenas admin)"""
    try:
        resultado = obter_permissoes(usuario_id)

        if resultado['success']:
            return jsonify(resultado), 200
        else:
            return jsonify(resultado), 500

    except Exception as e:
        print(f"❌ Erro ao obter permissões: {e}")
        return jsonify({'success': False, 'error': str(e)}), 500


@app.route('/api/admin/usuarios/<int:usuario_id>/permissoes', methods=['POST'])
@admin_required
def api_adicionar_permissao(usuario_id):
    """Adiciona permissão a um usuário (apenas admin)"""
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
        print(f"❌ Erro ao adicionar permissão: {e}")
        return jsonify({'success': False, 'error': str(e)}), 500


@app.route('/api/admin/usuarios/<int:usuario_id>/permissoes/<painel_nome>', methods=['DELETE'])
@admin_required
def api_remover_permissao(usuario_id, painel_nome):
    """Remove permissão de um usuário (apenas admin)"""
    try:
        admin_id = session.get('usuario_id')

        resultado = remover_permissao(usuario_id, painel_nome, admin_id)

        if resultado['success']:
            return jsonify(resultado), 200
        else:
            return jsonify(resultado), 400

    except Exception as e:
        print(f"❌ Erro ao remover permissão: {e}")
        return jsonify({'success': False, 'error': str(e)}), 500


# ==================== HISTÓRICO ====================

@app.route('/api/admin/usuarios/<int:usuario_id>/historico', methods=['GET'])
@admin_required
def api_obter_historico(usuario_id):
    """Obtém histórico de ações de um usuário (apenas admin)"""
    try:
        limite = request.args.get('limite', 50, type=int)
        resultado = obter_historico(usuario_id, limite)

        if resultado['success']:
            return jsonify(resultado), 200
        else:
            return jsonify(resultado), 500

    except Exception as e:
        print(f"❌ Erro ao obter histórico: {e}")
        return jsonify({'success': False, 'error': str(e)}), 500


# ==================== PAINÉIS DISPONÍVEIS ====================

@app.route('/api/admin/paineis', methods=['GET'])
@admin_required
def api_listar_paineis():
    """Lista todos os painéis disponíveis (apenas admin)"""
    try:
        # Lista de painéis do sistema
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
            }
        ]

        return jsonify({
            'success': True,
            'paineis': paineis
        }), 200

    except Exception as e:
        print(f"❌ Erro ao listar painéis: {e}")
        return jsonify({'success': False, 'error': str(e)}), 500




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