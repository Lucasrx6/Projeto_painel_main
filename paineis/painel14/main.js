// ========================================
// PAINEL 14 - CENTRAL DE CHAMADOS TI
// Hospital Anchieta Ceilandia
// ========================================

(function () {
    'use strict';

    var BASE_URL = window.location.origin;

    var CONFIG = {
        apiDashboard: BASE_URL + '/api/paineis/painel14/dashboard',
        apiChamados: BASE_URL + '/api/paineis/painel14/chamados',
        apiHistorico: BASE_URL + '/api/paineis/painel14/historico',
        apiConfig: BASE_URL + '/api/paineis/painel14/config',
        apiContagem: BASE_URL + '/api/paineis/painel14/contagem',
        intervaloRefresh: 10000,
        tempoAlertaCriticoMin: 30
    };

    var estado = {
        chamadosAnteriores: [],
        dadosHistorico: [],
        somAtivo: true,
        volume: 0.7,
        abaAtual: 'ativos',
        chamadoSelecionado: null,
        refreshInterval: null,
        primeiroCarregamento: true,
        novosChamadosFila: [],
        modalAutoCloseTimer: null,
        reAlertaInterval: null,
        ultimaAcaoTecnico: Date.now(),
        temChamadosPendentes: false
    };

    // ========================================
    // INICIALIZACAO
    // ========================================

    function inicializar() {
        console.log('Inicializando Painel 14 - Central de Chamados TI...');

        configurarBotoes();
        configurarAbas();
        configurarModais();
        configurarContadores();
        configurarVolumeControl();
        configurarPesquisaHistorico();
        configurarReAlerta();
        carregarConfiguracoes();
        carregarDados();

        estado.refreshInterval = setInterval(carregarDados, CONFIG.intervaloRefresh);

        console.log('Painel 14 inicializado com sucesso');
    }

    // ========================================
    // BOTOES
    // ========================================

    function configurarBotoes() {
        var btnVoltar = document.getElementById('btn-voltar');
        if (btnVoltar) btnVoltar.addEventListener('click', function () { window.location.href = '/frontend/dashboard.html'; });

        var btnRefresh = document.getElementById('btn-refresh');
        if (btnRefresh) btnRefresh.addEventListener('click', function () { carregarDados(); mostrarToast('Dados atualizados', 'info'); });

        var btnSom = document.getElementById('btn-som');
        if (btnSom) btnSom.addEventListener('click', toggleSom);

        var btnHistorico = document.getElementById('btn-historico');
        if (btnHistorico) btnHistorico.addEventListener('click', function () { trocarAba('historico'); });

        var btnGerenciar = document.getElementById('btn-gerenciar');
        if (btnGerenciar) btnGerenciar.addEventListener('click', function () { abrirGerenciamento(); });

        // Botao entendido do modal novo chamado
        var btnEntendido = document.getElementById('btn-novo-entendido');
        if (btnEntendido) {
            btnEntendido.addEventListener('click', function () {
                registrarAcaoTecnico(); // Acao manual = reseta inatividade
                fecharModalNovoChamado();
            });
        }
    }

    // Fecha o modal de novo chamado e processa fila
    function fecharModalNovoChamado() {
        // Limpar timer de auto-close
        if (estado.modalAutoCloseTimer) {
            clearTimeout(estado.modalAutoCloseTimer);
            estado.modalAutoCloseTimer = null;
        }

        fecharModalFn('modal-novo-chamado');

        // Se ha mais chamados na fila, mostra o proximo
        if (estado.novosChamadosFila.length > 0) {
            var proximo = estado.novosChamadosFila.shift();
            setTimeout(function () { exibirModalNovoChamado(proximo); }, 400);
        }
    }

    // ========================================
    // ABAS
    // ========================================

    function configurarAbas() {
        var tabAtivos = document.getElementById('tab-ativos');
        var tabHistorico = document.getElementById('tab-historico');

        if (tabAtivos) tabAtivos.addEventListener('click', function () { trocarAba('ativos'); });
        if (tabHistorico) tabHistorico.addEventListener('click', function () { trocarAba('historico'); });

        var filtroDias = document.getElementById('filtro-dias');
        if (filtroDias) filtroDias.addEventListener('change', function () { carregarHistorico(); });
    }

    function trocarAba(aba) {
        estado.abaAtual = aba;
        var tabAtivos = document.getElementById('tab-ativos');
        var tabHistorico = document.getElementById('tab-historico');
        var containerAtivos = document.getElementById('container-ativos');
        var containerHistorico = document.getElementById('container-historico');

        if (aba === 'ativos') {
            tabAtivos.classList.add('tab-ativa');
            tabHistorico.classList.remove('tab-ativa');
            containerAtivos.style.display = 'flex';
            containerHistorico.style.display = 'none';
        } else {
            tabAtivos.classList.remove('tab-ativa');
            tabHistorico.classList.add('tab-ativa');
            containerAtivos.style.display = 'none';
            containerHistorico.style.display = 'flex';
            carregarHistorico();
        }
    }

    function configurarContadores() {
        var obsFechar = document.getElementById('input-obs-fechar');
        if (obsFechar) obsFechar.addEventListener('input', function () { document.getElementById('count-obs-fechar').textContent = this.value.length; });

        var obsTexto = document.getElementById('input-observacao');
        if (obsTexto) obsTexto.addEventListener('input', function () { document.getElementById('count-obs').textContent = this.value.length; });
    }

    // ========================================
    // CONTROLE DE VOLUME
    // ========================================

    function configurarVolumeControl() {
        var volumeControl = document.getElementById('volume-control');
        var btnSom = document.getElementById('btn-som');
        var slider = document.getElementById('volume-slider');
        var valorEl = document.getElementById('volume-valor');

        // Toggle expansao do slider ao clicar no icone de som
        if (btnSom) {
            btnSom.addEventListener('click', function (e) {
                e.stopPropagation();
                if (volumeControl) volumeControl.classList.toggle('expandido');
            });
        }

        // Slider de volume
        if (slider) {
            slider.addEventListener('input', function () {
                var val = parseInt(this.value);
                estado.volume = val / 100;
                if (valorEl) valorEl.textContent = val + '%';

                // Atualizar icone
                atualizarIconeSom();

                // Atualizar audio
                var audio = document.getElementById('audio-alerta');
                if (audio) audio.volume = estado.volume;

                // Salvar no banco
                salvarConfiguracao('som_alerta_volume', (estado.volume).toFixed(2));
            });
        }

        // Fechar slider ao clicar fora
        document.addEventListener('click', function (e) {
            if (volumeControl && !volumeControl.contains(e.target)) {
                volumeControl.classList.remove('expandido');
            }
        });
    }

    function toggleSom() {
        estado.somAtivo = !estado.somAtivo;
        atualizarIconeSom();
        salvarConfiguracao('som_alerta_ativo', estado.somAtivo ? 'true' : 'false');
        mostrarToast(estado.somAtivo ? 'Som de alerta ativado' : 'Som de alerta desativado', 'info');
    }

    function atualizarIconeSom() {
        var btnSom = document.getElementById('btn-som');
        if (!btnSom) return;

        if (!estado.somAtivo || estado.volume === 0) {
            btnSom.classList.remove('btn-som-ativo');
            btnSom.classList.add('btn-som-inativo');
            btnSom.innerHTML = '<i class="fas fa-volume-mute"></i>';
        } else if (estado.volume < 0.4) {
            btnSom.classList.remove('btn-som-inativo');
            btnSom.classList.add('btn-som-ativo');
            btnSom.innerHTML = '<i class="fas fa-volume-down"></i>';
        } else {
            btnSom.classList.remove('btn-som-inativo');
            btnSom.classList.add('btn-som-ativo');
            btnSom.innerHTML = '<i class="fas fa-volume-up"></i>';
        }
    }

    // ========================================
    // SISTEMA DE RE-ALERTA (INATIVIDADE)
    // ========================================

    // A cada 1 minuto, se houver chamados pendentes (abertos/nao visualizados)
    // e nenhuma acao do tecnico, toca o som novamente
    function configurarReAlerta() {
        estado.reAlertaInterval = setInterval(function () {
            if (!estado.temChamadosPendentes) return;

            var agora = Date.now();
            var inativo = (agora - estado.ultimaAcaoTecnico) >= 60000; // 1 minuto

            if (inativo) {
                console.log('Re-alerta: inatividade detectada com chamados pendentes');
                tocarAlerta();
                ativarAlertaGlobal(0); // Reforcar alerta visual
            }
        }, 60000); // Verifica a cada 60s
    }

    // Registra qualquer acao do tecnico para resetar o timer de inatividade
    function registrarAcaoTecnico() {
        estado.ultimaAcaoTecnico = Date.now();
    }

    // ========================================
    // SISTEMA DE AUDIO (MP3)
    // ========================================

    function tocarAlerta() {
        if (!estado.somAtivo) return;

        var audio = document.getElementById('audio-alerta');
        if (!audio) return;

        try {
            audio.volume = estado.volume;
            audio.currentTime = 0;
            audio.play().catch(function (err) {
                console.warn('Audio bloqueado pelo navegador (requer interacao do usuario):', err);
            });
        } catch (e) {
            console.warn('Erro ao tocar alerta:', e);
        }
    }

    // ========================================
    // PESQUISA NO HISTORICO
    // ========================================

    function configurarPesquisaHistorico() {
        var inputPesquisa = document.getElementById('pesquisa-historico');
        var btnLimpar = document.getElementById('pesquisa-limpar');

        if (inputPesquisa) {
            inputPesquisa.addEventListener('input', function () {
                var termo = this.value.trim();
                if (btnLimpar) btnLimpar.style.display = termo ? 'block' : 'none';
                filtrarHistorico(termo);
            });
        }

        if (btnLimpar) {
            btnLimpar.addEventListener('click', function () {
                if (inputPesquisa) inputPesquisa.value = '';
                this.style.display = 'none';
                filtrarHistorico('');
            });
        }
    }

    function filtrarHistorico(termo) {
        if (!termo) {
            renderizarHistorico(estado.dadosHistorico);
            return;
        }

        var termoLower = termo.toLowerCase();
        var filtrados = estado.dadosHistorico.filter(function (ch) {
            return (
                (ch.numero_kora || '').toLowerCase().indexOf(termoLower) !== -1 ||
                (ch.nome_solicitante || '').toLowerCase().indexOf(termoLower) !== -1 ||
                (ch.local_problema || '').toLowerCase().indexOf(termoLower) !== -1 ||
                (ch.hostname || '').toLowerCase().indexOf(termoLower) !== -1 ||
                (ch.ip || '').toLowerCase().indexOf(termoLower) !== -1 ||
                (ch.problema_descricao || '').toLowerCase().indexOf(termoLower) !== -1 ||
                (ch.tecnico_atendimento || '').toLowerCase().indexOf(termoLower) !== -1 ||
                (ch.observacao_fechamento || '').toLowerCase().indexOf(termoLower) !== -1 ||
                (ch.observacao_abertura || '').toLowerCase().indexOf(termoLower) !== -1 ||
                (ch.status || '').toLowerCase().indexOf(termoLower) !== -1
            );
        });

        renderizarHistorico(filtrados);
    }

    // ========================================
    // CARREGAMENTO DE DADOS
    // ========================================

    function carregarConfiguracoes() {
        fetch(CONFIG.apiConfig)
            .then(function (res) { return res.json(); })
            .then(function (data) {
                if (data.success && data.data) {
                    var cfg = data.data;
                    estado.somAtivo = cfg.som_alerta_ativo !== 'false';
                    estado.volume = parseFloat(cfg.som_alerta_volume) || 0.7;
                    CONFIG.intervaloRefresh = parseInt(cfg.intervalo_refresh) || 10000;
                    CONFIG.tempoAlertaCriticoMin = parseInt(cfg.tempo_alerta_critico_min) || 30;

                    // Aplicar volume no slider
                    var slider = document.getElementById('volume-slider');
                    var valorEl = document.getElementById('volume-valor');
                    if (slider) slider.value = Math.round(estado.volume * 100);
                    if (valorEl) valorEl.textContent = Math.round(estado.volume * 100) + '%';

                    // Aplicar volume no audio
                    var audio = document.getElementById('audio-alerta');
                    if (audio) audio.volume = estado.volume;

                    atualizarIconeSom();

                    if (CONFIG.intervaloRefresh !== 10000 && estado.refreshInterval) {
                        clearInterval(estado.refreshInterval);
                        estado.refreshInterval = setInterval(carregarDados, CONFIG.intervaloRefresh);
                    }
                }
            })
            .catch(function (err) { console.warn('Erro ao carregar configuracoes:', err); });
    }

    function carregarDados() {
        Promise.all([
            fetch(CONFIG.apiDashboard).then(function (r) { return r.json(); }),
            fetch(CONFIG.apiChamados).then(function (r) { return r.json(); })
        ]).then(function (resultados) {
            var dashData = resultados[0];
            var chamadosData = resultados[1];

            if (dashData.success) atualizarEstatisticas(dashData.data);

            if (chamadosData.success) {
                var chamadosNovos = verificarNovosChamados(chamadosData.data);
                atualizarListaChamados(chamadosData.data);
                estado.chamadosAnteriores = chamadosData.data.map(function (c) { return c.id; });

                // Na primeira carga: se ha chamados abertos nao visualizados, tocar audio
                if (estado.primeiroCarregamento) {
                    var naoVisualizados = chamadosData.data.filter(function (c) { return !c.visualizado; });
                    if (naoVisualizados.length > 0) {
                        ativarAlertaGlobal(naoVisualizados.length);
                        tocarAlerta();
                    }
                }
            }

            atualizarHora();

            if (estado.primeiroCarregamento) {
                estado.primeiroCarregamento = false;
                var loading = document.getElementById('loading-chamados');
                if (loading) loading.style.display = 'none';
            }
        }).catch(function (err) { console.error('Erro ao carregar dados:', err); });
    }

    function carregarHistorico() {
        var filtroDias = document.getElementById('filtro-dias');
        var dias = filtroDias ? filtroDias.value : 7;

        fetch(CONFIG.apiHistorico + '?dias=' + dias)
            .then(function (res) { return res.json(); })
            .then(function (data) {
                if (data.success) {
                    estado.dadosHistorico = data.data || [];
                    var badge = document.getElementById('badge-historico');
                    if (badge) badge.textContent = data.total || 0;

                    // Aplicar filtro se houver texto de pesquisa
                    var inputPesquisa = document.getElementById('pesquisa-historico');
                    var termo = inputPesquisa ? inputPesquisa.value.trim() : '';
                    if (termo) {
                        filtrarHistorico(termo);
                    } else {
                        renderizarHistorico(estado.dadosHistorico);
                    }
                }
            })
            .catch(function (err) { console.error('Erro ao carregar historico:', err); });
    }

    // ========================================
    // DETECCAO DE NOVOS CHAMADOS
    // ========================================

    function verificarNovosChamados(chamados) {
        if (estado.primeiroCarregamento) return [];

        var idsAtuais = chamados.map(function (c) { return c.id; });
        var novosIds = idsAtuais.filter(function (id) { return estado.chamadosAnteriores.indexOf(id) === -1; });

        if (novosIds.length > 0) {
            ativarAlertaGlobal(novosIds.length);
            tocarAlerta();

            // Buscar dados dos novos chamados e exibir modal impactante
            var novosChamados = chamados.filter(function (c) { return novosIds.indexOf(c.id) !== -1; });
            if (novosChamados.length > 0) {
                // Exibir o primeiro imediatamente, enfileirar os demais
                exibirModalNovoChamado(novosChamados[0]);
                for (var i = 1; i < novosChamados.length; i++) {
                    estado.novosChamadosFila.push(novosChamados[i]);
                }
            }
        }

        var naoVisualizados = chamados.filter(function (c) { return !c.visualizado; });
        if (naoVisualizados.length === 0) desativarAlertaGlobal();

        return novosIds;
    }

    // ========================================
    // MODAL: NOVO CHAMADO (IMPACTANTE)
    // ========================================

    function exibirModalNovoChamado(chamado) {
        var body = document.getElementById('modal-novo-body');
        if (!body) return;

        var dataAbertura = chamado.data_abertura ? formatarDataHora(chamado.data_abertura) : 'Agora';

        body.innerHTML =
            '<div class="novo-campo"><i class="fas fa-ticket-alt"></i> <strong>Kora #' + escapeHtml(chamado.numero_kora) + '</strong></div>' +
            '<div class="novo-campo"><i class="fas fa-user"></i> Solicitante: <strong>' + escapeHtml(chamado.nome_solicitante) + '</strong></div>' +
            '<div class="novo-campo"><i class="fas fa-map-marker-alt"></i> Local: <strong>' + escapeHtml(chamado.local_problema) + '</strong></div>' +
            (chamado.hostname ? '<div class="novo-campo"><i class="fas fa-desktop"></i> Hostname: <strong>' + escapeHtml(chamado.hostname) + '</strong></div>' : '') +
            (chamado.ip ? '<div class="novo-campo"><i class="fas fa-network-wired"></i> IP: <strong>' + escapeHtml(chamado.ip) + '</strong></div>' : '') +
            (chamado.problema_descricao ? '<div class="novo-campo"><i class="fas fa-tools"></i> Problema: <strong>' + escapeHtml(chamado.problema_descricao) + '</strong></div>' : '') +
            '<div class="novo-campo"><i class="fas fa-clock"></i> Abertura: <strong>' + dataAbertura + '</strong></div>' +
            (chamado.observacao_abertura ? '<div class="novo-campo"><i class="fas fa-comment"></i> ' + escapeHtml(chamado.observacao_abertura) + '</div>' : '');

        abrirModal('modal-novo-chamado');

        // Auto-fechar apos 5 segundos
        if (estado.modalAutoCloseTimer) clearTimeout(estado.modalAutoCloseTimer);
        estado.modalAutoCloseTimer = setTimeout(function () {
            fecharModalNovoChamado();
        }, 5000);
    }

    function ativarAlertaGlobal(quantidade) {
        var alerta = document.getElementById('alerta-global');
        var texto = document.getElementById('alerta-global-texto');
        var cardAbertos = document.getElementById('card-abertos');

        if (alerta) {
            alerta.classList.add('ativo');
            if (texto) texto.textContent = quantidade === 1 ? 'NOVO CHAMADO RECEBIDO!' : quantidade + ' NOVOS CHAMADOS RECEBIDOS!';
        }
        if (cardAbertos) cardAbertos.classList.add('piscando');
    }

    function desativarAlertaGlobal() {
        var alerta = document.getElementById('alerta-global');
        var cardAbertos = document.getElementById('card-abertos');
        if (alerta) alerta.classList.remove('ativo');
        if (cardAbertos) cardAbertos.classList.remove('piscando');
    }

    // ========================================
    // ATUALIZAR ESTATISTICAS
    // ========================================

    function atualizarEstatisticas(dados) {
        setTexto('stat-abertos', dados.total_abertos || 0);
        setTexto('stat-em-atendimento', dados.total_em_atendimento || 0);
        setTexto('stat-nao-visualizados', dados.nao_visualizados || 0);
        setTexto('stat-fechados-hoje', dados.fechados_hoje || 0);
        setTexto('stat-abertos-hoje', dados.abertos_hoje || 0);

        var tempoMedio = parseFloat(dados.tempo_medio_atendimento_min) || 0;
        setTexto('stat-tempo-medio', tempoMedio.toFixed(0) + ' min');

        var totalAtivos = (parseInt(dados.total_abertos) || 0) + (parseInt(dados.total_em_atendimento) || 0);
        setTexto('badge-ativos', totalAtivos);

        // Atualizar flag de chamados pendentes para sistema de re-alerta
        estado.temChamadosPendentes = (parseInt(dados.total_abertos) || 0) > 0;

        var cardAbertos = document.getElementById('card-abertos');
        if (cardAbertos) {
            if ((parseInt(dados.nao_visualizados) || 0) > 0) {
                cardAbertos.classList.add('piscando');
            } else {
                cardAbertos.classList.remove('piscando');
                desativarAlertaGlobal();
            }
        }
    }

    // ========================================
    // RENDERIZAR CHAMADOS ATIVOS
    // ========================================

    function atualizarListaChamados(chamados) {
        var lista = document.getElementById('lista-chamados');
        var vazio = document.getElementById('vazio-chamados');
        var loading = document.getElementById('loading-chamados');

        if (loading) loading.style.display = 'none';
        if (!lista) return;

        if (!chamados || chamados.length === 0) {
            lista.innerHTML = '';
            if (vazio) vazio.style.display = 'block';
            return;
        }

        if (vazio) vazio.style.display = 'none';

        lista.innerHTML = chamados.map(function (ch) {
            var isNovo = !ch.visualizado;
            var minutosAberto = parseFloat(ch.minutos_aberto) || 0;
            var isCritico = minutosAberto >= CONFIG.tempoAlertaCriticoMin;
            var dataAbertura = ch.data_abertura ? formatarDataHora(ch.data_abertura) : '--';

            var classeCard = 'chamado-card status-' + ch.status;
            if (isNovo) classeCard += ' chamado-novo';

            var html = '<div class="' + classeCard + '" data-id="' + ch.id + '">';
            html += '<div class="chamado-card-header">';
            html += '  <div class="chamado-card-titulo">';
            html += '    <span class="chamado-kora"><i class="fas fa-ticket-alt"></i> #' + escapeHtml(ch.numero_kora) + '</span>';
            html += '    <span class="chamado-status-badge badge-' + ch.status + '">' + formatarStatus(ch.status) + '</span>';
            html += '    <span class="chamado-prioridade-badge prioridade-' + ch.prioridade + '">' + ch.prioridade + '</span>';
            html += '  </div>';
            html += '  <div class="chamado-tempo' + (isCritico ? ' tempo-critico' : '') + '">';
            html += '    <i class="fas fa-stopwatch"></i> ' + (ch.tempo_aberto_formatado || '00:00');
            html += '  </div>';
            html += '</div>';
            html += '<div class="chamado-card-body">';
            html += '  <div class="chamado-campo"><i class="fas fa-user"></i> <strong>' + escapeHtml(ch.nome_solicitante) + '</strong></div>';
            html += '  <div class="chamado-campo"><i class="fas fa-map-marker-alt"></i> ' + escapeHtml(ch.local_problema) + '</div>';
            if (ch.hostname) html += '  <div class="chamado-campo"><i class="fas fa-desktop"></i> <code style="background:#f0f8ff;padding:1px 5px;border-radius:3px;font-size:0.72rem;color:#17a2b8;">' + escapeHtml(ch.hostname) + '</code></div>';
            if (ch.ip) html += '  <div class="chamado-campo"><i class="fas fa-network-wired"></i> <code style="background:#f5f0ff;padding:1px 5px;border-radius:3px;font-size:0.72rem;color:#6f42c1;">' + escapeHtml(ch.ip) + '</code></div>';
            if (ch.problema_descricao) html += '  <div class="chamado-campo"><i class="fas fa-tools"></i> ' + escapeHtml(ch.problema_descricao) + '</div>';
            html += '  <div class="chamado-campo"><i class="fas fa-calendar"></i> ' + dataAbertura + '</div>';
            if (ch.tecnico_atendimento) html += '  <div class="chamado-campo"><i class="fas fa-wrench"></i> Tec: <strong>' + escapeHtml(ch.tecnico_atendimento) + '</strong></div>';
            if (ch.observacao_abertura) html += '  <div class="chamado-obs-abertura"><i class="fas fa-comment"></i> ' + escapeHtml(ch.observacao_abertura) + '</div>';
            html += '</div>';

            html += '<div class="chamado-card-acoes">';
            if (ch.status === 'aberto') html += '<button class="btn-acao btn-acao-atender" onclick="window.P14.abrirModalAtender(' + ch.id + ')"><i class="fas fa-play"></i> Atender</button>';
            if (ch.status === 'aberto' || ch.status === 'em_atendimento') {
                html += '<button class="btn-acao btn-acao-fechar" onclick="window.P14.abrirModalFechar(' + ch.id + ')"><i class="fas fa-check"></i> Fechar</button>';
                html += '<button class="btn-acao btn-acao-obs" onclick="window.P14.abrirModalObs(' + ch.id + ')"><i class="fas fa-comment-dots"></i> Obs</button>';
                html += '<button class="btn-acao btn-acao-inativar" onclick="window.P14.abrirModalInativar(' + ch.id + ')"><i class="fas fa-ban"></i> Inativar</button>';
            }
            html += '<button class="btn-acao btn-acao-hist" onclick="window.P14.abrirHistoricoChamado(' + ch.id + ')"><i class="fas fa-list"></i> Hist</button>';
            html += '</div></div>';
            return html;
        }).join('');
    }

    // ========================================
    // RENDERIZAR HISTORICO
    // ========================================

    function renderizarHistorico(chamados) {
        var lista = document.getElementById('lista-historico');
        var vazio = document.getElementById('vazio-historico');
        if (!lista) return;

        if (!chamados || chamados.length === 0) {
            lista.innerHTML = '';
            if (vazio) vazio.style.display = 'block';
            return;
        }

        if (vazio) vazio.style.display = 'none';

        lista.innerHTML = chamados.map(function (ch) {
            var dataAbertura = ch.data_abertura ? formatarDataHora(ch.data_abertura) : '--';
            var dataFechamento = ch.data_fechamento ? formatarDataHora(ch.data_fechamento) : '--';
            var minutos = parseFloat(ch.minutos_total) || 0;
            var tempoTotal = formatarMinutos(minutos);

            var html = '<div class="chamado-card historico-card status-' + ch.status + '">';
            html += '<div class="chamado-card-header">';
            html += '  <div class="chamado-card-titulo">';
            html += '    <span class="chamado-kora"><i class="fas fa-ticket-alt"></i> #' + escapeHtml(ch.numero_kora) + '</span>';
            html += '    <span class="chamado-status-badge badge-' + ch.status + '">' + formatarStatus(ch.status) + '</span>';
            html += '    <span class="chamado-prioridade-badge prioridade-' + (ch.prioridade || 'normal') + '">' + (ch.prioridade || 'normal') + '</span>';
            html += '  </div>';
            html += '  <div class="chamado-tempo"><i class="fas fa-hourglass-end"></i> ' + tempoTotal + '</div>';
            html += '</div>';
            html += '<div class="chamado-card-body">';
            html += '  <div class="chamado-campo"><i class="fas fa-user"></i> <strong>' + escapeHtml(ch.nome_solicitante) + '</strong></div>';
            html += '  <div class="chamado-campo"><i class="fas fa-map-marker-alt"></i> ' + escapeHtml(ch.local_problema) + '</div>';
            if (ch.hostname) html += '  <div class="chamado-campo"><i class="fas fa-desktop"></i> <code style="background:#f0f8ff;padding:1px 5px;border-radius:3px;font-size:0.72rem;color:#17a2b8;">' + escapeHtml(ch.hostname) + '</code></div>';
            if (ch.ip) html += '  <div class="chamado-campo"><i class="fas fa-network-wired"></i> <code style="background:#f5f0ff;padding:1px 5px;border-radius:3px;font-size:0.72rem;color:#6f42c1;">' + escapeHtml(ch.ip) + '</code></div>';
            if (ch.problema_descricao) html += '  <div class="chamado-campo"><i class="fas fa-tools"></i> ' + escapeHtml(ch.problema_descricao) + '</div>';
            html += '  <div class="chamado-campo"><i class="fas fa-calendar"></i> Aberto: ' + dataAbertura + '</div>';
            html += '  <div class="chamado-campo"><i class="fas fa-calendar-check"></i> Fechado: ' + dataFechamento + '</div>';
            if (ch.tecnico_atendimento) html += '  <div class="chamado-campo"><i class="fas fa-wrench"></i> Tec: <strong>' + escapeHtml(ch.tecnico_atendimento) + '</strong></div>';
            if (ch.observacao_fechamento) html += '  <div class="historico-obs-fechamento"><i class="fas fa-clipboard-check"></i> ' + escapeHtml(ch.observacao_fechamento) + '</div>';
            html += '</div>';
            html += '<div class="chamado-card-acoes">';
            html += '  <button class="btn-acao btn-acao-hist" onclick="window.P14.abrirHistoricoChamado(' + ch.id + ')"><i class="fas fa-list"></i> Ver Historico</button>';
            html += '</div></div>';
            return html;
        }).join('');
    }

    // ========================================
    // MODAIS DE ACOES
    // ========================================

    function abrirModalAtender(chamadoId) {
        estado.chamadoSelecionado = chamadoId;
        var info = getChamadoInfo(chamadoId);
        var infoEl = document.getElementById('modal-atender-info');
        if (infoEl && info) infoEl.innerHTML = '<strong>Chamado #' + escapeHtml(info.numero_kora) + '</strong><br>Solicitante: ' + escapeHtml(info.nome_solicitante) + '<br>Local: ' + escapeHtml(info.local_problema);
        document.getElementById('input-tecnico-atender').value = '';
        abrirModal('modal-atender');
    }

    function abrirModalFechar(chamadoId) {
        estado.chamadoSelecionado = chamadoId;
        var info = getChamadoInfo(chamadoId);
        var infoEl = document.getElementById('modal-fechar-info');
        if (infoEl && info) infoEl.innerHTML = '<strong>Chamado #' + escapeHtml(info.numero_kora) + '</strong><br>Solicitante: ' + escapeHtml(info.nome_solicitante) + '<br>Local: ' + escapeHtml(info.local_problema);
        document.getElementById('input-tecnico-fechar').value = '';
        document.getElementById('input-obs-fechar').value = '';
        document.getElementById('count-obs-fechar').textContent = '0';
        abrirModal('modal-fechar');
    }

    function abrirModalInativar(chamadoId) {
        estado.chamadoSelecionado = chamadoId;
        var info = getChamadoInfo(chamadoId);
        var infoEl = document.getElementById('modal-inativar-info');
        if (infoEl && info) infoEl.innerHTML = '<strong>Chamado #' + escapeHtml(info.numero_kora) + '</strong><br>Solicitante: ' + escapeHtml(info.nome_solicitante) + '<br>Local: ' + escapeHtml(info.local_problema);
        document.getElementById('input-motivo-inativar').value = '';
        abrirModal('modal-inativar');
    }

    function abrirModalObs(chamadoId) {
        estado.chamadoSelecionado = chamadoId;
        var info = getChamadoInfo(chamadoId);
        var infoEl = document.getElementById('modal-obs-info');
        if (infoEl && info) infoEl.innerHTML = '<strong>Chamado #' + escapeHtml(info.numero_kora) + '</strong><br>Solicitante: ' + escapeHtml(info.nome_solicitante);
        document.getElementById('input-observacao').value = '';
        document.getElementById('count-obs').textContent = '0';
        abrirModal('modal-observacao');
    }

    function configurarModais() {
        var btnAtender = document.getElementById('btn-confirmar-atender');
        if (btnAtender) {
            btnAtender.addEventListener('click', function () {
                var tecnico = document.getElementById('input-tecnico-atender').value.trim();
                if (!tecnico) { mostrarToast('Informe o nome do tecnico', 'erro'); return; }
                executarAcao(estado.chamadoSelecionado, 'atender', { tecnico: tecnico });
            });
        }

        var btnFechar = document.getElementById('btn-confirmar-fechar');
        if (btnFechar) {
            btnFechar.addEventListener('click', function () {
                var tecnico = document.getElementById('input-tecnico-fechar').value.trim();
                var obs = document.getElementById('input-obs-fechar').value.trim();
                if (!tecnico) { mostrarToast('Informe o nome do tecnico', 'erro'); return; }
                if (!obs || obs.length < 10) { mostrarToast('Observacao deve ter pelo menos 10 caracteres', 'erro'); return; }
                executarAcao(estado.chamadoSelecionado, 'fechar', { tecnico: tecnico, observacao: obs });
            });
        }

        var btnInativar = document.getElementById('btn-confirmar-inativar');
        if (btnInativar) {
            btnInativar.addEventListener('click', function () {
                var motivo = document.getElementById('input-motivo-inativar').value.trim();
                if (!motivo) { mostrarToast('Informe o motivo da inativacao', 'erro'); return; }
                executarAcao(estado.chamadoSelecionado, 'inativar', { motivo: motivo });
            });
        }

        var btnObs = document.getElementById('btn-confirmar-obs');
        if (btnObs) {
            btnObs.addEventListener('click', function () {
                var obs = document.getElementById('input-observacao').value.trim();
                if (!obs) { mostrarToast('Informe a observacao', 'erro'); return; }
                executarAcao(estado.chamadoSelecionado, 'observacao', { observacao: obs });
            });
        }

        // Fechar modais clicando fora
        var modais = document.querySelectorAll('.modal-overlay');
        modais.forEach(function (modal) {
            modal.addEventListener('click', function (e) { if (e.target === modal) modal.classList.remove('ativo'); });
        });

        document.addEventListener('keydown', function (e) {
            if (e.key === 'Escape') {
                var modaisAtivos = document.querySelectorAll('.modal-overlay.ativo');
                modaisAtivos.forEach(function (m) { m.classList.remove('ativo'); });
            }
        });
    }

    // ========================================
    // HISTORICO DE CHAMADO
    // ========================================

    function abrirHistoricoChamado(chamadoId) {
        var info = getChamadoInfo(chamadoId);
        var infoEl = document.getElementById('modal-hist-info');
        if (infoEl) {
            infoEl.innerHTML = info
                ? '<strong>Chamado #' + escapeHtml(info.numero_kora) + '</strong> | ' + escapeHtml(info.nome_solicitante) + ' | ' + escapeHtml(info.local_problema)
                : '<strong>Chamado #' + chamadoId + '</strong>';
        }

        var timeline = document.getElementById('timeline-historico');
        if (timeline) timeline.innerHTML = '<div class="loading"><div class="loading-spinner"></div><p>Carregando...</p></div>';

        abrirModal('modal-historico-chamado');

        fetch(BASE_URL + '/api/paineis/painel14/chamados/' + chamadoId + '/historico')
            .then(function (res) { return res.json(); })
            .then(function (data) {
                if (data.success && timeline) {
                    if (data.data.length === 0) { timeline.innerHTML = '<p style="text-align:center;color:#999;">Nenhum registro</p>'; return; }
                    timeline.innerHTML = data.data.map(function (item) {
                        var dataReg = item.data_registro ? formatarDataHora(item.data_registro) : '--';
                        return '<div class="timeline-item acao-' + (item.acao || '') + '">'
                            + '<div class="timeline-acao">' + formatarAcao(item.acao) + '</div>'
                            + '<div class="timeline-descricao">' + escapeHtml(item.descricao || '') + '</div>'
                            + '<div class="timeline-meta">' + escapeHtml(item.usuario || '') + ' - ' + dataReg + '</div>'
                            + '</div>';
                    }).join('');
                }
            })
            .catch(function () { if (timeline) timeline.innerHTML = '<p style="text-align:center;color:#dc3545;">Erro ao carregar</p>'; });
    }

    // ========================================
    // EXECUTAR ACOES (API)
    // ========================================

    function executarAcao(chamadoId, acao, dados) {
        fetch(BASE_URL + '/api/paineis/painel14/chamados/' + chamadoId + '/' + acao, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(dados)
        })
        .then(function (res) { return res.json(); })
        .then(function (data) {
            if (data.success) {
                registrarAcaoTecnico();
                mostrarToast(data.message || 'Acao realizada', 'sucesso');
                document.querySelectorAll('.modal-overlay.ativo').forEach(function (m) { m.classList.remove('ativo'); });
                carregarDados();
            } else {
                mostrarToast(data.error || 'Erro ao executar acao', 'erro');
            }
        })
        .catch(function () { mostrarToast('Erro de comunicacao com o servidor', 'erro'); });
    }

    function salvarConfiguracao(chave, valor) {
        fetch(CONFIG.apiConfig, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chave: chave, valor: valor })
        }).catch(function (err) { console.warn('Erro ao salvar config:', err); });
    }

    // ========================================
    // FUNCOES AUXILIARES
    // ========================================

    function getChamadoInfo(chamadoId) {
        var cards = document.querySelectorAll('.chamado-card[data-id="' + chamadoId + '"]');
        if (cards.length > 0) {
            var card = cards[0];
            var kora = card.querySelector('.chamado-kora');
            var campos = card.querySelectorAll('.chamado-campo strong');
            return {
                numero_kora: kora ? kora.textContent.replace(/[^0-9]/g, '') : chamadoId,
                nome_solicitante: campos[0] ? campos[0].textContent : 'N/I',
                local_problema: card.querySelector('.chamado-campo:nth-child(2)') ? card.querySelector('.chamado-campo:nth-child(2)').textContent.trim() : 'N/I'
            };
        }
        return null;
    }

    function abrirModal(modalId) { var m = document.getElementById(modalId); if (m) m.classList.add('ativo'); }
    function fecharModalFn(modalId) { var m = document.getElementById(modalId); if (m) m.classList.remove('ativo'); }
    function setTexto(id, texto) { var el = document.getElementById(id); if (el) el.textContent = texto; }

    function formatarStatus(status) {
        var mapa = { 'aberto': 'Aberto', 'em_atendimento': 'Em Atendimento', 'fechado': 'Fechado', 'inativo': 'Inativo' };
        return mapa[status] || status;
    }

    function formatarAcao(acao) {
        var mapa = { 'abertura': 'Abertura', 'visualizacao': 'Visualizacao', 'inicio_atendimento': 'Inicio Atendimento', 'fechamento': 'Fechamento', 'inativacao': 'Inativacao', 'observacao': 'Observacao', 'alteracao_status': 'Alteracao de Status' };
        return mapa[acao] || acao;
    }

    function formatarDataHora(isoString) {
        try {
            var d = new Date(isoString);
            return String(d.getDate()).padStart(2, '0') + '/' + String(d.getMonth() + 1).padStart(2, '0')
                + ' ' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
        } catch (e) { return '--'; }
    }

    function formatarMinutos(minutos) {
        var h = Math.floor(minutos / 60);
        var m = Math.floor(minutos % 60);
        return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0');
    }

    function escapeHtml(text) {
        if (!text) return '';
        var div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    function atualizarHora() {
        var agora = new Date();
        setTexto('ultima-atualizacao', agora.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }));
    }

    function mostrarToast(mensagem, tipo) {
        var container = document.getElementById('toast-container');
        if (!container) return;
        var toast = document.createElement('div');
        toast.className = 'toast toast-' + (tipo || 'info');
        var icone = '';
        switch (tipo) {
            case 'sucesso': icone = '<i class="fas fa-check-circle"></i>'; break;
            case 'erro': icone = '<i class="fas fa-times-circle"></i>'; break;
            case 'alerta': icone = '<i class="fas fa-exclamation-triangle"></i>'; break;
            default: icone = '<i class="fas fa-info-circle"></i>';
        }
        toast.innerHTML = icone + ' ' + escapeHtml(mensagem);
        container.appendChild(toast);
        setTimeout(function () { if (toast.parentNode) toast.parentNode.removeChild(toast); }, 4000);
    }

    // ========================================
    // GERENCIAMENTO DE LOCAIS E PROBLEMAS
    // ========================================

    function abrirGerenciamento() {
        abrirModal('modal-gerenciar');
        configurarGerenciamentoTabs();
        carregarGerenciarLocais();
        configurarBotoesGerenciar();
    }

    function configurarGerenciamentoTabs() {
        var tabs = document.querySelectorAll('.gerenciar-tab');
        tabs.forEach(function (tab) {
            tab.onclick = function () {
                tabs.forEach(function (t) { t.classList.remove('gerenciar-tab-ativa'); });
                this.classList.add('gerenciar-tab-ativa');
                var gtab = this.getAttribute('data-gtab');
                document.getElementById('gpainel-locais').style.display = gtab === 'locais' ? 'block' : 'none';
                document.getElementById('gpainel-problemas').style.display = gtab === 'problemas' ? 'block' : 'none';
                if (gtab === 'locais') carregarGerenciarLocais();
                else carregarGerenciarProblemas();
            };
        });
    }

    function configurarBotoesGerenciar() {
        // Aplicar mascara IP no campo
        var inputIP = document.getElementById('g-local-ip');
        if (inputIP) aplicarMascaraIP(inputIP);

        var btnAddLocal = document.getElementById('btn-add-local');
        if (btnAddLocal) btnAddLocal.onclick = function () {
            var setor = document.getElementById('g-local-setor').value.trim();
            var local = document.getElementById('g-local-local').value.trim();
            var hostname = document.getElementById('g-local-hostname').value.trim();
            var ip = document.getElementById('g-local-ip').value.trim();
            if (!setor || !local) { mostrarToast('Setor e Local sao obrigatorios', 'erro'); return; }
            if (ip && !validarIP(ip)) { mostrarToast('IP invalido (Ex: 192.168.1.100)', 'erro'); return; }
            fetch(BASE_URL + '/api/paineis/painel14/locais', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ setor: setor, local: local, hostname: hostname || null, ip: ip || null })
            }).then(function (r) { return r.json(); }).then(function (d) {
                if (d.success) {
                    mostrarToast('Local cadastrado', 'sucesso');
                    document.getElementById('g-local-setor').value = '';
                    document.getElementById('g-local-local').value = '';
                    document.getElementById('g-local-hostname').value = '';
                    document.getElementById('g-local-ip').value = '';
                    carregarGerenciarLocais();
                } else { mostrarToast(d.error || 'Erro', 'erro'); }
            }).catch(function () { mostrarToast('Erro de comunicacao', 'erro'); });
        };

        var btnAddProblema = document.getElementById('btn-add-problema');
        if (btnAddProblema) btnAddProblema.onclick = function () {
            var desc = document.getElementById('g-problema-descricao').value.trim();
            if (!desc) { mostrarToast('Descricao e obrigatoria', 'erro'); return; }
            fetch(BASE_URL + '/api/paineis/painel14/problemas', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ descricao: desc })
            }).then(function (r) { return r.json(); }).then(function (d) {
                if (d.success) {
                    mostrarToast('Problema cadastrado', 'sucesso');
                    document.getElementById('g-problema-descricao').value = '';
                    carregarGerenciarProblemas();
                } else { mostrarToast(d.error || 'Erro', 'erro'); }
            }).catch(function () { mostrarToast('Erro de comunicacao', 'erro'); });
        };
    }

    // -- LOCAIS --

    function carregarGerenciarLocais() {
        var lista = document.getElementById('g-lista-locais');
        if (!lista) return;
        lista.innerHTML = '<div class="loading"><div class="loading-spinner"></div></div>';

        fetch(BASE_URL + '/api/paineis/painel14/locais')
            .then(function (r) { return r.json(); })
            .then(function (d) {
                if (d.success) renderizarGerenciarLocais(d.data || []);
                else lista.innerHTML = '<div class="g-item-vazio">Erro ao carregar</div>';
            })
            .catch(function () { lista.innerHTML = '<div class="g-item-vazio">Erro de conexao</div>'; });
    }

    function renderizarGerenciarLocais(locais) {
        var lista = document.getElementById('g-lista-locais');
        if (!lista) return;

        if (locais.length === 0) {
            lista.innerHTML = '<div class="g-item-vazio"><i class="fas fa-map-marker-alt"></i> Nenhum local cadastrado</div>';
            return;
        }

        lista.innerHTML = locais.map(function (loc) {
            var cls = loc.ativo ? 'g-item' : 'g-item g-inativo';
            var html = '<div class="' + cls + '" data-id="' + loc.id + '">';
            html += '<div class="g-item-info">';
            html += '  <div class="g-item-setor">' + escapeHtml(loc.setor) + '</div>';
            html += '  <div class="g-item-local">' + escapeHtml(loc.local) + '</div>';
            if (loc.hostname) html += '  <span class="g-item-hostname">' + escapeHtml(loc.hostname) + '</span>';
            if (loc.ip) html += '  <span class="g-item-ip">' + escapeHtml(loc.ip) + '</span>';
            html += '</div>';
            html += '<div class="g-item-acoes">';
            html += '  <button class="g-btn g-btn-editar" onclick="window.P14.editarLocal(' + loc.id + ',\'' + escapeAttr(loc.setor) + '\',\'' + escapeAttr(loc.local) + '\',\'' + escapeAttr(loc.hostname || '') + '\',\'' + escapeAttr(loc.ip || '') + '\')"><i class="fas fa-edit"></i></button>';
            html += '  <button class="g-btn g-btn-toggle ' + (loc.ativo ? 'ativo' : '') + '" onclick="window.P14.toggleLocal(' + loc.id + ')" title="' + (loc.ativo ? 'Desativar' : 'Reativar') + '"><i class="fas fa-' + (loc.ativo ? 'toggle-on' : 'toggle-off') + '"></i></button>';
            html += '</div></div>';
            return html;
        }).join('');
    }

    function editarLocal(id, setor, local, hostname, ip) {
        var item = document.querySelector('.g-item[data-id="' + id + '"]');
        if (!item) return;

        var infoDiv = item.querySelector('.g-item-info');
        var acoesDiv = item.querySelector('.g-item-acoes');
        if (!infoDiv || !acoesDiv) return;

        infoDiv.innerHTML =
            '<div class="g-edit-inline">' +
            '  <input type="text" value="' + escapeAttr(setor) + '" id="ge-setor-' + id + '" placeholder="Setor">' +
            '  <input type="text" value="' + escapeAttr(local) + '" id="ge-local-' + id + '" placeholder="Local">' +
            '  <input type="text" value="' + escapeAttr(hostname) + '" id="ge-host-' + id + '" placeholder="Hostname">' +
            '  <input type="text" value="' + escapeAttr(ip) + '" id="ge-ip-' + id + '" placeholder="IP" maxlength="15" class="input-ip">' +
            '</div>';

        // Aplicar mascara no campo IP de edicao
        var ipInput = document.getElementById('ge-ip-' + id);
        if (ipInput) aplicarMascaraIP(ipInput);

        acoesDiv.innerHTML =
            '<button class="g-btn g-btn-salvar" onclick="window.P14.salvarLocal(' + id + ')"><i class="fas fa-check"></i></button>' +
            '<button class="g-btn g-btn-cancelar-edit" onclick="window.P14.carregarGLocais()"><i class="fas fa-times"></i></button>';
    }

    function salvarLocal(id) {
        var setor = (document.getElementById('ge-setor-' + id).value || '').trim();
        var local = (document.getElementById('ge-local-' + id).value || '').trim();
        var hostname = (document.getElementById('ge-host-' + id).value || '').trim();
        var ip = (document.getElementById('ge-ip-' + id).value || '').trim();
        if (!setor || !local) { mostrarToast('Setor e Local obrigatorios', 'erro'); return; }
        if (ip && !validarIP(ip)) { mostrarToast('IP invalido (Ex: 192.168.1.100)', 'erro'); return; }

        fetch(BASE_URL + '/api/paineis/painel14/locais/' + id, {
            method: 'PUT', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ setor: setor, local: local, hostname: hostname || null, ip: ip || null })
        }).then(function (r) { return r.json(); }).then(function (d) {
            if (d.success) { mostrarToast('Local atualizado', 'sucesso'); carregarGerenciarLocais(); }
            else mostrarToast(d.error || 'Erro', 'erro');
        }).catch(function () { mostrarToast('Erro de comunicacao', 'erro'); });
    }

    function toggleLocal(id) {
        fetch(BASE_URL + '/api/paineis/painel14/locais/' + id, { method: 'DELETE' })
            .then(function (r) { return r.json(); })
            .then(function (d) {
                if (d.success) { mostrarToast(d.message, 'sucesso'); carregarGerenciarLocais(); }
                else mostrarToast(d.error || 'Erro', 'erro');
            }).catch(function () { mostrarToast('Erro de comunicacao', 'erro'); });
    }

    // -- PROBLEMAS --

    function carregarGerenciarProblemas() {
        var lista = document.getElementById('g-lista-problemas');
        if (!lista) return;
        lista.innerHTML = '<div class="loading"><div class="loading-spinner"></div></div>';

        fetch(BASE_URL + '/api/paineis/painel14/problemas')
            .then(function (r) { return r.json(); })
            .then(function (d) {
                if (d.success) renderizarGerenciarProblemas(d.data || []);
                else lista.innerHTML = '<div class="g-item-vazio">Erro ao carregar</div>';
            })
            .catch(function () { lista.innerHTML = '<div class="g-item-vazio">Erro de conexao</div>'; });
    }

    function renderizarGerenciarProblemas(problemas) {
        var lista = document.getElementById('g-lista-problemas');
        if (!lista) return;

        if (problemas.length === 0) {
            lista.innerHTML = '<div class="g-item-vazio"><i class="fas fa-tools"></i> Nenhum problema cadastrado</div>';
            return;
        }

        lista.innerHTML = problemas.map(function (p) {
            var cls = p.ativo ? 'g-item' : 'g-item g-inativo';
            var html = '<div class="' + cls + '" data-pid="' + p.id + '">';
            html += '<span class="g-item-desc">' + escapeHtml(p.descricao) + '</span>';
            html += '<div class="g-item-acoes">';
            html += '  <button class="g-btn g-btn-editar" onclick="window.P14.editarProblema(' + p.id + ',\'' + escapeAttr(p.descricao) + '\')"><i class="fas fa-edit"></i></button>';
            html += '  <button class="g-btn g-btn-toggle ' + (p.ativo ? 'ativo' : '') + '" onclick="window.P14.toggleProblema(' + p.id + ')" title="' + (p.ativo ? 'Desativar' : 'Reativar') + '"><i class="fas fa-' + (p.ativo ? 'toggle-on' : 'toggle-off') + '"></i></button>';
            html += '</div></div>';
            return html;
        }).join('');
    }

    function editarProblema(id, descricao) {
        var item = document.querySelector('.g-item[data-pid="' + id + '"]');
        if (!item) return;

        var desc = item.querySelector('.g-item-desc');
        var acoes = item.querySelector('.g-item-acoes');
        if (!desc || !acoes) return;

        desc.outerHTML = '<div class="g-edit-inline" style="flex:1;"><input type="text" value="' + escapeAttr(descricao) + '" id="gp-desc-' + id + '" placeholder="Descricao"></div>';
        acoes.innerHTML =
            '<button class="g-btn g-btn-salvar" onclick="window.P14.salvarProblema(' + id + ')"><i class="fas fa-check"></i></button>' +
            '<button class="g-btn g-btn-cancelar-edit" onclick="window.P14.carregarGProblemas()"><i class="fas fa-times"></i></button>';
    }

    function salvarProblema(id) {
        var desc = (document.getElementById('gp-desc-' + id).value || '').trim();
        if (!desc) { mostrarToast('Descricao obrigatoria', 'erro'); return; }

        fetch(BASE_URL + '/api/paineis/painel14/problemas/' + id, {
            method: 'PUT', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ descricao: desc })
        }).then(function (r) { return r.json(); }).then(function (d) {
            if (d.success) { mostrarToast('Problema atualizado', 'sucesso'); carregarGerenciarProblemas(); }
            else mostrarToast(d.error || 'Erro', 'erro');
        }).catch(function () { mostrarToast('Erro de comunicacao', 'erro'); });
    }

    function toggleProblema(id) {
        fetch(BASE_URL + '/api/paineis/painel14/problemas/' + id, { method: 'DELETE' })
            .then(function (r) { return r.json(); })
            .then(function (d) {
                if (d.success) { mostrarToast(d.message, 'sucesso'); carregarGerenciarProblemas(); }
                else mostrarToast(d.error || 'Erro', 'erro');
            }).catch(function () { mostrarToast('Erro de comunicacao', 'erro'); });
    }

    // Mascara e validacao de IP
    function aplicarMascaraIP(input) {
        input.addEventListener('input', function () {
            var val = this.value.replace(/[^0-9.]/g, '');
            // Impedir pontos consecutivos
            val = val.replace(/\.{2,}/g, '.');
            // Limitar a 3 pontos (4 octetos)
            var partes = val.split('.');
            if (partes.length > 4) partes = partes.slice(0, 4);
            // Limitar cada octeto a 3 digitos
            partes = partes.map(function (p) { return p.substring(0, 3); });
            this.value = partes.join('.');
        });

        input.addEventListener('blur', function () {
            if (this.value && !validarIP(this.value)) {
                this.style.borderColor = '#dc3545';
                this.title = 'IP invalido (Ex: 192.168.1.100)';
            } else {
                this.style.borderColor = '';
                this.title = '';
            }
        });
    }

    function validarIP(ip) {
        if (!ip) return true; // Opcional
        var partes = ip.split('.');
        if (partes.length !== 4) return false;
        for (var i = 0; i < 4; i++) {
            var num = parseInt(partes[i], 10);
            if (isNaN(num) || num < 0 || num > 255 || partes[i] !== String(num)) return false;
        }
        return true;
    }

    // Escape para atributos HTML
    function escapeAttr(text) {
        if (!text) return '';
        return text.replace(/&/g, '&amp;').replace(/'/g, '&#39;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    // ========================================
    // EXPOR FUNCOES GLOBAIS
    // ========================================

    window.P14 = {
        abrirModalAtender: abrirModalAtender,
        abrirModalFechar: abrirModalFechar,
        abrirModalInativar: abrirModalInativar,
        abrirModalObs: abrirModalObs,
        abrirHistoricoChamado: abrirHistoricoChamado,
        editarLocal: editarLocal,
        salvarLocal: salvarLocal,
        toggleLocal: toggleLocal,
        carregarGLocais: carregarGerenciarLocais,
        editarProblema: editarProblema,
        salvarProblema: salvarProblema,
        toggleProblema: toggleProblema,
        carregarGProblemas: carregarGerenciarProblemas
    };

    window.fecharModal = fecharModalFn;

    // ========================================
    // START
    // ========================================

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', inicializar);
    } else {
        inicializar();
    }

})();