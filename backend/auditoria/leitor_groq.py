"""
backend/auditoria/leitor_groq.py
Leitor de texto de prontuário via IA (Groq / Llama 3.3 70B).

A IA permanece DESLIGADA por padrão.
Requer AMBOS: IA_HABILITADA=true E audit.parametro('ia_externa_autorizada')='true'.
Após habilitação, o kill switch desliga qualquer chamada em até 1 requisição.

Nenhum texto de prontuário é registrado em log.
Nenhum dado chega ao navegador — tudo passa pelo backend.
"""
import os
import re
import json
import time
import hashlib
import logging
import unicodedata
from abc import ABC, abstractmethod
from typing import List, Optional

logger = logging.getLogger(__name__)

# ── Kill switch global ────────────────────────────────────────────────────────
# Persistência apenas até reinicialização do servidor (conforme especificação).
_IA_MORTA = False


def matar_ia() -> None:
    global _IA_MORTA
    _IA_MORTA = True
    logger.warning('KILL SWITCH ativado: IA externa desligada até reinicialização')


def ia_esta_viva() -> bool:
    return not _IA_MORTA


# ── Modelo de dados ───────────────────────────────────────────────────────────

class ItemExtraido:
    """Item de consumo extraído de texto de prontuário."""
    __slots__ = ('item', 'quantidade', 'unidade', 'data', 'hora', 'trecho')

    def __init__(self, item: str, quantidade: float,
                 unidade=None, data=None, hora=None, trecho: str = ''):
        self.item       = item
        self.quantidade = quantidade
        self.unidade    = unidade
        self.data       = data
        self.hora       = hora
        self.trecho     = trecho  # substring literal verificada


# ── Interface abstrata ────────────────────────────────────────────────────────

class LeitorDeTexto(ABC):
    @abstractmethod
    def extrair(self, texto: str, data_referencia: str, nr_ref: str) -> List[ItemExtraido]:
        """Extrai itens de consumo. nr_ref é apenas para log (hash/id, sem conteúdo)."""
        ...

    @abstractmethod
    def nome_modelo(self) -> str:
        ...


# ── Implementação local (regex + parser GASTOS:) ──────────────────────────────

class LeitorLocal(LeitorDeTexto):
    """
    Extração determinística por regex — sem IA externa.
    Detecta blocos 'GASTOS:' comuns em evoluções de enfermagem/fisioterapia.
    """
    _PAT_BLOCO  = re.compile(r'GASTOS\s*:\s*(.*?)(?=GASTOS\s*:|$)', re.I | re.S)
    _PAT_ITEM   = re.compile(
        r'(\d+(?:[.,]\d+)?)\s+([A-ZÁÀÂÃÉÊÍÓÔÕÚÇÜÑ][A-Za-záàâãéêíóôõúçüñ0-9 /\-]{2,50})',
    )

    def extrair(self, texto: str, data_referencia: str, nr_ref: str) -> List[ItemExtraido]:
        if not texto:
            return []
        itens = []
        for bloco in self._PAT_BLOCO.finditer(texto):
            conteudo = bloco.group(1)
            for m in self._PAT_ITEM.finditer(conteudo):
                qtd_str = m.group(1).replace(',', '.')
                try:
                    qtd = float(qtd_str)
                except ValueError:
                    continue
                nome   = m.group(2).strip()
                trecho = m.group(0).strip()
                # Garante que o trecho é substring literal do texto original
                if trecho not in texto:
                    continue
                itens.append(ItemExtraido(
                    item=nome, quantidade=qtd, trecho=trecho,
                ))
        return itens

    def nome_modelo(self) -> str:
        return 'leitor_local_regex'


# ── Implementação Groq ────────────────────────────────────────────────────────

class LeitorGroq(LeitorDeTexto):
    """
    Leitor de texto via Groq API (Llama 3.3 70B).
    Desativado por padrão; requer kill switch + flags de autorização.
    """
    _MODELO_PADRAO = 'llama-3.3-70b-versatile'

    _SISTEMA = (
        'Você é um auditor especialista em faturamento hospitalar brasileiro (TUSS/SUS/AMB).\n'
        'OBJETIVO: Extrair itens de consumo real (materiais, medicamentos, insumos) de notas '
        'clínicas para detectar divergências entre o que foi DOCUMENTADO nas evoluções e o '
        'que foi COBRADO/DISPENSADO pela farmácia. Sua extração alimenta regras de auditoria.\n\n'
        'FORMATO — responda SOMENTE com JSON válido, sem texto adicional:\n'
        '{"itens":[{"item":"nome exato","quantidade":numero,"unidade":"un|par|ml|mg|g|l|fr|amp|null",'
        '"data":"YYYY-MM-DD|null","hora":"HH:MM|null","trecho":"cópia literal do texto"}]}\n\n'
        'TIPOS DE EVOLUÇÃO — reconheça o contexto:\n'
        '• ENFERMAGEM (AEF, SAEF): frequentemente usa "GASTOS:" para listar materiais físicos. '
        'Procure também "MATERIAIS:", "UTILIZADO:", "PROCEDIMENTO REALIZADO:" e "CURATIVO:".\n'
        '• FISIOTERAPIA (FIM, SAFIM): lista insumos de reabilitação/imobilização '
        '(bandagem, atadura, colar cervical, talas). Extraia somente com quantidade explícita.\n'
        '• MÉDICA (E, SE): extraia SOMENTE se houver quantidade explícita de insumo físico '
        'usado ("inserido 1 dreno", "3 pontos de sutura"). Ignore diagnósticos e condutas.\n\n'
        'PADRÃO GASTOS: (mais comum nas evoluções de enfermagem)\n'
        '"GASTOS: 2 LUVAS PROCEDIMENTO, 1 ESPARADRAPO, 3 GAZES ESTÉRIL"\n'
        'Extraia CADA item listado após "GASTOS:" com sua quantidade. Se a linha tiver vírgulas '
        'separando itens, crie um objeto para cada um. O "trecho" de cada item deve ser a '
        'parte literal do texto que contém aquele item e sua quantidade.\n\n'
        'ABREVIAÇÕES — normalize o nome mas preserve o trecho literal:\n'
        '"SF" → "SORO FISIOLÓGICO", "SG" → "SORO GLICOSADO", "NPT" → "NUTRIÇÃO PARENTERAL TOTAL",\n'
        '"CURATIVO S/S" ou "CSS" → "CURATIVO SIMPLES SECO", "O2" → "OXIGÊNIO",\n'
        '"EV" e "VO" são VIAS de administração, não itens — ignore se não houver insumo físico.\n\n'
        'REGRAS OBRIGATÓRIAS:\n'
        '(1) Extraia APENAS itens com quantidade numérica EXPLÍCITA no texto. '
        '"uma"/"um"=1, "par"=1, "par de luvas"=1 par, "ampola"=1.\n'
        '(2) NÃO infira, NÃO estime, NÃO complete. Se a quantidade não estiver escrita, IGNORE o item.\n'
        '(3) "trecho" DEVE SER cópia LITERAL, caractere por caractere, do texto recebido — '
        'incluindo maiúsculas, pontuação e eventuais erros de digitação do original.\n'
        '(4) Ignore: planejamento ("solicito", "prescrevo", "necessita", "a ser"), diagnósticos CID, '
        'sinais vitais (PA, FC, FR, T°, SatO2, HGT), exames solicitados e dados pessoais.\n'
        '(5) Ignore medicamentos descritos apenas como "administrado conforme prescrição" sem '
        'especificar insumo físico adicional (gaze, equipo, scalp, cateter).\n'
        '(6) "data" e "hora" somente se mencionadas no texto JUNTO ao item. Não deduza.\n'
        '(7) Se não houver nenhum item com quantidade explícita, responda {"itens":[]}.\n'
        '(8) Um item duplicado no texto (mesma linha GASTOS:) deve gerar entradas separadas '
        'com trechos distintos — não some as quantidades.'
    )

    def __init__(self):
        self._modelo          = os.getenv('GROQ_MODEL', self._MODELO_PADRAO)
        self._timeout         = int(os.getenv('GROQ_TIMEOUT_S', '30'))
        self._max_retries     = int(os.getenv('GROQ_MAX_RETRIES', '3'))
        self._payload_max     = int(os.getenv('GROQ_PAYLOAD_MAX_CHARS', '3000'))
        self._qtd_max         = float(os.getenv('GROQ_QTD_MAX', '9999'))
        self._calls_por_job   = int(os.getenv('GROQ_MAX_CALLS_JOB', '20'))
        self._calls_este_job  = 0

    def nome_modelo(self) -> str:
        return self._modelo

    def resetar_contador(self) -> None:
        self._calls_este_job = 0

    def _autorizada(self) -> bool:
        if _IA_MORTA:
            return False
        if os.getenv('IA_HABILITADA', 'false').lower() not in ('true', '1'):
            return False
        return True

    def extrair(self, texto: str, data_referencia: str, nr_ref: str) -> List[ItemExtraido]:
        if not self._autorizada():
            return []
        if self._calls_este_job >= self._calls_por_job:
            logger.warning('Limite de chamadas por job atingido (ref=%s)', nr_ref)
            return []
        chave = os.getenv('GROQ_API_KEY', '')
        if not chave:
            return []

        trecho = texto[:self._payload_max] if len(texto) > self._payload_max else texto
        hash_ref = hashlib.md5(trecho.encode()).hexdigest()[:8]

        resposta_raw = self._chamar_api(chave, trecho)
        if resposta_raw is None:
            return []

        self._calls_este_job += 1
        itens = self._parsear(resposta_raw, trecho)
        # Log: apenas contagem e hash — nunca conteúdo
        logger.info('IA: %d itens extraídos (ref=%s, hash=%s)', len(itens), nr_ref, hash_ref)
        return itens

    _SISTEMA_EXPLICAR = (
        'Você é um auditor hospitalar especialista em faturamento. '
        'Receberá um achado de auditoria e deve retornar SOMENTE JSON válido:\n'
        '{"explicacao":"...","recomendacao":"..."}\n\n'
        '"explicacao": Escreva em até 3 frases claras e diretas, sem termos técnicos de '
        'banco de dados ou programação. Explique:\n'
        '  1. Em qual documento ou etapa do processo hospitalar foi encontrado o problema '
        '(ex.: "na evolução de enfermagem", "no lançamento de procedimento cirúrgico", '
        '"na dispensação de farmácia").\n'
        '  2. Qual é exatamente o problema — seja específico com os valores e diferenças.\n'
        '  3. Por que isso impacta o faturamento ou pode causar glosa.\n'
        'Quando um "Trecho de evidência" for fornecido, cite-o diretamente entre aspas na '
        'explicação para mostrar onde o item aparece no prontuário '
        '(ex.: conforme registrado na evolução: "2 LUVAS PROCEDIMENTO").\n\n'
        '"recomendacao": Em até 2 frases diretas, diga o que o auditor ou faturista deve '
        'fazer para corrigir ou verificar. Seja concreto e prático.\n\n'
        'Use linguagem hospitalar acessível: "evolução de enfermagem", "prescrição médica", '
        '"lançamento de procedimento", "nota de cirurgia", "dispensação de farmácia", '
        '"registro de anestesia", "diária de UTI", "honorário médico", etc.\n'
        'NUNCA use: "SQL", "tabela", "coluna", "campo", "id", "registro do banco", "backend".\n'
        'Se não houver informação suficiente para recomendar algo específico, '
        'escreva: "Verificar manualmente com a equipe de faturamento."'
    )

    def _chamar_api(self, chave: str, texto: str, sistema: str = None) -> Optional[str]:
        if sistema is None:
            sistema = self._SISTEMA
        try:
            from groq import Groq
        except ImportError:
            logger.error('Biblioteca groq não instalada (pip install groq)')
            return None

        client = Groq(api_key=chave)
        backoff = 1.0

        for tentativa in range(self._max_retries):
            try:
                resp = client.chat.completions.create(
                    model=self._modelo,
                    messages=[
                        {'role': 'system', 'content': sistema},
                        {'role': 'user',   'content': texto},
                    ],
                    temperature=0,
                    response_format={'type': 'json_object'},
                    timeout=self._timeout,
                )
                return resp.choices[0].message.content

            except Exception as e:
                code = getattr(e, 'status_code', None)
                if code in (401, 403):
                    logger.error('Groq: credencial inválida (status %s) — sem retry', code)
                    return None
                if code == 429 or (code and code >= 500):
                    if tentativa < self._max_retries - 1:
                        time.sleep(backoff)
                        backoff = min(backoff * 2, 30.0)
                        continue
                logger.error('Groq: erro após %d tentativa(s): %s', tentativa + 1, type(e).__name__)
                return None

        return None

    def explicar_achado(self, achado: dict, nr_ref: str, trecho: str = None):
        """
        Gera explicação e recomendação em linguagem clara para um achado.
        Retorna (explicacao: str, recomendacao: str) ou (None, None) se indisponível.
        Não registra conteúdo em log — apenas contagem e hash.
        trecho: trecho literal de evidência do prontuário (evidencia_trecho do achado).
        """
        if not self._autorizada():
            return None, None
        if self._calls_este_job >= self._calls_por_job:
            return None, None
        chave = os.getenv('GROQ_API_KEY', '')
        if not chave:
            return None, None

        _LABELS_GRAV = {
            'critica': 'Crítica', 'alta': 'Alta',
            'media': 'Média', 'baixa': 'Baixa',
        }
        _LABELS_TIPO = {
            'cobrado_sem_respaldo':   'Cobrado sem respaldo documental',
            'realizado_sem_cobranca': 'Realizado sem cobrança',
            'quantidade':             'Divergência de quantidade',
            'data':                   'Divergência de data',
            'assinatura':             'Assinatura ausente',
            'documento_ausente':      'Documento obrigatório ausente',
            'inconsistencia_tasy':    'Inconsistência no sistema',
        }

        msg = (
            'Achado de auditoria hospitalar:\n'
            'Regra: ' + str(achado.get('ds_regra') or achado.get('cd_regra', '')) + '\n'
            'Gravidade: ' + _LABELS_GRAV.get(str(achado.get('gravidade', '')), str(achado.get('gravidade', ''))) + '\n'
            'Tipo: ' + _LABELS_TIPO.get(str(achado.get('tipo_achado', '')), str(achado.get('tipo_achado', ''))) + '\n'
            'Encontrado: ' + str(achado.get('ds_encontrado') or '(sem descrição)') + '\n'
            'Esperado: ' + str(achado.get('ds_esperado') or '(sem descrição)') + '\n'
            'Risco financeiro: R$ ' + '{:.2f}'.format(float(achado.get('vl_risco') or 0))
        )

        if trecho:
            msg = msg + '\nTrecho de evidência encontrado no prontuário:\n"' + trecho[:500] + '"'

        raw = self._chamar_api(chave, msg, sistema=self._SISTEMA_EXPLICAR)
        if raw is None:
            return None, None

        self._calls_este_job += 1

        try:
            data = json.loads(raw)
            expl = str(data.get('explicacao') or '').strip()[:1200]
            rec  = str(data.get('recomendacao') or '').strip()[:600]
            if not expl:
                return None, None
            logger.info('IA: explicação gerada (ref=%s)', nr_ref)
            return expl, rec or None
        except (json.JSONDecodeError, ValueError):
            return None, None

    def _parsear(self, raw: str, texto_enviado: str) -> List[ItemExtraido]:
        try:
            data = json.loads(raw)
        except (json.JSONDecodeError, ValueError):
            return []

        itens_raw = data.get('itens', [])
        if not isinstance(itens_raw, list):
            return []

        validos = []
        for it in itens_raw:
            if not isinstance(it, dict):
                continue
            nome   = str(it.get('item', '')).strip()
            qtd    = it.get('quantidade')
            trecho = str(it.get('trecho', '')).strip()

            # Validações obrigatórias — achado sem evidência verificável é descartado
            if not nome:
                continue
            if not isinstance(qtd, (int, float)) or qtd < 0 or qtd > self._qtd_max:
                continue
            if not trecho or not self._e_substring_literal(trecho, texto_enviado):
                continue

            validos.append(ItemExtraido(
                item=nome,
                quantidade=float(qtd),
                unidade=it.get('unidade'),
                data=it.get('data'),
                hora=it.get('hora'),
                trecho=trecho,
            ))
        return validos

    @staticmethod
    def _normalizar(s: str) -> str:
        s = unicodedata.normalize('NFKC', s)
        return re.sub(r'\s+', ' ', s).strip().lower()

    def _e_substring_literal(self, trecho: str, texto: str) -> bool:
        return self._normalizar(trecho) in self._normalizar(texto)
