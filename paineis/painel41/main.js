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
        minhasSolicitacoes: [],
        urgente: false,
        enviando: false,
        buscando: false,
        _debounceTimer: null
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
        return function () {
            var args = arguments;
            clearTimeout(Estado._debounceTimer);
            Estado._debounceTimer = setTimeout(function () { fn.apply(null, args); }, ms);
        };
    }

    // =========================================================
    // INICIALIZAR
    // =========================================================
    function inicializar() {
        var btnVoltar = document.getElementById('btn-voltar-hub');
        if (btnVoltar) {
            btnVoltar.addEventListener('click', function () { window.history.back(); });
        }

        DOM.inputBusca       = document.getElementById('input-busca');
        DOM.spinnerBusca     = document.getElementById('spinner-busca');
        DOM.listaPacientes   = document.getElementById('lista-pacientes');
        DOM.cardPaciente     = document.getElementById('card-paciente');
        DOM.pacNome          = document.getElementById('pac-nome');
        DOM.pacLeito         = document.getElementById('pac-leito');
        DOM.pacSetor         = document.getElementById('pac-setor');
        DOM.pacClinica       = document.getElementById('pac-clinica');
        DOM.pacDias          = document.getElementById('pac-dias');
        DOM.btnLimpar        = document.getElementById('btn-limpar-paciente');
        DOM.avisoSelecione   = document.getElementById('aviso-selecione');
        DOM.formSolicitar    = document.getElementById('form-solicitar');
        DOM.selTipoDieta     = document.getElementById('sel-tipo-dieta');
        DOM.selRefeicao      = document.getElementById('sel-refeicao');
        DOM.inpQtd           = document.getElementById('inp-quantidade');
        DOM.btnMinus         = document.getElementById('btn-minus');
        DOM.btnPlus          = document.getElementById('btn-plus');
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
        DOM.btnUrgente.addEventListener('click', toggleUrgente);
        DOM.btnMinus.addEventListener('click', function () { alterarQtd(-1); });
        DOM.btnPlus.addEventListener('click', function () { alterarQtd(1); });
        DOM.formSolicitar.addEventListener('submit', submeterSolicitacao);
        DOM.btnModalOk.addEventListener('click', fecharModalSucesso);
        DOM.btnCancFechar.addEventListener('click', fecharModalCancelar);
        DOM.btnCancConfirmar.addEventListener('click', confirmarCancelamento);

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
    function buscarPaciente() {
        var q = DOM.inputBusca.value.trim();
        if (q.length < CONFIG.minCharsSearch) {
            DOM.listaPacientes.innerHTML = '';
            return;
        }
        if (Estado.buscando) return;
        Estado.buscando = true;
        DOM.spinnerBusca.style.display = 'inline-block';

        fetch(CONFIG.apiBase + '/pacientes?q=' + encodeURIComponent(q), { credentials: 'same-origin' })
            .then(function (r) { return r.json(); })
            .then(function (data) {
                Estado.buscando = false;
                DOM.spinnerBusca.style.display = 'none';
                renderListaPacientes(data.pacientes || []);
            })
            .catch(function (e) {
                Estado.buscando = false;
                DOM.spinnerBusca.style.display = 'none';
                console.error('busca pacientes', e);
            });
    }

    function renderListaPacientes(lista) {
        if (!lista.length) {
            DOM.listaPacientes.innerHTML = '<div class="pac-nenhum">Nenhum paciente encontrado.</div>';
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

    function selecionarPaciente(p) {
        Estado.paciente = p;
        DOM.listaPacientes.innerHTML = '';
        DOM.inputBusca.value = '';

        DOM.pacNome.textContent    = p.nm_paciente || '--';
        DOM.pacLeito.textContent   = p.leito       || '--';
        DOM.pacSetor.textContent   = p.setor_nome  || '--';
        DOM.pacClinica.textContent = p.ds_clinica  || '--';
        DOM.pacDias.textContent    = p.dias_internado != null ? p.dias_internado : '--';

        DOM.cardPaciente.style.display   = 'block';
        DOM.avisoSelecione.style.display = 'none';
        DOM.formSolicitar.style.display  = 'block';
    }

    function limparPaciente() {
        Estado.paciente = null;
        DOM.cardPaciente.style.display   = 'none';
        DOM.avisoSelecione.style.display = 'block';
        DOM.formSolicitar.style.display  = 'none';
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
    // QUANTIDADE
    // =========================================================
    function alterarQtd(delta) {
        var v = parseInt(DOM.inpQtd.value, 10) + delta;
        if (v < 1) v = 1;
        if (v > 10) v = 10;
        DOM.inpQtd.value = v;
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
        var quantidade  = parseInt(DOM.inpQtd.value, 10);

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
            tipo_dieta_id:  parseInt(tipoDietaId, 10),
            refeicao_id:    parseInt(refeicaoId, 10),
            quantidade:     quantidade,
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

    function renderMinhasSolicitacoes() {
        var lista = Estado.minhasSolicitacoes;

        if (!lista.length) {
            DOM.tabelaEmpty.style.display = 'block';
            DOM.tabelaMinhas.style.display = 'none';
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
                '<td>' + escHtml(s.nm_paciente) + '</td>' +
                '<td>' + escHtml(s.leito || '--') + '</td>' +
                '<td>' + escHtml(s.tipo_dieta_nome || '--') + '</td>' +
                '<td>' + escHtml(s.refeicao_nome || '--') + '</td>' +
                '<td>' + prio + '</td>' +
                '<td>' + badgeStatus(s.status) + '</td>' +
                '<td>' + escHtml(s.criado_em || '--') + '</td>' +
                '<td>' +
                    (podeCancelar
                        ? '<button class="btn-canc-linha" data-id="' + s.id + '">' +
                          '<i class="fa-solid fa-xmark"></i></button>'
                        : '--') +
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
