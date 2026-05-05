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
        # Pega o diretório raiz do projeto (um nível acima do backend)
        root_dir = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
        
        # Executa o pytest com output em JSON
        result = subprocess.run(
            ['python', '-m', 'pytest', 'tests/', '--json-report', '--json-report-file=test_report.json'],
            cwd=root_dir,
            capture_output=True,
            text=True
        )
        
        # Lê o relatório JSON gerado pelo pytest-json-report (se instalado) ou faz fallback
        report_path = os.path.join(root_dir, 'test_report.json')
        if os.path.exists(report_path):
            with open(report_path, 'r', encoding='utf-8') as f:
                report_data = json.load(f)
            
            # Limpa o arquivo
            try:
                os.remove(report_path)
            except:
                pass
                
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
            'error': str(e)
        }), 500
