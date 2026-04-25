import sys
sys.path.insert(0, '.')
from backend.database import get_db_connection

conn = get_db_connection()
if not conn:
    print("ERRO: Sem conexao com banco")
    sys.exit(1)

cur = conn.cursor()

# Verifica tabela historico_usuarios
cur.execute("""
    SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_name = 'historico_usuarios'
    )
""")
existe = cur.fetchone()[0]
print(f"Tabela historico_usuarios existe: {existe}")

if not existe:
    print("\n>>> PROBLEMA ENCONTRADO! Tabela historico_usuarios NAO existe.")
    print(">>> Isso causa o erro de 'Erro de conexao com o banco' no admin reset.")

# Testa a funcao resetar_senha diretamente
try:
    from backend.user_management import resetar_senha
    # Testa com ID invalido so pra ver se o fluxo funciona
    resultado = resetar_senha(99999, "TesteSenha@123", 1)
    print(f"\nTeste resetar_senha: {resultado}")
except Exception as e:
    print(f"\nErro ao testar resetar_senha: {e}")

cur.close()
conn.close()
