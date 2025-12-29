import psycopg2
from dotenv import load_dotenv
import os
import sys

# Carrega variáveis de ambiente
load_dotenv()

# Configurações do banco
DB_CONFIG = {
    'host': os.getenv('DB_HOST', 'localhost'),
    'database': os.getenv('DB_NAME', 'postgres'),
    'user': os.getenv('DB_USER', 'postgres'),
    'password': os.getenv('DB_PASSWORD','postgres'),
    'port': os.getenv('DB_PORT', '5432')
}


def print_header():
    """Imprime cabeçalho do teste"""
    print("=" * 60)
    print("🔍 TESTE DE CONEXÃO COM POSTGRESQL")
    print("=" * 60)
    print()


def print_config():
    """Imprime configurações (sem senha)"""
    print("📋 Configurações:")
    print(f"   Host........: {DB_CONFIG['host']}")
    print(f"   Database....: {DB_CONFIG['database']}")
    print(f"   User........: {DB_CONFIG['user']}")
    print(f"   Password....: {'*' * len(DB_CONFIG['password']) if DB_CONFIG['password'] else 'NÃO CONFIGURADA'}")
    print(f"   Port........: {DB_CONFIG['port']}")
    print()


def test_connection():
    """Testa conexão com o banco"""
    print("🔄 Tentando conectar...")

    try:
        # Verifica se senha foi configurada
        if not DB_CONFIG['password']:
            print("❌ ERRO: Senha não configurada!")
            print("   Configure DB_PASSWORD no arquivo .env")
            return False

        # Tenta conectar
        conn = psycopg2.connect(**DB_CONFIG)
        print("✅ Conexão estabelecida com sucesso!")
        print()

        # Testa queries básicas
        cursor = conn.cursor()

        # Versão do PostgreSQL
        print("📊 Informações do Banco:")
        cursor.execute("SELECT version();")
        version = cursor.fetchone()[0]
        print(f"   PostgreSQL: {version.split(',')[0]}")

        # Data/hora do servidor
        cursor.execute("SELECT NOW();")
        now = cursor.fetchone()[0]
        print(f"   Data/Hora.: {now}")

        # Verifica se tabela existe
        cursor.execute("""
                       SELECT EXISTS (SELECT
                                      FROM information_schema.tables
                                      WHERE table_schema = 'public'
                                        AND table_name = 'evolucao_turno');
                       """)
        table_exists = cursor.fetchone()[0]

        print()
        print("🗂️  Tabela evolucao_turno:")

        if table_exists:
            print("   Status.....: ✅ Existe")

            # Conta registros
            cursor.execute("SELECT COUNT(*) FROM evolucao_turno;")
            total = cursor.fetchone()[0]
            print(f"   Registros..: {total}")

            if total > 0:
                # Estatísticas rápidas
                cursor.execute("""
                               SELECT COUNT(DISTINCT setor)      as setores,
                                      COUNT(DISTINCT data_turno) as datas,
                                      COUNT(*)                      FILTER (WHERE evol_medico = 'S') as evolucoes_completas
                               FROM evolucao_turno;
                               """)
                stats = cursor.fetchone()
                print(f"   Setores....: {stats[0]}")
                print(f"   Datas......: {stats[1]}")
                print(f"   Evoluções..: {stats[2]} completas")

                # Mostra último registro
                cursor.execute("""
                               SELECT nr_atendimento, nm_paciente, setor, data_turno
                               FROM evolucao_turno
                               ORDER BY dt_carga DESC LIMIT 1;
                               """)
                ultimo = cursor.fetchone()
                print()
                print("   Último registro:")
                print(f"      Atendimento: {ultimo[0]}")
                print(f"      Paciente...: {ultimo[1]}")
                print(f"      Setor......: {ultimo[2]}")
                print(f"      Data.......: {ultimo[3]}")
            else:
                print("   ⚠️  Tabela vazia! Execute o script SQL com dados de teste.")
        else:
            print("   Status.....: ❌ Não existe")
            print("   ⚠️  Execute o script SQL para criar a tabela!")

        cursor.close()
        conn.close()

        print()
        print("=" * 60)
        print("🎉 TESTE CONCLUÍDO COM SUCESSO!")
        print("=" * 60)
        print()
        print("✅ Próximos passos:")
        print("   1. Execute: python app.py")
        print("   2. Acesse: http://localhost:5000")
        print()

        return True

    except psycopg2.OperationalError as e:
        print("❌ ERRO DE CONEXÃO!")
        print(f"   {e}")
        print()
        print("💡 Possíveis causas:")
        print("   1. PostgreSQL não está rodando")
        print("   2. Credenciais incorretas (verifique .env)")
        print("   3. Banco de dados não existe")
        print("   4. Firewall bloqueando conexão")
        print()
        print("🔧 Como resolver:")
        print("   • Windows: Verifique em Serviços se PostgreSQL está ativo")
        print("   • Linux: sudo systemctl start postgresql")
        print("   • Verifique o arquivo .env")
        return False

    except psycopg2.Error as e:
        print(f"❌ ERRO NO BANCO: {e}")
        return False

    except Exception as e:
        print(f"❌ ERRO INESPERADO: {e}")
        return False


def main():
    """Função principal"""
    print_header()
    print_config()

    success = test_connection()

    sys.exit(0 if success else 1)


if __name__ == "__main__":
    main()