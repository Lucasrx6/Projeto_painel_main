# -*- coding: utf-8 -*-
"""
Teste de Captura de Resposta por Email
=======================================
1. Envia email de teste para o destinatario com um token unico no assunto
2. Fica monitorando a caixa IMAP a cada 60s aguardando a resposta
3. Quando a resposta chega, exibe o conteudo e encerra

Execucao:
    python teste_email_resposta.py

Dependencias: apenas stdlib (imaplib, smtplib, email) + dotenv
"""

import imaplib
import smtplib
import email
import email.mime.text
import email.mime.multipart
import email.header
import os
import re
import time
import secrets
import logging
import sys
from datetime import datetime
from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(os.path.abspath(__file__)), '.env'))

# =========================================================
# CONFIGURACAO
# =========================================================

SMTP_HOST = os.getenv('SMTP_HOST', 'smtp.gmail.com')
SMTP_PORT = int(os.getenv('SMTP_PORT', 587))
SMTP_USER = os.getenv('SMTP_USER', '')
SMTP_PASS = os.getenv('SMTP_PASS', '')

IMAP_HOST = os.getenv('IMAP_HOST', 'imap.gmail.com')
IMAP_PORT = int(os.getenv('IMAP_PORT', 993))

DESTINATARIO   = 'lucas.oliveira@saofranciscodf.med.br'
INTERVALO_SEG  = 60   # verificar a cada 60 segundos
TIMEOUT_MIN    = 30   # desistir apos 30 minutos sem resposta

# =========================================================
# LOGGING
# =========================================================

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(levelname)s] %(message)s',
    datefmt='%H:%M:%S',
    handlers=[logging.StreamHandler(sys.stdout)]
)
log = logging.getLogger('teste_email')


# =========================================================
# ENVIO
# =========================================================

def enviar_email_teste(destinatario: str, token: str) -> bool:
    assunto = f'[TESTE:{token}] Sistema Hospitalar — Por favor responda'

    corpo_html = f"""
<div style="font-family: Arial, sans-serif; max-width: 600px; padding: 20px;">
    <h2 style="color: #2c5aa0; border-bottom: 2px solid #eee; padding-bottom: 10px;">
        Teste de Captura de Resposta por Email
    </h2>
    <p>Olá,</p>
    <p>Este é um email de <strong>teste</strong> do sistema hospitalar.</p>
    <p>Por favor, <strong>responda este email</strong> com qualquer mensagem —
       o sistema irá capturar e confirmar o recebimento.</p>
    <p>Você pode escrever qualquer coisa como resposta, por exemplo:<br>
       <em>"Recebi, pode prosseguir."</em></p>
    <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;">
    <p style="color: #999; font-size: 11px;">
        Token de referência: <code>[TESTE:{token}]</code><br>
        Mantenha o assunto do email ao responder para que o sistema identifique a resposta.
    </p>
</div>
"""

    msg = email.mime.multipart.MIMEMultipart('alternative')
    msg['Subject'] = assunto
    msg['From']    = SMTP_USER
    msg['To']      = destinatario
    msg['Reply-To'] = SMTP_USER
    msg.attach(email.mime.text.MIMEText(corpo_html, 'html', 'utf-8'))

    try:
        with smtplib.SMTP(SMTP_HOST, SMTP_PORT, timeout=15) as smtp:
            smtp.ehlo()
            smtp.starttls()
            smtp.ehlo()
            smtp.login(SMTP_USER, SMTP_PASS)
            smtp.sendmail(SMTP_USER, [destinatario], msg.as_bytes())
        log.info('Email enviado para %s', destinatario)
        log.info('Assunto: %s', assunto)
        return True
    except Exception as e:
        log.error('Falha ao enviar email: %s', e)
        return False


# =========================================================
# PARSING
# =========================================================

def _decodificar_header(valor: str) -> str:
    """Decodifica header MIME (encoded-words)."""
    if not valor:
        return ''
    partes = email.header.decode_header(valor)
    resultado = []
    for parte, charset in partes:
        if isinstance(parte, bytes):
            resultado.append(parte.decode(charset or 'utf-8', errors='replace'))
        else:
            resultado.append(parte)
    return ''.join(resultado)


def _extrair_texto(msg) -> str:
    """Extrai o texto novo da resposta (ignora quoted text e assinatura)."""
    corpo = ''

    if msg.is_multipart():
        for part in msg.walk():
            if part.get_content_type() == 'text/plain':
                try:
                    corpo = part.get_payload(decode=True).decode(
                        part.get_content_charset() or 'utf-8', errors='replace'
                    )
                    break
                except Exception:
                    pass
    else:
        try:
            corpo = msg.get_payload(decode=True).decode(
                msg.get_content_charset() or 'utf-8', errors='replace'
            )
        except Exception:
            corpo = str(msg.get_payload())

    # Remove quoted text (linhas que comecam com ">")
    # e o cabecalho do reply ("On ... wrote:")
    linhas_limpas = []
    for linha in corpo.splitlines():
        if linha.startswith('>'):
            break
        # Padrao do Outlook/Gmail: "Em <data>, <nome> escreveu:"
        if re.match(r'^(On |Em |De:|From:).{0,80}wrote:|escreveu:', linha, re.IGNORECASE):
            break
        linhas_limpas.append(linha)

    return '\n'.join(linhas_limpas).strip()


# =========================================================
# IMAP POLLING
# =========================================================

def verificar_respostas(imap_conn, token: str) -> bool:
    """
    Verifica a caixa INBOX buscando emails com o token no assunto.
    Retorna True se encontrou uma resposta valida.
    """
    token_re = re.compile(rf'\[TESTE:{re.escape(token)}\]', re.IGNORECASE)

    try:
        imap_conn.select('INBOX')
        # Busca todos os emails (lidos e nao lidos) — resposta pode ja ter sido vista
        _, nums = imap_conn.search(None, 'ALL')
        if not nums[0]:
            return False

        ids = nums[0].split()
        # Verifica os mais recentes primeiro
        for num in reversed(ids[-50:]):
            _, data = imap_conn.fetch(num, '(RFC822)')
            raw = data[0][1]
            msg = email.message_from_bytes(raw)

            assunto_raw = msg.get('Subject', '')
            assunto     = _decodificar_header(assunto_raw)

            if not token_re.search(assunto):
                continue

            # Garante que nao e o email original (checar se e uma resposta)
            remetente = _decodificar_header(msg.get('From', ''))
            if SMTP_USER.lower() in remetente.lower() and DESTINATARIO.lower() not in remetente.lower():
                # E um email enviado por nos mesmos (o original), nao uma resposta
                continue

            corpo  = _extrair_texto(msg)
            horario = _decodificar_header(msg.get('Date', ''))

            print()
            print('=' * 60)
            print('  RESPOSTA CAPTURADA COM SUCESSO!')
            print('=' * 60)
            print(f'  De:      {remetente}')
            print(f'  Assunto: {assunto}')
            print(f'  Data:    {horario}')
            print()
            print('  Mensagem:')
            print('  ' + '\n  '.join((corpo[:800] or '(vazia)').splitlines()))
            print('=' * 60)
            print()
            log.info('Resposta capturada de: %s', remetente)
            return True

    except imaplib.IMAP4.abort:
        log.warning('Conexao IMAP encerrada pelo servidor — reconectando na proxima verificacao')
        raise
    except Exception as e:
        log.error('Erro ao verificar IMAP: %s', e)

    return False


def conectar_imap() -> imaplib.IMAP4_SSL:
    imap = imaplib.IMAP4_SSL(IMAP_HOST, IMAP_PORT)
    imap.login(SMTP_USER, SMTP_PASS)
    return imap


# =========================================================
# MAIN
# =========================================================

def main():
    print()
    print('=' * 60)
    print('  TESTE DE CAPTURA DE RESPOSTA POR EMAIL')
    print('=' * 60)
    print(f'  Remetente: {SMTP_USER}')
    print(f'  Destinatário: {DESTINATARIO}')
    print(f'  IMAP: {IMAP_HOST}:{IMAP_PORT}')
    print(f'  Polling a cada: {INTERVALO_SEG}s')
    print('=' * 60)
    print()

    # Gera token unico para este teste
    token = secrets.token_hex(4).upper()
    log.info('Token gerado: %s', token)

    # Envia o email
    if not enviar_email_teste(DESTINATARIO, token):
        log.error('Nao foi possivel enviar o email. Verifique as credenciais SMTP.')
        sys.exit(1)

    # Conecta IMAP
    log.info('Conectando ao IMAP (%s:%s)...', IMAP_HOST, IMAP_PORT)
    try:
        imap = conectar_imap()
        log.info('IMAP conectado. Aguardando resposta de %s...', DESTINATARIO)
    except Exception as e:
        log.error('Falha ao conectar IMAP: %s', e)
        log.error('Verifique se IMAP esta habilitado na conta Google Workspace.')
        sys.exit(1)

    # Loop de polling
    inicio   = time.time()
    tentativa = 0
    timeout_seg = TIMEOUT_MIN * 60

    try:
        while True:
            tentativa += 1
            decorrido = int(time.time() - inicio)
            log.info('[Tentativa %d | %ds decorridos] Verificando caixa de entrada...', tentativa, decorrido)

            try:
                if verificar_respostas(imap, token):
                    log.info('Teste concluido com sucesso!')
                    break
            except imaplib.IMAP4.abort:
                try:
                    imap = conectar_imap()
                    log.info('IMAP reconectado.')
                except Exception as e:
                    log.error('Falha ao reconectar IMAP: %s', e)

            if decorrido >= timeout_seg:
                log.warning('Timeout de %d minutos atingido sem resposta. Encerrando.', TIMEOUT_MIN)
                break

            log.info('Nenhuma resposta ainda. Proxima verificacao em %ds...', INTERVALO_SEG)
            time.sleep(INTERVALO_SEG)
    finally:
        try:
            imap.logout()
        except Exception:
            pass


if __name__ == '__main__':
    main()
