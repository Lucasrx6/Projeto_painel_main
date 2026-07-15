(function () {
    'use strict';

    var CONFIG = {
        api: '/api/paineis/painel48'
    };

    var Estado = {
        modo: 'hub',          // 'hub' | 'fila_entrega' | 'assinatura' | 'historico'
        contextos: [],
        contextoAtual: null,
        params: {},
        signaturePad: null,
        pinInfo: null,
        isAdmin: false,
        modoFila: false,       // verdadeiro quando navegamos a partir da fila
        voltarParaFila: false  // após comprovante, botão Finalizar volta à fila
    };

    // ── Utilitários ─────────────────────────────────────────────

    function escHtml(str) {
        if (str === null || str === undefined) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    function mascaraCpf(v) {
        v = v.replace(/\D/g, '').slice(0, 11);
        if (v.length <= 3)  return v;
        if (v.length <= 6)  return v.slice(0, 3) + '.' + v.slice(3);
        if (v.length <= 9)  return v.slice(0, 3) + '.' + v.slice(3, 6) + '.' + v.slice(6);
        return v.slice(0, 3) + '.' + v.slice(3, 6) + '.' + v.slice(6, 9) + '-' + v.slice(9, 11);
    }

    function lerParams() {
        var q = (window.location.search || '').replace(/^\?/, '');
        var pares = q.split('&');
        var p = {};
        for (var i = 0; i < pares.length; i++) {
            var kv = pares[i].split('=');
            if (kv.length >= 2) {
                p[decodeURIComponent(kv[0])] = decodeURIComponent(kv.slice(1).join('='));
            }
        }
        return p;
    }

    function toast(msg, tipo) {
        var container = document.getElementById('toast-container');
        if (!container) return;
        var el = document.createElement('div');
        el.className = 'toast toast-' + (tipo || 'info');
        el.innerHTML = escHtml(msg);
        container.appendChild(el);
        setTimeout(function () { el.classList.add('toast-saindo'); }, 3000);
        setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 3500);
    }

    function mostrarLoading() {
        var mc = document.getElementById('main-content');
        if (mc) mc.innerHTML = '<div class="loading"><div class="loading-spinner"></div><span>Carregando...</span></div>';
    }

    function formatarDataHora(iso) {
        if (!iso) return '-';
        var d = new Date(iso);
        return d.toLocaleDateString('pt-BR') + ' ' + d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    }

    function nomeContexto(codigo) {
        var mapa = {
            'entrega_refeicao': 'Entrega de Refeição',
            'alta':             'Alta Hospitalar',
            'tcle':             'Termo de Consentimento'
        };
        return mapa[codigo] || codigo;
    }

    // ── Inicialização ─────────────────────────────────────────

    function inicializar() {
        Estado.params  = lerParams();
        Estado.isAdmin = false;

        var btnVoltar    = document.getElementById('btn-voltar');
        var btnVoltarHub = document.getElementById('btn-voltar-hub');

        if (btnVoltar) {
            btnVoltar.addEventListener('click', function () { window.history.back(); });
        }
        if (btnVoltarHub) {
            btnVoltarHub.addEventListener('click', function () {
                if (Estado.modoFila) {
                    renderizarFilaEntrega();
                } else {
                    irParaHub();
                }
            });
        }

        // Modal comprovante
        var modalComp        = document.getElementById('modal-comprovante');
        var btnCompFechar    = document.getElementById('modal-comp-fechar');
        var btnCompFinalizar = document.getElementById('modal-comp-finalizar');

        if (btnCompFechar && modalComp) {
            btnCompFechar.addEventListener('click', function () { modalComp.style.display = 'none'; });
        }
        if (btnCompFinalizar) {
            btnCompFinalizar.addEventListener('click', function () {
                if (window.opener && !window.opener.closed) {
                    window.close();
                } else if (Estado.voltarParaFila) {
                    if (modalComp) modalComp.style.display = 'none';
                    Estado.voltarParaFila = false;
                    renderizarFilaEntrega();
                } else {
                    if (modalComp) modalComp.style.display = 'none';
                    irParaHub();
                }
            });
        }

        // Modal ver assinatura
        var modalVer       = document.getElementById('modal-ver');
        var btnVerFechar   = document.getElementById('modal-ver-fechar');
        var btnVerFechar2  = document.getElementById('modal-ver-fechar2');
        if (btnVerFechar  && modalVer) { btnVerFechar.addEventListener('click',  function () { modalVer.style.display = 'none'; }); }
        if (btnVerFechar2 && modalVer) { btnVerFechar2.addEventListener('click', function () { modalVer.style.display = 'none'; }); }

        // Modo embedded: contexto + ref_id na URL → vai direto para assinatura
        if (Estado.params.contexto && Estado.params.ref_id) {
            // Cria contexto virtual com as informações da URL
            Estado.contextoAtual = {
                codigo:   Estado.params.contexto,
                nome:     nomeContexto(Estado.params.contexto),
                icone:    Estado.params.icone || 'fa-signature',
                cor:      Estado.params.cor   || '#0d6efd'
            };
            carregarContextos(function () { renderizarAssinatura(); });
        } else {
            carregarContextos(function () { irParaHub(); });
        }
    }

    // ── Carregar contextos ────────────────────────────────────

    function carregarContextos(callback) {
        fetch(CONFIG.api + '/contextos', { credentials: 'same-origin' })
            .then(function (r) { return r.json(); })
            .then(function (d) {
                if (d.success) {
                    Estado.contextos = d.contextos || [];
                }
                if (callback) callback();
            })
            .catch(function (e) {
                console.error('[P48] Erro ao carregar contextos:', e);
                if (callback) callback();
            });
    }

    // ── Hub ────────────────────────────────────────────────────

    function irParaHub() {
        Estado.modo          = 'hub';
        Estado.contextoAtual = null;
        Estado.signaturePad  = null;
        Estado.pinInfo       = null;
        document.getElementById('titulo-painel').textContent = 'Assinatura Digital — HUB';
        var btnVoltarHub = document.getElementById('btn-voltar-hub');
        if (btnVoltarHub) btnVoltarHub.style.display = 'none';
        renderizarHub();
    }

    function renderizarHub() {
        var mc = document.getElementById('main-content');
        if (!mc) return;

        if (Estado.contextos.length === 0) {
            mc.innerHTML = '<div class="hub-vazio">'
                + '<i class="fas fa-lock" style="font-size:48px;color:#adb5bd;"></i>'
                + '<p>Nenhum contexto de assinatura disponível para você.</p>'
                + '<p style="font-size:13px;color:#6c757d;">Solicite ao administrador a liberação do acesso.</p>'
                + '</div>';
            return;
        }

        var html = '<div class="hub-grid">';
        for (var i = 0; i < Estado.contextos.length; i++) {
            var ctx = Estado.contextos[i];
            html += '<div class="hub-card" data-codigo="' + escHtml(ctx.codigo) + '">'
                + '<div class="hub-card-icone" style="background:' + escHtml(ctx.cor) + ';">'
                + '<i class="fas ' + escHtml(ctx.icone) + '"></i>'
                + '</div>'
                + '<div class="hub-card-info">'
                + '<strong>' + escHtml(ctx.nome) + '</strong>'
                + (ctx.descricao ? '<p>' + escHtml(ctx.descricao) + '</p>' : '')
                + '</div>'
                + '<div class="hub-card-acoes">'
                + '<button class="btn-hub-assinar" data-acao="assinar" data-codigo="' + escHtml(ctx.codigo) + '">'
                + '<i class="fas fa-pen-nib"></i> Coletar Assinatura</button>'
                + '<button class="btn-hub-hist" data-acao="historico" data-codigo="' + escHtml(ctx.codigo) + '">'
                + '<i class="fas fa-history"></i> Histórico</button>'
                + '</div>'
                + '</div>';
        }
        html += '</div>';

        if (Estado.isAdmin) {
            html += '<div class="hub-admin-link">'
                + '<button class="btn-admin" data-acao="admin"><i class="fas fa-cog"></i> Administração</button>'
                + '</div>';
        }

        mc.innerHTML = html;

        // Eventos
        mc.addEventListener('click', function (e) {
            var el = e.target;
            while (el && el !== mc) {
                var acao   = el.getAttribute ? el.getAttribute('data-acao')   : null;
                var codigo = el.getAttribute ? el.getAttribute('data-codigo') : null;
                if (acao && codigo) {
                    var ctx = encontrarContexto(codigo);
                    if (ctx) {
                        Estado.contextoAtual = ctx;
                        if (acao === 'assinar') {
                            if (codigo === 'entrega_refeicao') {
                                renderizarFilaEntrega();
                            } else {
                                Estado.modoFila = false;
                                Estado.params   = {};
                                renderizarAssinatura();
                            }
                            return;
                        }
                        if (acao === 'historico') { renderizarHistorico(); return; }
                    }
                }
                if (acao === 'admin') { renderizarAdmin(); return; }
                el = el.parentNode;
            }
        });
    }

    function encontrarContexto(codigo) {
        for (var i = 0; i < Estado.contextos.length; i++) {
            if (Estado.contextos[i].codigo === codigo) return Estado.contextos[i];
        }
        return null;
    }

    // ── Tela de Assinatura ─────────────────────────────────────

    function renderizarAssinatura() {
        Estado.modo         = 'assinatura';
        Estado.signaturePad = null;
        Estado.pinInfo      = null;

        var ctx = Estado.contextoAtual;
        var p   = Estado.params;

        var btnVoltarHub = document.getElementById('btn-voltar-hub');
        if (btnVoltarHub) {
            btnVoltarHub.style.display = (Estado.modoFila || !p.ref_id) ? '' : 'none';
        }
        if (ctx) {
            document.getElementById('titulo-painel').textContent = ctx.nome || 'Assinatura Digital';
        }

        // Montar informações do documento (da URL ou genérico)
        var infoDoc = '';
        if (p.nm_paciente) {
            infoDoc += '<div class="doc-info-item"><span>Paciente</span><strong>' + escHtml(p.nm_paciente) + '</strong></div>';
        }
        if (p.nr_atendimento) {
            infoDoc += '<div class="doc-info-item"><span>Atendimento</span><strong>' + escHtml(p.nr_atendimento) + '</strong></div>';
        }
        if (p.info_extra) {
            infoDoc += '<div class="doc-info-item"><span>Informação</span><strong>' + escHtml(p.info_extra) + '</strong></div>';
        }

        var corCtx = (ctx && ctx.cor) ? ctx.cor : '#0d6efd';

        var mc = document.getElementById('main-content');
        if (!mc) return;
        mc.innerHTML = ''
            + '<div class="assin-container">'
            + (infoDoc ? '<div class="doc-info-bar">' + infoDoc + '</div>' : '')
            + '<div class="assin-card">'
            // Dados do assinante
            + '<div class="assin-secao">'
            + '<h3 class="assin-secao-titulo"><i class="fas fa-user"></i> Dados do Assinante</h3>'
            + '<div class="form-row">'
            + '<div class="form-group">'
            + '<label>Nome de quem está assinando <span class="req">*</span></label>'
            + '<input type="text" id="inp-signatario" placeholder="Nome completo" autocomplete="off">'
            + '</div>'
            + '</div>'
            + '<div class="form-row">'
            + '<div class="form-group">'
            + '<label>CPF do assinante <span class="form-hint">(alternativa à assinatura desenhada)</span></label>'
            + '<input type="text" id="inp-cpf-signatario" placeholder="000.000.000-00" maxlength="14" autocomplete="off" inputmode="numeric">'
            + '</div>'
            + '<div class="form-group form-group-sm">'
            + '<label>Qualidade</label>'
            + '<select id="sel-qualidade">'
            + '<option value="paciente">Paciente</option>'
            + '<option value="familiar">Familiar / Acompanhante</option>'
            + '<option value="responsavel_legal">Responsável Legal</option>'
            + '</select>'
            + '</div>'
            + '</div>'
            + '</div>'
            // Área de assinatura
            + '<div class="assin-secao">'
            + '<h3 class="assin-secao-titulo"><i class="fas fa-pen-nib"></i> Assinatura</h3>'
            + '<div class="canvas-wrapper">'
            + '<canvas id="canvas-assinatura"></canvas>'
            + '<div class="canvas-hint">Assine aqui com o dedo ou caneta</div>'
            + '</div>'
            + '<button class="btn-limpar-canvas" id="btn-limpar"><i class="fas fa-eraser"></i> Limpar</button>'
            + '</div>'
            // PIN
            + '<div class="assin-secao">'
            + '<h3 class="assin-secao-titulo"><i class="fas fa-key"></i> PIN do Coletor</h3>'
            + '<p class="pin-descricao">Informe sua matrícula para autenticar a coleta desta assinatura.</p>'
            + '<div class="pin-row">'
            + '<input type="text" id="inp-pin" class="inp-pin" placeholder="Matrícula" maxlength="20" autocomplete="off">'
            + '<button class="btn-validar-pin" id="btn-validar-pin"><i class="fas fa-check"></i> Validar</button>'
            + '</div>'
            + '<div class="pin-resultado" id="pin-resultado"></div>'
            + '</div>'
            // Botão confirmar
            + '<div class="assin-footer">'
            + '<button class="btn-confirmar-assin" id="btn-confirmar" disabled>'
            + '<i class="fas fa-check-circle"></i> Confirmar Assinatura</button>'
            + '</div>'
            + '</div>'
            + '</div>';

        // Inicializar SignaturePad
        var canvas = document.getElementById('canvas-assinatura');
        if (canvas) {
            var ratio = Math.max(window.devicePixelRatio || 1, 1);
            canvas.width  = canvas.offsetWidth  * ratio || 600;
            canvas.height = canvas.offsetHeight * ratio || 200;
            var ctx2d = canvas.getContext('2d');
            if (ctx2d) ctx2d.scale(ratio, ratio);
            Estado.signaturePad = new SignaturePad(canvas, {
                backgroundColor: 'rgb(255,255,255)',
                penColor:        corCtx,
                minWidth: 1.5,
                maxWidth: 4
            });
        }

        // Máscara CPF
        var inpCpf = document.getElementById('inp-cpf-signatario');
        if (inpCpf) {
            inpCpf.addEventListener('input', function () {
                var pos = this.selectionStart;
                this.value = mascaraCpf(this.value);
                try { this.setSelectionRange(pos, pos); } catch (e) { /* ignore */ }
            });
        }

        // Botão limpar
        var btnLimpar = document.getElementById('btn-limpar');
        if (btnLimpar) {
            btnLimpar.addEventListener('click', function () {
                if (Estado.signaturePad) Estado.signaturePad.clear();
            });
        }

        // Validar PIN
        var btnValPin = document.getElementById('btn-validar-pin');
        if (btnValPin) {
            btnValPin.addEventListener('click', validarPin);
        }
        var inpPin = document.getElementById('inp-pin');
        if (inpPin) {
            inpPin.addEventListener('keydown', function (e) {
                if (e.key === 'Enter') validarPin();
            });
        }

        // Confirmar assinatura
        var btnConf = document.getElementById('btn-confirmar');
        if (btnConf) {
            btnConf.addEventListener('click', confirmarAssinatura);
        }
    }

    function validarPin() {
        var inpPin = document.getElementById('inp-pin');
        var resultado = document.getElementById('pin-resultado');
        var btnConf   = document.getElementById('btn-confirmar');
        if (!inpPin || !resultado) return;

        var matricula = inpPin.value.trim();
        if (!matricula) {
            resultado.innerHTML = '<span class="pin-erro"><i class="fas fa-times"></i> Informe a matrícula.</span>';
            return;
        }

        resultado.innerHTML = '<span class="pin-validando"><i class="fas fa-spinner fa-spin"></i> Validando...</span>';

        fetch(CONFIG.api + '/validar-pin', {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ matricula: matricula })
        })
        .then(function (r) { return r.json(); })
        .then(function (d) {
            if (d.success) {
                Estado.pinInfo = d.membro;
                resultado.innerHTML = '<span class="pin-ok">'
                    + '<i class="fas fa-check-circle"></i> '
                    + escHtml(d.membro.nome)
                    + ' (' + escHtml(d.membro.funcao || d.membro.turno || '') + ')'
                    + '</span>';
                if (btnConf) btnConf.disabled = false;
            } else {
                Estado.pinInfo = null;
                resultado.innerHTML = '<span class="pin-erro"><i class="fas fa-times-circle"></i> ' + escHtml(d.error || 'Matrícula não encontrada') + '</span>';
                if (btnConf) btnConf.disabled = true;
            }
        })
        .catch(function (e) {
            console.error('[P48] Erro validar PIN:', e);
            resultado.innerHTML = '<span class="pin-erro"><i class="fas fa-exclamation-circle"></i> Erro de comunicação.</span>';
        });
    }

    function confirmarAssinatura() {
        var signatario = (document.getElementById('inp-signatario') || {}).value;
        signatario = (signatario || '').trim();
        if (!signatario) {
            toast('Informe o nome de quem está assinando.', 'aviso');
            return;
        }

        var cpfSigantario = (document.getElementById('inp-cpf-signatario') || {}).value;
        cpfSigantario = (cpfSigantario || '').trim() || null;

        var canvasVazio = !Estado.signaturePad || Estado.signaturePad.isEmpty();
        if (canvasVazio && !cpfSigantario) {
            toast('Realize a assinatura desenhada OU informe o CPF do assinante.', 'aviso');
            return;
        }

        if (!Estado.pinInfo) {
            toast('Valide o PIN (matrícula) antes de confirmar.', 'aviso');
            return;
        }

        var btnConf = document.getElementById('btn-confirmar');
        if (btnConf) btnConf.disabled = true;

        var qualidade = (document.getElementById('sel-qualidade') || {}).value || 'paciente';
        var ctx       = Estado.contextoAtual || {};
        var p         = Estado.params;
        var imgBase64 = canvasVazio ? null : Estado.signaturePad.toDataURL('image/png');

        var conteudo = {
            contexto:       ctx.codigo || '',
            ref_id:         p.ref_id   || null,
            nr_atendimento: p.nr_atendimento || '',
            nm_paciente:    p.nm_paciente    || '',
            nm_signatario:  signatario,
            nm_signatario_cpf: cpfSigantario || null,
            qualidade:      qualidade,
            ts_captura:     new Date().toISOString()
        };
        var conteudoJson = JSON.stringify(conteudo);

        var refId = p.ref_id ? parseInt(p.ref_id, 10) : null;
        if (isNaN(refId)) refId = null;

        var body = {
            contexto:             ctx.codigo || '',
            ref_tabela:           p.ref_tabela || null,
            ref_id:               refId,
            nr_atendimento:       p.nr_atendimento || null,
            nm_signatario:        signatario,
            nm_signatario_cpf:    cpfSigantario || null,
            qualidade_signatario: qualidade,
            assinatura_img:       imgBase64 || null,
            foto_signatario:      null,
            conteudo_json:        conteudoJson,
            matricula_pin:        Estado.pinInfo.matricula
        };

        fetch(CONFIG.api + '/assinar', {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        })
        .then(function (r) { return r.json(); })
        .then(function (d) {
            if (d.success) {
                if (window.opener && !window.opener.closed) {
                    // Modo popup (aberto pelo Painel 42): notifica e fecha
                    window.opener.postMessage({
                        tipo:     'assinatura_ok',
                        id:       d.id,
                        ref_id:   refId,
                        contexto: ctx.codigo
                    }, window.location.origin);
                    window.close();
                } else if (ctx.codigo === 'entrega_refeicao' && refId) {
                    // Modo fila: confirma entrega no Painel 42 e depois mostra comprovante
                    _confirmarEntregaAssinada(d, refId, signatario, imgBase64, conteudo);
                } else {
                    mostrarComprovante(d, signatario, imgBase64, conteudo);
                }
            } else {
                toast('Erro: ' + (d.error || 'Falha ao salvar'), 'erro');
                if (btnConf) btnConf.disabled = false;
            }
        })
        .catch(function (e) {
            console.error('[P48] Erro assinar:', e);
            toast('Erro de comunicação.', 'erro');
            if (btnConf) btnConf.disabled = false;
        });
    }

    // ── Confirmar entrega após assinatura (modo fila) ─────────

    function _confirmarEntregaAssinada(d, refId, signatario, imgBase64, conteudo) {
        fetch('/api/paineis/painel42/solicitacoes/' + refId + '/entregar-assinado', {
            method: 'PUT',
            credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ assinatura_id: d.id })
        })
        .then(function (r) { return r.json(); })
        .then(function (resp) {
            if (!resp.success) {
                toast('Assinatura salva. Aviso: ' + (resp.error || 'Erro ao confirmar entrega'), 'aviso');
            }
            Estado.voltarParaFila = Estado.modoFila;
            mostrarComprovante(d, signatario, imgBase64, conteudo);
        })
        .catch(function () {
            toast('Assinatura salva. Verifique a entrega no Painel 42.', 'aviso');
            Estado.voltarParaFila = Estado.modoFila;
            mostrarComprovante(d, signatario, imgBase64, conteudo);
        });
    }

    // ── Fila de entrega ────────────────────────────────────────

    function renderizarFilaEntrega() {
        Estado.modo    = 'fila_entrega';
        Estado.modoFila = true;
        Estado.params  = {};
        var btnVoltarHub = document.getElementById('btn-voltar-hub');
        if (btnVoltarHub) btnVoltarHub.style.display = '';
        document.getElementById('titulo-painel').textContent = 'Entrega de Refeição — Assinaturas';
        mostrarLoading();
        fetch(CONFIG.api + '/fila-entrega', { credentials: 'same-origin' })
            .then(function (r) { return r.json(); })
            .then(function (d) {
                if (d.success) {
                    renderizarListaFila(d.fila || []);
                } else {
                    var mc = document.getElementById('main-content');
                    if (mc) mc.innerHTML = '<div class="fila-vazio"><i class="fas fa-exclamation-circle"></i><p>' + escHtml(d.error || 'Erro ao carregar fila') + '</p></div>';
                }
            })
            .catch(function () {
                var mc = document.getElementById('main-content');
                if (mc) mc.innerHTML = '<div class="fila-vazio"><i class="fas fa-exclamation-circle"></i><p>Erro de comunicação.</p></div>';
            });
    }

    function renderizarListaFila(fila) {
        var mc = document.getElementById('main-content');
        if (!mc) return;

        var pendentes = 0;
        for (var i = 0; i < fila.length; i++) {
            if (!fila[i].ja_assinado) pendentes++;
        }

        var totalInfo = fila.length + ' em entrega'
            + (pendentes < fila.length
                ? ' &bull; <strong>' + pendentes + ' sem assinatura</strong>'
                : '');

        var html = '<div class="fila-entrega-container">'
            + '<div class="fila-entrega-header">'
            + '<div>'
            + '<div class="fila-entrega-titulo"><i class="fas fa-list-check"></i> Entregas Aguardando Assinatura</div>'
            + '<div class="fila-entrega-total">' + totalInfo + '</div>'
            + '</div>'
            + '<button class="btn-fila-refresh" id="btn-fila-refresh"><i class="fas fa-sync-alt"></i> Atualizar</button>'
            + '</div>';

        if (fila.length === 0) {
            html += '<div class="fila-vazio"><i class="fas fa-check-circle" style="color:#198754;"></i>'
                + '<p>Nenhuma entrega em andamento no momento.</p></div>';
        } else {
            html += '<div class="fila-entrega-lista">';
            for (var j = 0; j < fila.length; j++) {
                var item  = fila[j];
                var isUrg = item.prioridade === 'urgente';
                var isSig = item.ja_assinado;

                var cardClass = 'fila-card';
                if (isUrg) cardClass += ' fila-card-urgente';
                if (isSig) cardClass += ' fila-card-assinado';

                var badges = '';
                if (isUrg) badges += '<span class="badge-urg"><i class="fas fa-bolt"></i> Urgente</span>';
                if (isSig) badges += '<span class="badge-fila-assinado"><i class="fas fa-check"></i> Assinado</span>';

                var min = Number(item.minutos || 0);
                var tempoStr = min < 60 ? (min + 'min') : (Math.floor(min / 60) + 'h ' + (min % 60) + 'min');

                var btnHtml = isSig
                    ? '<button class="btn-fila-rassinar" data-fila-id="' + item.id + '">'
                        + '<i class="fas fa-redo"></i> Re-assinar</button>'
                    : '<button class="btn-fila-assinar" data-fila-id="' + item.id + '">'
                        + '<i class="fas fa-pen-nib"></i> Assinar</button>';

                var dieta = escHtml(item.tipo_dieta_nome || '--');
                if (item.refeicao_nome) dieta += ' &mdash; ' + escHtml(item.refeicao_nome);

                html += '<div class="' + cardClass + '">'
                    + '<div class="fila-card-body">'
                    + '<div class="fila-card-topo">'
                    + '<div>'
                    + '<div class="fila-card-nome">' + escHtml(item.nm_paciente || '--') + '</div>'
                    + (item.codigo_entrega ? '<div class="fila-card-codigo">' + escHtml(item.codigo_entrega) + '</div>' : '')
                    + '</div>'
                    + '<div class="fila-card-badges">' + badges + '</div>'
                    + '</div>'
                    + '<div class="fila-card-info">'
                    + '<span><i class="fas fa-bed"></i> <strong>' + escHtml(item.leito || '--') + '</strong></span>'
                    + '<span><i class="fas fa-hospital-alt"></i> ' + escHtml(item.setor_nome || '--') + '</span>'
                    + '<span><i class="fas fa-utensils"></i> ' + dieta + '</span>'
                    + '</div>'
                    + '<div class="fila-card-footer">'
                    + '<div class="fila-card-tempo">'
                    + '<i class="fas fa-clock"></i> Em entrega há ' + escHtml(tempoStr)
                    + (item.responsavel_nome ? ' &bull; ' + escHtml(item.responsavel_nome) : '')
                    + '</div>'
                    + btnHtml
                    + '</div>'
                    + '</div>'
                    + '</div>';
            }
            html += '</div>';
        }
        html += '</div>';
        mc.innerHTML = html;

        mc.addEventListener('click', function (e) {
            var el = e.target;
            while (el && el !== mc) {
                if (el.id === 'btn-fila-refresh') { renderizarFilaEntrega(); return; }
                var fid = el.getAttribute ? el.getAttribute('data-fila-id') : null;
                if (fid) {
                    var sid = parseInt(fid, 10);
                    for (var k = 0; k < fila.length; k++) {
                        if (fila[k].id === sid) { selecionarItemFila(fila[k]); return; }
                    }
                }
                el = el.parentNode;
            }
        });
    }

    function selecionarItemFila(item) {
        var infoExtra = item.tipo_dieta_nome || '';
        if (item.refeicao_nome) infoExtra += (infoExtra ? ' — ' : '') + item.refeicao_nome;
        Estado.params = {
            contexto:       'entrega_refeicao',
            ref_id:         String(item.id),
            ref_tabela:     'nutricao_solicitacoes',
            nm_paciente:    item.nm_paciente    || '',
            nr_atendimento: item.nr_atendimento || '',
            info_extra:     infoExtra
        };
        Estado.contextoAtual = {
            codigo: 'entrega_refeicao',
            nome:   'Entrega de Refeição',
            icone:  'fa-utensils',
            cor:    '#198754'
        };
        renderizarAssinatura();
    }

    function mostrarComprovante(d, signatario, imgBase64, conteudo) {
        var modalComp = document.getElementById('modal-comprovante');
        var bodyComp  = document.getElementById('modal-comp-body');
        if (!modalComp || !bodyComp) return;

        var dtHora = formatarDataHora(d.criado_em);

        bodyComp.innerHTML = ''
            + '<div class="comp-row"><span>ID da Assinatura</span><strong>#' + escHtml(String(d.id)) + '</strong></div>'
            + (conteudo.nm_paciente ? '<div class="comp-row"><span>Paciente</span><strong>' + escHtml(conteudo.nm_paciente) + '</strong></div>' : '')
            + '<div class="comp-row"><span>Assinado por</span><strong>' + escHtml(signatario) + '</strong></div>'
            + '<div class="comp-row"><span>Coletado por</span><strong>' + escHtml(d.coletor || Estado.pinInfo.nome) + '</strong></div>'
            + '<div class="comp-row"><span>Data / Hora</span><strong>' + escHtml(dtHora) + '</strong></div>'
            + (imgBase64
                ? '<div class="comp-assinatura-preview"><p>Assinatura coletada:</p>'
                    + '<img src="' + imgBase64 + '" alt="Assinatura" style="max-width:100%;border:1px solid #dee2e6;border-radius:6px;"></div>'
                : (conteudo.nm_signatario_cpf
                    ? '<div class="comp-row"><span>CPF do assinante</span><strong>' + escHtml(conteudo.nm_signatario_cpf) + '</strong></div>'
                    : ''));

        var btnFin = document.getElementById('modal-comp-finalizar');
        if (btnFin) {
            btnFin.innerHTML = Estado.voltarParaFila
                ? '<i class="fas fa-arrow-left"></i> Voltar à Fila'
                : '<i class="fas fa-check"></i> Finalizar';
        }

        modalComp.style.display = 'flex';
    }

    // ── Histórico ──────────────────────────────────────────────

    function renderizarHistorico() {
        Estado.modo = 'historico';
        var ctx = Estado.contextoAtual;
        var btnVoltarHub = document.getElementById('btn-voltar-hub');
        if (btnVoltarHub) btnVoltarHub.style.display = '';
        if (ctx) {
            document.getElementById('titulo-painel').textContent = 'Histórico — ' + (ctx.nome || '');
        }

        mostrarLoading();

        var hoje = new Date();
        var data = hoje.getFullYear() + '-' + pad2(hoje.getMonth() + 1) + '-' + pad2(hoje.getDate());

        fetch(CONFIG.api + '/historico?contexto=' + encodeURIComponent((ctx || {}).codigo || '') + '&data=' + data, {
            credentials: 'same-origin'
        })
        .then(function (r) { return r.json(); })
        .then(function (d) {
            if (d.success) renderizarTabelaHistorico(d.historico, data);
            else toast('Erro ao carregar histórico', 'erro');
        })
        .catch(function (e) {
            console.error('[P48] Erro histórico:', e);
            toast('Erro de comunicação', 'erro');
        });
    }

    function renderizarTabelaHistorico(lista, data) {
        var mc = document.getElementById('main-content');
        if (!mc) return;

        var html = '<div class="historico-container">'
            + '<div class="historico-topo">'
            + '<div class="hist-filtro-data">'
            + '<input type="date" id="inp-hist-data" value="' + escHtml(data) + '">'
            + '<button id="btn-hist-buscar" class="btn-hist-buscar"><i class="fas fa-search"></i> Buscar</button>'
            + '</div>'
            + '<span class="hist-total">' + lista.length + ' registro(s)</span>'
            + '</div>';

        if (lista.length === 0) {
            html += '<div class="hist-vazio"><i class="fas fa-inbox"></i><p>Nenhuma assinatura neste dia.</p></div>';
        } else {
            html += '<div class="hist-table-wrap"><table class="hist-table">'
                + '<thead><tr>'
                + '<th>#</th><th>Horário</th><th>Paciente / Atend.</th>'
                + '<th>Assinante</th><th>Qualidade</th><th>Coletado por</th><th></th>'
                + '</tr></thead><tbody>';

            for (var i = 0; i < lista.length; i++) {
                var reg = lista[i];
                var qualLabel = { paciente: 'Paciente', familiar: 'Familiar', responsavel_legal: 'Resp. Legal' };
                var dt = reg.criado_em ? new Date(reg.criado_em).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '-';
                html += '<tr>'
                    + '<td><strong>#' + escHtml(String(reg.id)) + '</strong></td>'
                    + '<td>' + escHtml(dt) + '</td>'
                    + '<td>' + escHtml(reg.nm_signatario && reg.nr_atendimento ? reg.nr_atendimento : (reg.nr_atendimento || '-')) + '</td>'
                    + '<td>' + escHtml(reg.nm_signatario || '-') + '</td>'
                    + '<td><span class="badge-qual">' + escHtml(qualLabel[reg.qualidade_signatario] || reg.qualidade_signatario || '-') + '</span></td>'
                    + '<td>' + escHtml(reg.coletado_por_nome_equipe || reg.coletado_por_nome || '-') + '</td>'
                    + '<td><button class="btn-ver-assin" data-acao="ver" data-id="' + escHtml(String(reg.id)) + '">'
                    + '<i class="fas fa-eye"></i></button></td>'
                    + '</tr>';
            }
            html += '</tbody></table></div>';
        }
        html += '</div>';
        mc.innerHTML = html;

        // Filtro por data
        var btnBuscar = document.getElementById('btn-hist-buscar');
        if (btnBuscar) {
            btnBuscar.addEventListener('click', function () {
                var inpData = document.getElementById('inp-hist-data');
                var novaData = (inpData && inpData.value) || data;
                mostrarLoading();
                var ctx = Estado.contextoAtual;
                fetch(CONFIG.api + '/historico?contexto=' + encodeURIComponent((ctx || {}).codigo || '') + '&data=' + encodeURIComponent(novaData), {
                    credentials: 'same-origin'
                })
                .then(function (r) { return r.json(); })
                .then(function (d) {
                    if (d.success) renderizarTabelaHistorico(d.historico, novaData);
                    else toast('Erro ao carregar histórico', 'erro');
                })
                .catch(function () { toast('Erro de comunicação', 'erro'); });
            });
        }

        // Ver assinatura individual
        mc.addEventListener('click', function (e) {
            var el = e.target;
            while (el && el !== mc) {
                var acao = el.getAttribute ? el.getAttribute('data-acao') : null;
                if (acao === 'ver') {
                    var id = parseInt(el.getAttribute('data-id') || '0', 10);
                    if (id) verAssinatura(id);
                    return;
                }
                el = el.parentNode;
            }
        });
    }

    function verAssinatura(id) {
        fetch(CONFIG.api + '/assinatura/' + id, { credentials: 'same-origin' })
        .then(function (r) { return r.json(); })
        .then(function (d) {
            if (!d.success || !d.assinatura) { toast('Assinatura não encontrada', 'erro'); return; }
            var a  = d.assinatura;
            var dt = formatarDataHora(a.criado_em);
            var qualLabel = { paciente: 'Paciente', familiar: 'Familiar', responsavel_legal: 'Resp. Legal' };
            var bodyVer = document.getElementById('modal-ver-body');
            if (bodyVer) {
                bodyVer.innerHTML = ''
                    + '<div class="comp-row"><span>ID</span><strong>#' + escHtml(String(a.id)) + '</strong></div>'
                    + '<div class="comp-row"><span>Contexto</span><strong>' + escHtml(nomeContexto(a.contexto)) + '</strong></div>'
                    + (a.nr_atendimento ? '<div class="comp-row"><span>Atendimento</span><strong>' + escHtml(a.nr_atendimento) + '</strong></div>' : '')
                    + '<div class="comp-row"><span>Assinante</span><strong>' + escHtml(a.nm_signatario || '-') + '</strong></div>'
                    + '<div class="comp-row"><span>Qualidade</span><strong>' + escHtml(qualLabel[a.qualidade_signatario] || a.qualidade_signatario || '-') + '</strong></div>'
                    + '<div class="comp-row"><span>Coletado por</span><strong>' + escHtml(a.coletado_por_nome_equipe || a.coletado_por_nome || '-') + '</strong></div>'
                    + '<div class="comp-row"><span>Data / Hora</span><strong>' + escHtml(dt) + '</strong></div>'
                    + '<div class="comp-row"><span>Hash SHA-256</span><code style="font-size:10px;word-break:break-all;">' + escHtml(a.hash_conteudo || '') + '</code></div>'
                    + (a.assinatura_img ? '<div class="comp-assinatura-preview"><p>Assinatura:</p><img src="' + escHtml(a.assinatura_img) + '" alt="Assinatura" style="max-width:100%;border:1px solid #dee2e6;border-radius:6px;"></div>' : '');
            }
            var modalVer = document.getElementById('modal-ver');
            if (modalVer) modalVer.style.display = 'flex';
        })
        .catch(function (e) {
            console.error('[P48] Erro ver assinatura:', e);
            toast('Erro ao carregar assinatura', 'erro');
        });
    }

    // ── Admin ──────────────────────────────────────────────────

    function renderizarAdmin() {
        Estado.modo = 'admin';
        var btnVoltarHub = document.getElementById('btn-voltar-hub');
        if (btnVoltarHub) btnVoltarHub.style.display = '';
        document.getElementById('titulo-painel').textContent = 'Assinatura Digital — Administração';

        mostrarLoading();

        // Carregar contextos (admin) e usuários em paralelo
        var pCtx = fetch(CONFIG.api + '/admin/contextos', { credentials: 'same-origin' }).then(function (r) { return r.json(); });
        var pUsr = fetch(CONFIG.api + '/admin/usuarios',  { credentials: 'same-origin' }).then(function (r) { return r.json(); });
        var pPerm = fetch(CONFIG.api + '/admin/permissoes', { credentials: 'same-origin' }).then(function (r) { return r.json(); });

        Promise.all([pCtx, pUsr, pPerm]).then(function (resultados) {
            var dCtx  = resultados[0];
            var dUsr  = resultados[1];
            var dPerm = resultados[2];
            renderizarAdminView(
                dCtx.contextos  || [],
                dUsr.usuarios   || [],
                dPerm.permissoes || []
            );
        }).catch(function (e) {
            console.error('[P48] Erro admin:', e);
            toast('Erro ao carregar administração', 'erro');
        });
    }

    function renderizarAdminView(contextos, usuarios, permissoes) {
        var mc = document.getElementById('main-content');
        if (!mc) return;

        // Tabela de contextos
        var htmlCtx = '<section class="admin-secao">'
            + '<h3><i class="fas fa-list-alt"></i> Contextos de Assinatura</h3>'
            + '<table class="admin-table"><thead><tr><th>Código</th><th>Nome</th><th>Ativo</th></tr></thead><tbody>';
        for (var i = 0; i < contextos.length; i++) {
            var c = contextos[i];
            htmlCtx += '<tr>'
                + '<td><code>' + escHtml(c.codigo) + '</code></td>'
                + '<td>' + escHtml(c.nome) + '</td>'
                + '<td>' + (c.ativo ? '<span class="badge-ok">Ativo</span>' : '<span class="badge-off">Inativo</span>') + '</td>'
                + '</tr>';
        }
        htmlCtx += '</tbody></table></section>';

        // Formulário para conceder permissão
        var optsCtx = '';
        for (var j = 0; j < contextos.length; j++) {
            optsCtx += '<option value="' + escHtml(contextos[j].codigo) + '">' + escHtml(contextos[j].nome) + '</option>';
        }
        var optsUsr = '<option value="">Selecione...</option>';
        for (var k = 0; k < usuarios.length; k++) {
            optsUsr += '<option value="' + escHtml(String(usuarios[k].id)) + '">'
                + escHtml(usuarios[k].nome_completo || usuarios[k].usuario) + '</option>';
        }

        var htmlPerm = '<section class="admin-secao">'
            + '<h3><i class="fas fa-user-shield"></i> Permissões por Usuário</h3>'
            + '<div class="admin-form">'
            + '<select id="adm-sel-usuario">' + optsUsr + '</select>'
            + '<select id="adm-sel-contexto">' + optsCtx + '</select>'
            + '<button id="adm-btn-conceder"><i class="fas fa-plus"></i> Conceder</button>'
            + '</div>'
            + '<table class="admin-table" id="tabela-permissoes"><thead><tr>'
            + '<th>Usuário</th><th>Contexto</th><th>Status</th><th></th>'
            + '</tr></thead><tbody>';

        for (var m = 0; m < permissoes.length; m++) {
            var pe = permissoes[m];
            if (!pe.ativo) continue;
            htmlPerm += '<tr>'
                + '<td>' + escHtml(pe.nome_completo || pe.usuario) + '</td>'
                + '<td>' + escHtml(pe.contexto_nome) + '</td>'
                + '<td><span class="badge-ok">Ativo</span></td>'
                + '<td><button class="btn-revogar" data-acao="revogar" data-id="' + escHtml(String(pe.id)) + '">'
                + '<i class="fas fa-ban"></i></button></td>'
                + '</tr>';
        }
        htmlPerm += '</tbody></table></section>';

        mc.innerHTML = htmlCtx + htmlPerm;

        // Evento: conceder permissão
        var btnConceder = document.getElementById('adm-btn-conceder');
        if (btnConceder) {
            btnConceder.addEventListener('click', function () {
                var usuarioId = (document.getElementById('adm-sel-usuario') || {}).value;
                var codigoCx  = (document.getElementById('adm-sel-contexto') || {}).value;
                if (!usuarioId) { toast('Selecione um usuário', 'aviso'); return; }
                if (!codigoCx)  { toast('Selecione um contexto', 'aviso'); return; }
                fetch(CONFIG.api + '/admin/permissoes', {
                    method: 'POST',
                    credentials: 'same-origin',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ usuario_id: parseInt(usuarioId, 10), contexto_codigo: codigoCx })
                }).then(function (r) { return r.json(); }).then(function (d) {
                    if (d.success) { toast('Permissão concedida', 'ok'); renderizarAdmin(); }
                    else toast('Erro: ' + (d.error || ''), 'erro');
                }).catch(function () { toast('Erro de comunicação', 'erro'); });
            });
        }

        // Eventos: revogar permissão
        mc.addEventListener('click', function (e) {
            var el = e.target;
            while (el && el !== mc) {
                var acao = el.getAttribute ? el.getAttribute('data-acao') : null;
                if (acao === 'revogar') {
                    var permId = parseInt(el.getAttribute('data-id') || '0', 10);
                    if (permId) {
                        fetch(CONFIG.api + '/admin/permissoes/' + permId, {
                            method: 'DELETE',
                            credentials: 'same-origin'
                        }).then(function (r) { return r.json(); }).then(function (d) {
                            if (d.success) { toast('Permissão revogada', 'ok'); renderizarAdmin(); }
                            else toast('Erro ao revogar', 'erro');
                        }).catch(function () { toast('Erro de comunicação', 'erro'); });
                    }
                    return;
                }
                el = el.parentNode;
            }
        });
    }

    // ── Auxiliar ──────────────────────────────────────────────

    function pad2(n) { return n < 10 ? '0' + n : String(n); }

    window.addEventListener('DOMContentLoaded', inicializar);
})();
