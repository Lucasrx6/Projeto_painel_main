// =============================================================================
// PAINEL 39 - INTERACOES MEDICAMENTOSAS ATIVAS (FARMACO x DIETA)
// Hospital Anchieta Ceilandia
// ES5 puro — sem const/let, arrow functions ou template literals
// =============================================================================

(function () {
    'use strict';

    var CONFIG = {
        ENDPOINTS: {
            filtros:   '/api/paineis/painel39/dieta/filtros',
            dashboard: '/api/paineis/painel39/dieta/dashboard',
            dados:     '/api/paineis/painel39/dieta/dados'
        },
        INTERVALO_REFRESH:  60000,
        VELOCIDADE_SCROLL:  0.5,
        INTERVALO_SCROLL:   50,
        PAUSA_FIM:          3000,
        WATCHDOG_LIMITE:    10,
        STORAGE_PREFIX:     'painel39_'
    };

    var Estado = {
        filtros: {
            setor:    [],
            material: [],
            dieta:    [],
            busca:    ''
        },
        interacoes:      [],
        carregando:      false,
        scrollAtivo:     false,
        scrollIntervalo: null,
        ultimaPosicao:   0,
        contadorTravado: 0,
        abaAtiva:        'dieta'
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
            if (raw === null || raw === undefined) return padrao !== undefined ? padrao : null;
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
        DOM.kpiRow            = document.getElementById('kpi-row');
        DOM.tabelaContainer   = document.getElementById('tabela-container');
        DOM.tabelaBody        = document.getElementById('tabela-body');
        DOM.totalBadge        = document.getElementById('total-badge');
        DOM.ultimaAtualizacao = document.getElementById('ultima-atualizacao');
        DOM.inputBusca        = document.getElementById('filtro-busca');
        DOM.placeholder       = document.getElementById('placeholder-medicamento');

        DOM.kpiInteracoes    = document.getElementById('kpi-total-interacoes');
        DOM.kpiPacientes     = document.getElementById('kpi-total-pacientes');
        DOM.kpiMedicamentos  = document.getElementById('kpi-total-medicamentos');
        DOM.kpiSetores       = document.getElementById('kpi-total-setores');
        DOM.kpiUltimaCarga   = document.getElementById('kpi-ultima-carga');

        // Restaura filtros ANTES de qualquer fetch
        Estado.filtros.setor    = recuperar('filtro_setor',    []);
        Estado.filtros.material = recuperar('filtro_material', []);
        Estado.filtros.dieta    = recuperar('filtro_dieta',    []);
        Estado.filtros.busca    = recuperar('filtro_busca',    '');
        Estado.abaAtiva         = recuperar('aba_ativa',       'dieta');

        if (DOM.inputBusca && Estado.filtros.busca) {
            DOM.inputBusca.value = Estado.filtros.busca;
        }

        configurarBotoes();
        configurarAbas();
        configurarToggleMultiSelects();
        configurarBusca();

        // Aplica aba restaurada
        aplicarAba(Estado.abaAtiva);

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
                if (!DOM.filtrosBar) return;
                DOM.filtrosBar.style.display = DOM.filtrosBar.style.display === 'none' ? 'block' : 'none';
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
    // ABAS
    // =========================================================

    function configurarAbas() {
        var botoes = document.querySelectorAll('.aba');
        var i;
        for (i = 0; i < botoes.length; i++) {
            (function (btn) {
                btn.addEventListener('click', function () {
                    trocarAba(btn.getAttribute('data-aba'));
                });
            })(botoes[i]);
        }
    }

    function trocarAba(aba) {
        Estado.abaAtiva = aba;
        salvar('aba_ativa', aba);

        var botoes = document.querySelectorAll('.aba');
        var i;
        for (i = 0; i < botoes.length; i++) {
            botoes[i].classList.toggle('aba-ativa', botoes[i].getAttribute('data-aba') === aba);
        }

        aplicarAba(aba);
    }

    function aplicarAba(aba) {
        var emDieta = (aba === 'dieta');

        if (DOM.kpiRow)          DOM.kpiRow.style.display          = emDieta ? '' : 'none';
        if (DOM.tabelaContainer) DOM.tabelaContainer.style.display = emDieta ? '' : 'none';
        if (DOM.placeholder)     DOM.placeholder.style.display     = emDieta ? 'none' : 'flex';

        // Filtros so ficam visiveis na aba Dieta (e so se o usuario os abriu)
        if (!emDieta && DOM.filtrosBar) {
            DOM.filtrosBar.style.display = 'none';
        }

        if (emDieta) {
            carregarDados();
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
    // MULTI-SELECT — POPULAR E VINCULAR
    // =========================================================

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
            cb.setAttribute('data-label', item[campoLabel] || item[campoValor]);
            label.appendChild(cb);
            label.appendChild(document.createTextNode(' ' + (item[campoLabel] || item[campoValor])));
            dropdown.appendChild(label);
        }
    }

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
                                if (checkboxes[m].checked) selecionados.push(checkboxes[m].value);
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
                selecionados.push(checkboxes[i].getAttribute('data-label') || checkboxes[i].value);
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
    // QUERY PARAMS (unica funcao — usada por dashboard e dados)
    // =========================================================

    function construirParams() {
        var parts = [];
        if (Estado.filtros.setor && Estado.filtros.setor.length > 0) {
            parts.push('setor=' + encodeURIComponent(Estado.filtros.setor.join(',')));
        }
        if (Estado.filtros.material && Estado.filtros.material.length > 0) {
            parts.push('material=' + encodeURIComponent(Estado.filtros.material.join(',')));
        }
        if (Estado.filtros.dieta && Estado.filtros.dieta.length > 0) {
            parts.push('dieta=' + encodeURIComponent(Estado.filtros.dieta.join(',')));
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
                    popularMultiSelect('setor',    data.setores      || [], 'id', 'nome');
                    popularMultiSelect('material', data.medicamentos || [], 'id', 'nome');
                    popularMultiSelect('dieta',    data.dietas       || [], 'id', 'nome');
                }
                if (typeof callback === 'function') callback();
            })
            .catch(function (e) {
                console.error('Erro ao carregar filtros P39:', e);
                if (typeof callback === 'function') callback();
            });
    }

    // =========================================================
    // CARREGAR DADOS
    // =========================================================

    function carregarDados() {
        if (Estado.carregando || Estado.abaAtiva !== 'dieta') return;
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
                    Estado.interacoes = dados.dados || [];
                    renderizarTabela(Estado.interacoes);
                }
                atualizarTimestamp();
                Estado.carregando = false;
            })
            .catch(function (e) {
                console.error('Erro ao carregar dados P39:', e);
                Estado.carregando = false;
            });
    }

    // =========================================================
    // RENDERIZAR KPIs
    // =========================================================

    function renderizarKPIs(d) {
        if (DOM.kpiInteracoes)   DOM.kpiInteracoes.textContent   = d.total_interacoes   || 0;
        if (DOM.kpiPacientes)    DOM.kpiPacientes.textContent    = d.total_pacientes    || 0;
        if (DOM.kpiMedicamentos) DOM.kpiMedicamentos.textContent = d.total_medicamentos || 0;
        if (DOM.kpiSetores)      DOM.kpiSetores.textContent      = d.total_setores      || 0;
        if (DOM.kpiUltimaCarga && d.ultima_carga) {
            DOM.kpiUltimaCarga.textContent = 'Carga: ' + formatarDataHora(d.ultima_carga);
        }
    }

    // =========================================================
    // RENDERIZAR TABELA
    // =========================================================

    function renderizarTabela(lista) {
        if (!DOM.tabelaBody) return;

        var n = lista.length;
        if (DOM.totalBadge) {
            DOM.totalBadge.textContent = n + ' interaca' + (n === 1 ? 'o' : 'oes');
        }

        if (!lista || n === 0) {
            DOM.tabelaBody.innerHTML =
                '<tr><td colspan="8" class="vazio">' +
                '<i class="fas fa-inbox"></i> Nenhuma interacao encontrada</td></tr>';
            return;
        }

        var html = '';
        var i;
        for (i = 0; i < lista.length; i++) {
            html += construirLinha(lista[i]);
        }
        DOM.tabelaBody.innerHTML = html;
    }

    function construirLinha(d) {
        var pacienteCell =
            '<span class="paciente-nome" title="' + esc(d.nm_pessoa_fisica || '') + '">' +
                esc(d.nm_pessoa_fisica || '-') +
            '</span>' +
            (d.idade !== null && d.idade !== undefined
                ? '<span class="paciente-info">' + d.idade + ' anos</span>'
                : '');

        var medCell =
            '<span class="med-nome" title="' + esc(d.ds_material || '') + '">' +
                esc(d.ds_material || '-') +
            '</span>' +
            '<span class="med-cod">' + esc(String(d.cd_material || '')) + '</span>';

        var interacaoCompleta = d.ds_interacao || '-';
        var interacaoCell =
            '<div class="interacao-texto" title="' + esc(interacaoCompleta) + '">' +
                esc(interacaoCompleta) +
            '</div>';

        var prescritoCell =
            '<span class="prescrito-nome">' + esc(d.nm_usuario_dieta || '--') + '</span>' +
            '<span class="prescrito-data">' + (d.dt_prescricao ? formatarDataHora(d.dt_prescricao) : '') + '</span>';

        return '<tr>' +
            '<td><span class="badge-setor" title="' + esc(d.ds_setor || '') + '">' + esc(d.ds_setor || '-') + '</span></td>' +
            '<td class="leito-col">' + esc(d.cd_unidade || '-') + '</td>' +
            '<td class="atend-col">' + esc(String(d.nr_atendimento || '-')) + '</td>' +
            '<td>' + pacienteCell + '</td>' +
            '<td>' + medCell + '</td>' +
            '<td><span class="badge-dieta" title="' + esc(d.dieta || '') + '">' + esc(d.dieta || '-') + '</span></td>' +
            '<td>' + interacaoCell + '</td>' +
            '<td>' + prescritoCell + '</td>' +
        '</tr>';
    }

    // =========================================================
    // LIMPAR FILTROS
    // =========================================================

    function limparFiltros() {
        Estado.filtros.setor    = [];
        Estado.filtros.material = [];
        Estado.filtros.dieta    = [];
        Estado.filtros.busca    = '';

        salvar('filtro_setor',    []);
        salvar('filtro_material', []);
        salvar('filtro_dieta',    []);
        salvar('filtro_busca',    '');

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
        return pad2(d.getDate()) + '/' + pad2(d.getMonth() + 1) + '/' + d.getFullYear() +
               ' ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes());
    }

    function pad2(n) { return n < 10 ? '0' + n : String(n); }

    function atualizarTimestamp() {
        if (!DOM.ultimaAtualizacao) return;
        var now = new Date();
        DOM.ultimaAtualizacao.textContent = pad2(now.getHours()) + ':' + pad2(now.getMinutes());
    }

    // =========================================================
    // AUTO REFRESH
    // =========================================================

    function iniciarAutoRefresh() {
        setInterval(function () {
            if (Estado.abaAtiva === 'dieta') carregarDados();
        }, CONFIG.INTERVALO_REFRESH);
    }

    // =========================================================
    // AUTO SCROLL (rola o tbody da tabela)
    // =========================================================

    function iniciarAutoScroll() {
        if (Estado.scrollIntervalo) return;
        Estado.scrollAtivo = true;

        var container = document.querySelector('.tabela-container');
        if (container) {
            container.addEventListener('mouseenter', function () { Estado.scrollAtivo = false; });
            container.addEventListener('mouseleave', function () { Estado.scrollAtivo = true;  });
            container.addEventListener('touchstart', function () { Estado.scrollAtivo = false; }, { passive: true });
            container.addEventListener('touchend',   function () { Estado.scrollAtivo = true;  }, { passive: true });
        }

        Estado.scrollIntervalo = setInterval(function () {
            if (!Estado.scrollAtivo) return;

            var tbody = document.querySelector('.tabela-principal tbody');
            if (!tbody) return;

            var atFim = (tbody.scrollTop + tbody.clientHeight) >= (tbody.scrollHeight - 5);

            if (atFim) {
                pararAutoScroll();
                setTimeout(function () {
                    var t = document.querySelector('.tabela-principal tbody');
                    if (t) t.scrollTop = 0;
                    setTimeout(iniciarAutoScroll, 1000);
                }, CONFIG.PAUSA_FIM);
                return;
            }

            if (tbody.scrollTop === Estado.ultimaPosicao) {
                Estado.contadorTravado++;
                if (Estado.contadorTravado >= CONFIG.WATCHDOG_LIMITE) {
                    Estado.contadorTravado = 0;
                    tbody.scrollTop = 0;
                }
            } else {
                Estado.contadorTravado = 0;
            }
            Estado.ultimaPosicao = tbody.scrollTop;

            tbody.scrollTop += CONFIG.VELOCIDADE_SCROLL;
        }, CONFIG.INTERVALO_SCROLL);
    }

    function pararAutoScroll() {
        if (Estado.scrollIntervalo) {
            clearInterval(Estado.scrollIntervalo);
            Estado.scrollIntervalo = null;
        }
    }

    // =========================================================
    // EXPORTAR EXCEL / CSV
    // =========================================================

    var _HEADERS_EXPORT = [
        'Setor', 'Leito', 'Atendimento', 'Paciente', 'Idade',
        'Medicamento', 'Cod. Material', 'Dieta',
        'Interacao Clinica', 'Prescrito por', 'Data Prescricao'
    ];

    function _construirLinhaExport(d) {
        return [
            d.ds_setor              || '',
            d.cd_unidade            || '',
            d.nr_atendimento        || '',
            d.nm_pessoa_fisica      || '',
            d.idade !== null && d.idade !== undefined ? d.idade : '',
            d.ds_material           || '',
            d.cd_material           || '',
            d.dieta                 || '',
            d.ds_interacao          || '',
            d.nm_usuario_dieta      || '',
            d.dt_prescricao ? formatarDataHora(d.dt_prescricao) : ''
        ];
    }

    function exportarExcel() {
        if (!Estado.interacoes || Estado.interacoes.length === 0) {
            alert('Nenhum dado para exportar.');
            return;
        }

        var nomeArq = 'interacoes_medicamentosas_' + new Date().toISOString().slice(0, 10);

        if (window.XLSX) {
            var dados = [_HEADERS_EXPORT];
            var i;
            for (i = 0; i < Estado.interacoes.length; i++) {
                dados.push(_construirLinhaExport(Estado.interacoes[i]));
            }
            var wb = XLSX.utils.book_new();
            var ws = XLSX.utils.aoa_to_sheet(dados);
            XLSX.utils.book_append_sheet(wb, ws, 'Interacoes');
            XLSX.writeFile(wb, nomeArq + '.xlsx');
        } else {
            _exportarCSV(nomeArq);
        }
    }

    function _exportarCSV(nomeArq) {
        var linhas = [_HEADERS_EXPORT.join(';')];
        var i;
        for (i = 0; i < Estado.interacoes.length; i++) {
            var cols = _construirLinhaExport(Estado.interacoes[i]);
            var linha = [];
            var j;
            for (j = 0; j < cols.length; j++) {
                linha.push('"' + String(cols[j]).replace(/"/g, '""') + '"');
            }
            linhas.push(linha.join(';'));
        }
        var blob = new Blob(['﻿' + linhas.join('\n')], { type: 'text/csv;charset=utf-8;' });
        var url  = URL.createObjectURL(blob);
        var a    = document.createElement('a');
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
