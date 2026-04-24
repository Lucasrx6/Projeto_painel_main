import psycopg2

def sync_view():
    try:
        # Connect to local dev db
        conn_local = psycopg2.connect('dbname=postgres user=postgres password=postgres host=localhost')
        cur_local = conn_local.cursor()
        
        # Get the view definition
        print("Fetching view definition from localhost...")
        cur_local.execute("SELECT pg_get_viewdef('vw_painel33_autorizacoes', true)")
        view_def = cur_local.fetchone()[0]
        conn_local.close()
        
        print("View definition fetched successfully.")
        
        # Connect to production db
        conn_prod = psycopg2.connect('dbname=postgres user=postgres password=postgres host=172.16.1.75')
        cur_prod = conn_prod.cursor()
        
        # Create the view
        print("Executing CREATE OR REPLACE VIEW on 172.16.1.75...")
        create_sql = f"CREATE OR REPLACE VIEW vw_painel33_autorizacoes AS\n{view_def}"
        cur_prod.execute(create_sql)
        conn_prod.commit()
        conn_prod.close()
        
        print("Success! The view vw_painel33_autorizacoes has been created on the production server.")
        
    except Exception as e:
        print(f"Error: {e}")

if __name__ == "__main__":
    sync_view()
