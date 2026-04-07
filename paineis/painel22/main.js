/**
 * PAINEL 22 - Acompanhamento de Exames PS
 *
 * 7 colunas: Atend | Paciente(+clinica) | Lab | Tempo || Radio | Tempo | Medico
 * Separador visual entre Lab/Tempo e Radio/Tempo
 * Concluido: mostra "Liberado ha Xmin"
 * Paciente some 1h apos ultimo exame liberado
 */

(function() {
    'use strict';

    var IS_PUBLICO = window.location.pathname.indexOf('/publico/') !== -1;

    var CONFIG = {
        api: {
            dados: IS_PUBLICO
                ? '/api/publico/painel22/dados'
                : '/api/paineis/painel22/dados'
        },
        intervaloRefresh: 120000,
        velocidadeScroll: 1.0,
        intervaloScroll: 50,
        pausaNoFinal: 6000,
        pausaAposReset: 5000,
        delayAutoScrollInicial: 10000,
        watchdogInterval: 3000,
        watchdogMaxTravamentos: 3,
        maxTentativasConexao: 3,
        timeoutRequisicao: 30000
    };

    var Estado = {
        pacientes: [],
        carregando: false,
        errosConsecutivos: 0,
        autoScrollAtivo: false,
        autoScrollIniciado: false,
        intervalos: { refresh: null, scroll: null, watchdog: null },
        timeouts: { autoScrollInicial: null },
        watchdog: { ultimaPosicao: 0, contadorTravamento: 0 }
    };

    var DOM = {};

    function cachearElementos() {
        DOM.painelMain = document.getElementById('painel-main');
        DOM.statusIndicator = document.getElementById('status-indicator');
        DOM.ultimaAtualizacao = document.getElementById('ultima-atualizacao');
        DOM.btnVoltar = document.getElementById('btn-voltar');
        DOM.btnRefresh = document.getElementById('btn-refresh');
        DOM.btnAutoScroll = document.getElementById('btn-auto-scroll');
    }

    // =========================================================
    // UTILITARIOS
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

    function formatarNomeMedico(nome) {
        if (!nome || nome.trim() === '') return '-';
        var partes = nome.trim().split(/\s+/);
        if (partes.length <= 2) return nome.trim();
        return partes[0] + ' ' + partes[partes.length - 1];
    }

    function formatarTempo(horas) {
        if (horas === null || horas === undefined) return '-';
        horas = parseFloat(horas);
        if (isNaN(horas) || horas < 0) return '-';
        var totalMinutos = Math.round(horas * 60);
        if (totalMinutos < 1) return '<1min';
        if (totalMinutos < 60) return totalMinutos + 'min';
        var h = Math.floor(totalMinutos / 60);
        var m = totalMinutos % 60;
        if (h < 24) {
            return m > 0 ? h + 'h' + (m < 10 ? '0' : '') + m : h + 'h';
        }
        var d = Math.floor(h / 24);
        var hResto = h % 24;
        var result = d + 'd ';
        if (hResto > 0 || m > 0) {
            result += hResto + 'h';
            if (m > 0) result += (m < 10 ? '0' : '') + m;
        }
        return result;
    }

    function formatarTempoDesde(horas) {
        if (horas === null || horas === undefined) return '';
        horas = parseFloat(horas);
        if (isNaN(horas) || horas < 0) return '';
        var totalMinutos = Math.round(horas * 60);
        if (totalMinutos < 1) return 'ha <1min';
        if (totalMinutos < 60) return 'ha ' + totalMinutos + 'min';
        var h = Math.floor(totalMinutos / 60);
        var m = totalMinutos % 60;
        return m > 0 ? 'ha ' + h + 'h' + (m < 10 ? '0' : '') + m : 'ha ' + h + 'h';
    }

    function classeTempo(horas) {
        if (horas === null || horas === undefined) return 'tempo-normal';
        horas = parseFloat(horas);
        if (horas >= 4) return 'tempo-critico';
        if (horas >= 2) return 'tempo-alerta';
        return 'tempo-normal';
    }

    function atualizarStatus(status) {
        if (!DOM.statusIndicator) return;
        DOM.statusIndicator.className = 'status-indicator';
        if (status === 'online') DOM.statusIndicator.classList.add('status-online');
        else if (status === 'offline') DOM.statusIndicator.classList.add('status-offline');
        else if (status === 'loading') DOM.statusIndicator.classList.add('status-loading');
    }

    function atualizarHorario() {
        if (!DOM.ultimaAtualizacao) return;
        DOM.ultimaAtualizacao.textContent = new Date().toLocaleTimeString('pt-BR', {
            hour: '2-digit', minute: '2-digit'
        });
    }

    // =========================================================
    // STATUS PREDOMINANTE
    // =========================================================

    function determinarStatusPredominante(exames) {
        if (!exames || exames.length === 0) return null;
        var contagem = { pendente: 0, andamento: 0, concluido: 0 };
        for (var i = 0; i < exames.length; i++) {
            var s = (exames[i].status_exame || '').toUpperCase();
            if (s === 'LAUDADO' || s === 'LIBERADO') contagem.concluido++;
            else if (s === 'EXECUTADO' || s === 'COLETADO' || s === 'EM_ANALISE' || s === 'RESULTADO_PARCIAL') contagem.andamento++;
            else contagem.pendente++;
        }
        if (contagem.pendente >= contagem.andamento && contagem.pendente >= contagem.concluido) return 'pendente';
        if (contagem.andamento >= contagem.concluido) return 'andamento';
        return 'concluido';
    }

    // =========================================================
    // TEMPO POR TIPO
    // =========================================================

    /**
     * Calcula tempo a ser exibido para um grupo de exames de um tipo.
     * Retorna objeto: { tipo: 'horas'|'data'|null, valor: number }
     * - 'horas': numero de horas (com fracoes)
     * - 'data':  numero de dias (0=hoje, 1=ontem, ...) para datas sem hora
     */
    function calcularTempoTipo(exames, statusTipo) {
        if (!exames || exames.length === 0) return null;

        if (statusTipo === 'concluido') {
            // Procura primeiro tempo confiavel (com hora real)
            var minHoras = null;
            var minDias = null;

            for (var i = 0; i < exames.length; i++) {
                var apenasData = exames[i].liberacao_apenas_data;
                var hd = parseFloat(exames[i].horas_desde_liberacao);
                var dias = exames[i].liberacao_dias_atras;

                if (!apenasData && !isNaN(hd) && hd >= 0) {
                    // Tempo confiavel - pega o menor (liberacao mais recente)
                    if (minHoras === null || hd < minHoras) {
                        minHoras = hd;
                    }
                } else if (apenasData && dias !== null && dias !== undefined) {
                    // Apenas data - pega o menor (mais recente)
                    if (minDias === null || dias < minDias) {
                        minDias = dias;
                    }
                }
            }

            // Prefere tempo confiavel se existir
            if (minHoras !== null) {
                return { tipo: 'horas', valor: minHoras };
            }
            if (minDias !== null) {
                return { tipo: 'data', valor: minDias };
            }
            return null;
        }

        // Pendente ou andamento: maior horas_espera
        var maxHoras = null;
        for (var j = 0; j < exames.length; j++) {
            var h = parseFloat(exames[j].horas_espera);
            if (!isNaN(h) && h > 0) {
                if (maxHoras === null || h > maxHoras) {
                    maxHoras = h;
                }
            }
        }
        if (maxHoras === null) return null;
        return { tipo: 'horas', valor: maxHoras };
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
                fetch(url, { signal: controller.signal })
                    .then(function(res) {
                        clearTimeout(timer);
                        if (!res.ok) throw new Error('HTTP ' + res.status);
                        return res.json();
                    })
                    .then(resolve)
                    .catch(function(err) {
                        clearTimeout(timer);
                        if (n > 1) setTimeout(function() { tentar(n - 1); }, 1000);
                        else reject(err);
                    });
            }
            tentar(tentativas);
        });
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

        return fetchComRetry(CONFIG.api.dados)
            .then(function(dadosResp) {
                if (dadosResp.success) {
                    Estado.pacientes = dadosResp.data || [];
                    renderizarTabela();
                }
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
                if (!Estado.autoScrollIniciado && !scrollEstaAtivo) agendarAutoScrollInicial();
            })
            .catch(function(err) {
                console.error('[P22] Erro:', err);
                Estado.errosConsecutivos++;
                atualizarStatus('offline');
                if (Estado.errosConsecutivos >= 3) mostrarErro('Falha na conexao.');
            })
            .finally(function() {
                Estado.carregando = false;
            });
    }

    // =========================================================
    // RENDERIZAR TABELA
    // =========================================================

    function renderizarTabela() {
        if (!DOM.painelMain) return;

        if (!Estado.pacientes || Estado.pacientes.length === 0) {
            DOM.painelMain.innerHTML =
                '<div class="mensagem-vazia">' +
                '<i class="fas fa-check-circle"></i>' +
                '<h3>Nenhum exame pendente</h3>' +
                '<p>Todos os pacientes do PS estao com exames concluidos</p>' +
                '</div>';
            return;
        }

        var linhasHtml = '';
        for (var i = 0; i < Estado.pacientes.length; i++) {
            linhasHtml += criarLinhaPaciente(Estado.pacientes[i]);
        }

        var html =
            '<div class="tabela-container">' +
            '<table class="tabela-exames">' +
            '<thead><tr>' +
            '<th class="col-atendimento"><i class="fas fa-hashtag"></i> Atend.</th>' +
            '<th class="col-paciente"><i class="fas fa-user"></i> Paciente</th>' +
            '<th class="col-lab col-grupo-inicio"><i class="fas fa-flask"></i> Lab</th>' +
            '<th class="col-tempo-lab">Tempo</th>' +
            '<th class="col-radio col-grupo-inicio"><i class="fas fa-x-ray"></i> Radio</th>' +
            '<th class="col-tempo-rad">Tempo</th>' +
            '<th class="col-medico"><i class="fas fa-user-md"></i> Medico</th>' +
            '</tr></thead>' +
            '<tbody id="tabela-body">' + linhasHtml + '</tbody>' +
            '</table></div>';

        DOM.painelMain.innerHTML = html;
    }

    function criarLinhaPaciente(pac) {
        var nomeFormatado = formatarNome(pac.nm_pessoa_fisica);
        var pct = pac.pct_concluido || 0;
        var todosConcluidos = (pct === 100);

        var classeLinha = '';
        if (todosConcluidos) classeLinha = 'linha-concluida';
        else if (pac.qt_pendentes > 0) classeLinha = 'linha-pendente';
        else classeLinha = 'linha-andamento';

        var statusLab = determinarStatusPredominante(pac.exames_lab);
        var statusRadio = determinarStatusPredominante(pac.exames_radio);
        var tempoLab = calcularTempoTipo(pac.exames_lab, statusLab);
        var tempoRadio = calcularTempoTipo(pac.exames_radio, statusRadio);

        var html = '<tr class="' + classeLinha + '">';

        // Atendimento
        html += '<td class="col-atendimento"><span class="atendimento-valor">' + escapeHtml(pac.nr_atendimento) + '</span></td>';

        // Paciente (nome + clinica como subinfo)
        html += '<td class="col-paciente"><div class="paciente-grupo">';
        html += '<span class="paciente-nome" title="' + escapeHtml(pac.nm_pessoa_fisica) + '">' + escapeHtml(nomeFormatado) + '</span>';
        if (pac.ds_clinica) {
            html += '<span class="paciente-subinfo"><i class="fas fa-clinic-medical"></i> ' + escapeHtml(pac.ds_clinica) + '</span>';
        }
        html += '</div></td>';

        // Lab - badge | Tempo (com separador esquerdo)
        html += '<td class="col-lab col-grupo-inicio">' + renderBadge(statusLab) + '</td>';
        html += '<td class="col-tempo-lab">' + renderTempoTipo(tempoLab, statusLab) + '</td>';

        // Radio - badge | Tempo (com separador esquerdo)
        html += '<td class="col-radio col-grupo-inicio">' + renderBadge(statusRadio) + '</td>';
        html += '<td class="col-tempo-rad">' + renderTempoTipo(tempoRadio, statusRadio) + '</td>';

        // Medico (ultimo coluna, primeiro + ultimo nome)
        html += '<td class="col-medico"><span class="medico-valor">' + escapeHtml(formatarNomeMedico(pac.nm_medico)) + '</span></td>';

        html += '</tr>';
        return html;
    }

    // =========================================================
    // BADGES E TEMPO
    // =========================================================

    function renderBadge(status) {
        if (!status) return '<span class="status-sem-exame">-</span>';
        if (status === 'pendente') return '<span class="status-badge badge-pendente">Aguardando</span>';
        if (status === 'andamento') return '<span class="status-badge badge-andamento">Em andamento</span>';
        return '<span class="status-badge badge-concluido"><i class="fas fa-check"></i> Concluido</span>';
    }

    function renderTempoTipo(tempo, statusTipo) {
        if (tempo === null || tempo === undefined) {
            return '<span class="status-sem-exame">-</span>';
        }

        if (statusTipo === 'concluido') {
            if (tempo.tipo === 'horas') {
                // Tempo confiavel - mostra "ha Xmin"
                var textoDesde = formatarTempoDesde(tempo.valor);
                return '<span class="tempo-tipo-badge tempo-liberado" title="Liberado">' +
                    '<i class="fas fa-check-circle"></i> ' + textoDesde +
                '</span>';
            }
            // tipo === 'data' - data sem hora real (radiologia)
            var textoData;
            if (tempo.valor === 0) textoData = 'hoje';
            else if (tempo.valor === 1) textoData = 'ontem';
            else textoData = 'ha ' + tempo.valor + ' dias';

            return '<span class="tempo-tipo-badge tempo-liberado" title="Liberado">' +
                '<i class="fas fa-check-circle"></i> Liberado ' + textoData +
            '</span>';
        }

        // Pendente ou andamento
        var classeT = classeTempo(tempo.valor);
        return '<span class="tempo-tipo-badge ' + classeT + '" title="Tempo em espera">' +
            '<i class="fas fa-hourglass-half tempo-contando"></i> ' + formatarTempo(tempo.valor) +
        '</span>';
    }

    function mostrarErro(msg) {
        if (!DOM.painelMain) return;
        DOM.painelMain.innerHTML =
            '<div class="mensagem-erro">' +
            '<i class="fas fa-exclamation-triangle"></i>' +
            '<h3>Erro ao Carregar</h3>' +
            '<p>' + escapeHtml(msg) + '</p>' +
            '<button class="btn-tentar-novamente" onclick="location.reload()">' +
            '<i class="fas fa-sync-alt"></i> Tentar Novamente</button></div>';
    }

    // =========================================================
    // AUTO-SCROLL COM WATCHDOG
    // =========================================================

    function getElementoScroll() { return document.getElementById('tabela-body'); }

    function iniciarAutoScroll() {
        pararAutoScroll();
        var elem = getElementoScroll();
        if (!elem) return;
        if (elem.scrollHeight - elem.clientHeight <= 5) return;

        Estado.watchdog = { ultimaPosicao: elem.scrollTop, contadorTravamento: 0 };
        iniciarWatchdog();

        Estado.intervalos.scroll = setInterval(function() {
            if (!Estado.autoScrollAtivo) { pararAutoScroll(); return; }
            var el = getElementoScroll();
            if (!el) { pararAutoScroll(); return; }
            var sMax = el.scrollHeight - el.clientHeight;

            if (el.scrollTop >= sMax - 2) {
                clearInterval(Estado.intervalos.scroll);
                Estado.intervalos.scroll = null;
                setTimeout(function() {
                    if (!Estado.autoScrollAtivo) return;
                    el.scrollTop = 0;
                    Estado.watchdog.ultimaPosicao = 0;
                    Estado.watchdog.contadorTravamento = 0;
                    setTimeout(function() {
                        if (Estado.autoScrollAtivo) iniciarAutoScroll();
                    }, CONFIG.pausaAposReset);
                }, CONFIG.pausaNoFinal);
                return;
            }
            el.scrollTop += CONFIG.velocidadeScroll;
        }, CONFIG.intervaloScroll);
    }

    function pararAutoScroll() {
        if (Estado.intervalos.scroll) { clearInterval(Estado.intervalos.scroll); Estado.intervalos.scroll = null; }
        pararWatchdog();
    }

    function iniciarWatchdog() {
        pararWatchdog();
        Estado.intervalos.watchdog = setInterval(function() {
            if (!Estado.autoScrollAtivo) { pararWatchdog(); return; }
            var el = getElementoScroll();
            if (!el) return;
            var pos = el.scrollTop;
            var sMax = el.scrollHeight - el.clientHeight;
            if (pos > 5 && pos < sMax - 5 && Math.abs(pos - Estado.watchdog.ultimaPosicao) < 1 && Estado.intervalos.scroll !== null) {
                Estado.watchdog.contadorTravamento++;
                if (Estado.watchdog.contadorTravamento >= CONFIG.watchdogMaxTravamentos) {
                    pararAutoScroll();
                    setTimeout(function() { if (Estado.autoScrollAtivo) { Estado.watchdog.contadorTravamento = 0; iniciarAutoScroll(); } }, 1000);
                    return;
                }
            } else { Estado.watchdog.contadorTravamento = 0; }
            Estado.watchdog.ultimaPosicao = pos;
        }, CONFIG.watchdogInterval);
    }

    function pararWatchdog() {
        if (Estado.intervalos.watchdog) { clearInterval(Estado.intervalos.watchdog); Estado.intervalos.watchdog = null; }
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
            if (!Estado.autoScrollAtivo && Estado.pacientes.length > 0) {
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

    function configurarEventos() {
        if (DOM.btnVoltar) DOM.btnVoltar.addEventListener('click', function() { window.location.href = '/frontend/dashboard.html'; });

        if (DOM.btnRefresh) DOM.btnRefresh.addEventListener('click', function() {
            DOM.btnRefresh.classList.add('girando');
            carregarDados().finally(function() { setTimeout(function() { DOM.btnRefresh.classList.remove('girando'); }, 500); });
        });

        if (DOM.btnAutoScroll) DOM.btnAutoScroll.addEventListener('click', function() {
            Estado.autoScrollAtivo = !Estado.autoScrollAtivo;
            Estado.autoScrollIniciado = true;
            atualizarBotaoScroll();
            if (Estado.autoScrollAtivo) iniciarAutoScroll(); else pararAutoScroll();
        });

        document.addEventListener('keydown', function(e) {
            if (e.key === 'Escape' && Estado.autoScrollAtivo) { Estado.autoScrollAtivo = false; atualizarBotaoScroll(); pararAutoScroll(); }
            if (e.key === 'F5') { e.preventDefault(); carregarDados(); }
            if (e.key === ' ' && e.target === document.body) {
                e.preventDefault();
                Estado.autoScrollAtivo = !Estado.autoScrollAtivo;
                Estado.autoScrollIniciado = true;
                atualizarBotaoScroll();
                if (Estado.autoScrollAtivo) iniciarAutoScroll(); else pararAutoScroll();
            }
        });

        document.addEventListener('visibilitychange', function() {
            if (document.hidden) { if (Estado.autoScrollAtivo && Estado.intervalos.scroll) { pararAutoScroll(); Estado.autoScrollAtivo = true; } }
            else { if (Estado.autoScrollAtivo && !Estado.intervalos.scroll) iniciarAutoScroll(); carregarDados(); }
        });
    }

    function inicializar() {
        console.log('[P22] Inicializando...');
        cachearElementos();
        configurarEventos();
        carregarDados();
        Estado.intervalos.refresh = setInterval(function() { carregarDados(); }, CONFIG.intervaloRefresh);
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', inicializar);
    else inicializar();

})();