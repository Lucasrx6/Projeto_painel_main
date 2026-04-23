/* Painel 33 - Autorizacoes de Convenio | ES5 IIFE */
(function () {
    'use strict';

    var CONFIG = {
        apiDados:     '/api/paineis/painel33/dados',
        apiFiltros:   '/api/paineis/painel33/filtros',
        apiPaciente:  '/api/paineis/painel33/paciente',
        apiExport:    '/api/paineis/painel33/export',
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
        periodo: '30',
        busca:   '',

        // Dados e agrupamento
        pacientesOrdem:  [],
        pacientesGrupo:  {},
        pacienteCache:   {},  // idx -> resp data
        expandidos:      {},  // idx -> bool

        // Ordem
        ordemCampo: 'dt_pedido_medico',
        ordemDir:   'desc',

        // UI
        abaAtiva:            'resumo', // ou 'autorizacoes'
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

        estado.intervalos.refresh = setInterval(function () {
            if (!estado.filtrosVisiveis) {
                carregarDados();
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
        estado.periodo = '30';
        estado.busca   = '';
        DOM.filtroPeriodo.value = '30';
        DOM.filtroBusca.value   = '';
        salvarEstadoLocal();
        recarregarTudo();
    }

    function recarregarTudo() {
        estado.pacienteCache = {};
        estado.expandidos    = {};
        carregarDados();
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

        // Auto-carregar detalhes de todos os pacientes expandidos
        for (var ai = 0; ai < agrupado.ordem.length; ai++) {
            if (estado.expandidos[ai] && !estado.pacienteCache[ai]) {
                carregarDetalhePaciente(ai);
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

            // Situação (ds_estagio direto, ordenado por count desc)
            var semToCls = { verde: 'sit-autorizado', amarelo: 'sit-aguardando', laranja: 'sit-acao', vermelho: 'sit-negado' };
            var estKeys = Object.keys(s.estagiosDiretos).sort(function(a, b) {
                return s.estagiosDiretos[b].count - s.estagiosDiretos[a].count;
            });
            if (estKeys.length > 0) {
                html += '<div class="setor-situacao">';
                html += '<div class="breakdown-title">Situação</div>';
                html += '<div class="setor-situacao-row">';
                for (var ek = 0; ek < estKeys.length; ek++) {
                    var estK = estKeys[ek];
                    var estD = s.estagiosDiretos[estK];
                    var sitCls = semToCls[estD.sem] || 'sit-outros';
                    html += '<div class="setor-sit-item ' + sitCls + '"><span class="sit-val">' + estD.count + '</span><span class="sit-lbl">' + esc(estK) + '</span></div>';
                }
                html += '</div></div>';
            }

            // SLA (5 dias: verde <48h, amarelo 48-120h, vermelho >120h)
            var temSla = s.slaStatus.verde + s.slaStatus.amarelo + s.slaStatus.vermelho;
            if (temSla > 0) {
                html += '<div class="setor-situacao">';
                html += '<div class="breakdown-title">SLA (5 dias)</div>';
                html += '<div class="setor-situacao-row">';
                if (s.slaStatus.verde > 0)    html += '<div class="setor-sit-item sit-sla-dentro"><span class="sit-val">' + s.slaStatus.verde + '</span><span class="sit-lbl">No Prazo</span></div>';
                if (s.slaStatus.amarelo > 0)  html += '<div class="setor-sit-item sit-sla-atencao"><span class="sit-val">' + s.slaStatus.amarelo + '</span><span class="sit-lbl">Atenção</span></div>';
                if (s.slaStatus.vermelho > 0) html += '<div class="setor-sit-item sit-sla-atrasado"><span class="sit-val">' + s.slaStatus.vermelho + '</span><span class="sit-lbl">Vencido</span></div>';
                html += '</div></div>';
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

    function carregarDetalhePaciente(idx) {
        var key = estado.pacientesOrdem[idx];
        var g   = estado.pacientesGrupo[key];
        var cd  = g.cd;
        if (!cd) return;
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
        }).catch(function () {});
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
