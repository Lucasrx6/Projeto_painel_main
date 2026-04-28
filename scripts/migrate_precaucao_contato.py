"""
Migração: cria tabela sentir_agir_precaucao_contato
Pacientes marcados nessa tabela são removidos da fila de visitas.
Executar uma única vez em produção.
"""
import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from backend.database import get_db_connection

DDL = """
CREATE TABLE IF NOT EXISTS sentir_agir_precaucao_contato (
    nr_atendimento  VARCHAR(50) PRIMARY KEY,
    nm_paciente     VARCHAR(200),
    leito           VARCHAR(50),
    marcado_por     VARCHAR(100) NOT NULL,
    marcado_em      TIMESTAMP   NOT NULL DEFAULT NOW()
);
"""

if __name__ == '__main__':
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute(DDL)
    conn.commit()
    cursor.close()
    conn.close()
    print('Migração concluída: tabela sentir_agir_precaucao_contato criada.')
