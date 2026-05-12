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
        clinicasConsolidado: BASE_URL + '/api/paineis/painel10/clinicas-consolidado',
        pacientesClinica: BASE_URL + '/api/paineis/painel10/pacientes-clinica',
        pacientesAlta: BASE_URL + '/api/paineis/painel10/pacientes-alta',
        atendimentosHora: BASE_URL + '/api/paineis/painel10/atendimentos-hora',
        desempenhoMedico: BASE_URL + '/api/paineis/painel10/desempenho-medico',
        desempenhoRecepcao: BASE_URL + '/api/paineis/painel10/desempenho-recepcao',
        medicosConsultorios: BASE_URL + '/api/paineis/painel18/medicos'
    },
    intervaloRefresh: 60000,
    velocidadeScroll: 0.5,
    pausaFinal: 8000,
    pausaAposReset: 5000,
    watchdogInterval: 5000,
    tempoEspera: { bom: 11, medio: 20 },
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

    // Navegação de Abas
    var tabBtns = document.querySelectorAll('.tab-nav-btn');
    tabBtns.forEach(function(btn) {
        btn.addEventListener('click', function() {
            document.querySelectorAll('.tab-nav-btn').forEach(function(b) { b.classList.remove('active'); });
            document.querySelectorAll('.tab-panel').forEach(function(p) { p.classList.remove('active'); });
            
            this.classList.add('active');
            var tabId = this.getAttribute('data-tab');
            var panel = document.getElementById('tab-' + tabId);
            if (panel) panel.classList.add('active');

            if (autoScrollAtivo) {
                pararAutoScroll();
                iniciarAutoScroll();
            }
        });
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
        { url: CONFIG.api.clinicasConsolidado, chave: 'clinicas' },
        { url: CONFIG.api.atendimentosHora, chave: 'porHora' },
        { url: CONFIG.api.desempenhoMedico, chave: 'medicos' },
        { url: CONFIG.api.desempenhoRecepcao, chave: 'recepcao' },
        { url: CONFIG.api.medicosConsultorios, chave: 'medicosConsult' }
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

    if (erros >= 5) {
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
    renderizarRecepcao(dados.recepcao);
    renderizarClinicasConsolidado(dados.clinicas);
    renderizarMedicosConsultorios(dados.medicosConsult);
    renderizarGrafico(dados.porHora);
    renderizarMedicos(dados.medicos);
}

// ----- RECEPCAO -----
function renderizarRecepcao(dados) {
    if (!dados) dados = {};

    var totalRecebidos = dados.total_recebidos || 0;
    var tempoMedio = dados.tempo_medio_recepcao_min || 0;
    var aguardando = dados.aguardando_recepcao || 0;

    atualizarEl(document.getElementById('recep-total-recebidos'), formatarNumero(totalRecebidos));
    atualizarEl(document.getElementById('recep-tempo-medio'), formatarTempo(tempoMedio) + ' min');
    atualizarEl(document.getElementById('recep-aguardando'), formatarNumero(aguardando));
}

// ----- CLINICAS CONSOLIDADO (Espera por Clínica) -----
function renderizarClinicasConsolidado(dados) {
    var tbody = document.getElementById('tbody-clinicas-consolidado');
    var contador = document.getElementById('contador-clinicas');
    if (!tbody) return;

    if (!dados || dados.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" class="texto-centro"><div class="mensagem-vazia"><i class="fas fa-inbox" style="font-size:2rem;color:var(--cor-texto-muted);margin-bottom:8px;display:block;"></i><p>Nenhuma clínica com dados hoje</p></div></td></tr>';
        if (contador) contador.textContent = '0 clínica(s)';
        return;
    }

    var totalAguardando = 0;
    var html = '';

    for (var i = 0; i < dados.length; i++) {
        var row = dados[i];
        var aguardando = row.aguardando_atendimento || 0;
        var aguardandoAlta = row.aguardando_alta || 0;
        var tempoMaxAlta = row.tempo_max_alta_min;
        totalAguardando += aguardando;

        var tempoMax = row.tempo_max_espera_min;
        var medicosAtivos = row.medicos_ativos || 0;
        var detalheId = 'detalhe-clinica-' + i;

        var tempoMaxHtml = (tempoMax !== null && tempoMax !== undefined && tempoMax > 0)
            ? '<span class="badge badge-tempo ' + getClasseTempo(tempoMax, 'espera') + '">' + tempoMax + ' min</span>'
            : '<span class="texto-muted">-</span>';

        var altaHtml;
        if (aguardandoAlta > 0) {
            var altaTempo = (tempoMaxAlta !== null && tempoMaxAlta !== undefined)
                ? '<br><small style="color:var(--cor-texto-muted);font-size:0.7rem;font-weight:400">' + tempoMaxAlta + ' min</small>'
                : '';
            altaHtml = '<span class="badge badge-aguardando-grande ' + getClasseAguardando(aguardandoAlta) + '">' + aguardandoAlta + '</span>' + altaTempo;
        } else {
            altaHtml = '<span class="texto-muted">-</span>';
        }

        var semMedicoAlerta = aguardando > 0 && medicosAtivos === 0;

        var medicosHtml = medicosAtivos > 0
            ? '<span class="badge-medico badge-medico-ativo"><i class="fas fa-circle" style="font-size:0.45rem;margin-right:3px"></i> ' + medicosAtivos + ' ativo' + (medicosAtivos > 1 ? 's' : '') + '</span>'
            : '<span class="badge-medico badge-medico-ausente' + (semMedicoAlerta ? ' badge-medico-alerta' : '') + '"><i class="fas fa-triangle-exclamation" style="font-size:0.65rem;margin-right:3px"></i> Sem médico</span>';

        html += '<tr class="tr-clinica-clickavel' + (semMedicoAlerta ? ' tr-sem-medico-alerta' : '') + '" data-clinica="' + escapeAttr(row.ds_clinica) + '" data-detalhe="' + detalheId + '">';
        html += '  <td><span class="clinica-nome"><i class="fas fa-chevron-right icone-expandir"></i> ' + escapeHtml(row.ds_clinica) + '</span></td>';
        html += '  <td class="texto-centro"><span class="badge badge-aguardando-grande ' + getClasseAguardando(aguardando) + '">' + formatarNumero(aguardando) + '</span></td>';
        html += '  <td class="texto-centro">' + altaHtml + '</td>';
        html += '  <td class="texto-centro">' + formatarNumero(row.total_atendimentos) + '</td>';
        html += '  <td class="texto-centro">' + formatarNumero(row.atendimentos_realizados) + '</td>';
        html += '  <td class="texto-centro">' + medicosHtml + '</td>';
        html += '  <td class="texto-centro">' + tempoMaxHtml + '</td>';
        html += '</tr>';

        // Linha de detalhe com sub-abas
        html += '<tr class="tr-detalhe" id="' + detalheId + '" style="display:none"><td colspan="7">';
        html += '<div class="painel-pacientes" id="painel-' + detalheId + '">';
        html += '<div class="subtabs-nav">';
        html += '<button class="subtab-btn subtab-ativo" data-clinica="' + escapeAttr(row.ds_clinica) + '" data-tipo="medico" data-container="medico-' + detalheId + '"><i class="fas fa-user-doctor"></i> Aguardando Médico</button>';
        html += '<button class="subtab-btn" data-clinica="' + escapeAttr(row.ds_clinica) + '" data-tipo="alta" data-container="alta-' + detalheId + '"><i class="fas fa-door-open"></i> Aguardando Alta</button>';
        html += '</div>';
        html += '<div class="subtab-painel" id="medico-' + detalheId + '"><div class="loading-pacientes"><i class="fas fa-spinner fa-spin"></i> Carregando pacientes...</div></div>';
        html += '<div class="subtab-painel" id="alta-' + detalheId + '" style="display:none"><div class="loading-alta"><i class="fas fa-spinner fa-spin"></i> Carregando...</div></div>';
        html += '</div></td></tr>';
    }

    tbody.innerHTML = html;
    if (contador) contador.textContent = dados.length + ' clínica(s) · ' + totalAguardando + ' aguardando';

    // Click handler nas linhas principais
    var rows = tbody.querySelectorAll('.tr-clinica-clickavel');
    for (var j = 0; j < rows.length; j++) {
        rows[j].addEventListener('click', function() {
            var dsClinica = this.getAttribute('data-clinica');
            var detalheId = this.getAttribute('data-detalhe');
            var detalheRow = document.getElementById(detalheId);
            var iconExpand = this.querySelector('.icone-expandir');
            if (!detalheRow) return;

            var isOpen = detalheRow.style.display !== 'none';

            // Fecha todos
            var allDetalhes = tbody.querySelectorAll('.tr-detalhe');
            for (var k = 0; k < allDetalhes.length; k++) { allDetalhes[k].style.display = 'none'; }
            var allClickaveis = tbody.querySelectorAll('.tr-clinica-clickavel');
            for (var m = 0; m < allClickaveis.length; m++) {
                allClickaveis[m].classList.remove('tr-clinica-ativa');
                var ic = allClickaveis[m].querySelector('.icone-expandir');
                if (ic) ic.classList.remove('expandido');
            }

            if (!isOpen) {
                detalheRow.style.display = '';
                this.classList.add('tr-clinica-ativa');
                if (iconExpand) iconExpand.classList.add('expandido');

                // Carrega sub-aba médico imediatamente
                var medContainer = document.getElementById('medico-' + detalheId);
                if (medContainer && medContainer.querySelector('.loading-pacientes')) {
                    carregarPacientesClinica(dsClinica, medContainer);
                }
            }
        });
    }

    // Delegação para cliques nas sub-abas (tbody.onclick evita duplicação em refreshes)
    tbody.onclick = function(e) {
        var btn = e.target.closest('.subtab-btn');
        if (!btn) return;

        var tipo = btn.getAttribute('data-tipo');
        var clinica = btn.getAttribute('data-clinica');
        var containerId = btn.getAttribute('data-container');
        var pPanel = btn.closest('.painel-pacientes');
        if (!pPanel) return;

        pPanel.querySelectorAll('.subtab-btn').forEach(function(b) { b.classList.remove('subtab-ativo'); });
        btn.classList.add('subtab-ativo');

        pPanel.querySelectorAll('.subtab-painel').forEach(function(c) { c.style.display = 'none'; });
        var container = document.getElementById(containerId);
        if (container) container.style.display = '';

        if (container) {
            if (tipo === 'medico' && container.querySelector('.loading-pacientes')) {
                carregarPacientesClinica(clinica, container);
            } else if (tipo === 'alta' && container.querySelector('.loading-alta')) {
                carregarPacientesAlta(clinica, container);
            }
        }
    };
}

// ----- PACIENTES DA CLINICA (sub-painel) -----
function carregarPacientesClinica(dsClinica, container) {
    fetch(CONFIG.api.pacientesClinica + '?clinica=' + encodeURIComponent(dsClinica), { credentials: 'include' })
        .then(function(r) { return r.json(); })
        .then(function(data) {
            if (!data.success) {
                container.innerHTML = '<p class="texto-muted texto-centro" style="padding:12px"><i class="fas fa-exclamation-triangle"></i> Não foi possível carregar os pacientes.</p>';
                return;
            }
            var pacientes = data.data || [];
            if (pacientes.length === 0) {
                var msg = data.aviso === 'dados_indisponiveis'
                    ? '<i class="fas fa-database"></i> Dados de pacientes indisponíveis'
                    : '<i class="fas fa-check-circle"></i> Nenhum paciente aguardando nesta clínica';
                container.innerHTML = '<div class="mensagem-sucesso-mini">' + msg + '</div>';
                return;
            }
            var html = '<div class="pacientes-grid">';
            for (var i = 0; i < pacientes.length; i++) {
                var p = pacientes[i];
                var tempo = p.tempo_espera_min || 0;
                var cls = getClasseTempo(tempo, 'espera');
                html += '<div class="paciente-item">';
                html += '  <span class="paciente-ordem">#' + (i + 1) + '</span>';
                html += '  <span class="paciente-nome">' + escapeHtml(p.nm_paciente) + '</span>';
                if (p.nr_atendimento) {
                    html += '  <span class="paciente-nr-atend">' + escapeHtml(p.nr_atendimento) + '</span>';
                }
                html += '  <span class="paciente-entrada"><i class="fas fa-calendar-clock"></i> ' + escapeHtml(p.dt_entrada) + '</span>';
                html += '  <span class="badge badge-tempo ' + cls + '">' + tempo + ' min</span>';
                html += '</div>';
            }
            html += '</div>';
            container.innerHTML = html;
        })
        .catch(function(err) {
            console.error('[Painel10] Erro ao carregar pacientes:', err);
            container.innerHTML = '<p class="texto-muted texto-centro" style="padding:12px">Falha ao carregar pacientes.</p>';
        });
}

// ----- PACIENTES AGUARDANDO ALTA (sub-painel) -----
function carregarPacientesAlta(dsClinica, container) {
    fetch(CONFIG.api.pacientesAlta + '?clinica=' + encodeURIComponent(dsClinica), { credentials: 'include' })
        .then(function(r) { return r.json(); })
        .then(function(data) {
            if (!data.success) {
                container.innerHTML = '<p class="texto-muted texto-centro" style="padding:12px"><i class="fas fa-exclamation-triangle"></i> Não foi possível carregar.</p>';
                return;
            }
            var pacientes = data.data || [];
            if (pacientes.length === 0) {
                container.innerHTML = '<div class="mensagem-sucesso-mini"><i class="fas fa-check-circle"></i> Nenhum paciente aguardando alta nesta clínica</div>';
                return;
            }
            var html = '<div class="pacientes-grid">';
            for (var i = 0; i < pacientes.length; i++) {
                var p = pacientes[i];
                var tempo = p.tempo_aguardando_alta_min || 0;
                var cls = getClasseTempo(tempo, 'espera');
                html += '<div class="paciente-item">';
                html += '  <span class="paciente-ordem">#' + (i + 1) + '</span>';
                html += '  <span class="paciente-nome">' + escapeHtml(p.nm_paciente) + '</span>';
                if (p.nr_atendimento) {
                    html += '  <span class="paciente-nr-atend">' + escapeHtml(p.nr_atendimento) + '</span>';
                }
                html += '  <span class="paciente-entrada"><i class="fas fa-stethoscope"></i> Atendido: ' + escapeHtml(p.hora_atendimento) + '</span>';
                html += '  <span class="badge badge-tempo ' + cls + '">' + tempo + ' min</span>';
                html += '</div>';
            }
            html += '</div>';
            container.innerHTML = html;
        })
        .catch(function(err) {
            console.error('[Painel10] Erro ao carregar alta:', err);
            container.innerHTML = '<p class="texto-muted texto-centro" style="padding:12px">Falha ao carregar.</p>';
        });
}

// ----- MEDICOS NOS CONSULTORIOS -----
function renderizarMedicosConsultorios(dados) {
    var grid = document.getElementById('medicos-consultorio-grid');
    var contador = document.getElementById('contador-medicos-consultorio');
    if (!grid) return;

    if (!dados || !dados.dados || dados.dados.length === 0) {
        grid.innerHTML = '<div class="mensagem-vazia"><i class="fas fa-user-md"></i><p>Nenhum médico logado no momento</p></div>';
        if (contador) contador.textContent = '0 médico(s)';
        return;
    }

    var lista = dados.dados;
    if (contador) contador.textContent = lista.length + ' médico' + (lista.length !== 1 ? 's' : '');

    var html = '';
    for (var i = 0; i < lista.length; i++) {
        var item = lista[i];
        var nome = item.ds_usuario || '-';
        var consultorio = item.consultorio || '-';
        var especialidade = item.especialidade || '';
        var tempoConectado = item.tempo_conectado || '-';
        var emConsulta = item.em_consulta || 0;
        var clinicas = item.clinicas || [];
        var atendHoje = item.atendimentos_hoje || 0;

        var statusClass = emConsulta > 0 ? 'status-atendendo' : '';

        html += '<div class="guiche-card ' + statusClass + '">';
        html += '  <div class="guiche-info">';
        html += '    <div class="guiche-header-line">';
        html += '      <span class="guiche-numero">' + escapeHtml(consultorio) + '</span>';
        html += '      <span class="guiche-tempo"><i class="fas fa-clock"></i> ' + escapeHtml(tempoConectado) + '</span>';
        html += '    </div>';
        html += '    <div class="guiche-usuario">' + escapeHtml(formatarNome(nome)) + '</div>';
        if (especialidade) {
            html += '    <div class="guiche-especialidade">' + escapeHtml(especialidade) + '</div>';
        }
        html += '  </div>';
        html += '  <div class="guiche-atendimentos">';
        html += '    <span class="guiche-atend-valor">' + atendHoje + '</span>';
        html += '    <span class="guiche-atend-label">atend.</span>';
        html += '  </div>';
        html += '</div>';
    }

    grid.innerHTML = html;
}

// ----- GRAFICO POR HORA -----
function renderizarGrafico(dados) {
    var container = document.getElementById('grafico-barras-container');
    var contador = document.getElementById('grafico-total-dia');
    if (!container) return;

    if (!dados || dados.length === 0) {
        container.innerHTML = '<div class="mensagem-vazia" style="width:100%; height:100%; display:flex; flex-direction:column; align-items:center; justify-content:center;"><i class="fas fa-inbox" style="font-size:2rem;color:var(--cor-texto-muted);margin-bottom:8px;"></i><p>Nenhum dado disponível</p></div>';
        if (contador) contador.textContent = '0 total';
        return;
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

    container.innerHTML = barras;
    if (contador) contador.textContent = totalDia + ' total';
}

// ----- DESEMPENHO MEDICOS -----
function renderizarMedicos(dados) {
    var tbody = document.getElementById('tbody-medicos');
    var contador = document.getElementById('contador-medicos');
    if (!tbody) return;

    if (!dados || dados.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" class="texto-centro"><div class="mensagem-vazia"><i class="fas fa-inbox" style="font-size:2rem;color:var(--cor-texto-muted);margin-bottom:8px;display:block;"></i><p>Nenhum médico com atendimento registrado hoje</p></div></td></tr>';
        if (contador) contador.textContent = '0 médico(s)';
        return;
    }

    if (contador) contador.textContent = dados.length + ' médico(s)';

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
    tbody.innerHTML = linhas;
}

// ----- MENSAGEM DE ERRO -----
function mostrarErro(mensagem) {
    console.error('Erro na interface:', mensagem);
    // You could show a toast or alert here instead of replacing painelMain
}

// =============================================================================
// AUTO-SCROLL COM WATCHDOG
// =============================================================================

function iniciarAutoScroll() {
    pararAutoScroll();

    var activeTab = document.querySelector('.tab-panel.active');
    if (!activeTab) return;

    var container = activeTab.querySelector('.content-scroll');
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

function getClasseAguardando(n) {
    if (n <= 2) return 'aguardando-bom';
    if (n <= 5) return 'aguardando-medio';
    if (n <= 7) return 'aguardando-critico';
    return 'aguardando-critico aguardando-piscando';
}

function formatarNome(nome) {
    if (!nome || nome === '-') return '-';
    return nome.toLowerCase().replace(/(?:^|\s)\S/g, function(letra) {
        return letra.toUpperCase();
    });
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

function escapeAttr(text) {
    if (!text) return '';
    return String(text).replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}