var PAINEL_VERSAO = '1.1.39';
(function () {
    'use strict';

    var CONFIG = {
        apiBase: '/api/paineis/painel41',
        refreshInterval: 30000,
        minCharsSearch: 3,
        debounceMs: 400
    };

    var Estado = {
        paciente: null,
        tipos: [],
        refeicoes: [],
        restricoes: [],
        setores: [],
        minhasSolicitacoes: [],
        urgente: false,
        enviando: false,
        buscando: false,
        _debounceTimer: null,
        _debounceHistTimer: null,
        buscaHist: '',
        filtroRefeicao41: '',
        listaFiltrada: []
    };

    var DOM = {};

    // =========================================================
    // ESCAPE HTML
    // =========================================================
    function escHtml(s) {
        return String(s || '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    // =========================================================
    // BADGES DE STATUS
    // =========================================================
    var STATUS_CONFIG = {
        'aguardando':  { label: 'Aguardando',  cor: '#6C757D' },
        'aceito':      { label: 'Aceito',       cor: '#17A2B8' },
        'em_preparo':  { label: 'Em Preparo',   cor: '#E67E00' },
        'pronto':      { label: 'Pronto',       cor: '#8BC34A' },
        'em_entrega':  { label: 'Em Entrega',   cor: '#6F42C1' },
        'entregue':    { label: 'Entregue',     cor: '#28A745' },
        'cancelado':   { label: 'Cancelado',    cor: '#DC3545' }
    };

    function badgeStatus(status) {
        var cfg = STATUS_CONFIG[status] || { label: status, cor: '#6C757D' };
        return '<span class="badge-status" style="background:' + cfg.cor + ';">' +
               escHtml(cfg.label) + '</span>';
    }

    // =========================================================
    // DEBOUNCE
    // =========================================================
    function debounce(fn, ms) {
        var timer = null;
        return function () {
            var args = arguments;
            clearTimeout(timer);
            timer = setTimeout(function () { fn.apply(null, args); }, ms);
        };
    }

    // =========================================================
    // INICIALIZAR
    // =========================================================
    function inicializar() {
        var btnVoltar = document.getElementById('btn-voltar-hub');
        if (btnVoltar) {
            btnVoltar.addEventListener('click', function () { window.location.href = '/painel/painel44'; });
        }

        DOM.inputBusca       = document.getElementById('input-busca');
        DOM.spinnerBusca     = document.getElementById('spinner-busca');
        DOM.listaPacientes   = document.getElementById('lista-pacientes');
        DOM.linkManualWrapper= document.getElementById('link-manual-wrapper');
        DOM.btnAbrirManual   = document.getElementById('btn-abrir-manual');
        DOM.formManual       = document.getElementById('form-manual');
        DOM.manualNome       = document.getElementById('manual-nome');
        DOM.manualAtend      = document.getElementById('manual-atendimento');
        DOM.manualLeito      = document.getElementById('manual-leito');
        DOM.manualSetor      = document.getElementById('manual-setor');
        DOM.manualErro       = document.getElementById('manual-erro');
        DOM.btnManualConf    = document.getElementById('btn-manual-confirmar');
        DOM.btnManualCanc    = document.getElementById('btn-manual-cancelar');
        DOM.cardPaciente     = document.getElementById('card-paciente');
        DOM.pacNome          = document.getElementById('pac-nome-texto');
        DOM.pacLeito         = document.getElementById('pac-leito');
        DOM.pacSetor         = document.getElementById('pac-setor');
        DOM.pacClinica       = document.getElementById('pac-clinica');
        DOM.pacDias          = document.getElementById('pac-dias');
        DOM.pacNasc          = document.getElementById('pac-nasc');
        DOM.cardInfoNasc     = document.getElementById('card-info-nasc');
        DOM.manualNasc       = document.getElementById('manual-nasc');
        DOM.badgeManual      = document.getElementById('badge-manual');
        DOM.cardInfoExtra    = document.getElementById('card-info-extra');
        DOM.btnLimpar        = document.getElementById('btn-limpar-paciente');
        DOM.avisoSelecione   = document.getElementById('aviso-selecione');
        DOM.formSolicitar    = document.getElementById('form-solicitar');
        DOM.selTipoDieta     = document.getElementById('sel-tipo-dieta');
        DOM.selRefeicao      = document.getElementById('sel-refeicao');
        DOM.listaRestricoes  = document.getElementById('lista-restricoes');
        DOM.inpObs           = document.getElementById('inp-obs');
        DOM.erroForm         = document.getElementById('erro-form');
        DOM.btnSolicitar     = document.getElementById('btn-solicitar');
        DOM.btnUrgente       = document.getElementById('btn-urgente');
        DOM.headerStatus     = document.getElementById('header-status');
        DOM.tbodyMinhas      = document.getElementById('tbody-minhas');
        DOM.tabelaMinhas     = document.getElementById('tabela-minhas');
        DOM.tabelaEmpty      = document.getElementById('tabela-minhas-empty');
        DOM.badgeTotal       = document.getElementById('badge-total');
        DOM.filtroSetor41    = document.getElementById('filtro-setor-41');
        DOM.filtroRefeicao41  = document.getElementById('filtro-refeicao-41');
        DOM.buscaHist41       = document.getElementById('busca-hist-41');
        DOM.btnExportarPdf41  = document.getElementById('btn-exportar-pdf-41');
        DOM.modalSucesso     = document.getElementById('modal-sucesso');
        DOM.modalCodigo      = document.getElementById('modal-codigo');
        DOM.btnModalOk       = document.getElementById('btn-modal-ok');
        DOM.modalCancelar    = document.getElementById('modal-cancelar');
        DOM.modalCancId      = document.getElementById('modal-canc-id');
        DOM.modalCancMotivo  = document.getElementById('modal-canc-motivo');
        DOM.modalCancErro    = document.getElementById('modal-canc-erro');
        DOM.btnCancConfirmar = document.getElementById('btn-canc-confirmar');
        DOM.btnCancFechar    = document.getElementById('btn-canc-fechar');

        // Eventos
        DOM.inputBusca.addEventListener('input', debounce(buscarPaciente, CONFIG.debounceMs));
        DOM.btnLimpar.addEventListener('click', limparPaciente);
        DOM.btnAbrirManual.addEventListener('click', abrirFormManual);
        DOM.btnManualCanc.addEventListener('click', fecharFormManual);
        DOM.btnManualConf.addEventListener('click', confirmarManual);
        DOM.btnUrgente.addEventListener('click', toggleUrgente);
        DOM.formSolicitar.addEventListener('submit', submeterSolicitacao);
        DOM.btnModalOk.addEventListener('click', fecharModalSucesso);
        DOM.btnCancFechar.addEventListener('click', fecharModalCancelar);
        DOM.btnCancConfirmar.addEventListener('click', confirmarCancelamento);
        if (DOM.btnExportarPdf41) DOM.btnExportarPdf41.addEventListener('click', exportarPDF);
        if (DOM.filtroSetor41)    DOM.filtroSetor41.addEventListener('change', renderMinhasSolicitacoes);
        if (DOM.filtroRefeicao41) DOM.filtroRefeicao41.addEventListener('change', function () {
            Estado.filtroRefeicao41 = DOM.filtroRefeicao41.value;
            renderMinhasSolicitacoes();
        });
        if (DOM.buscaHist41) DOM.buscaHist41.addEventListener('input', function () {
            clearTimeout(Estado._debounceHistTimer);
            var val = DOM.buscaHist41.value;
            Estado._debounceHistTimer = setTimeout(function () {
                Estado.buscaHist = val.trim().toLowerCase();
                renderMinhasSolicitacoes();
            }, 300);
        });

        // Fechar modais clicando no overlay
        DOM.modalSucesso.addEventListener('click', function (e) {
            if (e.target === DOM.modalSucesso) fecharModalSucesso();
        });
        DOM.modalCancelar.addEventListener('click', function (e) {
            if (e.target === DOM.modalCancelar) fecharModalCancelar();
        });

        carregarConfiguracoes();
        carregarMinhasSolicitacoes();
        setInterval(carregarMinhasSolicitacoes, CONFIG.refreshInterval);
    }

    // =========================================================
    // CARREGAR CONFIGURAÇÕES
    // =========================================================
    function carregarConfiguracoes() {
        fetch(CONFIG.apiBase + '/tipos-dieta', { credentials: 'same-origin' })
            .then(function (r) { return r.json(); })
            .then(function (data) {
                if (data.success) {
                    Estado.tipos = data.tipos;
                    renderSelectTipos();
                }
            })
            .catch(function (e) { console.error('tipos-dieta', e); });

        fetch(CONFIG.apiBase + '/refeicoes', { credentials: 'same-origin' })
            .then(function (r) { return r.json(); })
            .then(function (data) {
                if (data.success) {
                    Estado.refeicoes = data.refeicoes;
                    renderSelectRefeicoes();
                }
            })
            .catch(function (e) { console.error('refeicoes', e); });

        fetch(CONFIG.apiBase + '/restricoes', { credentials: 'same-origin' })
            .then(function (r) { return r.json(); })
            .then(function (data) {
                if (data.success) {
                    Estado.restricoes = data.restricoes;
                    renderRestricoes();
                }
            })
            .catch(function (e) { console.error('restricoes', e); });

        fetch(CONFIG.apiBase + '/setores', { credentials: 'same-origin' })
            .then(function (r) { return r.json(); })
            .then(function (data) {
                if (data.success) {
                    Estado.setores = data.setores;
                    renderSelectSetores();
                }
            })
            .catch(function (e) { console.error('setores', e); });
    }

    function renderSelectTipos() {
        var html = '<option value="">Selecione o tipo de dieta...</option>';
        for (var i = 0; i < Estado.tipos.length; i++) {
            var t = Estado.tipos[i];
            html += '<option value="' + t.id + '">' + escHtml(t.nome) + '</option>';
        }
        DOM.selTipoDieta.innerHTML = html;
    }

    function renderSelectRefeicoes() {
        var html = '<option value="">Selecione a refeição...</option>';
        for (var i = 0; i < Estado.refeicoes.length; i++) {
            var r = Estado.refeicoes[i];
            var horario = r.horario_inicio ? ' (' + r.horario_inicio + ')' : '';
            html += '<option value="' + r.id + '">' + escHtml(r.nome) + escHtml(horario) + '</option>';
        }
        DOM.selRefeicao.innerHTML = html;
    }

    function renderSelectSetores() {
        var html = '<option value="">Selecione o setor...</option>';
        for (var i = 0; i < Estado.setores.length; i++) {
            var nome = Estado.setores[i].nome;
            html += '<option value="' + escHtml(nome) + '">' + escHtml(nome) + '</option>';
        }
        DOM.manualSetor.innerHTML = html;
    }

    function renderRestricoes() {
        if (!Estado.restricoes.length) {
            DOM.listaRestricoes.innerHTML = '<span class="carregando-txt">Nenhuma restrição cadastrada.</span>';
            return;
        }
        var html = '';
        for (var i = 0; i < Estado.restricoes.length; i++) {
            var r = Estado.restricoes[i];
            html += '<label class="restricao-check">' +
                '<input type="checkbox" class="chk-restricao" value="' + r.id +
                '" data-nome="' + escHtml(r.nome) + '">' +
                '<span class="restricao-sigla" style="color:' + escHtml(r.cor) + ';">' +
                    escHtml(r.sigla || '') +
                '</span>' +
                ' ' + escHtml(r.nome) +
                '</label>';
        }
        DOM.listaRestricoes.innerHTML = html;
    }

    // =========================================================
    // BUSCA DE PACIENTE
    // =========================================================
    var _buscaGen = 0;

    function buscarPaciente() {
        var q = DOM.inputBusca.value.trim();
        if (q.length < CONFIG.minCharsSearch) {
            DOM.listaPacientes.innerHTML = '';
            DOM.spinnerBusca.style.display = 'none';
            return;
        }
        _buscaGen++;
        var gen = _buscaGen;
        DOM.spinnerBusca.style.display = 'inline-block';

        fetch(CONFIG.apiBase + '/pacientes?q=' + encodeURIComponent(q), { credentials: 'same-origin' })
            .then(function (r) { return r.json(); })
            .then(function (data) {
                if (gen !== _buscaGen) return;
                DOM.spinnerBusca.style.display = 'none';
                renderListaPacientes(data.pacientes || []);
            })
            .catch(function (e) {
                if (gen !== _buscaGen) return;
                DOM.spinnerBusca.style.display = 'none';
                console.error('busca pacientes', e);
            });
    }

    function renderListaPacientes(lista) {
        if (!lista.length) {
            DOM.listaPacientes.innerHTML =
                '<div class="pac-nenhum">' +
                    '<i class="fas fa-circle-xmark pac-nenhum-icon"></i>' +
                    '<span>Nenhum paciente encontrado para esta busca.</span>' +
                    '<span class="pac-nenhum-dica">Use o botão abaixo para informar manualmente.</span>' +
                '</div>';
            return;
        }
        var html = '';
        for (var i = 0; i < lista.length; i++) {
            var p = lista[i];
            html += '<div class="pac-item" data-idx="' + i + '">' +
                '<div class="pac-item-nome">' + escHtml(p.nm_paciente) + '</div>' +
                '<div class="pac-item-info">' +
                    '<span><i class="fa-solid fa-bed"></i> ' + escHtml(p.leito || '--') + '</span>' +
                    '<span><i class="fa-solid fa-hospital"></i> ' + escHtml(p.setor_nome || '--') + '</span>' +
                '</div>' +
            '</div>';
        }
        DOM.listaPacientes.innerHTML = html;

        var items = DOM.listaPacientes.querySelectorAll('.pac-item');
        for (var j = 0; j < items.length; j++) {
            (function (idx) {
                items[idx].addEventListener('click', function () {
                    selecionarPaciente(lista[idx]);
                });
            })(j);
        }
    }

    function abrirFormManual() {
        DOM.formManual.style.display        = 'block';
        DOM.linkManualWrapper.style.display = 'none';
        DOM.listaPacientes.innerHTML        = '';
        DOM.manualNome.value        = '';
        DOM.manualAtend.value       = '';
        DOM.manualLeito.value       = '';
        if (DOM.manualNasc) DOM.manualNasc.value = '';
        DOM.manualSetor.selectedIndex = 0;
        DOM.manualErro.style.display = 'none';
        DOM.manualNome.focus();
    }

    function fecharFormManual() {
        DOM.formManual.style.display        = 'none';
        DOM.linkManualWrapper.style.display = 'block';
    }

    function confirmarManual() {
        var nome  = DOM.manualNome.value.trim();
        var atend = DOM.manualAtend.value.trim();
        var nasc  = DOM.manualNasc ? DOM.manualNasc.value.trim() : '';
        var setor = DOM.manualSetor.value.trim();
        if (!nome) {
            DOM.manualErro.textContent = 'Nome do paciente é obrigatório.';
            DOM.manualErro.style.display = 'block';
            DOM.manualNome.focus();
            return;
        }
        if (!atend) {
            DOM.manualErro.textContent = 'Nº de atendimento é obrigatório.';
            DOM.manualErro.style.display = 'block';
            DOM.manualAtend.focus();
            return;
        }
        if (!nasc) {
            DOM.manualErro.textContent = 'Data de nascimento é obrigatória.';
            DOM.manualErro.style.display = 'block';
            if (DOM.manualNasc) DOM.manualNasc.focus();
            return;
        }
        if (!setor) {
            DOM.manualErro.textContent = 'Setor é obrigatório.';
            DOM.manualErro.style.display = 'block';
            DOM.manualSetor.focus();
            return;
        }
        DOM.formManual.style.display = 'none';
        selecionarPaciente({
            nm_paciente:    nome,
            nr_atendimento: atend,
            leito:          DOM.manualLeito.value.trim() || '--',
            setor_nome:     setor,
            cd_unidade:     null,
            ds_clinica:     null,
            dias_internado: null,
            dt_nascimento:  nasc,
            _manual:        true
        });
    }

    function _formatarNascimento(dtNasc) {
        if (!dtNasc) return null;
        var partes = String(dtNasc).split('-');
        if (partes.length !== 3) return dtNasc;
        var hoje = new Date();
        var anos = hoje.getFullYear() - parseInt(partes[0], 10);
        var mes  = hoje.getMonth() + 1 - parseInt(partes[1], 10);
        var dia  = hoje.getDate() - parseInt(partes[2], 10);
        if (mes < 0 || (mes === 0 && dia < 0)) anos--;
        return partes[2] + '/' + partes[1] + '/' + partes[0] + ' (' + anos + ' anos)';
    }

    function selecionarPaciente(p) {
        Estado.paciente = p;
        DOM.listaPacientes.innerHTML = '';
        DOM.inputBusca.value = '';
        DOM.linkManualWrapper.style.display = 'none';
        DOM.formManual.style.display = 'none';

        DOM.pacNome.textContent    = p.nm_paciente || '--';
        DOM.pacLeito.textContent   = p.leito       || '--';
        DOM.pacSetor.textContent   = p.setor_nome  || '--';

        var nascFormatado = _formatarNascimento(p.dt_nascimento);
        if (DOM.pacNasc) DOM.pacNasc.textContent = nascFormatado || '--';
        if (DOM.cardInfoNasc) DOM.cardInfoNasc.style.display = nascFormatado ? '' : 'none';

        if (p._manual) {
            DOM.badgeManual.style.display   = 'inline-block';
            DOM.cardInfoExtra.style.display = 'none';
        } else {
            DOM.badgeManual.style.display   = 'none';
            DOM.cardInfoExtra.style.display = '';
            DOM.pacClinica.textContent = p.ds_clinica  || '--';
            DOM.pacDias.textContent    = p.dias_internado != null ? p.dias_internado : '--';
        }

        DOM.cardPaciente.style.display   = 'block';
        DOM.avisoSelecione.style.display = 'none';
        DOM.formSolicitar.style.display  = 'block';
    }

    function limparPaciente() {
        Estado.paciente = null;
        DOM.cardPaciente.style.display   = 'none';
        DOM.avisoSelecione.style.display = 'block';
        DOM.formSolicitar.style.display  = 'none';
        DOM.badgeManual.style.display    = 'none';
        DOM.cardInfoExtra.style.display  = '';
        DOM.linkManualWrapper.style.display = 'block';
        DOM.formManual.style.display     = 'none';
        DOM.inputBusca.value = '';
        DOM.listaPacientes.innerHTML = '';
        resetarForm();
    }

    // =========================================================
    // URGENTE TOGGLE
    // =========================================================
    function toggleUrgente() {
        Estado.urgente = !Estado.urgente;
        if (Estado.urgente) {
            DOM.btnUrgente.classList.add('urgente-ativo');
        } else {
            DOM.btnUrgente.classList.remove('urgente-ativo');
        }
    }

    // =========================================================
    // SUBMETER SOLICITAÇÃO
    // =========================================================
    function submeterSolicitacao(e) {
        e.preventDefault();
        if (Estado.enviando || !Estado.paciente) return;

        DOM.erroForm.style.display = 'none';

        var tipoDietaId = DOM.selTipoDieta.value;
        var refeicaoId  = DOM.selRefeicao.value;

        if (!tipoDietaId) { mostrarErro('Selecione o tipo de dieta.'); return; }
        if (!refeicaoId)  { mostrarErro('Selecione a refeição.'); return; }

        // Coletar restrições selecionadas
        var restricoesIds  = [];
        var restricoesNomes = [];
        var chks = DOM.listaRestricoes.querySelectorAll('.chk-restricao:checked');
        for (var i = 0; i < chks.length; i++) {
            restricoesIds.push(parseInt(chks[i].value, 10));
            restricoesNomes.push(chks[i].getAttribute('data-nome'));
        }

        var body = {
            nr_atendimento: Estado.paciente.nr_atendimento,
            nm_paciente:    Estado.paciente.nm_paciente,
            leito:          Estado.paciente.leito,
            setor_nome:     Estado.paciente.setor_nome,
            cd_unidade:     Estado.paciente.cd_unidade,
            ds_clinica:     Estado.paciente.ds_clinica,
            dt_nascimento:  Estado.paciente.dt_nascimento || null,
            tipo_dieta_id:  parseInt(tipoDietaId, 10),
            refeicao_id:    parseInt(refeicaoId, 10),
            quantidade:     1,
            restricoes_ids: restricoesIds,
            restricoes_txt: restricoesNomes.join(', '),
            observacao:     DOM.inpObs.value.trim(),
            prioridade:     Estado.urgente ? 'urgente' : 'normal'
        };

        Estado.enviando = true;
        DOM.btnSolicitar.disabled = true;
        DOM.btnSolicitar.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Enviando...';

        fetch(CONFIG.apiBase + '/solicitar', {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        })
            .then(function (r) { return r.json(); })
            .then(function (data) {
                Estado.enviando = false;
                DOM.btnSolicitar.disabled = false;
                DOM.btnSolicitar.innerHTML = '<i class="fa-solid fa-paper-plane"></i> Solicitar Dieta';

                if (data.success) {
                    mostrarModalSucesso(data.codigo_entrega);
                    carregarMinhasSolicitacoes();
                } else {
                    mostrarErro(data.error || 'Erro ao enviar solicitação.');
                }
            })
            .catch(function (err) {
                Estado.enviando = false;
                DOM.btnSolicitar.disabled = false;
                DOM.btnSolicitar.innerHTML = '<i class="fa-solid fa-paper-plane"></i> Solicitar Dieta';
                mostrarErro('Falha na conexão. Tente novamente.');
                console.error(err);
            });
    }

    function mostrarErro(msg) {
        DOM.erroForm.textContent = msg;
        DOM.erroForm.style.display = 'block';
    }

    function resetarForm() {
        if (DOM.selTipoDieta) DOM.selTipoDieta.selectedIndex = 0;
        if (DOM.selRefeicao)  DOM.selRefeicao.selectedIndex  = 0;
        if (DOM.inpQtd)       DOM.inpQtd.value = 1;
        if (DOM.inpObs)       DOM.inpObs.value = '';
        if (DOM.erroForm)     DOM.erroForm.style.display = 'none';
        var chks = document.querySelectorAll('.chk-restricao:checked');
        for (var i = 0; i < chks.length; i++) chks[i].checked = false;
        Estado.urgente = false;
        if (DOM.btnUrgente) DOM.btnUrgente.classList.remove('urgente-ativo');
    }

    // =========================================================
    // MODAL SUCESSO
    // =========================================================
    function mostrarModalSucesso(codigo) {
        DOM.modalCodigo.textContent = codigo;
        DOM.modalSucesso.style.display = 'flex';
    }

    function fecharModalSucesso() {
        DOM.modalSucesso.style.display = 'none';
        limparPaciente();
    }

    // =========================================================
    // MINHAS SOLICITAÇÕES
    // =========================================================
    function carregarMinhasSolicitacoes() {
        fetch(CONFIG.apiBase + '/minhas-solicitacoes', { credentials: 'same-origin' })
            .then(function (r) { return r.json(); })
            .then(function (data) {
                if (data.success) {
                    Estado.minhasSolicitacoes = data.solicitacoes || [];
                    renderMinhasSolicitacoes();
                }
            })
            .catch(function (e) { console.error('minhas-solicitacoes', e); });
    }

    function _popularFiltroSetor41() {
        if (!DOM.filtroSetor41) return;
        var atual = DOM.filtroSetor41.value;
        var setores = {};
        for (var i = 0; i < Estado.minhasSolicitacoes.length; i++) {
            var s = Estado.minhasSolicitacoes[i].setor_nome;
            if (s) setores[s] = true;
        }
        var html = '<option value="">Todos os setores</option>';
        var chaves = Object.keys(setores).sort();
        for (var j = 0; j < chaves.length; j++) {
            html += '<option value="' + escHtml(chaves[j]) + '"' +
                (chaves[j] === atual ? ' selected' : '') + '>' + escHtml(chaves[j]) + '</option>';
        }
        DOM.filtroSetor41.innerHTML = html;
    }

    function _popularFiltroRefeicao41() {
        if (!DOM.filtroRefeicao41) return;
        var atual = DOM.filtroRefeicao41.value;
        var refeicoes = {};
        for (var i = 0; i < Estado.minhasSolicitacoes.length; i++) {
            var r = Estado.minhasSolicitacoes[i];
            if (r.refeicao_nome) refeicoes[r.refeicao_nome] = true;
        }
        var html = '<option value="">Todas</option>';
        var nomes = Object.keys(refeicoes).sort();
        for (var j = 0; j < nomes.length; j++) {
            html += '<option value="' + escHtml(nomes[j]) + '"' +
                (nomes[j] === atual ? ' selected' : '') + '>' + escHtml(nomes[j]) + '</option>';
        }
        DOM.filtroRefeicao41.innerHTML = html;
        Estado.filtroRefeicao41 = DOM.filtroRefeicao41.value;
    }

    function renderMinhasSolicitacoes() {
        var setorFiltro    = DOM.filtroSetor41    ? DOM.filtroSetor41.value    : '';
        var refeicaoFiltro = Estado.filtroRefeicao41;
        var busca          = Estado.buscaHist;

        var lista = Estado.minhasSolicitacoes.filter(function (s) {
            if (setorFiltro    && s.setor_nome    !== setorFiltro)    return false;
            if (refeicaoFiltro && s.refeicao_nome !== refeicaoFiltro) return false;
            if (busca) {
                var nome  = (s.nm_paciente    || '').toLowerCase();
                var nr    = (s.nr_atendimento || '').toLowerCase();
                if (nome.indexOf(busca) === -1 && nr.indexOf(busca) === -1) return false;
            }
            return true;
        });
        Estado.listaFiltrada = lista;

        _popularFiltroSetor41();
        _popularFiltroRefeicao41();

        if (!lista.length) {
            if (Estado.minhasSolicitacoes.length) {
                DOM.tabelaEmpty.style.display  = 'none';
                DOM.tabelaMinhas.style.display = 'table';
                DOM.tbodyMinhas.innerHTML = '<tr><td colspan="13" style="text-align:center;color:#aaa;padding:20px;">Nenhum resultado para os filtros aplicados.</td></tr>';
            } else {
                DOM.tabelaEmpty.style.display  = 'block';
                DOM.tabelaMinhas.style.display = 'none';
            }
            DOM.badgeTotal.style.display = 'none';
            return;
        }

        DOM.tabelaEmpty.style.display  = 'none';
        DOM.tabelaMinhas.style.display = 'table';
        DOM.badgeTotal.style.display   = 'inline-block';
        DOM.badgeTotal.textContent     = lista.length;

        var html = '';
        for (var i = 0; i < lista.length; i++) {
            var s = lista[i];
            var podeCancelar = s.status === 'aguardando';
            var prio = s.prioridade === 'urgente'
                ? '<span class="badge-urgente"><i class="fa-solid fa-bolt"></i> Urgente</span>'
                : '<span class="badge-normal">Normal</span>';

            html += '<tr class="' + (s.status === 'cancelado' ? 'linha-cancelada' : '') + '">' +
                '<td><span class="codigo-entrega">' + escHtml(s.codigo_entrega) + '</span></td>' +
                '<td class="td-dia">' + escHtml(s.data_pedido || '--') + '</td>' +
                '<td>' + escHtml(s.hora_pedido || '--') + '</td>' +
                '<td class="td-nr">' + escHtml(s.nr_atendimento || '--') + '</td>' +
                '<td>' + escHtml(s.nm_paciente) + '</td>' +
                '<td>' + escHtml(s.leito || '--') + '</td>' +
                '<td>' + escHtml(s.setor_nome || '--') + '</td>' +
                '<td>' + escHtml(s.tipo_dieta_nome || '--') + '</td>' +
                '<td>' + escHtml(s.refeicao_nome || '--') + '</td>' +
                '<td>' + prio + '</td>' +
                '<td>' + badgeStatus(s.status) + '</td>' +
                '<td>' +
                    (podeCancelar
                        ? '<button class="btn-canc-linha" data-id="' + s.id + '">' +
                          '<i class="fa-solid fa-xmark"></i></button>'
                        : '--') +
                '</td>' +
                '<td class="td-motivo-cancel">' +
                    (s.motivo_cancelamento ? escHtml(s.motivo_cancelamento) : '--') +
                '</td>' +
            '</tr>';
        }
        DOM.tbodyMinhas.innerHTML = html;

        var btns = DOM.tbodyMinhas.querySelectorAll('.btn-canc-linha');
        for (var j = 0; j < btns.length; j++) {
            btns[j].addEventListener('click', function () {
                abrirModalCancelar(this.getAttribute('data-id'));
            });
        }
    }

    // =========================================================
    // EXPORTAR PDF — abre janela com tabela filtrada e imprime
    // =========================================================
    function exportarPDF() {
        var lista = Estado.listaFiltrada;
        if (!lista || !lista.length) {
            alert('Nenhuma solicitação para exportar com os filtros atuais.');
            return;
        }

        var agora  = new Date();
        var datahora = ('0' + agora.getDate()).slice(-2) + '/' +
                       ('0' + (agora.getMonth() + 1)).slice(-2) + '/' +
                       agora.getFullYear() + ' ' +
                       ('0' + agora.getHours()).slice(-2) + ':' +
                       ('0' + agora.getMinutes()).slice(-2);

        var filtroDesc = [];
        var setorFiltro = DOM.filtroSetor41 ? DOM.filtroSetor41.value : '';
        if (setorFiltro)           filtroDesc.push('Setor: ' + setorFiltro);
        if (Estado.filtroRefeicao41) filtroDesc.push('Refeição: ' + Estado.filtroRefeicao41);
        if (Estado.buscaHist)      filtroDesc.push('Busca: "' + Estado.buscaHist + '"');
        var filtroTexto = filtroDesc.length ? filtroDesc.join(' | ') : 'Todos';

        var statusMap = {
            aguardando: 'Aguardando', aceito: 'Aceito',
            em_preparo: 'Em Preparo', pronto: 'Pronto',
            em_entrega: 'Em Entrega', entregue: 'Entregue', cancelado: 'Cancelado'
        };

        var rows = '';
        for (var i = 0; i < lista.length; i++) {
            var s = lista[i];
            var isCancelado = s.status === 'cancelado';
            rows += '<tr' + (isCancelado ? ' class="cancelado"' : '') + '>' +
                '<td>' + escHtml(s.codigo_entrega || '--') + '</td>' +
                '<td>' + escHtml(s.data_pedido    || '--') + '</td>' +
                '<td>' + escHtml(s.hora_pedido    || '--') + '</td>' +
                '<td>' + escHtml(s.nr_atendimento || '--') + '</td>' +
                '<td>' + escHtml(s.nm_paciente    || '--') + '</td>' +
                '<td>' + escHtml(s.leito          || '--') + '</td>' +
                '<td>' + escHtml(s.setor_nome     || '--') + '</td>' +
                '<td>' + escHtml(s.tipo_dieta_nome || '--') + '</td>' +
                '<td>' + escHtml(s.refeicao_nome  || '--') + '</td>' +
                '<td>' + (s.prioridade === 'urgente' ? '<strong style="color:#c0392b">Urgente</strong>' : 'Normal') + '</td>' +
                '<td>' + escHtml(statusMap[s.status] || s.status) + '</td>' +
                '<td>' + escHtml(s.motivo_cancelamento || '--') + '</td>' +
            '</tr>';
        }

        var html = '<!DOCTYPE html><html lang="pt-BR"><head>' +
            '<meta charset="UTF-8">' +
            '<title>Solicitações de Dieta — HAC</title>' +
            '<style>' +
                'body{font-family:Arial,sans-serif;font-size:10px;color:#222;margin:10mm;}' +
                'h2{font-size:13px;margin:0 0 3px;}' +
                '.sub{font-size:9px;color:#555;margin-bottom:10px;}' +
                'table{width:100%;border-collapse:collapse;}' +
                'th{background:#1a5c3a;color:#fff;padding:5px 6px;text-align:left;font-size:9px;white-space:nowrap;}' +
                'td{padding:4px 6px;border-bottom:1px solid #e0e0e0;font-size:9px;vertical-align:middle;}' +
                'tr:nth-child(even) td{background:#f5f5f5;}' +
                'tr.cancelado td{color:#aaa;text-decoration:line-through;}' +
                '@media print{@page{size:A4 landscape;margin:10mm}body{margin:0}}' +
            '</style>' +
            '</head><body>' +
            '<h2><i>Solicitações de Dieta — Hospital Anchieta Ceilândia</i></h2>' +
            '<div class="sub">Gerado em: ' + datahora + ' &nbsp;|&nbsp; ' +
                lista.length + ' registro(s) &nbsp;|&nbsp; Filtros: ' + escHtml(filtroTexto) + '</div>' +
            '<table><thead><tr>' +
                '<th>Código</th><th>Dia</th><th>Horário</th><th>NR Atend.</th>' +
                '<th>Paciente</th><th>Leito</th><th>Setor</th><th>Dieta</th>' +
                '<th>Refeição</th><th>Prioridade</th><th>Status</th><th>Motivo Cancel.</th>' +
            '</tr></thead><tbody>' + rows + '</tbody></table>' +
            '<script>window.onload=function(){window.print();}<\/script>' +
            '</body></html>';

        var win = window.open('', '_blank', 'width=900,height=600');
        if (!win) { alert('Permita pop-ups para exportar o PDF.'); return; }
        win.document.write(html);
        win.document.close();
    }

    // =========================================================
    // MODAL CANCELAR
    // =========================================================
    function abrirModalCancelar(id) {
        DOM.modalCancId.value     = id;
        DOM.modalCancMotivo.value = '';
        DOM.modalCancErro.style.display = 'none';
        DOM.modalCancelar.style.display = 'flex';
    }

    function fecharModalCancelar() {
        DOM.modalCancelar.style.display = 'none';
    }

    function confirmarCancelamento() {
        var id     = DOM.modalCancId.value;
        var motivo = DOM.modalCancMotivo.value.trim();

        if (motivo.length < 10) {
            DOM.modalCancErro.textContent = 'Motivo deve ter pelo menos 10 caracteres.';
            DOM.modalCancErro.style.display = 'block';
            return;
        }

        DOM.btnCancConfirmar.disabled = true;

        fetch(CONFIG.apiBase + '/solicitacoes/' + id + '/cancelar', {
            method: 'PUT',
            credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ motivo: motivo })
        })
            .then(function (r) { return r.json(); })
            .then(function (data) {
                DOM.btnCancConfirmar.disabled = false;
                if (data.success) {
                    fecharModalCancelar();
                    carregarMinhasSolicitacoes();
                } else {
                    DOM.modalCancErro.textContent = data.error || 'Erro ao cancelar.';
                    DOM.modalCancErro.style.display = 'block';
                }
            })
            .catch(function () {
                DOM.btnCancConfirmar.disabled = false;
                DOM.modalCancErro.textContent = 'Falha na conexão.';
                DOM.modalCancErro.style.display = 'block';
            });
    }

    // =========================================================
    // START
    // =========================================================
    window.addEventListener('DOMContentLoaded', inicializar);

})();
