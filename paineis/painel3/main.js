/**
 * PAINEL 3 - Medicos PS - Consultorios
 * Sistema de Paineis Hospitalares - Hospital Anchieta
 *
 * Funcionalidades:
 * - Listagem de medicos do Pronto Socorro
 * - Status de login (logado/deslogado)
 * - Consultorio atual
 * - Ordenacao por colunas
 * - Auto-scroll com watchdog robusto
 */

(function() {
    'use strict';

    // =========================================================
    // CONFIGURACAO
    // =========================================================

    const CONFIG = {
        // URL da API
        apiUrl: '/api/paineis/painel3/medicos',

        // Intervalos (ms)
        intervaloRefresh: 30000,       // 30 segundos
        velocidadeScroll: 0.5,         // pixels por tick
        intervaloScroll: 50,           // ms entre ticks
        pausaNoFinal: 5000,            // pausa ao chegar no fim
        pausaAposReset: 5000,          // pausa apos voltar ao topo
        delayAutoScrollInicial: 5000,  // delay para iniciar auto-scroll
        watchdogInterval: 3000,        // verificacao de travamento
        watchdogMaxTravamentos: 3,     // tentativas antes de reiniciar

        // Limites
        maxTentativasConexao: 3,
        timeoutRequisicao: 30000
    };

    // Configuracao das colunas da tabela
    const COLUNAS = [
        { campo: 'consultorio', titulo: 'Consultorio', tipo: 'texto', ordenavel: true, classe: 'col-consultorio' },
        { campo: 'ds_usuario', titulo: 'Medico', tipo: 'texto', ordenavel: true, classe: 'col-medico' },
        { campo: 'especialidade', titulo: 'Especialidade', tipo: 'badge-especialidade', ordenavel: true, classe: 'col-especialidade' },
        { campo: 'status', titulo: 'Status', tipo: 'badge-status', ordenavel: true, classe: 'col-status' },
        { campo: 'tempo_conectado', titulo: 'Login', tipo: 'hora', ordenavel: true, classe: 'col-login' }
    ];

    // =========================================================
    // ESTADO DA APLICACAO
    // =========================================================

    const Estado = {
        // Dados
        dadosMedicos: [],

        // Ordenacao
        ordenacao: {
            campo: 'consultorio',
            direcao: 'asc'
        },

        // Controle
        carregando: false,
        ultimaAtualizacao: null,
        errosConsecutivos: 0,
        autoScrollAtivo: false,
        autoScrollIniciado: false,

        // Intervalos e Timeouts
        intervalos: {
            refresh: null,
            scroll: null,
            watchdog: null
        },
        timeouts: {
            autoScrollInicial: null
        },

        // Watchdog do Scroll
        watchdog: {
            ultimaPosicao: 0,
            contadorTravamento: 0
        }
    };

    // =========================================================
    // ELEMENTOS DOM (Cache)
    // =========================================================

    const DOM = {};

    function cachearElementos() {
        DOM.painelMain = document.getElementById('painel-main');
        DOM.loadingContainer = document.getElementById('loading-container');

        // Botoes
        DOM.btnVoltar = document.getElementById('btn-voltar');
        DOM.btnRefresh = document.getElementById('btn-refresh');
        DOM.btnAutoScroll = document.getElementById('btn-auto-scroll');
    }

    // =========================================================
    // UTILITARIOS
    // =========================================================

    /**
     * Formata numero com separador de milhar
     */
    function formatarNumero(valor) {
        if (valor === null || valor === undefined || isNaN(valor)) {
            return '-';
        }
        return new Intl.NumberFormat('pt-BR').format(valor);
    }

    /**
     * Formata hora para exibicao
     */
    function formatarHora(hora) {
        if (!hora) return '-';

        try {
            const d = new Date(hora);
            if (isNaN(d.getTime())) return hora;

            return d.toLocaleTimeString('pt-BR', {
                hour: '2-digit',
                minute: '2-digit'
            });
        } catch (erro) {
            return hora;
        }
    }

    /**
     * Escapa HTML para prevenir XSS
     */
    function escapeHtml(texto) {
        if (!texto) return '-';
        const div = document.createElement('div');
        div.textContent = texto;
        return div.innerHTML;
    }

    /**
     * Faz requisicao com timeout e retry
     */
    async function fetchComRetry(url, tentativas = CONFIG.maxTentativasConexao) {
        let ultimoErro;

        for (let i = 0; i < tentativas; i++) {
            try {
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), CONFIG.timeoutRequisicao);

                const response = await fetch(url, { signal: controller.signal });
                clearTimeout(timeoutId);

                if (!response.ok) {
                    throw new Error(`HTTP ${response.status}`);
                }

                return await response.json();

            } catch (erro) {
                ultimoErro = erro;
                console.warn(`[Painel3] Tentativa ${i + 1}/${tentativas} falhou:`, erro.message);

                if (i < tentativas - 1) {
                    await new Promise(r => setTimeout(r, 1000 * (i + 1)));
                }
            }
        }

        throw ultimoErro;
    }

    // =========================================================
    // CARREGAMENTO DE DADOS
    // =========================================================

    /**
     * Carrega dados dos medicos
     */
    async function carregarDados() {
        if (Estado.carregando) {
            console.log('[Painel3] Carregamento ja em andamento, ignorando...');
            return;
        }

        Estado.carregando = true;

        // Salva estado do scroll
        const scrollEstaAtivo = Estado.autoScrollAtivo;
        if (scrollEstaAtivo) {
            pararAutoScroll();
        }

        try {
            console.log('[Painel3] Carregando dados...');

            const response = await fetchComRetry(CONFIG.apiUrl);

            if (response.success) {
                Estado.dadosMedicos = response.data || [];

                // Aplica ordenacao atual
                ordenarDados();

                // Renderiza tabela
                renderizarTabela();

                Estado.errosConsecutivos = 0;

                console.log(`[Painel3] ${Estado.dadosMedicos.length} medicos carregados`);
            } else {
                throw new Error(response.error || 'Erro ao carregar dados');
            }

            // Restaura scroll se estava ativo
            if (scrollEstaAtivo) {
                setTimeout(() => {
                    Estado.autoScrollAtivo = true;
                    atualizarBotaoScroll();
                    iniciarAutoScroll();
                }, 500);
            }

            // Inicia auto-scroll automatico na primeira carga
            if (!Estado.autoScrollIniciado && !scrollEstaAtivo) {
                agendarAutoScrollInicial();
            }

        } catch (erro) {
            console.error('[Painel3] Erro ao carregar dados:', erro);
            Estado.errosConsecutivos++;

            if (Estado.errosConsecutivos >= 3) {
                mostrarErro('Falha na conexao com o servidor. Verifique sua rede.');
            }
        } finally {
            Estado.carregando = false;
        }
    }

    /**
     * Agenda inicio automatico do auto-scroll
     */
    function agendarAutoScrollInicial() {
        if (Estado.timeouts.autoScrollInicial) {
            clearTimeout(Estado.timeouts.autoScrollInicial);
        }

        Estado.timeouts.autoScrollInicial = setTimeout(() => {
            if (!Estado.autoScrollAtivo && Estado.dadosMedicos.length > 0) {
                console.log('[Painel3] Iniciando auto-scroll automaticamente');
                Estado.autoScrollAtivo = true;
                Estado.autoScrollIniciado = true;
                atualizarBotaoScroll();
                iniciarAutoScroll();
            }
        }, CONFIG.delayAutoScrollInicial);
    }

    // =========================================================
    // ORDENACAO
    // =========================================================

    /**
     * Ordena dados pelo campo atual
     */
    function ordenarDados() {
        const { campo, direcao } = Estado.ordenacao;
        const coluna = COLUNAS.find(c => c.campo === campo);

        if (!coluna) return;

        Estado.dadosMedicos.sort((a, b) => {
            let valorA = a[campo];
            let valorB = b[campo];

            if (valorA === null || valorA === undefined) valorA = '';
            if (valorB === null || valorB === undefined) valorB = '';

            // Tratamento por tipo
            if (coluna.tipo === 'hora') {
                valorA = new Date(valorA).getTime() || 0;
                valorB = new Date(valorB).getTime() || 0;
            } else {
                valorA = String(valorA).toLowerCase();
                valorB = String(valorB).toLowerCase();
            }

            let resultado = 0;
            if (valorA < valorB) resultado = -1;
            if (valorA > valorB) resultado = 1;

            return direcao === 'asc' ? resultado : -resultado;
        });
    }

    /**
     * Altera ordenacao por coluna
     */
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
    // RENDERIZACAO DA TABELA
    // =========================================================

    /**
     * Renderiza a tabela de medicos
     */
    function renderizarTabela() {
        if (!DOM.painelMain) return;

        if (!Estado.dadosMedicos || Estado.dadosMedicos.length === 0) {
            DOM.painelMain.innerHTML = `
                <div class="mensagem-vazia">
                    <i class="fas fa-user-md"></i>
                    <h3>Nenhum medico encontrado</h3>
                    <p>Nao ha medicos registrados no momento</p>
                </div>
            `;
            return;
        }

        // Gera cabecalho
        const cabecalhoHtml = COLUNAS.map(coluna => {
            const isAtiva = Estado.ordenacao.campo === coluna.campo;
            const iconeSort = isAtiva
                ? (Estado.ordenacao.direcao === 'asc' ? 'fa-sort-up' : 'fa-sort-down')
                : 'fa-sort';
            const classeAtiva = isAtiva ? 'ativa' : '';

            if (coluna.ordenavel) {
                return `
                    <th class="${coluna.classe} ordenavel ${classeAtiva}" data-campo="${coluna.campo}">
                        <span>${coluna.titulo}</span>
                        <i class="fas ${iconeSort} icone-sort"></i>
                    </th>
                `;
            }
            return `<th class="${coluna.classe}">${coluna.titulo}</th>`;
        }).join('');

        // Gera linhas
        const linhasHtml = Estado.dadosMedicos.map(medico => criarLinhaMedico(medico)).join('');

        const html = `
            <div class="tabela-container">
                <table class="tabela-medicos">
                    <thead>
                        <tr>${cabecalhoHtml}</tr>
                    </thead>
                    <tbody id="tabela-body">
                        ${linhasHtml}
                    </tbody>
                </table>
            </div>
        `;

        DOM.painelMain.innerHTML = html;

        // Adiciona eventos de ordenacao
        document.querySelectorAll('th.ordenavel').forEach(th => {
            th.addEventListener('click', () => {
                alterarOrdenacao(th.dataset.campo);
            });
        });
    }

    /**
     * Cria linha HTML para um medico
     */
    function criarLinhaMedico(medico) {
        const status = String(medico.status || '').toUpperCase();
        const isLogado = status === 'LOGADO';
        const classeStatus = isLogado ? 'linha-logado' : 'linha-deslogado';

        const celulas = COLUNAS.map(coluna => {
            const valor = medico[coluna.campo];
            const conteudo = formatarCelula(valor, coluna.tipo);
            return `<td class="${coluna.classe}">${conteudo}</td>`;
        }).join('');

        return `<tr class="${classeStatus}">${celulas}</tr>`;
    }

    /**
     * Formata conteudo da celula
     */
    function formatarCelula(valor, tipo) {
        if (valor === null || valor === undefined || valor === '') {
            return '<span class="texto-muted">-</span>';
        }

        switch (tipo) {
            case 'hora':
                return formatarHora(valor);

            case 'badge-status':
                const statusUpper = String(valor).toUpperCase();
                if (statusUpper === 'LOGADO') {
                    return '<span class="badge badge-logado"><i class="fas fa-circle"></i> Logado</span>';
                } else {
                    return '<span class="badge badge-deslogado"><i class="fas fa-circle"></i> Deslogado</span>';
                }

            case 'badge-especialidade':
                return `<span class="badge badge-especialidade">${escapeHtml(valor)}</span>`;

            default:
                return escapeHtml(valor);
        }
    }

    /**
     * Mostra mensagem de erro
     */
    function mostrarErro(mensagem) {
        if (!DOM.painelMain) return;

        DOM.painelMain.innerHTML = `
            <div class="mensagem-erro">
                <i class="fas fa-exclamation-triangle"></i>
                <h3>Erro ao Carregar Dados</h3>
                <p>${escapeHtml(mensagem)}</p>
                <button class="btn-tentar-novamente" onclick="location.reload()">
                    <i class="fas fa-sync-alt"></i> Tentar Novamente
                </button>
            </div>
        `;
    }

    // =========================================================
    // AUTO-SCROLL COM WATCHDOG ROBUSTO
    // =========================================================

    /**
     * Obtem o elemento de scroll (tbody da tabela)
     */
    function getElementoScroll() {
        return document.getElementById('tabela-body');
    }

    /**
     * Inicia o auto-scroll
     */
    function iniciarAutoScroll() {
        pararAutoScroll();

        const elemento = getElementoScroll();
        if (!elemento) {
            console.warn('[Painel3] Elemento de scroll nao encontrado');
            return;
        }

        const scrollMax = elemento.scrollHeight - elemento.clientHeight;
        if (scrollMax <= 5) {
            console.log('[Painel3] Conteudo cabe na tela, scroll nao necessario');
            return;
        }

        console.log('[Painel3] Iniciando auto-scroll');

        // Reseta watchdog
        Estado.watchdog = {
            ultimaPosicao: elemento.scrollTop,
            contadorTravamento: 0
        };

        // Inicia watchdog
        iniciarWatchdog();

        // Inicia scroll
        Estado.intervalos.scroll = setInterval(() => {
            if (!Estado.autoScrollAtivo) {
                pararAutoScroll();
                return;
            }

            const elem = getElementoScroll();
            if (!elem) {
                pararAutoScroll();
                return;
            }

            const scrollAtual = elem.scrollTop;
            const scrollMax = elem.scrollHeight - elem.clientHeight;

            // Chegou ao final
            if (scrollAtual >= scrollMax - 2) {
                console.log('[Painel3] Chegou ao final do scroll');

                clearInterval(Estado.intervalos.scroll);
                Estado.intervalos.scroll = null;

                setTimeout(() => {
                    if (!Estado.autoScrollAtivo) return;

                    console.log('[Painel3] Voltando ao topo');
                    elem.scrollTop = 0;

                    Estado.watchdog.ultimaPosicao = 0;
                    Estado.watchdog.contadorTravamento = 0;

                    setTimeout(() => {
                        if (Estado.autoScrollAtivo) {
                            console.log('[Painel3] Reiniciando ciclo de scroll');
                            iniciarAutoScroll();
                        }
                    }, CONFIG.pausaAposReset);

                }, CONFIG.pausaNoFinal);

                return;
            }

            elem.scrollTop += CONFIG.velocidadeScroll;

        }, CONFIG.intervaloScroll);
    }

    /**
     * Para o auto-scroll
     */
    function pararAutoScroll() {
        if (Estado.intervalos.scroll) {
            clearInterval(Estado.intervalos.scroll);
            Estado.intervalos.scroll = null;
        }
        pararWatchdog();
        console.log('[Painel3] Auto-scroll parado');
    }

    /**
     * Inicia watchdog para detectar travamentos
     */
    function iniciarWatchdog() {
        pararWatchdog();

        console.log('[Painel3] Watchdog iniciado');

        Estado.intervalos.watchdog = setInterval(() => {
            if (!Estado.autoScrollAtivo) {
                pararWatchdog();
                return;
            }

            const elemento = getElementoScroll();
            if (!elemento) return;

            const posicaoAtual = elemento.scrollTop;
            const scrollMax = elemento.scrollHeight - elemento.clientHeight;

            const estaNoMeio = posicaoAtual > 5 && posicaoAtual < scrollMax - 5;
            const naoMoveu = Math.abs(posicaoAtual - Estado.watchdog.ultimaPosicao) < 1;
            const intervaloOk = Estado.intervalos.scroll !== null;

            if (estaNoMeio && naoMoveu && intervaloOk) {
                Estado.watchdog.contadorTravamento++;
                console.warn(`[Painel3] Watchdog: possivel travamento (${Estado.watchdog.contadorTravamento}/${CONFIG.watchdogMaxTravamentos})`);

                if (Estado.watchdog.contadorTravamento >= CONFIG.watchdogMaxTravamentos) {
                    console.error('[Painel3] Watchdog: TRAVAMENTO CONFIRMADO - Reiniciando scroll');

                    pararAutoScroll();

                    setTimeout(() => {
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

            Estado.watchdog.ultimaPosicao = posicaoAtual;

        }, CONFIG.watchdogInterval);
    }

    /**
     * Para watchdog
     */
    function pararWatchdog() {
        if (Estado.intervalos.watchdog) {
            clearInterval(Estado.intervalos.watchdog);
            Estado.intervalos.watchdog = null;
        }
    }

    /**
     * Atualiza estado visual do botao de scroll
     */
    function atualizarBotaoScroll() {
        if (!DOM.btnAutoScroll) return;

        if (Estado.autoScrollAtivo) {
            DOM.btnAutoScroll.classList.add('ativo');
            DOM.btnAutoScroll.innerHTML = '<i class="fas fa-pause"></i><span class="btn-text">Pausar</span>';
            DOM.btnAutoScroll.title = 'Pausar rolagem automatica';
        } else {
            DOM.btnAutoScroll.classList.remove('ativo');
            DOM.btnAutoScroll.innerHTML = '<i class="fas fa-play"></i><span class="btn-text">Auto Scroll</span>';
            DOM.btnAutoScroll.title = 'Ativar rolagem automatica';
        }
    }

    // =========================================================
    // EVENT HANDLERS
    // =========================================================

    /**
     * Configura todos os event listeners
     */
    function configurarEventos() {
        // Botao voltar
        if (DOM.btnVoltar) {
            DOM.btnVoltar.addEventListener('click', () => {
                window.location.href = '/frontend/dashboard.html';
            });
        }

        // Botao refresh
        if (DOM.btnRefresh) {
            DOM.btnRefresh.addEventListener('click', () => {
                DOM.btnRefresh.classList.add('girando');
                carregarDados().finally(() => {
                    setTimeout(() => {
                        DOM.btnRefresh.classList.remove('girando');
                    }, 500);
                });
            });
        }

        // Botao auto scroll
        if (DOM.btnAutoScroll) {
            DOM.btnAutoScroll.addEventListener('click', () => {
                Estado.autoScrollAtivo = !Estado.autoScrollAtivo;
                Estado.autoScrollIniciado = true;
                atualizarBotaoScroll();

                if (Estado.autoScrollAtivo) {
                    iniciarAutoScroll();
                } else {
                    pararAutoScroll();
                }
            });
        }

        // Teclas de atalho
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && Estado.autoScrollAtivo) {
                Estado.autoScrollAtivo = false;
                atualizarBotaoScroll();
                pararAutoScroll();
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
                if (Estado.autoScrollAtivo) {
                    iniciarAutoScroll();
                } else {
                    pararAutoScroll();
                }
            }
        });

        // Visibilidade da pagina
        document.addEventListener('visibilitychange', () => {
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
    // INICIALIZACAO
    // =========================================================

    /**
     * Inicializa o painel
     */
    async function inicializar() {
        console.log('[Painel3] Inicializando...');

        // Cache elementos DOM
        cachearElementos();

        // Configura eventos
        configurarEventos();

        // Carrega dados
        await carregarDados();

        // Configura refresh automatico
        Estado.intervalos.refresh = setInterval(carregarDados, CONFIG.intervaloRefresh);

        console.log('[Painel3] Inicializado com sucesso');
    }

    // Aguarda DOM estar pronto
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', inicializar);
    } else {
        inicializar();
    }

})();