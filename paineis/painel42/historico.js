(function () {
    'use strict';

    function _detalheItem(label, valorHtml, fullSpan) {
        return '<div class="detalhe-item' + (fullSpan ? ' span-full' : '') + '">' +
            '<span class="detalhe-label">' + window.P42.escHtml(label) + '</span>' +
            '<span class="detalhe-valor">' + valorHtml + '</span>' +
        '</div>';
    }

    function _popularFiltroSetor42() {
        var DOM = window.P42.DOM;
        var escHtml = window.P42.escHtml;
        if (!DOM.filtroSetor42) return;
        var atual   = DOM.filtroSetor42.value;
        var setores = {};
        var hist = window.P42.Estado.historico;
        for (var i = 0; i < hist.length; i++) {
            var s = hist[i].setor_nome;
            if (s) setores[s] = true;
        }
        var html   = '<option value="">Todos</option>';
        var chaves = Object.keys(setores).sort();
        for (var j = 0; j < chaves.length; j++) {
            html += '<option value="' + escHtml(chaves[j]) + '"' +
                (chaves[j] === atual ? ' selected' : '') + '>' + escHtml(chaves[j]) + '</option>';
        }
        DOM.filtroSetor42.innerHTML = html;
    }

    function abrirDetalhesHistorico(id) {
        var DOM     = window.P42.DOM;
        var escHtml = window.P42.escHtml;
        var fmtMin  = window.P42.fmtMin;
        var hist    = window.P42.Estado.historico;
        var h = null;
        for (var i = 0; i < hist.length; i++) {
            if (String(hist[i].id) === String(id)) { h = hist[i]; break; }
        }
        if (!h || !DOM.modalDetalheHist) return;

        DOM.detalheHistCorpo.innerHTML =
            '<div class="detalhe-hist-grid">' +
                _detalheItem('Código de Entrega', escHtml(h.codigo_entrega || '—')) +
                _detalheItem('Nº Atendimento',    escHtml(h.nr_atendimento || '—')) +
                _detalheItem('Paciente',           escHtml(h.nm_paciente   || '—')) +
                _detalheItem('Status',             window.P42.badgeStatus(h.status)) +
                _detalheItem('Leito',    escHtml(h.leito      || '—')) +
                _detalheItem('Setor',    escHtml(h.setor_nome || '—')) +
                _detalheItem('Dieta',    escHtml(h.tipo_dieta_nome || '—')) +
                _detalheItem('Refeição', escHtml(h.refeicao_nome || '—')) +
                '<hr class="detalhe-separador">' +
                _detalheItem('Restrições', escHtml(h.restricoes || '—'), true) +
                _detalheItem('Observação', escHtml(h.observacao || '—'), true) +
                (h.motivo_cancelamento ? _detalheItem('Motivo Cancelamento', escHtml(h.motivo_cancelamento), true) : '') +
                '<hr class="detalhe-separador">' +
                _detalheItem('Responsável pelo preparo', escHtml(h.responsavel_nome || '—')) +
                _detalheItem('Entregue por',             escHtml(h.entregue_por     || '—')) +
                _detalheItem('Solicitado em', escHtml((h.data_pedido || '') + ' ' + (h.criado_em || ''))) +
                _detalheItem('Finalizado em', escHtml(h.dt_entrega || h.dt_cancelamento || '—')) +
                _detalheItem('Tempo total',   h.t_total_min != null ? escHtml(fmtMin(h.t_total_min)) : '—') +
                _detalheItem('Prioridade',    escHtml(h.prioridade === 'urgente' ? 'URGENTE' : 'Normal')) +
            '</div>';

        DOM.modalDetalheHist.style.display = 'flex';
    }

    function bindHistBtns() {
        var tbody = window.P42.DOM.tbodyHistorico;
        var btns  = tbody.querySelectorAll('.btn-ver-hist');
        for (var i = 0; i < btns.length; i++) {
            btns[i].addEventListener('click', function () {
                abrirDetalhesHistorico(this.getAttribute('data-id'));
            });
        }
    }

    function renderHistorico() {
        var DOM       = window.P42.DOM;
        var escHtml   = window.P42.escHtml;
        var fmtMin    = window.P42.fmtMin;
        var badgeStatus = window.P42.badgeStatus;
        var Estado    = window.P42.Estado;

        var setorFiltro = DOM.filtroSetor42 ? DOM.filtroSetor42.value : '';
        var lista = Estado.historico.filter(function (h) {
            return !setorFiltro || h.setor_nome === setorFiltro;
        });

        _popularFiltroSetor42();
        DOM.badgeHistorico.textContent = Estado.historico.length;

        if (!lista.length) {
            DOM.tbodyHistorico.innerHTML = Estado.historico.length
                ? '<tr><td colspan="12" style="text-align:center;color:#aaa;padding:16px;">Nenhum resultado para este setor.</td></tr>'
                : '';
            DOM.histEmpty.style.display = Estado.historico.length ? 'none' : 'block';
            return;
        }
        DOM.histEmpty.style.display = 'none';

        var html = '';
        for (var i = 0; i < lista.length; i++) {
            var h = lista[i];
            html += '<tr>' +
                '<td class="td-dia">' + escHtml(h.data_pedido || '--') + '</td>' +
                '<td><span class="codigo-hist">' + escHtml(h.codigo_entrega) + '</span></td>' +
                '<td>' + escHtml(h.nm_paciente) + '</td>' +
                '<td>' + escHtml(h.leito || '--') + '</td>' +
                '<td>' + escHtml(h.tipo_dieta_nome || '--') + '</td>' +
                '<td>' + escHtml(h.refeicao_nome || '--') + '</td>' +
                '<td>' + escHtml(h.responsavel_nome || '--') + '</td>' +
                '<td>' + badgeStatus(h.status) + '</td>' +
                '<td>' + escHtml(h.criado_em || '--') + '</td>' +
                '<td>' + escHtml(h.dt_entrega || h.dt_cancelamento || '--') + '</td>' +
                '<td>' + (h.t_total_min != null ? fmtMin(h.t_total_min) : '--') + '</td>' +
                '<td class="td-motivo-cancel">' +
                    (h.motivo_cancelamento ? escHtml(h.motivo_cancelamento) : '--') +
                '</td>' +
                '<td class="td-acoes-hist">' +
                    '<button class="btn-ver-hist" data-id="' + h.id + '" title="Ver detalhes">' +
                        '<i class="fa-solid fa-eye"></i>' +
                    '</button>' +
                '</td>' +
            '</tr>';
        }
        DOM.tbodyHistorico.innerHTML = html;
        bindHistBtns();
    }

    function toggleHistorico() {
        var DOM    = window.P42.DOM;
        var visivel = DOM.historicoBody.style.display !== 'none';
        DOM.historicoBody.style.display = visivel ? 'none' : 'block';
        DOM.iconeToggle.className = visivel
            ? 'fa-solid fa-chevron-down'
            : 'fa-solid fa-chevron-up';
    }

    function carregarHistorico() {
        fetch(window.P42.CONFIG.apiBase + '/historico-hoje', { credentials: 'same-origin' })
            .then(function (r) { return r.json(); })
            .then(function (data) {
                if (data.success) {
                    window.P42.Estado.historico = data.historico || [];
                    renderHistorico();
                }
            })
            .catch(function (e) { console.error('historico', e); });
    }

    function gerarRelatorioHistorico(incluirCancelados) {
        var DOM       = window.P42.DOM;
        var escHtml   = window.P42.escHtml;
        var fmtMin    = window.P42.fmtMin;
        var STATUS_CFG = window.P42.STATUS_CFG;
        var Estado    = window.P42.Estado;

        var setorFiltro = DOM.filtroSetor42 ? DOM.filtroSetor42.value : '';
        var lista = [];
        for (var i = 0; i < Estado.historico.length; i++) {
            var h = Estado.historico[i];
            if (setorFiltro && h.setor_nome !== setorFiltro) continue;
            if (!incluirCancelados && h.status === 'cancelado') continue;
            lista.push(h);
        }

        if (!lista.length) {
            alert('Sem registros no histórico para gerar o relatório.');
            return;
        }

        var agora  = new Date();
        var data   = agora.toLocaleDateString('pt-BR');
        var hora   = agora.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
        var titulo = setorFiltro ? escHtml(setorFiltro) : 'Todos os setores';

        var linhas = '';
        for (var j = 0; j < lista.length; j++) {
            var s = lista[j];
            var statusCfg = STATUS_CFG[s.status] || { label: s.status, cor: '#6C757D' };
            linhas +=
                '<tr>' +
                '<td>' + escHtml(s.data_pedido || '--') + '</td>' +
                '<td class="td-cod">' + escHtml(s.codigo_entrega || '--') + '</td>' +
                '<td class="td-pac">' + escHtml(s.nm_paciente || '--') + '</td>' +
                '<td>' + escHtml(s.nr_atendimento || '--') + '</td>' +
                '<td>' + escHtml(s.leito || '--') + '</td>' +
                '<td>' + escHtml(s.setor_nome || '--') + '</td>' +
                '<td>' + escHtml(s.tipo_dieta_nome || '--') + '</td>' +
                '<td>' + escHtml(s.refeicao_nome || '--') + '</td>' +
                '<td class="td-obs">' + escHtml(s.observacao || '--') + '</td>' +
                '<td>' + escHtml(s.responsavel_nome || '--') + '</td>' +
                '<td>' + escHtml(statusCfg.label) + '</td>' +
                '<td>' + escHtml(s.criado_em || '--') + '</td>' +
                '<td>' + escHtml(s.dt_entrega || s.dt_cancelamento || '--') + '</td>' +
                '<td>' + (s.t_total_min != null ? fmtMin(s.t_total_min) : '--') + '</td>' +
                '</tr>';
        }

        var html =
            '<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8">' +
            '<title>Relatório de Dietas - HAC</title>' +
            '<style>' +
                '@page{size:A4 landscape;margin:10mm}' +
                'body{font-family:Arial,sans-serif;font-size:9px;color:#000;margin:0;padding:0}' +
                '.cabecalho{display:flex;align-items:center;gap:14px;border-bottom:2px solid #000;padding-bottom:8px;margin-bottom:10px}' +
                '.logo-hospital{height:52px;width:auto;flex-shrink:0}' +
                '.cabecalho-texto{flex:1;text-align:center}' +
                '.cabecalho h1{font-size:13px;margin:0 0 3px;font-weight:bold;letter-spacing:.5px}' +
                '.cabecalho h2{font-size:11px;margin:0;font-weight:bold;color:#555;letter-spacing:.5px}' +
                '.info-linha{display:flex;justify-content:space-between;margin-bottom:8px;font-size:9px;border-bottom:1px dashed #bbb;padding-bottom:6px;gap:8px}' +
                'table{width:100%;border-collapse:collapse;margin-top:4px}' +
                'thead th{background:#333;color:#fff;padding:5px 4px;text-align:left;font-size:8px;font-weight:bold;border:1px solid #000}' +
                'tbody td{padding:4px;border:1px solid #ccc;font-size:8px;vertical-align:top}' +
                '.td-pac{font-weight:bold;min-width:90px}' +
                '.td-cod{font-family:monospace}' +
                '.td-obs{min-width:80px;white-space:normal;word-break:break-word}' +
                'tbody tr:nth-child(even) td{background:#f5f5f5}' +
                '@media print{@page{size:A4 landscape;margin:10mm}body{print-color-adjust:exact;-webkit-print-color-adjust:exact}}' +
            '</style>' +
            '</head><body>' +
            '<div class="cabecalho">' +
                '<img src="/static/img/logo.png" class="logo-hospital" alt="Hospital Anchieta">' +
                '<div class="cabecalho-texto">' +
                    '<h1>HOSPITAL ANCHIETA CEILÂNDIA</h1>' +
                    '<h2>RELATÓRIO DE ENTREGAS DE DIETAS — ' + data + '</h2>' +
                '</div>' +
            '</div>' +
            '<div class="info-linha">' +
                '<span><b>Data:</b> ' + data + '</span>' +
                '<span><b>Emissão:</b> ' + hora + '</span>' +
                '<span><b>Setor:</b> ' + titulo + '</span>' +
                '<span><b>Total de registros:</b> ' + lista.length + '</span>' +
            '</div>' +
            '<table>' +
                '<thead><tr>' +
                    '<th>Dia</th><th>Código</th><th>Paciente</th><th>NR Atend.</th>' +
                    '<th>Leito</th><th>Setor</th><th>Dieta</th><th>Refeição</th>' +
                    '<th>Observação</th><th>Responsável</th><th>Status</th>' +
                    '<th>Solicitado</th><th>Finalizado</th><th>Tempo</th>' +
                '</tr></thead>' +
                '<tbody>' + linhas + '</tbody>' +
            '</table>' +
            '<script>window.onload=function(){window.print();};<\/script>' +
            '</body></html>';

        var w = window.open('', '_blank', 'width=1100,height=700,toolbar=0,menubar=0,location=0,scrollbars=1');
        if (!w) { alert('Permita pop-ups para imprimir o relatório.'); return; }
        w.document.open();
        w.document.write(html);
        w.document.close();
        w.focus();
    }

    window.P42.carregarHistorico       = carregarHistorico;
    window.P42.renderHistorico         = renderHistorico;
    window.P42.toggleHistorico         = toggleHistorico;
    window.P42.gerarRelatorioHistorico = gerarRelatorioHistorico;

})();
