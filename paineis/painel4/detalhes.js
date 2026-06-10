// Painel 4 — Detalhes — Ocupação Hospitalar

var PAINEL_VERSAO = '1.0.41';
(function () {
    'use strict';

    var BASE_URL = window.location.origin;

    var CONFIG = {
        apiUrlOcupados:    BASE_URL + '/api/paineis/painel4/leitos-ocupados',
        apiUrlDisponiveis: BASE_URL + '/api/paineis/painel4/leitos-disponiveis',
        apiUrlTodos:       BASE_URL + '/api/paineis/painel4/todos-leitos',
        apiUrlSetores:     BASE_URL + '/api/paineis/painel4/setores',
        intervaloRefresh:  30000,
        velocidadeScroll:  0.5,
        limiteLinhas:      30,
        pausaNoFinal:      2000,
        pausaReinicio:     5000,
        autoScrollDelay:   5000
    };

    var estado = {
        dados: {
            ocupados:    [],
            disponiveis: [],
            todos:       []
        },
        filtrados: {
            ocupados:    [],
            disponiveis: [],
            todos:       []
        },
        filtros: {
            setor:  '',
            status: '',
            busca:  ''
        },
        ordenacao: {
            campo:    null,
            direcao: 'asc'
        },
        autoScroll: {
            ativo:      false,
            intervalo:  null,
            emPausa:    false,
            aguardando: false
        }
    };

    var timerRefresh = null;

    // ── INICIALIZAÇÃO ────────────────────────────────────────────────

    function inicializar() {
        detectarSetorURL();
        configurarEventos();
        carregarDados();

        timerRefresh = setInterval(carregarDados, CONFIG.intervaloRefresh);

        setTimeout(function () {
            if (!estado.autoScroll.ativo) ativarAutoScroll();
        }, CONFIG.autoScrollDelay);
    }

    function detectarSetorURL() {
        var urlParams = new URLSearchParams(window.location.search);
        var setorParam = urlParams.get('setor');
        if (setorParam) {
            estado.filtros.setor = decodeURIComponent(setorParam).toLowerCase();
            setTimeout(function () { ativarAba('todos-leitos'); }, 100);
        }
    }

    // ── EVENTOS ──────────────────────────────────────────────────────

    function configurarEventos() {
        var btnVoltar = document.getElementById('btn-voltar-dashboard');
        if (btnVoltar) {
            btnVoltar.addEventListener('click', function () {
                window.location.href = '/painel/painel4';
            });
        }

        var btnRefresh = document.getElementById('btn-refresh');
        if (btnRefresh) {
            btnRefresh.addEventListener('click', function () {
                var icone = btnRefresh.querySelector('i');
                if (icone) icone.classList.add('fa-spin');
                carregarDados().then(function () {
                    setTimeout(function () {
                        if (icone) icone.classList.remove('fa-spin');
                    }, 600);
                });
            });
        }

        var btnLimpar = document.getElementById('btn-limpar-filtros');
        if (btnLimpar) btnLimpar.addEventListener('click', limparFiltros);

        var btnScroll = document.getElementById('btn-auto-scroll');
        if (btnScroll) btnScroll.addEventListener('click', toggleAutoScroll);

        document.getElementById('filtro-setor').addEventListener('change', aplicarFiltros);
        document.getElementById('filtro-status').addEventListener('change', aplicarFiltros);
        document.getElementById('filtro-busca').addEventListener('input', aplicarFiltros);

        var tabBtns = document.querySelectorAll('.tab-btn');
        for (var i = 0; i < tabBtns.length; i++) {
            tabBtns[i].addEventListener('click', function () {
                ativarAba(this.getAttribute('data-tab'));
            });
        }

        var cols = document.querySelectorAll('th.col-sortable');
        for (var j = 0; j < cols.length; j++) {
            cols[j].addEventListener('click', function () {
                ordenarPorCampo(this.getAttribute('data-campo'));
            });
        }
    }

    // ── ABAS ─────────────────────────────────────────────────────────

    function ativarAba(tabId) {
        var btns = document.querySelectorAll('.tab-btn');
        var panels = document.querySelectorAll('.tab-panel');

        for (var i = 0; i < btns.length; i++) {
            btns[i].classList.remove('active');
        }
        for (var j = 0; j < panels.length; j++) {
            panels[j].classList.remove('active');
        }

        var btnAlvo = document.querySelector('[data-tab="' + tabId + '"]');
        var panelAlvo = document.getElementById('tab-' + tabId);

        if (btnAlvo) btnAlvo.classList.add('active');
        if (panelAlvo) panelAlvo.classList.add('active');

        atualizarEstatisticas();
    }

    function obterAbaAtiva() {
        var btn = document.querySelector('.tab-btn.active');
        return btn ? btn.getAttribute('data-tab') : 'leitos-ocupados';
    }

    // ── FILTROS ──────────────────────────────────────────────────────

    function limparFiltros() {
        document.getElementById('filtro-setor').value = '';
        document.getElementById('filtro-status').value = '';
        document.getElementById('filtro-busca').value = '';
        estado.filtros = { setor: '', status: '', busca: '' };
        aplicarFiltros();
    }

    function aplicarFiltros() {
        estado.filtros.setor  = document.getElementById('filtro-setor').value.toLowerCase();
        estado.filtros.status = document.getElementById('filtro-status').value;
        estado.filtros.busca  = document.getElementById('filtro-busca').value.toLowerCase();

        estado.filtrados.ocupados    = filtrarArray(estado.dados.ocupados, true);
        estado.filtrados.disponiveis = filtrarArray(estado.dados.disponiveis, false);
        estado.filtrados.todos       = filtrarArray(estado.dados.todos, false);

        if (estado.ordenacao.campo) {
            var aba = obterAbaAtiva();
            if (aba === 'leitos-ocupados')    ordenarArray(estado.filtrados.ocupados, estado.ordenacao.campo);
            else if (aba === 'leitos-disponiveis') ordenarArray(estado.filtrados.disponiveis, estado.ordenacao.campo);
            else                               ordenarArray(estado.filtrados.todos, estado.ordenacao.campo);
        }

        renderizarTabelaOcupados();
        renderizarTabelaDisponiveis();
        renderizarTabelaTodos();
        atualizarEstatisticas();
    }

    function filtrarArray(array, apenasOcupados) {
        return array.filter(function (item) {
            if (estado.filtros.setor && item.setor) {
                if (item.setor.toLowerCase().indexOf(estado.filtros.setor) === -1) return false;
            }
            if (!apenasOcupados && estado.filtros.status && item.status_leito) {
                if (item.status_leito !== estado.filtros.status) return false;
            }
            if (estado.filtros.busca) {
                var texto = [
                    item.paciente        || '',
                    item.leito           || '',
                    item.medico          || '',
                    item.convenio        || '',
                    item.clinica         || '',
                    item.classificacao   || ''
                ].join(' ').toLowerCase();
                if (texto.indexOf(estado.filtros.busca) === -1) return false;
            }
            return true;
        });
    }

    // ── CARREGAMENTO DE DADOS ────────────────────────────────────────

    var FETCH_OPTS = { credentials: 'same-origin' };

    function carregarDados() {
        return Promise.all([
            fetch(CONFIG.apiUrlOcupados,    FETCH_OPTS).then(function (r) { return r.json(); }),
            fetch(CONFIG.apiUrlDisponiveis, FETCH_OPTS).then(function (r) { return r.json(); }),
            fetch(CONFIG.apiUrlTodos,       FETCH_OPTS).then(function (r) { return r.json(); }),
            fetch(CONFIG.apiUrlSetores,     FETCH_OPTS).then(function (r) { return r.json(); })
        ])
        .then(function (res) {
            if (res[0].success) estado.dados.ocupados    = res[0].data;
            if (res[1].success) estado.dados.disponiveis = res[1].data;
            if (res[2].success) estado.dados.todos       = res[2].data;
            if (res[3].success) popularFiltroSetores(res[3].data);

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

        setores.sort(function (a, b) {
            return (a.nm_setor || '').localeCompare(b.nm_setor || '');
        }).forEach(function (setor) {
            var opt = document.createElement('option');
            opt.value = setor.nm_setor;
            opt.textContent = setor.nm_setor;
            select.appendChild(opt);
        });

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

    // ── BADGES E ESTATÍSTICAS ────────────────────────────────────────

    function atualizarBadges() {
        setText('badge-ocupados',    estado.dados.ocupados.length);
        setText('badge-disponiveis', estado.dados.disponiveis.length);
        setText('badge-todos',       estado.dados.todos.length);
    }

    function atualizarEstatisticas() {
        var aba = obterAbaAtiva();
        var total = 0, filtrado = 0;

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
                hour: '2-digit', minute: '2-digit', second: '2-digit'
            });
        }
    }

    // ── RENDERIZAÇÃO ─────────────────────────────────────────────────

    function renderizarTabelaOcupados() {
        var tbody = document.getElementById('tbody-ocupados');
        var dados = estado.filtrados.ocupados;

        if (dados.length === 0) {
            tbody.innerHTML = criarEstadoVazio(8, 'Nenhum leito ocupado encontrado',
                                                  'Ajuste os filtros ou limpe a busca');
            return;
        }

        tbody.innerHTML = dados.map(function (item) {
            var dias = parseInt(item.dias_internado) || 0;
            return (
                '<tr>' +
                    '<td class="td-icon">' + construirIconeGenero(item.sexo) + '</td>' +
                    '<td>' +
                        '<div class="paciente-nome">' + (item.paciente || '-') + '</div>' +
                        '<div class="paciente-sub"><i class="fas fa-calendar-days"></i> ' +
                            (item.idade ? item.idade + ' anos' : '-') +
                        '</div>' +
                    '</td>' +
                    '<td><span class="leito-code"><i class="fas fa-bed"></i> ' +
                        (item.leito || '-') + '</span></td>' +
                    '<td>' + (item.clinica || item.setor || '-') + '</td>' +
                    '<td><span class="medico-cell">' +
                        '<i class="fas fa-stethoscope icone-campo"></i>' +
                        (item.medico || '-') +
                    '</span></td>' +
                    '<td>' + construirBadgeDias(dias) + '</td>' +
                    '<td>' + (item.convenio || '-') + '</td>' +
                    '<td>' + construirBadgeClassificacao(item.classificacao) + '</td>' +
                '</tr>'
            );
        }).join('');
    }

    function renderizarTabelaDisponiveis() {
        var tbody = document.getElementById('tbody-disponiveis');
        var dados = estado.filtrados.disponiveis;

        if (dados.length === 0) {
            tbody.innerHTML = criarEstadoVazio(4, 'Nenhum leito disponível', 'Ajuste os filtros');
            return;
        }

        tbody.innerHTML = dados.map(function (item) {
            return (
                '<tr>' +
                    '<td><span class="leito-code"><i class="fas fa-bed"></i> ' +
                        (item.leito || '-') + '</span></td>' +
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
            return (
                '<tr>' +
                    '<td><span class="leito-code"><i class="fas fa-bed"></i> ' +
                        (item.leito || '-') + '</span></td>' +
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

    // ── CONSTRUTORES DE ÍCONES E BADGES ─────────────────────────────

    function construirIconeGenero(sexo) {
        if (sexo === 'M') {
            return '<span class="icone-genero icone-genero-m"><i class="fas fa-mars"></i></span>';
        }
        if (sexo === 'F') {
            return '<span class="icone-genero icone-genero-f"><i class="fas fa-venus"></i></span>';
        }
        return '<span class="icone-genero icone-genero-n"><i class="fas fa-user"></i></span>';
    }

    function construirBadgeDias(dias) {
        var n = parseInt(dias) || 0;
        var cls = n <= 3  ? 'badge-dias-ok'
                : n <= 7  ? 'badge-dias-aviso'
                : n <= 14 ? 'badge-dias-alerta'
                :            'badge-dias-critico';
        return '<span class="badge-dias ' + cls + '"><i class="fas fa-calendar-days"></i> ' +
               n + 'd</span>';
    }

    function construirBadgeClassificacao(classif) {
        if (!classif) return '<span class="badge-classif badge-classif-nd">-</span>';
        var c = (classif + '').toUpperCase();
        var cls = (c.indexOf('CR') === 0) ? 'badge-classif-critico'
                : (c === 'ALTO')          ? 'badge-classif-alto'
                : (c === 'MODERADO')      ? 'badge-classif-moderado'
                : (c === 'BAIXO')         ? 'badge-classif-baixo'
                :                           'badge-classif-nd';
        return '<span class="badge-classif ' + cls + '">' + classif + '</span>';
    }

    // ── FORMATAÇÃO ───────────────────────────────────────────────────

    function formatarStatusLeito(status, descricao) {
        var mapa = {
            'P': { cls: 'status-ocupado',      texto: 'Ocupado'      },
            'L': { cls: 'status-livre',         texto: 'Livre'        },
            'H': { cls: 'status-higienizacao',  texto: 'Higienização' },
            'I': { cls: 'status-interditado',   texto: 'Interditado'  }
        };
        var info = mapa[status] || { cls: '', texto: '' };
        var texto = descricao || info.texto || status || 'Desconhecido';
        return '<span class="badge-status ' + info.cls + '">' + texto + '</span>';
    }

    function criarEstadoVazio(colunas, titulo, subtitulo) {
        return (
            '<tr><td colspan="' + colunas + '" class="td-vazio">' +
                '<span class="vazio-icon"><i class="fas fa-inbox"></i></span>' +
                '<div class="vazio-msg">' + titulo + '</div>' +
                '<div class="vazio-sub">' + subtitulo + '</div>' +
            '</td></tr>'
        );
    }

    // ── ORDENAÇÃO ────────────────────────────────────────────────────

    function ordenarPorCampo(campo) {
        if (estado.ordenacao.campo === campo) {
            estado.ordenacao.direcao = estado.ordenacao.direcao === 'asc' ? 'desc' : 'asc';
        } else {
            estado.ordenacao.campo   = campo;
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
        var dir = estado.ordenacao.direcao;
        array.sort(function (a, b) {
            var va = a[campo] == null ? '' : a[campo];
            var vb = b[campo] == null ? '' : b[campo];
            if (typeof va === 'string') va = va.toLowerCase();
            if (typeof vb === 'string') vb = vb.toLowerCase();
            var r = va < vb ? -1 : va > vb ? 1 : 0;
            return dir === 'asc' ? r : -r;
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

    // ── AUTO-SCROLL ──────────────────────────────────────────────────

    function toggleAutoScroll() {
        if (estado.autoScroll.ativo) desativarAutoScroll();
        else ativarAutoScroll();
    }

    function ativarAutoScroll() {
        estado.autoScroll.ativo      = true;
        estado.autoScroll.emPausa    = false;
        estado.autoScroll.aguardando = false;

        var btn = document.getElementById('btn-auto-scroll');
        if (btn) {
            btn.style.background = 'rgba(255,255,255,0.35)';
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
            btn.style.background = '';
            btn.innerHTML = '<i class="fas fa-play"></i> <span class="btn-text">Auto Scroll</span>';
        }
    }

    function iniciarCicloScroll() {
        if (estado.autoScroll.intervalo) clearInterval(estado.autoScroll.intervalo);

        var lastScrollTop = -1;
        var frozenCount   = 0;

        estado.autoScroll.intervalo = setInterval(function () {
            if (!estado.autoScroll.ativo || estado.autoScroll.emPausa || estado.autoScroll.aguardando) return;

            var container = obterContainerAtivo();
            if (!container) return;

            var tbody = container.querySelector('tbody');
            if (!tbody) return;

            var linhas = tbody.getElementsByTagName('tr');
            if (!linhas || linhas.length === 0) return;
            if (linhas[0].querySelector('.td-vazio, .td-loading')) return;

            var scrollMax;
            if (linhas.length <= CONFIG.limiteLinhas) {
                scrollMax = container.scrollHeight - container.clientHeight;
            } else {
                var linhaLimite = linhas[CONFIG.limiteLinhas - 1];
                scrollMax = linhaLimite
                    ? linhaLimite.offsetTop + linhaLimite.offsetHeight - container.clientHeight + 50
                    : container.scrollHeight - container.clientHeight;
            }

            if (lastScrollTop === container.scrollTop && container.scrollTop > 0 && container.scrollTop < scrollMax - 10) {
                frozenCount++;
                if (frozenCount > 20) { container.scrollTop += 1; frozenCount = 0; }
            } else {
                frozenCount = 0;
            }
            lastScrollTop = container.scrollTop;

            if (container.scrollTop >= scrollMax - 10) {
                estado.autoScroll.emPausa = true;

                setTimeout(function () {
                    if (!estado.autoScroll.ativo) return;
                    container.scrollTop      = 0;
                    estado.autoScroll.aguardando = true;

                    setTimeout(function () {
                        if (estado.autoScroll.ativo) {
                            estado.autoScroll.aguardando = false;
                            estado.autoScroll.emPausa    = false;
                        }
                    }, CONFIG.pausaReinicio);

                }, CONFIG.pausaNoFinal);
                return;
            }

            container.scrollTop += CONFIG.velocidadeScroll;
        }, 50);
    }

    function obterContainerAtivo() {
        var mapa = {
            'leitos-ocupados':    'scroll-container-ocupados',
            'leitos-disponiveis': 'scroll-container-disponiveis',
            'todos-leitos':       'scroll-container-todos'
        };
        var id = mapa[obterAbaAtiva()];
        return id ? document.getElementById(id) : null;
    }

    // ── UTILITÁRIOS ──────────────────────────────────────────────────

    function setText(id, valor) {
        var el = document.getElementById(id);
        if (el) el.textContent = valor;
    }

    // ── START ────────────────────────────────────────────────────────

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', inicializar);
    } else {
        inicializar();
    }

})();
