(function () {
    'use strict';

    var BASE_URL = window.location.origin;

    var CONFIG = {
        apiTipos:        BASE_URL + '/api/paineis/painel34/tipos-movimento',
        apiSetores:      BASE_URL + '/api/paineis/painel34/setores',
        apiDestinos:     BASE_URL + '/api/paineis/painel34/destinos',
        apiPacientes:    BASE_URL + '/api/paineis/painel34/pacientes',
        apiSolicitar:    BASE_URL + '/api/paineis/painel34/solicitar',
        apiMeusChamados: BASE_URL + '/api/paineis/painel34/meus-chamados',
        apiCancelar:     BASE_URL + '/api/paineis/painel34/chamados/{id}/cancelar',
        refreshInterval: 15000
    };

    var estado = {
        telaAtual: 'principal',
        tipos: [],
        tipoSelecionado: null,
        enviando: false,
        chamadosPendentes: [],
        refreshTimer: null,
        chamadoCancelarId: null,
        paciente: null,       // {nr_atendimento, paciente, leito, setor} quando selecionado da lista
        modoManual: false,
        buscaTimer: null
    };

    // ── INICIALIZACAO ──────────────────────────────────────────────

    function inicializar() {
        document.getElementById('btn-novo-chamado').addEventListener('click', function () { irParaTela('formulario'); });
        document.getElementById('btn-acompanhar').addEventListener('click', function () { irParaTela('acompanhamento'); carregarAcompanhamento(); });
        document.getElementById('btn-voltar').addEventListener('click', function () { window.history.back(); });
        document.getElementById('btn-voltar-form').addEventListener('click', function () { irParaTela('principal'); });
        document.getElementById('btn-voltar-acompanhamento').addEventListener('click', function () { irParaTela('principal'); });
        document.getElementById('btn-refresh-acomp').addEventListener('click', carregarAcompanhamento);
        document.getElementById('btn-nova-solicitacao').addEventListener('click', function () { irParaTela('formulario'); });
        document.getElementById('btn-ver-chamados').addEventListener('click', function () { irParaTela('acompanhamento'); carregarAcompanhamento(); });
        document.getElementById('btn-inicio').addEventListener('click', function () { irParaTela('principal'); });
        document.getElementById('btn-cancelar-nao').addEventListener('click', fecharModalCancelar);
        document.getElementById('btn-cancelar-sim').addEventListener('click', confirmarCancelamento);
        document.getElementById('form-chamado').addEventListener('submit', enviarFormulario);

        document.getElementById('input-obs').addEventListener('input', function () {
            document.getElementById('count-obs').textContent = this.value.length;
        });

        document.querySelectorAll('input[name="prioridade"]').forEach(function (radio) {
            radio.addEventListener('change', atualizarEstiloPrioridade);
        });

        document.getElementById('select-destino').addEventListener('change', function () {
            document.getElementById('grupo-complemento').style.display =
                (this.value === '__outro__') ? 'block' : 'none';
        });

        inicializarBuscaPaciente();
        carregarTipos();
        carregarSetores();
        carregarDestinos();
        carregarBadge();
    }

    // ── NAVEGACAO ENTRE TELAS ──────────────────────────────────────

    function irParaTela(nome) {
        var mapa = {
            principal:      'tela-principal',
            formulario:     'tela-formulario',
            confirmacao:    'tela-confirmacao',
            acompanhamento: 'tela-acompanhamento'
        };
        Object.keys(mapa).forEach(function (k) {
            var el = document.getElementById(mapa[k]);
            if (el) el.style.display = (k === nome) ? '' : 'none';
        });
        estado.telaAtual = nome;

        if (nome === 'principal') {
            carregarBadge();
            if (estado.refreshTimer) { clearInterval(estado.refreshTimer); estado.refreshTimer = null; }
        }
        if (nome === 'acompanhamento') {
            if (estado.refreshTimer) clearInterval(estado.refreshTimer);
            estado.refreshTimer = setInterval(carregarAcompanhamento, CONFIG.refreshInterval);
        }
    }

    // ── TIPOS DE MOVIMENTO ─────────────────────────────────────────

    function carregarTipos() {
        fetch(CONFIG.apiTipos, { credentials: 'same-origin' })
            .then(function (r) { return r.json(); })
            .then(function (data) {
                if (!data.success) return;
                estado.tipos = data.tipos;
                renderizarTipos(data.tipos);
            })
            .catch(function (e) { console.error('Erro tipos:', e); });
    }

    function renderizarTipos(tipos) {
        var grid = document.getElementById('tipo-grid');
        if (!tipos || tipos.length === 0) {
            grid.innerHTML = '<p style="color:#aaa;font-size:13px;">Nenhum tipo cadastrado.</p>';
            return;
        }
        grid.innerHTML = tipos.map(function (t) {
            return '<div class="tipo-card" data-id="' + t.id + '" data-nome="' + escHtml(t.nome) + '" style="--tipo-cor:' + escHtml(t.cor) + '">' +
                   '<i class="fas ' + escHtml(t.icone) + '" style="color:' + escHtml(t.cor) + '"></i>' +
                   '<span>' + escHtml(t.nome) + '</span>' +
                   '</div>';
        }).join('');

        grid.querySelectorAll('.tipo-card').forEach(function (card) {
            card.addEventListener('click', function () {
                grid.querySelectorAll('.tipo-card').forEach(function (c) { c.classList.remove('selecionado'); });
                card.classList.add('selecionado');
                estado.tipoSelecionado = { id: card.dataset.id, nome: card.dataset.nome };
                document.getElementById('tipo-movimento-id').value = card.dataset.id;
                document.getElementById('tipo-movimento-nome').value = card.dataset.nome;
                
                // Recarrega os destinos de acordo com o tipo selecionado
                carregarDestinos(card.dataset.id);
            });
        });
    }

    // ── SETORES (ORIGEM) ──────────────────────────────────────────

    function carregarSetores() {
        fetch(CONFIG.apiSetores, { credentials: 'same-origin' })
            .then(function (r) { return r.json(); })
            .then(function (data) {
                if (!data.success) return;
                var select = document.getElementById('select-setor');
                select.innerHTML = '<option value="">Selecione o setor...</option>';
                data.setores.forEach(function (s) {
                    var opt = document.createElement('option');
                    opt.value = s.nome;
                    opt.textContent = s.nome;
                    select.appendChild(opt);
                });
            })
            .catch(function (e) { console.error('Erro setores:', e); });
    }

    // ── DESTINOS (SETOR DE DESTINO) ───────────────────────────────

    function carregarDestinos(tipoId) {
        var select = document.getElementById('select-destino');
        select.innerHTML = '<option value="">Carregando setores...</option>';

        var url = CONFIG.apiDestinos;
        if (tipoId) {
            url += '?tipo_id=' + encodeURIComponent(tipoId);
        }

        fetch(url, { credentials: 'same-origin' })
            .then(function (r) { return r.json(); })
            .then(function (data) {
                select.innerHTML = '<option value="">Selecione o setor de destino...</option>';
                if (data.success && data.destinos.length > 0) {
                    data.destinos.forEach(function (d) {
                        var opt = document.createElement('option');
                        opt.value = d.nome;
                        opt.textContent = d.nome;
                        select.appendChild(opt);
                    });
                }
                var outroOpt = document.createElement('option');
                outroOpt.value = '__outro__';
                outroOpt.textContent = 'Outro (especificar)';
                select.appendChild(outroOpt);
            })
            .catch(function () {
                select.innerHTML = '<option value="">Erro ao carregar destinos</option>';
            });
    }

    // ── BUSCA DE PACIENTE ─────────────────────────────────────────

    function inicializarBuscaPaciente() {
        var inputBusca = document.getElementById('input-busca-paciente');
        var btnLimpar  = document.getElementById('btn-limpar-busca');
        var btnTrocar  = document.getElementById('btn-trocar-paciente');
        var btnManual  = document.getElementById('btn-toggle-manual');

        inputBusca.addEventListener('input', function () {
            var val = this.value;
            btnLimpar.style.display = val ? '' : 'none';
            if (estado.buscaTimer) clearTimeout(estado.buscaTimer);
            if (val.length < 2) { fecharBusca(); return; }
            estado.buscaTimer = setTimeout(function () { buscarPacientes(val); }, 300);
        });

        btnLimpar.addEventListener('click', function () {
            inputBusca.value = '';
            btnLimpar.style.display = 'none';
            fecharBusca();
            inputBusca.focus();
        });

        btnTrocar.addEventListener('click', function () {
            document.getElementById('paciente-card').style.display = 'none';
            document.getElementById('bloco-busca-paciente').style.display = '';
            estado.paciente = null;
            document.getElementById('hid-paciente').value = '';
            document.getElementById('hid-atendimento').value = '';
            inputBusca.value = '';
            btnLimpar.style.display = 'none';
            fecharBusca();
            inputBusca.focus();
        });

        btnManual.addEventListener('click', function () {
            estado.modoManual = !estado.modoManual;
            var blocoManual = document.getElementById('bloco-manual');
            var blocoBusca  = document.getElementById('bloco-busca-paciente');
            var pacCard     = document.getElementById('paciente-card');
            var txtLabel    = document.getElementById('txt-toggle-manual');
            var ico         = btnManual.querySelector('i');

            if (estado.modoManual) {
                blocoManual.style.display = '';
                blocoBusca.style.display  = 'none';
                pacCard.style.display     = 'none';
                txtLabel.textContent = 'Buscar na lista';
                ico.className = 'fas fa-search';
                estado.paciente = null;
            } else {
                blocoManual.style.display = 'none';
                blocoBusca.style.display  = '';
                txtLabel.textContent = 'Digitar manualmente';
                ico.className = 'fas fa-keyboard';
            }
        });

        // Fecha lista ao clicar fora
        document.addEventListener('click', function (e) {
            if (!e.target.closest('#bloco-busca-paciente')) fecharBusca();
        });
    }

    function buscarPacientes(q) {
        var lista = document.getElementById('busca-lista');
        lista.innerHTML = '<div class="busca-loading"><div class="loading-spinner-sm"></div> Buscando...</div>';
        lista.style.display = '';

        fetch(CONFIG.apiPacientes + '?q=' + encodeURIComponent(q), { credentials: 'same-origin' })
            .then(function (r) { return r.json(); })
            .then(function (data) {
                if (!data.success) { fecharBusca(); return; }
                renderizarResultadosBusca(data.pacientes);
            })
            .catch(function () { fecharBusca(); });
    }

    function renderizarResultadosBusca(pacientes) {
        var lista = document.getElementById('busca-lista');
        if (!pacientes || pacientes.length === 0) {
            lista.innerHTML = '<div class="busca-vazio"><i class="fas fa-search"></i> Nenhum paciente encontrado</div>';
            lista.style.display = '';
            return;
        }

        lista.innerHTML = pacientes.map(function (p) {
            var det = [];
            if (p.nr_atendimento) det.push('<span><i class="fas fa-hashtag"></i>' + escHtml(p.nr_atendimento) + '</span>');
            if (p.leito)          det.push('<span><i class="fas fa-bed"></i>' + escHtml(p.leito) + '</span>');
            if (p.setor)          det.push('<span><i class="fas fa-hospital"></i>' + escHtml(p.setor) + '</span>');

            return '<div class="busca-resultado-item"' +
                   ' data-atendimento="' + escHtml(p.nr_atendimento || '') + '"' +
                   ' data-paciente="' + escHtml(p.paciente || '') + '"' +
                   ' data-leito="' + escHtml(p.leito || '') + '"' +
                   ' data-setor="' + escHtml(p.setor || '') + '">' +
                   '<div class="bri-nome">' + escHtml(p.paciente || 'Sem nome') + '</div>' +
                   (det.length ? '<div class="bri-det">' + det.join('') + '</div>' : '') +
                   '</div>';
        }).join('');

        lista.style.display = '';

        lista.querySelectorAll('.busca-resultado-item').forEach(function (item) {
            item.addEventListener('click', function () {
                selecionarPaciente({
                    nr_atendimento: item.dataset.atendimento,
                    paciente:       item.dataset.paciente,
                    leito:          item.dataset.leito,
                    setor:          item.dataset.setor
                });
            });
        });
    }

    function selecionarPaciente(p) {
        estado.paciente = p;

        // Preenche campos ocultos
        document.getElementById('hid-paciente').value    = p.paciente || '';
        document.getElementById('hid-atendimento').value = p.nr_atendimento || '';

        // Mostra card com detalhes
        document.getElementById('pc-nome').textContent = p.paciente || 'Paciente sem nome';
        var det = [];
        if (p.nr_atendimento) det.push('Atend. ' + p.nr_atendimento);
        if (p.leito)          det.push('Leito ' + p.leito);
        if (p.setor)          det.push(p.setor);
        document.getElementById('pc-det').textContent = det.join(' · ');

        document.getElementById('bloco-busca-paciente').style.display = 'none';
        document.getElementById('paciente-card').style.display        = '';
        fecharBusca();

        // Auto-preenche leito
        if (p.leito) document.getElementById('input-leito').value = p.leito;

        // Auto-seleciona setor de origem
        if (p.setor) autoSelecionarSetor(p.setor);
    }

    function autoSelecionarSetor(nomeSetor) {
        var select = document.getElementById('select-setor');
        for (var i = 0; i < select.options.length; i++) {
            if (select.options[i].value === nomeSetor) {
                select.selectedIndex = i;
                return;
            }
        }
        // Não encontrado: adiciona dinamicamente
        var opt = document.createElement('option');
        opt.value       = nomeSetor;
        opt.textContent = nomeSetor;
        select.insertBefore(opt, select.options[1]);
        select.value = nomeSetor;
    }

    function fecharBusca() {
        var lista = document.getElementById('busca-lista');
        lista.innerHTML  = '';
        lista.style.display = 'none';
    }

    // ── PRIORIDADE ────────────────────────────────────────────────

    function atualizarEstiloPrioridade() {
        var val = document.querySelector('input[name="prioridade"]:checked').value;
        document.getElementById('card-normal').querySelector('.prioridade-card-content').style.borderColor  = (val === 'normal')  ? '#28a745' : '';
        document.getElementById('card-urgente').querySelector('.prioridade-card-content').style.borderColor = (val === 'urgente') ? '#dc3545' : '';
    }

    // ── ENVIAR FORMULARIO ─────────────────────────────────────────

    function enviarFormulario(e) {
        e.preventDefault();
        if (estado.enviando) return;

        var tipoId   = document.getElementById('tipo-movimento-id').value;
        var tipoNome = document.getElementById('tipo-movimento-nome').value;
        var setor    = document.getElementById('select-setor').value;
        var destinoRaw = document.getElementById('select-destino').value;
        var destino  = destinoRaw === '__outro__'
            ? (document.getElementById('input-complemento').value.trim() || '')
            : destinoRaw;

        if (!tipoId)  { mostrarToast('Selecione o tipo de movimento', 'warning'); return; }
        if (!setor)   { mostrarToast('Selecione o setor de origem', 'warning'); return; }
        if (!destino) { mostrarToast('Selecione ou informe o setor de destino', 'warning'); return; }

        // Coleta dados do paciente: lista selecionada tem prioridade sobre manual
        var nmPaciente, nrAtend;
        if (estado.paciente) {
            nmPaciente = document.getElementById('hid-paciente').value.trim();
            nrAtend    = document.getElementById('hid-atendimento').value.trim();
        } else {
            nmPaciente = (document.getElementById('input-paciente').value || '').trim();
            nrAtend    = (document.getElementById('input-atendimento').value || '').trim();
        }

        var leito       = document.getElementById('input-leito').value.trim();
        var complemento = (destinoRaw !== '__outro__') ? document.getElementById('input-complemento').value.trim() : '';
        var prioridade  = document.querySelector('input[name="prioridade"]:checked').value;
        var obs         = document.getElementById('input-obs').value.trim();

        estado.enviando = true;
        var btnEnviar = document.getElementById('btn-enviar');
        btnEnviar.disabled = true;
        btnEnviar.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Enviando...';

        fetch(CONFIG.apiSolicitar, {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                tipo_movimento_id:   tipoId,
                tipo_movimento_nome: tipoNome,
                nm_paciente:         nmPaciente,
                nr_atendimento:      nrAtend,
                leito_origem:        leito,
                setor_origem_nome:   setor,
                destino_nome:        destino,
                destino_complemento: complemento,
                prioridade:          prioridade,
                observacao:          obs
            })
        })
        .then(function (r) { return r.json(); })
        .then(function (data) {
            if (data.success) {
                mostrarConfirmacao(data.chamado_id, tipoNome, setor, destino, prioridade);
                resetarFormulario();
            } else {
                mostrarToast(data.error || 'Erro ao enviar solicitacao', 'error');
            }
        })
        .catch(function () { mostrarToast('Erro de conexao. Tente novamente.', 'error'); })
        .finally(function () {
            estado.enviando = false;
            btnEnviar.disabled = false;
            btnEnviar.innerHTML = '<i class="fas fa-paper-plane"></i> Enviar Solicitacao';
        });
    }

    function resetarFormulario() {
        document.getElementById('form-chamado').reset();

        // Reset tipo
        document.getElementById('tipo-grid').querySelectorAll('.tipo-card').forEach(function (c) { c.classList.remove('selecionado'); });
        document.getElementById('tipo-movimento-id').value = '';
        document.getElementById('tipo-movimento-nome').value = '';
        estado.tipoSelecionado = null;

        // Reset destino
        document.getElementById('grupo-complemento').style.display = 'none';

        // Reset paciente
        estado.paciente   = null;
        estado.modoManual = false;
        document.getElementById('hid-paciente').value    = '';
        document.getElementById('hid-atendimento').value = '';
        document.getElementById('paciente-card').style.display        = 'none';
        document.getElementById('bloco-busca-paciente').style.display = '';
        document.getElementById('bloco-manual').style.display         = 'none';
        document.getElementById('input-busca-paciente').value = '';
        document.getElementById('btn-limpar-busca').style.display = 'none';
        document.getElementById('txt-toggle-manual').textContent = 'Digitar manualmente';
        document.getElementById('btn-toggle-manual').querySelector('i').className = 'fas fa-keyboard';
        fecharBusca();

        document.getElementById('count-obs').textContent = '0';
    }

    function mostrarConfirmacao(id, tipo, setor, destino, prioridade) {
        var detalhe = document.getElementById('confirmacao-detalhes');
        detalhe.innerHTML =
            '<div style="display:flex;flex-direction:column;gap:8px;">' +
            '<div style="display:flex;justify-content:space-between;"><span style="color:#6c757d;">Chamado Nº</span><strong>#' + id + '</strong></div>' +
            '<div style="display:flex;justify-content:space-between;"><span style="color:#6c757d;">Tipo</span><strong>' + escHtml(tipo) + '</strong></div>' +
            '<div style="display:flex;justify-content:space-between;"><span style="color:#6c757d;">Origem</span><strong>' + escHtml(setor) + '</strong></div>' +
            '<div style="display:flex;justify-content:space-between;"><span style="color:#6c757d;">Destino</span><strong>' + escHtml(destino) + '</strong></div>' +
            '<div style="display:flex;justify-content:space-between;"><span style="color:#6c757d;">Prioridade</span>' +
            (prioridade === 'urgente'
                ? '<span style="background:#dc3545;color:white;padding:2px 10px;border-radius:10px;font-size:12px;font-weight:700;">URGENTE</span>'
                : '<span style="background:#d4edda;color:#155724;padding:2px 10px;border-radius:10px;font-size:12px;font-weight:700;">Normal</span>') +
            '</div></div>';
        irParaTela('confirmacao');
    }

    // ── ACOMPANHAMENTO ────────────────────────────────────────────

    function carregarAcompanhamento() {
        var lista = document.getElementById('lista-acompanhamento');
        var vazio = document.getElementById('vazio-acompanhamento');

        fetch(CONFIG.apiMeusChamados, { credentials: 'same-origin' })
            .then(function (r) { return r.json(); })
            .then(function (data) {
                if (!data.success) { mostrarToast('Erro ao carregar chamados', 'error'); return; }
                var chamados = data.chamados;

                var ativos = chamados.filter(function (c) { return ['aguardando', 'aceito', 'em_transporte'].indexOf(c.status) !== -1; });
                document.getElementById('badge-ativos').textContent = ativos.length;

                if (chamados.length === 0) {
                    lista.style.display = 'none';
                    vazio.style.display = '';
                    return;
                }
                lista.style.display = '';
                vazio.style.display = 'none';
                lista.innerHTML = chamados.map(renderChamadoCard).join('');

                lista.querySelectorAll('.btn-cancelar-chamado').forEach(function (btn) {
                    btn.addEventListener('click', function () { abrirModalCancelar(parseInt(btn.dataset.id)); });
                });
            })
            .catch(function () { mostrarToast('Erro de conexao', 'error'); });
    }

    function renderChamadoCard(c) {
        var statusLabel = {
            aguardando:    '<i class="fas fa-clock"></i> Aguardando',
            aceito:        '<i class="fas fa-check"></i> Aceito',
            em_transporte: '<i class="fas fa-walking"></i> Em Transporte',
            concluido:     '<i class="fas fa-check-double"></i> Concluido',
            cancelado:     '<i class="fas fa-times"></i> Cancelado'
        }[c.status] || c.status;

        var podeCancelar = (c.status === 'aguardando' || c.status === 'aceito');
        var classeCard = c.status + (c.prioridade === 'urgente' ? ' urgente' : '');

        return '<div class="chamado-card ' + classeCard + '">' +
            '<div class="chamado-card-header">' +
                '<span class="chamado-badge-tipo">' + escHtml(c.tipo_movimento_nome || '-') + '</span>' +
                '<span class="chamado-badge-status status-' + c.status + '">' + statusLabel + '</span>' +
            '</div>' +
            '<div class="chamado-card-body">' +
                '<div class="chamado-info-principal">' +
                    (c.prioridade === 'urgente' ? '<span class="badge-urgente">URGENTE</span> ' : '') +
                    (c.nm_paciente ? escHtml(c.nm_paciente) : 'Paciente nao informado') +
                    (c.leito_origem ? ' <span style="color:#6c757d;font-weight:400;">Leito ' + escHtml(c.leito_origem) + '</span>' : '') +
                '</div>' +
                '<div class="chamado-info-rota">' +
                    '<i class="fas fa-map-marker-alt" style="color:#dc3545;"></i>' +
                    escHtml(c.setor_origem_nome || '-') +
                    ' <i class="fas fa-arrow-right" style="font-size:10px;"></i> ' +
                    escHtml(c.destino_nome || '-') +
                '</div>' +
                '<div class="chamado-info-meta">Aberto ' + formatarDataRelativa(c.criado_em) + '</div>' +
            '</div>' +
            '<div class="chamado-card-footer">' +
                '<span class="chamado-padioleiro">' +
                    (c.padioleiro_nome ? '<i class="fas fa-user"></i> ' + escHtml(c.padioleiro_nome) : '<i class="fas fa-hourglass-half"></i> Aguardando padioleiro') +
                '</span>' +
                (podeCancelar ? '<button class="btn-cancelar-chamado" data-id="' + c.id + '"><i class="fas fa-times"></i> Cancelar</button>' : '') +
            '</div>' +
        '</div>';
    }

    function carregarBadge() {
        fetch(CONFIG.apiMeusChamados, { credentials: 'same-origin' })
            .then(function (r) { return r.json(); })
            .then(function (data) {
                if (!data.success) return;
                var ativos = data.chamados.filter(function (c) {
                    return ['aguardando', 'aceito', 'em_transporte'].indexOf(c.status) !== -1;
                });
                document.getElementById('badge-ativos').textContent = ativos.length;
            })
            .catch(function () {});
    }

    // ── CANCELAMENTO ──────────────────────────────────────────────

    function abrirModalCancelar(id) {
        estado.chamadoCancelarId = id;
        document.getElementById('motivo-cancelamento').value = '';
        document.getElementById('modal-cancelar').style.display = '';
    }

    function fecharModalCancelar() {
        document.getElementById('modal-cancelar').style.display = 'none';
        estado.chamadoCancelarId = null;
    }

    function confirmarCancelamento() {
        var id = estado.chamadoCancelarId;
        if (!id) return;

        var motivo = document.getElementById('motivo-cancelamento').value.trim();
        if (motivo.length < 10) {
            mostrarToast('O motivo do cancelamento deve ter pelo menos 10 caracteres', 'warning');
            return;
        }

        var url    = CONFIG.apiCancelar.replace('{id}', id);

        document.getElementById('btn-cancelar-sim').disabled = true;

        fetch(url, {
            method: 'PUT',
            credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ motivo: motivo })
        })
        .then(function (r) { return r.json(); })
        .then(function (data) {
            if (data.success) {
                fecharModalCancelar();
                mostrarToast('Chamado cancelado', 'success');
                carregarAcompanhamento();
            } else {
                mostrarToast(data.error || 'Erro ao cancelar', 'error');
            }
        })
        .catch(function () { mostrarToast('Erro de conexao', 'error'); })
        .finally(function () {
            document.getElementById('btn-cancelar-sim').disabled = false;
        });
    }

    // ── UTILITARIOS ───────────────────────────────────────────────

    function formatarDataRelativa(isoStr) {
        if (!isoStr) return '--';
        var dt      = new Date(isoStr);
        var agora   = new Date();
        var diffMin = Math.floor((agora - dt) / 60000);
        if (diffMin < 1)  return 'agora mesmo';
        if (diffMin < 60) return 'ha ' + diffMin + ' min';
        var diffH = Math.floor(diffMin / 60);
        if (diffH < 24)   return 'ha ' + diffH + 'h';
        return dt.toLocaleDateString('pt-BR');
    }

    function escHtml(str) {
        if (!str) return '';
        return String(str)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;')
            .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    function mostrarToast(msg, tipo) {
        var container = document.getElementById('toast-container');
        var toast     = document.createElement('div');
        toast.className   = 'toast toast-' + (tipo || 'info');
        toast.textContent = msg;
        container.appendChild(toast);
        setTimeout(function () { toast.remove(); }, 3000);
    }

    // ── START ─────────────────────────────────────────────────────
    window.addEventListener('DOMContentLoaded', inicializar);
})();
