import os
import sys

# Adiciona o diretório raiz ao path para importar backend
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

try:
    from backend.database import get_db_connection

    conn = get_db_connection()
    cursor = conn.cursor()
    
    cursor.execute("SELECT id FROM hub_servicos WHERE nome = 'Gestão de Chamados de TI'")
    row = cursor.fetchone()
    
    if row:
        cursor.execute("UPDATE hub_servicos SET url_destino = '/paineis/painel28/gestao-chamados.html' WHERE id = %s", (row[0],))
        print("Sucesso: Atualizado")
    else:
        cursor.execute("""
            INSERT INTO hub_servicos (nome, descricao, icone, cor, url_destino, tipo, ordem, ativo, requer_login)
            VALUES (
                'Gestão de Chamados de TI', 
                'Abertura e monitoramento de chamados emergenciais', 
                'fas fa-headset', 
                '#17a2b8', 
                '/paineis/painel28/gestao-chamados.html', 
                'painel', 
                2, 
                TRUE, 
                TRUE
            )
        """)
        print("Sucesso: Inserido")
    
    conn.commit()
    cursor.close()
    conn.close()
except Exception as e:
    print(f"Error: {e}")
