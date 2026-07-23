# -*- coding: utf-8 -*-
# Utilitarios compartilhados entre excel.py e email.py (sem imports circulares)

# Colunas candidatas que guardam o nome do setor
# O Apache Hop pode gravar a expressao como nome de coluna
_CANDIDATOS_SETOR = [
    'obter_nome_setor(a.cd_setor_atendimento)',
    'nm_setor', 'nome_setor', 'ds_setor', 'descricao_setor', 'setor',
]

# Labels de colunas que contem dados pessoais (LGPD) — comparados pelo label exibido no Excel
_LABELS_NOME = {'paciente', 'medico', 'nm paciente', 'nm guerra', 'nome paciente', 'nome medico', 'medico atendimento'}

_COL_LABELS = {
    'obter_nome_setor(a.cd_setor_atendimento)': 'Setor',
    'cd_setor_atendimento': 'Cod. Setor',
    'nm_pessoa_fisica':     'Paciente',
    'nm_guerra':            'Medico',
    'nr_atendimento':       'Atendimento',
    'dt_entrada_unidade':   'Entrada',
    'qt_dia_permanencia':   'Dias',
    'ds_convenio':          'Convenio',
    'ds_clinica':           'Clinica',
    'ie_status_unidade':    'Status',
    'ie_sexo':              'Sexo',
}


def _label_coluna(col):
    return _COL_LABELS.get(col.lower(), col.replace('_', ' ').title())


def _nome_setor(row):
    """Extrai nome do setor buscando colunas candidatas em ordem de prioridade."""
    for c in _CANDIDATOS_SETOR:
        val = row.get(c)
        if val and str(val).strip():
            return str(val).strip()
    return '-'


def _anonimizar(nome):
    """LGPD: 'Lucas Fernandes de Oliveira' -> 'L F D Oliveira'"""
    if not nome:
        return nome
    partes = str(nome).strip().split()
    if len(partes) == 1:
        return partes[0][0].upper() + '.'
    iniciais = [p[0].upper() for p in partes[:-1]]
    return ' '.join(iniciais) + ' ' + partes[-1].capitalize()


def _cor_taxa(valor):
    try:
        v = float(valor)
        if v >= 90:
            return "#C00000", "CRITICA"
        if v >= 75:
            return "#FF8C00", "ALERTA"
        return "#375623", "NORMAL"
    except (TypeError, ValueError):
        return "#555555", "-"
