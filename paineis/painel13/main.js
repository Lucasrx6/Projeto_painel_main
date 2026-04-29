/**
 * PAINEL 13 - Prescricoes de Nutricao
 * Sistema de Paineis Hospitalares - Hospital Anchieta
 *
 * Funcionalidades:
 * - Listagem de pacientes com prescricoes de nutricao
 * - Filtro multi-setor com dropdown de checkboxes
 * - Filtros de status (sem prescricao / desatualizadas)
 * - Auto-scroll com dois modos: rolagem continua e paginado horizontal
 * - Destaque para pacientes sem prescricao
 * - Alerta para prescricoes desatualizadas (dia anterior)
 * - Watchdog robusto para deteccao de travamento
 * - Blocos visuais alternados para separacao clara entre pacientes
 */

(function() {
    'use strict';

    // =========================================================
    // CONFIGURACAO
    // =========================================================

    var CONFIG = {
        // URLs da API
        api: {
            nutricao: '/api/paineis/painel13/nutricao',
            setores: '/api/paineis/painel13/setores',
            stats: '/api/paineis/painel13/stats'
        },

        // Intervalos (ms)
        intervaloRefresh: 380000,
        velocidadeScroll: 1.6,
        intervaloScroll: 50,
        pausaNoFinal: 8000,
        pausaAposReset: 6000,
        delayAutoScrollInicial: 8000,
        watchdogInterval: 5000,
        watchdogMaxTravamentos: 3,

        // Modo paginado
        paginadoTempo: 12000,
        paginadoTransicao: 600,

        // Limites
        maxTentativasConexao: 3,
        timeoutRequisicao: 30000,

        // Storage keys
        storageKeySetores: 'painel13_setores',
        storageKeyModoScroll: 'painel13_modoScroll',
        storageKeyFiltroSemPresc: 'painel13_filtroSemPresc',
        storageKeyFiltroDesatual: 'painel13_filtroDesatual'
    };

    // =========================================================
    // ESTADO DA APLICACAO
    // =========================================================

    var Estado = {
        dadosNutricao: [],
        dadosFiltrados: [],
        setores: [],
        setoresSelecionados: [],

        filtroSemPrescricao: false,
        filtroDesatualizadas: false,

        carregando: false,
        ultimaAtualizacao: null,
        errosConsecutivos: 0,
        autoScrollAtivo: false,
        autoScrollIniciado: false,

        modoScroll: 'rolar',

        paginaAtual: 0,
        totalPaginas: 0,

        intervalos: {
            refresh: null,
            scroll: null,
            watchdog: null,
            paginado: null
        },
        timeouts: {
            autoScrollInicial: null
        },

        watchdog: {
            ultimaPosicao: 0,
            contadorTravamento: 0,
            ultimoTimestamp: 0
        },

        dropdownAberto: false
    };

    // =========================================================
    // ELEMENTOS DOM (Cache)
    // =========================================================

    var DOM = {};

    function cachearElementos() {
        DOM.painelMain = document.getElementById('painel-main');
        DOM.loadingContainer = document.getElementById('loading-container');
        DOM.statusIndicator = document.getElementById('status-indicator');
        DOM.ultimaAtualizacao = document.getElementById('ultima-atualizacao');

        DOM.multiSelectContainer = document.getElementById('multi-select-setor');
        DOM.btnMultiSetor = document.getElementById('btn-multi-setor');
        DOM.dropdownSetor = document.getElementById('dropdown-setor');
        DOM.optionsSetor = document.getElementById('options-setor');
        DOM.labelSetor = document.getElementById('label-setor');
        DOM.btnSelectAll = document.getElementById('btn-select-all');
        DOM.btnSelectNone = document.getElementById('btn-select-none');

        DOM.btnFiltroSemPrescricao = document.getElementById('btn-filtro-sem-prescricao');
        DOM.btnFiltroDesatualizadas = document.getElementById('btn-filtro-desatualizadas');

        DOM.nomeSetor = document.getElementById('nome-setor');
        DOM.totalPacientes = document.getElementById('total-pacientes');
        DOM.comPrescricao = document.getElementById('com-prescricao');
        DOM.semPrescricao = document.getElementById('sem-prescricao');
        DOM.desatualizadas = document.getElementById('desatualizadas');

        DOM.paginacaoIndicator = document.getElementById('paginacao-indicator');
        DOM.paginacaoTexto = document.getElementById('paginacao-texto');
        DOM.paginacaoDots = document.getElementById('paginacao-dots');

        DOM.btnVoltar = document.getElementById('btn-voltar');
        DOM.btnRefresh = document.getElementById('btn-refresh');
        DOM.btnAutoScroll = document.getElementById('btn-auto-scroll');
        DOM.btnModoScroll = document.getElementById('btn-modo-scroll');
    }

    // =========================================================
    // UTILITARIOS
    // =========================================================

    function formatarNumero(valor) {
        if (valor === null || valor === undefined || isNaN(valor)) {
            return '-';
        }
        return new Intl.NumberFormat('pt-BR').format(valor);
    }

    function formatarNome(nomeCompleto) {
        if (!nomeCompleto || nomeCompleto.trim() === '') return '-';
        var partes = nomeCompleto.trim().toUpperCase().split(/\s+/);
        if (partes.length === 1) return partes[0];
        var iniciais = partes.slice(0, -1).map(function(p) { return p.charAt(0); }).join(' ');
        var ultimoNome = partes[partes.length - 1];
        return iniciais + ' ' + ultimoNome;
    }

    function formatarDataPrescricao(dataISO) {
        if (!dataISO) return '-';
        try {
            var data = new Date(dataISO);
            return data.toLocaleString('pt-BR', {
                day: '2-digit',
                month: '2-digit',
                year: 'numeric',
                hour: '2-digit',
                minute: '2-digit'
            });
        } catch (e) {
            return dataISO;
        }
    }

    function verificarDesatualizada(dataISO) {
        if (!dataISO) return false;
        try {
            var dataPrescricao = new Date(dataISO);
            var hoje = new Date();
            dataPrescricao.setHours(0, 0, 0, 0);
            hoje.setHours(0, 0, 0, 0);
            var diferencaDias = Math.floor((hoje - dataPrescricao) / (1000 * 60 * 60 * 24));
            return diferencaDias >= 1;
        } catch (e) {
            return false;
        }
    }

    function escapeHtml(texto) {
        if (!texto) return '-';
        var div = document.createElement('div');
        div.textContent = texto;
        return div.innerHTML;
    }

    function fetchComRetry(url, tentativas) {
        tentativas = tentativas || CONFIG.maxTentativasConexao;
        var ultimoErro;

        function tentativa(i) {
            return new Promise(function(resolve, reject) {
                var controller = new AbortController();
                var timeoutId = setTimeout(function() { controller.abort(); }, CONFIG.timeoutRequisicao);

                fetch(url, { signal: controller.signal })
                    .then(function(response) {
                        clearTimeout(timeoutId);
                        if (!response.ok) throw new Error('HTTP ' + response.status);
                        return response.json();
                    })
                    .then(resolve)
                    .catch(function(erro) {
                        clearTimeout(timeoutId);
                        ultimoErro = erro;
                        console.warn('[Painel13] Tentativa ' + (i + 1) + '/' + tentativas + ' falhou para ' + url + ':', erro.message);
                        if (i < tentativas - 1) {
                            setTimeout(function() {
                                tentativa(i + 1).then(resolve).catch(reject);
                            }, 1000 * (i + 1));
                        } else {
                            reject(ultimoErro);
                        }
                    });
            });
        }

        return tentativa(0);
    }

    function atualizarStatus(status) {
        if (!DOM.statusIndicator) return;
        DOM.statusIndicator.className = 'status-indicator';
        switch (status) {
            case 'online':
                DOM.statusIndicator.classList.add('status-online');
                DOM.statusIndicator.title = 'Conectado';
                break;
            case 'offline':
                DOM.statusIndicator.classList.add('status-offline');
                DOM.statusIndicator.title = 'Sem conexao';
                break;
            case 'loading':
                DOM.statusIndicator.classList.add('status-loading');
                DOM.statusIndicator.title = 'Carregando...';
                break;
        }
    }

    function atualizarHorario() {
        if (!DOM.ultimaAtualizacao) return;
        var agora = new Date();
        DOM.ultimaAtualizacao.textContent = agora.toLocaleTimeString('pt-BR', {
            hour: '2-digit',
            minute: '2-digit'
        });
        Estado.ultimaAtualizacao = agora;
    }

    // =========================================================
    // PERSISTENCIA (localStorage)
    // =========================================================

    function salvarSetoresSelecionados(setores) {
        try {
            localStorage.setItem(CONFIG.storageKeySetores, JSON.stringify(setores));
        } catch (e) {
            console.warn('[Painel13] Erro ao salvar setores:', e);
        }
    }

    function recuperarSetoresSelecionados() {
        try {
            var raw = localStorage.getItem(CONFIG.storageKeySetores);
            if (raw) return JSON.parse(raw);
        } catch (e) {}
        return [];
    }

    function salvarModoScroll(modo) {
        try { localStorage.setItem(CONFIG.storageKeyModoScroll, modo); } catch (e) {}
    }

    function recuperarModoScroll() {
        try { return localStorage.getItem(CONFIG.storageKeyModoScroll) || 'rolar'; } catch (e) { return 'rolar'; }
    }

    function salvarFiltroStatus(key, valor) {
        try { localStorage.setItem(key, valor ? '1' : '0'); } catch (e) {}
    }

    function recuperarFiltroStatus(key) {
        try { return localStorage.getItem(key) === '1'; } catch (e) { return false; }
    }

    // =========================================================
    // MULTI-SELECT DE SETORES
    // =========================================================

    function popularMultiSelect() {
        if (!DOM.optionsSetor) return;
        DOM.optionsSetor.innerHTML = '';

        Estado.setores.forEach(function(setor) {
            var selecionado = Estado.setoresSelecionados.indexOf(setor.setor) !== -1;
            var item = document.createElement('label');
            item.className = 'multi-select-item' + (selecionado ? ' selecionado' : '');

            var checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.value = setor.setor;
            checkbox.checked = selecionado;
            checkbox.className = 'multi-select-checkbox';

            var texto = document.createElement('span');
            texto.className = 'multi-select-item-text';
            texto.textContent = setor.setor;

            item.appendChild(checkbox);
            item.appendChild(texto);
            DOM.optionsSetor.appendChild(item);

            checkbox.addEventListener('change', function() {
                onCheckboxSetorChange(this);
            });
        });
    }

    function onCheckboxSetorChange(checkbox) {
        var valor = checkbox.value;
        var idx = Estado.setoresSelecionados.indexOf(valor);

        if (checkbox.checked && idx === -1) {
            Estado.setoresSelecionados.push(valor);
        } else if (!checkbox.checked && idx !== -1) {
            Estado.setoresSelecionados.splice(idx, 1);
        }

        var label = checkbox.closest('.multi-select-item');
        if (label) {
            if (checkbox.checked) {
                label.classList.add('selecionado');
            } else {
                label.classList.remove('selecionado');
            }
        }

        atualizarLabelMultiSelect();
        salvarSetoresSelecionados(Estado.setoresSelecionados);
        onFiltroAlterado();
    }

    function atualizarLabelMultiSelect() {
        if (!DOM.labelSetor) return;
        var qtd = Estado.setoresSelecionados.length;

        if (qtd === 0) {
            DOM.labelSetor.textContent = 'Todos os Setores';
        } else if (qtd === 1) {
            DOM.labelSetor.textContent = Estado.setoresSelecionados[0];
        } else if (qtd <= 3) {
            DOM.labelSetor.textContent = Estado.setoresSelecionados.join(', ');
        } else {
            DOM.labelSetor.textContent = qtd + ' setores';
        }
    }

    function toggleDropdown() {
        Estado.dropdownAberto = !Estado.dropdownAberto;

        if (Estado.dropdownAberto) {
            DOM.dropdownSetor.classList.add('aberto');
            DOM.btnMultiSetor.setAttribute('aria-expanded', 'true');
            DOM.btnMultiSetor.classList.add('aberto');
        } else {
            DOM.dropdownSetor.classList.remove('aberto');
            DOM.btnMultiSetor.setAttribute('aria-expanded', 'false');
            DOM.btnMultiSetor.classList.remove('aberto');
        }
    }

    function fecharDropdown() {
        if (!Estado.dropdownAberto) return;
        Estado.dropdownAberto = false;
        DOM.dropdownSetor.classList.remove('aberto');
        DOM.btnMultiSetor.setAttribute('aria-expanded', 'false');
        DOM.btnMultiSetor.classList.remove('aberto');
    }

    function selecionarTodosSetores() {
        Estado.setoresSelecionados = Estado.setores.map(function(s) { return s.setor; });
        popularMultiSelect();
        atualizarLabelMultiSelect();
        salvarSetoresSelecionados(Estado.setoresSelecionados);
        onFiltroAlterado();
    }

    function limparSelecaoSetores() {
        Estado.setoresSelecionados = [];
        popularMultiSelect();
        atualizarLabelMultiSelect();
        salvarSetoresSelecionados(Estado.setoresSelecionados);
        onFiltroAlterado();
    }

    // =========================================================
    // FILTROS DE STATUS
    // =========================================================

    function toggleFiltroSemPrescricao() {
        Estado.filtroSemPrescricao = !Estado.filtroSemPrescricao;
        atualizarBotaoFiltroStatus(DOM.btnFiltroSemPrescricao, Estado.filtroSemPrescricao);
        salvarFiltroStatus(CONFIG.storageKeyFiltroSemPresc, Estado.filtroSemPrescricao);
        aplicarFiltrosEAtualizar();
    }

    function toggleFiltroDesatualizadas() {
        Estado.filtroDesatualizadas = !Estado.filtroDesatualizadas;
        atualizarBotaoFiltroStatus(DOM.btnFiltroDesatualizadas, Estado.filtroDesatualizadas);
        salvarFiltroStatus(CONFIG.storageKeyFiltroDesatual, Estado.filtroDesatualizadas);
        aplicarFiltrosEAtualizar();
    }

    function atualizarBotaoFiltroStatus(btn, ativo) {
        if (!btn) return;
        if (ativo) {
            btn.classList.add('ativo');
            btn.setAttribute('aria-pressed', 'true');
        } else {
            btn.classList.remove('ativo');
            btn.setAttribute('aria-pressed', 'false');
        }
    }

    function aplicarFiltrosStatus(dados) {
        if (!Estado.filtroSemPrescricao && !Estado.filtroDesatualizadas) {
            return dados;
        }

        return dados.filter(function(reg) {
            var semPresc = !reg.dieta_limpa || reg.dieta_limpa.trim() === '';
            var desatual = reg.dieta_limpa && verificarDesatualizada(reg.dt_prescricao);

            if (Estado.filtroSemPrescricao && Estado.filtroDesatualizadas) {
                return semPresc || desatual;
            }
            if (Estado.filtroSemPrescricao) return semPresc;
            if (Estado.filtroDesatualizadas) return desatual;
            return true;
        });
    }

    function aplicarFiltrosEAtualizar() {
        Estado.dadosFiltrados = aplicarFiltrosStatus(Estado.dadosNutricao);
        renderizarTabela();

        if (Estado.autoScrollAtivo) {
            pararAutoScroll();
            setTimeout(function() {
                if (Estado.autoScrollAtivo) {
                    iniciarAutoScrollModo();
                }
            }, 500);
        }
    }

    // =========================================================
    // CALLBACK CENTRAL DE FILTRO ALTERADO
    // =========================================================

    function onFiltroAlterado() {
        if (Estado.timeouts.autoScrollInicial) {
            clearTimeout(Estado.timeouts.autoScrollInicial);
            Estado.timeouts.autoScrollInicial = null;
        }

        carregarDados();
    }

    // =========================================================
    // CARREGAMENTO DE DADOS
    // =========================================================

    function carregarSetores() {
        console.log('[Painel13] Carregando setores...');

        return fetchComRetry(CONFIG.api.setores)
            .then(function(response) {
                if (response.success && response.setores) {
                    Estado.setores = response.setores;
                    popularMultiSelect();
                    atualizarLabelMultiSelect();
                    console.log('[Painel13] ' + Estado.setores.length + ' setores carregados');
                }
            })
            .catch(function(erro) {
                console.error('[Painel13] Erro ao carregar setores:', erro);
            });
    }

    function carregarDados() {
        if (Estado.carregando) {
            console.log('[Painel13] Carregamento ja em andamento, ignorando...');
            return Promise.resolve();
        }

        Estado.carregando = true;
        atualizarStatus('loading');

        var scrollEstaAtivo = Estado.autoScrollAtivo;
        if (scrollEstaAtivo) {
            pararAutoScroll();
        }

        var urlNutricao = CONFIG.api.nutricao;
        var urlStats = CONFIG.api.stats;

        if (Estado.setoresSelecionados.length > 0) {
            var setorParam = encodeURIComponent(Estado.setoresSelecionados.join(','));
            urlNutricao += '?setor=' + setorParam;
            urlStats += '?setor=' + setorParam;
        }

        return Promise.all([
            fetchComRetry(urlNutricao),
            fetchComRetry(urlStats)
        ]).then(function(results) {
            var nutricaoResp = results[0];
            var statsResp = results[1];

            if (nutricaoResp.success) {
                Estado.dadosNutricao = nutricaoResp.data || [];
                Estado.dadosFiltrados = aplicarFiltrosStatus(Estado.dadosNutricao);
                renderizarTabela();
            }

            if (statsResp.success && statsResp.stats) {
                atualizarDashboard(statsResp.stats);
            }

            atualizarHorario();
            atualizarStatus('online');
            Estado.errosConsecutivos = 0;

            console.log('[Painel13] ' + Estado.dadosNutricao.length + ' registros carregados, ' + Estado.dadosFiltrados.length + ' apos filtro');

            if (scrollEstaAtivo) {
                setTimeout(function() {
                    Estado.autoScrollAtivo = true;
                    atualizarBotaoScroll();
                    iniciarAutoScrollModo();
                }, 500);
            }

            if (!Estado.autoScrollIniciado && !scrollEstaAtivo) {
                agendarAutoScrollInicial();
            }

        }).catch(function(erro) {
            console.error('[Painel13] Erro ao carregar dados:', erro);
            Estado.errosConsecutivos++;
            atualizarStatus('offline');

            if (Estado.errosConsecutivos >= 3) {
                mostrarErro('Falha na conexao com o servidor. Verifique sua rede.');
            }
        }).then(function() {
            Estado.carregando = false;
        });
    }

    function agendarAutoScrollInicial() {
        if (Estado.timeouts.autoScrollInicial) {
            clearTimeout(Estado.timeouts.autoScrollInicial);
        }

        Estado.timeouts.autoScrollInicial = setTimeout(function() {
            if (!Estado.autoScrollAtivo && Estado.dadosFiltrados.length > 0) {
                console.log('[Painel13] Iniciando auto-scroll automaticamente');
                Estado.autoScrollAtivo = true;
                Estado.autoScrollIniciado = true;
                atualizarBotaoScroll();
                iniciarAutoScrollModo();
            }
        }, CONFIG.delayAutoScrollInicial);
    }

    function atualizarDashboard(stats) {
        if (!stats) return;

        var cards = document.querySelectorAll('.resumo-card');
        cards.forEach(function(card) {
            card.classList.add('atualizando');
            setTimeout(function() { card.classList.remove('atualizando'); }, 300);
        });

        if (DOM.nomeSetor) {
            var qtd = Estado.setoresSelecionados.length;
            if (qtd === 0) {
                DOM.nomeSetor.textContent = 'Todos';
            } else if (qtd === 1) {
                DOM.nomeSetor.textContent = Estado.setoresSelecionados[0];
            } else {
                DOM.nomeSetor.textContent = qtd + ' setores';
            }
        }
        if (DOM.totalPacientes) {
            DOM.totalPacientes.textContent = formatarNumero(stats.total_pacientes);
        }
        if (DOM.comPrescricao) {
            DOM.comPrescricao.textContent = formatarNumero(stats.com_prescricao);
        }
        if (DOM.semPrescricao) {
            DOM.semPrescricao.textContent = formatarNumero(stats.sem_prescricao);
        }

        if (DOM.desatualizadas) {
            var desatualizadas = Estado.dadosNutricao.filter(function(d) {
                return d.dieta_limpa && verificarDesatualizada(d.dt_prescricao);
            }).length;
            DOM.desatualizadas.textContent = formatarNumero(desatualizadas);
        }
    }

    // =========================================================
    // RENDERIZACAO DA TABELA
    // =========================================================

    function renderizarTabela() {
        if (!DOM.painelMain) return;

        var dados = Estado.dadosFiltrados;

        if (!dados || dados.length === 0) {
            DOM.painelMain.innerHTML =
                '<div class="mensagem-vazia">' +
                    '<i class="fas fa-inbox"></i>' +
                    '<h3>Nenhum registro encontrado</h3>' +
                    '<p>Nao ha dados para os filtros selecionados</p>' +
                '</div>';

            if (DOM.paginacaoIndicator) DOM.paginacaoIndicator.style.display = 'none';
            return;
        }

        // Passa indice para alternar blocos visuais par/impar
        var linhasHtml = dados.map(function(registro, indice) {
            return criarLinhasPaciente(registro, indice);
        }).join('');

        var html =
            '<div class="tabela-container">' +
                '<table class="tabela-nutricao">' +
                    '<thead>' +
                        '<tr>' +
                            '<th class="col-leito">Leito</th>' +
                            '<th class="col-atendimento">Atend.</th>' +
                            '<th class="col-paciente">Paciente</th>' +
                            '<th class="col-acompanhante">Acomp.</th>' +
                            '<th class="col-prescritor">Prescritor</th>' +
                            '<th class="col-medico">Medico Resp.</th>' +
                            '<th class="col-alergia">Alergia</th>' +
                        '</tr>' +
                    '</thead>' +
                    '<tbody id="tabela-body">' +
                        linhasHtml +
                    '</tbody>' +
                '</table>' +
            '</div>';

        DOM.painelMain.innerHTML = html;

        if (Estado.modoScroll === 'paginar') {
            calcularPaginas();
            mostrarPagina(0);
        } else {
            if (DOM.paginacaoIndicator) DOM.paginacaoIndicator.style.display = 'none';
        }
    }

    function criarLinhasPaciente(registro, indice) {
        var nomeFormatado = formatarNome(registro.nm_paciente);
        var temPrescricao = registro.dieta_limpa && registro.dieta_limpa.trim() !== '';
        var ehDesatualizada = temPrescricao && verificarDesatualizada(registro.dt_prescricao);

        // Classe do bloco alternado (par/impar) para separacao visual
        var classeBloco = (indice % 2 === 0) ? 'bloco-par' : 'bloco-impar';

        var classesLinha = 'linha-principal ' + classeBloco;
        if (!temPrescricao) {
            classesLinha += ' sem-prescricao';
        } else if (ehDesatualizada) {
            classesLinha += ' prescricao-desatualizada';
        }

        var html =
            '<tr class="' + classesLinha + '">' +
                '<td class="col-leito">' +
                    '<span class="leito-badge">' + (escapeHtml(registro.leito) || '-') + '</span>' +
                '</td>' +
                '<td class="col-atendimento">' + (escapeHtml(registro.nr_atendimento) || '-') + '</td>' +
                '<td class="col-paciente">' +
                    '<div class="paciente-info">' +
                        '<span class="paciente-nome">' + escapeHtml(nomeFormatado) + '</span>' +
                        '<span class="paciente-detalhes">' + (escapeHtml(registro.convenio) || '-') + ' | ' + (escapeHtml(registro.idade) || '-') + '</span>' +
                    '</div>' +
                '</td>' +
                '<td class="col-acompanhante texto-centro">' +
                    renderizarIconeAcompanhante(registro.acompanhante) +
                '</td>' +
                '<td class="col-prescritor">' +
                    renderizarPrescritor(registro) +
                '</td>' +
                '<td class="col-medico">' + (escapeHtml(registro.nm_medico) || '-') + '</td>' +
                '<td class="col-alergia texto-centro">' +
                    renderizarIconeAlergia(registro.alergia) +
                '</td>' +
            '</tr>';

        // Classe do bloco para linhas de detalhe tambem
        var classeDetalheBloco = 'linha-detalhes ' + classeBloco;

        if (temPrescricao) {
            var dataFormatada = formatarDataPrescricao(registro.dt_prescricao);
            var classeBadgeData = ehDesatualizada ? 'badge-data desatualizada' : 'badge-data';
            var iconeData = ehDesatualizada ? 'fa-calendar-times' : 'fa-calendar-check';

            html +=
                '<tr class="' + classeDetalheBloco + ' linha-prescricao">' +
                    '<td colspan="7">' +
                        '<div class="prescricao-content">' +
                            '<span class="' + classeBadgeData + '">' +
                                '<i class="fas ' + iconeData + '"></i> ' +
                                dataFormatada +
                            '</span>' +
                            '<span class="prescricao-info">' +
                                '<i class="fas fa-prescription-bottle-medical"></i> ' +
                                '<strong>Prescricao ' + (escapeHtml(registro.nr_prescricao) || '-') + ':</strong> ' +
                                escapeHtml(registro.dieta_limpa) +
                            '</span>' +
                        '</div>' +
                    '</td>' +
                '</tr>';

            var obsLimpa = registro.obs_limpa ? registro.obs_limpa.trim() : '';
            if (obsLimpa && obsLimpa !== '' && obsLimpa !== '-') {
                html +=
                    '<tr class="' + classeDetalheBloco + ' linha-observacao ultima-linha">' +
                        '<td colspan="7">' +
                            '<div class="observacao-content">' +
                                '<i class="fas fa-comment-medical"></i> ' +
                                '<span><strong>Obs:</strong> ' + escapeHtml(obsLimpa) + '</span>' +
                            '</div>' +
                        '</td>' +
                    '</tr>';
            } else {
                // Marca prescricao como ultima linha - adiciona a classe diretamente
                html = html.replace(
                    classeDetalheBloco + ' linha-prescricao">',
                    classeDetalheBloco + ' linha-prescricao ultima-linha">'
                );
            }
        } else {
            html +=
                '<tr class="' + classeDetalheBloco + ' linha-alerta ultima-linha">' +
                    '<td colspan="7">' +
                        '<div class="alerta-sem-prescricao">' +
                            '<i class="fas fa-exclamation-triangle"></i> ' +
                            '<span>Paciente sem prescricao de nutricao</span>' +
                        '</div>' +
                    '</td>' +
                '</tr>';
        }

        return html;
    }

    function renderizarIconeAcompanhante(acompanhante) {
        if (acompanhante === 'Sim') {
            return '<i class="fas fa-user-plus icone-acompanhante-sim" title="Com acompanhante"></i>';
        }
        return '';
    }

    function renderizarIconeAlergia(alergia) {
        if (alergia === 'Sim') {
            return '<i class="fas fa-allergies icone-alergia-sim" title="Paciente com alergia"></i>';
        }
        return '<span class="icone-alergia-nao" title="Sem alergia registrada">-</span>';
    }

    function renderizarPrescritor(registro) {
        if (!registro.nm_prescritor || registro.nm_prescritor.trim() === '') {
            return '<span class="texto-muted">-</span>';
        }

        var icone = '';
        var classe = '';

        if (registro.tipo_prescritor === 'Nutricionista') {
            icone = '<i class="fas fa-apple-whole" title="Nutricionista"></i>';
            classe = 'prescritor-nutricionista';
        } else if (registro.tipo_prescritor === 'Medico') {
            icone = '<i class="fas fa-stethoscope" title="Medico"></i>';
            classe = 'prescritor-medico';
        } else {
            icone = '<i class="fas fa-user" title="Outro"></i>';
            classe = 'prescritor-outro';
        }

        return '<div class="prescritor-info ' + classe + '">' +
                    icone +
                    ' <span>' + escapeHtml(registro.nm_prescritor) + '</span>' +
                '</div>';
    }

    function mostrarErro(mensagem) {
        if (!DOM.painelMain) return;
        DOM.painelMain.innerHTML =
            '<div class="mensagem-erro">' +
                '<i class="fas fa-exclamation-triangle"></i>' +
                '<h3>Erro ao Carregar Dados</h3>' +
                '<p>' + escapeHtml(mensagem) + '</p>' +
                '<button class="btn-tentar-novamente" onclick="location.reload()">' +
                    '<i class="fas fa-sync-alt"></i> Tentar Novamente' +
                '</button>' +
            '</div>';
    }

    // =========================================================
    // MODO DE SCROLL - SELETOR
    // =========================================================

    function iniciarAutoScrollModo() {
        if (Estado.modoScroll === 'paginar') {
            iniciarPaginado();
        } else {
            iniciarAutoScroll();
        }
    }

    function alternarModoScroll() {
        var scrollEstaAtivo = Estado.autoScrollAtivo;

        if (scrollEstaAtivo) {
            pararAutoScroll();
        }

        if (Estado.modoScroll === 'rolar') {
            Estado.modoScroll = 'paginar';
        } else {
            Estado.modoScroll = 'rolar';
        }

        salvarModoScroll(Estado.modoScroll);
        atualizarBotaoModoScroll();

        renderizarTabela();

        if (scrollEstaAtivo) {
            Estado.autoScrollAtivo = true;
            atualizarBotaoScroll();
            setTimeout(function() {
                iniciarAutoScrollModo();
            }, 500);
        }
    }

    function atualizarBotaoModoScroll() {
        if (!DOM.btnModoScroll) return;

        if (Estado.modoScroll === 'paginar') {
            DOM.btnModoScroll.innerHTML = '<i class="fas fa-columns"></i><span class="btn-text">Paginar</span>';
            DOM.btnModoScroll.title = 'Modo atual: Paginado. Clique para Rolagem';
            DOM.btnModoScroll.classList.add('modo-paginado');
        } else {
            DOM.btnModoScroll.innerHTML = '<i class="fas fa-scroll"></i><span class="btn-text">Rolar</span>';
            DOM.btnModoScroll.title = 'Modo atual: Rolagem. Clique para Paginado';
            DOM.btnModoScroll.classList.remove('modo-paginado');
        }
    }

    // =========================================================
    // AUTO-SCROLL - MODO ROLAGEM CONTINUA
    // =========================================================

    function getElementoScroll() {
        return document.getElementById('tabela-body');
    }

    function iniciarAutoScroll() {
        pararScrollInterno();

        var elemento = getElementoScroll();
        if (!elemento) {
            console.warn('[Painel13] Elemento de scroll nao encontrado');
            return;
        }

        var scrollMax = elemento.scrollHeight - elemento.clientHeight;
        if (scrollMax <= 5) {
            console.log('[Painel13] Conteudo cabe na tela, scroll nao necessario');
            return;
        }

        console.log('[Painel13] Iniciando auto-scroll (rolagem), altura total:', elemento.scrollHeight);

        Estado.watchdog = {
            ultimaPosicao: elemento.scrollTop,
            contadorTravamento: 0,
            ultimoTimestamp: Date.now()
        };

        iniciarWatchdog();

        Estado.intervalos.scroll = setInterval(function() {
            if (!Estado.autoScrollAtivo) {
                pararAutoScroll();
                return;
            }

            var elem = getElementoScroll();
            if (!elem) {
                pararAutoScroll();
                return;
            }

            var scrollAtual = elem.scrollTop;
            var scrollMax = elem.scrollHeight - elem.clientHeight;

            if (scrollAtual >= scrollMax - 2) {
                console.log('[Painel13] Chegou ao final do scroll');
                clearInterval(Estado.intervalos.scroll);
                Estado.intervalos.scroll = null;

                setTimeout(function() {
                    if (!Estado.autoScrollAtivo) return;
                    console.log('[Painel13] Voltando ao topo');
                    elem.scrollTop = 0;
                    Estado.watchdog.ultimaPosicao = 0;
                    Estado.watchdog.contadorTravamento = 0;

                    setTimeout(function() {
                        if (Estado.autoScrollAtivo) {
                            console.log('[Painel13] Reiniciando ciclo de scroll');
                            iniciarAutoScroll();
                        }
                    }, CONFIG.pausaAposReset);
                }, CONFIG.pausaNoFinal);

                return;
            }

            elem.scrollTop += CONFIG.velocidadeScroll;
        }, CONFIG.intervaloScroll);
    }

    function pararScrollInterno() {
        if (Estado.intervalos.scroll) {
            clearInterval(Estado.intervalos.scroll);
            Estado.intervalos.scroll = null;
        }
        pararWatchdog();
    }

    // =========================================================
    // AUTO-SCROLL - MODO PAGINADO HORIZONTAL
    // =========================================================

    function calcularPaginas() {
        var tbody = getElementoScroll();
        if (!tbody) {
            Estado.totalPaginas = 0;
            return;
        }

        var alturaVisivel = tbody.clientHeight;
        var alturaTotal = tbody.scrollHeight;

        if (alturaTotal <= alturaVisivel || alturaVisivel <= 0) {
            Estado.totalPaginas = 1;
        } else {
            Estado.totalPaginas = Math.ceil(alturaTotal / alturaVisivel);
        }

        Estado.paginaAtual = 0;
        atualizarIndicadorPagina();
    }

    function mostrarPagina(indice) {
        var tbody = getElementoScroll();
        if (!tbody) return;

        if (indice < 0) indice = 0;
        if (indice >= Estado.totalPaginas) indice = 0;

        Estado.paginaAtual = indice;

        var alturaVisivel = tbody.clientHeight;
        var targetScroll = indice * alturaVisivel;
        var scrollMax = tbody.scrollHeight - alturaVisivel;

        if (targetScroll > scrollMax) targetScroll = scrollMax;

        tbody.classList.add('pagina-transicao');
        tbody.scrollTop = targetScroll;

        setTimeout(function() {
            tbody.classList.remove('pagina-transicao');
        }, CONFIG.paginadoTransicao);

        atualizarIndicadorPagina();
    }

    function proximaPagina() {
        var proxima = Estado.paginaAtual + 1;
        if (proxima >= Estado.totalPaginas) {
            proxima = 0;
        }
        mostrarPagina(proxima);
    }

    function iniciarPaginado() {
        pararPaginado();

        calcularPaginas();

        if (Estado.totalPaginas <= 1) {
            console.log('[Painel13] Conteudo cabe em 1 pagina, paginacao nao necessaria');
            return;
        }

        console.log('[Painel13] Iniciando modo paginado, ' + Estado.totalPaginas + ' paginas');
        mostrarPagina(0);

        Estado.intervalos.paginado = setInterval(function() {
            if (!Estado.autoScrollAtivo) {
                pararPaginado();
                return;
            }
            proximaPagina();
        }, CONFIG.paginadoTempo);
    }

    function pararPaginado() {
        if (Estado.intervalos.paginado) {
            clearInterval(Estado.intervalos.paginado);
            Estado.intervalos.paginado = null;
        }
    }

    function atualizarIndicadorPagina() {
        if (!DOM.paginacaoIndicator) return;

        if (Estado.modoScroll !== 'paginar' || Estado.totalPaginas <= 1) {
            DOM.paginacaoIndicator.style.display = 'none';
            return;
        }

        DOM.paginacaoIndicator.style.display = 'flex';

        if (DOM.paginacaoTexto) {
            DOM.paginacaoTexto.textContent = 'Pagina ' + (Estado.paginaAtual + 1) + ' de ' + Estado.totalPaginas;
        }

        if (DOM.paginacaoDots) {
            var dotsHtml = '';
            for (var i = 0; i < Estado.totalPaginas; i++) {
                var classeAtivo = i === Estado.paginaAtual ? ' dot-ativo' : '';
                dotsHtml += '<span class="paginacao-dot' + classeAtivo + '" data-pagina="' + i + '"></span>';
            }
            DOM.paginacaoDots.innerHTML = dotsHtml;

            var dots = DOM.paginacaoDots.querySelectorAll('.paginacao-dot');
            dots.forEach(function(dot) {
                dot.addEventListener('click', function() {
                    var pag = parseInt(this.getAttribute('data-pagina'), 10);
                    mostrarPagina(pag);

                    if (Estado.intervalos.paginado) {
                        pararPaginado();
                        Estado.intervalos.paginado = setInterval(function() {
                            if (!Estado.autoScrollAtivo) {
                                pararPaginado();
                                return;
                            }
                            proximaPagina();
                        }, CONFIG.paginadoTempo);
                    }
                });
            });
        }
    }

    // =========================================================
    // WATCHDOG
    // =========================================================

    function iniciarWatchdog() {
        pararWatchdog();
        console.log('[Painel13] Watchdog iniciado');

        Estado.intervalos.watchdog = setInterval(function() {
            if (!Estado.autoScrollAtivo) {
                pararWatchdog();
                return;
            }

            var elemento = getElementoScroll();
            if (!elemento) return;

            var posicaoAtual = elemento.scrollTop;
            var scrollMax = elemento.scrollHeight - elemento.clientHeight;

            var estaNoMeio = posicaoAtual > 5 && posicaoAtual < scrollMax - 5;
            var naoMoveu = Math.abs(posicaoAtual - Estado.watchdog.ultimaPosicao) < 1;
            var intervaloOk = Estado.intervalos.scroll !== null;

            if (estaNoMeio && naoMoveu && intervaloOk) {
                Estado.watchdog.contadorTravamento++;
                console.warn('[Painel13] Watchdog: possivel travamento (' + Estado.watchdog.contadorTravamento + '/' + CONFIG.watchdogMaxTravamentos + ')');

                if (Estado.watchdog.contadorTravamento >= CONFIG.watchdogMaxTravamentos) {
                    console.error('[Painel13] Watchdog: TRAVAMENTO CONFIRMADO - Reiniciando scroll');
                    pararScrollInterno();

                    setTimeout(function() {
                        if (Estado.autoScrollAtivo) {
                            Estado.watchdog.contadorTravamento = 0;
                            iniciarAutoScroll();
                        }
                    }, 1000);
                    return;
                }
            } else {
                Estado.watchdog.contadorTravamento = 0;
            }

            Estado.watchdog.ultimaPosicao = posicaoAtual;
            Estado.watchdog.ultimoTimestamp = Date.now();
        }, CONFIG.watchdogInterval);
    }

    function pararWatchdog() {
        if (Estado.intervalos.watchdog) {
            clearInterval(Estado.intervalos.watchdog);
            Estado.intervalos.watchdog = null;
        }
    }

    // =========================================================
    // CONTROLE UNIFICADO DE AUTO-SCROLL
    // =========================================================

    function pararAutoScroll() {
        pararScrollInterno();
        pararPaginado();
        console.log('[Painel13] Auto-scroll parado');
    }

    function atualizarBotaoScroll() {
        if (!DOM.btnAutoScroll) return;

        if (Estado.autoScrollAtivo) {
            DOM.btnAutoScroll.classList.add('ativo');
            DOM.btnAutoScroll.innerHTML = '<i class="fas fa-pause"></i><span class="btn-text">Pausar</span>';
            DOM.btnAutoScroll.title = 'Pausar rolagem automatica';
        } else {
            DOM.btnAutoScroll.classList.remove('ativo');
            DOM.btnAutoScroll.innerHTML = '<i class="fas fa-play"></i><span class="btn-text">Auto Scroll</span>';
            DOM.btnAutoScroll.title = 'Ativar rolagem automatica';
        }
    }

    // =========================================================
    // EVENT HANDLERS
    // =========================================================

    function configurarEventos() {
        var btnToggleFiltros = document.getElementById('btn-toggle-filtros');
        if (btnToggleFiltros) {
            var filtrosVisiveis = false;
            btnToggleFiltros.addEventListener('click', function() {
                filtrosVisiveis = !filtrosVisiveis;
                var bar = document.getElementById('filtros-bar');
                if (bar) bar.style.display = filtrosVisiveis ? 'block' : 'none';
            });
        }

        if (DOM.btnMultiSetor) {
            DOM.btnMultiSetor.addEventListener('click', function(e) {
                e.stopPropagation();
                toggleDropdown();
            });
        }

        if (DOM.btnSelectAll) {
            DOM.btnSelectAll.addEventListener('click', function(e) {
                e.stopPropagation();
                selecionarTodosSetores();
            });
        }
        if (DOM.btnSelectNone) {
            DOM.btnSelectNone.addEventListener('click', function(e) {
                e.stopPropagation();
                limparSelecaoSetores();
            });
        }

        document.addEventListener('click', function(e) {
            if (Estado.dropdownAberto && DOM.multiSelectContainer && !DOM.multiSelectContainer.contains(e.target)) {
                fecharDropdown();
            }
        });

        if (DOM.btnFiltroSemPrescricao) {
            DOM.btnFiltroSemPrescricao.addEventListener('click', toggleFiltroSemPrescricao);
        }
        if (DOM.btnFiltroDesatualizadas) {
            DOM.btnFiltroDesatualizadas.addEventListener('click', toggleFiltroDesatualizadas);
        }

        if (DOM.btnModoScroll) {
            DOM.btnModoScroll.addEventListener('click', alternarModoScroll);
        }

        if (DOM.btnVoltar) {
            DOM.btnVoltar.addEventListener('click', function() {
                window.location.href = '/frontend/dashboard.html';
            });
        }

        if (DOM.btnRefresh) {
            DOM.btnRefresh.addEventListener('click', function() {
                DOM.btnRefresh.classList.add('girando');
                carregarDados().then(function() {
                    setTimeout(function() {
                        DOM.btnRefresh.classList.remove('girando');
                    }, 500);
                });
            });
        }

        if (DOM.btnAutoScroll) {
            DOM.btnAutoScroll.addEventListener('click', function() {
                Estado.autoScrollAtivo = !Estado.autoScrollAtivo;
                Estado.autoScrollIniciado = true;
                atualizarBotaoScroll();

                if (Estado.autoScrollAtivo) {
                    iniciarAutoScrollModo();
                } else {
                    pararAutoScroll();
                }
            });
        }

        document.addEventListener('keydown', function(e) {
            if (e.key === 'Escape') {
                if (Estado.dropdownAberto) {
                    fecharDropdown();
                } else if (Estado.autoScrollAtivo) {
                    Estado.autoScrollAtivo = false;
                    atualizarBotaoScroll();
                    pararAutoScroll();
                }
            }

            if (e.key === 'F5') {
                e.preventDefault();
                carregarDados();
            }

            if (e.key === ' ' && e.target === document.body) {
                e.preventDefault();
                Estado.autoScrollAtivo = !Estado.autoScrollAtivo;
                Estado.autoScrollIniciado = true;
                atualizarBotaoScroll();
                if (Estado.autoScrollAtivo) {
                    iniciarAutoScrollModo();
                } else {
                    pararAutoScroll();
                }
            }

            if (Estado.modoScroll === 'paginar') {
                if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
                    e.preventDefault();
                    proximaPagina();
                }
                if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
                    e.preventDefault();
                    var anterior = Estado.paginaAtual - 1;
                    if (anterior < 0) anterior = Estado.totalPaginas - 1;
                    mostrarPagina(anterior);
                }
            }
        });

        document.addEventListener('visibilitychange', function() {
            if (document.hidden) {
                if (Estado.autoScrollAtivo) {
                    pararAutoScroll();
                    Estado.autoScrollAtivo = true;
                }
            } else {
                if (Estado.autoScrollAtivo) {
                    iniciarAutoScrollModo();
                }
                carregarDados();
            }
        });
    }

    // =========================================================
    // INICIALIZACAO
    // =========================================================

    function inicializar() {
        console.log('[Painel13] Inicializando...');

        cachearElementos();

        Estado.setoresSelecionados = recuperarSetoresSelecionados();
        Estado.modoScroll = recuperarModoScroll();
        Estado.filtroSemPrescricao = recuperarFiltroStatus(CONFIG.storageKeyFiltroSemPresc);
        Estado.filtroDesatualizadas = recuperarFiltroStatus(CONFIG.storageKeyFiltroDesatual);

        atualizarBotaoModoScroll();
        atualizarBotaoFiltroStatus(DOM.btnFiltroSemPrescricao, Estado.filtroSemPrescricao);
        atualizarBotaoFiltroStatus(DOM.btnFiltroDesatualizadas, Estado.filtroDesatualizadas);

        configurarEventos();

        carregarSetores().then(function() {
            return carregarDados();
        }).then(function() {
            Estado.intervalos.refresh = setInterval(carregarDados, CONFIG.intervaloRefresh);
            console.log('[Painel13] Inicializado com sucesso');
        });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', inicializar);
    } else {
        inicializar();
    }

})();