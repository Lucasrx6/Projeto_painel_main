/* Painel 33 - Autorizacoes de Convenio | ES5 IIFE */
(function () {
    'use strict';

    var CONFIG = {
        apiDados:           '/api/paineis/painel33/dados',
        apiFiltros:         '/api/paineis/painel33/filtros',
        apiPaciente:        '/api/paineis/painel33/paciente',
        apiExport:          '/api/paineis/painel33/export',
        apiVisaoGeral:      '/api/paineis/painel33/visao-geral',
        apiValoresDash:     '/api/paineis/painel33/valores/dashboard',
        apiValoresLista:    '/api/paineis/painel33/valores/lista',
        apiValoresDetalhe:  '/api/paineis/painel33/valores/detalhe',
        intervaloRefresh: 390000,
        scrollPasso:      1,
        scrollIntervalo:  50,
        pausaNoFinal:     3000,
        pausaAposReset:   1500,
        watchdogInterval: 5000,
        watchdogMax:      3,
        storagePrefix:    'painel33_'
    };

    // Multi-select state keys (mapeia data-state-key do HTML)
    var estado = {
        // Multi-selects
        msEstagio:       [],
        msSemaforo:      [],
        msConvenio:      [],
        msTipoGuia:      [],
        msTipoAutor:     [],
        msSetor:         [],
        msMedico:        [],
        msTipoAtend:     ['Internado'],

        // Filtros simples
        periodo: '7',
        busca:   '',

        // Dados e agrupamento
        pacientesOrdem:    [],
        pacientesGrupo:    {},
        pacienteCache:     {},  // idx -> resp data
        expandidos:        {},  // idx -> bool
        _filaDetalhes:     [],  // fila de idx aguardando fetch
        _emFlightDetalhes: 0,   // requisicoes paralelas em andamento

        // Aba Valores Pendentes
        valoresPagina:      1,
        valoresTotalPag:    1,
        valoresFiltros:     { vlMinimo: 0, apenasAltoRisco: false, apenasComConta: false },
        drawerValoresAberto: false,

        // Ordem
        ordemCampo: 'dt_pedido_medico',
        ordemDir:   'desc',

        // UI
        isAdmin:             false,
        abaAtiva:            'visao-geral',
        carregando:          false,
        filtrosVisiveis:     false,
        dropdownAberto:      null,
        intervalos:          { scroll: null, watchdog: null, refresh: null },
        watchdog:            { ultimaPosicao: 0, contadorTravamento: 0 },
        autoscrollDesativado: false
    };

    var DOM = {};

    // ============================================================
    // INICIALIZACAO
    // ============================================================

    function inicializar() {
        coletarDOM();
        configurarEventos();
        restaurarEstadoLocal();
        if (estado.autoscrollDesativado) {
            DOM.btnAutoscroll.classList.remove('ativo');
            DOM.btnAutoscroll.querySelector('i').className = 'fas fa-pause';
            DOM.btnAutoscroll.title = 'Iniciar Auto-scroll';
        }
        carregarFiltros();
        carregarDados();
        carregarVisaoGeral();

        estado.intervalos.refresh = setInterval(function () {
            if (!estado.filtrosVisiveis) {
                carregarDados();
                if (estado.abaAtiva === 'visao-geral') carregarVisaoGeral();
            }
        }, CONFIG.intervaloRefresh);
    }

    function coletarDOM() {
        DOM.btnToggleFiltros  = document.getElementById('btn-toggle-filtros');
        DOM.filtrosBar        = document.getElementById('filtros-bar');
        DOM.btnLimpar         = document.getElementById('btn-limpar');
        DOM.btnRefresh        = document.getElementById('btn-refresh');
        DOM.btnVoltar         = document.getElementById('btn-voltar');
        DOM.btnExport         = document.getElementById('btn-export');
        DOM.btnAutoscroll     = document.getElementById('btn-autoscroll');
        DOM.filtroPeriodo     = document.getElementById('filtro-periodo');
        DOM.filtroBusca       = document.getElementById('filtro-busca');

        DOM.tabelaTbody  = document.getElementById('tabela-tbody');
        DOM.tabelaTotal  = document.getElementById('tabela-total');
        DOM.tabelaVazia  = document.getElementById('tabela-vazia');

        DOM.statusIndicator   = document.getElementById('status-indicator');
        DOM.ultimaAtualizacao = document.getElementById('ultima-atualizacao');
        DOM.toastContainer    = document.getElementById('toast-container');

        DOM.tabBtns      = document.querySelectorAll('.tab-nav-btn');
        DOM.tabPanels    = document.querySelectorAll('.tab-panel');
        DOM.resumoSintetico = document.getElementById('resumo-sintetico-container');

        // Aba Visão Geral
        DOM.vgKpis            = document.getElementById('vg-kpis');
        DOM.vgConveniosTbody  = document.getElementById('vg-convenios-tbody');
        DOM.vgAnaliticaTbody  = document.getElementById('vg-analitica-tbody');
        DOM.tabBtnValores     = document.getElementById('tab-btn-valores');
        // Modal Responsáveis
        DOM.modalResp         = document.getElementById('modal-resp');
        DOM.modalRespOverlay  = document.getElementById('modal-resp-overlay');
        DOM.modalRespFechar   = document.getElementById('modal-resp-fechar');
        DOM.modalRespBody     = document.getElementById('modal-resp-body');
        DOM.btnAbrirResp      = document.getElementById('btn-abrir-responsaveis');

        // Aba Valores
        DOM.valoresKpis       = document.getElementById('valores-kpis');
        DOM.valoresChartConv  = document.getElementById('chart-convenios');
        DOM.valoresChartSet   = document.getElementById('chart-setores');
        DOM.valoresTbody      = document.getElementById('valores-tbody');
        DOM.valoresPagLabel   = document.getElementById('valores-total-label');
        DOM.valoresPaginacao  = document.getElementById('valores-paginacao');
        DOM.vfVlMin           = document.getElementById('vf-vlmin');
        DOM.vfVlMinDisplay    = document.getElementById('vf-vlmin-display');
        DOM.vfAltoRisco       = document.getElementById('vf-alto-risco');
        DOM.vfComConta        = document.getElementById('vf-com-conta');
        // Drawer valores
        DOM.drawerValores        = document.getElementById('drawer-valores');
        DOM.drawerValoresOverlay = document.getElementById('drawer-valores-overlay');
        DOM.drawerValoresFechar  = document.getElementById('drawer-valores-fechar');
        DOM.drawerValoresBody    = document.getElementById('drawer-valores-body');
        DOM.drawerValoresSeq     = document.getElementById('drawer-valores-seq');
        DOM.drawerValoresTabNav  = document.getElementById('drawer-valores-tabnav');
    }

    // ============================================================
    // EVENTOS
    // ============================================================

    function configurarEventos() {
        DOM.btnToggleFiltros.addEventListener('click', toggleFiltros);
        DOM.btnLimpar.addEventListener('click', limparTudo);
        DOM.btnRefresh.addEventListener('click', function () { carregarDados(); });
        DOM.btnVoltar.addEventListener('click', function () { window.history.back(); });
        DOM.btnExport.addEventListener('click', exportarCSV);
        DOM.btnAutoscroll.addEventListener('click', toggleAutoscroll);

        DOM.filtroPeriodo.addEventListener('change', function () {
            estado.periodo = DOM.filtroPeriodo.value;
            salvarEstadoLocal();
            recarregarTudo();
        });

        var debounce;
        DOM.filtroBusca.addEventListener('input', function () {
            clearTimeout(debounce);
            debounce = setTimeout(function () {
                estado.busca = DOM.filtroBusca.value;
                salvarEstadoLocal();
                recarregarTudo();
            }, 400);
        });

        // Fechar dropdowns ao clicar fora
        document.addEventListener('click', function (e) {
            if (estado.dropdownAberto) {
                var c = document.getElementById(estado.dropdownAberto);
                if (c && !c.contains(e.target)) fecharTodosDropdowns();
            }
        });

        // Delegar click para as subabas (minimize/maximize)
        DOM.tabelaTbody.addEventListener('click', function(e) {
            var header = e.target.closest('.pac-section-header');
            if (header && header.getAttribute('data-action') === 'toggle-subaba') {
                e.stopPropagation();
                header.classList.toggle('aberto');
                var content = header.nextElementSibling;
                if (content && content.classList.contains('pac-section-content')) {
                    content.classList.toggle('aberto');
                }
            }
        });

        // Abas
        for (var t = 0; t < DOM.tabBtns.length; t++) {
            DOM.tabBtns[t].addEventListener('click', function() {
                mudarAba(this.getAttribute('data-tab'));
            });
        }

        // Clique no card de setor na Visão Sintética
        DOM.resumoSintetico.addEventListener('click', function(e) {
            var card = e.target.closest('.setor-card');
            if (card) {
                var setor = card.getAttribute('data-setor');
                if (setor && setor !== 'Não Informado') {
                    filtrarPorSetorNaAbaAnalitica(setor);
                }
            }
        });

        // Triggers dos multi-selects (toggle dropdown)
        var triggers = document.querySelectorAll('.ms-trigger');
        for (var i = 0; i < triggers.length; i++) {
            triggers[i].addEventListener('click', (function (tr) {
                return function (e) {
                    e.stopPropagation();
                    var containerId = tr.closest('.multi-select-container').id;
                    var dd = tr.closest('.multi-select-container').querySelector('.multi-select-dropdown');
                    var isOpen = dd.classList.contains('aberto');
                    fecharTodosDropdowns();
                    if (!isOpen) {
                        dd.classList.add('aberto');
                        tr.classList.add('aberto');
                        tr.setAttribute('aria-expanded', 'true');
                        estado.dropdownAberto = containerId;
                    }
                };
            })(triggers[i]));
        }

        // Ordenacao por cabecalho
        var ths = document.querySelectorAll('.painel-table thead th.sortable');
        for (var j = 0; j < ths.length; j++) {
            ths[j].addEventListener('click', (function (th) {
                return function () {
                    var campo = th.getAttribute('data-campo');
                    if (estado.ordemCampo === campo) {
                        estado.ordemDir = estado.ordemDir === 'asc' ? 'desc' : 'asc';
                    } else {
                        estado.ordemCampo = campo;
                        estado.ordemDir = 'desc';
                    }
                    atualizarIconesOrdem();
                    carregarDados();
                };
            })(ths[j]));
        }

        // Inicializar multi-selects fixos
        vincularMultiSelect('ms-semaforo');

        // Filtros extras da aba valores
        DOM.vfVlMin.addEventListener('input', function () {
            estado.valoresFiltros.vlMinimo = parseInt(this.value, 10) || 0;
            DOM.vfVlMinDisplay.textContent = formatarBRL(estado.valoresFiltros.vlMinimo, true);
        });
        DOM.vfVlMin.addEventListener('change', function () {
            estado.valoresPagina = 1;
            carregarValoresLista(1);
        });
        DOM.vfAltoRisco.addEventListener('change', function () {
            estado.valoresFiltros.apenasAltoRisco = this.checked;
            estado.valoresPagina = 1;
            carregarValoresLista(1);
        });
        DOM.vfComConta.addEventListener('change', function () {
            estado.valoresFiltros.apenasComConta = this.checked;
            estado.valoresPagina = 1;
            carregarValoresLista(1);
        });

        // Modal Responsáveis
        if (DOM.btnAbrirResp)    DOM.btnAbrirResp.addEventListener('click', abrirModalResponsaveis);
        if (DOM.modalRespFechar) DOM.modalRespFechar.addEventListener('click', fecharModalResponsaveis);
        if (DOM.modalRespOverlay) DOM.modalRespOverlay.addEventListener('click', fecharModalResponsaveis);

        // Drawer valores — fechar
        DOM.drawerValoresFechar.addEventListener('click', fecharDrawerValores);
        DOM.drawerValoresOverlay.addEventListener('click', fecharDrawerValores);

        // Tabs internas do drawer valores
        DOM.drawerValoresTabNav.addEventListener('click', function (e) {
            var btn = e.target.closest('.det-tab-btn');
            if (!btn) return;
            var dtab = btn.getAttribute('data-dtab');
            var btns = DOM.drawerValoresTabNav.querySelectorAll('.det-tab-btn');
            for (var i = 0; i < btns.length; i++) btns[i].classList.toggle('active', btns[i] === btn);
            var panels = DOM.drawerValoresBody.querySelectorAll('.fin-tab-panel');
            for (var j = 0; j < panels.length; j++) {
                panels[j].classList.toggle('active', panels[j].getAttribute('data-dtab') === dtab);
            }
        });
    }

    function fecharTodosDropdowns() {
        var dds = document.querySelectorAll('.multi-select-dropdown.aberto');
        for (var i = 0; i < dds.length; i++) dds[i].classList.remove('aberto');
        var trs = document.querySelectorAll('.ms-trigger.aberto');
        for (var j = 0; j < trs.length; j++) {
            trs[j].classList.remove('aberto');
            trs[j].setAttribute('aria-expanded', 'false');
        }
        estado.dropdownAberto = null;
    }

    function mudarAba(tabId) {
        estado.abaAtiva = tabId;
        salvarEstadoLocal();
        for (var i = 0; i < DOM.tabBtns.length; i++) {
            DOM.tabBtns[i].classList.toggle('active', DOM.tabBtns[i].getAttribute('data-tab') === tabId);
        }
        for (var j = 0; j < DOM.tabPanels.length; j++) {
            DOM.tabPanels[j].classList.toggle('active', DOM.tabPanels[j].id === 'tab-' + tabId);
        }

        // Tratar auto-scroll da tabela
        if (tabId === 'autorizacoes' && !estado.autoscrollDesativado && !estado.filtrosVisiveis) {
            iniciarScrollAutomatico();
        } else {
            pararScrollAutomatico();
        }

        // Carregar aba ao entrar nela
        if (tabId === 'visao-geral') {
            carregarVisaoGeral();
        }
        if (tabId === 'valores') {
            carregarValoresDashboard();
            carregarValoresLista(1);
        }

        // Limpar filtros ao voltar para a Visão Sintética
        if (tabId === 'resumo') {
            var temFiltro = false;
            var keys = ['msEstagio', 'msSemaforo', 'msConvenio', 'msTipoGuia', 'msTipoAutor', 'msSetor', 'msMedico'];
            for (var k = 0; k < keys.length; k++) {
                if (estado[keys[k]] && estado[keys[k]].length > 0) {
                    temFiltro = true;
                    break;
                }
            }
            if (estado.busca !== '') temFiltro = true;

            if (temFiltro) {
                limparTudo();
            }
        }
    }

    // ============================================================
    // MULTI-SELECT
    // ============================================================

    function vincularMultiSelect(containerId) {
        var container = document.getElementById(containerId);
        if (!container) return;
        var stateKey = container.getAttribute('data-state-key');

        var checkboxes = container.querySelectorAll('.multi-select-checkbox');
        for (var i = 0; i < checkboxes.length; i++) {
            var oldCb = checkboxes[i];
            var newCb = oldCb.cloneNode(true);
            oldCb.parentNode.replaceChild(newCb, oldCb);
            newCb.addEventListener('change', function () {
                syncMultiSelect(containerId);
                atualizarLabel(containerId);
                salvarEstadoLocal();
                recarregarTudo();
            });
        }

        var btnAll = container.querySelector('.btn-ms-all');
        if (btnAll) {
            var na = btnAll.cloneNode(true);
            btnAll.parentNode.replaceChild(na, btnAll);
            na.addEventListener('click', function (e) {
                e.stopPropagation();
                var cbs = container.querySelectorAll('.multi-select-checkbox');
                for (var j = 0; j < cbs.length; j++) cbs[j].checked = true;
                syncMultiSelect(containerId);
                atualizarLabel(containerId);
                salvarEstadoLocal();
                recarregarTudo();
            });
        }

        var btnNone = container.querySelector('.btn-ms-none');
        if (btnNone) {
            var nn = btnNone.cloneNode(true);
            btnNone.parentNode.replaceChild(nn, btnNone);
            nn.addEventListener('click', function (e) {
                e.stopPropagation();
                var cbs = container.querySelectorAll('.multi-select-checkbox');
                for (var j = 0; j < cbs.length; j++) cbs[j].checked = false;
                syncMultiSelect(containerId);
                atualizarLabel(containerId);
                salvarEstadoLocal();
                recarregarTudo();
            });
        }

        restaurarMultiSelect(containerId);
        atualizarLabel(containerId);
    }

    function syncMultiSelect(containerId) {
        var container = document.getElementById(containerId);
        if (!container) return;
        var stateKey = container.getAttribute('data-state-key');
        var cbs = container.querySelectorAll('.multi-select-checkbox');
        var sel = [];
        for (var i = 0; i < cbs.length; i++) {
            var lbl = cbs[i].closest('.multi-select-item');
            if (cbs[i].checked) {
                sel.push(cbs[i].value);
                if (lbl) lbl.classList.add('selecionado');
            } else {
                if (lbl) lbl.classList.remove('selecionado');
            }
        }
        estado[stateKey] = sel;
    }

    function restaurarMultiSelect(containerId) {
        var container = document.getElementById(containerId);
        if (!container) return;
        var stateKey = container.getAttribute('data-state-key');
        var salvos = estado[stateKey] || [];
        if (!salvos.length) return;
        var cbs = container.querySelectorAll('.multi-select-checkbox');
        for (var i = 0; i < cbs.length; i++) {
            if (salvos.indexOf(cbs[i].value) !== -1) {
                cbs[i].checked = true;
                var lbl = cbs[i].closest('.multi-select-item');
                if (lbl) lbl.classList.add('selecionado');
            }
        }
    }

    function atualizarLabel(containerId) {
        var container = document.getElementById(containerId);
        if (!container) return;
        var stateKey   = container.getAttribute('data-state-key');
        var placeholder = container.getAttribute('data-placeholder');
        var labelEl    = container.querySelector('.multi-select-label');
        if (!labelEl) return;
        var qtd   = (estado[stateKey] || []).length;
        var total = container.querySelectorAll('.multi-select-checkbox').length;
        if (!qtd || qtd === total) {
            labelEl.textContent = placeholder;
        } else if (qtd === 1) {
            var cb = container.querySelector('.multi-select-checkbox:checked');
            var it = cb ? cb.closest('.multi-select-item').querySelector('.multi-select-item-text') : null;
            labelEl.textContent = it ? it.textContent : (estado[stateKey][0] || placeholder);
        } else {
            labelEl.textContent = qtd + ' selecionados';
        }
    }

    function popularMultiSelectDinamico(containerId, valores) {
        var container = document.getElementById(containerId);
        if (!container) return;
        var optionsDiv = container.querySelector('.multi-select-options');
        if (!optionsDiv) return;
        optionsDiv.innerHTML = '';
        for (var i = 0; i < valores.length; i++) {
            var label = document.createElement('label');
            label.className = 'multi-select-item';
            var cb = document.createElement('input');
            cb.type = 'checkbox'; cb.className = 'multi-select-checkbox'; cb.value = valores[i];
            var span = document.createElement('span');
            span.className = 'multi-select-item-text'; span.textContent = valores[i];
            label.appendChild(cb); label.appendChild(span);
            optionsDiv.appendChild(label);
        }
        vincularMultiSelect(containerId);
    }

    function resetarTodosMultiSelects() {
        var containers = document.querySelectorAll('.multi-select-container');
        for (var i = 0; i < containers.length; i++) {
            var stateKey   = containers[i].getAttribute('data-state-key');
            var placeholder = containers[i].getAttribute('data-placeholder');
            estado[stateKey] = [];
            var cbs = containers[i].querySelectorAll('.multi-select-checkbox');
            for (var j = 0; j < cbs.length; j++) {
                cbs[j].checked = false;
                var lbl = cbs[j].closest('.multi-select-item');
                if (lbl) lbl.classList.remove('selecionado');
            }
            var labelEl = containers[i].querySelector('.multi-select-label');
            if (labelEl) labelEl.textContent = placeholder;
        }
    }

    // ============================================================
    // FILTROS BAR
    // ============================================================

    function toggleFiltros() {
        estado.filtrosVisiveis = !estado.filtrosVisiveis;
        DOM.filtrosBar.style.display = estado.filtrosVisiveis ? 'block' : 'none';
        DOM.btnToggleFiltros.classList.toggle('ativo', estado.filtrosVisiveis);
        if (estado.filtrosVisiveis) {
            pararScrollAutomatico();
        } else {
            if (!estado.autoscrollDesativado) iniciarScrollAutomatico();
        }
    }

    function limparTudo() {
        resetarTodosMultiSelects();
        estado.periodo = '7';
        estado.busca   = '';
        DOM.filtroPeriodo.value = '7';
        DOM.filtroBusca.value   = '';
        salvarEstadoLocal();
        recarregarTudo();
    }

    function recarregarTudo() {
        estado.pacienteCache = {};
        estado.expandidos    = {};
        carregarDados();
        carregarVisaoGeral();
        if (estado.abaAtiva === 'valores') {
            carregarValoresDashboard();
            carregarValoresLista(1);
        }
    }

    function filtrarPorSetorNaAbaAnalitica(setor) {
        resetarTodosMultiSelects();

        estado.msSetor = [setor];
        restaurarMultiSelect('ms-setor');
        atualizarLabel('ms-setor');

        salvarEstadoLocal();
        mudarAba('autorizacoes');
        recarregarTudo();
    }

    // ============================================================
    // PERSISTENCIA LOCAL
    // ============================================================

    function salvarEstadoLocal() {
        try {
            var data = {
                msEstagio:            estado.msEstagio,
                msSemaforo:           estado.msSemaforo,
                msConvenio:           estado.msConvenio,
                msTipoGuia:           estado.msTipoGuia,
                msTipoAutor:          estado.msTipoAutor,
                msSetor:              estado.msSetor,
                msMedico:             estado.msMedico,
                msTipoAtend:          estado.msTipoAtend,
                periodo:              estado.periodo,
                busca:                estado.busca,
                ordemCampo:           estado.ordemCampo,
                ordemDir:             estado.ordemDir,
                abaAtiva:             estado.abaAtiva,
                autoscrollDesativado: estado.autoscrollDesativado
            };
            localStorage.setItem(CONFIG.storagePrefix + 'estado', JSON.stringify(data));
        } catch (e) {}
    }

    function restaurarEstadoLocal() {
        try {
            var saved = localStorage.getItem(CONFIG.storagePrefix + 'estado');
            if (!saved) return;
            var d = JSON.parse(saved);
            var arrays = ['msEstagio','msSemaforo','msConvenio','msTipoGuia','msTipoAutor','msSetor','msMedico','msTipoAtend'];
            for (var i = 0; i < arrays.length; i++) {
                if (Array.isArray(d[arrays[i]])) estado[arrays[i]] = d[arrays[i]];
            }
            if (d.periodo !== undefined) { estado.periodo = d.periodo; DOM.filtroPeriodo.value = d.periodo; }
            if (d.busca)    { estado.busca    = d.busca;    DOM.filtroBusca.value    = d.busca; }
            if (d.ordemCampo) estado.ordemCampo = d.ordemCampo;
            if (d.ordemDir)   estado.ordemDir   = d.ordemDir;
            if (d.autoscrollDesativado !== undefined) estado.autoscrollDesativado = !!d.autoscrollDesativado;
            if (d.abaAtiva) {
                estado.abaAtiva = d.abaAtiva;
                mudarAba(d.abaAtiva);
            }
        } catch (e) {}
    }

    // ============================================================
    // CONSTRUIR PARAMS
    // ============================================================

    function construirParams() {
        var p = {};
        if (estado.msEstagio.length)    p.estagio          = estado.msEstagio.join(',');
        if (estado.msSemaforo.length)   p.semaforo         = estado.msSemaforo.join(',');
        if (estado.msConvenio.length)   p.convenio         = estado.msConvenio.join(',');
        if (estado.msTipoGuia.length)   p.tipo_guia        = estado.msTipoGuia.join(',');
        if (estado.msTipoAutor.length)  p.tipo_autorizacao = estado.msTipoAutor.join(',');
        if (estado.msSetor.length)      p.setor            = estado.msSetor.join(',');
        if (estado.msMedico.length)     p.medico           = estado.msMedico.join(',');
        if (estado.msTipoAtend.length)  p.tipo_atendimento = estado.msTipoAtend.join(',');
        if (estado.periodo)            p.periodo        = estado.periodo;
        if (estado.busca)              p.busca          = estado.busca;
        p.ordem = estado.ordemCampo;
        p.dir   = estado.ordemDir;
        return p;
    }

    // ============================================================
    // FETCH COM RETRY
    // ============================================================

    function fetchComRetry(url, params, tentativas) {
        tentativas = tentativas || 3;
        var qs = Object.keys(params).map(function (k) {
            return encodeURIComponent(k) + '=' + encodeURIComponent(params[k]);
        }).join('&');
        var urlCompleta = qs ? url + '?' + qs : url;

        var controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
        var timeoutId  = controller ? setTimeout(function () { controller.abort(); }, 15000) : null;
        var fetchOpts  = { credentials: 'same-origin' };
        if (controller) fetchOpts.signal = controller.signal;

        return fetch(urlCompleta, fetchOpts).then(function (resp) {
            if (timeoutId) clearTimeout(timeoutId);
            if (!resp.ok) throw new Error('HTTP ' + resp.status);
            return resp.json();
        }).catch(function (err) {
            if (timeoutId) clearTimeout(timeoutId);
            if (tentativas > 1) {
                return new Promise(function (res) { setTimeout(res, 1500); }).then(function () {
                    return fetchComRetry(url, params, tentativas - 1);
                });
            }
            throw err;
        });
    }

    // ============================================================
    // CARREGAR DADOS E AGRUPAR POR PACIENTE
    // ============================================================

    function carregarFiltros() {
        fetchComRetry(CONFIG.apiFiltros, {}).then(function (resp) {
            if (!resp.ok) return;
            var f = resp.filtros;
            popularMultiSelectDinamico('ms-estagio',    f.estagios        || []);
            popularMultiSelectDinamico('ms-convenio',   f.convenios       || []);
            popularMultiSelectDinamico('ms-tipo-guia',  f.tipos_guia      || []);
            popularMultiSelectDinamico('ms-tipo-autor',  f.tipos_autorizacao || []);
            popularMultiSelectDinamico('ms-setor',      f.setores         || []);
            popularMultiSelectDinamico('ms-medico',     f.medicos         || []);
            // Restaurar seleções salvas
            restaurarMultiSelect('ms-estagio');
            restaurarMultiSelect('ms-convenio');
            restaurarMultiSelect('ms-tipo-guia');
            restaurarMultiSelect('ms-tipo-autor');
            restaurarMultiSelect('ms-setor');
            restaurarMultiSelect('ms-medico');
            atualizarLabel('ms-estagio');
            atualizarLabel('ms-convenio');
            atualizarLabel('ms-tipo-guia');
            atualizarLabel('ms-tipo-autor');
            atualizarLabel('ms-setor');
            atualizarLabel('ms-medico');
        }).catch(function () {});
    }

    function carregarDados() {
        if (estado.carregando) return;
        estado.carregando = true;
        DOM.tabelaTbody.innerHTML = '<tr><td colspan="7" class="loading-cell">'
            + '<div class="loading-spinner"></div> Carregando...</td></tr>';
        DOM.tabelaVazia.style.display = 'none';
        DOM.resumoSintetico.innerHTML = '<div class="loading"><div class="loading-spinner"></div><p>Carregando...</p></div>';

        setStatusIndicator('loading');
        fetchComRetry(CONFIG.apiDados, construirParams()).then(function (resp) {
            estado.carregando = false;
            if (resp.ok) {
                renderizarTabela(resp.dados || []);
                renderizarSintetico(resp.dados || []);
                atualizarHora();
                setStatusIndicator('online');
            } else {
                setStatusIndicator('offline');
                DOM.tabelaTbody.innerHTML = '<tr><td colspan="7" class="loading-cell">'
                    + 'Erro: ' + esc(resp.detalhe || resp.erro) + '</td></tr>';
                DOM.resumoSintetico.innerHTML = '<div class="loading">Erro ao carregar dados sintéticos.</div>';
            }
        }).catch(function (err) {
            estado.carregando = false;
            setStatusIndicator('offline');
            DOM.tabelaTbody.innerHTML = '<tr><td colspan="7" class="loading-cell">'
                + 'Falha: ' + esc(err.message) + '</td></tr>';
            DOM.resumoSintetico.innerHTML = '<div class="loading">Falha de conexão.</div>';
        });
    }

    // ============================================================
    // AGRUPAR POR PACIENTE
    // ============================================================

    function agruparPorPaciente(dados) {
        var grupos  = {};
        var ordem   = [];
        var prioSem = { vermelho: 4, laranja: 3, amarelo: 2, verde: 1, encerrado: 0 };
        var prioSla = { atrasado: 3, atencao: 2, dentro: 1, sem_pedido: 0 };

        for (var i = 0; i < dados.length; i++) {
            var d = dados[i];
            // key: cd_pessoa_fisica ou fallback por nome
            var key = (d.cd_pessoa_fisica !== null && d.cd_pessoa_fisica !== undefined)
                ? String(d.cd_pessoa_fisica)
                : ('__' + (d.nm_paciente || 'desconhecido'));

            if (!grupos[key]) {
                grupos[key] = {
                    cd:            d.cd_pessoa_fisica,
                    nome:          d.nm_paciente || '--',
                    autorizacoes:  [],
                    piorSemaforo:  'verde',
                    piorSla:       null,
                    recentePedido: null,
                    recenteAut:    null,
                    primeira:      d
                };
                ordem.push(key);
            }
            grupos[key].autorizacoes.push(d);

            var semAtual = prioSem[grupos[key].piorSemaforo] || 0;
            var semCalc  = calcularSemaforoPrazo(d.ds_estagio, d.horas_em_aberto);
            var semNovo  = prioSem[semCalc] || 0;
            if (semNovo > semAtual) grupos[key].piorSemaforo = semCalc;

            var slaAtual = prioSla[grupos[key].piorSla] || 0;
            var slaNovo  = prioSla[d.status_sla] || 0;
            if (slaNovo > slaAtual) grupos[key].piorSla = d.status_sla;

            if (d.dt_pedido_medico && (!grupos[key].recentePedido || d.dt_pedido_medico > grupos[key].recentePedido)) {
                grupos[key].recentePedido = d.dt_pedido_medico;
                grupos[key].recenteAut    = d.dt_autorizacao;
                grupos[key].primeira      = d;
            }
        }
        return { grupos: grupos, ordem: ordem };
    }

    // ============================================================
    // RENDERIZAR TABELA (por paciente)
    // ============================================================

    function renderizarTabela(dados) {
        DOM.tabelaTotal.textContent = dados.length + ' registro' + (dados.length !== 1 ? 's' : '');

        if (!dados.length) {
            DOM.tabelaTbody.innerHTML = '';
            DOM.tabelaVazia.style.display = 'block';
            return;
        }
        DOM.tabelaVazia.style.display = 'none';

        var agrupado = agruparPorPaciente(dados);
        estado.pacientesOrdem = agrupado.ordem;
        estado.pacientesGrupo = agrupado.grupos;

        DOM.tabelaTotal.textContent = agrupado.ordem.length + ' pac. · ' + dados.length + ' autorizações';

        // Expandir todos por padrão (painel TV)
        for (var e = 0; e < agrupado.ordem.length; e++) {
            if (estado.expandidos[e] === undefined) {
                estado.expandidos[e] = true;
            }
        }

        var html = '';
        for (var i = 0; i < agrupado.ordem.length; i++) {
            var key    = agrupado.ordem[i];
            var g      = agrupado.grupos[key];
            var pr     = g.primeira;
            var sem    = g.piorSemaforo || 'amarelo';
            var isExp  = !!estado.expandidos[i];

            // Linha do paciente
            html += '<tr class="row-pac' + (isExp ? ' expandido' : '') + '" data-idx="' + i + '">';
            html += '<td class="col-sem td-sem"><span class="sem-bar sem-' + sem + '"></span></td>';
            html += '<td class="col-atend"><strong>' + esc(pr.nr_atendimento) + '</strong></td>';
            html += '<td class="col-pac td-pac-nome">';
            html += '<div class="pac-header-cell">';
            html += '<i class="fas fa-chevron-right expand-icon"></i>';
            html += '<span class="pac-nome">' + esc(g.nome) + '</span>';
            if (g.autorizacoes.length > 1) {
                html += '<span class="pac-count">' + g.autorizacoes.length + '</span>';
            }
            html += '</div></td>';
            html += '<td class="col-conv" title="' + esc(pr.ds_convenio) + '">' + esc(pr.ds_convenio) + '</td>';
            html += '<td class="col-tguia col-resumo-pac" id="pac-resumo-' + i + '">';
            html += renderizarResumoPac(g, estado.pacienteCache[i] || null);
            html += '</td>';
            html += '<td class="col-setor" title="' + esc(pr.ds_setor_atendimento) + '">' + esc(pr.ds_setor_atendimento) + '</td>';
            html += '<td class="col-sla">' + badgeSla(g.piorSla) + '</td>';
            html += '</tr>';

            // Linha de detalhe do paciente (expandida por padrão)
            html += '<tr class="row-pac-detalhe' + (isExp ? '' : ' oculto') + '" data-idx="' + i + '">';
            html += '<td colspan="7" class="td-pac-detalhe">';
            if (isExp && estado.pacienteCache[i]) {
                html += htmlPacienteDetalhe(i, estado.pacienteCache[i], g);
            } else if (isExp) {
                html += '<div class="pac-loading"><div class="loading-spinner"></div> Carregando detalhe...</div>';
            }
            html += '</td></tr>';
        }

        DOM.tabelaTbody.innerHTML = html;

        // Bind expand clicks
        var linhasPac = DOM.tabelaTbody.querySelectorAll('.row-pac');
        for (var j = 0; j < linhasPac.length; j++) {
            linhasPac[j].addEventListener('click', (function (tr) {
                return function () { togglePaciente(parseInt(tr.getAttribute('data-idx'))); };
            })(linhasPac[j]));
        }

        // Enfileirar detalhes (máx MAX_DETALHES_PARALELOS simultâneos)
        estado._filaDetalhes     = [];
        estado._emFlightDetalhes = 0;
        for (var ai = 0; ai < agrupado.ordem.length; ai++) {
            if (estado.expandidos[ai] && !estado.pacienteCache[ai]) {
                enfileirarDetalhePaciente(ai);
            }
        }

        reiniciarScroll();
    }

    // ============================================================
    // VISÃO SINTÉTICA (POR SETOR)
    // ============================================================

    function renderizarSintetico(dados) {
        if (!dados.length) {
            DOM.resumoSintetico.innerHTML = '<div class="pac-vazio" style="grid-column: 1/-1; justify-content: center;"><i class="fas fa-inbox"></i> Nenhum dado para exibir.</div>';
            return;
        }

        var setores = {};
        for (var i = 0; i < dados.length; i++) {
            var d = dados[i];
            var nomeSetor = d.ds_setor_atendimento || 'Não Informado';
            if (!setores[nomeSetor]) {
                setores[nomeSetor] = {
                    nome: nomeSetor,
                    totalAut: 0,
                    pacientesSet: {},
                    atendimentosSet: {},
                    semDocs: 0,
                    tipos: {},
                    estagiosDiretos: {},
                    slaStatus: { verde: 0, amarelo: 0, vermelho: 0 }
                };
            }

            var s = setores[nomeSetor];
            s.totalAut++;

            var keyPac = (d.cd_pessoa_fisica !== null && d.cd_pessoa_fisica !== undefined)
                         ? String(d.cd_pessoa_fisica)
                         : ('__' + (d.nm_paciente || 'desconhecido'));
            s.pacientesSet[keyPac] = true;

            if (d.nr_atendimento) s.atendimentosSet[String(d.nr_atendimento)] = true;

            // Se não há qt_documentos ou é 0, considera sem docs
            if (!d.qt_documentos || d.qt_documentos === 0) {
                s.semDocs++;
            }

            var tipo = d.ds_tipo_autorizacao || 'Outros';
            s.tipos[tipo] = (s.tipos[tipo] || 0) + 1;

            var semCalcSint = calcularSemaforoPrazo(d.ds_estagio, d.horas_em_aberto);
            var dsEst = d.ds_estagio || 'Não Informado';
            if (!s.estagiosDiretos[dsEst]) s.estagiosDiretos[dsEst] = { count: 0, sem: semCalcSint };
            s.estagiosDiretos[dsEst].count++;

            s.slaStatus[semCalcSint] = (s.slaStatus[semCalcSint] || 0) + 1;
        }

        // Ordenar setores com mais autorizações primeiro
        var arraySetores = Object.keys(setores).map(function(k) { return setores[k]; });
        arraySetores.sort(function(a, b) { return b.totalAut - a.totalAut; });

        var html = '';
        for (var j = 0; j < arraySetores.length; j++) {
            var s = arraySetores[j];
            var qtdAtendimentos = Object.keys(s.atendimentosSet).length;

            html += '<div class="setor-card" data-setor="' + esc(s.nome) + '" style="cursor: pointer;" title="Clique para ver os detalhes na aba Autorizações">';

            // Header
            html += '<div class="setor-card-header">';
            html += '<div class="setor-icon"><i class="fas fa-layer-group"></i></div>';
            html += '<div class="setor-title">' + esc(s.nome) + '</div>';
            html += '</div>';

            // Body
            html += '<div class="setor-card-body">';

            // Totais
            html += '<div class="setor-stats-row">';
            html += '<div class="setor-stat"><span class="setor-stat-val">' + s.totalAut + '</span><span class="setor-stat-lbl">Autorizações</span></div>';
            html += '<div class="setor-stat"><span class="setor-stat-val">' + qtdAtendimentos + '</span><span class="setor-stat-lbl">Atendimentos</span></div>';
            html += '</div>';

            // SLA (5 dias) — tira compacta horizontal
            var temSla = s.slaStatus.verde + s.slaStatus.amarelo + s.slaStatus.vermelho;
            if (temSla > 0) {
                html += '<div class="setor-sla-strip">';
                if (s.slaStatus.verde > 0)    html += '<div class="sla-seg sla-seg-verde"><span class="sla-seg-num">' + s.slaStatus.verde + '</span><span class="sla-seg-lbl">No Prazo</span></div>';
                if (s.slaStatus.amarelo > 0)  html += '<div class="sla-seg sla-seg-amarelo"><span class="sla-seg-num">' + s.slaStatus.amarelo + '</span><span class="sla-seg-lbl">Atenção</span></div>';
                if (s.slaStatus.vermelho > 0) html += '<div class="sla-seg sla-seg-vermelho"><span class="sla-seg-num">' + s.slaStatus.vermelho + '</span><span class="sla-seg-lbl">Vencido</span></div>';
                html += '</div>';
            }

            // Estágios — lista vertical, Solicitado separado no topo
            var estKeys = Object.keys(s.estagiosDiretos).sort(function(a, b) {
                return s.estagiosDiretos[b].count - s.estagiosDiretos[a].count;
            });
            var solicitadoData = s.estagiosDiretos['Solicitado'] || null;
            var outrosEst = estKeys.filter(function(k) { return k !== 'Solicitado'; });

            if (estKeys.length > 0) {
                html += '<div class="setor-estagio-list">';

                if (solicitadoData) {
                    html += '<div class="est-row est-stop">';
                    html += '<span class="est-count">' + solicitadoData.count + '</span>';
                    html += '<span class="est-nome">Solicitado</span>';
                    html += '<span class="est-stop-tag">STOP</span>';
                    html += '</div>';
                    if (outrosEst.length > 0) {
                        html += '<div class="est-divider">Pendentes</div>';
                    }
                }

                var semToEstCls = { verde: 'est-verde', amarelo: 'est-amarelo', vermelho: 'est-vermelho' };
                for (var ek = 0; ek < outrosEst.length; ek++) {
                    var estK = outrosEst[ek];
                    var estD = s.estagiosDiretos[estK];
                    var estCls = semToEstCls[estD.sem] || 'est-neutro';
                    html += '<div class="est-row ' + estCls + '">';
                    html += '<span class="est-count">' + estD.count + '</span>';
                    html += '<span class="est-nome">' + esc(estK) + '</span>';
                    html += '</div>';
                }
                html += '</div>';
            }

            // Alerta sem docs
            if (s.semDocs > 0) {
                html += '<div class="setor-alert-docs">';
                html += '<span><i class="fas fa-file-excel"></i> Sem documentos</span>';
                html += '<span>' + s.semDocs + '</span>';
                html += '</div>';
            }

            // Tipos
            var tiposKeys = Object.keys(s.tipos).sort(function(a,b){return s.tipos[b]-s.tipos[a]});
            if (tiposKeys.length > 0) {
                html += '<div class="setor-breakdown">';
                html += '<div class="breakdown-title">Por Tipo</div>';
                for (var t = 0; t < tiposKeys.length; t++) {
                    var tKey = tiposKeys[t];
                    html += '<div class="breakdown-item">';
                    html += '<div class="breakdown-item-label"><div class="bd-color-dot" style="background:var(--cor-primaria)"></div> ' + esc(tKey) + '</div>';
                    html += '<div class="breakdown-item-val">' + s.tipos[tKey] + '</div>';
                    html += '</div>';
                }
                html += '</div>';
            }


            html += '</div>'; // close body
            html += '</div>'; // close card
        }

        DOM.resumoSintetico.innerHTML = html;
    }

    var MAX_DETALHES_PARALELOS = 3;

    function enfileirarDetalhePaciente(idx) {
        if (estado.pacienteCache[idx]) return;
        if (estado._filaDetalhes.indexOf(idx) === -1) {
            estado._filaDetalhes.push(idx);
        }
        _processarFilaDetalhes();
    }

    function _processarFilaDetalhes() {
        while (estado._emFlightDetalhes < MAX_DETALHES_PARALELOS && estado._filaDetalhes.length > 0) {
            var nextIdx = estado._filaDetalhes.shift();
            if (estado.pacienteCache[nextIdx]) { continue; }
            estado._emFlightDetalhes++;
            carregarDetalhePaciente(nextIdx, function () {
                estado._emFlightDetalhes = Math.max(0, estado._emFlightDetalhes - 1);
                _processarFilaDetalhes();
            });
        }
    }

    function carregarDetalhePaciente(idx, onComplete) {
        var key = estado.pacientesOrdem[idx];
        var g   = estado.pacientesGrupo[key];
        var cd  = g.cd;
        if (!cd) { if (onComplete) onComplete(); return; }
        var params = construirParams();
        params.cd  = String(cd);
        fetchComRetry(CONFIG.apiPaciente, params).then(function (resp) {
            if (resp.ok) {
                estado.pacienteCache[idx] = resp;
                var rowDet = DOM.tabelaTbody.querySelector('.row-pac-detalhe[data-idx="' + idx + '"]');
                if (rowDet && estado.expandidos[idx]) {
                    var td = rowDet.querySelector('.td-pac-detalhe');
                    if (td) {
                        td.innerHTML = htmlPacienteDetalhe(idx, resp, g);
                    }
                }
                var resumoCell = document.getElementById('pac-resumo-' + idx);
                if (resumoCell) resumoCell.innerHTML = renderizarResumoPac(g, resp);
            }
            if (onComplete) onComplete();
        }).catch(function () {
            if (onComplete) onComplete();
        });
    }

    // ============================================================
    // EXPAND / COLLAPSE PACIENTE
    // ============================================================

    function togglePaciente(idx) {
        var estava = !!estado.expandidos[idx];
        estado.expandidos[idx] = !estava;

        var rowPac = DOM.tabelaTbody.querySelector('.row-pac[data-idx="' + idx + '"]');
        var rowDet = DOM.tabelaTbody.querySelector('.row-pac-detalhe[data-idx="' + idx + '"]');
        if (!rowPac || !rowDet) return;

        if (estado.expandidos[idx]) {
            rowPac.classList.add('expandido');
            rowDet.classList.remove('oculto');

            if (!estado.pacienteCache[idx]) {
                // Buscar do servidor
                var key = estado.pacientesOrdem[idx];
                var g   = estado.pacientesGrupo[key];
                var cd  = g.cd;
                if (!cd) {
                    rowDet.querySelector('.td-pac-detalhe').innerHTML =
                        '<div class="pac-erro">Paciente sem ID cadastrado.</div>';
                    return;
                }
                var params = construirParams();
                params.cd  = String(cd);
                fetchComRetry(CONFIG.apiPaciente, params).then(function (resp) {
                    if (resp.ok) {
                        estado.pacienteCache[idx] = resp;
                        var td = rowDet.querySelector('.td-pac-detalhe');
                        if (td && estado.expandidos[idx]) {
                            td.innerHTML = htmlPacienteDetalhe(idx, resp, g);
                            vincularTabsPaciente(td, idx);
                        }
                        var resumoCell = document.getElementById('pac-resumo-' + idx);
                        if (resumoCell) resumoCell.innerHTML = renderizarResumoPac(g, resp);
                    } else {
                        rowDet.querySelector('.td-pac-detalhe').innerHTML =
                            '<div class="pac-erro">Erro: ' + esc(resp.detalhe || resp.erro) + '</div>';
                    }
                }).catch(function (err) {
                    rowDet.querySelector('.td-pac-detalhe').innerHTML =
                        '<div class="pac-erro">Falha: ' + esc(err.message) + '</div>';
                });
            } else {
                var td2 = rowDet.querySelector('.td-pac-detalhe');
                var key2 = estado.pacientesOrdem[idx];
                var g2   = estado.pacientesGrupo[key2];
                if (td2) {
                    td2.innerHTML = htmlPacienteDetalhe(idx, estado.pacienteCache[idx], g2);
                    vincularTabsPaciente(td2, idx);
                }
            }
        } else {
            rowPac.classList.remove('expandido');
            rowDet.classList.add('oculto');
        }
    }

    function temExpandido() {
        for (var k in estado.expandidos) {
            if (estado.expandidos[k]) return true;
        }
        return false;
    }

    // ============================================================
    // DETALHE DO PACIENTE (HTML)
    // ============================================================

    function htmlPacienteDetalhe(idx, resp, grupo) {
        var auts   = resp.autorizacoes   || [];
        var mats   = resp.materiais      || [];
        var procs  = resp.procedimentos  || [];
        var docs   = resp.documentos     || [];

        var html = '<div class="pac-detalhe-wrap">';

        // Nome do paciente no topo
        var primeiraAut = (auts.length ? auts[0] : grupo.primeira) || {};
        html += '<div class="pac-detalhe-nome">';
        html += '<i class="fas fa-user-circle"></i>';
        html += '<span class="nome-texto">' + esc(grupo.nome) + '</span>';
        if (primeiraAut.nr_atendimento) {
            html += '<span class="nome-atend">Atend. ' + esc(primeiraAut.nr_atendimento) + '</span>';
        }
        html += '</div>';

        // Montar set de atendimentos que possuem documento
        var docsAtendSet = {};
        for (var di = 0; di < docs.length; di++) {
            if (docs[di].nr_atendimento) {
                var dKey = String(docs[di].nr_atendimento);
                docsAtendSet[dKey] = true;
            }
        }

        var ESTAGIO_ENCERRADO = [
            'Autorizado',
            'Cancelado',
            'Negado',
            'Carência Contratual',
            'Autorizado (Aguard. Agendamento)',
            'Autorizado Parcialmente',
            'Sem Cobertura pelo Convênio'
        ];

        var qtdSemDoc = 0;
        for (var idxAut = 0; idxAut < auts.length; idxAut++) {
            var a = auts[idxAut];
            var isAtivo = ESTAGIO_ENCERRADO.indexOf(a.ds_estagio) === -1;
            if (isAtivo && !docsAtendSet[String(a.nr_atendimento)]) {
                qtdSemDoc++;
            }
        }

        // --- Seção: Autorizações ---
        html += '<div class="pac-section-header" data-action="toggle-subaba">';
        html += '<div class="pac-section-title"><i class="fas fa-shield-halved"></i> Autorizações <span class="section-count">' + auts.length + '</span>';
        if (qtdSemDoc > 0) {
            html += '<span class="badge badge-sem-doc pulsar" style="margin-left: 8px; font-size: 0.6rem; padding: 2px 6px;"><i class="fas fa-triangle-exclamation"></i> ' + qtdSemDoc + ' Sem Doc.</span>';
        }
        html += '</div>';
        html += '<i class="fas fa-chevron-down subaba-icon"></i></div>';
        html += '<div class="pac-section-content">';
        if (auts.length) {
            html += '<table class="pac-inner-table"><thead><tr>';
            html += '<th>Atend.</th><th>Convênio</th><th>Tipo Guia</th><th>Tipo Autor.</th><th>Estágio</th><th>Setor</th><th>Pedido Médico</th><th>Pedido</th><th>SLA</th><th>Doc.</th>';
            html += '</tr></thead><tbody>';
            for (var i = 0; i < auts.length; i++) {
                var a = auts[i];
                var atendKey = String(a.nr_atendimento);
                var solicitadoSemDoc = (ESTAGIO_ENCERRADO.indexOf(a.ds_estagio) === -1) && !docsAtendSet[atendKey];
                html += '<tr' + (solicitadoSemDoc ? ' class="row-sem-doc"' : '') + '>';
                html += '<td>' + esc(a.nr_atendimento) + '</td>';
                html += '<td>' + esc(a.ds_convenio) + '</td>';
                html += '<td>' + esc(a.ds_tipo_guia) + '</td>';
                html += '<td>' + esc(a.ds_tipo_autorizacao) + '</td>';
                html += '<td>' + badgeEstagio(a.ds_estagio, calcularSemaforoPrazo(a.ds_estagio, a.horas_em_aberto)) + '</td>';
                html += '<td>' + esc(a.ds_setor_atendimento) + '</td>';
                html += '<td>' + formatarDataHora(a.dt_autorizacao) + '</td>';
                html += '<td>' + formatarDataHora(a.dt_pedido_medico) + '</td>';
                html += '<td>' + badgeSla(a.status_sla) + '</td>';
                if (solicitadoSemDoc) {
                    html += '<td><span class="badge badge-sem-doc" title="Autorização em aberto sem documento anexado"><i class="fas fa-triangle-exclamation"></i> Sem Doc.</span></td>';
                } else {
                    html += '<td><span class="badge badge-doc-ok"><i class="fas fa-check"></i></span></td>';
                }
                html += '</tr>';
            }
            html += '</tbody></table>';
        } else {
            html += '<div class="pac-vazio"><i class="fas fa-inbox"></i> Nenhuma autorização</div>';
        }
        html += '</div>';

        // --- Seção: Procedimentos ---
        html += '<div class="pac-section-header" data-action="toggle-subaba">';
        html += '<div class="pac-section-title"><i class="fas fa-stethoscope"></i> Procedimentos <span class="section-count">' + procs.length + '</span></div>';
        html += '<i class="fas fa-chevron-down subaba-icon"></i></div>';
        html += '<div class="pac-section-content">';
        if (procs.length) {
            html += '<table class="pac-inner-table"><thead><tr>';
            html += '<th>Atend.</th><th>Procedimento</th><th>Cód. TUSS</th><th>Qt Sol.</th><th>Qt Aut.</th><th>Status Ops.</th>';
            html += '</tr></thead><tbody>';
            for (var k = 0; k < procs.length; k++) {
                var p = procs[k];
                html += '<tr>';
                html += '<td>' + esc(p.nr_atendimento) + '</td>';
                html += '<td>' + esc(p.ds_procedimento || p.ds_procedimento_tuss) + '</td>';
                html += '<td>' + esc(p.cd_procedimento_tuss) + '</td>';
                html += '<td>' + (p.qt_solicitada || '--') + '</td>';
                html += '<td>' + (p.qt_autorizada !== null && p.qt_autorizada !== undefined ? p.qt_autorizada : '--') + '</td>';
                html += '<td>' + esc(p.ds_status_pls) + '</td>';
                html += '</tr>';
            }
            html += '</tbody></table>';
        } else {
            html += '<div class="pac-vazio"><i class="fas fa-stethoscope"></i> Nenhum procedimento</div>';
        }
        html += '</div>';

        // --- Seção: Materiais ---
        html += '<div class="pac-section-header" data-action="toggle-subaba">';
        html += '<div class="pac-section-title"><i class="fas fa-box-open"></i> Materiais <span class="section-count">' + mats.length + '</span></div>';
        html += '<i class="fas fa-chevron-down subaba-icon"></i></div>';
        html += '<div class="pac-section-content">';
        if (mats.length) {
            html += '<table class="pac-inner-table"><thead><tr>';
            html += '<th>Atend.</th><th>Material</th><th>Cód.</th><th>Cód. TUSS</th><th>Qt Sol.</th><th>Qt Aut.</th><th>Vl Unit.</th><th>Status Ops.</th>';
            html += '</tr></thead><tbody>';
            for (var j = 0; j < mats.length; j++) {
                var m = mats[j];
                html += '<tr>';
                html += '<td>' + esc(m.nr_atendimento) + '</td>';
                html += '<td>' + esc(m.ds_material) + '</td>';
                html += '<td>' + esc(m.cd_material) + '</td>';
                html += '<td>' + esc(m.cd_material_tuss) + '</td>';
                html += '<td>' + (m.qt_solicitada || '--') + '</td>';
                html += '<td>' + (m.qt_autorizada !== null && m.qt_autorizada !== undefined ? m.qt_autorizada : '--') + '</td>';
                html += '<td>' + formatarMoeda(m.vl_unitario) + '</td>';
                html += '<td>' + esc(m.ds_status_ops) + '</td>';
                html += '</tr>';
            }
            html += '</tbody></table>';
        } else {
            html += '<div class="pac-vazio"><i class="fas fa-box-open"></i> Nenhum material</div>';
        }
        html += '</div>';

        // --- Seção: Documentos ---
        html += '<div class="pac-section-header" data-action="toggle-subaba">';
        html += '<div class="pac-section-title"><i class="fas fa-paperclip"></i> Documentos <span class="section-count">' + docs.length + '</span></div>';
        html += '<i class="fas fa-chevron-down subaba-icon"></i></div>';
        html += '<div class="pac-section-content">';
        if (docs.length) {
            html += '<table class="pac-inner-table"><thead><tr>';
            html += '<th>Atend.</th><th>Tipo Anexo</th><th>Arquivo</th><th>Data</th><th>Obs. Operadora</th><th>Protocolo</th>';
            html += '</tr></thead><tbody>';
            for (var l = 0; l < docs.length; l++) {
                var d = docs[l];
                var temAnexo = !!(d.ds_arquivo || d.ds_arquivo_grid);
                html += '<tr>';
                html += '<td>' + esc(d.nr_atendimento) + '</td>';
                html += '<td>' + esc(d.ds_tipo_anexo) + '</td>';
                html += '<td><span class="doc-anexo' + (temAnexo ? ' tem-arquivo' : ' sem-arquivo') + '">'
                    + '<i class="fas ' + (temAnexo ? 'fa-paperclip' : 'fa-minus') + '"></i> '
                    + esc(d.ds_arquivo_grid || (temAnexo ? 'Anexado' : 'Sem anexo'))
                    + '</span></td>';
                html += '<td>' + formatarDataHora(d.dt_atualizacao) + '</td>';
                html += '<td>' + esc(d.ds_observacao_operadora) + '</td>';
                html += '<td>' + esc(d.nr_protoc_rec_operadora) + '</td>';
                html += '</tr>';
            }
            html += '</tbody></table>';
        } else {
            html += '<div class="pac-vazio"><i class="fas fa-paperclip"></i> Nenhum documento</div>';
        }
        html += '</div>';

        html += '</div>'; // pac-detalhe-wrap
        return html;
    }

    function vincularTabsPaciente(container, idx) {
        // Seções unificadas - não precisa mais vincular tabs
    }

    // ============================================================
    // RESUMO DO PACIENTE (CÉLULA PRINCIPAL)
    // ============================================================

    function renderizarResumoPac(grupo, cacheResp) {
        var html = '<div class="pac-resumo-wrap">';
        html += '<span class="badge-resumo-item badge-resumo-aut" title="Autorizações">';
        html += '<i class="fas fa-shield-halved"></i> ' + grupo.autorizacoes.length + ' aut.';
        html += '</span>';
        if (cacheResp) {
            var procs = (cacheResp.procedimentos || []).length;
            var mats  = (cacheResp.materiais     || []).length;
            var docs  = (cacheResp.documentos    || []).length;
            if (procs > 0) {
                html += '<span class="badge-resumo-item badge-resumo-proc" title="Procedimentos">';
                html += '<i class="fas fa-stethoscope"></i> ' + procs + ' proc.';
                html += '</span>';
            }
            if (mats > 0) {
                html += '<span class="badge-resumo-item badge-resumo-mat" title="Materiais">';
                html += '<i class="fas fa-box-open"></i> ' + mats + ' mat.';
                html += '</span>';
            }
            if (docs > 0) {
                html += '<span class="badge-resumo-item badge-resumo-doc" title="Documentos">';
                html += '<i class="fas fa-paperclip"></i> ' + docs + ' doc.';
                html += '</span>';
            }
        }
        html += '</div>';
        return html;
    }

    // ============================================================
    // ORDENACAO
    // ============================================================

    function atualizarIconesOrdem() {
        var ths = document.querySelectorAll('.painel-table thead th.sortable');
        for (var i = 0; i < ths.length; i++) {
            ths[i].classList.remove('sort-asc', 'sort-desc');
            if (ths[i].getAttribute('data-campo') === estado.ordemCampo) {
                ths[i].classList.add('sort-' + estado.ordemDir);
            }
        }
    }

    // ============================================================
    // EXPORT CSV
    // ============================================================

    function exportarCSV() {
        var params = construirParams();
        var qs = Object.keys(params).map(function (k) {
            return encodeURIComponent(k) + '=' + encodeURIComponent(params[k]);
        }).join('&');
        var link = document.createElement('a');
        link.href = CONFIG.apiExport + (qs ? '?' + qs : '');
        link.click();
        mostrarToast('Exportação iniciada', 'sucesso');
    }

    // ============================================================
    // AUTO-SCROLL WATCHDOG (opera no tbody)
    // ============================================================

    function iniciarScrollAutomatico() {
        pararScrollAutomatico();
        if (estado.autoscrollDesativado || estado.filtrosVisiveis) return;
        var el = DOM.tabelaTbody;
        if (!el) return;
        if (el.scrollHeight - el.clientHeight <= 5) return;

        estado.watchdog = { ultimaPosicao: el.scrollTop, contadorTravamento: 0 };
        iniciarWatchdog();

        estado.intervalos.scroll = setInterval(function() {
            if (estado.autoscrollDesativado || estado.filtrosVisiveis) { pararScrollAutomatico(); return; }
            var e = DOM.tabelaTbody;
            if (!e) { pararScrollAutomatico(); return; }
            var sm = e.scrollHeight - e.clientHeight;

            if (e.scrollTop >= sm - 2) {
                clearInterval(estado.intervalos.scroll);
                estado.intervalos.scroll = null;
                setTimeout(function() {
                    if (estado.autoscrollDesativado) return;
                    e.scrollTop = 0;
                    estado.watchdog.ultimaPosicao = 0;
                    estado.watchdog.contadorTravamento = 0;
                    setTimeout(function() {
                        if (!estado.autoscrollDesativado) iniciarScrollAutomatico();
                    }, CONFIG.pausaAposReset);
                }, CONFIG.pausaNoFinal);
                return;
            }
            e.scrollTop += CONFIG.scrollPasso;
        }, CONFIG.scrollIntervalo);
    }

    function pararScrollAutomatico() {
        if (estado.intervalos.scroll) {
            clearInterval(estado.intervalos.scroll);
            estado.intervalos.scroll = null;
        }
        pararWatchdog();
    }

    function iniciarWatchdog() {
        pararWatchdog();
        estado.intervalos.watchdog = setInterval(function() {
            if (estado.autoscrollDesativado) { pararWatchdog(); return; }
            var e = DOM.tabelaTbody;
            if (!e) return;
            var p = e.scrollTop;
            var sm = e.scrollHeight - e.clientHeight;
            if (p > 5 && p < sm - 5 && Math.abs(p - estado.watchdog.ultimaPosicao) < 1 && estado.intervalos.scroll !== null) {
                estado.watchdog.contadorTravamento++;
                if (estado.watchdog.contadorTravamento >= CONFIG.watchdogMax) {
                    if (estado.intervalos.scroll) clearInterval(estado.intervalos.scroll);
                    estado.intervalos.scroll = null;
                    setTimeout(function() {
                        if (!estado.autoscrollDesativado) {
                            estado.watchdog.contadorTravamento = 0;
                            iniciarScrollAutomatico();
                        }
                    }, 1000);
                    return;
                }
            } else {
                estado.watchdog.contadorTravamento = 0;
            }
            estado.watchdog.ultimaPosicao = p;
        }, CONFIG.watchdogInterval);
    }

    function pararWatchdog() {
        if (estado.intervalos.watchdog) {
            clearInterval(estado.intervalos.watchdog);
            estado.intervalos.watchdog = null;
        }
    }

    function reiniciarScroll() {
        pararScrollAutomatico();
        if (!estado.filtrosVisiveis && !estado.autoscrollDesativado) {
            setTimeout(iniciarScrollAutomatico, 600);
        }
    }

    function toggleAutoscroll() {
        if (estado.autoscrollDesativado) {
            estado.autoscrollDesativado = false;
            DOM.btnAutoscroll.classList.add('ativo');
            DOM.btnAutoscroll.querySelector('i').className = 'fas fa-arrows-up-down';
            DOM.btnAutoscroll.title = 'Parar Auto-scroll';
            if (!estado.filtrosVisiveis) {
                iniciarScrollAutomatico();
            }
            mostrarToast('Auto-scroll ativado', 'sucesso');
        } else {
            estado.autoscrollDesativado = true;
            pararScrollAutomatico();
            DOM.btnAutoscroll.classList.remove('ativo');
            DOM.btnAutoscroll.querySelector('i').className = 'fas fa-pause';
            DOM.btnAutoscroll.title = 'Iniciar Auto-scroll';
            mostrarToast('Auto-scroll desativado', 'aviso');
        }
        salvarEstadoLocal();
    }

    // ============================================================
    // FORMATADORES / HELPERS
    // ============================================================

    function esc(v) {
        if (v === null || v === undefined) return '';
        return String(v).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
    }

    function formatarDataHora(v) {
        if (!v) return '--';
        try {
            var d = new Date(v);
            return pad(d.getDate()) + '/' + pad(d.getMonth() + 1) + '/' + d.getFullYear()
                + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
        } catch (e) { return v; }
    }

    function pad(n) { return n < 10 ? '0' + n : '' + n; }

    function formatarMoeda(v) {
        if (v === null || v === undefined || v === '') return '--';
        var n = parseFloat(v);
        if (isNaN(n)) return '--';
        return 'R$\u00a0' + n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }

    function badgeGrupo(grupo, estagio) {
        var mapa = {
            autorizado:    { cls: 'badge-autorizado',    label: 'Autorizado' },
            aguardando:    { cls: 'badge-aguardando',    label: 'Aguardando' },
            acao_hospital: { cls: 'badge-acao-hospital', label: 'Ação Hosp.' },
            negado:        { cls: 'badge-negado',        label: 'Negado' },
            outros:        { cls: 'badge-outros',        label: 'Outros' }
        };
        var info  = (grupo && mapa[grupo]) ? mapa[grupo] : { cls: 'badge-outros', label: grupo || '--' };
        var label = estagio ? esc(estagio) : info.label;
        return '<span class="badge ' + info.cls + '" title="' + label + '">' + label + '</span>';
    }

    function badgeEstagio(estagio, semaforo) {
        var mapa = {
            verde:     'badge-autorizado',
            amarelo:   'badge-aguardando',
            laranja:   'badge-acao-hospital',
            vermelho:  'badge-negado',
            encerrado: 'badge-outros'
        };
        var cls   = mapa[semaforo] || 'badge-outros';
        var label = esc(estagio || '--');
        return '<span class="badge ' + cls + '" title="' + label + '">' + label + '</span>';
    }

    function badgeSla(s) {
        if (!s) return '--';
        var mapa = {
            dentro:     { cls: 'badge-sla-dentro',     label: 'No Prazo' },
            atencao:    { cls: 'badge-sla-atencao',    label: 'Atenção' },
            atrasado:   { cls: 'badge-sla-atrasado',   label: 'Atrasado' },
            sem_pedido: { cls: 'badge-sla-sem-pedido', label: 'Sem Pedido' }
        };
        var info = mapa[s] || { cls: 'badge-outros', label: s };
        return '<span class="badge ' + info.cls + '">' + info.label + '</span>';
    }

    // SLA prazo: 5 dias corridos. Solicitado = STOP, sempre verde.
    function calcularSemaforoPrazo(estagio, horasEmAberto) {
        if (estagio === 'Solicitado') return 'verde';
        var horas = parseFloat(horasEmAberto) || 0;
        if (horas >= 120) return 'vermelho'; // vencido
        if (horas >= 48)  return 'amarelo';  // dentro de 3 dias do vencimento
        return 'verde';
    }

    function setStatusIndicator(st) {
        if (DOM.statusIndicator) DOM.statusIndicator.className = 'status-indicator ' + st;
    }

    function atualizarHora() {
        var agora = new Date();
        DOM.ultimaAtualizacao.textContent = pad(agora.getHours()) + ':' + pad(agora.getMinutes());
    }

    // ============================================================
    // VISÃO GERAL
    // ============================================================

    function calcularUrgencia(estagio, horas) {
        if (estagio === 'Solicitado') return 'sol';
        var h = parseFloat(horas) || 0;
        if (h >= 120) return 'ven';
        if (h >= 96)  return 'ate';
        if (h >= 48)  return 'amarelo';
        return 'verde';
    }

    function carregarVisaoGeral() {
        fetchComRetry(CONFIG.apiVisaoGeral, construirParams()).then(function (resp) {
            if (!resp.ok) return;
            if (resp.is_admin !== undefined) {
                estado.isAdmin = !!resp.is_admin;
                if (DOM.tabBtnValores) DOM.tabBtnValores.style.display = estado.isAdmin ? '' : 'none';
            }
            renderizarKpisVG(resp.kpis || {});
            renderizarConveniosVG(resp.convenios || []);
            renderizarAnaliticaVG(resp.analitica || []);
        }).catch(function () {
            DOM.vgKpis.innerHTML = '<div class="pac-vazio"><i class="fas fa-exclamation-triangle"></i> Falha ao carregar.</div>';
        });
    }

    function renderizarKpisVG(k) {
        var cards = [
            {
                cls: 'vgk-sol', icon: 'fa-pause-circle',
                lbl: 'Solicitado', sub: 'Aguardando resposta da operadora',
                qt: k.qt_solicitado || 0, vl: k.vl_solicitado || 0
            },
            {
                cls: 'vgk-ate', icon: 'fa-triangle-exclamation',
                lbl: 'Atenção', sub: 'Vencendo em até 24h',
                qt: k.qt_atencao || 0, vl: k.vl_atencao || 0
            },
            {
                cls: 'vgk-ven', icon: 'fa-circle-xmark',
                lbl: 'Vencido', sub: 'SLA expirado (≥ 120h)',
                qt: k.qt_vencido || 0, vl: k.vl_vencido || 0
            }
        ];
        var html = '';
        for (var i = 0; i < cards.length; i++) {
            var c = cards[i];
            html += '<div class="vg-kpi-card ' + c.cls + '">';
            html += '<div class="vg-kpi-icon"><i class="fas ' + c.icon + '"></i></div>';
            html += '<div class="vg-kpi-body">';
            html += '<div class="vg-kpi-header">' + esc(c.lbl) + '</div>';
            html += '<div class="vg-kpi-num">' + c.qt + '</div>';
            html += '<div class="vg-kpi-sub">' + formatarBRL(c.vl) + '</div>';
            html += '<div class="vg-kpi-sub">' + esc(c.sub) + '</div>';
            html += '</div></div>';
        }
        DOM.vgKpis.innerHTML = html;
    }

    function renderizarConveniosVG(rows) {
        if (!rows.length) {
            DOM.vgConveniosTbody.innerHTML = '<tr><td colspan="5" style="padding:12px;text-align:center;color:#999;font-size:.75rem"><i class="fas fa-inbox"></i> Nenhum dado no período.</td></tr>';
            return;
        }
        var html = '';
        for (var i = 0; i < rows.length; i++) {
            var r = rows[i];
            html += '<tr>';
            html += '<td class="vg-conv-nome">' + esc(r.ds_convenio || '—') + '</td>';
            html += '<td class="vg-conv-cell"><span class="vg-conv-qt" style="color:#495057">' + (r.qt_total || 0) + '</span></td>';
            html += '<td class="vg-conv-cell">';
            html += '<span class="vg-conv-qt vg-conv-qt-sol">' + (r.qt_solicitado || 0) + '</span>';
            html += '<span class="vg-conv-vl">' + formatarBRL(r.vl_solicitado, true) + '</span>';
            html += '</td>';
            html += '<td class="vg-conv-cell">';
            html += '<span class="vg-conv-qt vg-conv-qt-ate">' + (r.qt_atencao || 0) + '</span>';
            html += '<span class="vg-conv-vl">' + formatarBRL(r.vl_atencao, true) + '</span>';
            html += '</td>';
            html += '<td class="vg-conv-cell">';
            html += '<span class="vg-conv-qt vg-conv-qt-ven">' + (r.qt_vencido || 0) + '</span>';
            html += '<span class="vg-conv-vl">' + formatarBRL(r.vl_vencido, true) + '</span>';
            html += '</td>';
            html += '</tr>';
        }
        DOM.vgConveniosTbody.innerHTML = html;
    }

    function renderizarAnaliticaVG(rows) {
        if (!rows.length) {
            DOM.vgAnaliticaTbody.innerHTML = '<tr><td colspan="8" style="padding:12px;text-align:center;color:#999;font-size:.75rem"><i class="fas fa-inbox"></i> Nenhuma autorização.</td></tr>';
            return;
        }
        var html = '';
        for (var i = 0; i < rows.length; i++) {
            var r = rows[i];
            var urg = calcularUrgencia(r.ds_estagio, r.horas_em_aberto);
            var rowCls = urg === 'ven' ? 'vg-row-ven' : (urg === 'ate' ? 'vg-row-ate' : '');
            var badgeCls = 'vg-badge vg-badge-' + urg;
            var semDot = 'vg-sem-' + (urg === 'ven' ? 'vermelho' : (urg === 'ate' || urg === 'amarelo' ? 'amarelo' : 'verde'));
            var horas = parseFloat(r.horas_em_aberto) || 0;
            var prazoStr, prazoCls;
            if (r.ds_estagio === 'Solicitado') {
                prazoStr = '—';
                prazoCls = 'color:#aaa';
            } else {
                var diasRestantes = (120 - horas) / 24;
                if (diasRestantes <= 0) {
                    prazoStr = 'Vencido';
                    prazoCls = 'color:#c62828;font-weight:700';
                } else if (diasRestantes < 1) {
                    prazoStr = Math.round(diasRestantes * 24) + 'h';
                    prazoCls = 'color:#e65100;font-weight:700';
                } else {
                    prazoStr = diasRestantes.toFixed(1).replace('.', ',') + 'd';
                    prazoCls = diasRestantes <= 1 ? 'color:#e65100;font-weight:600' : 'color:#2e7d32';
                }
            }
            var dtPedido = r.dt_pedido_medico ? formatarData(r.dt_pedido_medico) : '—';
            var qtAutor = parseInt(r.qt_autorizacoes) || 1;
            var qtBadge = qtAutor > 1
                ? ' <span style="display:inline-block;background:#e9ecef;color:#495057;border-radius:99px;padding:0 5px;font-size:.62rem;font-weight:700;vertical-align:middle">' + qtAutor + '</span>'
                : '';

            html += '<tr class="' + rowCls + '">';
            html += '<td><span class="vg-sem-dot ' + semDot + '"></span></td>';
            html += '<td><div style="font-weight:600;font-size:.75rem">' + esc(r.nm_paciente || '—') + qtBadge + '</div><div style="font-size:.67rem;color:#888">Atend. ' + (r.nr_atendimento || '—') + '</div></td>';
            html += '<td style="font-size:.72rem">' + esc(r.ds_convenio || '—') + '</td>';
            html += '<td><span class="' + badgeCls + '">' + esc(r.ds_estagio || '—') + '</span></td>';
            html += '<td style="font-size:.7rem">' + esc(r.ds_setor_atendimento || '—') + '</td>';
            html += '<td style="font-size:.7rem">' + dtPedido + '</td>';
            html += '<td class="tc" style="font-size:.7rem;' + prazoCls + '">' + prazoStr + '</td>';
            var respStr = r.responsavel || '—';
            html += '<td><span class="vg-resp-nome" title="' + esc(respStr) + '">' + esc(respStr) + '</span></td>';
            html += '</tr>';
        }
        DOM.vgAnaliticaTbody.innerHTML = html;
    }

    // ============================================================
    // CRUD: RESPONSÁVEIS POR CONVÊNIO
    // ============================================================

    var CONFIG_RESP = {
        apiListar:  '/api/paineis/painel33/responsaveis',
        apiSalvar:  '/api/paineis/painel33/responsaveis/salvar',
        apiExcluir: '/api/paineis/painel33/responsaveis/excluir'
    };

    function abrirModalResponsaveis() {
        DOM.modalResp.classList.add('aberto');
        DOM.modalRespOverlay.classList.add('aberto');
        carregarResponsaveis();
    }

    function fecharModalResponsaveis() {
        DOM.modalResp.classList.remove('aberto');
        DOM.modalRespOverlay.classList.remove('aberto');
    }

    function carregarResponsaveis() {
        DOM.modalRespBody.innerHTML = '<div class="loading"><div class="loading-spinner"></div></div>';
        fetchComRetry(CONFIG_RESP.apiListar, {}).then(function (resp) {
            if (!resp.ok) {
                DOM.modalRespBody.innerHTML = '<div class="pac-vazio">Erro ao carregar responsáveis.</div>';
                return;
            }
            renderizarResponsaveis(resp.responsaveis || []);
        }).catch(function () {
            DOM.modalRespBody.innerHTML = '<div class="pac-vazio">Falha de conexão.</div>';
        });
    }

    function renderizarResponsaveis(lista) {
        var html = '<div class="mr-list-wrap">';
        html += '<div class="mr-list-header">';
        html += '<span>Responsáveis cadastrados</span>';
        html += '<button class="mr-btn-novo" id="mr-btn-novo"><i class="fas fa-plus"></i> Novo</button>';
        html += '</div>';

        if (!lista.length) {
            html += '<div class="mr-empty"><i class="fas fa-user-slash"></i> Nenhum responsável cadastrado.</div>';
        } else {
            html += '<table class="mr-table"><thead><tr><th>Nome</th><th>Convênios</th><th></th></tr></thead><tbody>';
            for (var i = 0; i < lista.length; i++) {
                var r = lista[i];
                var convs = r.convenios || [];
                var pillsHtml = '';
                for (var j = 0; j < convs.length; j++) {
                    pillsHtml += '<span class="mr-conv-pill">' + esc(convs[j]) + '</span>';
                }
                html += '<tr>';
                html += '<td class="mr-nome">' + esc(r.nm_responsavel) + '</td>';
                html += '<td>' + (pillsHtml || '<span style="color:#aaa;font-size:.72rem">—</span>') + '</td>';
                html += '<td class="mr-acoes">'
                    + '<button class="mr-btn-acao mr-btn-editar" data-nome="' + esc(r.nm_responsavel) + '" data-convs="' + esc(JSON.stringify(convs)) + '" title="Editar"><i class="fas fa-pencil"></i></button>'
                    + '<button class="mr-btn-acao mr-btn-excluir" data-nome="' + esc(r.nm_responsavel) + '" title="Excluir"><i class="fas fa-trash"></i></button>'
                    + '</td>';
                html += '</tr>';
            }
            html += '</tbody></table>';
        }
        html += '</div>';
        html += '<div id="mr-form-wrap"></div>';
        DOM.modalRespBody.innerHTML = html;

        document.getElementById('mr-btn-novo').addEventListener('click', function () {
            mostrarFormResponsavel(null, []);
        });

        var btnsEditar = DOM.modalRespBody.querySelectorAll('.mr-btn-editar');
        for (var e = 0; e < btnsEditar.length; e++) {
            btnsEditar[e].addEventListener('click', (function (btn) {
                return function () {
                    var nome = btn.getAttribute('data-nome');
                    var convs = JSON.parse(btn.getAttribute('data-convs') || '[]');
                    mostrarFormResponsavel(nome, convs);
                };
            })(btnsEditar[e]));
        }

        var btnsExcluir = DOM.modalRespBody.querySelectorAll('.mr-btn-excluir');
        for (var x = 0; x < btnsExcluir.length; x++) {
            btnsExcluir[x].addEventListener('click', (function (btn) {
                return function () {
                    excluirResponsavel(btn.getAttribute('data-nome'));
                };
            })(btnsExcluir[x]));
        }
    }

    function mostrarFormResponsavel(nomeAtual, convsAtuais) {
        var formWrap = document.getElementById('mr-form-wrap');
        if (!formWrap) return;

        // Obter lista de convênios disponíveis do multi-select
        var convDisp = [];
        var msConvEl = document.getElementById('ms-convenio');
        if (msConvEl) {
            var opts = msConvEl.querySelectorAll('.multi-select-checkbox');
            for (var i = 0; i < opts.length; i++) {
                convDisp.push(opts[i].value);
            }
        }

        var checksHtml = '';
        if (!convDisp.length) {
            checksHtml = '<p style="font-size:.75rem;color:#888">Nenhum convênio disponível. Atualize os filtros primeiro.</p>';
        } else {
            for (var j = 0; j < convDisp.length; j++) {
                var checked = convsAtuais.indexOf(convDisp[j]) !== -1 ? ' checked' : '';
                checksHtml += '<label class="mr-check-item">'
                    + '<input type="checkbox" class="mr-conv-cb" value="' + esc(convDisp[j]) + '"' + checked + '>'
                    + '<span>' + esc(convDisp[j]) + '</span>'
                    + '</label>';
            }
        }

        var titulo = nomeAtual ? 'Editar: ' + nomeAtual : 'Novo Responsável';
        formWrap.innerHTML = '<div class="mr-form">'
            + '<div class="mr-form-title">' + esc(titulo) + '</div>'
            + '<label class="mr-form-label">Nome do Responsável</label>'
            + '<input type="text" id="mr-input-nome" class="mr-input" placeholder="Ex: Maria Silva" value="' + esc(nomeAtual || '') + '" ' + (nomeAtual ? 'readonly' : '') + '>'
            + '<label class="mr-form-label">Convênios</label>'
            + '<div class="mr-conv-checks">' + checksHtml + '</div>'
            + '<div class="mr-form-btns">'
            + '<button class="mr-btn-salvar" id="mr-btn-salvar"><i class="fas fa-save"></i> Salvar</button>'
            + '<button class="mr-btn-cancelar" id="mr-btn-cancelar"><i class="fas fa-times"></i> Cancelar</button>'
            + '</div>'
            + '</div>';

        document.getElementById('mr-btn-salvar').addEventListener('click', function () {
            salvarResponsavel(nomeAtual);
        });
        document.getElementById('mr-btn-cancelar').addEventListener('click', function () {
            formWrap.innerHTML = '';
        });

        formWrap.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }

    function salvarResponsavel(nomeOriginal) {
        var nomeInput = document.getElementById('mr-input-nome');
        if (!nomeInput) return;
        var nome = nomeInput.value.trim();
        if (!nome) { mostrarToast('Informe o nome do responsável.', 'aviso'); return; }

        var cbs = document.querySelectorAll('.mr-conv-cb:checked');
        var convs = [];
        for (var i = 0; i < cbs.length; i++) convs.push(cbs[i].value);

        var payload = { nm_responsavel: nome, convenios: convs };

        fetch(CONFIG_RESP.apiSalvar, {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        }).then(function (r) { return r.json(); }).then(function (resp) {
            if (!resp.ok) { mostrarToast('Erro: ' + (resp.erro || ''), 'erro'); return; }
            mostrarToast('Responsável salvo com sucesso.', 'sucesso');
            carregarResponsaveis();
            carregarVisaoGeral();
        }).catch(function () {
            mostrarToast('Falha ao salvar.', 'erro');
        });
    }

    function excluirResponsavel(nome) {
        if (!confirm('Excluir responsável "' + nome + '"?')) return;
        fetch(CONFIG_RESP.apiExcluir, {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ nm_responsavel: nome })
        }).then(function (r) { return r.json(); }).then(function (resp) {
            if (!resp.ok) { mostrarToast('Erro: ' + (resp.erro || ''), 'erro'); return; }
            mostrarToast('Responsável excluído.', 'sucesso');
            carregarResponsaveis();
            carregarVisaoGeral();
        }).catch(function () {
            mostrarToast('Falha ao excluir.', 'erro');
        });
    }

    // ============================================================
    // FORMATADORES FINANCEIROS
    // ============================================================

    function formatarBRL(v, semCentavos) {
        if (v === null || v === undefined || v === '') return '--';
        var n = parseFloat(v);
        if (isNaN(n)) return '--';
        if (semCentavos) {
            return 'R$ ' + n.toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
        }
        return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
    }

    function formatarData(v) {
        if (!v) return '--';
        try {
            var d = new Date(v);
            return pad(d.getDate()) + '/' + pad(d.getMonth() + 1) + '/' + d.getFullYear();
        } catch (e) { return v; }
    }

    // ============================================================
    // ABA: VALORES PENDENTES — DASHBOARD
    // ============================================================

    function construirParamsValores(extra) {
        var p = construirParams();
        if (estado.valoresFiltros.vlMinimo > 0)       p.vl_minimo        = estado.valoresFiltros.vlMinimo;
        if (estado.valoresFiltros.apenasAltoRisco)    p.apenas_alto_risco = '1';
        if (estado.valoresFiltros.apenasComConta)     p.apenas_com_conta  = '1';
        if (extra) { for (var k in extra) p[k] = extra[k]; }
        return p;
    }

    function carregarValoresDashboard() {
        DOM.valoresKpis.innerHTML = '<div class="loading"><div class="loading-spinner"></div><p>Carregando KPIs...</p></div>';
        fetchComRetry(CONFIG.apiValoresDash, construirParams()).then(function (resp) {
            if (!resp.ok) {
                DOM.valoresKpis.innerHTML = '<div class="loading">Erro ao carregar KPIs.</div>';
                return;
            }
            renderizarKpisValores(resp.kpis);
            renderizarBarras(DOM.valoresChartConv, resp.top_convenios, 'ds_convenio', 'vl_pendente');
            renderizarBarras(DOM.valoresChartSet,  resp.top_setores,   'ds_setor',    'vl_pendente');
        }).catch(function () {
            DOM.valoresKpis.innerHTML = '<div class="loading">Falha de conexão.</div>';
        });
    }

    function renderizarKpisValores(k) {
        var kpis = [
            { cls: 'kpi-total',       icon: 'fa-money-bill-trend-up',   val: formatarBRL(k.vl_total_pendente_geral),            lbl: 'Valor Pendente Total' },
            { cls: 'kpi-acao',        icon: 'fa-triangle-exclamation',  val: formatarBRL(k.vl_total_pendente_acao_hospital),    lbl: 'Pendente — Ação Hospital' },
            { cls: 'kpi-aguardando',  icon: 'fa-hourglass-half',        val: formatarBRL(k.vl_total_pendente_aguardando),       lbl: 'Pendente — Aguard. Operadora' },
            { cls: 'kpi-risco',       icon: 'fa-fire',                  val: (k.qt_autorizacoes_alto_risco || 0) + ' autorizações', lbl: 'Alto Risco (> R$10k)' },
            { cls: 'kpi-contas',      icon: 'fa-file-invoice-dollar',   val: formatarBRL(k.vl_em_contas_abertas),               lbl: 'Total em Contas Abertas' },
            { cls: 'kpi-medio',       icon: 'fa-calculator',            val: formatarBRL(k.vl_medio),                          lbl: 'Ticket Médio / Autorização' }
        ];
        var html = '';
        for (var i = 0; i < kpis.length; i++) {
            var c = kpis[i];
            html += '<div class="vkpi-card ' + c.cls + '">';
            html += '<div class="vkpi-icon"><i class="fas ' + c.icon + '"></i></div>';
            html += '<div class="vkpi-body">';
            html += '<span class="vkpi-val">' + esc(c.val) + '</span>';
            html += '<span class="vkpi-lbl">' + esc(c.lbl) + '</span>';
            html += '</div></div>';
        }
        DOM.valoresKpis.innerHTML = html;
    }

    function renderizarBarras(containerEl, items, labelKey, valKey) {
        if (!containerEl) return;
        if (!items || !items.length) {
            containerEl.innerHTML = '<div class="chart-empty">Sem dados</div>';
            return;
        }
        var max = 0;
        for (var i = 0; i < items.length; i++) {
            var v = parseFloat(items[i][valKey]) || 0;
            if (v > max) max = v;
        }
        if (max === 0) max = 1;
        var html = '';
        for (var j = 0; j < items.length; j++) {
            var row = items[j];
            var val = parseFloat(row[valKey]) || 0;
            var pct = Math.round((val / max) * 100);
            html += '<div class="chart-row">';
            html += '<span class="chart-lbl" title="' + esc(row[labelKey]) + '">' + esc(row[labelKey] || '—') + '</span>';
            html += '<div class="chart-bar-track"><div class="chart-bar-fill" style="width:' + pct + '%"></div></div>';
            html += '<span class="chart-val">' + formatarBRL(val) + '</span>';
            html += '</div>';
        }
        containerEl.innerHTML = html;
    }

    // ============================================================
    // ABA: VALORES PENDENTES — LISTA
    // ============================================================

    function carregarValoresLista(pagina) {
        pagina = pagina || 1;
        estado.valoresPagina = pagina;
        if (DOM.valoresTbody) {
            DOM.valoresTbody.innerHTML = '<tr><td colspan="12" class="loading-cell"><div class="loading-spinner"></div> Carregando...</td></tr>';
        }
        var params = construirParamsValores({ pagina: pagina, por_pagina: 100 });
        fetchComRetry(CONFIG.apiValoresLista, params).then(function (resp) {
            if (!resp.ok) {
                if (DOM.valoresTbody) DOM.valoresTbody.innerHTML = '<tr><td colspan="12" class="loading-cell">Erro ao carregar.</td></tr>';
                return;
            }
            estado.valoresTotalPag = resp.total_paginas || 1;
            renderizarTabelaValores(resp.items || [], resp.total || 0);
            renderizarPaginacaoValores(pagina, resp.total_paginas || 1, resp.total || 0);
        }).catch(function (err) {
            if (DOM.valoresTbody) DOM.valoresTbody.innerHTML = '<tr><td colspan="12" class="loading-cell">Falha: ' + esc(err.message) + '</td></tr>';
        });
    }

    function renderizarTabelaValores(items, total) {
        if (DOM.valoresPagLabel) {
            DOM.valoresPagLabel.textContent = total + ' registro' + (total !== 1 ? 's' : '');
        }
        if (!items.length) {
            DOM.valoresTbody.innerHTML = '<tr><td colspan="12" class="loading-cell" style="padding:2rem">Nenhum registro encontrado.</td></tr>';
            return;
        }
        var html = '';
        for (var i = 0; i < items.length; i++) {
            var d = items[i];
            var semCls = calcularSemaforoPrazo(d.ds_estagio, d.horas_em_aberto);
            var altoRisco = d.flag_alto_risco;
            var vlPend = parseFloat(d.vl_pendente_autorizacao) || 0;
            var rowCls = altoRisco ? ' class="vt-row-risco"' : '';

            // Conta / Período
            var contaHtml;
            if (d.nr_interno_conta) {
                contaHtml = '<span title="Conta ' + esc(d.nr_interno_conta) + '">'
                    + esc(d.nr_interno_conta) + '</span>';
            } else {
                contaHtml = '<span class="vt-sem-conta">— sem conta —</span>';
            }

            html += '<tr' + rowCls + '>';
            html += '<td class="vt-sem" style="padding:0"><span class="sem-bar sem-' + semCls + '"></span></td>';
            html += '<td class="vt-atend"><strong>' + esc(d.nr_atendimento) + '</strong></td>';
            html += '<td class="vt-pac" title="' + esc(d.nm_paciente) + '">' + esc(d.nm_paciente) + '</td>';
            html += '<td class="vt-conv" title="' + esc(d.ds_convenio) + '">' + esc(d.ds_convenio) + '</td>';
            html += '<td class="vt-est">' + badgeEstagio(d.ds_estagio, calcularSemaforoPrazo(d.ds_estagio, d.horas_em_aberto)) + '</td>';
            html += '<td class="vt-conta">' + contaHtml + '</td>';
            html += '<td class="vt-vl ' + vlCls(d.vl_total_conta) + '">' + vlFmt(d.vl_total_conta) + '</td>';
            html += '<td class="vt-vl ' + vlCls(d.vl_total_executado_conta) + '">' + vlFmt(d.vl_total_executado_conta) + '</td>';
            html += '<td class="vt-vl ' + vlCls(d.vl_total_vinculado) + '">' + vlFmt(d.vl_total_vinculado) + '</td>';
            html += '<td class="vt-vl ' + vlCls(d.vl_total_por_codigo) + '">' + vlFmt(d.vl_total_por_codigo) + '</td>';
            html += '<td class="vt-vl vt-pendente">'
                + (altoRisco ? '<i class="fas fa-fire" style="color:#e65100;margin-right:3px" title="Alto risco"></i>' : '')
                + vlFmt(d.vl_pendente_autorizacao)
                + '</td>';
            html += '<td class="vt-acao"><button class="btn-detalhe-fin" data-seq="' + esc(d.nr_sequencia) + '" title="Detalhe financeiro"><i class="fas fa-eye"></i></button></td>';
            html += '</tr>';
        }
        DOM.valoresTbody.innerHTML = html;

        // Bind botões de detalhe
        var btns = DOM.valoresTbody.querySelectorAll('.btn-detalhe-fin');
        for (var b = 0; b < btns.length; b++) {
            btns[b].addEventListener('click', (function (btn) {
                return function (e) {
                    e.stopPropagation();
                    abrirDrawerValoresDetalhe(parseInt(btn.getAttribute('data-seq'), 10));
                };
            })(btns[b]));
        }
    }

    function vlFmt(v) {
        var n = parseFloat(v);
        if (!v && v !== 0) return '<span class="vt-vl-zero">—</span>';
        if (isNaN(n) || n === 0) return '<span class="vt-vl-zero">—</span>';
        var cls = n >= 5000 ? ' class="vt-vl-alto"' : '';
        return '<span' + cls + '>' + formatarBRL(n) + '</span>';
    }

    function vlCls(v) {
        var n = parseFloat(v);
        if (isNaN(n) || n === 0) return 'vt-vl-zero';
        return n >= 5000 ? 'vt-vl-alto' : '';
    }

    function renderizarPaginacaoValores(pagina, totalPag, total) {
        if (!DOM.valoresPaginacao) return;
        if (totalPag <= 1) { DOM.valoresPaginacao.innerHTML = ''; return; }
        var html = '';
        html += '<button class="pag-btn" ' + (pagina <= 1 ? 'disabled' : '') + ' data-pag="' + (pagina - 1) + '">&#8249; Ant.</button>';
        var inicio = Math.max(1, pagina - 2);
        var fim    = Math.min(totalPag, pagina + 2);
        if (inicio > 1) html += '<button class="pag-btn" data-pag="1">1</button>' + (inicio > 2 ? '<span class="pag-info">…</span>' : '');
        for (var p = inicio; p <= fim; p++) {
            html += '<button class="pag-btn' + (p === pagina ? ' active' : '') + '" data-pag="' + p + '">' + p + '</button>';
        }
        if (fim < totalPag) html += (fim < totalPag - 1 ? '<span class="pag-info">…</span>' : '') + '<button class="pag-btn" data-pag="' + totalPag + '">' + totalPag + '</button>';
        html += '<button class="pag-btn" ' + (pagina >= totalPag ? 'disabled' : '') + ' data-pag="' + (pagina + 1) + '">Próx. &#8250;</button>';
        html += '<span class="pag-info">' + total + ' registros</span>';
        DOM.valoresPaginacao.innerHTML = html;
        var pagBtns = DOM.valoresPaginacao.querySelectorAll('[data-pag]');
        for (var i = 0; i < pagBtns.length; i++) {
            pagBtns[i].addEventListener('click', (function (btn) {
                return function () {
                    if (btn.disabled) return;
                    carregarValoresLista(parseInt(btn.getAttribute('data-pag'), 10));
                };
            })(pagBtns[i]));
        }
    }

    // ============================================================
    // DRAWER DETALHE FINANCEIRO
    // ============================================================

    function abrirDrawerValoresDetalhe(nrSeq) {
        DOM.drawerValores.classList.add('aberto');
        DOM.drawerValoresOverlay.classList.add('visivel');
        DOM.drawerValoresSeq.textContent = 'Seq. ' + nrSeq;
        DOM.drawerValoresBody.innerHTML = '<div class="loading-container"><div class="loading-spinner"></div></div>';
        estado.drawerValoresAberto = true;

        // Resetar tabs
        var dtBtns = DOM.drawerValoresTabNav.querySelectorAll('.det-tab-btn');
        for (var i = 0; i < dtBtns.length; i++) dtBtns[i].classList.toggle('active', i === 0);

        fetchComRetry(CONFIG.apiValoresDetalhe + '/' + nrSeq, {}).then(function (resp) {
            if (!resp.ok) {
                DOM.drawerValoresBody.innerHTML = '<div class="pac-erro" style="padding:20px">Erro: ' + esc(resp.erro) + '</div>';
                return;
            }
            renderizarDrawerValoresDetalhe(resp);
        }).catch(function (err) {
            DOM.drawerValoresBody.innerHTML = '<div class="pac-erro" style="padding:20px">Falha: ' + esc(err.message) + '</div>';
        });
    }

    function fecharDrawerValores() {
        DOM.drawerValores.classList.remove('aberto');
        DOM.drawerValoresOverlay.classList.remove('visivel');
        estado.drawerValoresAberto = false;
    }

    function renderizarDrawerValoresDetalhe(resp) {
        var a    = resp.autorizacao  || {};
        var c    = resp.conta        || null;
        var tot  = resp.totais       || {};
        var md   = resp.materiais_match_direto    || [];
        var mc   = resp.materiais_match_codigo    || [];
        var pd   = resp.procedimentos_match_direto || [];
        var pc   = resp.procedimentos_match_codigo || [];
        var cntDir = md.length + pd.length;
        var cntCod = mc.length + pc.length;

        // Atualiza contadores nas tabs
        var cntDirEl = document.getElementById('dtab-cnt-direto');
        var cntCodEl = document.getElementById('dtab-cnt-codigo');
        if (cntDirEl) cntDirEl.textContent = cntDir;
        if (cntCodEl) cntCodEl.textContent = cntCod;

        // Tab Resumo
        var htmlResumo = '<div class="fin-tab-panel active" data-dtab="resumo-fin">';

        // Cartões de totais
        htmlResumo += '<div class="fin-totais-row">';
        htmlResumo += '<div class="fin-total-card"><span class="fin-total-val">' + formatarBRL(tot.vl_match_direto) + '</span><span class="fin-total-lbl">Vinculado direto</span></div>';
        htmlResumo += '<div class="fin-total-card"><span class="fin-total-val">' + formatarBRL(tot.vl_match_codigo) + '</span><span class="fin-total-lbl">Por código</span></div>';
        htmlResumo += '<div class="fin-total-card destaque"><span class="fin-total-val">' + formatarBRL(tot.vl_pendente_estimado) + '</span><span class="fin-total-lbl">Pendente estimado</span></div>';
        htmlResumo += '</div>';

        // Dados da conta
        if (c) {
            htmlResumo += '<div class="fin-conta-box">';
            htmlResumo += '<span><b>Conta:</b> ' + esc(c.nr_interno_conta) + '</span>';
            htmlResumo += '<span><b>Período:</b> ' + formatarData(c.dt_periodo_inicial) + ' a ' + formatarData(c.dt_periodo_final) + '</span>';
            htmlResumo += '<span><b>Total conta:</b> ' + formatarBRL(c.vl_total_conta) + '</span>';
            htmlResumo += '</div>';
        } else {
            htmlResumo += '<div class="fin-sem-conta"><i class="fas fa-info-circle"></i> Nenhuma conta identificada para esta autorização.</div>';
        }

        // Dados da autorização
        htmlResumo += '<div class="det-info-grid">';
        htmlResumo += '<div class="det-field"><label>Paciente</label><span>' + esc(a.nm_paciente) + '</span></div>';
        htmlResumo += '<div class="det-field"><label>Atendimento</label><span>' + esc(a.nr_atendimento) + '</span></div>';
        htmlResumo += '<div class="det-field"><label>Convênio</label><span>' + esc(a.ds_convenio) + '</span></div>';
        htmlResumo += '<div class="det-field"><label>Estágio</label><span>' + badgeEstagio(a.ds_estagio, calcularSemaforoPrazo(a.ds_estagio, a.horas_em_aberto)) + '</span></div>';
        htmlResumo += '<div class="det-field"><label>Setor</label><span>' + esc(a.ds_setor_atendimento) + '</span></div>';
        htmlResumo += '<div class="det-field"><label>Dt. Pedido</label><span>' + formatarData(a.dt_pedido_medico) + '</span></div>';
        htmlResumo += '<div class="det-field"><label>Executado conta</label><span>' + formatarBRL(a.vl_total_executado_conta) + '</span></div>';
        htmlResumo += '<div class="det-field"><label>Pendente view</label><span style="font-weight:700;color:#c62828">' + formatarBRL(a.vl_pendente_autorizacao) + '</span></div>';
        htmlResumo += '</div>';
        htmlResumo += '</div>';

        // Tab Itens Vinculados
        var htmlDir = '<div class="fin-tab-panel" data-dtab="itens-direto">';
        htmlDir += _htmlItensFin(md, pd, 'Materiais com vínculo direto', 'Procedimentos com vínculo direto');
        htmlDir += '</div>';

        // Tab Itens por Código
        var htmlCod = '<div class="fin-tab-panel" data-dtab="itens-codigo">';
        htmlCod += _htmlItensFin(mc, pc, 'Materiais por código', 'Procedimentos por código');
        htmlCod += '</div>';

        // Tab Comparativo
        var vDir = parseFloat(tot.vl_match_direto)  || 0;
        var vCod = parseFloat(tot.vl_match_codigo)  || 0;
        var vExec = parseFloat(a.vl_total_executado_conta) || 0;
        var vNaoId = Math.max(0, vExec - Math.max(vDir, vCod));
        var total3 = vDir + vCod + vNaoId;
        var pDir = total3 > 0 ? Math.round(vDir / total3 * 100) : 0;
        var pCod = total3 > 0 ? Math.round(vCod / total3 * 100) : 0;
        var pNao = 100 - pDir - pCod;
        var htmlComp = '<div class="fin-tab-panel" data-dtab="comparativo" style="padding:var(--esp-md)">';
        htmlComp += '<div class="fin-donut-wrap">';
        htmlComp += '<div class="fin-donut" style="background: conic-gradient(#28a745 0% ' + pDir + '%, #ffc107 ' + pDir + '% ' + (pDir+pCod) + '%, #dee2e6 ' + (pDir+pCod) + '% 100%)"></div>';
        htmlComp += '<div class="fin-legenda">';
        htmlComp += '<div class="fin-leg-item"><div class="fin-leg-dot" style="background:#28a745"></div> Vinculado direto: <strong>' + formatarBRL(vDir) + '</strong></div>';
        htmlComp += '<div class="fin-leg-item"><div class="fin-leg-dot" style="background:#ffc107"></div> Por código: <strong>' + formatarBRL(vCod) + '</strong></div>';
        htmlComp += '<div class="fin-leg-item"><div class="fin-leg-dot" style="background:#dee2e6"></div> Não identificado: <strong>' + formatarBRL(vNaoId) + '</strong></div>';
        htmlComp += '</div></div>';
        htmlComp += '<div class="fin-comparativo-note"><strong>Atenção:</strong> o "Por código" pode incluir itens de outras autorizações do mesmo atendimento — esse comportamento é esperado e reflete a visão mais conservadora do risco financeiro. O valor pendente estimado usa o <em>maior</em> dos dois totais.</div>';
        htmlComp += '</div>';

        DOM.drawerValoresBody.innerHTML = htmlResumo + htmlDir + htmlCod + htmlComp;
    }

    function _htmlItensFin(mats, procs, lblMats, lblProcs) {
        if (!mats.length && !procs.length) {
            return '<div class="pac-vazio" style="padding:20px"><i class="fas fa-inbox"></i> Nenhum item encontrado.</div>';
        }
        var html = '<table class="fin-item-table"><thead><tr><th>Código</th><th>Descrição</th><th>Qt.</th><th class="td-val">Valor</th></tr></thead><tbody>';
        if (mats.length) {
            html += '<tr><td colspan="4"><span class="fin-table-section"><i class="fas fa-box-open"></i> ' + esc(lblMats) + '</span></td></tr>';
            for (var i = 0; i < mats.length; i++) {
                var m = mats[i];
                html += '<tr><td>' + esc(m.cd_material) + '</td><td>' + esc(m.ds_material) + '</td><td>' + (m.qt || '—') + '</td><td class="td-val">' + formatarBRL(m.vl_item) + '</td></tr>';
            }
        }
        if (procs.length) {
            html += '<tr><td colspan="4"><span class="fin-table-section"><i class="fas fa-stethoscope"></i> ' + esc(lblProcs) + '</span></td></tr>';
            for (var j = 0; j < procs.length; j++) {
                var p = procs[j];
                html += '<tr><td>' + esc(p.cd_procedimento) + '</td><td>' + esc(p.ds_procedimento) + '</td><td>' + (p.qt || '—') + '</td><td class="td-val">' + formatarBRL(p.vl_item) + '</td></tr>';
            }
        }
        html += '</tbody></table>';
        return html;
    }

    // ============================================================
    // TOAST
    // ============================================================

    function mostrarToast(msg, tipo) {
        var t = document.createElement('div');
        t.className = 'toast' + (tipo ? ' ' + tipo : '');
        var icones = { sucesso: 'fa-check-circle', erro: 'fa-exclamation-circle', aviso: 'fa-triangle-exclamation' };
        t.innerHTML = '<i class="fas ' + (icones[tipo] || 'fa-info-circle') + '"></i> ' + msg;
        DOM.toastContainer.appendChild(t);
        setTimeout(function () { if (t.parentNode) t.parentNode.removeChild(t); }, 4000);
    }

    // ============================================================
    // START
    // ============================================================

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', inicializar);
    } else {
        inicializar();
    }

})();
