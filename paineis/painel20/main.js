/**
 * PAINEL 20 - Radiologia Pronto Socorro
 * Sistema de Painéis Hospitalares - Hospital Anchieta
 *
 * Funcionalidades:
 * - Listagem de pacientes com exames de radiologia do PS
 * - Sub-linhas detalhadas por exame
 * - Filtro por período (6h, 12h, 24h, Todos) e status com persistência
 * - Detecção de novos exames (dt_pedido ≤ 6min) com modal + áudio
 * - Controle de som/volume com persistência
 * - Coluna Dt. Entrada + Tempo de Atendimento
 * - Auto-scroll robusto com watchdog
 */

(function() {
    'use strict';

    // =========================================================
    // CONFIGURAÇÃO
    // =========================================================

    var CONFIG = {
        api: {
            dashboard: '/api/paineis/painel20/dashboard',
            dados: '/api/paineis/painel20/dados'
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
        storageKeyStatus: 'painel20_status',
        storageKeyPeriodo: 'painel20_periodo',
        storageKeySom: 'painel20_som',
        storageKeyVolume: 'painel20_volume',
        modalAutoCloseMs: 8000,
        alertaMaxMinutos: 6           // Só alerta se dt_pedido nos últimos 6min
    };

    // =========================================================
    // ESTADO
    // =========================================================

    var Estado = {
        dadosExames: [],
        dadosFiltrados: [],
        statusSelecionado: '',
        periodoSelecionado: '12',
        carregando: false,
        errosConsecutivos: 0,
        autoScrollAtivo: false,
        autoScrollIniciado: false,
        intervalos: { refresh: null, scroll: null, watchdog: null },
        timeouts: { autoScrollInicial: null },
        watchdog: { ultimaPosicao: 0, contadorTravamento: 0 },
        primeiroCarregamento: true,
        examesAnterioresIds: [],
        novoExamesFila: [],
        modalAutoCloseTimer: null,
        somAtivo: true,
        volume: 0.7
    };

    // =========================================================
    // CACHE DOM
    // =========================================================

    var DOM = {};

    function cachearElementos() {
        DOM.painelMain = document.getElementById('painel-main');
        DOM.statusIndicator = document.getElementById('status-indicator');
        DOM.ultimaAtualizacao = document.getElementById('ultima-atualizacao');
        DOM.filtroStatus = document.getElementById('filtro-status');
        DOM.filtroPeriodo = document.getElementById('filtro-periodo');

        DOM.totalPacientes = document.getElementById('total-pacientes');
        DOM.totalExames = document.getElementById('total-exames');
        DOM.totalAguardando = document.getElementById('total-aguardando');
        DOM.totalSemLaudo = document.getElementById('total-sem-laudo');
        DOM.totalLaudado = document.getElementById('total-laudado');

        DOM.btnVoltar = document.getElementById('btn-voltar');
        DOM.btnRefresh = document.getElementById('btn-refresh');
        DOM.btnAutoScroll = document.getElementById('btn-auto-scroll');

        DOM.alertaGlobal = document.getElementById('alerta-global');
        DOM.alertaGlobalTexto = document.getElementById('alerta-global-texto');
        DOM.alertaGlobalFechar = document.getElementById('alerta-global-fechar');
        DOM.modalNovoExame = document.getElementById('modal-novo-exame');
        DOM.modalNovoBody = document.getElementById('modal-novo-body');
        DOM.btnNovoEntendido = document.getElementById('btn-novo-entendido');

        // Som
        DOM.audioAlerta = document.getElementById('audio-alerta');
        DOM.btnSom = document.getElementById('btn-som');
        DOM.volumeControl = document.getElementById('volume-control');
        DOM.volumeSlider = document.getElementById('volume-slider');
        DOM.volumeValor = document.getElementById('volume-valor');
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
        if (partes.length === 1) return partes[0];
        var iniciais = [];
        for (var i = 0; i < partes.length - 1; i++) {
            iniciais.push(partes[i].charAt(0));
        }
        return iniciais.join(' ') + ' ' + partes[partes.length - 1];
    }

    function formatarData(isoStr) {
        if (!isoStr) return '-';
        try {
            var d = new Date(isoStr);
            if (isNaN(d.getTime())) return '-';
            var dia = ('0' + d.getDate()).slice(-2);
            var mes = ('0' + (d.getMonth() + 1)).slice(-2);
            var hora = ('0' + d.getHours()).slice(-2);
            var min = ('0' + d.getMinutes()).slice(-2);
            return dia + '/' + mes + ' ' + hora + ':' + min;
        } catch (e) {
            return '-';
        }
    }

    function formatarHora(isoStr) {
        if (!isoStr) return '-';
        try {
            var d = new Date(isoStr);
            if (isNaN(d.getTime())) return '-';
            var hora = ('0' + d.getHours()).slice(-2);
            var min = ('0' + d.getMinutes()).slice(-2);
            return hora + ':' + min;
        } catch (e) {
            return '-';
        }
    }

    function formatarTempo(horas) {
        if (horas === null || horas === undefined) return '-';
        horas = parseFloat(horas);
        if (isNaN(horas)) return '-';
        if (horas < 1) return Math.round(horas * 60) + 'min';
        if (horas < 24) return horas.toFixed(1) + 'h';
        return Math.floor(horas / 24) + 'd ' + Math.round(horas % 24) + 'h';
    }

    function classeTempo(horas) {
        if (horas === null || horas === undefined) return 'tempo-normal';
        horas = parseFloat(horas);
        if (horas >= 4) return 'tempo-critico';
        if (horas >= 2) return 'tempo-alerta';
        return 'tempo-normal';
    }

    function formatarNumero(val) {
        if (val === null || val === undefined || isNaN(val)) return '-';
        return new Intl.NumberFormat('pt-BR').format(val);
    }

    function calcularHorasPS(isoStr) {
        if (!isoStr) return null;
        try {
            var d = new Date(isoStr);
            if (isNaN(d.getTime())) return null;
            return (new Date() - d) / 3600000;
        } catch (e) {
            return null;
        }
    }

    function gerarChaveExame(exame) {
        return (exame.nr_atendimento || '') + '|' + (exame.nr_prescricao || '') + '|' + (exame.ds_procedimento || '');
    }

    /**
     * Verifica se a data está dentro dos últimos N minutos
     */
    function dentroDosUltimosMinutos(isoStr, minutos) {
        if (!isoStr) return false;
        try {
            var d = new Date(isoStr);
            if (isNaN(d.getTime())) return false;
            var limiteMs = new Date().getTime() - (minutos * 60000);
            return d.getTime() >= limiteMs;
        } catch (e) {
            return false;
        }
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
        var agora = new Date();
        DOM.ultimaAtualizacao.textContent = agora.toLocaleTimeString('pt-BR', {
            hour: '2-digit', minute: '2-digit'
        });
    }

    function salvarFiltro(key, valor) {
        try { localStorage.setItem(key, valor); } catch (e) { /* ignore */ }
    }

    function recuperarFiltro(key) {
        try { return localStorage.getItem(key); } catch (e) { return null; }
    }

    // =========================================================
    // SISTEMA DE ÁUDIO
    // =========================================================

    function tocarAlerta() {
        if (!Estado.somAtivo) return;
        if (!DOM.audioAlerta) return;

        try {
            DOM.audioAlerta.volume = Estado.volume;
            DOM.audioAlerta.currentTime = 0;
            DOM.audioAlerta.play().catch(function(err) {
                console.warn('[P20] Audio bloqueado pelo navegador:', err);
            });
        } catch (e) {
            console.warn('[P20] Erro ao tocar alerta:', e);
        }
    }

    function configurarVolumeControl() {
        // Toggle expansão do slider
        if (DOM.btnSom) {
            DOM.btnSom.addEventListener('click', function(e) {
                e.stopPropagation();
                if (DOM.volumeControl) DOM.volumeControl.classList.toggle('expandido');
            });
        }

        // Slider de volume
        if (DOM.volumeSlider) {
            DOM.volumeSlider.addEventListener('input', function() {
                var val = parseInt(this.value, 10);
                Estado.volume = val / 100;
                if (DOM.volumeValor) DOM.volumeValor.textContent = val + '%';
                if (DOM.audioAlerta) DOM.audioAlerta.volume = Estado.volume;
                atualizarIconeSom();
                salvarFiltro(CONFIG.storageKeyVolume, Estado.volume.toFixed(2));
            });
        }

        // Fechar slider ao clicar fora
        document.addEventListener('click', function(e) {
            if (DOM.volumeControl && !DOM.volumeControl.contains(e.target)) {
                DOM.volumeControl.classList.remove('expandido');
            }
        });
    }

    function toggleSom() {
        Estado.somAtivo = !Estado.somAtivo;
        atualizarIconeSom();
        salvarFiltro(CONFIG.storageKeySom, Estado.somAtivo ? 'true' : 'false');
    }

    function atualizarIconeSom() {
        if (!DOM.btnSom) return;

        if (!Estado.somAtivo || Estado.volume === 0) {
            DOM.btnSom.classList.remove('btn-som-ativo');
            DOM.btnSom.classList.add('btn-som-inativo');
            DOM.btnSom.innerHTML = '<i class="fas fa-volume-mute"></i>';
        } else if (Estado.volume < 0.4) {
            DOM.btnSom.classList.remove('btn-som-inativo');
            DOM.btnSom.classList.add('btn-som-ativo');
            DOM.btnSom.innerHTML = '<i class="fas fa-volume-down"></i>';
        } else {
            DOM.btnSom.classList.remove('btn-som-inativo');
            DOM.btnSom.classList.add('btn-som-ativo');
            DOM.btnSom.innerHTML = '<i class="fas fa-volume-up"></i>';
        }
    }

    function carregarConfigSom() {
        var somSalvo = recuperarFiltro(CONFIG.storageKeySom);
        if (somSalvo !== null) {
            Estado.somAtivo = somSalvo !== 'false';
        }

        var volumeSalvo = recuperarFiltro(CONFIG.storageKeyVolume);
        if (volumeSalvo !== null) {
            Estado.volume = parseFloat(volumeSalvo) || 0.7;
        }

        // Aplicar no slider
        if (DOM.volumeSlider) DOM.volumeSlider.value = Math.round(Estado.volume * 100);
        if (DOM.volumeValor) DOM.volumeValor.textContent = Math.round(Estado.volume * 100) + '%';
        if (DOM.audioAlerta) DOM.audioAlerta.volume = Estado.volume;

        atualizarIconeSom();
    }

    // =========================================================
    // FETCH COM RETRY (ES5)
    // =========================================================

    function fetchComRetry(url, tentativas) {
        tentativas = tentativas || CONFIG.maxTentativasConexao;
        return new Promise(function(resolve, reject) {
            function tentar(n) {
                var controller = new AbortController();
                var timer = setTimeout(function() { controller.abort(); }, CONFIG.timeoutRequisicao);
                fetch(url, { signal: controller.signal })
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
                        } else {
                            reject(err);
                        }
                    });
            }
            tentar(tentativas);
        });
    }

    // =========================================================
    // FILTRO POR PERÍODO
    // =========================================================

    function filtrarPorPeriodo(exames) {
        if (!Estado.periodoSelecionado) return exames;

        var horasLimite = parseInt(Estado.periodoSelecionado, 10);
        if (isNaN(horasLimite) || horasLimite <= 0) return exames;

        var limiteMs = new Date().getTime() - (horasLimite * 3600000);

        return exames.filter(function(ex) {
            if (!ex.dt_entrada) return false;
            try {
                return new Date(ex.dt_entrada).getTime() >= limiteMs;
            } catch (e) {
                return false;
            }
        });
    }

    function recalcularCards(examesFiltrados) {
        var atendimentos = {};
        var qtAguardando = 0;
        var qtSemLaudo = 0;
        var qtLaudado = 0;

        for (var i = 0; i < examesFiltrados.length; i++) {
            var ex = examesFiltrados[i];
            atendimentos[ex.nr_atendimento] = true;
            if (ex.status_radiologia === 'AGUARDANDO') qtAguardando++;
            else if (ex.status_radiologia === 'EXECUTADO_SEM_LAUDO') qtSemLaudo++;
            else if (ex.status_radiologia === 'LAUDADO') qtLaudado++;
        }

        var cards = document.querySelectorAll('.resumo-card');
        for (var j = 0; j < cards.length; j++) {
            cards[j].classList.add('atualizando');
            (function(card) {
                setTimeout(function() { card.classList.remove('atualizando'); }, 300);
            })(cards[j]);
        }

        DOM.totalPacientes.textContent = formatarNumero(Object.keys(atendimentos).length);
        DOM.totalExames.textContent = formatarNumero(examesFiltrados.length);
        DOM.totalAguardando.textContent = formatarNumero(qtAguardando);
        DOM.totalSemLaudo.textContent = formatarNumero(qtSemLaudo);
        DOM.totalLaudado.textContent = formatarNumero(qtLaudado);
    }

    // =========================================================
    // AGRUPAR EXAMES POR PACIENTE
    // =========================================================

    function agruparPorPaciente(exames) {
        var mapa = {};
        var ordem = [];

        for (var i = 0; i < exames.length; i++) {
            var ex = exames[i];
            var key = ex.nr_atendimento;

            if (!mapa[key]) {
                mapa[key] = {
                    nr_atendimento: ex.nr_atendimento,
                    leito: ex.leito,
                    leito_base: ex.leito_base,
                    nm_pessoa_fisica: ex.nm_pessoa_fisica,
                    idade: ex.idade,
                    ds_convenio: ex.ds_convenio,
                    dt_entrada: ex.dt_entrada,
                    exames: [],
                    qt_aguardando: 0,
                    qt_sem_laudo: 0,
                    qt_laudado: 0
                };
                ordem.push(key);
            }

            mapa[key].exames.push(ex);

            if (ex.status_radiologia === 'AGUARDANDO') mapa[key].qt_aguardando++;
            else if (ex.status_radiologia === 'EXECUTADO_SEM_LAUDO') mapa[key].qt_sem_laudo++;
            else if (ex.status_radiologia === 'LAUDADO') mapa[key].qt_laudado++;
        }

        var resultado = [];
        for (var j = 0; j < ordem.length; j++) {
            resultado.push(mapa[ordem[j]]);
        }
        return resultado;
    }

    // =========================================================
    // DETECÇÃO DE NOVOS EXAMES
    // =========================================================

    /**
     * Detecta exames que:
     * 1. São NOVOS (não existiam no carregamento anterior) — comparação por ID
     * 2. São RECENTES (dt_pedido nos últimos 6 minutos) — evita alertar exames antigos do ETL
     */
    function detectarNovosExames(exames) {
        var idsAtuais = [];
        for (var i = 0; i < exames.length; i++) {
            idsAtuais.push(gerarChaveExame(exames[i]));
        }

        if (Estado.primeiroCarregamento) {
            Estado.examesAnterioresIds = idsAtuais;
            Estado.primeiroCarregamento = false;
            console.log('[P20] Baseline: ' + idsAtuais.length + ' exames registrados');
            return [];
        }

        // Encontrar IDs que não existiam antes
        var novosIds = [];
        for (var j = 0; j < idsAtuais.length; j++) {
            if (Estado.examesAnterioresIds.indexOf(idsAtuais[j]) === -1) {
                novosIds.push(idsAtuais[j]);
            }
        }

        // Atualizar baseline
        Estado.examesAnterioresIds = idsAtuais;

        if (novosIds.length === 0) return [];

        // Buscar dados completos e FILTRAR por dt_pedido recente
        var novosRecentes = [];
        for (var k = 0; k < exames.length; k++) {
            var chave = gerarChaveExame(exames[k]);
            if (novosIds.indexOf(chave) !== -1) {
                // Só alertar se dt_pedido estiver nos últimos N minutos
                if (dentroDosUltimosMinutos(exames[k].dt_pedido, CONFIG.alertaMaxMinutos)) {
                    novosRecentes.push(exames[k]);
                } else {
                    console.log('[P20] Exame novo ignorado (dt_pedido antigo): ' + chave);
                }
            }
        }

        if (novosRecentes.length > 0) {
            console.log('[P20] ' + novosRecentes.length + ' exame(s) recente(s) detectado(s)!');
        }

        return novosRecentes;
    }

    function processarNovosExames(novosExames) {
        if (novosExames.length === 0) return;

        // Tocar áudio de alerta
        tocarAlerta();

        // Ativar barra de alerta global
        ativarAlertaGlobal(novosExames.length);

        // Agrupar por paciente para o modal
        var porPaciente = {};
        for (var i = 0; i < novosExames.length; i++) {
            var ex = novosExames[i];
            var key = ex.nr_atendimento;
            if (!porPaciente[key]) {
                porPaciente[key] = {
                    nr_atendimento: ex.nr_atendimento,
                    nm_pessoa_fisica: ex.nm_pessoa_fisica,
                    dt_entrada: ex.dt_entrada,
                    ds_convenio: ex.ds_convenio,
                    leito: ex.leito_base || ex.leito,
                    exames: []
                };
            }
            porPaciente[key].exames.push(ex);
        }

        var pacientes = [];
        for (var k in porPaciente) {
            if (porPaciente.hasOwnProperty(k)) pacientes.push(porPaciente[k]);
        }

        exibirModalNovoExame(pacientes[0]);
        for (var j = 1; j < pacientes.length; j++) {
            Estado.novoExamesFila.push(pacientes[j]);
        }
    }

    // =========================================================
    // MODAL DE NOVO EXAME
    // =========================================================

    function exibirModalNovoExame(pacienteData) {
        if (!DOM.modalNovoBody) return;

        var nomeFormatado = formatarNome(pacienteData.nm_pessoa_fisica);
        var horaEntrada = formatarHora(pacienteData.dt_entrada);
        var horasPS = calcularHorasPS(pacienteData.dt_entrada);
        var tempoPS = horasPS !== null ? formatarTempo(horasPS) : '-';

        var html = '';
        html += '<div class="novo-campo"><i class="fas fa-user"></i> Paciente: <strong>' + escapeHtml(nomeFormatado) + '</strong></div>';
        html += '<div class="novo-campo"><i class="fas fa-hashtag"></i> Atendimento: <strong>' + escapeHtml(pacienteData.nr_atendimento) + '</strong></div>';
        if (pacienteData.leito) {
            html += '<div class="novo-campo"><i class="fas fa-bed"></i> Leito: <strong>' + escapeHtml(pacienteData.leito) + '</strong></div>';
        }
        html += '<div class="novo-campo"><i class="fas fa-door-open"></i> Entrada PS: <strong>' + horaEntrada + '</strong> (' + tempoPS + ' no PS)</div>';
        if (pacienteData.ds_convenio) {
            html += '<div class="novo-campo"><i class="fas fa-file-invoice"></i> Convênio: <strong>' + escapeHtml(pacienteData.ds_convenio) + '</strong></div>';
        }

        html += '<div class="novo-exames-lista">';
        html += '<div class="novo-exames-titulo"><i class="fas fa-x-ray"></i> Exame(s) solicitado(s):</div>';
        for (var i = 0; i < pacienteData.exames.length; i++) {
            var ex = pacienteData.exames[i];
            html += '<div class="novo-exame-item">';
            html += '<span class="novo-exame-nome">' + escapeHtml(ex.ds_procedimento || 'Exame') + '</span>';
            html += '<span class="novo-exame-data">' + formatarData(ex.dt_pedido) + '</span>';
            html += '</div>';
        }
        html += '</div>';

        DOM.modalNovoBody.innerHTML = html;

        if (DOM.modalNovoExame) DOM.modalNovoExame.classList.add('ativo');

        if (Estado.modalAutoCloseTimer) clearTimeout(Estado.modalAutoCloseTimer);
        Estado.modalAutoCloseTimer = setTimeout(function() {
            fecharModalNovoExame();
        }, CONFIG.modalAutoCloseMs);
    }

    function fecharModalNovoExame() {
        if (Estado.modalAutoCloseTimer) {
            clearTimeout(Estado.modalAutoCloseTimer);
            Estado.modalAutoCloseTimer = null;
        }

        if (DOM.modalNovoExame) DOM.modalNovoExame.classList.remove('ativo');

        if (Estado.novoExamesFila.length > 0) {
            var proximo = Estado.novoExamesFila.shift();
            setTimeout(function() {
                tocarAlerta();
                exibirModalNovoExame(proximo);
            }, 500);
        }
    }

    function ativarAlertaGlobal(quantidade) {
        if (!DOM.alertaGlobal) return;
        DOM.alertaGlobal.classList.add('ativo');
        if (DOM.alertaGlobalTexto) {
            DOM.alertaGlobalTexto.textContent = quantidade === 1
                ? 'NOVO EXAME SOLICITADO!'
                : quantidade + ' NOVOS EXAMES SOLICITADOS!';
        }
    }

    function desativarAlertaGlobal() {
        if (DOM.alertaGlobal) DOM.alertaGlobal.classList.remove('ativo');
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

        var url = CONFIG.api.dados;
        if (Estado.statusSelecionado) {
            url += '?status=' + encodeURIComponent(Estado.statusSelecionado);
        }

        return fetchComRetry(url)
            .then(function(resp) {
                if (!resp.success) {
                    mostrarErro('Erro ao carregar dados');
                    return;
                }

                var todosExames = resp.data || [];

                // 1) Detectar novos exames recentes (antes de filtrar)
                var novos = detectarNovosExames(todosExames);
                if (novos.length > 0) processarNovosExames(novos);

                // 2) Armazenar e filtrar
                Estado.dadosExames = todosExames;
                Estado.dadosFiltrados = filtrarPorPeriodo(todosExames);

                // 3) Recalcular cards e renderizar
                recalcularCards(Estado.dadosFiltrados);
                renderizarTabela();

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
                console.error('[P20] Erro ao carregar dados:', err);
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

    function reaplicarFiltro() {
        Estado.dadosFiltrados = filtrarPorPeriodo(Estado.dadosExames);
        recalcularCards(Estado.dadosFiltrados);
        renderizarTabela();
    }

    // =========================================================
    // RENDERIZAÇÃO DA TABELA
    // =========================================================

    function renderizarTabela() {
        if (!DOM.painelMain) return;

        var dados = Estado.dadosFiltrados;

        if (!dados || dados.length === 0) {
            var periodoTexto = Estado.periodoSelecionado
                ? 'nas últimas ' + Estado.periodoSelecionado + ' horas'
                : 'para o filtro selecionado';
            DOM.painelMain.innerHTML =
                '<div class="mensagem-vazia">' +
                '<i class="fas fa-check-circle"></i>' +
                '<h3>Nenhuma pendência encontrada</h3>' +
                '<p>Não há exames de radiologia pendentes ' + periodoTexto + '</p>' +
                '</div>';
            return;
        }

        var pacientes = agruparPorPaciente(dados);
        var linhasHtml = '';
        for (var i = 0; i < pacientes.length; i++) {
            linhasHtml += criarLinhasPaciente(pacientes[i], i === pacientes.length - 1);
        }

        var html =
            '<div class="tabela-container">' +
            '<table class="tabela-radiologia">' +
            '<thead><tr>' +
            '<th class="col-dt-entrada"><i class="fas fa-door-open"></i> Dt. Entrada</th>' +
            '<th class="col-atendimento">Atend.</th>' +
            '<th class="col-paciente">Paciente</th>' +
            '<th class="col-tempo-atend"><i class="fas fa-clock"></i> Tempo Atend.</th>' +
            '<th class="col-convenio">Convênio</th>' +
            '<th class="col-aguardando"><i class="fas fa-hourglass-half"></i> Aguar.</th>' +
            '<th class="col-sem-laudo"><i class="fas fa-exclamation-triangle"></i> S/Laudo</th>' +
            '<th class="col-laudado"><i class="fas fa-check-circle"></i> Laudado</th>' +
            '</tr></thead>' +
            '<tbody id="tabela-body">' + linhasHtml + '</tbody>' +
            '</table></div>';

        DOM.painelMain.innerHTML = html;
    }

    function criarLinhasPaciente(pac, isUltimo) {
        var nomeFormatado = formatarNome(pac.nm_pessoa_fisica);
        var classePrincipal = 'linha-principal';

        if (pac.qt_sem_laudo > 0) {
            classePrincipal += ' tem-sem-laudo';
        } else if (pac.qt_aguardando > 0) {
            classePrincipal += ' tem-aguardando';
        } else {
            classePrincipal += ' todos-laudados';
        }

        var horasPS = calcularHorasPS(pac.dt_entrada);
        var classeTempoPS = '';
        if (horasPS !== null) {
            if (horasPS >= 12) classeTempoPS = ' entrada-critico';
            else if (horasPS >= 6) classeTempoPS = ' entrada-alerta';
        }

        var html = '<tr class="' + classePrincipal + '">';

        html += '<td class="col-dt-entrada"><span class="dt-entrada-badge">' +
            formatarData(pac.dt_entrada) + '</span></td>';

        html += '<td class="col-atendimento">' + escapeHtml(pac.nr_atendimento) + '</td>';

        html += '<td class="col-paciente"><div class="paciente-info">' +
            '<span class="paciente-nome">' + escapeHtml(nomeFormatado) + '</span>' +
            '<span class="paciente-idade">' + (pac.idade !== null && pac.idade !== undefined ? pac.idade + ' anos' : '') + '</span>' +
            '</div></td>';

        html += '<td class="col-tempo-atend' + classeTempoPS + '">';
        if (horasPS !== null) {
            html += '<span class="tempo-atend-valor">' + formatarTempo(horasPS) + '</span>';
        } else {
            html += '<span class="tempo-atend-valor">-</span>';
        }
        html += '</td>';

        html += '<td class="col-convenio">' + escapeHtml(pac.ds_convenio || '-') + '</td>';

        html += '<td class="col-aguardando">' + renderBadge(pac.qt_aguardando, 'aguardando') + '</td>';
        html += '<td class="col-sem-laudo">' + renderBadge(pac.qt_sem_laudo, 'sem-laudo') + '</td>';
        html += '<td class="col-laudado">' + renderBadge(pac.qt_laudado, 'laudado') + '</td>';

        html += '</tr>';

        for (var i = 0; i < pac.exames.length; i++) {
            html += criarLinhaExame(pac.exames[i], i === pac.exames.length - 1);
        }

        return html;
    }

    function criarLinhaExame(ex, isUltima) {
        var statusClass = '';
        var statusLabel = '';
        var icone = '';
        var bgClass = '';

        if (ex.status_radiologia === 'AGUARDANDO') {
            statusClass = 'aguardando';
            statusLabel = 'Aguardando';
            icone = 'fa-hourglass-half';
            bgClass = 'linha-exame-aguardando';
        } else if (ex.status_radiologia === 'EXECUTADO_SEM_LAUDO') {
            statusClass = 'sem-laudo';
            statusLabel = 'Sem Laudo';
            icone = 'fa-exclamation-triangle';
            bgClass = 'linha-exame-sem-laudo';
        } else {
            statusClass = 'laudado';
            statusLabel = 'Laudado';
            icone = 'fa-check-circle';
            bgClass = 'linha-exame-laudado';
        }

        var classeRow = 'linha-detalhes ' + bgClass;
        if (isUltima) classeRow += ' ultima-linha';

        var html = '<tr class="' + classeRow + '"><td colspan="8"><div class="exame-linha">';

        html += '<span class="exame-status-icone ' + statusClass + '"><i class="fas ' + icone + '"></i></span>';
        html += '<span class="exame-prescricao">#' + escapeHtml(ex.nr_prescricao) + '</span>';
        html += '<span class="exame-nome">' + escapeHtml(ex.ds_procedimento || '-') + '</span>';

        html += '<span class="exame-datas">';
        html += '<span><i class="fas fa-calendar"></i>' + formatarData(ex.dt_pedido) + '</span>';
        if (ex.dt_execucao) {
            html += '<span><i class="fas fa-play"></i>' + formatarData(ex.dt_execucao) + '</span>';
        }
        if (ex.dt_laudo_liberacao) {
            html += '<span><i class="fas fa-file-medical"></i>' + formatarData(ex.dt_laudo_liberacao) + '</span>';
        }
        html += '</span>';

        if (ex.status_radiologia !== 'LAUDADO' && ex.horas_espera !== null) {
            html += '<span class="exame-tempo ' + classeTempo(ex.horas_espera) + '">' +
                formatarTempo(ex.horas_espera) + '</span>';
        }

        html += '<span class="exame-status-badge ' + statusClass + '">' + statusLabel + '</span>';

        html += '</div></td></tr>';
        return html;
    }

    function renderBadge(qtd, tipo) {
        qtd = qtd || 0;
        var classe = qtd > 0 ? ('badge-' + tipo) : 'badge-zero';
        return '<span class="badge-count ' + classe + '">' + qtd + '</span>';
    }

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
            if (!Estado.autoScrollAtivo && Estado.dadosFiltrados.length > 0) {
                Estado.autoScrollAtivo = true;
                Estado.autoScrollIniciado = true;
                atualizarBotaoScroll();
                iniciarAutoScroll();
            }
        }, CONFIG.delayAutoScrollInicial);
    }

    // =========================================================
    // EVENTOS
    // =========================================================

    var filtrosVisiveis = false;

    function configurarEventos() {
        var btnToggleFiltros = document.getElementById('btn-toggle-filtros');
        if (btnToggleFiltros) {
            btnToggleFiltros.addEventListener('click', function() {
                filtrosVisiveis = !filtrosVisiveis;
                var bar = document.getElementById('filtros-bar');
                if (bar) bar.style.display = filtrosVisiveis ? 'block' : 'none';
            });
        }

        if (DOM.filtroPeriodo) {
            DOM.filtroPeriodo.addEventListener('change', function() {
                Estado.periodoSelecionado = this.value;
                salvarFiltro(CONFIG.storageKeyPeriodo, this.value);
                reaplicarFiltro();
            });
        }

        if (DOM.filtroStatus) {
            DOM.filtroStatus.addEventListener('change', function() {
                Estado.statusSelecionado = this.value;
                salvarFiltro(CONFIG.storageKeyStatus, this.value);
                carregarDados();
            });
        }

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

        if (DOM.btnNovoEntendido) {
            DOM.btnNovoEntendido.addEventListener('click', function() {
                fecharModalNovoExame();
            });
        }

        if (DOM.alertaGlobalFechar) {
            DOM.alertaGlobalFechar.addEventListener('click', function() {
                desativarAlertaGlobal();
            });
        }

        if (DOM.modalNovoExame) {
            DOM.modalNovoExame.addEventListener('click', function(e) {
                if (e.target === DOM.modalNovoExame) fecharModalNovoExame();
            });
        }

        document.addEventListener('keydown', function(e) {
            if (e.key === 'Escape') {
                if (DOM.modalNovoExame && DOM.modalNovoExame.classList.contains('ativo')) {
                    fecharModalNovoExame();
                    return;
                }
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
        console.log('[P20] Inicializando Painel Radiologia PS...');

        cachearElementos();

        // Restaurar filtros
        Estado.statusSelecionado = recuperarFiltro(CONFIG.storageKeyStatus) || '';
        var periodoSalvo = recuperarFiltro(CONFIG.storageKeyPeriodo);
        Estado.periodoSelecionado = periodoSalvo !== null ? periodoSalvo : '12';

        if (Estado.statusSelecionado && DOM.filtroStatus) {
            DOM.filtroStatus.value = Estado.statusSelecionado;
        }
        if (DOM.filtroPeriodo) {
            DOM.filtroPeriodo.value = Estado.periodoSelecionado;
        }

        // Carregar config de som
        carregarConfigSom();
        configurarVolumeControl();

        configurarEventos();
        carregarDados();

        Estado.intervalos.refresh = setInterval(function() { carregarDados(); }, CONFIG.intervaloRefresh);

        console.log('[P20] Painel Radiologia PS inicializado');
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', inicializar);
    } else {
        inicializar();
    }

})();