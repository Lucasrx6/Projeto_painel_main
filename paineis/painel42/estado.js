var PAINEL_VERSAO = '1.0.52';

(function () {
    'use strict';

    window.P42 = {
        CONFIG: {
            apiBase:         '/api/paineis/painel42',
            refreshInterval: 15000
        },

        Estado: {
            fila:                    [],
            equipe:                  [],
            historico:               [],
            tiposDieta:              [],
            refeicoes:               [],
            contadores:              { aguardando: 0, aceito: 0, em_preparo: 0, pronto: 0, em_entrega: 0 },
            visualizacao:            'geral',
            idsAnteriores:           [],
            idsUrgentesAnteriores:   [],
            processando:             false
        },

        STATUS_CFG: {
            aguardando: { label: 'Aguardando', cor: '#6C757D', col: 'col-aguardando' },
            aceito:     { label: 'Aceito',     cor: '#17A2B8', col: 'col-aceito'     },
            em_preparo: { label: 'Em Preparo', cor: '#E67E00', col: 'col-em_preparo' },
            pronto:     { label: 'Pronto',     cor: '#8BC34A', col: 'col-pronto'     },
            em_entrega: { label: 'Em Entrega', cor: '#6F42C1', col: 'col-em_entrega' },
            entregue:   { label: 'Entregue',   cor: '#28A745', col: null             },
            cancelado:  { label: 'Cancelado',  cor: '#DC3545', col: null             }
        },

        DOM: {}
    };

})();
