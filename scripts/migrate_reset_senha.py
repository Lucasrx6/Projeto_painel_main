"""
Migração: Adiciona colunas de reset de senha na tabela usuarios
- force_reset_senha: boolean para forçar troca no próximo login
- reset_pin_hash: hash do PIN de 4 dígitos
- reset_pin_expira: timestamp de expiração do PIN
"""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from backend.database import get_db_connection

def migrate():
    conn = get_db_connection()
    if not conn:
        print("Erro: Não foi possível conectar ao banco de dados")
        sys.exit(1)

    cur = conn.cursor()

    colunas = [
        ("force_reset_senha", "BOOLEAN DEFAULT FALSE"),
        ("reset_pin_hash", "VARCHAR(255)"),
        ("reset_pin_expira", "TIMESTAMP"),
        ("atualizado_por", "INTEGER"),
        ("atualizado_em", "TIMESTAMP"),
    ]

    for nome, tipo in colunas:
        cur.execute("""
            SELECT column_name FROM information_schema.columns
            WHERE table_name = 'usuarios' AND column_name = %s
        """, (nome,))

        if cur.fetchone():
            print(f"  Coluna '{nome}' já existe — pulando")
        else:
            cur.execute(f"ALTER TABLE usuarios ADD COLUMN {nome} {tipo}")
            print(f"  Coluna '{nome}' adicionada com sucesso")

    conn.commit()
    cur.close()
    conn.close()
    print("\nMigração concluída!")

if __name__ == '__main__':
    migrate()
