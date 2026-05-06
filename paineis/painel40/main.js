/**
 * ==============================================================================
 * PAINEL 40 - Requisicoes Urgentes de Materiais/Medicamentos
 * Sistema de Paineis - Hospital Anchieta Ceilandia
 * 
 * ES5 puro (sem let, const, arrow functions, template literals)
 * IIFE com Estado / DOM / CONFIG
 * Auto-refresh a cada 30s, timer visual a cada 1s
 * Audio chamado.mp3 ao detectar nova nr_requisicao
 * ==============================================================================
 */

(function() {
    'use strict';

    // ==========================================================================
    // CONFIGURACAO
    // ==========================================================================

    var CONFIG = {
        intervaloRefresh: 30000,
        intervaloTimer: 1000,
        endpoints: {
            dashboard: '/api/paineis/painel40/dashboard',
            dados: '/api/paineis/painel40/dados'
        },
        prefixoStorage: 'painel40_',
        urlAudio: '/static/chamado.mp3',
        thresholdsTempo: { verde: 5, laranja: 15, vermelho: 30 }
    };

    // ==========================================================================
    // ESTADO
    // ==========================================================================

    var Estado = {
        requisicoesAtuais: [],
        nrsConhecidos: {},
        primeiraCarga: true,
        audioDesbloqueado: false,
        dadosCache: null,
        timerRefresh: null,
        timerClock: null
    };

    // ==========================================================================
    // REFERENCIAS DOM
    // ==========================================================================

    var DOM = {};

    function capturarDOM() {
        DOM.contadorNumero = document.getElementById('contador-numero');
        DOM.btnAtivarSom = document.getElementById('btn-ativar-som');
        DOM.btnRefresh = document.getElementById('btn-refresh');
        DOM.btnVoltar = document.getElementById('btn-voltar');
        DOM.ultimaAtualizacao = document.getElementById('ultima-atualizacao');
        DOM.kpiTotalRequisicoes = document.getElementById('kpi-total-requisicoes');
        DOM.kpiItensPendentes = document.getElementById('kpi-itens-pendentes');
        DOM.kpiItensAtendidos = document.getElementById('kpi-itens-atendidos');
        DOM.kpiTempoMax = document.getElementById('kpi-tempo-max');
        DOM.requisicoesGrid = document.getElementById('requisicoes-grid');
        DOM.requisicoesArea = document.getElementById('requisicoes-area');
        DOM.emptyState = document.getElementById('empty-state');
        DOM.loadingContainer = document.getElementById('loading-container');
        DOM.audio = document.getElementById('audio-chamado');
    }

    // ==========================================================================
    // INICIALIZACAO
    // ==========================================================================

    function inicializar() {
        capturarDOM();
        configurarEventos();
        configurarAudio();
        carregarDados();

        // Auto-refresh a cada 30s
        Estado.timerRefresh = setInterval(carregarDados, CONFIG.intervaloRefresh);

        // Timer visual a cada 1s (atualiza tempos sem fetch)
        Estado.timerClock = setInterval(atualizarTimers, CONFIG.intervaloTimer);
    }

    function configurarEventos() {
        if (DOM.btnRefresh) {
            DOM.btnRefresh.addEventListener('click', function() {
                DOM.btnRefresh.classList.add('girando');
                carregarDados();
                setTimeout(function() {
                    DOM.btnRefresh.classList.remove('girando');
                }, 600);
            });
        }

        if (DOM.btnVoltar) {
            DOM.btnVoltar.addEventListener('click', function() {
                window.location.href = '/dashboard';
            });
        }

        if (DOM.btnAtivarSom) {
            DOM.btnAtivarSom.addEventListener('click', function() {
                desbloquearAudioManual();
            });
        }
    }

    // ==========================================================================
    // AUDIO - DESBLOQUEIO E REPRODUCAO
    // ==========================================================================

    function configurarAudio() {
        var audio = DOM.audio;
        if (!audio) return;

        audio.loop = false;

        // Tentar desbloquear automaticamente
        tentarDesbloquearAudio();
    }

    function tentarDesbloquearAudio() {
        var audio = DOM.audio;
        if (!audio) return;

        audio.muted = true;
        var p = audio.play();
        if (p && typeof p.then === 'function') {
            p.then(function() {
                audio.pause();
                audio.muted = false;
                audio.currentTime = 0;
                Estado.audioDesbloqueado = true;
                esconderBotaoAtivarSom();
                console.log('[AUDIO] Autoplay desbloqueado automaticamente');
            }).catch(function() {
                console.log('[AUDIO] Autoplay bloqueado, mostrando botao');
                audio.muted = false;
                mostrarBotaoAtivarSom();
            });
        }
    }

    function desbloquearAudioManual() {
        var audio = DOM.audio;
        if (!audio) return;

        audio.currentTime = 0;
        var p = audio.play();
        if (p && typeof p.then === 'function') {
            p.then(function() {
                audio.pause();
                audio.currentTime = 0;
                Estado.audioDesbloqueado = true;
                esconderBotaoAtivarSom();
                console.log('[AUDIO] Audio desbloqueado manualmente');
            }).catch(function(err) {
                console.warn('[AUDIO] Falha ao desbloquear:', err);
            });
        }
    }

    function mostrarBotaoAtivarSom() {
        if (DOM.btnAtivarSom) {
            DOM.btnAtivarSom.classList.remove('oculto');
        }
    }

    function esconderBotaoAtivarSom() {
        if (DOM.btnAtivarSom) {
            DOM.btnAtivarSom.classList.add('oculto');
        }
    }

    function tocarChamado() {
        var audio = DOM.audio;
        if (!audio) return;

        audio.currentTime = 0;
        var promise = audio.play();
        if (promise && typeof promise.catch === 'function') {
            promise.catch(function(err) {
                console.warn('[AUDIO] Audio bloqueado pelo browser:', err);
                Estado.audioDesbloqueado = false;
                mostrarBotaoAtivarSom();
            });
        }
    }

    // ==========================================================================
    // DETECCAO DE NOVAS REQUISICOES
    // ==========================================================================

    function detectarNovasRequisicoes(requisicoesNovas) {
        if (Estado.primeiraCarga) {
            // Primeira carga: registra NRs mas NAO toca som
            for (var i = 0; i < requisicoesNovas.length; i++) {
                Estado.nrsConhecidos[requisicoesNovas[i].nr_requisicao] = true;
            }
            Estado.primeiraCarga = false;
            return;
        }

        var temNova = false;
        var nrsAtuais = {};
        for (var j = 0; j < requisicoesNovas.length; j++) {
            var nr = requisicoesNovas[j].nr_requisicao;
            nrsAtuais[nr] = true;
            if (!Estado.nrsConhecidos[nr]) {
                temNova = true;
                console.log('[ALERTA] Nova requisicao detectada:', nr);
            }
        }
        // Substituir totalmente (nao acumular NRs antigos)
        Estado.nrsConhecidos = nrsAtuais;

        if (temNova) {
            tocarChamado();
        }
    }

    // ==========================================================================
    // CARREGAMENTO DE DADOS
    // ==========================================================================

    function carregarDados() {
        // Buscar KPIs e dados em paralelo
        var promiseKPIs = fetch(CONFIG.endpoints.dashboard, { credentials: 'include' })
            .then(function(resp) { return resp.json(); });

        var promiseDados = fetch(CONFIG.endpoints.dados, { credentials: 'include' })
            .then(function(resp) { return resp.json(); });

        Promise.all([promiseKPIs, promiseDados])
            .then(function(resultados) {
                var kpis = resultados[0];
                var dados = resultados[1];

                if (kpis.success) {
                    atualizarKPIs(kpis);
                }

                if (dados.success) {
                    Estado.dadosCache = dados;
                    Estado.requisicoesAtuais = dados.requisicoes || [];
                    detectarNovasRequisicoes(Estado.requisicoesAtuais);
                    renderizarRequisicoes(Estado.requisicoesAtuais);
                }

                // Esconder loading
                if (DOM.loadingContainer) {
                    DOM.loadingContainer.style.display = 'none';
                }

                atualizarHoraAtualizacao();
            })
            .catch(function(err) {
                console.error('[FETCH] Erro ao carregar dados:', err);
                if (DOM.loadingContainer) {
                    DOM.loadingContainer.style.display = 'none';
                }
            });
    }

    // ==========================================================================
    // ATUALIZACAO DE KPIs
    // ==========================================================================

    function atualizarKPIs(kpis) {
        if (DOM.kpiTotalRequisicoes) {
            DOM.kpiTotalRequisicoes.textContent = kpis.total_requisicoes || 0;
        }
        if (DOM.kpiItensPendentes) {
            DOM.kpiItensPendentes.textContent = kpis.itens_pendentes || 0;
        }
        if (DOM.kpiItensAtendidos) {
            DOM.kpiItensAtendidos.textContent = kpis.itens_atendidos || 0;
        }
        if (DOM.kpiTempoMax) {
            DOM.kpiTempoMax.textContent = kpis.tempo_max_espera_min || 0;
        }
        if (DOM.contadorNumero) {
            DOM.contadorNumero.textContent = kpis.itens_pendentes || 0;
        }
    }

    // ==========================================================================
    // RENDERIZACAO DE REQUISICOES
    // ==========================================================================

    function renderizarRequisicoes(requisicoes) {
        if (!DOM.requisicoesGrid) return;

        if (!requisicoes || requisicoes.length === 0) {
            DOM.requisicoesGrid.innerHTML = '';
            DOM.requisicoesArea.style.display = 'none';
            DOM.emptyState.style.display = 'flex';
            return;
        }

        DOM.emptyState.style.display = 'none';
        DOM.requisicoesArea.style.display = '';

        var html = '';
        for (var i = 0; i < requisicoes.length; i++) {
            html += renderizarCard(requisicoes[i]);
        }
        DOM.requisicoesGrid.innerHTML = html;
    }

    function renderizarCard(req) {
        var minutos = req.minutos_aguardando || 0;
        var todosAtendidos = req.itens_pendentes === 0 && req.total_itens > 0;
        var classesTempo = obterClasseTempo(minutos, todosAtendidos);
        var tempoTexto = formatarTempo(minutos);

        // Formatar hora de liberacao
        var horaLib = '--:--';
        if (req.dt_liberacao) {
            var dtLib = new Date(req.dt_liberacao);
            if (!isNaN(dtLib.getTime())) {
                horaLib = padZero(dtLib.getHours()) + ':' + padZero(dtLib.getMinutes());
            }
        }

        // Origem e destino
        var origem = escapeHtml(req.ds_local_estoque || 'N/I');
        var destino = escapeHtml(req.ds_local_estoque_destino || 'N/I');
        var solicitante = escapeHtml(req.nm_requisitante || 'N/I');

        var cardHtml = '';
        cardHtml += '<div class="card-requisicao" data-nr="' + req.nr_requisicao + '" data-dt-liberacao="' + (req.dt_liberacao || '') + '">';

        // Header
        cardHtml += '<div class="card-header-req ' + classesTempo + '">';
        cardHtml += '<div class="card-header-left">';
        cardHtml += '<span class="nr-requisicao"><i class="fas fa-hashtag"></i>' + req.nr_requisicao + '</span>';
        cardHtml += '</div>';
        cardHtml += '<div class="card-header-right">';
        if (!todosAtendidos) {
            cardHtml += '<span class="tempo-aguardando">' + tempoTexto + '</span>';
        } else {
            cardHtml += '<span class="tempo-aguardando"><i class="fas fa-check-double"></i> Completo</span>';
        }
        cardHtml += '<span class="progresso-itens">' + req.itens_atendidos + '/' + req.total_itens + ' atendidos</span>';
        cardHtml += '</div>';
        cardHtml += '</div>';

        // Meta
        cardHtml += '<div class="card-meta">';
        cardHtml += '<div class="meta-linha"><i class="fas fa-route"></i> <span class="meta-rota">' + origem + '</span> <span class="meta-seta">&rarr;</span> <span class="meta-rota">' + destino + '</span></div>';
        cardHtml += '<div class="meta-linha"><i class="fas fa-user"></i> <strong>' + solicitante + '</strong></div>';
        cardHtml += '<div class="meta-linha"><i class="fas fa-clock"></i> Liberado as ' + horaLib + '</div>';
        cardHtml += '</div>';

        // Itens
        cardHtml += '<div class="card-itens">';
        var itens = req.itens || [];
        for (var j = 0; j < itens.length; j++) {
            cardHtml += renderizarItem(itens[j]);
        }
        cardHtml += '</div>';

        cardHtml += '</div>';
        return cardHtml;
    }

    function renderizarItem(item) {
        var isPendente = item.status === 'pendente';
        var iconeClass = isPendente ? 'pendente' : 'atendido';
        var icone = isPendente ? '<i class="fas fa-hourglass-half"></i>' : '<i class="fas fa-check"></i>';

        var material = escapeHtml(item.ds_material || 'Material sem descricao');
        var qtd = (item.qt_material_requisitada || 0) + ' ' + escapeHtml(item.cd_unidade_medida || '');

        var html = '';
        html += '<div class="item-row">';
        html += '<div class="status-icon ' + iconeClass + '">' + icone + '</div>';
        html += '<div class="item-info">';
        html += '<div class="item-material">' + material + '</div>';

        if (!isPendente && item.nm_pessoa_atende) {
            var horaAtend = '';
            if (item.dt_atendimento) {
                var dtA = new Date(item.dt_atendimento);
                if (!isNaN(dtA.getTime())) {
                    horaAtend = ' as ' + padZero(dtA.getHours()) + ':' + padZero(dtA.getMinutes());
                }
            }
            html += '<div class="item-detalhe">por ' + escapeHtml(item.nm_pessoa_atende) + horaAtend + '</div>';
        }

        html += '</div>';
        html += '<div class="item-qtd">' + qtd + '</div>';
        html += '</div>';
        return html;
    }

    // ==========================================================================
    // TIMER VISUAL (atualiza tempos a cada 1s sem fetch)
    // ==========================================================================

    function atualizarTimers() {
        if (!Estado.dadosCache || !Estado.dadosCache.requisicoes) return;

        var agora = new Date();
        var cards = document.querySelectorAll('.card-requisicao[data-dt-liberacao]');

        for (var i = 0; i < cards.length; i++) {
            var card = cards[i];
            var dtStr = card.getAttribute('data-dt-liberacao');
            if (!dtStr) continue;

            var dt = new Date(dtStr);
            if (isNaN(dt.getTime())) continue;

            var minutos = Math.floor((agora - dt) / 60000);

            // Atualizar texto de tempo
            var spanTempo = card.querySelector('.tempo-aguardando');
            if (spanTempo && spanTempo.innerHTML.indexOf('Completo') === -1) {
                spanTempo.textContent = formatarTempo(minutos);
            }

            // Atualizar cor do card-header conforme threshold
            var header = card.querySelector('.card-header-req');
            if (header && !header.classList.contains('tempo-completo')) {
                atualizarCorPorTempo(header, minutos);
            }
        }
    }

    function atualizarCorPorTempo(headerEl, minutos) {
        // Remover classes de tempo anteriores
        headerEl.classList.remove('tempo-verde', 'tempo-laranja', 'tempo-vermelho', 'tempo-critico');

        if (minutos > CONFIG.thresholdsTempo.vermelho) {
            headerEl.classList.add('tempo-critico');
        } else if (minutos >= CONFIG.thresholdsTempo.laranja) {
            headerEl.classList.add('tempo-vermelho');
        } else if (minutos >= CONFIG.thresholdsTempo.verde) {
            headerEl.classList.add('tempo-laranja');
        } else {
            headerEl.classList.add('tempo-verde');
        }
    }

    // ==========================================================================
    // UTILITARIOS
    // ==========================================================================

    function obterClasseTempo(minutos, todosAtendidos) {
        if (todosAtendidos) return 'tempo-completo';
        if (minutos > CONFIG.thresholdsTempo.vermelho) return 'tempo-critico';
        if (minutos >= CONFIG.thresholdsTempo.laranja) return 'tempo-vermelho';
        if (minutos >= CONFIG.thresholdsTempo.verde) return 'tempo-laranja';
        return 'tempo-verde';
    }

    function formatarTempo(min) {
        if (min < 0) min = 0;
        if (min >= 60) {
            var h = Math.floor(min / 60);
            var m = min % 60;
            return h + ' h ' + m + ' min';
        }
        return min + ' min';
    }

    function padZero(n) {
        return n < 10 ? '0' + n : '' + n;
    }

    function atualizarHoraAtualizacao() {
        if (!DOM.ultimaAtualizacao) return;
        var agora = new Date();
        DOM.ultimaAtualizacao.textContent = padZero(agora.getHours()) + ':' + padZero(agora.getMinutes()) + ':' + padZero(agora.getSeconds());
    }

    function escapeHtml(texto) {
        if (!texto) return '';
        var div = document.createElement('div');
        div.textContent = texto;
        return div.innerHTML;
    }

    // ==========================================================================
    // INICIAR
    // ==========================================================================

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', inicializar);
    } else {
        inicializar();
    }

})();
