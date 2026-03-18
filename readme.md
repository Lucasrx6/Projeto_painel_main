# Sistema de Painéis Hospitalares — Hospital Anchieta Ceilândia

[![Python](https://img.shields.io/badge/Python-3.8%2B-3776AB?style=flat-square&logo=python&logoColor=white)](https://www.python.org/)
[![Flask](https://img.shields.io/badge/Flask-3.0-000000?style=flat-square&logo=flask&logoColor=white)](https://flask.palletsprojects.com/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-12%2B-4169E1?style=flat-square&logo=postgresql&logoColor=white)](https://www.postgresql.org/)
[![Groq](https://img.shields.io/badge/Groq-Llama%203.3%2070B-F55036?style=flat-square)](https://groq.com/)
[![Bootstrap](https://img.shields.io/badge/Bootstrap-5.3-7952B3?style=flat-square&logo=bootstrap&logoColor=white)](https://getbootstrap.com/)
[![Status](https://img.shields.io/badge/Status-Em%20Produção-success?style=flat-square)](.)
[![Licença](https://img.shields.io/badge/Licença-Uso%20Interno-red?style=flat-square)](.)

> Plataforma web modular para monitoramento em tempo real de operações hospitalares, com autenticação segura, controle de acesso granular por painel, integração com IA (Groq/Llama 3.3) e suporte a Progressive Web App (PWA).

---

## Índice

- [Visão Geral](#visão-geral)
- [Painéis Operacionais](#painéis-operacionais)
- [Arquitetura](#arquitetura)
- [Estrutura de Diretórios](#estrutura-de-diretórios)
- [Tecnologias](#tecnologias)
- [Instalação](#instalação)
- [Configuração](#configuração)
- [Inicialização](#inicialização)
- [API](#api)
- [Segurança](#segurança)
- [Deploy em Produção](#deploy-em-produção)
- [Troubleshooting](#troubleshooting)
- [Roadmap](#roadmap)
- [Licença](#licença)

---

## Visão Geral

Sistema desenvolvido para centralizar **24 painéis de monitoramento hospitalar** em uma plataforma única, segura e responsiva. Projetado para funcionar em monitores estáticos (TVs/displays de plantão) sem interação de mouse, com auto-scroll inteligente e atualização automática a cada 30 segundos.

A plataforma integra dados do sistema **Tasy (Oracle)** via ETL com **Apache Hop**, expõe-os via API Flask/PostgreSQL, e aplica análise de risco clínico com **Inteligência Artificial** (Groq API / Llama 3.3 70B).

### Destaques

| Recurso | Detalhe |
|---------|---------|
| Atualização automática | A cada 30 segundos (sem recarregar a página) |
| IA embarcada | Análise de risco clínico 24/7 via Groq API |
| Painéis operacionais | 24 painéis modulares e independentes |
| Controle de acesso | RBAC com permissões granulares por painel |
| PWA | Instalável como app, suporte offline |
| ETL integrado | Apache Hop: Oracle (Tasy) → PostgreSQL |
| Segurança | bcrypt, prepared statements, HSTS, CSP, rate limiting |
| Ambientes | Configurações separadas para dev / homologação / produção |

---

## Painéis Operacionais

| # | Nome | Descrição |
|---|------|-----------|
| **Painel 2** | Evolução de Turno | Acompanhamento de evoluções médicas e de enfermagem por turno |
| **Painel 3** | Médicos PS | Médicos logados e ativos no Pronto Socorro |
| **Painel 4** | Ocupação Hospitalar | Taxa de ocupação de leitos por setor |
| **Painel 5** | Cirurgias do Dia | Cirurgias agendadas, em andamento e finalizadas |
| **Painel 6** | Priorização Clínica IA | Análise inteligente de risco clínico com IA (Groq/Llama 3.3) |
| **Painel 7** | Detecção de Sepse | Monitoramento de critérios de sepse por paciente |
| **Painel 8** | Situação dos Pacientes | Visão geral do status dos pacientes internados |
| **Painel 9** | Laboratório Pendentes | Exames laboratoriais pendentes por setor |
| **Painel 10** | Análise PS | Análise operacional do Pronto Socorro |
| **Painel 11** | Internação PS | Pacientes aguardando internação vindos do PS |
| **Painel 12** | Ocupação e Produção | Métricas de ocupação e produtividade |
| **Painel 13** | Mapa de Nutrição | Planejamento e controle nutricional dos pacientes |
| **Painéis 14–24** | Em expansão | Novos painéis em desenvolvimento e implantação |

---

## Arquitetura

```
┌──────────────────────────────────────────────────────────────┐
│                  Cliente (Browser / TV Display)              │
│                  Progressive Web App (PWA)                   │
└──────────────────────────────┬───────────────────────────────┘
                               │ HTTPS / HTTP
                               ▼
┌──────────────────────────────────────────────────────────────┐
│                  Flask Application (app.py)                  │
│                                                              │
│  ┌─────────────────┐  ┌──────────────────┐  ┌────────────┐  │
│  │  Autenticação   │  │  Rotas / Blueprints│  │ Middleware │  │
│  │  (bcrypt +      │  │  27 blueprints     │  │ CORS, CSP, │  │
│  │   sessões)      │  │  (core + painéis)  │  │ Rate Limit │  │
│  └─────────────────┘  └──────────────────┘  └────────────┘  │
│                                                              │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  API RESTful — Endpoints JSON por painel             │   │
│  └──────────────────────────────────────────────────────┘   │
└──────────────────────────────┬───────────────────────────────┘
                               │
                               ▼
┌──────────────────────────────────────────────────────────────┐
│                  PostgreSQL Database                         │
│                                                              │
│   usuarios · permissoes_paineis · historico_usuarios         │
│   evolucao_turno · medicos_ps · ocupacao_leitos              │
│   cirurgias · painel_clinico_tasy · painel_clinico_analise_ia│
│   setores_hospital · (+ tabelas dos painéis 8–24)           │
└───────────┬──────────────────────────────────────────────────┘
            ▲                          ▲
            │                          │
  ┌─────────┴──────────┐    ┌──────────┴───────────────┐
  │    Apache Hop      │    │   Workers Background      │
  │    (ETL)           │    │                           │
  │                    │    │  ia_risk_analyzer_groq.py │
  │  Oracle (Tasy) ──► │    │  painel7_sepse_worker.py  │
  │  PostgreSQL        │    │  (Groq API / Llama 3.3)   │
  └────────────────────┘    └───────────────────────────┘
```

### Fluxo de Dados

1. **ETL (Apache Hop)**: Extrai dados do Oracle (Tasy) e carrega no PostgreSQL a cada ciclo configurado.
2. **Workers Background**: Executam análise de IA de forma assíncrona, gravando resultados no banco.
3. **API Flask**: Lê o PostgreSQL e serve JSON para o frontend.
4. **Frontend**: Consome a API via Fetch API, atualiza a tela sem reload.

---

## Estrutura de Diretórios

```
Projeto_Painel_Main/
│
├── app.py                          # Ponto de entrada Flask (27 blueprints)
├── config.py                       # Configurações: Development / Homologation / Production
├── manifest.json                   # Manifesto PWA
├── sw.js                           # Service Worker (suporte offline)
├── .env                            # Variáveis de ambiente (NÃO versionar)
│
├── backend/
│   ├── app_factory.py              # Padrão Factory para criação do app
│   ├── auth.py                     # Autenticação, bcrypt, validação de senha
│   ├── database.py                 # Conexão PostgreSQL com pool e retry
│   ├── logging_config.py           # Configuração de logging
│   ├── user_management.py          # CRUD de usuários e permissões
│   ├── ia_risk_analyzer_groq.py    # Worker IA: análise de risco clínico (Groq)
│   ├── painel7_sepse_worker.py     # Worker: detecção de critérios de sepse
│   ├── requirements.txt            # Dependências Python
│   │
│   ├── middleware/
│   │   ├── decorators.py           # @login_required, @admin_required
│   │   ├── error_handlers.py       # Handlers globais de erro (4xx, 5xx)
│   │   ├── rate_limiter.py         # Proteção contra DDoS / abuso
│   │   └── security.py             # Headers: CORS, HSTS, CSP, X-Frame-Options
│   │
│   └── routes/
│       ├── auth_routes.py          # POST /api/login, POST /api/logout
│       ├── main_routes.py          # GET / (dashboard, redirect)
│       ├── pwa_routes.py           # Endpoints de suporte PWA
│       ├── admin_routes.py         # /api/admin/* (gestão de usuários)
│       ├── painel2_routes.py       # Evolução de Turno
│       ├── painel3_routes.py       # Médicos PS
│       ├── painel4_routes.py       # Ocupação Hospitalar
│       ├── painel5_routes.py       # Cirurgias do Dia
│       ├── painel6_routes.py       # Priorização Clínica IA
│       ├── painel7_routes.py       # Detecção Sepse
│       ├── painel8_routes.py       # Situação Pacientes
│       ├── painel9_routes.py       # Laboratório Pendentes
│       ├── painel10_routes.py      # Análise PS
│       ├── painel11_routes.py      # Internação PS
│       ├── painel12_routes.py      # Ocupação e Produção
│       ├── painel13_routes.py      # Mapa de Nutrição
│       └── painel14_routes.py …    # Painéis 14–24
│
├── frontend/
│   ├── login.html / login.css / login.js
│   ├── dashboard.html / dashboard.css / dashboard.js
│   ├── admin-usuarios.html / admin-usuarios.css / admin-usuarios.js
│   ├── acesso-negado.html
│   └── offline.html                # Fallback offline (PWA)
│
├── paineis/
│   ├── painel2/
│   │   ├── index.html
│   │   ├── style.css
│   │   ├── main.js
│   │   └── app.py                  # Rota local (alguns painéis têm app.py próprio)
│   ├── painel3/ … painel24/        # Mesma estrutura
│
├── static/
│   └── img/
│       ├── logo.png                # Logo Hospital Anchieta
│       └── favicon.png
│
├── logs/
│   ├── painel.log                  # Log principal Flask
│   ├── worker_ia.log               # Log do worker de IA
│   ├── service-stdout.log
│   └── service-stderr.log
│
├── scripts/
│   └── limpar_logs.py              # Utilitário de limpeza de logs antigos
│
├── start_all_limpo.ps1             # Inicia Flask + Worker IA (PowerShell)
├── stop_all_limpo.ps1              # Para todos os serviços
├── start_server.bat                # Inicia Flask (Batch simples)
├── health-check.ps1                # Verifica saúde dos serviços
├── configurar-health-check.ps1     # Configura agendamento no Windows
├── instalar-servico.ps1            # Instala como serviço Windows
│
├── tabelas.txt                     # Schema SQL das tabelas
├── queries.txt                     # Exemplos de queries
├── DOCUMENTACAO_TECNICA.docx       # Documentação técnica detalhada
└── MANUAL_MANUTENCAO.docx          # Manual de manutenção operacional
```

---

## Tecnologias

### Backend

| Tecnologia | Versão | Função |
|------------|--------|--------|
| Python | 3.8+ | Linguagem principal |
| Flask | 3.0.0 | Framework web |
| PostgreSQL | 12+ | Banco de dados relacional |
| psycopg2 | 2.9.9 | Driver PostgreSQL |
| bcrypt | 4.1.2 | Hash de senhas |
| python-dotenv | 1.0.0 | Gerenciamento de variáveis de ambiente |
| Flask-CORS | 4.0.0 | Controle de CORS |
| Gunicorn | 21.2.0 | Servidor WSGI (produção) |
| Requests | 2.31.0 | Requisições HTTP para APIs externas |

### Frontend

| Tecnologia | Versão | Função |
|------------|--------|--------|
| HTML5 / CSS3 / JavaScript | ES6+ | Interface do usuário |
| Bootstrap | 5.3.0 | Framework CSS responsivo |
| Font Awesome | 6.4.0 | Biblioteca de ícones |
| Fetch API | Nativa | Requisições AJAX assíncronas |
| Service Worker | - | Suporte offline (PWA) |

### Inteligência Artificial

| Tecnologia | Modelo | Função |
|------------|--------|--------|
| Groq API | Llama 3.3 70B Versatile | Análise de risco clínico em tempo real |
| Groq API | Llama 3.3 70B Versatile | Detecção de critérios de sepse |

### Infraestrutura

| Tecnologia | Função |
|------------|--------|
| Apache Hop | ETL: Oracle (Tasy) → PostgreSQL |
| Nginx | Reverse proxy (recomendado em produção) |
| Systemd | Gerenciamento de serviços (Linux) |
| Docker | Suporte a containerização |

---

## Instalação

### Pré-requisitos

- Python 3.8 ou superior
- PostgreSQL 12 ou superior
- Git
- Apache Hop 2.x (para ETL — opcional no ambiente de desenvolvimento)

### 1. Clone o repositório

```bash
git clone https://github.com/seu-usuario/projeto_painel.git
cd projeto_painel
```

### 2. Crie e ative o ambiente virtual

```bash
# Windows
python -m venv .venv
.venv\Scripts\activate

# Linux / Mac
python3 -m venv .venv
source .venv/bin/activate
```

### 3. Instale as dependências

```bash
pip install -r backend/requirements.txt
```

### 4. Configure as variáveis de ambiente

Crie o arquivo `.env` na raiz do projeto com base no exemplo abaixo:

```env
# Banco de dados
DB_HOST=localhost
DB_NAME=postgres
DB_USER=postgres
DB_PASSWORD=sua_senha_segura
DB_PORT=5432

# Flask
SECRET_KEY=gere_uma_chave_forte_aqui
FLASK_ENV=development

# APIs de IA
GROQ_API_KEY=sua_chave_groq
```

> Para gerar uma `SECRET_KEY` segura:
> ```bash
> python -c "import secrets; print(secrets.token_hex(32))"
> ```

### 5. Crie as tabelas no banco de dados

```bash
psql -U postgres -d postgres -f tabelas.txt
```

### 6. Verifique a conexão

```bash
python -c "from backend.database import get_connection; get_connection(); print('Conexão OK')"
```

### 7. Inicie o servidor

```bash
# Windows (recomendado — inicia Flask + Worker IA)
.\start_all_limpo.ps1

# Ou apenas Flask (desenvolvimento)
python app.py
```

Acesse: `http://localhost:5000`

---

## Configuração

O arquivo [config.py](config.py) define três ambientes. O ambiente ativo é selecionado pela variável `FLASK_ENV` no `.env`.

| Ambiente | FLASK_ENV | Características |
|----------|-----------|----------------|
| **Desenvolvimento** | `development` | DEBUG ativo, CORS aberto, sem rate limiting, logs verbose |
| **Homologação** | `homologation` | DEBUG desativado, segurança moderada, CORS flexível |
| **Produção** | `production` | HTTPS forçado, HSTS/CSP, CORS restrito, rate limiting (200 req/h) |

### Variáveis de ambiente completas

| Variável | Obrigatória | Descrição |
|----------|-------------|-----------|
| `DB_HOST` | Sim | Host do PostgreSQL |
| `DB_NAME` | Sim | Nome do banco |
| `DB_USER` | Sim | Usuário do banco |
| `DB_PASSWORD` | Sim | Senha do banco |
| `DB_PORT` | Sim | Porta (padrão: 5432) |
| `SECRET_KEY` | Sim | Chave secreta Flask (mínimo 32 chars) |
| `FLASK_ENV` | Sim | `development` / `homologation` / `production` |
| `GROQ_API_KEY` | Para IA | Chave da API Groq |
| `DATABASE_URL` | Docker | URL completa de conexão (substitui DB_*) |

---

## Inicialização

### Windows

```powershell
# Inicia Flask + Worker IA (recomendado)
.\start_all_limpo.ps1

# Para todos os serviços
.\stop_all_limpo.ps1

# Verificar saúde dos serviços
.\health-check.ps1

# Instalar como serviço Windows (requer admin)
.\instalar-servico.ps1
```

### Linux / Mac

```bash
# Iniciar com Gunicorn (produção)
gunicorn -w 4 -b 0.0.0.0:5000 app:app

# Worker IA em background
python backend/ia_risk_analyzer_groq.py &

# Worker Sepse em background
python backend/painel7_sepse_worker.py &
```

### Docker (em desenvolvimento)

```bash
docker compose up -d
```

---

## API

Todos os endpoints retornam JSON. Autenticação via sessão (cookie `session`).

### Autenticação

| Método | Endpoint | Descrição | Auth |
|--------|----------|-----------|------|
| `POST` | `/api/login` | Autenticar usuário | Não |
| `POST` | `/api/logout` | Encerrar sessão | Sim |
| `GET` | `/api/session` | Verificar sessão ativa | Sim |

**POST /api/login**
```json
// Request
{
  "username": "usuario",
  "password": "senha"
}

// Response 200
{
  "success": true,
  "user": {
    "id": 1,
    "nome": "Dr. João Silva",
    "is_admin": false,
    "paineis": [2, 4, 6]
  }
}

// Response 401
{
  "success": false,
  "message": "Credenciais inválidas"
}
```

### Administração (requer is_admin)

| Método | Endpoint | Descrição |
|--------|----------|-----------|
| `GET` | `/api/admin/usuarios` | Listar todos os usuários |
| `POST` | `/api/admin/usuarios` | Criar novo usuário |
| `PUT` | `/api/admin/usuarios/<id>` | Atualizar usuário |
| `DELETE` | `/api/admin/usuarios/<id>` | Remover usuário |
| `POST` | `/api/admin/usuarios/<id>/resetar-senha` | Resetar senha |
| `POST` | `/api/admin/usuarios/<id>/permissoes` | Atualizar permissões de painéis |

### Painéis

Cada painel expõe seus próprios endpoints sob o prefixo `/api/paineis/painel{N}/`:

| Painel | Prefixo | Exemplo de endpoint |
|--------|---------|---------------------|
| Painel 2 | `/api/paineis/painel2/` | `/api/paineis/painel2/evolucoes` |
| Painel 4 | `/api/paineis/painel4/` | `/api/paineis/painel4/ocupacao` |
| Painel 6 | `/api/paineis/painel6/` | `/api/paineis/painel6/analise-ia` |
| Painel 7 | `/api/paineis/painel7/` | `/api/paineis/painel7/sepse` |
| ... | ... | ... |

---

## Segurança

### Implementado

| Camada | Mecanismo |
|--------|-----------|
| Senhas | bcrypt com work factor 12 |
| SQL Injection | Prepared statements em todas as queries |
| CSRF | Cookies SameSite=Strict + verificação de origem |
| Session Hijacking | Cookies HttpOnly + Secure |
| Headers HTTP | HSTS, CSP, X-Frame-Options, X-Content-Type-Options |
| Rate Limiting | 200 requisições/hora por IP (produção) |
| CORS | Origem restrita por ambiente |
| Auditoria | Log completo de ações dos usuários |
| RBAC | Permissões granulares por painel por usuário |
| Timeout de sessão | 8 horas (configurável) |

### Boas práticas obrigatórias

- **Nunca versionar o `.env`** — ele está no `.gitignore`
- Usar `SECRET_KEY` com pelo menos 32 caracteres aleatórios
- Rotacionar as chaves de API periodicamente
- Manter PostgreSQL acessível apenas internamente (sem exposição pública)
- Usar HTTPS em produção (Nginx + Let's Encrypt ou certificado interno)

---

## Deploy em Produção

### Gunicorn + Nginx (Linux)

**1. Instalar Gunicorn:**
```bash
pip install gunicorn
```

**2. Iniciar com Gunicorn:**
```bash
gunicorn -w 4 -b 127.0.0.1:5000 --timeout 120 app:app
```

**3. Configuração Nginx (`/etc/nginx/sites-available/painel`):**
```nginx
server {
    listen 80;
    server_name painel.hospital.local;
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl;
    server_name painel.hospital.local;

    ssl_certificate     /etc/ssl/certs/hospital.crt;
    ssl_certificate_key /etc/ssl/private/hospital.key;

    location / {
        proxy_pass         http://127.0.0.1:5000;
        proxy_set_header   Host $host;
        proxy_set_header   X-Real-IP $remote_addr;
        proxy_set_header   X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto $scheme;
    }

    location /static/ {
        alias /opt/painel/static/;
        expires 1y;
        add_header Cache-Control "public, immutable";
    }
}
```

**4. Systemd (`/etc/systemd/system/painel.service`):**
```ini
[Unit]
Description=Sistema de Painéis Hospitalares
After=network.target postgresql.service

[Service]
User=painel
WorkingDirectory=/opt/painel
EnvironmentFile=/opt/painel/.env
ExecStart=/opt/painel/.venv/bin/gunicorn -w 4 -b 127.0.0.1:5000 app:app
ExecStartPost=/opt/painel/.venv/bin/python backend/ia_risk_analyzer_groq.py
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl enable painel
sudo systemctl start painel
```

### Windows (produção atual)

```powershell
# Iniciar serviços
.\start_all_limpo.ps1

# Configurar reinício automático (Agendador de Tarefas)
.\configurar-health-check.ps1
```

---

## Troubleshooting

### Erro de conexão com banco

```
psycopg2.OperationalError: could not connect to server
```

**Verificar:**
```bash
# Status do PostgreSQL (Linux)
sudo systemctl status postgresql

# Windows
Get-Service postgresql*

# Testar conexão direta
psql -h localhost -U postgres -d postgres
```

Checar variáveis `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD` no `.env`.

---

### Erro 403 — Acesso Negado ao painel

O usuário existe mas não tem permissão para o painel solicitado.

**Solução:** Acessar o painel Admin (`/admin-usuarios`) e adicionar a permissão para o painel desejado.

---

### Worker IA não analisa pacientes

**Verificar:**
```bash
# Ver log do worker
tail -f logs/worker_ia.log

# Checar se a GROQ_API_KEY está configurada
echo $GROQ_API_KEY  # Linux
$env:GROQ_API_KEY   # PowerShell
```

A API do Groq tem limite de **6000 tokens/minuto** no plano gratuito. Se houver muitos pacientes, a análise será feita em filas automáticas.

---

### Página em branco após login

Causa comum: sessão expirada ou cookie bloqueado pelo browser.

**Soluções:**
- Limpar cookies do browser
- Verificar se `SECRET_KEY` não mudou desde o último login
- Verificar logs: `tail -f logs/painel.log`

---

### Auto-scroll não funciona no painel

Verificar se o script de auto-scroll está carregado e se a página tem altura suficiente para rolar. Configurar velocidade via variável `SCROLL_SPEED` no JS do painel.

---

### Porta 5000 já em uso

```bash
# Linux
lsof -i :5000
kill -9 <PID>

# Windows PowerShell
netstat -ano | findstr :5000
Stop-Process -Id <PID> -Force

# Ou usar o script
.\stop_all_limpo.ps1
```

---

### Logs crescendo excessivamente

```bash
python scripts/limpar_logs.py
```

O script remove logs com mais de 30 dias (configurável).

---

## Roadmap

### v2.0 — Em Planejamento

- [ ] Notificações push via WebSocket para alertas críticos
- [ ] Dashboard gerencial com KPIs consolidados
- [ ] Exportação de relatórios em PDF
- [ ] Integração com sistema de chamadas de enfermagem
- [ ] Painel de métricas de qualidade hospitalar (IQIH)

### v3.0 — Visão Futura

- [ ] App mobile nativo (React Native)
- [ ] IA para previsão de ocupação de leitos (machine learning)
- [ ] Integração com prontuário eletrônico (FHIR/HL7)
- [ ] Multi-hospital (suporte a rede de unidades)
- [ ] Alertas automáticos por e-mail / WhatsApp

---

## Licença

**Uso interno — Hospital Anchieta Ceilândia**

Este sistema foi desenvolvido exclusivamente para uso interno do Hospital Anchieta Ceilândia. É proibida a redistribuição, cópia ou uso comercial sem autorização expressa.

---

*Desenvolvido para o Hospital Anchieta Ceilândia · Atualizado em março de 2026*
