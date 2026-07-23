(function () {
    'use strict';

    // ── Modal de cancelamento de exame ────────────────────────────

    function abrirCancelar(id, nome) {
        var E = window.P47.Estado;
        E.cancelarId   = id;
        E.cancelarNome = nome;

        var info = document.getElementById('modal-cancelar-info');
        if (info) info.textContent = 'Cancelar exame de: ' + nome;

        var motivo = document.getElementById('modal-cancelar-motivo');
        if (motivo) motivo.value = '';

        var modal = document.getElementById('modal-cancelar');
        if (modal) modal.style.display = 'flex';
    }

    function confirmarCancelar() {
        var E      = window.P47.Estado;
        var toast  = window.P47.toast;
        var motivo = (document.getElementById('modal-cancelar-motivo') || {}).value || '';
        motivo = motivo.trim();

        if (motivo.length < 5) {
            toast('Informe o motivo (mínimo 5 caracteres).', 'warning');
            return;
        }

        var btn = document.getElementById('modal-cancelar-confirmar');
        if (btn) btn.disabled = true;

        var url = window.P47.CONFIG.api.cancelar.replace('{id}', E.cancelarId);
        fetch(url, {
            method: 'PUT',
            credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ motivo: motivo })
        })
        .then(function (r) { return r.json(); })
        .then(function (d) {
            var modal = document.getElementById('modal-cancelar');
            if (modal) modal.style.display = 'none';
            if (d.success) {
                toast('Exame cancelado.', 'warning');
                if (E.tabAtiva === 'dashboard') window.P47.carregarDashboard();
                else window.P47.carregarHistorico();
            } else {
                toast('Erro: ' + (d.error || 'Falha ao cancelar'), 'error');
            }
        })
        .catch(function (e) {
            console.error('[P47]', e);
            toast('Erro de conexão', 'error');
        })
        .finally(function () {
            if (btn) btn.disabled = false;
        });
    }

    // ── Exportar histórico como CSV ───────────────────────────────

    function exportar() {
        var dias   = (document.getElementById('filtro-dias')   || {}).value || '30';
        var status = (document.getElementById('filtro-status') || {}).value || '';
        var setor  = (document.getElementById('filtro-setor')  || {}).value || '';
        var url = window.P47.CONFIG.api.exportar + '?dias=' + dias;
        if (status) url += '&status=' + encodeURIComponent(status);
        if (setor)  url += '&setor='  + encodeURIComponent(setor);
        window.location.href = url;
    }

    window.P47.abrirCancelar    = abrirCancelar;
    window.P47.confirmarCancelar = confirmarCancelar;
    window.P47.exportar         = exportar;

})();
