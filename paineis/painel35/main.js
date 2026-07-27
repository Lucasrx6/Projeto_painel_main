(function () {
    'use strict';

    function irParaTela(nome) {
        var mapa = { principal: 'tela-principal', historico: 'tela-historico' };
        Object.keys(mapa).forEach(function (k) {
            var el = document.getElementById(mapa[k]);
            if (el) el.style.display = (k === nome) ? '' : 'none';
        });
        window.P35.Estado.telaAtual = nome;
    }

    function inicializar() {
        var P = window.P35;

        document.getElementById('btn-voltar').addEventListener('click', function () { window.history.back(); });
        document.getElementById('btn-historico').addEventListener('click', function () { irParaTela('historico'); P.carregarHistorico(); });
        document.getElementById('btn-voltar-historico').addEventListener('click', function () { irParaTela('principal'); });
        document.getElementById('btn-aceitar-nao').addEventListener('click', P.fecharModalAceitar);
        document.getElementById('btn-aceitar-sim').addEventListener('click', P.confirmarAceite);
        document.getElementById('btn-cancelar-pad-nao').addEventListener('click', P.fecharModalCancelarPad);
        document.getElementById('btn-cancelar-pad-sim').addEventListener('click', P.confirmarCancelamentoPad);

        document.getElementById('select-padioleiro').addEventListener('change', function () {
            P.Estado.padioleiroId = this.value || null;
            P.salvarPadioleiroLocal(P.Estado.padioleiroId);
            P.carregarFila();
        });

        P.carregarPadioleiros();
        P.iniciarRefresh();
    }

    window.addEventListener('DOMContentLoaded', inicializar);
})();
