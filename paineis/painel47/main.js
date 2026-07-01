/* PAINEL 47 - Gestão Radiologia — ES5 */
(function() {
    'use strict';

    var CONFIG = {
        api: {
            dashboard: '/api/paineis/painel47/dashboard',
            chamados:  '/api/paineis/painel47/chamados',
            cancelar:  '/api/paineis/painel47/chamados/{id}/cancelar',
            porSetor:  '/api/paineis/painel47/por-setor',
            exportar:  '/api/paineis/painel47/exportar'
        },
        intervalo: 60000
    };

    var Estado = {
        tabAtiva: 'dashboard',
        cancelarId: null,
        cancelarNome: null,
        historicoData: [],
        itemSelecionadoId: null
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

    // ── Tabs ───────────────────────────────────────
    function mudarTab(tab) {
        Estado.tabAtiva = tab;

        var abas = document.querySelectorAll('.aba');
        for (var i = 0; i < abas.length; i++) {
            var a = abas[i];
            a.className = a.getAttribute('data-aba') === tab ? 'aba aba-ativa' : 'aba';
        }

        var ids = ['dashboard', 'historico', 'analytics'];
        for (var j = 0; j < ids.length; j++) {
            var el = document.getElementById('aba-' + ids[j]);
            if (el) el.style.display = ids[j] === tab ? '' : 'none';
        }

        if (tab === 'historico') carregarHistorico();
        if (tab === 'analytics') carregarAnalytics();
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
                + '<td>' + badgeStatus(item.status) + '</td>'
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

        // Seta + Grupo 2: Transporte
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

    // ── Analytics ──────────────────────────────────
    function carregarAnalytics() {
        var dias = document.getElementById('analytics-dias') ? document.getElementById('analytics-dias').value : '30';

        var elS = document.getElementById('analytics-setor');
        var elE = document.getElementById('analytics-status');
        if (elS) elS.innerHTML = '<div class="loading"><div class="loading-spinner"></div></div>';
        if (elE) elE.innerHTML = '<div class="loading"><div class="loading-spinner"></div></div>';

        fetch(CONFIG.api.porSetor + '?dias=' + dias, {credentials: 'same-origin'})
            .then(function(r) { return r.json(); })
            .then(function(d) {
                if (!d.success) throw new Error();
                renderizarAnalyticsSetor(d.data || d.dados || []);
            })
            .catch(function() {
                if (elS) elS.innerHTML = '<div class="tabela-vazio"><i class="fas fa-exclamation"></i><p>Erro</p></div>';
            });

        fetch(CONFIG.api.chamados + '?dias=' + dias, {credentials: 'same-origin'})
            .then(function(r) { return r.json(); })
            .then(function(d) {
                if (!d.success) throw new Error();
                renderizarAnalyticsStatus(d.data || d.dados || []);
            })
            .catch(function() {
                if (elE) elE.innerHTML = '<div class="tabela-vazio"><p>Dados disponíveis no Dashboard.</p></div>';
            });
    }

    function renderizarAnalyticsSetor(lista) {
        var el = document.getElementById('analytics-setor');
        if (!el) return;
        if (!lista.length) { el.innerHTML = '<div class="tabela-vazio"><p>Sem dados.</p></div>'; return; }

        var max = 0;
        for (var i = 0; i < lista.length; i++) if ((lista[i].total || 0) > max) max = lista[i].total;

        var html = '<div class="tabela-wrapper"><table class="tabela"><thead><tr>'
            + '<th>Setor</th><th class="num">Total</th><th class="num">Concluídos</th>'
            + '</tr></thead><tbody>';
        for (var j = 0; j < lista.length; j++) {
            var r = lista[j];
            var pct = max > 0 ? Math.round((r.total / max) * 100) : 0;
            html += '<tr><td>'
                  + '<span style="font-size:12px">' + escHtml(r.setor || '-') + '</span><br>'
                  + '<div class="barra-bg" style="margin-top:4px"><div class="barra-fill" style="width:' + pct + '%"></div></div>'
                  + '</td>'
                  + '<td class="num">' + (r.total || 0) + '</td>'
                  + '<td class="num">' + (r.concluidos || 0) + '</td></tr>';
        }
        html += '</tbody></table></div>';
        el.innerHTML = html;
    }

    function renderizarAnalyticsStatus(lista) {
        var el = document.getElementById('analytics-status');
        if (!el) return;

        // Agrupa se vier lista de registros individuais
        var contagem = {};
        if (lista.length && lista[0].status !== undefined && lista[0].total === undefined) {
            for (var i = 0; i < lista.length; i++) {
                var s = lista[i].status || 'desconhecido';
                contagem[s] = (contagem[s] || 0) + 1;
            }
            lista = [];
            for (var k in contagem) lista.push({status: k, total: contagem[k]});
        }

        if (!lista.length) { el.innerHTML = '<div class="tabela-vazio"><p>Sem dados.</p></div>'; return; }

        var totalGeral = 0;
        for (var j = 0; j < lista.length; j++) totalGeral += (lista[j].total || 0);

        var html = '<div class="tabela-wrapper"><table class="tabela"><thead><tr>'
            + '<th>Status</th><th class="num">Qtd</th><th class="num">%</th>'
            + '</tr></thead><tbody>';
        for (var m = 0; m < lista.length; m++) {
            var row = lista[m];
            var pct = totalGeral > 0 ? ((row.total / totalGeral) * 100).toFixed(1) : '0';
            html += '<tr><td>' + badgeStatus(row.status) + '</td>'
                  + '<td class="num">' + (row.total || 0) + '</td>'
                  + '<td class="num">' + pct + '%</td></tr>';
        }
        html += '</tbody></table></div>';
        el.innerHTML = html;
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
            else if (Estado.tabAtiva === 'analytics') carregarAnalytics();
        });
        var btnV = document.getElementById('btn-voltar');
        if (btnV) btnV.addEventListener('click', function() { window.history.back(); });

        // Histórico
        var btnB = document.getElementById('btn-buscar');
        if (btnB) btnB.addEventListener('click', carregarHistorico);
        var btnE = document.getElementById('btn-exportar');
        if (btnE) btnE.addEventListener('click', exportar);

        // Analytics
        var btnAn = document.getElementById('btn-analytics-buscar');
        if (btnAn) btnAn.addEventListener('click', carregarAnalytics);

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
    }

    window.P47 = { abrirCancelar: abrirCancelar, selecionarItem: selecionarItem };

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', inicializar);
    else inicializar();
})();
