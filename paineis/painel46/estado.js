var PAINEL_VERSAO = '1.1.4';

(function () {
    'use strict';

    window.P46 = {
        CONFIG: {
            api: {
                fila:              '/api/paineis/painel46/fila',
                slots:             '/api/paineis/painel46/slots',
                slotsLote:         '/api/paineis/painel46/slots/lote',
                exameStatus:       '/api/paineis/painel46/exames/{id}/status',
                agendar:           '/api/paineis/painel46/exames/{id}/agendar',
                slotUpdate:        '/api/paineis/painel46/slots/{id}',
                slotDelete:        '/api/paineis/painel46/slots/{id}',
                prescricoes:       '/api/paineis/painel46/prescricoes',
                agendarPrescricao: '/api/paineis/painel46/agendar-prescricao',
                agendarLote:       '/api/paineis/painel46/agendar-lote',
                slotsPorTipo:      '/api/paineis/painel46/slots-por-tipo',
                slotDesvincular:   '/api/paineis/painel46/slots/{id}/desvincular'
            },
            intervalo: 45000
        },

        Estado: {
            tabAtiva:                  'fila',
            dataConsulta:              (function () {
                var d = new Date();
                return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2);
            })(),
            fila:                      { agendados: [], pendentes: [], recusados: [] },
            filaRecusadosAberto:       false,
            slots:                     [],
            exames:                    [],
            setoresExamesSelecionados: [],
            filtroTipoExame:           '',
            filtroModalidade:          '',
            filtroSemControle:         false,
            mostrarTodosExames:        false,
            visualizacaoExames:        'cards',
            carregandoFila:            false,
            carregandoExames:          false,
            _vincularSlotId:           null,
            _vincularCandidatos:       [],
            // Modal agendar prescrição
            modalAgendPresc:           null,
            modalAgendSlotId:          null,
            slotsDisponiveis:          [],
            // Modal de irmãos
            irmaosPresc:               null,
            irmaosSlotInfo:            null,
            // Flag: avulso aberto a partir do modal de agendamento
            avulsoParaPresc:           false
        },

        DOM: {}
    };

})();
