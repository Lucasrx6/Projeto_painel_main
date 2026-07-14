var PAINEL_VERSAO = '1.0.28';
(function () {
    'use strict';

    var CONFIG = {
        apiBase: '/api/paineis/painel43',
        refreshDash: 60000
    };

    var Estado = {
        abaAtiva: 'dashboard',
        subabaAtiva: 'equipe',
        relAbaAtiva: 'resumo',
        // dados config
        equipe: [], tiposDieta: [], refeicoes: [], restricoes: [],
        // form modal
        formRecurso: null, formId: null, formOnSave: null
    };

    var DOM = {};

    // =========================================================
    // ESCAPE HTML / TEMPO
    // =========================================================
    function escHtml(s) {
        return String(s || '')
            .replace(/&/g, '&amp;').replace(/</g, '&lt;')
            .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    function fmtMin(n) {
        var total = Math.round(Number(n) || 0);
        if (total <= 0) return '0min';
        if (total < 60) return total + 'min';
        var h = Math.floor(total / 60);
        var m = total % 60;
        return m > 0 ? (h + 'h ' + m + 'min') : (h + 'h');
    }

    var STATUS_COR = {
        aguardando: '#6C757D', aceito: '#17A2B8', em_preparo: '#E67E00',
        pronto: '#8BC34A', em_entrega: '#6F42C1', entregue: '#28A745', cancelado: '#DC3545'
    };
    var STATUS_LABEL = {
        aguardando: 'Aguardando', aceito: 'Aceito', em_preparo: 'Em Preparo',
        pronto: 'Pronto', em_entrega: 'Em Entrega', entregue: 'Entregue', cancelado: 'Cancelado'
    };

    function badgeStatus(status) {
        var cor   = STATUS_COR[status]   || '#6C757D';
        var label = STATUS_LABEL[status] || status;
        return '<span class="badge-st" style="background:' + cor + ';">' + escHtml(label) + '</span>';
    }

    // =========================================================
    // INICIALIZAR
    // =========================================================
    function inicializar() {
        var btnVoltar = document.getElementById('btn-voltar-hub');
        if (btnVoltar) {
            btnVoltar.addEventListener('click', function () { window.location.href = '/painel/painel44'; });
        }

        // Abas principais
        var abaBtns = document.querySelectorAll('.aba');
        for (var i = 0; i < abaBtns.length; i++) {
            abaBtns[i].addEventListener('click', function () {
                trocarAba(this.getAttribute('data-aba'));
            });
        }

        // Sub-abas config
        var subabaBtns = document.querySelectorAll('.sub-aba');
        for (var j = 0; j < subabaBtns.length; j++) {
            subabaBtns[j].addEventListener('click', function () {
                trocarSubaba(this.getAttribute('data-subaba'));
            });
        }

        // Aba Etiqueta só para admins — verifica pelo endpoint dedicado
        fetch(CONFIG.apiBase + '/etiqueta-admin-check', { credentials: 'same-origin' })
            .then(function (r) {
                if (r.status === 403) {
                    var btnEtq = document.querySelector('.sub-aba[data-subaba="etiqueta"]');
                    if (btnEtq) btnEtq.style.display = 'none';
                }
            })
            .catch(function () {});

        // Header
        var btnRefresh = document.getElementById('btn-refresh');
        if (btnRefresh) btnRefresh.addEventListener('click', carregarDashboard);

        // Dashboard
        document.getElementById('btn-refresh-dash').addEventListener('click', carregarDashboard);

        // Relatórios
        document.getElementById('btn-filtrar').addEventListener('click', carregarRelAbaAtiva);
        document.getElementById('btn-exportar').addEventListener('click', exportarCSV);

        var relAbaBtns = document.querySelectorAll('[data-relaba]');
        for (var ri = 0; ri < relAbaBtns.length; ri++) {
            relAbaBtns[ri].addEventListener('click', function () {
                trocarRelAba(this.getAttribute('data-relaba'));
            });
        }
        _initRelDatas();

        // Config: botões add
        document.getElementById('btn-add-equipe').addEventListener('click', function () {
            abrirFormNovo('equipe');
        });
        document.getElementById('btn-add-tipo-dieta').addEventListener('click', function () {
            abrirFormNovo('tipos-dieta');
        });
        document.getElementById('btn-add-refeicao').addEventListener('click', function () {
            abrirFormNovo('refeicoes');
        });
        document.getElementById('btn-add-restricao').addEventListener('click', function () {
            abrirFormNovo('restricoes');
        });

        // Modal form
        document.getElementById('btn-form-fechar').addEventListener('click', fecharModalForm);
        document.getElementById('btn-form-salvar').addEventListener('click', salvarForm);
        var btnFecharX = document.getElementById('btn-fechar-modal-form');
        if (btnFecharX) btnFecharX.addEventListener('click', fecharModalForm);
        document.getElementById('modal-form').addEventListener('click', function (e) {
            if (e.target === this) fecharModalForm();
        });

        // Modal cancelar ativo
        document.getElementById('btn-canc-ativo-conf').addEventListener('click', confirmarCancelAativo);
        document.getElementById('btn-canc-ativo-fech').addEventListener('click', function () {
            document.getElementById('modal-canc-ativo').style.display = 'none';
        });

        // Etiqueta config
        document.getElementById('btn-salvar-etiqueta').addEventListener('click', salvarEtiqueta);
        document.getElementById('etq-modo').addEventListener('change', _toggleEtiquetaGrupos);
        document.getElementById('btn-padrao-pdf').addEventListener('click', function () {
            document.getElementById('etq-pdf').value = _PDF_TEMPLATE_PADRAO;
            _atualizarPreview();
        });
        document.getElementById('etq-pdf').addEventListener('input', function () {
            clearTimeout(_previewTimer);
            _previewTimer = setTimeout(_atualizarPreview, 450);
        });
        document.getElementById('btn-visualizar-zpl').addEventListener('click', _atualizarPreviewZPL);
        document.getElementById('btn-padrao-zpl').addEventListener('click', function () {
            document.getElementById('etq-zpl').value = _ZPL_TEMPLATE_PADRAO;
            _atualizarPreviewZPL();
        });

        carregarDashboard();
        setInterval(carregarDashboard, CONFIG.refreshDash);
    }

    // =========================================================
    // NAVEGAÇÃO
    // =========================================================
    function trocarAba(aba) {
        Estado.abaAtiva = aba;
        var btns = document.querySelectorAll('.aba');
        for (var i = 0; i < btns.length; i++) {
            btns[i].className = 'aba' + (btns[i].getAttribute('data-aba') === aba ? ' aba-ativa' : '');
        }
        var conteudos = document.querySelectorAll('.aba-conteudo');
        for (var j = 0; j < conteudos.length; j++) {
            conteudos[j].style.display = (conteudos[j].id === 'aba-' + aba) ? 'flex' : 'none';
        }
        if (aba === 'relatorios') { carregarDietasFiltro(); carregarRelatorios(); }
        if (aba === 'configuracoes') carregarConfiguracoes();
    }

    function trocarSubaba(sub) {
        Estado.subabaAtiva = sub;
        var btns = document.querySelectorAll('.sub-aba');
        for (var i = 0; i < btns.length; i++) {
            btns[i].className = 'sub-aba' + (btns[i].getAttribute('data-subaba') === sub ? ' sub-aba-ativa' : '');
        }
        var conteudos = document.querySelectorAll('.sub-conteudo');
        for (var j = 0; j < conteudos.length; j++) {
            conteudos[j].style.display = (conteudos[j].id === 'subaba-' + sub) ? 'flex' : 'none';
        }
        carregarSubabaAtiva();
    }

    // =========================================================
    // DASHBOARD
    // =========================================================
    function carregarDashboard() {
        Promise.all([
            fetch(CONFIG.apiBase + '/dashboard', { credentials: 'same-origin' }).then(function (r) { return r.json(); }),
            fetch(CONFIG.apiBase + '/por-dieta?dias=1', { credentials: 'same-origin' }).then(function (r) { return r.json(); }),
            fetch(CONFIG.apiBase + '/por-setor?dias=1', { credentials: 'same-origin' }).then(function (r) { return r.json(); }),
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
        var kpis = [
            { label: 'Total Hoje',     val: r.total || 0,          cor: '#9B1C24', icone: 'fa-utensils' },
            { label: 'Entregues',      val: r.entregues || 0,      cor: '#28A745', icone: 'fa-check-circle' },
            { label: 'Cancelados',     val: r.cancelados || 0,     cor: '#DC3545', icone: 'fa-times-circle' },
            { label: 'Em Aberto',      val: r.em_aberto || 0,      cor: '#17A2B8', icone: 'fa-clock' },
            { label: 'Urgentes',       val: r.urgentes || 0,       cor: '#FF5722', icone: 'fa-exclamation-circle' },
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

        // Tabela ativos
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

    // =========================================================
    // GRÁFICOS CSS
    // =========================================================
    function renderGraficoDieta(dados) {
        renderBarras('grafico-dieta', dados, 'tipo_dieta_nome', '#9B1C24');
    }

    function renderGraficoSetor(dados) {
        renderBarras('grafico-setor', dados.slice(0, 8), 'setor', '#17A2B8');
    }

    function renderBarras(elId, dados, campoLabel, cor) {
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

    // =========================================================
    // RELATÓRIOS
    // =========================================================
    function _initRelDatas() {
        var hoje = new Date();
        var ini  = new Date(hoje);
        ini.setDate(ini.getDate() - 30);
        var fmt = function (d) {
            var y   = d.getFullYear();
            var m   = ('0' + (d.getMonth() + 1)).slice(-2);
            var dia = ('0' + d.getDate()).slice(-2);
            return y + '-' + m + '-' + dia;
        };
        var di = document.getElementById('rel-data-inicio');
        var df = document.getElementById('rel-data-fim');
        if (di && !di.value) di.value = fmt(ini);
        if (df && !df.value) df.value = fmt(hoje);
    }

    function _buildRelQueryParams() {
        var di = (document.getElementById('rel-data-inicio') || {}).value || '';
        var df = (document.getElementById('rel-data-fim')    || {}).value || '';
        if (di && df) {
            return 'data_inicio=' + encodeURIComponent(di) + '&data_fim=' + encodeURIComponent(df);
        }
        return 'dias=30';
    }

    function _getRelFiltros() {
        return {
            status: (document.getElementById('rel-fil-status') || {}).value || '',
            dieta:  (document.getElementById('rel-fil-dieta')  || {}).value || '',
            setor:  (document.getElementById('rel-fil-setor')  || {}).value || ''
        };
    }

    var _dietasFiltroCarregadas = false;
    function carregarDietasFiltro() {
        if (_dietasFiltroCarregadas) return;
        fetch(CONFIG.apiBase + '/config/tipos-dieta', { credentials: 'same-origin' })
            .then(function (r) { return r.json(); })
            .then(function (data) {
                if (!data.success) return;
                var sel = document.getElementById('rel-fil-dieta');
                if (!sel) return;
                for (var i = 0; i < data.dados.length; i++) {
                    var opt = document.createElement('option');
                    opt.value = data.dados[i].id;
                    opt.textContent = data.dados[i].nome;
                    sel.appendChild(opt);
                }
                _dietasFiltroCarregadas = true;
            })
            .catch(function () {});
    }

    function trocarRelAba(aba) {
        Estado.relAbaAtiva = aba;
        var btns = document.querySelectorAll('[data-relaba]');
        for (var i = 0; i < btns.length; i++) {
            btns[i].className = 'rel-aba' + (btns[i].getAttribute('data-relaba') === aba ? ' rel-aba-ativa' : '');
        }
        var subs = ['resumo', 'historico', 'por-refeicao', 'por-setor', 'por-responsavel'];
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
        var aba = Estado.relAbaAtiva;
        if (aba === 'resumo')              carregarRelResumo();
        else if (aba === 'historico')      carregarHistorico();
        else if (aba === 'por-refeicao')   carregarRelPorRefeicao();
        else if (aba === 'por-setor')      carregarRelPorSetor();
        else if (aba === 'por-responsavel') carregarRelPorResponsavel();
    }

    function _renderTabelaRel(tbodyId, dados, cols, ncols) {
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

    function carregarRelResumo() {
        var q = _buildRelQueryParams();
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
        fetch(CONFIG.apiBase + '/por-refeicao?' + q, { credentials: 'same-origin' })
            .then(function (r) { return r.json(); })
            .then(function (data) {
                if (!data.success) return;
                renderBarras('rel-grafico-refeicao', data.dados, 'refeicao_nome', '#9B1C24');
                _renderTabelaRel('tbody-rel-refeicao', data.dados,
                    ['refeicao_nome','total','entregues','cancelados','urgentes','media_min'], 6);
            })
            .catch(function (e) { console.error('rel-refeicao', e); });
    }

    function carregarRelPorSetor() {
        var q = _buildRelQueryParams();
        fetch(CONFIG.apiBase + '/por-setor?' + q, { credentials: 'same-origin' })
            .then(function (r) { return r.json(); })
            .then(function (data) {
                if (!data.success) return;
                renderBarras('rel-grafico-setor', data.dados.slice(0, 12), 'setor', '#17A2B8');
                _renderTabelaRel('tbody-rel-setor', data.dados,
                    ['setor','total','entregues','cancelados','urgentes'], 5);
            })
            .catch(function (e) { console.error('rel-setor', e); });
    }

    function carregarRelPorResponsavel() {
        var q = _buildRelQueryParams();
        fetch(CONFIG.apiBase + '/por-responsavel?' + q, { credentials: 'same-origin' })
            .then(function (r) { return r.json(); })
            .then(function (data) {
                if (!data.success) return;
                _renderTabelaRel('tbody-rel-responsavel', data.dados,
                    ['responsavel_nome','total','entregues','cancelados','media_min_total','media_min_espera_preparo'], 6);
            })
            .catch(function (e) { console.error('rel-responsavel', e); });
    }

    function exportarCSV() {
        var q = _buildRelQueryParams();
        var f = _getRelFiltros();
        if (Estado.relAbaAtiva === 'historico') {
            if (f.status) q += '&status='        + encodeURIComponent(f.status);
            if (f.dieta)  q += '&tipo_dieta_id=' + encodeURIComponent(f.dieta);
            if (f.setor)  q += '&setor='         + encodeURIComponent(f.setor);
        }
        window.location.href = CONFIG.apiBase + '/exportar?' + q;
    }

    // =========================================================
    // CANCELAR ATIVO (dashboard)
    // =========================================================
    function abrirModalCancelAtivo(sid, desc) {
        document.getElementById('canc-ativo-sid').value   = sid;
        document.getElementById('canc-ativo-desc').textContent = desc;
        document.getElementById('canc-ativo-motivo').value = '';
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
        fetch(CONFIG.apiBase + '/solicitacoes/' + sid + '/cancelar', {
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

    // =========================================================
    // CONFIGURAÇÕES
    // =========================================================
    function carregarConfiguracoes() {
        carregarSubabaAtiva();
    }

    function carregarSubabaAtiva() {
        var sub = Estado.subabaAtiva;
        if (sub === 'equipe')       carregarEquipe();
        if (sub === 'tipos-dieta')  carregarTiposDieta();
        if (sub === 'refeicoes')    carregarRefeicoes();
        if (sub === 'restricoes')   carregarRestricoes();
        if (sub === 'etiqueta')     carregarEtiqueta();
    }

    // --- Equipe ---
    function carregarEquipe() {
        fetch(CONFIG.apiBase + '/config/equipe', { credentials: 'same-origin' })
            .then(function (r) { return r.json(); })
            .then(function (data) {
                Estado.equipe = data.equipe || [];
                renderEquipe();
            });
    }

    function renderEquipe() {
        var html = '';
        for (var i = 0; i < Estado.equipe.length; i++) {
            var m = Estado.equipe[i];
            html += '<tr>' +
                '<td>' + escHtml(m.nome) + '</td>' +
                '<td>' + escHtml(m.matricula || '--') + '</td>' +
                '<td>' + escHtml(m.funcao) + '</td>' +
                '<td>' + escHtml(m.turno) + '</td>' +
                '<td>' + (m.ativo ? '<span class="tag-ativo">Ativo</span>' : '<span class="tag-inativo">Inativo</span>') + '</td>' +
                '<td style="white-space:nowrap;">' +
                    '<button class="btn-edit" data-recurso="equipe" data-id="' + m.id + '" title="Editar"><i class="fas fa-pen"></i></button> ' +
                    '<button class="btn-toggle-ativo ' + (m.ativo ? 'ativo' : 'inativo') + '" data-recurso="equipe" data-id="' + m.id + '" data-ativo="' + (m.ativo ? '1' : '0') + '" title="' + (m.ativo ? 'Inativar' : 'Ativar') + '">' +
                        '<i class="fas ' + (m.ativo ? 'fa-eye' : 'fa-eye-slash') + '"></i>' +
                    '</button>' +
                '</td>' +
            '</tr>';
        }
        document.getElementById('tbody-equipe').innerHTML = html || '<tr><td colspan="6" class="tabela-vazio">Nenhum membro cadastrado.</td></tr>';
        bindActionBtns();
    }

    // --- Tipos de Dieta ---
    function carregarTiposDieta() {
        fetch(CONFIG.apiBase + '/config/tipos-dieta', { credentials: 'same-origin' })
            .then(function (r) { return r.json(); })
            .then(function (data) {
                Estado.tiposDieta = data.dados || [];
                renderTiposDieta();
            });
    }

    function renderTiposDieta() {
        var html = '';
        for (var i = 0; i < Estado.tiposDieta.length; i++) {
            var t = Estado.tiposDieta[i];
            html += '<tr>' +
                '<td>' + escHtml(t.nome) + '</td>' +
                '<td><i class="fas ' + escHtml(t.icone) + '"></i> <code>' + escHtml(t.icone) + '</code></td>' +
                '<td><span class="dot-cor" style="background:' + escHtml(t.cor) + ';"></span> ' + escHtml(t.cor) + '</td>' +
                '<td>' + escHtml(String(t.ordem)) + '</td>' +
                '<td>' + (t.ativo ? '<span class="tag-ativo">Ativo</span>' : '<span class="tag-inativo">Inativo</span>') + '</td>' +
                '<td style="white-space:nowrap;">' +
                    '<button class="btn-edit" data-recurso="tipos-dieta" data-id="' + t.id + '" title="Editar"><i class="fas fa-pen"></i></button> ' +
                    '<button class="btn-toggle-ativo ' + (t.ativo ? 'ativo' : 'inativo') + '" data-recurso="tipos-dieta" data-id="' + t.id + '" data-ativo="' + (t.ativo ? '1' : '0') + '" title="' + (t.ativo ? 'Inativar' : 'Ativar') + '">' +
                        '<i class="fas ' + (t.ativo ? 'fa-eye' : 'fa-eye-slash') + '"></i>' +
                    '</button> ' +
                    '<button class="btn-deletar" data-recurso="tipos-dieta" data-id="' + t.id + '" data-nome="' + escHtml(t.nome) + '" title="Deletar"><i class="fas fa-trash"></i></button>' +
                '</td>' +
            '</tr>';
        }
        document.getElementById('tbody-tipos-dieta').innerHTML = html || '<tr><td colspan="6" class="tabela-vazio">Nenhum tipo cadastrado.</td></tr>';
        bindActionBtns();
    }

    // --- Refeições ---
    function carregarRefeicoes() {
        fetch(CONFIG.apiBase + '/config/refeicoes', { credentials: 'same-origin' })
            .then(function (r) { return r.json(); })
            .then(function (data) {
                Estado.refeicoes = data.dados || [];
                renderRefeicoes();
            });
    }

    function renderRefeicoes() {
        var html = '';
        for (var i = 0; i < Estado.refeicoes.length; i++) {
            var r = Estado.refeicoes[i];
            html += '<tr>' +
                '<td>' + escHtml(r.nome) + '</td>' +
                '<td>' + escHtml(r.horario_inicio || '--') + '</td>' +
                '<td>' + escHtml(r.horario_fim    || '--') + '</td>' +
                '<td><i class="fas ' + escHtml(r.icone) + '"></i></td>' +
                '<td>' + escHtml(String(r.ordem)) + '</td>' +
                '<td>' + (r.ativo ? '<span class="tag-ativo">Ativo</span>' : '<span class="tag-inativo">Inativo</span>') + '</td>' +
                '<td style="white-space:nowrap;">' +
                    '<button class="btn-edit" data-recurso="refeicoes" data-id="' + r.id + '" title="Editar"><i class="fas fa-pen"></i></button> ' +
                    '<button class="btn-toggle-ativo ' + (r.ativo ? 'ativo' : 'inativo') + '" data-recurso="refeicoes" data-id="' + r.id + '" data-ativo="' + (r.ativo ? '1' : '0') + '" title="' + (r.ativo ? 'Inativar' : 'Ativar') + '">' +
                        '<i class="fas ' + (r.ativo ? 'fa-eye' : 'fa-eye-slash') + '"></i>' +
                    '</button> ' +
                    '<button class="btn-deletar" data-recurso="refeicoes" data-id="' + r.id + '" data-nome="' + escHtml(r.nome) + '" title="Deletar"><i class="fas fa-trash"></i></button>' +
                '</td>' +
            '</tr>';
        }
        document.getElementById('tbody-refeicoes').innerHTML = html || '<tr><td colspan="7" class="tabela-vazio">Nenhuma refeição cadastrada.</td></tr>';
        bindActionBtns();
    }

    // --- Restrições ---
    function carregarRestricoes() {
        fetch(CONFIG.apiBase + '/config/restricoes', { credentials: 'same-origin' })
            .then(function (r) { return r.json(); })
            .then(function (data) {
                Estado.restricoes = data.dados || [];
                renderRestricoes();
            });
    }

    function renderRestricoes() {
        var html = '';
        for (var i = 0; i < Estado.restricoes.length; i++) {
            var r = Estado.restricoes[i];
            html += '<tr>' +
                '<td>' + escHtml(r.nome) + '</td>' +
                '<td><code>' + escHtml(r.sigla || '--') + '</code></td>' +
                '<td><i class="fas ' + escHtml(r.icone) + '"></i></td>' +
                '<td><span class="dot-cor" style="background:' + escHtml(r.cor) + ';"></span></td>' +
                '<td>' + escHtml(String(r.ordem)) + '</td>' +
                '<td>' + (r.ativo ? '<span class="tag-ativo">Ativo</span>' : '<span class="tag-inativo">Inativo</span>') + '</td>' +
                '<td style="white-space:nowrap;">' +
                    '<button class="btn-edit" data-recurso="restricoes" data-id="' + r.id + '" title="Editar"><i class="fas fa-pen"></i></button> ' +
                    '<button class="btn-toggle-ativo ' + (r.ativo ? 'ativo' : 'inativo') + '" data-recurso="restricoes" data-id="' + r.id + '" data-ativo="' + (r.ativo ? '1' : '0') + '" title="' + (r.ativo ? 'Inativar' : 'Ativar') + '">' +
                        '<i class="fas ' + (r.ativo ? 'fa-eye' : 'fa-eye-slash') + '"></i>' +
                    '</button> ' +
                    '<button class="btn-deletar" data-recurso="restricoes" data-id="' + r.id + '" data-nome="' + escHtml(r.nome) + '" title="Deletar"><i class="fas fa-trash"></i></button>' +
                '</td>' +
            '</tr>';
        }
        document.getElementById('tbody-restricoes').innerHTML = html || '<tr><td colspan="7" class="tabela-vazio">Nenhuma restrição cadastrada.</td></tr>';
        bindActionBtns();
    }

    function bindActionBtns() {
        var btnsEdit = document.querySelectorAll('.btn-edit');
        for (var i = 0; i < btnsEdit.length; i++) {
            btnsEdit[i].addEventListener('click', function () {
                abrirFormEdicao(this.getAttribute('data-recurso'), this.getAttribute('data-id'));
            });
        }
        var btnsToggle = document.querySelectorAll('.btn-toggle-ativo');
        for (var j = 0; j < btnsToggle.length; j++) {
            btnsToggle[j].addEventListener('click', function () {
                toggleAtivo(
                    this.getAttribute('data-recurso'),
                    this.getAttribute('data-id'),
                    this.getAttribute('data-ativo') === '1'
                );
            });
        }
        var btnsDel = document.querySelectorAll('.btn-deletar');
        for (var k = 0; k < btnsDel.length; k++) {
            btnsDel[k].addEventListener('click', function () {
                deletarItem(
                    this.getAttribute('data-recurso'),
                    this.getAttribute('data-id'),
                    this.getAttribute('data-nome')
                );
            });
        }
    }

    function toggleAtivo(recurso, id, ativoAtual) {
        var novoAtivo = !ativoAtual;
        fetch(CONFIG.apiBase + '/config/' + recurso + '/' + id, {
            method: 'PUT',
            credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ativo: novoAtivo })
        })
            .then(function (r) { return r.json(); })
            .then(function (data) {
                if (data.success) {
                    carregarSubabaAtiva();
                } else {
                    alert(data.error || 'Erro ao alterar status.');
                }
            })
            .catch(function () { alert('Falha na conexão.'); });
    }

    function deletarItem(recurso, id, nome) {
        if (!window.confirm('Deletar "' + nome + '"?\nEsta ação não pode ser desfeita.')) return;
        fetch(CONFIG.apiBase + '/config/' + recurso + '/' + id, {
            method: 'DELETE',
            credentials: 'same-origin'
        })
            .then(function (r) {
                return r.json().then(function (data) {
                    return { status: r.status, data: data };
                });
            })
            .then(function (res) {
                if (res.status === 409 && res.data.tem_uso) {
                    if (window.confirm(res.data.error + '\n\nDeseja inativar em vez de deletar?')) {
                        toggleAtivo(recurso, id, true);
                    }
                } else if (res.data.success) {
                    carregarSubabaAtiva();
                } else {
                    alert(res.data.error || 'Erro ao deletar.');
                }
            })
            .catch(function () { alert('Falha na conexão.'); });
    }

    // =========================================================
    // MODAL FORM GENÉRICO
    // =========================================================
    var FORMS = {
        'equipe': {
            titulo: 'Membro da Equipe',
            campos: [
                { key: 'nome',      label: 'Nome',      tipo: 'text',   obrig: true },
                { key: 'matricula', label: 'Matrícula', tipo: 'text' },
                { key: 'funcao',    label: 'Função',    tipo: 'select',
                  opts: ['nutricionista','tecnico','copeira','auxiliar'] },
                { key: 'turno',     label: 'Turno',     tipo: 'select',
                  opts: ['todos','manhã','tarde','noite'] },
                { key: 'ativo',     label: 'Ativo',     tipo: 'checkbox' }
            ]
        },
        'tipos-dieta': {
            titulo: 'Tipo de Dieta',
            campos: [
                { key: 'nome',     label: 'Nome',    tipo: 'text',  obrig: true },
                { key: 'descricao',label: 'Descrição',tipo: 'text' },
                { key: 'icone',    label: 'Ícone FA', tipo: 'text', placeholder: 'fa-utensils' },
                { key: 'cor',      label: 'Cor (hex)',tipo: 'color' },
                { key: 'ordem',    label: 'Ordem',    tipo: 'number' },
                { key: 'ativo',    label: 'Ativo',    tipo: 'checkbox' }
            ]
        },
        'refeicoes': {
            titulo: 'Refeição',
            campos: [
                { key: 'nome',           label: 'Nome',     tipo: 'text', obrig: true },
                { key: 'horario_inicio', label: 'Início',   tipo: 'time' },
                { key: 'horario_fim',    label: 'Fim',      tipo: 'time' },
                { key: 'icone',          label: 'Ícone FA', tipo: 'text', placeholder: 'fa-utensils' },
                { key: 'ordem',          label: 'Ordem',    tipo: 'number' },
                { key: 'ativo',          label: 'Ativo',    tipo: 'checkbox' }
            ]
        },
        'restricoes': {
            titulo: 'Restrição Alimentar',
            campos: [
                { key: 'nome',  label: 'Nome',     tipo: 'text', obrig: true },
                { key: 'sigla', label: 'Sigla',    tipo: 'text', placeholder: 'EX: SG' },
                { key: 'icone', label: 'Ícone FA', tipo: 'text', placeholder: 'fa-triangle-exclamation' },
                { key: 'cor',   label: 'Cor (hex)',tipo: 'color' },
                { key: 'ordem', label: 'Ordem',    tipo: 'number' },
                { key: 'ativo', label: 'Ativo',    tipo: 'checkbox' }
            ]
        }
    };

    function abrirFormNovo(recurso) {
        Estado.formRecurso = recurso;
        Estado.formId      = null;
        document.getElementById('modal-form-titulo').textContent = 'Novo ' + FORMS[recurso].titulo;
        document.getElementById('modal-form-erro').style.display = 'none';
        document.getElementById('modal-form-corpo').innerHTML = buildFormHtml(FORMS[recurso].campos, {});
        document.getElementById('modal-form').style.display = 'flex';
    }

    function abrirFormEdicao(recurso, id) {
        Estado.formRecurso = recurso;
        Estado.formId      = id;
        var lista = getListaRecurso(recurso);
        var item  = null;
        for (var i = 0; i < lista.length; i++) {
            if (String(lista[i].id) === String(id)) { item = lista[i]; break; }
        }
        if (!item) return;
        document.getElementById('modal-form-titulo').textContent = 'Editar ' + FORMS[recurso].titulo;
        document.getElementById('modal-form-erro').style.display = 'none';
        document.getElementById('modal-form-corpo').innerHTML = buildFormHtml(FORMS[recurso].campos, item);
        document.getElementById('modal-form').style.display = 'flex';
    }

    function getListaRecurso(recurso) {
        if (recurso === 'equipe')      return Estado.equipe;
        if (recurso === 'tipos-dieta') return Estado.tiposDieta;
        if (recurso === 'refeicoes')   return Estado.refeicoes;
        if (recurso === 'restricoes')  return Estado.restricoes;
        return [];
    }

    function buildFormHtml(campos, vals) {
        var html = '';
        for (var i = 0; i < campos.length; i++) {
            var c = campos[i];
            var v = vals[c.key] != null ? vals[c.key] : '';
            html += '<div class="form-group-modal">';
            html += '<label>' + escHtml(c.label) + (c.obrig ? ' <span style="color:#DC3545;">*</span>' : '') + '</label>';

            if (c.tipo === 'select') {
                html += '<select name="' + c.key + '" class="form-select-modal">';
                for (var j = 0; j < c.opts.length; j++) {
                    var sel = String(v) === c.opts[j] ? ' selected' : '';
                    html += '<option' + sel + '>' + escHtml(c.opts[j]) + '</option>';
                }
                html += '</select>';
            } else if (c.tipo === 'checkbox') {
                html += '<label style="display:flex;align-items:center;gap:8px;cursor:pointer;">' +
                    '<input type="checkbox" name="' + c.key + '"' + (v ? ' checked' : '') + '>' +
                    ' Sim</label>';
            } else if (c.tipo === 'color') {
                var hexVal = (v && v.startsWith('#')) ? v : '#17A2B8';
                html += '<input type="color" name="' + c.key + '" value="' + escHtml(hexVal) + '" class="form-select-modal" style="height:40px;padding:2px;">';
            } else {
                html += '<input type="' + c.tipo + '" name="' + c.key + '" value="' + escHtml(String(v)) + '"' +
                    (c.placeholder ? ' placeholder="' + escHtml(c.placeholder) + '"' : '') +
                    ' class="form-select-modal">';
            }
            html += '</div>';
        }
        return html;
    }

    function fecharModalForm() {
        document.getElementById('modal-form').style.display = 'none';
        Estado.formRecurso = null;
        Estado.formId      = null;
    }

    function salvarForm() {
        var recurso = Estado.formRecurso;
        var id      = Estado.formId;
        var campos  = FORMS[recurso].campos;
        var dados   = {};

        var corpo = document.getElementById('modal-form-corpo');
        for (var i = 0; i < campos.length; i++) {
            var c = campos[i];
            var el = corpo.querySelector('[name="' + c.key + '"]');
            if (!el) continue;
            if (c.tipo === 'checkbox') {
                dados[c.key] = el.checked;
            } else if (c.tipo === 'number') {
                dados[c.key] = parseInt(el.value, 10) || 0;
            } else {
                dados[c.key] = el.value.trim();
            }
        }

        var url    = CONFIG.apiBase + '/config/' + recurso;
        var method = id ? 'PUT' : 'POST';
        if (id) url += '/' + id;

        document.getElementById('btn-form-salvar').disabled = true;
        document.getElementById('modal-form-erro').style.display = 'none';

        fetch(url, {
            method: method,
            credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(dados)
        })
            .then(function (r) { return r.json(); })
            .then(function (data) {
                document.getElementById('btn-form-salvar').disabled = false;
                if (data.success) {
                    fecharModalForm();
                    carregarSubabaAtiva();
                } else {
                    document.getElementById('modal-form-erro').textContent = data.error || 'Erro ao salvar.';
                    document.getElementById('modal-form-erro').style.display = 'block';
                }
            })
            .catch(function () {
                document.getElementById('btn-form-salvar').disabled = false;
                document.getElementById('modal-form-erro').textContent = 'Falha na conexão.';
                document.getElementById('modal-form-erro').style.display = 'block';
            });
    }

    // =========================================================
    // ETIQUETA CONFIG
    // =========================================================

    var _previewTimer = null;
    var _zplBlobUrl   = null;

    var _EXEMPLO = {
        NR_ATENDIMENTO: '123456',
        PACIENTE:        'Maria das Graças Oliveira',
        LEITO:           'A-101',
        SETOR:           'Clínica Médica',
        DIETA:           'Dieta Branda',
        REFEICAO:        'Almoço',
        RESTRICOES:      'Sem glúten, sem lactose',
        OBS:             'Sem sal',
        CODIGO:          'NUT-0001',
        DATA:            '13/07/2026',
        HORA:            '11:30'
    };

    function _preencherVarsExemplo(template) {
        return template
            .replace(/\{\{NR_ATENDIMENTO\}\}/g, _EXEMPLO.NR_ATENDIMENTO)
            .replace(/\{\{PACIENTE\}\}/g,        _EXEMPLO.PACIENTE)
            .replace(/\{\{LEITO\}\}/g,           _EXEMPLO.LEITO)
            .replace(/\{\{SETOR\}\}/g,           _EXEMPLO.SETOR)
            .replace(/\{\{DIETA\}\}/g,           _EXEMPLO.DIETA)
            .replace(/\{\{REFEICAO\}\}/g,        _EXEMPLO.REFEICAO)
            .replace(/\{\{RESTRICOES\}\}/g,      _EXEMPLO.RESTRICOES)
            .replace(/\{\{OBS\}\}/g,             _EXEMPLO.OBS)
            .replace(/\{\{CODIGO\}\}/g,          _EXEMPLO.CODIGO)
            .replace(/\{\{DATA\}\}/g,            _EXEMPLO.DATA)
            .replace(/\{\{HORA\}\}/g,            _EXEMPLO.HORA);
    }

    function _atualizarPreview() {
        var frame    = document.getElementById('etq-preview');
        var template = document.getElementById('etq-pdf').value;
        if (!frame || !template) return;
        frame.srcdoc = _preencherVarsExemplo(template);
    }

    function _atualizarPreviewZPL() {
        var template = (document.getElementById('etq-zpl').value || '').trim();
        var img      = document.getElementById('etq-zpl-preview');
        var status   = document.getElementById('etq-zpl-preview-status');
        if (!img || !status) return;
        if (!template) {
            img.style.display = 'none';
            status.className  = 'etq-zpl-preview-status';
            status.textContent = 'Digite o ZPL para visualizar';
            return;
        }

        var zpl = _preencherVarsExemplo(template);

        status.className   = 'etq-zpl-preview-status carregando';
        status.textContent = 'Gerando preview...';
        img.style.opacity  = '0.4';

        if (_zplBlobUrl) { URL.revokeObjectURL(_zplBlobUrl); _zplBlobUrl = null; }

        fetch(CONFIG.apiBase + '/preview-zpl', {
            method:      'POST',
            credentials: 'same-origin',
            headers:     { 'Content-Type': 'text/plain' },
            body:        zpl
        })
            .then(function (r) {
                if (r.status === 503) throw new Error('sem_internet');
                if (!r.ok) throw new Error(r.status);
                return r.blob();
            })
            .then(function (blob) {
                if (_zplBlobUrl) { URL.revokeObjectURL(_zplBlobUrl); _zplBlobUrl = null; }
                _zplBlobUrl       = URL.createObjectURL(blob);
                img.src           = _zplBlobUrl;
                img.style.display = 'block';
                img.style.opacity = '1';
                status.textContent = '';
                status.className   = 'etq-zpl-preview-status';
            })
            .catch(function (err) {
                img.style.opacity  = '1';
                status.className   = 'etq-zpl-preview-status erro';
                status.textContent = (err.message === 'sem_internet')
                    ? 'Servidor sem acesso à internet (Labelary indisponível)'
                    : 'ZPL inválido ou erro no servidor';
            });
    }

    var _PDF_TEMPLATE_PADRAO = [
        '<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8">',
        '<title>Etiqueta Dieta</title>',
        '<script src="https://cdn.jsdelivr.net/npm/jsbarcode@3.11.6/dist/JsBarcode.all.min.js"><\/script>',
        '<style>',
        '@page { size: 7cm 10cm; margin: 3mm }',
        'body { font-family: Arial, sans-serif; font-size: 10px; margin: 0; padding: 0; }',
        'svg { max-width: 100%; height: 45px; display: block; margin: 0 auto; }',
        '@media print { body { print-color-adjust: exact; -webkit-print-color-adjust: exact } }',
        '</style></head><body>',
        '<div style="padding: 2mm">',
        '  <div style="font-size: 12px; font-weight: bold; text-align: center; border-bottom: 1px solid #000; padding-bottom: 2mm; margin-bottom: 2mm">Hospital Anchieta Ceilândia</div>',
        '  <div style="font-weight: bold; font-size: 11px; margin-bottom: 2px; word-break: break-word;"><span style="font-weight: normal">Paciente: </span>{{PACIENTE}}</div>',
        '  <div style="display: flex; justify-content: space-between; font-size: 8px; color: #555; margin-bottom: 5px;">',
        '    <span>Cód: {{CODIGO}}</span>',
        '    <span>{{DATA}} {{HORA}}</span>',
        '  </div>',
        '  <div style="margin-bottom: 5px"><span style="font-weight: bold">Leito:</span> {{LEITO}} &nbsp; <span style="font-weight: bold">Setor:</span> {{SETOR}}</div>',
        '  <div style="margin-bottom: 5px"><span style="font-weight: bold">Dieta:</span> {{DIETA}} &mdash; {{REFEICAO}}</div>',
        '  <div style="margin-bottom: 5px"><span style="font-weight: bold">Restrições:</span> {{RESTRICOES}}</div>',
        '  <div style="margin-bottom: 5px; min-height: 8mm; line-height: 1.6;"><span style="font-weight: bold">Obs:</span> {{OBS}}</div>',
        '  <div style="text-align: center; margin: 1mm 0"><svg id="bc"></svg></div>',
        '  <div style="text-align: center; font-size: 8px; font-weight: bold; font-family: monospace;">{{NR_ATENDIMENTO}}</div>',
        '</div>',
        '<script>',
        'window.onload = function() {',
        '  if (typeof JsBarcode !== "undefined") {',
        '    JsBarcode("#bc", "{{NR_ATENDIMENTO}}", {format:"CODE128",width:1.8,height:45,displayValue:false,margin:0});',
        '  }',
        '};',
        '<\/script>',
        '</body></html>'
    ].join('\n');

    var _ZPL_TEMPLATE_PADRAO = [
        '^XA',
        '^PW800',
        '^LL480',
        '^CI28',
        '^LH0,0',
        '',
        '^FO0,10^A0N,24,24^FB800,1,0,C^FDHospital Anchieta Ceilandia^FS',
        '^FO0,42^GB800,2,2^FS',
        '',
        '^FO15,55^A0N,18,18^FDPaciente: {{PACIENTE}}^FS',
        '^FO15,80^A0N,18,18^FDLeito: {{LEITO}}^FS',
        '^FO420,80^A0N,18,18^FDSetor: {{SETOR}}^FS',
        '^FO15,105^A0N,18,18^FDDieta: {{DIETA}} - {{REFEICAO}}^FS',
        '',
        '^FO15,128^GB770,38,1^FS',
        '^FO22,136^A0N,16,16^FDRestricoes: {{RESTRICOES}}^FS',
        '',
        '^FO15,173^A0N,18,18^FDObs: {{OBS}}^FS',
        '',
        '^FO155,195^BY2^BCN,75,N,N,N^FD{{NR_ATENDIMENTO}}^FS',
        '',
        '^FO0,285^A0N,22,22^FB800,1,0,C^FD{{NR_ATENDIMENTO}}^FS',
        '',
        '^FO0,318^GB800,1,1^FS',
        '^FO15,325^A0N,14,14^FDCod: {{CODIGO}}^FS',
        '^FO530,325^A0N,14,14^FD{{DATA}} {{HORA}}^FS',
        '',
        '^XZ'
    ].join('\n');

    function _toggleEtiquetaGrupos() {
        var modo    = document.getElementById('etq-modo').value;
        var grpPdf  = document.getElementById('etq-pdf-group');
        var grpZpl  = document.getElementById('etq-zpl-group');
        if (grpPdf) grpPdf.style.display = (modo === 'pdf') ? 'flex' : 'none';
        if (grpZpl) grpZpl.style.display = (modo === 'zpl') ? 'flex' : 'none';
    }

    function carregarEtiqueta() {
        fetch(CONFIG.apiBase + '/config/etiqueta', { credentials: 'same-origin' })
            .then(function (r) { return r.json(); })
            .then(function (data) {
                if (data.success) {
                    document.getElementById('etq-modo').value = data.modo_impressao || 'pdf';
                    document.getElementById('etq-zpl').value  = data.zpl_template  || _ZPL_TEMPLATE_PADRAO;
                    document.getElementById('etq-pdf').value  = data.pdf_template  || _PDF_TEMPLATE_PADRAO;
                    _toggleEtiquetaGrupos();
                    _atualizarPreview();
                    _atualizarPreviewZPL();
                }
            })
            .catch(function (e) { console.error('etiqueta load', e); });
    }

    function salvarEtiqueta() {
        var modo = document.getElementById('etq-modo').value;
        var zpl  = document.getElementById('etq-zpl').value;
        var pdf  = document.getElementById('etq-pdf').value;
        var btn  = document.getElementById('btn-salvar-etiqueta');
        var msg  = document.getElementById('etq-msg');
        btn.disabled = true;
        msg.style.display = 'none';

        fetch(CONFIG.apiBase + '/config/etiqueta', {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ modo_impressao: modo, zpl_template: zpl, pdf_template: pdf })
        })
            .then(function (r) { return r.json(); })
            .then(function (data) {
                btn.disabled = false;
                msg.style.display = 'block';
                if (data.success) {
                    msg.className = 'etq-msg etq-msg-ok';
                    msg.textContent = 'Configuração salva com sucesso!';
                } else {
                    msg.className = 'etq-msg etq-msg-err';
                    msg.textContent = data.error || 'Erro ao salvar.';
                }
                setTimeout(function () { msg.style.display = 'none'; }, 3000);
            })
            .catch(function () {
                btn.disabled = false;
                msg.style.display = 'block';
                msg.className = 'etq-msg etq-msg-err';
                msg.textContent = 'Falha na conexão.';
                setTimeout(function () { msg.style.display = 'none'; }, 3000);
            });
    }

    // =========================================================
    // START
    // =========================================================
    window.addEventListener('DOMContentLoaded', inicializar);

})();
