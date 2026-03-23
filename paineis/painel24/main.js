/**
 * PAINEL 24 - Estoque-Dia
 * Sistema de Paineis Hospitalares - Hospital Anchieta
 *
 * Funcionalidades:
 * - Listagem de estoque por setor com classificacao por dias
 * - Multi-select generico para: Local, Tipo Local, Grupo, Subgrupo, Classificacao
 * - Filtro de busca por item/codigo
 * - Toggles: ocultar sem consumo, ocultar carrinhos/maletas, apenas criticos (<3d)
 * - Exportacao Excel com selecao de colunas
 * - Botao recolher/expandir filtros
 * - Dois modos de scroll: rolagem continua e paginado
 * - Dashboard KPIs refletem todos os filtros aplicados
 * - Ordenacao por qualquer coluna
 * - Persistencia via localStorage
 */

(function() {
    'use strict';

    // =========================================================
    // CONFIGURACAO
    // =========================================================

    var CONFIG = {
        api: {
            dashboard: '/api/paineis/painel24/dashboard',
            dados: '/api/paineis/painel24/dados',
            filtros: '/api/paineis/painel24/filtros'
        },
        intervaloRefresh: 300000,
        velocidadeScroll: 0.6,
        intervaloScroll: 50,
        pausaNoFinal: 6000,
        pausaAposReset: 4000,
        delayAutoScrollInicial: 10000,
        watchdogInterval: 3000,
        watchdogMaxTravamentos: 3,
        maxTentativasConexao: 3,
        timeoutRequisicao: 30000,
        debounceMs: 400,
        storagePrefix: 'painel24_',
        paginadoTempo: 12000,
        paginadoTransicao: 600
    };

    // =========================================================
    // ESTADO
    // =========================================================

    var Estado = {
        dados: [],
        carregando: false,
        errosConsecutivos: 0,
        autoScrollAtivo: false,
        autoScrollIniciado: false,
        intervalos: { refresh: null, scroll: null, watchdog: null, paginado: null },
        timeouts: { autoScrollInicial: null, debounce: null },
        watchdog: { ultimaPosicao: 0, contadorTravamento: 0 },
        ordenacao: { campo: 'ordem_classificacao', direcao: 'asc' },
        filtros: {
            busca: ''
        },
        multiLocal: [],
        multiTipoLocal: [],
        multiGrupo: [],
        multiSubgrupo: [],
        multiClassificacao: [],
        ocultarSemConsumo: false,
        ocultarCarrinhos: false,
        apenasCriticos: false,
        filtrosRecolhidos: false,
        modoScroll: 'rolar',
        paginaAtual: 0,
        totalPaginas: 0,
        dropdownAberto: null,
        recPaginaAtual: 0,
        recTotal: 0,
        recIntervalo: null
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
        DOM.totalRegistros = document.getElementById('total-registros');

        DOM.kpiTotalItens = document.getElementById('kpi-total-itens');
        DOM.kpiAbaixo3d = document.getElementById('kpi-abaixo-3d');
        DOM.kpiSaldoNegativo = document.getElementById('kpi-saldo-negativo');
        DOM.kpiSemOrigem = document.getElementById('kpi-sem-origem');
        DOM.kpiComOrigem = document.getElementById('kpi-com-origem');
        DOM.kpiLocaisCriticos = document.getElementById('kpi-locais-criticos');

        DOM.filtroBusca = document.getElementById('filtro-busca');

        DOM.paginacaoIndicator = document.getElementById('paginacao-indicator');
        DOM.paginacaoTexto = document.getElementById('paginacao-texto');
        DOM.paginacaoDots = document.getElementById('paginacao-dots');

        DOM.btnOcultarSemConsumo = document.getElementById('btn-ocultar-sem-consumo');
        DOM.btnOcultarCarrinhos = document.getElementById('btn-ocultar-carrinhos');
        DOM.btnApenasCriticos = document.getElementById('btn-apenas-criticos');
        DOM.btnLimpar = document.getElementById('btn-limpar');
        DOM.btnVoltar = document.getElementById('btn-voltar');
        DOM.btnRefresh = document.getElementById('btn-refresh');
        DOM.btnAutoScroll = document.getElementById('btn-auto-scroll');
        DOM.btnModoScroll = document.getElementById('btn-modo-scroll');
        DOM.btnToggleFiltros = document.getElementById('btn-toggle-filtros');
        DOM.headerControls = document.getElementById('header-controls');

        DOM.btnExportar = document.getElementById('btn-exportar');
        DOM.modalExportar = document.getElementById('modal-exportar');
        DOM.modalColunasGrid = document.getElementById('modal-colunas-grid');
        DOM.modalExportInfo = document.getElementById('modal-export-info');
        DOM.btnExportarConfirmar = document.getElementById('btn-exportar-confirmar');
        DOM.btnExportarCancelar = document.getElementById('btn-exportar-cancelar');
        DOM.modalExportarFechar = document.getElementById('modal-exportar-fechar');
        DOM.btnSelecionarTodas = document.getElementById('btn-selecionar-todas');
        DOM.btnDesmarcarTodas = document.getElementById('btn-desmarcar-todas');

        // Recomendacoes
        DOM.recomendacoesSection = document.getElementById('recomendacoes-section');
        DOM.recomendacoesTrack = document.getElementById('recomendacoes-track');
        DOM.recomendacoesDots = document.getElementById('recomendacoes-dots');
        DOM.recContador = document.getElementById('rec-contador');
        DOM.recPagina = document.getElementById('rec-pagina');
        DOM.recPrev = document.getElementById('rec-prev');
        DOM.recNext = document.getElementById('rec-next');
    }

    // =========================================================
    // UTILITARIOS
    // =========================================================

    function escapeHtml(t) {
        if (!t && t !== 0) return '-';
        var d = document.createElement('div');
        d.textContent = t;
        return d.innerHTML;
    }

    function formatarNumero(v) {
        if (v === null || v === undefined || isNaN(v)) return '-';
        return new Intl.NumberFormat('pt-BR').format(v);
    }

    function formatarDecimal(v, casas) {
        if (v === null || v === undefined || isNaN(v)) return '-';
        casas = casas || 1;
        return new Intl.NumberFormat('pt-BR', {
            minimumFractionDigits: casas,
            maximumFractionDigits: casas
        }).format(v);
    }

    function abreviar(t, m) {
        if (!t) return '-';
        return t.length > m ? t.substring(0, m) + '...' : t;
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

    function salvar(key, valor) {
        try { localStorage.setItem(CONFIG.storagePrefix + key, typeof valor === 'object' ? JSON.stringify(valor) : valor); } catch(e) {}
    }

    function recuperar(key) {
        try { return localStorage.getItem(CONFIG.storagePrefix + key); } catch(e) { return null; }
    }

    function recuperarArray(key) {
        try { var r = localStorage.getItem(CONFIG.storagePrefix + key); if (r) return JSON.parse(r); } catch(e) {} return [];
    }

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
                    .then(function(r) {
                        clearTimeout(timer);
                        if (!r.ok) throw new Error('HTTP ' + r.status);
                        return r.json();
                    })
                    .then(resolve)
                    .catch(function(e) {
                        clearTimeout(timer);
                        if (n > 1) setTimeout(function() { tentar(n - 1); }, 1000);
                        else reject(e);
                    });
            }
            tentar(tentativas);
        });
    }

    // =========================================================
    // MULTI-SELECT GENERICO
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
        for (var j = 0; j < trs.length; j++) {
            trs[j].classList.remove('aberto');
            trs[j].setAttribute('aria-expanded', 'false');
        }
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
        if (btnAll) {
            var na = btnAll.cloneNode(true);
            btnAll.parentNode.replaceChild(na, btnAll);
            na.addEventListener('click', function(e) {
                e.stopPropagation();
                var cbs = container.querySelectorAll('.multi-select-checkbox');
                for (var j = 0; j < cbs.length; j++) cbs[j].checked = true;
                syncEstado(containerId);
                atualizarLabel(containerId);
                salvar(stateKey, Estado[stateKey]);
                carregarDados();
            });
        }
        if (btnNone) {
            var nn = btnNone.cloneNode(true);
            btnNone.parentNode.replaceChild(nn, btnNone);
            nn.addEventListener('click', function(e) {
                e.stopPropagation();
                var cbs = container.querySelectorAll('.multi-select-checkbox');
                for (var j = 0; j < cbs.length; j++) cbs[j].checked = false;
                syncEstado(containerId);
                atualizarLabel(containerId);
                salvar(stateKey, Estado[stateKey]);
                carregarDados();
            });
        }

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
            if (cbs[i].checked) {
                sel.push(cbs[i].value);
                if (lbl) lbl.classList.add('selecionado');
            } else {
                if (lbl) lbl.classList.remove('selecionado');
            }
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
        var stateKey = container.getAttribute('data-state-key');
        var placeholder = container.getAttribute('data-placeholder');
        var labelEl = container.querySelector('.multi-select-label');
        if (!labelEl) return;
        var qtd = Estado[stateKey].length;
        var total = container.querySelectorAll('.multi-select-checkbox').length;
        if (qtd === 0 || qtd === total) {
            labelEl.textContent = placeholder;
        } else if (qtd === 1) {
            var cb = container.querySelector('.multi-select-checkbox:checked');
            var it = cb ? cb.closest('.multi-select-item').querySelector('.multi-select-item-text') : null;
            labelEl.textContent = it ? it.textContent : Estado[stateKey][0];
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
            cb.type = 'checkbox';
            cb.className = 'multi-select-checkbox';
            cb.value = valores[i];
            var span = document.createElement('span');
            span.className = 'multi-select-item-text';
            span.textContent = valores[i];
            label.appendChild(cb);
            label.appendChild(span);
            optionsDiv.appendChild(label);
        }
        vincularCheckboxesMultiSelect(containerId);
    }

    function popularMultiSelectLocais(containerId, locais) {
        var container = document.getElementById(containerId);
        if (!container) return;
        var optionsDiv = container.querySelector('.multi-select-options');
        if (!optionsDiv) return;
        optionsDiv.innerHTML = '';
        for (var i = 0; i < locais.length; i++) {
            var label = document.createElement('label');
            label.className = 'multi-select-item';
            var cb = document.createElement('input');
            cb.type = 'checkbox';
            cb.className = 'multi-select-checkbox';
            cb.value = String(locais[i].cd);
            var span = document.createElement('span');
            span.className = 'multi-select-item-text';
            span.textContent = locais[i].nome;
            label.appendChild(cb);
            label.appendChild(span);
            optionsDiv.appendChild(label);
        }
        vincularCheckboxesMultiSelect(containerId);
    }

    function resetarTodosMultiSelects() {
        var containers = document.querySelectorAll('.multi-select-container');
        for (var i = 0; i < containers.length; i++) {
            var stateKey = containers[i].getAttribute('data-state-key');
            var placeholder = containers[i].getAttribute('data-placeholder');
            Estado[stateKey] = [];
            salvar(stateKey, []);
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

    // =========================================================
    // CONSTRUIR URL COM TODOS OS FILTROS
    // =========================================================

    function construirParams() {
        var params = [];
        var f = Estado.filtros;

        if (f.busca) params.push('busca=' + encodeURIComponent(f.busca));

        if (Estado.multiLocal.length > 0) params.push('local_estoque=' + encodeURIComponent(Estado.multiLocal.join(',')));
        if (Estado.multiTipoLocal.length > 0) params.push('tipo_local=' + encodeURIComponent(Estado.multiTipoLocal.join(',')));
        if (Estado.multiGrupo.length > 0) params.push('grupo=' + encodeURIComponent(Estado.multiGrupo.join(',')));
        if (Estado.multiSubgrupo.length > 0) params.push('subgrupo=' + encodeURIComponent(Estado.multiSubgrupo.join(',')));
        if (Estado.multiClassificacao.length > 0) params.push('classificacao=' + encodeURIComponent(Estado.multiClassificacao.join(',')));

        if (Estado.ocultarSemConsumo) params.push('ocultar_sem_consumo=1');
        if (Estado.ocultarCarrinhos) params.push('ocultar_carrinhos=1');
        if (Estado.apenasCriticos) params.push('apenas_criticos=1');

        return params;
    }

    function construirUrl() {
        var params = construirParams();
        return CONFIG.api.dados + (params.length > 0 ? '?' + params.join('&') : '');
    }

    function construirUrlDashboard() {
        var params = construirParams();
        return CONFIG.api.dashboard + (params.length > 0 ? '?' + params.join('&') : '');
    }

    // =========================================================
    // CARREGAR DADOS
    // =========================================================

    function carregarDados() {
        if (Estado.carregando) return Promise.resolve();
        Estado.carregando = true;
        atualizarStatus('loading');

        var scrollEstaAtivo = Estado.autoScrollAtivo;
        if (scrollEstaAtivo) pararAutoScroll();

        return Promise.all([
            fetchComRetry(construirUrl()),
            fetchComRetry(construirUrlDashboard())
        ])
        .then(function(r) {
            var dadosResp = r[0];
            var dashResp = r[1];
            if (!dadosResp.success) { mostrarErro('Erro ao carregar dados'); return; }
            Estado.dados = dadosResp.data || [];
            atualizarKPIs(dashResp.success ? dashResp.data : null);
            renderizarRecomendacoes();
            renderizarTabela();
            atualizarContadores();
            atualizarHorario();
            atualizarStatus('online');
            Estado.errosConsecutivos = 0;
            if (scrollEstaAtivo) {
                setTimeout(function() {
                    Estado.autoScrollAtivo = true;
                    atualizarBotaoScroll();
                    iniciarAutoScrollModo();
                }, 500);
            }
            if (!Estado.autoScrollIniciado && !scrollEstaAtivo) agendarAutoScrollInicial();
        })
        .catch(function(err) {
            console.error('[P24] Erro:', err);
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
        for (var j = 0; j < cards.length; j++) {
            cards[j].classList.add('atualizando');
            (function(c) { setTimeout(function() { c.classList.remove('atualizando'); }, 300); })(cards[j]);
        }
        if (DOM.kpiTotalItens) DOM.kpiTotalItens.textContent = formatarNumero(d.total_itens);
        if (DOM.kpiAbaixo3d) DOM.kpiAbaixo3d.textContent = formatarNumero(d.qt_abaixo_3d);
        if (DOM.kpiSaldoNegativo) DOM.kpiSaldoNegativo.textContent = formatarNumero(d.qt_saldo_negativo);
        if (DOM.kpiSemOrigem) DOM.kpiSemOrigem.textContent = formatarNumero(d.qt_sem_origem_critico);
        if (DOM.kpiComOrigem) DOM.kpiComOrigem.textContent = formatarNumero(d.qt_com_origem);
        if (DOM.kpiLocaisCriticos) DOM.kpiLocaisCriticos.textContent = formatarNumero(d.qt_locais_criticos);
    }

    function atualizarContadores() {
        if (DOM.totalFiltrados) DOM.totalFiltrados.textContent = Estado.dados.length;
        if (DOM.totalRegistros) DOM.totalRegistros.textContent = Estado.dados.length;
    }

    // =========================================================
    // ORDENACAO
    // =========================================================

    function ordenarDados() {
        var campo = Estado.ordenacao.campo;
        var dir = Estado.ordenacao.direcao;
        Estado.dados.sort(function(a, b) {
            var va = a[campo], vb = b[campo];
            if (va === null || va === undefined) va = '';
            if (vb === null || vb === undefined) vb = '';
            if (campo === 'consumo_dia' || campo === 'saldo_disponivel' || campo === 'dias_estoque' ||
                campo === 'qt_ressuprimento_3d' || campo === 'saldo_origem' || campo === 'dias_estoque_origem' ||
                campo === 'codigo_material' || campo === 'ordem_classificacao') {
                va = parseFloat(va) || 0;
                vb = parseFloat(vb) || 0;
            } else {
                va = String(va).toLowerCase();
                vb = String(vb).toLowerCase();
            }
            var r = 0;
            if (va < vb) r = -1;
            if (va > vb) r = 1;
            return dir === 'asc' ? r : -r;
        });
    }

    function alterarOrdenacao(campo) {
        if (Estado.ordenacao.campo === campo) {
            Estado.ordenacao.direcao = Estado.ordenacao.direcao === 'asc' ? 'desc' : 'asc';
        } else {
            Estado.ordenacao.campo = campo;
            Estado.ordenacao.direcao = 'asc';
        }
        ordenarDados();
        renderizarTabela();
    }

    // =========================================================
    // RENDERIZACAO
    // =========================================================

    var COLUNAS = [
        { campo: 'classificacao',       titulo: 'Status',       classe: 'col-classificacao' },
        { campo: 'local_estoque',       titulo: 'Local',        classe: 'col-local' },
        { campo: 'item',                titulo: 'Item',         classe: 'col-item' },
        { campo: 'grupo',               titulo: 'Grupo',        classe: 'col-grupo' },
        { campo: 'consumo_dia',         titulo: 'Consumo/Dia',  classe: 'col-consumo' },
        { campo: 'saldo_disponivel',    titulo: 'Saldo',        classe: 'col-saldo' },
        { campo: 'dias_estoque',        titulo: 'Dias Est.',    classe: 'col-dias' },
        { campo: 'qt_ressuprimento_3d', titulo: 'Repor p/ 3d',  classe: 'col-reposicao' },
        { campo: 'local_origem_sugerido', titulo: 'Origem Sugerida', classe: 'col-origem' },
        { campo: 'saldo_origem',        titulo: 'Saldo Orig.',  classe: 'col-saldo-origem' }
    ];

    function renderizarTabela() {
        if (!DOM.painelMain) return;
        var dados = Estado.dados;
        if (!dados || dados.length === 0) {
            DOM.painelMain.innerHTML = '<div class="mensagem-vazia"><i class="fas fa-check-circle"></i>' +
                '<h3>Nenhum item encontrado</h3><p>Ajuste os filtros para visualizar dados de estoque</p></div>';
            if (DOM.paginacaoIndicator) DOM.paginacaoIndicator.style.display = 'none';
            return;
        }
        ordenarDados();

        var cabHtml = '';
        for (var c = 0; c < COLUNAS.length; c++) {
            var col = COLUNAS[c];
            var ativa = Estado.ordenacao.campo === col.campo;
            var ico = ativa ? (Estado.ordenacao.direcao === 'asc' ? 'fa-sort-up' : 'fa-sort-down') : 'fa-sort';
            cabHtml += '<th class="' + col.classe + (ativa ? ' ativa' : '') + '" data-campo="' + col.campo + '">' +
                col.titulo + ' <i class="fas ' + ico + ' icone-sort"></i></th>';
        }

        var linHtml = '';
        for (var i = 0; i < dados.length; i++) {
            linHtml += criarLinha(dados[i]);
        }

        DOM.painelMain.innerHTML = '<div class="tabela-container">' +
            '<table class="tabela-estoque"><thead><tr>' + cabHtml + '</tr></thead>' +
            '<tbody id="tabela-body">' + linHtml + '</tbody></table></div>';

        var ths = document.querySelectorAll('.tabela-estoque thead th');
        for (var t = 0; t < ths.length; t++) {
            ths[t].addEventListener('click', function() {
                alterarOrdenacao(this.getAttribute('data-campo'));
            });
        }

        if (Estado.modoScroll === 'paginar') {
            calcularPaginas();
            mostrarPagina(0);
        } else {
            if (DOM.paginacaoIndicator) DOM.paginacaoIndicator.style.display = 'none';
        }
    }

    function criarLinha(reg) {
        var classif = (reg.classificacao || 'SEM CONSUMO').toUpperCase().replace(/ /g, '-').replace('É', 'E');
        var classeMap = {
            'DEVEDOR': 'linha-devedor',
            'ZERADO': 'linha-zerado',
            'CRITICO': 'linha-critico',
            'URGENTE': 'linha-urgente',
            'ATENCAO': 'linha-atencao',
            'ADEQUADO': 'linha-adequado',
            'CONFORTAVEL': 'linha-confortavel',
            'EXCESSO': 'linha-excesso',
            'SEM-CONSUMO': 'linha-sem-consumo'
        };
        var classeLinha = classeMap[classif] || '';

        var saldo = parseFloat(reg.saldo_disponivel) || 0;
        var classeSaldo = saldo < 0 ? 'saldo-negativo' : (saldo === 0 ? 'saldo-zero' : 'saldo-positivo');

        var dias = reg.dias_estoque;
        var classeDias = '';
        var diasTexto = '-';
        if (dias !== null && dias !== undefined && reg.consumo_dia > 0) {
            var diasNum = parseFloat(dias);
            diasTexto = formatarDecimal(diasNum);
            if (diasNum < 1) classeDias = 'dias-critico';
            else if (diasNum < 3) classeDias = 'dias-urgente';
            else classeDias = 'dias-ok';
        }

        var reposicao = parseFloat(reg.qt_ressuprimento_3d) || 0;
        var reposicaoTexto = reposicao > 0 ? formatarNumero(Math.ceil(reposicao)) : '-';
        var classeRepo = reposicao > 0 ? 'reposicao-valor' : '';

        // Indicador sutil para saldo
        var saldoHtml = '';
        if (saldo < 0) {
            saldoHtml = '<span class="saldo-chip saldo-chip-negativo"><i class="fas fa-arrow-down"></i> ' + formatarNumero(saldo) + '</span>';
        } else if (saldo === 0 && reg.consumo_dia > 0) {
            saldoHtml = '<span class="saldo-chip saldo-chip-zerado">0</span>';
        } else {
            saldoHtml = formatarNumero(saldo);
        }

        // Indicador sutil para reposicao
        var repoHtml = '';
        if (reposicao > 0) {
            var repoNivel = '';
            if (reposicao >= 100) repoNivel = 'repo-chip-alto';
            else if (reposicao >= 30) repoNivel = 'repo-chip-medio';
            else repoNivel = 'repo-chip-baixo';
            repoHtml = '<span class="repo-chip ' + repoNivel + '">' + formatarNumero(Math.ceil(reposicao)) + '</span>';
        } else {
            repoHtml = '-';
        }

        var origemTexto = reg.local_origem_sugerido
            ? '<span class="origem-sugerida">' + escapeHtml(abreviar(reg.local_origem_sugerido, 25)) + '</span>'
            : '<span class="sem-origem">-</span>';

        var saldoOrigemTexto = reg.saldo_origem !== null && reg.saldo_origem !== undefined
            ? formatarNumero(reg.saldo_origem)
            : '-';

        return '<tr class="' + classeLinha + '">' +
            '<td class="col-classificacao">' + getBadgeClassificacao(reg.classificacao) + '</td>' +
            '<td class="col-local" title="' + escapeHtml(reg.local_estoque) + '">' + escapeHtml(abreviar(reg.local_estoque, 28)) + '</td>' +
            '<td class="col-item" title="' + escapeHtml(reg.item) + ' (Cod: ' + escapeHtml(reg.codigo_material) + ')">' +
                '<span class="item-nome">' + escapeHtml(abreviar(reg.item, 35)) + '</span>' +
                '<span class="item-codigo">Cod. ' + escapeHtml(reg.codigo_material) + '</span>' +
            '</td>' +
            '<td class="col-grupo" title="' + escapeHtml(reg.grupo) + '">' + escapeHtml(abreviar(reg.grupo, 18)) + '</td>' +
            '<td class="col-consumo valor-numerico">' + formatarNumero(reg.consumo_dia) + '</td>' +
            '<td class="col-saldo valor-numerico ' + classeSaldo + '">' + saldoHtml + '</td>' +
            '<td class="col-dias valor-numerico ' + classeDias + '">' + diasTexto + '</td>' +
            '<td class="col-reposicao valor-numerico">' + repoHtml + '</td>' +
            '<td class="col-origem">' + origemTexto + '</td>' +
            '<td class="col-saldo-origem valor-numerico">' + saldoOrigemTexto + '</td>' +
            '</tr>';
    }

    function getBadgeClassificacao(classif) {
        if (!classif) return '<span class="badge badge-sem-consumo">S/ Consumo</span>';

        var map = {
            'DEVEDOR':     { classe: 'badge-devedor',     label: 'Devedor' },
            'ZERADO':      { classe: 'badge-zerado',      label: 'Zerado' },
            'CRITICO':     { classe: 'badge-critico',     label: 'Critico' },
            'URGENTE':     { classe: 'badge-urgente',     label: 'Urgente' },
            'ATENCAO':     { classe: 'badge-atencao',     label: 'Atencao' },
            'ADEQUADO':    { classe: 'badge-adequado',    label: 'Adequado' },
            'CONFORTAVEL': { classe: 'badge-confortavel', label: 'Confort.' },
            'EXCESSO':     { classe: 'badge-excesso',     label: 'Excesso' },
            'SEM CONSUMO': { classe: 'badge-sem-consumo', label: 'S/ Consumo' }
        };

        var info = map[classif.toUpperCase()];
        if (!info) return '<span class="badge badge-sem-consumo">' + escapeHtml(classif) + '</span>';
        return '<span class="badge ' + info.classe + '">' + info.label + '</span>';
    }

    function mostrarErro(msg) {
        if (!DOM.painelMain) return;
        DOM.painelMain.innerHTML = '<div class="mensagem-erro"><i class="fas fa-exclamation-triangle"></i>' +
            '<h3>Erro ao Carregar Dados</h3><p>' + escapeHtml(msg) + '</p>' +
            '<button class="btn-tentar-novamente" onclick="location.reload()">' +
            '<i class="fas fa-sync-alt"></i> Tentar Novamente</button></div>';
    }

    // =========================================================
    // RECOMENDACOES DE RESSUPRIMENTO (Carousel)
    // =========================================================

    function gerarRecomendacoes() {
        var recs = [];
        for (var i = 0; i < Estado.dados.length; i++) {
            var reg = Estado.dados[i];
            if (reg.tem_origem && reg.consumo_dia > 0 && reg.classificacao !== 'ADEQUADO' &&
                reg.classificacao !== 'CONFORTAVEL' && reg.classificacao !== 'EXCESSO' &&
                reg.classificacao !== 'SEM CONSUMO') {
                recs.push(reg);
            }
        }
        // Ordenar por gravidade (ordem_classificacao asc, dias_estoque asc)
        recs.sort(function(a, b) {
            var oa = (a.ordem_classificacao || 9), ob = (b.ordem_classificacao || 9);
            if (oa !== ob) return oa - ob;
            var da = parseFloat(a.dias_estoque) || 0, db = parseFloat(b.dias_estoque) || 0;
            return da - db;
        });
        return recs;
    }

    function renderizarRecomendacoes() {
        var recs = gerarRecomendacoes();
        Estado.recTotal = recs.length;
        Estado.recPaginaAtual = 0;

        if (!DOM.recomendacoesSection) return;

        if (recs.length === 0) {
            DOM.recomendacoesSection.classList.add('rec-vazio');
            pararRecCarousel();
            return;
        }

        DOM.recomendacoesSection.classList.remove('rec-vazio');

        if (DOM.recContador) {
            DOM.recContador.textContent = recs.length + ' movimentac' + (recs.length === 1 ? 'ao' : 'oes');
        }

        // Gerar cards
        var html = '';
        for (var i = 0; i < recs.length; i++) {
            var r = recs[i];
            var reposicao = Math.ceil(parseFloat(r.qt_ressuprimento_3d) || 0);
            var badgeClasse = getBadgeClasseRec(r.classificacao);

            html += '<div class="rec-card">' +
                '<div class="rec-lado-origem">' +
                    '<div class="rec-lado-icon"><i class="fas fa-warehouse"></i></div>' +
                    '<div class="rec-info">' +
                        '<span class="rec-local" title="' + escapeHtml(r.local_origem_sugerido) + '">' + escapeHtml(abreviar(r.local_origem_sugerido, 30)) + '</span>' +
                        '<span class="rec-material" title="' + escapeHtml(r.item) + '">' + escapeHtml(abreviar(r.item, 40)) + '</span>' +
                    '</div>' +
                    '<div class="rec-qtd rec-qtd-origem">' +
                        '<span class="rec-qtd-label">Saldo</span>' +
                        formatarNumero(r.saldo_origem) +
                    '</div>' +
                '</div>' +
                '<div class="rec-seta"><i class="fas fa-arrow-right"></i></div>' +
                '<div class="rec-lado-destino">' +
                    '<div class="rec-lado-icon"><i class="fas fa-hospital"></i></div>' +
                    '<div class="rec-info">' +
                        '<span class="rec-local" title="' + escapeHtml(r.local_estoque) + '">' + escapeHtml(abreviar(r.local_estoque, 30)) + '</span>' +
                        '<span class="rec-material">' + escapeHtml(abreviar(r.item, 40)) + '</span>' +
                        '<span class="rec-badge-classif ' + badgeClasse + '">' + escapeHtml(r.classificacao) + '</span>' +
                    '</div>' +
                    '<div class="rec-qtd rec-qtd-destino">' +
                        '<span class="rec-qtd-label">Repor</span>' +
                        formatarNumero(reposicao) +
                    '</div>' +
                '</div>' +
            '</div>';
        }

        if (DOM.recomendacoesTrack) DOM.recomendacoesTrack.innerHTML = html;

        // Dots
        renderizarRecDots();
        atualizarRecPagina();
        iniciarRecCarousel();
    }

    function getBadgeClasseRec(classif) {
        var map = {
            'DEVEDOR': 'badge-devedor',
            'ZERADO': 'badge-zerado',
            'CRITICO': 'badge-critico',
            'URGENTE': 'badge-urgente',
            'ATENCAO': 'badge-atencao'
        };
        return map[(classif || '').toUpperCase()] || 'badge-atencao';
    }

    function renderizarRecDots() {
        if (!DOM.recomendacoesDots) return;
        if (Estado.recTotal <= 1) { DOM.recomendacoesDots.innerHTML = ''; return; }
        var maxDots = Math.min(Estado.recTotal, 15);
        var html = '';
        for (var i = 0; i < maxDots; i++) {
            html += '<span class="rec-dot' + (i === 0 ? ' rec-dot-ativo' : '') + '" data-rec-idx="' + i + '"></span>';
        }
        DOM.recomendacoesDots.innerHTML = html;

        var dots = DOM.recomendacoesDots.querySelectorAll('.rec-dot');
        for (var d = 0; d < dots.length; d++) {
            dots[d].addEventListener('click', function() {
                var idx = parseInt(this.getAttribute('data-rec-idx'), 10);
                navegarRec(idx);
            });
        }
    }

    function navegarRec(idx) {
        if (idx < 0) idx = Estado.recTotal - 1;
        if (idx >= Estado.recTotal) idx = 0;
        Estado.recPaginaAtual = idx;

        if (DOM.recomendacoesTrack) {
            DOM.recomendacoesTrack.style.transform = 'translateX(-' + (idx * 100) + '%)';
        }
        atualizarRecPagina();

        // Atualizar dots
        if (DOM.recomendacoesDots) {
            var dots = DOM.recomendacoesDots.querySelectorAll('.rec-dot');
            for (var i = 0; i < dots.length; i++) {
                dots[i].classList.toggle('rec-dot-ativo', i === idx);
            }
        }
    }

    function atualizarRecPagina() {
        if (DOM.recPagina) {
            DOM.recPagina.textContent = (Estado.recPaginaAtual + 1) + '/' + Estado.recTotal;
        }
    }

    function iniciarRecCarousel() {
        pararRecCarousel();
        if (Estado.recTotal <= 1) return;
        Estado.recIntervalo = setInterval(function() {
            navegarRec(Estado.recPaginaAtual + 1);
        }, 5000);
    }

    function pararRecCarousel() {
        if (Estado.recIntervalo) {
            clearInterval(Estado.recIntervalo);
            Estado.recIntervalo = null;
        }
    }

    // =========================================================
    // MODO DE SCROLL
    // =========================================================

    function iniciarAutoScrollModo() {
        if (Estado.modoScroll === 'paginar') iniciarPaginado();
        else iniciarAutoScroll();
    }

    function alternarModoScroll() {
        var ativo = Estado.autoScrollAtivo;
        if (ativo) pararAutoScroll();
        Estado.modoScroll = Estado.modoScroll === 'rolar' ? 'paginar' : 'rolar';
        salvar('modoScroll', Estado.modoScroll);
        atualizarBotaoModoScroll();
        renderizarTabela();
        if (ativo) {
            Estado.autoScrollAtivo = true;
            atualizarBotaoScroll();
            setTimeout(function() { iniciarAutoScrollModo(); }, 500);
        }
    }

    function atualizarBotaoModoScroll() {
        if (!DOM.btnModoScroll) return;
        if (Estado.modoScroll === 'paginar') {
            DOM.btnModoScroll.innerHTML = '<i class="fas fa-columns"></i><span class="btn-text">Paginar</span>';
            DOM.btnModoScroll.classList.add('modo-paginado');
        } else {
            DOM.btnModoScroll.innerHTML = '<i class="fas fa-scroll"></i><span class="btn-text">Rolar</span>';
            DOM.btnModoScroll.classList.remove('modo-paginado');
        }
    }

    // =========================================================
    // AUTO-SCROLL ROLAGEM
    // =========================================================

    function getElementoScroll() { return document.getElementById('tabela-body'); }

    function iniciarAutoScroll() {
        pararScrollInterno();
        var el = getElementoScroll();
        if (!el) return;
        if (el.scrollHeight - el.clientHeight <= 5) return;
        Estado.watchdog = { ultimaPosicao: el.scrollTop, contadorTravamento: 0 };
        iniciarWatchdog();
        Estado.intervalos.scroll = setInterval(function() {
            if (!Estado.autoScrollAtivo) { pararAutoScroll(); return; }
            var e = getElementoScroll();
            if (!e) { pararAutoScroll(); return; }
            var sm = e.scrollHeight - e.clientHeight;
            if (e.scrollTop >= sm - 2) {
                clearInterval(Estado.intervalos.scroll);
                Estado.intervalos.scroll = null;
                setTimeout(function() {
                    if (!Estado.autoScrollAtivo) return;
                    e.scrollTop = 0;
                    Estado.watchdog.ultimaPosicao = 0;
                    Estado.watchdog.contadorTravamento = 0;
                    setTimeout(function() {
                        if (Estado.autoScrollAtivo) iniciarAutoScroll();
                    }, CONFIG.pausaAposReset);
                }, CONFIG.pausaNoFinal);
                return;
            }
            e.scrollTop += CONFIG.velocidadeScroll;
        }, CONFIG.intervaloScroll);
    }

    function pararScrollInterno() {
        if (Estado.intervalos.scroll) {
            clearInterval(Estado.intervalos.scroll);
            Estado.intervalos.scroll = null;
        }
        pararWatchdog();
    }

    // =========================================================
    // PAGINADO
    // =========================================================

    function calcularPaginas() {
        var tb = getElementoScroll();
        if (!tb) { Estado.totalPaginas = 0; return; }
        var av = tb.clientHeight, at = tb.scrollHeight;
        Estado.totalPaginas = (at <= av || av <= 0) ? 1 : Math.ceil(at / av);
        Estado.paginaAtual = 0;
        atualizarIndicadorPagina();
    }

    function mostrarPagina(idx) {
        var tb = getElementoScroll();
        if (!tb) return;
        if (idx < 0) idx = 0;
        if (idx >= Estado.totalPaginas) idx = 0;
        Estado.paginaAtual = idx;
        var av = tb.clientHeight, target = idx * av, sm = tb.scrollHeight - av;
        if (target > sm) target = sm;
        tb.classList.add('pagina-transicao');
        tb.scrollTop = target;
        setTimeout(function() { tb.classList.remove('pagina-transicao'); }, CONFIG.paginadoTransicao);
        atualizarIndicadorPagina();
    }

    function proximaPagina() {
        mostrarPagina(Estado.paginaAtual + 1 >= Estado.totalPaginas ? 0 : Estado.paginaAtual + 1);
    }

    function iniciarPaginado() {
        pararPaginado();
        calcularPaginas();
        if (Estado.totalPaginas <= 1) return;
        mostrarPagina(0);
        Estado.intervalos.paginado = setInterval(function() {
            if (!Estado.autoScrollAtivo) { pararPaginado(); return; }
            proximaPagina();
        }, CONFIG.paginadoTempo);
    }

    function pararPaginado() {
        if (Estado.intervalos.paginado) {
            clearInterval(Estado.intervalos.paginado);
            Estado.intervalos.paginado = null;
        }
    }

    function atualizarIndicadorPagina() {
        if (!DOM.paginacaoIndicator) return;
        if (Estado.modoScroll !== 'paginar' || Estado.totalPaginas <= 1) {
            DOM.paginacaoIndicator.style.display = 'none';
            return;
        }
        DOM.paginacaoIndicator.style.display = 'flex';
        if (DOM.paginacaoTexto) {
            DOM.paginacaoTexto.textContent = 'Pagina ' + (Estado.paginaAtual + 1) + ' de ' + Estado.totalPaginas;
        }
        if (DOM.paginacaoDots) {
            var h = '';
            for (var i = 0; i < Estado.totalPaginas; i++) {
                h += '<span class="paginacao-dot' + (i === Estado.paginaAtual ? ' dot-ativo' : '') +
                    '" data-pagina="' + i + '"></span>';
            }
            DOM.paginacaoDots.innerHTML = h;
            var dots = DOM.paginacaoDots.querySelectorAll('.paginacao-dot');
            for (var d = 0; d < dots.length; d++) {
                dots[d].addEventListener('click', function() {
                    mostrarPagina(parseInt(this.getAttribute('data-pagina'), 10));
                    if (Estado.intervalos.paginado) {
                        pararPaginado();
                        Estado.intervalos.paginado = setInterval(function() {
                            if (!Estado.autoScrollAtivo) { pararPaginado(); return; }
                            proximaPagina();
                        }, CONFIG.paginadoTempo);
                    }
                });
            }
        }
    }

    // =========================================================
    // WATCHDOG
    // =========================================================

    function iniciarWatchdog() {
        pararWatchdog();
        Estado.intervalos.watchdog = setInterval(function() {
            if (!Estado.autoScrollAtivo) { pararWatchdog(); return; }
            var e = getElementoScroll();
            if (!e) return;
            var p = e.scrollTop, sm = e.scrollHeight - e.clientHeight;
            if (p > 5 && p < sm - 5 && Math.abs(p - Estado.watchdog.ultimaPosicao) < 1 && Estado.intervalos.scroll !== null) {
                Estado.watchdog.contadorTravamento++;
                if (Estado.watchdog.contadorTravamento >= CONFIG.watchdogMaxTravamentos) {
                    pararScrollInterno();
                    setTimeout(function() {
                        if (Estado.autoScrollAtivo) {
                            Estado.watchdog.contadorTravamento = 0;
                            iniciarAutoScroll();
                        }
                    }, 1000);
                    return;
                }
            } else {
                Estado.watchdog.contadorTravamento = 0;
            }
            Estado.watchdog.ultimaPosicao = p;
        }, CONFIG.watchdogInterval);
    }

    function pararWatchdog() {
        if (Estado.intervalos.watchdog) {
            clearInterval(Estado.intervalos.watchdog);
            Estado.intervalos.watchdog = null;
        }
    }

    function pararAutoScroll() { pararScrollInterno(); pararPaginado(); }

    function atualizarBotaoScroll() {
        if (!DOM.btnAutoScroll) return;
        if (Estado.autoScrollAtivo) {
            DOM.btnAutoScroll.classList.add('ativo');
            DOM.btnAutoScroll.innerHTML = '<i class="fas fa-pause"></i><span class="btn-text">Pausar</span>';
        } else {
            DOM.btnAutoScroll.classList.remove('ativo');
            DOM.btnAutoScroll.innerHTML = '<i class="fas fa-play"></i><span class="btn-text">Auto Scroll</span>';
        }
    }

    function agendarAutoScrollInicial() {
        if (Estado.timeouts.autoScrollInicial) clearTimeout(Estado.timeouts.autoScrollInicial);
        Estado.timeouts.autoScrollInicial = setTimeout(function() {
            if (!Estado.autoScrollAtivo && Estado.dados.length > 0) {
                Estado.autoScrollAtivo = true;
                Estado.autoScrollIniciado = true;
                atualizarBotaoScroll();
                iniciarAutoScrollModo();
            }
        }, CONFIG.delayAutoScrollInicial);
    }

    // =========================================================
    // EXPORTACAO EXCEL
    // =========================================================

    var COLUNAS_EXPORT = [
        { campo: 'classificacao',         titulo: 'Classificacao',        sel: true },
        { campo: 'local_estoque',         titulo: 'Local Estoque',       sel: true },
        { campo: 'tipo_local',            titulo: 'Tipo Local',          sel: true },
        { campo: 'codigo_material',       titulo: 'Cod. Material',       sel: true },
        { campo: 'item',                  titulo: 'Item',                sel: true },
        { campo: 'grupo',                 titulo: 'Grupo',               sel: true },
        { campo: 'subgrupo',              titulo: 'Subgrupo',            sel: true },
        { campo: 'consumo_dia',           titulo: 'Consumo/Dia',         sel: true },
        { campo: 'saldo_disponivel',      titulo: 'Saldo Disponivel',    sel: true },
        { campo: 'dias_estoque',          titulo: 'Dias Estoque',        sel: true },
        { campo: 'qt_ressuprimento_3d',   titulo: 'Repor p/ 3 Dias',    sel: true },
        { campo: 'local_origem_sugerido', titulo: 'Origem Sugerida',     sel: true },
        { campo: 'saldo_origem',          titulo: 'Saldo Origem',        sel: true },
        { campo: 'dias_estoque_origem',   titulo: 'Dias Est. Origem',    sel: false },
        { campo: 'mes_estoque',           titulo: 'Mes Estoque',         sel: false },
        { campo: 'cd_local_estoque',      titulo: 'Cod. Local',          sel: false },
        { campo: 'ordem_classificacao',   titulo: 'Ordem Classif.',      sel: false }
    ];

    function abrirModalExportar() {
        if (!DOM.modalColunasGrid) return;
        var html = '';
        for (var i = 0; i < COLUNAS_EXPORT.length; i++) {
            var col = COLUNAS_EXPORT[i];
            html += '<div class="coluna-check' + (col.sel ? ' selecionada' : '') + '">' +
                '<input type="checkbox" id="exp-' + col.campo + '" value="' + col.campo + '"' +
                (col.sel ? ' checked' : '') + '>' +
                '<label for="exp-' + col.campo + '">' + col.titulo + '</label></div>';
        }
        DOM.modalColunasGrid.innerHTML = html;
        var checks = DOM.modalColunasGrid.querySelectorAll('input[type="checkbox"]');
        for (var j = 0; j < checks.length; j++) {
            checks[j].addEventListener('change', function() {
                this.parentElement.classList.toggle('selecionada', this.checked);
            });
        }
        if (DOM.modalExportInfo) DOM.modalExportInfo.textContent = Estado.dados.length + ' registros serao exportados';
        if (DOM.modalExportar) DOM.modalExportar.classList.add('ativo');
    }

    function fecharModalExportar() {
        if (DOM.modalExportar) DOM.modalExportar.classList.remove('ativo');
    }

    function toggleTodasColunas(marcar) {
        if (!DOM.modalColunasGrid) return;
        var checks = DOM.modalColunasGrid.querySelectorAll('input[type="checkbox"]');
        for (var i = 0; i < checks.length; i++) {
            checks[i].checked = marcar;
            checks[i].parentElement.classList.toggle('selecionada', marcar);
        }
    }

    function executarExportacao() {
        if (!DOM.modalColunasGrid) return;
        var checks = DOM.modalColunasGrid.querySelectorAll('input[type="checkbox"]:checked');
        var colsSel = [];
        for (var i = 0; i < checks.length; i++) {
            var campo = checks[i].value;
            for (var j = 0; j < COLUNAS_EXPORT.length; j++) {
                if (COLUNAS_EXPORT[j].campo === campo) { colsSel.push(COLUNAS_EXPORT[j]); break; }
            }
        }
        if (colsSel.length === 0) { alert('Selecione pelo menos uma coluna.'); return; }

        var header = [];
        for (var h = 0; h < colsSel.length; h++) header.push(colsSel[h].titulo);
        var rows = [header];
        for (var r = 0; r < Estado.dados.length; r++) {
            var reg = Estado.dados[r];
            var row = [];
            for (var c = 0; c < colsSel.length; c++) {
                var cp = colsSel[c].campo;
                var val = reg[cp];
                if (cp === 'consumo_dia' || cp === 'saldo_disponivel' || cp === 'dias_estoque' ||
                    cp === 'qt_ressuprimento_3d' || cp === 'saldo_origem' || cp === 'dias_estoque_origem') {
                    row.push(val !== null && val !== undefined ? parseFloat(val) : '');
                } else {
                    row.push(val !== null && val !== undefined ? String(val) : '');
                }
            }
            rows.push(row);
        }
        gerarExcel(rows, colsSel);
        fecharModalExportar();
    }

    function gerarExcel(rows, colunas) {
        if (typeof XLSX !== 'undefined') { criarArquivoExcel(rows, colunas); return; }
        var script = document.createElement('script');
        script.src = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
        script.onload = function() { criarArquivoExcel(rows, colunas); };
        script.onerror = function() { exportarCSV(rows); };
        document.head.appendChild(script);
    }

    function criarArquivoExcel(rows, colunas) {
        var wb = XLSX.utils.book_new();
        var ws = XLSX.utils.aoa_to_sheet(rows);
        var cw = [];
        for (var c = 0; c < colunas.length; c++) {
            var ml = colunas[c].titulo.length;
            for (var r = 1; r < rows.length && r < 100; r++) {
                var cl = String(rows[r][c] || '').length;
                if (cl > ml) ml = cl;
            }
            cw.push({ wch: Math.min(ml + 3, 40) });
        }
        ws['!cols'] = cw;
        XLSX.utils.book_append_sheet(wb, ws, 'Estoque-Dia');
        XLSX.writeFile(wb, 'Painel24_EstoqueDia_' + new Date().toISOString().slice(0, 10).replace(/-/g, '') + '.xlsx');
    }

    function exportarCSV(rows) {
        var csv = '';
        for (var r = 0; r < rows.length; r++) {
            var line = [];
            for (var c = 0; c < rows[r].length; c++) {
                line.push('"' + String(rows[r][c] || '').replace(/"/g, '""') + '"');
            }
            csv += line.join(';') + '\r\n';
        }
        var blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
        var link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = 'Painel24_EstoqueDia_' + new Date().toISOString().slice(0, 10).replace(/-/g, '') + '.csv';
        link.click();
        URL.revokeObjectURL(link.href);
    }

    // =========================================================
    // TOGGLE FILTROS (RECOLHER/EXPANDIR)
    // =========================================================

    function toggleFiltros() {
        Estado.filtrosRecolhidos = !Estado.filtrosRecolhidos;
        if (DOM.headerControls) DOM.headerControls.classList.toggle('recolhido', Estado.filtrosRecolhidos);
        if (DOM.btnToggleFiltros) DOM.btnToggleFiltros.classList.toggle('recolhido', Estado.filtrosRecolhidos);
        salvar('filtrosRecolhidos', Estado.filtrosRecolhidos ? '1' : '0');
    }

    // =========================================================
    // CARREGAR FILTROS DINAMICOS
    // =========================================================

    function carregarFiltrosDinamicos() {
        fetchComRetry(CONFIG.api.filtros)
            .then(function(resp) {
                if (!resp.success) return;
                var f = resp.filtros;
                if (f.locais) popularMultiSelectLocais('ms-local', f.locais);
                if (f.tipos_local) popularMultiSelectDinamico('ms-tipo-local', f.tipos_local);
                if (f.grupos) popularMultiSelectDinamico('ms-grupo', f.grupos);
                if (f.subgrupos) popularMultiSelectDinamico('ms-subgrupo', f.subgrupos);
                if (f.classificacoes) popularMultiSelectDinamico('ms-classificacao', f.classificacoes);
            })
            .catch(function(err) { console.warn('[P24] Erro filtros:', err); });
    }

    // =========================================================
    // TOGGLE BUTTONS
    // =========================================================

    function atualizarBotaoToggle(btn, ativo) {
        if (!btn) return;
        if (ativo) {
            btn.classList.add('ativo');
            btn.setAttribute('aria-pressed', 'true');
        } else {
            btn.classList.remove('ativo');
            btn.setAttribute('aria-pressed', 'false');
        }
    }

    // =========================================================
    // EVENTOS
    // =========================================================

    function configurarEventos() {
        configurarToggleMultiSelects();

        // Busca com debounce
        if (DOM.filtroBusca) {
            DOM.filtroBusca.addEventListener('input', function() {
                var v = this.value;
                if (Estado.timeouts.debounce) clearTimeout(Estado.timeouts.debounce);
                Estado.timeouts.debounce = setTimeout(function() {
                    Estado.filtros.busca = v;
                    salvar('busca', v);
                    carregarDados();
                }, CONFIG.debounceMs);
            });
        }

        // Toggle: Ocultar sem consumo
        if (DOM.btnOcultarSemConsumo) {
            DOM.btnOcultarSemConsumo.addEventListener('click', function() {
                Estado.ocultarSemConsumo = !Estado.ocultarSemConsumo;
                atualizarBotaoToggle(DOM.btnOcultarSemConsumo, Estado.ocultarSemConsumo);
                salvar('ocultarSemConsumo', Estado.ocultarSemConsumo ? '1' : '0');
                carregarDados();
            });
        }

        // Toggle: Ocultar carrinhos/maletas
        if (DOM.btnOcultarCarrinhos) {
            DOM.btnOcultarCarrinhos.addEventListener('click', function() {
                Estado.ocultarCarrinhos = !Estado.ocultarCarrinhos;
                atualizarBotaoToggle(DOM.btnOcultarCarrinhos, Estado.ocultarCarrinhos);
                salvar('ocultarCarrinhos', Estado.ocultarCarrinhos ? '1' : '0');
                carregarDados();
            });
        }

        // Toggle: Apenas criticos
        if (DOM.btnApenasCriticos) {
            DOM.btnApenasCriticos.addEventListener('click', function() {
                Estado.apenasCriticos = !Estado.apenasCriticos;
                atualizarBotaoToggle(DOM.btnApenasCriticos, Estado.apenasCriticos);
                salvar('apenasCriticos', Estado.apenasCriticos ? '1' : '0');
                carregarDados();
            });
        }

        // Toggle filtros
        if (DOM.btnToggleFiltros) DOM.btnToggleFiltros.addEventListener('click', toggleFiltros);

        // Modo scroll
        if (DOM.btnModoScroll) DOM.btnModoScroll.addEventListener('click', alternarModoScroll);

        // Recomendacoes navegacao
        if (DOM.recPrev) {
            DOM.recPrev.addEventListener('click', function() {
                navegarRec(Estado.recPaginaAtual - 1);
                pararRecCarousel();
                iniciarRecCarousel();
            });
        }
        if (DOM.recNext) {
            DOM.recNext.addEventListener('click', function() {
                navegarRec(Estado.recPaginaAtual + 1);
                pararRecCarousel();
                iniciarRecCarousel();
            });
        }

        // Exportar
        if (DOM.btnExportar) DOM.btnExportar.addEventListener('click', abrirModalExportar);
        if (DOM.btnExportarConfirmar) DOM.btnExportarConfirmar.addEventListener('click', executarExportacao);
        if (DOM.btnExportarCancelar) DOM.btnExportarCancelar.addEventListener('click', fecharModalExportar);
        if (DOM.modalExportarFechar) DOM.modalExportarFechar.addEventListener('click', fecharModalExportar);
        if (DOM.modalExportar) {
            DOM.modalExportar.addEventListener('click', function(e) {
                if (e.target === DOM.modalExportar) fecharModalExportar();
            });
        }
        if (DOM.btnSelecionarTodas) DOM.btnSelecionarTodas.addEventListener('click', function() { toggleTodasColunas(true); });
        if (DOM.btnDesmarcarTodas) DOM.btnDesmarcarTodas.addEventListener('click', function() { toggleTodasColunas(false); });

        // Limpar filtros
        if (DOM.btnLimpar) {
            DOM.btnLimpar.addEventListener('click', function() {
                Estado.filtros = { busca: '' };
                Estado.ocultarSemConsumo = false;
                Estado.ocultarCarrinhos = false;
                Estado.apenasCriticos = false;
                if (DOM.filtroBusca) DOM.filtroBusca.value = '';
                resetarTodosMultiSelects();
                atualizarBotaoToggle(DOM.btnOcultarSemConsumo, false);
                atualizarBotaoToggle(DOM.btnOcultarCarrinhos, false);
                atualizarBotaoToggle(DOM.btnApenasCriticos, false);
                salvar('busca', '');
                salvar('ocultarSemConsumo', '0');
                salvar('ocultarCarrinhos', '0');
                salvar('apenasCriticos', '0');
                carregarDados();
            });
        }

        // Botoes
        if (DOM.btnVoltar) DOM.btnVoltar.addEventListener('click', function() { window.location.href = '/frontend/dashboard.html'; });
        if (DOM.btnRefresh) {
            DOM.btnRefresh.addEventListener('click', function() {
                DOM.btnRefresh.classList.add('girando');
                carregarDados().then(function() {
                    setTimeout(function() { DOM.btnRefresh.classList.remove('girando'); }, 500);
                });
            });
        }
        if (DOM.btnAutoScroll) {
            DOM.btnAutoScroll.addEventListener('click', function() {
                Estado.autoScrollAtivo = !Estado.autoScrollAtivo;
                Estado.autoScrollIniciado = true;
                atualizarBotaoScroll();
                if (Estado.autoScrollAtivo) iniciarAutoScrollModo();
                else pararAutoScroll();
            });
        }

        // Teclado
        document.addEventListener('keydown', function(e) {
            if (e.key === 'Escape') {
                if (DOM.modalExportar && DOM.modalExportar.classList.contains('ativo')) { fecharModalExportar(); return; }
                if (Estado.dropdownAberto) fecharTodosDropdowns();
                else if (Estado.autoScrollAtivo) { Estado.autoScrollAtivo = false; atualizarBotaoScroll(); pararAutoScroll(); }
            }
            if (e.key === 'F5') { e.preventDefault(); carregarDados(); }
            if (e.key === ' ' && e.target === document.body) {
                e.preventDefault();
                Estado.autoScrollAtivo = !Estado.autoScrollAtivo;
                Estado.autoScrollIniciado = true;
                atualizarBotaoScroll();
                if (Estado.autoScrollAtivo) iniciarAutoScrollModo();
                else pararAutoScroll();
            }
            if (Estado.modoScroll === 'paginar') {
                if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { e.preventDefault(); proximaPagina(); }
                if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
                    e.preventDefault();
                    mostrarPagina(Estado.paginaAtual - 1 < 0 ? Estado.totalPaginas - 1 : Estado.paginaAtual - 1);
                }
            }
        });

        document.addEventListener('visibilitychange', function() {
            if (document.hidden) {
                if (Estado.autoScrollAtivo) { pararAutoScroll(); Estado.autoScrollAtivo = true; }
                pararRecCarousel();
            } else {
                if (Estado.autoScrollAtivo) iniciarAutoScrollModo();
                if (Estado.recTotal > 1) iniciarRecCarousel();
                carregarDados();
            }
        });
    }

    // =========================================================
    // INICIALIZACAO
    // =========================================================

    function inicializar() {
        console.log('[P24] Inicializando...');
        cachearElementos();

        // Restaurar filtros simples
        var buscaSalva = recuperar('busca');
        if (buscaSalva) Estado.filtros.busca = buscaSalva;

        // Restaurar toggles
        Estado.ocultarSemConsumo = recuperar('ocultarSemConsumo') === '1';
        Estado.ocultarCarrinhos = recuperar('ocultarCarrinhos') === '1';
        Estado.apenasCriticos = recuperar('apenasCriticos') === '1';
        atualizarBotaoToggle(DOM.btnOcultarSemConsumo, Estado.ocultarSemConsumo);
        atualizarBotaoToggle(DOM.btnOcultarCarrinhos, Estado.ocultarCarrinhos);
        atualizarBotaoToggle(DOM.btnApenasCriticos, Estado.apenasCriticos);

        // Restaurar filtros recolhidos
        Estado.filtrosRecolhidos = recuperar('filtrosRecolhidos') === '1';
        if (Estado.filtrosRecolhidos) {
            if (DOM.headerControls) DOM.headerControls.classList.add('recolhido');
            if (DOM.btnToggleFiltros) DOM.btnToggleFiltros.classList.add('recolhido');
        }

        // Restaurar modo scroll
        var modoSalvo = recuperar('modoScroll');
        if (modoSalvo) Estado.modoScroll = modoSalvo;
        atualizarBotaoModoScroll();

        // Restaurar campos de input
        if (DOM.filtroBusca) DOM.filtroBusca.value = Estado.filtros.busca;

        // Restaurar arrays multi-select do localStorage ANTES do primeiro carregarDados
        Estado.multiLocal = recuperarArray('multiLocal');
        Estado.multiTipoLocal = recuperarArray('multiTipoLocal');
        Estado.multiGrupo = recuperarArray('multiGrupo');
        Estado.multiSubgrupo = recuperarArray('multiSubgrupo');
        Estado.multiClassificacao = recuperarArray('multiClassificacao');

        configurarEventos();
        carregarFiltrosDinamicos();
        carregarDados();

        Estado.intervalos.refresh = setInterval(function() { carregarDados(); }, CONFIG.intervaloRefresh);
        console.log('[P24] Inicializado com sucesso');
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', inicializar);
    else inicializar();

})();