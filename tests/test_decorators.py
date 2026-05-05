"""
Testes para middleware decorators de autenticacao e autorizacao.

Cobertura:
- @login_required: bloqueio sem sessao, acesso com sessao
- @admin_required: bloqueio sem admin, acesso com admin
- @panel_permission_required: verificacao por painel
"""
import pytest
from flask import Blueprint, jsonify
from unittest.mock import patch


# Removida a funcao _setup_test_routes.
# As rotas de teste agora sao registradas no conftest.py na fixture `app`.


class TestLoginRequired:
    @pytest.mark.decorators
    def test_api_sem_sessao_401(self, app, client):
        resp = client.get('/test/protected')
        assert resp.status_code == 401

    @pytest.mark.decorators
    def test_pagina_redireciona_302(self, app, client):
        resp = client.get('/test/protected', headers={'Accept': 'text/html'})
        assert resp.status_code == 302

    @pytest.mark.decorators
    def test_com_sessao_200(self, app, auth_client):
        resp = auth_client.get('/test/protected')
        assert resp.status_code == 200


class TestAdminRequired:
    @pytest.mark.decorators
    def test_sem_sessao_401(self, app, client):
        resp = client.get('/test/admin-only')
        assert resp.status_code == 401

    @pytest.mark.decorators
    def test_normal_403(self, app, auth_client):
        resp = auth_client.get('/test/admin-only')
        assert resp.status_code == 403

    @pytest.mark.decorators
    def test_admin_200(self, app, admin_client):
        resp = admin_client.get('/test/admin-only')
        assert resp.status_code == 200


class TestPanelPermissionRequired:
    @pytest.mark.decorators
    def test_sem_sessao_401(self, app, client):
        resp = client.get('/test/painel5-only')
        assert resp.status_code == 401

    @pytest.mark.decorators
    def test_sem_permissao_403(self, app):
        with app.test_client() as c:
            with c.session_transaction() as sess:
                sess['usuario_id'] = 2
                sess['usuario'] = 'sem_p5'
                sess['is_admin'] = False
                sess['permissoes'] = ['painel2']
            with patch('backend.middleware.decorators.verificar_permissao_painel', return_value=False):
                resp = c.get('/test/painel5-only')
                assert resp.status_code == 403

    @pytest.mark.decorators
    def test_com_permissao_200(self, app, auth_client):
        with patch('backend.middleware.decorators.verificar_permissao_painel', return_value=True):
            resp = auth_client.get('/test/painel5-only')
            assert resp.status_code == 200

    @pytest.mark.decorators
    def test_admin_acessa_tudo(self, app, admin_client):
        resp = admin_client.get('/test/painel5-only')
        assert resp.status_code == 200
