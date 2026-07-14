var PAINEL_VERSAO = '1.0.17';
(function () {
    'use strict';

    var CONFIG = {
        apiBase: '/api/paineis/painel44'
    };

    var DOM = {};

    function escHtml(s) {
        return String(s || '')
            .replace(/&/g, '&amp;').replace(/</g, '&lt;')
            .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    function inicializar() {
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

        carregarCatalogo();
    }

    function carregarCatalogo() {
        fetch(CONFIG.apiBase + '/catalogo', { credentials: 'same-origin' })
            .then(function (r) { return r.json(); })
            .then(function (data) {
                DOM.loading.style.display = 'none';
                if (!data.success) { mostrarVazio(); return; }

                var temSubsistemas = data.subsistemas && data.subsistemas.length > 0;
                var temServicos    = data.servicos    && data.servicos.length    > 0;

                if (!temSubsistemas && !temServicos) { mostrarVazio(); return; }

                if (temSubsistemas) {
                    renderSubsistemas(data.subsistemas);
                    DOM.secaoSubsistemas.style.display = 'block';
                }

                if (temServicos) {
                    renderServicos(data.servicos);
                    DOM.secaoServicos.style.display = 'block';
                }
            })
            .catch(function (e) {
                DOM.loading.style.display = 'none';
                console.error('catalogo', e);
                mostrarVazio();
            });
    }

    function mostrarVazio() {
        DOM.hubVazio.style.display = 'flex';
    }

    // =========================================================
    // SUBSISTEMAS
    // =========================================================
    function renderSubsistemas(lista) {
        var html = '';
        for (var i = 0; i < lista.length; i++) {
            html += renderCardSubsistema(lista[i]);
        }
        DOM.subsistemas.innerHTML = html;
    }

    function renderCardSubsistema(sub) {
        var paineis = sub.paineis || [];
        var linkHtml = '';
        for (var i = 0; i < paineis.length; i++) {
            var p = paineis[i];
            linkHtml += '<a href="' + escHtml(p.url) + '" class="painel-link">' +
                '<i class="fa-solid ' + escHtml(p.icone) + ' painel-link-icon"></i>' +
                escHtml(p.nome) +
            '</a>';
        }

        return '<div class="subsistema-card">' +
            '<div class="subsistema-header" style="background:' + escHtml(sub.cor) + ';">' +
                '<i class="fa-solid ' + escHtml(sub.icone) + ' sub-icon"></i>' +
                '<div class="sub-titulo">' + escHtml(sub.grupo) + '</div>' +
            '</div>' +
            '<div class="subsistema-body">' +
                '<p class="sub-descricao">' + escHtml(sub.descricao) + '</p>' +
                '<div class="paineis-lista">' + linkHtml + '</div>' +
            '</div>' +
        '</div>';
    }

    // =========================================================
    // OUTROS SERVIÇOS (hub_servicos dinâmico)
    // =========================================================
    function renderServicos(lista) {
        var html = '';
        for (var i = 0; i < lista.length; i++) {
            var s = lista[i];
            var cor   = escHtml(s.cor   || '#6C757D');
            var icone = escHtml(s.icone || 'fa-link');
            var url   = escHtml(s.url_destino || '#');
            html += '<a href="' + url + '" class="servico-card">' +
                '<div class="servico-icone" style="background:' + cor + ';">' +
                    '<i class="fa-solid ' + icone + '"></i>' +
                '</div>' +
                '<div class="servico-info">' +
                    '<div class="servico-nome">' + escHtml(s.nome) + '</div>' +
                    (s.descricao ? '<div class="servico-desc">' + escHtml(s.descricao) + '</div>' : '') +
                '</div>' +
                '<i class="fa-solid fa-chevron-right servico-seta"></i>' +
            '</a>';
        }
        DOM.servicos.innerHTML = html;
    }

    // =========================================================
    // START
    // =========================================================
    window.addEventListener('DOMContentLoaded', inicializar);

})();
