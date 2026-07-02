/* PAINEL 46 - Radiologia (Tela Operacional) — ES5 */
(function() {
    'use strict';

    var CONFIG = {
        api: {
            fila:            '/api/paineis/painel46/fila',
            semEnvio:        '/api/paineis/painel46/sem-envio',
            slots:           '/api/paineis/painel46/slots',
            slotsLote:       '/api/paineis/painel46/slots/lote',
            exameStatus:     '/api/paineis/painel46/exames/{id}/status',
            agendar:         '/api/paineis/painel46/exames/{id}/agendar',
            slotUpdate:      '/api/paineis/painel46/slots/{id}',
            slotDelete:      '/api/paineis/painel46/slots/{id}',
            prescricoes:     '/api/paineis/painel46/prescricoes',
            agendarPrescricao: '/api/paineis/painel46/agendar-prescricao',
            slotsPorTipo:    '/api/paineis/painel46/slots-por-tipo'
        },
        intervalo: 45000
    };

    var Estado = {
        tabAtiva: 'fila',
        dataConsulta: (function() { var d = new Date(); return d.getFullYear() + '-' + ('0'+(d.getMonth()+1)).slice(-2) + '-' + ('0'+d.getDate()).slice(-2); })(),
        fila: { agendados: [], pendentes: [] },
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
        slotsDisponiveis: []
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

    function cardPacienteHtml(item) {
        var statusCls = '';
        if (item.prioridade === 'urgente') statusCls = ' card-urgente';
        else if (item.status === 'agendado')   statusCls = ' card-agendado';
        else if (item.status === 'no_local')   statusCls = ' card-no_local';
        else if (item.status === 'executando') statusCls = ' card-executando';
        else if (item.status === 'concluido')  statusCls = ' card-concluido';

        var html = '<div class="card-paciente' + statusCls + '">';
        html += '<div class="card-header-p">'
              + '<div><div class="card-nome">' + escHtml(formatarNome(item.nm_paciente)) + '</div>'
              + '<div class="card-atnd"><i class="fas fa-hashtag" style="font-size:9px"></i> ' + escHtml(item.nr_atendimento || '') + '</div></div>';
        if (item.prioridade === 'urgente')
            html += '<div class="card-badge-prio"><span class="badge-urgente"><i class="fas fa-exclamation"></i> Urgente</span></div>';
        html += '</div>';

        html += '<div class="card-body-p">'
              + '<div class="card-exame"><i class="fas fa-x-ray"></i> ' + escHtml(item.ds_procedimento || '-')
              + (item.tipo_exame ? ' ' + badgeTipoExame(item.tipo_exame) : '') + '</div>';
        if (item.leito_origem)
            html += '<div class="card-linha"><i class="fas fa-bed"></i><span>' + escHtml(item.leito_origem) + '</span></div>';
        if (item.setor_origem_nome)
            html += '<div class="card-linha"><i class="fas fa-hospital-alt"></i><span>' + escHtml(item.setor_origem_nome) + '</span></div>';
        if (item.slot_data_hora)
            html += '<div class="card-linha"><i class="fas fa-clock"></i><span><strong>' + formatarHora(item.slot_data_hora) + '</strong>'
                  + (item.slot_modalidade ? ' — ' + escHtml(item.slot_modalidade) : '') + '</span></div>';
        html += '<div class="card-status-row">' + badgeStatus(item.status) + badgeTransporte(item) + '</div>';
        html += '</div>';

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
        var radioId  = ex.radio_id;
        var radioSt  = ex.radio_status || '';
        var slotHora = ex.slot_data_hora ? formatarHora(ex.slot_data_hora) : '';
        var urgente  = ex.ie_urgente === 'S' || ex.radio_prioridade === 'urgente';

        var cls = 'card-ex';
        if (urgente) cls += ' card-ex-urgente';
        else if (radioSt === 'concluido') cls += ' card-ex-concluido';
        else if (radioId) cls += ' card-ex-registrado';

        var html = '<div class="' + cls + '">';

        html += '<div class="card-ex-header">'
              + '<span class="card-ex-setor">' + escHtml(ex.nm_setor || '') + '</span>'
              + (urgente ? '<span class="badge-urgente">URGENTE</span>' : '')
              + '</div>';

        html += '<div class="card-ex-body">'
              + '<div class="card-ex-nome">' + escHtml(formatarNome(ex.nm_pessoa_fisica)) + '</div>'
              + '<div class="card-ex-atnd"><i class="fas fa-hashtag" style="font-size:9px"></i> ' + escHtml(String(ex.nr_atendimento || '')) + '</div>'
              + '<div class="card-ex-proc"><i class="fas fa-x-ray"></i> ' + escHtml(ex.ds_procedimento || '-') + '</div>'
              + '<div class="card-ex-leito"><i class="fas fa-bed"></i> ' + escHtml(ex.leito || ex.leito_base || '-') + '</div>';

        html += '<div class="card-ex-badges">';
        html += badgeTipoExame(ex.tipo_exame);
        if (radioId) {
            html += ' ' + badgeStatus(radioSt);
            if (slotHora) html += '<span class="badge-slot-hora"><i class="fas fa-clock"></i> ' + slotHora + '</span>';
        } else {
            html += '<span class="badge-status badge-presc-sem-ag"><i class="fas fa-calendar-plus"></i> Sem agendamento</span>';
        }
        html += '</div>';

        html += '</div>';  // card-ex-body

        html += '<div class="card-ex-footer">';
        if (radioId) {
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

        // Contar ocultos (não-AGUARDANDO) para badge do toggle
        var contOcultos = 0;
        for (var oi = 0; oi < dados.length; oi++) {
            var stO = (dados[oi].status_radiologia || '').toUpperCase();
            if (stO && stO !== 'AGUARDANDO') contOcultos++;
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
            // Por padrão, ocultar exames já realizados no Tasy (não-AGUARDANDO)
            if (!Estado.mostrarTodosExames) {
                var stEx = (ex.status_radiologia || '').toUpperCase();
                if (stEx && stEx !== 'AGUARDANDO') continue;
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

    var _AGENDA_TIPOS = ['RM', 'TC', 'USG', 'RX', 'MAM', 'OUTROS'];

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

    // ── Sem Envio Prévio ───────────────────────────
    function cardSemEnvioHtml(ex) {
        var stTasy = (ex.status_radiologia || '').toUpperCase();
        var badgeSt = stTasy === 'LAUDADO'
            ? '<span class="badge-status badge-laudado"><i class="fas fa-check"></i> Laudado</span>'
            : '<span class="badge-status badge-sem-laudo"><i class="fas fa-hourglass-half"></i> Sem laudo</span>';
        var html = '<div class="card-sem-envio">';
        html += '<div class="card-sem-envio-top">';
        html += '<span class="card-sem-envio-nome">' + escHtml(formatarNome(ex.nm_pessoa_fisica)) + '</span>';
        html += '<span class="card-sem-envio-setor">' + escHtml(ex.nm_setor || '') + '</span>';
        html += '</div>';
        html += '<div class="card-sem-envio-info">';
        html += '<span><i class="fas fa-x-ray"></i> ' + escHtml(ex.ds_procedimento || '-') + '</span>';
        html += '<span><i class="fas fa-bed"></i> ' + escHtml(ex.leito_base || ex.leito || '-') + '</span>';
        if (ex.dt_execucao)
            html += '<span><i class="fas fa-clock"></i> ' + formatarHora(ex.dt_execucao) + '</span>';
        html += '</div>';
        html += '<div style="margin-top:4px;">' + badgeSt + '</div>';
        html += '</div>';
        return html;
    }

    function renderizarSemEnvio() {
        var lista = Estado.semEnvioPrevio;
        var secao = document.getElementById('secao-sem-envio');
        var cnt   = document.getElementById('count-sem-envio');
        var grid  = document.getElementById('grid-sem-envio');
        var icone = document.getElementById('icone-sem-envio');
        if (!secao) return;

        if (!lista.length) { secao.style.display = 'none'; return; }
        secao.style.display = '';
        if (cnt) cnt.textContent = lista.length;

        var html = '';
        for (var i = 0; i < lista.length; i++) html += cardSemEnvioHtml(lista[i]);
        if (grid) grid.innerHTML = html;

        if (grid) grid.style.display = Estado.semEnvioAberto ? '' : 'none';
        if (icone) icone.style.transform = Estado.semEnvioAberto ? 'rotate(180deg)' : '';
    }

    function toggleSemEnvio() {
        Estado.semEnvioAberto = !Estado.semEnvioAberto;
        var grid  = document.getElementById('grid-sem-envio');
        var icone = document.getElementById('icone-sem-envio');
        if (grid) grid.style.display = Estado.semEnvioAberto ? '' : 'none';
        if (icone) icone.style.transform = Estado.semEnvioAberto ? 'rotate(180deg)' : '';
    }

    function carregarSemEnvio() {
        fetch(CONFIG.api.semEnvio + '?data=' + Estado.dataConsulta, {credentials: 'same-origin'})
            .then(function(r) { return r.json(); })
            .then(function(d) {
                Estado.semEnvioPrevio = (d.success && d.data) ? d.data : [];
                renderizarSemEnvio();
            })
            .catch(function(e) { console.error('[P46 sem-envio]', e); });
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
            })
            .catch(function(e) {
                console.error('[P46] exames:', e);
                Estado.exames = [];
                if (loading) loading.style.display = 'none';
                if (vazio)   vazio.style.display = '';
                toast('Erro de conexão ao carregar exames', 'error');
            })
            .finally(function() { Estado.carregandoExames = false; });
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

    function desagendar(slotId, radioId) {
        if (!confirm('Desvincular paciente desta vaga?')) return;
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
        var listaEl = document.getElementById('lista-vincular');
        var infoEl  = document.getElementById('modal-vincular-info');
        var modal   = document.getElementById('modal-vincular');

        var slotInfo = null;
        for (var i = 0; i < Estado.slots.length; i++) {
            if (Estado.slots[i].id === slotId) { slotInfo = Estado.slots[i]; break; }
        }
        if (infoEl && slotInfo)
            infoEl.innerHTML = '<strong>Vaga: ' + formatarHora(slotInfo.data_hora) + '</strong>'
                + (slotInfo.modalidade ? ' — ' + escHtml(slotInfo.modalidade) : '')
                + ' · ' + (slotInfo.duracao_min || 30) + 'min';

        Estado._vincularSlotId = slotId;

        function preencherListaVincular(exames) {
            var candidatos = [];
            for (var j = 0; j < exames.length; j++) {
                var ex = exames[j];
                var rs = ex.radio_status;
                // Agendável: sem radio_agenda OU aguardando slot
                if (!rs || rs === 'pendente') candidatos.push(ex);
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
                slot_id:              slotId,
                nm_paciente:          ex.nm_pessoa_fisica || '',
                ds_procedimento:      ex.ds_procedimento || '',
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

    function criarAvulso() {
        var data       = displayParaISO(document.getElementById('avulso-data').value);
        var hora       = document.getElementById('avulso-hora').value;
        var duracao    = document.getElementById('avulso-duracao').value;
        var modalidade = document.getElementById('avulso-modalidade') ? document.getElementById('avulso-modalidade').value : '';
        if (!data || !hora) { toast('Preencha data (DD/MM/AAAA) e horário.', 'warning'); return; }
        fetch(CONFIG.api.slots, {
            method: 'POST', credentials: 'same-origin',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({data_hora: data + 'T' + hora + ':00',
                                  duracao_min: parseInt(duracao) || 30, modalidade: modalidade || null})
        })
        .then(function(r) { return r.json(); })
        .then(function(d) {
            fecharModal('modal-avulso');
            if (d.success) { toast('Vaga criada!', 'success'); carregarSlots(); }
            else toast('Erro: ' + (d.error || 'Falha'), 'error');
        })
        .catch(function(e) { console.error('[P46]', e); toast('Erro de conexão', 'error'); });
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
        var priEl = document.getElementById('ag-prioridade');
        if (priEl) priEl.value = presc.radio_prioridade || 'normal';
        var btnOk = document.getElementById('modal-ag-confirmar');
        if (btnOk) btnOk.disabled = true;

        renderizarSlotsDaModal([]);
        // Busca a partir de hoje, avançando até 14 dias se necessário (autoAvanca=true)
        buscarSlotsPorTipo(hojeISO(), 0, true);
        abrirModal('modal-agendar-presc');
    }

    // autoAvanca: true = abre o modal e avança até 14 dias; false/undefined = usuário digitou data
    function buscarSlotsPorTipo(dataISO, tentativa, autoAvanca) {
        var presc = Estado.modalAgendPresc;
        if (!presc) return;
        var tipo   = presc.tipo_exame || '';
        var dataEl = document.getElementById('ag-data');

        // Modo manual: usuário digitou no campo (chamado sem args pelo event listener)
        if (dataISO === undefined) {
            var digitado = dataEl ? displayParaISO(dataEl.value) : '';
            if (!digitado) return;
            dataISO    = digitado;
            tentativa  = 0;
            autoAvanca = false;
        }

        var loadEl = document.getElementById('ag-slots-loading');
        if (loadEl) loadEl.style.display = '';
        Estado.modalAgendSlotId = null;
        var btnOk = document.getElementById('modal-ag-confirmar');
        if (btnOk) btnOk.disabled = true;

        fetch(CONFIG.api.slotsPorTipo + '?tipo=' + encodeURIComponent(tipo) + '&data=' + encodeURIComponent(dataISO),
              {credentials: 'same-origin'})
            .then(function(r) { return r.json(); })
            .then(function(d) {
                var slots = (d.success && d.data) ? d.data : [];
                // Auto-avanço: só quando abrindo o modal (autoAvanca=true) e sem vagas
                if (!slots.length && autoAvanca && tentativa < 13) {
                    var next = new Date(dataISO + 'T12:00:00');
                    next.setDate(next.getDate() + 1);
                    var nextISO = next.getFullYear() + '-' + ('0'+(next.getMonth()+1)).slice(-2) + '-' + ('0'+next.getDate()).slice(-2);
                    buscarSlotsPorTipo(nextISO, tentativa + 1, true);
                    return;
                }
                // Preenche o campo com a data encontrada
                if (dataEl && slots.length) dataEl.value = isoParaDisplay(dataISO);
                Estado.slotsDisponiveis = slots;
                renderizarSlotsDaModal(slots, dataISO);
            })
            .catch(function(e) {
                console.error('[P46] slots-por-tipo:', e);
                Estado.slotsDisponiveis = [];
                renderizarSlotsDaModal([], dataISO);
            })
            .finally(function() { if (loadEl) loadEl.style.display = 'none'; });
    }

    function renderizarSlotsDaModal(slots, dataISO) {
        var listaEl = document.getElementById('ag-lista-slots');
        if (!listaEl) return;
        if (!slots.length) {
            var msgData = dataISO ? (' nos próximos 14 dias a partir de ' + isoParaDisplay(dataISO.split('T')[0] || dataISO)) : '';
            listaEl.innerHTML = '<div style="text-align:center;padding:20px;color:#6c757d;font-size:13px;">'
                + '<i class="fas fa-calendar-times"></i> Nenhuma vaga disponível' + escHtml(msgData) + '.'
                + '<br><small style="margin-top:6px;display:block;">Crie vagas na aba <strong>Agenda</strong> e volte aqui.</small></div>';
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
        var priEl = document.getElementById('ag-prioridade');
        var obsEl = document.getElementById('ag-obs');
        var btnOk = document.getElementById('modal-ag-confirmar');
        if (btnOk) btnOk.disabled = true;
        fetch(CONFIG.api.agendarPrescricao, {
            method: 'POST', credentials: 'same-origin',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({
                nr_atendimento:       String(presc.nr_atendimento || ''),
                nr_prescricao:        String(presc.nr_prescricao || ''),
                slot_id:              slotId,
                nm_paciente:          presc.nm_pessoa_fisica || '',
                ds_procedimento:      presc.ds_procedimento || '',
                leito_origem:         presc.leito || presc.leito_base || '',
                setor_origem_nome:    presc.nm_setor || '',
                cd_setor_atendimento: presc.cd_setor_atendimento || null,
                prioridade:           priEl ? priEl.value : 'normal',
                requer_transporte:    true,
                observacao:           obsEl ? obsEl.value.trim() : '',
                nm_medico_solicitante: presc.nm_medico_solicitante || ''
            })
        })
        .then(function(r) { return r.json(); })
        .then(function(d) {
            fecharModal('modal-agendar-presc');
            if (d.success) {
                toast('Exame agendado com sucesso!', 'success');
                carregarExamesRadio();
                carregarFila();
            } else toast('Erro: ' + (d.error || 'Falha ao agendar'), 'error');
        })
        .catch(function(e) { console.error('[P46]', e); toast('Erro de conexão', 'error'); })
        .finally(function() { if (btnOk) btnOk.disabled = false; });
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

        // Modal avulso
        var btnAv = document.getElementById('btn-criar-avulso');
        if (btnAv) btnAv.addEventListener('click', function() {
            var el = document.getElementById('avulso-data');
            if (el) el.value = isoParaDisplay(Estado.dataConsulta || hojeISO());
            abrirModal('modal-avulso');
        });
        var btnAvOk = document.getElementById('modal-avulso-confirmar');
        if (btnAvOk) btnAvOk.addEventListener('click', criarAvulso);

        carregarFila();
        setInterval(carregarTudo, CONFIG.intervalo);
    }

    window.P46 = {
        atualizarStatus:     atualizarStatus,
        bloquearSlot:        bloquearSlot,
        desbloquearSlot:     desbloquearSlot,
        removerSlot:         removerSlot,
        desagendar:          desagendar,
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
