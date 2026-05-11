"""
========================================
WORKER - NOTIFICADOR DE OCUPAÇÃO HOSPITALAR
========================================

Envia relatório de ocupação hospitalar por email em intervalos configuráveis.

Configuração via .env:
  NOTIF_OCUPACAO_EMAILS      - destinatários separados por vírgula
  NOTIF_OCUPACAO_INTERVALO_H - intervalo em horas (padrão: 6)
  NOTIF_OCUPACAO_HORARIOS    - horários fixos separados por vírgula, ex: 06:00,12:00,18:00,00:00
                               (se definido, substitui o intervalo)

O email contém:
  - Corpo HTML com resumo geral da ocupação
  - Anexo Excel com 3 abas: Resumo, Por Setor, Pacientes Internados
"""

import os
import sys
import time
import logging
import smtplib
import tempfile
from datetime import datetime, timedelta
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from email.mime.base import MIMEBase
from email import encoders

import psycopg2
from psycopg2.extras import RealDictCursor
from dotenv import load_dotenv
import openpyxl
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
from openpyxl.utils import get_column_letter

# ========================================
# CONFIGURAÇÃO
# ========================================

# Carrega .env da raiz do projeto
_BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
load_dotenv(os.path.join(_BASE_DIR, '.env'))

os.makedirs(os.path.join(_BASE_DIR, 'logs'), exist_ok=True)

logging.basicConfig(
    level=logging.INFO,
    format='[%(asctime)s] %(levelname)s: %(message)s',
    handlers=[
        logging.FileHandler(
            os.path.join(_BASE_DIR, 'logs', 'notificador_ocupacao.log'),
            encoding='utf-8'
        ),
        logging.StreamHandler(sys.stdout)
    ]
)
logger = logging.getLogger(__name__)


def _cfg():
    """Lê configurações do .env em tempo de execução (permite alteração sem reiniciar)."""
    emails_raw = os.getenv('NOTIF_OCUPACAO_EMAILS', '')
    destinatarios = [e.strip() for e in emails_raw.split(',') if e.strip()]

    horarios_raw = os.getenv('NOTIF_OCUPACAO_HORARIOS', '')
    horarios = [h.strip() for h in horarios_raw.split(',') if h.strip()]

    intervalo_h = float(os.getenv('NOTIF_OCUPACAO_INTERVALO_H', '6'))

    return {
        'destinatarios': destinatarios,
        'horarios': horarios,
        'intervalo_h': intervalo_h,
    }


# ========================================
# BANCO DE DADOS
# ========================================

def _get_conn():
    return psycopg2.connect(
        host=os.getenv('DB_HOST', 'localhost'),
        dbname=os.getenv('DB_NAME', 'postgres'),
        user=os.getenv('DB_USER', 'postgres'),
        password=os.getenv('DB_PASSWORD', ''),
        port=int(os.getenv('DB_PORT', '5432')),
        connect_timeout=10
    )


def _query(conn, sql):
    """Executa SQL e retorna (colunas, linhas)."""
    with conn.cursor(cursor_factory=RealDictCursor) as cur:
        cur.execute(sql)
        rows = cur.fetchall()
        cols = [desc.name for desc in cur.description] if cur.description else []
    return cols, [dict(r) for r in rows]


def buscar_dados():
    """Busca todos os dados necessários do banco."""
    conn = _get_conn()
    try:
        _, dashboard_rows = _query(conn, "SELECT * FROM vw_ocupacao_dashboard")
        dashboard = dashboard_rows[0] if dashboard_rows else {}

        cols_setor, setores = _query(conn, """
            SELECT *,
                   SUBSTR(obter_nome_setor(cd_setor_atendimento), 1, 60) AS nm_setor
            FROM vw_ocupacao_por_setor
            ORDER BY nm_setor
        """)

        cols_pac, pacientes = _query(conn, """
            SELECT *,
                   SUBSTR(obter_nome_setor(cd_setor_atendimento), 1, 60) AS nm_setor
            FROM vw_pacientes_internados
            ORDER BY nm_setor, 2
        """)

        return dashboard, cols_setor, setores, cols_pac, pacientes
    finally:
        conn.close()


# ========================================
# GERAÇÃO DO EXCEL
# ========================================

_COR_HEADER   = "9B1C24"   # vermelho escuro
_COR_TITULO   = "DC3545"   # vermelho padrão HAC
_COR_OCUPADO  = "C00000"   # vermelho crítico
_COR_LIVRE    = "375623"   # verde escuro
_COR_ALERTA   = "FF8C00"   # laranja
_COR_TEXTO    = "FFFFFF"   # branco
_COR_ZEBRA    = "FDECEA"   # rosa claro alternado


def _estilo_header(cell, cor_fundo=_COR_HEADER):
    cell.font = Font(bold=True, color=_COR_TEXTO, size=11)
    cell.fill = PatternFill("solid", fgColor=cor_fundo)
    cell.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
    _borda(cell)


def _borda(cell):
    lado = Side(style="thin", color="AAAAAA")
    cell.border = Border(left=lado, right=lado, top=lado, bottom=lado)


def _ajustar_colunas(ws, min_w=10, max_w=50):
    for col in ws.columns:
        max_len = 0
        col_letter = get_column_letter(col[0].column)
        for cell in col:
            try:
                max_len = max(max_len, len(str(cell.value or '')))
            except Exception:
                pass
        ws.column_dimensions[col_letter].width = min(max(max_len + 2, min_w), max_w)


def _aba_resumo(wb, dashboard, now):
    ws = wb.create_sheet("Resumo Geral")
    ws.sheet_view.showGridLines = False

    # Título
    ws.merge_cells("A1:D1")
    titulo = ws["A1"]
    titulo.value = f"OCUPAÇÃO HOSPITALAR — HAC — {now.strftime('%d/%m/%Y %H:%M')}"
    titulo.font = Font(bold=True, color=_COR_TEXTO, size=14)
    titulo.fill = PatternFill("solid", fgColor=_COR_TITULO)
    titulo.alignment = Alignment(horizontal="center", vertical="center")
    ws.row_dimensions[1].height = 30

    ws.append([])

    metricas = [
        ("Indicador", "Valor"),
        ("Total de Leitos",          dashboard.get('total_leitos', '-')),
        ("Leitos Ocupados",          dashboard.get('leitos_ocupados', '-')),
        ("Leitos Livres",            dashboard.get('leitos_livres', '-')),
        ("Em Higienização",          dashboard.get('leitos_higienizacao', '-')),
        ("Interditados",             dashboard.get('leitos_interditados', '-')),
        ("Taxa de Ocupação (%)",     dashboard.get('taxa_ocupacao_geral', '-')),
        ("Taxa de Disponibilidade (%)","" if dashboard.get('taxa_disponibilidade') is None else dashboard.get('taxa_disponibilidade')),
        ("Total de Setores",         dashboard.get('total_setores', '-')),
        ("Média de Permanência (dias)", dashboard.get('media_permanencia_geral', '-')),
        ("Última Atualização",       str(dashboard.get('ultima_atualizacao', '-'))),
    ]

    for i, (indicador, valor) in enumerate(metricas):
        row = i + 3
        ws.cell(row=row, column=1).value = indicador
        ws.cell(row=row, column=2).value = valor

        if i == 0:
            _estilo_header(ws.cell(row=row, column=1))
            _estilo_header(ws.cell(row=row, column=2))
        else:
            ws.cell(row=row, column=1).font = Font(bold=True)
            ws.cell(row=row, column=1).fill = PatternFill("solid", fgColor="F5D0D3")
            _borda(ws.cell(row=row, column=1))
            _borda(ws.cell(row=row, column=2))

            # Colorir taxa de ocupação
            if indicador == "Taxa de Ocupação (%)":
                try:
                    v = float(valor)
                    cor = _COR_OCUPADO if v >= 90 else (_COR_ALERTA if v >= 75 else _COR_LIVRE)
                    ws.cell(row=row, column=2).font = Font(bold=True, color=_COR_TEXTO)
                    ws.cell(row=row, column=2).fill = PatternFill("solid", fgColor=cor)
                except (TypeError, ValueError):
                    pass

    ws.column_dimensions['A'].width = 30
    ws.column_dimensions['B'].width = 20


def _aba_por_setor(wb, cols, setores):
    ws = wb.create_sheet("Por Setor")
    ws.sheet_view.showGridLines = False

    if not cols:
        ws["A1"] = "Sem dados"
        return

    # Header
    for j, col in enumerate(cols, 1):
        cell = ws.cell(row=1, column=j)
        cell.value = col.replace('_', ' ').title()
        _estilo_header(cell)
    ws.row_dimensions[1].height = 22

    # Dados
    taxa_col = next((i for i, c in enumerate(cols) if 'taxa' in c.lower() and 'ocup' in c.lower()), None)

    for i, row in enumerate(setores, 2):
        zebra = i % 2 == 0
        for j, col in enumerate(cols, 1):
            cell = ws.cell(row=i, column=j)
            cell.value = row.get(col)
            _borda(cell)
            cell.alignment = Alignment(vertical="center")
            if zebra:
                cell.fill = PatternFill("solid", fgColor=_COR_ZEBRA)

            # Colorir taxa de ocupação
            if taxa_col is not None and j == taxa_col + 1:
                try:
                    v = float(row.get(col, 0) or 0)
                    cor = _COR_OCUPADO if v >= 90 else (_COR_ALERTA if v >= 75 else None)
                    if cor:
                        cell.font = Font(bold=True, color=_COR_TEXTO)
                        cell.fill = PatternFill("solid", fgColor=cor)
                except (TypeError, ValueError):
                    pass

    _ajustar_colunas(ws)


def _aba_pacientes(wb, cols, pacientes):
    ws = wb.create_sheet("Pacientes Internados")
    ws.sheet_view.showGridLines = False

    if not cols:
        ws["A1"] = "Sem dados"
        return

    for j, col in enumerate(cols, 1):
        cell = ws.cell(row=1, column=j)
        cell.value = col.replace('_', ' ').title()
        _estilo_header(cell)
    ws.row_dimensions[1].height = 22

    for i, row in enumerate(pacientes, 2):
        zebra = i % 2 == 0
        for j, col in enumerate(cols, 1):
            cell = ws.cell(row=i, column=j)
            val = row.get(col)
            if isinstance(val, datetime):
                val = val.strftime('%d/%m/%Y %H:%M')
            cell.value = val
            _borda(cell)
            cell.alignment = Alignment(vertical="center")
            if zebra:
                cell.fill = PatternFill("solid", fgColor=_COR_ZEBRA)

    _ajustar_colunas(ws)


def gerar_excel(dashboard, cols_setor, setores, cols_pac, pacientes, now):
    wb = openpyxl.Workbook()
    wb.remove(wb.active)  # remove aba padrão

    _aba_resumo(wb, dashboard, now)
    _aba_por_setor(wb, cols_setor, setores)
    _aba_pacientes(wb, cols_pac, pacientes)

    tmp = tempfile.NamedTemporaryFile(
        delete=False, suffix='.xlsx',
        prefix=f"ocupacao_hac_{now.strftime('%Y%m%d_%H%M')}_"
    )
    wb.save(tmp.name)
    tmp.close()
    return tmp.name


# ========================================
# CORPO HTML DO EMAIL
# ========================================

def _cor_taxa(valor):
    try:
        v = float(valor)
        if v >= 90:
            return "#C00000", "CRÍTICA"
        if v >= 75:
            return "#FF8C00", "ALERTA"
        return "#375623", "NORMAL"
    except (TypeError, ValueError):
        return "#555555", "-"


def gerar_corpo_html(dashboard, setores, now):
    taxa = dashboard.get('taxa_ocupacao_geral', 0) or 0
    cor_taxa, status_taxa = _cor_taxa(taxa)

    ocupados  = dashboard.get('leitos_ocupados', 0) or 0
    total     = dashboard.get('total_leitos', 0) or 0
    livres    = dashboard.get('leitos_livres', 0) or 0
    higieniz  = dashboard.get('leitos_higienizacao', 0) or 0
    interdit  = dashboard.get('leitos_interditados', 0) or 0
    setores_n = dashboard.get('total_setores', 0) or 0
    perm      = dashboard.get('media_permanencia_geral', 0) or 0

    # Linhas dos setores
    linhas_setores = ""
    for i, s in enumerate(setores):
        bg = "#DEEAF1" if i % 2 == 0 else "#FFFFFF"
        # nm_setor vem da query (obter_nome_setor); fallback para colunas genéricas
        nome = s.get('nm_setor') or s.get('setor') or s.get('nome_setor') or s.get('descricao') or (list(s.values())[0] if s else '-')
        t_leitos  = s.get('total_leitos') or s.get('leitos') or '-'
        t_ocup    = s.get('leitos_ocupados') or s.get('ocupados') or '-'
        t_livre   = s.get('leitos_livres') or s.get('livres') or '-'
        t_taxa    = s.get('taxa_ocupacao') or s.get('taxa_ocupacao_geral') or '-'

        cor_s, _ = _cor_taxa(t_taxa)
        taxa_fmt = f"{t_taxa}%" if t_taxa != '-' else '-'

        linhas_setores += f"""
        <tr style="background:{bg}">
            <td style="padding:6px 10px;border:1px solid #ddd">{nome}</td>
            <td style="padding:6px 10px;border:1px solid #ddd;text-align:center">{t_leitos}</td>
            <td style="padding:6px 10px;border:1px solid #ddd;text-align:center">{t_ocup}</td>
            <td style="padding:6px 10px;border:1px solid #ddd;text-align:center">{t_livre}</td>
            <td style="padding:6px 10px;border:1px solid #ddd;text-align:center;color:{cor_s};font-weight:bold">{taxa_fmt}</td>
        </tr>"""

    tabela_setores = f"""
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
        <tbody>{linhas_setores}</tbody>
    </table>""" if setores else "<p style='color:#888'>Sem dados de setores.</p>"

    return f"""<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family:Arial,sans-serif;margin:0;padding:0;background:#f4f4f4">
<div style="max-width:700px;margin:20px auto;background:#fff;border-radius:8px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.15)">

  <!-- Cabeçalho -->
  <div style="background:#dc3545;padding:24px 30px;color:#fff">
    <h1 style="margin:0;font-size:20px">Relatório de Ocupação Hospitalar</h1>
    <p style="margin:4px 0 0;font-size:13px;opacity:0.85">Hospital Anchieta Ceilândia — {now.strftime('%d/%m/%Y às %H:%M')}</p>
  </div>

  <!-- Cards de resumo -->
  <div style="padding:24px 30px">
    <div style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:20px">

      <div style="flex:1;min-width:120px;background:#f0f7ff;border-radius:8px;padding:16px;text-align:center;border-top:4px solid {cor_taxa}">
        <div style="font-size:32px;font-weight:bold;color:{cor_taxa}">{taxa}%</div>
        <div style="font-size:12px;color:#555;margin-top:4px">Taxa de Ocupação</div>
        <div style="font-size:11px;font-weight:bold;color:{cor_taxa}">{status_taxa}</div>
      </div>

      <div style="flex:1;min-width:120px;background:#fff0f0;border-radius:8px;padding:16px;text-align:center;border-top:4px solid #C00000">
        <div style="font-size:32px;font-weight:bold;color:#C00000">{ocupados}</div>
        <div style="font-size:12px;color:#555;margin-top:4px">Leitos Ocupados</div>
        <div style="font-size:11px;color:#888">de {total} no total</div>
      </div>

      <div style="flex:1;min-width:120px;background:#f0fff4;border-radius:8px;padding:16px;text-align:center;border-top:4px solid #375623">
        <div style="font-size:32px;font-weight:bold;color:#375623">{livres}</div>
        <div style="font-size:12px;color:#555;margin-top:4px">Leitos Livres</div>
      </div>

      <div style="flex:1;min-width:120px;background:#fffaf0;border-radius:8px;padding:16px;text-align:center;border-top:4px solid #FF8C00">
        <div style="font-size:24px;font-weight:bold;color:#FF8C00">{higieniz} / {interdit}</div>
        <div style="font-size:12px;color:#555;margin-top:4px">Higienização / Interditados</div>
      </div>

    </div>

    <div style="background:#f9f9f9;border-radius:6px;padding:12px 16px;margin-bottom:20px;font-size:13px;color:#444">
      <strong>{setores_n}</strong> setores monitorados &nbsp;|&nbsp;
      Média de permanência: <strong>{perm} dias</strong>
    </div>

    <!-- Tabela por setor -->
    <h2 style="font-size:15px;color:#dc3545;margin:0 0 8px">Ocupação por Setor</h2>
    {tabela_setores}

    <p style="font-size:12px;color:#888;margin-top:20px;border-top:1px solid #eee;padding-top:12px">
      O arquivo Excel em anexo contém a lista completa de pacientes internados.<br>
      Este email é gerado automaticamente pelo Sistema de Painéis — HAC.
    </p>
  </div>

</div>
</body>
</html>"""


# ========================================
# ENVIO DE EMAIL
# ========================================

def enviar_email(destinatarios, corpo_html, caminho_excel, now):
    smtp_host = os.getenv('SMTP_HOST', '')
    smtp_port = int(os.getenv('SMTP_PORT', '587'))
    smtp_user = os.getenv('SMTP_USER', '')
    smtp_pass = os.getenv('SMTP_PASS', '')
    smtp_from = os.getenv('SMTP_FROM', '') or smtp_user

    if not smtp_host or not smtp_user or not smtp_pass:
        logger.error("SMTP não configurado no .env")
        return False

    assunto = f"Ocupação Hospitalar HAC — {now.strftime('%d/%m/%Y %H:%M')}"
    nome_arquivo = f"Ocupacao_HAC_{now.strftime('%d-%m-%Y_%H%M')}.xlsx"

    msg = MIMEMultipart('mixed')
    msg['Subject'] = assunto
    msg['From']    = f"Painel HAC <{smtp_from}>"
    msg['To']      = ', '.join(destinatarios)

    msg.attach(MIMEText(corpo_html, 'html', 'utf-8'))

    with open(caminho_excel, 'rb') as f:
        part = MIMEBase('application', 'vnd.openxmlformats-officedocument.spreadsheetml.sheet')
        part.set_payload(f.read())
    encoders.encode_base64(part)
    part.add_header('Content-Disposition', f'attachment; filename="{nome_arquivo}"')
    msg.attach(part)

    try:
        server = smtplib.SMTP(smtp_host, smtp_port, timeout=30)
        server.ehlo()
        server.starttls()
        server.login(smtp_user, smtp_pass)
        server.sendmail(smtp_from, destinatarios, msg.as_bytes())
        server.quit()
        logger.info(f"Email enviado para: {', '.join(destinatarios)}")
        return True
    except Exception as e:
        logger.error(f"Erro ao enviar email: {e}")
        return False


# ========================================
# CICLO PRINCIPAL
# ========================================

def executar_envio():
    cfg = _cfg()
    if not cfg['destinatarios']:
        logger.warning("Nenhum destinatário configurado em NOTIF_OCUPACAO_EMAILS. Pulando.")
        return

    now = datetime.now()
    logger.info(f"Iniciando coleta de dados — {now.strftime('%d/%m/%Y %H:%M')}")

    try:
        dashboard, cols_setor, setores, cols_pac, pacientes = buscar_dados()
    except Exception as e:
        logger.error(f"Erro ao buscar dados do banco: {e}")
        return

    caminho_excel = None
    try:
        caminho_excel = gerar_excel(dashboard, cols_setor, setores, cols_pac, pacientes, now)
        corpo_html = gerar_corpo_html(dashboard, setores, now)
        enviar_email(cfg['destinatarios'], corpo_html, caminho_excel, now)
    except Exception as e:
        logger.error(f"Erro ao gerar/enviar relatório: {e}")
    finally:
        if caminho_excel and os.path.exists(caminho_excel):
            os.unlink(caminho_excel)


def _proxima_execucao_horarios(horarios):
    """Retorna o próximo datetime correspondente a um dos horários configurados."""
    now = datetime.now()
    candidatos = []
    for h in horarios:
        try:
            hora, minuto = map(int, h.split(':'))
        except ValueError:
            continue
        candidate = now.replace(hour=hora, minute=minuto, second=0, microsecond=0)
        if candidate <= now:
            candidate += timedelta(days=1)
        candidatos.append(candidate)
    return min(candidatos) if candidatos else None


def main():
    logger.info("=" * 50)
    logger.info("Notificador de Ocupação Hospitalar — Iniciando")
    logger.info("=" * 50)

    cfg = _cfg()
    logger.info(f"Destinatários : {cfg['destinatarios'] or '(nenhum)'}")
    logger.info(f"Horários fixos: {cfg['horarios'] or '(não configurado)'}")
    logger.info(f"Intervalo     : {cfg['intervalo_h']}h")

    if not cfg['destinatarios']:
        logger.error("Configure NOTIF_OCUPACAO_EMAILS no .env e reinicie.")
        sys.exit(1)

    # Envia imediatamente na primeira execução
    executar_envio()

    while True:
        cfg = _cfg()  # relê config a cada ciclo

        if cfg['horarios']:
            proximo = _proxima_execucao_horarios(cfg['horarios'])
            if proximo is None:
                logger.warning("Horários inválidos. Usando intervalo padrão de 6h.")
                proximo = datetime.now() + timedelta(hours=6)
        else:
            proximo = datetime.now() + timedelta(hours=cfg['intervalo_h'])

        logger.info(f"Próximo envio: {proximo.strftime('%d/%m/%Y %H:%M')}")

        while datetime.now() < proximo:
            time.sleep(30)

        executar_envio()


# ========================================
# INICIALIZAÇÃO INTEGRADA (thread daemon no Flask/Gunicorn)
# ========================================

_background_started = False


def start_in_background():
    """
    Inicia o notificador como thread daemon junto com o Flask/Gunicorn.

    OFF SWITCHES (em ordem de praticidade):
      1. .env  -> NOTIF_OCUPACAO_AUTO=false  (desativa sem tocar no código)
      2. app.py -> comentar o bloco de 3 linhas (reverte)
      3. Qualquer exceção de startup é capturada (nunca derruba o servidor Flask)
    """
    global _background_started
    if _background_started:
        return

    if os.getenv('NOTIF_OCUPACAO_AUTO', 'true').lower() != 'true':
        logger.info('[notificador_ocupacao] Auto-start desativado (NOTIF_OCUPACAO_AUTO=false)')
        return

    # Guard Werkzeug: inicia apenas no processo filho do reloader, não no monitor.
    try:
        from werkzeug.serving import is_running_from_reloader
        if is_running_from_reloader() and os.environ.get('WERKZEUG_RUN_MAIN') != 'true':
            return
    except ImportError:
        pass

    _background_started = True

    import threading

    def _run():
        try:
            cfg = _cfg()
            logger.info(
                '[notificador_ocupacao] Thread daemon iniciada — destinatários: %s | horários: %s | intervalo: %sh',
                cfg['destinatarios'], cfg['horarios'], cfg['intervalo_h']
            )

            # Aguarda 60s antes do primeiro envio para o Flask terminar de subir
            time.sleep(60)
            executar_envio()

            while True:
                cfg = _cfg()
                if cfg['horarios']:
                    proximo = _proxima_execucao_horarios(cfg['horarios'])
                    if proximo is None:
                        proximo = datetime.now() + timedelta(hours=6)
                else:
                    proximo = datetime.now() + timedelta(hours=cfg['intervalo_h'])

                logger.info('[notificador_ocupacao] Próximo envio: %s', proximo.strftime('%d/%m/%Y %H:%M'))

                while datetime.now() < proximo:
                    time.sleep(30)

                executar_envio()

        except Exception as e:
            logger.error('[notificador_ocupacao] Erro fatal na thread daemon: %s', e, exc_info=True)

    t = threading.Thread(target=_run, name='notificador_ocupacao', daemon=True)
    t.start()
    logger.info('[notificador_ocupacao] Thread daemon registrada')


if __name__ == '__main__':
    main()
