(function () {
    'use strict';

    function carregarDashboard() {
        var P = window.P36;
        fetch(P.CONFIG.api.dashboard, { credentials: 'same-origin' })
            .then(function (r) { return r.json(); })
            .then(function (data) {
                if (!data.success) return;
                renderizarStats(data.stats);
                renderizarAtivos(data.ativos);
                document.getElementById('ultima-atualizacao').textContent =
                    new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
            })
            .catch(function (e) { console.error('Erro dashboard:', e); });
    }

    function renderizarStats(s) {
        var m    = window.P36.min;
        var grid = document.getElementById('stats-grid');
        grid.innerHTML =
            statCard('stat-aguardando',  s.aguardando              || 0, 'Aguardando',           'fa-clock') +
            statCard('stat-aceito',      s.aceito                  || 0, 'Aceitos',              'fa-check') +
            statCard('stat-transporte',  s.em_transporte           || 0, 'Em Transporte',        'fa-person-walking') +
            statCard('stat-concluidos',  s.concluidos_hoje         || 0, 'Concluidos Hoje',      'fa-check-double') +
            statCard('stat-urgentes',    s.urgentes_aguardando     || 0, 'Urgentes Fila',        'fa-bolt') +
            statCard('stat-tempo',       m(s.tempo_medio_aceite_hoje),       'T. Medio p/ Aceite',    'fa-hourglass-start') +
            statCard('stat-deslocam',    m(s.tempo_medio_deslocamento_hoje), 'T. Medio Deslocamento', 'fa-route') +
            statCard('stat-transporte2', m(s.tempo_medio_transporte_hoje),   'T. Medio Transporte',   'fa-truck-medical') +
            statCard('stat-total',       m(s.tempo_medio_total_hoje),        'T. Medio Total',        'fa-stopwatch');
    }

    function statCard(classe, valor, label, icone) {
        return '<div class="stat-card ' + classe + '">' +
            '<div class="stat-icone"><i class="fas ' + icone + '"></i></div>' +
            '<div class="stat-num">' + valor + '</div>' +
            '<div class="stat-label">' + label + '</div>' +
        '</div>';
    }

    function renderizarAtivos(lista) {
        var P       = window.P36;
        var wrapper = document.getElementById('tabela-ativos-wrapper');
        if (!lista || lista.length === 0) {
            wrapper.innerHTML = '<div class="tabela-vazio"><i class="fas fa-check-circle" style="color:#28a745;"></i><p>Nenhum chamado em aberto</p></div>';
            return;
        }
        var linhas = lista.map(function (c) {
            return '<tr>' +
                '<td><strong>#' + c.id + '</strong></td>' +
                '<td>' + P.escHtml(c.tipo_movimento_nome || '-') + '</td>' +
                '<td>' + P.escHtml(c.nm_paciente || '-') + (c.leito_origem ? '<br><small style="color:#aaa;">Leito ' + P.escHtml(c.leito_origem) + '</small>' : '') + '</td>' +
                '<td>' + P.escHtml(c.setor_origem_nome || '-') + '</td>' +
                '<td><strong>' + P.escHtml(c.destino_nome || '-') + '</strong></td>' +
                '<td>' + P.badgeStatus(c.status) + (c.prioridade === 'urgente' ? ' <span class="badge-urgente">URGENTE</span>' : '') + '</td>' +
                '<td>' + (c.padioleiro_nome ? P.escHtml(c.padioleiro_nome) : '<span style="color:#aaa;">--</span>') + '</td>' +
                '<td>' + P.min(c.minutos_espera) + '</td>' +
                '<td><button class="btn-cancelar-gestao" data-id="' + c.id + '" style="background:transparent;border:none;color:var(--danger);cursor:pointer;" title="Cancelar"><i class="fas fa-times"></i></button></td>' +
            '</tr>';
        }).join('');
        wrapper.innerHTML =
            '<div class="tabela-wrapper"><table class="tabela"><thead><tr>' +
            '<th>#</th><th>Tipo</th><th>Paciente</th><th>Setor Origem</th><th>Destino</th><th>Status</th><th>Padioleiro</th><th>Espera</th><th>Ações</th>' +
            '</tr></thead><tbody>' + linhas + '</tbody></table></div>';
        wrapper.querySelectorAll('.btn-cancelar-gestao').forEach(function (btn) {
            btn.addEventListener('click', function () { P.abrirModalCancelarGestao(parseInt(btn.dataset.id)); });
        });
    }

    window.P36.carregarDashboard = carregarDashboard;

})();
