# Servicos NSSM - Workers Python do Painel

Pacote para rodar os workers Python (`worker_sentir_agir_analise.py`,
`notificador_sentir_agir.py`, `notificador_pareceres.py`) como servicos do
Windows, com auto-start no boot.

---

## Conteudo

| Arquivo | Funcao |
|---|---|
| `_config_nssm.bat` | Helper - localiza o `nssm.exe` |
| `_config_python.bat` | Helper - localiza o `python.exe` do venv |
| `instalar_workers_python.bat` | Registra os 3 workers como servicos NSSM |
| `desinstalar_workers_python.bat` | Para e remove todos |
| `iniciar_todos_workers.bat` | Inicia todos manualmente |
| `parar_todos_workers.bat` | Para todos manualmente |
| `status_workers.bat` | Mostra estado e PID de cada um |

---

## Servicos registrados

| Servico | Script | Descricao |
|---|---|---|
| `Worker_Analise_IA` | `worker_sentir_agir_analise.py` | Analise IA (Groq Llama 3.3 70B) |
| `Notif_Sentir_Agir` | `notificador_sentir_agir.py` | Notificador Sentir e Agir |
| `Notif_Pareceres` | `notificador_pareceres.py` | Notificador de Pareceres |

Os scripts tem schedule proprio (loop interno) — o NSSM so os mantem vivos
e reinicia automaticamente se cairem.

---

## Como funciona com venv (sem `activate`)

NSSM aponta direto pro `python.exe` do venv:

```
"%NSSM%" install Worker_Analise_IA "C:\Projeto_Painel_Main\venv\Scripts\python.exe"
"%NSSM%" set Worker_Analise_IA AppParameters "-u worker_sentir_agir_analise.py"
"%NSSM%" set Worker_Analise_IA AppDirectory "C:\Projeto_Painel_Main"
```

O Python dentro de `venv\Scripts\` se comporta como se o venv estivesse
ativado — ele detecta o venv pelo proprio caminho do executavel via `pyvenv.cfg`
e carrega todas as libs instaladas. Nao precisa de `activate.bat`.

A flag `-u` desliga o buffer do stdout/stderr para os logs aparecerem em
tempo real (alem de `PYTHONUNBUFFERED=1` setado nas variaveis de ambiente,
por garantia).

`AppDirectory` aponta pra raiz do projeto, o que resolve:
- Carregamento do `.env` via `load_dotenv()`
- Imports do tipo `from backend.database import ...`
- Paths relativos no codigo

---

## Como usar

### Pre-requisitos

1. NSSM em `C:\nssm\nssm.exe` (ou onde for) - o helper detecta automatico
2. Venv do projeto em `C:\Projeto_Painel_Main\venv\` (ou similar) - tambem detecta
3. Os 3 scripts `.py` na raiz do projeto

### Primeira instalacao

1. Coloca os 7 arquivos numa pasta (ex.: `C:\Projeto_Painel_Main\workers_servicos\`)
2. Botao direito em `instalar_workers_python.bat` -> **Executar como administrador**
3. Roda `iniciar_todos_workers.bat`
4. Confere com `status_workers.bat`

### Verificacao real (recomendado)

Status `RUNNING` nao garante que o script esteja saudavel. Confere os logs:

```cmd
type C:\logs\workers\Worker_Analise_IA.log
type C:\logs\workers\Notif_Sentir_Agir.log
type C:\logs\workers\Notif_Pareceres.log
```

Tem que ver atividade do schedule ("ciclo iniciado", "verificando pacientes",
"enviando notificacao", etc).

E os processos Python:

```cmd
tasklist /FI "IMAGENAME eq python.exe"
```

Devem aparecer 3 processos.

---

## Troubleshooting

**Auto-detecao do Python falhou**
Edita `_config_python.bat`, descomenta a linha de override e poe o caminho
correto do `Scripts\python.exe` do seu venv.

**Servico sobe e cai imediatamente**
Olha `C:\logs\workers\<servico>.err.log`. Causas comuns:
- Lib faltando no venv (instala com o `pip` do mesmo venv)
- `.env` nao encontrado (confirma que `AppDirectory` esta certo)
- Erro de import (rodar manualmente uma vez pra ver a stack trace)

**`.env` nao carrega**
Como o servico roda como Local System, o `cwd` e o que setamos em
`AppDirectory`. Confirma que `load_dotenv()` no codigo nao recebe um path
absoluto que aponte pra outro lugar.

**Acesso a APIs externas (Groq, ntfy.sh, SMTP) bloqueado**
Local System nao herda configuracao de proxy do usuario. Se o servidor passa
por proxy corporativo, configura via variaveis de sistema `HTTP_PROXY` /
`HTTPS_PROXY` ou rode o servico com uma conta especifica:
```
"%NSSM%" set Worker_Analise_IA ObjectName ".\usuario_painel" "senha"
```

**Logs vazios mesmo com servico rodando**
Python pode estar bufferizando. O `-u` ja resolve isso, mas se mesmo assim
acontecer, verifica se o codigo nao redireciona stdout pra outro lugar.

---

## Operacao do dia a dia

```cmd
REM Status rapido
status_workers.bat

REM Reiniciar so um worker (ex. apos atualizar codigo)
nssm restart Worker_Analise_IA

REM Ou parar/iniciar individualmente
nssm stop Worker_Analise_IA
nssm start Worker_Analise_IA

REM Desabilitar auto-start temporariamente (mantem instalado)
nssm set Worker_Analise_IA Start SERVICE_DEMAND_START

REM Voltar pro auto-start
nssm set Worker_Analise_IA Start SERVICE_AUTO_START
```
