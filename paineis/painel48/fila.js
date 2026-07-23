(function () {
    'use strict';

    // ── Fila de entrega (contexto: entrega_refeicao) ──────────────

    function renderizarFilaEntrega() {
        var E   = window.P48.Estado;
        var esc = window.P48.escHtml;

        E.modo     = 'fila';
        E.modoFila = true;

        var btnVoltar = document.getElementById('btn-voltar-hub');
        if (btnVoltar) btnVoltar.style.display = '';

        var ctx = E.contextoAtual;
        if (ctx) {
            document.getElementById('titulo-painel').textContent = ctx.nome || 'Fila de Entrega';
        }

        window.P48.mostrarLoading();

        fetch(window.P48.CONFIG.api + '/fila-entrega', { credentials: 'same-origin' })
            .then(function (r) { return r.json(); })
            .then(function (d) {
                if (d.success) {
                    _renderizarListaFila(d.itens || []);
                } else {
                    _mostrarErroFila(d.error || 'Erro ao carregar fila.');
                }
            })
            .catch(function () {
                _mostrarErroFila('Falha na comunicação com o servidor.');
            });
    }

    function _mostrarErroFila(msg) {
        var mc = document.getElementById('main-content');
        if (!mc) return;
        mc.innerHTML = '<div class="fila-erro"><i class="fas fa-exclamation-triangle"></i> '
            + window.P48.escHtml(msg) + '</div>';
    }

    function _renderizarListaFila(itens) {
        var mc  = document.getElementById('main-content');
        var esc = window.P48.escHtml;
        if (!mc) return;

        if (itens.length === 0) {
            mc.innerHTML = '<div class="fila-vazia">'
                + '<i class="fas fa-check-circle" style="font-size:48px;color:#28a745;"></i>'
                + '<p>Nenhuma entrega pendente no momento.</p>'
                + '</div>';
            return;
        }

        var html = '<div class="fila-lista">';
        for (var i = 0; i < itens.length; i++) {
            html += _htmlCardFila(itens[i]);
        }
        html += '</div>';

        mc.innerHTML = html;

        mc.addEventListener('click', function (e) {
            var el = e.target;
            while (el && el !== mc) {
                var idStr = el.getAttribute ? el.getAttribute('data-id') : null;
                if (idStr && el.classList && el.classList.contains('btn-selecionar-fila')) {
                    _selecionarItemFila(parseInt(idStr, 10));
                    return;
                }
                el = el.parentNode;
            }
        });
    }

    function _htmlCardFila(item) {
        var esc         = window.P48.escHtml;
        var dataHora    = window.P48.formatarDataHora;
        var classeUrg   = item.urgente ? ' fila-card-urgente' : '';
        var badgeUrg    = item.urgente
            ? '<span class="badge badge-urgente">Urgente</span> '
            : '';

        return '<div class="fila-card' + classeUrg + '" data-id="' + esc(String(item.id)) + '">'
            + '<div class="fila-card-info">'
            + '<div class="fila-card-nome">' + badgeUrg + esc(item.nm_paciente || '—') + '</div>'
            + '<div class="fila-card-detalhe">'
            + 'Leito: ' + esc(item.leito || '—')
            + ' &nbsp;|&nbsp; Setor: ' + esc(item.setor || '—')
            + '</div>'
            + (item.criado_em
                ? '<div class="fila-card-horario"><i class="fas fa-clock"></i> ' + esc(dataHora(item.criado_em)) + '</div>'
                : '')
            + '</div>'
            + '<button class="btn-selecionar-fila" data-id="' + esc(String(item.id)) + '">'
            + '<i class="fas fa-pen-nib"></i> Coletar Assinatura'
            + '</button>'
            + '</div>';
    }

    function _selecionarItemFila(id) {
        var E = window.P48.Estado;

        fetch(window.P48.CONFIG.api + '/fila-entrega/' + id, { credentials: 'same-origin' })
            .then(function (r) { return r.json(); })
            .then(function (d) {
                if (d.success && d.item) {
                    E.params = {
                        ref_id:        String(d.item.id),
                        ref_tabela:    d.item.ref_tabela || null,
                        nr_atendimento: d.item.nr_atendimento || '',
                        nm_paciente:   d.item.nm_paciente || '',
                        info_extra:    d.item.info_extra || ''
                    };
                    E.modoFila = true;
                    window.P48.renderizarAssinatura();
                } else {
                    window.P48.toast(d.error || 'Erro ao carregar item.', 'erro');
                }
            })
            .catch(function () {
                window.P48.toast('Falha na comunicação com o servidor.', 'erro');
            });
    }

    window.P48.renderizarFilaEntrega = renderizarFilaEntrega;

})();
