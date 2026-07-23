(function () {
    'use strict';

    // ── Bootstrap — carrega contextos e decide a tela inicial ─────

    function carregarContextos(callback) {
        fetch(window.P48.CONFIG.api + '/contextos', { credentials: 'same-origin' })
            .then(function (r) { return r.json(); })
            .then(function (d) {
                if (d.success) {
                    window.P48.Estado.contextos = d.contextos || [];
                    window.P48.Estado.isAdmin   = d.is_admin  || false;
                }
                if (callback) callback();
            })
            .catch(function (e) {
                console.error('[P48] Erro ao carregar contextos:', e);
                if (callback) callback();
            });
    }

    // ── Wiring de modais ──────────────────────────────────────────

    function _configurarModais() {
        var E = window.P48.Estado;

        // Modal comprovante
        var modalComp     = document.getElementById('modal-comprovante');
        var btnCompFechar = document.getElementById('modal-comp-fechar');
        var btnCompFin    = document.getElementById('modal-comp-finalizar');

        if (btnCompFechar && modalComp) {
            btnCompFechar.addEventListener('click', function () {
                modalComp.style.display = 'none';
            });
        }
        if (btnCompFin) {
            btnCompFin.addEventListener('click', function () {
                if (window.opener && !window.opener.closed) {
                    window.close();
                } else if (E.voltarParaFila) {
                    if (modalComp) modalComp.style.display = 'none';
                    E.voltarParaFila = false;
                    window.P48.renderizarFilaEntrega();
                } else {
                    if (modalComp) modalComp.style.display = 'none';
                    window.P48.irParaHub();
                }
            });
        }

        // Modal ver assinatura (histórico)
        var modalVer  = document.getElementById('modal-ver');
        var btnVer1   = document.getElementById('modal-ver-fechar');
        var btnVer2   = document.getElementById('modal-ver-fechar2');
        if (btnVer1 && modalVer) { btnVer1.addEventListener('click', function () { modalVer.style.display = 'none'; }); }
        if (btnVer2 && modalVer) { btnVer2.addEventListener('click', function () { modalVer.style.display = 'none'; }); }
    }

    // ── Botão Voltar ──────────────────────────────────────────────

    function _configurarBotaoVoltar() {
        var E          = window.P48.Estado;
        var btnVoltar  = document.getElementById('btn-voltar');
        var btnVoltHub = document.getElementById('btn-voltar-hub');

        if (btnVoltar) {
            btnVoltar.addEventListener('click', function () { window.history.back(); });
        }
        if (btnVoltHub) {
            btnVoltHub.addEventListener('click', function () {
                if (E.modoFila) {
                    window.P48.renderizarFilaEntrega();
                } else {
                    window.P48.irParaHub();
                }
            });
        }
    }

    // ── Entrada principal ─────────────────────────────────────────

    function inicializar() {
        var E = window.P48.Estado;
        E.params = window.P48.lerParams();

        _configurarBotaoVoltar();
        _configurarModais();

        // Modo embedded: contexto + ref_id passados na URL → vai direto para assinatura
        if (E.params.contexto && E.params.ref_id) {
            E.contextoAtual = {
                codigo: E.params.contexto,
                nome:   window.P48.nomeContexto(E.params.contexto),
                icone:  E.params.icone || 'fa-signature',
                cor:    E.params.cor   || '#0d6efd'
            };
            carregarContextos(function () { window.P48.renderizarAssinatura(); });
        } else {
            carregarContextos(function () { window.P48.irParaHub(); });
        }
    }

    window.addEventListener('DOMContentLoaded', inicializar);

})();
