(function () {
    'use strict';

    function _popularFiltroSetor41() {
        var DOM     = window.P41.DOM;
        var escHtml = window.P41.escHtml;
        if (!DOM.filtroSetor41) return;
        var atual   = DOM.filtroSetor41.value;
        var setores = {};
        var sol = window.P41.Estado.minhasSolicitacoes;
        for (var i = 0; i < sol.length; i++) {
            var s = sol[i].setor_nome;
            if (s) setores[s] = true;
        }
        var html   = '<option value="">Todos os setores</option>';
        var chaves = Object.keys(setores).sort();
        for (var j = 0; j < chaves.length; j++) {
            html += '<option value="' + escHtml(chaves[j]) + '"' +
                (chaves[j] === atual ? ' selected' : '') + '>' + escHtml(chaves[j]) + '</option>';
        }
        DOM.filtroSetor41.innerHTML = html;
    }

    function _popularFiltroRefeicao41() {
        var DOM     = window.P41.DOM;
        var Estado  = window.P41.Estado;
        var escHtml = window.P41.escHtml;
        if (!DOM.filtroRefeicao41) return;
        var atual     = DOM.filtroRefeicao41.value;
        var refeicoes = {};
        var sol = Estado.minhasSolicitacoes;
        for (var i = 0; i < sol.length; i++) {
            if (sol[i].refeicao_nome) refeicoes[sol[i].refeicao_nome] = true;
        }
        var html  = '<option value="">Todas</option>';
        var nomes = Object.keys(refeicoes).sort();
        for (var j = 0; j < nomes.length; j++) {
            html += '<option value="' + escHtml(nomes[j]) + '"' +
                (nomes[j] === atual ? ' selected' : '') + '>' + escHtml(nomes[j]) + '</option>';
        }
        DOM.filtroRefeicao41.innerHTML = html;
        Estado.filtroRefeicao41 = DOM.filtroRefeicao41.value;
    }

    function renderMinhasSolicitacoes() {
        var DOM         = window.P41.DOM;
        var Estado      = window.P41.Estado;
        var escHtml     = window.P41.escHtml;
        var badgeStatus = window.P41.badgeStatus;

        var setorFiltro    = DOM.filtroSetor41    ? DOM.filtroSetor41.value    : '';
        var refeicaoFiltro = Estado.filtroRefeicao41;
        var busca          = Estado.buscaHist;

        var lista = Estado.minhasSolicitacoes.filter(function (s) {
            if (setorFiltro    && s.setor_nome    !== setorFiltro)    return false;
            if (refeicaoFiltro && s.refeicao_nome !== refeicaoFiltro) return false;
            if (busca) {
                var nome = (s.nm_paciente    || '').toLowerCase();
                var nr   = (s.nr_atendimento || '').toLowerCase();
                if (nome.indexOf(busca) === -1 && nr.indexOf(busca) === -1) return false;
            }
            return true;
        });
        Estado.listaFiltrada = lista;

        _popularFiltroSetor41();
        _popularFiltroRefeicao41();

        if (!lista.length) {
            if (Estado.minhasSolicitacoes.length) {
                DOM.tabelaEmpty.style.display  = 'none';
                DOM.tabelaMinhas.style.display = 'table';
                DOM.tbodyMinhas.innerHTML = '<tr><td colspan="13" style="text-align:center;color:#aaa;padding:20px;">Nenhum resultado para os filtros aplicados.</td></tr>';
            } else {
                DOM.tabelaEmpty.style.display  = 'block';
                DOM.tabelaMinhas.style.display = 'none';
            }
            DOM.badgeTotal.style.display = 'none';
            return;
        }

        DOM.tabelaEmpty.style.display  = 'none';
        DOM.tabelaMinhas.style.display = 'table';
        DOM.badgeTotal.style.display   = 'inline-block';
        DOM.badgeTotal.textContent     = lista.length;

        var html = '';
        for (var i = 0; i < lista.length; i++) {
            var s = lista[i];
            var podeCancelar = s.status === 'aguardando';
            var prio = s.prioridade === 'urgente'
                ? '<span class="badge-urgente"><i class="fa-solid fa-bolt"></i> Urgente</span>'
                : '<span class="badge-normal">Normal</span>';

            html += '<tr class="' + (s.status === 'cancelado' ? 'linha-cancelada' : '') + '">' +
                '<td><span class="codigo-entrega">' + escHtml(s.codigo_entrega) + '</span></td>' +
                '<td class="td-dia">' + escHtml(s.data_pedido || '--') + '</td>' +
                '<td>' + escHtml(s.hora_pedido || '--') + '</td>' +
                '<td class="td-nr">' + escHtml(s.nr_atendimento || '--') + '</td>' +
                '<td>' + escHtml(s.nm_paciente) + '</td>' +
                '<td>' + escHtml(s.leito || '--') + '</td>' +
                '<td>' + escHtml(s.setor_nome || '--') + '</td>' +
                '<td>' + escHtml(s.tipo_dieta_nome || '--') + '</td>' +
                '<td>' + escHtml(s.refeicao_nome || '--') + '</td>' +
                '<td>' + prio + '</td>' +
                '<td>' + badgeStatus(s.status) + '</td>' +
                '<td>' +
                    (podeCancelar
                        ? '<button class="btn-canc-linha" data-id="' + s.id + '">' +
                          '<i class="fa-solid fa-xmark"></i></button>'
                        : '--') +
                '</td>' +
                '<td class="td-motivo-cancel">' +
                    (s.motivo_cancelamento ? escHtml(s.motivo_cancelamento) : '--') +
                '</td>' +
            '</tr>';
        }
        DOM.tbodyMinhas.innerHTML = html;

        var btns = DOM.tbodyMinhas.querySelectorAll('.btn-canc-linha');
        for (var j = 0; j < btns.length; j++) {
            btns[j].addEventListener('click', function () {
                window.P41.abrirModalCancelar(this.getAttribute('data-id'));
            });
        }
    }

    function carregarMinhasSolicitacoes() {
        fetch(window.P41.CONFIG.apiBase + '/minhas-solicitacoes', { credentials: 'same-origin' })
            .then(function (r) { return r.json(); })
            .then(function (data) {
                if (data.success) {
                    window.P41.Estado.minhasSolicitacoes = data.solicitacoes || [];
                    renderMinhasSolicitacoes();
                }
            })
            .catch(function (e) { console.error('minhas-solicitacoes', e); });
    }

    function exportarPDF() {
        var Estado  = window.P41.Estado;
        var escHtml = window.P41.escHtml;
        var DOM     = window.P41.DOM;
        var lista   = Estado.listaFiltrada;

        if (!lista || !lista.length) {
            alert('Nenhuma solicitação para exportar com os filtros atuais.');
            return;
        }

        var agora    = new Date();
        var datahora = ('0' + agora.getDate()).slice(-2) + '/' +
                       ('0' + (agora.getMonth() + 1)).slice(-2) + '/' +
                       agora.getFullYear() + ' ' +
                       ('0' + agora.getHours()).slice(-2) + ':' +
                       ('0' + agora.getMinutes()).slice(-2);

        var filtroDesc  = [];
        var setorFiltro = DOM.filtroSetor41 ? DOM.filtroSetor41.value : '';
        if (setorFiltro)             filtroDesc.push('Setor: ' + setorFiltro);
        if (Estado.filtroRefeicao41) filtroDesc.push('Refeição: ' + Estado.filtroRefeicao41);
        if (Estado.buscaHist)        filtroDesc.push('Busca: "' + Estado.buscaHist + '"');
        var filtroTexto = filtroDesc.length ? filtroDesc.join(' | ') : 'Todos';

        var statusMap = {
            aguardando: 'Aguardando', aceito: 'Aceito',
            em_preparo: 'Em Preparo', pronto: 'Pronto',
            em_entrega: 'Em Entrega', entregue: 'Entregue', cancelado: 'Cancelado'
        };

        var rows = '';
        for (var i = 0; i < lista.length; i++) {
            var s = lista[i];
            var isCancelado = s.status === 'cancelado';
            rows += '<tr' + (isCancelado ? ' class="cancelado"' : '') + '>' +
                '<td>' + escHtml(s.codigo_entrega || '--') + '</td>' +
                '<td>' + escHtml(s.data_pedido    || '--') + '</td>' +
                '<td>' + escHtml(s.hora_pedido    || '--') + '</td>' +
                '<td>' + escHtml(s.nr_atendimento || '--') + '</td>' +
                '<td>' + escHtml(s.nm_paciente    || '--') + '</td>' +
                '<td>' + escHtml(s.leito          || '--') + '</td>' +
                '<td>' + escHtml(s.setor_nome     || '--') + '</td>' +
                '<td>' + escHtml(s.tipo_dieta_nome || '--') + '</td>' +
                '<td>' + escHtml(s.refeicao_nome  || '--') + '</td>' +
                '<td>' + (s.prioridade === 'urgente'
                    ? '<strong style="color:#c0392b">Urgente</strong>' : 'Normal') + '</td>' +
                '<td>' + escHtml(statusMap[s.status] || s.status) + '</td>' +
                '<td>' + escHtml(s.motivo_cancelamento || '--') + '</td>' +
            '</tr>';
        }

        var html = '<!DOCTYPE html><html lang="pt-BR"><head>' +
            '<meta charset="UTF-8">' +
            '<title>Solicitações de Dieta — HAC</title>' +
            '<style>' +
                'body{font-family:Arial,sans-serif;font-size:10px;color:#222;margin:10mm;}' +
                'h2{font-size:13px;margin:0 0 3px;}' +
                '.sub{font-size:9px;color:#555;margin-bottom:10px;}' +
                'table{width:100%;border-collapse:collapse;}' +
                'th{background:#1a5c3a;color:#fff;padding:5px 6px;text-align:left;font-size:9px;white-space:nowrap;}' +
                'td{padding:4px 6px;border-bottom:1px solid #e0e0e0;font-size:9px;vertical-align:middle;}' +
                'tr:nth-child(even) td{background:#f5f5f5;}' +
                'tr.cancelado td{color:#aaa;text-decoration:line-through;}' +
                '@media print{@page{size:A4 landscape;margin:10mm}body{margin:0}}' +
            '</style>' +
            '</head><body>' +
            '<h2><i>Solicitações de Dieta — Hospital Anchieta Ceilândia</i></h2>' +
            '<div class="sub">Gerado em: ' + datahora + ' &nbsp;|&nbsp; ' +
                lista.length + ' registro(s) &nbsp;|&nbsp; Filtros: ' + escHtml(filtroTexto) + '</div>' +
            '<table><thead><tr>' +
                '<th>Código</th><th>Dia</th><th>Horário</th><th>NR Atend.</th>' +
                '<th>Paciente</th><th>Leito</th><th>Setor</th><th>Dieta</th>' +
                '<th>Refeição</th><th>Prioridade</th><th>Status</th><th>Motivo Cancel.</th>' +
            '</tr></thead><tbody>' + rows + '</tbody></table>' +
            '<script>window.onload=function(){window.print();}<\/script>' +
            '</body></html>';

        var win = window.open('', '_blank', 'width=900,height=600');
        if (!win) { alert('Permita pop-ups para exportar o PDF.'); return; }
        win.document.write(html);
        win.document.close();
    }

    window.P41.carregarMinhasSolicitacoes = carregarMinhasSolicitacoes;
    window.P41.renderMinhasSolicitacoes   = renderMinhasSolicitacoes;
    window.P41.exportarPDF                = exportarPDF;

})();
