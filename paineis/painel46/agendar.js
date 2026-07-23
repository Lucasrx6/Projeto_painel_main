(function () {
    'use strict';

    // ── Abrir modal de agendamento de prescrição ──────────────────────────────

    function abrirAgendarPresc(nrAtendimento, nrPrescricao) {
        var E     = window.P46.Estado;
        var toast = window.P46.toast;

        var presc = null;
        for (var i = 0; i < E.exames.length; i++) {
            var ex = E.exames[i];
            if (String(ex.nr_atendimento) === String(nrAtendimento)
                && String(ex.nr_prescricao || '') === String(nrPrescricao || '')) {
                presc = ex; break;
            }
        }
        if (!presc) { toast('Prescrição não encontrada.', 'error'); return; }
        if (presc.concluido_interno) { toast('Exame já concluído. Aguardando atualização do Tasy.', 'info'); return; }

        E.modalAgendPresc  = presc;
        E.modalAgendSlotId = null;

        var escHtml = window.P46.escHtml;
        var fNome   = window.P46.formatarNome;

        var infoEl = document.getElementById('modal-ag-info');
        if (infoEl) {
            infoEl.innerHTML = '<strong>' + escHtml(fNome(presc.nm_pessoa_fisica)) + '</strong><br>'
                + '<small>' + escHtml(presc.ds_procedimento || '-') + '</small>'
                + (presc.leito || presc.leito_base
                    ? '<br><small><i class="fas fa-bed"></i> ' + escHtml(presc.leito || presc.leito_base || '') + '</small>'
                    : '');
        }

        var tipoEl = document.getElementById('ag-tipo');
        if (tipoEl) tipoEl.value = presc.tipo_exame || 'OUTROS';
        var dataEl = document.getElementById('ag-data');
        if (dataEl) dataEl.value = '';
        var obsEl = document.getElementById('ag-obs');
        if (obsEl) obsEl.value = '';

        // Reset do toggle de preparo
        var btnPreparoNaoEl = document.getElementById('btn-preparo-nao');
        var btnPreparoSimEl = document.getElementById('btn-preparo-sim');
        var preparoGrupoEl  = document.getElementById('ag-preparo-grupo');
        var preparoTextoEl  = document.getElementById('ag-preparo-texto');
        var preparoHintEl   = document.getElementById('ag-preparo-hint');
        if (btnPreparoNaoEl) btnPreparoNaoEl.className = 'btn-preparo btn-preparo-nao ativo';
        if (btnPreparoSimEl) btnPreparoSimEl.className = 'btn-preparo btn-preparo-sim';
        if (preparoGrupoEl)  preparoGrupoEl.style.display = 'none';
        if (preparoTextoEl)  preparoTextoEl.value = '';
        if (preparoHintEl)   preparoHintEl.textContent = '0 / 15 mínimo';

        var priEl = document.getElementById('ag-prioridade');
        if (priEl) priEl.value = presc.radio_prioridade || 'normal';
        var btnOk = document.getElementById('modal-ag-confirmar');
        if (btnOk) btnOk.disabled = true;

        renderizarSlotsDaModal([]);
        buscarSlotsPorTipo('auto');
        window.P46.abrirModal('modal-agendar-presc');
    }

    // ── Buscar slots compatíveis com o tipo de exame ──────────────────────────
    // modo='auto': backend encontra o próximo dia com vagas
    // modo='YYYY-MM-DD': busca nessa data específica
    // modo=undefined: lê do campo ag-data (digitação manual)

    function buscarSlotsPorTipo(modo) {
        var E    = window.P46.Estado;
        var presc = E.modalAgendPresc;
        if (!presc) return;

        var tipo   = presc.tipo_exame || '';
        var dataEl = document.getElementById('ag-data');
        var loadEl = document.getElementById('ag-slots-loading');
        var btnOk  = document.getElementById('modal-ag-confirmar');

        var url;
        if (modo === 'auto') {
            url = window.P46.CONFIG.api.slotsPorTipo + '?tipo=' + encodeURIComponent(tipo) + '&primeira_data=true';
        } else if (modo && modo !== 'auto') {
            url = window.P46.CONFIG.api.slotsPorTipo + '?tipo=' + encodeURIComponent(tipo) + '&data=' + encodeURIComponent(modo);
        } else {
            var digitado = dataEl ? window.P46.displayParaISO(dataEl.value) : '';
            if (!digitado) return;
            url = window.P46.CONFIG.api.slotsPorTipo + '?tipo=' + encodeURIComponent(tipo) + '&data=' + encodeURIComponent(digitado);
        }

        if (loadEl) loadEl.style.display = '';
        E.modalAgendSlotId = null;
        if (btnOk) btnOk.disabled = true;

        fetch(url, { credentials: 'same-origin' })
            .then(function (r) { return r.json(); })
            .then(function (d) {
                var slots         = (d.success && d.data) ? d.data : [];
                var dataEncontrada = d.data_consulta || '';
                if (dataEl && slots.length && dataEncontrada)
                    dataEl.value = window.P46.isoParaDisplay(dataEncontrada);
                E.slotsDisponiveis = slots;
                renderizarSlotsDaModal(slots, dataEncontrada);
                if (loadEl) loadEl.style.display = 'none';
            })
            .catch(function (e) {
                console.error('[P46] slots-por-tipo:', e);
                E.slotsDisponiveis = [];
                renderizarSlotsDaModal([], '');
                if (loadEl) loadEl.style.display = 'none';
            });
    }

    // ── Renderizar lista de slots no modal ────────────────────────────────────

    function renderizarSlotsDaModal(slots, dataISO) {
        var E       = window.P46.Estado;
        var escHtml = window.P46.escHtml;
        var fHora   = window.P46.formatarHora;

        var listaEl = document.getElementById('ag-lista-slots');
        if (!listaEl) return;
        if (!slots.length) {
            var presc   = E.modalAgendPresc;
            var tipoMsg = presc && presc.tipo_exame ? ' para ' + escHtml(presc.tipo_exame) : '';
            var dataMsg = dataISO ? ' a partir de ' + window.P46.isoParaDisplay((dataISO.split('T')[0]) || dataISO) : '';
            listaEl.innerHTML = '<div style="text-align:center;padding:20px;color:#6c757d;font-size:13px;grid-column:1/-1;width:100%;">'
                + '<i class="fas fa-calendar-times"></i> Nenhuma vaga disponível' + tipoMsg + dataMsg + '.'
                + '<br><small style="margin-top:6px;display:block;">Crie vagas na aba <strong>Agenda</strong>'
                + (presc && presc.tipo_exame && presc.tipo_exame !== 'OUTROS' ? ' com modalidade <strong>' + escHtml(presc.tipo_exame) + '</strong>' : '')
                + ' e volte aqui.</small></div>';
            return;
        }
        var html = '';
        for (var i = 0; i < slots.length; i++) {
            var s = slots[i];
            html += '<div class="slot-opcao" data-slot-id="' + s.id + '" onclick="P46.selecionarSlot(' + s.id + ')">'
                  + '<span class="slot-opcao-hora">' + fHora(s.data_hora) + '</span>'
                  + '<span class="slot-opcao-dur">' + (s.duracao_min || 30) + ' min</span>'
                  + (s.modalidade ? '<span class="slot-opcao-modal">' + escHtml(s.modalidade) + '</span>' : '')
                  + '</div>';
        }
        listaEl.innerHTML = html;
    }

    // ── Selecionar slot no modal ──────────────────────────────────────────────

    function selecionarSlot(slotId) {
        var E = window.P46.Estado;
        E.modalAgendSlotId = slotId;
        var items = document.querySelectorAll('.slot-opcao');
        for (var i = 0; i < items.length; i++) {
            var sid = parseInt(items[i].getAttribute('data-slot-id'));
            items[i].className = sid === slotId ? 'slot-opcao slot-opcao-ativo' : 'slot-opcao';
        }
        var btnOk = document.getElementById('modal-ag-confirmar');
        if (btnOk) btnOk.disabled = false;
    }

    // ── Confirmar agendamento ─────────────────────────────────────────────────

    function confirmarAgendamento() {
        var E     = window.P46.Estado;
        var toast = window.P46.toast;

        var presc  = E.modalAgendPresc;
        var slotId = E.modalAgendSlotId;
        if (!presc || !slotId) { toast('Selecione um horário.', 'warning'); return; }

        var priEl           = document.getElementById('ag-prioridade');
        var obsEl           = document.getElementById('ag-obs');
        var btnOk           = document.getElementById('modal-ag-confirmar');
        var btnPreparoSimEl = document.getElementById('btn-preparo-sim');
        var preparoTextoEl  = document.getElementById('ag-preparo-texto');
        var requerPreparo   = !!(btnPreparoSimEl && btnPreparoSimEl.className.indexOf('ativo') >= 0);
        var tipoPreparo     = preparoTextoEl ? preparoTextoEl.value.trim() : '';

        if (requerPreparo && tipoPreparo.length < 15) {
            toast('Descreva o preparo com ao menos 15 caracteres.', 'warning'); return;
        }
        if (btnOk) btnOk.disabled = true;

        // Captura info do slot para oferecer agendamento de irmãos depois
        var slotInfoParaIrmaos = null;
        for (var si = 0; si < E.slotsDisponiveis.length; si++) {
            if (E.slotsDisponiveis[si].id === slotId) { slotInfoParaIrmaos = E.slotsDisponiveis[si]; break; }
        }

        fetch(window.P46.CONFIG.api.agendarPrescricao, {
            method: 'POST', credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                nr_atendimento:        String(presc.nr_atendimento || ''),
                nr_prescricao:         String(presc.nr_prescricao || ''),
                ds_procedimento:       presc.ds_procedimento || '',
                slot_id:               slotId,
                nm_paciente:           presc.nm_pessoa_fisica || '',
                leito_origem:          presc.leito || presc.leito_base || '',
                setor_origem_nome:     presc.nm_setor || '',
                cd_setor_atendimento:  presc.cd_setor_atendimento || null,
                prioridade:            priEl ? priEl.value : 'normal',
                requer_transporte:     true,
                observacao:            obsEl ? obsEl.value.trim() : '',
                nm_medico_solicitante: presc.nm_medico_solicitante || '',
                requer_preparo:        requerPreparo,
                tipo_preparo:          requerPreparo ? tipoPreparo : ''
            })
        })
        .then(function (r) { return r.json(); })
        .then(function (d) {
            if (d.success) {
                window.P46.fecharModal('modal-agendar-presc');
                toast('Exame agendado com sucesso!', 'success');
                window.P46.carregarExamesRadio();
                window.P46.carregarFila();
                _verificarIrmaos(presc, slotInfoParaIrmaos);
            } else {
                toast('Erro: ' + (d.error || 'Falha ao agendar'), 'error');
            }
            if (btnOk) btnOk.disabled = false;
        })
        .catch(function (e) {
            console.error('[P46]', e);
            toast('Erro de conexão', 'error');
            if (btnOk) btnOk.disabled = false;
        });
    }

    // ── Modal de irmãos — oferecer agendamento de outros exames do mesmo paciente

    function _verificarIrmaos(prescPrincipal, slotInfo) {
        var E    = window.P46.Estado;
        var nr   = String(prescPrincipal.nr_atendimento || '');
        var nrPr = String(prescPrincipal.nr_prescricao  || '');
        var dsPr = prescPrincipal.ds_procedimento || '';
        var irmaos = [];

        for (var i = 0; i < E.exames.length; i++) {
            var ex = E.exames[i];
            if (String(ex.nr_atendimento) !== nr) continue;
            if (String(ex.nr_prescricao) === nrPr && ex.ds_procedimento === dsPr) continue;
            if (ex.radio_id && ex.radio_status !== 'pendente') continue;
            if (ex.concluido_interno) continue;
            var stEx = (ex.status_radiologia || '').toUpperCase();
            if (stEx && stEx !== 'AGUARDANDO') continue;
            irmaos.push(ex);
        }

        if (!irmaos.length) return;
        E.irmaosPresc    = prescPrincipal;
        E.irmaosSlotInfo = slotInfo;
        abrirModalIrmaos(prescPrincipal, irmaos, slotInfo);
    }

    function abrirModalIrmaos(presc, irmaos, slotInfo) {
        var escHtml  = window.P46.escHtml;
        var fNome    = window.P46.formatarNome;
        var fHora    = window.P46.formatarHora;
        var badgeTipo = window.P46.badgeTipoExame;

        var infoEl  = document.getElementById('irmaos-info');
        var listaEl = document.getElementById('irmaos-lista');
        if (!infoEl || !listaEl) return;

        var hora = slotInfo ? fHora(slotInfo.data_hora) : '—';
        infoEl.innerHTML = '<strong>' + escHtml(fNome(presc.nm_pessoa_fisica)) + '</strong>'
            + ' tem mais ' + irmaos.length + ' exame(s) pendente(s).'
            + '<br><small>Deseja agendá-los também para as <strong>' + hora + '</strong>?</small>';

        var html = '';
        for (var i = 0; i < irmaos.length; i++) {
            var ex = irmaos[i];
            html += '<label class="irmao-item irmao-item-checked">'
                + '<input type="checkbox" class="irmao-chk" value="' + i + '" checked>'
                + '<span class="irmao-proc">' + escHtml(ex.ds_procedimento || '-') + '</span>'
                + (ex.tipo_exame ? badgeTipo(ex.tipo_exame) : '')
                + '</label>';
        }
        listaEl.innerHTML = html;
        listaEl._irmaos   = irmaos;

        var chks = listaEl.querySelectorAll('.irmao-chk');
        for (var ci = 0; ci < chks.length; ci++) {
            (function (chk) {
                chk.addEventListener('change', function () {
                    var lbl = chk.parentNode;
                    lbl.className = chk.checked ? 'irmao-item irmao-item-checked' : 'irmao-item';
                });
            })(chks[ci]);
        }

        window.P46.abrirModal('modal-irmaos');
    }

    // ── Confirmar agendamento em lote dos irmãos ──────────────────────────────

    function confirmarIrmaos() {
        var E     = window.P46.Estado;
        var toast = window.P46.toast;

        var listaEl  = document.getElementById('irmaos-lista');
        var slotInfo = E.irmaosSlotInfo;
        if (!listaEl || !slotInfo) { window.P46.fecharModal('modal-irmaos'); return; }

        var chks = listaEl.querySelectorAll('.irmao-chk:checked');
        if (!chks.length) { window.P46.fecharModal('modal-irmaos'); return; }

        var irmaos       = listaEl._irmaos || [];
        var selecionados = [];
        for (var i = 0; i < chks.length; i++) {
            var idx = parseInt(chks[i].value);
            if (irmaos[idx]) selecionados.push(irmaos[idx]);
        }
        if (!selecionados.length) { window.P46.fecharModal('modal-irmaos'); return; }

        var btnOk = document.getElementById('modal-irmaos-confirmar');
        if (btnOk) btnOk.disabled = true;

        var examesPayload = [];
        for (var j = 0; j < selecionados.length; j++) {
            var ex = selecionados[j];
            examesPayload.push({
                nr_atendimento:        String(ex.nr_atendimento || ''),
                nr_prescricao:         String(ex.nr_prescricao || ''),
                ds_procedimento:       ex.ds_procedimento || '',
                nm_paciente:           ex.nm_pessoa_fisica || '',
                leito_origem:          ex.leito || ex.leito_base || '',
                setor_origem_nome:     ex.nm_setor || '',
                cd_setor_atendimento:  ex.cd_setor_atendimento || null,
                nm_medico_solicitante: ex.nm_medico_solicitante || '',
                prioridade:            ex.radio_prioridade || (ex.ie_urgente === 'S' ? 'urgente' : 'normal'),
                requer_transporte:     true
            });
        }

        fetch(window.P46.CONFIG.api.agendarLote, {
            method: 'POST', credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                exames:           examesPayload,
                slot_data_hora:   slotInfo.data_hora,
                slot_duracao_min: slotInfo.duracao_min || 30,
                slot_modalidade:  slotInfo.modalidade || null
            })
        })
        .then(function (r) { return r.json(); })
        .then(function (d) {
            window.P46.fecharModal('modal-irmaos');
            if (d.success) {
                var n = d.agendados || selecionados.length;
                toast(n + ' exame(s) adicional(is) agendado(s)!', 'success');
            } else {
                toast('Falha ao agendar exames adicionais.', 'error');
            }
            window.P46.carregarExamesRadio();
            window.P46.carregarFila();
            if (btnOk) btnOk.disabled = false;
        })
        .catch(function (e) {
            console.error('[P46] agendar-lote:', e);
            toast('Erro de conexão ao agendar exames adicionais.', 'error');
            window.P46.fecharModal('modal-irmaos');
            if (btnOk) btnOk.disabled = false;
        });
    }

    // ── Abrir modal de vaga avulsa a partir do modal de agendamento ───────────

    function abrirAvulsoParaAgendamento() {
        var E    = window.P46.Estado;
        var presc = E.modalAgendPresc;
        E.avulsoParaPresc = true;

        var dataAtual = document.getElementById('ag-data');
        var dataEl    = document.getElementById('avulso-data');
        if (dataEl) dataEl.value = (dataAtual && dataAtual.value) ? dataAtual.value : window.P46.isoParaDisplay(window.P46.hojeISO());

        var horaEl = document.getElementById('avulso-hora');
        if (horaEl) horaEl.value = '';

        var modalEl = document.getElementById('avulso-modalidade');
        if (modalEl && presc) {
            var tipoParaModal = (presc.tipo_exame && presc.tipo_exame !== 'OUTROS') ? presc.tipo_exame : '';
            modalEl.value = tipoParaModal;
        }

        window.P46.abrirModal('modal-avulso');
    }

    window.P46.abrirAgendarPresc       = abrirAgendarPresc;
    window.P46.buscarSlotsPorTipo      = buscarSlotsPorTipo;
    window.P46.renderizarSlotsDaModal  = renderizarSlotsDaModal;
    window.P46.selecionarSlot          = selecionarSlot;
    window.P46.confirmarAgendamento    = confirmarAgendamento;
    window.P46.abrirModalIrmaos        = abrirModalIrmaos;
    window.P46.confirmarIrmaos         = confirmarIrmaos;
    window.P46.abrirAvulsoParaAgendamento = abrirAvulsoParaAgendamento;

})();
