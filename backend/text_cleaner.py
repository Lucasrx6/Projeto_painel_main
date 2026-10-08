"""
Limpeza de texto RTF/HTML para uso no pipeline de auditoria.
Adaptado de scripts/06_limpeza_texto.py com importação direta.
"""
import html as _html_mod
import re

_RTF_HEX   = re.compile(r"\\'([0-9a-fA-F]{2})")
_RTF_PAR   = re.compile(r'\\par[d]?\b', re.I)
_RTF_LINE  = re.compile(r'\\line\b',    re.I)
_RTF_TAB   = re.compile(r'\\tab\b',     re.I)
_RTF_PAGE  = re.compile(r'\\page\b',    re.I)
_RTF_SECT  = re.compile(r'\\sect\b',    re.I)
_RTF_GRUPOS = re.compile(
    r'\{\\(?:fonttbl|colortbl|stylesheet|info|pict|object|nonshppict|fldinst)[^}]*\}',
    re.I | re.DOTALL,
)
_RTF_CTRL  = re.compile(r'\\[a-z]+-?\d*[ ]?', re.I)
_RTF_CSYM  = re.compile(r'\\[^a-z\n\r]', re.I)
_RTF_BRACE = re.compile(r'[{}]')
_HTML_BR   = re.compile(r'<br\s*/?>', re.I)
_HTML_P    = re.compile(r'</?p[^>]*>', re.I)
_HTML_DIV  = re.compile(r'</?div[^>]*>', re.I)
_HTML_TAG  = re.compile(r'<[^>]+>')
_PAT_RTF   = re.compile(r'^\s*\{\\rtf', re.I)
_PAT_HTML  = re.compile(r'<(html|body|p|div|br|span|table)\b', re.I)


def _rtf_para_texto(rtf: str) -> str:
    def _sub_hex(m):
        try:
            return bytes.fromhex(m.group(1)).decode('cp1252', errors='replace')
        except Exception:
            return ''
    s = _RTF_HEX.sub(_sub_hex, rtf)
    s = _RTF_GRUPOS.sub('', s)
    s = _RTF_PAR.sub('\n',  s)
    s = _RTF_LINE.sub('\n', s)
    s = _RTF_TAB.sub('\t',  s)
    s = _RTF_PAGE.sub('\n', s)
    s = _RTF_SECT.sub('\n', s)
    s = _RTF_CTRL.sub('',   s)
    s = _RTF_CSYM.sub('',   s)
    s = _RTF_BRACE.sub('',  s)
    return s


def limpar_texto_rtf(texto: str) -> str:
    """RTF ou HTML → texto puro normalizado. Retorna '' se vazio."""
    if not texto:
        return ''
    s = texto
    if _PAT_RTF.match(s):
        s = _rtf_para_texto(s)
    elif _PAT_HTML.search(s):
        s = _HTML_BR.sub('\n',  s)
        s = _HTML_P.sub('\n',   s)
        s = _HTML_DIV.sub('\n', s)
        s = _HTML_TAG.sub('',   s)
        s = _html_mod.unescape(s)
    s = re.sub(r'\r\n|\r', '\n', s)
    s = re.sub(r'\n{4,}', '\n\n\n', s)
    s = re.sub(r'[^\S\n]{2,}', ' ', s)
    return s.strip()
