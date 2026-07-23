# -*- coding: utf-8 -*-
from datetime import datetime, timedelta

_MESES_PT = [
    'janeiro', 'fevereiro', 'marco', 'abril', 'maio', 'junho',
    'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'
]
_DIAS_SEMANA_PT = [
    'segunda-feira', 'terca-feira', 'quarta-feira', 'quinta-feira',
    'sexta-feira', 'sabado', 'domingo'
]


def _data_pt(dt):
    """Retorna '05 de junho de 2026'."""
    return f"{dt.day:02d} de {_MESES_PT[dt.month - 1]} de {dt.year}"


def _data_hora_pt(dt):
    """Retorna 'Quinta-feira, 05 de junho de 2026 — 06:00'."""
    dia_sem = _DIAS_SEMANA_PT[dt.weekday()].capitalize()
    return f"{dia_sem}, {_data_pt(dt)} — {dt.strftime('%H:%M')}"


def _calcular_periodo(now):
    """
    Determina o periodo do relatorio com base na hora atual:
      - Antes das 12h  -> Noturno: 18h do dia anterior ate 06h de hoje
      - A partir das 12h -> Diurno: 06h ate 18h de hoje
    Retorna: (inicio, fim, horas_periodo, nome_periodo, turno)
    """
    hoje = now.date()
    if now.hour < 12:
        ontem = hoje - timedelta(days=1)
        inicio = datetime(ontem.year, ontem.month, ontem.day, 18, 0, 0)
        fim    = datetime(hoje.year,  hoje.month,  hoje.day,   6, 0, 0)
        horas  = list(range(18, 24)) + list(range(0, 6))
        nome   = "Noturno (18h -> 06h)"
        turno  = "noite"
    else:
        inicio = datetime(hoje.year, hoje.month, hoje.day,  6, 0, 0)
        fim    = datetime(hoje.year, hoje.month, hoje.day, 18, 0, 0)
        horas  = list(range(6, 18))
        nome   = "Diurno (06h -> 18h)"
        turno  = "dia"
    return inicio, fim, horas, nome, turno


def _fmt(val, sufixo=''):
    if val is None:
        return '--'
    return f'{val}{sufixo}'
