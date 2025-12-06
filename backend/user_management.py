"""
Módulo de Gestão de Usuários
Funções para CRUD, permissões e histórico
"""

import bcrypt
from backend.database import get_db_connection  # ✅ COM 'backend.' quando chamado via app.py
from datetime import datetime


# ==================== CRUD DE USUÁRIOS ====================

def listar_usuarios(incluir_inativos=True):
    """Lista todos os usuários"""
    conn = get_db_connection()
    if not conn:
        return {'success': False, 'error': 'Erro de conexão com o banco'}

    try:
        cursor = conn.cursor()

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
        cursor = conn.cursor()

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
    dados: dict com campos a atualizar (email, nome_completo, cargo, is_admin, observacoes)
    admin_id: ID do admin que está fazendo a alteração
    """
    conn = get_db_connection()
    if not conn:
        return {'success': False, 'error': 'Erro de conexão com o banco'}

    try:
        cursor = conn.cursor()

        # Campos permitidos para edição
        campos_permitidos = ['email', 'nome_completo', 'cargo', 'is_admin', 'observacoes']
        campos_update = []
        valores = []

        for campo, valor in dados.items():
            if campo in campos_permitidos:
                campos_update.append(f"{campo} = %s")
                valores.append(valor)

        if not campos_update:
            return {'success': False, 'error': 'Nenhum campo válido para atualizar'}

        # Adiciona campos de auditoria
        campos_update.append("atualizado_em = %s")
        campos_update.append("atualizado_por = %s")
        valores.extend([datetime.now(), admin_id])

        # Adiciona ID do usuário
        valores.append(usuario_id)

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
            detalhes=f"Campos alterados: {', '.join(dados.keys())}",
            realizado_por=admin_id,
            conn=conn
        )

        cursor.close()
        conn.close()

        return {'success': True, 'message': 'Usuário atualizado com sucesso'}

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
        cursor = conn.cursor()

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

    except Exception as e:
        print(f"❌ Erro ao alterar status: {e}")
        if conn:
            conn.rollback()
            conn.close()
        return {'success': False, 'error': str(e)}


def resetar_senha(usuario_id, nova_senha, admin_id):
    """Reseta a senha de um usuário"""
    conn = get_db_connection()
    if not conn:
        return {'success': False, 'error': 'Erro de conexão com o banco'}

    try:
        cursor = conn.cursor()

        # Hash da nova senha
        senha_hash = bcrypt.hashpw(nova_senha.encode('utf-8'), bcrypt.gensalt()).decode('utf-8')

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
        cursor = conn.cursor()

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

    except Exception as e:
        print(f"❌ Erro ao obter permissões: {e}")
        if conn:
            conn.close()
        return {'success': False, 'error': str(e)}


def adicionar_permissao(usuario_id, painel_nome, admin_id):
    """Adiciona permissão de acesso a um painel"""
    conn = get_db_connection()
    if not conn:
        return {'success': False, 'error': 'Erro de conexão com o banco'}

    try:
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