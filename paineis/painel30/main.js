// ========================================
// PAINEL 30 - CENTRAL DE TRATATIVAS
// Hospital Anchieta Ceilandia
// ========================================

(function () {
    'use strict';

    var BASE_URL = window.location.origin;

    var CONFIG = {
        apiDashboard: BASE_URL + '/api/paineis/painel30/dashboard',
        apiTratativas: BASE_URL + '/api/paineis/painel30/tratativas',
        apiFiltros: BASE_URL + '/api/paineis/painel30/filtros',
        apiResponsaveis: BASE_URL + '/api/paineis/painel30/responsaveis',
        apiCriticosResumo: BASE_URL + '/api/paineis/painel30/criticos-resumo',
        intervaloRefresh: 60000
    };

    var estado = {
        isAdmin: false,
        tratativaAtual: null,
        statusSelecionado: null,
        refreshInterval: null,
        filtrosVisiveis: false,
        debounceTimer: null,
        responsaveisCache: [],
        responsaveisLista: [],
        abaAtiva: 'resumo',
        resumoCarregado: false
    };

    var _categoriasItensCache = null;

    // ========================================
    // INICIALIZACAO
    // ========================================

    function inicializar() {
        console.log('Inicializando Painel 30 - Central de Tratativas...');
        configurarTabs();
        configurarBotoes();
        configurarFiltros();
        configurarKpiClicks();
        configurarModais();
        configurarResponsaveis();
        carregarFiltrosOpcoes();
        carregarResumo();
        _verificarAbrirPorParam();
        estado.refreshInterval = setInterval(function () {
            if (estado.abaAtiva === 'resumo') {
                carregarResumo();
            } else {
                carregarTudo();
            }
        }, CONFIG.intervaloRefresh);
        console.log('Painel 30 inicializado');
    }

    // ========================================
    // TABS
    // ========================================

    function configurarTabs() {
        var btns = document.querySelectorAll('.tab-nav-btn');
        for (var i = 0; i < btns.length; i++) {
            btns[i].addEventListener('click', function () {
                ativarTab(this.getAttribute('data-tab'));
            });
        }
    }

    function ativarTab(nomeTab) {
        estado.abaAtiva = nomeTab;

        var btns = document.querySelectorAll('.tab-nav-btn');
        for (var i = 0; i < btns.length; i++) {
            btns[i].classList.toggle('active', btns[i].getAttribute('data-tab') === nomeTab);
        }

        var panels = document.querySelectorAll('.tab-panel');
        for (var j = 0; j < panels.length; j++) {
            panels[j].classList.toggle('active', panels[j].id === 'tab-' + nomeTab);
        }

        // Filtros só aparecem na aba de tratativas
        var filtrosBar = document.getElementById('filtros-bar');
        if (nomeTab !== 'tratativas' && filtrosBar) {
            filtrosBar.style.display = 'none';
            estado.filtrosVisiveis = false;
        }

        // Carregar dados da aba selecionada na primeira vez
        if (nomeTab === 'resumo') {
            carregarResumo();
        } else if (nomeTab === 'tratativas') {
            carregarTudo();
        }
    }

    // ========================================
    // BOTOES DO HEADER
    // ========================================

    function configurarBotoes() {
        var btnVoltar = document.getElementById('btn-voltar');
        if (btnVoltar) btnVoltar.addEventListener('click', function () {
            window.location.href = '/paineis/painel28/sentir-agir.html';
        });

        var btnRefresh = document.getElementById('btn-refresh');
        if (btnRefresh) btnRefresh.addEventListener('click', function () {
            carregarTudo();
            mostrarToast('Dados atualizados', 'info');
        });

        var btnFormulario = document.getElementById('btn-formulario');
        if (btnFormulario) btnFormulario.addEventListener('click', function () {
            window.location.href = '/paineis/painel28/formulario.html';
        });

        var btnGestao = document.getElementById('btn-gestao');
        if (btnGestao) btnGestao.addEventListener('click', function () {
            window.location.href = '/painel/painel29';
        });

        var btnResp = document.getElementById('btn-responsaveis');
        if (btnResp) btnResp.addEventListener('click', function () {
            abrirModal('modal-responsaveis');
            carregarResponsaveis();
            popularSelectsResponsaveis();
        });

        var btnToggleFiltros = document.getElementById('btn-toggle-filtros');
        if (btnToggleFiltros) btnToggleFiltros.addEventListener('click', function () {
            if (estado.abaAtiva !== 'tratativas') {
                ativarTab('tratativas');
                return;
            }
            estado.filtrosVisiveis = !estado.filtrosVisiveis;
            var bar = document.getElementById('filtros-bar');
            if (bar) bar.style.display = estado.filtrosVisiveis ? 'block' : 'none';
        });

        var selResumoDias = document.getElementById('resumo-dias');
        if (selResumoDias) selResumoDias.addEventListener('change', function () { carregarResumo(); });
    }

    // ========================================
    // FILTROS
    // ========================================

    function configurarFiltros() {
        var seletores = ['filtro-status', 'filtro-categoria', 'filtro-setor', 'filtro-responsavel', 'filtro-dias'];
        seletores.forEach(function (id) {
            var el = document.getElementById(id);
            if (el) el.addEventListener('change', function () { carregarTudo(); });
        });

        var inputBusca = document.getElementById('filtro-busca');
        if (inputBusca) {
            inputBusca.addEventListener('input', function () {
                clearTimeout(estado.debounceTimer);
                estado.debounceTimer = setTimeout(function () { carregarTudo(); }, 400);
            });
        }

        var btnLimpar = document.getElementById('btn-limpar-filtros');
        if (btnLimpar) btnLimpar.addEventListener('click', function () {
            document.getElementById('filtro-status').value = 'pendente';
            document.getElementById('filtro-categoria').value = '';
            document.getElementById('filtro-setor').value = '';
            document.getElementById('filtro-responsavel').value = '';
            document.getElementById('filtro-dias').value = '30';
            document.getElementById('filtro-busca').value = '';
            carregarTudo();
        });
    }

    function configurarKpiClicks() {
        var cards = document.querySelectorAll('.stat-card-clickable');
        for (var i = 0; i < cards.length; i++) {
            cards[i].addEventListener('click', function () {
                var status = this.getAttribute('data-status');
                document.getElementById('filtro-status').value = status;
                if (!estado.filtrosVisiveis) {
                    estado.filtrosVisiveis = true;
                    document.getElementById('filtros-bar').style.display = 'block';
                }
                carregarTudo();
            });
        }
    }

    function construirParams() {
        var params = [];
        var status = document.getElementById('filtro-status').value;
        var categoria = document.getElementById('filtro-categoria').value;
        var setor = document.getElementById('filtro-setor').value;
        var responsavel = document.getElementById('filtro-responsavel').value;
        var dias = document.getElementById('filtro-dias').value;
        var busca = document.getElementById('filtro-busca').value.trim();

        if (status) params.push('status=' + encodeURIComponent(status));
        if (categoria) params.push('categoria=' + encodeURIComponent(categoria));
        if (setor) params.push('setor=' + encodeURIComponent(setor));
        if (responsavel) params.push('responsavel=' + encodeURIComponent(responsavel));
        if (dias) params.push('dias=' + encodeURIComponent(dias));
        if (busca) params.push('busca=' + encodeURIComponent(busca));

        return params;
    }

    function construirUrl(base) {
        var params = construirParams();
        return base + (params.length > 0 ? '?' + params.join('&') : '');
    }

    function carregarFiltrosOpcoes() {
        fetch(CONFIG.apiFiltros)
            .then(function (r) { return r.json(); })
            .then(function (data) {
                if (!data.success) return;
                var d = data.data;

                var selCat = document.getElementById('filtro-categoria');
                if (selCat && d.categorias) {
                    d.categorias.forEach(function (c) {
                        var opt = document.createElement('option');
                        opt.value = c.id;
                        opt.textContent = c.nome;
                        selCat.appendChild(opt);
                    });
                }

                var selSetor = document.getElementById('filtro-setor');
                if (selSetor && d.setores) {
                    d.setores.forEach(function (s) {
                        var opt = document.createElement('option');
                        opt.value = s.id;
                        opt.textContent = s.nome;
                        selSetor.appendChild(opt);
                    });
                }

                var selResp = document.getElementById('filtro-responsavel');
                if (selResp && d.responsaveis) {
                    estado.responsaveisCache = d.responsaveis;
                    d.responsaveis.forEach(function (r) {
                        var opt = document.createElement('option');
                        opt.value = r.id;
                        opt.textContent = r.nome;
                        selResp.appendChild(opt);
                    });
                }
            })
            .catch(function (err) { console.warn('Erro ao carregar filtros:', err); });
    }

    // ========================================
    // CARREGAR RESUMO DE CRITICOS
    // ========================================

    function carregarResumo() {
        var dias = (document.getElementById('resumo-dias') || {}).value || '30';
        var url = CONFIG.apiCriticosResumo + (dias ? '?dias=' + dias : '');

        fetch(url)
            .then(function (r) { return r.json(); })
            .then(function (data) {
                if (!data.success) return;
                var d = data.data;
                setTexto('resumo-total-badge', d.total + ' crítico' + (d.total !== 1 ? 's' : ''));
                setTexto('analitico-total-badge', d.total + ' registro' + (d.total !== 1 ? 's' : ''));
                renderizarSintetico(d.sintetico || []);
                renderizarAnalitico(d.analitico || []);
            })
            .catch(function (err) {
                console.error('Erro resumo:', err);
                var c = document.getElementById('resumo-sintetico-container');
                if (c) c.innerHTML = '<p style="text-align:center;color:#999;padding:30px;">Erro ao carregar</p>';
            });
    }

    function renderizarSintetico(setores) {
        var container = document.getElementById('resumo-sintetico-container');
        if (!container) return;

        if (!setores || setores.length === 0) {
            container.innerHTML = '<div class="resumo-vazio"><i class="fas fa-check-circle"></i><p>Nenhum crítico em aberto</p><small>Todos os itens estão regularizados</small></div>';
            return;
        }

        var html = '<div class="resumo-grid">';
        setores.forEach(function (s) {
            var temAberto = s.total_aberto > 0;
            var temTratado = s.total_tratado > 0;
            html += '<div class="resumo-setor-card' + (!temAberto ? ' todos-tratados' : '') + '">';

            // Header clicável → vai para Tratativas com filtro do setor
            html += '<div class="resumo-setor-header resumo-setor-clicavel" onclick="window.P30.irParaTratativasSetor(' + s.setor_id + ')" title="Ver tratativas deste setor">';
            html += '<div class="resumo-setor-nome"><i class="fas fa-hospital"></i> ' + escapeHtml(s.setor_nome) + '</div>';
            html += '<div class="resumo-setor-badges">';
            if (temAberto) {
                html += '<span class="resumo-badge-aberto">' + s.total_aberto + ' em aberto</span>';
            }
            if (temTratado) {
                html += '<span class="resumo-badge-tratado"><i class="fas fa-check"></i> ' + s.total_tratado + ' tratado' + (s.total_tratado !== 1 ? 's' : '') + '</span>';
            }
            html += '<i class="fas fa-arrow-right resumo-seta-ir"></i>';
            html += '</div>';
            html += '</div>';

            html += '<div class="resumo-cats-lista">';
            s.categorias.forEach(function (cat) {
                var base = s.total_aberto || s.total || 1;
                var pct = Math.round(((cat.total_aberto || 0) / base) * 100);
                html += '<div class="resumo-cat-item">';
                html += '<div class="resumo-cat-nome">';
                if (cat.categoria_icone) html += '<i class="' + escapeHtml(cat.categoria_icone) + '"></i> ';
                html += escapeHtml(cat.categoria_nome);
                html += '</div>';
                html += '<div class="resumo-cat-barra-wrap">';
                html += '<div class="resumo-cat-barra" style="width:' + pct + '%"></div>';
                html += '</div>';
                html += '<span class="resumo-cat-total">';
                if ((cat.total_aberto || 0) > 0) html += '<span class="cat-num-aberto">' + cat.total_aberto + '</span>';
                if ((cat.total_tratado || 0) > 0) html += '<span class="cat-num-tratado"> +' + cat.total_tratado + '✓</span>';
                html += '</span>';
                html += '</div>';
            });
            html += '</div>';
            html += '</div>';
        });
        html += '</div>';

        container.innerHTML = html;
    }

    function irParaTratativasSetor(setorId) {
        var sel = document.getElementById('filtro-setor');
        if (sel) sel.value = setorId;
        var selStatus = document.getElementById('filtro-status');
        if (selStatus) selStatus.value = '';
        ativarTab('tratativas');
        if (!estado.filtrosVisiveis) {
            estado.filtrosVisiveis = true;
            var bar = document.getElementById('filtros-bar');
            if (bar) bar.style.display = 'block';
        }
    }

    function renderizarAnalitico(itens) {
        var container = document.getElementById('resumo-analitico-container');
        if (!container) return;

        if (!itens || itens.length === 0) {
            container.innerHTML = '<div class="resumo-vazio"><i class="fas fa-check-circle"></i><p>Nenhum crítico em aberto</p></div>';
            return;
        }

        // Agrupar por setor
        var setoresMap = {};
        var setoresOrdem = [];
        itens.forEach(function (item) {
            var sn = item.setor_nome;
            if (!setoresMap[sn]) { setoresMap[sn] = []; setoresOrdem.push(sn); }
            setoresMap[sn].push(item);
        });

        var html = '';
        var STATUS_LABELS = {
            'pendente': { label: 'Pendente', cls: 'an-st-pendente' },
            'em_tratativa': { label: 'Em Tratativa', cls: 'an-st-em_tratativa' },
            'regularizado': { label: 'Regularizado', cls: 'an-st-regularizado' },
            'impossibilitado': { label: 'Impossibilitado', cls: 'an-st-impossibilitado' }
        };

        setoresOrdem.forEach(function (setor) {
            var lista = setoresMap[setor];
            var abertos = lista.filter(function (i) { return i.status === 'pendente' || i.status === 'em_tratativa'; }).length;
            var tratados = lista.length - abertos;
            html += '<div class="analitico-setor">';
            html += '<div class="analitico-setor-header"><i class="fas fa-hospital"></i> ' + escapeHtml(setor);
            html += ' <span class="analitico-setor-count">' + abertos + ' em aberto</span>';
            if (tratados > 0) html += ' <span class="analitico-setor-count-tratado">' + tratados + ' tratado' + (tratados !== 1 ? 's' : '') + '</span>';
            html += '</div>';
            html += '<div class="analitico-itens">';
            lista.forEach(function (item) {
                var tratado = item.status === 'regularizado' || item.status === 'impossibilitado';
                var dias = item.dias_em_aberto || 0;
                var diasTexto = dias < 1 ? 'hoje' : Math.floor(dias) + 'd';
                var urgente = !tratado && dias >= 2;
                var stInfo = STATUS_LABELS[item.status] || { label: item.status, cls: '' };

                html += '<div class="analitico-card' + (urgente ? ' urgente' : '') + (tratado ? ' tratado' : '') + '">';

                html += '<div class="analitico-card-header">';
                html += '<span class="analitico-cat-badge">';
                if (item.categoria_icone) html += '<i class="' + escapeHtml(item.categoria_icone) + '"></i> ';
                html += escapeHtml(item.categoria_nome) + '</span>';
                html += '<span class="analitico-status-badge ' + stInfo.cls + '">' + stInfo.label + '</span>';
                if (!tratado) {
                    html += '<span class="analitico-dias' + (urgente ? ' urgente' : '') + '">';
                    if (urgente) html += '<i class="fas fa-clock"></i> ';
                    html += diasTexto + ' em aberto</span>';
                }
                html += '</div>';

                html += '<div class="analitico-item-desc"><i class="fas fa-exclamation-circle"></i> ' + escapeHtml(item.item_descricao) + '</div>';

                html += '<div class="analitico-meta">';
                if (item.nm_paciente) html += '<span><i class="fas fa-user-injured"></i> ' + escapeHtml(item.nm_paciente) + '</span>';
                html += '<span><i class="fas fa-bed"></i> Leito ' + escapeHtml(item.leito || '--') + '</span>';
                html += '<span><i class="fas fa-calendar"></i> ' + formatarData(item.data_ronda) + '</span>';
                html += '<span><i class="fas fa-user-tie"></i> ' + escapeHtml(item.responsavel_display) + '</span>';
                html += '</div>';

                if (item.descricao_problema) {
                    html += '<div class="analitico-problema"><i class="fas fa-comment-dots"></i> ' + escapeHtml(item.descricao_problema) + '</div>';
                }
                if (item.plano_acao) {
                    html += '<div class="analitico-plano"><i class="fas fa-tasks"></i> ' + escapeHtml(item.plano_acao) + '</div>';
                }
                if (item.observacoes_resolucao) {
                    html += '<div class="analitico-obs"><i class="fas fa-comment-check"></i> ' + escapeHtml(item.observacoes_resolucao) + '</div>';
                }

                html += '<button class="analitico-btn-ver" onclick="window.P30.abrirTratativa(' + item.tratativa_id + ')">';
                html += '<i class="fas fa-edit"></i> Abrir Tratativa</button>';

                html += '</div>';
            });
            html += '</div></div>';
        });

        container.innerHTML = html;
    }

    // ========================================
    // CARREGAR DADOS
    // ========================================

    function carregarTudo() {
        carregarDashboard();
        carregarTratativas();
        atualizarHora();
    }

    function carregarDashboard() {
        fetch(construirUrl(CONFIG.apiDashboard))
            .then(function (r) { return r.json(); })
            .then(function (data) {
                if (!data.success) return;
                var d = data.data;
                estado.isAdmin = d.is_admin || false;
                setTexto('stat-total', d.total || 0);
                setTexto('stat-pendentes', d.pendentes || 0);
                setTexto('stat-em-tratativa', d.em_tratativa || 0);
                setTexto('stat-regularizadas', d.regularizadas || 0);
                setTexto('stat-sem-responsavel', d.sem_responsavel || 0);
                setTexto('stat-atrasadas', d.atrasadas || 0);
            })
            .catch(function (err) { console.error('Erro dashboard:', err); });
    }

    function carregarTratativas() {
        fetch(construirUrl(CONFIG.apiTratativas))
            .then(function (r) { return r.json(); })
            .then(function (data) {
                if (data.success) {
                    estado.isAdmin = data.is_admin || false;
                    renderizarTratativas(data.data || []);
                    setTexto('tratativas-total', (data.total || 0) + ' registros');
                }
            })
            .catch(function (err) {
                console.error('Erro tratativas:', err);
                var lista = document.getElementById('tratativas-lista');
                if (lista) lista.innerHTML = '<p style="text-align:center;color:#999;padding:20px;">Erro ao carregar</p>';
            });
    }

    // ========================================
    // RENDERIZAR LISTA
    // ========================================

    function renderizarTratativas(tratativas) {
        var lista = document.getElementById('tratativas-lista');
        var vazio = document.getElementById('tratativas-vazia');

        if (!lista) return;

        if (!tratativas || tratativas.length === 0) {
            lista.innerHTML = '';
            if (vazio) vazio.style.display = 'block';
            return;
        }

        if (vazio) vazio.style.display = 'none';

        lista.innerHTML = tratativas.map(function (t) {
            var dias = t.dias_em_aberto || 0;
            var atrasado = dias > 3 && (t.status === 'pendente' || t.status === 'em_tratativa');
            var diasTexto = dias < 1 ? 'hoje' : Math.floor(dias) + ' dia(s) em aberto';

            var ativo = t.status === 'pendente' || t.status === 'em_tratativa';
            var temDevolutiva = t.observacoes_resolucao && t.observacoes_resolucao.trim() !== '';
            var alertaClass = '';
            if (!temDevolutiva && ativo) {
                if (dias >= 2) alertaClass = ' alerta-sem-dev-critico';
                else if (dias >= 1) alertaClass = ' alerta-sem-dev-atencao';
            }

            var html = '<div class="tratativa-card status-' + t.status + alertaClass + '" onclick="window.P30.abrirTratativa(' + t.tratativa_id + ')">';

            html += '<div class="trat-header">';
            html += '<div class="trat-paciente"><i class="fas fa-user-injured"></i> ' + escapeHtml(t.nm_paciente || 'N/I') + '</div>';
            html += '<div class="trat-badges">';
            html += '<span class="badge-categoria">' + escapeHtml(t.categoria_nome) + '</span>';
            html += '<span class="badge-status badge-' + t.status + '">' + formatarStatus(t.status) + '</span>';
            html += '</div>';
            html += '</div>';

            html += '<div class="trat-item-desc"><i class="fas fa-exclamation-circle"></i> ' + escapeHtml(t.item_descricao) + '</div>';

            html += '<div class="trat-meta">';
            html += '<span class="trat-meta-item"><i class="fas fa-bed"></i> ' + escapeHtml(t.setor_sa_sigla || t.setor_sa_nome) + ' - ' + escapeHtml(t.leito) + '</span>';
            if (t.nr_atendimento) html += '<span class="trat-meta-item"><i class="fas fa-file-medical"></i> ' + escapeHtml(t.nr_atendimento) + '</span>';
            html += '<span class="trat-meta-item"><i class="fas fa-user-friends"></i> ' + escapeHtml(t.dupla_nome) + '</span>';
            html += '</div>';

            html += '<div class="trat-rodape">';
            html += '<span><i class="fas fa-user-tie"></i> ' + escapeHtml(t.responsavel_display) + '</span>';
            html += '<span class="trat-dias' + (atrasado ? ' atrasado' : '') + '">';
            if (atrasado) html += '<i class="fas fa-exclamation-triangle"></i> ';
            html += diasTexto;
            html += '</span>';
            html += '</div>';

            if (alertaClass) {
                var isCritico = alertaClass.indexOf('critico') !== -1;
                html += '<div class="alerta-dev-badge' + (isCritico ? ' critico' : '') + '">';
                html += isCritico
                    ? '<i class="fas fa-exclamation-triangle"></i> Crítico: sem devolutiva há ' + Math.floor(dias) + ' dias'
                    : '<i class="fas fa-clock"></i> Atenção: sem devolutiva há ' + Math.floor(dias) + ' dia(s)';
                html += '</div>';
            }

            html += '</div>';
            return html;
        }).join('');
    }

    // ========================================
    // MODAL DETALHE / EDICAO
    // ========================================

    function configurarModais() {
        var btnFechar = document.getElementById('btn-fechar-tratativa');
        if (btnFechar) btnFechar.addEventListener('click', fecharTratativa);
        var btnCancelar = document.getElementById('btn-cancelar-tratativa');
        if (btnCancelar) btnCancelar.addEventListener('click', fecharTratativa);
        var btnSalvar = document.getElementById('btn-salvar-tratativa');
        if (btnSalvar) btnSalvar.addEventListener('click', salvarTratativa);

        var modal = document.getElementById('modal-tratativa');
        if (modal) modal.addEventListener('click', function (e) {
            if (e.target === this) fecharTratativa();
        });

        document.addEventListener('keydown', function (e) {
            if (e.key === 'Escape') {
                var ativos = document.querySelectorAll('.modal-overlay.ativo');
                for (var i = 0; i < ativos.length; i++) ativos[i].classList.remove('ativo');
            }
        });
    }

    function abrirTratativa(tratativaId) {
        estado.tratativaAtual = null;
        estado.statusSelecionado = null;

        var body = document.getElementById('modal-tratativa-body');
        if (body) body.innerHTML = '<div class="loading"><div class="loading-spinner"></div><p>Carregando...</p></div>';

        var btnSalvar = document.getElementById('btn-salvar-tratativa');
        if (btnSalvar) btnSalvar.style.display = 'none';

        abrirModal('modal-tratativa');

        fetch(CONFIG.apiTratativas + '/' + tratativaId)
            .then(function (r) { return r.json(); })
            .then(function (data) {
                if (data.success) {
                    estado.tratativaAtual = data.data;
                    estado.statusSelecionado = data.data.status;
                    estado.isAdmin = data.data.is_admin || false;
                    renderizarDetalhe(data.data);
                    if (btnSalvar) btnSalvar.style.display = 'flex';
                } else {
                    if (body) body.innerHTML = '<p style="color:#dc3545;">' + escapeHtml(data.error) + '</p>';
                }
            })
            .catch(function () {
                if (body) body.innerHTML = '<p style="color:#dc3545;">Erro de comunicacao</p>';
            });
    }

    function renderizarDetalhe(t) {
        var body = document.getElementById('modal-tratativa-body');
        if (!body) return;

        var html = '';

        // Secao: Informacoes do problema
        html += '<div class="detalhe-secao">';
        html += '<div class="detalhe-secao-titulo"><i class="fas fa-exclamation-circle"></i> Problema Identificado</div>';
        html += '<div class="detalhe-problema">';
        html += '<strong>' + escapeHtml(t.item_descricao) + '</strong><br>';
        html += '<small>Categoria: ' + escapeHtml(t.categoria_nome) + '</small>';
        html += '</div>';
        html += '</div>';

        // Secao: Dados do paciente/visita
        html += '<div class="detalhe-secao">';
        html += '<div class="detalhe-secao-titulo"><i class="fas fa-user-injured"></i> Paciente / Visita</div>';
        html += '<div class="detalhe-info-grid">';
        html += '<div class="detalhe-info-item"><span class="detalhe-info-label">Paciente</span><span class="detalhe-info-valor">' + escapeHtml(t.nm_paciente || 'N/I') + '</span></div>';
        html += '<div class="detalhe-info-item"><span class="detalhe-info-label">Atendimento</span><span class="detalhe-info-valor">' + escapeHtml(t.nr_atendimento || '--') + '</span></div>';
        html += '<div class="detalhe-info-item"><span class="detalhe-info-label">Setor</span><span class="detalhe-info-valor">' + escapeHtml(t.setor_sa_nome) + '</span></div>';
        html += '<div class="detalhe-info-item"><span class="detalhe-info-label">Leito</span><span class="detalhe-info-valor">' + escapeHtml(t.leito) + '</span></div>';
        html += '<div class="detalhe-info-item"><span class="detalhe-info-label">Data Ronda</span><span class="detalhe-info-valor">' + formatarData(t.data_ronda) + '</span></div>';
        html += '<div class="detalhe-info-item"><span class="detalhe-info-label">Dupla</span><span class="detalhe-info-valor">' + escapeHtml(t.dupla_nome) + '</span></div>';
        html += '</div>';
        if (t.visita_observacoes) {
            html += '<div style="margin-top:10px;padding:10px;background:#f8f9fa;border-radius:6px;font-size:0.78rem;color:#666;font-style:italic;">';
            html += '<strong>Observa\u00e7\u00e3o Geral:</strong> ' + escapeHtml(t.visita_observacoes);
            html += '</div>';
        }
        if (t.obs_item) {
            html += '<div style="margin-top:8px;padding:10px 14px;background:#fff0f0;border-radius:6px;border-left:4px solid #dc3545;font-size:0.78rem;">';
            html += '<strong style="color:#dc3545;">Cr\u00edtica:</strong> ' + escapeHtml(t.obs_item);
            html += '</div>';
        }
        html += '</div>';

        // Secao: Status (selector)
        html += '<div class="detalhe-secao">';
        html += '<div class="detalhe-secao-titulo"><i class="fas fa-flag"></i> Status da Tratativa</div>';
        html += '<div class="status-selector">';
        var statuses = [
            { v: 'pendente', l: 'Pendente', i: 'fas fa-exclamation-circle' },
            { v: 'em_tratativa', l: 'Em Tratativa', i: 'fas fa-spinner' },
            { v: 'regularizado', l: 'Regularizado', i: 'fas fa-check-circle' },
            { v: 'impossibilitado', l: 'Impossibilitado', i: 'fas fa-ban' },
            { v: 'cancelado', l: 'Cancelado', i: 'fas fa-times-circle' }
        ];
        statuses.forEach(function (s) {
            var sel = (s.v === t.status) ? ' selected' : '';
            html += '<button type="button" class="status-btn' + sel + '" data-status="' + s.v + '" onclick="window.P30.selecionarStatus(this)">';
            html += '<i class="' + s.i + '"></i> ' + s.l;
            html += '</button>';
        });
        html += '</div>';
        html += '</div>';

        // Secao: Responsavel
        html += '<div class="detalhe-secao">';
        html += '<div class="detalhe-secao-titulo"><i class="fas fa-user-tie"></i> Responsavel</div>';
        html += '<div class="detalhe-campo">';
        html += '<label>Responsavel Cadastrado</label>';
        html += '<select id="edit-responsavel-id">';
        html += '<option value="">-- Sem responsavel cadastrado --</option>';
        if (estado.responsaveisCache) {
            estado.responsaveisCache.forEach(function (r) {
                var sel = (r.id === t.responsavel_id) ? ' selected' : '';
                html += '<option value="' + r.id + '"' + sel + '>' + escapeHtml(r.nome) + (r.cargo ? ' (' + escapeHtml(r.cargo) + ')' : '') + '</option>';
            });
        }
        html += '</select>';
        html += '</div>';
        html += '<div class="detalhe-campo">';
        html += '<label>Ou Responsavel Manual (texto livre)</label>';
        html += '<input type="text" id="edit-responsavel-manual" placeholder="Nome do responsavel" maxlength="200" value="' + escapeAttr(t.responsavel_nome_manual || '') + '">';
        html += '</div>';
        var idTrat = t.tratativa_id || t.id;
        html += '<div style="margin-top:10px;">';
        html += '<button type="button" class="btn-atualizar-resp" id="btn-atualizar-resp" onclick="window.P30.atualizarResponsavelAuto(' + idTrat + ')">';
        html += '<i class="fas fa-sync-alt"></i> Atualizar Responsavel Automaticamente';
        html += '</button>';
        html += '<small style="display:block;margin-top:5px;color:#888;font-size:0.72rem;">';
        html += 'Busca e atribui o responsavel correto pela categoria/setor e reenvia o email de notificacao.';
        html += '</small>';
        html += '</div>';
        html += '</div>';

        // Secao: Plano de acao
        html += '<div class="detalhe-secao">';
        html += '<div class="detalhe-secao-titulo"><i class="fas fa-clipboard-list"></i> Plano de Acao</div>';
        html += '<div class="detalhe-campo">';
        html += '<textarea id="edit-plano-acao" placeholder="Descreva o plano de acao para resolver este problema..." maxlength="2000">' + escapeHtml(t.plano_acao || '') + '</textarea>';
        html += '</div>';
        html += '</div>';

        // Secao: Observacoes de resolucao (so se nao for pendente)
        html += '<div class="detalhe-secao">';
        html += '<div class="detalhe-secao-titulo"><i class="fas fa-comment-check"></i> Observacoes da Resolucao</div>';
        html += '<div class="detalhe-campo">';
        html += '<textarea id="edit-obs-resolucao" placeholder="Detalhes da resolucao, evidencias, contatos realizados..." maxlength="2000">' + escapeHtml(t.observacoes_resolucao || '') + '</textarea>';
        html += '</div>';
        if (t.data_resolucao) {
            html += '<div style="font-size:0.72rem;color:#666;margin-top:6px;">';
            html += '<i class="fas fa-check"></i> Resolvido em ' + formatarDataHora(t.data_resolucao);
            if (t.resolvido_por) html += ' por <strong>' + escapeHtml(t.resolvido_por) + '</strong>';
            html += '</div>';
        }
        html += '</div>';

        // Secao Admin: Reclassificar Critica
        if (estado.isAdmin) {
            html += '<div class="detalhe-secao detalhe-secao-admin">';
            html += '<div class="detalhe-secao-titulo detalhe-admin-toggle" onclick="window.P30.toggleReclassificar()" style="cursor:pointer;user-select:none;">';
            html += '<i class="fas fa-exchange-alt" style="color:#6f42c1;"></i>';
            html += '<span style="color:#6f42c1;">[Admin] Reclassificar para outro Item</span>';
            html += '<i class="fas fa-chevron-down" id="icon-reclassificar" style="margin-left:auto;font-size:0.68rem;color:#aaa;transition:transform 0.2s;"></i>';
            html += '</div>';
            html += '<div id="painel-reclassificar" style="display:none;">';
            html += '<p style="font-size:0.72rem;color:#888;margin-bottom:12px;padding:8px 10px;background:#f8f0ff;border-radius:5px;border-left:3px solid #6f42c1;">';
            html += '<i class="fas fa-info-circle" style="color:#6f42c1;"></i> ';
            html += 'Corrige o item desta critica em todos os paineis (28, 29 e 30). ';
            html += 'A avaliacao original tambem sera corrigida.';
            html += '</p>';
            html += '<div class="detalhe-campo">';
            html += '<label>Nova Categoria</label>';
            html += '<select id="reclassif-categoria" onchange="window.P30.atualizarItensReclassif()">';
            html += '<option value="">-- Carregando categorias... --</option>';
            html += '</select>';
            html += '</div>';
            html += '<div class="detalhe-campo">';
            html += '<label>Novo Item</label>';
            html += '<select id="reclassif-item">';
            html += '<option value="">-- Selecione a categoria primeiro --</option>';
            html += '</select>';
            html += '</div>';
            html += '<div class="detalhe-campo">';
            html += '<label>Motivo da Reclassificacao (opcional)</label>';
            html += '<input type="text" id="reclassif-motivo" placeholder="Ex: item registrado incorretamente pelo formulario" maxlength="200">';
            html += '</div>';
            html += '<button type="button" class="btn-reclassificar" id="btn-reclassificar" onclick="window.P30.confirmarReclassificar(' + idTrat + ')">';
            html += '<i class="fas fa-exchange-alt"></i> Confirmar Reclassificacao';
            html += '</button>';
            html += '</div>';
            html += '</div>';
        }

        // Secao: Historico
        if (t.historico && t.historico.length > 0) {
            html += '<div class="detalhe-secao">';
            html += '<div class="detalhe-secao-titulo"><i class="fas fa-history"></i> Historico de Alteracoes</div>';
            t.historico.forEach(function (h) {
                html += '<div class="historico-item">';
                html += '<span class="historico-acao">' + escapeHtml(h.acao) + '</span>';
                html += '<span class="historico-desc">';
                if (h.campo_alterado) html += escapeHtml(h.campo_alterado) + ': ';
                if (h.valor_anterior) html += '<s>' + escapeHtml(h.valor_anterior.substring(0, 60)) + '</s> &rarr; ';
                if (h.valor_novo) html += escapeHtml(h.valor_novo.substring(0, 60));
                html += '</span>';
                html += '<span class="historico-meta">' + escapeHtml(h.usuario || '') + ' ' + formatarDataHora(h.criado_em) + '</span>';
                html += '</div>';
            });
            html += '</div>';
        }

        body.innerHTML = html;
    }

    function selecionarStatus(btn) {
        var todos = document.querySelectorAll('.status-btn');
        for (var i = 0; i < todos.length; i++) todos[i].classList.remove('selected');
        btn.classList.add('selected');
        estado.statusSelecionado = btn.getAttribute('data-status');
    }

    function salvarTratativa() {
        if (!estado.tratativaAtual) return;

        // O endpoint de detalhe retorna 'id'; a listagem retorna 'tratativa_id' — suporta os dois
        var idTratativa = estado.tratativaAtual.tratativa_id || estado.tratativaAtual.id;
        if (!idTratativa) {
            mostrarToast('Erro: ID da tratativa nao encontrado', 'erro');
            return;
        }

        var planoAcao = (document.getElementById('edit-plano-acao').value || '').trim();
        var obsResolucao = (document.getElementById('edit-obs-resolucao').value || '').trim();
        var respId = document.getElementById('edit-responsavel-id').value;
        var respManual = (document.getElementById('edit-responsavel-manual').value || '').trim();

        // Justificativa obrigatoria para status impossibilitado
        var statusFinal = estado.statusSelecionado || estado.tratativaAtual.status;
        if (statusFinal === 'impossibilitado' && !obsResolucao) {
            mostrarToast('Informe a justificativa no campo Observacoes da Resolucao para marcar como Impossibilitado', 'erro');
            var campoObs = document.getElementById('edit-obs-resolucao');
            if (campoObs) { campoObs.focus(); campoObs.style.borderColor = 'var(--cor-primaria)'; }
            return;
        }

        var payload = {
            status: statusFinal,
            plano_acao: planoAcao || null,
            observacoes_resolucao: obsResolucao || null,
            responsavel_id: respId ? parseInt(respId) : null,
            responsavel_nome_manual: respManual || null
        };

        var btn = document.getElementById('btn-salvar-tratativa');
        if (btn) {
            btn.disabled = true;
            btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Salvando...';
        }

        fetch(CONFIG.apiTratativas + '/' + idTratativa, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        })
        .then(function (r) { return r.json(); })
        .then(function (data) {
            if (data.success) {
                mostrarToast(data.message || 'Tratativa atualizada', 'sucesso');
                fecharTratativa();
                carregarTudo();
            } else {
                mostrarToast(data.error || 'Erro ao salvar', 'erro');
            }
        })
        .catch(function () { mostrarToast('Erro de comunicacao', 'erro'); })
        .finally(function () {
            if (btn) {
                btn.disabled = false;
                btn.innerHTML = '<i class="fas fa-save"></i> Salvar Alteracoes';
            }
        });
    }

    function fecharTratativa() {
        estado.tratativaAtual = null;
        estado.statusSelecionado = null;
        var modal = document.getElementById('modal-tratativa');
        if (modal) modal.classList.remove('ativo');
    }

    function atualizarResponsavelAuto(tratativaId) {
        var btn = document.getElementById('btn-atualizar-resp');
        if (btn) {
            btn.disabled = true;
            btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Buscando...';
        }

        fetch(CONFIG.apiTratativas + '/' + tratativaId + '/atualizar-responsavel', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
        })
        .then(function (r) { return r.json(); })
        .then(function (data) {
            if (data.success) {
                mostrarToast(data.message, 'sucesso');
                // Reabrir tratativa para refletir mudanca
                abrirTratativa(tratativaId);
                carregarTudo();
            } else {
                mostrarToast(data.error || 'Erro ao atualizar responsavel', 'erro');
                if (btn) {
                    btn.disabled = false;
                    btn.innerHTML = '<i class="fas fa-sync-alt"></i> Atualizar Responsavel Automaticamente';
                }
            }
        })
        .catch(function () {
            mostrarToast('Erro de comunicacao', 'erro');
            if (btn) {
                btn.disabled = false;
                btn.innerHTML = '<i class="fas fa-sync-alt"></i> Atualizar Responsavel Automaticamente';
            }
        });
    }

    function _verificarAbrirPorParam() {
        try {
            var params = new URLSearchParams(window.location.search);
            var abrirId = params.get('abrir');
            if (abrirId && !isNaN(parseInt(abrirId))) {
                abrirTratativa(parseInt(abrirId));
            }
        } catch (e) { /* URLSearchParams nao suportado */ }
    }

    // ========================================
    // RECLASSIFICAR CRITICA (admin)
    // ========================================

    function toggleReclassificar() {
        var painel = document.getElementById('painel-reclassificar');
        var icon = document.getElementById('icon-reclassificar');
        if (!painel) return;
        var aberto = painel.style.display !== 'none';
        painel.style.display = aberto ? 'none' : 'block';
        if (icon) icon.style.transform = aberto ? '' : 'rotate(180deg)';

        if (!aberto) {
            if (!_categoriasItensCache) {
                _carregarCategoriasItens();
            } else {
                _popularDropdownCategorias();
            }
        }
    }

    function _carregarCategoriasItens() {
        var selCat = document.getElementById('reclassif-categoria');
        if (selCat) selCat.innerHTML = '<option value="">Carregando...</option>';

        fetch(BASE_URL + '/api/paineis/painel30/categorias-itens')
            .then(function (r) { return r.json(); })
            .then(function (data) {
                if (data.success) {
                    _categoriasItensCache = data.data;
                    _popularDropdownCategorias();
                } else {
                    if (selCat) selCat.innerHTML = '<option value="">Erro ao carregar</option>';
                }
            })
            .catch(function () {
                if (selCat) selCat.innerHTML = '<option value="">Erro ao carregar</option>';
            });
    }

    function _popularDropdownCategorias() {
        var selCat = document.getElementById('reclassif-categoria');
        if (!selCat || !_categoriasItensCache) return;

        var html = '<option value="">-- Selecione a categoria --</option>';
        _categoriasItensCache.forEach(function (cat) {
            html += '<option value="' + cat.id + '">' + escapeHtml(cat.nome) + '</option>';
        });
        selCat.innerHTML = html;

        if (estado.tratativaAtual && estado.tratativaAtual.categoria_id) {
            selCat.value = estado.tratativaAtual.categoria_id;
            atualizarItensReclassif();
        }
    }

    function atualizarItensReclassif() {
        var selCat = document.getElementById('reclassif-categoria');
        var selItem = document.getElementById('reclassif-item');
        if (!selCat || !selItem || !_categoriasItensCache) return;

        var catId = parseInt(selCat.value);
        var cat = null;
        for (var i = 0; i < _categoriasItensCache.length; i++) {
            if (_categoriasItensCache[i].id === catId) { cat = _categoriasItensCache[i]; break; }
        }

        if (!cat) {
            selItem.innerHTML = '<option value="">-- Selecione a categoria primeiro --</option>';
            return;
        }

        var itemAtualId = estado.tratativaAtual ? (estado.tratativaAtual.item_id || estado.tratativaAtual.id) : null;
        var html = '<option value="">-- Selecione o item destino --</option>';
        cat.itens.forEach(function (item) {
            var isAtual = item.id === itemAtualId;
            html += '<option value="' + item.id + '"' + (isAtual ? ' disabled' : '') + '>';
            html += escapeHtml(item.descricao) + (isAtual ? ' (item atual)' : '');
            html += '</option>';
        });
        selItem.innerHTML = html;
    }

    function confirmarReclassificar(tratativaId) {
        var selItem = document.getElementById('reclassif-item');
        var novoItemId = selItem ? selItem.value : '';
        var motivo = (document.getElementById('reclassif-motivo') ? document.getElementById('reclassif-motivo').value : '').trim();
        var selCat = document.getElementById('reclassif-categoria');
        var catNome = selCat && selCat.selectedOptions[0] ? selCat.selectedOptions[0].text : '';
        var itemNome = selItem && selItem.selectedOptions[0] ? selItem.selectedOptions[0].text : '';

        if (!novoItemId) {
            mostrarToast('Selecione um item de destino', 'erro');
            return;
        }

        var confirmMsg = 'Reclassificar esta critica para:\n\nCategoria: ' + catNome + '\nItem: ' + itemNome + '\n\nEsta acao sera registrada no historico e refletira em todos os paineis (28, 29 e 30).\n\nConfirmar?';
        if (!window.confirm(confirmMsg)) return;

        var btn = document.getElementById('btn-reclassificar');
        if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Reclassificando...'; }

        fetch(CONFIG.apiTratativas + '/' + tratativaId + '/mover', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ item_id: parseInt(novoItemId), motivo: motivo || null })
        })
        .then(function (r) { return r.json(); })
        .then(function (data) {
            if (data.success) {
                mostrarToast(data.message, 'sucesso');
                abrirTratativa(tratativaId);
                carregarTudo();
            } else {
                mostrarToast(data.error || 'Erro ao reclassificar', 'erro');
                if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-exchange-alt"></i> Confirmar Reclassificacao'; }
            }
        })
        .catch(function () {
            mostrarToast('Erro de comunicacao', 'erro');
            if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-exchange-alt"></i> Confirmar Reclassificacao'; }
        });
    }

    // ========================================
    // GERENCIAR RESPONSAVEIS
    // ========================================

    function configurarResponsaveis() {
        var btnFechar = document.getElementById('btn-fechar-responsaveis');
        if (btnFechar) btnFechar.addEventListener('click', function () { fecharModal('modal-responsaveis'); });
        var btnFecharBottom = document.getElementById('btn-fechar-responsaveis-bottom');
        if (btnFecharBottom) btnFecharBottom.addEventListener('click', function () { fecharModal('modal-responsaveis'); });

        var btnAdd = document.getElementById('btn-add-resp');
        if (btnAdd) btnAdd.addEventListener('click', salvarResponsavel);

        var btnCancelar = document.getElementById('btn-cancelar-resp-edicao');
        if (btnCancelar) btnCancelar.addEventListener('click', cancelarEdicaoResponsavel);
    }

    function popularSelectsResponsaveis() {
        // Popular multi-selects de categorias e setores
        var dropCat = document.getElementById('dropdown-resp-categorias');
        var dropSet = document.getElementById('dropdown-resp-setores');
        if (dropCat && dropCat.children.length === 0) {
            fetch(CONFIG.apiFiltros).then(function (r) { return r.json(); })
                .then(function (data) {
                    if (!data.success) return;
                    estado._categoriasOpcoes = data.data.categorias || [];
                    estado._setoresOpcoes = data.data.setores || [];
                    _renderMultiSelectOptions('resp-categorias', estado._categoriasOpcoes, 'nome');
                    _renderMultiSelectOptions('resp-setores', estado._setoresOpcoes, 'nome');
                });
        }
        _initMultiSelectEvents('resp-categorias');
        _initMultiSelectEvents('resp-setores');
    }

    // ========================================
    // MULTI-SELECT COMPONENT
    // ========================================

    function _renderMultiSelectOptions(name, opcoes, labelKey) {
        var dropdown = document.getElementById('dropdown-' + name);
        if (!dropdown) return;
        var html = '';
        opcoes.forEach(function (o) {
            html += '<label class="multi-select-option">';
            html += '<input type="checkbox" value="' + o.id + '" data-label="' + escapeAttr(o[labelKey]) + '">';
            html += '<span class="ms-check"></span>';
            html += '<span class="ms-label">' + escapeHtml(o[labelKey]) + '</span>';
            html += '</label>';
        });
        dropdown.innerHTML = html;

        // Bind change events
        var checkboxes = dropdown.querySelectorAll('input[type="checkbox"]');
        for (var i = 0; i < checkboxes.length; i++) {
            checkboxes[i].addEventListener('change', function () {
                _updateMultiSelectBadges(name);
            });
        }
    }

    function _initMultiSelectEvents(name) {
        var trigger = document.getElementById('trigger-' + name);
        var dropdown = document.getElementById('dropdown-' + name);
        var wrapper = document.getElementById('wrap-' + name);
        if (!trigger || !dropdown || !wrapper) return;

        // Evitar bind duplo
        if (trigger._msBound) return;
        trigger._msBound = true;

        trigger.addEventListener('click', function (e) {
            e.stopPropagation();
            var isOpen = wrapper.classList.contains('open');
            // Fechar todos os outros
            var todos = document.querySelectorAll('.multi-select-wrapper.open');
            for (var i = 0; i < todos.length; i++) todos[i].classList.remove('open');
            if (!isOpen) wrapper.classList.add('open');
        });

        // Prevenir fechar ao clicar dentro do dropdown
        dropdown.addEventListener('click', function (e) {
            e.stopPropagation();
        });
    }

    // Fechar multi-selects ao clicar fora
    document.addEventListener('click', function () {
        var abertos = document.querySelectorAll('.multi-select-wrapper.open');
        for (var i = 0; i < abertos.length; i++) abertos[i].classList.remove('open');
    });

    function _updateMultiSelectBadges(name) {
        var dropdown = document.getElementById('dropdown-' + name);
        var badgesEl = document.getElementById('badges-' + name);
        var placeholder = document.querySelector('#trigger-' + name + ' .multi-select-placeholder');
        if (!dropdown || !badgesEl) return;

        var checked = dropdown.querySelectorAll('input[type="checkbox"]:checked');
        var html = '';
        for (var i = 0; i < checked.length; i++) {
            html += '<span class="ms-badge">' + escapeHtml(checked[i].getAttribute('data-label'));
            html += '<i class="fas fa-times ms-badge-remove" data-val="' + checked[i].value + '" data-name="' + name + '"></i>';
            html += '</span>';
        }
        badgesEl.innerHTML = html;

        if (placeholder) {
            placeholder.style.display = checked.length > 0 ? 'none' : 'inline';
        }

        // Bind remove buttons
        var removes = badgesEl.querySelectorAll('.ms-badge-remove');
        for (var j = 0; j < removes.length; j++) {
            removes[j].addEventListener('click', function (e) {
                e.stopPropagation();
                var val = this.getAttribute('data-val');
                var msName = this.getAttribute('data-name');
                var cb = document.querySelector('#dropdown-' + msName + ' input[value="' + val + '"]');
                if (cb) { cb.checked = false; }
                _updateMultiSelectBadges(msName);
            });
        }
    }

    function _getMultiSelectValues(name) {
        var dropdown = document.getElementById('dropdown-' + name);
        if (!dropdown) return [];
        var checked = dropdown.querySelectorAll('input[type="checkbox"]:checked');
        var vals = [];
        for (var i = 0; i < checked.length; i++) vals.push(parseInt(checked[i].value));
        return vals;
    }

    function _setMultiSelectValues(name, ids) {
        var dropdown = document.getElementById('dropdown-' + name);
        if (!dropdown) return;
        var checkboxes = dropdown.querySelectorAll('input[type="checkbox"]');
        for (var i = 0; i < checkboxes.length; i++) {
            checkboxes[i].checked = ids.indexOf(parseInt(checkboxes[i].value)) !== -1;
        }
        _updateMultiSelectBadges(name);
    }

    function _clearMultiSelect(name) {
        var dropdown = document.getElementById('dropdown-' + name);
        if (!dropdown) return;
        var checkboxes = dropdown.querySelectorAll('input[type="checkbox"]');
        for (var i = 0; i < checkboxes.length; i++) checkboxes[i].checked = false;
        _updateMultiSelectBadges(name);
    }

    // ========================================
    // RESPONSAVEIS: CARREGAR / RENDERIZAR
    // ========================================

    function carregarResponsaveis() {
        var lista = document.getElementById('resp-lista');
        if (!lista) return;
        lista.innerHTML = '<div class="loading"><div class="loading-spinner"></div></div>';

        fetch(CONFIG.apiResponsaveis + '?todas=1')
            .then(function (r) { return r.json(); })
            .then(function (d) {
                if (d.success) {
                    estado.responsaveisLista = d.data || [];
                    renderizarResponsaveis(estado.responsaveisLista);
                }
            })
            .catch(function () {
                lista.innerHTML = '<p style="text-align:center;color:#999;padding:20px;">Erro ao carregar</p>';
            });
    }

    function renderizarResponsaveis(resps) {
        var lista = document.getElementById('resp-lista');
        if (!lista) return;

        if (resps.length === 0) {
            lista.innerHTML = '<p style="text-align:center;color:#999;padding:20px;">Nenhum responsavel cadastrado</p>';
            return;
        }

        lista.innerHTML = resps.map(function (r) {
            var cls = r.ativo ? 'resp-item' : 'resp-item inativo';
            var html = '<div class="' + cls + '" data-id="' + r.id + '">';
            html += '<div class="resp-info">';
            html += '<div class="resp-nome">' + escapeHtml(r.nome) + (r.cargo ? ' <small style="font-weight:400;color:#999;">- ' + escapeHtml(r.cargo) + '</small>' : '') + '</div>';
            html += '<div class="resp-detalhes">';
            if (r.email) html += '<span><i class="fas fa-envelope"></i> ' + escapeHtml(r.email) + '</span>';
            if (r.telefone) html += '<span><i class="fas fa-phone"></i> ' + escapeHtml(r.telefone) + '</span>';

            // Mostrar multiplas categorias como badges
            if (r.categorias && r.categorias.length > 0) {
                html += '<span class="resp-multi-badges"><i class="fas fa-tags"></i> ';
                r.categorias.forEach(function (c) {
                    html += '<span class="resp-tag-badge cat">' + escapeHtml(c.nome) + '</span>';
                });
                html += '</span>';
            }

            // Mostrar multiplos setores como badges
            if (r.setores && r.setores.length > 0) {
                html += '<span class="resp-multi-badges"><i class="fas fa-building"></i> ';
                r.setores.forEach(function (s) {
                    html += '<span class="resp-tag-badge set">' + escapeHtml(s.nome) + '</span>';
                });
                html += '</span>';
            }

            html += '</div>';
            html += '</div>';
            html += '<div class="resp-acoes">';
            html += '<button class="r-btn r-btn-editar" onclick="window.P30.editarResponsavel(' + r.id + ')" title="Editar"><i class="fas fa-edit"></i></button>';
            html += '<button class="r-btn r-btn-toggle ' + (r.ativo ? 'ativo' : '') + '" onclick="window.P30.toggleResponsavel(' + r.id + ')" title="' + (r.ativo ? 'Desativar' : 'Ativar') + '"><i class="fas fa-' + (r.ativo ? 'toggle-on' : 'toggle-off') + '"></i></button>';
            html += '</div>';
            html += '</div>';
            return html;
        }).join('');
    }

    function salvarResponsavel() {
        var nome = (document.getElementById('resp-nome').value || '').trim();
        var email = (document.getElementById('resp-email').value || '').trim();
        var telefone = (document.getElementById('resp-telefone').value || '').trim();
        var cargo = (document.getElementById('resp-cargo').value || '').trim();
        var categoriaIds = _getMultiSelectValues('resp-categorias');
        var setorIds = _getMultiSelectValues('resp-setores');
        var editId = document.getElementById('resp-edit-id').value;

        if (!nome) { mostrarToast('Nome obrigatorio', 'erro'); return; }

        var payload = {
            nome: nome,
            email: email || null,
            telefone: telefone || null,
            cargo: cargo || null,
            categoria_ids: categoriaIds,
            setor_ids: setorIds
        };

        var isEdicao = !!editId;
        var url = isEdicao ? CONFIG.apiResponsaveis + '/' + editId : CONFIG.apiResponsaveis;
        var metodo = isEdicao ? 'PUT' : 'POST';

        fetch(url, {
            method: metodo,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        })
        .then(function (r) { return r.json(); })
        .then(function (d) {
            if (d.success) {
                mostrarToast(isEdicao ? 'Responsavel atualizado' : 'Responsavel adicionado', 'sucesso');
                _limparFormResponsavel();
                carregarResponsaveis();
                carregarFiltrosOpcoes();
            } else {
                mostrarToast(d.error || 'Erro', 'erro');
            }
        })
        .catch(function () { mostrarToast('Erro de comunicacao', 'erro'); });
    }

    function editarResponsavel(id) {
        var r = null;
        for (var i = 0; i < estado.responsaveisLista.length; i++) {
            if (estado.responsaveisLista[i].id === id) { r = estado.responsaveisLista[i]; break; }
        }
        if (!r) { mostrarToast('Responsavel nao encontrado', 'erro'); return; }

        document.getElementById('resp-edit-id').value = r.id;
        document.getElementById('resp-nome').value = r.nome || '';
        document.getElementById('resp-email').value = r.email || '';
        document.getElementById('resp-telefone').value = r.telefone || '';
        document.getElementById('resp-cargo').value = r.cargo || '';

        // Popular multi-selects com os IDs existentes
        var catIds = (r.categorias || []).map(function (c) { return c.id; });
        var setIds = (r.setores || []).map(function (s) { return s.id; });
        _setMultiSelectValues('resp-categorias', catIds);
        _setMultiSelectValues('resp-setores', setIds);

        var titulo = document.querySelector('.resp-form h4');
        if (titulo) titulo.innerHTML = '<i class="fas fa-edit"></i> Editando: ' + escapeHtml(r.nome);

        var btnAdd = document.getElementById('btn-add-resp');
        if (btnAdd) btnAdd.innerHTML = '<i class="fas fa-save"></i> Salvar Alteracoes';

        var btnCanc = document.getElementById('btn-cancelar-resp-edicao');
        if (btnCanc) btnCanc.style.display = 'flex';

        var form = document.querySelector('.resp-form');
        if (form) form.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    function cancelarEdicaoResponsavel() {
        _limparFormResponsavel();
    }

    function _limparFormResponsavel() {
        document.getElementById('resp-edit-id').value = '';
        document.getElementById('resp-nome').value = '';
        document.getElementById('resp-email').value = '';
        document.getElementById('resp-telefone').value = '';
        document.getElementById('resp-cargo').value = '';
        _clearMultiSelect('resp-categorias');
        _clearMultiSelect('resp-setores');

        var titulo = document.querySelector('.resp-form h4');
        if (titulo) titulo.innerHTML = '<i class="fas fa-plus-circle"></i> Adicionar Responsavel';

        var btnAdd = document.getElementById('btn-add-resp');
        if (btnAdd) btnAdd.innerHTML = '<i class="fas fa-plus"></i> Adicionar Responsavel';

        var btnCanc = document.getElementById('btn-cancelar-resp-edicao');
        if (btnCanc) btnCanc.style.display = 'none';
    }

    function toggleResponsavel(id) {
        fetch(CONFIG.apiResponsaveis + '/' + id + '/toggle', { method: 'PUT' })
            .then(function (r) { return r.json(); })
            .then(function (d) {
                if (d.success) {
                    mostrarToast(d.message, 'sucesso');
                    carregarResponsaveis();
                } else {
                    mostrarToast(d.error || 'Erro', 'erro');
                }
            })
            .catch(function () { mostrarToast('Erro', 'erro'); });
    }

    // ========================================
    // UTILITARIOS
    // ========================================

    function abrirModal(id) { var m = document.getElementById(id); if (m) m.classList.add('ativo'); }
    function fecharModal(id) { var m = document.getElementById(id); if (m) m.classList.remove('ativo'); }
    function setTexto(id, t) { var el = document.getElementById(id); if (el) el.textContent = t; }

    function formatarData(s) {
        if (!s) return '--';
        var p = s.split('T')[0].split('-');
        return p.length === 3 ? p[2] + '/' + p[1] + '/' + p[0] : s;
    }

    function formatarDataHora(iso) {
        if (!iso) return '--';
        try {
            var d = new Date(iso);
            return String(d.getDate()).padStart(2, '0') + '/' +
                String(d.getMonth() + 1).padStart(2, '0') + ' ' +
                String(d.getHours()).padStart(2, '0') + ':' +
                String(d.getMinutes()).padStart(2, '0');
        } catch (e) { return '--'; }
    }

    function formatarStatus(s) {
        return { 'pendente': 'Pendente', 'em_tratativa': 'Em Tratativa', 'regularizado': 'Regularizado', 'impossibilitado': 'Impossibilitado', 'cancelado': 'Cancelado' }[s] || s;
    }

    function atualizarHora() {
        var d = new Date();
        setTexto('ultima-atualizacao', d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }));
    }

    function escapeHtml(t) { if (t === null || t === undefined) return ''; var d = document.createElement('div'); d.textContent = String(t); return d.innerHTML; }
    function escapeAttr(t) { if (!t) return ''; return String(t).replace(/&/g, '&amp;').replace(/'/g, '&#39;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

    function mostrarToast(msg, tipo) {
        var c = document.getElementById('toast-container');
        if (!c) return;
        var t = document.createElement('div');
        t.className = 'toast toast-' + (tipo || 'info');
        var ic = tipo === 'sucesso' ? '<i class="fas fa-check-circle"></i>' : tipo === 'erro' ? '<i class="fas fa-times-circle"></i>' : '<i class="fas fa-info-circle"></i>';
        t.innerHTML = ic + ' ' + escapeHtml(msg);
        c.appendChild(t);
        setTimeout(function () { if (t.parentNode) t.parentNode.removeChild(t); }, 4000);
    }

    // ========================================
    // EXPOR FUNCOES GLOBAIS
    // ========================================

    window.P30 = {
        abrirTratativa: abrirTratativa,
        selecionarStatus: selecionarStatus,
        toggleResponsavel: toggleResponsavel,
        editarResponsavel: editarResponsavel,
        irParaTratativasSetor: irParaTratativasSetor,
        atualizarResponsavelAuto: atualizarResponsavelAuto,
        toggleReclassificar: toggleReclassificar,
        atualizarItensReclassif: atualizarItensReclassif,
        confirmarReclassificar: confirmarReclassificar
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', inicializar);
    } else {
        inicializar();
    }

})();