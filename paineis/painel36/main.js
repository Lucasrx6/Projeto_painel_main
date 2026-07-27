(function () {
    'use strict';

    function trocarAba(aba) {
        var P = window.P36;
        document.querySelectorAll('.aba').forEach(function (b) {
            b.classList.toggle('aba-ativa', b.dataset.aba === aba);
        });
        document.querySelectorAll('.aba-conteudo').forEach(function (el) {
            el.style.display = (el.id === 'aba-' + aba) ? '' : 'none';
        });
        document.getElementById('filtro-bar').style.display =
            ['dashboard', 'historico', 'por-setor', 'por-padioleiro'].indexOf(aba) !== -1 ? '' : 'none';
        P.Estado.abaAtual = aba;
        carregarAbaAtual();
    }

    function carregarAbaAtual() {
        var P   = window.P36;
        var aba = P.Estado.abaAtual;
        if      (aba === 'dashboard')      P.carregarDashboard();
        else if (aba === 'por-setor')      P.carregarPorSetor();
        else if (aba === 'por-padioleiro') P.carregarPorPadioleiro();
        else if (aba === 'historico')      P.carregarHistorico();
        else if (aba === 'config')         P.carregarConfigAtual();
    }

    function trocarSubAba(sub) {
        document.querySelectorAll('.sub-aba').forEach(function (b) {
            b.classList.toggle('sub-aba-ativa', b.dataset.sub === sub);
        });
        document.querySelectorAll('.sub-conteudo').forEach(function (el) {
            el.style.display = (el.id === 'sub-' + sub) ? '' : 'none';
        });
        window.P36.Estado.subAbaAtual = sub;
        window.P36.carregarConfigAtual();
    }

    function inicializar() {
        var P = window.P36;

        document.getElementById('btn-voltar').addEventListener('click',          function () { window.history.back(); });
        document.getElementById('btn-refresh').addEventListener('click',         carregarAbaAtual);
        document.getElementById('btn-exportar').addEventListener('click',        P.exportar);
        document.getElementById('btn-aplicar-filtro').addEventListener('click',  carregarAbaAtual);
        document.getElementById('btn-fechar-modal').addEventListener('click',    P.fecharModal);
        document.getElementById('btn-modal-cancelar').addEventListener('click',  P.fecharModal);
        document.getElementById('btn-modal-salvar').addEventListener('click',    P.salvarModal);
        document.getElementById('btn-cancelar-gestao-nao').addEventListener('click', P.fecharModalCancelarGestao);
        document.getElementById('btn-cancelar-gestao-sim').addEventListener('click', P.confirmarCancelamentoGestao);

        document.querySelectorAll('.aba').forEach(function (btn) {
            btn.addEventListener('click', function () { trocarAba(btn.dataset.aba); });
        });
        document.querySelectorAll('.sub-aba').forEach(function (btn) {
            btn.addEventListener('click', function () { trocarSubAba(btn.dataset.sub); });
        });

        document.getElementById('btn-novo-padioleiro').addEventListener('click', function () { P.abrirModalPadioleiro(null); });
        document.getElementById('btn-novo-tipo').addEventListener('click',       function () { P.abrirModalTipo(null); });
        document.getElementById('btn-novo-destino').addEventListener('click',    function () { P.abrirModalDestino(null); });
        document.getElementById('btn-novo-origem').addEventListener('click',     function () { P.abrirModalOrigem(null); });
        document.getElementById('filtro-tipo-destino').addEventListener('change', P.carregarDestinos);

        var hoje = P.dataHoje();
        document.getElementById('filtro-data-inicio').value = hoje;
        document.getElementById('filtro-data-fim').value    = hoje;

        P.carregarDashboard();
        P.carregarTiposParaFiltro();
        P.Estado.refreshTimer = setInterval(function () {
            if (P.Estado.abaAtual === 'dashboard') P.carregarDashboard();
        }, P.CONFIG.intervaloRefresh);
    }

    // Exposto para uso em modais.js (confirmarCancelamentoGestao)
    window.P36.carregarAbaAtual = carregarAbaAtual;

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', inicializar);
    } else {
        inicializar();
    }

})();
