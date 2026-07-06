/* PAINEL 47 - Gestão Radiologia — ES5 */
(function() {
    'use strict';

    var CONFIG = {
        api: {
            dashboard:    '/api/paineis/painel47/dashboard',
            chamados:     '/api/paineis/painel47/chamados',
            cancelar:     '/api/paineis/painel47/chamados/{id}/cancelar',
            exportar:     '/api/paineis/painel47/exportar',
            prodSync:     '/api/paineis/painel47/producao/sync',
            prodKpis:     '/api/paineis/painel47/producao/kpis',
            prodSetor:    '/api/paineis/painel47/producao/por-setor',
            prodTipo:     '/api/paineis/painel47/producao/por-tipo',
            prodExames:   '/api/paineis/painel47/producao/exames',
            prodExportar: '/api/paineis/painel47/producao/exportar'
        },
        intervalo: 60000
    };

    var Estado = {
        tabAtiva: 'dashboard',
        cancelarId: null,
        cancelarNome: null,
        historicoData: [],
        itemSelecionadoId: null,
        producaoPeriodo: 'hoje',
        producaoCarregado: false
    };

    // ── Toast ──────────────────────────────────────
    function toast(msg, tipo) {
        var c = document.getElementById('toast-container');
        if (!c) return;
        var el = document.createElement('div');
        el.className = 'toast toast-' + (tipo || 'info');
        el.textContent = msg;
        c.appendChild(el);
        setTimeout(function() { if (el.parentNode) el.parentNode.removeChild(el); }, 3500);
    }

    // ── Utilitários ────────────────────────────────
    function escHtml(t) {
        if (!t) return '';
        var d = document.createElement('div'); d.textContent = t; return d.innerHTML;
    }

    function formatarNome(nome) {
        if (!nome || !nome.trim()) return '-';
        var p = nome.trim().toUpperCase().split(/\s+/);
        if (p.length === 1) return p[0];
        var ini = [];
        for (var i = 0; i < p.length - 1; i++) ini.push(p[i].charAt(0) + '.');
        return ini.join(' ') + ' ' + p[p.length - 1];
    }

    function formatarDataHora(iso) {
        if (!iso) return '-';
        try {
            var d = new Date(iso);
            return d.toLocaleDateString('pt-BR', {day:'2-digit', month:'2-digit', year:'2-digit'}) + ' ' +
                   d.toLocaleTimeString('pt-BR', {hour:'2-digit', minute:'2-digit'});
        } catch(e) { return iso; }
    }

    function atualizarHora() {
        var el = document.getElementById('ultima-atualizacao');
        if (el) el.textContent = new Date().toLocaleTimeString('pt-BR', {hour:'2-digit', minute:'2-digit'});
    }

    function badgeStatus(status) {
        var mapa = {
            'pendente':   ['badge-pendente',   'fa-hourglass',      'Pendente'],
            'agendado':   ['badge-agendado',   'fa-calendar-check', 'Agendado'],
            'no_local':   ['badge-no_local',   'fa-map-marker-alt', 'No Local'],
            'executando': ['badge-executando', 'fa-spinner',        'Executando'],
            'concluido':  ['badge-concluido',  'fa-check-double',   'Concluído'],
            'cancelado':  ['badge-cancelado',  'fa-ban',            'Cancelado']
        };
        var m = mapa[status] || ['badge-pendente', 'fa-circle', status || '?'];
        return '<span class="badge-status ' + m[0] + '"><i class="fas ' + m[1] + '"></i> ' + m[2] + '</span>';
    }

    function badgeStatusEnf(enf) {
        if (!enf || enf === 'pendente')
            return '<span class="badge-enf badge-enf-pendente"><i class="fas fa-clock"></i> Aguard. Ciência</span>';
        if (enf === 'ciente')
            return '<span class="badge-enf badge-enf-ciente"><i class="fas fa-check"></i> Ciente</span>';
        if (enf === 'recusado')
            return '<span class="badge-enf badge-enf-recusado"><i class="fas fa-times"></i> Recusado Enf.</span>';
        return '';
    }

    // ── Tabs ───────────────────────────────────────
    function mudarTab(tab) {
        Estado.tabAtiva = tab;

        var abas = document.querySelectorAll('.aba');
        for (var i = 0; i < abas.length; i++) {
            var a = abas[i];
            a.className = a.getAttribute('data-aba') === tab ? 'aba aba-ativa' : 'aba';
        }

        var ids = ['dashboard', 'historico', 'producao'];
        for (var j = 0; j < ids.length; j++) {
            var el = document.getElementById('aba-' + ids[j]);
            if (el) el.style.display = ids[j] === tab ? '' : 'none';
        }

        if (tab === 'historico') carregarHistorico();
        if (tab === 'producao' && !Estado.producaoCarregado) {
            Estado.producaoCarregado = true;
            carregarProducao();
        }
    }

    // ── Dashboard ──────────────────────────────────
    function carregarDashboard() {
        fetch(CONFIG.api.dashboard, {credentials: 'same-origin'})
            .then(function(r) { return r.json(); })
            .then(function(d) {
                if (!d.success) throw new Error(d.error || 'Erro');
                renderizarMetricas(d);
                renderizarAtivos(d.ativos || []);
                atualizarHora();
            })
            .catch(function(e) { console.error('[P47]', e); toast('Erro ao carregar dashboard', 'error'); });
    }

    function renderizarMetricas(d) {
        var ids = ['total', 'pendentes', 'executando', 'concluidos', 'cancelados', 'slots'];
        var vals = [
            d.total_hoje  || 0,
            d.pendentes   || 0,
            d.executando  || 0,
            d.concluidos  || 0,
            d.cancelados  || 0,
            d.slots_hoje  || 0
        ];
        for (var i = 0; i < ids.length; i++) {
            var el = document.getElementById('m-' + ids[i]);
            if (el) el.textContent = vals[i];
        }
    }

    function renderizarAtivos(lista) {
        var el = document.getElementById('lista-ativos');
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
                + '<td><strong>' + escHtml(formatarNome(item.nm_paciente)) + '</strong><br>'
                + '<small style="color:#95a5a6">' + escHtml(item.nr_atendimento || '') + '</small></td>'
                + '<td>' + escHtml(item.ds_procedimento || '-') + '</td>'
                + '<td>' + escHtml(item.setor_origem_nome || '-') + '</td>'
                + '<td>' + escHtml(item.leito_origem || '-') + '</td>'
                + '<td>' + badgeStatus(item.status) + '</td>'
                + '<td style="font-size:12px;white-space:nowrap;">' + formatarDataHora(item.criado_em) + '</td>'
                + '<td>';
            if (item.status !== 'concluido' && item.status !== 'cancelado') {
                html += '<button class="btn-admin-cancelar" onclick="P47.abrirCancelar(' + item.id + ',\''
                      + escHtml(item.nm_paciente || '') + '\')">'
                      + '<i class="fas fa-ban"></i> Cancelar</button>';
            }
            html += '</td></tr>';
        }
        html += '</tbody></table></div>';
        el.innerHTML = html;
    }

    // ── Histórico ──────────────────────────────────
    function carregarHistorico() {
        var dias   = document.getElementById('filtro-dias')   ? document.getElementById('filtro-dias').value   : '7';
        var status = document.getElementById('filtro-status') ? document.getElementById('filtro-status').value : '';
        var setor  = document.getElementById('filtro-setor')  ? document.getElementById('filtro-setor').value  : '';

        var secao = document.getElementById('secao-historico');
        if (secao) secao.innerHTML = '<div class="loading"><div class="loading-spinner"></div><span>Buscando...</span></div>';

        var url = CONFIG.api.chamados + '?dias=' + dias;
        if (status) url += '&status=' + encodeURIComponent(status);
        if (setor)  url += '&setor='  + encodeURIComponent(setor);

        fetch(url, {credentials: 'same-origin'})
            .then(function(r) { return r.json(); })
            .then(function(d) {
                if (!d.success) throw new Error(d.error || 'Erro');
                renderizarHistorico(d.data || d.dados || [], d.total || 0);
            })
            .catch(function(e) {
                console.error('[P47]', e);
                if (secao) secao.innerHTML = '<div class="tabela-vazio"><i class="fas fa-exclamation-circle"></i><p>Erro ao buscar histórico.</p></div>';
            });
    }

    function renderizarHistorico(lista, total) {
        Estado.historicoData = lista;
        Estado.itemSelecionadoId = null;
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
            // Linha principal clicável
            html += '<tr class="tl-clicavel" data-id="' + item.id + '" onclick="P47.selecionarItem(' + item.id + ')">'
                + '<td style="white-space:nowrap;font-size:12px">' + formatarDataHora(item.criado_em) + '</td>'
                + '<td><strong>' + escHtml(formatarNome(item.nm_paciente)) + '</strong><br>'
                + '<small style="color:#95a5a6">' + escHtml(item.nr_atendimento || '') + '</small></td>'
                + '<td>' + escHtml(item.ds_procedimento || '-') + '</td>'
                + '<td>' + escHtml(item.setor_origem_nome || '-') + '</td>'
                + '<td>' + escHtml(item.leito_origem || '-') + '</td>'
                + '<td>' + badgeStatus(item.status)
                + (item.status_enfermagem === 'recusado' ? ' ' + badgeStatusEnf('recusado') : '') + '</td>'
                + '<td style="white-space:nowrap;font-size:12px">' + (item.slot_data_hora ? formatarDataHora(item.slot_data_hora) : '-') + '</td>'
                + '<td style="white-space:nowrap">';
            if (item.status !== 'concluido' && item.status !== 'cancelado') {
                html += '<button class="btn-admin-cancelar" onclick="event.stopPropagation();P47.abrirCancelar(' + item.id + ',\''
                      + escHtml(item.nm_paciente || '') + '\')">'
                      + '<i class="fas fa-ban"></i></button>';
            }
            html += '</td></tr>';
            // Sub-linha de timeline (oculta por padrão)
            html += '<tr class="tl-row" id="tl-row-' + item.id + '" style="display:none;">'
                  + '<td colspan="8" class="tl-row-cell"></td>'
                  + '</tr>';
        }
        html += '</tbody></table></div>';
        if (total > lista.length)
            html += '<div class="tabela-info">Exibindo ' + lista.length + ' de ' + total + ' registros.</div>';
        secao.innerHTML = html;

        // Abrir automaticamente o primeiro item
        if (lista.length) selecionarItem(lista[0].id);
    }

    // ── Linha do Tempo (sub-linha inline na tabela) ────
    function selecionarItem(id) {
        // Fechar sub-linha anterior
        if (Estado.itemSelecionadoId !== null) {
            var anterior = document.getElementById('tl-row-' + Estado.itemSelecionadoId);
            if (anterior) anterior.style.display = 'none';
            var trAnterior = document.querySelector('.tl-clicavel[data-id="' + Estado.itemSelecionadoId + '"]');
            if (trAnterior) trAnterior.className = 'tl-clicavel';
            // Toggle: clicar na mesma linha fecha
            if (Estado.itemSelecionadoId === id) {
                Estado.itemSelecionadoId = null;
                return;
            }
        }

        var item = null;
        for (var i = 0; i < Estado.historicoData.length; i++) {
            if (Estado.historicoData[i].id === id) { item = Estado.historicoData[i]; break; }
        }
        if (!item) return;

        Estado.itemSelecionadoId = id;

        // Destacar linha principal
        var trAtual = document.querySelector('.tl-clicavel[data-id="' + id + '"]');
        if (trAtual) trAtual.className = 'tl-clicavel linha-selecionada';

        // Helper: um passo da timeline
        function step(icone, cor, label, valor) {
            var valTxt = valor ? formatarDataHora(valor) : null;
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

        // Grupo 1: Envio
        html += '<div class="tl-grupo">';
        html += step('fa-paper-plane', '#6c757d', 'Enviado', item.criado_em);
        html += '</div>';

        // Seta + Grupo 2: Enfermagem
        html += '<span class="tl-seta"><i class="fas fa-chevron-right"></i></span>';
        html += '<div class="tl-grupo">';
        html += '<span class="tl-grupo-label"><i class="fas fa-user-nurse"></i> Enfermagem</span>';
        if (item.status_enfermagem === 'recusado') {
            html += step('fa-times-circle', '#dc3545', 'Recusado', item.dt_recusa);
            if (item.motivo_recusa) {
                html += '<div style="font-size:10px;color:#842029;background:#f8d7da;border-radius:6px;padding:3px 6px;margin-top:3px;max-width:180px;word-break:break-word">'
                      + '<i class="fas fa-exclamation-circle"></i> ' + escHtml(item.motivo_recusa) + '</div>';
            }
        } else {
            html += step('fa-check-circle', '#28a745', 'Ciência', item.dt_ciencia);
        }
        html += '</div>';

        // Seta + Grupo 3: Transporte
        html += '<span class="tl-seta"><i class="fas fa-chevron-right"></i></span>';
        html += '<div class="tl-grupo">';
        if (item.transp_solicitado) {
            html += '<span class="tl-grupo-label"><i class="fas fa-wheelchair"></i>'
                  + (item.transp_padioleiro ? ' ' + escHtml(item.transp_padioleiro) : ' Transporte') + '</span>';
            html += step('fa-clock',          '#fd7e14', 'Solicitado', item.transp_solicitado);
            html += step('fa-user-check',     '#fd7e14', 'Aceito',     item.transp_aceito);
            html += step('fa-running',        '#fd7e14', 'Em rota',    item.transp_inicio);
            html += step('fa-flag-checkered', '#28a745', 'Entregue',   item.transp_conclusao);
        } else {
            html += '<div class="tl-sem-transp"><i class="fas fa-info-circle"></i> '
                  + (item.requer_transporte === false ? 'Portátil' : 'Sem transporte') + '</div>';
        }
        html += '</div>';

        // Seta + Grupo 3: Radiologia
        html += '<span class="tl-seta"><i class="fas fa-chevron-right"></i></span>';
        html += '<div class="tl-grupo">';
        html += '<span class="tl-grupo-label"><i class="fas fa-x-ray"></i> Radiologia</span>';
        html += step('fa-map-marker-alt', '#17a2b8', 'No Local',   item.dt_no_local);
        html += step('fa-play',           '#17a2b8', 'Iniciado',   item.dt_inicio_exame);
        html += step('fa-check-double',   '#28a745', 'Concluído',  item.dt_conclusao_exame);
        html += '</div>';

        html += '</div>';

        // Injetar na sub-linha e exibir
        var subRow = document.getElementById('tl-row-' + id);
        if (subRow) {
            var cell = subRow.querySelector('td');
            if (cell) cell.innerHTML = html;
            subRow.style.display = '';
        }
    }

    // ── Exportar ───────────────────────────────────
    function exportar() {
        var dias   = document.getElementById('filtro-dias')   ? document.getElementById('filtro-dias').value   : '30';
        var status = document.getElementById('filtro-status') ? document.getElementById('filtro-status').value : '';
        var setor  = document.getElementById('filtro-setor')  ? document.getElementById('filtro-setor').value  : '';
        var url = CONFIG.api.exportar + '?dias=' + dias;
        if (status) url += '&status=' + encodeURIComponent(status);
        if (setor)  url += '&setor='  + encodeURIComponent(setor);
        window.location.href = url;
    }

    // ── Modal cancelar ─────────────────────────────
    function abrirCancelar(id, nome) {
        Estado.cancelarId   = id;
        Estado.cancelarNome = nome;
        var info = document.getElementById('modal-cancelar-info');
        if (info) info.textContent = 'Cancelar exame de: ' + nome;
        var motivo = document.getElementById('modal-cancelar-motivo');
        if (motivo) motivo.value = '';
        var modal = document.getElementById('modal-cancelar');
        if (modal) modal.style.display = 'flex';
    }

    function confirmarCancelar() {
        var motivo = document.getElementById('modal-cancelar-motivo')
                     ? document.getElementById('modal-cancelar-motivo').value.trim() : '';
        if (motivo.length < 5) { toast('Informe o motivo (mínimo 5 caracteres).', 'warning'); return; }

        var btn = document.getElementById('modal-cancelar-confirmar');
        if (btn) btn.disabled = true;

        fetch(CONFIG.api.cancelar.replace('{id}', Estado.cancelarId), {
            method: 'PUT', credentials: 'same-origin',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({motivo: motivo})
        })
        .then(function(r) { return r.json(); })
        .then(function(d) {
            var modal = document.getElementById('modal-cancelar');
            if (modal) modal.style.display = 'none';
            if (d.success) {
                toast('Exame cancelado.', 'warning');
                if (Estado.tabAtiva === 'dashboard') carregarDashboard();
                else carregarHistorico();
            } else toast('Erro: ' + (d.error || 'Falha ao cancelar'), 'error');
        })
        .catch(function(e) { console.error('[P47]', e); toast('Erro de conexão', 'error'); })
        .finally(function() { if (btn) btn.disabled = false; });
    }

    // ── Produção ───────────────────────────────────

    function badgeProdStatus(status) {
        if (status === 'LAUDADO')
            return '<span class="badge-status badge-concluido"><i class="fas fa-check-double"></i> Laudado</span>';
        if (status === 'EXECUTADO_SEM_LAUDO')
            return '<span class="badge-status badge-no_local"><i class="fas fa-hourglass-half"></i> Sem Laudo</span>';
        if (status === 'AGUARDANDO')
            return '<span class="badge-status badge-pendente"><i class="fas fa-clock"></i> Aguardando</span>';
        return '<span style="font-size:11px;color:#aaa;">' + escHtml(status || '-') + '</span>';
    }

    function carregarProducao() {
        carregarProdKpis();
        carregarProdSetor();
        carregarProdTipo();
        carregarProdExames();
    }

    function carregarProdKpis() {
        var grid = document.getElementById('prod-kpi-grid');
        if (grid) grid.innerHTML = '<div class="loading"><div class="loading-spinner"></div></div>';

        fetch(CONFIG.api.prodKpis + '?periodo=' + Estado.producaoPeriodo, {credentials: 'same-origin'})
            .then(function(r) { return r.json(); })
            .then(function(d) {
                if (!d.success) throw new Error(d.error || 'Erro');
                renderizarProdKpis(d);
            })
            .catch(function(e) {
                console.error('[P47 prod]', e);
                if (grid) grid.innerHTML = '<div class="tabela-vazio"><i class="fas fa-exclamation-circle"></i><p>Erro ao carregar KPIs.</p></div>';
            });
    }

    function renderizarProdKpis(d) {
        var grid = document.getElementById('prod-kpi-grid');
        if (!grid) return;

        // Última sync
        var syncEl = document.getElementById('producao-ultima-sync');
        if (syncEl && d.ultima_sync) {
            syncEl.textContent = 'Sync: ' + formatarDataHora(d.ultima_sync);
        }

        function card(cls, icone, cor, num, label, sub) {
            return '<div class="prod-kpi-card ' + cls + '">'
                + '<div class="prod-kpi-icone" style="color:' + cor + '"><i class="fas ' + icone + '"></i></div>'
                + '<div class="prod-kpi-num" style="color:' + cor + '">' + (num !== null && num !== undefined ? num : '—') + '</div>'
                + '<div class="prod-kpi-label">' + label + '</div>'
                + (sub ? '<div class="prod-kpi-sub">' + sub + '</div>' : '')
                + '</div>';
        }

        var taxa = d.taxa_laudo_pct !== null && d.taxa_laudo_pct !== undefined ? d.taxa_laudo_pct + '%' : '—';
        var tm1  = d.media_h_presc_exec  !== null && d.media_h_presc_exec  !== undefined ? d.media_h_presc_exec  + 'h' : '—';
        var tm2  = d.media_h_exec_laudo  !== null && d.media_h_exec_laudo  !== undefined ? d.media_h_exec_laudo  + 'h' : '—';

        grid.innerHTML = ''
            + card('k-total',      'fa-prescription-bottle',  '#17a2b8', d.total_prescritos,     'Prescritos',           null)
            + card('k-exec',       'fa-x-ray',                '#fd7e14', d.executados,            'Executados',           null)
            + card('k-laudado',    'fa-check-double',          '#28a745', d.laudados,              'Laudados',             null)
            + card('k-semlaudo',   'fa-hourglass-half',        '#e0a800', d.sem_laudo,             'Sem Laudo',            null)
            + card('k-sem-envio',  'fa-exclamation-triangle',  '#dc3545', d.sem_envio_enfermagem,  'Sem Envio Enf.',       'realizados sem registro da enfermagem')
            + card('k-taxa',       'fa-percent',               '#6610f2', taxa,                    'Taxa Laudo',           'laudados / executados')
            + card('k-tm1',        'fa-stopwatch',             '#6c757d', tm1,                     'TM Presc → Exec',     'tempo médio em horas')
            + card('k-tm2',        'fa-stopwatch',             '#6c757d', tm2,                     'TM Exec → Laudo',     'tempo médio em horas');
    }

    function carregarProdSetor() {
        var el = document.getElementById('prod-setor');
        if (el) el.innerHTML = '<div class="loading"><div class="loading-spinner"></div></div>';

        fetch(CONFIG.api.prodSetor + '?periodo=' + Estado.producaoPeriodo, {credentials: 'same-origin'})
            .then(function(r) { return r.json(); })
            .then(function(d) {
                if (!d.success) throw new Error();
                renderizarProdSetor(d.data || []);
            })
            .catch(function() {
                if (el) el.innerHTML = '<div class="tabela-vazio"><p>Erro ao carregar.</p></div>';
            });
    }

    function renderizarProdSetor(lista) {
        var el = document.getElementById('prod-setor');
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
            var taxaRow = r.executados > 0 ? Math.round((r.laudados / r.executados) * 100) : 0;
            html += '<tr>'
                + '<td><span style="font-size:12px">' + escHtml(r.setor || '-') + '</span>'
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

    function carregarProdTipo() {
        var el = document.getElementById('prod-tipo');
        if (el) el.innerHTML = '<div class="loading"><div class="loading-spinner"></div></div>';

        fetch(CONFIG.api.prodTipo + '?periodo=' + Estado.producaoPeriodo, {credentials: 'same-origin'})
            .then(function(r) { return r.json(); })
            .then(function(d) {
                if (!d.success) throw new Error();
                renderizarProdTipo(d.data || []);
            })
            .catch(function() {
                if (el) el.innerHTML = '<div class="tabela-vazio"><p>Erro ao carregar.</p></div>';
            });
    }

    function renderizarProdTipo(lista) {
        var el = document.getElementById('prod-tipo');
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
                + '<td><span style="font-size:12px">' + escHtml(r.tipo || '-') + '</span>'
                + '<div class="barra-bg"><div class="barra-fill" style="width:' + pct + '%;background:#17a2b8"></div></div></td>'
                + '<td class="num"><strong>' + (r.total || 0) + '</strong></td>'
                + '<td class="num" style="color:#28a745">' + (r.laudados || 0) + '</td>'
                + '<td class="num">' + (r.media_h_espera !== null ? r.media_h_espera : '—') + '</td>'
                + '</tr>';
        }
        html += '</tbody></table></div>';
        el.innerHTML = html;
    }

    function carregarProdExames() {
        var el = document.getElementById('prod-exames');
        if (el) el.innerHTML = '<div class="loading"><div class="loading-spinner"></div></div>';

        var status = document.getElementById('prod-filtro-status') ? document.getElementById('prod-filtro-status').value : '';
        var setor  = document.getElementById('prod-filtro-setor')  ? document.getElementById('prod-filtro-setor').value  : '';

        var url = CONFIG.api.prodExames + '?periodo=' + Estado.producaoPeriodo;
        if (status) url += '&status=' + encodeURIComponent(status);
        if (setor)  url += '&setor='  + encodeURIComponent(setor);

        fetch(url, {credentials: 'same-origin'})
            .then(function(r) { return r.json(); })
            .then(function(d) {
                if (!d.success) throw new Error(d.error || 'Erro');
                renderizarProdExames(d.data || [], d.total || 0);
            })
            .catch(function(e) {
                console.error('[P47 prod]', e);
                if (el) el.innerHTML = '<div class="tabela-vazio"><p>Erro ao buscar exames.</p></div>';
            });
    }

    function renderizarProdExames(lista, total) {
        var el = document.getElementById('prod-exames');
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
            var urgCls = it.ie_urgente === 'S' ? ' linha-urgente' : '';
            var badgeEnvio = it.sem_envio_enfermagem
                ? '<span class="badge-sem-envio-prod"><i class="fas fa-exclamation-triangle"></i> Sem envio</span>'
                : '<span style="font-size:11px;color:#aaa">—</span>';
            html += '<tr class="' + urgCls + '">'
                + '<td><span class="pct-nome" style="font-size:13px">' + escHtml(formatarNome(it.nm_pessoa_fisica)) + '</span>'
                + '<div style="font-size:10px;color:#aaa">' + escHtml(it.nr_atendimento || '') + '</div></td>'
                + '<td style="font-size:12px">' + escHtml(it.ds_procedimento || '-')
                + (it.ie_urgente === 'S' ? ' <span class="badge-urgente" style="font-size:9px">URG</span>' : '') + '</td>'
                + '<td style="font-size:12px">' + escHtml(it.nm_setor || '-') + '</td>'
                + '<td style="font-size:12px">' + escHtml(it.leito || '-') + '</td>'
                + '<td style="text-align:center">' + badgeProdStatus(it.status_radiologia) + '</td>'
                + '<td style="text-align:center">' + badgeEnvio + '</td>'
                + '<td style="text-align:center;font-size:11px;white-space:nowrap">' + formatarDataHora(it.dt_pedido) + '</td>'
                + '<td style="text-align:center;font-size:11px;white-space:nowrap">'
                + (it.dt_execucao ? formatarDataHora(it.dt_execucao) + (it.nm_executor ? '<div style="font-size:9px;color:#aaa">' + escHtml(it.nm_executor) + '</div>' : '') : '<span style="color:#ccc">—</span>') + '</td>'
                + '<td style="text-align:center;font-size:11px;white-space:nowrap">'
                + (it.dt_laudo ? formatarDataHora(it.dt_laudo) + (it.nm_laudador ? '<div style="font-size:9px;color:#aaa">' + escHtml(it.nm_laudador) + '</div>' : '') : '<span style="color:#ccc">—</span>') + '</td>'
                + '<td class="num" style="font-size:11px">' + (it.h_presc_exec !== null ? it.h_presc_exec + 'h' : '—') + '</td>'
                + '<td class="num" style="font-size:11px">' + (it.h_exec_laudo !== null ? it.h_exec_laudo + 'h' : '—') + '</td>'
                + '</tr>';
        }
        html += '</tbody></table></div>';
        if (total > lista.length)
            html += '<div class="tabela-info">Exibindo ' + lista.length + ' de ' + total + ' registros.</div>';
        el.innerHTML = html;
    }

    function sincronizarProducao() {
        var btn = document.getElementById('btn-prod-sync');
        if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Sincronizando...'; }

        fetch(CONFIG.api.prodSync, {method: 'POST', credentials: 'same-origin'})
            .then(function(r) { return r.json(); })
            .then(function(d) {
                if (d.success) {
                    toast('Sincronizado: ' + d.registros_afetados + ' registros atualizados.', 'success');
                    carregarProducao();
                } else {
                    toast('Erro: ' + (d.error || 'Falha na sincronização'), 'error');
                }
            })
            .catch(function(e) { console.error('[P47 sync]', e); toast('Erro de conexão', 'error'); })
            .finally(function() {
                if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-sync-alt"></i> Sincronizar'; }
            });
    }

    function exportarProducao() {
        var status = document.getElementById('prod-filtro-status') ? document.getElementById('prod-filtro-status').value : '';
        var setor  = document.getElementById('prod-filtro-setor')  ? document.getElementById('prod-filtro-setor').value  : '';
        var url = CONFIG.api.prodExportar + '?periodo=' + Estado.producaoPeriodo;
        if (status) url += '&status=' + encodeURIComponent(status);
        if (setor)  url += '&setor='  + encodeURIComponent(setor);
        window.location.href = url;
    }

    // ── Inicializar ────────────────────────────────
    function inicializar() {
        // Tabs
        var abasBtns = document.querySelectorAll('.aba');
        for (var i = 0; i < abasBtns.length; i++) {
            (function(btn) {
                btn.addEventListener('click', function() {
                    mudarTab(btn.getAttribute('data-aba'));
                });
            })(abasBtns[i]);
        }

        // Botões gerais
        var btnR = document.getElementById('btn-refresh');
        if (btnR) btnR.addEventListener('click', function() {
            if (Estado.tabAtiva === 'dashboard') carregarDashboard();
            else if (Estado.tabAtiva === 'historico') carregarHistorico();
            });
        var btnV = document.getElementById('btn-voltar');
        if (btnV) btnV.addEventListener('click', function() { window.history.back(); });

        // Histórico
        var btnB = document.getElementById('btn-buscar');
        if (btnB) btnB.addEventListener('click', carregarHistorico);
        var btnE = document.getElementById('btn-exportar');
        if (btnE) btnE.addEventListener('click', exportar);

        // Produção — pills de período
        var prodPills = document.querySelectorAll('#prod-periodo-pills .prod-pill');
        for (var pp = 0; pp < prodPills.length; pp++) {
            (function(btn) {
                btn.addEventListener('click', function() {
                    Estado.producaoPeriodo = btn.getAttribute('data-periodo');
                    for (var k = 0; k < prodPills.length; k++)
                        prodPills[k].className = 'prod-pill' + (prodPills[k] === btn ? ' ativo' : '');
                    carregarProducao();
                });
            })(prodPills[pp]);
        }
        var btnProdSync = document.getElementById('btn-prod-sync');
        if (btnProdSync) btnProdSync.addEventListener('click', sincronizarProducao);
        var btnProdExp = document.getElementById('btn-prod-exportar');
        if (btnProdExp) btnProdExp.addEventListener('click', exportarProducao);
        var btnProdBuscar = document.getElementById('prod-btn-buscar');
        if (btnProdBuscar) btnProdBuscar.addEventListener('click', carregarProdExames);

        // Modal cancelar
        var btnFC = document.getElementById('modal-cancelar-fechar');
        var btnBF = document.getElementById('modal-cancelar-btn-fechar');
        if (btnFC) btnFC.addEventListener('click', function() { document.getElementById('modal-cancelar').style.display = 'none'; });
        if (btnBF) btnBF.addEventListener('click', function() { document.getElementById('modal-cancelar').style.display = 'none'; });
        document.getElementById('modal-cancelar').addEventListener('click', function(e) {
            if (e.target === this) this.style.display = 'none';
        });

        var btnConf = document.getElementById('modal-cancelar-confirmar');
        if (btnConf) btnConf.addEventListener('click', confirmarCancelar);

        carregarDashboard();
        setInterval(function() {
            if (Estado.tabAtiva === 'dashboard') carregarDashboard();
        }, CONFIG.intervalo);

        agendarSincronizacaoAutomatica();
    }

    // Sincroniza produção automaticamente às 00h, 06h, 12h, 18h
    function agendarSincronizacaoAutomatica() {
        var HORARIOS = [0, 6, 12, 18];

        function proximoDisparo() {
            var agora = new Date();
            var hAtual = agora.getHours() * 60 + agora.getMinutes();
            var minutos = null;
            for (var i = 0; i < HORARIOS.length; i++) {
                var hAlvo = HORARIOS[i] * 60;
                if (hAlvo > hAtual) { minutos = hAlvo - hAtual; break; }
            }
            // Se passou de 18h, próximo disparo é 00h do dia seguinte
            if (minutos === null) minutos = (24 * 60) - hAtual;
            return minutos * 60 * 1000 - agora.getSeconds() * 1000 - agora.getMilliseconds();
        }

        function programar() {
            var ms = proximoDisparo();
            setTimeout(function() {
                sincronizarProducao();
                programar(); // reagenda para o próximo horário
            }, ms);
        }

        programar();
    }

    window.P47 = { abrirCancelar: abrirCancelar, selecionarItem: selecionarItem };

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', inicializar);
    else inicializar();
})();
