const COLUNAS_CONFIG = [
    { campo: 'nr_atendimento', titulo: 'Atend', tipo: 'texto', ordenavel: true },
    { campo: 'nm_paciente', titulo: 'Paciente', tipo: 'texto', ordenavel: true },
    { campo: 'setor', titulo: 'Setor', tipo: 'texto', ordenavel: true },
    { campo: 'unidade', titulo: 'Unidade', tipo: 'texto', ordenavel: true },
    { campo: 'data_turno', titulo: 'Data', tipo: 'dataHora', ordenavel: true },
    { campo: 'turno', titulo: 'Turno', tipo: 'texto', ordenavel: true },
    { campo: 'evol_medico', titulo: 'Méd', tipo: 'status', ordenavel: true },
    { campo: 'evol_enfermeiro', titulo: 'Enf', tipo: 'status', ordenavel: true },
    { campo: 'evol_tec_enfermagem', titulo: 'Téc.Enf.', tipo: 'status', ordenavel: true },
    { campo: 'evol_nutricionista', titulo: 'Nutri', tipo: 'status', ordenavel: true },
    { campo: 'evol_fisioterapeuta', titulo: 'Fisio', tipo: 'status', ordenavel: true }
];

const BASE_URL = window.location.origin;

const CONFIG = {
    apiUrl: `${BASE_URL}/api/paineis/painel2/evolucoes`,
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
let autoScrollAtivo = false;
let intervaloAutoScroll = null;

function formatarData(data) {
    if (!data) return '-';

    try {
        const d = new Date(data);

        if (isNaN(d.getTime())) {
            return data;
        }

        return d.toLocaleDateString('pt-BR');
    } catch (erro) {
        console.error('Erro ao formatar data:', erro);
        return data;
    }
}

function formatarDataHora(data) {
    if (!data) return '-';

    try {
        const d = new Date(data);

        if (isNaN(d.getTime())) {
            return data;
        }

        // Formata para DD/MM/YYYY HH:MM:SS
        const dia = String(d.getDate()).padStart(2, '0');
        const mes = String(d.getMonth() + 1).padStart(2, '0');
        const ano = d.getFullYear();
        const hora = String(d.getHours()).padStart(2, '0');
        const minuto = String(d.getMinutes()).padStart(2, '0');
        const segundo = String(d.getSeconds()).padStart(2, '0');

        return `${dia}/${mes}/${ano}`;
    } catch (erro) {
        console.error('Erro ao formatar data/hora:', erro);
        return data;
    }
}

function formatarStatus(valor) {
    if (!valor) {
        return '<span class="badge-status status-pendente">Pendente</span>';
    }

    const valorLower = String(valor).toLowerCase().trim();

    if (valorLower === 'feito' || valorLower === 's') {
        return '<i class="fa-solid fa-check icon-check"></i>';
    }
    else if (valorLower === 'não feita' || valorLower === 'nao feita' || valorLower === 'n' || valorLower === 'x') {
        return '<img width="24" height="24" src="https://img.icons8.com/color/48/close-window.png" alt="não feita" class="icon-close"/>';
    }
    else {
        return '<span class="badge-status status-pendente">' + valor + '</span>';
    }
}

function formatarCampo(valor, tipo) {
    if (valor === null || valor === undefined) return '-';

    switch (tipo) {
        case 'data':
            return formatarData(valor);
        case 'dataHora':
            return formatarDataHora(valor);
        case 'status':
            return formatarStatus(valor);
        case 'numero':
            return valor || '-';
        default:
            return valor || '-';
    }
}

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

function ordenarPorColuna(campo, tipo) {
    if (estadoOrdenacao.campo === campo) {
        estadoOrdenacao.direcao = estadoOrdenacao.direcao === 'asc' ? 'desc' : 'asc';
    } else {
        estadoOrdenacao.campo = campo;
        estadoOrdenacao.direcao = 'asc';
    }

    dadosAtuais.sort((a, b) => {
        let valorA = a[campo];
        let valorB = b[campo];

        if (valorA === null || valorA === undefined) valorA = '';
        if (valorB === null || valorB === undefined) valorB = '';

        if (tipo === 'data' || tipo === 'dataHora') {
            valorA = new Date(valorA).getTime();
            valorB = new Date(valorB).getTime();
        } else if (tipo === 'numero') {
            valorA = parseFloat(valorA) || 0;
            valorB = parseFloat(valorB) || 0;
        } else if (tipo === 'status') {
            const ordemStatus = { 'S': 3, 'FEITA': 3, '': 2, 'N': 1, 'NÃO FEITA': 1 };
            valorA = ordemStatus[String(valorA).toUpperCase()] || 2;
            valorB = ordemStatus[String(valorB).toUpperCase()] || 2;
        } else {
            valorA = String(valorA).toLowerCase();
            valorB = String(valorB).toLowerCase();
        }

        let resultado = 0;
        if (valorA < valorB) resultado = -1;
        if (valorA > valorB) resultado = 1;

        return estadoOrdenacao.direcao === 'asc' ? resultado : -resultado;
    });

    atualizarTabela(dadosAtuais);
    atualizarIconesOrdenacao();
}

function criarLinha(registro) {
    const tr = document.createElement('tr');

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

async function carregarDados() {
    try {
        const response = await fetch(CONFIG.apiUrl);

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const resultado = await response.json();

        if (resultado.success) {
            dadosAtuais = resultado.data;

            if (estadoOrdenacao.campo) {
                const coluna = COLUNAS_CONFIG.find(c => c.campo === estadoOrdenacao.campo);
                if (coluna) {
                    ordenarPorColuna(estadoOrdenacao.campo, coluna.tipo);
                }
            } else {
                atualizarTabela(dadosAtuais);
            }

            atualizarEstatisticas(resultado.total);
        } else {
            mostrarErro(resultado.error || 'Erro desconhecido');
        }

    } catch (erro) {
        console.error('Erro ao carregar dados:', erro);
        mostrarErro(erro.message);
    }
}

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

function inicializar() {
    console.log('🚀 Inicializando painel...');
    criarCabecalho();
    configurarBotaoVoltar();
    carregarDados();

    setTimeout(() => {
        configurarAutoScroll();
    }, 500);

    setInterval(carregarDados, CONFIG.intervaloRefresh);
    console.log('✅ Painel inicializado com sucesso!');
}

function configurarBotaoVoltar() {
    const btnVoltar = document.getElementById('btn-voltar');

    if (btnVoltar) {
        btnVoltar.addEventListener('click', () => {
            window.location.href = '/frontend/dashboard.html';
        });
    }
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', inicializar);
} else {
    inicializar();
}