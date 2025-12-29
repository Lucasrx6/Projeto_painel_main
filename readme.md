# 🏥 Sistema de Painéis Hospitalares - Anchieta Ceilândia

[![Python](https://img.shields.io/badge/Python-3.8%2B-blue.svg)](https://www.python.org/)
[![Flask](https://img.shields.io/badge/Flask-3.0%2B-green.svg)](https://flask.palletsprojects.com/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-12%2B-336791.svg)](https://www.postgresql.org/)
[![License](https://img.shields.io/badge/License-Internal-red.svg)]()

> Sistema web modular para monitoramento em tempo real de operações hospitalares com autenticação, controle de acesso e inteligência artificial.

![Logo Anchieta Ceilândia](static/img/logo.png)

---

## 📋 Índice

- [Visão Geral](#-visão-geral)
- [Funcionalidades](#-funcionalidades)
- [Arquitetura](#-arquitetura)
- [Instalação](#-instalação)
- [Configuração](#-configuração)
- [Painéis Disponíveis](#-painéis-disponíveis)
- [API](#-api)
- [Segurança](#-segurança)
- [Deploy](#-deploy)
- [Contribuição](#-contribuição)
- [Troubleshooting](#-troubleshooting)
- [Roadmap](#-roadmap)

---

## 🎯 Visão Geral

Sistema desenvolvido para o Hospital Anchieta Ceilândia que centraliza múltiplos painéis de monitoramento hospitalar em uma plataforma única, segura e responsiva. Projetado para funcionar em monitores estáticos sem interação de mouse, com auto-scroll inteligente e refresh automático.

### ⚡ Destaques

- **Tempo Real**: Atualização automática a cada 30 segundos
- **IA Integrada**: Priorização clínica com Groq (Llama 3.3 70B)
- **Modular**: Arquitetura plugável para novos painéis
- **Seguro**: Autenticação bcrypt, CORS configurável, proteção SQL injection
- **Responsivo**: Adapta-se a qualquer tamanho de tela
- **ETL Integrado**: Apache Hop para sincronização de dados

---

## ✨ Funcionalidades

### 🔐 Autenticação e Controle de Acesso
- Sistema de login com sessões seguras (Flask-Session)
- Senhas criptografadas com bcrypt
- Usuários admin e comuns
- Permissões granulares por painel
- Histórico de ações dos usuários
- Reset de senha por administradores

### 📊 Painéis Operacionais

| Painel | Descrição | Status |
|--------|-----------|--------|
| **Painel 2** | Evolução de Turno | ✅ Ativo |
| **Painel 3** | Médicos PS | ✅ Ativo |
| **Painel 4** | Ocupação Hospitalar | ✅ Ativo |
| **Painel 5** | Cirurgias do Dia | ✅ Ativo |
| **Painel 6** | Priorização Clínica IA | ✅ Ativo |

### 🤖 Inteligência Artificial
- **Motor**: Groq API (Llama 3.3 70B Versatile)
- **Função**: Análise de risco clínico em tempo real
- **Saída**: Classificação de criticidade + recomendações médicas
- **Custo**: API gratuita (6000 tokens/min)

### 🎨 Interface
- Design moderno com Bootstrap 5
- Cores institucionais (vermelho/branco)
- Auto-scroll configurável
- Filtros dinâmicos
- Loading states
- Animações suaves

---

## 🏗️ Arquitetura

```
┌─────────────────┐
│   Cliente Web   │
│  (Browser)      │
└────────┬────────┘
         │
         ▼
┌─────────────────────────────────────┐
│       Flask App (app.py)            │
│  ┌─────────────────────────────┐   │
│  │  Autenticação & Sessões     │   │
│  └─────────────────────────────┘   │
│  ┌─────────────────────────────┐   │
│  │  Rotas de Painéis           │   │
│  └─────────────────────────────┘   │
│  ┌─────────────────────────────┐   │
│  │  Gestão de Usuários         │   │
│  └─────────────────────────────┘   │
└────────┬────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────┐
│      PostgreSQL Database            │
│  ┌─────────────────────────────┐   │
│  │  usuarios                   │   │
│  │  permissoes_paineis         │   │
│  │  historico_usuarios         │   │
│  │  evolucao_turno             │   │
│  │  medicos_ps                 │   │
│  │  ocupacao_leitos            │   │
│  │  cirurgias                  │   │
│  │  painel_clinico_tasy        │   │
│  └─────────────────────────────┘   │
└─────────────────────────────────────┘
         ▲
         │
┌────────┴────────┐         ┌─────────────────┐
│  Apache Hop     │         │  Worker IA      │
│  (ETL)          │         │  (Groq API)     │
│                 │         │                 │
│  Oracle DB ───► │         │  Análise        │
│  Tasy System    │         │  Clínica        │
└─────────────────┘         └─────────────────┘
```

### 📁 Estrutura de Diretórios

```
projeto_painel/
│
├── app.py                          # ⚙️ Aplicação Flask principal
├── config.py                       # 🔧 Configurações dev/prod
├── requirements.txt                # 📦 Dependências Python
├── .env                           # 🔐 Variáveis de ambiente (não versionar!)
├── .env.example                   # 📝 Template de configuração
├── .gitignore                     # 🚫 Arquivos ignorados
│
├── backend/
│   ├── __init__.py
│   ├── auth.py                    # 🔐 Sistema de autenticação
│   ├── database.py                # 🗄️ Conexão com PostgreSQL
│   ├── user_management.py         # 👥 CRUD de usuários
│   └── ia_risk_analyzer_groq.py   # 🤖 Worker de análise IA
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
│   └── admin-usuarios.js
│
├── paineis/
│   ├── painel2/                   # 📋 Evolução de Turno
│   │   ├── index.html
│   │   ├── style.css
│   │   ├── main.js
│   │   └── app.py                 # API específica
│   │
│   ├── painel3/                   # 👨‍⚕️ Médicos PS
│   ├── painel4/                   # 🏥 Ocupação Hospitalar
│   ├── painel5/                   # 🔪 Cirurgias do Dia
│   └── painel6/                   # 🤖 Priorização Clínica IA
│
├── static/
│   └── img/
│       ├── logo.png
│       └── favicon.png
│
├── logs/                          # 📝 Logs do sistema
│   └── painel.log
│
├── scripts/
│   ├── start_all_limpo.ps1       # 🚀 Inicialização Windows
│   ├── start_all.sh              # 🚀 Inicialização Linux
│   └── generate_secret_key.py    # 🔑 Gerar SECRET_KEY
│
└── docs/
    ├── tabelas.txt               # 📋 Estrutura do banco
    ├── API.md                    # 📡 Documentação da API
    └── INSTALL.md                # 📘 Guia de instalação detalhado
```

---

## 🚀 Instalação

### Pré-requisitos

- **Python**: 3.8 ou superior
- **PostgreSQL**: 12 ou superior
- **Apache Hop**: 2.x (para ETL, opcional)
- **pip**: Gerenciador de pacotes Python

### 1️⃣ Clone o Repositório

```bash
git clone https://github.com/seu-usuario/projeto_painel.git
cd projeto_painel
```

### 2️⃣ Crie Ambiente Virtual

```bash
# Windows
python -m venv .venv
.venv\Scripts\activate

# Linux/Mac
python3 -m venv .venv
source .venv/bin/activate
```

### 3️⃣ Instale Dependências

```bash
pip install -r requirements.txt
```

### 4️⃣ Configure o Banco de Dados

```bash
# Entre no PostgreSQL
psql -U postgres

# Crie o banco (se necessário)
CREATE DATABASE postgres;

# Execute os scripts de criação
\i docs/tabelas.txt
```

### 5️⃣ Configure Variáveis de Ambiente

```bash
# Copie o template
cp .env.example .env

# Edite o arquivo .env
nano .env
```

Exemplo de `.env`:
```env
# Banco de Dados
DB_HOST=localhost
DB_NAME=postgres
DB_USER=postgres
DB_PASSWORD=SUA_SENHA_SEGURA_AQUI
DB_PORT=5432

# Segurança
SECRET_KEY=gere_uma_chave_forte_de_32_caracteres_ou_mais

# Ambiente (development ou production)
FLASK_ENV=development

# IA (opcional)
GROQ_API_KEY=sua_chave_groq_aqui
```

### 6️⃣ Gere SECRET_KEY Segura

```bash
python scripts/generate_secret_key.py
```

### 7️⃣ Inicialize o Banco

```bash
python -c "from backend.database import init_db; init_db()"
```

### 8️⃣ Inicie o Servidor

```bash
# Desenvolvimento
python app.py

# Produção (com Gunicorn)
gunicorn -w 4 -b 0.0.0.0:5000 app:app
```

### 9️⃣ Inicie o Worker IA (Opcional)

```bash
python backend/ia_risk_analyzer_groq.py
```

---

## ⚙️ Configuração

### Ambientes

O sistema suporta dois ambientes configuráveis via `FLASK_ENV`:

#### 🛠️ Desenvolvimento (`development`)
- Debug habilitado
- Stack traces visíveis
- Auto-reload de código
- Cookies sem flag Secure
- Logs detalhados (DEBUG)
- CORS permissivo

#### 🔒 Produção (`production`)
- Debug desabilitado
- Erros genéricos (sem stack trace)
- Cookies com flag Secure (HTTPS obrigatório)
- Logs otimizados (WARNING+)
- Cache habilitado
- CORS restritivo

### CORS

Ajuste em `app.py` para produção:

```python
# Desenvolvimento (permissivo)
CORS(app, resources={r"/*": {"origins": "*"}})

# Produção (restritivo)
CORS(app, resources={r"/*": {"origins": ["https://seu-dominio.com"]}})
```

### ETL com Apache Hop

1. Configure conexão com o banco Oracle (Tasy)
2. Crie transformações para cada tabela:
   - `evolucao_turno`
   - `medicos_ps`
   - `ocupacao_leitos`
   - `cirurgias`
   - `painel_clinico_tasy`
3. Agende execução via cron ou Apache Hop Server

---

## 📊 Painéis Disponíveis

### 1. Painel Evolução de Turno (`/painel/painel2`)

Monitora evoluções médicas por turno e setor.

**Filtros:**
- 🏢 Setor: CTI, Enfermaria, PS, etc.
- ⏰ Turno: Manhã, Tarde, Noite

**Colunas:**
- Atendimento
- Paciente
- Setor
- Turno
- Evoluções (Médico, Enfermeiro, Técnico, Nutricionista, Fisioterapeuta)

**Features:**
- Auto-scroll configurável
- Ordenação por coluna
- Refresh 30s
- Destaque visual para registros sem evolução

---

### 2. Painel Médicos PS (`/painel/painel3`)

Rastreamento de médicos logados no Pronto-Socorro.

**Filtros:**
- 🏥 Consultório: Específico ou Todos
- 🔴 Status: Logado, Deslogado ou Todos

**Colunas:**
- Consultório
- Nome do Médico
- CRM
- Especialidade
- Status (badge colorido)
- Tempo Logado

**Features:**
- Destaque verde para médicos logados
- Tempo logado em minutos
- Auto-scroll
- Refresh 30s

---

### 3. Painel Ocupação Hospitalar (`/painel/painel4`)

Dashboard de ocupação de leitos em tempo real.

**Visão Geral:**
- 📊 Total de Leitos
- 🛏️ Leitos Ocupados
- ✅ Leitos Livres
- 🧹 Em Higienização
- 🚫 Interditados
- 📈 Taxa de Ocupação (%)

**Cards de Setores:**
- Taxa de ocupação individual
- Detalhamento por setor
- Drill-down para ver leitos específicos

---

### 4. Painel Cirurgias do Dia (`/painel/painel5`)

Acompanhamento de cirurgias agendadas.

**Estatísticas:**
- 📅 Cirurgias Agendadas
- ⏳ Aguardando
- ❤️ Em Andamento
- ✅ Realizadas

**Informações por Cirurgia:**
- Paciente
- Procedimento
- Cirurgião
- Horário Previsto
- Status (cores indicativas)
- Sala

---

### 5. Painel Priorização Clínica IA (`/painel/painel6`)

Análise de risco com inteligência artificial.

**IA Groq:**
- Modelo: Llama 3.3 70B Versatile
- Análise: Sinais vitais, exames, histórico
- Saída: Criticidade (Alta/Média/Baixa) + Recomendações

**Colunas:**
- Atendimento
- Paciente
- Idade
- Queixa Principal
- Sinais Vitais
- Criticidade (badge colorido)
- Recomendações IA

**Worker:**
- Execução automática a cada 5 minutos
- Processamento em lote (20 registros)
- Log detalhado em `logs/worker_ia.log`

---

## 🔌 API

### Autenticação

#### POST `/api/login`
Realiza login no sistema.

**Request:**
```json
{
  "usuario": "postgres",
  "senha": "senha_segura"
}
```

**Response:**
```json
{
  "success": true,
  "usuario": "postgres",
  "is_admin": true,
  "redirect": "/frontend/dashboard.html"
}
```

---

#### POST `/api/logout`
Encerra sessão do usuário.

**Response:**
```json
{
  "success": true,
  "redirect": "/login.html"
}
```

---

#### GET `/api/verificar-sessao`
Verifica se usuário está autenticado.

**Response:**
```json
{
  "autenticado": true,
  "usuario": "postgres",
  "is_admin": true,
  "usuario_id": 1
}
```

---

### Painéis

#### GET `/api/paineis/{painel_id}/dados`
Retorna dados de um painel específico.

**Exemplo:** `/api/paineis/painel2/dados?setor=CTI&turno=MANHA`

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "nr_atendimento": 12345,
      "nm_paciente": "João Silva",
      "setor": "CTI",
      "turno": "MANHÃ",
      "evol_medico": "10:30",
      "evol_enfermeiro": "11:00"
    }
  ],
  "total": 150,
  "timestamp": "2025-12-29T15:30:00"
}
```

---

### Gestão de Usuários (Admin)

#### GET `/api/admin/usuarios`
Lista todos os usuários.

**Query Params:**
- `incluir_inativos`: `true` ou `false`

**Response:**
```json
{
  "success": true,
  "usuarios": [
    {
      "id": 1,
      "usuario": "postgres",
      "email": "admin@sistema.com",
      "nome_completo": "Administrador",
      "is_admin": true,
      "ativo": true,
      "criado_em": "2025-01-01T00:00:00"
    }
  ],
  "total": 10
}
```

---

#### POST `/api/admin/usuarios`
Cria novo usuário.

**Request:**
```json
{
  "usuario": "joao.silva",
  "senha": "SenhaForte123!",
  "email": "joao@hospital.com",
  "nome_completo": "João Silva",
  "cargo": "Enfermeiro",
  "is_admin": false
}
```

---

#### PUT `/api/admin/usuarios/{id}`
Edita usuário existente.

---

#### DELETE `/api/admin/usuarios/{id}`
Remove usuário (soft delete).

---

### Permissões

#### GET `/api/admin/usuarios/{id}/permissoes`
Lista permissões de um usuário.

---

#### POST `/api/admin/usuarios/{id}/permissoes`
Adiciona permissão a painel.

**Request:**
```json
{
  "painel_nome": "painel2"
}
```

---

#### DELETE `/api/admin/usuarios/{id}/permissoes/{painel}`
Remove permissão de painel.

---

## 🔒 Segurança

### Implementações

✅ **Senhas**: Bcrypt com salt automático  
✅ **Sessões**: Flask-Session com cookies HttpOnly  
✅ **SQL Injection**: Consultas parametrizadas (psycopg2)  
✅ **XSS**: Headers de segurança (X-Frame-Options, CSP)  
✅ **CSRF**: SameSite cookies  
✅ **Logs**: Auditoria completa de ações  

### Headers de Segurança

```python
X-Frame-Options: SAMEORIGIN
X-Content-Type-Options: nosniff
X-XSS-Protection: 1; mode=block
Referrer-Policy: strict-origin-when-cross-origin
Strict-Transport-Security: max-age=31536000; includeSubDomains (produção)
```

### Validação de Senha

Requisitos obrigatórios:
- Mínimo 8 caracteres
- Pelo menos 1 maiúscula
- Pelo menos 1 minúscula
- Pelo menos 1 número
- Pelo menos 1 caractere especial (!@#$%^&*...)

### Whitelist de Campos

O sistema usa whitelist explícita para prevenir SQL injection via nomes de colunas:

```python
CAMPOS_EDITAVEIS = {
    'email',
    'nome_completo',
    'cargo',
    'is_admin',
    'observacoes',
    'ativo'
}
```

---

## 🚢 Deploy

### Produção com Gunicorn

```bash
# Instale Gunicorn
pip install gunicorn

# Inicie com 4 workers
gunicorn -w 4 -b 0.0.0.0:5000 --timeout 120 app:app
```

### Nginx Reverse Proxy

```nginx
server {
    listen 80;
    server_name seu-dominio.com;

    location / {
        proxy_pass http://127.0.0.1:5000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location /static {
        alias /caminho/para/projeto_painel/static;
    }
}
```

### Systemd Service

Crie `/etc/systemd/system/painel.service`:

```ini
[Unit]
Description=Sistema de Painéis Hospitalares
After=network.target postgresql.service

[Service]
Type=notify
User=seu-usuario
Group=www-data
WorkingDirectory=/caminho/para/projeto_painel
Environment="PATH=/caminho/para/projeto_painel/.venv/bin"
ExecStart=/caminho/para/projeto_painel/.venv/bin/gunicorn -w 4 -b 127.0.0.1:5000 app:app
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
```

Ative o serviço:
```bash
sudo systemctl enable painel
sudo systemctl start painel
sudo systemctl status painel
```

### Worker IA como Serviço

Crie `/etc/systemd/system/worker-ia.service`:

```ini
[Unit]
Description=Worker IA - Priorização Clínica
After=network.target postgresql.service

[Service]
Type=simple
User=seu-usuario
WorkingDirectory=/caminho/para/projeto_painel
Environment="PATH=/caminho/para/projeto_painel/.venv/bin"
ExecStart=/caminho/para/projeto_painel/.venv/bin/python backend/ia_risk_analyzer_groq.py
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
```

---

## 👥 Contribuição

### Como Contribuir

1. **Fork** o repositório
2. Crie uma **branch** para sua feature (`git checkout -b feature/nova-funcionalidade`)
3. **Commit** suas mudanças (`git commit -am 'Adiciona nova funcionalidade'`)
4. **Push** para a branch (`git push origin feature/nova-funcionalidade`)
5. Abra um **Pull Request**

### Padrões de Código

- **Python**: PEP 8
- **JavaScript**: ES6+
- **Commits**: [Conventional Commits](https://www.conventionalcommits.org/)

### Estrutura de Commit

```
tipo(escopo): mensagem

feat(painel7): adiciona painel de exames
fix(auth): corrige validação de senha
docs(readme): atualiza instruções de deploy
```

---

## 🐛 Troubleshooting

### Erro de Conexão com Banco

```
❌ Erro ao conectar ao banco: connection refused
```

**Solução:**
1. Verifique se PostgreSQL está rodando: `sudo systemctl status postgresql`
2. Confirme credenciais no `.env`
3. Teste conexão: `psql -U postgres -h localhost`

---

### Erro 401 (Não Autenticado)

**Solução:**
1. Limpe cookies do navegador
2. Faça login novamente
3. Verifique se `SECRET_KEY` não mudou

---

### Painel Não Carrega Dados

**Solução:**
1. Verifique logs: `tail -f logs/painel.log`
2. Confirme se tabela existe no banco
3. Execute query manualmente no PostgreSQL
4. Verifique permissões do usuário no painel

---

### Worker IA Não Executa

**Solução:**
1. Confirme que `GROQ_API_KEY` está configurada
2. Verifique logs: `tail -f logs/worker_ia.log`
3. Teste API Groq manualmente
4. Verifique limite de tokens (6000/min)

---

### Auto-scroll Não Funciona

**Solução:**
1. Pressione o botão "Auto Scroll" no cabeçalho
2. Verifique console do navegador (F12) para erros JS
3. Confirme que há registros suficientes para scroll

---

## 🗺️ Roadmap

### Versão 2.0 (Q2 2026)

- [ ] **Dashboard de Analytics**
  - Gráficos de uso dos painéis
  - Tempo médio de permanência
  - Usuários ativos simultâneos

- [ ] **Exportação de Dados**
  - Excel (openpyxl)
  - PDF (reportlab)
  - CSV com filtros aplicados

- [ ] **Notificações em Tempo Real**
  - WebSockets para alertas críticos
  - Push notifications para admins
  - Integração com WhatsApp/Email

- [ ] **App Mobile**
  - React Native
  - Notificações push
  - Modo offline parcial

- [ ] **Cache Inteligente**
  - Redis para dados frequentes
  - Invalidação automática
  - Redução de carga no banco

### Versão 2.1 (Q3 2026)

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

---

## 📝 Acesso Padrão

**Usuário Administrador:**
- **Usuário:** `postgres`
- **Senha:** `postgres`

⚠️ **IMPORTANTE:** Altere a senha padrão imediatamente em produção!

```sql
-- Execute no PostgreSQL após primeiro login
UPDATE usuarios 
SET senha_hash = 'nova_senha_criptografada' 
WHERE usuario = 'postgres';
```

Ou use a interface de admin: **Gestão de Usuários > Editar > Reset Senha**

---

## 📞 Suporte

Para dúvidas, problemas ou sugestões:

- **Email**: lucasrx6@gmail.com
- **Issues**: [GitHub Issues](https://github.com/seu-usuario/projeto_painel/issues)
- **Wiki**: [Documentação Interna](https://github.com/seu-usuario/projeto_painel/wiki)

---

## 📄 Licença

Este projeto é de uso interno do Hospital Anchieta Ceilândia - Kora Saúde.  
Todos os direitos reservados.

---

## 👏 Agradecimentos

Desenvolvido com ❤️ pela equipe de TI do Hospital Anchieta Ceilândia.

**Tecnologias:**
- [Flask](https://flask.palletsprojects.com/)
- [PostgreSQL](https://www.postgresql.org/)
- [Bootstrap](https://getbootstrap.com/)
- [Groq](https://groq.com/)
- [Apache Hop](https://hop.apache.org/)

---

**Hospital Anchieta Ceilândia - Kora Saúde** 🏥  
*Cuidando de vidas com tecnologia e humanização*