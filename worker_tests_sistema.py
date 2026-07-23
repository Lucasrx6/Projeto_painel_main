# -*- coding: utf-8 -*-
# Wrapper thin — NSSM aponta para este arquivo.
# Toda a logica esta em backend/notificadores/workers/tests_sistema/
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from backend.notificadores.workers.tests_sistema.main import (
    main, start_in_background, stop, executar_tudo, ciclo_automatico,
)

if __name__ == '__main__':
    main()
