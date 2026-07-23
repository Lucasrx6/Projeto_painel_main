(function () {
    'use strict';

    function _nivelClasse(faixaMax) {
        if (faixaMax > 40) return 'nivel-alto';
        if (faixaMax > 20) return 'nivel-medio';
        return 'nivel-baixo';
    }

    function _tendenciaHtml(tendencia) {
        if (!tendencia || tendencia === 'sem_dados') return '';

        var classe = 'tendencia-estavel';
        var icone  = 'fa-arrows-left-right';
        var texto  = 'Estavel';

        if (tendencia === 'subindo') {
            classe = 'tendencia-subindo';
            icone  = 'fa-arrow-trend-up';
            texto  = 'Subindo';
        } else if (tendencia === 'descendo') {
            classe = 'tendencia-descendo';
            icone  = 'fa-arrow-trend-down';
            texto  = 'Descendo';
        }

        return '<span class="tempo-tendencia ' + classe + '">' +
               '<i class="fas ' + icone + '"></i> ' + texto +
               '</span>';
    }

    function _filaHtml(fila) {
        if (fila > 0) {
            return '<span class="footer-item"><i class="fas fa-users"></i> ' +
                   '<strong class="fila-destaque">' + fila + '</strong> aguardando</span>';
        }
        return '<span class="footer-item"><i class="fas fa-check-circle"></i> Sem fila</span>';
    }

    function _cardClinica(clinica) {
        var escHtml = window.P17.escHtml;
        var temDados = clinica.mediana !== null && clinica.mediana !== undefined;
        var nivel    = temDados ? _nivelClasse(clinica.faixa_max) : '';

        var header = '<div class="clinica-card-header">' +
            '<span class="clinica-nome">' + escHtml(clinica.clinica) + '</span>';
        if (clinica.medicos_atendendo > 0) {
            header += '<span class="clinica-medicos">' +
                '<i class="fas fa-user-md"></i> ' + clinica.medicos_atendendo +
                ' Medico' + (clinica.medicos_atendendo !== 1 ? 's' : '') +
                '</span>';
        }
        header += '</div>';

        var body = '<div class="clinica-card-body">';
        if (temDados) {
            body += '<div class="tempo-display">' +
                '<span class="tempo-valor ' + nivel + '">' + clinica.faixa_max + '</span>' +
                '<span class="tempo-sufixo ' + nivel + '">min</span>' +
                '</div>' +
                '<span class="tempo-unidade">tempo estimado de espera</span>' +
                _tendenciaHtml(clinica.tendencia);
        } else {
            body += '<div class="tempo-sem-dados"><i class="fas fa-minus-circle"></i> Sem dados recentes</div>';
        }
        body += '</div>';

        var footer = '<div class="clinica-card-footer">' + _filaHtml(clinica.fila) + '</div>';

        return '<div class="clinica-card">' + header + body + footer + '</div>';
    }

    function renderizarClinicas(clinicas) {
        var grid = document.getElementById('clinicas-grid');
        if (!grid) return;

        if (!clinicas || !clinicas.length) {
            grid.innerHTML = '<div class="mensagem-vazia">' +
                '<i class="fas fa-clock"></i>' +
                '<p>Nenhuma clinica com dados disponiveis</p></div>';
            return;
        }

        var html = '';
        for (var i = 0; i < clinicas.length; i++) {
            html += _cardClinica(clinicas[i]);
        }
        grid.innerHTML = html;
    }

    window.P17.renderizarClinicas = renderizarClinicas;

})();
