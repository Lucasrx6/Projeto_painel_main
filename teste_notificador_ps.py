# -*- coding: utf-8 -*-
"""
Teste completo do Notificador Paciente PS Sem Médico
Percorre o mesmo caminho do notificador real:
  1. SMTP configurado
  2. Google Chat configurado
  3. Conexão com o banco
  4. Verifica tipo_evento cadastrado
  5. Busca destinatários ativos no painel26
  6. Médicos ativos agora
  7. Detecta alertas reais (ou usa simulado)
  8. Monta o email HTML e mensagem GChat
  9. Envia via SMTP e/ou Google Chat

Uso: python teste_notificador_ps.py
     python teste_notificador_ps.py --real     (só alertas reais, sem simulado)
     python teste_notificador_ps.py --dryrun   (não envia nada, só mostra o que faria)
     python teste_notificador_ps.py --gchat    (só testa Google Chat, pula email)
     python teste_notificador_ps.py --email    (só testa email, pula GChat)
"""

import sys
import os

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, BASE_DIR)

from dotenv import load_dotenv
load_dotenv(os.path.join(BASE_DIR, '.env'))

from psycopg2.extras import RealDictCursor

from notificador_paciente_ps import (
    DB_CONFIG, SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM,
    GCHAT_WEBHOOK_PS, ESPERA_MIN_ALERTA, INTERVALO_MIN,
    get_connection, buscar_destinatarios_email,
    detectar_alertas, montar_email_html, enviar_email,
    montar_mensagem_gchat, enviar_gchat
)

OK  = '[OK]  '
ERR = '[ERRO]'
INF = '[INFO]'
SKP = '[SKIP]'


def separador(titulo=''):
    if titulo:
        print('\n' + '─' * 58)
        print('  ' + titulo)
        print('─' * 58)
    else:
        print('─' * 58)


def main():
    modo_real    = '--real'   in sys.argv
    modo_dryrun  = '--dryrun' in sys.argv
    so_gchat     = '--gchat'  in sys.argv
    so_email     = '--email'  in sys.argv
    testar_email = not so_gchat
    testar_gchat = not so_email

    print('=' * 58)
    print('  TESTE NOTIFICADOR PACIENTE PS SEM MEDICO')
    if modo_dryrun:
        print('  Modo: DRY-RUN (nada sera enviado)')
    elif modo_real:
        print('  Modo: SOMENTE ALERTAS REAIS')
    else:
        print('  Modo: SIMULADO se nao houver alerta real')
    canais = []
    if testar_email: canais.append('Email')
    if testar_gchat: canais.append('Google Chat')
    print('  Canais: ' + ' + '.join(canais))
    print('=' * 58)

    # ─────────────────────────────────────────────────
    # 1. SMTP
    # ─────────────────────────────────────────────────
    separador('1. Configuração SMTP')
    smtp_ok = bool(SMTP_HOST and SMTP_USER and SMTP_PASS)
    if smtp_ok:
        print(OK + ' Host : {}:{}'.format(SMTP_HOST, SMTP_PORT))
        print(OK + ' User : ' + SMTP_USER)
        print(OK + ' From : ' + (SMTP_FROM or SMTP_USER))
    else:
        if testar_email:
            print(ERR + ' SMTP não configurado no .env (SMTP_HOST, SMTP_USER, SMTP_PASS)')
            if not testar_gchat:
                sys.exit(1)
        else:
            print(SKP + ' SMTP não verificado (modo --gchat)')

    # ─────────────────────────────────────────────────
    # 2. GOOGLE CHAT
    # ─────────────────────────────────────────────────
    separador('2. Configuração Google Chat')
    if GCHAT_WEBHOOK_PS:
        preview = GCHAT_WEBHOOK_PS[:60] + ('...' if len(GCHAT_WEBHOOK_PS) > 60 else '')
        print(OK + ' Webhook : ' + preview)
    else:
        if testar_gchat and so_gchat:
            print(ERR + ' GCHAT_WEBHOOK_PACIENTE_PS não configurado no .env')
            sys.exit(1)
        print(INF + ' GCHAT_WEBHOOK_PACIENTE_PS não configurado — canal desativado')
        print(INF + ' Para ativar, adicione ao .env:')
        print('       GCHAT_WEBHOOK_PACIENTE_PS=https://chat.googleapis.com/v1/spaces/.../messages?key=...&token=...')

    # ─────────────────────────────────────────────────
    # 3. CONEXÃO BANCO
    # ─────────────────────────────────────────────────
    separador('3. Conexão com o Banco')
    conn = get_connection()
    if not conn:
        print(ERR + ' Falha ao conectar em {}@{}:{}/{}'.format(
            DB_CONFIG['user'], DB_CONFIG['host'],
            DB_CONFIG['port'], DB_CONFIG['database']
        ))
        sys.exit(1)
    print(OK + ' Conectado em {}@{}:{}/{}'.format(
        DB_CONFIG['user'], DB_CONFIG['host'],
        DB_CONFIG['port'], DB_CONFIG['database']
    ))

    cursor = conn.cursor(cursor_factory=RealDictCursor)

    # ─────────────────────────────────────────────────
    # 4. TIPO DE EVENTO
    # ─────────────────────────────────────────────────
    separador('4. Tipo de Evento no Painel26')
    cursor.execute("""
        SELECT codigo, nome, ativo
        FROM notificacoes_tipos_evento
        WHERE codigo = 'paciente_ps_sem_medico'
    """)
    tipo = cursor.fetchone()
    if not tipo:
        print(ERR + " tipo_evento 'paciente_ps_sem_medico' NÃO encontrado")
        print('       Execute: scripts/migration_notif_paciente_ps.sql')
        conn.close()
        sys.exit(1)
    status_tipo = 'ATIVO' if tipo['ativo'] else 'INATIVO'
    print(OK + ' Tipo: {} — {}'.format(tipo['nome'], status_tipo))
    if not tipo['ativo']:
        print(INF + ' Tipo está inativo. O notificador não enviará alertas.')

    # ─────────────────────────────────────────────────
    # 5. DESTINATÁRIOS
    # ─────────────────────────────────────────────────
    separador('5. Destinatários Ativos (Painel26)')
    destinatarios = buscar_destinatarios_email(conn)
    if not destinatarios:
        if testar_email:
            print(ERR + " Nenhum destinatário ativo para 'paciente_ps_sem_medico'")
            print('       Cadastre no Painel 26 com este tipo de evento.')
            if not GCHAT_WEBHOOK_PS:
                conn.close()
                sys.exit(1)
            print(INF + ' Continuando apenas com Google Chat...')
        else:
            print(INF + ' Sem destinatários email — OK pois modo --gchat')
    else:
        print(OK + ' {} destinatário(s):'.format(len(destinatarios)))
        for d in destinatarios:
            print('       • {} <{}>'.format(d['nome'], d['email']))

    # ─────────────────────────────────────────────────
    # 6. MÉDICOS ATIVOS
    # ─────────────────────────────────────────────────
    separador('6. Médicos Ativos agora (medicos_ps)')
    cursor.execute("""
        SELECT ds_usuario, especialidade, consultorio
        FROM medicos_ps
        WHERE especialidade IS NOT NULL AND especialidade != ''
        ORDER BY especialidade
    """)
    medicos = cursor.fetchall()
    if medicos:
        print(OK + ' {} médico(s) logado(s):'.format(len(medicos)))
        for m in medicos:
            print('       • {} — {} (consultório {})'.format(
                m['ds_usuario'], m['especialidade'], m['consultorio'] or '-'
            ))
    else:
        print(INF + ' Nenhum médico logado no momento')

    # ─────────────────────────────────────────────────
    # 7. DETECÇÃO DE ALERTAS
    # ─────────────────────────────────────────────────
    separador('7. Detecção de Alertas (>= {}min sem médico)'.format(ESPERA_MIN_ALERTA))
    alertas_reais = detectar_alertas(conn)
    if alertas_reais:
        print(OK + ' {} clínica(s) em alerta real:'.format(len(alertas_reais)))
        for a in alertas_reais:
            print('       • {} — {} aguardando — max {}min'.format(
                a['ds_clinica'], a['qt_aguardando'], a['max_espera_min']
            ))
        alertas_usar = alertas_reais
        origem = 'REAL'
    else:
        print(INF + ' Nenhuma clínica em alerta real no momento.')
        if modo_real:
            print(SKP + ' Modo --real: encerrando sem enviar.')
            cursor.close()
            conn.close()
            sys.exit(0)
        print(INF + ' Usando alertas SIMULADOS para testar o envio.')
        alertas_usar = [
            {'ds_clinica': 'CLINICA MEDICA [TESTE]', 'qt_aguardando': 3, 'max_espera_min': 25},
            {'ds_clinica': 'ORTOPEDIA [TESTE]',      'qt_aguardando': 1, 'max_espera_min': 15},
        ]
        origem = 'SIMULADO'

    cursor.close()

    # ─────────────────────────────────────────────────
    # 8. MONTAR CONTEÚDO
    # ─────────────────────────────────────────────────
    separador('8. Montar Conteúdo')
    titulo = '[TESTE {}] [ALERTA PS] {} clínica(s) sem médico'.format(origem, len(alertas_usar))

    if testar_email:
        corpo_html = montar_email_html(alertas_usar)
        print(OK + ' Email  — assunto : ' + titulo)
        print(OK + ' Email  — tamanho : {} chars'.format(len(corpo_html)))

    if testar_gchat and GCHAT_WEBHOOK_PS:
        msg_gchat = montar_mensagem_gchat(alertas_usar)
        print(OK + ' GChat  — {} chars'.format(len(msg_gchat)))
        print(INF + ' Preview GChat:')
        for linha in msg_gchat.split('\n')[:6]:
            print('         ' + linha)

    # ─────────────────────────────────────────────────
    # 9. ENVIO
    # ─────────────────────────────────────────────────
    separador('9. Envio')

    if modo_dryrun:
        print(SKP + ' Dry-run: nada enviado.')
        print(INF + ' Rode sem --dryrun para enviar de verdade.')
    else:
        algum_ok = False

        if testar_email and destinatarios:
            print(INF + ' Enviando email para {} destinatário(s)...'.format(len(destinatarios)))
            sucesso_email, resp_email = enviar_email(destinatarios, titulo, corpo_html)
            if sucesso_email:
                print(OK + ' Email enviado! Resposta: ' + str(resp_email))
                algum_ok = True
            else:
                print(ERR + ' Falha email: ' + str(resp_email))

        if testar_gchat and GCHAT_WEBHOOK_PS:
            print(INF + ' Enviando para Google Chat...')
            sucesso_gchat, resp_gchat = enviar_gchat(alertas_usar)
            if sucesso_gchat:
                print(OK + ' Google Chat enviado! Resposta: ' + str(resp_gchat))
                algum_ok = True
            else:
                print(ERR + ' Falha Google Chat: ' + str(resp_gchat))
        elif testar_gchat and not GCHAT_WEBHOOK_PS:
            print(SKP + ' Google Chat: webhook não configurado, pulando.')

        if not algum_ok and not modo_dryrun:
            conn.close()
            sys.exit(1)

    conn.close()

    # ─────────────────────────────────────────────────
    # RESUMO
    # ─────────────────────────────────────────────────
    separador('Resumo')
    print(OK + ' Banco conectado')
    print(OK + ' Tipo de evento cadastrado')
    print(OK + ' {} destinatário(s) email'.format(len(destinatarios)))
    print(OK + ' Google Chat: ' + ('configurado' if GCHAT_WEBHOOK_PS else 'não configurado'))
    print(OK + ' Alertas: {} ({})'.format(len(alertas_usar), origem))
    if modo_dryrun:
        print(SKP + ' Envio não realizado (dry-run)')
    else:
        print(OK + ' Envio realizado')
    print()
    print('  Tudo certo! O notificador está funcionando corretamente.')
    print('=' * 58)


if __name__ == '__main__':
    main()
