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
        INTERVALO_REFRESH:    60000,
        PAC_INTERVALO:        30000,
        PAC_SCROLL_PX:        2,
        PAC_SCROLL_TICK:      60,
        PAC_SCROLL_DELAY:     1500,
        STORAGE_PREFIX:       'painel51_'
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
        scrollTimer: null,
        pac: {
            idx:              0,
            cache:            {},
            timer:            null,
            scrollTimer:      null,
            scrollDelayTimer: null
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
        var d = new Date();
        var hh = ('0' + d.getHours()).slice(-2);
        var mm = ('0' + d.getMinutes()).slice(-2);
        if (DOM.relogio) {
            var ago = '';
            if (Estado.ultimaAtualizacao) {
                var diff = Math.round((d - Estado.ultimaAtualizacao) / 1000);
                ago = diff < 10 ? 'agora' : 'há ' + diff + 's';
            }
            DOM.relogio.innerHTML = hh + ':' + mm +
                '<small>' + (ago || 'inicializando') + '</small>';
        }
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
            var s = setores[i];
            var ativo  = Estado.filtros.setor.indexOf(s.cd_setor) >= 0;
            var alerta = parseInt(s.qt_leitos_alerta) || 0;
            h += '<button class="set' + (ativo ? ' on' : '') + (alerta === 0 ? ' zero' : '') +
                 '" data-cd="' + s.cd_setor + '" title="' + escHtml(s.nm_setor) + '">' +
                 escHtml(s.apelido || s.nm_setor) +
                 ' <b>' + alerta + '</b></button>';
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
            { k: 'crit', c: 'k-crit', n: data.qt_criticas         || 0, l: 'Críticas',        ic: 'fa-triangle-exclamation'       },
            { k: 'atr',  c: 'k-atr',  n: data.qt_atrasadas        || 0, l: 'Atrasadas',       ic: 'fa-clock'                      },
            { k: 'abr',  c: 'k-abr',  n: data.qt_abertas          || 0, l: 'Janela aberta',   ic: 'fa-hourglass-half'             },
            { k: 'prx',  c: 'k-prx',  n: data.qt_proximas         || 0, l: 'Próximas 2h',     ic: 'fa-forward'                    },
            { k: 'frm',  c: 'k-frm',  n: data.qt_sem_dispensacao  || 0, l: 'Sem dispensação', ic: 'fa-prescription-bottle-medical' }
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
    // PAGINADOR — DUPLA DE PACIENTES
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

    /**
     * Renderiza uma linha de dose.
     * mostrarChecker=true: exibe quem administrou (campo nm_profissional_checagem).
     */
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
        return '<div class="pac-dose-linha ' + rot.cls + '">' +
            '<div class="pac-hora">' + escHtml(d.hora_prevista || '--:--') + '</div>' +
            '<div class="pac-med">' +
            '<div class="pac-med-nome">' + escHtml(d.ds_material || '—') + '</div>' +
            '<div class="pac-med-posol">' +
            escHtml((d.qt_dose ? d.qt_dose + ' ' : '') + (d.ds_unidade_medida || '')) +
            (d.ds_intervalo ? ' · ' + escHtml(d.ds_intervalo) : '') + '</div>' +
            checker +
            '</div>' +
            '<div class="pac-tags">' +
            '<span class="tg ' + rot.tg + '">' + escHtml(rot.label) + (atraso > 0 ? ' ' + fmtMin(atraso) : '') + '</span>' +
            (d.alta_vigilancia   ? '<span class="tg tg-av"><i class="fa-solid fa-shield-halved"></i></span>' : '') +
            (d.pendente_farmacia ? '<span class="tg tg-frm"><i class="fa-solid fa-prescription-bottle-medical"></i></span>' : '') +
            '</div></div>';
    }

    /**
     * Constrói o HTML interno de um .pac-card-item.
     * Cabeçalho com leito, nome, setor e contadores (sticky via CSS).
     */
    function _buildPacCardHtml(l, data) {
        var sev    = parseInt(l.severidade_max) || 0;
        var sevCls = _SEV_CLS[Math.min(sev, 5)];
        var pend   = (data.precisa_acao || []).concat(data.proximas || []);
        var res    = data.resolvidas || [];

        var cntPend = pend.length
            ? '<span class="cnt-pend"><i class="fa-solid fa-hourglass-half"></i> ' +
              pend.length + ' pendente' + (pend.length !== 1 ? 's' : '') + '</span>'
            : '';
        var cntOk = '<span class="cnt-ok"><i class="fa-solid fa-circle-check"></i> ' +
            res.length + ' checado' + (res.length !== 1 ? 's' : '') + '</span>';

        var h = '<div class="pac-pac-hdr ' + sevCls + '">' +
            '<div class="pac-leito">' + escHtml(l.cd_leito || '—') + '</div>' +
            '<div class="pac-hdr-info">' +
            '<div class="pac-nome">' + escHtml(fmtNome(l.nm_paciente)) + '</div>' +
            '<div class="pac-setor">' + escHtml(l.nm_setor || l.setor_apelido || '') + '</div>' +
            '<div class="pac-meta-counts">' + cntPend + cntOk + '</div>' +
            '</div></div>';

        if (pend.length) {
            h += '<div class="pac-secao">Pendentes (' + pend.length + ')</div>';
            for (var i = 0; i < pend.length; i++) h += _dosePacLinha(pend[i], false);
        }
        if (res.length) {
            h += '<div class="pac-secao">Já checados (' + res.length + ')</div>';
            for (var j = 0; j < res.length; j++) h += _dosePacLinha(res[j], true);
        }
        if (!pend.length && !res.length) {
            h += '<div class="vazio"><i class="fa-solid fa-circle-check"></i><b>Sem doses na janela</b></div>';
        }
        return h;
    }

    // ── Scroll interno dos cards ──────────────────────────────────────────────

    function _iniciarScrollCards() {
        if (Estado.pac.scrollTimer) { clearInterval(Estado.pac.scrollTimer); Estado.pac.scrollTimer = null; }
        Estado.pac.scrollTimer = setInterval(function() {
            var slots = DOM.pacCard ? DOM.pacCard.querySelectorAll('.pac-card-item') : [];
            for (var i = 0; i < slots.length; i++) {
                var el  = slots[i];
                var max = el.scrollHeight - el.clientHeight;
                if (max > 0 && el.scrollTop < max) {
                    el.scrollTop = Math.min(el.scrollTop + CONFIG.PAC_SCROLL_PX, max);
                }
            }
        }, CONFIG.PAC_SCROLL_TICK);
    }

    function _agendarScrollCards() {
        if (Estado.pac.scrollDelayTimer) { clearTimeout(Estado.pac.scrollDelayTimer);  Estado.pac.scrollDelayTimer = null; }
        if (Estado.pac.scrollTimer)      { clearInterval(Estado.pac.scrollTimer);       Estado.pac.scrollTimer      = null; }
        Estado.pac.scrollDelayTimer = setTimeout(function() {
            Estado.pac.scrollDelayTimer = null;
            _iniciarScrollCards();
        }, CONFIG.PAC_SCROLL_DELAY);
    }

    // ── Renderização de uma dupla ─────────────────────────────────────────────

    function renderizarPaciente(idx) {
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

        var h = '';
        for (var s = 0; s < mostrar; s++) {
            h += '<div class="pac-card-item" id="pac-slot-' + s + '">' +
                 '<div class="vazio"><i class="fa-solid fa-spinner fa-spin"></i>' +
                 '<b>Carregando…</b></div>' +
                 '</div>';
        }
        if (DOM.pacCard) DOM.pacCard.innerHTML = h;
        _agendarScrollCards();

        for (var si = 0; si < mostrar; si++) {
            (function(slotNum, leitoIdx, baseIdx) {
                var l  = lista[leitoIdx];
                var nr = l.nr_atendimento;

                function setSlot(html) {
                    if (Estado.pac.idx !== baseIdx) return;
                    var el = document.getElementById('pac-slot-' + slotNum);
                    if (el) el.innerHTML = html;
                }

                var entry = Estado.pac.cache[nr];
                if (entry && (Date.now() - entry.ts) < 120000) {
                    setSlot(_buildPacCardHtml(l, entry.data));
                    return;
                }

                fetch(CONFIG.ENDPOINTS.paciente + nr, { credentials: 'same-origin' })
                    .then(function(r) { return r.json(); })
                    .then(function(data) {
                        if (!data.success) return;
                        Estado.pac.cache[nr] = { data: data, ts: Date.now() };
                        setSlot(_buildPacCardHtml(l, data));
                    })
                    .catch(function(e) { console.error('[P51] pac slot ' + slotNum + ':', e); });

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
        if (Estado.pac.timer)            { clearInterval(Estado.pac.timer);            Estado.pac.timer            = null; }
        if (Estado.pac.scrollTimer)      { clearInterval(Estado.pac.scrollTimer);      Estado.pac.scrollTimer      = null; }
        if (Estado.pac.scrollDelayTimer) { clearTimeout(Estado.pac.scrollDelayTimer);  Estado.pac.scrollDelayTimer = null; }
    }

    // =========================================================================
    // DRAWER DO LEITO (clique no KPI abre drawer — acessível via cards externos)
    // =========================================================================

    function doseHtml(d, mostrarChecker) {
        var rot    = _DOSE_ROT[d.situacao] || { tg: '', label: d.situacao || '—', cls: '' };
        var atraso = parseInt(d.min_atraso) || 0;
        var checker = '';
        if (mostrarChecker && d.nm_profissional_checagem) {
            checker = '<span class="tg tg-chk"><i class="fa-solid fa-user-check"></i> ' +
                escHtml(fmtNome(d.nm_profissional_checagem)) +
                (d.hora_checagem ? ' · ' + escHtml(d.hora_checagem) : '') +
                '</span>';
        }
        return '<div class="dose ' + rot.cls + '">' +
            '<div class="d-hora">' + escHtml(d.hora_prevista || d.ds_horario || '--:--') + '</div>' +
            '<div class="d-corpo">' +
            '<div class="d-nome">' + escHtml(d.ds_material || '—') + '</div>' +
            '<div class="d-meta">' +
            escHtml((d.qt_dose ? d.qt_dose + ' ' : '') + (d.ds_unidade_medida || '')) +
            (d.ds_intervalo ? ' · ' + escHtml(d.ds_intervalo) : '') + '</div>' +
            '<div class="d-tags">' +
            '<span class="tg ' + rot.tg + '">' + escHtml(rot.label) + (atraso > 0 ? ' ' + fmtMin(atraso) : '') + '</span>' +
            (d.alta_vigilancia   ? '<span class="tg tg-av"><i class="fa-solid fa-shield-halved"></i> Alta vigilância</span>' : '') +
            (d.pendente_farmacia ? '<span class="tg tg-frm"><i class="fa-solid fa-prescription-bottle-medical"></i> Sem dispensação</span>' : '') +
            (d.evento_rotulo && d.situacao === 'JUSTIFICADA' ? '<span class="tg tg-just">' + escHtml(d.evento_rotulo) + '</span>' : '') +
            checker +
            '</div></div></div>';
    }

    function abrirDrawer(nr_atendimento, cd_leito, nm_paciente) {
        if (DOM.drwLeito) DOM.drwLeito.textContent = cd_leito || '—';
        if (DOM.drwPac)   DOM.drwPac.textContent   = fmtNome(nm_paciente);
        if (DOM.drwB)     DOM.drwB.innerHTML = '<div class="vazio"><i class="fa-solid fa-spinner fa-spin"></i><b>Carregando…</b></div>';
        if (DOM.drw) DOM.drw.classList.add('on');
        if (DOM.ovl) DOM.ovl.classList.add('on');

        fetch(CONFIG.ENDPOINTS.paciente + nr_atendimento, { credentials: 'same-origin' })
            .then(function(r) { return r.json(); })
            .then(function(data) {
                if (!data.success || !DOM.drwB) return;
                if (DOM.drwPac) {
                    DOM.drwPac.textContent = fmtNome(nm_paciente) + ' · ' +
                        (data.qt_total || 0) + ' dose' + ((data.qt_total || 0) !== 1 ? 's' : '') + ' hoje';
                }
                var h = '';
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
                Estado.leitos     = lts.data || [];
                Estado.pac.cache  = {};
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

        // Delegação de clique nos cards do paginador (abre drawer)
        if (DOM.pacCard) {
            DOM.pacCard.addEventListener('click', function(e) {
                var item = e.target.closest('.pac-card-item');
                if (!item) return;
                var slotId = item.id;
                if (!slotId) return;
                var slotNum = parseInt(slotId.replace('pac-slot-', ''));
                var total   = Estado.leitos.length;
                if (!total) return;
                var lIdx    = (Estado.pac.idx + slotNum) % total;
                var l       = Estado.leitos[lIdx];
                if (l) abrirDrawer(l.nr_atendimento, l.cd_leito, l.nm_paciente);
            });
        }

        // Modo TV
        if (DOM.btnTv) DOM.btnTv.addEventListener('click', function() { toggleModoTV(); });

        // Alertas sonoros
        if (DOM.btnSom) {
            DOM.btnSom.addEventListener('click', function() {
                DOM.btnSom.classList.toggle('on');
            });
        }

        // Refresh manual
        if (DOM.btnRefresh) DOM.btnRefresh.addEventListener('click', function() { carregarDados(); });

        // Drawer
        if (DOM.drwX) DOM.drwX.addEventListener('click', fecharDrawer);
        if (DOM.ovl)  DOM.ovl.addEventListener('click',  fecharDrawer);
        document.addEventListener('keydown', function(e) { if (e.key === 'Escape') fecharDrawer(); });

        // Inicia paginador e polling
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
