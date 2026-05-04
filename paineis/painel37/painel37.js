// =============================================================================
// PAINEL 37 - PLANO TERAPEUTICO DE ENFERMAGEM
// Hospital Anchieta Ceilandia
// ES5 puro — sem const/let, arrow functions ou template literals
// =============================================================================

(function () {
    'use strict';

    var CONFIG = {
        ENDPOINTS: {
            filtros:   '/api/paineis/painel37/filtros',
            dashboard: '/api/paineis/painel37/dashboard',
            dados:     '/api/paineis/painel37/dados'
        },
        INTERVALO_REFRESH:  60000,
        VELOCIDADE_SCROLL:  0.5,
        INTERVALO_SCROLL:   50,
        PAUSA_FIM:          3000,
        WATCHDOG_LIMITE:    10,
        STORAGE_PREFIX:     'painel37_'
    };

    var Estado = {
        filtros: {
            setor:        [],
            status_prazo: [],
            busca:        ''
        },
        pacientes:       [],
        carregando:      false,
        scrollAtivo:     false,
        scrollIntervalo: null,
        ultimaPosicao:   0,
        contadorTravado: 0
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
        DOM.kpiVencido        = document.getElementById('kpi-vencido');
        DOM.kpiProximo        = document.getElementById('kpi-proximo');
        DOM.kpiNoPrazo        = document.getElementById('kpi-no-prazo');
        DOM.kpiSemAvaliacao   = document.getElementById('kpi-sem-avaliacao');
        DOM.inputBusca        = document.getElementById('filtro-busca');

        // Restaura filtros ANTES de qualquer fetch
        Estado.filtros.setor        = recuperar('filtro_setor', []);
        Estado.filtros.status_prazo = recuperar('filtro_status_prazo', []);
        Estado.filtros.busca        = recuperar('filtro_busca', '');

        if (DOM.inputBusca) {
            DOM.inputBusca.value = Estado.filtros.busca;
        }

        configurarBotoes();
        configurarToggleMultiSelects();
        configurarBusca();

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
    // MULTI-SELECT — TOGGLE (configurado UMA vez por classe)
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
    // MULTI-SELECT — VINCULAR CHECKBOXES (chamado APOS popular)
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

                // Aplica estado restaurado do localStorage
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
    // QUERY PARAMS (unica fonte de verdade)
    // =========================================================

    function construirParams() {
        var parts = [];
        if (Estado.filtros.setor && Estado.filtros.setor.length > 0) {
            parts.push('setor=' + encodeURIComponent(Estado.filtros.setor.join(',')));
        }
        if (Estado.filtros.status_prazo && Estado.filtros.status_prazo.length > 0) {
            parts.push('status_prazo=' + encodeURIComponent(Estado.filtros.status_prazo.join(',')));
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
                    popularMultiSelect('setor',       data.setores,     'codigo', 'nome');
                    popularMultiSelect('status_prazo', data.status_prazo, 'codigo', 'label');
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
        if (DOM.kpiTotal)        DOM.kpiTotal.textContent        = d.total_pacientes || 0;
        if (DOM.kpiVencido)      DOM.kpiVencido.textContent      = d.vencido         || 0;
        if (DOM.kpiProximo)      DOM.kpiProximo.textContent      = d.proximo         || 0;
        if (DOM.kpiNoPrazo)      DOM.kpiNoPrazo.textContent      = d.no_prazo        || 0;
        if (DOM.kpiSemAvaliacao) DOM.kpiSemAvaliacao.textContent = d.sem_avaliacao   || 0;
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
                '<tr><td colspan="8" class="vazio">' +
                '<i class="fas fa-inbox"></i> Nenhum paciente encontrado</td></tr>';
            return;
        }

        var html = '';
        var i;
        for (i = 0; i < pacientes.length; i++) {
            html += construirLinha(pacientes[i]);
        }
        DOM.tabelaBody.innerHTML = html;
    }

    function construirLinha(p) {
        var classe = '';
        if (p.ie_status_prazo === 'VENCIDO')            classe = 'linha-critica';
        else if (p.ie_status_prazo === 'PROXIMO')        classe = 'linha-atencao';
        else if (p.ie_status_prazo === 'SEM_AVALIACAO')  classe = 'linha-pendente';

        // Célula Setor / Leito (empilhados)
        var setorLeitoCell =
            '<div class="setor-leito-cell">' +
                '<span class="badge-setor">' + esc(p.ds_setor || '-') + '</span>' +
                '<span class="leito-sub">' + esc(p.cd_unidade_basica || '-') + '</span>' +
            '</div>';

        // Linha secundária: convenio • idade sexo
        var idadeSexo = '';
        if (p.idade !== null && p.idade !== undefined) idadeSexo += p.idade + 'a';
        if (p.ie_sexo) idadeSexo += (idadeSexo ? ' ' : '') + p.ie_sexo;
        var subInfo = (p.ds_convenio || '-');
        if (idadeSexo) subInfo += ' • ' + idadeSexo;

        var pacienteCell =
            '<div class="paciente-nome" title="' + esc(p.nm_pessoa_fisica || '') + '">' +
                esc(p.nm_pessoa_fisica || '-') +
            '</div>' +
            '<span class="paciente-info">' + esc(subInfo) + '</span>';

        // Nr Atendimento
        var nrAtend = p.nr_atendimento ? String(p.nr_atendimento) : '-';

        var internDias = (p.qt_dia_permanencia !== null && p.qt_dia_permanencia !== undefined)
            ? p.qt_dia_permanencia + 'd' : '-';
        var tooltipIntern = p.dt_entrada_unid
            ? ' title="' + esc(p.dt_entrada_unid) + '"' : '';

        var badgeStatus = construirBadgeStatus(p.ie_status_prazo);

        var meta = '-';
        if (p.ds_meta) {
            if (p.ds_meta.length > 60) {
                meta = '<span title="' + esc(p.ds_meta) + '">' +
                       esc(p.ds_meta.substring(0, 57)) + '...</span>';
            } else {
                meta = esc(p.ds_meta);
            }
        }

        var prazo     = construirPrazo(p);
        var avaliador = construirAvaliador(p);

        return '<tr class="' + classe + '">' +
            '<td class="setor-leito-col">' + setorLeitoCell                   + '</td>' +
            '<td class="paciente-col">'    + pacienteCell                     + '</td>' +
            '<td class="center-col nr-atend-col">'  + esc(nrAtend)           + '</td>' +
            '<td class="center-col"' + tooltipIntern + '>' + internDias      + '</td>' +
            '<td class="center-col">'      + badgeStatus                     + '</td>' +
            '<td class="meta-col">'        + meta                            + '</td>' +
            '<td class="prazo-col">'       + prazo                           + '</td>' +
            '<td class="avaliador-col">'   + avaliador                       + '</td>' +
        '</tr>';
    }

    function construirBadgeStatus(status) {
        var mapa = {
            'SEM_AVALIACAO': ['badge-sem-avaliacao', 'Sem avaliacao'],
            'SEM_PRAZO':     ['badge-sem-prazo',      'Sem prazo'],
            'VENCIDO':       ['badge-vencido',         'Vencido'],
            'PROXIMO':       ['badge-proximo',          'Proximo'],
            'NO_PRAZO':      ['badge-no-prazo',         'No prazo']
        };
        var info = mapa[status] || ['badge-sem-avaliacao', status || '-'];
        return '<span class="badge-status ' + info[0] + '">' + info[1] + '</span>';
    }

    function construirPrazo(p) {
        var dias = p.dias_para_prazo;
        var texto = '';
        if (p.ie_status_prazo === 'VENCIDO' && dias !== null && dias !== undefined) {
            var abs = Math.abs(dias);
            texto = '<span class="prazo-vencido">Vencido ha ' + abs +
                   ' dia' + (abs !== 1 ? 's' : '') + '</span>';
        } else if (p.ie_status_prazo === 'PROXIMO') {
            if (dias === 0) texto = '<span class="prazo-proximo">Vence hoje</span>';
            else if (dias === 1) texto = '<span class="prazo-proximo">Vence amanha</span>';
            else texto = '<span class="prazo-proximo">Faltam ' + dias + ' dia(s)</span>';
        } else if (p.ie_status_prazo === 'NO_PRAZO' && dias !== null && dias !== undefined) {
            texto = '<span class="prazo-ok">Faltam ' + dias +
                   ' dia' + (dias !== 1 ? 's' : '') + '</span>';
        } else {
            return '-';
        }
        // Adicionar data do prazo abaixo
        if (p.dt_prazo) {
            texto += '<br><small class="text-muted">' + formatarData(p.dt_prazo) + '</small>';
        }
        return texto;
    }

    function construirAvaliador(p) {
        if (!p.nm_usuario_aval) return '-';
        var txt = esc(p.nm_usuario_aval);
        if (p.dt_avaliacao) {
            txt += '<br><small class="text-muted">Data avaliação: ' + formatarData(p.dt_avaliacao) + '</small>';
        }
        return txt;
    }

    // =========================================================
    // LIMPAR FILTROS
    // =========================================================

    function limparFiltros() {
        Estado.filtros.setor        = [];
        Estado.filtros.status_prazo = [];
        Estado.filtros.busca        = '';
        salvar('filtro_setor', []);
        salvar('filtro_status_prazo', []);
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

    function formatarData(iso) {
        if (!iso) return '';
        var d = new Date(iso);
        if (isNaN(d.getTime())) return String(iso);
        // Usar UTC para evitar deslocamento de fuso horario
        var dia  = d.getUTCDate();
        var mes  = d.getUTCMonth() + 1;
        var ano  = d.getUTCFullYear();
        return (dia < 10 ? '0' : '') + dia + '/' +
               (mes < 10 ? '0' : '') + mes + '/' + ano;
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
    // AUTO SCROLL (watchdog + pausa ao interagir)
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
            if (!Estado.scrollAtivo) return;

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
    // EXPORTAR EXCEL (SheetJS com fallback CSV)
    // =========================================================

    var _HEADERS_EXPORT = [
        'Setor', 'Leito', 'Nr Atendimento', 'Paciente', 'Idade/Sexo', 'Dias Internado',
        'Medico', 'Convenio', 'Status', 'Meta', 'Prazo', 'Dt Prazo', 'Avaliador', 'Dt Avaliacao'
    ];

    function _construirLinhaExport(p) {
        var idadeSexo = '';
        if (p.idade !== null && p.idade !== undefined) idadeSexo += p.idade + 'a';
        if (p.ie_sexo) idadeSexo += (idadeSexo ? ' ' : '') + p.ie_sexo;

        return [
            p.ds_setor               || '',
            p.cd_unidade_basica      || '',
            p.nr_atendimento         || '',
            p.nm_pessoa_fisica       || '',
            idadeSexo,
            p.qt_dia_permanencia !== null && p.qt_dia_permanencia !== undefined
                ? p.qt_dia_permanencia : '',
            p.nm_medico              || '',
            p.ds_convenio            || '',
            p.ie_status_prazo        || '',
            p.ds_meta                || '',
            p.ds_prazo_str           || '',
            p.dt_prazo ? formatarData(p.dt_prazo) : '',
            p.nm_usuario_aval        || '',
            p.dt_avaliacao ? formatarData(p.dt_avaliacao) : ''
        ];
    }

    function exportarExcel() {
        if (!Estado.pacientes || Estado.pacientes.length === 0) {
            alert('Nenhum dado para exportar.');
            return;
        }

        var nomeArq = 'plano_terapeutico_' + new Date().toISOString().slice(0, 10);

        if (window.XLSX) {
            var dados = [_HEADERS_EXPORT];
            var i;
            for (i = 0; i < Estado.pacientes.length; i++) {
                dados.push(_construirLinhaExport(Estado.pacientes[i]));
            }
            var wb = XLSX.utils.book_new();
            var ws = XLSX.utils.aoa_to_sheet(dados);
            XLSX.utils.book_append_sheet(wb, ws, 'Plano Terapeutico');
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
        var blob = new Blob(['﻿' + linhas.join('\n')], { type: 'text/csv;charset=utf-8;' });
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
