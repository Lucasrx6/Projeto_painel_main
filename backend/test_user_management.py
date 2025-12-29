"""
Script de Teste - Gestão de Usuários
Execute da raiz do projeto: python backend/test_user_management.py
"""

# Import corrigido (sem o prefixo 'backend.')
from user_management import (
    listar_usuarios,
    obter_usuario,
    obter_estatisticas,
    obter_permissoes,
    obter_historico,
    editar_usuario,
    resetar_senha,
    adicionar_permissao,
    remover_permissao,
    alterar_status_usuario
)

def print_separador(titulo):
    print("\n" + "=" * 60)
    print(f"  {titulo}")
    print("=" * 60)

def print_resultado(resultado):
    if resultado.get('success'):
        print("✅ Sucesso!")
        # Remove 'success' para exibir o resto
        dados = {k: v for k, v in resultado.items() if k != 'success'}
        if dados:
            import json
            print(json.dumps(dados, indent=2, default=str))
    else:
        print(f"❌ Erro: {resultado.get('error')}")

# ==================== TESTES ====================

print_separador("TESTE 1: Listar Todos os Usuários")
resultado = listar_usuarios()
print_resultado(resultado)

print_separador("TESTE 2: Obter Usuário Específico (ID=1)")
resultado = obter_usuario(1)
print_resultado(resultado)

print_separador("TESTE 3: Estatísticas Gerais")
resultado = obter_estatisticas()
print_resultado(resultado)

print_separador("TESTE 4: Obter Permissões do Usuário (ID=1)")
resultado = obter_permissoes(1)
print_resultado(resultado)

print_separador("TESTE 5: Obter Histórico do Usuário (ID=1)")
resultado = obter_historico(1, limite=10)
print_resultado(resultado)

print_separador("TESTE 6: Editar Usuário (ID=1)")
resultado = editar_usuario(
    usuario_id=1,
    dados={
        'nome_completo': 'Administrador do Sistema',
        'cargo': 'Administrador'
    },
    admin_id=1
)
print_resultado(resultado)

print_separador("TESTE 7: Adicionar Permissão (painel2 para usuário 1)")
resultado = adicionar_permissao(
    usuario_id=1,
    painel_nome='painel2',
    admin_id=1
)
print_resultado(resultado)

print_separador("TESTE 8: Listar Permissões Após Adicionar")
resultado = obter_permissoes(1)
print_resultado(resultado)

print("\n" + "=" * 60)
print("  ✅ TESTES CONCLUÍDOS!")
print("=" * 60)
print("\n💡 Se todos passaram, podemos ir para ETAPA 3!\n")