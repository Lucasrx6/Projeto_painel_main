(function () {
    'use strict';

    function mudarTab(tab) {
        var E = window.P46.Estado;
        E.tabAtiva = tab;

        var abas = document.querySelectorAll('.aba');
        for (var i = 0; i < abas.length; i++) {
            var a = abas[i];
            a.className = a.getAttribute('data-aba') === tab ? 'aba aba-ativa' : 'aba';
        }

        var fila   = document.getElementById('aba-fila');
        var exames = document.getElementById('aba-exames');
        var agenda = document.getElementById('aba-agenda');
        if (fila)   fila.style.display   = tab === 'fila'   ? '' : 'none';
        if (exames) exames.style.display = tab === 'exames' ? '' : 'none';
        if (agenda) agenda.style.display = tab === 'agenda' ? '' : 'none';

        var navData     = document.getElementById('nav-data');
        var agendaAcoes = document.getElementById('agenda-acoes');
        if (navData)     navData.style.display     = tab === 'agenda' ? 'flex' : 'none';
        if (agendaAcoes) agendaAcoes.style.display = tab === 'agenda' ? 'flex' : 'none';

        if (window.P46.DOM.labelData)
            window.P46.DOM.labelData.textContent = window.P46.labelData(E.dataConsulta);

        if (tab === 'agenda') window.P46.carregarSlots();
        if (tab === 'exames') window.P46.carregarExamesRadio();
    }

    window.P46.mudarTab = mudarTab;

})();
