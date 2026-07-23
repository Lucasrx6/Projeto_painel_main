(function () {
    'use strict';

    function inicializar() {
        var E      = window.P45.Estado;
        var CONFIG = window.P45.CONFIG;
        var pad2   = window.P45.pad2;

        // ── Restaurar preferências ──────────────────────────────────────────
        try {
            var ss = localStorage.getItem('p45_setores');
            if (ss) E.setoresSelecionados = JSON.parse(ss) || [];
        } catch (e) { E.setoresSelecionados = []; }

        E.filtroStatus = localStorage.getItem('p45_filtro_status') || 'todos';
        E.filtroData   = window.P45.hojeISO();

        // ── Helpers de navegação por data ───────────────────────────────────
        function labelData() {
            var hoje  = window.P45.hojeISO();
            var ontem = new Date();
            ontem.setDate(ontem.getDate() - 1);
            var ontemISO = ontem.getFullYear() + '-' + pad2(ontem.getMonth() + 1) + '-' + pad2(ontem.getDate());
            var d   = E.filtroData;
            var fmt = d.slice(8, 10) + '/' + d.slice(5, 7);
            if (d === hoje)     return 'Hoje — ' + fmt;
            if (d === ontemISO) return 'Ontem — ' + fmt;
            return fmt + '/' + d.slice(0, 4);
        }

        function atualizarNavData() {
            var el = document.getElementById('label-data-p45');
            if (el) el.textContent = labelData();
            var btnHoje = document.getElementById('btn-data-hoje');
            if (btnHoje) btnHoje.style.display = (E.filtroData === window.P45.hojeISO()) ? 'none' : '';
        }

        atualizarNavData();

        var btnAnt = document.getElementById('btn-data-ant');
        if (btnAnt) btnAnt.addEventListener('click', function () {
            var d = new Date(E.filtroData + 'T12:00:00');
            d.setDate(d.getDate() - 1);
            E.filtroData = d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
            atualizarNavData();
            window.P45.carregar();
        });

        var btnProx = document.getElementById('btn-data-prox');
        if (btnProx) btnProx.addEventListener('click', function () {
            var d = new Date(E.filtroData + 'T12:00:00');
            d.setDate(d.getDate() + 1);
            E.filtroData = d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
            atualizarNavData();
            window.P45.carregar();
        });

        var btnHojeEl = document.getElementById('btn-data-hoje');
        if (btnHojeEl) btnHojeEl.addEventListener('click', function () {
            E.filtroData = window.P45.hojeISO();
            atualizarNavData();
            window.P45.carregar();
        });

        // ── Pills de status (Todos / Pendente / Ciente / Recusado) ──────────
        function atualizarPillsStatus() {
            var btns = document.querySelectorAll('#filtro-status-pills .pill-status');
            for (var i = 0; i < btns.length; i++) {
                var ativo = btns[i].getAttribute('data-status') === E.filtroStatus;
                btns[i].className = btns[i].className.replace(' ativo', '') + (ativo ? ' ativo' : '');
            }
        }

        atualizarPillsStatus();

        var pillsCont = document.getElementById('filtro-status-pills');
        if (pillsCont) {
            var pillBtns = pillsCont.querySelectorAll('.pill-status');
            for (var pi = 0; pi < pillBtns.length; pi++) {
                (function (btn) {
                    btn.addEventListener('click', function () {
                        E.filtroStatus = btn.getAttribute('data-status');
                        localStorage.setItem('p45_filtro_status', E.filtroStatus);
                        atualizarPillsStatus();
                        window.P45.carregar();
                    });
                })(pillBtns[pi]);
            }
        }

        // ── Delegação de eventos para ciência / recusar (data-acao) ────────
        document.addEventListener('click', function (e) {
            var el = e.target;
            while (el && el !== document.body) {
                var acao = el.getAttribute ? el.getAttribute('data-acao') : null;
                if (acao) {
                    var id = parseInt(el.getAttribute('data-id') || '0', 10);
                    if (acao === 'ciencia') { window.P45.abrirCiencia(id); return; }
                    if (acao === 'recusar') { window.P45.abrirRecusar(id); return; }
                }
                el = el.parentNode;
            }
        });

        // ── Botões do cabeçalho ─────────────────────────────────────────────
        var btnR = document.getElementById('btn-refresh');
        if (btnR) btnR.addEventListener('click', window.P45.carregar);

        var btnV = document.getElementById('btn-voltar');
        if (btnV) btnV.addEventListener('click', function () { window.history.back(); });

        // ── Modal Ciência ───────────────────────────────────────────────────
        var mCienFechar   = document.getElementById('modal-cien-fechar');
        var mCienCancelar = document.getElementById('modal-cien-cancelar');
        var mCienConf     = document.getElementById('modal-cien-confirmar');
        var mCiencia      = document.getElementById('modal-ciencia');
        if (mCienFechar)   mCienFechar.addEventListener('click',   window.P45.fecharCiencia);
        if (mCienCancelar) mCienCancelar.addEventListener('click', window.P45.fecharCiencia);
        if (mCienConf)     mCienConf.addEventListener('click',     window.P45.confirmarCiencia);
        if (mCiencia)      mCiencia.addEventListener('click', function (e) {
            if (e.target === this) window.P45.fecharCiencia();
        });

        // ── Modal Recusar ───────────────────────────────────────────────────
        var mRecFechar   = document.getElementById('modal-rec-fechar');
        var mRecCancelar = document.getElementById('modal-rec-cancelar');
        var mRecConf     = document.getElementById('modal-rec-confirmar');
        var mRecusar     = document.getElementById('modal-recusar');
        if (mRecFechar)   mRecFechar.addEventListener('click',   window.P45.fecharRecusar);
        if (mRecCancelar) mRecCancelar.addEventListener('click', window.P45.fecharRecusar);
        if (mRecConf)     mRecConf.addEventListener('click',     window.P45.confirmarRecusar);
        if (mRecusar)     mRecusar.addEventListener('click', function (e) {
            if (e.target === this) window.P45.fecharRecusar();
        });

        // Contador de caracteres — motivo de recusa
        var motivoRecusaEl = document.getElementById('modal-rec-motivo');
        if (motivoRecusaEl) {
            motivoRecusaEl.addEventListener('input', function () {
                var len     = this.value.trim().length;
                var btnConf = document.getElementById('modal-rec-confirmar');
                var cnt     = document.getElementById('modal-rec-contador');
                var hnt     = document.getElementById('modal-rec-hint');
                if (cnt)     cnt.textContent  = len + ' / 10 mínimo';
                if (hnt)     hnt.style.color  = len >= 10 ? '#28a745' : '#dc3545';
                if (btnConf) btnConf.disabled  = len < 10;
            });
        }

        // ── Carga inicial e polling ─────────────────────────────────────────
        window.P45.carregar();
        setInterval(window.P45.carregar, CONFIG.intervalo);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', inicializar);
    } else {
        inicializar();
    }

})();
