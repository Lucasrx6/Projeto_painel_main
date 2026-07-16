/* PAINEL 46 - Radiologia (Tela Operacional) — ES5 */
(function() {
    'use strict';

    var CONFIG = {
        api: {
            fila:            '/api/paineis/painel46/fila',
            slots:           '/api/paineis/painel46/slots',
            slotsLote:       '/api/paineis/painel46/slots/lote',
            exameStatus:     '/api/paineis/painel46/exames/{id}/status',
            agendar:         '/api/paineis/painel46/exames/{id}/agendar',
            slotUpdate:      '/api/paineis/painel46/slots/{id}',
            slotDelete:      '/api/paineis/painel46/slots/{id}',
            prescricoes:     '/api/paineis/painel46/prescricoes',
            agendarPrescricao: '/api/paineis/painel46/agendar-prescricao',
            agendarLote:     '/api/paineis/painel46/agendar-lote',
            slotsPorTipo:    '/api/paineis/painel46/slots-por-tipo',
            slotDesvincular: '/api/paineis/painel46/slots/{id}/desvincular'
        },
        intervalo: 45000
    };

    var Estado = {
        tabAtiva: 'fila',
        dataConsulta: (function() { var d = new Date(); return d.getFullYear() + '-' + ('0'+(d.getMonth()+1)).slice(-2) + '-' + ('0'+d.getDate()).slice(-2); })(),
        fila: { agendados: [], pendentes: [], recusados: [] },
        filaRecusadosAberto: false,
        slots: [],
        exames: [],
        setoresExamesSelecionados: [],
        filtroTipoExame: '',             // '' | 'RX' | 'RM' | 'TC' | 'USG' | 'MAM' | 'OUTROS'
        filtroModalidade: '',            // filtro ativo na aba Agenda
        filtroSemControle: false,
        mostrarTodosExames: false,
        visualizacaoExames: 'cards',
        carregandoFila: false,
        carregandoExames: false,
        _vincularSlotId: null,
        _vincularCandidatos: [],
        // Scheduling modal
        modalAgendPresc: null,           // prescrição selecionada
        modalAgendSlotId: null,          // slot selecionado
        slotsDisponiveis: [],
        // Modal de irmãos (outros exames do mesmo paciente)
        irmaosPresc: null,               // prescrição principal recém-agendada
        irmaosSlotInfo: null             // { data_hora, duracao_min, modalidade }
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

    // Converte 'YYYY-MM-DD' → 'DD/MM/AAAA' (exibição)
    function isoParaDisplay(iso) {
        if (!iso || iso.length < 10) return '';
        return iso.slice(8, 10) + '/' + iso.slice(5, 7) + '/' + iso.slice(0, 4);
    }
    // Converte 'DD/MM/AAAA' → 'YYYY-MM-DD' (API)
    function displayParaISO(str) {
        if (!str) return '';
        var p = str.split('/');
        if (p.length !== 3 || p[2].length < 4) return '';
        return p[2] + '-' + ('0' + p[1]).slice(-2) + '-' + ('0' + p[0]).slice(-2);
    }
    // Data de hoje no fuso local (sem confusão UTC)
    function hojeISO() {
        var d = new Date();
        return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2);
    }

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

    // ── Badges auxiliares ──────────────────────────
    function badgeTipoExame(tipo) {
        var cores = {
            'RX':    ['#0d6efd', '#cfe2ff'],
            'RM':    ['#6f42c1', '#e2d9f3'],
            'TC':    ['#0dcaf0', '#cff4fc'],
            'USG':   ['#198754', '#d1e7dd'],
            'MAM':   ['#fd7e14', '#ffe5d0'],
            'OUTROS':['#6c757d', '#e2e3e5']
        };
        if (!tipo) return '';
        var c = cores[tipo] || cores['OUTROS'];
        return '<span class="badge-tipo-ex" style="background:' + c[1] + ';color:' + c[0] + ';border-color:' + c[0] + '">'
             + escHtml(tipo) + '</span>';
    }

    function badgeStatusEnf(enf) {
        if (!enf || enf === 'pendente')
            return '<span class="badge-enf badge-enf-pendente"><i class="fas fa-clock"></i> Aguard. Ciência</span>';
        if (enf === 'ciente')
            return '<span class="badge-enf badge-enf-ciente"><i class="fas fa-check"></i> Ciente</span>';
        if (enf === 'recusado')
            return '<span class="badge-enf badge-enf-recusado"><i class="fas fa-times"></i> Recusado</span>';
        return '';
    }

    // ── Tabs ───────────────────────────────────────
    function mudarTab(tab) {
        Estado.tabAtiva = tab;

        var abas = document.querySelectorAll('.aba');
        for (var i = 0; i < abas.length; i++) {
            var a = abas[i];
            a.className = a.getAttribute('data-aba') === tab ? 'aba aba-ativa' : 'aba';
        }

        var fila   = document.getElementById('aba-fila');
        var exames = document.getElementById('aba-exames');
        var agenda = document.getElementById('aba-agenda');
        if (fila)   fila.style.display   = tab === 'fila'   ? '' : 'none';
        if (exames) exames.style.display = tab === 'exames' ? '' : 'none';
        if (agenda) agenda.style.display = tab === 'agenda' ? '' : 'none';

        var navData     = document.getElementById('nav-data');
        var agendaAcoes = document.getElementById('agenda-acoes');
        if (navData)     navData.style.display     = tab === 'agenda' ? 'flex' : 'none';
        if (agendaAcoes) agendaAcoes.style.display = tab === 'agenda' ? 'flex' : 'none';

        if (DOM.labelData) DOM.labelData.textContent = labelData(Estado.dataConsulta);

        if (tab === 'agenda') carregarSlots();
        if (tab === 'exames') carregarExamesRadio();
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

    function linhaPacienteHtml(item) {
        var urgente = item.prioridade === 'urgente';
        var enfSt   = item.status_enfermagem;
        var rowCls  = 'linha-pac';
        if (urgente)                     rowCls += ' linha-urgente';
        if (item.status === 'concluido') rowCls += ' linha-concluido';
        if (enfSt === 'recusado')        rowCls += ' linha-recusado';

        var html = '<tr class="' + rowCls + '">';

        // Col: Paciente
        html += '<td>';
        if (urgente) html += '<i class="fas fa-bolt" style="color:#dc3545;margin-right:4px;font-size:11px;"></i>';
        html += '<div class="ta-nome">' + escHtml(formatarNome(item.nm_paciente)) + '</div>'
              + '<div class="ta-sub"># ' + escHtml(item.nr_atendimento || '') + '</div>';
        html += '</td>';

        // Col: Exame
        html += '<td><div class="ta-proc">' + escHtml(item.ds_procedimento || '-') + '</div>';
        if (item.tipo_exame) html += badgeTipoExame(item.tipo_exame);
        if (item.requer_preparo && item.tipo_preparo)
            html += '<div class="ta-sub" style="color:#5a3e00;background:#fff3cd;border-radius:3px;padding:1px 4px;margin-top:2px;">'
                  + '<i class="fas fa-flask"></i> ' + escHtml(item.tipo_preparo) + '</div>';
        html += '</td>';

        // Col: Leito / Setor
        html += '<td>';
        if (item.leito_origem)
            html += '<span class="leito-badge">' + escHtml(item.leito_origem) + '</span><br>';
        if (item.setor_origem_nome)
            html += '<span class="ta-sub">' + escHtml(item.setor_origem_nome) + '</span>';
        html += '</td>';

        // Col: Horário
        html += '<td>';
        if (item.slot_data_hora) {
            html += '<span class="ta-slot">' + formatarHora(item.slot_data_hora) + '</span>';
            if (item.slot_modalidade) html += '<div class="ta-sub">' + escHtml(item.slot_modalidade) + '</div>';
        } else {
            html += '<span class="ta-slot-sem">Sem slot</span>';
        }
        html += '</td>';

        // Col: Status
        html += '<td>' + badgeStatus(item.status);
        if (item.auto_finalizado)
            html += '<br><span class="badge-sistema" title="Concluído automaticamente pelo sistema por falta de ação do usuário"><i class="fas fa-robot"></i> Sistema</span>';
        var trBadge = badgeTransporte(item);
        if (trBadge) html += '<br>' + trBadge;
        html += '</td>';

        // Col: Enf.
        html += '<td>';
        if (enfSt === 'ciente' || enfSt === 'recusado') {
            html += badgeStatusEnf(enfSt);
            if (enfSt === 'recusado' && item.motivo_recusa)
                html += ' <span title="' + escHtml(item.motivo_recusa) + '" style="cursor:help;">'
                      + '<i class="fas fa-exclamation-circle" style="color:#842029;"></i></span>';
        } else if (item.status === 'agendado' && enfSt === 'pendente') {
            html += badgeStatusEnf('pendente');
        } else {
            html += '<span style="color:#adb5bd;font-size:11px;">—</span>';
        }
        html += '</td>';

        // Col: Ações
        html += '<td><div class="ta-acoes">';
        if (item.status === 'pendente' || item.status === 'agendado')
            html += '<button class="btn-card-acao btn-no-local" onclick="P46.atualizarStatus(' + item.id + ',\'no_local\')" style="font-size:11px;padding:5px 9px">'
                  + '<i class="fas fa-map-marker-alt"></i> Chegou</button>';
        if (item.status === 'agendado')
            html += '<button class="btn-card-acao btn-agendar-presc" onclick="P46.reagendarDaFila(' + item.id + ')" style="font-size:11px;padding:5px 9px">'
                  + '<i class="fas fa-calendar-alt"></i> Reagendar</button>';
        if (item.status === 'no_local')
            html += '<button class="btn-card-acao btn-executando" onclick="P46.atualizarStatus(' + item.id + ',\'executando\')" style="font-size:11px;padding:5px 9px">'
                  + '<i class="fas fa-play"></i> Iniciar</button>';
        if (item.status === 'executando')
            html += '<button class="btn-card-acao btn-concluir" onclick="P46.atualizarStatus(' + item.id + ',\'concluido\')" style="font-size:11px;padding:5px 9px">'
                  + '<i class="fas fa-check"></i> Concluído</button>';
        if (item.status !== 'concluido' && item.status !== 'cancelado')
            html += '<button class="btn-card-acao btn-cancelar-card" onclick="P46.atualizarStatus(' + item.id + ',\'cancelado\')" style="font-size:11px;padding:5px 9px">'
                  + '<i class="fas fa-times"></i></button>';
        html += '</div></td>';

        html += '</tr>';
        return html;
    }

    function renderizarFila() {
        var agendados = Estado.fila.agendados;
        var pendentes = Estado.fila.pendentes;
        var recusados = Estado.fila.recusados;

        var loading     = document.getElementById('fila-loading');
        var vazio       = document.getElementById('fila-vazia');
        var secAg       = document.getElementById('secao-agendados');
        var secPend     = document.getElementById('secao-pendentes');
        var secRecus    = document.getElementById('secao-recusados');
        var gridAg      = document.getElementById('grid-agendados');
        var gridPend    = document.getElementById('grid-pendentes');
        var gridRecus   = document.getElementById('grid-recusados');
        var cntAg       = document.getElementById('count-agendados');
        var cntPend     = document.getElementById('count-pendentes');
        var cntRecus    = document.getElementById('count-recusados');

        if (loading) loading.style.display = 'none';

        if (!agendados.length && !pendentes.length && !recusados.length) {
            if (vazio) vazio.style.display = '';
            if (secAg)    secAg.style.display    = 'none';
            if (secPend)  secPend.style.display  = 'none';
            if (secRecus) secRecus.style.display = 'none';
            return;
        }
        if (vazio) vazio.style.display = 'none';

        var THEAD = '<div class="tabela-fila-wrapper"><table class="tabela-fila"><thead><tr>'
                  + '<th>Paciente</th><th>Exame</th><th>Leito / Setor</th>'
                  + '<th>Horário</th><th>Status</th><th>Enf.</th><th>Ações</th>'
                  + '</tr></thead><tbody>';
        var TFOOT = '</tbody></table></div>';

        if (agendados.length) {
            if (cntAg) cntAg.textContent = agendados.length;
            var htmlAg = THEAD;
            for (var i = 0; i < agendados.length; i++) htmlAg += linhaPacienteHtml(agendados[i]);
            htmlAg += TFOOT;
            if (gridAg) gridAg.innerHTML = htmlAg;
            if (secAg) secAg.style.display = '';
        } else {
            if (secAg) secAg.style.display = 'none';
        }

        if (pendentes.length) {
            if (cntPend) cntPend.textContent = pendentes.length;
            var htmlPend = THEAD;
            for (var j = 0; j < pendentes.length; j++) htmlPend += linhaPacienteHtml(pendentes[j]);
            htmlPend += TFOOT;
            if (gridPend) gridPend.innerHTML = htmlPend;
            if (secPend) secPend.style.display = '';
        } else {
            if (secPend) secPend.style.display = 'none';
        }

        // ── Recusados (somente leitura, recolhidos por padrão) ────
        if (recusados.length) {
            if (cntRecus) cntRecus.textContent = recusados.length;
            var htmlRec = '<div class="tabela-fila-wrapper"><table class="tabela-fila tabela-recusados">'
                        + '<thead><tr><th>Paciente</th><th>Exame</th><th>Setor / Leito</th>'
                        + '<th>Recusado em</th><th>Motivo da recusa</th></tr></thead><tbody>';
            for (var k = 0; k < recusados.length; k++) {
                var rec = recusados[k];
                htmlRec += '<tr class="linha-recusado">'
                    + '<td><strong>' + escHtml(rec.nm_paciente || '—') + '</strong></td>'
                    + '<td>' + escHtml(rec.ds_procedimento || '—') + '</td>'
                    + '<td>' + escHtml((rec.setor_origem_nome || '') + (rec.leito_origem ? ' · ' + rec.leito_origem : '')) + '</td>'
                    + '<td style="white-space:nowrap;">' + escHtml(rec.dt_recusa ? new Date(rec.dt_recusa).toLocaleString('pt-BR', {day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'}) : '—') + '</td>'
                    + '<td>' + escHtml(rec.motivo_recusa || '—') + '</td>'
                    + '</tr>';
            }
            htmlRec += '</tbody></table></div>';
            if (gridRecus) {
                gridRecus.innerHTML = htmlRec;
                gridRecus.style.display = Estado.filaRecusadosAberto ? '' : 'none';
            }
            var iconToggle = document.getElementById('icon-toggle-recusados');
            if (iconToggle) iconToggle.className = Estado.filaRecusadosAberto ? 'fas fa-chevron-down' : 'fas fa-chevron-right';
            if (secRecus) secRecus.style.display = '';
        } else {
            if (secRecus) secRecus.style.display = 'none';
        }
    }

    // ── Pills Exames ───────────────────────────────
    function popularPillsExames(dados) {
        var container = document.getElementById('exames-pills-setor');
        if (!container) return;

        var setores = [];
        var vistos = {};
        for (var i = 0; i < dados.length; i++) {
            var nm = dados[i].nm_setor || '';
            if (nm && !vistos[nm]) { vistos[nm] = true; setores.push(nm); }
        }
        setores.sort();

        var todosAtivo = !Estado.setoresExamesSelecionados.length;
        var html = '<button class="pill' + (todosAtivo ? ' ativo' : '') + '" data-pill="todos">Todos</button>';
        for (var j = 0; j < setores.length; j++) {
            var isAtivo = Estado.setoresExamesSelecionados.indexOf(setores[j]) >= 0;
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
                        Estado.setoresExamesSelecionados = [];
                    } else {
                        var idx = Estado.setoresExamesSelecionados.indexOf(val);
                        if (idx >= 0) Estado.setoresExamesSelecionados.splice(idx, 1);
                        else Estado.setoresExamesSelecionados.push(val);
                    }
                    popularPillsExames(Estado.exames);
                    renderizarExamesRadio();
                });
            })(btns[k]);
        }
    }

    // ── Card Prescrição (aba exames/prescrições) ────
    function cardExameHtml(ex) {
        var radioId          = ex.radio_id;
        var radioSt          = ex.radio_status || '';
        var slotHora         = ex.slot_data_hora ? formatarHora(ex.slot_data_hora) : '';
        var urgente          = ex.ie_urgente === 'S' || ex.radio_prioridade === 'urgente';
        var concluidoInterno = !!ex.concluido_interno;

        var cls = 'card-ex';
        if (concluidoInterno) cls += ' card-ex-concluido';
        else if (urgente) cls += ' card-ex-urgente';
        else if (radioSt === 'concluido') cls += ' card-ex-concluido';
        else if (radioId) cls += ' card-ex-registrado';
        if (!concluidoInterno && ex.status_enfermagem === 'recusado') cls += ' card-ex-enf-recusado';

        var html = '<div class="' + cls + '">';

        html += '<div class="card-ex-header">'
              + '<span class="card-ex-setor">' + escHtml(ex.nm_setor || '') + '</span>'
              + (urgente && !concluidoInterno ? '<span class="badge-urgente">URGENTE</span>' : '')
              + '</div>';

        html += '<div class="card-ex-body">'
              + '<div class="card-ex-nome">' + escHtml(formatarNome(ex.nm_pessoa_fisica)) + '</div>'
              + '<div class="card-ex-atnd"><i class="fas fa-hashtag" style="font-size:9px"></i> ' + escHtml(String(ex.nr_atendimento || '')) + '</div>'
              + '<div class="card-ex-proc"><i class="fas fa-x-ray"></i> ' + escHtml(ex.ds_procedimento || '-') + '</div>'
              + '<div class="card-ex-leito"><i class="fas fa-bed"></i> ' + escHtml(ex.leito || ex.leito_base || '-') + '</div>';

        html += '<div class="card-ex-badges">';
        html += badgeTipoExame(ex.tipo_exame);
        if (concluidoInterno) {
            html += '<span class="badge-status badge-concluido"><i class="fas fa-check-double"></i> Concluído</span>';
            if (ex.auto_finalizado_sistema)
                html += '<span class="badge-sistema" title="Concluído automaticamente pelo sistema por falta de ação do usuário"><i class="fas fa-robot"></i> Sistema</span>';
            else
                html += '<span class="badge-status" style="background:#dee2e6;color:#6c757d;font-size:10px;">'
                      + '<i class="fas fa-sync-alt"></i> Aguard. Tasy</span>';
        } else if (radioId) {
            html += ' ' + badgeStatus(radioSt);
            if (slotHora) html += '<span class="badge-slot-hora"><i class="fas fa-clock"></i> ' + slotHora + '</span>';
        } else {
            html += '<span class="badge-status badge-presc-sem-ag"><i class="fas fa-calendar-plus"></i> Sem agendamento</span>';
        }
        html += '</div>';

        if (!concluidoInterno && radioId && ex.requer_preparo && ex.radio_preparo) {
            html += '<div class="card-ex-preparo"><i class="fas fa-flask"></i> <strong>Preparo:</strong> ' + escHtml(ex.radio_preparo) + '</div>';
        }

        if (!concluidoInterno && radioId) {
            var enfStEx = ex.status_enfermagem;
            if (enfStEx === 'ciente' || enfStEx === 'recusado') {
                html += '<div class="card-enf-row" style="margin-top:2px">' + badgeStatusEnf(enfStEx) + '</div>';
                if (enfStEx === 'recusado' && ex.motivo_recusa) {
                    html += '<div class="card-ex-recusa"><i class="fas fa-exclamation-circle"></i> '
                          + escHtml(ex.motivo_recusa) + '</div>';
                }
            }
        }

        html += '</div>';  // card-ex-body

        html += '<div class="card-ex-footer">';
        if (concluidoInterno) {
            // Exame concluído internamente — sem ações disponíveis até o Tasy atualizar
            html += '<span style="font-size:11px;color:#6c757d;padding:5px 0;"><i class="fas fa-info-circle"></i> Aguardando atualização do Tasy</span>';
        } else if (radioId) {
            if (radioSt === 'pendente' || radioSt === 'agendado')
                html += '<button class="btn-card-acao btn-no-local" onclick="P46.atualizarStatus(' + radioId + ',\'no_local\')" style="font-size:11px;padding:5px 9px"><i class="fas fa-map-marker-alt"></i> Chegou</button>';
            if (radioSt === 'no_local')
                html += '<button class="btn-card-acao btn-executando" onclick="P46.atualizarStatus(' + radioId + ',\'executando\')" style="font-size:11px;padding:5px 9px"><i class="fas fa-play"></i> Iniciar</button>';
            if (radioSt === 'executando')
                html += '<button class="btn-card-acao btn-concluir" onclick="P46.atualizarStatus(' + radioId + ',\'concluido\')" style="font-size:11px;padding:5px 9px"><i class="fas fa-check"></i> Concluir</button>';
            if (radioSt !== 'concluido' && radioSt !== 'cancelado')
                html += '<button class="btn-card-acao btn-agendar-presc" onclick="P46.abrirAgendarPresc(\''
                      + escHtml(String(ex.nr_atendimento || '')) + '\',\''
                      + escHtml(String(ex.nr_prescricao || '')) + '\')" style="font-size:11px;padding:5px 9px">'
                      + '<i class="fas fa-calendar-alt"></i> Reagendar</button>';
            if (radioSt !== 'concluido' && radioSt !== 'cancelado')
                html += '<button class="btn-card-acao btn-cancelar-card" onclick="P46.atualizarStatus(' + radioId + ',\'cancelado\')" style="font-size:11px;padding:5px 9px"><i class="fas fa-times"></i></button>';
        } else {
            html += '<button class="btn-card-acao btn-agendar-presc-novo" onclick="P46.abrirAgendarPresc(\''
                  + escHtml(String(ex.nr_atendimento || '')) + '\',\''
                  + escHtml(String(ex.nr_prescricao || '')) + '\')">'
                  + '<i class="fas fa-calendar-plus"></i> Agendar</button>';
        }
        html += '</div></div>';
        return html;
    }

    // ── Pills Tipo Exame ───────────────────────────
    function inicializarPillsTipo() {
        var container = document.getElementById('exames-pills-tipo');
        if (!container) return;
        var btns = container.querySelectorAll('.pill-tipo');
        for (var i = 0; i < btns.length; i++) {
            (function(btn) {
                btn.addEventListener('click', function() {
                    Estado.filtroTipoExame = btn.getAttribute('data-tipo') || '';
                    var todos = container.querySelectorAll('.pill-tipo');
                    for (var j = 0; j < todos.length; j++) {
                        todos[j].className = todos[j].className.replace(' ativo', '')
                            + (todos[j].getAttribute('data-tipo') === Estado.filtroTipoExame ? ' ativo' : '');
                    }
                    renderizarExamesRadio();
                });
            })(btns[i]);
        }
    }

    // ── Pills Agenda (filtro por modalidade) ───────
    function inicializarPillsAgenda() {
        var container = document.getElementById('agenda-pills-bar');
        if (!container) return;
        var btns = container.querySelectorAll('.pill-agenda');
        for (var i = 0; i < btns.length; i++) {
            (function(btn) {
                btn.addEventListener('click', function() {
                    Estado.filtroModalidade = btn.getAttribute('data-modal') || '';
                    var todos = container.querySelectorAll('.pill-agenda');
                    for (var j = 0; j < todos.length; j++) {
                        var ativo = todos[j].getAttribute('data-modal') === Estado.filtroModalidade;
                        todos[j].className = todos[j].className.replace(' ativo', '') + (ativo ? ' ativo' : '');
                    }
                    renderizarAgenda();
                });
            })(btns[i]);
        }
    }

    // ── Renderizar Exames ──────────────────────────
    function renderizarExamesRadio() {
        var loading  = document.getElementById('exames-loading');
        var vazio    = document.getElementById('exames-vazio');
        var conteudo = document.getElementById('exames-conteudo');
        if (loading) loading.style.display = 'none';

        var dados = Estado.exames;

        // Contar ocultos (não-AGUARDANDO no Tasy OU já concluído internamente)
        var contOcultos = 0;
        for (var oi = 0; oi < dados.length; oi++) {
            var stO = (dados[oi].status_radiologia || '').toUpperCase();
            if ((stO && stO !== 'AGUARDANDO') || dados[oi].concluido_interno) contOcultos++;
        }
        var badgeEl = document.getElementById('badge-exames-ocultos');
        var labelEl = document.getElementById('label-toggle-exames');
        var iconEl  = document.getElementById('icon-toggle-exames');
        if (badgeEl) {
            badgeEl.textContent = contOcultos;
            badgeEl.style.display = (!Estado.mostrarTodosExames && contOcultos > 0) ? '' : 'none';
        }
        if (labelEl) labelEl.textContent = Estado.mostrarTodosExames ? 'Apenas pendentes' : 'Ver realizados';
        if (iconEl)  iconEl.className    = 'fas ' + (Estado.mostrarTodosExames ? 'fa-eye-slash' : 'fa-eye');

        var filtrados = [];
        for (var i = 0; i < dados.length; i++) {
            var ex = dados[i];
            if (Estado.setoresExamesSelecionados.length && Estado.setoresExamesSelecionados.indexOf(ex.nm_setor || '') < 0) continue;
            if (Estado.filtroTipoExame && ex.tipo_exame !== Estado.filtroTipoExame) continue;
            if (Estado.filtroSemControle && ex.radio_id) continue;
            // Por padrão, ocultar exames já realizados (Tasy não-AGUARDANDO OU concluído internamente)
            if (!Estado.mostrarTodosExames) {
                var stEx = (ex.status_radiologia || '').toUpperCase();
                if ((stEx && stEx !== 'AGUARDANDO') || ex.concluido_interno) continue;
            }
            filtrados.push(ex);
        }

        if (!filtrados.length) {
            if (vazio) vazio.style.display = '';
            if (conteudo) conteudo.style.display = 'none';
            return;
        }
        if (vazio) vazio.style.display = 'none';

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

            if (Estado.visualizacaoExames === 'cards') {
                html += '<div class="grid-cards-exames">';
                for (var ci = 0; ci < itens.length; ci++) html += cardExameHtml(itens[ci]);
                html += '</div>';
            } else {
                html += '<div class="tabela-wrapper"><table class="tabela-exames">';
                html += '<thead><tr><th>Paciente</th><th>Leito</th><th>Exame</th><th>Status</th><th>Ações</th></tr></thead><tbody>';
                for (var m = 0; m < itens.length; m++) {
                    var item = itens[m];
                    var rid  = item.radio_id;
                    var rst  = item.radio_status || '';
                    html += '<tr>';
                    html += '<td><div class="pct-nome">' + escHtml(formatarNome(item.nm_pessoa_fisica)) + '</div>'
                          + '<div class="pct-atnd"># ' + escHtml(item.nr_atendimento || '') + '</div></td>';
                    html += '<td><span class="leito-badge">' + escHtml(item.leito || item.leito_base || '-') + '</span></td>';
                    html += '<td><div class="exame-nome">' + escHtml(item.ds_procedimento || '-') + '</div></td>';
                    if (rid) {
                        html += '<td>' + badgeStatus(rst)
                              + (item.slot_data_hora ? '<div class="pct-atnd"><i class="fas fa-clock"></i> ' + formatarHora(item.slot_data_hora) + '</div>' : '')
                              + '</td>';
                        html += '<td>';
                        if (rst === 'pendente' || rst === 'agendado')
                            html += '<button class="btn-card-acao btn-no-local" onclick="P46.atualizarStatus(' + rid + ',\'no_local\')" style="padding:4px 8px;font-size:11px"><i class="fas fa-map-marker-alt"></i> Chegou</button> ';
                        if (rst === 'no_local')
                            html += '<button class="btn-card-acao btn-executando" onclick="P46.atualizarStatus(' + rid + ',\'executando\')" style="padding:4px 8px;font-size:11px"><i class="fas fa-play"></i> Iniciar</button> ';
                        if (rst === 'executando')
                            html += '<button class="btn-card-acao btn-concluir" onclick="P46.atualizarStatus(' + rid + ',\'concluido\')" style="padding:4px 8px;font-size:11px"><i class="fas fa-check"></i> Concluir</button> ';
                        if (rst !== 'concluido' && rst !== 'cancelado')
                            html += '<button class="btn-card-acao btn-cancelar-card" onclick="P46.atualizarStatus(' + rid + ',\'cancelado\')" style="padding:4px 8px;font-size:11px"><i class="fas fa-times"></i></button>';
                        html += '</td>';
                    } else if (item.concluido_interno) {
                        html += '<td><span class="badge-status badge-concluido"><i class="fas fa-check-double"></i> Concluído</span>';
                        if (item.auto_finalizado_sistema)
                            html += ' <span class="badge-sistema" title="Concluído automaticamente pelo sistema por falta de ação do usuário"><i class="fas fa-robot"></i> Sistema</span>';
                        html += '</td>';
                        html += '<td style="color:#6c757d;font-size:11px">—</td>';
                    } else {
                        html += '<td><span class="badge-status badge-pendente" style="opacity:.6"><i class="fas fa-minus"></i> Sem controle</span></td>';
                        html += '<td style="color:#6c757d;font-size:11px">—</td>';
                    }
                    html += '</tr>';
                }
                html += '</tbody></table></div>';
            }
            html += '</div>';
        }

        if (conteudo) { conteudo.innerHTML = html; conteudo.style.display = 'flex'; conteudo.style.flexDirection = 'column'; conteudo.style.gap = '16px'; }
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
            if (slot.requer_preparo && slot.tipo_preparo)
                html += '<div class="slot-preparo"><i class="fas fa-flask"></i> ' + escHtml(slot.tipo_preparo) + '</div>';
            if (slot.status_enfermagem) {
                html += '<div class="slot-enf-row">' + badgeStatusEnf(slot.status_enfermagem) + '</div>';
            }
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

    function atualizarInfoSlots() {
        var livres = 0, ocupados = 0, bloqueados = 0;
        var contagem = {todos: 0, RM: 0, TC: 0, USG: 0, RX: 0, MAM: 0, OUTROS: 0};
        for (var i = 0; i < Estado.slots.length; i++) {
            var sl = Estado.slots[i];
            var s  = sl.status;
            if (s === 'livre') livres++;
            else if (s === 'ocupado') ocupados++;
            else bloqueados++;
            contagem.todos++;
            var modal = sl.modalidade || 'OUTROS';
            if (contagem[modal] !== undefined) contagem[modal]++;
            else contagem.OUTROS++;
        }
        var el = document.getElementById('slots-info-bar');
        if (el) el.textContent = livres + ' livres · ' + ocupados + ' ocupadas · ' + bloqueados + ' bloqueadas';

        // Atualiza badges das pills
        var setarCnt = function(id, n) { var e = document.getElementById(id); if (e) e.textContent = n; };
        setarCnt('acnt-todos',   contagem.todos);
        setarCnt('acnt-rm',      contagem.RM);
        setarCnt('acnt-tc',      contagem.TC);
        setarCnt('acnt-usg',     contagem.USG);
        setarCnt('acnt-rx',      contagem.RX);
        setarCnt('acnt-mam',     contagem.MAM);
        setarCnt('acnt-outros',  contagem.OUTROS);
    }

    function renderizarAgenda() {
        var loading = document.getElementById('agenda-loading');
        var vazio   = document.getElementById('agenda-vazia');
        var grade   = document.getElementById('grade-slots');
        if (loading) loading.style.display = 'none';

        var filtro = Estado.filtroModalidade;
        var lista  = Estado.slots.filter(function(sl) {
            if (!filtro) return true;
            var modal = sl.modalidade || 'OUTROS';
            return modal === filtro;
        });

        if (!lista.length) {
            if (vazio) vazio.style.display = '';
            if (grade) grade.style.display = 'none';
            atualizarInfoSlots();
            return;
        }
        if (vazio) vazio.style.display = 'none';
        var html = '';
        for (var i = 0; i < lista.length; i++) html += slotCardHtml(lista[i]);
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
                    Estado.fila.recusados = d.recusados || [];
                }
                renderizarFila();
                setStatusDot(false);
                var el = document.getElementById('ultima-atualizacao');
                if (el) el.textContent = new Date().toLocaleTimeString('pt-BR', {hour:'2-digit', minute:'2-digit'});
                Estado.carregandoFila = false;
            })
            .catch(function(e) {
                console.error('[P46]', e);
                setStatusDot(true);
                Estado.carregandoFila = false;
            });
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

    function carregarExamesRadio() {
        if (Estado.carregandoExames) return;
        Estado.carregandoExames = true;

        var loading  = document.getElementById('exames-loading');
        var vazio    = document.getElementById('exames-vazio');
        var conteudo = document.getElementById('exames-conteudo');
        if (loading)  loading.style.display = '';
        if (vazio)    vazio.style.display = 'none';
        if (conteudo) conteudo.style.display = 'none';

        fetch(CONFIG.api.prescricoes, {credentials: 'same-origin'})
            .then(function(r) { return r.json(); })
            .then(function(d) {
                if (d.success) {
                    Estado.exames = d.data || [];
                    popularPillsExames(Estado.exames);
                } else {
                    Estado.exames = [];
                    toast('Erro ao carregar prescrições: ' + (d.error || 'Falha'), 'error');
                }
                renderizarExamesRadio();
                Estado.carregandoExames = false;
            })
            .catch(function(e) {
                console.error('[P46] exames:', e);
                Estado.exames = [];
                if (loading) loading.style.display = 'none';
                if (vazio)   vazio.style.display = '';
                toast('Erro de conexão ao carregar exames', 'error');
                Estado.carregandoExames = false;
            });
    }

    function carregarTudo() {
        carregarFila();
        if (Estado.tabAtiva === 'agenda') carregarSlots();
        if (Estado.tabAtiva === 'exames') carregarExamesRadio();
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
            if (d.success) {
                toast('Status atualizado!', 'success');
                carregarFila();
                if (Estado.tabAtiva === 'exames') carregarExamesRadio();
            } else toast('Erro: ' + (d.error || 'Falha'), 'error');
        })
        .catch(function(e) { console.error('[P46]', e); toast('Erro de conexão', 'error'); });
    }

    // ── Gestão de vagas ────────────────────────────
    function bloquearSlot(slotId) {
        var obs = prompt('Motivo do bloqueio (opcional):') || '';
        fetch(CONFIG.api.slotUpdate.replace('{id}', slotId), {
            method: 'PUT', credentials: 'same-origin',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({acao: 'bloquear', obs_bloqueio: obs})
        })
        .then(function(r) { return r.json(); })
        .then(function(d) {
            if (d.success) { toast('Vaga bloqueada.', 'warning'); carregarSlots(); }
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
            if (d.success) { toast('Vaga desbloqueada.', 'success'); carregarSlots(); }
            else toast('Erro: ' + (d.error || 'Falha'), 'error');
        })
        .catch(function(e) { console.error('[P46]', e); toast('Erro de conexão', 'error'); });
    }

    function removerSlot(slotId) {
        if (!confirm('Remover esta vaga?')) return;
        fetch(CONFIG.api.slotDelete.replace('{id}', slotId), {
            method: 'DELETE', credentials: 'same-origin'
        })
        .then(function(r) { return r.json(); })
        .then(function(d) {
            if (d.success) { toast('Vaga removida.', 'info'); carregarSlots(); }
            else toast('Erro: ' + (d.error || 'Falha'), 'error');
        })
        .catch(function(e) { console.error('[P46]', e); toast('Erro de conexão', 'error'); });
    }

    function desagendar(slotId) {
        if (!confirm('Desvincular paciente desta vaga?')) return;
        fetch(CONFIG.api.slotDesvincular.replace('{id}', slotId), {
            method: 'PUT', credentials: 'same-origin',
            headers: {'Content-Type': 'application/json'}
        })
        .then(function(r) { return r.json(); })
        .then(function(d) {
            if (d.success) { toast('Paciente desvinculado.', 'success'); carregarSlots(); carregarFila(); }
            else toast('Erro: ' + (d.error || 'Falha'), 'error');
        })
        .catch(function(e) { console.error('[P46]', e); toast('Erro de conexão', 'error'); });
    }

    function reagendarDaFila(radioId) {
        var item = null;
        var lista = Estado.fila.agendados.concat(Estado.fila.pendentes);
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

        Estado.modalAgendPresc  = presc;
        Estado.modalAgendSlotId = null;

        var infoEl = document.getElementById('modal-ag-info');
        if (infoEl) {
            infoEl.innerHTML = '<strong>' + escHtml(formatarNome(presc.nm_pessoa_fisica)) + '</strong><br>'
                + '<small>' + escHtml(presc.ds_procedimento || '-') + '</small>'
                + (presc.leito ? '<br><small><i class="fas fa-bed"></i> ' + escHtml(presc.leito) + '</small>' : '');
        }
        var tipoEl = document.getElementById('ag-tipo');
        if (tipoEl) tipoEl.value = presc.tipo_exame || 'OUTROS';
        var dataEl = document.getElementById('ag-data');
        if (dataEl) dataEl.value = '';
        var obsEl = document.getElementById('ag-obs');
        if (obsEl) obsEl.value = item.observacao || '';
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
        abrirModal('modal-agendar-presc');
    }

    // ── Modal vincular paciente ────────────────────
    function abrirAgendar(slotId) {
        var listaEl = document.getElementById('lista-vincular');
        var infoEl  = document.getElementById('modal-vincular-info');
        var modal   = document.getElementById('modal-vincular');

        var slotInfo = null;
        for (var i = 0; i < Estado.slots.length; i++) {
            if (Estado.slots[i].id === slotId) { slotInfo = Estado.slots[i]; break; }
        }
        Estado._vincularSlotId = slotId;

        // Modalidade do slot (ex: 'RM', 'TC', null)
        var slotModal = slotInfo ? (slotInfo.modalidade || '') : '';

        // Atualiza info com o filtro ativo
        if (infoEl && slotInfo) {
            infoEl.innerHTML = '<strong>Vaga: ' + formatarHora(slotInfo.data_hora) + '</strong>'
                + (slotModal ? ' — ' + escHtml(slotModal) : ' — Qualquer tipo')
                + ' · ' + (slotInfo.duracao_min || 30) + 'min'
                + (slotModal ? '<br><small style="color:#6c757d;margin-top:4px;display:block;">Mostrando apenas pacientes compatíveis com a modalidade <strong>' + escHtml(slotModal) + '</strong> (+ tipo "Outros")</small>' : '');
        }

        function preencherListaVincular(exames) {
            var candidatos = [];
            for (var j = 0; j < exames.length; j++) {
                var ex = exames[j];
                var rs = ex.radio_status;
                // Agendável: sem radio_agenda OU aguardando slot; nunca se já concluído
                if (rs && rs !== 'pendente') continue;
                if (ex.concluido_interno) continue;
                // Filtro por modalidade do slot: se a vaga tem modalidade definida,
                // só exibe pacientes com mesmo tipo ou OUTROS (tipo desconhecido)
                if (slotModal) {
                    var exTipo = ex.tipo_exame || '';
                    if (exTipo && exTipo !== 'OUTROS' && exTipo !== slotModal) continue;
                }
                candidatos.push(ex);
            }
            Estado._vincularCandidatos = candidatos;

            if (!candidatos.length) {
                listaEl.innerHTML = '<div style="text-align:center;padding:20px;color:#6c757d;">Nenhum paciente disponível para agendamento.</div>';
            } else {
                var html = '';
                for (var k = 0; k < candidatos.length; k++) {
                    var p = candidatos[k];
                    html += '<div class="lista-vincular-item" data-cand-idx="' + k + '">'
                          + '<div style="flex:1;min-width:0;">'
                          + '<div class="lv-nome">' + escHtml(formatarNome(p.nm_pessoa_fisica || p.nm_paciente)) + '</div>'
                          + '<div class="lv-info">' + escHtml(p.ds_procedimento || '')
                          + (p.leito || p.leito_base || p.leito_origem ? ' · ' + escHtml(p.leito || p.leito_base || p.leito_origem || '') : '')
                          + (p.nm_setor ? ' · ' + escHtml(p.nm_setor) : '') + '</div>'
                          + '</div>'
                          + (p.tipo_exame ? badgeTipoExame(p.tipo_exame) : '')
                          + '<i class="fas fa-chevron-right" style="color:var(--cor-primaria);margin-left:8px;"></i></div>';
                }
                listaEl.innerHTML = html;
                // Bind event listeners (sem onclick inline — seguro)
                var items = listaEl.querySelectorAll('.lista-vincular-item');
                for (var m = 0; m < items.length; m++) {
                    (function(el) {
                        el.addEventListener('click', function() {
                            var idx  = parseInt(el.getAttribute('data-cand-idx'));
                            var cand = Estado._vincularCandidatos[idx];
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
        if (Estado.exames && Estado.exames.length) {
            preencherListaVincular(Estado.exames);
        } else {
            listaEl.innerHTML = '<div style="text-align:center;padding:20px;color:#6c757d;"><i class="fas fa-spinner fa-spin"></i> Carregando...</div>';
            if (modal) modal.style.display = 'flex';
            fetch(CONFIG.api.prescricoes, {credentials: 'same-origin'})
                .then(function(r) { return r.json(); })
                .then(function(d) {
                    if (d.success) Estado.exames = d.data || [];
                    preencherListaVincular(Estado.exames);
                })
                .catch(function(e) {
                    console.error('[P46]', e);
                    listaEl.innerHTML = '<div style="text-align:center;padding:20px;color:#dc3545;">Erro ao carregar pacientes.</div>';
                });
        }
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
            if (d.success) { toast('Paciente agendado!', 'success'); carregarSlots(); carregarFila(); carregarExamesRadio(); }
            else toast('Erro: ' + (d.error || 'Falha'), 'error');
        })
        .catch(function(e) { console.error('[P46]', e); toast('Erro de conexão', 'error'); });
    }

    function vincularPrescricao(slotId, ex) {
        fetch(CONFIG.api.agendarPrescricao, {
            method: 'POST', credentials: 'same-origin',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({
                nr_atendimento:       String(ex.nr_atendimento || ''),
                nr_prescricao:        String(ex.nr_prescricao || ''),
                ds_procedimento:      ex.ds_procedimento || '',
                slot_id:              slotId,
                nm_paciente:          ex.nm_pessoa_fisica || '',
                leito_origem:         ex.leito || ex.leito_base || '',
                setor_origem_nome:    ex.nm_setor || '',
                cd_setor_atendimento: ex.cd_setor_atendimento || null,
                prioridade:           'normal',
                requer_transporte:    true,
                observacao:           '',
                nm_medico_solicitante: ex.nm_medico_solicitante || ''
            })
        })
        .then(function(r) { return r.json(); })
        .then(function(d) {
            var modal = document.getElementById('modal-vincular');
            if (modal) modal.style.display = 'none';
            if (d.success) { toast('Paciente vinculado!', 'success'); carregarSlots(); carregarFila(); carregarExamesRadio(); }
            else toast('Erro: ' + (d.error || 'Falha'), 'error');
        })
        .catch(function(e) { console.error('[P46]', e); toast('Erro de conexão', 'error'); });
    }

    // ── Modal criar lote ───────────────────────────
    function criarLote() {
        var dataDisp   = document.getElementById('lote-data').value;
        var data       = displayParaISO(dataDisp);
        var inicio     = document.getElementById('lote-inicio').value;
        var fim        = document.getElementById('lote-fim').value;
        var duracao    = document.getElementById('lote-duracao').value;
        var modalidade = document.getElementById('lote-modalidade') ? document.getElementById('lote-modalidade').value : '';
        if (!data || !inicio || !fim) { toast('Preencha data (DD/MM/AAAA), início e fim.', 'warning'); return; }
        fetch(CONFIG.api.slotsLote, {
            method: 'POST', credentials: 'same-origin',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({data: data, hora_inicio: inicio, hora_fim: fim,
                                  duracao_min: parseInt(duracao) || 30, modalidade: modalidade || null})
        })
        .then(function(r) { return r.json(); })
        .then(function(d) {
            fecharModal('modal-lote');
            if (d.success) {
                var criados = d.criados || 0;
                var ignorados = d.ignorados || 0;
                if (criados > 0) {
                    toast(criados + ' vagas criadas!' + (ignorados ? ' (' + ignorados + ' ignoradas — horário passado)' : ''), 'success');
                } else {
                    toast('Nenhuma vaga criada' + (ignorados ? ' — todos os horários já passaram.' : '.'), 'warning');
                    return;
                }
                Estado.dataConsulta = data;
                if (DOM.labelData) DOM.labelData.textContent = labelData(data);
                mudarTab('agenda');
                carregarSlots();
            } else toast('Erro: ' + (d.error || 'Falha'), 'error');
        })
        .catch(function(e) { console.error('[P46]', e); toast('Erro de conexão', 'error'); });
    }

    // Flag: true quando avulso foi aberto a partir do modal de agendar prescrição
    var _avulsoParaPresc = false;

    function criarAvulso() {
        var data       = displayParaISO(document.getElementById('avulso-data').value);
        var hora       = document.getElementById('avulso-hora').value;
        var duracao    = document.getElementById('avulso-duracao').value;
        var modalidade = document.getElementById('avulso-modalidade') ? document.getElementById('avulso-modalidade').value : '';
        if (!data || !hora) { toast('Preencha data (DD/MM/AAAA) e horário.', 'warning'); return; }
        var veioDaPresc = _avulsoParaPresc;
        fetch(CONFIG.api.slots, {
            method: 'POST', credentials: 'same-origin',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({data_hora: data + 'T' + hora + ':00',
                                  duracao_min: parseInt(duracao) || 30, modalidade: modalidade || null})
        })
        .then(function(r) { return r.json(); })
        .then(function(d) {
            _avulsoParaPresc = false;
            fecharModal('modal-avulso');
            if (d.success) {
                toast('Vaga criada!', 'success');
                if (veioDaPresc) {
                    // Recarrega os slots no modal de agendamento com a data recém-criada
                    buscarSlotsPorTipo(data);
                } else {
                    carregarSlots();
                }
            } else {
                toast('Erro: ' + (d.error || 'Falha'), 'error');
            }
        })
        .catch(function(e) { console.error('[P46]', e); toast('Erro de conexão', 'error'); });
    }

    // Abre o modal de vaga avulsa a partir do contexto de agendamento de prescrição
    function abrirAvulsoParaAgendamento() {
        var presc = Estado.modalAgendPresc;
        _avulsoParaPresc = true;

        // Pré-preenche data com o valor atual do campo ag-data (ou hoje)
        var dataAtual = document.getElementById('ag-data');
        var dataEl    = document.getElementById('avulso-data');
        if (dataEl) dataEl.value = (dataAtual && dataAtual.value) ? dataAtual.value : isoParaDisplay(hojeISO());

        // Pré-preenche hora em branco para o usuário definir
        var horaEl = document.getElementById('avulso-hora');
        if (horaEl) horaEl.value = '';

        // Pré-preenche modalidade conforme o tipo do exame (OUTROS = Qualquer)
        var modalEl = document.getElementById('avulso-modalidade');
        if (modalEl && presc) {
            var tipoParaModal = (presc.tipo_exame && presc.tipo_exame !== 'OUTROS') ? presc.tipo_exame : '';
            modalEl.value = tipoParaModal;
        }

        abrirModal('modal-avulso');
    }

    // ── Modal Agendar Prescrição ───────────────────
    function abrirAgendarPresc(nrAtendimento, nrPrescricao) {
        var presc = null;
        for (var i = 0; i < Estado.exames.length; i++) {
            var ex = Estado.exames[i];
            if (String(ex.nr_atendimento) === String(nrAtendimento)
                && String(ex.nr_prescricao || '') === String(nrPrescricao || '')) {
                presc = ex; break;
            }
        }
        if (!presc) { toast('Prescrição não encontrada.', 'error'); return; }
        if (presc.concluido_interno) { toast('Exame já concluído. Aguardando atualização do Tasy.', 'info'); return; }

        Estado.modalAgendPresc   = presc;
        Estado.modalAgendSlotId  = null;

        var infoEl = document.getElementById('modal-ag-info');
        if (infoEl) {
            infoEl.innerHTML = '<strong>' + escHtml(formatarNome(presc.nm_pessoa_fisica)) + '</strong><br>'
                + '<small>' + escHtml(presc.ds_procedimento || '-') + '</small>'
                + (presc.leito || presc.leito_base ? '<br><small><i class="fas fa-bed"></i> ' + escHtml(presc.leito || presc.leito_base || '') + '</small>' : '');
        }
        var tipoEl = document.getElementById('ag-tipo');
        if (tipoEl) tipoEl.value = presc.tipo_exame || 'OUTROS';
        var dataEl = document.getElementById('ag-data');
        if (dataEl) dataEl.value = '';        // deixa vazio; busca automática pelo próximo dia com vaga
        var obsEl = document.getElementById('ag-obs');
        if (obsEl) obsEl.value = '';
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

        renderizarSlotsDaModal([]);
        // Busca o próximo dia com vagas disponíveis (uma única query no backend)
        buscarSlotsPorTipo('auto');
        abrirModal('modal-agendar-presc');
    }

    // Busca slots compatíveis.
    // Sem args: lê do campo ag-data (digitação manual).
    // Com modo='auto': uma query ao backend que encontra o próximo dia com vagas.
    // Com modo='YYYY-MM-DD': busca nessa data específica.
    function buscarSlotsPorTipo(modo) {
        var presc = Estado.modalAgendPresc;
        if (!presc) return;
        var tipo   = presc.tipo_exame || '';
        var dataEl = document.getElementById('ag-data');
        var loadEl = document.getElementById('ag-slots-loading');
        var btnOk  = document.getElementById('modal-ag-confirmar');

        var url;
        if (modo === 'auto') {
            // Deixa o backend encontrar a próxima data disponível (uma query, sem loop)
            url = CONFIG.api.slotsPorTipo + '?tipo=' + encodeURIComponent(tipo) + '&primeira_data=true';
        } else if (modo && modo !== 'auto') {
            // Data específica passada como argumento (YYYY-MM-DD)
            url = CONFIG.api.slotsPorTipo + '?tipo=' + encodeURIComponent(tipo) + '&data=' + encodeURIComponent(modo);
        } else {
            // Modo manual: lê do campo
            var digitado = dataEl ? displayParaISO(dataEl.value) : '';
            if (!digitado) return;
            url = CONFIG.api.slotsPorTipo + '?tipo=' + encodeURIComponent(tipo) + '&data=' + encodeURIComponent(digitado);
        }

        if (loadEl) loadEl.style.display = '';
        Estado.modalAgendSlotId = null;
        if (btnOk) btnOk.disabled = true;

        fetch(url, {credentials: 'same-origin'})
            .then(function(r) { return r.json(); })
            .then(function(d) {
                var slots = (d.success && d.data) ? d.data : [];
                var dataEncontrada = d.data_consulta || '';
                // Preenche o campo com a data encontrada (auto ou específica)
                if (dataEl && slots.length && dataEncontrada) {
                    dataEl.value = isoParaDisplay(dataEncontrada);
                }
                Estado.slotsDisponiveis = slots;
                renderizarSlotsDaModal(slots, dataEncontrada);
                if (loadEl) loadEl.style.display = 'none';
            })
            .catch(function(e) {
                console.error('[P46] slots-por-tipo:', e);
                Estado.slotsDisponiveis = [];
                renderizarSlotsDaModal([], '');
                if (loadEl) loadEl.style.display = 'none';
            });
    }

    function renderizarSlotsDaModal(slots, dataISO) {
        var listaEl = document.getElementById('ag-lista-slots');
        if (!listaEl) return;
        if (!slots.length) {
            var presc = Estado.modalAgendPresc;
            var tipoMsg = presc && presc.tipo_exame ? ' para ' + escHtml(presc.tipo_exame) : '';
            var dataMsg = dataISO ? ' a partir de ' + isoParaDisplay((dataISO.split('T')[0]) || dataISO) : '';
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
                  + '<span class="slot-opcao-hora">' + formatarHora(s.data_hora) + '</span>'
                  + '<span class="slot-opcao-dur">' + (s.duracao_min || 30) + ' min</span>'
                  + (s.modalidade ? '<span class="slot-opcao-modal">' + escHtml(s.modalidade) + '</span>' : '')
                  + '</div>';
        }
        listaEl.innerHTML = html;
    }

    function selecionarSlot(slotId) {
        Estado.modalAgendSlotId = slotId;
        var items = document.querySelectorAll('.slot-opcao');
        for (var i = 0; i < items.length; i++) {
            var sid = parseInt(items[i].getAttribute('data-slot-id'));
            items[i].className = sid === slotId ? 'slot-opcao slot-opcao-ativo' : 'slot-opcao';
        }
        var btnOk = document.getElementById('modal-ag-confirmar');
        if (btnOk) btnOk.disabled = false;
    }

    function confirmarAgendamento() {
        var presc   = Estado.modalAgendPresc;
        var slotId  = Estado.modalAgendSlotId;
        if (!presc || !slotId) { toast('Selecione um horário.', 'warning'); return; }
        var priEl            = document.getElementById('ag-prioridade');
        var obsEl            = document.getElementById('ag-obs');
        var btnOk            = document.getElementById('modal-ag-confirmar');
        var btnPreparoSimEl  = document.getElementById('btn-preparo-sim');
        var preparoTextoEl   = document.getElementById('ag-preparo-texto');
        var requerPreparo    = !!(btnPreparoSimEl && btnPreparoSimEl.className.indexOf('ativo') >= 0);
        var tipoPreparo      = preparoTextoEl ? preparoTextoEl.value.trim() : '';
        if (requerPreparo && tipoPreparo.length < 15) {
            toast('Descreva o preparo com ao menos 15 caracteres.', 'warning');
            return;
        }
        if (btnOk) btnOk.disabled = true;

        // Captura info do slot para oferecer irmãos depois
        var slotInfoParaIrmaos = null;
        for (var si = 0; si < Estado.slotsDisponiveis.length; si++) {
            if (Estado.slotsDisponiveis[si].id === slotId) {
                slotInfoParaIrmaos = Estado.slotsDisponiveis[si];
                break;
            }
        }

        fetch(CONFIG.api.agendarPrescricao, {
            method: 'POST', credentials: 'same-origin',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({
                nr_atendimento:       String(presc.nr_atendimento || ''),
                nr_prescricao:        String(presc.nr_prescricao || ''),
                ds_procedimento:      presc.ds_procedimento || '',
                slot_id:              slotId,
                nm_paciente:          presc.nm_pessoa_fisica || '',
                leito_origem:         presc.leito || presc.leito_base || '',
                setor_origem_nome:    presc.nm_setor || '',
                cd_setor_atendimento: presc.cd_setor_atendimento || null,
                prioridade:           priEl ? priEl.value : 'normal',
                requer_transporte:    true,
                observacao:           obsEl ? obsEl.value.trim() : '',
                nm_medico_solicitante: presc.nm_medico_solicitante || '',
                requer_preparo:       requerPreparo,
                tipo_preparo:         requerPreparo ? tipoPreparo : ''
            })
        })
        .then(function(r) { return r.json(); })
        .then(function(d) {
            if (d.success) {
                fecharModal('modal-agendar-presc');
                toast('Exame agendado com sucesso!', 'success');
                carregarExamesRadio();
                carregarFila();
                // Verifica se há outros exames do mesmo paciente para oferecer agendamento conjunto
                _verificarIrmaos(presc, slotInfoParaIrmaos);
            } else {
                toast('Erro: ' + (d.error || 'Falha ao agendar'), 'error');
            }
            if (btnOk) btnOk.disabled = false;
        })
        .catch(function(e) {
            console.error('[P46]', e);
            toast('Erro de conexão', 'error');
            if (btnOk) btnOk.disabled = false;
        });
    }

    // ── Modal de irmãos (outros exames do mesmo paciente) ─────

    function _verificarIrmaos(prescPrincipal, slotInfo) {
        var nr = String(prescPrincipal.nr_atendimento || '');
        var nr_pr = String(prescPrincipal.nr_prescricao || '');
        var ds_pr = prescPrincipal.ds_procedimento || '';
        var irmaos = [];

        for (var i = 0; i < Estado.exames.length; i++) {
            var ex = Estado.exames[i];
            // Mesmo atendimento
            if (String(ex.nr_atendimento) !== nr) continue;
            // Exclui o próprio exame recém-agendado
            if (String(ex.nr_prescricao) === nr_pr && ex.ds_procedimento === ds_pr) continue;
            // Só exames pendentes (sem radio_agenda ou pendente)
            if (ex.radio_id && ex.radio_status !== 'pendente') continue;
            if (ex.concluido_interno) continue;
            var stEx = (ex.status_radiologia || '').toUpperCase();
            if (stEx && stEx !== 'AGUARDANDO') continue;
            irmaos.push(ex);
        }

        if (!irmaos.length) return;

        Estado.irmaosPresc    = prescPrincipal;
        Estado.irmaosSlotInfo = slotInfo;
        abrirModalIrmaos(prescPrincipal, irmaos, slotInfo);
    }

    function abrirModalIrmaos(presc, irmaos, slotInfo) {
        var infoEl  = document.getElementById('irmaos-info');
        var listaEl = document.getElementById('irmaos-lista');
        if (!infoEl || !listaEl) return;

        var hora = slotInfo ? formatarHora(slotInfo.data_hora) : '—';
        infoEl.innerHTML = '<strong>' + escHtml(formatarNome(presc.nm_pessoa_fisica)) + '</strong>'
            + ' tem mais ' + irmaos.length + ' exame(s) pendente(s).'
            + '<br><small>Deseja agendá-los também para as <strong>' + hora + '</strong>?</small>';

        var html = '';
        for (var i = 0; i < irmaos.length; i++) {
            var ex = irmaos[i];
            html += '<label class="irmao-item irmao-item-checked">'
                + '<input type="checkbox" class="irmao-chk" value="' + i + '" checked>'
                + '<span class="irmao-proc">' + escHtml(ex.ds_procedimento || '-') + '</span>'
                + (ex.tipo_exame ? badgeTipoExame(ex.tipo_exame) : '')
                + '</label>';
        }
        listaEl.innerHTML = html;
        listaEl._irmaos = irmaos;

        // Toggle visual sem depender de :has() CSS
        var chks = listaEl.querySelectorAll('.irmao-chk');
        for (var ci = 0; ci < chks.length; ci++) {
            (function(chk) {
                chk.addEventListener('change', function() {
                    var lbl = chk.parentNode;
                    if (chk.checked) lbl.className = 'irmao-item irmao-item-checked';
                    else             lbl.className = 'irmao-item';
                });
            })(chks[ci]);
        }

        abrirModal('modal-irmaos');
    }

    function confirmarIrmaos() {
        var listaEl   = document.getElementById('irmaos-lista');
        var slotInfo  = Estado.irmaosSlotInfo;
        if (!listaEl || !slotInfo) { fecharModal('modal-irmaos'); return; }

        var chks = listaEl.querySelectorAll('.irmao-chk:checked');
        if (!chks.length) { fecharModal('modal-irmaos'); return; }

        var irmaos = listaEl._irmaos || [];
        var selecionados = [];
        for (var i = 0; i < chks.length; i++) {
            var idx = parseInt(chks[i].value);
            if (irmaos[idx]) selecionados.push(irmaos[idx]);
        }
        if (!selecionados.length) { fecharModal('modal-irmaos'); return; }

        var btnOk = document.getElementById('modal-irmaos-confirmar');
        if (btnOk) btnOk.disabled = true;

        var examesPayload = [];
        for (var j = 0; j < selecionados.length; j++) {
            var ex = selecionados[j];
            examesPayload.push({
                nr_atendimento:       String(ex.nr_atendimento || ''),
                nr_prescricao:        String(ex.nr_prescricao || ''),
                ds_procedimento:      ex.ds_procedimento || '',
                nm_paciente:          ex.nm_pessoa_fisica || '',
                leito_origem:         ex.leito || ex.leito_base || '',
                setor_origem_nome:    ex.nm_setor || '',
                cd_setor_atendimento: ex.cd_setor_atendimento || null,
                nm_medico_solicitante: ex.nm_medico_solicitante || '',
                prioridade:           ex.radio_prioridade || (ex.ie_urgente === 'S' ? 'urgente' : 'normal'),
                requer_transporte:    true
            });
        }

        fetch(CONFIG.api.agendarLote, {
            method: 'POST', credentials: 'same-origin',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({
                exames:          examesPayload,
                slot_data_hora:  slotInfo.data_hora,
                slot_duracao_min: slotInfo.duracao_min || 30,
                slot_modalidade: slotInfo.modalidade || null
            })
        })
        .then(function(r) { return r.json(); })
        .then(function(d) {
            fecharModal('modal-irmaos');
            if (d.success) {
                var n = d.agendados || selecionados.length;
                toast(n + ' exame(s) adicional(is) agendado(s)!', 'success');
            } else {
                toast('Falha ao agendar exames adicionais.', 'error');
            }
            carregarExamesRadio();
            carregarFila();
            if (btnOk) btnOk.disabled = false;
        })
        .catch(function(e) {
            console.error('[P46] agendar-lote:', e);
            toast('Erro de conexão ao agendar exames adicionais.', 'error');
            fecharModal('modal-irmaos');
            if (btnOk) btnOk.disabled = false;
        });
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

    // ── Exportação de Agenda (PDF / Excel) ──────────

    var _ORDEM_MODAIS = ['RM', 'TC', 'USG', 'RX', 'MAM', 'OUTROS', ''];

    function _agruparSlotsPorModal() {
        var grupos = {};
        for (var i = 0; i < Estado.slots.length; i++) {
            var m = Estado.slots[i].modalidade || '';
            if (!grupos[m]) grupos[m] = [];
            grupos[m].push(Estado.slots[i]);
        }
        return grupos;
    }

    function _textoStatusSlot(sl) {
        if (sl.status === 'bloqueado') return 'Bloqueado';
        if (sl.status === 'livre')     return 'Disponível';
        var rs = sl.radio_status || '';
        if (rs === 'agendado')    return 'Agendado';
        if (rs === 'no_local')    return 'No Local';
        if (rs === 'executando')  return 'Em Execução';
        if (rs === 'concluido')   return 'Concluído';
        if (rs === 'cancelado')   return 'Cancelado';
        return 'Agendado';
    }

    function _corStatusSlot(sl) {
        if (sl.status === 'bloqueado') return '#dc3545';
        if (sl.status === 'livre')     return '#6c757d';
        var rs = sl.radio_status || '';
        if (rs === 'concluido')  return '#28a745';
        if (rs === 'no_local')   return '#e6820a';
        if (rs === 'executando') return '#6f42c1';
        return '#0d6efd';
    }

    function gerarAgendaPDF() {
        if (!Estado.slots.length) { toast('Nenhuma vaga na agenda do dia.', 'warning'); return; }
        var grupos    = _agruparSlotsPorModal();
        var dataFmt   = isoParaDisplay(Estado.dataConsulta);
        var baseUrl   = window.location.origin;
        var agora     = new Date().toLocaleString('pt-BR');

        var css = '<style>'
            + 'body{font-family:Arial,sans-serif;margin:24px;color:#212529;font-size:13px;}'
            + '.no-print{margin-bottom:12px;}'
            + '.btn-p{padding:8px 18px;background:#343a40;color:#fff;border:none;border-radius:6px;cursor:pointer;font-weight:700;font-size:13px;margin-right:6px;}'
            + '.header{display:flex;align-items:center;gap:14px;border-bottom:2px solid #333;padding-bottom:12px;margin-bottom:20px;}'
            + '.logo{height:52px;}'
            + '.header h1{font-size:20px;margin:0;}'
            + '.header p{margin:4px 0 0;font-size:12px;color:#6c757d;}'
            + '.secao{margin-bottom:28px;page-break-inside:avoid;}'
            + '.secao-h{font-size:13px;font-weight:700;background:#343a40;color:#fff;padding:7px 12px;border-radius:4px 4px 0 0;margin:0;letter-spacing:.5px;}'
            + 'table{width:100%;border-collapse:collapse;font-size:12px;}'
            + 'th{background:#f1f3f5;border:1px solid #ced4da;padding:6px 9px;text-align:left;color:#495057;}'
            + 'td{border:1px solid #dee2e6;padding:6px 9px;vertical-align:top;}'
            + 'tr:nth-child(even) td{background:#f8f9fa;}'
            + '.rodape{margin-top:28px;border-top:1px solid #dee2e6;padding-top:8px;font-size:10px;color:#adb5bd;text-align:right;}'
            + '@media print{.no-print{display:none;}}'
            + '</style>';

        var corpo = '<div class="no-print">'
            + '<button class="btn-p" onclick="window.print()"><i>🖨</i> Imprimir / Salvar PDF</button>'
            + '</div>'
            + '<div class="header">'
            + '<img class="logo" src="' + baseUrl + '/static/img/logo.png" alt="HAC" onerror="this.style.display=\'none\'">'
            + '<div><h1>Agenda de Radiologia</h1>'
            + '<p>Data: <strong>' + dataFmt + '</strong>&nbsp;&nbsp;·&nbsp;&nbsp;Gerado em: ' + agora + '</p></div>'
            + '</div>';

        for (var oi = 0; oi < _ORDEM_MODAIS.length; oi++) {
            var m     = _ORDEM_MODAIS[oi];
            var grupo = grupos[m];
            if (!grupo || !grupo.length) continue;
            var nomeM = m || 'Qualquer Modalidade';

            corpo += '<div class="secao"><div class="secao-h">' + nomeM + ' — ' + grupo.length + ' vaga(s)</div>'
                   + '<table><thead><tr>'
                   + '<th style="width:68px">Horário</th>'
                   + '<th style="width:44px">Dur.</th>'
                   + '<th style="width:170px">Paciente</th>'
                   + '<th>Procedimento</th>'
                   + '<th style="width:78px">Leito</th>'
                   + '<th style="width:110px">Setor</th>'
                   + '<th style="width:82px">Status</th>'
                   + '<th style="width:150px">Preparo</th>'
                   + '</tr></thead><tbody>';

            for (var si = 0; si < grupo.length; si++) {
                var sl = grupo[si];
                corpo += '<tr>'
                    + '<td><strong>' + escHtml(formatarHora(sl.data_hora)) + '</strong></td>'
                    + '<td>' + escHtml(String(sl.duracao_min || 30)) + 'min</td>'
                    + '<td>' + escHtml(formatarNome(sl.nm_paciente || '') || '—') + '</td>'
                    + '<td>' + escHtml(sl.ds_procedimento || '—') + '</td>'
                    + '<td>' + escHtml(sl.leito_origem || '—') + '</td>'
                    + '<td>' + escHtml(sl.setor_origem_nome || '—') + '</td>'
                    + '<td style="color:' + _corStatusSlot(sl) + ';font-weight:700;">' + _textoStatusSlot(sl) + '</td>'
                    + '<td>' + (sl.requer_preparo && sl.tipo_preparo ? escHtml(sl.tipo_preparo) : '—') + '</td>'
                    + '</tr>';
            }
            corpo += '</tbody></table></div>';
        }

        corpo += '<div class="rodape">Hospital Anchieta Ceilândia &middot; Sistema de Painéis HAC</div>';

        var janela = window.open('', '_blank', 'width=960,height=720');
        if (!janela) { toast('Permita pop-ups para gerar o PDF.', 'warning'); return; }
        janela.document.write('<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8">'
            + '<title>Agenda Radiologia - ' + dataFmt + '</title>' + css + '</head><body>' + corpo + '</body></html>');
        janela.document.close();
        janela.focus();
    }

    function exportarAgendaExcel() {
        if (!Estado.slots.length) { toast('Nenhuma vaga na agenda do dia.', 'warning'); return; }
        var grupos  = _agruparSlotsPorModal();
        var data    = Estado.dataConsulta;
        var dataFmt = isoParaDisplay(data);

        var linhas = [['Modalidade', 'Horário', 'Duração (min)', 'Paciente', 'Procedimento', 'Leito', 'Setor', 'Status', 'Preparo']];

        for (var oi = 0; oi < _ORDEM_MODAIS.length; oi++) {
            var m     = _ORDEM_MODAIS[oi];
            var grupo = grupos[m];
            if (!grupo || !grupo.length) continue;
            var nomeM = m || 'Qualquer';
            for (var si = 0; si < grupo.length; si++) {
                var sl = grupo[si];
                linhas.push([
                    nomeM,
                    formatarHora(sl.data_hora),
                    sl.duracao_min || 30,
                    formatarNome(sl.nm_paciente || '') || '—',
                    sl.ds_procedimento || '—',
                    sl.leito_origem || '—',
                    sl.setor_origem_nome || '—',
                    _textoStatusSlot(sl),
                    (sl.requer_preparo && sl.tipo_preparo) ? sl.tipo_preparo : '—'
                ]);
            }
        }

        // CSV com ponto-e-vírgula (padrão BR do Excel) + BOM UTF-8
        var csv = '﻿';
        for (var li = 0; li < linhas.length; li++) {
            csv += linhas[li].map(function(v) {
                var s = String(v).replace(/"/g, '""');
                return (s.indexOf(';') >= 0 || s.indexOf('"') >= 0 || s.indexOf('\n') >= 0)
                    ? '"' + s + '"' : s;
            }).join(';') + '\r\n';
        }

        var blob = new Blob([csv], {type: 'text/csv;charset=utf-8;'});
        var url  = URL.createObjectURL(blob);
        var a    = document.createElement('a');
        a.href     = url;
        a.download = 'agenda_radiologia_' + data + '.csv';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        toast('Arquivo Excel gerado!', 'success');
    }

    // ── Inicializar ────────────────────────────────
    function inicializar() {
        DOM.labelData = document.getElementById('label-data');
        if (DOM.labelData) DOM.labelData.textContent = labelData(Estado.dataConsulta);

        // Restaurar preferências
        Estado.visualizacaoExames = localStorage.getItem('p46_view_exames') || 'cards';

        // Pills de tipo de exame
        inicializarPillsTipo();
        inicializarPillsAgenda();

        // Tabs
        var abasBtns = document.querySelectorAll('.aba');
        for (var i = 0; i < abasBtns.length; i++) {
            (function(btn) {
                btn.addEventListener('click', function() { mudarTab(btn.getAttribute('data-aba')); });
            })(abasBtns[i]);
        }

        // data-fecha
        var fechaBtns = document.querySelectorAll('[data-fecha]');
        for (var j = 0; j < fechaBtns.length; j++) {
            (function(btn) {
                btn.addEventListener('click', function() { fecharModal(btn.getAttribute('data-fecha')); });
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

        // View toggle (aba exames)
        var btnExCards  = document.getElementById('exames-btn-cards');
        var btnExTabela = document.getElementById('exames-btn-tabela');
        function atualizarBotoesViewEx() {
            if (btnExCards)  btnExCards.className  = 'btn-view' + (Estado.visualizacaoExames === 'cards'  ? ' ativo' : '');
            if (btnExTabela) btnExTabela.className = 'btn-view' + (Estado.visualizacaoExames === 'tabela' ? ' ativo' : '');
        }
        atualizarBotoesViewEx();
        if (btnExCards) btnExCards.addEventListener('click', function() {
            Estado.visualizacaoExames = 'cards';
            localStorage.setItem('p46_view_exames', 'cards');
            atualizarBotoesViewEx();
            renderizarExamesRadio();
        });
        if (btnExTabela) btnExTabela.addEventListener('click', function() {
            Estado.visualizacaoExames = 'tabela';
            localStorage.setItem('p46_view_exames', 'tabela');
            atualizarBotoesViewEx();
            renderizarExamesRadio();
        });

        // Filtro "sem controle"
        var toggleSemCtrl = document.getElementById('exames-toggle-sem-controle');
        if (toggleSemCtrl) toggleSemCtrl.addEventListener('change', function() {
            Estado.filtroSemControle = this.checked;
            renderizarExamesRadio();
        });

        // Toggle mostrar todos / apenas pendentes
        var btnToggleTodos = document.getElementById('btn-toggle-todos-exames');
        if (btnToggleTodos) btnToggleTodos.addEventListener('click', function() {
            Estado.mostrarTodosExames = !Estado.mostrarTodosExames;
            renderizarExamesRadio();
        });

        // Toggle seção recusados (recolher/expandir)
        var btnToggleRecus = document.getElementById('btn-toggle-recusados');
        if (btnToggleRecus) btnToggleRecus.addEventListener('click', function() {
            Estado.filaRecusadosAberto = !Estado.filaRecusadosAberto;
            var grid = document.getElementById('grid-recusados');
            var icon = document.getElementById('icon-toggle-recusados');
            if (grid) grid.style.display = Estado.filaRecusadosAberto ? '' : 'none';
            if (icon) icon.className = 'fas ' + (Estado.filaRecusadosAberto ? 'fa-chevron-down' : 'fa-chevron-right');
        });

        // Botões gerais
        var btnR = document.getElementById('btn-refresh');
        if (btnR) btnR.addEventListener('click', carregarTudo);
        var btnV = document.getElementById('btn-voltar');
        if (btnV) btnV.addEventListener('click', function() { window.history.back(); });

        // Máscara automática HH:MM nos campos de horário (24h)
        var idsHora = ['lote-inicio', 'lote-fim', 'avulso-hora'];
        for (var hi = 0; hi < idsHora.length; hi++) {
            (function(id) {
                var el = document.getElementById(id);
                if (!el) return;
                el.addEventListener('input', function() {
                    var digits = this.value.replace(/\D/g, '').slice(0, 4);
                    this.value = digits.length > 2 ? digits.slice(0, 2) + ':' + digits.slice(2) : digits;
                });
                el.addEventListener('blur', function() {
                    var m = this.value.match(/^(\d{1,2}):?(\d{2})$/);
                    if (m) this.value = ('0' + m[1]).slice(-2) + ':' + m[2];
                });
            })(idsHora[hi]);
        }

        // Máscara automática DD/MM/AAAA nos campos de data
        var idsDatas = ['lote-data', 'avulso-data', 'ag-data'];
        for (var di = 0; di < idsDatas.length; di++) {
            (function(id) {
                var el = document.getElementById(id);
                if (!el) return;
                el.addEventListener('input', function() {
                    var digits = this.value.replace(/\D/g, '').slice(0, 8);
                    var res = digits;
                    if (digits.length > 2) res = digits.slice(0, 2) + '/' + digits.slice(2);
                    if (digits.length > 4) res = digits.slice(0, 2) + '/' + digits.slice(2, 4) + '/' + digits.slice(4);
                    this.value = res;
                });
                if (id === 'ag-data') {
                    el.addEventListener('input', function() {
                        if (this.value.length === 10) buscarSlotsPorTipo();
                    });
                }
            })(idsDatas[di]);
        }

        // Modal lote
        var btnLote = document.getElementById('btn-criar-lote');
        if (btnLote) btnLote.addEventListener('click', function() {
            var el = document.getElementById('lote-data');
            if (el) el.value = isoParaDisplay(Estado.dataConsulta || hojeISO());
            abrirModal('modal-lote');
        });
        var btnLoteOk = document.getElementById('modal-lote-confirmar');
        if (btnLoteOk) btnLoteOk.addEventListener('click', criarLote);

        // Modal agendar prescrição
        var btnAgOk = document.getElementById('modal-ag-confirmar');
        if (btnAgOk) btnAgOk.addEventListener('click', confirmarAgendamento);

        // Modal de irmãos
        var btnIrmaosOk = document.getElementById('modal-irmaos-confirmar');
        if (btnIrmaosOk) btnIrmaosOk.addEventListener('click', confirmarIrmaos);

        // Modal avulso
        var btnAv = document.getElementById('btn-criar-avulso');
        if (btnAv) btnAv.addEventListener('click', function() {
            var el = document.getElementById('avulso-data');
            if (el) el.value = isoParaDisplay(Estado.dataConsulta || hojeISO());
            abrirModal('modal-avulso');
        });
        var btnAvOk = document.getElementById('modal-avulso-confirmar');
        if (btnAvOk) btnAvOk.addEventListener('click', criarAvulso);

        var btnNovaVagaAg = document.getElementById('btn-nova-vaga-ag');
        if (btnNovaVagaAg) btnNovaVagaAg.addEventListener('click', abrirAvulsoParaAgendamento);

        // Preparo toggle
        var btnPreparoNao = document.getElementById('btn-preparo-nao');
        var btnPreparoSim = document.getElementById('btn-preparo-sim');
        var preparoGrupo  = document.getElementById('ag-preparo-grupo');
        var preparoTexto  = document.getElementById('ag-preparo-texto');
        var preparoHint   = document.getElementById('ag-preparo-hint');
        function atualizarPreparoHint() {
            if (!preparoHint || !preparoTexto) return;
            var len = preparoTexto.value.length;
            preparoHint.textContent = len + ' / 15 mínimo' + (len >= 15 ? ' ✓' : '');
            preparoHint.style.color = len >= 15 ? '#198754' : '#6c757d';
        }
        if (btnPreparoNao) btnPreparoNao.addEventListener('click', function() {
            btnPreparoNao.className = 'btn-preparo btn-preparo-nao ativo';
            if (btnPreparoSim) btnPreparoSim.className = 'btn-preparo btn-preparo-sim';
            if (preparoGrupo) preparoGrupo.style.display = 'none';
        });
        if (btnPreparoSim) btnPreparoSim.addEventListener('click', function() {
            btnPreparoSim.className = 'btn-preparo btn-preparo-sim ativo';
            if (btnPreparoNao) btnPreparoNao.className = 'btn-preparo btn-preparo-nao';
            if (preparoGrupo) preparoGrupo.style.display = '';
            if (preparoTexto) preparoTexto.focus();
        });
        if (preparoTexto) preparoTexto.addEventListener('input', atualizarPreparoHint);

        var btnPDF   = document.getElementById('btn-export-pdf');
        var btnExcel = document.getElementById('btn-export-excel');
        if (btnPDF)   btnPDF.addEventListener('click', gerarAgendaPDF);
        if (btnExcel) btnExcel.addEventListener('click', exportarAgendaExcel);

        carregarFila();
        setInterval(carregarTudo, CONFIG.intervalo);
    }

    window.P46 = {
        atualizarStatus:     atualizarStatus,
        bloquearSlot:        bloquearSlot,
        desbloquearSlot:     desbloquearSlot,
        removerSlot:         removerSlot,
        desagendar:          desagendar,
        reagendarDaFila:     reagendarDaFila,
        abrirAgendar:        abrirAgendar,
        vincularPaciente:    vincularPaciente,
        vincularPrescricao:  vincularPrescricao,
        carregarExamesRadio: carregarExamesRadio,
        abrirAgendarPresc:   abrirAgendarPresc,
        selecionarSlot:      selecionarSlot
    };

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', inicializar);
    else inicializar();
})();
