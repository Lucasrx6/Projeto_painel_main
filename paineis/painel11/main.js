(function () {
    'use strict';

    var filtrosVisiveis = false;

    function cachearElementos() {
        var DOM = window.P11.DOM;
        DOM.painelContent     = document.getElementById('painel-content');
        DOM.statusIndicator   = document.getElementById('status-indicator');
        DOM.ultimaAtualizacao = document.getElementById('ultima-atualizacao');
        DOM.totalAltas        = document.getElementById('total-altas');
        DOM.totalAguardando   = document.getElementById('total-aguardando');
        DOM.totalChamados     = document.getElementById('total-chamados');
        DOM.totalAprovados    = document.getElementById('total-aprovados');
        DOM.totalInternados   = document.getElementById('total-internados');
        DOM.totalCriticos     = document.getElementById('total-criticos');
        DOM.tempoMedio        = document.getElementById('tempo-medio');
        DOM.btnVoltar         = document.getElementById('btn-voltar');
        DOM.btnRefresh        = document.getElementById('btn-refresh');
        DOM.btnAutoScroll     = document.getElementById('btn-auto-scroll');
        DOM.btnLimpar         = document.getElementById('btn-limpar');
        DOM.btnToggleFiltros  = document.getElementById('btn-toggle-filtros');
        DOM.headerControls    = document.getElementById('header-controls');
    }

    function toggleFiltros() {
        filtrosVisiveis = !filtrosVisiveis;
        var bar = document.getElementById('filtros-bar');
        if (bar) bar.style.display = filtrosVisiveis ? 'block' : 'none';
    }

    function configurarEventos() {
        var P11    = window.P11;
        var DOM    = P11.DOM;
        var Estado = P11.Estado;

        P11.configurarToggleMultiSelects();

        if (DOM.btnToggleFiltros) DOM.btnToggleFiltros.addEventListener('click', toggleFiltros);

        if (DOM.btnLimpar) {
            DOM.btnLimpar.addEventListener('click', function () {
                P11.resetarTodosMultiSelects();
                P11.carregarDados();
            });
        }

        if (DOM.btnVoltar) {
            DOM.btnVoltar.addEventListener('click', function () {
                window.location.href = '/frontend/dashboard.html';
            });
        }

        if (DOM.btnRefresh) {
            DOM.btnRefresh.addEventListener('click', function () {
                DOM.btnRefresh.classList.add('girando');
                P11.carregarDados();
                setTimeout(function () { DOM.btnRefresh.classList.remove('girando'); }, 500);
            });
        }

        if (DOM.btnAutoScroll) {
            DOM.btnAutoScroll.addEventListener('click', function () {
                Estado.autoScrollAtivo    = !Estado.autoScrollAtivo;
                Estado.autoScrollIniciado = true;
                P11.atualizarBotaoScroll();
                if (Estado.autoScrollAtivo) P11.iniciarAutoScroll();
                else P11.pararAutoScroll();
            });
        }

        document.addEventListener('keydown', function (e) {
            if (e.key === 'Escape') {
                if (Estado.dropdownAberto) P11.fecharTodosDropdowns();
                else if (Estado.autoScrollAtivo) {
                    Estado.autoScrollAtivo = false;
                    P11.atualizarBotaoScroll();
                    P11.pararAutoScroll();
                }
            }
            if (e.key === 'F5') { e.preventDefault(); P11.carregarDados(); }
            if (e.key === ' ' && e.target === document.body) {
                e.preventDefault();
                Estado.autoScrollAtivo    = !Estado.autoScrollAtivo;
                Estado.autoScrollIniciado = true;
                P11.atualizarBotaoScroll();
                if (Estado.autoScrollAtivo) P11.iniciarAutoScroll();
                else P11.pararAutoScroll();
            }
        });

        document.addEventListener('visibilitychange', function () {
            if (document.hidden) {
                if (Estado.autoScrollAtivo) { P11.pararAutoScroll(); Estado.autoScrollAtivo = true; }
            } else {
                if (Estado.autoScrollAtivo) P11.iniciarAutoScroll();
                P11.carregarDados();
            }
        });
    }

    function inicializar() {
        var P11    = window.P11;
        var Estado = P11.Estado;

        cachearElementos();

        Estado.filtrosRecolhidos      = false;
        Estado.multiStatusInternacao  = P11.recuperarArray('multiStatusInternacao');
        Estado.multiStatusGv          = P11.recuperarArray('multiStatusGv');
        Estado.multiClinica           = P11.recuperarArray('multiClinica');
        Estado.multiConvenio          = P11.recuperarArray('multiConvenio');

        configurarEventos();
        P11.carregarFiltrosDinamicos();
        P11.carregarDados();

        Estado.intervalos.refresh = setInterval(function () { P11.carregarDados(); }, P11.CONFIG.intervaloRefresh);
    }

    window.addEventListener('DOMContentLoaded', inicializar);

})();
