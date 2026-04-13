(function() {
    'use strict';

    var CONFIG = {
        api: {
            dashboard: '/api/paineis/painel27/dashboard',
            dados: '/api/paineis/painel27/dados',
            filtros: '/api/paineis/painel27/filtros',
            historicoSinais: '/api/paineis/painel27/historico-sinais/',
            historicoExames: '/api/paineis/painel27/historico-exames/'
        },
        intervaloRefresh: 120000,
        timeoutRequisicao: 30000,
        debounceMs: 400,
        storagePrefix: 'painel27_'
    };

    var Estado = {
        pacientes: [],
        carregando: false,
        errosConsecutivos: 0,
        filtrosRecolhidos: false,
        chartSinais: null,
        chartExames: null,
        pacienteHistorico: null,
        intervalos: { refresh: null },
        timeouts: { debounce: null }
    };

    var DOM = {};

    function capturarDOM() {
        DOM.painelMain = document.getElementById('painel-main');
        DOM.statusIndicator = document.getElementById('status-indicator');
        DOM.ultimaAtualizacao = document.getElementById('ultima-atualizacao');
        DOM.totalPacientes = document.getElementById('total-pacientes');
        DOM.kpiInternados = document.getElementById('kpi-internados');
        DOM.kpiAltas = document.getElementById('kpi-altas');
        DOM.kpiMediaDias = document.getElementById('kpi-media-dias');
        DOM.kpiSinais = document.getElementById('kpi-sinais');
        DOM.kpiExames = document.getElementById('kpi-exames');
        DOM.kpiSetores = document.getElementById('kpi-setores');
        DOM.filtroSetor = document.getElementById('filtro-setor');
        DOM.filtroStatus = document.getElementById('filtro-status');
        DOM.filtroBusca = document.getElementById('filtro-busca');
        DOM.btnLimpar = document.getElementById('btn-limpar');
        DOM.btnRefresh = document.getElementById('btn-refresh');
        DOM.btnVoltar = document.getElementById('btn-voltar');
        DOM.btnToggleFiltros = document.getElementById('btn-toggle-filtros');
        DOM.headerControls = document.getElementById('header-controls');
        DOM.modalHistorico = document.getElementById('modal-historico');
        DOM.modalHistTitulo = document.getElementById('modal-hist-titulo');
        DOM.modalHistFechar = document.getElementById('modal-hist-fechar');
        DOM.chartTabs = document.getElementById('chart-tabs');
        DOM.chartAreaSinais = document.getElementById('chart-area-sinais');
        DOM.chartAreaExames = document.getElementById('chart-area-exames');
        DOM.exameSelector = document.getElementById('exame-selector');
    }

    // Utilitarios
    function esc(t) { if (!t) return '-'; var d = document.createElement('div'); d.textContent = t; return d.innerHTML; }
    function salvar(k, v) { try { localStorage.setItem(CONFIG.storagePrefix + k, v); } catch(e) {} }
    function recuperar(k) { try { return localStorage.getItem(CONFIG.storagePrefix + k); } catch(e) { return null; } }

    function atualizarStatus(s) {
        if (!DOM.statusIndicator) return;
        DOM.statusIndicator.className = 'status-indicator';
        if (s === 'online') DOM.statusIndicator.classList.add('status-online');
        else if (s === 'offline') DOM.statusIndicator.classList.add('status-offline');
        else if (s === 'loading') DOM.statusIndicator.classList.add('status-loading');
    }

    function atualizarHorario() {
        if (DOM.ultimaAtualizacao) DOM.ultimaAtualizacao.textContent = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    }

    function fetchJSON(url) {
        var ctrl = new AbortController();
        var timer = setTimeout(function() { ctrl.abort(); }, CONFIG.timeoutRequisicao);
        return fetch(url, { signal: ctrl.signal, credentials: 'include' })
            .then(function(r) { clearTimeout(timer); return r.json(); })
            .catch(function(e) { clearTimeout(timer); throw e; });
    }

    function construirParams() {
        var p = [];
        var setor = DOM.filtroSetor ? DOM.filtroSetor.value : '';
        var status = DOM.filtroStatus ? DOM.filtroStatus.value : '';
        var busca = DOM.filtroBusca ? DOM.filtroBusca.value : '';
        if (setor) p.push('setor=' + encodeURIComponent(setor));
        if (status) p.push('status=' + encodeURIComponent(status));
        if (busca) p.push('busca=' + encodeURIComponent(busca));
        return p.length > 0 ? '?' + p.join('&') : '';
    }

    // Classificacao de sinais vitais
    function classeSinal(tipo, valor) {
        if (valor === null || valor === undefined) return '';
        var v = parseFloat(valor);
        if (isNaN(v)) return '';
        if (tipo === 'pa_s') { if (v >= 180 || v <= 80) return 'critico'; if (v >= 140 || v <= 90) return 'alerta'; return 'bom'; }
        if (tipo === 'pa_d') { if (v >= 110 || v <= 50) return 'critico'; if (v >= 90 || v <= 60) return 'alerta'; return 'bom'; }
        if (tipo === 'fc') { if (v >= 130 || v <= 40) return 'critico'; if (v >= 110 || v <= 50) return 'alerta'; return 'bom'; }
        if (tipo === 'fr') { if (v >= 30 || v <= 8) return 'critico'; if (v >= 24 || v <= 10) return 'alerta'; return 'bom'; }
        if (tipo === 'temp') { if (v >= 39.5 || v <= 35) return 'critico'; if (v >= 38 || v <= 35.5) return 'alerta'; return 'bom'; }
        if (tipo === 'sat') { if (v <= 88) return 'critico'; if (v <= 92) return 'alerta'; return 'bom'; }
        if (tipo === 'glic') { if (v >= 300 || v <= 50) return 'critico'; if (v >= 180 || v <= 70) return 'alerta'; return 'bom'; }
        if (tipo === 'dor') { if (v >= 7) return 'critico'; if (v >= 4) return 'alerta'; return 'bom'; }
        return '';
    }

    // Carregar dados
    function carregarDados() {
        if (Estado.carregando) return;
        Estado.carregando = true;
        atualizarStatus('loading');
        var qs = construirParams();

        Promise.all([
            fetchJSON(CONFIG.api.dados + qs),
            fetchJSON(CONFIG.api.dashboard + qs)
        ]).then(function(r) {
            var dadosResp = r[0];
            var dashResp = r[1];
            if (!dadosResp.success) return;
            Estado.pacientes = dadosResp.data || [];
            atualizarKPIs(dashResp.success ? dashResp.data : null);
            renderizarPacientes();
            if (DOM.totalPacientes) DOM.totalPacientes.textContent = Estado.pacientes.length;
            atualizarHorario();
            atualizarStatus('online');
            Estado.errosConsecutivos = 0;
        }).catch(function(err) {
            console.error('[P27] Erro:', err);
            Estado.errosConsecutivos++;
            atualizarStatus('offline');
            if (Estado.errosConsecutivos >= 3) DOM.painelMain.innerHTML = '<div class="sem-resultados"><i class="fas fa-exclamation-triangle"></i>Falha na conexao</div>';
        }).then(function() { Estado.carregando = false; });
    }

    function atualizarKPIs(d) {
        if (!d) return;
        var cards = document.querySelectorAll('.resumo-card');
        for (var i = 0; i < cards.length; i++) { cards[i].classList.add('atualizando'); (function(c) { setTimeout(function() { c.classList.remove('atualizando'); }, 300); })(cards[i]); }
        if (DOM.kpiInternados) DOM.kpiInternados.textContent = d.internados || 0;
        if (DOM.kpiAltas) DOM.kpiAltas.textContent = d.altas || 0;
        if (DOM.kpiMediaDias) DOM.kpiMediaDias.textContent = d.media_dias_internacao || 0;
        if (DOM.kpiSinais) DOM.kpiSinais.textContent = d.com_sinais_vitais || 0;
        if (DOM.kpiExames) DOM.kpiExames.textContent = d.pacientes_com_exame || 0;
        if (DOM.kpiSetores) DOM.kpiSetores.textContent = d.total_setores || 0;
    }

    // Renderizar pacientes
    function renderizarPacientes() {
        if (!Estado.pacientes || Estado.pacientes.length === 0) {
            DOM.painelMain.innerHTML = '<div class="sem-resultados"><i class="fas fa-search"></i>Nenhum paciente encontrado</div>';
            return;
        }
        var html = '<div class="pacientes-lista">';
        for (var i = 0; i < Estado.pacientes.length; i++) {
            html += criarCardHTML(Estado.pacientes[i], i);
        }
        html += '</div>';
        DOM.painelMain.innerHTML = html;

        // Bind expansao
        var headers = DOM.painelMain.querySelectorAll('.pac-header');
        for (var h = 0; h < headers.length; h++) {
            headers[h].addEventListener('click', function(e) {
                if (e.target.closest('.btn-historico') || e.target.closest('.pac-acoes')) return;
                this.closest('.pac-card').classList.toggle('expandido');
            });
        }
    }

    function criarCardHTML(pac, idx) {
        var isAlta = pac.status_paciente === 'ALTA';
        var classeAlta = isAlta ? ' pac-alta' : '';
        var sexo = (pac.ie_sexo || 'M').toUpperCase();
        var iniciais = (pac.nm_paciente || '??').substring(0, 2).toUpperCase();

        // Detalhes
        var det = '';
        det += '<span><i class="fas fa-hashtag det-icon"></i>' + esc(pac.nr_atendimento) + '</span>';
        det += '<span><i class="fas fa-user det-icon"></i>' + esc(pac.idade) + ' ' + esc(sexo) + '</span>';
        if (pac.nm_setor) det += '<span><i class="fas fa-hospital det-icon"></i>' + esc(pac.nm_setor) + '</span>';
        if (pac.cd_leito) det += '<span><i class="fas fa-bed det-icon"></i>' + esc(pac.cd_leito) + '</span>';
        if (pac.nm_medico_resp) det += '<span><i class="fas fa-user-md det-icon"></i>' + esc(pac.nm_medico_resp) + '</span>';
        if (pac.cd_cid_principal) det += '<span><i class="fas fa-notes-medical det-icon"></i>CID: ' + esc(pac.cd_cid_principal) + '</span>';
        if (pac.dias_internacao !== null) det += '<span><i class="fas fa-calendar det-icon"></i>' + pac.dias_internacao + 'd</span>';

        // Badge status
        var badge = isAlta
            ? '<span class="badge-status-pac badge-alta">ALTA</span>'
            : '<span class="badge-status-pac badge-internado">INT</span>';

        // Sinais vitais pills
        var sinais = '';
        if (pac.pa_sistolica) sinais += '<span class="sinal-pill ' + classeSinal('pa_s', pac.pa_sistolica) + '"><i class="fas fa-heart"></i> ' + pac.pa_sistolica + '/' + (pac.pa_diastolica || '-') + '</span>';
        if (pac.freq_cardiaca) sinais += '<span class="sinal-pill ' + classeSinal('fc', pac.freq_cardiaca) + '"><i class="fas fa-heartbeat"></i> ' + pac.freq_cardiaca + '</span>';
        if (pac.freq_resp) sinais += '<span class="sinal-pill ' + classeSinal('fr', pac.freq_resp) + '"><i class="fas fa-lungs"></i> ' + pac.freq_resp + '</span>';
        if (pac.temperatura) sinais += '<span class="sinal-pill ' + classeSinal('temp', pac.temperatura) + '"><i class="fas fa-thermometer-half"></i> ' + pac.temperatura + '</span>';
        if (pac.saturacao_o2) sinais += '<span class="sinal-pill ' + classeSinal('sat', pac.saturacao_o2) + '"><i class="fas fa-wind"></i> ' + pac.saturacao_o2 + '%</span>';
        if (pac.glicemia_capilar) sinais += '<span class="sinal-pill ' + classeSinal('glic', pac.glicemia_capilar) + '"><i class="fas fa-tint"></i> ' + pac.glicemia_capilar + '</span>';
        if (pac.escala_dor !== null && pac.escala_dor !== undefined) sinais += '<span class="sinal-pill ' + classeSinal('dor', pac.escala_dor) + '"><i class="fas fa-bolt"></i> Dor ' + pac.escala_dor + '</span>';

        // Exames grid
        var examesHTML = '';
        var exames = pac.exames || [];
        var examesAgrupados = {};
        for (var e = 0; e < exames.length; e++) {
            var ex = exames[e];
            if (ex.rn_recencia === 1) {
                examesAgrupados[ex.cd_exame] = ex;
            }
        }

        var ordemExames = [279, 536, 2001, 1738, 1436, 1438, 1528, 1529, 1531, 1465, 1532, 3631, 3634];
        for (var o = 0; o < ordemExames.length; o++) {
            var cd = ordemExames[o];
            var exm = examesAgrupados[cd];
            if (exm) {
                examesHTML += '<div class="exame-item">';
                examesHTML += '<div class="exame-nome">' + esc(exm.nm_exame) + '</div>';
                examesHTML += '<div class="exame-valor">' + esc(exm.resultado_texto) + '</div>';
                if (exm.dt_coleta) examesHTML += '<div class="exame-data"><i class="fas fa-clock"></i> ' + esc(exm.dt_coleta) + '</div>';
                examesHTML += '</div>';
            }
        }

        if (!examesHTML) examesHTML = '<div class="exame-item sem-resultado"><div class="exame-nome">Sem exames</div><div class="exame-valor">-</div></div>';

        return '<div class="pac-card' + classeAlta + '" data-atend="' + pac.nr_atendimento + '" style="animation-delay:' + (idx * 0.02) + 's">' +
            '<div class="pac-header">' +
                '<div class="pac-avatar ' + sexo.toLowerCase() + '">' + iniciais + '</div>' +
                '<div class="pac-info">' +
                    '<div class="pac-nome">' + badge + ' ' + esc(pac.nm_paciente) + '</div>' +
                    '<div class="pac-detalhes">' + det + '</div>' +
                '</div>' +
                '<div class="pac-sinais">' + sinais + '</div>' +
                '<div class="pac-acoes">' +
                    '<button class="btn-historico" onclick="window.P27.historico(' + pac.nr_atendimento + ')" title="Ver evolucao"><i class="fas fa-chart-line"></i></button>' +
                '</div>' +
                '<span class="expand-arrow"><i class="fas fa-chevron-down"></i></span>' +
            '</div>' +
            '<div class="pac-exames"><div class="exames-grid">' + examesHTML + '</div></div>' +
        '</div>';
    }

    // Modal historico
    function abrirHistorico(nrAtendimento) {
        Estado.pacienteHistorico = nrAtendimento;
        var pac = null;
        for (var i = 0; i < Estado.pacientes.length; i++) {
            if (Estado.pacientes[i].nr_atendimento === nrAtendimento) { pac = Estado.pacientes[i]; break; }
        }

        DOM.modalHistTitulo.innerHTML = '<i class="fas fa-chart-line"></i> ' + esc(pac ? pac.nm_paciente : 'Atend. ' + nrAtendimento);

        // Reset tabs
        var tabs = DOM.chartTabs.querySelectorAll('.chart-tab');
        for (var t = 0; t < tabs.length; t++) tabs[t].classList.remove('ativo');
        tabs[0].classList.add('ativo');
        DOM.chartAreaSinais.classList.remove('oculto');
        DOM.chartAreaExames.classList.add('oculto');

        DOM.modalHistorico.classList.add('ativo');
        carregarHistoricoSinais(nrAtendimento);
    }

    function fecharHistorico() {
        DOM.modalHistorico.classList.remove('ativo');
        if (Estado.chartSinais) { Estado.chartSinais.destroy(); Estado.chartSinais = null; }
        if (Estado.chartExames) { Estado.chartExames.destroy(); Estado.chartExames = null; }
    }

    function carregarHistoricoSinais(nrAtendimento) {
        fetchJSON(CONFIG.api.historicoSinais + nrAtendimento + '?dias=7')
            .then(function(resp) {
                if (!resp.success || !resp.data.length) return;
                desenharGraficoSinais(resp.data);
            })
            .catch(function(err) { console.error('[P27] Erro historico sinais:', err); });
    }

    function desenharGraficoSinais(dados) {
        if (Estado.chartSinais) Estado.chartSinais.destroy();

        var labels = [];
        var paSis = [], paDia = [], fc = [], fr = [], temp = [], sat = [];

        for (var i = 0; i < dados.length; i++) {
            var d = dados[i];
            labels.push(d.dt_registro_fmt || '');
            paSis.push(d.pa_sistolica);
            paDia.push(d.pa_diastolica);
            fc.push(d.freq_cardiaca);
            fr.push(d.freq_resp);
            temp.push(d.temperatura);
            sat.push(d.saturacao_o2);
        }

        var ctx = document.getElementById('chart-sinais').getContext('2d');
        Estado.chartSinais = new Chart(ctx, {
            type: 'line',
            data: {
                labels: labels,
                datasets: [
                    { label: 'PA Sis', data: paSis, borderColor: '#dc3545', backgroundColor: 'rgba(220,53,69,0.1)', tension: 0.3, pointRadius: 2, borderWidth: 2 },
                    { label: 'PA Dia', data: paDia, borderColor: '#fd7e14', backgroundColor: 'rgba(253,126,20,0.1)', tension: 0.3, pointRadius: 2, borderWidth: 2 },
                    { label: 'FC', data: fc, borderColor: '#6f42c1', backgroundColor: 'rgba(111,66,193,0.1)', tension: 0.3, pointRadius: 2, borderWidth: 2 },
                    { label: 'FR', data: fr, borderColor: '#20c997', backgroundColor: 'rgba(32,201,151,0.1)', tension: 0.3, pointRadius: 2, borderWidth: 1, hidden: true },
                    { label: 'Temp', data: temp, borderColor: '#ffc107', backgroundColor: 'rgba(255,193,7,0.1)', tension: 0.3, pointRadius: 2, borderWidth: 1, hidden: true },
                    { label: 'SpO2', data: sat, borderColor: '#17a2b8', backgroundColor: 'rgba(23,162,184,0.1)', tension: 0.3, pointRadius: 2, borderWidth: 2 }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                interaction: { intersect: false, mode: 'index' },
                plugins: {
                    legend: { position: 'top', labels: { usePointStyle: true, pointStyle: 'circle', padding: 12, font: { size: 11 } } },
                    tooltip: { backgroundColor: '#333', titleFont: { size: 11 }, bodyFont: { size: 11 } }
                },
                scales: {
                    x: { display: true, grid: { display: false }, ticks: { font: { size: 10 }, maxRotation: 45 } },
                    y: { display: true, grid: { color: 'rgba(0,0,0,0.05)' }, ticks: { font: { size: 10 } } }
                }
            }
        });
    }

    function carregarHistoricoExames(nrAtendimento) {
        fetchJSON(CONFIG.api.historicoExames + nrAtendimento)
            .then(function(resp) {
                if (!resp.success || !resp.data.length) {
                    DOM.exameSelector.innerHTML = '<span style="font-size:0.75rem;color:#999;">Sem historico de exames</span>';
                    return;
                }

                // Agrupa por exame
                var exameMap = {};
                for (var i = 0; i < resp.data.length; i++) {
                    var d = resp.data[i];
                    var key = d.cd_exame;
                    if (!exameMap[key]) exameMap[key] = { nm: d.nm_exame, cd: d.cd_exame, pontos: [] };
                    exameMap[key].pontos.push(d);
                }

                // Botoes seletores
                var html = '';
                var primeiro = null;
                for (var cd in exameMap) {
                    if (!primeiro) primeiro = cd;
                    html += '<button class="btn-exame-sel' + (cd == primeiro ? ' ativo' : '') + '" data-cd="' + cd + '">' + esc(exameMap[cd].nm) + '</button>';
                }
                DOM.exameSelector.innerHTML = html;

                // Bind
                var btns = DOM.exameSelector.querySelectorAll('.btn-exame-sel');
                for (var b = 0; b < btns.length; b++) {
                    btns[b].addEventListener('click', function() {
                        var sels = DOM.exameSelector.querySelectorAll('.btn-exame-sel');
                        for (var s = 0; s < sels.length; s++) sels[s].classList.remove('ativo');
                        this.classList.add('ativo');
                        desenharGraficoExame(exameMap[this.getAttribute('data-cd')]);
                    });
                }

                if (primeiro) desenharGraficoExame(exameMap[primeiro]);
            })
            .catch(function(err) { console.error('[P27] Erro historico exames:', err); });
    }

    function desenharGraficoExame(exameData) {
        if (Estado.chartExames) Estado.chartExames.destroy();

        var labels = [];
        var valores = [];
        for (var i = 0; i < exameData.pontos.length; i++) {
            var p = exameData.pontos[i];
            labels.push(p.dt_registro_fmt || p.dt_resultado || '');
            valores.push(p.resultado_numerico);
        }

        var ctx = document.getElementById('chart-exames').getContext('2d');
        Estado.chartExames = new Chart(ctx, {
            type: 'line',
            data: {
                labels: labels,
                datasets: [{
                    label: exameData.nm,
                    data: valores,
                    borderColor: '#17a2b8',
                    backgroundColor: 'rgba(23,162,184,0.15)',
                    fill: true,
                    tension: 0.3,
                    pointRadius: 4,
                    pointBackgroundColor: '#17a2b8',
                    borderWidth: 2
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { display: false },
                    tooltip: { backgroundColor: '#333' }
                },
                scales: {
                    x: { grid: { display: false }, ticks: { font: { size: 10 }, maxRotation: 45 } },
                    y: { grid: { color: 'rgba(0,0,0,0.05)' }, ticks: { font: { size: 10 } } }
                }
            }
        });
    }

    // Filtros
    function carregarFiltros() {
        fetchJSON(CONFIG.api.filtros).then(function(resp) {
            if (!resp.success) return;
            var html = '<option value="">Todos Setores</option>';
            for (var i = 0; i < (resp.setores || []).length; i++) {
                var s = resp.setores[i];
                html += '<option value="' + s.cd_setor_atendimento + '">' + esc(s.nm_setor) + '</option>';
            }
            if (DOM.filtroSetor) DOM.filtroSetor.innerHTML = html;
        });
    }

    var filtrosVisiveis = false;

    function toggleFiltros() {
        filtrosVisiveis = !filtrosVisiveis;
        var bar = document.getElementById('filtros-bar');
        if (bar) bar.style.display = filtrosVisiveis ? 'block' : 'none';
    }

    // Eventos
    function registrarEventos() {
        if (DOM.filtroSetor) DOM.filtroSetor.addEventListener('change', function() { salvar('setor', this.value); carregarDados(); });
        if (DOM.filtroStatus) DOM.filtroStatus.addEventListener('change', function() { salvar('status', this.value); carregarDados(); });
        if (DOM.filtroBusca) DOM.filtroBusca.addEventListener('input', function() {
            var v = this.value;
            if (Estado.timeouts.debounce) clearTimeout(Estado.timeouts.debounce);
            Estado.timeouts.debounce = setTimeout(function() { salvar('busca', v); carregarDados(); }, CONFIG.debounceMs);
        });
        if (DOM.btnToggleFiltros) DOM.btnToggleFiltros.addEventListener('click', toggleFiltros);
        if (DOM.btnLimpar) DOM.btnLimpar.addEventListener('click', function() {
            if (DOM.filtroSetor) DOM.filtroSetor.value = '';
            if (DOM.filtroStatus) DOM.filtroStatus.value = '';
            if (DOM.filtroBusca) DOM.filtroBusca.value = '';
            salvar('setor', ''); salvar('status', ''); salvar('busca', '');
            carregarDados();
        });
        if (DOM.btnVoltar) DOM.btnVoltar.addEventListener('click', function() { window.location.href = '/frontend/dashboard.html'; });
        if (DOM.btnRefresh) DOM.btnRefresh.addEventListener('click', function() {
            DOM.btnRefresh.classList.add('girando');
            carregarDados();
            setTimeout(function() { DOM.btnRefresh.classList.remove('girando'); }, 500);
        });

        // Modal historico
        if (DOM.modalHistFechar) DOM.modalHistFechar.addEventListener('click', fecharHistorico);
        if (DOM.modalHistorico) DOM.modalHistorico.addEventListener('click', function(e) { if (e.target === DOM.modalHistorico) fecharHistorico(); });

        // Tabs
        if (DOM.chartTabs) DOM.chartTabs.addEventListener('click', function(e) {
            var tab = e.target.closest('.chart-tab');
            if (!tab) return;
            var tabs = DOM.chartTabs.querySelectorAll('.chart-tab');
            for (var t = 0; t < tabs.length; t++) tabs[t].classList.remove('ativo');
            tab.classList.add('ativo');
            var tipo = tab.getAttribute('data-tab');
            if (tipo === 'sinais') {
                DOM.chartAreaSinais.classList.remove('oculto');
                DOM.chartAreaExames.classList.add('oculto');
            } else {
                DOM.chartAreaSinais.classList.add('oculto');
                DOM.chartAreaExames.classList.remove('oculto');
                if (Estado.pacienteHistorico) carregarHistoricoExames(Estado.pacienteHistorico);
            }
        });

        document.addEventListener('keydown', function(e) {
            if (e.key === 'Escape') fecharHistorico();
            if (e.key === 'F5') { e.preventDefault(); carregarDados(); }
        });
        document.addEventListener('visibilitychange', function() { if (!document.hidden) carregarDados(); });
    }

    // Exposicao global
    window.P27 = { historico: abrirHistorico };

    // Inicializacao
    function inicializar() {
        console.log('[P27] Inicializando...');
        capturarDOM();

        // Restaurar filtros
        var setorSalvo = recuperar('setor');
        if (setorSalvo && DOM.filtroSetor) DOM.filtroSetor.value = setorSalvo;
        var statusSalvo = recuperar('status');
        if (statusSalvo && DOM.filtroStatus) DOM.filtroStatus.value = statusSalvo;
        var buscaSalva = recuperar('busca');
        if (buscaSalva && DOM.filtroBusca) DOM.filtroBusca.value = buscaSalva;
        Estado.filtrosRecolhidos = false;

        registrarEventos();
        carregarFiltros();
        carregarDados();

        Estado.intervalos.refresh = setInterval(function() { carregarFiltros(); carregarDados(); }, CONFIG.intervaloRefresh);
        console.log('[P27] Inicializado');
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', inicializar);
    else inicializar();
})();