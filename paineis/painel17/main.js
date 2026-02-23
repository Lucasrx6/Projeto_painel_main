// =============================================================================
// PAINEL 17 - TEMPO DE ESPERA DO PRONTO SOCORRO
// Hospital Anchieta Ceilandia
// =============================================================================

var BASE_URL = window.location.origin;

var CONFIG = {
    apiTempos: BASE_URL + '/api/paineis/painel17/tempos',
    intervaloRefresh: 60000
};

// Ordem de exibicao (por volume de atendimentos)
var ORDEM_CLINICAS = [1, 4, 10, 7, 3, 6];

// =============================================================================
// INICIALIZACAO
// =============================================================================

function inicializar() {
    console.log('Inicializando Painel 17...');
    configurarBotoes();
    carregarDados();
    setInterval(carregarDados, CONFIG.intervaloRefresh);
    console.log('Painel 17 inicializado.');
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', inicializar);
} else {
    inicializar();
}

// =============================================================================
// BOTOES
// =============================================================================

function configurarBotoes() {
    var btnVoltar = document.getElementById('btn-voltar');
    if (btnVoltar) {
        btnVoltar.addEventListener('click', function() {
            window.location.href = '/frontend/dashboard.html';
        });
    }

    var btnRefresh = document.getElementById('btn-refresh');
    if (btnRefresh) {
        btnRefresh.addEventListener('click', function() {
            btnRefresh.classList.add('girando');
            carregarDados();
            setTimeout(function() {
                btnRefresh.classList.remove('girando');
            }, 600);
        });
    }
}

// =============================================================================
// CARREGAMENTO
// =============================================================================

function carregarDados() {
    fetch(CONFIG.apiTempos, { credentials: 'include' })
        .then(function(response) { return response.json(); })
        .then(function(data) {
            if (data.success) {
                renderizarClinicas(data.clinicas);
                atualizarTimestamp();

                var indicator = document.getElementById('status-indicator');
                if (indicator) {
                    indicator.className = 'status-indicator status-online';
                }
            }
        })
        .catch(function(err) {
            console.error('Erro ao carregar dados:', err);
            var grid = document.getElementById('clinicas-grid');
            if (grid) {
                grid.innerHTML = '<div class="mensagem-vazia"><i class="fas fa-exclamation-triangle"></i><p>Erro ao carregar dados</p></div>';
            }
        });
}

// =============================================================================
// RENDERIZACAO - CLINICAS
// =============================================================================

function renderizarClinicas(clinicas) {
    var grid = document.getElementById('clinicas-grid');
    if (!grid) return;

    if (!clinicas || clinicas.length === 0) {
        grid.innerHTML = '<div class="mensagem-vazia"><i class="fas fa-clock"></i><p>Nenhuma clinica com dados disponiveis</p></div>';
        return;
    }

    // Ordenar conforme ORDEM_CLINICAS, depois o resto
    var ordenadas = [];
    var restantes = [];

    clinicas.forEach(function(c) {
        var idx = ORDEM_CLINICAS.indexOf(c.cd_clinica);
        if (idx >= 0) {
            ordenadas[idx] = c;
        } else {
            restantes.push(c);
        }
    });

    var lista = [];
    ORDEM_CLINICAS.forEach(function(cd, idx) {
        if (ordenadas[idx]) {
            lista.push(ordenadas[idx]);
        }
    });
    lista = lista.concat(restantes);

    var html = '';

    lista.forEach(function(clinica) {
        var temDados = clinica.mediana !== null && clinica.mediana !== undefined;

        // Nivel de espera
        var nivelClasse = 'nivel-baixo';
        if (temDados) {
            if (clinica.mediana > 40) {
                nivelClasse = 'nivel-alto';
            } else if (clinica.mediana > 20) {
                nivelClasse = 'nivel-medio';
            }
        }

        // Tendencia
        var tendenciaHtml = '';
        if (temDados && clinica.tendencia !== 'sem_dados') {
            var tendClasse = 'tendencia-estavel';
            var tendIcone = 'fa-arrows-left-right';
            var tendTexto = 'Estavel';

            if (clinica.tendencia === 'subindo') {
                tendClasse = 'tendencia-subindo';
                tendIcone = 'fa-arrow-trend-up';
                tendTexto = 'Subindo';
            } else if (clinica.tendencia === 'descendo') {
                tendClasse = 'tendencia-descendo';
                tendIcone = 'fa-arrow-trend-down';
                tendTexto = 'Descendo';
            }

            tendenciaHtml = '<span class="tempo-tendencia ' + tendClasse + '">';
            tendenciaHtml += '<i class="fas ' + tendIcone + '"></i> ' + tendTexto;
            tendenciaHtml += '</span>';
        }

        // Fila (so mostra se > 0)
        var filaHtml = '';
        if (clinica.fila > 0) {
            filaHtml = '<span class="footer-item"><i class="fas fa-users"></i> <strong class="fila-destaque">' + clinica.fila + '</strong> aguardando</span>';
        } else {
            filaHtml = '<span class="footer-item"></span>';
        }

        // Ultimo chamado
        var ultimoTexto = '-';
        if (clinica.ultimo_chamado_min !== null && clinica.ultimo_chamado_min !== undefined) {
            if (clinica.ultimo_chamado_min < 1) {
                ultimoTexto = 'Agora';
            } else if (clinica.ultimo_chamado_min < 60) {
                ultimoTexto = 'ha ' + clinica.ultimo_chamado_min + ' min';
            } else {
                var horas = Math.floor(clinica.ultimo_chamado_min / 60);
                ultimoTexto = 'ha ' + horas + 'h';
            }
        }

        html += '<div class="clinica-card">';

        // Header: nome + medicos (sem icone)
        html += '  <div class="clinica-card-header">';
        html += '    <span class="clinica-nome">' + escapeHtml(clinica.clinica) + '</span>';
        if (clinica.medicos_atendendo > 0) {
            html += '    <span class="clinica-medicos">';
            html += '      <i class="fas fa-user-md"></i> ' + clinica.medicos_atendendo;
            html += '    </span>';
        }
        html += '  </div>';

        // Body: tempo
        html += '  <div class="clinica-card-body">';
        if (temDados) {
            html += '    <div class="tempo-faixa ' + nivelClasse + '">';
            html += '      ' + clinica.faixa_min + ' - ' + clinica.faixa_max + ' min';
            html += '    </div>';
            html += '    <span class="tempo-unidade">tempo estimado de espera</span>';
            html += '    ' + tendenciaHtml;
        } else {
            html += '    <div class="tempo-sem-dados"><i class="fas fa-minus-circle"></i> Sem dados recentes</div>';
        }
        html += '  </div>';

        // Footer
        html += '  <div class="clinica-card-footer">';
        html += '    ' + filaHtml;
        html += '    <span class="footer-item"><i class="fas fa-bell"></i> Ultimo: ' + escapeHtml(ultimoTexto) + '</span>';
        html += '  </div>';

        html += '</div>';
    });

    grid.innerHTML = html;
}

// =============================================================================
// UTILITARIOS
// =============================================================================

function atualizarTimestamp() {
    var el = document.getElementById('ultima-atualizacao');
    if (el) {
        var agora = new Date();
        var h = agora.getHours().toString();
        var m = agora.getMinutes().toString();
        if (h.length < 2) h = '0' + h;
        if (m.length < 2) m = '0' + m;
        el.textContent = h + ':' + m;
    }
}

function escapeHtml(text) {
    if (!text) return '';
    var str = String(text);
    return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}