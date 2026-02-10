// ========================================
// Painel 4 - Ocupacao Hospitalar
// Pagina de Detalhes - JavaScript
// ========================================

(function () {
    'use strict';

    // -- Configuracao --

    var BASE_URL = window.location.origin;

    var CONFIG = {
        apiUrlOcupados: BASE_URL + '/api/paineis/painel4/leitos-ocupados',
        apiUrlDisponiveis: BASE_URL + '/api/paineis/painel4/leitos-disponiveis',
        apiUrlTodos: BASE_URL + '/api/paineis/painel4/todos-leitos',
        apiUrlSetores: BASE_URL + '/api/paineis/painel4/setores',
        intervaloRefresh: 30000,
        velocidadeScroll: 0.5,
        limiteLinhas: 30,
        pausaNoFinal: 2000,
        pausaReinicio: 5000,
        autoScrollDelay: 5000
    };

    // -- Estado Global --

    var estado = {
        dados: {
            ocupados: [],
            disponiveis: [],
            todos: []
        },
        filtrados: {
            ocupados: [],
            disponiveis: [],
            todos: []
        },
        filtros: {
            setor: '',
            status: '',
            busca: ''
        },
        ordenacao: {
            campo: null,
            direcao: 'asc'
        },
        autoScroll: {
            ativo: false,
            intervalo: null,
            emPausa: false,
            aguardando: false
        }
    };

    var timerRefresh = null;

    // ========================================
    // INICIALIZACAO
    // ========================================

    function inicializar() {
        detectarSetorURL();
        configurarEventos();
        carregarDados();

        timerRefresh = setInterval(carregarDados, CONFIG.intervaloRefresh);

        // Auto-scroll apos delay
        setTimeout(function () {
            if (!estado.autoScroll.ativo) {
                ativarAutoScroll();
            }
        }, CONFIG.autoScrollDelay);
    }

    function detectarSetorURL() {
        var urlParams = new URLSearchParams(window.location.search);
        var setorParam = urlParams.get('setor');

        if (setorParam) {
            estado.filtros.setor = decodeURIComponent(setorParam).toLowerCase();

            // Ativar aba "Todos" quando vem de um setor especifico
            setTimeout(function () {
                ativarAba('todos-leitos');
            }, 100);
        }
    }

    // ========================================
    // EVENTOS
    // ========================================

    function configurarEventos() {
        // Botao voltar
        var btnVoltar = document.getElementById('btn-voltar-dashboard');
        if (btnVoltar) {
            btnVoltar.addEventListener('click', function () {
                window.location.href = '/painel/painel4';
            });
        }

        // Botao refresh
        var btnRefresh = document.getElementById('btn-refresh');
        if (btnRefresh) {
            btnRefresh.addEventListener('click', function () {
                btnRefresh.classList.add('refreshing');
                carregarDados().finally(function () {
                    setTimeout(function () {
                        btnRefresh.classList.remove('refreshing');
                    }, 600);
                });
            });
        }

        // Botao limpar
        var btnLimpar = document.getElementById('btn-limpar-filtros');
        if (btnLimpar) {
            btnLimpar.addEventListener('click', limparFiltros);
        }

        // Botao auto-scroll
        var btnScroll = document.getElementById('btn-auto-scroll');
        if (btnScroll) {
            btnScroll.addEventListener('click', toggleAutoScroll);
        }

        // Filtros
        document.getElementById('filtro-setor').addEventListener('change', aplicarFiltros);
        document.getElementById('filtro-status').addEventListener('change', aplicarFiltros);
        document.getElementById('filtro-busca').addEventListener('input', aplicarFiltros);

        // Abas
        var tabBtns = document.querySelectorAll('.tab-btn');
        for (var i = 0; i < tabBtns.length; i++) {
            tabBtns[i].addEventListener('click', function () {
                ativarAba(this.getAttribute('data-tab'));
            });
        }

        // Ordenacao
        var cols = document.querySelectorAll('th.col-sortable');
        for (var j = 0; j < cols.length; j++) {
            cols[j].addEventListener('click', function () {
                ordenarPorCampo(this.getAttribute('data-campo'));
            });
        }
    }

    // ========================================
    // ABAS
    // ========================================

    function ativarAba(tabId) {
        var btns = document.querySelectorAll('.tab-btn');
        var panels = document.querySelectorAll('.tab-panel');

        for (var i = 0; i < btns.length; i++) {
            btns[i].classList.remove('active');
            btns[i].setAttribute('aria-selected', 'false');
        }

        for (var j = 0; j < panels.length; j++) {
            panels[j].classList.remove('active');
        }

        var btnAlvo = document.querySelector('[data-tab="' + tabId + '"]');
        var panelAlvo = document.getElementById('tab-' + tabId);

        if (btnAlvo) {
            btnAlvo.classList.add('active');
            btnAlvo.setAttribute('aria-selected', 'true');
        }

        if (panelAlvo) {
            panelAlvo.classList.add('active');
        }

        atualizarEstatisticas();
    }

    function obterAbaAtiva() {
        var btn = document.querySelector('.tab-btn.active');
        return btn ? btn.getAttribute('data-tab') : 'leitos-ocupados';
    }

    // ========================================
    // FILTROS
    // ========================================

    function limparFiltros() {
        document.getElementById('filtro-setor').value = '';
        document.getElementById('filtro-status').value = '';
        document.getElementById('filtro-busca').value = '';

        estado.filtros = { setor: '', status: '', busca: '' };
        aplicarFiltros();
    }

    function aplicarFiltros() {
        // Capturar valores
        estado.filtros.setor = document.getElementById('filtro-setor').value.toLowerCase();
        estado.filtros.status = document.getElementById('filtro-status').value;
        estado.filtros.busca = document.getElementById('filtro-busca').value.toLowerCase();

        // Filtrar cada dataset
        estado.filtrados.ocupados = filtrarArray(estado.dados.ocupados, true);
        estado.filtrados.disponiveis = filtrarArray(estado.dados.disponiveis, false);
        estado.filtrados.todos = filtrarArray(estado.dados.todos, false);

        // Reaplicar ordenacao se houver
        if (estado.ordenacao.campo) {
            var aba = obterAbaAtiva();
            if (aba === 'leitos-ocupados') {
                ordenarArray(estado.filtrados.ocupados, estado.ordenacao.campo);
            } else if (aba === 'leitos-disponiveis') {
                ordenarArray(estado.filtrados.disponiveis, estado.ordenacao.campo);
            } else {
                ordenarArray(estado.filtrados.todos, estado.ordenacao.campo);
            }
        }

        // Renderizar
        renderizarTabelaOcupados();
        renderizarTabelaDisponiveis();
        renderizarTabelaTodos();
        atualizarEstatisticas();
    }

    function filtrarArray(array, apenasOcupados) {
        return array.filter(function (item) {
            // Filtro de setor
            if (estado.filtros.setor && item.setor) {
                if (!item.setor.toLowerCase().includes(estado.filtros.setor)) {
                    return false;
                }
            }

            // Filtro de status (nao se aplica a ocupados-only)
            if (!apenasOcupados && estado.filtros.status && item.status_leito) {
                if (item.status_leito !== estado.filtros.status) {
                    return false;
                }
            }

            // Filtro de busca
            if (estado.filtros.busca) {
                var texto = [
                    item.paciente || '',
                    item.leito || '',
                    item.medico || '',
                    item.convenio || '',
                    item.clinica || ''
                ].join(' ').toLowerCase();

                if (!texto.includes(estado.filtros.busca)) {
                    return false;
                }
            }

            return true;
        });
    }

    // ========================================
    // CARREGAMENTO DE DADOS
    // ========================================

    function carregarDados() {
        return Promise.all([
            fetch(CONFIG.apiUrlOcupados).then(function (r) { return r.json(); }),
            fetch(CONFIG.apiUrlDisponiveis).then(function (r) { return r.json(); }),
            fetch(CONFIG.apiUrlTodos).then(function (r) { return r.json(); }),
            fetch(CONFIG.apiUrlSetores).then(function (r) { return r.json(); })
        ])
        .then(function (resultados) {
            var ocupados = resultados[0];
            var disponiveis = resultados[1];
            var todos = resultados[2];
            var setores = resultados[3];

            if (ocupados.success) estado.dados.ocupados = ocupados.data;
            if (disponiveis.success) estado.dados.disponiveis = disponiveis.data;
            if (todos.success) estado.dados.todos = todos.data;
            if (setores.success) popularFiltroSetores(setores.data);

            aplicarFiltros();
            atualizarBadges();
            atualizarRelogio();
        })
        .catch(function (erro) {
            console.error('Erro ao carregar dados:', erro);
        });
    }

    function popularFiltroSetores(setores) {
        var select = document.getElementById('filtro-setor');
        var valorAtual = select.value;

        select.innerHTML = '<option value="">Todos os Setores</option>';

        setores
            .sort(function (a, b) {
                return (a.nm_setor || '').localeCompare(b.nm_setor || '');
            })
            .forEach(function (setor) {
                var option = document.createElement('option');
                option.value = setor.nm_setor;
                option.textContent = setor.nm_setor;
                select.appendChild(option);
            });

        // Restaurar selecao (URL ou anterior)
        if (estado.filtros.setor) {
            var opcoes = select.options;
            for (var i = 0; i < opcoes.length; i++) {
                if (opcoes[i].value.toLowerCase() === estado.filtros.setor.toLowerCase()) {
                    select.value = opcoes[i].value;
                    break;
                }
            }
        } else if (valorAtual) {
            select.value = valorAtual;
        }
    }

    // ========================================
    // BADGES E ESTATISTICAS
    // ========================================

    function atualizarBadges() {
        setText('badge-ocupados', estado.dados.ocupados.length);
        setText('badge-disponiveis', estado.dados.disponiveis.length);
        setText('badge-todos', estado.dados.todos.length);
    }

    function atualizarEstatisticas() {
        var aba = obterAbaAtiva();
        var total = 0;
        var filtrado = 0;

        if (aba === 'leitos-ocupados') {
            total = estado.dados.ocupados.length;
            filtrado = estado.filtrados.ocupados.length;
        } else if (aba === 'leitos-disponiveis') {
            total = estado.dados.disponiveis.length;
            filtrado = estado.filtrados.disponiveis.length;
        } else {
            total = estado.dados.todos.length;
            filtrado = estado.filtrados.todos.length;
        }

        setText('total-registros', total);
        setText('total-filtrados', filtrado);
    }

    function atualizarRelogio() {
        var el = document.getElementById('ultima-atualizacao');
        if (el) {
            el.textContent = new Date().toLocaleTimeString('pt-BR', {
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit'
            });
        }
    }

    // ========================================
    // RENDERIZACAO DAS TABELAS
    // ========================================

    function renderizarTabelaOcupados() {
        var tbody = document.getElementById('tbody-ocupados');
        var dados = estado.filtrados.ocupados;

        if (dados.length === 0) {
            tbody.innerHTML = criarEstadoVazio(9, 'Nenhum leito ocupado encontrado', 'Ajuste os filtros ou limpe a busca');
            return;
        }

        tbody.innerHTML = dados.map(function (item) {
            var classeGenero = obterClasseGenero(item.sexo);

            return (
                '<tr class="' + classeGenero + '">' +
                    '<td>' + (item.leito || '-') + '</td>' +
                    '<td>' + (item.paciente || '-') + '</td>' +
                    '<td style="text-align:center">' + (item.idade || '-') + '</td>' +
                    '<td style="text-align:center">' + formatarSexo(item.sexo) + '</td>' +
                    '<td>' + (item.convenio || '-') + '</td>' +
                    '<td>' + (item.medico || '-') + '</td>' +
                    '<td style="text-align:center;font-weight:700">' + (item.dias_internado || 0) + '</td>' +
                    '<td>' + (item.clinica || '-') + '</td>' +
                    '<td>' + (item.tipo_acomodacao || '-') + '</td>' +
                '</tr>'
            );
        }).join('');
    }

    function renderizarTabelaDisponiveis() {
        var tbody = document.getElementById('tbody-disponiveis');
        var dados = estado.filtrados.disponiveis;

        if (dados.length === 0) {
            tbody.innerHTML = criarEstadoVazio(4, 'Nenhum leito disponivel encontrado', 'Ajuste os filtros');
            return;
        }

        tbody.innerHTML = dados.map(function (item) {
            return (
                '<tr>' +
                    '<td>' + (item.leito || '-') + '</td>' +
                    '<td>' + (item.setor || '-') + '</td>' +
                    '<td>' + (item.tipo_acomodacao || '-') + '</td>' +
                    '<td>' + formatarStatusLeito(item.status_leito, item.status) + '</td>' +
                '</tr>'
            );
        }).join('');
    }

    function renderizarTabelaTodos() {
        var tbody = document.getElementById('tbody-todos');
        var dados = estado.filtrados.todos;

        if (dados.length === 0) {
            tbody.innerHTML = criarEstadoVazio(9, 'Nenhum registro encontrado', 'Ajuste os filtros');
            return;
        }

        tbody.innerHTML = dados.map(function (item) {
            var classeGenero = item.paciente ? obterClasseGenero(item.sexo) : '';

            return (
                '<tr class="' + classeGenero + '">' +
                    '<td>' + (item.leito || '-') + '</td>' +
                    '<td>' + (item.setor || '-') + '</td>' +
                    '<td>' + formatarStatusLeito(item.status_leito, item.status_leito_desc) + '</td>' +
                    '<td>' + (item.paciente || '-') + '</td>' +
                    '<td style="text-align:center">' + (item.idade || '-') + '</td>' +
                    '<td>' + (item.convenio || '-') + '</td>' +
                    '<td>' + (item.medico || '-') + '</td>' +
                    '<td style="text-align:center">' + (item.dias_internado || '-') + '</td>' +
                    '<td>' + (item.tipo_acomodacao || '-') + '</td>' +
                '</tr>'
            );
        }).join('');
    }

    // ========================================
    // FORMATACAO
    // ========================================

    function formatarSexo(sexo) {
        if (!sexo) return '-';
        if (sexo === 'M') return 'Masc';
        if (sexo === 'F') return 'Fem';
        return sexo;
    }

    function formatarStatusLeito(status, descricao) {
        var mapa = {
            'P': { classe: 'badge-ocupado', texto: 'Ocupado' },
            'L': { classe: 'badge-livre', texto: 'Livre' },
            'H': { classe: 'badge-higienizacao', texto: 'Higienizacao' },
            'I': { classe: 'badge-interditado', texto: 'Interditado' }
        };

        var info = mapa[status] || { classe: '', texto: '' };
        var texto = descricao || info.texto || status || 'Desconhecido';

        return '<span class="badge-status ' + info.classe + '">' + texto + '</span>';
    }

    function obterClasseGenero(sexo) {
        if (sexo === 'M') return 'genero-masculino';
        if (sexo === 'F') return 'genero-feminino';
        return '';
    }

    function criarEstadoVazio(colunas, titulo, subtitulo) {
        return (
            '<tr><td colspan="' + colunas + '" class="td-empty">' +
                '<i class="fas fa-inbox"></i>' +
                '<strong>' + titulo + '</strong>' +
                '<span>' + subtitulo + '</span>' +
            '</td></tr>'
        );
    }

    // ========================================
    // ORDENACAO
    // ========================================

    function ordenarPorCampo(campo) {
        if (estado.ordenacao.campo === campo) {
            estado.ordenacao.direcao = estado.ordenacao.direcao === 'asc' ? 'desc' : 'asc';
        } else {
            estado.ordenacao.campo = campo;
            estado.ordenacao.direcao = 'asc';
        }

        var aba = obterAbaAtiva();

        if (aba === 'leitos-ocupados') {
            ordenarArray(estado.filtrados.ocupados, campo);
            renderizarTabelaOcupados();
        } else if (aba === 'leitos-disponiveis') {
            ordenarArray(estado.filtrados.disponiveis, campo);
            renderizarTabelaDisponiveis();
        } else {
            ordenarArray(estado.filtrados.todos, campo);
            renderizarTabelaTodos();
        }

        atualizarIconesOrdenacao(campo);
    }

    function ordenarArray(array, campo) {
        var direcao = estado.ordenacao.direcao;

        array.sort(function (a, b) {
            var valorA = a[campo];
            var valorB = b[campo];

            if (valorA == null) valorA = '';
            if (valorB == null) valorB = '';

            if (typeof valorA === 'string') valorA = valorA.toLowerCase();
            if (typeof valorB === 'string') valorB = valorB.toLowerCase();

            var resultado = 0;
            if (valorA < valorB) resultado = -1;
            if (valorA > valorB) resultado = 1;

            return direcao === 'asc' ? resultado : -resultado;
        });
    }

    function atualizarIconesOrdenacao(campoAtivo) {
        var icons = document.querySelectorAll('.sort-icon');
        for (var i = 0; i < icons.length; i++) {
            icons[i].className = 'fas fa-sort sort-icon';
        }

        var th = document.querySelector('th[data-campo="' + campoAtivo + '"]');
        if (th) {
            var icon = th.querySelector('.sort-icon');
            if (icon) {
                icon.className = estado.ordenacao.direcao === 'asc'
                    ? 'fas fa-sort-up sort-icon active'
                    : 'fas fa-sort-down sort-icon active';
            }
        }
    }

    // ========================================
    // AUTO-SCROLL
    // ========================================

    function toggleAutoScroll() {
        if (estado.autoScroll.ativo) {
            desativarAutoScroll();
        } else {
            ativarAutoScroll();
        }
    }

    function ativarAutoScroll() {
        estado.autoScroll.ativo = true;
        estado.autoScroll.emPausa = false;
        estado.autoScroll.aguardando = false;

        var btn = document.getElementById('btn-auto-scroll');
        if (btn) {
            btn.classList.add('scroll-active');
            btn.innerHTML = '<i class="fas fa-pause"></i> <span class="btn-text">Pausar</span>';
        }

        iniciarCicloScroll();
    }

    function desativarAutoScroll() {
        estado.autoScroll.ativo = false;

        if (estado.autoScroll.intervalo) {
            clearInterval(estado.autoScroll.intervalo);
            estado.autoScroll.intervalo = null;
        }

        var btn = document.getElementById('btn-auto-scroll');
        if (btn) {
            btn.classList.remove('scroll-active');
            btn.innerHTML = '<i class="fas fa-play"></i> <span class="btn-text">Auto Scroll</span>';
        }
    }

    function iniciarCicloScroll() {
        // Limpar intervalo anterior
        if (estado.autoScroll.intervalo) {
            clearInterval(estado.autoScroll.intervalo);
        }

        estado.autoScroll.intervalo = setInterval(function () {
            if (!estado.autoScroll.ativo || estado.autoScroll.emPausa || estado.autoScroll.aguardando) {
                return;
            }

            // Obter container da aba ativa
            var container = obterContainerAtivo();
            if (!container) return;

            var tbody = container.querySelector('tbody');
            if (!tbody) return;

            var linhas = tbody.getElementsByTagName('tr');
            if (!linhas || linhas.length === 0) return;

            // Ignorar se so tem estado vazio ou loading
            if (linhas[0].querySelector('.td-empty, .td-loading')) return;

            // Calcular limite de scroll
            var scrollMax;
            if (linhas.length <= CONFIG.limiteLinhas) {
                scrollMax = container.scrollHeight - container.clientHeight;
            } else {
                var linhaLimite = linhas[CONFIG.limiteLinhas - 1];
                if (linhaLimite) {
                    scrollMax = linhaLimite.offsetTop + linhaLimite.offsetHeight - container.clientHeight + 50;
                } else {
                    scrollMax = container.scrollHeight - container.clientHeight;
                }
            }

            // Chegou no final
            if (container.scrollTop >= scrollMax - 10) {
                estado.autoScroll.emPausa = true;

                setTimeout(function () {
                    if (!estado.autoScroll.ativo) return;

                    container.scrollTop = 0;
                    estado.autoScroll.aguardando = true;

                    setTimeout(function () {
                        if (estado.autoScroll.ativo) {
                            estado.autoScroll.aguardando = false;
                            estado.autoScroll.emPausa = false;
                        }
                    }, CONFIG.pausaReinicio);

                }, CONFIG.pausaNoFinal);

                return;
            }

            // Scrollar
            container.scrollTop += CONFIG.velocidadeScroll;

        }, 50);
    }

    function obterContainerAtivo() {
        var aba = obterAbaAtiva();
        var mapa = {
            'leitos-ocupados': 'scroll-container-ocupados',
            'leitos-disponiveis': 'scroll-container-disponiveis',
            'todos-leitos': 'scroll-container-todos'
        };

        var id = mapa[aba];
        return id ? document.getElementById(id) : null;
    }

    // ========================================
    // UTILITARIOS
    // ========================================

    function setText(id, valor) {
        var el = document.getElementById(id);
        if (el) el.textContent = valor;
    }

    // ========================================
    // START
    // ========================================

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', inicializar);
    } else {
        inicializar();
    }

})();