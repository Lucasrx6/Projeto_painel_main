// ========================================
// PAINEL 8 - ENFERMARIA COM AUTO-SCROLL ROBUSTO
// Versao com Watchdog Funcional e Compatibilidade Cross-Browser
// Correcao: Acentuacao nos icones Lab/Imagem (3 estados)
// ========================================

const BASE_URL = window.location.origin;

const CONFIG = {
    apiEnfermaria: `${BASE_URL}/api/paineis/painel8/enfermaria`,
    apiSetores: `${BASE_URL}/api/paineis/painel8/setores`,
    apiStats: `${BASE_URL}/api/paineis/painel8/stats`,
    intervaloRefresh: 95000,
    velocidadeScroll: 1,
    delayInicioAutoScroll: 10000,
    pausaNoFinal: 8000,
    pausaAposReset: 8000,
    watchdogInterval: 3000,
    watchdogTolerancia: 3,
    scrollInterval: 30
};

// ========================================
// ESTADO GLOBAL
// ========================================

const Estado = {
    dadosEnfermaria: [],
    setores: [],
    setorSelecionado: localStorage.getItem('painel8_setor') || '',
    autoScroll: {
        ativo: false,
        pausadoTemporariamente: false,
        emCicloDeReset: false,
        ultimaPosicao: 0,
        contadorTravamento: 0,
        frameId: null,
        ultimoTimestamp: 0
    },
    timers: {
        watchdog: null,
        inicioAutomatico: null,
        resetScroll: null,
        retomadaScroll: null
    },
    inicializado: false
};

// ========================================
// INICIALIZACAO
// ========================================

function inicializar() {
    console.log('[PAINEL8] Inicializando...');

    configurarBotoes();
    configurarVisibilityAPI();
    carregarSetores();

    setInterval(function() {
        if (!Estado.autoScroll.emCicloDeReset) {
            carregarDados();
        }
    }, CONFIG.intervaloRefresh);

    Estado.inicializado = true;
    console.log('[PAINEL8] Inicializacao concluida');
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', inicializar);
} else {
    inicializar();
}

// ========================================
// VISIBILITY API - PAUSA QUANDO ABA INATIVA
// ========================================

function configurarVisibilityAPI() {
    document.addEventListener('visibilitychange', function() {
        if (document.hidden) {
            console.log('[VISIBILITY] Aba inativa - pausando scroll');
            pausarScrollTemporariamente();
        } else {
            console.log('[VISIBILITY] Aba ativa - retomando scroll');
            if (Estado.autoScroll.ativo && Estado.autoScroll.pausadoTemporariamente) {
                retomarScrollTemporario();
            }
        }
    });
}

// ========================================
// CONFIGURACAO DE BOTOES
// ========================================

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
            carregarDados();
        });
    }

    var btnAutoScroll = document.getElementById('btn-auto-scroll');
    if (btnAutoScroll) {
        btnAutoScroll.addEventListener('click', function() {
            if (Estado.autoScroll.ativo) {
                desativarAutoScroll();
            } else {
                ativarAutoScroll();
            }
        });
    }

    var filtroSetor = document.getElementById('filtro-setor');
    if (filtroSetor) {
        filtroSetor.addEventListener('change', function(e) {
            Estado.setorSelecionado = e.target.value;
            localStorage.setItem('painel8_setor', Estado.setorSelecionado);
            carregarDados();
        });
    }
}

// ========================================
// CARREGAMENTO DE DADOS
// ========================================

function carregarSetores() {
    fetch(CONFIG.apiSetores)
        .then(function(res) { return res.json(); })
        .then(function(data) {
            if (data.success) {
                Estado.setores = data.setores;
                popularSelectSetores();
                carregarDados();
            }
        })
        .catch(function(erro) {
            console.error('[PAINEL8] Erro ao carregar setores:', erro);
        });
}

function popularSelectSetores() {
    var select = document.getElementById('filtro-setor');
    if (!select) return;

    select.innerHTML = '<option value="">Todos os Setores</option>';

    Estado.setores.forEach(function(setor) {
        var option = document.createElement('option');
        option.value = setor.nm_setor;
        option.textContent = setor.nm_setor;
        if (setor.nm_setor === Estado.setorSelecionado) {
            option.selected = true;
        }
        select.appendChild(option);
    });
}

function carregarDados() {
    console.log('[PAINEL8] Carregando dados...');

    var scrollEstaAtivo = Estado.autoScroll.ativo;
    if (scrollEstaAtivo) {
        pausarScrollTemporariamente();
    }

    var url = CONFIG.apiEnfermaria;
    if (Estado.setorSelecionado) {
        url += '?setor=' + encodeURIComponent(Estado.setorSelecionado);
    }

    var statsUrl = Estado.setorSelecionado
        ? CONFIG.apiStats + '?setor=' + encodeURIComponent(Estado.setorSelecionado)
        : null;

    var enfermariaPromise = fetch(url).then(function(res) {
        if (!res.ok) throw new Error('Erro ao carregar dados');
        return res.json();
    });

    var statsPromise = statsUrl
        ? fetch(statsUrl).then(function(res) { return res.json(); })
        : Promise.resolve(null);

    Promise.all([enfermariaPromise, statsPromise])
        .then(function(results) {
            var enfermariaData = results[0];
            var statsData = results[1];

            if (enfermariaData.success) {
                Estado.dadosEnfermaria = enfermariaData.data;
                renderizarTabela(Estado.dadosEnfermaria);
                atualizarHoraAtualizacao();

                if (statsData && statsData.success && statsData.stats) {
                    atualizarDashboard(statsData.stats);
                }

                if (scrollEstaAtivo) {
                    setTimeout(function() {
                        retomarScrollTemporario();
                    }, 500);
                }

                agendarInicioAutomaticoScroll();
                console.log('[PAINEL8] Dados carregados com sucesso');
            } else {
                console.error('[PAINEL8] Erro nos dados:', enfermariaData);
                mostrarErro('Erro ao processar dados');
            }
        })
        .catch(function(erro) {
            console.error('[PAINEL8] Erro:', erro);
            mostrarErro('Erro de conexao');
        });
}

function agendarInicioAutomaticoScroll() {
    if (Estado.autoScroll.ativo || Estado.timers.inicioAutomatico !== null) {
        return;
    }

    Estado.timers.inicioAutomatico = setTimeout(function() {
        console.log('[AUTO-SCROLL] Ativando automaticamente apos delay inicial');
        ativarAutoScroll();
        Estado.timers.inicioAutomatico = null;
    }, CONFIG.delayInicioAutoScroll);
}

function atualizarDashboard(stats) {
    var elementos = {
        'nome-setor': stats.nm_setor || 'Todos',
        'leitos-ocupados': stats.leitos_ocupados || 0,
        'total-leitos': stats.total_leitos || 0,
        'leitos-livres': stats.leitos_livres || 0,
        'percentual-ocupacao': stats.percentual_ocupacao || 0,
        'pacientes-criticos': stats.pacientes_criticos || 0
    };

    var ids = Object.keys(elementos);
    for (var i = 0; i < ids.length; i++) {
        var el = document.getElementById(ids[i]);
        if (el) el.textContent = elementos[ids[i]];
    }
}

// ========================================
// AUTO-SCROLL COM REQUEST ANIMATION FRAME
// ========================================

function ativarAutoScroll() {
    console.log('[AUTO-SCROLL] Ativando...');

    Estado.autoScroll.ativo = true;
    Estado.autoScroll.pausadoTemporariamente = false;
    Estado.autoScroll.emCicloDeReset = false;
    Estado.autoScroll.contadorTravamento = 0;

    atualizarBotaoAutoScroll(true);
    iniciarScrollLoop();
    iniciarWatchdog();
}

function desativarAutoScroll() {
    console.log('[AUTO-SCROLL] Desativando...');

    Estado.autoScroll.ativo = false;
    Estado.autoScroll.pausadoTemporariamente = false;
    Estado.autoScroll.emCicloDeReset = false;

    pararScrollLoop();
    pararWatchdog();
    limparTimersScroll();
    atualizarBotaoAutoScroll(false);
}

function pausarScrollTemporariamente() {
    if (!Estado.autoScroll.ativo) return;

    console.log('[AUTO-SCROLL] Pausando temporariamente...');
    Estado.autoScroll.pausadoTemporariamente = true;
    pararScrollLoop();
}

function retomarScrollTemporario() {
    if (!Estado.autoScroll.ativo || !Estado.autoScroll.pausadoTemporariamente) return;
    if (Estado.autoScroll.emCicloDeReset) return;

    console.log('[AUTO-SCROLL] Retomando apos pausa temporaria...');
    Estado.autoScroll.pausadoTemporariamente = false;
    iniciarScrollLoop();
}

function atualizarBotaoAutoScroll(ativo) {
    var btn = document.getElementById('btn-auto-scroll');
    if (!btn) return;

    if (ativo) {
        btn.classList.add('active');
        btn.innerHTML = '<i class="fas fa-pause"></i> Pausar';
    } else {
        btn.classList.remove('active');
        btn.innerHTML = '<i class="fas fa-play"></i> Auto Scroll';
    }
}

function limparTimersScroll() {
    if (Estado.timers.resetScroll) {
        clearTimeout(Estado.timers.resetScroll);
        Estado.timers.resetScroll = null;
    }
    if (Estado.timers.retomadaScroll) {
        clearTimeout(Estado.timers.retomadaScroll);
        Estado.timers.retomadaScroll = null;
    }
}

// ========================================
// SCROLL LOOP COM RAF (REQUEST ANIMATION FRAME)
// ========================================

function iniciarScrollLoop() {
    pararScrollLoop();

    var tbody = getScrollContainer();
    if (!tbody) {
        console.warn('[AUTO-SCROLL] Container de scroll nao encontrado');
        return;
    }

    Estado.autoScroll.ultimaPosicao = tbody.scrollTop;
    Estado.autoScroll.ultimoTimestamp = performance.now();

    console.log('[AUTO-SCROLL] Iniciando loop de scroll');
    executarScrollFrame();
}

function pararScrollLoop() {
    if (Estado.autoScroll.frameId) {
        cancelAnimationFrame(Estado.autoScroll.frameId);
        Estado.autoScroll.frameId = null;
    }
}

function executarScrollFrame(timestamp) {
    if (!Estado.autoScroll.ativo || Estado.autoScroll.pausadoTemporariamente) {
        return;
    }

    if (Estado.autoScroll.emCicloDeReset) {
        return;
    }

    var tbody = getScrollContainer();
    if (!tbody) {
        Estado.autoScroll.frameId = requestAnimationFrame(executarScrollFrame);
        return;
    }

    var scrollMax = tbody.scrollHeight - tbody.clientHeight;

    if (scrollMax <= 0) {
        Estado.autoScroll.frameId = requestAnimationFrame(executarScrollFrame);
        return;
    }

    var deltaTime = timestamp - Estado.autoScroll.ultimoTimestamp;

    if (deltaTime >= CONFIG.scrollInterval) {
        Estado.autoScroll.ultimoTimestamp = timestamp;

        var scrollAtual = tbody.scrollTop;

        if (scrollAtual >= scrollMax - 2) {
            iniciarCicloDeReset(tbody);
            return;
        }

        var novoScroll = Math.min(scrollAtual + CONFIG.velocidadeScroll, scrollMax);
        tbody.scrollTop = novoScroll;

        // Fallback: tenta scrollTo se scrollTop nao funcionou
        if (Math.abs(tbody.scrollTop - novoScroll) > 1) {
            try {
                tbody.scrollTo({ top: novoScroll, behavior: 'instant' });
            } catch (e) {
                tbody.scrollTop = novoScroll;
            }
        }
    }

    Estado.autoScroll.frameId = requestAnimationFrame(executarScrollFrame);
}

function iniciarCicloDeReset(tbody) {
    console.log('[AUTO-SCROLL] Chegou ao final - iniciando ciclo de reset');

    Estado.autoScroll.emCicloDeReset = true;
    pararScrollLoop();

    Estado.timers.resetScroll = setTimeout(function() {
        if (!Estado.autoScroll.ativo) {
            Estado.autoScroll.emCicloDeReset = false;
            return;
        }

        console.log('[AUTO-SCROLL] Voltando ao topo...');

        if (tbody) {
            tbody.scrollTop = 0;
            try {
                tbody.scrollTo({ top: 0, behavior: 'instant' });
            } catch (e) {
                tbody.scrollTop = 0;
            }
        }

        Estado.autoScroll.ultimaPosicao = 0;
        Estado.autoScroll.contadorTravamento = 0;

        Estado.timers.retomadaScroll = setTimeout(function() {
            if (!Estado.autoScroll.ativo) {
                Estado.autoScroll.emCicloDeReset = false;
                return;
            }

            console.log('[AUTO-SCROLL] Reiniciando scroll do topo');
            Estado.autoScroll.emCicloDeReset = false;
            iniciarScrollLoop();

        }, CONFIG.pausaAposReset);

    }, CONFIG.pausaNoFinal);
}

// ========================================
// WATCHDOG - DETECTA E CORRIGE TRAVAMENTOS
// ========================================

function iniciarWatchdog() {
    pararWatchdog();

    console.log('[WATCHDOG] Iniciando monitoramento de travamentos');

    Estado.timers.watchdog = setInterval(function() {
        verificarTravamento();
    }, CONFIG.watchdogInterval);
}

function pararWatchdog() {
    if (Estado.timers.watchdog) {
        clearInterval(Estado.timers.watchdog);
        Estado.timers.watchdog = null;
    }
}

function verificarTravamento() {
    if (!Estado.autoScroll.ativo) {
        return;
    }

    if (Estado.autoScroll.pausadoTemporariamente || Estado.autoScroll.emCicloDeReset) {
        Estado.autoScroll.contadorTravamento = 0;
        return;
    }

    var tbody = getScrollContainer();
    if (!tbody) {
        console.warn('[WATCHDOG] Container de scroll nao encontrado');
        return;
    }

    var posicaoAtual = tbody.scrollTop;
    var scrollMax = tbody.scrollHeight - tbody.clientHeight;

    if (scrollMax <= 0) {
        return;
    }

    var jaNoFinal = posicaoAtual >= scrollMax - 2;
    var posicaoMudou = Math.abs(posicaoAtual - Estado.autoScroll.ultimaPosicao) > 0.5;

    if (!posicaoMudou && !jaNoFinal) {
        Estado.autoScroll.contadorTravamento++;
        console.warn('[WATCHDOG] Possivel travamento detectado (' + Estado.autoScroll.contadorTravamento + '/' + CONFIG.watchdogTolerancia + ')');

        if (Estado.autoScroll.contadorTravamento >= CONFIG.watchdogTolerancia) {
            console.error('[WATCHDOG] TRAVAMENTO CONFIRMADO - Reiniciando auto-scroll');
            recuperarDeTravamento(tbody);
        }
    } else {
        if (Estado.autoScroll.contadorTravamento > 0) {
            console.log('[WATCHDOG] Scroll voltou a funcionar normalmente');
        }
        Estado.autoScroll.contadorTravamento = 0;
    }

    Estado.autoScroll.ultimaPosicao = posicaoAtual;
}

function recuperarDeTravamento(tbody) {
    console.log('[WATCHDOG] Executando recuperacao de travamento...');

    pararScrollLoop();
    limparTimersScroll();

    Estado.autoScroll.contadorTravamento = 0;
    Estado.autoScroll.emCicloDeReset = false;
    Estado.autoScroll.pausadoTemporariamente = false;

    if (tbody) {
        var novaPos = tbody.scrollTop + 5;
        tbody.scrollTop = novaPos;

        try {
            tbody.scrollTo({ top: novaPos, behavior: 'instant' });
        } catch (e) {
            // Fallback silencioso
        }
    }

    setTimeout(function() {
        if (Estado.autoScroll.ativo) {
            console.log('[WATCHDOG] Reiniciando scroll apos recuperacao');
            iniciarScrollLoop();
        }
    }, 500);
}

// ========================================
// UTILITARIOS
// ========================================

function getScrollContainer() {
    return document.querySelector('.enfermaria-table tbody');
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

function mostrarErro(mensagem) {
    console.error('[PAINEL8] Erro:', mensagem);

    var container = document.getElementById('enfermaria-content');
    if (!container) return;

    container.innerHTML =
        '<div class="empty-message">' +
            '<i class="fas fa-exclamation-triangle" style="color: #dc3545;"></i>' +
            '<h3>Erro ao Carregar Dados</h3>' +
            '<p>' + mensagem + '</p>' +
            '<button onclick="carregarDados()" style="' +
                'margin-top: 15px;' +
                'padding: 10px 20px;' +
                'background: #dc3545;' +
                'color: white;' +
                'border: none;' +
                'border-radius: 8px;' +
                'cursor: pointer;' +
                'font-size: 0.9rem;' +
                'font-weight: 600;' +
                'transition: all 0.3s ease;' +
            '" onmouseover="this.style.transform=\'translateY(-2px)\'"' +
               ' onmouseout="this.style.transform=\'translateY(0)\'">' +
                '<i class="fas fa-sync-alt"></i> Tentar Novamente' +
            '</button>' +
        '</div>';
}

// ========================================
// FORMATACAO DE DATAS
// ========================================

function parseOracleDate(dataString) {
    if (!dataString || dataString.trim() === '') return null;

    dataString = dataString.trim();

    if (dataString.includes('-') && (dataString.includes(' ') || dataString.split('-').length === 3)) {
        var dataParsed = new Date(dataString);
        if (!isNaN(dataParsed.getTime())) {
            return dataParsed;
        }
    }

    var meses = {
        'JAN': 0, 'FEB': 1, 'MAR': 2, 'APR': 3, 'MAY': 4, 'JUN': 5,
        'JUL': 6, 'AUG': 7, 'SEP': 8, 'OCT': 9, 'NOV': 10, 'DEC': 11
    };

    var partes = dataString.split('-');

    if (partes.length === 3 && partes[1].length === 3) {
        var dia = parseInt(partes[0]);
        var mes = meses[partes[1].toUpperCase()];
        var ano = parseInt('20' + partes[2]);

        if (!isNaN(dia) && mes !== undefined && !isNaN(ano)) {
            return new Date(ano, mes, dia);
        }
    }

    return null;
}

function formatarData(dataString) {
    var data = parseOracleDate(dataString);
    if (!data) return 'Nao informado';

    var dia = String(data.getDate()).padStart(2, '0');
    var mes = String(data.getMonth() + 1).padStart(2, '0');
    var ano = data.getFullYear();

    return dia + '/' + mes + '/' + ano;
}

function getBadgeDataAlta(dataString) {
    if (!dataString || dataString.trim() === '') {
        return '<span class="badge-alta badge-sem-info">Nao informado</span>';
    }

    var dataAlta = parseOracleDate(dataString);
    if (!dataAlta) {
        return '<span class="badge-alta badge-sem-info">Data invalida</span>';
    }

    var hoje = new Date();
    hoje.setHours(0, 0, 0, 0);
    dataAlta.setHours(0, 0, 0, 0);

    var diffTime = dataAlta - hoje;
    var diffDias = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

    var dataFormatada = formatarData(dataString);

    if (diffDias <= 1 && diffDias >= 0) {
        return '<span class="badge-alta badge-verde" title="Alta prevista: ' + dataFormatada + '">' +
            '<i class="fas fa-calendar-check"></i> ' + (diffDias === 0 ? 'Hoje' : 'Amanha') +
        '</span>';
    }

    if (diffDias >= 2 && diffDias <= 4) {
        return '<span class="badge-alta badge-amarelo" title="Alta prevista: ' + dataFormatada + '">' +
            '<i class="fas fa-calendar-day"></i> ' + diffDias + ' dias' +
        '</span>';
    }

    if (diffDias >= 5) {
        return '<span class="badge-alta badge-vermelho" title="Alta prevista: ' + dataFormatada + '">' +
            '<i class="fas fa-calendar-alt"></i> ' + diffDias + ' dias' +
        '</span>';
    }

    if (diffDias < 0) {
        return '<span class="badge-alta badge-atrasado" title="Alta prevista: ' + dataFormatada + '">' +
            '<i class="fas fa-exclamation-triangle"></i> Atrasada (' + Math.abs(diffDias) + ' dias)' +
        '</span>';
    }

    return '<span class="badge-alta badge-sem-info">' + dataFormatada + '</span>';
}

function formatarEspecialidade(especialidade) {
    if (!especialidade || especialidade.trim() === '') {
        return '<span class="texto-neutro">-</span>';
    }
    return '<span class="especialidade">' + especialidade + '</span>';
}

// ========================================
// RENDERIZACAO DA TABELA
// ========================================

function renderizarTabela(dados) {
    var container = document.getElementById('enfermaria-content');
    if (!container) return;

    if (!dados || dados.length === 0) {
        container.innerHTML =
            '<div class="empty-message">' +
                '<i class="fas fa-inbox"></i>' +
                '<h3>Nenhum registro encontrado</h3>' +
                '<p>Nao ha dados para o setor selecionado</p>' +
            '</div>';
        return;
    }

    var linhas = '';
    for (var i = 0; i < dados.length; i++) {
        linhas += criarLinhaTabela(dados[i]);
    }

    var html =
        '<div class="enfermaria-table-wrapper">' +
            '<table class="enfermaria-table">' +
                '<thead>' +
                    '<tr>' +
                        '<th>Alta Prevista</th>' +
                        '<th>Leito</th>' +
                        '<th>Atendimento</th>' +
                        '<th>Paciente</th>' +
                        '<th>Especialidade</th>' +
                        '<th>Idade</th>' +
                        '<th>Dias</th>' +
                        '<th>Prescricao</th>' +
                        '<th>Lab</th>' +
                        '<th>Imagem</th>' +
                        '<th>Evolucao</th>' +
                        '<th>Parecer</th>' +
                        '<th>Alergia</th>' +
                        '<th>NEWS</th>' +
                    '</tr>' +
                '</thead>' +
                '<tbody>' +
                    linhas +
                '</tbody>' +
            '</table>' +
        '</div>';

    container.innerHTML = html;
}

function criarLinhaTabela(registro) {
    var isVazio = !registro.atendimento;
    var scoreNews = registro.score_news || 0;

    var rowClass = '';
    if (isVazio) {
        rowClass = 'leito-vazio';
    } else if (scoreNews >= 7) {
        rowClass = 'news-alto-risco';
    } else if (scoreNews >= 5) {
        rowClass = 'news-medio-risco';
    }

    var nomeFormatado = formatarNome(registro.paciente);
    var idadeFormatada = registro.idade ? registro.idade + ' anos' : '-';

    if (isVazio) {
        return '<tr class="' + rowClass + '">' +
            '<td><span class="texto-neutro">-</span></td>' +
            '<td><strong>' + registro.leito + '</strong></td>' +
            '<td>-</td>' +
            '<td>VAZIO</td>' +
            '<td><span class="texto-neutro">-</span></td>' +
            '<td>-</td>' +
            '<td>-</td>' +
            '<td><span class="texto-neutro">-</span></td>' +
            '<td><span class="texto-neutro">-</span></td>' +
            '<td><span class="texto-neutro">-</span></td>' +
            '<td><span class="texto-neutro">-</span></td>' +
            '<td><span class="texto-neutro">-</span></td>' +
            '<td><span class="texto-neutro">-</span></td>' +
            '<td><span class="texto-neutro">-</span></td>' +
        '</tr>';
    }

    return '<tr class="' + rowClass + '">' +
        '<td>' + getBadgeDataAlta(registro.dt_previsto_alta) + '</td>' +
        '<td><strong>' + registro.leito + '</strong></td>' +
        '<td>' + (registro.atendimento || '-') + '</td>' +
        '<td>' + nomeFormatado + '</td>' +
        '<td>' + formatarEspecialidade(registro.especialidade) + '</td>' +
        '<td>' + idadeFormatada + '</td>' +
        '<td>' + (registro.dias_internado || '-') + '</td>' +
        '<td>' + getIconePrescricao(registro.nr_prescricao) + '</td>' +
        '<td>' + getIconeLab(registro.prescrito_lab_dia) + '</td>' +
        '<td>' + getIconeImagem(registro.prescrito_proc_dia) + '</td>' +
        '<td>' + getIconeEvolucao(registro.evol_medico) + '</td>' +
        '<td>' + getIconeParecer(registro.parecer_pendente) + '</td>' +
        '<td>' + getIconeAlergia(registro.alergia) + '</td>' +
        '<td>' + getBadgeNEWS(scoreNews) + '</td>' +
    '</tr>';
}

function formatarNome(nomeCompleto) {
    if (!nomeCompleto || nomeCompleto.trim() === '') return '-';
    var partes = nomeCompleto.trim().toUpperCase().split(/\s+/);
    if (partes.length === 1) return partes[0];
    var iniciais = partes.slice(0, -1).map(function(parte) { return parte.charAt(0); }).join(' ');
    var ultimoNome = partes[partes.length - 1];
    return iniciais + ' ' + ultimoNome;
}

// ========================================
// ICONES COLORIDOS - 3 ESTADOS
// ========================================
// NULL  -> Sem prescricao     -> traço neutro (-)
// "Não" -> Prescrito/Pendente -> icone vermelho (aguardando resultado)
// "Sim" -> Resultado liberado -> icone verde (concluido)
// ========================================

function getIconePrescricao(nr_prescricao) {
    if (!nr_prescricao) {
        return '<i class="fas fa-clipboard icone-vermelho" title="Sem prescricao"></i>';
    }
    return '<i class="fas fa-clipboard-check icone-verde" title="Com prescricao"></i>';
}

/**
 * Icone de Laboratorio - 3 estados
 * NULL -> sem exame prescrito -> traço neutro
 * "Não" -> exame prescrito, resultado pendente -> icone vermelho
 * "Sim" -> exame prescrito, resultado liberado -> icone verde
 */
function getIconeLab(valor) {
    if (!valor || valor === '' || valor === null || valor === undefined) {
        return '<span class="texto-neutro">-</span>';
    }
    if (valor === 'Sim') {
        return '<i class="fas fa-flask icone-verde" title="Resultado liberado"></i>';
    }
    // "Não" (com ou sem acento)
    if (valor === 'Não' || valor === 'Nao' || valor === 'N\u00e3o') {
        return '<i class="fas fa-flask icone-vermelho" title="Resultado pendente"></i>';
    }
    return '<span class="texto-neutro">-</span>';
}

/**
 * Icone de Imagem - 3 estados
 * NULL -> sem exame prescrito -> traço neutro
 * "Não" -> exame prescrito, laudo pendente -> icone vermelho
 * "Sim" -> exame prescrito, laudo liberado -> icone verde
 */
function getIconeImagem(valor) {
    if (!valor || valor === '' || valor === null || valor === undefined) {
        return '<span class="texto-neutro">-</span>';
    }
    if (valor === 'Sim') {
        return '<i class="fas fa-x-ray icone-verde" title="Laudo liberado"></i>';
    }
    // "Não" (com ou sem acento)
    if (valor === 'Não' || valor === 'Nao' || valor === 'N\u00e3o') {
        return '<i class="fas fa-x-ray icone-vermelho" title="Laudo pendente"></i>';
    }
    return '<span class="texto-neutro">-</span>';
}

function getIconeEvolucao(valor) {
    if (valor === 'Feito') {
        return '<i class="fas fa-file-medical icone-verde" title="Evolucao feita"></i>';
    }
    return '<i class="fas fa-file-medical icone-vermelho" title="Evolucao pendente"></i>';
}

function getIconeParecer(valor) {
    if (valor === 'Sim') {
        return '<i class="fas fa-clipboard-list icone-vermelho" title="Parecer pendente"></i>';
    }
    return '<span class="texto-neutro">-</span>';
}

function getIconeAlergia(valor) {
    if (valor === 'Sim') {
        return '<i class="fas fa-exclamation-triangle icone-amarelo" title="Paciente com alergia"></i>';
    }
    return '<span class="texto-neutro">-</span>';
}

function getBadgeNEWS(score) {
    if (!score || score < 5) {
        return '<span class="texto-neutro">-</span>';
    }

    if (score >= 5 && score < 7) {
        return '<i class="fas fa-exclamation-circle news-icon-medio" title="Medio Risco (NEWS 5-6)"></i>';
    }

    return '<i class="fas fa-exclamation-triangle news-icon-alto" title="Alto Risco (NEWS >= 7)"></i>';
}

// ========================================
// DEBUG - FUNCOES GLOBAIS PARA CONSOLE
// ========================================

window.debugAutoScroll = function() {
    console.log('=== DEBUG AUTO-SCROLL ===');
    console.log('Estado:', JSON.stringify(Estado.autoScroll, null, 2));

    var tbody = getScrollContainer();
    if (tbody) {
        console.log('ScrollTop:', tbody.scrollTop);
        console.log('ScrollHeight:', tbody.scrollHeight);
        console.log('ClientHeight:', tbody.clientHeight);
        console.log('ScrollMax:', tbody.scrollHeight - tbody.clientHeight);
    } else {
        console.log('Container de scroll nao encontrado');
    }

    console.log('Timers ativos:', {
        watchdog: !!Estado.timers.watchdog,
        inicioAutomatico: !!Estado.timers.inicioAutomatico,
        resetScroll: !!Estado.timers.resetScroll,
        retomadaScroll: !!Estado.timers.retomadaScroll
    });
};

window.forcarReinicioScroll = function() {
    console.log('=== FORCANDO REINICIO DO SCROLL ===');
    desativarAutoScroll();
    setTimeout(function() {
        ativarAutoScroll();
    }, 1000);
};