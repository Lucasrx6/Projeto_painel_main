/**
 * PAINEL 10 - Analise Pronto Socorro
 * Sistema de Paineis Hospitalares - Hospital Anchieta
 *
 * Funcionalidades:
 * - Dashboard com metricas em tempo real
 * - Analise por clinica, medico e recepcao
 * - Grafico de atendimentos por hora
 * - Auto-scroll para monitores
 */

(function() {
    'use strict';

    // =========================================================
    // CONFIGURACAO
    // =========================================================

    const CONFIG = {
        // URLs da API
        api: {
            dashboard: '/api/paineis/painel10/dashboard',
            tempoClinica: '/api/paineis/painel10/tempo-clinica',
            aguardandoClinica: '/api/paineis/painel10/aguardando-clinica',
            atendimentosHora: '/api/paineis/painel10/atendimentos-hora',
            desempenhoMedico: '/api/paineis/painel10/desempenho-medico',
            desempenhoRecepcao: '/api/paineis/painel10/desempenho-recepcao'
        },

        // Intervalos (ms)
        intervaloRefresh: 60000,      // 1 minuto
        velocidadeScroll: 0.5,        // pixels por tick
        intervaloScroll: 50,          // ms entre ticks
        pausaNoFinal: 8000,           // pausa ao chegar no fim
        pausaAposReset: 5000,         // pausa apos voltar ao topo
        watchdogInterval: 5000,       // verificacao de travamento

        // Limites
        maxTentativasConexao: 3,
        timeoutRequisicao: 30000,

        // Thresholds de tempo (minutos)
        tempoEspera: {
            bom: 30,
            medio: 60
        },
        tempoAtendimento: {
            bom: 15,
            medio: 30
        }
    };

    // =========================================================
    // ESTADO DA APLICACAO
    // =========================================================

    const Estado = {
        autoScrollAtivo: false,
        carregando: false,
        ultimaAtualizacao: null,
        errosConsecutivos: 0,

        // Intervalos
        intervalos: {
            refresh: null,
            scroll: null,
            watchdog: null
        },

        // Scroll
        scroll: {
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
        DOM.statusIndicator = document.getElementById('status-indicator');
        DOM.ultimaAtualizacao = document.getElementById('ultima-atualizacao');

        // Cards do resumo
        DOM.totalDia = document.getElementById('total-dia');
        DOM.totalRealizados = document.getElementById('total-realizados');
        DOM.totalAguardando = document.getElementById('total-aguardando');
        DOM.totalAlta = document.getElementById('total-alta');
        DOM.tempoMedioEspera = document.getElementById('tempo-medio-espera');
        DOM.tempoMedioPermanencia = document.getElementById('tempo-medio-permanencia');

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
     * Formata tempo em minutos para exibicao
     */
    function formatarTempo(minutos) {
        if (minutos === null || minutos === undefined || isNaN(minutos)) {
            return '-';
        }

        const min = Math.round(minutos);

        if (min < 60) {
            return `${min}`;
        }

        const horas = Math.floor(min / 60);
        const mins = min % 60;
        return `${horas}h${mins.toString().padStart(2, '0')}`;
    }

    /**
     * Retorna classe CSS baseada no tempo de espera
     */
    function getClasseTempo(minutos, tipo = 'espera') {
        const limites = tipo === 'atendimento' ? CONFIG.tempoAtendimento : CONFIG.tempoEspera;

        if (minutos < limites.bom) {
            return 'tempo-bom';
        } else if (minutos < limites.medio) {
            return 'tempo-medio';
        }
        return 'tempo-critico';
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
                console.warn(`[Painel10] Tentativa ${i + 1}/${tentativas} falhou para ${url}:`, erro.message);

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

    // =========================================================
    // CARREGAMENTO DE DADOS
    // =========================================================

    /**
     * Carrega todos os dados do painel
     */
    async function carregarDados() {
        if (Estado.carregando) {
            console.log('[Painel10] Carregamento ja em andamento, ignorando...');
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
            console.log('[Painel10] Carregando dados...');

            // Carrega todos os endpoints em paralelo
            const [
                dashboardResp,
                tempoClinicaResp,
                aguardandoResp,
                horaResp,
                medicoResp,
                recepcaoResp
            ] = await Promise.all([
                fetchComRetry(CONFIG.api.dashboard),
                fetchComRetry(CONFIG.api.tempoClinica),
                fetchComRetry(CONFIG.api.aguardandoClinica),
                fetchComRetry(CONFIG.api.atendimentosHora),
                fetchComRetry(CONFIG.api.desempenhoMedico),
                fetchComRetry(CONFIG.api.desempenhoRecepcao)
            ]);

            // Atualiza dashboard
            if (dashboardResp.success && dashboardResp.data) {
                atualizarDashboard(dashboardResp.data);
            }

            // Renderiza conteudo principal
            renderizarConteudo({
                recepcao: recepcaoResp.data || {},
                tempoClinica: tempoClinicaResp.data || [],
                aguardando: aguardandoResp.data || [],
                porHora: horaResp.data || [],
                medicos: medicoResp.data || []
            });

            atualizarHorario();
            atualizarStatus('online');
            Estado.errosConsecutivos = 0;

            console.log('[Painel10] Dados carregados com sucesso');

        } catch (erro) {
            console.error('[Painel10] Erro ao carregar dados:', erro);
            Estado.errosConsecutivos++;
            atualizarStatus('offline');

            if (Estado.errosConsecutivos >= 3) {
                mostrarErro('Falha na conexao com o servidor. Verifique sua rede.');
            }
        } finally {
            Estado.carregando = false;

            // Restaura scroll se estava ativo
            if (scrollEstaAtivo) {
                setTimeout(() => {
                    Estado.autoScrollAtivo = true;
                    atualizarBotaoScroll();
                    iniciarAutoScroll();
                }, 500);
            }
        }
    }

    /**
     * Atualiza cards do dashboard
     */
    function atualizarDashboard(dados) {
        if (!dados) return;

        // Animacao de atualizacao
        const cards = document.querySelectorAll('.resumo-card');
        cards.forEach(card => {
            card.classList.add('atualizando');
            setTimeout(() => card.classList.remove('atualizando'), 300);
        });

        // Atualiza valores
        if (DOM.totalDia) {
            DOM.totalDia.textContent = formatarNumero(dados.total_atendimentos_dia);
        }
        if (DOM.totalRealizados) {
            DOM.totalRealizados.textContent = formatarNumero(dados.atendimentos_realizados);
        }
        if (DOM.totalAguardando) {
            DOM.totalAguardando.textContent = formatarNumero(dados.aguardando_atendimento);
        }
        if (DOM.totalAlta) {
            DOM.totalAlta.textContent = formatarNumero(dados.pacientes_alta);
        }
        if (DOM.tempoMedioEspera) {
            const tempo = dados.tempo_medio_espera_consulta_min || 0;
            DOM.tempoMedioEspera.textContent = formatarTempo(tempo);
            DOM.tempoMedioEspera.parentElement.parentElement.className =
                `resumo-card card-tempo-espera ${getClasseTempo(tempo)}`;
        }
        if (DOM.tempoMedioPermanencia) {
            DOM.tempoMedioPermanencia.textContent = formatarTempo(dados.tempo_medio_permanencia_min);
        }
    }

    // =========================================================
    // RENDERIZACAO DO CONTEUDO
    // =========================================================

    /**
     * Renderiza todo o conteudo principal
     */
    function renderizarConteudo(dados) {
        if (!DOM.painelMain) return;

        let html = '<div class="content-scroll" id="content-scroll">';

        // Ordem das secoes
        html += renderizarSecaoRecepcao(dados.recepcao);
        html += renderizarSecaoTempoClinica(dados.tempoClinica);
        html += renderizarSecaoAguardando(dados.aguardando);
        html += renderizarSecaoGrafico(dados.porHora);
        html += renderizarSecaoMedicos(dados.medicos);

        html += '</div>';

        DOM.painelMain.innerHTML = html;
    }

    /**
     * Secao: Desempenho da Recepcao
     */
    function renderizarSecaoRecepcao(dados) {
        if (!dados) dados = {};

        const totalRecebidos = dados.total_recebidos || 0;
        const tempoMedio = dados.tempo_medio_recepcao_min || 0;
        const aguardando = dados.aguardando_recepcao || 0;

        return `
            <section class="secao-analise" aria-label="Desempenho da Recepcao">
                <header class="secao-header">
                    <div class="secao-titulo">
                        <i class="fas fa-desktop" aria-hidden="true"></i>
                        <h2>Desempenho da Recepcao</h2>
                    </div>
                </header>
                <div class="secao-content">
                    <div class="metricas-grid metricas-3">
                        <div class="metrica-card">
                            <div class="metrica-icone icone-azul">
                                <i class="fas fa-users"></i>
                            </div>
                            <div class="metrica-info">
                                <span class="metrica-valor">${formatarNumero(totalRecebidos)}</span>
                                <span class="metrica-label">Total Recebidos</span>
                            </div>
                        </div>
                        <div class="metrica-card">
                            <div class="metrica-icone icone-roxo">
                                <i class="fas fa-stopwatch"></i>
                            </div>
                            <div class="metrica-info">
                                <span class="metrica-valor">${formatarTempo(tempoMedio)} <small>min</small></span>
                                <span class="metrica-label">Tempo Medio</span>
                            </div>
                        </div>
                        <div class="metrica-card">
                            <div class="metrica-icone icone-laranja">
                                <i class="fas fa-user-clock"></i>
                            </div>
                            <div class="metrica-info">
                                <span class="metrica-valor">${formatarNumero(aguardando)}</span>
                                <span class="metrica-label">Aguardando</span>
                            </div>
                        </div>
                    </div>
                </div>
            </section>
        `;
    }

    /**
     * Secao: Tempo por Clinica
     */
    function renderizarSecaoTempoClinica(dados) {
        if (!dados || dados.length === 0) {
            return renderizarSecaoVazia(
                'Tempo Medio por Clinica',
                'fas fa-clinic-medical',
                'Nenhum atendimento registrado hoje'
            );
        }

        let linhasHtml = '';
        dados.forEach(row => {
            const tempo = row.tempo_medio_espera_min || 0;
            const classeTempo = getClasseTempo(tempo);

            linhasHtml += `
                <tr>
                    <td>
                        <div class="clinica-info">
                            <span class="clinica-nome">${escapeHtml(row.ds_clinica)}</span>
                        </div>
                    </td>
                    <td class="texto-centro">${formatarNumero(row.total_atendimentos)}</td>
                    <td class="texto-centro">${formatarNumero(row.atendimentos_realizados)}</td>
                    <td class="texto-centro">
                        <span class="badge badge-aguardando">${formatarNumero(row.aguardando_atendimento)}</span>
                    </td>
                    <td class="texto-centro">
                        <span class="badge badge-tempo ${classeTempo}">${tempo} min</span>
                    </td>
                </tr>
            `;
        });

        return `
            <section class="secao-analise" aria-label="Tempo por Clinica">
                <header class="secao-header">
                    <div class="secao-titulo">
                        <i class="fas fa-clinic-medical" aria-hidden="true"></i>
                        <h2>Tempo Medio por Clinica</h2>
                    </div>
                    <span class="secao-contador">${dados.length} clinica(s)</span>
                </header>
                <div class="secao-content">
                    <div class="tabela-container">
                        <table class="tabela-dados">
                            <thead>
                                <tr>
                                    <th>Clinica</th>
                                    <th class="texto-centro">Total</th>
                                    <th class="texto-centro">Realizados</th>
                                    <th class="texto-centro">Aguardando</th>
                                    <th class="texto-centro">Tempo Medio</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${linhasHtml}
                            </tbody>
                        </table>
                    </div>
                </div>
            </section>
        `;
    }

    /**
     * Secao: Pacientes Aguardando
     */
    function renderizarSecaoAguardando(dados) {
        if (!dados || dados.length === 0) {
            return `
                <section class="secao-analise secao-sucesso" aria-label="Pacientes Aguardando">
                    <header class="secao-header">
                        <div class="secao-titulo">
                            <i class="fas fa-user-clock" aria-hidden="true"></i>
                            <h2>Pacientes Aguardando</h2>
                        </div>
                    </header>
                    <div class="secao-content">
                        <div class="mensagem-sucesso">
                            <i class="fas fa-check-circle"></i>
                            <p>Nenhum paciente aguardando atendimento</p>
                        </div>
                    </div>
                </section>
            `;
        }

        let linhasHtml = '';
        dados.forEach(row => {
            const tempoMedio = row.tempo_espera_atual_min || 0;
            const tempoMax = row.tempo_max_espera_min || 0;

            linhasHtml += `
                <tr>
                    <td>
                        <span class="clinica-nome">${escapeHtml(row.ds_clinica)}</span>
                    </td>
                    <td class="texto-centro">
                        <span class="badge badge-aguardando-grande">${formatarNumero(row.total_aguardando)}</span>
                    </td>
                    <td class="texto-centro">${tempoMedio} min</td>
                    <td class="texto-centro">
                        <span class="badge badge-tempo tempo-critico">${tempoMax} min</span>
                    </td>
                </tr>
            `;
        });

        const totalAguardando = dados.reduce((acc, row) => acc + (row.total_aguardando || 0), 0);

        return `
            <section class="secao-analise" aria-label="Pacientes Aguardando">
                <header class="secao-header">
                    <div class="secao-titulo">
                        <i class="fas fa-user-clock" aria-hidden="true"></i>
                        <h2>Pacientes Aguardando</h2>
                    </div>
                    <span class="secao-contador secao-contador-alerta">${totalAguardando} paciente(s)</span>
                </header>
                <div class="secao-content">
                    <div class="tabela-container">
                        <table class="tabela-dados">
                            <thead>
                                <tr>
                                    <th>Clinica</th>
                                    <th class="texto-centro">Aguardando</th>
                                    <th class="texto-centro">Tempo Medio</th>
                                    <th class="texto-centro">Tempo Maximo</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${linhasHtml}
                            </tbody>
                        </table>
                    </div>
                </div>
            </section>
        `;
    }

    /**
     * Secao: Grafico de Atendimentos por Hora
     */
    function renderizarSecaoGrafico(dados) {
        if (!dados || dados.length === 0) {
            return renderizarSecaoVazia(
                'Atendimentos por Hora',
                'fas fa-chart-bar',
                'Nenhum dado disponivel para o grafico'
            );
        }

        const maxValor = Math.max(...dados.map(d => d.total_atendimentos || 0), 1);
        const totalDia = dados.reduce((acc, d) => acc + (d.total_atendimentos || 0), 0);

        let barrasHtml = '';
        dados.forEach(row => {
            const hora = row.hora;
            const total = row.total_atendimentos || 0;

            // Calcula altura proporcional (minimo 4% se tiver valor)
            let altura = 0;
            if (total > 0) {
                altura = Math.max((total / maxValor) * 100, 4);
            }

            // Destaca hora atual
            const horaAtual = new Date().getHours();
            const isHoraAtual = parseInt(hora) === horaAtual;

            barrasHtml += `
                <div class="grafico-barra ${isHoraAtual ? 'barra-atual' : ''}">
                    <div class="barra-container">
                        <span class="barra-valor">${total}</span>
                        <div class="barra-preenchimento" style="height: ${altura}%;" title="${total} atendimentos"></div>
                    </div>
                    <span class="barra-label">${hora}h</span>
                </div>
            `;
        });

        return `
            <section class="secao-analise" aria-label="Atendimentos por Hora">
                <header class="secao-header">
                    <div class="secao-titulo">
                        <i class="fas fa-chart-bar" aria-hidden="true"></i>
                        <h2>Atendimentos por Hora</h2>
                    </div>
                    <span class="secao-contador">${totalDia} total</span>
                </header>
                <div class="secao-content">
                    <div class="grafico-container">
                        <div class="grafico-barras">
                            ${barrasHtml}
                        </div>
                    </div>
                </div>
            </section>
        `;
    }

    /**
     * Secao: Desempenho dos Medicos
     */
    function renderizarSecaoMedicos(dados) {
        if (!dados || dados.length === 0) {
            return renderizarSecaoVazia(
                'Desempenho por Medico',
                'fas fa-user-md',
                'Nenhum medico com atendimento registrado hoje'
            );
        }

        let linhasHtml = '';
        dados.forEach(row => {
            const tempo = row.tempo_medio_atendimento_min || 0;
            const classeTempo = getClasseTempo(tempo, 'atendimento');

            linhasHtml += `
                <tr>
                    <td class="texto-centro texto-muted">${escapeHtml(row.cd_medico_resp)}</td>
                    <td>
                        <span class="medico-nome">${escapeHtml(row.nm_guerra)}</span>
                    </td>
                    <td class="texto-centro">${formatarNumero(row.total_atendimentos)}</td>
                    <td class="texto-centro">
                        <span class="badge badge-tempo ${classeTempo}">${tempo} min</span>
                    </td>
                    <td class="texto-centro">
                        <span class="badge badge-sucesso">${formatarNumero(row.pacientes_finalizados)}</span>
                    </td>
                </tr>
            `;
        });

        return `
            <section class="secao-analise" aria-label="Desempenho por Medico">
                <header class="secao-header">
                    <div class="secao-titulo">
                        <i class="fas fa-user-md" aria-hidden="true"></i>
                        <h2>Desempenho por Medico</h2>
                    </div>
                    <span class="secao-contador">${dados.length} medico(s)</span>
                </header>
                <div class="secao-content">
                    <div class="tabela-container">
                        <table class="tabela-dados">
                            <thead>
                                <tr>
                                    <th class="texto-centro" style="width: 80px;">Codigo</th>
                                    <th>Medico</th>
                                    <th class="texto-centro">Atendimentos</th>
                                    <th class="texto-centro">Tempo Medio</th>
                                    <th class="texto-centro">Finalizados</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${linhasHtml}
                            </tbody>
                        </table>
                    </div>
                </div>
            </section>
        `;
    }

    /**
     * Renderiza secao vazia padrao
     */
    function renderizarSecaoVazia(titulo, icone, mensagem) {
        return `
            <section class="secao-analise" aria-label="${titulo}">
                <header class="secao-header">
                    <div class="secao-titulo">
                        <i class="${icone}" aria-hidden="true"></i>
                        <h2>${titulo}</h2>
                    </div>
                </header>
                <div class="secao-content">
                    <div class="mensagem-vazia">
                        <i class="fas fa-inbox"></i>
                        <p>${mensagem}</p>
                    </div>
                </div>
            </section>
        `;
    }

    /**
     * Mostra mensagem de erro
     */
    function mostrarErro(mensagem) {
        if (!DOM.painelMain) return;

        DOM.painelMain.innerHTML = `
            <div class="mensagem-erro-container">
                <div class="mensagem-erro">
                    <i class="fas fa-exclamation-triangle"></i>
                    <h3>Erro ao Carregar Dados</h3>
                    <p>${escapeHtml(mensagem)}</p>
                    <button class="btn-tentar-novamente" onclick="location.reload()">
                        <i class="fas fa-sync-alt"></i> Tentar Novamente
                    </button>
                </div>
            </div>
        `;
    }

    // =========================================================
    // AUTO SCROLL
    // =========================================================

    /**
     * Inicia o auto scroll
     */
    function iniciarAutoScroll() {
        pararAutoScroll();

        const contentScroll = document.getElementById('content-scroll');
        if (!contentScroll) {
            console.warn('[Painel10] Elemento content-scroll nao encontrado');
            return;
        }

        console.log('[Painel10] Iniciando auto-scroll');

        Estado.scroll.ultimaPosicao = contentScroll.scrollTop;
        Estado.scroll.contadorTravamento = 0;

        // Inicia watchdog
        iniciarWatchdog();

        // Inicia scroll
        Estado.intervalos.scroll = setInterval(() => {
            if (!Estado.autoScrollAtivo) {
                pararAutoScroll();
                return;
            }

            const scrollAtual = contentScroll.scrollTop;
            const scrollMax = contentScroll.scrollHeight - contentScroll.clientHeight;

            if (scrollMax <= 0) return;

            // Chegou ao final
            if (scrollAtual >= scrollMax - 2) {
                console.log('[Painel10] Scroll chegou ao final');
                pararAutoScroll();

                setTimeout(() => {
                    if (!Estado.autoScrollAtivo) return;

                    console.log('[Painel10] Voltando ao topo');
                    contentScroll.scrollTop = 0;
                    Estado.scroll.ultimaPosicao = 0;
                    Estado.scroll.contadorTravamento = 0;

                    setTimeout(() => {
                        if (Estado.autoScrollAtivo) {
                            iniciarAutoScroll();
                        }
                    }, CONFIG.pausaAposReset);

                }, CONFIG.pausaNoFinal);
                return;
            }

            // Continua scrollando
            contentScroll.scrollTop += CONFIG.velocidadeScroll;

        }, CONFIG.intervaloScroll);
    }

    /**
     * Para o auto scroll
     */
    function pararAutoScroll() {
        if (Estado.intervalos.scroll) {
            clearInterval(Estado.intervalos.scroll);
            Estado.intervalos.scroll = null;
        }
        pararWatchdog();
    }

    /**
     * Inicia watchdog para detectar travamentos
     */
    function iniciarWatchdog() {
        pararWatchdog();

        Estado.intervalos.watchdog = setInterval(() => {
            if (!Estado.autoScrollAtivo) {
                pararWatchdog();
                return;
            }

            const contentScroll = document.getElementById('content-scroll');
            if (!contentScroll) return;

            const posicaoAtual = contentScroll.scrollTop;
            const scrollMax = contentScroll.scrollHeight - contentScroll.clientHeight;

            // Verifica se travou (nao esta no final e nao esta movendo)
            if (Math.abs(posicaoAtual - Estado.scroll.ultimaPosicao) < 1 && posicaoAtual < scrollMax - 10) {
                Estado.scroll.contadorTravamento++;

                if (Estado.scroll.contadorTravamento >= 3) {
                    console.warn('[Painel10] Travamento detectado, reiniciando scroll');
                    pararAutoScroll();
                    setTimeout(() => {
                        if (Estado.autoScrollAtivo) {
                            iniciarAutoScroll();
                        }
                    }, 1000);
                }
            } else {
                Estado.scroll.contadorTravamento = 0;
            }

            Estado.scroll.ultimaPosicao = posicaoAtual;

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
                if (Estado.autoScrollAtivo) {
                    pararAutoScroll();
                }
            } else {
                // Retoma quando aba volta a ser visivel
                if (Estado.autoScrollAtivo) {
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
    function inicializar() {
        console.log('[Painel10] Inicializando...');

        // Cache elementos DOM
        cachearElementos();

        // Configura eventos
        configurarEventos();

        // Carrega dados iniciais
        carregarDados();

        // Configura refresh automatico
        Estado.intervalos.refresh = setInterval(carregarDados, CONFIG.intervaloRefresh);

        console.log('[Painel10] Inicializado com sucesso');
    }

    // Aguarda DOM estar pronto
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', inicializar);
    } else {
        inicializar();
    }

})();