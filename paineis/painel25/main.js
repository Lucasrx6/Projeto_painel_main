/**
 * PAINEL 25 - Exames do PS (Visao Medica)
 * Sistema de Paineis Hospitalares - Hospital Anchieta
 *
 * Padrao identico ao P21: multi-select generico, toggle filtros,
 * localStorage, fetchComRetry, status indicator, debounce.
 */

(function() {
    'use strict';

    // =========================================================
    // CONFIGURACAO
    // =========================================================

    var CONFIG = {
        api: {
            dashboard: '/api/paineis/painel25/dashboard',
            dados:     '/api/paineis/painel25/dados',
            filtros:   '/api/paineis/painel25/filtros'
        },
        intervaloRefresh: 120000,
        maxTentativasConexao: 3,
        timeoutRequisicao: 30000,
        debounceMs: 400,
        storagePrefix: 'painel25_'
    };

    // =========================================================
    // ESTADO
    // =========================================================

    var Estado = {
        pacientes: [],
        carregando: false,
        errosConsecutivos: 0,
        intervalos: { refresh: null },
        timeouts: { debounce: null },
        filtros: {
            tipo_exame: '',
            busca: ''
        },
        multiMedico: [],
        multiClinica: [],
        multiStatusExame: [],
        filtrosRecolhidos: false,
        dropdownAberto: null
    };

    // =========================================================
    // CACHE DOM
    // =========================================================

    var DOM = {};

    function cachearElementos() {
        DOM.painelMain = document.getElementById('painel-main');
        DOM.statusIndicator = document.getElementById('status-indicator');
        DOM.ultimaAtualizacao = document.getElementById('ultima-atualizacao');
        DOM.totalFiltrados = document.getElementById('total-filtrados');

        DOM.kpiPacientes = document.getElementById('kpi-pacientes');
        DOM.kpiTotal = document.getElementById('kpi-total');
        DOM.kpiProntos = document.getElementById('kpi-prontos');
        DOM.kpiAndamento = document.getElementById('kpi-andamento');
        DOM.kpiPendentes = document.getElementById('kpi-pendentes');
        DOM.kpiRadio = document.getElementById('kpi-radio');
        DOM.kpiLab = document.getElementById('kpi-lab');

        DOM.filtroTipoExame = document.getElementById('filtro-tipo-exame');
        DOM.filtroBusca = document.getElementById('filtro-busca');

        DOM.btnLimpar = document.getElementById('btn-limpar');
        DOM.btnVoltar = document.getElementById('btn-voltar');
        DOM.btnRefresh = document.getElementById('btn-refresh');
        DOM.btnToggleFiltros = document.getElementById('btn-toggle-filtros');
        DOM.headerControls = document.getElementById('header-controls');
    }

    // =========================================================
    // UTILITARIOS
    // =========================================================

    function escapeHtml(t) {
        if (!t) return '-';
        var d = document.createElement('div');
        d.textContent = t;
        return d.innerHTML;
    }

    function atualizarStatus(s) {
        if (!DOM.statusIndicator) return;
        DOM.statusIndicator.className = 'status-indicator';
        if (s === 'online') { DOM.statusIndicator.classList.add('status-online'); DOM.statusIndicator.title = 'Conectado'; }
        else if (s === 'offline') { DOM.statusIndicator.classList.add('status-offline'); DOM.statusIndicator.title = 'Sem conexao'; }
        else if (s === 'loading') { DOM.statusIndicator.classList.add('status-loading'); DOM.statusIndicator.title = 'Carregando...'; }
    }

    function atualizarHorario() {
        if (!DOM.ultimaAtualizacao) return;
        DOM.ultimaAtualizacao.textContent = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    }

    function salvar(key, valor) { try { localStorage.setItem(CONFIG.storagePrefix + key, typeof valor === 'object' ? JSON.stringify(valor) : valor); } catch(e) {} }
    function recuperar(key) { try { return localStorage.getItem(CONFIG.storagePrefix + key); } catch(e) { return null; } }
    function recuperarArray(key) { try { var r = localStorage.getItem(CONFIG.storagePrefix + key); if (r) return JSON.parse(r); } catch(e) {} return []; }

    // =========================================================
    // FETCH COM RETRY
    // =========================================================

    function fetchComRetry(url, tentativas) {
        tentativas = tentativas || CONFIG.maxTentativasConexao;
        return new Promise(function(resolve, reject) {
            function tentar(n) {
                var ctrl = new AbortController();
                var timer = setTimeout(function() { ctrl.abort(); }, CONFIG.timeoutRequisicao);
                fetch(url, { signal: ctrl.signal, credentials: 'include' })
                    .then(function(r) { clearTimeout(timer); if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
                    .then(resolve)
                    .catch(function(e) { clearTimeout(timer); if (n > 1) setTimeout(function() { tentar(n - 1); }, 1000); else reject(e); });
            }
            tentar(tentativas);
        });
    }

    // =========================================================
    // MULTI-SELECT GENERICO (identico ao P21)
    // =========================================================

    function configurarToggleMultiSelects() {
        var triggers = document.querySelectorAll('.ms-trigger');
        for (var i = 0; i < triggers.length; i++) {
            (function(btn) {
                btn.addEventListener('click', function(e) {
                    e.stopPropagation();
                    var container = btn.closest('.multi-select-container');
                    var dd = container.querySelector('.multi-select-dropdown');
                    var isAberto = dd.classList.contains('aberto');
                    fecharTodosDropdowns();
                    if (!isAberto) {
                        dd.classList.add('aberto');
                        btn.setAttribute('aria-expanded', 'true');
                        btn.classList.add('aberto');
                        Estado.dropdownAberto = container.id;
                    }
                });
            })(triggers[i]);
        }
        document.addEventListener('click', function(e) {
            if (Estado.dropdownAberto) {
                var container = document.getElementById(Estado.dropdownAberto);
                if (container && !container.contains(e.target)) fecharTodosDropdowns();
            }
        });
    }

    function fecharTodosDropdowns() {
        var dds = document.querySelectorAll('.multi-select-dropdown.aberto');
        for (var i = 0; i < dds.length; i++) dds[i].classList.remove('aberto');
        var trs = document.querySelectorAll('.ms-trigger.aberto');
        for (var j = 0; j < trs.length; j++) { trs[j].classList.remove('aberto'); trs[j].setAttribute('aria-expanded', 'false'); }
        Estado.dropdownAberto = null;
    }

    function vincularCheckboxesMultiSelect(containerId) {
        var container = document.getElementById(containerId);
        if (!container) return;
        var stateKey = container.getAttribute('data-state-key');

        var checkboxes = container.querySelectorAll('.multi-select-checkbox');
        for (var i = 0; i < checkboxes.length; i++) {
            var oldCb = checkboxes[i];
            var newCb = oldCb.cloneNode(true);
            oldCb.parentNode.replaceChild(newCb, oldCb);
            newCb.addEventListener('change', function() {
                syncEstado(containerId);
                atualizarLabel(containerId);
                salvar(stateKey, Estado[stateKey]);
                carregarDados();
            });
        }

        var btnAll = container.querySelector('.btn-ms-all');
        var btnNone = container.querySelector('.btn-ms-none');
        if (btnAll) { var na = btnAll.cloneNode(true); btnAll.parentNode.replaceChild(na, btnAll); na.addEventListener('click', function(e) { e.stopPropagation(); var cbs = container.querySelectorAll('.multi-select-checkbox'); for (var j = 0; j < cbs.length; j++) cbs[j].checked = true; syncEstado(containerId); atualizarLabel(containerId); salvar(stateKey, Estado[stateKey]); carregarDados(); }); }
        if (btnNone) { var nn = btnNone.cloneNode(true); btnNone.parentNode.replaceChild(nn, btnNone); nn.addEventListener('click', function(e) { e.stopPropagation(); var cbs = container.querySelectorAll('.multi-select-checkbox'); for (var j = 0; j < cbs.length; j++) cbs[j].checked = false; syncEstado(containerId); atualizarLabel(containerId); salvar(stateKey, Estado[stateKey]); carregarDados(); }); }

        restaurarEstado(containerId);
        atualizarLabel(containerId);
    }

    function syncEstado(containerId) {
        var container = document.getElementById(containerId);
        if (!container) return;
        var stateKey = container.getAttribute('data-state-key');
        var cbs = container.querySelectorAll('.multi-select-checkbox');
        var sel = [];
        for (var i = 0; i < cbs.length; i++) {
            var lbl = cbs[i].closest('.multi-select-item');
            if (cbs[i].checked) { sel.push(cbs[i].value); if (lbl) lbl.classList.add('selecionado'); }
            else { if (lbl) lbl.classList.remove('selecionado'); }
        }
        Estado[stateKey] = sel;
    }

    function restaurarEstado(containerId) {
        var container = document.getElementById(containerId);
        if (!container) return;
        var stateKey = container.getAttribute('data-state-key');
        var salvos = recuperarArray(stateKey);
        if (!salvos || salvos.length === 0) return;
        Estado[stateKey] = salvos;
        var cbs = container.querySelectorAll('.multi-select-checkbox');
        for (var i = 0; i < cbs.length; i++) {
            if (salvos.indexOf(cbs[i].value) !== -1) { cbs[i].checked = true; var lbl = cbs[i].closest('.multi-select-item'); if (lbl) lbl.classList.add('selecionado'); }
        }
    }

    function atualizarLabel(containerId) {
        var container = document.getElementById(containerId);
        if (!container) return;
        var stateKey = container.getAttribute('data-state-key');
        var placeholder = container.getAttribute('data-placeholder');
        var labelEl = container.querySelector('.multi-select-label');
        if (!labelEl) return;
        var qtd = Estado[stateKey].length;
        var total = container.querySelectorAll('.multi-select-checkbox').length;
        if (qtd === 0 || qtd === total) { labelEl.textContent = placeholder; }
        else if (qtd === 1) { var cb = container.querySelector('.multi-select-checkbox:checked'); var it = cb ? cb.closest('.multi-select-item').querySelector('.multi-select-item-text') : null; labelEl.textContent = it ? it.textContent : Estado[stateKey][0]; }
        else { labelEl.textContent = qtd + ' selecionados'; }
    }

    function popularMultiSelectDinamico(containerId, valores) {
        var container = document.getElementById(containerId);
        if (!container) return;
        var optionsDiv = container.querySelector('.multi-select-options');
        if (!optionsDiv) return;
        optionsDiv.innerHTML = '';
        for (var i = 0; i < valores.length; i++) {
            var label = document.createElement('label'); label.className = 'multi-select-item';
            var cb = document.createElement('input'); cb.type = 'checkbox'; cb.className = 'multi-select-checkbox'; cb.value = valores[i];
            var span = document.createElement('span'); span.className = 'multi-select-item-text'; span.textContent = valores[i];
            label.appendChild(cb); label.appendChild(span); optionsDiv.appendChild(label);
        }
        vincularCheckboxesMultiSelect(containerId);
    }

    function resetarTodosMultiSelects() {
        var containers = document.querySelectorAll('.multi-select-container');
        for (var i = 0; i < containers.length; i++) {
            var stateKey = containers[i].getAttribute('data-state-key');
            var placeholder = containers[i].getAttribute('data-placeholder');
            Estado[stateKey] = []; salvar(stateKey, []);
            var cbs = containers[i].querySelectorAll('.multi-select-checkbox');
            for (var j = 0; j < cbs.length; j++) { cbs[j].checked = false; var lbl = cbs[j].closest('.multi-select-item'); if (lbl) lbl.classList.remove('selecionado'); }
            var labelEl = containers[i].querySelector('.multi-select-label');
            if (labelEl) labelEl.textContent = placeholder;
        }
    }

    // =========================================================
    // CONSTRUIR PARAMS (compartilhado dashboard + dados)
    // =========================================================

    function construirParams() {
        var params = [];

        // Filtros simples
        if (Estado.filtros.tipo_exame) params.push('tipo_exame=' + encodeURIComponent(Estado.filtros.tipo_exame));
        if (Estado.filtros.busca)      params.push('atendimento=' + encodeURIComponent(Estado.filtros.busca));

        // Multi-selects: enviar como medico/clinica/status
        if (Estado.multiMedico.length > 0)      params.push('medico=' + encodeURIComponent(Estado.multiMedico.join(',')));
        if (Estado.multiClinica.length > 0)     params.push('clinica=' + encodeURIComponent(Estado.multiClinica.join(',')));
        if (Estado.multiStatusExame.length > 0) params.push('status=' + encodeURIComponent(Estado.multiStatusExame.join(',')));

        return params.length > 0 ? '?' + params.join('&') : '';
    }

    // =========================================================
    // CARREGAR DADOS
    // =========================================================

    function carregarDados() {
        if (Estado.carregando) return Promise.resolve();
        Estado.carregando = true;
        atualizarStatus('loading');

        var qs = construirParams();

        return Promise.all([
            fetchComRetry(CONFIG.api.dados + qs),
            fetchComRetry(CONFIG.api.dashboard + qs)
        ])
        .then(function(r) {
            var dadosResp = r[0];
            var dashResp = r[1];
            if (!dadosResp.success) { mostrarErro('Erro ao carregar dados'); return; }
            Estado.pacientes = dadosResp.data || [];
            atualizarKPIs(dashResp.success ? dashResp.data : null);
            renderizarPacientes();
            atualizarContador();
            atualizarHorario();
            atualizarStatus('online');
            Estado.errosConsecutivos = 0;
        })
        .catch(function(err) {
            console.error('[P25] Erro:', err);
            Estado.errosConsecutivos++;
            atualizarStatus('offline');
            if (Estado.errosConsecutivos >= 3) mostrarErro('Falha na conexao com o servidor.');
        })
        .then(function() { Estado.carregando = false; });
    }

    // =========================================================
    // KPIs
    // =========================================================

    function atualizarKPIs(d) {
        if (!d) return;
        var cards = document.querySelectorAll('.resumo-card');
        for (var j = 0; j < cards.length; j++) { cards[j].classList.add('atualizando'); (function(c) { setTimeout(function() { c.classList.remove('atualizando'); }, 300); })(cards[j]); }

        if (DOM.kpiPacientes) DOM.kpiPacientes.textContent = d.qt_pacientes || 0;
        if (DOM.kpiTotal)     DOM.kpiTotal.textContent = d.qt_exames_total || 0;
        if (DOM.kpiProntos)   DOM.kpiProntos.textContent = d.qt_prontos || 0;
        if (DOM.kpiAndamento) DOM.kpiAndamento.textContent = d.qt_em_andamento || 0;
        if (DOM.kpiPendentes) DOM.kpiPendentes.textContent = d.qt_pendentes || 0;
        if (DOM.kpiRadio)     DOM.kpiRadio.textContent = d.qt_radio || 0;
        if (DOM.kpiLab)       DOM.kpiLab.textContent = d.qt_lab || 0;
    }

    function atualizarContador() {
        if (DOM.totalFiltrados) DOM.totalFiltrados.textContent = Estado.pacientes.length;
    }

    // =========================================================
    // ICONES E CLASSES
    // =========================================================

    function iconeSituacao(sit) {
        var m = { 'TODOS_PRONTOS': 'fas fa-check-double', 'PARCIAL': 'fas fa-hourglass-half', 'NENHUM_PRONTO': 'fas fa-clock' };
        return m[sit] || 'fas fa-question';
    }

    function classeSituacao(sit) {
        var m = { 'TODOS_PRONTOS': 'sit-todos-prontos', 'PARCIAL': 'sit-parcial', 'NENHUM_PRONTO': 'sit-nenhum-pronto' };
        return m[sit] || '';
    }

    function iconeTipoExame(tipo) { return tipo === 'RADIOLOGIA' ? 'fas fa-x-ray' : 'fas fa-microscope'; }

    function classeBadgeStatus(status) { return 'badge-' + (status || '').toLowerCase().replace(/_/g, '-'); }
    function classeExameRow(status)    { return 'exame-' + (status || '').toLowerCase().replace(/_/g, '-'); }

    // =========================================================
    // RENDERIZAR PACIENTES
    // =========================================================

    function renderizarPacientes() {
        if (!DOM.painelMain) return;

        if (!Estado.pacientes || Estado.pacientes.length === 0) {
            DOM.painelMain.innerHTML = '<div class="sem-resultados"><i class="fas fa-search"></i>Nenhum paciente encontrado com os filtros selecionados</div>';
            return;
        }

        var html = '<div class="pacientes-container">';
        for (var p = 0; p < Estado.pacientes.length; p++) {
            html += criarCardPacienteHTML(Estado.pacientes[p], p);
        }
        html += '</div>';
        DOM.painelMain.innerHTML = html;

        // Bind eventos de expansao
        var headers = DOM.painelMain.querySelectorAll('.paciente-header');
        for (var h = 0; h < headers.length; h++) {
            headers[h].addEventListener('click', function() {
                this.closest('.paciente-card').classList.toggle('expandido');
            });
        }
    }

    function criarCardPacienteHTML(pac, idx) {
        var sitClass = classeSituacao(pac.situacao_geral);
        var sitIcon = iconeSituacao(pac.situacao_geral);

        var detalhes = '';
        detalhes += '<span><i class="fas fa-hashtag detalhe-icon"></i>' + escapeHtml(pac.nr_atendimento) + '</span>';
        detalhes += '<span><i class="fas fa-user detalhe-icon"></i>' + escapeHtml(pac.idade) + 'a ' + escapeHtml(pac.ie_sexo) + '</span>';
        detalhes += '<span><i class="fas fa-user-md detalhe-icon"></i>' + escapeHtml(pac.nm_medico_resp || 'Sem medico') + '</span>';
        detalhes += '<span><i class="fas fa-hospital detalhe-icon"></i>' + escapeHtml(pac.ds_clinica || '') + '</span>';
        if (pac.cd_cid_principal) detalhes += '<span><i class="fas fa-notes-medical detalhe-icon"></i>CID: ' + escapeHtml(pac.cd_cid_principal) + '</span>';
        detalhes += '<span><i class="fas fa-clock detalhe-icon"></i>' + escapeHtml(pac.tempo_no_ps || '') + '</span>';
        if (pac.ds_convenio) detalhes += '<span><i class="fas fa-id-card detalhe-icon"></i>' + escapeHtml(pac.ds_convenio) + '</span>';

        var pills = '';
        if (pac.qt_prontos > 0)       pills += '<span class="contador-pill pill-prontos"><i class="fas fa-check"></i> ' + pac.qt_prontos + '</span>';
        if (pac.qt_em_andamento > 0)  pills += '<span class="contador-pill pill-andamento"><i class="fas fa-spinner"></i> ' + pac.qt_em_andamento + '</span>';
        if (pac.qt_pendentes > 0)     pills += '<span class="contador-pill pill-pendentes"><i class="fas fa-clock"></i> ' + pac.qt_pendentes + '</span>';

        var examesHTML = '';
        var exames = pac.exames || [];
        for (var e = 0; e < exames.length; e++) {
            examesHTML += criarLinhaExameHTML(exames[e]);
        }

        return '<div class="paciente-card ' + sitClass + '" style="animation-delay:' + (idx * 0.02) + 's">' +
            '<div class="paciente-header">' +
                '<div class="situacao-badge"><i class="' + sitIcon + '"></i></div>' +
                '<div class="paciente-info">' +
                    '<div class="paciente-nome">' + escapeHtml(pac.nm_pessoa_fisica || 'Sem nome') + '</div>' +
                    '<div class="paciente-detalhes">' + detalhes + '</div>' +
                '</div>' +
                '<div class="paciente-contadores">' + pills + '</div>' +
                '<span class="expand-arrow"><i class="fas fa-chevron-down"></i></span>' +
            '</div>' +
            '<div class="paciente-exames"><div class="exames-lista">' + examesHTML + '</div></div>' +
        '</div>';
    }

    function criarLinhaExameHTML(exame) {
        var tempoStr = exame.tempo_espera || '';
        if (tempoStr.indexOf('-') === 0) tempoStr = '0h 00min';

        return '<div class="exame-row ' + classeExameRow(exame.status_exame) + '">' +
            '<div class="exame-tipo-icon"><i class="' + iconeTipoExame(exame.tipo_exame) + '"></i></div>' +
            '<div class="exame-info">' +
                '<div class="exame-procedimento">' + escapeHtml(exame.ds_procedimento || 'Sem descricao') + '</div>' +
                (exame.ds_material ? '<div class="exame-material">' + escapeHtml(exame.ds_material) + '</div>' : '') +
            '</div>' +
            '<span class="exame-status-badge ' + classeBadgeStatus(exame.status_exame) + '">' + escapeHtml(exame.ds_status || exame.status_exame || '') + '</span>' +
            '<span class="exame-tempo"><i class="fas fa-hourglass-half"></i> ' + escapeHtml(tempoStr) + '</span>' +
        '</div>';
    }

    function mostrarErro(msg) {
        if (!DOM.painelMain) return;
        DOM.painelMain.innerHTML = '<div class="sem-resultados"><i class="fas fa-exclamation-triangle"></i>' + escapeHtml(msg || 'Erro ao carregar dados') + '</div>';
    }

    // =========================================================
    // TOGGLE FILTROS
    // =========================================================

    var filtrosVisiveis = false;

    function toggleFiltros() {
        filtrosVisiveis = !filtrosVisiveis;
        var bar = document.getElementById('filtros-bar');
        if (bar) bar.style.display = filtrosVisiveis ? 'block' : 'none';
    }

    // =========================================================
    // CARREGAR FILTROS DINAMICOS
    // =========================================================

    function carregarFiltrosDinamicos() {
        fetchComRetry(CONFIG.api.filtros)
            .then(function(resp) {
                if (!resp.success) return;
                var medicos = (resp.medicos || []).map(function(m) { return m.nm_medico_resp; });
                var clinicas = (resp.clinicas || []).map(function(c) { return c.ds_clinica; });
                if (medicos.length > 0) popularMultiSelectDinamico('ms-medico', medicos);
                if (clinicas.length > 0) popularMultiSelectDinamico('ms-clinica', clinicas);
            })
            .catch(function(err) { console.warn('[P25] Erro filtros:', err); });
    }

    // =========================================================
    // EVENTOS
    // =========================================================

    function configurarEventos() {
        configurarToggleMultiSelects();
        vincularCheckboxesMultiSelect('ms-status');

        // Tipo exame
        if (DOM.filtroTipoExame) DOM.filtroTipoExame.addEventListener('change', function() {
            Estado.filtros.tipo_exame = this.value;
            salvar('tipo_exame', this.value);
            carregarDados();
        });

        // Busca com debounce
        if (DOM.filtroBusca) DOM.filtroBusca.addEventListener('input', function() {
            var v = this.value;
            if (Estado.timeouts.debounce) clearTimeout(Estado.timeouts.debounce);
            Estado.timeouts.debounce = setTimeout(function() {
                Estado.filtros.busca = v;
                salvar('busca', v);
                carregarDados();
            }, CONFIG.debounceMs);
        });

        // Toggle filtros
        if (DOM.btnToggleFiltros) DOM.btnToggleFiltros.addEventListener('click', toggleFiltros);

        // Limpar
        if (DOM.btnLimpar) DOM.btnLimpar.addEventListener('click', function() {
            Estado.filtros = { tipo_exame: '', busca: '' };
            if (DOM.filtroTipoExame) DOM.filtroTipoExame.value = '';
            if (DOM.filtroBusca) DOM.filtroBusca.value = '';
            resetarTodosMultiSelects();
            salvar('tipo_exame', ''); salvar('busca', '');
            carregarDados();
        });

        // Voltar
        if (DOM.btnVoltar) DOM.btnVoltar.addEventListener('click', function() { window.location.href = '/frontend/dashboard.html'; });

        // Refresh
        if (DOM.btnRefresh) DOM.btnRefresh.addEventListener('click', function() {
            DOM.btnRefresh.classList.add('girando');
            carregarDados().then(function() {
                setTimeout(function() { DOM.btnRefresh.classList.remove('girando'); }, 500);
            });
        });

        // Teclado
        document.addEventListener('keydown', function(e) {
            if (e.key === 'Escape') {
                if (Estado.dropdownAberto) fecharTodosDropdowns();
            }
            if (e.key === 'F5') { e.preventDefault(); carregarDados(); }
        });

        // Visibility
        document.addEventListener('visibilitychange', function() {
            if (!document.hidden) carregarDados();
        });
    }

    // =========================================================
    // INICIALIZACAO
    // =========================================================

    function inicializar() {
        console.log('[P25] Inicializando...');
        cachearElementos();

        // Restaurar filtros simples
        var tipoSalvo = recuperar('tipo_exame');
        if (tipoSalvo) { Estado.filtros.tipo_exame = tipoSalvo; if (DOM.filtroTipoExame) DOM.filtroTipoExame.value = tipoSalvo; }
        var buscaSalva = recuperar('busca');
        if (buscaSalva) { Estado.filtros.busca = buscaSalva; if (DOM.filtroBusca) DOM.filtroBusca.value = buscaSalva; }

        Estado.filtrosRecolhidos = false;

        configurarEventos();
        carregarFiltrosDinamicos();
        carregarDados();

        Estado.intervalos.refresh = setInterval(function() {
            carregarFiltrosDinamicos();
            carregarDados();
        }, CONFIG.intervaloRefresh);

        console.log('[P25] Inicializado com sucesso');
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', inicializar);
    else inicializar();

})();