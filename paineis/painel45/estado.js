var PAINEL_VERSAO = '1.1.4';

(function () {
    'use strict';

    window.P45 = {
        CONFIG: {
            api: {
                agendamentos: '/api/paineis/painel45/agendamentos',
                ciencia:      '/api/paineis/painel45/exames/{id}/ciencia',
                recusar:      '/api/paineis/painel45/exames/{id}/recusar'
            },
            intervalo: 45000
        },

        Estado: {
            dados:               [],
            setoresSelecionados: [],
            filtroStatus:        'todos',  // 'todos' | 'pendente' | 'ciente' | 'recusado'
            filtroData:          '',       // YYYY-MM-DD — definido em main.js → inicializar()
            modalId:             null
        }
    };

})();
