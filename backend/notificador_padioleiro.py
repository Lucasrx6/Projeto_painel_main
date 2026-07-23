# -*- coding: utf-8 -*-
# Wrapper thin — app.py importa deste modulo.
# Toda a logica esta em backend/notificadores/padioleiro/
from backend.notificadores.padioleiro.main import (
    start_in_background,
    stop,
    executar_envio,
)
from backend.notificadores.padioleiro.banco import buscar_dados
from backend.notificadores.padioleiro.excel import gerar_excel
from backend.notificadores.padioleiro.email import gerar_html, enviar_email

if __name__ == '__main__':
    from backend.notificadores.padioleiro.main import main
    main()
