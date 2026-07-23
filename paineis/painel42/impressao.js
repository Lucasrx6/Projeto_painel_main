(function () {
    'use strict';

    function _preencherVarsZPL(template, sol) {
        return template
            .replace(/\{\{NR_ATENDIMENTO\}\}/g, sol.nr_atendimento    || '')
            .replace(/\{\{PACIENTE\}\}/g,       sol.nm_paciente        || '')
            .replace(/\{\{LEITO\}\}/g,          sol.leito              || '')
            .replace(/\{\{SETOR\}\}/g,          sol.setor_nome         || '')
            .replace(/\{\{DIETA\}\}/g,          sol.tipo_dieta_nome    || '')
            .replace(/\{\{REFEICAO\}\}/g,       sol.refeicao_nome      || '')
            .replace(/\{\{RESTRICOES\}\}/g,     sol.restricoes         || '')
            .replace(/\{\{OBS\}\}/g,            sol.observacao         || '')
            .replace(/\{\{CODIGO\}\}/g,         sol.codigo_entrega     || '');
    }

    function _downloadZPL(zpl, nr) {
        var blob = new Blob([zpl], { type: 'text/plain;charset=utf-8' });
        var url  = URL.createObjectURL(blob);
        var a    = document.createElement('a');
        a.href     = url;
        a.download = 'etiqueta_' + (nr || 'dieta') + '.zpl';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    }

    function _imprimirZPL(sol, template, impressoraCfg) {
        if (!template) {
            alert('Configure o template ZPL no Painel 43 → Configurações → Etiqueta.');
            return;
        }
        var cfg = impressoraCfg || {};
        var zpl = _preencherVarsZPL(template, sol);
        fetch('/api/paineis/painel42/imprimir-zpl', {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                zpl:          zpl,
                printer_name: cfg.printer_name || '',
                printer_ip:   cfg.printer_ip   || '',
                printer_port: cfg.printer_port || 9100
            })
        })
        .then(function (r) { return r.json(); })
        .then(function (data) {
            if (!data.success) {
                console.error('Erro impressao ZPL: ' + (data.error || ''));
                _downloadZPL(zpl, sol.nr_atendimento);
            }
        })
        .catch(function (e) {
            console.error('Falha ao comunicar com servidor de impressao', e);
            _downloadZPL(zpl, sol.nr_atendimento);
        });
    }

    function _preencherVarsPDF(template, sol) {
        var agora = new Date();
        var nr    = sol.nr_atendimento || '';
        return template
            .replace(/\{\{NR_ATENDIMENTO\}\}/g, nr)
            .replace(/\{\{PACIENTE\}\}/g,       sol.nm_paciente     || '')
            .replace(/\{\{LEITO\}\}/g,          sol.leito           || '')
            .replace(/\{\{SETOR\}\}/g,          sol.setor_nome      || '')
            .replace(/\{\{DIETA\}\}/g,          sol.tipo_dieta_nome || '')
            .replace(/\{\{REFEICAO\}\}/g,       sol.refeicao_nome   || '')
            .replace(/\{\{RESTRICOES\}\}/g,     sol.restricoes      || '')
            .replace(/\{\{OBS\}\}/g,            sol.observacao      || '')
            .replace(/\{\{CODIGO\}\}/g,         sol.codigo_entrega  || '')
            .replace(/\{\{DATA\}\}/g,           agora.toLocaleDateString('pt-BR'))
            .replace(/\{\{HORA\}\}/g,           agora.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }));
    }

    function _gerarHTMLEtiqueta(sol) {
        var nr    = sol.nr_atendimento  || '';
        var pac   = sol.nm_paciente     || '';
        var leito = sol.leito           || '';
        var setor = sol.setor_nome      || '';
        var dieta = sol.tipo_dieta_nome || '';
        var ref   = sol.refeicao_nome   || '';
        var rest  = sol.restricoes      || '';
        var obs   = sol.observacao      || '';
        var cod   = sol.codigo_entrega  || '';
        var agora = new Date();
        var data  = agora.toLocaleDateString('pt-BR');
        var hora  = agora.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

        return '<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8">' +
            '<title>Etiqueta Dieta</title>' +
            '<script src="https://cdn.jsdelivr.net/npm/jsbarcode@3.11.6/dist/JsBarcode.all.min.js"><\/script>' +
            '<style>' +
                '@page{size:7cm 10cm;margin:3mm}' +
                'body{font-family:Arial,sans-serif;font-size:10px;margin:0;padding:0;}' +
                'svg{max-width:100%;height:45px;display:block;margin:0 auto;}' +
                '@media print{body{print-color-adjust:exact;-webkit-print-color-adjust:exact}}' +
            '</style>' +
            '</head><body>' +
            '<div style="padding: 2mm">' +
                '<div style="font-size: 12px; font-weight: bold; text-align: center; border-bottom: 1px solid #000; padding-bottom: 2mm; margin-bottom: 2mm">Hospital Anchieta Ceilândia</div>' +
                '<div style="font-weight: bold; font-size: 11px; margin-bottom: 2px; word-break: break-word;"><span style="font-weight: normal">Paciente: </span>' + pac + '</div>' +
                '<div style="display: flex; justify-content: space-between; font-size: 8px; color: #555; margin-bottom: 5px;">' +
                    '<span>Cód: ' + cod + '</span>' +
                    '<span>' + data + ' ' + hora + '</span>' +
                '</div>' +
                '<div style="margin-bottom: 5px"><span style="font-weight: bold">Leito:</span> ' + leito + ' &nbsp; <span style="font-weight: bold">Setor:</span> ' + setor + '</div>' +
                '<div style="margin-bottom: 5px"><span style="font-weight: bold">Dieta:</span> ' + dieta + ' &mdash; ' + ref + '</div>' +
                (rest ? '<div style="margin-bottom: 5px"><span style="font-weight: bold">Restrições:</span> ' + rest + '</div>' : '') +
                (obs  ? '<div style="margin-bottom: 5px; min-height: 8mm; line-height: 1.6;"><span style="font-weight: bold">Obs:</span> ' + obs + '</div>' : '') +
                '<div style="text-align: center; margin: 1mm 0"><svg id="bc"></svg></div>' +
                '<div style="text-align: center; font-size: 8px; font-weight: bold; font-family: monospace;">' + nr + '</div>' +
            '</div>' +
            '<script>' +
                'window.onload=function(){' +
                    'if(typeof JsBarcode!=="undefined"){' +
                        'JsBarcode("#bc","' + nr.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '",' +
                        '{format:"CODE128",width:1.8,height:45,displayValue:false,margin:0});' +
                    '}' +
                '};' +
            '<\/script>' +
            '</body></html>';
    }

    function _imprimirPDF(sol, pdfTemplate) {
        var html = pdfTemplate
            ? _preencherVarsPDF(pdfTemplate, sol)
            : _gerarHTMLEtiqueta(sol);
        var w = window.open('', '_blank', 'width=300,height=480,toolbar=0,menubar=0,location=0,scrollbars=0');
        if (!w) { alert('Permita pop-ups para imprimir a etiqueta.'); return; }
        w.document.open();
        w.document.write(html);
        w.document.close();
        w.focus();
        setTimeout(function () { w.print(); }, 700);
    }

    function imprimirEtiqueta(sol) {
        fetch('/api/paineis/painel43/config/etiqueta', { credentials: 'same-origin' })
            .then(function (r) { return r.json(); })
            .then(function (cfg) {
                _imprimirZPL(sol, cfg.zpl_template || '', {
                    printer_name: cfg.printer_name || '',
                    printer_ip:   cfg.printer_ip   || '',
                    printer_port: cfg.printer_port || 9100
                });
            })
            .catch(function () {
                _imprimirZPL(sol, '', {});
            });
    }

    window.P42.imprimirEtiqueta = imprimirEtiqueta;

})();
