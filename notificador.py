# -*- coding: utf-8 -*-
# Wrapper thin — NSSM aponta para este arquivo.
# Toda a logica esta em backend/notificadores/admissao/
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from backend.notificadores.admissao.main import main

if __name__ == '__main__':
    main()
