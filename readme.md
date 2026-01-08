# 🏥 Sistema de Painéis Hospitalares

[![Python](https://img.shields.io/badge/Python-3.8%2B-blue.svg)](https://www.python.org/)
[![Flask](https://img.shields.io/badge/Flask-3.0-green.svg)](https://flask.palletsprojects.com/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-12%2B-336791.svg)](https://www.postgresql.org/)
[![Groq](https://img.shields.io/badge/Groq-Llama%203.3-orange.svg)](https://groq.com/)

> Sistema web modular para monitoramento em tempo real de operações hospitalares com autenticação, controle de acesso e inteligência artificial.


---

## 📋 Índice

- [Visão Geral](#-visão-geral)
- [Funcionalidades](#-funcionalidades)
- [Arquitetura](#-arquitetura)
- [Tecnologias](#-tecnologias)
- [Instalação](#-instalação)
- [Configuração](#-configuração)
- [Painéis Disponíveis](#-painéis-disponíveis)
- [Uso](#-uso)
- [API](#-api)
- [Segurança](#-segurança)
- [Deploy](#-deploy)
- [Troubleshooting](#-troubleshooting)
- [Roadmap](#-roadmap)
- [Contribuição](#-contribuição)
- [Licença](#-licença)

---

## 🎯 Visão Geral

Sistema desenvolvido para centralizar múltiplos painéis de monitoramento hospitalar em uma plataforma única, segura e responsiva. Projetado para funcionar em monitores estáticos (TV/displays) sem interação de mouse, com auto-scroll inteligente e atualização automática.

### ⚡ Destaques

- **Tempo Real**: Atualização automática a cada 30 segundos
- **IA Integrada**: Priorização clínica com Groq API (Llama 3.3 70B)
- **Modular**: Arquitetura plugável para novos painéis
- **Seguro**: Autenticação bcrypt + proteção SQL injection
- **Responsivo**: Adapta-se a qualquer tamanho de tela
- **ETL Integrado**: Apache Hop para sincronização com sistema Tasy (Oracle)

### 📊 Estatísticas do Projeto

- **7 Painéis** operacionais
- **Suporte a múltiplos usuários** com permissões granulares
- **Worker IA** executando análise clínica 24/7
- **Auto-scroll** inteligente para monitores estáticos

---

## ✨ Funcionalidades

### 🔐 Autenticação e Controle de Acesso

- Sistema de login com sessões seguras (Flask-Session)
- Senhas criptografadas com **bcrypt**
- Usuários **admin** e **comuns**
- **Permissões granulares** por painel
- Histórico completo de ações dos usuários
- Reset de senha por administradores
- Proteção contra ataques:
  - SQL Injection (prepared statements + whitelist)
  - CSRF (tokens de sessão)
  - Session hijacking (cookies httpOnly)

### 📊 Painéis Operacionais

| Painel | Descrição | Funcionalidades |
|--------|-----------|-----------------|
| **Painel 2** | Evolução de Turno | Acompanhamento de evoluções médicas e de enfermagem |
| **Painel 3** | Médicos PS | Monitoramento de médicos logados no Pronto Socorro |
| **Painel 4** | Ocupação Hospitalar | Monitoramento de leitos por setor e taxa de ocupação |
| **Painel 5** | Cirurgias do Dia | Acompanhamento de cirurgias agendadas e status |
| **Painel 6** | Priorização Clínica IA | Análise inteligente de risco clínico com IA |
| **Painel 7** | Procedimentos Pendentes | Controle de procedimentos e exames laboratoriais |
| **Painel 9** | Laboratório por Setor | Exames laboratoriais pendentes organizados por setor |

### 🤖 Inteligência Artificial

- **Motor**: Groq API (Llama 3.3 70B Versatile)
- **Função**: Análise de risco clínico em tempo real
- **Entrada**: Sinais vitais, exames laboratoriais, histórico
- **Saída**: 
  - Classificação de criticidade (Crítico/Alto/Moderado/Baixo)
  - Pontos de atenção priorizados
  - Recomendações clínicas
- **Performance**: ~2s por análise
- **Custo**: API gratuita (6000 tokens/min)

### 🎨 Interface Moderna

- Design responsivo com **Bootstrap 5**
- Cores institucionais (vermelho/branco Hospital Anchieta)
- **Auto-scroll configurável** para monitores estáticos
- Filtros dinâmicos em tempo real
- Loading states elegantes
- Animações suaves de transição
- Badges de status coloridos
- Ícones Font Awesome

---

## 🏗️ Arquitetura

### Diagrama de Arquitetura

```
┌─────────────────────────────────────────────────────────┐
│                    Cliente Web                          │
│                  (Browser/TV Display)                   │
└────────────────────────┬────────────────────────────────┘
                         │ HTTPS
                         ▼
┌─────────────────────────────────────────────────────────┐
│              Flask Application (app.py)                 │
│  ┌─────────────────────────────────────────────────┐   │
│  │  Autenticação & Sessões (Flask-Session)         │   │
│  └─────────────────────────────────────────────────┘   │
│  ┌─────────────────────────────────────────────────┐   │
│  │  Rotas de Painéis (7 painéis modulares)        │   │
│  └─────────────────────────────────────────────────┘   │
│  ┌─────────────────────────────────────────────────┐   │
│  │  API RESTful (JSON endpoints)                   │   │
│  └─────────────────────────────────────────────────┘   │
│  ┌─────────────────────────────────────────────────┐   │
│  │  Gestão de Usuários (CRUD + Permissões)        │   │
│  └─────────────────────────────────────────────────┘   │
└────────────────────────┬────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────┐
│            PostgreSQL Database (postgres)               │
│  ┌──────────────────────────────────────────────────┐  │
│  │  Tabelas:                                        │  │
│  │  • usuarios                                      │  │
│  │  • permissoes_paineis                           │  │
│  │  • historico_usuarios                           │  │
│  │  • evolucao_turno                               │  │
│  │  • medicos_ps                                   │  │
│  │  • ocupacao_leitos                              │  │
│  │  • cirurgias                                    │  │
│  │  • painel_clinico_tasy                          │  │
│  │  • painel_clinico_analise_ia                    │  │
│  │  • setores_hospital                             │  │
│  └──────────────────────────────────────────────────┘  │
└────────────────┬────────────────────────────────────────┘
                 ▲
                 │
    ┌────────────┴─────────────┐
    │                          │
┌───▼──────────────┐  ┌────────▼─────────────┐
│  Apache Hop      │  │  Worker IA (Groq)    │
│  (ETL)           │  │  ia_risk_analyzer    │
│                  │  │  _groq.py            │
│  Oracle DB ──►   │  │                      │
│  Tasy System     │  │  Análise Clínica     │
│                  │  │  Llama 3.3 70B       │
└──────────────────┘  └──────────────────────┘
```

### 📁 Estrutura de Diretórios

```
projeto_painel/
│
├── app.py                          # ⚙️ Aplicação Flask principal
├── config.py                       # 🔧 Configurações dev/prod
├── requirements.txt                # 📦 Dependências Python
├── .env                           # 🔐 Variáveis de ambiente (não versionar)
├── .env.example                   # 📝 Template de configuração
├── .gitignore                     # 🚫 Arquivos ignorados
│
├── backend/
│   ├── __init__.py
│   ├── auth.py                    # 🔐 Sistema de autenticação
│   ├── database.py                # 🗄️ Conexão com PostgreSQL
│   ├── user_management.py         # 👥 CRUD de usuários
│   ├── ia_risk_analyzer_groq.py   # 🤖 Worker de análise IA (Groq)
│   ├── test_user_management.py    # 🧪 Testes de usuários
│   └── requirements.txt           # 📦 Dependências específicas
│
├── frontend/
│   ├── login.html                 # 🔑 Página de login
│   ├── login.css
│   ├── login.js
│   ├── dashboard.html             # 📊 Dashboard principal
│   ├── dashboard.css
│   ├── dashboard.js
│   ├── admin-usuarios.html        # 👤 Gestão de usuários
│   ├── admin-usuarios.css
│   ├── admin-usuarios.js
│   └── acesso-negado.html         # 🚫 Página de acesso negado
│
├── paineis/
│   ├── painel2/                   # 📋 Evolução de Turno
│   │   ├── index.html
│   │   ├── style.css
│   │   └── main.js
│   │
│   ├── painel3/                   # 👨‍⚕️ Médicos PS
│   ├── painel4/                   # 🏥 Ocupação Hospitalar
│   ├── painel5/                   # 🔪 Cirurgias do Dia
│   ├── painel6/                   # 🤖 Priorização Clínica IA
│   ├── painel7/                   # 📝 Procedimentos Pendentes
│   └── painel9/                   # 🧪 Laboratório por Setor
│
├── static/
│   └── img/
│       ├── logo.png               # 🏥 Logo Hospital Anchieta
│       └── favicon.png
│
├── logs/                          # 📝 Logs do sistema
│   ├── painel.log
│   └── worker_ia.log
│
├── scripts/
│   ├── start_all_limpo.ps1       # 🚀 Inicialização Windows
│   ├── start_all.sh              # 🚀 Inicialização Linux
│   └── generate_secret_key.py    # 🔑 Gerar SECRET_KEY
│
└── docs/
    ├── tabelas.txt               # 📋 Estrutura do banco (SQL)
    ├── API.md                    # 📡 Documentação da API
    └── INSTALL.md                # 📘 Guia de instalação detalhado
```

---

## 🛠️ Tecnologias

### Backend

| Tecnologia | Versão | Uso |
|------------|--------|-----|
| **Python** | 3.8+ | Linguagem principal |
| **Flask** | 3.0.0 | Framework web |
| **PostgreSQL** | 12+ | Banco de dados relacional |
| **psycopg2** | 2.9.9 | Driver PostgreSQL |
| **bcrypt** | 4.1.2 | Criptografia de senhas |
| **python-dotenv** | 1.0.0 | Gerenciamento de variáveis de ambiente |
| **Flask-CORS** | 4.0.0 | Suporte a CORS |

### Frontend

| Tecnologia | Versão | Uso |
|------------|--------|-----|
| **HTML5/CSS3/JavaScript** | ES6+ | Interface do usuário |
| **Bootstrap** | 5.3.0 | Framework CSS |
| **Font Awesome** | 6.4.0 | Ícones |
| **Fetch API** | Nativa | Requisições AJAX |

### Inteligência Artificial

| Tecnologia | Modelo | Uso |
|------------|--------|-----|
| **Groq API** | Llama 3.3 70B Versatile | Análise clínica de risco |

### Infraestrutura

| Tecnologia | Uso |
|------------|-----|
| **Apache Hop** | ETL para sincronização Oracle → PostgreSQL |
| **Gunicorn** | Servidor WSGI para produção |
| **Nginx** | Reverse proxy (recomendado) |
| **Systemd** | Gerenciamento de serviços Linux |

---

## 🚀 Instalação

### Pré-requisitos

Antes de começar, certifique-se de ter instalado:

- **Python**: 3.8 ou superior ([Download](https://www.python.org/downloads/))
- **PostgreSQL**: 12 ou superior ([Download](https://www.postgresql.org/download/))
- **Git**: Para clonar o repositório ([Download](https://git-scm.com/downloads))
- **Apache Hop**: 2.x para ETL (opcional) ([Download](https://hop.apache.org/))

### 1️⃣ Clone o Repositório

```bash
git clone https://github.com/seu-usuario/projeto_painel.git
cd projeto_painel
```

### 2️⃣ Crie o Ambiente Virtual

```bash
# Windows
python -m venv .venv
.venv\Scripts\activate

# Linux/Mac
python3 -m venv .venv
source .venv/bin/activate
```

### 3️⃣ Instale as Dependências

```bash
pip install -r requirements.txt
```

**Dependências instaladas:**
```
Flask==3.0.0
Flask-Cors==4.0.0
psycopg2-binary==2.9.9
python-dotenv==1.0.0
bcrypt==4.1.2
groq==0.4.0
```

### 4️⃣ Configure o Banco de Dados PostgreSQL

#### Criar o banco:

```bash
# Entre no PostgreSQL
psql -U postgres

# Crie o banco (se necessário)
CREATE DATABASE postgres;

# Saia do psql
\q
```

#### Executar scripts de criação de tabelas:

```bash
# No terminal, execute:
psql -U postgres -d postgres -f docs/tabelas.txt
```

Ou copie e cole o conteúdo de `docs/tabelas.txt` diretamente no pgAdmin ou DBeaver.

**Tabelas criadas:**
- `usuarios`
- `permissoes_paineis`
- `historico_usuarios`
- `setores_hospital`
- `painel_clinico_tasy`
- `painel_clinico_analise_ia`

### 5️⃣ Configure as Variáveis de Ambiente

```bash
# Copie o template
cp .env.example .env

# Edite o arquivo .env
nano .env  # ou use seu editor favorito
```

**Exemplo de `.env`:**

```env
# =============================================
# AMBIENTE
# =============================================
FLASK_ENV=development
# Opções: development | production

# =============================================
# SEGURANÇA
# =============================================
SECRET_KEY=sua-chave-secreta-aqui-minimo-32-caracteres
# Gere com: python scripts/generate_secret_key.py

# =============================================
# BANCO DE DADOS
# =============================================
DB_HOST=localhost
DB_NAME=postgres
DB_USER=postgres
DB_PASSWORD=SUA_SENHA_SEGURA_AQUI
DB_PORT=5432

# =============================================
# API GROQ (IA)
# =============================================
GROQ_API_KEY=gsk_sua_chave_groq_aqui
# Obtenha em: https://console.groq.com/keys
```

### 6️⃣ Gere uma SECRET_KEY Segura

```bash
python scripts/generate_secret_key.py
```

Copie a chave gerada e cole no arquivo `.env`.

### 7️⃣ Crie o Primeiro Usuário Administrador

```bash
# Execute o script de criação de usuário
python -c "
from backend.auth import criar_usuario
criar_usuario('admin', 'senha123', 'admin@hospital.com', is_admin=True)
print('✅ Usuário admin criado com sucesso!')
"
```

---

## ⚙️ Configuração

### Configuração de Desenvolvimento vs Produção

O sistema utiliza dois arquivos de configuração em `config.py`:

#### Modo Desenvolvimento (`development`)

```python
DEBUG = True
SESSION_COOKIE_SECURE = False  # Permite HTTP
LOG_LEVEL = 'DEBUG'
SEND_FILE_MAX_AGE_DEFAULT = 0  # Sem cache
```

#### Modo Produção (`production`)

```python
DEBUG = False
SESSION_COOKIE_SECURE = True   # Exige HTTPS
LOG_LEVEL = 'WARNING'
SEND_FILE_MAX_AGE_DEFAULT = 31536000  # Cache de 1 ano
```

Para alternar entre os modos, edite o arquivo `.env`:

```env
FLASK_ENV=production  # ou development
```

### Configuração de CORS

O sistema está configurado para aceitar requisições de qualquer origem:

```python
# config.py
CORS_ORIGINS = "*"
CORS_SUPPORTS_CREDENTIALS = True
```

Para restringir em produção:

```python
CORS_ORIGINS = ["https://seu-dominio.com.br"]
```

### Configuração de Sessão

```python
PERMANENT_SESSION_LIFETIME = 28800  # 8 horas
SESSION_COOKIE_HTTPONLY = True      # Previne XSS
SESSION_COOKIE_SAMESITE = 'Lax'     # Previne CSRF
```

---

## 💻 Uso

### Iniciar o Sistema (Desenvolvimento)

#### Windows:

```powershell
# Execute o script de inicialização
.\scripts\start_all_limpo.ps1
```

Ou manualmente:

```powershell
# Terminal 1 - Flask
python app.py

# Terminal 2 - Worker IA (opcional)
python backend\ia_risk_analyzer_groq.py
```

#### Linux/Mac:

```bash
# Execute o script de inicialização
bash scripts/start_all.sh
```

Ou manualmente:

```bash
# Terminal 1 - Flask
python3 app.py

# Terminal 2 - Worker IA (opcional)
python3 backend/ia_risk_analyzer_groq.py
```

### Acessar o Sistema

Após iniciar, acesse:

```
http://localhost:5000
```

**Credenciais padrão:**
- **Usuário**: `admin`
- **Senha**: `senha123`

⚠️ **IMPORTANTE**: Altere a senha padrão imediatamente após o primeiro login!

### Parar o Sistema

#### Windows:
```powershell
# Pressione Ctrl+C em cada terminal
```

#### Linux/Mac:
```bash
# Pressione Ctrl+C em cada terminal
# Ou mate os processos:
kill $(cat pids/flask.pid)
kill $(cat pids/worker.pid)
```

---

## 📡 API

### Autenticação

#### POST `/api/login`

Autentica um usuário e cria uma sessão.

**Request:**
```json
{
  "usuario": "admin",
  "senha": "senha123"
}
```

**Response (Sucesso):**
```json
{
  "success": true,
  "usuario": "admin",
  "is_admin": true
}
```

**Response (Erro):**
```json
{
  "success": false,
  "error": "Usuário ou senha inválidos"
}
```

#### POST `/api/logout`

Encerra a sessão do usuário.

**Response:**
```json
{
  "success": true,
  "message": "Logout realizado com sucesso"
}
```

---

### Painéis

Todas as rotas de painéis exigem autenticação (`@login_required`).

#### GET `/api/paineis/painel2/evolucoes`

Retorna lista de evoluções de turno.

**Query Parameters:**
- `setor` (opcional): Filtrar por setor
- `status` (opcional): Filtrar por status (Feita/Pendente)

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "nr_atendimento": 12345,
      "nm_pessoa_fisica": "João Silva",
      "cd_leito": "101-A",
      "evol_medico": "Sim",
      "evol_enfermeiro": "Não",
      "dt_entrada_unidade": "2025-01-08"
    }
  ],
  "total": 15,
  "timestamp": "2025-01-08T14:30:00"
}
```

#### GET `/api/paineis/painel6/lista`

Retorna pacientes para análise de IA.

**Query Parameters:**
- `limit` (padrão: 400): Número de registros
- `offset` (padrão: 0): Paginação

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "nr_atendimento": 12345,
      "nm_pessoa_fisica": "Maria Santos",
      "cd_leito": "UTI-05",
      "qt_pa_sistolica": 140,
      "qt_freq_cardiaca": 95,
      "exm_creatinina": "1.8",
      "nivel_criticidade": "Alto",
      "analise_ia": "Paciente com sinais de...",
      "recomendacoes": "1. Monitorar função renal..."
    }
  ],
  "total": 8,
  "timestamp": "2025-01-08T14:30:00"
}
```

---

### Administração de Usuários

Todas as rotas de administração exigem permissão de administrador (`@admin_required`).

#### GET `/api/admin/usuarios`

Lista todos os usuários.

**Query Parameters:**
- `incluir_inativos` (padrão: true): Incluir usuários inativos

**Response:**
```json
{
  "success": true,
  "usuarios": [
    {
      "id": 1,
      "usuario": "admin",
      "nome_completo": "Administrador do Sistema",
      "email": "admin@hospital.com",
      "cargo": "Administrador",
      "is_admin": true,
      "ativo": true,
      "criado_em": "2025-01-01T10:00:00",
      "ultimo_acesso": "2025-01-08T14:25:00"
    }
  ],
  "total": 5
}
```

#### GET `/api/admin/usuarios/<id>`

Obtem detalhes de um usuário específico.

**Response:**
```json
{
  "success": true,
  "usuario": {
    "id": 1,
    "usuario": "admin",
    "nome_completo": "Administrador",
    "email": "admin@hospital.com",
    "cargo": "TI",
    "is_admin": true,
    "ativo": true,
    "observacoes": "Usuário principal do sistema",
    "criado_em": "2025-01-01T10:00:00",
    "ultimo_acesso": "2025-01-08T14:25:00",
    "atualizado_em": "2025-01-05T09:00:00",
    "atualizado_por": null
  }
}
```

#### PUT `/api/admin/usuarios/<id>`

Edita um usuário.

**Request:**
```json
{
  "nome_completo": "João Silva Santos",
  "email": "joao.silva@hospital.com",
  "cargo": "Enfermeiro",
  "is_admin": false,
  "observacoes": "Enfermeiro da UTI"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Usuário atualizado com sucesso"
}
```

#### POST `/api/admin/usuarios/<id>/resetar-senha`

Reseta a senha de um usuário.

**Request:**
```json
{
  "nova_senha": "NovaSenha123!"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Senha resetada com sucesso"
}
```

#### POST `/api/admin/usuarios/<id>/permissoes`

Adiciona permissão de painel para um usuário.

**Request:**
```json
{
  "painel_nome": "painel2"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Permissão adicionada com sucesso"
}
```

#### DELETE `/api/admin/usuarios/<id>/permissoes/<painel_nome>`

Remove permissão de painel de um usuário.

**Response:**
```json
{
  "success": true,
  "message": "Permissão removida com sucesso"
}
```

---

## 🔒 Segurança

### Medidas Implementadas

#### 1. Autenticação Segura

- **Bcrypt** para hash de senhas (work factor 12)
- Senhas nunca armazenadas em texto plano
- Sessões com timeout de 8 horas
- Cookies com flags `HttpOnly` e `SameSite`

```python
# Exemplo de verificação de senha
senha_hash = bcrypt.hashpw(senha.encode('utf-8'), bcrypt.gensalt())
bcrypt.checkpw(senha.encode('utf-8'), senha_hash)
```

#### 2. Proteção contra SQL Injection

- **Prepared statements** em todas as queries
- **Whitelist de campos** editáveis
- Validação rigorosa de entradas

```python
# Exemplo de query segura
cursor.execute(
    "SELECT * FROM usuarios WHERE usuario = %s",
    (usuario,)  # Parametrizado
)
```

#### 3. Controle de Acesso Baseado em Funções (RBAC)

- Decoradores `@login_required` e `@admin_required`
- Permissões granulares por painel
- Auditoria completa de ações

```python
@app.route('/api/admin/usuarios')
@admin_required  # Apenas admins podem acessar
def api_listar_usuarios():
    # ...
```

#### 4. Proteção de Sessão

- `SECRET_KEY` forte (mínimo 32 caracteres)
- Cookies seguros em produção (HTTPS only)
- Timeout automático de sessão
- Renovação de sessão em ações sensíveis

#### 5. Proteção contra CSRF

- Token de sessão único
- Verificação de origem (CORS configurável)
- SameSite cookies

#### 6. Validação de Entrada

```python
# Campos permitidos para edição (whitelist)
CAMPOS_EDITAVEIS = {
    'email',
    'nome_completo',
    'cargo',
    'is_admin',
    'observacoes',
    'ativo'
}
```

#### 7. Logging e Auditoria

- Todos os logins registrados
- Histórico de alterações de usuários
- Tentativas de acesso não autorizado logadas

```python
# Exemplo de log
app.logger.warning(f'Tentativa de acesso não autorizado: {request.url}')
```

### Checklist de Segurança para Produção

- [ ] Alterar `SECRET_KEY` padrão
- [ ] Usar senha forte do PostgreSQL
- [ ] Habilitar HTTPS
- [ ] Restringir CORS para domínios específicos
- [ ] Alterar credenciais de administrador padrão
- [ ] Configurar firewall para PostgreSQL (porta 5432)
- [ ] Desabilitar DEBUG mode (`FLASK_ENV=production`)
- [ ] Implementar rate limiting (Nginx/CloudFlare)
- [ ] Configurar backups automáticos do banco
- [ ] Monitorar logs regularmente

---

## 🚢 Deploy

### Deploy em Produção com Gunicorn

#### 1. Instalar Gunicorn

```bash
pip install gunicorn
```

#### 2. Iniciar com Gunicorn

```bash
gunicorn -w 4 -b 0.0.0.0:5000 --timeout 120 app:app
```

**Parâmetros:**
- `-w 4`: 4 workers (ajuste conforme CPU)
- `-b 0.0.0.0:5000`: Bind em todas as interfaces, porta 5000
- `--timeout 120`: Timeout de 120 segundos para requisições longas

### Nginx como Reverse Proxy

#### Configuração do Nginx

Crie o arquivo `/etc/nginx/sites-available/painel`:

```nginx
server {
    listen 80;
    server_name seu-dominio.com.br;

    # Redirecionar HTTP para HTTPS
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    server_name seu-dominio.com.br;

    # Certificado SSL (Let's Encrypt recomendado)
    ssl_certificate /etc/letsencrypt/live/seu-dominio.com.br/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/seu-dominio.com.br/privkey.pem;

    # Configurações SSL (Mozilla Intermediate)
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;
    ssl_prefer_server_ciphers on;

    # Proxy para Flask
    location / {
        proxy_pass http://127.0.0.1:5000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        
        # WebSocket support (se necessário no futuro)
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }

    # Servir arquivos estáticos diretamente
    location /static {
        alias /caminho/para/projeto_painel/static;
        expires 1y;
        add_header Cache-Control "public, immutable";
    }

    # Logs
    access_log /var/log/nginx/painel-access.log;
    error_log /var/log/nginx/painel-error.log;
}
```

#### Ativar o site:

```bash
sudo ln -s /etc/nginx/sites-available/painel /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

### Systemd Service

#### Serviço Flask

Crie `/etc/systemd/system/painel-flask.service`:

```ini
[Unit]
Description=Sistema de Painéis Hospitalares - Flask
After=network.target postgresql.service

[Service]
Type=notify
User=www-data
Group=www-data
WorkingDirectory=/var/www/projeto_painel
Environment="PATH=/var/www/projeto_painel/.venv/bin"
Environment="FLASK_ENV=production"
ExecStart=/var/www/projeto_painel/.venv/bin/gunicorn \
    -w 4 \
    -b 127.0.0.1:5000 \
    --timeout 120 \
    --access-logfile /var/log/painel/access.log \
    --error-logfile /var/log/painel/error.log \
    app:app

Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
```

#### Serviço Worker IA

Crie `/etc/systemd/system/painel-worker-ia.service`:

```ini
[Unit]
Description=Worker IA - Priorização Clínica
After=network.target postgresql.service painel-flask.service

[Service]
Type=simple
User=www-data
Group=www-data
WorkingDirectory=/var/www/projeto_painel
Environment="PATH=/var/www/projeto_painel/.venv/bin"
ExecStart=/var/www/projeto_painel/.venv/bin/python backend/ia_risk_analyzer_groq.py

Restart=always
RestartSec=10

StandardOutput=append:/var/log/painel/worker-ia.log
StandardError=append:/var/log/painel/worker-ia-error.log

[Install]
WantedBy=multi-user.target
```

#### Ativar os serviços:

```bash
# Criar diretório de logs
sudo mkdir -p /var/log/painel
sudo chown www-data:www-data /var/log/painel

# Recarregar systemd
sudo systemctl daemon-reload

# Habilitar inicialização automática
sudo systemctl enable painel-flask
sudo systemctl enable painel-worker-ia

# Iniciar os serviços
sudo systemctl start painel-flask
sudo systemctl start painel-worker-ia

# Verificar status
sudo systemctl status painel-flask
sudo systemctl status painel-worker-ia
```

### Monitoramento

```bash
# Ver logs em tempo real
sudo journalctl -u painel-flask -f
sudo journalctl -u painel-worker-ia -f

# Ver logs de hoje
sudo journalctl -u painel-flask --since today

# Reiniciar serviços
sudo systemctl restart painel-flask
sudo systemctl restart painel-worker-ia
```

---

## 🐛 Troubleshooting

### Problema: Erro de Conexão com Banco

```
❌ Erro ao conectar ao banco: connection refused
```

**Soluções:**

1. Verifique se PostgreSQL está rodando:
   ```bash
   sudo systemctl status postgresql
   ```

2. Teste a conexão manualmente:
   ```bash
   psql -U postgres -h localhost -d postgres
   ```

3. Verifique credenciais no `.env`

4. Confirme que o PostgreSQL aceita conexões:
   ```bash
   # Edite pg_hba.conf
   sudo nano /etc/postgresql/12/main/pg_hba.conf
   
   # Adicione:
   host    all    all    127.0.0.1/32    md5
   ```

---

### Problema: Erro 401 (Não Autenticado)

```
❌ Não autenticado
```

**Soluções:**

1. Limpe cookies do navegador (Ctrl+Shift+Del)

2. Faça logout e login novamente

3. Verifique se `SECRET_KEY` não mudou no `.env`

4. Confirme que a sessão não expirou (8 horas)

---

### Problema: Painel Não Carrega Dados

```
❌ Erro ao buscar dados
```

**Soluções:**

1. Verifique logs do Flask:
   ```bash
   tail -f logs/painel.log
   ```

2. Confirme que a tabela existe no banco:
   ```sql
   \dt
   SELECT * FROM painel_clinico_tasy LIMIT 1;
   ```

3. Teste a API manualmente:
   ```bash
   curl -b cookies.txt http://localhost:5000/api/paineis/painel2/evolucoes
   ```

4. Verifique permissões do usuário no painel:
   ```sql
   SELECT * FROM permissoes_paineis WHERE usuario_id = 1;
   ```

---

### Problema: Worker IA Não Executa

```
❌ Worker IA não está processando pacientes
```

**Soluções:**

1. Confirme que `GROQ_API_KEY` está configurada no `.env`

2. Verifique logs do worker:
   ```bash
   tail -f logs/worker_ia.log
   ```

3. Teste a API Groq manualmente:
   ```python
   from groq import Groq
   client = Groq(api_key="sua-chave")
   response = client.chat.completions.create(
       model="llama-3.3-70b-versatile",
       messages=[{"role": "user", "content": "Teste"}]
   )
   print(response)
   ```

4. Verifique limite de tokens (6000/min):
   - Aguarde 1 minuto e tente novamente

---

### Problema: Auto-scroll Não Funciona

```
❌ Auto-scroll não rola automaticamente
```

**Soluções:**

1. Pressione o botão "Auto Scroll" no cabeçalho do painel

2. Verifique console do navegador (F12) para erros JS

3. Confirme que há registros suficientes para scroll (>10)

4. Limpe cache do navegador (Ctrl+F5)

---

### Problema: SECRET_KEY Inválida

```
⚠️ SECRET_KEY não foi configurada!
```

**Solução:**

```bash
# Gere uma nova chave
python scripts/generate_secret_key.py

# Copie a saída e cole no .env
nano .env
# SECRET_KEY=chave-gerada-aqui
```

---

### Problema: Permissão Negada no PostgreSQL

```
❌ FATAL: password authentication failed
```

**Solução:**

```bash
# Altere a senha do usuário postgres
sudo -u postgres psql
ALTER USER postgres WITH PASSWORD 'nova_senha';
\q

# Atualize o .env
nano .env
# DB_PASSWORD=nova_senha
```

---

## 🗺️ Roadmap

### Versão 2.0 (Q2 2025)

- [ ] **Dashboard de Analytics**
  - Gráficos de uso dos painéis
  - Tempo médio de permanência
  - Usuários ativos simultâneos
  - Métricas de performance

- [ ] **Exportação de Dados**
  - Excel (openpyxl)
  - PDF (reportlab)
  - CSV com filtros aplicados

- [ ] **Notificações em Tempo Real**
  - WebSockets para alertas críticos
  - Push notifications para admins
  - Integração com WhatsApp/Email via API

- [ ] **App Mobile**
  - React Native para iOS/Android
  - Notificações push
  - Modo offline parcial

- [ ] **Cache Inteligente**
  - Redis para dados frequentes
  - Invalidação automática
  - Redução de 50% na carga do banco

### Versão 2.1 (Q3 2025)

- [ ] **Testes Automatizados**
  - pytest com fixtures
  - Coverage > 80%
  - CI/CD com GitHub Actions

- [ ] **Documentação Interativa**
  - Swagger/OpenAPI para API
  - Tutoriais em vídeo
  - Wiki interna

- [ ] **Módulo de Relatórios**
  - Relatórios agendados
  - Templates customizáveis
  - Envio automático por email

### Versão 3.0 (Q4 2025)

- [ ] **Painel 8: Faturamento**
  - Acompanhamento de contas médicas
  - Glosas e pendências

- [ ] **Painel 10: Farmácia**
  - Controle de medicamentos críticos
  - Alertas de estoque baixo

- [ ] **Integração com Sistemas Externos**
  - API RESTful pública
  - Webhooks para eventos
  - SSO (Single Sign-On)

---

## 👥 Contribuição

Contribuições são bem-vindas! Siga as diretrizes abaixo:

### Como Contribuir

1. **Fork** o repositório
2. Crie uma **branch** para sua feature:
   ```bash
   git checkout -b feature/nova-funcionalidade
   ```
3. **Commit** suas mudanças:
   ```bash
   git commit -am 'feat(painel7): adiciona filtro por data'
   ```
4. **Push** para a branch:
   ```bash
   git push origin feature/nova-funcionalidade
   ```
5. Abra um **Pull Request**

### Padrões de Código

- **Python**: PEP 8 ([guia](https://pep8.org/))
- **JavaScript**: ES6+ com Prettier
- **Commits**: [Conventional Commits](https://www.conventionalcommits.org/)

### Estrutura de Commit

```
tipo(escopo): mensagem curta

Descrição detalhada (opcional)

Closes #123
```

**Tipos:**
- `feat`: Nova funcionalidade
- `fix`: Correção de bug
- `docs`: Documentação
- `style`: Formatação
- `refactor`: Refatoração de código
- `test`: Testes
- `chore`: Manutenção

**Exemplos:**
```
feat(painel7): adiciona painel de exames laboratoriais
fix(auth): corrige validação de senha especial
docs(readme): atualiza instruções de deploy
style(dashboard): melhora responsividade mobile
refactor(database): otimiza conexão com pool
test(auth): adiciona testes de login
chore(deps): atualiza Flask para 3.0.1
```

---

## 📄 Licença

Este projeto é de **uso interno**

**Todos os direitos reservados.**

O código-fonte, documentação e assets são propriedade exclusiva e não podem ser reproduzidos, distribuídos ou utilizados sem autorização expressa por escrito.

---

## 📞 Suporte

Para dúvidas, problemas ou sugestões:

- **Email**: lucasrx6@gmail.com

---

## 👏 Agradecimentos

Desenvolvido com ❤️ pela equipe de TI do Hospital Anchieta Ceilândia.

**Tecnologias utilizadas:**
- [Flask](https://flask.palletsprojects.com/) - Framework web
- [PostgreSQL](https://www.postgresql.org/) - Banco de dados
- [Bootstrap](https://getbootstrap.com/) - Framework CSS
- [Groq](https://groq.com/) - API de IA
- [Apache Hop](https://hop.apache.org/) - ETL
---

## 📊 Estatísticas do Projeto

```
📁 Arquivos:           87
📄 Linhas de código:   ~12.000
🐍 Python:             65%
💻 JavaScript:         20%
🎨 HTML/CSS:           15%
⏱️ Tempo de dev:       6 meses
🏥 Painéis:            7 ativos
👥 Usuários:           50+
```

---

**Hospital Anchieta Ceilândia - Kora Saúde** 🏥  
*Cuidando de vidas com tecnologia e humanização*

---

**Versão**: 1.0.0  
**Última atualização**: Janeiro 2025  
**Status**: Em Produção ✅
