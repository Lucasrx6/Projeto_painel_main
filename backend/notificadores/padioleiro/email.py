# -*- coding: utf-8 -*-
import os
import smtplib
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from email.mime.base import MIMEBase
from email import encoders
from backend.notificador_utils import render_email
from .config import logger
from .utils import _data_pt, _data_hora_pt, _fmt


def gerar_html(resumo, por_padioleiro, por_setor, cancelados, now, nome_periodo):
    total        = resumo.get('total', 0) or 0
    concluidos   = resumo.get('concluidos', 0) or 0
    cancelados_n = resumo.get('cancelados', 0) or 0
    em_aberto    = resumo.get('em_aberto', 0) or 0
    urgentes     = resumo.get('urgentes', 0) or 0
    taxa_conclusao = f'{round(concluidos / total * 100)}%' if total else '--'

    linhas_pad = ''
    for p in por_padioleiro:
        linhas_pad += (
            '<tr>'
            f'<td style="padding:8px 12px;border-bottom:1px solid #eee;font-weight:600;">{p["padioleiro"]}</td>'
            f'<td style="padding:8px 12px;border-bottom:1px solid #eee;text-align:center;">{p["total"]}</td>'
            f'<td style="padding:8px 12px;border-bottom:1px solid #eee;text-align:center;color:#28a745;font-weight:700;">{p["concluidos"]}</td>'
            f'<td style="padding:8px 12px;border-bottom:1px solid #eee;text-align:center;color:#dc3545;">{p["cancelados"]}</td>'
            f'<td style="padding:8px 12px;border-bottom:1px solid #eee;text-align:center;color:#e67e00;font-weight:700;">{p["urgentes"]}</td>'
            f'<td style="padding:8px 12px;border-bottom:1px solid #eee;text-align:center;">{_fmt(p.get("media_aceite_min"), " min")}</td>'
            f'<td style="padding:8px 12px;border-bottom:1px solid #eee;text-align:center;">{_fmt(p.get("media_transporte_min"), " min")}</td>'
            f'<td style="padding:8px 12px;border-bottom:1px solid #eee;text-align:center;">{_fmt(p.get("media_total_min"), " min")}</td>'
            '</tr>'
        )
    if not linhas_pad:
        linhas_pad = '<tr><td colspan="8" style="padding:16px;text-align:center;color:#aaa;">Nenhum chamado no periodo</td></tr>'

    linhas_set = ''
    for s in por_setor:
        linhas_set += (
            '<tr>'
            f'<td style="padding:8px 12px;border-bottom:1px solid #eee;font-weight:600;">{s["setor"]}</td>'
            f'<td style="padding:8px 12px;border-bottom:1px solid #eee;text-align:center;">{s["total"]}</td>'
            f'<td style="padding:8px 12px;border-bottom:1px solid #eee;text-align:center;color:#28a745;font-weight:700;">{s["concluidos"]}</td>'
            f'<td style="padding:8px 12px;border-bottom:1px solid #eee;text-align:center;color:#dc3545;">{s["cancelados"]}</td>'
            f'<td style="padding:8px 12px;border-bottom:1px solid #eee;text-align:center;color:#e67e00;font-weight:700;">{s["urgentes"]}</td>'
            '</tr>'
        )
    if not linhas_set:
        linhas_set = '<tr><td colspan="5" style="padding:16px;text-align:center;color:#aaa;">Nenhum chamado no periodo</td></tr>'

    bloco_cancelados = ''
    if cancelados:
        linhas_canc = ''
        for c in cancelados:
            linhas_canc += (
                '<tr>'
                f'<td style="padding:8px 12px;border-bottom:1px solid #eee;text-align:center;color:#aaa;">{c.get("hora_criacao","--")} -> {c.get("hora_cancelamento","--")}</td>'
                f'<td style="padding:8px 12px;border-bottom:1px solid #eee;">{c.get("nm_paciente","--")}</td>'
                f'<td style="padding:8px 12px;border-bottom:1px solid #eee;">{c.get("setor_origem_nome","--")}</td>'
                f'<td style="padding:8px 12px;border-bottom:1px solid #eee;">{c.get("destino_nome","--")}</td>'
                f'<td style="padding:8px 12px;border-bottom:1px solid #eee;">{c.get("padioleiro_nome","--")}</td>'
                f'<td style="padding:8px 12px;border-bottom:1px solid #eee;color:#dc3545;">{c.get("motivo_cancelamento","--")}</td>'
                '</tr>'
            )
        bloco_cancelados = f"""
        <h3 style="color:#9B1C24;font-size:16px;margin:32px 0 12px;">Cancelamentos do Dia ({len(cancelados)})</h3>
        <table style="width:100%;border-collapse:collapse;border-radius:8px;overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,.08);">
          <thead><tr style="background:#9B1C24;">
            <th style="padding:10px 12px;color:#fff;font-size:13px;">Horario</th>
            <th style="padding:10px 12px;color:#fff;text-align:left;font-size:13px;">Paciente</th>
            <th style="padding:10px 12px;color:#fff;text-align:left;font-size:13px;">Origem</th>
            <th style="padding:10px 12px;color:#fff;text-align:left;font-size:13px;">Destino</th>
            <th style="padding:10px 12px;color:#fff;text-align:left;font-size:13px;">Padioleiro</th>
            <th style="padding:10px 12px;color:#fff;text-align:left;font-size:13px;">Motivo</th>
          </tr></thead>
          <tbody>{linhas_canc}</tbody>
        </table>"""

    return render_email('padioleiro_relatorio.html',
        data_hora=_data_hora_pt(now),
        data_hora_rodape=now.strftime('%d/%m/%Y as %H:%M'),
        nome_periodo=nome_periodo,
        total=total,
        concluidos=concluidos,
        cancelados_n=cancelados_n,
        em_aberto=em_aberto,
        urgentes=urgentes,
        taxa_conclusao=taxa_conclusao,
        media_aceite=_fmt(resumo.get('media_aceite_min'), ' min'),
        media_total=_fmt(resumo.get('media_total_min'), ' min'),
        linhas_pad=linhas_pad,
        linhas_set=linhas_set,
        bloco_cancelados=bloco_cancelados
    )


def enviar_email(destinatarios, html, excel_path, now, nome_periodo, turno):
    smtp_host = os.getenv('SMTP_HOST', '')
    smtp_port = int(os.getenv('SMTP_PORT', '587'))
    smtp_user = os.getenv('SMTP_USER', '')
    smtp_pass = os.getenv('SMTP_PASS', '')
    smtp_from = os.getenv('SMTP_FROM', '') or smtp_user

    if not smtp_host or not smtp_user or not smtp_pass:
        logger.error("SMTP nao configurado no .env")
        return False

    nome_excel = f"Padioleiro_HAC_{now.strftime('%d-%m-%Y')}_{turno}.xlsx"
    msg = MIMEMultipart('mixed')
    msg['Subject'] = f"Movimentacoes Padioleiro HAC — {nome_periodo} — {_data_pt(now)}"
    msg['From']    = f"Painel HAC <{smtp_from}>"
    msg['To']      = ', '.join(destinatarios)
    msg.attach(MIMEText(html, 'html', 'utf-8'))

    with open(excel_path, 'rb') as f:
        part = MIMEBase('application', 'vnd.openxmlformats-officedocument.spreadsheetml.sheet')
        part.set_payload(f.read())
    encoders.encode_base64(part)
    part.add_header('Content-Disposition', f'attachment; filename="{nome_excel}"')
    msg.attach(part)

    try:
        server = smtplib.SMTP(smtp_host, smtp_port, timeout=30)
        server.ehlo(); server.starttls()
        server.login(smtp_user, smtp_pass)
        server.sendmail(smtp_from, destinatarios, msg.as_bytes())
        server.quit()
        logger.info("Email enviado para: %s", ', '.join(destinatarios))
        return True
    except Exception as e:
        logger.error("Erro ao enviar email: %s", e)
        return False
