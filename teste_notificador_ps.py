# -*- coding: utf-8 -*-
"""
Teste completo do Notificador Paciente PS Sem Médico
Percorre o mesmo caminho do notificador real:
  1. Conexão com o banco
  2. Verifica tipo_evento cadastrado
  3. Busca destinatários ativos no painel26
  4. Detecta alertas reais (ou usa simulado se não houver)
  5. Monta o email HTML
  6. Envia via SMTP

Uso: python teste_notificador_ps.py
     python teste_notificador_ps.py --real   (só alertas reais, sem simulado)
     python teste_notificador_ps.py --dryrun (não envia email, só mostra o que faria)
"""

import sys
import os

# Adiciona o diretório raiz ao path para importar o notificador
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, BASE_DIR)

from dotenv import load_dotenv
load_dotenv(os.path.join(BASE_DIR, '.env'))

import psycopg2
from psycopg2.extras import RealDictCursor

# Importa funções do notificador real (mesma lógica, sem duplicar)
from notificador_paciente_ps import (
    DB_CONFIG, SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM,
    ESPERA_MIN_ALERTA, INTERVALO_MIN,
    get_connection, buscar_destinatarios_email,
    detectar_alertas, montar_email_html, enviar_email
)

OK  = '[OK]  '
ERR = '[ERRO]'
INF = '[INFO]'
SKP = '[SKIP]'

def separador(titulo=''):
    if titulo:
        print('\n' + '─' * 55)
        print('  ' + titulo)
        print('─' * 55)
    else:
        print('─' * 55)


def main():
    modo_real   = '--real'   in sys.argv
    modo_dryrun = '--dryrun' in sys.argv

    print('=' * 55)
    print('  TESTE NOTIFICADOR PACIENTE PS SEM MEDICO')
    if modo_dryrun:
        print('  Modo: DRY-RUN (email NAO sera enviado)')
    elif modo_real:
        print('  Modo: SOMENTE ALERTAS REAIS')
    else:
        print('  Modo: SIMULADO se nao houver alerta real')
    print('=' * 55)

    # ─────────────────────────────────────────────────
    # 1. SMTP
    # ─────────────────────────────────────────────────
    separador('1. Configuração SMTP')
    smtp_ok = bool(SMTP_HOST and SMTP_USER and SMTP_PASS)
    if smtp_ok:
        print(OK + ' Host : ' + SMTP_HOST + ':' + str(SMTP_PORT))
        print(OK + ' User : ' + SMTP_USER)
        print(OK + ' From : ' + (SMTP_FROM or SMTP_USER))
    else:
        print(ERR + ' SMTP não configurado no .env')
        print('       Variáveis necessárias: SMTP_HOST, SMTP_USER, SMTP_PASS')
        sys.exit(1)

    # ─────────────────────────────────────────────────
    # 2. CONEXÃO BANCO
    # ─────────────────────────────────────────────────
    separador('2. Conexão com o Banco')
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
    # 3. TIPO DE EVENTO CADASTRADO?
    # ─────────────────────────────────────────────────
    separador('3. Tipo de Evento no Painel26')
    cursor.execute("""
        SELECT codigo, nome, ativo
        FROM notificacoes_tipos_evento
        WHERE codigo = 'paciente_ps_sem_medico'
    """)
    tipo = cursor.fetchone()
    if not tipo:
        print(ERR + " tipo_evento 'paciente_ps_sem_medico' NÃO encontrado em notificacoes_tipos_evento")
        print('       Execute o script: scripts/migration_notif_paciente_ps.sql')
        conn.close()
        sys.exit(1)
    status_tipo = 'ATIVO' if tipo['ativo'] else 'INATIVO'
    print(OK + ' Tipo: {} — {}'.format(tipo['nome'], status_tipo))
    if not tipo['ativo']:
        print(INF + ' Tipo está inativo. O notificador não enviará alertas.')

    # ─────────────────────────────────────────────────
    # 4. DESTINATÁRIOS ATIVOS
    # ─────────────────────────────────────────────────
    separador('4. Destinatários Ativos (Painel26)')
    destinatarios = buscar_destinatarios_email(conn)
    if not destinatarios:
        print(ERR + " Nenhum destinatário ativo para 'paciente_ps_sem_medico'")
        print('       Cadastre no Painel 26 com este tipo de evento.')
        conn.close()
        sys.exit(1)
    print(OK + ' {} destinatário(s) encontrado(s):'.format(len(destinatarios)))
    for d in destinatarios:
        print('       • {} <{}>'.format(d['nome'], d['email']))

    # ─────────────────────────────────────────────────
    # 5. MÉDICOS ATIVOS NO MOMENTO
    # ─────────────────────────────────────────────────
    separador('5. Médicos Ativos agora (medicos_ps)')
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
        print(INF + ' Nenhum médico logado no momento em medicos_ps')

    # ─────────────────────────────────────────────────
    # 6. DETECÇÃO DE ALERTAS REAIS
    # ─────────────────────────────────────────────────
    separador('6. Detecção de Alertas Reais (>= {}min sem médico)'.format(ESPERA_MIN_ALERTA))
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
        print(INF + ' Usando alerta SIMULADO para testar o envio de email.')
        alertas_usar = [
            {
                'ds_clinica':    'CLINICA MEDICA [TESTE]',
                'qt_aguardando': 3,
                'max_espera_min': 25
            },
            {
                'ds_clinica':    'ORTOPEDIA [TESTE]',
                'qt_aguardando': 1,
                'max_espera_min': 15
            }
        ]
        origem = 'SIMULADO'

    cursor.close()

    # ─────────────────────────────────────────────────
    # 7. MONTAR EMAIL
    # ─────────────────────────────────────────────────
    separador('7. Montar Email HTML')
    corpo_html = montar_email_html(alertas_usar)
    titulo = '[TESTE {}] [ALERTA PS] {} clínica(s) sem médico com pacientes aguardando'.format(
        origem, len(alertas_usar)
    )
    print(OK + ' Assunto : ' + titulo)
    print(OK + ' Tamanho : {} caracteres'.format(len(corpo_html)))

    # ─────────────────────────────────────────────────
    # 8. ENVIAR (ou dry-run)
    # ─────────────────────────────────────────────────
    separador('8. Envio de Email')
    if modo_dryrun:
        print(SKP + ' Dry-run: email NÃO enviado.')
        print(INF + ' Para enviar de verdade, rode sem --dryrun')
    else:
        print(INF + ' Enviando para {} destinatário(s)...'.format(len(destinatarios)))
        sucesso, resposta = enviar_email(destinatarios, titulo, corpo_html)
        if sucesso:
            print(OK + ' Email enviado com sucesso!')
            print(OK + ' Resposta: ' + str(resposta))
        else:
            print(ERR + ' Falha no envio: ' + str(resposta))
            conn.close()
            sys.exit(1)

    conn.close()

    # ─────────────────────────────────────────────────
    # RESUMO
    # ─────────────────────────────────────────────────
    separador('Resumo')
    print(OK + ' SMTP configurado')
    print(OK + ' Banco conectado')
    print(OK + ' Tipo de evento cadastrado')
    print(OK + ' {} destinatário(s) ativos'.format(len(destinatarios)))
    print(OK + ' Alertas: {} ({})'.format(len(alertas_usar), origem))
    if modo_dryrun:
        print(SKP + ' Email não enviado (dry-run)')
    else:
        print(OK + ' Email enviado')
    print()
    print('  Tudo certo! O notificador está funcionando corretamente.')
    print('=' * 55)


if __name__ == '__main__':
    main()
