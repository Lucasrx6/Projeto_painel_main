(function () {
    'use strict';

    function criarLinhaCirurgia(cirurgia) {
        var P5  = window.P5;
        var esc = P5.escHtml;
        var statusIcon      = P5.obterIconeStatus(cirurgia.evento_codigo, cirurgia.nr_cirurgia);
        var nomePaciente    = esc(P5.formatarNome(cirurgia.nm_paciente_pf));
        var nomeMedico      = esc(P5.formatarNome(cirurgia.nm_medico));
        var inicioFormatado = esc(P5.formatarInicioCirurgia(cirurgia.inicio_cirurgia));
        var tempoFormatado  = esc(P5.formatarTempo(cirurgia.tempo));
        var tempoClass      = cirurgia.cirurgia_em_andamento ? 'tempo-ativo' : '';

        return '<tr>' +
            '<td>' +
                '<div class="status-container">' +
                    '<div class="status-icon ' + statusIcon.classe + '" title="' + esc(statusIcon.titulo) + '">' +
                        '<i class="' + statusIcon.icone + '"></i>' +
                    '</div>' +
                    '<div class="status-texto">' + esc(statusIcon.texto) + '</div>' +
                '</div>' +
            '</td>' +
            '<td><div class="previsao-hora">' + (esc(cirurgia.previsao_termino) || '-') + '</div></td>' +
            '<td><div class="inicio-cirurgia" title="' + (esc(cirurgia.inicio_cirurgia) || 'Nao iniciada') + '">' +
                '<i class="fas fa-play-circle"></i> ' + inicioFormatado + '</div></td>' +
            '<td><div class="tempo-cirurgia ' + tempoClass + '" title="Tempo decorrido">' +
                '<i class="fas fa-hourglass-half"></i> ' + tempoFormatado + '</div></td>' +
            '<td><span class="badge-sala" title="' + (esc(cirurgia.setor_cirurgia) || '-') + '">' +
                (esc(cirurgia.setor_cirurgia) || '-') + '</span></td>' +
            '<td>' +
                '<div class="paciente-nome" title="' + (esc(cirurgia.nm_paciente_pf) || '-') + '">' + nomePaciente + '</div>' +
                '<span class="paciente-info" title="' + (esc(cirurgia.ds_convenio) || '-') + ' - ' + (esc(cirurgia.ds_idade_abrev) || '-') + '">' +
                    (esc(cirurgia.ds_convenio) || '-') + ' - ' + (esc(cirurgia.ds_idade_abrev) || '-') +
                '</span>' +
            '</td>' +
            '<td><div class="medico-nome" title="' + (esc(cirurgia.nm_medico) || '-') + '">' + nomeMedico + '</div></td>' +
            '<td><div class="cirurgia-desc" title="' + (esc(cirurgia.ds_proc_cir) || '-') + '">' +
                (esc(cirurgia.ds_proc_cir) || '-') + '</div></td>' +
        '</tr>';
    }

    function renderizarCirurgias(gruposDia) {
        var container = document.getElementById('cirurgias-content');
        if (!container) return;

        if (!gruposDia || !gruposDia.length) {
            container.innerHTML =
                '<div class="empty-message">' +
                    '<i class="fas fa-calendar-times"></i>' +
                    '<h3>Nenhuma cirurgia agendada</h3>' +
                    '<p>Nao ha cirurgias previstas para este periodo</p>' +
                '</div>';
            return;
        }

        var html = '';
        for (var i = 0; i < gruposDia.length; i++) {
            var grupo     = gruposDia[i];
            var cirurgias = grupo.cirurgias || [];
            var linhas    = '';
            for (var j = 0; j < cirurgias.length; j++) {
                linhas += criarLinhaCirurgia(cirurgias[j]);
            }
            html +=
                '<div class="grupo-dia">' +
                    '<div class="grupo-dia-header">' +
                        '<i class="fas fa-calendar-day"></i>' +
                        '<span>' + (grupo.grupo || grupo.data) + '</span>' +
                        '<span class="grupo-dia-badge">' + cirurgias.length + '</span>' +
                    '</div>' +
                    '<div class="cirurgias-table-wrapper">' +
                        '<table class="cirurgias-table">' +
                            '<thead><tr>' +
                                '<th>Status</th><th>Previsao</th><th>Inicio</th><th>Tempo</th>' +
                                '<th>Sala</th><th>Paciente</th><th>Cirurgiao</th><th>Cirurgia</th>' +
                            '</tr></thead>' +
                            '<tbody>' + linhas + '</tbody>' +
                        '</table>' +
                    '</div>' +
                '</div>';
        }

        container.innerHTML = html;
        ajustarAlturaTabelasDinamicamente();
    }

    function ajustarAlturaTabelasDinamicamente() {
        var container = document.getElementById('cirurgias-content');
        if (!container) return;
        var grupos = container.querySelectorAll('.grupo-dia');
        if (!grupos.length) return;

        var containerHeight  = container.clientHeight;
        var totalGaps        = (grupos.length - 1) * 10;
        var espacoDisponivel = containerHeight - totalGaps;
        var alturaPorGrupo   = espacoDisponivel / grupos.length;

        for (var i = 0; i < grupos.length; i++) {
            var header = grupos[i].querySelector('.grupo-dia-header');
            var wrapper = grupos[i].querySelector('.cirurgias-table-wrapper');
            var thead  = grupos[i].querySelector('.cirurgias-table thead');
            if (!header || !wrapper || !thead) continue;

            var alturaParaTbody = alturaPorGrupo - header.offsetHeight - thead.offsetHeight - 4;
            var tbody = grupos[i].querySelector('.cirurgias-table tbody');
            if (tbody) {
                tbody.style.maxHeight  = alturaParaTbody + 'px';
                tbody.style.display    = 'block';
                tbody.style.overflowY  = 'auto';
                tbody.style.overflowX  = 'hidden';
            }
        }
    }

    window.P5.criarLinhaCirurgia              = criarLinhaCirurgia;
    window.P5.renderizarCirurgias             = renderizarCirurgias;
    window.P5.ajustarAlturaTabelasDinamicamente = ajustarAlturaTabelasDinamicamente;

    window.addEventListener('resize', function () {
        if (window.P5.Estado.dadosCirurgias.length > 0) {
            setTimeout(ajustarAlturaTabelasDinamicamente, 100);
        }
    });

})();
