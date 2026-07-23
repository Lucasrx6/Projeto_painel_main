(function () {
    'use strict';

    function mudarTab(tab) {
        var E = window.P47.Estado;
        E.tabAtiva = tab;

        var abas = document.querySelectorAll('.aba');
        for (var i = 0; i < abas.length; i++) {
            var a = abas[i];
            a.className = a.getAttribute('data-aba') === tab ? 'aba aba-ativa' : 'aba';
        }

        var ids = ['dashboard', 'historico', 'producao'];
        for (var j = 0; j < ids.length; j++) {
            var el = document.getElementById('aba-' + ids[j]);
            if (el) el.style.display = ids[j] === tab ? '' : 'none';
        }

        if (tab === 'historico') window.P47.carregarHistorico();
        if (tab === 'producao' && !E.producaoCarregado) {
            E.producaoCarregado = true;
            window.P47.carregarProducao();
        }
    }

    window.P47.mudarTab = mudarTab;

})();
