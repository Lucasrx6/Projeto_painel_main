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
        diasRel: 30,
        // dados config
        equipe: [], tiposDieta: [], refeicoes: [], restricoes: [],
        // form modal
        formRecurso: null, formId: null, formOnSave: null
    };

    var DOM = {};

    // =========================================================
    // ESCAPE HTML
    // =========================================================
    function escHtml(s) {
        return String(s || '')
            .replace(/&/g, '&amp;').replace(/</g, '&lt;')
            .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
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
            btnVoltar.addEventListener('click', function () { window.history.back(); });
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

        // Header
        var btnRefresh = document.getElementById('btn-refresh');
        if (btnRefresh) btnRefresh.addEventListener('click', carregarDashboard);

        // Dashboard
        document.getElementById('btn-refresh-dash').addEventListener('click', carregarDashboard);

        // Relatórios
        document.getElementById('btn-filtrar').addEventListener('click', function () {
            Estado.diasRel = parseInt(document.getElementById('fil-dias').value, 10);
            carregarRelatorios();
        });
        document.getElementById('btn-exportar').addEventListener('click', exportarCSV);

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
        if (aba === 'relatorios') carregarRelatorios();
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
            { label: 'T.Médio Total',  val: (r.media_min_total  || '--') + (r.media_min_total  ? 'min' : ''), cor: '#6C757D', icone: 'fa-stopwatch' },
            { label: 'T.Médio Aceite', val: (r.media_min_aceite || '--') + (r.media_min_aceite ? 'min' : ''), cor: '#6C757D', icone: 'fa-hourglass-half' }
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
                '<td>' + (a.minutos_espera || 0) + 'min</td>' +
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
    function carregarRelatorios() {
        var dias = Estado.diasRel;
        var endpoints = ['por-refeicao', 'por-dieta', 'por-setor', 'por-responsavel'];
        var tbodys    = ['tbody-refeicao', 'tbody-dieta', 'tbody-setor', 'tbody-responsavel'];
        var cols      = [
            ['refeicao_nome', 'total', 'entregues', 'cancelados', 'urgentes', 'media_min'],
            ['tipo_dieta_nome', 'total', 'entregues', 'cancelados', 'urgentes', 'media_min'],
            ['setor', 'total', 'entregues', 'cancelados', 'urgentes'],
            ['responsavel_nome', 'total', 'entregues', 'cancelados', 'media_min_total']
        ];

        for (var i = 0; i < endpoints.length; i++) {
            (function (ep, tbody, campoCols) {
                fetch(CONFIG.apiBase + '/' + ep + '?dias=' + dias, { credentials: 'same-origin' })
                    .then(function (r) { return r.json(); })
                    .then(function (data) {
                        if (!data.success || !data.dados) return;
                        var html = '';
                        for (var k = 0; k < data.dados.length; k++) {
                            var d = data.dados[k];
                            html += '<tr>';
                            for (var c = 0; c < campoCols.length; c++) {
                                var v = d[campoCols[c]];
                                html += '<td>' + escHtml(v != null ? String(v) : '--') + '</td>';
                            }
                            html += '</tr>';
                        }
                        document.getElementById(tbody).innerHTML = html || '<tr><td colspan="10" class="tabela-empty">Sem dados</td></tr>';
                    })
                    .catch(function (e) { console.error(ep, e); });
            })(endpoints[i], tbodys[i], cols[i]);
        }
    }

    function exportarCSV() {
        var url = CONFIG.apiBase + '/exportar?dias=' + Estado.diasRel;
        window.location.href = url;
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
    // START
    // =========================================================
    window.addEventListener('DOMContentLoaded', inicializar);

})();
