(function () {
    'use strict';

    // ── Tela de administração ─────────────────────────────────────

    function renderizarAdmin() {
        var E = window.P48.Estado;
        if (!E.isAdmin) {
            window.P48.toast('Acesso restrito a administradores.', 'erro');
            return;
        }

        E.modo = 'admin';

        var btnVoltar = document.getElementById('btn-voltar-hub');
        if (btnVoltar) btnVoltar.style.display = '';

        document.getElementById('titulo-painel').textContent = 'Administração — Assinatura Digital';

        window.P48.mostrarLoading();

        fetch(window.P48.CONFIG.api + '/admin/dados', { credentials: 'same-origin' })
            .then(function (r) { return r.json(); })
            .then(function (d) {
                if (d.success) {
                    _renderizarAdminView(d);
                } else {
                    _mostrarErroAdmin(d.error || 'Erro ao carregar dados.');
                }
            })
            .catch(function () {
                _mostrarErroAdmin('Falha na comunicação com o servidor.');
            });
    }

    function _mostrarErroAdmin(msg) {
        var mc = document.getElementById('main-content');
        if (!mc) return;
        mc.innerHTML = '<div class="admin-erro"><i class="fas fa-exclamation-triangle"></i> '
            + window.P48.escHtml(msg) + '</div>';
    }

    function _renderizarAdminView(d) {
        var mc = document.getElementById('main-content');
        if (!mc) return;

        mc.innerHTML = '<div class="admin-container">'
            + _htmlContextos(d.contextos || [])
            + _htmlPermissoes(d.permissoes || [])
            + '</div>';

        _vincularEventosAdmin();
    }

    function _htmlContextos(contextos) {
        var esc  = window.P48.escHtml;
        var html = '<div class="admin-secao">'
            + '<h3 class="admin-secao-titulo"><i class="fas fa-list"></i> Contextos de Assinatura</h3>';

        if (contextos.length === 0) {
            html += '<p class="admin-vazio">Nenhum contexto cadastrado.</p>';
        } else {
            html += '<table class="admin-tabela"><thead><tr>'
                + '<th>Código</th><th>Nome</th><th>Ícone</th><th>Cor</th><th>Ativo</th>'
                + '</tr></thead><tbody>';
            for (var i = 0; i < contextos.length; i++) {
                var ctx = contextos[i];
                html += '<tr>'
                    + '<td><code>' + esc(ctx.codigo) + '</code></td>'
                    + '<td>' + esc(ctx.nome) + '</td>'
                    + '<td><i class="fas ' + esc(ctx.icone) + '"></i></td>'
                    + '<td><span class="cor-chip" style="background:' + esc(ctx.cor) + ';"></span></td>'
                    + '<td>' + (ctx.ativo ? '<span class="badge-ativo">Sim</span>' : '<span class="badge-inativo">Não</span>') + '</td>'
                    + '</tr>';
            }
            html += '</tbody></table>';
        }

        html += '</div>';
        return html;
    }

    function _htmlPermissoes(permissoes) {
        var esc  = window.P48.escHtml;
        var html = '<div class="admin-secao">'
            + '<h3 class="admin-secao-titulo"><i class="fas fa-users"></i> Permissões por Usuário</h3>';

        if (permissoes.length === 0) {
            html += '<p class="admin-vazio">Nenhuma permissão específica cadastrada. Admins têm acesso a tudo.</p>';
        } else {
            html += '<table class="admin-tabela"><thead><tr>'
                + '<th>Usuário</th><th>Contexto</th><th>Concedido em</th>'
                + '</tr></thead><tbody>';
            for (var i = 0; i < permissoes.length; i++) {
                var p = permissoes[i];
                html += '<tr>'
                    + '<td>' + esc(p.usuario || '—') + '</td>'
                    + '<td>' + esc(p.contexto || '—') + '</td>'
                    + '<td>' + esc(window.P48.formatarDataHora(p.criado_em)) + '</td>'
                    + '</tr>';
            }
            html += '</tbody></table>';
        }

        html += '<div class="admin-footer-nota">'
            + '<i class="fas fa-info-circle"></i> Para gerenciar contextos e permissões, '
            + 'acesse o painel de administração geral do sistema.'
            + '</div>';

        html += '</div>';
        return html;
    }

    function _vincularEventosAdmin() {
        // Reservado para futuras ações inline na tela de admin
    }

    window.P48.renderizarAdmin = renderizarAdmin;

})();
