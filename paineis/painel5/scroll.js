(function () {
    'use strict';

    function pararAutoScroll() {
        var Estado = window.P5.Estado;
        if (Estado.intervaloAutoScroll) {
            clearInterval(Estado.intervaloAutoScroll);
            Estado.intervaloAutoScroll = null;
        }
    }

    function iniciarAutoScroll() {
        var P5     = window.P5;
        var Estado = P5.Estado;
        var CONFIG = P5.CONFIG;

        pararAutoScroll();

        var grupos = document.querySelectorAll('.grupo-dia');
        if (!grupos.length) return;

        var grupoAtualIndex = 0;

        Estado.intervaloAutoScroll = setInterval(function () {
            if (!Estado.autoScrollAtivo) {
                pararAutoScroll();
                return;
            }

            var grupoAtual = grupos[grupoAtualIndex];
            if (!grupoAtual) return;

            var tbody = grupoAtual.querySelector('.cirurgias-table tbody');
            if (!tbody) return;

            var scrollAtual = tbody.scrollTop;
            var scrollMax   = tbody.scrollHeight - tbody.clientHeight;

            if (scrollMax <= 0) {
                grupoAtualIndex++;
                if (grupoAtualIndex >= grupos.length) {
                    pararAutoScroll();
                    setTimeout(function () {
                        if (!Estado.autoScrollAtivo) return;
                        for (var i = 0; i < grupos.length; i++) {
                            var tb = grupos[i].querySelector('.cirurgias-table tbody');
                            if (tb) tb.scrollTop = 0;
                        }
                        setTimeout(function () {
                            if (Estado.autoScrollAtivo) iniciarAutoScroll();
                        }, CONFIG.pausaAposReset);
                    }, CONFIG.pausaFinal);
                }
                return;
            }

            if (scrollAtual >= scrollMax - 1) {
                grupoAtualIndex++;
                if (grupoAtualIndex >= grupos.length) {
                    pararAutoScroll();
                    setTimeout(function () {
                        if (!Estado.autoScrollAtivo) return;
                        for (var i = 0; i < grupos.length; i++) {
                            var tb = grupos[i].querySelector('.cirurgias-table tbody');
                            if (tb) tb.scrollTop = 0;
                        }
                        setTimeout(function () {
                            if (Estado.autoScrollAtivo) iniciarAutoScroll();
                        }, CONFIG.pausaAposReset);
                    }, CONFIG.pausaFinal);
                }
                return;
            }

            tbody.scrollTop += CONFIG.velocidadeScroll;

        }, 50);
    }

    window.P5.iniciarAutoScroll = iniciarAutoScroll;
    window.P5.pararAutoScroll   = pararAutoScroll;

})();
