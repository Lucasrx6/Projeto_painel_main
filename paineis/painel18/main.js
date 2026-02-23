// =============================================================================
// PAINEL 18 - PRODUTIVIDADE MEDICA DO PS
// Hospital Anchieta Ceilandia
// =============================================================================

var BASE_URL = window.location.origin;

var CONFIG = {
    apiMedicos: BASE_URL + '/api/paineis/painel18/medicos',
    apiRanking: BASE_URL + '/api/paineis/painel18/ranking',
    apiStats: BASE_URL + '/api/paineis/painel18/stats',
    intervaloRefresh: 60000,
    velocidadeScroll: 0.5,
    pausaFinal: 8000,
    pausaAposReset: 5000,
    watchdogInterval: 5000
};

// Estado global
var autoScrollAtivo = false;
var intervaloAutoScroll = null;
var intervaloWatchdog = null;
var clinicaSelecionada = localStorage.getItem('painel18_clinica') || '';
var ultimaPosicaoScroll = 0;
var contadorTravamento = 0;

// =============================================================================
// INICIALIZACAO
// =============================================================================

function inicializar() {
    console.log('Inicializando Painel 18...');
    configurarBotoes();
    carregarTudo();
    setInterval(carregarTudo, CONFIG.intervaloRefresh);
    console.log('Painel 18 inicializado.');
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', inicializar);
} else {
    inicializar();
}

// =============================================================================
// CONFIGURACAO DE BOTOES E FILTROS
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
            carregarTudo();
            setTimeout(function() {
                btnRefresh.classList.remove('girando');
            }, 600);
        });
    }

    var btnAutoScroll = document.getElementById('btn-auto-scroll');
    if (btnAutoScroll) {
        btnAutoScroll.addEventListener('click', function() {
            autoScrollAtivo = !autoScrollAtivo;
            if (autoScrollAtivo) {
                btnAutoScroll.classList.add('ativo');
                btnAutoScroll.innerHTML = '<i class="fas fa-pause"></i> <span class="btn-text">Pausar</span>';
                iniciarAutoScroll();
            } else {
                btnAutoScroll.classList.remove('ativo');
                btnAutoScroll.innerHTML = '<i class="fas fa-play"></i> <span class="btn-text">Auto Scroll</span>';
                pararAutoScroll();
            }
        });
    }

    // Filtro de clinica (aplica apenas ao ranking)
    var filtroClinica = document.getElementById('filtro-clinica');
    if (filtroClinica) {
        filtroClinica.value = clinicaSelecionada;
        filtroClinica.addEventListener('change', function() {
            clinicaSelecionada = filtroClinica.value;
            localStorage.setItem('painel18_clinica', clinicaSelecionada);
            // Recarrega apenas o ranking (unica secao filtrada)
            carregarRanking();
        });
    }
}

// =============================================================================
// CARREGAMENTO DE DADOS
// =============================================================================

function montarUrlRanking(baseUrl) {
    if (clinicaSelecionada) {
        return baseUrl + '?clinica=' + encodeURIComponent(clinicaSelecionada);
    }
    return baseUrl;
}

function carregarTudo() {
    carregarStats();
    carregarMedicos();
    carregarRanking();
    atualizarTimestamp();
}

function carregarStats() {
    // Stats sempre sem filtro - mostra totais gerais do PS
    fetch(CONFIG.apiStats, { credentials: 'include' })
        .then(function(response) { return response.json(); })
        .then(function(data) {
            if (data.success) {
                var s = data.stats;
                atualizarElemento('stat-medicos', s.medicos_ativos);
                atualizarElemento('stat-consultorios', s.consultorios_ocupados);
                atualizarElemento('stat-atendimentos', s.atendimentos_hoje);
                atualizarElemento('stat-tempo-medio',
                    s.tempo_medio_geral ? Math.round(s.tempo_medio_geral) + ' min' : '-');
                atualizarElemento('stat-em-consulta', s.em_consulta_agora);
                atualizarElemento('stat-aguardando', s.aguardando_fila);

                var indicator = document.getElementById('status-indicator');
                if (indicator) {
                    indicator.className = 'status-indicator status-online';
                }
            }
        })
        .catch(function(err) {
            console.error('Erro ao carregar stats:', err);
        });
}

function carregarMedicos() {
    // Medicos sempre sem filtro - mostra todos os consultorios ativos
    fetch(CONFIG.apiMedicos, { credentials: 'include' })
        .then(function(response) {
            if (!response.ok) {
                throw new Error('HTTP ' + response.status + ': ' + response.statusText);
            }
            return response.json();
        })
        .then(function(data) {
            if (data.success) {
                renderizarMedicos(data.dados);
                atualizarElemento('contador-medicos',
                    data.total + ' medico' + (data.total !== 1 ? 's' : ''));
            } else {
                console.error('API retornou erro:', data.error);
                var grid = document.getElementById('medicos-grid');
                if (grid) {
                    grid.innerHTML = '<div class="mensagem-vazia"><i class="fas fa-exclamation-triangle"></i><p>Erro: ' + escapeHtml(data.error || 'Erro desconhecido') + '</p></div>';
                }
            }
        })
        .catch(function(err) {
            console.error('Erro ao carregar medicos:', err);
            var grid = document.getElementById('medicos-grid');
            if (grid) {
                grid.innerHTML = '<div class="mensagem-vazia"><i class="fas fa-exclamation-triangle"></i><p>Erro ao carregar dados: ' + escapeHtml(err.message) + '</p></div>';
            }
        });
}

function carregarRanking() {
    // Ranking COM filtro de clinica quando selecionado
    fetch(montarUrlRanking(CONFIG.apiRanking), { credentials: 'include' })
        .then(function(response) { return response.json(); })
        .then(function(data) {
            if (data.success) {
                renderizarRanking(data.dados);
                atualizarElemento('contador-ranking',
                    data.total_atendimentos + ' atendimento' + (data.total_atendimentos !== 1 ? 's' : ''));
            }
        })
        .catch(function(err) {
            console.error('Erro ao carregar ranking:', err);
            var body = document.getElementById('ranking-body');
            if (body) {
                body.innerHTML = '<tr><td colspan="7" class="texto-centro texto-muted">Erro ao carregar dados</td></tr>';
            }
        });
}

// =============================================================================
// RENDERIZACAO - MEDICOS NOS CONSULTORIOS
// =============================================================================

function renderizarMedicos(dados) {
    var grid = document.getElementById('medicos-grid');
    if (!grid) return;

    if (!dados || dados.length === 0) {
        grid.innerHTML = '<div class="mensagem-vazia"><i class="fas fa-user-md"></i><p>Nenhum medico logado no momento</p></div>';
        return;
    }

    var html = '';

    dados.forEach(function(item) {
        var nome = item.ds_usuario || '-';
        var consultorio = item.consultorio || '-';
        var especialidade = item.especialidade || '';
        var tempoConectado = item.tempo_conectado || '-';
        var emConsulta = item.em_consulta || 0;
        var clinicas = item.clinicas || [];

        var statusClass = emConsulta > 0 ? 'status-atendendo' : '';

        html += '<div class="guiche-card ' + statusClass + '">';
        html += '  <div class="guiche-info">';
        html += '    <div class="guiche-header-line">';
        html += '      <span class="guiche-numero">' + escapeHtml(consultorio) + '</span>';

        if (emConsulta > 0) {
            html += '      <span class="guiche-badge guiche-badge-consulta"><i class="fas fa-circle" style="font-size:0.45rem;margin-right:3px"></i> Em atendimento</span>';
        }

        html += '    </div>';
        html += '    <div class="guiche-usuario">' + escapeHtml(formatarNome(nome)) + '</div>';
        html += '    <div class="guiche-meta">';

        if (especialidade) {
            html += '      <span class="guiche-login">' + escapeHtml(especialidade) + '</span>';
        } else if (clinicas.length > 0) {
            html += '      <span class="guiche-login">' + escapeHtml(clinicas.join(', ')) + '</span>';
        }

        html += '      <span class="guiche-tempo"><i class="fas fa-clock"></i> ' + escapeHtml(tempoConectado) + '</span>';
        html += '    </div>';
        html += '  </div>';
        html += '</div>';
    });

    grid.innerHTML = html;
}

// =============================================================================
// RENDERIZACAO - RANKING (TABELA)
// =============================================================================

function renderizarRanking(dados) {
    var body = document.getElementById('ranking-body');
    if (!body) return;

    if (!dados || dados.length === 0) {
        body.innerHTML = '<tr><td colspan="7" class="texto-centro texto-muted">Nenhum atendimento registrado</td></tr>';
        return;
    }

    var maxAtendimentos = 0;
    dados.forEach(function(item) {
        if (item.total_atendimentos > maxAtendimentos) {
            maxAtendimentos = item.total_atendimentos;
        }
    });

    var html = '';
    dados.forEach(function(item, index) {
        var posicao = index + 1;
        var nome = item.nm_medico || '-';
        var total = item.total_atendimentos || 0;
        var percentual = maxAtendimentos > 0 ? ((total / maxAtendimentos) * 100).toFixed(1) : 0;
        var clinica = item.clinica_principal || '-';
        var tempoMed = item.tempo_medio_consulta;
        var logado = item.logado;
        var ultimoAtend = item.ultimo_atendimento;

        // Status badge
        var statusHtml = '';
        if (logado) {
            statusHtml = '<span class="status-badge status-badge-online"><i class="fas fa-circle"></i> Online</span>';
        } else {
            statusHtml = '<span class="status-badge status-badge-offline"><i class="far fa-circle"></i> Saiu';
            if (ultimoAtend) {
                statusHtml += ' ' + escapeHtml(ultimoAtend);
            }
            statusHtml += '</span>';
        }

        html += '<tr>';
        html += '  <td class="texto-centro"><span class="ranking-posicao">' + posicao + '</span></td>';
        html += '  <td>';
        html += '    <div class="ranking-nome-cell">';
        html += '      <span class="ranking-nome">' + escapeHtml(formatarNome(nome)) + '</span>';
        html += '    </div>';
        html += '  </td>';
        html += '  <td><span class="ranking-clinica">' + escapeHtml(clinica) + '</span></td>';
        html += '  <td class="texto-centro"><span class="ranking-total">' + total + '</span></td>';
        html += '  <td class="texto-centro"><span class="ranking-tempo">';
        html += tempoMed ? Math.round(tempoMed) + ' min' : '-';
        html += '</span></td>';
        html += '  <td>' + statusHtml + '</td>';
        html += '  <td>';
        html += '    <div class="barra-desempenho">';
        html += '      <div class="barra-track">';
        html += '        <div class="barra-fill" style="width: ' + percentual + '%"></div>';
        html += '      </div>';
        html += '    </div>';
        html += '  </td>';
        html += '</tr>';
    });

    body.innerHTML = html;
}

// =============================================================================
// AUTO-SCROLL COM WATCHDOG
// =============================================================================

function iniciarAutoScroll() {
    pararAutoScroll();

    var container = document.getElementById('content-scroll');
    if (!container) return;

    var emPausa = false;
    ultimaPosicaoScroll = container.scrollTop;
    contadorTravamento = 0;

    intervaloAutoScroll = setInterval(function() {
        if (!autoScrollAtivo || emPausa) return;

        var scrollMax = container.scrollHeight - container.clientHeight;
        if (scrollMax <= 10) return;

        if (container.scrollTop >= scrollMax - 5) {
            emPausa = true;
            setTimeout(function() {
                if (autoScrollAtivo) {
                    container.scrollTop = 0;
                    setTimeout(function() {
                        emPausa = false;
                    }, CONFIG.pausaAposReset);
                }
            }, CONFIG.pausaFinal);
            return;
        }

        container.scrollTop += CONFIG.velocidadeScroll;
    }, 50);

    if (intervaloWatchdog) clearInterval(intervaloWatchdog);
    intervaloWatchdog = setInterval(function() {
        if (!autoScrollAtivo) return;

        var posAtual = container.scrollTop;
        var scrollMax = container.scrollHeight - container.clientHeight;

        if (scrollMax > 10 && posAtual === ultimaPosicaoScroll && posAtual < scrollMax - 5) {
            contadorTravamento++;
            if (contadorTravamento >= 3) {
                console.log('Watchdog: reiniciando auto-scroll...');
                pararAutoScroll();
                iniciarAutoScroll();
                contadorTravamento = 0;
            }
        } else {
            contadorTravamento = 0;
        }

        ultimaPosicaoScroll = posAtual;
    }, CONFIG.watchdogInterval);
}

function pararAutoScroll() {
    if (intervaloAutoScroll) {
        clearInterval(intervaloAutoScroll);
        intervaloAutoScroll = null;
    }
    if (intervaloWatchdog) {
        clearInterval(intervaloWatchdog);
        intervaloWatchdog = null;
    }
}

// =============================================================================
// UTILITARIOS
// =============================================================================

function atualizarElemento(id, valor) {
    var el = document.getElementById(id);
    if (el) {
        el.textContent = valor !== null && valor !== undefined ? valor : '-';
    }
}

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

function formatarNome(nome) {
    if (!nome || nome === '-') return '-';
    return nome.toLowerCase().replace(/(?:^|\s)\S/g, function(letra) {
        return letra.toUpperCase();
    });
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