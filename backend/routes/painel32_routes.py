# -*- coding: utf-8 -*-
"""
Painel 32 - Analise Diaria Sentir e Agir com IA
Hospital Anchieta Ceilandia

Gera analise inteligente por setor das visitas do dia,
com sugestoes de abordagem via Groq e exportacao CSV.
"""

import os
import csv
import io
import json
import traceback
from datetime import datetime, date
from decimal import Decimal
from flask import Blueprint, request, jsonify, send_from_directory, session, Response
from psycopg2.extras import RealDictCursor
from backend.database import get_db_connection, release_connection
from backend.middleware.decorators import login_required
from backend.user_management import verificar_permissao_painel
from backend.cache import cache_route
from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', '.env'))

GROQ_MODEL = 'llama-3.3-70b-versatile'

painel32_bp = Blueprint('painel32', __name__)


# ============================================================
# HELPERS
# ============================================================

def _get_groq_client():
    # Recarregar o .env a cada chamada para garantir que a chave
    # seja lida mesmo que o arquivo tenha sido criado/renomeado
    # depois que o servidor subiu
    _env_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', '.env')
    load_dotenv(_env_path, override=True)
    api_key = os.environ.get('GROQ_API_KEY', '').strip()
    if not api_key:
        return None
    try:
        from groq import Groq
        return Groq(api_key=api_key)
    except ImportError:
        return None


def _serial(val):
    if isinstance(val, (datetime, date)):
        return val.isoformat()
    if isinstance(val, Decimal):
        return float(val)
    return val


def _serial_row(row):
    return {k: _serial(v) for k, v in row.items()}


def _extrair_sintese(texto):
    """Extrai a secao SINTESE GERAL DO DIA do texto da analise IA."""
    if not texto:
        return ''
    linhas = texto.split('\n')
    for i, linha in enumerate(linhas):
        linha_norm = linha.upper().replace('\u00cd', 'I').replace('\u00ca', 'E').strip()
        if 'SINTESE GERAL DO DIA' in linha_norm:
            return '\n'.join(linhas[i + 1:]).strip()
    return ''


def _extrair_obs_item(descricao_problema):
    if not descricao_problema:
        return None
    if ' | Observacao do item: ' in descricao_problema:
        return descricao_problema.split(' | Observacao do item: ', 1)[1].strip()
    return None


# ============================================================
# ROTAS HTML
# ============================================================

@painel32_bp.route('/painel/painel32')
@login_required
def painel32():
    usuario_id = session.get('usuario_id')
    is_admin = session.get('is_admin', False)
    if not is_admin:
        if not verificar_permissao_painel(usuario_id, 'painel32'):
            return send_from_directory('frontend', 'acesso-negado.html')
    return send_from_directory('paineis/painel32', 'index.html')


@painel32_bp.route('/paineis/painel32/<path:filename>')
@login_required
def painel32_static(filename):
    return send_from_directory('paineis/painel32', filename)


# ============================================================
# API: ANALISE SALVA (worker ou manual)
# ============================================================

@painel32_bp.route('/api/paineis/painel32/analise-salva', methods=['GET'])
@login_required
@cache_route(ttl=120, key_prefix='painel32:analise-salva')
def analise_salva():
    """
    Retorna a analise ja persistida para uma data (gerada pelo
    worker automatico ou via botao manual).
    """
    data_str = request.args.get('data', date.today().isoformat())
    try:
        conn = get_db_connection()
        cursor = conn.cursor(cursor_factory=RealDictCursor)
        cursor.execute("""
            SELECT analise_texto, total_visitas, total_criticos,
                   total_atencao, total_setores, modelo,
                   gerado_em, gerado_por
            FROM sentir_agir_analises_ia
            WHERE data_analise = %s
        """, (data_str,))
        row = cursor.fetchone()
        cursor.close()
        release_connection(conn)

        if not row:
            return jsonify({'success': True, 'data': None})

        return jsonify({'success': True, 'data': _serial_row(row)})
    except Exception as e:
        traceback.print_exc()
        return jsonify({'success': False, 'error': str(e)}), 500


# ============================================================
# API: HISTORICO DE ANALISES (agenda)
# ============================================================

@painel32_bp.route('/api/paineis/painel32/historico', methods=['GET'])
@login_required
@cache_route(ttl=120, key_prefix='painel32:historico', vary_by_query=True)
def historico():
    """
    Retorna lista de dias que possuem analise salva,
    ordenados do mais recente para o mais antigo.
    Inclui um trecho do texto para exibir na agenda.
    """
    limite = int(request.args.get('limite', 30))
    try:
        conn = get_db_connection()
        cursor = conn.cursor(cursor_factory=RealDictCursor)
        cursor.execute("""
            SELECT
                TO_CHAR(data_analise, 'YYYY-MM-DD') AS data,
                TO_CHAR(data_analise, 'DD/MM/YYYY') AS data_fmt,
                TO_CHAR(data_analise, 'Day') AS dia_semana,
                total_visitas, total_criticos, total_atencao,
                total_setores,
                analise_texto,
                gerado_em, gerado_por, modelo
            FROM sentir_agir_analises_ia
            ORDER BY data_analise DESC
            LIMIT %s
        """, (limite,))
        rows = []
        for r in cursor.fetchall():
            row = _serial_row(r)
            row['sintese'] = _extrair_sintese(row.pop('analise_texto', '') or '')
            rows.append(row)
        cursor.close()
        release_connection(conn)
        return jsonify({'success': True, 'data': rows})
    except Exception as e:
        traceback.print_exc()
        return jsonify({'success': False, 'error': str(e)}), 500


# ============================================================
# API: DADOS DO DIA
# ============================================================

@painel32_bp.route('/api/paineis/painel32/dados', methods=['GET'])
@login_required
@cache_route(ttl=120, key_prefix='painel32:dados', vary_by_query=True)
def dados():
    """
    Retorna todas as visitas do dia agrupadas por setor,
    com itens criticos/atencao e observacoes de cada visita.
    """
    data_str = request.args.get('data', date.today().isoformat())

    try:
        conn = get_db_connection()
        cursor = conn.cursor(cursor_factory=RealDictCursor)

        cursor.execute("""
            SELECT
                v.id AS visita_id,
                v.nm_paciente,
                v.nr_atendimento,
                v.leito,
                v.avaliacao_final,
                v.observacoes AS obs_geral,
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
        visitas = [_serial_row(r) for r in cursor.fetchall()]

        # Buscar itens criticos/atencao de cada visita
        for v in visitas:
            cursor.execute("""
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
            for r in cursor.fetchall():
                item = _serial_row(r)
                item['obs_item'] = _extrair_obs_item(item.get('descricao_problema'))
                itens.append(item)
            v['itens_problema'] = itens

        cursor.close()
        release_connection(conn)

        # Agrupar por setor
        setores = {}
        for v in visitas:
            sn = v['setor_nome'] or 'Sem Setor'
            if sn not in setores:
                setores[sn] = {
                    'setor_nome': sn,
                    'setor_sigla': v['setor_sigla'] or sn[:4],
                    'setor_ordem': v['setor_ordem'],
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
            key=lambda x: (x['setor_ordem'] or 999, x['setor_nome'])
        )

        total = len(visitas)
        criticos = sum(1 for v in visitas if v['avaliacao_final'] == 'critico')
        atencao = sum(1 for v in visitas if v['avaliacao_final'] == 'atencao')

        return jsonify({
            'success': True,
            'data': {
                'data': data_str,
                'total': total,
                'criticos': criticos,
                'atencao': atencao,
                'adequados': total - criticos - atencao,
                'total_setores': len(setores_lista),
                'setores': setores_lista
            }
        })
    except Exception as e:
        traceback.print_exc()
        return jsonify({'success': False, 'error': str(e)}), 500


# ============================================================
# API: GERAR ANALISE IA (por setor)
# ============================================================

@painel32_bp.route('/api/paineis/painel32/gerar-analise', methods=['POST'])
@login_required
def gerar_analise():
    """
    Recebe os dados das visitas do dia e pede ao Groq
    uma analise executiva por setor.
    """
    payload = request.get_json()
    if not payload:
        return jsonify({'success': False, 'error': 'Dados nao fornecidos'}), 400

    client = _get_groq_client()
    if not client:
        return jsonify({'success': False, 'error': 'GROQ_API_KEY nao configurada no .env'}), 500

    data_analise = payload.get('data', date.today().isoformat())
    setores = payload.get('setores', [])

    if not setores:
        return jsonify({'success': False, 'error': 'Nenhum dado de visitas para analisar'}), 400

    # Montar bloco de dados por setor para o prompt
    blocos = ''
    for s in setores:
        blocos += '\n\n=== SETOR: {} ===\n'.format(s['setor_nome'])
        blocos += 'Visitas: {} | Criticos: {} | Atencao: {} | Adequados: {}\n'.format(
            s['total'], s['criticos'], s['atencao'], s['adequados'])

        itens_relevantes = []
        obs_gerais = []
        for v in s.get('visitas', []):
            for item in v.get('itens_problema', []):
                linha = '  [{}] {} > {}'.format(
                    item['resultado'].upper(),
                    item['categoria_nome'],
                    item['item_descricao']
                )
                if item.get('obs_item'):
                    linha += ' -- Critica: ' + item['obs_item'][:150]
                linha += ' (Leito {})'.format(v.get('leito', '?'))
                itens_relevantes.append(linha)
            if v.get('obs_geral'):
                obs_gerais.append(v['obs_geral'][:200])

        if itens_relevantes:
            blocos += 'Itens criticos/atencao:\n' + '\n'.join(itens_relevantes[:20]) + '\n'
        if obs_gerais:
            blocos += 'Observacoes gerais:\n' + '\n'.join('  - ' + o for o in obs_gerais[:8]) + '\n'

    prompt = (
        'Voce e um analista de qualidade assistencial do Hospital Anchieta Ceilandia, '
        'especializado no Projeto Sentir e Agir — programa de visitas periodicas para avaliar '
        'a experiencia e necessidades dos pacientes internados.\n\n'
        'Data da analise: {}\n\n'
        'Analise os dados das visitas realizadas e forneca um relatorio executivo por setor:\n'
        '{}\n\n'
        'Para CADA setor, responda com:\n'
        '**[NOME DO SETOR]**\n'
        '- Avaliacao Geral: (uma frase resumindo o estado)\n'
        '- Pontos Criticos: (principais problemas, se houver)\n'
        '- Observacoes Relevantes: (situacoes de atencao)\n'
        '- Tendencia: ADEQUADO | REQUER ATENCAO | SITUACAO CRITICA\n\n'
        'Ao final, inclua:\n'
        '**SINTESE GERAL DO DIA**\n'
        '- Setores mais criticos\n'
        '- Principais pontos de melhoria\n'
        '- Recomendacao geral\n\n'
        'Seja objetivo e profissional. Use linguagem adequada para gestores de saude. '
        'Responda em portugues do Brasil.'
    ).format(data_analise, blocos)

    try:
        response = client.chat.completions.create(
            model=GROQ_MODEL,
            messages=[
                {
                    'role': 'system',
                    'content': (
                        'Voce e um analista de qualidade hospitalar especializado em '
                        'experiencia do paciente. Responda sempre em portugues do Brasil, '
                        'de forma objetiva e profissional.'
                    )
                },
                {'role': 'user', 'content': prompt}
            ],
            max_tokens=3000,
            temperature=0.3
        )
        analise = response.choices[0].message.content
        gerado_em = datetime.now().isoformat()

        # Persistir no banco para nao precisar regenerar
        try:
            conn = get_db_connection()
            cursor = conn.cursor()
            total_visitas = sum(s['total'] for s in setores)
            total_criticos = sum(s['criticos'] for s in setores)
            total_atencao = sum(s['atencao'] for s in setores)
            cursor.execute("""
                INSERT INTO sentir_agir_analises_ia
                    (data_analise, analise_texto, total_visitas, total_criticos,
                     total_atencao, total_setores, modelo, gerado_por)
                VALUES (%s, %s, %s, %s, %s, %s, %s, 'manual')
                ON CONFLICT (data_analise) DO UPDATE SET
                    analise_texto  = EXCLUDED.analise_texto,
                    total_visitas  = EXCLUDED.total_visitas,
                    total_criticos = EXCLUDED.total_criticos,
                    total_atencao  = EXCLUDED.total_atencao,
                    total_setores  = EXCLUDED.total_setores,
                    modelo         = EXCLUDED.modelo,
                    gerado_em      = CURRENT_TIMESTAMP,
                    gerado_por     = 'manual'
            """, (
                data_analise, analise, total_visitas, total_criticos,
                total_atencao, len(setores), GROQ_MODEL
            ))
            conn.commit()
            cursor.close()
            release_connection(conn)
        except Exception as db_err:
            traceback.print_exc()
            # Nao falha a requisicao por erro ao salvar — apenas loga
            print('Aviso: nao foi possivel salvar analise no banco:', db_err)

        return jsonify({
            'success': True,
            'data': {
                'analise': analise,
                'modelo': GROQ_MODEL,
                'gerado_em': gerado_em,
                'gerado_por': 'manual'
            }
        })
    except Exception as e:
        traceback.print_exc()
        return jsonify({'success': False, 'error': 'Erro ao chamar IA: ' + str(e)}), 500


# ============================================================
# API: SUGESTAO DE ABORDAGEM (por item)
# ============================================================

@painel32_bp.route('/api/paineis/painel32/sugestao', methods=['POST'])
@login_required
def sugestao_abordagem():
    """
    Recebe um item critico/atencao especifico e retorna
    uma sugestao pratica de abordagem via Groq.
    """
    payload = request.get_json()
    if not payload:
        return jsonify({'success': False, 'error': 'Dados nao fornecidos'}), 400

    client = _get_groq_client()
    if not client:
        return jsonify({'success': False, 'error': 'GROQ_API_KEY nao configurada no .env'}), 500

    categoria = payload.get('categoria', '')
    item = payload.get('item', '')
    setor = payload.get('setor', '')
    critica = payload.get('critica', '')
    avaliacao = payload.get('avaliacao', 'critico')
    paciente_leito = payload.get('leito', '')

    prompt = (
        'No contexto do Projeto Sentir e Agir do Hospital Anchieta Ceilandia, '
        'foi identificado o seguinte problema durante uma visita de avaliacao:\n\n'
        'Setor: {}\n'
        'Leito: {}\n'
        'Categoria: {}\n'
        'Item avaliado: {}\n'
        'Avaliacao: {}\n'
        '{}'
        '\nSugira uma abordagem pratica e objetiva para tratar e resolver este problema, '
        'estruturando sua resposta em:\n'
        '1. **Acao Imediata** — o que deve ser feito agora\n'
        '2. **Responsavel** — qual profissional ou setor deve agir\n'
        '3. **Prazo Sugerido**\n'
        '4. **Como Monitorar** — como verificar a resolucao\n\n'
        'Seja direto e pratico. Use linguagem acessivel para a equipe hospitalar. '
        'Responda em portugues do Brasil.'
    ).format(
        setor, paciente_leito, categoria, item, avaliacao.upper(),
        'Observacao registrada: ' + critica + '\n' if critica else ''
    )

    try:
        response = client.chat.completions.create(
            model=GROQ_MODEL,
            messages=[
                {
                    'role': 'system',
                    'content': (
                        'Voce e um consultor de qualidade hospitalar especializado em '
                        'experiencia do paciente e melhoria assistencial. '
                        'Responda em portugues do Brasil de forma pratica e objetiva.'
                    )
                },
                {'role': 'user', 'content': prompt}
            ],
            max_tokens=900,
            temperature=0.4
        )
        sugestao = response.choices[0].message.content

        return jsonify({
            'success': True,
            'data': {
                'sugestao': sugestao,
                'gerado_em': datetime.now().isoformat()
            }
        })
    except Exception as e:
        traceback.print_exc()
        return jsonify({'success': False, 'error': 'Erro ao chamar IA: ' + str(e)}), 500


# ============================================================
# API: EXPORTAR CSV
# ============================================================

@painel32_bp.route('/api/paineis/painel32/exportar', methods=['GET'])
@login_required
def exportar():
    data_str = request.args.get('data', date.today().isoformat())

    try:
        conn = get_db_connection()
        cursor = conn.cursor(cursor_factory=RealDictCursor)

        cursor.execute("""
            SELECT
                s.nome AS setor,
                v.leito,
                v.nm_paciente AS paciente,
                v.nr_atendimento AS atendimento,
                v.avaliacao_final AS avaliacao,
                d.nome_visitante_1 || ' e ' || d.nome_visitante_2 AS dupla,
                r.data_ronda,
                v.observacoes AS obs_geral,
                v.criado_em
            FROM sentir_agir_visitas v
            JOIN sentir_agir_rondas r ON r.id = v.ronda_id
            JOIN sentir_agir_setores s ON s.id = v.setor_id
            JOIN sentir_agir_duplas d ON d.id = r.dupla_id
            WHERE DATE(v.criado_em) = %s
              AND v.avaliacao_final != 'impossibilitada'
            ORDER BY COALESCE(s.ordem, 999), s.nome, v.leito
        """, (data_str,))
        visitas = cursor.fetchall()

        # Buscar itens criticos por visita para incluir no CSV
        visitas_com_itens = []
        for v in visitas:
            vd = dict(v)
            cursor.execute("""
                SELECT i.descricao AS item, c.nome AS categoria, a.resultado, t.descricao_problema
                FROM sentir_agir_avaliacoes a
                JOIN sentir_agir_itens i ON i.id = a.item_id
                JOIN sentir_agir_categorias c ON c.id = i.categoria_id
                LEFT JOIN sentir_agir_tratativas t
                    ON t.visita_id = a.visita_id AND t.item_id = a.item_id
                WHERE a.visita_id = %s AND a.resultado IN ('critico', 'atencao')
                ORDER BY c.ordem, i.ordem
            """, (v['nr_atendimento'],))
            # na verdade precisa do visita_id — vamos buscar ele
            visitas_com_itens.append(vd)

        # Buscar de novo com visita_id
        cursor.execute("""
            SELECT
                v.id AS visita_id,
                s.nome AS setor, v.leito,
                v.nm_paciente AS paciente,
                v.nr_atendimento AS atendimento,
                v.avaliacao_final AS avaliacao,
                d.nome_visitante_1 || ' e ' || d.nome_visitante_2 AS dupla,
                TO_CHAR(r.data_ronda, 'DD/MM/YYYY') AS data_ronda,
                v.observacoes AS obs_geral
            FROM sentir_agir_visitas v
            JOIN sentir_agir_rondas r ON r.id = v.ronda_id
            JOIN sentir_agir_setores s ON s.id = v.setor_id
            JOIN sentir_agir_duplas d ON d.id = r.dupla_id
            WHERE DATE(v.criado_em) = %s
              AND v.avaliacao_final != 'impossibilitada'
            ORDER BY COALESCE(s.ordem, 999), s.nome, v.leito
        """, (data_str,))
        visitas2 = cursor.fetchall()

        output = io.StringIO()
        writer = csv.writer(output, delimiter=';')
        writer.writerow([
            'Setor', 'Leito', 'Paciente', 'Atendimento', 'Avaliacao',
            'Dupla', 'Data Ronda', 'Obs Geral',
            'Itens Criticos/Atencao', 'Criticas'
        ])

        for v in visitas2:
            cursor.execute("""
                SELECT i.descricao AS item, c.nome AS categoria, a.resultado, t.descricao_problema
                FROM sentir_agir_avaliacoes a
                JOIN sentir_agir_itens i ON i.id = a.item_id
                JOIN sentir_agir_categorias c ON c.id = i.categoria_id
                LEFT JOIN sentir_agir_tratativas t
                    ON t.visita_id = a.visita_id AND t.item_id = a.item_id
                WHERE a.visita_id = %s AND a.resultado IN ('critico', 'atencao')
                ORDER BY c.ordem, i.ordem
            """, (v['visita_id'],))
            itens = cursor.fetchall()

            itens_texto = ' | '.join(
                '[{}] {}: {}'.format(i['resultado'].upper(), i['categoria'], i['item'])
                for i in itens
            )
            criticas_texto = ' | '.join(
                _extrair_obs_item(i['descricao_problema']) or ''
                for i in itens if i.get('descricao_problema')
            )

            writer.writerow([
                v['setor'], v['leito'], v['paciente'], v['atendimento'],
                v['avaliacao'], v['dupla'], v['data_ronda'],
                v['obs_geral'] or '',
                itens_texto, criticas_texto
            ])

        cursor.close()
        release_connection(conn)

        output.seek(0)
        nome_arquivo = 'sentir_agir_{}.csv'.format(data_str)

        return Response(
            '\ufeff' + output.getvalue(),  # BOM para Excel reconhecer UTF-8
            mimetype='text/csv; charset=utf-8',
            headers={'Content-Disposition': 'attachment; filename=' + nome_arquivo}
        )
    except Exception as e:
        traceback.print_exc()
        return jsonify({'success': False, 'error': str(e)}), 500
