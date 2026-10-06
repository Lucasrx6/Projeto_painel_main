/* Painel 55 — Auditoria Pré-Faturamento
 * ES5 IIFE — sem bundler, sem transpilação
 */
(function () {
    'use strict';

    var CONFIG = {
        api: {
            dashboard:    '/api/auditoria/dashboard',
            atendimentos: '/api/auditoria/atendimentos',
            setores:      '/api/auditoria/setores',
            contas:       '/api/auditoria/contas',
            achados:    function (nric) { return '/api/auditoria/contas/' + encodeURIComponent(nric) + '/achados'; },
            auditar:    function (nric) { return '/api/auditoria/contas/' + encodeURIComponent(nric) + '/auditar'; },
            job:        function (id)   { return '/api/auditoria/jobs/' + encodeURIComponent(id); },
            feedback:   function (id)   { return '/api/auditoria/achados/' + id + '/feedback'; },
            validacao:  '/api/auditoria/validacao',
            iaStatus:   '/api/auditoria/ia/status'
        },
        pollMs: 1500
    };

    var Estado = {
        atendimentos:        [],
        atendimentoAtivo:    null,
        contaAtiva:          null,
        setores:             [],
        setorFiltro:         '',
        achados:             [],
        statusFiltro:        '',
        gravFiltro:          '',
        busca:               '',
        pagina:              1,
        total:               0,
        jobId:               null,
        jobTimer:            null,
        feedbackAchado:      null,
        validacaoRodando:    false,
        analiseFeita:        false,
        analiseQtTotal:      null,
        analiseIaUsada:      false
    };

    var _buscaTimer = null;

    var DOM = {};

    // =========================================================
    // Utilitários
    // =========================================================

    function escHtml(v) {
        var div = document.createElement('div');
        div.textContent = (v === null || v === undefined) ? '' : String(v);
        return div.innerHTML;
    }

    function formatarMoeda(v) {
        if (v === null || v === undefined) return '';
        var n = parseFloat(v);
        if (isNaN(n) || n === 0) return '';
        return 'R$ ' + n.toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, '.');
    }

    function formatarData(iso) {
        if (!iso) return '';
        var d = iso.substring(0, 10);
        var partes = d.split('-');
        if (partes.length !== 3) return d;
        return partes[2] + '/' + partes[1] + '/' + partes[0];
    }

    function labelGravidade(g) {
        var mapa = { critica: 'Crítica', alta: 'Alta', media: 'Média', baixa: 'Baixa' };
        return mapa[g] || (g || '');
    }

    function labelTipo(t) {
        var mapa = {
            cobrado_sem_respaldo:  'Cobrado s/ respaldo',
            realizado_sem_cobranca:'Realizado s/ cobrança',
            quantidade:            'Quantidade',
            data:                  'Data',
            assinatura:            'Assinatura',
            documento_ausente:     'Documento ausente',
            inconsistencia_tasy:   'Inconsistência Tasy'
        };
        return mapa[t] || (t || '');
    }

    function labelStatus(s) {
        var mapa = {
            pendente:          'Pendente',
            procede_corrigido: 'Corrigido',
            nao_procede:       'Não procede',
            ja_justificado:    'Justificado'
        };
        return mapa[s] || (s || '');
    }

    function classeStatus(s) {
        var mapa = {
            pendente:          'status-pendente',
            procede_corrigido: 'status-procede',
            nao_procede:       'status-nao-procede',
            ja_justificado:    'status-justificado'
        };
        return mapa[s] || 'status-pendente';
    }

    function badgeGravidade(g) {
        return '<span class="grav grav-' + escHtml(g) + '">' + escHtml(labelGravidade(g)) + '</span>';
    }

    function badgeStatus(s) {
        return '<span class="status-badge ' + classeStatus(s) + '">' + escHtml(labelStatus(s)) + '</span>';
    }

    // =========================================================
    // Fetch com credenciais
    // =========================================================

    function apiFetch(url, opts) {
        var options = opts || {};
        options.credentials = 'same-origin';
        if (!options.headers) options.headers = {};
        if (options.body) options.headers['Content-Type'] = 'application/json';
        return fetch(url, options);
    }

    // =========================================================
    // Dashboard (header stats)
    // =========================================================

    function carregarDashboard() {
        apiFetch(CONFIG.api.dashboard)
            .then(function (r) { return r.json(); })
            .then(function (data) {
                if (!data.success) return;
                var s = data.stats || {};
                DOM.statContas.textContent    = s.total_contas   != null ? s.total_contas   : '0';
                DOM.statCriticos.textContent  = s.criticos       != null ? s.criticos       : '0';
                DOM.statPendentes.textContent = s.pendentes      != null ? s.pendentes      : '0';
                DOM.statRisco.textContent     = s.vl_risco_total != null ? formatarMoeda(s.vl_risco_total) : '–';
            })
            .catch(function () {
                DOM.statContas.textContent = '!';
            });
    }

    // =========================================================
    // Lista de atendimentos agrupados (sidebar)
    // =========================================================

    function carregarAtendimentos() {
        var params = [];
        if (Estado.busca)       params.push('busca='     + encodeURIComponent(Estado.busca));
        if (Estado.gravFiltro)  params.push('gravidade=' + encodeURIComponent(Estado.gravFiltro));
        if (Estado.setorFiltro) params.push('setor='     + encodeURIComponent(Estado.setorFiltro));
        params.push('pagina=' + Estado.pagina);
        params.push('por_pagina=100');
        var url = CONFIG.api.atendimentos + (params.length ? '?' + params.join('&') : '');

        DOM.contasLista.innerHTML =
            '<div class="loading-state"><i class="fa fa-circle-notch fa-spin"></i><p>Carregando…</p></div>';

        apiFetch(url)
            .then(function (r) { return r.json(); })
            .then(function (data) {
                if (!data.success) {
                    DOM.contasLista.innerHTML =
                        '<div class="loading-state">' +
                        '<i class="fa fa-exclamation-triangle" style="color:#dc2626;"></i>' +
                        '<p style="color:#dc2626;">Não foi possível carregar os atendimentos.<br>' +
                        '<small style="color:#64748b;">Verifique o log do servidor.</small></p></div>';
                    Estado.atendimentos = [];
                    Estado.total = 0;
                    if (DOM.contasTotal) DOM.contasTotal.textContent = '';
                    return;
                }
                Estado.atendimentos = data.atendimentos || [];
                Estado.total        = data.total        || 0;
                renderAtendimentos();
            })
            .catch(function () {
                DOM.contasLista.innerHTML =
                    '<div class="loading-state"><p>Erro de comunicação. Tente novamente.</p></div>';
            });
    }

    function _nomeSetor(cd) {
        if (!cd) return '';
        for (var i = 0; i < Estado.setores.length; i++) {
            if (Estado.setores[i].cd === cd) return Estado.setores[i].nm;
        }
        return 'Setor ' + cd;
    }

    function renderAtendimentos() {
        // Atualiza contador no título da sidebar
        if (DOM.contasTotal) {
            DOM.contasTotal.textContent = Estado.total > 0 ? ' (' + Estado.total + ')' : '';
        }

        if (Estado.atendimentos.length === 0) {
            DOM.contasLista.innerHTML =
                '<div class="loading-state"><p>' +
                (Estado.busca ? 'Nenhum resultado para "' + escHtml(Estado.busca) + '".'
                              : 'Nenhum atendimento encontrado.') +
                '</p></div>';
            return;
        }

        var html = '';
        for (var i = 0; i < Estado.atendimentos.length; i++) {
            var at = Estado.atendimentos[i];
            var ativo = Estado.atendimentoAtivo &&
                Estado.atendimentoAtivo.nr_atendimento === at.nr_atendimento;
            var contaLabel = at.qt_contas === 1 ? '1 conta' : (at.qt_contas + ' contas');
            var setor = _nomeSetor(at.cd_setor_atendimento);

            html +=
                '<button class="conta-item' + (ativo ? ' ativo' : '') + '" data-idx="' + i + '">' +
                '<div class="conta-item-header">' +
                '<span class="conta-nr">AT ' + escHtml(String(at.nr_atendimento)) +
                ' <span style="font-weight:400;color:#94a3b8;font-size:11px;">· ' + escHtml(contaLabel) + '</span></span>' +
                (at.gravidade_maxima
                    ? '<span class="grav grav-' + escHtml(at.gravidade_maxima) + '">' + escHtml(labelGravidade(at.gravidade_maxima)) + '</span>'
                    : '') +
                '</div>' +
                '<div class="conta-item-body">' +
                (at.dt_periodo_final_max
                    ? '<span class="conta-data">' + escHtml(formatarData(at.dt_periodo_final_max)) + '</span>'
                    : '') +
                (at.criticos
                    ? '<span class="mini-badge mini-critica">' + escHtml(String(at.criticos)) + ' crít</span>'
                    : '') +
                (at.pendentes
                    ? '<span class="mini-badge mini-pendente">' + escHtml(String(at.pendentes)) + ' pend</span>'
                    : '') +
                (at.vl_risco_total
                    ? '<span class="mini-badge mini-risco">' + escHtml(formatarMoeda(at.vl_risco_total)) + '</span>'
                    : '') +
                (setor
                    ? '<span class="conta-setor-tag">' + escHtml(setor) + '</span>'
                    : '') +
                '</div>' +
                '</button>';
        }

        DOM.contasLista.innerHTML = html;

        var botoes = DOM.contasLista.querySelectorAll('.conta-item');
        for (var j = 0; j < botoes.length; j++) {
            botoes[j].addEventListener('click', onAtendimentoClick);
        }
    }

    function onAtendimentoClick(e) {
        var btn = e.currentTarget;
        var idx = parseInt(btn.getAttribute('data-idx'), 10);
        var atend = Estado.atendimentos[idx];
        if (!atend || !atend.contas || !atend.contas.length) return;

        if (Estado.jobId) { clearTimeout(Estado.jobTimer); Estado.jobId = null; Estado.jobTimer = null; }
        DOM.btnExecutar.disabled = false;
        DOM.jobBar.style.display = 'none';

        Estado.atendimentoAtivo = atend;
        Estado.contaAtiva       = atend.contas[0];
        Estado.statusFiltro     = '';
        Estado.analiseFeita     = false;
        Estado.analiseQtTotal   = null;
        Estado.analiseIaUsada   = false;

        // Atualiza sidebar
        var items = DOM.contasLista.querySelectorAll('.conta-item');
        for (var j = 0; j < items.length; j++) {
            items[j].classList.toggle('ativo', items[j] === btn);
        }

        mostrarDetalhe(atend);
        carregarAchados();
    }

    function onContaSelectorChange() {
        if (!Estado.atendimentoAtivo) return;
        var val = DOM.contaSelector.value;
        var contas = Estado.atendimentoAtivo.contas || [];
        for (var i = 0; i < contas.length; i++) {
            if (String(contas[i].nr_interno_conta) === val) {
                if (Estado.jobId) {
                    clearTimeout(Estado.jobTimer);
                    Estado.jobId = null;
                    Estado.jobTimer = null;
                }
                DOM.btnExecutar.disabled = false;
                DOM.jobBar.style.display = 'none';
                Estado.contaAtiva     = contas[i];
                Estado.analiseFeita   = false;
                Estado.analiseQtTotal = null;
                Estado.analiseIaUsada = false;
                _atualizarMetaConta();
                carregarAchados();
                return;
            }
        }
    }

    function carregarSetores() {
        apiFetch(CONFIG.api.setores)
            .then(function (r) { return r.json(); })
            .then(function (data) {
                if (!data.success) return;
                Estado.setores = data.setores || [];
                _popularFiltroSetor();
            })
            .catch(function () {});
    }

    function _popularFiltroSetor() {
        if (!DOM.filtroSetor) return;
        var html = '<option value="">Todos os setores</option>';
        for (var i = 0; i < Estado.setores.length; i++) {
            var s = Estado.setores[i];
            html += '<option value="' + escHtml(String(s.cd)) + '">' + escHtml(s.nm) + '</option>';
        }
        DOM.filtroSetor.innerHTML = html;
    }

    // =========================================================
    // Detalhe da conta + achados
    // =========================================================

    function mostrarDetalhe(atend) {
        DOM.emptyState.style.display   = 'none';
        DOM.contaDetalhe.style.display = '';

        var setor = _nomeSetor(atend.cd_setor_atendimento);
        DOM.detalheTitulo.textContent = 'Atendimento ' + atend.nr_atendimento +
            (setor ? ' — ' + setor : '');

        _atualizarMetaConta();
        _atualizarContaSelector(atend);
        resetarFiltrosTabs();
    }

    function _atualizarMetaConta() {
        if (!Estado.contaAtiva) return;
        var c = Estado.contaAtiva;
        var meta = [];
        if (c.nr_interno_conta) meta.push('Conta ' + c.nr_interno_conta);
        if (c.dt_periodo_final)  meta.push('Período até ' + formatarData(c.dt_periodo_final));
        DOM.detalheMeta.textContent = meta.join(' · ');
    }

    function _atualizarContaSelector(atend) {
        var contas = (atend && atend.contas) ? atend.contas : [];
        if (!DOM.contaSelectorWrapper) return;
        if (contas.length <= 1) {
            DOM.contaSelectorWrapper.style.display = 'none';
            return;
        }
        DOM.contaSelectorWrapper.style.display = '';
        var html = '';
        for (var i = 0; i < contas.length; i++) {
            var c = contas[i];
            var label = 'Conta ' + c.nr_interno_conta +
                (c.dt_periodo_final ? ' (' + formatarData(c.dt_periodo_final) + ')' : '');
            var sel = (Estado.contaAtiva &&
                       Estado.contaAtiva.nr_interno_conta === c.nr_interno_conta)
                      ? ' selected' : '';
            html += '<option value="' + escHtml(String(c.nr_interno_conta)) + '"' + sel + '>' +
                escHtml(label) + '</option>';
        }
        DOM.contaSelector.innerHTML = html;
    }

    function resetarFiltrosTabs() {
        Estado.statusFiltro = '';
        var tabs = DOM.achFiltros.querySelectorAll('.filtro-tab');
        for (var i = 0; i < tabs.length; i++) {
            tabs[i].classList.toggle('ativo', tabs[i].getAttribute('data-status') === '');
        }
    }

    function carregarAchados() {
        if (!Estado.contaAtiva) return;

        DOM.achLoading.style.display = '';
        DOM.achVazio.style.display   = 'none';
        DOM.achTabela.style.display  = 'none';

        var url = CONFIG.api.achados(Estado.contaAtiva.nr_interno_conta);
        if (Estado.statusFiltro) url += '?status=' + encodeURIComponent(Estado.statusFiltro);

        apiFetch(url)
            .then(function (r) { return r.json(); })
            .then(function (data) {
                if (!data.success) {
                    // Erro do servidor — não interpreta como "sem achados"
                    Estado.achados = [];
                    Estado.analiseFeita = false;
                    DOM.achLoading.style.display = 'none';
                    DOM.achVazio.style.display   = '';
                    DOM.achTabela.style.display  = 'none';
                    DOM.achVazio.innerHTML =
                        '<i class="fa fa-exclamation-triangle" style="color:#dc2626;"></i>' +
                        '&nbsp; <span style="color:#dc2626;">Não foi possível carregar os achados.</span>' +
                        '<br><span style="font-size:11px;color:#64748b;">Verifique o log do servidor.</span>';
                    return;
                }
                Estado.achados = data.achados || [];
                renderAchados();
            })
            .catch(function () {
                Estado.achados = [];
                Estado.analiseFeita = false;
                DOM.achLoading.style.display = 'none';
                DOM.achVazio.style.display   = '';
                DOM.achTabela.style.display  = 'none';
                DOM.achVazio.innerHTML =
                    '<i class="fa fa-exclamation-triangle" style="color:#dc2626;"></i>' +
                    '&nbsp; <span style="color:#dc2626;">Erro de comunicação. Tente novamente.</span>';
            });
    }

    function renderAchados() {
        DOM.achLoading.style.display = 'none';

        if (Estado.achados.length === 0) {
            DOM.achVazio.style.display  = '';
            DOM.achTabela.style.display = 'none';

            var temFiltro = Estado.statusFiltro !== '';
            if (temFiltro) {
                DOM.achVazio.innerHTML =
                    '<i class="fa fa-filter" style="opacity:.5;"></i>' +
                    '&nbsp; Nenhum achado para o filtro selecionado.';
            } else if (Estado.analiseFeita && Estado.analiseQtTotal === 0) {
                DOM.achVazio.innerHTML =
                    '<i class="fa fa-check-circle" style="color:#16a34a;"></i>' +
                    '&nbsp; <strong style="color:#16a34a;">Conta verificada — nenhuma inconsistência detectada.</strong>' +
                    (Estado.analiseIaUsada
                        ? '<br><span style="font-size:11px;color:#64748b;">Análise: regras determinísticas + leitura IA (Groq)</span>'
                        : '<br><span style="font-size:11px;color:#64748b;">Análise: regras determinísticas</span>');
            } else {
                DOM.achVazio.innerHTML =
                    '<i class="fa fa-search" style="opacity:.5;"></i>' +
                    '&nbsp; Nenhum achado. Clique em <strong>Executar Regras</strong> para analisar esta conta.';
            }
            return;
        }

        DOM.achVazio.style.display  = 'none';
        DOM.achTabela.style.display = '';

        var html = '';
        for (var i = 0; i < Estado.achados.length; i++) {
            var a = Estado.achados[i];

            var podeFeedback = a.status_tratamento === 'pendente';
            var btnFeedback = podeFeedback
                ? '<button class="btn-feedback" data-id="' + a.id + '" data-idx="' + i + '">Decidir</button>'
                : '';

            // Indicador visual: mostra seta se há explicação ou evidência
            var temDetalhe = !!(a.explicacao_ia || a.evidencia_trecho);
            var setaHtml =
                '<span class="row-expand-arrow' + (temDetalhe ? '' : ' row-expand-arrow-vazio') + '">' +
                '<i class="fa fa-chevron-right"></i></span>';

            // Linha principal — clicável para expandir detalhe
            html +=
                '<tr class="achado-row" data-id="' + a.id + '" data-idx="' + i + '">' +
                '<td>' +
                setaHtml +
                '<span class="regra-badge">' + escHtml(a.cd_regra || '') + '</span>' +
                (a.ds_regra ? '<br><span style="font-size:11px;color:#64748b;">' + escHtml(a.ds_regra) + '</span>' : '') +
                '</td>' +
                '<td><span class="tipo-tag">' + escHtml(labelTipo(a.tipo_achado)) + '</span></td>' +
                '<td>' + badgeGravidade(a.gravidade) + '</td>' +
                '<td>' +
                '<div class="ds-texto">' + escHtml(a.ds_encontrado || '') + '</div>' +
                (a.ds_esperado
                    ? '<div class="ds-esperado">Esperado: ' + escHtml(a.ds_esperado) + '</div>'
                    : '') +
                '</td>' +
                '<td class="col-valor">' +
                (a.vl_risco ? '<span class="vl-risco">' + escHtml(formatarMoeda(a.vl_risco)) + '</span>' : '–') +
                '</td>' +
                '<td>' + badgeStatus(a.status_tratamento) + '</td>' +
                '<td class="col-acoes">' + btnFeedback + '</td>' +
                '</tr>';

            // Linha de detalhe — oculta até clicar na linha principal
            var detalheHtml = '<div class="achado-detalhe-conteudo">';

            if (a.explicacao_ia) {
                detalheHtml +=
                    '<div class="detalhe-bloco">' +
                    '<div class="detalhe-bloco-titulo"><i class="fa fa-magnifying-glass-chart"></i> Onde foi encontrado o problema</div>' +
                    '<p class="detalhe-bloco-texto">' + escHtml(a.explicacao_ia) + '</p>' +
                    '</div>';
            }
            if (a.recomendacao_ia) {
                detalheHtml +=
                    '<div class="detalhe-bloco detalhe-bloco-rec">' +
                    '<div class="detalhe-bloco-titulo"><i class="fa fa-circle-check"></i> O que fazer para corrigir</div>' +
                    '<p class="detalhe-bloco-texto">' + escHtml(a.recomendacao_ia) + '</p>' +
                    '</div>';
            }
            if (!a.explicacao_ia && !a.recomendacao_ia) {
                detalheHtml +=
                    '<div class="detalhe-bloco detalhe-bloco-vazio">' +
                    '<i class="fa fa-circle-info"></i> ' +
                    'Explicação de IA não disponível para este achado. ' +
                    'Execute a análise com IA habilitada para gerar explicações detalhadas.' +
                    '</div>';
            }
            if (a.evidencia_trecho) {
                detalheHtml +=
                    '<div class="detalhe-bloco detalhe-bloco-evidencia">' +
                    '<div class="detalhe-bloco-titulo"><i class="fa fa-quote-left"></i> Trecho de evidência</div>' +
                    '<pre class="detalhe-pre">' + escHtml(a.evidencia_trecho) + '</pre>' +
                    '</div>';
            }

            detalheHtml += '</div>';

            html +=
                '<tr class="achado-detalhe-row" id="detail-' + a.id + '" style="display:none;">' +
                '<td colspan="7">' + detalheHtml + '</td>' +
                '</tr>';
        }

        DOM.achTbody.innerHTML = html;

        var btns = DOM.achTbody.querySelectorAll('.btn-feedback');
        for (var j = 0; j < btns.length; j++) {
            btns[j].addEventListener('click', onFeedbackClick);
        }
    }

    function _trAncestral(el) {
        while (el && el.tagName !== 'TR') el = el.parentNode;
        return el || null;
    }

    function onAchadoRowClick(e) {
        var tgt = e.target;
        // Não expandir ao clicar em botão (feedback, etc.)
        var el = tgt;
        while (el && el !== DOM.achTbody) {
            if (el.tagName === 'BUTTON') return;
            el = el.parentNode;
        }

        var tr = _trAncestral(tgt);
        if (!tr || tr.className.indexOf('achado-row') === -1) return;

        var achId  = tr.getAttribute('data-id');
        var detail = document.getElementById('detail-' + achId);
        if (!detail) return;

        var jaAberto = detail.style.display !== 'none';

        // Fecha todas as linhas de detalhe abertas
        var todos = DOM.achTbody.querySelectorAll('.achado-detalhe-row');
        for (var k = 0; k < todos.length; k++) todos[k].style.display = 'none';
        var todasRows = DOM.achTbody.querySelectorAll('.achado-row');
        for (var k = 0; k < todasRows.length; k++) {
            todasRows[k].className = todasRows[k].className.replace(' expandido', '');
        }

        if (!jaAberto) {
            detail.style.display = '';
            tr.className += ' expandido';
        }
    }

    // =========================================================
    // Executar regras (job)
    // =========================================================

    function executarAnalise() {
        if (!Estado.contaAtiva) return;
        if (Estado.jobId) return;

        DOM.btnExecutar.disabled = true;
        DOM.jobBar.style.display = '';
        DOM.jobTexto.textContent = 'Iniciando análise…';

        apiFetch(CONFIG.api.auditar(Estado.contaAtiva.nr_interno_conta), { method: 'POST' })
            .then(function (r) { return r.json(); })
            .then(function (data) {
                if (data.success && data.job_id) {
                    Estado.jobId = data.job_id;
                    if (data.existente) {
                        DOM.jobTexto.textContent = 'Retomando job existente…';
                    }
                    pollJob();
                } else {
                    var msg = (data && data.error) ? data.error : 'Erro ao iniciar análise';
                    mostrarErroJob(msg);
                }
            })
            .catch(function () {
                mostrarErroJob('Falha de comunicação com o servidor');
            });
    }

    function pollJob() {
        if (!Estado.jobId) return;

        apiFetch(CONFIG.api.job(Estado.jobId))
            .then(function (r) { return r.json(); })
            .then(function (data) {
                if (!data.success) { mostrarErroJob('Job não encontrado'); return; }
                var job = data.job;
                var status = job.status || '';

                if (status === 'fila' || status === 'rodando') {
                    var etapaTxt = status === 'rodando'
                        ? (job.etapa === 'ia' ? 'Executando leitura IA…' : 'Executando regras…')
                        : 'Na fila…';
                    DOM.jobTexto.textContent = etapaTxt;
                    Estado.jobTimer = setTimeout(pollJob, CONFIG.pollMs);
                    return;
                }

                if (status === 'concluida') {
                    DOM.jobBar.style.display = 'none';
                    DOM.btnExecutar.disabled = false;
                    Estado.jobId = null;
                    Estado.analiseFeita   = true;
                    Estado.analiseQtTotal = (job.qt_achados_regras || 0) + (job.qt_achados_ia || 0);
                    Estado.analiseIaUsada = job.ia_usada || false;
                    carregarAchados();
                    carregarDashboard();
                    carregarAtendimentos();
                    return;
                }

                if (status === 'erro' || status === 'cancelada') {
                    mostrarErroJob(job.erro || 'Erro na execução das regras');
                }
            })
            .catch(function () {
                Estado.jobTimer = setTimeout(pollJob, CONFIG.pollMs * 2);
            });
    }

    // =========================================================
    // Validação do ambiente
    // =========================================================

    function executarValidacao() {
        if (Estado.validacaoRodando) return;
        Estado.validacaoRodando = true;

        var btnVal  = document.getElementById('btn-validacao');
        var divRes  = document.getElementById('validacao-resultado');
        if (btnVal)  btnVal.disabled = true;
        if (divRes)  divRes.innerHTML = '<i class="fa fa-circle-notch fa-spin"></i> Verificando ambiente…';

        apiFetch(CONFIG.api.validacao)
            .then(function (r) { return r.json(); })
            .then(function (data) {
                Estado.validacaoRodando = false;
                if (btnVal) btnVal.disabled = false;
                if (!data.success || !divRes) return;
                var v = data.validacao || {};

                // veredito
                var corVer = v.veredito === 'PRONTO_PARA_IA' ? '#16a34a' : '#dc2626';
                var res = v.resumo || {};
                var html =
                    '<div style="margin-bottom:8px;font-weight:600;color:' + escHtml(corVer) + ';">' +
                    escHtml(v.veredito || '') +
                    '<span style="font-weight:400;font-size:11px;margin-left:8px;color:#64748b;">' +
                    escHtml(String(res.ok || 0)) + ' OK · ' +
                    escHtml(String(res.falha || 0)) + ' Falha · ' +
                    escHtml(String(res.aviso || 0)) + ' Aviso' +
                    '</span></div>';

                // resultados — o objeto tem: id, grupo, descricao, status, detalhe
                var resultados = v.resultados || [];
                for (var i = 0; i < resultados.length; i++) {
                    var r2 = resultados[i];
                    var st = (r2.status || '').toUpperCase();
                    var ico, cl;
                    if (st === 'OK')     { ico = '✓'; cl = 'color:#16a34a'; }
                    else if (st === 'AVISO')  { ico = '⚠'; cl = 'color:#d97706'; }
                    else if (st === 'PULADO') { ico = '–'; cl = 'color:#94a3b8'; }
                    else                 { ico = '✗'; cl = 'color:#dc2626'; }

                    var detalhe = r2.detalhe ? ' — ' + r2.detalhe : '';
                    html += '<div style="font-size:11px;' + cl + ';margin:2px 0;" title="' +
                        escHtml(r2.descricao || '') + escHtml(detalhe) + '">' +
                        escHtml(ico) + ' ' + escHtml(r2.id || '') +
                        ': ' + escHtml(r2.descricao || '') +
                        (r2.detalhe ? '<span style="color:#64748b;"> (' + escHtml(r2.detalhe) + ')</span>' : '') +
                        '</div>';
                }
                divRes.innerHTML = html;
            })
            .catch(function () {
                Estado.validacaoRodando = false;
                if (btnVal) btnVal.disabled = false;
                if (divRes) divRes.innerHTML = '<span style="color:#dc2626;">Erro ao executar validação</span>';
            });
    }

    function mostrarErroJob(msg) {
        DOM.jobBar.style.display = 'none';
        DOM.btnExecutar.disabled = false;
        Estado.jobId = null;
        if (Estado.jobTimer) { clearTimeout(Estado.jobTimer); Estado.jobTimer = null; }
        alert('Erro: ' + msg);
    }

    // =========================================================
    // Modal de feedback
    // =========================================================

    function onFeedbackClick(e) {
        var btn = e.currentTarget;
        var idx = parseInt(btn.getAttribute('data-idx'), 10);
        var achado = Estado.achados[idx];
        if (!achado) return;
        Estado.feedbackAchado = achado;
        abrirModal(achado);
    }

    function abrirModal(achado) {
        DOM.modalResumo.innerHTML =
            '<strong>' + escHtml(achado.cd_regra || '') + '</strong> — ' +
            escHtml(labelTipo(achado.tipo_achado)) + ' ' +
            badgeGravidade(achado.gravidade) +
            '<div style="margin-top:6px;font-size:12px;color:#475569;">' +
            escHtml(achado.ds_encontrado || '') +
            '</div>';

        DOM.modalDecisao.value       = '';
        DOM.modalJustificativa.value = '';
        DOM.modalErro.style.display  = 'none';
        DOM.modalFeedback.style.display = '';
    }

    function fecharModal() {
        DOM.modalFeedback.style.display = 'none';
        Estado.feedbackAchado = null;
    }

    function confirmarFeedback() {
        var decisao      = DOM.modalDecisao.value;
        var justificativa = DOM.modalJustificativa.value.trim();

        if (!decisao) {
            mostrarErroModal('Selecione uma decisão.');
            return;
        }
        if (justificativa.length < 10) {
            mostrarErroModal('Justificativa muito curta (mínimo 10 caracteres).');
            return;
        }

        DOM.modalConfirmar.disabled = true;
        DOM.modalErro.style.display = 'none';

        var achado = Estado.feedbackAchado;
        apiFetch(CONFIG.api.feedback(achado.id), {
            method: 'POST',
            body: JSON.stringify({ decisao: decisao, justificativa: justificativa })
        })
            .then(function (r) { return r.json(); })
            .then(function (data) {
                DOM.modalConfirmar.disabled = false;
                if (data.success) {
                    fecharModal();
                    carregarAchados();
                    carregarDashboard();
                    carregarAtendimentos();
                } else {
                    mostrarErroModal((data && data.error) ? data.error : 'Erro ao registrar decisão');
                }
            })
            .catch(function () {
                DOM.modalConfirmar.disabled = false;
                mostrarErroModal('Falha de comunicação com o servidor');
            });
    }

    function mostrarErroModal(msg) {
        DOM.modalErro.textContent   = msg;
        DOM.modalErro.style.display = '';
    }

    // =========================================================
    // Inicialização
    // =========================================================

    function inicializar() {
        DOM.statContas     = document.getElementById('stat-contas');
        DOM.statCriticos   = document.getElementById('stat-criticos');
        DOM.statPendentes  = document.getElementById('stat-pendentes');
        DOM.statRisco      = document.getElementById('stat-risco');
        DOM.contasLista    = document.getElementById('contas-lista');
        DOM.contasTotal    = document.getElementById('contas-total');
        DOM.filtroBusca    = document.getElementById('filtro-busca');
        DOM.filtrGrav      = document.getElementById('filtro-gravidade');
        DOM.filtroSetor    = document.getElementById('filtro-setor');

        // Garante que os filtros começam limpos
        if (DOM.filtroBusca) DOM.filtroBusca.value = '';
        Estado.busca      = '';
        if (DOM.filtrGrav)   DOM.filtrGrav.value   = '';
        Estado.gravFiltro = '';
        if (DOM.filtroSetor) DOM.filtroSetor.value  = '';
        Estado.setorFiltro = '';

        DOM.emptyState          = document.getElementById('empty-state');
        DOM.contaDetalhe        = document.getElementById('conta-detalhe');
        DOM.detalheTitulo       = document.getElementById('detalhe-titulo');
        DOM.detalheMeta         = document.getElementById('detalhe-meta');
        DOM.contaSelectorWrapper = document.getElementById('conta-selector-wrapper');
        DOM.contaSelector       = document.getElementById('conta-selector');
        DOM.btnExecutar         = document.getElementById('btn-executar');
        DOM.jobBar              = document.getElementById('job-bar');
        DOM.jobTexto            = document.getElementById('job-texto');
        DOM.achFiltros          = document.getElementById('achados-filtros');
        DOM.achLoading          = document.getElementById('achados-loading');
        DOM.achVazio            = document.getElementById('achados-vazio');
        DOM.achTabela           = document.getElementById('achados-tabela');
        DOM.achTbody            = document.getElementById('achados-tbody');
        DOM.modalFeedback       = document.getElementById('modal-feedback');
        DOM.modalOverlay        = document.getElementById('modal-overlay');
        DOM.modalResumo         = document.getElementById('modal-resumo');
        DOM.modalDecisao        = document.getElementById('modal-decisao');
        DOM.modalJustificativa  = document.getElementById('modal-justificativa');
        DOM.modalErro           = document.getElementById('modal-erro');
        DOM.modalConfirmar      = document.getElementById('modal-confirmar');

        // Eventos
        document.getElementById('btn-refresh').addEventListener('click', function () {
            Estado.pagina = 1;
            carregarDashboard();
            carregarAtendimentos();
        });

        if (DOM.filtroBusca) {
            DOM.filtroBusca.addEventListener('input', function () {
                var termo = this.value.trim();
                clearTimeout(_buscaTimer);
                _buscaTimer = setTimeout(function () {
                    Estado.busca  = termo;
                    Estado.pagina = 1;
                    carregarAtendimentos();
                }, 450);
            });
        }

        DOM.filtrGrav.addEventListener('change', function () {
            Estado.gravFiltro = this.value;
            Estado.pagina     = 1;
            carregarAtendimentos();
        });

        if (DOM.filtroSetor) {
            DOM.filtroSetor.addEventListener('change', function () {
                Estado.setorFiltro = this.value;
                Estado.pagina      = 1;
                carregarAtendimentos();
            });
        }

        if (DOM.contaSelector) {
            DOM.contaSelector.addEventListener('change', onContaSelectorChange);
        }

        DOM.btnExecutar.addEventListener('click', executarAnalise);

        // Tabs de filtro de achados
        var tabs = DOM.achFiltros.querySelectorAll('.filtro-tab');
        for (var i = 0; i < tabs.length; i++) {
            tabs[i].addEventListener('click', onFiltroTabClick);
        }

        // Modal
        document.getElementById('modal-fechar').addEventListener('click', fecharModal);
        document.getElementById('modal-cancelar').addEventListener('click', fecharModal);
        DOM.modalOverlay.addEventListener('click', fecharModal);
        DOM.modalConfirmar.addEventListener('click', confirmarFeedback);

        // Expansão de linha de achado (event delegation persistente entre renders)
        DOM.achTbody.addEventListener('click', onAchadoRowClick);

        // Botão validação
        var btnVal = document.getElementById('btn-validacao');
        if (btnVal) btnVal.addEventListener('click', executarValidacao);

        // Carga inicial
        carregarDashboard();
        carregarSetores();
        carregarAtendimentos();
    }

    function onFiltroTabClick(e) {
        var btn = e.currentTarget;
        Estado.statusFiltro = btn.getAttribute('data-status') || '';
        var tabs = DOM.achFiltros.querySelectorAll('.filtro-tab');
        for (var i = 0; i < tabs.length; i++) {
            tabs[i].classList.toggle('ativo', tabs[i] === btn);
        }
        carregarAchados();
    }

    window.addEventListener('DOMContentLoaded', inicializar);
})();
