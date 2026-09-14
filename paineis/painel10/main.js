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

var PAINEL_VERSAO = '1.0.54';
var BASE_URL = window.location.origin;

var CONFIG = {
    api: {
        clinicasConsolidado: BASE_URL + '/api/paineis/painel10/clinicas-consolidado',
        pacientesClinica: BASE_URL + '/api/paineis/painel10/pacientes-clinica',
        pacientesAlta: BASE_URL + '/api/paineis/painel10/pacientes-alta',
        desempenhoRecepcao: BASE_URL + '/api/paineis/painel10/desempenho-recepcao',
        senhasAguardando: BASE_URL + '/api/paineis/painel10/senhas-aguardando',
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
        { url: CONFIG.api.clinicasConsolidado, chave: 'clinicas' },
        { url: CONFIG.api.desempenhoRecepcao, chave: 'recepcao' },
        { url: CONFIG.api.senhasAguardando, chave: 'senhas' },
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
                    // Preserva aviso de tabela nao encontrada para senhas
                    if (ep.chave === 'senhas' && data.aviso) {
                        resultados['senhasAviso'] = data.aviso;
                    }
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

    // Renderizar conteudo principal
    renderizarConteudo(dados);
    atualizarTimestamp();
    atualizarStatus('online');

    console.log('[Painel10] Dados carregados com sucesso');
}

// =============================================================================
// RENDERIZACAO DO CONTEUDO PRINCIPAL
// =============================================================================

function renderizarConteudo(dados) {
    renderizarRecepcao(dados.recepcao);
    renderizarSenhasAguardando(dados.senhas, dados.senhasAviso);
    renderizarClinicasConsolidado(dados.clinicas);
    renderizarMedicosConsultorios(dados.medicosConsult);
}

// ----- SENHAS AGUARDANDO RECEPCAO -----
function renderizarSenhasAguardando(dados, aviso) {
    var tbody = document.getElementById('tbody-senhas-aguardando');
    var contador = document.getElementById('contador-senhas');
    if (!tbody) return;

    if (aviso === 'tabela_nao_encontrada') {
        tbody.innerHTML = '<tr><td colspan="4" class="texto-centro"><div class="mensagem-vazia"><i class="fas fa-database" style="font-size:1.8rem;color:var(--cor-texto-muted);margin-bottom:6px;display:block;"></i><p>Tabela de senhas não encontrada no banco de dados</p></div></td></tr>';
        if (contador) contador.textContent = '–';
        return;
    }

    var lista = (dados && Array.isArray(dados)) ? dados : [];

    if (lista.length === 0) {
        tbody.innerHTML = '<tr><td colspan="4" class="texto-centro"><div class="mensagem-vazia"><i class="fas fa-check-circle" style="font-size:1.8rem;color:var(--cor-texto-muted);margin-bottom:6px;display:block;"></i><p>Nenhuma senha aguardando</p></div></td></tr>';
        if (contador) contador.textContent = '0 senha(s)';
        return;
    }

    if (contador) contador.textContent = lista.length + ' senha' + (lista.length !== 1 ? 's' : '') + ' aguardando';

    var html = '';
    for (var i = 0; i < lista.length; i++) {
        var row = lista[i];
        var senha = row.ds_senha || '-';
        var fila = row.ds_fila || '-';
        var espera = row.hr_espera || '-';

        // Classifica urgência pelo tempo de espera (HH:MM)
        var cls = 'tempo-bom';
        if (espera !== '-') {
            var partes = espera.split(':');
            if (partes.length >= 2) {
                var totalMin = parseInt(partes[0], 10) * 60 + parseInt(partes[1], 10);
                cls = getClasseTempo(totalMin, 'espera');
            }
        }

        html += '<tr>';
        html += '  <td class="texto-centro texto-muted">' + (i + 1) + '</td>';
        html += '  <td class="texto-centro"><strong class="senha-codigo">' + escapeHtml(senha) + '</strong></td>';
        html += '  <td>' + escapeHtml(fila) + '</td>';
        html += '  <td class="texto-centro"><span class="badge badge-tempo ' + cls + '">' + escapeHtml(espera) + '</span></td>';
        html += '</tr>';
    }
    tbody.innerHTML = html;
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
            var tempoAltaCls = (tempoMaxAlta !== null && tempoMaxAlta !== undefined) ? getClasseTempo(tempoMaxAlta, 'espera') : '';
            var altaTempoHtml = (tempoMaxAlta !== null && tempoMaxAlta !== undefined)
                ? ' <span class="badge badge-tempo ' + tempoAltaCls + '" style="margin-left:4px">' + tempoMaxAlta + ' min</span>'
                : '';
            altaHtml = '<span class="badge badge-aguardando-grande ' + getClasseAguardando(aguardandoAlta) + '">' + aguardandoAlta + '</span>' + altaTempoHtml;
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
        html += '  <td class="texto-centro">' + formatarNumero(row.total_atendimentos) + '</td>';
        html += '  <td class="texto-centro">' + formatarNumero(row.atendimentos_realizados) + '</td>';
        html += '  <td class="texto-centro">' + medicosHtml + '</td>';
        html += '  <td class="texto-centro">' + tempoMaxHtml + '</td>';
        html += '  <td class="texto-centro">' + altaHtml + '</td>';
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