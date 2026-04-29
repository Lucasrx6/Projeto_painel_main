# -*- coding: utf-8 -*-
"""
==============================================================
  WORKER ANALISE DIARIA - SENTIR E AGIR
  Hospital Anchieta Ceilandia
==============================================================

  Gera automaticamente a analise executiva com IA (Groq)
  das visitas do Projeto Sentir e Agir, uma vez por dia
  util (segunda a sexta) as 18:00.

  Logica de recuperacao:
  - Ao iniciar, verifica os ultimos DIAS_RETROATIVOS dias uteis
  - Se uma data util nao tem analise salva E tem visitas, gera
  - Nao regenera datas que ja foram analisadas
  - Nao processa sabados nem domingos

  Persistencia:
  - Salva na tabela sentir_agir_analises_ia
  - Tabela criada automaticamente se nao existir

  Execucao:
  - Standalone: python worker_sentir_agir_analise.py
  - Servico Windows via NSSM

  Logs:
  - logs/worker_sentir_agir_analise.log (rotativo 5MB)
==============================================================
"""

import os
import sys
import time
import json
import logging
import logging.handlers
import traceback
import psycopg2
from psycopg2.extras import RealDictCursor
import schedule
from datetime import datetime, date, timedelta
from decimal import Decimal
from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(os.path.abspath(__file__)), '.env'))

# =========================================================
# CONFIGURACAO
# =========================================================

GROQ_API_KEY = os.getenv('GROQ_API_KEY', '')
GROQ_MODEL = 'llama-3.3-70b-versatile'
HORARIO_EXECUCAO = '18:00'   # Hora do disparo diario
DIAS_RETROATIVOS = 7         # Quantos dias uteis anteriores checar ao iniciar

DB_CONFIG = {
    'host': os.getenv('DB_HOST', 'localhost'),
    'port': int(os.getenv('DB_PORT', 5432)),
    'database': os.getenv('DB_NAME', ''),
    'user': os.getenv('DB_USER', ''),
    'password': os.getenv('DB_PASSWORD', ''),
}

# =========================================================
# LOGGING
# =========================================================

LOG_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'logs')
os.makedirs(LOG_DIR, exist_ok=True)

logger = logging.getLogger('worker_sentir_agir_analise')
logger.setLevel(logging.INFO)

_fh = logging.handlers.RotatingFileHandler(
    os.path.join(LOG_DIR, 'worker_sentir_agir_analise.log'),
    maxBytes=5 * 1024 * 1024, backupCount=3, encoding='utf-8'
)
_fh.setFormatter(logging.Formatter('[%(asctime)s] %(levelname)s: %(message)s'))
logger.addHandler(_fh)

_sh = logging.StreamHandler(sys.stdout)
_sh.setFormatter(logging.Formatter('[%(asctime)s] %(levelname)s: %(message)s'))
logger.addHandler(_sh)


# =========================================================
# BANCO DE DADOS
# =========================================================

def _get_conn():
    return psycopg2.connect(**DB_CONFIG)


def garantir_tabela():
    """Cria a tabela sentir_agir_analises_ia se nao existir."""
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
    COMMENT ON TABLE sentir_agir_analises_ia IS
        'Analises diarias automaticas do Projeto Sentir e Agir geradas por IA';
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


def ja_analisado(data_str):
    """Retorna True se ja existe analise salva para a data."""
    conn = _get_conn()
    try:
        cur = conn.cursor()
        cur.execute(
            'SELECT id FROM sentir_agir_analises_ia WHERE data_analise = %s',
            (data_str,)
        )
        resultado = cur.fetchone()
        cur.close()
        return resultado is not None
    finally:
        conn.close()


def salvar_analise(data_str, analise_texto, totais):
    """Persiste a analise no banco."""
    conn = _get_conn()
    try:
        cur = conn.cursor()
        cur.execute(
            """
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
            """,
            (
                data_str, analise_texto,
                totais.get('total', 0), totais.get('criticos', 0),
                totais.get('atencao', 0), totais.get('total_setores', 0),
                GROQ_MODEL
            )
        )
        conn.commit()
        cur.close()
        logger.info('Analise de %s salva no banco.', data_str)
    finally:
        conn.close()


# =========================================================
# LOGICA DE DADOS (espelha painel32_routes)
# =========================================================

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


def buscar_dados_dia(data_str):
    """
    Busca visitas do dia e retorna estrutura agrupada por setor.
    Retorna None se nao houver visitas.
    """
    conn = _get_conn()
    try:
        cur = conn.cursor(cursor_factory=RealDictCursor)

        cur.execute("""
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

    # Agrupar por setor
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


# =========================================================
# CHAMADA GROQ
# =========================================================

def _get_groq_client():
    if not GROQ_API_KEY:
        return None
    try:
        from groq import Groq
        return Groq(api_key=GROQ_API_KEY)
    except ImportError:
        logger.error('Biblioteca groq nao instalada. Execute: pip install groq')
        return None


def gerar_analise_ia(dados):
    """Chama Groq e retorna texto da analise ou None em caso de erro."""
    client = _get_groq_client()
    if not client:
        logger.error('Groq client nao disponivel.')
        return None

    data_str = dados['data']
    setores = dados['setores']

    blocos = ''
    for s in setores:
        blocos += '\n\n=== SETOR: {} ===\n'.format(s['setor_nome'])
        blocos += 'Visitas: {} | Criticos: {} | Atencao: {} | Adequados: {}\n'.format(
            s['total'], s['criticos'], s['atencao'], s['adequados']
        )
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
    ).format(data_str, blocos)

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
        return response.choices[0].message.content
    except Exception as e:
        logger.error('Erro ao chamar Groq: %s', e)
        return None


# =========================================================
# LOGICA PRINCIPAL
# =========================================================

def eh_dia_util(d):
    """Retorna True se d for segunda a sexta (weekday 0-4)."""
    return d.weekday() < 5


def dias_uteis_pendentes():
    """
    Retorna lista de datas (string YYYY-MM-DD) de dias uteis
    dos ultimos DIAS_RETROATIVOS dias que nao foram analisados.
    Exclui hoje (analise agendada para 18h).
    Ordem: mais antigo primeiro.
    """
    hoje = date.today()
    pendentes = []
    for delta in range(DIAS_RETROATIVOS, 0, -1):
        d = hoje - timedelta(days=delta)
        if not eh_dia_util(d):
            continue
        ds = d.isoformat()
        if not ja_analisado(ds):
            pendentes.append(ds)
    return pendentes


def processar_data(data_str, motivo='agendado'):
    """Processa uma data: busca dados, chama IA, salva."""
    logger.info('[%s] Iniciando analise de %s...', motivo, data_str)

    if ja_analisado(data_str):
        logger.info('[%s] Data %s ja possui analise. Pulando.', motivo, data_str)
        return False

    dados = buscar_dados_dia(data_str)
    if dados is None:
        logger.info('[%s] Nenhuma visita encontrada em %s. Pulando.', motivo, data_str)
        return False

    logger.info(
        '[%s] %s: %d visitas | %d criticos | %d atencao | %d setores',
        motivo, data_str,
        dados['total'], dados['criticos'], dados['atencao'], dados['total_setores']
    )

    analise = gerar_analise_ia(dados)
    if not analise:
        logger.error('[%s] Falha ao gerar analise para %s.', motivo, data_str)
        return False

    salvar_analise(data_str, analise, dados)
    logger.info('[%s] Analise de %s concluida e salva (%d chars).', motivo, data_str, len(analise))
    return True


def ciclo_diario():
    """Executa o ciclo agendado: analise do dia + recuperacao de pendentes."""
    hoje = date.today()

    if not eh_dia_util(hoje):
        logger.info('Hoje (%s) e final de semana. Ciclo ignorado.', hoje.isoformat())
        return

    logger.info('=== CICLO DIARIO INICIADO (%s) ===', hoje.isoformat())

    # Primeiro recupera pendentes de dias anteriores
    pendentes = dias_uteis_pendentes()
    if pendentes:
        logger.info('%d dia(s) util(eis) sem analise detectado(s): %s', len(pendentes), pendentes)
        for ds in pendentes:
            try:
                processar_data(ds, motivo='recuperacao')
                time.sleep(3)  # Intervalo entre chamadas Groq
            except Exception as e:
                logger.error('Erro ao processar data retroativa %s: %s', ds, e)
    else:
        logger.info('Nenhum dia util pendente de analise.')

    # Analise do dia atual
    try:
        processar_data(hoje.isoformat(), motivo='agendado')
    except Exception as e:
        logger.error('Erro ao processar analise do dia: %s', e)

    logger.info('=== CICLO DIARIO CONCLUIDO ===')


def verificacao_inicial():
    """
    Ao iniciar o worker, recupera analises pendentes dos
    ultimos DIAS_RETROATIVOS dias uteis.
    """
    logger.info('=== VERIFICACAO INICIAL DE PENDENTES ===')
    pendentes = dias_uteis_pendentes()

    if not pendentes:
        logger.info('Nenhum dia util pendente. Sistema em dia.')
        return

    logger.info('%d dia(s) sem analise: %s', len(pendentes), pendentes)
    for ds in pendentes:
        try:
            processar_data(ds, motivo='startup')
            time.sleep(3)
        except Exception as e:
            logger.error('Erro ao processar pendente %s: %s', ds, e)

    logger.info('=== VERIFICACAO INICIAL CONCLUIDA ===')


# =========================================================
# ENTRADA PRINCIPAL
# =========================================================

def main():
    logger.info('=' * 60)
    logger.info('WORKER ANALISE DIARIA SENTIR E AGIR - INICIANDO')
    logger.info('Horario agendado: %s (dias uteis)', HORARIO_EXECUCAO)
    logger.info('Retroatividade: %d dias uteis', DIAS_RETROATIVOS)
    logger.info('Modelo IA: %s', GROQ_MODEL)
    logger.info('=' * 60)

    if not GROQ_API_KEY:
        logger.error('GROQ_API_KEY nao configurada no .env. Worker encerrado.')
        sys.exit(1)

    # Garantir que a tabela existe
    try:
        garantir_tabela()
    except Exception as e:
        logger.error('Erro ao verificar tabela no banco: %s', e)
        sys.exit(1)

    # Ao iniciar, recupera pendentes
    try:
        verificacao_inicial()
    except Exception as e:
        logger.error('Erro na verificacao inicial: %s', e)

    # Agendar ciclo diario
    schedule.every().day.at(HORARIO_EXECUCAO).do(ciclo_diario)
    logger.info('Scheduler ativo. Proximo ciclo agendado para %s.', HORARIO_EXECUCAO)

    while True:
        try:
            schedule.run_pending()
            time.sleep(30)
        except KeyboardInterrupt:
            logger.info('Worker encerrado pelo usuario.')
            break
        except Exception as e:
            logger.error('Erro no loop principal: %s', e)
            traceback.print_exc()
            time.sleep(60)


# =========================================================
# INICIALIZACAO INTEGRADA (modo thread daemon no Flask)
# =========================================================

_background_started = False


def start_in_background():
    """
    Inicia o worker de analise diaria como thread daemon junto com o Flask.

    OFF SWITCHES (em ordem de praticidade):
      1. .env  -> WORKER_SENTIR_AGIR_AUTO=false  (desativa sem tocar no codigo)
      2. app.py -> comentar o bloco de 3 linhas   (reverte comportamento anterior)
      3. GROQ_API_KEY ausente                      (worker e ignorado com aviso no log)
      4. Qualquer excecao de startup e capturada   (nunca derruba o servidor Flask)

    Nota: a verificacao_inicial() pode demorar na primeira execucao caso haja
    varios dias retroativos pendentes (uma chamada Groq por dia). Tudo ocorre
    dentro da thread, sem bloquear o servidor.
    """
    global _background_started
    if _background_started:
        return

    # OFF SWITCH 1: variavel de ambiente
    if os.getenv('WORKER_SENTIR_AGIR_AUTO', 'true').lower() != 'true':
        logger.info('[worker_sentir_agir] Auto-start desativado (WORKER_SENTIR_AGIR_AUTO=false)')
        return

    # OFF SWITCH 3: GROQ_API_KEY ausente — avisa mas nao derruba o servidor
    if not GROQ_API_KEY:
        logger.warning('[worker_sentir_agir] GROQ_API_KEY nao configurada — worker ignorado')
        return

    # Guard Werkzeug: evita iniciar no processo pai do reloader
    werkzeug_run_main = os.environ.get('WERKZEUG_RUN_MAIN')
    if werkzeug_run_main is not None and werkzeug_run_main != 'true':
        return

    _background_started = True

    import threading

    def _run():
        try:
            import schedule as _sched
            _scheduler = _sched.Scheduler()  # instancia isolada, nao interfere no scheduler global

            logger.info('[worker_sentir_agir] Thread daemon iniciada (PID %s, ciclo diario as %s)',
                        os.getpid(), HORARIO_EXECUCAO)

            # Garante que a tabela existe antes de qualquer operacao
            garantir_tabela()

            # Recupera analises retroativas pendentes (pode chamar Groq multiplas vezes)
            verificacao_inicial()

            # Agenda ciclo diario
            _scheduler.every().day.at(HORARIO_EXECUCAO).do(ciclo_diario)
            logger.info('[worker_sentir_agir] Proximo ciclo agendado para %s (dias uteis)', HORARIO_EXECUCAO)

            while True:
                _scheduler.run_pending()
                time.sleep(30)

        except Exception as e:
            logger.error('[worker_sentir_agir] Erro fatal na thread daemon: %s', e, exc_info=True)

    t = threading.Thread(target=_run, name='worker_sentir_agir_analise', daemon=True)
    t.start()
    logger.info('[worker_sentir_agir] Thread daemon registrada')


if __name__ == '__main__':
    main()
