(function () {
    'use strict';

    // ── Modal de Ciência ──────────────────────────────────────────────────────

    function abrirCiencia(id) {
        var E       = window.P45.Estado;
        var escHtml = window.P45.escHtml;
        var fNome   = window.P45.formatarNome;

        E.modalId = id;

        var item = null;
        for (var i = 0; i < E.dados.length; i++) {
            if (E.dados[i].id === id) { item = E.dados[i]; break; }
        }

        var info = document.getElementById('modal-cien-info');
        if (info && item) {
            info.innerHTML = '<strong>' + escHtml(fNome(item.nm_paciente || '')) + '</strong><br>'
                           + '<small>' + escHtml(item.ds_procedimento || '') + '</small>';
            if (item.requer_preparo && item.tipo_preparo) {
                info.innerHTML += '<div class="modal-preparo-alerta">'
                    + '<i class="fas fa-exclamation-triangle"></i>'
                    + '<strong>Preparo necessário:</strong> '
                    + escHtml(item.tipo_preparo)
                    + '</div>';
            }
        }

        var modal = document.getElementById('modal-ciencia');
        if (modal) modal.style.display = 'flex';
    }

    function fecharCiencia() {
        var modal = document.getElementById('modal-ciencia');
        if (modal) modal.style.display = 'none';
        window.P45.Estado.modalId = null;
    }

    function confirmarCiencia() {
        var E   = window.P45.Estado;
        if (!E.modalId) return;

        var btn = document.getElementById('modal-cien-confirmar');
        if (btn) btn.disabled = true;

        var url = window.P45.CONFIG.api.ciencia.replace('{id}', E.modalId);

        fetch(url, {
            method: 'PUT',
            credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json' }
        })
        .then(function (r) { return r.json(); })
        .then(function (d) {
            if (d.success) {
                fecharCiencia();
                window.P45.toast('Ciência registrada!', 'success');
                window.P45.carregar();
            } else {
                window.P45.toast('Erro: ' + (d.error || 'Falha'), 'error');
            }
            if (btn) btn.disabled = false;
        })
        .catch(function (e) {
            console.error('[P45]', e);
            window.P45.toast('Erro de conexão', 'error');
            if (btn) btn.disabled = false;
        });
    }

    // ── Modal de Recusa ───────────────────────────────────────────────────────

    function abrirRecusar(id) {
        var E       = window.P45.Estado;
        var escHtml = window.P45.escHtml;
        var fNome   = window.P45.formatarNome;

        E.modalId = id;

        var item = null;
        for (var i = 0; i < E.dados.length; i++) {
            if (E.dados[i].id === id) { item = E.dados[i]; break; }
        }

        var info = document.getElementById('modal-rec-info');
        if (info && item) {
            info.innerHTML = '<strong>' + escHtml(fNome(item.nm_paciente || '')) + '</strong><br>'
                           + '<small>' + escHtml(item.ds_procedimento || '') + '</small>';
        }

        var motivo = document.getElementById('modal-rec-motivo');
        if (motivo) motivo.value = '';

        var btn = document.getElementById('modal-rec-confirmar');
        if (btn) btn.disabled = true;

        var contador = document.getElementById('modal-rec-contador');
        if (contador) contador.textContent = '0 / 10 mínimo';

        var hint = document.getElementById('modal-rec-hint');
        if (hint) hint.style.color = '#dc3545';

        var modal = document.getElementById('modal-recusar');
        if (modal) modal.style.display = 'flex';
    }

    function fecharRecusar() {
        var modal = document.getElementById('modal-recusar');
        if (modal) modal.style.display = 'none';
        window.P45.Estado.modalId = null;
    }

    function confirmarRecusar() {
        var E = window.P45.Estado;
        if (!E.modalId) return;

        var motivoEl = document.getElementById('modal-rec-motivo');
        var motivo   = motivoEl ? motivoEl.value.trim() : '';
        if (motivo.length < 10) return;

        var btn = document.getElementById('modal-rec-confirmar');
        if (btn) btn.disabled = true;

        var url = window.P45.CONFIG.api.recusar.replace('{id}', E.modalId);

        fetch(url, {
            method: 'PUT',
            credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ motivo: motivo })
        })
        .then(function (r) { return r.json(); })
        .then(function (d) {
            if (d.success) {
                fecharRecusar();
                window.P45.toast('Agendamento recusado.', 'warning');
                window.P45.carregar();
            } else {
                window.P45.toast('Erro: ' + (d.error || 'Falha'), 'error');
            }
            if (btn) btn.disabled = false;
        })
        .catch(function (e) {
            console.error('[P45]', e);
            window.P45.toast('Erro de conexão', 'error');
            if (btn) btn.disabled = false;
        });
    }

    window.P45.abrirCiencia     = abrirCiencia;
    window.P45.fecharCiencia    = fecharCiencia;
    window.P45.confirmarCiencia = confirmarCiencia;
    window.P45.abrirRecusar     = abrirRecusar;
    window.P45.fecharRecusar    = fecharRecusar;
    window.P45.confirmarRecusar = confirmarRecusar;

})();
