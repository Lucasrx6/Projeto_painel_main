# -*- coding: utf-8 -*-
import psycopg2
from psycopg2.extras import RealDictCursor
from backend.notificador_utils import get_db_config
from .config import logger


def _get_conn():
    return psycopg2.connect(**get_db_config())


def buscar_dados(inicio, fim):
    """Busca todos os dados do periodo [inicio, fim)."""
    conn = _get_conn()
    try:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:

            cur.execute("""
                SELECT
                    COUNT(*) AS total,
                    COUNT(*) FILTER (WHERE status = 'concluido')  AS concluidos,
                    COUNT(*) FILTER (WHERE status = 'cancelado')  AS cancelados,
                    COUNT(*) FILTER (WHERE status IN ('aguardando','aceito','em_transporte')) AS em_aberto,
                    COUNT(*) FILTER (WHERE prioridade = 'urgente') AS urgentes,
                    ROUND(AVG(CASE WHEN dt_aceite IS NOT NULL
                        THEN EXTRACT(EPOCH FROM (dt_aceite - criado_em)) / 60 END)::numeric, 1) AS media_aceite_min,
                    ROUND(AVG(CASE WHEN dt_conclusao IS NOT NULL
                        THEN EXTRACT(EPOCH FROM (dt_conclusao - criado_em)) / 60 END)::numeric, 1) AS media_total_min
                FROM padioleiro_chamados WHERE criado_em >= %s AND criado_em < %s
            """, (inicio, fim))
            resumo = dict(cur.fetchone() or {})

            cur.execute("""
                SELECT
                    COALESCE(padioleiro_nome,'(nao atribuido)') AS padioleiro,
                    COUNT(*) AS total,
                    COUNT(*) FILTER (WHERE status='concluido')   AS concluidos,
                    COUNT(*) FILTER (WHERE status='cancelado')   AS cancelados,
                    COUNT(*) FILTER (WHERE prioridade='urgente') AS urgentes,
                    ROUND(AVG(CASE WHEN dt_aceite IS NOT NULL
                        THEN EXTRACT(EPOCH FROM (dt_aceite - criado_em))/60 END)::numeric,1) AS media_aceite_min,
                    ROUND(AVG(CASE WHEN dt_inicio_transporte IS NOT NULL AND dt_aceite IS NOT NULL
                        THEN EXTRACT(EPOCH FROM (dt_inicio_transporte - dt_aceite))/60 END)::numeric,1) AS media_deslocamento_min,
                    ROUND(AVG(CASE WHEN dt_conclusao IS NOT NULL AND dt_inicio_transporte IS NOT NULL
                        THEN EXTRACT(EPOCH FROM (dt_conclusao - dt_inicio_transporte))/60 END)::numeric,1) AS media_transporte_min,
                    ROUND(AVG(CASE WHEN dt_conclusao IS NOT NULL
                        THEN EXTRACT(EPOCH FROM (dt_conclusao - criado_em))/60 END)::numeric,1) AS media_total_min
                FROM padioleiro_chamados WHERE criado_em >= %s AND criado_em < %s
                GROUP BY padioleiro_nome ORDER BY total DESC
            """, (inicio, fim))
            por_padioleiro = [dict(r) for r in cur.fetchall()]

            cur.execute("""
                SELECT
                    COALESCE(setor_origem_nome,'(sem setor)') AS setor,
                    COUNT(*) AS total,
                    COUNT(*) FILTER (WHERE status='concluido')   AS concluidos,
                    COUNT(*) FILTER (WHERE status='cancelado')   AS cancelados,
                    COUNT(*) FILTER (WHERE prioridade='urgente') AS urgentes
                FROM padioleiro_chamados WHERE criado_em >= %s AND criado_em < %s
                GROUP BY setor_origem_nome ORDER BY total DESC LIMIT 20
            """, (inicio, fim))
            por_setor = [dict(r) for r in cur.fetchall()]

            cur.execute("""
                SELECT
                    EXTRACT(HOUR FROM criado_em)::int AS hora,
                    COUNT(*) AS total,
                    COUNT(*) FILTER (WHERE status='concluido')   AS concluidos,
                    COUNT(*) FILTER (WHERE prioridade='urgente') AS urgentes
                FROM padioleiro_chamados WHERE criado_em >= %s AND criado_em < %s
                GROUP BY 1 ORDER BY 1
            """, (inicio, fim))
            por_hora = [dict(r) for r in cur.fetchall()]

            cur.execute("""
                SELECT
                    DATE(criado_em) AS data,
                    COUNT(*) AS total,
                    COUNT(*) FILTER (WHERE status='concluido') AS concluidos,
                    COUNT(*) FILTER (WHERE status='cancelado') AS cancelados,
                    ROUND(AVG(CASE WHEN dt_conclusao IS NOT NULL
                        THEN EXTRACT(EPOCH FROM (dt_conclusao - criado_em))/60 END)::numeric,1) AS media_total_min
                FROM padioleiro_chamados
                WHERE DATE(criado_em) >= %s - INTERVAL '6 days' AND DATE(criado_em) <= %s
                GROUP BY DATE(criado_em) ORDER BY 1
            """, (fim.date(), fim.date()))
            tendencia_7d = [dict(r) for r in cur.fetchall()]

            cur.execute("""
                SELECT
                    id, COALESCE(tipo_movimento_nome,'--') AS tipo,
                    nm_paciente, leito_origem, setor_origem_nome, destino_nome,
                    prioridade, status, solicitante_nome,
                    COALESCE(padioleiro_nome,'--') AS padioleiro, observacao,
                    TO_CHAR(criado_em,'HH24:MI')            AS criado_em,
                    TO_CHAR(dt_aceite,'HH24:MI')            AS dt_aceite,
                    TO_CHAR(dt_inicio_transporte,'HH24:MI') AS dt_inicio_transporte,
                    TO_CHAR(dt_conclusao,'HH24:MI')         AS dt_conclusao,
                    TO_CHAR(dt_cancelamento,'HH24:MI')      AS dt_cancelamento,
                    motivo_cancelamento,
                    CASE WHEN dt_aceite IS NOT NULL
                         THEN ROUND(EXTRACT(EPOCH FROM (dt_aceite - criado_em))/60)::int END AS t_aceite_min,
                    CASE WHEN dt_inicio_transporte IS NOT NULL AND dt_aceite IS NOT NULL
                         THEN ROUND(EXTRACT(EPOCH FROM (dt_inicio_transporte - dt_aceite))/60)::int END AS t_deslocamento_min,
                    CASE WHEN dt_conclusao IS NOT NULL AND dt_inicio_transporte IS NOT NULL
                         THEN ROUND(EXTRACT(EPOCH FROM (dt_conclusao - dt_inicio_transporte))/60)::int END AS t_transporte_min,
                    CASE WHEN dt_conclusao IS NOT NULL
                         THEN ROUND(EXTRACT(EPOCH FROM (dt_conclusao - criado_em))/60)::int
                         WHEN status='cancelado' AND dt_cancelamento IS NOT NULL
                         THEN ROUND(EXTRACT(EPOCH FROM (dt_cancelamento - criado_em))/60)::int END AS t_total_min
                FROM padioleiro_chamados WHERE criado_em >= %s AND criado_em < %s
                ORDER BY criado_em DESC
            """, (inicio, fim))
            todos_hoje = [dict(r) for r in cur.fetchall()]

            cur.execute("""
                SELECT id, nm_paciente, setor_origem_nome, destino_nome,
                    padioleiro_nome, solicitante_nome,
                    TO_CHAR(criado_em,'HH24:MI')       AS hora_criacao,
                    TO_CHAR(dt_cancelamento,'HH24:MI') AS hora_cancelamento,
                    motivo_cancelamento
                FROM padioleiro_chamados
                WHERE criado_em >= %s AND criado_em < %s AND status = 'cancelado'
                ORDER BY dt_cancelamento DESC
            """, (inicio, fim))
            cancelados = [dict(r) for r in cur.fetchall()]

        return resumo, por_padioleiro, por_setor, por_hora, tendencia_7d, todos_hoje, cancelados
    finally:
        conn.close()
