// ========================================
// 📊 PAINEL 12 - OCUPAÇÃO E PRODUÇÃO HAC
// ========================================

const BASE_URL = window.location.origin;

const CONFIG = {
    apiDashboard: `${BASE_URL}/api/paineis/painel12/dashboard`,
    apiSetores: `${BASE_URL}/api/paineis/painel12/setores`,
    intervaloRefresh: 30000
};

// ========================================
// 🚀 INICIALIZAÇÃO
// ========================================

function inicializar() {
    console.log('🚀 Inicializando Painel 12...');

    configurarBotoes();
    carregarDados();

    // Auto-refresh a cada 30 segundos
    setInterval(carregarDados, CONFIG.intervaloRefresh);

    console.log('✅ Painel 12 inicializado!');
}

function configurarBotoes() {
    document.getElementById('btn-voltar')?.addEventListener('click', () => {
        window.location.href = '/frontend/dashboard.html';
    });

    document.getElementById('btn-refresh')?.addEventListener('click', carregarDados);
}

// ========================================
// 📊 CARREGAMENTO DE DADOS
// ========================================

async function carregarDados() {
    try {
        const [dashboardRes, setoresRes] = await Promise.all([
            fetch(CONFIG.apiDashboard),
            fetch(CONFIG.apiSetores)
        ]);

        if (!dashboardRes.ok || !setoresRes.ok) {
            throw new Error('Erro ao carregar dados');
        }

        const dashboardData = await dashboardRes.json();
        const setoresData = await setoresRes.json();

        if (dashboardData.success && setoresData.success) {
            atualizarCards(dashboardData.data);
            atualizarListaSetores(setoresData.data);
            atualizarHoraAtualizacao();
        } else {
            console.error('Erro nos dados:', dashboardData, setoresData);
        }

    } catch (erro) {
        console.error('Erro ao carregar dados:', erro);
    }
}

// ========================================
// 💳 ATUALIZAR CARDS SUPERIORES (6 CARDS)
// ========================================

function atualizarCards(dados) {
    // Card 1: Total Leitos
    document.getElementById('total-leitos').textContent =
        parseInt(dados.total_leitos) || 0;

    // Card 2: Leitos Ocupados
    document.getElementById('leitos-ocupados').textContent =
        parseInt(dados.leitos_ocupados) || 0;

    // Card 3: Taxa de Ocupação
    const taxaOcupacao = parseFloat(dados.taxa_ocupacao) || 0;
    document.getElementById('taxa-valor').textContent =
        taxaOcupacao.toFixed(0) + '%';

    // Card 4: PS Atendimentos
    const psAtendimentos = parseInt(dados.ps_atendimentos_mes) || 0;
    const psMedia = parseInt(dados.ps_media_dia) || 0;
    document.getElementById('ps-atendimentos').textContent = psAtendimentos.toLocaleString('pt-BR');
    document.getElementById('ps-subtitle').textContent = `Média: ${psMedia}/dia`;

    // Card 5: Conversão PS
    const conversoes = parseInt(dados.conversoes_mes) || 0;
    const percentualConversao = parseFloat(dados.conversoes_percentual) || 0;
    document.getElementById('conversao-qtd').textContent = conversoes;
    document.getElementById('conversao-percentual').textContent = `${percentualConversao.toFixed(1)}%`;

    // Card 6: Produção + Projeção
    const producao = parseFloat(dados.producao_mes) || 0;
    const projecao = parseFloat(dados.projecao_mes) || 0;

    document.getElementById('producao-valor').textContent =
        formatarMoeda(producao);
    document.getElementById('projecao-valor').textContent =
        `Projeção: ${formatarMoeda(projecao)}`;
}

// ========================================
// 🏥 ATUALIZAR CARDS DE SETORES
// ========================================

function atualizarListaSetores(setores) {
    const container = document.getElementById('lista-setores');

    if (!container) {
        console.warn('Container lista-setores não encontrado');
        return;
    }

    if (!setores || setores.length === 0) {
        container.innerHTML = `
            <div class="loading">
                <i class="fas fa-inbox" style="font-size: 3rem; margin-bottom: 10px; display: block;"></i>
                <p>Nenhum setor encontrado</p>
            </div>
        `;
        return;
    }

    // Ordena setores por taxa de ocupação (decrescente)
    const setoresOrdenados = [...setores].sort((a, b) =>
        (parseFloat(b.taxa_ocupacao) || 0) - (parseFloat(a.taxa_ocupacao) || 0)
    );

    container.innerHTML = setoresOrdenados.map(setor => {
        const taxaOcupacao = parseFloat(setor.taxa_ocupacao) || 0;
        const totalLeitos = parseInt(setor.total_leitos) || 0;
        const ocupados = parseInt(setor.leitos_ocupados) || 0;
        const livres = parseInt(setor.leitos_livres) || 0;
        const nomeSetor = setor.nm_setor || 'Setor Desconhecido';

        // Define classe baseada na taxa de ocupação
        let classeOcupacao = '';
        if (taxaOcupacao < 50) {
            classeOcupacao = 'ocupacao-baixa';
        } else if (taxaOcupacao < 80) {
            classeOcupacao = 'ocupacao-media';
        } else {
            classeOcupacao = 'ocupacao-alta';
        }

        return `
            <div class="setor-card ${classeOcupacao}">
                <div class="setor-card-nome">${nomeSetor}</div>
                <div class="setor-card-taxa">${taxaOcupacao.toFixed(0)}%</div>
                <div class="setor-card-label">Ocupação</div>
                <div class="setor-card-info">
                    <span><i class="fas fa-bed"></i> ${totalLeitos}</span>
                    <span style="color: #dc3545;"><i class="fas fa-user"></i> ${ocupados}</span>
                    <span style="color: #28a745;"><i class="fas fa-check"></i> ${livres}</span>
                </div>
            </div>
        `;
    }).join('');
}

// ========================================
// 🔧 FUNÇÕES AUXILIARES
// ========================================

function formatarMoeda(valor) {
    return new Intl.NumberFormat('pt-BR', {
        style: 'currency',
        currency: 'BRL',
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    }).format(valor);
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

// ========================================
// 🚀 START
// ========================================

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', inicializar);
} else {
    inicializar();
}
