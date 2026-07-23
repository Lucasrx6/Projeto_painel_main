# -*- coding: utf-8 -*-
import os
import smtplib
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from email.mime.base import MIMEBase
from email import encoders
from backend.notificador_utils import render_email
from .config import logger
from .utils import _nome_setor, _cor_taxa


def gerar_corpo_html(dashboard, setores, now):
    taxa      = dashboard.get('taxa_ocupacao_geral', 0) or 0
    cor_taxa_val, status_taxa = _cor_taxa(taxa)
    ocupados  = dashboard.get('leitos_ocupados', 0) or 0
    total     = dashboard.get('total_leitos', 0) or 0
    livres    = dashboard.get('leitos_livres', 0) or 0
    higieniz  = dashboard.get('leitos_higienizacao', 0) or 0
    interdit  = dashboard.get('leitos_interditados', 0) or 0
    setores_n = dashboard.get('total_setores', 0) or 0
    perm      = dashboard.get('media_permanencia_geral', 0) or 0

    linhas = ""
    for i, s in enumerate(setores):
        bg       = "#FDECEA" if i % 2 == 0 else "#FFFFFF"
        nome     = _nome_setor(s)
        t_leitos = s.get('total_leitos') or s.get('leitos') or '-'
        t_ocup   = s.get('leitos_ocupados') or s.get('ocupados') or '-'
        t_livre  = s.get('leitos_livres') or s.get('livres') or '-'
        t_taxa   = s.get('taxa_ocupacao') or s.get('taxa_ocupacao_geral') or '-'
        cor_s, _ = _cor_taxa(t_taxa)
        taxa_fmt = '{}%'.format(t_taxa) if t_taxa != '-' else '-'
        linhas += """
        <tr style="background:{bg}">
          <td style="padding:6px 10px;border:1px solid #ddd">{nome}</td>
          <td style="padding:6px 10px;border:1px solid #ddd;text-align:center">{leitos}</td>
          <td style="padding:6px 10px;border:1px solid #ddd;text-align:center">{ocup}</td>
          <td style="padding:6px 10px;border:1px solid #ddd;text-align:center">{livre}</td>
          <td style="padding:6px 10px;border:1px solid #ddd;text-align:center;color:{cor_s};font-weight:bold">{taxa_fmt}</td>
        </tr>""".format(bg=bg, nome=nome, leitos=t_leitos, ocup=t_ocup, livre=t_livre, cor_s=cor_s, taxa_fmt=taxa_fmt)

    if setores:
        tabela = """
    <table style="width:100%;border-collapse:collapse;margin-top:8px;font-size:13px">
      <thead>
        <tr style="background:#dc3545;color:#fff">
          <th style="padding:8px 10px;border:1px solid #ddd;text-align:left">Setor</th>
          <th style="padding:8px 10px;border:1px solid #ddd">Total</th>
          <th style="padding:8px 10px;border:1px solid #ddd">Ocupados</th>
          <th style="padding:8px 10px;border:1px solid #ddd">Livres</th>
          <th style="padding:8px 10px;border:1px solid #ddd">Taxa</th>
        </tr>
      </thead>
      <tbody>{linhas}</tbody>
    </table>""".format(linhas=linhas)
    else:
        tabela = "<p style='color:#888'>Sem dados de setores.</p>"

    return render_email('ocupacao_hospitalar.html',
        taxa=taxa,
        cor_taxa=cor_taxa_val,
        status_taxa=status_taxa,
        ocupados=ocupados,
        total=total,
        livres=livres,
        higieniz=higieniz,
        interdit=interdit,
        setores_n=setores_n,
        perm=perm,
        tabela=tabela,
        data_hora=now.strftime('%d/%m/%Y as %H:%M')
    )


def enviar_email(destinatarios, corpo_html, caminho_excel, now):
    smtp_host = os.getenv('SMTP_HOST', '')
    smtp_port = int(os.getenv('SMTP_PORT', '587'))
    smtp_user = os.getenv('SMTP_USER', '')
    smtp_pass = os.getenv('SMTP_PASS', '')
    smtp_from = os.getenv('SMTP_FROM', '') or smtp_user

    if not smtp_host or not smtp_user or not smtp_pass:
        logger.error("SMTP nao configurado no .env")
        return False

    nome_arquivo = "Ocupacao_HAC_{}.xlsx".format(now.strftime('%d-%m-%Y_%H%M'))
    msg = MIMEMultipart('mixed')
    msg['Subject'] = "Ocupacao Hospitalar HAC - {}".format(now.strftime('%d/%m/%Y %H:%M'))
    msg['From']    = "Painel HAC <{}>".format(smtp_from)
    msg['To']      = ', '.join(destinatarios)
    msg.attach(MIMEText(corpo_html, 'html', 'utf-8'))

    with open(caminho_excel, 'rb') as f:
        part = MIMEBase('application', 'vnd.openxmlformats-officedocument.spreadsheetml.sheet')
        part.set_payload(f.read())
    encoders.encode_base64(part)
    part.add_header('Content-Disposition', 'attachment; filename="{}"'.format(nome_arquivo))
    msg.attach(part)

    try:
        server = smtplib.SMTP(smtp_host, smtp_port, timeout=30)
        server.ehlo()
        server.starttls()
        server.login(smtp_user, smtp_pass)
        server.sendmail(smtp_from, destinatarios, msg.as_bytes())
        server.quit()
        logger.info("Email enviado para: %s", ', '.join(destinatarios))
        return True
    except Exception as e:
        logger.error("Erro ao enviar email: %s", e)
        return False
