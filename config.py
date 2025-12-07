"""
Configurações do Sistema de Painéis
Separação entre Desenvolvimento e Produção
"""

import os
from dotenv import load_dotenv

load_dotenv()


class Config:
    """Configurações base"""

    # Segurança
    SECRET_KEY = os.getenv('SECRET_KEY', 'dev-key-INSEGURA-mude-em-producao')

    # Sessão
    PERMANENT_SESSION_LIFETIME = 28800  # 8 horas em segundos
    SESSION_COOKIE_HTTPONLY = True
    SESSION_COOKIE_SAMESITE = 'Lax'
    SESSION_COOKIE_NAME = 'painel_session'

    # Banco de Dados
    DB_HOST = os.getenv('DB_HOST', 'localhost')
    DB_NAME = os.getenv('DB_NAME', 'postgres')
    DB_USER = os.getenv('DB_USER', 'postgres')
    DB_PASSWORD = os.getenv('DB_PASSWORD', 'postgres')
    DB_PORT = os.getenv('DB_PORT', '5432')

    # Aplicação
    JSON_SORT_KEYS = False
    JSONIFY_PRETTYPRINT_REGULAR = False

    # CORS
    CORS_ORIGINS = "*"
    CORS_SUPPORTS_CREDENTIALS = True


class DevelopmentConfig(Config):
    """Configurações para Desenvolvimento"""

    DEBUG = True
    TESTING = False

    # Logs detalhados
    LOG_LEVEL = 'DEBUG'

    # Cookies menos restritivos para facilitar desenvolvimento
    SESSION_COOKIE_SECURE = False

    # Performance
    SEND_FILE_MAX_AGE_DEFAULT = 0  # Sem cache

    @staticmethod
    def info():
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
║  • Cookies sem flag Secure                                 ║
║  • Logs detalhados (DEBUG)                                 ║
╚════════════════════════════════════════════════════════════╝
        """


class ProductionConfig(Config):
    """Configurações para Produção"""

    DEBUG = False
    TESTING = False

    # Logs apenas de erros/avisos
    LOG_LEVEL = 'WARNING'

    # Cookies seguros
    SESSION_COOKIE_SECURE = True  # HTTPS obrigatório

    # Performance
    SEND_FILE_MAX_AGE_DEFAULT = 31536000  # Cache de 1 ano para assets

    # Validação de SECRET_KEY
    @staticmethod
    def validate():
        """Valida configurações obrigatórias para produção"""
        errors = []

        # SECRET_KEY não pode ser a padrão
        if Config.SECRET_KEY == 'dev-key-INSEGURA-mude-em-producao':
            errors.append("❌ SECRET_KEY não foi configurada! Defina no .env")

        # SECRET_KEY deve ter tamanho mínimo
        if len(Config.SECRET_KEY) < 32:
            errors.append("❌ SECRET_KEY muito curta! Mínimo 32 caracteres")

        # Senha do banco não pode ser padrão
        if Config.DB_PASSWORD == 'postgres':
            errors.append("⚠️  AVISO: Senha do banco ainda é 'postgres'")

        return errors

    @staticmethod
    def info():
        return """
╔════════════════════════════════════════════════════════════╗
║              🔒 MODO PRODUÇÃO ATIVO                        ║
╠════════════════════════════════════════════════════════════╣
║  Características:                                          ║
║  • Debug desabilitado                                      ║
║  • Erros genéricos (sem stack trace)                       ║
║  • Cookies com flag Secure (HTTPS)                         ║
║  • Logs otimizados (WARNING+)                              ║
║  • Cache habilitado                                        ║
║                                                            ║
║  ✅ Sistema pronto para produção                           ║
╚════════════════════════════════════════════════════════════╝
        """


# Mapeamento de ambientes
config_map = {
    'development': DevelopmentConfig,
    'production': ProductionConfig,
    'dev': DevelopmentConfig,
    'prod': ProductionConfig
}


def get_config():
    """Retorna configuração baseada no ambiente"""
    env = os.getenv('FLASK_ENV', 'development').lower()

    # Aceita variações
    if env in ['production', 'prod']:
        return ProductionConfig
    else:
        return DevelopmentConfig


def validate_production_config():
    """Valida configurações de produção"""
    if os.getenv('FLASK_ENV', 'development').lower() in ['production', 'prod']:
        errors = ProductionConfig.validate()

        if errors:
            print("\n" + "=" * 60)
            print("🚨 ERROS DE CONFIGURAÇÃO DETECTADOS")
            print("=" * 60)
            for error in errors:
                print(error)
            print("=" * 60)
            print("\n⚠️  Corrija antes de continuar!\n")

            # Em produção, poderia até abortar
            # import sys
            # sys.exit(1)