(function () {
    'use strict';

    function carregarDados() {
        fetch(window.P17.CONFIG.apiTempos, { credentials: 'same-origin' })
            .then(function (r) { return r.json(); })
            .then(function (data) {
                if (!data.success) return;
                window.P17.renderizarClinicas(data.clinicas);
                window.P17.atualizarTimestamp();
                var indicator = document.getElementById('status-indicator');
                if (indicator) indicator.className = 'status-indicator status-online';
            })
            .catch(function (err) {
                console.error('Erro ao carregar dados:', err);
                var grid = document.getElementById('clinicas-grid');
                if (grid) {
                    grid.innerHTML = '<div class="mensagem-vazia">' +
                        '<i class="fas fa-exclamation-triangle"></i>' +
                        '<p>Erro ao carregar dados</p></div>';
                }
            });
    }

    window.P17.carregarDados = carregarDados;

})();
