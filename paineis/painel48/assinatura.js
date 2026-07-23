(function () {
    'use strict';

    // ── Tela de assinatura ────────────────────────────────────────

    function renderizarAssinatura() {
        var E   = window.P48.Estado;
        var ctx = E.contextoAtual;
        var p   = E.params;

        E.modo         = 'assinatura';
        E.signaturePad = null;
        E.pinInfo      = null;

        var btnVoltar = document.getElementById('btn-voltar-hub');
        if (btnVoltar) {
            btnVoltar.style.display = (E.modoFila || !p.ref_id) ? '' : 'none';
        }
        if (ctx) {
            document.getElementById('titulo-painel').textContent = ctx.nome || 'Assinatura Digital';
        }

        var infoDoc = _montarInfoDoc(p);
        var corCtx  = (ctx && ctx.cor) ? ctx.cor : '#0d6efd';
        var mc      = document.getElementById('main-content');
        if (!mc) return;

        mc.innerHTML = _htmlFormulario(infoDoc);
        _inicializarCanvas(corCtx);
        _vincularEventos();
    }

    function _montarInfoDoc(p) {
        var esc  = window.P48.escHtml;
        var html = '';
        if (p.nm_paciente)    html += '<div class="doc-info-item"><span>Paciente</span><strong>'     + esc(p.nm_paciente)    + '</strong></div>';
        if (p.nr_atendimento) html += '<div class="doc-info-item"><span>Atendimento</span><strong>' + esc(p.nr_atendimento) + '</strong></div>';
        if (p.info_extra)     html += '<div class="doc-info-item"><span>Informação</span><strong>'  + esc(p.info_extra)     + '</strong></div>';
        return html;
    }

    function _htmlFormulario(infoDoc) {
        return '<div class="assin-container">'
            + (infoDoc ? '<div class="doc-info-bar">' + infoDoc + '</div>' : '')
            + '<div class="assin-card">'

            + '<div class="assin-secao">'
            + '<h3 class="assin-secao-titulo"><i class="fas fa-user"></i> Dados do Assinante</h3>'
            + '<div class="form-row"><div class="form-group">'
            + '<label>Nome de quem está assinando <span class="req">*</span></label>'
            + '<input type="text" id="inp-signatario" placeholder="Nome completo" autocomplete="off">'
            + '</div></div>'
            + '<div class="form-row">'
            + '<div class="form-group">'
            + '<label>CPF do assinante <span class="form-hint">(alternativa à assinatura desenhada)</span></label>'
            + '<input type="text" id="inp-cpf-signatario" placeholder="000.000.000-00" maxlength="14" autocomplete="off" inputmode="numeric">'
            + '</div>'
            + '<div class="form-group form-group-sm"><label>Qualidade</label>'
            + '<select id="sel-qualidade">'
            + '<option value="paciente">Paciente</option>'
            + '<option value="familiar">Familiar / Acompanhante</option>'
            + '<option value="responsavel_legal">Responsável Legal</option>'
            + '</select></div>'
            + '</div>'
            + '</div>'

            + '<div class="assin-secao">'
            + '<h3 class="assin-secao-titulo"><i class="fas fa-pen-nib"></i> Assinatura</h3>'
            + '<div class="canvas-wrapper">'
            + '<canvas id="canvas-assinatura"></canvas>'
            + '<div class="canvas-hint">Assine aqui com o dedo ou caneta</div>'
            + '</div>'
            + '<button class="btn-limpar-canvas" id="btn-limpar"><i class="fas fa-eraser"></i> Limpar</button>'
            + '</div>'

            + '<div class="assin-secao">'
            + '<h3 class="assin-secao-titulo"><i class="fas fa-key"></i> PIN do Coletor</h3>'
            + '<p class="pin-descricao">Informe sua matrícula para autenticar a coleta desta assinatura.</p>'
            + '<div class="pin-row">'
            + '<input type="text" id="inp-pin" class="inp-pin" placeholder="Matrícula" maxlength="20" autocomplete="off">'
            + '<button class="btn-validar-pin" id="btn-validar-pin"><i class="fas fa-check"></i> Validar</button>'
            + '</div>'
            + '<div class="pin-resultado" id="pin-resultado"></div>'
            + '</div>'

            + '<div class="assin-footer">'
            + '<button class="btn-confirmar-assin" id="btn-confirmar" disabled>'
            + '<i class="fas fa-check-circle"></i> Confirmar Assinatura</button>'
            + '</div>'

            + '</div></div>';
    }

    function _inicializarCanvas(corCtx) {
        var E      = window.P48.Estado;
        var canvas = document.getElementById('canvas-assinatura');
        if (!canvas) return;

        var ratio = Math.max(window.devicePixelRatio || 1, 1);
        canvas.width  = (canvas.offsetWidth  * ratio) || 600;
        canvas.height = (canvas.offsetHeight * ratio) || 200;

        var ctx2d = canvas.getContext('2d');
        if (ctx2d) ctx2d.scale(ratio, ratio);

        E.signaturePad = new SignaturePad(canvas, {
            backgroundColor: 'rgb(255,255,255)',
            penColor:        corCtx,
            minWidth:        1.5,
            maxWidth:        4
        });
    }

    function _vincularEventos() {
        var E = window.P48.Estado;

        var inpCpf = document.getElementById('inp-cpf-signatario');
        if (inpCpf) {
            inpCpf.addEventListener('input', function () {
                var pos = this.selectionStart;
                this.value = window.P48.mascaraCpf(this.value);
                try { this.setSelectionRange(pos, pos); } catch (e) { /* ignore */ }
            });
        }

        var btnLimpar = document.getElementById('btn-limpar');
        if (btnLimpar) {
            btnLimpar.addEventListener('click', function () {
                if (E.signaturePad) E.signaturePad.clear();
            });
        }

        var btnPin = document.getElementById('btn-validar-pin');
        if (btnPin) btnPin.addEventListener('click', validarPin);

        var inpPin = document.getElementById('inp-pin');
        if (inpPin) {
            inpPin.addEventListener('keydown', function (e) {
                if (e.key === 'Enter') validarPin();
            });
        }

        var btnConf = document.getElementById('btn-confirmar');
        if (btnConf) btnConf.addEventListener('click', confirmarAssinatura);
    }

    // ── Validar PIN ────────────────────────────────────────────

    function validarPin() {
        var E         = window.P48.Estado;
        var esc       = window.P48.escHtml;
        var inpPin    = document.getElementById('inp-pin');
        var resultado = document.getElementById('pin-resultado');
        var btnConf   = document.getElementById('btn-confirmar');
        if (!inpPin || !resultado) return;

        var matricula = inpPin.value.trim();
        if (!matricula) {
            resultado.innerHTML = '<span class="pin-erro"><i class="fas fa-times"></i> Informe a matrícula.</span>';
            return;
        }

        resultado.innerHTML = '<span class="pin-validando"><i class="fas fa-spinner fa-spin"></i> Validando...</span>';

        fetch(window.P48.CONFIG.api + '/validar-pin', {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ matricula: matricula })
        })
        .then(function (r) { return r.json(); })
        .then(function (d) {
            if (d.success) {
                E.pinInfo = d.membro;
                resultado.innerHTML = '<span class="pin-ok">'
                    + '<i class="fas fa-check-circle"></i> '
                    + esc(d.membro.nome)
                    + ' (' + esc(d.membro.funcao || d.membro.turno || '') + ')'
                    + '</span>';
                if (btnConf) btnConf.disabled = false;
            } else {
                E.pinInfo = null;
                resultado.innerHTML = '<span class="pin-erro"><i class="fas fa-times-circle"></i> '
                    + esc(d.error || 'Matrícula não encontrada') + '</span>';
                if (btnConf) btnConf.disabled = true;
            }
        })
        .catch(function () {
            resultado.innerHTML = '<span class="pin-erro"><i class="fas fa-exclamation-circle"></i> Erro de comunicação.</span>';
        });
    }

    // ── Confirmar assinatura ────────────────────────────────────

    function confirmarAssinatura() {
        var E     = window.P48.Estado;
        var toast = window.P48.toast;

        var signatario = ((document.getElementById('inp-signatario') || {}).value || '').trim();
        if (!signatario) { toast('Informe o nome de quem está assinando.', 'aviso'); return; }

        var cpf         = ((document.getElementById('inp-cpf-signatario') || {}).value || '').trim() || null;
        var canvasVazio = !E.signaturePad || E.signaturePad.isEmpty();
        if (canvasVazio && !cpf) {
            toast('Realize a assinatura desenhada OU informe o CPF do assinante.', 'aviso');
            return;
        }

        if (!E.pinInfo) { toast('Valide o PIN (matrícula) antes de confirmar.', 'aviso'); return; }

        var btnConf = document.getElementById('btn-confirmar');
        if (btnConf) btnConf.disabled = true;

        var qualidade  = ((document.getElementById('sel-qualidade') || {}).value) || 'paciente';
        var ctx        = E.contextoAtual || {};
        var p          = E.params;
        var imgBase64  = canvasVazio ? null : E.signaturePad.toDataURL('image/png');
        var refId      = p.ref_id ? parseInt(p.ref_id, 10) : null;
        if (isNaN(refId)) refId = null;

        var conteudo = {
            contexto:          ctx.codigo || '',
            ref_id:            p.ref_id || null,
            nr_atendimento:    p.nr_atendimento || '',
            nm_paciente:       p.nm_paciente || '',
            nm_signatario:     signatario,
            nm_signatario_cpf: cpf || null,
            qualidade:         qualidade,
            ts_captura:        new Date().toISOString()
        };

        var body = {
            contexto:             ctx.codigo || '',
            ref_tabela:           p.ref_tabela || null,
            ref_id:               refId,
            nr_atendimento:       p.nr_atendimento || null,
            nm_signatario:        signatario,
            nm_signatario_cpf:    cpf || null,
            qualidade_signatario: qualidade,
            assinatura_img:       imgBase64 || null,
            foto_signatario:      null,
            conteudo_json:        JSON.stringify(conteudo),
            matricula_pin:        E.pinInfo.matricula
        };

        fetch(window.P48.CONFIG.api + '/assinar', {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        })
        .then(function (r) { return r.json(); })
        .then(function (d) {
            if (d.success) {
                if (window.opener && !window.opener.closed) {
                    window.opener.postMessage({
                        tipo:     'assinatura_ok',
                        id:       d.id,
                        ref_id:   refId,
                        contexto: ctx.codigo
                    }, window.location.origin);
                    window.close();
                } else if (ctx.codigo === 'entrega_refeicao' && refId) {
                    _confirmarEntregaAssinada(d, refId, signatario, imgBase64, conteudo);
                } else {
                    mostrarComprovante(d, signatario, imgBase64, conteudo);
                }
            } else {
                toast('Erro: ' + (d.error || 'Falha ao salvar'), 'erro');
                if (btnConf) btnConf.disabled = false;
            }
        })
        .catch(function () {
            toast('Erro de comunicação.', 'erro');
            if (btnConf) btnConf.disabled = false;
        });
    }

    function _confirmarEntregaAssinada(d, refId, signatario, imgBase64, conteudo) {
        var E     = window.P48.Estado;
        var toast = window.P48.toast;

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
            E.voltarParaFila = E.modoFila;
            mostrarComprovante(d, signatario, imgBase64, conteudo);
        })
        .catch(function () {
            toast('Assinatura salva. Verifique a entrega no Painel 42.', 'aviso');
            E.voltarParaFila = E.modoFila;
            mostrarComprovante(d, signatario, imgBase64, conteudo);
        });
    }

    // ── Comprovante ────────────────────────────────────────────

    function mostrarComprovante(d, signatario, imgBase64, conteudo) {
        var E         = window.P48.Estado;
        var esc       = window.P48.escHtml;
        var modalComp = document.getElementById('modal-comprovante');
        var bodyComp  = document.getElementById('modal-comp-body');
        if (!modalComp || !bodyComp) return;

        bodyComp.innerHTML = '<div class="comp-row"><span>ID da Assinatura</span><strong>#' + esc(String(d.id)) + '</strong></div>'
            + (conteudo.nm_paciente ? '<div class="comp-row"><span>Paciente</span><strong>' + esc(conteudo.nm_paciente) + '</strong></div>' : '')
            + '<div class="comp-row"><span>Assinado por</span><strong>'  + esc(signatario) + '</strong></div>'
            + '<div class="comp-row"><span>Coletado por</span><strong>'  + esc(d.coletor || E.pinInfo.nome) + '</strong></div>'
            + '<div class="comp-row"><span>Data / Hora</span><strong>'   + esc(window.P48.formatarDataHora(d.criado_em)) + '</strong></div>'
            + (imgBase64
                ? '<div class="comp-assinatura-preview"><p>Assinatura coletada:</p>'
                    + '<img src="' + imgBase64 + '" alt="Assinatura" style="max-width:100%;border:1px solid #dee2e6;border-radius:6px;"></div>'
                : (conteudo.nm_signatario_cpf
                    ? '<div class="comp-row"><span>CPF do assinante</span><strong>' + esc(conteudo.nm_signatario_cpf) + '</strong></div>'
                    : ''));

        var btnFin = document.getElementById('modal-comp-finalizar');
        if (btnFin) {
            btnFin.innerHTML = E.voltarParaFila
                ? '<i class="fas fa-arrow-left"></i> Voltar à Fila'
                : '<i class="fas fa-check"></i> Finalizar';
        }

        modalComp.style.display = 'flex';
    }

    window.P48.renderizarAssinatura = renderizarAssinatura;
    window.P48.mostrarComprovante   = mostrarComprovante;

})();
