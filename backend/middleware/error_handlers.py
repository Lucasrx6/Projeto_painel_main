"""
Handlers centralizados de erros HTTP
"""
from flask import jsonify, request


def register_error_handlers(app):
    """
    Registra todos os error handlers no Flask app

    Args:
        app: Instância do Flask app
    """

    @app.errorhandler(404)
    def not_found(error):
        app.logger.warning(f'404 Error: {request.url}')
        return jsonify({
            'success': False,
            'error': 'Recurso não encontrado'
        }), 404

    @app.errorhandler(500)
    def internal_error(error):
        app.logger.error(f'500 Error: {error}', exc_info=True)

        if app.config.get('DEBUG', False):
            return jsonify({
                'success': False,
                'error': 'Erro interno do servidor',
                'details': str(error)
            }), 500
        else:
            return jsonify({
                'success': False,
                'error': 'Erro interno do servidor'
            }), 500

    @app.errorhandler(403)
    def forbidden(error):
        app.logger.warning(f'403 Error: {request.url}')
        return jsonify({
            'success': False,
            'error': 'Acesso negado'
        }), 403

    @app.errorhandler(401)
    def unauthorized(error):
        app.logger.warning(f'401 Error: {request.url}')
        return jsonify({
            'success': False,
            'error': 'Não autenticado',
            'redirect': '/login.html'
        }), 401

    @app.errorhandler(Exception)
    def handle_exception(error):
        app.logger.error(f'Unhandled Exception: {error}', exc_info=True)

        if app.config.get('DEBUG', False):
            return jsonify({
                'success': False,
                'error': 'Erro inesperado',
                'details': str(error)
            }), 500
        else:
            return jsonify({
                'success': False,
                'error': 'Erro inesperado. Contate o suporte.'
            }), 500

    app.logger.info('✅ Error handlers registrados')