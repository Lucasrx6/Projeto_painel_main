var PAINEL_VERSAO = '1.0.52';
(function () {
    'use strict';

    var CONFIG = {
        apiBase: '/api/paineis/painel42',
        refreshInterval: 15000,
        storageKeyMembro: 'p42_membro_id'
    };

    var Estado = {
        fila: [],
        equipe: [],
        historico: [],
        contadores: { aguardando: 0, aceito: 0, em_preparo: 0, pronto: 0, em_entrega: 0 },
        membroId: null,
        idsAnteriores: [],
        idsUrgentesAnteriores: [],
        processando: false
    };

    var DOM = {};

    // =========================================================
    // ESCAPE HTML / TEMPO
    // =========================================================
    function escHtml(s) {
        return String(s || '')
            .replace(/&/g, '&amp;').replace(/</g, '&lt;')
            .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    function fmtMin(n) {
        var total = Math.round(Number(n) || 0);
        if (total <= 0) return '0min';
        if (total < 60) return total + 'min';
        var h = Math.floor(total / 60);
        var m = total % 60;
        return m > 0 ? (h + 'h ' + m + 'min') : (h + 'h');
    }

    // =========================================================
    // CONFIGURAÇÕES DE STATUS
    // =========================================================
    var STATUS_CFG = {
        aguardando: { label: 'Aguardando', cor: '#6C757D', col: 'col-aguardando' },
        aceito:     { label: 'Aceito',     cor: '#17A2B8', col: 'col-aceito'     },
        em_preparo: { label: 'Em Preparo', cor: '#E67E00', col: 'col-em_preparo' },
        pronto:     { label: 'Pronto',     cor: '#8BC34A', col: 'col-pronto'     },
        em_entrega: { label: 'Em Entrega', cor: '#6F42C1', col: 'col-em_entrega' },
        entregue:   { label: 'Entregue',   cor: '#28A745', col: null             },
        cancelado:  { label: 'Cancelado',  cor: '#DC3545', col: null             }
    };

    function badgeStatus(status) {
        var cfg = STATUS_CFG[status] || { label: status, cor: '#6C757D' };
        return '<span class="badge-status" style="background:' + cfg.cor + ';">' + escHtml(cfg.label) + '</span>';
    }

    // =========================================================
    // INICIALIZAR
    // =========================================================
    function inicializar() {
        var btnVoltar = document.getElementById('btn-voltar-hub');
        if (btnVoltar) {
            btnVoltar.addEventListener('click', function () { window.location.href = '/painel/painel44'; });
        }

        DOM.selMembro         = document.getElementById('sel-membro');
        DOM.ultimoUpdate      = document.getElementById('ultimo-update');
        DOM.historicoBody     = document.getElementById('historico-body');
        DOM.btnToggleHist     = document.getElementById('btn-toggle-historico');
        DOM.iconeToggle       = document.getElementById('icone-toggle');
        DOM.tbodyHistorico    = document.getElementById('tbody-historico');
        DOM.histEmpty         = document.getElementById('hist-empty');
        DOM.badgeHistorico    = document.getElementById('badge-historico');
        DOM.filtroSetor42         = document.getElementById('filtro-setor-42');
        DOM.audioAlerta           = document.getElementById('audio-alerta');
        DOM.chkImprimirAceitar    = document.getElementById('chk-imprimir-aceitar');

        // Modal aceitar
        DOM.modalAceitar      = document.getElementById('modal-aceitar');
        DOM.accSid            = document.getElementById('acc-sid');
        DOM.accDesc           = document.getElementById('acc-desc');
        DOM.accSelMembro      = document.getElementById('acc-sel-membro');
        DOM.accErro           = document.getElementById('acc-erro');
        DOM.btnAccConfirmar   = document.getElementById('btn-acc-confirmar');
        DOM.btnAccFechar      = document.getElementById('btn-acc-fechar');

        // Modal entregar
        DOM.modalEntregar     = document.getElementById('modal-entregar');
        DOM.entrSid           = document.getElementById('entr-sid');
        DOM.entrDesc          = document.getElementById('entr-desc');
        DOM.inpCodigoConfirm  = document.getElementById('inp-codigo-confirm');
        DOM.codigoFeedback    = document.getElementById('codigo-feedback');
        DOM.entrObs           = document.getElementById('entr-obs');
        DOM.entrErro          = document.getElementById('entr-erro');
        DOM.btnEntrConfirmar  = document.getElementById('btn-entr-confirmar');
        DOM.btnEntrFechar     = document.getElementById('btn-entr-fechar');

        // Modal cancelar
        DOM.modalCancelar     = document.getElementById('modal-cancelar');
        DOM.cancSid           = document.getElementById('canc-sid');
        DOM.cancDesc          = document.getElementById('canc-desc');
        DOM.cancMotivo        = document.getElementById('canc-motivo');
        DOM.cancErro          = document.getElementById('canc-erro');
        DOM.btnCancConfirmar  = document.getElementById('btn-canc-confirmar');
        DOM.btnCancFechar     = document.getElementById('btn-canc-fechar');

        // Restaurar membro salvo
        var membroSalvo = localStorage.getItem(CONFIG.storageKeyMembro);
        if (membroSalvo) Estado.membroId = membroSalvo;

        // Restaurar preferência de impressão
        if (DOM.chkImprimirAceitar) {
            DOM.chkImprimirAceitar.checked = (localStorage.getItem('p42_imprimir_aceitar') === '1');
            DOM.chkImprimirAceitar.addEventListener('change', function () {
                localStorage.setItem('p42_imprimir_aceitar', this.checked ? '1' : '0');
            });
        }

        // Eventos
        DOM.selMembro.addEventListener('change', function () {
            Estado.membroId = this.value || null;
            if (Estado.membroId) {
                localStorage.setItem(CONFIG.storageKeyMembro, Estado.membroId);
            } else {
                localStorage.removeItem(CONFIG.storageKeyMembro);
            }
        });

        DOM.btnToggleHist.addEventListener('click', toggleHistorico);
        if (DOM.filtroSetor42) {
            DOM.filtroSetor42.addEventListener('change', renderHistorico);
            DOM.filtroSetor42.addEventListener('click', function (e) { e.stopPropagation(); });
        }
        DOM.btnAccFechar.addEventListener('click', function () { fecharModal(DOM.modalAceitar); });
        DOM.btnAccConfirmar.addEventListener('click', confirmarAceitar);
        DOM.btnEntrFechar.addEventListener('click', function () { fecharModal(DOM.modalEntregar); });
        DOM.btnEntrConfirmar.addEventListener('click', confirmarEntrega);
        DOM.btnCancFechar.addEventListener('click', function () { fecharModal(DOM.modalCancelar); });
        DOM.btnCancConfirmar.addEventListener('click', confirmarCancelar);

        DOM.inpCodigoConfirm.addEventListener('input', validarCodigoInput);

        // Fechar modais no overlay
        DOM.modalAceitar.addEventListener('click', function (e) { if (e.target === DOM.modalAceitar) fecharModal(DOM.modalAceitar); });
        DOM.modalEntregar.addEventListener('click', function (e) { if (e.target === DOM.modalEntregar) fecharModal(DOM.modalEntregar); });
        DOM.modalCancelar.addEventListener('click', function (e) { if (e.target === DOM.modalCancelar) fecharModal(DOM.modalCancelar); });

        carregarEquipe();
        carregarFila();
        carregarHistorico();
        setInterval(cicloAtualizar, CONFIG.refreshInterval);
    }

    // =========================================================
    // EQUIPE
    // =========================================================
    function carregarEquipe() {
        fetch(CONFIG.apiBase + '/equipe', { credentials: 'same-origin' })
            .then(function (r) { return r.json(); })
            .then(function (data) {
                if (data.success) {
                    Estado.equipe = data.equipe || [];
                    renderSelectMembro();
                    renderSelectMembroModal();
                }
            })
            .catch(function (e) { console.error('equipe', e); });
    }

    function renderSelectMembro() {
        var html = '<option value="">Todos / Sem filtro</option>';
        for (var i = 0; i < Estado.equipe.length; i++) {
            var m = Estado.equipe[i];
            var sel = (String(m.id) === String(Estado.membroId)) ? ' selected' : '';
            html += '<option value="' + m.id + '"' + sel + '>' + escHtml(m.nome) + '</option>';
        }
        DOM.selMembro.innerHTML = html;
    }

    function renderSelectMembroModal() {
        var html = '<option value="">Selecione o responsável...</option>';
        for (var i = 0; i < Estado.equipe.length; i++) {
            var m = Estado.equipe[i];
            var sel = (String(m.id) === String(Estado.membroId)) ? ' selected' : '';
            html += '<option value="' + m.id + '"' + sel + '>' + escHtml(m.nome) +
                    ' (' + escHtml(m.funcao) + ')</option>';
        }
        DOM.accSelMembro.innerHTML = html;
    }

    // =========================================================
    // FILA / POLLING
    // =========================================================
    function cicloAtualizar() {
        carregarFila();
        carregarHistorico();
    }

    function carregarFila() {
        fetch(CONFIG.apiBase + '/fila', { credentials: 'same-origin' })
            .then(function (r) { return r.json(); })
            .then(function (data) {
                if (!data.success) return;

                // Detectar novas urgentes para som de alerta
                var novosIds    = [];
                var urgentesIds = [];
                for (var i = 0; i < data.fila.length; i++) {
                    novosIds.push(data.fila[i].id);
                    if (data.fila[i].prioridade === 'urgente') urgentesIds.push(data.fila[i].id);
                }

                if (Estado.idsAnteriores.length > 0) {
                    for (var j = 0; j < urgentesIds.length; j++) {
                        if (Estado.idsUrgentesAnteriores.indexOf(urgentesIds[j]) === -1) {
                            tocarAlerta();
                            break;
                        }
                    }
                }

                Estado.idsAnteriores          = novosIds;
                Estado.idsUrgentesAnteriores  = urgentesIds;
                Estado.fila                   = data.fila;
                Estado.contadores             = data.contadores;

                renderKanban();
                renderContadores();
                atualizarTimestamp();
            })
            .catch(function (e) { console.error('fila', e); });
    }

    function tocarAlerta() {
        try { DOM.audioAlerta.play(); } catch (e) { /* autoplay bloqueado */ }
    }

    // =========================================================
    // RENDER KANBAN
    // =========================================================
    var COLS = ['aguardando', 'aceito', 'em_preparo', 'pronto', 'em_entrega'];

    function renderKanban() {
        var grupos = { aguardando: [], aceito: [], em_preparo: [], pronto: [], em_entrega: [] };
        for (var i = 0; i < Estado.fila.length; i++) {
            var s = Estado.fila[i];
            if (grupos[s.status]) grupos[s.status].push(s);
        }

        for (var c = 0; c < COLS.length; c++) {
            var col    = COLS[c];
            var colEl  = document.getElementById('col-' + col);
            var lista  = grupos[col];
            var badge  = document.getElementById('badge-' + col);

            if (badge) badge.textContent = lista.length;

            if (!lista.length) {
                colEl.innerHTML = '<div class="col-empty">Nenhuma solicitação</div>';
                continue;
            }

            var html = '';
            for (var k = 0; k < lista.length; k++) {
                html += renderCard(lista[k]);
            }
            colEl.innerHTML = html;
        }

        bindCardBtns();
    }

    function renderCard(s) {
        var urgente   = s.prioridade === 'urgente';
        var minWarn   = s.minutos_espera > 30 ? ' card-alerta' : '';
        var restricoes = s.restricoes
            ? '<div class="card-restricoes"><i class="fa-solid fa-triangle-exclamation"></i> ' +
              escHtml(s.restricoes) + '</div>'
            : '';

        var acoes = '';
        if (s.status === 'aguardando') {
            acoes = '<button class="btn-card btn-aceitar" data-id="' + s.id + '" data-desc="' +
                    escHtml(s.nm_paciente) + '">' +
                    '<i class="fa-solid fa-check"></i> Aceitar</button>' +
                    '<button class="btn-card btn-cancelar" data-id="' + s.id + '" data-desc="' +
                    escHtml(s.nm_paciente) + '">' +
                    '<i class="fa-solid fa-xmark"></i></button>';
        } else if (s.status === 'aceito') {
            acoes = '<button class="btn-card btn-preparo" data-id="' + s.id + '">' +
                    '<i class="fa-solid fa-fire-burner"></i> Preparar</button>' +
                    '<button class="btn-card btn-cancelar" data-id="' + s.id + '" data-desc="' +
                    escHtml(s.nm_paciente) + '">' +
                    '<i class="fa-solid fa-xmark"></i></button>';
        } else if (s.status === 'em_preparo') {
            acoes = '<button class="btn-card btn-pronto" data-id="' + s.id + '">' +
                    '<i class="fa-solid fa-bell-concierge"></i> Pronto</button>' +
                    '<button class="btn-card btn-cancelar" data-id="' + s.id + '" data-desc="' +
                    escHtml(s.nm_paciente) + '">' +
                    '<i class="fa-solid fa-xmark"></i></button>';
        } else if (s.status === 'pronto') {
            acoes = '<button class="btn-card btn-entrega" data-id="' + s.id + '">' +
                    '<i class="fa-solid fa-person-walking"></i> Entregar</button>' +
                    '<button class="btn-card btn-cancelar" data-id="' + s.id + '" data-desc="' +
                    escHtml(s.nm_paciente) + '">' +
                    '<i class="fa-solid fa-xmark"></i></button>';
        } else if (s.status === 'em_entrega') {
            acoes = '<button class="btn-card btn-confirmar-entrega" data-id="' + s.id +
                    '" data-codigo="' + escHtml(s.nr_atendimento) + '" data-desc="' +
                    escHtml(s.nm_paciente) + '">' +
                    '<i class="fa-solid fa-box-open"></i> Confirmar Entrega</button>' +
                    '<button class="btn-card btn-cancelar" data-id="' + s.id + '" data-desc="' +
                    escHtml(s.nm_paciente) + '">' +
                    '<i class="fa-solid fa-xmark"></i></button>';
        }

        return '<div class="card' + (urgente ? ' card-urgente' : '') + minWarn + '">' +
            '<div class="card-topo">' +
                (urgente ? '<span class="tag-urgente"><i class="fa-solid fa-bolt"></i> URGENTE</span>' : '') +
                '<span class="card-codigo">' + escHtml(s.codigo_entrega) + '</span>' +
                '<button class="btn-reimprimir" data-id="' + s.id + '" title="Reimprimir etiqueta">' +
                    '<i class="fa-solid fa-print"></i>' +
                '</button>' +
            '</div>' +
            '<div class="card-paciente">' + escHtml(s.nm_paciente) + '</div>' +
            '<div class="card-info">' +
                '<span><i class="fa-solid fa-bed"></i> ' + escHtml(s.leito || '--') + '</span>' +
                '<span><i class="fa-solid fa-hospital"></i> ' + escHtml(s.setor_nome || '--') + '</span>' +
            '</div>' +
            '<div class="card-dieta">' +
                '<i class="fa-solid fa-bowl-food"></i> ' + escHtml(s.tipo_dieta_nome || '--') +
                ' &middot; ' + escHtml(s.refeicao_nome || '--') +
                ' &middot; Qtd: ' + escHtml(String(s.quantidade || 1)) +
            '</div>' +
            restricoes +
            (s.observacao ? '<div class="card-obs"><i class="fa-solid fa-note-sticky"></i> ' + escHtml(s.observacao) + '</div>' : '') +
            '<div class="card-footer">' +
                '<span class="card-tempo"><i class="fa-regular fa-clock"></i> ' +
                    escHtml(s.criado_em || '--') +
                    (s.minutos_espera > 0 ? ' (' + fmtMin(s.minutos_espera) + ')' : '') +
                '</span>' +
                (s.responsavel_nome ? '<span class="card-resp"><i class="fa-solid fa-user"></i> ' + escHtml(s.responsavel_nome) + '</span>' : '') +
            '</div>' +
            '<div class="card-acoes">' + acoes + '</div>' +
        '</div>';
    }

    function bindCardBtns() {
        bindBtn('.btn-aceitar', function (el) {
            abrirModalAceitar(el.getAttribute('data-id'), el.getAttribute('data-desc'));
        });
        bindBtn('.btn-preparo', function (el) {
            executarAcao(el.getAttribute('data-id'), 'iniciar-preparo');
        });
        bindBtn('.btn-pronto', function (el) {
            executarAcao(el.getAttribute('data-id'), 'pronto');
        });
        bindBtn('.btn-entrega', function (el) {
            executarAcao(el.getAttribute('data-id'), 'iniciar-entrega');
        });
        bindBtn('.btn-confirmar-entrega', function (el) {
            abrirModalEntregar(
                el.getAttribute('data-id'),
                el.getAttribute('data-codigo'),
                el.getAttribute('data-desc')
            );
        });
        bindBtn('.btn-reimprimir', function (el) {
            var sid = el.getAttribute('data-id');
            for (var i = 0; i < Estado.fila.length; i++) {
                if (String(Estado.fila[i].id) === String(sid)) {
                    imprimirEtiqueta(Estado.fila[i]);
                    break;
                }
            }
        });
        bindBtn('.btn-cancelar', function (el) {
            abrirModalCancelar(el.getAttribute('data-id'), el.getAttribute('data-desc'));
        });
    }

    function bindBtn(selector, handler) {
        var btns = document.querySelectorAll(selector);
        for (var i = 0; i < btns.length; i++) {
            (function (btn) {
                btn.addEventListener('click', function () { handler(btn); });
            })(btns[i]);
        }
    }

    // =========================================================
    // CONTADORES NO HEADER
    // =========================================================
    function renderContadores() {
        var cols = ['aguardando', 'aceito', 'em_preparo', 'pronto', 'em_entrega'];
        for (var i = 0; i < cols.length; i++) {
            var c   = cols[i];
            var el  = document.getElementById('cnt-' + c);
            if (!el) continue;
            var num = el.querySelector('.cnt-num');
            if (num) num.textContent = Estado.contadores[c] || 0;
        }
    }

    // =========================================================
    // AÇÕES DIRETAS (sem modal)
    // =========================================================
    function executarAcao(sid, acao) {
        if (Estado.processando) return;
        Estado.processando = true;

        var entregue_por = Estado.membroId
            ? (function () {
                for (var i = 0; i < Estado.equipe.length; i++) {
                    if (String(Estado.equipe[i].id) === String(Estado.membroId))
                        return Estado.equipe[i].nome;
                }
                return null;
              })()
            : null;

        var body = {};
        if (acao === 'iniciar-entrega' && entregue_por) body.entregue_por = entregue_por;

        fetch(CONFIG.apiBase + '/solicitacoes/' + sid + '/' + acao, {
            method: 'PUT',
            credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        })
            .then(function (r) { return r.json(); })
            .then(function (data) {
                Estado.processando = false;
                if (data.success) {
                    carregarFila();
                } else {
                    alert(data.error || 'Erro ao processar ação.');
                }
            })
            .catch(function (e) {
                Estado.processando = false;
                console.error(acao, e);
            });
    }

    // =========================================================
    // MODAL: ACEITAR
    // =========================================================
    function abrirModalAceitar(sid, desc) {
        DOM.accSid.value  = sid;
        DOM.accDesc.textContent = desc || '';
        DOM.accErro.style.display = 'none';
        // Pré-selecionar membro do header no modal
        if (Estado.membroId) DOM.accSelMembro.value = Estado.membroId;
        DOM.modalAceitar.style.display = 'flex';
    }

    function confirmarAceitar() {
        var sid          = DOM.accSid.value;
        var responsavelId = DOM.accSelMembro.value;
        if (!responsavelId) {
            DOM.accErro.textContent = 'Selecione o responsável.';
            DOM.accErro.style.display = 'block';
            return;
        }
        DOM.btnAccConfirmar.disabled = true;

        fetch(CONFIG.apiBase + '/solicitacoes/' + sid + '/aceitar', {
            method: 'PUT',
            credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ responsavel_id: parseInt(responsavelId, 10) })
        })
            .then(function (r) { return r.json(); })
            .then(function (data) {
                DOM.btnAccConfirmar.disabled = false;
                if (data.success) {
                    // captura dados antes de recarregar fila
                    var sol = null;
                    for (var i = 0; i < Estado.fila.length; i++) {
                        if (String(Estado.fila[i].id) === String(sid)) { sol = Estado.fila[i]; break; }
                    }
                    fecharModal(DOM.modalAceitar);
                    carregarFila();
                    if (DOM.chkImprimirAceitar && DOM.chkImprimirAceitar.checked && sol) {
                        imprimirEtiqueta(sol);
                    }
                } else {
                    DOM.accErro.textContent = data.error || 'Erro.';
                    DOM.accErro.style.display = 'block';
                }
            })
            .catch(function () {
                DOM.btnAccConfirmar.disabled = false;
                DOM.accErro.textContent = 'Falha na conexão.';
                DOM.accErro.style.display = 'block';
            });
    }

    // =========================================================
    // MODAL: CONFIRMAR ENTREGA
    // =========================================================
    function abrirModalEntregar(sid, codigo, desc) {
        DOM.entrSid.value               = sid;
        DOM.entrSid.setAttribute('data-codigo', codigo);
        DOM.entrDesc.textContent        = desc || '';
        DOM.inpCodigoConfirm.value      = '';
        DOM.codigoFeedback.textContent  = '';
        DOM.codigoFeedback.className    = 'codigo-feedback';
        DOM.entrObs.value               = '';
        DOM.entrErro.style.display      = 'none';
        DOM.btnEntrConfirmar.disabled   = true;
        DOM.modalEntregar.style.display = 'flex';
        setTimeout(function () { DOM.inpCodigoConfirm.focus(); }, 100);
    }

    function validarCodigoInput() {
        var digitado  = DOM.inpCodigoConfirm.value.trim();
        var esperado  = (DOM.entrSid.getAttribute('data-codigo') || '').trim();

        if (!digitado) {
            DOM.codigoFeedback.textContent  = '';
            DOM.codigoFeedback.className    = 'codigo-feedback';
            DOM.btnEntrConfirmar.disabled   = true;
            return;
        }

        if (digitado === esperado) {
            DOM.codigoFeedback.textContent  = '✓ Nº de atendimento correto';
            DOM.codigoFeedback.className    = 'codigo-feedback codigo-ok';
            DOM.btnEntrConfirmar.disabled   = false;
        } else {
            DOM.codigoFeedback.textContent  = '✗ Nº de atendimento incorreto';
            DOM.codigoFeedback.className    = 'codigo-feedback codigo-erro';
            DOM.btnEntrConfirmar.disabled   = true;
        }
    }

    function confirmarEntrega() {
        var sid     = DOM.entrSid.value;
        var codigo  = DOM.inpCodigoConfirm.value.trim();
        var obs     = DOM.entrObs.value.trim();

        DOM.btnEntrConfirmar.disabled = true;
        DOM.entrErro.style.display    = 'none';

        fetch(CONFIG.apiBase + '/solicitacoes/' + sid + '/entregar', {
            method: 'PUT',
            credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ nr_atendimento_confirmacao: codigo, observacao_entrega: obs })
        })
            .then(function (r) { return r.json(); })
            .then(function (data) {
                DOM.btnEntrConfirmar.disabled = false;
                if (data.success) {
                    fecharModal(DOM.modalEntregar);
                    carregarFila();
                    carregarHistorico();
                } else {
                    DOM.entrErro.textContent = data.error || 'Erro ao confirmar entrega.';
                    DOM.entrErro.style.display = 'block';
                }
            })
            .catch(function () {
                DOM.btnEntrConfirmar.disabled = false;
                DOM.entrErro.textContent = 'Falha na conexão.';
                DOM.entrErro.style.display = 'block';
            });
    }

    // =========================================================
    // MODAL: CANCELAR
    // =========================================================
    function abrirModalCancelar(sid, desc) {
        DOM.cancSid.value               = sid;
        DOM.cancDesc.textContent        = desc || '';
        DOM.cancMotivo.value            = '';
        DOM.cancErro.style.display      = 'none';
        DOM.modalCancelar.style.display = 'flex';
    }

    function confirmarCancelar() {
        var sid    = DOM.cancSid.value;
        var motivo = DOM.cancMotivo.value.trim();
        if (motivo.length < 10) {
            DOM.cancErro.textContent = 'Motivo deve ter pelo menos 10 caracteres.';
            DOM.cancErro.style.display = 'block';
            return;
        }
        DOM.btnCancConfirmar.disabled = true;

        fetch(CONFIG.apiBase + '/solicitacoes/' + sid + '/cancelar', {
            method: 'PUT',
            credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ motivo: motivo })
        })
            .then(function (r) { return r.json(); })
            .then(function (data) {
                DOM.btnCancConfirmar.disabled = false;
                if (data.success) {
                    fecharModal(DOM.modalCancelar);
                    carregarFila();
                    carregarHistorico();
                } else {
                    DOM.cancErro.textContent = data.error || 'Erro.';
                    DOM.cancErro.style.display = 'block';
                }
            })
            .catch(function () {
                DOM.btnCancConfirmar.disabled = false;
                DOM.cancErro.textContent = 'Falha na conexão.';
                DOM.cancErro.style.display = 'block';
            });
    }

    // =========================================================
    // HISTÓRICO
    // =========================================================
    function carregarHistorico() {
        var url = CONFIG.apiBase + '/historico-hoje';
        if (Estado.membroId) url += '?responsavel_id=' + Estado.membroId;

        fetch(url, { credentials: 'same-origin' })
            .then(function (r) { return r.json(); })
            .then(function (data) {
                if (data.success) {
                    Estado.historico = data.historico || [];
                    renderHistorico();
                }
            })
            .catch(function (e) { console.error('historico', e); });
    }

    function _popularFiltroSetor42() {
        if (!DOM.filtroSetor42) return;
        var atual = DOM.filtroSetor42.value;
        var setores = {};
        for (var i = 0; i < Estado.historico.length; i++) {
            var s = Estado.historico[i].setor_nome;
            if (s) setores[s] = true;
        }
        var html = '<option value="">Todos</option>';
        var chaves = Object.keys(setores).sort();
        for (var j = 0; j < chaves.length; j++) {
            html += '<option value="' + escHtml(chaves[j]) + '"' +
                (chaves[j] === atual ? ' selected' : '') + '>' + escHtml(chaves[j]) + '</option>';
        }
        DOM.filtroSetor42.innerHTML = html;
    }

    function renderHistorico() {
        var setorFiltro = DOM.filtroSetor42 ? DOM.filtroSetor42.value : '';
        var lista = Estado.historico.filter(function (h) {
            return !setorFiltro || h.setor_nome === setorFiltro;
        });

        _popularFiltroSetor42();
        DOM.badgeHistorico.textContent = Estado.historico.length;

        if (!lista.length) {
            DOM.tbodyHistorico.innerHTML = Estado.historico.length
                ? '<tr><td colspan="11" style="text-align:center;color:#aaa;padding:16px;">Nenhum resultado para este setor.</td></tr>'
                : '';
            DOM.histEmpty.style.display = Estado.historico.length ? 'none' : 'block';
            return;
        }
        DOM.histEmpty.style.display = 'none';

        var html = '';
        for (var i = 0; i < lista.length; i++) {
            var h = lista[i];
            html += '<tr>' +
                '<td><span class="codigo-hist">' + escHtml(h.codigo_entrega) + '</span></td>' +
                '<td>' + escHtml(h.nm_paciente) + '</td>' +
                '<td>' + escHtml(h.leito || '--') + '</td>' +
                '<td>' + escHtml(h.tipo_dieta_nome || '--') + '</td>' +
                '<td>' + escHtml(h.refeicao_nome || '--') + '</td>' +
                '<td>' + escHtml(h.responsavel_nome || '--') + '</td>' +
                '<td>' + badgeStatus(h.status) + '</td>' +
                '<td>' + escHtml(h.criado_em || '--') + '</td>' +
                '<td>' + escHtml(h.dt_entrega || h.dt_cancelamento || '--') + '</td>' +
                '<td>' + (h.t_total_min != null ? fmtMin(h.t_total_min) : '--') + '</td>' +
                '<td class="td-motivo-cancel">' +
                    (h.motivo_cancelamento ? escHtml(h.motivo_cancelamento) : '--') +
                '</td>' +
            '</tr>';
        }
        DOM.tbodyHistorico.innerHTML = html;
    }

    function toggleHistorico() {
        var visivel = DOM.historicoBody.style.display !== 'none';
        DOM.historicoBody.style.display = visivel ? 'none' : 'block';
        DOM.iconeToggle.className = visivel
            ? 'fa-solid fa-chevron-down'
            : 'fa-solid fa-chevron-up';
    }

    // =========================================================
    // UTILIDADES
    // =========================================================
    function fecharModal(el) {
        el.style.display = 'none';
    }

    function atualizarTimestamp() {
        var agora = new Date();
        var h = agora.getHours();
        var m = agora.getMinutes();
        var s = agora.getSeconds();
        DOM.ultimoUpdate.textContent = 'Atualizado: ' +
            (h < 10 ? '0' : '') + h + ':' +
            (m < 10 ? '0' : '') + m + ':' +
            (s < 10 ? '0' : '') + s;
    }

    // =========================================================
    // IMPRESSÃO DE ETIQUETA
    // =========================================================
    function imprimirEtiqueta(sol) {
        fetch('/api/paineis/painel43/config/etiqueta', { credentials: 'same-origin' })
            .then(function (r) { return r.json(); })
            .then(function (cfg) {
                _imprimirZPL(sol, cfg.zpl_template || '');
            })
            .catch(function () {
                _imprimirZPL(sol, '');
            });
    }

    function _preencherVarsZPL(template, sol) {
        return template
            .replace(/\{\{NR_ATENDIMENTO\}\}/g, sol.nr_atendimento    || '')
            .replace(/\{\{PACIENTE\}\}/g,       sol.nm_paciente        || '')
            .replace(/\{\{LEITO\}\}/g,          sol.leito              || '')
            .replace(/\{\{SETOR\}\}/g,          sol.setor_nome         || '')
            .replace(/\{\{DIETA\}\}/g,          sol.tipo_dieta_nome    || '')
            .replace(/\{\{REFEICAO\}\}/g,       sol.refeicao_nome      || '')
            .replace(/\{\{RESTRICOES\}\}/g,     sol.restricoes         || '')
            .replace(/\{\{OBS\}\}/g,            sol.observacao         || '')
            .replace(/\{\{CODIGO\}\}/g,         sol.codigo_entrega     || '');
    }

    function _imprimirZPL(sol, template) {
        if (!template) {
            alert('Configure o template ZPL no Painel 43 → Configurações → Etiqueta.');
            return;
        }
        var zpl = _preencherVarsZPL(template, sol);
        fetch('/api/paineis/painel42/imprimir-zpl', {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ zpl: zpl })
        })
        .then(function (r) { return r.json(); })
        .then(function (data) {
            if (!data.success) {
                console.error('Erro impressao ZPL: ' + (data.error || ''));
                _downloadZPL(zpl, sol.nr_atendimento);
            }
        })
        .catch(function (e) {
            console.error('Falha ao comunicar com servidor de impressao', e);
            _downloadZPL(zpl, sol.nr_atendimento);
        });
    }

    function _downloadZPL(zpl, nr) {
        var blob = new Blob([zpl], { type: 'text/plain;charset=utf-8' });
        var url  = URL.createObjectURL(blob);
        var a    = document.createElement('a');
        a.href     = url;
        a.download = 'etiqueta_' + (nr || 'dieta') + '.zpl';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    }

    function _preencherVarsPDF(template, sol) {
        var agora = new Date();
        var nr    = sol.nr_atendimento || '';
        return template
            .replace(/\{\{NR_ATENDIMENTO\}\}/g, nr)
            .replace(/\{\{PACIENTE\}\}/g,       sol.nm_paciente     || '')
            .replace(/\{\{LEITO\}\}/g,          sol.leito           || '')
            .replace(/\{\{SETOR\}\}/g,          sol.setor_nome      || '')
            .replace(/\{\{DIETA\}\}/g,          sol.tipo_dieta_nome || '')
            .replace(/\{\{REFEICAO\}\}/g,       sol.refeicao_nome   || '')
            .replace(/\{\{RESTRICOES\}\}/g,     sol.restricoes      || '')
            .replace(/\{\{OBS\}\}/g,            sol.observacao      || '')
            .replace(/\{\{CODIGO\}\}/g,         sol.codigo_entrega  || '')
            .replace(/\{\{DATA\}\}/g,           agora.toLocaleDateString('pt-BR'))
            .replace(/\{\{HORA\}\}/g,           agora.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }));
    }

    function _imprimirPDF(sol, pdfTemplate) {
        var html = pdfTemplate
            ? _preencherVarsPDF(pdfTemplate, sol)
            : _gerarHTMLEtiqueta(sol);
        var w = window.open('', '_blank', 'width=300,height=480,toolbar=0,menubar=0,location=0,scrollbars=0');
        if (!w) { alert('Permita pop-ups para imprimir a etiqueta.'); return; }
        w.document.open();
        w.document.write(html);
        w.document.close();
        w.focus();
        setTimeout(function () { w.print(); }, 700);
    }

    function _gerarHTMLEtiqueta(sol) {
        var nr    = sol.nr_atendimento  || '';
        var pac   = sol.nm_paciente     || '';
        var leito = sol.leito           || '';
        var setor = sol.setor_nome      || '';
        var dieta = sol.tipo_dieta_nome || '';
        var ref   = sol.refeicao_nome   || '';
        var rest  = sol.restricoes      || '';
        var obs   = sol.observacao      || '';
        var cod   = sol.codigo_entrega  || '';
        var agora = new Date();
        var data  = agora.toLocaleDateString('pt-BR');
        var hora  = agora.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

        return '<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8">' +
            '<title>Etiqueta Dieta</title>' +
            '<script src="https://cdn.jsdelivr.net/npm/jsbarcode@3.11.6/dist/JsBarcode.all.min.js"><\/script>' +
            '<style>' +
                '@page{size:7cm 10cm;margin:3mm}' +
                'body{font-family:Arial,sans-serif;font-size:10px;margin:0;padding:0;}' +
                'svg{max-width:100%;height:45px;display:block;margin:0 auto;}' +
                '@media print{body{print-color-adjust:exact;-webkit-print-color-adjust:exact}}' +
            '</style>' +
            '</head><body>' +
            '<div style="padding: 2mm">' +
                '<div style="font-size: 12px; font-weight: bold; text-align: center; border-bottom: 1px solid #000; padding-bottom: 2mm; margin-bottom: 2mm">Hospital Anchieta Ceilândia</div>' +
                '<div style="font-weight: bold; font-size: 11px; margin-bottom: 2px; word-break: break-word;"><span style="font-weight: normal">Paciente: </span>' + pac + '</div>' +
                '<div style="display: flex; justify-content: space-between; font-size: 8px; color: #555; margin-bottom: 5px;">' +
                    '<span>Cód: ' + cod + '</span>' +
                    '<span>' + data + ' ' + hora + '</span>' +
                '</div>' +
                '<div style="margin-bottom: 5px"><span style="font-weight: bold">Leito:</span> ' + leito + ' &nbsp; <span style="font-weight: bold">Setor:</span> ' + setor + '</div>' +
                '<div style="margin-bottom: 5px"><span style="font-weight: bold">Dieta:</span> ' + dieta + ' &mdash; ' + ref + '</div>' +
                (rest ? '<div style="margin-bottom: 5px"><span style="font-weight: bold">Restrições:</span> ' + rest + '</div>' : '') +
                (obs  ? '<div style="margin-bottom: 5px; min-height: 8mm; line-height: 1.6;"><span style="font-weight: bold">Obs:</span> ' + obs + '</div>' : '') +
                '<div style="text-align: center; margin: 1mm 0"><svg id="bc"></svg></div>' +
                '<div style="text-align: center; font-size: 8px; font-weight: bold; font-family: monospace;">' + nr + '</div>' +
            '</div>' +
            '<script>' +
                'window.onload=function(){' +
                    'if(typeof JsBarcode!=="undefined"){' +
                        'JsBarcode("#bc","' + nr.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '",' +
                        '{format:"CODE128",width:1.8,height:45,displayValue:false,margin:0});' +
                    '}' +
                '};' +
            '<\/script>' +
            '</body></html>';
    }

    // =========================================================
    // START
    // =========================================================
    window.addEventListener('DOMContentLoaded', inicializar);

})();
