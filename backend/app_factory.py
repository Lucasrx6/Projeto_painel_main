"""
Application Factory Pattern
Cria e configura a aplicação Flask de forma modular e testável
"""
from flask import Flask
from flask_cors import CORS
import sys
import io

from config import get_config, validate_production_config
from backend.logging_config import setup_logging
from backend.middleware.security import setup_security_headers
from backend.middleware.error_handlers import register_error_handlers
from backend.database import init_db


def create_app(config_name=None):
    """
    Cria e configura a aplicação Flask

    Args:
        config_name: Nome da configuração (development, production, etc.)

    Returns:
        app: Instância configurada do Flask
    """
    # Configura encoding UTF-8 para stdout/stderr
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8', errors='replace')

    # Obtém o diretório raiz do projeto (onde está app.py)
    root_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

    # Cria instância do Flask com os paths corretos
    app = Flask(
        __name__,
        template_folder=os.path.join(root_dir, 'frontend'),
        static_folder=os.path.join(root_dir, 'static'),
        static_url_path='/static'
    )

    # Registra o root_dir no app.config para uso nas rotas
    app.config['ROOT_DIR'] = root_dir

    # Carrega configuração
    config_class = get_config(config_name)
    app.config.from_object(config_class)

    # Valida configuração de produção
    if not app.config.get('DEBUG', False):
        validate_production_config()

    # Log da configuração carregada
    print(config_class.info())

    # Configura logging
    setup_logging(app)

    # Configura CORS
    configure_cors(app)

    # Configura security headers
    setup_security_headers(app)

    # Registra error handlers
    register_error_handlers(app)

    # Inicializa banco de dados
    init_db()

    # Registra Blueprints
    register_blueprints(app)

    @app.route('/debug/routes')
    def show_routes():
        """Mostra todas as rotas registradas"""
        output = ['<h2>Rotas Registradas:</h2><ul>']
        for rule in sorted(app.url_map.iter_rules(), key=lambda r: r.rule):
            methods = ','.join([m for m in rule.methods if m not in ['HEAD', 'OPTIONS']])
            output.append(f'<li><b>{rule.rule}</b> [{methods}] → {rule.endpoint}</li>')
        output.append('</ul>')
        return ''.join(output)

    return app


    app.logger.info('Aplicação Flask criada e configurada com sucesso')

    return app


def configure_cors(app):
    """
    Configura CORS de acordo com o ambiente
    """
    if app.config.get('DEBUG', False):
        # Desenvolvimento: Liberado
        CORS(app,
             resources={r"/*": {"origins": "*"}},
             supports_credentials=True,
             allow_headers=["Content-Type", "Authorization"],
             methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"])
        app.logger.info('🌐 CORS configurado (modo desenvolvimento - liberado)')
    else:
        # Produção: Restrito
        allowed_origins = app.config.get('ALLOWED_ORIGINS', [
            'http://localhost:5000',
            'http://127.0.0.1:5000'
        ])

        CORS(app,
             resources={r"/*": {"origins": allowed_origins}},
             supports_credentials=True,
             allow_headers=["Content-Type", "Authorization"],
             methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"])
        app.logger.info(f'🔒 CORS configurado (produção - restrito)')


def register_blueprints(app):
    """
    Registra todos os Blueprints da aplicação
    """
    # Importa Blueprints
    from backend.routes.auth_routes import auth_bp
    from backend.routes.main_routes import main_bp
    from backend.routes.pwa_routes import pwa_bp
    from backend.routes.admin_routes import admin_bp
    from backend.routes.painel2_routes import painel2_bp
    from backend.routes.painel3_routes import painel3_bp
    from backend.routes.painel4_routes import painel4_bp
    from backend.routes.painel5_routes import painel5_bp
    from backend.routes.painel6_routes import painel6_bp
    from backend.routes.painel7_routes import painel7_bp
    from backend.routes.painel8_routes import painel8_bp
    from backend.routes.painel9_routes import painel9_bp
    from backend.routes.painel10_routes import painel10_bp
    from backend.routes.painel11_routes import painel11_bp
    from backend.routes.painel12_routes import painel12_bp
    from backend.routes.painel13_routes import painel13_bp
    from backend.routes.painel14_routes import painel14_bp
    from backend.routes.painel15_routes import painel15_bp
    from backend.routes.painel16_routes import painel16_bp

    # Registra Blueprints Core
    app.register_blueprint(auth_bp)
    app.register_blueprint(main_bp)
    app.register_blueprint(pwa_bp)
    app.register_blueprint(admin_bp)

    # Registra Blueprints dos Painéis
    paineis = [
        painel2_bp, painel3_bp, painel4_bp, painel5_bp,
        painel6_bp, painel7_bp, painel8_bp, painel9_bp,
        painel10_bp, painel11_bp, painel12_bp, painel13_bp,
        painel14_bp, painel15_bp, painel16_bp
    ]

    for painel in paineis:
        app.register_blueprint(painel)

    app.logger.info(f'{len(paineis) + 4} Blueprints registrados com sucesso')