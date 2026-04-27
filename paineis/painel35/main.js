(function () {
    'use strict';

    var BASE_URL = window.location.origin;

    var CONFIG = {
        apiPadioleiros:  BASE_URL + '/api/paineis/painel35/padioleiros',
        apiFila:         BASE_URL + '/api/paineis/painel35/fila',
        apiAceitar:      BASE_URL + '/api/paineis/painel35/chamados/{id}/aceitar',
        apiIniciar:      BASE_URL + '/api/paineis/painel35/chamados/{id}/iniciar',
        apiConcluir:     BASE_URL + '/api/paineis/painel35/chamados/{id}/concluir',
        apiCancelarPad:  BASE_URL + '/api/paineis/painel35/chamados/{id}/cancelar',
        apiHistorico:    BASE_URL + '/api/paineis/painel35/historico-hoje',
        intervaloRefresh: 8000
    };

    var estado = {
        padioleiroId: null,
        padioleiros: [],
        chamadoAtivoId: null,
        chamadosAnteriores: [],
        refreshTimer: null,
        aceitandoId: null,
        agindo: false,
        telaAtual: 'principal'
    };

    // ── INICIALIZACAO ──────────────────────────────────────────────

    function inicializar() {
        document.getElementById('btn-voltar').addEventListener('click', function () { window.history.back(); });
        document.getElementById('btn-historico').addEventListener('click', function () { irParaTela('historico'); carregarHistorico(); });
        document.getElementById('btn-voltar-historico').addEventListener('click', function () { irParaTela('principal'); });
        document.getElementById('btn-aceitar-nao').addEventListener('click', fecharModalAceitar);
        document.getElementById('btn-aceitar-sim').addEventListener('click', confirmarAceite);
        document.getElementById('btn-cancelar-pad-nao').addEventListener('click', fecharModalCancelarPad);
        document.getElementById('btn-cancelar-pad-sim').addEventListener('click', confirmarCancelamentoPad);

        document.getElementById('select-padioleiro').addEventListener('change', function () {
            estado.padioleiroId = this.value || null;
            salvarPadioleiroLocal(estado.padioleiroId);
            carregarFila();
        });

        carregarPadioleiros();
        iniciarRefresh();
    }

    // ── NAVEGACAO ──────────────────────────────────────────────────

    function irParaTela(nome) {
        var mapa = { principal: 'tela-principal', historico: 'tela-historico' };
        Object.keys(mapa).forEach(function (k) {
            var el = document.getElementById(mapa[k]);
            if (el) el.style.display = (k === nome) ? '' : 'none';
        });
        estado.telaAtual = nome;
    }

    // ── PADIOLEIROS ───────────────────────────────────────────────

    function carregarPadioleiros() {
        fetch(CONFIG.apiPadioleiros, { credentials: 'same-origin' })
            .then(function (r) { return r.json(); })
            .then(function (data) {
                if (!data.success) return;
                estado.padioleiros = data.padioleiros;
                var select = document.getElementById('select-padioleiro');
                select.innerHTML = '<option value="">Selecione seu nome...</option>';
                data.padioleiros.forEach(function (p) {
                    var opt = document.createElement('option');
                    opt.value = p.id;
                    opt.textContent = p.nome + (p.turno && p.turno !== 'todos' ? ' (' + p.turno + ')' : '');
                    select.appendChild(opt);
                });
                var salvo = carregarPadioleiroLocal();
                if (salvo && data.padioleiros.some(function (p) { return String(p.id) === String(salvo); })) {
                    select.value = salvo;
                    estado.padioleiroId = salvo;
                }
                carregarFila();
            })
            .catch(function (e) { console.error('Erro padioleiros:', e); });
    }

    function salvarPadioleiroLocal(id) {
        try { localStorage.setItem('padioleiro_id_selecionado', id || ''); } catch (e) {}
    }

    function carregarPadioleiroLocal() {
        try { return localStorage.getItem('padioleiro_id_selecionado') || null; } catch (e) { return null; }
    }

    // ── FILA PRINCIPAL ────────────────────────────────────────────

    function iniciarRefresh() {
        carregarFila();
        estado.refreshTimer = setInterval(carregarFila, CONFIG.intervaloRefresh);
    }

    function carregarFila() {
        var url = CONFIG.apiFila;
        if (estado.padioleiroId) url += '?padioleiro_id=' + estado.padioleiroId;

        fetch(url, { credentials: 'same-origin' })
            .then(function (r) { return r.json(); })
            .then(function (data) {
                if (!data.success) return;
                atualizarStatusConexao(true);

                var novosChamados = data.aguardando || [];
                verificarNovosChamados(novosChamados);

                renderizarChamadoAtivo(data.chamado_ativo);
                renderizarFila(novosChamados);

                document.getElementById('fila-count').textContent = novosChamados.length;
                document.getElementById('badge-fila').textContent = novosChamados.length + ' na fila';
            })
            .catch(function () { atualizarStatusConexao(false); });
    }

    function verificarNovosChamados(lista) {
        if (estado.chamadosAnteriores.length === 0) {
            estado.chamadosAnteriores = lista.map(function (c) { return c.id; });
            return;
        }
        var idsAnteriores = estado.chamadosAnteriores;
        var novos = lista.filter(function (c) { return idsAnteriores.indexOf(c.id) === -1; });
        if (novos.length > 0) {
            emitirAlertaSonoro();
            mostrarAlertaNovoChamado(novos.length);
        }
        estado.chamadosAnteriores = lista.map(function (c) { return c.id; });
    }

    // ── CHAMADO ATIVO ─────────────────────────────────────────────

    function renderizarChamadoAtivo(chamado) {
        var secao = document.getElementById('secao-chamado-ativo');
        if (!chamado) {
            secao.style.display = 'none';
            estado.chamadoAtivoId = null;
            return;
        }

        secao.style.display = '';
        estado.chamadoAtivoId = chamado.id;

        var isAceito = chamado.status === 'aceito';
        var isTrans  = chamado.status === 'em_transporte';

        document.getElementById('icone-ativo').className = isAceito
            ? 'fas fa-check-circle' : 'fas fa-person-walking icone-vaivem';
        document.getElementById('titulo-ativo').textContent = isAceito
            ? 'Chamado Aceito' : 'Em Transporte';

        var espera = chamado.minutos_espera ? Math.round(chamado.minutos_espera) + ' min' : '--';

        var html =
            '<div class="ativo-header status-' + chamado.status + '">' +
                '<span class="ativo-status-badge badge-' + chamado.status + '">' +
                    (isAceito ? '<i class="fas fa-check"></i> Aceito' : '<i class="fas fa-running"></i> Em Transporte') +
                '</span>' +
                (chamado.prioridade === 'urgente'
                    ? '<span style="background:#dc3545;color:white;padding:3px 12px;border-radius:12px;font-size:12px;font-weight:700;"><i class="fas fa-bolt"></i> URGENTE</span>'
                    : '<span class="ativo-timer"><i class="fas fa-clock"></i> ' + espera + '</span>') +
            '</div>' +
            '<div class="ativo-body">' +
                '<div class="ativo-tipo">' + escHtml(chamado.tipo_movimento_nome || '-') + '</div>' +
                '<div class="ativo-paciente">' +
                    escHtml(chamado.nm_paciente || 'Paciente nao informado') +
                    (chamado.leito_origem ? ' <small>Leito ' + escHtml(chamado.leito_origem) + '</small>' : '') +
                    (chamado.nr_atendimento ? '<br><small style="color:#aaa;">Atend. ' + escHtml(chamado.nr_atendimento) + '</small>' : '') +
                '</div>' +
                '<div class="ativo-rota">' +
                    '<i class="fas fa-map-marker-alt" style="color:#dc3545;"></i>' +
                    '<span class="ativo-rota-origem">' + escHtml(chamado.setor_origem_nome || '-') + '</span>' +
                    '<span class="ativo-rota-seta"><i class="fas fa-long-arrow-alt-right"></i></span>' +
                    '<span class="ativo-rota-destino">' + escHtml(chamado.destino_nome || '-') + '</span>' +
                    (chamado.destino_complemento ? ' <small>(' + escHtml(chamado.destino_complemento) + ')</small>' : '') +
                '</div>' +
                (chamado.observacao ? '<div class="ativo-obs"><i class="fas fa-info-circle"></i> ' + escHtml(chamado.observacao) + '</div>' : '') +
                '<div style="font-size:12px;color:#aaa;">Solicitado por: ' + escHtml(chamado.solicitante_nome || '-') + '</div>' +
            '</div>' +
            '<div class="ativo-acoes">' +
                (isAceito
                    ? '<button class="btn-acao btn-iniciar" id="btn-iniciar-trans"><i class="fas fa-running"></i> Iniciar Transporte</button>'
                    : '') +
                (isTrans
                    ? '<button class="btn-acao btn-concluir" id="btn-concluir-trans"><i class="fas fa-check-double"></i> Concluir Transporte</button>'
                    : '') +
                '<button class="btn-acao btn-cancelar-pad" id="btn-cancelar-ativo" style="background:var(--danger);color:white;margin-top:10px;"><i class="fas fa-times"></i> Cancelar Chamado</button>' +
            '</div>';

        document.getElementById('chamado-ativo-card').innerHTML = html;

        var btnIniciar  = document.getElementById('btn-iniciar-trans');
        var btnConcluir = document.getElementById('btn-concluir-trans');
        var btnCancelar = document.getElementById('btn-cancelar-ativo');

        if (btnIniciar) btnIniciar.addEventListener('click', function () { executarAcao('iniciar', chamado.id, btnIniciar); });
        if (btnConcluir) btnConcluir.addEventListener('click', function () { executarAcao('concluir', chamado.id, btnConcluir); });
        if (btnCancelar) btnCancelar.addEventListener('click', function () { abrirModalCancelarPad(chamado.id); });
    }

    // ── FILA ──────────────────────────────────────────────────────

    function renderizarFila(lista) {
        var container = document.getElementById('lista-fila');
        var vazio     = document.getElementById('fila-vazia');

        if (!lista || lista.length === 0) {
            container.style.display = 'none';
            vazio.style.display = '';
            return;
        }
        container.style.display = '';
        vazio.style.display = 'none';

        container.innerHTML = lista.map(function (c) {
            var min    = c.minutos_espera || 0;
            var classeEspera = min > 30 ? 'critico' : (min > 15 ? 'atencao' : 'ok');
            var tempoLabel   = min < 1 ? 'Agora' : (min < 60 ? Math.round(min) + ' min' : Math.round(min / 60) + 'h ' + (Math.round(min) % 60) + 'min');

            return '<div class="fila-card ' + c.prioridade + '">' +
                '<div class="fila-card-header">' +
                    '<span class="fila-badge-tipo">' + escHtml(c.tipo_movimento_nome || '-') + '</span>' +
                    (c.prioridade === 'urgente'
                        ? '<span class="fila-badge-urgente"><i class="fas fa-exclamation-triangle"></i> URGENTE</span>'
                        : '<span class="fila-badge-normal"><i class="fas fa-clock"></i> Normal</span>') +
                '</div>' +
                '<div class="fila-card-body">' +
                    '<div class="fila-paciente">' +
                        escHtml(c.nm_paciente || 'Paciente nao informado') +
                        (c.leito_origem ? ' <span style="color:#6c757d;font-size:13px;font-weight:400;">Leito ' + escHtml(c.leito_origem) + '</span>' : '') +
                    '</div>' +
                    '<div class="fila-rota">' +
                        '<i class="fas fa-map-marker-alt" style="color:#dc3545;font-size:11px;"></i>' +
                        escHtml(c.setor_origem_nome || '-') +
                        ' <i class="fas fa-arrow-right" style="font-size:10px;"></i> ' +
                        '<strong>' + escHtml(c.destino_nome || '-') + '</strong>' +
                    '</div>' +
                    (c.observacao ? '<div class="fila-obs"><i class="fas fa-comment-dots"></i> ' + escHtml(c.observacao) + '</div>' : '') +
                '</div>' +
                '<div class="fila-card-footer">' +
                    '<span class="fila-solicitante"><i class="fas fa-user"></i> ' + escHtml(c.solicitante_nome || '-') + '</span>' +
                    '<span class="fila-espera ' + classeEspera + '"><i class="fas fa-stopwatch"></i> ' + tempoLabel + '</span>' +
                    '<button class="btn-cancelar-fila-pad" data-id="' + c.id + '" style="background:transparent;border:none;color:var(--danger);font-size:12px;cursor:pointer;margin-right:10px;"><i class="fas fa-times"></i> Cancelar</button>' +
                    '<button class="btn-aceitar-fila"' +
                        ' data-id="'       + c.id + '"' +
                        ' data-tipo="'     + escHtml(c.tipo_movimento_nome || '') + '"' +
                        ' data-paciente="' + escHtml(c.nm_paciente || '') + '"' +
                        ' data-setor="'    + escHtml(c.setor_origem_nome || '') + '"' +
                        ' data-leito="'    + escHtml(c.leito_origem || '') + '"' +
                        ' data-destino="'  + escHtml(c.destino_nome || '') + '"' +
                        ' data-prio="'     + c.prioridade + '">' +
                        '<i class="fas fa-hand-pointer"></i> Aceitar' +
                    '</button>' +
                '</div>' +
            '</div>';
        }).join('');

        container.querySelectorAll('.btn-aceitar-fila').forEach(function (btn) {
            btn.addEventListener('click', function () { abrirModalAceitar(btn); });
        });

        container.querySelectorAll('.btn-cancelar-fila-pad').forEach(function (btn) {
            btn.addEventListener('click', function () { abrirModalCancelarPad(parseInt(btn.dataset.id)); });
        });
    }

    // ── ACEITAR ───────────────────────────────────────────────────

    function abrirModalAceitar(btn) {
        if (!estado.padioleiroId) {
            mostrarToast('Selecione seu nome antes de aceitar um chamado', 'warning');
            return;
        }
        if (estado.chamadoAtivoId) {
            mostrarToast('Voce ja possui um chamado ativo. Conclua-o primeiro.', 'warning');
            return;
        }

        estado.aceitandoId = btn.dataset.id;

        var body = document.getElementById('modal-aceitar-body');
        var origemLabel = btn.dataset.setor || '-';
        if (btn.dataset.leito) origemLabel += '  •  Leito ' + btn.dataset.leito;
        body.innerHTML =
            '<div class="modal-chamado-info">' +
            criarModalRow('Tipo', btn.dataset.tipo) +
            criarModalRow('Paciente', btn.dataset.paciente || 'Nao informado') +
            criarModalRow('Setor de Origem', btn.dataset.setor || '-') +
            criarModalRow('Leito', btn.dataset.leito || '<span style="color:#aaa;">Nao informado</span>') +
            criarModalRow('Destino', btn.dataset.destino) +
            criarModalRow('Prioridade', btn.dataset.prio === 'urgente'
                ? '<span style="background:#dc3545;color:white;padding:2px 10px;border-radius:10px;font-size:12px;font-weight:700;">URGENTE</span>'
                : '<span style="background:#d4edda;color:#155724;padding:2px 10px;border-radius:10px;font-size:12px;">Normal</span>') +
            '</div>';

        document.getElementById('modal-aceitar').style.display = '';
    }

    function criarModalRow(label, value) {
        return '<div class="modal-row"><span class="modal-label">' + escHtml(label) + '</span><span class="modal-value">' + (value || '-') + '</span></div>';
    }

    function fecharModalAceitar() {
        document.getElementById('modal-aceitar').style.display = 'none';
        estado.aceitandoId = null;
    }

    function confirmarAceite() {
        var id = estado.aceitandoId;
        if (!id || !estado.padioleiroId) return;

        var btn = document.getElementById('btn-aceitar-sim');
        btn.disabled = true;
        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Aceitando...';

        var url = CONFIG.apiAceitar.replace('{id}', id);
        fetch(url, {
            method: 'PUT',
            credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ padioleiro_id: parseInt(estado.padioleiroId) })
        })
        .then(function (r) { return r.json(); })
        .then(function (data) {
            fecharModalAceitar();
            if (data.success) {
                mostrarToast('Chamado aceito! Va ate o setor.', 'success');
                carregarFila();
            } else {
                mostrarToast(data.error || 'Erro ao aceitar chamado', 'error');
            }
        })
        .catch(function () { mostrarToast('Erro de conexao', 'error'); })
        .finally(function () {
            btn.disabled = false;
            btn.innerHTML = '<i class="fas fa-check"></i> Aceitar';
        });
    }

    // ── ACOES DO CHAMADO ATIVO ────────────────────────────────────

    function executarAcao(acao, id, btn) {
        if (estado.agindo) return;
        estado.agindo = true;
        btn.disabled = true;
        var textoOriginal = btn.innerHTML;
        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Aguarde...';

        var url = (acao === 'iniciar' ? CONFIG.apiIniciar : CONFIG.apiConcluir).replace('{id}', id);
        fetch(url, {
            method: 'PUT',
            credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json' }
        })
        .then(function (r) { return r.json(); })
        .then(function (data) {
            if (data.success) {
                mostrarToast(data.message || 'Acao realizada com sucesso', 'success');
                if (acao === 'concluir') estado.chamadoAtivoId = null;
                carregarFila();
            } else {
                mostrarToast(data.error || 'Erro na acao', 'error');
                btn.disabled = false;
                btn.innerHTML = textoOriginal;
            }
        })
        .catch(function () {
            mostrarToast('Erro de conexao', 'error');
            btn.disabled = false;
            btn.innerHTML = textoOriginal;
        })
        .finally(function () { estado.agindo = false; });
    }

    // ── CANCELAR ──────────────────────────────────────────────────

    function abrirModalCancelarPad(id) {
        estado.chamadoCancelarId = id;
        document.getElementById('motivo-cancelamento-pad').value = '';
        document.getElementById('modal-cancelar').style.display = '';
    }

    function fecharModalCancelarPad() {
        document.getElementById('modal-cancelar').style.display = 'none';
        estado.chamadoCancelarId = null;
    }

    function confirmarCancelamentoPad() {
        var id = estado.chamadoCancelarId;
        if (!id || !estado.padioleiroId) return;

        var motivo = document.getElementById('motivo-cancelamento-pad').value.trim();
        if (motivo.length < 10) {
            mostrarToast('O motivo do cancelamento deve ter pelo menos 10 caracteres', 'warning');
            return;
        }

        var btn = document.getElementById('btn-cancelar-pad-sim');
        btn.disabled = true;
        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Cancelando...';

        var url = CONFIG.apiCancelarPad.replace('{id}', id);
        fetch(url, {
            method: 'PUT',
            credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                padioleiro_id: parseInt(estado.padioleiroId),
                motivo: motivo
            })
        })
        .then(function (r) { return r.json(); })
        .then(function (data) {
            fecharModalCancelarPad();
            if (data.success) {
                mostrarToast('Chamado cancelado com sucesso.', 'success');
                if (id === estado.chamadoAtivoId) estado.chamadoAtivoId = null;
                carregarFila();
            } else {
                mostrarToast(data.error || 'Erro ao cancelar chamado', 'error');
            }
        })
        .catch(function () { mostrarToast('Erro de conexao', 'error'); })
        .finally(function () {
            btn.disabled = false;
            btn.innerHTML = '<i class="fas fa-times"></i> Confirmar Cancelamento';
        });
    }

    // ── HISTORICO ─────────────────────────────────────────────────

    function carregarHistorico() {
        if (!estado.padioleiroId) {
            document.getElementById('lista-historico').innerHTML = '<p style="padding:20px;color:#aaa;text-align:center;">Selecione seu nome para ver o historico.</p>';
            return;
        }

        fetch(CONFIG.apiHistorico + '?padioleiro_id=' + estado.padioleiroId, { credentials: 'same-origin' })
            .then(function (r) { return r.json(); })
            .then(function (data) {
                if (!data.success) return;
                var chamados = data.chamados;
                renderizarHistorico(chamados);
            })
            .catch(function () { mostrarToast('Erro ao carregar historico', 'error'); });
    }

    function renderizarHistorico(chamados) {
        var lista = document.getElementById('lista-historico');
        var vazio = document.getElementById('historico-vazio');
        var resumo = document.getElementById('historico-resumo');

        var concluidos = chamados.filter(function (c) { return c.status === 'concluido'; });
        var tempos = concluidos.filter(function (c) { return c.tempo_transporte_min; }).map(function (c) { return c.tempo_transporte_min; });
        var mediaMin = tempos.length > 0 ? (tempos.reduce(function (a, b) { return a + b; }, 0) / tempos.length) : 0;

        resumo.innerHTML =
            '<div class="hist-stat"><div class="hist-stat-num">' + chamados.length + '</div><div class="hist-stat-label">Total</div></div>' +
            '<div class="hist-stat"><div class="hist-stat-num" style="color:#28a745;">' + concluidos.length + '</div><div class="hist-stat-label">Concluidos</div></div>' +
            '<div class="hist-stat"><div class="hist-stat-num" style="color:#17a2b8;">' + (mediaMin > 0 ? Math.round(mediaMin) + 'min' : '--') + '</div><div class="hist-stat-label">Tempo Medio</div></div>';

        if (chamados.length === 0) {
            lista.style.display = 'none';
            vazio.style.display = '';
            return;
        }
        lista.style.display = '';
        vazio.style.display = 'none';

        lista.innerHTML = chamados.map(function (c) {
            var tempoLabel = c.tempo_transporte_min ? Math.round(c.tempo_transporte_min) + ' min' : '--';
            var hora = c.criado_em ? new Date(c.criado_em).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '--';
            return '<div class="hist-card ' + (c.status === 'cancelado' ? 'cancelado' : '') + '">' +
                '<div class="hist-card-header">' +
                    '<span class="hist-tipo">' + escHtml(c.tipo_movimento_nome || '-') + '</span>' +
                    (c.status === 'concluido' ? '<span class="hist-tempo"><i class="fas fa-clock"></i> ' + tempoLabel + '</span>' : '<span style="background:#f8f9fa;color:#6c757d;padding:2px 8px;border-radius:8px;font-size:12px;">' + c.status + '</span>') +
                '</div>' +
                '<div class="hist-paciente">' + escHtml(c.nm_paciente || 'Paciente nao informado') + '</div>' +
                '<div class="hist-rota">' +
                    '<i class="fas fa-map-marker-alt" style="color:#dc3545;font-size:10px;"></i>' +
                    escHtml(c.setor_origem_nome || '-') + ' → ' + escHtml(c.destino_nome || '-') +
                '</div>' +
                '<div class="hist-horario"><i class="fas fa-clock"></i> ' + hora + '</div>' +
            '</div>';
        }).join('');
    }

    // ── ALERTAS ───────────────────────────────────────────────────

    function emitirAlertaSonoro() {
        try {
            var ctx = new (window.AudioContext || window.webkitAudioContext)();
            [440, 550, 660].forEach(function (freq, i) {
                var osc = ctx.createOscillator();
                var gain = ctx.createGain();
                osc.connect(gain);
                gain.connect(ctx.destination);
                osc.frequency.value = freq;
                gain.gain.setValueAtTime(0.3, ctx.currentTime + i * 0.15);
                gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + i * 0.15 + 0.3);
                osc.start(ctx.currentTime + i * 0.15);
                osc.stop(ctx.currentTime + i * 0.15 + 0.3);
            });
        } catch (e) {}
    }

    function mostrarAlertaNovoChamado(qtd) {
        var alerta = document.createElement('div');
        alerta.className = 'alerta-novo';
        alerta.innerHTML = '<i class="fas fa-bell"></i> ' + qtd + ' novo' + (qtd > 1 ? 's' : '') + ' chamado' + (qtd > 1 ? 's' : '') + ' na fila!';
        document.body.appendChild(alerta);
        setTimeout(function () { alerta.remove(); }, 4000);
    }

    function atualizarStatusConexao(online) {
        var el = document.getElementById('status-conexao');
        if (online) { el.className = 'status-online'; el.title = 'Conectado'; }
        else { el.className = 'status-online status-offline'; el.title = 'Sem conexao'; }
    }

    // ── UTILITARIOS ───────────────────────────────────────────────

    function escHtml(str) {
        if (!str) return '';
        return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    function mostrarToast(msg, tipo) {
        var container = document.getElementById('toast-container');
        var toast = document.createElement('div');
        toast.className = 'toast toast-' + (tipo || 'info');
        toast.textContent = msg;
        container.appendChild(toast);
        setTimeout(function () { toast.remove(); }, 3500);
    }

    window.addEventListener('DOMContentLoaded', inicializar);
})();
