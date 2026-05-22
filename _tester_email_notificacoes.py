# -*- coding: utf-8 -*-
"""
_tester_email_notificacoes.py
=====================================================
Testa os componentes de email e notificação alterados
na refatoração das fases 4–7:

  1. notificador_utils.py  — get_smtp_config / get_db_config / setup_notificador_logging
  2. Jinja2 template       — backend/templates_email/reset_senha.html
  3. Email via smtplib     — caminho do auth.py (_enviar_email_pin)
  4. Email via Apprise     — caminho dos notificadores (mailtos://)

Uso:
    python _tester_email_notificacoes.py
    python _tester_email_notificacoes.py --sem-envio   # apenas valida, não envia

Destinatário de teste fixo neste script: lucas.oliveira@saofranciscodf.med.br
=====================================================
"""

import os
import sys
import argparse
import smtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from urllib.parse import quote as url_encode

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, BASE_DIR)

from dotenv import load_dotenv
load_dotenv(os.path.join(BASE_DIR, '.env'))

DESTINATARIO = 'lucas.oliveira@saofranciscodf.med.br'

# ─────────────────────────────────────────────────────────────────────────────
# Utilitário de resultado
# ─────────────────────────────────────────────────────────────────────────────

_resultados = []


def ok(msg):
    print(f'  [OK]  {msg}')
    _resultados.append(('OK', msg))


def fail(msg, detalhe=''):
    txt = f'  [FAIL] {msg}'
    if detalhe:
        txt += f'\n         {detalhe}'
    print(txt)
    _resultados.append(('FAIL', msg))


def secao(titulo):
    print(f'\n{"=" * 60}')
    print(f'  {titulo}')
    print('=' * 60)


# ─────────────────────────────────────────────────────────────────────────────
# 1. notificador_utils.py
# ─────────────────────────────────────────────────────────────────────────────

def testar_notificador_utils():
    secao('1. backend/notificador_utils.py')

    # Import
    try:
        from backend.notificador_utils import get_smtp_config, get_db_config, setup_notificador_logging
        ok('Import backend.notificador_utils bem-sucedido')
    except Exception as e:
        fail('Falha ao importar backend.notificador_utils', str(e))
        return None, None

    # get_smtp_config
    try:
        smtp = get_smtp_config()
        campos_smtp = ['host', 'port', 'user', 'password', 'sender']
        faltando = [c for c in campos_smtp if c not in smtp]
        if faltando:
            fail('get_smtp_config() — campos ausentes: ' + ', '.join(faltando))
        else:
            ok(f'get_smtp_config() — host={smtp["host"]} port={smtp["port"]}')
            if smtp['user']:
                ok(f'  SMTP_USER configurado: {smtp["user"][:4]}...@{smtp["user"].split("@")[-1] if "@" in smtp["user"] else "?"}')
            else:
                fail('  SMTP_USER vazio no .env — envio de email vai falhar')
            if smtp['password']:
                ok('  SMTP_PASS configurado')
            else:
                fail('  SMTP_PASS vazio no .env — envio de email vai falhar')
    except Exception as e:
        fail('get_smtp_config() lançou exceção', str(e))
        smtp = {}

    # get_db_config
    try:
        db = get_db_config()
        campos_db = ['host', 'database', 'user', 'password', 'port', 'connect_timeout']
        faltando = [c for c in campos_db if c not in db]
        if faltando:
            fail('get_db_config() — campos ausentes: ' + ', '.join(faltando))
        else:
            ok(f'get_db_config() — host={db["host"]} database={db["database"]} port={db["port"]}')
    except Exception as e:
        fail('get_db_config() lançou exceção', str(e))

    # setup_notificador_logging
    try:
        os.makedirs(os.path.join(BASE_DIR, 'logs'), exist_ok=True)
        logger = setup_notificador_logging('_tester', '_tester.log')
        logger.info('Logger de teste OK')
        ok('setup_notificador_logging() — logger criado, handlers: ' + str(len(logger.handlers)))
    except Exception as e:
        fail('setup_notificador_logging() lançou exceção', str(e))

    return get_smtp_config, get_db_config


# ─────────────────────────────────────────────────────────────────────────────
# 2. Template Jinja2 — reset_senha.html
# ─────────────────────────────────────────────────────────────────────────────

def testar_template():
    secao('2. Jinja2 template — backend/templates_email/reset_senha.html')

    template_path = os.path.join(BASE_DIR, 'backend', 'templates_email', 'reset_senha.html')

    # Arquivo existe?
    if os.path.isfile(template_path):
        ok(f'Arquivo existe: {template_path}')
    else:
        fail('Arquivo NÃO encontrado: ' + template_path)
        return None

    # Renderização
    try:
        from jinja2 import Environment, FileSystemLoader
        env = Environment(
            loader=FileSystemLoader(os.path.join(BASE_DIR, 'backend', 'templates_email')),
            autoescape=True
        )
        html = env.get_template('reset_senha.html').render(
            usuario='lucas.teste',
            pin='4729',
            expira_min=10,
            gerado_em='21/05/2026 12:30'
        )
        if '4729' in html and 'lucas.teste' in html and '10 minutos' in html:
            ok('Renderização OK — variáveis substituídas corretamente')
        else:
            fail('Renderização incompleta — alguma variável não foi substituída')
        return html
    except Exception as e:
        fail('Erro ao renderizar template', str(e))
        return None


# ─────────────────────────────────────────────────────────────────────────────
# 3. Email via smtplib — caminho de auth.py (_enviar_email_pin)
# ─────────────────────────────────────────────────────────────────────────────

def testar_smtp_direto(corpo_html, enviar=True):
    secao('3. Email via smtplib (caminho auth.py > _enviar_email_pin)')

    if corpo_html is None:
        fail('Template inválido — teste de email ignorado')
        return

    from backend.notificador_utils import get_smtp_config
    smtp = get_smtp_config()

    if not smtp['user'] or not smtp['password'] or not smtp['host']:
        fail('SMTP não configurado no .env — teste ignorado')
        return

    if not enviar:
        ok('--sem-envio ativo — envio smtplib pulado (config OK)')
        return

    try:
        msg = MIMEMultipart('alternative')
        msg['Subject'] = '[TESTE] Código de Verificação — Sistema de Painéis HAC'
        msg['From'] = f"Sistema Paineis HAC <{smtp['sender'] or smtp['user']}>"
        msg['To'] = DESTINATARIO

        msg.attach(MIMEText(corpo_html, 'html'))

        server = smtplib.SMTP(smtp['host'], smtp['port'])
        server.starttls()
        server.login(smtp['user'], smtp['password'])
        server.send_message(msg)
        server.quit()

        ok(f'Email smtplib enviado para {DESTINATARIO}')
        ok('  Assunto: [TESTE] Código de Verificação — Sistema de Painéis HAC')
        ok('  Template reset_senha.html renderizado com usuario=lucas.teste, pin=4729')
    except Exception as e:
        fail(f'Falha ao enviar via smtplib', str(e))


# ─────────────────────────────────────────────────────────────────────────────
# 4. Email via Apprise — caminho dos notificadores
# ─────────────────────────────────────────────────────────────────────────────

def testar_apprise(enviar=True):
    secao('4. Email via Apprise (caminho notificadores — mailtos://)')

    try:
        import apprise
        ok(f'Import apprise OK — versão: {apprise.__version__}')
    except Exception as e:
        fail('Falha ao importar apprise', str(e))
        return

    from backend.notificador_utils import get_smtp_config
    smtp = get_smtp_config()

    if not smtp['user'] or not smtp['password'] or not smtp['host']:
        fail('SMTP não configurado no .env — teste ignorado')
        return

    if not enviar:
        ok('--sem-envio ativo — envio Apprise pulado (config OK)')
        return

    try:
        ap = apprise.Apprise()

        user_enc = url_encode(smtp['user'], safe='')
        pass_enc = url_encode(smtp['password'], safe='')
        from_addr = smtp['sender'] or smtp['user']

        url = 'mailtos://{user}:{pwd}@{host}:{port}?from={sender}&to={to}&name=Teste+Tasy'.format(
            user=user_enc,
            pwd=pass_enc,
            host=smtp['host'],
            port=smtp['port'],
            sender=url_encode(from_addr, safe=''),
            to=url_encode(DESTINATARIO, safe='')
        )
        ap.add(url)

        corpo = """
        <div style="font-family: sans-serif; max-width: 500px; margin: 0 auto; padding: 20px;
                    border: 1px solid #dee2e6; border-radius: 8px;">
            <h3 style="color: #dc3545;">Teste — Envio via Apprise (Notificadores)</h3>
            <p>Este email confirma que o canal <strong>Apprise / mailtos://</strong>
               usado pelos notificadores está funcionando após a refatoração.</p>
            <ul>
                <li>notificador_pareceres.py ✅</li>
                <li>notificador_sentir_agir.py ✅</li>
                <li>notificador_paciente_ps.py ✅</li>
                <li>worker_tests_sistema.py ✅</li>
            </ul>
            <p style="color: #666; font-size: 12px;">
                Configuração lida via <code>get_smtp_config()</code> de
                <code>backend/notificador_utils.py</code>
            </p>
        </div>
        """

        resultado = ap.notify(
            title='[TESTE] Notificadores HAC — Email via Apprise',
            body=corpo,
            body_format=apprise.NotifyFormat.HTML,
            notify_type=apprise.NotifyType.INFO
        )

        if resultado:
            ok(f'Email Apprise enviado para {DESTINATARIO}')
            ok('  Assunto: [TESTE] Notificadores HAC — Email via Apprise')
        else:
            fail('Apprise retornou False — envio falhou')
    except Exception as e:
        fail('Exceção ao enviar via Apprise', str(e))


# ─────────────────────────────────────────────────────────────────────────────
# Resumo
# ─────────────────────────────────────────────────────────────────────────────

def resumo():
    total = len(_resultados)
    falhas = [r for r in _resultados if r[0] == 'FAIL']
    print(f'\n{"=" * 60}')
    print(f'  RESUMO: {total - len(falhas)}/{total} verificações OK')
    if falhas:
        print(f'  FALHAS ({len(falhas)}):')
        for _, msg in falhas:
            print(f'    - {msg}')
    else:
        print('  Tudo OK!')
    print('=' * 60)
    return len(falhas) == 0


# ─────────────────────────────────────────────────────────────────────────────
# Main
# ─────────────────────────────────────────────────────────────────────────────

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description='Tester de email e notificações HAC')
    parser.add_argument('--sem-envio', action='store_true',
                        help='Valida configuração sem enviar emails de verdade')
    args = parser.parse_args()
    enviar = not args.sem_envio

    if enviar:
        print(f'\nModo: ENVIO REAL para {DESTINATARIO}')
    else:
        print('\nModo: --sem-envio (só valida configuração)')

    testar_notificador_utils()
    html = testar_template()
    testar_smtp_direto(html, enviar=enviar)
    testar_apprise(enviar=enviar)

    ok = resumo()
    sys.exit(0 if ok else 1)
