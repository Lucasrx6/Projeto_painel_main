(function () {
    'use strict';

    function getBadgeTipoVaga(tipo) {
        var mapa = {
            'UTI':       '<span class="tipo-vaga vaga-uti"><i class="fas fa-heartbeat"></i> UTI</span>',
            'CIRURGICA': '<span class="tipo-vaga vaga-cirurgica"><i class="fas fa-cut"></i> Cirurgica</span>',
            'CLINICA':   '<span class="tipo-vaga vaga-clinica"><i class="fas fa-hospital"></i> Clinica</span>'
        };
        return mapa[tipo] || mapa['CLINICA'];
    }

    function getBadgeStatusUnificado(statusInternacao, cdStatusGv, dsStatusGv) {
        if (statusInternacao === 'INTERNADO') {
            return '<span class="badge badge-internado"><i class="fas fa-check-circle"></i> Internado</span>';
        }

        if (cdStatusGv) {
            var mapaGv = {
                'A': { classe: 'badge-aguardando',  icone: 'fa-hourglass-half', texto: 'Aguardando'  },
                'I': { classe: 'badge-chamado',      icone: 'fa-search',         texto: 'Ag. Analise' },
                'H': { classe: 'badge-transf-ext',   icone: 'fa-ambulance',      texto: 'Transf. Ext.' },
                'O': { classe: 'badge-aprovada',     icone: 'fa-handshake',      texto: 'Aceito'      },
                'P': { classe: 'badge-aprovada',     icone: 'fa-thumbs-up',      texto: 'Aprovada'    },
                'F': { classe: 'badge-acomodado',    icone: 'fa-bed',            texto: 'Acomodado'   },
                'T': { classe: 'badge-transferido',  icone: 'fa-exchange-alt',   texto: 'Transferido' },
                'N': { classe: 'badge-cancelado',    icone: 'fa-times-circle',   texto: 'Negada'      },
                'D': { classe: 'badge-cancelado',    icone: 'fa-user-slash',     texto: 'Desistiu'    },
                'C': { classe: 'badge-cancelado',    icone: 'fa-ban',            texto: 'Cancelada'   }
            };
            var info = mapaGv[cdStatusGv];
            if (info) {
                return '<span class="badge ' + info.classe + '"><i class="fas ' + info.icone + '"></i> ' + info.texto + '</span>';
            }
            return '<span class="badge badge-outros"><i class="fas fa-question-circle"></i> ' + (dsStatusGv || cdStatusGv) + '</span>';
        }

        var mapaFallback = {
            'AGUARDANDO_VAGA':  '<span class="badge badge-aguardando"><i class="fas fa-hourglass-half"></i> Aguardando</span>',
            'CHAMADO':          '<span class="badge badge-transf-ext"><i class="fas fa-ambulance"></i> Transf. Ext.</span>',
            'VAGA_APROVADA':    '<span class="badge badge-aprovada"><i class="fas fa-thumbs-up"></i> Aprovada</span>',
            'ACOMODADO':        '<span class="badge badge-acomodado"><i class="fas fa-bed"></i> Acomodado</span>',
            'TRANSFERIDO':      '<span class="badge badge-transferido"><i class="fas fa-exchange-alt"></i> Transferido</span>',
            'CANCELADO_NEGADO': '<span class="badge badge-cancelado"><i class="fas fa-ban"></i> Cancelado</span>',
            'OUTROS':           '<span class="badge badge-outros"><i class="fas fa-question-circle"></i> Outros</span>'
        };
        return mapaFallback[statusInternacao] || mapaFallback['OUTROS'] || '-';
    }

    function getBadgeTempoEspera(minutos, status, dtAlta, dtInternacao) {
        var formatarTempoEspera = window.P11.formatarTempoEspera;
        var CONFIG = window.P11.CONFIG;

        if (status === 'INTERNADO' && dtAlta && dtInternacao) {
            try {
                var altaI  = new Date(dtAlta);
                var interI = new Date(dtInternacao);
                if (!isNaN(altaI.getTime()) && !isNaN(interI.getTime())) {
                    var diffMinI = Math.floor((interI - altaI) / 1000 / 60);
                    if (diffMinI >= 0) {
                        var hI = Math.floor(diffMinI / 60);
                        var mI = diffMinI % 60;
                        return '<span class="badge-tempo tempo-internado"><i class="fas fa-check"></i> ' + hI + 'h ' + mI + 'm</span>';
                    }
                }
            } catch (e) {}
            return '<span class="texto-neutro">-</span>';
        }

        if (status === 'CHAMADO') {
            if (dtAlta && dtInternacao) {
                try {
                    var altaC  = new Date(dtAlta);
                    var interC = new Date(dtInternacao);
                    if (!isNaN(altaC.getTime()) && !isNaN(interC.getTime())) {
                        var diffMinC = Math.floor((interC - altaC) / 1000 / 60);
                        if (diffMinC >= 0) {
                            var hC = Math.floor(diffMinC / 60);
                            var mC = diffMinC % 60;
                            return '<span class="badge-tempo tempo-internado"><i class="fas fa-check"></i> ' + hC + 'h ' + mC + 'm</span>';
                        }
                    }
                } catch (e) {}
            }
            if (minutos && minutos > 0) {
                return '<span class="badge-tempo tempo-internado"><i class="fas fa-check"></i> ' + formatarTempoEspera(minutos) + '</span>';
            }
            return '<span class="texto-neutro">-</span>';
        }

        var statusAtivos = ['AGUARDANDO_VAGA', 'VAGA_APROVADA'];
        if (statusAtivos.indexOf(status) === -1) return '<span class="texto-neutro">-</span>';
        if (!minutos || minutos <= 0) return '<span class="texto-neutro">-</span>';

        var tempoFormatado = formatarTempoEspera(minutos);
        var classe = 'tempo-normal';
        var icone  = 'fa-clock';
        if (minutos >= CONFIG.minutosCritico) {
            classe = 'tempo-critico';
            icone  = 'fa-exclamation-triangle';
        } else if (minutos >= CONFIG.minutosAlerta) {
            classe = 'tempo-alerta';
        }
        return '<span class="badge-tempo ' + classe + '"><i class="fas ' + icone + '"></i> ' + tempoFormatado + '</span>';
    }

    window.P11.getBadgeTipoVaga       = getBadgeTipoVaga;
    window.P11.getBadgeStatusUnificado = getBadgeStatusUnificado;
    window.P11.getBadgeTempoEspera     = getBadgeTempoEspera;

})();
