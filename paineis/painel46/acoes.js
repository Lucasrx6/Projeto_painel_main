(function () {
    'use strict';

    // ── Atualizar status de um exame/registro de radiologia ───────────────────

    function atualizarStatus(radioId, novoStatus) {
        var E     = window.P46.Estado;
        var toast = window.P46.toast;

        var motivo = '';
        if (novoStatus === 'cancelado') {
            motivo = prompt('Motivo do cancelamento (mínimo 5 caracteres):') || '';
            if (motivo.trim().length < 5) { toast('Informe o motivo do cancelamento.', 'warning'); return; }
            motivo = motivo.trim();
        }

        fetch(window.P46.CONFIG.api.exameStatus.replace('{id}', radioId), {
            method: 'PUT', credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status: novoStatus, motivo: motivo })
        })
        .then(function (r) { return r.json(); })
        .then(function (d) {
            if (d.success) {
                toast('Status atualizado!', 'success');
                window.P46.carregarFila();
                if (E.tabAtiva === 'exames') window.P46.carregarExamesRadio();
            } else {
                toast('Erro: ' + (d.error || 'Falha'), 'error');
            }
        })
        .catch(function (e) { console.error('[P46]', e); toast('Erro de conexão', 'error'); });
    }

    // ── Bloquear / desbloquear / remover vagas ────────────────────────────────

    function bloquearSlot(slotId) {
        var toast = window.P46.toast;
        var obs   = prompt('Motivo do bloqueio (opcional):') || '';
        fetch(window.P46.CONFIG.api.slotUpdate.replace('{id}', slotId), {
            method: 'PUT', credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ acao: 'bloquear', obs_bloqueio: obs })
        })
        .then(function (r) { return r.json(); })
        .then(function (d) {
            if (d.success) { toast('Vaga bloqueada.', 'warning'); window.P46.carregarSlots(); }
            else toast('Erro: ' + (d.error || 'Falha'), 'error');
        })
        .catch(function (e) { console.error('[P46]', e); toast('Erro de conexão', 'error'); });
    }

    function desbloquearSlot(slotId) {
        var toast = window.P46.toast;
        fetch(window.P46.CONFIG.api.slotUpdate.replace('{id}', slotId), {
            method: 'PUT', credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ acao: 'desbloquear' })
        })
        .then(function (r) { return r.json(); })
        .then(function (d) {
            if (d.success) { toast('Vaga desbloqueada.', 'success'); window.P46.carregarSlots(); }
            else toast('Erro: ' + (d.error || 'Falha'), 'error');
        })
        .catch(function (e) { console.error('[P46]', e); toast('Erro de conexão', 'error'); });
    }

    function removerSlot(slotId) {
        var toast = window.P46.toast;
        if (!confirm('Remover esta vaga?')) return;
        fetch(window.P46.CONFIG.api.slotDelete.replace('{id}', slotId), {
            method: 'DELETE', credentials: 'same-origin'
        })
        .then(function (r) { return r.json(); })
        .then(function (d) {
            if (d.success) { toast('Vaga removida.', 'info'); window.P46.carregarSlots(); }
            else toast('Erro: ' + (d.error || 'Falha'), 'error');
        })
        .catch(function (e) { console.error('[P46]', e); toast('Erro de conexão', 'error'); });
    }

    function desagendar(slotId) {
        var toast = window.P46.toast;
        if (!confirm('Desvincular paciente desta vaga?')) return;
        fetch(window.P46.CONFIG.api.slotDesvincular.replace('{id}', slotId), {
            method: 'PUT', credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json' }
        })
        .then(function (r) { return r.json(); })
        .then(function (d) {
            if (d.success) { toast('Paciente desvinculado.', 'success'); window.P46.carregarSlots(); window.P46.carregarFila(); }
            else toast('Erro: ' + (d.error || 'Falha'), 'error');
        })
        .catch(function (e) { console.error('[P46]', e); toast('Erro de conexão', 'error'); });
    }

    // ── Reagendar a partir da fila ────────────────────────────────────────────
    // Localiza o item na fila, monta um objeto de prescrição e abre o modal de agendamento

    function reagendarDaFila(radioId) {
        var E     = window.P46.Estado;
        var toast = window.P46.toast;

        var item = null;
        var lista = E.fila.agendados.concat(E.fila.pendentes);
        for (var i = 0; i < lista.length; i++) {
            if (lista[i].id === radioId) { item = lista[i]; break; }
        }
        if (!item) { toast('Item não encontrado. Atualize a tela.', 'warning'); return; }

        var presc = {
            nr_atendimento:        item.nr_atendimento,
            nr_prescricao:         item.nr_prescricao || '',
            nm_pessoa_fisica:      item.nm_paciente || '',
            ds_procedimento:       item.ds_procedimento || '',
            leito:                 item.leito_origem || '',
            leito_base:            item.leito_origem || '',
            nm_setor:              item.setor_origem_nome || '',
            cd_setor_atendimento:  item.cd_setor_atendimento,
            tipo_exame:            item.tipo_exame || 'OUTROS',
            radio_id:              item.id,
            radio_status:          item.status,
            radio_prioridade:      item.prioridade || 'normal',
            nm_medico_solicitante: item.nm_medico_solicitante || '',
            requer_preparo:        !!item.requer_preparo,
            radio_preparo:         item.tipo_preparo || '',
            concluido_interno:     false
        };

        E.modalAgendPresc  = presc;
        E.modalAgendSlotId = null;

        var escHtml  = window.P46.escHtml;
        var fNome    = window.P46.formatarNome;

        var infoEl = document.getElementById('modal-ag-info');
        if (infoEl) {
            infoEl.innerHTML = '<strong>' + escHtml(fNome(presc.nm_pessoa_fisica)) + '</strong><br>'
                + '<small>' + escHtml(presc.ds_procedimento || '-') + '</small>'
                + (presc.leito ? '<br><small><i class="fas fa-bed"></i> ' + escHtml(presc.leito) + '</small>' : '');
        }

        var tipoEl = document.getElementById('ag-tipo');
        if (tipoEl) tipoEl.value = presc.tipo_exame || 'OUTROS';
        var dataEl = document.getElementById('ag-data');
        if (dataEl) dataEl.value = '';
        var obsEl = document.getElementById('ag-obs');
        if (obsEl) obsEl.value = item.observacao || '';

        // Reset preparo
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

        window.P46.renderizarSlotsDaModal([]);
        window.P46.buscarSlotsPorTipo('auto');
        window.P46.abrirModal('modal-agendar-presc');
    }

    // ── Modal vincular paciente a um slot ─────────────────────────────────────

    function abrirAgendar(slotId) {
        var E       = window.P46.Estado;
        var escHtml = window.P46.escHtml;
        var fNome   = window.P46.formatarNome;
        var fHora   = window.P46.formatarHora;
        var badgeTipo = window.P46.badgeTipoExame;

        var listaEl = document.getElementById('lista-vincular');
        var infoEl  = document.getElementById('modal-vincular-info');
        var modal   = document.getElementById('modal-vincular');

        var slotInfo = null;
        for (var i = 0; i < E.slots.length; i++) {
            if (E.slots[i].id === slotId) { slotInfo = E.slots[i]; break; }
        }
        E._vincularSlotId = slotId;

        var slotModal = slotInfo ? (slotInfo.modalidade || '') : '';

        if (infoEl && slotInfo) {
            infoEl.innerHTML = '<strong>Vaga: ' + fHora(slotInfo.data_hora) + '</strong>'
                + (slotModal ? ' — ' + escHtml(slotModal) : ' — Qualquer tipo')
                + ' · ' + (slotInfo.duracao_min || 30) + 'min'
                + (slotModal ? '<br><small style="color:#6c757d;margin-top:4px;display:block;">Mostrando apenas pacientes compatíveis com a modalidade <strong>' + escHtml(slotModal) + '</strong> (+ tipo "Outros")</small>' : '');
        }

        function preencherListaVincular(exames) {
            var candidatos = [];
            for (var j = 0; j < exames.length; j++) {
                var ex = exames[j];
                var rs = ex.radio_status;
                if (rs && rs !== 'pendente') continue;
                if (ex.concluido_interno) continue;
                if (slotModal) {
                    var exTipo = ex.tipo_exame || '';
                    if (exTipo && exTipo !== 'OUTROS' && exTipo !== slotModal) continue;
                }
                candidatos.push(ex);
            }
            E._vincularCandidatos = candidatos;

            if (!candidatos.length) {
                listaEl.innerHTML = '<div style="text-align:center;padding:20px;color:#6c757d;">Nenhum paciente disponível para agendamento.</div>';
            } else {
                var html = '';
                for (var k = 0; k < candidatos.length; k++) {
                    var p = candidatos[k];
                    html += '<div class="lista-vincular-item" data-cand-idx="' + k + '">'
                          + '<div style="flex:1;min-width:0;">'
                          + '<div class="lv-nome">' + escHtml(fNome(p.nm_pessoa_fisica || p.nm_paciente)) + '</div>'
                          + '<div class="lv-info">' + escHtml(p.ds_procedimento || '')
                          + (p.leito || p.leito_base || p.leito_origem ? ' · ' + escHtml(p.leito || p.leito_base || p.leito_origem || '') : '')
                          + (p.nm_setor ? ' · ' + escHtml(p.nm_setor) : '') + '</div>'
                          + '</div>'
                          + (p.tipo_exame ? badgeTipo(p.tipo_exame) : '')
                          + '<i class="fas fa-chevron-right" style="color:var(--cor-primaria);margin-left:8px;"></i></div>';
                }
                listaEl.innerHTML = html;
                var items = listaEl.querySelectorAll('.lista-vincular-item');
                for (var m = 0; m < items.length; m++) {
                    (function (el) {
                        el.addEventListener('click', function () {
                            var idx  = parseInt(el.getAttribute('data-cand-idx'));
                            var cand = E._vincularCandidatos[idx];
                            if (cand.radio_id) {
                                vincularPaciente(slotId, cand.radio_id);
                            } else {
                                vincularPrescricao(slotId, cand);
                            }
                        });
                    })(items[m]);
                }
            }
            if (modal) modal.style.display = 'flex';
        }

        if (!listaEl) return;
        if (E.exames && E.exames.length) {
            preencherListaVincular(E.exames);
        } else {
            listaEl.innerHTML = '<div style="text-align:center;padding:20px;color:#6c757d;"><i class="fas fa-spinner fa-spin"></i> Carregando...</div>';
            if (modal) modal.style.display = 'flex';
            fetch(window.P46.CONFIG.api.prescricoes, { credentials: 'same-origin' })
                .then(function (r) { return r.json(); })
                .then(function (d) {
                    if (d.success) E.exames = d.data || [];
                    preencherListaVincular(E.exames);
                })
                .catch(function (e) {
                    console.error('[P46]', e);
                    listaEl.innerHTML = '<div style="text-align:center;padding:20px;color:#dc3545;">Erro ao carregar pacientes.</div>';
                });
        }
    }

    // ── Vincular paciente (com radio_id) ou prescrição nova ──────────────────

    function vincularPaciente(slotId, radioId) {
        var toast = window.P46.toast;
        fetch(window.P46.CONFIG.api.agendar.replace('{id}', radioId), {
            method: 'PUT', credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ slot_id: slotId })
        })
        .then(function (r) { return r.json(); })
        .then(function (d) {
            var modal = document.getElementById('modal-vincular');
            if (modal) modal.style.display = 'none';
            if (d.success) { toast('Paciente agendado!', 'success'); window.P46.carregarSlots(); window.P46.carregarFila(); window.P46.carregarExamesRadio(); }
            else toast('Erro: ' + (d.error || 'Falha'), 'error');
        })
        .catch(function (e) { console.error('[P46]', e); toast('Erro de conexão', 'error'); });
    }

    function vincularPrescricao(slotId, ex) {
        var toast = window.P46.toast;
        fetch(window.P46.CONFIG.api.agendarPrescricao, {
            method: 'POST', credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                nr_atendimento:        String(ex.nr_atendimento || ''),
                nr_prescricao:         String(ex.nr_prescricao || ''),
                ds_procedimento:       ex.ds_procedimento || '',
                slot_id:               slotId,
                nm_paciente:           ex.nm_pessoa_fisica || '',
                leito_origem:          ex.leito || ex.leito_base || '',
                setor_origem_nome:     ex.nm_setor || '',
                cd_setor_atendimento:  ex.cd_setor_atendimento || null,
                prioridade:            'normal',
                requer_transporte:     true,
                observacao:            '',
                nm_medico_solicitante: ex.nm_medico_solicitante || ''
            })
        })
        .then(function (r) { return r.json(); })
        .then(function (d) {
            var modal = document.getElementById('modal-vincular');
            if (modal) modal.style.display = 'none';
            if (d.success) { toast('Paciente vinculado!', 'success'); window.P46.carregarSlots(); window.P46.carregarFila(); window.P46.carregarExamesRadio(); }
            else toast('Erro: ' + (d.error || 'Falha'), 'error');
        })
        .catch(function (e) { console.error('[P46]', e); toast('Erro de conexão', 'error'); });
    }

    // ── Carregar todas as abas de uma vez ─────────────────────────────────────

    function carregarTudo() {
        var E = window.P46.Estado;
        window.P46.carregarFila();
        if (E.tabAtiva === 'agenda') window.P46.carregarSlots();
        if (E.tabAtiva === 'exames') window.P46.carregarExamesRadio();
    }

    window.P46.atualizarStatus    = atualizarStatus;
    window.P46.bloquearSlot       = bloquearSlot;
    window.P46.desbloquearSlot    = desbloquearSlot;
    window.P46.removerSlot        = removerSlot;
    window.P46.desagendar         = desagendar;
    window.P46.reagendarDaFila    = reagendarDaFila;
    window.P46.abrirAgendar       = abrirAgendar;
    window.P46.vincularPaciente   = vincularPaciente;
    window.P46.vincularPrescricao = vincularPrescricao;
    window.P46.carregarTudo       = carregarTudo;

})();
