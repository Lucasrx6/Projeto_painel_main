(function () {
    'use strict';

    function trocarAba(aba) {
        window.P43.Estado.abaAtiva = aba;
        var btns = document.querySelectorAll('.aba');
        for (var i = 0; i < btns.length; i++) {
            btns[i].className = 'aba' + (btns[i].getAttribute('data-aba') === aba ? ' aba-ativa' : '');
        }
        var conteudos = document.querySelectorAll('.aba-conteudo');
        for (var j = 0; j < conteudos.length; j++) {
            conteudos[j].style.display = (conteudos[j].id === 'aba-' + aba) ? 'flex' : 'none';
        }
        if (aba === 'relatorios') {
            window.P43.carregarDietasFiltro();
            window.P43.carregarRelatorios();
        }
        if (aba === 'configuracoes') window.P43.carregarConfiguracoes();
    }

    function trocarSubaba(sub) {
        window.P43.Estado.subabaAtiva = sub;
        var btns = document.querySelectorAll('.sub-aba');
        for (var i = 0; i < btns.length; i++) {
            btns[i].className = 'sub-aba' + (btns[i].getAttribute('data-subaba') === sub ? ' sub-aba-ativa' : '');
        }
        var conteudos = document.querySelectorAll('.sub-conteudo');
        for (var j = 0; j < conteudos.length; j++) {
            conteudos[j].style.display = (conteudos[j].id === 'subaba-' + sub) ? 'flex' : 'none';
        }
        window.P43.carregarSubabaAtiva();
    }

    window.P43.trocarAba    = trocarAba;
    window.P43.trocarSubaba = trocarSubaba;

})();
