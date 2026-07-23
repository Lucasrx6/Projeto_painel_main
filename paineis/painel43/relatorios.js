(function () {
    'use strict';

    var _dietasFiltroCarregadas = false;

    // ── Helpers de data ───────────────────────────────────────────────────────

    function _parseDateBR(str) {
        if (!str || str.length < 10) return '';
        var parts = str.split('/');
        if (parts.length !== 3 || parts[2].length < 4) return '';
        return parts[2] + '-' + parts[1] + '-' + parts[0];
    }

    function _mascaraData(id) {
        var inp = document.getElementById(id);
        if (!inp) return;
        inp.addEventListener('input', function () {
            var v = this.value.replace(/\D/g, '');
            if (v.length > 8) v = v.slice(0, 8);
            if (v.length > 4)      v = v.slice(0, 2) + '/' + v.slice(2, 4) + '/' + v.slice(4);
            else if (v.length > 2) v = v.slice(0, 2) + '/' + v.slice(2);
            this.value = v;
        });
    }

    function initRelDatas() {
        var hoje = new Date();
        var ini  = new Date(hoje);
        ini.setDate(ini.getDate() - 30);
        var fmtBR = function (d) {
            return ('0' + d.getDate()).slice(-2) + '/' + ('0' + (d.getMonth() + 1)).slice(-2) + '/' + d.getFullYear();
        };
        var di = document.getElementById('rel-data-inicio');
        var df = document.getElementById('rel-data-fim');
        if (di && !di.value) di.value = fmtBR(ini);
        if (df && !df.value) df.value = fmtBR(hoje);
        _mascaraData('rel-data-inicio');
        _mascaraData('rel-data-fim');
    }

    function _buildRelQueryParams() {
        var diRaw = (document.getElementById('rel-data-inicio') || {}).value || '';
        var dfRaw = (document.getElementById('rel-data-fim')    || {}).value || '';
        var di = _parseDateBR(diRaw);
        var df = _parseDateBR(dfRaw);
        if (di && df) return 'data_inicio=' + encodeURIComponent(di) + '&data_fim=' + encodeURIComponent(df);
        return 'dias=30';
    }

    function _getRelFiltros() {
        return {
            status: (document.getElementById('rel-fil-status') || {}).value || '',
            dieta:  (document.getElementById('rel-fil-dieta')  || {}).value || '',
            setor:  (document.getElementById('rel-fil-setor')  || {}).value || ''
        };
    }

    // ── Filtro de dieta (carregado uma vez ao entrar em Relatórios) ───────────

    function carregarDietasFiltro() {
        if (_dietasFiltroCarregadas) return;
        fetch(window.P43.CONFIG.apiBase + '/config/tipos-dieta', { credentials: 'same-origin' })
            .then(function (r) { return r.json(); })
            .then(function (data) {
                if (!data.success) return;
                var sel = document.getElementById('rel-fil-dieta');
                if (!sel) return;
                for (var i = 0; i < data.dados.length; i++) {
                    var opt = document.createElement('option');
                    opt.value       = data.dados[i].id;
                    opt.textContent = data.dados[i].nome;
                    sel.appendChild(opt);
                }
                _dietasFiltroCarregadas = true;
            })
            .catch(function () {});
    }

    // ── Abas de relatório ─────────────────────────────────────────────────────

    function trocarRelAba(aba) {
        window.P43.Estado.relAbaAtiva = aba;
        var btns = document.querySelectorAll('[data-relaba]');
        for (var i = 0; i < btns.length; i++) {
            btns[i].className = 'rel-aba' + (btns[i].getAttribute('data-relaba') === aba ? ' rel-aba-ativa' : '');
        }
        var subs = ['resumo', 'historico', 'por-refeicao', 'por-setor', 'por-responsavel', 'assinaturas'];
        for (var j = 0; j < subs.length; j++) {
            var el = document.getElementById('rel-' + subs[j]);
            if (el) el.style.display = (subs[j] === aba) ? '' : 'none';
        }
        var extras = document.querySelectorAll('.rel-filtro-extra');
        for (var k = 0; k < extras.length; k++) {
            extras[k].style.display = (aba === 'historico') ? '' : 'none';
        }
        carregarRelAbaAtiva();
    }

    function carregarRelatorios() { carregarRelAbaAtiva(); }

    function carregarRelAbaAtiva() {
        var aba = window.P43.Estado.relAbaAtiva;
        if (aba === 'resumo')               carregarRelResumo();
        else if (aba === 'historico')       carregarHistorico();
        else if (aba === 'por-refeicao')    carregarRelPorRefeicao();
        else if (aba === 'por-setor')       carregarRelPorSetor();
        else if (aba === 'por-responsavel') carregarRelPorResponsavel();
        else if (aba === 'assinaturas')     carregarRelAssinaturas();
    }

    // ── Helper genérico de tabela ─────────────────────────────────────────────

    function _renderTabelaRel(tbodyId, dados, cols, ncols) {
        var escHtml = window.P43.escHtml;
        var fmtMin  = window.P43.fmtMin;
        var el = document.getElementById(tbodyId);
        if (!el) return;
        if (!dados || !dados.length) {
            el.innerHTML = '<tr><td colspan="' + ncols + '" class="tabela-vazio">Sem dados</td></tr>';
            return;
        }
        var html = '';
        for (var k = 0; k < dados.length; k++) {
            var d = dados[k];
            html += '<tr>';
            for (var c = 0; c < cols.length; c++) {
                var v   = d[cols[c]];
                var cel = (v != null && cols[c].indexOf('_min') >= 0)
                    ? fmtMin(v)
                    : escHtml(v != null ? String(v) : '--');
                html += '<td>' + cel + '</td>';
            }
            html += '</tr>';
        }
        el.innerHTML = html;
    }

    // ── Carregadores de cada sub-aba ──────────────────────────────────────────

    function carregarRelResumo() {
        var q      = _buildRelQueryParams();
        var CONFIG = window.P43.CONFIG;
        var map = [
            { ep: 'por-refeicao',    id: 'tbody-refeicao',    cols: ['refeicao_nome','total','entregues','cancelados','urgentes','media_min'] },
            { ep: 'por-dieta',       id: 'tbody-dieta',       cols: ['tipo_dieta_nome','total','entregues','cancelados','urgentes','media_min'] },
            { ep: 'por-setor',       id: 'tbody-setor',       cols: ['setor','total','entregues','cancelados','urgentes'] },
            { ep: 'por-responsavel', id: 'tbody-responsavel', cols: ['responsavel_nome','total','entregues','cancelados','media_min_total'] }
        ];
        for (var i = 0; i < map.length; i++) {
            (function (m) {
                fetch(CONFIG.apiBase + '/' + m.ep + '?' + q, { credentials: 'same-origin' })
                    .then(function (r) { return r.json(); })
                    .then(function (data) {
                        if (data.success) _renderTabelaRel(m.id, data.dados, m.cols, m.cols.length);
                    })
                    .catch(function (e) { console.error(m.ep, e); });
            })(map[i]);
        }
    }

    function carregarHistorico() {
        var escHtml     = window.P43.escHtml;
        var fmtMin      = window.P43.fmtMin;
        var badgeStatus = window.P43.badgeStatus;
        var CONFIG      = window.P43.CONFIG;

        var q = _buildRelQueryParams();
        var f = _getRelFiltros();
        if (f.status) q += '&status='        + encodeURIComponent(f.status);
        if (f.dieta)  q += '&tipo_dieta_id=' + encodeURIComponent(f.dieta);
        if (f.setor)  q += '&setor='         + encodeURIComponent(f.setor);

        var tbody = document.getElementById('tbody-historico');
        var empty = document.getElementById('hist-empty');
        var count = document.getElementById('hist-count');
        if (empty) empty.style.display = 'none';
        tbody.innerHTML = '<tr><td colspan="11" class="tabela-vazio"><i class="fas fa-spinner fa-spin"></i> Carregando...</td></tr>';

        fetch(CONFIG.apiBase + '/solicitacoes?' + q, { credentials: 'same-origin' })
            .then(function (r) { return r.json(); })
            .then(function (data) {
                if (!data.success) {
                    tbody.innerHTML = '<tr><td colspan="11" class="tabela-vazio">Erro ao carregar dados.</td></tr>';
                    return;
                }
                var rows = data.solicitacoes || [];
                if (count) count.textContent = rows.length + ' registro(s)';
                if (!rows.length) {
                    tbody.innerHTML = '';
                    if (empty) empty.style.display = 'block';
                    return;
                }
                var html = '';
                for (var i = 0; i < rows.length; i++) {
                    var r = rows[i];
                    html += '<tr>' +
                        '<td><span class="cod-mini">' + escHtml(r.codigo_entrega || '--') + '</span></td>' +
                        '<td style="white-space:nowrap;">' + escHtml(r.criado_em || '--') + '</td>' +
                        '<td>' + escHtml(r.nm_paciente || '--') + '</td>' +
                        '<td>' + escHtml(r.leito || '--') + '</td>' +
                        '<td>' + escHtml(r.setor_nome || '--') + '</td>' +
                        '<td>' + escHtml(r.tipo_dieta_nome || '--') + '</td>' +
                        '<td>' + escHtml(r.refeicao_nome || '--') + '</td>' +
                        '<td>' + (r.prioridade === 'urgente' ? '<span class="badge-urg">URG</span>' : '<span style="color:#6c757d;">Normal</span>') + '</td>' +
                        '<td>' + badgeStatus(r.status) + '</td>' +
                        '<td>' + escHtml(r.responsavel_nome || '--') + '</td>' +
                        '<td>' + (r.t_total_min != null ? fmtMin(r.t_total_min) : '--') + '</td>' +
                    '</tr>';
                }
                tbody.innerHTML = html;
            })
            .catch(function (e) {
                console.error('historico', e);
                tbody.innerHTML = '<tr><td colspan="11" class="tabela-vazio">Erro ao carregar.</td></tr>';
            });
    }

    function carregarRelPorRefeicao() {
        var q = _buildRelQueryParams();
        fetch(window.P43.CONFIG.apiBase + '/por-refeicao?' + q, { credentials: 'same-origin' })
            .then(function (r) { return r.json(); })
            .then(function (data) {
                if (!data.success) return;
                window.P43.renderBarras('rel-grafico-refeicao', data.dados, 'refeicao_nome', '#9B1C24');
                _renderTabelaRel('tbody-rel-refeicao', data.dados,
                    ['refeicao_nome','total','entregues','cancelados','urgentes','media_min'], 6);
            })
            .catch(function (e) { console.error('rel-refeicao', e); });
    }

    function carregarRelPorSetor() {
        var q = _buildRelQueryParams();
        fetch(window.P43.CONFIG.apiBase + '/por-setor?' + q, { credentials: 'same-origin' })
            .then(function (r) { return r.json(); })
            .then(function (data) {
                if (!data.success) return;
                window.P43.renderBarras('rel-grafico-setor', data.dados.slice(0, 12), 'setor', '#17A2B8');
                _renderTabelaRel('tbody-rel-setor', data.dados,
                    ['setor','total','entregues','cancelados','urgentes'], 5);
            })
            .catch(function (e) { console.error('rel-setor', e); });
    }

    function carregarRelPorResponsavel() {
        var q = _buildRelQueryParams();
        fetch(window.P43.CONFIG.apiBase + '/por-responsavel?' + q, { credentials: 'same-origin' })
            .then(function (r) { return r.json(); })
            .then(function (data) {
                if (!data.success) return;
                _renderTabelaRel('tbody-rel-responsavel', data.dados,
                    ['responsavel_nome','total','entregues','cancelados','media_min_total','media_min_espera_preparo'], 6);
            })
            .catch(function (e) { console.error('rel-responsavel', e); });
    }

    function carregarRelAssinaturas() {
        var escHtml = window.P43.escHtml;
        var CONFIG  = window.P43.CONFIG;
        var q         = _buildRelQueryParams();
        var setor     = (document.getElementById('rel-assin-setor')      || {}).value   || '';
        var apenasSem = (document.getElementById('rel-assin-apenas-sem') || {}).checked;
        if (setor)     q += '&setor='      + encodeURIComponent(setor);
        if (apenasSem) q += '&apenas_sem=1';

        var tbody = document.getElementById('tbody-rel-assinaturas');
        var empty = document.getElementById('rel-assin-empty');
        var count = document.getElementById('rel-assin-count');
        var kpis  = document.getElementById('rel-assin-kpis');
        if (empty) empty.style.display = 'none';
        if (tbody) tbody.innerHTML = '<tr><td colspan="10" class="tabela-vazio"><i class="fas fa-spinner fa-spin"></i> Carregando...</td></tr>';

        fetch(CONFIG.apiBase + '/rel-assinaturas?' + q, { credentials: 'same-origin' })
            .then(function (r) { return r.json(); })
            .then(function (data) {
                if (!data.success) {
                    if (data.migration_pendente) {
                        var aviso = '<div style="background:#fff3cd;border:1px solid #ffc107;border-radius:8px;padding:14px 18px;margin:12px 0;color:#856404;">' +
                            '<i class="fas fa-triangle-exclamation"></i> <strong>Migração pendente:</strong> ' +
                            escHtml(data.error || '') + '</div>';
                        if (kpis)  kpis.innerHTML  = aviso;
                        if (tbody) tbody.innerHTML = '';
                    } else {
                        if (tbody) tbody.innerHTML = '<tr><td colspan="10" class="tabela-vazio">Erro ao carregar dados.</td></tr>';
                        if (kpis)  kpis.innerHTML  = '';
                    }
                    return;
                }

                var res    = data.resumo || {};
                var total  = Number(res.total || 0);
                var comAss = Number(res.com_assinatura || 0);
                var semAss = Number(res.sem_assinatura || 0);
                var pct    = total > 0 ? Math.round(comAss / total * 100) : 0;
                if (kpis) {
                    kpis.innerHTML =
                        '<div class="assin-kpi assin-kpi-total"><div class="assin-kpi-num">' + total  + '</div><div class="assin-kpi-label">Total Entregues</div></div>' +
                        '<div class="assin-kpi assin-kpi-ok"   ><div class="assin-kpi-num">' + comAss + '</div><div class="assin-kpi-label">Com Assinatura</div></div>' +
                        '<div class="assin-kpi assin-kpi-pend" ><div class="assin-kpi-num">' + semAss + '</div><div class="assin-kpi-label">Sem Assinatura</div></div>' +
                        '<div class="assin-kpi assin-kpi-pct"  ><div class="assin-kpi-num">' + pct + '%</div><div class="assin-kpi-label">Cobertura</div></div>';
                }

                var registros = data.registros || [];
                if (count) count.textContent = registros.length + ' registro(s)';
                if (!registros.length) {
                    if (tbody) tbody.innerHTML = '';
                    if (empty) empty.style.display = 'block';
                    return;
                }

                var QUALIDADE = { paciente: 'Paciente', familiar: 'Familiar', responsavel_legal: 'Resp. Legal' };
                var html = '';
                for (var i = 0; i < registros.length; i++) {
                    var reg       = registros[i];
                    var badgeAssin = reg.tem_assinatura
                        ? '<span class="badge-assin badge-assin-sim"><i class="fas fa-check"></i> Sim</span>'
                        : '<span class="badge-assin badge-assin-nao"><i class="fas fa-times"></i> Não</span>';
                    var qualLabel = reg.qualidade_signatario ? (QUALIDADE[reg.qualidade_signatario] || reg.qualidade_signatario) : '';
                    html += '<tr' + (reg.tem_assinatura ? '' : ' class="linha-sem-assin"') + '>' +
                        '<td><span class="cod-mini">' + escHtml(reg.codigo_entrega || '--') + '</span></td>' +
                        '<td style="white-space:nowrap;">' + escHtml(reg.dt_entrega || '--') + '</td>' +
                        '<td>' + escHtml(reg.nm_paciente || '--') + '</td>' +
                        '<td>' + escHtml((reg.leito || '--') + ' / ' + (reg.setor_nome || '--')) + '</td>' +
                        '<td>' + escHtml((reg.tipo_dieta_nome || '--') + ' — ' + (reg.refeicao_nome || '--')) + '</td>' +
                        '<td>' + escHtml(reg.responsavel_nome || '--') + '</td>' +
                        '<td style="text-align:center;">' + badgeAssin + '</td>' +
                        '<td>' + (reg.nm_signatario ? escHtml(reg.nm_signatario) + (qualLabel ? ' <span class="badge-qual-mini">' + escHtml(qualLabel) + '</span>' : '') : '--') + '</td>' +
                        '<td style="white-space:nowrap;">' + escHtml(reg.nm_signatario_cpf || '--') + '</td>' +
                        '<td>' + escHtml(reg.coletado_por_nome_equipe || '--') + '</td>' +
                    '</tr>';
                }
                if (tbody) tbody.innerHTML = html;
            })
            .catch(function (e) {
                console.error('rel-assinaturas', e);
                if (tbody) tbody.innerHTML = '<tr><td colspan="10" class="tabela-vazio">Erro ao carregar.</td></tr>';
            });
    }

    // ── Exportar CSV ──────────────────────────────────────────────────────────

    function exportarCSV() {
        var q      = _buildRelQueryParams();
        var f      = _getRelFiltros();
        var CONFIG = window.P43.CONFIG;
        var abaAtiva = window.P43.Estado.relAbaAtiva;

        if (abaAtiva === 'assinaturas') {
            var setor     = (document.getElementById('rel-assin-setor')      || {}).value   || '';
            var apenasSem = (document.getElementById('rel-assin-apenas-sem') || {}).checked ? '1' : '0';
            if (setor)            q += '&setor='      + encodeURIComponent(setor);
            if (apenasSem === '1') q += '&apenas_sem=1';
            window.location.href = CONFIG.apiBase + '/rel-assinaturas/exportar?' + q;
            return;
        }
        if (abaAtiva === 'historico') {
            if (f.status) q += '&status='        + encodeURIComponent(f.status);
            if (f.dieta)  q += '&tipo_dieta_id=' + encodeURIComponent(f.dieta);
            if (f.setor)  q += '&setor='         + encodeURIComponent(f.setor);
        }
        window.location.href = CONFIG.apiBase + '/exportar?' + q;
    }

    window.P43.initRelDatas         = initRelDatas;
    window.P43.carregarDietasFiltro = carregarDietasFiltro;
    window.P43.trocarRelAba         = trocarRelAba;
    window.P43.carregarRelatorios   = carregarRelatorios;
    window.P43.carregarRelAbaAtiva  = carregarRelAbaAtiva;
    window.P43.exportarCSV          = exportarCSV;

})();
