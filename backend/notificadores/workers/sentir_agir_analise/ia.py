# -*- coding: utf-8 -*-
from .config import logger, GROQ_API_KEY, GROQ_MODEL, PERIODO_SEMANAL_DIAS


def _get_groq_client():
    if not GROQ_API_KEY:
        return None
    try:
        from groq import Groq
        return Groq(api_key=GROQ_API_KEY)
    except ImportError:
        logger.error('Biblioteca groq nao instalada. Execute: pip install groq')
        return None


def gerar_analise_ia(dados):
    """Chama Groq e retorna texto da analise diaria ou None em caso de erro."""
    client = _get_groq_client()
    if not client:
        logger.error('Groq client nao disponivel.')
        return None

    data_str = dados['data']
    setores = dados['setores']

    blocos = ''
    for s in setores:
        blocos += '\n\n=== SETOR: {} ===\n'.format(s['setor_nome'])
        blocos += 'Visitas: {} | Criticos: {} | Atencao: {} | Adequados: {}\n'.format(
            s['total'], s['criticos'], s['atencao'], s['adequados']
        )
        itens_relevantes = []
        for idx, v in enumerate(s.get('visitas', []), 1):
            for item in v.get('itens_problema', []):
                linha = '  [{}] {} > {}'.format(
                    item['resultado'].upper(),
                    item['categoria_nome'],
                    item['item_descricao']
                )
                if item.get('obs_item'):
                    linha += ' -- Critica: ' + item['obs_item'][:150]
                linha += ' (Vis. {})'.format(idx)
                itens_relevantes.append(linha)

        if itens_relevantes:
            blocos += 'Itens criticos/atencao:\n' + '\n'.join(itens_relevantes[:20]) + '\n'

    prompt = (
        'Voce e um analista de qualidade assistencial do Hospital Anchieta Ceilandia, '
        'especializado no Projeto Sentir e Agir.\n\n'
        'Data da analise: {}\n\n'
        'Analise os dados das visitas realizadas e forneca um relatorio executivo por setor:\n'
        '{}\n\n'
        'Para CADA setor, responda com:\n'
        '**[NOME DO SETOR]**\n'
        '- Avaliacao Geral: (uma frase resumindo o estado)\n'
        '- Pontos Criticos: (principais problemas, se houver)\n'
        '- Observacoes Relevantes: (situacoes de atencao)\n'
        '- Tendencia: ADEQUADO | REQUER ATENCAO | SITUACAO CRITICA\n\n'
        'Ao final, inclua:\n'
        '**SINTESE GERAL DO DIA**\n'
        '- Setores mais criticos\n'
        '- Principais pontos de melhoria\n'
        '- Recomendacao geral\n\n'
        'Seja objetivo e profissional. Responda em portugues do Brasil.'
    ).format(data_str, blocos)

    try:
        response = client.chat.completions.create(
            model=GROQ_MODEL,
            messages=[
                {
                    'role': 'system',
                    'content': (
                        'Voce e um analista de qualidade hospitalar especializado em '
                        'experiencia do paciente. Responda sempre em portugues do Brasil, '
                        'de forma objetiva e profissional.'
                    )
                },
                {'role': 'user', 'content': prompt}
            ],
            max_tokens=3000,
            temperature=0.3
        )
        return response.choices[0].message.content
    except Exception as e:
        logger.error('Erro ao chamar Groq: %s', e)
        return None


def gerar_analise_categorias(dados):
    """Chama Groq para analise semanal de categorias."""
    client = _get_groq_client()
    if not client:
        logger.error('[semanal] Groq client nao disponivel.')
        return None

    blocos = ''
    for c in dados['categorias']:
        total_aberto = (c['total_pendente'] or 0) + (c['total_tratativa'] or 0)
        if total_aberto == 0:
            continue
        blocos += '\n\n--- CATEGORIA: {} ---\n'.format(c['categoria_nome'])
        blocos += 'Em aberto: {} ({} pendentes, {} em tratativa) | Tratados: {}\n'.format(
            total_aberto, c['total_pendente'] or 0,
            c['total_tratativa'] or 0, c['total_tratado'] or 0
        )
        itens = [i for i in (c.get('itens_abertos') or []) if i]
        if itens:
            blocos += 'Itens mais recorrentes:\n'
            for it in itens[:8]:
                blocos += '  - {}\n'.format(it)

    prompt = (
        'Voce e um analista de qualidade assistencial do Hospital Anchieta Ceilandia, '
        'especializado no Projeto Sentir e Agir.\n\n'
        'Periodo: {} a {} ({} dias) | Tratativas em aberto: {}\n\n'
        'Pontos criticos agrupados por CATEGORIA:\n{}\n\n'
        'Para CADA categoria com itens em aberto, responda:\n'
        '**[NOME DA CATEGORIA]** — N tratativas\n'
        '- Situacao: (uma frase resumindo)\n'
        '- Itens mais recorrentes: (principais problemas)\n'
        '- Criticidade: BAIXO | MODERADO | ALTO | CRITICO\n'
        '- Recomendacao: (acao prioritaria sugerida)\n\n'
        'Ao final:\n'
        '**RESUMO SEMANAL**\n'
        '- Top 3 categorias mais criticas\n'
        '- Acao prioritaria recomendada\n\n'
        'Seja objetivo e profissional. Responda em portugues do Brasil.'
    ).format(
        dados['data_inicio'], dados['data_fim'],
        dados.get('periodo_dias', 7), dados['total_aberto'], blocos
    )

    try:
        response = client.chat.completions.create(
            model=GROQ_MODEL,
            messages=[
                {
                    'role': 'system',
                    'content': (
                        'Voce e um analista de qualidade hospitalar. '
                        'Responda sempre em portugues do Brasil, de forma objetiva e profissional.'
                    )
                },
                {'role': 'user', 'content': prompt}
            ],
            max_tokens=2500,
            temperature=0.3
        )
        return response.choices[0].message.content
    except Exception as e:
        logger.error('[semanal] Erro ao chamar Groq: %s', e)
        return None
