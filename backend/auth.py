"""
Modulo de Autenticacao
Funcoes para login, criacao de usuarios e verificacao de credenciais

VERSAO 3.0 - Seguranca Aprimorada
- Protecao contra brute force (rate limiting)
- Bloqueio temporario apos tentativas falhas
- Logging de seguranca
- Protecao contra timing attacks
- Context managers para conexoes
- Validacao rigorosa de inputs
"""

import bcrypt
import re
import logging
import secrets
import time
from contextlib import contextmanager
from datetime import datetime, timedelta
from typing import Dict, Any, Optional, Tuple, Union
from collections import defaultdict
from threading import Lock

from backend.database import get_db_connection

# ==============================================================================
# CONFIGURACAO DE LOGGING
# ==============================================================================

logger = logging.getLogger(__name__)

# Logger especifico para eventos de seguranca
security_logger = logging.getLogger('security')

# ==============================================================================
# CONSTANTES DE SEGURANCA
# ==============================================================================

# Requisitos de senha
SENHA_MIN_LENGTH = 8
SENHA_MAX_LENGTH = 128

# Limites de campos
USUARIO_MIN_LENGTH = 3
USUARIO_MAX_LENGTH = 50
EMAIL_MAX_LENGTH = 255

# Rate limiting
MAX_TENTATIVAS_LOGIN = 5
JANELA_TENTATIVAS_SEGUNDOS = 300  # 5 minutos
BLOQUEIO_TEMPORARIO_SEGUNDOS = 900  # 15 minutos

# Mensagens de erro padronizadas (evita information disclosure)
ERRO_CREDENCIAIS = 'Usuario ou senha invalidos'
ERRO_CONTA_BLOQUEADA = 'Conta temporariamente bloqueada. Tente novamente mais tarde'
ERRO_USUARIO_INATIVO = 'Conta desativada. Entre em contato com o administrador'
ERRO_CONEXAO = 'Erro de conexao com o banco de dados'
ERRO_DADOS_INVALIDOS = 'Dados invalidos fornecidos'
ERRO_USUARIO_EXISTENTE = 'Usuario ou email ja cadastrado'


# ==============================================================================
# RATE LIMITING EM MEMORIA
# ==============================================================================

class RateLimiter:
    """
    Controle de rate limiting para tentativas de login.
    Armazena em memoria (para producao considere usar Redis).
    """

    def __init__(self):
        self._tentativas: Dict[str, list] = defaultdict(list)
        self._bloqueios: Dict[str, datetime] = {}
        self._lock = Lock()

    def registrar_tentativa(self, identificador: str, sucesso: bool) -> None:
        """Registra uma tentativa de login."""
        with self._lock:
            agora = datetime.now()

            # Remove tentativas antigas
            self._limpar_tentativas_antigas(identificador, agora)

            if not sucesso:
                self._tentativas[identificador].append(agora)

                # Verifica se deve bloquear
                if len(self._tentativas[identificador]) >= MAX_TENTATIVAS_LOGIN:
                    self._bloqueios[identificador] = agora + timedelta(
                        seconds=BLOQUEIO_TEMPORARIO_SEGUNDOS
                    )
                    security_logger.warning(
                        f'Conta bloqueada por excesso de tentativas: {identificador}'
                    )
            else:
                # Login bem sucedido, limpa tentativas
                self._tentativas[identificador] = []
                if identificador in self._bloqueios:
                    del self._bloqueios[identificador]

    def esta_bloqueado(self, identificador: str) -> Tuple[bool, Optional[int]]:
        """
        Verifica se o identificador esta bloqueado.

        Returns:
            tuple: (bloqueado: bool, segundos_restantes: int ou None)
        """
        with self._lock:
            if identificador not in self._bloqueios:
                return False, None

            agora = datetime.now()
            fim_bloqueio = self._bloqueios[identificador]

            if agora >= fim_bloqueio:
                # Bloqueio expirou
                del self._bloqueios[identificador]
                self._tentativas[identificador] = []
                return False, None

            segundos_restantes = int((fim_bloqueio - agora).total_seconds())
            return True, segundos_restantes

    def tentativas_restantes(self, identificador: str) -> int:
        """Retorna o numero de tentativas restantes."""
        with self._lock:
            agora = datetime.now()
            self._limpar_tentativas_antigas(identificador, agora)
            tentativas_usadas = len(self._tentativas[identificador])
            return max(0, MAX_TENTATIVAS_LOGIN - tentativas_usadas)

    def _limpar_tentativas_antigas(self, identificador: str, agora: datetime) -> None:
        """Remove tentativas fora da janela de tempo."""
        limite = agora - timedelta(seconds=JANELA_TENTATIVAS_SEGUNDOS)
        self._tentativas[identificador] = [
            t for t in self._tentativas[identificador]
            if t > limite
        ]


# Instancia global do rate limiter
_rate_limiter = RateLimiter()


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


def validar_usuario(usuario: str) -> Tuple[bool, str]:
    """
    Valida nome de usuario.

    Args:
        usuario: Nome de usuario a ser validado

    Returns:
        tuple: (valido: bool, mensagem_erro: str)
    """
    if not usuario or not isinstance(usuario, str):
        return False, 'Nome de usuario nao pode estar vazio'

    usuario = usuario.strip()

    if len(usuario) < USUARIO_MIN_LENGTH:
        return False, f'Nome de usuario deve ter no minimo {USUARIO_MIN_LENGTH} caracteres'

    if len(usuario) > USUARIO_MAX_LENGTH:
        return False, f'Nome de usuario deve ter no maximo {USUARIO_MAX_LENGTH} caracteres'

    # Apenas alfanumericos, underscore e ponto
    if not re.match(r'^[a-zA-Z0-9_.]+$', usuario):
        return False, 'Nome de usuario deve conter apenas letras, numeros, underscore e ponto'

    # Deve comecar com letra
    if not usuario[0].isalpha():
        return False, 'Nome de usuario deve comecar com uma letra'

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

    if len(email) > EMAIL_MAX_LENGTH:
        return False, f'Email muito longo (maximo {EMAIL_MAX_LENGTH} caracteres)'

    # Regex para validacao de email
    pattern = r'^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$'
    if not re.match(pattern, email):
        return False, 'Formato de email invalido'

    return True, ''


# ==============================================================================
# FUNCOES DE AUTENTICACAO
# ==============================================================================

def verificar_usuario(usuario: str, senha: str) -> Dict[str, Any]:
    """
    Verifica as credenciais do usuario com protecao contra brute force.

    Args:
        usuario: Nome de usuario
        senha: Senha do usuario

    Returns:
        dict: {
            'success': bool,
            'usuario_id': int (se sucesso),
            'usuario': str (se sucesso),
            'is_admin': bool (se sucesso),
            'error': str (se erro),
            'tentativas_restantes': int (se erro de credenciais)
        }
    """
    # Sanitiza entrada
    if not usuario or not isinstance(usuario, str):
        return {'success': False, 'error': ERRO_CREDENCIAIS}

    usuario = usuario.strip().lower()

    if not senha or not isinstance(senha, str):
        return {'success': False, 'error': ERRO_CREDENCIAIS}

    # Verifica bloqueio por rate limiting
    bloqueado, segundos_restantes = _rate_limiter.esta_bloqueado(usuario)
    if bloqueado:
        security_logger.warning(f'Tentativa de login em conta bloqueada: {usuario}')
        return {
            'success': False,
            'error': ERRO_CONTA_BLOQUEADA,
            'bloqueado_segundos': segundos_restantes
        }

    try:
        with get_db_cursor(commit=True) as (cursor, conn):
            cursor.execute("""
                SELECT id, usuario, senha_hash, is_admin, ativo
                FROM usuarios
                WHERE LOWER(usuario) = %s
            """, (usuario,))

            resultado = cursor.fetchone()

            if not resultado:
                # Usuario nao encontrado
                _registrar_falha_login(usuario, 'usuario_inexistente')
                return _resposta_falha_login(usuario)

            usuario_id, usuario_nome, senha_hash, is_admin, ativo = resultado

            # Verifica se usuario esta ativo
            if not ativo:
                _registrar_falha_login(usuario, 'usuario_inativo')
                # Nao conta como tentativa falha de senha
                return {'success': False, 'error': ERRO_USUARIO_INATIVO}

            # Verifica a senha com protecao contra timing attack
            senha_correta = _verificar_senha_segura(senha, senha_hash)

            if senha_correta:
                # Login bem sucedido
                _rate_limiter.registrar_tentativa(usuario, sucesso=True)

                # Atualiza ultimo acesso
                cursor.execute("""
                    UPDATE usuarios
                    SET ultimo_acesso = %s
                    WHERE id = %s
                """, (datetime.now(), usuario_id))

                _registrar_sucesso_login(usuario_id, usuario_nome)

                return {
                    'success': True,
                    'usuario_id': usuario_id,
                    'usuario': usuario_nome,
                    'is_admin': is_admin
                }
            else:
                # Senha incorreta
                _registrar_falha_login(usuario, 'senha_incorreta')
                return _resposta_falha_login(usuario)

    except ConnectionError as e:
        logger.error(f'Erro de conexao durante login: {e}')
        return {'success': False, 'error': ERRO_CONEXAO}
    except Exception as e:
        logger.error(f'Erro ao verificar usuario: {e}')
        return {'success': False, 'error': ERRO_CONEXAO}


def _verificar_senha_segura(senha: str, senha_hash: str) -> bool:
    """
    Verifica senha com protecao contra timing attacks.

    Args:
        senha: Senha em texto plano
        senha_hash: Hash armazenado

    Returns:
        bool: True se senha correta
    """
    try:
        return bcrypt.checkpw(
            senha.encode('utf-8'),
            senha_hash.encode('utf-8')
        )
    except Exception:
        # Em caso de erro, adiciona delay para evitar timing attack
        time.sleep(0.1)
        return False


def _resposta_falha_login(usuario: str) -> Dict[str, Any]:
    """
    Gera resposta padronizada para falha de login.

    Args:
        usuario: Nome do usuario

    Returns:
        dict: Resposta de erro com tentativas restantes
    """
    _rate_limiter.registrar_tentativa(usuario, sucesso=False)
    tentativas = _rate_limiter.tentativas_restantes(usuario)

    resposta = {
        'success': False,
        'error': ERRO_CREDENCIAIS
    }

    if tentativas > 0:
        resposta['tentativas_restantes'] = tentativas
    else:
        resposta['error'] = ERRO_CONTA_BLOQUEADA

    return resposta


def _registrar_falha_login(usuario: str, motivo: str) -> None:
    """Registra tentativa de login falha no log de seguranca."""
    security_logger.warning(
        f'Falha de login | usuario={usuario} | motivo={motivo}'
    )


def _registrar_sucesso_login(usuario_id: int, usuario: str) -> None:
    """Registra login bem sucedido no log de seguranca."""
    security_logger.info(
        f'Login bem sucedido | usuario_id={usuario_id} | usuario={usuario}'
    )


# ==============================================================================
# CRIACAO DE USUARIOS
# ==============================================================================

def criar_usuario(
        usuario: str,
        senha: str,
        email: str,
        is_admin: bool = False,
        nome_completo: Optional[str] = None,
        cargo: Optional[str] = None
) -> Dict[str, Any]:
    """
    Cria um novo usuario com validacao completa.

    Args:
        usuario: Nome de usuario
        senha: Senha do usuario
        email: Email do usuario
        is_admin: Se e administrador (padrao: False)
        nome_completo: Nome completo (opcional)
        cargo: Cargo (opcional)

    Returns:
        dict: {
            'success': bool,
            'usuario_id': int (se sucesso),
            'error': str (se erro)
        }
    """
    # Valida usuario
    usuario_valido, erro_usuario = validar_usuario(usuario)
    if not usuario_valido:
        return {'success': False, 'error': erro_usuario}

    # Valida senha
    senha_valida, erro_senha = validar_senha_forte(senha)
    if not senha_valida:
        return {'success': False, 'error': erro_senha}

    # Valida email
    email_valido, erro_email = validar_email(email)
    if not email_valido:
        return {'success': False, 'error': erro_email}

    # Sanitiza entradas
    usuario = usuario.strip().lower()
    email = email.strip().lower()

    if nome_completo:
        nome_completo = nome_completo.strip()[:255]

    if cargo:
        cargo = cargo.strip()[:100]

    try:
        with get_db_cursor(commit=True) as (cursor, conn):
            # Verifica se o usuario ou email ja existe
            cursor.execute("""
                SELECT COUNT(*) FROM usuarios 
                WHERE LOWER(usuario) = %s OR LOWER(email) = %s
            """, (usuario, email))

            if cursor.fetchone()[0] > 0:
                return {'success': False, 'error': ERRO_USUARIO_EXISTENTE}

            # Hash da senha
            senha_hash = bcrypt.hashpw(
                senha.encode('utf-8'),
                bcrypt.gensalt()
            ).decode('utf-8')

            # Insere novo usuario
            cursor.execute("""
                INSERT INTO usuarios (
                    usuario, senha_hash, email, is_admin, 
                    nome_completo, cargo, criado_em
                )
                VALUES (%s, %s, %s, %s, %s, %s, %s)
                RETURNING id
            """, (
                usuario, senha_hash, email, is_admin,
                nome_completo, cargo, datetime.now()
            ))

            usuario_id = cursor.fetchone()[0]

            logger.info(f'Usuario criado: {usuario} (ID: {usuario_id})')
            security_logger.info(f'Novo usuario criado | usuario={usuario} | id={usuario_id}')

            return {
                'success': True,
                'usuario_id': usuario_id
            }

    except ConnectionError as e:
        return {'success': False, 'error': str(e)}
    except Exception as e:
        logger.error(f'Erro ao criar usuario: {e}')
        return {'success': False, 'error': ERRO_CONEXAO}


# ==============================================================================
# VERIFICACOES DE PERMISSAO
# ==============================================================================

def verificar_admin(usuario_id: Union[int, str]) -> bool:
    """
    Verifica se o usuario e administrador.

    Args:
        usuario_id: ID do usuario

    Returns:
        bool: True se e admin
    """
    if usuario_id is None:
        return False

    try:
        usuario_id = int(usuario_id)
        if usuario_id <= 0:
            return False
    except (ValueError, TypeError):
        return False

    try:
        with get_db_cursor() as (cursor, conn):
            cursor.execute("""
                SELECT is_admin 
                FROM usuarios 
                WHERE id = %s AND ativo = TRUE
            """, (usuario_id,))

            resultado = cursor.fetchone()
            return resultado[0] if resultado else False

    except Exception as e:
        logger.error(f'Erro ao verificar admin: {e}')
        return False


def verificar_usuario_ativo(usuario_id: Union[int, str]) -> bool:
    """
    Verifica se o usuario esta ativo.

    Args:
        usuario_id: ID do usuario

    Returns:
        bool: True se esta ativo
    """
    if usuario_id is None:
        return False

    try:
        usuario_id = int(usuario_id)
        if usuario_id <= 0:
            return False
    except (ValueError, TypeError):
        return False

    try:
        with get_db_cursor() as (cursor, conn):
            cursor.execute("""
                SELECT ativo 
                FROM usuarios 
                WHERE id = %s
            """, (usuario_id,))

            resultado = cursor.fetchone()
            return resultado[0] if resultado else False

    except Exception as e:
        logger.error(f'Erro ao verificar status do usuario: {e}')
        return False


# ==============================================================================
# ALTERACAO DE SENHA PELO PROPRIO USUARIO
# ==============================================================================

def alterar_senha_propria(
        usuario_id: Union[int, str],
        senha_atual: str,
        nova_senha: str
) -> Dict[str, Any]:
    """
    Permite que o usuario altere sua propria senha.

    Args:
        usuario_id: ID do usuario
        senha_atual: Senha atual para verificacao
        nova_senha: Nova senha desejada

    Returns:
        dict: {'success': bool, 'message': str ou 'error': str}
    """
    # Valida ID
    try:
        usuario_id = int(usuario_id)
        if usuario_id <= 0:
            return {'success': False, 'error': ERRO_DADOS_INVALIDOS}
    except (ValueError, TypeError):
        return {'success': False, 'error': ERRO_DADOS_INVALIDOS}

    # Valida nova senha
    senha_valida, erro_senha = validar_senha_forte(nova_senha)
    if not senha_valida:
        return {'success': False, 'error': erro_senha}

    # Verifica se a nova senha e diferente da atual
    if senha_atual == nova_senha:
        return {'success': False, 'error': 'A nova senha deve ser diferente da atual'}

    try:
        with get_db_cursor(commit=True) as (cursor, conn):
            # Busca senha atual
            cursor.execute("""
                SELECT senha_hash, usuario
                FROM usuarios
                WHERE id = %s AND ativo = TRUE
            """, (usuario_id,))

            resultado = cursor.fetchone()

            if not resultado:
                return {'success': False, 'error': 'Usuario nao encontrado ou inativo'}

            senha_hash_atual, usuario_nome = resultado

            # Verifica senha atual
            if not _verificar_senha_segura(senha_atual, senha_hash_atual):
                security_logger.warning(
                    f'Falha ao alterar senha - senha atual incorreta | '
                    f'usuario_id={usuario_id}'
                )
                return {'success': False, 'error': 'Senha atual incorreta'}

            # Gera hash da nova senha
            nova_senha_hash = bcrypt.hashpw(
                nova_senha.encode('utf-8'),
                bcrypt.gensalt()
            ).decode('utf-8')

            # Atualiza senha
            cursor.execute("""
                UPDATE usuarios
                SET senha_hash = %s, atualizado_em = %s
                WHERE id = %s
            """, (nova_senha_hash, datetime.now(), usuario_id))

            security_logger.info(
                f'Senha alterada pelo proprio usuario | '
                f'usuario_id={usuario_id} | usuario={usuario_nome}'
            )

            return {'success': True, 'message': 'Senha alterada com sucesso'}

    except ConnectionError as e:
        return {'success': False, 'error': str(e)}
    except Exception as e:
        logger.error(f'Erro ao alterar senha: {e}')
        return {'success': False, 'error': ERRO_CONEXAO}


# ==============================================================================
# FUNCOES AUXILIARES
# ==============================================================================

def gerar_token_seguro(tamanho: int = 32) -> str:
    """
    Gera um token aleatorio seguro.

    Args:
        tamanho: Numero de bytes (padrao: 32)

    Returns:
        str: Token em formato hexadecimal
    """
    return secrets.token_hex(tamanho)


def obter_info_rate_limit(usuario: str) -> Dict[str, Any]:
    """
    Obtem informacoes de rate limiting para um usuario.
    Util para debug e monitoramento.

    Args:
        usuario: Nome do usuario

    Returns:
        dict: Informacoes de rate limiting
    """
    if not usuario:
        return {'error': 'Usuario invalido'}

    usuario = usuario.strip().lower()

    bloqueado, segundos = _rate_limiter.esta_bloqueado(usuario)
    tentativas = _rate_limiter.tentativas_restantes(usuario)

    return {
        'usuario': usuario,
        'bloqueado': bloqueado,
        'segundos_restantes': segundos,
        'tentativas_restantes': tentativas,
        'max_tentativas': MAX_TENTATIVAS_LOGIN,
        'janela_segundos': JANELA_TENTATIVAS_SEGUNDOS
    }


def limpar_bloqueio(usuario: str, admin_confirmado: bool = False) -> bool:
    """
    Limpa bloqueio de rate limiting de um usuario.
    Deve ser usado apenas por administradores.

    Args:
        usuario: Nome do usuario
        admin_confirmado: Confirmacao de que e um admin executando

    Returns:
        bool: True se limpou com sucesso
    """
    if not admin_confirmado:
        logger.warning('Tentativa de limpar bloqueio sem confirmacao de admin')
        return False

    if not usuario:
        return False

    usuario = usuario.strip().lower()

    with _rate_limiter._lock:
        if usuario in _rate_limiter._bloqueios:
            del _rate_limiter._bloqueios[usuario]
        if usuario in _rate_limiter._tentativas:
            _rate_limiter._tentativas[usuario] = []

    security_logger.info(f'Bloqueio removido manualmente para usuario: {usuario}')
    return True