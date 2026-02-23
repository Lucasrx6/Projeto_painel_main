// =============================================================================
// PAINEL 10 - ANALISE DO PRONTO SOCORRO
// Hospital Anchieta Ceilandia
//
// Carrega 6 endpoints em paralelo e renderiza:
//   - Cards resumo (dashboard)
//   - Desempenho da recepcao
//   - Tempo medio por clinica
//   - Pacientes aguardando
//   - Grafico atendimentos por hora
//   - Desempenho por medico
// =============================================================================

var BASE_URL = window.location.origin;

var CONFIG = {
    api: {
        dashboard: BASE_URL + '/api/paineis/painel10/dashboard',
        tempoClinica: BASE_URL + '/api/paineis/painel10/tempo-clinica',
        aguardandoClinica: BASE_URL + '/api/paineis/painel10/aguardando-clinica',
        atendimentosHora: BASE_URL + '/api/paineis/painel10/atendimentos-hora',
        desempenhoMedico: BASE_URL + '/api/paineis/painel10/desempenho-medico',
        desempenhoRecepcao: BASE_URL + '/api/paineis/painel10/desempenho-recepcao'
    },
    intervaloRefresh: 60000,
    velocidadeScroll: 0.5,
    pausaFinal: 8000,
    pausaAposReset: 5000,
    watchdogInterval: 5000,
    tempoEspera: { bom: 30, medio: 60 },
    tempoAtendimento: { bom: 15, medio: 30 }
};

// Estado global
var autoScrollAtivo = false;
var intervaloAutoScroll = null;
var intervaloWatchdog = null;
var carregando = false;
var errosConsecutivos = 0;
var ultimaPosicaoScroll = 0;
var contadorTravamento = 0;

// Cache DOM
var DOM = {};

// =============================================================================
// INICIALIZACAO
// =============================================================================

function inicializar() {
    console.log('[Painel10] Inicializando...');
    cachearElementos();
    configurarBotoes();
    carregarTudo();
    setInterval(carregarTudo, CONFIG.intervaloRefresh);

    // Recarrega ao voltar para aba
    document.addEventListener('visibilitychange', function() {
        if (!document.hidden) {
            carregarTudo();
            if (autoScrollAtivo) iniciarAutoScroll();
        } else {
            if (autoScrollAtivo) pararAutoScroll();
        }
    });

    console.log('[Painel10] Inicializado com sucesso');
}

function cachearElementos() {
    DOM.painelMain = document.getElementById('painel-main');
    DOM.statusIndicator = document.getElementById('status-indicator');
    DOM.ultimaAtualizacao = document.getElementById('ultima-atualizacao');
    DOM.totalDia = document.getElementById('total-dia');
    DOM.totalRealizados = document.getElementById('total-realizados');
    DOM.totalAguardando = document.getElementById('total-aguardando');
    DOM.totalAlta = document.getElementById('total-alta');
    DOM.tempoMedioEspera = document.getElementById('tempo-medio-espera');
    DOM.tempoMedioPermanencia = document.getElementById('tempo-medio-permanencia');
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', inicializar);
} else {
    inicializar();
}

// =============================================================================
// BOTOES E EVENTOS
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

    // Atalho ESC para parar scroll
    document.addEventListener('keydown', function(e) {
        if (e.key === 'Escape' && autoScrollAtivo) {
            autoScrollAtivo = false;
            var btn = document.getElementById('btn-auto-scroll');
            if (btn) {
                btn.classList.remove('ativo');
                btn.innerHTML = '<i class="fas fa-play"></i> <span class="btn-text">Auto Scroll</span>';
            }
            pararAutoScroll();
        }
    });
}

// =============================================================================
// CARREGAMENTO DE DADOS (PARALELO)
// =============================================================================

function carregarTudo() {
    if (carregando) return;
    carregando = true;
    atualizarStatus('loading');

    console.log('[Painel10] Carregando dados...');

    var endpoints = [
        { url: CONFIG.api.dashboard, chave: 'dashboard' },
        { url: CONFIG.api.tempoClinica, chave: 'tempoClinica' },
        { url: CONFIG.api.aguardandoClinica, chave: 'aguardando' },
        { url: CONFIG.api.atendimentosHora, chave: 'porHora' },
        { url: CONFIG.api.desempenhoMedico, chave: 'medicos' },
        { url: CONFIG.api.desempenhoRecepcao, chave: 'recepcao' }
    ];

    var resultados = {};
    var completos = 0;
    var erros = 0;

    endpoints.forEach(function(ep) {
        fetch(ep.url, { credentials: 'include' })
            .then(function(response) { return response.json(); })
            .then(function(data) {
                if (data.success) {
                    resultados[ep.chave] = data.data || data;
                }
            })
            .catch(function(err) {
                console.error('[Painel10] Erro ao carregar ' + ep.chave + ':', err);
                erros++;
            })
            .finally(function() {
                completos++;
                if (completos === endpoints.length) {
                    finalizarCarregamento(resultados, erros);
                }
            });
    });
}

function finalizarCarregamento(dados, erros) {
    carregando = false;

    if (erros >= 4) {
        errosConsecutivos++;
        atualizarStatus('offline');
        if (errosConsecutivos >= 3) {
            mostrarErro('Falha na conexao com o servidor. Verifique sua rede.');
        }
        return;
    }

    errosConsecutivos = 0;

    // Atualizar cards do dashboard
    if (dados.dashboard) {
        atualizarDashboard(dados.dashboard);
    }

    // Renderizar conteudo principal
    renderizarConteudo(dados);
    atualizarTimestamp();
    atualizarStatus('online');

    console.log('[Painel10] Dados carregados com sucesso');
}

// =============================================================================
// DASHBOARD (CARDS RESUMO)
// =============================================================================

function atualizarDashboard(d) {
    if (!d) return;

    // Animacao sutil
    var cards = document.querySelectorAll('.resumo-card');
    for (var i = 0; i < cards.length; i++) {
        cards[i].classList.add('atualizando');
    }
    setTimeout(function() {
        for (var j = 0; j < cards.length; j++) {
            cards[j].classList.remove('atualizando');
        }
    }, 300);

    atualizarEl(DOM.totalDia, formatarNumero(d.total_atendimentos_dia));
    atualizarEl(DOM.totalRealizados, formatarNumero(d.atendimentos_realizados));
    atualizarEl(DOM.totalAguardando, formatarNumero(d.aguardando_atendimento));
    atualizarEl(DOM.totalAlta, formatarNumero(d.pacientes_alta));
    atualizarEl(DOM.tempoMedioEspera, formatarTempo(d.tempo_medio_espera_consulta_min));
    atualizarEl(DOM.tempoMedioPermanencia, formatarTempo(d.tempo_medio_permanencia_min));

    // Cor dinamica no card de espera
    if (DOM.tempoMedioEspera) {
        var tempo = d.tempo_medio_espera_consulta_min || 0;
        var parent = DOM.tempoMedioEspera.parentElement.parentElement;
        parent.className = 'resumo-card card-tempo-espera ' + getClasseTempo(tempo, 'espera');
    }
}

// =============================================================================
// RENDERIZACAO DO CONTEUDO PRINCIPAL
// =============================================================================

function renderizarConteudo(dados) {
    if (!DOM.painelMain) return;

    var html = '<div class="content-scroll" id="content-scroll">';
    html += renderizarRecepcao(dados.recepcao);
    html += renderizarTempoClinica(dados.tempoClinica);
    html += renderizarAguardando(dados.aguardando);
    html += renderizarGrafico(dados.porHora);
    html += renderizarMedicos(dados.medicos);
    html += '</div>';

    DOM.painelMain.innerHTML = html;
}

// ----- RECEPCAO -----
function renderizarRecepcao(dados) {
    if (!dados) dados = {};

    var totalRecebidos = dados.total_recebidos || 0;
    var tempoMedio = dados.tempo_medio_recepcao_min || 0;
    var aguardando = dados.aguardando_recepcao || 0;

    return '' +
        '<section class="secao-analise">' +
        '  <header class="secao-header">' +
        '    <div class="secao-titulo">' +
        '      <i class="fas fa-desktop"></i>' +
        '      <h2>Desempenho da Recepcao</h2>' +
        '    </div>' +
        '  </header>' +
        '  <div class="secao-content">' +
        '    <div class="metricas-grid metricas-3">' +
        '      <div class="metrica-card">' +
        '        <div class="metrica-icone icone-azul"><i class="fas fa-users"></i></div>' +
        '        <div class="metrica-info">' +
        '          <span class="metrica-valor">' + formatarNumero(totalRecebidos) + '</span>' +
        '          <span class="metrica-label">Total Recebidos</span>' +
        '        </div>' +
        '      </div>' +
        '      <div class="metrica-card">' +
        '        <div class="metrica-icone icone-roxo"><i class="fas fa-stopwatch"></i></div>' +
        '        <div class="metrica-info">' +
        '          <span class="metrica-valor">' + formatarTempo(tempoMedio) + ' <small>min</small></span>' +
        '          <span class="metrica-label">Tempo Medio</span>' +
        '        </div>' +
        '      </div>' +
        '      <div class="metrica-card">' +
        '        <div class="metrica-icone icone-laranja"><i class="fas fa-user-clock"></i></div>' +
        '        <div class="metrica-info">' +
        '          <span class="metrica-valor">' + formatarNumero(aguardando) + '</span>' +
        '          <span class="metrica-label">Aguardando</span>' +
        '        </div>' +
        '      </div>' +
        '    </div>' +
        '  </div>' +
        '</section>';
}

// ----- TEMPO POR CLINICA -----
function renderizarTempoClinica(dados) {
    if (!dados || dados.length === 0) {
        return renderizarSecaoVazia('Tempo Medio por Clinica', 'fas fa-clinic-medical', 'Nenhum atendimento registrado hoje');
    }

    var linhas = '';
    for (var i = 0; i < dados.length; i++) {
        var row = dados[i];
        var tempo = row.tempo_medio_espera_min || 0;
        linhas += '' +
            '<tr>' +
            '  <td><span class="clinica-nome">' + escapeHtml(row.ds_clinica) + '</span></td>' +
            '  <td class="texto-centro">' + formatarNumero(row.total_atendimentos) + '</td>' +
            '  <td class="texto-centro">' + formatarNumero(row.atendimentos_realizados) + '</td>' +
            '  <td class="texto-centro"><span class="badge badge-aguardando">' + formatarNumero(row.aguardando_atendimento) + '</span></td>' +
            '  <td class="texto-centro"><span class="badge badge-tempo ' + getClasseTempo(tempo, 'espera') + '">' + tempo + ' min</span></td>' +
            '</tr>';
    }

    return '' +
        '<section class="secao-analise">' +
        '  <header class="secao-header">' +
        '    <div class="secao-titulo"><i class="fas fa-clinic-medical"></i><h2>Tempo Medio por Clinica</h2></div>' +
        '    <span class="secao-contador">' + dados.length + ' clinica(s)</span>' +
        '  </header>' +
        '  <div class="secao-content">' +
        '    <div class="tabela-container">' +
        '      <table class="tabela-dados">' +
        '        <thead><tr>' +
        '          <th>Clinica</th>' +
        '          <th class="texto-centro">Total</th>' +
        '          <th class="texto-centro">Realizados</th>' +
        '          <th class="texto-centro">Aguardando</th>' +
        '          <th class="texto-centro">Tempo Medio</th>' +
        '        </tr></thead>' +
        '        <tbody>' + linhas + '</tbody>' +
        '      </table>' +
        '    </div>' +
        '  </div>' +
        '</section>';
}

// ----- PACIENTES AGUARDANDO -----
function renderizarAguardando(dados) {
    if (!dados || dados.length === 0) {
        return '' +
            '<section class="secao-analise secao-sucesso">' +
            '  <header class="secao-header">' +
            '    <div class="secao-titulo"><i class="fas fa-user-clock"></i><h2>Pacientes Aguardando</h2></div>' +
            '  </header>' +
            '  <div class="secao-content">' +
            '    <div class="mensagem-sucesso">' +
            '      <i class="fas fa-check-circle"></i>' +
            '      <p>Nenhum paciente aguardando atendimento</p>' +
            '    </div>' +
            '  </div>' +
            '</section>';
    }

    var totalAguardando = 0;
    var linhas = '';
    for (var i = 0; i < dados.length; i++) {
        var row = dados[i];
        var tempoMedio = row.tempo_espera_atual_min || 0;
        var tempoMax = row.tempo_max_espera_min || 0;
        totalAguardando += row.total_aguardando || 0;

        linhas += '' +
            '<tr>' +
            '  <td><span class="clinica-nome">' + escapeHtml(row.ds_clinica) + '</span></td>' +
            '  <td class="texto-centro"><span class="badge badge-aguardando-grande">' + formatarNumero(row.total_aguardando) + '</span></td>' +
            '  <td class="texto-centro">' + tempoMedio + ' min</td>' +
            '  <td class="texto-centro"><span class="badge badge-tempo tempo-critico">' + tempoMax + ' min</span></td>' +
            '</tr>';
    }

    return '' +
        '<section class="secao-analise">' +
        '  <header class="secao-header">' +
        '    <div class="secao-titulo"><i class="fas fa-user-clock"></i><h2>Pacientes Aguardando</h2></div>' +
        '    <span class="secao-contador secao-contador-alerta">' + totalAguardando + ' paciente(s)</span>' +
        '  </header>' +
        '  <div class="secao-content">' +
        '    <div class="tabela-container">' +
        '      <table class="tabela-dados">' +
        '        <thead><tr>' +
        '          <th>Clinica</th>' +
        '          <th class="texto-centro">Aguardando</th>' +
        '          <th class="texto-centro">Tempo Medio</th>' +
        '          <th class="texto-centro">Tempo Maximo</th>' +
        '        </tr></thead>' +
        '        <tbody>' + linhas + '</tbody>' +
        '      </table>' +
        '    </div>' +
        '  </div>' +
        '</section>';
}

// ----- GRAFICO POR HORA -----
function renderizarGrafico(dados) {
    if (!dados || dados.length === 0) {
        return renderizarSecaoVazia('Atendimentos por Hora', 'fas fa-chart-bar', 'Nenhum dado disponivel');
    }

    var maxValor = 1;
    var totalDia = 0;
    for (var i = 0; i < dados.length; i++) {
        var t = dados[i].total_atendimentos || 0;
        if (t > maxValor) maxValor = t;
        totalDia += t;
    }

    var horaAtual = new Date().getHours();
    var barras = '';

    for (var j = 0; j < dados.length; j++) {
        var row = dados[j];
        var hora = row.hora;
        var total = row.total_atendimentos || 0;
        var altura = total > 0 ? Math.max((total / maxValor) * 100, 4) : 0;
        var isAtual = parseInt(hora) === horaAtual;

        barras += '' +
            '<div class="grafico-barra' + (isAtual ? ' barra-atual' : '') + '">' +
            '  <div class="barra-container">' +
            '    <span class="barra-valor">' + total + '</span>' +
            '    <div class="barra-preenchimento" style="height: ' + altura + '%"></div>' +
            '  </div>' +
            '  <span class="barra-label">' + hora + 'h</span>' +
            '</div>';
    }

    return '' +
        '<section class="secao-analise">' +
        '  <header class="secao-header">' +
        '    <div class="secao-titulo"><i class="fas fa-chart-bar"></i><h2>Atendimentos por Hora</h2></div>' +
        '    <span class="secao-contador">' + totalDia + ' total</span>' +
        '  </header>' +
        '  <div class="secao-content">' +
        '    <div class="grafico-container">' +
        '      <div class="grafico-barras">' + barras + '</div>' +
        '    </div>' +
        '  </div>' +
        '</section>';
}

// ----- DESEMPENHO MEDICOS -----
function renderizarMedicos(dados) {
    if (!dados || dados.length === 0) {
        return renderizarSecaoVazia('Desempenho por Medico', 'fas fa-user-md', 'Nenhum medico com atendimento registrado hoje');
    }

    var linhas = '';
    for (var i = 0; i < dados.length; i++) {
        var row = dados[i];
        var tempo = row.tempo_medio_atendimento_min || 0;

        linhas += '' +
            '<tr>' +
            '  <td class="texto-centro texto-muted">' + escapeHtml(row.cd_medico_resp) + '</td>' +
            '  <td><span class="medico-nome">' + escapeHtml(row.nm_guerra) + '</span></td>' +
            '  <td class="texto-centro">' + formatarNumero(row.total_atendimentos) + '</td>' +
            '  <td class="texto-centro"><span class="badge badge-tempo ' + getClasseTempo(tempo, 'atendimento') + '">' + tempo + ' min</span></td>' +
            '  <td class="texto-centro"><span class="badge badge-sucesso">' + formatarNumero(row.pacientes_finalizados) + '</span></td>' +
            '</tr>';
    }

    return '' +
        '<section class="secao-analise">' +
        '  <header class="secao-header">' +
        '    <div class="secao-titulo"><i class="fas fa-user-md"></i><h2>Desempenho por Medico</h2></div>' +
        '    <span class="secao-contador">' + dados.length + ' medico(s)</span>' +
        '  </header>' +
        '  <div class="secao-content">' +
        '    <div class="tabela-container">' +
        '      <table class="tabela-dados">' +
        '        <thead><tr>' +
        '          <th class="texto-centro" style="width:80px">Codigo</th>' +
        '          <th>Medico</th>' +
        '          <th class="texto-centro">Atendimentos</th>' +
        '          <th class="texto-centro">Tempo Medio</th>' +
        '          <th class="texto-centro">Finalizados</th>' +
        '        </tr></thead>' +
        '        <tbody>' + linhas + '</tbody>' +
        '      </table>' +
        '    </div>' +
        '  </div>' +
        '</section>';
}

// ----- SECAO VAZIA -----
function renderizarSecaoVazia(titulo, icone, mensagem) {
    return '' +
        '<section class="secao-analise">' +
        '  <header class="secao-header">' +
        '    <div class="secao-titulo"><i class="' + icone + '"></i><h2>' + titulo + '</h2></div>' +
        '  </header>' +
        '  <div class="secao-content">' +
        '    <div class="mensagem-vazia">' +
        '      <i class="fas fa-inbox"></i>' +
        '      <p>' + mensagem + '</p>' +
        '    </div>' +
        '  </div>' +
        '</section>';
}

// ----- MENSAGEM DE ERRO -----
function mostrarErro(mensagem) {
    if (!DOM.painelMain) return;
    DOM.painelMain.innerHTML = '' +
        '<div class="mensagem-erro-container">' +
        '  <div class="mensagem-erro">' +
        '    <i class="fas fa-exclamation-triangle"></i>' +
        '    <h3>Erro ao Carregar Dados</h3>' +
        '    <p>' + escapeHtml(mensagem) + '</p>' +
        '    <button class="btn-tentar-novamente" onclick="location.reload()">' +
        '      <i class="fas fa-sync-alt"></i> Tentar Novamente' +
        '    </button>' +
        '  </div>' +
        '</div>';
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

    // Watchdog
    if (intervaloWatchdog) clearInterval(intervaloWatchdog);
    intervaloWatchdog = setInterval(function() {
        if (!autoScrollAtivo) return;

        var posAtual = container.scrollTop;
        var scrollMax = container.scrollHeight - container.clientHeight;

        if (scrollMax > 10 && posAtual === ultimaPosicaoScroll && posAtual < scrollMax - 5) {
            contadorTravamento++;
            if (contadorTravamento >= 3) {
                console.log('[Painel10] Watchdog: reiniciando auto-scroll');
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

function atualizarEl(el, valor) {
    if (el) el.textContent = valor !== null && valor !== undefined ? valor : '-';
}

function atualizarStatus(status) {
    var el = DOM.statusIndicator;
    if (!el) return;
    el.className = 'status-indicator status-' + status;
}

function atualizarTimestamp() {
    if (!DOM.ultimaAtualizacao) return;
    var agora = new Date();
    var h = agora.getHours().toString();
    var m = agora.getMinutes().toString();
    if (h.length < 2) h = '0' + h;
    if (m.length < 2) m = '0' + m;
    DOM.ultimaAtualizacao.textContent = h + ':' + m;
}

function formatarNumero(valor) {
    if (valor === null || valor === undefined || isNaN(valor)) return '-';
    return Number(valor).toLocaleString('pt-BR');
}

function formatarTempo(minutos) {
    if (minutos === null || minutos === undefined || isNaN(minutos)) return '-';
    var min = Math.round(minutos);
    if (min < 60) return '' + min;
    var horas = Math.floor(min / 60);
    var mins = min % 60;
    return horas + 'h' + (mins < 10 ? '0' : '') + mins;
}

function getClasseTempo(minutos, tipo) {
    var limites = tipo === 'atendimento' ? CONFIG.tempoAtendimento : CONFIG.tempoEspera;
    if (minutos < limites.bom) return 'tempo-bom';
    if (minutos < limites.medio) return 'tempo-medio';
    return 'tempo-critico';
}

function escapeHtml(text) {
    if (!text) return '-';
    var str = String(text);
    return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}