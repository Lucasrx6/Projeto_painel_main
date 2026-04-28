(function () {
    'use strict';

    var BASE_URL = window.location.origin;

    var CONFIG = {
        apiDashboard:   BASE_URL + '/api/paineis/painel36/dashboard',
        apiChamados:    BASE_URL + '/api/paineis/painel36/chamados',
        apiPorSetor:    BASE_URL + '/api/paineis/painel36/por-setor',
        apiPorPad:      BASE_URL + '/api/paineis/painel36/por-padioleiro',
        apiExportar:    BASE_URL + '/api/paineis/painel36/exportar',
        apiCancelar:    BASE_URL + '/api/paineis/painel36/chamados/{id}/cancelar',
        cfgPadioleiros: BASE_URL + '/api/paineis/painel36/config/padioleiros',
        cfgTipos:       BASE_URL + '/api/paineis/painel36/config/tipos-movimento',
        cfgDestinos:    BASE_URL + '/api/paineis/painel36/config/destinos',
        intervaloRefresh: 20000
    };

    var estado = {
        abaAtual: 'dashboard',
        subAbaAtual: 'padioleiros',
        refreshTimer: null,
        tiposMovimento: [],
        modalContexto: null,
        modalId: null,
        chamadoCancelarId: null,
        salvando: false
    };

    // ── INICIALIZACAO ──────────────────────────────────────────────

    function inicializar() {
        document.getElementById('btn-voltar').addEventListener('click', function () { window.history.back(); });
        document.getElementById('btn-refresh').addEventListener('click', carregarAbaAtual);
        document.getElementById('btn-exportar').addEventListener('click', exportarCSV);
        document.getElementById('btn-aplicar-filtro').addEventListener('click', carregarAbaAtual);
        document.getElementById('btn-fechar-modal').addEventListener('click', fecharModal);
        document.getElementById('btn-modal-cancelar').addEventListener('click', fecharModal);
        document.getElementById('btn-modal-salvar').addEventListener('click', salvarModal);
        document.getElementById('btn-cancelar-gestao-nao').addEventListener('click', fecharModalCancelarGestao);
        document.getElementById('btn-cancelar-gestao-sim').addEventListener('click', confirmarCancelamentoGestao);

        document.querySelectorAll('.aba').forEach(function (btn) {
            btn.addEventListener('click', function () { trocarAba(btn.dataset.aba); });
        });

        document.querySelectorAll('.sub-aba').forEach(function (btn) {
            btn.addEventListener('click', function () { trocarSubAba(btn.dataset.sub); });
        });

        document.getElementById('btn-novo-padioleiro').addEventListener('click', function () { abrirModalPadioleiro(null); });
        document.getElementById('btn-novo-tipo').addEventListener('click', function () { abrirModalTipo(null); });
        document.getElementById('btn-novo-destino').addEventListener('click', function () { abrirModalDestino(null); });
        document.getElementById('filtro-tipo-destino').addEventListener('change', carregarDestinos);

        carregarDashboard();
        carregarTiposParaFiltro();
        estado.refreshTimer = setInterval(function () { if (estado.abaAtual === 'dashboard') carregarDashboard(); }, CONFIG.intervaloRefresh);
    }

    // ── ABAS ──────────────────────────────────────────────────────

    function trocarAba(aba) {
        document.querySelectorAll('.aba').forEach(function (b) {
            b.classList.toggle('aba-ativa', b.dataset.aba === aba);
        });
        document.querySelectorAll('.aba-conteudo').forEach(function (el) {
            el.style.display = (el.id === 'aba-' + aba) ? '' : 'none';
        });

        var filtroBar = document.getElementById('filtro-bar');
        filtroBar.style.display = ['dashboard', 'historico', 'por-setor', 'por-padioleiro'].indexOf(aba) !== -1 ? '' : 'none';

        estado.abaAtual = aba;
        carregarAbaAtual();
    }

    function carregarAbaAtual() {
        var aba = estado.abaAtual;
        if (aba === 'dashboard')      carregarDashboard();
        else if (aba === 'por-setor') carregarPorSetor();
        else if (aba === 'por-padioleiro') carregarPorPadioleiro();
        else if (aba === 'historico') carregarHistorico();
        else if (aba === 'config')    carregarConfigAtual();
    }

    function trocarSubAba(sub) {
        document.querySelectorAll('.sub-aba').forEach(function (b) {
            b.classList.toggle('sub-aba-ativa', b.dataset.sub === sub);
        });
        document.querySelectorAll('.sub-conteudo').forEach(function (el) {
            el.style.display = (el.id === 'sub-' + sub) ? '' : 'none';
        });
        estado.subAbaAtual = sub;
        carregarConfigAtual();
    }

    function carregarConfigAtual() {
        var sub = estado.subAbaAtual;
        if (sub === 'padioleiros') carregarCfgPadioleiros();
        else if (sub === 'tipos')  carregarCfgTipos();
        else if (sub === 'destinos') carregarDestinos();
    }

    function getFiltros() {
        return {
            dias:      document.getElementById('filtro-dias').value,
            status:    document.getElementById('filtro-status').value,
            prioridade: document.getElementById('filtro-prioridade').value
        };
    }

    // ── DASHBOARD ─────────────────────────────────────────────────

    function carregarDashboard() {
        fetch(CONFIG.apiDashboard, { credentials: 'same-origin' })
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
        var grid = document.getElementById('stats-grid');
        var tTotal       = s.tempo_medio_total_hoje       ? Math.round(s.tempo_medio_total_hoje)       + ' min' : '--';
        var tAceite      = s.tempo_medio_aceite_hoje      ? Math.round(s.tempo_medio_aceite_hoje)      + ' min' : '--';
        var tDeslocam    = s.tempo_medio_deslocamento_hoje ? Math.round(s.tempo_medio_deslocamento_hoje) + ' min' : '--';
        var tTransporte  = s.tempo_medio_transporte_hoje  ? Math.round(s.tempo_medio_transporte_hoje)  + ' min' : '--';
        grid.innerHTML =
            statCard('stat-aguardando', s.aguardando     || 0, 'Aguardando',       'fa-clock') +
            statCard('stat-aceito',     s.aceito         || 0, 'Aceitos',          'fa-check') +
            statCard('stat-transporte', s.em_transporte  || 0, 'Em Transporte',    'fa-person-walking') +
            statCard('stat-concluidos', s.concluidos_hoje || 0, 'Concluidos Hoje', 'fa-check-double') +
            statCard('stat-urgentes',   s.urgentes_aguardando || 0, 'Urgentes Fila', 'fa-bolt') +
            statCard('stat-tempo',      tAceite,    'T. Medio p/ Aceite',       'fa-hourglass-start') +
            statCard('stat-deslocam',   tDeslocam,  'T. Medio Deslocamento',    'fa-route') +
            statCard('stat-transporte2',tTransporte,'T. Medio Transporte',      'fa-truck-medical') +
            statCard('stat-total',      tTotal,     'T. Medio Total',           'fa-stopwatch');
    }

    function statCard(classe, valor, label, icone) {
        return '<div class="stat-card ' + classe + '">' +
            '<div class="stat-icone"><i class="fas ' + icone + '"></i></div>' +
            '<div class="stat-num">' + valor + '</div>' +
            '<div class="stat-label">' + label + '</div>' +
            '</div>';
    }

    function renderizarAtivos(lista) {
        var wrapper = document.getElementById('tabela-ativos-wrapper');
        if (!lista || lista.length === 0) {
            wrapper.innerHTML = '<div class="tabela-vazio"><i class="fas fa-check-circle" style="color:#28a745;"></i><p>Nenhum chamado em aberto</p></div>';
            return;
        }
        var linhas = lista.map(function (c) {
            var espera = c.minutos_espera ? Math.round(c.minutos_espera) + ' min' : '--';
            return '<tr>' +
                '<td><strong>#' + c.id + '</strong></td>' +
                '<td>' + escHtml(c.tipo_movimento_nome || '-') + '</td>' +
                '<td>' + escHtml(c.nm_paciente || '-') + (c.leito_origem ? '<br><small style="color:#aaa;">Leito ' + escHtml(c.leito_origem) + '</small>' : '') + '</td>' +
                '<td>' + escHtml(c.setor_origem_nome || '-') + '</td>' +
                '<td><strong>' + escHtml(c.destino_nome || '-') + '</strong></td>' +
                '<td>' + badgeStatus(c.status) + (c.prioridade === 'urgente' ? ' <span class="badge-urgente">URGENTE</span>' : '') + '</td>' +
                '<td>' + escHtml(c.padioleiro_nome || '<span style="color:#aaa;">--</span>') + '</td>' +
                '<td>' + espera + '</td>' +
                '<td><button class="btn-cancelar-gestao" data-id="' + c.id + '" style="background:transparent;border:none;color:var(--danger);cursor:pointer;" title="Cancelar"><i class="fas fa-times"></i></button></td>' +
            '</tr>';
        }).join('');

        wrapper.innerHTML =
            '<div class="tabela-wrapper"><table class="tabela"><thead><tr>' +
            '<th>#</th><th>Tipo</th><th>Paciente</th><th>Setor Origem</th><th>Destino</th><th>Status</th><th>Padioleiro</th><th>Espera</th><th>Ações</th>' +
            '</tr></thead><tbody>' + linhas + '</tbody></table></div>';

        wrapper.querySelectorAll('.btn-cancelar-gestao').forEach(function (btn) {
            btn.addEventListener('click', function () { abrirModalCancelarGestao(parseInt(btn.dataset.id)); });
        });
    }

    // ── POR SETOR ─────────────────────────────────────────────────

    function carregarPorSetor() {
        var f = getFiltros();
        var wrapper = document.getElementById('tabela-setor-wrapper');
        wrapper.innerHTML = '<div class="loading"><div class="loading-spinner"></div><p>Carregando...</p></div>';

        fetch(CONFIG.apiPorSetor + '?dias=' + f.dias, { credentials: 'same-origin' })
            .then(function (r) { return r.json(); })
            .then(function (data) {
                if (!data.success) { wrapper.innerHTML = '<p style="padding:20px;color:#aaa;">Erro ao carregar</p>'; return; }
                var total = data.setores.reduce(function (acc, s) { return acc + s.total; }, 0);
                if (data.setores.length === 0) {
                    wrapper.innerHTML = '<div class="tabela-vazio"><i class="fas fa-inbox"></i><p>Nenhum dado no periodo</p></div>';
                    return;
                }
                var linhas = data.setores.map(function (s) {
                    var pct = total > 0 ? Math.round((s.total / total) * 100) : 0;
                    return '<tr>' +
                        '<td><strong>' + escHtml(s.setor || '-') + '</strong></td>' +
                        '<td>' + s.total + '</td>' +
                        '<td><span style="color:#28a745;font-weight:700;">' + s.concluidos + '</span></td>' +
                        '<td><span style="color:#6c757d;">' + s.cancelados + '</span></td>' +
                        '<td><span style="color:#dc3545;">' + s.urgentes + '</span></td>' +
                        '<td>' + (s.tempo_medio_aceite_min != null ? Math.round(s.tempo_medio_aceite_min) + ' min' : '--') + '</td>' +
                        '<td>' + (s.tempo_medio_deslocamento_min != null ? Math.round(s.tempo_medio_deslocamento_min) + ' min' : '--') + '</td>' +
                        '<td>' + (s.tempo_medio_total_min != null ? Math.round(s.tempo_medio_total_min) + ' min' : '--') + '</td>' +
                        '<td><div class="barra-container"><div class="barra-bg"><div class="barra-fill" style="width:' + pct + '%"></div></div></div></td>' +
                    '</tr>';
                }).join('');
                wrapper.innerHTML =
                    '<div class="tabela-wrapper"><table class="tabela"><thead><tr>' +
                    '<th>Setor</th><th>Total</th><th>Concluidos</th><th>Cancelados</th><th>Urgentes</th>' +
                    '<th title="Da abertura ate o aceite">T. Aceite</th>' +
                    '<th title="Do aceite ate iniciar o transporte">T. Deslocamento</th>' +
                    '<th title="Da abertura ate a conclusao">T. Total</th>' +
                    '<th>Proporcao</th>' +
                    '</tr></thead><tbody>' + linhas + '</tbody></table></div>';
            })
            .catch(function () { wrapper.innerHTML = '<p style="padding:20px;color:#aaa;">Erro de conexao</p>'; });
    }

    // ── POR PADIOLEIRO ────────────────────────────────────────────

    function carregarPorPadioleiro() {
        var f = getFiltros();
        var wrapper = document.getElementById('tabela-padioleiro-wrapper');
        wrapper.innerHTML = '<div class="loading"><div class="loading-spinner"></div><p>Carregando...</p></div>';

        fetch(CONFIG.apiPorPad + '?dias=' + f.dias, { credentials: 'same-origin' })
            .then(function (r) { return r.json(); })
            .then(function (data) {
                if (!data.success) { wrapper.innerHTML = '<p style="padding:20px;color:#aaa;">Erro ao carregar</p>'; return; }
                if (data.padioleiros.length === 0) {
                    wrapper.innerHTML = '<div class="tabela-vazio"><i class="fas fa-inbox"></i><p>Nenhum dado no periodo</p></div>';
                    return;
                }
                var linhas = data.padioleiros.map(function (p) {
                    return '<tr>' +
                        '<td><strong>' + escHtml(p.padioleiro || '-') + '</strong></td>' +
                        '<td>' + p.total + '</td>' +
                        '<td><span style="color:#28a745;font-weight:700;">' + p.concluidos + '</span></td>' +
                        '<td><span style="color:#6c757d;">' + p.cancelados + '</span></td>' +
                        '<td><span style="color:#dc3545;">' + p.urgentes + '</span></td>' +
                        '<td>' + (p.tempo_medio_aceite_min      != null ? Math.round(p.tempo_medio_aceite_min)      + ' min' : '--') + '</td>' +
                        '<td>' + (p.tempo_medio_deslocamento_min != null ? Math.round(p.tempo_medio_deslocamento_min) + ' min' : '--') + '</td>' +
                        '<td>' + (p.tempo_medio_transporte_min  != null ? Math.round(p.tempo_medio_transporte_min)  + ' min' : '--') + '</td>' +
                        '<td>' + (p.tempo_medio_total_min       != null ? Math.round(p.tempo_medio_total_min)       + ' min' : '--') + '</td>' +
                    '</tr>';
                }).join('');
                wrapper.innerHTML =
                    '<div class="tabela-wrapper"><table class="tabela"><thead><tr>' +
                    '<th>Padioleiro</th><th>Total</th><th>Concluidos</th><th>Cancelados</th><th>Urgentes</th>' +
                    '<th title="Da abertura ate o aceite">T. Aceite</th>' +
                    '<th title="Do aceite ate iniciar o transporte">T. Deslocamento</th>' +
                    '<th title="Do inicio ao fim do transporte">T. Transporte</th>' +
                    '<th title="Da abertura ate a conclusao">T. Total</th>' +
                    '</tr></thead><tbody>' + linhas + '</tbody></table></div>';
            })
            .catch(function () { wrapper.innerHTML = '<p style="padding:20px;color:#aaa;">Erro de conexao</p>'; });
    }

    // ── HISTORICO ─────────────────────────────────────────────────

    function carregarHistorico() {
        var f = getFiltros();
        var wrapper = document.getElementById('tabela-historico-wrapper');
        wrapper.innerHTML = '<div class="loading"><div class="loading-spinner"></div><p>Carregando...</p></div>';

        var qs = '?dias=' + f.dias;
        if (f.status)    qs += '&status=' + f.status;
        if (f.prioridade) qs += '&prioridade=' + f.prioridade;

        fetch(CONFIG.apiChamados + qs, { credentials: 'same-origin' })
            .then(function (r) { return r.json(); })
            .then(function (data) {
                if (!data.success) { wrapper.innerHTML = '<p style="padding:20px;color:#aaa;">Erro</p>'; return; }
                if (data.chamados.length === 0) {
                    wrapper.innerHTML = '<div class="tabela-vazio"><i class="fas fa-inbox"></i><p>Nenhum chamado no periodo</p></div>';
                    return;
                }
                var linhas = data.chamados.map(function (c) {
                    var criado = c.criado_em ? new Date(c.criado_em).toLocaleString('pt-BR', { day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' }) : '--';
                    return '<tr>' +
                        '<td><strong>#' + c.id + '</strong></td>' +
                        '<td style="white-space:nowrap;">' + criado + '</td>' +
                        '<td>' + escHtml(c.tipo_movimento_nome || '-') + '</td>' +
                        '<td>' + escHtml(c.nm_paciente || '-') + (c.leito_origem ? '<br><small style="color:#aaa;">Leito ' + escHtml(c.leito_origem) + '</small>' : '') + '</td>' +
                        '<td>' + escHtml(c.setor_origem_nome || '-') + '</td>' +
                        '<td>' + escHtml(c.destino_nome || '-') + '</td>' +
                        '<td>' + badgeStatus(c.status) + (c.prioridade === 'urgente' ? ' <span class="badge-urgente">URG</span>' : '') + 
                        (c.status === 'cancelado' && c.motivo_cancelamento ? '<br><small style="color:#dc3545; display:inline-block; max-width:180px; white-space:normal; line-height:1.2; margin-top:4px;" title="' + escHtml(c.motivo_cancelamento) + '"><i class="fas fa-info-circle"></i> ' + escHtml(c.motivo_cancelamento) + '</small>' : '') + '</td>' +
                        '<td>' + escHtml(c.padioleiro_nome || '--') + '</td>' +
                        '<td class="td-tempo" title="Tempo da abertura ate o aceite">'      + (c.tempo_aceite_min       != null ? Math.round(c.tempo_aceite_min)       + ' min' : '--') + '</td>' +
                        '<td class="td-tempo" title="Tempo do aceite ate iniciar transporte">' + (c.tempo_deslocamento_min != null ? Math.round(c.tempo_deslocamento_min) + ' min' : '--') + '</td>' +
                        '<td class="td-tempo" title="Tempo do inicio ao fim do transporte">'   + (c.tempo_transporte_min  != null ? Math.round(c.tempo_transporte_min)  + ' min' : '--') + '</td>' +
                        '<td class="td-tempo td-tempo-total" title="Tempo total da abertura ate a conclusao">' + (c.tempo_total_min != null ? Math.round(c.tempo_total_min) + ' min' : '--') + '</td>' +
                        '<td>' + (c.status !== 'concluido' && c.status !== 'cancelado' ? '<button class="btn-cancelar-gestao" data-id="' + c.id + '" style="background:transparent;border:none;color:var(--danger);cursor:pointer;" title="Cancelar"><i class="fas fa-times"></i></button>' : '') + '</td>' +
                    '</tr>';
                }).join('');
                wrapper.innerHTML =
                    '<div class="tabela-wrapper"><table class="tabela"><thead><tr>' +
                    '<th>#</th><th>Data</th><th>Tipo</th><th>Paciente</th><th>Origem</th><th>Destino</th><th>Status</th><th>Padioleiro</th>' +
                    '<th title="Da abertura ate o aceite">T.Aceite</th>' +
                    '<th title="Do aceite ate iniciar o transporte">T.Desloc.</th>' +
                    '<th title="Do inicio ao fim do transporte">T.Transp.</th>' +
                    '<th title="Tempo total">T.Total</th>' +
                    '<th>Ações</th>' +
                    '</tr></thead><tbody>' + linhas + '</tbody></table></div>';

                wrapper.querySelectorAll('.btn-cancelar-gestao').forEach(function (btn) {
                    btn.addEventListener('click', function () { abrirModalCancelarGestao(parseInt(btn.dataset.id)); });
                });
            })
            .catch(function () { wrapper.innerHTML = '<p style="padding:20px;color:#aaa;">Erro de conexao</p>'; });
    }

    // ── EXPORTAR ──────────────────────────────────────────────────

    function exportarCSV() {
        var dias = document.getElementById('filtro-dias').value;
        var url = CONFIG.apiExportar + '?dias=' + dias;
        var link = document.createElement('a');
        link.href = url;
        link.click();
    }

    // ── CONFIG: PADIOLEIROS ───────────────────────────────────────

    function carregarCfgPadioleiros() {
        var lista = document.getElementById('lista-config-padioleiros');
        lista.innerHTML = '<div class="loading"><div class="loading-spinner"></div></div>';
        fetch(CONFIG.cfgPadioleiros, { credentials: 'same-origin' })
            .then(function (r) { return r.json(); })
            .then(function (data) {
                if (!data.success) return;
                renderizarCfgPadioleiros(data.padioleiros);
            });
    }

    function renderizarCfgPadioleiros(lista) {
        var container = document.getElementById('lista-config-padioleiros');
        if (!lista || lista.length === 0) {
            container.innerHTML = '<div class="tabela-vazio"><i class="fas fa-users"></i><p>Nenhum padioleiro cadastrado</p></div>';
            return;
        }
        var turnos = { todos: 'Todos os turnos', manha: 'Manha', tarde: 'Tarde', noite: 'Noite' };
        container.innerHTML = '<div class="config-lista">' +
            lista.map(function (p) {
                return '<div class="config-item ' + (p.ativo ? '' : 'inativo') + '">' +
                    '<i class="fas fa-user-circle" style="font-size:22px;color:' + (p.ativo ? 'var(--cor-primaria)' : '#aaa') + ';flex-shrink:0;"></i>' +
                    '<div class="config-item-info">' +
                        '<div class="config-item-nome">' + escHtml(p.nome) + (p.matricula ? ' <small style="color:#aaa;">Mat. ' + escHtml(p.matricula) + '</small>' : '') + '</div>' +
                        '<div class="config-item-meta"><i class="fas fa-clock"></i> ' + (turnos[p.turno] || p.turno) + ' — Cadastrado: ' + (p.criado_em || '--') + '</div>' +
                    '</div>' +
                    '<div class="config-item-acoes">' +
                        '<button class="btn-editar" title="Editar" data-id="' + p.id + '" data-ctx="padioleiro"><i class="fas fa-pencil-alt"></i></button>' +
                        '<button class="btn-toggle ' + (p.ativo ? 'ativo' : 'inativo') + '" title="' + (p.ativo ? 'Desativar' : 'Ativar') + '" data-id="' + p.id + '" data-ctx="padioleiro" data-ativo="' + p.ativo + '">' +
                            '<i class="fas fa-' + (p.ativo ? 'check' : 'times') + '"></i>' +
                        '</button>' +
                    '</div>' +
                '</div>';
            }).join('') + '</div>';

        container.querySelectorAll('.btn-editar[data-ctx="padioleiro"]').forEach(function (btn) {
            btn.addEventListener('click', function () {
                var item = lista.find(function (p) { return String(p.id) === btn.dataset.id; });
                abrirModalPadioleiro(item);
            });
        });
        container.querySelectorAll('.btn-toggle[data-ctx="padioleiro"]').forEach(function (btn) {
            btn.addEventListener('click', function () {
                toggleAtivo('padioleiro', btn.dataset.id, btn.dataset.ativo === 'true');
            });
        });
    }

    function abrirModalPadioleiro(item) {
        estado.modalContexto = 'padioleiro';
        estado.modalId = item ? item.id : null;
        document.getElementById('modal-edicao-titulo').textContent = item ? 'Editar Padioleiro' : 'Novo Padioleiro';
        document.getElementById('modal-edicao-body').innerHTML =
            '<div class="form-group"><label>Nome *</label><input type="text" id="mf-nome" placeholder="Nome completo" maxlength="200" value="' + escHtml(item ? item.nome : '') + '"></div>' +
            '<div class="form-row-2">' +
                '<div class="form-group"><label>Matricula</label><input type="text" id="mf-matricula" placeholder="Opcional" maxlength="50" value="' + escHtml(item ? (item.matricula || '') : '') + '"></div>' +
                '<div class="form-group"><label>Turno</label><select id="mf-turno">' +
                    ['todos','manha','tarde','noite'].map(function (t) {
                        return '<option value="' + t + '"' + ((item && item.turno === t) ? ' selected' : '') + '>' + (t === 'todos' ? 'Todos os turnos' : t.charAt(0).toUpperCase() + t.slice(1)) + '</option>';
                    }).join('') +
                '</select></div>' +
            '</div>';
        document.getElementById('modal-edicao').style.display = '';
        setTimeout(function () { var el = document.getElementById('mf-nome'); if (el) el.focus(); }, 50);
    }

    // ── CONFIG: TIPOS DE MOVIMENTO ────────────────────────────────

    function carregarCfgTipos() {
        var lista = document.getElementById('lista-config-tipos');
        lista.innerHTML = '<div class="loading"><div class="loading-spinner"></div></div>';
        fetch(CONFIG.cfgTipos, { credentials: 'same-origin' })
            .then(function (r) { return r.json(); })
            .then(function (data) {
                if (!data.success) return;
                estado.tiposMovimento = data.tipos;
                renderizarCfgTipos(data.tipos);
                atualizarFiltroTiposDestino(data.tipos);
            });
    }

    function renderizarCfgTipos(lista) {
        var container = document.getElementById('lista-config-tipos');
        if (!lista || lista.length === 0) {
            container.innerHTML = '<div class="tabela-vazio"><i class="fas fa-route"></i><p>Nenhum tipo cadastrado</p></div>';
            return;
        }
        container.innerHTML = '<div class="config-lista">' +
            lista.map(function (t) {
                return '<div class="config-item ' + (t.ativo ? '' : 'inativo') + '">' +
                    '<div class="tipo-cor-dot" style="background:' + escHtml(t.cor) + ';"></div>' +
                    '<i class="fas ' + escHtml(t.icone) + '" style="font-size:18px;color:' + escHtml(t.cor) + ';flex-shrink:0;"></i>' +
                    '<div class="config-item-info">' +
                        '<div class="config-item-nome">' + escHtml(t.nome) + '</div>' +
                        '<div class="config-item-meta">Icone: ' + escHtml(t.icone) + ' — Cor: ' + escHtml(t.cor) + ' — Ordem: ' + t.ordem + '</div>' +
                    '</div>' +
                    '<div class="config-item-acoes">' +
                        '<button class="btn-editar" data-id="' + t.id + '" data-ctx="tipo" title="Editar"><i class="fas fa-pencil-alt"></i></button>' +
                        '<button class="btn-toggle ' + (t.ativo ? 'ativo' : 'inativo') + '" data-id="' + t.id + '" data-ctx="tipo" data-ativo="' + t.ativo + '" title="' + (t.ativo ? 'Desativar' : 'Ativar') + '">' +
                            '<i class="fas fa-' + (t.ativo ? 'check' : 'times') + '"></i>' +
                        '</button>' +
                    '</div>' +
                '</div>';
            }).join('') + '</div>';

        container.querySelectorAll('.btn-editar[data-ctx="tipo"]').forEach(function (btn) {
            btn.addEventListener('click', function () {
                var item = lista.find(function (t) { return String(t.id) === btn.dataset.id; });
                abrirModalTipo(item);
            });
        });
        container.querySelectorAll('.btn-toggle[data-ctx="tipo"]').forEach(function (btn) {
            btn.addEventListener('click', function () {
                toggleAtivo('tipo', btn.dataset.id, btn.dataset.ativo === 'true');
            });
        });
    }

    function abrirModalTipo(item) {
        estado.modalContexto = 'tipo';
        estado.modalId = item ? item.id : null;
        document.getElementById('modal-edicao-titulo').textContent = item ? 'Editar Tipo de Movimento' : 'Novo Tipo de Movimento';
        document.getElementById('modal-edicao-body').innerHTML =
            '<div class="form-group"><label>Nome *</label><input type="text" id="mf-nome" placeholder="Ex: Para Exames" maxlength="100" value="' + escHtml(item ? item.nome : '') + '"></div>' +
            '<div class="form-row-2">' +
                '<div class="form-group"><label>Icone FontAwesome</label><input type="text" id="mf-icone" placeholder="Ex: fa-vials" maxlength="50" value="' + escHtml(item ? item.icone : 'fa-ambulance') + '"></div>' +
                '<div class="form-group"><label>Cor (hex)</label><input type="color" id="mf-cor" value="' + escHtml(item ? item.cor : '#dc3545') + '" style="height:42px;padding:4px;cursor:pointer;"></div>' +
            '</div>' +
            '<div class="form-group"><label>Ordem</label><input type="number" id="mf-ordem" value="' + (item ? item.ordem : 0) + '" min="0" max="99"></div>';
        document.getElementById('modal-edicao').style.display = '';
    }

    // ── CONFIG: DESTINOS ──────────────────────────────────────────

    function carregarDestinos() {
        var lista = document.getElementById('lista-config-destinos');
        lista.innerHTML = '<div class="loading"><div class="loading-spinner"></div></div>';
        var tipoId = document.getElementById('filtro-tipo-destino').value;
        var url = CONFIG.cfgDestinos + (tipoId ? '?tipo_id=' + tipoId : '');
        fetch(url, { credentials: 'same-origin' })
            .then(function (r) { return r.json(); })
            .then(function (data) {
                if (!data.success) return;
                renderizarCfgDestinos(data.destinos);
            });
    }

    function renderizarCfgDestinos(lista) {
        var container = document.getElementById('lista-config-destinos');
        if (!lista || lista.length === 0) {
            container.innerHTML = '<div class="tabela-vazio"><i class="fas fa-map-marker-alt"></i><p>Nenhum destino cadastrado</p></div>';
            return;
        }
        container.innerHTML = '<div class="config-lista">' +
            lista.map(function (d) {
                return '<div class="config-item ' + (d.ativo ? '' : 'inativo') + '">' +
                    '<i class="fas fa-map-marker-alt" style="color:' + (d.ativo ? 'var(--cor-primaria)' : '#aaa') + ';font-size:18px;flex-shrink:0;"></i>' +
                    '<div class="config-item-info">' +
                        '<div class="config-item-nome">' + escHtml(d.nome) + '</div>' +
                        '<div class="config-item-meta"><i class="fas fa-route"></i> ' + escHtml(d.tipo_nome || '-') + ' — Ordem: ' + d.ordem + '</div>' +
                    '</div>' +
                    '<div class="config-item-acoes">' +
                        '<button class="btn-editar" data-id="' + d.id + '" data-ctx="destino" title="Editar"><i class="fas fa-pencil-alt"></i></button>' +
                        '<button class="btn-toggle ' + (d.ativo ? 'ativo' : 'inativo') + '" data-id="' + d.id + '" data-ctx="destino" data-ativo="' + d.ativo + '" title="' + (d.ativo ? 'Desativar' : 'Ativar') + '">' +
                            '<i class="fas fa-' + (d.ativo ? 'check' : 'times') + '"></i>' +
                        '</button>' +
                    '</div>' +
                '</div>';
            }).join('') + '</div>';

        container.querySelectorAll('.btn-editar[data-ctx="destino"]').forEach(function (btn) {
            btn.addEventListener('click', function () {
                var item = lista.find(function (d) { return String(d.id) === btn.dataset.id; });
                abrirModalDestino(item);
            });
        });
        container.querySelectorAll('.btn-toggle[data-ctx="destino"]').forEach(function (btn) {
            btn.addEventListener('click', function () {
                toggleAtivo('destino', btn.dataset.id, btn.dataset.ativo === 'true');
            });
        });
    }

    function abrirModalDestino(item) {
        estado.modalContexto = 'destino';
        estado.modalId = item ? item.id : null;
        document.getElementById('modal-edicao-titulo').textContent = item ? 'Editar Destino' : 'Novo Destino';
        var opsTipo = estado.tiposMovimento.map(function (t) {
            return '<option value="' + t.id + '"' + ((item && String(item.tipo_movimento_id) === String(t.id)) ? ' selected' : '') + '>' + escHtml(t.nome) + '</option>';
        }).join('');
        document.getElementById('modal-edicao-body').innerHTML =
            '<div class="form-group"><label>Nome *</label><input type="text" id="mf-nome" placeholder="Ex: Laboratorio Central" maxlength="200" value="' + escHtml(item ? item.nome : '') + '"></div>' +
            '<div class="form-group"><label>Tipo de Movimento *</label><select id="mf-tipo-id"><option value="">Selecione...</option>' + opsTipo + '</select></div>' +
            '<div class="form-group"><label>Ordem</label><input type="number" id="mf-ordem" value="' + (item ? item.ordem : 0) + '" min="0" max="99"></div>';
        document.getElementById('modal-edicao').style.display = '';
    }

    function atualizarFiltroTiposDestino(tipos) {
        var sel = document.getElementById('filtro-tipo-destino');
        var atualVal = sel.value;
        sel.innerHTML = '<option value="">Todos os tipos</option>' +
            tipos.map(function (t) {
                return '<option value="' + t.id + '"' + (String(t.id) === atualVal ? ' selected' : '') + '>' + escHtml(t.nome) + '</option>';
            }).join('');
    }

    function carregarTiposParaFiltro() {
        fetch(CONFIG.cfgTipos, { credentials: 'same-origin' })
            .then(function (r) { return r.json(); })
            .then(function (data) {
                if (!data.success) return;
                estado.tiposMovimento = data.tipos;
                atualizarFiltroTiposDestino(data.tipos);
            });
    }

    // ── TOGGLE ATIVO ──────────────────────────────────────────────

    function toggleAtivo(ctx, id, atualAtivo) {
        var urlMap = { padioleiro: CONFIG.cfgPadioleiros, tipo: CONFIG.cfgTipos, destino: CONFIG.cfgDestinos };
        var url = urlMap[ctx] + '/' + id;
        fetch(url, {
            method: 'PUT',
            credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ativo: !atualAtivo })
        })
        .then(function (r) { return r.json(); })
        .then(function (data) {
            if (data.success) {
                mostrarToast(atualAtivo ? 'Desativado com sucesso' : 'Ativado com sucesso', 'success');
                carregarConfigAtual();
            } else {
                mostrarToast(data.error || 'Erro', 'error');
            }
        })
        .catch(function () { mostrarToast('Erro de conexao', 'error'); });
    }

    // ── MODAL SALVAR ──────────────────────────────────────────────

    function fecharModal() {
        document.getElementById('modal-edicao').style.display = 'none';
        estado.modalContexto = null;
        estado.modalId = null;
    }

    function salvarModal() {
        if (estado.salvando) return;
        var ctx = estado.modalContexto;
        var id  = estado.modalId;
        var btn = document.getElementById('btn-modal-salvar');

        var body = {};
        if (ctx === 'padioleiro') {
            var nome = (document.getElementById('mf-nome').value || '').trim();
            if (!nome) { mostrarToast('Nome e obrigatorio', 'warning'); return; }
            body = {
                nome: nome,
                matricula: (document.getElementById('mf-matricula').value || '').trim(),
                turno: document.getElementById('mf-turno').value
            };
        } else if (ctx === 'tipo') {
            var nome2 = (document.getElementById('mf-nome').value || '').trim();
            if (!nome2) { mostrarToast('Nome e obrigatorio', 'warning'); return; }
            body = {
                nome:  nome2,
                icone: (document.getElementById('mf-icone').value || '').trim(),
                cor:   document.getElementById('mf-cor').value,
                ordem: parseInt(document.getElementById('mf-ordem').value) || 0
            };
        } else if (ctx === 'destino') {
            var nome3 = (document.getElementById('mf-nome').value || '').trim();
            var tipoId = document.getElementById('mf-tipo-id').value;
            if (!nome3 || !tipoId) { mostrarToast('Nome e tipo sao obrigatorios', 'warning'); return; }
            body = {
                nome: nome3,
                tipo_movimento_id: parseInt(tipoId),
                ordem: parseInt(document.getElementById('mf-ordem').value) || 0
            };
        }

        var urlMap = { padioleiro: CONFIG.cfgPadioleiros, tipo: CONFIG.cfgTipos, destino: CONFIG.cfgDestinos };
        var url    = urlMap[ctx] + (id ? '/' + id : '');
        var method = id ? 'PUT' : 'POST';

        estado.salvando = true;
        btn.disabled = true;
        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Salvando...';

        fetch(url, {
            method: method,
            credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        })
        .then(function (r) { return r.json(); })
        .then(function (data) {
            if (data.success) {
                mostrarToast(id ? 'Atualizado com sucesso' : 'Cadastrado com sucesso', 'success');
                fecharModal();
                carregarConfigAtual();
            } else {
                mostrarToast(data.error || 'Erro ao salvar', 'error');
            }
        })
        .catch(function () { mostrarToast('Erro de conexao', 'error'); })
        .finally(function () {
            estado.salvando = false;
            btn.disabled = false;
            btn.innerHTML = '<i class="fas fa-save"></i> Salvar';
        });
    }

    // ── CANCELAMENTO GESTAO ───────────────────────────────────────

    function abrirModalCancelarGestao(id) {
        estado.chamadoCancelarId = id;
        document.getElementById('motivo-cancelamento-gestao').value = '';
        document.getElementById('modal-cancelar').style.display = '';
    }

    function fecharModalCancelarGestao() {
        document.getElementById('modal-cancelar').style.display = 'none';
        estado.chamadoCancelarId = null;
    }

    function confirmarCancelamentoGestao() {
        var id = estado.chamadoCancelarId;
        if (!id) return;

        var motivo = document.getElementById('motivo-cancelamento-gestao').value.trim();
        if (motivo.length < 10) {
            mostrarToast('O motivo do cancelamento deve ter pelo menos 10 caracteres', 'warning');
            return;
        }

        var btn = document.getElementById('btn-cancelar-gestao-sim');
        btn.disabled = true;
        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Cancelando...';

        var url = CONFIG.apiCancelar.replace('{id}', id);
        fetch(url, {
            method: 'PUT',
            credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ motivo: motivo })
        })
        .then(function (r) { return r.json(); })
        .then(function (data) {
            fecharModalCancelarGestao();
            if (data.success) {
                mostrarToast('Chamado cancelado com sucesso.', 'success');
                carregarAbaAtual();
            } else {
                mostrarToast(data.error || 'Erro ao cancelar chamado', 'error');
            }
        })
        .catch(function () { mostrarToast('Erro de conexao', 'error'); })
        .finally(function () {
            btn.disabled = false;
            btn.innerHTML = '<i class="fas fa-times"></i> Confirmar Cancelamento';
        });
    }

    // ── UTILITARIOS ───────────────────────────────────────────────

    function badgeStatus(status) {
        return '<span class="badge-status badge-' + status + '">' + {
            aguardando: 'Aguardando', aceito: 'Aceito',
            em_transporte: 'Em Transporte', concluido: 'Concluido', cancelado: 'Cancelado'
        }[status] + '</span>';
    }

    function escHtml(str) {
        if (!str) return '';
        return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    function mostrarToast(msg, tipo) {
        var container = document.getElementById('toast-container');
        var toast = document.createElement('div');
        toast.className = 'toast toast-' + (tipo || 'info');
        toast.textContent = msg;
        container.appendChild(toast);
        setTimeout(function () { toast.remove(); }, 3500);
    }

    window.addEventListener('DOMContentLoaded', inicializar);
})();
