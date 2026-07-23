(function () {
    'use strict';

    function getElementoScroll() { return document.getElementById('tabela-body'); }

    function pararWatchdog() {
        var intervalos = window.P11.Estado.intervalos;
        if (intervalos.watchdog) {
            clearInterval(intervalos.watchdog);
            intervalos.watchdog = null;
        }
    }

    function pararScrollInterno() {
        var intervalos = window.P11.Estado.intervalos;
        if (intervalos.scroll) {
            clearInterval(intervalos.scroll);
            intervalos.scroll = null;
        }
        pararWatchdog();
    }

    function pararAutoScroll() {
        pararScrollInterno();
    }

    function iniciarWatchdog() {
        var P11    = window.P11;
        var Estado = P11.Estado;
        var CONFIG = P11.CONFIG;

        pararWatchdog();
        Estado.intervalos.watchdog = setInterval(function () {
            if (!Estado.autoScrollAtivo) { pararWatchdog(); return; }
            var e = getElementoScroll();
            if (!e) return;
            var p  = e.scrollTop;
            var sm = e.scrollHeight - e.clientHeight;
            if (p > 5 && p < sm - 5 && Math.abs(p - Estado.watchdog.ultimaPosicao) < 1 && Estado.intervalos.scroll !== null) {
                Estado.watchdog.contadorTravamento++;
                if (Estado.watchdog.contadorTravamento >= CONFIG.watchdogMaxTravamentos) {
                    pararScrollInterno();
                    setTimeout(function () {
                        if (Estado.autoScrollAtivo) {
                            Estado.watchdog.contadorTravamento = 0;
                            iniciarAutoScroll();
                        }
                    }, 1000);
                    return;
                }
            } else {
                Estado.watchdog.contadorTravamento = 0;
            }
            Estado.watchdog.ultimaPosicao = p;
        }, CONFIG.watchdogInterval);
    }

    function iniciarAutoScroll() {
        var P11    = window.P11;
        var Estado = P11.Estado;
        var CONFIG = P11.CONFIG;

        pararScrollInterno();
        var el = getElementoScroll();
        if (!el) return;
        if (el.scrollHeight - el.clientHeight <= 5) return;

        Estado.watchdog = { ultimaPosicao: el.scrollTop, contadorTravamento: 0 };
        iniciarWatchdog();

        Estado.intervalos.scroll = setInterval(function () {
            if (!Estado.autoScrollAtivo) { pararAutoScroll(); return; }
            var e  = getElementoScroll();
            if (!e) { pararAutoScroll(); return; }
            var sm = e.scrollHeight - e.clientHeight;

            if (e.scrollTop >= sm - 2) {
                clearInterval(Estado.intervalos.scroll);
                Estado.intervalos.scroll = null;
                setTimeout(function () {
                    if (!Estado.autoScrollAtivo) return;
                    e.scrollTop = 0;
                    Estado.watchdog.ultimaPosicao    = 0;
                    Estado.watchdog.contadorTravamento = 0;
                    setTimeout(function () {
                        if (Estado.autoScrollAtivo) iniciarAutoScroll();
                    }, CONFIG.pausaAposReset);
                }, CONFIG.pausaNoFinal);
                return;
            }
            e.scrollTop += CONFIG.velocidadeScroll;
        }, CONFIG.intervaloScroll);
    }

    function atualizarBotaoScroll() {
        var DOM    = window.P11.DOM;
        var Estado = window.P11.Estado;
        if (!DOM.btnAutoScroll) return;
        if (Estado.autoScrollAtivo) {
            DOM.btnAutoScroll.classList.add('ativo');
            DOM.btnAutoScroll.innerHTML = '<i class="fas fa-pause"></i><span class="btn-text">Pausar</span>';
        } else {
            DOM.btnAutoScroll.classList.remove('ativo');
            DOM.btnAutoScroll.innerHTML = '<i class="fas fa-play"></i><span class="btn-text">Auto Scroll</span>';
        }
    }

    function agendarAutoScrollInicial() {
        var P11    = window.P11;
        var Estado = P11.Estado;
        var CONFIG = P11.CONFIG;

        if (Estado.timeouts.autoScrollInicial) clearTimeout(Estado.timeouts.autoScrollInicial);
        Estado.timeouts.autoScrollInicial = setTimeout(function () {
            if (!Estado.autoScrollAtivo && Estado.dados.length > 0) {
                Estado.autoScrollAtivo    = true;
                Estado.autoScrollIniciado = true;
                atualizarBotaoScroll();
                iniciarAutoScroll();
            }
        }, CONFIG.delayAutoScrollInicial);
    }

    window.P11.iniciarAutoScroll       = iniciarAutoScroll;
    window.P11.pararAutoScroll         = pararAutoScroll;
    window.P11.atualizarBotaoScroll    = atualizarBotaoScroll;
    window.P11.agendarAutoScrollInicial = agendarAutoScrollInicial;

})();
