# Plano de Refatoração — Sistema de Painéis Hospitalares (HAC)
> Elaborado por análise completa da codebase em 2026-05-20  
> Documento para aplicação por IAs — cada fase inclui contexto, escopo e prompt completo.

---

## Diagnóstico Geral

O sistema é **funcional e bem estruturado em nível macro**: pool de conexões sólido, cache Redis com fallback gracioso, headers de segurança, RBAC, auditoria — tudo funciona. O problema é **dívida técnica de escala**: 39 painéis foram construídos manualmente, copiando o mesmo padrão em cada arquivo sem abstração, gerando ~2.000 linhas de código idêntico espalhadas.

### Problemas Confirmados por Análise de Código

| Severidade | Problema | Onde | Linhas estimadas |
|-----------|---------|------|-----------------|
| CRÍTICO | `panel_permission_required` existe mas **nunca é usado** nas rotas | `decorators.py` vs todos os `painel*_routes.py` | ~585 linhas |
| CRÍTICO | `get_db_connection()` + `release_connection()` manual sem context manager | todos os `painel*_routes.py` | ~780 linhas |
| ALTO | `verificar_permissao_painel()` chamado manualmente em cada rota (2x por rota: página + API) | 39 arquivos | ~600 linhas |
| ALTO | Blocos `try/except/finally release_connection` repetidos 39× | 39 arquivos | ~780 linhas |
| ALTO | `requirements.txt` não existe | raiz | — |
| ALTO | `painel33_bp` importado na linha 58 do `app.py` mas comentado na lista de blueprints | `app.py:158` | inconsistência |
| ALTO | 7 notificadores cada um com sua própria configuração de logging e DB | `notificador*.py` | ~350 linhas |
| MÉDIO | `RateLimiter` em memória: não compartilhado entre workers Gunicorn | `auth.py:69-146` | design flaw |
| MÉDIO | 7 threads daemon sem graceful shutdown em `app.py` | `app.py:187-241` | risco |
| MÉDIO | Alguns blueprints com `url_prefix`, outros sem (inconsistência) | `painel2_bp` vs `painel4_bp` | inconsistência |
| BAIXO | `import smtplib` local dentro de função em `auth.py` | `auth.py:1118` | estilo |
| BAIXO | HTML de email hardcoded como string em `auth.py` | `auth.py:1137-1167` | manutenibilidade |
| BAIXO | Banner de inicialização com lista de painéis hardcoded | `app.py:307-320` | desatualizado |

### O que NÃO mudar

- Arquitetura Flask + PostgreSQL + Redis — sólida
- Sistema de cache (`cache.py`) — excelente implementação
- `database.py` e o `_PoolConnectionWrapper` — inovador e correto
- Headers de segurança (`security.py`) — completo
- Sistema de logs rotativos — adequado
- Padrão IIFE ES5 no frontend dos painéis — obrigatório (TVs legadas)
- Estrutura de diretórios `paineis/painel{N}/` — adequada

---

## Fases de Refatoração

```
Fase 0 → Higiene e pré-requisitos        ✅ CONCLUÍDA (2026-05-20)
Fase 1 → Abstração de permissões         ✅ CONCLUÍDA (2026-05-20)
Fase 2 → Abstração de conexão DB         ✅ CONCLUÍDA (2026-05-21) — 216 with get_db_cursor() em 39 arquivos
Fase 3 → Padronização de blueprints      ✅ CONCLUÍDA (2026-05-21) — url_prefix removido de painel2/3/28
Fase 4 → Centralização de notificadores  ✅ CONCLUÍDA (2026-05-21) — notificador_utils.py criado, 7 arquivos atualizados
Fase 5 → RateLimiter com Redis           ✅ CONCLUÍDA (2026-05-21) — RateLimiter reescrito com Redis + fallback gracioso em auth.py
Fase 6 → Graceful shutdown               ✅ CONCLUÍDA (2026-05-21) — _stop_event + atexit em app.py e 7 notificadores
Fase 7 → Template de email               ✅ CONCLUÍDA (2026-05-21) — HTML extraído para backend/templates_email/reset_senha.html (Jinja2)
```

**Sequência recomendada**: 0 → 1 → 2 → 3 → 4 → 5 → 6 → 7  
Cada fase é **independente** e pode ser aplicada sem as anteriores (exceto Fase 2 que depende da Fase 1).

---

---

# FASE 0 — Higiene e Pré-requisitos

## Objetivo
Eliminar inconsistências visíveis e estabelecer base limpa antes das refatorações maiores.

## Problemas a resolver
1. `requirements.txt` não existe — impossível reproduzir o ambiente
2. `painel33_bp` importado (linha 58 `app.py`) mas comentado na lista (linha 158) — import órfão que pode falhar silenciosamente
3. Banner de inicialização hardcoded com lista incompleta de painéis (lines 307-320 `app.py`)
4. `import logging as _logging` dentro do corpo do `app.py` (linha 130) — deveria estar no topo

## Arquivos afetados
- `app.py` — remover import do painel33 ou descomentar da lista; mover import; limpar banner
- `requirements.txt` — criar com dependências reais do `.venv`
- `backend/routes/painel33_routes.py` — verificar se está funcional ou pode ser removido

## Resultado esperado
- `requirements.txt` na raiz com todas as dependências e versões pinadas
- `app.py` sem imports órfãos, banner dinâmico, imports no topo

---

## PROMPT FASE 0

```
Você é um engenheiro de software refatorando o sistema de painéis hospitalares HAC.
Sua tarefa é a FASE 0: Higiene e Pré-requisitos.

CONTEXTO DO PROJETO:
- Flask 3.0, Python 3.8+, PostgreSQL, Redis
- 39 blueprints de painéis registrados em app.py
- Sistema em produção em C:\Projeto_Painel_Main\
- Diretório de desenvolvimento: c:\Users\Arklok\OneDrive\Documentos\projeto_painel_main\Projeto_painel_main\

TAREFAS DESTA FASE:

1. CRIAR requirements.txt
   - Ative o .venv do projeto (pasta .venv na raiz)
   - Execute `pip freeze` para capturar dependências atuais
   - Salve o output como requirements.txt na raiz do projeto
   - Verifique se inclui no mínimo: flask, flask-cors, psycopg2-binary, redis, bcrypt, apprise, gunicorn, python-dotenv, schedule, requests, groq (ou openai)

2. CORRIGIR app.py — remover import órfão do painel33
   - Arquivo: app.py, linha 58: `from backend.routes.painel33_routes import painel33_bp`
   - O blueprint está comentado na lista de blueprints (linha 158: `#painel33_bp,`)
   - Verifique se backend/routes/painel33_routes.py existe e se o painel está em uso
   - SE o painel33 está inativo/quebrado: remova a linha 58 do import E verifique se painel33_routes.py pode ser deletado
   - SE o painel33 está funcional: descomente-o na lista de blueprints (linha 158)
   - Nunca deixe um import sem uso

3. MOVER import de logging em app.py
   - Linha 130: `import logging as _logging` está no meio do corpo da função
   - Mova para o bloco de imports padrão no topo do arquivo (depois dos outros imports)
   - Mantenha a linha `_logging.getLogger('werkzeug').setLevel(_logging.WARNING)` no local original (apenas o import sobe)

4. TORNAR o banner de inicialização dinâmico
   - Linhas 307-320 do app.py têm lista hardcoded de painéis
   - Substitua por: iterar sobre `paineis` (a lista já existe) e imprimir cada blueprint
   - Use `bp.name` de cada blueprint para o nome do painel
   - Mantenha as URLs de acesso (local, rede, etc.)

RESTRIÇÕES:
- Não altere nenhuma lógica de rota
- Não altere configurações de autenticação
- Não altere nada em backend/ exceto o import em app.py
- Faça apenas o que está descrito, sem refatorações extras

VERIFICAÇÃO FINAL:
- app.py não deve ter imports não usados
- requirements.txt deve existir na raiz
- `python app.py` deve iniciar sem erros de import
```

---

---

# FASE 1 — Abstração do Padrão de Permissão nas Rotas

## Objetivo
Eliminar ~585 linhas de código de verificação de permissão duplicadas em todas as rotas de painéis, usando o decorator `panel_permission_required` que JÁ EXISTE mas não é usado.

## Problema raiz
O decorator `panel_permission_required` está implementado em `backend/middleware/decorators.py` mas **zero rotas de painéis o utilizam**. Em vez disso, cada rota repete manualmente:

```python
# Este bloco existe ~2x em CADA um dos 39 arquivos de rotas:
usuario_id = session.get('usuario_id')
is_admin = session.get('is_admin', False)
if not is_admin:
    if not verificar_permissao_painel(usuario_id, 'painelX'):
        return jsonify({'success': False, 'error': 'Sem permissão'}), 403
```

## Solução
Substituir o bloco manual pelo decorator já disponível:

```python
# ANTES (em cada rota):
@painel2_bp.route('/api/paineis/painel2/evolucoes')
@login_required
@cache_route(ttl=60, key_prefix='painel2:evolucoes')
def get_evolucoes():
    usuario_id = session.get('usuario_id')
    is_admin = session.get('is_admin', False)
    if not is_admin:
        if not verificar_permissao_painel(usuario_id, 'painel2'):
            return jsonify({'success': False, 'error': 'Sem permissão'}), 403
    # ... resto da função

# DEPOIS:
@painel2_bp.route('/api/paineis/painel2/evolucoes')
@login_required
@panel_permission_required('painel2')
@cache_route(ttl=60, key_prefix='painel2:evolucoes')
def get_evolucoes():
    # ... resto da função, sem boilerplate de permissão
```

**Nota sobre rotas HTML**: As rotas que servem `index.html` também repetem o mesmo padrão mas retornam `send_from_directory('frontend', 'acesso-negado.html')`. O decorator deve ser adaptado para suportar esse caso:

```python
# decorators.py — adicionar suporte a retorno HTML em panel_permission_required:
if _e_requisicao_de_pagina():
    return send_from_directory('frontend', 'acesso-negado.html')
return jsonify({'success': False, 'error': f'Sem permissão para {panel_name}'}), 403
```

## Arquivos afetados
- `backend/middleware/decorators.py` — modificar `panel_permission_required` para suportar retorno HTML
- `backend/routes/painel2_routes.py` até `painel40_routes.py` — substituir blocos manuais pelo decorator
- Qualquer rota em `auth_routes.py`, `admin_routes.py`, `main_routes.py` que faça verificação similar

## Redução estimada
- ~585 linhas removidas dos arquivos de rotas
- 0 funcionalidade alterada (o decorator faz exatamente o mesmo)

---

## PROMPT FASE 1

```
Você é um engenheiro de software refatorando o sistema de painéis hospitalares HAC.
Sua tarefa é a FASE 1: Abstração do Padrão de Permissão nas Rotas.

CONTEXTO DO PROJETO:
- Flask 3.0, Python 3.8+, PostgreSQL, Redis
- 39 arquivos em backend/routes/painel{2..40}_routes.py
- Todos os painéis usam o mesmo boilerplate de verificação de permissão
- O decorator `panel_permission_required` já existe em backend/middleware/decorators.py mas NUNCA é usado

PROBLEMA CONFIRMADO:
Em backend/routes/painel2_routes.py (e em todos os outros ~38 arquivos), existe este bloco
repetido dentro de CADA função de rota:

    usuario_id = session.get('usuario_id')
    is_admin = session.get('is_admin', False)
    if not is_admin:
        if not verificar_permissao_painel(usuario_id, 'painelX'):
            return jsonify({'success': False, 'error': 'Sem permissão'}), 403

E nas rotas HTML, a variação:
    if not is_admin:
        if not verificar_permissao_painel(usuario_id, 'painelX'):
            return send_from_directory('frontend', 'acesso-negado.html')

O decorator panel_permission_required(panel_name) em backend/middleware/decorators.py
faz exatamente isso mas não é utilizado em nenhuma rota de painel.

TAREFA 1 — Modificar backend/middleware/decorators.py

Adicione suporte a retorno HTML no decorator panel_permission_required.
O bloco de permissão negada deve ser:

    if not verificar_permissao_painel(usuario_id, panel_name):
        current_app.logger.warning(
            f'Acesso negado ao {panel_name}: {session.get("usuario")}'
        )
        if _e_requisicao_de_pagina():
            from flask import send_from_directory
            return send_from_directory('frontend', 'acesso-negado.html')
        return jsonify({
            'success': False,
            'error': f'Sem permissão para acessar {panel_name}'
        }), 403

Mantenha todo o resto do arquivo igual.

TAREFA 2 — Atualizar todos os 39 arquivos de rotas de painéis

Para cada arquivo backend/routes/painel{N}_routes.py (N de 2 a 40, pulando o 33 se comentado):

a) Adicionar import do decorator no topo:
   from backend.middleware.decorators import login_required, panel_permission_required

b) Remover o import de verificar_permissao_painel se não for mais usado:
   from backend.user_management import verificar_permissao_painel  ← REMOVER

c) Para cada rota de API (que retorna jsonify):
   - Adicionar @panel_permission_required('painelN') entre @login_required e @cache_route
   - Remover o bloco manual de 4-6 linhas de verificação de permissão dentro da função

d) Para cada rota HTML (que retorna send_from_directory com index.html):
   - Adicionar @panel_permission_required('painelN') logo após @login_required
   - Remover o bloco manual de 4-5 linhas de verificação de permissão dentro da função

ORDEM DOS DECORATORS (obrigatória):
    @painel{N}_bp.route('/...')
    @login_required
    @panel_permission_required('painel{N}')
    @cache_route(ttl=..., key_prefix='...')   ← apenas nas rotas que já tinham
    def nome_da_funcao():

VERIFICAÇÃO POR ARQUIVO:
- A função não deve mais conter `session.get('usuario_id')` para verificação de permissão
- A função não deve mais conter `session.get('is_admin', False)`
- A função não deve mais conter `verificar_permissao_painel(`
- O import de `verificar_permissao_painel` deve ser removido se não houver outro uso

RESTRIÇÕES ABSOLUTAS:
- Não altere a lógica SQL de nenhuma query
- Não altere a ordem dos campos retornados
- Não altere os nomes de rotas (URLs)
- Não altere o comportamento do cache
- Não adicione nenhuma funcionalidade nova
- O código dentro das funções (após a verificação de permissão) deve permanecer idêntico

NOTA: Se algum arquivo de painel não tiver o bloco de verificação de permissão
(possível em alguns painéis especiais como painel26 ou painel27), apenas adicione
o decorator sem remover nada.

VERIFICAÇÃO FINAL:
- Grep por 'verificar_permissao_painel' em backend/routes/ deve retornar zero resultados
- Grep por 'is_admin = session.get' em backend/routes/ deve retornar zero resultados
- `python app.py` deve iniciar sem erros
- Uma requisição não autenticada a /api/paineis/painel2/evolucoes deve retornar 401
- Uma requisição sem permissão deve retornar 403
```

---

---

# FASE 2 — Abstração do Padrão de Conexão ao Banco

## Objetivo
Eliminar ~780 linhas de boilerplate de conexão/liberação do banco que se repetem em todas as rotas, usando o context manager correto que JÁ EXISTE no `database.py`.

## Problema raiz
O `database.py` possui `get_db_connection()` que retorna um wrapper que suporta context manager (`with conn:`). No entanto, **todas as rotas usam o padrão antigo e inseguro**:

```python
# Padrão ATUAL em todas as rotas (perigoso: connection leak se cursor.close() falhar):
conn = get_db_connection()
if not conn:
    return jsonify({'success': False, 'error': 'Erro de conexão'}), 500
try:
    cursor = conn.cursor()
    cursor.execute(query)
    dados = cursor.fetchall()
    cursor.close()
    release_connection(conn)
    return jsonify({'success': True, 'data': dados})
except Exception as e:
    current_app.logger.error(f'Erro: {e}', exc_info=True)
    if conn:
        release_connection(conn)
    return jsonify({'success': False, 'error': 'Erro ao buscar dados'}), 500
```

```python
# Padrão CORRETO (seguro, sem leak, já suportado pelo database.py):
with get_db_connection() as conn:
    with conn.cursor(cursor_factory=RealDictCursor) as cur:
        cur.execute(query, params)
        dados = cur.fetchall()
return jsonify({'success': True, 'data': dados})
```

## Vantagens do context manager
1. **Sem connection leak**: a conexão é devolvida ao pool mesmo se houver exceção
2. **Sem `release_connection()` manual**: eliminado
3. **Menos linhas**: ~20 linhas por rota → ~6 linhas
4. **RealDictCursor padrão**: retorna dicts sem `dict(zip(colunas, row))`

## Importante: tratamento de erro
Com context manager, o erro de conexão (`conn = None`) não ocorre mais — o `get_db_connection()` lança exceção se não conseguir conectar. O error handler global já captura isso e retorna 500. Mas para consistência, envolva o bloco `with` em try/except:

```python
try:
    with get_db_connection() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(query, params)
            dados = cur.fetchall()
    return jsonify({'success': True, 'data': dados})
except Exception as e:
    current_app.logger.error(f'Erro ao buscar dados do painel{N}: {e}', exc_info=True)
    return jsonify({'success': False, 'error': 'Erro interno'}), 500
```

## Arquivos afetados
- `backend/routes/painel{2..40}_routes.py` — todos os 39 arquivos
- Remover import `release_connection` de cada arquivo (se não usado em mais lugar)

---

## PROMPT FASE 2

```
Você é um engenheiro de software refatorando o sistema de painéis hospitalares HAC.
Sua tarefa é a FASE 2: Abstração do Padrão de Conexão ao Banco.

PRÉ-REQUISITO: A Fase 1 deve ter sido aplicada antes desta fase.

CONTEXTO DO PROJETO:
- Flask 3.0, Python 3.8+, PostgreSQL com psycopg2
- database.py tem get_db_connection() que retorna um objeto com suporte a context manager
- O context manager devolve a conexão ao pool automaticamente (inclusive em exceção)
- import: from backend.database import get_db_connection
- import: from psycopg2.extras import RealDictCursor

PROBLEMA CONFIRMADO:
Em backend/routes/painel2_routes.py linha 34-96 (e em todos os outros ~38 arquivos):

    conn = get_db_connection()
    if not conn:
        return jsonify({'success': False, 'error': 'Erro de conexão com o banco'}), 500
    try:
        cursor = conn.cursor()
        cursor.execute(query, params)
        colunas = [desc[0] for desc in cursor.description]
        dados = [dict(zip(colunas, row)) for row in cursor.fetchall()]
        cursor.close()
        release_connection(conn)
        return jsonify({'success': True, 'data': dados})
    except Exception as e:
        current_app.logger.error(f'Erro: {e}', exc_info=True)
        if conn:
            release_connection(conn)
        return jsonify({'success': False, 'error': 'Erro ao buscar dados'}), 500

TAREFA — Atualizar todos os 39 arquivos de rotas de painéis

Para cada arquivo backend/routes/painel{N}_routes.py:

a) Garantir imports no topo:
   from backend.database import get_db_connection
   from psycopg2.extras import RealDictCursor

b) Remover import de release_connection:
   from backend.database import get_db_connection, release_connection  ← remover release_connection

c) Para CADA bloco de acesso ao banco dentro de funções, substituir pelo padrão:

   ANTES:
       conn = get_db_connection()
       if not conn:
           return jsonify({'success': False, 'error': 'Erro de conexão'}), 500
       try:
           cursor = conn.cursor()
           cursor.execute(QUERY, PARAMS)
           colunas = [desc[0] for desc in cursor.description]
           dados = [dict(zip(colunas, row)) for row in cursor.fetchall()]
           cursor.close()
           release_connection(conn)
           return jsonify({'success': True, 'data': dados, ...})
       except Exception as e:
           current_app.logger.error(...)
           if conn:
               release_connection(conn)
           return jsonify({'success': False, 'error': '...'}), 500

   DEPOIS:
       try:
           with get_db_connection() as conn:
               with conn.cursor(cursor_factory=RealDictCursor) as cur:
                   cur.execute(QUERY, PARAMS)
                   dados = cur.fetchall()
           return jsonify({'success': True, 'data': dados, ...})
       except Exception as e:
           current_app.logger.error(f'Erro painel{N}: {e}', exc_info=True)
           return jsonify({'success': False, 'error': 'Erro interno'}), 500

NOTAS IMPORTANTES:
1. RealDictCursor já retorna dicts — não é necessário `dict(zip(colunas, row))`
2. Se o código original usava `cursor.fetchone()`, mantenha `cur.fetchone()` (não mude fetchall para fetchone)
3. Se o cursor tinha `cursor_factory=RealDictCursor` no original, mantenha (já estará no with)
4. Se o código usava `conn.commit()` após INSERT/UPDATE, coloque ANTES do `with` fechar:
       with get_db_connection() as conn:
           with conn.cursor(cursor_factory=RealDictCursor) as cur:
               cur.execute(INSERT_QUERY, params)
           conn.commit()
5. Preserve todos os campos do jsonify original (success, data, total, timestamp, etc.)
6. Preserve todas as queries SQL intactas — apenas o padrão de conexão muda

RESTRIÇÕES ABSOLUTAS:
- Não altere nenhuma query SQL
- Não altere URLs de rotas
- Não altere a lógica de negócio
- Não altere os campos retornados no JSON
- Não adicione imports desnecessários
- Não adicione lógica extra além da troca de padrão

VERIFICAÇÃO FINAL:
- Grep por 'release_connection' em backend/routes/ deve retornar zero resultados
- Grep por 'if not conn:' em backend/routes/ deve retornar zero resultados
- `python app.py` deve iniciar sem erros
- GET /api/paineis/painel2/evolucoes deve retornar os mesmos dados de antes
```

---

---

# FASE 3 — Padronização de Blueprints

## Objetivo
Garantir que todos os blueprints sigam o mesmo padrão de `url_prefix`, registração e organização de rotas.

## Problema raiz
Blueprints criados em momentos diferentes têm padrões inconsistentes:

```python
# painel2_bp — TEM url_prefix:
painel2_bp = Blueprint('painel2', __name__, url_prefix='/api/paineis/painel2')
@painel2_bp.route('/evolucoes')  # → /api/paineis/painel2/evolucoes ✓

# painel4_bp — SEM url_prefix:
painel4_bp = Blueprint('painel4', __name__)  # sem prefix!
@painel4_bp.route('/api/paineis/painel4/dashboard')  # URL no decorator ✓ mas inconsistente
@painel4_bp.route('/painel/painel4')  # Rota HTML também aqui

# painel8_bp — SEM url_prefix:
painel8_bp = Blueprint('painel8', __name__)
@painel8_bp.route('/painel/painel8')
@painel8_bp.route('/api/paineis/painel8/enfermaria')
```

## Solução
Padronizar: todos os blueprints sem `url_prefix` (rotas HTML e API juntas no mesmo blueprint).  
Razão: muitos painéis têm rotas HTML (`/painel/painelN`) e rotas de API (`/api/paineis/painelN/...`), que não podem compartilhar o mesmo `url_prefix`. Manter sem prefix é mais claro e consistente.

Para os painéis que têm `url_prefix`, mover o prefix para dentro das rotas e remover do Blueprint.

## Arquivos afetados
- `backend/routes/painel2_routes.py` — o único (ou poucos) com url_prefix diferente
- Verificar todos os 39 para garantir consistência

---

## PROMPT FASE 3

```
Você é um engenheiro de software refatorando o sistema de painéis hospitalares HAC.
Sua tarefa é a FASE 3: Padronização de Blueprints.

PRÉ-REQUISITO: Fases 1 e 2 devem ter sido aplicadas antes.

CONTEXTO DO PROJETO:
- 39 blueprints Flask para painéis (painel2 a painel40)
- Alguns têm url_prefix no Blueprint(), outros não
- Todos devem seguir o mesmo padrão

PROBLEMA CONFIRMADO:
- painel2_bp: Blueprint('painel2', __name__, url_prefix='/api/paineis/painel2')
  Rotas: @painel2_bp.route('/evolucoes') → /api/paineis/painel2/evolucoes
- painel4_bp: Blueprint('painel4', __name__)  ← sem prefix
  Rotas: @painel4_bp.route('/api/paineis/painel4/dashboard') ← URL completa no decorator
- painel8_bp: Blueprint('painel8', __name__)  ← sem prefix
  Rotas: @painel8_bp.route('/painel/painel8') e @painel8_bp.route('/api/paineis/painel8/enfermaria')

PADRÃO ALVO: sem url_prefix no Blueprint, URL completa nos decorators

TAREFA:
1. Identifique todos os blueprints que têm url_prefix
2. Para cada um:
   a) Remova o url_prefix do Blueprint()
   b) Prefixe cada @route() com a URL que estava no prefix
   Exemplo:
     ANTES: Blueprint('painel2', __name__, url_prefix='/api/paineis/painel2')
            @painel2_bp.route('/evolucoes')
     DEPOIS: Blueprint('painel2', __name__)
             @painel2_bp.route('/api/paineis/painel2/evolucoes')
3. Verifique que NENHUM blueprint tem url_prefix no construtor
4. Verifique que as URLs resultantes são idênticas às URLs originais

RESTRIÇÕES:
- As URLs finais (endpoint HTTP) não devem mudar
- Não altere nenhuma lógica de rota
- Não altere queries SQL
- Não altere campos de resposta JSON

VERIFICAÇÃO FINAL:
- Grep por 'url_prefix' em backend/routes/ deve retornar zero resultados
- Todas as rotas em /debug/routes (em modo DEBUG) devem ser idênticas ao estado anterior
```

---

---

# FASE 4 — Centralização de Notificadores

## Objetivo
Eliminar ~350 linhas de código duplicado entre os 7 notificadores/workers, extraindo configuração compartilhada para um módulo central.

## Problema raiz
Cada notificador (`notificador_pareceres.py`, `notificador_sentir_agir.py`, `notificador_paciente_ps.py`, etc.) tem seu próprio setup de:
1. **Logging**: mesmas 15 linhas de RotatingFileHandler duplicadas
2. **Configuração do banco**: mesmas variáveis DB_HOST, DB_NAME, DB_USER, DB_PASS, DB_PORT carregadas do `.env`
3. **Configuração SMTP**: mesmas variáveis SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS duplicadas

## Solução
Criar `backend/notificador_utils.py` com funções compartilhadas:

```python
# backend/notificador_utils.py

import os
import logging
from logging.handlers import RotatingFileHandler
import psycopg2
from dotenv import load_dotenv

load_dotenv()

def setup_notificador_logging(nome: str, log_file: str) -> logging.Logger:
    """Configura logger rotativo padrão para notificadores."""
    logger = logging.getLogger(nome)
    logger.setLevel(logging.INFO)
    if not logger.handlers:
        fh = RotatingFileHandler(f'logs/{log_file}', maxBytes=5_000_000, backupCount=5)
        fh.setFormatter(logging.Formatter('[%(asctime)s] %(levelname)s - %(message)s'))
        sh = logging.StreamHandler()
        sh.setFormatter(logging.Formatter('[%(asctime)s] %(levelname)s - %(message)s'))
        logger.addHandler(fh)
        logger.addHandler(sh)
    return logger

def get_notificador_db_config() -> dict:
    """Retorna config de conexão PostgreSQL para notificadores."""
    return {
        'host': os.getenv('DB_HOST', 'localhost'),
        'database': os.getenv('DB_NAME', 'postgres'),
        'user': os.getenv('DB_USER', 'postgres'),
        'password': os.getenv('DB_PASSWORD', 'postgres'),
        'port': int(os.getenv('DB_PORT', 5432)),
        'connect_timeout': 10,
    }

def get_smtp_config() -> dict:
    """Retorna config SMTP compartilhada."""
    return {
        'host': os.getenv('SMTP_HOST', 'smtp.gmail.com'),
        'port': int(os.getenv('SMTP_PORT', 587)),
        'user': os.getenv('SMTP_USER', ''),
        'password': os.getenv('SMTP_PASS', ''),
        'from': os.getenv('SMTP_FROM', ''),
    }

def conectar_db():
    """Cria conexão PostgreSQL para uso em notificadores."""
    return psycopg2.connect(**get_notificador_db_config())
```

## Arquivos afetados
- Criar: `backend/notificador_utils.py`
- Modificar: `notificador_pareceres.py`, `notificador_sentir_agir.py`, `notificador_paciente_ps.py`, `worker_sentir_agir_analise.py`, `worker_imap_tratativas.py`, `worker_tests_sistema.py`, `backend/notificador_ocupacao_hospitalar.py`

---

## PROMPT FASE 4

```
Você é um engenheiro de software refatorando o sistema de painéis hospitalares HAC.
Sua tarefa é a FASE 4: Centralização de Notificadores.

CONTEXTO DO PROJETO:
- 7 notificadores/workers na raiz e em backend/:
  - notificador_pareceres.py
  - notificador_sentir_agir.py
  - notificador_paciente_ps.py
  - worker_sentir_agir_analise.py
  - worker_imap_tratativas.py
  - worker_tests_sistema.py
  - backend/notificador_ocupacao_hospitalar.py
- Cada um tem setup duplicado de logging, DB config e SMTP config

TAREFA 1 — Criar backend/notificador_utils.py

Crie o arquivo com exatamente este conteúdo:

```python
"""
Utilitários compartilhados para notificadores e workers.
"""
import os
import logging
from logging.handlers import RotatingFileHandler

import psycopg2
from dotenv import load_dotenv

load_dotenv()


def setup_notificador_logging(nome: str, log_file: str) -> logging.Logger:
    """Configura logger rotativo padrão para notificadores (5 MB, 5 backups)."""
    logger = logging.getLogger(nome)
    logger.setLevel(logging.INFO)
    if not logger.handlers:
        fmt = logging.Formatter('[%(asctime)s] %(levelname)s - %(message)s')
        fh = RotatingFileHandler(
            os.path.join('logs', log_file),
            maxBytes=5_000_000,
            backupCount=5
        )
        fh.setFormatter(fmt)
        sh = logging.StreamHandler()
        sh.setFormatter(fmt)
        logger.addHandler(fh)
        logger.addHandler(sh)
    return logger


def get_db_config() -> dict:
    """Retorna dict de configuração PostgreSQL para notificadores."""
    return {
        'host': os.getenv('DB_HOST', 'localhost'),
        'database': os.getenv('DB_NAME', 'postgres'),
        'user': os.getenv('DB_USER', 'postgres'),
        'password': os.getenv('DB_PASSWORD', 'postgres'),
        'port': int(os.getenv('DB_PORT', 5432)),
        'connect_timeout': 10,
    }


def get_smtp_config() -> dict:
    """Retorna dict de configuração SMTP para notificadores."""
    return {
        'host': os.getenv('SMTP_HOST', 'smtp.gmail.com'),
        'port': int(os.getenv('SMTP_PORT', 587)),
        'user': os.getenv('SMTP_USER', ''),
        'password': os.getenv('SMTP_PASS', ''),
        'sender': os.getenv('SMTP_FROM', ''),
    }


def conectar_db():
    """Cria e retorna conexão PostgreSQL direta (sem pool) para uso em workers."""
    return psycopg2.connect(**get_db_config())
```

TAREFA 2 — Atualizar cada notificador/worker

Para cada arquivo listado acima, leia o arquivo e:

a) Identifique o bloco de setup de logging (algo como):
   handler = RotatingFileHandler('logs/notificador_X.log', ...)
   logger = logging.getLogger(...)
   logger.addHandler(handler)
   ...

   Substitua por:
   from backend.notificador_utils import setup_notificador_logging
   logger = setup_notificador_logging('nome_do_notificador', 'nome_do_arquivo.log')

b) Identifique o bloco de configuração do banco (algo como):
   DB_CONFIG = {
       'host': os.getenv('DB_HOST', 'localhost'),
       'database': os.getenv('DB_NAME', 'postgres'),
       ...
   }

   Substitua por:
   from backend.notificador_utils import get_db_config
   DB_CONFIG = get_db_config()

c) Identifique o bloco de configuração SMTP (algo como):
   SMTP_HOST = os.getenv('SMTP_HOST', 'smtp.gmail.com')
   SMTP_PORT = int(os.getenv('SMTP_PORT', 587))
   SMTP_USER = os.getenv('SMTP_USER', '')
   SMTP_PASS = os.getenv('SMTP_PASS', '')

   Substitua por:
   from backend.notificador_utils import get_smtp_config
   _smtp = get_smtp_config()
   SMTP_HOST = _smtp['host']
   SMTP_PORT = _smtp['port']
   SMTP_USER = _smtp['user']
   SMTP_PASS = _smtp['password']
   SMTP_FROM = _smtp['sender']

d) Remova imports duplicados que foram movidos para notificador_utils:
   - import logging (se não há outro uso)
   - from logging.handlers import RotatingFileHandler (se não há outro uso)

RESTRIÇÕES:
- Não altere a lógica de negócio de nenhum notificador
- Não altere os intervalos de execução
- Não altere as queries SQL
- Não altere as condições de disparo
- O comportamento de runtime deve ser 100% idêntico

VERIFICAÇÃO FINAL:
- backend/notificador_utils.py deve existir
- Grep por 'RotatingFileHandler' fora de notificador_utils.py deve retornar zero em notificadores
- Cada notificador deve iniciar sem erro quando rodado manualmente: python notificador_pareceres.py
```

---

---

# FASE 5 — RateLimiter com Redis

## Objetivo
Tornar o rate limiting de login funcional em ambientes com múltiplos workers Gunicorn, usando Redis como armazenamento compartilhado.

## Problema raiz
`backend/auth.py` usa `class RateLimiter` que armazena contadores em memória Python. Com Gunicorn em 1 worker + 8 threads isso funciona, mas:
1. Se houver >1 worker no futuro, cada worker tem seu próprio contador → rate limiting ineficaz
2. Ao reiniciar o servidor, todos os bloqueios são perdidos
3. Um atacante pode reiniciar entre tentativas para resetar o contador

## Solução
Substituir o `RateLimiter` interno por Redis com TTL:

```python
# auth.py — novo RateLimiter baseado em Redis

class RateLimiter:
    def __init__(self, max_tentativas=5, janela_segundos=300, bloqueio_segundos=900):
        self.max_tentativas = max_tentativas
        self.janela = janela_segundos
        self.bloqueio = bloqueio_segundos

    def _get_redis(self):
        from backend.cache import _redis_client
        return _redis_client  # None se Redis indisponível

    def _chave_tentativas(self, identificador: str) -> str:
        return f'rl:tentativas:{identificador}'

    def _chave_bloqueio(self, identificador: str) -> str:
        return f'rl:bloqueio:{identificador}'

    def esta_bloqueado(self, identificador: str) -> bool:
        r = self._get_redis()
        if r is None:
            return False  # Fallback gracioso: sem Redis, sem bloqueio
        return r.exists(self._chave_bloqueio(identificador)) > 0

    def registrar_falha(self, identificador: str) -> int:
        r = self._get_redis()
        if r is None:
            return 0
        chave = self._chave_tentativas(identificador)
        tentativas = r.incr(chave)
        if tentativas == 1:
            r.expire(chave, self.janela)
        if tentativas >= self.max_tentativas:
            r.setex(self._chave_bloqueio(identificador), self.bloqueio, '1')
            r.delete(chave)
        return tentativas

    def registrar_sucesso(self, identificador: str):
        r = self._get_redis()
        if r is None:
            return
        r.delete(self._chave_tentativas(identificador))
        r.delete(self._chave_bloqueio(identificador))

    def tempo_restante_bloqueio(self, identificador: str) -> int:
        r = self._get_redis()
        if r is None:
            return 0
        return r.ttl(self._chave_bloqueio(identificador))
```

## Arquivos afetados
- `backend/auth.py` — substituir a classe `RateLimiter` e adaptar os usos

---

## PROMPT FASE 5

```
Você é um engenheiro de software refatorando o sistema de painéis hospitalares HAC.
Sua tarefa é a FASE 5: RateLimiter com Redis.

CONTEXTO DO PROJETO:
- Flask 3.0, Python 3.8+, Redis disponível via backend/cache.py (_redis_client)
- backend/auth.py tem classe RateLimiter que usa dicionários Python em memória
- Gunicorn roda com 1 worker + 8 threads (hoje), pode escalar no futuro
- Redis tem fallback gracioso: se indisponível, sistema funciona sem cache

PROBLEMA CONFIRMADO:
Em backend/auth.py, a classe RateLimiter usa:
    self._tentativas = {}   ← dicionário Python em memória
    self._bloqueios = {}    ← dicionário Python em memória
Isso não persiste entre restarts e não é compartilhado entre workers.

TAREFA — Substituir a classe RateLimiter em backend/auth.py

Leia o arquivo backend/auth.py completo antes de editar.

Substitua a implementação da classe RateLimiter (mantendo a mesma interface pública)
pela versão Redis abaixo. A interface pública que DEVE ser mantida é:
- esta_bloqueado(identificador: str) -> bool
- registrar_falha(identificador: str) -> int  (retorna número de tentativas)
- registrar_sucesso(identificador: str)
- tempo_restante_bloqueio(identificador: str) -> int  (segundos restantes)

Nova implementação:

class RateLimiter:
    def __init__(self, max_tentativas=5, janela_segundos=300, bloqueio_segundos=900):
        self.max_tentativas = max_tentativas
        self.janela = janela_segundos
        self.bloqueio = bloqueio_segundos

    def _get_redis(self):
        try:
            from backend.cache import _redis_client
            return _redis_client
        except Exception:
            return None

    def _chave_tentativas(self, identificador):
        return f'rl:tentativas:{identificador}'

    def _chave_bloqueio(self, identificador):
        return f'rl:bloqueio:{identificador}'

    def esta_bloqueado(self, identificador):
        r = self._get_redis()
        if r is None:
            return False
        try:
            return r.exists(self._chave_bloqueio(identificador)) > 0
        except Exception:
            return False

    def registrar_falha(self, identificador):
        r = self._get_redis()
        if r is None:
            return 0
        try:
            chave = self._chave_tentativas(identificador)
            tentativas = r.incr(chave)
            if tentativas == 1:
                r.expire(chave, self.janela)
            if tentativas >= self.max_tentativas:
                r.setex(self._chave_bloqueio(identificador), self.bloqueio, '1')
                r.delete(chave)
            return tentativas
        except Exception:
            return 0

    def registrar_sucesso(self, identificador):
        r = self._get_redis()
        if r is None:
            return
        try:
            r.delete(self._chave_tentativas(identificador))
            r.delete(self._chave_bloqueio(identificador))
        except Exception:
            pass

    def tempo_restante_bloqueio(self, identificador):
        r = self._get_redis()
        if r is None:
            return 0
        try:
            ttl = r.ttl(self._chave_bloqueio(identificador))
            return max(0, ttl)
        except Exception:
            return 0

VERIFICAÇÃO:
1. Certifique-se de que TODOS os chamadores da classe RateLimiter em auth.py
   continuam funcionando com a mesma interface
2. Se havia método `get_tentativas()` ou similar, implemente usando r.get()
3. O fallback (Redis indisponível → retorna False/0) deve ser mantido
4. Não altere nenhuma outra parte do arquivo auth.py

RESTRIÇÕES:
- Não altere a lógica de login
- Não altere a lógica de reset de senha
- Não altere nenhuma validação
- Não altere nenhuma rota

VERIFICAÇÃO FINAL:
- Login com senha incorreta 5x deve bloquear o usuário por 15 minutos
- Login correto após bloqueio deve continuar bloqueado
- Restart do servidor não deve desbloquear (persiste no Redis)
- Se Redis estiver down, login ainda funciona (fallback gracioso)
```

---

---

# FASE 6 — Graceful Shutdown de Threads Daemon

## Objetivo
Implementar shutdown controlado para as 7 threads daemon iniciadas em `app.py`, evitando perda de dados em mid-cycle ao reiniciar o serviço.

## Problema raiz
O `app.py` inicia 7 threads daemon sem nenhum mecanismo de parada controlada:

```python
# app.py linhas 187-241 — threads sem controle de shutdown
try:
    from notificador_pareceres import start_in_background as _start_notificador
    _start_notificador()  # inicia e nunca para graciosamente
except Exception as e:
    app.logger.warning(...)
```

Quando o Gunicorn recebe SIGTERM para restart/stop, as threads são terminadas abruptamente — possível corrupção de email em envio, transação de banco aberta, arquivo de log não fechado.

## Solução
Cada notificador já tem sua própria lógica de loop. A solução mínima é:
1. Cada `start_in_background()` retornar um `threading.Event` de parada
2. `app.py` registrar `atexit` para sinalizar parada a todos os workers

```python
# Padrão em cada notificador (exemplo notificador_pareceres.py):
import threading

_stop_event = threading.Event()

def start_in_background():
    _stop_event.clear()
    t = threading.Thread(target=_loop, daemon=True)
    t.start()
    return _stop_event  # retorna o event para controle externo

def stop():
    _stop_event.set()

def _loop():
    while not _stop_event.is_set():
        _ciclo()
        _stop_event.wait(INTERVALO_SEGUNDOS)  # interruptível
```

```python
# app.py — registrar shutdown:
import atexit

_stop_events = []

def _shutdown_workers():
    for event in _stop_events:
        event.set()

atexit.register(_shutdown_workers)

# Ao iniciar cada notificador:
try:
    from notificador_pareceres import start_in_background as _start
    evt = _start()
    if evt:
        _stop_events.append(evt)
except Exception as e:
    app.logger.warning(...)
```

## Arquivos afetados
- `app.py` — adicionar `_stop_events`, `_shutdown_workers`, `atexit`
- 7 arquivos de notificadores/workers — modificar `start_in_background()` e `_loop()`

---

## PROMPT FASE 6

```
Você é um engenheiro de software refatorando o sistema de painéis hospitalares HAC.
Sua tarefa é a FASE 6: Graceful Shutdown de Threads Daemon.

CONTEXTO DO PROJETO:
- app.py inicia 7 threads daemon ao iniciar
- Quando Gunicorn recebe SIGTERM, threads são terminadas abruptamente
- Cada notificador tem um loop com `while True: ciclo(); time.sleep(X)`
- Objetivo: ao receber sinal de shutdown, threads terminam no final do ciclo atual

ARQUIVOS A MODIFICAR:
- app.py
- notificador_pareceres.py
- notificador_sentir_agir.py
- notificador_paciente_ps.py
- worker_sentir_agir_analise.py
- worker_imap_tratativas.py
- worker_tests_sistema.py
- backend/notificador_ocupacao_hospitalar.py

TAREFA 1 — Modificar cada notificador/worker

Leia cada arquivo. Para cada um:

a) Adicione no topo do módulo (após imports):
   import threading
   _stop_event = threading.Event()

b) Modifique a função start_in_background() para retornar o _stop_event:
   def start_in_background():
       _stop_event.clear()
       t = threading.Thread(target=_loop_principal, daemon=True)
       t.name = 'NomeDoNotificador'
       t.start()
       return _stop_event

c) Modifique o loop principal (a função que tem `while True`) para:
   - Checar `_stop_event.is_set()` na condição do while:
     while not _stop_event.is_set():
   - Substituir `time.sleep(X)` por `_stop_event.wait(X)` para que o sleep seja interrompível:
     _stop_event.wait(timeout=INTERVALO_SEGUNDOS)
   
   Exemplo:
   ANTES: while True: ... time.sleep(600)
   DEPOIS: while not _stop_event.is_set(): ... _stop_event.wait(600)

d) Adicione função stop() ao módulo:
   def stop():
       _stop_event.set()

TAREFA 2 — Modificar app.py

Leia o arquivo app.py. Adicione após os imports existentes:

   import atexit
   import threading

Adicione antes dos blocos de início dos notificadores:

   # Controle de lifecycle das threads daemon
   _worker_stop_events = []

   def _shutdown_all_workers():
       """Sinaliza parada graceful a todos os workers ao encerrar."""
       for event in _worker_stop_events:
           event.set()
       app.logger.info(f'[shutdown] {len(_worker_stop_events)} workers sinalizados para parar')

   atexit.register(_shutdown_all_workers)

Para cada bloco de início de notificador (os 7 blocos try/except), modifique para:

   ANTES:
   try:
       from notificador_X import start_in_background as _start_X
       _start_X()
   except Exception as e:
       app.logger.warning(f'[notificador_X] Não iniciado: {e}')

   DEPOIS:
   try:
       from notificador_X import start_in_background as _start_X
       _evt = _start_X()
       if _evt is not None:
           _worker_stop_events.append(_evt)
   except Exception as e:
       app.logger.warning(f'[notificador_X] Não iniciado: {e}')

RESTRIÇÕES:
- Não altere a lógica de negócio de nenhum notificador
- Não altere os intervalos de execução
- Não altere as queries SQL
- O comportamento normal (sem shutdown) deve ser 100% idêntico

VERIFICAÇÃO FINAL:
- Iniciar o servidor e pressionar Ctrl+C deve logar "[shutdown] N workers sinalizados"
- Os workers não devem parar abruptamente no meio de um ciclo (testável com log)
- `python app.py` deve iniciar normalmente com todos os workers
```

---

---

# FASE 7 — Template de Email

## Objetivo
Extrair o HTML de email hardcoded em `auth.py` para um template reutilizável, melhorando manutenibilidade.

## Problema raiz
Em `backend/auth.py` (linha ~1137), o HTML do email de reset de senha é uma string multiline hardcoded dentro da função `_enviar_email_pin()`. Isso é difícil de editar, sem suporte a preview e mistura responsabilidade de conteúdo com lógica.

## Solução
Criar `backend/templates_email/reset_senha.html` e usar Jinja2 para renderização:

```python
# auth.py — antes:
corpo_html = f"""
<html><body>
<h2>Código de Reset</h2>
<p>Olá {nome_usuario},</p>
<p>Seu PIN é: <strong>{pin}</strong></p>
...
</body></html>
"""

# auth.py — depois:
from jinja2 import Environment, FileSystemLoader
_jinja = Environment(loader=FileSystemLoader('backend/templates_email'))

def _render_email(template_name: str, **ctx) -> str:
    return _jinja.get_template(template_name).render(**ctx)

corpo_html = _render_email('reset_senha.html', nome_usuario=nome, pin=pin, expira_em=10)
```

## Arquivos afetados
- Criar: `backend/templates_email/reset_senha.html`
- Modificar: `backend/auth.py`

---

## PROMPT FASE 7

```
Você é um engenheiro de software refatorando o sistema de painéis hospitalares HAC.
Sua tarefa é a FASE 7: Template de Email.

CONTEXTO DO PROJETO:
- backend/auth.py tem HTML de email de reset de senha como string hardcoded
- Flask/Jinja2 já está disponível (já é dependência do projeto)
- Objetivo: extrair para template sem mudar o conteúdo visual do email

TAREFA 1 — Criar diretório e template

Crie o arquivo backend/templates_email/reset_senha.html com o HTML que está atualmente
hardcoded em auth.py (na função _enviar_email_pin ou similar).

Transforme os valores dinâmicos em variáveis Jinja2:
- Nome do usuário → {{ nome_usuario }}
- PIN → {{ pin }}
- Tempo de expiração → {{ expira_min }} minutos
- Horário de expiração → {{ expira_horario }}

Mantenha o estilo visual idêntico ao original.

TAREFA 2 — Modificar backend/auth.py

a) Adicione import no topo do arquivo:
   from jinja2 import Environment, FileSystemLoader

b) Adicione após os imports um Jinja2 environment de módulo:
   _email_env = Environment(
       loader=FileSystemLoader(os.path.join(os.path.dirname(__file__), 'templates_email')),
       autoescape=True
   )

c) Crie função helper:
   def _render_email_template(nome: str, **ctx: object) -> str:
       return _email_env.get_template(nome).render(**ctx)

d) Na função _enviar_email_pin (ou equivalente), substitua a string hardcoded:
   ANTES:
       corpo_html = f"""<html>...<p>PIN: {pin}</p>...</html>"""

   DEPOIS:
       corpo_html = _render_email_template(
           'reset_senha.html',
           nome_usuario=nome_usuario,
           pin=pin,
           expira_min=10,
           expira_horario=(datetime.now() + timedelta(minutes=10)).strftime('%H:%M')
       )

RESTRIÇÕES:
- O conteúdo visual do email deve ser idêntico ao original
- A lógica de envio SMTP não deve ser alterada
- Não altere nenhuma outra parte do auth.py

VERIFICAÇÃO FINAL:
- O template deve existir em backend/templates_email/reset_senha.html
- O email de reset deve continuar funcionando (testar com usuário de teste)
- O arquivo auth.py não deve conter strings HTML longas (> 5 linhas) em funções
```

---

---

## Resumo do Impacto Total

| Fase | Linhas removidas | Linhas adicionadas | Risco |
|------|-----------------|-------------------|-------|
| 0 | ~15 | ~5 | Mínimo |
| 1 | ~585 | ~0 (decorator já existe) | Baixo |
| 2 | ~780 | ~0 (context manager já existe) | Baixo |
| 3 | ~0 (reorganização) | ~0 | Mínimo |
| 4 | ~350 | ~60 (notificador_utils.py) | Baixo |
| 5 | ~80 | ~70 (nova impl Redis) | Médio |
| 6 | ~0 | ~50 (events + atexit) | Baixo |
| 7 | ~30 | ~20 (template) | Mínimo |
| **Total** | **~1.840** | **~205** | — |

**Resultado**: ~1.640 linhas a menos no projeto. Código mais seguro, mais testável, sem comportamento alterado.

---

## Ordem de Prioridade para Execução

```
1. FASE 0  — Sempre primeiro. Sem risco. Resolve inconsistências que atrapalham debug.
2. FASE 1  — Maior impacto. Remove ~585 linhas de duplicação de permissão.
3. FASE 2  — Maior impacto técnico. Remove connection leaks potenciais.
4. FASE 5  — Segurança. RateLimiter que realmente funciona.
5. FASE 4  — Qualidade. Notificadores mais limpos.
6. FASE 6  — Estabilidade. Shutdown sem perda de dados.
7. FASE 3  — Cosmético. Consistência de blueprints.
8. FASE 7  — Cosmético. Template de email.
```

---

## Como usar este documento

Cada prompt das fases é **autocontido**: ele descreve o problema, a solução e os critérios de verificação. Uma IA pode ser alimentada apenas com o prompt da fase desejada + acesso ao projeto e executar a tarefa sem contexto adicional.

**Para máxima eficácia**, forneça à IA:
1. O prompt da fase
2. Acesso ao diretório do projeto
3. Permissão para editar arquivos
4. Instrução para verificar antes de qualquer commit

**Não é necessário** fornecer o CLAUDE.md ou este documento às IAs aplicadoras — cada prompt é suficiente.
