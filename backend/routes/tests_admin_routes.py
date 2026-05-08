"""
Rotas para o painel de gerenciamento de testes do admin.
"""
from flask import Blueprint, jsonify, send_from_directory
import subprocess
import os
import json
from backend.middleware.decorators import admin_required

tests_bp = Blueprint('tests_admin', __name__, url_prefix='/api/admin/tests')

@tests_bp.route('/page', methods=['GET'])
@admin_required
def render_tests_page():
    return send_from_directory('frontend', 'admin-testes.html')

@tests_bp.route('/run', methods=['POST'])
@admin_required
def run_tests():
    """
    Executa a suíte de testes pytest e retorna os resultados.
    POST /api/admin/tests/run
    """
    try:
        import tempfile
        # Pega o diretório raiz do projeto (um nível acima do backend)
        root_dir = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
        
        # Cria um arquivo temporário para o relatório para evitar trigger no Flask auto-reloader
        fd, report_path = tempfile.mkstemp(suffix='.json')
        os.close(fd)

        # Prepara ambiente sem gerar .pyc para não trigar reloader
        env = os.environ.copy()
        env['PYTHONDONTWRITEBYTECODE'] = '1'
        
        # Executa o pytest com output em JSON (desabilita cache também)
        result = subprocess.run(
            ['python', '-m', 'pytest', 'tests/', '-p', 'no:cacheprovider', '--json-report', f'--json-report-file={report_path}'],
            cwd=root_dir,
            capture_output=True,
            text=True,
            env=env
        )
        
        # Lê o relatório JSON gerado pelo pytest-json-report
        report_data = None
        if os.path.exists(report_path):
            with open(report_path, 'r', encoding='utf-8') as f:
                try:
                    report_data = json.load(f)
                except json.JSONDecodeError:
                    pass
            
            # Limpa o arquivo temporário
            try:
                os.remove(report_path)
            except:
                pass
                
        if report_data:
            return jsonify({
                'success': True,
                'exit_code': result.returncode,
                'output': result.stdout,
                'report': report_data
            })
            
        # Fallback se não tiver pytest-json-report
        return jsonify({
            'success': True,
            'exit_code': result.returncode,
            'output': result.stdout,
            'stderr': result.stderr
        })

    except Exception as e:
        return jsonify({
            'success': False,
            'error': 'Erro interno do servidor'
        }), 500


@tests_bp.route('/sistema/run', methods=['POST'])
@admin_required
def run_sistema_checks():
    """
    Executa verificações e reparos do sistema e retorna os resultados.
    POST /api/admin/tests/sistema/run
    """
    try:
        from worker_tests_sistema import executar_tudo
        resultado = executar_tudo()
        return jsonify(resultado)
    except Exception as e:
        return jsonify({
            'output': f'[ERRO] Falha ao executar verificações do sistema:\n{e}',
            'duracao': 0,
            'report': {
                'summary': {'ok': 0, 'erros': 1, 'reparados': 0, 'total': 1},
                'duration': 0,
            }
        }), 500
