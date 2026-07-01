/* PAINEL 46 - Radiologia (Tela Operacional) — ES5 */
(function() {
    'use strict';

    var CONFIG = {
        api: {
            fila:       '/api/paineis/painel46/fila',
            slots:      '/api/paineis/painel46/slots',
            slotsLote:  '/api/paineis/painel46/slots/lote',
            exameStatus:'/api/paineis/painel46/exames/{id}/status',
            agendar:    '/api/paineis/painel46/exames/{id}/agendar',
            slotUpdate: '/api/paineis/painel46/slots/{id}',
            slotDelete: '/api/paineis/painel46/slots/{id}'
        },
        intervalo: 45000
    };

    var Estado = {
        tabAtiva: 'fila',
        dataConsulta: new Date().toISOString().slice(0, 10),
        fila: { agendados: [], pendentes: [] },
        slots: [],
        carregandoFila: false
    };

    var DOM = {};

    // ── Toast ──────────────────────────────────────
    function toast(msg, tipo) {
        var c = document.getElementById('toast-container');
        if (!c) return;
        var el = document.createElement('div');
        el.className = 'toast toast-' + (tipo || 'info');
        el.textContent = msg;
        c.appendChild(el);
        setTimeout(function() { if (el.parentNode) el.parentNode.removeChild(el); }, 3500);
    }

    // ── Utilitários ────────────────────────────────
    function escHtml(t) {
        if (!t) return '';
        var d = document.createElement('div'); d.textContent = t; return d.innerHTML;
    }

    function formatarNome(nome) {
        if (!nome || !nome.trim()) return '-';
        var p = nome.trim().toUpperCase().split(/\s+/);
        if (p.length === 1) return p[0];
        var ini = [];
        for (var i = 0; i < p.length - 1; i++) ini.push(p[i].charAt(0) + '.');
        return ini.join(' ') + ' ' + p[p.length - 1];
    }

    function formatarHora(iso) {
        if (!iso) return '-';
        try { var d = new Date(iso); return d.toLocaleTimeString('pt-BR', {hour:'2-digit', minute:'2-digit'}); }
        catch(e) { return iso; }
    }

    function labelData(iso) {
        try {
            var hoje = new Date().toISOString().slice(0, 10);
            var amanha = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
            if (iso === hoje) return 'Hoje';
            if (iso === amanha) return 'Amanhã';
            var p = iso.split('-');
            return p[2] + '/' + p[1];
        } catch(e) { return iso; }
    }

    function setStatusDot(offline) {
        var el = document.getElementById('status-dot');
        if (!el) return;
        el.className = offline ? 'status-dot offline' : 'status-dot';
    }

    // ── Tabs ───────────────────────────────────────
    function mudarTab(tab) {
        Estado.tabAtiva = tab;

        var abas = document.querySelectorAll('.aba');
        for (var i = 0; i < abas.length; i++) {
            var a = abas[i];
            a.className = a.getAttribute('data-aba') === tab ? 'aba aba-ativa' : 'aba';
        }

        var fila = document.getElementById('aba-fila');
        var agenda = document.getElementById('aba-agenda');
        if (fila)   fila.style.display   = tab === 'fila'   ? '' : 'none';
        if (agenda) agenda.style.display = tab === 'agenda' ? '' : 'none';

        var navData     = document.getElementById('nav-data');
        var agendaAcoes = document.getElementById('agenda-acoes');
        if (navData)     navData.style.display     = tab === 'agenda' ? 'flex' : 'none';
        if (agendaAcoes) agendaAcoes.style.display = tab === 'agenda' ? 'flex' : 'none';

        if (DOM.labelData) DOM.labelData.textContent = labelData(Estado.dataConsulta);

        if (tab === 'agenda') carregarSlots();
    }

    // ── Renderizar Fila ────────────────────────────
    function badgeStatus(status) {
        var mapa = {
            'pendente':   ['badge-pendente',   'fa-hourglass',      'Pendente'],
            'agendado':   ['badge-agendado',   'fa-calendar-check', 'Agendado'],
            'no_local':   ['badge-no_local',   'fa-map-marker-alt', 'No Local'],
            'executando': ['badge-executando', 'fa-spinner',        'Executando'],
            'concluido':  ['badge-concluido',  'fa-check-double',   'Concluído'],
            'cancelado':  ['badge-cancelado',  'fa-ban',            'Cancelado']
        };
        var m = mapa[status] || ['badge-pendente', 'fa-circle', status || '?'];
        return '<span class="badge-status ' + m[0] + '"><i class="fas ' + m[1] + '"></i> ' + m[2] + '</span>';
    }

    function badgeTransporte(item) {
        if (!item.chamado_id) return '';
        var s = item.chamado_status || '';
        if (s === 'aguardando' || s === 'aceito')
            return '<span class="badge-transp transp-aguardando"><i class="fas fa-clock"></i> Padioleiro a caminho</span>';
        if (s === 'em_transporte')
            return '<span class="badge-transp transp-em-transporte"><i class="fas fa-running"></i> Em transporte</span>';
        if (s === 'concluido')
            return '<span class="badge-transp transp-concluido"><i class="fas fa-flag-checkered"></i> Chegou</span>';
        return '';
    }

    function cardPacienteHtml(item) {
        var statusCls = '';
        if (item.prioridade === 'urgente') statusCls = ' card-urgente';
        else if (item.status === 'agendado')   statusCls = ' card-agendado';
        else if (item.status === 'no_local')   statusCls = ' card-no_local';
        else if (item.status === 'executando') statusCls = ' card-executando';
        else if (item.status === 'concluido')  statusCls = ' card-concluido';

        var html = '<div class="card-paciente' + statusCls + '">';

        // Header
        html += '<div class="card-header-p">'
              + '<div><div class="card-nome">' + escHtml(formatarNome(item.nm_paciente)) + '</div>'
              + '<div class="card-atnd"><i class="fas fa-hashtag" style="font-size:9px"></i> ' + escHtml(item.nr_atendimento || '') + '</div></div>';
        if (item.prioridade === 'urgente')
            html += '<div class="card-badge-prio"><span class="badge-urgente"><i class="fas fa-exclamation"></i> Urgente</span></div>';
        html += '</div>';

        // Body
        html += '<div class="card-body-p">'
              + '<div class="card-exame"><i class="fas fa-x-ray"></i> ' + escHtml(item.ds_procedimento || '-') + '</div>';
        if (item.leito_origem)
            html += '<div class="card-linha"><i class="fas fa-bed"></i><span>' + escHtml(item.leito_origem) + '</span></div>';
        if (item.setor_origem_nome)
            html += '<div class="card-linha"><i class="fas fa-hospital-alt"></i><span>' + escHtml(item.setor_origem_nome) + '</span></div>';
        if (item.slot_data_hora)
            html += '<div class="card-linha"><i class="fas fa-clock"></i><span><strong>' + formatarHora(item.slot_data_hora) + '</strong>'
                  + (item.slot_modalidade ? ' — ' + escHtml(item.slot_modalidade) : '') + '</span></div>';
        html += '<div class="card-status-row">' + badgeStatus(item.status) + badgeTransporte(item) + '</div>';
        html += '</div>';

        // Footer com botões
        html += '<div class="card-footer-p">';
        if (item.status === 'pendente' || item.status === 'agendado') {
            html += '<button class="btn-card-acao btn-no-local" onclick="P46.atualizarStatus(' + item.id + ',\'no_local\')">'
                  + '<i class="fas fa-map-marker-alt"></i> Chegou</button>';
        }
        if (item.status === 'no_local') {
            html += '<button class="btn-card-acao btn-executando" onclick="P46.atualizarStatus(' + item.id + ',\'executando\')">'
                  + '<i class="fas fa-play"></i> Iniciar</button>';
        }
        if (item.status === 'executando') {
            html += '<button class="btn-card-acao btn-concluir" onclick="P46.atualizarStatus(' + item.id + ',\'concluido\')">'
                  + '<i class="fas fa-check"></i> Concluído</button>';
        }
        if (item.status !== 'concluido' && item.status !== 'cancelado') {
            html += '<button class="btn-card-acao btn-cancelar-card" onclick="P46.atualizarStatus(' + item.id + ',\'cancelado\')">'
                  + '<i class="fas fa-times"></i> Cancelar</button>';
        }
        html += '</div></div>';
        return html;
    }

    function renderizarFila() {
        var agendados = Estado.fila.agendados;
        var pendentes = Estado.fila.pendentes;

        var loading = document.getElementById('fila-loading');
        var vazio   = document.getElementById('fila-vazia');
        var secAg   = document.getElementById('secao-agendados');
        var secPend = document.getElementById('secao-pendentes');
        var gridAg  = document.getElementById('grid-agendados');
        var gridPend= document.getElementById('grid-pendentes');
        var cntAg   = document.getElementById('count-agendados');
        var cntPend = document.getElementById('count-pendentes');

        if (loading) loading.style.display = 'none';

        if (!agendados.length && !pendentes.length) {
            if (vazio) vazio.style.display = '';
            if (secAg) secAg.style.display = 'none';
            if (secPend) secPend.style.display = 'none';
            return;
        }

        if (vazio) vazio.style.display = 'none';

        if (agendados.length) {
            if (cntAg) cntAg.textContent = agendados.length;
            var htmlAg = '';
            for (var i = 0; i < agendados.length; i++) htmlAg += cardPacienteHtml(agendados[i]);
            if (gridAg) gridAg.innerHTML = htmlAg;
            if (secAg) secAg.style.display = '';
        } else {
            if (secAg) secAg.style.display = 'none';
        }

        if (pendentes.length) {
            if (cntPend) cntPend.textContent = pendentes.length;
            var htmlPend = '';
            for (var j = 0; j < pendentes.length; j++) htmlPend += cardPacienteHtml(pendentes[j]);
            if (gridPend) gridPend.innerHTML = htmlPend;
            if (secPend) secPend.style.display = '';
        } else {
            if (secPend) secPend.style.display = 'none';
        }
    }

    // ── Renderizar Agenda ──────────────────────────
    function slotCardHtml(slot) {
        var cssClass = 'slot-card slot-' + (slot.status || 'livre');
        var html = '<div class="' + cssClass + '">';
        html += '<div class="slot-hora">' + formatarHora(slot.data_hora) + '</div>';
        html += '<div class="slot-duracao">' + (slot.duracao_min || 30) + ' min</div>';
        if (slot.modalidade)
            html += '<span class="slot-modal-badge">' + escHtml(slot.modalidade) + '</span>';

        if (slot.status === 'ocupado' && slot.nm_paciente) {
            html += '<div class="slot-paciente"><i class="fas fa-user"></i> ' + escHtml(formatarNome(slot.nm_paciente)) + '</div>';
            if (slot.ds_procedimento)
                html += '<div class="slot-exame-s">' + escHtml(slot.ds_procedimento) + '</div>';
        }
        if (slot.status === 'bloqueado' && slot.obs_bloqueio)
            html += '<div class="slot-bloqueio-obs"><i class="fas fa-lock"></i> ' + escHtml(slot.obs_bloqueio) + '</div>';

        html += '<div class="slot-acoes">';
        if (slot.status === 'livre') {
            html += '<button class="btn-slot btn-slot-vincular" onclick="P46.abrirAgendar(' + slot.id + ')">'
                  + '<i class="fas fa-user-plus"></i> Vincular</button>';
            html += '<button class="btn-slot btn-slot-bloquear" onclick="P46.bloquearSlot(' + slot.id + ')">'
                  + '<i class="fas fa-lock"></i></button>';
            html += '<button class="btn-slot btn-slot-remover" onclick="P46.removerSlot(' + slot.id + ')">'
                  + '<i class="fas fa-trash"></i></button>';
        }
        if (slot.status === 'ocupado') {
            html += '<button class="btn-slot btn-slot-desvincular" onclick="P46.desagendar(' + slot.id + ',' + (slot.radio_id || 0) + ')">'
                  + '<i class="fas fa-user-times"></i> Desvincular</button>';
        }
        if (slot.status === 'bloqueado') {
            html += '<button class="btn-slot btn-slot-desbloquear" onclick="P46.desbloquearSlot(' + slot.id + ')">'
                  + '<i class="fas fa-lock-open"></i> Desbloquear</button>';
            html += '<button class="btn-slot btn-slot-remover" onclick="P46.removerSlot(' + slot.id + ')">'
                  + '<i class="fas fa-trash"></i></button>';
        }
        html += '</div></div>';
        return html;
    }

    function atualizarInfoSlots() {
        var livres = 0, ocupados = 0, bloqueados = 0;
        for (var i = 0; i < Estado.slots.length; i++) {
            var s = Estado.slots[i].status;
            if (s === 'livre') livres++;
            else if (s === 'ocupado') ocupados++;
            else bloqueados++;
        }
        var el = document.getElementById('slots-info-bar');
        if (el) el.textContent = livres + ' livres · ' + ocupados + ' ocupados · ' + bloqueados + ' bloqueados';
    }

    function renderizarAgenda() {
        var loading = document.getElementById('agenda-loading');
        var vazio   = document.getElementById('agenda-vazia');
        var grade   = document.getElementById('grade-slots');

        if (loading) loading.style.display = 'none';

        if (!Estado.slots.length) {
            if (vazio) vazio.style.display = '';
            if (grade) grade.style.display = 'none';
            atualizarInfoSlots();
            return;
        }

        if (vazio) vazio.style.display = 'none';
        var html = '';
        for (var i = 0; i < Estado.slots.length; i++) html += slotCardHtml(Estado.slots[i]);
        if (grade) { grade.innerHTML = html; grade.style.display = ''; }
        atualizarInfoSlots();
    }

    // ── Carregar ───────────────────────────────────
    function carregarFila() {
        if (Estado.carregandoFila) return;
        Estado.carregandoFila = true;

        fetch(CONFIG.api.fila + '?data=' + Estado.dataConsulta, {credentials: 'same-origin'})
            .then(function(r) { return r.json(); })
            .then(function(d) {
                if (d.success) {
                    Estado.fila.agendados = d.agendados || [];
                    Estado.fila.pendentes = d.pendentes || [];
                }
                renderizarFila();
                setStatusDot(false);
                var el = document.getElementById('ultima-atualizacao');
                if (el) el.textContent = new Date().toLocaleTimeString('pt-BR', {hour:'2-digit', minute:'2-digit'});
            })
            .catch(function(e) { console.error('[P46]', e); setStatusDot(true); })
            .finally(function() { Estado.carregandoFila = false; });
    }

    function carregarSlots() {
        var loading = document.getElementById('agenda-loading');
        var grade   = document.getElementById('grade-slots');
        if (loading) loading.style.display = '';
        if (grade)   grade.style.display = 'none';

        fetch(CONFIG.api.slots + '?data=' + Estado.dataConsulta, {credentials: 'same-origin'})
            .then(function(r) { return r.json(); })
            .then(function(d) {
                if (d.success) Estado.slots = d.data || d.dados || [];
                renderizarAgenda();
            })
            .catch(function(e) { console.error('[P46] slots:', e); toast('Erro ao carregar agenda', 'error'); });
    }

    function carregarTudo() {
        carregarFila();
        if (Estado.tabAtiva === 'agenda') carregarSlots();
    }

    // ── Atualizar status ───────────────────────────
    function atualizarStatus(radioId, novoStatus) {
        var motivo = '';
        if (novoStatus === 'cancelado') {
            motivo = prompt('Motivo do cancelamento (mínimo 5 caracteres):') || '';
            if (motivo.trim().length < 5) { toast('Informe o motivo do cancelamento.', 'warning'); return; }
            motivo = motivo.trim();
        }
        fetch(CONFIG.api.exameStatus.replace('{id}', radioId), {
            method: 'PUT', credentials: 'same-origin',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({status: novoStatus, motivo: motivo})
        })
        .then(function(r) { return r.json(); })
        .then(function(d) {
            if (d.success) { toast('Status atualizado!', 'success'); carregarFila(); }
            else toast('Erro: ' + (d.error || 'Falha'), 'error');
        })
        .catch(function(e) { console.error('[P46]', e); toast('Erro de conexão', 'error'); });
    }

    // ── Gestão de slots ────────────────────────────
    function bloquearSlot(slotId) {
        var obs = prompt('Motivo do bloqueio (opcional):') || '';
        fetch(CONFIG.api.slotUpdate.replace('{id}', slotId), {
            method: 'PUT', credentials: 'same-origin',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({acao: 'bloquear', obs_bloqueio: obs})
        })
        .then(function(r) { return r.json(); })
        .then(function(d) {
            if (d.success) { toast('Slot bloqueado.', 'warning'); carregarSlots(); }
            else toast('Erro: ' + (d.error || 'Falha'), 'error');
        })
        .catch(function(e) { console.error('[P46]', e); toast('Erro de conexão', 'error'); });
    }

    function desbloquearSlot(slotId) {
        fetch(CONFIG.api.slotUpdate.replace('{id}', slotId), {
            method: 'PUT', credentials: 'same-origin',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({acao: 'desbloquear'})
        })
        .then(function(r) { return r.json(); })
        .then(function(d) {
            if (d.success) { toast('Slot desbloqueado.', 'success'); carregarSlots(); }
            else toast('Erro: ' + (d.error || 'Falha'), 'error');
        })
        .catch(function(e) { console.error('[P46]', e); toast('Erro de conexão', 'error'); });
    }

    function removerSlot(slotId) {
        if (!confirm('Remover este slot?')) return;
        fetch(CONFIG.api.slotDelete.replace('{id}', slotId), {
            method: 'DELETE', credentials: 'same-origin'
        })
        .then(function(r) { return r.json(); })
        .then(function(d) {
            if (d.success) { toast('Slot removido.', 'info'); carregarSlots(); }
            else toast('Erro: ' + (d.error || 'Falha'), 'error');
        })
        .catch(function(e) { console.error('[P46]', e); toast('Erro de conexão', 'error'); });
    }

    function desagendar(slotId, radioId) {
        if (!confirm('Desvincular paciente deste slot?')) return;
        fetch(CONFIG.api.agendar.replace('{id}', radioId), {
            method: 'PUT', credentials: 'same-origin',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({slot_id: null})
        })
        .then(function(r) { return r.json(); })
        .then(function(d) {
            if (d.success) { toast('Paciente desvinculado.', 'success'); carregarSlots(); carregarFila(); }
            else toast('Erro: ' + (d.error || 'Falha'), 'error');
        })
        .catch(function(e) { console.error('[P46]', e); toast('Erro de conexão', 'error'); });
    }

    // ── Modal vincular paciente ────────────────────
    function abrirAgendar(slotId) {
        var pendentes = Estado.fila.pendentes;
        var listaEl  = document.getElementById('lista-vincular');
        var infoEl   = document.getElementById('modal-vincular-info');
        var modal    = document.getElementById('modal-vincular');

        var slotInfo = null;
        for (var i = 0; i < Estado.slots.length; i++) {
            if (Estado.slots[i].id === slotId) { slotInfo = Estado.slots[i]; break; }
        }

        if (infoEl && slotInfo)
            infoEl.innerHTML = '<strong>Slot: ' + formatarHora(slotInfo.data_hora) + '</strong>'
                + (slotInfo.modalidade ? ' — ' + escHtml(slotInfo.modalidade) : '')
                + ' · ' + (slotInfo.duracao_min || 30) + 'min';

        if (listaEl) {
            if (!pendentes.length) {
                listaEl.innerHTML = '<div style="text-align:center;padding:20px;color:#6c757d;">Nenhum paciente sem horário.</div>';
            } else {
                var html = '';
                for (var j = 0; j < pendentes.length; j++) {
                    var p = pendentes[j];
                    html += '<div class="lista-vincular-item" onclick="P46.vincularPaciente(' + slotId + ',' + p.id + ')">'
                          + '<div><div class="lv-nome">' + escHtml(formatarNome(p.nm_paciente)) + '</div>'
                          + '<div class="lv-info">' + escHtml(p.ds_procedimento || '') + ' · ' + escHtml(p.leito_origem || '') + '</div></div>'
                          + '<i class="fas fa-chevron-right" style="color:var(--cor-primaria);"></i></div>';
                }
                listaEl.innerHTML = html;
            }
        }
        if (modal) modal.style.display = 'flex';
    }

    function vincularPaciente(slotId, radioId) {
        fetch(CONFIG.api.agendar.replace('{id}', radioId), {
            method: 'PUT', credentials: 'same-origin',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({slot_id: slotId})
        })
        .then(function(r) { return r.json(); })
        .then(function(d) {
            var modal = document.getElementById('modal-vincular');
            if (modal) modal.style.display = 'none';
            if (d.success) { toast('Paciente agendado!', 'success'); carregarSlots(); carregarFila(); }
            else toast('Erro: ' + (d.error || 'Falha'), 'error');
        })
        .catch(function(e) { console.error('[P46]', e); toast('Erro de conexão', 'error'); });
    }

    // ── Modal criar lote ───────────────────────────
    function criarLote() {
        var data       = document.getElementById('lote-data').value;
        var inicio     = document.getElementById('lote-inicio').value;
        var fim        = document.getElementById('lote-fim').value;
        var duracao    = document.getElementById('lote-duracao').value;
        var modalidade = document.getElementById('lote-modalidade') ? document.getElementById('lote-modalidade').value : '';

        if (!data || !inicio || !fim) { toast('Preencha data, início e fim.', 'warning'); return; }

        fetch(CONFIG.api.slotsLote, {
            method: 'POST', credentials: 'same-origin',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({data: data, hora_inicio: inicio, hora_fim: fim,
                                  duracao_min: parseInt(duracao) || 30,
                                  modalidade: modalidade || null})
        })
        .then(function(r) { return r.json(); })
        .then(function(d) {
            fecharModal('modal-lote');
            if (d.success) {
                toast((d.criados || 0) + ' slots criados!', 'success');
                Estado.dataConsulta = data;
                if (DOM.labelData) DOM.labelData.textContent = labelData(data);
                mudarTab('agenda');
                carregarSlots();
            } else toast('Erro: ' + (d.error || 'Falha'), 'error');
        })
        .catch(function(e) { console.error('[P46]', e); toast('Erro de conexão', 'error'); });
    }

    // ── Modal slot avulso ──────────────────────────
    function criarAvulso() {
        var data       = document.getElementById('avulso-data').value;
        var hora       = document.getElementById('avulso-hora').value;
        var duracao    = document.getElementById('avulso-duracao').value;
        var modalidade = document.getElementById('avulso-modalidade') ? document.getElementById('avulso-modalidade').value : '';

        if (!data || !hora) { toast('Preencha data e horário.', 'warning'); return; }

        fetch(CONFIG.api.slots, {
            method: 'POST', credentials: 'same-origin',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({data_hora: data + 'T' + hora + ':00',
                                  duracao_min: parseInt(duracao) || 30,
                                  modalidade: modalidade || null})
        })
        .then(function(r) { return r.json(); })
        .then(function(d) {
            fecharModal('modal-avulso');
            if (d.success) { toast('Slot criado!', 'success'); carregarSlots(); }
            else toast('Erro: ' + (d.error || 'Falha'), 'error');
        })
        .catch(function(e) { console.error('[P46]', e); toast('Erro de conexão', 'error'); });
    }

    // ── Helpers modal ──────────────────────────────
    function fecharModal(modalId) {
        var el = document.getElementById(modalId);
        if (el) el.style.display = 'none';
    }

    function abrirModal(modalId) {
        var el = document.getElementById(modalId);
        if (el) el.style.display = 'flex';
    }

    // ── Inicializar ────────────────────────────────
    function inicializar() {
        DOM.labelData = document.getElementById('label-data');
        if (DOM.labelData) DOM.labelData.textContent = labelData(Estado.dataConsulta);

        // Tabs
        var abasBtns = document.querySelectorAll('.aba');
        for (var i = 0; i < abasBtns.length; i++) {
            (function(btn) {
                btn.addEventListener('click', function() {
                    mudarTab(btn.getAttribute('data-aba'));
                });
            })(abasBtns[i]);
        }

        // data-fecha (fechar modal por botão)
        var fechaBtns = document.querySelectorAll('[data-fecha]');
        for (var j = 0; j < fechaBtns.length; j++) {
            (function(btn) {
                btn.addEventListener('click', function() {
                    fecharModal(btn.getAttribute('data-fecha'));
                });
            })(fechaBtns[j]);
        }

        // Fechar modal ao clicar fora
        var overlays = document.querySelectorAll('.modal-overlay');
        for (var k = 0; k < overlays.length; k++) {
            (function(ov) {
                ov.addEventListener('click', function(e) { if (e.target === ov) ov.style.display = 'none'; });
            })(overlays[k]);
        }

        // Navegação de data
        var btnAnt  = document.getElementById('btn-dia-anterior');
        var btnProx = document.getElementById('btn-dia-proximo');
        if (btnAnt) btnAnt.addEventListener('click', function() {
            var d = new Date(Estado.dataConsulta + 'T12:00:00');
            d.setDate(d.getDate() - 1);
            Estado.dataConsulta = d.toISOString().slice(0, 10);
            if (DOM.labelData) DOM.labelData.textContent = labelData(Estado.dataConsulta);
            carregarSlots();
        });
        if (btnProx) btnProx.addEventListener('click', function() {
            var d = new Date(Estado.dataConsulta + 'T12:00:00');
            d.setDate(d.getDate() + 1);
            Estado.dataConsulta = d.toISOString().slice(0, 10);
            if (DOM.labelData) DOM.labelData.textContent = labelData(Estado.dataConsulta);
            carregarSlots();
        });

        // Botões gerais
        var btnR = document.getElementById('btn-refresh');
        if (btnR) btnR.addEventListener('click', carregarTudo);
        var btnV = document.getElementById('btn-voltar');
        if (btnV) btnV.addEventListener('click', function() { window.history.back(); });

        // Modal lote
        var btnLote = document.getElementById('btn-criar-lote');
        if (btnLote) btnLote.addEventListener('click', function() {
            var el = document.getElementById('lote-data');
            if (el) el.value = Estado.dataConsulta;
            abrirModal('modal-lote');
        });
        var btnLoteOk = document.getElementById('modal-lote-confirmar');
        if (btnLoteOk) btnLoteOk.addEventListener('click', criarLote);

        // Modal avulso
        var btnAv = document.getElementById('btn-criar-avulso');
        if (btnAv) btnAv.addEventListener('click', function() {
            var el = document.getElementById('avulso-data');
            if (el) el.value = Estado.dataConsulta;
            abrirModal('modal-avulso');
        });
        var btnAvOk = document.getElementById('modal-avulso-confirmar');
        if (btnAvOk) btnAvOk.addEventListener('click', criarAvulso);

        carregarFila();
        setInterval(carregarTudo, CONFIG.intervalo);
    }

    window.P46 = {
        atualizarStatus: atualizarStatus,
        bloquearSlot:    bloquearSlot,
        desbloquearSlot: desbloquearSlot,
        removerSlot:     removerSlot,
        desagendar:      desagendar,
        abrirAgendar:    abrirAgendar,
        vincularPaciente: vincularPaciente
    };

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', inicializar);
    else inicializar();
})();
