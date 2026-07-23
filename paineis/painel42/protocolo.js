(function () {
    'use strict';

    function abrirModalProtocolo() {
        var DOM     = window.P42.DOM;
        var escHtml = window.P42.escHtml;
        var Estado  = window.P42.Estado;

        var emEntrega = [];
        for (var i = 0; i < Estado.fila.length; i++) {
            if (Estado.fila[i].status === 'em_entrega') emEntrega.push(Estado.fila[i]);
        }
        if (!emEntrega.length) {
            alert('Nenhuma solicitação em entrega no momento.');
            return;
        }

        var setores = {};
        for (var j = 0; j < emEntrega.length; j++) {
            var sn = emEntrega[j].setor_nome;
            if (sn) setores[sn] = true;
        }
        var chaves = Object.keys(setores).sort();
        var html = '<option value="">Todos os setores (' + emEntrega.length + ' paciente(s))</option>';
        for (var k = 0; k < chaves.length; k++) {
            var cnt = 0;
            for (var l = 0; l < emEntrega.length; l++) {
                if (emEntrega[l].setor_nome === chaves[k]) cnt++;
            }
            html += '<option value="' + escHtml(chaves[k]) + '">' +
                escHtml(chaves[k]) + ' (' + cnt + ')</option>';
        }
        DOM.protSetor.innerHTML  = html;
        DOM.protDesc.textContent = emEntrega.length + ' solicitação(ões) em entrega. Selecione o setor ou imprima todos.';
        DOM.modalProtocolo.style.display = 'flex';
    }

    function gerarProtocolo(setorFiltro) {
        var escHtml = window.P42.escHtml;
        var Estado  = window.P42.Estado;

        var lista = [];
        for (var i = 0; i < Estado.fila.length; i++) {
            var s = Estado.fila[i];
            if (s.status !== 'em_entrega') continue;
            if (setorFiltro && s.setor_nome !== setorFiltro) continue;
            lista.push(s);
        }
        if (!lista.length) {
            alert('Nenhuma solicitação em entrega para o filtro selecionado.');
            return;
        }

        var agora  = new Date();
        var data   = agora.toLocaleDateString('pt-BR');
        var hora   = agora.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
        var titulo = setorFiltro ? escHtml(setorFiltro) : 'Todos os setores';

        var linhas = '';
        for (var j = 0; j < lista.length; j++) {
            var s = lista[j];
            linhas +=
                '<tr>' +
                '<td>' + escHtml(s.codigo_entrega || '--') + '</td>' +
                '<td>' + escHtml(s.nr_atendimento || '--') + '</td>' +
                '<td class="td-paciente">' + escHtml(s.nm_paciente || '--') + '</td>' +
                '<td>' + escHtml(s.leito || '--') + '</td>' +
                '<td>' + escHtml(s.setor_nome || '--') + '</td>' +
                '<td>' + escHtml(s.tipo_dieta_nome || '--') + '</td>' +
                '<td>' + escHtml(s.refeicao_nome || '--') + '</td>' +
                '<td class="td-assinatura">' +
                    '<div class="linha-assinatura"></div>' +
                    '<div class="label-assinatura">Assinatura / Nome legível</div>' +
                '</td>' +
                '</tr>';
        }

        var html =
            '<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8">' +
            '<title>Protocolo de Entrega - HAC</title>' +
            '<style>' +
                '@page{size:A4 portrait;margin:12mm}' +
                'body{font-family:Arial,sans-serif;font-size:10px;color:#000;margin:0;padding:0}' +
                '.cabecalho{display:flex;align-items:center;gap:14px;border-bottom:2px solid #000;padding-bottom:8px;margin-bottom:10px}' +
                '.logo-hospital{height:58px;width:auto;flex-shrink:0}' +
                '.cabecalho-texto{flex:1;text-align:center}' +
                '.cabecalho h1{font-size:14px;margin:0 0 3px;font-weight:bold;letter-spacing:.5px}' +
                '.cabecalho h2{font-size:11px;margin:0;font-weight:bold;color:#555;letter-spacing:.5px}' +
                '.info-linha{display:flex;justify-content:space-between;margin-bottom:8px;font-size:9px;border-bottom:1px dashed #bbb;padding-bottom:6px;gap:8px}' +
                'table{width:100%;border-collapse:collapse;margin-top:4px}' +
                'thead th{background:#333;color:#fff;padding:6px 5px;text-align:left;font-size:9px;font-weight:bold;border:1px solid #000}' +
                'tbody td{padding:5px;border:1px solid #ccc;font-size:9px;vertical-align:middle}' +
                '.td-paciente{font-weight:bold;min-width:130px}' +
                '.td-assinatura{width:26%;min-width:90px}' +
                '.linha-assinatura{border-bottom:1px solid #888;height:26px;margin:0 4px 0}' +
                '.label-assinatura{text-align:center;font-size:7px;color:#777;margin-top:2px}' +
                'tbody tr:nth-child(even) td{background:#f5f5f5}' +
                '@media print{@page{size:A4 portrait;margin:12mm}body{print-color-adjust:exact;-webkit-print-color-adjust:exact}}' +
            '</style>' +
            '</head><body>' +
            '<div class="cabecalho">' +
                '<img src="/static/img/logo.png" class="logo-hospital" alt="Hospital Anchieta">' +
                '<div class="cabecalho-texto">' +
                    '<h1>HOSPITAL ANCHIETA CEILÂNDIA</h1>' +
                    '<h2>PROTOCOLO DE ENTREGA DE DIETA</h2>' +
                '</div>' +
            '</div>' +
            '<div class="info-linha">' +
                '<span><b>Data:</b> ' + data + '</span>' +
                '<span><b>Emissão:</b> ' + hora + '</span>' +
                '<span><b>Setor:</b> ' + titulo + '</span>' +
                '<span><b>Total:</b> ' + lista.length + ' paciente(s)</span>' +
            '</div>' +
            '<table>' +
                '<thead><tr>' +
                    '<th>Código</th><th>NR Atend.</th><th>Paciente</th><th>Leito</th>' +
                    '<th>Setor</th><th>Dieta</th><th>Refeição</th>' +
                    '<th>Recebimento (Assinatura / Nome)</th>' +
                '</tr></thead>' +
                '<tbody>' + linhas + '</tbody>' +
            '</table>' +
            '<script>window.onload=function(){window.print();};<\/script>' +
            '</body></html>';

        var w = window.open('', '_blank', 'width=820,height=700,toolbar=0,menubar=0,location=0,scrollbars=1');
        if (!w) { alert('Permita pop-ups para imprimir o protocolo.'); return; }
        w.document.open();
        w.document.write(html);
        w.document.close();
        w.focus();
    }

    window.P42.abrirModalProtocolo = abrirModalProtocolo;
    window.P42.gerarProtocolo      = gerarProtocolo;

})();
