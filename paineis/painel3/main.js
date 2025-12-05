// ========================================
// 📋 CONFIGURAÇÃO DO PAINEL 3 (SEM FILTROS)
// ========================================

// NOTA: Adapte as COLUNAS_CONFIG de acordo com seu painel
const COLUNAS_CONFIG = [
    // Exemplo - ajuste conforme sua necessidade
    { campo: 'consultorio', titulo: 'Consultório', tipo: 'texto', ordenavel: true },
    { campo: 'ds_usuario', titulo: 'Médico', tipo: 'texto', ordenavel: true },
    { campo: 'especialidade', titulo: 'Especialidade', tipo: 'badge', ordenavel: true },
    { campo: 'tempo_conectado', titulo: 'Login', tipo: 'hora', ordenavel: true }
];

const BASE_URL = window.location.origin;

const CONFIG = {
    apiUrl: `${BASE_URL}/api/paineis/painel3/medicos`, // Ajuste sua URL
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

// ========================================
// 🎨 FORMATAÇÃO DE DADOS
// ========================================

function formatarHora(hora) {
    if (!hora) return '-';
    try {
        const d = new Date(hora);
        if (isNaN(d.getTime())) return hora;
        return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    } catch (erro) {
        console.error('Erro ao formatar hora:', erro);
        return hora;
    }
}

function formatarBadge(valor) {
    if (!valor) return '-';

    const valorUpper = String(valor).toUpperCase();

    if (valorUpper === 'LOGADO') {
        return '<span class="badge-status status-logado">Logado</span>';
    } else if (valorUpper === 'DESLOGADO') {
        return '<span class="badge-status status-deslogado">Deslogado</span>';
    }

    return '<span class="badge-status">' + valor + '</span>';
}

function formatarCampo(valor, tipo) {
    if (valor === null || valor === undefined) return '-';

    switch (tipo) {
        case 'hora':
            return formatarHora(valor);
        case 'badge':
            return formatarBadge(valor);
        case 'numero':
            return valor || '0';
        default:
            return valor || '-';
    }
}

// ========================================
// 📊 TABELA
// ========================================

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

        if (tipo === 'numero') {
            valorA = parseFloat(valorA) || 0;
            valorB = parseFloat(valorB) || 0;
        } else if (tipo === 'hora') {
            valorA = new Date(valorA).getTime();
            valorB = new Date(valorB).getTime();
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

function atualizarEstatisticas(total, logados) {
    document.getElementById('total-registros').textContent = total;
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

// ========================================
// 📊 CARREGAMENTO DE DADOS (SEM FILTROS)
// ========================================

async function carregarDados() {
    try {
        const response = await fetch(CONFIG.apiUrl);

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const resultado = await response.json();

        if (resultado.success) {
            dadosAtuais = resultado.data;

            // Contar logados
            const totalLogados = dadosAtuais.filter(r =>
                String(r.status).toUpperCase() === 'LOGADO'
            ).length;

            // Reaplicar ordenação se houver
            if (estadoOrdenacao.campo) {
                const coluna = COLUNAS_CONFIG.find(c => c.campo === estadoOrdenacao.campo);
                if (coluna) {
                    ordenarPorColuna(estadoOrdenacao.campo, coluna.tipo);
                }
            } else {
                atualizarTabela(dadosAtuais);
            }

            atualizarEstatisticas(dadosAtuais.length, totalLogados);

        } else {
            mostrarErro(resultado.error || 'Erro desconhecido');
        }

    } catch (erro) {
        console.error('Erro ao carregar dados:', erro);
        mostrarErro(erro.message);
    }
}

// ========================================
// 🎬 AUTO SCROLL
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

    // Ativar auto-scroll automaticamente após 5 segundos
    setTimeout(() => {
        if (!autoScrollAtivo) {
            console.log('🚀 Ativando auto-scroll automaticamente...');
            autoScrollAtivo = true;
            btnAutoScroll.classList.add('active');
            btnAutoScroll.innerHTML = '<i class="fas fa-pause"></i> Pausar';
            iniciarAutoScroll(container);
            console.log('▶️ Auto-scroll iniciado automaticamente!');
        }
    }, 5000);
}

function iniciarAutoScroll(container) {
    pararAutoScroll();
    let emPausa = false;

    intervaloAutoScroll = setInterval(() => {
        if (!autoScrollAtivo || emPausa) return;

        const tbody = document.getElementById('tabela-body');
        const linhas = tbody.getElementsByTagName('tr');
        if (linhas.length === 0) return;

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

                    // Aguardar 5 segundos antes de recomeçar
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
// 🚀 INICIALIZAÇÃO
// ========================================

function configurarBotaoVoltar() {
    const btnVoltar = document.getElementById('btn-voltar');
    if (btnVoltar) {
        btnVoltar.addEventListener('click', () => {
            window.location.href = '/frontend/dashboard.html';
        });
    }
}

function inicializar() {
    console.log('🚀 Inicializando Painel 3 (sem filtros)...');
    criarCabecalho();
    configurarBotaoVoltar();
    carregarDados();

    setTimeout(() => {
        configurarAutoScroll();
    }, 500);

    // Auto-refresh a cada 30s
    setInterval(carregarDados, CONFIG.intervaloRefresh);
    console.log('✅ Painel 3 inicializado com sucesso!');
    console.log('🔄 Auto-refresh: 30s');
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', inicializar);
} else {
    inicializar();
}