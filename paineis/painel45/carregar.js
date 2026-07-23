(function () {
    'use strict';

    function carregar() {
        var E      = window.P45.Estado;
        var CONFIG = window.P45.CONFIG;

        var url = CONFIG.api.agendamentos + '?data=' + E.filtroData;
        if (E.filtroStatus !== 'todos') url += '&status_enf=' + E.filtroStatus;

        fetch(url, { credentials: 'same-origin' })
            .then(function (r) { return r.json(); })
            .then(function (d) {
                if (d.success) {
                    E.dados = d.data || [];
                } else {
                    E.dados = [];
                    window.P45.toast('Erro: ' + (d.error || 'Falha ao carregar'), 'error');
                }
                window.P45.renderizar();
                var el = document.getElementById('ultima-atualizacao');
                if (el) el.textContent = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
            })
            .catch(function (e) {
                console.error('[P45]', e);
                E.dados = [];
                var mc = document.getElementById('main-content');
                if (mc) mc.innerHTML = '<div class="painel-vazio"><i class="fas fa-exclamation-triangle"></i><p>Erro de conexão.</p></div>';
                window.P45.toast('Erro ao carregar dados', 'error');
            });
    }

    window.P45.carregar = carregar;

})();
