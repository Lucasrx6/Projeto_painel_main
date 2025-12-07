"""
Módulo de Gestão de Usuários
Funções para CRUD, permissões e histórico
VERSÃO 2.0 - COM PROTEÇÃO CONTRA SQL INJECTION
"""

import bcrypt
import re
from backend.database import get_db_connection
from datetime import datetime


# ==================== VALIDAÇÃO DE SENHA ====================

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


# ==================== WHITELIST DE CAMPOS PERMITIDOS ====================

# Lista EXPLÍCITA de campos que podem ser editados
CAMPOS_EDITAVEIS = {
    'email',
    'nome_completo',
    'cargo',
    'is_admin',
    'observacoes',
    'ativo'
}

# Lista de campos que existem na tabela usuarios (para validação)
CAMPOS_TABELA_USUARIOS = {
    'id',
    'usuario',
    'senha_hash',
    'email',
    'nome_completo',
    'cargo',
    'is_admin',
    'ativo',
    'observacoes',
    'criado_em',
    'ultimo_acesso',
    'atualizado_em',
    'atualizado_por'
}


# ==================== FUNÇÕES DE VALIDAÇÃO ====================

def validar_campo(campo):
    """
    Valida se o campo é permitido e está na whitelist
    Protege contra SQL Injection via nomes de colunas
    """
    if not isinstance(campo, str):
        return False

    # Remove espaços
    campo = campo.strip()

    # Verifica se está na whitelist
    if campo not in CAMPOS_EDITAVEIS:
        return False

    # Verifica se contém apenas caracteres alfanuméricos e underscore
    if not campo.replace('_', '').isalnum():
        return False

    return True


def sanitizar_campos(dados):
    """
    Filtra apenas campos válidos do dicionário de dados
    Retorna apenas campos que passaram na validação
    """
    campos_validos = {}

    for campo, valor in dados.items():
        if validar_campo(campo):
            campos_validos[campo] = valor
        else:
            print(f"⚠️ Campo inválido ignorado: {campo}")

    return campos_validos


# ==================== CRUD DE USUÁRIOS ====================

def listar_usuarios(incluir_inativos=True):
    """Lista todos os usuários"""
    conn = get_db_connection()
    if not conn:
        return {'success': False, 'error': 'Erro de conexão com o banco'}

    try:
        cursor = conn.cursor()

        # ✅ SEGURO: Query estática, sem concatenação
        query = """
            SELECT 
                id, 
                usuario, 
                email, 
                nome_completo,
                cargo,
                is_admin, 
                ativo,
                criado_em,
                ultimo_acesso
            FROM usuarios
        """

        if not incluir_inativos:
            query += " WHERE ativo = TRUE"

        query += " ORDER BY usuario ASC"

        cursor.execute(query)

        colunas = [desc[0] for desc in cursor.description]
        usuarios = [dict(zip(colunas, row)) for row in cursor.fetchall()]

        cursor.close()
        conn.close()

        return {
            'success': True,
            'usuarios': usuarios,
            'total': len(usuarios)
        }

    except Exception as e:
        print(f"❌ Erro ao listar usuários: {e}")
        if conn:
            conn.close()
        return {'success': False, 'error': str(e)}


def obter_usuario(usuario_id):
    """Obtém detalhes de um usuário específico"""
    conn = get_db_connection()
    if not conn:
        return {'success': False, 'error': 'Erro de conexão com o banco'}

    try:
        # ✅ Valida que usuario_id é inteiro
        if not isinstance(usuario_id, int):
            try:
                usuario_id = int(usuario_id)
            except (ValueError, TypeError):
                return {'success': False, 'error': 'ID de usuário inválido'}

        cursor = conn.cursor()

        # ✅ SEGURO: Usa parâmetros
        cursor.execute("""
            SELECT 
                id, 
                usuario, 
                email,
                nome_completo,
                cargo,
                is_admin, 
                ativo,
                observacoes,
                criado_em,
                ultimo_acesso,
                atualizado_em,
                atualizado_por
            FROM usuarios
            WHERE id = %s
        """, (usuario_id,))

        resultado = cursor.fetchone()

        if not resultado:
            cursor.close()
            conn.close()
            return {'success': False, 'error': 'Usuário não encontrado'}

        colunas = [desc[0] for desc in cursor.description]
        usuario = dict(zip(colunas, resultado))

        cursor.close()
        conn.close()

        return {
            'success': True,
            'usuario': usuario
        }

    except Exception as e:
        print(f"❌ Erro ao obter usuário: {e}")
        if conn:
            conn.close()
        return {'success': False, 'error': str(e)}


def editar_usuario(usuario_id, dados, admin_id):
    """
    Edita informações de um usuário
    VERSÃO SEGURA - Com validação de campos

    dados: dict com campos a atualizar (apenas campos permitidos)
    admin_id: ID do admin que está fazendo a alteração
    """
    conn = get_db_connection()
    if not conn:
        return {'success': False, 'error': 'Erro de conexão com o banco'}

    try:
        # ✅ Valida IDs
        if not isinstance(usuario_id, int):
            usuario_id = int(usuario_id)
        if not isinstance(admin_id, int):
            admin_id = int(admin_id)

        cursor = conn.cursor()

        # ✅ PROTEÇÃO: Sanitiza campos usando whitelist
        dados_validos = sanitizar_campos(dados)

        if not dados_validos:
            return {'success': False, 'error': 'Nenhum campo válido para atualizar'}

        # ✅ SEGURO: Monta query apenas com campos validados
        campos_update = []
        valores = []

        for campo in dados_validos.keys():
            # Validação dupla (já foi validado em sanitizar_campos)
            if campo in CAMPOS_EDITAVEIS:
                campos_update.append(f"{campo} = %s")
                valores.append(dados_validos[campo])

        if not campos_update:
            return {'success': False, 'error': 'Nenhum campo válido para atualizar'}

        # Adiciona campos de auditoria
        campos_update.append("atualizado_em = %s")
        campos_update.append("atualizado_por = %s")
        valores.extend([datetime.now(), admin_id])

        # Adiciona ID do usuário
        valores.append(usuario_id)

        # ✅ SEGURO: Campos já foram validados, valores são parametrizados
        query = f"""
            UPDATE usuarios 
            SET {', '.join(campos_update)}
            WHERE id = %s
        """

        cursor.execute(query, valores)
        conn.commit()

        # Registra no histórico
        registrar_historico(
            usuario_id=usuario_id,
            acao='edicao',
            detalhes=f"Campos alterados: {', '.join(dados_validos.keys())}",
            realizado_por=admin_id,
            conn=conn
        )

        cursor.close()
        conn.close()

        return {'success': True, 'message': 'Usuário atualizado com sucesso'}

    except ValueError as e:
        print(f"❌ Erro de validação: {e}")
        if conn:
            conn.rollback()
            conn.close()
        return {'success': False, 'error': 'Dados inválidos fornecidos'}

    except Exception as e:
        print(f"❌ Erro ao editar usuário: {e}")
        if conn:
            conn.rollback()
            conn.close()
        return {'success': False, 'error': str(e)}


def alterar_status_usuario(usuario_id, ativo, admin_id):
    """Ativa ou desativa um usuário"""
    conn = get_db_connection()
    if not conn:
        return {'success': False, 'error': 'Erro de conexão com o banco'}

    try:
        # ✅ Valida IDs
        usuario_id = int(usuario_id)
        admin_id = int(admin_id)

        # ✅ Valida boolean
        if not isinstance(ativo, bool):
            if str(ativo).lower() in ['true', '1', 'yes']:
                ativo = True
            elif str(ativo).lower() in ['false', '0', 'no']:
                ativo = False
            else:
                return {'success': False, 'error': 'Valor de status inválido'}

        cursor = conn.cursor()

        # ✅ SEGURO: Query estática com parâmetros
        cursor.execute("""
            UPDATE usuarios 
            SET ativo = %s,
                atualizado_em = %s,
                atualizado_por = %s
            WHERE id = %s
        """, (ativo, datetime.now(), admin_id, usuario_id))

        conn.commit()

        # Registra no histórico
        acao = 'ativacao' if ativo else 'desativacao'
        registrar_historico(
            usuario_id=usuario_id,
            acao=acao,
            detalhes=f"Usuário {'ativado' if ativo else 'desativado'}",
            realizado_por=admin_id,
            conn=conn
        )

        cursor.close()
        conn.close()

        return {
            'success': True,
            'message': f"Usuário {'ativado' if ativo else 'desativado'} com sucesso"
        }

    except ValueError as e:
        print(f"❌ Erro de validação: {e}")
        if conn:
            conn.rollback()
            conn.close()
        return {'success': False, 'error': 'Dados inválidos'}

    except Exception as e:
        print(f"❌ Erro ao alterar status: {e}")
        if conn:
            conn.rollback()
            conn.close()
        return {'success': False, 'error': str(e)}


def resetar_senha(usuario_id, nova_senha, admin_id):
    """Reseta a senha de um usuário com validação forte"""

    # ✅ Valida senha forte
    senha_valida, mensagem_erro = validar_senha_forte(nova_senha)
    if not senha_valida:
        return {'success': False, 'error': mensagem_erro}

    conn = get_db_connection()
    if not conn:
        return {'success': False, 'error': 'Erro de conexão com o banco'}

    try:
        # ✅ Valida IDs
        usuario_id = int(usuario_id)
        admin_id = int(admin_id)

        cursor = conn.cursor()

        # Hash da nova senha
        senha_hash = bcrypt.hashpw(nova_senha.encode('utf-8'), bcrypt.gensalt()).decode('utf-8')

        # ✅ SEGURO: Query estática com parâmetros
        cursor.execute("""
            UPDATE usuarios 
            SET senha_hash = %s,
                atualizado_em = %s,
                atualizado_por = %s
            WHERE id = %s
        """, (senha_hash, datetime.now(), admin_id, usuario_id))

        conn.commit()

        # Registra no histórico
        registrar_historico(
            usuario_id=usuario_id,
            acao='reset_senha',
            detalhes='Senha resetada pelo administrador',
            realizado_por=admin_id,
            conn=conn
        )

        cursor.close()
        conn.close()

        return {'success': True, 'message': 'Senha resetada com sucesso'}

    except ValueError as e:
        print(f"❌ Erro de validação: {e}")
        if conn:
            conn.rollback()
            conn.close()
        return {'success': False, 'error': 'Dados inválidos'}

    except Exception as e:
        print(f"❌ Erro ao resetar senha: {e}")
        if conn:
            conn.rollback()
            conn.close()
        return {'success': False, 'error': str(e)}


# ==================== PERMISSÕES ====================

def obter_permissoes(usuario_id):
    """Obtém todas as permissões de um usuário"""
    conn = get_db_connection()
    if not conn:
        return {'success': False, 'error': 'Erro de conexão com o banco'}

    try:
        # ✅ Valida ID
        usuario_id = int(usuario_id)

        cursor = conn.cursor()

        # ✅ SEGURO: Query estática com parâmetros
        cursor.execute("""
            SELECT painel_nome, criado_em
            FROM permissoes_paineis
            WHERE usuario_id = %s
            ORDER BY painel_nome ASC
        """, (usuario_id,))

        permissoes = [{'painel': row[0], 'criado_em': row[1]} for row in cursor.fetchall()]

        cursor.close()
        conn.close()

        return {
            'success': True,
            'permissoes': permissoes
        }

    except ValueError as e:
        print(f"❌ Erro de validação: {e}")
        if conn:
            conn.close()
        return {'success': False, 'error': 'ID inválido'}

    except Exception as e:
        print(f"❌ Erro ao obter permissões: {e}")
        if conn:
            conn.close()
        return {'success': False, 'error': str(e)}


def validar_nome_painel(painel_nome):
    """
    Valida nome do painel para prevenir SQL Injection
    Aceita apenas: letras, números e underscore
    """
    if not isinstance(painel_nome, str):
        return False

    painel_nome = painel_nome.strip()

    # Comprimento razoável
    if len(painel_nome) < 1 or len(painel_nome) > 50:
        return False

    # Apenas alfanuméricos e underscore
    if not painel_nome.replace('_', '').isalnum():
        return False

    return True


def adicionar_permissao(usuario_id, painel_nome, admin_id):
    """Adiciona permissão de acesso a um painel"""
    conn = get_db_connection()
    if not conn:
        return {'success': False, 'error': 'Erro de conexão com o banco'}

    try:
        # ✅ Valida IDs
        usuario_id = int(usuario_id)
        admin_id = int(admin_id)

        # ✅ Valida nome do painel
        if not validar_nome_painel(painel_nome):
            return {'success': False, 'error': 'Nome de painel inválido'}

        cursor = conn.cursor()

        # Verifica se já existe
        cursor.execute("""
            SELECT id FROM permissoes_paineis
            WHERE usuario_id = %s AND painel_nome = %s
        """, (usuario_id, painel_nome))

        if cursor.fetchone():
            cursor.close()
            conn.close()
            return {'success': False, 'error': 'Permissão já existe'}

        # Adiciona permissão
        cursor.execute("""
            INSERT INTO permissoes_paineis (usuario_id, painel_nome)
            VALUES (%s, %s)
        """, (usuario_id, painel_nome))

        conn.commit()

        # Registra no histórico
        registrar_historico(
            usuario_id=usuario_id,
            acao='adicao_permissao',
            detalhes=f"Permissão adicionada para painel: {painel_nome}",
            realizado_por=admin_id,
            conn=conn
        )

        cursor.close()
        conn.close()

        return {'success': True, 'message': 'Permissão adicionada com sucesso'}

    except ValueError as e:
        print(f"❌ Erro de validação: {e}")
        if conn:
            conn.rollback()
            conn.close()
        return {'success': False, 'error': 'Dados inválidos'}

    except Exception as e:
        print(f"❌ Erro ao adicionar permissão: {e}")
        if conn:
            conn.rollback()
            conn.close()
        return {'success': False, 'error': str(e)}


def remover_permissao(usuario_id, painel_nome, admin_id):
    """Remove permissão de acesso a um painel"""
    conn = get_db_connection()
    if not conn:
        return {'success': False, 'error': 'Erro de conexão com o banco'}

    try:
        # ✅ Valida IDs
        usuario_id = int(usuario_id)
        admin_id = int(admin_id)

        # ✅ Valida nome do painel
        if not validar_nome_painel(painel_nome):
            return {'success': False, 'error': 'Nome de painel inválido'}

        cursor = conn.cursor()

        cursor.execute("""
            DELETE FROM permissoes_paineis
            WHERE usuario_id = %s AND painel_nome = %s
        """, (usuario_id, painel_nome))

        if cursor.rowcount == 0:
            cursor.close()
            conn.close()
            return {'success': False, 'error': 'Permissão não encontrada'}

        conn.commit()

        # Registra no histórico
        registrar_historico(
            usuario_id=usuario_id,
            acao='remocao_permissao',
            detalhes=f"Permissão removida para painel: {painel_nome}",
            realizado_por=admin_id,
            conn=conn
        )

        cursor.close()
        conn.close()

        return {'success': True, 'message': 'Permissão removida com sucesso'}

    except ValueError as e:
        print(f"❌ Erro de validação: {e}")
        if conn:
            conn.rollback()
            conn.close()
        return {'success': False, 'error': 'Dados inválidos'}

    except Exception as e:
        print(f"❌ Erro ao remover permissão: {e}")
        if conn:
            conn.rollback()
            conn.close()
        return {'success': False, 'error': str(e)}


def verificar_permissao_painel(usuario_id, painel_nome):
    """Verifica se usuário tem permissão para acessar um painel"""
    conn = get_db_connection()
    if not conn:
        return False

    try:
        # ✅ Valida ID
        usuario_id = int(usuario_id)

        # ✅ Valida nome do painel
        if not validar_nome_painel(painel_nome):
            return False

        cursor = conn.cursor()

        # Admin tem acesso a tudo
        cursor.execute("SELECT is_admin FROM usuarios WHERE id = %s", (usuario_id,))
        resultado = cursor.fetchone()

        if resultado and resultado[0]:  # is_admin = True
            cursor.close()
            conn.close()
            return True

        # Verifica permissão específica
        cursor.execute("""
            SELECT id FROM permissoes_paineis
            WHERE usuario_id = %s AND painel_nome = %s
        """, (usuario_id, painel_nome))

        tem_permissao = cursor.fetchone() is not None

        cursor.close()
        conn.close()

        return tem_permissao

    except (ValueError, TypeError):
        if conn:
            conn.close()
        return False

    except Exception as e:
        print(f"❌ Erro ao verificar permissão: {e}")
        if conn:
            conn.close()
        return False


# ==================== HISTÓRICO ====================

def registrar_historico(usuario_id, acao, detalhes, realizado_por, conn=None):
    """Registra ação no histórico"""
    fechar_conn = False

    if not conn:
        conn = get_db_connection()
        fechar_conn = True

    if not conn:
        return False

    try:
        # ✅ Valida IDs
        usuario_id = int(usuario_id)
        realizado_por = int(realizado_por)

        # ✅ Valida strings
        if not isinstance(acao, str) or not isinstance(detalhes, str):
            return False

        # Limita tamanho
        acao = acao[:50]
        detalhes = detalhes[:500]

        cursor = conn.cursor()

        cursor.execute("""
            INSERT INTO historico_usuarios (usuario_id, acao, detalhes, realizado_por)
            VALUES (%s, %s, %s, %s)
        """, (usuario_id, acao, detalhes, realizado_por))

        conn.commit()
        cursor.close()

        if fechar_conn:
            conn.close()

        return True

    except (ValueError, TypeError) as e:
        print(f"❌ Erro de validação no histórico: {e}")
        if conn:
            conn.rollback()
            if fechar_conn:
                conn.close()
        return False

    except Exception as e:
        print(f"❌ Erro ao registrar histórico: {e}")
        if conn:
            conn.rollback()
            if fechar_conn:
                conn.close()
        return False


def obter_historico(usuario_id, limite=50):
    """Obtém histórico de ações de um usuário"""
    conn = get_db_connection()
    if not conn:
        return {'success': False, 'error': 'Erro de conexão com o banco'}

    try:
        # ✅ Valida ID
        usuario_id = int(usuario_id)

        # ✅ Valida limite
        limite = int(limite)
        if limite < 1 or limite > 1000:
            limite = 50

        cursor = conn.cursor()

        cursor.execute("""
            SELECT 
                h.acao,
                h.detalhes,
                h.data_hora,
                u.usuario as realizado_por_usuario
            FROM historico_usuarios h
            LEFT JOIN usuarios u ON h.realizado_por = u.id
            WHERE h.usuario_id = %s
            ORDER BY h.data_hora DESC
            LIMIT %s
        """, (usuario_id, limite))

        colunas = [desc[0] for desc in cursor.description]
        historico = [dict(zip(colunas, row)) for row in cursor.fetchall()]

        cursor.close()
        conn.close()

        return {
            'success': True,
            'historico': historico
        }

    except ValueError as e:
        print(f"❌ Erro de validação: {e}")
        if conn:
            conn.close()
        return {'success': False, 'error': 'Dados inválidos'}

    except Exception as e:
        print(f"❌ Erro ao obter histórico: {e}")
        if conn:
            conn.close()
        return {'success': False, 'error': str(e)}


# ==================== ESTATÍSTICAS ====================

def obter_estatisticas():
    """Obtém estatísticas gerais dos usuários"""
    conn = get_db_connection()
    if not conn:
        return {'success': False, 'error': 'Erro de conexão com o banco'}

    try:
        cursor = conn.cursor()

        # ✅ SEGURO: Todas as queries são estáticas

        # Total de usuários
        cursor.execute("SELECT COUNT(*) FROM usuarios")
        total = cursor.fetchone()[0]

        # Usuários ativos
        cursor.execute("SELECT COUNT(*) FROM usuarios WHERE ativo = TRUE")
        ativos = cursor.fetchone()[0]

        # Administradores
        cursor.execute("SELECT COUNT(*) FROM usuarios WHERE is_admin = TRUE")
        admins = cursor.fetchone()[0]

        # Usuários criados nos últimos 30 dias
        cursor.execute("""
            SELECT COUNT(*) FROM usuarios 
            WHERE criado_em >= NOW() - INTERVAL '30 days'
        """)
        novos = cursor.fetchone()[0]

        cursor.close()
        conn.close()

        return {
            'success': True,
            'estatisticas': {
                'total': total,
                'ativos': ativos,
                'inativos': total - ativos,
                'admins': admins,
                'novos_30dias': novos
            }
        }

    except Exception as e:
        print(f"❌ Erro ao obter estatísticas: {e}")
        if conn:
            conn.close()
        return {'success': False, 'error': str(e)}