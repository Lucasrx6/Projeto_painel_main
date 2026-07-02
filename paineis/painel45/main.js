/* PAINEL 45 - Radiologia / Enfermagem — ES5
   Novo fluxo: enfermagem vê exames agendados pela radiologia e dá ciência ou recusa.
*/
(function() {
    'use strict';

    var CONFIG = {
        api: {
            agendamentos: '/api/paineis/painel45/agendamentos',
            ciencia:      '/api/paineis/painel45/exames/{id}/ciencia',
            recusar:      '/api/paineis/painel45/exames/{id}/recusar'
        },
        intervalo: 45000
    };

    var Estado = {
        dados: [],
        setoresSelecionados: [],
        filtroStatus: 'todos',   // 'todos'|'pendente'|'ciente'|'recusado'
        modalId: null
    };

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

    function formatarDataHora(iso) {
        if (!iso) return '-';
        try {
            var d = new Date(iso);
            var hoje = new Date();
            var mesmodia = d.getDate() === hoje.getDate()
                        && d.getMonth() === hoje.getMonth()
                        && d.getFullYear() === hoje.getFullYear();
            var h = d.toLocaleTimeString('pt-BR', {hour:'2-digit', minute:'2-digit'});
            if (mesmodia) return h;
            return d.toLocaleDateString('pt-BR', {day:'2-digit', month:'2-digit'}) + ' ' + h;
        } catch(e) { return iso; }
    }

    // ── Badges ─────────────────────────────────────
    function badgeEnf(status) {
        var mapa = {
            'pendente': ['badge-enf-pendente', 'fa-clock',       'Aguard. Ciência'],
            'ciente':   ['badge-enf-ciente',   'fa-check',       'Ciente'],
            'recusado': ['badge-enf-recusado', 'fa-times',       'Recusado']
        };
        var m = mapa[status] || ['', 'fa-question', status || '?'];
        return '<span class="badge-status ' + m[0] + '"><i class="fas ' + m[1] + '"></i> ' + m[2] + '</span>';
    }

    function badgeTipo(tipo) {
        var cores = {
            'RX':    ['#0d6efd', '#cfe2ff'],
            'RM':    ['#6f42c1', '#e2d9f3'],
            'TC':    ['#0dcaf0', '#cff4fc'],
            'USG':   ['#198754', '#d1e7dd'],
            'MAM':   ['#fd7e14', '#ffe5d0'],
            'OUTROS':['#6c757d', '#e2e3e5']
        };
        var c = cores[tipo] || cores['OUTROS'];
        return '<span class="badge-tipo" style="background:' + c[1] + ';color:' + c[0] + ';border-color:' + c[0] + '">'
             + escHtml(tipo || 'OUTROS') + '</span>';
    }

    function badgeRadioStatus(s) {
        var mapa = {
            'pendente':   ['badge-radio-pendente',   'fa-hourglass-half', 'Sem horário'],
            'agendado':   ['badge-radio-agendado',   'fa-calendar-check', 'Agendado'],
            'no_local':   ['badge-radio-nolo',       'fa-map-marker-alt', 'No Local'],
            'executando': ['badge-radio-exec',       'fa-spinner',        'Executando'],
            'concluido':  ['badge-radio-conc',       'fa-check-double',   'Concluído']
        };
        var m = mapa[s];
        if (!m) return '';
        return '<span class="badge-status ' + m[0] + '"><i class="fas ' + m[1] + '"></i> ' + m[2] + '</span>';
    }

    // ── Pills de setor ─────────────────────────────
    function popularPills() {
        var container = document.getElementById('pills-setor');
        if (!container) return;
        var setores = [], vistos = {};
        for (var i = 0; i < Estado.dados.length; i++) {
            var s = Estado.dados[i].setor_origem_nome || '';
            if (s && !vistos[s]) { vistos[s] = true; setores.push(s); }
        }
        setores.sort();
        var todosAtivo = !Estado.setoresSelecionados.length;
        var html = '<button class="pill' + (todosAtivo ? ' ativo' : '') + '" data-pill="todos">Todos</button>';
        for (var j = 0; j < setores.length; j++) {
            var isAtivo = Estado.setoresSelecionados.indexOf(setores[j]) >= 0;
            html += '<button class="pill' + (isAtivo ? ' ativo' : '') + '" data-pill="' + escHtml(setores[j]) + '">'
                  + escHtml(setores[j]) + '</button>';
        }
        container.innerHTML = html;
        var btns = container.querySelectorAll('.pill');
        for (var k = 0; k < btns.length; k++) {
            (function(btn) {
                btn.addEventListener('click', function() {
                    var val = btn.getAttribute('data-pill');
                    if (val === 'todos') {
                        Estado.setoresSelecionados = [];
                    } else {
                        var idx = Estado.setoresSelecionados.indexOf(val);
                        if (idx >= 0) Estado.setoresSelecionados.splice(idx, 1);
                        else Estado.setoresSelecionados.push(val);
                    }
                    localStorage.setItem('p45_setores', JSON.stringify(Estado.setoresSelecionados));
                    popularPills();
                    renderizar();
                });
            })(btns[k]);
        }
    }

    // ── Contadores ─────────────────────────────────
    function atualizarContadores(lista) {
        var total = lista.length, urgentes = 0, pendentes = 0, cientes = 0, recusados = 0;
        for (var i = 0; i < lista.length; i++) {
            var it = lista[i];
            if (it.prioridade === 'urgente') urgentes++;
            var enf = it.status_enfermagem || 'pendente';
            if (enf === 'pendente')  pendentes++;
            else if (enf === 'ciente')   cientes++;
            else if (enf === 'recusado') recusados++;
        }
        var ids = {total: total, urgentes: urgentes, pendentes: pendentes, cientes: cientes, recusados: recusados};
        for (var k in ids) {
            var el = document.getElementById('cnt-' + k);
            if (el) el.textContent = ids[k];
        }
    }

    // ── Card de agendamento ─────────────────────────
    function cardAgendamentoHtml(item) {
        var enf      = item.status_enfermagem || 'pendente';
        var urgente  = item.prioridade === 'urgente';
        var recusado = enf === 'recusado';
        var ciente   = enf === 'ciente';

        var cls = 'card-ag';
        if (urgente)  cls += ' card-ag-urgente';
        if (recusado) cls += ' card-ag-recusado';
        if (ciente)   cls += ' card-ag-ciente';

        var html = '<div class="' + cls + '">';

        // Header
        html += '<div class="card-ag-header">';
        html += '<span class="card-ag-setor"><i class="fas fa-hospital-alt"></i> ' + escHtml(item.setor_origem_nome || '-') + '</span>';
        if (urgente) html += '<span class="badge-urgente">URGENTE</span>';
        html += '</div>';

        // Corpo
        html += '<div class="card-ag-body">';

        // Paciente
        html += '<div class="card-ag-paciente">'
              + '<div class="card-ag-nome">' + escHtml(formatarNome(item.nm_paciente)) + '</div>'
              + '<div class="card-ag-meta">'
              + '<span><i class="fas fa-bed"></i> ' + escHtml(item.leito_origem || '-') + '</span>'
              + '</div>'
              + '</div>';

        // Exame + tipo + horário
        html += '<div class="card-ag-exame">'
              + '<div class="card-ag-proc"><i class="fas fa-x-ray"></i> ' + escHtml(item.ds_procedimento || '-') + '</div>'
              + '<div class="card-ag-badges">'
              + badgeTipo(item.tipo_exame)
              + ' ' + badgeEnf(enf)
              + ' ' + badgeRadioStatus(item.status)
              + '</div>';

        // Horário do slot
        if (item.slot_data_hora) {
            html += '<div class="card-ag-slot"><i class="fas fa-clock"></i> Horário: <strong>'
                  + formatarDataHora(item.slot_data_hora) + '</strong>';
            if (item.slot_modalidade) html += ' <span class="badge-modalidade">' + escHtml(item.slot_modalidade) + '</span>';
            html += '</div>';
        } else {
            html += '<div class="card-ag-slot card-ag-slot-sem"><i class="fas fa-calendar-times"></i> Aguardando horário</div>';
        }

        // Motivo recusa
        if (recusado && item.motivo_recusa) {
            html += '<div class="card-ag-recusa-motivo">'
                  + '<i class="fas fa-exclamation-circle"></i> <strong>Motivo:</strong> '
                  + escHtml(item.motivo_recusa)
                  + '</div>';
        }

        // Observação
        if (item.observacao) {
            html += '<div class="card-ag-obs"><i class="fas fa-comment-alt"></i> ' + escHtml(item.observacao) + '</div>';
        }

        // Médico solicitante
        if (item.nm_medico_solicitante) {
            html += '<div class="card-ag-medico"><i class="fas fa-user-md"></i> ' + escHtml(item.nm_medico_solicitante) + '</div>';
        }

        html += '</div>';  // card-ag-exame
        html += '</div>';  // card-ag-body

        // Ações — só para exames agendados (com slot) e não concluídos/cancelados
        var podeAgir = item.status !== 'concluido' && item.status !== 'cancelado';
        if (podeAgir && item.slot_id) {
            html += '<div class="card-ag-footer">';
            if (enf !== 'ciente') {
                html += '<button class="btn-ciencia" onclick="P45.abrirCiencia(' + item.id + ',\''
                      + escHtml(item.nm_paciente || '') + '\',\''
                      + escHtml(item.ds_procedimento || '') + '\')">'
                      + '<i class="fas fa-check"></i> Dar Ciência</button>';
            } else {
                html += '<span class="txt-ciente"><i class="fas fa-check-circle"></i> Ciência registrada';
                if (item.dt_ciencia) html += ' ' + formatarDataHora(item.dt_ciencia);
                html += '</span>';
            }
            if (enf !== 'ciente') {
                html += '<button class="btn-recusar" onclick="P45.abrirRecusar(' + item.id + ',\''
                      + escHtml(item.nm_paciente || '') + '\',\''
                      + escHtml(item.ds_procedimento || '') + '\')">'
                      + '<i class="fas fa-times"></i> Recusar</button>';
            }
            html += '</div>';
        } else if (!item.slot_id) {
            html += '<div class="card-ag-footer">'
                  + '<span class="txt-sem-horario"><i class="fas fa-hourglass-half"></i> Aguardando horário da radiologia</span>'
                  + '</div>';
        }

        html += '</div>';  // card-ag
        return html;
    }

    // ── Renderizar ─────────────────────────────────
    function renderizar() {
        var mc = document.getElementById('main-content');
        if (!mc) return;

        popularPills();

        // Filtrar
        var filtrados = [];
        for (var n = 0; n < Estado.dados.length; n++) {
            var it = Estado.dados[n];
            if (Estado.setoresSelecionados.length
                && Estado.setoresSelecionados.indexOf(it.setor_origem_nome || '') < 0) continue;
            var enf = it.status_enfermagem || 'pendente';
            if (Estado.filtroStatus !== 'todos' && enf !== Estado.filtroStatus) continue;
            filtrados.push(it);
        }

        atualizarContadores(Estado.dados);

        if (!filtrados.length) {
            mc.innerHTML = '<div class="painel-vazio"><i class="fas fa-calendar-check"></i>'
                + '<p>Nenhum agendamento encontrado.</p></div>';
            return;
        }

        // Agrupar por setor
        var grupos = {}, ordem = [];
        for (var m = 0; m < filtrados.length; m++) {
            var ex = filtrados[m];
            var sg = ex.setor_origem_nome || 'Sem setor';
            if (!grupos[sg]) { grupos[sg] = []; ordem.push(sg); }
            grupos[sg].push(ex);
        }

        var html = '';
        for (var s = 0; s < ordem.length; s++) {
            var setor = ordem[s];
            var lista = grupos[setor];
            var pendCount = 0;
            for (var pi = 0; pi < lista.length; pi++) {
                if ((lista[pi].status_enfermagem || 'pendente') === 'pendente') pendCount++;
            }
            html += '<div class="setor-grupo">'
                  + '<div class="setor-titulo"><i class="fas fa-hospital-alt"></i> ' + escHtml(setor)
                  + '<span class="setor-count">' + lista.length + '</span>';
            if (pendCount > 0) {
                html += '<span class="setor-pendentes">' + pendCount + ' aguard.</span>';
            }
            html += '</div>';
            html += '<div class="grid-cards-ag">';
            for (var ci = 0; ci < lista.length; ci++) {
                html += cardAgendamentoHtml(lista[ci]);
            }
            html += '</div></div>';
        }
        mc.innerHTML = html;
    }

    // ── Carregar ───────────────────────────────────
    function carregar() {
        fetch(CONFIG.api.agendamentos, {credentials: 'same-origin'})
            .then(function(r) { return r.json(); })
            .then(function(d) {
                if (d.success) {
                    Estado.dados = d.data || [];
                } else {
                    Estado.dados = [];
                    toast('Erro: ' + (d.error || 'Falha ao carregar'), 'error');
                }
                renderizar();
                var el = document.getElementById('ultima-atualizacao');
                if (el) el.textContent = new Date().toLocaleTimeString('pt-BR', {hour:'2-digit', minute:'2-digit'});
            })
            .catch(function(e) {
                console.error('[P45]', e);
                Estado.dados = [];
                var mc = document.getElementById('main-content');
                if (mc) mc.innerHTML = '<div class="painel-vazio"><i class="fas fa-exclamation-triangle"></i><p>Erro de conexão.</p></div>';
                toast('Erro ao carregar dados', 'error');
            });
    }

    // ── Modal Ciência ──────────────────────────────
    function abrirCiencia(id, nome, exame) {
        Estado.modalId = id;
        var info = document.getElementById('modal-cien-info');
        if (info) {
            info.innerHTML = '<strong>' + escHtml(formatarNome(nome)) + '</strong><br>'
                           + '<small>' + escHtml(exame) + '</small>';
        }
        var modal = document.getElementById('modal-ciencia');
        if (modal) modal.style.display = 'flex';
    }

    function fecharCiencia() {
        var modal = document.getElementById('modal-ciencia');
        if (modal) modal.style.display = 'none';
        Estado.modalId = null;
    }

    function confirmarCiencia() {
        if (!Estado.modalId) return;
        var btn = document.getElementById('modal-cien-confirmar');
        if (btn) btn.disabled = true;
        var url = CONFIG.api.ciencia.replace('{id}', Estado.modalId);
        fetch(url, {method: 'PUT', credentials: 'same-origin',
                    headers: {'Content-Type': 'application/json'}})
            .then(function(r) { return r.json(); })
            .then(function(d) {
                fecharCiencia();
                if (d.success) { toast('Ciência registrada!', 'success'); carregar(); }
                else toast('Erro: ' + (d.error || 'Falha'), 'error');
            })
            .catch(function(e) { console.error('[P45]', e); toast('Erro de conexão', 'error'); })
            .finally(function() { if (btn) btn.disabled = false; });
    }

    // ── Modal Recusar ──────────────────────────────
    function abrirRecusar(id, nome, exame) {
        Estado.modalId = id;
        var info = document.getElementById('modal-rec-info');
        if (info) {
            info.innerHTML = '<strong>' + escHtml(formatarNome(nome)) + '</strong><br>'
                           + '<small>' + escHtml(exame) + '</small>';
        }
        var motivo = document.getElementById('modal-rec-motivo');
        if (motivo) motivo.value = '';
        var hint = document.getElementById('modal-rec-hint');
        if (hint) hint.style.display = 'none';
        var modal = document.getElementById('modal-recusar');
        if (modal) modal.style.display = 'flex';
    }

    function fecharRecusar() {
        var modal = document.getElementById('modal-recusar');
        if (modal) modal.style.display = 'none';
        Estado.modalId = null;
    }

    function confirmarRecusar() {
        if (!Estado.modalId) return;
        var motivoEl = document.getElementById('modal-rec-motivo');
        var hint     = document.getElementById('modal-rec-hint');
        var motivo   = motivoEl ? motivoEl.value.trim() : '';
        if (motivo.length < 5) {
            if (hint) hint.style.display = '';
            return;
        }
        if (hint) hint.style.display = 'none';
        var btn = document.getElementById('modal-rec-confirmar');
        if (btn) btn.disabled = true;
        var url = CONFIG.api.recusar.replace('{id}', Estado.modalId);
        fetch(url, {
            method: 'PUT', credentials: 'same-origin',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({motivo: motivo})
        })
        .then(function(r) { return r.json(); })
        .then(function(d) {
            fecharRecusar();
            if (d.success) { toast('Agendamento recusado.', 'warning'); carregar(); }
            else toast('Erro: ' + (d.error || 'Falha'), 'error');
        })
        .catch(function(e) { console.error('[P45]', e); toast('Erro de conexão', 'error'); })
        .finally(function() { if (btn) btn.disabled = false; });
    }

    // ── Inicializar ────────────────────────────────
    function inicializar() {
        try {
            var ss = localStorage.getItem('p45_setores');
            if (ss) Estado.setoresSelecionados = JSON.parse(ss) || [];
        } catch(e) { Estado.setoresSelecionados = []; }
        Estado.filtroStatus = localStorage.getItem('p45_filtro_status') || 'todos';

        // Pills de status
        function atualizarPillsStatus() {
            var btns = document.querySelectorAll('#filtro-status-pills .pill-status');
            for (var i = 0; i < btns.length; i++) {
                var ativo = btns[i].getAttribute('data-status') === Estado.filtroStatus;
                btns[i].className = btns[i].className.replace(' ativo', '') + (ativo ? ' ativo' : '');
            }
        }
        atualizarPillsStatus();
        var pillsCont = document.getElementById('filtro-status-pills');
        if (pillsCont) {
            var pillBtns = pillsCont.querySelectorAll('.pill-status');
            for (var pi = 0; pi < pillBtns.length; pi++) {
                (function(btn) {
                    btn.addEventListener('click', function() {
                        Estado.filtroStatus = btn.getAttribute('data-status');
                        localStorage.setItem('p45_filtro_status', Estado.filtroStatus);
                        atualizarPillsStatus();
                        renderizar();
                    });
                })(pillBtns[pi]);
            }
        }

        // Botões cabeçalho
        var btnR = document.getElementById('btn-refresh');
        if (btnR) btnR.addEventListener('click', carregar);
        var btnV = document.getElementById('btn-voltar');
        if (btnV) btnV.addEventListener('click', function() { window.history.back(); });

        // Modal ciência
        document.getElementById('modal-cien-fechar').addEventListener('click', fecharCiencia);
        document.getElementById('modal-cien-cancelar').addEventListener('click', fecharCiencia);
        document.getElementById('modal-cien-confirmar').addEventListener('click', confirmarCiencia);
        document.getElementById('modal-ciencia').addEventListener('click', function(e) {
            if (e.target === this) fecharCiencia();
        });

        // Modal recusar
        document.getElementById('modal-rec-fechar').addEventListener('click', fecharRecusar);
        document.getElementById('modal-rec-cancelar').addEventListener('click', fecharRecusar);
        document.getElementById('modal-rec-confirmar').addEventListener('click', confirmarRecusar);
        document.getElementById('modal-recusar').addEventListener('click', function(e) {
            if (e.target === this) fecharRecusar();
        });

        carregar();
        setInterval(carregar, CONFIG.intervalo);
    }

    window.P45 = {
        abrirCiencia: abrirCiencia,
        abrirRecusar: abrirRecusar
    };

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', inicializar);
    else inicializar();
})();
