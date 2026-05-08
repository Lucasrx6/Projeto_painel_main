"""
Modulo de Conexao com Banco de Dados
Sistema de Paineis Hospitalares

Funcionalidades:
- Conexao com PostgreSQL
- Suporte a DATABASE_URL (Docker) e variaveis separadas
- Connection pooling para melhor performance
- Retry logic para ambientes containerizados
- Health check do banco de dados
"""

import psycopg2
from psycopg2.extras import RealDictCursor
from psycopg2 import pool
import os
import time
import logging
from contextlib import contextmanager
from dotenv import load_dotenv

load_dotenv()

# Configuracao do logger
logger = logging.getLogger(__name__)


# =========================================================
# CONFIGURACAO DO BANCO DE DADOS
# =========================================================

def get_db_config():
    """
    Retorna configuracao do banco de dados.
    Suporta DATABASE_URL (Docker) ou variaveis separadas.
    """
    database_url = os.getenv('DATABASE_URL')

    if database_url:
        # Formato Docker: postgresql://user:pass@host:port/dbname
        from urllib.parse import urlparse
        parsed = urlparse(database_url)

        return {
            'host': parsed.hostname or 'localhost',
            'database': parsed.path.lstrip('/') or 'postgres',
            'user': parsed.username or 'postgres',
            'password': parsed.password or 'postgres',
            'port': str(parsed.port or 5432)
        }
    else:
        # Formato tradicional: variaveis separadas
        return {
            'host': os.getenv('DB_HOST', 'localhost'),
            'database': os.getenv('DB_NAME', 'postgres'),
            'user': os.getenv('DB_USER', 'postgres'),
            'password': os.getenv('DB_PASSWORD', 'postgres'),
            'port': os.getenv('DB_PORT', '5432')
        }


# Configuracao do banco (carregada uma vez)
DB_CONFIG = get_db_config()

# Parametros extras de conexao: timeout, keepalive TCP e limite de statement
_CONNECTION_EXTRAS = {
    'connect_timeout': 10,
    'keepalives': 1,
    'keepalives_idle': 30,
    'keepalives_interval': 10,
    'keepalives_count': 5,
    'options': '-c statement_timeout=60000',  # mata queries presas apos 60s
}


# =========================================================
# CONNECTION POOL (OPCIONAL - PARA ALTA PERFORMANCE)
# =========================================================

# Pool de conexoes (None ate ser inicializado)
_connection_pool = None

# Orçamento total de conexões ao PostgreSQL (compartilhado entre todos os workers).
# Com 1 worker (recomendado): pool = DB_POOL_BUDGET inteiro.
# Com N workers: pool por worker = DB_POOL_BUDGET // N  (evita estourar max_connections).
# DB_POOL_MAX sobrescreve o cálculo automático se definido explicitamente no .env.
_GUNICORN_WORKERS  = int(os.getenv('GUNICORN_WORKERS', '1'))
_POOL_BUDGET       = int(os.getenv('DB_POOL_BUDGET', '20'))
_pool_per_worker   = max(2, _POOL_BUDGET // _GUNICORN_WORKERS)

POOL_MIN_CONNECTIONS = int(os.getenv('DB_POOL_MIN', str(max(1, _pool_per_worker // 4))))
POOL_MAX_CONNECTIONS = int(os.getenv('DB_POOL_MAX', str(_pool_per_worker)))
USE_CONNECTION_POOL  = os.getenv('DB_USE_POOL', 'true').lower() == 'true'


def init_connection_pool():
    """
    Inicializa o pool de conexoes.
    Usar em ambientes de alta demanda.
    """
    global _connection_pool

    if _connection_pool is not None:
        return _connection_pool

    try:
        _connection_pool = pool.ThreadedConnectionPool(
            POOL_MIN_CONNECTIONS,
            POOL_MAX_CONNECTIONS,
            **DB_CONFIG,
            **_CONNECTION_EXTRAS
        )
        logger.info(
            f"Connection pool inicializado: "
            f"min={POOL_MIN_CONNECTIONS}, max={POOL_MAX_CONNECTIONS}"
        )
        return _connection_pool
    except Exception as e:
        logger.error(f"Erro ao criar connection pool: {e}")
        return None


def close_connection_pool():
    """Fecha o pool de conexoes"""
    global _connection_pool

    if _connection_pool is not None:
        _connection_pool.closeall()
        _connection_pool = None
        logger.info("Connection pool fechado")


class _PoolConnectionWrapper:
    """
    Wrapper leve para conexoes do pool.

    Problema raiz: psycopg2 connections sao objetos C que nao permitem
    atribuicao de atributos arbitrarios (_real_close, _from_pool, etc.).
    Este wrapper intercepta close() para devolver a conexao ao pool via
    putconn(), e delega todos os outros acessos ao objeto real.
    """

    __slots__ = ('_conn', '_returned')

    def __init__(self, conn):
        object.__setattr__(self, '_conn', conn)
        object.__setattr__(self, '_returned', False)

    # --- Delegacao transparente ----------------------------------------
    def __getattr__(self, name):
        return getattr(object.__getattribute__(self, '_conn'), name)

    def __setattr__(self, name, value):
        if name in ('_conn', '_returned'):
            object.__setattr__(self, name, value)
        else:
            setattr(object.__getattribute__(self, '_conn'), name, value)

    # --- Suporte a context manager (with conn: ...) --------------------
    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        self.close()
        return False

    # --- Destrutor (Garbage Collection) --------------------------------
    def __del__(self):
        try:
            self.close()
        except Exception:
            pass

    # --- close() que devolve ao pool -----------------------------------
    def close(self):
        global _connection_pool
        conn = object.__getattribute__(self, '_conn')
        returned = object.__getattribute__(self, '_returned')

        if returned:
            return  # ja devolvida — evita dupla devolucao

        object.__setattr__(self, '_returned', True)

        try:
            if _connection_pool is not None and not conn.closed:
                _connection_pool.putconn(conn)
                return
        except Exception:
            pass

        # Fallback: fecha a conexao diretamente
        try:
            conn.close()
        except Exception:
            pass

    @property
    def closed(self):
        """Retorna o status closed da conexao real."""
        conn = object.__getattribute__(self, '_conn')
        returned = object.__getattribute__(self, '_returned')
        return returned or conn.closed


def _make_pool_conn(conn):
    """
    Envolve uma conexao do pool em um wrapper que intercepta close()
    para devolver automaticamente ao pool via putconn().
    """
    return _PoolConnectionWrapper(conn)


# =========================================================
# CONEXAO COM O BANCO
# =========================================================

def get_db_connection(use_dict_cursor=False, retry_count=3, retry_delay=2):
    """
    Cria conexao com o banco de dados.

    Args:
        use_dict_cursor: Se True, retorna resultados como dicionarios
        retry_count: Numero de tentativas em caso de falha
        retry_delay: Segundos entre tentativas

    Returns:
        Connection object ou None em caso de erro
    """
    global _connection_pool

    # Tenta usar o pool se estiver habilitado e inicializado
    if USE_CONNECTION_POOL and _connection_pool is not None:
        try:
            conn = _connection_pool.getconn()
            if use_dict_cursor:
                conn.cursor_factory = RealDictCursor
            # Patcha close() para devolver ao pool automaticamente
            # (resolve pool exhausted quando rotas chamam conn.close() diretamente)
            return _make_pool_conn(conn)
        except Exception as e:
            logger.warning(f"Erro ao obter conexao do pool: {e}. Usando conexao direta.")

    # Conexao direta (padrao)
    last_error = None

    for attempt in range(1, retry_count + 1):
        try:
            if use_dict_cursor:
                conn = psycopg2.connect(**DB_CONFIG, **_CONNECTION_EXTRAS, cursor_factory=RealDictCursor)
            else:
                conn = psycopg2.connect(**DB_CONFIG, **_CONNECTION_EXTRAS)

            # Configura autocommit como False (transacoes explicitas)
            conn.autocommit = False

            return conn

        except psycopg2.OperationalError as e:
            last_error = e
            if attempt < retry_count:
                logger.warning(
                    f"Tentativa {attempt}/{retry_count} falhou ao conectar ao banco. "
                    f"Tentando novamente em {retry_delay}s... Erro: {e}"
                )
                time.sleep(retry_delay)
            else:
                logger.error(f"Erro ao conectar ao banco apos {retry_count} tentativas: {e}")

        except Exception as e:
            last_error = e
            logger.error(f"Erro inesperado ao conectar ao banco: {e}")
            break

    return None


def release_connection(conn):
    """
    Libera uma conexao de volta para o pool ou fecha diretamente.

    Com _make_pool_conn aplicado, conn.close() ja chama putconn() internamente
    para conexoes do pool. Para conexoes diretas (fallback), fecha normalmente.
    Nao ha mais risco de "trying to put unkeyed connection".
    """
    if conn is None:
        return
    try:
        conn.close()
    except Exception as e:
        logger.warning(f"Erro ao liberar conexao: {e}")


@contextmanager
def get_db_cursor(use_dict_cursor=True, commit=True):
    """
    Context manager para obter cursor do banco.
    Gerencia automaticamente conexao, commit e rollback.

    Uso:
        with get_db_cursor() as cursor:
            cursor.execute("SELECT * FROM tabela")
            results = cursor.fetchall()

    Args:
        use_dict_cursor: Se True, retorna resultados como dicionarios
        commit: Se True, faz commit automatico ao sair do contexto

    Yields:
        Cursor do banco de dados
    """
    conn = None
    cursor = None

    try:
        conn = get_db_connection(use_dict_cursor=use_dict_cursor)
        if conn is None:
            raise Exception("Nao foi possivel obter conexao com o banco")

        cursor = conn.cursor()
        yield cursor

        if commit:
            conn.commit()

    except Exception as e:
        if conn:
            conn.rollback()
        logger.error(f"Erro na operacao do banco: {e}")
        raise

    finally:
        if cursor:
            cursor.close()
        if conn:
            release_connection(conn)


# =========================================================
# HEALTH CHECK
# =========================================================

def pool_health():
    """
    Retorna metricas do pool de conexoes para monitoramento.

    Returns:
        dict: Status do pool com metricas de uso
    """
    if _connection_pool is None:
        return {
            'status': 'disabled',
            'message': 'Pool nao inicializado ou desabilitado'
        }

    try:
        # ThreadedConnectionPool expoe _used (dict de conexoes em uso)
        # e _pool (lista de conexoes disponiveis)
        used = len(getattr(_connection_pool, '_used', {}))
        available = len(getattr(_connection_pool, '_pool', []))

        return {
            'status': 'healthy',
            'min_connections': POOL_MIN_CONNECTIONS,
            'max_connections': POOL_MAX_CONNECTIONS,
            'used': used,
            'available': available,
            'total': used + available,
            'utilization_pct': round(used / POOL_MAX_CONNECTIONS * 100, 1) if POOL_MAX_CONNECTIONS > 0 else 0,
        }
    except Exception as e:
        return {
            'status': 'error',
            'error': str(e)
        }


def check_db_health():
    """
    Verifica a saude da conexao com o banco.

    Returns:
        dict: Status da conexao com detalhes
    """
    start_time = time.time()

    try:
        conn = get_db_connection(retry_count=1, retry_delay=1)
        if conn is None:
            return {
                'status': 'unhealthy',
                'error': 'Nao foi possivel conectar ao banco',
                'response_time_ms': None
            }

        cursor = conn.cursor()

        # Testa a conexao
        cursor.execute('SELECT 1')
        cursor.fetchone()

        # Obtem versao do PostgreSQL
        cursor.execute('SELECT version()')
        version = cursor.fetchone()[0]

        # Obtem estatisticas basicas
        cursor.execute("""
            SELECT
                numbackends as conexoes_ativas,
                xact_commit as transacoes_commit,
                xact_rollback as transacoes_rollback
            FROM pg_stat_database
            WHERE datname = current_database()
        """)
        stats = cursor.fetchone()

        cursor.close()
        release_connection(conn)

        response_time = (time.time() - start_time) * 1000

        return {
            'status': 'healthy',
            'database': DB_CONFIG['database'],
            'host': DB_CONFIG['host'],
            'port': DB_CONFIG['port'],
            'version': version.split(',')[0] if version else 'unknown',
            'conexoes_ativas': stats[0] if stats else None,
            'response_time_ms': round(response_time, 2)
        }

    except Exception as e:
        response_time = (time.time() - start_time) * 1000
        return {
            'status': 'unhealthy',
            'error': str(e),
            'response_time_ms': round(response_time, 2)
        }


def wait_for_db(max_attempts=30, delay=2):
    """
    Aguarda o banco de dados ficar disponivel.
    Util para Docker onde o banco pode demorar a iniciar.

    Args:
        max_attempts: Numero maximo de tentativas
        delay: Segundos entre tentativas

    Returns:
        bool: True se conectou, False se timeout
    """
    logger.info(
        f"Aguardando banco de dados em {DB_CONFIG['host']}:{DB_CONFIG['port']}..."
    )

    for attempt in range(1, max_attempts + 1):
        try:
            conn = psycopg2.connect(**DB_CONFIG)
            conn.close()
            logger.info(f"Banco de dados disponivel apos {attempt} tentativa(s)")
            return True
        except psycopg2.OperationalError as e:
            if attempt < max_attempts:
                logger.info(f"Tentativa {attempt}/{max_attempts} - Banco nao disponivel. Aguardando {delay}s...")
                time.sleep(delay)
            else:
                logger.error(f"Banco de dados nao ficou disponivel apos {max_attempts} tentativas")
                return False

    return False


# =========================================================
# INICIALIZACAO DO BANCO
# =========================================================

def init_db():
    """
    Inicializa o banco de dados criando as tabelas necessarias.

    Returns:
        bool: True se sucesso, False se erro
    """
    # Em Docker, aguarda o banco ficar disponivel
    if os.getenv('RUNNING_IN_DOCKER', 'false').lower() == 'true':
        if not wait_for_db():
            logger.error("Timeout aguardando banco de dados")
            return False

    conn = get_db_connection()
    if not conn:
        logger.error("Nao foi possivel conectar ao banco para inicializacao")
        return False

    try:
        cursor = conn.cursor()

        # Cria tabela de usuarios
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS usuarios (
                id SERIAL PRIMARY KEY,
                usuario VARCHAR(50) UNIQUE NOT NULL,
                senha_hash VARCHAR(255) NOT NULL,
                email VARCHAR(100) UNIQUE NOT NULL,
                nome_completo VARCHAR(200),
                cargo VARCHAR(100),
                is_admin BOOLEAN DEFAULT FALSE,
                ativo BOOLEAN DEFAULT TRUE,
                observacoes TEXT,
                criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                atualizado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                ultimo_acesso TIMESTAMP
            )
        """)

        # Verifica se o usuario admin existe
        cursor.execute("SELECT COUNT(*) FROM usuarios WHERE usuario = 'postgres'")
        admin_exists = cursor.fetchone()[0] > 0

        if not admin_exists:
            # Cria usuario admin com senha aleatoria gerada na primeira execucao
            import bcrypt
            import secrets
            import string
            _alphabet = string.ascii_letters + string.digits + '!@#$%&*'
            senha_inicial = ''.join(secrets.choice(_alphabet) for _ in range(16))
            senha_hash = bcrypt.hashpw(senha_inicial.encode('utf-8'), bcrypt.gensalt()).decode('utf-8')
            cursor.execute("""
                INSERT INTO usuarios (usuario, senha_hash, email, is_admin, nome_completo)
                VALUES (%s, %s, %s, %s, %s)
            """, ('postgres', senha_hash, 'admin@sistema.com', True, 'Administrador'))
            logger.warning(
                "=" * 60 + "\n"
                "USUARIO ADMIN CRIADO — SALVE ESTA SENHA (exibida uma unica vez):\n"
                f"  Usuario: postgres\n"
                f"  Senha:   {senha_inicial}\n"
                "Altere a senha apos o primeiro login!\n"
                + "=" * 60
            )

        # Cria tabela de permissoes (se nao existir)
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS permissoes_paineis (
                id SERIAL PRIMARY KEY,
                usuario_id INTEGER REFERENCES usuarios(id) ON DELETE CASCADE,
                painel VARCHAR(50) NOT NULL,
                criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(usuario_id, painel)
            )
        """)

        # Cria tabela de historico (se nao existir)
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS historico_usuarios (
                id SERIAL PRIMARY KEY,
                usuario_id INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
                acao VARCHAR(100) NOT NULL,
                detalhes TEXT,
                ip_address VARCHAR(45),
                user_agent TEXT,
                criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)

        # Migracoes incrementais: garante colunas que podem nao existir em schemas antigos
        for ddl in [
            "ALTER TABLE usuarios          ADD COLUMN IF NOT EXISTS criado_em     TIMESTAMP DEFAULT CURRENT_TIMESTAMP",
            "ALTER TABLE usuarios          ADD COLUMN IF NOT EXISTS atualizado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP",
            "ALTER TABLE permissoes_paineis ADD COLUMN IF NOT EXISTS criado_em    TIMESTAMP DEFAULT CURRENT_TIMESTAMP",
            "ALTER TABLE historico_usuarios ADD COLUMN IF NOT EXISTS criado_em    TIMESTAMP DEFAULT CURRENT_TIMESTAMP",
        ]:
            try:
                cursor.execute(ddl)
            except Exception:
                conn.rollback()

        # Cria indices para melhor performance
        cursor.execute("""
            CREATE INDEX IF NOT EXISTS idx_usuarios_usuario ON usuarios(usuario);
            CREATE INDEX IF NOT EXISTS idx_usuarios_email ON usuarios(email);
            CREATE INDEX IF NOT EXISTS idx_permissoes_usuario ON permissoes_paineis(usuario_id);
            CREATE INDEX IF NOT EXISTS idx_historico_usuario ON historico_usuarios(usuario_id);
            CREATE INDEX IF NOT EXISTS idx_historico_criado ON historico_usuarios(criado_em);
        """)

        # Log de acessos — histórico auditável de 6 meses
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS access_log (
                id           BIGSERIAL PRIMARY KEY,
                dt_acesso    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                ip           VARCHAR(45) NOT NULL,
                painel_codigo VARCHAR(50),
                painel_nome  VARCHAR(150),
                endpoint     VARCHAR(300),
                descricao    TEXT NOT NULL,
                metodo       VARCHAR(10) NOT NULL DEFAULT 'GET',
                status_code  SMALLINT,
                duracao_ms   INTEGER,
                usuario_id   INTEGER,
                usuario_nome VARCHAR(100),
                tipo_acesso  VARCHAR(30) DEFAULT 'painel'
            )
        """)
        cursor.execute("""
            CREATE INDEX IF NOT EXISTS idx_access_log_dt
                ON access_log(dt_acesso DESC);
            CREATE INDEX IF NOT EXISTS idx_access_log_ip_dt
                ON access_log(ip, dt_acesso DESC);
            CREATE INDEX IF NOT EXISTS idx_access_log_painel
                ON access_log(painel_codigo, dt_acesso DESC);
            CREATE INDEX IF NOT EXISTS idx_access_log_tipo
                ON access_log(tipo_acesso, dt_acesso DESC);
        """)

        # Migracoes incrementais: adicionar colunas que podem nao existir ainda
        try:
            cursor.execute("""
                ALTER TABLE sentir_agir_itens
                ADD COLUMN IF NOT EXISTS permite_nao_aplica BOOLEAN DEFAULT FALSE;
            """)
        except Exception:
            pass  # tabela pode nao existir ainda (criada depois pelo painel)

        conn.commit()
        cursor.close()
        conn.close()

        logger.info("Banco de dados inicializado com sucesso")

        # Inicializa o pool de conexoes se habilitado
        if USE_CONNECTION_POOL:
            init_connection_pool()

        return True

    except Exception as e:
        logger.error(f"Erro ao inicializar banco de dados: {e}")
        if conn:
            conn.rollback()
            conn.close()
        return False


# =========================================================
# FUNCOES UTILITARIAS
# =========================================================

def execute_query(query, params=None, fetch_one=False, fetch_all=True):
    """
    Executa uma query SELECT e retorna os resultados.

    Args:
        query: SQL query
        params: Parametros para a query (tupla ou dict)
        fetch_one: Se True, retorna apenas um resultado
        fetch_all: Se True, retorna todos os resultados

    Returns:
        Resultados da query ou None em caso de erro
    """
    try:
        with get_db_cursor(use_dict_cursor=True, commit=False) as cursor:
            cursor.execute(query, params)

            if fetch_one:
                return cursor.fetchone()
            elif fetch_all:
                return cursor.fetchall()
            else:
                return cursor.rowcount

    except Exception as e:
        logger.error(f"Erro ao executar query: {e}")
        return None


def execute_command(query, params=None):
    """
    Executa um comando INSERT/UPDATE/DELETE.

    Args:
        query: SQL command
        params: Parametros para o comando (tupla ou dict)

    Returns:
        int: Numero de linhas afetadas ou -1 em caso de erro
    """
    try:
        with get_db_cursor(use_dict_cursor=False, commit=True) as cursor:
            cursor.execute(query, params)
            return cursor.rowcount

    except Exception as e:
        logger.error(f"Erro ao executar comando: {e}")
        return -1


def get_db_info():
    """
    Retorna informacoes sobre a configuracao do banco.

    Returns:
        dict: Informacoes do banco (sem senha)
    """
    return {
        'host': DB_CONFIG['host'],
        'database': DB_CONFIG['database'],
        'user': DB_CONFIG['user'],
        'port': DB_CONFIG['port'],
        'using_pool': USE_CONNECTION_POOL,
        'pool_min': POOL_MIN_CONNECTIONS if USE_CONNECTION_POOL else None,
        'pool_max': POOL_MAX_CONNECTIONS if USE_CONNECTION_POOL else None,
        'running_in_docker': os.getenv('RUNNING_IN_DOCKER', 'false').lower() == 'true'
    }