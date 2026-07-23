(function () {
    'use strict';

    var _editGen = 0;

    var _LABEL_VOLTAR = {
        aceito:     'Aceito → Aguardando',
        em_preparo: 'Em Preparo → Aceito',
        pronto:     'Pronto → Em Preparo',
        em_entrega: 'Em Entrega → Pronto'
    };

    // ── Modal: Aceitar ────────────────────────────────────────────────────────

    function abrirModalAceitar(sid, desc) {
        var DOM = window.P42.DOM;
        DOM.accSid.value              = sid;
        DOM.accDesc.textContent       = desc || '';
        DOM.accErro.style.display     = 'none';
        DOM.modalAceitar.style.display = 'flex';
    }

    function confirmarAceitar() {
        var DOM          = window.P42.DOM;
        var responsavelId = DOM.accSelMembro.value;
        if (!responsavelId) {
            DOM.accErro.textContent   = 'Selecione o responsável.';
            DOM.accErro.style.display = 'block';
            return;
        }
        var sid = DOM.accSid.value;
        DOM.btnAccConfirmar.disabled = true;

        fetch(window.P42.CONFIG.apiBase + '/solicitacoes/' + sid + '/aceitar', {
            method: 'PUT',
            credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ responsavel_id: parseInt(responsavelId, 10) })
        })
        .then(function (r) { return r.json(); })
        .then(function (data) {
            DOM.btnAccConfirmar.disabled = false;
            if (data.success) {
                var sol  = null;
                var fila = window.P42.Estado.fila;
                for (var i = 0; i < fila.length; i++) {
                    if (String(fila[i].id) === String(sid)) { sol = fila[i]; break; }
                }
                window.P42.fecharModal(DOM.modalAceitar);
                window.P42.carregarFila();
                if (DOM.chkImprimirAceitar && DOM.chkImprimirAceitar.checked && sol) {
                    window.P42.imprimirEtiqueta(sol);
                }
            } else {
                DOM.accErro.textContent   = data.error || 'Erro.';
                DOM.accErro.style.display = 'block';
            }
        })
        .catch(function () {
            DOM.btnAccConfirmar.disabled = false;
            DOM.accErro.textContent   = 'Falha na conexão.';
            DOM.accErro.style.display = 'block';
        });
    }

    // ── Modal: Confirmar Entrega ──────────────────────────────────────────────

    function abrirModalEntregar(sid, codigo, desc) {
        var DOM = window.P42.DOM;
        DOM.entrSid.value               = sid;
        DOM.entrSid.setAttribute('data-codigo', codigo);
        DOM.entrDesc.textContent        = desc || '';
        DOM.inpCodigoConfirm.value      = '';
        DOM.codigoFeedback.textContent  = '';
        DOM.codigoFeedback.className    = 'codigo-feedback';
        DOM.entrObs.value               = '';
        DOM.entrErro.style.display      = 'none';
        DOM.btnEntrConfirmar.disabled   = true;
        DOM.modalEntregar.style.display = 'flex';
        setTimeout(function () { DOM.inpCodigoConfirm.focus(); }, 100);
    }

    function validarCodigoInput() {
        var DOM      = window.P42.DOM;
        var digitado = DOM.inpCodigoConfirm.value.trim();
        var esperado = (DOM.entrSid.getAttribute('data-codigo') || '').trim();

        if (!digitado) {
            DOM.codigoFeedback.textContent = '';
            DOM.codigoFeedback.className   = 'codigo-feedback';
            DOM.btnEntrConfirmar.disabled  = true;
            return;
        }
        if (digitado === esperado) {
            DOM.codigoFeedback.textContent = '✓ Nº de atendimento correto';
            DOM.codigoFeedback.className   = 'codigo-feedback codigo-ok';
            DOM.btnEntrConfirmar.disabled  = false;
        } else {
            DOM.codigoFeedback.textContent = '✗ Nº de atendimento incorreto';
            DOM.codigoFeedback.className   = 'codigo-feedback codigo-erro';
            DOM.btnEntrConfirmar.disabled  = true;
        }
    }

    function confirmarEntrega() {
        var DOM    = window.P42.DOM;
        var sid    = DOM.entrSid.value;
        var codigo = DOM.inpCodigoConfirm.value.trim();
        var obs    = DOM.entrObs.value.trim();

        DOM.btnEntrConfirmar.disabled = true;
        DOM.entrErro.style.display    = 'none';

        fetch(window.P42.CONFIG.apiBase + '/solicitacoes/' + sid + '/entregar', {
            method: 'PUT',
            credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ nr_atendimento_confirmacao: codigo, observacao_entrega: obs })
        })
        .then(function (r) { return r.json(); })
        .then(function (data) {
            DOM.btnEntrConfirmar.disabled = false;
            if (data.success) {
                window.P42.fecharModal(DOM.modalEntregar);
                window.P42.carregarFila();
                window.P42.carregarHistorico();
            } else {
                DOM.entrErro.textContent   = data.error || 'Erro ao confirmar entrega.';
                DOM.entrErro.style.display = 'block';
            }
        })
        .catch(function () {
            DOM.btnEntrConfirmar.disabled = false;
            DOM.entrErro.textContent   = 'Falha na conexão.';
            DOM.entrErro.style.display = 'block';
        });
    }

    // ── Modal: Cancelar ───────────────────────────────────────────────────────

    function abrirModalCancelar(sid, desc) {
        var DOM = window.P42.DOM;
        DOM.cancSid.value               = sid;
        DOM.cancDesc.textContent        = desc || '';
        DOM.cancMotivo.value            = '';
        DOM.cancErro.style.display      = 'none';
        DOM.modalCancelar.style.display = 'flex';
    }

    function confirmarCancelar() {
        var DOM    = window.P42.DOM;
        var sid    = DOM.cancSid.value;
        var motivo = DOM.cancMotivo.value.trim();
        if (motivo.length < 10) {
            DOM.cancErro.textContent   = 'Motivo deve ter pelo menos 10 caracteres.';
            DOM.cancErro.style.display = 'block';
            return;
        }
        DOM.btnCancConfirmar.disabled = true;

        fetch(window.P42.CONFIG.apiBase + '/solicitacoes/' + sid + '/cancelar', {
            method: 'PUT',
            credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ motivo: motivo })
        })
        .then(function (r) { return r.json(); })
        .then(function (data) {
            DOM.btnCancConfirmar.disabled = false;
            if (data.success) {
                window.P42.fecharModal(DOM.modalCancelar);
                window.P42.carregarFila();
                window.P42.carregarHistorico();
            } else {
                DOM.cancErro.textContent   = data.error || 'Erro.';
                DOM.cancErro.style.display = 'block';
            }
        })
        .catch(function () {
            DOM.btnCancConfirmar.disabled = false;
            DOM.cancErro.textContent   = 'Falha na conexão.';
            DOM.cancErro.style.display = 'block';
        });
    }

    // ── Modal: Editar ─────────────────────────────────────────────────────────

    function _carregarOpcoesDieta(tipoDietaAtualId, refeicaoAtualId) {
        _editGen++;
        var gen     = _editGen;
        var DOM     = window.P42.DOM;
        var Estado  = window.P42.Estado;
        var escHtml = window.P42.escHtml;

        fetch('/api/paineis/painel41/tipos-dieta', { credentials: 'same-origin' })
            .then(function (r) { return r.json(); })
            .then(function (data) {
                if (gen !== _editGen) return;
                if (!data.success) return;
                Estado.tiposDieta = data.tipos || [];
                var html = '<option value="">Selecione...</option>';
                for (var i = 0; i < Estado.tiposDieta.length; i++) {
                    var t   = Estado.tiposDieta[i];
                    var sel = (String(t.id) === String(tipoDietaAtualId)) ? ' selected' : '';
                    html += '<option value="' + t.id + '"' + sel + '>' + escHtml(t.nome) + '</option>';
                }
                DOM.editTipoDieta.innerHTML = html;
            })
            .catch(function (e) {
                if (gen !== _editGen) return;
                console.error('tipos-dieta', e);
                DOM.editErro.textContent   = 'Erro ao carregar tipos de dieta.';
                DOM.editErro.style.display = 'block';
            });

        fetch('/api/paineis/painel41/refeicoes', { credentials: 'same-origin' })
            .then(function (r) { return r.json(); })
            .then(function (data) {
                if (gen !== _editGen) return;
                if (!data.success) return;
                Estado.refeicoes = data.refeicoes || [];
                var html = '<option value="">Selecione...</option>';
                for (var i = 0; i < Estado.refeicoes.length; i++) {
                    var rf  = Estado.refeicoes[i];
                    var sel = (String(rf.id) === String(refeicaoAtualId)) ? ' selected' : '';
                    html += '<option value="' + rf.id + '"' + sel + '>' + escHtml(rf.nome) + '</option>';
                }
                DOM.editRefeicao.innerHTML = html;
            })
            .catch(function (e) {
                if (gen !== _editGen) return;
                console.error('refeicoes', e);
                DOM.editErro.textContent   = 'Erro ao carregar refeições.';
                DOM.editErro.style.display = 'block';
            });
    }

    function abrirModalEditar(sid, tipoDietaId, refeicaoId, obs, desc) {
        var DOM = window.P42.DOM;
        DOM.editSid.value             = sid;
        DOM.editDesc.textContent      = desc || '';
        var obsLimpa = (obs || '').replace(/(\s*\|\s*)?\[Retorno:[^\]]+\]/g, '').trim();
        DOM.editObs.value             = obsLimpa;
        DOM.editErro.style.display    = 'none';
        DOM.modalEditar.style.display = 'flex';
        _carregarOpcoesDieta(tipoDietaId, refeicaoId);
    }

    function confirmarEditar() {
        var DOM         = window.P42.DOM;
        var tipoDietaId = DOM.editTipoDieta.value;
        var refeicaoId  = DOM.editRefeicao.value;
        var obs         = DOM.editObs.value.trim();
        var sid         = DOM.editSid.value;

        if (!tipoDietaId || !refeicaoId) {
            DOM.editErro.textContent   = 'Selecione o tipo de dieta e a refeição.';
            DOM.editErro.style.display = 'block';
            return;
        }
        window.P42.Estado.processando  = true;
        DOM.btnEditConfirmar.disabled  = true;
        DOM.editErro.style.display     = 'none';

        fetch(window.P42.CONFIG.apiBase + '/solicitacoes/' + sid + '/editar', {
            method: 'PUT',
            credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                tipo_dieta_id: parseInt(tipoDietaId, 10),
                refeicao_id:   parseInt(refeicaoId,  10),
                observacao:    obs || null
            })
        })
        .then(function (r) { return r.json(); })
        .then(function (data) {
            window.P42.Estado.processando = false;
            DOM.btnEditConfirmar.disabled  = false;
            if (data.success) {
                window.P42.fecharModal(DOM.modalEditar);
                window.P42.carregarFila();
            } else {
                DOM.editErro.textContent   = data.error || 'Erro ao editar.';
                DOM.editErro.style.display = 'block';
            }
        })
        .catch(function () {
            window.P42.Estado.processando = false;
            DOM.btnEditConfirmar.disabled  = false;
            DOM.editErro.textContent   = 'Falha na conexão.';
            DOM.editErro.style.display = 'block';
        });
    }

    // ── Modal: Voltar Status ──────────────────────────────────────────────────

    function abrirModalVoltarStatus(sid, statusAtual, desc) {
        var DOM = window.P42.DOM;
        DOM.voltSid.value             = sid;
        DOM.voltDesc.textContent      = desc || '';
        DOM.voltInfo.textContent      = 'Ação: ' + (_LABEL_VOLTAR[statusAtual] || statusAtual);
        DOM.voltMotivo.value          = '';
        DOM.voltErro.style.display    = 'none';
        DOM.modalVoltar.style.display = 'flex';
    }

    function confirmarVoltarStatus() {
        var DOM    = window.P42.DOM;
        var sid    = DOM.voltSid.value;
        var motivo = DOM.voltMotivo.value.trim();

        if (motivo.length < 10) {
            DOM.voltErro.textContent   = 'Justificativa deve ter pelo menos 10 caracteres.';
            DOM.voltErro.style.display = 'block';
            return;
        }
        window.P42.Estado.processando  = true;
        DOM.btnVoltConfirmar.disabled  = true;
        DOM.voltErro.style.display     = 'none';

        fetch(window.P42.CONFIG.apiBase + '/solicitacoes/' + sid + '/voltar-status', {
            method: 'PUT',
            credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ motivo: motivo })
        })
        .then(function (r) { return r.json(); })
        .then(function (data) {
            window.P42.Estado.processando = false;
            DOM.btnVoltConfirmar.disabled  = false;
            if (data.success) {
                window.P42.fecharModal(DOM.modalVoltar);
                window.P42.carregarFila();
            } else {
                DOM.voltErro.textContent   = data.error || 'Erro ao voltar status.';
                DOM.voltErro.style.display = 'block';
            }
        })
        .catch(function () {
            window.P42.Estado.processando = false;
            DOM.btnVoltConfirmar.disabled  = false;
            DOM.voltErro.textContent   = 'Falha na conexão.';
            DOM.voltErro.style.display = 'block';
        });
    }

    window.P42.abrirModalAceitar      = abrirModalAceitar;
    window.P42.confirmarAceitar        = confirmarAceitar;
    window.P42.abrirModalEntregar     = abrirModalEntregar;
    window.P42.validarCodigoInput     = validarCodigoInput;
    window.P42.confirmarEntrega        = confirmarEntrega;
    window.P42.abrirModalCancelar     = abrirModalCancelar;
    window.P42.confirmarCancelar       = confirmarCancelar;
    window.P42.abrirModalEditar       = abrirModalEditar;
    window.P42.confirmarEditar         = confirmarEditar;
    window.P42.abrirModalVoltarStatus = abrirModalVoltarStatus;
    window.P42.confirmarVoltarStatus   = confirmarVoltarStatus;

})();
