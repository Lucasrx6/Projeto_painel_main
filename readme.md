# Sistema de Painéis Hospitalares

[![Python](https://img.shields.io/badge/Python-3.8%2B-3776AB?style=flat-square&logo=python&logoColor=white)](https://www.python.org/)
[![Flask](https://img.shields.io/badge/Flask-3.0-000000?style=flat-square&logo=flask&logoColor=white)](https://flask.palletsprojects.com/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-12%2B-4169E1?style=flat-square&logo=postgresql&logoColor=white)](https://www.postgresql.org/)
[![Apache Hop](https://img.shields.io/badge/Apache%20Hop-2.x-FF6600?style=flat-square)](https://hop.apache.org/)
[![Status](https://img.shields.io/badge/Status-Em%20Produção-success?style=flat-square)](.)

> Plataforma modular para monitoramento em tempo real de operações hospitalares com 27+ painéis, sistema de notificações (email + push), monitoramento de infraestrutura e evolução clínica com séries temporais.

---

## Índice

- [Visão Geral](#visão-geral)
- [Painéis](#painéis)
- [Arquitetura](#arquitetura)
- [Stack Tecnológico](#stack-tecnológico)
- [Infraestrutura](#infraestrutura)
- [Sistema de Notificações](#sistema-de-notificações)
- [Estrutura de Diretórios](#estrutura-de-diretórios)
- [Instalação](#instalação)
- [Configuração (.env)](#configuração-env)
- [Serviços](#serviços)
- [API](#api)
- [Segurança](#segurança)
- [Roadmap](#roadmap)

---

## Visão Geral

Sistema que centraliza **27 painéis de monitoramento hospitalar** numa plataforma única. Integra dados do **Tasy (Oracle)** via ETL com **Apache Hop**, serve via **Flask/PostgreSQL**, e envia alertas automáticos por **email (Apprise)** e **push (ntfy)**.

Projetado para monitores/TVs de plantão com auto-scroll, atualização automática e PWA. Inclui evolução clínica com gráficos Chart.js, séries temporais de sinais vitais e exames laboratoriais.

### Fluxo de Dados

```
Oracle Tasy ──► Apache Hop (ETL) ──► PostgreSQL ──► Flask API ──► Frontend (HTML/CSS/ES5 JS)
                    │                     │                            │
                    │                     ├── Notificador ntfy ────► Push (celular)
                    │                     ├── Notificador Pareceres ► Email (Apprise)
                    │                     ├── Metabase BI ──────────► Relatórios
                    │                     └── Uptime Kuma ─────────► Monitoramento
                    │
                    ├── Pipeline 1-2: TRUNCATE + INSERT (foto atual)
                    └── Pipeline 3-4: INSERT incremental (histórico temporal)
```

---

## Painéis

| #  | Nome | Descrição |
|----|------|-----------|
| 2  | Evolução de Turno | Evoluções médicas e de enfermagem por turno |
| 3  | Médicos PS | Médicos logados e ativos no Pronto Socorro |
| 4  | Ocupação Hospitalar | Taxa de ocupação de leitos por setor |
| 5  | Cirurgias do Dia | Cirurgias agendadas, em andamento e finalizadas |
| 6  | Priorização Clínica IA | Análise de risco clínico com Groq/Llama 3.3 70B |
| 7  | Detecção de Sepse | Critérios de sepse por paciente |
| 8  | Situação dos Pacientes | Status dos pacientes internados |
| 9  | Laboratório Pendentes | Exames laboratoriais pendentes por setor |
| 10 | Análise PS | Análise operacional do Pronto Socorro |
| 11 | Internação PS | Pacientes aguardando internação vindos do PS |
| 12 | Ocupação e Produção | Métricas de ocupação e produtividade |
| 13 | Mapa de Nutrição | Prescrições nutricionais dos pacientes |
| 14-15 | Helpdesk TI | Chamados de suporte técnico |
| 16 | Recepção | Performance e filas de atendimento |
| 17 | Tempo de Espera PS | Tempos de espera no Pronto Socorro |
| 18 | Produtividade Médica PS | Produtividade médica no PS |
| 19 | Radiologia Internados | Exames de imagem de pacientes internados |
| 20 | Radiologia PS | Exames de imagem do Pronto Socorro |
| 21 | Ciclo de Contas | Evolução do faturamento hospitalar |
| 22 | Jornada do Paciente PS | Status de exames (visão paciente) |
| 23 | Ambulatorial | Atendimentos ambulatoriais |
| 24 | Farmácia Estoque-Dia | Estoque de medicamentos por dia |
| 25 | Exames PS Médico | Resultados de exames (visão médica) |
| **26** | **Central de Notificações** | **Configuração de destinatários, canais e regras de envio** |
| **27** | **Evolução Clínica** | **Sinais vitais + exames lab com gráficos Chart.js** |

---

## Arquitetura

```
┌─────────────────────────────────────────────────────────────┐
│               Cliente (Browser / TV / PWA)                  │
└─────────────────────────────┬───────────────────────────────┘
                              │
                    ┌─────────┴─────────┐
                    │   Nginx (porta 80) │
                    │   Reverse Proxy    │
                    └────┬────┬────┬────┘
                         │    │    │
            ┌────────────┘    │    └────────────┐
            ▼                 ▼                  ▼
     Flask :5000      Uptime Kuma :3001    Metabase :3000
     (27 Blueprints)  (Monitoramento)      (BI/Relatórios)
            │
            ▼
     ┌──────────────┐     ┌───────────────────┐
     │  PostgreSQL   │◄────│  Apache Hop (ETL)  │◄── Oracle Tasy
     │              │     │  4 tipos pipeline  │
     │  Operacional │     └───────────────────┘
     │  + Histórico │
     └──────┬───────┘
            │
     ┌──────┴──────────────────────┐
     │                             │
     ▼                             ▼
 notificador.py           notificador_pareceres.py
 (ntfy push)              (Email Apprise + ntfy)
     │                             │
     ▼                             ▼
 ntfy.sh (push)           SMTP Gmail (email)
```

### Padrão de Painéis

Cada painel segue a mesma estrutura:

- **Oracle SQL** → Query de extração
- **Apache Hop** → Pipeline ETL (TRUNCATE+INSERT ou INSERT incremental)
- **PostgreSQL** → Tabela + Views
- **Flask Blueprint** → `painel{N}_routes.py` com endpoints REST
- **Frontend** → `paineis/painel{N}/` com `index.html`, `style.css`, `main.js`
- **JavaScript** → ES5 IIFE com padrão `Estado`/`DOM`/`CONFIG`

---

## Stack Tecnológico

### Core

| Componente | Tecnologia | Função |
|------------|-----------|--------|
| HIS | Oracle Tasy | Sistema fonte (prontuário eletrônico) |
| ETL | Apache Hop 2.x | Extração Oracle → PostgreSQL |
| Banco | PostgreSQL 12+ | Data warehouse operacional + histórico |
| Backend | Flask 3.0 / Python 3.8+ | API REST |
| Frontend | HTML5 / CSS3 / ES5 JS | Interface dos painéis |

### Infraestrutura

| Serviço | Porta | Função |
|---------|-------|--------|
| Flask | 5000 | Aplicação principal |
| Nginx | 80 | Reverse proxy |
| Uptime Kuma | 3001 | Monitoramento de saúde |
| Metabase | 3000 | BI e relatórios gerenciais |
| Gitea | 3002 | Controle de versão (Git) |

### Notificações

| Canal | Tecnologia | Uso |
|-------|-----------|-----|
| Push | ntfy.sh | Admissão, prescrição, parecer |
| Email | Apprise + SMTP | Pareceres pendentes (HTML formatado) |

### Frontend

| Biblioteca | Função |
|-----------|--------|
| Font Awesome 6.4 | Ícones |
| Chart.js 4.4 | Gráficos de evolução clínica (P27) |
| SheetJS | Exportação Excel |

### Serviços Windows (NSSM)

| Serviço | Arquivo | Função |
|---------|---------|--------|
| Flask App | `app.py` | Aplicação web |
| Notificador ntfy | `notificador.py` | Push de admissão, prescrição, parecer |
| Notificador Pareceres | `notificador_pareceres.py` | Email de pareceres pendentes |
| Uptime Kuma | Node.js | Health check de infraestrutura |

---

## Sistema de Notificações

### Arquitetura

```
                    ┌──────────────────────┐
                    │  Painel 26 (Web UI)  │
                    │  Central de Config   │
                    └──────────┬───────────┘
                               │ CRUD destinatários
                               ▼
                    ┌──────────────────────┐
                    │ notificacoes_        │
                    │ destinatarios        │
                    │ (canal + tipo + espec)│
                    └────┬────────────┬────┘
                         │            │
              canal='email'     canal='ntfy'
                         │            │
                         ▼            ▼
              notificador_     notificador.py
              pareceres.py     (admissão, prescrição,
              (Apprise SMTP)    parecer push)
                         │            │
                         ▼            ▼
                   Email HTML    ntfy.sh push
```

### Como configurar

Tudo pelo **Painel 26** (Central de Notificações):

- **Email por especialidade**: tipo `parecer_pendente`, canal `email`, especialidade `Cardiologia` → só recebe pareceres de cardio
- **Email geral**: tipo `parecer_pendente`, canal `email`, especialidade vazia → recebe todos
- **Push ntfy**: tipo `admissao_nova`, canal `ntfy`, tópico `hac-admissao` → push de novas admissões
- **Múltiplos tópicos**: criar vários registros ntfy pro mesmo tipo → envia pra todos

### Eventos monitorados

| Evento | Detecção | Email | ntfy |
|--------|----------|-------|------|
| Nova admissão | `dt_entrada_unid` < 35min | — | Sim |
| Prescrição pendente | Sem prescrição após 2h (novo) ou 11h (existente) | — | Sim |
| Parecer pendente | Novo parecer < 30min | Sim (com motivo RTF limpo) | Sim |

---

## Estrutura de Diretórios

```
C:\Projeto_Painel_Main\
│
├── app.py                              # Flask (27+ Blueprints)
├── config.py                           # Dev / Homolog / Production
├── .env                                # Credenciais (NÃO versionar)
├── .gitignore
│
├── notificador.py                      # Serviço: alertas ntfy
├── notificador_pareceres.py            # Serviço: email pareceres
│
├── backend/
│   ├── database.py                     # Conexão PostgreSQL
│   ├── auth.py                         # Autenticação bcrypt
│   ├── user_management.py              # CRUD usuários e permissões
│   ├── middleware/
│   │   ├── decorators.py               # @login_required
│   │   ├── security.py                 # CORS, HSTS, CSP
│   │   └── rate_limiter.py             # Rate limiting
│   └── routes/
│       ├── auth_routes.py              # Login / Logout
│       ├── admin_routes.py             # Gestão de usuários
│       ├── health_routes.py            # Health check (público)
│       ├── painel2_routes.py           # ... até ...
│       ├── painel27_routes.py          # Evolução Clínica
│       └── painel26_routes.py          # Central de Notificações
│
├── frontend/
│   ├── login.html / dashboard.html
│   └── admin-usuarios.html
│
├── paineis/
│   ├── painel2/ ... painel25/          # index.html + style.css + main.js
│   ├── painel26/                       # Central de Notificações
│   └── painel27/                       # Evolução Clínica + Chart.js
│
├── static/img/                         # Logo, favicon
├── logs/                               # Logs rotativos
└── scripts/                            # Utilitários
```

---

## Instalação

### Pré-requisitos

- Python 3.8+, PostgreSQL 12+, Node.js 18+ (Uptime Kuma)
- Apache Hop 2.x, Java 17+ (Metabase)
- Acesso ao Oracle Tasy (rede interna)

### Setup rápido

```bash
# 1. Clone
git clone http://localhost:3002/postgres/painel-main.git
cd painel-main

# 2. Ambiente virtual
python -m venv .venv
.venv\Scripts\activate

# 3. Dependências
pip install -r backend/requirements.txt

# 4. Configurar .env (ver seção abaixo)

# 5. Criar tabelas
psql -U postgres -d postgres -f tabelas.txt

# 6. Iniciar
python app.py
```

---

## Configuração (.env)

```env
# ============================================
# Banco de dados
# ============================================
DB_HOST=localhost
DB_NAME=postgres
DB_USER=postgres
DB_PASSWORD=sua_senha
DB_PORT=5432

# ============================================
# Flask
# ============================================
SECRET_KEY=gere_com_python_secrets_token_hex_32
FLASK_ENV=production

# ============================================
# SMTP (notificador_pareceres.py)
# ============================================
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=hac.notificacaotasy@seudominio.com
SMTP_PASS=sua_senha_app
SMTP_FROM=hac.notificacaotasy@seudominio.com

# ============================================
# ntfy (notificador.py)
# ============================================
NTFY_URL=https://ntfy.sh

# ============================================
# Intervalos de verificação (minutos)
# ============================================
NOTIF_INTERVALO_MIN=15
NOTIF_PARECER_INTERVALO_MIN=15

# ============================================
# IA (opcional)
# ============================================
GROQ_API_KEY=sua_chave_groq
```

> **Importante**: O `.env` nunca vai pro repositório. Está no `.gitignore`.

---

## Serviços

### Windows (NSSM)

```powershell
# Flask
nssm install PainelFlask "C:\Projeto_Painel_Main\.venv\Scripts\python.exe" "C:\Projeto_Painel_Main\app.py"

# Notificador ntfy
nssm install NotificadorNtfy "C:\Projeto_Painel_Main\.venv\Scripts\python.exe" "C:\Projeto_Painel_Main\notificador.py"

# Notificador Pareceres
nssm install NotificadorPareceres "C:\Projeto_Painel_Main\.venv\Scripts\python.exe" "C:\Projeto_Painel_Main\notificador_pareceres.py"
```

### Health Check

Endpoints públicos (sem autenticação) para Uptime Kuma:

| Endpoint | Verifica |
|----------|----------|
| `/api/health/status` | Flask + PostgreSQL |
| `/api/health/etl` | Última execução do Apache Hop |
| `/api/health/notificador` | Último ciclo do notificador |

---

## API

Autenticação via sessão (cookie). Todos os endpoints retornam JSON.

### Padrão por painel

| Endpoint | Descrição |
|----------|-----------|
| `GET /api/paineis/painel{N}/dashboard` | KPIs e resumo |
| `GET /api/paineis/painel{N}/dados` | Dados completos com filtros |
| `GET /api/paineis/painel{N}/filtros` | Opções para dropdowns |

### Painel 27 — Evolução Clínica (específico)

| Endpoint | Descrição |
|----------|-----------|
| `GET /api/paineis/painel27/historico-sinais/{atend}` | Série temporal de sinais vitais |
| `GET /api/paineis/painel27/historico-exames/{atend}` | Série temporal de exames lab |

### Painel 26 — Central de Notificações (específico)

| Endpoint | Descrição |
|----------|-----------|
| `GET /api/paineis/painel26/destinatarios` | Lista destinatários com filtros |
| `POST /api/paineis/painel26/destinatarios` | Cria destinatário (email ou ntfy) |
| `PUT /api/paineis/painel26/destinatarios/{id}` | Edita destinatário |
| `PUT /api/paineis/painel26/destinatarios/{id}/toggle` | Ativa/desativa |
| `DELETE /api/paineis/painel26/destinatarios/{id}` | Remove |
| `GET /api/paineis/painel26/historico` | Timeline de envios |

---

## Segurança

| Camada | Implementação |
|--------|--------------|
| Senhas | bcrypt (work factor 12) |
| SQL | Prepared statements (psycopg2 `%s`) |
| Sessão | Cookies HttpOnly + SameSite=Strict |
| Headers | HSTS, CSP, X-Frame-Options |
| Rate Limit | 200 req/hora por IP (produção) |
| RBAC | Permissões por painel por usuário |
| Credenciais | Exclusivamente via `.env` |
| Repositório | `.env` no `.gitignore` |
| Notificações | Sem dados de paciente no ntfy (público) |

---

## Apache Hop — Pipelines

### Padrão operacional (todos os painéis)

```
Oracle (Table Input) ──► PostgreSQL (TRUNCATE + INSERT)
Ciclo: 5-10 minutos
```

### Padrão histórico (Painel 27)

```
Oracle (Table Input) ──► PostgreSQL (INSERT incremental, sem TRUNCATE)
Acumula série temporal ao longo dos dias
Dedup via constraint UNIQUE no banco
```

### Pipelines do Painel 27

| Pipeline | Destino | Modo | Conteúdo |
|----------|---------|------|----------|
| 1 | `p27_pacientes` | TRUNCATE+INSERT | Pacientes + sinais vitais |
| 2 | `p27_exames_lab` | TRUNCATE+INSERT | Exames lab normalizados |
| 3 | `p27_historico_sinais` | INSERT | Série temporal sinais |
| 4 | `p27_historico_exames` | INSERT | Série temporal exames |

---

## Roadmap

### Concluído recentemente

- [x] Painel 26 — Central de Notificações
- [x] Painel 27 — Evolução Clínica com Chart.js
- [x] Sistema de notificações email (Apprise) + push (ntfy)
- [x] Múltiplos tópicos ntfy por tipo de evento
- [x] Roteamento email por especialidade médica
- [x] Parser RTF para motivo de consulta (PostgreSQL)
- [x] Tabelas históricas com INSERT incremental
- [x] Infraestrutura: Nginx, Uptime Kuma, Metabase, Gitea
- [x] Health check endpoints para monitoramento
- [x] Credenciais removidas do código (100% via .env)

### Em planejamento

- [ ] Grafana para dashboards temporais (usando tabelas históricas)
- [ ] Backup automatizado com Duplicati
- [ ] Detecção de eventos no Apache Hop (delta ETL)
- [ ] Transformações no ETL (cálculos, classificações)
- [ ] Registrar notificadores como serviços Windows (NSSM)
- [ ] DNS interno (paineis → 172.16.1.75)

---

## Licença

**Uso interno — Hospital Anchieta Ceilândia**

Desenvolvido exclusivamente para uso interno. Proibida redistribuição ou uso comercial sem autorização.

---

*Desenvolvido para o Hospital Anchieta Ceilândia · Atualizado em março de 2026*
