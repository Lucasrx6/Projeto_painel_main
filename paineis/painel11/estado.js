var PAINEL_VERSAO = '1.0.27';

(function () {
    'use strict';

    window.P11 = {
        CONFIG: {
            api: {
                dashboard: '/api/paineis/painel11/dashboard',
                lista:     '/api/paineis/painel11/lista',
                filtros:   '/api/paineis/painel11/filtros'
            },
            intervaloRefresh:       60000,
            velocidadeScroll:       0.5,
            intervaloScroll:        50,
            pausaNoFinal:           10000,
            pausaAposReset:         10000,
            delayAutoScrollInicial: 10000,
            watchdogInterval:       5000,
            watchdogMaxTravamentos: 3,
            storagePrefix:          'painel11_',
            minutosAlerta:          120,
            minutosCritico:         240
        },
        Estado: {
            dados:               [],
            carregando:          false,
            autoScrollAtivo:     false,
            autoScrollIniciado:  false,
            intervalos:          { refresh: null, scroll: null, watchdog: null },
            timeouts:            { autoScrollInicial: null },
            watchdog:            { ultimaPosicao: 0, contadorTravamento: 0 },
            multiStatusInternacao: [],
            multiStatusGv:         [],
            multiClinica:          [],
            multiConvenio:         [],
            filtrosRecolhidos:   false,
            dropdownAberto:      null
        },
        DOM: {}
    };

})();
