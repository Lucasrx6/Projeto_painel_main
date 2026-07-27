(function () {
    'use strict';
    var P = window.P35;

    function carregarPadioleiros() {
        fetch(P.CONFIG.api.padioleiros, { credentials: 'same-origin' })
            .then(function (r) { return r.json(); })
            .then(function (data) {
                if (!data.success) return;
                P.Estado.padioleiros = data.padioleiros;
                var select = document.getElementById('select-padioleiro');
                select.innerHTML = '<option value="">Selecione seu nome...</option>';
                data.padioleiros.forEach(function (p) {
                    var opt = document.createElement('option');
                    opt.value = p.id;
                    opt.textContent = p.nome + (p.turno && p.turno !== 'todos' ? ' (' + p.turno + ')' : '');
                    select.appendChild(opt);
                });
                var salvo = P.carregarPadioleiroLocal();
                if (salvo && data.padioleiros.some(function (p) { return String(p.id) === String(salvo); })) {
                    select.value = salvo;
                    P.Estado.padioleiroId = salvo;
                }
                carregarFila();
            })
            .catch(function (e) { console.error('Erro padioleiros:', e); });
    }

    var _filaCarregando = false;

    function iniciarRefresh() {
        P.Estado.refreshTimer = setInterval(carregarFila, P.CONFIG.intervaloRefresh);
    }

    function carregarFila() {
        if (_filaCarregando) return;
        _filaCarregando = true;

        var url = P.CONFIG.api.fila;
        if (P.Estado.padioleiroId) url += '?padioleiro_id=' + P.Estado.padioleiroId;

        fetch(url, { credentials: 'same-origin' })
            .then(function (r) { return r.json(); })
            .then(function (data) {
                if (!data.success) return;
                P.atualizarStatusConexao(true);

                var novosChamados = data.aguardando || [];
                verificarNovosChamados(novosChamados);

                P.renderizarChamadoAtivo(data.chamado_ativo);
                renderizarFila(novosChamados);

                document.getElementById('fila-count').textContent = novosChamados.length;
                document.getElementById('badge-fila').textContent = novosChamados.length + ' na fila';
            })
            .catch(function () { P.atualizarStatusConexao(false); })
            .finally(function () { _filaCarregando = false; });
    }

    function verificarNovosChamados(lista) {
        if (P.Estado.chamadosAnteriores.length === 0) {
            P.Estado.chamadosAnteriores = lista.map(function (c) { return c.id; });
            return;
        }
        var idsAnteriores = P.Estado.chamadosAnteriores;
        var novos = lista.filter(function (c) { return idsAnteriores.indexOf(c.id) === -1; });
        if (novos.length > 0) {
            P.emitirAlertaSonoro();
            P.mostrarAlertaNovoChamado(novos.length);
        }
        P.Estado.chamadosAnteriores = lista.map(function (c) { return c.id; });
    }

    function renderizarFila(lista) {
        var container = document.getElementById('lista-fila');
        var vazio     = document.getElementById('fila-vazia');

        if (!lista || lista.length === 0) {
            container.style.display = 'none';
            vazio.style.display = '';
            return;
        }
        container.style.display = '';
        vazio.style.display = 'none';

        container.innerHTML = lista.map(function (c) {
            var min          = c.minutos_espera || 0;
            var classeEspera = min > 30 ? 'critico' : (min > 15 ? 'atencao' : 'ok');
            var tempoLabel   = min < 1 ? 'Agora' : (min < 60 ? Math.round(min) + ' min' : Math.floor(min / 60) + 'h ' + (Math.round(min) % 60) + 'min');

            return '<div class="fila-card ' + c.prioridade + '">' +
                '<div class="fila-card-header">' +
                    '<span class="fila-badge-tipo">' + P.escHtml(c.tipo_movimento_nome || '-') + '</span>' +
                    (c.prioridade === 'urgente'
                        ? '<span class="fila-badge-urgente"><i class="fas fa-exclamation-triangle"></i> URGENTE</span>'
                        : '<span class="fila-badge-normal"><i class="fas fa-clock"></i> Normal</span>') +
                '</div>' +
                '<div class="fila-card-body">' +
                    '<div class="fila-paciente">' +
                        P.escHtml(c.nm_paciente || 'Paciente nao informado') +
                        (c.leito_origem ? ' <span style="color:#6c757d;font-size:13px;font-weight:400;">Leito ' + P.escHtml(c.leito_origem) + '</span>' : '') +
                    '</div>' +
                    '<div class="fila-rota">' +
                        '<i class="fas fa-map-marker-alt" style="color:#dc3545;font-size:11px;"></i>' +
                        P.escHtml(c.setor_origem_nome || '-') +
                        ' <i class="fas fa-arrow-right" style="font-size:10px;"></i> ' +
                        '<strong>' + P.escHtml(c.destino_nome || '-') + '</strong>' +
                    '</div>' +
                    (c.observacao ? '<div class="fila-obs"><i class="fas fa-comment-dots"></i> ' + P.escHtml(c.observacao) + '</div>' : '') +
                '</div>' +
                '<div class="fila-card-footer">' +
                    '<span class="fila-solicitante"><i class="fas fa-user"></i> ' + P.escHtml(c.solicitante_nome || '-') + '</span>' +
                    '<span class="fila-espera ' + classeEspera + '"><i class="fas fa-stopwatch"></i> ' + tempoLabel + '</span>' +
                    '<button class="btn-cancelar-fila-pad" data-id="' + c.id + '" style="background:transparent;border:none;color:var(--danger);font-size:12px;cursor:pointer;margin-right:10px;"><i class="fas fa-times"></i> Cancelar</button>' +
                    '<button class="btn-aceitar-fila"' +
                        ' data-id="'       + c.id + '"' +
                        ' data-tipo="'     + P.escHtml(c.tipo_movimento_nome || '') + '"' +
                        ' data-paciente="' + P.escHtml(c.nm_paciente || '') + '"' +
                        ' data-setor="'    + P.escHtml(c.setor_origem_nome || '') + '"' +
                        ' data-leito="'    + P.escHtml(c.leito_origem || '') + '"' +
                        ' data-destino="'  + P.escHtml(c.destino_nome || '') + '"' +
                        ' data-prio="'     + c.prioridade + '">' +
                        '<i class="fas fa-hand-pointer"></i> Aceitar' +
                    '</button>' +
                '</div>' +
            '</div>';
        }).join('');

        container.querySelectorAll('.btn-aceitar-fila').forEach(function (btn) {
            btn.addEventListener('click', function () { P.abrirModalAceitar(btn); });
        });
        container.querySelectorAll('.btn-cancelar-fila-pad').forEach(function (btn) {
            btn.addEventListener('click', function () { P.abrirModalCancelarPad(parseInt(btn.dataset.id)); });
        });
    }

    P.carregarPadioleiros = carregarPadioleiros;
    P.iniciarRefresh      = iniciarRefresh;
    P.carregarFila        = carregarFila;
    P.renderizarFila      = renderizarFila;
})();
