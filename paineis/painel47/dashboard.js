(function () {
    'use strict';

    function carregarDashboard() {
        fetch(window.P47.CONFIG.api.dashboard, { credentials: 'same-origin' })
            .then(function (r) { return r.json(); })
            .then(function (d) {
                if (!d.success) throw new Error(d.error || 'Erro');
                renderizarMetricas(d);
                renderizarAtivos(d.ativos || []);
                window.P47.atualizarHora();
            })
            .catch(function (e) {
                console.error('[P47]', e);
                window.P47.toast('Erro ao carregar dashboard', 'error');
            });
    }

    function renderizarMetricas(d) {
        var ids  = ['total', 'pendentes', 'executando', 'concluidos', 'cancelados', 'slots'];
        var vals = [
            d.total_hoje || 0,
            d.pendentes  || 0,
            d.executando || 0,
            d.concluidos || 0,
            d.cancelados || 0,
            d.slots_hoje || 0
        ];
        for (var i = 0; i < ids.length; i++) {
            var el = document.getElementById('m-' + ids[i]);
            if (el) el.textContent = vals[i];
        }
    }

    function renderizarAtivos(lista) {
        var el  = document.getElementById('lista-ativos');
        var esc = window.P47.escHtml;
        if (!el) return;

        if (!lista.length) {
            el.innerHTML = '<div class="tabela-vazio"><i class="fas fa-check-circle"></i><p>Nenhum exame em andamento.</p></div>';
            return;
        }

        var html = '<div class="tabela-wrapper"><table class="tabela"><thead><tr>'
            + '<th>Paciente</th><th>Exame</th><th>Setor</th><th>Leito</th><th>Status</th><th>Desde</th><th>Ações</th>'
            + '</tr></thead><tbody>';

        for (var i = 0; i < lista.length; i++) {
            var item = lista[i];
            html += '<tr>'
                + '<td><strong>' + esc(window.P47.formatarNome(item.nm_paciente)) + '</strong><br>'
                + '<small style="color:#95a5a6">' + esc(item.nr_atendimento || '') + '</small></td>'
                + '<td>' + esc(item.ds_procedimento || '-') + '</td>'
                + '<td>' + esc(item.setor_origem_nome || '-') + '</td>'
                + '<td>' + esc(item.leito_origem || '-') + '</td>'
                + '<td>' + window.P47.badgeStatus(item.status) + '</td>'
                + '<td style="font-size:12px;white-space:nowrap;">' + window.P47.formatarDataHora(item.criado_em) + '</td>'
                + '<td>';
            if (item.status !== 'concluido' && item.status !== 'cancelado') {
                html += '<button class="btn-admin-cancelar" onclick="P47.abrirCancelar(' + item.id + ',\''
                    + esc(item.nm_paciente || '') + '\')">'
                    + '<i class="fas fa-ban"></i> Cancelar</button>';
            }
            html += '</td></tr>';
        }
        html += '</tbody></table></div>';
        el.innerHTML = html;
    }

    window.P47.carregarDashboard  = carregarDashboard;
    window.P47.renderizarMetricas = renderizarMetricas;
    window.P47.renderizarAtivos   = renderizarAtivos;

})();
