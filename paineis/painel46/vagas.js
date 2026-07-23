(function () {
    'use strict';

    // ── Criar lote de vagas ───────────────────────────────────────────────────

    function criarLote() {
        var E     = window.P46.Estado;
        var toast = window.P46.toast;

        var dataDisp   = document.getElementById('lote-data')   ? document.getElementById('lote-data').value   : '';
        var data       = window.P46.displayParaISO(dataDisp);
        var inicio     = document.getElementById('lote-inicio') ? document.getElementById('lote-inicio').value : '';
        var fim        = document.getElementById('lote-fim')    ? document.getElementById('lote-fim').value    : '';
        var duracao    = document.getElementById('lote-duracao')    ? document.getElementById('lote-duracao').value    : '30';
        var modalidade = document.getElementById('lote-modalidade') ? document.getElementById('lote-modalidade').value : '';

        if (!data || !inicio || !fim) { toast('Preencha data (DD/MM/AAAA), início e fim.', 'warning'); return; }

        fetch(window.P46.CONFIG.api.slotsLote, {
            method: 'POST', credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                data:        data,
                hora_inicio: inicio,
                hora_fim:    fim,
                duracao_min: parseInt(duracao) || 30,
                modalidade:  modalidade || null
            })
        })
        .then(function (r) { return r.json(); })
        .then(function (d) {
            window.P46.fecharModal('modal-lote');
            if (d.success) {
                var criados   = d.criados   || 0;
                var ignorados = d.ignorados || 0;
                if (criados > 0) {
                    toast(criados + ' vagas criadas!' + (ignorados ? ' (' + ignorados + ' ignoradas — horário passado)' : ''), 'success');
                } else {
                    toast('Nenhuma vaga criada' + (ignorados ? ' — todos os horários já passaram.' : '.'), 'warning');
                    return;
                }
                E.dataConsulta = data;
                if (window.P46.DOM.labelData) window.P46.DOM.labelData.textContent = window.P46.labelData(data);
                window.P46.mudarTab('agenda');
                window.P46.carregarSlots();
            } else {
                toast('Erro: ' + (d.error || 'Falha'), 'error');
            }
        })
        .catch(function (e) { console.error('[P46]', e); toast('Erro de conexão', 'error'); });
    }

    // ── Criar vaga avulsa ─────────────────────────────────────────────────────

    function criarAvulso() {
        var E     = window.P46.Estado;
        var toast = window.P46.toast;

        var data       = window.P46.displayParaISO(document.getElementById('avulso-data')       ? document.getElementById('avulso-data').value       : '');
        var hora       = document.getElementById('avulso-hora')       ? document.getElementById('avulso-hora').value       : '';
        var duracao    = document.getElementById('avulso-duracao')    ? document.getElementById('avulso-duracao').value    : '30';
        var modalidade = document.getElementById('avulso-modalidade') ? document.getElementById('avulso-modalidade').value : '';

        if (!data || !hora) { toast('Preencha data (DD/MM/AAAA) e horário.', 'warning'); return; }

        var veioDaPresc = E.avulsoParaPresc;

        fetch(window.P46.CONFIG.api.slots, {
            method: 'POST', credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                data_hora:   data + 'T' + hora + ':00',
                duracao_min: parseInt(duracao) || 30,
                modalidade:  modalidade || null
            })
        })
        .then(function (r) { return r.json(); })
        .then(function (d) {
            E.avulsoParaPresc = false;
            window.P46.fecharModal('modal-avulso');
            if (d.success) {
                toast('Vaga criada!', 'success');
                if (veioDaPresc) {
                    // Recarrega os slots no modal de agendamento com a data recém-criada
                    window.P46.buscarSlotsPorTipo(data);
                } else {
                    window.P46.carregarSlots();
                }
            } else {
                toast('Erro: ' + (d.error || 'Falha'), 'error');
            }
        })
        .catch(function (e) { console.error('[P46]', e); toast('Erro de conexão', 'error'); });
    }

    window.P46.criarLote   = criarLote;
    window.P46.criarAvulso = criarAvulso;

})();
