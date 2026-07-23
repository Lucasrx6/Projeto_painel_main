(function () {
    'use strict';

    function abrirModalCancelar(id) {
        var DOM = window.P41.DOM;
        DOM.modalCancId.value           = id;
        DOM.modalCancMotivo.value       = '';
        DOM.modalCancErro.style.display = 'none';
        DOM.modalCancelar.style.display = 'flex';
    }

    function fecharModalCancelar() {
        window.P41.DOM.modalCancelar.style.display = 'none';
    }

    function confirmarCancelamento() {
        var DOM    = window.P41.DOM;
        var id     = DOM.modalCancId.value;
        var motivo = DOM.modalCancMotivo.value.trim();

        if (motivo.length < 10) {
            DOM.modalCancErro.textContent   = 'Motivo deve ter pelo menos 10 caracteres.';
            DOM.modalCancErro.style.display = 'block';
            return;
        }
        DOM.btnCancConfirmar.disabled = true;

        fetch(window.P41.CONFIG.apiBase + '/solicitacoes/' + id + '/cancelar', {
            method: 'PUT',
            credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ motivo: motivo })
        })
        .then(function (r) { return r.json(); })
        .then(function (data) {
            DOM.btnCancConfirmar.disabled = false;
            if (data.success) {
                fecharModalCancelar();
                window.P41.carregarMinhasSolicitacoes();
            } else {
                DOM.modalCancErro.textContent   = data.error || 'Erro ao cancelar.';
                DOM.modalCancErro.style.display = 'block';
            }
        })
        .catch(function () {
            DOM.btnCancConfirmar.disabled   = false;
            DOM.modalCancErro.textContent   = 'Falha na conexão.';
            DOM.modalCancErro.style.display = 'block';
        });
    }

    window.P41.abrirModalCancelar   = abrirModalCancelar;
    window.P41.fecharModalCancelar  = fecharModalCancelar;
    window.P41.confirmarCancelamento = confirmarCancelamento;

})();
