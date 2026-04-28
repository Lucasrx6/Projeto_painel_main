// ========================================
// PAINEL 4 - OCUPACAO HOSPITALAR
// Dashboard Principal - JavaScript
// ========================================

var BASE_URL = window.location.origin;

var CONFIG = {
    apiDashboard: BASE_URL + '/api/paineis/painel4/dashboard',
    apiSetores: BASE_URL + '/api/paineis/painel4/setores',
    intervaloRefresh: 30000,
    velocidadeScroll: 0.5,
    pausaNoFinal: 2000,
    pausaReinicio: 5000,
    autoScrollDelay: 5000
};

var estado = {
    autoScroll: {
        ativo: false,
        intervalo: null,
        emPausa: false,
        aguardando: false
    }
};

// ========================================
// INICIALIZACAO
// ========================================

function inicializar() {
    console.log('Inicializando dashboard...');

    configurarBotoes();
    carregarDados();

    // Auto-refresh
    setInterval(carregarDados, CONFIG.intervaloRefresh);

    // Auto-scroll apos delay
    setTimeout(function () {
        if (!estado.autoScroll.ativo) {
            ativarAutoScroll();
        }
    }, CONFIG.autoScrollDelay);

    console.log('Dashboard inicializado!');
}

function configurarBotoes() {
    var btnVoltar = document.getElementById('btn-voltar');
    if (btnVoltar) {
        btnVoltar.addEventListener('click', function() {
            window.location.href = '/frontend/dashboard.html';
        });
    }

    var btnDetalhes = document.getElementById('btn-detalhes');
    if (btnDetalhes) {
        btnDetalhes.addEventListener('click', function() {
            window.location.href = '/painel/painel4/detalhes';
        });
    }

    var btnRefresh = document.getElementById('btn-refresh');
    if (btnRefresh) {
        btnRefresh.addEventListener('click', carregarDados);
    }

    var btnScroll = document.getElementById('btn-auto-scroll');
    if (btnScroll) {
        btnScroll.addEventListener('click', toggleAutoScroll);
    }
}

// ========================================
// CARREGAMENTO DE DADOS
// ========================================

function carregarDados() {
    Promise.all([
        fetch(CONFIG.apiDashboard).then(function(r) { return r.json(); }),
        fetch(CONFIG.apiSetores).then(function(r) { return r.json(); })
    ])
    .then(function(resultados) {
        var dashboardData = resultados[0];
        var setoresData = resultados[1];

        if (dashboardData.success) {
            atualizarCards(dashboardData.data);
        }

        if (setoresData.success) {
            atualizarListaSetores(setoresData.data);
        }

        atualizarHoraAtualizacao();
    })
    .catch(function(erro) {
        console.error('Erro ao carregar dados:', erro);
    });
}

// ========================================
// ATUALIZAR CARDS SUPERIORES
// ========================================

function atualizarCards(dados) {
    document.getElementById('total-leitos').textContent =
        parseInt(dados.leitos_fixos) || 0;

    document.getElementById('leitos-ocupados').textContent =
        parseInt(dados.leitos_ocupados) || 0;

    document.getElementById('leitos-livres').textContent =
        parseInt(dados.leitos_livres) || 0;

    document.getElementById('leitos-higienizacao').textContent =
        parseInt(dados.leitos_higienizacao) || 0;

    document.getElementById('leitos-interditados').textContent =
        parseInt(dados.leitos_interditados) || 0;

    // Taxa de ocupacao
    var taxaOcupacao = parseFloat(dados.taxa_ocupacao_geral) || 0;
    document.getElementById('taxa-valor').textContent =
        taxaOcupacao.toFixed(0) + '%';

    // Destaque visual quando taxa > 100% (leitos temporários em uso)
    var cardTaxa = document.getElementById('card-taxa');
    if (cardTaxa) {
        if (taxaOcupacao > 100) {
            cardTaxa.classList.add('taxa-critica');
        } else {
            cardTaxa.classList.remove('taxa-critica');
        }
    }
}

// ========================================
// ATUALIZAR CARDS DE SETORES
// ========================================

function atualizarListaSetores(setores) {
    var container = document.getElementById('lista-setores');

    if (!container) {
        console.warn('Container lista-setores nao encontrado');
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

    // Ordena setores por taxa de ocupacao (decrescente)
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
        var nomeSetorEscapado = nomeSetor.replace(/'/g, "\\'");

        // Define classe baseada na taxa de ocupacao
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
            '<div class="setor-card ' + classeOcupacao + '" onclick="abrirDetalhesSetor(\'' + nomeSetorEscapado + '\')" style="cursor: pointer;">' +
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
// ABRIR DETALHES COM FILTRO
// ========================================

function abrirDetalhesSetor(nomeSetor) {
    var setorCodificado = encodeURIComponent(nomeSetor);
    window.location.href = '/painel/painel4/detalhes?setor=' + setorCodificado;
}

// ========================================
// ATUALIZAR HORA
// ========================================

function atualizarHoraAtualizacao() {
    var agora = new Date();
    var hora = agora.toLocaleTimeString('pt-BR', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
    });

    var elemento = document.querySelector('.ultima-atualizacao');
    if (elemento) {
        elemento.textContent = hora;
    }
}

// ========================================
// AUTO-SCROLL
// ========================================

function toggleAutoScroll() {
    if (estado.autoScroll.ativo) {
        desativarAutoScroll();
    } else {
        ativarAutoScroll();
    }
}

function ativarAutoScroll() {
    estado.autoScroll.ativo = true;
    estado.autoScroll.emPausa = false;
    estado.autoScroll.aguardando = false;

    var btn = document.getElementById('btn-auto-scroll');
    if (btn) {
        btn.classList.add('scroll-active');
        btn.innerHTML = '<i class="fas fa-pause"></i> <span class="btn-text">Pausar</span>';
    }

    iniciarCicloScroll();
}

function desativarAutoScroll() {
    estado.autoScroll.ativo = false;

    if (estado.autoScroll.intervalo) {
        clearInterval(estado.autoScroll.intervalo);
        estado.autoScroll.intervalo = null;
    }

    var btn = document.getElementById('btn-auto-scroll');
    if (btn) {
        btn.classList.remove('scroll-active');
        btn.innerHTML = '<i class="fas fa-play"></i> <span class="btn-text">Auto Scroll</span>';
    }
}

function iniciarCicloScroll() {
    if (estado.autoScroll.intervalo) {
        clearInterval(estado.autoScroll.intervalo);
    }

    // Watchdog para evitar congelamento quando a aba perde o foco
    var lastScrollTop = -1;
    var frozenCount = 0;

    estado.autoScroll.intervalo = setInterval(function () {
        if (!estado.autoScroll.ativo || estado.autoScroll.emPausa || estado.autoScroll.aguardando) {
            return;
        }

        var container = document.querySelector('.dashboard-content');
        if (!container) return;

        var scrollMax = container.scrollHeight - container.clientHeight;

        // Se nao ha barra de rolagem
        if (scrollMax <= 0) return;

        // Verificacao de congelamento
        if (lastScrollTop === container.scrollTop && container.scrollTop > 0 && container.scrollTop < scrollMax - 10) {
            frozenCount++;
            if (frozenCount > 20) { // 1 segundo parado
                container.scrollTop += 1;
                frozenCount = 0;
            }
        } else {
            frozenCount = 0;
        }
        lastScrollTop = container.scrollTop;

        // Chegou no final
        if (container.scrollTop >= scrollMax - 1) {
            estado.autoScroll.emPausa = true;

            setTimeout(function () {
                if (!estado.autoScroll.ativo) return;

                container.scrollTop = 0;
                estado.autoScroll.aguardando = true;

                setTimeout(function () {
                    if (estado.autoScroll.ativo) {
                        estado.autoScroll.aguardando = false;
                        estado.autoScroll.emPausa = false;
                    }
                }, CONFIG.pausaReinicio);

            }, CONFIG.pausaNoFinal);

            return;
        }

        // Scrollar
        container.scrollTop += CONFIG.velocidadeScroll;

    }, 50);
}

// ========================================
// START
// ========================================

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', inicializar);
} else {
    inicializar();
}