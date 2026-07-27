(function () {
    'use strict';
    var P = window.P35;

    function carregarHistorico() {
        if (!P.Estado.padioleiroId) {
            document.getElementById('lista-historico').innerHTML = '<p style="padding:20px;color:#aaa;text-align:center;">Selecione seu nome para ver o historico.</p>';
            return;
        }
        fetch(P.CONFIG.api.historico + '?padioleiro_id=' + P.Estado.padioleiroId, { credentials: 'same-origin' })
            .then(function (r) { return r.json(); })
            .then(function (data) {
                if (!data.success) return;
                renderizarHistorico(data.chamados);
            })
            .catch(function () { P.toast('Erro ao carregar historico', 'error'); });
    }

    function renderizarHistorico(chamados) {
        var lista  = document.getElementById('lista-historico');
        var vazio  = document.getElementById('historico-vazio');
        var resumo = document.getElementById('historico-resumo');

        var concluidos = chamados.filter(function (c) { return c.status === 'concluido'; });
        var tempos     = concluidos.filter(function (c) { return c.tempo_transporte_min; }).map(function (c) { return c.tempo_transporte_min; });
        var mediaMin   = tempos.length > 0 ? (tempos.reduce(function (a, b) { return a + b; }, 0) / tempos.length) : 0;

        resumo.innerHTML =
            '<div class="hist-stat"><div class="hist-stat-num">' + chamados.length + '</div><div class="hist-stat-label">Total</div></div>' +
            '<div class="hist-stat"><div class="hist-stat-num" style="color:#28a745;">' + concluidos.length + '</div><div class="hist-stat-label">Concluidos</div></div>' +
            '<div class="hist-stat"><div class="hist-stat-num" style="color:#17a2b8;">' + (mediaMin > 0 ? Math.round(mediaMin) + 'min' : '--') + '</div><div class="hist-stat-label">Tempo Medio</div></div>';

        if (chamados.length === 0) {
            lista.style.display = 'none';
            vazio.style.display = '';
            return;
        }
        lista.style.display = '';
        vazio.style.display = 'none';

        lista.innerHTML = chamados.map(function (c) {
            var tempoLabel = c.tempo_transporte_min ? Math.round(c.tempo_transporte_min) + ' min' : '--';
            var hora       = c.criado_em ? new Date(c.criado_em).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '--';
            return '<div class="hist-card ' + (c.status === 'cancelado' ? 'cancelado' : '') + '">' +
                '<div class="hist-card-header">' +
                    '<span class="hist-tipo">' + P.escHtml(c.tipo_movimento_nome || '-') + '</span>' +
                    (c.status === 'concluido'
                        ? '<span class="hist-tempo"><i class="fas fa-clock"></i> ' + tempoLabel + '</span>'
                        : '<span style="background:#f8f9fa;color:#6c757d;padding:2px 8px;border-radius:8px;font-size:12px;">' + c.status + '</span>') +
                '</div>' +
                '<div class="hist-paciente">' + P.escHtml(c.nm_paciente || 'Paciente nao informado') + '</div>' +
                '<div class="hist-rota">' +
                    '<i class="fas fa-map-marker-alt" style="color:#dc3545;font-size:10px;"></i>' +
                    P.escHtml(c.setor_origem_nome || '-') + ' → ' + P.escHtml(c.destino_nome || '-') +
                '</div>' +
                '<div class="hist-horario"><i class="fas fa-clock"></i> ' + hora + '</div>' +
            '</div>';
        }).join('');
    }

    P.carregarHistorico   = carregarHistorico;
    P.renderizarHistorico = renderizarHistorico;
})();
