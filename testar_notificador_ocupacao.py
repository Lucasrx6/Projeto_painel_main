"""
Tester do Notificador de Ocupação Hospitalar
Envia um email de teste imediatamente para validar configuração.

Uso:
  python testar_notificador_ocupacao.py
  python testar_notificador_ocupacao.py email@destino.com
"""

import sys
import os
from dotenv import load_dotenv

load_dotenv()

# Permite sobrescrever destinatário via argumento
if len(sys.argv) > 1:
    os.environ['NOTIF_OCUPACAO_EMAILS'] = sys.argv[1]
    print(f"Destinatário: {sys.argv[1]}")
else:
    emails = os.getenv('NOTIF_OCUPACAO_EMAILS', '')
    if not emails:
        print("[ERRO] Configure NOTIF_OCUPACAO_EMAILS no .env ou passe o email como argumento:")
        print("       python testar_notificador_ocupacao.py email@destino.com")
        sys.exit(1)
    print(f"Destinatário: {emails}")

print()
print("=" * 55)
print(" TESTE — Notificador de Ocupação Hospitalar")
print("=" * 55)
print()

from backend.notificador_ocupacao_hospitalar import buscar_dados, gerar_excel, gerar_corpo_html, enviar_email
from datetime import datetime

now = datetime.now()

print("[1/3] Buscando dados do banco de dados...")
try:
    dashboard, cols_setor, setores, cols_pac, pacientes = buscar_dados()
    print(f"      Dashboard: ok")
    print(f"      Setores  : {len(setores)}")
    print(f"      Pacientes: {len(pacientes)}")
except Exception as e:
    print(f"[ERRO] Falha ao buscar dados: {e}")
    sys.exit(1)

print()
print("[2/3] Gerando Excel...")
try:
    caminho = gerar_excel(dashboard, cols_setor, setores, cols_pac, pacientes, now)
    tamanho = os.path.getsize(caminho) / 1024
    print(f"      Arquivo : {caminho}")
    print(f"      Tamanho : {tamanho:.1f} KB")
except Exception as e:
    print(f"[ERRO] Falha ao gerar Excel: {e}")
    sys.exit(1)

print()
print("[3/3] Enviando email...")
try:
    destinatarios = [e.strip() for e in os.getenv('NOTIF_OCUPACAO_EMAILS', '').split(',') if e.strip()]
    corpo_html = gerar_corpo_html(dashboard, setores, now)
    ok = enviar_email(destinatarios, corpo_html, caminho, now)

    if ok:
        print()
        print("=" * 55)
        print(" [OK] Email enviado com sucesso!")
        print("=" * 55)
    else:
        print()
        print("[ERRO] Falha no envio. Verifique as credenciais SMTP no .env")
except Exception as e:
    print(f"[ERRO] {e}")
finally:
    if os.path.exists(caminho):
        os.unlink(caminho)
