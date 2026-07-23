(function () {
    'use strict';

    function inicializar() {
        var btnVoltar = document.getElementById('btn-voltar');
        if (btnVoltar) {
            btnVoltar.addEventListener('click', function () {
                window.location.href = '/frontend/dashboard.html';
            });
        }

        var btnRefresh = document.getElementById('btn-refresh');
        if (btnRefresh) {
            btnRefresh.addEventListener('click', function () {
                btnRefresh.classList.add('girando');
                window.P17.carregarDados();
                setTimeout(function () {
                    btnRefresh.classList.remove('girando');
                }, 600);
            });
        }

        window.P17.carregarDados();
        setInterval(window.P17.carregarDados, window.P17.CONFIG.intervaloRefresh);
    }

    window.addEventListener('DOMContentLoaded', inicializar);

})();
