"""
Script para limpeza manual de logs antigos
Mantém apenas os últimos 3 dias
Uso: python scripts/limpar_logs.py
"""

import os
import sys
import glob
from datetime import datetime, timedelta
from pathlib import Path

# ========================================
# CONFIGURAÇÕES
# ========================================

# Detecta o diretório raiz do projeto (onde está o app.py)
SCRIPT_DIR = Path(__file__).resolve().parent  # pasta scripts/
PROJECT_DIR = SCRIPT_DIR.parent                # pasta raiz do projeto
LOGS_DIR = PROJECT_DIR / 'logs'                # pasta logs/

DIAS_RETENCAO = 3

def limpar_logs_antigos():
    """Remove logs com mais de 3 dias"""

    print("=" * 60)
    print("🧹 LIMPEZA DE LOGS ANTIGOS")
    print("=" * 60)
    print(f"📁 Diretório do Projeto: {PROJECT_DIR}")
    print(f"📂 Diretório de Logs: {LOGS_DIR}")
    print(f"📅 Retenção: {DIAS_RETENCAO} dias")
    print()

    # Verifica se a pasta logs existe
    if not LOGS_DIR.exists():
        print(f"❌ Diretório de logs não encontrado: {LOGS_DIR}")
        print(f"💡 Certifique-se de que a pasta 'logs' existe no projeto")
        return

    data_corte = datetime.now() - timedelta(days=DIAS_RETENCAO)
    print(f"🗓️  Data de corte: {data_corte.strftime('%Y-%m-%d %H:%M:%S')}")
    print(f"    (Arquivos modificados antes desta data serão removidos)")
    print()

    # Padrões de arquivos de log rotacionados
    padroes = [
        'painel.log.*',
        'worker_ia.log.*',
        'painel7_worker.log.*',
        'flask.log.*'
    ]

    total_removido = 0
    total_mantido = 0
    tamanho_liberado = 0

    print("🔍 Procurando arquivos de log rotacionados...")
    print()

    for padrao in padroes:
        # Busca arquivos com o padrão específico
        caminho_busca = LOGS_DIR / padrao
        arquivos = glob.glob(str(caminho_busca))

        if arquivos:
            print(f"📋 Padrão: {padrao}")

        for arquivo in arquivos:
            try:
                # Verifica data de modificação do arquivo
                timestamp = os.path.getmtime(arquivo)
                data_arquivo = datetime.fromtimestamp(timestamp)
                idade_dias = (datetime.now() - data_arquivo).days

                tamanho = os.path.getsize(arquivo)
                nome_arquivo = os.path.basename(arquivo)

                if data_arquivo < data_corte:
                    # REMOVER
                    os.remove(arquivo)
                    total_removido += 1
                    tamanho_liberado += tamanho

                    data_formatada = data_arquivo.strftime('%Y-%m-%d %H:%M:%S')
                    print(f"   🗑️  REMOVIDO: {nome_arquivo}")
                    print(f"       Modificado em: {data_formatada} ({idade_dias} dias atrás)")
                    print(f"       Tamanho: {tamanho / 1024:.1f} KB")
                else:
                    # MANTER
                    total_mantido += 1
                    data_formatada = data_arquivo.strftime('%Y-%m-%d %H:%M:%S')
                    print(f"   ✅ MANTIDO: {nome_arquivo}")
                    print(f"       Modificado em: {data_formatada} ({idade_dias} dias atrás)")
                    print(f"       Tamanho: {tamanho / 1024:.1f} KB")

            except Exception as e:
                print(f"   ❌ ERRO ao processar {os.path.basename(arquivo)}: {e}")

        if arquivos:
            print()

    # Listar arquivos .log atuais (não rotacionados)
    print("📄 Arquivos de log atuais (não serão removidos):")
    arquivos_atuais = list(LOGS_DIR.glob('*.log'))

    if arquivos_atuais:
        for arquivo in arquivos_atuais:
            tamanho = arquivo.stat().st_size
            print(f"   📌 {arquivo.name} ({tamanho / 1024:.1f} KB)")
    else:
        print("   (Nenhum arquivo .log ativo encontrado)")

    print()
    print("=" * 60)
    print("✅ LIMPEZA CONCLUÍDA")
    print("=" * 60)
    print(f"📊 Arquivos removidos: {total_removido}")
    print(f"📊 Arquivos mantidos: {total_mantido}")
    print(f"💾 Espaço liberado: {tamanho_liberado / 1024 / 1024:.2f} MB")
    print(f"📅 Retenção: últimos {DIAS_RETENCAO} dias")
    print()

    if total_removido == 0 and total_mantido == 0:
        print("ℹ️  OBSERVAÇÃO:")
        print("   Nenhum arquivo de log rotacionado foi encontrado.")
        print("   Isso é normal se:")
        print("   1. O sistema nunca fez rotação (ainda não passou da meia-noite)")
        print("   2. Todos os logs são recentes (menos de 3 dias)")
        print()

if __name__ == "__main__":
    print()
    limpar_logs_antigos()