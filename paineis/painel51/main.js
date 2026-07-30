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
            tabela:    '/api/paineis/painel51/tabela',
            paciente:  '/api/paineis/painel51/paciente/'
        },
        INTERVALO_REFRESH:    60000,
        PAC_INTERVALO:        5000,
        PAC_TICK:             100,
        STORAGE_PREFIX:       'painel51_',
        AUTO_SCROLL_INTERVAL: 5000
    };

    // =========================================================================
    // ESTADO
    // =========================================================================
    var Estado = {
        filtros:    { setor: [], kpi: null },
        leitos:     [],
        tabela:     [],
        modo:       'tabela',   // aba Tabela aberta por padrão
        foco:       false,
        modoTV:     false,
        alertaSom:  false,
        carregando: false,
        ultimaAtualizacao: null,
        scrollTimer: null,
        pac: {
            idx:       0,
            cache:     {},
            timer:     null,
            progTimer: null,
            progPct:   0
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
        if (Estado.filtros.setor.length > 0) {
            p.push('setor=' + Estado.filtros.setor.join(','));
        }
        if (Estado.filtros.kpi) {
            var mapa = { crit: 'CRITICA', atr: 'ATRASADA', abr: 'ABERTA', prx: 'PROXIMA', frm: '' };
            if (mapa[Estado.filtros.kpi]) {
                p.push('situacao=' + mapa[Estado.filtros.kpi]);
            }
        }
        if (Estado.foco) {
            p.push('apenas_pendentes=1');
        }
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
                '<small id="ultima-atualizacao">' + (ago || 'inicializando') + '</small>';
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
                    renderizarMural(Estado.leitos);
                    if (Estado.modo === 'tabela') renderizarTabela(Estado.tabela);
                });
            })(ks[j]);
        }
    }

    // =========================================================================
    // RENDER: MURAL DE LEITOS
    // =========================================================================

    var _SEV_CLS = ['sev0','sev1','sev2','sev3','sev4','sev5'];

    function leito_visivel(l) {
        if (Estado.foco && (parseInt(l.severidade_max) || 0) < 3) return false;
        var k = Estado.filtros.kpi;
        if (k === 'crit' && !(parseInt(l.qt_criticas)          > 0)) return false;
        if (k === 'atr'  && !(parseInt(l.qt_atrasadas)         > 0)) return false;
        if (k === 'abr'  && !(parseInt(l.qt_abertas)           > 0)) return false;
        if (k === 'prx'  && !(parseInt(l.qt_proximas)          > 0)) return false;
        if (k === 'frm'  && !(parseInt(l.qt_sem_dispensacao)   > 0)) return false;
        return true;
    }

    function barSeg(n, total, cor) {
        n = parseInt(n) || 0;
        if (!n) return '';
        return '<i style="width:' + (n / total * 100) + '%;background:' + cor + '"></i>';
    }

    function renderizarMural(leitos) {
        if (!DOM.mural) return;
        var h = '';
        var mostrados = 0;
        for (var i = 0; i < leitos.length; i++) {
            var l = leitos[i];
            if (!leito_visivel(l)) continue;
            mostrados++;

            var sev  = parseInt(l.severidade_max)  || 0;
            var crit = parseInt(l.qt_criticas)      || 0;
            var atr  = parseInt(l.qt_atrasadas)     || 0;
            var abr  = parseInt(l.qt_abertas)       || 0;
            var prx  = parseInt(l.qt_proximas)      || 0;
            var ok   = parseInt(l.qt_administradas) || 0;
            var just = parseInt(l.qt_justificadas)  || 0;
            var agd  = parseInt(l.qt_doses) - crit - atr - abr - prx - ok - just;
            if (agd < 0) agd = 0;
            var disp   = parseInt(l.qt_sem_dispensacao) || 0;
            var stat   = parseInt(l.qt_stat_pendente)   || 0;
            var atraso = parseInt(l.maior_atraso_min)   || 0;
            var total  = parseInt(l.qt_doses)           || 1;
            var pend   = crit + atr + abr;
            var big    = pend > 0 ? pend : ok;
            var rot    = pend > 0 ? (crit > 0 ? 'atrasadas' : 'na janela') : 'em dia';
            var sevCls = _SEV_CLS[Math.min(sev, 5)];

            h += '<article class="leito ' + sevCls + '" data-i="' + i + '">' +
                 (sev === 5 ? '<span class="pulso" aria-hidden="true"></span>' : '') +
                 '<div class="lt-top">' +
                 '<div><div class="lt-num">' + escHtml(l.cd_leito) + '</div>' +
                 '<div class="lt-pac">' + escHtml(fmtNome(l.nm_paciente)) + '</div></div>' +
                 '<div class="lt-big"><b>' + big + '</b><span>' + rot + '</span></div>' +
                 '</div>' +
                 '<div class="lt-bar">' +
                 barSeg(crit, total, 'var(--s-critica)')  +
                 barSeg(atr,  total, 'var(--s-atrasada)') +
                 barSeg(abr,  total, 'var(--s-aberta)')   +
                 barSeg(prx,  total, 'var(--s-proxima)')  +
                 barSeg(just, total, 'var(--s-just)')     +
                 barSeg(ok,   total, 'var(--s-ok)')       +
                 barSeg(agd,  total, 'var(--s-agendada)') +
                 '</div>' +
                 '<div class="lt-foot">' +
                 (atraso > 0
                    ? '<span class="lt-tag ' + (sev === 5 ? 'hot' : '') + '">' +
                      '<i class="fa-solid fa-clock"></i> ' + fmtMin(atraso) + '</span>'
                    : '<span class="lt-tag"><i class="fa-solid fa-check"></i> sem atraso</span>') +
                 (disp > 0
                    ? '<span class="lt-tag warn"><i class="fa-solid fa-prescription-bottle-medical"></i> ' + disp + '</span>'
                    : (l.dt_proxima_dose
                        ? '<span class="lt-prox">próx. ' + escHtml(l.dt_proxima_dose.slice(11,16)) + '</span>'
                        : '')) +
                 (stat > 0 ? '<span class="lt-tag warn"><i class="fa-solid fa-bolt"></i> ' + stat + ' STAT</span>' : '') +
                 '</div></article>';
        }

        if (mostrados === 0) {
            h = '<div class="vazio" style="grid-column:1/-1">' +
                '<i class="fa-solid fa-circle-check"></i>' +
                '<b>Nenhuma pendência neste filtro</b>' +
                '<p>Todas as doses estão administradas ou justificadas.</p></div>';
        }
        DOM.mural.innerHTML = h;

        var cards = DOM.mural.querySelectorAll('.leito');
        for (var j = 0; j < cards.length; j++) {
            (function(card) {
                card.addEventListener('click', function() {
                    abrirDrawer(parseInt(card.getAttribute('data-i')));
                });
            })(cards[j]);
        }
    }

    // =========================================================================
    // RENDER: TABELA
    // =========================================================================

    function renderizarTabela(grupos) {
        if (!DOM.tbWrap) return;
        if (!grupos || !grupos.length) {
            DOM.tbWrap.innerHTML = '<div class="vazio"><i class="fa-solid fa-circle-check"></i>' +
                '<b>Nenhuma pendência</b><p>Todas as doses estão administradas ou justificadas.</p></div>';
            return;
        }

        var k       = Estado.filtros.kpi;
        var mapaSit = { crit: 'CRITICA', atr: 'ATRASADA', abr: 'ABERTA', prx: 'PROXIMA' };
        var h = '';
        var mostrados = 0;

        for (var i = 0; i < grupos.length; i++) {
            var g = grupos[i];
            if (k && k !== 'frm') {
                var sitF = mapaSit[k];
                var temS = false;
                for (var xi = 0; xi < g.doses.length; xi++) {
                    if (g.doses[xi].situacao === sitF) { temS = true; break; }
                }
                if (!temS) continue;
            }
            if (k === 'frm') {
                var temF = false;
                for (var xf = 0; xf < g.doses.length; xf++) {
                    if (g.doses[xf].pendente_farmacia) { temF = true; break; }
                }
                if (!temF) continue;
            }

            mostrados++;
            var sev    = parseInt(g.severidade_max) || 0;
            var sevCls = _SEV_CLS[Math.min(sev, 5)];
            var nD     = g.doses.length;

            h += '<div class="tb-bloco ' + sevCls + '">' +
                 '<div class="tb-hdr">' +
                 '<div class="tb-leito-num">' + escHtml(g.cd_leito || '—') + '</div>' +
                 '<div class="tb-pac-info"><b>' + escHtml(fmtNome(g.nm_paciente)) + '</b>' +
                 '<span>' + escHtml(g.nm_setor || '') + '</span></div>' +
                 '<div class="tb-dose-count">' + nD + ' dose' + (nD !== 1 ? 's' : '') +
                 ' pendente' + (nD !== 1 ? 's' : '') + '</div>' +
                 '</div>';

            for (var j = 0; j < g.doses.length; j++) {
                var d   = g.doses[j];
                var rot = _DOSE_ROT[d.situacao] || { tg: '', label: d.situacao || '—', cls: '' };
                var atr = parseInt(d.min_atraso) || 0;
                h += '<div class="tb-linha ' + rot.cls + '">' +
                     '<div class="tb-hora-cell">' + escHtml(d.hora_prevista || '--:--') + '</div>' +
                     '<div class="tb-med-cell"><div class="tb-med-nome">' + escHtml(d.ds_material || '—') + '</div>' +
                     '<div class="tb-med-posol">' +
                     escHtml((d.qt_dose ? d.qt_dose + ' ' : '') + (d.ds_unidade_medida || '')) +
                     (d.ds_intervalo ? ' · ' + escHtml(d.ds_intervalo) : '') + '</div></div>' +
                     '<div class="tb-tags-cell">' +
                     '<span class="tg ' + rot.tg + '">' + escHtml(rot.label) + (atr > 0 ? ' ' + fmtMin(atr) : '') + '</span>' +
                     (d.alta_vigilancia   ? '<span class="tg tg-av" title="Alta vigilância"><i class="fa-solid fa-shield-halved"></i></span>' : '') +
                     (d.pendente_farmacia ? '<span class="tg tg-frm" title="Sem dispensação"><i class="fa-solid fa-prescription-bottle-medical"></i></span>' : '') +
                     '</div></div>';
            }
            h += '</div>';
        }

        if (mostrados === 0) {
            h = '<div class="vazio"><i class="fa-solid fa-circle-check"></i>' +
                '<b>Nenhuma pendência neste filtro</b><p>Todas as doses do recorte estão resolvidas.</p></div>';
        }
        DOM.tbWrap.innerHTML = h;
    }

    // =========================================================================
    // PAGINADOR — DUPLA DE PACIENTES
    // =========================================================================

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

    function _dosePacLinha(d) {
        var rot    = _DOSE_ROT[d.situacao] || { tg: '', label: d.situacao || '—', cls: '' };
        var atraso = parseInt(d.min_atraso) || 0;
        return '<div class="pac-dose-linha ' + rot.cls + '">' +
            '<div class="pac-hora">' + escHtml(d.hora_prevista || '--:--') + '</div>' +
            '<div class="pac-med"><div class="pac-med-nome">' + escHtml(d.ds_material || '—') + '</div>' +
            '<div class="pac-med-posol">' +
            escHtml((d.qt_dose ? d.qt_dose + ' ' : '') + (d.ds_unidade_medida || '')) +
            (d.ds_intervalo ? ' · ' + escHtml(d.ds_intervalo) : '') + '</div></div>' +
            '<div class="pac-tags">' +
            '<span class="tg ' + rot.tg + '">' + escHtml(rot.label) + (atraso > 0 ? ' ' + fmtMin(atraso) : '') + '</span>' +
            (d.alta_vigilancia   ? '<span class="tg tg-av"><i class="fa-solid fa-shield-halved"></i></span>' : '') +
            (d.pendente_farmacia ? '<span class="tg tg-frm"><i class="fa-solid fa-prescription-bottle-medical"></i></span>' : '') +
            '</div></div>';
    }

    function _buildPacCardHtml(l, data) {
        var sev    = parseInt(l.severidade_max) || 0;
        var sevCls = _SEV_CLS[Math.min(sev, 5)];
        var pend   = (data.precisa_acao || []).concat(data.proximas || []);
        var res    = data.resolvidas || [];

        var h = '<div class="pac-pac-hdr ' + sevCls + '">' +
            '<div class="pac-leito">' + escHtml(l.cd_leito || '—') + '</div>' +
            '<div><div class="pac-nome">' + escHtml(fmtNome(l.nm_paciente)) + '</div>' +
            '<div class="pac-setor">' + escHtml(l.nm_setor || l.setor_apelido || '') + '</div></div>' +
            '</div>';

        if (pend.length) {
            h += '<div class="pac-secao">Pendentes (' + pend.length + ')</div>';
            for (var i = 0; i < pend.length; i++) h += _dosePacLinha(pend[i]);
        }
        if (res.length) {
            h += '<div class="pac-secao">Já checados (' + res.length + ')</div>';
            for (var j = 0; j < res.length; j++) h += _dosePacLinha(res[j]);
        }
        if (!pend.length && !res.length) {
            h += '<div class="vazio"><i class="fa-solid fa-circle-check"></i><b>Sem doses na janela</b></div>';
        }
        return h;
    }

    /**
     * Renderiza UMA DUPLA de pacientes (2 cards lado a lado) no paginador.
     * Avança de 2 em 2, voltando ao início em loop.
     * Com 1 paciente na lista, exibe um único card.
     */
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

        if (DOM.pacPos) {
            DOM.pacPos.textContent = mostrar === 1
                ? '1 / 1'
                : (idx + 1) + '–' + (idxB + 1) + ' / ' + total;
        }

        // Monta esqueleto com os slots vazios
        var h = '';
        for (var s = 0; s < mostrar; s++) {
            h += '<div class="pac-card-item" id="pac-slot-' + s + '">' +
                 '<div class="vazio"><i class="fa-solid fa-spinner fa-spin"></i>' +
                 '<b>Carregando…</b></div>' +
                 '</div>';
        }
        if (DOM.pacCard) DOM.pacCard.innerHTML = h;

        // Preenche cada slot independentemente via cache ou fetch
        for (var si = 0; si < mostrar; si++) {
            (function(slotNum, leitoIdx, baseIdx) {
                var l  = lista[leitoIdx];
                var nr = l.nr_atendimento;

                function setSlot(html) {
                    if (Estado.pac.idx !== baseIdx) return; // página mudou
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
        Estado.pac.progPct = 0;
        renderizarPaciente(Estado.pac.idx);

        Estado.pac.progTimer = setInterval(function() {
            Estado.pac.progPct += 100 / (CONFIG.PAC_INTERVALO / CONFIG.PAC_TICK);
            if (Estado.pac.progPct > 100) Estado.pac.progPct = 100;
            if (DOM.pacProgBar) DOM.pacProgBar.style.width = Estado.pac.progPct + '%';
        }, CONFIG.PAC_TICK);

        // Avança de 2 em 2 — loop via módulo em renderizarPaciente
        Estado.pac.timer = setInterval(function() {
            Estado.pac.progPct = 0;
            if (DOM.pacProgBar) DOM.pacProgBar.style.width = '0%';
            renderizarPaciente(Estado.pac.idx + 2);
        }, CONFIG.PAC_INTERVALO);
    }

    function pararPaginador() {
        if (Estado.pac.timer)     { clearInterval(Estado.pac.timer);     Estado.pac.timer     = null; }
        if (Estado.pac.progTimer) { clearInterval(Estado.pac.progTimer); Estado.pac.progTimer = null; }
    }

    // =========================================================================
    // DRAWER DO LEITO
    // =========================================================================

    function doseHtml(d) {
        var rot    = _DOSE_ROT[d.situacao] || { tg: '', label: d.situacao || '—', cls: '' };
        var atraso = parseInt(d.min_atraso) || 0;
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
            '</div></div></div>';
    }

    function abrirDrawer(idx) {
        var l = Estado.leitos[idx];
        if (!l) return;
        if (DOM.drwLeito) DOM.drwLeito.textContent = l.cd_leito || '—';
        if (DOM.drwPac)   DOM.drwPac.textContent   = fmtNome(l.nm_paciente);
        if (DOM.drwB)     DOM.drwB.innerHTML = '<div class="vazio"><i class="fa-solid fa-spinner fa-spin"></i><b>Carregando…</b></div>';
        if (DOM.drw) DOM.drw.classList.add('on');
        if (DOM.ovl) DOM.ovl.classList.add('on');

        fetch(CONFIG.ENDPOINTS.paciente + l.nr_atendimento, { credentials: 'same-origin' })
            .then(function(r) { return r.json(); })
            .then(function(data) {
                if (!data.success || !DOM.drwB) return;
                if (DOM.drwPac) {
                    DOM.drwPac.textContent = fmtNome(l.nm_paciente) + ' · ' +
                        (data.qt_total || 0) + ' dose' + ((data.qt_total || 0) !== 1 ? 's' : '') + ' hoje';
                }
                var h = '';
                var gs = [
                    { titulo: 'Precisa de ação',    doses: data.precisa_acao || [] },
                    { titulo: 'Nas próximas horas', doses: data.proximas     || [] },
                    { titulo: 'Já resolvidas',      doses: data.resolvidas   || [] }
                ];
                for (var g = 0; g < gs.length; g++) {
                    if (!gs[g].doses.length) continue;
                    h += '<div class="grupo">' + escHtml(gs[g].titulo) + ' (' + gs[g].doses.length + ')</div>';
                    for (var di = 0; di < gs[g].doses.length; di++) h += doseHtml(gs[g].doses[di]);
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
            fetch(CONFIG.ENDPOINTS.leitos    + params, { credentials: 'same-origin' }).then(function(r) { return r.json(); }),
            fetch(CONFIG.ENDPOINTS.tabela    + params, { credentials: 'same-origin' }).then(function(r) { return r.json(); })
        ])
        .then(function(results) {
            var dash = results[0], lts = results[1], tb = results[2];

            if (dash.success) renderizarKpis(dash.data || {});

            if (lts.success) {
                Estado.leitos = lts.data || [];
                renderizarMural(Estado.leitos);
                Estado.pac.cache = {};
                if (Estado.modo === 'pac') renderizarPaciente(Estado.pac.idx);
            }

            if (tb.success) {
                Estado.tabela = tb.data || [];
                if (Estado.modo === 'tabela') renderizarTabela(Estado.tabela);
            }

            Estado.ultimaAtualizacao = new Date();
            carregarFiltros();
        })
        .catch(function(e) { console.error('[P51] carregarDados:', e); })
        ['finally'](function() { Estado.carregando = false; });
    }

    // =========================================================================
    // MODO TV + AUTO-SCROLL
    // =========================================================================

    function toggleModoTV() {
        Estado.modoTV = !Estado.modoTV;
        salvar('modoTV', Estado.modoTV);
        document.body.classList.toggle('modo-tv', Estado.modoTV);
        if (DOM.btnTv) DOM.btnTv.classList.toggle('on', Estado.modoTV);
        if (Estado.modoTV) iniciarAutoScroll(); else pararAutoScroll();
    }

    function iniciarAutoScroll() {
        pararAutoScroll();
        Estado.scrollTimer = setInterval(function() {
            var el  = DOM.tbWrap || DOM.mural;
            if (!el) return;
            var max = el.scrollHeight - window.innerHeight;
            if (max <= 0) { window.scrollTo(0, 0); return; }
            var atual = window.scrollY || document.documentElement.scrollTop;
            if (atual >= max - 10) { window.scrollTo({ top: 0, behavior: 'smooth' }); }
            else                   { window.scrollBy({ top: 120, behavior: 'smooth' }); }
        }, CONFIG.AUTO_SCROLL_INTERVAL);
    }

    function pararAutoScroll() {
        if (Estado.scrollTimer) { clearInterval(Estado.scrollTimer); Estado.scrollTimer = null; }
    }

    // =========================================================================
    // INICIALIZAÇÃO
    // =========================================================================

    function inicializar() {
        DOM.setores    = document.getElementById('setores');
        DOM.kpis       = document.getElementById('kpis');
        DOM.mural      = document.getElementById('mural');
        DOM.tbWrap     = document.getElementById('tb-wrap');
        DOM.pacWrap    = document.getElementById('pac-wrap');
        DOM.pacCard    = document.getElementById('pac-card');
        DOM.pacPos     = document.getElementById('pac-pos');
        DOM.pacPrev    = document.getElementById('pac-prev');
        DOM.pacNext    = document.getElementById('pac-next');
        DOM.pacProgBar = document.getElementById('pac-prog-bar');
        DOM.ovl        = document.getElementById('ovl');
        DOM.drw        = document.getElementById('drw');
        DOM.drwLeito   = document.getElementById('drw-leito');
        DOM.drwPac     = document.getElementById('drw-pac');
        DOM.drwB       = document.getElementById('drw-b');
        DOM.drwX       = document.getElementById('drw-x');
        DOM.btnFoco    = document.getElementById('btnFoco');
        DOM.btnTv      = document.getElementById('btnTv');
        DOM.btnSom     = document.getElementById('btnSom');
        DOM.btnRefresh = document.getElementById('btn-refresh');
        DOM.relogio    = document.getElementById('relogio');

        Estado.filtros.setor = recuperar('setor', []);
        Estado.foco          = recuperar('foco', false);
        Estado.modoTV        = recuperar('modoTV', false);

        if (Estado.foco && DOM.btnFoco) DOM.btnFoco.classList.add('on');
        if (Estado.modoTV) {
            document.body.classList.add('modo-tv');
            if (DOM.btnTv) DOM.btnTv.classList.add('on');
            iniciarAutoScroll();
        }

        // Aplica visibilidade inicial das seções conforme Estado.modo
        if (DOM.mural)   DOM.mural.classList.toggle('hide',   Estado.modo !== 'mural');
        if (DOM.tbWrap)  DOM.tbWrap.classList.toggle('hide',  Estado.modo !== 'tabela');
        if (DOM.pacWrap) DOM.pacWrap.classList.toggle('hide', Estado.modo !== 'pac');

        // Relógio
        tickRelogio();
        setInterval(tickRelogio, 1000);

        // Abas — sincroniza estado visual com Estado.modo
        var tabs = document.querySelectorAll('.tab');
        for (var i0 = 0; i0 < tabs.length; i0++) {
            var m0 = tabs[i0].getAttribute('data-modo');
            tabs[i0].classList.toggle('on', m0 === Estado.modo);
            tabs[i0].setAttribute('aria-selected', m0 === Estado.modo ? 'true' : 'false');
        }

        for (var i = 0; i < tabs.length; i++) {
            (function(btn) {
                btn.addEventListener('click', function() {
                    for (var j = 0; j < tabs.length; j++) {
                        tabs[j].classList.remove('on');
                        tabs[j].setAttribute('aria-selected', 'false');
                    }
                    btn.classList.add('on');
                    btn.setAttribute('aria-selected', 'true');

                    var modoAnterior = Estado.modo;
                    Estado.modo = btn.getAttribute('data-modo');

                    if (DOM.mural)   DOM.mural.classList.toggle('hide',   Estado.modo !== 'mural');
                    if (DOM.tbWrap)  DOM.tbWrap.classList.toggle('hide',  Estado.modo !== 'tabela');
                    if (DOM.pacWrap) DOM.pacWrap.classList.toggle('hide', Estado.modo !== 'pac');

                    if (Estado.modo === 'pac') {
                        iniciarPaginador();
                    } else if (modoAnterior === 'pac') {
                        pararPaginador();
                    }

                    if (Estado.modo === 'tabela') renderizarTabela(Estado.tabela);
                });
            })(tabs[i]);
        }

        // Filtro "Só pendências"
        if (DOM.btnFoco) {
            DOM.btnFoco.addEventListener('click', function() {
                Estado.foco = !Estado.foco;
                DOM.btnFoco.classList.toggle('on', Estado.foco);
                salvar('foco', Estado.foco);
                renderizarMural(Estado.leitos);
                if (Estado.modo === 'tabela') renderizarTabela(Estado.tabela);
            });
        }

        // Paginador — prev/next avançam de 2 em 2
        if (DOM.pacPrev) {
            DOM.pacPrev.addEventListener('click', function() {
                pararPaginador();
                Estado.pac.progPct = 0;
                if (DOM.pacProgBar) DOM.pacProgBar.style.width = '0%';
                renderizarPaciente(Estado.pac.idx - 2);
                iniciarPaginador();
            });
        }
        if (DOM.pacNext) {
            DOM.pacNext.addEventListener('click', function() {
                pararPaginador();
                Estado.pac.progPct = 0;
                if (DOM.pacProgBar) DOM.pacProgBar.style.width = '0%';
                renderizarPaciente(Estado.pac.idx + 2);
                iniciarPaginador();
            });
        }

        if (DOM.btnTv) DOM.btnTv.addEventListener('click', function() { toggleModoTV(); });

        if (DOM.btnSom) {
            DOM.btnSom.addEventListener('click', function() {
                Estado.alertaSom = !Estado.alertaSom;
                DOM.btnSom.classList.toggle('on', Estado.alertaSom);
            });
        }

        if (DOM.btnRefresh) DOM.btnRefresh.addEventListener('click', function() { carregarDados(); });

        if (DOM.drwX) DOM.drwX.addEventListener('click', fecharDrawer);
        if (DOM.ovl)  DOM.ovl.addEventListener('click',  fecharDrawer);
        document.addEventListener('keydown', function(e) { if (e.key === 'Escape') fecharDrawer(); });

        var _intervalo = null;
        function startPolling() {
            if (_intervalo) clearInterval(_intervalo);
            _intervalo = setInterval(function() {
                if (!document.hidden) carregarDados();
            }, CONFIG.INTERVALO_REFRESH);
        }

        carregarFiltros();
        carregarDados();
        startPolling();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', inicializar);
    } else {
        inicializar();
    }

})();
