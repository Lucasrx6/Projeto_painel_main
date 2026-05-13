"""
Tester da Evolution API - WhatsApp via QR Code

Uso:
    python testar_evolution_whatsapp.py              # conecta instancia e envia teste
    python testar_evolution_whatsapp.py status       # verifica status da instancia
    python testar_evolution_whatsapp.py qr           # exibe QR Code novamente
    python testar_evolution_whatsapp.py send "texto" # envia mensagem personalizada
    python testar_evolution_whatsapp.py delete       # remove a instancia
"""
import sys
import os

# Garante saida UTF-8 no terminal Windows
if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
import json
import time
import base64
import urllib.request
import urllib.error
from dotenv import load_dotenv

load_dotenv()

SEP = '─' * 60

# ── Configurações do .env ─────────────────────────────────────────
API_URL       = os.getenv('EVOLUTION_API_URL', 'http://localhost:8080').rstrip('/')
API_KEY       = os.getenv('EVOLUTION_API_KEY', '')
INSTANCE_NAME = os.getenv('EVOLUTION_INSTANCE_NAME', 'painel_hospitalar')
TEST_PHONE    = os.getenv('EVOLUTION_TEST_PHONE', '')


# ── Helpers HTTP ──────────────────────────────────────────────────

def _request(method: str, path: str, body: dict = None) -> dict:
    url = f'{API_URL}{path}'
    data = json.dumps(body).encode() if body else None
    headers = {
        'apikey': API_KEY,
        'Content-Type': 'application/json',
    }
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            return json.loads(resp.read().decode())
    except urllib.error.HTTPError as e:
        body_err = e.read().decode(errors='replace')
        try:
            return json.loads(body_err)
        except Exception:
            return {'error': f'HTTP {e.code}', 'detail': body_err[:300]}
    except urllib.error.URLError as e:
        return {'error': str(e.reason)}


def _get(path):    return _request('GET',    path)
def _post(path, body=None): return _request('POST', path, body)
def _delete(path): return _request('DELETE', path)


# ── Operações da API ──────────────────────────────────────────────

def verificar_api_rodando():
    """Retorna True se a API está respondendo."""
    try:
        _get('/instance/fetchInstances')
        return True
    except Exception:
        return False


def criar_instancia():
    print(f'\n▶ Criando instância "{INSTANCE_NAME}"...')
    resp = _post('/instance/create', {
        'instanceName': INSTANCE_NAME,
        'integration': 'WHATSAPP-BAILEYS',
        'qrcode': True,
    })
    if 'instance' in resp or resp.get('instanceName') == INSTANCE_NAME:
        print(f'  ✅ Instância criada.')
        return True
    if 'already' in str(resp).lower() or 'exists' in str(resp).lower():
        print(f'  ℹ  Instância já existe.')
        return True
    print(f'  ❌ Erro ao criar instância: {resp}')
    return False


def obter_status():
    resp = _get(f'/instance/connectionState/{INSTANCE_NAME}')
    state = resp.get('instance', {}).get('state') or resp.get('state', '')
    return state.lower() if state else ''


def obter_qr():
    """Chama connect e faz polling até o base64 aparecer (pode demorar ~5s após criação)."""
    for tentativa in range(10):
        resp = _get(f'/instance/connect/{INSTANCE_NAME}')
        # A API retorna {count: N, base64: "..."} diretamente, ou aninhado em qrcode
        b64 = (resp.get('base64')
               or resp.get('qrcode', {}).get('base64', '')
               or (resp.get('qrcode') if isinstance(resp.get('qrcode'), str) else ''))
        if b64:
            return b64
        # count > 0 mas sem base64 ainda ou count == 0 (não gerou)
        if tentativa < 9:
            time.sleep(3)
    return ''


def salvar_qr_png(base64_str: str):
    """Salva o QR Code como PNG e abre no visualizador padrão."""
    # Remove prefixo data:image/png;base64, se houver
    if ',' in base64_str:
        base64_str = base64_str.split(',', 1)[1]
    caminho = os.path.join(os.path.dirname(__file__), 'qrcode_whatsapp.png')
    with open(caminho, 'wb') as f:
        f.write(base64.b64decode(base64_str))
    print(f'\n  📷 QR Code salvo em: {caminho}')
    print(f'  ↳ Abrindo automaticamente...')
    os.startfile(caminho)
    return caminho


def enviar_mensagem(numero: str, texto: str) -> bool:
    # Formata número: remove +, espaços, traços
    numero = numero.replace('+', '').replace('-', '').replace(' ', '').strip()
    resp = _post(f'/message/sendText/{INSTANCE_NAME}', {
        'number': numero,
        'text': texto,
    })
    if resp.get('key') or resp.get('status') == 'PENDING' or 'key' in str(resp):
        return True
    print(f'  Resposta da API: {resp}')
    return False


def deletar_instancia():
    resp = _delete(f'/instance/delete/{INSTANCE_NAME}')
    return 'deleted' in str(resp).lower() or 'success' in str(resp).lower() or not resp.get('error')


# ── Fluxo principal ───────────────────────────────────────────────

def cmd_status():
    print(f'\n{SEP}')
    print(f'  STATUS — Evolution API / Instância "{INSTANCE_NAME}"')
    print(SEP)
    print(f'  URL     : {API_URL}')
    print(f'  API Key : {API_KEY[:12]}...{API_KEY[-4:]}' if len(API_KEY) > 16 else f'  API Key : {API_KEY}')
    print(f'  Fone    : {TEST_PHONE or "(não configurado — defina EVOLUTION_TEST_PHONE no .env)"}')
    print(SEP)

    estado = obter_status()
    icone  = '🟢' if estado == 'open' else '🔴' if estado in ('close', 'closed') else '🟡'
    print(f'\n  {icone} Estado da instância: {estado or "desconhecida / não existe"}')

    if estado == 'open':
        print('  ✅ Número conectado e pronto para enviar mensagens.\n')
    elif estado in ('close', 'closed', ''):
        print('  ⚠️  Instância desconectada. Execute sem argumentos para reconectar.\n')
    else:
        print(f'  ℹ  Estado intermediário: {estado}\n')


def cmd_qr():
    print(f'\n▶ Obtendo QR Code da instância "{INSTANCE_NAME}"...')
    qr = obter_qr()
    if not qr:
        print('  ❌ QR Code não disponível. A instância pode já estar conectada ou não existir.')
        print('     Execute: python testar_evolution_whatsapp.py status')
        return
    salvar_qr_png(qr)
    print('\n  📱 Abra o WhatsApp no celular → Dispositivos vinculados → Vincular dispositivo')
    print('  Escaneie o QR Code que abriu no visualizador de imagens.\n')


def cmd_conectar():
    print(f'\n{SEP}')
    print('  CONFIGURAÇÃO — Conectar número WhatsApp')
    print(SEP)
    print(f'  Instância : {INSTANCE_NAME}')
    print(f'  API URL   : {API_URL}')
    print(SEP)

    # 1. Verificar se já está conectado
    estado = obter_status()
    if estado == 'open':
        print('\n  ✅ Número já está conectado!\n')
        _cmd_enviar_teste()
        return

    # 2. Criar instância se não existir
    if not criar_instancia():
        sys.exit(1)

    # 3. Obter e exibir QR Code
    print('\n▶ Aguardando QR Code (pode levar ate 30s)...')
    qr = obter_qr()

    if not qr:
        print('  ❌ Não foi possível obter o QR Code. Verifique se a Evolution API está rodando.')
        sys.exit(1)

    salvar_qr_png(qr)

    print(f'\n{SEP}')
    print('  PRÓXIMO PASSO — Escanear QR Code')
    print(SEP)
    print('  1. Abra o WhatsApp no celular com o número que vai ser usado')
    print('  2. Toque em ⋮ (Menu) → Dispositivos vinculados → Vincular dispositivo')
    print('  3. Escaneie o QR Code que abriu na tela')
    print(f'{SEP}')

    # 4. Aguardar conexão (polling)
    print('\n▶ Aguardando escaneamento do QR Code...')
    print('  (pressione Ctrl+C para cancelar)\n')
    try:
        for i in range(60):
            time.sleep(3)
            estado = obter_status()
            if estado == 'open':
                print(f'\n  ✅ NÚMERO CONECTADO COM SUCESSO!\n')
                _cmd_enviar_teste()
                return
            elif estado in ('connecting',):
                print(f'  ⏳ Conectando... ({i * 3}s)')
            else:
                print(f'  ⏳ Aguardando escaneamento... ({i * 3}s) [estado: {estado}]')
    except KeyboardInterrupt:
        print('\n\n  Cancelado pelo usuário.')
        print('  Para retomar, execute: python testar_evolution_whatsapp.py\n')
        sys.exit(0)

    print('\n  ⚠️  Timeout aguardando conexão (3 min).')
    print('  Execute novamente se quiser tentar de novo.\n')
    sys.exit(1)


def _cmd_enviar_teste():
    if not TEST_PHONE:
        print('\n  ⚠️  EVOLUTION_TEST_PHONE não configurado no .env')
        print('  Defina o número para receber o teste e rode novamente.\n')
        return

    print(f'\n▶ Enviando mensagem de teste para {TEST_PHONE}...')
    texto = (
        '*Painel Hospitalar*  Teste Evolution API\n'
        'Integração WhatsApp configurada com sucesso!\n'
        '_Esta é uma mensagem automática de teste._'
    )
    ok = enviar_mensagem(TEST_PHONE, texto)
    print(f'\n{SEP}')
    if ok:
        print(f'  ✅ Mensagem enviada com sucesso para {TEST_PHONE}')
    else:
        print(f'  ❌ Falha no envio para {TEST_PHONE}')
        print('  Verifique o número em EVOLUTION_TEST_PHONE (formato: 5561999887766)')
    print(SEP + '\n')


def cmd_send(texto: str):
    if not TEST_PHONE:
        print('\n  ❌ EVOLUTION_TEST_PHONE não configurado no .env\n')
        sys.exit(1)
    print(f'\n▶ Enviando para {TEST_PHONE}...')
    ok = enviar_mensagem(TEST_PHONE, texto)
    print(f'  {"✅ Enviado!" if ok else "❌ Falhou."}\n')
    if not ok:
        sys.exit(1)


def cmd_delete():
    print(f'\n▶ Removendo instância "{INSTANCE_NAME}"...')
    ok = deletar_instancia()
    print(f'  {"✅ Instância removida." if ok else "❌ Falha ao remover."}\n')


# ── Entry point ───────────────────────────────────────────────────

if __name__ == '__main__':
    arg = sys.argv[1].lower() if len(sys.argv) > 1 else ''

    if arg == 'status':
        cmd_status()
    elif arg == 'qr':
        cmd_qr()
    elif arg == 'send':
        texto = sys.argv[2] if len(sys.argv) > 2 else 'Teste manual Evolution API'
        cmd_send(texto)
    elif arg == 'delete':
        cmd_delete()
    elif arg in ('', 'connect', 'conectar'):
        cmd_conectar()
    else:
        print(__doc__)
