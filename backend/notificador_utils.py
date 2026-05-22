"""
Utilitários compartilhados para notificadores e workers.
"""
import os
import logging
from logging.handlers import RotatingFileHandler

import psycopg2
from dotenv import load_dotenv

load_dotenv()


def setup_notificador_logging(nome: str, log_file: str) -> logging.Logger:
    """Configura logger rotativo padrão para notificadores (5 MB, 5 backups)."""
    logger = logging.getLogger(nome)
    logger.setLevel(logging.INFO)
    if not logger.handlers:
        fmt = logging.Formatter(
            '%(asctime)s [%(levelname)s] %(message)s',
            datefmt='%Y-%m-%d %H:%M:%S'
        )
        fh = RotatingFileHandler(
            os.path.join('logs', log_file),
            maxBytes=5_000_000,
            backupCount=5,
            encoding='utf-8'
        )
        fh.setFormatter(fmt)
        sh = logging.StreamHandler()
        sh.setFormatter(logging.Formatter(
            '%(asctime)s [%(levelname)s] %(message)s',
            datefmt='%H:%M:%S'
        ))
        logger.addHandler(fh)
        logger.addHandler(sh)
    return logger


def get_db_config() -> dict:
    """Retorna dict de configuração PostgreSQL para notificadores."""
    return {
        'host': os.getenv('DB_HOST', 'localhost'),
        'database': os.getenv('DB_NAME', 'postgres'),
        'user': os.getenv('DB_USER', 'postgres'),
        'password': os.getenv('DB_PASSWORD', 'postgres'),
        'port': int(os.getenv('DB_PORT', 5432)),
        'connect_timeout': 10,
    }


def get_smtp_config() -> dict:
    """Retorna dict de configuração SMTP para notificadores."""
    return {
        'host': os.getenv('SMTP_HOST', 'smtp.gmail.com'),
        'port': int(os.getenv('SMTP_PORT', 587)),
        'user': os.getenv('SMTP_USER', ''),
        'password': os.getenv('SMTP_PASS', ''),
        'sender': os.getenv('SMTP_FROM', ''),
    }


def conectar_db():
    """Cria e retorna conexão PostgreSQL direta (sem pool) para uso em workers."""
    return psycopg2.connect(**get_db_config())
