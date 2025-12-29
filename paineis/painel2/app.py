from flask import Flask, jsonify, send_from_directory
from flask_cors import CORS
import psycopg2
from psycopg2.extras import RealDictCursor
import os
from datetime import datetime
from dotenv import load_dotenv

# Carrega variáveis de ambiente
load_dotenv()

app = Flask(__name__, static_folder='.', template_folder='.')
CORS(app)

# Configurações do banco de dados
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


@app.route('/')
def index():
    """Página principal"""
    return send_from_directory('.', 'index.html')


@app.route('/<path:path>')
def servir_arquivos(path):
    """Serve arquivos estáticos (CSS, JS)"""
    return send_from_directory('.', path)


@app.route('/api/evolucoes', methods=['GET'])
def get_evolucoes():
    """Retorna registros dos últimos 3 dias"""
    conn = get_db_connection()
    if not conn:
        return jsonify({
            'success': False,
            'error': 'Erro de conexão com o banco'
        }), 500

    try:
        cursor = conn.cursor(cursor_factory=RealDictCursor)

        # Consulta simples: últimos 3 dias apenas
        query = """
            SELECT *
            FROM evolucao_turno
            WHERE 1=1
            ORDER BY data_turno DESC
        """

        cursor.execute(query)
        evolucoes = cursor.fetchall()

        cursor.close()
        conn.close()

        return jsonify({
            'success': True,
            'data': evolucoes,
            'total': len(evolucoes),
            'timestamp': datetime.now().isoformat()
        })

    except Exception as e:
        print(f"❌ Erro ao buscar dados: {e}")
        if conn:
            conn.close()
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500


if __name__ == '__main__':
    print("\n" + "=" * 60)
    print("🚀 SERVIDOR INICIADO")
    print("=" * 60)
    print("📍 Acesse: http://localhost:5000")
    print("📊 API: http://localhost:5000/api/evolucoes")
    print("⏱️  Consulta: Últimos 3 dias")
    print("=" * 60 + "\n")

    app.run(debug=True, host='0.0.0.0', port=5000)