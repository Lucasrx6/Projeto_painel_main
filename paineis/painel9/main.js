// ========================================
// 🧪 PAINEL 9 - LAB PENDENTES
// ========================================

const BASE_URL = window.location.origin;

const CONFIG = {
    apiLab: `${BASE_URL}/api/paineis/painel9/lab`,
    apiSetores: `${BASE_URL}/api/paineis/painel9/setores`,
    intervaloRefresh: 95000,
    velocidadeScroll: 0.5,
    delayInicioAutoScroll: 10000,
    pausaFinal: 10000,
    pausaAposReset: 10000,
    watchdogInterval: 5000
};

let dadosLab = [];
let setores = [];
let autoScrollAtivo = false;
let intervaloAutoScroll = null;
let intervaloWatchdog = null;
let timeoutAutoScrollInicial = null;
let setorSelecionado = localStorage.getItem('painel9_setor') || '';
let ultimaPosicaoScroll = 0;
let contadorTravamento = 0;

function inicializar() {
    console.log('🚀 Inicializando Painel Lab Pendentes...');
    configurarBotoes();
    carregarSetores();
    setInterval(carregarDados, CONFIG.intervaloRefresh);
    console.log('✅ Painel inicializado!');
}

var filtrosVisiveis = false;
document.addEventListener('DOMContentLoaded', function() {
    var btnToggleFiltros = document.getElementById('btn-toggle-filtros');
    if (btnToggleFiltros) {
        btnToggleFiltros.addEventListener('click', function() {
            filtrosVisiveis = !filtrosVisiveis;
            var bar = document.getElementById('filtros-bar');
            if (bar) bar.style.display = filtrosVisiveis ? 'block' : 'none';
        });
    }
});

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

    const filtroSetor = document.getElementById('filtro-setor');
    if (filtroSetor) {
        filtroSetor.addEventListener('change', (e) => {
            setorSelecionado = e.target.value;
            localStorage.setItem('painel9_setor', setorSelecionado);
            carregarDados();
        });
    }
}

async function carregarSetores() {
    try {
        const res = await fetch(CONFIG.apiSetores);
        const data = await res.json();

        if (data.success) {
            setores = data.setores;
            popularSelectSetores();
            carregarDados();
        }
    } catch (erro) {
        console.error('❌ Erro ao carregar setores:', erro);
    }
}

function popularSelectSetores() {
    const select = document.getElementById('filtro-setor');
    select.innerHTML = '<option value="">Todos os Setores</option>';

    setores.forEach(setor => {
        const option = document.createElement('option');
        option.value = setor.nm_setor;
        option.textContent = setor.nm_setor;
        if (setor.nm_setor === setorSelecionado) {
            option.selected = true;
        }
        select.appendChild(option);
    });
}

async function carregarDados() {
    try {
        console.log('🔄 Carregando dados...');

        const scrollEstaAtivo = autoScrollAtivo;
        if (scrollEstaAtivo) {
            console.log('⏸️ Pausando scroll durante atualização...');
            pararAutoScroll();
        }

        let url = CONFIG.apiLab;
        if (setorSelecionado) {
            url += `?setor=${encodeURIComponent(setorSelecionado)}`;
        }

        const res = await fetch(url);

        if (!res.ok) {
            throw new Error('Erro ao carregar dados');
        }

        const data = await res.json();

        if (data.success) {
            dadosLab = data.data;
            renderizarTabela(dadosLab);
            atualizarDashboard();
            atualizarHoraAtualizacao();

            if (scrollEstaAtivo) {
                setTimeout(() => {
                    console.log('▶️ Retomando scroll após atualização...');
                    autoScrollAtivo = true;
                    const btnAutoScroll = document.getElementById('btn-auto-scroll');
                    if (btnAutoScroll) {
                        btnAutoScroll.classList.add('active');
                        btnAutoScroll.innerHTML = '<i class="fas fa-pause"></i> Pausar';
                    }
                    iniciarAutoScroll();
                }, 500);
            }

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
            console.error('Erro nos dados:', data);
            mostrarErro('Erro ao processar dados');
        }
    } catch (erro) {
        console.error('❌ Erro:', erro);
        mostrarErro('Erro de conexão');
    }
}

function atualizarDashboard() {
    const totalPendentes = dadosLab.length;
    const totalExames = dadosLab.reduce((acc, d) => {
        return acc + (d.lab_pendentes ? d.lab_pendentes.split('|').length : 0);
    }, 0);

    document.getElementById('total-pendentes').textContent = totalPendentes;
    document.getElementById('nome-setor').textContent = setorSelecionado || 'Todos';
    document.getElementById('total-exames').textContent = totalExames;
}

function renderizarTabela(dados) {
    const container = document.getElementById('lab-content');

    if (!dados || dados.length === 0) {
        container.innerHTML = `
            <div class="empty-message">
                <i class="fas fa-check-circle"></i>
                <h3>Nenhuma pendência</h3>
                <p>Todos os exames foram coletados</p>
            </div>
        `;
        return;
    }

    let html = `
        <div class="lab-table-wrapper">
            <table class="lab-table">
                <thead>
                    <tr>
                        <th>Leito</th>
                        <th>Setor</th>
                        <th>Atendimento</th>
                        <th>Paciente</th>
                        <th>Idade</th>
                        <th>Dias</th>
                        <th>Exames Pendentes</th>
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
    const idadeFormatada = registro.nr_anos ? `${registro.nr_anos} anos` : '-';
    const leito = registro.cd_unidade ? registro.cd_unidade.trim() : '-';
    const exames = registro.lab_pendentes ? registro.lab_pendentes.split('|').map(e => e.trim()) : [];

    return `
        <tr>
            <td><strong>${leito}</strong></td>
            <td>${registro.nm_setor || '-'}</td>
            <td>${registro.nr_atendimento || '-'}</td>
            <td>${nomeFormatado}</td>
            <td>${idadeFormatada}</td>
            <td>${registro.qt_dia_permanencia || '-'}</td>
            <td>
                <div class="exames-list">
                    ${exames.map(e => `<span class="badge-exame">${e}</span>`).join('')}
                </div>
            </td>
        </tr>
    `;
}

function formatarNome(nomeCompleto) {
    if (!nomeCompleto || nomeCompleto.trim() === '') return '-';

    const partes = nomeCompleto.trim().toUpperCase().split(/\s+/);

    if (partes.length === 1) return partes[0];

    const iniciais = partes.slice(0, -1).map(parte => parte.charAt(0)).join(' ');
    const ultimoNome = partes[partes.length - 1];

    return `${iniciais} ${ultimoNome}`;
}

function iniciarAutoScroll() {
    pararAutoScroll();

    const tbody = document.querySelector('.lab-table tbody');
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
                        console.log('▶️ Reiniciando auto-scroll!');
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

        const tbody = document.querySelector('.lab-table tbody');
        if (!tbody) return;

        const posicaoAtual = tbody.scrollTop;
        const scrollMax = tbody.scrollHeight - tbody.clientHeight;

        if (Math.abs(posicaoAtual - ultimaPosicaoScroll) < 1 && posicaoAtual < scrollMax - 10) {
            contadorTravamento++;
            console.warn(`⚠️ Possível travamento (${contadorTravamento}/3)`);

            if (contadorTravamento >= 3) {
                console.error('🚨 TRAVAMENTO - Reiniciando...');

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

    const container = document.getElementById('lab-content');
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