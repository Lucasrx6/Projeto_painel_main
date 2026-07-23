# -*- coding: utf-8 -*-
from flask import Blueprint, jsonify, send_from_directory, current_app
from psycopg2.extras import RealDictCursor
from backend.database import get_db_cursor
from backend.middleware.decorators import login_required, panel_permission_required
from backend.cache import cache_route
from datetime import datetime, timedelta

painel50_bp = Blueprint('painel50', __name__)

_ORDEM_SETORES = [
    'UTI NEO',
    'UTI PED',
    'UTI ADULTO 1',
    'UTI ADULTO 2',
    'MATERNIDADE',
    'INTERNACAO CLINICA',
]


def _plantao_atual():
    """Retorna tipo, data e label do plantão com base na hora atual."""
    hora = datetime.now().hour
    if 7 <= hora < 19:
        return {
            'tipo': 'D',
            'label': 'DIURNO',
            'inicio': '07:00',
            'fim': '19:00',
            'dt_plantao': datetime.now().strftime('%Y-%m-%d'),
            'dt_plantao_display': datetime.now().strftime('%d/%m/%Y'),
        }
    elif hora >= 19:
        return {
            'tipo': 'N',
            'label': 'NOTURNO',
            'inicio': '19:00',
            'fim': '07:00',
            'dt_plantao': datetime.now().strftime('%Y-%m-%d'),
            'dt_plantao_display': datetime.now().strftime('%d/%m/%Y'),
        }
    else:
        # 00h–06h59: noturno que começou ontem
        ontem = (datetime.now() - timedelta(days=1)).strftime('%Y-%m-%d')
        ontem_display = (datetime.now() - timedelta(days=1)).strftime('%d/%m/%Y')
        return {
            'tipo': 'N',
            'label': 'NOTURNO',
            'inicio': '19:00',
            'fim': '07:00',
            'dt_plantao': ontem,
            'dt_plantao_display': ontem_display,
        }


def _tipo_esp(especialidade):
    esp = (especialidade or '').lower()
    if 'enfermeiro' in esp:
        return 'enfermeiro'
    if 'tecnico' in esp or 'técnico' in esp:
        return 'tecnico'
    return 'outro'


@painel50_bp.route('/painel/painel50')
@login_required
@panel_permission_required('painel50')
def painel50():
    return send_from_directory('paineis/painel50', 'index.html')


@painel50_bp.route('/api/paineis/painel50/dados')
@login_required
@cache_route(ttl=60, key_prefix='painel50:dados')
def api_painel50_dados():
    try:
        plantao = _plantao_atual()
        with get_db_cursor() as cursor:
            cursor.execute("""
                SELECT
                    ela.setor,
                    ela.ds_usuario,
                    ela.nm_usuario,
                    ela.especialidade,
                    TO_CHAR(ela.logon_time, 'HH24:MI') AS logon_fmt,
                    TO_CHAR(ela.dt_saida,   'HH24:MI') AS saida_fmt,
                    ela.ativo
                FROM enf_log_acesso ela
                WHERE ela.dt_plantao   = %s
                  AND ela.tipo_plantao = %s
                ORDER BY ela.setor, ela.ativo DESC, ela.ds_usuario
            """, (plantao['dt_plantao'], plantao['tipo']))
            registros = [dict(r) for r in cursor.fetchall()]

        # Agrupa por setor
        mapa = {}
        for r in registros:
            setor = (r['setor'] or 'OUTROS').strip()
            if setor not in mapa:
                mapa[setor] = {'setor': setor, 'ativos': [], 'saidos': []}
            prof = {
                'nome': r['ds_usuario'] or r['nm_usuario'],
                'especialidade': r['especialidade'] or '',
                'logon': r['logon_fmt'] or '--',
                'saida': r['saida_fmt'],
            }
            if r['ativo']:
                mapa[setor]['ativos'].append(prof)
            else:
                mapa[setor]['saidos'].append(prof)

        # Ordena setores: padrão primeiro, depois alfabético
        lista_setores = []
        for nome in _ORDEM_SETORES:
            if nome in mapa:
                lista_setores.append(mapa[nome])
        for nome, dados in sorted(mapa.items()):
            if nome not in _ORDEM_SETORES:
                lista_setores.append(dados)

        # Totais do plantão
        enf = tec = outros = ativos_agora = 0
        for s in lista_setores:
            todos = s['ativos'] + s['saidos']
            ativos_agora += len(s['ativos'])
            for p in todos:
                t = _tipo_esp(p['especialidade'])
                if t == 'enfermeiro':
                    enf += 1
                elif t == 'tecnico':
                    tec += 1
                else:
                    outros += 1

        return jsonify({
            'success': True,
            'plantao': plantao,
            'setores': lista_setores,
            'totais': {
                'enfermeiros': enf,
                'tecnicos': tec,
                'outros': outros,
                'ativos_agora': ativos_agora,
                'total_plantao': enf + tec + outros,
                'setores_com_ativo': len([s for s in lista_setores if s['ativos']]),
            }
        })
    except Exception as e:
        current_app.logger.error('Erro painel50: %s', e, exc_info=True)
        return jsonify({'success': False, 'error': 'Erro ao buscar dados'}), 500
