# 🏥 Sistema de Painéis - Anchieta Ceilândia

Sistema web para monitoramento de painéis hospitalares com autenticação e controle de acesso.

![Logo Anchieta](static/img/logo.png)

## 📋 Funcionalidades

### ✅ Implementado
- 🔐 Sistema de autenticação com sessões
- 👥 Controle de usuários (Admin/Comum)
- 📊 **Painel Evolução de Turno**
  - Visualização de evoluções médicas
  - Filtros por Setor e Turno
  - Auto-scroll configurável
  - Ordenação de colunas
  - Refresh automático (30s)
- 🏥 **Painel Médicos PS**
  - Monitoramento de médicos logados
  - Filtros por Consultório e Status
  - Destaque visual para médicos logados
  - Tempo de login
  - Auto-scroll e refresh automático

### 🎨 Melhorias Visuais
- ✅ Design com bordas vermelhas (removido fundos vermelhos)
- ✅ Logo do hospital integrado
- ✅ Interface moderna e responsiva
- ✅ Animações suaves
- ✅ Cores institucionais mantidas nos detalhes

---

## 🚀 Instalação

### 1. Requisitos
- Python 3.8+
- PostgreSQL 12+
- pip

### 2. Clone o Repositório
```bash
git clone <seu-repositorio>
cd projeto_painel
```

### 3. Instale as Dependências
```bash
pip install -r requirements.txt
```

### 4. Configure o Banco de Dados

#### 4.1. Crie o banco de dados PostgreSQL
```sql
-- Se necessário, crie o banco
CREATE DATABASE postgres;
```

#### 4.2. Configure o arquivo `.env`
```env
DB_HOST=localhost
DB_NAME=postgres
DB_USER=postgres
DB_PASSWORD=sua_senha_aqui
DB_PORT=5432
SECRET_KEY=gere_uma_chave_secreta_aqui
```

#### 4.3. Execute os scripts SQL

**Tabela de Evoluções (se ainda não existir):**
```sql
-- Copie e execute o script da sua tabela evolucao_turno aqui
```

**Tabela de Médicos PS:**
```bash
psql -U postgres -d postgres -f sql_create_medicos_ps.sql
```

### 5. Inicie o Servidor
```bash
python app.py
```

O servidor será iniciado em:
- Local: `http://localhost:5000`
- Rede: `http://<seu-ip>:5000`

---

## 👤 Acesso Padrão

**Usuário Admin:**
- **Usuário:** `postgres`
- **Senha:** `postgres`

⚠️ **IMPORTANTE:** Altere a senha padrão em produção!

---

## 📊 Estrutura das Tabelas

### Tabela: `evolucao_turno`
Estrutura esperada (ajuste conforme sua tabela):
```sql
- nr_atendimento
- nm_paciente
- setor
- unidade
- data_turno
- turno (MANHÃ, TARDE, NOITE)
- evol_medico
- evol_enfermeiro
- evol_tec_enfermagem
- evol_nutricionista
- evol_fisioterapeuta
```

### Tabela: `medicos_ps`
```sql
CREATE TABLE medicos_ps (
    id SERIAL PRIMARY KEY,
    consultorio VARCHAR(100),
    nome_medico VARCHAR(200),
    crm VARCHAR(50),
    especialidade VARCHAR(100),
    status VARCHAR(20), -- 'LOGADO' ou 'DESLOGADO'
    data_login TIMESTAMP,
    tempo_logado INTEGER, -- Tempo em minutos
    dt_carga TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

---

## 🔄 Integração com Apache Hop

### Para o Painel Evolução de Turno:
1. Crie sua consulta SQL no sistema fonte
2. Configure o Apache Hop para fazer a transformação
3. Insira/atualize dados na tabela `evolucao_turno`
4. O painel será atualizado automaticamente a cada 30s

### Para o Painel Médicos PS:
1. Crie consulta SQL que identifica médicos logados
2. Configure transformação no Apache Hop com:
   - Consultório onde está logado
   - Nome do médico
   - CRM
   - Especialidade
   - Status (LOGADO/DESLOGADO)
   - Data e hora do login
   - Tempo logado (em minutos)
3. Insira/atualize dados na tabela `medicos_ps`
4. O painel será atualizado automaticamente

---

## 📁 Estrutura do Projeto

```
projeto_painel/
│
├── app.py                          # Aplicação Flask principal
├── requirements.txt                # Dependências Python
├── .env                           # Configurações (não versionar!)
│
├── backend/
│   ├── __init__.py
│   ├── auth.py                    # Sistema de autenticação
│   └── database.py                # Conexão com banco
│
├── frontend/
│   ├── login.html                 # Página de login
│   ├── login.css                  # Estilos do login
│   ├── login.js                   # Lógica do login
│   ├── dashboard.html             # Dashboard principal
│   ├── dashboard.css              # Estilos do dashboard
│   └── dashboard.js               # Lógica do dashboard
│
├── paineis/
│   ├── painel2/                   # Painel Evolução de Turno
│   │   ├── index.html
│   │   ├── style.css
│   │   └── main.js
│   │
│   └── painel3/                   # Painel Médicos PS
│       ├── index.html
│       ├── style.css
│       └── main.js
│
├── static/
│   └── img/
│       └── logo.png               # Logo do hospital
│
└── sql_create_medicos_ps.sql      # Script de criação da tabela
```

---

## ⚙️ Configurações

### Filtros Disponíveis

**Painel Evolução de Turno:**
- 🏢 **Setor:** Filtra por setor hospitalar
- ⏰ **Turno:** Manhã, Tarde ou Noite

**Painel Médicos PS:**
- 🏥 **Consultório:** Filtra por consultório específico
- 🔴 **Status:** Logado ou Deslogado

### Auto-scroll
- Velocidade configurável em `CONFIG.velocidadeScroll`
- Pausa automática após X linhas (configurável)
- Retorna ao topo automaticamente

### Refresh Automático
- Intervalo padrão: 30 segundos
- Configurável em `CONFIG.intervaloRefresh`

---

## 🔒 Segurança

- ✅ Senhas criptografadas com bcrypt
- ✅ Sessões seguras com Flask-Session
- ✅ Proteção de rotas com decorators
- ✅ CORS configurado
- ✅ Validação de entrada

---

## 🛠️ Manutenção

### Adicionar Novo Usuário (via Admin)
1. Faça login com usuário admin
2. Clique em "Cadastrar Usuário"
3. Preencha os dados
4. Marque "Administrador" se necessário

### Adicionar Novo Painel
1. Crie pasta em `paineis/painelX/`
2. Adicione `index.html`, `style.css`, `main.js`
3. Crie rota em `app.py`:
```python
@app.route('/api/paineis/painelX/dados', methods=['GET'])
@login_required
def get_dados_painelX():
    # Sua lógica aqui
```
4. Adicione card no `dashboard.html`

---

## 📝 Logs

Os logs do servidor aparecem no console:
```
🚀 SERVIDOR PRINCIPAL INICIADO
📊 Painéis disponíveis:
   • Evolução de Turno: /painel/painel2
   • Médicos PS:         /painel/painel3
```

---

## 🐛 Troubleshooting

### Erro de Conexão com Banco
```bash
❌ Erro ao conectar ao banco: connection refused
```
**Solução:** Verifique se PostgreSQL está rodando e se as credenciais no `.env` estão corretas

### Erro 401 (Não autenticado)
**Solução:** Faça login novamente, a sessão pode ter expirado

### Painel não carrega dados
1. Verifique se a tabela existe no banco
2. Confira se os nomes das colunas correspondem ao código
3. Veja os logs do servidor para erros SQL

---

## 📞 Suporte

Para dúvidas ou problemas, entre em contato com a equipe de TI.

---

## 📄 Licença

Uso interno - Anchieta Ceilândia

---

## 🎯 Próximos Passos

Sugestões para evolução:
- [ ] Exportação de dados para Excel
- [ ] Gráficos e estatísticas
- [ ] Notificações em tempo real
- [ ] App mobile
- [ ] Integração com outros sistemas

---

**Desenvolvido para Anchieta Ceilândia - Kora Saúde** 🏥