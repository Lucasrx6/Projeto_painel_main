"""
Painel 44 - Hub de Serviços
Central de navegação para todos os subsistemas e painéis do HAC.
Agrupa Padioleiro, Nutrição, Sentir e Agir, Helpdesk e serviços dinâmicos da hub_servicos.
"""
from flask import Blueprint, jsonify, send_from_directory, session, current_app
from backend.database import get_db_cursor
from backend.middleware.decorators import login_required

painel44_bp = Blueprint('painel44', __name__)

# Painéis que concedem acesso ao Hub — ter qualquer um deles é suficiente
_HUB_PAINEIS = {
    'painel14', 'painel15', 'painel28',
    'painel34', 'painel35', 'painel36',
    'painel41', 'painel42', 'painel43',
}

# ============================================================
# SUBSISTEMAS FIXOS — agrupados por área funcional
# Altere aqui para adicionar/remover grupos ou painéis.
# ============================================================
_SUBSISTEMAS = [
    {
        'id': 'padioleiro',
        'grupo': 'Transporte de Pacientes',
        'descricao': 'Gerenciamento de chamados de maqueiro e transporte de pacientes',
        'icone': 'fa-wheelchair-move',
        'cor': '#9B1C24',
        'paineis': [
            {'nome': 'Solicitar Transporte', 'icone': 'fa-circle-plus',     'url': '/painel/painel34', 'permissao': 'painel34'},
            {'nome': 'Tela do Padioleiro',   'icone': 'fa-person-walking',  'url': '/painel/painel35', 'permissao': 'painel35'},
            {'nome': 'Gestão e Relatórios',  'icone': 'fa-chart-bar',       'url': '/painel/painel36', 'permissao': 'painel36'},
        ]
    },
    {
        'id': 'nutricao',
        'grupo': 'Nutrição e Dietas',
        'descricao': 'Solicitação e gerenciamento de dietas hospitalares para pacientes',
        'icone': 'fa-bowl-food',
        'cor': '#28A745',
        'paineis': [
            {'nome': 'Solicitar Dieta',  'icone': 'fa-circle-plus', 'url': '/painel/painel41', 'permissao': 'painel41'},
            {'nome': 'Tela Nutrição',    'icone': 'fa-kitchen-set', 'url': '/painel/painel42', 'permissao': 'painel42'},
            {'nome': 'Gestão Nutrição',  'icone': 'fa-chart-pie',   'url': '/painel/painel43', 'permissao': 'painel43'},
        ]
    },
    {
        'id': 'sentir_agir',
        'grupo': 'Sentir e Agir',
        'descricao': 'Avaliação de qualidade assistencial e humanização hospitalar',
        'icone': 'fa-heart-pulse',
        'cor': '#E67E00',
        'paineis': [
            {'nome': 'Sentir e Agir', 'icone': 'fa-heart-pulse', 'url': '/paineis/painel28/sentir-agir.html', 'permissao': 'painel28'},
        ]
    },
    {
        'id': 'helpdesk',
        'grupo': 'Helpdesk TI',
        'descricao': 'Abertura e acompanhamento de chamados de suporte técnico',
        'icone': 'fa-headset',
        'cor': '#17A2B8',
        'paineis': [
            {'nome': 'Abrir Chamado',   'icone': 'fa-ticket',  'url': '/painel/painel14', 'permissao': 'painel14'},
            {'nome': 'Painel Helpdesk', 'icone': 'fa-desktop', 'url': '/painel/painel15', 'permissao': 'painel15'},
        ]
    },
]


@painel44_bp.route('/painel/painel44')
@login_required
def painel44():
    """Acesso liberado para qualquer usuário com ao menos um sub-painel do Hub."""
    if not session.get('is_admin', False):
        usuario_id = session.get('usuario_id')
        try:
            with get_db_cursor() as cursor:
                cursor.execute(
                    "SELECT 1 FROM permissoes_paineis WHERE usuario_id = %s AND painel_nome = ANY(%s) LIMIT 1",
                    (usuario_id, list(_HUB_PAINEIS))
                )
                if cursor.fetchone() is None:
                    return send_from_directory('frontend', 'acesso-negado.html')
        except Exception as e:
            current_app.logger.error('Erro ao verificar permissão painel44: %s', e, exc_info=True)
            return send_from_directory('frontend', 'acesso-negado.html')
    return send_from_directory('paineis/painel44', 'index.html')


@painel44_bp.route('/api/paineis/painel44/catalogo', methods=['GET'])
@login_required
def api_p44_catalogo():
    """
    Retorna subsistemas (filtrados por permissão do usuário) e
    serviços dinâmicos cadastrados na tabela hub_servicos.
    Admins veem tudo.
    """
    is_admin  = session.get('is_admin', False)
    usuario_id = session.get('usuario_id')

    perms_set = set()
    if not is_admin:
        try:
            with get_db_cursor() as cursor:
                cursor.execute(
                    "SELECT painel_nome FROM permissoes_paineis WHERE usuario_id = %s",
                    (usuario_id,)
                )
                perms_set = {row['painel_nome'] for row in cursor.fetchall()}
        except Exception as e:
            current_app.logger.error('Erro ao buscar permissões p44: %s', e, exc_info=True)

    # Filtrar subsistemas pelos painéis que o usuário pode acessar
    subsistemas = []
    for grupo in _SUBSISTEMAS:
        paineis_vis = []
        for p in grupo['paineis']:
            if is_admin or p['permissao'] in perms_set:
                paineis_vis.append({
                    'nome':  p['nome'],
                    'icone': p['icone'],
                    'url':   p['url'],
                })
        if paineis_vis:
            subsistemas.append({
                'id':       grupo['id'],
                'grupo':    grupo['grupo'],
                'descricao': grupo['descricao'],
                'icone':    grupo['icone'],
                'cor':      grupo['cor'],
                'paineis':  paineis_vis,
            })

    # Serviços dinâmicos da tabela hub_servicos (se existir)
    servicos = []
    try:
        with get_db_cursor() as cursor:
            cursor.execute("""
                SELECT id, nome, descricao, icone, cor, url_destino, tipo, ordem, permissao_requerida
                FROM hub_servicos WHERE ativo = TRUE ORDER BY ordem, nome
            """)
            for srv in cursor.fetchall():
                req = srv.get('permissao_requerida')
                if is_admin or req is None or req in perms_set:
                    d = dict(srv)
                    d.pop('permissao_requerida', None)
                    servicos.append(d)
    except Exception as e:
        current_app.logger.warning('hub_servicos indisponível ou erro: %s', e)

    return jsonify({'success': True, 'subsistemas': subsistemas, 'servicos': servicos})
