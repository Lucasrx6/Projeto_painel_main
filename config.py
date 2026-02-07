"""
Configuracoes do Sistema de Paineis Hospitalares
Suporte a Development, Homologation, Production e Docker
"""

import os
from dotenv import load_dotenv
from urllib.parse import urlparse

load_dotenv()


class Config:
    """Configuracoes base compartilhadas entre todos os ambientes"""

    # =========================================================
    # SEGURANCA
    # =========================================================
    SECRET_KEY = os.getenv('SECRET_KEY', 'dev-key-INSEGURA-mude-em-producao')

    # =========================================================
    # SESSAO
    # =========================================================
    PERMANENT_SESSION_LIFETIME = 28800  # 8 horas em segundos
    SESSION_COOKIE_HTTPONLY = True  # Previne acesso via JavaScript
    SESSION_COOKIE_SAMESITE = 'Lax'  # Protecao CSRF
    SESSION_COOKIE_NAME = 'painel_session'

    # =========================================================
    # BANCO DE DADOS
    # =========================================================
    # Suporta DATABASE_URL (padrao Docker) ou variaveis separadas
    DATABASE_URL = os.getenv('DATABASE_URL')

    # Se DATABASE_URL estiver definida, extrai os componentes
    if DATABASE_URL:
        _parsed = urlparse(DATABASE_URL)
        DB_HOST = _parsed.hostname or 'localhost'
        DB_NAME = _parsed.path.lstrip('/') or 'postgres'
        DB_USER = _parsed.username or 'postgres'
        DB_PASSWORD = _parsed.password or 'postgres'
        DB_PORT = str(_parsed.port or 5432)
    else:
        # Fallback para variaveis separadas (compatibilidade)
        DB_HOST = os.getenv('DB_HOST', 'localhost')
        DB_NAME = os.getenv('DB_NAME', 'postgres')
        DB_USER = os.getenv('DB_USER', 'postgres')
        DB_PASSWORD = os.getenv('DB_PASSWORD', 'postgres')
        DB_PORT = os.getenv('DB_PORT', '5432')

    # =========================================================
    # API E JSON
    # =========================================================
    JSON_SORT_KEYS = False
    JSONIFY_PRETTYPRINT_REGULAR = False

    # =========================================================
    # CORS (base - sobrescrito por ambiente)
    # =========================================================
    CORS_ORIGINS = "*"
    CORS_SUPPORTS_CREDENTIALS = True

    # =========================================================
    # GROQ API (Inteligencia Artificial)
    # =========================================================
    GROQ_API_KEY = os.getenv('GROQ_API_KEY', '')

    # =========================================================
    # DOCKER / CONTAINER
    # =========================================================
    # Detecta se esta rodando em container
    RUNNING_IN_DOCKER = os.getenv('RUNNING_IN_DOCKER', 'false').lower() == 'true'

    # Configuracoes do Gunicorn (usadas no Dockerfile)
    GUNICORN_WORKERS = int(os.getenv('GUNICORN_WORKERS', '4'))
    GUNICORN_TIMEOUT = int(os.getenv('GUNICORN_TIMEOUT', '120'))
    GUNICORN_BIND = os.getenv('GUNICORN_BIND', '0.0.0.0:5000')

    @classmethod
    def get_database_url(cls):
        """Retorna a URL de conexao do banco de dados"""
        if cls.DATABASE_URL:
            return cls.DATABASE_URL
        return f"postgresql://{cls.DB_USER}:{cls.DB_PASSWORD}@{cls.DB_HOST}:{cls.DB_PORT}/{cls.DB_NAME}"


class DevelopmentConfig(Config):
    """Configuracoes para Ambiente de Desenvolvimento"""

    DEBUG = True
    TESTING = False

    # =========================================================
    # LOGGING
    # =========================================================
    LOG_LEVEL = 'DEBUG'

    # =========================================================
    # COOKIES (menos restritivos em dev)
    # =========================================================
    SESSION_COOKIE_SECURE = False  # HTTP permitido em dev

    # =========================================================
    # CORS (liberado em desenvolvimento)
    # =========================================================
    ALLOWED_ORIGINS = ['*']  # Aceita qualquer origem
    RATELIMIT_ENABLED = False  # Rate limiting desabilitado em dev

    # =========================================================
    # PERFORMANCE
    # =========================================================
    SEND_FILE_MAX_AGE_DEFAULT = 0  # Sem cache (facilita desenvolvimento)

    @classmethod
    def info(cls):
        docker_status = "[DOCKER]" if cls.RUNNING_IN_DOCKER else "[LOCAL]"
        return f"""
==============================================================
           MODO DESENVOLVIMENTO ATIVO {docker_status}
==============================================================
  NAO USE EM PRODUCAO!

  Caracteristicas:
  - Debug habilitado
  - Stack traces visiveis
  - Auto-reload ativo
  - Cookies sem flag Secure (HTTP permitido)
  - Logs detalhados (DEBUG)
  - CORS liberado (*)
  - Rate limiting desabilitado
  - Cache desabilitado

  Banco de Dados:
  - Host: {cls.DB_HOST}
  - Database: {cls.DB_NAME}
  - User: {cls.DB_USER}
  - Port: {cls.DB_PORT}
==============================================================
        """


class HomologationConfig(Config):
    """Configuracoes para Ambiente de Homologacao (Staging)"""

    DEBUG = False
    TESTING = False

    # =========================================================
    # LOGGING
    # =========================================================
    LOG_LEVEL = 'INFO'  # Mais detalhado que producao para debug

    # =========================================================
    # COOKIES
    # =========================================================
    SESSION_COOKIE_SECURE = False  # Pode ser HTTP em homolog
    SESSION_COOKIE_HTTPONLY = True
    SESSION_COOKIE_SAMESITE = 'Lax'

    # =========================================================
    # CORS (restrito mas flexivel)
    # =========================================================
    ALLOWED_ORIGINS = [
        os.getenv('FRONTEND_URL', 'http://localhost:5001'),
        'http://localhost:5001',
        'http://127.0.0.1:5001',
        # Adicione IPs internos de homologacao aqui
    ]

    # =========================================================
    # RATE LIMITING (ativo mas mais permissivo)
    # =========================================================
    RATELIMIT_ENABLED = True
    RATELIMIT_DEFAULT = "500 per hour"  # Mais permissivo que prod

    # =========================================================
    # PERFORMANCE
    # =========================================================
    SEND_FILE_MAX_AGE_DEFAULT = 3600  # Cache de 1 hora

    @classmethod
    def validate(cls):
        """Valida configuracoes de homologacao"""
        errors = []
        warnings = []

        # Validacao basica da SECRET_KEY
        if Config.SECRET_KEY == 'dev-key-INSEGURA-mude-em-producao':
            warnings.append(
                "AVISO: SECRET_KEY nao foi configurada! "
                "Defina no arquivo .env: SECRET_KEY=sua-chave-aleatoria-aqui"
            )

        # Validacao do banco
        if Config.DB_PASSWORD == 'postgres':
            warnings.append(
                "AVISO: Senha do banco ainda eh 'postgres'. "
                "Considere usar uma senha diferente em homologacao."
            )

        return errors, warnings

    @classmethod
    def info(cls):
        docker_status = "[DOCKER]" if cls.RUNNING_IN_DOCKER else "[LOCAL]"
        return f"""
==============================================================
           MODO HOMOLOGACAO ATIVO {docker_status}
==============================================================
  Ambiente de testes pre-producao

  Caracteristicas:
  - Debug desabilitado
  - Logs informativos (INFO)
  - Cookies com seguranca moderada
  - CORS restrito a origens conhecidas
  - Rate limiting ativo (permissivo)
  - Cache de 1 hora

  Banco de Dados:
  - Host: {cls.DB_HOST}
  - Database: {cls.DB_NAME}
  - User: {cls.DB_USER}
  - Port: {cls.DB_PORT}

  Use para validar mudancas antes de ir para producao!
==============================================================
        """


class ProductionConfig(Config):
    """Configuracoes para Ambiente de Producao"""

    DEBUG = False
    TESTING = False

    # =========================================================
    # LOGGING
    # =========================================================
    LOG_LEVEL = 'WARNING'  # Apenas warnings e erros

    # =========================================================
    # COOKIES (maxima seguranca)
    # =========================================================
    SESSION_COOKIE_SECURE = True  # HTTPS obrigatorio
    SESSION_COOKIE_HTTPONLY = True
    SESSION_COOKIE_SAMESITE = 'Strict'  # Protecao CSRF mais rigorosa

    # =========================================================
    # CORS (restrito em producao)
    # =========================================================
    ALLOWED_ORIGINS = [
        os.getenv('FRONTEND_URL', 'http://localhost:5000'),
        'http://localhost:5000',
        'http://127.0.0.1:5000',
        # IMPORTANTE: Adicione aqui os dominios permitidos em producao:
        # 'https://paineis.hospital.com.br',
        # 'https://www.paineis.hospital.com.br',
    ]

    # =========================================================
    # RATE LIMITING
    # =========================================================
    RATELIMIT_ENABLED = True
    RATELIMIT_DEFAULT = "200 per hour"  # 200 requisicoes por hora por IP
    RATELIMIT_STORAGE_URL = os.getenv('REDIS_URL', 'memory://')  # Use Redis em prod

    # =========================================================
    # PERFORMANCE
    # =========================================================
    SEND_FILE_MAX_AGE_DEFAULT = 31536000  # Cache de 1 ano para assets estaticos

    # =========================================================
    # SECURITY HEADERS
    # =========================================================
    ENABLE_CSP = True  # Content Security Policy
    ENABLE_HSTS = True  # HTTP Strict Transport Security
    HSTS_MAX_AGE = 31536000  # 1 ano
    HSTS_INCLUDE_SUBDOMAINS = True
    HSTS_PRELOAD = True

    @classmethod
    def validate(cls):
        """
        Valida configuracoes obrigatorias para producao
        Retorna lista de erros encontrados
        """
        errors = []
        warnings = []

        # =========================================================
        # VALIDACAO: SECRET_KEY
        # =========================================================
        if Config.SECRET_KEY == 'dev-key-INSEGURA-mude-em-producao':
            errors.append(
                "CRITICO: SECRET_KEY nao foi configurada! "
                "Defina no arquivo .env: SECRET_KEY=sua-chave-aleatoria-aqui"
            )
        elif len(Config.SECRET_KEY) < 32:
            errors.append(
                f"CRITICO: SECRET_KEY muito curta ({len(Config.SECRET_KEY)} caracteres)! "
                "Minimo recomendado: 32 caracteres"
            )

        # =========================================================
        # VALIDACAO: SENHA DO BANCO
        # =========================================================
        if Config.DB_PASSWORD == 'postgres':
            warnings.append(
                "AVISO: Senha do banco ainda eh 'postgres'. "
                "Altere para uma senha forte em producao!"
            )
        elif len(Config.DB_PASSWORD) < 8:
            warnings.append(
                f"AVISO: Senha do banco muito curta ({len(Config.DB_PASSWORD)} caracteres). "
                "Recomendado: minimo 12 caracteres"
            )

        # =========================================================
        # VALIDACAO: CORS ORIGINS
        # =========================================================
        if '*' in cls.ALLOWED_ORIGINS:
            errors.append(
                "CRITICO: CORS configurado para aceitar qualquer origem (*) em PRODUCAO! "
                "Configure ALLOWED_ORIGINS com dominios especificos"
            )

        # =========================================================
        # VALIDACAO: HTTPS (apenas aviso se em Docker sem HTTPS)
        # =========================================================
        if not cls.SESSION_COOKIE_SECURE:
            errors.append(
                "CRITICO: SESSION_COOKIE_SECURE esta False em producao! "
                "Cookies de sessao devem ser enviados apenas via HTTPS"
            )

        # =========================================================
        # VALIDACAO: GROQ API KEY
        # =========================================================
        if not Config.GROQ_API_KEY:
            warnings.append(
                "AVISO: GROQ_API_KEY nao configurada. "
                "Funcionalidades de IA estarao desabilitadas."
            )

        # =========================================================
        # VALIDACAO: VARIAVEIS DE AMBIENTE
        # =========================================================
        required_env_vars = ['DB_HOST', 'DB_NAME', 'DB_USER', 'DB_PASSWORD']
        for var in required_env_vars:
            if not os.getenv(var) and not os.getenv('DATABASE_URL'):
                warnings.append(
                    f"AVISO: Variavel de ambiente {var} nao esta definida. "
                    f"Usando valor padrao: {getattr(Config, var)}"
                )

        return errors, warnings

    @classmethod
    def info(cls):
        docker_status = "[DOCKER]" if cls.RUNNING_IN_DOCKER else "[LOCAL]"
        return f"""
==============================================================
              MODO PRODUCAO ATIVO {docker_status}
==============================================================
  Sistema pronto para producao

  Caracteristicas de Seguranca:
  - Debug desabilitado
  - Stack traces ocultos
  - Cookies seguros (Secure, HttpOnly, SameSite=Strict)
  - CORS restrito a dominios permitidos
  - Rate limiting ativo (protecao contra ataques)
  - HSTS habilitado (forca HTTPS)
  - CSP habilitado (Content Security Policy)
  - Logs otimizados (WARNING+)
  - Cache habilitado (melhor performance)

  Banco de Dados:
  - Host: {cls.DB_HOST}
  - Database: {cls.DB_NAME}
  - User: {cls.DB_USER}
  - Port: {cls.DB_PORT}

  Performance:
  - Cache de assets: 1 ano
  - JSON nao formatado (mais rapido)
  - Gunicorn Workers: {cls.GUNICORN_WORKERS}
==============================================================
        """


class TestingConfig(Config):
    """Configuracoes para Testes Automatizados"""

    DEBUG = False
    TESTING = True

    # =========================================================
    # CONFIGURACOES DE TESTE
    # =========================================================
    LOG_LEVEL = 'ERROR'  # Apenas erros nos testes

    # Banco de dados de teste separado
    DB_NAME = os.getenv('TEST_DB_NAME', 'postgres_test')

    # Sessoes de teste
    SESSION_COOKIE_SECURE = False
    WTF_CSRF_ENABLED = False  # Desabilita CSRF em testes

    # CORS liberado para testes
    ALLOWED_ORIGINS = ['*']
    RATELIMIT_ENABLED = False

    @classmethod
    def info(cls):
        return """
==============================================================
              MODO TESTE ATIVO
==============================================================
  Caracteristicas:
  - Banco de dados de teste isolado
  - CSRF desabilitado
  - Rate limiting desabilitado
  - Logs apenas de erros
==============================================================
        """


# =========================================================
# MAPEAMENTO DE AMBIENTES
# =========================================================
config_map = {
    'development': DevelopmentConfig,
    'homologation': HomologationConfig,
    'staging': HomologationConfig,  # Alias para homologation
    'production': ProductionConfig,
    'testing': TestingConfig,
    'dev': DevelopmentConfig,
    'homolog': HomologationConfig,
    'prod': ProductionConfig,
    'test': TestingConfig
}


def get_config(config_name=None):
    """
    Retorna a classe de configuracao baseada no ambiente

    Args:
        config_name: Nome do ambiente (development, homologation, production, testing)
                     Se None, usa FLASK_ENV do .env

    Returns:
        Classe de configuracao apropriada
    """
    if config_name is None:
        config_name = os.getenv('FLASK_ENV', 'development').lower()

    config_class = config_map.get(config_name, DevelopmentConfig)

    return config_class


def validate_production_config():
    """
    Valida configuracoes de producao ou homologacao
    Exibe erros e avisos se detectados
    """
    env = os.getenv('FLASK_ENV', 'development').lower()

    # Valida producao
    if env in ['production', 'prod']:
        errors, warnings = ProductionConfig.validate()
        env_name = "PRODUCAO"
    # Valida homologacao
    elif env in ['homologation', 'homolog', 'staging']:
        errors, warnings = HomologationConfig.validate()
        env_name = "HOMOLOGACAO"
    else:
        return True

    # Exibe avisos
    if warnings:
        print("\n" + "=" * 60)
        print(f"AVISOS DE CONFIGURACAO ({env_name})")
        print("=" * 60)
        for warning in warnings:
            print(f"  {warning}")
        print("=" * 60 + "\n")

    # Exibe erros criticos
    if errors:
        print("\n" + "=" * 60)
        print(f"ERROS CRITICOS DE CONFIGURACAO ({env_name})")
        print("=" * 60)
        for error in errors:
            print(f"  {error}")
        print("=" * 60)
        print("\nCORRIJA OS ERROS ACIMA ANTES DE CONTINUAR!\n")

        # Em producao real, voce pode querer abortar:
        # import sys
        # sys.exit(1)

        return False

    print(f"Validacao de configuracao de {env_name.lower()}: OK\n")
    return True


def print_config_summary():
    """Imprime um resumo da configuracao atual"""
    config = get_config()
    print(config.info())

    # Informacoes adicionais sobre Docker
    if Config.RUNNING_IN_DOCKER:
        print("  Container Info:")
        print(f"  - Gunicorn Workers: {Config.GUNICORN_WORKERS}")
        print(f"  - Gunicorn Timeout: {Config.GUNICORN_TIMEOUT}s")
        print(f"  - Bind Address: {Config.GUNICORN_BIND}")
        print("")