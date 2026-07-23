(function () {
    'use strict';

    // ── Wiring de eventos da página ───────────────────────────────

    function inicializar() {
        var E = window.P47.Estado;

        // Botões de aba
        var abas = document.querySelectorAll('.aba');
        for (var i = 0; i < abas.length; i++) {
            (function (btn) {
                btn.addEventListener('click', function () {
                    window.P47.mudarTab(btn.getAttribute('data-aba'));
                });
            })(abas[i]);
        }

        // Header
        var btnR = document.getElementById('btn-refresh');
        if (btnR) btnR.addEventListener('click', function () {
            if (E.tabAtiva === 'dashboard') window.P47.carregarDashboard();
            else if (E.tabAtiva === 'historico') window.P47.carregarHistorico();
        });
        var btnV = document.getElementById('btn-voltar');
        if (btnV) btnV.addEventListener('click', function () { window.history.back(); });

        // Aba histórico
        var btnB = document.getElementById('btn-buscar');
        if (btnB) btnB.addEventListener('click', window.P47.carregarHistorico);
        var btnE = document.getElementById('btn-exportar');
        if (btnE) btnE.addEventListener('click', window.P47.exportar);

        // Aba produção — pills de período
        var prodPills = document.querySelectorAll('#prod-periodo-pills .prod-pill');
        for (var pp = 0; pp < prodPills.length; pp++) {
            (function (btn) {
                btn.addEventListener('click', function () {
                    E.producaoPeriodo = btn.getAttribute('data-periodo');
                    for (var k = 0; k < prodPills.length; k++)
                        prodPills[k].className = 'prod-pill' + (prodPills[k] === btn ? ' ativo' : '');
                    window.P47.carregarProducao();
                });
            })(prodPills[pp]);
        }
        var btnPS = document.getElementById('btn-prod-sync');
        if (btnPS) btnPS.addEventListener('click', window.P47.sincronizarProducao);
        var btnPE = document.getElementById('btn-prod-exportar');
        if (btnPE) btnPE.addEventListener('click', window.P47.exportarProducao);
        var btnPB = document.getElementById('prod-btn-buscar');
        if (btnPB) btnPB.addEventListener('click', window.P47.carregarProdExames);

        // Modal cancelar
        var modalCanc  = document.getElementById('modal-cancelar');
        var btnMF1     = document.getElementById('modal-cancelar-fechar');
        var btnMF2     = document.getElementById('modal-cancelar-btn-fechar');
        var btnMConf   = document.getElementById('modal-cancelar-confirmar');
        if (btnMF1)  btnMF1.addEventListener('click', function () { if (modalCanc) modalCanc.style.display = 'none'; });
        if (btnMF2)  btnMF2.addEventListener('click', function () { if (modalCanc) modalCanc.style.display = 'none'; });
        if (modalCanc) modalCanc.addEventListener('click', function (e) { if (e.target === this) this.style.display = 'none'; });
        if (btnMConf) btnMConf.addEventListener('click', window.P47.confirmarCancelar);

        // Carga inicial e polling do dashboard
        window.P47.carregarDashboard();
        setInterval(function () {
            if (E.tabAtiva === 'dashboard') window.P47.carregarDashboard();
        }, window.P47.CONFIG.intervalo);

        _agendarSincronizacaoAutomatica();
    }

    // ── Sincroniza produção automaticamente às 00h, 06h, 12h, 18h ─

    function _agendarSincronizacaoAutomatica() {
        var HORARIOS = [0, 6, 12, 18];

        function proximoDisparo() {
            var agora  = new Date();
            var hAtual = agora.getHours() * 60 + agora.getMinutes();
            var minutos = null;
            for (var i = 0; i < HORARIOS.length; i++) {
                var hAlvo = HORARIOS[i] * 60;
                if (hAlvo > hAtual) { minutos = hAlvo - hAtual; break; }
            }
            if (minutos === null) minutos = (24 * 60) - hAtual;
            return minutos * 60 * 1000 - agora.getSeconds() * 1000 - agora.getMilliseconds();
        }

        function programar() {
            setTimeout(function () {
                window.P47.sincronizarProducao();
                programar();
            }, proximoDisparo());
        }

        programar();
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', inicializar);
    else inicializar();

})();
