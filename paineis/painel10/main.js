// ========================================
// 📊 PAINEL 10 - ANÁLISE PRONTO SOCORRO
// ========================================

const BASE_URL = window.location.origin;

const CONFIG = {
    apiDashboard: `${BASE_URL}/api/paineis/painel10/dashboard`,
    apiTempoClinica: `${BASE_URL}/api/paineis/painel10/tempo-clinica`,
    apiAguardandoClinica: `${BASE_URL}/api/paineis/painel10/aguardando-clinica`,
    apiAtendimentosHora: `${BASE_URL}/api/paineis/painel10/atendimentos-hora`,
    apiDesempenhoMedico: `${BASE_URL}/api/paineis/painel10/desempenho-medico`,
    apiDesempenhoRecepcao: `${BASE_URL}/api/paineis/painel10/desempenho-recepcao`,
    intervaloRefresh: 60000, // 1 minuto
    velocidadeScroll: 0.5,
    pausaFinal: 8000,
    pausaAposReset: 8000,
    watchdogInterval: 5000
};

let autoScrollAtivo = false;
let intervaloAutoScroll = null;
let intervaloWatchdog = null;
let ultimaPosicaoScroll = 0;
let contadorTravamento = 0;

function inicializar() {
    console.log('🚀 Inicializando Painel PS...');
    configurarBotoes();
    carregarDados();
    setInterval(carregarDados, CONFIG.intervaloRefresh);
    console.log('✅ Painel inicializado!');
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', inicializar);
} else {
    inicializar();
}

function configurarBotoes() {
    const btnVoltar = document.getElementById('btn-voltar');
    if (btnVoltar) {
        btnVoltar.addEventListener('click', () => {
            window.location.href = '/frontend/dashboard.html';
        });
    }

    const btnRefresh = document.getElementById('btn-refresh');
    if (btnRefresh) {
        btnRefresh.addEventListener('click', () => {
            carregarDados();
        });
    }

    const btnAutoScroll = document.getElementById('btn-auto-scroll');
    if (btnAutoScroll) {
        btnAutoScroll.addEventListener('click', () => {
            autoScrollAtivo = !autoScrollAtivo;
            if (autoScrollAtivo) {
                btnAutoScroll.classList.add('active');
                btnAutoScroll.innerHTML = '<i class="fas fa-pause"></i> Pausar';
                console.log('▶️ Auto-scroll ATIVADO');
                iniciarAutoScroll();
            } else {
                btnAutoScroll.classList.remove('active');
                btnAutoScroll.innerHTML = '<i class="fas fa-play"></i> Auto Scroll';
                pararAutoScroll();
                console.log('⏸️ Auto-scroll PAUSADO');
            }
        });
    }
}

async function carregarDados() {
    try {
        console.log('🔄 Carregando dados...');

        const scrollEstaAtivo = autoScrollAtivo;
        if (scrollEstaAtivo) {
            pararAutoScroll();
        }

        // Carregar todos os dados em paralelo
        const [dashboard, tempoClinica, aguardandoClinica, atendimentosHora, desempenhoMedico, desempenhoRecepcao] = await Promise.all([
            fetch(CONFIG.apiDashboard).then(r => r.json()),
            fetch(CONFIG.apiTempoClinica).then(r => r.json()),
            fetch(CONFIG.apiAguardandoClinica).then(r => r.json()),
            fetch(CONFIG.apiAtendimentosHora).then(r => r.json()),
            fetch(CONFIG.apiDesempenhoMedico).then(r => r.json()),
            fetch(CONFIG.apiDesempenhoRecepcao).then(r => r.json())
        ]);

        console.log('📊 Dashboard:', dashboard);
        console.log('⏱️ Tempo Clínica:', tempoClinica);
        console.log('⏳ Aguardando:', aguardandoClinica);
        console.log('📈 Por Hora:', atendimentosHora);
        console.log('👨‍⚕️ Médicos:', desempenhoMedico);
        console.log('🖥️ Recepção:', desempenhoRecepcao);

        if (dashboard.success) {
            atualizarDashboard(dashboard.data);
        }

        renderizarConteudo({
            tempoClinica: tempoClinica.data || [],
            aguardandoClinica: aguardandoClinica.data || [],
            atendimentosHora: atendimentosHora.data || [],
            desempenhoMedico: desempenhoMedico.data || [],
            desempenhoRecepcao: desempenhoRecepcao.data || {}
        });

        atualizarHoraAtualizacao();

        if (scrollEstaAtivo) {
            setTimeout(() => {
                autoScrollAtivo = true;
                const btnAutoScroll = document.getElementById('btn-auto-scroll');
                if (btnAutoScroll) {
                    btnAutoScroll.classList.add('active');
                    btnAutoScroll.innerHTML = '<i class="fas fa-pause"></i> Pausar';
                }
                iniciarAutoScroll();
            }, 500);
        }

        console.log('✅ Dados carregados!');

    } catch (erro) {
        console.error('❌ Erro:', erro);
        mostrarErro('Erro de conexão');
    }
}

function atualizarDashboard(dados) {
    console.log('🎯 Atualizando dashboard com:', dados);

    const totalDia = dados.total_atendimentos_dia || 0;
    const realizados = dados.atendimentos_realizados || 0;
    const aguardando = dados.aguardando_atendimento || 0;
    const alta = dados.pacientes_alta || 0;
    const tempoEspera = dados.tempo_medio_espera_consulta_min || 0;
    const tempoPermanencia = dados.tempo_medio_permanencia_min || 0;

    document.getElementById('total-dia').textContent = totalDia;
    document.getElementById('total-realizados').textContent = realizados;
    document.getElementById('total-aguardando').textContent = aguardando;
    document.getElementById('total-alta').textContent = alta;
    document.getElementById('tempo-medio-espera').textContent = tempoEspera;
    document.getElementById('tempo-medio-permanencia').textContent = tempoPermanencia;

    console.log('✅ Dashboard atualizado!');
}

function renderizarConteudo(dados) {
    const container = document.getElementById('ps-content');

    console.log('🎨 Renderizando conteúdo...');

    let html = '<div class="content-scroll">';

    // 1. Desempenho Recepção (PRIMEIRO)
    html += criarSecaoDesempenhoRecepcao(dados.desempenhoRecepcao);

    // 2. Tempo por Clínica
    html += criarSecaoTempoClinica(dados.tempoClinica);

    // 3. Pacientes Aguardando
    html += criarSecaoAguardando(dados.aguardandoClinica);

    // 4. Gráfico de Atendimentos por Hora
    html += criarSecaoGraficoHora(dados.atendimentosHora);

    // 5. Desempenho Médicos
    html += criarSecaoDesempenhoMedico(dados.desempenhoMedico);

    html += '</div>';

    container.innerHTML = html;

    console.log('✅ Conteúdo renderizado!');
}

function criarSecaoDesempenhoRecepcao(dados) {
    console.log('🖥️ Criando seção recepção:', dados);

    let html = `
        <div class="analise-section">
            <div class="section-header">
                <i class="fas fa-desktop"></i>
                <h2>Desempenho da Recepção</h2>
            </div>
            <div class="grid-cards">
                <div class="stat-card">
                    <div class="stat-icon icon-total">
                        <i class="fas fa-users"></i>
                    </div>
                    <div class="stat-info">
                        <h3>${dados.total_recebidos || 0}</h3>
                        <p>Total Recebidos</p>
                    </div>
                </div>
                <div class="stat-card">
                    <div class="stat-icon icon-tempo">
                        <i class="fas fa-clock"></i>
                    </div>
                    <div class="stat-info">
                        <h3>${dados.tempo_medio_recepcao_min || 0} min</h3>
                        <p>Tempo Médio Recepção</p>
                    </div>
                </div>
                <div class="stat-card">
                    <div class="stat-icon icon-aguardando">
                        <i class="fas fa-hourglass-half"></i>
                    </div>
                    <div class="stat-info">
                        <h3>${dados.aguardando_recepcao || 0}</h3>
                        <p>Aguardando Recepção</p>
                    </div>
                </div>
            </div>
        </div>
    `;

    return html;
}

function criarSecaoTempoClinica(dados) {
    console.log('⏱️ Criando seção tempo clínica:', dados);

    if (!dados || dados.length === 0) {
        console.log('⚠️ Sem dados para tempo por clínica');
        return `
            <div class="analise-section">
                <div class="section-header">
                    <i class="fas fa-stopwatch"></i>
                    <h2>Tempo Médio de Espera por Clínica</h2>
                </div>
                <div class="empty-message">
                    <i class="fas fa-info-circle"></i>
                    <p>Nenhum atendimento registrado hoje</p>
                </div>
            </div>
        `;
    }

    let html = `
        <div class="analise-section">
            <div class="section-header">
                <i class="fas fa-stopwatch"></i>
                <h2>Tempo Médio de Espera por Clínica</h2>
            </div>
            <div class="table-wrapper">
                <table class="data-table">
                    <thead>
                        <tr>
                            <th>Clínica</th>
                            <th>Total Atendimentos</th>
                            <th>Realizados</th>
                            <th>Aguardando</th>
                            <th>Tempo Médio (min)</th>
                        </tr>
                    </thead>
                    <tbody>
    `;

    dados.forEach(row => {
        const tempo = row.tempo_medio_espera_min || 0;
        const badgeClass = tempo < 30 ? 'badge-tempo-bom' : tempo < 60 ? 'badge-tempo-medio' : 'badge-tempo-ruim';

        html += `
            <tr>
                <td><strong>${row.ds_clinica || '-'}</strong></td>
                <td>${row.total_atendimentos || 0}</td>
                <td>${row.atendimentos_realizados || 0}</td>
                <td>${row.aguardando_atendimento || 0}</td>
                <td><span class="badge ${badgeClass}">${tempo} min</span></td>
            </tr>
        `;
    });

    html += `
                    </tbody>
                </table>
            </div>
        </div>
    `;

    return html;
}

function criarSecaoAguardando(dados) {
    console.log('⏳ Criando seção aguardando:', dados);

    if (!dados || dados.length === 0) {
        console.log('⚠️ Sem pacientes aguardando');
        return `
            <div class="analise-section">
                <div class="section-header">
                    <i class="fas fa-user-clock"></i>
                    <h2>Pacientes Aguardando por Clínica</h2>
                </div>
                <div class="empty-message">
                    <i class="fas fa-check-circle" style="color: #28a745;"></i>
                    <p>Nenhum paciente aguardando atendimento</p>
                </div>
            </div>
        `;
    }

    let html = `
        <div class="analise-section">
            <div class="section-header">
                <i class="fas fa-user-clock"></i>
                <h2>Pacientes Aguardando por Clínica</h2>
            </div>
            <div class="table-wrapper">
                <table class="data-table">
                    <thead>
                        <tr>
                            <th>Clínica</th>
                            <th>Total Aguardando</th>
                            <th>Tempo Médio Espera Atual (min)</th>
                            <th>Tempo Máximo Espera (min)</th>
                        </tr>
                    </thead>
                    <tbody>
    `;

    dados.forEach(row => {
        const tempoMedio = row.tempo_espera_atual_min || 0;
        const tempoMax = row.tempo_max_espera_min || 0;

        html += `
            <tr>
                <td><strong>${row.ds_clinica || '-'}</strong></td>
                <td>${row.total_aguardando || 0}</td>
                <td>${tempoMedio} min</td>
                <td><span class="badge badge-tempo-ruim">${tempoMax} min</span></td>
            </tr>
        `;
    });

    html += `
                    </tbody>
                </table>
            </div>
        </div>
    `;

    return html;
}

function criarSecaoGraficoHora(dados) {
    console.log('📈 Criando gráfico por hora:', dados);

    if (!dados || dados.length === 0) {
        console.log('⚠️ Sem dados para gráfico');
        return `
            <div class="analise-section">
                <div class="section-header">
                    <i class="fas fa-chart-bar"></i>
                    <h2>Atendimentos por Hora do Dia</h2>
                </div>
                <div class="empty-message">
                    <i class="fas fa-info-circle"></i>
                    <p>Nenhum atendimento registrado hoje</p>
                </div>
            </div>
        `;
    }

    // Encontrar o valor máximo para escalar as barras
    const maxValue = Math.max(...dados.map(d => d.total_atendimentos || 0), 1);

    console.log('📊 Valor máximo:', maxValue);

    let html = `
        <div class="analise-section">
            <div class="section-header">
                <i class="fas fa-chart-bar"></i>
                <h2>Atendimentos por Hora do Dia</h2>
            </div>
            <div class="chart-container">
                <div class="chart-bars">
    `;

    dados.forEach(row => {
        const hora = row.hora;
        const total = row.total_atendimentos || 0;

        // CORRIGIDO: Calcular altura proporcional
        // Se maxValue = 10 e total = 5, então altura = 50%
        let altura = 0;
        if (maxValue > 0 && total > 0) {
            altura = (total / maxValue) * 100;
            // Garantir altura mínima visível
            if (altura > 0 && altura < 5) {
                altura = 5;
            }
        }

        console.log(`Hora ${hora}: total=${total}, max=${maxValue}, altura=${altura}%`);

        html += `
            <div class="chart-bar">
                <div class="bar-fill" style="height: ${altura}%;">
                    <span class="bar-value">${total}</span>
                </div>
                <div class="bar-label">${hora}h</div>
            </div>
        `;
    });

    html += `
                </div>
            </div>
        </div>
    `;

    return html;
}

function criarSecaoDesempenhoMedico(dados) {
    console.log('👨‍⚕️ Criando seção médicos:', dados);

    if (!dados || dados.length === 0) {
        console.log('⚠️ Sem dados de médicos');
        return `
            <div class="analise-section">
                <div class="section-header">
                    <i class="fas fa-user-md"></i>
                    <h2>Desempenho por Médico</h2>
                </div>
                <div class="empty-message">
                    <i class="fas fa-info-circle"></i>
                    <p>Nenhum médico com atendimento registrado hoje</p>
                </div>
            </div>
        `;
    }

    let html = `
        <div class="analise-section">
            <div class="section-header">
                <i class="fas fa-user-md"></i>
                <h2>Desempenho por Médico</h2>
            </div>
            <div class="table-wrapper">
                <table class="data-table">
                    <thead>
                        <tr>
                            <th>Código</th>
                            <th>Médico</th>
                            <th>Total Atendimentos</th>
                            <th>Tempo Médio Atendimento (min)</th>
                            <th>Pacientes Finalizados</th>
                        </tr>
                    </thead>
                    <tbody>
    `;

    dados.forEach(row => {
        const tempo = row.tempo_medio_atendimento_min || 0;
        const badgeClass = tempo < 15 ? 'badge-tempo-bom' : tempo < 30 ? 'badge-tempo-medio' : 'badge-tempo-ruim';

        html += `
            <tr>
                <td>${row.cd_medico_resp || '-'}</td>
                <td><strong>${row.nm_guerra || '-'}</strong></td>
                <td>${row.total_atendimentos || 0}</td>
                <td><span class="badge ${badgeClass}">${tempo} min</span></td>
                <td>${row.pacientes_finalizados || 0}</td>
            </tr>
        `;
    });

    html += `
                    </tbody>
                </table>
            </div>
        </div>
    `;

    return html;
}

function iniciarAutoScroll() {
    pararAutoScroll();

    const contentScroll = document.querySelector('.content-scroll');
    if (!contentScroll) {
        console.warn('⚠️ content-scroll não encontrado');
        return;
    }

    console.log('🎬 Iniciando auto-scroll...');

    ultimaPosicaoScroll = contentScroll.scrollTop;
    contadorTravamento = 0;

    iniciarWatchdog();

    intervaloAutoScroll = setInterval(() => {
        if (!autoScrollAtivo) {
            pararAutoScroll();
            return;
        }

        const scrollAtual = contentScroll.scrollTop;
        const scrollMax = contentScroll.scrollHeight - contentScroll.clientHeight;

        if (scrollMax <= 0) {
            return;
        }

        if (scrollAtual >= scrollMax - 1) {
            console.log('🏁 Chegou ao final');
            pararAutoScroll();

            setTimeout(() => {
                if (!autoScrollAtivo) return;
                console.log('🔄 Voltando ao topo...');
                contentScroll.scrollTop = 0;
                ultimaPosicaoScroll = 0;
                contadorTravamento = 0;

                setTimeout(() => {
                    if (autoScrollAtivo) {
                        console.log('▶️ Reiniciando auto-scroll!');
                        iniciarAutoScroll();
                    }
                }, CONFIG.pausaAposReset);

            }, CONFIG.pausaFinal);
            return;
        }

        contentScroll.scrollTop += CONFIG.velocidadeScroll;

    }, 50);
}

function pararAutoScroll() {
    if (intervaloAutoScroll) {
        clearInterval(intervaloAutoScroll);
        intervaloAutoScroll = null;
        console.log('🛑 Auto-scroll parado');
    }
    pararWatchdog();
}

function iniciarWatchdog() {
    pararWatchdog();

    intervaloWatchdog = setInterval(() => {
        if (!autoScrollAtivo) {
            pararWatchdog();
            return;
        }

        const contentScroll = document.querySelector('.content-scroll');
        if (!contentScroll) return;

        const posicaoAtual = contentScroll.scrollTop;
        const scrollMax = contentScroll.scrollHeight - contentScroll.clientHeight;

        if (Math.abs(posicaoAtual - ultimaPosicaoScroll) < 1 && posicaoAtual < scrollMax - 10) {
            contadorTravamento++;
            console.warn(`⚠️ Possível travamento (${contadorTravamento}/3)`);

            if (contadorTravamento >= 3) {
                console.error('🚨 TRAVAMENTO - Reiniciando...');
                pararAutoScroll();
                setTimeout(() => {
                    if (autoScrollAtivo) {
                        iniciarAutoScroll();
                    }
                }, 1000);
            }
        } else {
            contadorTravamento = 0;
        }

        ultimaPosicaoScroll = posicaoAtual;

    }, CONFIG.watchdogInterval);
}

function pararWatchdog() {
    if (intervaloWatchdog) {
        clearInterval(intervaloWatchdog);
        intervaloWatchdog = null;
    }
}

function atualizarHoraAtualizacao() {
    const agora = new Date();
    const hora = agora.toLocaleTimeString('pt-BR', {
        hour: '2-digit',
        minute: '2-digit'
    });

    const elemento = document.querySelector('.ultima-atualizacao');
    if (elemento) {
        elemento.textContent = hora;
    }
}

function mostrarErro(mensagem) {
    console.error('❌', mensagem);

    const container = document.getElementById('ps-content');
    container.innerHTML = `
        <div class="empty-message">
            <i class="fas fa-exclamation-triangle" style="color: #dc3545;"></i>
            <h3>Erro ao Carregar Dados</h3>
            <p>${mensagem}</p>
            <button onclick="carregarDados()" style="
                margin-top: 15px;
                padding: 10px 20px;
                background: #dc3545;
                color: white;
                border: none;
                border-radius: 8px;
                cursor: pointer;
                font-size: 0.9rem;
                font-weight: 600;
            ">
                <i class="fas fa-sync-alt"></i> Tentar Novamente
            </button>
        </div>
    `;
}