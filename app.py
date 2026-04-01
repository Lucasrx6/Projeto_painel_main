"""
Ponto de entrada da aplicação
Hospital Management Dashboard System
"""
from dotenv import load_dotenv
import os
import socket

from backend.app_factory import create_app

# Carrega variáveis de ambiente
load_dotenv()

# Cria aplicação via factory (configuração, blueprints, middlewares, DB)
app = create_app()

# =========================================================
# ROTAS DE DESENVOLVIMENTO (definidas aqui pois precisam do app)
# =========================================================

if app.config.get('DEBUG', False):
    from flask import jsonify

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
            results[filepath] = {
                'exists': os.path.exists(filepath),
                'absolute_path': os.path.abspath(filepath)
            }
        return jsonify({'current_directory': os.getcwd(), 'files': results})


# =========================================================
# INICIALIZAÇÃO DO SERVIDOR
# =========================================================

if __name__ == '__main__':
    hostname = socket.gethostname()
    local_ip = socket.gethostbyname(hostname)

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

    print(" URLs de Acesso:")
    print(f"   • Local:                 http://localhost:5000")
    print(f"   • Local (IP):            http://127.0.0.1:5000")
    print(f"   • Rede Local:            http://{local_ip}:5000")
    print(f"   • VPN/Remoto:            http://<IP-VPN>:5000")
    print("=" * 60 + "\n")

    app.run(
        debug=app.config.get('DEBUG', False),
        host='0.0.0.0',
        port=5000,
        use_reloader=app.config.get('DEBUG', False)
    )
