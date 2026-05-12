"""
Tester do Notificador WhatsApp (CallMeBot)

Uso:
    python testar_notificador_whatsapp.py
    python testar_notificador_whatsapp.py "Mensagem personalizada"
    python testar_notificador_whatsapp.py "Mensagem" 556199999999
"""
import sys
import os
from dotenv import load_dotenv

load_dotenv()

# Logging simples para o tester
import logging
logging.basicConfig(
    level=logging.INFO,
    format='[%(asctime)s] %(levelname)s: %(message)s',
    datefmt='%H:%M:%S'
)

from backend.notificador_whatsapp import enviar_mensagem, enviar_para_todos

SEP = '─' * 55


def main():
    texto  = sys.argv[1] if len(sys.argv) > 1 else None
    phone  = sys.argv[2] if len(sys.argv) > 2 else None

    phone_env  = os.getenv('WHATSAPP_PHONE', '(não configurado)')
    phones_env = os.getenv('WHATSAPP_PHONES', '')
    apikey_env = os.getenv('WHATSAPP_APIKEY', '(não configurado)')

    print(f'\n{SEP}')
    print('  TESTE — Notificador WhatsApp (CallMeBot)')
    print(SEP)
    print(f'  WHATSAPP_PHONE  : {phone_env}')
    print(f'  WHATSAPP_PHONES : {phones_env or "(não configurado)"}')
    print(f'  WHATSAPP_APIKEY : {apikey_env}')
    print(SEP)

    # Define a mensagem de teste
    if not texto:
        texto = (
            '✅ *Painel Hospitalar* — Teste de notificação WhatsApp\n'
            'Se você recebeu esta mensagem, a integração CallMeBot está funcionando corretamente.'
        )

    print(f'  Mensagem: {texto[:80]}{"..." if len(texto) > 80 else ""}')
    print(SEP)

    # Envio para número específico (via argumento) ou para todos os configurados
    if phone:
        print(f'\n▶ Enviando para número informado: {phone}')
        ok = enviar_mensagem(texto, phone=phone)
        _resultado(ok, phone)
    else:
        print('\n▶ Enviando para todos os números configurados no .env...')
        resultados = enviar_para_todos(texto)

        if not resultados:
            print('\n⚠️  Nenhum número encontrado. Configure WHATSAPP_PHONE no .env')
            sys.exit(1)

        print(f'\n{SEP}')
        print('  RESULTADO FINAL')
        print(SEP)
        for numero, ok in resultados.items():
            status = '✅ Enviado' if ok else '❌ Falhou'
            print(f'  {status}  →  {numero}')
        print(SEP + '\n')

        if not all(resultados.values()):
            sys.exit(1)


def _resultado(ok: bool, phone: str):
    print(f'\n{SEP}')
    if ok:
        print(f'  ✅ Mensagem enviada com sucesso para {phone}')
    else:
        print(f'  ❌ Falha no envio para {phone}')
        print('  Verifique WHATSAPP_APIKEY e se o número está ativado no CallMeBot')
    print(SEP + '\n')
    if not ok:
        sys.exit(1)


if __name__ == '__main__':
    main()
