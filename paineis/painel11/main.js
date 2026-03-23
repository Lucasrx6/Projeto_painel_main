/**
 * PAINEL 11 - Monitoramento de Alta do PS
 * Sistema de Paineis Hospitalares - Hospital Anchieta
 *
 * Funcionalidades:
 * - Listagem de pacientes com alta para internacao
 * - Multi-select: Status Internacao, Gestao Vagas, Clinica, Convenio
 * - KPIs refletem todos os filtros aplicados (construirParams compartilhado)
 * - Botao recolher/expandir filtros
 * - Auto-scroll com watchdog
 * - Persistencia via localStorage
 */

(function() {
    'use strict';

    // =========================================================
    // CONFIGURACAO
    // =========================================================

    var CONFIG = {
        api: {
            dashboard: '/api/paineis/painel11/dashboard',
            lista: '/api/paineis/painel11/lista',
            filtros: '/api/paineis/painel11/filtros'
        },
        intervaloRefresh: 60000,
        velocidadeScroll: 0.5,
        intervaloScroll: 50,
        pausaNoFinal: 10000,
        pausaAposReset: 10000,
        delayAutoScrollInicial: 10000,
        watchdogInterval: 5000,
        watchdogMaxTravamentos: 3,
        storagePrefix: 'painel11_',
        minutosAlerta: 120,
        minutosCritico: 240
    };

    // =========================================================
    // ESTADO
    // =========================================================

    var Estado = {
        dados: [],
        carregando: false,
        autoScrollAtivo: false,
        autoScrollIniciado: false,
        intervalos: { refresh: null, scroll: null, watchdog: null },
        timeouts: { autoScrollInicial: null },
        watchdog: { ultimaPosicao: 0, contadorTravamento: 0 },
        multiStatusInternacao: [],
        multiStatusGv: [],
        multiClinica: [],
        multiConvenio: [],
        filtrosRecolhidos: false,
        dropdownAberto: null
    };

    // =========================================================
    // CACHE DOM
    // =========================================================

    var DOM = {};

    function cachearElementos() {
        DOM.painelContent = document.getElementById('painel-content');
        DOM.statusIndicator = document.getElementById('status-indicator');
        DOM.ultimaAtualizacao = document.getElementById('ultima-atualizacao');

        // KPIs
        DOM.totalAltas = document.getElementById('total-altas');
        DOM.totalAguardando = document.getElementById('total-aguardando');
        DOM.totalChamados = document.getElementById('total-chamados');
        DOM.totalAprovados = document.getElementById('total-aprovados');
        DOM.totalInternados = document.getElementById('total-internados');
        DOM.totalCriticos = document.getElementById('total-criticos');
        DOM.tempoMedio = document.getElementById('tempo-medio');

        // Botoes
        DOM.btnVoltar = document.getElementById('btn-voltar');
        DOM.btnRefresh = document.getElementById('btn-refresh');
        DOM.btnAutoScroll = document.getElementById('btn-auto-scroll');
        DOM.btnLimpar = document.getElementById('btn-limpar');
        DOM.btnToggleFiltros = document.getElementById('btn-toggle-filtros');
        DOM.headerControls = document.getElementById('header-controls');
    }

    // =========================================================
    // UTILITARIOS
    // =========================================================

    function salvar(key, valor) {
        try { localStorage.setItem(CONFIG.storagePrefix + key, typeof valor === 'object' ? JSON.stringify(valor) : valor); } catch(e) {}
    }

    function recuperar(key) {
        try { return localStorage.getItem(CONFIG.storagePrefix + key); } catch(e) { return null; }
    }

    function recuperarArray(key) {
        try { var r = localStorage.getItem(CONFIG.storagePrefix + key); if (r) return JSON.parse(r); } catch(e) {} return [];
    }

    function atualizarStatus(s) {
        if (!DOM.statusIndicator) return;
        DOM.statusIndicator.className = 'status-indicator';
        if (s === 'online') { DOM.statusIndicator.classList.add('status-online'); DOM.statusIndicator.title = 'Conectado'; }
        else if (s === 'offline') { DOM.statusIndicator.classList.add('status-offline'); DOM.statusIndicator.title = 'Sem conexao'; }
        else if (s === 'loading') { DOM.statusIndicator.classList.add('status-loading'); DOM.statusIndicator.title = 'Carregando...'; }
    }

    function atualizarHorario() {
        if (!DOM.ultimaAtualizacao) return;
        DOM.ultimaAtualizacao.textContent = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    }

    // =========================================================
    // MULTI-SELECT GENERICO (padrao P24)
    // =========================================================

    function configurarToggleMultiSelects() {
        var triggers = document.querySelectorAll('.ms-trigger');
        for (var i = 0; i < triggers.length; i++) {
            (function(btn) {
                btn.addEventListener('click', function(e) {
                    e.stopPropagation();
                    var container = btn.closest('.multi-select-container');
                    var dd = container.querySelector('.multi-select-dropdown');
                    var isAberto = dd.classList.contains('aberto');
                    fecharTodosDropdowns();
                    if (!isAberto) {
                        dd.classList.add('aberto');
                        btn.setAttribute('aria-expanded', 'true');
                        btn.classList.add('aberto');
                        Estado.dropdownAberto = container.id;
                    }
                });
            })(triggers[i]);
        }
        document.addEventListener('click', function(e) {
            if (Estado.dropdownAberto) {
                var container = document.getElementById(Estado.dropdownAberto);
                if (container && !container.contains(e.target)) fecharTodosDropdowns();
            }
        });
    }

    function fecharTodosDropdowns() {
        var dds = document.querySelectorAll('.multi-select-dropdown.aberto');
        for (var i = 0; i < dds.length; i++) dds[i].classList.remove('aberto');
        var trs = document.querySelectorAll('.ms-trigger.aberto');
        for (var j = 0; j < trs.length; j++) {
            trs[j].classList.remove('aberto');
            trs[j].setAttribute('aria-expanded', 'false');
        }
        Estado.dropdownAberto = null;
    }

    function popularMultiSelectDinamico(containerId, opcoes) {
        var container = document.getElementById(containerId);
        if (!container) return;
        var optionsDiv = container.querySelector('.multi-select-options');
        if (!optionsDiv) return;
        optionsDiv.innerHTML = '';

        for (var i = 0; i < opcoes.length; i++) {
            var valor = opcoes[i].valor !== undefined ? opcoes[i].valor : opcoes[i];
            var texto = opcoes[i].texto !== undefined ? opcoes[i].texto : opcoes[i];

            var label = document.createElement('label');
            label.className = 'multi-select-item';
            var cb = document.createElement('input');
            cb.type = 'checkbox';
            cb.className = 'multi-select-checkbox';
            cb.value = String(valor);
            var span = document.createElement('span');
            span.className = 'multi-select-item-text';
            span.textContent = texto;
            label.appendChild(cb);
            label.appendChild(span);
            optionsDiv.appendChild(label);
        }

        vincularCheckboxesMultiSelect(containerId);
    }

    function vincularCheckboxesMultiSelect(containerId) {
        var container = document.getElementById(containerId);
        if (!container) return;
        var stateKey = container.getAttribute('data-state-key');

        // Clonar checkboxes para remover listeners antigos
        var checkboxes = container.querySelectorAll('.multi-select-checkbox');
        for (var i = 0; i < checkboxes.length; i++) {
            var oldCb = checkboxes[i];
            var newCb = oldCb.cloneNode(true);
            oldCb.parentNode.replaceChild(newCb, oldCb);
            newCb.addEventListener('change', function() {
                syncEstado(containerId);
                atualizarLabel(containerId);
                salvar(stateKey, Estado[stateKey]);
                carregarDados();
            });
        }

        // Botao Todos
        var btnAll = container.querySelector('.btn-ms-all');
        if (btnAll) {
            var na = btnAll.cloneNode(true);
            btnAll.parentNode.replaceChild(na, btnAll);
            na.addEventListener('click', function(e) {
                e.stopPropagation();
                var cbs = container.querySelectorAll('.multi-select-checkbox');
                for (var j = 0; j < cbs.length; j++) cbs[j].checked = true;
                syncEstado(containerId);
                atualizarLabel(containerId);
                salvar(stateKey, Estado[stateKey]);
                carregarDados();
            });
        }

        // Botao Limpar
        var btnNone = container.querySelector('.btn-ms-none');
        if (btnNone) {
            var nn = btnNone.cloneNode(true);
            btnNone.parentNode.replaceChild(nn, btnNone);
            nn.addEventListener('click', function(e) {
                e.stopPropagation();
                var cbs = container.querySelectorAll('.multi-select-checkbox');
                for (var j = 0; j < cbs.length; j++) cbs[j].checked = false;
                syncEstado(containerId);
                atualizarLabel(containerId);
                salvar(stateKey, Estado[stateKey]);
                carregarDados();
            });
        }

        // Restaurar estado salvo
        restaurarEstadoMultiSelect(containerId);
        atualizarLabel(containerId);
    }

    function syncEstado(containerId) {
        var container = document.getElementById(containerId);
        if (!container) return;
        var stateKey = container.getAttribute('data-state-key');
        var cbs = container.querySelectorAll('.multi-select-checkbox');
        var sel = [];
        for (var i = 0; i < cbs.length; i++) {
            var lbl = cbs[i].closest('.multi-select-item');
            if (cbs[i].checked) {
                sel.push(cbs[i].value);
                if (lbl) lbl.classList.add('selecionado');
            } else {
                if (lbl) lbl.classList.remove('selecionado');
            }
        }
        Estado[stateKey] = sel;
    }

    function restaurarEstadoMultiSelect(containerId) {
        var container = document.getElementById(containerId);
        if (!container) return;
        var stateKey = container.getAttribute('data-state-key');
        var salvos = recuperarArray(stateKey);
        if (!salvos || salvos.length === 0) return;
        Estado[stateKey] = salvos;
        var cbs = container.querySelectorAll('.multi-select-checkbox');
        for (var i = 0; i < cbs.length; i++) {
            if (salvos.indexOf(cbs[i].value) !== -1) {
                cbs[i].checked = true;
                var lbl = cbs[i].closest('.multi-select-item');
                if (lbl) lbl.classList.add('selecionado');
            }
        }
    }

    function atualizarLabel(containerId) {
        var container = document.getElementById(containerId);
        if (!container) return;
        var stateKey = container.getAttribute('data-state-key');
        var placeholder = container.getAttribute('data-placeholder');
        var labelEl = container.querySelector('.multi-select-label');
        if (!labelEl) return;
        var qtd = Estado[stateKey].length;
        var total = container.querySelectorAll('.multi-select-checkbox').length;
        if (qtd === 0 || qtd === total) {
            labelEl.textContent = placeholder;
        } else if (qtd === 1) {
            var cb = container.querySelector('.multi-select-checkbox:checked');
            var it = cb ? cb.closest('.multi-select-item').querySelector('.multi-select-item-text') : null;
            labelEl.textContent = it ? it.textContent : Estado[stateKey][0];
        } else {
            labelEl.textContent = qtd + ' selecionados';
        }
    }

    function resetarTodosMultiSelects() {
        var containers = document.querySelectorAll('.multi-select-container');
        for (var i = 0; i < containers.length; i++) {
            var stateKey = containers[i].getAttribute('data-state-key');
            var placeholder = containers[i].getAttribute('data-placeholder');
            Estado[stateKey] = [];
            salvar(stateKey, []);
            var cbs = containers[i].querySelectorAll('.multi-select-checkbox');
            for (var j = 0; j < cbs.length; j++) {
                cbs[j].checked = false;
                var lbl = cbs[j].closest('.multi-select-item');
                if (lbl) lbl.classList.remove('selecionado');
            }
            var labelEl = containers[i].querySelector('.multi-select-label');
            if (labelEl) labelEl.textContent = placeholder;
        }
    }

    // =========================================================
    // CONSTRUIR PARAMS (compartilhado entre dashboard e lista)
    // =========================================================

    function construirParams() {
        var params = [];

        if (Estado.multiStatusInternacao.length > 0) {
            params.push('status_internacao=' + encodeURIComponent(Estado.multiStatusInternacao.join(',')));
        }
        if (Estado.multiStatusGv.length > 0) {
            params.push('cd_status_gv=' + encodeURIComponent(Estado.multiStatusGv.join(',')));
        }
        if (Estado.multiClinica.length > 0) {
            params.push('ds_clinica=' + encodeURIComponent(Estado.multiClinica.join(',')));
        }
        if (Estado.multiConvenio.length > 0) {
            params.push('ds_convenio=' + encodeURIComponent(Estado.multiConvenio.join(',')));
        }

        return params;
    }

    function construirUrl() {
        var params = construirParams();
        return CONFIG.api.lista + (params.length > 0 ? '?' + params.join('&') : '');
    }

    function construirUrlDashboard() {
        var params = construirParams();
        return CONFIG.api.dashboard + (params.length > 0 ? '?' + params.join('&') : '');
    }

    // =========================================================
    // CARREGAR FILTROS DINAMICOS
    // =========================================================

    function carregarFiltrosDinamicos() {
        fetch(CONFIG.api.filtros, { credentials: 'include' })
            .then(function(r) { return r.json(); })
            .then(function(resp) {
                if (!resp.success) return;
                var d = resp.data;

                // Status Internacao (mapear para texto legivel)
                var mapaStatus = {
                    'AGUARDANDO_VAGA': 'Aguardando Vaga',
                    'CHAMADO': 'Transf. Externa',
                    'VAGA_APROVADA': 'Vaga Aprovada',
                    'ACOMODADO': 'Acomodado',
                    'INTERNADO': 'Internado',
                    'TRANSFERIDO': 'Transferido',
                    'CANCELADO_NEGADO': 'Cancelado/Negado',
                    'OUTROS': 'Outros'
                };
                var opcoesStatus = (d.status_internacao || []).map(function(item) {
                    return { valor: item, texto: mapaStatus[item] || item };
                });
                popularMultiSelectDinamico('ms-status-internacao', opcoesStatus);

                // Status Gestao Vagas (codigo + descricao)
                var opcoesGv = (d.status_gv || []).map(function(item) {
                    return { valor: item.codigo, texto: item.descricao || item.codigo };
                });
                popularMultiSelectDinamico('ms-status-gv', opcoesGv);

                // Clinicas
                popularMultiSelectDinamico('ms-clinica', d.clinicas || []);

                // Convenios
                popularMultiSelectDinamico('ms-convenio', d.convenios || []);
            })
            .catch(function(err) {
                console.error('[P11] Erro filtros:', err);
            });
    }

    // =========================================================
    // CARREGAR DADOS (DASHBOARD + LISTA)
    // =========================================================

    function carregarDados() {
        if (Estado.carregando) return;
        Estado.carregando = true;
        atualizarStatus('loading');

        var scrollEstaAtivo = Estado.autoScrollAtivo;
        if (scrollEstaAtivo) pararAutoScroll();

        Promise.all([
            fetch(construirUrl(), { credentials: 'include' }).then(function(r) { return r.json(); }),
            fetch(construirUrlDashboard(), { credentials: 'include' }).then(function(r) { return r.json(); })
        ]).then(function(resultados) {
            var listaData = resultados[0];
            var dashData = resultados[1];

            if (listaData.success) {
                Estado.dados = listaData.data || [];
                renderizarTabela(Estado.dados);
            } else {
                mostrarErro('Erro ao processar dados');
            }

            if (dashData.success) {
                atualizarDashboard(dashData.data);
            } else {
                console.warn('[P11] Dashboard retornou erro:', dashData.error || 'desconhecido');
            }

            atualizarHorario();
            atualizarStatus('online');

            // Reativar scroll se estava ativo
            if (scrollEstaAtivo) {
                setTimeout(function() {
                    Estado.autoScrollAtivo = true;
                    atualizarBotaoScroll();
                    iniciarAutoScroll();
                }, 500);
            }

            // Agendar auto-scroll na primeira carga
            if (!Estado.autoScrollIniciado && !scrollEstaAtivo) {
                agendarAutoScrollInicial();
            }
        }).catch(function(err) {
            console.error('[P11] Erro ao carregar dados:', err);
            atualizarStatus('offline');
            mostrarErro('Erro de conexao com o servidor');
        }).then(function() {
            Estado.carregando = false;
        });
    }

    // =========================================================
    // ATUALIZAR DASHBOARD (KPIs)
    // =========================================================

    function atualizarDashboard(d) {
        if (!d) return;

        // Animacao de atualizacao nos cards
        var cards = document.querySelectorAll('.resumo-card');
        for (var j = 0; j < cards.length; j++) {
            cards[j].classList.add('atualizando');
            (function(c) { setTimeout(function() { c.classList.remove('atualizando'); }, 300); })(cards[j]);
        }

        if (DOM.totalAltas) DOM.totalAltas.textContent = d.total_altas || 0;
        if (DOM.totalAguardando) DOM.totalAguardando.textContent = d.total_aguardando || 0;
        if (DOM.totalChamados) DOM.totalChamados.textContent = d.total_chamados || 0;
        if (DOM.totalAprovados) DOM.totalAprovados.textContent = d.total_aprovados || 0;
        if (DOM.totalInternados) DOM.totalInternados.textContent = d.total_internados || 0;
        if (DOM.totalCriticos) DOM.totalCriticos.textContent = d.total_criticos || 0;
        if (DOM.tempoMedio) DOM.tempoMedio.textContent = d.tempo_mediana_internacao || '-';
    }

    // =========================================================
    // RENDERIZAR TABELA
    // =========================================================

    function renderizarTabela(dados) {
        if (!DOM.painelContent) return;

        if (!dados || dados.length === 0) {
            DOM.painelContent.innerHTML = '<div class="empty-message">'
                + '<i class="fas fa-inbox"></i>'
                + '<h3>Nenhum paciente encontrado</h3>'
                + '<p>Nao ha pacientes com alta para internacao com os filtros aplicados</p>'
                + '</div>';
            return;
        }

        var html = '<div class="tabela-container">'
            + '<table class="painel-table">'
            + '<thead><tr>'
            + '<th>Atend PS</th>'
            + '<th>Paciente</th>'
            + '<th>Idade</th>'
            + '<th>Convenio</th>'
            + '<th>Clinica</th>'
            + '<th>Dt Alta</th>'
            + '<th>Tipo Vaga</th>'
            + '<th>Status</th>'
            + '<th>Tempo Espera</th>'
            + '<th>Atend Int</th>'
            + '<th>Dt Internacao</th>'
            + '</tr></thead>'
            + '<tbody id="tabela-body">';

        for (var i = 0; i < dados.length; i++) {
            html += criarLinha(dados[i]);
        }

        html += '</tbody></table></div>';
        DOM.painelContent.innerHTML = html;
    }

    function criarLinha(reg) {
        var nomeFormatado = formatarNome(reg.nm_pessoa_fisica);
        var convenioAbrev = abreviarTexto(reg.ds_convenio, 15);
        var clinicaAbrev = abreviarTexto(reg.ds_clinica, 14);
        var tipoVaga = extrairTipoVaga(reg.ds_necessidade_vaga);
        var tempoMinutos = reg.minutos_aguardando || 0;
        var classeLinha = determinarClasseLinha(tempoMinutos, tipoVaga, reg.status_internacao);
        var idadeStr = reg.qt_idade ? reg.qt_idade + 'a' : '-';

        return '<tr class="' + classeLinha + '">'
            + '<td><strong>' + (reg.nr_atendimento || '-') + '</strong></td>'
            + '<td title="' + escapeAttr(reg.nm_pessoa_fisica) + '">' + nomeFormatado + '</td>'
            + '<td>' + idadeStr + '</td>'
            + '<td title="' + escapeAttr(reg.ds_convenio) + '">' + convenioAbrev + '</td>'
            + '<td title="' + escapeAttr(reg.ds_clinica) + '">' + clinicaAbrev + '</td>'
            + '<td>' + formatarDataHora(reg.dt_alta) + '</td>'
            + '<td>' + getBadgeTipoVaga(tipoVaga) + '</td>'
            + '<td>' + getBadgeStatusUnificado(reg.status_internacao, reg.cd_status_gv, reg.ds_status_gv) + '</td>'
            + '<td>' + getBadgeTempoEspera(tempoMinutos, reg.status_internacao, reg.dt_alta, reg.dt_internacao) + '</td>'
            + '<td>' + (reg.nr_atendimento_internado || '-') + '</td>'
            + '<td>' + formatarDataHora(reg.dt_internacao) + '</td>'
            + '</tr>';
    }

    // =========================================================
    // FUNCOES AUXILIARES
    // =========================================================

    function escapeAttr(t) {
        if (!t) return '';
        return String(t).replace(/"/g, '&quot;').replace(/</g, '&lt;');
    }

    function formatarNome(nomeCompleto) {
        if (!nomeCompleto || nomeCompleto.trim() === '') return '-';
        var partes = nomeCompleto.trim().toUpperCase().split(/\s+/);
        if (partes.length === 1) return partes[0];
        var iniciais = [];
        for (var i = 0; i < partes.length - 1; i++) {
            iniciais.push(partes[i].charAt(0));
        }
        return iniciais.join(' ') + ' ' + partes[partes.length - 1];
    }

    function abreviarTexto(texto, max) {
        if (!texto) return '-';
        return texto.length > max ? texto.substring(0, max) + '...' : texto;
    }

    function extrairTipoVaga(necessidade) {
        if (!necessidade) return 'CLINICA';
        var t = necessidade.toUpperCase();
        if (t.indexOf('UTI') !== -1) return 'UTI';
        if (t.indexOf('CIRURGICA') !== -1 || t.indexOf('CIRURGICA') !== -1) return 'CIRURGICA';
        return 'CLINICA';
    }

    function determinarClasseLinha(tempoMinutos, tipoVaga, status) {
        var statusFinais = ['INTERNADO', 'ACOMODADO', 'TRANSFERIDO', 'CANCELADO_NEGADO'];
        if (statusFinais.indexOf(status) !== -1) return '';
        if (tipoVaga === 'UTI') return 'vaga-uti';
        if (tempoMinutos >= CONFIG.minutosCritico) return 'alerta-critico';
        if (tempoMinutos >= CONFIG.minutosAlerta) return 'alerta-medio';
        return '';
    }

    function formatarDataHora(dataHora) {
        if (!dataHora) return '-';
        try {
            var d = new Date(dataHora);
            if (isNaN(d.getTime())) return dataHora;
            return ('0' + d.getDate()).slice(-2) + '/' + ('0' + (d.getMonth() + 1)).slice(-2)
                + ' ' + ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2);
        } catch(e) { return dataHora; }
    }

    function formatarTempoEspera(minutos) {
        if (!minutos || minutos <= 0) return '-';
        var h = Math.floor(minutos / 60);
        var m = Math.floor(minutos % 60);
        return h > 0 ? h + 'h ' + m + 'm' : m + 'm';
    }

    // =========================================================
    // BADGES
    // =========================================================

    function getBadgeTipoVaga(tipo) {
        var mapa = {
            'UTI':       '<span class="tipo-vaga vaga-uti"><i class="fas fa-heartbeat"></i> UTI</span>',
            'CIRURGICA': '<span class="tipo-vaga vaga-cirurgica"><i class="fas fa-cut"></i> Cirurgica</span>',
            'CLINICA':   '<span class="tipo-vaga vaga-clinica"><i class="fas fa-hospital"></i> Clinica</span>'
        };
        return mapa[tipo] || mapa['CLINICA'];
    }

    function getBadgeStatusUnificado(statusInternacao, cdStatusGv, dsStatusGv) {
        // Internado -> mostrar apenas "Internado"
        if (statusInternacao === 'INTERNADO') {
            return '<span class="badge badge-internado"><i class="fas fa-check-circle"></i> Internado</span>';
        }

        // Nao internado -> priorizar Gestao de Vagas se existir
        if (cdStatusGv) {
            var mapaGv = {
                'A': { classe: 'badge-aguardando', icone: 'fa-hourglass-half', texto: 'Aguardando' },
                'I': { classe: 'badge-chamado',    icone: 'fa-search',         texto: 'Ag. Analise' },
                'H': { classe: 'badge-transf-ext', icone: 'fa-ambulance',      texto: 'Transf. Ext.' },
                'O': { classe: 'badge-aprovada',   icone: 'fa-handshake',      texto: 'Aceito' },
                'P': { classe: 'badge-aprovada',   icone: 'fa-thumbs-up',      texto: 'Aprovada' },
                'F': { classe: 'badge-acomodado',  icone: 'fa-bed',            texto: 'Acomodado' },
                'T': { classe: 'badge-transferido', icone: 'fa-exchange-alt',  texto: 'Transferido' },
                'N': { classe: 'badge-cancelado',  icone: 'fa-times-circle',   texto: 'Negada' },
                'D': { classe: 'badge-cancelado',  icone: 'fa-user-slash',     texto: 'Desistiu' },
                'C': { classe: 'badge-cancelado',  icone: 'fa-ban',            texto: 'Cancelada' }
            };

            var info = mapaGv[cdStatusGv];
            if (info) {
                return '<span class="badge ' + info.classe + '"><i class="fas ' + info.icone + '"></i> ' + info.texto + '</span>';
            }

            // Codigo GV desconhecido - mostrar descricao
            return '<span class="badge badge-outros"><i class="fas fa-question-circle"></i> ' + (dsStatusGv || cdStatusGv) + '</span>';
        }

        // Sem gestao de vagas -> fallback pelo status_internacao
        var mapaFallback = {
            'AGUARDANDO_VAGA': '<span class="badge badge-aguardando"><i class="fas fa-hourglass-half"></i> Aguardando</span>',
            'CHAMADO':         '<span class="badge badge-transf-ext"><i class="fas fa-ambulance"></i> Transf. Ext.</span>',
            'VAGA_APROVADA':   '<span class="badge badge-aprovada"><i class="fas fa-thumbs-up"></i> Aprovada</span>',
            'ACOMODADO':       '<span class="badge badge-acomodado"><i class="fas fa-bed"></i> Acomodado</span>',
            'TRANSFERIDO':     '<span class="badge badge-transferido"><i class="fas fa-exchange-alt"></i> Transferido</span>',
            'CANCELADO_NEGADO':'<span class="badge badge-cancelado"><i class="fas fa-ban"></i> Cancelado</span>',
            'OUTROS':          '<span class="badge badge-outros"><i class="fas fa-question-circle"></i> Outros</span>'
        };
        return mapaFallback[statusInternacao] || mapaFallback['OUTROS'] || '-';
    }

    function getBadgeTempoEspera(minutos, status, dtAlta, dtInternacao) {
        // Internado -> calcular tempo entre solicitacao (dt_alta) e internacao (dt_internacao)
        if (status === 'INTERNADO' && dtAlta && dtInternacao) {
            try {
                var alta = new Date(dtAlta);
                var inter = new Date(dtInternacao);
                if (!isNaN(alta.getTime()) && !isNaN(inter.getTime())) {
                    var diffMin = Math.floor((inter - alta) / 1000 / 60);
                    if (diffMin >= 0) {
                        var h = Math.floor(diffMin / 60);
                        var m = diffMin % 60;
                        var tempoStr = h + 'h ' + m + 'm';
                        return '<span class="badge-tempo tempo-internado"><i class="fas fa-check"></i> ' + tempoStr + '</span>';
                    }
                }
            } catch(e) {}
            return '<span class="texto-neutro">-</span>';
        }

        // Status ativos -> tempo em tempo real (minutos_aguardando)
        var statusAtivos = ['AGUARDANDO_VAGA', 'CHAMADO', 'VAGA_APROVADA'];
        if (statusAtivos.indexOf(status) === -1) {
            return '<span class="texto-neutro">-</span>';
        }
        if (!minutos || minutos <= 0) {
            return '<span class="texto-neutro">-</span>';
        }
        var tempoFormatado = formatarTempoEspera(minutos);
        var classe = 'tempo-normal';
        var icone = 'fa-clock';
        if (minutos >= CONFIG.minutosCritico) {
            classe = 'tempo-critico';
            icone = 'fa-exclamation-triangle';
        } else if (minutos >= CONFIG.minutosAlerta) {
            classe = 'tempo-alerta';
            icone = 'fa-clock';
        }
        return '<span class="badge-tempo ' + classe + '"><i class="fas ' + icone + '"></i> ' + tempoFormatado + '</span>';
    }

    // =========================================================
    // AUTO-SCROLL COM WATCHDOG
    // =========================================================

    function getElementoScroll() { return document.getElementById('tabela-body'); }

    function iniciarAutoScroll() {
        pararScrollInterno();
        var el = getElementoScroll();
        if (!el) return;
        if (el.scrollHeight - el.clientHeight <= 5) return;

        Estado.watchdog = { ultimaPosicao: el.scrollTop, contadorTravamento: 0 };
        iniciarWatchdog();

        Estado.intervalos.scroll = setInterval(function() {
            if (!Estado.autoScrollAtivo) { pararAutoScroll(); return; }
            var e = getElementoScroll();
            if (!e) { pararAutoScroll(); return; }
            var sm = e.scrollHeight - e.clientHeight;

            if (e.scrollTop >= sm - 2) {
                clearInterval(Estado.intervalos.scroll);
                Estado.intervalos.scroll = null;
                setTimeout(function() {
                    if (!Estado.autoScrollAtivo) return;
                    e.scrollTop = 0;
                    Estado.watchdog.ultimaPosicao = 0;
                    Estado.watchdog.contadorTravamento = 0;
                    setTimeout(function() {
                        if (Estado.autoScrollAtivo) iniciarAutoScroll();
                    }, CONFIG.pausaAposReset);
                }, CONFIG.pausaNoFinal);
                return;
            }
            e.scrollTop += CONFIG.velocidadeScroll;
        }, CONFIG.intervaloScroll);
    }

    function pararScrollInterno() {
        if (Estado.intervalos.scroll) {
            clearInterval(Estado.intervalos.scroll);
            Estado.intervalos.scroll = null;
        }
        pararWatchdog();
    }

    function pararAutoScroll() {
        pararScrollInterno();
    }

    function iniciarWatchdog() {
        pararWatchdog();
        Estado.intervalos.watchdog = setInterval(function() {
            if (!Estado.autoScrollAtivo) { pararWatchdog(); return; }
            var e = getElementoScroll();
            if (!e) return;
            var p = e.scrollTop;
            var sm = e.scrollHeight - e.clientHeight;
            if (p > 5 && p < sm - 5 && Math.abs(p - Estado.watchdog.ultimaPosicao) < 1 && Estado.intervalos.scroll !== null) {
                Estado.watchdog.contadorTravamento++;
                if (Estado.watchdog.contadorTravamento >= CONFIG.watchdogMaxTravamentos) {
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
            Estado.watchdog.ultimaPosicao = p;
        }, CONFIG.watchdogInterval);
    }

    function pararWatchdog() {
        if (Estado.intervalos.watchdog) {
            clearInterval(Estado.intervalos.watchdog);
            Estado.intervalos.watchdog = null;
        }
    }

    function atualizarBotaoScroll() {
        if (!DOM.btnAutoScroll) return;
        if (Estado.autoScrollAtivo) {
            DOM.btnAutoScroll.classList.add('ativo');
            DOM.btnAutoScroll.innerHTML = '<i class="fas fa-pause"></i><span class="btn-text">Pausar</span>';
        } else {
            DOM.btnAutoScroll.classList.remove('ativo');
            DOM.btnAutoScroll.innerHTML = '<i class="fas fa-play"></i><span class="btn-text">Auto Scroll</span>';
        }
    }

    function agendarAutoScrollInicial() {
        if (Estado.timeouts.autoScrollInicial) clearTimeout(Estado.timeouts.autoScrollInicial);
        Estado.timeouts.autoScrollInicial = setTimeout(function() {
            if (!Estado.autoScrollAtivo && Estado.dados.length > 0) {
                Estado.autoScrollAtivo = true;
                Estado.autoScrollIniciado = true;
                atualizarBotaoScroll();
                iniciarAutoScroll();
            }
        }, CONFIG.delayAutoScrollInicial);
    }

    // =========================================================
    // TOGGLE FILTROS (RECOLHER/EXPANDIR)
    // =========================================================

    function toggleFiltros() {
        Estado.filtrosRecolhidos = !Estado.filtrosRecolhidos;
        if (DOM.headerControls) DOM.headerControls.classList.toggle('recolhido', Estado.filtrosRecolhidos);
        if (DOM.btnToggleFiltros) DOM.btnToggleFiltros.classList.toggle('recolhido', Estado.filtrosRecolhidos);
        salvar('filtrosRecolhidos', Estado.filtrosRecolhidos ? '1' : '0');
    }

    // =========================================================
    // ERRO
    // =========================================================

    function mostrarErro(msg) {
        if (!DOM.painelContent) return;
        DOM.painelContent.innerHTML = '<div class="empty-message">'
            + '<i class="fas fa-exclamation-triangle" style="color: #dc3545;"></i>'
            + '<h3>Erro ao Carregar Dados</h3>'
            + '<p>' + msg + '</p>'
            + '<button class="btn-header" onclick="location.reload()" style="margin-top:15px;background:#dc3545;border-color:#dc3545;">'
            + '<i class="fas fa-sync-alt"></i> Tentar Novamente</button>'
            + '</div>';
    }

    // =========================================================
    // EVENTOS
    // =========================================================

    function configurarEventos() {
        configurarToggleMultiSelects();

        // Toggle filtros
        if (DOM.btnToggleFiltros) DOM.btnToggleFiltros.addEventListener('click', toggleFiltros);

        // Limpar filtros
        if (DOM.btnLimpar) {
            DOM.btnLimpar.addEventListener('click', function() {
                resetarTodosMultiSelects();
                carregarDados();
            });
        }

        // Voltar
        if (DOM.btnVoltar) DOM.btnVoltar.addEventListener('click', function() { window.location.href = '/frontend/dashboard.html'; });

        // Refresh
        if (DOM.btnRefresh) {
            DOM.btnRefresh.addEventListener('click', function() {
                DOM.btnRefresh.classList.add('girando');
                carregarDados();
                setTimeout(function() { DOM.btnRefresh.classList.remove('girando'); }, 500);
            });
        }

        // Auto-scroll
        if (DOM.btnAutoScroll) {
            DOM.btnAutoScroll.addEventListener('click', function() {
                Estado.autoScrollAtivo = !Estado.autoScrollAtivo;
                Estado.autoScrollIniciado = true;
                atualizarBotaoScroll();
                if (Estado.autoScrollAtivo) iniciarAutoScroll();
                else pararAutoScroll();
            });
        }

        // Teclado
        document.addEventListener('keydown', function(e) {
            if (e.key === 'Escape') {
                if (Estado.dropdownAberto) fecharTodosDropdowns();
                else if (Estado.autoScrollAtivo) { Estado.autoScrollAtivo = false; atualizarBotaoScroll(); pararAutoScroll(); }
            }
            if (e.key === 'F5') { e.preventDefault(); carregarDados(); }
            if (e.key === ' ' && e.target === document.body) {
                e.preventDefault();
                Estado.autoScrollAtivo = !Estado.autoScrollAtivo;
                Estado.autoScrollIniciado = true;
                atualizarBotaoScroll();
                if (Estado.autoScrollAtivo) iniciarAutoScroll();
                else pararAutoScroll();
            }
        });

        // Visibilidade
        document.addEventListener('visibilitychange', function() {
            if (document.hidden) {
                if (Estado.autoScrollAtivo) { pararAutoScroll(); Estado.autoScrollAtivo = true; }
            } else {
                if (Estado.autoScrollAtivo) iniciarAutoScroll();
                carregarDados();
            }
        });
    }

    // =========================================================
    // INICIALIZACAO
    // =========================================================

    function inicializar() {
        cachearElementos();

        // Restaurar filtros recolhidos
        Estado.filtrosRecolhidos = recuperar('filtrosRecolhidos') === '1';
        if (Estado.filtrosRecolhidos) {
            if (DOM.headerControls) DOM.headerControls.classList.add('recolhido');
            if (DOM.btnToggleFiltros) DOM.btnToggleFiltros.classList.add('recolhido');
        }

        // Restaurar arrays de filtros do localStorage ANTES do primeiro carregarDados
        Estado.multiStatusInternacao = recuperarArray('multiStatusInternacao');
        Estado.multiStatusGv = recuperarArray('multiStatusGv');
        Estado.multiClinica = recuperarArray('multiClinica');
        Estado.multiConvenio = recuperarArray('multiConvenio');

        configurarEventos();
        carregarFiltrosDinamicos();
        carregarDados();

        // Auto-refresh
        Estado.intervalos.refresh = setInterval(function() { carregarDados(); }, CONFIG.intervaloRefresh);
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', inicializar);
    else inicializar();

})();