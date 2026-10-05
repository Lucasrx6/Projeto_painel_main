"""
backend/auditoria/validacao.py
Auto-verificação do ambiente de auditoria pré-faturamento.
Executável de 3 formas:
  1. CLI:      python -m backend.auditoria.validacao
  2. Endpoint: GET /api/auditoria/validacao
  3. Painel:   botão "Executar validação" no Painel 55

Nenhuma verificação é destrutiva. Verificações que gravem dados só rodam com
AUDITORIA_AMBIENTE=teste e são marcadas PULADO em produção.
"""
import os
import re
import json
import hashlib
import logging
from contextlib import contextmanager
from datetime import datetime
from typing import List, Dict, Any

import psycopg2
import psycopg2.extras

logger = logging.getLogger(__name__)

AMBIENTE = os.getenv('AUDITORIA_AMBIENTE', 'producao').lower()
VERSAO_MINIMA = '2.0'

# 13 colunas obrigatórias em cada view de regra
_COLUNAS_VIEW_REGRA = [
    'nr_atendimento', 'nr_interno_conta', 'cd_regra',
    'tipo_achado', 'gravidade', 'item_tipo', 'item_ref',
    'ds_encontrado', 'ds_esperado',
    'evidencia_tabela', 'evidencia_id', 'evidencia_trecho',
    'vl_risco',
]

_EXTENSOES_SCAN  = {'.py', '.js', '.html', '.sql'}
_DIRS_EXCLUIDOS  = {'.git', '__pycache__', 'node_modules', '.venv', 'venv',
                    'logs', 'dist', 'build', '.next',
                    'scripts'}  # scripts/ não é versionado (.gitignore) — contém utilitários locais


# ── Helpers de resultado ──────────────────────────────────────────────────────

def _r(id_, grupo, desc, status, detalhe=''):
    return {'id': id_, 'grupo': grupo, 'descricao': desc,
            'status': status, 'detalhe': detalhe}

def _ok(id_, g, d, det=''): return _r(id_, g, d, 'OK', det)
def _falha(id_, g, d, det): return _r(id_, g, d, 'FALHA', det)
def _aviso(id_, g, d, det): return _r(id_, g, d, 'AVISO', det)
def _pulado(id_, g, d, m):  return _r(id_, g, d, 'PULADO', m)


# ── Conexão ao banco de auditoria ─────────────────────────────────────────────

def _get_conn():
    url = os.getenv('AUDITORIA_DB_URL')
    if url:
        return psycopg2.connect(url, connect_timeout=10,
                                options='-c search_path=audit,core,ref,public')
    return psycopg2.connect(
        host=os.getenv('AUDIT_DB_HOST',     os.getenv('DB_HOST',     'localhost')),
        dbname=os.getenv('AUDIT_DB_NAME',   'auditoria'),
        user=os.getenv('AUDIT_DB_USER',     os.getenv('DB_USER',     'postgres')),
        password=os.getenv('AUDIT_DB_PASSWORD', os.getenv('DB_PASSWORD', 'postgres')),
        port=int(os.getenv('AUDIT_DB_PORT', os.getenv('DB_PORT',     5432))),
        connect_timeout=10,
        options='-c search_path=audit,core,ref,public',
    )


@contextmanager
def _cur(conn):
    with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as c:
        yield c


# ── A1. Banco e instalação ────────────────────────────────────────────────────

def _chk_banco(conn) -> List[Dict]:
    res = []

    # Versão da instalação
    try:
        with _cur(conn) as c:
            c.execute("SELECT valor FROM audit.parametro WHERE chave = 'versao_instalacao'")
            row = c.fetchone()
        versao = row['valor'] if row else None
        if versao and versao >= VERSAO_MINIMA:
            res.append(_ok('A1.01', 'banco', 'Versão da instalação', versao))
        elif versao:
            res.append(_aviso('A1.01', 'banco', 'Versão da instalação abaixo do mínimo',
                'Encontrado: ' + versao + '; esperado >= ' + VERSAO_MINIMA))
        else:
            res.append(_falha('A1.01', 'banco', 'Versão da instalação',
                'Parâmetro versao_instalacao não encontrado no banco'))
    except Exception as e:
        res.append(_falha('A1.01', 'banco', 'Versão da instalação', str(e)))

    # audit.verificar_instalacao()
    try:
        with _cur(conn) as c:
            c.execute("SELECT item, esperado, obtido, ok FROM audit.verificar_instalacao()")
            linhas = c.fetchall()
        falhas = [r for r in linhas if not r['ok']]
        if not falhas:
            res.append(_ok('A1.02', 'banco', 'audit.verificar_instalacao()',
                str(len(linhas)) + ' verificações passaram'))
        else:
            res.append(_falha('A1.02', 'banco', 'audit.verificar_instalacao()',
                str(len(falhas)) + ' falha(s): ' +
                '; '.join(str(r['item']) + '=' + str(r['obtido']) for r in falhas[:5])))
    except psycopg2.errors.UndefinedFunction:
        res.append(_aviso('A1.02', 'banco', 'audit.verificar_instalacao() não existe',
            'Função de verificação não encontrada — versão antiga do DDL?'))
    except Exception as e:
        res.append(_falha('A1.02', 'banco', 'audit.verificar_instalacao()', str(e)))

    # Views de regras (>= 29)
    try:
        with _cur(conn) as c:
            c.execute("""
                SELECT table_name FROM information_schema.views
                WHERE table_schema = 'audit' AND table_name ~ '^v_r[0-9]'
                ORDER BY table_name
            """)
            views = [r['table_name'] for r in c.fetchall()]
        if len(views) >= 29:
            res.append(_ok('A1.03', 'banco', 'Views de regras (mínimo 29)',
                str(len(views)) + ' encontradas'))
        else:
            res.append(_aviso('A1.03', 'banco', 'Views de regras abaixo do esperado',
                str(len(views)) + ' encontradas; esperado >= 29'))
    except Exception as e:
        res.append(_falha('A1.03', 'banco', 'Contagem de views de regras', str(e)))

    # Consistência catálogo × views
    try:
        with _cur(conn) as c:
            c.execute("SELECT cd_regra FROM audit.regra WHERE ativo = TRUE ORDER BY cd_regra")
            ativas = [r['cd_regra'] for r in c.fetchall()]
        with _cur(conn) as c:
            c.execute("""
                SELECT table_name FROM information_schema.views
                WHERE table_schema = 'audit' AND table_name ~ '^v_r[0-9]'
            """)
            views_set = {r['table_name'] for r in c.fetchall()}
        sem_view = [cd for cd in ativas
                    if not any(cd.lower().replace('r', '').lstrip('0')
                               in v for v in views_set)]
        if not sem_view:
            res.append(_ok('A1.04', 'banco', 'Catálogo de regras × views: consistente', ''))
        else:
            res.append(_falha('A1.04', 'banco', 'Regras ativas sem view correspondente',
                ', '.join(sem_view)))
    except Exception as e:
        res.append(_falha('A1.04', 'banco', 'Catálogo × views', str(e)))

    # 13 colunas padrão nas views
    try:
        with _cur(conn) as c:
            c.execute("""
                SELECT table_name, column_name
                FROM information_schema.columns
                WHERE table_schema = 'audit' AND table_name ~ '^v_r[0-9]'
                ORDER BY table_name, ordinal_position
            """)
            rows = c.fetchall()
        cols_por_view = {}
        for r in rows:
            cols_por_view.setdefault(r['table_name'], []).append(r['column_name'])
        problemas = [
            v + ': ' + ','.join(c for c in _COLUNAS_VIEW_REGRA if c not in cols)
            for v, cols in cols_por_view.items()
            if any(c not in cols for c in _COLUNAS_VIEW_REGRA)
        ]
        if not problemas:
            res.append(_ok('A1.05', 'banco', '13 colunas padrão em todas as views de regra',
                str(len(cols_por_view)) + ' views verificadas'))
        else:
            res.append(_falha('A1.05', 'banco', 'Coluna(s) padrão ausente(s)',
                '; '.join(problemas[:5])))
    except Exception as e:
        res.append(_falha('A1.05', 'banco', 'Colunas padrão das views', str(e)))

    # Índice de dedup
    try:
        with _cur(conn) as c:
            c.execute("""
                SELECT indexname FROM pg_indexes
                WHERE schemaname = 'audit' AND indexname = 'ux_achado_dedup'
            """)
            res.append(_ok('A1.06', 'banco', 'Índice ux_achado_dedup', 'Existe')
                       if c.fetchone() else
                       _falha('A1.06', 'banco', 'Índice ux_achado_dedup', 'Não encontrado'))
    except Exception as e:
        res.append(_falha('A1.06', 'banco', 'Índice ux_achado_dedup', str(e)))

    # Constraint ck_evidencia
    try:
        with _cur(conn) as c:
            c.execute("""
                SELECT conname FROM pg_constraint
                WHERE conname = 'ck_evidencia'
                  AND conrelid = 'audit.achado'::regclass
            """)
            res.append(_ok('A1.07', 'banco', 'Constraint ck_evidencia', 'Existe')
                       if c.fetchone() else
                       _falha('A1.07', 'banco', 'Constraint ck_evidencia',
                              'Não encontrada em audit.achado'))
    except Exception as e:
        res.append(_falha('A1.07', 'banco', 'Constraint ck_evidencia', str(e)))

    # Tabela analise_job (migração 11)
    try:
        with _cur(conn) as c:
            c.execute("""
                SELECT table_name FROM information_schema.tables
                WHERE table_schema = 'audit' AND table_name = 'analise_job'
            """)
            res.append(_ok('A1.08', 'banco', 'Tabela audit.analise_job', 'Existe')
                       if c.fetchone() else
                       _aviso('A1.08', 'banco', 'Tabela audit.analise_job ausente',
                              'Execute scripts/11_analise_job.sql'))
    except Exception as e:
        res.append(_falha('A1.08', 'banco', 'Tabela audit.analise_job', str(e)))

    return res


# ── A5. Privacidade ───────────────────────────────────────────────────────────

def _chk_privacidade() -> List[Dict]:
    segredo = os.getenv('AUDITORIA_HMAC_SECRET', '')
    if len(segredo) >= 16:
        return [_ok('A5.01', 'privacidade', 'AUDITORIA_HMAC_SECRET (≥16 chars)', 'Presente')]
    if segredo:
        return [_aviso('A5.01', 'privacidade', 'AUDITORIA_HMAC_SECRET curto (< 16 chars)',
            str(len(segredo)) + ' caracteres — aumente para >= 16')]
    return [_falha('A5.01', 'privacidade', 'AUDITORIA_HMAC_SECRET ausente',
        'Defina AUDITORIA_HMAC_SECRET no .env (mínimo 16 caracteres aleatórios)')]


# ── A6. Segredos, flags e higiene ─────────────────────────────────────────────

_PAT_SEGREDOS = [
    # Chaves Groq com formato reconhecível (gsk_ prefix)
    re.compile(r'gsk_[A-Za-z0-9]{20,}'),
    # Chaves Anthropic
    re.compile(r'sk-ant-api[0-9]{2}-[A-Za-z0-9_-]{20,}'),
    # Senhas e segredos hardcoded em aspas (não captura leituras de env var)
    re.compile(r'(?i)\b(?:password|passwd|senha)\s*=\s*["\'][^$\{][^\s"\']{4,}["\']'),
    re.compile(r'(?i)\bsecret\s*=\s*["\'][^$\{][^\s"\']{8,}["\']'),
    re.compile(r'(?i)\bapi[_-]?key\s*=\s*["\'][^$\{][^\s"\']{8,}["\']'),
]
_ARQUIVOS_EXCLUIDOS = {'.env', '.env.example', 'CLAUDE.md',
                       'validacao.py',                   # auto-exclusão: contém padrões proibidos como strings
                       '11_analise_job.sql',
                       'database_setup.sql',
                       'mockup_data.sql',
                       'tabelas.txt', 'queries.txt',
                       'testar_evolution_whatsapp.py',
                       'teste_email_padioleiro.py',
                       'teste.py', 'teste_sistema.py'}


def _chk_flags(conn) -> List[Dict]:
    res = []

    ia_env = os.getenv('IA_HABILITADA', 'false').lower()
    if ia_env in ('false', '0', ''):
        res.append(_ok('A6.01', 'flags', 'IA_HABILITADA=false (estado seguro)', ia_env or 'não definida'))
    else:
        res.append(_aviso('A6.01', 'flags', 'IA_HABILITADA está ativa',
            'Valor: ' + ia_env + ' — habilite somente após Parte A concluída'))

    try:
        with _cur(conn) as c:
            c.execute("SELECT valor FROM audit.parametro WHERE chave = 'ia_externa_autorizada'")
            row = c.fetchone()
        val = row['valor'] if row else None
        if val in ('false', 'f', '0'):
            res.append(_ok('A6.02', 'flags', 'audit.parametro ia_externa_autorizada=false', val))
        elif val is None:
            res.append(_aviso('A6.02', 'flags', 'Parâmetro ia_externa_autorizada não encontrado',
                'Execute scripts/11_analise_job.sql'))
        else:
            res.append(_aviso('A6.02', 'flags', 'ia_externa_autorizada ESTÁ ATIVA',
                'Valor: ' + val + ' — desative antes de concluir a validação'))
    except Exception as e:
        res.append(_falha('A6.02', 'flags', 'audit.parametro ia_externa_autorizada', str(e)))

    return res


def _lint_sql(raiz) -> List[Dict]:
    # Escopo do módulo de auditoria — violações aqui são FALHA.
    _DIRS_AUDITORIA = [
        os.path.join(raiz, 'backend', 'auditoria'),
        os.path.join(raiz, 'paineis', 'painel55'),
        os.path.join(raiz, 'backend', 'routes', 'painel55_routes.py'),
    ]
    _PROIBIDOS = [
        (re.compile(r'\bSELECT\s+\*', re.I), 'SELECT *'),
        (re.compile(r'\bCOUNT\s*\(\s*\*\s*\)', re.I), 'COUNT(*)'),
        (re.compile(r'\bRETURNING\s+\*', re.I), 'RETURNING *'),
        (re.compile(r'(?<!\w)\w+\.\*(?!\w)', re.I), 'tabela.*'),
    ]

    # Caminhos absolutos do escopo de auditoria (para excluir do scan legado)
    _caminhos_auditoria = set()
    for alvo in _DIRS_AUDITORIA:
        if os.path.isfile(alvo):
            _caminhos_auditoria.add(os.path.normcase(os.path.abspath(alvo)))
        elif os.path.isdir(alvo):
            for dp2, _, fns2 in os.walk(alvo):
                for fn2 in fns2:
                    _caminhos_auditoria.add(os.path.normcase(os.path.abspath(os.path.join(dp2, fn2))))

    ocorrencias_audit  = []
    ocorrencias_legado = []

    def _scan_file(fp, lista):
        try:
            with open(fp, encoding='utf-8', errors='ignore') as fh:
                for n, ln in enumerate(fh, 1):
                    for pat, nome in _PROIBIDOS:
                        if pat.search(ln):
                            rel = os.path.relpath(fp, raiz)
                            lista.append(rel + ':' + str(n) + ' [' + nome + ']')
        except OSError:
            pass

    # Scan do escopo de auditoria
    for alvo in _DIRS_AUDITORIA:
        if os.path.isfile(alvo):
            fn = os.path.basename(alvo)
            if fn not in _ARQUIVOS_EXCLUIDOS and os.path.splitext(fn)[1].lower() in _EXTENSOES_SCAN:
                _scan_file(alvo, ocorrencias_audit)
        elif os.path.isdir(alvo):
            for dp, dns, fns in os.walk(alvo):
                dns[:] = [d for d in dns if d not in _DIRS_EXCLUIDOS]
                for fn in fns:
                    if fn in _ARQUIVOS_EXCLUIDOS:
                        continue
                    if os.path.splitext(fn)[1].lower() not in _EXTENSOES_SCAN:
                        continue
                    _scan_file(os.path.join(dp, fn), ocorrencias_audit)

    # Scan legado (fora do escopo) — somente conta, não bloqueia
    for dp, dns, fns in os.walk(raiz):
        dns[:] = [d for d in dns if d not in _DIRS_EXCLUIDOS]
        for fn in fns:
            if fn in _ARQUIVOS_EXCLUIDOS:
                continue
            if os.path.splitext(fn)[1].lower() not in _EXTENSOES_SCAN:
                continue
            fp = os.path.join(dp, fn)
            if os.path.normcase(os.path.abspath(fp)) in _caminhos_auditoria:
                continue
            _scan_file(fp, ocorrencias_legado)

    resultados = []
    if ocorrencias_audit:
        resumo = str(len(ocorrencias_audit)) + ' ocorrência(s): ' + '; '.join(ocorrencias_audit[:5])
        resultados.append(_falha('A6.03', 'sql_lint', 'Lint SQL: padrão proibido no módulo auditoria', resumo))
    else:
        det = 'Módulo de auditoria limpo'
        if ocorrencias_legado:
            det += ' (' + str(len(ocorrencias_legado)) + ' ocorrência(s) no código legado, não alteradas)'
        resultados.append(_ok('A6.03', 'sql_lint', 'Lint SQL: módulo auditoria sem padrões proibidos', det))

    if ocorrencias_legado:
        resultados.append(_aviso('A6.03L', 'sql_lint',
            'Lint SQL legado — informativo (não altera código legado)',
            str(len(ocorrencias_legado)) + ' ocorrência(s) fora do escopo do projeto de auditoria'))

    return resultados


def _varrer_segredos(raiz) -> List[Dict]:
    ocorrencias = []
    for dp, dns, fns in os.walk(raiz):
        dns[:] = [d for d in dns if d not in _DIRS_EXCLUIDOS]
        for fn in fns:
            if fn in _ARQUIVOS_EXCLUIDOS or fn.startswith('.env'):
                continue
            if os.path.splitext(fn)[1].lower() not in _EXTENSOES_SCAN:
                continue
            fp = os.path.join(dp, fn)
            try:
                with open(fp, encoding='utf-8', errors='ignore') as fh:
                    for n, ln in enumerate(fh, 1):
                        for pat in _PAT_SEGREDOS:
                            if pat.search(ln):
                                rel = os.path.relpath(fp, raiz)
                                ocorrencias.append(rel + ':' + str(n))
                                break  # uma ocorrência por linha
            except OSError:
                pass

    if not ocorrencias:
        return [_ok('A6.04', 'segredos', 'Varredura de segredos no repositório', 'Nada encontrado')]
    # NUNCA exibe o valor — só localização
    return [_falha('A6.04', 'segredos', 'Possível segredo em arquivo versionado',
        str(len(ocorrencias)) + ' ocorrência(s): ' + '; '.join(ocorrencias[:5]))]


def _chk_dotenv(raiz) -> List[Dict]:
    res = []
    gi = os.path.join(raiz, '.gitignore')
    ef = os.path.join(raiz, '.env')
    ex = os.path.join(raiz, '.env.example')

    if os.path.exists(ef):
        res.append(_ok('A6.05', 'segredos', '.env existe', ''))
    else:
        res.append(_aviso('A6.05', 'segredos', '.env ausente', 'Crie a partir do .env.example'))

    if os.path.exists(gi):
        with open(gi, encoding='utf-8', errors='ignore') as f:
            conteudo = f.read()
        if '.env' in conteudo:
            res.append(_ok('A6.06', 'segredos', '.env listado no .gitignore', ''))
        else:
            res.append(_falha('A6.06', 'segredos', '.env NÃO está no .gitignore',
                'Adicione ".env" ao .gitignore imediatamente'))
    else:
        res.append(_aviso('A6.06', 'segredos', '.gitignore não encontrado', ''))

    res.append(_ok('A6.07', 'segredos', '.env.example existe', '')
               if os.path.exists(ex) else
               _aviso('A6.07', 'segredos', '.env.example ausente',
                      'Crie .env.example sem valores reais'))
    return res


# ── A7. Conectividade da IA (sem chamar a Groq) ───────────────────────────────

def _chk_ia() -> List[Dict]:
    res = []

    groq_key = os.getenv('GROQ_API_KEY', '')
    res.append(_ok('A7.01', 'ia', 'GROQ_API_KEY presente', '(valor oculto)')
               if groq_key else
               _aviso('A7.01', 'ia', 'GROQ_API_KEY ausente',
                      'A IA não funcionará sem a chave — configure quando pronto'))

    modelo = os.getenv('GROQ_MODEL', '')
    res.append(_ok('A7.02', 'ia', 'GROQ_MODEL configurado', modelo)
               if modelo else
               _aviso('A7.02', 'ia', 'GROQ_MODEL não configurado',
                      'Padrão será: llama-3.3-70b-versatile'))

    return res


# ── A3. Testes do mock (somente em ambiente de teste) ─────────────────────────

def _chk_testes_mock() -> List[Dict]:
    """Executa mock.executar_testes() — só chamado quando AUDITORIA_AMBIENTE=teste."""
    conn = None
    try:
        conn = _get_conn()
        with _cur(conn) as c:
            c.execute("SELECT teste, resultado, detalhe FROM mock.executar_testes()")
            rows = [dict(r) for r in c.fetchall()]
        resumo = next((r for r in rows if r['teste'] == 'RESUMO'), None)
        fails  = [r for r in rows if r['resultado'] == 'FAIL' and r['teste'] != 'RESUMO']
        if not resumo:
            return [_falha('A3.01', 'testes', 'Testes de regras (08/09)',
                           'mock.executar_testes() não retornou RESUMO — rode 08/09 no banco de teste')]
        n = len(rows)
        if resumo['resultado'] == 'PASS':
            return [_ok('A3.01', 'testes', 'Testes de regras — PASS (' + str(n) + ' verificações)',
                        resumo.get('detalhe', '') or 'nenhuma falha')]
        detalhe = '; '.join(r['teste'] + ': ' + (r.get('detalhe') or '') for r in fails[:3])
        return [_falha('A3.01', 'testes', 'Testes de regras — FAIL', detalhe)]
    except Exception as e:
        return [_falha('A3.01', 'testes', 'Erro ao executar mock.executar_testes()',
                       str(e)[:200])]
    finally:
        if conn:
            try:
                conn.close()
            except Exception:
                pass


# ── Executor principal ────────────────────────────────────────────────────────

def executar(raiz: str = None) -> Dict:
    """Roda todas as verificações e retorna relatório estruturado."""
    if raiz is None:
        # Sobe 3 níveis: backend/auditoria/validacao.py → raiz do projeto
        raiz = os.path.dirname(os.path.dirname(
               os.path.dirname(os.path.abspath(__file__))))

    resultados: List[Dict] = []
    conn = None

    try:
        conn = _get_conn()
        resultados += _chk_banco(conn)
        resultados += _chk_flags(conn)
    except Exception as e:
        resultados.append(_falha('A1.00', 'banco', 'Conexão ao banco auditoria', str(e)))
    finally:
        if conn:
            try:
                conn.close()
            except Exception:
                pass

    resultados += _chk_privacidade()
    resultados += _lint_sql(raiz)
    resultados += _varrer_segredos(raiz)
    resultados += _chk_dotenv(raiz)
    resultados += _chk_ia()

    # A3 — testes de regras (somente em ambiente de teste)
    if AMBIENTE == 'teste':
        resultados += _chk_testes_mock()
    else:
        resultados.append(_pulado('A3.01', 'testes',
            'Testes de regras (08/09)',
            'Só executados com AUDITORIA_AMBIENTE=teste — nunca em produção'))

    falhas  = [r for r in resultados if r['status'] == 'FALHA']
    avisos  = [r for r in resultados if r['status'] == 'AVISO']
    pulados = [r for r in resultados if r['status'] == 'PULADO']
    oks     = [r for r in resultados if r['status'] == 'OK']

    return {
        'dt_validacao': datetime.now().isoformat(),
        'ambiente':     AMBIENTE,
        'veredito':     'PRONTO_PARA_IA' if not falhas else 'INCOMPLETO',
        'resumo': {
            'ok':     len(oks),
            'falha':  len(falhas),
            'aviso':  len(avisos),
            'pulado': len(pulados),
        },
        'resultados': resultados,
    }


if __name__ == '__main__':
    import sys
    rel = executar()
    print(json.dumps(rel, indent=2, ensure_ascii=False))
    sys.exit(0 if rel['veredito'] == 'PRONTO_PARA_IA' else 1)
