import psycopg2
try:
    conn = psycopg2.connect('dbname=postgres user=postgres password=postgres host=localhost')
    cur = conn.cursor()
    cur.execute("SELECT pg_get_viewdef('vw_painel33_autorizacoes', true)")
    print(cur.fetchone()[0])
    conn.close()
except Exception as e:
    print(e)
