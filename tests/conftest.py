"""
Fixtures compartilhadas para a suite de testes.

Estrategia: mocks completos de DB e Redis.
Nenhum teste depende de infraestrutura externa.
"""
import sys
import os
import pytest
from unittest.mock import patch, MagicMock

# Garante que a raiz do projeto esta no path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


# ================================================================
# APP FIXTURE — cria Flask app isolada para testes
# ================================================================

@pytest.fixture(scope='session')
def app():
    """
    Cria instancia Flask com TestingConfig.
    Escopo de sessao: criada uma unica vez para todos os testes.
    """
    # Patch do banco ANTES de importar qualquer modulo que conecte
    with patch('backend.database.get_db_connection', return_value=None), \
         patch('backend.database.init_db', return_value=True), \
         patch('backend.database.init_connection_pool', return_value=None), \
         patch('backend.cache.init_redis', return_value=None):

        from flask import Flask
        from config import TestingConfig
        from backend.middleware.decorators import login_required, admin_required, panel_permission_required

        test_app = Flask(
            __name__,
            template_folder=os.path.join(
                os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                'frontend'
            )
        )
        test_app.config.from_object(TestingConfig)
        test_app.config['SECRET_KEY'] = 'test-secret-key-for-pytest'
        test_app.config['SERVER_NAME'] = 'localhost'

        # Registra apenas blueprints core necessarios para testes
        from backend.routes.auth_routes import auth_bp
        test_app.register_blueprint(auth_bp)

        # Registra rotas dummy para test_decorators
        from flask import Blueprint, jsonify
        test_bp = Blueprint('test_decorators', __name__, url_prefix='/test')

        @test_bp.route('/protected')
        @login_required
        def protected():
            return jsonify({'success': True, 'message': 'acesso permitido'})

        @test_bp.route('/admin-only')
        @admin_required
        def admin_only():
            return jsonify({'success': True, 'message': 'area admin'})

        @test_bp.route('/painel5-only')
        @panel_permission_required('painel5')
        def painel5_only():
            return jsonify({'success': True, 'message': 'acesso painel5'})

        test_app.register_blueprint(test_bp)

        yield test_app


# ================================================================
# CLIENT FIXTURES
# ================================================================

@pytest.fixture
def client(app):
    """Client de teste Flask (sem sessao)."""
    with app.test_client() as c:
        yield c


@pytest.fixture
def auth_client(app):
    """
    Client de teste ja autenticado como usuario NORMAL.
    Simula sessao ativa com permissoes especificas.
    """
    with app.test_client() as c:
        with c.session_transaction() as sess:
            sess['usuario_id'] = 1
            sess['usuario'] = 'testuser'
            sess['is_admin'] = False
            sess['permissoes'] = ['painel2', 'painel5', 'painel34', 'painel35']
        yield c


@pytest.fixture
def admin_client(app):
    """
    Client de teste ja autenticado como ADMIN.
    Admin tem acesso a tudo — permissoes vazias por design.
    """
    with app.test_client() as c:
        with c.session_transaction() as sess:
            sess['usuario_id'] = 99
            sess['usuario'] = 'admin'
            sess['is_admin'] = True
            sess['permissoes'] = []
        yield c


# ================================================================
# MOCK FIXTURES
# ================================================================

@pytest.fixture
def mock_db_connection():
    """
    Mock completo de uma conexao PostgreSQL.
    Retorna (mock_conn, mock_cursor) para inspecao nos testes.
    """
    mock_cursor = MagicMock()
    mock_conn = MagicMock()
    mock_conn.cursor.return_value = mock_cursor
    mock_conn.__enter__ = MagicMock(return_value=mock_conn)
    mock_conn.__exit__ = MagicMock(return_value=False)
    return mock_conn, mock_cursor


@pytest.fixture
def mock_redis():
    """Mock de um cliente Redis."""
    mock_client = MagicMock()
    mock_client.ping.return_value = True
    mock_client.get.return_value = None
    mock_client.set.return_value = True
    mock_client.info.return_value = {
        'redis_version': '7.0.0',
        'used_memory_human': '1.5M',
        'connected_clients': 2,
    }
    return mock_client
