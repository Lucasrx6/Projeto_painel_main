/* PAINEL 45 - Radiologia / Enfermagem — ES5 */
(function() {
    'use strict';

    var CONFIG = {
        api: {
            exames:   '/api/paineis/painel45/exames',
            registrar:'/api/paineis/painel45/registrar',
            cancelar: '/api/paineis/painel45/exames/{id}/cancelar'
        },
        intervalo: 45000
    };

    var Estado = {
        dados: [],
        setoresSelecionados: [],   // [] = todos
        filtroSoPendentes: false,
        visualizacao: 'cards',     // 'cards' | 'tabela'
        modalAtendimento: null
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

    // ── Badges ─────────────────────────────────────
    function badgeTasy(item) {
        var s = (item.status_radiologia || '').toUpperCase();
        if (s === 'LAUDADO')
            return '<span class="badge-status badge-laudado"><i class="fas fa-check"></i> Laudado</span>';
        if (s === 'AGUARDANDO')
            return '<span class="badge-status badge-aguardando"><i class="fas fa-clock"></i> Aguardando</span>';
        return '<span class="badge-status badge-sem-laudo"><i class="fas fa-hourglass-half"></i> Sem laudo</span>';
    }

    function badgeRadio(status) {
        var mapa = {
            'pendente':   ['badge-pendente',   'fa-hourglass',      'Pendente'],
            'agendado':   ['badge-agendado',   'fa-calendar-check', 'Agendado'],
            'no_local':   ['badge-no_local',   'fa-map-marker-alt', 'No Local'],
            'executando': ['badge-executando', 'fa-spinner',        'Executando'],
            'concluido':  ['badge-concluido',  'fa-check-double',   'Concluído'],
            'cancelado':  ['badge-cancelado',  'fa-ban',            'Cancelado']
        };
        var m = mapa[status];
        if (!m) return '<span style="font-size:11px;color:#aaa;">—</span>';
        return '<span class="badge-status ' + m[0] + '"><i class="fas ' + m[1] + '"></i> ' + m[2] + '</span>';
    }

    function badgeTransporte(item) {
        if (!item.chamado_id) {
            if (item.requer_transporte === false)
                return '<span style="font-size:11px;color:#aaa;">Portátil</span>';
            return '';
        }
        var s = item.chamado_status || '';
        if (s === 'aguardando' || s === 'aceito')
            return '<span class="badge-transp transp-aguardando"><i class="fas fa-clock"></i> A caminho</span>';
        if (s === 'em_transporte')
            return '<span class="badge-transp transp-em-transporte"><i class="fas fa-running"></i> Em transporte</span>';
        if (s === 'concluido')
            return '<span class="badge-transp transp-concluido"><i class="fas fa-flag-checkered"></i> Chegou</span>';
        return '';
    }

    function acoesHtml(item) {
        if (item.radio_id) {
            var h = '<span class="txt-ja-registrado"><i class="fas fa-check-circle" style="color:#28a745"></i> Registrado</span>';
            if (item.slot_data_hora)
                h += '<div class="slot-agendado-info"><i class="fas fa-clock"></i> ' + formatarHora(item.slot_data_hora) + '</div>';
            if (item.radio_status !== 'concluido' && item.radio_status !== 'cancelado')
                h += '<button class="btn-cancelar-reg" onclick="P45.cancelarReg(' + item.radio_id + ')">'
                   + '<i class="fas fa-times"></i> Cancelar</button>';
            return h;
        }
        var tasy = (item.status_radiologia || '').toUpperCase();
        if (tasy === 'LAUDADO')
            return '<span class="txt-ja-registrado"><i class="fas fa-check-double" style="color:#28a745"></i> Laudado</span>';
        return '<button class="btn-registrar" onclick="P45.abrirRegistrar(\''
             + escHtml(String(item.nr_atendimento || '')) + '\',\''
             + escHtml(item.nm_pessoa_fisica || '') + '\',\''
             + escHtml(item.ds_procedimento || '') + '\')">'
             + '<i class="fas fa-plus"></i> Registrar</button>';
    }

    // ── Pills multi-setor ──────────────────────────
    function popularPills() {
        var container = document.getElementById('pills-setor');
        if (!container) return;

        var setores = [];
        var vistos = {};
        for (var i = 0; i < Estado.dados.length; i++) {
            var s = Estado.dados[i].nm_setor || '';
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
        var total = lista.length, urgentes = 0, pendentes = 0, agendados = 0, concluidos = 0;
        for (var i = 0; i < lista.length; i++) {
            var it = lista[i];
            if (it.radio_prioridade === 'urgente') urgentes++;
            if (!it.radio_id) pendentes++;
            else if (it.radio_status === 'agendado' || it.radio_status === 'no_local') agendados++;
            else if (it.radio_status === 'concluido') concluidos++;
        }
        var ids = {total: total, urgentes: urgentes, pendentes: pendentes, agendados: agendados, concluidos: concluidos};
        for (var k in ids) {
            var el = document.getElementById('cnt-' + k);
            if (el) el.textContent = ids[k];
        }
    }

    // ── Card HTML ──────────────────────────────────
    function cardExHtml(item) {
        var cls = 'card-ex';
        if (item.radio_prioridade === 'urgente') cls += ' card-ex-urgente';
        else if (item.radio_status === 'concluido') cls += ' card-ex-concluido';
        else if (item.radio_id) cls += ' card-ex-registrado';

        var html = '<div class="' + cls + '">';

        html += '<div class="card-ex-header">'
              + '<span class="card-ex-setor">' + escHtml(item.nm_setor || '') + '</span>'
              + (item.radio_prioridade === 'urgente' ? '<span class="badge-urgente">URGENTE</span>' : '')
              + '</div>';

        html += '<div class="card-ex-body">'
              + '<div class="card-ex-nome">' + escHtml(formatarNome(item.nm_pessoa_fisica)) + '</div>'
              + '<div class="card-ex-atnd"><i class="fas fa-hashtag" style="font-size:9px"></i> ' + escHtml(String(item.nr_atendimento || '')) + '</div>'
              + '<div class="card-ex-proc"><i class="fas fa-x-ray"></i> ' + escHtml(item.ds_procedimento || '-') + '</div>'
              + '<div class="card-ex-leito"><i class="fas fa-bed"></i> ' + escHtml(item.leito_base || item.leito || '-') + '</div>'
              + '<div class="card-ex-badges">'
              + badgeTasy(item)
              + (item.radio_id ? ' ' + badgeRadio(item.radio_status) : '')
              + ' ' + badgeTransporte(item)
              + '</div>'
              + '</div>';

        html += '<div class="card-ex-footer">' + acoesHtml(item) + '</div>';
        html += '</div>';
        return html;
    }

    // ── Renderizar ─────────────────────────────────
    function renderizar() {
        var mc = document.getElementById('main-content');
        if (!mc) return;

        popularPills();

        var filtrados = [];
        for (var n = 0; n < Estado.dados.length; n++) {
            var it = Estado.dados[n];
            if (Estado.setoresSelecionados.length && Estado.setoresSelecionados.indexOf(it.nm_setor || '') < 0) continue;
            if (Estado.filtroSoPendentes) {
                if (it.radio_id && it.radio_status !== 'pendente' && it.radio_status !== 'agendado' && it.radio_status !== 'no_local') continue;
            }
            filtrados.push(it);
        }

        atualizarContadores(Estado.dados);

        if (!filtrados.length) {
            mc.innerHTML = '<div class="painel-vazio"><i class="fas fa-x-ray"></i>'
                + '<p>Nenhum exame encontrado.</p></div>';
            return;
        }

        // Agrupar por setor
        var grupos = {}, ordem = [];
        for (var m = 0; m < filtrados.length; m++) {
            var ex = filtrados[m];
            var sg = ex.nm_setor || 'Sem setor';
            if (!grupos[sg]) { grupos[sg] = []; ordem.push(sg); }
            grupos[sg].push(ex);
        }

        var html = '';
        for (var s = 0; s < ordem.length; s++) {
            var setor = ordem[s];
            var lista = grupos[setor];
            html += '<div class="setor-grupo">'
                  + '<div class="setor-titulo"><i class="fas fa-hospital-alt"></i> ' + escHtml(setor)
                  + '<span class="setor-count">' + lista.length + '</span></div>';

            if (Estado.visualizacao === 'cards') {
                html += '<div class="grid-cards-exames">';
                for (var ci = 0; ci < lista.length; ci++) html += cardExHtml(lista[ci]);
                html += '</div>';
            } else {
                html += '<div class="tabela-wrapper"><table class="tabela"><thead><tr>'
                      + '<th>Leito</th><th>Paciente</th><th>Exame</th>'
                      + '<th style="text-align:center">Status Tasy</th>'
                      + '<th style="text-align:center">Controle</th>'
                      + '<th style="text-align:center">Transporte</th>'
                      + '<th style="text-align:center">Ações</th>'
                      + '</tr></thead><tbody>';
                for (var j = 0; j < lista.length; j++) {
                    var e = lista[j];
                    var urgCls = e.radio_prioridade === 'urgente' ? ' linha-urgente' : '';
                    html += '<tr class="' + urgCls + '">';
                    html += '<td><span class="leito-badge">' + escHtml(e.leito_base || e.leito || '-') + '</span></td>';
                    html += '<td><span class="pct-nome">' + escHtml(formatarNome(e.nm_pessoa_fisica)) + '</span>'
                          + '<div class="pct-atnd"><i class="fas fa-hashtag" style="font-size:10px"></i> ' + escHtml(e.nr_atendimento || '') + '</div></td>';
                    html += '<td><div class="exame-nome">' + escHtml(e.ds_procedimento || '-') + '</div>';
                    if (e.requer_transporte === false)
                        html += '<span class="badge-rx-portatil"><i class="fas fa-bed"></i> Portátil</span>';
                    if (e.radio_prioridade === 'urgente')
                        html += ' <span class="badge-urgente">URGENTE</span>';
                    html += '</td>';
                    html += '<td style="text-align:center">' + badgeTasy(e) + '</td>';
                    html += '<td style="text-align:center">' + (e.radio_id ? badgeRadio(e.radio_status) : '<span style="font-size:11px;color:#aaa;">—</span>') + '</td>';
                    html += '<td style="text-align:center">' + badgeTransporte(e) + '</td>';
                    html += '<td style="text-align:center">' + acoesHtml(e) + '</td>';
                    html += '</tr>';
                }
                html += '</tbody></table></div>';
            }
            html += '</div>';
        }
        mc.innerHTML = html;
    }

    // ── Carregar ───────────────────────────────────
    function mostrarErro(msg) {
        var mc = document.getElementById('main-content');
        if (mc) mc.innerHTML = '<div class="painel-vazio"><i class="fas fa-exclamation-triangle"></i><p>' + msg + '</p></div>';
    }

    function carregar() {
        fetch(CONFIG.api.exames, {credentials: 'same-origin'})
            .then(function(r) { return r.json(); })
            .then(function(d) {
                if (d.success) {
                    Estado.dados = d.dados || d.data || [];
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
                mostrarErro('Erro de conexão com o servidor.');
                toast('Erro ao carregar dados', 'error');
            });
    }

    // ── Modal registrar ────────────────────────────
    function abrirRegistrar(nr, nome, exame) {
        Estado.modalAtendimento = nr;
        var info = document.getElementById('modal-reg-info');
        if (info) {
            info.innerHTML = '<strong>' + escHtml(formatarNome(nome)) + '</strong><br>'
                           + '<small>' + escHtml(exame) + ' · Atend. ' + escHtml(String(nr)) + '</small>';
        }
        var obs = document.getElementById('modal-reg-obs');
        if (obs) obs.value = '';
        var sel = document.getElementById('modal-reg-prioridade');
        if (sel) sel.value = 'normal';
        var modal = document.getElementById('modal-registrar');
        if (modal) modal.style.display = 'flex';
    }

    function fecharModal() {
        var modal = document.getElementById('modal-registrar');
        if (modal) modal.style.display = 'none';
    }

    function confirmarRegistrar() {
        var prioridade = document.getElementById('modal-reg-prioridade').value;
        var obs = document.getElementById('modal-reg-obs').value.trim();
        var btn = document.getElementById('modal-reg-confirmar');
        if (btn) btn.disabled = true;

        var exame = null;
        for (var i = 0; i < Estado.dados.length; i++) {
            if (String(Estado.dados[i].nr_atendimento) === String(Estado.modalAtendimento)) {
                exame = Estado.dados[i]; break;
            }
        }
        if (!exame) { toast('Exame não encontrado.', 'error'); if (btn) btn.disabled = false; return; }

        fetch(CONFIG.api.registrar, {
            method: 'POST', credentials: 'same-origin',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({
                nr_atendimento:    exame.nr_atendimento,
                nr_prescricao:     exame.nr_prescricao || null,
                ds_procedimento:   exame.ds_procedimento,
                nm_paciente:       exame.nm_pessoa_fisica,
                leito_origem:      exame.leito_base || exame.leito,
                setor_origem_nome: exame.nm_setor,
                cd_setor:          exame.cd_setor_atendimento,
                nm_medico:         exame.nm_medico || '',
                prioridade:        prioridade,
                observacao:        obs
            })
        })
        .then(function(r) { return r.json(); })
        .then(function(d) {
            fecharModal();
            if (d.success) { toast('Exame registrado para radiologia!', 'success'); carregar(); }
            else toast('Erro: ' + (d.error || 'Falha ao registrar'), 'error');
        })
        .catch(function(e) { console.error('[P45]', e); toast('Erro de conexão', 'error'); })
        .finally(function() { if (btn) btn.disabled = false; });
    }

    function cancelarReg(radioId) {
        if (!confirm('Cancelar este registro de radiologia?')) return;
        fetch(CONFIG.api.cancelar.replace('{id}', radioId), {
            method: 'PUT', credentials: 'same-origin',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({motivo: 'Cancelado pela enfermagem'})
        })
        .then(function(r) { return r.json(); })
        .then(function(d) {
            if (d.success) { toast('Registro cancelado.', 'warning'); carregar(); }
            else toast('Erro: ' + (d.error || 'Falha'), 'error');
        })
        .catch(function(e) { console.error('[P45]', e); toast('Erro de conexão', 'error'); });
    }

    // ── Inicializar ────────────────────────────────
    function inicializar() {
        // Restaurar preferências
        try {
            var ss = localStorage.getItem('p45_setores');
            if (ss) Estado.setoresSelecionados = JSON.parse(ss) || [];
        } catch(e) { Estado.setoresSelecionados = []; }

        Estado.filtroSoPendentes = localStorage.getItem('p45_pendentes') === '1';
        Estado.visualizacao = localStorage.getItem('p45_view') || 'cards';

        // View toggle
        var btnCards  = document.getElementById('btn-view-cards');
        var btnTabela = document.getElementById('btn-view-tabela');
        function atualizarBotoesView() {
            if (btnCards)  btnCards.className  = 'btn-view' + (Estado.visualizacao === 'cards'  ? ' ativo' : '');
            if (btnTabela) btnTabela.className = 'btn-view' + (Estado.visualizacao === 'tabela' ? ' ativo' : '');
        }
        atualizarBotoesView();
        if (btnCards) btnCards.addEventListener('click', function() {
            Estado.visualizacao = 'cards';
            localStorage.setItem('p45_view', 'cards');
            atualizarBotoesView();
            renderizar();
        });
        if (btnTabela) btnTabela.addEventListener('click', function() {
            Estado.visualizacao = 'tabela';
            localStorage.setItem('p45_view', 'tabela');
            atualizarBotoesView();
            renderizar();
        });

        // Checkbox pendentes
        var chk = document.getElementById('toggle-pendentes');
        if (chk) {
            chk.checked = Estado.filtroSoPendentes;
            chk.addEventListener('change', function() {
                Estado.filtroSoPendentes = this.checked;
                localStorage.setItem('p45_pendentes', this.checked ? '1' : '0');
                renderizar();
            });
        }

        // Botões cabeçalho
        var btnR = document.getElementById('btn-refresh');
        if (btnR) btnR.addEventListener('click', carregar);
        var btnV = document.getElementById('btn-voltar');
        if (btnV) btnV.addEventListener('click', function() { window.history.back(); });

        // Modal
        document.getElementById('modal-reg-fechar').addEventListener('click', fecharModal);
        document.getElementById('modal-reg-cancelar').addEventListener('click', fecharModal);
        document.getElementById('modal-reg-confirmar').addEventListener('click', confirmarRegistrar);
        document.getElementById('modal-registrar').addEventListener('click', function(e) {
            if (e.target === this) fecharModal();
        });

        carregar();
        setInterval(carregar, CONFIG.intervalo);
    }

    window.P45 = { abrirRegistrar: abrirRegistrar, cancelarReg: cancelarReg };

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', inicializar);
    else inicializar();
})();
