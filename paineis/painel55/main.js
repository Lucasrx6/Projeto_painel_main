/* Painel 55 — Auditoria Pré-Faturamento
 * ES5 IIFE — sem bundler, sem transpilação.
 *
 * Fluxo do auditor: escolher atendimento → executar regras → revisar achados → decidir.
 */
(function () {
    'use strict';

    var CONFIG = {
        api: {
            dashboard:          '/api/auditoria/dashboard',
            atendimentos:       '/api/auditoria/atendimentos',
            setores:            '/api/auditoria/setores',
            achados:    function (nric) { return '/api/auditoria/contas/' + encodeURIComponent(nric) + '/achados'; },
            auditar:    function (nric) { return '/api/auditoria/contas/' + encodeURIComponent(nric) + '/auditar'; },
            job:        function (id)   { return '/api/auditoria/jobs/' + encodeURIComponent(id); },
            feedback:   function (id)   { return '/api/auditoria/achados/' + id + '/feedback'; },
            explicarIa: function (id)   { return '/api/auditoria/achados/' + id + '/explicar-ia'; },
            validacao:          '/api/auditoria/validacao',
            iaStatus:           '/api/auditoria/ia/status',
            materialAlias:      '/api/auditoria/material-alias',
            materialAliasId:    function (id) { return '/api/auditoria/material-alias/' + id; },
            materialCatalogo:   '/api/auditoria/material-catalogo',
            materialAliasSugIa: '/api/auditoria/material-alias/sugerir-ia',
            itensNaoMapeados:   '/api/auditoria/itens-nao-mapeados',
            resumoPaciente: function (nr, nric, regenerar) {
                var url = '/api/auditoria/atendimentos/' + encodeURIComponent(nr) + '/resumo';
                var params = [];
                if (nric) params.push('nr_interno_conta=' + encodeURIComponent(nric));
                if (regenerar) params.push('regenerar=1');
                return params.length ? url + '?' + params.join('&') : url;
            }
        },
        pollMs: 1500,
        pollMax: 200,          // ~5 min (200 × 1,5 s) — cobre jobs com IA em muitas evoluções
        porPagina: 100,
        debounceMs: 350
    };

    var ORDEM_GRAV = { critica: 0, alta: 1, media: 2, baixa: 3 };
    var STATUS_LISTA = ['pendente', 'procede_corrigido', 'nao_procede', 'ja_justificado'];

    var Estado = {
        // sidebar
        atendimentos: [], total: 0, pagina: 1, reqLista: 0,
        setores: [], setorFiltro: '', gravFiltro: '', busca: '',
        // seleção
        atendimentoAtivo: null, contaAtiva: null,
        // achados
        achados: [], visiveis: [], achadosCarregando: false, achadosErro: false, reqAchados: 0,
        statusFiltro: '', regraSel: {}, tipoSel: {}, buscaAchado: '', ordem: 'gravidade',
        expandidos: {},
        // job
        jobId: null, jobTimer: null, pollTentativas: 0, jobInicio: 0,
        analiseFeita: false, analiseQtTotal: null, analiseIaUsada: false,
        // decisão
        feedbackAchado: null, proximoPendente: true,
        // ambiente / mapeamentos / resumo
        validacaoRodando: false,
        mapPend: [], mapSug: [], mapBuscaTimer: null,
        resumoReq: 0
    };

    var DOM = {};
    var _buscaTimer = null;
    var _buscaAchadoTimer = null;

    // =========================================================
    // Utilitários
    // =========================================================

    function $(id) { return document.getElementById(id); }

    function qs(sel, root) { return (root || document).querySelector(sel); }

    function qsa(sel, root) {
        return Array.prototype.slice.call((root || document).querySelectorAll(sel));
    }

    function esc(v) {
        return String(v === null || v === undefined ? '' : v)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function closest(el, sel, stop) {
        var m = Element.prototype.matches || Element.prototype.msMatchesSelector ||
                Element.prototype.webkitMatchesSelector;
        while (el && el !== stop && el.nodeType === 1) {
            if (m.call(el, sel)) return el;
            el = el.parentNode;
        }
        return null;
    }

    function setClass(el, cls, on) {
        if (!el) return;
        if (on) el.classList.add(cls); else el.classList.remove(cls);
    }

    function temChaves(obj) {
        for (var k in obj) { if (Object.prototype.hasOwnProperty.call(obj, k)) return true; }
        return false;
    }

    function contarChaves(obj) {
        var n = 0;
        for (var k in obj) { if (Object.prototype.hasOwnProperty.call(obj, k)) n++; }
        return n;
    }

    function moeda(v, vazioSeZero) {
        var n = parseFloat(v);
        if (isNaN(n) || (vazioSeZero && n === 0)) return '';
        return 'R$ ' + n.toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, '.');
    }

    function formatarData(iso) {
        if (!iso) return '';
        var p = String(iso).substring(0, 10).split('-');
        return p.length === 3 ? p[2] + '/' + p[1] + '/' + p[0] : String(iso).substring(0, 10);
    }

    function formatarDataHora(iso) {
        if (!iso) return '';
        var s = String(iso).replace('T', ' ');
        var d = formatarData(s);
        var h = s.substring(11, 16);
        return h ? d + ' ' + h : d;
    }

    function plural(n, um, varios) { return n + ' ' + (n === 1 ? um : varios); }

    function labelGravidade(g) {
        var m = { critica: 'Crítica', alta: 'Alta', media: 'Média', baixa: 'Baixa' };
        return m[g] || (g || '');
    }

    function labelTipo(t) {
        var m = {
            cobrado_sem_respaldo:   'Cobrado s/ respaldo',
            realizado_sem_cobranca: 'Realizado s/ cobrança',
            quantidade:             'Quantidade',
            data:                   'Data',
            assinatura:             'Assinatura',
            documento_ausente:      'Documento ausente',
            inconsistencia_tasy:    'Inconsistência Tasy'
        };
        return m[t] || (t || '');
    }

    function labelStatus(s) {
        var m = { pendente: 'Pendente', procede_corrigido: 'Corrigido', nao_procede: 'Não procede', ja_justificado: 'Justificado' };
        return m[s] || (s || '');
    }

    function iconeStatus(s) {
        var m = { pendente: 'fa-hourglass-half', procede_corrigido: 'fa-circle-check', nao_procede: 'fa-circle-xmark', ja_justificado: 'fa-file-circle-check' };
        return m[s] || 'fa-circle';
    }

    function classeStatus(s) {
        var m = { pendente: 'status-pendente', procede_corrigido: 'status-procede', nao_procede: 'status-nao-procede', ja_justificado: 'status-justificado' };
        return m[s] || 'status-pendente';
    }

    function badgeGravidade(g) {
        return '<span class="grav grav-' + esc(g) + '">' + esc(labelGravidade(g)) + '</span>';
    }

    function badgeStatus(s) {
        return '<span class="status-badge ' + classeStatus(s) + '"><i class="fa ' + iconeStatus(s) + '"></i>' +
               esc(labelStatus(s)) + '</span>';
    }

    function lerPref(chave, padrao) {
        try {
            var v = localStorage.getItem(chave);
            return v === null ? padrao : v;
        } catch (e) { return padrao; }
    }

    function gravarPref(chave, valor) {
        try { localStorage.setItem(chave, valor); } catch (e) { /* modo privado */ }
    }

    // =========================================================
    // Rede
    // =========================================================

    function api(url, opts) {
        var o = opts || {};
        o.credentials = 'same-origin';
        o.headers = o.headers || {};
        if (o.body) o.headers['Content-Type'] = 'application/json';
        return fetch(url, o).then(function (r) {
            if (r.status === 401) {
                window.location.href = '/login?next=' + encodeURIComponent(window.location.pathname);
                throw new Error('sessao_expirada');
            }
            return r.json().catch(function () {
                return { success: false, error: 'Resposta inválida do servidor' };
            });
        });
    }

    // =========================================================
    // Toasts e modais
    // =========================================================

    function toast(msg, tipo, ms) {
        tipo = tipo || 'info';
        var el = document.createElement('div');
        var ic = tipo === 'ok' ? 'fa-circle-check' : (tipo === 'erro' ? 'fa-circle-exclamation' : 'fa-circle-info');
        el.className = 'toast toast-' + tipo;
        el.setAttribute('role', tipo === 'erro' ? 'alert' : 'status');
        el.innerHTML = '<i class="fa ' + ic + '"></i><span>' + esc(msg) + '</span>';
        DOM.toasts.appendChild(el);

        function remover() {
            el.classList.add('saindo');
            setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 300);
        }
        el.addEventListener('click', remover);
        setTimeout(remover, ms || (tipo === 'erro' ? 7000 : 3500));
    }

    var _pilhaModais = [];
    var _aoFechar = {};

    function abrirModalEl(id, focoSel) {
        var m = $(id);
        if (!m) return;
        _pilhaModais.push({ id: id, gatilho: document.activeElement });
        m.classList.add('aberto');
        var alvo = focoSel ? qs(focoSel, m) : null;
        if (!alvo) {
            alvo = qs('.modal-box', m);
            if (alvo) alvo.setAttribute('tabindex', '-1');
        }
        if (alvo && alvo.focus) alvo.focus();
    }

    function fecharModalEl(id) {
        var m = $(id);
        if (!m || !m.classList.contains('aberto')) return;
        m.classList.remove('aberto');
        var gatilho = null;
        for (var i = _pilhaModais.length - 1; i >= 0; i--) {
            if (_pilhaModais[i].id === id) {
                gatilho = _pilhaModais[i].gatilho;
                _pilhaModais.splice(i, 1);
                break;
            }
        }
        if (_aoFechar[id]) _aoFechar[id]();
        if (gatilho && gatilho.focus && document.body.contains(gatilho)) gatilho.focus();
    }

    function modalAberto() { return _pilhaModais.length > 0; }

    function onTeclaGlobal(e) {
        var topo = _pilhaModais.length ? _pilhaModais[_pilhaModais.length - 1] : null;

        if (e.key === 'Escape' && topo) {
            e.preventDefault();
            fecharModalEl(topo.id);
            return;
        }

        // Prende o Tab dentro do modal aberto
        if (e.key === 'Tab' && topo) {
            var box = qs('.modal-box', $(topo.id));
            var foc = qsa('a[href], button:not(:disabled), input:not(:disabled):not([type=hidden]), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])', box)
                .filter(function (el) { return el.offsetParent !== null; });
            if (!foc.length) return;
            var primeiro = foc[0], ultimo = foc[foc.length - 1];
            if (e.shiftKey && (document.activeElement === primeiro || document.activeElement === box)) {
                e.preventDefault(); ultimo.focus();
            } else if (!e.shiftKey && document.activeElement === ultimo) {
                e.preventDefault(); primeiro.focus();
            }
            return;
        }

        // "/" foca a busca (fora de campos de texto)
        if (e.key === '/' && !topo) {
            var tag = (document.activeElement && document.activeElement.tagName) || '';
            if (tag !== 'INPUT' && tag !== 'TEXTAREA' && tag !== 'SELECT') {
                e.preventDefault();
                abrirSidebar(true);
                DOM.filtroBusca.focus();
                DOM.filtroBusca.select();
            }
        }
    }

    var _confirmCb = null;

    function confirmar(titulo, msg, rotuloOk, cb) {
        $('confirm-titulo').textContent = titulo;
        $('confirm-msg').textContent = msg;
        $('confirm-ok').textContent = rotuloOk || 'Confirmar';
        _confirmCb = cb;
        abrirModalEl('modal-confirm', '#confirm-ok');
    }

    // =========================================================
    // Indicadores globais (barra superior)
    // =========================================================

    function carregarDashboard() {
        api(CONFIG.api.dashboard)
            .then(function (data) {
                if (!data.success) return;
                var s = data.stats || {};
                DOM.statContas.textContent    = s.total_contas   != null ? s.total_contas   : '0';
                DOM.statCriticos.textContent  = s.criticos       != null ? s.criticos       : '0';
                DOM.statPendentes.textContent = s.pendentes      != null ? s.pendentes      : '0';
                DOM.statRisco.textContent     = s.vl_risco_total != null ? moeda(s.vl_risco_total) : '–';
            })
            .catch(function () { DOM.statContas.textContent = '!'; });
    }

    // =========================================================
    // Lista de atendimentos (sidebar)
    // =========================================================

    function nomeSetor(cd) {
        if (!cd) return '';
        for (var i = 0; i < Estado.setores.length; i++) {
            if (Estado.setores[i].cd === cd) return Estado.setores[i].nm;
        }
        return 'Setor ' + cd;
    }

    function carregarSetores() {
        api(CONFIG.api.setores)
            .then(function (data) {
                if (!data.success) return;
                Estado.setores = data.setores || [];
                var html = '<option value="">Todos os setores</option>';
                for (var i = 0; i < Estado.setores.length; i++) {
                    var s = Estado.setores[i];
                    html += '<option value="' + esc(s.cd) + '">' + esc(s.nm) + '</option>';
                }
                DOM.filtroSetor.innerHTML = html;
                DOM.filtroSetor.value = Estado.setorFiltro;
                // Nomes dos setores chegam depois da lista: redesenha
                if (Estado.atendimentos.length) renderAtendimentos();
            })
            .catch(function () { /* filtro de setor é opcional */ });
    }

    function urlAtendimentos(pagina) {
        var p = [];
        if (Estado.busca)       p.push('busca='     + encodeURIComponent(Estado.busca));
        if (Estado.gravFiltro)  p.push('gravidade=' + encodeURIComponent(Estado.gravFiltro));
        if (Estado.setorFiltro) p.push('setor='     + encodeURIComponent(Estado.setorFiltro));
        p.push('pagina=' + pagina);
        p.push('por_pagina=' + CONFIG.porPagina);
        return CONFIG.api.atendimentos + '?' + p.join('&');
    }

    function htmlSkeleton() {
        var h = '';
        for (var i = 0; i < 7; i++) {
            h += '<div class="skel"><div class="skel-l" style="width:' + (45 + (i * 7) % 35) + '%"></div>' +
                 '<div class="skel-l" style="width:80%"></div><div class="skel-l" style="width:55%"></div></div>';
        }
        return h;
    }

    /**
     * opts.anexar     — carrega a próxima página e acrescenta
     * opts.silencioso — recarrega o que já está na tela sem piscar/perder o scroll
     */
    function carregarAtendimentos(opts) {
        opts = opts || {};
        var token = ++Estado.reqLista;
        var paginas = [];
        var i;

        if (opts.anexar) {
            Estado.pagina += 1;
            paginas = [Estado.pagina];
            DOM.btnMais.disabled = true;
        } else if (opts.silencioso) {
            for (i = 1; i <= Estado.pagina; i++) paginas.push(i);
        } else {
            Estado.pagina = 1;
            paginas = [1];
            DOM.contasLista.innerHTML = htmlSkeleton();
            DOM.btnMais.hidden = true;
        }

        Promise.all(paginas.map(function (p) { return api(urlAtendimentos(p)); }))
            .then(function (resps) {
                if (token !== Estado.reqLista) return;
                DOM.btnMais.disabled = false;

                var ok = resps.every(function (r) { return r && r.success; });
                if (!ok) {
                    if (opts.anexar) { Estado.pagina -= 1; toast('Não foi possível carregar mais atendimentos.', 'erro'); return; }
                    if (opts.silencioso && Estado.atendimentos.length) return;
                    renderErroLista('Não foi possível carregar os atendimentos.');
                    return;
                }

                var lote = [];
                for (var k = 0; k < resps.length; k++) lote = lote.concat(resps[k].atendimentos || []);
                Estado.atendimentos = opts.anexar ? Estado.atendimentos.concat(lote) : lote;
                Estado.total = resps[0].total || 0;

                religarSelecao();
                var scroll = DOM.contasLista.scrollTop;
                renderAtendimentos();
                if (opts.silencioso || opts.anexar) DOM.contasLista.scrollTop = scroll;
            })
            .catch(function () {
                if (token !== Estado.reqLista) return;
                DOM.btnMais.disabled = false;
                if (opts.anexar) { Estado.pagina -= 1; toast('Falha de comunicação ao carregar mais.', 'erro'); return; }
                if (!opts.silencioso) renderErroLista('Erro de comunicação com o servidor.');
            });
    }

    /** Após recarregar a lista, reaponta atendimento/conta ativos para os objetos novos. */
    function religarSelecao() {
        if (!Estado.atendimentoAtivo) return;
        var nr = Estado.atendimentoAtivo.nr_atendimento;
        for (var i = 0; i < Estado.atendimentos.length; i++) {
            if (Estado.atendimentos[i].nr_atendimento === nr) {
                Estado.atendimentoAtivo = Estado.atendimentos[i];
                var contas = Estado.atendimentoAtivo.contas || [];
                for (var j = 0; j < contas.length; j++) {
                    if (Estado.contaAtiva && contas[j].nr_interno_conta === Estado.contaAtiva.nr_interno_conta) {
                        Estado.contaAtiva = contas[j];
                    }
                }
                renderCabecalhoConta();
                return;
            }
        }
    }

    function renderErroLista(msg) {
        DOM.contasTotal.textContent = 'Atendimentos';
        DOM.btnMais.hidden = true;
        DOM.contasLista.innerHTML =
            '<div class="lista-msg lista-msg-erro"><i class="fa fa-triangle-exclamation"></i>' +
            esc(msg) + '<br><button type="button" class="btn btn-ghost btn-sm" data-act="recarregar-lista">' +
            '<i class="fa fa-rotate"></i> Tentar novamente</button></div>';
    }

    function atendimentoAnalisado(at) {
        var contas = at.contas || [];
        for (var i = 0; i < contas.length; i++) {
            if (contas[i].status_job === 'concluida') return true;
        }
        return false;
    }

    function htmlAtendimento(at, idx) {
        var ativo = Estado.atendimentoAtivo && Estado.atendimentoAtivo.nr_atendimento === at.nr_atendimento;
        var grav  = at.gravidade_maxima || '';
        var setor = nomeSetor(at.cd_setor_atendimento);
        var sub   = [];
        if (setor) sub.push(setor);
        sub.push(plural(at.qt_contas || 0, 'conta', 'contas'));
        if (at.dt_periodo_final_max) sub.push('até ' + formatarData(at.dt_periodo_final_max));

        var defs = [['criticos', 'critica'], ['altos', 'alta'], ['medios', 'media'], ['baixos', 'baixa']];
        var tags = '';
        for (var i = 0; i < defs.length; i++) {
            var n = at[defs[i][0]];
            if (n) {
                tags += '<span class="dot-count dot-' + defs[i][1] + '" title="' +
                        esc(labelGravidade(defs[i][1]) + ': ' + n) + '"><i></i>' + n + '</span>';
            }
        }
        if (at.pendentes) {
            tags += '<span class="at-pend">' + plural(at.pendentes, 'pendente', 'pendentes') + '</span>';
        } else if (at.total_achados) {
            tags += '<span class="at-ok"><i class="fa fa-check"></i> tratado</span>';
        }
        if (!atendimentoAnalisado(at) && !at.total_achados) {
            tags += '<span class="at-nova">não analisado</span>';
        }

        return '<button type="button" role="listitem" class="at-item' + (grav ? ' grav-' + esc(grav) : '') +
               (ativo ? ' ativo' : '') + '" data-idx="' + idx + '"' + (ativo ? ' aria-current="true"' : '') + '>' +
               '<span class="at-stripe"></span><span class="at-body">' +
               '<span class="at-linha"><span class="at-nr">AT ' + esc(at.nr_atendimento) + '</span>' +
               (at.vl_risco_total ? '<span class="at-risco">' + esc(moeda(at.vl_risco_total, true)) + '</span>' : '') +
               '</span>' +
               '<span class="at-sub" title="' + esc(sub.join(' · ')) + '">' + esc(sub.join(' · ')) + '</span>' +
               (tags ? '<span class="at-tags">' + tags + '</span>' : '') +
               '</span></button>';
    }

    function renderAtendimentos() {
        var filtrando = !!(Estado.busca || Estado.gravFiltro || Estado.setorFiltro);
        DOM.contasTotal.textContent = Estado.total > 0
            ? plural(Estado.total, 'atendimento', 'atendimentos')
            : 'Atendimentos';

        DOM.btnMais.hidden = Estado.atendimentos.length >= Estado.total;

        if (!Estado.atendimentos.length) {
            DOM.contasLista.innerHTML =
                '<div class="lista-msg"><i class="fa fa-folder-open"></i>' +
                (filtrando ? 'Nenhum atendimento com esses filtros.' : 'Nenhum atendimento aberto no momento.') +
                (filtrando ? '<br><button type="button" class="btn btn-ghost btn-sm" data-act="limpar-filtros-lista">' +
                             '<i class="fa fa-filter-circle-xmark"></i> Limpar filtros</button>' : '') +
                '</div>';
            return;
        }

        var html = '';
        for (var i = 0; i < Estado.atendimentos.length; i++) html += htmlAtendimento(Estado.atendimentos[i], i);
        DOM.contasLista.innerHTML = html;
    }

    function limparFiltrosLista() {
        Estado.busca = ''; Estado.gravFiltro = ''; Estado.setorFiltro = '';
        DOM.filtroBusca.value = '';
        DOM.filtroSetor.value = '';
        marcarSegGravidade('');
        carregarAtendimentos();
    }

    function marcarSegGravidade(valor) {
        var bs = qsa('.seg-btn', DOM.filtroGrav);
        for (var i = 0; i < bs.length; i++) {
            setClass(bs[i], 'ativo', bs[i].getAttribute('data-grav') === valor);
        }
    }

    function abrirSidebar(abrir) {
        setClass(DOM.sidebar, 'aberta', abrir);
        setClass(DOM.scrim, 'aberto', abrir);
    }

    // =========================================================
    // Seleção de atendimento / conta
    // =========================================================

    function pararPolling() {
        if (Estado.jobTimer) { clearTimeout(Estado.jobTimer); Estado.jobTimer = null; }
        Estado.jobId = null;
        Estado.pollTentativas = 0;
        DOM.jobBar.hidden = true;
        DOM.btnExecutar.disabled = false;
    }

    function resetarFiltrosAchados() {
        Estado.statusFiltro = '';
        Estado.regraSel = {};
        Estado.tipoSel = {};
        Estado.buscaAchado = '';
        Estado.expandidos = {};
        DOM.achadosBusca.value = '';
    }

    function selecionarAtendimento(idx) {
        var at = Estado.atendimentos[idx];
        if (!at) return;
        if (!at.contas || !at.contas.length) {
            toast('Este atendimento não possui contas abertas.', 'info');
            return;
        }
        pararPolling();
        Estado.atendimentoAtivo = at;
        Estado.contaAtiva = at.contas[0];
        Estado.analiseFeita = false;
        Estado.analiseQtTotal = null;
        Estado.analiseIaUsada = false;
        resetarFiltrosAchados();

        qsa('.at-item', DOM.contasLista).forEach(function (b) {
            var ativo = parseInt(b.getAttribute('data-idx'), 10) === idx;
            setClass(b, 'ativo', ativo);
            if (ativo) b.setAttribute('aria-current', 'true'); else b.removeAttribute('aria-current');
        });

        DOM.emptyState.hidden = true;
        DOM.contaDetalhe.hidden = false;
        abrirSidebar(false);
        renderCabecalhoConta();
        carregarAchados();
    }

    function trocarConta(nric) {
        var contas = (Estado.atendimentoAtivo && Estado.atendimentoAtivo.contas) || [];
        for (var i = 0; i < contas.length; i++) {
            if (String(contas[i].nr_interno_conta) === String(nric)) {
                if (Estado.contaAtiva && Estado.contaAtiva.nr_interno_conta === contas[i].nr_interno_conta) return;
                pararPolling();
                Estado.contaAtiva = contas[i];
                Estado.analiseFeita = false;
                Estado.analiseQtTotal = null;
                Estado.analiseIaUsada = false;
                resetarFiltrosAchados();
                renderCabecalhoConta();
                carregarAchados();
                return;
            }
        }
    }

    function contaAnalisada() {
        return Estado.analiseFeita || !!(Estado.contaAtiva && Estado.contaAtiva.status_job === 'concluida');
    }

    function renderCabecalhoConta() {
        var at = Estado.atendimentoAtivo, c = Estado.contaAtiva;
        if (!at || !c) return;

        var setor = nomeSetor(at.cd_setor_atendimento);
        DOM.detalheTitulo.innerHTML = 'Atendimento ' + esc(at.nr_atendimento) +
            (setor ? '<span class="conta-setor">' + esc(setor) + '</span>' : '');

        var meta = '<span><i class="fa fa-file-invoice"></i>Conta ' + esc(c.nr_interno_conta) + '</span>';
        if (c.dt_periodo_inicial || c.dt_periodo_final) {
            meta += '<span><i class="fa fa-calendar-days"></i>Período ' +
                esc(formatarData(c.dt_periodo_inicial) || '…') + ' a ' + esc(formatarData(c.dt_periodo_final) || '…') + '</span>';
        }
        if (contaAnalisada()) {
            meta += '<span><i class="fa fa-clock-rotate-left"></i>' +
                (c.dt_ultima_auditoria ? 'Última análise ' + esc(formatarDataHora(c.dt_ultima_auditoria)) : 'Conta analisada') + '</span>';
        } else {
            meta += '<span class="meta-nao"><i class="fa fa-circle-exclamation"></i>Ainda não analisada</span>';
        }
        DOM.detalheMeta.innerHTML = meta;

        // Seletor de conta
        var contas = at.contas || [];
        DOM.contaWrap.hidden = contas.length <= 1;
        if (contas.length > 1) {
            var usarSelect = contas.length > 5;
            DOM.contaPills.hidden = usarSelect;
            DOM.contaSelector.hidden = !usarSelect;
            var htmlP = '', htmlS = '';
            for (var i = 0; i < contas.length; i++) {
                var k = contas[i];
                var ativo = String(k.nr_interno_conta) === String(c.nr_interno_conta);
                var rot = 'Nº ' + k.nr_interno_conta + (k.dt_periodo_final ? ' · até ' + formatarData(k.dt_periodo_final) : '');
                htmlP += '<button type="button" class="pill' + (ativo ? ' ativo' : '') + '" data-conta="' +
                         esc(k.nr_interno_conta) + '"' + (ativo ? ' aria-pressed="true"' : '') + '>' + esc(rot) + '</button>';
                htmlS += '<option value="' + esc(k.nr_interno_conta) + '"' + (ativo ? ' selected' : '') + '>' + esc(rot) + '</option>';
            }
            DOM.contaPills.innerHTML = htmlP;
            DOM.contaSelector.innerHTML = htmlS;
        }
    }

    // =========================================================
    // Achados
    // =========================================================

    function carregarAchados() {
        if (!Estado.contaAtiva) return;
        var token = ++Estado.reqAchados;
        Estado.achadosCarregando = true;
        Estado.achadosErro = false;
        Estado.achados = [];
        renderConta();

        // Traz todos os status: filtros, contadores e progresso são calculados no cliente
        api(CONFIG.api.achados(Estado.contaAtiva.nr_interno_conta))
            .then(function (data) {
                if (token !== Estado.reqAchados) return;
                Estado.achadosCarregando = false;
                if (!data.success) {
                    Estado.achados = [];
                    Estado.achadosErro = true;
                } else {
                    Estado.achados = data.achados || [];
                }
                renderConta();
            })
            .catch(function () {
                if (token !== Estado.reqAchados) return;
                Estado.achadosCarregando = false;
                Estado.achadosErro = true;
                Estado.achados = [];
                renderConta();
            });
    }

    function acharAchado(id) {
        for (var i = 0; i < Estado.achados.length; i++) {
            if (String(Estado.achados[i].id) === String(id)) return Estado.achados[i];
        }
        return null;
    }

    /** Achados após filtros de regra, categoria e texto (ainda sem filtro de status). */
    function achadosBase() {
        var q = Estado.buscaAchado.toLowerCase();
        var temR = temChaves(Estado.regraSel), temT = temChaves(Estado.tipoSel);
        if (!q && !temR && !temT) return Estado.achados.slice();
        return Estado.achados.filter(function (a) {
            if (temR && !Estado.regraSel[a.cd_regra || 'S/N']) return false;
            if (temT && !Estado.tipoSel[a.tipo_achado || 'outro']) return false;
            if (q) {
                var palheiro = [a.cd_regra, a.ds_regra, a.ds_encontrado, a.ds_esperado,
                                labelTipo(a.tipo_achado), a.item_ref].join(' ').toLowerCase();
                if (palheiro.indexOf(q) === -1) return false;
            }
            return true;
        });
    }

    function ordenarAchados(lista) {
        var porRisco = Estado.ordem === 'risco';
        lista.sort(function (a, b) {
            var ga = ORDEM_GRAV[a.gravidade] != null ? ORDEM_GRAV[a.gravidade] : 9;
            var gb = ORDEM_GRAV[b.gravidade] != null ? ORDEM_GRAV[b.gravidade] : 9;
            var ra = parseFloat(a.vl_risco) || 0, rb = parseFloat(b.vl_risco) || 0;
            if (porRisco) {
                if (rb !== ra) return rb - ra;
                if (ga !== gb) return ga - gb;
            } else {
                if (ga !== gb) return ga - gb;
                if (rb !== ra) return rb - ra;
            }
            return a.id - b.id;
        });
        return lista;
    }

    function renderConta() {
        renderKpisConta();
        renderFiltrosAchados();
        renderListaAchados();
        DOM.btnResumo.disabled = !Estado.atendimentoAtivo;
    }

    function renderKpisConta() {
        var tot = Estado.achados.length, pend = 0, crit = 0, critPend = 0, risco = 0, riscoPend = 0;
        for (var i = 0; i < tot; i++) {
            var a = Estado.achados[i];
            var v = parseFloat(a.vl_risco) || 0;
            var p = a.status_tratamento === 'pendente';
            risco += v;
            if (p) { pend++; riscoPend += v; }
            if (a.gravidade === 'critica') { crit++; if (p) critPend++; }
        }
        var tratados = tot - pend;
        var pct = tot ? Math.round(tratados / tot * 100) : 0;

        DOM.contaKpis.innerHTML =
            '<div class="ckpi"><div class="ckpi-label">Achados</div><div class="ckpi-value">' + tot + '</div>' +
            '<div class="ckpi-sub">' + (tot ? tratados + ' de ' + tot + ' tratados (' + pct + '%)' : 'nenhum registrado') + '</div>' +
            (tot ? '<div class="progress"><div class="progress-bar" style="width:' + pct + '%"></div></div>' : '') + '</div>' +

            '<div class="ckpi"><div class="ckpi-label">Pendentes</div><div class="ckpi-value">' + pend + '</div>' +
            '<div class="ckpi-sub">' + (pend ? 'aguardando decisão' : (tot ? 'tudo tratado' : '—')) + '</div></div>' +

            '<div class="ckpi' + (crit ? ' ckpi-critico' : '') + '"><div class="ckpi-label">Críticos</div><div class="ckpi-value">' + crit + '</div>' +
            '<div class="ckpi-sub">' + (crit ? critPend + ' ainda pendente' + (critPend === 1 ? '' : 's') : '—') + '</div></div>' +

            '<div class="ckpi' + (risco ? ' ckpi-risco' : '') + '"><div class="ckpi-label">Valor em risco</div><div class="ckpi-value">' + esc(moeda(risco)) + '</div>' +
            '<div class="ckpi-sub">' + (risco ? esc(moeda(riscoPend)) + ' pendente' : '—') + '</div></div>';
    }

    function renderFiltrosAchados() {
        var temAchados = Estado.achados.length > 0;
        DOM.achFiltros.hidden = !temAchados;
        if (!temAchados) {
            DOM.chipsPanel.hidden = true;
            DOM.resultadoBar.hidden = true;
            return;
        }

        // Contadores por status (respeitam regra/categoria/texto)
        var base = achadosBase();
        var cont = { '': base.length };
        STATUS_LISTA.forEach(function (s) { cont[s] = 0; });
        base.forEach(function (a) { if (cont[a.status_tratamento] != null) cont[a.status_tratamento]++; });

        qsa('.seg-btn', DOM.statusTabs).forEach(function (b) {
            var st = b.getAttribute('data-status');
            setClass(b, 'ativo', st === Estado.statusFiltro);
            b.setAttribute('aria-selected', st === Estado.statusFiltro ? 'true' : 'false');
            var n = qs('.seg-n', b);
            if (n) n.textContent = cont[st] != null ? cont[st] : 0;
        });

        // Chips de regra e categoria (contagem sobre todos os achados)
        var regras = {}, tipos = {};
        Estado.achados.forEach(function (a) {
            var rk = a.cd_regra || 'S/N', tk = a.tipo_achado || 'outro';
            regras[rk] = (regras[rk] || 0) + 1;
            tipos[tk]  = (tipos[tk]  || 0) + 1;
        });

        var hR = '', hT = '';
        Object.keys(regras).sort().forEach(function (k) {
            hR += '<button type="button" class="chip' + (Estado.regraSel[k] ? ' on' : '') + '" data-kind="regra" data-key="' +
                  esc(k) + '" aria-pressed="' + (Estado.regraSel[k] ? 'true' : 'false') + '">' + esc(k) +
                  '<span class="chip-n">' + regras[k] + '</span></button>';
        });
        Object.keys(tipos).sort().forEach(function (k) {
            hT += '<button type="button" class="chip' + (Estado.tipoSel[k] ? ' on' : '') + '" data-kind="tipo" data-key="' +
                  esc(k) + '" aria-pressed="' + (Estado.tipoSel[k] ? 'true' : 'false') + '">' + esc(labelTipo(k)) +
                  '<span class="chip-n">' + tipos[k] + '</span></button>';
        });
        DOM.chipsRegra.innerHTML = hR;
        DOM.chipsTipo.innerHTML = hT;

        var nSel = contarChaves(Estado.regraSel) + contarChaves(Estado.tipoSel);
        DOM.chipsAtivos.textContent = nSel;
        DOM.chipsAtivos.hidden = nSel === 0;
    }

    function temFiltroAtivo() {
        return !!(Estado.statusFiltro || Estado.buscaAchado || temChaves(Estado.regraSel) || temChaves(Estado.tipoSel));
    }

    function limparFiltrosAchados() {
        Estado.statusFiltro = '';
        Estado.regraSel = {};
        Estado.tipoSel = {};
        Estado.buscaAchado = '';
        DOM.achadosBusca.value = '';
        renderConta();
    }

    function htmlDetalhe(a) {
        var h = '';
        if (a.explicacao_ia) {
            h += '<div class="bloco"><div class="bloco-titulo"><i class="fa fa-magnifying-glass-chart"></i> Onde está o problema</div>' +
                 '<p class="bloco-texto">' + esc(a.explicacao_ia) + '</p></div>';
        }
        if (a.recomendacao_ia) {
            h += '<div class="bloco bloco-rec"><div class="bloco-titulo"><i class="fa fa-circle-check"></i> O que fazer para corrigir</div>' +
                 '<p class="bloco-texto">' + esc(a.recomendacao_ia) + '</p></div>';
        }
        if (!a.explicacao_ia && !a.recomendacao_ia) {
            if (a.evidencia_trecho) {
                h += '<div class="bloco bloco-vazio"><button type="button" class="btn btn-sm btn-ia-soft" data-act="explicar" data-id="' + a.id + '">' +
                     '<i class="fa fa-wand-magic-sparkles"></i> Explicar com IA</button>' +
                     '<span>A IA indica onde está o problema e como corrigi-lo.</span></div>';
            } else {
                h += '<div class="bloco bloco-vazio"><i class="fa fa-circle-info"></i> ' +
                     'Este achado não tem trecho de evolução — a explicação por IA não se aplica a este tipo.</div>';
            }
        }
        if (a.evidencia_trecho) {
            h += '<div class="bloco bloco-evid"><div class="bloco-titulo"><i class="fa fa-quote-left"></i> Trecho de evidência</div>' +
                 '<pre class="bloco-pre">' + esc(a.evidencia_trecho) + '</pre></div>';
        }
        return h;
    }

    function htmlAchado(a) {
        var g = a.gravidade || 'baixa';
        var aberto = !!Estado.expandidos[a.id];
        var pend = a.status_tratamento === 'pendente';
        var temIa = !!(a.explicacao_ia || a.recomendacao_ia);

        return '<article class="achado g-' + esc(g) + (aberto ? ' aberto' : '') + (pend ? '' : ' tratado') +
               '" data-id="' + a.id + '">' +
               '<div class="achado-main" data-act="alternar" data-id="' + a.id + '">' +
                   '<div class="achado-top">' +
                       '<span class="regra-badge">' + esc(a.cd_regra || '—') + '</span>' +
                       (a.ds_regra ? '<span class="achado-regra">' + esc(a.ds_regra) + '</span>' : '') +
                       '<span class="tipo-tag">' + esc(labelTipo(a.tipo_achado)) + '</span>' +
                   '</div>' +
                   '<p class="achado-encontrado">' + esc(a.ds_encontrado || '') + '</p>' +
                   (a.ds_esperado ? '<p class="achado-esperado"><strong>Esperado:</strong> ' + esc(a.ds_esperado) + '</p>' : '') +
               '</div>' +
               '<div class="achado-side">' +
                   badgeGravidade(g) +
                   (a.vl_risco ? '<span class="achado-risco">' + esc(moeda(a.vl_risco, true)) + '</span>'
                               : '<span class="achado-risco achado-risco-vazio">sem valor</span>') +
                   badgeStatus(a.status_tratamento) +
               '</div>' +
               '<div class="achado-actions">' +
                   '<button type="button" class="btn btn-ghost btn-sm btn-detalhes" data-act="alternar" data-id="' + a.id +
                       '" aria-expanded="' + (aberto ? 'true' : 'false') + '">' +
                       'Detalhes' + (temIa ? '<span class="ia-tag">IA</span>' : '') + ' <i class="fa fa-chevron-down"></i></button>' +
                   (pend ? '<button type="button" class="btn btn-primary btn-sm" data-act="decidir" data-id="' + a.id + '">' +
                           '<i class="fa fa-gavel"></i> Decidir</button>' : '<span></span>') +
               '</div>' +
               '<div class="achado-detalhe"' + (aberto ? '' : ' hidden') + '>' + (aberto ? htmlDetalhe(a) : '') + '</div>' +
               '</article>';
    }

    function renderListaAchados() {
        var lista = DOM.achadosLista, aviso = DOM.achadosAviso;

        if (Estado.achadosCarregando) {
            aviso.hidden = true;
            lista.hidden = false;
            lista.innerHTML = '<div class="skel"><div class="skel-l" style="width:40%"></div><div class="skel-l" style="width:90%"></div><div class="skel-l" style="width:60%"></div></div>' +
                              '<div class="skel"><div class="skel-l" style="width:30%"></div><div class="skel-l" style="width:80%"></div><div class="skel-l" style="width:50%"></div></div>';
            DOM.resultadoBar.hidden = true;
            return;
        }

        // Falha ao carregar
        if (Estado.achadosErro) {
            lista.hidden = true; lista.innerHTML = '';
            aviso.hidden = false;
            aviso.className = 'aviso aviso-erro';
            aviso.innerHTML = '<i class="fa fa-triangle-exclamation"></i><strong>Não foi possível carregar os achados</strong>' +
                '<small>Verifique a conexão ou o log do servidor.</small>' +
                '<button type="button" class="btn btn-ghost btn-sm" data-act="recarregar-achados"><i class="fa fa-rotate"></i> Tentar novamente</button>';
            DOM.resultadoBar.hidden = true;
            return;
        }

        // Conta sem achados
        if (!Estado.achados.length) {
            lista.hidden = true; lista.innerHTML = '';
            aviso.hidden = false;
            DOM.resultadoBar.hidden = true;
            if (contaAnalisada()) {
                aviso.className = 'aviso aviso-sucesso';
                aviso.innerHTML = '<i class="fa fa-circle-check"></i><strong>Conta verificada — nenhuma inconsistência</strong>' +
                    '<small>Análise: regras determinísticas' + (Estado.analiseIaUsada ? ' + leitura das evoluções por IA' : '') + '</small>';
            } else {
                aviso.className = 'aviso';
                aviso.innerHTML = '<i class="fa fa-magnifying-glass"></i><strong>Esta conta ainda não foi analisada</strong>' +
                    '<small>Execute as regras para identificar inconsistências antes do faturamento.</small>' +
                    '<button type="button" class="btn btn-primary" data-act="executar"><i class="fa fa-play"></i> Executar regras</button>';
            }
            return;
        }

        var base = achadosBase();
        var visiveis = Estado.statusFiltro
            ? base.filter(function (a) { return a.status_tratamento === Estado.statusFiltro; })
            : base;
        ordenarAchados(visiveis);
        Estado.visiveis = visiveis;

        // Barra de resultado
        var filtrando = temFiltroAtivo();
        DOM.resultadoBar.hidden = !filtrando;
        if (filtrando) {
            DOM.resultadoTxt.textContent = 'Mostrando ' + visiveis.length + ' de ' + Estado.achados.length + ' achados';
        }

        if (!visiveis.length) {
            lista.hidden = true; lista.innerHTML = '';
            aviso.hidden = false;
            aviso.className = 'aviso';
            aviso.innerHTML = '<i class="fa fa-filter"></i><strong>Nenhum achado com estes filtros</strong>' +
                '<button type="button" class="btn btn-ghost btn-sm" data-act="limpar-filtros-achados"><i class="fa fa-filter-circle-xmark"></i> Limpar filtros</button>';
            return;
        }

        aviso.hidden = true;
        lista.hidden = false;

        var html = '', grupoAtual = null, porGrav = Estado.ordem === 'gravidade';
        var contGrav = {};
        if (porGrav) visiveis.forEach(function (a) { contGrav[a.gravidade] = (contGrav[a.gravidade] || 0) + 1; });

        for (var i = 0; i < visiveis.length; i++) {
            var a = visiveis[i];
            if (porGrav && a.gravidade !== grupoAtual) {
                grupoAtual = a.gravidade;
                html += '<h3 class="grupo-titulo g-' + esc(grupoAtual) + '">' + esc(labelGravidade(grupoAtual) || 'Sem gravidade') +
                        ' <span class="grupo-n"><span>' + contGrav[grupoAtual] + '</span></span></h3>';
            }
            html += htmlAchado(a);
        }
        lista.innerHTML = html;
    }

    function alternarDetalhe(id) {
        var a = acharAchado(id);
        if (!a) return;
        var aberto = !Estado.expandidos[id];
        if (aberto) Estado.expandidos[id] = true; else delete Estado.expandidos[id];

        var card = qs('.achado[data-id="' + id + '"]', DOM.achadosLista);
        if (!card) return;
        setClass(card, 'aberto', aberto);
        var det = qs('.achado-detalhe', card);
        var btn = qs('.btn-detalhes', card);
        if (btn) btn.setAttribute('aria-expanded', aberto ? 'true' : 'false');
        if (det) {
            det.hidden = !aberto;
            det.innerHTML = aberto ? htmlDetalhe(a) : '';
        }
    }

    function destacarAchado(id) {
        var card = qs('.achado[data-id="' + id + '"]', DOM.achadosLista);
        if (!card) return;
        card.scrollIntoView({ block: 'center', behavior: 'smooth' });
        card.classList.remove('destaque');
        void card.offsetWidth;
        card.classList.add('destaque');
    }

    // =========================================================
    // Explicação por IA (sob demanda)
    // =========================================================

    function solicitarExplicacaoIa(btn) {
        var id = parseInt(btn.getAttribute('data-id'), 10);
        var rotulo = btn.innerHTML;
        btn.disabled = true;
        btn.innerHTML = '<i class="fa fa-circle-notch fa-spin"></i> Consultando IA…';

        api(CONFIG.api.explicarIa(id), { method: 'POST' })
            .then(function (data) {
                if (!data.success) {
                    btn.disabled = false; btn.innerHTML = rotulo;
                    toast(data.error || 'Não foi possível gerar a explicação.', 'erro');
                    return;
                }
                var a = acharAchado(id);
                if (a) {
                    a.explicacao_ia = data.explicacao_ia;
                    a.recomendacao_ia = data.recomendacao_ia;
                    var card = qs('.achado[data-id="' + id + '"]', DOM.achadosLista);
                    if (card) {
                        var det = qs('.achado-detalhe', card);
                        if (det) det.innerHTML = htmlDetalhe(a);
                        var bd = qs('.btn-detalhes', card);
                        if (bd && !qs('.ia-tag', bd)) {
                            bd.innerHTML = 'Detalhes<span class="ia-tag">IA</span> <i class="fa fa-chevron-down"></i>';
                        }
                    }
                }
            })
            .catch(function () {
                btn.disabled = false; btn.innerHTML = rotulo;
                toast('Falha de comunicação. Tente novamente.', 'erro');
            });
    }

    // =========================================================
    // Execução das regras (job + polling)
    // =========================================================

    function executarAnalise() {
        if (!Estado.contaAtiva || Estado.jobId) return;

        var nric = Estado.contaAtiva.nr_interno_conta;
        Estado.jobInicio = Date.now();
        DOM.btnExecutar.disabled = true;
        DOM.jobBar.hidden = false;
        renderJob({ status: 'fila' });

        api(CONFIG.api.auditar(nric), { method: 'POST' })
            .then(function (data) {
                // Usuário trocou de conta enquanto o job era criado: ele segue no servidor
                if (!Estado.contaAtiva || Estado.contaAtiva.nr_interno_conta !== nric) return;
                if (data.success && data.job_id) {
                    Estado.jobId = data.job_id;
                    Estado.pollTentativas = 0;
                    Estado.jobInicio = Date.now();
                    if (data.existente) toast('Já havia uma análise em andamento — acompanhando.', 'info');
                    pollJob();
                } else {
                    erroJob((data && data.error) || 'Erro ao iniciar a análise.');
                }
            })
            .catch(function () { erroJob('Falha de comunicação com o servidor.'); });
    }

    function etapaInfo(job) {
        var status = job.status || '', etapa = job.etapa || '';
        if (status === 'fila') return { passo: 0, texto: 'Aguardando na fila…', pct: null };
        if (etapa === 'ia') return { passo: 2, texto: 'Preparando a leitura das evoluções com IA…', pct: null };
        if (etapa.indexOf('ia_') === 0) {
            var p = etapa.split('_');
            if (p.length === 3) {
                var atual = parseInt(p[1], 10), total = parseInt(p[2], 10);
                return { passo: 2, texto: 'IA: lendo evolução ' + atual + ' de ' + total,
                         pct: total ? Math.min(100, Math.round(atual / total * 100)) : null };
            }
            return { passo: 2, texto: 'IA: lendo evoluções…', pct: null };
        }
        if (etapa === 'regras' || !etapa) return { passo: 1, texto: 'Executando regras de auditoria…', pct: null };
        return { passo: 1, texto: 'Processando…', pct: null };
    }

    function renderJob(job) {
        var info = etapaInfo(job);
        DOM.jobTexto.textContent = info.texto;

        // Relógio local: dt_inicio do servidor pode estar em outro fuso
        var seg = Estado.jobInicio ? Math.floor((Date.now() - Estado.jobInicio) / 1000) : 0;
        DOM.jobTempo.textContent = seg > 2 ? seg + ' s' : '';

        setClass(DOM.jobStep1, 'ativo', info.passo === 1);
        setClass(DOM.jobStep1, 'feito', info.passo > 1);
        setClass(DOM.jobStep2, 'ativo', info.passo === 2);

        DOM.jobProgress.hidden = info.pct === null;
        if (info.pct !== null) DOM.jobProgressBar.style.width = info.pct + '%';
    }

    function pollJob() {
        if (!Estado.jobId) return;

        Estado.pollTentativas += 1;
        if (Estado.pollTentativas > CONFIG.pollMax) {
            erroJob('Tempo limite da análise atingido. Tente novamente.');
            return;
        }

        api(CONFIG.api.job(Estado.jobId))
            .then(function (data) {
                if (!Estado.jobId) return;   // usuário trocou de conta
                if (!data.success) { erroJob('Job não encontrado.'); return; }
                var job = data.job, status = job.status || '';

                if (status === 'fila' || status === 'rodando') {
                    renderJob(job);
                    Estado.jobTimer = setTimeout(pollJob, CONFIG.pollMs);
                    return;
                }

                if (status === 'concluida') {
                    var qt = (job.qt_achados_regras || 0) + (job.qt_achados_ia || 0);
                    pararPolling();
                    Estado.analiseFeita = true;
                    Estado.analiseQtTotal = qt;
                    Estado.analiseIaUsada = !!job.ia_usada;
                    toast(qt === 0 ? 'Análise concluída — nenhuma inconsistência.'
                                   : 'Análise concluída — ' + plural(qt, 'achado', 'achados') + '.', 'ok');
                    carregarAchados();
                    carregarDashboard();
                    carregarAtendimentos({ silencioso: true });
                    return;
                }

                erroJob(job.erro || 'Erro na execução das regras.');
            })
            .catch(function () {
                if (!Estado.jobId) return;
                if (Estado.pollTentativas <= 3) {
                    Estado.jobTimer = setTimeout(pollJob, CONFIG.pollMs * 2);
                } else {
                    erroJob('Falha de comunicação com o servidor. Verifique a conexão.');
                }
            });
    }

    function erroJob(msg) {
        pararPolling();
        toast(msg, 'erro');
    }

    // =========================================================
    // Decisão sobre um achado
    // =========================================================

    function abrirDecisao(a) {
        if (!a) return;
        Estado.feedbackAchado = a;

        DOM.modalResumo.innerHTML =
            '<div class="ar-linha"><span class="regra-badge">' + esc(a.cd_regra || '—') + '</span>' +
            '<span>' + esc(labelTipo(a.tipo_achado)) + '</span>' + badgeGravidade(a.gravidade) +
            (a.vl_risco ? '<strong style="margin-left:auto;color:var(--critica)">' + esc(moeda(a.vl_risco, true)) + '</strong>' : '') +
            '</div><div class="ar-txt">' + esc(a.ds_encontrado || '') + '</div>';

        qsa('input[name="decisao"]', DOM.modalFeedback).forEach(function (r) { r.checked = false; });
        DOM.modalJustificativa.value = '';
        DOM.modalErro.hidden = true;
        DOM.modalProximo.checked = Estado.proximoPendente;
        atualizarFormDecisao();
        abrirModalEl('modal-feedback', 'input[name="decisao"]');
    }

    function decisaoEscolhida() {
        var r = qs('input[name="decisao"]:checked', DOM.modalFeedback);
        return r ? r.value : '';
    }

    function atualizarFormDecisao() {
        var len = DOM.modalJustificativa.value.trim().length;
        var ok = len >= 10;
        DOM.justContador.textContent = ok ? '✓ Justificativa suficiente' : (len + ' / 10 caracteres mínimos');
        setClass(DOM.justContador.parentNode, 'ok', ok);
        DOM.modalConfirmar.disabled = !(ok && decisaoEscolhida());
    }

    function confirmarDecisao() {
        var decisao = decisaoEscolhida();
        var just = DOM.modalJustificativa.value.trim();
        var achado = Estado.feedbackAchado;
        if (!achado || !decisao || just.length < 10) return;

        DOM.modalConfirmar.disabled = true;
        DOM.modalErro.hidden = true;
        Estado.proximoPendente = DOM.modalProximo.checked;
        gravarPref('p55_proximo_pendente', Estado.proximoPendente ? '1' : '0');

        api(CONFIG.api.feedback(achado.id), {
            method: 'POST',
            body: JSON.stringify({ decisao: decisao, justificativa: just })
        })
            .then(function (data) {
                if (!data.success) {
                    atualizarFormDecisao();
                    DOM.modalErro.textContent = data.error || 'Erro ao registrar a decisão.';
                    DOM.modalErro.hidden = false;
                    return;
                }

                // Próximo pendente é calculado sobre a ordem atual da tela
                var proximo = null;
                if (Estado.proximoPendente) {
                    var vis = Estado.visiveis, pos = vis.indexOf(achado), i;
                    for (i = pos + 1; i < vis.length && !proximo; i++) {
                        if (vis[i].status_tratamento === 'pendente' && vis[i] !== achado) proximo = vis[i];
                    }
                    for (i = 0; i < pos && !proximo; i++) {
                        if (vis[i].status_tratamento === 'pendente') proximo = vis[i];
                    }
                }

                achado.status_tratamento = decisao;
                fecharModalEl('modal-feedback');
                renderConta();
                carregarDashboard();
                carregarAtendimentos({ silencioso: true });

                if (proximo) {
                    toast('Decisão registrada. Próximo achado pendente aberto.', 'ok');
                    destacarAchado(proximo.id);
                    abrirDecisao(proximo);
                } else {
                    var restam = Estado.achados.filter(function (x) { return x.status_tratamento === 'pendente'; }).length;
                    toast(restam ? 'Decisão registrada.' : 'Decisão registrada — todos os achados desta conta foram tratados.', 'ok');
                }
            })
            .catch(function () {
                atualizarFormDecisao();
                DOM.modalErro.textContent = 'Falha de comunicação com o servidor.';
                DOM.modalErro.hidden = false;
            });
    }

    // =========================================================
    // Verificação do ambiente
    // =========================================================

    function abrirValidacao() {
        abrirModalEl('modal-validacao');
        rodarValidacao();
    }

    function iconeValidacao(st) {
        if (st === 'OK')     return ['ok', 'fa-circle-check'];
        if (st === 'AVISO')  return ['aviso', 'fa-triangle-exclamation'];
        if (st === 'PULADO') return ['pulado', 'fa-circle-minus'];
        return ['falha', 'fa-circle-xmark'];
    }

    function rodarValidacao() {
        if (Estado.validacaoRodando) return;
        Estado.validacaoRodando = true;
        $('val-rodar').disabled = true;
        $('val-corpo').innerHTML = '<div class="inline-loading inline-loading-lg"><i class="fa fa-circle-notch fa-spin"></i> Verificando ambiente…</div>';

        Promise.all([
            api(CONFIG.api.validacao),
            api(CONFIG.api.iaStatus).catch(function () { return null; })
        ])
            .then(function (res) {
                Estado.validacaoRodando = false;
                $('val-rodar').disabled = false;
                var data = res[0], ia = res[1];

                if (!data.success) {
                    $('val-corpo').innerHTML = '<div class="form-erro">' + esc(data.error || 'Erro ao executar a validação.') + '</div>';
                    DOM.envDot.className = 'env-dot err';
                    return;
                }

                var v = data.validacao || {}, r = v.resumo || {};
                var falha = r.falha || 0, aviso = r.aviso || 0;
                var pronto = v.veredito === 'PRONTO_PARA_IA' && !falha;
                DOM.envDot.className = 'env-dot ' + (pronto ? (aviso ? 'warn' : 'ok') : 'err');

                var h = '<div class="val-veredito ' + (pronto ? 'ok' : 'err') + '">' +
                        '<i class="fa ' + (pronto ? 'fa-circle-check' : 'fa-circle-xmark') + '"></i><div>' +
                        '<strong>' + (pronto ? 'Ambiente pronto' : 'Ambiente com pendências') + '</strong>' +
                        '<small>' + (r.ok || 0) + ' OK · ' + falha + ' falha(s) · ' + aviso + ' aviso(s)</small></div></div>';

                // Agrupa por "grupo" mantendo a ordem de aparição
                var ordem = [], grupos = {};
                (v.resultados || []).forEach(function (it) {
                    var g = it.grupo || 'Geral';
                    if (!grupos[g]) { grupos[g] = []; ordem.push(g); }
                    grupos[g].push(it);
                });
                ordem.forEach(function (g) {
                    h += '<div class="val-grupo"><div class="val-grupo-titulo">' + esc(g) + '</div>';
                    grupos[g].forEach(function (it) {
                        var ic = iconeValidacao((it.status || '').toUpperCase());
                        h += '<div class="val-item ' + ic[0] + '"><i class="fa ' + ic[1] + '"></i><div>' +
                             esc(it.descricao || it.id || '') +
                             (it.detalhe ? '<small>' + esc(it.detalhe) + '</small>' : '') + '</div></div>';
                    });
                    h += '</div>';
                });

                // Inteligência artificial
                if (ia && ia.success) {
                    var gt = ia.gates || {};
                    var itens = [
                        ['kill_switch_vivo', 'Kill switch desativado'],
                        ['ia_habilitada_env', 'IA habilitada no ambiente'],
                        ['groq_key_configurada', 'Chave da API configurada'],
                        ['groq_lib_instalada', 'Biblioteca Groq instalada'],
                        ['db_ia_externa_autorizada', 'IA externa autorizada no banco']
                    ];
                    h += '<div class="val-grupo"><div class="val-grupo-titulo">Inteligência artificial — ' +
                         (ia.ia_pronta ? 'pronta' : 'indisponível') + '</div>';
                    itens.forEach(function (p) {
                        var okp = !!gt[p[0]];
                        h += '<div class="val-item ' + (okp ? 'ok' : 'falha') + '"><i class="fa ' +
                             (okp ? 'fa-circle-check' : 'fa-circle-xmark') + '"></i><div>' + esc(p[1]) + '</div></div>';
                    });
                    h += '</div>';
                }

                $('val-corpo').innerHTML = h;
            })
            .catch(function () {
                Estado.validacaoRodando = false;
                $('val-rodar').disabled = false;
                $('val-corpo').innerHTML = '<div class="form-erro">Erro ao executar a validação.</div>';
                DOM.envDot.className = 'env-dot err';
            });
    }

    // =========================================================
    // Mapeamentos R28
    // =========================================================

    function abrirMapeamentos() {
        abrirModalEl('modal-mapeamentos', '.tab.ativo');
        trocarMapAba('pendentes');
    }

    function trocarMapAba(aba) {
        qsa('.tab', $('modal-mapeamentos')).forEach(function (t) {
            var on = t.getAttribute('data-mapaba') === aba;
            setClass(t, 'ativo', on);
            t.setAttribute('aria-selected', on ? 'true' : 'false');
        });
        qsa('.map-aba-conteudo', $('modal-mapeamentos')).forEach(function (c) { c.hidden = true; });
        $('map-aba-' + aba).hidden = false;

        if (aba === 'pendentes') carregarItensPendentes();
        if (aba === 'todos') carregarTodosAlias($('map-busca').value.trim());
    }

    function atualizarBadgeMapeamento() {
        var n = Estado.mapPend.length;
        [$('map-badge-pendentes'), DOM.mapBadgeHeader].forEach(function (b) {
            b.textContent = n;
            b.hidden = n === 0;
        });
    }

    function htmlChipAlias(a) {
        var ok = !!a.confirmado;
        return '<span class="alias-chip ' + (ok ? 'ok' : 'pend') + '">' +
               '<i class="fa ' + (ok ? 'fa-circle-check' : 'fa-clock') + '"></i>' +
               '<span><strong>' + esc(a.cd_material) + '</strong>' + (a.ds_material ? ' — ' + esc(a.ds_material) : '') + '</span>' +
               '<button type="button" data-act="remover-alias" data-alias="' + esc(a.id) + '" title="Remover este mapeamento" aria-label="Remover mapeamento">' +
               '<i class="fa fa-times"></i></button></span>';
    }

    function htmlChipsLista(aliases) {
        var h = '';
        (aliases || []).forEach(function (a) { h += htmlChipAlias(a); });
        return h;
    }

    /** Busca a lista; com so-contagem só atualiza o selo no cabeçalho. */
    function carregarItensPendentes(soContagem) {
        var loading = $('map-pend-loading'), vazio = $('map-pend-vazio'), lista = $('map-pend-lista');
        if (!soContagem) {
            loading.hidden = false; vazio.hidden = true; lista.innerHTML = '';
        }

        api(CONFIG.api.itensNaoMapeados)
            .then(function (data) {
                loading.hidden = true;
                Estado.mapPend = (data.success && data.itens) ? data.itens : [];
                atualizarBadgeMapeamento();
                if (!soContagem) renderPendentesMapeamento();
            })
            .catch(function () {
                loading.hidden = true;
                if (!soContagem) {
                    vazio.className = 'aviso aviso-erro';
                    vazio.innerHTML = '<i class="fa fa-triangle-exclamation"></i> Erro ao carregar os termos pendentes.';
                    vazio.hidden = false;
                }
            });
    }

    function renderPendentesMapeamento() {
        var vazio = $('map-pend-vazio'), lista = $('map-pend-lista');
        vazio.className = 'aviso aviso-ok';
        vazio.innerHTML = '<i class="fa fa-check-circle"></i> Nenhum termo pendente de mapeamento.';
        vazio.hidden = Estado.mapPend.length > 0;
        $('btn-map-sugerir-ia').disabled = Estado.mapPend.length === 0;

        var h = '';
        Estado.mapPend.forEach(function (it, i) {
            h += '<div class="map-card" data-idx="' + i + '">' +
                 '<div class="map-card-head"><span class="map-termo">' + esc(it.ds_item || '') + '</span>' +
                 '<span class="map-meta">' + plural(it.ocorrencias || 0, 'ocorrência', 'ocorrências') +
                 (it.ultima_extracao ? ' · última em ' + esc(formatarDataHora(it.ultima_extracao)) : '') + '</span></div>' +
                 '<div class="map-chips">' + htmlChipsLista(it.aliases_existentes) + '</div>' +
                 '<div class="map-add"><div class="ac-wrap">' +
                 '<input type="text" class="field ac-input map-cd" maxlength="100" autocomplete="off" ' +
                 'placeholder="Buscar no catálogo ou digitar cd_material…" aria-label="cd_material para ' + esc(it.ds_item || '') + '">' +
                 '<input type="hidden" class="ac-ds"><div class="ac-drop" hidden></div></div>' +
                 '<button type="button" class="btn btn-primary btn-sm" data-act="adicionar-alias"><i class="fa fa-plus"></i> Adicionar</button>' +
                 '</div></div>';
        });
        lista.innerHTML = h;
    }

    function adicionarMapeamento(card) {
        var idx = parseInt(card.getAttribute('data-idx'), 10);
        var it = Estado.mapPend[idx];
        var inp = qs('.map-cd', card), dsEl = qs('.ac-ds', card), btn = qs('[data-act="adicionar-alias"]', card);
        var cd = inp.value.trim();
        if (!it) return;
        if (!cd) { inp.focus(); return; }

        btn.disabled = true;
        api(CONFIG.api.materialAlias, {
            method: 'POST',
            body: JSON.stringify({ termo: it.ds_item, cd_material: cd, ds_material: dsEl.value.trim() || null, confirmado: true })
        })
            .then(function (data) {
                btn.disabled = false;
                if (!data.success) { toast('Erro ao salvar: ' + (data.error || 'falha'), 'erro'); return; }
                it.aliases_existentes = it.aliases_existentes || [];
                it.aliases_existentes.push({ id: data.id, cd_material: cd, ds_material: dsEl.value.trim() || null, confirmado: true });
                qs('.map-chips', card).innerHTML = htmlChipsLista(it.aliases_existentes);
                inp.value = ''; dsEl.value = '';
                toast('Mapeamento adicionado.', 'ok');
                inp.focus();
            })
            .catch(function () { btn.disabled = false; toast('Erro de comunicação ao salvar.', 'erro'); });
    }

    function removerAlias(aliasId, card) {
        confirmar('Remover mapeamento', 'Remover este mapeamento? O termo deixará de ser monitorado por ele na regra R28.', 'Remover', function () {
            api(CONFIG.api.materialAliasId(aliasId), { method: 'DELETE' })
                .then(function (data) {
                    if (!data.success) { toast('Erro ao remover: ' + (data.error || 'falha'), 'erro'); return; }
                    var idx = parseInt(card.getAttribute('data-idx'), 10);
                    var it = Estado.mapPend[idx];
                    if (it && it.aliases_existentes) {
                        it.aliases_existentes = it.aliases_existentes.filter(function (a) { return String(a.id) !== String(aliasId); });
                        qs('.map-chips', card).innerHTML = htmlChipsLista(it.aliases_existentes);
                    }
                    toast('Mapeamento removido.', 'ok');
                })
                .catch(function () { toast('Erro de comunicação.', 'erro'); });
        });
    }

    // ── Autocomplete de catálogo (delegado no modal) ─────────────

    function fecharDrop(wrap) {
        var d = qs('.ac-drop', wrap);
        if (d) { d.hidden = true; d.innerHTML = ''; }
    }

    function escolherSugestao(item) {
        var wrap = closest(item, '.ac-wrap');
        var inp = qs('.ac-input', wrap);
        inp.value = item.getAttribute('data-cd');
        var dsEl = qs('.ac-ds', wrap);
        if (!dsEl && inp.getAttribute('data-ds-target')) dsEl = $(inp.getAttribute('data-ds-target'));
        if (dsEl) dsEl.value = item.getAttribute('data-ds') || '';
        fecharDrop(wrap);
    }

    function onAcInput(inp) {
        var wrap = closest(inp, '.ac-wrap');
        var drop = qs('.ac-drop', wrap);
        var oculto = qs('.ac-ds', wrap);
        if (oculto) oculto.value = '';          // digitou à mão: descarta a descrição escolhida antes

        var q = inp.value.trim();
        clearTimeout(inp._acTimer);
        if (q.length < 2) { fecharDrop(wrap); return; }

        inp._acTimer = setTimeout(function () {
            api(CONFIG.api.materialCatalogo + '?q=' + encodeURIComponent(q))
                .then(function (data) {
                    if (inp.value.trim() !== q) return;   // resposta velha
                    var res = (data.success && data.resultados) || [];
                    if (!res.length) { fecharDrop(wrap); return; }
                    var h = '';
                    res.forEach(function (r) {
                        h += '<div class="ac-item" role="option" data-cd="' + esc(r.cd_material) + '" data-ds="' + esc(r.ds_material || '') + '">' +
                             '<strong>' + esc(r.cd_material) + '</strong> — ' + esc(r.ds_material || '') +
                             (r.classe ? ' <em>[' + esc(r.classe) + ']</em>' : '') + '</div>';
                    });
                    drop.innerHTML = h;
                    drop.hidden = false;
                })
                .catch(function () { fecharDrop(wrap); });
        }, 280);
    }

    function onAcKeydown(e, inp) {
        var wrap = closest(inp, '.ac-wrap');
        var drop = qs('.ac-drop', wrap);
        var itens = drop && !drop.hidden ? qsa('.ac-item', drop) : [];
        var atual = -1, i;
        for (i = 0; i < itens.length; i++) { if (itens[i].classList.contains('sel')) atual = i; }

        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            if (!itens.length) return;
            e.preventDefault();
            var prox = e.key === 'ArrowDown' ? Math.min(itens.length - 1, atual + 1) : Math.max(0, atual - 1);
            itens.forEach(function (el, k) { setClass(el, 'sel', k === prox); });
            itens[prox].scrollIntoView({ block: 'nearest' });
        } else if (e.key === 'Enter') {
            if (atual >= 0) {
                e.preventDefault();
                escolherSugestao(itens[atual]);
            } else {
                var card = closest(inp, '.map-card');
                if (card) { e.preventDefault(); adicionarMapeamento(card); }
            }
        } else if (e.key === 'Escape' && itens.length) {
            e.stopPropagation();
            fecharDrop(wrap);
        }
    }

    // ── Todos os mapeamentos ──────────────────────────────────────

    function carregarTodosAlias(busca) {
        var loading = $('map-todos-loading'), vazio = $('map-todos-vazio'), tabela = $('map-todos-tabela'), tbody = $('map-todos-tbody');
        loading.hidden = false; vazio.hidden = true; tabela.hidden = true;

        var url = CONFIG.api.materialAlias + (busca ? '?busca=' + encodeURIComponent(busca) : '');
        api(url)
            .then(function (data) {
                loading.hidden = true;
                var lista = (data.success && data.aliases) || [];
                if (!lista.length) { vazio.hidden = false; return; }
                var h = '';
                lista.forEach(function (a) {
                    h += '<tr><td><code>' + esc(a.termo || '') + '</code></td>' +
                         '<td>' + esc(a.cd_material || '') + '</td>' +
                         '<td>' + esc(a.ds_material || '–') + '</td>' +
                         '<td>' + (a.confirmado ? '<span class="status-badge status-procede">Ativo</span>'
                                                : '<span class="status-badge status-pendente">Pendente</span>') + '</td>' +
                         '<td class="col-acoes">' +
                         (a.confirmado ? '' : '<button type="button" class="btn btn-ghost btn-sm" data-act="confirmar-alias" data-id="' + esc(a.id) + '" title="Confirmar"><i class="fa fa-check"></i></button>') +
                         '<button type="button" class="btn btn-ghost btn-sm" data-act="excluir-alias" data-id="' + esc(a.id) + '" title="Excluir"><i class="fa fa-trash"></i></button>' +
                         '</td></tr>';
                });
                tbody.innerHTML = h;
                tabela.hidden = false;
            })
            .catch(function () {
                loading.hidden = true;
                vazio.innerHTML = '<i class="fa fa-triangle-exclamation"></i> Erro ao carregar os mapeamentos.';
                vazio.hidden = false;
            });
    }

    function confirmarAlias(id, btn) {
        btn.disabled = true;
        api(CONFIG.api.materialAliasId(id), { method: 'PUT', body: JSON.stringify({ confirmado: true }) })
            .then(function (data) {
                if (data.success) { toast('Mapeamento confirmado.', 'ok'); carregarTodosAlias($('map-busca').value.trim()); carregarItensPendentes(true); }
                else { btn.disabled = false; toast('Erro: ' + (data.error || 'falha'), 'erro'); }
            })
            .catch(function () { btn.disabled = false; toast('Erro de comunicação.', 'erro'); });
    }

    function excluirAlias(id) {
        confirmar('Excluir mapeamento', 'Excluir este mapeamento permanentemente?', 'Excluir', function () {
            api(CONFIG.api.materialAliasId(id), { method: 'DELETE' })
                .then(function (data) {
                    if (data.success) { toast('Mapeamento excluído.', 'ok'); carregarTodosAlias($('map-busca').value.trim()); }
                    else toast('Erro: ' + (data.error || 'falha'), 'erro');
                })
                .catch(function () { toast('Erro de comunicação.', 'erro'); });
        });
    }

    // ── Novo mapeamento ───────────────────────────────────────────

    function salvarNovoAlias() {
        var termo = $('map-novo-termo').value.trim();
        var cd = $('map-novo-cd').value.trim();
        var ds = $('map-novo-ds').value.trim();
        var conf = $('map-novo-confirmado').checked;
        var erroEl = $('map-novo-erro');
        erroEl.hidden = true;

        if (!termo || !cd) {
            erroEl.textContent = 'Termo e cd_material são obrigatórios.';
            erroEl.hidden = false;
            return;
        }

        var btn = $('map-novo-salvar');
        btn.disabled = true;
        api(CONFIG.api.materialAlias, {
            method: 'POST',
            body: JSON.stringify({ termo: termo, cd_material: cd, ds_material: ds || null, confirmado: conf })
        })
            .then(function (data) {
                btn.disabled = false;
                if (data.success) {
                    $('map-novo-termo').value = ''; $('map-novo-cd').value = ''; $('map-novo-ds').value = '';
                    $('map-novo-confirmado').checked = false;
                    toast('Mapeamento salvo.', 'ok');
                    trocarMapAba('todos');
                } else {
                    erroEl.textContent = data.error || 'Erro ao salvar.';
                    erroEl.hidden = false;
                }
            })
            .catch(function () {
                btn.disabled = false;
                erroEl.textContent = 'Erro de comunicação.';
                erroEl.hidden = false;
            });
    }

    // ── Sugestões da IA ───────────────────────────────────────────

    function sugerirIaParaTodos() {
        var termos = Estado.mapPend.map(function (it) { return it.ds_item; }).filter(Boolean);
        if (!termos.length) { toast('Nenhum termo pendente.', 'info'); return; }

        var painel = $('map-ia-resultados'), loading = $('map-ia-loading'), erroEl = $('map-ia-erro');
        var lista = $('map-ia-lista'), acoes = $('map-ia-acoes'), btn = $('btn-map-sugerir-ia');

        painel.hidden = false; loading.hidden = false; erroEl.hidden = true; acoes.hidden = true;
        lista.innerHTML = '';
        btn.disabled = true;

        api(CONFIG.api.materialAliasSugIa, { method: 'POST', body: JSON.stringify({ termos: termos }) })
            .then(function (data) {
                loading.hidden = true; btn.disabled = false;
                if (!data.success) { erroEl.textContent = data.error || 'Erro na IA.'; erroEl.hidden = false; return; }

                Estado.mapSug = [];
                var h = '';
                (data.sugestoes || []).forEach(function (s) {
                    var ms = s.matches || [];
                    if (!ms.length) return;
                    h += '<div class="ia-grupo"><div class="ia-termo"><i class="fa fa-tag"></i> ' + esc(s.termo || '') + '</div>';
                    ms.forEach(function (m) {
                        var k = Estado.mapSug.length;
                        Estado.mapSug.push({ termo: s.termo, cd: String(m.cd_material || ''), ds: m.ds_material || '' });
                        h += '<label class="ia-opt"><input type="checkbox" checked data-k="' + k + '"><span><strong>' +
                             esc(m.cd_material || '') + '</strong> — ' + esc(m.ds_material || '') +
                             (m.justificativa ? '<em>' + esc(m.justificativa) + '</em>' : '') + '</span></label>';
                    });
                    h += '</div>';
                });

                if (!Estado.mapSug.length) {
                    lista.innerHTML = '<p class="muted">A IA não encontrou equivalentes no catálogo para os termos enviados.</p>';
                    return;
                }
                lista.innerHTML = h;
                acoes.hidden = false;
                $('map-ia-status').textContent = plural(Estado.mapSug.length, 'sugestão pronta', 'sugestões prontas') + ' para confirmar.';
            })
            .catch(function () {
                loading.hidden = true; btn.disabled = false;
                erroEl.textContent = 'Erro de comunicação.'; erroEl.hidden = false;
            });
    }

    function confirmarSugestoesIa() {
        var marcados = qsa('#map-ia-lista input[type="checkbox"]:checked');
        var status = $('map-ia-status'), btn = $('btn-map-ia-confirmar');
        if (!marcados.length) { status.textContent = 'Selecione ao menos uma sugestão.'; return; }

        btn.disabled = true;
        status.textContent = 'Salvando…';

        Promise.all(marcados.map(function (chk) {
            var s = Estado.mapSug[parseInt(chk.getAttribute('data-k'), 10)];
            return api(CONFIG.api.materialAlias, {
                method: 'POST',
                body: JSON.stringify({ termo: s.termo, cd_material: s.cd, ds_material: s.ds || null, confirmado: true })
            });
        }))
            .then(function (results) {
                var ok = results.filter(function (r) { return r.success; }).length;
                var falha = results.length - ok;
                btn.disabled = false;
                status.textContent = ok + ' salvo(s)' + (falha ? ', ' + falha + ' com erro.' : '.');
                toast(ok + ' mapeamento(s) confirmado(s).', falha ? 'info' : 'ok');
                $('map-ia-resultados').hidden = true;
                carregarItensPendentes();
            })
            .catch(function () { btn.disabled = false; status.textContent = 'Erro ao salvar.'; });
    }

    // =========================================================
    // Resumo clínico (IA)
    // =========================================================

    function abrirResumo(regenerar) {
        if (!Estado.atendimentoAtivo) return;
        var nr = Estado.atendimentoAtivo.nr_atendimento;
        var nric = Estado.contaAtiva ? Estado.contaAtiva.nr_interno_conta : null;
        var token = ++Estado.resumoReq;

        if (!$('modal-resumo-paciente').classList.contains('aberto')) abrirModalEl('modal-resumo-paciente', '#resumo-regenerar');
        $('resumo-loading').hidden = false;
        $('resumo-conteudo').hidden = true;
        $('resumo-erro').hidden = true;
        $('resumo-regenerar').disabled = true;

        api(CONFIG.api.resumoPaciente(nr, nric, regenerar))
            .then(function (data) {
                if (token !== Estado.resumoReq) return;
                $('resumo-loading').hidden = true;
                $('resumo-regenerar').disabled = false;
                if (!data.success) {
                    $('resumo-erro').textContent = data.error || 'Erro ao gerar o resumo.';
                    $('resumo-erro').hidden = false;
                    return;
                }

                var res = data.resumo || {}, comp = data.comparativo || [];
                $('resumo-condicao').textContent = res.condicao_principal || '—';
                $('resumo-obs').textContent = res.observacao_auditoria || '—';

                var tabela = $('resumo-comp-tabela'), tbody = $('resumo-comp-tbody');
                var cob = $('resumo-cobertura');
                tbody.innerHTML = '';

                if (!comp.length) {
                    tabela.hidden = true; cob.hidden = true;
                    $('resumo-comp-vazio').hidden = false;
                } else {
                    $('resumo-comp-vazio').hidden = true;
                    var achados = comp.filter(function (c) { return c.encontrado; }).length;
                    var pct = Math.round(achados / comp.length * 100);
                    $('resumo-cobertura-txt').textContent = achados + ' de ' + comp.length +
                        ' itens documentados foram encontrados na conta (' + pct + '%)';
                    $('resumo-cobertura-bar').style.width = pct + '%';
                    cob.className = 'cobertura' + (pct < 50 ? ' baixa' : (pct < 100 ? ' media' : ''));
                    cob.hidden = false;

                    // Itens que faltam na conta primeiro: são os que importam para o auditor
                    var ordenado = comp.map(function (c, i) { return { c: c, i: i }; });
                    ordenado.sort(function (x, y) {
                        var fx = x.c.encontrado ? 1 : 0, fy = y.c.encontrado ? 1 : 0;
                        return fx !== fy ? fx - fy : x.i - y.i;
                    });

                    var h = '';
                    ordenado.forEach(function (o) {
                        var c = o.c, cel;
                        if (c.encontrado) {
                            cel = esc(c.ds_faturado || '—');
                        } else if (c.sugestao_catalogo) {
                            var s = c.sugestao_catalogo;
                            cel = '<span class="sug"><i class="fa fa-lightbulb"></i> <strong>Sugerido:</strong> cd=' + esc(s.cd_material) +
                                  ' — ' + esc(s.ds_material) + (s.classe ? ' [' + esc(s.classe) + ']' : '') + '</span>';
                        } else {
                            cel = '<span class="muted">—</span>';
                        }
                        h += '<tr' + (c.encontrado ? '' : ' class="falta"') + '><td>' + esc(c.item) + '</td>' +
                             '<td class="col-centro" style="color:' + (c.encontrado ? 'var(--baixa)' : 'var(--critica)') + '">' +
                             '<i class="fa ' + (c.encontrado ? 'fa-circle-check' : 'fa-circle-xmark') + '" aria-label="' +
                             (c.encontrado ? 'Sim' : 'Não') + '"></i></td><td>' + cel + '</td>' +
                             '<td class="col-valor">' + (c.qt_faturada !== null && c.qt_faturada !== undefined ? Number(c.qt_faturada).toFixed(2) : '—') + '</td></tr>';
                    });
                    tbody.innerHTML = h;
                    tabela.hidden = false;
                }

                var origem = data.cache ? 'em cache (' + (data.gerado_em || '') + ')' : 'gerado agora';
                $('resumo-footer').textContent = 'Baseado em ' + (data.evolucoes_analisadas || 0) +
                    ' evolução(ões) · ' + origem + ' · Gerado por IA — sujeito a revisão.';
                $('resumo-conteudo').hidden = false;
            })
            .catch(function () {
                if (token !== Estado.resumoReq) return;
                $('resumo-loading').hidden = true;
                $('resumo-regenerar').disabled = false;
                $('resumo-erro').textContent = 'Falha na comunicação com o servidor.';
                $('resumo-erro').hidden = false;
            });
    }

    // =========================================================
    // Eventos
    // =========================================================

    function onCliqueAchados(e) {
        var el = closest(e.target, '[data-act]', DOM.achadosScroll);
        if (!el) return;
        var act = el.getAttribute('data-act');
        var id = el.getAttribute('data-id');

        if (act === 'alternar') {
            // Seleção de texto dentro do card não deve abrir/fechar
            var sel = window.getSelection && window.getSelection().toString();
            if (sel && el.classList.contains('achado-main')) return;
            alternarDetalhe(id);
        } else if (act === 'decidir') {
            abrirDecisao(acharAchado(id));
        } else if (act === 'explicar') {
            solicitarExplicacaoIa(el);
        } else if (act === 'executar') {
            executarAnalise();
        } else if (act === 'recarregar-achados') {
            carregarAchados();
        } else if (act === 'limpar-filtros-achados') {
            limparFiltrosAchados();
        }
    }

    function onCliqueModais(e) {
        var fechar = closest(e.target, '[data-fechar]');
        if (fechar) {
            var m = closest(fechar, '.modal');
            if (m) fecharModalEl(m.id);
            return;
        }

        var item = closest(e.target, '.ac-item');
        if (item) { escolherSugestao(item); return; }

        var el = closest(e.target, '[data-act]', $('modal-mapeamentos'));
        if (!el || !closest(el, '#modal-mapeamentos')) return;
        var act = el.getAttribute('data-act');

        if (act === 'adicionar-alias') adicionarMapeamento(closest(el, '.map-card'));
        else if (act === 'remover-alias') removerAlias(el.getAttribute('data-alias'), closest(el, '.map-card'));
        else if (act === 'confirmar-alias') confirmarAlias(el.getAttribute('data-id'), el);
        else if (act === 'excluir-alias') excluirAlias(el.getAttribute('data-id'));
    }

    function ligarEventos() {
        document.addEventListener('keydown', onTeclaGlobal);
        document.addEventListener('click', onCliqueModais);

        // Barra superior
        $('btn-refresh').addEventListener('click', function () {
            carregarDashboard();
            carregarAtendimentos({ silencioso: false });
            carregarItensPendentes(true);
            if (Estado.contaAtiva) carregarAchados();
        });
        $('btn-menu').addEventListener('click', function () { abrirSidebar(!DOM.sidebar.classList.contains('aberta')); });
        DOM.scrim.addEventListener('click', function () { abrirSidebar(false); });
        $('btn-validacao').addEventListener('click', abrirValidacao);
        $('btn-mapeamentos').addEventListener('click', abrirMapeamentos);

        // Sidebar
        DOM.filtroBusca.addEventListener('input', function () {
            var termo = this.value.trim();
            clearTimeout(_buscaTimer);
            _buscaTimer = setTimeout(function () {
                if (termo === Estado.busca) return;
                Estado.busca = termo;
                carregarAtendimentos();
            }, CONFIG.debounceMs);
        });
        DOM.filtroGrav.addEventListener('click', function (e) {
            var b = closest(e.target, '.seg-btn', DOM.filtroGrav);
            if (!b) return;
            Estado.gravFiltro = b.getAttribute('data-grav') || '';
            marcarSegGravidade(Estado.gravFiltro);
            carregarAtendimentos();
        });
        DOM.filtroSetor.addEventListener('change', function () {
            Estado.setorFiltro = this.value;
            carregarAtendimentos();
        });
        DOM.btnMais.addEventListener('click', function () { carregarAtendimentos({ anexar: true }); });
        DOM.contasLista.addEventListener('click', function (e) {
            var btn = closest(e.target, '.at-item', DOM.contasLista);
            if (btn) { selecionarAtendimento(parseInt(btn.getAttribute('data-idx'), 10)); return; }
            var act = closest(e.target, '[data-act]', DOM.contasLista);
            if (!act) return;
            if (act.getAttribute('data-act') === 'recarregar-lista') carregarAtendimentos();
            if (act.getAttribute('data-act') === 'limpar-filtros-lista') limparFiltrosLista();
        });
        DOM.contasLista.addEventListener('keydown', function (e) {
            if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
            var itens = qsa('.at-item', DOM.contasLista);
            var pos = itens.indexOf(document.activeElement);
            if (pos === -1) return;
            e.preventDefault();
            var alvo = itens[e.key === 'ArrowDown' ? Math.min(itens.length - 1, pos + 1) : Math.max(0, pos - 1)];
            if (alvo) alvo.focus();
        });

        // Conta
        DOM.contaPills.addEventListener('click', function (e) {
            var p = closest(e.target, '.pill', DOM.contaPills);
            if (p) trocarConta(p.getAttribute('data-conta'));
        });
        DOM.contaSelector.addEventListener('change', function () { trocarConta(this.value); });
        DOM.btnExecutar.addEventListener('click', executarAnalise);
        DOM.btnResumo.addEventListener('click', function () { abrirResumo(false); });

        // Filtros de achados
        DOM.statusTabs.addEventListener('click', function (e) {
            var b = closest(e.target, '.seg-btn', DOM.statusTabs);
            if (!b) return;
            Estado.statusFiltro = b.getAttribute('data-status') || '';
            renderConta();
        });
        DOM.achadosBusca.addEventListener('input', function () {
            var v = this.value.trim();
            clearTimeout(_buscaAchadoTimer);
            _buscaAchadoTimer = setTimeout(function () {
                Estado.buscaAchado = v;
                renderConta();
            }, 200);
        });
        DOM.achadosOrdem.addEventListener('change', function () {
            Estado.ordem = this.value;
            renderListaAchados();
        });
        DOM.btnChips.addEventListener('click', function () {
            var abrir = DOM.chipsPanel.hidden;
            DOM.chipsPanel.hidden = !abrir;
            DOM.btnChips.setAttribute('aria-expanded', abrir ? 'true' : 'false');
        });
        DOM.chipsPanel.addEventListener('click', function (e) {
            var c = closest(e.target, '.chip', DOM.chipsPanel);
            if (!c) return;
            var mapa = c.getAttribute('data-kind') === 'regra' ? Estado.regraSel : Estado.tipoSel;
            var k = c.getAttribute('data-key');
            if (mapa[k]) delete mapa[k]; else mapa[k] = true;
            renderConta();
        });
        $('btn-limpar-filtros').addEventListener('click', limparFiltrosAchados);
        DOM.achadosScroll.addEventListener('click', onCliqueAchados);

        // Decisão
        DOM.modalFeedback.addEventListener('change', atualizarFormDecisao);
        DOM.modalJustificativa.addEventListener('input', atualizarFormDecisao);
        DOM.modalJustificativa.addEventListener('keydown', function (e) {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && !DOM.modalConfirmar.disabled) {
                e.preventDefault();
                confirmarDecisao();
            }
        });
        DOM.modalConfirmar.addEventListener('click', confirmarDecisao);
        _aoFechar['modal-feedback'] = function () { Estado.feedbackAchado = null; };

        // Confirmação genérica
        $('confirm-ok').addEventListener('click', function () {
            var cb = _confirmCb;
            _confirmCb = null;
            fecharModalEl('modal-confirm');
            if (cb) cb();
        });
        _aoFechar['modal-confirm'] = function () { _confirmCb = null; };

        // Ambiente
        $('val-rodar').addEventListener('click', rodarValidacao);

        // Mapeamentos
        qsa('.tab', $('modal-mapeamentos')).forEach(function (t) {
            t.addEventListener('click', function () { trocarMapAba(t.getAttribute('data-mapaba')); });
        });
        $('btn-map-sugerir-ia').addEventListener('click', sugerirIaParaTodos);
        $('btn-map-ia-fechar').addEventListener('click', function () { $('map-ia-resultados').hidden = true; });
        $('btn-map-ia-confirmar').addEventListener('click', confirmarSugestoesIa);
        $('map-novo-salvar').addEventListener('click', salvarNovoAlias);
        $('map-busca').addEventListener('input', function () {
            var v = this.value.trim();
            clearTimeout(Estado.mapBuscaTimer);
            Estado.mapBuscaTimer = setTimeout(function () { carregarTodosAlias(v); }, 300);
        });

        var modalMap = $('modal-mapeamentos');
        modalMap.addEventListener('input', function (e) {
            var inp = closest(e.target, '.ac-input', modalMap);
            if (inp) onAcInput(inp);
        });
        modalMap.addEventListener('keydown', function (e) {
            var inp = closest(e.target, '.ac-input', modalMap);
            if (inp) onAcKeydown(e, inp);
        });
        modalMap.addEventListener('mousedown', function (e) {
            // mousedown (e não click) para o campo não perder o foco antes da escolha
            var item = closest(e.target, '.ac-item', modalMap);
            if (item) { e.preventDefault(); escolherSugestao(item); }
        });
        modalMap.addEventListener('focusout', function (e) {
            var inp = closest(e.target, '.ac-input', modalMap);
            if (!inp) return;
            var wrap = closest(inp, '.ac-wrap');
            setTimeout(function () { fecharDrop(wrap); }, 150);
        });
        _aoFechar['modal-mapeamentos'] = function () { carregarItensPendentes(true); };

        // Resumo clínico
        $('resumo-regenerar').addEventListener('click', function () { abrirResumo(true); });
    }

    // =========================================================
    // Inicialização
    // =========================================================

    function inicializar() {
        var ids = {
            statContas: 'stat-contas', statCriticos: 'stat-criticos', statPendentes: 'stat-pendentes', statRisco: 'stat-risco',
            toasts: 'toasts', sidebar: 'sidebar', scrim: 'scrim',
            filtroBusca: 'filtro-busca', filtroGrav: 'filtro-gravidade', filtroSetor: 'filtro-setor',
            contasLista: 'contas-lista', contasTotal: 'contas-total', btnMais: 'btn-mais',
            emptyState: 'empty-state', contaDetalhe: 'conta-detalhe',
            detalheTitulo: 'detalhe-titulo', detalheMeta: 'detalhe-meta',
            contaWrap: 'conta-selector-wrapper', contaPills: 'conta-pills', contaSelector: 'conta-selector',
            btnExecutar: 'btn-executar', btnResumo: 'btn-resumo-paciente',
            jobBar: 'job-bar', jobTexto: 'job-texto', jobTempo: 'job-tempo',
            jobStep1: 'job-step-1', jobStep2: 'job-step-2', jobProgress: 'job-progress', jobProgressBar: 'job-progress-bar',
            contaKpis: 'conta-kpis', achFiltros: 'achados-filtros', statusTabs: 'status-tabs',
            achadosBusca: 'achados-busca', achadosOrdem: 'achados-ordem',
            btnChips: 'btn-chips', chipsAtivos: 'chips-ativos', chipsPanel: 'chips-panel',
            chipsRegra: 'legenda-chips-regra', chipsTipo: 'legenda-chips-tipo',
            resultadoBar: 'resultado-bar', resultadoTxt: 'resultado-txt',
            achadosScroll: 'achados-scroll', achadosLista: 'achados-lista', achadosAviso: 'achados-aviso',
            modalFeedback: 'modal-feedback', modalResumo: 'modal-resumo',
            modalJustificativa: 'modal-justificativa', justContador: 'just-contador',
            modalProximo: 'modal-proximo', modalErro: 'modal-erro', modalConfirmar: 'modal-confirmar',
            envDot: 'env-dot', mapBadgeHeader: 'map-badge-header'
        };
        for (var k in ids) {
            if (Object.prototype.hasOwnProperty.call(ids, k)) DOM[k] = $(ids[k]);
        }

        Estado.proximoPendente = lerPref('p55_proximo_pendente', '1') === '1';

        // Campos começam limpos (o browser pode restaurar valores antigos)
        DOM.filtroBusca.value = '';
        DOM.filtroSetor.value = '';
        DOM.achadosBusca.value = '';
        DOM.achadosOrdem.value = 'gravidade';

        ligarEventos();

        carregarDashboard();
        carregarSetores();
        carregarAtendimentos();
        carregarItensPendentes(true);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', inicializar);
    } else {
        inicializar();
    }
})();
