var PAINEL_VERSAO = '1.1.39';

(function () {
    'use strict';

    window.P41 = {
        CONFIG: {
            apiBase:        '/api/paineis/painel41',
            refreshInterval: 30000,
            minCharsSearch:  3,
            debounceMs:      400
        },
        Estado: {
            paciente:            null,
            tipos:               [],
            refeicoes:           [],
            restricoes:          [],
            setores:             [],
            minhasSolicitacoes:  [],
            urgente:             false,
            enviando:            false,
            buscando:            false,
            _debounceTimer:      null,
            _debounceHistTimer:  null,
            buscaHist:           '',
            filtroRefeicao41:    '',
            listaFiltrada:       []
        },
        STATUS_CONFIG: {
            'aguardando': { label: 'Aguardando', cor: '#6C757D' },
            'aceito':     { label: 'Aceito',     cor: '#17A2B8' },
            'em_preparo': { label: 'Em Preparo', cor: '#E67E00' },
            'pronto':     { label: 'Pronto',     cor: '#8BC34A' },
            'em_entrega': { label: 'Em Entrega', cor: '#6F42C1' },
            'entregue':   { label: 'Entregue',   cor: '#28A745' },
            'cancelado':  { label: 'Cancelado',  cor: '#DC3545' }
        },
        DOM: {}
    };

})();
