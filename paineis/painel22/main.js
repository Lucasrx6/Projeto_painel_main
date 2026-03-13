/**
 * PAINEL 22 - Acompanhamento de Exames PS
 *
 * Colunas: Atend. | Paciente (nome+idade+convênio) | Tempo PS | Lab | Radio
 * Ícones: Vermelho (pendente), Amarelo (andamento), Verde (concluído)
 * Sem nomes de exames — apenas quantidades por status/tipo
 */

(function() {
    'use strict';

    var CONFIG = {
        api: {
            dashboard: '/api/paineis/painel22/dashboard',
            dados: '/api/paineis/painel22/dados'
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
        DOM.totalPacientes = document.getElementById('total-pacientes');
        DOM.totalPendentes = document.getElementById('total-pendentes');
        DOM.totalAndamento = document.getElementById('total-andamento');
        DOM.totalConcluidos = document.getElementById('total-concluidos');
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
        if (partes.length === 1) return partes[0];
        var iniciais = [];
        for (var i = 0; i < partes.length - 1; i++) {
            iniciais.push(partes[i].charAt(0));
        }
        return iniciais.join(' ') + ' ' + partes[partes.length - 1];
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
        if (horas >= 8) return 'tempo-critico';
        if (horas >= 4) return 'tempo-alerta';
        return 'tempo-normal';
    }

    function formatarNumero(val) {
        if (val === null || val === undefined || isNaN(val)) return '-';
        return new Intl.NumberFormat('pt-BR').format(val);
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

    function contarStatusExames(exames) {
        var result = { pendentes: 0, andamento: 0, concluidos: 0 };
        if (!exames) return result;
        for (var i = 0; i < exames.length; i++) {
            var s = exames[i].status_exame || '';
            if (s === 'LAUDADO' || s === 'LIBERADO') {
                result.concluidos++;
            } else if (s === 'EXECUTADO' || s === 'COLETADO' || s === 'EM_ANALISE' || s === 'RESULTADO_PARCIAL') {
                result.andamento++;
            } else {
                result.pendentes++;
            }
        }
        return result;
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

        return Promise.all([
            fetchComRetry(CONFIG.api.dashboard),
            fetchComRetry(CONFIG.api.dados)
        ]).then(function(results) {
            var dashResp = results[0];
            var dadosResp = results[1];

            if (dashResp.success && dashResp.data) atualizarDashboard(dashResp.data);

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

        }).catch(function(err) {
            console.error('[P22] Erro:', err);
            Estado.errosConsecutivos++;
            atualizarStatus('offline');
            if (Estado.errosConsecutivos >= 3) mostrarErro('Falha na conexão.');
        }).finally(function() {
            Estado.carregando = false;
        });
    }

    function atualizarDashboard(dados) {
        var cards = document.querySelectorAll('.resumo-card');
        for (var i = 0; i < cards.length; i++) {
            cards[i].classList.add('atualizando');
            (function(c) { setTimeout(function() { c.classList.remove('atualizando'); }, 300); })(cards[i]);
        }
        DOM.totalPacientes.textContent = formatarNumero(dados.total_pacientes);
        DOM.totalPendentes.textContent = formatarNumero(dados.qt_pendentes);
        DOM.totalAndamento.textContent = formatarNumero(dados.qt_em_andamento);
        DOM.totalConcluidos.textContent = formatarNumero(dados.qt_concluidos);
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
                '<p>Todos os pacientes do PS estão com exames concluídos</p>' +
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
            '<th class="col-tempo-ps"><i class="fas fa-clock"></i> Tempo PS</th>' +
            '<th class="col-lab"><i class="fas fa-flask"></i> Lab</th>' +
            '<th class="col-radio"><i class="fas fa-x-ray"></i> Radio</th>' +
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
        if (todosConcluidos) {
            classeLinha = 'linha-concluida';
        } else if (pac.qt_pendentes > 0) {
            classeLinha = 'linha-pendente';
        } else {
            classeLinha = 'linha-andamento';
        }

        var statusLab = contarStatusExames(pac.exames_lab);
        var statusRadio = contarStatusExames(pac.exames_radio);

        var horasPS = pac.horas_no_ps;
        var classeTempoPS = classeTempo(horasPS);

        var html = '<tr class="' + classeLinha + '">';

        // Atendimento
        html += '<td class="col-atendimento"><span class="atendimento-valor">' + escapeHtml(pac.nr_atendimento) + '</span></td>';

        // Paciente (nome + idade + convênio agrupados)
        html += '<td class="col-paciente"><div class="paciente-grupo">';
        html += '<span class="paciente-nome" title="' + escapeHtml(pac.nm_pessoa_fisica) + '">' + escapeHtml(nomeFormatado) + '</span>';
        html += '<div class="paciente-subinfo">';
        if (pac.idade !== null && pac.idade !== undefined) {
            html += '<span><i class="fas fa-user"></i> ' + pac.idade + ' anos</span>';
        }
        if (pac.ds_convenio) {
            html += '<span><i class="fas fa-id-card"></i> ' + escapeHtml(pac.ds_convenio) + '</span>';
        }
        html += '</div></div></td>';

        // Tempo PS
        html += '<td class="col-tempo-ps">';
        if (horasPS !== null && horasPS !== undefined) {
            html += '<span class="tempo-ps-badge ' + classeTempoPS + '">' + formatarTempo(horasPS) + '</span>';
        } else {
            html += '-';
        }
        html += '</td>';

        // Laboratório
        html += '<td class="col-lab">' + renderStatusDots(statusLab, pac.exames_lab ? pac.exames_lab.length : 0) + '</td>';

        // Radiologia
        html += '<td class="col-radio">' + renderStatusDots(statusRadio, pac.exames_radio ? pac.exames_radio.length : 0) + '</td>';

        html += '</tr>';
        return html;
    }

    function renderStatusDots(status, total) {
        if (total === 0) {
            return '<span class="status-sem-exame">-</span>';
        }

        var html = '<div class="status-exame-cell">';

        if (status.pendentes > 0) {
            html += '<span class="status-dot dot-pendente" title="Aguardando: ' + status.pendentes + '">' + status.pendentes + '</span>';
        }
        if (status.andamento > 0) {
            html += '<span class="status-dot dot-andamento" title="Em andamento: ' + status.andamento + '">' + status.andamento + '</span>';
        }
        if (status.concluidos > 0) {
            html += '<span class="status-dot dot-concluido" title="Concluído: ' + status.concluidos + '">' + status.concluidos + '</span>';
        }

        html += '</div>';
        return html;
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

    function getElementoScroll() {
        return document.getElementById('tabela-body');
    }

    function iniciarAutoScroll() {
        pararAutoScroll();
        var elem = getElementoScroll();
        if (!elem) return;

        var scrollMax = elem.scrollHeight - elem.clientHeight;
        if (scrollMax <= 5) return;

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
            var el = getElementoScroll();
            if (!el) return;

            var pos = el.scrollTop;
            var sMax = el.scrollHeight - el.clientHeight;
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
        if (DOM.btnVoltar) {
            DOM.btnVoltar.addEventListener('click', function() {
                window.location.href = '/frontend/dashboard.html';
            });
        }

        if (DOM.btnRefresh) {
            DOM.btnRefresh.addEventListener('click', function() {
                DOM.btnRefresh.classList.add('girando');
                carregarDados().finally(function() {
                    setTimeout(function() { DOM.btnRefresh.classList.remove('girando'); }, 500);
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

        document.addEventListener('keydown', function(e) {
            if (e.key === 'Escape' && Estado.autoScrollAtivo) {
                Estado.autoScrollAtivo = false;
                atualizarBotaoScroll();
                pararAutoScroll();
            }
            if (e.key === 'F5') { e.preventDefault(); carregarDados(); }
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
                if (Estado.autoScrollAtivo && !Estado.intervalos.scroll) iniciarAutoScroll();
                carregarDados();
            }
        });
    }

    // =========================================================
    // INICIALIZAÇÃO
    // =========================================================

    function inicializar() {
        console.log('[P22] Inicializando Painel Acompanhamento Exames PS...');
        cachearElementos();
        configurarEventos();
        carregarDados();
        Estado.intervalos.refresh = setInterval(function() { carregarDados(); }, CONFIG.intervaloRefresh);
        console.log('[P22] Painel inicializado');
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', inicializar);
    } else {
        inicializar();
    }

})();