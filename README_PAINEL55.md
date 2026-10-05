# Painel 55 — Auditoria Pré-Faturamento de Contas Hospitalares

Sistema de conferência automática de contas hospitalares antes do faturamento, com 30 regras determinísticas em PostgreSQL e leitura de texto via IA (Groq/Llama 3.3 70B, desligada por padrão).

---

## Instalação rápida

### 1. Banco de dados

Execute os scripts de migração na ordem, no banco `auditoria`:

```powershell
psql -U postgres -d auditoria -f scripts\00_instalacao_completa.sql
psql -U postgres -d auditoria -f scripts\11_analise_job.sql
```

O script `11_analise_job.sql` é idempotente — pode ser reexecutado sem efeito colateral.

### 2. Variáveis de ambiente

Copie `.env.example` para `.env` e preencha os valores obrigatórios:

```powershell
copy .env.example .env
notepad .env
```

Campos obrigatórios mínimos para o Painel 55 funcionar:

| Variável | Descrição |
|---|---|
| `AUDIT_DB_HOST` | Host do PostgreSQL (padrão: `localhost`) |
| `AUDIT_DB_NAME` | Nome do banco (padrão: `auditoria`) |
| `AUDIT_DB_USER` | Usuário do banco |
| `AUDIT_DB_PASSWORD` | Senha do banco |
| `AUDITORIA_HMAC_SECRET` | Segredo HMAC ≥ 32 chars (LGPD) |

Gere o segredo HMAC:

```powershell
python -c "import secrets; print(secrets.token_hex(32))"
```

### 3. Permissões de usuário

No admin do sistema (`/admin-usuarios`), conceda acesso ao `painel55` para os auditores.

---

## Configuração como serviço Windows (NSSM)

O Painel 55 roda dentro do Flask principal. Não requer serviço separado.

Para registrar o Flask como serviço:

```powershell
.\instalar_servico.ps1
```

---

## Validação do ambiente

### Via interface web

1. Acesse `/painel/painel55`
2. Clique em **Verificar** no card "Validação do Ambiente" (canto superior direito do painel principal)
3. Cada verificação retorna um ícone ✓ (OK), ⚠ (aviso) ou ✗ (falha)
4. O veredito `PRONTO_PARA_IA` indica que todos os requisitos obrigatórios foram atendidos

### Via linha de comando

```powershell
cd Projeto_painel_main
.venv\Scripts\Activate.ps1
python backend\auditoria\validacao.py
echo "Exit code: $LASTEXITCODE"   # 0 = PRONTO_PARA_IA, 1 = INCOMPLETO
```

### Verificações realizadas (A1–A7)

| Código | Verificação |
|---|---|
| A1.01 | PostgreSQL ≥ 12 |
| A1.02 | `audit.verificar_instalacao()` não retorna erros |
| A1.03 | ≥ 29 views `audit.v_rNN_*` instaladas |
| A1.04 | Consistência do catálogo `audit.regra` × views |
| A1.05 | 13 colunas padrão em cada view de regra |
| A1.06 | Índice `ux_achado_dedup` presente |
| A1.07 | Constraint `ck_evidencia` presente |
| A1.08 | Tabela `audit.analise_job` existe |
| A5.01 | `AUDITORIA_HMAC_SECRET` ≥ 16 caracteres |
| A6.01 | `IA_HABILITADA` (informativo — `false` é normal) |
| A6.02 | `ia_externa_autorizada` no banco (informativo) |
| A6.03 | Nenhum `SELECT *` / `COUNT(*)` / `RETURNING *` nos `.py` |
| A6.04 | Nenhum padrão de segredo em código-fonte |
| A6.05 | Arquivo `.env` existe |
| A6.06 | `.env` está no `.gitignore` |
| A6.07 | `.env.example` existe |
| A7.01 | `GROQ_API_KEY` presente (apenas se IA habilitada) |
| A7.02 | `GROQ_MODEL` configurado (apenas se IA habilitada) |

---

## Habilitando a IA (Groq) — somente em homologação confirmada

A IA permanece **desligada por padrão** por duas razões: privacidade (texto de prontuário sai do ambiente) e custo.

Para habilitar em ambiente de **teste**:

### Passo 1 — Obtenha uma chave Groq

Acesse [console.groq.com](https://console.groq.com), crie uma chave e coloque no `.env`:

```env
GROQ_API_KEY=gsk_xxxxxxxxxxxxxxxxxxxxx
IA_HABILITADA=true
```

### Passo 2 — Autorize no banco

```sql
UPDATE audit.parametro
SET valor = 'true', atualizado_em = NOW()
WHERE chave = 'ia_externa_autorizada';
```

### Passo 3 — Valide o ambiente

```powershell
python backend\auditoria\validacao.py
```

O veredito deve ser `PRONTO_PARA_IA`.

### Passo 4 — Primeiro teste com mock

Execute apenas em banco de teste:

```sql
-- Em banco de TESTE, nunca em produção:
\i scripts\08_mock_dados_teste.sql
\i scripts\09_testes_regras.sql
```

### Kill switch de emergência

Para desligar a IA imediatamente sem reiniciar o servidor, faça uma requisição autenticada como admin:

```
POST /api/auditoria/ia/kill
```

Isso chama `matar_ia()` no módulo `backend/auditoria/leitor_groq.py`. O estado persiste até o próximo restart do Flask.

---

## Fluxo de uso

1. **Abrir o painel**: `/painel/painel55`
2. **Selecionar uma conta** na lista lateral (filtro por gravidade disponível)
3. **Executar Regras**: botão no topo direito da área de detalhe
   - Cria job em `audit.analise_job` (status: `fila` → `rodando` → `concluida`)
   - Chama `audit.executar_regras(nr_atendimento)` no banco
   - Polling automático a cada 1,5s até conclusão
4. **Ver achados**: tabela com regra, tipo, gravidade, encontrado/esperado, valor em risco
5. **Registrar decisão**: botão "Decidir" em achados `pendente`
   - Decisões: `procede_corrigido`, `nao_procede`, `ja_justificado`
   - Justificativa obrigatória (mínimo 10 caracteres)

---

## Estrutura de arquivos

```
backend/
  routes/painel55_routes.py    Blueprint Flask (banco auditoria, jobs, feedback)
  auditoria/
    __init__.py
    validacao.py               Verificações A1-A7, CLI e endpoint
    leitor_groq.py             Kill switch + LeitorLocal (regex) + LeitorGroq

paineis/painel55/
  index.html                   UI da aplicação de auditoria
  main.js                      ES5 IIFE: contas, achados, jobs, validação, feedback
  style.css                    Layout aplicação (não TV)

scripts/
  00_instalacao_completa.sql   DDL base do banco auditoria (NÃO alterar)
  11_analise_job.sql           Migração: audit.analise_job + audit.atualizar_job()
  08_mock_dados_teste.sql      Mock de dados (somente banco de TESTE)
  09_testes_regras.sql         Testes das regras (somente banco de TESTE)

.env.example                   Template de variáveis de ambiente (sem valores)
```

---

## Troubleshooting

### Painel exibe "Erro ao buscar contas"

1. Verifique se o banco `auditoria` está acessível: `AUDIT_DB_*` no `.env`
2. Rode a validação: `python backend\auditoria\validacao.py`
3. Veja `logs\painel.log` para o traceback completo

### Job travado em `fila` ou `rodando`

Pode ter ocorrido restart do servidor com job em andamento. Para limpar manualmente:

```sql
UPDATE audit.analise_job
SET status = 'cancelada', dt_fim = NOW(), erro = 'Cancelado manualmente'
WHERE status IN ('fila', 'rodando');
```

### `AUDITORIA_HMAC_SECRET` não configurado

A validação (A5.01) falha e o painel recusa conexão. Configure o segredo no `.env` e reinicie o Flask.

### IA retorna itens descartados

O `LeitorGroq._parsear()` descarta qualquer item onde `trecho` não for uma substring literal do texto enviado. Isso é intencional — garante que a IA não alucine evidências.

---

## Segurança e LGPD

- Identificadores pessoais (`cd_pessoa_fisica`, `cd_medico*`) são pseudonimizados via HMAC antes de chegar ao PostgreSQL
- O Flask lê apenas colunas `*_pseud` — nunca identificadores em claro
- `AUDITORIA_HMAC_SECRET` nunca é logado, impresso ou enviado ao navegador
- Texto de prontuário nunca aparece em logs — apenas contagens, IDs e hashes MD5
- ntfy.sh é público: **nunca** envie dados de paciente via ntfy
- A IA só recebe texto após dupla autorização (env + banco); o kill switch para chamadas imediatamente
