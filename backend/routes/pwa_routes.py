"""
Rotas para Progressive Web App (PWA)
Endpoints: manifest.json, service worker, offline page
"""
import os
import re
from flask import Blueprint, send_from_directory, Response

pwa_bp = Blueprint('pwa', __name__)

# Versão injetada no CACHE_NAME do Service Worker.
# Deve coincidir com SISTEMA_VERSAO em static/js/versao.js.
# Ao atualizar versao.js, atualize este valor para forçar o SW
# a descartar o cache antigo e recarregar todos os assets.
_SW_VERSION = '1.1.5'

# Lê sw.js uma vez ao startup e substitui o CACHE_NAME pela versão atual.
# Evita drift entre a versão do app e o nome do cache do SW.
_SW_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'sw.js')
try:
    with open(_SW_PATH, encoding='utf-8') as _f:
        _SW_CONTENT = re.sub(
            r"const CACHE_NAME = 'paineis-hospitalares-v[^']+'",
            "const CACHE_NAME = 'paineis-hospitalares-v" + _SW_VERSION + "'",
            _f.read()
        )
except Exception:
    _SW_CONTENT = None


@pwa_bp.route('/manifest.json')
def manifest():
    """Serve o manifest do PWA"""
    return send_from_directory('.', 'manifest.json', mimetype='application/manifest+json')


@pwa_bp.route('/sw.js')
def service_worker():
    """Serve o service worker com a versão atual injetada no CACHE_NAME."""
    if _SW_CONTENT:
        response = Response(_SW_CONTENT, mimetype='application/javascript')
    else:
        response = send_from_directory('.', 'sw.js', mimetype='application/javascript')
    response.headers['Cache-Control'] = 'no-cache, no-store, must-revalidate'
    response.headers['Pragma'] = 'no-cache'
    response.headers['Expires'] = '0'
    return response


@pwa_bp.route('/offline.html')
def offline():
    """Página offline"""
    return send_from_directory('frontend', 'offline.html')