// ========================================
// PAINEL 29 - GESTAO SENTIR E AGIR
// Hospital Anchieta Ceilandia
// ========================================

(function () {
    'use strict';

    var BASE_URL = window.location.origin;

    var CONFIG = {
        apiDashboard: BASE_URL + '/api/paineis/painel29/dashboard',
        apiDados: BASE_URL + '/api/paineis/painel29/dados',
        apiFiltros: BASE_URL + '/api/paineis/painel29/filtros',
        apiVisita: BASE_URL + '/api/paineis/painel29/visitas',
        apiRondas: BASE_URL + '/api/paineis/painel29/rondas',
        apiExportar: BASE_URL + '/api/paineis/painel29/exportar',
        apiConfig: BASE_URL + '/api/paineis/painel29/config',
        intervaloRefresh: 60000
    };

    var estado = {
        isAdmin: false,
        modoEdicao: false,
        visitaAtual: null,
        refreshInterval: null,
        filtrosVisiveis: false,
        debounceTimer: null
    };

    // ========================================
    // INICIALIZACAO
    // ========================================

    function inicializar() {
        console.log('Inicializando Painel 29 - Gestao Sentir e Agir...');

        configurarBotoes();
        configurarFiltros();
        configurarModais();
        carregarFiltrosOpcoes();
        carregarTudo();

        estado.refreshInterval = setInterval(carregarTudo, CONFIG.intervaloRefresh);

        console.log('Painel 29 inicializado');
    }

    // ========================================
    // BOTOES
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

        var btnConfigurarFormulario = document.getElementById('btn-configurar-formulario');
        if (btnConfigurarFormulario) btnConfigurarFormulario.addEventListener('click', function () {
            window.location.href = '/paineis/painel28/formulario_config.html';
        });

        var btnFormulario = document.getElementById('btn-formulario');
        if (btnFormulario) btnFormulario.addEventListener('click', function () {
            window.location.href = '/paineis/painel28/formulario.html';
        });

        var btnTratativas = document.getElementById('btn-tratativas');
        if (btnTratativas) btnTratativas.addEventListener('click', function () {
            window.location.href = '/painel/painel30';
        });

        var btnExportar = document.getElementById('btn-exportar');
        if (btnExportar) btnExportar.addEventListener('click', function () {
            exportarExcel();
        });

        var btnToggleFiltros = document.getElementById('btn-toggle-filtros');
        if (btnToggleFiltros) btnToggleFiltros.addEventListener('click', function () {
            estado.filtrosVisiveis = !estado.filtrosVisiveis;
            var bar = document.getElementById('filtros-bar');
            if (bar) bar.style.display = estado.filtrosVisiveis ? 'block' : 'none';
        });
    }

    // ========================================
    // FILTROS
    // ========================================

    function configurarFiltros() {
        var seletores = ['filtro-dias', 'filtro-setor', 'filtro-dupla', 'filtro-avaliacao', 'filtro-status'];
        seletores.forEach(function (id) {
            var el = document.getElementById(id);
            if (el) el.addEventListener('change', function () {
                if (id === 'filtro-dias' && this.value === 'custom') {
                    document.getElementById('filtro-datas').style.display = 'flex';
                    return;
                }
                if (id === 'filtro-dias' && this.value !== 'custom') {
                    document.getElementById('filtro-datas').style.display = 'none';
                }
                carregarTudo();
            });
        });

        // Datas customizadas
        var dtInicio = document.getElementById('filtro-dt-inicio');
        var dtFim = document.getElementById('filtro-dt-fim');
        if (dtInicio) dtInicio.addEventListener('change', function () { carregarTudo(); });
        if (dtFim) dtFim.addEventListener('change', function () { carregarTudo(); });

        // Busca com debounce
        var inputBusca = document.getElementById('filtro-busca');
        if (inputBusca) {
            inputBusca.addEventListener('input', function () {
                clearTimeout(estado.debounceTimer);
                estado.debounceTimer = setTimeout(function () {
                    carregarTudo();
                }, 400);
            });
        }

        // Limpar
        var btnLimpar = document.getElementById('btn-limpar-filtros');
        if (btnLimpar) btnLimpar.addEventListener('click', function () {
            document.getElementById('filtro-dias').value = '7';
            document.getElementById('filtro-setor').value = '';
            document.getElementById('filtro-dupla').value = '';
            document.getElementById('filtro-avaliacao').value = '';
            document.getElementById('filtro-status').value = '';
            document.getElementById('filtro-busca').value = '';
            document.getElementById('filtro-dt-inicio').value = '';
            document.getElementById('filtro-dt-fim').value = '';
            document.getElementById('filtro-datas').style.display = 'none';
            carregarTudo();
        });
    }

    function construirParams() {
        var params = [];
        var dias = document.getElementById('filtro-dias').value;

        if (dias === 'custom') {
            var dtI = document.getElementById('filtro-dt-inicio').value;
            var dtF = document.getElementById('filtro-dt-fim').value;
            if (dtI) params.push('dt_inicio=' + encodeURIComponent(dtI));
            if (dtF) params.push('dt_fim=' + encodeURIComponent(dtF));
        } else if (dias) {
            params.push('dias=' + encodeURIComponent(dias));
        }

        var setor = document.getElementById('filtro-setor').value;
        if (setor) params.push('setor=' + encodeURIComponent(setor));

        var dupla = document.getElementById('filtro-dupla').value;
        if (dupla) params.push('dupla=' + encodeURIComponent(dupla));

        var avaliacao = document.getElementById('filtro-avaliacao').value;
        if (avaliacao) params.push('avaliacao=' + encodeURIComponent(avaliacao));

        var status = document.getElementById('filtro-status').value;
        if (status) params.push('status_ronda=' + encodeURIComponent(status));

        var busca = document.getElementById('filtro-busca').value.trim();
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

                var selSetor = document.getElementById('filtro-setor');
                if (selSetor && d.setores) {
                    d.setores.forEach(function (s) {
                        var opt = document.createElement('option');
                        opt.value = s;
                        opt.textContent = s;
                        selSetor.appendChild(opt);
                    });
                }

                var selDupla = document.getElementById('filtro-dupla');
                if (selDupla && d.duplas) {
                    d.duplas.forEach(function (dup) {
                        var opt = document.createElement('option');
                        opt.value = dup.id;
                        opt.textContent = dup.nome;
                        selDupla.appendChild(opt);
                    });
                }
            })
            .catch(function (err) { console.warn('Erro ao carregar filtros:', err); });
    }

    // ========================================
    // CARREGAR DADOS
    // ========================================

    function carregarTudo() {
        carregarDashboard();
        carregarDados();
        atualizarHora();
    }

    function carregarDashboard() {
        fetch(construirUrl(CONFIG.apiDashboard))
            .then(function (r) { return r.json(); })
            .then(function (data) {
                if (data.success) {
                    var d = data.data;
                    estado.isAdmin = d.is_admin || false;
                    setTexto('stat-visitas', d.total_visitas || 0);
                    setTexto('stat-rondas', d.total_rondas || 0);
                    setTexto('stat-criticos', d.total_criticos || 0);
                    setTexto('stat-atencao', d.total_atencao || 0);
                    setTexto('stat-adequados', d.total_adequados || 0);
                    setTexto('stat-leitos', d.total_leitos || 0);
                    // KPIs de tratativas
                    setTexto('stat-trat-total', d.trat_total || 0);
                    setTexto('stat-trat-pendentes', d.trat_pendentes || 0);
                    setTexto('stat-trat-em-tratativa', d.trat_em_tratativa || 0);
                    setTexto('stat-trat-regularizadas', d.trat_regularizadas || 0);
                }
            })
            .catch(function (err) { console.error('Erro dashboard:', err); });
    }

    function carregarDados() {
        fetch(construirUrl(CONFIG.apiDados))
            .then(function (r) { return r.json(); })
            .then(function (data) {
                if (data.success) {
                    estado.isAdmin = data.is_admin || false;
                    renderizarTabela(data.data || []);
                    setTexto('tabela-total', (data.total || 0) + ' registros');
                }
            })
            .catch(function (err) {
                console.error('Erro dados:', err);
                var body = document.getElementById('tabela-body');
                if (body) body.innerHTML = '<tr><td colspan="10" class="tabela-loading">Erro ao carregar</td></tr>';
            });
    }

    // ========================================
    // RENDERIZAR TABELA
    // ========================================

    function renderizarTabela(visitas) {
        var body = document.getElementById('tabela-body');
        var vazio = document.getElementById('tabela-vazia');
        var wrapper = document.querySelector('.tabela-wrapper');

        if (!body) return;

        if (!visitas || visitas.length === 0) {
            body.innerHTML = '';
            if (wrapper) wrapper.style.display = 'none';
            if (vazio) vazio.style.display = 'block';
            return;
        }

        if (wrapper) wrapper.style.display = 'block';
        if (vazio) vazio.style.display = 'none';

        body.innerHTML = visitas.map(function (v) {
            var classeLinh = 'linha-' + v.avaliacao_final;
            var html = '<tr class="' + classeLinh + '">';

            // Data
            html += '<td>' + formatarData(v.data_ronda) + '</td>';

            // Dupla
            html += '<td>' + escapeHtml(v.dupla_nome) + '</td>';

            // Setor
            html += '<td>' + escapeHtml(v.setor_sigla || v.setor_nome) + '</td>';

            // Leito
            html += '<td><strong>' + escapeHtml(v.leito) + '</strong></td>';

            // Nr Atendimento
            html += '<td>' + escapeHtml(v.nr_atendimento || '--') + '</td>';

            // Avaliacao final
            html += '<td><span class="badge-avaliacao badge-' + v.avaliacao_final + '">' + formatarResultado(v.avaliacao_final) + '</span></td>';

            // Semaforos (C / A / Ad)
            html += '<td class="celula-semaforos">';
            html += '<span class="s-val s-c">' + (v.qtd_critico || 0) + '</span>/';
            html += '<span class="s-val s-a">' + (v.qtd_atencao || 0) + '</span>/';
            html += '<span class="s-val s-ad">' + (v.qtd_adequado || 0) + '</span>';
            html += '</td>';

            // Imagens
            html += '<td class="celula-img">';
            if (v.qtd_imagens > 0) {
                html += '<i class="fas fa-camera"></i> ' + v.qtd_imagens;
            } else {
                html += '--';
            }
            html += '</td>';

            // Status ronda
            html += '<td><span class="badge-status badge-' + v.status_ronda + '">' + formatarStatus(v.status_ronda) + '</span></td>';

            // Tratativas
            html += '<td class="celula-tratativas">';
            if (!v.trat_total || v.trat_total === 0) {
                html += '<span class="trat-badge trat-sem">–</span>';
            } else {
                var stTrat = v.status_tratativa || 'pendente';
                html += '<span class="trat-status-badge trat-st-' + stTrat + '">' + formatarStatusTratativa(stTrat) + '</span>';
                html += '<span class="trat-counts">';
                if (v.trat_pendentes > 0) html += '<span class="trat-num trat-p" title="Pendentes">' + v.trat_pendentes + 'P</span>';
                if (v.trat_em_tratativa > 0) html += '<span class="trat-num trat-t" title="Em Tratativa">' + v.trat_em_tratativa + 'T</span>';
                if (v.trat_regularizadas > 0) html += '<span class="trat-num trat-r" title="Regularizadas">' + v.trat_regularizadas + 'R</span>';
                html += '</span>';
            }
            html += '</td>';

            // Acoes
            html += '<td><button class="btn-ver-detalhe" onclick="window.P29.abrirDetalhe(' + v.visita_id + ')">';
            html += '<i class="fas fa-eye"></i> Ver</button></td>';

            html += '</tr>';
            return html;
        }).join('');
    }

    // ========================================
    // MODAL DETALHE / EDICAO
    // ========================================

    function configurarModais() {
        var btnFechar = document.getElementById('btn-fechar-detalhe');
        if (btnFechar) btnFechar.addEventListener('click', function () { fecharDetalhe(); });

        var btnCancelar = document.getElementById('btn-cancelar-detalhe');
        if (btnCancelar) btnCancelar.addEventListener('click', function () { fecharDetalhe(); });

        var btnEditar = document.getElementById('btn-ativar-edicao');
        if (btnEditar) btnEditar.addEventListener('click', function () { ativarModoEdicao(); });

        var btnSalvar = document.getElementById('btn-salvar-edicao');
        if (btnSalvar) btnSalvar.addEventListener('click', function () { salvarEdicao(); });

        var btnAlterarStatus = document.getElementById('btn-alterar-status-ronda');
        if (btnAlterarStatus) btnAlterarStatus.addEventListener('click', function () { abrirModalStatusRonda(); });

        // Modal status ronda
        var btnFecharStatus = document.getElementById('btn-fechar-status-ronda');
        if (btnFecharStatus) btnFecharStatus.addEventListener('click', function () { fecharModalStatusRonda(); });
        var btnCancelarStatus = document.getElementById('btn-cancelar-status-ronda');
        if (btnCancelarStatus) btnCancelarStatus.addEventListener('click', function () { fecharModalStatusRonda(); });
        var btnConfirmarStatus = document.getElementById('btn-confirmar-status-ronda');
        if (btnConfirmarStatus) btnConfirmarStatus.addEventListener('click', function () { confirmarStatusRonda(); });

        var modalStatus = document.getElementById('modal-status-ronda');
        if (modalStatus) modalStatus.addEventListener('click', function (e) {
            if (e.target === this) fecharModalStatusRonda();
        });

        // Aviso ao trocar status
        var selectStatus = document.getElementById('select-novo-status-ronda');
        if (selectStatus) selectStatus.addEventListener('change', function () { atualizarAvisoStatus(this.value); });

        // Fechar clicando fora
        var modal = document.getElementById('modal-detalhe');
        if (modal) modal.addEventListener('click', function (e) {
            if (e.target === this) fecharDetalhe();
        });

        document.addEventListener('keydown', function (e) {
            if (e.key === 'Escape') { fecharDetalhe(); fecharModalStatusRonda(); }
        });
    }

    function abrirModalStatusRonda() {
        if (!estado.visitaAtual) return;
        var sel = document.getElementById('select-novo-status-ronda');
        if (sel) sel.value = estado.visitaAtual.status_ronda || 'em_andamento';
        atualizarAvisoStatus(estado.visitaAtual.status_ronda || 'em_andamento');
        var modal = document.getElementById('modal-status-ronda');
        if (modal) modal.classList.add('ativo');
    }

    function fecharModalStatusRonda() {
        var modal = document.getElementById('modal-status-ronda');
        if (modal) modal.classList.remove('ativo');
    }

    function atualizarAvisoStatus(novoStatus) {
        var aviso = document.getElementById('status-ronda-aviso');
        if (!aviso) return;
        var avisos = {
            'concluida': '<i class="fas fa-lock"></i> Ao concluir, não será mais possível adicionar visitas a esta ronda.',
            'cancelada': '<i class="fas fa-exclamation-triangle"></i> Ao cancelar, a ronda será ocultada dos relatórios padrão.',
            'em_andamento': '<i class="fas fa-info-circle"></i> A ronda voltará a aceitar novas visitas.'
        };
        var statusAtual = estado.visitaAtual ? estado.visitaAtual.status_ronda : '';
        if (novoStatus !== statusAtual && avisos[novoStatus]) {
            aviso.innerHTML = avisos[novoStatus];
            aviso.style.display = 'block';
        } else {
            aviso.style.display = 'none';
        }
    }

    function confirmarStatusRonda() {
        if (!estado.visitaAtual) return;
        var sel = document.getElementById('select-novo-status-ronda');
        var novoStatus = sel ? sel.value : '';
        if (!novoStatus) return;

        if (novoStatus === estado.visitaAtual.status_ronda) {
            mostrarToast('O status já é ' + novoStatus, 'info');
            fecharModalStatusRonda();
            return;
        }

        var btnConfirmar = document.getElementById('btn-confirmar-status-ronda');
        if (btnConfirmar) { btnConfirmar.disabled = true; btnConfirmar.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Salvando...'; }

        fetch(CONFIG.apiRondas + '/' + estado.visitaAtual.ronda_id + '/status', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status: novoStatus })
        })
        .then(function (r) { return r.json(); })
        .then(function (data) {
            if (data.success) {
                mostrarToast(data.message || 'Status alterado', 'sucesso');
                fecharModalStatusRonda();
                fecharDetalhe();
                carregarTudo();
            } else {
                mostrarToast(data.error || 'Erro ao alterar status', 'erro');
            }
        })
        .catch(function () { mostrarToast('Erro de comunicacao', 'erro'); })
        .finally(function () {
            if (btnConfirmar) { btnConfirmar.disabled = false; btnConfirmar.innerHTML = '<i class="fas fa-check"></i> Confirmar'; }
        });
    }

    function abrirDetalhe(visitaId) {
        estado.modoEdicao = false;
        estado.visitaAtual = null;

        var body = document.getElementById('modal-detalhe-body');
        if (body) body.innerHTML = '<div class="loading"><div class="loading-spinner"></div><p>Carregando...</p></div>';

        var btnEditar = document.getElementById('btn-ativar-edicao');
        var btnSalvar = document.getElementById('btn-salvar-edicao');
        var btnAlterarStatus = document.getElementById('btn-alterar-status-ronda');
        if (btnEditar) btnEditar.style.display = 'none';
        if (btnSalvar) btnSalvar.style.display = 'none';
        if (btnAlterarStatus) btnAlterarStatus.style.display = 'none';

        var titulo = document.getElementById('modal-titulo');
        if (titulo) titulo.textContent = 'Detalhe da Visita';

        document.getElementById('modal-detalhe').classList.add('ativo');

        fetch(CONFIG.apiVisita + '/' + visitaId)
            .then(function (r) { return r.json(); })
            .then(function (data) {
                if (data.success) {
                    estado.visitaAtual = data.data;
                    estado.isAdmin = data.data.is_admin || false;
                    renderizarDetalhe(data.data, false);

                    // Botao alterar status visivel para todos
                    if (btnAlterarStatus) btnAlterarStatus.style.display = 'flex';

                    if (estado.isAdmin && btnEditar) {
                        btnEditar.style.display = 'flex';
                    }
                } else {
                    if (body) body.innerHTML = '<p style="color:#dc3545;">Erro: ' + escapeHtml(data.error) + '</p>';
                }
            })
            .catch(function () {
                if (body) body.innerHTML = '<p style="color:#dc3545;">Erro de comunicacao</p>';
            });
    }

    function renderizarDetalhe(visita, editavel) {
        var body = document.getElementById('modal-detalhe-body');
        if (!body) return;

        var html = '';

        // Header com info e badge
        html += '<div class="detalhe-info-header">';
        html += '<div class="detalhe-info-left">';

        if (editavel) {
            html += '<div class="detalhe-campo-edit"><label>Leito:</label>';
            html += '<input type="text" id="edit-leito" value="' + escapeAttr(visita.leito) + '" maxlength="30"></div>';
            html += '<div class="detalhe-campo-edit"><label>Nr Atendimento:</label>';
            html += '<input type="text" id="edit-atendimento" value="' + escapeAttr(visita.nr_atendimento || '') + '" maxlength="30"></div>';
        } else {
            html += '<h3>' + escapeHtml(visita.setor_nome) + ' - Leito ' + escapeHtml(visita.leito) + '</h3>';
            html += '<div class="detalhe-meta">';
            html += '<i class="fas fa-user-friends"></i> ' + escapeHtml(visita.dupla_nome) + '<br>';
            html += '<i class="fas fa-calendar"></i> ' + formatarData(visita.data_ronda) + '<br>';
            if (visita.nr_atendimento) html += '<i class="fas fa-file-medical"></i> Atendimento: ' + escapeHtml(visita.nr_atendimento) + '<br>';
            html += '<i class="fas fa-info-circle"></i> Status: ' + formatarStatus(visita.status_ronda);
            html += '</div>';
        }

        html += '</div>';

        if (editavel) {
            html += '<div class="detalhe-campo-edit"><label>Avaliacao Final:</label>';
            html += '<select id="edit-avaliacao-final">';
            html += '<option value="critico"' + (visita.avaliacao_final === 'critico' ? ' selected' : '') + '>Critico</option>';
            html += '<option value="atencao"' + (visita.avaliacao_final === 'atencao' ? ' selected' : '') + '>Atencao</option>';
            html += '<option value="adequado"' + (visita.avaliacao_final === 'adequado' ? ' selected' : '') + '>Adequado</option>';
            html += '</select></div>';
            html += '<div class="detalhe-campo-edit"><label>Status da Ronda:</label>';
            html += '<select id="edit-status-ronda">';
            html += '<option value="em_andamento"' + (visita.status_ronda === 'em_andamento' ? ' selected' : '') + '>Em andamento</option>';
            html += '<option value="concluida"' + (visita.status_ronda === 'concluida' ? ' selected' : '') + '>Concluida</option>';
            html += '<option value="cancelada"' + (visita.status_ronda === 'cancelada' ? ' selected' : '') + '>Cancelada</option>';
            html += '</select></div>';
        } else {
            html += '<span class="detalhe-badge-grande badge-' + visita.avaliacao_final + '">' + formatarResultado(visita.avaliacao_final) + '</span>';
        }

        html += '</div>';

        // Categorias com avaliacoes
        if (visita.categorias) {
            visita.categorias.forEach(function (cat) {
                html += '<div class="detalhe-categoria">';
                html += '<div class="detalhe-cat-nome">' + escapeHtml(cat.icone || '') + ' ' + escapeHtml(cat.nome) + '</div>';

                cat.itens.forEach(function (item) {
                    html += '<div class="detalhe-item">';
                    html += '<span class="detalhe-item-desc">' + escapeHtml(item.descricao) + '</span>';

                    if (editavel) {
                        html += '<span class="detalhe-item-edit">';
                        html += '<select data-avaliacao-id="' + item.avaliacao_id + '">';
                        html += '<option value="critico"' + (item.resultado === 'critico' ? ' selected' : '') + '>Critico</option>';
                        html += '<option value="atencao"' + (item.resultado === 'atencao' ? ' selected' : '') + '>Atencao</option>';
                        html += '<option value="adequado"' + (item.resultado === 'adequado' ? ' selected' : '') + '>Adequado</option>';
                        if (cat.permite_nao_aplica) {
                            html += '<option value="nao_aplica"' + (item.resultado === 'nao_aplica' ? ' selected' : '') + '>N/A</option>';
                        }
                        html += '</select></span>';
                    } else {
                        html += '<span class="detalhe-resultado resultado-' + item.resultado + '">' + formatarResultado(item.resultado) + '</span>';
                    }

                    html += '</div>';
                });

                html += '</div>';
            });
        }

        // Observacoes
        html += '<div class="detalhe-secao">';
        html += '<div class="detalhe-secao-titulo"><i class="fas fa-comment-dots"></i> Observacoes</div>';
        if (editavel) {
            html += '<div class="detalhe-campo-edit">';
            html += '<textarea id="edit-observacoes" maxlength="2000">' + escapeHtml(visita.observacoes || '') + '</textarea>';
            html += '</div>';
        } else {
            if (visita.observacoes) {
                html += '<div class="detalhe-obs">' + escapeHtml(visita.observacoes) + '</div>';
            } else {
                html += '<div class="detalhe-obs" style="color:#ccc;">Sem observacoes</div>';
            }
        }
        html += '</div>';

        // Imagens
        if (visita.imagens && visita.imagens.length > 0) {
            html += '<div class="detalhe-secao">';
            html += '<div class="detalhe-secao-titulo"><i class="fas fa-camera"></i> Imagens (' + visita.imagens.length + ')</div>';
            html += '<div class="detalhe-imagens">';
            visita.imagens.forEach(function (img) {
                html += '<div class="detalhe-img" onclick="window.open(\'' + escapeAttr(img.url) + '\', \'_blank\')">';
                html += '<img src="' + escapeAttr(img.url) + '" alt="' + escapeAttr(img.nome_original || 'Imagem') + '">';
                html += '</div>';
            });
            html += '</div></div>';
        }

        // Tratativas
        if (visita.tratativas && visita.tratativas.length > 0 && !editavel) {
            html += '<div class="detalhe-secao">';
            html += '<div class="detalhe-secao-titulo"><i class="fas fa-clipboard-check"></i> Tratativas (' + visita.tratativas.length + ')</div>';
            html += '<div class="tratativas-detalhe-lista">';
            visita.tratativas.forEach(function (t) {
                html += '<div class="tratativa-detalhe-item tratativa-st-' + t.status + '">';
                html += '<div class="trat-item-header">';
                html += '<span class="trat-status-badge trat-st-' + t.status + '">' + formatarStatusTratativa(t.status) + '</span>';
                html += '<span class="trat-item-cat"><i class="' + escapeHtml(t.categoria_icone || 'fas fa-tag') + '"></i> ' + escapeHtml(t.categoria_nome) + '</span>';
                html += '<span class="trat-item-resp"><i class="fas fa-user"></i> ' + escapeHtml(t.responsavel_display) + '</span>';
                html += '</div>';
                html += '<div class="trat-item-desc"><strong>' + escapeHtml(t.item_descricao) + '</strong></div>';
                if (t.descricao_problema) {
                    html += '<div class="trat-item-problema"><i class="fas fa-exclamation-triangle"></i> ' + escapeHtml(t.descricao_problema) + '</div>';
                }
                if (t.plano_acao) {
                    html += '<div class="trat-item-plano"><i class="fas fa-tasks"></i> <em>' + escapeHtml(t.plano_acao) + '</em></div>';
                }
                if (t.data_resolucao) {
                    html += '<div class="trat-item-meta">Resolvido em: ' + formatarData(t.data_resolucao) + '</div>';
                }
                html += '</div>';
            });
            html += '</div></div>';
        } else if (!editavel) {
            var temCriticos = visita.categorias && visita.categorias.some(function(c) {
                return c.itens && c.itens.some(function(i) { return i.resultado === 'critico'; });
            });
            if (temCriticos) {
                html += '<div class="detalhe-secao">';
                html += '<div class="detalhe-secao-titulo"><i class="fas fa-clipboard-check"></i> Tratativas</div>';
                html += '<div class="detalhe-obs" style="color:#aaa;"><i class="fas fa-info-circle"></i> Nenhuma tratativa registrada para esta visita.</div>';
                html += '</div>';
            }
        }

        // Historico de alteracoes (apenas visualizacao)
        if (visita.historico && visita.historico.length > 0 && !editavel) {
            html += '<div class="detalhe-secao">';
            html += '<div class="detalhe-secao-titulo"><i class="fas fa-history"></i> Historico de Alteracoes</div>';
            visita.historico.forEach(function (h) {
                html += '<div class="historico-item">';
                html += '<span class="historico-acao">' + escapeHtml(h.acao) + '</span>';
                html += '<span class="historico-desc">';
                if (h.campo_alterado) html += escapeHtml(h.campo_alterado) + ': ';
                if (h.valor_anterior) html += '<s>' + escapeHtml(h.valor_anterior) + '</s> &rarr; ';
                if (h.valor_novo) html += escapeHtml(h.valor_novo);
                html += '</span>';
                html += '<span class="historico-meta">' + escapeHtml(h.usuario || '') + ' ' + formatarDataHora(h.criado_em) + '</span>';
                html += '</div>';
            });
            html += '</div>';
        }

        body.innerHTML = html;
    }

    function ativarModoEdicao() {
        if (!estado.visitaAtual || !estado.isAdmin) return;

        estado.modoEdicao = true;

        var titulo = document.getElementById('modal-titulo');
        if (titulo) titulo.textContent = 'Editar Visita';

        var btnEditar = document.getElementById('btn-ativar-edicao');
        var btnSalvar = document.getElementById('btn-salvar-edicao');
        if (btnEditar) btnEditar.style.display = 'none';
        if (btnSalvar) btnSalvar.style.display = 'flex';

        renderizarDetalhe(estado.visitaAtual, true);
    }

    function salvarEdicao() {
        if (!estado.visitaAtual || !estado.isAdmin) return;

        var leito = (document.getElementById('edit-leito').value || '').trim();
        var atendimento = (document.getElementById('edit-atendimento').value || '').trim();
        var avaliacaoFinal = document.getElementById('edit-avaliacao-final').value;
        var observacoes = (document.getElementById('edit-observacoes').value || '').trim();
        var novoStatusRonda = document.getElementById('edit-status-ronda') ? document.getElementById('edit-status-ronda').value : null;

        // Coletar avaliacoes editadas
        var avaliacoes = [];
        var selects = document.querySelectorAll('[data-avaliacao-id]');
        for (var i = 0; i < selects.length; i++) {
            avaliacoes.push({
                avaliacao_id: parseInt(selects[i].getAttribute('data-avaliacao-id')),
                resultado: selects[i].value
            });
        }

        var payload = {
            leito: leito,
            nr_atendimento: atendimento || null,
            avaliacao_final: avaliacaoFinal,
            observacoes: observacoes || null,
            avaliacoes: avaliacoes
        };

        var btnSalvar = document.getElementById('btn-salvar-edicao');
        if (btnSalvar) {
            btnSalvar.disabled = true;
            btnSalvar.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Salvando...';
        }

        // Salvar visita e opcionalmente status da ronda
        var salvarVisita = fetch(CONFIG.apiVisita + '/' + estado.visitaAtual.id, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        }).then(function (r) { return r.json(); });

        var salvarRonda = (novoStatusRonda && novoStatusRonda !== estado.visitaAtual.status_ronda)
            ? fetch(CONFIG.apiRondas + '/' + estado.visitaAtual.ronda_id + '/status', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ status: novoStatusRonda })
            }).then(function (r) { return r.json(); })
            : Promise.resolve(null);

        Promise.all([salvarVisita, salvarRonda])
            .then(function (resultados) {
                var resVisita = resultados[0];
                var resRonda = resultados[1];
                if (!resVisita.success) {
                    mostrarToast(resVisita.error || 'Erro ao salvar visita', 'erro');
                    return;
                }
                if (resRonda && !resRonda.success) {
                    mostrarToast(resRonda.error || 'Erro ao alterar status da ronda', 'erro');
                    return;
                }
                var msg = resVisita.message || 'Visita atualizada';
                if (resRonda && resRonda.success) msg += '. ' + resRonda.message;
                mostrarToast(msg, 'sucesso');
                fecharDetalhe();
                carregarTudo();
            })
            .catch(function () {
                mostrarToast('Erro de comunicacao', 'erro');
            })
            .finally(function () {
                if (btnSalvar) {
                    btnSalvar.disabled = false;
                    btnSalvar.innerHTML = '<i class="fas fa-save"></i> Salvar Alteracoes';
                }
            });
    }

    function fecharDetalhe() {
        estado.modoEdicao = false;
        estado.visitaAtual = null;
        var modal = document.getElementById('modal-detalhe');
        if (modal) modal.classList.remove('ativo');

        var btnSalvar = document.getElementById('btn-salvar-edicao');
        if (btnSalvar) btnSalvar.style.display = 'none';
    }

    // ========================================
    // EXPORTAR EXCEL
    // ========================================

    function exportarExcel() {
        var url = construirUrl(CONFIG.apiExportar);

        mostrarToast('Gerando exportacao...', 'info');

        fetch(url)
            .then(function (r) {
                if (!r.ok) {
                    return r.json().then(function (d) {
                        throw new Error(d.error || 'Erro na exportacao');
                    });
                }
                return r.blob();
            })
            .then(function (blob) {
                var a = document.createElement('a');
                a.href = URL.createObjectURL(blob);
                a.download = 'sentir_agir_' + dataHoje().replace(/-/g, '') + '.csv';
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                URL.revokeObjectURL(a.href);
                mostrarToast('Exportacao concluida', 'sucesso');
            })
            .catch(function (err) {
                mostrarToast(err.message || 'Erro na exportacao', 'erro');
            });
    }

    // ========================================
    // UTILITARIOS
    // ========================================

    function setTexto(id, texto) {
        var el = document.getElementById(id);
        if (el) el.textContent = texto;
    }

    function dataHoje() {
        var d = new Date();
        return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    }

    function formatarData(dataStr) {
        if (!dataStr) return '--';
        var partes = dataStr.split('-');
        if (partes.length === 3) return partes[2] + '/' + partes[1] + '/' + partes[0];
        return dataStr;
    }

    function formatarDataHora(isoStr) {
        if (!isoStr) return '--';
        try {
            var d = new Date(isoStr);
            return String(d.getDate()).padStart(2, '0') + '/' +
                String(d.getMonth() + 1).padStart(2, '0') + ' ' +
                String(d.getHours()).padStart(2, '0') + ':' +
                String(d.getMinutes()).padStart(2, '0');
        } catch (e) { return '--'; }
    }

    function formatarResultado(r) {
        return { 'critico': 'Critico', 'atencao': 'Atencao', 'adequado': 'Adequado', 'nao_aplica': 'N/A' }[r] || r;
    }

    function formatarStatus(s) {
        return { 'em_andamento': 'Em andamento', 'concluida': 'Concluida', 'cancelada': 'Cancelada' }[s] || s;
    }

    function formatarStatusTratativa(s) {
        return {
            'pendente': 'Pendente',
            'em_tratativa': 'Em Tratativa',
            'regularizado': 'Regularizado',
            'cancelado': 'Cancelado',
            'sem_pendencia': 'OK'
        }[s] || s;
    }

    function atualizarHora() {
        var agora = new Date();
        setTexto('ultima-atualizacao', agora.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }));
    }

    function escapeHtml(t) { if (!t) return ''; var d = document.createElement('div'); d.textContent = t; return d.innerHTML; }
    function escapeAttr(t) { if (!t) return ''; return t.replace(/&/g, '&amp;').replace(/'/g, '&#39;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

    function mostrarToast(msg, tipo) {
        var c = document.getElementById('toast-container');
        if (!c) return;
        var t = document.createElement('div');
        t.className = 'toast toast-' + (tipo || 'info');
        var icone = tipo === 'sucesso' ? '<i class="fas fa-check-circle"></i>' : tipo === 'erro' ? '<i class="fas fa-times-circle"></i>' : '<i class="fas fa-info-circle"></i>';
        t.innerHTML = icone + ' ' + escapeHtml(msg);
        c.appendChild(t);
        setTimeout(function () { if (t.parentNode) t.parentNode.removeChild(t); }, 4000);
    }

    // ========================================
    // EXPOR FUNCOES GLOBAIS
    // ========================================

    window.P29 = {
        abrirDetalhe: abrirDetalhe
    };

    // ========================================
    // START
    // ========================================

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', inicializar);
    } else {
        inicializar();
    }

})();