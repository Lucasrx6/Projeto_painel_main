/**
 * PAINEL 21 - Evolução de Contas
 * Sistema de Painéis Hospitalares - Hospital Anchieta
 *
 * Funcionalidades:
 * - Listagem de contas do ciclo de faturamento
 * - Filtros server-side: período, status, legenda, tipo, protocolo, convênio, setor, etapa, busca
 * - KPI cards com totais e valores
 * - Ordenação por qualquer coluna (clique no cabeçalho)
 * - Destaque visual para contas pendentes (SEM NOTA/TITULO)
 * - Auto-scroll robusto com watchdog
 * - Persistência de filtros via localStorage
 */

(function() {
    'use strict';

    // =========================================================
    // CONFIGURAÇÃO
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
        watchdogInterval: 3000,
        watchdogMaxTravamentos: 3,
        maxTentativasConexao: 3,
        timeoutRequisicao: 30000,
        debounceMs: 400,
        storagePrefix: 'painel21_'
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
        intervalos: { refresh: null, scroll: null, watchdog: null },
        timeouts: { autoScrollInicial: null, debounce: null },
        watchdog: { ultimaPosicao: 0, contadorTravamento: 0 },
        ordenacao: { campo: 'dt_conta', direcao: 'desc' },
        filtros: {
            periodo: '30',
            status_conta: '',
            legenda: '',
            tipo: '',
            status_protocolo: '',
            convenio: '',
            setor: '',
            etapa: '',
            busca: '',
            dt_inicio: '',
            dt_fim: ''
        }
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

        // KPIs
        DOM.kpiTotalContas = document.getElementById('kpi-total-contas');
        DOM.kpiValorTotal = document.getElementById('kpi-valor-total');
        DOM.kpiProvisorio = document.getElementById('kpi-provisorio');
        DOM.kpiDefinitivo = document.getElementById('kpi-definitivo');
        DOM.kpiSemNf = document.getElementById('kpi-sem-nf');
        DOM.kpiEmProtocolo = document.getElementById('kpi-em-protocolo');

        // Filtros
        DOM.filtroPeriodo = document.getElementById('filtro-periodo');
        DOM.filtroStatusConta = document.getElementById('filtro-status-conta');
        DOM.filtroLegenda = document.getElementById('filtro-legenda');
        DOM.filtroTipo = document.getElementById('filtro-tipo');
        DOM.filtroProtocolo = document.getElementById('filtro-protocolo');
        DOM.filtroConvenio = document.getElementById('filtro-convenio');
        DOM.filtroSetor = document.getElementById('filtro-setor');
        DOM.filtroEtapa = document.getElementById('filtro-etapa');
        DOM.filtroBusca = document.getElementById('filtro-busca');
        DOM.filtroDtInicio = document.getElementById('filtro-dt-inicio');
        DOM.filtroDtFim = document.getElementById('filtro-dt-fim');

        // Botões
        DOM.btnLimpar = document.getElementById('btn-limpar');
        DOM.btnVoltar = document.getElementById('btn-voltar');
        DOM.btnRefresh = document.getElementById('btn-refresh');
        DOM.btnAutoScroll = document.getElementById('btn-auto-scroll');
    }

    // =========================================================
    // UTILITÁRIOS
    // =========================================================

    function escapeHtml(texto) {
        if (!texto) return '-';
        var div = document.createElement('div');
        div.textContent = texto;
        return div.innerHTML;
    }

    function formatarNome(nomeCompleto) {
        if (!nomeCompleto || nomeCompleto.trim() === '') return '-';
        var partes = nomeCompleto.trim().toUpperCase().split(/\s+/);
        if (partes.length <= 2) return nomeCompleto.trim();
        var iniciais = [];
        for (var i = 0; i < partes.length - 1; i++) {
            iniciais.push(partes[i].charAt(0));
        }
        return iniciais.join(' ') + ' ' + partes[partes.length - 1];
    }

    function formatarMoeda(valor) {
        if (valor === null || valor === undefined || isNaN(valor)) return '-';
        return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(valor);
    }

    function formatarMoedaCurta(valor) {
        if (valor === null || valor === undefined || isNaN(valor)) return '-';
        valor = parseFloat(valor);
        if (valor >= 1000000) return 'R$ ' + (valor / 1000000).toFixed(1) + 'M';
        if (valor >= 1000) return 'R$ ' + (valor / 1000).toFixed(1) + 'K';
        return formatarMoeda(valor);
    }

    function formatarData(isoStr) {
        if (!isoStr) return '-';
        try {
            var d = new Date(isoStr);
            if (isNaN(d.getTime())) return '-';
            var dia = ('0' + d.getDate()).slice(-2);
            var mes = ('0' + (d.getMonth() + 1)).slice(-2);
            var ano = d.getFullYear();
            return dia + '/' + mes + '/' + ano;
        } catch (e) { return '-'; }
    }

    function formatarNumero(val) {
        if (val === null || val === undefined || isNaN(val)) return '-';
        return new Intl.NumberFormat('pt-BR').format(val);
    }

    function atualizarStatus(status) {
        if (!DOM.statusIndicator) return;
        DOM.statusIndicator.className = 'status-indicator';
        if (status === 'online') {
            DOM.statusIndicator.classList.add('status-online');
            DOM.statusIndicator.title = 'Conectado';
        } else if (status === 'offline') {
            DOM.statusIndicator.classList.add('status-offline');
            DOM.statusIndicator.title = 'Sem conexão';
        } else if (status === 'loading') {
            DOM.statusIndicator.classList.add('status-loading');
            DOM.statusIndicator.title = 'Carregando...';
        }
    }

    function atualizarHorario() {
        if (!DOM.ultimaAtualizacao) return;
        DOM.ultimaAtualizacao.textContent = new Date().toLocaleTimeString('pt-BR', {
            hour: '2-digit', minute: '2-digit'
        });
    }

    function salvarFiltro(key, valor) {
        try { localStorage.setItem(CONFIG.storagePrefix + key, valor); } catch (e) { /* ignore */ }
    }

    function recuperarFiltro(key) {
        try { return localStorage.getItem(CONFIG.storagePrefix + key); } catch (e) { return null; }
    }

    // =========================================================
    // FETCH COM RETRY
    // =========================================================

    function fetchComRetry(url, tentativas) {
        tentativas = tentativas || CONFIG.maxTentativasConexao;
        return new Promise(function(resolve, reject) {
            function tentar(n) {
                var controller = new AbortController();
                var timer = setTimeout(function() { controller.abort(); }, CONFIG.timeoutRequisicao);
                fetch(url, { signal: controller.signal, credentials: 'include' })
                    .then(function(res) {
                        clearTimeout(timer);
                        if (!res.ok) throw new Error('HTTP ' + res.status);
                        return res.json();
                    })
                    .then(resolve)
                    .catch(function(err) {
                        clearTimeout(timer);
                        if (n > 1) {
                            setTimeout(function() { tentar(n - 1); }, 1000);
                        } else { reject(err); }
                    });
            }
            tentar(tentativas);
        });
    }

    // =========================================================
    // CONSTRUIR URL COM FILTROS
    // =========================================================

    function construirUrl() {
        var params = [];
        var f = Estado.filtros;

        if (f.periodo)          params.push('dias=' + encodeURIComponent(f.periodo));
        if (f.status_conta)     params.push('status_conta=' + encodeURIComponent(f.status_conta));
        if (f.legenda)          params.push('legenda=' + encodeURIComponent(f.legenda));
        if (f.tipo)             params.push('tipo=' + encodeURIComponent(f.tipo));
        if (f.status_protocolo) params.push('status_protocolo=' + encodeURIComponent(f.status_protocolo));
        if (f.convenio)         params.push('convenio=' + encodeURIComponent(f.convenio));
        if (f.setor)            params.push('setor=' + encodeURIComponent(f.setor));
        if (f.etapa)            params.push('etapa=' + encodeURIComponent(f.etapa));
        if (f.busca)            params.push('busca=' + encodeURIComponent(f.busca));
        if (f.dt_inicio)        params.push('dt_inicio=' + encodeURIComponent(f.dt_inicio));
        if (f.dt_fim)           params.push('dt_fim=' + encodeURIComponent(f.dt_fim));

        return CONFIG.api.dados + (params.length > 0 ? '?' + params.join('&') : '');
    }

    function construirUrlDashboard() {
        var f = Estado.filtros;
        var params = [];
        if (f.periodo)   params.push('dias=' + encodeURIComponent(f.periodo));
        if (f.dt_inicio) params.push('dt_inicio=' + encodeURIComponent(f.dt_inicio));
        if (f.dt_fim)    params.push('dt_fim=' + encodeURIComponent(f.dt_fim));
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
        .then(function(respostas) {
            var dadosResp = respostas[0];
            var dashResp = respostas[1];

            if (!dadosResp.success) {
                mostrarErro('Erro ao carregar dados');
                return;
            }

            Estado.dados = dadosResp.data || [];
            atualizarKPIs(dashResp.success ? dashResp.data : null);
            renderizarTabela();
            atualizarContadores();
            atualizarHorario();
            atualizarStatus('online');
            Estado.errosConsecutivos = 0;

            if (scrollEstaAtivo) {
                setTimeout(function() {
                    Estado.autoScrollAtivo = true;
                    atualizarBotaoScroll();
                    iniciarAutoScroll();
                }, 500);
            }

            if (!Estado.autoScrollIniciado && !scrollEstaAtivo) {
                agendarAutoScrollInicial();
            }
        })
        .catch(function(err) {
            console.error('[P21] Erro ao carregar dados:', err);
            Estado.errosConsecutivos++;
            atualizarStatus('offline');
            if (Estado.errosConsecutivos >= 3) {
                mostrarErro('Falha na conexão com o servidor.');
            }
        })
        .finally(function() {
            Estado.carregando = false;
        });
    }

    // =========================================================
    // KPIs (CARDS)
    // =========================================================

    function atualizarKPIs(dados) {
        if (!dados) return;

        var cards = document.querySelectorAll('.resumo-card');
        for (var j = 0; j < cards.length; j++) {
            cards[j].classList.add('atualizando');
            (function(card) {
                setTimeout(function() { card.classList.remove('atualizando'); }, 300);
            })(cards[j]);
        }

        if (DOM.kpiTotalContas) DOM.kpiTotalContas.textContent = formatarNumero(dados.total_contas);
        if (DOM.kpiValorTotal) DOM.kpiValorTotal.textContent = formatarMoedaCurta(dados.vl_total);
        if (DOM.kpiProvisorio) DOM.kpiProvisorio.textContent = formatarNumero(dados.qt_provisorio);
        if (DOM.kpiDefinitivo) DOM.kpiDefinitivo.textContent = formatarNumero(dados.qt_definitivo);
        if (DOM.kpiSemNf) DOM.kpiSemNf.textContent = formatarNumero(dados.qt_sem_nf_titulo);
        if (DOM.kpiEmProtocolo) DOM.kpiEmProtocolo.textContent = formatarNumero(dados.qt_em_protocolo);
    }

    function atualizarContadores() {
        if (DOM.totalFiltrados) DOM.totalFiltrados.textContent = Estado.dados.length;
        if (DOM.totalRegistros) DOM.totalRegistros.textContent = Estado.dados.length;
    }

    // =========================================================
    // ORDENAÇÃO
    // =========================================================

    function ordenarDados() {
        var campo = Estado.ordenacao.campo;
        var direcao = Estado.ordenacao.direcao;

        Estado.dados.sort(function(a, b) {
            var va = a[campo];
            var vb = b[campo];

            if (va === null || va === undefined) va = '';
            if (vb === null || vb === undefined) vb = '';

            // Numéricos
            if (campo === 'vl_conta' || campo === 'nr_atendimento' || campo === 'nr_conta' || campo === 'dias_aging' || campo === 'ie_tipo') {
                va = parseFloat(va) || 0;
                vb = parseFloat(vb) || 0;
            }
            // Datas
            else if (campo.indexOf('dt_') === 0) {
                va = new Date(va || 0).getTime();
                vb = new Date(vb || 0).getTime();
            }
            // Texto
            else {
                va = String(va).toLowerCase();
                vb = String(vb).toLowerCase();
            }

            var resultado = 0;
            if (va < vb) resultado = -1;
            if (va > vb) resultado = 1;

            return direcao === 'asc' ? resultado : -resultado;
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
    // RENDERIZAÇÃO DA TABELA
    // =========================================================

    var COLUNAS = [
        { campo: 'dt_conta',           titulo: 'Dt. Conta',  classe: 'col-dt-conta' },
        { campo: 'nr_atendimento',     titulo: 'Atend.',     classe: 'col-atendimento' },
        { campo: 'pessoa_fisica',      titulo: 'Paciente',   classe: 'col-paciente' },
        { campo: 'tipo_atend',         titulo: 'Tipo',       classe: 'col-tipo' },
        { campo: 'legenda_conta',      titulo: 'Legenda',    classe: 'col-legenda' },
        { campo: 'convenio',           titulo: 'Convênio',   classe: 'col-convenio' },
        { campo: 'vl_conta',           titulo: 'Valor',      classe: 'col-valor' },
        { campo: 'status_protocolo',   titulo: 'St. Prot.',  classe: 'col-protocolo' },
        { campo: 'setor_atendimento',  titulo: 'Setor',      classe: 'col-setor' },
        { campo: 'etapa_conta',        titulo: 'Etapa',      classe: 'col-etapa' },
        { campo: 'auditoria',          titulo: 'Auditoria',  classe: 'col-auditoria' }
    ];

    function renderizarTabela() {
        if (!DOM.painelMain) return;

        var dados = Estado.dados;

        if (!dados || dados.length === 0) {
            DOM.painelMain.innerHTML =
                '<div class="mensagem-vazia">' +
                '<i class="fas fa-check-circle"></i>' +
                '<h3>Nenhuma conta encontrada</h3>' +
                '<p>Ajuste os filtros para visualizar dados</p></div>';
            return;
        }

        ordenarDados();

        // Cabeçalho
        var cabecalhoHtml = '';
        for (var c = 0; c < COLUNAS.length; c++) {
            var col = COLUNAS[c];
            var isAtiva = Estado.ordenacao.campo === col.campo;
            var iconeSort = isAtiva
                ? (Estado.ordenacao.direcao === 'asc' ? 'fa-sort-up' : 'fa-sort-down')
                : 'fa-sort';
            var classeAtiva = isAtiva ? ' ativa' : '';

            cabecalhoHtml += '<th class="' + col.classe + classeAtiva + '" data-campo="' + col.campo + '">' +
                col.titulo + ' <i class="fas ' + iconeSort + ' icone-sort"></i></th>';
        }

        // Linhas
        var linhasHtml = '';
        for (var i = 0; i < dados.length; i++) {
            linhasHtml += criarLinha(dados[i]);
        }

        var html =
            '<div class="tabela-container">' +
            '<table class="tabela-contas">' +
            '<thead><tr>' + cabecalhoHtml + '</tr></thead>' +
            '<tbody id="tabela-body">' + linhasHtml + '</tbody>' +
            '</table></div>';

        DOM.painelMain.innerHTML = html;

        // Eventos de ordenação
        var ths = document.querySelectorAll('.tabela-contas thead th');
        for (var t = 0; t < ths.length; t++) {
            ths[t].addEventListener('click', function() {
                alterarOrdenacao(this.getAttribute('data-campo'));
            });
        }
    }

    function criarLinha(reg) {
        var classeLinha = '';
        if (reg.legenda_conta === 'SEM NOTA/TITULO') classeLinha = ' linha-sem-nf';
        else if (reg.legenda_conta === 'EM PROTOCOLO') classeLinha = ' linha-em-protocolo';
        else if (reg.legenda_conta === 'NOTA FISCAL' || reg.legenda_conta === 'TITULO GERADO') classeLinha = ' linha-concluida';

        var html = '<tr class="' + classeLinha + '">';

        // Dt. Conta
        html += '<td class="col-dt-conta">' + formatarData(reg.dt_conta) + '</td>';

        // Atendimento
        html += '<td class="col-atendimento"><strong>' + escapeHtml(reg.nr_atendimento) + '</strong></td>';

        // Paciente
        html += '<td class="col-paciente">' + escapeHtml(formatarNome(reg.pessoa_fisica)) + '</td>';

        // Tipo
        html += '<td class="col-tipo">' + getBadgeTipo(reg.ie_tipo, reg.tipo_atend) + '</td>';

        // Legenda
        html += '<td class="col-legenda">' + getBadgeLegenda(reg.legenda_conta) + '</td>';

        // Convênio
        html += '<td class="col-convenio">' + escapeHtml(abreviar(reg.convenio, 18)) + '</td>';

        // Valor
        var classeValor = '';
        var vlConta = parseFloat(reg.vl_conta) || 0;
        if (vlConta >= 50000) classeValor = ' valor-alto';
        else if (vlConta >= 10000) classeValor = ' valor-medio';
        html += '<td class="col-valor valor-moeda' + classeValor + '">' + formatarMoeda(vlConta) + '</td>';

        // Status Protocolo
        html += '<td class="col-protocolo">' + getBadgeProtocolo(reg.status_protocolo) + '</td>';

        // Setor
        html += '<td class="col-setor">' + escapeHtml(abreviar(reg.setor_atendimento, 20)) + '</td>';

        // Etapa
        html += '<td class="col-etapa">' + escapeHtml(abreviar(reg.etapa_conta, 20)) + '</td>';

        // Auditoria
        html += '<td class="col-auditoria">' + getBadgeAuditoria(reg.auditoria) + '</td>';

        html += '</tr>';
        return html;
    }

    function abreviar(texto, max) {
        if (!texto) return '-';
        return texto.length > max ? texto.substring(0, max) + '...' : texto;
    }

    // =========================================================
    // BADGES
    // =========================================================

    function getBadgeLegenda(legenda) {
        if (!legenda) return '-';
        var map = {
            'SEM NOTA/TITULO': 'badge-sem-nf',
            'EM PROTOCOLO': 'badge-em-protocolo',
            'NOTA FISCAL': 'badge-nota-fiscal',
            'TITULO GERADO': 'badge-titulo-gerado',
            'PROT.C /NF': 'badge-prot-nf',
            'PROT.C /TITULO': 'badge-prot-titulo',
            'ESTORNADA': 'badge-estornada',
            'CANCELADA': 'badge-cancelada'
        };
        var cls = map[legenda] || '';
        return '<span class="badge ' + cls + '">' + escapeHtml(legenda) + '</span>';
    }

    function getBadgeTipo(ieTipo, descricao) {
        var map = { 1: 'badge-internado', 3: 'badge-ps', 7: 'badge-externo', 8: 'badge-ambulatorial' };
        var labels = { 1: 'Intern.', 3: 'PS', 7: 'Externo', 8: 'Ambul.' };
        var cls = map[ieTipo] || '';
        var label = labels[ieTipo] || (descricao ? abreviar(descricao, 8) : '-');
        return '<span class="badge ' + cls + '">' + escapeHtml(label) + '</span>';
    }

    function getBadgeProtocolo(status) {
        if (!status) return '-';
        var map = {
            'Provisório': 'badge-provisorio',
            'Definitivo': 'badge-definitivo',
            'Auditoria': 'badge-sem-nf',
            'Fora Remessa': 'badge-estornada'
        };
        var cls = map[status] || '';
        return '<span class="badge ' + cls + '">' + escapeHtml(status) + '</span>';
    }

    function getBadgeAuditoria(auditoria) {
        if (!auditoria) return '-';
        var map = {
            'Finalizada': 'badge-finalizada',
            'Sem auditoria': 'badge-sem-auditoria'
        };
        var cls = map[auditoria] || 'badge-em-analise';
        return '<span class="badge ' + cls + '">' + escapeHtml(abreviar(auditoria, 12)) + '</span>';
    }

    // =========================================================
    // ERRO
    // =========================================================

    function mostrarErro(msg) {
        if (!DOM.painelMain) return;
        DOM.painelMain.innerHTML =
            '<div class="mensagem-erro">' +
            '<i class="fas fa-exclamation-triangle"></i>' +
            '<h3>Erro ao Carregar Dados</h3>' +
            '<p>' + escapeHtml(msg) + '</p>' +
            '<button class="btn-tentar-novamente" onclick="location.reload()">' +
            '<i class="fas fa-sync-alt"></i> Tentar Novamente</button></div>';
    }

    // =========================================================
    // AUTO-SCROLL COM WATCHDOG
    // =========================================================

    function getElementoScroll() {
        return document.getElementById('tabela-body');
    }

    function iniciarAutoScroll() {
        pararAutoScroll();
        var elemento = getElementoScroll();
        if (!elemento) return;

        var scrollMax = elemento.scrollHeight - elemento.clientHeight;
        if (scrollMax <= 5) return;

        Estado.watchdog = { ultimaPosicao: elemento.scrollTop, contadorTravamento: 0 };
        iniciarWatchdog();

        Estado.intervalos.scroll = setInterval(function() {
            if (!Estado.autoScrollAtivo) { pararAutoScroll(); return; }
            var elem = getElementoScroll();
            if (!elem) { pararAutoScroll(); return; }

            var sMax = elem.scrollHeight - elem.clientHeight;
            if (elem.scrollTop >= sMax - 2) {
                clearInterval(Estado.intervalos.scroll);
                Estado.intervalos.scroll = null;
                setTimeout(function() {
                    if (!Estado.autoScrollAtivo) return;
                    elem.scrollTop = 0;
                    Estado.watchdog.ultimaPosicao = 0;
                    Estado.watchdog.contadorTravamento = 0;
                    setTimeout(function() {
                        if (Estado.autoScrollAtivo) iniciarAutoScroll();
                    }, CONFIG.pausaAposReset);
                }, CONFIG.pausaNoFinal);
                return;
            }
            elem.scrollTop += CONFIG.velocidadeScroll;
        }, CONFIG.intervaloScroll);
    }

    function pararAutoScroll() {
        if (Estado.intervalos.scroll) {
            clearInterval(Estado.intervalos.scroll);
            Estado.intervalos.scroll = null;
        }
        pararWatchdog();
    }

    function iniciarWatchdog() {
        pararWatchdog();
        Estado.intervalos.watchdog = setInterval(function() {
            if (!Estado.autoScrollAtivo) { pararWatchdog(); return; }
            var elem = getElementoScroll();
            if (!elem) return;

            var pos = elem.scrollTop;
            var sMax = elem.scrollHeight - elem.clientHeight;
            var noMeio = pos > 5 && pos < sMax - 5;
            var naoMoveu = Math.abs(pos - Estado.watchdog.ultimaPosicao) < 1;

            if (noMeio && naoMoveu && Estado.intervalos.scroll !== null) {
                Estado.watchdog.contadorTravamento++;
                if (Estado.watchdog.contadorTravamento >= CONFIG.watchdogMaxTravamentos) {
                    pararAutoScroll();
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
            Estado.watchdog.ultimaPosicao = pos;
        }, CONFIG.watchdogInterval);
    }

    function pararWatchdog() {
        if (Estado.intervalos.watchdog) {
            clearInterval(Estado.intervalos.watchdog);
            Estado.intervalos.watchdog = null;
        }
    }

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
                iniciarAutoScroll();
            }
        }, CONFIG.delayAutoScrollInicial);
    }

    // =========================================================
    // CARREGAR FILTROS DINÂMICOS
    // =========================================================

    function carregarFiltrosDinamicos() {
        fetchComRetry(CONFIG.api.filtros)
            .then(function(resp) {
                if (!resp.success) return;
                var f = resp.filtros;

                popularSelect(DOM.filtroLegenda, f.legendas, 'Legenda');
                popularSelect(DOM.filtroConvenio, f.convenios, 'Convênio');
                popularSelect(DOM.filtroSetor, f.setores, 'Setor');
                popularSelect(DOM.filtroEtapa, f.etapas, 'Etapa');

                // Restaurar valores após popular
                if (Estado.filtros.legenda && DOM.filtroLegenda) DOM.filtroLegenda.value = Estado.filtros.legenda;
                if (Estado.filtros.convenio && DOM.filtroConvenio) DOM.filtroConvenio.value = Estado.filtros.convenio;
                if (Estado.filtros.setor && DOM.filtroSetor) DOM.filtroSetor.value = Estado.filtros.setor;
                if (Estado.filtros.etapa && DOM.filtroEtapa) DOM.filtroEtapa.value = Estado.filtros.etapa;
            })
            .catch(function(err) {
                console.warn('[P21] Erro ao carregar filtros:', err);
            });
    }

    function popularSelect(selectEl, valores, placeholder) {
        if (!selectEl || !valores) return;
        var valorAtual = selectEl.value;
        selectEl.innerHTML = '<option value="">' + placeholder + '</option>';
        for (var i = 0; i < valores.length; i++) {
            var opt = document.createElement('option');
            opt.value = valores[i];
            opt.textContent = valores[i];
            selectEl.appendChild(opt);
        }
        if (valorAtual) selectEl.value = valorAtual;
    }

    // =========================================================
    // EVENTOS
    // =========================================================

    function configurarEventos() {
        // Filtros com recarga server-side
        var filtrosServidor = [
            { el: DOM.filtroPeriodo, key: 'periodo' },
            { el: DOM.filtroStatusConta, key: 'status_conta' },
            { el: DOM.filtroLegenda, key: 'legenda' },
            { el: DOM.filtroTipo, key: 'tipo' },
            { el: DOM.filtroProtocolo, key: 'status_protocolo' },
            { el: DOM.filtroConvenio, key: 'convenio' },
            { el: DOM.filtroSetor, key: 'setor' },
            { el: DOM.filtroEtapa, key: 'etapa' }
        ];

        for (var i = 0; i < filtrosServidor.length; i++) {
            (function(filtro) {
                if (filtro.el) {
                    filtro.el.addEventListener('change', function() {
                        Estado.filtros[filtro.key] = this.value;
                        salvarFiltro(filtro.key, this.value);
                        carregarDados();
                    });
                }
            })(filtrosServidor[i]);
        }

        // Busca com debounce
        if (DOM.filtroBusca) {
            DOM.filtroBusca.addEventListener('input', function() {
                var valor = this.value;
                if (Estado.timeouts.debounce) clearTimeout(Estado.timeouts.debounce);
                Estado.timeouts.debounce = setTimeout(function() {
                    Estado.filtros.busca = valor;
                    salvarFiltro('busca', valor);
                    carregarDados();
                }, CONFIG.debounceMs);
            });
        }

        // Filtros de data
        if (DOM.filtroDtInicio) {
            DOM.filtroDtInicio.addEventListener('change', function() {
                Estado.filtros.dt_inicio = this.value;
                salvarFiltro('dt_inicio', this.value);
                carregarDados();
            });
        }

        if (DOM.filtroDtFim) {
            DOM.filtroDtFim.addEventListener('change', function() {
                Estado.filtros.dt_fim = this.value;
                salvarFiltro('dt_fim', this.value);
                carregarDados();
            });
        }

        // Limpar filtros
        if (DOM.btnLimpar) {
            DOM.btnLimpar.addEventListener('click', function() {
                Estado.filtros = {
                    periodo: '30', status_conta: '', legenda: '', tipo: '',
                    status_protocolo: '', convenio: '', setor: '', etapa: '', busca: '',
                    dt_inicio: '', dt_fim: ''
                };

                if (DOM.filtroPeriodo) DOM.filtroPeriodo.value = '30';
                if (DOM.filtroStatusConta) DOM.filtroStatusConta.value = '';
                if (DOM.filtroLegenda) DOM.filtroLegenda.value = '';
                if (DOM.filtroTipo) DOM.filtroTipo.value = '';
                if (DOM.filtroProtocolo) DOM.filtroProtocolo.value = '';
                if (DOM.filtroConvenio) DOM.filtroConvenio.value = '';
                if (DOM.filtroSetor) DOM.filtroSetor.value = '';
                if (DOM.filtroEtapa) DOM.filtroEtapa.value = '';
                if (DOM.filtroBusca) DOM.filtroBusca.value = '';
                if (DOM.filtroDtInicio) DOM.filtroDtInicio.value = '';
                if (DOM.filtroDtFim) DOM.filtroDtFim.value = '';

                // Limpar localStorage
                var keys = Object.keys(Estado.filtros);
                for (var k = 0; k < keys.length; k++) {
                    salvarFiltro(keys[k], '');
                }
                salvarFiltro('periodo', '30');

                carregarDados();
            });
        }

        // Botões
        if (DOM.btnVoltar) {
            DOM.btnVoltar.addEventListener('click', function() {
                window.location.href = '/frontend/dashboard.html';
            });
        }

        if (DOM.btnRefresh) {
            DOM.btnRefresh.addEventListener('click', function() {
                DOM.btnRefresh.classList.add('girando');
                carregarDados().finally(function() {
                    setTimeout(function() {
                        DOM.btnRefresh.classList.remove('girando');
                    }, 500);
                });
            });
        }

        if (DOM.btnAutoScroll) {
            DOM.btnAutoScroll.addEventListener('click', function() {
                Estado.autoScrollAtivo = !Estado.autoScrollAtivo;
                Estado.autoScrollIniciado = true;
                atualizarBotaoScroll();
                if (Estado.autoScrollAtivo) iniciarAutoScroll();
                else pararAutoScroll();
            });
        }

        // Teclado
        document.addEventListener('keydown', function(e) {
            if (e.key === 'Escape') {
                if (Estado.autoScrollAtivo) {
                    Estado.autoScrollAtivo = false;
                    atualizarBotaoScroll();
                    pararAutoScroll();
                }
            }
            if (e.key === 'F5') {
                e.preventDefault();
                carregarDados();
            }
            if (e.key === ' ' && e.target === document.body) {
                e.preventDefault();
                Estado.autoScrollAtivo = !Estado.autoScrollAtivo;
                Estado.autoScrollIniciado = true;
                atualizarBotaoScroll();
                if (Estado.autoScrollAtivo) iniciarAutoScroll();
                else pararAutoScroll();
            }
        });

        // Visibilidade
        document.addEventListener('visibilitychange', function() {
            if (document.hidden) {
                if (Estado.autoScrollAtivo && Estado.intervalos.scroll) {
                    pararAutoScroll();
                    Estado.autoScrollAtivo = true;
                }
            } else {
                if (Estado.autoScrollAtivo && !Estado.intervalos.scroll) {
                    iniciarAutoScroll();
                }
                carregarDados();
            }
        });
    }

    // =========================================================
    // INICIALIZAÇÃO
    // =========================================================

    function inicializar() {
        console.log('[P21] Inicializando Painel Evolução de Contas...');

        cachearElementos();

        // Restaurar filtros do localStorage
        var keys = Object.keys(Estado.filtros);
        for (var k = 0; k < keys.length; k++) {
            var salvo = recuperarFiltro(keys[k]);
            if (salvo !== null && salvo !== '') {
                Estado.filtros[keys[k]] = salvo;
            }
        }

        // Aplicar nos selects
        if (DOM.filtroPeriodo) DOM.filtroPeriodo.value = Estado.filtros.periodo || '30';
        if (DOM.filtroStatusConta) DOM.filtroStatusConta.value = Estado.filtros.status_conta;
        if (DOM.filtroTipo) DOM.filtroTipo.value = Estado.filtros.tipo;
        if (DOM.filtroProtocolo) DOM.filtroProtocolo.value = Estado.filtros.status_protocolo;
        if (DOM.filtroBusca) DOM.filtroBusca.value = Estado.filtros.busca;
        if (DOM.filtroDtInicio) DOM.filtroDtInicio.value = Estado.filtros.dt_inicio;
        if (DOM.filtroDtFim) DOM.filtroDtFim.value = Estado.filtros.dt_fim;

        configurarEventos();
        carregarFiltrosDinamicos();
        carregarDados();

        Estado.intervalos.refresh = setInterval(function() { carregarDados(); }, CONFIG.intervaloRefresh);

        console.log('[P21] Painel Evolução de Contas inicializado');
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', inicializar);
    } else {
        inicializar();
    }

})();