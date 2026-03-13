// ========================================
// PAINEL 12 - OCUPAÇÃO E PRODUÇÃO HAC
// ========================================

var BASE_URL = window.location.origin;

var CONFIG = {
    apiDashboard: BASE_URL + '/api/paineis/painel12/dashboard',
    apiSetores: BASE_URL + '/api/paineis/painel12/setores',
    intervaloRefresh: 30000
};

// ========================================
// INICIALIZAÇÃO
// ========================================

function inicializar() {
    console.log('Inicializando Painel 12...');

    configurarBotoes();
    carregarDados();

    // Auto-refresh a cada 30 segundos
    setInterval(carregarDados, CONFIG.intervaloRefresh);

    console.log('Painel 12 inicializado!');
}

function configurarBotoes() {
    var btnVoltar = document.getElementById('btn-voltar');
    var btnRefresh = document.getElementById('btn-refresh');

    if (btnVoltar) {
        btnVoltar.addEventListener('click', function() {
            window.location.href = '/frontend/dashboard.html';
        });
    }

    if (btnRefresh) {
        btnRefresh.addEventListener('click', carregarDados);
    }
}

// ========================================
// CARREGAMENTO DE DADOS
// ========================================

function carregarDados() {
    Promise.all([
        fetch(CONFIG.apiDashboard).then(function(r) { return r.json(); }),
        fetch(CONFIG.apiSetores).then(function(r) { return r.json(); })
    ]).then(function(resultados) {
        var dashboardData = resultados[0];
        var setoresData = resultados[1];

        if (dashboardData.success && setoresData.success) {
            atualizarCards(dashboardData.data);
            atualizarListaSetores(setoresData.data);
            atualizarHoraAtualizacao();
        } else {
            console.error('Erro nos dados:', dashboardData, setoresData);
        }
    }).catch(function(erro) {
        console.error('Erro ao carregar dados:', erro);
    });
}

// ========================================
// ATUALIZAR CARDS SUPERIORES
// ========================================

function atualizarCards(dados) {
    // Card 1: Total Leitos
    document.getElementById('total-leitos').textContent =
        parseInt(dados.total_leitos) || 0;

    // Card 2: Leitos Ocupados
    document.getElementById('leitos-ocupados').textContent =
        parseInt(dados.leitos_ocupados) || 0;

    // Card 3: Taxa de Ocupação
    var taxaOcupacao = parseFloat(dados.taxa_ocupacao) || 0;
    document.getElementById('taxa-valor').textContent = taxaOcupacao.toFixed(0) + '%';

    // Destaque visual quando taxa > 100% (leitos temporários em uso)
    var cardTaxa = document.getElementById('card-taxa');
    if (cardTaxa) {
        if (taxaOcupacao > 100) {
            cardTaxa.classList.add('taxa-critica');
        } else {
            cardTaxa.classList.remove('taxa-critica');
        }
    }

    // Card 4: PS Atendimentos
    var psAtendimentos = parseInt(dados.ps_atendimentos_mes) || 0;
    var psMedia = parseInt(dados.ps_media_dia) || 0;
    document.getElementById('ps-atendimentos').textContent = psAtendimentos.toLocaleString('pt-BR');
    document.getElementById('ps-subtitle').textContent = 'Média: ' + psMedia + '/dia';

    // Card 5: Conversão PS
    var conversoes = parseInt(dados.conversoes_mes) || 0;
    var percentualConversao = parseFloat(dados.conversoes_percentual) || 0;
    document.getElementById('conversao-qtd').textContent = 'Conversões: ' + conversoes;
    document.getElementById('conversao-percentual').textContent = percentualConversao.toFixed(1) + '%';

    // Card 6: Cirurgias
    var cirurgias = parseInt(dados.cirurgias_mes) || 0;
    var cirurgiasMedia = parseFloat(dados.cirurgias_media_dia) || 0;
    document.getElementById('cirurgias-qtd').textContent = cirurgias.toLocaleString('pt-BR');
    document.getElementById('cirurgias-subtitle').textContent = 'Média: ' + cirurgiasMedia.toFixed(1) + '/dia';

    // Card 7: Hemodinâmica
    var hemodinamica = parseInt(dados.hemodinamica_mes) || 0;
    var hemodinamicaMedia = parseFloat(dados.hemodinamica_media_dia) || 0;
    document.getElementById('hemodinamica-qtd').textContent = hemodinamica.toLocaleString('pt-BR');
    document.getElementById('hemodinamica-subtitle').textContent = 'Média: ' + hemodinamicaMedia.toFixed(1) + '/dia';

    // Card 8: Produção
    var producao = parseFloat(dados.producao_mes) || 0;
    document.getElementById('producao-valor').textContent = formatarMoeda(producao);

    // Card 9: Projeção
    var projecao = parseFloat(dados.projecao_mes) || 0;
    document.getElementById('projecao-valor').textContent = formatarMoeda(projecao);
}

// ========================================
// ATUALIZAR CARDS DE SETORES
// ========================================

function atualizarListaSetores(setores) {
    var container = document.getElementById('lista-setores');

    if (!container) {
        console.warn('Container lista-setores não encontrado');
        return;
    }

    if (!setores || setores.length === 0) {
        container.innerHTML =
            '<div class="loading">' +
                '<i class="fas fa-inbox" style="font-size: 3rem; margin-bottom: 10px; display: block;"></i>' +
                '<p>Nenhum setor encontrado</p>' +
            '</div>';
        return;
    }

    // Ordena setores por taxa de ocupação (decrescente)
    var setoresOrdenados = setores.slice().sort(function(a, b) {
        return (parseFloat(b.taxa_ocupacao) || 0) - (parseFloat(a.taxa_ocupacao) || 0);
    });

    var html = '';
    for (var i = 0; i < setoresOrdenados.length; i++) {
        var setor = setoresOrdenados[i];
        var taxaOcupacao = parseFloat(setor.taxa_ocupacao) || 0;
        var leitosFixos = parseInt(setor.leitos_fixos) || 0;
        var leitosTemp = parseInt(setor.leitos_temporarios) || 0;
        var ocupados = parseInt(setor.leitos_ocupados) || 0;
        var livres = parseInt(setor.leitos_livres) || 0;
        var nomeSetor = setor.nm_setor || 'Setor Desconhecido';

        // Define classe baseada na taxa de ocupação
        var classeOcupacao = '';
        if (taxaOcupacao > 100) {
            classeOcupacao = 'ocupacao-critica';
        } else if (taxaOcupacao >= 80) {
            classeOcupacao = 'ocupacao-alta';
        } else if (taxaOcupacao >= 50) {
            classeOcupacao = 'ocupacao-media';
        } else {
            classeOcupacao = 'ocupacao-baixa';
        }

        // Badge de temporários no setor
        var tempBadge = '';
        if (leitosTemp > 0) {
            tempBadge =
                '<span class="setor-temp-badge" title="' + leitosTemp + ' leito(s) temporário(s)">' +
                    '<i class="fas fa-plus-circle"></i> ' + leitosTemp + ' temp' +
                '</span>';
        }

        html +=
            '<div class="setor-card ' + classeOcupacao + '">' +
                '<div class="setor-card-nome">' + nomeSetor + '</div>' +
                tempBadge +
                '<div class="setor-card-taxa">' + taxaOcupacao.toFixed(0) + '%</div>' +
                '<div class="setor-card-label">Ocupação</div>' +
                '<div class="setor-card-info">' +
                    '<span title="Leitos fixos"><i class="fas fa-bed"></i> ' + leitosFixos + '</span>' +
                    '<span style="color: #dc3545;" title="Ocupados"><i class="fas fa-user"></i> ' + ocupados + '</span>' +
                    '<span style="color: #28a745;" title="Livres"><i class="fas fa-check"></i> ' + livres + '</span>' +
                '</div>' +
            '</div>';
    }

    container.innerHTML = html;
}

// ========================================
// FUNÇÕES AUXILIARES
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
    var agora = new Date();
    var hora = agora.toLocaleTimeString('pt-BR', {
        hour: '2-digit',
        minute: '2-digit'
    });

    var elemento = document.querySelector('.ultima-atualizacao');
    if (elemento) {
        elemento.textContent = hora;
    }
}

// ========================================
// START
// ========================================

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', inicializar);
} else {
    inicializar();
}