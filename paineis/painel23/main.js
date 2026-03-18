// =============================================================================
// PAINEL 23 - ATENDIMENTOS AMBULATORIAIS
// Hospital Anchieta Ceilandia
// =============================================================================

var BASE_URL = window.location.origin;

var CONFIG = {
    apiDashboard: BASE_URL + '/api/paineis/painel23/dashboard',
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
var ultimaPosicaoScroll = 0;
var contadorTravamento = 0;
var filasDisponiveis = [];
var filasSelecionadas = recuperar('filas_selecionadas');
var modoMaximizado = false;

// =============================================================================
// LOCALSTORAGE HELPERS
// =============================================================================

function salvar(chave, valor) {
    try {
        localStorage.setItem('painel23_' + chave, JSON.stringify(valor));
    } catch (e) {
        // silencioso
    }
}

function recuperar(chave) {
    try {
        var val = localStorage.getItem('painel23_' + chave);
        if (val !== null) {
            return JSON.parse(val);
        }
    } catch (e) {
        // silencioso
    }
    return null;
}

// =============================================================================
// INICIALIZACAO
// =============================================================================

function inicializar() {
    console.log('Inicializando Painel 23...');
    configurarBotoes();
    configurarFiltroFilas();
    configurarMaximizar();
    carregarDados();
    setInterval(carregarDados, CONFIG.intervaloRefresh);
    console.log('Painel 23 inicializado.');
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
}

// =============================================================================
// FILTRO DE FILAS (dropdown multi-select)
// =============================================================================

function configurarFiltroFilas() {
    var btnFiltro = document.getElementById('btn-filtro-filas');
    var dropdown = document.getElementById('filtro-filas-dropdown');
    var btnLimpar = document.getElementById('filtro-filas-limpar');

    if (!btnFiltro || !dropdown) return;

    // Toggle dropdown
    btnFiltro.addEventListener('click', function(e) {
        e.stopPropagation();
        var aberto = dropdown.classList.contains('visivel');
        if (aberto) {
            fecharDropdownFilas();
        } else {
            dropdown.classList.add('visivel');
            btnFiltro.classList.add('aberto');
        }
    });

    // Fechar ao clicar fora
    document.addEventListener('click', function(e) {
        var wrapper = document.getElementById('filtro-filas-wrapper');
        if (wrapper && !wrapper.contains(e.target)) {
            fecharDropdownFilas();
        }
    });

    // Botao "Todas" (limpar selecao = mostrar todas)
    if (btnLimpar) {
        btnLimpar.addEventListener('click', function(e) {
            e.stopPropagation();
            filasSelecionadas = null;
            salvar('filas_selecionadas', null);
            atualizarCheckboxesFilas();
            atualizarBotaoFiltro();
            renderizarFilasFiltradas();
        });
    }
}

function fecharDropdownFilas() {
    var dropdown = document.getElementById('filtro-filas-dropdown');
    var btnFiltro = document.getElementById('btn-filtro-filas');
    if (dropdown) dropdown.classList.remove('visivel');
    if (btnFiltro) btnFiltro.classList.remove('aberto');
}

function popularCheckboxesFilas(filas) {
    var lista = document.getElementById('filtro-filas-lista');
    if (!lista) return;

    filasDisponiveis = filas || [];
    var html = '';

    filasDisponiveis.forEach(function(fila) {
        var chaveId = 'fila-cb-' + fila.nr_seq_fila;
        var marcado = isFilaSelecionada(fila.nr_seq_fila) ? ' checked' : '';
        var nome = fila.ds_fila || 'Fila ' + fila.nr_seq_fila;

        html += '<div class="filtro-filas-item">';
        html += '  <input type="checkbox" id="' + chaveId + '" value="' + fila.nr_seq_fila + '"' + marcado + '>';
        html += '  <label for="' + chaveId + '">' + escapeHtml(nome) + '</label>';
        html += '</div>';
    });

    lista.innerHTML = html;

    // Vincular eventos nos checkboxes
    var checkboxes = lista.querySelectorAll('input[type="checkbox"]');
    for (var i = 0; i < checkboxes.length; i++) {
        checkboxes[i].addEventListener('change', function() {
            onCheckboxFilaChange();
        });
    }

    atualizarBotaoFiltro();
}

function onCheckboxFilaChange() {
    var lista = document.getElementById('filtro-filas-lista');
    if (!lista) return;

    var checkboxes = lista.querySelectorAll('input[type="checkbox"]');
    var selecionadas = [];
    var todosMarcados = true;

    for (var i = 0; i < checkboxes.length; i++) {
        if (checkboxes[i].checked) {
            selecionadas.push(parseInt(checkboxes[i].value));
        } else {
            todosMarcados = false;
        }
    }

    // Se todos marcados ou nenhum, tratar como "todas"
    if (todosMarcados || selecionadas.length === 0) {
        filasSelecionadas = null;
        salvar('filas_selecionadas', null);
    } else {
        filasSelecionadas = selecionadas;
        salvar('filas_selecionadas', selecionadas);
    }

    atualizarBotaoFiltro();
    renderizarFilasFiltradas();
}

function atualizarCheckboxesFilas() {
    var lista = document.getElementById('filtro-filas-lista');
    if (!lista) return;

    var checkboxes = lista.querySelectorAll('input[type="checkbox"]');
    for (var i = 0; i < checkboxes.length; i++) {
        checkboxes[i].checked = isFilaSelecionada(parseInt(checkboxes[i].value));
    }
}

function atualizarBotaoFiltro() {
    var btn = document.getElementById('btn-filtro-filas');
    if (!btn) return;

    if (filasSelecionadas && filasSelecionadas.length > 0) {
        btn.classList.add('tem-filtro');
    } else {
        btn.classList.remove('tem-filtro');
    }
}

function isFilaSelecionada(nrSeqFila) {
    // Se nao tem filtro, todas sao selecionadas
    if (!filasSelecionadas || filasSelecionadas.length === 0) {
        return true;
    }
    return filasSelecionadas.indexOf(nrSeqFila) !== -1;
}

function filtrarFilas(filas) {
    if (!filasSelecionadas || filasSelecionadas.length === 0) {
        return filas;
    }
    return filas.filter(function(f) {
        return filasSelecionadas.indexOf(f.nr_seq_fila) !== -1;
    });
}

// Cache das filas completas para re-renderizacao ao trocar filtro
var ultimasFilas = [];

function renderizarFilasFiltradas() {
    var filasFiltradas = filtrarFilas(ultimasFilas);
    renderizarFilasGrid(filasFiltradas);
}

// =============================================================================
// MAXIMIZAR SECAO DE FILAS
// =============================================================================

function configurarMaximizar() {
    var btn = document.getElementById('btn-maximizar-filas');
    if (!btn) return;

    btn.addEventListener('click', function() {
        modoMaximizado = !modoMaximizado;
        var container = document.getElementById('painel-container');
        if (!container) return;

        if (modoMaximizado) {
            container.classList.add('modo-filas-max');
            btn.classList.add('ativo');
            btn.innerHTML = '<i class="fas fa-compress"></i>';
            btn.title = 'Restaurar visualizacao';
        } else {
            container.classList.remove('modo-filas-max');
            btn.classList.remove('ativo');
            btn.innerHTML = '<i class="fas fa-expand"></i>';
            btn.title = 'Maximizar filas';
        }
    });
}

// =============================================================================
// CARREGAMENTO
// =============================================================================

function carregarDados() {
    fetch(CONFIG.apiDashboard, { credentials: 'include' })
        .then(function(response) { return response.json(); })
        .then(function(data) {
            if (data.success) {
                renderizarCards(data.totais);
                // Salvar filas completas e popular checkboxes
                ultimasFilas = data.filas || [];
                popularCheckboxesFilas(ultimasFilas);
                // Renderizar filas filtradas
                var filasFiltradas = filtrarFilas(ultimasFilas);
                renderizarFilasGrid(filasFiltradas);
                renderizarTabela(data.especialidades);
                atualizarTimestamp();

                var indicator = document.getElementById('status-indicator');
                if (indicator) {
                    indicator.className = 'status-indicator status-online';
                }
            }
        })
        .catch(function(err) {
            console.error('Erro ao carregar dados:', err);
            var indicator = document.getElementById('status-indicator');
            if (indicator) {
                indicator.className = 'status-indicator status-loading';
            }
        });
}

// =============================================================================
// RENDERIZACAO - CARDS TOPO
// =============================================================================

function renderizarCards(totais) {
    if (!totais) return;

    atualizarElemento('stat-atendimentos', totais.total_atendimentos || 0);
    atualizarElemento('stat-aguardando', totais.aguardando_medico || 0);
    atualizarElemento('stat-em-consulta', totais.em_consulta || 0);
    atualizarElemento('stat-medicos', totais.medicos_atendendo || 0);

    var medianaEspera = totais.mediana_espera_geral;
    if (medianaEspera !== null && medianaEspera !== undefined) {
        atualizarElemento('stat-mediana-espera', Math.round(medianaEspera));
    } else {
        atualizarElemento('stat-mediana-espera', '--');
    }

    var producao = totais.producao_total;
    if (producao !== null && producao !== undefined && producao > 0) {
        atualizarElemento('stat-producao', formatarMoeda(producao));
    } else {
        atualizarElemento('stat-producao', '--');
    }
}

// =============================================================================
// RENDERIZACAO - CARDS DE FILA
// =============================================================================

function renderizarFilasGrid(filas) {
    var grid = document.getElementById('filas-grid');
    if (!grid) return;

    var contador = document.getElementById('contador-filas');

    if (!filas || filas.length === 0) {
        grid.innerHTML = '<div class="mensagem-vazia"><i class="fas fa-clock"></i><p>Nenhuma fila selecionada</p></div>';
        if (contador) contador.textContent = '0 filas';
        return;
    }

    if (contador) {
        contador.textContent = filas.length + ' fila' + (filas.length !== 1 ? 's' : '');
    }

    var html = '';

    filas.forEach(function(fila) {
        var temDados = fila.mediana !== null && fila.mediana !== undefined;

        // Nivel de espera
        var nivelClasse = 'nivel-baixo';
        if (temDados) {
            if (fila.mediana > 30) {
                nivelClasse = 'nivel-alto';
            } else if (fila.mediana > 15) {
                nivelClasse = 'nivel-medio';
            }
        }

        // Tendencia
        var tendenciaHtml = '';
        if (temDados && fila.tendencia !== 'sem_dados') {
            var tendClasse = 'tendencia-estavel';
            var tendIcone = 'fa-arrows-left-right';
            var tendTexto = 'Estavel';

            if (fila.tendencia === 'subindo') {
                tendClasse = 'tendencia-subindo';
                tendIcone = 'fa-arrow-trend-up';
                tendTexto = 'Subindo';
            } else if (fila.tendencia === 'descendo') {
                tendClasse = 'tendencia-descendo';
                tendIcone = 'fa-arrow-trend-down';
                tendTexto = 'Descendo';
            }

            tendenciaHtml = '<span class="fila-tendencia ' + tendClasse + '">';
            tendenciaHtml += '<i class="fas ' + tendIcone + '"></i> ' + tendTexto;
            tendenciaHtml += '</span>';
        }

        // Aguardando
        var aguardandoHtml = '';
        if (fila.aguardando > 0) {
            aguardandoHtml = '<span class="fila-footer-item"><i class="fas fa-users"></i> <strong class="fila-aguardando-destaque">' + fila.aguardando + '</strong> aguardando</span>';
        } else {
            aguardandoHtml = '<span class="fila-footer-item"></span>';
        }

        // Ultimo chamado
        var ultimoTexto = '-';
        if (fila.ultimo_chamado_min !== null && fila.ultimo_chamado_min !== undefined) {
            if (fila.ultimo_chamado_min < 1) {
                ultimoTexto = 'Agora';
            } else if (fila.ultimo_chamado_min < 60) {
                ultimoTexto = 'ha ' + fila.ultimo_chamado_min + ' min';
            } else {
                var horas = Math.floor(fila.ultimo_chamado_min / 60);
                ultimoTexto = 'ha ' + horas + 'h';
            }
        }

        var nomeExibicao = fila.ds_fila || 'Fila ' + fila.nr_seq_fila;

        html += '<div class="fila-card">';

        // Header
        html += '  <div class="fila-card-header">';
        html += '    <span class="fila-nome">' + escapeHtml(nomeExibicao) + '</span>';
        if (fila.atendidos_hoje > 0) {
            html += '    <span class="fila-atendidos"><i class="fas fa-ticket-alt"></i> ' + fila.atendidos_hoje + '</span>';
        }
        html += '  </div>';

        // Body
        html += '  <div class="fila-card-body">';
        if (temDados) {
            html += '    <div class="fila-tempo-faixa ' + nivelClasse + '">';
            html += '      ' + fila.faixa_min + ' - ' + fila.faixa_max + ' min';
            html += '    </div>';
            html += '    <span class="fila-tempo-unidade">tempo estimado de espera</span>';
            html += '    ' + tendenciaHtml;
        } else {
            html += '    <div class="fila-sem-dados"><i class="fas fa-minus-circle"></i> Sem dados recentes</div>';
        }
        html += '  </div>';

        // Footer
        html += '  <div class="fila-card-footer">';
        html += '    ' + aguardandoHtml;
        html += '    <span class="fila-footer-item"><i class="fas fa-bell"></i> Ultimo: ' + escapeHtml(ultimoTexto) + '</span>';
        html += '  </div>';

        html += '</div>';
    });

    grid.innerHTML = html;
}

// =============================================================================
// RENDERIZACAO - TABELA ESPECIALIDADES
// =============================================================================

function renderizarTabela(especialidades) {
    var tbody = document.getElementById('tabela-body');
    if (!tbody) return;

    var contador = document.getElementById('contador-especialidades');

    if (!especialidades || especialidades.length === 0) {
        tbody.innerHTML = '<tr><td colspan="9" class="texto-centro texto-muted">' +
            'Nenhuma especialidade com atendimentos hoje</td></tr>';
        if (contador) contador.textContent = '0 especialidades';
        return;
    }

    if (contador) {
        contador.textContent = especialidades.length + ' especialidade' +
            (especialidades.length !== 1 ? 's' : '');
    }

    var html = '';

    especialidades.forEach(function(esp) {
        var atendidos = esp.finalizados || 0;
        var aguardando = esp.aguardando_medico || 0;
        var emConsulta = esp.em_consulta || 0;
        var medicos = esp.medicos_atendendo || 0;
        var medicosTotal = esp.medicos_total || 0;
        var producao = esp.producao_total || 0;

        html += '<tr>';
        html += '<td>' + escapeHtml(esp.especialidade) + '</td>';

        html += '<td>';
        if (medicos > 0) {
            html += '<span class="medicos-ativo">' + medicos + '</span>';
            html += '<span class="medicos-total">/' + medicosTotal + '</span>';
        } else {
            html += '<span class="medicos-total">' + medicosTotal + '</span>';
        }
        html += '</td>';

        html += '<td><span class="valor-atendidos">' + atendidos + '</span></td>';

        html += '<td>';
        if (aguardando > 0) {
            html += '<span class="aguardando-badge">' + aguardando + '</span>';
        } else {
            html += '<span class="aguardando-badge vazio">0</span>';
        }
        html += '</td>';

        html += '<td>';
        if (emConsulta > 0) {
            html += '<span class="em-consulta-badge">' + emConsulta + '</span>';
        } else {
            html += '<span class="em-consulta-badge vazio">0</span>';
        }
        html += '</td>';

        html += '<td>' + renderizarTempoBadge(esp.mediana_senha_recepcao, 10, 25) + '</td>';
        html += '<td>' + renderizarTempoBadge(esp.mediana_espera_medico, 20, 40) + '</td>';
        html += '<td>' + renderizarTempoBadge(esp.mediana_consulta, 15, 30) + '</td>';

        html += '<td>';
        if (producao > 0) {
            html += '<span class="valor-producao">' + formatarMoeda(producao) + '</span>';
        } else {
            html += '<span class="texto-muted">--</span>';
        }
        html += '</td>';

        html += '</tr>';
    });

    tbody.innerHTML = html;
}

// =============================================================================
// BADGE DE TEMPO
// =============================================================================

function renderizarTempoBadge(valor, limiarMedio, limiarAlto) {
    if (valor === null || valor === undefined) {
        return '<span class="tempo-badge tempo-neutro">--</span>';
    }

    var minutos = Math.round(valor);
    var classe = 'tempo-rapido';

    if (minutos >= limiarAlto) {
        classe = 'tempo-lento';
    } else if (minutos >= limiarMedio) {
        classe = 'tempo-normal';
    }

    return '<span class="tempo-badge ' + classe + '">' + minutos + ' min</span>';
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

function formatarMoeda(valor) {
    if (valor >= 1000) {
        return (valor / 1000).toFixed(1) + 'k';
    }
    return valor.toFixed(0);
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