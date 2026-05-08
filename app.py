"""
Ponto de entrada da aplicação
Hospital Management Dashboard System
"""
from flask import Flask, jsonify
from flask_cors import CORS
from dotenv import load_dotenv
import sys
import io
import os
from datetime import datetime

# Configurações e middleware
from config import get_config, validate_production_config
from backend.logging_config import setup_logging
from backend.middleware.security import setup_security_headers
from backend.middleware.error_handlers import register_error_handlers
from backend.database import get_db_connection, init_db
from backend.cache import init_redis, cache_health

# Blueprints
from backend.routes.auth_routes import auth_bp
from backend.routes.main_routes import main_bp
from backend.routes.pwa_routes import pwa_bp
from backend.routes.admin_routes import admin_bp
from backend.routes.painel2_routes import painel2_bp
from backend.routes.painel3_routes import painel3_bp
from backend.routes.painel4_routes import painel4_bp
from backend.routes.painel5_routes import painel5_bp
from backend.routes.painel6_routes import painel6_bp
from backend.routes.painel7_routes import painel7_bp
from backend.routes.painel8_routes import painel8_bp
from backend.routes.painel9_routes import painel9_bp
from backend.routes.painel10_routes import painel10_bp
from backend.routes.painel11_routes import painel11_bp
from backend.routes.painel12_routes import painel12_bp
from backend.routes.painel13_routes import painel13_bp
from backend.routes.painel14_routes import painel14_bp
from backend.routes.painel15_routes import painel15_bp
from backend.routes.painel16_routes import painel16_bp
from backend.routes.painel17_routes import painel17_bp
from backend.routes.painel18_routes import painel18_bp
from backend.routes.painel19_routes import painel19_bp
from backend.routes.painel20_routes import painel20_bp
from backend.routes.painel21_routes import painel21_bp
from backend.routes.painel22_routes import painel22_bp
from backend.routes.painel23_routes import painel23_bp
from backend.routes.painel24_routes import painel24_bp
from backend.routes.painel25_routes import painel25_bp
from backend.routes.painel26_routes import painel26_bp
from backend.routes.painel27_routes import painel27_bp
from backend.routes.painel28_routes import painel28_bp
from backend.routes.painel29_routes import painel29_bp
from backend.routes.painel30_routes import painel30_bp
from backend.routes.painel31_routes import painel31_bp
from backend.routes.painel32_routes import painel32_bp
from backend.routes.painel33_routes import painel33_bp
from backend.routes.painel34_routes import painel34_bp
from backend.routes.painel35_routes import painel35_bp
from backend.routes.painel36_routes import painel36_bp
from backend.routes.painel37_routes import painel37_bp
from backend.routes.painel39_routes import painel39_bp
from backend.routes.painel38_routes import painel38_bp
from backend.routes.painel40_routes import painel40_bp
from backend.routes.tests_admin_routes import tests_bp

# =========================================================
# CONFIGURAÇÃO INICIAL
# =========================================================

# Carrega variáveis de ambiente
load_dotenv()

# Configura encoding UTF-8
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8', errors='replace')

# Cria aplicação Flask
app = Flask(__name__)

# Carrega configuração
config_class = get_config()
app.config.from_object(config_class)

# Valida configuração
validate_production_config()

# Exibe informações da configuração
print(config_class.info())

# =========================================================
# MIDDLEWARE E CONFIGURAÇÕES
# =========================================================

# Configura logging
setup_logging(app)

# Configura CORS usando as origens permitidas definidas por ambiente
allowed_origins = app.config.get('ALLOWED_ORIGINS', ['*'])
CORS(app,
     resources={r"/*": {"origins": allowed_origins}},
     supports_credentials=True,
     allow_headers=["Content-Type", "Authorization"],
     methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"])

# Configura security headers
setup_security_headers(app)

# Registra error handlers
register_error_handlers(app)

# Inicializa banco de dados
init_db()

# Inicializa cache Redis (falha graciosamente se Redis indisponivel)
init_redis(app)

# =========================================================
# REGISTRO DE BLUEPRINTS
# =========================================================

# Blueprints Core
app.register_blueprint(auth_bp)
app.register_blueprint(main_bp)
app.register_blueprint(pwa_bp)
app.register_blueprint(admin_bp)
app.register_blueprint(tests_bp)

# Blueprints de Painéis
paineis = [
    painel2_bp, painel3_bp, painel4_bp, painel5_bp,
    painel6_bp, painel7_bp, painel8_bp, painel9_bp,
    painel10_bp, painel11_bp, painel12_bp, painel13_bp,
    painel14_bp, painel15_bp, painel16_bp, painel17_bp,
    painel18_bp, painel19_bp, painel20_bp, painel21_bp,
    painel22_bp, painel23_bp, painel24_bp, painel25_bp,
    painel26_bp, painel27_bp, painel28_bp, painel29_bp,
    painel30_bp, painel31_bp, painel32_bp,
    #painel33_bp,
    painel34_bp, painel35_bp, painel36_bp,
    painel37_bp, painel38_bp,
    painel39_bp, painel40_bp
]

for painel in paineis:
    app.register_blueprint(painel)

app.logger.info(f' {len(paineis) + 4} Blueprints registrados com sucesso')


# =========================================================
# HEALTH CHECK — Redis
# =========================================================

@app.route('/api/health/redis')
def health_redis():
    """Status do Redis: latencia, versao, uso de memoria e hit rate."""
    return jsonify(cache_health())


# Notificador de pareceres — integrado como thread daemon
# OFF SWITCH: comente as 3 linhas abaixo para desativar, ou defina NOTIF_PARECERES_AUTO=false no .env
try:
    from notificador_pareceres import start_in_background as _start_notificador
    _start_notificador()
except Exception as e:
    app.logger.warning(f'[notificador_pareceres] Nao iniciado automaticamente: {e}')

# Notificador Sentir e Agir — integrado como thread daemon
# OFF SWITCH: comente as 3 linhas abaixo para desativar, ou defina NOTIF_SENTIR_AGIR_AUTO=false no .env
try:
    from notificador_sentir_agir import start_in_background as _start_sentir_agir
    _start_sentir_agir()
except Exception as e:
    app.logger.warning(f'[notificador_sentir_agir] Nao iniciado automaticamente: {e}')

# Worker analise diaria Sentir e Agir (IA Groq, ciclo 18h) — integrado como thread daemon
# OFF SWITCH: comente as 3 linhas abaixo para desativar, ou defina WORKER_SENTIR_AGIR_AUTO=false no .env
try:
    from worker_sentir_agir_analise import start_in_background as _start_worker_analise
    _start_worker_analise()
except Exception as e:
    app.logger.warning(f'[worker_sentir_agir_analise] Nao iniciado automaticamente: {e}')

# Worker IMAP — captura respostas de email e regulariza tratativas automaticamente
# OFF SWITCH: comente as 3 linhas abaixo para desativar, ou defina WORKER_IMAP_TRATATIVAS_AUTO=false no .env
try:
    from worker_imap_tratativas import start_in_background as _start_imap_worker
    _start_imap_worker()
except Exception as e:
    app.logger.warning(f'[worker_imap_tratativas] Nao iniciado automaticamente: {e}')

# Notificador Paciente PS — alerta quando há paciente aguardando >10min sem médico no PS
# OFF SWITCH: comente as 3 linhas abaixo para desativar, ou defina NOTIF_PACIENTE_PS_AUTO=false no .env
try:
    from notificador_paciente_ps import start_in_background as _start_paciente_ps
    _start_paciente_ps()
except Exception as e:
    app.logger.warning(f'[notificador_paciente_ps] Nao iniciado automaticamente: {e}')

# =========================================================
# ROTAS DE DESENVOLVIMENTO (Remover em produção)
# =========================================================

if app.config.get('DEBUG', False):
    @app.route('/debug/routes')
    def show_routes():
        """Mostra todas as rotas registradas - APENAS EM DEV"""
        output = ['<h2>Rotas Registradas:</h2><ul>']
        for rule in sorted(app.url_map.iter_rules(), key=lambda r: r.rule):
            methods = ','.join([m for m in rule.methods if m not in ['HEAD', 'OPTIONS']])
            output.append(f'<li><b>{rule.rule}</b> [{methods}] → {rule.endpoint}</li>')
        output.append('</ul>')
        return ''.join(output)


    @app.route('/debug/check-files')
    def debug_check_files():
        """Verifica se os arquivos existem - APENAS EM DEV"""
        files_to_check = [
            'frontend/login.html',
            'frontend/dashboard.html',
            'frontend/admin-usuarios.html',
            'frontend/acesso-negado.html'
        ]

        results = {}
        for filepath in files_to_check:
            exists = os.path.exists(filepath)
            absolute_path = os.path.abspath(filepath)
            results[filepath] = {
                'exists': exists,
                'absolute_path': absolute_path
            }

        return jsonify({
            'current_directory': os.getcwd(),
            'files': results
        })

# =========================================================
# INICIALIZAÇÃO DO SERVIDOR
# =========================================================

if __name__ == '__main__':
    import socket

    hostname = socket.gethostname()
    local_ip = socket.gethostbyname(hostname)

    # Banner de inicialização
    print("\n" + "=" * 60)
    print("HOSPITAL MANAGEMENT DASHBOARD - SERVIDOR INICIADO")
    print("=" * 60)
    print("Sistema de autenticação ativo")
    print("Headers de segurança habilitados")
    print("Sistema de logging configurado")
    print("CORS configurado")

    if app.config.get('DEBUG', False):
        print("Modo DEBUG ativo")
        print("   • /debug/routes - Ver rotas registradas")
        print("   • /debug/check-files - Verificar arquivos")

    print("Painéis disponíveis:")
    print("   • Evolução de Turno      → /painel/painel2")
    print("   • Médicos PS             → /painel/painel3")
    print("   • Ocupação Hospitalar    → /painel/painel4")
    print("   • Cirurgias do Dia       → /painel/painel5")
    print("   • Priorização IA         → /painel/painel6")
    print("   • Detecção Sepse         → /painel/painel7")
    print("   • Situação Pacientes     → /painel/painel8")
    print("   • Lab Pendentes          → /painel/painel9")
    print("   • Análise PS             → /painel/painel10")
    print("   • Internação PS          → /painel/painel11")
    print("   • Ocupação e Produção    → /painel/painel12")
    print("   • Mapa de Nutrição       → /painel/painel13")
    print("   • Score Farmacêutico     → /painel/painel38")

    print(" URLs de Acesso:")
    print(f"   • Local:                 http://localhost:5000")
    print(f"   • Local (IP):            http://127.0.0.1:5000")
    print(f"   • Rede Local:            http://{local_ip}:5000")
    print(f"   • VPN/Remoto:            http://<IP-VPN>:5000")
    print("=" * 60 + "\n")

    # Inicia servidor
    # reloader_type='stat' evita WinError 10038 no Python 3.12+ no Windows
    # (o reloader 'watchdog' tem incompatibilidade com o select() do Windows)
    app.run(
        debug=app.config.get('DEBUG', False),
        host='0.0.0.0',
        port=5000,
        use_reloader=app.config.get('DEBUG', False),
        reloader_type='stat'
    )