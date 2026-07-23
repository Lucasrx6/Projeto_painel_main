(function () {
    'use strict';

    var _zplBlobUrl = null;

    var _EXEMPLO = {
        NR_ATENDIMENTO: '123456',
        PACIENTE:        'Maria das Graças Oliveira',
        LEITO:           'A-101',
        SETOR:           'Clínica Médica',
        DIETA:           'Dieta Branda',
        REFEICAO:        'Almoço',
        RESTRICOES:      'Sem glúten, sem lactose',
        OBS:             'Sem sal',
        CODIGO:          'NUT-0001',
        DATA:            '13/07/2026',
        HORA:            '11:30'
    };

    function _preencherVarsExemplo(template) {
        return template
            .replace(/\{\{NR_ATENDIMENTO\}\}/g, _EXEMPLO.NR_ATENDIMENTO)
            .replace(/\{\{PACIENTE\}\}/g,        _EXEMPLO.PACIENTE)
            .replace(/\{\{LEITO\}\}/g,           _EXEMPLO.LEITO)
            .replace(/\{\{SETOR\}\}/g,           _EXEMPLO.SETOR)
            .replace(/\{\{DIETA\}\}/g,           _EXEMPLO.DIETA)
            .replace(/\{\{REFEICAO\}\}/g,        _EXEMPLO.REFEICAO)
            .replace(/\{\{RESTRICOES\}\}/g,      _EXEMPLO.RESTRICOES)
            .replace(/\{\{OBS\}\}/g,             _EXEMPLO.OBS)
            .replace(/\{\{CODIGO\}\}/g,          _EXEMPLO.CODIGO)
            .replace(/\{\{DATA\}\}/g,            _EXEMPLO.DATA)
            .replace(/\{\{HORA\}\}/g,            _EXEMPLO.HORA);
    }

    var PDF_TEMPLATE_PADRAO = [
        '<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8">',
        '<title>Etiqueta Dieta</title>',
        '<script src="https://cdn.jsdelivr.net/npm/jsbarcode@3.11.6/dist/JsBarcode.all.min.js"><\/script>',
        '<style>',
        '@page { size: 7cm 10cm; margin: 3mm }',
        'body { font-family: Arial, sans-serif; font-size: 10px; margin: 0; padding: 0; }',
        'svg { max-width: 100%; height: 45px; display: block; margin: 0 auto; }',
        '@media print { body { print-color-adjust: exact; -webkit-print-color-adjust: exact } }',
        '</style></head><body>',
        '<div style="padding: 2mm">',
        '  <div style="font-size: 12px; font-weight: bold; text-align: center; border-bottom: 1px solid #000; padding-bottom: 2mm; margin-bottom: 2mm">Hospital Anchieta Ceilândia</div>',
        '  <div style="font-weight: bold; font-size: 11px; margin-bottom: 2px; word-break: break-word;"><span style="font-weight: normal">Paciente: </span>{{PACIENTE}}</div>',
        '  <div style="display: flex; justify-content: space-between; font-size: 8px; color: #555; margin-bottom: 5px;">',
        '    <span>Cód: {{CODIGO}}</span>',
        '    <span>{{DATA}} {{HORA}}</span>',
        '  </div>',
        '  <div style="margin-bottom: 5px"><span style="font-weight: bold">Leito:</span> {{LEITO}} &nbsp; <span style="font-weight: bold">Setor:</span> {{SETOR}}</div>',
        '  <div style="margin-bottom: 5px"><span style="font-weight: bold">Dieta:</span> {{DIETA}} &mdash; {{REFEICAO}}</div>',
        '  <div style="margin-bottom: 5px"><span style="font-weight: bold">Restrições:</span> {{RESTRICOES}}</div>',
        '  <div style="margin-bottom: 5px; min-height: 8mm; line-height: 1.6;"><span style="font-weight: bold">Obs:</span> {{OBS}}</div>',
        '  <div style="text-align: center; margin: 1mm 0"><svg id="bc"></svg></div>',
        '  <div style="text-align: center; font-size: 8px; font-weight: bold; font-family: monospace;">{{NR_ATENDIMENTO}}</div>',
        '</div>',
        '<script>',
        'window.onload = function() {',
        '  if (typeof JsBarcode !== "undefined") {',
        '    JsBarcode("#bc", "{{NR_ATENDIMENTO}}", {format:"CODE128",width:1.8,height:45,displayValue:false,margin:0});',
        '  }',
        '};',
        '<\/script>',
        '</body></html>'
    ].join('\n');

    var ZPL_TEMPLATE_PADRAO = [
        '^XA',
        '^PW800',
        '^LL480',
        '^CI28',
        '^LH0,0',
        '',
        '^FO0,10^A0N,24,24^FB800,1,0,C^FDHospital Anchieta Ceilandia^FS',
        '^FO0,42^GB800,2,2^FS',
        '',
        '^FO15,55^A0N,18,18^FDPaciente: {{PACIENTE}}^FS',
        '^FO15,80^A0N,18,18^FDLeito: {{LEITO}}^FS',
        '^FO420,80^A0N,18,18^FDSetor: {{SETOR}}^FS',
        '^FO15,105^A0N,18,18^FDDieta: {{DIETA}} - {{REFEICAO}}^FS',
        '',
        '^FO15,128^GB770,38,1^FS',
        '^FO22,136^A0N,16,16^FDRestricoes: {{RESTRICOES}}^FS',
        '',
        '^FO15,173^A0N,18,18^FDObs: {{OBS}}^FS',
        '',
        '^FO155,195^BY2^BCN,75,N,N,N^FD{{NR_ATENDIMENTO}}^FS',
        '',
        '^FO0,285^A0N,22,22^FB800,1,0,C^FD{{NR_ATENDIMENTO}}^FS',
        '',
        '^FO0,318^GB800,1,1^FS',
        '^FO15,325^A0N,14,14^FDCod: {{CODIGO}}^FS',
        '^FO530,325^A0N,14,14^FD{{DATA}} {{HORA}}^FS',
        '',
        '^XZ'
    ].join('\n');

    function toggleEtiquetaGrupos() {
        var modo   = document.getElementById('etq-modo').value;
        var grpPdf = document.getElementById('etq-pdf-group');
        var grpZpl = document.getElementById('etq-zpl-group');
        if (grpPdf) grpPdf.style.display = (modo === 'pdf') ? 'flex' : 'none';
        if (grpZpl) grpZpl.style.display = (modo === 'zpl') ? 'flex' : 'none';
    }

    function atualizarPreviewPDF() {
        var frame    = document.getElementById('etq-preview');
        var template = document.getElementById('etq-pdf').value;
        if (!frame || !template) return;
        frame.srcdoc = _preencherVarsExemplo(template);
    }

    function atualizarPreviewZPL() {
        var template = (document.getElementById('etq-zpl').value || '').trim();
        var img      = document.getElementById('etq-zpl-preview');
        var status   = document.getElementById('etq-zpl-preview-status');
        if (!img || !status) return;
        if (!template) {
            img.style.display  = 'none';
            status.className   = 'etq-zpl-preview-status';
            status.textContent = 'Digite o ZPL para visualizar';
            return;
        }

        var zpl = _preencherVarsExemplo(template);

        status.className   = 'etq-zpl-preview-status carregando';
        status.textContent = 'Gerando preview...';
        img.style.opacity  = '0.4';

        if (_zplBlobUrl) { URL.revokeObjectURL(_zplBlobUrl); _zplBlobUrl = null; }

        fetch(window.P43.CONFIG.apiBase + '/preview-zpl', {
            method:      'POST',
            credentials: 'same-origin',
            headers:     { 'Content-Type': 'text/plain' },
            body:        zpl
        })
        .then(function (r) {
            if (r.status === 503) throw new Error('sem_internet');
            if (!r.ok) throw new Error(r.status);
            return r.blob();
        })
        .then(function (blob) {
            if (_zplBlobUrl) { URL.revokeObjectURL(_zplBlobUrl); _zplBlobUrl = null; }
            _zplBlobUrl       = URL.createObjectURL(blob);
            img.src           = _zplBlobUrl;
            img.style.display = 'block';
            img.style.opacity = '1';
            status.textContent = '';
            status.className   = 'etq-zpl-preview-status';
        })
        .catch(function (err) {
            img.style.opacity  = '1';
            status.className   = 'etq-zpl-preview-status erro';
            status.textContent = (err.message === 'sem_internet')
                ? 'Servidor sem acesso à internet (Labelary indisponível)'
                : 'ZPL inválido ou erro no servidor';
        });
    }

    function carregarEtiqueta() {
        fetch(window.P43.CONFIG.apiBase + '/config/etiqueta', { credentials: 'same-origin' })
            .then(function (r) { return r.json(); })
            .then(function (data) {
                if (data.success) {
                    document.getElementById('etq-modo').value = data.modo_impressao || 'pdf';
                    document.getElementById('etq-zpl').value  = data.zpl_template  || ZPL_TEMPLATE_PADRAO;
                    document.getElementById('etq-pdf').value  = data.pdf_template  || PDF_TEMPLATE_PADRAO;
                    var nameEl = document.getElementById('etq-printer-name');
                    var ipEl   = document.getElementById('etq-printer-ip');
                    var portEl = document.getElementById('etq-printer-port');
                    if (nameEl) nameEl.value  = data.printer_name || '';
                    if (ipEl)   ipEl.value    = data.printer_ip   || '';
                    if (portEl) portEl.value  = data.printer_port || 9100;
                    toggleEtiquetaGrupos();
                    atualizarPreviewPDF();
                    atualizarPreviewZPL();
                }
            })
            .catch(function (e) { console.error('etiqueta load', e); });
    }

    function salvarEtiqueta() {
        var modo        = document.getElementById('etq-modo').value;
        var zpl         = document.getElementById('etq-zpl').value;
        var pdf         = document.getElementById('etq-pdf').value;
        var nameEl      = document.getElementById('etq-printer-name');
        var ipEl        = document.getElementById('etq-printer-ip');
        var portEl      = document.getElementById('etq-printer-port');
        var printerName = nameEl ? (nameEl.value || '').trim() : '';
        var printerIp   = ipEl   ? (ipEl.value   || '').trim() : '';
        var printerPort = portEl ? (parseInt(portEl.value) || 9100) : 9100;
        var btn         = document.getElementById('btn-salvar-etiqueta');
        var msg         = document.getElementById('etq-msg');
        btn.disabled      = true;
        msg.style.display = 'none';

        fetch(window.P43.CONFIG.apiBase + '/config/etiqueta', {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                modo_impressao: modo, zpl_template: zpl, pdf_template: pdf,
                printer_name: printerName, printer_ip: printerIp, printer_port: printerPort
            })
        })
        .then(function (r) { return r.json(); })
        .then(function (data) {
            btn.disabled      = false;
            msg.style.display = 'block';
            if (data.success) {
                msg.className   = 'etq-msg etq-msg-ok';
                msg.textContent = 'Configuração salva com sucesso!';
            } else {
                msg.className   = 'etq-msg etq-msg-err';
                msg.textContent = data.error || 'Erro ao salvar.';
            }
            setTimeout(function () { msg.style.display = 'none'; }, 3000);
        })
        .catch(function () {
            btn.disabled      = false;
            msg.style.display = 'block';
            msg.className     = 'etq-msg etq-msg-err';
            msg.textContent   = 'Falha na conexão.';
            setTimeout(function () { msg.style.display = 'none'; }, 3000);
        });
    }

    window.P43.PDF_TEMPLATE_PADRAO  = PDF_TEMPLATE_PADRAO;
    window.P43.ZPL_TEMPLATE_PADRAO  = ZPL_TEMPLATE_PADRAO;
    window.P43.toggleEtiquetaGrupos = toggleEtiquetaGrupos;
    window.P43.atualizarPreviewPDF  = atualizarPreviewPDF;
    window.P43.atualizarPreviewZPL  = atualizarPreviewZPL;
    window.P43.carregarEtiqueta     = carregarEtiqueta;
    window.P43.salvarEtiqueta       = salvarEtiqueta;

})();
