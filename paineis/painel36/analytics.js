(function () {
    'use strict';

    function carregarPorSetor() {
        var P       = window.P36;
        var f       = P.getFiltros();
        var wrapper = document.getElementById('tabela-setor-wrapper');
        wrapper.innerHTML = '<div class="loading"><div class="loading-spinner"></div><p>Carregando...</p></div>';

        fetch(P.CONFIG.api.porSetor + '?' + P.periodoQs(f), { credentials: 'same-origin' })
            .then(function (r) { return r.json(); })
            .then(function (data) {
                if (!data.success) { wrapper.innerHTML = '<p style="padding:20px;color:#aaa;">Erro ao carregar</p>'; return; }
                if (!data.setores.length) {
                    wrapper.innerHTML = '<div class="tabela-vazio"><i class="fas fa-inbox"></i><p>Nenhum dado no periodo</p></div>';
                    return;
                }
                var total  = data.setores.reduce(function (acc, s) { return acc + s.total; }, 0);
                var linhas = data.setores.map(function (s) {
                    var pct = total > 0 ? Math.round((s.total / total) * 100) : 0;
                    return '<tr>' +
                        '<td><strong>' + P.escHtml(s.setor || '-') + '</strong></td>' +
                        '<td>' + s.total + '</td>' +
                        '<td><span style="color:#28a745;font-weight:700;">' + s.concluidos + '</span></td>' +
                        '<td><span style="color:#6c757d;">' + s.cancelados + '</span></td>' +
                        '<td><span style="color:#dc3545;">' + s.urgentes + '</span></td>' +
                        '<td>' + P.min(s.tempo_medio_aceite_min) + '</td>' +
                        '<td>' + P.min(s.tempo_medio_deslocamento_min) + '</td>' +
                        '<td>' + P.min(s.tempo_medio_total_min) + '</td>' +
                        '<td><div class="barra-container"><div class="barra-bg"><div class="barra-fill" style="width:' + pct + '%"></div></div></div></td>' +
                    '</tr>';
                }).join('');
                wrapper.innerHTML =
                    '<div class="tabela-wrapper"><table class="tabela"><thead><tr>' +
                    '<th>Setor</th><th>Total</th><th>Concluidos</th><th>Cancelados</th><th>Urgentes</th>' +
                    '<th title="Da abertura ate o aceite">T. Aceite</th>' +
                    '<th title="Do aceite ate iniciar o transporte">T. Deslocamento</th>' +
                    '<th title="Da abertura ate a conclusao">T. Total</th>' +
                    '<th>Proporcao</th>' +
                    '</tr></thead><tbody>' + linhas + '</tbody></table></div>';
            })
            .catch(function () { wrapper.innerHTML = '<p style="padding:20px;color:#aaa;">Erro de conexao</p>'; });
    }

    function carregarPorPadioleiro() {
        var P       = window.P36;
        var f       = P.getFiltros();
        var wrapper = document.getElementById('tabela-padioleiro-wrapper');
        wrapper.innerHTML = '<div class="loading"><div class="loading-spinner"></div><p>Carregando...</p></div>';

        fetch(P.CONFIG.api.porPad + '?' + P.periodoQs(f), { credentials: 'same-origin' })
            .then(function (r) { return r.json(); })
            .then(function (data) {
                if (!data.success) { wrapper.innerHTML = '<p style="padding:20px;color:#aaa;">Erro ao carregar</p>'; return; }
                if (!data.padioleiros.length) {
                    wrapper.innerHTML = '<div class="tabela-vazio"><i class="fas fa-inbox"></i><p>Nenhum dado no periodo</p></div>';
                    return;
                }
                var linhas = data.padioleiros.map(function (p) {
                    return '<tr>' +
                        '<td><strong>' + P.escHtml(p.padioleiro || '-') + '</strong></td>' +
                        '<td>' + p.total + '</td>' +
                        '<td><span style="color:#28a745;font-weight:700;">' + p.concluidos + '</span></td>' +
                        '<td><span style="color:#6c757d;">' + p.cancelados + '</span></td>' +
                        '<td><span style="color:#dc3545;">' + p.urgentes + '</span></td>' +
                        '<td>' + P.min(p.tempo_medio_aceite_min) + '</td>' +
                        '<td>' + P.min(p.tempo_medio_deslocamento_min) + '</td>' +
                        '<td>' + P.min(p.tempo_medio_transporte_min) + '</td>' +
                        '<td>' + P.min(p.tempo_medio_total_min) + '</td>' +
                    '</tr>';
                }).join('');
                wrapper.innerHTML =
                    '<div class="tabela-wrapper"><table class="tabela"><thead><tr>' +
                    '<th>Padioleiro</th><th>Total</th><th>Concluidos</th><th>Cancelados</th><th>Urgentes</th>' +
                    '<th title="Da abertura ate o aceite">T. Aceite</th>' +
                    '<th title="Do aceite ate iniciar o transporte">T. Deslocamento</th>' +
                    '<th title="Do inicio ao fim do transporte">T. Transporte</th>' +
                    '<th title="Da abertura ate a conclusao">T. Total</th>' +
                    '</tr></thead><tbody>' + linhas + '</tbody></table></div>';
            })
            .catch(function () { wrapper.innerHTML = '<p style="padding:20px;color:#aaa;">Erro de conexao</p>'; });
    }

    function carregarHistorico() {
        var P       = window.P36;
        var f       = P.getFiltros();
        var wrapper = document.getElementById('tabela-historico-wrapper');
        wrapper.innerHTML = '<div class="loading"><div class="loading-spinner"></div><p>Carregando...</p></div>';

        var qs = '?' + P.periodoQs(f);
        if (f.status)     qs += '&status='     + encodeURIComponent(f.status);
        if (f.prioridade) qs += '&prioridade=' + encodeURIComponent(f.prioridade);

        fetch(P.CONFIG.api.chamados + qs, { credentials: 'same-origin' })
            .then(function (r) { return r.json(); })
            .then(function (data) {
                if (!data.success) { wrapper.innerHTML = '<p style="padding:20px;color:#aaa;">Erro</p>'; return; }
                if (!data.chamados.length) {
                    wrapper.innerHTML = '<div class="tabela-vazio"><i class="fas fa-inbox"></i><p>Nenhum chamado no periodo</p></div>';
                    return;
                }
                var linhas = data.chamados.map(function (c) {
                    var criado = c.criado_em
                        ? new Date(c.criado_em).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
                        : '--';
                    var statusCell = P.badgeStatus(c.status) +
                        (c.prioridade === 'urgente' ? ' <span class="badge-urgente">URG</span>' : '') +
                        (c.status === 'cancelado' && c.motivo_cancelamento
                            ? '<br><small style="color:#dc3545;display:inline-block;max-width:180px;white-space:normal;line-height:1.2;margin-top:4px;" title="' + P.escHtml(c.motivo_cancelamento) + '"><i class="fas fa-info-circle"></i> ' + P.escHtml(c.motivo_cancelamento) + '</small>'
                            : '');
                    var btnCancelar = (c.status !== 'concluido' && c.status !== 'cancelado')
                        ? '<button class="btn-cancelar-gestao" data-id="' + c.id + '" style="background:transparent;border:none;color:var(--danger);cursor:pointer;" title="Cancelar"><i class="fas fa-times"></i></button>'
                        : '';
                    return '<tr>' +
                        '<td><strong>#' + c.id + '</strong></td>' +
                        '<td style="white-space:nowrap;">' + criado + '</td>' +
                        '<td>' + P.escHtml(c.tipo_movimento_nome || '-') + '</td>' +
                        '<td>' + P.escHtml(c.nm_paciente || '-') + (c.leito_origem ? '<br><small style="color:#aaa;">Leito ' + P.escHtml(c.leito_origem) + '</small>' : '') + '</td>' +
                        '<td>' + P.escHtml(c.setor_origem_nome || '-') + '</td>' +
                        '<td>' + P.escHtml(c.destino_nome || '-') + '</td>' +
                        '<td>' + statusCell + '</td>' +
                        '<td>' + P.escHtml(c.padioleiro_nome || '--') + '</td>' +
                        '<td class="td-tempo">' + P.min(c.tempo_aceite_min) + '</td>' +
                        '<td class="td-tempo">' + P.min(c.tempo_deslocamento_min) + '</td>' +
                        '<td class="td-tempo">' + P.min(c.tempo_transporte_min) + '</td>' +
                        '<td class="td-tempo td-tempo-total">' + P.min(c.tempo_total_min) + '</td>' +
                        '<td>' + btnCancelar + '</td>' +
                    '</tr>';
                }).join('');
                wrapper.innerHTML =
                    '<div class="tabela-wrapper"><table class="tabela"><thead><tr>' +
                    '<th>#</th><th>Data</th><th>Tipo</th><th>Paciente</th><th>Origem</th><th>Destino</th><th>Status</th><th>Padioleiro</th>' +
                    '<th title="Da abertura ate o aceite">T.Aceite</th>' +
                    '<th title="Do aceite ate iniciar o transporte">T.Desloc.</th>' +
                    '<th title="Do inicio ao fim do transporte">T.Transp.</th>' +
                    '<th title="Tempo total">T.Total</th>' +
                    '<th>Ações</th>' +
                    '</tr></thead><tbody>' + linhas + '</tbody></table></div>';
                wrapper.querySelectorAll('.btn-cancelar-gestao').forEach(function (btn) {
                    btn.addEventListener('click', function () { P.abrirModalCancelarGestao(parseInt(btn.dataset.id)); });
                });
            })
            .catch(function () { wrapper.innerHTML = '<p style="padding:20px;color:#aaa;">Erro de conexao</p>'; });
    }

    function exportar() {
        var P   = window.P36;
        var f   = P.getFiltros();
        var url = P.CONFIG.api.exportar + '?' + P.periodoQs(f);
        if (f.status)     url += '&status='     + encodeURIComponent(f.status);
        if (f.prioridade) url += '&prioridade=' + encodeURIComponent(f.prioridade);
        var link = document.createElement('a');
        link.href = url;
        link.download = '';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    }

    window.P36.carregarPorSetor      = carregarPorSetor;
    window.P36.carregarPorPadioleiro = carregarPorPadioleiro;
    window.P36.carregarHistorico     = carregarHistorico;
    window.P36.exportar              = exportar;

})();
