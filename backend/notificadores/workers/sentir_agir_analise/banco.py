# -*- coding: utf-8 -*-
import json
import psycopg2
from psycopg2.extras import RealDictCursor
from datetime import datetime, date
from decimal import Decimal
from .config import logger, DB_CONFIG, GROQ_MODEL, PERIODO_SEMANAL_DIAS


def _get_conn():
    return psycopg2.connect(**DB_CONFIG)


def _serial(val):
    if isinstance(val, (datetime, date)):
        return val.isoformat()
    if isinstance(val, Decimal):
        return float(val)
    return val


def _serial_row(row):
    return {k: _serial(v) for k, v in row.items()}


def _extrair_obs_item(desc):
    if not desc:
        return None
    if ' | Observacao do item: ' in desc:
        return desc.split(' | Observacao do item: ', 1)[1].strip()
    return None


def garantir_tabela():
    """Cria sentir_agir_analises_ia se nao existir."""
    sql = """
    CREATE TABLE IF NOT EXISTS sentir_agir_analises_ia (
        id             SERIAL PRIMARY KEY,
        data_analise   DATE NOT NULL UNIQUE,
        analise_texto  TEXT NOT NULL,
        total_visitas  INTEGER DEFAULT 0,
        total_criticos INTEGER DEFAULT 0,
        total_atencao  INTEGER DEFAULT 0,
        total_setores  INTEGER DEFAULT 0,
        modelo         VARCHAR(100),
        gerado_em      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        gerado_por     VARCHAR(50) DEFAULT 'worker'
    );
    """
    conn = _get_conn()
    try:
        cur = conn.cursor()
        cur.execute(sql)
        conn.commit()
        cur.close()
        logger.info('Tabela sentir_agir_analises_ia verificada/criada.')
    finally:
        conn.close()


def garantir_tabela_categorias():
    """Cria sentir_agir_analises_categorias se nao existir."""
    sql = """
    CREATE TABLE IF NOT EXISTS sentir_agir_analises_categorias (
        id               SERIAL PRIMARY KEY,
        data_referencia  DATE NOT NULL UNIQUE,
        periodo_dias     INTEGER NOT NULL DEFAULT 7,
        analise_texto    TEXT NOT NULL,
        categorias_json  JSONB,
        total_tratativas INTEGER DEFAULT 0,
        total_categorias INTEGER DEFAULT 0,
        modelo           VARCHAR(100),
        gerado_em        TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        gerado_por       VARCHAR(50) DEFAULT 'worker'
    );
    """
    conn = _get_conn()
    try:
        cur = conn.cursor()
        cur.execute(sql)
        conn.commit()
        cur.close()
        logger.info('Tabela sentir_agir_analises_categorias verificada/criada.')
    finally:
        conn.close()


def ja_analisado(data_str):
    """Retorna True se ja existe analise diaria salva para a data."""
    conn = _get_conn()
    try:
        cur = conn.cursor()
        cur.execute('SELECT id FROM sentir_agir_analises_ia WHERE data_analise = %s', (data_str,))
        resultado = cur.fetchone()
        cur.close()
        return resultado is not None
    finally:
        conn.close()


def ja_analisado_categorias(data_referencia_str):
    """Retorna True se ja existe analise de categorias para a referencia."""
    conn = _get_conn()
    try:
        cur = conn.cursor()
        cur.execute('SELECT id FROM sentir_agir_analises_categorias WHERE data_referencia = %s', (data_referencia_str,))
        resultado = cur.fetchone()
        cur.close()
        return resultado is not None
    finally:
        conn.close()


def salvar_analise(data_str, analise_texto, totais):
    """Persiste a analise diaria no banco (upsert)."""
    conn = _get_conn()
    try:
        cur = conn.cursor()
        cur.execute("""
            INSERT INTO sentir_agir_analises_ia
                (data_analise, analise_texto, total_visitas, total_criticos,
                 total_atencao, total_setores, modelo, gerado_por)
            VALUES (%s, %s, %s, %s, %s, %s, %s, 'worker')
            ON CONFLICT (data_analise) DO UPDATE SET
                analise_texto  = EXCLUDED.analise_texto,
                total_visitas  = EXCLUDED.total_visitas,
                total_criticos = EXCLUDED.total_criticos,
                total_atencao  = EXCLUDED.total_atencao,
                total_setores  = EXCLUDED.total_setores,
                modelo         = EXCLUDED.modelo,
                gerado_em      = CURRENT_TIMESTAMP,
                gerado_por     = 'worker'
        """, (
            data_str, analise_texto,
            totais.get('total', 0), totais.get('criticos', 0),
            totais.get('atencao', 0), totais.get('total_setores', 0),
            GROQ_MODEL
        ))
        conn.commit()
        cur.close()
        logger.info('Analise de %s salva no banco.', data_str)
    finally:
        conn.close()


def salvar_analise_categorias(data_referencia_str, analise_texto, dados):
    """Persiste analise semanal de categorias (upsert)."""
    conn = _get_conn()
    try:
        cur = conn.cursor()
        cur.execute("""
            INSERT INTO sentir_agir_analises_categorias
                (data_referencia, periodo_dias, analise_texto, categorias_json,
                 total_tratativas, total_categorias, modelo, gerado_por)
            VALUES (%s, %s, %s, %s::jsonb, %s, %s, %s, 'worker')
            ON CONFLICT (data_referencia) DO UPDATE SET
                analise_texto    = EXCLUDED.analise_texto,
                categorias_json  = EXCLUDED.categorias_json,
                total_tratativas = EXCLUDED.total_tratativas,
                total_categorias = EXCLUDED.total_categorias,
                modelo           = EXCLUDED.modelo,
                gerado_em        = CURRENT_TIMESTAMP
        """, (
            data_referencia_str,
            dados.get('periodo_dias', PERIODO_SEMANAL_DIAS),
            analise_texto,
            json.dumps(dados.get('categorias', []), default=str),
            dados.get('total_tratativas', 0),
            dados.get('total_categorias', 0),
            GROQ_MODEL
        ))
        conn.commit()
        cur.close()
        logger.info('[semanal] Analise de categorias (%s) salva.', data_referencia_str)
    finally:
        conn.close()


def buscar_dados_dia(data_str):
    """Busca visitas do dia e retorna estrutura agrupada por setor. Retorna None se sem visitas."""
    conn = _get_conn()
    try:
        cur = conn.cursor(cursor_factory=RealDictCursor)
        cur.execute("""
            SELECT
                v.id AS visita_id,
                v.avaliacao_final,
                s.nome AS setor_nome,
                s.sigla AS setor_sigla,
                s.ordem AS setor_ordem,
                r.data_ronda,
                d.nome_visitante_1 || ' e ' || d.nome_visitante_2 AS dupla_nome,
                v.criado_em
            FROM sentir_agir_visitas v
            JOIN sentir_agir_rondas r ON r.id = v.ronda_id
            JOIN sentir_agir_setores s ON s.id = v.setor_id
            JOIN sentir_agir_duplas d ON d.id = r.dupla_id
            WHERE DATE(v.criado_em) = %s
              AND v.avaliacao_final != 'impossibilitada'
            ORDER BY COALESCE(s.ordem, 999), v.criado_em
        """, (data_str,))
        visitas = [_serial_row(r) for r in cur.fetchall()]

        if not visitas:
            cur.close()
            return None

        for v in visitas:
            cur.execute("""
                SELECT
                    i.descricao AS item_descricao,
                    c.nome AS categoria_nome,
                    a.resultado,
                    t.descricao_problema
                FROM sentir_agir_avaliacoes a
                JOIN sentir_agir_itens i ON i.id = a.item_id
                JOIN sentir_agir_categorias c ON c.id = i.categoria_id
                LEFT JOIN sentir_agir_tratativas t
                    ON t.visita_id = a.visita_id AND t.item_id = a.item_id
                WHERE a.visita_id = %s
                  AND a.resultado IN ('critico', 'atencao')
                ORDER BY c.ordem, i.ordem
            """, (v['visita_id'],))
            itens = []
            for r in cur.fetchall():
                item = _serial_row(r)
                item['obs_item'] = _extrair_obs_item(item.get('descricao_problema'))
                itens.append(item)
            v['itens_problema'] = itens

        cur.close()
    finally:
        conn.close()

    setores = {}
    for v in visitas:
        sn = v['setor_nome'] or 'Sem Setor'
        if sn not in setores:
            setores[sn] = {
                'setor_nome': sn,
                'setor_sigla': v.get('setor_sigla') or sn[:4],
                'setor_ordem': v.get('setor_ordem'),
                'visitas': [],
                'total': 0, 'criticos': 0, 'atencao': 0, 'adequados': 0
            }
        setores[sn]['visitas'].append(v)
        setores[sn]['total'] += 1
        av = v['avaliacao_final']
        if av == 'critico':
            setores[sn]['criticos'] += 1
        elif av == 'atencao':
            setores[sn]['atencao'] += 1
        else:
            setores[sn]['adequados'] += 1

    setores_lista = sorted(
        setores.values(),
        key=lambda x: (x.get('setor_ordem') or 999, x['setor_nome'])
    )

    total = len(visitas)
    criticos = sum(1 for v in visitas if v['avaliacao_final'] == 'critico')
    atencao = sum(1 for v in visitas if v['avaliacao_final'] == 'atencao')

    return {
        'data': data_str,
        'total': total,
        'criticos': criticos,
        'atencao': atencao,
        'adequados': total - criticos - atencao,
        'total_setores': len(setores_lista),
        'setores': setores_lista
    }


def buscar_dados_categorias(data_inicio_str, data_fim_str):
    """Busca tratativas agrupadas por categoria. Retorna None se sem tratativas."""
    conn = _get_conn()
    try:
        cur = conn.cursor(cursor_factory=RealDictCursor)
        cur.execute("""
            SELECT
                c.nome  AS categoria_nome,
                c.icone AS categoria_icone,
                COUNT(*) AS total,
                COUNT(*) FILTER (WHERE t.status = 'pendente')                    AS total_pendente,
                COUNT(*) FILTER (WHERE t.status = 'em_tratativa')                AS total_tratativa,
                COUNT(*) FILTER (WHERE t.status IN ('regularizado', 'cancelado')) AS total_tratado,
                ARRAY_AGG(DISTINCT i.descricao ORDER BY i.descricao)
                    FILTER (WHERE t.status IN ('pendente', 'em_tratativa'))      AS itens_abertos
            FROM sentir_agir_tratativas t
            JOIN sentir_agir_categorias c ON c.id = t.categoria_id
            JOIN sentir_agir_itens i ON i.id = t.item_id
            WHERE t.criado_em::date BETWEEN %s AND %s
            GROUP BY c.id, c.nome, c.icone, c.ordem
            ORDER BY (COUNT(*) FILTER (WHERE t.status IN ('pendente', 'em_tratativa'))) DESC, c.ordem
        """, (data_inicio_str, data_fim_str))
        rows = [_serial_row(r) for r in cur.fetchall()]
        cur.close()
    finally:
        conn.close()

    if not rows:
        return None

    total = sum(r['total'] for r in rows)
    total_aberto = sum((r['total_pendente'] or 0) + (r['total_tratativa'] or 0) for r in rows)
    return {
        'data_inicio': data_inicio_str,
        'data_fim': data_fim_str,
        'periodo_dias': PERIODO_SEMANAL_DIAS,
        'total_tratativas': total,
        'total_aberto': total_aberto,
        'total_categorias': len(rows),
        'categorias': rows
    }
