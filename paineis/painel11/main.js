// ========================================
// 📋 PAINEL 11 - MONITORAMENTO DE ALTA DO PS
// ========================================

const BASE_URL = window.location.origin;

const CONFIG = {
    apiLista: `${BASE_URL}/api/paineis/painel11/lista`,
    apiDashboard: `${BASE_URL}/api/paineis/painel11/dashboard`,
    intervaloRefresh: 60000, // 60 segundos
    velocidadeScroll: 0.5,
    delayInicioAutoScroll: 10000,
    pausaFinal: 10000,
    pausaAposReset: 10000,
    watchdogInterval: 5000
};

let dadosPainel = [];
let autoScrollAtivo = false;
let intervaloAutoScroll = null;
let intervaloWatchdog = null;
let timeoutAutoScrollInicial = null;
let statusSelecionado = localStorage.getItem('painel11_status') || 'AGUARDANDO_VAGA';
let ultimaPosicaoScroll = 0;
let contadorTravamento = 0;

function inicializar() {
    console.log('🚀 Inicializando Painel 11...');
    configurarBotoes();
    carregarDados();
    setInterval(carregarDados, CONFIG.intervaloRefresh);
    console.log('✅ Painel 11 inicializado!');
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

    const filtroStatus = document.getElementById('filtro-status');
    if (filtroStatus) {
        // Define valor inicial
        filtroStatus.value = statusSelecionado;

        filtroStatus.addEventListener('change', (e) => {
            statusSelecionado = e.target.value;
            localStorage.setItem('painel11_status', statusSelecionado);
            carregarDados();
        });
    }
}

async function carregarDados() {
    try {
        console.log('🔄 Carregando dados...');

        const scrollEstaAtivo = autoScrollAtivo;
        if (scrollEstaAtivo) {
            console.log('⏸️ Pausando scroll durante atualização...');
            pararAutoScroll();
        }

        let url = CONFIG.apiLista;
        if (statusSelecionado) {
            url += `?status=${encodeURIComponent(statusSelecionado)}`;
        }

        const [listaRes, dashboardRes] = await Promise.all([
            fetch(url),
            fetch(CONFIG.apiDashboard)
        ]);

        if (!listaRes.ok || !dashboardRes.ok) {
            throw new Error('Erro ao carregar dados');
        }

        const listaData = await listaRes.json();
        const dashboardData = await dashboardRes.json();

        if (listaData.success) {
            dadosPainel = listaData.data;
            renderizarTabela(dadosPainel);
            atualizarHoraAtualizacao();

            if (dashboardData.success) {
                atualizarDashboard(dashboardData.data);
            }

            // Reativa scroll
            if (scrollEstaAtivo) {
                setTimeout(() => {
                    console.log('▶️ Retomando scroll...');
                    autoScrollAtivo = true;
                    const btnAutoScroll = document.getElementById('btn-auto-scroll');
                    if (btnAutoScroll) {
                        btnAutoScroll.classList.add('active');
                        btnAutoScroll.innerHTML = '<i class="fas fa-pause"></i> Pausar';
                    }
                    iniciarAutoScroll();
                }, 500);
            }

            // Ativa auto-scroll automaticamente após 10s
            if (!scrollEstaAtivo && timeoutAutoScrollInicial === null) {
                timeoutAutoScrollInicial = setTimeout(() => {
                    console.log('🚀 Ativando auto-scroll automaticamente...');
                    const btnAutoScroll = document.getElementById('btn-auto-scroll');
                    if (btnAutoScroll) {
                        autoScrollAtivo = true;
                        btnAutoScroll.classList.add('active');
                        btnAutoScroll.innerHTML = '<i class="fas fa-pause"></i> Pausar';
                        iniciarAutoScroll();
                    }
                }, CONFIG.delayInicioAutoScroll);
            }

            console.log('✅ Dados carregados!');
        } else {
            console.error('Erro nos dados:', listaData);
            mostrarErro('Erro ao processar dados');
        }
    } catch (erro) {
        console.error('❌ Erro:', erro);
        mostrarErro('Erro de conexão');
    }
}

function atualizarDashboard(stats) {
    document.getElementById('total-altas').textContent = stats.total_altas || 0;
    document.getElementById('total-aguardando').textContent = stats.total_aguardando || 0;
    document.getElementById('total-internados').textContent = stats.total_internados || 0;
    document.getElementById('tempo-medio').textContent = stats.tempo_medio_espera || '-';
    document.getElementById('total-criticos').textContent = stats.total_criticos || 0;
}

function renderizarTabela(dados) {
    const container = document.getElementById('painel-content');

    if (!dados || dados.length === 0) {
        container.innerHTML = `
            <div class="empty-message">
                <i class="fas fa-inbox"></i>
                <h3>Nenhum paciente encontrado</h3>
                <p>Não há pacientes com alta para internação no momento</p>
            </div>
        `;
        return;
    }

    let html = `
        <div class="painel-table-wrapper">
            <table class="painel-table">
                <thead>
                    <tr>
                        <th>Nr Atend PS</th>
                        <th>Paciente</th>
                        <th>Idade</th>
                        <th>Convênio</th>
                        <th>Clínica</th>
                        <th>Dt Alta PS</th>
                        <th>Tipo Vaga</th>
                        <th>Status</th>
                        <th>Tempo Espera</th>
                        <th>Nr Atend Int</th>
                        <th>Dt Internação</th>
                    </tr>
                </thead>
                <tbody>
                    ${dados.map(r => criarLinhaTabela(r)).join('')}
                </tbody>
            </table>
        </div>
    `;

    container.innerHTML = html;
}

function criarLinhaTabela(registro) {
    const nomeFormatado = formatarNome(registro.nm_pessoa_fisica);
    const convenioAbrev = abreviarConvenio(registro.ds_convenio);
    const clinicaAbrev = abreviarClinica(registro.ds_clinica);
    const tipoVaga = extrairTipoVaga(registro.ds_necessidade_vaga);
    const tempoEspera = calcularTempoEspera(registro.dt_alta);
    const classeLinha = determinarClasseLinha(tempoEspera, tipoVaga, registro.status_internacao);
    const idadeFormatada = registro.qt_idade ? `${registro.qt_idade} anos` : '-';

    return `
        <tr class="${classeLinha}">
            <td><strong>${registro.nr_atendimento}</strong></td>
            <td>${nomeFormatado}</td>
            <td>${idadeFormatada}</td>
            <td>${convenioAbrev}</td>
            <td>${clinicaAbrev}</td>
            <td>${formatarDataHora(registro.dt_alta)}</td>
            <td>${getBadgeTipoVaga(tipoVaga)}</td>
            <td>${getBadgeStatus(registro.status_internacao)}</td>
            <td>${getBadgeTempoEspera(tempoEspera, registro.status_internacao)}</td>
            <td>${registro.atendimento_internado || '-'}</td>
            <td>${formatarDataHora(registro.dt_internacao)}</td>
        </tr>
    `;
}

// ========================================
// 🔧 FUNÇÕES AUXILIARES
// ========================================

function formatarNome(nomeCompleto) {
    if (!nomeCompleto || nomeCompleto.trim() === '') return '-';

    const partes = nomeCompleto.trim().toUpperCase().split(/\s+/);

    if (partes.length === 1) return partes[0];

    const iniciais = partes.slice(0, -1).map(parte => parte.charAt(0)).join(' ');
    const ultimoNome = partes[partes.length - 1];

    return `${iniciais} ${ultimoNome}`;
}

function abreviarConvenio(convenio) {
    if (!convenio) return '-';

    const abreviacoes = {
        'AMIL': 'AMIL',
        'SUL AMERICA': 'SUL AM',
        'UNIMED': 'UNIMED',
        'BRADESCO': 'BRADESCO',
        'GEAP': 'GEAP',
        'PARTICULAR': 'PARTIC',
        'IPASGO': 'IPASGO'
    };

    for (let chave in abreviacoes) {
        if (convenio.toUpperCase().includes(chave)) {
            return abreviacoes[chave];
        }
    }

    return convenio.length > 15 ? convenio.substring(0, 15) + '...' : convenio;
}

function abreviarClinica(clinica) {
    if (!clinica) return '-';

    const abreviacoes = {
        'CLINICA MEDICA': 'Clínica Médica',
        'CLINICA MÉDICA': 'Clínica Médica',
        'CIRURGIA GERAL': 'Cir. Geral',
        'CIRURGICA GERAL': 'Cir. Geral',
        'ORTOPEDIA': 'Ortopedia',
        'GINECOLOGIA': 'Ginecologia',
        'PEDIATRIA': 'Pediatria',
        'CARDIOLOGIA': 'Cardiologia',
        'NEUROLOGIA': 'Neurologia'
    };

    const clinicaUpper = clinica.toUpperCase();

    for (let chave in abreviacoes) {
        if (clinicaUpper.includes(chave)) {
            return abreviacoes[chave];
        }
    }

    return clinica.length > 12 ? clinica.substring(0, 12) + '...' : clinica;
}

function extrairTipoVaga(necessidade) {
    if (!necessidade) return 'CLINICA';

    const texto = necessidade.toUpperCase();

    if (texto.includes('UTI')) return 'UTI';
    if (texto.includes('CIRÚRGICA') || texto.includes('CIRURGICA')) return 'CIRURGICA';
    return 'CLINICA';
}

function calcularTempoEspera(dtAlta) {
    if (!dtAlta) return null;

    const dataAlta = new Date(dtAlta);
    const agora = new Date();
    const diferencaMs = agora - dataAlta;

    if (diferencaMs < 0) return null;

    const minutos = Math.floor(diferencaMs / 1000 / 60);
    return minutos;
}

function formatarTempoEspera(minutos) {
    if (minutos === null || minutos === undefined) return '-';

    const horas = Math.floor(minutos / 60);
    const mins = minutos % 60;

    if (horas === 0) {
        return `${mins}m`;
    }

    return `${horas}h ${mins}m`;
}

function determinarClasseLinha(tempoMinutos, tipoVaga, status) {
    if (status === 'INTERNADO') return '';

    // UTI sempre tem destaque especial
    if (tipoVaga === 'UTI') return 'vaga-uti';

    // Alertas por tempo
    if (tempoMinutos >= 240) return 'alerta-critico'; // > 4h
    if (tempoMinutos >= 120) return 'alerta-medio';   // > 2h

    return '';
}

function formatarDataHora(dataHora) {
    if (!dataHora) return '-';

    const data = new Date(dataHora);
    const dia = String(data.getDate()).padStart(2, '0');
    const mes = String(data.getMonth() + 1).padStart(2, '0');
    const hora = String(data.getHours()).padStart(2, '0');
    const min = String(data.getMinutes()).padStart(2, '0');

    return `${dia}/${mes} ${hora}:${min}`;
}

// ========================================
// 🎨 BADGES
// ========================================

function getBadgeTipoVaga(tipo) {
    const badges = {
        'UTI': '<span class="tipo-vaga vaga-uti"><i class="fas fa-heartbeat"></i> UTI</span>',
        'CIRURGICA': '<span class="tipo-vaga vaga-cirurgica"><i class="fas fa-scalpel"></i> Cirúrgica</span>',
        'CLINICA': '<span class="tipo-vaga vaga-clinica"><i class="fas fa-hospital"></i> Clínica</span>'
    };

    return badges[tipo] || badges['CLINICA'];
}

function getBadgeStatus(status) {
    if (status === 'INTERNADO') {
        return '<span class="badge badge-internado"><i class="fas fa-check-circle"></i> INTERNADO</span>';
    }

    return '<span class="badge badge-aguardando"><i class="fas fa-hourglass-half"></i> AGUARDANDO</span>';
}

function getBadgeTempoEspera(minutos, status) {
    if (status === 'INTERNADO') {
        return '<span class="texto-neutro">-</span>';
    }

    if (minutos === null) {
        return '<span class="texto-neutro">-</span>';
    }

    const tempoFormatado = formatarTempoEspera(minutos);

    if (minutos >= 240) {
        return `<span class="badge-tempo tempo-critico"><i class="fas fa-exclamation-triangle"></i> ${tempoFormatado}</span>`;
    }

    if (minutos >= 120) {
        return `<span class="badge-tempo tempo-alerta"><i class="fas fa-clock"></i> ${tempoFormatado}</span>`;
    }

    return `<span class="badge-tempo tempo-normal"><i class="fas fa-clock"></i> ${tempoFormatado}</span>`;
}

// ========================================
// 🎬 AUTO-SCROLL COM WATCHDOG
// ========================================

function iniciarAutoScroll() {
    pararAutoScroll();

    const tbody = document.querySelector('.painel-table tbody');
    if (!tbody) {
        console.warn('⚠️ Tbody não encontrado');
        return;
    }

    console.log('🎬 Iniciando auto-scroll...');

    ultimaPosicaoScroll = tbody.scrollTop;
    contadorTravamento = 0;

    iniciarWatchdog();

    intervaloAutoScroll = setInterval(() => {
        if (!autoScrollAtivo) {
            pararAutoScroll();
            return;
        }

        const scrollAtual = tbody.scrollTop;
        const scrollMax = tbody.scrollHeight - tbody.clientHeight;

        if (scrollMax <= 0) {
            console.log('⏭️ Conteúdo cabe na tela');
            return;
        }

        if (scrollAtual >= scrollMax - 1) {
            console.log('🏁 Chegou ao final');
            pararAutoScroll();

            setTimeout(() => {
                if (!autoScrollAtivo) return;

                console.log('🔄 Voltando ao topo...');
                tbody.scrollTop = 0;
                ultimaPosicaoScroll = 0;
                contadorTravamento = 0;

                setTimeout(() => {
                    if (autoScrollAtivo) {
                        console.log('▶️ Reiniciando scroll...');
                        iniciarAutoScroll();
                    }
                }, CONFIG.pausaAposReset);

            }, CONFIG.pausaFinal);
            return;
        }

        tbody.scrollTop += CONFIG.velocidadeScroll;

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

    console.log('🐕 Watchdog iniciado');

    intervaloWatchdog = setInterval(() => {
        if (!autoScrollAtivo) {
            pararWatchdog();
            return;
        }

        const tbody = document.querySelector('.painel-table tbody');
        if (!tbody) return;

        const posicaoAtual = tbody.scrollTop;
        const scrollMax = tbody.scrollHeight - tbody.clientHeight;

        if (Math.abs(posicaoAtual - ultimaPosicaoScroll) < 1 && posicaoAtual < scrollMax - 10) {
            contadorTravamento++;
            console.warn(`⚠️ Possível travamento (${contadorTravamento}/3)`);

            if (contadorTravamento >= 3) {
                console.error('🚨 TRAVAMENTO CONFIRMADO - Reiniciando...');

                const btnAutoScroll = document.getElementById('btn-auto-scroll');
                if (btnAutoScroll) {
                    autoScrollAtivo = true;
                    btnAutoScroll.classList.add('active');
                    btnAutoScroll.innerHTML = '<i class="fas fa-pause"></i> Pausar';
                }

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
        console.log('🐕 Watchdog parado');
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

    const container = document.getElementById('painel-content');
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