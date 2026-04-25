"""
Correcao: Adiciona coluna atualizado_por na tabela usuarios (se nao existir)
"""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from backend.database import get_db_connection

conn = get_db_connection()
if not conn:
    print("ERRO: Sem conexao"); sys.exit(1)

cur = conn.cursor()

colunas = [
    ("atualizado_por", "INTEGER"),
    ("atualizado_em", "TIMESTAMP"),
]

for nome, tipo in colunas:
    cur.execute("""
        SELECT column_name FROM information_schema.columns
        WHERE table_name = 'usuarios' AND column_name = %s
    """, (nome,))
    if cur.fetchone():
        print(f"  Coluna '{nome}' ja existe")
    else:
        cur.execute(f"ALTER TABLE usuarios ADD COLUMN {nome} {tipo}")
        print(f"  Coluna '{nome}' adicionada")

conn.commit()
cur.close()
conn.close()
print("\nCorrecao concluida!")
