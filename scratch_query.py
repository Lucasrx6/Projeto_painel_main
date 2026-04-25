import os
import sys
from backend.database import get_db_connection
from psycopg2.extras import RealDictCursor

conn = get_db_connection()
cursor = conn.cursor(cursor_factory=RealDictCursor)
cursor.execute("SELECT id, nome FROM padioleiro_tipos_movimento ORDER BY id")
for row in cursor.fetchall():
    print(dict(row))
cursor.execute("SELECT id, nome, tipo_movimento_id FROM padioleiro_destinos ORDER BY id")
print("Destinos:")
for row in cursor.fetchall():
    print(dict(row))
cursor.close()
conn.close()
