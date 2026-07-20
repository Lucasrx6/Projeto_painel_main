var PAINEL_VERSAO = '1.0.52';
(function () {
    'use strict';

    var CONFIG = {
        apiBase: '/api/paineis/painel42',
        refreshInterval: 15000
    };

    var Estado = {
        fila: [],
        equipe: [],
        historico: [],
        tiposDieta: [],
        refeicoes: [],
        contadores: { aguardando: 0, aceito: 0, em_preparo: 0, pronto: 0, em_entrega: 0 },
        visualizacao: 'geral',
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

        DOM.selVisualizacao   = document.getElementById('sel-visualizacao');
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

        // Modal editar
        DOM.modalEditar       = document.getElementById('modal-editar');
        DOM.editSid           = document.getElementById('edit-sid');
        DOM.editDesc          = document.getElementById('edit-desc');
        DOM.editTipoDieta     = document.getElementById('edit-tipo-dieta');
        DOM.editRefeicao      = document.getElementById('edit-refeicao');
        DOM.editObs           = document.getElementById('edit-obs');
        DOM.editErro          = document.getElementById('edit-erro');
        DOM.btnEditConfirmar  = document.getElementById('btn-edit-confirmar');
        DOM.btnEditFechar     = document.getElementById('btn-edit-fechar');

        // Modal voltar status
        DOM.modalVoltar       = document.getElementById('modal-voltar');
        DOM.voltSid           = document.getElementById('volt-sid');
        DOM.voltDesc          = document.getElementById('volt-desc');
        DOM.voltInfo          = document.getElementById('volt-info');
        DOM.voltMotivo        = document.getElementById('volt-motivo');
        DOM.voltErro          = document.getElementById('volt-erro');
        DOM.btnVoltConfirmar  = document.getElementById('btn-volt-confirmar');
        DOM.btnVoltFechar     = document.getElementById('btn-volt-fechar');

        // Restaurar visualização salva
        var visSalva = localStorage.getItem('p42_visualizacao') || 'geral';
        Estado.visualizacao = visSalva;
        if (DOM.selVisualizacao) DOM.selVisualizacao.value = visSalva;

        // Restaurar preferência de impressão
        if (DOM.chkImprimirAceitar) {
            DOM.chkImprimirAceitar.checked = (localStorage.getItem('p42_imprimir_aceitar') === '1');
            DOM.chkImprimirAceitar.addEventListener('change', function () {
                localStorage.setItem('p42_imprimir_aceitar', this.checked ? '1' : '0');
            });
        }

        // Eventos
        DOM.selVisualizacao.addEventListener('change', function () {
            Estado.visualizacao = this.value || 'geral';
            localStorage.setItem('p42_visualizacao', Estado.visualizacao);
            renderKanban();
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
        DOM.btnEditFechar.addEventListener('click', function () { fecharModal(DOM.modalEditar); });
        DOM.btnEditConfirmar.addEventListener('click', confirmarEditar);
        DOM.btnVoltFechar.addEventListener('click', function () { fecharModal(DOM.modalVoltar); });
        DOM.btnVoltConfirmar.addEventListener('click', confirmarVoltarStatus);

        DOM.inpCodigoConfirm.addEventListener('input', validarCodigoInput);

        // Fechar modais no overlay
        DOM.modalAceitar.addEventListener('click', function (e) { if (e.target === DOM.modalAceitar) fecharModal(DOM.modalAceitar); });
        DOM.modalEntregar.addEventListener('click', function (e) { if (e.target === DOM.modalEntregar) fecharModal(DOM.modalEntregar); });
        DOM.modalCancelar.addEventListener('click', function (e) { if (e.target === DOM.modalCancelar) fecharModal(DOM.modalCancelar); });
        DOM.modalEditar.addEventListener('click', function (e) { if (e.target === DOM.modalEditar) fecharModal(DOM.modalEditar); });
        DOM.modalVoltar.addEventListener('click', function (e) { if (e.target === DOM.modalVoltar) fecharModal(DOM.modalVoltar); });

        // Modal detalhes histórico
        DOM.modalDetalheHist      = document.getElementById('modal-detalhe-hist');
        DOM.detalheHistCorpo      = document.getElementById('detalhe-hist-corpo');
        DOM.btnDetalheHistFechar  = document.getElementById('btn-detalhe-hist-fechar');
        DOM.btnRelatorioHist      = document.getElementById('btn-relatorio-hist');

        // Modal opções relatório
        DOM.modalRelatorioHist    = document.getElementById('modal-relatorio-hist');
        DOM.chkIncluirCancelados  = document.getElementById('chk-incluir-cancelados');
        DOM.btnRelConfirmar       = document.getElementById('btn-rel-confirmar');
        DOM.btnRelFechar          = document.getElementById('btn-rel-fechar');

        // Modal protocolo
        DOM.btnProtocolo      = document.getElementById('btn-protocolo');
        DOM.modalProtocolo    = document.getElementById('modal-protocolo');
        DOM.protDesc          = document.getElementById('prot-desc');
        DOM.protSetor         = document.getElementById('prot-setor');
        DOM.btnProtConfirmar  = document.getElementById('btn-prot-confirmar');
        DOM.btnProtFechar     = document.getElementById('btn-prot-fechar');

        if (DOM.btnDetalheHistFechar) {
            DOM.btnDetalheHistFechar.addEventListener('click', function () { fecharModal(DOM.modalDetalheHist); });
        }
        if (DOM.modalDetalheHist) {
            DOM.modalDetalheHist.addEventListener('click', function (e) {
                if (e.target === DOM.modalDetalheHist) fecharModal(DOM.modalDetalheHist);
            });
        }
        if (DOM.btnRelatorioHist) {
            DOM.btnRelatorioHist.addEventListener('click', function (e) {
                e.stopPropagation();
                if (DOM.modalRelatorioHist) DOM.modalRelatorioHist.style.display = 'flex';
            });
        }
        if (DOM.btnRelFechar) {
            DOM.btnRelFechar.addEventListener('click', function () { fecharModal(DOM.modalRelatorioHist); });
        }
        if (DOM.btnRelConfirmar) {
            DOM.btnRelConfirmar.addEventListener('click', function () {
                var incluir = DOM.chkIncluirCancelados ? DOM.chkIncluirCancelados.checked : true;
                fecharModal(DOM.modalRelatorioHist);
                gerarRelatorioHistorico(incluir);
            });
        }
        if (DOM.modalRelatorioHist) {
            DOM.modalRelatorioHist.addEventListener('click', function (e) {
                if (e.target === DOM.modalRelatorioHist) fecharModal(DOM.modalRelatorioHist);
            });
        }

        if (DOM.btnProtocolo) {
            DOM.btnProtocolo.addEventListener('click', abrirModalProtocolo);
        }
        DOM.btnProtFechar.addEventListener('click', function () { fecharModal(DOM.modalProtocolo); });
        DOM.btnProtConfirmar.addEventListener('click', function () {
            var setor = DOM.protSetor.value;
            fecharModal(DOM.modalProtocolo);
            gerarProtocolo(setor);
        });
        DOM.modalProtocolo.addEventListener('click', function (e) {
            if (e.target === DOM.modalProtocolo) fecharModal(DOM.modalProtocolo);
        });

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
                    renderSelectMembroModal();
                }
            })
            .catch(function (e) { console.error('equipe', e); });
    }

    function renderSelectMembroModal() {
        var html = '<option value="">Selecione o responsável...</option>';
        for (var i = 0; i < Estado.equipe.length; i++) {
            var m = Estado.equipe[i];
            html += '<option value="' + m.id + '">' + escHtml(m.nome) +
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
                    var _temNovo = false;
                    for (var j = 0; j < novosIds.length; j++) {
                        if (Estado.idsAnteriores.indexOf(novosIds[j]) === -1) {
                            _temNovo = true;
                            break;
                        }
                    }
                    if (_temNovo) {
                        tocarAlerta();
                        piscarTela();
                        alertarTitulo();
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
        try {
            DOM.audioAlerta.currentTime = 0;
            DOM.audioAlerta.play();
        } catch (e) { /* autoplay bloqueado */ }
    }

    function piscarTela() {
        var container = document.querySelector('.painel-container');
        if (!container) return;
        container.classList.remove('notificacao-nova');
        void container.offsetWidth; // força reflow para reiniciar a animação
        container.classList.add('notificacao-nova');
    }

    var _tituloOriginal = document.title;
    var _tituloTimer = null;

    function alertarTitulo() {
        if (_tituloTimer) clearTimeout(_tituloTimer);
        document.title = '● NOVA SOLICITAÇÃO — Tela Nutrição';
        _tituloTimer = setTimeout(function () {
            document.title = _tituloOriginal;
            _tituloTimer = null;
        }, 15000);
    }

    document.addEventListener('visibilitychange', function () {
        if (!document.hidden && _tituloTimer) {
            clearTimeout(_tituloTimer);
            _tituloTimer = null;
            document.title = _tituloOriginal;
        }
    });

    // =========================================================
    // RENDER KANBAN
    // =========================================================
    var COLS = ['aguardando', 'aceito', 'em_preparo', 'pronto', 'em_entrega'];

    function renderKanban() {
        // Visibilidade por tipo de visualização
        var vis = Estado.visualizacao || 'geral';
        var colsVisiveis;
        if (vis === 'nutricionista') {
            colsVisiveis = ['aguardando', 'aceito'];
        } else if (vis === 'cozinha') {
            colsVisiveis = ['em_preparo', 'pronto', 'em_entrega'];
        } else if (vis === 'entrega_refeicao') {
            colsVisiveis = ['em_entrega'];
        } else {
            colsVisiveis = COLS;
        }
        var board = document.getElementById('kanban-board');
        if (board) board.style.gridTemplateColumns = 'repeat(' + colsVisiveis.length + ', 1fr)';
        for (var cv = 0; cv < COLS.length; cv++) {
            var colVis = document.getElementById('kanban-col-' + COLS[cv]);
            if (colVis) colVis.style.display = (colsVisiveis.indexOf(COLS[cv]) !== -1) ? '' : 'none';
        }

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
            acoes = '<button class="btn-card btn-assinar-digital" data-id="' + s.id +
                    '" data-nm="' + escHtml(s.nm_paciente) +
                    '" data-nr="' + escHtml(s.nr_atendimento || '') +
                    '" data-refeicao="' + escHtml(s.refeicao_nome || '') +
                    '" data-dieta="' + escHtml(s.tipo_dieta_nome || '') + '">' +
                    '<i class="fa-solid fa-signature"></i> Assinar Digital</button>' +
                    '<button class="btn-card btn-confirmar-entrega" data-id="' + s.id +
                    '" data-codigo="' + escHtml(s.nr_atendimento) + '" data-desc="' +
                    escHtml(s.nm_paciente) + '">' +
                    '<i class="fa-solid fa-box-open"></i> Confirmar</button>' +
                    '<button class="btn-card btn-cancelar" data-id="' + s.id + '" data-desc="' +
                    escHtml(s.nm_paciente) + '">' +
                    '<i class="fa-solid fa-xmark"></i></button>';
        }

        var podeEditar = s.status !== 'em_entrega' && s.status !== 'entregue' && s.status !== 'cancelado';
        var podeVoltar = s.status === 'aceito' || s.status === 'em_preparo' ||
                         s.status === 'pronto'  || s.status === 'em_entrega';
        var extras = '';
        if (podeEditar || podeVoltar) {
            extras = '<div class="card-extras">';
            if (podeEditar) {
                extras += '<button class="btn-extra btn-editar" data-id="' + s.id +
                    '" data-tipo-id="' + (s.tipo_dieta_id || '') +
                    '" data-ref-id="' + (s.refeicao_id || '') +
                    '" data-obs="' + escHtml(s.observacao || '') +
                    '" data-desc="' + escHtml(s.nm_paciente) + '">' +
                    '<i class="fa-solid fa-pen"></i> Editar</button>';
            }
            if (podeVoltar) {
                extras += '<button class="btn-extra btn-voltar-status" data-id="' + s.id +
                    '" data-status="' + s.status +
                    '" data-desc="' + escHtml(s.nm_paciente) + '">' +
                    '<i class="fa-solid fa-rotate-left"></i> Voltar</button>';
            }
            extras += '</div>';
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
            '<div class="card-nr-atend"><i class="fa-solid fa-id-card"></i> ' + escHtml(s.nr_atendimento || '--') + '</div>' +
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
            extras +
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
        bindBtn('.btn-assinar-digital', function (el) {
            abrirAssinaturaDigital(
                el.getAttribute('data-id'),
                el.getAttribute('data-nm'),
                el.getAttribute('data-nr'),
                el.getAttribute('data-refeicao'),
                el.getAttribute('data-dieta')
            );
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
        bindBtn('.btn-editar', function (el) {
            abrirModalEditar(
                el.getAttribute('data-id'),
                el.getAttribute('data-tipo-id'),
                el.getAttribute('data-ref-id'),
                el.getAttribute('data-obs'),
                el.getAttribute('data-desc')
            );
        });
        bindBtn('.btn-voltar-status', function (el) {
            abrirModalVoltarStatus(
                el.getAttribute('data-id'),
                el.getAttribute('data-status'),
                el.getAttribute('data-desc')
            );
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

        var body = {};

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
                ? '<tr><td colspan="12" style="text-align:center;color:#aaa;padding:16px;">Nenhum resultado para este setor.</td></tr>'
                : '';
            DOM.histEmpty.style.display = Estado.historico.length ? 'none' : 'block';
            return;
        }
        DOM.histEmpty.style.display = 'none';

        var html = '';
        for (var i = 0; i < lista.length; i++) {
            var h = lista[i];
            html += '<tr>' +
                '<td class="td-dia">' + escHtml(h.data_pedido || '--') + '</td>' +
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
                '<td class="td-acoes-hist">' +
                    '<button class="btn-ver-hist" data-id="' + h.id + '" title="Ver detalhes">' +
                        '<i class="fa-solid fa-eye"></i>' +
                    '</button>' +
                '</td>' +
            '</tr>';
        }
        DOM.tbodyHistorico.innerHTML = html;
        bindHistBtns();
    }

    function toggleHistorico() {
        var visivel = DOM.historicoBody.style.display !== 'none';
        DOM.historicoBody.style.display = visivel ? 'none' : 'block';
        DOM.iconeToggle.className = visivel
            ? 'fa-solid fa-chevron-down'
            : 'fa-solid fa-chevron-up';
    }

    function bindHistBtns() {
        var btns = DOM.tbodyHistorico.querySelectorAll('.btn-ver-hist');
        for (var i = 0; i < btns.length; i++) {
            btns[i].addEventListener('click', function () {
                abrirDetalhesHistorico(this.getAttribute('data-id'));
            });
        }
    }

    function _detalheItem(label, valorHtml, fullSpan) {
        return '<div class="detalhe-item' + (fullSpan ? ' span-full' : '') + '">' +
            '<span class="detalhe-label">' + escHtml(label) + '</span>' +
            '<span class="detalhe-valor">' + valorHtml + '</span>' +
        '</div>';
    }

    function abrirDetalhesHistorico(id) {
        var h = null;
        for (var i = 0; i < Estado.historico.length; i++) {
            if (String(Estado.historico[i].id) === String(id)) {
                h = Estado.historico[i];
                break;
            }
        }
        if (!h || !DOM.modalDetalheHist) return;

        DOM.detalheHistCorpo.innerHTML =
            '<div class="detalhe-hist-grid">' +
                _detalheItem('Código de Entrega', escHtml(h.codigo_entrega || '—')) +
                _detalheItem('Nº Atendimento',    escHtml(h.nr_atendimento || '—')) +
                _detalheItem('Paciente',           escHtml(h.nm_paciente   || '—')) +
                _detalheItem('Status',             badgeStatus(h.status)) +
                _detalheItem('Leito',   escHtml(h.leito      || '—')) +
                _detalheItem('Setor',   escHtml(h.setor_nome || '—')) +
                _detalheItem('Dieta',   escHtml(h.tipo_dieta_nome || '—')) +
                _detalheItem('Refeição', escHtml(h.refeicao_nome || '—')) +
                '<hr class="detalhe-separador">' +
                _detalheItem('Restrições', escHtml(h.restricoes || '—'), true) +
                _detalheItem('Observação', escHtml(h.observacao || '—'), true) +
                (h.motivo_cancelamento ? _detalheItem('Motivo Cancelamento', escHtml(h.motivo_cancelamento), true) : '') +
                '<hr class="detalhe-separador">' +
                _detalheItem('Responsável pelo preparo', escHtml(h.responsavel_nome || '—')) +
                _detalheItem('Entregue por',             escHtml(h.entregue_por     || '—')) +
                _detalheItem('Solicitado em', escHtml((h.data_pedido || '') + ' ' + (h.criado_em || ''))) +
                _detalheItem('Finalizado em', escHtml(h.dt_entrega || h.dt_cancelamento || '—')) +
                _detalheItem('Tempo total', h.t_total_min != null ? escHtml(fmtMin(h.t_total_min)) : '—') +
                _detalheItem('Prioridade', escHtml(h.prioridade === 'urgente' ? 'URGENTE' : 'Normal')) +
            '</div>';

        DOM.modalDetalheHist.style.display = 'flex';
    }

    function gerarRelatorioHistorico(incluirCancelados) {
        var setorFiltro = DOM.filtroSetor42 ? DOM.filtroSetor42.value : '';
        var lista = [];
        for (var i = 0; i < Estado.historico.length; i++) {
            var h = Estado.historico[i];
            if (setorFiltro && h.setor_nome !== setorFiltro) continue;
            if (!incluirCancelados && h.status === 'cancelado') continue;
            lista.push(h);
        }

        if (!lista.length) {
            alert('Sem registros no histórico para gerar o relatório.');
            return;
        }

        var agora  = new Date();
        var data   = agora.toLocaleDateString('pt-BR');
        var hora   = agora.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
        var titulo = setorFiltro ? escHtml(setorFiltro) : 'Todos os setores';

        var linhas = '';
        for (var j = 0; j < lista.length; j++) {
            var s = lista[j];
            var statusCfg = STATUS_CFG[s.status] || { label: s.status, cor: '#6C757D' };
            linhas +=
                '<tr>' +
                '<td>' + escHtml(s.data_pedido || '--') + '</td>' +
                '<td class="td-cod">' + escHtml(s.codigo_entrega || '--') + '</td>' +
                '<td class="td-pac">' + escHtml(s.nm_paciente || '--') + '</td>' +
                '<td>' + escHtml(s.nr_atendimento || '--') + '</td>' +
                '<td>' + escHtml(s.leito || '--') + '</td>' +
                '<td>' + escHtml(s.setor_nome || '--') + '</td>' +
                '<td>' + escHtml(s.tipo_dieta_nome || '--') + '</td>' +
                '<td>' + escHtml(s.refeicao_nome || '--') + '</td>' +
                '<td class="td-obs">' + escHtml(s.observacao || '--') + '</td>' +
                '<td>' + escHtml(s.responsavel_nome || '--') + '</td>' +
                '<td>' + escHtml(statusCfg.label) + '</td>' +
                '<td>' + escHtml(s.criado_em || '--') + '</td>' +
                '<td>' + escHtml(s.dt_entrega || s.dt_cancelamento || '--') + '</td>' +
                '<td>' + (s.t_total_min != null ? fmtMin(s.t_total_min) : '--') + '</td>' +
                '</tr>';
        }

        var html =
            '<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8">' +
            '<title>Relatório de Dietas - HAC</title>' +
            '<style>' +
                '@page{size:A4 landscape;margin:10mm}' +
                'body{font-family:Arial,sans-serif;font-size:9px;color:#000;margin:0;padding:0}' +
                '.cabecalho{display:flex;align-items:center;gap:14px;border-bottom:2px solid #000;padding-bottom:8px;margin-bottom:10px}' +
                '.logo-hospital{height:52px;width:auto;flex-shrink:0}' +
                '.cabecalho-texto{flex:1;text-align:center}' +
                '.cabecalho h1{font-size:13px;margin:0 0 3px;font-weight:bold;letter-spacing:.5px}' +
                '.cabecalho h2{font-size:11px;margin:0;font-weight:bold;color:#555;letter-spacing:.5px}' +
                '.info-linha{display:flex;justify-content:space-between;margin-bottom:8px;font-size:9px;border-bottom:1px dashed #bbb;padding-bottom:6px;gap:8px}' +
                'table{width:100%;border-collapse:collapse;margin-top:4px}' +
                'thead th{background:#333;color:#fff;padding:5px 4px;text-align:left;font-size:8px;font-weight:bold;border:1px solid #000}' +
                'tbody td{padding:4px;border:1px solid #ccc;font-size:8px;vertical-align:top}' +
                '.td-pac{font-weight:bold;min-width:90px}' +
                '.td-cod{font-family:monospace}' +
                '.td-obs{min-width:80px;white-space:normal;word-break:break-word}' +
                'tbody tr:nth-child(even) td{background:#f5f5f5}' +
                '@media print{@page{size:A4 landscape;margin:10mm}body{print-color-adjust:exact;-webkit-print-color-adjust:exact}}' +
            '</style>' +
            '</head><body>' +
            '<div class="cabecalho">' +
                '<img src="/static/img/logo.png" class="logo-hospital" alt="Hospital Anchieta">' +
                '<div class="cabecalho-texto">' +
                    '<h1>HOSPITAL ANCHIETA CEILÂNDIA</h1>' +
                    '<h2>RELATÓRIO DE ENTREGAS DE DIETAS — ' + data + '</h2>' +
                '</div>' +
            '</div>' +
            '<div class="info-linha">' +
                '<span><b>Data:</b> ' + data + '</span>' +
                '<span><b>Emissão:</b> ' + hora + '</span>' +
                '<span><b>Setor:</b> ' + titulo + '</span>' +
                '<span><b>Total de registros:</b> ' + lista.length + '</span>' +
            '</div>' +
            '<table>' +
                '<thead><tr>' +
                    '<th>Dia</th>' +
                    '<th>Código</th>' +
                    '<th>Paciente</th>' +
                    '<th>NR Atend.</th>' +
                    '<th>Leito</th>' +
                    '<th>Setor</th>' +
                    '<th>Dieta</th>' +
                    '<th>Refeição</th>' +
                    '<th>Observação</th>' +
                    '<th>Responsável</th>' +
                    '<th>Status</th>' +
                    '<th>Solicitado</th>' +
                    '<th>Finalizado</th>' +
                    '<th>Tempo</th>' +
                '</tr></thead>' +
                '<tbody>' + linhas + '</tbody>' +
            '</table>' +
            '<script>window.onload=function(){window.print();};<\/script>' +
            '</body></html>';

        var w = window.open('', '_blank', 'width=1100,height=700,toolbar=0,menubar=0,location=0,scrollbars=1');
        if (!w) { alert('Permita pop-ups para imprimir o relatório.'); return; }
        w.document.open();
        w.document.write(html);
        w.document.close();
        w.focus();
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
    // MODAL: EDITAR SOLICITAÇÃO
    // =========================================================
    var _editGen = 0;

    function _carregarOpcoesDieta(tipoDietaAtualId, refeicaoAtualId) {
        _editGen++;
        var gen = _editGen;

        fetch('/api/paineis/painel41/tipos-dieta', { credentials: 'same-origin' })
            .then(function (r) { return r.json(); })
            .then(function (data) {
                if (gen !== _editGen) return;
                if (!data.success) return;
                Estado.tiposDieta = data.tipos || [];
                var html = '<option value="">Selecione...</option>';
                for (var i = 0; i < Estado.tiposDieta.length; i++) {
                    var t = Estado.tiposDieta[i];
                    var sel = (String(t.id) === String(tipoDietaAtualId)) ? ' selected' : '';
                    html += '<option value="' + t.id + '"' + sel + '>' + escHtml(t.nome) + '</option>';
                }
                DOM.editTipoDieta.innerHTML = html;
            })
            .catch(function (e) {
                if (gen !== _editGen) return;
                console.error('tipos-dieta', e);
                DOM.editErro.textContent = 'Erro ao carregar tipos de dieta.';
                DOM.editErro.style.display = 'block';
            });

        fetch('/api/paineis/painel41/refeicoes', { credentials: 'same-origin' })
            .then(function (r) { return r.json(); })
            .then(function (data) {
                if (gen !== _editGen) return;
                if (!data.success) return;
                Estado.refeicoes = data.refeicoes || [];
                var html = '<option value="">Selecione...</option>';
                for (var i = 0; i < Estado.refeicoes.length; i++) {
                    var rf = Estado.refeicoes[i];
                    var sel = (String(rf.id) === String(refeicaoAtualId)) ? ' selected' : '';
                    html += '<option value="' + rf.id + '"' + sel + '>' + escHtml(rf.nome) + '</option>';
                }
                DOM.editRefeicao.innerHTML = html;
            })
            .catch(function (e) {
                if (gen !== _editGen) return;
                console.error('refeicoes', e);
                DOM.editErro.textContent = 'Erro ao carregar refeições.';
                DOM.editErro.style.display = 'block';
            });
    }

    function abrirModalEditar(sid, tipoDietaId, refeicaoId, obs, desc) {
        DOM.editSid.value             = sid;
        DOM.editDesc.textContent      = desc || '';
        // Strip [Retorno:] audit notes — backend re-appends them on save
        var obsLimpa = (obs || '').replace(/(\s*\|\s*)?\[Retorno:[^\]]+\]/g, '').trim();
        DOM.editObs.value             = obsLimpa;
        DOM.editErro.style.display    = 'none';
        DOM.modalEditar.style.display = 'flex';
        _carregarOpcoesDieta(tipoDietaId, refeicaoId);
    }

    function confirmarEditar() {
        var sid         = DOM.editSid.value;
        var tipoDietaId = DOM.editTipoDieta.value;
        var refeicaoId  = DOM.editRefeicao.value;
        var obs         = DOM.editObs.value.trim();

        if (!tipoDietaId || !refeicaoId) {
            DOM.editErro.textContent   = 'Selecione o tipo de dieta e a refeição.';
            DOM.editErro.style.display = 'block';
            return;
        }
        Estado.processando            = true;
        DOM.btnEditConfirmar.disabled = true;
        DOM.editErro.style.display    = 'none';

        fetch(CONFIG.apiBase + '/solicitacoes/' + sid + '/editar', {
            method: 'PUT',
            credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                tipo_dieta_id: parseInt(tipoDietaId, 10),
                refeicao_id:   parseInt(refeicaoId,  10),
                observacao:    obs || null
            })
        })
            .then(function (r) { return r.json(); })
            .then(function (data) {
                Estado.processando = false;
                DOM.btnEditConfirmar.disabled = false;
                if (data.success) {
                    fecharModal(DOM.modalEditar);
                    carregarFila();
                } else {
                    DOM.editErro.textContent   = data.error || 'Erro ao editar.';
                    DOM.editErro.style.display = 'block';
                }
            })
            .catch(function () {
                Estado.processando = false;
                DOM.btnEditConfirmar.disabled = false;
                DOM.editErro.textContent   = 'Falha na conexão.';
                DOM.editErro.style.display = 'block';
            });
    }

    // =========================================================
    // MODAL: VOLTAR STATUS
    // =========================================================
    var _LABEL_VOLTAR = {
        aceito:     'Aceito → Aguardando',
        em_preparo: 'Em Preparo → Aceito',
        pronto:     'Pronto → Em Preparo',
        em_entrega: 'Em Entrega → Pronto'
    };

    function abrirModalVoltarStatus(sid, statusAtual, desc) {
        DOM.voltSid.value             = sid;
        DOM.voltDesc.textContent      = desc || '';
        DOM.voltInfo.textContent      = 'Ação: ' + (_LABEL_VOLTAR[statusAtual] || statusAtual);
        DOM.voltMotivo.value          = '';
        DOM.voltErro.style.display    = 'none';
        DOM.modalVoltar.style.display = 'flex';
    }

    function confirmarVoltarStatus() {
        var sid    = DOM.voltSid.value;
        var motivo = DOM.voltMotivo.value.trim();

        if (motivo.length < 10) {
            DOM.voltErro.textContent   = 'Justificativa deve ter pelo menos 10 caracteres.';
            DOM.voltErro.style.display = 'block';
            return;
        }
        Estado.processando            = true;
        DOM.btnVoltConfirmar.disabled = true;
        DOM.voltErro.style.display    = 'none';

        fetch(CONFIG.apiBase + '/solicitacoes/' + sid + '/voltar-status', {
            method: 'PUT',
            credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ motivo: motivo })
        })
            .then(function (r) { return r.json(); })
            .then(function (data) {
                Estado.processando = false;
                DOM.btnVoltConfirmar.disabled = false;
                if (data.success) {
                    fecharModal(DOM.modalVoltar);
                    carregarFila();
                } else {
                    DOM.voltErro.textContent   = data.error || 'Erro ao voltar status.';
                    DOM.voltErro.style.display = 'block';
                }
            })
            .catch(function () {
                Estado.processando = false;
                DOM.btnVoltConfirmar.disabled = false;
                DOM.voltErro.textContent   = 'Falha na conexão.';
                DOM.voltErro.style.display = 'block';
            });
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
    // PROTOCOLO DE ENTREGA
    // =========================================================
    function abrirModalProtocolo() {
        var emEntrega = [];
        for (var i = 0; i < Estado.fila.length; i++) {
            if (Estado.fila[i].status === 'em_entrega') emEntrega.push(Estado.fila[i]);
        }
        if (!emEntrega.length) {
            alert('Nenhuma solicitação em entrega no momento.');
            return;
        }

        var setores = {};
        for (var j = 0; j < emEntrega.length; j++) {
            var sn = emEntrega[j].setor_nome;
            if (sn) setores[sn] = true;
        }
        var chaves = Object.keys(setores).sort();
        var html = '<option value="">Todos os setores (' + emEntrega.length + ' paciente(s))</option>';
        for (var k = 0; k < chaves.length; k++) {
            var cnt = 0;
            for (var l = 0; l < emEntrega.length; l++) {
                if (emEntrega[l].setor_nome === chaves[k]) cnt++;
            }
            html += '<option value="' + escHtml(chaves[k]) + '">' +
                escHtml(chaves[k]) + ' (' + cnt + ')</option>';
        }
        DOM.protSetor.innerHTML = html;
        DOM.protDesc.textContent = emEntrega.length +
            ' solicitação(ões) em entrega. Selecione o setor ou imprima todos.';
        DOM.modalProtocolo.style.display = 'flex';
    }

    function gerarProtocolo(setorFiltro) {
        var lista = [];
        for (var i = 0; i < Estado.fila.length; i++) {
            var s = Estado.fila[i];
            if (s.status !== 'em_entrega') continue;
            if (setorFiltro && s.setor_nome !== setorFiltro) continue;
            lista.push(s);
        }
        if (!lista.length) {
            alert('Nenhuma solicitação em entrega para o filtro selecionado.');
            return;
        }

        var agora  = new Date();
        var data   = agora.toLocaleDateString('pt-BR');
        var hora   = agora.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
        var titulo = setorFiltro ? escHtml(setorFiltro) : 'Todos os setores';

        var linhas = '';
        for (var j = 0; j < lista.length; j++) {
            var s = lista[j];
            linhas +=
                '<tr>' +
                '<td>' + escHtml(s.codigo_entrega || '--') + '</td>' +
                '<td>' + escHtml(s.nr_atendimento || '--') + '</td>' +
                '<td class="td-paciente">' + escHtml(s.nm_paciente || '--') + '</td>' +
                '<td>' + escHtml(s.leito || '--') + '</td>' +
                '<td>' + escHtml(s.setor_nome || '--') + '</td>' +
                '<td>' + escHtml(s.tipo_dieta_nome || '--') + '</td>' +
                '<td>' + escHtml(s.refeicao_nome || '--') + '</td>' +
                '<td class="td-assinatura">' +
                    '<div class="linha-assinatura"></div>' +
                    '<div class="label-assinatura">Assinatura / Nome legível</div>' +
                '</td>' +
                '</tr>';
        }

        var html =
            '<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8">' +
            '<title>Protocolo de Entrega - HAC</title>' +
            '<style>' +
                '@page{size:A4 portrait;margin:12mm}' +
                'body{font-family:Arial,sans-serif;font-size:10px;color:#000;margin:0;padding:0}' +
                '.cabecalho{display:flex;align-items:center;gap:14px;border-bottom:2px solid #000;padding-bottom:8px;margin-bottom:10px}' +
                '.logo-hospital{height:58px;width:auto;flex-shrink:0}' +
                '.cabecalho-texto{flex:1;text-align:center}' +
                '.cabecalho h1{font-size:14px;margin:0 0 3px;font-weight:bold;letter-spacing:.5px}' +
                '.cabecalho h2{font-size:11px;margin:0;font-weight:bold;color:#555;letter-spacing:.5px}' +
                '.info-linha{display:flex;justify-content:space-between;margin-bottom:8px;font-size:9px;' +
                    'border-bottom:1px dashed #bbb;padding-bottom:6px;gap:8px}' +
                'table{width:100%;border-collapse:collapse;margin-top:4px}' +
                'thead th{background:#333;color:#fff;padding:6px 5px;text-align:left;' +
                    'font-size:9px;font-weight:bold;border:1px solid #000}' +
                'tbody td{padding:5px;border:1px solid #ccc;font-size:9px;vertical-align:middle}' +
                '.td-paciente{font-weight:bold;min-width:130px}' +
                '.td-assinatura{width:26%;min-width:90px}' +
                '.linha-assinatura{border-bottom:1px solid #888;height:26px;margin:0 4px 0}' +
                '.label-assinatura{text-align:center;font-size:7px;color:#777;margin-top:2px}' +
                'tbody tr:nth-child(even) td{background:#f5f5f5}' +
                '@media print{' +
                    '@page{size:A4 portrait;margin:12mm}' +
                    'body{print-color-adjust:exact;-webkit-print-color-adjust:exact}' +
                '}' +
            '</style>' +
            '</head><body>' +
            '<div class="cabecalho">' +
                '<img src="/static/img/logo.png" class="logo-hospital" alt="Hospital Anchieta">' +
                '<div class="cabecalho-texto">' +
                    '<h1>HOSPITAL ANCHIETA CEILÂNDIA</h1>' +
                    '<h2>PROTOCOLO DE ENTREGA DE DIETA</h2>' +
                '</div>' +
            '</div>' +
            '<div class="info-linha">' +
                '<span><b>Data:</b> ' + data + '</span>' +
                '<span><b>Emissão:</b> ' + hora + '</span>' +
                '<span><b>Setor:</b> ' + titulo + '</span>' +
                '<span><b>Total:</b> ' + lista.length + ' paciente(s)</span>' +
            '</div>' +
            '<table>' +
                '<thead><tr>' +
                    '<th>Código</th>' +
                    '<th>NR Atend.</th>' +
                    '<th>Paciente</th>' +
                    '<th>Leito</th>' +
                    '<th>Setor</th>' +
                    '<th>Dieta</th>' +
                    '<th>Refeição</th>' +
                    '<th>Recebimento (Assinatura / Nome)</th>' +
                '</tr></thead>' +
                '<tbody>' + linhas + '</tbody>' +
            '</table>' +
            '<script>window.onload=function(){window.print();};<\/script>' +
            '</body></html>';

        var w = window.open('', '_blank', 'width=820,height=700,toolbar=0,menubar=0,location=0,scrollbars=1');
        if (!w) { alert('Permita pop-ups para imprimir o protocolo.'); return; }
        w.document.open();
        w.document.write(html);
        w.document.close();
        w.focus();
    }

    // =========================================================
    // ASSINATURA DIGITAL (Painel 48 integração)
    // =========================================================
    function abrirAssinaturaDigital(sid, nm, nr, refeicao, dieta) {
        var infoExtra = (refeicao || '');
        if (dieta) infoExtra = dieta + (refeicao ? ' — ' + refeicao : '');
        var url = '/painel/painel48'
            + '?contexto=entrega_refeicao'
            + '&ref_id=' + encodeURIComponent(sid || '')
            + '&ref_tabela=nutricao_solicitacoes'
            + '&nm_paciente=' + encodeURIComponent(nm || '')
            + '&nr_atendimento=' + encodeURIComponent(nr || '')
            + '&info_extra=' + encodeURIComponent(infoExtra);
        window.open(url, 'p48_assin_' + sid, 'width=680,height=700,toolbar=0,menubar=0,location=0,scrollbars=1');
    }

    function confirmarEntregaAssinado(sid, assinaturaId) {
        fetch(CONFIG.apiBase + '/solicitacoes/' + sid + '/entregar-assinado', {
            method: 'PUT',
            credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ assinatura_id: assinaturaId })
        })
        .then(function (r) { return r.json(); })
        .then(function (data) {
            if (data.success) {
                carregarFila();
                carregarHistorico();
            } else {
                alert('Erro ao confirmar entrega assinada: ' + (data.error || ''));
            }
        })
        .catch(function (e) {
            console.error('entregar-assinado', e);
            alert('Falha na conexão ao confirmar entrega assinada.');
        });
    }

    // =========================================================
    // START
    // =========================================================
    window.addEventListener('DOMContentLoaded', inicializar);
    window.addEventListener('message', function (evt) {
        if (evt.origin !== window.location.origin) return;
        var msg = evt.data || {};
        if (msg.tipo === 'assinatura_ok' && msg.contexto === 'entrega_refeicao' && msg.ref_id) {
            confirmarEntregaAssinado(msg.ref_id, msg.id);
        }
    });

})();
