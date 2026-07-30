(function () {
    'use strict';

    // =========================================================================
    // CONFIG
    // =========================================================================
    var CONFIG = {
        ENDPOINTS: {
            filtros:   '/api/paineis/painel51/filtros',
            dashboard: '/api/paineis/painel51/dashboard',
            leitos:    '/api/paineis/painel51/leitos',
            paciente:  '/api/paineis/painel51/paciente/'
        },
        INTERVALO_REFRESH:  60000,
        PAC_INTERVALO:      45000,   // troca de dupla
        PAC_TICKER_MS:      2000,    // ms entre cada item avançar
        PAC_TICKER_ANIM_MS: 500,     // duração da animação de slide
        STORAGE_PREFIX:     'painel51_'
    };

    // =========================================================================
    // ESTADO
    // =========================================================================
    var Estado = {
        filtros:    { setor: [], kpi: null },
        leitos:     [],
        carregando: false,
        ultimaAtualizacao: null,
        modoTV:     false,
        pac: {
            idx:     0,
            cache:   {},
            timer:   null,
            tickers: {}   // slotId → { allItems, nextIdx, animating, timer }
        }
    };

    // =========================================================================
    // DOM
    // =========================================================================
    var DOM = {};

    // =========================================================================
    // HELPERS
    // =========================================================================

    function salvar(chave, valor) {
        try { localStorage.setItem(CONFIG.STORAGE_PREFIX + chave, JSON.stringify(valor)); } catch(e) {}
    }
    function recuperar(chave, fallback) {
        try {
            var v = localStorage.getItem(CONFIG.STORAGE_PREFIX + chave);
            return v !== null ? JSON.parse(v) : fallback;
        } catch(e) { return fallback; }
    }

    function escHtml(s) {
        if (s === null || s === undefined) return '';
        return String(s)
            .replace(/&/g,'&amp;')
            .replace(/</g,'&lt;')
            .replace(/>/g,'&gt;')
            .replace(/"/g,'&quot;');
    }

    function fmtMin(m) {
        m = parseInt(m) || 0;
        if (m < 60) return m + 'min';
        var h = Math.floor(m / 60), r = m % 60;
        return h + 'h' + (r < 10 ? '0' : '') + r;
    }

    function fmtNome(nm) {
        if (!nm) return '—';
        var parts = String(nm).toLowerCase().split(' ');
        return parts.map(function(p) {
            return p.length > 2 ? p.charAt(0).toUpperCase() + p.slice(1) : p;
        }).join(' ');
    }

    // =========================================================================
    // PARAMS
    // =========================================================================

    function construirParams() {
        var p = [];
        if (Estado.filtros.setor.length > 0) p.push('setor=' + Estado.filtros.setor.join(','));
        return p.length ? '?' + p.join('&') : '';
    }

    // =========================================================================
    // RELÓGIO
    // =========================================================================

    function tickRelogio() {
        var d  = new Date();
        var hh = ('0' + d.getHours()).slice(-2);
        var mm = ('0' + d.getMinutes()).slice(-2);
        if (!DOM.relogio) return;
        var ago = '';
        if (Estado.ultimaAtualizacao) {
            var diff = Math.round((d - Estado.ultimaAtualizacao) / 1000);
            ago = diff < 10 ? 'agora' : 'há ' + diff + 's';
        }
        DOM.relogio.innerHTML = hh + ':' + mm + '<small>' + (ago || 'inicializando') + '</small>';
    }

    // =========================================================================
    // RENDER: PILLS DE SETOR
    // =========================================================================

    function renderizarSetores(setores) {
        if (!DOM.setores) return;
        if (!setores || !setores.length) {
            DOM.setores.innerHTML = '<span class="set-loading">Nenhum setor cadastrado</span>';
            return;
        }
        var h = '';
        for (var i = 0; i < setores.length; i++) {
            var s      = setores[i];
            var ativo  = Estado.filtros.setor.indexOf(s.cd_setor) >= 0;
            var alerta = parseInt(s.qt_leitos_alerta) || 0;
            h += '<button class="set' + (ativo ? ' on' : '') + (alerta === 0 ? ' zero' : '') +
                 '" data-cd="' + s.cd_setor + '" title="' + escHtml(s.nm_setor) + '">' +
                 escHtml(s.apelido || s.nm_setor) + ' <b>' + alerta + '</b></button>';
        }
        DOM.setores.innerHTML = h;
        var btns = DOM.setores.querySelectorAll('.set');
        for (var j = 0; j < btns.length; j++) {
            (function(btn) {
                btn.addEventListener('click', function() {
                    var cd  = parseInt(btn.getAttribute('data-cd'));
                    var idx = Estado.filtros.setor.indexOf(cd);
                    if (idx >= 0) { Estado.filtros.setor.splice(idx, 1); }
                    else          { Estado.filtros.setor = [cd]; }
                    salvar('setor', Estado.filtros.setor);
                    carregarDados();
                });
            })(btns[j]);
        }
    }

    // =========================================================================
    // RENDER: KPIs
    // =========================================================================

    function renderizarKpis(data) {
        if (!DOM.kpis) return;
        var defs = [
            { k: 'crit', c: 'k-crit', n: data.qt_criticas        || 0, l: 'Críticas',        ic: 'fa-triangle-exclamation'        },
            { k: 'atr',  c: 'k-atr',  n: data.qt_atrasadas       || 0, l: 'Atrasadas',       ic: 'fa-clock'                       },
            { k: 'abr',  c: 'k-abr',  n: data.qt_abertas         || 0, l: 'Janela aberta',   ic: 'fa-hourglass-half'              },
            { k: 'prx',  c: 'k-prx',  n: data.qt_proximas        || 0, l: 'Próximas 2h',     ic: 'fa-forward'                     },
            { k: 'frm',  c: 'k-frm',  n: data.qt_sem_dispensacao || 0, l: 'Sem dispensação', ic: 'fa-prescription-bottle-medical'  }
        ];
        var h = '';
        for (var i = 0; i < defs.length; i++) {
            var d = defs[i];
            h += '<div class="kpi ' + d.c + (Estado.filtros.kpi === d.k ? ' on' : '') +
                 '" data-k="' + d.k + '">' +
                 '<i class="ic fa-solid ' + d.ic + '"></i>' +
                 '<div><b>' + d.n + '</b><span>' + d.l + '</span></div>' +
                 '</div>';
        }
        DOM.kpis.innerHTML = h;
        var ks = DOM.kpis.querySelectorAll('.kpi');
        for (var j = 0; j < ks.length; j++) {
            (function(el) {
                el.addEventListener('click', function() {
                    var k = el.getAttribute('data-k');
                    Estado.filtros.kpi = (Estado.filtros.kpi === k) ? null : k;
                    renderizarKpis(data);
                });
            })(ks[j]);
        }
    }

    // =========================================================================
    // DOSE LINE + CARD BUILDER
    // =========================================================================

    var _SEV_CLS = ['sev0','sev1','sev2','sev3','sev4','sev5'];

    var _DOSE_ROT = {
        CRITICA:        { tg: 'tg-crit', label: 'Crítica',           cls: 'd-crit' },
        ATRASADA:       { tg: 'tg-atr',  label: 'Atrasada',          cls: 'd-atr'  },
        ABERTA:         { tg: 'tg-abr',  label: 'Administrar agora', cls: 'd-abr'  },
        PROXIMA:        { tg: 'tg-prx',  label: 'Próxima',           cls: 'd-prx'  },
        AGENDADA:       { tg: 'tg-ok',   label: 'Agendada',          cls: 'd-ok'   },
        ADM_NO_PRAZO:   { tg: 'tg-ok',   label: 'Administrada',      cls: 'd-ok'   },
        ADM_ANTECIPADA: { tg: 'tg-fora', label: 'Fora da janela',    cls: 'd-fora' },
        ADM_ATRASADA:   { tg: 'tg-fora', label: 'Fora da janela',    cls: 'd-fora' },
        JUSTIFICADA:    { tg: 'tg-just', label: 'Justificada',       cls: 'd-just' },
        SEM_HORARIO:    { tg: 'tg-ok',   label: 'Sem horário fixo',  cls: 'd-ok'   }
    };

    function _dosePacLinha(d, mostrarChecker) {
        var rot    = _DOSE_ROT[d.situacao] || { tg: '', label: d.situacao || '—', cls: '' };
        var atraso = parseInt(d.min_atraso) || 0;
        var checker = '';
        if (mostrarChecker && d.nm_profissional_checagem) {
            checker = '<div class="pac-checker">' +
                '<i class="fa-solid fa-user-check"></i> ' +
                escHtml(fmtNome(d.nm_profissional_checagem)) +
                (d.hora_checagem ? ' · ' + escHtml(d.hora_checagem) : '') +
                '</div>';
        }
        var horaHtml = d.e_hoje === false
            ? '<div class="pac-hora"><span class="dia-seg">amanhã</span>' + escHtml(d.hora_prevista || '--:--') + '</div>'
            : '<div class="pac-hora">' + escHtml(d.hora_prevista || '--:--') + '</div>';
        return '<div class="pac-dose-linha ' + rot.cls + '">' +
            horaHtml +
            '<div class="pac-med">' +
            '<div class="pac-med-nome">' + escHtml(d.ds_material || '—') + '</div>' +
            '<div class="pac-med-posol">' +
            escHtml((d.qt_dose ? d.qt_dose + ' ' : '') + (d.ds_unidade_medida || '')) +
            (d.ds_intervalo ? ' · ' + escHtml(d.ds_intervalo) : '') + '</div>' +
            checker + '</div>' +
            '<div class="pac-tags">' +
            '<span class="tg ' + rot.tg + '">' + escHtml(rot.label) + (atraso > 0 ? ' ' + fmtMin(atraso) : '') + '</span>' +
            (d.alta_vigilancia   ? '<span class="tg tg-av"><i class="fa-solid fa-shield-halved"></i></span>' : '') +
            (d.pendente_farmacia ? '<span class="tg tg-frm"><i class="fa-solid fa-prescription-bottle-medical"></i></span>' : '') +
            '</div></div>';
    }

    /**
     * Constrói os dados de um card de paciente para o ticker.
     * Retorna { html: string (header + ticker wrapper), allItems: Array<string> }
     * onde allItems é a lista plana de HTML de cada linha (seções + doses).
     */
    function _buildPacCard(l, data) {
        var sev  = parseInt(l.severidade_max) || 0;
        var sevC = _SEV_CLS[Math.min(sev, 5)];
        var pend = (data.precisa_acao || []).concat(data.proximas || []);
        var res  = data.resolvidas || [];

        var cntPend = pend.length
            ? '<span class="cnt-pend"><i class="fa-solid fa-hourglass-half"></i> ' +
              pend.length + ' pendente' + (pend.length !== 1 ? 's' : '') + '</span>'
            : '';
        var cntOk = '<span class="cnt-ok"><i class="fa-solid fa-circle-check"></i> ' +
            res.length + ' checado' + (res.length !== 1 ? 's' : '') + '</span>';

        var headerHtml =
            '<div class="pac-pac-hdr ' + sevC + '">' +
            '<div class="pac-leito">' + escHtml(l.cd_leito || '—') + '</div>' +
            '<div class="pac-hdr-info">' +
            '<div class="pac-nome">' + escHtml(fmtNome(l.nm_paciente)) + '</div>' +
            '<div class="pac-setor">' + escHtml(l.nm_setor || l.setor_apelido || '') + '</div>' +
            '<div class="pac-meta-counts">' + cntPend + cntOk + '</div>' +
            '</div></div>';

        // Lista plana de itens do ticker (seções + doses)
        var allItems = [];
        if (pend.length) {
            allItems.push('<div class="pac-secao">Pendentes (' + pend.length + ')</div>');
            for (var i = 0; i < pend.length; i++) allItems.push(_dosePacLinha(pend[i], false));
        }
        if (res.length) {
            allItems.push('<div class="pac-secao">Já checados (' + res.length + ')</div>');
            for (var j = 0; j < res.length; j++) allItems.push(_dosePacLinha(res[j], true));
        }

        var html = headerHtml +
            '<div class="pac-ticker"><div class="pac-ticker-track"></div></div>';

        return { html: html, allItems: allItems };
    }

    // =========================================================================
    // TICKER — item a item, empurrando para cima em loop
    // =========================================================================

    /**
     * Inicia o ticker para um .pac-card-item.
     * Renderiza TODOS os itens no track (o CSS faz overflow:hidden mostrar apenas os visíveis).
     * A cada PAC_TICKER_MS:
     *   1. Mede a altura do primeiro item
     *   2. Adiciona o próximo item (loop) no final do track
     *   3. Anima translateY(-firstHeight) → sobe a faixa
     *   4. Após animação: remove o primeiro item, reseta transform
     */
    function _startTicker(slotEl, allItems) {
        var slotId = slotEl.id;
        _stopTicker(slotId);
        if (!allItems || !allItems.length) return;

        var track = slotEl.querySelector('.pac-ticker-track');
        if (!track) return;

        // Renderiza todos os itens de uma vez (a visão é clipada pelo overflow:hidden do .pac-ticker)
        var h = '';
        for (var i = 0; i < allItems.length; i++) h += allItems[i];
        track.innerHTML = h;
        track.style.transition = 'none';
        track.style.transform  = 'translateY(0)';

        // nextIdx: próximo item a adicionar no final para o loop
        var state = {
            allItems:  allItems,
            nextIdx:   0,       // cicla em loop: 0 → N-1 → 0 → …
            animating: false,
            timer:     null
        };

        state.timer = setInterval(function() {
            if (state.animating) return;

            var firstItem = track.firstElementChild;
            if (!firstItem) return;
            var itemH = firstItem.offsetHeight;
            if (!itemH) return;

            state.animating = true;

            // Adiciona próximo item no final (para loop contínuo)
            var wrapper   = document.createElement('div');
            wrapper.innerHTML = allItems[state.nextIdx];
            var newNode   = wrapper.firstElementChild;
            if (newNode) track.appendChild(newNode);
            state.nextIdx = (state.nextIdx + 1) % allItems.length;

            // Slide: sobe a faixa
            track.style.transition = 'transform ' + CONFIG.PAC_TICKER_ANIM_MS + 'ms cubic-bezier(0.4,0,0.2,1)';
            track.style.transform  = 'translateY(-' + itemH + 'px)';

            setTimeout(function() {
                // Remove o item que saiu pelo topo
                if (track.firstChild) track.removeChild(track.firstChild);
                // Reseta sem animação
                track.style.transition = 'none';
                track.style.transform  = 'translateY(0)';
                state.animating = false;
            }, CONFIG.PAC_TICKER_ANIM_MS + 20);

        }, CONFIG.PAC_TICKER_MS);

        Estado.pac.tickers[slotId] = state;
    }

    function _stopTicker(slotId) {
        var st = Estado.pac.tickers[slotId];
        if (st && st.timer) { clearInterval(st.timer); st.timer = null; }
        delete Estado.pac.tickers[slotId];
    }

    function _stopAllTickers() {
        var keys = Object.keys(Estado.pac.tickers);
        for (var k = 0; k < keys.length; k++) _stopTicker(keys[k]);
    }

    // =========================================================================
    // PAGINADOR — dupla de pacientes (troca a cada PAC_INTERVALO)
    // =========================================================================

    function renderizarPaciente(idx) {
        _stopAllTickers();   // cancela tickers da dupla anterior

        var lista = Estado.leitos;
        if (!lista || !lista.length) {
            if (DOM.pacCard) DOM.pacCard.innerHTML =
                '<div class="pac-card-item"><div class="vazio">' +
                '<i class="fa-solid fa-bed"></i><b>Sem pacientes</b></div></div>';
            return;
        }

        var total   = lista.length;
        idx         = ((idx % total) + total) % total;
        Estado.pac.idx = idx;

        var mostrar = total === 1 ? 1 : 2;
        var idxB    = (idx + 1) % total;

        // Esqueleto de slots
        var h = '';
        for (var s = 0; s < mostrar; s++) {
            h += '<div class="pac-card-item" id="pac-slot-' + s + '">' +
                 '<div class="vazio"><i class="fa-solid fa-spinner fa-spin"></i>' +
                 '<b>Carregando…</b></div>' +
                 '</div>';
        }
        if (DOM.pacCard) DOM.pacCard.innerHTML = h;

        // Preenche cada slot — cache (120s) ou fetch
        for (var si = 0; si < mostrar; si++) {
            (function(slotNum, leitoIdx, baseIdx) {
                var l  = lista[leitoIdx];
                var nr = l.nr_atendimento;

                function setSlot(result) {
                    if (Estado.pac.idx !== baseIdx) return;
                    var el = document.getElementById('pac-slot-' + slotNum);
                    if (!el) return;
                    el.innerHTML = result.html;
                    _startTicker(el, result.allItems);
                }

                var entry = Estado.pac.cache[nr];
                if (entry && (Date.now() - entry.ts) < 120000) {
                    setSlot(_buildPacCard(l, entry.data));
                    return;
                }

                fetch(CONFIG.ENDPOINTS.paciente + nr, { credentials: 'same-origin' })
                    .then(function(r) { return r.json(); })
                    .then(function(data) {
                        if (!data.success) return;
                        Estado.pac.cache[nr] = { data: data, ts: Date.now() };
                        setSlot(_buildPacCard(l, data));
                    })
                    .catch(function(e) { console.error('[P51] slot ' + slotNum + ':', e); });

            })(si, si === 0 ? idx : idxB, idx);
        }
    }

    function iniciarPaginador() {
        pararPaginador();
        renderizarPaciente(Estado.pac.idx);
        Estado.pac.timer = setInterval(function() {
            renderizarPaciente(Estado.pac.idx + 2);
        }, CONFIG.PAC_INTERVALO);
    }

    function pararPaginador() {
        if (Estado.pac.timer) { clearInterval(Estado.pac.timer); Estado.pac.timer = null; }
        _stopAllTickers();
    }

    // =========================================================================
    // DRAWER DO LEITO
    // =========================================================================

    function doseHtml(d, mostrarChecker) {
        var rot    = _DOSE_ROT[d.situacao] || { tg: '', label: d.situacao || '—', cls: '' };
        var atraso = parseInt(d.min_atraso) || 0;
        var checker = '';
        if (mostrarChecker && d.nm_profissional_checagem) {
            checker = '<span class="tg tg-chk"><i class="fa-solid fa-user-check"></i> ' +
                escHtml(fmtNome(d.nm_profissional_checagem)) +
                (d.hora_checagem ? ' · ' + escHtml(d.hora_checagem) : '') + '</span>';
        }
        var dHoraHtml = d.e_hoje === false
            ? '<div class="d-hora"><span class="dia-seg">amanhã</span>' + escHtml(d.hora_prevista || '--:--') + '</div>'
            : '<div class="d-hora">' + escHtml(d.hora_prevista || '--:--') + '</div>';
        return '<div class="dose ' + rot.cls + '">' +
            dHoraHtml +
            '<div class="d-corpo">' +
            '<div class="d-nome">' + escHtml(d.ds_material || '—') + '</div>' +
            '<div class="d-meta">' +
            escHtml((d.qt_dose ? d.qt_dose + ' ' : '') + (d.ds_unidade_medida || '')) +
            (d.ds_intervalo ? ' · ' + escHtml(d.ds_intervalo) : '') + '</div>' +
            '<div class="d-tags">' +
            '<span class="tg ' + rot.tg + '">' + escHtml(rot.label) + (atraso > 0 ? ' ' + fmtMin(atraso) : '') + '</span>' +
            (d.alta_vigilancia   ? '<span class="tg tg-av"><i class="fa-solid fa-shield-halved"></i> Alta vigilância</span>' : '') +
            (d.pendente_farmacia ? '<span class="tg tg-frm"><i class="fa-solid fa-prescription-bottle-medical"></i> Sem dispensação</span>' : '') +
            checker +
            '</div></div></div>';
    }

    function abrirDrawer(nr, cdLeito, nmPaciente) {
        if (DOM.drwLeito) DOM.drwLeito.textContent = cdLeito || '—';
        if (DOM.drwPac)   DOM.drwPac.textContent   = fmtNome(nmPaciente);
        if (DOM.drwB)     DOM.drwB.innerHTML = '<div class="vazio"><i class="fa-solid fa-spinner fa-spin"></i><b>Carregando…</b></div>';
        if (DOM.drw) DOM.drw.classList.add('on');
        if (DOM.ovl) DOM.ovl.classList.add('on');

        fetch(CONFIG.ENDPOINTS.paciente + nr, { credentials: 'same-origin' })
            .then(function(r) { return r.json(); })
            .then(function(data) {
                if (!data.success || !DOM.drwB) return;
                if (DOM.drwPac) {
                    DOM.drwPac.textContent = fmtNome(nmPaciente) + ' · ' +
                        (data.qt_total || 0) + ' dose' + ((data.qt_total || 0) !== 1 ? 's' : '') + ' hoje';
                }
                var h  = '';
                var gs = [
                    { titulo: 'Precisa de ação',    doses: data.precisa_acao || [], chk: false },
                    { titulo: 'Nas próximas horas', doses: data.proximas     || [], chk: false },
                    { titulo: 'Já resolvidas',      doses: data.resolvidas   || [], chk: true  }
                ];
                for (var g = 0; g < gs.length; g++) {
                    if (!gs[g].doses.length) continue;
                    h += '<div class="grupo">' + escHtml(gs[g].titulo) + ' (' + gs[g].doses.length + ')</div>';
                    for (var di = 0; di < gs[g].doses.length; di++) h += doseHtml(gs[g].doses[di], gs[g].chk);
                }
                if (!h) h = '<div class="vazio"><i class="fa-solid fa-circle-check"></i><b>Sem doses na janela</b></div>';
                DOM.drwB.innerHTML = h;
            })
            .catch(function(e) {
                console.error('[P51] drawer:', e);
                if (DOM.drwB) DOM.drwB.innerHTML = '<div class="vazio"><i class="fa-solid fa-triangle-exclamation"></i><b>Erro ao carregar</b></div>';
            });
    }

    function fecharDrawer() {
        if (DOM.drw) DOM.drw.classList.remove('on');
        if (DOM.ovl) DOM.ovl.classList.remove('on');
    }

    // =========================================================================
    // CARGA DE DADOS
    // =========================================================================

    function carregarFiltros() {
        fetch(CONFIG.ENDPOINTS.filtros, { credentials: 'same-origin' })
            .then(function(r) { return r.json(); })
            .then(function(data) { if (data.success) renderizarSetores(data.setores || []); })
            .catch(function(e) { console.error('[P51] filtros:', e); });
    }

    function carregarDados() {
        if (Estado.carregando) return;
        Estado.carregando = true;
        var params = construirParams();

        Promise.all([
            fetch(CONFIG.ENDPOINTS.dashboard + params, { credentials: 'same-origin' }).then(function(r) { return r.json(); }),
            fetch(CONFIG.ENDPOINTS.leitos    + params, { credentials: 'same-origin' }).then(function(r) { return r.json(); })
        ])
        .then(function(results) {
            var dash = results[0], lts = results[1];
            if (dash.success) renderizarKpis(dash.data || {});
            if (lts.success) {
                Estado.leitos    = lts.data || [];
                Estado.pac.cache = {};
                renderizarPaciente(Estado.pac.idx);
            }
            Estado.ultimaAtualizacao = new Date();
            carregarFiltros();
        })
        .catch(function(e) { console.error('[P51] carregarDados:', e); })
        ['finally'](function() { Estado.carregando = false; });
    }

    // =========================================================================
    // MODO TV
    // =========================================================================

    function toggleModoTV() {
        Estado.modoTV = !Estado.modoTV;
        salvar('modoTV', Estado.modoTV);
        document.body.classList.toggle('modo-tv', Estado.modoTV);
        if (DOM.btnTv) DOM.btnTv.classList.toggle('on', Estado.modoTV);
    }

    // =========================================================================
    // INICIALIZAÇÃO
    // =========================================================================

    function inicializar() {
        DOM.setores    = document.getElementById('setores');
        DOM.kpis       = document.getElementById('kpis');
        DOM.pacCard    = document.getElementById('pac-card');
        DOM.ovl        = document.getElementById('ovl');
        DOM.drw        = document.getElementById('drw');
        DOM.drwLeito   = document.getElementById('drw-leito');
        DOM.drwPac     = document.getElementById('drw-pac');
        DOM.drwB       = document.getElementById('drw-b');
        DOM.drwX       = document.getElementById('drw-x');
        DOM.btnTv      = document.getElementById('btnTv');
        DOM.btnSom     = document.getElementById('btnSom');
        DOM.btnRefresh = document.getElementById('btn-refresh');
        DOM.relogio    = document.getElementById('relogio');

        Estado.filtros.setor = recuperar('setor', []);
        Estado.modoTV        = recuperar('modoTV', false);
        if (Estado.modoTV) {
            document.body.classList.add('modo-tv');
            if (DOM.btnTv) DOM.btnTv.classList.add('on');
        }

        // Relógio
        tickRelogio();
        setInterval(tickRelogio, 1000);

        // Clique no card abre drawer
        if (DOM.pacCard) {
            DOM.pacCard.addEventListener('click', function(e) {
                var item = e.target.closest('.pac-card-item');
                if (!item) return;
                var sn    = parseInt((item.id || '').replace('pac-slot-', ''));
                var total = Estado.leitos.length;
                if (!total || isNaN(sn)) return;
                var lIdx = (Estado.pac.idx + sn) % total;
                var l    = Estado.leitos[lIdx];
                if (l) abrirDrawer(l.nr_atendimento, l.cd_leito, l.nm_paciente);
            });
        }

        if (DOM.btnTv)      DOM.btnTv.addEventListener('click', function() { toggleModoTV(); });
        if (DOM.btnSom)     DOM.btnSom.addEventListener('click', function() { DOM.btnSom.classList.toggle('on'); });
        if (DOM.btnRefresh) DOM.btnRefresh.addEventListener('click', function() { carregarDados(); });
        if (DOM.drwX)       DOM.drwX.addEventListener('click', fecharDrawer);
        if (DOM.ovl)        DOM.ovl.addEventListener('click',  fecharDrawer);
        document.addEventListener('keydown', function(e) { if (e.key === 'Escape') fecharDrawer(); });

        iniciarPaginador();
        carregarDados();

        setInterval(function() {
            if (!document.hidden) carregarDados();
        }, CONFIG.INTERVALO_REFRESH);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', inicializar);
    } else {
        inicializar();
    }

})();
