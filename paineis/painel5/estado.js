var PAINEL_VERSAO = '1.0.15';

(function () {
    'use strict';

    window.P5 = {
        CONFIG: {
            apiDashboard:          '/api/paineis/painel5/dashboard',
            apiCirurgias:          '/api/paineis/painel5/cirurgias',
            intervaloRefresh:      130000,
            velocidadeScroll:      0.5,
            delayInicioAutoScroll: 10000,
            pausaFinal:            10000,
            pausaAposReset:        10000
        },
        Estado: {
            dadosCirurgias:           [],
            autoScrollAtivo:          false,
            intervaloAutoScroll:      null,
            timeoutAutoScrollInicial: null,
            nomesAbreviados:   localStorage.getItem('painel5_nomes_abreviados') !== 'false',
            setorSelecionado:  localStorage.getItem('painel5_setor_selecionado') || 'cc'
        },
        DOM: {}
    };

})();
