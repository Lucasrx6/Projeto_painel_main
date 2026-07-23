var PAINEL_VERSAO = '1.1.4';

(function () {
    'use strict';

    window.P48 = {
        CONFIG: {
            api: '/api/paineis/painel48'
        },
        Estado: {
            modo:           'hub',
            contextos:      [],
            contextoAtual:  null,
            params:         {},
            signaturePad:   null,
            pinInfo:        null,
            isAdmin:        false,
            modoFila:       false,
            voltarParaFila: false
        }
    };

})();
