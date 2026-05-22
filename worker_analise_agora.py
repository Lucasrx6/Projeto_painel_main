# -*- coding: utf-8 -*-
"""
==============================================================
  ANALISE MANUAL - SENTIR E AGIR
  Hospital Anchieta Ceilandia
==============================================================

  Executa a analise IA imediatamente, sem esperar o agendamento
  das 18h. Util para rodar antes do horario ou refazer uma data.

  USO:
    python worker_analise_agora.py                   # analisa HOJE
    python worker_analise_agora.py 2026-05-20        # analisa data especifica
    python worker_analise_agora.py --forcar          # refaz analise de hoje mesmo que ja exista
    python worker_analise_agora.py 2026-05-20 --forcar
    python worker_analise_agora.py --semanal         # roda analise semanal de categorias
    python worker_analise_agora.py --semanal --forcar

  O script roda UMA VEZ e encerra. Nao fica em loop.
==============================================================
"""

import os
import sys
import time
import argparse
from datetime import date, timedelta
from dotenv import load_dotenv

# Carrega .env da raiz do projeto
load_dotenv(os.path.join(os.path.dirname(os.path.abspath(__file__)), '.env'))

# Importa tudo do worker principal (reutiliza logica, banco, IA)
from worker_sentir_agir_analise import (
    GROQ_API_KEY,
    GROQ_MODEL,
    PERIODO_SEMANAL_DIAS,
    garantir_tabela,
    garantir_tabela_categorias,
    ja_analisado,
    ja_analisado_categorias,
    buscar_dados_dia,
    buscar_dados_categorias,
    gerar_analise_ia,
    gerar_analise_categorias,
    salvar_analise,
    salvar_analise_categorias,
    logger,
)


# =========================================================
# HELPERS DE SAIDA
# =========================================================

def ok(msg):
    print('[OK] ' + msg)


def erro(msg):
    print('[ERRO] ' + msg)


def info(msg):
    print('[INFO] ' + msg)


# =========================================================
# ANALISE DIARIA
# =========================================================

def rodar_analise_diaria(data_str, forcar=False):
    """Processa analise diaria para a data informada."""
    print()
    print('=' * 60)
    print('ANALISE DIARIA - SENTIR E AGIR')
    print('Data: {} | Forcar: {}'.format(data_str, 'Sim' if forcar else 'Nao'))
    print('=' * 60)

    if ja_analisado(data_str) and not forcar:
        info('Data {} ja possui analise salva.'.format(data_str))
        info('Use --forcar para regenerar.')
        return True

    if forcar and ja_analisado(data_str):
        info('Modo --forcar: a analise existente sera sobrescrita.')

    info('Buscando visitas de {}...'.format(data_str))
    dados = buscar_dados_dia(data_str)

    if dados is None:
        info('Nenhuma visita encontrada em {}. Nada a analisar.'.format(data_str))
        return False

    print()
    info('Visitas encontradas: {}'.format(dados['total']))
    info('  Criticos  : {}'.format(dados['criticos']))
    info('  Atencao   : {}'.format(dados['atencao']))
    info('  Adequados : {}'.format(dados['adequados']))
    info('  Setores   : {}'.format(dados['total_setores']))
    print()

    info('Chamando IA ({})...'.format(GROQ_MODEL))
    inicio = time.time()
    analise = gerar_analise_ia(dados)
    elapsed = round(time.time() - inicio, 1)

    if not analise:
        erro('Falha ao gerar analise. Verifique a GROQ_API_KEY e a conexao.')
        return False

    ok('Analise gerada em {}s ({} caracteres).'.format(elapsed, len(analise)))

    salvar_analise(data_str, analise, dados)
    ok('Analise de {} salva no banco com sucesso.'.format(data_str))

    print()
    print('-' * 60)
    print('PREVIEW (primeiras 800 chars):')
    print('-' * 60)
    print(analise[:800])
    if len(analise) > 800:
        print('... [continua no banco] ...')
    print('-' * 60)

    return True


# =========================================================
# ANALISE SEMANAL DE CATEGORIAS
# =========================================================

def rodar_analise_semanal(forcar=False):
    """Processa analise semanal de categorias."""
    hoje = date.today()
    segunda = hoje - timedelta(days=hoje.weekday())
    data_ref_str = segunda.isoformat()
    inicio_str = (segunda - timedelta(days=PERIODO_SEMANAL_DIAS)).isoformat()
    fim_str = (segunda - timedelta(days=1)).isoformat()

    print()
    print('=' * 60)
    print('ANALISE SEMANAL DE CATEGORIAS - SENTIR E AGIR')
    print('Referencia : {}'.format(data_ref_str))
    print('Periodo    : {} a {}'.format(inicio_str, fim_str))
    print('Forcar     : {}'.format('Sim' if forcar else 'Nao'))
    print('=' * 60)

    if ja_analisado_categorias(data_ref_str) and not forcar:
        info('Semana {} ja possui analise de categorias.'.format(data_ref_str))
        info('Use --forcar para regenerar.')
        return True

    if forcar and ja_analisado_categorias(data_ref_str):
        info('Modo --forcar: a analise existente sera sobrescrita.')

    info('Buscando tratativas de {} a {}...'.format(inicio_str, fim_str))
    dados = buscar_dados_categorias(inicio_str, fim_str)

    if dados is None:
        info('Nenhuma tratativa encontrada no periodo. Nada a analisar.')
        return False

    print()
    info('Tratativas encontradas: {}'.format(dados['total_tratativas']))
    info('  Em aberto : {}'.format(dados['total_aberto']))
    info('  Categorias: {}'.format(dados['total_categorias']))
    print()

    info('Chamando IA ({})...'.format(GROQ_MODEL))
    inicio = time.time()
    analise = gerar_analise_categorias(dados)
    elapsed = round(time.time() - inicio, 1)

    if not analise:
        erro('Falha ao gerar analise semanal. Verifique a GROQ_API_KEY e a conexao.')
        return False

    ok('Analise gerada em {}s ({} caracteres).'.format(elapsed, len(analise)))

    salvar_analise_categorias(data_ref_str, analise, dados)
    ok('Analise semanal ({}) salva no banco com sucesso.'.format(data_ref_str))

    print()
    print('-' * 60)
    print('PREVIEW (primeiras 800 chars):')
    print('-' * 60)
    print(analise[:800])
    if len(analise) > 800:
        print('... [continua no banco] ...')
    print('-' * 60)

    return True


# =========================================================
# ENTRADA PRINCIPAL
# =========================================================

def main():
    parser = argparse.ArgumentParser(
        description='Executa a analise IA do Sentir e Agir imediatamente (modo manual).'
    )
    parser.add_argument(
        'data',
        nargs='?',
        default=None,
        help='Data no formato YYYY-MM-DD (padrao: hoje). Ignorado com --semanal.'
    )
    parser.add_argument(
        '--forcar',
        action='store_true',
        help='Sobrescreve analise ja existente para a data/semana informada.'
    )
    parser.add_argument(
        '--semanal',
        action='store_true',
        help='Roda a analise semanal de categorias em vez da diaria.'
    )
    args = parser.parse_args()

    # Validacoes
    if not GROQ_API_KEY:
        erro('GROQ_API_KEY nao configurada no .env. Abortando.')
        sys.exit(1)

    # Garante que as tabelas existem
    try:
        garantir_tabela()
        garantir_tabela_categorias()
    except Exception as e:
        erro('Falha ao verificar tabelas no banco: {}'.format(e))
        sys.exit(1)

    # Executa
    if args.semanal:
        sucesso = rodar_analise_semanal(forcar=args.forcar)
    else:
        if args.data:
            try:
                from datetime import datetime as _dt
                _dt.strptime(args.data, '%Y-%m-%d')
                data_str = args.data
            except ValueError:
                erro('Data invalida: "{}". Use o formato YYYY-MM-DD.'.format(args.data))
                sys.exit(1)
        else:
            data_str = date.today().isoformat()

        sucesso = rodar_analise_diaria(data_str, forcar=args.forcar)

    print()
    if sucesso:
        ok('Concluido.')
    else:
        info('Nada foi salvo.')


if __name__ == '__main__':
    main()
