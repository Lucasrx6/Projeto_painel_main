var PAINEL_VERSAO = '1.0.34';
(function () {
    'use strict';
    window.P35 = {
        CONFIG: {
            api: {
                padioleiros: '/api/paineis/painel35/padioleiros',
                fila:        '/api/paineis/painel35/fila',
                aceitar:     '/api/paineis/painel35/chamados/{id}/aceitar',
                iniciar:     '/api/paineis/painel35/chamados/{id}/iniciar',
                concluir:    '/api/paineis/painel35/chamados/{id}/concluir',
                cancelar:    '/api/paineis/painel35/chamados/{id}/cancelar',
                historico:   '/api/paineis/painel35/historico-hoje'
            },
            intervaloRefresh: 8000
        },
        Estado: {
            padioleiroId:       null,
            padioleiros:        [],
            chamadoAtivoId:     null,
            chamadosAnteriores: [],
            refreshTimer:       null,
            aceitandoId:        null,
            chamadoCancelarId:  null,
            agindo:             false,
            telaAtual:          'principal'
        }
    };
})();
