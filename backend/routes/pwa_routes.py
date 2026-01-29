"""
Rotas para Progressive Web App (PWA)
Endpoints: manifest.json, service worker, offline page
"""
from flask import Blueprint, send_from_directory

# Cria o Blueprint
pwa_bp = Blueprint('pwa', __name__)


@pwa_bp.route('/manifest.json')
def manifest():
    """Serve o manifest do PWA"""
    return send_from_directory('.', 'manifest.json', mimetype='application/manifest+json')


@pwa_bp.route('/sw.js')
def service_worker():
    """Serve o service worker"""
    response = send_from_directory('.', 'sw.js', mimetype='application/javascript')
    # Evita cache do service worker (sempre busca versão mais recente)
    response.headers['Cache-Control'] = 'no-cache, no-store, must-revalidate'
    response.headers['Pragma'] = 'no-cache'
    response.headers['Expires'] = '0'
    return response


@pwa_bp.route('/offline.html')
def offline():
    """Página offline"""
    return send_from_directory('frontend', 'offline.html')