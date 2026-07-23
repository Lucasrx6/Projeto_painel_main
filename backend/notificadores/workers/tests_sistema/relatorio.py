# -*- coding: utf-8 -*-
from datetime import datetime, timedelta
from .config import (
    logger, SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM,
    EMAIL_RELATORIO, INTERVALO_HORAS,
)

_TITULOS_CAT = {
    'servidor':      '1. Servidor (CPU / RAM / Disco / Uptime)',
    'infra':         '2. Infraestrutura (Redis / SMTP)',
    'tabelas':       '3. Tabelas Críticas',
    'views':         '4. Views Críticas',
    'constraints':   '5. Constraints e Colunas',
    'pg_saude':      '6. Saúde do PostgreSQL',
    'hop':           '7. Apache HOP (ETL Tasy → PostgreSQL)',
    'notificadores': '8. Notificadores',
    'dados':         '9. Dados Operacionais',
    'workers':       '10. Workers Flask (Threads Daemon)',
}


def montar_saida_terminal(resultados, reparos, duracao):
    """Gera string de saída no estilo terminal para o frontend e logs."""
    linhas = []
    agora  = datetime.now().strftime('%d/%m/%Y %H:%M:%S')

    linhas.append('=' * 70)
    linhas.append('  VERIFICAÇÃO DO SISTEMA — Hospital Anchieta Ceilandia')
    linhas.append('  Executado em: {}'.format(agora))
    linhas.append('=' * 70)

    cat_atual = None
    for r in resultados:
        if r['categoria'] != cat_atual:
            cat_atual = r['categoria']
            linhas.append('')
            linhas.append('─' * 70)
            linhas.append('  ' + _TITULOS_CAT.get(cat_atual, cat_atual.upper()))
            linhas.append('─' * 70)

        nivel = r.get('nivel', 'ok' if r['ok'] else 'erro')
        if nivel == 'aviso':
            icone = '[AVISO] '
        elif r['ok']:
            icone = '[OK]    '
        else:
            icone = '[ERRO]  '

        item_fmt = (r['item'] + ' ').ljust(50, '.')
        linhas.append('{}{} {}'.format(icone, item_fmt, r['detalhe']))

    if reparos:
        linhas.append('')
        linhas.append('─' * 70)
        linhas.append('  REPAROS AUTOMÁTICOS APLICADOS')
        linhas.append('─' * 70)
        for item, ok, detalhe in reparos:
            icone = '[REP]   ' if ok else '[FALHOU]'
            linhas.append('{}{} {}'.format(icone, (item + ' ').ljust(50, '.'), detalhe))

    total  = len(resultados)
    erros  = sum(1 for r in resultados if not r['ok'])
    avisos = sum(1 for r in resultados if r.get('nivel') == 'aviso')
    ok_qt  = total - erros - avisos
    rep_ok = sum(1 for _, ok, _ in reparos if ok)

    linhas.append('')
    linhas.append('=' * 70)
    linhas.append('  RESULTADO: {} OK | {} AVISO(S) | {} ERRO(S) | {} REPARO(S) | {:.1f}s'.format(
        ok_qt, avisos, erros, rep_ok, duracao))
    linhas.append('=' * 70)

    return '\n'.join(linhas)


def montar_email_html(resultados, reparos, duracao):
    agora  = datetime.now().strftime('%d/%m/%Y %H:%M')
    total  = len(resultados)
    erros  = sum(1 for r in resultados if not r['ok'])
    avisos = sum(1 for r in resultados if r.get('nivel') == 'aviso')
    ok_qt  = total - erros - avisos
    rep_ok = sum(1 for _, ok, _ in reparos if ok)

    if erros > 0:
        cor_hdr = '#dc3545'
        status  = '{} ERRO(S) DETECTADO(S)'.format(erros)
    elif avisos > 0:
        cor_hdr = '#fd7e14'
        status  = 'SISTEMA OK COM {} AVISO(S)'.format(avisos)
    else:
        cor_hdr = '#28a745'
        status  = 'SISTEMA SAUDÁVEL'

    linhas_resultados = ''
    cat_atual = None
    for r in resultados:
        if r['categoria'] != cat_atual:
            cat_atual    = r['categoria']
            titulo_cat   = _TITULOS_CAT.get(cat_atual, cat_atual.upper())
            linhas_resultados += '''
        <tr>
            <td colspan="4" style="padding:6px 10px;background:#f0f4f8;
                font-size:11px;font-weight:700;color:#374151;
                text-transform:uppercase;letter-spacing:.6px;
                border-bottom:2px solid #d1d5db;">{}</td>
        </tr>'''.format(titulo_cat)

        nivel = r.get('nivel', 'ok' if r['ok'] else 'erro')
        if nivel == 'aviso':
            cor, icone, bg = '#856404', '⚠', '#fffbeb'
        elif r['ok']:
            cor, icone, bg = '#166534', '✓', '#f0fdf4'
        else:
            cor, icone, bg = '#991b1b', '✗', '#fff1f2'

        linhas_resultados += '''
        <tr style="background:{bg};">
            <td style="padding:7px 10px;border-bottom:1px solid #e5e7eb;
                font-size:11px;color:#6b7280;text-transform:uppercase;">{cat}</td>
            <td style="padding:7px 10px;border-bottom:1px solid #e5e7eb;
                font-size:13px;font-weight:500;">{item}</td>
            <td style="padding:7px 10px;border-bottom:1px solid #e5e7eb;
                text-align:center;">
                <span style="color:{cor};font-weight:700;font-size:17px;">{icone}</span>
            </td>
            <td style="padding:7px 10px;border-bottom:1px solid #e5e7eb;
                font-size:12px;color:#4b5563;">{detalhe}</td>
        </tr>'''.format(
            bg=bg, cat=r['categoria'], item=r['item'],
            cor=cor, icone=icone, detalhe=r['detalhe']
        )

    secao_reparos = ''
    if reparos:
        linhas_reparos = ''
        for item, ok, detalhe in reparos:
            cor   = '#166534' if ok else '#991b1b'
            icone = '🔧' if ok else '✗'
            linhas_reparos += '''
            <tr>
                <td style="padding:7px 10px;border-bottom:1px solid #e5e7eb;
                    font-size:13px;">{item}</td>
                <td style="padding:7px 10px;border-bottom:1px solid #e5e7eb;
                    text-align:center;color:{cor};font-weight:700;font-size:16px;">{icone}</td>
                <td style="padding:7px 10px;border-bottom:1px solid #e5e7eb;
                    font-size:12px;color:#4b5563;">{detalhe}</td>
            </tr>'''.format(item=item, cor=cor, icone=icone, detalhe=detalhe)

        secao_reparos = '''
        <div style="margin-top:20px;">
            <h3 style="font-size:14px;font-weight:600;color:#92400e;margin:0 0 8px;">
                🔧 Reparos Automáticos Aplicados
            </h3>
            <table style="width:100%;border-collapse:collapse;">
                <thead>
                    <tr style="background:#fef3c7;">
                        <th style="padding:8px 10px;text-align:left;font-size:11px;
                            color:#92400e;text-transform:uppercase;">Item</th>
                        <th style="padding:8px 10px;text-align:center;font-size:11px;
                            color:#92400e;text-transform:uppercase;width:60px;">Status</th>
                        <th style="padding:8px 10px;text-align:left;font-size:11px;
                            color:#92400e;text-transform:uppercase;">Detalhe</th>
                    </tr>
                </thead>
                <tbody>{}</tbody>
            </table>
        </div>'''.format(linhas_reparos)

    proximo    = (datetime.now() + timedelta(hours=INTERVALO_HORAS)).strftime('%d/%m/%Y às %H:%M')
    cor_erros  = '#dc3545' if erros > 0 else '#6b7280'

    return '''
<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;
     max-width:750px;margin:0 auto;padding:20px;">

    <div style="background:{cor_hdr};color:white;padding:16px 20px;border-radius:8px 8px 0 0;">
        <h2 style="margin:0;font-size:18px;">🏥 Relatório de Saúde do Sistema — HAC</h2>
        <p style="margin:6px 0 0;font-size:13px;opacity:.9;">{status} &mdash; {agora}</p>
    </div>

    <div style="border:1px solid #d1d5db;border-top:none;border-radius:0 0 8px 8px;overflow:hidden;">

        <div style="display:flex;border-bottom:1px solid #d1d5db;">
            <div style="flex:1;padding:14px;text-align:center;background:#f9fafb;">
                <div style="font-size:26px;font-weight:700;color:#166534;">{ok_qt}</div>
                <div style="font-size:11px;color:#6b7280;text-transform:uppercase;">OK</div>
            </div>
            <div style="flex:1;padding:14px;text-align:center;background:#fffbeb;
                border-left:1px solid #d1d5db;">
                <div style="font-size:26px;font-weight:700;color:#92400e;">{avisos}</div>
                <div style="font-size:11px;color:#6b7280;text-transform:uppercase;">Avisos</div>
            </div>
            <div style="flex:1;padding:14px;text-align:center;background:#f9fafb;
                border-left:1px solid #d1d5db;">
                <div style="font-size:26px;font-weight:700;color:{cor_erros};">{erros}</div>
                <div style="font-size:11px;color:#6b7280;text-transform:uppercase;">Erros</div>
            </div>
            <div style="flex:1;padding:14px;text-align:center;background:#f9fafb;
                border-left:1px solid #d1d5db;">
                <div style="font-size:26px;font-weight:700;color:#0d6efd;">{rep_ok}</div>
                <div style="font-size:11px;color:#6b7280;text-transform:uppercase;">Reparados</div>
            </div>
            <div style="flex:1;padding:14px;text-align:center;background:#f9fafb;
                border-left:1px solid #d1d5db;">
                <div style="font-size:26px;font-weight:700;color:#6b7280;">{duracao}s</div>
                <div style="font-size:11px;color:#6b7280;text-transform:uppercase;">Duração</div>
            </div>
        </div>

        <div style="padding:16px 20px;">
            <table style="width:100%;border-collapse:collapse;font-size:13px;">
                <thead>
                    <tr style="background:#f9fafb;">
                        <th style="padding:8px 10px;text-align:left;font-size:11px;
                            color:#6b7280;text-transform:uppercase;width:90px;">Categoria</th>
                        <th style="padding:8px 10px;text-align:left;font-size:11px;
                            color:#6b7280;text-transform:uppercase;">Verificação</th>
                        <th style="padding:8px 10px;text-align:center;font-size:11px;
                            color:#6b7280;text-transform:uppercase;width:50px;"></th>
                        <th style="padding:8px 10px;text-align:left;font-size:11px;
                            color:#6b7280;text-transform:uppercase;">Detalhe</th>
                    </tr>
                </thead>
                <tbody>{linhas}</tbody>
            </table>
            {reparos}
        </div>

        <div style="padding:12px 20px;background:#f9fafb;text-align:center;
            border-top:1px solid #d1d5db;">
            <p style="margin:0;font-size:11px;color:#9ca3af;">
                Verificação automática a cada {intervalo}h &mdash; Próxima: {proximo}<br>
                Sistema de Painéis HAC &mdash;
                <a href="http://172.16.1.75:5000/api/admin/tests/page"
                   style="color:#0d6efd;">Ver painel de testes</a>
            </p>
        </div>
    </div>
</div>'''.format(
        cor_hdr=cor_hdr, status=status, agora=agora,
        ok_qt=ok_qt, avisos=avisos,
        erros=erros, cor_erros=cor_erros,
        rep_ok=rep_ok, duracao=duracao,
        linhas=linhas_resultados,
        reparos=secao_reparos,
        intervalo=INTERVALO_HORAS, proximo=proximo
    )


def enviar_relatorio(resultados, reparos, duracao):
    """Envia relatório por email para EMAIL_RELATORIO."""
    if not SMTP_HOST or not SMTP_USER or not SMTP_PASS:
        logger.warning('[tests_sistema] SMTP não configurado — relatório não enviado')
        return False

    try:
        import apprise
        from urllib.parse import quote as url_encode

        erros  = sum(1 for r in resultados if not r['ok'])
        avisos = sum(1 for r in resultados if r.get('nivel') == 'aviso')
        rep_ok = sum(1 for _, ok, _ in reparos if ok)

        if erros > 0:
            status = '{} ERRO(S)'.format(erros)
        elif avisos > 0:
            status = '{} AVISO(S)'.format(avisos)
        else:
            status = 'OK'

        titulo = '[HAC Sistema] {} — Relatório {}'.format(
            status, datetime.now().strftime('%d/%m/%Y %H:%M'))
        html   = montar_email_html(resultados, reparos, duracao)

        ap       = apprise.Apprise()
        from_addr = SMTP_FROM or SMTP_USER
        url = 'mailtos://{user}:{pwd}@{host}:{port}?from={sender}&to={to}&name=Sistema+HAC'.format(
            user=url_encode(SMTP_USER, safe=''),
            pwd=url_encode(SMTP_PASS, safe=''),
            host=SMTP_HOST, port=SMTP_PORT,
            sender=url_encode(from_addr, safe=''),
            to=url_encode(EMAIL_RELATORIO, safe='')
        )
        ap.add(url)

        if erros > 0:
            tipo_notif = apprise.NotifyType.FAILURE
        elif avisos > 0:
            tipo_notif = apprise.NotifyType.WARNING
        else:
            tipo_notif = apprise.NotifyType.SUCCESS

        ok = ap.notify(title=titulo, body=html,
                       body_format=apprise.NotifyFormat.HTML,
                       notify_type=tipo_notif)
        if ok:
            logger.info('[tests_sistema] Relatório enviado para %s', EMAIL_RELATORIO)
        else:
            logger.warning('[tests_sistema] Falha ao enviar relatório por email')
        return ok

    except Exception as e:
        logger.error('[tests_sistema] Erro ao enviar email: %s', e)
        return False
