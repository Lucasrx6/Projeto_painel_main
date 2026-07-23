(function () {
    'use strict';

    // ── Busca e renderização da tabela de histórico ───────────────

    function carregarHistorico() {
        var dias   = (document.getElementById('filtro-dias')   || {}).value || '7';
        var status = (document.getElementById('filtro-status') || {}).value || '';
        var setor  = (document.getElementById('filtro-setor')  || {}).value || '';

        var secao = document.getElementById('secao-historico');
        if (secao) secao.innerHTML = '<div class="loading"><div class="loading-spinner"></div><span>Buscando...</span></div>';

        var url = window.P47.CONFIG.api.chamados + '?dias=' + dias;
        if (status) url += '&status=' + encodeURIComponent(status);
        if (setor)  url += '&setor='  + encodeURIComponent(setor);

        fetch(url, { credentials: 'same-origin' })
            .then(function (r) { return r.json(); })
            .then(function (d) {
                if (!d.success) throw new Error(d.error || 'Erro');
                renderizarHistorico(d.data || d.dados || [], d.total || 0);
            })
            .catch(function (e) {
                console.error('[P47]', e);
                if (secao) secao.innerHTML = '<div class="tabela-vazio"><i class="fas fa-exclamation-circle"></i><p>Erro ao buscar histórico.</p></div>';
            });
    }

    function renderizarHistorico(lista, total) {
        var E   = window.P47.Estado;
        var esc = window.P47.escHtml;
        var dh  = window.P47.formatarDataHora;
        E.historicoData     = lista;
        E.itemSelecionadoId = null;

        var secao = document.getElementById('secao-historico');
        if (!secao) return;

        if (!lista.length) {
            secao.innerHTML = '<div class="tabela-vazio"><i class="fas fa-history"></i><p>Nenhum registro encontrado.</p></div>';
            return;
        }

        var html = '<div class="tabela-wrapper"><table class="tabela"><thead><tr>'
            + '<th>Enviado</th><th>Paciente</th><th>Exame</th><th>Setor</th>'
            + '<th>Leito</th><th>Status</th><th>Agendado</th><th>Ações</th>'
            + '</tr></thead><tbody>';

        for (var i = 0; i < lista.length; i++) {
            var item = lista[i];
            html += '<tr class="tl-clicavel" data-id="' + item.id + '" onclick="P47.selecionarItem(' + item.id + ')">'
                + '<td style="white-space:nowrap;font-size:12px">' + dh(item.criado_em) + '</td>'
                + '<td><strong>' + esc(window.P47.formatarNome(item.nm_paciente)) + '</strong><br>'
                + '<small style="color:#95a5a6">' + esc(item.nr_atendimento || '') + '</small></td>'
                + '<td>' + esc(item.ds_procedimento || '-') + '</td>'
                + '<td>' + esc(item.setor_origem_nome || '-') + '</td>'
                + '<td>' + esc(item.leito_origem || '-') + '</td>'
                + '<td>' + window.P47.badgeStatus(item.status)
                + (item.status_enfermagem === 'recusado' ? ' ' + window.P47.badgeStatusEnf('recusado') : '') + '</td>'
                + '<td style="white-space:nowrap;font-size:12px">'
                + (item.slot_data_hora ? dh(item.slot_data_hora) : '-') + '</td>'
                + '<td style="white-space:nowrap">';
            if (item.status !== 'concluido' && item.status !== 'cancelado') {
                html += '<button class="btn-admin-cancelar" onclick="event.stopPropagation();P47.abrirCancelar(' + item.id + ',\''
                    + esc(item.nm_paciente || '') + '\')">'
                    + '<i class="fas fa-ban"></i></button>';
            }
            html += '</td></tr>';
            // Sub-linha de timeline — oculta até o usuário clicar na linha
            html += '<tr class="tl-row" id="tl-row-' + item.id + '" style="display:none;">'
                  + '<td colspan="8" class="tl-row-cell"></td>'
                  + '</tr>';
        }
        html += '</tbody></table></div>';
        if (total > lista.length)
            html += '<div class="tabela-info">Exibindo ' + lista.length + ' de ' + total + ' registros.</div>';
        secao.innerHTML = html;

        if (lista.length) selecionarItem(lista[0].id);
    }

    // ── Timeline inline (sub-linha expandível) ────────────────────

    function selecionarItem(id) {
        var E  = window.P47.Estado;
        var dh = window.P47.formatarDataHora;
        var esc = window.P47.escHtml;

        // Fechar sub-linha anterior
        if (E.itemSelecionadoId !== null) {
            var anterior = document.getElementById('tl-row-' + E.itemSelecionadoId);
            if (anterior) anterior.style.display = 'none';
            var trAnterior = document.querySelector('.tl-clicavel[data-id="' + E.itemSelecionadoId + '"]');
            if (trAnterior) trAnterior.className = 'tl-clicavel';
            // Toggle: clicar na mesma linha fecha
            if (E.itemSelecionadoId === id) { E.itemSelecionadoId = null; return; }
        }

        var item = null;
        for (var i = 0; i < E.historicoData.length; i++) {
            if (E.historicoData[i].id === id) { item = E.historicoData[i]; break; }
        }
        if (!item) return;

        E.itemSelecionadoId = id;

        var trAtual = document.querySelector('.tl-clicavel[data-id="' + id + '"]');
        if (trAtual) trAtual.className = 'tl-clicavel linha-selecionada';

        // Monta um passo da timeline
        function step(icone, cor, label, valor) {
            var valTxt = valor ? dh(valor) : null;
            var cls = valTxt ? 'tl-step ok' : 'tl-step pendente';
            return '<div class="' + cls + '">'
                + '<div class="tl-step-icone" style="background:' + cor + '">'
                + '<i class="fas ' + icone + '"></i></div>'
                + '<div class="tl-step-info">'
                + '<span class="tl-step-label">' + label + '</span>'
                + '<span class="tl-step-valor">' + (valTxt || '—') + '</span>'
                + '</div></div>';
        }

        var html = '<div class="tl-inline-wrap">';

        // Envio
        html += '<div class="tl-grupo">';
        html += step('fa-paper-plane', '#6c757d', 'Enviado', item.criado_em);
        html += '</div>';

        // Enfermagem
        html += '<span class="tl-seta"><i class="fas fa-chevron-right"></i></span>';
        html += '<div class="tl-grupo">';
        html += '<span class="tl-grupo-label"><i class="fas fa-user-nurse"></i> Enfermagem</span>';
        if (item.status_enfermagem === 'recusado') {
            html += step('fa-times-circle', '#dc3545', 'Recusado', item.dt_recusa);
            if (item.motivo_recusa) {
                html += '<div style="font-size:10px;color:#842029;background:#f8d7da;border-radius:6px;padding:3px 6px;margin-top:3px;max-width:180px;word-break:break-word">'
                    + '<i class="fas fa-exclamation-circle"></i> ' + esc(item.motivo_recusa) + '</div>';
            }
        } else {
            html += step('fa-check-circle', '#28a745', 'Ciência', item.dt_ciencia);
        }
        html += '</div>';

        // Transporte
        html += '<span class="tl-seta"><i class="fas fa-chevron-right"></i></span>';
        html += '<div class="tl-grupo">';
        if (item.transp_solicitado) {
            html += '<span class="tl-grupo-label"><i class="fas fa-wheelchair"></i>'
                + (item.transp_padioleiro ? ' ' + esc(item.transp_padioleiro) : ' Transporte') + '</span>';
            html += step('fa-clock',          '#fd7e14', 'Solicitado', item.transp_solicitado);
            html += step('fa-user-check',     '#fd7e14', 'Aceito',     item.transp_aceito);
            html += step('fa-running',        '#fd7e14', 'Em rota',    item.transp_inicio);
            html += step('fa-flag-checkered', '#28a745', 'Entregue',   item.transp_conclusao);
        } else {
            html += '<div class="tl-sem-transp"><i class="fas fa-info-circle"></i> '
                + (item.requer_transporte === false ? 'Portátil' : 'Sem transporte') + '</div>';
        }
        html += '</div>';

        // Radiologia
        html += '<span class="tl-seta"><i class="fas fa-chevron-right"></i></span>';
        html += '<div class="tl-grupo">';
        html += '<span class="tl-grupo-label"><i class="fas fa-x-ray"></i> Radiologia</span>';
        html += step('fa-map-marker-alt', '#17a2b8', 'No Local',  item.dt_no_local);
        html += step('fa-play',           '#17a2b8', 'Iniciado',  item.dt_inicio_exame);
        html += step('fa-check-double',   '#28a745', 'Concluído', item.dt_conclusao_exame);
        html += '</div>';

        html += '</div>';

        var subRow = document.getElementById('tl-row-' + id);
        if (subRow) {
            var cell = subRow.querySelector('td');
            if (cell) cell.innerHTML = html;
            subRow.style.display = '';
        }
    }

    window.P47.carregarHistorico   = carregarHistorico;
    window.P47.renderizarHistorico = renderizarHistorico;
    window.P47.selecionarItem      = selecionarItem;

})();
