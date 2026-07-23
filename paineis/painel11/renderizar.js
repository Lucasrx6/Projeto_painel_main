(function () {
    'use strict';

    function criarLinha(reg) {
        var P11 = window.P11;
        var nomeFormatado = P11.formatarNome(reg.nm_pessoa_fisica);
        var convenioAbrev = P11.abreviarTexto(reg.ds_convenio, 15);
        var clinicaAbrev  = P11.abreviarTexto(reg.ds_clinica, 14);
        var tipoVaga      = P11.extrairTipoVaga(reg.ds_necessidade_vaga);
        var tempoMinutos  = reg.minutos_aguardando || 0;
        var classeLinha   = P11.determinarClasseLinha(tempoMinutos, tipoVaga, reg.status_internacao);
        var idadeStr      = reg.qt_idade ? reg.qt_idade + 'a' : '-';

        return '<tr class="' + classeLinha + '">'
            + '<td><strong>' + (reg.nr_atendimento || '-') + '</strong></td>'
            + '<td title="' + P11.escapeAttr(reg.nm_pessoa_fisica) + '">' + nomeFormatado + '</td>'
            + '<td>' + idadeStr + '</td>'
            + '<td title="' + P11.escapeAttr(reg.ds_convenio) + '">' + convenioAbrev + '</td>'
            + '<td title="' + P11.escapeAttr(reg.ds_clinica)  + '">' + clinicaAbrev  + '</td>'
            + '<td>' + P11.formatarDataHora(reg.dt_alta) + '</td>'
            + '<td>' + P11.getBadgeTipoVaga(tipoVaga) + '</td>'
            + '<td>' + P11.getBadgeStatusUnificado(reg.status_internacao, reg.cd_status_gv, reg.ds_status_gv) + '</td>'
            + '<td>' + P11.getBadgeTempoEspera(tempoMinutos, reg.status_internacao, reg.dt_alta, reg.dt_internacao) + '</td>'
            + '<td>' + (reg.nr_atendimento_internado || '-') + '</td>'
            + '<td>' + P11.formatarDataHora(reg.dt_internacao) + '</td>'
            + '</tr>';
    }

    function renderizarTabela(dados) {
        var DOM = window.P11.DOM;
        if (!DOM.painelContent) return;

        if (!dados || dados.length === 0) {
            DOM.painelContent.innerHTML = '<div class="empty-message">'
                + '<i class="fas fa-inbox"></i>'
                + '<h3>Nenhum paciente encontrado</h3>'
                + '<p>Nao ha pacientes com alta para internacao com os filtros aplicados</p>'
                + '</div>';
            return;
        }

        var html = '<div class="tabela-container"><table class="painel-table">'
            + '<thead><tr>'
            + '<th>Atend PS</th><th>Paciente</th><th>Idade</th><th>Convenio</th><th>Clinica</th>'
            + '<th>Dt Alta</th><th>Tipo Vaga</th><th>Status</th><th>Tempo Espera</th>'
            + '<th>Atend Int</th><th>Dt Internacao</th>'
            + '</tr></thead><tbody id="tabela-body">';

        for (var i = 0; i < dados.length; i++) html += criarLinha(dados[i]);

        html += '</tbody></table></div>';
        DOM.painelContent.innerHTML = html;
    }

    function atualizarDashboard(d) {
        if (!d) return;
        var DOM = window.P11.DOM;

        var cards = document.querySelectorAll('.resumo-card');
        for (var j = 0; j < cards.length; j++) {
            cards[j].classList.add('atualizando');
            (function (c) { setTimeout(function () { c.classList.remove('atualizando'); }, 300); })(cards[j]);
        }

        if (DOM.totalAltas)      DOM.totalAltas.textContent      = d.total_altas      || 0;
        if (DOM.totalAguardando) DOM.totalAguardando.textContent = d.total_aguardando  || 0;
        if (DOM.totalChamados)   DOM.totalChamados.textContent   = d.total_chamados   || 0;
        if (DOM.totalAprovados)  DOM.totalAprovados.textContent  = d.total_aprovados  || 0;
        if (DOM.totalInternados) DOM.totalInternados.textContent = d.total_internados  || 0;
        if (DOM.totalCriticos)   DOM.totalCriticos.textContent   = d.total_criticos   || 0;
        if (DOM.tempoMedio)      DOM.tempoMedio.textContent      = d.tempo_mediana_internacao || '-';
    }

    function mostrarErro(msg) {
        var DOM = window.P11.DOM;
        if (!DOM.painelContent) return;
        DOM.painelContent.innerHTML = '<div class="empty-message">'
            + '<i class="fas fa-exclamation-triangle" style="color:#dc3545;"></i>'
            + '<h3>Erro ao Carregar Dados</h3>'
            + '<p>' + msg + '</p>'
            + '<button class="btn-header" onclick="location.reload()" style="margin-top:15px;background:#dc3545;border-color:#dc3545;">'
            + '<i class="fas fa-sync-alt"></i> Tentar Novamente</button>'
            + '</div>';
    }

    window.P11.renderizarTabela  = renderizarTabela;
    window.P11.atualizarDashboard = atualizarDashboard;
    window.P11.mostrarErro       = mostrarErro;

})();
