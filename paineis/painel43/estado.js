var PAINEL_VERSAO = '1.0.28';

(function () {
    'use strict';

    window.P43 = {
        CONFIG: {
            apiBase:     '/api/paineis/painel43',
            refreshDash: 60000
        },

        Estado: {
            abaAtiva:    'dashboard',
            subabaAtiva: 'equipe',
            relAbaAtiva: 'resumo',
            equipe:      [],
            tiposDieta:  [],
            refeicoes:   [],
            restricoes:  [],
            formRecurso: null,
            formId:      null
        },

        STATUS_COR: {
            aguardando: '#6C757D', aceito: '#17A2B8', em_preparo: '#E67E00',
            pronto: '#8BC34A', em_entrega: '#6F42C1', entregue: '#28A745', cancelado: '#DC3545'
        },

        STATUS_LABEL: {
            aguardando: 'Aguardando', aceito: 'Aceito', em_preparo: 'Em Preparo',
            pronto: 'Pronto', em_entrega: 'Em Entrega', entregue: 'Entregue', cancelado: 'Cancelado'
        }
    };

})();
