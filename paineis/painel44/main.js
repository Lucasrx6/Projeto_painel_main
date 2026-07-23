(function () {
    'use strict';

    function inicializar() {
        var DOM = window.P44.DOM;

        DOM.loading          = document.getElementById('loading-hub');
        DOM.secaoSubsistemas = document.getElementById('secao-subsistemas');
        DOM.secaoServicos    = document.getElementById('secao-servicos');
        DOM.subsistemas      = document.getElementById('subsistemas-grid');
        DOM.servicos         = document.getElementById('servicos-grid');
        DOM.hubVazio         = document.getElementById('hub-vazio');
        DOM.headerUsuario    = document.getElementById('header-usuario');

        var btnVoltar = document.getElementById('btn-voltar-dashboard');
        if (btnVoltar) {
            btnVoltar.addEventListener('click', function () { window.location.href = '/'; });
        }

        window.P44.carregarCatalogo();
    }

    window.addEventListener('DOMContentLoaded', inicializar);

})();
