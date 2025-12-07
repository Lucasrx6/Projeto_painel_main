// ========================================
// 📊 CONFIGURAÇÃO DO DASHBOARD COMPACTO
// ========================================

const BASE_URL = window.location.origin;

const CONFIG = {
    apiDashboard: `${BASE_URL}/api/paineis/painel4/dashboard`,
    apiSetores: `${BASE_URL}/api/paineis/painel4/setores`,
    intervaloRefresh: 30000
};

// ========================================
// 🚀 INICIALIZAÇÃO
// ========================================

function inicializar() {
    console.log('🚀 Inicializando dashboard compacto...');

    configurarBotoes();
    carregarDados();

    // Auto-refresh
    setInterval(carregarDados, CONFIG.intervaloRefresh);

    console.log('✅ Dashboard inicializado!');
}

function configurarBotoes() {
    document.getElementById('btn-voltar')?.addEventListener('click', () => {
        window.location.href = '/frontend/dashboard.html';
    });

    document.getElementById('btn-detalhes')?.addEventListener('click', () => {
        window.location.href = '/painel/painel4/detalhes';
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
    document.getElementById('total-leitos').textContent =
        parseInt(dados.total_leitos) || 0;

    document.getElementById('leitos-ocupados').textContent =
        parseInt(dados.leitos_ocupados) || 0;

    document.getElementById('leitos-livres').textContent =
        parseInt(dados.leitos_livres) || 0;

    document.getElementById('leitos-higienizacao').textContent =
        parseInt(dados.leitos_higienizacao) || 0;

    document.getElementById('leitos-interditados').textContent =
        parseInt(dados.leitos_interditados) || 0;

    // Taxa de ocupação
    const taxaOcupacao = parseFloat(dados.taxa_ocupacao_geral) || 0;
    document.getElementById('taxa-valor').textContent =
        taxaOcupacao.toFixed(0) + '%';
}

// ========================================
// 🏥 ATUALIZAR CARDS DE SETORES (COMPACTO)
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
                <div class="setor-card-nome">${setor.nm_setor || 'Setor Desconhecido'}</div>
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
// 🚀 START
// ========================================

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', inicializar);
} else {
    inicializar();
}