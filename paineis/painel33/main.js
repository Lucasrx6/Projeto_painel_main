/* Painel 33 - Autorizacoes de Convenio | ES5 IIFE */
(function () {
    'use strict';

    var CONFIG = {
        apiDashboard: '/api/paineis/painel33/dashboard',
        apiDados:     '/api/paineis/painel33/dados',
        apiFiltros:   '/api/paineis/painel33/filtros',
        apiPaciente:  '/api/paineis/painel33/paciente',
        apiExport:    '/api/paineis/painel33/export',
        intervaloRefresh: 90000,
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
        msGrupo:      [],
        msSemaforo:   [],
        msConvenio:   [],
        msTipoGuia:   [],
        msTipoAutor:  [],
        msSetor:      [],
        msMedico:     [],

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
        carregarFiltros();
        carregarDados();
        carregarDashboard();
        
        estado.intervalos.refresh = setInterval(function () {
            if (!estado.filtrosVisiveis) {
                carregarDados();
                carregarDashboard();
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

        DOM.kpiTotal     = document.getElementById('kpi-v-total');
        DOM.kpiAutorizado= document.getElementById('kpi-v-autorizado');
        DOM.kpiAguardando= document.getElementById('kpi-v-aguardando');
        DOM.kpiNegado    = document.getElementById('kpi-v-negado');

        DOM.tabelaTbody  = document.getElementById('tabela-tbody');
        DOM.tabelaTotal  = document.getElementById('tabela-total');
        DOM.tabelaVazia  = document.getElementById('tabela-vazia');

        DOM.statusIndicator   = document.getElementById('status-indicator');
        DOM.ultimaAtualizacao = document.getElementById('ultima-atualizacao');
        DOM.toastContainer    = document.getElementById('toast-container');
    }

    // ============================================================
    // EVENTOS
    // ============================================================

    function configurarEventos() {
        DOM.btnToggleFiltros.addEventListener('click', toggleFiltros);
        DOM.btnLimpar.addEventListener('click', limparTudo);
        DOM.btnRefresh.addEventListener('click', function () { carregarDados(); carregarDashboard(); });
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
        vincularMultiSelect('ms-grupo');
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
        carregarDashboard();
    }

    // ============================================================
    // PERSISTENCIA LOCAL
    // ============================================================

    function salvarEstadoLocal() {
        try {
            var data = {
                msGrupo:     estado.msGrupo,
                msSemaforo:  estado.msSemaforo,
                msConvenio:  estado.msConvenio,
                msTipoGuia:  estado.msTipoGuia,
                msTipoAutor: estado.msTipoAutor,
                msSetor:     estado.msSetor,
                msMedico:    estado.msMedico,
                periodo:     estado.periodo,
                busca:       estado.busca,
                ordemCampo:  estado.ordemCampo,
                ordemDir:    estado.ordemDir
            };
            localStorage.setItem(CONFIG.storagePrefix + 'estado', JSON.stringify(data));
        } catch (e) {}
    }

    function restaurarEstadoLocal() {
        try {
            var saved = localStorage.getItem(CONFIG.storagePrefix + 'estado');
            if (!saved) return;
            var d = JSON.parse(saved);
            var arrays = ['msGrupo','msSemaforo','msConvenio','msTipoGuia','msTipoAutor','msSetor','msMedico'];
            for (var i = 0; i < arrays.length; i++) {
                if (Array.isArray(d[arrays[i]])) estado[arrays[i]] = d[arrays[i]];
            }
            if (d.periodo !== undefined) { estado.periodo = d.periodo; DOM.filtroPeriodo.value = d.periodo; }
            if (d.busca)    { estado.busca    = d.busca;    DOM.filtroBusca.value    = d.busca; }
            if (d.ordemCampo) estado.ordemCampo = d.ordemCampo;
            if (d.ordemDir)   estado.ordemDir   = d.ordemDir;
        } catch (e) {}
    }

    // ============================================================
    // CONSTRUIR PARAMS
    // ============================================================

    function construirParams() {
        var p = {};
        if (estado.msGrupo.length)     p.grupo          = estado.msGrupo.join(',');
        if (estado.msSemaforo.length)  p.semaforo       = estado.msSemaforo.join(',');
        if (estado.msConvenio.length)  p.convenio       = estado.msConvenio.join(',');
        if (estado.msTipoGuia.length)  p.tipo_guia      = estado.msTipoGuia.join(',');
        if (estado.msTipoAutor.length) p.tipo_autorizacao = estado.msTipoAutor.join(',');
        if (estado.msSetor.length)     p.setor          = estado.msSetor.join(',');
        if (estado.msMedico.length)    p.medico         = estado.msMedico.join(',');
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
    // DASHBOARD / KPIs
    // ============================================================

    function carregarDashboard() {
        setStatusIndicator('loading');
        fetchComRetry(CONFIG.apiDashboard, construirParams()).then(function (resp) {
            if (resp.ok) {
                var d = resp.dados;
                DOM.kpiTotal.textContent      = d.total_pacientes  || 0;
                DOM.kpiAutorizado.textContent = d.autorizados      || 0;
                DOM.kpiAguardando.textContent = d.aguardando       || 0;
                DOM.kpiNegado.textContent     = d.negados          || 0;
                atualizarHora();
                setStatusIndicator('online');
            } else {
                setStatusIndicator('offline');
                mostrarToast('KPIs: ' + (resp.detalhe || resp.erro), 'erro');
            }
        }).catch(function (err) {
            setStatusIndicator('offline');
            mostrarToast('Falha: ' + err.message, 'erro');
        });
    }

    // ============================================================
    // CARREGAR DADOS E AGRUPAR POR PACIENTE
    // ============================================================

    function carregarFiltros() {
        fetchComRetry(CONFIG.apiFiltros, {}).then(function (resp) {
            if (!resp.ok) return;
            var f = resp.filtros;
            popularMultiSelectDinamico('ms-convenio',   f.convenios       || []);
            popularMultiSelectDinamico('ms-tipo-guia',  f.tipos_guia      || []);
            popularMultiSelectDinamico('ms-tipo-autor',  f.tipos_autorizacao || []);
            popularMultiSelectDinamico('ms-setor',      f.setores         || []);
            popularMultiSelectDinamico('ms-medico',     f.medicos         || []);
            // Restaurar seleções salvas
            restaurarMultiSelect('ms-convenio');
            restaurarMultiSelect('ms-tipo-guia');
            restaurarMultiSelect('ms-tipo-autor');
            restaurarMultiSelect('ms-setor');
            restaurarMultiSelect('ms-medico');
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
        DOM.tabelaTbody.innerHTML = '<tr><td colspan="11" class="loading-cell">'
            + '<div class="loading-spinner"></div> Carregando...</td></tr>';
        DOM.tabelaVazia.style.display = 'none';

        fetchComRetry(CONFIG.apiDados, construirParams()).then(function (resp) {
            estado.carregando = false;
            if (resp.ok) {
                renderizarTabela(resp.dados || []);
                atualizarHora();
            } else {
                DOM.tabelaTbody.innerHTML = '<tr><td colspan="11" class="loading-cell">'
                    + 'Erro: ' + esc(resp.detalhe || resp.erro) + '</td></tr>';
            }
        }).catch(function (err) {
            estado.carregando = false;
            DOM.tabelaTbody.innerHTML = '<tr><td colspan="11" class="loading-cell">'
                + 'Falha: ' + esc(err.message) + '</td></tr>';
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
            var semNovo  = prioSem[d.status_semaforo] || 0;
            if (semNovo > semAtual) grupos[key].piorSemaforo = d.status_semaforo;

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
            html += '<td class="col-tguia">' + esc(pr.ds_tipo_guia) + '</td>';
            html += '<td class="col-tautor">' + esc(pr.ds_tipo_autorizacao) + '</td>';
            html += '<td class="col-estagio">' + badgeGrupo(pr.grupo_estagio, pr.ds_estagio) + '</td>';
            html += '<td class="col-setor" title="' + esc(pr.ds_setor_origem) + '">' + esc(pr.ds_setor_origem) + '</td>';
            html += '<td class="col-dtped">' + formatarDataHora(g.recentePedido) + '</td>';
            html += '<td class="col-dtaut">' + formatarDataHora(g.recenteAut) + '</td>';
            html += '<td class="col-sla">' + badgeSla(g.piorSla) + '</td>';
            html += '</tr>';

            // Linha de detalhe do paciente (expandida por padrão)
            html += '<tr class="row-pac-detalhe' + (isExp ? '' : ' oculto') + '" data-idx="' + i + '">';
            html += '<td colspan="11" class="td-pac-detalhe">';
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

        var qtdSemDoc = 0;
        for (var idxAut = 0; idxAut < auts.length; idxAut++) {
            var a = auts[idxAut];
            var estagio = (a.ds_estagio || '').toLowerCase();
            if ((estagio.indexOf('solicitado') !== -1) && !docsAtendSet[String(a.nr_atendimento)]) {
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
            html += '<th>Atend.</th><th>Convênio</th><th>Tipo Guia</th><th>Tipo Autor.</th><th>Estágio</th><th>Setor</th><th>Pedido</th><th>Autorizado</th><th>SLA</th><th>Doc.</th>';
            html += '</tr></thead><tbody>';
            for (var i = 0; i < auts.length; i++) {
                var a = auts[i];
                var estagio = (a.ds_estagio || '').toLowerCase();
                var atendKey = String(a.nr_atendimento);
                var solicitadoSemDoc = (estagio.indexOf('solicitado') !== -1) && !docsAtendSet[atendKey];
                html += '<tr' + (solicitadoSemDoc ? ' class="row-sem-doc"' : '') + '>';
                html += '<td>' + esc(a.nr_atendimento) + '</td>';
                html += '<td>' + esc(a.ds_convenio) + '</td>';
                html += '<td>' + esc(a.ds_tipo_guia) + '</td>';
                html += '<td>' + esc(a.ds_tipo_autorizacao) + '</td>';
                html += '<td>' + badgeGrupo(a.grupo_estagio, a.ds_estagio) + '</td>';
                html += '<td>' + esc(a.ds_setor_origem) + '</td>';
                html += '<td>' + formatarDataHora(a.dt_pedido_medico) + '</td>';
                html += '<td>' + formatarDataHora(a.dt_autorizacao) + '</td>';
                html += '<td>' + badgeSla(a.status_sla) + '</td>';
                if (solicitadoSemDoc) {
                    html += '<td><span class="badge badge-sem-doc" title="Solicitado sem documento anexado"><i class="fas fa-triangle-exclamation"></i> Sem Doc.</span></td>';
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
