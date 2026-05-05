"""
Testes de integracao HTTP para rotas de autenticacao.

Cobertura:
- POST /api/login — credenciais validas/invalidas
- POST /api/logout — limpeza de sessao
- GET  /api/verificar-sessao — com/sem sessao
- POST /api/cadastro — apenas admin, validacao de campos
- GET  /api/minhas-permissoes — retorno de permissoes + logica hub painel28
"""
import pytest
from unittest.mock import patch, MagicMock


# ==============================================================
# LOGIN
# ==============================================================

class TestLogin:
    """Testes para POST /api/login."""

    @pytest.mark.auth
    @pytest.mark.routes
    def test_login_sem_body(self, client):
        """Requisicao sem JSON lanca excecao no Flask e e capturada pelo try-except geral como 500."""
        resp = client.post('/api/login', json=None, content_type='application/json')
        assert resp.status_code == 500

    @pytest.mark.auth
    @pytest.mark.routes
    def test_login_campos_faltando(self, client):
        """Requisicao sem usuario ou senha deve retornar 400."""
        resp = client.post('/api/login', json={'usuario': 'test'})
        assert resp.status_code == 400
        data = resp.get_json()
        assert data['success'] is False

    @pytest.mark.auth
    @pytest.mark.routes
    def test_login_credenciais_invalidas(self, client):
        """Credenciais invalidas devem retornar 401."""
        with patch('backend.routes.auth_routes.verificar_usuario') as mock_verificar:
            mock_verificar.return_value = {
                'success': False,
                'error': 'Usuario ou senha invalidos'
            }
            resp = client.post('/api/login', json={
                'usuario': 'invalido',
                'senha': 'senhaerrada'
            })
            assert resp.status_code == 401
            data = resp.get_json()
            assert data['success'] is False

    @pytest.mark.auth
    @pytest.mark.routes
    def test_login_sucesso(self, client):
        """Login valido deve retornar 200 e configurar sessao."""
        with patch('backend.routes.auth_routes.verificar_usuario') as mock_verificar, \
             patch('backend.routes.auth_routes.buscar_permissoes_usuario') as mock_perms:
            mock_verificar.return_value = {
                'success': True,
                'usuario_id': 1,
                'usuario': 'testuser',
                'is_admin': False,
                'force_reset': False
            }
            mock_perms.return_value = {'painel2', 'painel5'}

            resp = client.post('/api/login', json={
                'usuario': 'testuser',
                'senha': 'Senh@Forte1!'
            })
            assert resp.status_code == 200
            data = resp.get_json()
            assert data['success'] is True
            assert data['usuario'] == 'testuser'
            assert data['is_admin'] is False

    @pytest.mark.auth
    @pytest.mark.routes
    def test_login_admin(self, client):
        """Login como admin deve setar is_admin=True e permissoes vazias."""
        with patch('backend.routes.auth_routes.verificar_usuario') as mock_verificar:
            mock_verificar.return_value = {
                'success': True,
                'usuario_id': 99,
                'usuario': 'admin',
                'is_admin': True,
                'force_reset': False
            }
            resp = client.post('/api/login', json={
                'usuario': 'admin',
                'senha': 'Admin@123!'
            })
            assert resp.status_code == 200
            data = resp.get_json()
            assert data['is_admin'] is True

    @pytest.mark.auth
    @pytest.mark.routes
    def test_login_force_reset(self, client):
        """Login com force_reset deve retornar flag force_reset=True."""
        with patch('backend.routes.auth_routes.verificar_usuario') as mock_verificar, \
             patch('backend.routes.auth_routes.buscar_permissoes_usuario') as mock_perms:
            mock_verificar.return_value = {
                'success': True,
                'usuario_id': 5,
                'usuario': 'novo_user',
                'is_admin': False,
                'force_reset': True
            }
            mock_perms.return_value = set()

            resp = client.post('/api/login', json={
                'usuario': 'novo_user',
                'senha': 'Temp@Pass1!'
            })
            data = resp.get_json()
            assert data['force_reset'] is True


# ==============================================================
# LOGOUT
# ==============================================================

class TestLogout:
    """Testes para POST /api/logout."""

    @pytest.mark.auth
    @pytest.mark.routes
    def test_logout_limpa_sessao(self, auth_client):
        """Logout deve limpar a sessao e retornar sucesso."""
        resp = auth_client.post('/api/logout')
        assert resp.status_code == 200
        data = resp.get_json()
        assert data['success'] is True

    @pytest.mark.auth
    @pytest.mark.routes
    def test_logout_sem_sessao(self, client):
        """Logout sem sessao ativa nao deve gerar erro."""
        resp = client.post('/api/logout')
        assert resp.status_code == 200


# ==============================================================
# VERIFICAR SESSAO
# ==============================================================

class TestVerificarSessao:
    """Testes para GET /api/verificar-sessao."""

    @pytest.mark.auth
    @pytest.mark.routes
    def test_sem_sessao(self, client):
        """Sem sessao deve retornar autenticado=False."""
        resp = client.get('/api/verificar-sessao')
        assert resp.status_code == 200
        data = resp.get_json()
        assert data['autenticado'] is False

    @pytest.mark.auth
    @pytest.mark.routes
    def test_com_sessao(self, auth_client):
        """Com sessao deve retornar autenticado=True e dados do usuario."""
        resp = auth_client.get('/api/verificar-sessao')
        assert resp.status_code == 200
        data = resp.get_json()
        assert data['autenticado'] is True
        assert data['usuario'] == 'testuser'
        assert data['is_admin'] is False


# ==============================================================
# CADASTRO (admin only)
# ==============================================================

class TestCadastro:
    """Testes para POST /api/cadastro."""

    @pytest.mark.auth
    @pytest.mark.routes
    def test_cadastro_sem_autenticacao(self, client):
        """Sem sessao deve retornar 401."""
        resp = client.post('/api/cadastro', json={
            'usuario': 'novo',
            'senha': 'Senh@1234!',
            'email': 'novo@test.com'
        })
        assert resp.status_code == 401

    @pytest.mark.auth
    @pytest.mark.routes
    def test_cadastro_usuario_normal(self, auth_client):
        """Usuario nao-admin deve retornar 403."""
        resp = auth_client.post('/api/cadastro', json={
            'usuario': 'novo',
            'senha': 'Senh@1234!',
            'email': 'novo@test.com'
        })
        assert resp.status_code == 403

    @pytest.mark.auth
    @pytest.mark.routes
    def test_cadastro_admin_campos_faltando(self, admin_client):
        """Admin sem campos obrigatorios deve retornar 400."""
        resp = admin_client.post('/api/cadastro', json={'usuario': 'novo'})
        assert resp.status_code == 400

    @pytest.mark.auth
    @pytest.mark.routes
    def test_cadastro_admin_sucesso(self, admin_client):
        """Admin com dados corretos deve criar usuario."""
        with patch('backend.routes.auth_routes.criar_usuario') as mock_criar:
            mock_criar.return_value = {
                'success': True,
                'usuario_id': 42
            }
            resp = admin_client.post('/api/cadastro', json={
                'usuario': 'novo_user',
                'senha': 'Senh@Forte1!',
                'email': 'novo@hospital.com'
            })
            assert resp.status_code == 200
            data = resp.get_json()
            assert data['success'] is True
            assert data['usuario_id'] == 42


# ==============================================================
# MINHAS PERMISSOES
# ==============================================================

class TestMinhasPermissoes:
    """Testes para GET /api/minhas-permissoes."""

    @pytest.mark.auth
    @pytest.mark.routes
    def test_sem_autenticacao(self, client):
        """Sem sessao deve retornar 401."""
        resp = client.get('/api/minhas-permissoes')
        assert resp.status_code == 401

    @pytest.mark.auth
    @pytest.mark.routes
    def test_usuario_normal(self, auth_client):
        """Deve retornar as permissoes da sessao."""
        resp = auth_client.get('/api/minhas-permissoes')
        assert resp.status_code == 200
        data = resp.get_json()
        assert data['success'] is True
        assert data['is_admin'] is False
        assert 'painel2' in data['permissoes']

    @pytest.mark.auth
    @pytest.mark.routes
    def test_admin(self, admin_client):
        """Admin deve retornar is_admin=True."""
        resp = admin_client.get('/api/minhas-permissoes')
        assert resp.status_code == 200
        data = resp.get_json()
        assert data['is_admin'] is True

    @pytest.mark.auth
    @pytest.mark.routes
    def test_hub_painel28_automatico(self, app):
        """
        Usuario com permissao em sub-painel do hub (34/35/36)
        deve receber painel28 automaticamente.
        """
        with app.test_client() as c:
            with c.session_transaction() as sess:
                sess['usuario_id'] = 10
                sess['usuario'] = 'hub_user'
                sess['is_admin'] = False
                sess['permissoes'] = ['painel34']

            resp = c.get('/api/minhas-permissoes')
            data = resp.get_json()
            assert 'painel28' in data['permissoes']
            assert 'painel34' in data['permissoes']

    @pytest.mark.auth
    @pytest.mark.routes
    def test_hub_painel28_nao_adicionado_sem_sub_painel(self, app):
        """
        Usuario SEM permissao nos sub-paineis do hub
        NAO deve receber painel28.
        """
        with app.test_client() as c:
            with c.session_transaction() as sess:
                sess['usuario_id'] = 11
                sess['usuario'] = 'no_hub_user'
                sess['is_admin'] = False
                sess['permissoes'] = ['painel2', 'painel5']

            resp = c.get('/api/minhas-permissoes')
            data = resp.get_json()
            assert 'painel28' not in data['permissoes']
