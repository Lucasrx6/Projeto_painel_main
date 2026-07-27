(function () {
    'use strict';

    function escHtml(str) {
        if (!str) return '';
        return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    function toast(msg, tipo) {
        var container = document.getElementById('toast-container');
        var el        = document.createElement('div');
        el.className  = 'toast toast-' + (tipo || 'info');
        el.textContent = msg;
        container.appendChild(el);
        setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 3500);
    }

    function dataHoje() {
        var d = new Date();
        return d.getFullYear() + '-' +
               ('0' + (d.getMonth() + 1)).slice(-2) + '-' +
               ('0' + d.getDate()).slice(-2);
    }

    function getFiltros() {
        return {
            data_inicio: document.getElementById('filtro-data-inicio').value,
            data_fim:    document.getElementById('filtro-data-fim').value,
            status:      document.getElementById('filtro-status').value,
            prioridade:  document.getElementById('filtro-prioridade').value
        };
    }

    function periodoQs(f) {
        return 'data_inicio=' + encodeURIComponent(f.data_inicio) +
               '&data_fim='   + encodeURIComponent(f.data_fim);
    }

    // Formata minutos ou retorna '--'
    function min(v) {
        return v != null ? Math.round(v) + ' min' : '--';
    }

    function badgeStatus(status) {
        var label = {
            aguardando:    'Aguardando',
            aceito:        'Aceito',
            em_transporte: 'Em Transporte',
            concluido:     'Concluido',
            cancelado:     'Cancelado'
        }[status] || escHtml(status) || '--';
        return '<span class="badge-status badge-' + status + '">' + label + '</span>';
    }

    // Fetch genérico para listas de config: loading → fetch → onSuccess(data[key])
    function cfgFetch(url, containerId, key, onSuccess) {
        var el = document.getElementById(containerId);
        el.innerHTML = '<div class="loading"><div class="loading-spinner"></div></div>';
        fetch(url, { credentials: 'same-origin' })
            .then(function (r) { return r.json(); })
            .then(function (data) { if (data.success) onSuccess(data[key]); })
            .catch(function () { el.innerHTML = '<p style="padding:20px;color:#aaa;">Erro de conexao</p>'; });
    }

    // HTML dos botões Editar + Toggle — idêntico em todos os cards de config
    function btnAcoes(ctx, id, ativo) {
        return '<div class="config-item-acoes">' +
            '<button class="btn-editar" title="Editar" data-id="' + id + '" data-ctx="' + ctx + '"><i class="fas fa-pencil-alt"></i></button>' +
            '<button class="btn-toggle ' + (ativo ? 'ativo' : 'inativo') + '" title="' + (ativo ? 'Desativar' : 'Ativar') + '" data-id="' + id + '" data-ctx="' + ctx + '" data-ativo="' + ativo + '">' +
                '<i class="fas fa-' + (ativo ? 'check' : 'times') + '"></i>' +
            '</button>' +
        '</div>';
    }

    // Acopla .btn-editar e .btn-toggle após renderizar uma lista de config
    function bindConfigEvents(container, ctx, items, abrirFn) {
        container.querySelectorAll('.btn-editar[data-ctx="' + ctx + '"]').forEach(function (btn) {
            btn.addEventListener('click', function () {
                var item = items.filter(function (x) { return String(x.id) === btn.dataset.id; })[0];
                abrirFn(item || null);
            });
        });
        container.querySelectorAll('.btn-toggle[data-ctx="' + ctx + '"]').forEach(function (btn) {
            btn.addEventListener('click', function () {
                window.P36.toggleAtivo(ctx, btn.dataset.id, btn.dataset.ativo === 'true');
            });
        });
    }

    window.P36.escHtml          = escHtml;
    window.P36.toast            = toast;
    window.P36.dataHoje         = dataHoje;
    window.P36.getFiltros       = getFiltros;
    window.P36.periodoQs        = periodoQs;
    window.P36.min              = min;
    window.P36.badgeStatus      = badgeStatus;
    window.P36.cfgFetch         = cfgFetch;
    window.P36.btnAcoes         = btnAcoes;
    window.P36.bindConfigEvents = bindConfigEvents;

})();
