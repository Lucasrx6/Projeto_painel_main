// =============================================================================
// PAINEL 38 - SCORE FARMACEUTICO CLINICO
// Hospital Anchieta Ceilandia
// ES5 puro — sem const/let, arrow functions ou template literals
// =============================================================================

(function () {
    'use strict';

    var CONFIG = {
        ENDPOINTS: {
            filtros:   '/api/paineis/painel38/filtros',
            dashboard: '/api/paineis/painel38/dashboard',
            dados:     '/api/paineis/painel38/dados'
        },
        INTERVALO_REFRESH:  60000,
        VELOCIDADE_SCROLL:  0.5,
        INTERVALO_SCROLL:   50,
        PAUSA_FIM:          3000,
        WATCHDOG_LIMITE:    10,
        STORAGE_PREFIX:     'painel38_'
    };

    var Estado = {
        filtros: {
            setor:         [],
            classificacao: [],
            status_visita: [],
            busca:         ''
        },
        pacientes:       [],
        carregando:      false,
        scrollAtivo:     false,
        scrollIntervalo: null,
        ultimaPosicao:   0,
        contadorTravado: 0,
        modalAberto:     false
    };

    var DOM = {};

    // =========================================================
    // LOCALSTORAGE
    // =========================================================

    function salvar(chave, valor) {
        try {
            localStorage.setItem(CONFIG.STORAGE_PREFIX + chave, JSON.stringify(valor));
        } catch (e) { /* storage indisponivel */ }
    }

    function recuperar(chave, padrao) {
        try {
            var raw = localStorage.getItem(CONFIG.STORAGE_PREFIX + chave);
            if (raw === null || raw === undefined) {
                return padrao !== undefined ? padrao : null;
            }
            return JSON.parse(raw);
        } catch (e) {
            return padrao !== undefined ? padrao : null;
        }
    }

    // =========================================================
    // INICIALIZAR
    // =========================================================

    function inicializar() {
        DOM.filtrosBar        = document.getElementById('filtros-bar');
        DOM.tabelaBody        = document.getElementById('tabela-body');
        DOM.totalBadge        = document.getElementById('total-badge');
        DOM.ultimaAtualizacao = document.getElementById('ultima-atualizacao');
        
        DOM.kpiTotal          = document.getElementById('kpi-total');
        DOM.kpiCritico        = document.getElementById('kpi-critico');
        DOM.kpiMedio          = document.getElementById('kpi-medio');
        DOM.kpiLeve           = document.getElementById('kpi-leve');
        DOM.kpiCriticosSemVis = document.getElementById('kpi-criticos-sem-visita');
        DOM.kpiVisitas30d     = document.getElementById('kpi-visitas-30d');
        DOM.kpiScoreMedio     = document.getElementById('kpi-score-medio');
        
        DOM.inputBusca        = document.getElementById('filtro-busca');

        // Restaura filtros ANTES de qualquer fetch
        Estado.filtros.setor         = recuperar('filtro_setor', []);
        Estado.filtros.classificacao = recuperar('filtro_classificacao', []);
        Estado.filtros.status_visita = recuperar('filtro_status_visita', []);
        Estado.filtros.busca         = recuperar('filtro_busca', '');

        if (DOM.inputBusca) {
            DOM.inputBusca.value = Estado.filtros.busca;
        }

        configurarBotoes();
        configurarToggleMultiSelects();
        configurarBusca();
        configurarModal();

        carregarFiltrosDinamicos(function () {
            vincularCheckboxesMultiSelect();
            carregarDados();
        });

        iniciarAutoRefresh();
        iniciarAutoScroll();
    }

    // =========================================================
    // BOTOES
    // =========================================================

    function configurarBotoes() {
        var btnToggle = document.getElementById('btn-toggle-filtros');
        if (btnToggle) {
            btnToggle.addEventListener('click', function () {
                var bar = DOM.filtrosBar;
                if (!bar) return;
                bar.style.display = bar.style.display === 'none' ? 'block' : 'none';
            });
        }

        var btnVoltar = document.getElementById('btn-voltar');
        if (btnVoltar) {
            btnVoltar.addEventListener('click', function () {
                window.location.href = '/frontend/dashboard.html';
            });
        }

        var btnRefresh = document.getElementById('btn-refresh');
        if (btnRefresh) {
            btnRefresh.addEventListener('click', function () {
                var icone = btnRefresh.querySelector('i');
                if (icone) icone.classList.add('girando');
                carregarDados();
                setTimeout(function () {
                    if (icone) icone.classList.remove('girando');
                }, 600);
            });
        }

        var btnLimpar = document.getElementById('btn-limpar-filtros');
        if (btnLimpar) {
            btnLimpar.addEventListener('click', limparFiltros);
        }

        var btnExportar = document.getElementById('btn-exportar');
        if (btnExportar) {
            btnExportar.addEventListener('click', exportarExcel);
        }

        var btnScroll = document.getElementById('btn-auto-scroll');
        if (btnScroll) {
            btnScroll.addEventListener('click', function () {
                Estado.scrollAtivo = !Estado.scrollAtivo;
                if (Estado.scrollAtivo) {
                    btnScroll.classList.add('ativo');
                    btnScroll.innerHTML = '<i class="fas fa-pause"></i> <span class="btn-text">Pausar</span>';
                    if (!Estado.scrollIntervalo) iniciarAutoScroll();
                } else {
                    btnScroll.classList.remove('ativo');
                    btnScroll.innerHTML = '<i class="fas fa-play"></i> <span class="btn-text">Auto Scroll</span>';
                    pararAutoScroll();
                }
            });
        }
    }

    // =========================================================
    // BUSCA COM DEBOUNCE
    // =========================================================

    function configurarBusca() {
        if (!DOM.inputBusca) return;
        var timer = null;
        DOM.inputBusca.addEventListener('input', function () {
            clearTimeout(timer);
            timer = setTimeout(function () {
                Estado.filtros.busca = DOM.inputBusca.value.trim();
                salvar('filtro_busca', Estado.filtros.busca);
                carregarDados();
            }, 400);
        });
    }

    // =========================================================
    // MULTI-SELECT — TOGGLE
    // =========================================================

    function configurarToggleMultiSelects() {
        var elementos = document.querySelectorAll('.multi-select');
        var i;
        for (i = 0; i < elementos.length; i++) {
            (function (el) {
                var trigger  = el.querySelector('.ms-toggle');
                var dropdown = el.querySelector('.ms-dropdown');
                if (!trigger || !dropdown) return;

                trigger.addEventListener('click', function (e) {
                    e.stopPropagation();
                    var estaAberto = !dropdown.hasAttribute('hidden');
                    fecharTodosDropdowns();
                    if (!estaAberto) {
                        dropdown.removeAttribute('hidden');
                    }
                });
            })(elementos[i]);
        }

        document.addEventListener('click', fecharTodosDropdowns);
    }

    function fecharTodosDropdowns() {
        var todos = document.querySelectorAll('.ms-dropdown');
        var j;
        for (j = 0; j < todos.length; j++) {
            todos[j].setAttribute('hidden', '');
        }
    }

    // =========================================================
    // MULTI-SELECT — VINCULAR CHECKBOXES
    // =========================================================

    function vincularCheckboxesMultiSelect() {
        var elementos = document.querySelectorAll('.multi-select');
        var i;
        for (i = 0; i < elementos.length; i++) {
            (function (el) {
                var stateKey    = el.getAttribute('data-state-key');
                var placeholder = el.getAttribute('data-placeholder') || 'Selecione';
                var trigger     = el.querySelector('.ms-toggle');
                var checkboxes  = el.querySelectorAll('input[type="checkbox"]');
                var salvos      = Estado.filtros[stateKey] || [];
                var k, j;

                for (k = 0; k < checkboxes.length; k++) {
                    checkboxes[k].checked = (salvos.indexOf(checkboxes[k].value) !== -1);
                }
                atualizarToggleLabel(trigger, checkboxes, placeholder);

                for (j = 0; j < checkboxes.length; j++) {
                    (function (cb) {
                        cb.addEventListener('change', function () {
                            var selecionados = [];
                            var m;
                            for (m = 0; m < checkboxes.length; m++) {
                                if (checkboxes[m].checked) {
                                    selecionados.push(checkboxes[m].value);
                                }
                            }
                            Estado.filtros[stateKey] = selecionados;
                            salvar('filtro_' + stateKey, selecionados);
                            atualizarToggleLabel(trigger, checkboxes, placeholder);
                            carregarDados();
                        });
                    })(checkboxes[j]);
                }
            })(elementos[i]);
        }
    }

    function atualizarToggleLabel(trigger, checkboxes, placeholder) {
        if (!trigger) return;
        var selecionados = [];
        var i;
        for (i = 0; i < checkboxes.length; i++) {
            if (checkboxes[i].checked) {
                selecionados.push(
                    checkboxes[i].getAttribute('data-label') || checkboxes[i].value
                );
            }
        }
        if (selecionados.length === 0) {
            trigger.textContent = placeholder;
        } else if (selecionados.length <= 2) {
            trigger.textContent = selecionados.join(', ');
        } else {
            trigger.textContent = selecionados.length + ' selecionados';
        }
    }

    // =========================================================
    // QUERY PARAMS
    // =========================================================

    function construirParams() {
        var parts = [];
        if (Estado.filtros.setor && Estado.filtros.setor.length > 0) {
            parts.push('setor=' + encodeURIComponent(Estado.filtros.setor.join(',')));
        }
        if (Estado.filtros.classificacao && Estado.filtros.classificacao.length > 0) {
            parts.push('classificacao=' + encodeURIComponent(Estado.filtros.classificacao.join(',')));
        }
        if (Estado.filtros.status_visita && Estado.filtros.status_visita.length > 0) {
            parts.push('status_visita=' + encodeURIComponent(Estado.filtros.status_visita.join(',')));
        }
        if (Estado.filtros.busca) {
            parts.push('busca=' + encodeURIComponent(Estado.filtros.busca));
        }
        return parts.length ? '?' + parts.join('&') : '';
    }

    // =========================================================
    // CARREGAR FILTROS DINAMICOS
    // =========================================================

    function carregarFiltrosDinamicos(callback) {
        fetch(CONFIG.ENDPOINTS.filtros)
            .then(function (r) { return r.json(); })
            .then(function (data) {
                if (data.success) {
                    popularMultiSelect('setor',         data.setores,        'codigo', 'nome');
                    popularMultiSelect('classificacao', data.classificacoes, 'codigo', 'label');
                    popularMultiSelect('status_visita', data.status_visita,  'codigo', 'label');
                }
                if (typeof callback === 'function') callback();
            })
            .catch(function (e) {
                console.error('Erro ao carregar filtros:', e);
                if (typeof callback === 'function') callback();
            });
    }

    function popularMultiSelect(stateKey, itens, campoValor, campoLabel) {
        var el = document.querySelector('.multi-select[data-state-key="' + stateKey + '"]');
        if (!el) return;
        var dropdown = el.querySelector('.ms-dropdown');
        if (!dropdown) return;

        dropdown.innerHTML = '';
        var i;
        for (i = 0; i < itens.length; i++) {
            var item  = itens[i];
            var label = document.createElement('label');
            label.className = 'ms-option';
            var cb = document.createElement('input');
            cb.type  = 'checkbox';
            cb.value = String(item[campoValor]);
            cb.setAttribute('data-label', item[campoLabel]);
            label.appendChild(cb);
            label.appendChild(document.createTextNode(' ' + item[campoLabel]));
            dropdown.appendChild(label);
        }
    }

    // =========================================================
    // CARREGAR DADOS
    // =========================================================

    function carregarDados() {
        if (Estado.carregando) return;
        Estado.carregando = true;

        var params    = construirParams();
        var urlDash   = CONFIG.ENDPOINTS.dashboard + params;
        var urlDados  = CONFIG.ENDPOINTS.dados      + params;

        var promDash  = fetch(urlDash).then(function (r) { return r.json(); });
        var promDados = fetch(urlDados).then(function (r) { return r.json(); });

        Promise.all([promDash, promDados])
            .then(function (resultados) {
                var dash  = resultados[0];
                var dados = resultados[1];

                if (dash.success)  renderizarKPIs(dash);
                if (dados.success) {
                    Estado.pacientes = dados.pacientes;
                    renderizarTabela(dados.pacientes);
                }
                atualizarTimestamp();
                Estado.carregando = false;
            })
            .catch(function (e) {
                console.error('Erro ao carregar dados:', e);
                Estado.carregando = false;
            });
    }

    // =========================================================
    // RENDERIZAR KPIs
    // =========================================================

    function renderizarKPIs(d) {
        if (DOM.kpiTotal)          DOM.kpiTotal.textContent          = d.total_pacientes || 0;
        if (DOM.kpiCritico)        DOM.kpiCritico.textContent        = d.critico         || 0;
        if (DOM.kpiMedio)          DOM.kpiMedio.textContent          = d.medio           || 0;
        if (DOM.kpiLeve)           DOM.kpiLeve.textContent           = d.leve            || 0;
        if (DOM.kpiCriticosSemVis) DOM.kpiCriticosSemVis.textContent = d.criticos_sem_visita_recente || 0;
        if (DOM.kpiVisitas30d)     DOM.kpiVisitas30d.textContent     = d.visitas_30d_total || 0;
        
        if (DOM.kpiScoreMedio) {
            DOM.kpiScoreMedio.textContent = 'Score medio: ' + (d.score_medio ? d.score_medio.toFixed(1) : '--');
        }
    }

    // =========================================================
    // RENDERIZAR TABELA
    // =========================================================

    function renderizarTabela(pacientes) {
        if (!DOM.tabelaBody) return;

        if (DOM.totalBadge) {
            var n = pacientes.length;
            DOM.totalBadge.textContent = n + ' paciente' + (n !== 1 ? 's' : '');
        }

        if (!pacientes || pacientes.length === 0) {
            DOM.tabelaBody.innerHTML =
                '<tr><td colspan="11" class="vazio">' +
                '<i class="fas fa-inbox"></i> Nenhum paciente encontrado</td></tr>';
            return;
        }

        var html = '';
        var i;
        for (i = 0; i < pacientes.length; i++) {
            html += construirLinha(pacientes[i], i);
        }
        DOM.tabelaBody.innerHTML = html;
        
        // Adiciona listeners para abrir modal
        var links = DOM.tabelaBody.querySelectorAll('.js-abrir-modal');
        var j;
        for (j = 0; j < links.length; j++) {
            links[j].addEventListener('click', function(e) {
                var idx = parseInt(this.getAttribute('data-index'), 10);
                var p = Estado.pacientes[idx];
                if (p) abrirModalCriterios(p);
            });
        }
    }

    function construirLinha(p, idx) {
        var classe = '';
        var isCritico = p.ie_classificacao === 'CRITICO';
        var isAtrasadaOuSemVisita = p.ie_status_visita === 'ATRASADA' || p.ie_status_visita === 'SEM_VISITA';
        
        if (isCritico && isAtrasadaOuSemVisita) classe = 'linha-critica-prioritaria';
        else if (isCritico)                     classe = 'linha-critica';
        else if (p.ie_classificacao === 'MEDIO' && isAtrasadaOuSemVisita) classe = 'linha-atencao';

        var idadeSexo = '';
        if (p.idade !== null && p.idade !== undefined) idadeSexo += p.idade + 'a';
        if (p.ie_sexo) idadeSexo += (idadeSexo ? ' ' : '') + p.ie_sexo;

        var iconeAlerta = (isCritico && isAtrasadaOuSemVisita) ? '<i class="fas fa-exclamation-triangle icone-alerta"></i> ' : '';

        var subInfo = esc(p.ds_convenio || '-');
        if (idadeSexo) subInfo += ' • ' + esc(idadeSexo);

        var pacienteCell =
            '<div class="paciente-nome js-abrir-modal" title="' + esc(p.nm_paciente || '') + '" data-index="' + idx + '">' +
                iconeAlerta + esc(p.nm_paciente || '-') +
            '</div>' +
            '<span class="paciente-info">' + subInfo + '</span>';

        var internDias = (p.qt_dia_permanencia !== null && p.qt_dia_permanencia !== undefined)
            ? p.qt_dia_permanencia + 'd' : '-';

        var classeScore = 'score-leve';
        if (p.ie_classificacao === 'CRITICO') classeScore = 'score-critico';
        else if (p.ie_classificacao === 'MEDIO') classeScore = 'score-medio';

        var badgeClassif = '<span class="badge-classif badge-classif-' + esc(p.ie_classificacao) + '">' + 
                           esc(p.ie_classificacao) + '</span>';

        var qtdCriterios = '<span class="criterios-link js-abrir-modal" data-index="' + idx + '">' + 
                           (p.qt_criterios || 0) + ' <i class="fas fa-info-circle"></i></span>';
                           
        var textoVisita = '-';
        if (p.dt_ultima_visita) {
            textoVisita = '<div class="visita-info">' + formatarDataHora(p.dt_ultima_visita) + 
                          '<span class="farm-nome">' + esc(p.nm_farmaceutico || '') + '</span></div>';
        }

        var badgeStatusVisita = '<span class="badge-visita badge-visita-' + esc(p.ie_status_visita) + '">' + 
                                (p.ie_status_visita === 'SEM_VISITA' ? 'Sem registro' : esc(p.ie_status_visita)) + '</span>' +
                                '<span class="texto-status">' + formatarTempoSemVisita(p.qt_dias_sem_visita) + '</span>';

        return '<tr class="' + classe + '">' +
            '<td><span class="badge-setor">' + esc(p.ds_setor_atendimento || '-') + '</span></td>' +
            '<td class="leito-col">'      + esc(p.cd_unidade_basica || '-') + '</td>' +
            '<td class="atend-col">'      + esc(p.nr_atendimento || '-')    + '</td>' +
            '<td>'                        + pacienteCell                     + '</td>' +
            '<td class="center-col">'     + internDias                       + '</td>' +
            '<td>'                        + esc(p.nm_medico || '-')          + '</td>' +
            '<td class="center-col"><span class="score-destaque ' + classeScore + '">' + (p.pt_total || 0) + '</span></td>' +
            '<td class="center-col">'     + qtdCriterios                     + '</td>' +
            '<td class="center-col">'     + badgeClassif                     + '</td>' +
            '<td>'                        + textoVisita                      + '</td>' +
            '<td class="center-col">'     + badgeStatusVisita                + '</td>' +
        '</tr>';
    }

    function formatarTempoSemVisita(qtDias) {
        if (qtDias === null || qtDias === undefined) return '';
        if (qtDias === 0) return 'Hoje';
        if (qtDias === 1) return 'Ontem';
        return 'Ha ' + qtDias + ' dias';
    }

    // =========================================================
    // MODAL CRITERIOS
    // =========================================================

    function configurarModal() {
        var modal = document.getElementById('modalCriterios');
        var btnFechar = document.getElementById('btn-fechar-modal');
        var overlay = document.querySelector('.modal-overlay');

        if (!modal) return;

        function fechar() {
            fecharModalCriterios();
        }

        if (btnFechar) btnFechar.addEventListener('click', fechar);
        if (overlay) overlay.addEventListener('click', fechar);

        document.addEventListener('keydown', function(e) {
            if (e.key === 'Escape' && Estado.modalAberto) {
                fechar();
            }
        });
    }

    function parsearCriterios(ds) {
        if (!ds) return [];
        var partes = ds.split(' | ');
        var resultado = [];
        var i, m;
        for (i = 0; i < partes.length; i++) {
            // Regex match format: Condicao [Criterio] +Pontos
            m = partes[i].match(/^(.+?)\s*\[(.+?)\]\s*\+?(-?\d+)$/);
            if (m) {
                resultado.push({
                    condicao: m[1].trim(),
                    criterio: m[2].trim(),
                    pontos:   parseInt(m[3], 10)
                });
            } else {
                // Tenta fallback se formato for ligeiramente diferente
                var p = partes[i].split('+');
                if (p.length > 1) {
                    resultado.push({
                        condicao: 'Outros',
                        criterio: p[0].trim(),
                        pontos: parseInt(p[1], 10) || 0
                    });
                }
            }
        }
        
        // Ordena por pontos desc
        resultado.sort(function(a, b) {
            return b.pontos - a.pontos;
        });
        
        return resultado;
    }

    function abrirModalCriterios(p) {
        var modal = document.getElementById('modalCriterios');
        if (!modal) return;

        // Header
        document.getElementById('modal-paciente-nome').textContent = p.nm_paciente || 'Paciente';
        document.getElementById('modal-paciente-info').textContent = 
            (p.ds_setor_atendimento || '') + ' - Leito ' + (p.cd_unidade_basica || '');
        
        var dScore = document.getElementById('modal-score-total');
        dScore.textContent = p.pt_total || 0;
        
        // Cores do score no modal
        dScore.style.color = '#fff';
        dScore.style.background = '#6c757d';
        if (p.ie_classificacao === 'CRITICO') {
            dScore.style.background = '#dc3545';
        } else if (p.ie_classificacao === 'MEDIO') {
            dScore.style.background = '#e0a800';
        } else if (p.ie_classificacao === 'LEVE') {
            dScore.style.background = '#28a745';
        }

        // Body
        var tbody = document.getElementById('modal-criterios-body');
        var criterios = parsearCriterios(p.ds_criterios);
        
        var html = '';
        var soma = 0;
        var i;
        
        if (criterios.length === 0) {
            html = '<tr><td colspan="3" class="center-col text-muted">Nenhum criterio detalhado disponivel.</td></tr>';
        } else {
            for (i = 0; i < criterios.length; i++) {
                var c = criterios[i];
                html += '<tr>' +
                        '<td>' + esc(c.condicao) + '</td>' +
                        '<td>' + esc(c.criterio) + '</td>' +
                        '<td class="center-col">+' + c.pontos + '</td>' +
                        '</tr>';
                soma += c.pontos;
            }
        }
        
        tbody.innerHTML = html;
        document.getElementById('modal-pontos-total').textContent = soma;

        // Footer
        var fInfo = document.getElementById('modal-footer-info');
        var txtFooter = '<strong>Ultima visita:</strong> ';
        
        if (p.dt_ultima_visita) {
            txtFooter += formatarDataHora(p.dt_ultima_visita) + ' por ' + esc(p.nm_farmaceutico || '');
        } else {
            txtFooter += 'Sem registro';
        }
        
        txtFooter += ' | <strong>Visitas (30d):</strong> ' + (p.qt_visitas_30d || 0);
        fInfo.innerHTML = txtFooter;

        modal.removeAttribute('hidden');
        Estado.modalAberto = true;
    }

    function fecharModalCriterios() {
        var modal = document.getElementById('modalCriterios');
        if (modal) {
            modal.setAttribute('hidden', '');
            Estado.modalAberto = false;
        }
    }

    // =========================================================
    // LIMPAR FILTROS
    // =========================================================

    function limparFiltros() {
        Estado.filtros.setor         = [];
        Estado.filtros.classificacao = [];
        Estado.filtros.status_visita = [];
        Estado.filtros.busca         = '';
        
        salvar('filtro_setor', []);
        salvar('filtro_classificacao', []);
        salvar('filtro_status_visita', []);
        salvar('filtro_busca', '');

        if (DOM.inputBusca) DOM.inputBusca.value = '';

        var cbs = document.querySelectorAll('.multi-select input[type="checkbox"]');
        var i;
        for (i = 0; i < cbs.length; i++) cbs[i].checked = false;

        var mss = document.querySelectorAll('.multi-select');
        var j;
        for (j = 0; j < mss.length; j++) {
            var trigger     = mss[j].querySelector('.ms-toggle');
            var placeholder = mss[j].getAttribute('data-placeholder') || 'Selecione';
            if (trigger) trigger.textContent = placeholder;
        }
        carregarDados();
    }

    // =========================================================
    // HELPERS
    // =========================================================

    function esc(str) {
        if (str === null || str === undefined) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    function formatarDataHora(iso) {
        if (!iso) return '';
        var d = new Date(iso);
        if (isNaN(d.getTime())) return String(iso);
        var dia  = pad2(d.getDate());
        var mes  = pad2(d.getMonth() + 1);
        var ano  = d.getFullYear();
        var hora = pad2(d.getHours());
        var min  = pad2(d.getMinutes());
        return dia + '/' + mes + '/' + ano + ' ' + hora + ':' + min;
    }

    function pad2(n) {
        return n < 10 ? '0' + n : String(n);
    }

    function atualizarTimestamp() {
        if (!DOM.ultimaAtualizacao) return;
        var now = new Date();
        DOM.ultimaAtualizacao.textContent = pad2(now.getHours()) + ':' + pad2(now.getMinutes());
    }

    // =========================================================
    // AUTO REFRESH
    // =========================================================

    function iniciarAutoRefresh() {
        setInterval(carregarDados, CONFIG.INTERVALO_REFRESH);
    }

    // =========================================================
    // AUTO SCROLL
    // =========================================================

    function iniciarAutoScroll() {
        if (Estado.scrollIntervalo) return;
        Estado.scrollAtivo = true;

        var container = document.querySelector('.tabela-container');
        if (!container) return;

        container.addEventListener('mouseenter', function () { Estado.scrollAtivo = false; });
        container.addEventListener('mouseleave', function () { Estado.scrollAtivo = true;  });
        container.addEventListener('touchstart', function () { Estado.scrollAtivo = false; }, { passive: true });
        container.addEventListener('touchend',   function () { Estado.scrollAtivo = true;  }, { passive: true });

        Estado.scrollIntervalo = setInterval(function () {
            if (!Estado.scrollAtivo || Estado.modalAberto) return;

            var cont = document.querySelector('.tabela-container');
            if (!cont) return;

            var atFim = (cont.scrollTop + cont.clientHeight) >= (cont.scrollHeight - 5);

            if (atFim) {
                pararAutoScroll();
                setTimeout(function () {
                    var c = document.querySelector('.tabela-container');
                    if (c) c.scrollTop = 0;
                    setTimeout(iniciarAutoScroll, 1000);
                }, CONFIG.PAUSA_FIM);
                return;
            }

            if (cont.scrollTop === Estado.ultimaPosicao) {
                Estado.contadorTravado++;
                if (Estado.contadorTravado >= CONFIG.WATCHDOG_LIMITE) {
                    Estado.contadorTravado = 0;
                    cont.scrollTop = 0;
                }
            } else {
                Estado.contadorTravado = 0;
            }
            Estado.ultimaPosicao = cont.scrollTop;

            cont.scrollTop += CONFIG.VELOCIDADE_SCROLL;
        }, CONFIG.INTERVALO_SCROLL);
    }

    function pararAutoScroll() {
        if (Estado.scrollIntervalo) {
            clearInterval(Estado.scrollIntervalo);
            Estado.scrollIntervalo = null;
        }
    }

    // =========================================================
    // EXPORTAR EXCEL
    // =========================================================

    var _HEADERS_EXPORT = [
        'Setor', 'Leito', 'Paciente', 'Idade/Sexo', 'Dias Internado',
        'Medico', 'Convenio', 'Score Total', 'Qtd Criterios', 'Classificacao',
        'Ultima Visita', 'Farmaceutico', 'Status Visita', 'Dias Sem Visita'
    ];

    function _construirLinhaExport(p) {
        var idadeSexo = '';
        if (p.idade !== null && p.idade !== undefined) idadeSexo += p.idade + 'a';
        if (p.ie_sexo) idadeSexo += (idadeSexo ? ' ' : '') + p.ie_sexo;

        return [
            p.ds_setor_atendimento   || '',
            p.cd_unidade_basica      || '',
            p.nm_paciente            || '',
            idadeSexo,
            p.qt_dia_permanencia !== null && p.qt_dia_permanencia !== undefined ? p.qt_dia_permanencia : '',
            p.nm_medico              || '',
            p.ds_convenio            || '',
            p.pt_total               || 0,
            p.qt_criterios           || 0,
            p.ie_classificacao       || '',
            p.dt_ultima_visita ? formatarDataHora(p.dt_ultima_visita) : '',
            p.nm_farmaceutico        || '',
            p.ie_status_visita       || '',
            p.qt_dias_sem_visita !== null && p.qt_dias_sem_visita !== undefined ? p.qt_dias_sem_visita : ''
        ];
    }

    function exportarExcel() {
        if (!Estado.pacientes || Estado.pacientes.length === 0) {
            alert('Nenhum dado para exportar.');
            return;
        }

        var nomeArq = 'score_farmaceutico_' + new Date().toISOString().slice(0, 10);

        if (window.XLSX) {
            var dados = [_HEADERS_EXPORT];
            var i;
            for (i = 0; i < Estado.pacientes.length; i++) {
                dados.push(_construirLinhaExport(Estado.pacientes[i]));
            }
            var wb = XLSX.utils.book_new();
            var ws = XLSX.utils.aoa_to_sheet(dados);
            XLSX.utils.book_append_sheet(wb, ws, 'Score Farmaceutico');
            XLSX.writeFile(wb, nomeArq + '.xlsx');
        } else {
            _exportarCSV(nomeArq);
        }
    }

    function _exportarCSV(nomeArq) {
        var linhas = [_HEADERS_EXPORT.join(';')];
        var i;
        for (i = 0; i < Estado.pacientes.length; i++) {
            var cols = _construirLinhaExport(Estado.pacientes[i]);
            var linha = [];
            var j;
            for (j = 0; j < cols.length; j++) {
                linha.push('"' + String(cols[j]).replace(/"/g, '""') + '"');
            }
            linhas.push(linha.join(';'));
        }
        var blob = new Blob(['\uFEFF' + linhas.join('\n')], { type: 'text/csv;charset=utf-8;' });
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href     = url;
        a.download = nomeArq + '.csv';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }

    // =========================================================
    // ENTRY POINT
    // =========================================================

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', inicializar);
    } else {
        inicializar();
    }

})();
