(function() {
    'use strict';

    var CONFIG = {
        urlBase: '/api/paineis/painel26',
        intervaloAtualizacao: 60000
    };

    var Estado = {
        tipos: [],
        especialidades: [],
        destinatarios: [],
        gruposArr: [],      // array global indexado; rebuilt em cada carregarDestinatarios
        editandoGrupo: null,
        abaAtiva: null,
        timerAtualizacao: null
    };

    var DOM = {};

    // =========================================================
    // DOM
    // =========================================================

    function capturarDOM() {
        DOM.kpiDestinatarios        = document.getElementById('kpi-destinatarios');
        DOM.kpiTipos                = document.getElementById('kpi-tipos');
        DOM.kpiEnviadosHoje         = document.getElementById('kpi-enviados-hoje');
        DOM.kpiErrosHoje            = document.getElementById('kpi-erros-hoje');
        DOM.ultimaAtualizacao       = document.getElementById('ultima-atualizacao');
        DOM.statusIndicator         = document.getElementById('status-indicator');
        DOM.btnRefresh              = document.getElementById('btn-refresh');
        DOM.btnVoltar               = document.getElementById('btn-voltar');
        DOM.tabsNav                 = document.getElementById('tabs-nav');
        DOM.tabPanels               = document.getElementById('tab-panels');
        DOM.histKpis                = document.getElementById('hist-kpis');
        DOM.histPorTipo             = document.getElementById('hist-por-tipo');
        DOM.timelineHistorico       = document.getElementById('timeline-historico');
        DOM.contadorHistorico       = document.getElementById('contador-historico');
        DOM.modalOverlay            = document.getElementById('modal-overlay');
        DOM.modalTitulo             = document.getElementById('modal-titulo');
        DOM.modalFechar             = document.getElementById('modal-fechar');
        DOM.btnCancelar             = document.getElementById('btn-cancelar');
        DOM.btnSalvar               = document.getElementById('btn-salvar');
        DOM.campoTipo               = document.getElementById('campo-tipo');
        DOM.campoNome               = document.getElementById('campo-nome');
        DOM.campoEmail              = document.getElementById('campo-email');
        DOM.campoEspecialidadeLista = document.getElementById('campo-especialidade-lista');
        DOM.labelEspecHint          = document.getElementById('label-espec-hint');
        DOM.avisoEditEspec          = document.getElementById('aviso-edit-espec');
        DOM.campoSetor              = document.getElementById('campo-setor');
        DOM.campoCanal              = document.getElementById('campo-canal');
        DOM.campoDescricao          = document.getElementById('campo-descricao');
    }

    // =========================================================
    // HELPERS
    // =========================================================

    function escapeHtml(texto) {
        if (texto === null || texto === undefined) return '';
        var div = document.createElement('div');
        div.appendChild(document.createTextNode(String(texto)));
        return div.innerHTML;
    }

    function atualizarStatus(s) {
        if (!DOM.statusIndicator) return;
        DOM.statusIndicator.className = 'status-indicator';
        if (s === 'online')   DOM.statusIndicator.classList.add('status-online');
        else if (s === 'offline') DOM.statusIndicator.classList.add('status-offline');
        else if (s === 'loading') DOM.statusIndicator.classList.add('status-loading');
    }

    function atualizarHorario() {
        if (!DOM.ultimaAtualizacao) return;
        DOM.ultimaAtualizacao.textContent = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    }

    function fetchJSON(url, opcoes) {
        opcoes = opcoes || {};
        opcoes.credentials = 'same-origin';
        opcoes.headers = opcoes.headers || {};
        if (opcoes.body) opcoes.headers['Content-Type'] = 'application/json';
        return fetch(url, opcoes).then(function(r) { return r.json(); });
    }

    // =========================================================
    // ABAS
    // =========================================================

    function gerarAbas(tipos) {
        if (!DOM.tabsNav || !DOM.tabPanels) return;

        var navHtml = '';
        var panelsHtml = '';

        // Historico — PRIMEIRA aba na nav
        navHtml += '<button class="tab-nav-btn tab-historico-btn" data-tab="historico">';
        navHtml += '<i class="fas fa-history"></i> <span>Historico</span></button>';

        // Abas por tipo de evento
        for (var i = 0; i < tipos.length; i++) {
            var t = tipos[i];
            var cod = escapeHtml(t.codigo);
            var icone = escapeHtml(t.icone || 'fa-bell');
            var nome = escapeHtml(t.nome);
            var cor = t.cor || '#dc3545';

            navHtml += '<button class="tab-nav-btn" data-tab="tipo-' + cod + '" style="--tab-cor:' + cor + '">';
            navHtml += '<i class="fas ' + icone + '"></i> <span>' + nome + '</span></button>';

            panelsHtml += '<div class="tab-panel" id="tab-tipo-' + cod + '">';
            panelsHtml += '<div class="painel-main content-scroll">';
            panelsHtml += '<div class="tipo-filtros-bar">';
            panelsHtml += '<select class="filtro-select-interno filtro-espec-tab" data-tipo="' + cod + '">';
            panelsHtml += '<option value="">Todas especialidades</option></select>';
            panelsHtml += '<select class="filtro-select-interno filtro-ativo-tab" data-tipo="' + cod + '">';
            panelsHtml += '<option value="">Todos</option><option value="true">Ativos</option><option value="false">Inativos</option></select>';
            panelsHtml += '<button class="btn-acao-primario btn-novo-tipo" data-tipo="' + cod + '">';
            panelsHtml += '<i class="fas fa-plus"></i> Novo Destinatario</button>';
            panelsHtml += '</div>';
            panelsHtml += '<div class="tabela-wrapper tabela-tipo" id="tabela-tipo-' + cod + '">';
            panelsHtml += '<div class="loading-container"><div class="loading-spinner"></div><p>Carregando...</p></div>';
            panelsHtml += '</div></div></div>';
        }

        // Aba Em Construção — Exames e Procedimentos
        navHtml += '<button class="tab-nav-btn tab-construcao-btn" data-tab="em-construcao">';
        navHtml += '<i class="fas fa-flask"></i> <span>Exames e Procedimentos</span></button>';

        panelsHtml += '<div class="tab-panel" id="tab-em-construcao">';
        panelsHtml += '<div class="painel-main content-scroll em-construcao-container">';
        panelsHtml += '<div class="em-construcao-msg">';
        panelsHtml += '<i class="fas fa-tools"></i>';
        panelsHtml += '<h2>Em Construcao</h2>';
        panelsHtml += '<p>Esta aba esta sendo desenvolvida e estara disponivel em breve.</p>';
        panelsHtml += '</div></div></div>';

        DOM.tabsNav.innerHTML = navHtml;
        DOM.tabPanels.insertAdjacentHTML('afterbegin', panelsHtml);

        // Bind: botoes de aba
        var btns = DOM.tabsNav.querySelectorAll('.tab-nav-btn');
        for (var j = 0; j < btns.length; j++) {
            btns[j].addEventListener('click', function() {
                mudarAba(this.getAttribute('data-tab'));
            });
        }

        // Bind: filtros e botao Novo (delegado no container)
        DOM.tabPanels.addEventListener('change', function(e) {
            var el = e.target;
            if (!el || !el.classList) return;
            if (el.classList.contains('filtro-espec-tab') || el.classList.contains('filtro-ativo-tab')) {
                renderizarTodosOsTabs();
            }
        });

        DOM.tabPanels.addEventListener('click', function(e) {
            var el = e.target;
            while (el && el !== DOM.tabPanels) {
                if (el.classList && el.classList.contains('btn-novo-tipo')) {
                    novoParaTipo(el.getAttribute('data-tipo'));
                    return;
                }
                el = el.parentElement;
            }
        });

        // Ativa Historico por padrao ao carregar
        mudarAba('historico');

        // Popula filtros de especialidade se ja carregados
        if (Estado.especialidades.length > 0) {
            popularFiltrosEspecTab();
        }
    }

    function mudarAba(tabId) {
        Estado.abaAtiva = tabId;

        var btns = DOM.tabsNav.querySelectorAll('.tab-nav-btn');
        for (var i = 0; i < btns.length; i++) {
            if (btns[i].getAttribute('data-tab') === tabId) {
                btns[i].classList.add('active');
            } else {
                btns[i].classList.remove('active');
            }
        }

        var panels = DOM.tabPanels.querySelectorAll('.tab-panel');
        for (var j = 0; j < panels.length; j++) {
            panels[j].classList.remove('active');
        }

        var panelId = (tabId === 'historico') ? 'tab-historico' : ('tab-' + tabId);
        var alvo = document.getElementById(panelId);
        if (alvo) alvo.classList.add('active');

        if (tabId === 'historico') carregarHistorico();
    }

    function novoParaTipo(tipoCodigo) {
        abrirModal();
        if (DOM.campoTipo) DOM.campoTipo.value = tipoCodigo;
    }

    function popularFiltrosEspecTab() {
        if (!DOM.tabPanels) return;
        var opts = '<option value="">Todas especialidades</option>';
        for (var i = 0; i < Estado.especialidades.length; i++) {
            opts += '<option value="' + escapeHtml(Estado.especialidades[i]) + '">' + escapeHtml(Estado.especialidades[i]) + '</option>';
        }
        var selects = DOM.tabPanels.querySelectorAll('.filtro-espec-tab');
        for (var j = 0; j < selects.length; j++) {
            var cur = selects[j].value;
            selects[j].innerHTML = opts;
            selects[j].value = cur; // preserva seleção atual
        }
    }

    // =========================================================
    // DASHBOARD
    // =========================================================

    function carregarDashboard() {
        atualizarStatus('loading');
        fetchJSON(CONFIG.urlBase + '/dashboard').then(function(resp) {
            if (!resp.success) return;
            if (DOM.kpiDestinatarios) DOM.kpiDestinatarios.textContent = resp.total_destinatarios || 0;
            if (DOM.kpiTipos) DOM.kpiTipos.textContent = resp.total_tipos || 0;
            if (DOM.kpiEnviadosHoje) DOM.kpiEnviadosHoje.textContent = resp.envios_hoje ? resp.envios_hoje.total_hoje : 0;
            if (DOM.kpiErrosHoje) DOM.kpiErrosHoje.textContent = resp.envios_hoje ? resp.envios_hoje.erro_hoje : 0;
            var cards = document.querySelectorAll('.resumo-card');
            for (var i = 0; i < cards.length; i++) {
                cards[i].classList.add('atualizando');
                (function(c) { setTimeout(function() { c.classList.remove('atualizando'); }, 300); })(cards[i]);
            }
            atualizarStatus('online');
            atualizarHorario();
        }).catch(function() { atualizarStatus('offline'); });
    }

    // =========================================================
    // TIPOS
    // =========================================================

    function carregarTipos() {
        fetchJSON(CONFIG.urlBase + '/tipos').then(function(resp) {
            if (!resp.success) return;
            // Parecer Médico sempre primeiro
            var dados = resp.data.slice().sort(function(a, b) {
                if (a.codigo === 'parecer_pendente') return -1;
                if (b.codigo === 'parecer_pendente') return 1;
                return 0;
            });
            Estado.tipos = dados;
            var htmlModal = '<option value="">Selecione...</option>';
            for (var i = 0; i < dados.length; i++) {
                var t = dados[i];
                htmlModal += '<option value="' + escapeHtml(t.codigo) + '">' + escapeHtml(t.nome) + '</option>';
            }
            if (DOM.campoTipo) DOM.campoTipo.innerHTML = htmlModal;
            gerarAbas(dados);
        });
    }

    // =========================================================
    // ESPECIALIDADES
    // =========================================================

    function carregarEspecialidades() {
        fetchJSON(CONFIG.urlBase + '/especialidades').then(function(resp) {
            if (!resp.success) return;
            Estado.especialidades = resp.data;
            renderizarCheckboxesEspecialidade(resp.data);
            popularFiltrosEspecTab();
        });
    }

    function renderizarCheckboxesEspecialidade(lista) {
        if (!DOM.campoEspecialidadeLista) return;
        var html = '<label class="espec-check-item espec-check-todas"><input type="checkbox" class="espec-checkbox" id="espec-todas" value=""><span>Todas (recebe de todas as especialidades)</span></label>';
        for (var i = 0; i < lista.length; i++) {
            html += '<label class="espec-check-item"><input type="checkbox" class="espec-checkbox" value="' + escapeHtml(lista[i]) + '"><span>' + escapeHtml(lista[i]) + '</span></label>';
        }
        DOM.campoEspecialidadeLista.innerHTML = html;
        vincularLogicaTodas();
    }

    function vincularLogicaTodas() {
        var todasChk = document.getElementById('espec-todas');
        if (!todasChk) return;
        todasChk.addEventListener('change', function() {
            if (this.checked) {
                var outros = DOM.campoEspecialidadeLista.querySelectorAll('.espec-checkbox:not(#espec-todas)');
                for (var i = 0; i < outros.length; i++) outros[i].checked = false;
            }
        });
        var especificos = DOM.campoEspecialidadeLista.querySelectorAll('.espec-checkbox:not(#espec-todas)');
        for (var i = 0; i < especificos.length; i++) {
            especificos[i].addEventListener('change', function() {
                if (this.checked) {
                    var todas = document.getElementById('espec-todas');
                    if (todas) todas.checked = false;
                }
            });
        }
    }

    function desmarcarTodasEspecialidades() {
        if (!DOM.campoEspecialidadeLista) return;
        var checkboxes = DOM.campoEspecialidadeLista.querySelectorAll('.espec-checkbox');
        for (var i = 0; i < checkboxes.length; i++) checkboxes[i].checked = false;
    }

    function checkEspecialidade(valor) {
        if (!DOM.campoEspecialidadeLista) return;
        var checkboxes = DOM.campoEspecialidadeLista.querySelectorAll('.espec-checkbox');
        for (var i = 0; i < checkboxes.length; i++) {
            if (checkboxes[i].value === (valor || '')) { checkboxes[i].checked = true; break; }
        }
    }

    function obterEspecialidadesSelecionadas() {
        var result = [];
        if (!DOM.campoEspecialidadeLista) return result;
        var checkboxes = DOM.campoEspecialidadeLista.querySelectorAll('.espec-checkbox');
        for (var i = 0; i < checkboxes.length; i++) {
            if (checkboxes[i].checked) result.push(checkboxes[i].value);
        }
        return result;
    }

    // =========================================================
    // DESTINATÁRIOS
    // =========================================================

    function carregarDestinatarios() {
        fetchJSON(CONFIG.urlBase + '/destinatarios').then(function(resp) {
            if (!resp.success) return;
            Estado.destinatarios = resp.data;
            renderizarTodosOsTabs();
        }).catch(function(err) { console.error('Erro destinatarios:', err); });
    }

    function renderizarTodosOsTabs() {
        Estado.gruposArr = [];
        for (var i = 0; i < Estado.tipos.length; i++) {
            renderizarTabPorTipo(Estado.tipos[i].codigo);
        }
    }

    function renderizarTabPorTipo(tipoCodigo) {
        var container = document.getElementById('tabela-tipo-' + tipoCodigo);
        if (!container) return;

        var espEl   = DOM.tabPanels ? DOM.tabPanels.querySelector('.filtro-espec-tab[data-tipo="' + tipoCodigo + '"]') : null;
        var ativoEl = DOM.tabPanels ? DOM.tabPanels.querySelector('.filtro-ativo-tab[data-tipo="' + tipoCodigo + '"]') : null;
        var espVal   = espEl   ? espEl.value   : '';
        var ativoVal = ativoEl ? ativoEl.value : '';

        var filtrados = [];
        for (var i = 0; i < Estado.destinatarios.length; i++) {
            var d = Estado.destinatarios[i];
            if (d.tipo_evento !== tipoCodigo) continue;
            if (espVal && d.especialidade !== espVal) continue;
            if (ativoVal === 'true'  && !d.ativo) continue;
            if (ativoVal === 'false' &&  d.ativo) continue;
            filtrados.push(d);
        }

        renderizarTabela(filtrados, container);
    }

    function renderizarTabela(dados, container) {
        if (!dados || dados.length === 0) {
            container.innerHTML = '<p class="texto-vazio">Nenhum destinatario cadastrado</p>';
            return;
        }

        // Agrupar por email (o tipo ja esta filtrado pela aba)
        var mapaGrupos = {};
        var ordemGrupos = [];
        for (var i = 0; i < dados.length; i++) {
            var d = dados[i];
            if (!mapaGrupos[d.email]) {
                mapaGrupos[d.email] = { meta: d, items: [] };
                ordemGrupos.push(d.email);
            }
            mapaGrupos[d.email].items.push(d);
        }

        var html = '<table class="tabela-dest"><thead><tr>';
        html += '<th></th><th>Nome</th><th>Email</th><th>Especialidades</th><th>Canal</th><th>Acoes</th>';
        html += '</tr></thead><tbody>';

        for (var k = 0; k < ordemGrupos.length; k++) {
            var grp = mapaGrupos[ordemGrupos[k]];
            var idx = Estado.gruposArr.length;
            Estado.gruposArr.push(grp);

            var meta  = grp.meta;
            var ativo = meta.ativo;

            html += '<tr' + (ativo ? '' : ' class="inativo"') + '>';
            html += '<td><span class="badge-status' + (ativo ? '' : ' inativo') + '"></span></td>';

            html += '<td><strong>' + escapeHtml(meta.nome) + '</strong>';
            if (meta.descricao) html += '<br><small class="dest-descricao">' + escapeHtml(meta.descricao) + '</small>';
            html += '</td>';

            html += '<td class="email-col"><i class="fas fa-envelope email-icon"></i> ' + escapeHtml(meta.email) + '</td>';

            html += '<td><div class="espec-badges">';
            for (var m = 0; m < grp.items.length; m++) {
                var it = grp.items[m];
                if (it.especialidade) {
                    html += '<span class="badge-espec">' + escapeHtml(it.especialidade) + '</span>';
                } else {
                    html += '<span class="badge-espec badge-espec-geral">Todas</span>';
                }
            }
            html += '</div></td>';

            var classeCanal = meta.canal === 'ntfy' ? ' badge-canal-ntfy' : '';
            html += '<td><span class="badge-canal' + classeCanal + '">' + escapeHtml(meta.canal || 'email') + '</span></td>';

            html += '<td><div class="acoes-grupo">';
            html += '<button class="btn-acao btn-editar" onclick="window.P26.editarGrupo(' + idx + ')" title="Editar"><i class="fas fa-pen"></i></button>';
            var iconeToggle = ativo ? 'fa-toggle-on' : 'fa-toggle-off';
            html += '<button class="btn-acao btn-toggle' + (ativo ? '' : ' inativo') + '" onclick="window.P26.toggleGrupo(' + idx + ')" title="Ativar/Desativar"><i class="fas ' + iconeToggle + '"></i></button>';
            html += '<button class="btn-acao btn-excluir" onclick="window.P26.excluirGrupo(' + idx + ')" title="Excluir"><i class="fas fa-trash"></i></button>';
            html += '</div></td>';
            html += '</tr>';
        }

        html += '</tbody></table>';
        container.innerHTML = html;
    }

    // =========================================================
    // HISTÓRICO
    // =========================================================

    function carregarHistorico() {
        fetchJSON(CONFIG.urlBase + '/historico?limite=200').then(function(resp) {
            if (!resp.success) return;
            if (DOM.contadorHistorico) DOM.contadorHistorico.textContent = resp.total + ' envios';
            renderizarHistoricoStats(resp.data);
            renderizarTimeline(resp.data);
        }).catch(function(err) { console.error('Erro historico:', err); });
    }

    function renderizarHistoricoStats(dados) {
        var total   = dados.length;
        var sucesso = 0;
        var erro    = 0;
        var porTipo = {};

        for (var i = 0; i < dados.length; i++) {
            var h = dados[i];
            if (h.sucesso) sucesso++; else erro++;
            var tn = h.tipo_evento_nome || h.tipo_evento;
            if (!porTipo[tn]) porTipo[tn] = { total: 0, sucesso: 0, cor: h.tipo_evento_cor || '#dc3545' };
            porTipo[tn].total++;
            if (h.sucesso) porTipo[tn].sucesso++;
        }

        // KPIs
        if (DOM.histKpis) {
            var taxa = total > 0 ? Math.round(sucesso * 100 / total) : 0;
            var html = '';
            html += '<div class="hist-kpi-card"><div class="hist-kpi-icon"><i class="fas fa-paper-plane"></i></div>';
            html += '<div class="hist-kpi-info"><span class="hist-kpi-val">' + total + '</span><span class="hist-kpi-label">Envios Hoje</span></div></div>';
            html += '<div class="hist-kpi-card hist-kpi-sucesso"><div class="hist-kpi-icon"><i class="fas fa-check-circle"></i></div>';
            html += '<div class="hist-kpi-info"><span class="hist-kpi-val">' + sucesso + '</span><span class="hist-kpi-label">Com Sucesso</span></div></div>';
            html += '<div class="hist-kpi-card hist-kpi-erro"><div class="hist-kpi-icon"><i class="fas fa-times-circle"></i></div>';
            html += '<div class="hist-kpi-info"><span class="hist-kpi-val">' + erro + '</span><span class="hist-kpi-label">Com Erro</span></div></div>';
            html += '<div class="hist-kpi-card hist-kpi-taxa"><div class="hist-kpi-icon"><i class="fas fa-percentage"></i></div>';
            html += '<div class="hist-kpi-info"><span class="hist-kpi-val">' + taxa + '%</span><span class="hist-kpi-label">Taxa Sucesso</span></div></div>';
            DOM.histKpis.innerHTML = html;
        }

        // Por tipo
        if (DOM.histPorTipo) {
            var tiposKeys = [];
            for (var k in porTipo) {
                if (porTipo.hasOwnProperty(k)) tiposKeys.push(k);
            }
            tiposKeys.sort(function(a, b) { return porTipo[b].total - porTipo[a].total; });

            if (tiposKeys.length === 0) {
                DOM.histPorTipo.innerHTML = '<p class="texto-vazio">Sem envios registrados hoje</p>';
            } else {
                var max = porTipo[tiposKeys[0]].total;
                var htmlTipos = '';
                for (var t = 0; t < tiposKeys.length; t++) {
                    var nome = tiposKeys[t];
                    var info = porTipo[nome];
                    var pct  = max > 0 ? Math.round(info.total * 100 / max) : 0;
                    htmlTipos += '<div class="hist-bar-row">';
                    htmlTipos += '<span class="hist-bar-label">' + escapeHtml(nome) + '</span>';
                    htmlTipos += '<div class="hist-bar-track"><div class="hist-bar-fill" style="width:' + pct + '%;background:' + info.cor + '"></div></div>';
                    htmlTipos += '<span class="hist-bar-count">' + info.total + ' <small>(' + info.sucesso + ' ok)</small></span>';
                    htmlTipos += '</div>';
                }
                DOM.histPorTipo.innerHTML = htmlTipos;
            }
        }
    }

    function renderizarTimeline(dados) {
        if (!DOM.timelineHistorico) return;
        if (!dados || dados.length === 0) {
            DOM.timelineHistorico.innerHTML = '<p class="texto-vazio">Nenhum envio registrado ainda</p>';
            return;
        }
        var html = '';
        for (var i = 0; i < dados.length; i++) {
            var h = dados[i];
            var classeIcone = h.sucesso ? 'sucesso' : 'erro';
            var icone = h.sucesso ? 'fa-check' : 'fa-times';
            var canalBadge = h.canal === 'email'
                ? '<span class="canal-badge canal-email"><i class="fas fa-envelope"></i> email</span>'
                : '<span class="canal-badge canal-ntfy"><i class="fas fa-mobile-alt"></i> ntfy</span>';

            html += '<div class="timeline-item">';
            html += '<div class="timeline-icone ' + classeIcone + '"><i class="fas ' + icone + '"></i></div>';
            html += '<div class="timeline-info">';
            html += '<div class="timeline-titulo">' + escapeHtml(h.titulo || 'Notificacao') + '</div>';
            html += '<div class="timeline-detalhe">';
            html += '<span class="timeline-tipo">' + escapeHtml(h.tipo_evento_nome || h.tipo_evento) + '</span>';
            html += ' ' + canalBadge;
            if (h.qt_destinatarios) html += ' <span class="timeline-qtd">' + h.qt_destinatarios + 'x</span>';
            html += '</div>';

            // Emails destinatarios — controle visual de envio
            if (h.destinatarios_emails) {
                var emails = h.destinatarios_emails.split(',');
                html += '<div class="timeline-emails">';
                for (var j = 0; j < emails.length; j++) {
                    var em = emails[j].trim();
                    if (em) {
                        html += '<span class="timeline-email-badge">';
                        html += '<i class="fas fa-at"></i> ' + escapeHtml(em);
                        html += '</span>';
                    }
                }
                html += '</div>';
            }

            if (!h.sucesso && h.erro_mensagem) {
                html += '<div class="timeline-erro-detalhe"><i class="fas fa-exclamation-circle"></i> ' + escapeHtml(h.erro_mensagem) + '</div>';
            }

            html += '</div>';
            html += '<div class="timeline-data">' + escapeHtml(h.dt_envio_fmt) + '</div>';
            html += '</div>';
        }
        DOM.timelineHistorico.innerHTML = html;
    }

    // =========================================================
    // MODAL
    // =========================================================

    function abrirModal(dadosOuGrupo) {
        Estado.editandoGrupo = null;
        if (DOM.campoTipo)      DOM.campoTipo.value      = '';
        if (DOM.campoNome)      DOM.campoNome.value      = '';
        if (DOM.campoEmail)     DOM.campoEmail.value     = '';
        if (DOM.campoSetor)     DOM.campoSetor.value     = '';
        if (DOM.campoCanal)     DOM.campoCanal.value     = 'email';
        if (DOM.campoDescricao) DOM.campoDescricao.value = '';
        desmarcarTodasEspecialidades();
        if (DOM.avisoEditEspec) DOM.avisoEditEspec.style.display = 'none';

        if (dadosOuGrupo && dadosOuGrupo.items) {
            Estado.editandoGrupo = dadosOuGrupo.items;
            var meta = dadosOuGrupo.meta;
            DOM.modalTitulo.innerHTML = '<i class="fas fa-user-edit"></i> Editar Destinatario';
            if (DOM.campoTipo)      DOM.campoTipo.value      = meta.tipo_evento || '';
            if (DOM.campoNome)      DOM.campoNome.value      = meta.nome || '';
            if (DOM.campoEmail)     DOM.campoEmail.value     = meta.email || '';
            if (DOM.campoSetor)     DOM.campoSetor.value     = meta.setor || '';
            if (DOM.campoCanal)     DOM.campoCanal.value     = meta.canal || 'email';
            if (DOM.campoDescricao) DOM.campoDescricao.value = meta.descricao || '';
            for (var i = 0; i < dadosOuGrupo.items.length; i++) {
                checkEspecialidade(dadosOuGrupo.items[i].especialidade || '');
            }
            if (DOM.labelEspecHint) DOM.labelEspecHint.textContent = '(marque para adicionar, desmarque para remover)';
        } else {
            DOM.modalTitulo.innerHTML = '<i class="fas fa-user-plus"></i> Novo Destinatario';
            if (DOM.labelEspecHint) DOM.labelEspecHint.textContent = '(selecione uma ou mais)';
        }

        DOM.modalOverlay.classList.add('ativo');
    }

    function fecharModal() {
        DOM.modalOverlay.classList.remove('ativo');
        Estado.editandoGrupo = null;
    }

    // =========================================================
    // SALVAR / SYNC
    // =========================================================

    function syncGrupo(tipo, nome, email, setor, canal, descricao, keepItems, addEsps, removeIds) {
        var fila = [];
        for (var a = 0; a < keepItems.length; a++) fila.push({ op: 'put',    id: keepItems[a].id, esp: keepItems[a].esp });
        for (var b = 0; b < addEsps.length;   b++) fila.push({ op: 'post',   esp: addEsps[b] });
        for (var c = 0; c < removeIds.length;  c++) fila.push({ op: 'delete', id: removeIds[c] });

        var erros = [];
        function proximo() {
            if (fila.length === 0) {
                if (erros.length > 0) alert('Aviso:\n' + erros.join('\n'));
                fecharModal(); carregarDestinatarios(); carregarDashboard(); return;
            }
            var item = fila.shift();
            var promise;
            var body = JSON.stringify({ tipo_evento: tipo, nome: nome, email: email, especialidade: item.esp || '', setor: setor, canal: canal, descricao: descricao });
            if (item.op === 'put') {
                promise = fetchJSON(CONFIG.urlBase + '/destinatarios/' + item.id, { method: 'PUT', body: body });
            } else if (item.op === 'post') {
                promise = fetchJSON(CONFIG.urlBase + '/destinatarios', { method: 'POST', body: body });
            } else {
                promise = fetchJSON(CONFIG.urlBase + '/destinatarios/' + item.id, { method: 'DELETE' });
            }
            promise.then(function(resp) {
                if (!resp.success && resp.error && resp.error.indexOf('ja cadastrado') === -1) erros.push(resp.error || 'Erro');
                proximo();
            }).catch(function() { erros.push('Erro de conexao'); proximo(); });
        }
        proximo();
    }

    function salvar() {
        var tipo      = DOM.campoTipo      ? DOM.campoTipo.value      : '';
        var nome      = DOM.campoNome      ? DOM.campoNome.value      : '';
        var email     = DOM.campoEmail     ? DOM.campoEmail.value     : '';
        var setor     = DOM.campoSetor     ? DOM.campoSetor.value     : '';
        var canal     = DOM.campoCanal     ? DOM.campoCanal.value     : 'email';
        var descricao = DOM.campoDescricao ? DOM.campoDescricao.value : '';

        if (!tipo || !nome || !email) {
            alert('Preencha os campos obrigatorios: Tipo, Nome e Email');
            return;
        }

        if (Estado.editandoGrupo) {
            var newEsps = obterEspecialidadesSelecionadas();
            if (newEsps.length === 0) newEsps = [''];

            var currentMap = {};
            for (var i = 0; i < Estado.editandoGrupo.length; i++) {
                var esp = Estado.editandoGrupo[i].especialidade || '';
                currentMap[esp] = Estado.editandoGrupo[i].id;
            }

            var keepItems = [], addEsps = [], removeIds = [];
            for (var j = 0; j < newEsps.length; j++) {
                var ne = newEsps[j];
                if (currentMap.hasOwnProperty(ne)) { keepItems.push({ esp: ne, id: currentMap[ne] }); }
                else { addEsps.push(ne); }
            }
            for (var oldEsp in currentMap) {
                if (currentMap.hasOwnProperty(oldEsp) && newEsps.indexOf(oldEsp) === -1) removeIds.push(currentMap[oldEsp]);
            }

            syncGrupo(tipo, nome, email, setor, canal, descricao, keepItems, addEsps, removeIds);
            return;
        }

        // Criacao: um POST por especialidade selecionada
        var especialidades = obterEspecialidadesSelecionadas();
        if (especialidades.length === 0) especialidades = [''];

        var pendentes = especialidades.slice();
        var erros = [];
        var sucessos = 0;

        function enviarProximo() {
            if (pendentes.length === 0) {
                if (erros.length > 0) alert('Alguns registros nao foram salvos:\n' + erros.join('\n'));
                if (sucessos > 0) { fecharModal(); carregarDestinatarios(); carregarDashboard(); }
                return;
            }
            var espec = pendentes.shift();
            fetchJSON(CONFIG.urlBase + '/destinatarios', {
                method: 'POST',
                body: JSON.stringify({ tipo_evento: tipo, nome: nome, email: email, especialidade: espec, setor: setor, canal: canal, descricao: descricao })
            }).then(function(resp) {
                if (resp.success) { sucessos++; }
                else { erros.push(resp.error || ('Erro para ' + (espec || 'Todas'))); }
                enviarProximo();
            }).catch(function() { erros.push('Erro de conexao'); enviarProximo(); });
        }
        enviarProximo();
    }

    // =========================================================
    // AÇÕES DE GRUPO
    // =========================================================

    function editarGrupo(idx) {
        var grp = Estado.gruposArr[idx];
        if (grp) abrirModal(grp);
    }

    function toggleGrupo(idx) {
        var grp = Estado.gruposArr[idx];
        if (!grp) return;
        var pendentes = grp.items.slice();
        function proxToggle() {
            if (pendentes.length === 0) { carregarDestinatarios(); carregarDashboard(); return; }
            var it = pendentes.shift();
            fetchJSON(CONFIG.urlBase + '/destinatarios/' + it.id + '/toggle', { method: 'PUT' }).then(proxToggle).catch(proxToggle);
        }
        proxToggle();
    }

    function excluirGrupo(idx) {
        var grp = Estado.gruposArr[idx];
        if (!grp) return;
        var msg = grp.items.length > 1
            ? 'Excluir este destinatario e todas as ' + grp.items.length + ' especialidades cadastradas?'
            : 'Tem certeza que deseja excluir este destinatario?';
        if (!confirm(msg)) return;
        var pendentes = grp.items.slice();
        function proxDelete() {
            if (pendentes.length === 0) { carregarDestinatarios(); carregarDashboard(); return; }
            var it = pendentes.shift();
            fetchJSON(CONFIG.urlBase + '/destinatarios/' + it.id, { method: 'DELETE' }).then(proxDelete).catch(proxDelete);
        }
        proxDelete();
    }

    // =========================================================
    // EVENTOS
    // =========================================================

    function registrarEventos() {
        DOM.modalFechar.addEventListener('click', fecharModal);
        DOM.btnCancelar.addEventListener('click', fecharModal);
        DOM.btnSalvar.addEventListener('click', salvar);
        DOM.modalOverlay.addEventListener('click', function(e) { if (e.target === DOM.modalOverlay) fecharModal(); });

        if (DOM.btnVoltar) DOM.btnVoltar.addEventListener('click', function() { window.location.href = '/frontend/dashboard.html'; });
        if (DOM.btnRefresh) DOM.btnRefresh.addEventListener('click', function() {
            DOM.btnRefresh.classList.add('girando');
            carregarDashboard();
            carregarDestinatarios();
            if (Estado.abaAtiva === 'historico') carregarHistorico();
            setTimeout(function() { DOM.btnRefresh.classList.remove('girando'); }, 500);
        });

        document.addEventListener('keydown', function(e) { if (e.key === 'Escape') fecharModal(); });
    }

    window.P26 = { editarGrupo: editarGrupo, toggleGrupo: toggleGrupo, excluirGrupo: excluirGrupo };

    // =========================================================
    // INIT
    // =========================================================

    function inicializar() {
        capturarDOM();
        registrarEventos();
        carregarTipos();
        carregarEspecialidades();
        carregarDashboard();
        carregarDestinatarios();

        Estado.timerAtualizacao = setInterval(function() {
            carregarDashboard();
            if (Estado.abaAtiva === 'historico') carregarHistorico();
        }, CONFIG.intervaloAtualizacao);
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', inicializar);
    else inicializar();

})();
