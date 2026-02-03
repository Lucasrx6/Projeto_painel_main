"""
Modulo de Gestao de Usuarios
Funcoes para CRUD, permissoes e historico

VERSAO 3.0 - Seguranca Aprimorada
- Context managers para conexoes
- Validacao rigorosa de inputs
- Logging estruturado
- Protecao contra SQL Injection
- Rate limiting preparado
"""

import bcrypt
import re
import logging
from contextlib import contextmanager
from datetime import datetime
from typing import Dict, List, Optional, Tuple, Any, Union

from backend.database import get_db_connection


# ==============================================================================
# CONFIGURACAO DE LOGGING
# ==============================================================================

logger = logging.getLogger(__name__)


# ==============================================================================
# CONSTANTES DE SEGURANCA
# ==============================================================================

# Requisitos de senha
SENHA_MIN_LENGTH = 8
SENHA_MAX_LENGTH = 128

# Limites de campos
CAMPO_MAX_LENGTH = 255
OBSERVACOES_MAX_LENGTH = 1000
HISTORICO_LIMITE_PADRAO = 50
HISTORICO_LIMITE_MAXIMO = 1000

# Mensagens de erro padronizadas (evita information disclosure)
ERRO_CONEXAO = 'Erro de conexao com o banco de dados'
ERRO_DADOS_INVALIDOS = 'Dados invalidos fornecidos'
ERRO_USUARIO_NAO_ENCONTRADO = 'Usuario nao encontrado'
ERRO_PERMISSAO_NEGADA = 'Permissao negada'
ERRO_CAMPOS_INVALIDOS = 'Nenhum campo valido para atualizar'

# Whitelist de campos editaveis
CAMPOS_EDITAVEIS = frozenset({
    'email',
    'nome_completo',
    'cargo',
    'is_admin',
    'observacoes',
    'ativo'
})

# Campos da tabela usuarios (para validacao)
CAMPOS_TABELA_USUARIOS = frozenset({
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
})

# Acoes validas para historico
ACOES_VALIDAS = frozenset({
    'criacao',
    'edicao',
    'ativacao',
    'desativacao',
    'reset_senha',
    'alteracao_senha',
    'adicao_permissao',
    'remocao_permissao',
    'login',
    'login_falha',
    'logout'
})


# ==============================================================================
# CONTEXT MANAGER PARA CONEXAO
# ==============================================================================

@contextmanager
def get_db_cursor(commit: bool = False):
    """
    Context manager para gerenciar conexao e cursor do banco de dados.

    Args:
        commit: Se True, faz commit automatico ao sair do contexto

    Yields:
        tuple: (cursor, connection)

    Raises:
        ConnectionError: Se nao conseguir conectar ao banco
    """
    conn = get_db_connection()
    if not conn:
        logger.error('Falha ao obter conexao com o banco de dados')
        raise ConnectionError(ERRO_CONEXAO)

    cursor = None
    try:
        cursor = conn.cursor()
        yield cursor, conn
        if commit:
            conn.commit()
    except Exception as e:
        if conn:
            conn.rollback()
        logger.error(f'Erro na operacao do banco: {e}')
        raise
    finally:
        if cursor:
            cursor.close()
        if conn:
            conn.close()


# ==============================================================================
# FUNCOES DE VALIDACAO
# ==============================================================================

def validar_senha_forte(senha: str) -> Tuple[bool, str]:
    """
    Valida se a senha atende aos requisitos de seguranca.

    Requisitos:
        - Minimo 8 caracteres
        - Maximo 128 caracteres
        - Pelo menos uma letra maiuscula
        - Pelo menos uma letra minuscula
        - Pelo menos um numero
        - Pelo menos um caractere especial

    Args:
        senha: Senha a ser validada

    Returns:
        tuple: (valida: bool, mensagem_erro: str)
    """
    if not senha or not isinstance(senha, str):
        return False, 'Senha nao pode estar vazia'

    if len(senha) < SENHA_MIN_LENGTH:
        return False, f'A senha deve ter no minimo {SENHA_MIN_LENGTH} caracteres'

    if len(senha) > SENHA_MAX_LENGTH:
        return False, f'A senha deve ter no maximo {SENHA_MAX_LENGTH} caracteres'

    if not re.search(r'[A-Z]', senha):
        return False, 'A senha deve conter pelo menos uma letra maiuscula'

    if not re.search(r'[a-z]', senha):
        return False, 'A senha deve conter pelo menos uma letra minuscula'

    if not re.search(r'[0-9]', senha):
        return False, 'A senha deve conter pelo menos um numero'

    if not re.search(r'[!@#$%^&*(),.?":{}|<>\-_=+\[\]\\;\'`~]', senha):
        return False, 'A senha deve conter pelo menos um caractere especial'

    return True, ''


def validar_email(email: str) -> Tuple[bool, str]:
    """
    Valida formato de email.

    Args:
        email: Email a ser validado

    Returns:
        tuple: (valido: bool, mensagem_erro: str)
    """
    if not email or not isinstance(email, str):
        return False, 'Email nao pode estar vazio'

    email = email.strip().lower()

    if len(email) > CAMPO_MAX_LENGTH:
        return False, f'Email muito longo (maximo {CAMPO_MAX_LENGTH} caracteres)'

    # Regex para validacao de email
    pattern = r'^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$'
    if not re.match(pattern, email):
        return False, 'Formato de email invalido'

    return True, ''


def validar_campo_editavel(campo: str) -> bool:
    """
    Valida se o campo esta na whitelist de campos editaveis.
    Protege contra SQL Injection via nomes de colunas.

    Args:
        campo: Nome do campo a ser validado

    Returns:
        bool: True se o campo e valido
    """
    if not isinstance(campo, str):
        return False

    campo = campo.strip().lower()

    if campo not in CAMPOS_EDITAVEIS:
        return False

    # Validacao adicional: apenas alfanumericos e underscore
    if not campo.replace('_', '').isalnum():
        return False

    return True


def validar_nome_painel(painel_nome: str) -> bool:
    """
    Valida nome do painel para prevenir SQL Injection.
    Aceita apenas: letras, numeros e underscore.

    Args:
        painel_nome: Nome do painel a ser validado

    Returns:
        bool: True se o nome e valido
    """
    if not isinstance(painel_nome, str):
        return False

    painel_nome = painel_nome.strip()

    if len(painel_nome) < 1 or len(painel_nome) > 50:
        return False

    if not painel_nome.replace('_', '').isalnum():
        return False

    return True


def validar_id(valor: Any) -> Optional[int]:
    """
    Valida e converte um valor para ID inteiro.

    Args:
        valor: Valor a ser validado e convertido

    Returns:
        int ou None: ID validado ou None se invalido
    """
    if valor is None:
        return None

    try:
        id_int = int(valor)
        if id_int <= 0:
            return None
        return id_int
    except (ValueError, TypeError):
        return None


def sanitizar_campos(dados: Dict[str, Any]) -> Dict[str, Any]:
    """
    Filtra apenas campos validos do dicionario de dados.

    Args:
        dados: Dicionario com campos a serem filtrados

    Returns:
        dict: Apenas campos que passaram na validacao
    """
    if not isinstance(dados, dict):
        return {}

    campos_validos = {}

    for campo, valor in dados.items():
        if validar_campo_editavel(campo):
            # Sanitiza strings
            if isinstance(valor, str):
                valor = valor.strip()
                if campo == 'observacoes':
                    valor = valor[:OBSERVACOES_MAX_LENGTH]
                else:
                    valor = valor[:CAMPO_MAX_LENGTH]
            campos_validos[campo] = valor
        else:
            logger.warning(f'Campo invalido ignorado: {campo}')

    return campos_validos


def sanitizar_string(valor: str, max_length: int = CAMPO_MAX_LENGTH) -> str:
    """
    Sanitiza uma string removendo espacos extras e limitando tamanho.

    Args:
        valor: String a ser sanitizada
        max_length: Tamanho maximo permitido

    Returns:
        str: String sanitizada
    """
    if not isinstance(valor, str):
        return ''
    return valor.strip()[:max_length]


# ==============================================================================
# CRUD DE USUARIOS
# ==============================================================================

def listar_usuarios(incluir_inativos: bool = True) -> Dict[str, Any]:
    """
    Lista todos os usuarios do sistema.

    Args:
        incluir_inativos: Se True, inclui usuarios inativos na listagem

    Returns:
        dict: {
            'success': bool,
            'usuarios': list (se sucesso),
            'total': int (se sucesso),
            'error': str (se erro)
        }
    """
    try:
        with get_db_cursor() as (cursor, conn):
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

            logger.info(f'Listagem de usuarios: {len(usuarios)} registros')

            return {
                'success': True,
                'usuarios': usuarios,
                'total': len(usuarios)
            }

    except ConnectionError as e:
        return {'success': False, 'error': str(e)}
    except Exception as e:
        logger.error(f'Erro ao listar usuarios: {e}')
        return {'success': False, 'error': ERRO_CONEXAO}


def obter_usuario(usuario_id: Union[int, str]) -> Dict[str, Any]:
    """
    Obtem detalhes de um usuario especifico.

    Args:
        usuario_id: ID do usuario

    Returns:
        dict: {
            'success': bool,
            'usuario': dict (se sucesso),
            'error': str (se erro)
        }
    """
    usuario_id = validar_id(usuario_id)
    if not usuario_id:
        return {'success': False, 'error': ERRO_DADOS_INVALIDOS}

    try:
        with get_db_cursor() as (cursor, conn):
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
                return {'success': False, 'error': ERRO_USUARIO_NAO_ENCONTRADO}

            colunas = [desc[0] for desc in cursor.description]
            usuario = dict(zip(colunas, resultado))

            return {
                'success': True,
                'usuario': usuario
            }

    except ConnectionError as e:
        return {'success': False, 'error': str(e)}
    except Exception as e:
        logger.error(f'Erro ao obter usuario {usuario_id}: {e}')
        return {'success': False, 'error': ERRO_CONEXAO}


def editar_usuario(
    usuario_id: Union[int, str],
    dados: Dict[str, Any],
    admin_id: Union[int, str]
) -> Dict[str, Any]:
    """
    Edita informacoes de um usuario.

    Args:
        usuario_id: ID do usuario a ser editado
        dados: Dicionario com campos a atualizar (apenas campos permitidos)
        admin_id: ID do administrador que esta fazendo a alteracao

    Returns:
        dict: {'success': bool, 'message': str ou 'error': str}
    """
    usuario_id = validar_id(usuario_id)
    admin_id = validar_id(admin_id)

    if not usuario_id or not admin_id:
        return {'success': False, 'error': ERRO_DADOS_INVALIDOS}

    # Sanitiza campos usando whitelist
    dados_validos = sanitizar_campos(dados)

    if not dados_validos:
        return {'success': False, 'error': ERRO_CAMPOS_INVALIDOS}

    # Validacao especifica para email
    if 'email' in dados_validos:
        email_valido, erro_email = validar_email(dados_validos['email'])
        if not email_valido:
            return {'success': False, 'error': erro_email}

    try:
        with get_db_cursor(commit=True) as (cursor, conn):
            # Verifica se usuario existe
            cursor.execute("SELECT id FROM usuarios WHERE id = %s", (usuario_id,))
            if not cursor.fetchone():
                return {'success': False, 'error': ERRO_USUARIO_NAO_ENCONTRADO}

            # Monta query apenas com campos validados
            campos_update = []
            valores = []

            for campo in dados_validos.keys():
                if campo in CAMPOS_EDITAVEIS:
                    campos_update.append(f"{campo} = %s")
                    valores.append(dados_validos[campo])

            # Adiciona campos de auditoria
            campos_update.append("atualizado_em = %s")
            campos_update.append("atualizado_por = %s")
            valores.extend([datetime.now(), admin_id])

            # Adiciona ID do usuario
            valores.append(usuario_id)

            query = f"""
                UPDATE usuarios 
                SET {', '.join(campos_update)}
                WHERE id = %s
            """

            cursor.execute(query, valores)

            # Registra no historico
            _registrar_historico_interno(
                cursor=cursor,
                usuario_id=usuario_id,
                acao='edicao',
                detalhes=f"Campos alterados: {', '.join(dados_validos.keys())}",
                realizado_por=admin_id
            )

            logger.info(f'Usuario {usuario_id} editado por admin {admin_id}')

            return {'success': True, 'message': 'Usuario atualizado com sucesso'}

    except ConnectionError as e:
        return {'success': False, 'error': str(e)}
    except Exception as e:
        logger.error(f'Erro ao editar usuario {usuario_id}: {e}')
        return {'success': False, 'error': ERRO_CONEXAO}


def alterar_status_usuario(
    usuario_id: Union[int, str],
    ativo: Union[bool, str],
    admin_id: Union[int, str]
) -> Dict[str, Any]:
    """
    Ativa ou desativa um usuario.

    Args:
        usuario_id: ID do usuario
        ativo: Novo status (True/False)
        admin_id: ID do administrador

    Returns:
        dict: {'success': bool, 'message': str ou 'error': str}
    """
    usuario_id = validar_id(usuario_id)
    admin_id = validar_id(admin_id)

    if not usuario_id or not admin_id:
        return {'success': False, 'error': ERRO_DADOS_INVALIDOS}

    # Converte para boolean
    if isinstance(ativo, bool):
        pass
    elif isinstance(ativo, str):
        ativo = ativo.lower() in ('true', '1', 'yes', 'sim')
    else:
        return {'success': False, 'error': 'Valor de status invalido'}

    try:
        with get_db_cursor(commit=True) as (cursor, conn):
            cursor.execute("""
                UPDATE usuarios 
                SET ativo = %s,
                    atualizado_em = %s,
                    atualizado_por = %s
                WHERE id = %s
            """, (ativo, datetime.now(), admin_id, usuario_id))

            if cursor.rowcount == 0:
                return {'success': False, 'error': ERRO_USUARIO_NAO_ENCONTRADO}

            acao = 'ativacao' if ativo else 'desativacao'
            _registrar_historico_interno(
                cursor=cursor,
                usuario_id=usuario_id,
                acao=acao,
                detalhes=f"Usuario {'ativado' if ativo else 'desativado'}",
                realizado_por=admin_id
            )

            status_texto = 'ativado' if ativo else 'desativado'
            logger.info(f'Usuario {usuario_id} {status_texto} por admin {admin_id}')

            return {
                'success': True,
                'message': f"Usuario {status_texto} com sucesso"
            }

    except ConnectionError as e:
        return {'success': False, 'error': str(e)}
    except Exception as e:
        logger.error(f'Erro ao alterar status do usuario {usuario_id}: {e}')
        return {'success': False, 'error': ERRO_CONEXAO}


def resetar_senha(
    usuario_id: Union[int, str],
    nova_senha: str,
    admin_id: Union[int, str]
) -> Dict[str, Any]:
    """
    Reseta a senha de um usuario com validacao forte.

    Args:
        usuario_id: ID do usuario
        nova_senha: Nova senha
        admin_id: ID do administrador

    Returns:
        dict: {'success': bool, 'message': str ou 'error': str}
    """
    # Valida senha forte
    senha_valida, mensagem_erro = validar_senha_forte(nova_senha)
    if not senha_valida:
        return {'success': False, 'error': mensagem_erro}

    usuario_id = validar_id(usuario_id)
    admin_id = validar_id(admin_id)

    if not usuario_id or not admin_id:
        return {'success': False, 'error': ERRO_DADOS_INVALIDOS}

    try:
        with get_db_cursor(commit=True) as (cursor, conn):
            # Hash da nova senha
            senha_hash = bcrypt.hashpw(
                nova_senha.encode('utf-8'),
                bcrypt.gensalt()
            ).decode('utf-8')

            cursor.execute("""
                UPDATE usuarios 
                SET senha_hash = %s,
                    atualizado_em = %s,
                    atualizado_por = %s
                WHERE id = %s
            """, (senha_hash, datetime.now(), admin_id, usuario_id))

            if cursor.rowcount == 0:
                return {'success': False, 'error': ERRO_USUARIO_NAO_ENCONTRADO}

            _registrar_historico_interno(
                cursor=cursor,
                usuario_id=usuario_id,
                acao='reset_senha',
                detalhes='Senha resetada pelo administrador',
                realizado_por=admin_id
            )

            logger.info(f'Senha do usuario {usuario_id} resetada por admin {admin_id}')

            return {'success': True, 'message': 'Senha resetada com sucesso'}

    except ConnectionError as e:
        return {'success': False, 'error': str(e)}
    except Exception as e:
        logger.error(f'Erro ao resetar senha do usuario {usuario_id}: {e}')
        return {'success': False, 'error': ERRO_CONEXAO}


# ==============================================================================
# PERMISSOES
# ==============================================================================

def obter_permissoes(usuario_id: Union[int, str]) -> Dict[str, Any]:
    """
    Obtem todas as permissoes de um usuario.

    Args:
        usuario_id: ID do usuario

    Returns:
        dict: {'success': bool, 'permissoes': list ou 'error': str}
    """
    usuario_id = validar_id(usuario_id)
    if not usuario_id:
        return {'success': False, 'error': ERRO_DADOS_INVALIDOS}

    try:
        with get_db_cursor() as (cursor, conn):
            cursor.execute("""
                SELECT painel_nome, criado_em
                FROM permissoes_paineis
                WHERE usuario_id = %s
                ORDER BY painel_nome ASC
            """, (usuario_id,))

            permissoes = [
                {'painel': row[0], 'criado_em': row[1]}
                for row in cursor.fetchall()
            ]

            return {
                'success': True,
                'permissoes': permissoes
            }

    except ConnectionError as e:
        return {'success': False, 'error': str(e)}
    except Exception as e:
        logger.error(f'Erro ao obter permissoes do usuario {usuario_id}: {e}')
        return {'success': False, 'error': ERRO_CONEXAO}


def adicionar_permissao(
    usuario_id: Union[int, str],
    painel_nome: str,
    admin_id: Union[int, str]
) -> Dict[str, Any]:
    """
    Adiciona permissao de acesso a um painel.

    Args:
        usuario_id: ID do usuario
        painel_nome: Nome do painel
        admin_id: ID do administrador

    Returns:
        dict: {'success': bool, 'message': str ou 'error': str}
    """
    usuario_id = validar_id(usuario_id)
    admin_id = validar_id(admin_id)

    if not usuario_id or not admin_id:
        return {'success': False, 'error': ERRO_DADOS_INVALIDOS}

    if not validar_nome_painel(painel_nome):
        return {'success': False, 'error': 'Nome de painel invalido'}

    painel_nome = painel_nome.strip()

    try:
        with get_db_cursor(commit=True) as (cursor, conn):
            # Verifica se ja existe
            cursor.execute("""
                SELECT id FROM permissoes_paineis
                WHERE usuario_id = %s AND painel_nome = %s
            """, (usuario_id, painel_nome))

            if cursor.fetchone():
                return {'success': False, 'error': 'Permissao ja existe'}

            cursor.execute("""
                INSERT INTO permissoes_paineis (usuario_id, painel_nome)
                VALUES (%s, %s)
            """, (usuario_id, painel_nome))

            _registrar_historico_interno(
                cursor=cursor,
                usuario_id=usuario_id,
                acao='adicao_permissao',
                detalhes=f"Permissao adicionada: {painel_nome}",
                realizado_por=admin_id
            )

            logger.info(
                f'Permissao {painel_nome} adicionada ao usuario {usuario_id} '
                f'por admin {admin_id}'
            )

            return {'success': True, 'message': 'Permissao adicionada com sucesso'}

    except ConnectionError as e:
        return {'success': False, 'error': str(e)}
    except Exception as e:
        logger.error(f'Erro ao adicionar permissao: {e}')
        return {'success': False, 'error': ERRO_CONEXAO}


def remover_permissao(
    usuario_id: Union[int, str],
    painel_nome: str,
    admin_id: Union[int, str]
) -> Dict[str, Any]:
    """
    Remove permissao de acesso a um painel.

    Args:
        usuario_id: ID do usuario
        painel_nome: Nome do painel
        admin_id: ID do administrador

    Returns:
        dict: {'success': bool, 'message': str ou 'error': str}
    """
    usuario_id = validar_id(usuario_id)
    admin_id = validar_id(admin_id)

    if not usuario_id or not admin_id:
        return {'success': False, 'error': ERRO_DADOS_INVALIDOS}

    if not validar_nome_painel(painel_nome):
        return {'success': False, 'error': 'Nome de painel invalido'}

    painel_nome = painel_nome.strip()

    try:
        with get_db_cursor(commit=True) as (cursor, conn):
            cursor.execute("""
                DELETE FROM permissoes_paineis
                WHERE usuario_id = %s AND painel_nome = %s
            """, (usuario_id, painel_nome))

            if cursor.rowcount == 0:
                return {'success': False, 'error': 'Permissao nao encontrada'}

            _registrar_historico_interno(
                cursor=cursor,
                usuario_id=usuario_id,
                acao='remocao_permissao',
                detalhes=f"Permissao removida: {painel_nome}",
                realizado_por=admin_id
            )

            logger.info(
                f'Permissao {painel_nome} removida do usuario {usuario_id} '
                f'por admin {admin_id}'
            )

            return {'success': True, 'message': 'Permissao removida com sucesso'}

    except ConnectionError as e:
        return {'success': False, 'error': str(e)}
    except Exception as e:
        logger.error(f'Erro ao remover permissao: {e}')
        return {'success': False, 'error': ERRO_CONEXAO}


def verificar_permissao_painel(
    usuario_id: Union[int, str],
    painel_nome: str
) -> bool:
    """
    Verifica se usuario tem permissao para acessar um painel.

    Args:
        usuario_id: ID do usuario
        painel_nome: Nome do painel

    Returns:
        bool: True se tem permissao
    """
    usuario_id = validar_id(usuario_id)
    if not usuario_id:
        return False

    if not validar_nome_painel(painel_nome):
        return False

    painel_nome = painel_nome.strip()

    try:
        with get_db_cursor() as (cursor, conn):
            # Admin tem acesso a tudo
            cursor.execute(
                "SELECT is_admin FROM usuarios WHERE id = %s AND ativo = TRUE",
                (usuario_id,)
            )
            resultado = cursor.fetchone()

            if not resultado:
                return False

            if resultado[0]:  # is_admin = True
                return True

            # Verifica permissao especifica
            cursor.execute("""
                SELECT id FROM permissoes_paineis
                WHERE usuario_id = %s AND painel_nome = %s
            """, (usuario_id, painel_nome))

            return cursor.fetchone() is not None

    except Exception as e:
        logger.error(f'Erro ao verificar permissao: {e}')
        return False


# ==============================================================================
# HISTORICO
# ==============================================================================

def _registrar_historico_interno(
    cursor,
    usuario_id: int,
    acao: str,
    detalhes: str,
    realizado_por: int
) -> bool:
    """
    Registra acao no historico (uso interno com cursor existente).

    Args:
        cursor: Cursor do banco de dados
        usuario_id: ID do usuario afetado
        acao: Tipo de acao realizada
        detalhes: Descricao detalhada
        realizado_por: ID de quem realizou a acao

    Returns:
        bool: True se registrou com sucesso
    """
    try:
        # Sanitiza strings
        acao = sanitizar_string(acao, 50)
        detalhes = sanitizar_string(detalhes, 500)

        cursor.execute("""
            INSERT INTO historico_usuarios (usuario_id, acao, detalhes, realizado_por)
            VALUES (%s, %s, %s, %s)
        """, (usuario_id, acao, detalhes, realizado_por))

        return True

    except Exception as e:
        logger.error(f'Erro ao registrar historico: {e}')
        return False


def registrar_historico(
    usuario_id: Union[int, str],
    acao: str,
    detalhes: str,
    realizado_por: Union[int, str]
) -> bool:
    """
    Registra acao no historico (uso externo com nova conexao).

    Args:
        usuario_id: ID do usuario afetado
        acao: Tipo de acao realizada
        detalhes: Descricao detalhada
        realizado_por: ID de quem realizou a acao

    Returns:
        bool: True se registrou com sucesso
    """
    usuario_id = validar_id(usuario_id)
    realizado_por = validar_id(realizado_por)

    if not usuario_id or not realizado_por:
        return False

    if not isinstance(acao, str) or not isinstance(detalhes, str):
        return False

    try:
        with get_db_cursor(commit=True) as (cursor, conn):
            return _registrar_historico_interno(
                cursor=cursor,
                usuario_id=usuario_id,
                acao=acao,
                detalhes=detalhes,
                realizado_por=realizado_por
            )
    except Exception as e:
        logger.error(f'Erro ao registrar historico: {e}')
        return False


def obter_historico(
    usuario_id: Union[int, str],
    limite: int = HISTORICO_LIMITE_PADRAO
) -> Dict[str, Any]:
    """
    Obtem historico de acoes de um usuario.

    Args:
        usuario_id: ID do usuario
        limite: Numero maximo de registros (padrao: 50, maximo: 1000)

    Returns:
        dict: {'success': bool, 'historico': list ou 'error': str}
    """
    usuario_id = validar_id(usuario_id)
    if not usuario_id:
        return {'success': False, 'error': ERRO_DADOS_INVALIDOS}

    # Valida limite
    try:
        limite = int(limite)
        limite = max(1, min(limite, HISTORICO_LIMITE_MAXIMO))
    except (ValueError, TypeError):
        limite = HISTORICO_LIMITE_PADRAO

    try:
        with get_db_cursor() as (cursor, conn):
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

            return {
                'success': True,
                'historico': historico
            }

    except ConnectionError as e:
        return {'success': False, 'error': str(e)}
    except Exception as e:
        logger.error(f'Erro ao obter historico do usuario {usuario_id}: {e}')
        return {'success': False, 'error': ERRO_CONEXAO}


# ==============================================================================
# ESTATISTICAS
# ==============================================================================

def obter_estatisticas() -> Dict[str, Any]:
    """
    Obtem estatisticas gerais dos usuarios.

    Returns:
        dict: {
            'success': bool,
            'estatisticas': dict (se sucesso),
            'error': str (se erro)
        }
    """
    try:
        with get_db_cursor() as (cursor, conn):
            # Total de usuarios
            cursor.execute("SELECT COUNT(*) FROM usuarios")
            total = cursor.fetchone()[0]

            # Usuarios ativos
            cursor.execute("SELECT COUNT(*) FROM usuarios WHERE ativo = TRUE")
            ativos = cursor.fetchone()[0]

            # Administradores
            cursor.execute("SELECT COUNT(*) FROM usuarios WHERE is_admin = TRUE")
            admins = cursor.fetchone()[0]

            # Usuarios criados nos ultimos 30 dias
            cursor.execute("""
                SELECT COUNT(*) FROM usuarios 
                WHERE criado_em >= NOW() - INTERVAL '30 days'
            """)
            novos = cursor.fetchone()[0]

            # Usuarios com acesso recente (ultimos 7 dias)
            cursor.execute("""
                SELECT COUNT(*) FROM usuarios 
                WHERE ultimo_acesso >= NOW() - INTERVAL '7 days'
            """)
            acesso_recente = cursor.fetchone()[0]

            return {
                'success': True,
                'estatisticas': {
                    'total': total,
                    'ativos': ativos,
                    'inativos': total - ativos,
                    'admins': admins,
                    'novos_30dias': novos,
                    'acesso_recente_7dias': acesso_recente
                }
            }

    except ConnectionError as e:
        return {'success': False, 'error': str(e)}
    except Exception as e:
        logger.error(f'Erro ao obter estatisticas: {e}')
        return {'success': False, 'error': ERRO_CONEXAO}