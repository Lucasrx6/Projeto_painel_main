(function () {
    'use strict';

    function carregarDashboard() {
        var CONFIG = window.P43.CONFIG;
        Promise.all([
            fetch(CONFIG.apiBase + '/dashboard',       { credentials: 'same-origin' }).then(function (r) { return r.json(); }),
            fetch(CONFIG.apiBase + '/por-dieta?dias=1',{ credentials: 'same-origin' }).then(function (r) { return r.json(); }),
            fetch(CONFIG.apiBase + '/por-setor?dias=1',{ credentials: 'same-origin' }).then(function (r) { return r.json(); }),
            fetch(CONFIG.apiBase + '/por-hora?dias=1', { credentials: 'same-origin' }).then(function (r) { return r.json(); })
        ])
        .then(function (results) {
            if (results[0].success) renderKPIs(results[0].resumo, results[0].ativos);
            if (results[1].success) renderGraficoDieta(results[1].dados);
            if (results[2].success) renderGraficoSetor(results[2].dados);
            if (results[3].success) renderGraficoHora(results[3].dados);
        })
        .catch(function (e) { console.error('dashboard', e); });
    }

    function renderKPIs(r, ativos) {
        var escHtml     = window.P43.escHtml;
        var fmtMin      = window.P43.fmtMin;
        var badgeStatus = window.P43.badgeStatus;

        var kpis = [
            { label: 'Total Hoje',     val: r.total || 0,         cor: '#9B1C24', icone: 'fa-utensils' },
            { label: 'Entregues',      val: r.entregues || 0,     cor: '#28A745', icone: 'fa-check-circle' },
            { label: 'Cancelados',     val: r.cancelados || 0,    cor: '#DC3545', icone: 'fa-times-circle' },
            { label: 'Em Aberto',      val: r.em_aberto || 0,     cor: '#17A2B8', icone: 'fa-clock' },
            { label: 'Urgentes',       val: r.urgentes || 0,      cor: '#FF5722', icone: 'fa-exclamation-circle' },
            { label: 'T.Médio Total',  val: r.media_min_total  != null ? fmtMin(r.media_min_total)  : '--', cor: '#6C757D', icone: 'fa-stopwatch' },
            { label: 'T.Médio Aceite', val: r.media_min_aceite != null ? fmtMin(r.media_min_aceite) : '--', cor: '#6C757D', icone: 'fa-hourglass-half' }
        ];
        var html = '';
        for (var i = 0; i < kpis.length; i++) {
            var k = kpis[i];
            html += '<div class="stat-card" style="border-top:3px solid ' + k.cor + ';">' +
                '<div class="stat-icone" style="color:' + k.cor + ';"><i class="fas ' + k.icone + '"></i></div>' +
                '<div class="stat-num" style="color:' + k.cor + ';">' + escHtml(String(k.val)) + '</div>' +
                '<div class="stat-label">' + escHtml(k.label) + '</div>' +
            '</div>';
        }
        document.getElementById('stats-grid').innerHTML = html;

        var tbody = document.getElementById('tbody-ativos');
        var empty = document.getElementById('ativos-empty');
        if (!ativos || !ativos.length) {
            tbody.innerHTML = '';
            empty.style.display = 'block';
            return;
        }
        empty.style.display = 'none';
        var rows = '';
        for (var j = 0; j < ativos.length; j++) {
            var a = ativos[j];
            rows += '<tr>' +
                '<td><span class="cod-mini">' + escHtml(a.codigo_entrega) + '</span></td>' +
                '<td>' + escHtml(a.nm_paciente) + '</td>' +
                '<td>' + escHtml(a.leito || '--') + '</td>' +
                '<td>' + escHtml(a.tipo_dieta_nome || '--') + '</td>' +
                '<td>' + escHtml(a.refeicao_nome || '--') + '</td>' +
                '<td>' + (a.prioridade === 'urgente' ? '<span class="badge-urg">URG</span>' : 'Normal') + '</td>' +
                '<td>' + badgeStatus(a.status) + '</td>' +
                '<td>' + escHtml(a.responsavel_nome || '--') + '</td>' +
                '<td>' + fmtMin(a.minutos_espera || 0) + '</td>' +
                '<td><button class="btn-canc-mini" data-id="' + a.id + '" data-desc="' + escHtml(a.nm_paciente) + '">' +
                    '<i class="fa-solid fa-ban"></i></button></td>' +
            '</tr>';
        }
        tbody.innerHTML = rows;

        var btns = tbody.querySelectorAll('.btn-canc-mini');
        for (var k = 0; k < btns.length; k++) {
            btns[k].addEventListener('click', function () {
                abrirModalCancelAtivo(this.getAttribute('data-id'), this.getAttribute('data-desc'));
            });
        }
    }

    // ── Gráficos CSS ──────────────────────────────────────────────────────────

    function renderGraficoDieta(dados) {
        renderBarras('grafico-dieta', dados, 'tipo_dieta_nome', '#9B1C24');
    }

    function renderGraficoSetor(dados) {
        renderBarras('grafico-setor', dados.slice(0, 8), 'setor', '#17A2B8');
    }

    function renderBarras(elId, dados, campoLabel, cor) {
        var escHtml = window.P43.escHtml;
        var el = document.getElementById(elId);
        if (!el) return;
        if (!dados || !dados.length) { el.innerHTML = '<div class="grafico-empty">Sem dados</div>'; return; }
        var max = 1;
        for (var i = 0; i < dados.length; i++) {
            if (dados[i].total > max) max = dados[i].total;
        }
        var html = '';
        for (var j = 0; j < dados.length; j++) {
            var d   = dados[j];
            var pct = Math.round(d.total / max * 100);
            html += '<div class="barra-linha">' +
                '<div class="barra-label">' + escHtml(d[campoLabel] || '--') + '</div>' +
                '<div class="barra-fundo">' +
                    '<div class="barra-fill" style="width:' + pct + '%;background:' + cor + ';"></div>' +
                '</div>' +
                '<div class="barra-num">' + d.total + '</div>' +
            '</div>';
        }
        el.innerHTML = html;
    }

    function renderGraficoHora(dados) {
        var el = document.getElementById('grafico-hora');
        if (!el) return;
        if (!dados || !dados.length) { el.innerHTML = '<div class="grafico-empty">Sem dados</div>'; return; }
        var max = 1;
        for (var i = 0; i < dados.length; i++) {
            if (dados[i].total > max) max = dados[i].total;
        }
        var horaMap = {};
        for (var j = 0; j < dados.length; j++) horaMap[dados[j].hora] = dados[j].total;
        var html = '';
        for (var h = 0; h < 24; h++) {
            var v   = horaMap[h] || 0;
            var pct = v > 0 ? Math.round(v / max * 100) : 0;
            html += '<div class="hora-col">' +
                '<div class="hora-bar" style="height:' + pct + '%;background:#9B1C24;"></div>' +
                '<div class="hora-label">' + (h < 10 ? '0' : '') + h + 'h</div>' +
            '</div>';
        }
        el.innerHTML = html;
    }

    // ── Modal cancelar solicitação ativa ──────────────────────────────────────

    function abrirModalCancelAtivo(sid, desc) {
        document.getElementById('canc-ativo-sid').value        = sid;
        document.getElementById('canc-ativo-desc').textContent = desc;
        document.getElementById('canc-ativo-motivo').value     = '';
        document.getElementById('canc-ativo-erro').style.display = 'none';
        document.getElementById('modal-canc-ativo').style.display = 'flex';
    }

    function confirmarCancelAativo() {
        var sid    = document.getElementById('canc-ativo-sid').value;
        var motivo = document.getElementById('canc-ativo-motivo').value.trim();
        if (motivo.length < 10) {
            document.getElementById('canc-ativo-erro').textContent = 'Motivo deve ter pelo menos 10 caracteres.';
            document.getElementById('canc-ativo-erro').style.display = 'block';
            return;
        }
        fetch(window.P43.CONFIG.apiBase + '/solicitacoes/' + sid + '/cancelar', {
            method: 'PUT',
            credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ motivo: motivo })
        })
        .then(function (r) { return r.json(); })
        .then(function (data) {
            if (data.success) {
                document.getElementById('modal-canc-ativo').style.display = 'none';
                carregarDashboard();
            } else {
                document.getElementById('canc-ativo-erro').textContent = data.error || 'Erro.';
                document.getElementById('canc-ativo-erro').style.display = 'block';
            }
        })
        .catch(function () {
            document.getElementById('canc-ativo-erro').textContent = 'Falha na conexão.';
            document.getElementById('canc-ativo-erro').style.display = 'block';
        });
    }

    window.P43.carregarDashboard     = carregarDashboard;
    window.P43.renderBarras          = renderBarras;
    window.P43.confirmarCancelAativo = confirmarCancelAativo;

})();
