(function () {
    'use strict';

    // ---- dropdowns ----

    function fecharTodosDropdowns() {
        var dds = document.querySelectorAll('.multi-select-dropdown.aberto');
        for (var i = 0; i < dds.length; i++) dds[i].classList.remove('aberto');
        var trs = document.querySelectorAll('.ms-trigger.aberto');
        for (var j = 0; j < trs.length; j++) {
            trs[j].classList.remove('aberto');
            trs[j].setAttribute('aria-expanded', 'false');
        }
        window.P11.Estado.dropdownAberto = null;
    }

    function configurarToggleMultiSelects() {
        var Estado = window.P11.Estado;
        var triggers = document.querySelectorAll('.ms-trigger');
        for (var i = 0; i < triggers.length; i++) {
            (function (btn) {
                btn.addEventListener('click', function (e) {
                    e.stopPropagation();
                    var container = btn.closest('.multi-select-container');
                    var dd = container.querySelector('.multi-select-dropdown');
                    var isAberto = dd.classList.contains('aberto');
                    fecharTodosDropdowns();
                    if (!isAberto) {
                        dd.classList.add('aberto');
                        btn.setAttribute('aria-expanded', 'true');
                        btn.classList.add('aberto');
                        Estado.dropdownAberto = container.id;
                    }
                });
            })(triggers[i]);
        }
        document.addEventListener('click', function (e) {
            if (Estado.dropdownAberto) {
                var container = document.getElementById(Estado.dropdownAberto);
                if (container && !container.contains(e.target)) fecharTodosDropdowns();
            }
        });
    }

    // ---- sincronizar estado do multi-select ----

    function syncEstado(containerId) {
        var container = document.getElementById(containerId);
        if (!container) return;
        var stateKey = container.getAttribute('data-state-key');
        var cbs = container.querySelectorAll('.multi-select-checkbox');
        var sel = [];
        for (var i = 0; i < cbs.length; i++) {
            var lbl = cbs[i].closest('.multi-select-item');
            if (cbs[i].checked) {
                sel.push(cbs[i].value);
                if (lbl) lbl.classList.add('selecionado');
            } else {
                if (lbl) lbl.classList.remove('selecionado');
            }
        }
        window.P11.Estado[stateKey] = sel;
    }

    function atualizarLabel(containerId) {
        var container = document.getElementById(containerId);
        if (!container) return;
        var stateKey    = container.getAttribute('data-state-key');
        var placeholder = container.getAttribute('data-placeholder');
        var labelEl = container.querySelector('.multi-select-label');
        if (!labelEl) return;
        var qtd   = window.P11.Estado[stateKey].length;
        var total = container.querySelectorAll('.multi-select-checkbox').length;
        if (qtd === 0 || qtd === total) {
            labelEl.textContent = placeholder;
        } else if (qtd === 1) {
            var cb = container.querySelector('.multi-select-checkbox:checked');
            var it = cb ? cb.closest('.multi-select-item').querySelector('.multi-select-item-text') : null;
            labelEl.textContent = it ? it.textContent : window.P11.Estado[stateKey][0];
        } else {
            labelEl.textContent = qtd + ' selecionados';
        }
    }

    function restaurarEstadoMultiSelect(containerId) {
        var container = document.getElementById(containerId);
        if (!container) return;
        var stateKey = container.getAttribute('data-state-key');
        var salvos = window.P11.recuperarArray(stateKey);
        if (!salvos || salvos.length === 0) return;
        window.P11.Estado[stateKey] = salvos;
        var cbs = container.querySelectorAll('.multi-select-checkbox');
        for (var i = 0; i < cbs.length; i++) {
            if (salvos.indexOf(cbs[i].value) !== -1) {
                cbs[i].checked = true;
                var lbl = cbs[i].closest('.multi-select-item');
                if (lbl) lbl.classList.add('selecionado');
            }
        }
    }

    // ---- popular e vincular ----

    function vincularCheckboxesMultiSelect(containerId) {
        var container = document.getElementById(containerId);
        if (!container) return;
        var stateKey = container.getAttribute('data-state-key');

        var checkboxes = container.querySelectorAll('.multi-select-checkbox');
        for (var i = 0; i < checkboxes.length; i++) {
            var oldCb = checkboxes[i];
            var newCb = oldCb.cloneNode(true);
            oldCb.parentNode.replaceChild(newCb, oldCb);
            newCb.addEventListener('change', function () {
                syncEstado(containerId);
                atualizarLabel(containerId);
                window.P11.salvar(stateKey, window.P11.Estado[stateKey]);
                window.P11.carregarDados();
            });
        }

        var btnAll = container.querySelector('.btn-ms-all');
        if (btnAll) {
            var na = btnAll.cloneNode(true);
            btnAll.parentNode.replaceChild(na, btnAll);
            na.addEventListener('click', function (e) {
                e.stopPropagation();
                var cbs = container.querySelectorAll('.multi-select-checkbox');
                for (var j = 0; j < cbs.length; j++) cbs[j].checked = true;
                syncEstado(containerId);
                atualizarLabel(containerId);
                window.P11.salvar(stateKey, window.P11.Estado[stateKey]);
                window.P11.carregarDados();
            });
        }

        var btnNone = container.querySelector('.btn-ms-none');
        if (btnNone) {
            var nn = btnNone.cloneNode(true);
            btnNone.parentNode.replaceChild(nn, btnNone);
            nn.addEventListener('click', function (e) {
                e.stopPropagation();
                var cbs = container.querySelectorAll('.multi-select-checkbox');
                for (var j = 0; j < cbs.length; j++) cbs[j].checked = false;
                syncEstado(containerId);
                atualizarLabel(containerId);
                window.P11.salvar(stateKey, window.P11.Estado[stateKey]);
                window.P11.carregarDados();
            });
        }

        restaurarEstadoMultiSelect(containerId);
        atualizarLabel(containerId);
    }

    function popularMultiSelectDinamico(containerId, opcoes) {
        var container = document.getElementById(containerId);
        if (!container) return;
        var optionsDiv = container.querySelector('.multi-select-options');
        if (!optionsDiv) return;
        optionsDiv.innerHTML = '';

        for (var i = 0; i < opcoes.length; i++) {
            var valor = opcoes[i].valor !== undefined ? opcoes[i].valor : opcoes[i];
            var texto = opcoes[i].texto !== undefined ? opcoes[i].texto : opcoes[i];
            var label = document.createElement('label');
            label.className = 'multi-select-item';
            var cb = document.createElement('input');
            cb.type = 'checkbox';
            cb.className = 'multi-select-checkbox';
            cb.value = String(valor);
            var span = document.createElement('span');
            span.className = 'multi-select-item-text';
            span.textContent = texto;
            label.appendChild(cb);
            label.appendChild(span);
            optionsDiv.appendChild(label);
        }

        vincularCheckboxesMultiSelect(containerId);
    }

    function resetarTodosMultiSelects() {
        var containers = document.querySelectorAll('.multi-select-container');
        for (var i = 0; i < containers.length; i++) {
            var stateKey    = containers[i].getAttribute('data-state-key');
            var placeholder = containers[i].getAttribute('data-placeholder');
            window.P11.Estado[stateKey] = [];
            window.P11.salvar(stateKey, []);
            var cbs = containers[i].querySelectorAll('.multi-select-checkbox');
            for (var j = 0; j < cbs.length; j++) {
                cbs[j].checked = false;
                var lbl = cbs[j].closest('.multi-select-item');
                if (lbl) lbl.classList.remove('selecionado');
            }
            var labelEl = containers[i].querySelector('.multi-select-label');
            if (labelEl) labelEl.textContent = placeholder;
        }
    }

    // ---- construir URLs com filtros ----

    function construirParams() {
        var Estado = window.P11.Estado;
        var CONFIG = window.P11.CONFIG;
        var params = [];
        if (Estado.multiStatusInternacao.length > 0) params.push('status_internacao=' + encodeURIComponent(Estado.multiStatusInternacao.join(',')));
        if (Estado.multiStatusGv.length > 0)         params.push('cd_status_gv='      + encodeURIComponent(Estado.multiStatusGv.join(',')));
        if (Estado.multiClinica.length > 0)          params.push('ds_clinica='         + encodeURIComponent(Estado.multiClinica.join(',')));
        if (Estado.multiConvenio.length > 0)         params.push('ds_convenio='        + encodeURIComponent(Estado.multiConvenio.join(',')));
        return params;
    }

    function construirUrl() {
        var params = construirParams();
        return window.P11.CONFIG.api.lista + (params.length > 0 ? '?' + params.join('&') : '');
    }

    function construirUrlDashboard() {
        var params = construirParams();
        return window.P11.CONFIG.api.dashboard + (params.length > 0 ? '?' + params.join('&') : '');
    }

    // ---- carregar filtros dinamicos ----

    function carregarFiltrosDinamicos() {
        fetch(window.P11.CONFIG.api.filtros, { credentials: 'same-origin' })
            .then(function (r) { return r.json(); })
            .then(function (resp) {
                if (!resp.success) return;
                var d = resp.data;

                var mapaStatus = {
                    'AGUARDANDO_VAGA':  'Aguardando Vaga',
                    'CHAMADO':          'Transf. Externa',
                    'VAGA_APROVADA':    'Vaga Aprovada',
                    'ACOMODADO':        'Acomodado',
                    'INTERNADO':        'Internado',
                    'TRANSFERIDO':      'Transferido',
                    'CANCELADO_NEGADO': 'Cancelado/Negado',
                    'OUTROS':           'Outros'
                };

                var opcoesStatus = (d.status_internacao || []).map(function (item) {
                    return { valor: item, texto: mapaStatus[item] || item };
                });
                popularMultiSelectDinamico('ms-status-internacao', opcoesStatus);

                var opcoesGv = (d.status_gv || []).map(function (item) {
                    return { valor: item.codigo, texto: item.descricao || item.codigo };
                });
                popularMultiSelectDinamico('ms-status-gv', opcoesGv);

                popularMultiSelectDinamico('ms-clinica',  d.clinicas  || []);
                popularMultiSelectDinamico('ms-convenio', d.convenios || []);
            })
            .catch(function (err) {
                console.error('[P11] Erro filtros:', err);
            });
    }

    window.P11.configurarToggleMultiSelects = configurarToggleMultiSelects;
    window.P11.fecharTodosDropdowns         = fecharTodosDropdowns;
    window.P11.popularMultiSelectDinamico   = popularMultiSelectDinamico;
    window.P11.vincularCheckboxesMultiSelect = vincularCheckboxesMultiSelect;
    window.P11.resetarTodosMultiSelects     = resetarTodosMultiSelects;
    window.P11.construirParams              = construirParams;
    window.P11.construirUrl                 = construirUrl;
    window.P11.construirUrlDashboard        = construirUrlDashboard;
    window.P11.carregarFiltrosDinamicos     = carregarFiltrosDinamicos;

})();
