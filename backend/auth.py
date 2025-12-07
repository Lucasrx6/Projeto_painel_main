import bcrypt
import re
from backend.database import get_db_connection
from datetime import datetime


def validar_senha_forte(senha):
    """
    Valida se a senha atende aos requisitos de segurança
    Retorna (bool, str) - (válida, mensagem_erro)
    """
    if len(senha) < 8:
        return False, 'A senha deve ter no mínimo 8 caracteres'

    if not re.search(r'[A-Z]', senha):
        return False, 'A senha deve conter pelo menos uma letra maiúscula'

    if not re.search(r'[a-z]', senha):
        return False, 'A senha deve conter pelo menos uma letra minúscula'

    if not re.search(r'[0-9]', senha):
        return False, 'A senha deve conter pelo menos um número'

    if not re.search(r'[!@#$%^&*(),.?":{}|<>]', senha):
        return False, 'A senha deve conter pelo menos um caractere especial (!@#$%^&*...)'

    return True, ''


def verificar_usuario(usuario, senha):
    """Verifica as credenciais do usuário"""
    conn = get_db_connection()
    if not conn:
        return {'success': False, 'error': 'Erro de conexão com o banco'}

    try:
        cursor = conn.cursor()

        cursor.execute("""
                       SELECT id, usuario, senha_hash, is_admin, ativo
                       FROM usuarios
                       WHERE usuario = %s
                       """, (usuario,))

        resultado = cursor.fetchone()

        if not resultado:
            cursor.close()
            conn.close()
            return {'success': False, 'error': 'Usuário não encontrado'}

        usuario_id, usuario_nome, senha_hash, is_admin, ativo = resultado

        # Verifica se usuário está ativo
        if not ativo:
            cursor.close()
            conn.close()
            return {'success': False, 'error': 'Usuário desativado'}

        # Verifica a senha
        if bcrypt.checkpw(senha.encode('utf-8'), senha_hash.encode('utf-8')):
            # Atualiza último acesso
            cursor.execute("""
                           UPDATE usuarios
                           SET ultimo_acesso = %s
                           WHERE id = %s
                           """, (datetime.now(), usuario_id))

            conn.commit()
            cursor.close()
            conn.close()

            return {
                'success': True,
                'usuario_id': usuario_id,
                'usuario': usuario_nome,
                'is_admin': is_admin
            }
        else:
            cursor.close()
            conn.close()
            return {'success': False, 'error': 'Senha incorreta'}

    except Exception as e:
        print(f"❌ Erro ao verificar usuário: {e}")
        if conn:
            conn.close()
        return {'success': False, 'error': str(e)}


def criar_usuario(usuario, senha, email, is_admin=False):
    """Cria um novo usuário com validação de senha forte"""

    # Valida senha forte
    senha_valida, mensagem_erro = validar_senha_forte(senha)
    if not senha_valida:
        return {'success': False, 'error': mensagem_erro}

    conn = get_db_connection()
    if not conn:
        return {'success': False, 'error': 'Erro de conexão com o banco'}

    try:
        cursor = conn.cursor()

        # Verifica se o usuário já existe
        cursor.execute("SELECT COUNT(*) FROM usuarios WHERE usuario = %s OR email = %s", (usuario, email))
        if cursor.fetchone()[0] > 0:
            cursor.close()
            conn.close()
            return {'success': False, 'error': 'Usuário ou email já cadastrado'}

        # Hash da senha
        senha_hash = bcrypt.hashpw(senha.encode('utf-8'), bcrypt.gensalt()).decode('utf-8')

        # Insere novo usuário
        cursor.execute("""
                       INSERT INTO usuarios (usuario, senha_hash, email, is_admin)
                       VALUES (%s, %s, %s, %s)
                       """, (usuario, senha_hash, email, is_admin))

        conn.commit()
        cursor.close()
        conn.close()

        return {'success': True}

    except Exception as e:
        print(f"❌ Erro ao criar usuário: {e}")
        if conn:
            conn.rollback()
            conn.close()
        return {'success': False, 'error': str(e)}


def verificar_admin(usuario_id):
    """Verifica se o usuário é admin"""
    conn = get_db_connection()
    if not conn:
        return False

    try:
        cursor = conn.cursor()
        cursor.execute("SELECT is_admin FROM usuarios WHERE id = %s", (usuario_id,))
        resultado = cursor.fetchone()
        cursor.close()
        conn.close()

        return resultado[0] if resultado else False

    except Exception as e:
        print(f"❌ Erro ao verificar admin: {e}")
        if conn:
            conn.close()
        return False