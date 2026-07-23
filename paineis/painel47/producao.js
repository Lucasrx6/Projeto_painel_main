(function () {
    'use strict';

    // ── Ponto de entrada: carrega todos os blocos de produção ─────

    function carregarProducao() {
        carregarProdKpis();
        carregarProdSetor();
        carregarProdTipo();
        carregarProdExames();
    }

    // ── KPIs ──────────────────────────────────────────────────────

    function carregarProdKpis() {
        var grid = document.getElementById('prod-kpi-grid');
        if (grid) grid.innerHTML = '<div class="loading"><div class="loading-spinner"></div></div>';

        fetch(window.P47.CONFIG.api.prodKpis + '?periodo=' + window.P47.Estado.producaoPeriodo, { credentials: 'same-origin' })
            .then(function (r) { return r.json(); })
            .then(function (d) {
                if (!d.success) throw new Error(d.error || 'Erro');
                renderizarProdKpis(d);
            })
            .catch(function (e) {
                console.error('[P47 prod]', e);
                if (grid) grid.innerHTML = '<div class="tabela-vazio"><i class="fas fa-exclamation-circle"></i><p>Erro ao carregar KPIs.</p></div>';
            });
    }

    function renderizarProdKpis(d) {
        var grid = document.getElementById('prod-kpi-grid');
        if (!grid) return;

        var syncEl = document.getElementById('producao-ultima-sync');
        if (syncEl && d.ultima_sync) syncEl.textContent = 'Sync: ' + window.P47.formatarDataHora(d.ultima_sync);

        function card(cls, icone, cor, num, label, sub) {
            return '<div class="prod-kpi-card ' + cls + '">'
                + '<div class="prod-kpi-icone" style="color:' + cor + '"><i class="fas ' + icone + '"></i></div>'
                + '<div class="prod-kpi-num"  style="color:' + cor + '">' + (num !== null && num !== undefined ? num : '—') + '</div>'
                + '<div class="prod-kpi-label">' + label + '</div>'
                + (sub ? '<div class="prod-kpi-sub">' + sub + '</div>' : '')
                + '</div>';
        }

        var taxa = (d.taxa_laudo_pct !== null && d.taxa_laudo_pct !== undefined) ? d.taxa_laudo_pct + '%' : '—';
        var tm1  = (d.media_h_presc_exec  !== null && d.media_h_presc_exec  !== undefined) ? d.media_h_presc_exec  + 'h' : '—';
        var tm2  = (d.media_h_exec_laudo  !== null && d.media_h_exec_laudo  !== undefined) ? d.media_h_exec_laudo  + 'h' : '—';

        grid.innerHTML = ''
            + card('k-total',     'fa-prescription-bottle',  '#17a2b8', d.total_prescritos,    'Prescritos',         null)
            + card('k-exec',      'fa-x-ray',                '#fd7e14', d.executados,           'Executados',         null)
            + card('k-laudado',   'fa-check-double',          '#28a745', d.laudados,             'Laudados',           null)
            + card('k-semlaudo',  'fa-hourglass-half',        '#e0a800', d.sem_laudo,            'Sem Laudo',          null)
            + card('k-sem-envio', 'fa-exclamation-triangle',  '#dc3545', d.sem_envio_enfermagem, 'Sem Envio Enf.',    'realizados sem registro da enfermagem')
            + card('k-taxa',      'fa-percent',               '#6610f2', taxa,                   'Taxa Laudo',        'laudados / executados')
            + card('k-tm1',       'fa-stopwatch',             '#6c757d', tm1,                    'TM Presc → Exec',  'tempo médio em horas')
            + card('k-tm2',       'fa-stopwatch',             '#6c757d', tm2,                    'TM Exec → Laudo',  'tempo médio em horas');
    }

    // ── Por Setor ─────────────────────────────────────────────────

    function carregarProdSetor() {
        var el = document.getElementById('prod-setor');
        if (el) el.innerHTML = '<div class="loading"><div class="loading-spinner"></div></div>';

        fetch(window.P47.CONFIG.api.prodSetor + '?periodo=' + window.P47.Estado.producaoPeriodo, { credentials: 'same-origin' })
            .then(function (r) { return r.json(); })
            .then(function (d) {
                if (!d.success) throw new Error();
                renderizarProdSetor(d.data || []);
            })
            .catch(function () {
                if (el) el.innerHTML = '<div class="tabela-vazio"><p>Erro ao carregar.</p></div>';
            });
    }

    function renderizarProdSetor(lista) {
        var el  = document.getElementById('prod-setor');
        var esc = window.P47.escHtml;
        if (!el) return;
        if (!lista.length) { el.innerHTML = '<div class="tabela-vazio"><p>Sem dados.</p></div>'; return; }

        var max = 0;
        for (var i = 0; i < lista.length; i++) if ((lista[i].total || 0) > max) max = lista[i].total;

        var html = '<div class="tabela-wrapper"><table class="tabela"><thead><tr>'
            + '<th>Setor</th><th class="num">Total</th><th class="num">Exec.</th>'
            + '<th class="num">Laudados</th><th class="num">S/Laudo</th><th class="num">TM (h)</th>'
            + '</tr></thead><tbody>';

        for (var j = 0; j < lista.length; j++) {
            var r = lista[j];
            var pct = max > 0 ? Math.round((r.total / max) * 100) : 0;
            html += '<tr>'
                + '<td><span style="font-size:12px">' + esc(r.setor || '-') + '</span>'
                + '<div class="barra-bg"><div class="barra-fill" style="width:' + pct + '%"></div></div></td>'
                + '<td class="num"><strong>' + (r.total || 0) + '</strong></td>'
                + '<td class="num">' + (r.executados || 0) + '</td>'
                + '<td class="num" style="color:#28a745">' + (r.laudados || 0) + '</td>'
                + '<td class="num" style="color:#e0a800">' + (r.sem_laudo || 0) + '</td>'
                + '<td class="num">' + (r.media_h_espera !== null ? r.media_h_espera : '—') + '</td>'
                + '</tr>';
        }
        html += '</tbody></table></div>';
        el.innerHTML = html;
    }

    // ── Por Tipo de Exame ─────────────────────────────────────────

    function carregarProdTipo() {
        var el = document.getElementById('prod-tipo');
        if (el) el.innerHTML = '<div class="loading"><div class="loading-spinner"></div></div>';

        fetch(window.P47.CONFIG.api.prodTipo + '?periodo=' + window.P47.Estado.producaoPeriodo, { credentials: 'same-origin' })
            .then(function (r) { return r.json(); })
            .then(function (d) {
                if (!d.success) throw new Error();
                renderizarProdTipo(d.data || []);
            })
            .catch(function () {
                if (el) el.innerHTML = '<div class="tabela-vazio"><p>Erro ao carregar.</p></div>';
            });
    }

    function renderizarProdTipo(lista) {
        var el  = document.getElementById('prod-tipo');
        var esc = window.P47.escHtml;
        if (!el) return;
        if (!lista.length) { el.innerHTML = '<div class="tabela-vazio"><p>Sem dados.</p></div>'; return; }

        var max = 0;
        for (var i = 0; i < lista.length; i++) if ((lista[i].total || 0) > max) max = lista[i].total;

        var html = '<div class="tabela-wrapper"><table class="tabela"><thead><tr>'
            + '<th>Exame</th><th class="num">Total</th><th class="num">Laudados</th><th class="num">TM (h)</th>'
            + '</tr></thead><tbody>';

        for (var j = 0; j < lista.length; j++) {
            var r = lista[j];
            var pct = max > 0 ? Math.round((r.total / max) * 100) : 0;
            html += '<tr>'
                + '<td><span style="font-size:12px">' + esc(r.tipo || '-') + '</span>'
                + '<div class="barra-bg"><div class="barra-fill" style="width:' + pct + '%;background:#17a2b8"></div></div></td>'
                + '<td class="num"><strong>' + (r.total || 0) + '</strong></td>'
                + '<td class="num" style="color:#28a745">' + (r.laudados || 0) + '</td>'
                + '<td class="num">' + (r.media_h_espera !== null ? r.media_h_espera : '—') + '</td>'
                + '</tr>';
        }
        html += '</tbody></table></div>';
        el.innerHTML = html;
    }

    // ── Lista de exames ───────────────────────────────────────────

    function carregarProdExames() {
        var el     = document.getElementById('prod-exames');
        var status = (document.getElementById('prod-filtro-status') || {}).value || '';
        var setor  = (document.getElementById('prod-filtro-setor')  || {}).value || '';
        if (el) el.innerHTML = '<div class="loading"><div class="loading-spinner"></div></div>';

        var url = window.P47.CONFIG.api.prodExames + '?periodo=' + window.P47.Estado.producaoPeriodo;
        if (status) url += '&status=' + encodeURIComponent(status);
        if (setor)  url += '&setor='  + encodeURIComponent(setor);

        fetch(url, { credentials: 'same-origin' })
            .then(function (r) { return r.json(); })
            .then(function (d) {
                if (!d.success) throw new Error(d.error || 'Erro');
                renderizarProdExames(d.data || [], d.total || 0);
            })
            .catch(function (e) {
                console.error('[P47 prod]', e);
                if (el) el.innerHTML = '<div class="tabela-vazio"><p>Erro ao buscar exames.</p></div>';
            });
    }

    function renderizarProdExames(lista, total) {
        var el  = document.getElementById('prod-exames');
        var esc = window.P47.escHtml;
        var dh  = window.P47.formatarDataHora;
        if (!el) return;

        if (!lista.length) {
            el.innerHTML = '<div class="tabela-vazio"><i class="fas fa-x-ray"></i><p>Nenhum exame encontrado.</p></div>';
            return;
        }

        var html = '<div class="tabela-wrapper"><table class="tabela"><thead><tr>'
            + '<th>Paciente</th><th>Exame</th><th>Setor</th><th>Leito</th>'
            + '<th style="text-align:center">Status</th>'
            + '<th style="text-align:center">Envio Enf.</th>'
            + '<th style="text-align:center">Prescrição</th>'
            + '<th style="text-align:center">Execução</th>'
            + '<th style="text-align:center">Laudo</th>'
            + '<th class="num">TM P→E</th>'
            + '<th class="num">TM E→L</th>'
            + '</tr></thead><tbody>';

        for (var i = 0; i < lista.length; i++) {
            var it = lista[i];
            var urgCls    = it.ie_urgente === 'S' ? ' linha-urgente' : '';
            var badgeEnvio = it.sem_envio_enfermagem
                ? '<span class="badge-sem-envio-prod"><i class="fas fa-exclamation-triangle"></i> Sem envio</span>'
                : '<span style="font-size:11px;color:#aaa">—</span>';

            html += '<tr class="' + urgCls + '">'
                + '<td><span style="font-size:13px">' + esc(window.P47.formatarNome(it.nm_pessoa_fisica)) + '</span>'
                + '<div style="font-size:10px;color:#aaa">' + esc(it.nr_atendimento || '') + '</div></td>'
                + '<td style="font-size:12px">' + esc(it.ds_procedimento || '-')
                + (it.ie_urgente === 'S' ? ' <span class="badge-urgente" style="font-size:9px">URG</span>' : '') + '</td>'
                + '<td style="font-size:12px">' + esc(it.nm_setor || '-') + '</td>'
                + '<td style="font-size:12px">' + esc(it.leito || '-') + '</td>'
                + '<td style="text-align:center">' + window.P47.badgeProdStatus(it.status_radiologia) + '</td>'
                + '<td style="text-align:center">' + badgeEnvio + '</td>'
                + '<td style="text-align:center;font-size:11px;white-space:nowrap">' + dh(it.dt_pedido) + '</td>'
                + '<td style="text-align:center;font-size:11px;white-space:nowrap">'
                + (it.dt_execucao
                    ? dh(it.dt_execucao) + (it.nm_executor ? '<div style="font-size:9px;color:#aaa">' + esc(it.nm_executor) + '</div>' : '')
                    : '<span style="color:#ccc">—</span>') + '</td>'
                + '<td style="text-align:center;font-size:11px;white-space:nowrap">'
                + (it.dt_laudo
                    ? dh(it.dt_laudo) + (it.nm_laudador ? '<div style="font-size:9px;color:#aaa">' + esc(it.nm_laudador) + '</div>' : '')
                    : '<span style="color:#ccc">—</span>') + '</td>'
                + '<td class="num" style="font-size:11px">' + (it.h_presc_exec  !== null ? it.h_presc_exec  + 'h' : '—') + '</td>'
                + '<td class="num" style="font-size:11px">' + (it.h_exec_laudo  !== null ? it.h_exec_laudo  + 'h' : '—') + '</td>'
                + '</tr>';
        }
        html += '</tbody></table></div>';
        if (total > lista.length)
            html += '<div class="tabela-info">Exibindo ' + lista.length + ' de ' + total + ' registros.</div>';
        el.innerHTML = html;
    }

    // ── Sincronização manual ──────────────────────────────────────

    function sincronizarProducao() {
        var btn = document.getElementById('btn-prod-sync');
        if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Sincronizando...'; }

        fetch(window.P47.CONFIG.api.prodSync, { method: 'POST', credentials: 'same-origin' })
            .then(function (r) { return r.json(); })
            .then(function (d) {
                if (d.success) {
                    window.P47.toast('Sincronizado: ' + d.registros_afetados + ' registros atualizados.', 'success');
                    carregarProducao();
                } else {
                    window.P47.toast('Erro: ' + (d.error || 'Falha na sincronização'), 'error');
                }
            })
            .catch(function (e) {
                console.error('[P47 sync]', e);
                window.P47.toast('Erro de conexão', 'error');
            })
            .finally(function () {
                if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-sync-alt"></i> Sincronizar'; }
            });
    }

    // ── Exportar produção como CSV ────────────────────────────────

    function exportarProducao() {
        var status = (document.getElementById('prod-filtro-status') || {}).value || '';
        var setor  = (document.getElementById('prod-filtro-setor')  || {}).value || '';
        var url = window.P47.CONFIG.api.prodExportar + '?periodo=' + window.P47.Estado.producaoPeriodo;
        if (status) url += '&status=' + encodeURIComponent(status);
        if (setor)  url += '&setor='  + encodeURIComponent(setor);
        window.location.href = url;
    }

    window.P47.carregarProducao      = carregarProducao;
    window.P47.carregarProdKpis      = carregarProdKpis;
    window.P47.renderizarProdKpis    = renderizarProdKpis;
    window.P47.carregarProdSetor     = carregarProdSetor;
    window.P47.renderizarProdSetor   = renderizarProdSetor;
    window.P47.carregarProdTipo      = carregarProdTipo;
    window.P47.renderizarProdTipo    = renderizarProdTipo;
    window.P47.carregarProdExames    = carregarProdExames;
    window.P47.renderizarProdExames  = renderizarProdExames;
    window.P47.sincronizarProducao   = sincronizarProducao;
    window.P47.exportarProducao      = exportarProducao;

})();
