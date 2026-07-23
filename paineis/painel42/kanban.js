(function () {
    'use strict';

    var COLS = ['aguardando', 'aceito', 'em_preparo', 'pronto', 'em_entrega'];

    function renderCard(s) {
        var escHtml  = window.P42.escHtml;
        var fmtMin   = window.P42.fmtMin;
        var urgente  = s.prioridade === 'urgente';
        var minWarn  = s.minutos_espera > 30 ? ' card-alerta' : '';
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

    function bindBtn(selector, handler) {
        var btns = document.querySelectorAll(selector);
        for (var i = 0; i < btns.length; i++) {
            (function (btn) {
                btn.addEventListener('click', function () { handler(btn); });
            })(btns[i]);
        }
    }

    function bindCardBtns() {
        bindBtn('.btn-aceitar', function (el) {
            window.P42.abrirModalAceitar(el.getAttribute('data-id'), el.getAttribute('data-desc'));
        });
        bindBtn('.btn-preparo', function (el) {
            window.P42.executarAcao(el.getAttribute('data-id'), 'iniciar-preparo');
        });
        bindBtn('.btn-pronto', function (el) {
            window.P42.executarAcao(el.getAttribute('data-id'), 'pronto');
        });
        bindBtn('.btn-entrega', function (el) {
            window.P42.executarAcao(el.getAttribute('data-id'), 'iniciar-entrega');
        });
        bindBtn('.btn-assinar-digital', function (el) {
            window.P42.abrirAssinaturaDigital(
                el.getAttribute('data-id'),
                el.getAttribute('data-nm'),
                el.getAttribute('data-nr'),
                el.getAttribute('data-refeicao'),
                el.getAttribute('data-dieta')
            );
        });
        bindBtn('.btn-confirmar-entrega', function (el) {
            window.P42.abrirModalEntregar(
                el.getAttribute('data-id'),
                el.getAttribute('data-codigo'),
                el.getAttribute('data-desc')
            );
        });
        bindBtn('.btn-reimprimir', function (el) {
            var sid  = el.getAttribute('data-id');
            var fila = window.P42.Estado.fila;
            for (var i = 0; i < fila.length; i++) {
                if (String(fila[i].id) === String(sid)) {
                    window.P42.imprimirEtiqueta(fila[i]);
                    break;
                }
            }
        });
        bindBtn('.btn-cancelar', function (el) {
            window.P42.abrirModalCancelar(el.getAttribute('data-id'), el.getAttribute('data-desc'));
        });
        bindBtn('.btn-editar', function (el) {
            window.P42.abrirModalEditar(
                el.getAttribute('data-id'),
                el.getAttribute('data-tipo-id'),
                el.getAttribute('data-ref-id'),
                el.getAttribute('data-obs'),
                el.getAttribute('data-desc')
            );
        });
        bindBtn('.btn-voltar-status', function (el) {
            window.P42.abrirModalVoltarStatus(
                el.getAttribute('data-id'),
                el.getAttribute('data-status'),
                el.getAttribute('data-desc')
            );
        });
    }

    function renderKanban() {
        var Estado = window.P42.Estado;
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
            var col   = COLS[c];
            var colEl = document.getElementById('col-' + col);
            var lista = grupos[col];
            var badge = document.getElementById('badge-' + col);

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

    function renderContadores() {
        var cols = ['aguardando', 'aceito', 'em_preparo', 'pronto', 'em_entrega'];
        var contadores = window.P42.Estado.contadores;
        for (var i = 0; i < cols.length; i++) {
            var c  = cols[i];
            var el = document.getElementById('cnt-' + c);
            if (!el) continue;
            var num = el.querySelector('.cnt-num');
            if (num) num.textContent = contadores[c] || 0;
        }
    }

    window.P42.renderKanban    = renderKanban;
    window.P42.renderContadores = renderContadores;

})();
