const COLUNAS_CONFIG = [
    { campo: 'consultorio', titulo: 'Consultório', tipo: 'texto', ordenavel: true },
    { campo: 'nome_medico', titulo: 'Médico', tipo: 'texto', ordenavel: true },
    { campo: 'crm', titulo: 'CRM', tipo: 'texto', ordenavel: true },
    { campo: 'especialidade', titulo: 'Especialidade', tipo: 'texto', ordenavel: true },
    { campo: 'status', titulo: 'Status', tipo: 'statusMedico', ordenavel: true },
    { campo: 'data_login', titulo: 'Login', tipo: 'dataHora', ordenavel: true },
    { campo: 'tempo_logado', titulo: 'Tempo', tipo: 'tempo', ordenavel: false }
];

const BASE_URL = window.location.origin;

const CONFIG = {
    apiUrl: `${BASE_URL}/api/paineis/painel3/medicos`,
    intervaloRefresh: 30000,
    velocidadeScroll: 0.5,
    limiteLinhas: 30,
    pausaNaLinha100: 2000
};

let estadoOrdenacao = {
    campo: null,
    direcao: 'asc'
};

let dadosAtuais = [];
let dadosFiltrados = [];
let autoScrollAtivo = false;
let intervaloAutoScroll = null;

// ===== FORMATAÇÃO =====

function formatarDataHora(data) {
    if (!data) return '-';

    try {
        const d = new Date(data);

        if (isNaN(d.getTime())) {
            return data;
        }

        const dia = String(d.getDate()).padStart(2, '0');
        const mes = String(d.getMonth() + 1).padStart(2, '0');
        const ano = d.getFullYear();
        const hora = String(d.getHours()).padStart(2, '0');
        const minuto = String(d.getMinutes()).padStart(2, '0');

        return `${dia}/${mes}/${ano} ${hora}:${minuto}`;
    } catch (erro) {
        console.error('Erro ao formatar data/hora:', erro);
        return data;
    }
}

function formatarTempo(minutos) {
    if (!minutos || minutos <= 0) return '-';

    const horas = Math.floor(minutos / 60);
    const mins = minutos % 60;

    if (horas > 0) {
        return `${horas}h ${mins}m`;
    }
    return `${mins}m`;
}

function formatarStatusMedico(valor) {
    if (!valor) {
        return '<span class="badge-status status-desconhecido">Desconhecido</span>';
    }

    const valorUpper = String(valor).toUpperCase().trim();

    if (valorUpper === 'LOGADO') {
        return '<span class="badge-status status-logado"><i class="fas fa-circle"></i> Logado</span>';
    }
    else if (valorUpper === 'DESLOGADO') {
        return '<span class="badge-status status-deslogado"><i class="fas fa-circle"></i> Deslogado</span>';
    }
    else {
        return '<span class="badge-status status-desconhecido">' + valor + '</span>';
    }
}

function formatarCampo(valor, tipo) {
    if (valor === null || valor === undefined) return '-';

    switch (tipo) {
        case 'dataHora':
            return formatarDataHora(valor);
        case 'statusMedico':
            return formatarStatusMedico(valor);
        case 'tempo':
            return formatarTempo(valor);
        default:
            return valor || '-';
    }
}

// ===== FILTROS =====

function popularFiltros() {
    const consultoriosUnicos = [...new Set(dadosAtuais.map(item => item.consultorio).filter(Boolean))];
    consultoriosUnicos.sort();

    const selectConsultorio = document.getElementById('filtro-consultorio');
    selectConsultorio.innerHTML = '<option value="">Todos os Consultórios</option>';

    consultoriosUnicos.forEach(consultorio => {
        const option = document.createElement('option');
        option.value = consultorio;
        option.textContent = consultorio;
        selectConsultorio.appendChild(option);
    });
}

function aplicarFiltros() {
    const consultorioSelecionado = document.getElementById('filtro-consultorio').value.toUpperCase();
    const statusSelecionado = document.getElementById('filtro-status').value.toUpperCase();

    dadosFiltrados = dadosAtuais.filter(registro => {
        const consultorioMatch = !consultorioSelecionado ||
                                (registro.consultorio && registro.consultorio.toUpperCase() === consultorioSelecionado);

        const statusMatch = !statusSelecionado ||
                          (registro.status && registro.status.toUpperCase() === statusSelecionado);

        return consultorioMatch && statusMatch;
    });

    if (estadoOrdenacao.campo) {
        const coluna = COLUNAS_CONFIG.find(c => c.campo === estadoOrdenacao.campo);
        if (coluna) {
            ordenarDados(dadosFiltrados, estadoOrdenacao.campo, coluna.tipo);
        }
    }

    atualizarTabela(dadosFiltrados);
    document.getElementById('total-filtrados').textContent = dadosFiltrados.length;

    const logados = dadosFiltrados.filter(r => r.status && r.status.toUpperCase() === 'LOGADO').length;
    document.getElementById('total-logados').textContent = logados;
}

function limparFiltros() {
    document.getElementById('filtro-consultorio').value = '';
    document.getElementById('filtro-status').value = '';
    aplicarFiltros();
}

// ===== TABELA =====

function criarCabecalho() {
    const thead = document.getElementById('tabela-head');
    const tr = document.createElement('tr');

    COLUNAS_CONFIG.forEach(coluna => {
        const th = document.createElement('th');

        if (coluna.ordenavel) {
            th.classList.add('ordenavel');
            th.style.cursor = 'pointer';
            th.onclick = () => ordenarPorColuna(coluna.campo, coluna.tipo);

            const span = document.createElement('span');
            span.textContent = coluna.titulo;
            th.appendChild(span);

            const icon = document.createElement('i');
            icon.className = 'fas fa-sort sort-icon';
            icon.id = `sort-${coluna.campo}`;
            th.appendChild(icon);
        } else {
            th.textContent = coluna.titulo;
        }

        tr.appendChild(th);
    });

    thead.appendChild(tr);
}

function atualizarIconesOrdenacao() {
    document.querySelectorAll('.sort-icon').forEach(icon => {
        icon.className = 'fas fa-sort sort-icon';
    });

    if (estadoOrdenacao.campo) {
        const icon = document.getElementById(`sort-${estadoOrdenacao.campo}`);
        if (icon) {
            icon.className = estadoOrdenacao.direcao === 'asc'
                ? 'fas fa-sort-up sort-icon active'
                : 'fas fa-sort-down sort-icon active';
        }
    }
}

function ordenarDados(dados, campo, tipo) {
    dados.sort((a, b) => {
        let valorA = a[campo];
        let valorB = b[campo];

        if (valorA === null || valorA === undefined) valorA = '';
        if (valorB === null || valorB === undefined) valorB = '';

        if (tipo === 'dataHora') {
            valorA = new Date(valorA).getTime();
            valorB = new Date(valorB).getTime();
        } else if (tipo === 'statusMedico') {
            const ordemStatus = { 'LOGADO': 2, 'DESLOGADO': 1, '': 0 };
            valorA = ordemStatus[String(valorA).toUpperCase()] || 0;
            valorB = ordemStatus[String(valorB).toUpperCase()] || 0;
        } else {
            valorA = String(valorA).toLowerCase();
            valorB = String(valorB).toLowerCase();
        }

        let resultado = 0;
        if (valorA < valorB) resultado = -1;
        if (valorA > valorB) resultado = 1;

        return estadoOrdenacao.direcao === 'asc' ? resultado : -resultado;
    });
}

function ordenarPorColuna(campo, tipo) {
    if (estadoOrdenacao.campo === campo) {
        estadoOrdenacao.direcao = estadoOrdenacao.direcao === 'asc' ? 'desc' : 'asc';
    } else {
        estadoOrdenacao.campo = campo;
        estadoOrdenacao.direcao = 'asc';
    }

    ordenarDados(dadosFiltrados, campo, tipo);
    atualizarTabela(dadosFiltrados);
    atualizarIconesOrdenacao();
}

function criarLinha(registro) {
    const tr = document.createElement('tr');

    // Adiciona classe especial para médicos logados
    if (registro.status && registro.status.toUpperCase() === 'LOGADO') {
        tr.classList.add('linha-logado');
    }

    COLUNAS_CONFIG.forEach(coluna => {
        const td = document.createElement('td');
        td.innerHTML = formatarCampo(registro[coluna.campo], coluna.tipo);
        tr.appendChild(td);
    });

    return tr;
}

function atualizarTabela(dados) {
    const tbody = document.getElementById('tabela-body');
    tbody.innerHTML = '';

    if (!dados || dados.length === 0) {
        const tr = document.createElement('tr');
        const td = document.createElement('td');
        td.colSpan = COLUNAS_CONFIG.length;
        td.className = 'text-center text-muted';
        td.style.padding = '60px';
        td.textContent = 'Nenhum registro encontrado';
        tr.appendChild(td);
        tbody.appendChild(tr);
        return;
    }

    dados.forEach(registro => {
        tbody.appendChild(criarLinha(registro));
    });
}

function atualizarEstatisticas(total) {
    document.getElementById('total-registros').textContent = total;
    document.getElementById('total-filtrados').textContent = dadosFiltrados.length;

    const logados = dadosAtuais.filter(r => r.status && r.status.toUpperCase() === 'LOGADO').length;
    document.getElementById('total-logados').textContent = logados;

    document.getElementById('ultima-atualizacao').textContent =
        new Date().toLocaleTimeString('pt-BR');
}

function mostrarErro(mensagem) {
    const tbody = document.getElementById('tabela-body');
    tbody.innerHTML = `
        <tr>
            <td colspan="${COLUNAS_CONFIG.length}">
                <div class="error">
                    <strong>❌ Erro ao carregar dados:</strong><br>
                    ${mensagem}
                </div>
            </td>
        </tr>
    `;
}

// ===== API =====

async function carregarDados() {
    try {
        const response = await fetch(CONFIG.apiUrl);

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const resultado = await response.json();

        if (resultado.success) {
            dadosAtuais = resultado.data;
            popularFiltros();
            aplicarFiltros();
            atualizarEstatisticas(resultado.total);
        } else {
            mostrarErro(resultado.error || 'Erro desconhecido');
        }

    } catch (erro) {
        console.error('Erro ao carregar dados:', erro);
        mostrarErro(erro.message);
    }
}

// ===== AUTO SCROLL =====

function configurarAutoScroll() {
    const btnAutoScroll = document.getElementById('btn-auto-scroll');

    if (!btnAutoScroll) {
        console.error('❌ Botão auto-scroll não encontrado!');
        return;
    }

    const container = document.querySelector('.table-container');

    if (!container) {
        console.error('❌ Container da tabela não encontrado!');
        return;
    }

    console.log('✅ Configurando auto-scroll...');

    btnAutoScroll.addEventListener('click', () => {
        autoScrollAtivo = !autoScrollAtivo;

        if (autoScrollAtivo) {
            btnAutoScroll.classList.add('active');
            btnAutoScroll.innerHTML = '<i class="fas fa-pause"></i> Pausar Scroll';
            iniciarAutoScroll(container);
            console.log('▶️ Auto-scroll ativado');
        } else {
            btnAutoScroll.classList.remove('active');
            btnAutoScroll.innerHTML = '<i class="fas fa-play"></i> Auto Scroll';
            pararAutoScroll();
            console.log('⏸️ Auto-scroll pausado');
        }
    });
}

function iniciarAutoScroll(container) {
    pararAutoScroll();

    let emPausa = false;

    intervaloAutoScroll = setInterval(() => {
        if (!autoScrollAtivo || emPausa) {
            return;
        }

        const tbody = document.getElementById('tabela-body');
        const linhas = tbody.getElementsByTagName('tr');

        if (linhas.length === 0) {
            return;
        }

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
            console.log('⏸️ Pausando na linha ' + CONFIG.limiteLinhas + '...');

            setTimeout(() => {
                if (autoScrollAtivo) {
                    container.scrollTop = 0;
                    console.log('🔄 Resetando para o topo...');
                    emPausa = false;
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

// ===== INICIALIZAÇÃO =====

function configurarBotaoVoltar() {
    const btnVoltar = document.getElementById('btn-voltar');

    if (btnVoltar) {
        btnVoltar.addEventListener('click', () => {
            window.location.href = '/frontend/dashboard.html';
        });
    }
}

function configurarFiltros() {
    document.getElementById('filtro-consultorio').addEventListener('change', aplicarFiltros);
    document.getElementById('filtro-status').addEventListener('change', aplicarFiltros);
    document.getElementById('btn-limpar-filtros').addEventListener('click', limparFiltros);
}

function inicializar() {
    console.log('🚀 Inicializando painel Médicos PS...');
    criarCabecalho();
    configurarBotaoVoltar();
    configurarFiltros();
    carregarDados();

    setTimeout(() => {
        configurarAutoScroll();
    }, 500);

    setInterval(carregarDados, CONFIG.intervaloRefresh);
    console.log('✅ Painel Médicos PS inicializado com sucesso!');
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', inicializar);
} else {
    inicializar();
}