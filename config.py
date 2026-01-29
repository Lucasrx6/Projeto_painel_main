"""
Configurações do Sistema de Painéis Hospitalares
Separação segura entre Desenvolvimento e Produção
"""

import os
from dotenv import load_dotenv

load_dotenv()


class Config:
    """Configurações base compartilhadas entre todos os ambientes"""

    # =========================================================
    # 🔐 SEGURANÇA
    # =========================================================
    SECRET_KEY = os.getenv('SECRET_KEY', 'dev-key-INSEGURA-mude-em-producao')

    # =========================================================
    # 🍪 SESSÃO
    # =========================================================
    PERMANENT_SESSION_LIFETIME = 28800  # 8 horas em segundos
    SESSION_COOKIE_HTTPONLY = True  # Previne acesso via JavaScript
    SESSION_COOKIE_SAMESITE = 'Lax'  # Proteção CSRF
    SESSION_COOKIE_NAME = 'painel_session'

    # =========================================================
    # 🗄️ BANCO DE DADOS
    # =========================================================
    DB_HOST = os.getenv('DB_HOST', 'localhost')
    DB_NAME = os.getenv('DB_NAME', 'postgres')
    DB_USER = os.getenv('DB_USER', 'postgres')
    DB_PASSWORD = os.getenv('DB_PASSWORD', 'postgres')
    DB_PORT = os.getenv('DB_PORT', '5432')

    # =========================================================
    # 📡 API & JSON
    # =========================================================
    JSON_SORT_KEYS = False
    JSONIFY_PRETTYPRINT_REGULAR = False

    # =========================================================
    # 🌐 CORS (base - sobrescrito por ambiente)
    # =========================================================
    CORS_ORIGINS = "*"
    CORS_SUPPORTS_CREDENTIALS = True


class DevelopmentConfig(Config):
    """Configurações para Ambiente de Desenvolvimento"""

    DEBUG = True
    TESTING = False

    # =========================================================
    # 📝 LOGGING
    # =========================================================
    LOG_LEVEL = 'DEBUG'

    # =========================================================
    # 🍪 COOKIES (menos restritivos em dev)
    # =========================================================
    SESSION_COOKIE_SECURE = False  # HTTP permitido em dev

    # =========================================================
    # 🌐 CORS (liberado em desenvolvimento)
    # =========================================================
    ALLOWED_ORIGINS = ['*']  # Aceita qualquer origem
    RATELIMIT_ENABLED = False  # Rate limiting desabilitado em dev

    # =========================================================
    # ⚡ PERFORMANCE
    # =========================================================
    SEND_FILE_MAX_AGE_DEFAULT = 0  # Sem cache (facilita desenvolvimento)

    @classmethod
    def info(cls):
        return """
╔════════════════════════════════════════════════════════════╗
║           🛠️  MODO DESENVOLVIMENTO ATIVO                   ║
╠════════════════════════════════════════════════════════════╣
║  ⚠️  NÃO USE EM PRODUÇÃO!                                  ║
║                                                            ║
║  Características:                                          ║
║  • Debug habilitado                                        ║
║  • Stack traces visíveis                                   ║
║  • Auto-reload ativo                                       ║
║  • Cookies sem flag Secure (HTTP permitido)               ║
║  • Logs detalhados (DEBUG)                                 ║
║  • CORS liberado (*)                                       ║
║  • Rate limiting desabilitado                              ║
║  • Cache desabilitado                                      ║
╚════════════════════════════════════════════════════════════╝
        """


class ProductionConfig(Config):
    """Configurações para Ambiente de Produção"""

    DEBUG = False
    TESTING = False

    # =========================================================
    # 📝 LOGGING
    # =========================================================
    LOG_LEVEL = 'WARNING'  # Apenas warnings e erros

    # =========================================================
    # 🍪 COOKIES (máxima segurança)
    # =========================================================
    SESSION_COOKIE_SECURE = True  # HTTPS obrigatório
    SESSION_COOKIE_HTTPONLY = True
    SESSION_COOKIE_SAMESITE = 'Strict'  # Proteção CSRF mais rigorosa

    # =========================================================
    # 🌐 CORS (restrito em produção)
    # =========================================================
    ALLOWED_ORIGINS = [
        os.getenv('FRONTEND_URL', 'http://localhost:5000'),
        'http://localhost:5000',
        'http://127.0.0.1:5000',
        # ⚠️ IMPORTANTE: Adicione aqui os domínios permitidos em produção:
        # 'https://paineis.hospital.com.br',
        # 'https://www.paineis.hospital.com.br',
    ]

    # =========================================================
    # 🛡️ RATE LIMITING
    # =========================================================
    RATELIMIT_ENABLED = True
    RATELIMIT_DEFAULT = "200 per hour"  # 200 requisições por hora por IP
    RATELIMIT_STORAGE_URL = os.getenv('REDIS_URL', 'memory://')  # Use Redis em prod

    # =========================================================
    # ⚡ PERFORMANCE
    # =========================================================
    SEND_FILE_MAX_AGE_DEFAULT = 31536000  # Cache de 1 ano para assets estáticos

    # =========================================================
    # 🔒 SECURITY HEADERS
    # =========================================================
    ENABLE_CSP = True  # Content Security Policy
    ENABLE_HSTS = True  # HTTP Strict Transport Security
    HSTS_MAX_AGE = 31536000  # 1 ano
    HSTS_INCLUDE_SUBDOMAINS = True
    HSTS_PRELOAD = True

    @classmethod
    def validate(cls):
        """
        Valida configurações obrigatórias para produção
        Retorna lista de erros encontrados
        """
        errors = []
        warnings = []

        # =========================================================
        # VALIDAÇÃO: SECRET_KEY
        # =========================================================
        if Config.SECRET_KEY == 'dev-key-INSEGURA-mude-em-producao':
            errors.append(
                "❌ CRÍTICO: SECRET_KEY não foi configurada! "
                "Defina no arquivo .env: SECRET_KEY=sua-chave-aleatoria-aqui"
            )
        elif len(Config.SECRET_KEY) < 32:
            errors.append(
                f"❌ CRÍTICO: SECRET_KEY muito curta ({len(Config.SECRET_KEY)} caracteres)! "
                "Mínimo recomendado: 32 caracteres"
            )

        # =========================================================
        # VALIDAÇÃO: SENHA DO BANCO
        # =========================================================
        if Config.DB_PASSWORD == 'postgres':
            warnings.append(
                "⚠️  AVISO: Senha do banco ainda é 'postgres'. "
                "Altere para uma senha forte em produção!"
            )
        elif len(Config.DB_PASSWORD) < 8:
            warnings.append(
                f"⚠️  AVISO: Senha do banco muito curta ({len(Config.DB_PASSWORD)} caracteres). "
                "Recomendado: mínimo 12 caracteres"
            )

        # =========================================================
        # VALIDAÇÃO: CORS ORIGINS
        # =========================================================
        if '*' in cls.ALLOWED_ORIGINS:
            errors.append(
                "❌ CRÍTICO: CORS configurado para aceitar qualquer origem (*) em PRODUÇÃO! "
                "Configure ALLOWED_ORIGINS com domínios específicos"
            )

        # =========================================================
        # VALIDAÇÃO: HTTPS
        # =========================================================
        if not cls.SESSION_COOKIE_SECURE:
            errors.append(
                "❌ CRÍTICO: SESSION_COOKIE_SECURE está False em produção! "
                "Cookies de sessão devem ser enviados apenas via HTTPS"
            )

        # =========================================================
        # VALIDAÇÃO: VARIÁVEIS DE AMBIENTE
        # =========================================================
        required_env_vars = ['DB_HOST', 'DB_NAME', 'DB_USER', 'DB_PASSWORD']
        for var in required_env_vars:
            if not os.getenv(var):
                warnings.append(
                    f"⚠️  AVISO: Variável de ambiente {var} não está definida. "
                    f"Usando valor padrão: {getattr(Config, var)}"
                )

        return errors, warnings

    @classmethod
    def info(cls):
        return """
╔════════════════════════════════════════════════════════════╗
║              🔒 MODO PRODUÇÃO ATIVO                        ║
╠════════════════════════════════════════════════════════════╣
║  ✅ Sistema pronto para produção                           ║
║                                                            ║
║  Características de Segurança:                             ║
║  • Debug desabilitado                                      ║
║  • Stack traces ocultos                                    ║
║  • Cookies seguros (Secure, HttpOnly, SameSite=Strict)    ║
║  • CORS restrito a domínios permitidos                     ║
║  • Rate limiting ativo (proteção contra ataques)          ║
║  • HSTS habilitado (força HTTPS)                          ║
║  • CSP habilitado (Content Security Policy)               ║
║  • Logs otimizados (WARNING+)                              ║
║  • Cache habilitado (melhor performance)                   ║
║                                                            ║
║  Performance:                                              ║
║  • Cache de assets: 1 ano                                  ║
║  • JSON não formatado (mais rápido)                        ║
╚════════════════════════════════════════════════════════════╝
        """


class TestingConfig(Config):
    """Configurações para Testes Automatizados"""

    DEBUG = False
    TESTING = True

    # =========================================================
    # 🧪 CONFIGURAÇÕES DE TESTE
    # =========================================================
    LOG_LEVEL = 'ERROR'  # Apenas erros nos testes

    # Banco de dados de teste separado
    DB_NAME = os.getenv('TEST_DB_NAME', 'postgres_test')

    # Sessões de teste
    SESSION_COOKIE_SECURE = False
    WTF_CSRF_ENABLED = False  # Desabilita CSRF em testes

    # CORS liberado para testes
    ALLOWED_ORIGINS = ['*']
    RATELIMIT_ENABLED = False

    @classmethod
    def info(cls):
        return """
╔════════════════════════════════════════════════════════════╗
║              🧪 MODO TESTE ATIVO                           ║
╠════════════════════════════════════════════════════════════╣
║  Características:                                          ║
║  • Banco de dados de teste isolado                        ║
║  • CSRF desabilitado                                       ║
║  • Rate limiting desabilitado                              ║
║  • Logs apenas de erros                                    ║
╚════════════════════════════════════════════════════════════╝
        """


# =========================================================
# 🗺️ MAPEAMENTO DE AMBIENTES
# =========================================================
config_map = {
    'development': DevelopmentConfig,
    'production': ProductionConfig,
    'testing': TestingConfig,
    'dev': DevelopmentConfig,
    'prod': ProductionConfig,
    'test': TestingConfig
}


def get_config(config_name=None):
    """
    Retorna a classe de configuração baseada no ambiente

    Args:
        config_name: Nome do ambiente (development, production, testing)
                     Se None, usa FLASK_ENV do .env

    Returns:
        Classe de configuração apropriada
    """
    if config_name is None:
        config_name = os.getenv('FLASK_ENV', 'development').lower()

    config_class = config_map.get(config_name, DevelopmentConfig)

    return config_class


def validate_production_config():
    """
    Valida configurações de produção
    Exibe erros e avisos se detectados
    """
    env = os.getenv('FLASK_ENV', 'development').lower()

    if env in ['production', 'prod']:
        errors, warnings = ProductionConfig.validate()

        # Exibe avisos
        if warnings:
            print("\n" + "=" * 60)
            print("⚠️  AVISOS DE CONFIGURAÇÃO")
            print("=" * 60)
            for warning in warnings:
                print(warning)
            print("=" * 60 + "\n")

        # Exibe erros críticos
        if errors:
            print("\n" + "=" * 60)
            print("🚨 ERROS CRÍTICOS DE CONFIGURAÇÃO DETECTADOS")
            print("=" * 60)
            for error in errors:
                print(error)
            print("=" * 60)
            print("\n❌ CORRIJA OS ERROS ACIMA ANTES DE CONTINUAR!\n")

            # Em produção real, você pode querer abortar:
            # import sys
            # sys.exit(1)

            return False

        print("✅ Validação de configuração de produção: OK\n")
        return True

    return True