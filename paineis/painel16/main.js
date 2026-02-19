// =============================================================================
// PAINEL 16 - DESEMPENHO DA RECEPCAO
// Hospital Anchieta Ceilandia
// =============================================================================

var BASE_URL = window.location.origin;

var CONFIG = {
    apiMaquinas: BASE_URL + '/api/paineis/painel16/maquinas',
    apiAtendimentos: BASE_URL + '/api/paineis/painel16/atendimentos',
    apiStats: BASE_URL + '/api/paineis/painel16/stats',
    intervaloRefresh: 60000,
    velocidadeScroll: 0.5,
    pausaFinal: 8000,
    pausaAposReset: 5000,
    watchdogInterval: 5000
};

// Cores e icones alinhados com o mini dashboard
// PS = card-alta (teal), AMB = card-tempo-espera (rosa/roxo), RAD = card-permanencia (azul/roxo)
var SETORES = {
    'PS':  { nome: 'Pronto Socorro', sigla: 'PS',  icone: 'fa-ambulance',      classeIcone: 'icone-ps',  classeCard: 'setor-ps',  classeBadge: 'badge-setor-ps' },
    'AMB': { nome: 'Ambulatorio',    sigla: 'AMB', icone: 'fa-hospital-user',  classeIcone: 'icone-amb', classeCard: 'setor-amb', classeBadge: 'badge-setor-amb' },
    'RAD': { nome: 'Radiologia',     sigla: 'RAD', icone: 'fa-clipboard-check', classeIcone: 'icone-rad', classeCard: 'setor-rad', classeBadge: 'badge-setor-rad' }
};

// Estado global
var autoScrollAtivo = false;
var intervaloAutoScroll = null;
var intervaloWatchdog = null;
var setorSelecionado = localStorage.getItem('painel16_setor') || '';
var turnoSelecionado = localStorage.getItem('painel16_turno') || '';
var ultimaPosicaoScroll = 0;
var contadorTravamento = 0;

// =============================================================================
// INICIALIZACAO
// =============================================================================

function inicializar() {
    console.log('Inicializando Painel 16...');
    configurarBotoes();
    carregarTudo();
    setInterval(carregarTudo, CONFIG.intervaloRefresh);
    console.log('Painel 16 inicializado.');
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

    var filtroSetor = document.getElementById('filtro-setor');
    if (filtroSetor) {
        filtroSetor.value = setorSelecionado;
        filtroSetor.addEventListener('change', function() {
            setorSelecionado = filtroSetor.value;
            localStorage.setItem('painel16_setor', setorSelecionado);
            carregarTudo();
        });
    }

    var filtroTurno = document.getElementById('filtro-turno');
    if (filtroTurno) {
        filtroTurno.value = turnoSelecionado;
        filtroTurno.addEventListener('change', function() {
            turnoSelecionado = filtroTurno.value;
            localStorage.setItem('painel16_turno', turnoSelecionado);
            carregarTudo();
        });
    }
}

// =============================================================================
// CARREGAMENTO DE DADOS
// =============================================================================

function montarUrl(baseUrl) {
    var params = [];
    if (setorSelecionado) {
        params.push('setor=' + encodeURIComponent(setorSelecionado));
    }
    if (turnoSelecionado) {
        params.push('turno=' + encodeURIComponent(turnoSelecionado));
    }
    if (params.length > 0) {
        return baseUrl + '?' + params.join('&');
    }
    return baseUrl;
}

function carregarTudo() {
    carregarStats();
    carregarMaquinas();
    carregarAtendimentos();
    atualizarTimestamp();
}

function carregarStats() {
    fetch(montarUrl(CONFIG.apiStats), { credentials: 'include' })
        .then(function(response) { return response.json(); })
        .then(function(data) {
            if (data.success) {
                var s = data.stats;
                atualizarElemento('stat-conectados', s.total_conectados);
                atualizarElemento('stat-atendimentos', s.total_atendimentos);
                atualizarElemento('stat-recepcionistas', s.total_recepcionistas);
                atualizarElemento('stat-ps', s.atend_ps);
                atualizarElemento('stat-amb', s.atend_ambulatorial);
                atualizarElemento('stat-externo', s.atend_externo);

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

function carregarMaquinas() {
    fetch(montarUrl(CONFIG.apiMaquinas), { credentials: 'include' })
        .then(function(response) { return response.json(); })
        .then(function(data) {
            if (data.success) {
                renderizarGuiches(data.dados);
                atualizarElemento('contador-guiches', data.total + ' guiche' + (data.total !== 1 ? 's' : ''));
            }
        })
        .catch(function(err) {
            console.error('Erro ao carregar maquinas:', err);
            var grid = document.getElementById('guiches-grid');
            if (grid) {
                grid.innerHTML = '<div class="mensagem-vazia"><i class="fas fa-exclamation-triangle"></i><p>Erro ao carregar dados</p></div>';
            }
        });
}

function carregarAtendimentos() {
    fetch(montarUrl(CONFIG.apiAtendimentos), { credentials: 'include' })
        .then(function(response) { return response.json(); })
        .then(function(data) {
            if (data.success) {
                renderizarRanking(data.dados);
                atualizarElemento('contador-atendimentos', data.total_atendimentos + ' atendimento' + (data.total_atendimentos !== 1 ? 's' : ''));
            }
        })
        .catch(function(err) {
            console.error('Erro ao carregar atendimentos:', err);
            var body = document.getElementById('ranking-body');
            if (body) {
                body.innerHTML = '<tr><td colspan="6" class="texto-centro texto-muted">Erro ao carregar dados</td></tr>';
            }
        });
}

// =============================================================================
// RENDERIZACAO - GUICHES
// =============================================================================

function renderizarGuiches(dados) {
    var grid = document.getElementById('guiches-grid');
    if (!grid) return;

    if (!dados || dados.length === 0) {
        grid.innerHTML = '<div class="mensagem-vazia"><i class="fas fa-desktop"></i><p>Nenhum guiche ativo no momento</p></div>';
        return;
    }

    var mostrarBadge = !setorSelecionado;
    var html = '';

    dados.forEach(function(item) {
        var setor = (item.setor || item.setor_calc || '').toUpperCase();
        var setorInfo = SETORES[setor] || { nome: setor, sigla: setor, icone: 'fa-desktop', classeIcone: '', classeCard: '', classeBadge: '' };
        var nomeUsuario = item.ds_usuario || item.nm_usuario || '-';
        var consultorio = item.consultorio || '-';
        var tempo = item.tempo_conectado || '-';
        var totalAtend = item.total_atendimentos || 0;

        html += '<div class="guiche-card ' + setorInfo.classeCard + '">';
        html += '  <div class="guiche-icone ' + setorInfo.classeIcone + '">';
        html += '    <i class="fas ' + setorInfo.icone + '"></i>';
        html += '  </div>';
        html += '  <div class="guiche-info">';
        html += '    <div class="guiche-header-line">';
        html += '      <span class="guiche-numero">' + escapeHtml(consultorio) + '</span>';

        if (mostrarBadge && setor && SETORES[setor]) {
            html += '      <span class="guiche-badge ' + setorInfo.classeBadge + '">' + escapeHtml(setorInfo.sigla) + '</span>';
        }

        html += '    </div>';
        html += '    <div class="guiche-usuario">' + escapeHtml(formatarNome(nomeUsuario)) + '</div>';
        html += '    <div class="guiche-meta">';
        html += '      <span class="guiche-tempo"><i class="fas fa-clock"></i> ' + escapeHtml(tempo) + '</span>';
        html += '      <span class="guiche-atend-inline"><i class="fas fa-ticket-alt"></i> ' + totalAtend + ' atend.</span>';
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
        body.innerHTML = '<tr><td colspan="6" class="texto-centro texto-muted">Nenhum atendimento registrado</td></tr>';
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
        var nomeCompleto = item.usuario_atendimento || item.usuario || '-';
        var total = item.total_atendimentos || 0;
        var percentual = maxAtendimentos > 0 ? ((total / maxAtendimentos) * 100).toFixed(1) : 0;
        var setorPrincipal = item.setor_principal || '-';
        var turno = item.turno || 'Diurno';

        var turnoIcone = '';
        var turnoClasse = '';
        if (turno === 'Noturno') {
            turnoIcone = '<i class="fas fa-moon"></i> ';
            turnoClasse = 'turno-noturno';
        } else if (turno === 'Ambos') {
            turnoIcone = '<i class="fas fa-exchange-alt"></i> ';
            turnoClasse = '';
        } else {
            turnoIcone = '<i class="fas fa-sun"></i> ';
            turnoClasse = 'turno-diurno';
        }

        html += '<tr>';
        html += '  <td class="texto-centro"><span class="ranking-posicao">' + posicao + '</span></td>';
        html += '  <td><span class="ranking-nome">' + escapeHtml(formatarNome(nomeCompleto)) + '</span></td>';
        html += '  <td><span class="ranking-setor">' + escapeHtml(setorPrincipal) + '</span></td>';
        html += '  <td><span class="ranking-turno ' + turnoClasse + '">' + turnoIcone + escapeHtml(turno) + '</span></td>';
        html += '  <td class="texto-centro"><span class="ranking-total">' + total + '</span></td>';
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