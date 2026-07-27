var PAINEL_VERSAO = '1.1.4';

(function () {
    'use strict';

    window.P36 = {
        CONFIG: {
            api: {
                dashboard:      '/api/paineis/painel36/dashboard',
                chamados:       '/api/paineis/painel36/chamados',
                porSetor:       '/api/paineis/painel36/por-setor',
                porPad:         '/api/paineis/painel36/por-padioleiro',
                exportar:       '/api/paineis/painel36/exportar',
                cancelar:       '/api/paineis/painel36/chamados/{id}/cancelar',
                cfgPadioleiros: '/api/paineis/painel36/config/padioleiros',
                cfgTipos:       '/api/paineis/painel36/config/tipos-movimento',
                cfgDestinos:    '/api/paineis/painel36/config/destinos',
                cfgOrigens:     '/api/paineis/painel36/config/origens'
            },
            intervaloRefresh: 30000
        },

        Estado: {
            abaAtual:          'dashboard',
            subAbaAtual:       'padioleiros',
            refreshTimer:      null,
            tiposMovimento:    [],
            modalContexto:     null,
            modalId:           null,
            chamadoCancelarId: null,
            salvando:          false
        }
    };

})();
