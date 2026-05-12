"""
Notificador WhatsApp via CallMeBot API

Uso básico:
    from backend.notificador_whatsapp import enviar_mensagem
    enviar_mensagem("Alerta: ocupação UTI acima de 90%")

Configuração no .env:
    WHATSAPP_PHONE=556196015894
    WHATSAPP_APIKEY=5430888
    # Múltiplos destinatários (separados por vírgula):
    WHATSAPP_PHONES=556196015894,5561XXXXXXXXX
"""
import os
import time
import logging
import urllib.parse
import urllib.request
import urllib.error
from dotenv import load_dotenv

load_dotenv()

logger = logging.getLogger(__name__)

_CALLMEBOT_URL = 'https://api.callmebot.com/whatsapp.php'

# CallMeBot recomenda no máximo 1 mensagem por segundo entre destinatários
_INTERVALO_ENTRE_ENVIOS_S = 1.5


def enviar_mensagem(texto: str, phone: str = None, apikey: str = None) -> bool:
    """
    Envia mensagem WhatsApp para um único número via CallMeBot.

    Args:
        texto:  Texto da mensagem (será URL-encoded automaticamente)
        phone:  Número com DDI (ex: 556196015894). Se None, usa WHATSAPP_PHONE do .env
        apikey: API key do CallMeBot. Se None, usa WHATSAPP_APIKEY do .env

    Returns:
        True se enviado com sucesso, False caso contrário.
    """
    phone  = phone  or os.getenv('WHATSAPP_PHONE', '').strip()
    apikey = apikey or os.getenv('WHATSAPP_APIKEY', '').strip()

    if not phone:
        logger.error('[whatsapp] WHATSAPP_PHONE não configurado no .env')
        return False
    if not apikey:
        logger.error('[whatsapp] WHATSAPP_APIKEY não configurado no .env')
        return False

    texto_encoded = urllib.parse.quote(texto, safe='')
    url = f'{_CALLMEBOT_URL}?phone={phone}&text={texto_encoded}&apikey={apikey}'

    try:
        req = urllib.request.Request(url, headers={'User-Agent': 'PainelHospitalar/1.0'})
        with urllib.request.urlopen(req, timeout=20) as resp:
            status = resp.getcode()
            body   = resp.read().decode('utf-8', errors='replace').strip()
            if status == 200:
                logger.info('[whatsapp] ✅ Mensagem enviada → %s | %s', phone, body[:120])
                return True
            else:
                logger.warning('[whatsapp] ⚠️ Resposta inesperada %s para %s: %s', status, phone, body[:200])
                return False
    except urllib.error.HTTPError as e:
        body = e.read().decode('utf-8', errors='replace').strip()
        logger.error('[whatsapp] ❌ Erro HTTP %s ao enviar para %s: %s', e.code, phone, body[:200])
        return False
    except urllib.error.URLError as e:
        logger.error('[whatsapp] ❌ Erro de conexão ao enviar para %s: %s', phone, e.reason)
        return False
    except Exception as e:
        logger.error('[whatsapp] ❌ Erro inesperado ao enviar para %s: %s', phone, e)
        return False


def enviar_para_todos(texto: str, apikey: str = None) -> dict:
    """
    Envia mensagem WhatsApp para todos os números configurados em WHATSAPP_PHONES.
    Se WHATSAPP_PHONES não estiver definido, usa WHATSAPP_PHONE (número único).

    Returns:
        dict {phone: bool} com o resultado por destinatário.
    """
    apikey = apikey or os.getenv('WHATSAPP_APIKEY', '').strip()

    # Suporta lista de números ou número único
    phones_raw = os.getenv('WHATSAPP_PHONES', '') or os.getenv('WHATSAPP_PHONE', '')
    phones = [p.strip() for p in phones_raw.split(',') if p.strip()]

    if not phones:
        logger.error('[whatsapp] Nenhum número configurado (WHATSAPP_PHONES ou WHATSAPP_PHONE)')
        return {}

    resultados = {}
    for i, phone in enumerate(phones):
        if i > 0:
            time.sleep(_INTERVALO_ENTRE_ENVIOS_S)
        resultados[phone] = enviar_mensagem(texto, phone=phone, apikey=apikey)

    enviados = sum(1 for ok in resultados.values() if ok)
    logger.info('[whatsapp] Envio concluído: %d/%d destinatários com sucesso', enviados, len(phones))
    return resultados
