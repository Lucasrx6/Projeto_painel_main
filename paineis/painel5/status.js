(function () {
    'use strict';

    function obterIconeStatus(eventoCodigo, nr_cirurgia) {
        if (!nr_cirurgia || nr_cirurgia === null || nr_cirurgia === '' || nr_cirurgia === 'null') {
            return { classe: 'status-prevista',  icone: 'fas fa-calendar-check', titulo: 'Cirurgia Prevista',    texto: 'Previsto' };
        }

        var codigo = parseInt(eventoCodigo);

        if (isNaN(codigo)) {
            return { classe: 'status-sem-status', icone: 'fas fa-clock',          titulo: 'Aguardando Status',    texto: 'Aguardando' };
        }

        switch (codigo) {
            case 12:
                return { classe: 'status-entrada-cc',      icone: 'fas fa-door-open',      titulo: 'Entrada Paciente no Centro Cirurgico', texto: 'Entrada CC'  };
            case 13:
                return { classe: 'status-inicio-cirurgia', icone: 'fas fa-procedures',      titulo: 'Cirurgia em Andamento',                texto: 'Em Cirurgia' };
            case 14:
                return { classe: 'status-entrada-rpa',     icone: 'fas fa-bed',             titulo: 'Paciente na Recuperacao Pos-Anestesica', texto: 'RPA'       };
            case 15:
                return { classe: 'status-realizada',       icone: 'fas fa-check-circle',    titulo: 'Saida da Recuperacao',                 texto: 'Saida RPA'   };
            case 16:
                return { classe: 'status-realizada',       icone: 'fas fa-check-circle',    titulo: 'Cirurgia Concluida',                   texto: 'Concluida'   };
            default:
                return { classe: 'status-sem-status',      icone: 'fas fa-question-circle', titulo: 'Status Desconhecido (Codigo: ' + codigo + ')', texto: 'Indefinido' };
        }
    }

    window.P5.obterIconeStatus = obterIconeStatus;

})();
