(function () {
    'use strict';

    var _ORDEM_MODAIS = ['RM', 'TC', 'USG', 'RX', 'MAM', 'OUTROS', ''];

    function _agruparSlotsPorModal() {
        var E      = window.P46.Estado;
        var grupos = {};
        for (var i = 0; i < E.slots.length; i++) {
            var m = E.slots[i].modalidade || '';
            if (!grupos[m]) grupos[m] = [];
            grupos[m].push(E.slots[i]);
        }
        return grupos;
    }

    function _textoStatusSlot(sl) {
        if (sl.status === 'bloqueado') return 'Bloqueado';
        if (sl.status === 'livre')     return 'Disponível';
        var rs = sl.radio_status || '';
        if (rs === 'agendado')   return 'Agendado';
        if (rs === 'no_local')   return 'No Local';
        if (rs === 'executando') return 'Em Execução';
        if (rs === 'concluido')  return 'Concluído';
        if (rs === 'cancelado')  return 'Cancelado';
        return 'Agendado';
    }

    function _corStatusSlot(sl) {
        if (sl.status === 'bloqueado') return '#dc3545';
        if (sl.status === 'livre')     return '#6c757d';
        var rs = sl.radio_status || '';
        if (rs === 'concluido')  return '#28a745';
        if (rs === 'no_local')   return '#e6820a';
        if (rs === 'executando') return '#6f42c1';
        return '#0d6efd';
    }

    // ── Gerar PDF da agenda do dia ────────────────────────────────────────────

    function gerarAgendaPDF() {
        var E     = window.P46.Estado;
        var toast = window.P46.toast;
        if (!E.slots.length) { toast('Nenhuma vaga na agenda do dia.', 'warning'); return; }

        var grupos  = _agruparSlotsPorModal();
        var dataFmt = window.P46.isoParaDisplay(E.dataConsulta);
        var baseUrl = window.location.origin;
        var agora   = new Date().toLocaleString('pt-BR');

        var escHtml = window.P46.escHtml;
        var fNome   = window.P46.formatarNome;
        var fHora   = window.P46.formatarHora;

        var css = '<style>'
            + 'body{font-family:Arial,sans-serif;margin:24px;color:#212529;font-size:13px;}'
            + '.no-print{margin-bottom:12px;}'
            + '.btn-p{padding:8px 18px;background:#343a40;color:#fff;border:none;border-radius:6px;cursor:pointer;font-weight:700;font-size:13px;margin-right:6px;}'
            + '.header{display:flex;align-items:center;gap:14px;border-bottom:2px solid #333;padding-bottom:12px;margin-bottom:20px;}'
            + '.logo{height:52px;}'
            + '.header h1{font-size:20px;margin:0;}'
            + '.header p{margin:4px 0 0;font-size:12px;color:#6c757d;}'
            + '.secao{margin-bottom:28px;page-break-inside:avoid;}'
            + '.secao-h{font-size:13px;font-weight:700;background:#343a40;color:#fff;padding:7px 12px;border-radius:4px 4px 0 0;margin:0;letter-spacing:.5px;}'
            + 'table{width:100%;border-collapse:collapse;font-size:12px;}'
            + 'th{background:#f1f3f5;border:1px solid #ced4da;padding:6px 9px;text-align:left;color:#495057;}'
            + 'td{border:1px solid #dee2e6;padding:6px 9px;vertical-align:top;}'
            + 'tr:nth-child(even) td{background:#f8f9fa;}'
            + '.rodape{margin-top:28px;border-top:1px solid #dee2e6;padding-top:8px;font-size:10px;color:#adb5bd;text-align:right;}'
            + '@media print{.no-print{display:none;}}'
            + '</style>';

        var corpo = '<div class="no-print">'
            + '<button class="btn-p" onclick="window.print()"><i>🖨</i> Imprimir / Salvar PDF</button>'
            + '</div>'
            + '<div class="header">'
            + '<img class="logo" src="' + baseUrl + '/static/img/logo.png" alt="HAC" onerror="this.style.display=\'none\'">'
            + '<div><h1>Agenda de Radiologia</h1>'
            + '<p>Data: <strong>' + dataFmt + '</strong>&nbsp;&nbsp;·&nbsp;&nbsp;Gerado em: ' + agora + '</p></div>'
            + '</div>';

        for (var oi = 0; oi < _ORDEM_MODAIS.length; oi++) {
            var m     = _ORDEM_MODAIS[oi];
            var grupo = grupos[m];
            if (!grupo || !grupo.length) continue;
            var nomeM = m || 'Qualquer Modalidade';
            corpo += '<div class="secao"><div class="secao-h">' + nomeM + ' — ' + grupo.length + ' vaga(s)</div>'
                   + '<table><thead><tr>'
                   + '<th style="width:68px">Horário</th>'
                   + '<th style="width:44px">Dur.</th>'
                   + '<th style="width:170px">Paciente</th>'
                   + '<th>Procedimento</th>'
                   + '<th style="width:78px">Leito</th>'
                   + '<th style="width:110px">Setor</th>'
                   + '<th style="width:82px">Status</th>'
                   + '<th style="width:150px">Preparo</th>'
                   + '</tr></thead><tbody>';
            for (var si = 0; si < grupo.length; si++) {
                var sl = grupo[si];
                corpo += '<tr>'
                    + '<td><strong>' + escHtml(fHora(sl.data_hora)) + '</strong></td>'
                    + '<td>' + escHtml(String(sl.duracao_min || 30)) + 'min</td>'
                    + '<td>' + escHtml(fNome(sl.nm_paciente || '') || '—') + '</td>'
                    + '<td>' + escHtml(sl.ds_procedimento || '—') + '</td>'
                    + '<td>' + escHtml(sl.leito_origem || '—') + '</td>'
                    + '<td>' + escHtml(sl.setor_origem_nome || '—') + '</td>'
                    + '<td style="color:' + _corStatusSlot(sl) + ';font-weight:700;">' + _textoStatusSlot(sl) + '</td>'
                    + '<td>' + (sl.requer_preparo && sl.tipo_preparo ? escHtml(sl.tipo_preparo) : '—') + '</td>'
                    + '</tr>';
            }
            corpo += '</tbody></table></div>';
        }
        corpo += '<div class="rodape">Hospital Anchieta Ceilândia &middot; Sistema de Painéis HAC</div>';

        var janela = window.open('', '_blank', 'width=960,height=720');
        if (!janela) { toast('Permita pop-ups para gerar o PDF.', 'warning'); return; }
        janela.document.write('<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8">'
            + '<title>Agenda Radiologia - ' + dataFmt + '</title>' + css + '</head><body>' + corpo + '</body></html>');
        janela.document.close();
        janela.focus();
    }

    // ── Exportar agenda como Excel (CSV) ──────────────────────────────────────

    function exportarAgendaExcel() {
        var E     = window.P46.Estado;
        var toast = window.P46.toast;
        if (!E.slots.length) { toast('Nenhuma vaga na agenda do dia.', 'warning'); return; }

        var grupos  = _agruparSlotsPorModal();
        var data    = E.dataConsulta;
        var fNome   = window.P46.formatarNome;
        var fHora   = window.P46.formatarHora;

        var linhas = [['Modalidade', 'Horário', 'Duração (min)', 'Paciente', 'Procedimento', 'Leito', 'Setor', 'Status', 'Preparo']];

        for (var oi = 0; oi < _ORDEM_MODAIS.length; oi++) {
            var m     = _ORDEM_MODAIS[oi];
            var grupo = grupos[m];
            if (!grupo || !grupo.length) continue;
            var nomeM = m || 'Qualquer';
            for (var si = 0; si < grupo.length; si++) {
                var sl = grupo[si];
                linhas.push([
                    nomeM,
                    fHora(sl.data_hora),
                    sl.duracao_min || 30,
                    fNome(sl.nm_paciente || '') || '—',
                    sl.ds_procedimento || '—',
                    sl.leito_origem || '—',
                    sl.setor_origem_nome || '—',
                    _textoStatusSlot(sl),
                    (sl.requer_preparo && sl.tipo_preparo) ? sl.tipo_preparo : '—'
                ]);
            }
        }

        // CSV com ponto-e-vírgula (padrão BR do Excel) + BOM UTF-8
        var csv = '﻿';
        for (var li = 0; li < linhas.length; li++) {
            csv += linhas[li].map(function (v) {
                var s = String(v).replace(/"/g, '""');
                return (s.indexOf(';') >= 0 || s.indexOf('"') >= 0 || s.indexOf('\n') >= 0)
                    ? '"' + s + '"' : s;
            }).join(';') + '\r\n';
        }

        var blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        var url  = URL.createObjectURL(blob);
        var a    = document.createElement('a');
        a.href     = url;
        a.download = 'agenda_radiologia_' + data + '.csv';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        toast('Arquivo Excel gerado!', 'success');
    }

    window.P46.gerarAgendaPDF      = gerarAgendaPDF;
    window.P46.exportarAgendaExcel = exportarAgendaExcel;

})();
