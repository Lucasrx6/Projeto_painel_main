(function () {
    'use strict';

    // ── Histórico de assinaturas ──────────────────────────────────

    function renderizarHistorico() {
        var E   = window.P48.Estado;
        var ctx = E.contextoAtual;

        E.modo = 'historico';

        var btnVoltar = document.getElementById('btn-voltar-hub');
        if (btnVoltar) btnVoltar.style.display = '';

        if (ctx) {
            document.getElementById('titulo-painel').textContent = 'Histórico — ' + (ctx.nome || '');
        }

        window.P48.mostrarLoading();
        _buscarHistorico(ctx ? ctx.codigo : null);
    }

    function _buscarHistorico(codigoContexto) {
        var url = window.P48.CONFIG.api + '/historico';
        if (codigoContexto) url += '?contexto=' + encodeURIComponent(codigoContexto);

        fetch(url, { credentials: 'same-origin' })
            .then(function (r) { return r.json(); })
            .then(function (d) {
                if (d.success) {
                    _renderizarTabelaHistorico(d.registros || []);
                } else {
                    _mostrarErro(d.error || 'Erro ao carregar histórico.');
                }
            })
            .catch(function () {
                _mostrarErro('Falha na comunicação com o servidor.');
            });
    }

    function _mostrarErro(msg) {
        var mc = document.getElementById('main-content');
        if (!mc) return;
        mc.innerHTML = '<div class="hist-erro"><i class="fas fa-exclamation-triangle"></i> '
            + window.P48.escHtml(msg) + '</div>';
    }

    function _renderizarTabelaHistorico(registros) {
        var mc  = document.getElementById('main-content');
        var esc = window.P48.escHtml;
        var dh  = window.P48.formatarDataHora;
        if (!mc) return;

        if (registros.length === 0) {
            mc.innerHTML = '<div class="hist-vazio">'
                + '<i class="fas fa-file-alt" style="font-size:48px;color:#adb5bd;"></i>'
                + '<p>Nenhuma assinatura registrada neste contexto.</p>'
                + '</div>';
            return;
        }

        var html = '<div class="hist-container">'
            + '<table class="hist-tabela">'
            + '<thead><tr>'
            + '<th>#</th>'
            + '<th>Data / Hora</th>'
            + '<th>Paciente</th>'
            + '<th>Assinado por</th>'
            + '<th>Qualidade</th>'
            + '<th>Coletor</th>'
            + '<th></th>'
            + '</tr></thead>'
            + '<tbody>';

        for (var i = 0; i < registros.length; i++) {
            var r = registros[i];
            var qualLabel = _labelQualidade(r.qualidade_signatario);
            html += '<tr>'
                + '<td>' + esc(String(r.id)) + '</td>'
                + '<td>' + esc(dh(r.criado_em)) + '</td>'
                + '<td>' + esc(r.nm_paciente || '—') + '</td>'
                + '<td>' + esc(r.nm_signatario || '—') + '</td>'
                + '<td><span class="qual-badge qual-' + esc(r.qualidade_signatario || '') + '">'
                + esc(qualLabel) + '</span></td>'
                + '<td>' + esc(r.nm_coletor || '—') + '</td>'
                + '<td>'
                + (r.assinatura_img
                    ? '<button class="btn-ver-assin" data-id="' + esc(String(r.id)) + '">'
                        + '<i class="fas fa-image"></i> Ver</button>'
                    : '<span class="assin-cpf" title="Identificado por CPF"><i class="fas fa-id-card"></i></span>')
                + '</td>'
                + '</tr>';
        }

        html += '</tbody></table></div>';
        mc.innerHTML = html;

        mc.addEventListener('click', function (e) {
            var el = e.target;
            while (el && el !== mc) {
                if (el.classList && el.classList.contains('btn-ver-assin')) {
                    var idStr = el.getAttribute('data-id');
                    if (idStr) verAssinatura(parseInt(idStr, 10));
                    return;
                }
                el = el.parentNode;
            }
        });
    }

    function _labelQualidade(codigo) {
        var mapa = {
            'paciente':          'Paciente',
            'familiar':          'Familiar',
            'responsavel_legal': 'Resp. Legal'
        };
        return mapa[codigo] || (codigo || '—');
    }

    function verAssinatura(id) {
        var esc  = window.P48.escHtml;
        var dh   = window.P48.formatarDataHora;
        var mc   = document.getElementById('modal-ver');
        var body = document.getElementById('modal-ver-body');
        if (!mc || !body) return;

        body.innerHTML = '<div class="loading"><div class="loading-spinner"></div><span>Carregando...</span></div>';
        mc.style.display = 'flex';

        fetch(window.P48.CONFIG.api + '/assinatura/' + id, { credentials: 'same-origin' })
            .then(function (r) { return r.json(); })
            .then(function (d) {
                if (!d.success || !d.registro) {
                    body.innerHTML = '<p class="hist-erro">Registro não encontrado.</p>';
                    return;
                }
                var reg = d.registro;
                body.innerHTML = '<div class="comp-row"><span>ID</span><strong>#' + esc(String(reg.id)) + '</strong></div>'
                    + '<div class="comp-row"><span>Paciente</span><strong>' + esc(reg.nm_paciente || '—') + '</strong></div>'
                    + '<div class="comp-row"><span>Assinado por</span><strong>' + esc(reg.nm_signatario || '—') + '</strong></div>'
                    + '<div class="comp-row"><span>Data</span><strong>' + esc(dh(reg.criado_em)) + '</strong></div>'
                    + (reg.assinatura_img
                        ? '<div style="text-align:center;margin-top:12px;">'
                            + '<img src="' + esc(reg.assinatura_img) + '" alt="Assinatura" style="max-width:100%;border:1px solid #dee2e6;border-radius:6px;">'
                            + '</div>'
                        : '<p style="color:#6c757d;margin-top:8px;">Assinatura via CPF — sem imagem.</p>');
            })
            .catch(function () {
                body.innerHTML = '<p class="hist-erro">Erro de comunicação.</p>';
            });
    }

    window.P48.renderizarHistorico = renderizarHistorico;
    window.P48.verAssinatura       = verAssinatura;

})();
