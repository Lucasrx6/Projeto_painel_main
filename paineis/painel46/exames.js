(function () {
    'use strict';

    // ── Pills de setor (aba Exames) ───────────────────────────────────────────

    function popularPillsExames(dados) {
        var E         = window.P46.Estado;
        var escHtml   = window.P46.escHtml;
        var container = document.getElementById('exames-pills-setor');
        if (!container) return;

        var setores = [], vistos = {};
        for (var i = 0; i < dados.length; i++) {
            var nm = dados[i].nm_setor || '';
            if (nm && !vistos[nm]) { vistos[nm] = true; setores.push(nm); }
        }
        setores.sort();

        var todosAtivo = !E.setoresExamesSelecionados.length;
        var html = '<button class="pill' + (todosAtivo ? ' ativo' : '') + '" data-pill="todos">Todos</button>';
        for (var j = 0; j < setores.length; j++) {
            var isAtivo = E.setoresExamesSelecionados.indexOf(setores[j]) >= 0;
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
                        E.setoresExamesSelecionados = [];
                    } else {
                        var idx = E.setoresExamesSelecionados.indexOf(val);
                        if (idx >= 0) E.setoresExamesSelecionados.splice(idx, 1);
                        else          E.setoresExamesSelecionados.push(val);
                    }
                    popularPillsExames(E.exames);
                    renderizarExamesRadio();
                });
            })(btns[k]);
        }
    }

    // ── Pills de tipo de exame ────────────────────────────────────────────────

    function inicializarPillsTipo() {
        var E         = window.P46.Estado;
        var container = document.getElementById('exames-pills-tipo');
        if (!container) return;
        var btns = container.querySelectorAll('.pill-tipo');
        for (var i = 0; i < btns.length; i++) {
            (function (btn) {
                btn.addEventListener('click', function () {
                    E.filtroTipoExame = btn.getAttribute('data-tipo') || '';
                    var todos = container.querySelectorAll('.pill-tipo');
                    for (var j = 0; j < todos.length; j++) {
                        todos[j].className = todos[j].className.replace(' ativo', '')
                            + (todos[j].getAttribute('data-tipo') === E.filtroTipoExame ? ' ativo' : '');
                    }
                    renderizarExamesRadio();
                });
            })(btns[i]);
        }
    }

    // ── HTML de um card de prescrição ─────────────────────────────────────────

    function cardExameHtml(ex) {
        var escHtml      = window.P46.escHtml;
        var formatarNome = window.P46.formatarNome;
        var formatarHora = window.P46.formatarHora;
        var formatarDH   = window.P46.formatarDataHora;
        var badgeTipo    = window.P46.badgeTipoExame;
        var badgeEnf     = window.P46.badgeStatusEnf;
        var badgeSt      = window.P46.badgeStatus;

        var radioId          = ex.radio_id;
        var radioSt          = ex.radio_status || '';
        var slotHora         = ex.slot_data_hora ? formatarHora(ex.slot_data_hora) : '';
        var urgente          = ex.ie_urgente === 'S' || ex.radio_prioridade === 'urgente';
        var concluidoInterno = !!ex.concluido_interno;

        var cls = 'card-ex';
        if (concluidoInterno)                                     cls += ' card-ex-concluido';
        else if (urgente)                                         cls += ' card-ex-urgente';
        else if (radioSt === 'concluido')                         cls += ' card-ex-concluido';
        else if (radioId)                                         cls += ' card-ex-registrado';
        if (!concluidoInterno && ex.status_enfermagem === 'recusado') cls += ' card-ex-enf-recusado';

        var html = '<div class="' + cls + '">';

        // Cabeçalho do card
        html += '<div class="card-ex-header">'
              + '<span class="card-ex-setor">' + escHtml(ex.nm_setor || '') + '</span>'
              + (urgente && !concluidoInterno ? '<span class="badge-urgente">URGENTE</span>' : '')
              + '</div>';

        // Corpo do card
        html += '<div class="card-ex-body">'
              + '<div class="card-ex-nome">' + escHtml(formatarNome(ex.nm_pessoa_fisica)) + '</div>'
              + '<div class="card-ex-atnd"><i class="fas fa-hashtag" style="font-size:9px"></i> ' + escHtml(String(ex.nr_atendimento || '')) + '</div>'
              + '<div class="card-ex-proc"><i class="fas fa-x-ray"></i> ' + escHtml(ex.ds_procedimento || '-') + '</div>'
              + '<div class="card-ex-leito"><i class="fas fa-bed"></i> ' + escHtml(ex.leito || ex.leito_base || '-') + '</div>'
              + (ex.nr_prescricao ? '<div class="card-ex-atnd"><i class="fas fa-file-medical-alt" style="font-size:9px"></i> Nr. Presc.: ' + escHtml(String(ex.nr_prescricao)) + '</div>' : '')
              + (ex.dt_pedido ? '<div class="card-ex-atnd"><i class="fas fa-calendar-alt" style="font-size:9px"></i> Dt. Pedido: ' + formatarDH(ex.dt_pedido) + '</div>' : '');

        html += '<div class="card-ex-badges">';
        html += badgeTipo(ex.tipo_exame);
        if (concluidoInterno) {
            html += '<span class="badge-status badge-concluido"><i class="fas fa-check-double"></i> Concluído</span>';
            if (ex.auto_finalizado_sistema)
                html += '<span class="badge-sistema" title="Concluído automaticamente pelo sistema por falta de ação do usuário"><i class="fas fa-robot"></i> Sistema</span>';
            else
                html += '<span class="badge-status" style="background:#dee2e6;color:#6c757d;font-size:10px;">'
                      + '<i class="fas fa-sync-alt"></i> Aguard. Tasy</span>';
        } else if (radioId) {
            html += ' ' + badgeSt(radioSt);
            if (slotHora) html += '<span class="badge-slot-hora"><i class="fas fa-clock"></i> ' + slotHora + '</span>';
        } else {
            html += '<span class="badge-status badge-presc-sem-ag"><i class="fas fa-calendar-plus"></i> Sem agendamento</span>';
        }
        html += '</div>';

        if (!concluidoInterno && radioId && ex.requer_preparo && ex.radio_preparo)
            html += '<div class="card-ex-preparo"><i class="fas fa-flask"></i> <strong>Preparo:</strong> ' + escHtml(ex.radio_preparo) + '</div>';

        if (!concluidoInterno && radioId) {
            var enfStEx = ex.status_enfermagem;
            if (enfStEx === 'ciente' || enfStEx === 'recusado') {
                html += '<div class="card-enf-row" style="margin-top:2px">' + badgeEnf(enfStEx) + '</div>';
                if (enfStEx === 'recusado' && ex.motivo_recusa)
                    html += '<div class="card-ex-recusa"><i class="fas fa-exclamation-circle"></i> ' + escHtml(ex.motivo_recusa) + '</div>';
            }
        }

        html += '</div>';  // card-ex-body

        // Rodapé do card (ações)
        var _nr  = escHtml(String(ex.nr_atendimento || ''));
        var _nrp = escHtml(String(ex.nr_prescricao  || ''));

        html += '<div class="card-ex-footer">';
        if (concluidoInterno) {
            html += '<span style="font-size:11px;color:#6c757d;padding:5px 0;"><i class="fas fa-info-circle"></i> Aguardando atualização do Tasy</span>';
        } else if (radioId) {
            if (radioSt === 'pendente' || radioSt === 'agendado')
                html += '<button class="btn-card-acao btn-no-local" onclick="P46.atualizarStatus(' + radioId + ',\'no_local\')" style="font-size:11px;padding:5px 9px"><i class="fas fa-map-marker-alt"></i> Chegou</button>';
            if (radioSt === 'no_local')
                html += '<button class="btn-card-acao btn-executando" onclick="P46.atualizarStatus(' + radioId + ',\'executando\')" style="font-size:11px;padding:5px 9px"><i class="fas fa-play"></i> Iniciar</button>';
            if (radioSt === 'executando')
                html += '<button class="btn-card-acao btn-concluir" onclick="P46.atualizarStatus(' + radioId + ',\'concluido\')" style="font-size:11px;padding:5px 9px"><i class="fas fa-check"></i> Concluir</button>';
            if (radioSt !== 'concluido' && radioSt !== 'cancelado')
                html += '<button class="btn-card-acao btn-agendar-presc" onclick="P46.abrirAgendarPresc(\'' + _nr + '\',\'' + _nrp + '\')" style="font-size:11px;padding:5px 9px">'
                      + '<i class="fas fa-calendar-alt"></i> Reagendar</button>';
            if (radioSt !== 'concluido' && radioSt !== 'cancelado')
                html += '<button class="btn-card-acao btn-cancelar-card" onclick="P46.atualizarStatus(' + radioId + ',\'cancelado\')" style="font-size:11px;padding:5px 9px"><i class="fas fa-times"></i></button>';
        } else {
            html += '<button class="btn-card-acao btn-agendar-presc-novo" onclick="P46.abrirAgendarPresc(\'' + _nr + '\',\'' + _nrp + '\')">'
                  + '<i class="fas fa-calendar-plus"></i> Agendar</button>';
        }
        html += '</div></div>';
        return html;
    }

    // ── Renderizar exames/prescrições ─────────────────────────────────────────

    function renderizarExamesRadio() {
        var E       = window.P46.Estado;
        var escHtml = window.P46.escHtml;
        var badgeSt = window.P46.badgeStatus;
        var fNome   = window.P46.formatarNome;
        var fHora   = window.P46.formatarHora;
        var fDH     = window.P46.formatarDataHora;

        var loading  = document.getElementById('exames-loading');
        var vazio    = document.getElementById('exames-vazio');
        var conteudo = document.getElementById('exames-conteudo');
        if (loading) loading.style.display = 'none';

        var dados = E.exames;

        // Contador de ocultos
        var contOcultos = 0;
        for (var oi = 0; oi < dados.length; oi++) {
            var stO = (dados[oi].status_radiologia || '').toUpperCase();
            if ((stO && stO !== 'AGUARDANDO') || dados[oi].concluido_interno) contOcultos++;
        }
        var badgeEl = document.getElementById('badge-exames-ocultos');
        var labelEl = document.getElementById('label-toggle-exames');
        var iconEl  = document.getElementById('icon-toggle-exames');
        if (badgeEl) { badgeEl.textContent = contOcultos; badgeEl.style.display = (!E.mostrarTodosExames && contOcultos > 0) ? '' : 'none'; }
        if (labelEl) labelEl.textContent = E.mostrarTodosExames ? 'Apenas pendentes' : 'Ver realizados';
        if (iconEl)  iconEl.className    = 'fas ' + (E.mostrarTodosExames ? 'fa-eye-slash' : 'fa-eye');

        // Aplicar filtros
        var filtrados = [];
        for (var i = 0; i < dados.length; i++) {
            var ex = dados[i];
            if (E.setoresExamesSelecionados.length && E.setoresExamesSelecionados.indexOf(ex.nm_setor || '') < 0) continue;
            if (E.filtroTipoExame && ex.tipo_exame !== E.filtroTipoExame) continue;
            if (E.filtroSemControle && ex.radio_id) continue;
            if (!E.mostrarTodosExames) {
                var stEx = (ex.status_radiologia || '').toUpperCase();
                if ((stEx && stEx !== 'AGUARDANDO') || ex.concluido_interno) continue;
            }
            filtrados.push(ex);
        }

        if (!filtrados.length) {
            if (vazio)    vazio.style.display    = '';
            if (conteudo) conteudo.style.display = 'none';
            return;
        }
        if (vazio) vazio.style.display = 'none';

        // Agrupar por setor
        var grupos = {}, ordem = [];
        for (var j = 0; j < filtrados.length; j++) {
            var nm = filtrados[j].nm_setor || 'Sem setor';
            if (!grupos[nm]) { grupos[nm] = []; ordem.push(nm); }
            grupos[nm].push(filtrados[j]);
        }

        var html = '';
        for (var k = 0; k < ordem.length; k++) {
            var setor = ordem[k];
            var itens = grupos[setor];
            html += '<div class="setor-grupo">';
            html += '<div class="setor-titulo"><i class="fas fa-hospital-alt"></i> ' + escHtml(setor)
                  + '<span class="setor-count">' + itens.length + '</span></div>';

            if (E.visualizacaoExames === 'cards') {
                html += '<div class="grid-cards-exames">';
                for (var ci = 0; ci < itens.length; ci++) html += cardExameHtml(itens[ci]);
                html += '</div>';
            } else {
                html += '<div class="tabela-wrapper"><table class="tabela-exames">';
                html += '<thead><tr><th>Paciente</th><th>Leito</th><th>Exame</th><th>Nr. Presc.</th><th>Dt. Pedido</th><th>Status</th><th>Ações</th></tr></thead><tbody>';
                for (var m = 0; m < itens.length; m++) {
                    var item = itens[m];
                    var rid  = item.radio_id;
                    var rst  = item.radio_status || '';
                    var _nr  = escHtml(String(item.nr_atendimento || ''));
                    var _nrp = escHtml(String(item.nr_prescricao  || ''));
                    html += '<tr>';
                    html += '<td><div class="pct-nome">' + escHtml(fNome(item.nm_pessoa_fisica)) + '</div>'
                          + '<div class="pct-atnd"># ' + escHtml(item.nr_atendimento || '') + '</div></td>';
                    html += '<td><span class="leito-badge">' + escHtml(item.leito || item.leito_base || '-') + '</span></td>';
                    html += '<td><div class="exame-nome">' + escHtml(item.ds_procedimento || '-') + '</div></td>';
                    html += '<td><div class="pct-atnd">' + escHtml(String(item.nr_prescricao || '-')) + '</div></td>';
                    html += '<td><div class="pct-atnd">' + (item.dt_pedido ? fDH(item.dt_pedido) : '-') + '</div></td>';
                    if (rid) {
                        html += '<td>' + badgeSt(rst)
                              + (item.slot_data_hora ? '<div class="pct-atnd"><i class="fas fa-clock"></i> ' + fHora(item.slot_data_hora) + '</div>' : '')
                              + '</td>';
                        html += '<td style="white-space:nowrap;">';
                        if (rst === 'pendente' || rst === 'agendado')
                            html += '<button class="btn-card-acao btn-no-local" onclick="P46.atualizarStatus(' + rid + ',\'no_local\')" style="padding:4px 8px;font-size:11px"><i class="fas fa-map-marker-alt"></i> Chegou</button> ';
                        if (rst === 'no_local')
                            html += '<button class="btn-card-acao btn-executando" onclick="P46.atualizarStatus(' + rid + ',\'executando\')" style="padding:4px 8px;font-size:11px"><i class="fas fa-play"></i> Iniciar</button> ';
                        if (rst === 'executando')
                            html += '<button class="btn-card-acao btn-concluir" onclick="P46.atualizarStatus(' + rid + ',\'concluido\')" style="padding:4px 8px;font-size:11px"><i class="fas fa-check"></i> Concluir</button> ';
                        if (rst !== 'concluido' && rst !== 'cancelado')
                            html += '<button class="btn-card-acao btn-agendar-presc" onclick="P46.abrirAgendarPresc(\'' + _nr + '\',\'' + _nrp + '\')" style="padding:4px 8px;font-size:11px"><i class="fas fa-calendar-alt"></i> Reagendar</button> ';
                        if (rst !== 'concluido' && rst !== 'cancelado')
                            html += '<button class="btn-card-acao btn-cancelar-card" onclick="P46.atualizarStatus(' + rid + ',\'cancelado\')" style="padding:4px 8px;font-size:11px"><i class="fas fa-times"></i></button>';
                        html += '</td>';
                    } else if (item.concluido_interno) {
                        html += '<td><span class="badge-status badge-concluido"><i class="fas fa-check-double"></i> Concluído</span>';
                        if (item.auto_finalizado_sistema)
                            html += ' <span class="badge-sistema" title="Concluído automaticamente pelo sistema"><i class="fas fa-robot"></i> Sistema</span>';
                        html += '</td><td style="color:#6c757d;font-size:11px">—</td>';
                    } else {
                        html += '<td><span class="badge-status badge-presc-sem-ag"><i class="fas fa-calendar-plus"></i> Sem agendamento</span></td>';
                        html += '<td><button class="btn-card-acao btn-agendar-presc-novo" onclick="P46.abrirAgendarPresc(\'' + _nr + '\',\'' + _nrp + '\')" style="padding:4px 8px;font-size:11px"><i class="fas fa-calendar-plus"></i> Agendar</button></td>';
                    }
                    html += '</tr>';
                }
                html += '</tbody></table></div>';
            }
            html += '</div>';
        }

        if (conteudo) {
            conteudo.innerHTML = html;
            conteudo.style.display = 'flex';
            conteudo.style.flexDirection = 'column';
            conteudo.style.gap = '16px';
        }
    }

    // ── Carregar exames/prescrições da API ────────────────────────────────────

    function carregarExamesRadio() {
        var E = window.P46.Estado;
        if (E.carregandoExames) return;
        E.carregandoExames = true;

        var loading  = document.getElementById('exames-loading');
        var vazio    = document.getElementById('exames-vazio');
        var conteudo = document.getElementById('exames-conteudo');
        if (loading)  loading.style.display  = '';
        if (vazio)    vazio.style.display    = 'none';
        if (conteudo) conteudo.style.display = 'none';

        fetch(window.P46.CONFIG.api.prescricoes, { credentials: 'same-origin' })
            .then(function (r) { return r.json(); })
            .then(function (d) {
                if (d.success) {
                    E.exames = d.data || [];
                    popularPillsExames(E.exames);
                } else {
                    E.exames = [];
                    window.P46.toast('Erro ao carregar prescrições: ' + (d.error || 'Falha'), 'error');
                }
                renderizarExamesRadio();
                E.carregandoExames = false;
            })
            .catch(function (e) {
                console.error('[P46] exames:', e);
                E.exames = [];
                if (loading) loading.style.display = 'none';
                if (vazio)   vazio.style.display   = '';
                window.P46.toast('Erro de conexão ao carregar exames', 'error');
                E.carregandoExames = false;
            });
    }

    window.P46.popularPillsExames    = popularPillsExames;
    window.P46.inicializarPillsTipo  = inicializarPillsTipo;
    window.P46.cardExameHtml         = cardExameHtml;
    window.P46.renderizarExamesRadio = renderizarExamesRadio;
    window.P46.carregarExamesRadio   = carregarExamesRadio;

})();
