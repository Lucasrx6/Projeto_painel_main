// ========================================
// 📋 CONFIGURAÇÃO - PÁGINA DE DETALHES
// ========================================

const BASE_URL = window.location.origin;

const CONFIG = {
    apiUrlOcupados: `${BASE_URL}/api/paineis/painel4/leitos-ocupados`,
    apiUrlDisponiveis: `${BASE_URL}/api/paineis/painel4/leitos-disponiveis`,
    apiUrlTodos: `${BASE_URL}/api/paineis/painel4/todos-leitos`,
    apiUrlSetores: `${BASE_URL}/api/paineis/painel4/setores`,
    intervaloRefresh: 30000, // 30 segundos
    velocidadeScroll: 0.5,
    limiteLinhas: 30,
    pausaNaLinha100: 2000
};

let dadosOcupados = [];
let dadosDisponiveis = [];
let dadosTodos = [];
let dadosOcupadosFiltrados = [];
let dadosDisponiveisFiltrados = [];
let dadosTodosFiltrados = [];

let estadoOrdenacao = {
    campo: null,
    direcao: 'asc'
};

// Estado dos filtros (PERSISTENTE)
let filtrosAtivos = {
    setor: '',
    status: '',
    busca: ''
};

let autoScrollAtivo = false;
let intervaloAutoScroll = null;

// ========================================
// 🚀 INICIALIZAÇÃO
// ========================================

function inicializar() {
    console.log('🚀 Inicializando Página de Detalhes...');

    configurarBotoes();
    configurarAbas();
    configurarFiltros();
    configurarOrdenacao();
    carregarDados();

    // Auto-refresh mantendo filtros
    setInterval(carregarDados, CONFIG.intervaloRefresh);

    // Ativa auto-scroll após 5 segundos
    setTimeout(() => {
        configurarAutoScroll();
    }, 500);

    console.log('✅ Página inicializada com sucesso!');
    console.log('🔄 Auto-refresh: 30s (filtros mantidos)');
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
    const btnVoltar = document.getElementById('btn-voltar-dashboard');
    if (btnVoltar) {
        btnVoltar.addEventListener('click', () => {
            window.location.href = '/painel/painel4';
        });
    }

    const btnRefresh = document.getElementById('btn-refresh');
    if (btnRefresh) {
        btnRefresh.addEventListener('click', () => {
            carregarDados();
        });
    }

    const btnLimpar = document.getElementById('btn-limpar-filtros');
    if (btnLimpar) {
        btnLimpar.addEventListener('click', () => {
            limparFiltros();
        });
    }
}

// ========================================
// 📑 CONFIGURAÇÃO DE ABAS
// ========================================

function configurarAbas() {
    const botoes = document.querySelectorAll('.tab-button');

    botoes.forEach(botao => {
        botao.addEventListener('click', () => {
            const tabId = botao.getAttribute('data-tab');

            // Remove active de todos
            botoes.forEach(b => b.classList.remove('active'));
            document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));

            // Ativa o selecionado
            botao.classList.add('active');
            document.getElementById(`tab-${tabId}`).classList.add('active');

            // Atualiza estatísticas
            atualizarEstatisticasFiltro();
        });
    });
}

// ========================================
// 🔍 CONFIGURAÇÃO DE FILTROS (PERSISTENTES)
// ========================================

function configurarFiltros() {
    document.getElementById('filtro-setor').addEventListener('change', aplicarFiltros);
    document.getElementById('filtro-status').addEventListener('change', aplicarFiltros);
    document.getElementById('filtro-busca').addEventListener('input', aplicarFiltros);
}

function limparFiltros() {
    document.getElementById('filtro-setor').value = '';
    document.getElementById('filtro-status').value = '';
    document.getElementById('filtro-busca').value = '';

    filtrosAtivos = {
        setor: '',
        status: '',
        busca: ''
    };

    aplicarFiltros();
}

function aplicarFiltros() {
    // SALVA o estado dos filtros (PERSISTÊNCIA)
    filtrosAtivos.setor = document.getElementById('filtro-setor').value.toLowerCase();
    filtrosAtivos.status = document.getElementById('filtro-status').value;
    filtrosAtivos.busca = document.getElementById('filtro-busca').value.toLowerCase();

    // Filtra Ocupados
    dadosOcupadosFiltrados = dadosOcupados.filter(item => {
        let passa = true;

        if (filtrosAtivos.setor && !item.setor.toLowerCase().includes(filtrosAtivos.setor)) {
            passa = false;
        }

        if (filtrosAtivos.busca) {
            const textoCompleto = `
                ${item.paciente || ''}
                ${item.leito || ''}
                ${item.medico || ''}
                ${item.convenio || ''}
                ${item.clinica || ''}
            `.toLowerCase();

            if (!textoCompleto.includes(filtrosAtivos.busca)) {
                passa = false;
            }
        }

        return passa;
    });

    // Filtra Disponíveis
    dadosDisponiveisFiltrados = dadosDisponiveis.filter(item => {
        let passa = true;

        if (filtrosAtivos.setor && !item.setor.toLowerCase().includes(filtrosAtivos.setor)) {
            passa = false;
        }

        if (filtrosAtivos.status && item.status_leito !== filtrosAtivos.status) {
            passa = false;
        }

        if (filtrosAtivos.busca && !item.leito.toLowerCase().includes(filtrosAtivos.busca)) {
            passa = false;
        }

        return passa;
    });

    // Filtra Todos
    dadosTodosFiltrados = dadosTodos.filter(item => {
        let passa = true;

        if (filtrosAtivos.setor && !item.setor.toLowerCase().includes(filtrosAtivos.setor)) {
            passa = false;
        }

        if (filtrosAtivos.status && item.status_leito !== filtrosAtivos.status) {
            passa = false;
        }

        if (filtrosAtivos.busca) {
            const textoCompleto = `
                ${item.paciente || ''}
                ${item.leito || ''}
                ${item.medico || ''}
                ${item.convenio || ''}
            `.toLowerCase();

            if (!textoCompleto.includes(filtrosAtivos.busca)) {
                passa = false;
            }
        }

        return passa;
    });

    // Reaplicar ordenação se houver
    if (estadoOrdenacao.campo) {
        const abaAtiva = document.querySelector('.tab-button.active')?.getAttribute('data-tab');
        if (abaAtiva === 'leitos-ocupados') {
            ordenarArray(dadosOcupadosFiltrados, estadoOrdenacao.campo);
        } else if (abaAtiva === 'leitos-disponiveis') {
            ordenarArray(dadosDisponiveisFiltrados, estadoOrdenacao.campo);
        } else {
            ordenarArray(dadosTodosFiltrados, estadoOrdenacao.campo);
        }
    }

    // Atualiza tabelas
    renderizarTabelaOcupados();
    renderizarTabelaDisponiveis();
    renderizarTabelaTodos();

    // Atualiza estatísticas
    atualizarEstatisticasFiltro();
}

// ========================================
// 📊 CARREGAMENTO DE DADOS (MANTÉM FILTROS)
// ========================================

async function carregarDados() {
    try {
        console.log('🔄 Carregando dados...');

        const [ocupados, disponiveis, todos, setores] = await Promise.all([
            fetch(CONFIG.apiUrlOcupados).then(r => r.json()),
            fetch(CONFIG.apiUrlDisponiveis).then(r => r.json()),
            fetch(CONFIG.apiUrlTodos).then(r => r.json()),
            fetch(CONFIG.apiUrlSetores).then(r => r.json())
        ]);

        if (ocupados.success && disponiveis.success && todos.success && setores.success) {
            dadosOcupados = ocupados.data;
            dadosDisponiveis = disponiveis.data;
            dadosTodos = todos.data;

            // Popula filtro de setores (mantém seleção)
            popularFiltroSetores(setores.data);

            // Aplica filtros (MANTÉM os filtros anteriores!)
            aplicarFiltros();

            // Atualiza badges das abas
            atualizarBadgesAbas();

            console.log('✅ Dados carregados! Filtros mantidos.');
        } else {
            mostrarErro('Erro ao carregar dados');
        }

    } catch (erro) {
        console.error('❌ Erro ao carregar dados:', erro);
        mostrarErro('Erro de conexão com o servidor');
    }
}

function popularFiltroSetores(setores) {
    const select = document.getElementById('filtro-setor');
    const valorAtual = select.value; // SALVA seleção atual

    // Limpar e repopular
    select.innerHTML = '<option value="">Todos os Setores</option>';

    setores
        .sort((a, b) => (a.nm_setor || '').localeCompare(b.nm_setor || ''))
        .forEach(setor => {
            const option = document.createElement('option');
            option.value = setor.nm_setor;
            option.textContent = setor.nm_setor;
            select.appendChild(option);
        });

    // RESTAURA valor anterior
    if (valorAtual) {
        select.value = valorAtual;
    }
}

function atualizarBadgesAbas() {
    document.getElementById('badge-ocupados').textContent = dadosOcupados.length;
    document.getElementById('badge-disponiveis').textContent = dadosDisponiveis.length;
    document.getElementById('badge-todos').textContent = dadosTodos.length;
}

function atualizarEstatisticasFiltro() {
    const abaAtiva = document.querySelector('.tab-button.active')?.getAttribute('data-tab');

    let totalOriginal = 0;
    let totalFiltrado = 0;

    if (abaAtiva === 'leitos-ocupados') {
        totalOriginal = dadosOcupados.length;
        totalFiltrado = dadosOcupadosFiltrados.length;
    } else if (abaAtiva === 'leitos-disponiveis') {
        totalOriginal = dadosDisponiveis.length;
        totalFiltrado = dadosDisponiveisFiltrados.length;
    } else {
        totalOriginal = dadosTodos.length;
        totalFiltrado = dadosTodosFiltrados.length;
    }

    document.getElementById('total-registros').textContent = totalOriginal;
    document.getElementById('total-filtrados').textContent = totalFiltrado;
    document.getElementById('ultima-atualizacao').textContent = new Date().toLocaleTimeString('pt-BR');
}

// ========================================
// 📋 RENDERIZAÇÃO DAS TABELAS
// ========================================

function renderizarTabelaOcupados() {
    const tbody = document.getElementById('tbody-ocupados');

    if (dadosOcupadosFiltrados.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="9" class="empty-message">
                    <i class="fas fa-inbox"></i>
                    <h3>Nenhum leito ocupado encontrado</h3>
                    <p>Tente ajustar os filtros ou limpar a busca</p>
                </td>
            </tr>
        `;
        return;
    }

    tbody.innerHTML = dadosOcupadosFiltrados.map(item => `
        <tr>
            <td><strong>${item.leito || '-'}</strong></td>
            <td>${item.paciente || '-'}</td>
            <td>${item.idade || '-'}</td>
            <td>${formatarSexo(item.sexo)}</td>
            <td>${item.convenio || '-'}</td>
            <td>${item.medico || '-'}</td>
            <td><strong>${item.dias_internado || 0}</strong></td>
            <td>${item.clinica || '-'}</td>
            <td>${item.tipo_acomodacao || '-'}</td>
        </tr>
    `).join('');
}

function renderizarTabelaDisponiveis() {
    const tbody = document.getElementById('tbody-disponiveis');

    if (dadosDisponiveisFiltrados.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="4" class="empty-message">
                    <i class="fas fa-inbox"></i>
                    <h3>Nenhum leito disponível encontrado</h3>
                    <p>Tente ajustar os filtros</p>
                </td>
            </tr>
        `;
        return;
    }

    tbody.innerHTML = dadosDisponiveisFiltrados.map(item => `
        <tr>
            <td><strong>${item.leito || '-'}</strong></td>
            <td>${item.setor || '-'}</td>
            <td>${item.tipo_acomodacao || '-'}</td>
            <td>${formatarStatusLeito(item.status_leito, item.status)}</td>
        </tr>
    `).join('');
}

function renderizarTabelaTodos() {
    const tbody = document.getElementById('tbody-todos');

    if (dadosTodosFiltrados.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="9" class="empty-message">
                    <i class="fas fa-inbox"></i>
                    <h3>Nenhum registro encontrado</h3>
                    <p>Tente ajustar os filtros</p>
                </td>
            </tr>
        `;
        return;
    }

    tbody.innerHTML = dadosTodosFiltrados.map(item => `
        <tr>
            <td><strong>${item.leito || '-'}</strong></td>
            <td>${item.setor || '-'}</td>
            <td>${formatarStatusLeito(item.status_leito, item.status_leito_desc)}</td>
            <td>${item.paciente || '-'}</td>
            <td>${item.idade || '-'}</td>
            <td>${item.convenio || '-'}</td>
            <td>${item.medico || '-'}</td>
            <td>${item.dias_internado || '-'}</td>
            <td>${item.tipo_acomodacao || '-'}</td>
        </tr>
    `).join('');
}

// ========================================
// 🎨 FORMATAÇÃO
// ========================================

function formatarSexo(sexo) {
    if (!sexo) return '-';
    return sexo === 'M' ? 'Masculino' : sexo === 'F' ? 'Feminino' : sexo;
}

function formatarStatusLeito(status, descricao) {
    const classes = {
        'P': 'status-ocupado',
        'L': 'status-livre',
        'H': 'status-higienizacao',
        'I': 'status-interditado'
    };

    const textos = {
        'P': 'Ocupado',
        'L': 'Livre',
        'H': 'Higienização',
        'I': 'Interditado'
    };

    const classe = classes[status] || '';
    const texto = descricao || textos[status] || status || 'Desconhecido';

    return `<span class="status-badge ${classe}">${texto}</span>`;
}

// ========================================
// 🔃 ORDENAÇÃO
// ========================================

function configurarOrdenacao() {
    document.querySelectorAll('th.ordenavel').forEach(th => {
        th.addEventListener('click', () => {
            const campo = th.getAttribute('data-campo');
            ordenarPorCampo(campo);
        });
    });
}

function ordenarPorCampo(campo) {
    // Alterna direção
    if (estadoOrdenacao.campo === campo) {
        estadoOrdenacao.direcao = estadoOrdenacao.direcao === 'asc' ? 'desc' : 'asc';
    } else {
        estadoOrdenacao.campo = campo;
        estadoOrdenacao.direcao = 'asc';
    }

    // Ordena os dados filtrados
    const abaAtiva = document.querySelector('.tab-button.active')?.getAttribute('data-tab');

    if (abaAtiva === 'leitos-ocupados') {
        ordenarArray(dadosOcupadosFiltrados, campo);
        renderizarTabelaOcupados();
    } else if (abaAtiva === 'leitos-disponiveis') {
        ordenarArray(dadosDisponiveisFiltrados, campo);
        renderizarTabelaDisponiveis();
    } else {
        ordenarArray(dadosTodosFiltrados, campo);
        renderizarTabelaTodos();
    }

    atualizarIconesOrdenacao(campo);
}

function ordenarArray(array, campo) {
    array.sort((a, b) => {
        let valorA = a[campo];
        let valorB = b[campo];

        if (valorA === null || valorA === undefined) valorA = '';
        if (valorB === null || valorB === undefined) valorB = '';

        if (typeof valorA === 'string') valorA = valorA.toLowerCase();
        if (typeof valorB === 'string') valorB = valorB.toLowerCase();

        let resultado = 0;
        if (valorA < valorB) resultado = -1;
        if (valorA > valorB) resultado = 1;

        return estadoOrdenacao.direcao === 'asc' ? resultado : -resultado;
    });
}

function atualizarIconesOrdenacao(campoAtivo) {
    document.querySelectorAll('.sort-icon').forEach(icon => {
        icon.className = 'fas fa-sort sort-icon';
    });

    const th = document.querySelector(`th[data-campo="${campoAtivo}"]`);
    if (th) {
        const icon = th.querySelector('.sort-icon');
        if (icon) {
            icon.className = estadoOrdenacao.direcao === 'asc'
                ? 'fas fa-sort-up sort-icon active'
                : 'fas fa-sort-down sort-icon active';
        }
    }
}

// ========================================
// 🎬 AUTO SCROLL (IGUAL PAINEL 2)
// ========================================

function configurarAutoScroll() {
    const btnAutoScroll = document.getElementById('btn-auto-scroll');
    if (!btnAutoScroll) return;

    const container = document.querySelector('.table-container');
    if (!container) return;

    btnAutoScroll.addEventListener('click', () => {
        autoScrollAtivo = !autoScrollAtivo;

        if (autoScrollAtivo) {
            btnAutoScroll.classList.add('active');
            btnAutoScroll.innerHTML = '<i class="fas fa-pause"></i> Pausar';
            iniciarAutoScroll(container);
        } else {
            btnAutoScroll.classList.remove('active');
            btnAutoScroll.innerHTML = '<i class="fas fa-play"></i> Auto Scroll';
            pararAutoScroll();
        }
    });

    // Ativa automaticamente após 5 segundos
    setTimeout(() => {
        if (!autoScrollAtivo) {
            console.log('🚀 Ativando auto-scroll automaticamente...');
            autoScrollAtivo = true;
            btnAutoScroll.classList.add('active');
            btnAutoScroll.innerHTML = '<i class="fas fa-pause"></i> Pausar';
            iniciarAutoScroll(container);
            console.log('▶️ Auto-scroll iniciado!');
        }
    }, 5000);
}

function iniciarAutoScroll(container) {
    pararAutoScroll();
    let emPausa = false;

    intervaloAutoScroll = setInterval(() => {
        if (!autoScrollAtivo || emPausa) return;

        const abaAtiva = document.querySelector('.tab-button.active')?.getAttribute('data-tab');
        let tbody;

        if (abaAtiva === 'leitos-ocupados') {
            tbody = document.getElementById('tbody-ocupados');
        } else if (abaAtiva === 'leitos-disponiveis') {
            tbody = document.getElementById('tbody-disponiveis');
        } else {
            tbody = document.getElementById('tbody-todos');
        }

        const linhas = tbody?.getElementsByTagName('tr');
        if (!linhas || linhas.length === 0) return;

        const scrollAtual = container.scrollTop;
        let scrollMax;

        if (linhas.length <= CONFIG.limiteLinhas) {
            scrollMax = container.scrollHeight - container.clientHeight;
        } else {
            const linha100 = linhas[CONFIG.limiteLinhas - 1];
            if (!linha100) {
                scrollMax = container.scrollHeight - container.clientHeight;
            } else {
                const posicaoLinha100 = linha100.offsetTop + linha100.offsetHeight;
                scrollMax = posicaoLinha100 - container.clientHeight + 50;
            }
        }

        if (scrollAtual >= scrollMax - 10) {
            emPausa = true;
            setTimeout(() => {
                if (autoScrollAtivo) {
                    container.scrollTop = 0;
                    setTimeout(() => {
                        emPausa = false;
                        console.log('▶️ Reiniciando auto-scroll...');
                    }, 5000);
                }
            }, CONFIG.pausaNaLinha100);
            return;
        }

        container.scrollTop += CONFIG.velocidadeScroll;
    }, 50);
}

function pararAutoScroll() {
    if (intervaloAutoScroll) {
        clearInterval(intervaloAutoScroll);
        intervaloAutoScroll = null;
    }
}

// ========================================
// ❌ TRATAMENTO DE ERROS
// ========================================

function mostrarErro(mensagem) {
    console.error('❌', mensagem);
    alert(mensagem);
}