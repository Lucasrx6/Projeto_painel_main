(function () {
    'use strict';

    function encontrarContexto(codigo) {
        var lista = window.P48.Estado.contextos;
        for (var i = 0; i < lista.length; i++) {
            if (lista[i].codigo === codigo) return lista[i];
        }
        return null;
    }

    function irParaHub() {
        var E = window.P48.Estado;
        E.modo          = 'hub';
        E.contextoAtual = null;
        E.signaturePad  = null;
        E.pinInfo       = null;

        document.getElementById('titulo-painel').textContent = 'Assinatura Digital — HUB';

        var btn = document.getElementById('btn-voltar-hub');
        if (btn) btn.style.display = 'none';

        renderizarHub();
    }

    function renderizarHub() {
        var E   = window.P48.Estado;
        var esc = window.P48.escHtml;
        var mc  = document.getElementById('main-content');
        if (!mc) return;

        if (E.contextos.length === 0) {
            mc.innerHTML = '<div class="hub-vazio">'
                + '<i class="fas fa-lock" style="font-size:48px;color:#adb5bd;"></i>'
                + '<p>Nenhum contexto de assinatura disponível para você.</p>'
                + '<p style="font-size:13px;color:#6c757d;">Solicite ao administrador a liberação do acesso.</p>'
                + '</div>';
            return;
        }

        var html = '<div class="hub-grid">';
        for (var i = 0; i < E.contextos.length; i++) {
            var ctx = E.contextos[i];
            html += '<div class="hub-card" data-codigo="' + esc(ctx.codigo) + '">'
                + '<div class="hub-card-icone" style="background:' + esc(ctx.cor) + ';">'
                + '<i class="fas ' + esc(ctx.icone) + '"></i>'
                + '</div>'
                + '<div class="hub-card-info">'
                + '<strong>' + esc(ctx.nome) + '</strong>'
                + (ctx.descricao ? '<p>' + esc(ctx.descricao) + '</p>' : '')
                + '</div>'
                + '<div class="hub-card-acoes">'
                + '<button class="btn-hub-assinar" data-acao="assinar" data-codigo="' + esc(ctx.codigo) + '">'
                + '<i class="fas fa-pen-nib"></i> Coletar Assinatura</button>'
                + '<button class="btn-hub-hist" data-acao="historico" data-codigo="' + esc(ctx.codigo) + '">'
                + '<i class="fas fa-history"></i> Histórico</button>'
                + '</div>'
                + '</div>';
        }
        html += '</div>';

        if (E.isAdmin) {
            html += '<div class="hub-admin-link">'
                + '<button class="btn-admin" data-acao="admin">'
                + '<i class="fas fa-cog"></i> Administração</button>'
                + '</div>';
        }

        mc.innerHTML = html;

        mc.addEventListener('click', function (e) {
            var el = e.target;
            while (el && el !== mc) {
                var acao   = el.getAttribute ? el.getAttribute('data-acao')   : null;
                var codigo = el.getAttribute ? el.getAttribute('data-codigo') : null;

                if (acao === 'admin') { window.P48.renderizarAdmin(); return; }

                if (acao && codigo) {
                    var ctx = encontrarContexto(codigo);
                    if (ctx) {
                        E.contextoAtual = ctx;
                        if (acao === 'assinar') {
                            if (codigo === 'entrega_refeicao') {
                                window.P48.renderizarFilaEntrega();
                            } else {
                                E.modoFila = false;
                                E.params   = {};
                                window.P48.renderizarAssinatura();
                            }
                            return;
                        }
                        if (acao === 'historico') { window.P48.renderizarHistorico(); return; }
                    }
                }

                el = el.parentNode;
            }
        });
    }

    window.P48.encontrarContexto = encontrarContexto;
    window.P48.irParaHub         = irParaHub;
    window.P48.renderizarHub     = renderizarHub;

})();
