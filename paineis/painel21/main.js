/**
 * PAINEL 21 - Evolucao de Contas
 * Sistema de Paineis Hospitalares - Hospital Anchieta
 *
 * Funcionalidades:
 * - Listagem de contas do ciclo de faturamento
 * - Multi-select generico para: Status, Tipo, Protocolo, Convenio, Setor, Etapa
 * - Filtros simples: periodo, legenda, busca, datas, valor min/max
 * - Botao excluir zerados
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
            dashboard: '/api/paineis/painel21/dashboard',
            dados: '/api/paineis/painel21/dados',
            filtros: '/api/paineis/painel21/filtros'
        },
        intervaloRefresh: 120000,
        velocidadeScroll: 0.6,
        intervaloScroll: 50,
        pausaNoFinal: 6000,
        pausaAposReset: 4000,
        delayAutoScrollInicial: 10000,
        watchdogInterval: 5000,
        watchdogMaxTravamentos: 3,
        maxTentativasConexao: 3,
        timeoutRequisicao: 30000,
        debounceMs: 400,
        storagePrefix: 'painel21_',
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
        ordenacao: { campo: 'dt_conta', direcao: 'desc' },
        filtros: {
            periodo: '30',
            legenda: '',
            busca: '',
            dt_inicio: '',
            dt_fim: '',
            vl_min: '',
            vl_max: ''
        },
        multiStatus: [],
        multiTipo: [],
        multiProtocolo: [],
        multiConvenio: [],
        multiSetor: [],
        multiEtapa: [],
        excluirZerados: false,
        filtrosRecolhidos: false,
        modoScroll: 'rolar',
        paginaAtual: 0,
        totalPaginas: 0,
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
        DOM.totalRegistros = document.getElementById('total-registros');

        DOM.kpiTotalContas = document.getElementById('kpi-total-contas');
        DOM.kpiValorTotal = document.getElementById('kpi-valor-total');
        DOM.kpiProvisorio = document.getElementById('kpi-provisorio');
        DOM.kpiDefinitivo = document.getElementById('kpi-definitivo');
        DOM.kpiSemNf = document.getElementById('kpi-sem-nf');
        DOM.kpiEmProtocolo = document.getElementById('kpi-em-protocolo');

        DOM.filtroPeriodo = document.getElementById('filtro-periodo');
        DOM.filtroLegenda = document.getElementById('filtro-legenda');
        DOM.filtroBusca = document.getElementById('filtro-busca');
        DOM.filtroDtInicio = document.getElementById('filtro-dt-inicio');
        DOM.filtroDtFim = document.getElementById('filtro-dt-fim');
        DOM.filtroVlMin = document.getElementById('filtro-vl-min');
        DOM.filtroVlMax = document.getElementById('filtro-vl-max');

        DOM.paginacaoIndicator = document.getElementById('paginacao-indicator');
        DOM.paginacaoTexto = document.getElementById('paginacao-texto');
        DOM.paginacaoDots = document.getElementById('paginacao-dots');

        DOM.btnExcluirZerados = document.getElementById('btn-excluir-zerados');
        DOM.btnLimpar = document.getElementById('btn-limpar');
        DOM.btnVoltar = document.getElementById('btn-voltar');
        DOM.btnRefresh = document.getElementById('btn-refresh');
        DOM.btnAutoScroll = document.getElementById('btn-auto-scroll');
        DOM.btnModoScroll = document.getElementById('btn-modo-scroll');
        DOM.btnToggleFiltros = document.getElementById('btn-toggle-filtros');
        DOM.headerControls = document.getElementById('header-controls');

        // Exportacao
        DOM.btnExportar = document.getElementById('btn-exportar');
        DOM.modalExportar = document.getElementById('modal-exportar');
        DOM.modalColunasGrid = document.getElementById('modal-colunas-grid');
        DOM.modalExportInfo = document.getElementById('modal-export-info');
        DOM.btnExportarConfirmar = document.getElementById('btn-exportar-confirmar');
        DOM.btnExportarCancelar = document.getElementById('btn-exportar-cancelar');
        DOM.modalExportarFechar = document.getElementById('modal-exportar-fechar');
        DOM.btnSelecionarTodas = document.getElementById('btn-selecionar-todas');
        DOM.btnDesmarcarTodas = document.getElementById('btn-desmarcar-todas');
    }

    // =========================================================
    // UTILITARIOS
    // =========================================================

    function escapeHtml(t) { if (!t) return '-'; var d = document.createElement('div'); d.textContent = t; return d.innerHTML; }

    function formatarNome(n) {
        if (!n || n.trim() === '') return '-';
        var p = n.trim().toUpperCase().split(/\s+/);
        if (p.length <= 2) return n.trim();
        var ini = [];
        for (var i = 0; i < p.length - 1; i++) ini.push(p[i].charAt(0));
        return ini.join(' ') + ' ' + p[p.length - 1];
    }

    function formatarMoeda(v) { if (v === null || v === undefined || isNaN(v)) return '-'; return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v); }

    function formatarMoedaCurta(v) {
        if (v === null || v === undefined || isNaN(v)) return '-';
        v = parseFloat(v);
        if (v >= 1000000) return 'R$ ' + (v / 1000000).toFixed(1) + 'M';
        if (v >= 1000) return 'R$ ' + (v / 1000).toFixed(1) + 'K';
        return formatarMoeda(v);
    }

    function formatarData(iso) {
        if (!iso) return '-';
        try { var d = new Date(iso); if (isNaN(d.getTime())) return '-'; return ('0'+d.getDate()).slice(-2)+'/'+('0'+(d.getMonth()+1)).slice(-2)+'/'+d.getFullYear(); }
        catch(e) { return '-'; }
    }

    function formatarNumero(v) { if (v === null || v === undefined || isNaN(v)) return '-'; return new Intl.NumberFormat('pt-BR').format(v); }
    function abreviar(t, m) { if (!t) return '-'; return t.length > m ? t.substring(0, m) + '...' : t; }

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
                    .catch(function(e) { clearTimeout(timer); if (n > 1) setTimeout(function() { tentar(n-1); }, 1000); else reject(e); });
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
    // CONSTRUIR URL COM TODOS OS FILTROS
    // =========================================================

    function construirParams() {
        var params = [];
        var f = Estado.filtros;
        if (f.periodo)   params.push('dias=' + encodeURIComponent(f.periodo));
        if (f.legenda)   params.push('legenda=' + encodeURIComponent(f.legenda));
        if (f.busca)     params.push('busca=' + encodeURIComponent(f.busca));
        if (f.dt_inicio) params.push('dt_inicio=' + encodeURIComponent(f.dt_inicio));
        if (f.dt_fim)    params.push('dt_fim=' + encodeURIComponent(f.dt_fim));
        if (f.vl_min)    params.push('vl_min=' + encodeURIComponent(f.vl_min));
        if (f.vl_max)    params.push('vl_max=' + encodeURIComponent(f.vl_max));
        if (Estado.multiStatus.length > 0)    params.push('status_conta=' + encodeURIComponent(Estado.multiStatus.join(',')));
        if (Estado.multiTipo.length > 0)      params.push('tipo=' + encodeURIComponent(Estado.multiTipo.join(',')));
        if (Estado.multiProtocolo.length > 0) params.push('status_protocolo=' + encodeURIComponent(Estado.multiProtocolo.join(',')));
        if (Estado.multiConvenio.length > 0)  params.push('convenio=' + encodeURIComponent(Estado.multiConvenio.join(',')));
        if (Estado.multiSetor.length > 0)     params.push('setor=' + encodeURIComponent(Estado.multiSetor.join(',')));
        if (Estado.multiEtapa.length > 0)     params.push('etapa=' + encodeURIComponent(Estado.multiEtapa.join(',')));
        if (Estado.excluirZerados) params.push('excluir_zerados=1');
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
            renderizarTabela();
            atualizarContadores();
            atualizarHorario();
            atualizarStatus('online');
            Estado.errosConsecutivos = 0;
            if (scrollEstaAtivo) { setTimeout(function() { Estado.autoScrollAtivo = true; atualizarBotaoScroll(); iniciarAutoScrollModo(); }, 500); }
            if (!Estado.autoScrollIniciado && !scrollEstaAtivo) agendarAutoScrollInicial();
        })
        .catch(function(err) {
            console.error('[P21] Erro:', err);
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
        if (DOM.kpiTotalContas) DOM.kpiTotalContas.textContent = formatarNumero(d.total_contas);
        if (DOM.kpiValorTotal) DOM.kpiValorTotal.textContent = formatarMoedaCurta(d.vl_total);
        if (DOM.kpiProvisorio) DOM.kpiProvisorio.textContent = formatarNumero(d.qt_provisorio);
        if (DOM.kpiDefinitivo) DOM.kpiDefinitivo.textContent = formatarNumero(d.qt_definitivo);
        if (DOM.kpiSemNf) DOM.kpiSemNf.textContent = formatarNumero(d.qt_sem_nf_titulo);
        if (DOM.kpiEmProtocolo) DOM.kpiEmProtocolo.textContent = formatarNumero(d.qt_em_protocolo);
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
            if (campo === 'vl_conta' || campo === 'nr_atendimento' || campo === 'nr_conta' || campo === 'dias_aging' || campo === 'ie_tipo') { va = parseFloat(va) || 0; vb = parseFloat(vb) || 0; }
            else if (campo.indexOf('dt_') === 0) { va = new Date(va || 0).getTime(); vb = new Date(vb || 0).getTime(); }
            else { va = String(va).toLowerCase(); vb = String(vb).toLowerCase(); }
            var r = 0; if (va < vb) r = -1; if (va > vb) r = 1;
            return dir === 'asc' ? r : -r;
        });
    }

    function alterarOrdenacao(campo) {
        if (Estado.ordenacao.campo === campo) Estado.ordenacao.direcao = Estado.ordenacao.direcao === 'asc' ? 'desc' : 'asc';
        else { Estado.ordenacao.campo = campo; Estado.ordenacao.direcao = 'asc'; }
        ordenarDados(); renderizarTabela();
    }

    // =========================================================
    // RENDERIZACAO
    // =========================================================

    var COLUNAS = [
        { campo: 'dt_conta',            titulo: 'Dt. Conta',    classe: 'col-dt-conta' },
        { campo: 'nr_atendimento',      titulo: 'Atend.',       classe: 'col-atendimento' },
        { campo: 'nr_conta',            titulo: 'Nr. Conta',    classe: 'col-nr-conta' },
        { campo: 'pessoa_fisica',       titulo: 'Paciente',     classe: 'col-paciente' },
        { campo: 'tipo_atend',          titulo: 'Tipo Atend.',  classe: 'col-tipo' },
        { campo: 'dt_periodo_inicial',  titulo: 'Dt. Inicio',   classe: 'col-dt-inicio' },
        { campo: 'dt_periodo_final',    titulo: 'Dt. Fim',      classe: 'col-dt-fim' },
        { campo: 'convenio',            titulo: 'Convenio',     classe: 'col-convenio' },
        { campo: 'vl_conta',            titulo: 'Valor',        classe: 'col-valor' },
        { campo: 'setor_atendimento',   titulo: 'Setor',        classe: 'col-setor' },
        { campo: 'etapa_conta',         titulo: 'Etapa',        classe: 'col-etapa' }
    ];

    function renderizarTabela() {
        if (!DOM.painelMain) return;
        var dados = Estado.dados;
        if (!dados || dados.length === 0) {
            DOM.painelMain.innerHTML = '<div class="mensagem-vazia"><i class="fas fa-check-circle"></i><h3>Nenhuma conta encontrada</h3><p>Ajuste os filtros para visualizar dados</p></div>';
            if (DOM.paginacaoIndicator) DOM.paginacaoIndicator.style.display = 'none';
            return;
        }
        ordenarDados();
        var cabHtml = '';
        for (var c = 0; c < COLUNAS.length; c++) {
            var col = COLUNAS[c]; var ativa = Estado.ordenacao.campo === col.campo;
            var ico = ativa ? (Estado.ordenacao.direcao === 'asc' ? 'fa-sort-up' : 'fa-sort-down') : 'fa-sort';
            cabHtml += '<th class="' + col.classe + (ativa ? ' ativa' : '') + '" data-campo="' + col.campo + '">' + col.titulo + ' <i class="fas ' + ico + ' icone-sort"></i></th>';
        }
        var linHtml = '';
        for (var i = 0; i < dados.length; i++) linHtml += criarLinha(dados[i]);
        DOM.painelMain.innerHTML = '<div class="tabela-container"><table class="tabela-contas"><thead><tr>' + cabHtml + '</tr></thead><tbody id="tabela-body">' + linHtml + '</tbody></table></div>';
        var ths = document.querySelectorAll('.tabela-contas thead th');
        for (var t = 0; t < ths.length; t++) ths[t].addEventListener('click', function() { alterarOrdenacao(this.getAttribute('data-campo')); });
        if (Estado.modoScroll === 'paginar') { calcularPaginas(); mostrarPagina(0); }
        else { if (DOM.paginacaoIndicator) DOM.paginacaoIndicator.style.display = 'none'; }
    }

    function criarLinha(reg) {
        var cl = '';
        if (reg.legenda_conta === 'SEM NOTA/TITULO') cl = ' linha-sem-nf';
        else if (reg.legenda_conta === 'EM PROTOCOLO') cl = ' linha-em-protocolo';
        else if (reg.legenda_conta === 'NOTA FISCAL' || reg.legenda_conta === 'TITULO GERADO') cl = ' linha-concluida';
        var vl = parseFloat(reg.vl_conta) || 0;
        var cv = ''; if (vl >= 50000) cv = ' valor-alto'; else if (vl >= 10000) cv = ' valor-medio';
        return '<tr class="' + cl + '">' +
            '<td class="col-dt-conta">' + formatarData(reg.dt_conta) + '</td>' +
            '<td class="col-atendimento"><strong>' + escapeHtml(reg.nr_atendimento) + '</strong></td>' +
            '<td class="col-nr-conta">' + escapeHtml(reg.nr_conta) + '</td>' +
            '<td class="col-paciente">' + escapeHtml(formatarNome(reg.pessoa_fisica)) + '</td>' +
            '<td class="col-tipo">' + getBadgeTipo(reg.ie_tipo, reg.tipo_atend) + '</td>' +
            '<td class="col-dt-inicio">' + formatarData(reg.dt_periodo_inicial) + '</td>' +
            '<td class="col-dt-fim">' + formatarData(reg.dt_periodo_final) + '</td>' +
            '<td class="col-convenio">' + escapeHtml(abreviar(reg.convenio, 20)) + '</td>' +
            '<td class="col-valor valor-moeda' + cv + '">' + formatarMoeda(vl) + '</td>' +
            '<td class="col-setor">' + escapeHtml(abreviar(reg.setor_atendimento, 22)) + '</td>' +
            '<td class="col-etapa">' + escapeHtml(abreviar(reg.etapa_conta, 22)) + '</td></tr>';
    }

    function getBadgeTipo(ie, desc) {
        var map = { 1: 'badge-internado', 3: 'badge-ps', 7: 'badge-externo', 8: 'badge-ambulatorial' };
        var lbl = { 1: 'Internado', 3: 'Pronto Soc.', 7: 'Externo', 8: 'Ambulat.' };
        return '<span class="badge ' + (map[ie]||'') + '">' + escapeHtml(lbl[ie] || (desc ? abreviar(desc, 12) : '-')) + '</span>';
    }

    function mostrarErro(msg) {
        if (!DOM.painelMain) return;
        DOM.painelMain.innerHTML = '<div class="mensagem-erro"><i class="fas fa-exclamation-triangle"></i><h3>Erro ao Carregar Dados</h3><p>' + escapeHtml(msg) + '</p><button class="btn-tentar-novamente" onclick="location.reload()"><i class="fas fa-sync-alt"></i> Tentar Novamente</button></div>';
    }

    // =========================================================
    // MODO DE SCROLL
    // =========================================================

    function iniciarAutoScrollModo() { if (Estado.modoScroll === 'paginar') iniciarPaginado(); else iniciarAutoScroll(); }

    function alternarModoScroll() {
        var ativo = Estado.autoScrollAtivo;
        if (ativo) pararAutoScroll();
        Estado.modoScroll = Estado.modoScroll === 'rolar' ? 'paginar' : 'rolar';
        salvar('modoScroll', Estado.modoScroll); atualizarBotaoModoScroll(); renderizarTabela();
        if (ativo) { Estado.autoScrollAtivo = true; atualizarBotaoScroll(); setTimeout(function() { iniciarAutoScrollModo(); }, 500); }
    }

    function atualizarBotaoModoScroll() {
        if (!DOM.btnModoScroll) return;
        if (Estado.modoScroll === 'paginar') { DOM.btnModoScroll.innerHTML = '<i class="fas fa-columns"></i><span class="btn-text">Paginar</span>'; DOM.btnModoScroll.classList.add('modo-paginado'); }
        else { DOM.btnModoScroll.innerHTML = '<i class="fas fa-scroll"></i><span class="btn-text">Rolar</span>'; DOM.btnModoScroll.classList.remove('modo-paginado'); }
    }

    // =========================================================
    // AUTO-SCROLL ROLAGEM
    // =========================================================

    function getElementoScroll() { return document.getElementById('tabela-body'); }

    function iniciarAutoScroll() {
        pararScrollInterno();
        var el = getElementoScroll(); if (!el) return;
        if (el.scrollHeight - el.clientHeight <= 5) return;
        Estado.watchdog = { ultimaPosicao: el.scrollTop, contadorTravamento: 0 };
        iniciarWatchdog();
        Estado.intervalos.scroll = setInterval(function() {
            if (!Estado.autoScrollAtivo) { pararAutoScroll(); return; }
            var e = getElementoScroll(); if (!e) { pararAutoScroll(); return; }
            var sm = e.scrollHeight - e.clientHeight;
            if (e.scrollTop >= sm - 2) {
                clearInterval(Estado.intervalos.scroll); Estado.intervalos.scroll = null;
                setTimeout(function() { if (!Estado.autoScrollAtivo) return; e.scrollTop = 0; Estado.watchdog.ultimaPosicao = 0; Estado.watchdog.contadorTravamento = 0; setTimeout(function() { if (Estado.autoScrollAtivo) iniciarAutoScroll(); }, CONFIG.pausaAposReset); }, CONFIG.pausaNoFinal);
                return;
            }
            e.scrollTop += CONFIG.velocidadeScroll;
        }, CONFIG.intervaloScroll);
    }

    function pararScrollInterno() { if (Estado.intervalos.scroll) { clearInterval(Estado.intervalos.scroll); Estado.intervalos.scroll = null; } pararWatchdog(); }

    // =========================================================
    // PAGINADO
    // =========================================================

    function calcularPaginas() {
        var tb = getElementoScroll(); if (!tb) { Estado.totalPaginas = 0; return; }
        var av = tb.clientHeight, at = tb.scrollHeight;
        Estado.totalPaginas = (at <= av || av <= 0) ? 1 : Math.ceil(at / av);
        Estado.paginaAtual = 0; atualizarIndicadorPagina();
    }

    function mostrarPagina(idx) {
        var tb = getElementoScroll(); if (!tb) return;
        if (idx < 0) idx = 0; if (idx >= Estado.totalPaginas) idx = 0;
        Estado.paginaAtual = idx;
        var av = tb.clientHeight, target = idx * av, sm = tb.scrollHeight - av;
        if (target > sm) target = sm;
        tb.classList.add('pagina-transicao'); tb.scrollTop = target;
        setTimeout(function() { tb.classList.remove('pagina-transicao'); }, CONFIG.paginadoTransicao);
        atualizarIndicadorPagina();
    }

    function proximaPagina() { mostrarPagina(Estado.paginaAtual + 1 >= Estado.totalPaginas ? 0 : Estado.paginaAtual + 1); }

    function iniciarPaginado() {
        pararPaginado(); calcularPaginas();
        if (Estado.totalPaginas <= 1) return;
        mostrarPagina(0);
        Estado.intervalos.paginado = setInterval(function() { if (!Estado.autoScrollAtivo) { pararPaginado(); return; } proximaPagina(); }, CONFIG.paginadoTempo);
    }

    function pararPaginado() { if (Estado.intervalos.paginado) { clearInterval(Estado.intervalos.paginado); Estado.intervalos.paginado = null; } }

    function atualizarIndicadorPagina() {
        if (!DOM.paginacaoIndicator) return;
        if (Estado.modoScroll !== 'paginar' || Estado.totalPaginas <= 1) { DOM.paginacaoIndicator.style.display = 'none'; return; }
        DOM.paginacaoIndicator.style.display = 'flex';
        if (DOM.paginacaoTexto) DOM.paginacaoTexto.textContent = 'Pagina ' + (Estado.paginaAtual + 1) + ' de ' + Estado.totalPaginas;
        if (DOM.paginacaoDots) {
            var h = '';
            for (var i = 0; i < Estado.totalPaginas; i++) h += '<span class="paginacao-dot' + (i === Estado.paginaAtual ? ' dot-ativo' : '') + '" data-pagina="' + i + '"></span>';
            DOM.paginacaoDots.innerHTML = h;
            var dots = DOM.paginacaoDots.querySelectorAll('.paginacao-dot');
            for (var d = 0; d < dots.length; d++) dots[d].addEventListener('click', function() { mostrarPagina(parseInt(this.getAttribute('data-pagina'), 10)); if (Estado.intervalos.paginado) { pararPaginado(); Estado.intervalos.paginado = setInterval(function() { if (!Estado.autoScrollAtivo) { pararPaginado(); return; } proximaPagina(); }, CONFIG.paginadoTempo); } });
        }
    }

    // =========================================================
    // WATCHDOG
    // =========================================================

    function iniciarWatchdog() {
        pararWatchdog();
        Estado.intervalos.watchdog = setInterval(function() {
            if (!Estado.autoScrollAtivo) { pararWatchdog(); return; }
            var e = getElementoScroll(); if (!e) return;
            var p = e.scrollTop, sm = e.scrollHeight - e.clientHeight;
            if (p > 5 && p < sm - 5 && Math.abs(p - Estado.watchdog.ultimaPosicao) < 1 && Estado.intervalos.scroll !== null) {
                Estado.watchdog.contadorTravamento++;
                if (Estado.watchdog.contadorTravamento >= CONFIG.watchdogMaxTravamentos) { pararScrollInterno(); setTimeout(function() { if (Estado.autoScrollAtivo) { Estado.watchdog.contadorTravamento = 0; iniciarAutoScroll(); } }, 1000); return; }
            } else { Estado.watchdog.contadorTravamento = 0; }
            Estado.watchdog.ultimaPosicao = p;
        }, CONFIG.watchdogInterval);
    }

    function pararWatchdog() { if (Estado.intervalos.watchdog) { clearInterval(Estado.intervalos.watchdog); Estado.intervalos.watchdog = null; } }
    function pararAutoScroll() { pararScrollInterno(); pararPaginado(); }

    function atualizarBotaoScroll() {
        if (!DOM.btnAutoScroll) return;
        if (Estado.autoScrollAtivo) { DOM.btnAutoScroll.classList.add('ativo'); DOM.btnAutoScroll.innerHTML = '<i class="fas fa-pause"></i><span class="btn-text">Pausar</span>'; }
        else { DOM.btnAutoScroll.classList.remove('ativo'); DOM.btnAutoScroll.innerHTML = '<i class="fas fa-play"></i><span class="btn-text">Auto Scroll</span>'; }
    }

    function agendarAutoScrollInicial() {
        if (Estado.timeouts.autoScrollInicial) clearTimeout(Estado.timeouts.autoScrollInicial);
        Estado.timeouts.autoScrollInicial = setTimeout(function() {
            if (!Estado.autoScrollAtivo && Estado.dados.length > 0) { Estado.autoScrollAtivo = true; Estado.autoScrollIniciado = true; atualizarBotaoScroll(); iniciarAutoScrollModo(); }
        }, CONFIG.delayAutoScrollInicial);
    }

    // =========================================================
    // EXPORTACAO EXCEL
    // =========================================================

    var COLUNAS_EXPORT = [
        { campo: 'nr_conta',            titulo: 'Nr. Conta',            sel: true },
        { campo: 'nr_atendimento',      titulo: 'Nr. Atendimento',     sel: true },
        { campo: 'pessoa_fisica',       titulo: 'Paciente',            sel: true },
        { campo: 'tipo_atend',          titulo: 'Tipo Atendimento',    sel: true },
        { campo: 'status_conta',        titulo: 'Status Conta',        sel: true },
        { campo: 'legenda_conta',       titulo: 'Legenda',             sel: true },
        { campo: 'convenio',            titulo: 'Convenio',            sel: true },
        { campo: 'vl_conta',            titulo: 'Valor (R$)',          sel: true },
        { campo: 'dt_conta',            titulo: 'Dt. Conta',           sel: true },
        { campo: 'dt_periodo_inicial',  titulo: 'Dt. Periodo Inicial', sel: true },
        { campo: 'dt_periodo_final',    titulo: 'Dt. Periodo Final',   sel: true },
        { campo: 'protocolo',           titulo: 'Protocolo',           sel: true },
        { campo: 'status_protocolo',    titulo: 'Status Protocolo',    sel: true },
        { campo: 'entrega_convenio',    titulo: 'Entrega Convenio',    sel: false },
        { campo: 'setor_atendimento',   titulo: 'Setor',               sel: true },
        { campo: 'etapa_conta',         titulo: 'Etapa',               sel: true },
        { campo: 'auditoria',           titulo: 'Auditoria',           sel: true },
        { campo: 'estabelecimento',     titulo: 'Estabelecimento',     sel: false },
        { campo: 'dt_mesano_referencia', titulo: 'Mes/Ano Ref.',       sel: false },
        { campo: 'nr_seq_etapa',        titulo: 'Seq. Etapa',          sel: false },
        { campo: 'cd_setor_atendimento', titulo: 'Cod. Setor',         sel: false },
        { campo: 'dias_aging',          titulo: 'Dias Aging',          sel: false }
    ];

    function abrirModalExportar() {
        if (!DOM.modalColunasGrid) return;
        var html = '';
        for (var i = 0; i < COLUNAS_EXPORT.length; i++) {
            var col = COLUNAS_EXPORT[i];
            html += '<div class="coluna-check' + (col.sel ? ' selecionada' : '') + '"><input type="checkbox" id="exp-' + col.campo + '" value="' + col.campo + '"' + (col.sel ? ' checked' : '') + '><label for="exp-' + col.campo + '">' + col.titulo + '</label></div>';
        }
        DOM.modalColunasGrid.innerHTML = html;
        var checks = DOM.modalColunasGrid.querySelectorAll('input[type="checkbox"]');
        for (var j = 0; j < checks.length; j++) checks[j].addEventListener('change', function() { this.parentElement.classList.toggle('selecionada', this.checked); });
        if (DOM.modalExportInfo) DOM.modalExportInfo.textContent = Estado.dados.length + ' registros serao exportados';
        if (DOM.modalExportar) DOM.modalExportar.classList.add('ativo');
    }

    function fecharModalExportar() { if (DOM.modalExportar) DOM.modalExportar.classList.remove('ativo'); }

    function toggleTodasColunas(marcar) {
        if (!DOM.modalColunasGrid) return;
        var checks = DOM.modalColunasGrid.querySelectorAll('input[type="checkbox"]');
        for (var i = 0; i < checks.length; i++) { checks[i].checked = marcar; checks[i].parentElement.classList.toggle('selecionada', marcar); }
    }

    function executarExportacao() {
        if (!DOM.modalColunasGrid) return;
        var checks = DOM.modalColunasGrid.querySelectorAll('input[type="checkbox"]:checked');
        var colsSel = [];
        for (var i = 0; i < checks.length; i++) {
            var campo = checks[i].value;
            for (var j = 0; j < COLUNAS_EXPORT.length; j++) { if (COLUNAS_EXPORT[j].campo === campo) { colsSel.push(COLUNAS_EXPORT[j]); break; } }
        }
        if (colsSel.length === 0) { alert('Selecione pelo menos uma coluna.'); return; }

        var header = [];
        for (var h = 0; h < colsSel.length; h++) header.push(colsSel[h].titulo);
        var rows = [header];
        for (var r = 0; r < Estado.dados.length; r++) {
            var reg = Estado.dados[r]; var row = [];
            for (var c = 0; c < colsSel.length; c++) {
                var cp = colsSel[c].campo; var val = reg[cp];
                if (cp === 'vl_conta') row.push(parseFloat(val) || 0);
                else if (cp.indexOf('dt_') === 0 && val) row.push(formatarData(val));
                else row.push(val !== null && val !== undefined ? String(val) : '');
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
            for (var r = 1; r < rows.length && r < 100; r++) { var cl = String(rows[r][c] || '').length; if (cl > ml) ml = cl; }
            cw.push({ wch: Math.min(ml + 3, 40) });
        }
        ws['!cols'] = cw;
        XLSX.utils.book_append_sheet(wb, ws, 'Contas');
        XLSX.writeFile(wb, 'Painel21_Contas_' + new Date().toISOString().slice(0, 10).replace(/-/g, '') + '.xlsx');
    }

    function exportarCSV(rows) {
        var csv = '';
        for (var r = 0; r < rows.length; r++) {
            var line = [];
            for (var c = 0; c < rows[r].length; c++) line.push('"' + String(rows[r][c] || '').replace(/"/g, '""') + '"');
            csv += line.join(';') + '\r\n';
        }
        var blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
        var link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = 'Painel21_Contas_' + new Date().toISOString().slice(0, 10).replace(/-/g, '') + '.csv';
        link.click(); URL.revokeObjectURL(link.href);
    }

    // =========================================================
    // TOGGLE FILTROS (RECOLHER/EXPANDIR)
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
                var f = resp.filtros;
                popularSelect(DOM.filtroLegenda, f.legendas, 'Legenda');
                if (Estado.filtros.legenda && DOM.filtroLegenda) DOM.filtroLegenda.value = Estado.filtros.legenda;
                if (f.protocolos) popularMultiSelectDinamico('ms-protocolo', f.protocolos);
                if (f.convenios)  popularMultiSelectDinamico('ms-convenio', f.convenios);
                if (f.setores)    popularMultiSelectDinamico('ms-setor', f.setores);
                if (f.etapas)     popularMultiSelectDinamico('ms-etapa', f.etapas);
            })
            .catch(function(err) { console.warn('[P21] Erro filtros:', err); });
    }

    function popularSelect(el, vals, placeholder) {
        if (!el || !vals) return;
        var atual = el.value;
        el.innerHTML = '<option value="">' + placeholder + '</option>';
        for (var i = 0; i < vals.length; i++) { var o = document.createElement('option'); o.value = vals[i]; o.textContent = vals[i]; el.appendChild(o); }
        if (atual) el.value = atual;
    }

    // =========================================================
    // EVENTOS
    // =========================================================

    function configurarEventos() {
        configurarToggleMultiSelects();
        vincularCheckboxesMultiSelect('ms-status-conta');
        vincularCheckboxesMultiSelect('ms-tipo');

        // Filtros simples
        var filtrosSimples = [
            { el: DOM.filtroPeriodo, key: 'periodo' },
            { el: DOM.filtroLegenda, key: 'legenda' }
        ];
        for (var i = 0; i < filtrosSimples.length; i++) {
            (function(f) { if (f.el) f.el.addEventListener('change', function() { Estado.filtros[f.key] = this.value; salvar(f.key, this.value); carregarDados(); }); })(filtrosSimples[i]);
        }

        // Busca com debounce
        if (DOM.filtroBusca) DOM.filtroBusca.addEventListener('input', function() { var v = this.value; if (Estado.timeouts.debounce) clearTimeout(Estado.timeouts.debounce); Estado.timeouts.debounce = setTimeout(function() { Estado.filtros.busca = v; salvar('busca', v); carregarDados(); }, CONFIG.debounceMs); });

        // Datas
        if (DOM.filtroDtInicio) DOM.filtroDtInicio.addEventListener('change', function() { Estado.filtros.dt_inicio = this.value; salvar('dt_inicio', this.value); carregarDados(); });
        if (DOM.filtroDtFim) DOM.filtroDtFim.addEventListener('change', function() { Estado.filtros.dt_fim = this.value; salvar('dt_fim', this.value); carregarDados(); });

        // Valor min/max com debounce
        if (DOM.filtroVlMin) DOM.filtroVlMin.addEventListener('input', function() { var v = this.value; if (Estado.timeouts.debounce) clearTimeout(Estado.timeouts.debounce); Estado.timeouts.debounce = setTimeout(function() { Estado.filtros.vl_min = v; salvar('vl_min', v); carregarDados(); }, CONFIG.debounceMs); });
        if (DOM.filtroVlMax) DOM.filtroVlMax.addEventListener('input', function() { var v = this.value; if (Estado.timeouts.debounce) clearTimeout(Estado.timeouts.debounce); Estado.timeouts.debounce = setTimeout(function() { Estado.filtros.vl_max = v; salvar('vl_max', v); carregarDados(); }, CONFIG.debounceMs); });

        // Excluir zerados
        if (DOM.btnExcluirZerados) DOM.btnExcluirZerados.addEventListener('click', function() { Estado.excluirZerados = !Estado.excluirZerados; atualizarBotaoExcluirZerados(); salvar('excluirZerados', Estado.excluirZerados ? '1' : '0'); carregarDados(); });

        if (DOM.btnToggleFiltros) DOM.btnToggleFiltros.addEventListener('click', toggleFiltros);

        // Modo scroll
        if (DOM.btnModoScroll) DOM.btnModoScroll.addEventListener('click', alternarModoScroll);

        // Exportar
        if (DOM.btnExportar) DOM.btnExportar.addEventListener('click', abrirModalExportar);
        if (DOM.btnExportarConfirmar) DOM.btnExportarConfirmar.addEventListener('click', executarExportacao);
        if (DOM.btnExportarCancelar) DOM.btnExportarCancelar.addEventListener('click', fecharModalExportar);
        if (DOM.modalExportarFechar) DOM.modalExportarFechar.addEventListener('click', fecharModalExportar);
        if (DOM.modalExportar) DOM.modalExportar.addEventListener('click', function(e) { if (e.target === DOM.modalExportar) fecharModalExportar(); });
        if (DOM.btnSelecionarTodas) DOM.btnSelecionarTodas.addEventListener('click', function() { toggleTodasColunas(true); });
        if (DOM.btnDesmarcarTodas) DOM.btnDesmarcarTodas.addEventListener('click', function() { toggleTodasColunas(false); });

        // Limpar filtros
        if (DOM.btnLimpar) {
            DOM.btnLimpar.addEventListener('click', function() {
                Estado.filtros = { periodo: '30', legenda: '', busca: '', dt_inicio: '', dt_fim: '', vl_min: '', vl_max: '' };
                Estado.excluirZerados = false;
                if (DOM.filtroPeriodo) DOM.filtroPeriodo.value = '30';
                if (DOM.filtroLegenda) DOM.filtroLegenda.value = '';
                if (DOM.filtroBusca) DOM.filtroBusca.value = '';
                if (DOM.filtroDtInicio) DOM.filtroDtInicio.value = '';
                if (DOM.filtroDtFim) DOM.filtroDtFim.value = '';
                if (DOM.filtroVlMin) DOM.filtroVlMin.value = '';
                if (DOM.filtroVlMax) DOM.filtroVlMax.value = '';
                resetarTodosMultiSelects();
                atualizarBotaoExcluirZerados();
                var keys = Object.keys(Estado.filtros);
                for (var k = 0; k < keys.length; k++) salvar(keys[k], '');
                salvar('periodo', '30'); salvar('excluirZerados', '0');
                carregarDados();
            });
        }

        // Botoes
        if (DOM.btnVoltar) DOM.btnVoltar.addEventListener('click', function() { window.location.href = '/frontend/dashboard.html'; });
        if (DOM.btnRefresh) DOM.btnRefresh.addEventListener('click', function() { DOM.btnRefresh.classList.add('girando'); carregarDados().then(function() { setTimeout(function() { DOM.btnRefresh.classList.remove('girando'); }, 500); }); });
        if (DOM.btnAutoScroll) DOM.btnAutoScroll.addEventListener('click', function() { Estado.autoScrollAtivo = !Estado.autoScrollAtivo; Estado.autoScrollIniciado = true; atualizarBotaoScroll(); if (Estado.autoScrollAtivo) iniciarAutoScrollModo(); else pararAutoScroll(); });

        // Teclado
        document.addEventListener('keydown', function(e) {
            if (e.key === 'Escape') {
                if (DOM.modalExportar && DOM.modalExportar.classList.contains('ativo')) { fecharModalExportar(); return; }
                if (Estado.dropdownAberto) fecharTodosDropdowns();
                else if (Estado.autoScrollAtivo) { Estado.autoScrollAtivo = false; atualizarBotaoScroll(); pararAutoScroll(); }
            }
            if (e.key === 'F5') { e.preventDefault(); carregarDados(); }
            if (e.key === ' ' && e.target === document.body) { e.preventDefault(); Estado.autoScrollAtivo = !Estado.autoScrollAtivo; Estado.autoScrollIniciado = true; atualizarBotaoScroll(); if (Estado.autoScrollAtivo) iniciarAutoScrollModo(); else pararAutoScroll(); }
            if (Estado.modoScroll === 'paginar') {
                if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { e.preventDefault(); proximaPagina(); }
                if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { e.preventDefault(); mostrarPagina(Estado.paginaAtual - 1 < 0 ? Estado.totalPaginas - 1 : Estado.paginaAtual - 1); }
            }
        });

        document.addEventListener('visibilitychange', function() {
            if (document.hidden) { if (Estado.autoScrollAtivo) { pararAutoScroll(); Estado.autoScrollAtivo = true; } }
            else { if (Estado.autoScrollAtivo) iniciarAutoScrollModo(); carregarDados(); }
        });
    }

    function atualizarBotaoExcluirZerados() {
        if (!DOM.btnExcluirZerados) return;
        if (Estado.excluirZerados) { DOM.btnExcluirZerados.classList.add('ativo'); DOM.btnExcluirZerados.setAttribute('aria-pressed', 'true'); }
        else { DOM.btnExcluirZerados.classList.remove('ativo'); DOM.btnExcluirZerados.setAttribute('aria-pressed', 'false'); }
    }

    // =========================================================
    // INICIALIZACAO
    // =========================================================

    function inicializar() {
        console.log('[P21] Inicializando...');
        cachearElementos();

        var keys = Object.keys(Estado.filtros);
        for (var k = 0; k < keys.length; k++) { var s = recuperar(keys[k]); if (s !== null && s !== '') Estado.filtros[keys[k]] = s; }

        Estado.excluirZerados = recuperar('excluirZerados') === '1';
        atualizarBotaoExcluirZerados();

        Estado.filtrosRecolhidos = false;

        var modoSalvo = recuperar('modoScroll');
        if (modoSalvo) Estado.modoScroll = modoSalvo;
        atualizarBotaoModoScroll();

        if (DOM.filtroPeriodo) DOM.filtroPeriodo.value = Estado.filtros.periodo || '30';
        if (DOM.filtroBusca) DOM.filtroBusca.value = Estado.filtros.busca;
        if (DOM.filtroDtInicio) DOM.filtroDtInicio.value = Estado.filtros.dt_inicio;
        if (DOM.filtroDtFim) DOM.filtroDtFim.value = Estado.filtros.dt_fim;
        if (DOM.filtroVlMin) DOM.filtroVlMin.value = Estado.filtros.vl_min;
        if (DOM.filtroVlMax) DOM.filtroVlMax.value = Estado.filtros.vl_max;

        configurarEventos();
        carregarFiltrosDinamicos();
        carregarDados();

        Estado.intervalos.refresh = setInterval(function() { carregarDados(); }, CONFIG.intervaloRefresh);
        console.log('[P21] Inicializado com sucesso');
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', inicializar);
    else inicializar();

})();