(function () {
    'use strict';

    // ── Pills de modalidade (aba Agenda) ──────────────────────────────────────

    function inicializarPillsAgenda() {
        var E         = window.P46.Estado;
        var container = document.getElementById('agenda-pills-bar');
        if (!container) return;
        var btns = container.querySelectorAll('.pill-agenda');
        for (var i = 0; i < btns.length; i++) {
            (function (btn) {
                btn.addEventListener('click', function () {
                    E.filtroModalidade = btn.getAttribute('data-modal') || '';
                    var todos = container.querySelectorAll('.pill-agenda');
                    for (var j = 0; j < todos.length; j++) {
                        var ativo = todos[j].getAttribute('data-modal') === E.filtroModalidade;
                        todos[j].className = todos[j].className.replace(' ativo', '') + (ativo ? ' ativo' : '');
                    }
                    renderizarAgenda();
                });
            })(btns[i]);
        }
    }

    // ── HTML de um card de slot ───────────────────────────────────────────────

    function slotCardHtml(slot) {
        var escHtml  = window.P46.escHtml;
        var fNome    = window.P46.formatarNome;
        var fHora    = window.P46.formatarHora;
        var badgeEnf = window.P46.badgeStatusEnf;

        var cssClass = 'slot-card slot-' + (slot.status || 'livre');
        var html = '<div class="' + cssClass + '">';
        html += '<div class="slot-hora">'    + fHora(slot.data_hora) + '</div>';
        html += '<div class="slot-duracao">' + (slot.duracao_min || 30) + ' min</div>';
        if (slot.modalidade)
            html += '<span class="slot-modal-badge">' + escHtml(slot.modalidade) + '</span>';

        if (slot.status === 'ocupado' && slot.nm_paciente) {
            html += '<div class="slot-paciente"><i class="fas fa-user"></i> ' + escHtml(fNome(slot.nm_paciente)) + '</div>';
            if (slot.ds_procedimento)
                html += '<div class="slot-exame-s">' + escHtml(slot.ds_procedimento) + '</div>';
            if (slot.requer_preparo && slot.tipo_preparo)
                html += '<div class="slot-preparo"><i class="fas fa-flask"></i> ' + escHtml(slot.tipo_preparo) + '</div>';
            if (slot.status_enfermagem)
                html += '<div class="slot-enf-row">' + badgeEnf(slot.status_enfermagem) + '</div>';
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
            html += '<button class="btn-slot btn-slot-desvincular" onclick="P46.desagendar(' + slot.id + ')">'
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

    // ── Atualizar barra de info dos slots ─────────────────────────────────────

    function atualizarInfoSlots() {
        var E = window.P46.Estado;
        var livres = 0, ocupados = 0, bloqueados = 0;
        var contagem = { todos: 0, RM: 0, TC: 0, USG: 0, RX: 0, MAM: 0, OUTROS: 0 };

        for (var i = 0; i < E.slots.length; i++) {
            var sl = E.slots[i];
            var s  = sl.status;
            if (s === 'livre')     livres++;
            else if (s === 'ocupado') ocupados++;
            else                   bloqueados++;
            contagem.todos++;
            var modal = sl.modalidade || 'OUTROS';
            if (contagem[modal] !== undefined) contagem[modal]++;
            else contagem.OUTROS++;
        }

        var el = document.getElementById('slots-info-bar');
        if (el) el.textContent = livres + ' livres · ' + ocupados + ' ocupadas · ' + bloqueados + ' bloqueadas';

        var setarCnt = function (id, n) { var e = document.getElementById(id); if (e) e.textContent = n; };
        setarCnt('acnt-todos',  contagem.todos);
        setarCnt('acnt-rm',     contagem.RM);
        setarCnt('acnt-tc',     contagem.TC);
        setarCnt('acnt-usg',    contagem.USG);
        setarCnt('acnt-rx',     contagem.RX);
        setarCnt('acnt-mam',    contagem.MAM);
        setarCnt('acnt-outros', contagem.OUTROS);
    }

    // ── Renderizar grade de slots ─────────────────────────────────────────────

    function renderizarAgenda() {
        var E = window.P46.Estado;

        var loading = document.getElementById('agenda-loading');
        var vazio   = document.getElementById('agenda-vazia');
        var grade   = document.getElementById('grade-slots');
        if (loading) loading.style.display = 'none';

        var filtro = E.filtroModalidade;
        var lista  = [];
        for (var i = 0; i < E.slots.length; i++) {
            if (!filtro) { lista.push(E.slots[i]); continue; }
            var modal = E.slots[i].modalidade || 'OUTROS';
            if (modal === filtro) lista.push(E.slots[i]);
        }

        if (!lista.length) {
            if (vazio) vazio.style.display = '';
            if (grade) grade.style.display = 'none';
            atualizarInfoSlots();
            return;
        }
        if (vazio) vazio.style.display = 'none';

        var html = '';
        for (var j = 0; j < lista.length; j++) html += slotCardHtml(lista[j]);
        if (grade) { grade.innerHTML = html; grade.style.display = ''; }
        atualizarInfoSlots();
    }

    // ── Carregar slots da API ─────────────────────────────────────────────────

    function carregarSlots() {
        var E = window.P46.Estado;

        var loading = document.getElementById('agenda-loading');
        var grade   = document.getElementById('grade-slots');
        if (loading) loading.style.display = '';
        if (grade)   grade.style.display   = 'none';

        fetch(window.P46.CONFIG.api.slots + '?data=' + E.dataConsulta, { credentials: 'same-origin' })
            .then(function (r) { return r.json(); })
            .then(function (d) {
                if (d.success) E.slots = d.data || d.dados || [];
                renderizarAgenda();
            })
            .catch(function (e) {
                console.error('[P46] slots:', e);
                window.P46.toast('Erro ao carregar agenda', 'error');
            });
    }

    window.P46.inicializarPillsAgenda = inicializarPillsAgenda;
    window.P46.slotCardHtml           = slotCardHtml;
    window.P46.atualizarInfoSlots     = atualizarInfoSlots;
    window.P46.renderizarAgenda       = renderizarAgenda;
    window.P46.carregarSlots          = carregarSlots;

})();
