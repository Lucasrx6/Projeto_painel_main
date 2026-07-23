var PAINEL_VERSAO = '1.1.4';

(function () {
    'use strict';

    window.P47 = {
        CONFIG: {
            api: {
                dashboard:    '/api/paineis/painel47/dashboard',
                chamados:     '/api/paineis/painel47/chamados',
                cancelar:     '/api/paineis/painel47/chamados/{id}/cancelar',
                exportar:     '/api/paineis/painel47/exportar',
                prodSync:     '/api/paineis/painel47/producao/sync',
                prodKpis:     '/api/paineis/painel47/producao/kpis',
                prodSetor:    '/api/paineis/painel47/producao/por-setor',
                prodTipo:     '/api/paineis/painel47/producao/por-tipo',
                prodExames:   '/api/paineis/painel47/producao/exames',
                prodExportar: '/api/paineis/painel47/producao/exportar'
            },
            intervalo: 60000
        },
        Estado: {
            tabAtiva:          'dashboard',
            cancelarId:        null,
            cancelarNome:      null,
            historicoData:     [],
            itemSelecionadoId: null,
            producaoPeriodo:   'hoje',
            producaoCarregado: false
        }
    };

})();
