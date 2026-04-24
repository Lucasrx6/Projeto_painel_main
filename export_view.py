import psycopg2
import sys

def export_view_to_file():
    try:
        # Connect to local dev db
        conn_local = psycopg2.connect('dbname=postgres user=postgres password=postgres host=localhost')
        cur_local = conn_local.cursor()
        
        # Get the view definition
        print("Fetching view definition from localhost...")
        cur_local.execute("SELECT pg_get_viewdef('vw_painel33_autorizacoes', true)")
        view_def = cur_local.fetchone()[0]
        conn_local.close()
        
        # Write the script for the production server
        prod_script = f"""import psycopg2

def create_view():
    try:
        conn = psycopg2.connect('dbname=postgres user=postgres password=postgres host=localhost')
        cur = conn.cursor()
        
        sql = \"\"\"CREATE OR REPLACE VIEW vw_painel33_autorizacoes AS
{view_def}\"\"\"
        
        cur.execute(sql)
        conn.commit()
        conn.close()
        print("View vw_painel33_autorizacoes criada com sucesso no servidor de producao!")
    except Exception as e:
        print(f"Erro ao criar view: {{e}}")

if __name__ == '__main__':
    create_view()
"""
        with open(r'\\172.16.1.75\c$\Projeto_Painel_Main\scripts\criar_view_painel33.py', 'w', encoding='utf-8') as f:
            f.write(prod_script)
            
        print("Script salvo em \\\\172.16.1.75\\c$\\Projeto_Painel_Main\\scripts\\criar_view_painel33.py")
        
    except Exception as e:
        print(f"Error: {e}")

if __name__ == "__main__":
    export_view_to_file()
