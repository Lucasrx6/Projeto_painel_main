"""
Testes unitarios para validadores do modulo backend.auth

Cobertura:
- validar_senha_forte: requisitos de complexidade
- validar_usuario: formato de nome de usuario
- validar_email: formato de email
- RateLimiter: bloqueio por tentativas excessivas
"""
import pytest
import time
from backend.auth import (
    validar_senha_forte,
    validar_usuario,
    validar_email,
    RateLimiter,
    SENHA_MIN_LENGTH,
    MAX_TENTATIVAS_LOGIN,
)


# ==============================================================
# validar_senha_forte
# ==============================================================

class TestValidarSenhaForte:
    """Testes para validacao de complexidade de senha."""

    @pytest.mark.validators
    def test_senha_valida(self):
        valida, erro = validar_senha_forte('Senh@Forte1!')
        assert valida is True
        assert erro == ''

    @pytest.mark.validators
    def test_senha_vazia(self):
        valida, erro = validar_senha_forte('')
        assert valida is False

    @pytest.mark.validators
    def test_senha_none(self):
        valida, erro = validar_senha_forte(None)
        assert valida is False

    @pytest.mark.validators
    def test_senha_curta(self):
        valida, erro = validar_senha_forte('Ab1!')
        assert valida is False
        assert 'minimo' in erro.lower() or str(SENHA_MIN_LENGTH) in erro

    @pytest.mark.validators
    def test_senha_sem_maiuscula(self):
        valida, erro = validar_senha_forte('senha@forte1!')
        assert valida is False
        assert 'maiuscula' in erro.lower()

    @pytest.mark.validators
    def test_senha_sem_minuscula(self):
        valida, erro = validar_senha_forte('SENHA@FORTE1!')
        assert valida is False
        assert 'minuscula' in erro.lower()

    @pytest.mark.validators
    def test_senha_sem_numero(self):
        valida, erro = validar_senha_forte('Senha@Forte!')
        assert valida is False
        assert 'numero' in erro.lower()

    @pytest.mark.validators
    def test_senha_sem_especial(self):
        valida, erro = validar_senha_forte('SenhaForte123')
        assert valida is False
        assert 'especial' in erro.lower()

    @pytest.mark.validators
    def test_senha_muito_longa(self):
        senha = 'Aa1!' + 'x' * 200
        valida, erro = validar_senha_forte(senha)
        assert valida is False
        assert 'maximo' in erro.lower()

    @pytest.mark.validators
    def test_senha_exatamente_no_limite_minimo(self):
        """Senha com exatamente SENHA_MIN_LENGTH caracteres."""
        senha = 'Aa1!' + 'x' * (SENHA_MIN_LENGTH - 4)
        valida, _ = validar_senha_forte(senha)
        assert valida is True


# ==============================================================
# validar_usuario
# ==============================================================

class TestValidarUsuario:
    """Testes para validacao de nome de usuario."""

    @pytest.mark.validators
    def test_usuario_valido(self):
        valido, erro = validar_usuario('joao.silva')
        assert valido is True
        assert erro == ''

    @pytest.mark.validators
    def test_usuario_vazio(self):
        valido, erro = validar_usuario('')
        assert valido is False

    @pytest.mark.validators
    def test_usuario_none(self):
        valido, erro = validar_usuario(None)
        assert valido is False

    @pytest.mark.validators
    def test_usuario_curto(self):
        valido, erro = validar_usuario('ab')
        assert valido is False
        assert 'minimo' in erro.lower()

    @pytest.mark.validators
    def test_usuario_com_espaco(self):
        valido, erro = validar_usuario('joao silva')
        assert valido is False

    @pytest.mark.validators
    def test_usuario_comeca_com_numero(self):
        valido, erro = validar_usuario('1joao')
        assert valido is False
        assert 'letra' in erro.lower()

    @pytest.mark.validators
    def test_usuario_com_underscore(self):
        valido, _ = validar_usuario('joao_silva')
        assert valido is True

    @pytest.mark.validators
    def test_usuario_com_caracteres_especiais(self):
        valido, erro = validar_usuario('joao@silva')
        assert valido is False


# ==============================================================
# validar_email
# ==============================================================

class TestValidarEmail:
    """Testes para validacao de formato de email."""

    @pytest.mark.validators
    def test_email_valido(self):
        valido, erro = validar_email('user@hospital.com')
        assert valido is True
        assert erro == ''

    @pytest.mark.validators
    def test_email_sem_arroba(self):
        valido, erro = validar_email('userhospital.com')
        assert valido is False

    @pytest.mark.validators
    def test_email_sem_dominio(self):
        valido, erro = validar_email('user@')
        assert valido is False

    @pytest.mark.validators
    def test_email_vazio(self):
        valido, erro = validar_email('')
        assert valido is False

    @pytest.mark.validators
    def test_email_none(self):
        valido, erro = validar_email(None)
        assert valido is False

    @pytest.mark.validators
    def test_email_muito_longo(self):
        email = 'a' * 300 + '@hospital.com'
        valido, erro = validar_email(email)
        assert valido is False
        assert 'longo' in erro.lower() or 'maximo' in erro.lower()


# ==============================================================
# RateLimiter
# ==============================================================

class TestRateLimiter:
    """Testes para o controle de rate limiting."""

    @pytest.mark.auth
    def test_nao_bloqueado_inicialmente(self):
        limiter = RateLimiter()
        bloqueado, _ = limiter.esta_bloqueado('user_test_1')
        assert bloqueado is False

    @pytest.mark.auth
    def test_tentativas_restantes_iniciais(self):
        limiter = RateLimiter()
        restantes = limiter.tentativas_restantes('user_test_2')
        assert restantes == MAX_TENTATIVAS_LOGIN

    @pytest.mark.auth
    def test_bloqueio_apos_max_tentativas(self):
        limiter = RateLimiter()
        usuario = 'user_test_block'
        for _ in range(MAX_TENTATIVAS_LOGIN):
            limiter.registrar_tentativa(usuario, sucesso=False)

        bloqueado, segundos = limiter.esta_bloqueado(usuario)
        assert bloqueado is True
        assert segundos is not None
        assert segundos > 0

    @pytest.mark.auth
    def test_login_sucesso_limpa_tentativas(self):
        limiter = RateLimiter()
        usuario = 'user_test_clear'
        # Registra algumas falhas
        for _ in range(3):
            limiter.registrar_tentativa(usuario, sucesso=False)

        # Login bem sucedido
        limiter.registrar_tentativa(usuario, sucesso=True)

        restantes = limiter.tentativas_restantes(usuario)
        assert restantes == MAX_TENTATIVAS_LOGIN

    @pytest.mark.auth
    def test_tentativas_decrementam(self):
        limiter = RateLimiter()
        usuario = 'user_test_dec'
        limiter.registrar_tentativa(usuario, sucesso=False)
        limiter.registrar_tentativa(usuario, sucesso=False)
        restantes = limiter.tentativas_restantes(usuario)
        assert restantes == MAX_TENTATIVAS_LOGIN - 2
