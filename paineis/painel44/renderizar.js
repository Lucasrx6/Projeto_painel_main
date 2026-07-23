(function () {
    'use strict';

    function mostrarVazio() {
        window.P44.DOM.hubVazio.style.display = 'flex';
    }

    // ── Subsistemas ───────────────────────────────────────────────────────────

    function renderCardSubsistema(sub) {
        var escHtml = window.P44.escHtml;
        var paineis = sub.paineis || [];
        var linkHtml = '';

        for (var i = 0; i < paineis.length; i++) {
            var p = paineis[i];
            linkHtml += '<a href="' + escHtml(p.url) + '" class="painel-link">'
                      + '<i class="fa-solid ' + escHtml(p.icone) + ' painel-link-icon"></i>'
                      + escHtml(p.nome)
                      + '</a>';
        }

        return '<div class="subsistema-card">'
             + '<div class="subsistema-header" style="background:' + escHtml(sub.cor) + ';">'
             +     '<i class="fa-solid ' + escHtml(sub.icone) + ' sub-icon"></i>'
             +     '<div class="sub-titulo">' + escHtml(sub.grupo) + '</div>'
             + '</div>'
             + '<div class="subsistema-body">'
             +     '<p class="sub-descricao">' + escHtml(sub.descricao) + '</p>'
             +     '<div class="paineis-lista">' + linkHtml + '</div>'
             + '</div>'
             + '</div>';
    }

    function renderSubsistemas(lista) {
        var html = '';
        for (var i = 0; i < lista.length; i++) {
            html += renderCardSubsistema(lista[i]);
        }
        window.P44.DOM.subsistemas.innerHTML = html;
    }

    // ── Outros Serviços ───────────────────────────────────────────────────────

    function renderServicos(lista) {
        var escHtml = window.P44.escHtml;
        var html = '';

        for (var i = 0; i < lista.length; i++) {
            var s     = lista[i];
            var cor   = escHtml(s.cor         || '#6C757D');
            var icone = escHtml(s.icone        || 'fa-link');
            var url   = escHtml(s.url_destino  || '#');
            html += '<a href="' + url + '" class="servico-card">'
                  + '<div class="servico-icone" style="background:' + cor + ';">'
                  +     '<i class="fa-solid ' + icone + '"></i>'
                  + '</div>'
                  + '<div class="servico-info">'
                  +     '<div class="servico-nome">' + escHtml(s.nome) + '</div>'
                  +     (s.descricao ? '<div class="servico-desc">' + escHtml(s.descricao) + '</div>' : '')
                  + '</div>'
                  + '<i class="fa-solid fa-chevron-right servico-seta"></i>'
                  + '</a>';
        }

        window.P44.DOM.servicos.innerHTML = html;
    }

    window.P44.mostrarVazio        = mostrarVazio;
    window.P44.renderCardSubsistema = renderCardSubsistema;
    window.P44.renderSubsistemas   = renderSubsistemas;
    window.P44.renderServicos      = renderServicos;

})();
