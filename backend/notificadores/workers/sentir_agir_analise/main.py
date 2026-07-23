# -*- coding: utf-8 -*-
import os
import sys
import time
import traceback
import threading
from datetime import date, timedelta
from .config import logger, GROQ_API_KEY, HORARIO_EXECUCAO, HORARIO_SEMANAL, DIAS_RETROATIVOS
from .banco import (
    garantir_tabela, garantir_tabela_categorias,
    ja_analisado, ja_analisado_categorias,
    salvar_analise, salvar_analise_categorias,
    buscar_dados_dia, buscar_dados_categorias,
    PERIODO_SEMANAL_DIAS
)
from .ia import gerar_analise_ia, gerar_analise_categorias

_background_started = False
_stop_event = threading.Event()


def eh_dia_util(d):
    """Retorna True se d for segunda a sexta (weekday 0-4)."""
    return d.weekday() < 5


def dias_uteis_pendentes():
    """
    Retorna datas (YYYY-MM-DD) de dias uteis dos ultimos DIAS_RETROATIVOS dias
    que nao foram analisados. Exclui hoje (analise agendada para 18h).
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
    """Busca dados, chama IA, salva. Retorna True se analisou com sucesso."""
    logger.info('[%s] Iniciando analise de %s...', motivo, data_str)

    if ja_analisado(data_str):
        logger.info('[%s] Data %s ja possui analise. Pulando.', motivo, data_str)
        return False

    dados = buscar_dados_dia(data_str)
    if dados is None:
        logger.info('[%s] Nenhuma visita encontrada em %s. Pulando.', motivo, data_str)
        return False

    logger.info('[%s] %s: %d visitas | %d criticos | %d atencao | %d setores',
                motivo, data_str, dados['total'], dados['criticos'], dados['atencao'], dados['total_setores'])

    analise = gerar_analise_ia(dados)
    if not analise:
        logger.error('[%s] Falha ao gerar analise para %s.', motivo, data_str)
        return False

    salvar_analise(data_str, analise, dados)
    logger.info('[%s] Analise de %s concluida e salva (%d chars).', motivo, data_str, len(analise))
    return True


def ciclo_diario():
    """Executa o ciclo agendado: recupera pendentes + analise do dia atual."""
    hoje = date.today()
    if not eh_dia_util(hoje):
        logger.info('Hoje (%s) e final de semana. Ciclo ignorado.', hoje.isoformat())
        return

    logger.info('=== CICLO DIARIO INICIADO (%s) ===', hoje.isoformat())

    pendentes = dias_uteis_pendentes()
    if pendentes:
        logger.info('%d dia(s) util(eis) sem analise: %s', len(pendentes), pendentes)
        for ds in pendentes:
            try:
                processar_data(ds, motivo='recuperacao')
                time.sleep(3)
            except Exception as e:
                logger.error('Erro ao processar data retroativa %s: %s', ds, e)
    else:
        logger.info('Nenhum dia util pendente de analise.')

    try:
        processar_data(hoje.isoformat(), motivo='agendado')
    except Exception as e:
        logger.error('Erro ao processar analise do dia: %s', e)

    logger.info('=== CICLO DIARIO CONCLUIDO ===')


def verificacao_inicial():
    """Ao iniciar o worker, recupera analises pendentes dos ultimos DIAS_RETROATIVOS dias uteis."""
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


def ciclo_semanal_categorias():
    """
    Analise semanal de categorias criticas.
    Chave: segunda-feira da semana atual. Skipa se ja feito.
    """
    hoje = date.today()
    segunda = hoje - timedelta(days=hoje.weekday())
    data_ref_str = segunda.isoformat()
    inicio_str = (segunda - timedelta(days=PERIODO_SEMANAL_DIAS)).isoformat()
    fim_str = (segunda - timedelta(days=1)).isoformat()

    logger.info('=== CICLO SEMANAL CATEGORIAS (%s | %s -> %s) ===', data_ref_str, inicio_str, fim_str)

    if ja_analisado_categorias(data_ref_str):
        logger.info('[semanal] Semana %s ja analisada. Pulando.', data_ref_str)
        return

    try:
        dados = buscar_dados_categorias(inicio_str, fim_str)
    except Exception as e:
        logger.error('[semanal] Erro ao buscar dados de categorias: %s', e)
        return

    if not dados:
        logger.info('[semanal] Nenhuma tratativa no periodo %s -> %s.', inicio_str, fim_str)
        return

    logger.info('[semanal] %d tratativas | %d categorias | %d em aberto',
                dados['total_tratativas'], dados['total_categorias'], dados['total_aberto'])

    analise = gerar_analise_categorias(dados)
    if not analise:
        logger.error('[semanal] Falha ao gerar analise de categorias.')
        return

    try:
        salvar_analise_categorias(data_ref_str, analise, dados)
    except Exception as e:
        logger.error('[semanal] Erro ao salvar analise de categorias: %s', e)
        return

    logger.info('=== CICLO SEMANAL CATEGORIAS CONCLUIDO (%d chars) ===', len(analise))


def stop():
    _stop_event.set()


def start_in_background():
    """
    Inicia como thread daemon junto ao Flask.
    OFF SWITCH: WORKER_SENTIR_AGIR_AUTO=false no .env
    GROQ_API_KEY ausente: worker ignorado (nao derruba o Flask).
    """
    global _background_started
    if _background_started:
        return

    if os.getenv('WORKER_SENTIR_AGIR_AUTO', 'true').lower() != 'true':
        logger.info('[worker_sentir_agir] Auto-start desativado (WORKER_SENTIR_AGIR_AUTO=false)')
        return

    if not GROQ_API_KEY:
        logger.warning('[worker_sentir_agir] GROQ_API_KEY nao configurada — worker ignorado')
        return

    flask_debug = (os.environ.get('FLASK_ENV') == 'development' or
                   os.environ.get('FLASK_DEBUG', '0') in ('1', 'true', 'True'))
    if flask_debug and os.environ.get('WERKZEUG_RUN_MAIN') != 'true':
        return

    _background_started = True
    _stop_event.clear()

    def _run():
        try:
            import schedule as _sched
            _scheduler = _sched.Scheduler()

            logger.info('[worker_sentir_agir] Thread daemon iniciada (PID %s, ciclo diario as %s)',
                        os.getpid(), HORARIO_EXECUCAO)

            garantir_tabela()
            garantir_tabela_categorias()
            verificacao_inicial()

            try:
                ciclo_semanal_categorias()
            except Exception as e:
                logger.error('[worker_sentir_agir] Erro no ciclo semanal de categorias: %s', e)

            _scheduler.every().day.at(HORARIO_EXECUCAO).do(ciclo_diario)
            _scheduler.every().monday.at(HORARIO_SEMANAL).do(ciclo_semanal_categorias)
            logger.info('[worker_sentir_agir] Agendado: diario as %s | semanal categorias toda segunda as %s',
                        HORARIO_EXECUCAO, HORARIO_SEMANAL)

            while not _stop_event.is_set():
                _scheduler.run_pending()
                _stop_event.wait(30)

        except Exception as e:
            logger.error('[worker_sentir_agir] Erro fatal na thread daemon: %s', e, exc_info=True)

    t = threading.Thread(target=_run, name='worker_sentir_agir_analise', daemon=True)
    t.start()
    logger.info('[worker_sentir_agir] Thread daemon registrada')
    return _stop_event


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

    try:
        garantir_tabela()
        garantir_tabela_categorias()
    except Exception as e:
        logger.error('Erro ao verificar tabelas no banco: %s', e)
        sys.exit(1)

    try:
        verificacao_inicial()
    except Exception as e:
        logger.error('Erro na verificacao inicial: %s', e)

    import schedule
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
