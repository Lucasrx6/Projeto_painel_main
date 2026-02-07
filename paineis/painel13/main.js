/**
 * PAINEL 13 - Prescricoes de Nutricao
 * Sistema de Paineis Hospitalares - Hospital Anchieta
 *
 * Funcionalidades:
 * - Listagem de pacientes com prescricoes de nutricao
 * - Filtro por setor com persistencia
 * - Destaque para pacientes sem prescricao
 * - Alerta para prescricoes desatualizadas (dia anterior)
 * - Auto-scroll robusto com watchdog
 */

(function() {
    'use strict';

    // =========================================================
    // CONFIGURACAO
    // =========================================================

    const CONFIG = {
        // URLs da API
        api: {
            nutricao: '/api/paineis/painel13/nutricao',
            setores: '/api/paineis/painel13/setores',
            stats: '/api/paineis/painel13/stats'
        },

        // Intervalos (ms)
        intervaloRefresh: 180000,      // 3 minutos
        velocidadeScroll: 0.6,         // pixels por tick
        intervaloScroll: 50,           // ms entre ticks
        pausaNoFinal: 8000,            // pausa ao chegar no fim
        pausaAposReset: 6000,          // pausa apos voltar ao topo
        delayAutoScrollInicial: 8000,  // delay para iniciar auto-scroll
        watchdogInterval: 3000,        // verificacao de travamento (mais frequente)
        watchdogMaxTravamentos: 3,     // tentativas antes de reiniciar

        // Limites
        maxTentativasConexao: 3,
        timeoutRequisicao: 30000,

        // Storage
        storageKeySetor: 'painel13_setor'
    };

    // =========================================================
    // ESTADO DA APLICACAO
    // =========================================================

    const Estado = {
        // Dados
        dadosNutricao: [],
        setores: [],
        setorSelecionado: '',

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
            contadorTravamento: 0,
            ultimoTimestamp: 0
        }
    };

    // =========================================================
    // ELEMENTOS DOM (Cache)
    // =========================================================

    const DOM = {};

    function cachearElementos() {
        DOM.painelMain = document.getElementById('painel-main');
        DOM.loadingContainer = document.getElementById('loading-container');
        DOM.statusIndicator = document.getElementById('status-indicator');
        DOM.ultimaAtualizacao = document.getElementById('ultima-atualizacao');
        DOM.filtroSetor = document.getElementById('filtro-setor');

        // Cards do resumo
        DOM.nomeSetor = document.getElementById('nome-setor');
        DOM.totalPacientes = document.getElementById('total-pacientes');
        DOM.comPrescricao = document.getElementById('com-prescricao');
        DOM.semPrescricao = document.getElementById('sem-prescricao');
        DOM.desatualizadas = document.getElementById('desatualizadas');

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
     * Formata nome do paciente (iniciais + ultimo nome)
     */
    function formatarNome(nomeCompleto) {
        if (!nomeCompleto || nomeCompleto.trim() === '') return '-';

        const partes = nomeCompleto.trim().toUpperCase().split(/\s+/);
        if (partes.length === 1) return partes[0];

        const iniciais = partes.slice(0, -1).map(p => p.charAt(0)).join(' ');
        const ultimoNome = partes[partes.length - 1];
        return `${iniciais} ${ultimoNome}`;
    }

    /**
     * Formata data da prescricao
     */
    function formatarDataPrescricao(dataISO) {
        if (!dataISO) return '-';

        try {
            const data = new Date(dataISO);
            return data.toLocaleString('pt-BR', {
                day: '2-digit',
                month: '2-digit',
                year: 'numeric',
                hour: '2-digit',
                minute: '2-digit'
            });
        } catch (e) {
            return dataISO;
        }
    }

    /**
     * Verifica se a prescricao eh do dia anterior
     */
    function verificarDesatualizada(dataISO) {
        if (!dataISO) return false;

        try {
            const dataPrescricao = new Date(dataISO);
            const hoje = new Date();

            // Zera as horas para comparar apenas datas
            dataPrescricao.setHours(0, 0, 0, 0);
            hoje.setHours(0, 0, 0, 0);

            const diferencaDias = Math.floor((hoje - dataPrescricao) / (1000 * 60 * 60 * 24));
            return diferencaDias >= 1;
        } catch (e) {
            return false;
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
                console.warn(`[Painel13] Tentativa ${i + 1}/${tentativas} falhou para ${url}:`, erro.message);

                if (i < tentativas - 1) {
                    await new Promise(r => setTimeout(r, 1000 * (i + 1)));
                }
            }
        }

        throw ultimoErro;
    }

    /**
     * Atualiza indicador de status
     */
    function atualizarStatus(status) {
        if (!DOM.statusIndicator) return;

        DOM.statusIndicator.className = 'status-indicator';

        switch (status) {
            case 'online':
                DOM.statusIndicator.classList.add('status-online');
                DOM.statusIndicator.title = 'Conectado';
                break;
            case 'offline':
                DOM.statusIndicator.classList.add('status-offline');
                DOM.statusIndicator.title = 'Sem conexao';
                break;
            case 'loading':
                DOM.statusIndicator.classList.add('status-loading');
                DOM.statusIndicator.title = 'Carregando...';
                break;
        }
    }

    /**
     * Atualiza horario da ultima atualizacao
     */
    function atualizarHorario() {
        if (!DOM.ultimaAtualizacao) return;

        const agora = new Date();
        DOM.ultimaAtualizacao.textContent = agora.toLocaleTimeString('pt-BR', {
            hour: '2-digit',
            minute: '2-digit'
        });

        Estado.ultimaAtualizacao = agora;
    }

    /**
     * Salva setor selecionado no localStorage
     */
    function salvarSetorSelecionado(setor) {
        try {
            localStorage.setItem(CONFIG.storageKeySetor, setor);
        } catch (e) {
            console.warn('[Painel13] Erro ao salvar setor no localStorage:', e);
        }
    }

    /**
     * Recupera setor salvo do localStorage
     */
    function recuperarSetorSelecionado() {
        try {
            return localStorage.getItem(CONFIG.storageKeySetor) || '';
        } catch (e) {
            return '';
        }
    }

    // =========================================================
    // CARREGAMENTO DE DADOS
    // =========================================================

    /**
     * Carrega lista de setores
     */
    async function carregarSetores() {
        try {
            console.log('[Painel13] Carregando setores...');

            const response = await fetchComRetry(CONFIG.api.setores);

            if (response.success && response.setores) {
                Estado.setores = response.setores;
                popularSelectSetores();
                console.log(`[Painel13] ${Estado.setores.length} setores carregados`);
            }
        } catch (erro) {
            console.error('[Painel13] Erro ao carregar setores:', erro);
        }
    }

    /**
     * Popula o select de setores
     */
    function popularSelectSetores() {
        if (!DOM.filtroSetor) return;

        DOM.filtroSetor.innerHTML = '<option value="">Todos os Setores</option>';

        Estado.setores.forEach(setor => {
            const option = document.createElement('option');
            option.value = setor.setor;
            option.textContent = setor.setor;

            if (setor.setor === Estado.setorSelecionado) {
                option.selected = true;
            }

            DOM.filtroSetor.appendChild(option);
        });
    }

    /**
     * Carrega dados de nutricao
     */
    async function carregarDados() {
        if (Estado.carregando) {
            console.log('[Painel13] Carregamento ja em andamento, ignorando...');
            return;
        }

        Estado.carregando = true;
        atualizarStatus('loading');

        // Salva estado do scroll
        const scrollEstaAtivo = Estado.autoScrollAtivo;
        if (scrollEstaAtivo) {
            pararAutoScroll();
        }

        try {
            console.log('[Painel13] Carregando dados...');

            // Monta URLs com filtro de setor
            let urlNutricao = CONFIG.api.nutricao;
            let urlStats = CONFIG.api.stats;

            if (Estado.setorSelecionado) {
                const setorParam = encodeURIComponent(Estado.setorSelecionado);
                urlNutricao += `?setor=${setorParam}`;
                urlStats += `?setor=${setorParam}`;
            }

            // Carrega dados em paralelo
            const [nutricaoResp, statsResp] = await Promise.all([
                fetchComRetry(urlNutricao),
                fetchComRetry(urlStats)
            ]);

            // Processa dados de nutricao
            if (nutricaoResp.success) {
                Estado.dadosNutricao = nutricaoResp.data || [];
                renderizarTabela();
            }

            // Atualiza dashboard
            if (statsResp.success && statsResp.stats) {
                atualizarDashboard(statsResp.stats);
            }

            atualizarHorario();
            atualizarStatus('online');
            Estado.errosConsecutivos = 0;

            console.log(`[Painel13] ${Estado.dadosNutricao.length} registros carregados`);

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
            console.error('[Painel13] Erro ao carregar dados:', erro);
            Estado.errosConsecutivos++;
            atualizarStatus('offline');

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
            if (!Estado.autoScrollAtivo && Estado.dadosNutricao.length > 0) {
                console.log('[Painel13] Iniciando auto-scroll automaticamente');
                Estado.autoScrollAtivo = true;
                Estado.autoScrollIniciado = true;
                atualizarBotaoScroll();
                iniciarAutoScroll();
            }
        }, CONFIG.delayAutoScrollInicial);
    }

    /**
     * Atualiza cards do dashboard
     */
    function atualizarDashboard(stats) {
        if (!stats) return;

        // Animacao de atualizacao
        const cards = document.querySelectorAll('.resumo-card');
        cards.forEach(card => {
            card.classList.add('atualizando');
            setTimeout(() => card.classList.remove('atualizando'), 300);
        });

        // Atualiza valores
        if (DOM.nomeSetor) {
            DOM.nomeSetor.textContent = Estado.setorSelecionado || 'Todos';
        }
        if (DOM.totalPacientes) {
            DOM.totalPacientes.textContent = formatarNumero(stats.total_pacientes);
        }
        if (DOM.comPrescricao) {
            DOM.comPrescricao.textContent = formatarNumero(stats.com_prescricao);
        }
        if (DOM.semPrescricao) {
            DOM.semPrescricao.textContent = formatarNumero(stats.sem_prescricao);
        }

        // Conta prescricoes desatualizadas
        if (DOM.desatualizadas) {
            const desatualizadas = Estado.dadosNutricao.filter(d =>
                d.dieta_limpa && verificarDesatualizada(d.dt_prescricao)
            ).length;
            DOM.desatualizadas.textContent = formatarNumero(desatualizadas);
        }
    }

    // =========================================================
    // RENDERIZACAO DA TABELA
    // =========================================================

    /**
     * Renderiza a tabela de nutricao
     */
    function renderizarTabela() {
        if (!DOM.painelMain) return;

        if (!Estado.dadosNutricao || Estado.dadosNutricao.length === 0) {
            DOM.painelMain.innerHTML = `
                <div class="mensagem-vazia">
                    <i class="fas fa-inbox"></i>
                    <h3>Nenhum registro encontrado</h3>
                    <p>Nao ha dados para o setor selecionado</p>
                </div>
            `;
            return;
        }

        // Gera linhas da tabela
        const linhasHtml = Estado.dadosNutricao.map(registro => criarLinhasPaciente(registro)).join('');

        const html = `
            <div class="tabela-container">
                <table class="tabela-nutricao">
                    <thead>
                        <tr>
                            <th class="col-leito">Leito</th>
                            <th class="col-atendimento">Atend.</th>
                            <th class="col-paciente">Paciente</th>
                            <th class="col-acompanhante">Acomp.</th>
                            <th class="col-prescritor">Prescritor</th>
                            <th class="col-medico">Medico Resp.</th>
                            <th class="col-alergia">Alergia</th>
                        </tr>
                    </thead>
                    <tbody id="tabela-body">
                        ${linhasHtml}
                    </tbody>
                </table>
            </div>
        `;

        DOM.painelMain.innerHTML = html;
    }

    /**
     * Cria linhas HTML para um paciente
     */
    function criarLinhasPaciente(registro) {
        const nomeFormatado = formatarNome(registro.nm_paciente);
        const temPrescricao = registro.dieta_limpa && registro.dieta_limpa.trim() !== '';
        const ehDesatualizada = temPrescricao && verificarDesatualizada(registro.dt_prescricao);

        // Classes da linha principal
        let classesLinha = 'linha-principal';
        if (!temPrescricao) {
            classesLinha += ' sem-prescricao';
        } else if (ehDesatualizada) {
            classesLinha += ' prescricao-desatualizada';
        }

        // Linha principal
        let html = `
            <tr class="${classesLinha}">
                <td class="col-leito">
                    <span class="leito-badge">${escapeHtml(registro.leito) || '-'}</span>
                </td>
                <td class="col-atendimento">${escapeHtml(registro.nr_atendimento) || '-'}</td>
                <td class="col-paciente">
                    <div class="paciente-info">
                        <span class="paciente-nome">${escapeHtml(nomeFormatado)}</span>
                        <span class="paciente-detalhes">${escapeHtml(registro.convenio) || '-'} | ${escapeHtml(registro.idade) || '-'}</span>
                    </div>
                </td>
                <td class="col-acompanhante texto-centro">
                    ${renderizarIconeAcompanhante(registro.acompanhante)}
                </td>
                <td class="col-prescritor">
                    ${renderizarPrescritor(registro)}
                </td>
                <td class="col-medico">${escapeHtml(registro.nm_medico) || '-'}</td>
                <td class="col-alergia texto-centro">
                    ${renderizarIconeAlergia(registro.alergia)}
                </td>
            </tr>
        `;

        // Linha de prescricao ou alerta
        if (temPrescricao) {
            const dataFormatada = formatarDataPrescricao(registro.dt_prescricao);
            const classeBadgeData = ehDesatualizada ? 'badge-data desatualizada' : 'badge-data';
            const iconeData = ehDesatualizada ? 'fa-calendar-times' : 'fa-calendar-check';

            html += `
                <tr class="linha-detalhes linha-prescricao">
                    <td colspan="7">
                        <div class="prescricao-content">
                            <span class="${classeBadgeData}">
                                <i class="fas ${iconeData}"></i>
                                ${dataFormatada}
                            </span>
                            <span class="prescricao-info">
                                <i class="fas fa-prescription-bottle-medical"></i>
                                <strong>Prescricao ${escapeHtml(registro.nr_prescricao) || '-'}:</strong>
                                ${escapeHtml(registro.dieta_limpa)}
                            </span>
                        </div>
                    </td>
                </tr>
            `;

            // Linha de observacao (se existir)
            const obsLimpa = registro.obs_limpa ? registro.obs_limpa.trim() : '';
            if (obsLimpa && obsLimpa !== '' && obsLimpa !== '-') {
                html += `
                    <tr class="linha-detalhes linha-observacao ultima-linha">
                        <td colspan="7">
                            <div class="observacao-content">
                                <i class="fas fa-comment-medical"></i>
                                <span><strong>Obs:</strong> ${escapeHtml(obsLimpa)}</span>
                            </div>
                        </td>
                    </tr>
                `;
            } else {
                // Adiciona classe ultima-linha na prescricao
                html = html.replace('linha-prescricao">', 'linha-prescricao ultima-linha">');
            }
        } else {
            // Linha de alerta - sem prescricao
            html += `
                <tr class="linha-detalhes linha-alerta ultima-linha">
                    <td colspan="7">
                        <div class="alerta-sem-prescricao">
                            <i class="fas fa-exclamation-triangle"></i>
                            <span>Paciente sem prescricao de nutricao</span>
                        </div>
                    </td>
                </tr>
            `;
        }

        return html;
    }

    /**
     * Renderiza icone de acompanhante
     */
    function renderizarIconeAcompanhante(acompanhante) {
        if (acompanhante === 'Sim') {
            return '<i class="fas fa-user-plus icone-acompanhante-sim" title="Com acompanhante"></i>';
        }
        // Sem acompanhante - retorna vazio (em branco)
        return '';
    }

    /**
     * Renderiza icone de alergia
     */
    function renderizarIconeAlergia(alergia) {
        if (alergia === 'Sim') {
            return '<i class="fas fa-allergies icone-alergia-sim" title="Paciente com alergia"></i>';
        }
        return '<span class="icone-alergia-nao" title="Sem alergia registrada">-</span>';
    }

    /**
     * Renderiza informacoes do prescritor
     */
    function renderizarPrescritor(registro) {
        if (!registro.nm_prescritor || registro.nm_prescritor.trim() === '') {
            return '<span class="texto-muted">-</span>';
        }

        let icone = '';
        let classe = '';

        if (registro.tipo_prescritor === 'Nutricionista') {
            icone = '<i class="fas fa-user-nurse" title="Nutricionista"></i>';
            classe = 'prescritor-nutricionista';
        } else if (registro.tipo_prescritor === 'Medico') {
            icone = '<i class="fas fa-user-md" title="Medico"></i>';
            classe = 'prescritor-medico';
        } else {
            icone = '<i class="fas fa-user" title="Outro"></i>';
            classe = 'prescritor-outro';
        }

        return `
            <div class="prescritor-info ${classe}">
                ${icone}
                <span>${escapeHtml(registro.nm_prescritor)}</span>
            </div>
        `;
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
        // Para qualquer scroll anterior
        pararAutoScroll();

        const elemento = getElementoScroll();
        if (!elemento) {
            console.warn('[Painel13] Elemento de scroll nao encontrado');
            return;
        }

        const scrollMax = elemento.scrollHeight - elemento.clientHeight;
        if (scrollMax <= 5) {
            console.log('[Painel13] Conteudo cabe na tela, scroll nao necessario');
            return;
        }

        console.log('[Painel13] Iniciando auto-scroll, altura total:', elemento.scrollHeight);

        // Reseta watchdog
        Estado.watchdog = {
            ultimaPosicao: elemento.scrollTop,
            contadorTravamento: 0,
            ultimoTimestamp: Date.now()
        };

        // Inicia watchdog primeiro
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
                console.log('[Painel13] Chegou ao final do scroll');

                // Para o scroll mas mantem o estado ativo
                clearInterval(Estado.intervalos.scroll);
                Estado.intervalos.scroll = null;

                // Pausa no final
                setTimeout(() => {
                    if (!Estado.autoScrollAtivo) return;

                    console.log('[Painel13] Voltando ao topo');
                    elem.scrollTop = 0;

                    // Reseta watchdog
                    Estado.watchdog.ultimaPosicao = 0;
                    Estado.watchdog.contadorTravamento = 0;

                    // Pausa no topo antes de recomecar
                    setTimeout(() => {
                        if (Estado.autoScrollAtivo) {
                            console.log('[Painel13] Reiniciando ciclo de scroll');
                            iniciarAutoScroll();
                        }
                    }, CONFIG.pausaAposReset);

                }, CONFIG.pausaNoFinal);

                return;
            }

            // Continua scrollando
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
        console.log('[Painel13] Auto-scroll parado');
    }

    /**
     * Inicia watchdog para detectar travamentos
     */
    function iniciarWatchdog() {
        pararWatchdog();

        console.log('[Painel13] Watchdog iniciado');

        Estado.intervalos.watchdog = setInterval(() => {
            if (!Estado.autoScrollAtivo) {
                pararWatchdog();
                return;
            }

            const elemento = getElementoScroll();
            if (!elemento) return;

            const posicaoAtual = elemento.scrollTop;
            const scrollMax = elemento.scrollHeight - elemento.clientHeight;
            const tempoAtual = Date.now();

            // Verifica se esta scrollando (nao esta no final e nao esta movendo)
            const estaNoMeio = posicaoAtual > 5 && posicaoAtual < scrollMax - 5;
            const naoMoveu = Math.abs(posicaoAtual - Estado.watchdog.ultimaPosicao) < 1;
            const intervaloOk = Estado.intervalos.scroll !== null;

            if (estaNoMeio && naoMoveu && intervaloOk) {
                Estado.watchdog.contadorTravamento++;
                console.warn(`[Painel13] Watchdog: possivel travamento (${Estado.watchdog.contadorTravamento}/${CONFIG.watchdogMaxTravamentos})`);

                if (Estado.watchdog.contadorTravamento >= CONFIG.watchdogMaxTravamentos) {
                    console.error('[Painel13] Watchdog: TRAVAMENTO CONFIRMADO - Reiniciando scroll');

                    // Reinicia o scroll
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
                // Scroll funcionando normalmente
                Estado.watchdog.contadorTravamento = 0;
            }

            Estado.watchdog.ultimaPosicao = posicaoAtual;
            Estado.watchdog.ultimoTimestamp = tempoAtual;

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
        // Filtro de setor
        if (DOM.filtroSetor) {
            DOM.filtroSetor.addEventListener('change', (e) => {
                Estado.setorSelecionado = e.target.value;
                salvarSetorSelecionado(Estado.setorSelecionado);

                // Cancela auto-scroll inicial se estiver agendado
                if (Estado.timeouts.autoScrollInicial) {
                    clearTimeout(Estado.timeouts.autoScrollInicial);
                    Estado.timeouts.autoScrollInicial = null;
                }

                // Recarrega dados
                carregarDados();
            });
        }

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
            // ESC - para scroll
            if (e.key === 'Escape' && Estado.autoScrollAtivo) {
                Estado.autoScrollAtivo = false;
                atualizarBotaoScroll();
                pararAutoScroll();
            }

            // F5 - refresh
            if (e.key === 'F5') {
                e.preventDefault();
                carregarDados();
            }

            // Espaco - toggle scroll
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
                // Pausa quando aba nao esta visivel
                if (Estado.autoScrollAtivo && Estado.intervalos.scroll) {
                    pararAutoScroll();
                    Estado.autoScrollAtivo = true; // Mantem estado para retomar
                }
            } else {
                // Retoma quando aba volta a ser visivel
                if (Estado.autoScrollAtivo && !Estado.intervalos.scroll) {
                    iniciarAutoScroll();
                }
                // Atualiza dados ao voltar
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
        console.log('[Painel13] Inicializando...');

        // Cache elementos DOM
        cachearElementos();

        // Recupera setor salvo
        Estado.setorSelecionado = recuperarSetorSelecionado();

        // Configura eventos
        configurarEventos();

        // Carrega setores primeiro
        await carregarSetores();

        // Carrega dados
        await carregarDados();

        // Configura refresh automatico
        Estado.intervalos.refresh = setInterval(carregarDados, CONFIG.intervaloRefresh);

        console.log('[Painel13] Inicializado com sucesso');
    }

    // Aguarda DOM estar pronto
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', inicializar);
    } else {
        inicializar();
    }

})();