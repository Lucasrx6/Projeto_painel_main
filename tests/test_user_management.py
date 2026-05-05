"""
Testes unitarios para validadores do modulo backend.user_management.

Cobertura:
- validar_email
- sanitizar_campos (whitelist)
- validar_nome_painel (SQL injection prevention)
- validar_id
- validar_campo_editavel
"""
import pytest
from backend.user_management import (
    validar_email,
    sanitizar_campos,
    validar_nome_painel,
    validar_id,
    validar_campo_editavel,
    sanitizar_string,
    CAMPOS_EDITAVEIS,
    CAMPO_MAX_LENGTH,
    OBSERVACOES_MAX_LENGTH,
)


class TestValidarEmailUM:
    @pytest.mark.validators
    def test_email_valido(self):
        valido, _ = validar_email('user@hospital.com.br')
        assert valido is True

    @pytest.mark.validators
    def test_email_invalido(self):
        valido, _ = validar_email('sem-arroba.com')
        assert valido is False

    @pytest.mark.validators
    def test_email_vazio(self):
        valido, _ = validar_email('')
        assert valido is False

    @pytest.mark.validators
    def test_email_none(self):
        valido, _ = validar_email(None)
        assert valido is False


class TestSanitizarCampos:
    @pytest.mark.validators
    def test_filtra_campos_invalidos(self):
        dados = {
            'email': 'novo@test.com',
            'senha_hash': 'tentativa_sql_injection',
            'nome_completo': 'Joao'
        }
        result = sanitizar_campos(dados)
        assert 'email' in result
        assert 'nome_completo' in result
        assert 'senha_hash' not in result

    @pytest.mark.validators
    def test_trunca_observacoes(self):
        dados = {'observacoes': 'x' * 2000}
        result = sanitizar_campos(dados)
        assert len(result['observacoes']) == OBSERVACOES_MAX_LENGTH

    @pytest.mark.validators
    def test_trunca_campos_normais(self):
        dados = {'email': 'a' * 500 + '@test.com'}
        result = sanitizar_campos(dados)
        assert len(result['email']) <= CAMPO_MAX_LENGTH

    @pytest.mark.validators
    def test_dict_vazio(self):
        result = sanitizar_campos({})
        assert result == {}

    @pytest.mark.validators
    def test_input_invalido(self):
        result = sanitizar_campos('nao_e_dict')
        assert result == {}

    @pytest.mark.validators
    def test_todos_campos_editaveis_aceitos(self):
        dados = {campo: 'valor' for campo in CAMPOS_EDITAVEIS}
        result = sanitizar_campos(dados)
        for campo in CAMPOS_EDITAVEIS:
            assert campo in result


class TestValidarNomePainel:
    @pytest.mark.validators
    def test_painel_valido(self):
        assert validar_nome_painel('painel2') is True

    @pytest.mark.validators
    def test_painel_com_underscore(self):
        assert validar_nome_painel('painel_especial') is True

    @pytest.mark.validators
    def test_sql_injection_attempt(self):
        assert validar_nome_painel("'; DROP TABLE usuarios;--") is False

    @pytest.mark.validators
    def test_painel_vazio(self):
        assert validar_nome_painel('') is False

    @pytest.mark.validators
    def test_painel_muito_longo(self):
        assert validar_nome_painel('x' * 60) is False

    @pytest.mark.validators
    def test_painel_none(self):
        assert validar_nome_painel(None) is False

    @pytest.mark.validators
    def test_painel_com_espacos(self):
        assert validar_nome_painel('painel 2') is False


class TestValidarId:
    @pytest.mark.validators
    def test_id_valido(self):
        assert validar_id(1) == 1

    @pytest.mark.validators
    def test_id_string_numerica(self):
        assert validar_id('42') == 42

    @pytest.mark.validators
    def test_id_zero(self):
        assert validar_id(0) is None

    @pytest.mark.validators
    def test_id_negativo(self):
        assert validar_id(-5) is None

    @pytest.mark.validators
    def test_id_none(self):
        assert validar_id(None) is None

    @pytest.mark.validators
    def test_id_string_invalida(self):
        assert validar_id('abc') is None


class TestValidarCampoEditavel:
    @pytest.mark.validators
    def test_campo_valido(self):
        assert validar_campo_editavel('email') is True

    @pytest.mark.validators
    def test_campo_invalido(self):
        assert validar_campo_editavel('senha_hash') is False

    @pytest.mark.validators
    def test_campo_sql_injection(self):
        assert validar_campo_editavel("id; DROP TABLE") is False

    @pytest.mark.validators
    def test_campo_none(self):
        assert validar_campo_editavel(None) is False


class TestSanitizarString:
    @pytest.mark.validators
    def test_string_normal(self):
        assert sanitizar_string('  hello  ') == 'hello'

    @pytest.mark.validators
    def test_string_longa_truncada(self):
        result = sanitizar_string('x' * 500, max_length=100)
        assert len(result) == 100

    @pytest.mark.validators
    def test_input_nao_string(self):
        assert sanitizar_string(123) == ''
