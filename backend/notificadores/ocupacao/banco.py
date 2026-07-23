# -*- coding: utf-8 -*-
import psycopg2
from psycopg2.extras import RealDictCursor
from backend.notificador_utils import get_db_config
from .config import logger


def _get_conn():
    return psycopg2.connect(**get_db_config())


def _query(conn, sql):
    with conn.cursor(cursor_factory=RealDictCursor) as cur:
        cur.execute(sql)
        rows = cur.fetchall()
        cols = [desc.name for desc in cur.description] if cur.description else []
    return cols, [dict(r) for r in rows]


def buscar_dados():
    """Consulta as views de ocupacao e retorna (dashboard, cols_setor, setores, cols_pac, pacientes)."""
    conn = _get_conn()
    try:
        _, dash_rows = _query(conn, "SELECT * FROM vw_ocupacao_dashboard")
        dashboard = dash_rows[0] if dash_rows else {}
        cols_setor, setores = _query(conn, "SELECT * FROM vw_ocupacao_por_setor")
        cols_pac, pacientes = _query(conn, "SELECT * FROM vw_pacientes_internados ORDER BY 1, 2")
        return dashboard, cols_setor, setores, cols_pac, pacientes
    finally:
        conn.close()
