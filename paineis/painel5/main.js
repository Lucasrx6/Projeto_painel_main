// ========================================
// 📋 PAINEL 5 - CIRURGIAS COM AUTO-SCROLL DINÂMICO
// ========================================

const BASE_URL = window.location.origin;

const CONFIG = {
    apiDashboard: `${BASE_URL}/api/paineis/painel5/dashboard`,
    apiCirurgias: `${BASE_URL}/api/paineis/painel5/cirurgias`,
    intervaloRefresh: 30000, // 30 segundos
    velocidadeScroll: 0.5,
    delayInicioAutoScroll: 10000, // 10 segundos antes de iniciar
    pausaNoFinal: 5000, // 5 segundos no final antes de resetar
    pausaAposReset: 10000  // 10 segundos após resetar antes de recomeçar
};

// ========================================
// 🎯 ESTADOS DO AUTO-SCROLL
// ========================================

const ESTADOS = {
    IDLE: 'idle',           // Parado, aguardando
    SCROLLING: 'scrolling', // Rolando ativamente
    WAITING: 'waiting',     // Pausado no final
    RESETTING: 'resetting'  // Resetando para o topo
};

// ========================================
// 🔧 VARIÁVEIS DE CONTROLE
// ========================================

let dadosCirurgias = [];
let autoScrollAtivo = false;

// Controle do auto-scroll
let estadoAtual = ESTADOS.IDLE;
let intervaloScroll = null;
let timeoutAguardando = null;
let grupoAtualIndex = 0;
let primeiraInicializacao = true;

// ========================================
// 🚀 INICIALIZAÇÃO
// ========================================

function inicializar() {
    console.log('🚀 Inicializando Painel de Cirurgias...');

    configurarBotoes();
    carregarDados();

    // Auto-refresh a cada 30s
    setInterval(carregarDados, CONFIG.intervaloRefresh);

    console.log('✅ Painel inicializado!');
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', inicializar);
} else {
    inicializar();
}

// ========================================
// 🔘 CONFIGURAÇÃO DE BOTÕES
// ========================================

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
            if (autoScrollAtivo) {
                desativarAutoScroll();
            } else {
                ativarAutoScroll();
            }
        });
    }
}

// ========================================
// ▶️ ATIVAR AUTO-SCROLL
// ========================================

function ativarAutoScroll() {
    autoScrollAtivo = true;
    primeiraInicializacao = false;

    const btnAutoScroll = document.getElementById('btn-auto-scroll');
    if (btnAutoScroll) {
        btnAutoScroll.classList.add('active');
        btnAutoScroll.innerHTML = '<i class="fas fa-pause"></i> Pausar';
    }

    console.log('▶️ Auto-scroll ATIVADO');
    iniciarCicloAutoScroll();
}

// ========================================
// ⏸️ DESATIVAR AUTO-SCROLL
// ========================================

function desativarAutoScroll() {
    autoScrollAtivo = false;
    estadoAtual = ESTADOS.IDLE;

    limparTimers();

    const btnAutoScroll = document.getElementById('btn-auto-scroll');
    if (btnAutoScroll) {
        btnAutoScroll.classList.remove('active');
        btnAutoScroll.innerHTML = '<i class="fas fa-play"></i> Auto Scroll';
    }

    console.log('⏸️ Auto-scroll DESATIVADO');
}

// ========================================
// 🧹 LIMPAR TIMERS
// ========================================

function limparTimers() {
    if (intervaloScroll) {
        clearInterval(intervaloScroll);
        intervaloScroll = null;
    }

    if (timeoutAguardando) {
        clearTimeout(timeoutAguardando);
        timeoutAguardando = null;
    }
}

// ========================================
// 📊 CARREGAMENTO DE DADOS
// ========================================

async function carregarDados() {
    try {
        console.log('🔄 Carregando dados...');

        const [dashboardRes, cirurgiasRes] = await Promise.all([
            fetch(CONFIG.apiDashboard),
            fetch(CONFIG.apiCirurgias)
        ]);

        if (!dashboardRes.ok || !cirurgiasRes.ok) {
            throw new Error('Erro ao carregar dados');
        }

        const dashboardData = await dashboardRes.json();
        const cirurgiasData = await cirurgiasRes.json();

        if (dashboardData.success && cirurgiasData.success) {
            atualizarDashboard(dashboardData.data);
            dadosCirurgias = cirurgiasData.data;
            renderizarCirurgias(dadosCirurgias);
            atualizarHoraAtualizacao();

            // ✅ Ativa auto-scroll automaticamente após 10 segundos (apenas na primeira carga)
            if (primeiraInicializacao && !autoScrollAtivo) {
                console.log(`⏱️ Agendando início automático do auto-scroll em ${CONFIG.delayInicioAutoScroll / 1000}s...`);

                timeoutAguardando = setTimeout(() => {
                    if (!autoScrollAtivo && primeiraInicializacao) {
                        console.log('🚀 Ativando auto-scroll automaticamente...');
                        ativarAutoScroll();
                    }
                }, CONFIG.delayInicioAutoScroll);
            }

            console.log('✅ Dados carregados!');
        } else {
            console.error('Erro nos dados:', dashboardData, cirurgiasData);
            mostrarErro('Erro ao processar dados');
        }

    } catch (erro) {
        console.error('❌ Erro:', erro);
        mostrarErro('Erro de conexão');
    }
}

// ========================================
// 📊 ATUALIZAR DASHBOARD
// ========================================

function atualizarDashboard(dados) {
    document.getElementById('total-cirurgias').textContent =
        parseInt(dados.total_cirurgias) || 0;

    document.getElementById('cirurgias-previstas').textContent =
        parseInt(dados.cirurgias_previstas) || 0;

    document.getElementById('cirurgias-andamento').textContent =
        parseInt(dados.cirurgias_andamento) || 0;

    document.getElementById('cirurgias-realizadas').textContent =
        parseInt(dados.cirurgias_realizadas) || 0;
}

// ========================================
// 📋 RENDERIZAR CIRURGIAS
// ========================================

function renderizarCirurgias(gruposDia) {
    const container = document.getElementById('cirurgias-content');

    if (!gruposDia || gruposDia.length === 0) {
        container.innerHTML = `
            <div class="empty-message">
                <i class="fas fa-calendar-times"></i>
                <h3>Nenhuma cirurgia agendada</h3>
                <p>Não há cirurgias previstas para este período</p>
            </div>
        `;
        return;
    }

    let html = '';

    gruposDia.forEach(grupo => {
        const cirurgias = grupo.cirurgias || [];

        html += `
            <div class="grupo-dia">
                <div class="grupo-dia-header">
                    <i class="fas fa-calendar-day"></i>
                    <span>${grupo.grupo || grupo.data}</span>
                    <span class="grupo-dia-badge">${cirurgias.length}</span>
                </div>

                <div class="cirurgias-table-wrapper">
                    <table class="cirurgias-table">
                        <thead>
                            <tr>
                                <th>Status</th>
                                <th>Sala</th>
                                <th>Paciente</th>
                                <th>Cirurgião</th>
                                <th>Cirurgia</th>
                                <th>Previsão</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${cirurgias.map(c => criarLinhaCirurgia(c)).join('')}
                        </tbody>
                    </table>
                </div>
            </div>
        `;
    });

    container.innerHTML = html;

    // ✅ Ajusta altura dinâmica das tabelas
    ajustarAlturaTabelasDinamicamente();
}

// ========================================
// 📏 AJUSTE DINÂMICO DE ALTURA
// ========================================

function ajustarAlturaTabelasDinamicamente() {
    const container = document.getElementById('cirurgias-content');
    const grupos = container.querySelectorAll('.grupo-dia');

    if (grupos.length === 0) return;

    // Calcula espaço disponível
    const containerHeight = container.clientHeight;
    const totalGaps = (grupos.length - 1) * 10; // Gap entre grupos
    const espacoDisponivel = containerHeight - totalGaps;

    // Divide igualmente entre grupos
    const alturaPorGrupo = espacoDisponivel / grupos.length;

    grupos.forEach(grupo => {
        const header = grupo.querySelector('.grupo-dia-header');
        const wrapper = grupo.querySelector('.cirurgias-table-wrapper');
        const thead = grupo.querySelector('.cirurgias-table thead');

        if (!header || !wrapper || !thead) return;

        const headerHeight = header.offsetHeight;
        const theadHeight = thead.offsetHeight;
        const alturaParaTbody = alturaPorGrupo - headerHeight - theadHeight - 4;

        // Define altura do tbody
        const tbody = grupo.querySelector('.cirurgias-table tbody');
        if (tbody) {
            tbody.style.maxHeight = `${alturaParaTbody}px`;
            tbody.style.display = 'block';
            tbody.style.overflowY = 'auto';
            tbody.style.overflowX = 'hidden';
        }
    });
}

// Reajusta ao redimensionar janela
window.addEventListener('resize', () => {
    if (dadosCirurgias.length > 0) {
        setTimeout(ajustarAlturaTabelasDinamicamente, 100);
    }
});

// ========================================
// 🎬 CICLO COMPLETO DO AUTO-SCROLL
// ========================================

function iniciarCicloAutoScroll() {
    if (!autoScrollAtivo) return;

    const grupos = document.querySelectorAll('.grupo-dia');

    if (grupos.length === 0) {
        console.warn('⚠️ Nenhum grupo encontrado para auto-scroll');
        return;
    }

    // Reseta estado
    grupoAtualIndex = 0;
    estadoAtual = ESTADOS.SCROLLING;

    console.log(`🎬 Iniciando ciclo de auto-scroll com ${grupos.length} grupo(s)`);
    console.log(`📍 Estado: ${estadoAtual}`);

    // Limpa timers anteriores
    limparTimers();

    // Reseta todos os scrolls para o topo
    grupos.forEach(grupo => {
        const tbody = grupo.querySelector('.cirurgias-table tbody');
        if (tbody) tbody.scrollTop = 0;
    });

    // Inicia o scroll
    executarScroll();
}

// ========================================
// 🔄 EXECUTAR SCROLL CONTÍNUO
// ========================================

function executarScroll() {
    if (!autoScrollAtivo || estadoAtual !== ESTADOS.SCROLLING) {
        limparTimers();
        return;
    }

    const grupos = document.querySelectorAll('.grupo-dia');

    if (grupos.length === 0) {
        console.warn('⚠️ Nenhum grupo encontrado');
        desativarAutoScroll();
        return;
    }

    intervaloScroll = setInterval(() => {
        if (!autoScrollAtivo || estadoAtual !== ESTADOS.SCROLLING) {
            limparTimers();
            return;
        }

        const grupoAtual = grupos[grupoAtualIndex];
        if (!grupoAtual) {
            console.warn('⚠️ Grupo não encontrado, reiniciando...');
            iniciarCicloAutoScroll();
            return;
        }

        const tbody = grupoAtual.querySelector('.cirurgias-table tbody');
        if (!tbody) {
            console.warn('⚠️ Tbody não encontrado, próximo grupo...');
            avancarProximoGrupo(grupos);
            return;
        }

        const scrollAtual = tbody.scrollTop;
        const scrollMax = tbody.scrollHeight - tbody.clientHeight;

        // Verifica se chegou no final do grupo atual
        if (scrollAtual >= scrollMax - 2) {
            // Se é o último grupo, pausa e depois reseta
            if (grupoAtualIndex === grupos.length - 1) {
                finalizarCiclo(grupos);
            } else {
                // Avança para o próximo grupo
                avancarProximoGrupo(grupos);
            }
            return;
        }

        // Continua scrollando
        tbody.scrollTop += CONFIG.velocidadeScroll;

    }, 50); // 50ms para scroll suave
}

// ========================================
// ➡️ AVANÇAR PARA PRÓXIMO GRUPO
// ========================================

function avancarProximoGrupo(grupos) {
    grupoAtualIndex++;
    console.log(`➡️ Avançando para grupo ${grupoAtualIndex + 1}/${grupos.length}`);

    // Não precisa reiniciar o intervalo, ele continua automaticamente
}

// ========================================
// 🏁 FINALIZAR CICLO (ÚLTIMO GRUPO)
// ========================================

function finalizarCiclo(grupos) {
    console.log(`🏁 Final do último grupo - pausando por ${CONFIG.pausaNoFinal / 1000}s...`);

    // Para o scroll
    estadoAtual = ESTADOS.WAITING;
    limparTimers();

    // Aguarda no final
    timeoutAguardando = setTimeout(() => {
        if (!autoScrollAtivo) {
            console.log('⚠️ Auto-scroll foi desativado, abortando reset');
            return;
        }

        resetarParaTopo(grupos);

    }, CONFIG.pausaNoFinal);
}

// ========================================
// 🔄 RESETAR PARA O TOPO
// ========================================

function resetarParaTopo(grupos) {
    console.log('🔄 Resetando todos os grupos para o topo...');

    estadoAtual = ESTADOS.RESETTING;

    // Reseta scroll de todos os grupos
    grupos.forEach((grupo, idx) => {
        const tbody = grupo.querySelector('.cirurgias-table tbody');
        if (tbody) {
            tbody.scrollTop = 0;
            console.log(`  ↺ Grupo ${idx + 1} resetado`);
        }
    });

    // Aguarda antes de recomeçar
    console.log(`⏳ Aguardando ${CONFIG.pausaAposReset / 1000}s antes de recomeçar...`);

    timeoutAguardando = setTimeout(() => {
        if (!autoScrollAtivo) {
            console.log('⚠️ Auto-scroll foi desativado durante a pausa');
            estadoAtual = ESTADOS.IDLE;
            return;
        }

        console.log('🔁 Reiniciando ciclo completo!');
        iniciarCicloAutoScroll();

    }, CONFIG.pausaAposReset);
}

// ========================================
// 📝 FORMATAÇÃO DE NOMES
// ========================================

function formatarNome(nomeCompleto) {
    if (!nomeCompleto || nomeCompleto.trim() === '') return '-';

    // Remove espaços extras e converte para maiúsculas
    const partes = nomeCompleto.trim().toUpperCase().split(/\s+/);

    // Se tem apenas 1 palavra, retorna ela
    if (partes.length === 1) return partes[0];

    // Pega a primeira letra de cada palavra EXCETO a última
    const iniciais = partes.slice(0, -1).map(parte => parte.charAt(0)).join(' ');

    // Pega a última palavra completa
    const ultimoNome = partes[partes.length - 1];

    // Retorna no formato: "L F Oliveira"
    return `${iniciais} ${ultimoNome}`;
}

// ========================================
// 🏥 CRIAR LINHA DE CIRURGIA
// ========================================

function criarLinhaCirurgia(cirurgia) {
    const statusIcon = obterIconeStatus(cirurgia.ie_status_cirurgia);

    // ✅ Formata nomes: Iniciais + Último sobrenome
    const nomePacienteFormatado = formatarNome(cirurgia.nm_paciente_pf);
    const nomeMedicoFormatado = formatarNome(cirurgia.nm_medico);

    return `
        <tr>
            <td>
                <div class="status-icon ${statusIcon.classe}">
                    <i class="${statusIcon.icone}"></i>
                </div>
            </td>
            <td>
                <span class="badge-sala" title="${cirurgia.setor_cirurgia || '-'}">
                    ${cirurgia.setor_cirurgia || '-'}
                </span>
            </td>
            <td>
                <div class="paciente-nome" title="${cirurgia.nm_paciente_pf || '-'}">
                    ${nomePacienteFormatado}
                </div>
                <span class="paciente-info" title="${cirurgia.ds_convenio || '-'} • ${cirurgia.ds_idade_abrev || '-'}">
                    ${cirurgia.ds_convenio || '-'} • ${cirurgia.ds_idade_abrev || '-'}
                </span>
            </td>
            <td>
                <div class="medico-nome" title="${cirurgia.nm_medico || '-'}">
                    ${nomeMedicoFormatado}
                </div>
            </td>
            <td>
                <div class="cirurgia-desc" title="${cirurgia.ds_proc_cir || '-'}">
                    ${cirurgia.ds_proc_cir || '-'}
                </div>
            </td>
            <td>
                <div class="previsao-hora">
                    ${cirurgia.previsao_termino || '-'}
                </div>
            </td>
        </tr>
    `;
}

// ========================================
// 🎨 OBTER ÍCONE DE STATUS
// ========================================

function obterIconeStatus(status) {
    const statusNum = parseInt(status);

    if (statusNum === 2) {
        return {
            classe: 'status-realizada',
            icone: 'fas fa-check-circle'
        };
    }

    if (statusNum === -1) {
        return {
            classe: 'status-prevista',
            icone: 'fas fa-clock'
        };
    }

    return {
        classe: 'status-andamento',
        icone: 'fas fa-heartbeat'
    };
}

// ========================================
// 🕒 ATUALIZAR HORA
// ========================================

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

// ========================================
// ❌ TRATAMENTO DE ERROS
// ========================================

function mostrarErro(mensagem) {
    console.error('❌', mensagem);

    const container = document.getElementById('cirurgias-content');
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
                transition: all 0.3s ease;
            " onmouseover="this.style.transform='translateY(-2px)'"
               onmouseout="this.style.transform='translateY(0)'">
                <i class="fas fa-sync-alt"></i> Tentar Novamente
            </button>
        </div>
    `;
}