(function () {
    'use strict';

    // ── Helpers de data para a agenda ─────────────────────────────────────────

    function chaveData(iso) {
        if (!iso) return 'sem-data';
        try {
            var d   = new Date(iso);
            var p2  = window.P45.pad2;
            return d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate());
        } catch (e) { return 'sem-data'; }
    }

    function formatarDia(iso) {
        if (!iso) return null;
        try {
            var d     = new Date(iso);
            var hoje  = new Date();
            var amnh  = new Date(); amnh.setDate(hoje.getDate() + 1);
            var ontem = new Date(); ontem.setDate(hoje.getDate() - 1);
            var mesmoDia = function (x, y) {
                return x.getDate()     === y.getDate()
                    && x.getMonth()    === y.getMonth()
                    && x.getFullYear() === y.getFullYear();
            };
            var nomes = ['Domingo','Segunda-feira','Terça-feira','Quarta-feira','Quinta-feira','Sexta-feira','Sábado'];
            var ds = d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
            if (mesmoDia(d, hoje))  return 'Hoje';
            if (mesmoDia(d, amnh))  return 'Amanhã — ' + ds;
            if (mesmoDia(d, ontem)) return 'Ontem — ' + ds;
            return nomes[d.getDay()] + ', ' + ds;
        } catch (e) { return null; }
    }

    // ── Pills de setor ────────────────────────────────────────────────────────

    function popularPills() {
        var E       = window.P45.Estado;
        var escHtml = window.P45.escHtml;

        var container = document.getElementById('pills-setor');
        if (!container) return;

        var setores = [], vistos = {};
        for (var i = 0; i < E.dados.length; i++) {
            var s = E.dados[i].setor_origem_nome || '';
            if (s && !vistos[s]) { vistos[s] = true; setores.push(s); }
        }
        setores.sort();

        var todosAtivo = !E.setoresSelecionados.length;
        var html = '<button class="pill' + (todosAtivo ? ' ativo' : '') + '" data-pill="todos">Todos</button>';
        for (var j = 0; j < setores.length; j++) {
            var isAtivo = E.setoresSelecionados.indexOf(setores[j]) >= 0;
            html += '<button class="pill' + (isAtivo ? ' ativo' : '') + '" data-pill="' + escHtml(setores[j]) + '">'
                  + escHtml(setores[j]) + '</button>';
        }
        container.innerHTML = html;

        var btns = container.querySelectorAll('.pill');
        for (var k = 0; k < btns.length; k++) {
            (function (btn) {
                btn.addEventListener('click', function () {
                    var val = btn.getAttribute('data-pill');
                    if (val === 'todos') {
                        E.setoresSelecionados = [];
                    } else {
                        var idx = E.setoresSelecionados.indexOf(val);
                        if (idx >= 0) E.setoresSelecionados.splice(idx, 1);
                        else          E.setoresSelecionados.push(val);
                    }
                    localStorage.setItem('p45_setores', JSON.stringify(E.setoresSelecionados));
                    popularPills();
                    renderizar();
                });
            })(btns[k]);
        }
    }

    // ── Atualizar contadores da barra de stats ────────────────────────────────

    function atualizarContadores(lista) {
        var total = lista.length, urgentes = 0, pendentes = 0, cientes = 0, recusados = 0;
        for (var i = 0; i < lista.length; i++) {
            var it  = lista[i];
            var enf = it.status_enfermagem || 'pendente';
            if (it.prioridade === 'urgente') urgentes++;
            if (enf === 'pendente')  pendentes++;
            else if (enf === 'ciente')   cientes++;
            else if (enf === 'recusado') recusados++;
        }
        var ids = { total: total, urgentes: urgentes, pendentes: pendentes, cientes: cientes, recusados: recusados };
        for (var k in ids) {
            var el = document.getElementById('cnt-' + k);
            if (el) el.textContent = ids[k];
        }
    }

    // ── HTML de uma linha na tabela ───────────────────────────────────────────

    function linhaAgendamentoHtml(item) {
        var escHtml     = window.P45.escHtml;
        var fNome       = window.P45.formatarNome;
        var fDH         = window.P45.formatarDataHora;
        var bEnf        = window.P45.badgeEnf;
        var bTipo       = window.P45.badgeTipo;
        var bRadioSt    = window.P45.badgeRadioStatus;

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
              + escHtml(fNome(item.nm_paciente))
              + '</div>'
              + '<div class="ta-sub"><i class="fas fa-bed"></i> ' + escHtml(item.leito_origem || '-') + '</div>'
              + '</td>';

        // Procedimento + preparo
        html += '<td><div class="ta-proc">' + escHtml(item.ds_procedimento || '-') + '</div>';
        if (item.requer_preparo && item.tipo_preparo) {
            html += '<div class="ta-preparo"><i class="fas fa-exclamation-triangle"></i>'
                  + escHtml(item.tipo_preparo) + '</div>';
        }
        html += '</td>';

        // Tipo
        html += '<td>' + bTipo(item.tipo_exame) + '</td>';

        // Horário
        if (item.slot_data_hora) {
            html += '<td><span class="ta-slot"><i class="fas fa-clock"></i> '
                  + escHtml(fDH(item.slot_data_hora)) + '</span>';
            if (item.slot_modalidade)
                html += ' <span class="badge-modalidade">' + escHtml(item.slot_modalidade) + '</span>';
            html += '</td>';
        } else {
            html += '<td><span class="ta-slot-sem"><i class="fas fa-calendar-times"></i> Aguardando</span></td>';
        }

        // Status Enfermagem
        html += '<td>' + bEnf(enf) + '</td>';

        // Status Radiologia
        html += '<td>' + bRadioSt(item.status);
        if (item.auto_finalizado)
            html += '<br><span class="badge-sistema" title="Concluído automaticamente pelo sistema por falta de ação do usuário"><i class="fas fa-robot"></i> Sistema</span>';
        html += '</td>';

        // Ações
        html += '<td><div class="ta-acoes">';
        if (recusado) {
            html += '<span style="color:#6c757d;font-size:11px;"><i class="fas fa-ban"></i> Recusado';
            if (item.dt_recusa) html += ' · ' + escHtml(fDH(item.dt_recusa));
            html += '</span>';
            if (item.motivo_recusa) {
                html += '<div style="font-size:10px;color:#842029;margin-top:2px;" title="' + escHtml(item.motivo_recusa) + '">'
                      + escHtml(item.motivo_recusa.length > 50 ? item.motivo_recusa.slice(0, 50) + '…' : item.motivo_recusa)
                      + '</div>';
            }
        } else {
            var concluido   = item.status === 'concluido';
            var podeCiencia = item.status !== 'cancelado' && enf !== 'ciente';
            var podeRecusar = !concluido && item.status !== 'cancelado' && enf !== 'ciente';

            if (enf === 'ciente') {
                html += '<span class="txt-ciente"><i class="fas fa-check-circle"></i> Ciente';
                if (item.dt_ciencia) html += ' ' + escHtml(fDH(item.dt_ciencia));
                html += '</span>';
            } else if (item.slot_id && podeCiencia) {
                html += '<button class="btn-ciencia" data-acao="ciencia" data-id="' + item.id + '">'
                      + '<i class="fas fa-check"></i> Ciência</button>';
                if (podeRecusar) {
                    html += '<button class="btn-recusar" data-acao="recusar" data-id="' + item.id + '">'
                          + '<i class="fas fa-times"></i> Recusar</button>';
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

    // ── Renderizar a lista de agendamentos ────────────────────────────────────

    function renderizar() {
        var E       = window.P45.Estado;
        var escHtml = window.P45.escHtml;
        var pad2    = window.P45.pad2;

        var mc = document.getElementById('main-content');
        if (!mc) return;

        popularPills();

        // Aplicar filtros
        var filtrados = [];
        for (var n = 0; n < E.dados.length; n++) {
            var it  = E.dados[n];
            var enf = it.status_enfermagem || 'pendente';
            if (E.setoresSelecionados.length
                && E.setoresSelecionados.indexOf(it.setor_origem_nome || '') < 0) continue;
            if (E.filtroStatus !== 'todos' && enf !== E.filtroStatus) continue;
            filtrados.push(it);
        }

        atualizarContadores(E.dados);

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
        var hojeChave = hj.getFullYear() + '-' + pad2(hj.getMonth() + 1) + '-' + pad2(hj.getDate());
        diasOrdem.sort(function (a, b) {
            if (a === b) return 0;
            if (a === 'sem-data') return 1;
            if (b === 'sem-data') return -1;
            var aHoj = a === hojeChave, bHoj = b === hojeChave;
            if (aHoj) return -1; if (bHoj) return 1;
            var aFut = a > hojeChave, bFut = b > hojeChave;
            if (aFut && bFut)   return a < b ? -1 : 1;
            if (!aFut && !bFut) return a > b ? -1 : 1;
            return aFut ? -1 : 1;
        });

        var html = '';
        for (var di = 0; di < diasOrdem.length; di++) {
            var chaveD  = diasOrdem[di];
            var diaInfo = diasMap[chaveD];
            var label   = diaInfo.label || 'Sem horário definido';
            var isHoje  = (chaveD === hojeChave);
            var isFut   = (chaveD !== 'sem-data' && chaveD > hojeChave);
            var isSemDt = (chaveD === 'sem-data');

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
                for (var ci = 0; ci < lista.length; ci++) html += linhaAgendamentoHtml(lista[ci]);
                html += '</tbody></table></div></div>';
            }
            html += '</div>';
        }
        mc.innerHTML = html;
    }

    window.P45.chaveData             = chaveData;
    window.P45.formatarDia           = formatarDia;
    window.P45.popularPills          = popularPills;
    window.P45.atualizarContadores   = atualizarContadores;
    window.P45.linhaAgendamentoHtml  = linhaAgendamentoHtml;
    window.P45.renderizar            = renderizar;

})();
