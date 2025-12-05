import psycopg2
from psycopg2.extras import RealDictCursor
import os
from dotenv import load_dotenv

load_dotenv()

DB_CONFIG = {
    'host': os.getenv('DB_HOST', 'localhost'),
    'database': os.getenv('DB_NAME', 'postgres'),
    'user': os.getenv('DB_USER', 'postgres'),
    'password': os.getenv('DB_PASSWORD', 'postgres'),
    'port': os.getenv('DB_PORT', '5432')
}


def get_db_connection():
    """Cria conexão com o banco de dados"""
    try:
        conn = psycopg2.connect(**DB_CONFIG)
        return conn
    except Exception as e:
        print(f"❌ Erro ao conectar ao banco: {e}")
        return None


def init_db():
    """Inicializa o banco de dados criando as tabelas necessárias"""
    conn = get_db_connection()
    if not conn:
        print("❌ Não foi possível conectar ao banco para inicialização")
        return False

    try:
        cursor = conn.cursor()

        # Cria tabela de usuários
        cursor.execute("""
                       CREATE TABLE IF NOT EXISTS usuarios
                       (
                           id
                           SERIAL
                           PRIMARY
                           KEY,
                           usuario
                           VARCHAR
                       (
                           50
                       ) UNIQUE NOT NULL,
                           senha_hash VARCHAR
                       (
                           255
                       ) NOT NULL,
                           email VARCHAR
                       (
                           100
                       ) UNIQUE NOT NULL,
                           is_admin BOOLEAN DEFAULT FALSE,
                           criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                           ultimo_acesso TIMESTAMP
                           )
                       """)

        # Verifica se o usuário admin existe
        cursor.execute("SELECT COUNT(*) FROM usuarios WHERE usuario = 'postgres'")
        admin_exists = cursor.fetchone()[0] > 0

        if not admin_exists:
            # Cria usuário admin padrão
            import bcrypt
            senha_hash = bcrypt.hashpw('postgres'.encode('utf-8'), bcrypt.gensalt()).decode('utf-8')

            cursor.execute("""
                           INSERT INTO usuarios (usuario, senha_hash, email, is_admin)
                           VALUES (%s, %s, %s, %s)
                           """, ('postgres', senha_hash, 'admin@sistema.com', True))

            print("✅ Usuário admin criado: postgres/postgres")

        conn.commit()
        cursor.close()
        conn.close()

        print("✅ Banco de dados inicializado com sucesso")
        return True

    except Exception as e:
        print(f"❌ Erro ao inicializar banco de dados: {e}")
        if conn:
            conn.rollback()
            conn.close()
        return False