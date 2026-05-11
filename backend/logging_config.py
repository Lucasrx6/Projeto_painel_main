"""
Configuração centralizada de logging do sistema
Rotação diária com retenção de 3 dias
"""
import os
import time
import logging
from logging.handlers import TimedRotatingFileHandler


class _SafeTimedRotatingFileHandler(TimedRotatingFileHandler):
    """
    TimedRotatingFileHandler com retry para Windows.

    No Windows, os.rename() falha com PermissionError (WinError 32) quando
    outra thread ainda está com o arquivo aberto no momento da rotação.
    Este handler tenta até 10 vezes com intervalo de 200ms antes de desistir.
    O servidor nunca cai — na pior hipótese o arquivo não é rotacionado naquele ciclo.
    """

    def rotate(self, source, dest):
        for _ in range(10):
            try:
                super().rotate(source, dest)
                return
            except PermissionError:
                time.sleep(0.2)


def setup_logging(app):
    """
    Configura sistema de logging com rotação diária
    Mantém apenas logs dos últimos 3 dias

    Args:
        app: Instância do Flask app
    """
    if not os.path.exists('logs'):
        os.mkdir('logs')

    log_level = getattr(logging, app.config.get('LOG_LEVEL', 'INFO'), logging.INFO)

    # Formato padronizado com mais informações
    formatter = logging.Formatter(
        '[%(asctime)s] %(levelname)s [%(name)s:%(lineno)d] - %(message)s',
        datefmt='%Y-%m-%d %H:%M:%S'
    )

    # ========================================
    # ROTAÇÃO DIÁRIA - Mantém apenas 3 dias
    # ========================================
    file_handler = _SafeTimedRotatingFileHandler(
        'logs/painel.log',
        when='midnight',  # Rotaciona à meia-noite
        interval=1,  # A cada 1 dia
        backupCount=3,  # Mantém apenas 3 arquivos antigos
        encoding='utf-8'
    )
    file_handler.setFormatter(formatter)
    file_handler.setLevel(log_level)

    # Adiciona sufixo com data aos arquivos rotacionados
    file_handler.suffix = "%Y-%m-%d"

    # Handler do console (terminal)
    console_handler = logging.StreamHandler()
    console_handler.setFormatter(formatter)
    console_handler.setLevel(log_level)

    # Remove handlers existentes para evitar duplicação
    app.logger.handlers.clear()

    # Adiciona handlers ao logger
    app.logger.addHandler(file_handler)
    app.logger.addHandler(console_handler)
    app.logger.setLevel(log_level)

    app.logger.info('✅ Sistema de logging configurado (rotação diária, retenção: 3 dias)')