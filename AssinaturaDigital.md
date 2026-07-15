# AssinaturaDigital.md
# Guia Completo — Assinatura Digital / Eletrônica no Sistema HAC
# Planejamento para Painel 48

> **Status:** Planejamento futuro  
> **Criado em:** Julho/2026  
> **Contexto:** Extensão do Painel 42 (Nutrição) e outros fluxos que precisem de prova física de recebimento/consentimento

---

## 1. É POSSÍVEL? RESPOSTA DIRETA

**Sim, é totalmente possível.** E mais — para o caso de uso principal do HAC (confirmação de entrega de refeição ao paciente, protocolo de alta, consentimento de procedimento), a solução é:

- **Tecnicamente simples** (libraries JS gratuitas rodam direto no browser)
- **Juridicamente válida** para uso hospitalar interno (Lei 14.063/2020)
- **Zero custo de licença** para o volume de um hospital de médio porte
- **Sem dependência de internet** para o modo de assinatura com o dedo (tudo client-side)

---

## 2. MARCO LEGAL BRASILEIRO — O QUE VOCÊ PRECISA SABER

### 2.1 Legislação base

| Lei / Norma | O que regula |
|---|---|
| **MP 2.200-2/2001** | Cria a ICP-Brasil (Infraestrutura de Chaves Públicas) — certificados A1/A3 |
| **Lei 14.063/2020** | Define os 3 tipos de assinatura eletrônica e quando cada um vale |
| **LGPD (Lei 13.709/2018)** | Proteção de dados — biometria facial é dado sensível |
| **CFM (Conselho Federal de Medicina)** | Resoluções sobre prontuário eletrônico — Res. 1821/2007 e 2299/2021 |

### 2.2 Os 3 tipos de assinatura (Lei 14.063/2020)

```
┌─────────────────────────────────────────────────────────────────┐
│  NÍVEL 1 — Assinatura Eletrônica SIMPLES (AES)                  │
│                                                                   │
│  O que é: Qualquer mecanismo que identifique o signatário        │
│  Exemplos: PIN/código SMS, e-mail de confirmação, checkbox,      │
│            assinatura com o dedo em tela (com log de auditoria)  │
│                                                                   │
│  Válida para: Documentos de baixo risco, uso interno hospitalar  │
│  → PROTOCOLO DE ENTREGA DE REFEIÇÃO = AES é SUFICIENTE          │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│  NÍVEL 2 — Assinatura Eletrônica AVANÇADA (AEA)                 │
│                                                                   │
│  O que é: Identifica o signatário + detecta qualquer alteração   │
│  Exemplos: Biometria facial com liveness detection,              │
│            biometria digital (leitor), certificado não-ICP       │
│                                                                   │
│  Válida para: Documentos médicos, TCLE, prescrições internas     │
│  → CONSENTIMENTO INFORMADO, TERMO DE ALTA = AEA recomendada     │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│  NÍVEL 3 — Assinatura Eletrônica QUALIFICADA (AEQ)              │
│                                                                   │
│  O que é: Certificado ICP-Brasil (token físico A3 ou A1)         │
│  Custo: R$ 100–300/ano por pessoa + token físico ~R$ 200        │
│                                                                   │
│  Válida para: Documentos legais externos, contratos formais      │
│  → NÃO NECESSÁRIA para uso hospitalar interno                   │
└─────────────────────────────────────────────────────────────────┘
```

### 2.3 Requisitos mínimos para que AES seja juridicamente válida

Para que uma assinatura de dedo na tela seja considerada AES válida, o sistema **DEVE** registrar:

1. **Timestamp do servidor** (não do cliente — timezone UTC guardada no banco)
2. **IP de origem** do dispositivo que coletou a assinatura
3. **Identificação de quem coletou** (usuário logado no sistema HAC)
4. **Hash SHA-256** do conteúdo assinado (ex: hash do JSON com dados da refeição)
5. **Imagem da assinatura** (PNG base64 armazenado no banco)
6. **Identificação do contexto** (qual documento, qual paciente, qual refeição)

Com esses 6 elementos registrados, a assinatura tem **presunção de autenticidade** e pode ser usada como prova em processo judicial ou auditoria do CFM/ANS.

---

## 3. TECNOLOGIAS DISPONÍVEIS — ANÁLISE COMPLETA

### 3.1 Assinatura com o Dedo (Touchscreen)

#### Opção A — Signature Pad JS ⭐ RECOMENDADA

```
Nome:       signature_pad
Repositório: https://github.com/szimek/signature_pad
Licença:    MIT (gratuita para uso comercial)
Tamanho:    ~14 KB minificado
Dependências: ZERO (puro JavaScript)
```

**Por que é a melhor escolha:**
- Roda 100% no browser — sem servidor, sem API key, sem internet necessária
- Suporta mouse, touch (celular/tablet) e caneta stylus
- Exporta para PNG, SVG, ou JSON (pontos brutos para reprodução)
- Algoritmo Bézier para traço suave e natural
- Funciona em qualquer dispositivo que o HAC já usa (tablet, celular, PC)
- LGPD: nenhum dado sai do hospital

**Implementação básica:**
```html
<!-- Incluir no index.html -->
<canvas id="canvas-assinatura" width="700" height="200"></canvas>
<script src="https://cdn.jsdelivr.net/npm/signature_pad@4.1.7/dist/signature_pad.umd.min.js"></script>
```

```javascript
// Inicializar
var pad = new SignaturePad(document.getElementById('canvas-assinatura'), {
    backgroundColor: 'rgb(255, 255, 255)',
    penColor: 'rgb(0, 0, 0)',
    minWidth: 1,
    maxWidth: 3
});

// Verificar se foi assinado
if (pad.isEmpty()) {
    alert('Por favor, assine antes de confirmar.');
    return;
}

// Obter imagem para salvar
var imagem = pad.toDataURL('image/png');  // base64

// Limpar
pad.clear();
```

---

### 3.2 Biometria Facial (Face Recognition)

#### Opção A — face-api.js ⭐ GRATUITA, LOCAL

```
Nome:       face-api.js
Repositório: https://github.com/justadudewhohacks/face-api.js
Licença:    MIT (gratuita)
Base:       TensorFlow.js — roda no browser
```

**Como funciona:**
1. Carrega modelos de IA (~6 MB de arquivos .weights)
2. Acessa a câmera do dispositivo via `getUserMedia`
3. Detecta face em tempo real
4. Compara com foto cadastrada (para verificação de identidade)
5. Tudo roda localmente — ZERO requisições externas

**Limitações:**
- Não tem "liveness detection" nativo (não distingue foto de pessoa real)
- Para liveness: precisa de detecção de movimento, piscar de olhos (implementação adicional)
- Modelos precisam ser hospedados no servidor HAC (`/static/models/`)

**Para uso como AEA (Avançada), precisaria adicionar:**
- Captura de vídeo curto (3–5 segundos) para prova de presença
- Armazenar hash do frame capturado

#### Opção B — Azure Face API (Microsoft)

```
Custo:      GRATUITO até 30.000 transações/mês (Free tier)
Além disso: R$ ~0,005 por transação
Liveness:   Disponível (Azure Face Liveness Detection)
LGPD:       ⚠️  Dados enviados para servidores Microsoft (EUA)
```

#### Opção C — AWS Rekognition (Amazon)

```
Custo:      Primeiros 5.000 rostos/mês GRATUITOS por 12 meses
Além disso: ~USD 0,001 por imagem processada
Liveness:   FaceGuard disponível (USD 0,002/sessão)
LGPD:       ⚠️  Dados enviados para servidores AWS
```

#### Opção D — GOV.BR (Reconhecimento Facial do governo)

```
Custo:      Gratuito (para órgãos públicos e integrados ao GOV.BR)
Validade:   AEQ (Qualificada — o mais alto nível)
Como:       O cidadão assina pelo app GOV.BR no próprio celular
LGPD:       ✅  Dados no governo brasileiro
Limitação:  Requer que o paciente tenha conta GOV.BR verificada
```

**Esta é a opção mais robusta juridicamente se o HAC for público/conveniado SUS.**

---

### 3.3 Plataformas de Assinatura Eletrônica (SaaS)

| Plataforma | País | Plano Gratuito | API | Nível Legal |
|---|---|---|---|---|
| **D4Sign** | Brasil | 3 docs/mês | ✅ REST API | AES / AEA / AEQ |
| **Autentique** | Brasil | 5 docs/mês | ✅ GraphQL API | AES / AEA |
| **ClickSign** | Brasil | Trial 30 dias | ✅ REST API | AES / AEA |
| **DocuSign** | EUA | Não | ✅ REST API | AES / AEA |
| **ZapSign** | Brasil | 5 docs/mês | ✅ REST API | AES / AEA |

**Recomendação para HAC:** Para uso interno de protocolo de refeição, **nenhuma dessas é necessária**. Para documentos externos (alta hospitalar com validade legal), **D4Sign ou Autentique** têm APIs REST simples.

---

## 4. DECISÃO RECOMENDADA PARA O HAC

```
┌────────────────────────────────────────────────────────────────┐
│  CASO DE USO          SOLUÇÃO             CUSTO    VALIDADE    │
├────────────────────────────────────────────────────────────────┤
│  Protocolo refeição   Signature Pad JS    ZERO     AES ✅     │
│  Protocolo alta       Signature Pad JS    ZERO     AES ✅     │
│  TCLE procedimento    face-api.js + pad   ZERO     AEA ✅     │
│  Documentos oficiais  D4Sign API          Baixo    AEA/AEQ ✅ │
│  Maior validade legal GOV.BR              ZERO     AEQ ✅✅   │
└────────────────────────────────────────────────────────────────┘
```

**Para o Painel 48, fase 1: implementar Signature Pad JS (assinatura com dedo).**  
Custo zero, juridicamente válido para o contexto hospitalar interno, implementação em 1–2 dias.

---

## 5. BANCO DE DADOS — TABELA PROPOSTA

```sql
-- Tabela principal de assinaturas
CREATE TABLE assinaturas_digitais (
    id                  SERIAL PRIMARY KEY,
    contexto            VARCHAR(50) NOT NULL,       -- 'entrega_refeicao' | 'alta' | 'tcle' | 'outro'
    ref_tabela          VARCHAR(100),               -- nome da tabela de origem (ex: 'nutricao_chamados')
    ref_id              INTEGER,                    -- ID do registro relacionado
    nr_atendimento      VARCHAR(50),
    nm_signatario       VARCHAR(200),               -- quem assinou (paciente, familiar, responsável)
    qualidade_signatario VARCHAR(50),               -- 'paciente' | 'familiar' | 'responsavel_legal'
    
    -- Conteúdo da assinatura
    assinatura_img      TEXT NOT NULL,              -- PNG em base64
    foto_signatario     TEXT,                       -- JPEG base64 (opcional, para AEA)
    
    -- Auditoria (obrigatórios para validade legal AES)
    hash_conteudo       VARCHAR(64) NOT NULL,       -- SHA-256 do JSON do documento assinado
    conteudo_json       TEXT,                       -- JSON com dados exatos do que foi assinado
    ip_origem           VARCHAR(45),
    user_agent          TEXT,
    dispositivo_id      VARCHAR(100),               -- ID do tablet/terminal se fixo
    
    -- Quem coletou
    coletado_por_id     INTEGER REFERENCES usuarios(id),
    coletado_por_nome   VARCHAR(200),
    
    -- Timestamps
    criado_em           TIMESTAMP DEFAULT NOW(),
    
    -- Índices úteis
    CONSTRAINT assin_contexto_ref UNIQUE (contexto, ref_id)
);

CREATE INDEX idx_assin_atendimento ON assinaturas_digitais(nr_atendimento);
CREATE INDEX idx_assin_contexto    ON assinaturas_digitais(contexto);
CREATE INDEX idx_assin_criado      ON assinaturas_digitais(criado_em);
```

---

## 6. ARQUITETURA DO PAINEL 48

### 6.1 Estrutura de arquivos

```
paineis/painel48/
    index.html      — Interface de assinatura
    main.js         — Lógica ES5 + Signature Pad
    style.css       — Estilos

backend/routes/
    painel48_routes.py

static/
    js/signature_pad.umd.min.js   — Biblioteca (hospedar localmente)
    models/                        — Modelos face-api.js (se usar biometria)
        tiny_face_detector_model-weights_manifest.json
        face_landmark_68_model-weights_manifest.json
```

### 6.2 Endpoints do backend

```python
# painel48_routes.py

# Renderiza a tela do painel
GET  /painel/painel48

# Salva uma assinatura
POST /api/paineis/painel48/assinar
     Body: {
         contexto: 'entrega_refeicao',
         ref_id: 123,
         nr_atendimento: '287405',
         nm_signatario: 'João da Silva',
         qualidade_signatario: 'paciente',
         assinatura_img: 'data:image/png;base64,...',
         foto_signatario: null,          # ou base64 se usar câmera
         hash_conteudo: 'sha256hex...',
         conteudo_json: '{"refeicao": "Café da Manhã", ...}'
     }

# Busca assinatura por contexto+ref_id
GET  /api/paineis/painel48/assinatura?contexto=entrega_refeicao&ref_id=123

# Lista assinaturas do dia
GET  /api/paineis/painel48/historico?data=2026-07-14

# Download do PDF com a assinatura incorporada
GET  /api/paineis/painel48/pdf/<id>
```

### 6.3 Fluxo de funcionamento (Painel 48 standalone)

```
1. Usuário abre /painel/painel48
2. Sistema exibe formulário de contexto:
   - Seleciona: tipo de documento
   - Informa: nr_atendimento ou busca paciente
   - Preview: dados do documento sendo assinado
3. Tela de assinatura:
   - Canvas para assinatura com dedo/mouse
   - Opcional: botão para abrir câmera
   - Botão LIMPAR / CONFIRMAR
4. Ao confirmar:
   - JS gera SHA-256 do conteúdo (SubtleCrypto API)
   - Envia POST /api/paineis/painel48/assinar
   - Backend valida + salva no banco
   - Retorna ID da assinatura + timestamp do servidor
5. Exibe comprovante com QR code do ID para consulta futura
```

---

## 7. INTEGRAÇÃO COM O PAINEL 42 (Nutrição)

### Como funcionaria na prática:

```
Paciente recebe a refeição
    ↓
Funcionário da nutrição está com tablet na mão
    ↓
No Painel 42, card "Em Entrega", aparece botão:
    [✍️ Coletar Assinatura]
    ↓
Modal ou redirect para Painel 48 com contexto pré-preenchido:
    { ref_id: id_do_chamado, nr_atendimento: '287405', nm_paciente: 'Lucas...' }
    ↓
Paciente (ou familiar) assina na tela do tablet
    ↓
Sistema registra e status do chamado atualiza para "Entregue c/ Assinatura"
    ↓
Na aba Histórico do Painel 42:
    Status: ✅ Entregue c/ Assinatura  [🔍 Ver assinatura]
```

### Mudanças necessárias no Painel 42:

**1. Novo status:** `entregue_assinado` (além de `concluido`)

**2. Novo botão no card "Em Entrega":**
```javascript
html += '<button onclick="P42.coletarAssinatura(' + item.id + ')">'
      + '<i class="fa-solid fa-signature"></i> Coletar Assinatura</button>';
```

**3. Função `coletarAssinatura(id)`:**
```javascript
function coletarAssinatura(id) {
    // Abre Painel 48 em janela/modal com contexto
    var url = '/painel/painel48?contexto=entrega_refeicao&ref_id=' + id
            + '&nr_atendimento=' + Estado.fila[id].nr_atendimento;
    window.open(url, '_blank', 'width=800,height=600');
}
```

**4. Na tabela `nutricao_chamados`:** adicionar coluna `assinatura_id INTEGER REFERENCES assinaturas_digitais(id)`

---

## 8. IMPLEMENTAÇÃO PASSO A PASSO

### Fase 1 — Fundação (Signature Pad, AES)

**Etapa 1.1 — Preparar a biblioteca**
```powershell
# Baixar signature_pad e hospedar localmente
# https://cdn.jsdelivr.net/npm/signature_pad@4.1.7/dist/signature_pad.umd.min.js
# Salvar em: static/js/signature_pad.umd.min.js
```

**Etapa 1.2 — Criar a tabela no banco**
```sql
-- Executar no PostgreSQL do HAC
-- (usar o DDL da seção 5 acima)
```

**Etapa 1.3 — Criar backend/routes/painel48_routes.py**

```python
from flask import Blueprint, jsonify, send_from_directory, session, request, current_app
from psycopg2.extras import RealDictCursor
from backend.database import get_db_cursor
from backend.middleware.decorators import login_required, panel_permission_required
import hashlib, json

painel48_bp = Blueprint('painel48', __name__)

@painel48_bp.route('/painel/painel48')
@login_required
@panel_permission_required('painel48')
def painel48():
    return send_from_directory('paineis/painel48', 'index.html')

@painel48_bp.route('/api/paineis/painel48/assinar', methods=['POST'])
@login_required
def api_painel48_assinar():
    try:
        dados = request.get_json()
        if not dados or not dados.get('assinatura_img'):
            return jsonify({'success': False, 'error': 'Assinatura não fornecida'}), 400

        # Verificar hash do conteúdo (integridade)
        conteudo_json = dados.get('conteudo_json', '{}')
        hash_esperado = hashlib.sha256(conteudo_json.encode('utf-8')).hexdigest()
        if dados.get('hash_conteudo') != hash_esperado:
            return jsonify({'success': False, 'error': 'Hash do conteúdo inválido'}), 400

        ip = request.headers.get('X-Forwarded-For', request.remote_addr)
        ua = request.headers.get('User-Agent', '')

        with get_db_cursor(use_dict_cursor=False) as cursor:
            cursor.execute("""
                INSERT INTO assinaturas_digitais
                    (contexto, ref_tabela, ref_id, nr_atendimento, nm_signatario,
                     qualidade_signatario, assinatura_img, foto_signatario,
                     hash_conteudo, conteudo_json, ip_origem, user_agent,
                     coletado_por_id, coletado_por_nome)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                RETURNING id, criado_em
            """, (
                dados.get('contexto'),
                dados.get('ref_tabela'),
                dados.get('ref_id'),
                dados.get('nr_atendimento'),
                dados.get('nm_signatario'),
                dados.get('qualidade_signatario', 'paciente'),
                dados.get('assinatura_img'),
                dados.get('foto_signatario'),
                hash_esperado,
                conteudo_json,
                ip, ua,
                session.get('usuario_id'),
                session.get('nome_completo')
            ))
            row = cursor.fetchone()

        return jsonify({
            'success': True,
            'id': row[0],
            'criado_em': row[1].isoformat()
        })

    except Exception as e:
        current_app.logger.error(f'Erro ao salvar assinatura: {e}', exc_info=True)
        return jsonify({'success': False, 'error': 'Erro ao salvar assinatura'}), 500

@painel48_bp.route('/api/paineis/painel48/assinatura')
@login_required
def api_painel48_buscar():
    contexto = request.args.get('contexto', '')
    ref_id   = request.args.get('ref_id', '')
    if not contexto or not ref_id:
        return jsonify({'success': False, 'error': 'Parâmetros obrigatórios: contexto, ref_id'}), 400
    try:
        with get_db_cursor() as cursor:
            cursor.execute("""
                SELECT id, nm_signatario, qualidade_signatario, assinatura_img,
                       criado_em, coletado_por_nome, nr_atendimento
                FROM assinaturas_digitais
                WHERE contexto = %s AND ref_id = %s
                ORDER BY criado_em DESC LIMIT 1
            """, (contexto, int(ref_id)))
            row = cursor.fetchone()
        if not row:
            return jsonify({'success': True, 'assinatura': None})
        return jsonify({'success': True, 'assinatura': dict(row)})
    except Exception as e:
        current_app.logger.error(f'Erro ao buscar assinatura: {e}', exc_info=True)
        return jsonify({'success': False, 'error': 'Erro ao buscar assinatura'}), 500
```

**Etapa 1.4 — Registrar em app.py**
```python
from backend.routes.painel48_routes import painel48_bp
app.register_blueprint(painel48_bp)
```

**Etapa 1.5 — Criar paineis/painel48/index.html**

```html
<!DOCTYPE html>
<html lang="pt-BR">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Assinatura Digital — Hospital Anchieta</title>
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
    <link rel="stylesheet" href="/paineis/painel48/style.css">
    <link rel="stylesheet" href="/frontend/tema.css">
    <link rel="icon" href="/static/img/favicon.png">
</head>
<body>
<div class="painel-container">
    <header class="painel-header">
        <div class="header-content">
            <div class="header-left">
                <img src="/static/img/logo.png" alt="HAC">
                <h1><i class="fas fa-signature"></i> Assinatura Digital</h1>
            </div>
        </div>
    </header>

    <main class="main-content">
        <div class="card-assinatura">
            <div class="doc-info" id="doc-info"></div>

            <div class="signatario-form">
                <label>Nome de quem está assinando:</label>
                <input type="text" id="inp-signatario" placeholder="Nome completo">
                <label>Qualidade:</label>
                <select id="sel-qualidade">
                    <option value="paciente">Paciente</option>
                    <option value="familiar">Familiar / Acompanhante</option>
                    <option value="responsavel_legal">Responsável Legal</option>
                </select>
            </div>

            <div class="canvas-wrapper">
                <canvas id="canvas-assinatura"></canvas>
                <div class="canvas-label">Assine aqui com o dedo ou caneta</div>
            </div>

            <div class="acoes-assinatura">
                <button id="btn-limpar" class="btn-sec">
                    <i class="fas fa-eraser"></i> Limpar
                </button>
                <button id="btn-confirmar" class="btn-prim">
                    <i class="fas fa-check"></i> Confirmar Assinatura
                </button>
            </div>

            <div id="resultado" class="resultado" style="display:none;"></div>
        </div>
    </main>

    <footer class="sistema-footer">
        <span id="sistema-versao-footer">Central de Informações V 1.1.4</span>
    </footer>
</div>

<script src="/static/js/signature_pad.umd.min.js"></script>
<script src="/paineis/painel48/main.js"></script>
<script src="/static/js/versao.js"></script>
</body>
</html>
```

**Etapa 1.6 — Criar paineis/painel48/main.js (ES5)**

```javascript
(function() {
    'use strict';

    var CONFIG = {
        api: '/api/paineis/painel48'
    };

    var Estado = {
        pad: null,
        params: {}
    };

    function lerParams() {
        var q = window.location.search.replace('?', '');
        var pares = q.split('&');
        var p = {};
        for (var i = 0; i < pares.length; i++) {
            var kv = pares[i].split('=');
            if (kv.length === 2) p[decodeURIComponent(kv[0])] = decodeURIComponent(kv[1]);
        }
        return p;
    }

    // SHA-256 via SubtleCrypto (disponível em todos browsers modernos)
    function sha256(texto) {
        var encoder = new TextEncoder();
        var data = encoder.encode(texto);
        return crypto.subtle.digest('SHA-256', data).then(function(buffer) {
            var bytes = new Uint8Array(buffer);
            var hex = '';
            for (var i = 0; i < bytes.length; i++) {
                hex += ('00' + bytes[i].toString(16)).slice(-2);
            }
            return hex;
        });
    }

    function inicializar() {
        Estado.params = lerParams();

        // Preencher info do documento
        var docInfo = document.getElementById('doc-info');
        if (docInfo && Estado.params.contexto) {
            var labels = {
                'entrega_refeicao': 'Entrega de Refeição',
                'alta':             'Alta Hospitalar',
                'tcle':             'Termo de Consentimento'
            };
            var ctx = labels[Estado.params.contexto] || Estado.params.contexto;
            docInfo.innerHTML = '<strong>Documento:</strong> ' + ctx
                + (Estado.params.nm_paciente ? ' · <strong>Paciente:</strong> ' + Estado.params.nm_paciente : '')
                + (Estado.params.nr_atendimento ? ' · <strong>Atend.:</strong> ' + Estado.params.nr_atendimento : '');
        }

        // Inicializar Signature Pad
        var canvas = document.getElementById('canvas-assinatura');
        // Ajustar resolução para dispositivos HiDPI (tablets)
        var ratio = Math.max(window.devicePixelRatio || 1, 1);
        canvas.width  = canvas.offsetWidth  * ratio;
        canvas.height = canvas.offsetHeight * ratio;
        canvas.getContext('2d').scale(ratio, ratio);

        Estado.pad = new SignaturePad(canvas, {
            backgroundColor: 'rgb(255,255,255)',
            penColor: 'rgb(0,0,0)',
            minWidth: 1.5,
            maxWidth: 3.5
        });

        document.getElementById('btn-limpar').addEventListener('click', function() {
            Estado.pad.clear();
        });

        document.getElementById('btn-confirmar').addEventListener('click', confirmar);
    }

    function confirmar() {
        if (Estado.pad.isEmpty()) {
            alert('Por favor, realize a assinatura antes de confirmar.');
            return;
        }
        var signatario = document.getElementById('inp-signatario').value.trim();
        if (!signatario) {
            alert('Informe o nome de quem está assinando.');
            return;
        }

        var conteudo = {
            contexto:      Estado.params.contexto || '',
            ref_id:        Estado.params.ref_id || '',
            nr_atendimento:Estado.params.nr_atendimento || '',
            nm_paciente:   Estado.params.nm_paciente || '',
            nm_signatario: signatario,
            ts_captura:    new Date().toISOString()
        };
        var conteudoJson = JSON.stringify(conteudo);
        var imgBase64    = Estado.pad.toDataURL('image/png');

        sha256(conteudoJson).then(function(hash) {
            var body = {
                contexto:             conteudo.contexto,
                ref_tabela:           Estado.params.ref_tabela || null,
                ref_id:               conteudo.ref_id ? parseInt(conteudo.ref_id) : null,
                nr_atendimento:       conteudo.nr_atendimento,
                nm_signatario:        signatario,
                qualidade_signatario: document.getElementById('sel-qualidade').value,
                assinatura_img:       imgBase64,
                foto_signatario:      null,
                hash_conteudo:        hash,
                conteudo_json:        conteudoJson
            };

            document.getElementById('btn-confirmar').disabled = true;

            fetch(CONFIG.api + '/assinar', {
                method: 'POST',
                credentials: 'same-origin',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify(body)
            })
            .then(function(r) { return r.json(); })
            .then(function(d) {
                var res = document.getElementById('resultado');
                if (d.success) {
                    res.innerHTML = '<div class="sucesso">'
                        + '<i class="fas fa-check-circle"></i> Assinatura registrada com sucesso!'
                        + '<br><small>ID: ' + d.id + ' · ' + new Date(d.criado_em).toLocaleString('pt-BR') + '</small>'
                        + '</div>';
                    res.style.display = '';
                    Estado.pad.off();  // desabilita novo traço
                    document.getElementById('btn-confirmar').style.display = 'none';
                    document.getElementById('btn-limpar').style.display = 'none';
                    // Notifica a janela que abriu este painel (integração painel42)
                    if (window.opener) {
                        window.opener.postMessage({tipo: 'assinatura_ok', id: d.id, ref_id: conteudo.ref_id}, '*');
                    }
                } else {
                    res.innerHTML = '<div class="erro"><i class="fas fa-exclamation-circle"></i> Erro: ' + (d.error || 'Falha') + '</div>';
                    res.style.display = '';
                    document.getElementById('btn-confirmar').disabled = false;
                }
            })
            .catch(function(e) {
                console.error('[P48]', e);
                document.getElementById('btn-confirmar').disabled = false;
            });
        });
    }

    window.addEventListener('DOMContentLoaded', inicializar);
})();
```

---

### Fase 2 — Biometria Facial (AEA, opcional)

**Quando implementar:** Quando houver necessidade de TCLE ou documentos de maior validade jurídica.

**Passos adicionais:**
```
1. Baixar modelos face-api.js (~30 MB total):
   https://github.com/justadudewhohacks/face-api.js/tree/master/weights
   Salvar em: static/models/

2. Adicionar ao index.html do painel48:
   <script src="/static/js/face-api.min.js"></script>

3. Adicionar botão "Capturar foto" que:
   - Abre câmera via getUserMedia
   - Detecta se há um rosto (face-api.detectSingleFace)
   - Captura frame quando rosto detectado
   - Converte para base64 e inclui no payload POST

4. Para liveness básico:
   - Solicitar que a pessoa pisque ou sorria
   - Detectar a mudança de landmarks entre frames
```

---

## 9. CONSIDERAÇÕES LGPD

| Dado | Classificação | Retenção sugerida |
|---|---|---|
| Nome do signatário | Dado pessoal | Conforme política do hospital |
| Imagem da assinatura | Dado pessoal | 5 anos (prazo prescrição civil) |
| Foto biométrica | **Dado sensível** | Somente se necessário, consentimento explícito |
| IP de origem | Dado pessoal | 6 meses (suficiente para auditoria) |
| Hash do documento | Não é dado pessoal | Permanente (não contém PII) |

**Regras de ouro:**
1. Foto biométrica: **nunca armazenar sem consentimento explícito e finalidade justificada**
2. Para protocolo de refeição: assinatura de dedo + log de auditoria é **suficiente e mais seguro**
3. Criptografar a coluna `assinatura_img` no banco se possível (PostgreSQL `pgcrypto`)

---

## 10. CHECKLIST DE IMPLEMENTAÇÃO

### Fase 1 — Assinatura com dedo (AES) — ~2 dias de trabalho

- [ ] Baixar `signature_pad.umd.min.js` e hospedar em `static/js/`
- [ ] Criar tabela `assinaturas_digitais` no PostgreSQL
- [ ] Criar `backend/routes/painel48_routes.py` (endpoints POST/GET)
- [ ] Registrar `painel48_bp` em `app.py`
- [ ] Criar `paineis/painel48/index.html` + `main.js` + `style.css`
- [ ] Adicionar botão "Coletar Assinatura" no Painel 42 (kanban, status "Em Entrega")
- [ ] Adicionar listener `window.message` no Painel 42 para receber callback
- [ ] Adicionar coluna `assinatura_id` na tabela de chamados de nutrição
- [ ] Testar em tablet Android (dispositivo real do hospital)
- [ ] Adicionar permissão `painel48` na interface de admin de usuários

### Fase 2 — Biometria facial (AEA) — ~5 dias adicionais

- [ ] Hospedar modelos face-api.js em `static/models/`
- [ ] Implementar captura de câmera com detecção de rosto
- [ ] Implementar liveness básico (movimento/piscar)
- [ ] Revisar com jurídico/compliance do hospital a necessidade de AEA
- [ ] Atualizar política de privacidade LGPD do hospital

---

## 11. REFERÊNCIAS

- [Lei 14.063/2020 — Assinaturas Eletrônicas](https://www.planalto.gov.br/ccivil_03/_ato2019-2022/2020/lei/l14063.htm)
- [ICP-Brasil — ITI](https://www.gov.br/iti/pt-br)
- [MP 2.200-2/2001](https://www.planalto.gov.br/ccivil_03/mpv/antigas_2001/2200-2.htm)
- [Signature Pad — repositório oficial](https://github.com/szimek/signature_pad)
- [face-api.js — repositório oficial](https://github.com/justadudewhohacks/face-api.js)
- [D4Sign — API de assinatura brasileira](https://d4sign.com.br/api/)
- [Autentique — API GraphQL](https://docs.autentique.com.br/)
- [CFM Resolução 2299/2021 — Prontuário Eletrônico](https://www.cfm.org.br/normas/resolucoes/2021/resolucao-cfm-n-22992021/)
