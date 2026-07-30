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
            rodadas:   '/api/paineis/painel51/rodadas',
            timeline:  '/api/paineis/painel51/timeline',
            tabela:    '/api/paineis/painel51/tabela',
            paciente:  '/api/paineis/painel51/paciente/'
        },
        INTERVALO_REFRESH: 60000,
        STORAGE_PREFIX: 'painel51_',
        AUTO_SCROLL_INTERVAL: 5000
    };

    // =========================================================================
    // ESTADO
    // =========================================================================
    var Estado = {
        filtros:    { setor: [], kpi: null },
        leitos:     [],
        timeline:   [],
        tabela:     [],
        modo:       'mural',
        foco:       false,
        modoTV:     false,
        alertaSom:  false,
        carregando: false,
        ultimaAtualizacao: null,
        scrollTimer: null
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
    // CONSTRUÇÃO DE PARAMS (fonte única para todas as URLs)
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
    // RENDER: SETORES
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
            var ativo = Estado.filtros.setor.indexOf(s.cd_setor) >= 0;
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
                    var cd = parseInt(btn.getAttribute('data-cd'));
                    var idx = Estado.filtros.setor.indexOf(cd);
                    if (idx >= 0) {
                        Estado.filtros.setor.splice(idx, 1);
                    } else {
                        Estado.filtros.setor = [cd];
                    }
                    salvar('setor', Estado.filtros.setor);
                    carregarDados();
                });
            })(btns[j]);
        }
    }

    // =========================================================================
    // RENDER: RODADA ATUAL
    // =========================================================================

    function renderizarRodada(data) {
        var rodada = data.rodada_atual;
        var rodadas = data.rodadas_dia || [];

        if (!rodada) {
            if (DOM.rodHora) DOM.rodHora.innerHTML = 'Sem rodada ativa';
            if (DOM.rodSub)  DOM.rodSub.textContent = '';
            if (DOM.anelPct) DOM.anelPct.textContent = '—';
            return;
        }

        var pct = parseInt(rodada.pct_concluida) || 0;
        var pend = parseInt(rodada.qt_pendentes) || 0;
        var total = parseInt(rodada.qt_doses) || 0;

        if (DOM.anelPct) DOM.anelPct.textContent = pct + '%';

        var arco = document.getElementById('anel-arco');
        if (arco) {
            arco.style.strokeDashoffset = 258 - (258 * pct / 100);
            arco.setAttribute('stroke',
                pct < 50 ? '#dc3545' : (pct < 85 ? '#fd7e14' : '#28a745'));
        }

        if (DOM.rodHora) {
            DOM.rodHora.innerHTML = escHtml(rodada.hora_rodada) +
                ' · <em>' + pend + ' pendente' + (pend !== 1 ? 's' : '') + '</em>';
        }
        if (DOM.rodSub) {
            DOM.rodSub.textContent = 'de ' + total + ' dose' + (total !== 1 ? 's' : '') +
                ' prevista' + (total !== 1 ? 's' : '') +
                ' em ' + (parseInt(rodada.qt_leitos) || 0) + ' leito' +
                ((parseInt(rodada.qt_leitos) || 0) !== 1 ? 's' : '');
        }

        // Chips das rodadas do dia
        if (DOM.rodChips) {
            var h = '';
            for (var i = 0; i < rodadas.length; i++) {
                var r = rodadas[i];
                var p2 = parseInt(r.pct_concluida) || 0;
                var atual = r.hora_rodada === rodada.hora_rodada;
                var barCor = p2 < 50 ? 'var(--s-atrasada)' :
                             (p2 < 85 ? 'var(--s-aberta)' : 'var(--s-ok)');
                h += '<div class="chip' + (atual ? ' agora' : '') + '">' +
                     '<b>' + escHtml(r.hora_rodada) + '</b>' +
                     '<span>' + p2 + '%</span>' +
                     '<div class="barra"><i style="width:' + p2 + '%;background:' + barCor + '"></i></div>' +
                     '</div>';
            }
            DOM.rodChips.innerHTML = h;
        }
    }

    // =========================================================================
    // RENDER: KPIs
    // =========================================================================

    function renderizarKpis(data) {
        if (!DOM.kpis) return;
        var defs = [
            { k: 'crit', c: 'k-crit', n: data.qt_criticas   || 0, l: 'Críticas',        ic: 'fa-triangle-exclamation' },
            { k: 'atr',  c: 'k-atr',  n: data.qt_atrasadas  || 0, l: 'Atrasadas',       ic: 'fa-clock'                },
            { k: 'abr',  c: 'k-abr',  n: data.qt_abertas    || 0, l: 'Janela aberta',   ic: 'fa-hourglass-half'       },
            { k: 'prx',  c: 'k-prx',  n: data.qt_proximas   || 0, l: 'Próximas 2h',     ic: 'fa-forward'              },
            { k: 'frm',  c: 'k-frm',  n: data.qt_sem_dispensacao || 0, l: 'Sem dispensação', ic: 'fa-prescription-bottle-medical' }
        ];
        var h = '';
        for (var i = 0; i < defs.length; i++) {
            var d = defs[i];
            h += '<div class="kpi ' + d.c + (Estado.filtros.kpi === d.k ? ' on' : '') +
                 '" data-k="' + d.k + '">' +
                 '<i class="ic fa-solid ' + d.ic + '"></i>' +
                 '<b>' + d.n + '</b>' +
                 '<span>' + d.l + '</span>' +
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
    // RENDER: CARD DE LEITO (mural)
    // =========================================================================

    var _SEV_CLS = ['sev0','sev1','sev2','sev3','sev4','sev5'];

    function leito_visivel(l) {
        if (Estado.foco && (parseInt(l.severidade_max) || 0) < 3) return false;
        var k = Estado.filtros.kpi;
        if (k === 'crit' && !(parseInt(l.qt_criticas) > 0))          return false;
        if (k === 'atr'  && !(parseInt(l.qt_atrasadas) > 0))         return false;
        if (k === 'abr'  && !(parseInt(l.qt_abertas) > 0))           return false;
        if (k === 'prx'  && !(parseInt(l.qt_proximas) > 0))          return false;
        if (k === 'frm'  && !(parseInt(l.qt_sem_dispensacao) > 0))   return false;
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

            var sev  = parseInt(l.severidade_max) || 0;
            var crit = parseInt(l.qt_criticas)    || 0;
            var atr  = parseInt(l.qt_atrasadas)   || 0;
            var abr  = parseInt(l.qt_abertas)     || 0;
            var prx  = parseInt(l.qt_proximas)    || 0;
            var ok   = parseInt(l.qt_administradas)|| 0;
            var just = parseInt(l.qt_justificadas) || 0;
            var agd  = parseInt(l.qt_doses) - crit - atr - abr - prx - ok - just;
            if (agd < 0) agd = 0;
            var disp = parseInt(l.qt_sem_dispensacao) || 0;
            var stat = parseInt(l.qt_stat_pendente)   || 0;
            var atraso = parseInt(l.maior_atraso_min) || 0;
            var total  = parseInt(l.qt_doses)         || 1;

            var pend = crit + atr + abr;
            var big  = pend > 0 ? pend : ok;
            var rot  = pend > 0 ? (crit > 0 ? 'atrasadas' : 'na janela') : 'em dia';

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
                 (stat > 0
                    ? '<span class="lt-tag warn"><i class="fa-solid fa-bolt"></i> ' + stat + ' STAT</span>'
                    : '') +
                 '</div>' +
                 '</article>';
        }

        if (mostrados === 0) {
            h = '<div class="vazio" style="grid-column:1/-1">' +
                '<i class="fa-solid fa-circle-check"></i>' +
                '<b>Nenhuma pendência neste filtro</b>' +
                '<p>Todas as doses do recorte estão administradas ou justificadas.</p>' +
                '</div>';
        }
        DOM.mural.innerHTML = h;

        var cards = DOM.mural.querySelectorAll('.leito');
        for (var j = 0; j < cards.length; j++) {
            (function(card) {
                card.addEventListener('click', function() {
                    var idx = parseInt(card.getAttribute('data-i'));
                    abrirDrawer(idx);
                });
            })(cards[j]);
        }
    }

    // =========================================================================
    // RENDER: LINHA DO TEMPO
    // =========================================================================

    var _SEV_TL_CLS = ['', 'c-just', 'c-prx', 'c-abr', 'c-atr', 'c-crit'];

    function renderizarTimeline(dados, leitos) {
        if (!DOM.tl) return;

        // Agrupa por leito → hora → {pior_severidade, qt_doses}
        var mapa = {};
        for (var i = 0; i < dados.length; i++) {
            var d = dados[i];
            var leito = d.cd_leito;
            var hora  = parseInt(d.hora) || 0;
            if (!mapa[leito]) mapa[leito] = { pac: d.nm_paciente, horas: {} };
            mapa[leito].horas[hora] = { sev: parseInt(d.pior_severidade) || 0, n: parseInt(d.qt_doses) || 0 };
        }

        var agora = new Date().getHours();
        var h = '<div class="tl-row head"><div class="tl-lab">Leito</div><div class="tl-cells">';
        for (var hr = 0; hr < 24; hr++) {
            h += '<div class="tl-h' + (hr === agora ? ' now' : '') + '">' +
                 (hr < 10 ? '0' : '') + hr + '</div>';
        }
        h += '</div></div>';

        // Ordena leitos por gravidade máxima (igual ao mural)
        var leitosOrdem = [];
        for (var lk in mapa) {
            if (mapa.hasOwnProperty(lk)) {
                var maxSev = 0;
                for (var hk in mapa[lk].horas) {
                    if (mapa[lk].horas.hasOwnProperty(hk)) {
                        if (mapa[lk].horas[hk].sev > maxSev) maxSev = mapa[lk].horas[hk].sev;
                    }
                }
                leitosOrdem.push({ leito: lk, pac: mapa[lk].pac, horas: mapa[lk].horas, maxSev: maxSev });
            }
        }
        leitosOrdem.sort(function(a, b) { return b.maxSev - a.maxSev; });

        for (var li = 0; li < leitosOrdem.length; li++) {
            var lobj = leitosOrdem[li];
            h += '<div class="tl-row"><div class="tl-lab">' + escHtml(lobj.leito) +
                 '<em>' + escHtml(fmtNome(lobj.pac).split(' ').slice(0,2).join(' ')) + '</em></div>' +
                 '<div class="tl-cells">';
            for (var hi = 0; hi < 24; hi++) {
                var cell = lobj.horas[hi];
                var cls  = cell ? (_SEV_TL_CLS[Math.min(cell.sev, 5)] || '') : '';
                h += '<div class="cell ' + cls + (hi === agora ? ' now-col' : '') + '">' +
                     (cell && cell.n > 0 ? cell.n : '') + '</div>';
            }
            h += '</div></div>';
        }

        DOM.tl.innerHTML = h;
    }

    // =========================================================================
    // RENDER: TABELA DE PACIENTES COM DOSES PENDENTES
    // =========================================================================

    function renderizarTabela(grupos) {
        if (!DOM.tbWrap) return;
        if (!grupos || !grupos.length) {
            DOM.tbWrap.innerHTML = '<div class="vazio">' +
                '<i class="fa-solid fa-circle-check"></i>' +
                '<b>Nenhuma pendência</b>' +
                '<p>Todas as doses estão administradas ou justificadas.</p></div>';
            return;
        }

        var k = Estado.filtros.kpi;
        var mapaSit = { crit: 'CRITICA', atr: 'ATRASADA', abr: 'ABERTA', prx: 'PROXIMA' };

        var h = '';
        var mostrados = 0;

        for (var i = 0; i < grupos.length; i++) {
            var g = grupos[i];

            // Filtra paciente por KPI ativo
            if (k && k !== 'frm') {
                var sitFiltro = mapaSit[k];
                var temSit = false;
                for (var xi = 0; xi < g.doses.length; xi++) {
                    if (g.doses[xi].situacao === sitFiltro) { temSit = true; break; }
                }
                if (!temSit) continue;
            }
            if (k === 'frm') {
                var temFrm = false;
                for (var xf = 0; xf < g.doses.length; xf++) {
                    if (g.doses[xf].pendente_farmacia) { temFrm = true; break; }
                }
                if (!temFrm) continue;
            }

            mostrados++;
            var sev = parseInt(g.severidade_max) || 0;
            var sevCls = _SEV_CLS[Math.min(sev, 5)];
            var nDoses = g.doses.length;

            h += '<div class="tb-bloco ' + sevCls + '">';

            // Cabeçalho do paciente
            h += '<div class="tb-hdr">' +
                 '<div class="tb-leito-num">' + escHtml(g.cd_leito || '—') + '</div>' +
                 '<div class="tb-pac-info">' +
                 '<b>' + escHtml(fmtNome(g.nm_paciente)) + '</b>' +
                 '<span>' + escHtml(g.nm_setor || '') + '</span>' +
                 '</div>' +
                 '<div class="tb-dose-count">' +
                 nDoses + ' dose' + (nDoses !== 1 ? 's' : '') + ' pendente' + (nDoses !== 1 ? 's' : '') +
                 '</div>' +
                 '</div>';

            // Linhas de dose
            for (var j = 0; j < g.doses.length; j++) {
                var d = g.doses[j];
                var rot = _DOSE_ROT[d.situacao] || { tg: '', label: d.situacao || '—', cls: '' };
                var atraso = parseInt(d.min_atraso) || 0;

                h += '<div class="tb-linha ' + rot.cls + '">' +
                     '<div class="tb-hora-cell">' + escHtml(d.hora_prevista || '--:--') + '</div>' +
                     '<div class="tb-med-cell">' +
                     '<div class="tb-med-nome">' + escHtml(d.ds_material || '—') + '</div>' +
                     '<div class="tb-med-posol">' +
                     escHtml((d.qt_dose ? d.qt_dose + ' ' : '') + (d.ds_unidade_medida || '')) +
                     (d.ds_intervalo ? ' · ' + escHtml(d.ds_intervalo) : '') +
                     '</div>' +
                     '</div>' +
                     '<div class="tb-tags-cell">' +
                     '<span class="tg ' + rot.tg + '">' + escHtml(rot.label) +
                     (atraso > 0 ? ' ' + fmtMin(atraso) : '') + '</span>' +
                     (d.alta_vigilancia
                         ? '<span class="tg tg-av" title="Alta vigilância"><i class="fa-solid fa-shield-halved"></i></span>'
                         : '') +
                     (d.pendente_farmacia
                         ? '<span class="tg tg-frm" title="Sem dispensação"><i class="fa-solid fa-prescription-bottle-medical"></i></span>'
                         : '') +
                     '</div>' +
                     '</div>';
            }

            h += '</div>'; // tb-bloco
        }

        if (mostrados === 0) {
            h = '<div class="vazio">' +
                '<i class="fa-solid fa-circle-check"></i>' +
                '<b>Nenhuma pendência neste filtro</b>' +
                '<p>Todas as doses do recorte estão resolvidas.</p></div>';
        }

        DOM.tbWrap.innerHTML = h;
    }

    // =========================================================================
    // DRAWER DO LEITO
    // =========================================================================

    var _DOSE_ROT = {
        CRITICA:      { tg: 'tg-crit', label: 'Crítica',           cls: 'd-crit' },
        ATRASADA:     { tg: 'tg-atr',  label: 'Atrasada',          cls: 'd-atr'  },
        ABERTA:       { tg: 'tg-abr',  label: 'Administrar agora', cls: 'd-abr'  },
        PROXIMA:      { tg: 'tg-prx',  label: 'Próxima',           cls: 'd-prx'  },
        AGENDADA:     { tg: 'tg-ok',   label: 'Agendada',          cls: 'd-ok'   },
        ADM_NO_PRAZO: { tg: 'tg-ok',   label: 'Administrada',      cls: 'd-ok'   },
        ADM_ANTECIPADA:{ tg:'tg-fora', label: 'Fora da janela',    cls: 'd-fora' },
        ADM_ATRASADA: { tg: 'tg-fora', label: 'Fora da janela',    cls: 'd-fora' },
        JUSTIFICADA:  { tg: 'tg-just', label: 'Justificada',       cls: 'd-just' },
        SEM_HORARIO:  { tg: 'tg-ok',   label: 'Sem horário fixo',  cls: 'd-ok'   }
    };

    function doseHtml(d) {
        var rot = _DOSE_ROT[d.situacao] || { tg: '', label: d.situacao || '—', cls: '' };
        var atraso = parseInt(d.min_atraso) || 0;
        var h = '<div class="dose ' + rot.cls + '">' +
                '<div class="d-hora">' + escHtml(d.hora_prevista || d.ds_horario || '--:--') + '</div>' +
                '<div class="d-corpo">' +
                '<div class="d-nome">' + escHtml(d.ds_material || '—') + '</div>' +
                '<div class="d-meta">' +
                escHtml((d.qt_dose ? d.qt_dose + ' ' : '') + (d.ds_unidade_medida || '')) +
                (d.ds_intervalo ? ' · ' + escHtml(d.ds_intervalo) : '') +
                '</div>' +
                '<div class="d-tags">' +
                '<span class="tg ' + rot.tg + '">' + escHtml(rot.label) +
                (atraso > 0 ? ' ' + fmtMin(atraso) : '') + '</span>' +
                (d.alta_vigilancia
                    ? '<span class="tg tg-av"><i class="fa-solid fa-shield-halved"></i> Alta vigilância</span>'
                    : '') +
                (d.pendente_farmacia
                    ? '<span class="tg tg-frm"><i class="fa-solid fa-prescription-bottle-medical"></i> Sem dispensação</span>'
                    : '') +
                (d.evento_rotulo && d.situacao === 'JUSTIFICADA'
                    ? '<span class="tg tg-just">' + escHtml(d.evento_rotulo) + '</span>'
                    : '') +
                '</div>' +
                '</div>' +
                '</div>';
        return h;
    }

    function abrirDrawer(idx) {
        var l = Estado.leitos[idx];
        if (!l) return;

        if (DOM.drwLeito) DOM.drwLeito.textContent = l.cd_leito || '—';
        if (DOM.drwPac)   DOM.drwPac.textContent   = fmtNome(l.nm_paciente);
        if (DOM.drwB)     DOM.drwB.innerHTML = '<div class="vazio"><i class="fa-solid fa-spinner fa-spin"></i><b>Carregando…</b></div>';
        if (DOM.drw)      DOM.drw.classList.add('on');
        if (DOM.ovl)      DOM.ovl.classList.add('on');

        fetch(CONFIG.ENDPOINTS.paciente + l.nr_atendimento, { credentials: 'same-origin' })
            .then(function(r) { return r.json(); })
            .then(function(data) {
                if (!data.success || !DOM.drwB) return;

                // Atualiza cabeçalho do drawer com total de doses
                if (DOM.drwPac) {
                    DOM.drwPac.textContent = fmtNome(l.nm_paciente) + ' · ' +
                        (data.qt_total || 0) + ' dose' + ((data.qt_total || 0) !== 1 ? 's' : '') + ' hoje';
                }

                var h = '';
                var grupos = [
                    { titulo: 'Precisa de ação', doses: data.precisa_acao || [] },
                    { titulo: 'Nas próximas horas', doses: data.proximas || [] },
                    { titulo: 'Já resolvidas', doses: data.resolvidas || [] }
                ];
                for (var g = 0; g < grupos.length; g++) {
                    var grp = grupos[g];
                    if (!grp.doses.length) continue;
                    h += '<div class="grupo">' + escHtml(grp.titulo) + ' (' + grp.doses.length + ')</div>';
                    for (var di = 0; di < grp.doses.length; di++) {
                        h += doseHtml(grp.doses[di]);
                    }
                }
                if (!h) {
                    h = '<div class="vazio"><i class="fa-solid fa-circle-check"></i>' +
                        '<b>Sem doses na janela operacional</b>' +
                        '<p>Nenhuma dose prevista para as próximas horas.</p></div>';
                }
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
            .then(function(data) {
                if (data.success) {
                    renderizarSetores(data.setores || []);
                }
            })
            .catch(function(e) { console.error('[P51] filtros:', e); });
    }

    function carregarDados() {
        if (Estado.carregando) return;
        Estado.carregando = true;
        var params = construirParams();

        Promise.all([
            fetch(CONFIG.ENDPOINTS.dashboard + params, { credentials: 'same-origin' }).then(function(r) { return r.json(); }),
            fetch(CONFIG.ENDPOINTS.leitos    + params, { credentials: 'same-origin' }).then(function(r) { return r.json(); }),
            fetch(CONFIG.ENDPOINTS.timeline  + params, { credentials: 'same-origin' }).then(function(r) { return r.json(); }),
            fetch(CONFIG.ENDPOINTS.tabela    + params, { credentials: 'same-origin' }).then(function(r) { return r.json(); })
        ])
        .then(function(results) {
            var dash = results[0];
            var lts  = results[1];
            var tl   = results[2];
            var tb   = results[3];

            if (dash.success) {
                renderizarRodada(dash.data || {});
                renderizarKpis(dash.data || {});
            }
            if (lts.success) {
                Estado.leitos = lts.data || [];
                renderizarMural(Estado.leitos);
            }
            if (tl.success) {
                Estado.timeline = tl.data || [];
                if (Estado.modo === 'tl') renderizarTimeline(Estado.timeline, Estado.leitos);
            }
            if (tb.success) {
                Estado.tabela = tb.data || [];
                if (Estado.modo === 'tabela') renderizarTabela(Estado.tabela);
            }

            Estado.ultimaAtualizacao = new Date();

            // Recarrega pills de setor com contagens ao vivo
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
            var el = DOM.mural;
            if (!el) return;
            var max = el.scrollHeight - window.innerHeight;
            if (max <= 0) { window.scrollTo(0, 0); return; }
            var atual = window.scrollY || document.documentElement.scrollTop;
            if (atual >= max - 10) {
                window.scrollTo({ top: 0, behavior: 'smooth' });
            } else {
                window.scrollBy({ top: 120, behavior: 'smooth' });
            }
        }, CONFIG.AUTO_SCROLL_INTERVAL);
    }

    function pararAutoScroll() {
        if (Estado.scrollTimer) { clearInterval(Estado.scrollTimer); Estado.scrollTimer = null; }
    }

    // =========================================================================
    // INICIALIZAÇÃO
    // =========================================================================

    function inicializar() {
        // Refs DOM
        DOM.setores  = document.getElementById('setores');
        DOM.rodHora  = document.getElementById('rod-hora');
        DOM.rodSub   = document.getElementById('rod-sub');
        DOM.anelPct  = document.getElementById('anel-pct');
        DOM.rodChips = document.getElementById('rod-chips');
        DOM.kpis     = document.getElementById('kpis');
        DOM.mural    = document.getElementById('mural');
        DOM.tbWrap   = document.getElementById('tb-wrap');
        DOM.tl       = document.getElementById('tl');
        DOM.tlWrap   = document.getElementById('tl-wrap');
        DOM.ovl      = document.getElementById('ovl');
        DOM.drw      = document.getElementById('drw');
        DOM.drwLeito = document.getElementById('drw-leito');
        DOM.drwPac   = document.getElementById('drw-pac');
        DOM.drwB     = document.getElementById('drw-b');
        DOM.drwX     = document.getElementById('drw-x');
        DOM.btnFoco  = document.getElementById('btnFoco');
        DOM.btnTv    = document.getElementById('btnTv');
        DOM.btnSom   = document.getElementById('btnSom');
        DOM.btnRefresh = document.getElementById('btn-refresh');
        DOM.relogio  = document.getElementById('relogio');

        // Restaura estado do localStorage (síncrono, antes do primeiro fetch)
        Estado.filtros.setor = recuperar('setor', []);
        Estado.foco          = recuperar('foco', false);
        Estado.modoTV        = recuperar('modoTV', false);

        if (Estado.foco && DOM.btnFoco) DOM.btnFoco.classList.add('on');
        if (Estado.modoTV) {
            document.body.classList.add('modo-tv');
            if (DOM.btnTv) DOM.btnTv.classList.add('on');
            iniciarAutoScroll();
        }

        // Relógio
        tickRelogio();
        setInterval(tickRelogio, 1000);

        // Abas mural / linha do tempo
        var tabs = document.querySelectorAll('.tab');
        for (var i = 0; i < tabs.length; i++) {
            (function(btn) {
                btn.addEventListener('click', function() {
                    for (var j = 0; j < tabs.length; j++) tabs[j].classList.remove('on');
                    btn.classList.add('on');
                    Estado.modo = btn.getAttribute('data-modo');
                    DOM.mural.classList.toggle('hide',  Estado.modo !== 'mural');
                    DOM.tbWrap.classList.toggle('hide', Estado.modo !== 'tabela');
                    DOM.tlWrap.classList.toggle('hide', Estado.modo !== 'tl');
                    if (Estado.modo === 'tl')     renderizarTimeline(Estado.timeline, Estado.leitos);
                    if (Estado.modo === 'tabela') renderizarTabela(Estado.tabela);
                });
            })(tabs[i]);
        }

        // Só pendências
        if (DOM.btnFoco) {
            DOM.btnFoco.addEventListener('click', function() {
                Estado.foco = !Estado.foco;
                DOM.btnFoco.classList.toggle('on', Estado.foco);
                salvar('foco', Estado.foco);
                renderizarMural(Estado.leitos);
                if (Estado.modo === 'tl') renderizarTimeline(Estado.timeline, Estado.leitos);
            });
        }

        // Modo TV
        if (DOM.btnTv) {
            DOM.btnTv.addEventListener('click', function() { toggleModoTV(); });
        }

        // Alertas sonoros (toggle visual apenas — implementação de áudio futura)
        if (DOM.btnSom) {
            DOM.btnSom.addEventListener('click', function() {
                Estado.alertaSom = !Estado.alertaSom;
                DOM.btnSom.classList.toggle('on', Estado.alertaSom);
            });
        }

        // Refresh manual
        if (DOM.btnRefresh) {
            DOM.btnRefresh.addEventListener('click', function() { carregarDados(); });
        }

        // Drawer
        if (DOM.drwX)  DOM.drwX.addEventListener('click', fecharDrawer);
        if (DOM.ovl)   DOM.ovl.addEventListener('click',  fecharDrawer);
        document.addEventListener('keydown', function(e) {
            if (e.key === 'Escape') fecharDrawer();
        });

        // Pausa refresh quando a aba está oculta (TV fica visível 24h)
        var _intervalo = null;
        function startPolling() {
            if (_intervalo) clearInterval(_intervalo);
            _intervalo = setInterval(function() {
                if (!document.hidden) carregarDados();
            }, CONFIG.INTERVALO_REFRESH);
        }

        // Carga inicial
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
