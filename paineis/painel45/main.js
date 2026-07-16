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
        filtroData: '',          // YYYY-MM-DD — iniciado em inicializar()
        modalId: null
    };

    function hojeISO() {
        var d = new Date();
        return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
    }

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

    // ── Linha de agendamento (visualização em tabela) ─
    function linhaAgendamentoHtml(item) {
        var enf      = item.status_enfermagem || 'pendente';
        var urgente  = item.prioridade === 'urgente';
        var recusado = enf === 'recusado';
        var ciente   = enf === 'ciente';

        var cls = 'linha-ag';
        if (urgente)  cls += ' linha-urgente';
        if (ciente)   cls += ' linha-ciente';
        if (recusado) cls += ' linha-recusado';

        var html = '<tr class="' + cls + '">';

        // Paciente / Leito
        html += '<td>'
              + '<div class="ta-nome">'
              + (urgente ? '<i class="fas fa-bolt" style="color:#dc3545;margin-right:4px;"></i>' : '')
              + escHtml(formatarNome(item.nm_paciente))
              + '</div>'
              + '<div class="ta-sub"><i class="fas fa-bed"></i> ' + escHtml(item.leito_origem || '-') + '</div>'
              + '</td>';

        // Procedimento
        html += '<td><div class="ta-proc">' + escHtml(item.ds_procedimento || '-') + '</div>';
        if (item.requer_preparo && item.tipo_preparo) {
            html += '<div class="ta-preparo"><i class="fas fa-exclamation-triangle"></i>'
                  + escHtml(item.tipo_preparo) + '</div>';
        }
        html += '</td>';

        // Tipo
        html += '<td>' + badgeTipo(item.tipo_exame) + '</td>';

        // Horário
        if (item.slot_data_hora) {
            html += '<td><span class="ta-slot"><i class="fas fa-clock"></i> '
                  + escHtml(formatarDataHora(item.slot_data_hora)) + '</span>';
            if (item.slot_modalidade) {
                html += ' <span class="badge-modalidade">' + escHtml(item.slot_modalidade) + '</span>';
            }
            html += '</td>';
        } else {
            html += '<td><span class="ta-slot-sem"><i class="fas fa-calendar-times"></i> Aguardando</span></td>';
        }

        // Status Enfermagem
        html += '<td>' + badgeEnf(enf) + '</td>';

        // Status Radiologia
        html += '<td>' + badgeRadioStatus(item.status);
        if (item.auto_finalizado)
            html += '<br><span class="badge-sistema" title="Concluído automaticamente pelo sistema por falta de ação do usuário"><i class="fas fa-robot"></i> Sistema</span>';
        html += '</td>';

        // Ações
        html += '<td><div class="ta-acoes">';
        if (recusado) {
            // Recusado pela enfermagem — exibir motivo, sem ação disponível
            html += '<span style="color:#6c757d;font-size:11px;"><i class="fas fa-ban"></i> Recusado';
            if (item.dt_recusa) html += ' · ' + escHtml(formatarDataHora(item.dt_recusa));
            html += '</span>';
            if (item.motivo_recusa) {
                html += '<div style="font-size:10px;color:#842029;margin-top:2px;" title="' + escHtml(item.motivo_recusa) + '">'
                      + escHtml(item.motivo_recusa.length > 50 ? item.motivo_recusa.slice(0, 50) + '…' : item.motivo_recusa)
                      + '</div>';
            }
        } else {
            var concluido    = item.status === 'concluido';
            var podeCiencia  = item.status !== 'cancelado' && enf !== 'ciente';
            var podeRecusar  = !concluido && item.status !== 'cancelado' && enf !== 'ciente';

            if (item.slot_id && (enf === 'ciente' || podeCiencia)) {
                if (enf === 'ciente') {
                    html += '<span class="txt-ciente"><i class="fas fa-check-circle"></i> Ciente';
                    if (item.dt_ciencia) html += ' ' + escHtml(formatarDataHora(item.dt_ciencia));
                    html += '</span>';
                } else {
                    // Ciência: disponível mesmo após concluído
                    html += '<button class="btn-ciencia" data-acao="ciencia" data-id="' + item.id + '">'
                          + '<i class="fas fa-check"></i> Ciência</button>';
                    // Recusar: somente enquanto não concluído
                    if (podeRecusar) {
                        html += '<button class="btn-recusar" data-acao="recusar" data-id="' + item.id + '">'
                              + '<i class="fas fa-times"></i> Recusar</button>';
                    }
                }
            } else if (!item.slot_id) {
                html += '<span class="ta-slot-sem"><i class="fas fa-hourglass-half"></i> Sem horário</span>';
            } else {
                html += '<span style="color:var(--texto-sec);font-size:11px;">-</span>';
            }
        }
        html += '</div></td>';

        html += '</tr>';
        return html;
    }

    // ── Utilitários de data para a agenda ──────────
    function pad2(n) { return n < 10 ? '0' + n : '' + n; }

    function chaveData(iso) {
        if (!iso) return 'sem-data';
        try {
            var d = new Date(iso);
            return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
        } catch(e) { return 'sem-data'; }
    }

    function formatarDia(iso) {
        if (!iso) return null;
        try {
            var d = new Date(iso);
            var hoje  = new Date();
            var amnh  = new Date(); amnh.setDate(hoje.getDate() + 1);
            var ontem = new Date(); ontem.setDate(hoje.getDate() - 1);
            var mesmoDia = function(x, y) {
                return x.getDate() === y.getDate()
                    && x.getMonth() === y.getMonth()
                    && x.getFullYear() === y.getFullYear();
            };
            var nomes = ['Domingo','Segunda-feira','Terça-feira','Quarta-feira','Quinta-feira','Sexta-feira','Sábado'];
            var ds = d.toLocaleDateString('pt-BR', {day: '2-digit', month: '2-digit'});
            if (mesmoDia(d, hoje))  return 'Hoje';
            if (mesmoDia(d, amnh))  return 'Amanhã — ' + ds;
            if (mesmoDia(d, ontem)) return 'Ontem — ' + ds;
            return nomes[d.getDay()] + ', ' + ds;
        } catch(e) { return null; }
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

        // Agrupar por dia → setor
        var diasMap = {}, diasOrdem = [];
        for (var m = 0; m < filtrados.length; m++) {
            var ex    = filtrados[m];
            var chave = chaveData(ex.slot_data_hora);
            var sg    = ex.setor_origem_nome || 'Sem setor';
            if (!diasMap[chave]) {
                diasMap[chave] = { label: formatarDia(ex.slot_data_hora), setores: {}, ordemSetores: [] };
                diasOrdem.push(chave);
            }
            if (!diasMap[chave].setores[sg]) {
                diasMap[chave].setores[sg] = [];
                diasMap[chave].ordemSetores.push(sg);
            }
            diasMap[chave].setores[sg].push(ex);
        }

        // Ordenar dias: hoje → futuro (asc) → passado (desc) → sem-data
        var hj = new Date();
        var hojeChave = hj.getFullYear() + '-' + pad2(hj.getMonth()+1) + '-' + pad2(hj.getDate());
        diasOrdem.sort(function(a, b) {
            if (a === b) return 0;
            if (a === 'sem-data') return 1;
            if (b === 'sem-data') return -1;
            var aHoj = a === hojeChave, bHoj = b === hojeChave;
            if (aHoj) return -1; if (bHoj) return 1;
            var aFut = a > hojeChave, bFut = b > hojeChave;
            if (aFut && bFut)   return a < b ? -1 : 1;   // futuro ascendente
            if (!aFut && !bFut) return a > b ? -1 : 1;   // passado descendente
            return aFut ? -1 : 1;                          // futuro antes de passado
        });

        var html = '';
        for (var di = 0; di < diasOrdem.length; di++) {
            var chaveD  = diasOrdem[di];
            var diaInfo = diasMap[chaveD];
            var label   = diaInfo.label || 'Sem horário definido';
            var isHoje  = (chaveD === hojeChave);
            var isFut   = (chaveD !== 'sem-data' && chaveD > hojeChave);
            var isSemDt = (chaveD === 'sem-data');

            // Contagem de pendentes do dia
            var pendDia = 0;
            for (var si2 = 0; si2 < diaInfo.ordemSetores.length; si2++) {
                var lst2 = diaInfo.setores[diaInfo.ordemSetores[si2]];
                for (var pi2 = 0; pi2 < lst2.length; pi2++) {
                    if ((lst2[pi2].status_enfermagem || 'pendente') === 'pendente') pendDia++;
                }
            }

            var diaClass = 'agenda-dia';
            if (isHoje)       diaClass += ' agenda-dia-hoje';
            else if (isFut)   diaClass += ' agenda-dia-futuro';
            else if (isSemDt) diaClass += ' agenda-dia-sem-data';
            else              diaClass += ' agenda-dia-passado';

            var icone = isSemDt ? 'fa-calendar-times' : (isHoje ? 'fa-star' : 'fa-calendar-day');

            html += '<div class="' + diaClass + '">';
            html += '<div class="agenda-dia-header">'
                  + '<span class="agenda-dia-label"><i class="fas ' + icone + '"></i> ' + escHtml(label) + '</span>';
            if (pendDia > 0)
                html += '<span class="agenda-dia-pendentes"><i class="fas fa-clock"></i> ' + pendDia + ' aguard. ciência</span>';
            html += '</div>';

            // Setores dentro do dia
            for (var si = 0; si < diaInfo.ordemSetores.length; si++) {
                var setor = diaInfo.ordemSetores[si];
                var lista = diaInfo.setores[setor];
                var pendCount = 0;
                for (var pi = 0; pi < lista.length; pi++) {
                    if ((lista[pi].status_enfermagem || 'pendente') === 'pendente') pendCount++;
                }
                html += '<div class="setor-grupo">'
                      + '<div class="setor-titulo"><i class="fas fa-hospital-alt"></i> ' + escHtml(setor)
                      + '<span class="setor-count">' + lista.length + '</span>';
                if (pendCount > 0)
                    html += '<span class="setor-pendentes">' + pendCount + ' aguard.</span>';
                html += '</div>';
                html += '<div class="tabela-ag-wrapper"><table class="tabela-ag"><thead><tr>'
                      + '<th>Paciente / Leito</th><th>Procedimento</th><th>Tipo</th>'
                      + '<th>Horário</th><th>Enf.</th><th>Radiologia</th><th>Ações</th>'
                      + '</tr></thead><tbody>';
                for (var ci = 0; ci < lista.length; ci++)
                    html += linhaAgendamentoHtml(lista[ci]);
                html += '</tbody></table></div></div>';
            }

            html += '</div>';  // agenda-dia
        }
        mc.innerHTML = html;
    }

    // ── Carregar ───────────────────────────────────
    function carregar() {
        var url = CONFIG.api.agendamentos + '?data=' + Estado.filtroData;
        if (Estado.filtroStatus !== 'todos') url += '&status_enf=' + Estado.filtroStatus;
        fetch(url, {credentials: 'same-origin'})
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
    function abrirCiencia(id) {
        Estado.modalId = id;
        var item = null;
        for (var i = 0; i < Estado.dados.length; i++) {
            if (Estado.dados[i].id === id) { item = Estado.dados[i]; break; }
        }
        var info = document.getElementById('modal-cien-info');
        if (info && item) {
            info.innerHTML = '<strong>' + escHtml(formatarNome(item.nm_paciente || '')) + '</strong><br>'
                           + '<small>' + escHtml(item.ds_procedimento || '') + '</small>';
            if (item.requer_preparo && item.tipo_preparo) {
                info.innerHTML += '<div class="modal-preparo-alerta">'
                    + '<i class="fas fa-exclamation-triangle"></i>'
                    + '<strong>Preparo necessário:</strong> '
                    + escHtml(item.tipo_preparo)
                    + '</div>';
            }
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
    function abrirRecusar(id) {
        Estado.modalId = id;
        var item = null;
        for (var i = 0; i < Estado.dados.length; i++) {
            if (Estado.dados[i].id === id) { item = Estado.dados[i]; break; }
        }
        var info = document.getElementById('modal-rec-info');
        if (info && item) {
            info.innerHTML = '<strong>' + escHtml(formatarNome(item.nm_paciente || '')) + '</strong><br>'
                           + '<small>' + escHtml(item.ds_procedimento || '') + '</small>';
        }
        var motivo = document.getElementById('modal-rec-motivo');
        if (motivo) motivo.value = '';
        var btn = document.getElementById('modal-rec-confirmar');
        if (btn) btn.disabled = true;
        var contador = document.getElementById('modal-rec-contador');
        if (contador) contador.textContent = '0 / 10 mínimo';
        var hint = document.getElementById('modal-rec-hint');
        if (hint) hint.style.color = '#dc3545';
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
        var motivo   = motivoEl ? motivoEl.value.trim() : '';
        if (motivo.length < 10) { return; }
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
        // Restaurar preferências
        try {
            var ss = localStorage.getItem('p45_setores');
            if (ss) Estado.setoresSelecionados = JSON.parse(ss) || [];
        } catch(e) { Estado.setoresSelecionados = []; }
        Estado.filtroStatus = localStorage.getItem('p45_filtro_status') || 'todos';
        Estado.filtroData   = hojeISO();

        // ── Navegação por data ─────────────────────
        function labelData() {
            var hoje  = hojeISO();
            var ontem = new Date(); ontem.setDate(ontem.getDate() - 1);
            var ontemISO = ontem.getFullYear() + '-' + pad2(ontem.getMonth()+1) + '-' + pad2(ontem.getDate());
            var d    = Estado.filtroData;
            var fmt  = d.slice(8,10) + '/' + d.slice(5,7);
            if (d === hoje)     return 'Hoje — ' + fmt;
            if (d === ontemISO) return 'Ontem — ' + fmt;
            return fmt + '/' + d.slice(0,4);
        }
        function atualizarNavData() {
            var el = document.getElementById('label-data-p45');
            if (el) el.textContent = labelData();
            var btnHoje = document.getElementById('btn-data-hoje');
            if (btnHoje) btnHoje.style.display = Estado.filtroData === hojeISO() ? 'none' : '';
        }
        atualizarNavData();

        var btnAnt = document.getElementById('btn-data-ant');
        if (btnAnt) btnAnt.addEventListener('click', function() {
            var d = new Date(Estado.filtroData + 'T12:00:00');
            d.setDate(d.getDate() - 1);
            Estado.filtroData = d.getFullYear() + '-' + pad2(d.getMonth()+1) + '-' + pad2(d.getDate());
            atualizarNavData(); carregar();
        });
        var btnProx = document.getElementById('btn-data-prox');
        if (btnProx) btnProx.addEventListener('click', function() {
            var d = new Date(Estado.filtroData + 'T12:00:00');
            d.setDate(d.getDate() + 1);
            Estado.filtroData = d.getFullYear() + '-' + pad2(d.getMonth()+1) + '-' + pad2(d.getDate());
            atualizarNavData(); carregar();
        });
        var btnHojeEl = document.getElementById('btn-data-hoje');
        if (btnHojeEl) btnHojeEl.addEventListener('click', function() {
            Estado.filtroData = hojeISO();
            atualizarNavData(); carregar();
        });

        // ── Pills de status ────────────────────────
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
                        carregar();  // busca do servidor com o novo filtro
                    });
                })(pillBtns[pi]);
            }
        }

        // ── Delegação de eventos para ciência/recusar ──
        document.addEventListener('click', function(e) {
            var el = e.target;
            while (el && el !== document.body) {
                var acao = el.getAttribute ? el.getAttribute('data-acao') : null;
                if (acao) {
                    var id = parseInt(el.getAttribute('data-id') || '0', 10);
                    if (acao === 'ciencia') { abrirCiencia(id); return; }
                    if (acao === 'recusar') { abrirRecusar(id); return; }
                }
                el = el.parentNode;
            }
        });

        // ── Botões cabeçalho ───────────────────────
        var btnR = document.getElementById('btn-refresh');
        if (btnR) btnR.addEventListener('click', carregar);
        var btnV = document.getElementById('btn-voltar');
        if (btnV) btnV.addEventListener('click', function() { window.history.back(); });

        // ── Modal ciência (com null-check em cada elemento) ──
        var mCienFechar   = document.getElementById('modal-cien-fechar');
        var mCienCancelar = document.getElementById('modal-cien-cancelar');
        var mCienConf     = document.getElementById('modal-cien-confirmar');
        var mCiencia      = document.getElementById('modal-ciencia');
        if (mCienFechar)   mCienFechar.addEventListener('click', fecharCiencia);
        if (mCienCancelar) mCienCancelar.addEventListener('click', fecharCiencia);
        if (mCienConf)     mCienConf.addEventListener('click', confirmarCiencia);
        if (mCiencia)      mCiencia.addEventListener('click', function(e) {
            if (e.target === this) fecharCiencia();
        });

        // ── Modal recusar (com null-check) ─────────
        var mRecFechar   = document.getElementById('modal-rec-fechar');
        var mRecCancelar = document.getElementById('modal-rec-cancelar');
        var mRecConf     = document.getElementById('modal-rec-confirmar');
        var mRecusar     = document.getElementById('modal-recusar');
        if (mRecFechar)   mRecFechar.addEventListener('click', fecharRecusar);
        if (mRecCancelar) mRecCancelar.addEventListener('click', fecharRecusar);
        if (mRecConf)     mRecConf.addEventListener('click', confirmarRecusar);
        if (mRecusar)     mRecusar.addEventListener('click', function(e) {
            if (e.target === this) fecharRecusar();
        });

        // Contador de caracteres — motivo de recusa
        var motivoRecusaEl = document.getElementById('modal-rec-motivo');
        if (motivoRecusaEl) {
            motivoRecusaEl.addEventListener('input', function() {
                var len = this.value.trim().length;
                var btnConf = document.getElementById('modal-rec-confirmar');
                var cnt     = document.getElementById('modal-rec-contador');
                var hnt     = document.getElementById('modal-rec-hint');
                if (cnt) cnt.textContent = len + ' / 10 mínimo';
                if (hnt) hnt.style.color = len >= 10 ? '#28a745' : '#dc3545';
                if (btnConf) btnConf.disabled = len < 10;
            });
        }

        carregar();
        setInterval(carregar, CONFIG.intervalo);
    }

    window.P45 = { abrirCiencia: abrirCiencia, abrirRecusar: abrirRecusar };

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', inicializar);
    else inicializar();
})();
