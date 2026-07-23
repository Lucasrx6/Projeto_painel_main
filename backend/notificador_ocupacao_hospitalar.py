# -*- coding: utf-8 -*-
# Wrapper thin — app.py importa deste modulo.
# Toda a logica esta em backend/notificadores/ocupacao/
from backend.notificadores.ocupacao.main import (
    get_status,
    executar_envio,
    start_in_background,
    stop,
)
from backend.notificadores.ocupacao.banco import buscar_dados
from backend.notificadores.ocupacao.excel import gerar_excel
from backend.notificadores.ocupacao.email import gerar_corpo_html, enviar_email

if __name__ == '__main__':
    from backend.notificadores.ocupacao.main import main
    main()
