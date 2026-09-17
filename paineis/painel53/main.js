/* Painel 53 - Tela do Motorista - Transporte de Material — ES5 IIFE */
(function () {
    'use strict';

    var CONFIG = {
        api: '/api/paineis/painel53',
        refreshInterval: 15000
    };

    var Estado = {
        motoristas: [],
        motoristaSelecionado: null,
        veiculos: [],
        veiculoId: null,
        veiculoPlaca: '',
        chamadosAtivos: [],      // todos em_transporte do motorista
        fila: [],
        selecionados: [],        // IDs marcados na fila para nova viagem
        chamadoAcaoId: null,     // ID do chamado sendo entregue/cancelado
        fotoCargaAtual: null,    // foto da carga (painel52) para mostrar na entrega
        // viagem
        fotoInicioCapturada: null,
        requerFotoInicio: false,
        requerAssinaturaMotorista: false,
        // pads
        signaturePadMotorista: null,
        signaturePadDestinatario: null,
        timerFila: null
    };

    var DOM = {};

    // ── helpers ──────────────────────────────────────────

    function escHtml(s) {
        if (s == null) return '';
        return String(s)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function toast(msg, tipo) {
        var tc = document.getElementById('toast-container');
        if (!tc) return;
        var t = document.createElement('div');
        t.className = 'toast toast-' + (tipo || 'info');
        t.textContent = msg;
        tc.appendChild(t);
        setTimeout(function () { if (t.parentNode) t.parentNode.removeChild(t); }, 3500);
    }

    function mostrarTela(id) {
        var telas = ['tela-selecao', 'tela-motorista'];
        for (var i = 0; i < telas.length; i++) {
            var el = document.getElementById(telas[i]);
            if (el) el.style.display = (telas[i] === id) ? '' : 'none';
        }
    }

    function fecharModal(id) {
        var el = document.getElementById(id);
        if (el) el.style.display = 'none';
    }

    function abrirModal(id) {
        var el = document.getElementById(id);
        if (el) el.style.display = 'flex';
    }

    function setLoading(btn, loading) {
        if (!btn) return;
        btn.disabled = loading;
        if (loading) {
            btn._textoOriginal = btn.innerHTML;
            btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Aguarde...';
        } else if (btn._textoOriginal) {
            btn.innerHTML = btn._textoOriginal;
        }
    }

    // ── compressão de imagem (Canvas API) ────────────────

    function comprimirImagem(file, callback) {
        var reader = new FileReader();
        reader.onload = function (e) {
            var img = new Image();
            img.onload = function () {
                var maxW = 800, maxH = 600;
                var w = img.width, h = img.height;
                if (w > maxW) { h = Math.round(h * maxW / w); w = maxW; }
                if (h > maxH) { w = Math.round(w * maxH / h); h = maxH; }
                var canvas = document.createElement('canvas');
                canvas.width = w; canvas.height = h;
                canvas.getContext('2d').drawImage(img, 0, 0, w, h);
                callback(canvas.toDataURL('image/jpeg', 0.7));
            };
            img.src = e.target.result;
        };
        reader.readAsDataURL(file);
    }

    // ── carregar veículos e motoristas ───────────────────

    function carregarVeiculos() {
        fetch(CONFIG.api + '/veiculos', { credentials: 'same-origin' })
            .then(function (r) { return r.json(); })
            .then(function (data) {
                if (!data.success) return;
                Estado.veiculos = data.veiculos || [];
                var sel = document.getElementById('select-veiculo');
                if (!sel) return;
                sel.innerHTML = '<option value="">Nenhum / Nao se aplica</option>';
                for (var i = 0; i < Estado.veiculos.length; i++) {
                    var v = Estado.veiculos[i];
                    var label = escHtml(v.tipo.toUpperCase()) + ' - ' + escHtml(v.placa || '');
                    if (v.descricao) label += ' (' + escHtml(v.descricao) + ')';
                    var opt = document.createElement('option');
                    opt.value = v.id;
                    opt.textContent = label;
                    sel.appendChild(opt);
                }
            })
            .catch(function () {});
    }

    function carregarMotoristas() {
        fetch(CONFIG.api + '/motoristas', { credentials: 'same-origin' })
            .then(function (r) { return r.json(); })
            .then(function (data) {
                if (!data.success) return;
                Estado.motoristas = data.motoristas || [];
                var sel = document.getElementById('select-motorista');
                if (!sel) return;
                sel.innerHTML = '<option value="">Selecione o motorista...</option>';
                for (var i = 0; i < Estado.motoristas.length; i++) {
                    var m = Estado.motoristas[i];
                    var opt = document.createElement('option');
                    opt.value = m.id;
                    opt.textContent = m.nome + (m.matricula ? ' (' + m.matricula + ')' : '');
                    sel.appendChild(opt);
                }
            })
            .catch(function () {});
    }

    // ── entrar / sair ────────────────────────────────────

    function entrar() {
        var selMot = document.getElementById('select-motorista');
        var selVei = document.getElementById('select-veiculo');
        var motId  = selMot ? selMot.value : '';
        if (!motId) { toast('Selecione um motorista.', 'warning'); return; }

        var motorista = null;
        for (var i = 0; i < Estado.motoristas.length; i++) {
            if (String(Estado.motoristas[i].id) === String(motId)) {
                motorista = Estado.motoristas[i]; break;
            }
        }
        if (!motorista) { toast('Motorista nao encontrado.', 'error'); return; }

        Estado.motoristaSelecionado = motorista;

        var veiId = selVei ? selVei.value : '';
        Estado.veiculoId = veiId ? parseInt(veiId, 10) : null;
        Estado.veiculoPlaca = '';
        if (veiId) {
            for (var j = 0; j < Estado.veiculos.length; j++) {
                if (String(Estado.veiculos[j].id) === String(veiId)) {
                    Estado.veiculoPlaca = Estado.veiculos[j].placa || '';
                    break;
                }
            }
        }

        var nomeEl  = document.getElementById('motorista-nome-display');
        var turnoEl = document.getElementById('motorista-turno-display');
        if (nomeEl)  nomeEl.textContent  = motorista.nome;
        if (turnoEl) turnoEl.textContent = motorista.turno ? 'Turno: ' + motorista.turno : '';

        mostrarTela('tela-motorista');
        Estado.selecionados = [];
        carregarFila();
        Estado.timerFila = setInterval(carregarFila, CONFIG.refreshInterval);
    }

    function sair() {
        if (Estado.timerFila) { clearInterval(Estado.timerFila); Estado.timerFila = null; }
        Estado.motoristaSelecionado = null;
        Estado.veiculoId = null;
        Estado.veiculoPlaca = '';
        Estado.chamadosAtivos = [];
        Estado.fila = [];
        Estado.selecionados = [];
        Estado.fotoCargaAtual = null;
        Estado.fotoInicioCapturada = null;
        Estado.requerFotoInicio = false;
        Estado.requerAssinaturaMotorista = false;
        mostrarTela('tela-selecao');
        var selMot = document.getElementById('select-motorista');
        var selVei = document.getElementById('select-veiculo');
        if (selMot) selMot.value = '';
        if (selVei) selVei.value = '';
    }

    // ── carregar fila ────────────────────────────────────

    function carregarFila() {
        var motId = Estado.motoristaSelecionado ? Estado.motoristaSelecionado.id : '';
        var url   = CONFIG.api + '/fila' + (motId ? '?motorista_id=' + motId : '');
        fetch(url, { credentials: 'same-origin' })
            .then(function (r) { return r.json(); })
            .then(function (data) {
                if (!data.success) { toast('Erro ao atualizar fila.', 'error'); return; }
                Estado.fila          = data.fila          || [];
                Estado.chamadosAtivos = data.chamados_ativos || [];
                renderizarAtivos();
                renderizarFila();
                carregarHistorico();
            })
            .catch(function () { toast('Erro de conexao.', 'error'); });
    }

    // ── renderizar chamados ativos ────────────────────────

    function renderizarAtivos() {
        var area  = document.getElementById('area-ativos');
        var lista = document.getElementById('chamados-ativos-lista');
        if (!area || !lista) return;

        if (!Estado.chamadosAtivos || Estado.chamadosAtivos.length === 0) {
            area.style.display = 'none';
            return;
        }
        area.style.display = '';
        var html = '';
        for (var i = 0; i < Estado.chamadosAtivos.length; i++) {
            var c = Estado.chamadosAtivos[i];
            var corBorda = c.tipo_carga_cor ? 'border-left:4px solid ' + escHtml(c.tipo_carga_cor) + ';' : '';
            var badgePrio = c.prioridade === 'urgente'
                ? '<span class="badge-urgente"><i class="fas fa-exclamation-triangle"></i> URGENTE</span>' : '';
            var badgeAgendAtivo = '';
            if (c.tipo_solicitacao === 'agendado' && c.dt_agendamento) {
                var dtAgA = new Date(c.dt_agendamento);
                var agLbl = dtAgA.toLocaleDateString('pt-BR') + ' ' +
                    dtAgA.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
                badgeAgendAtivo = '<span class="badge-agendado" style="background:#0d6efd;">' +
                    '<i class="fas fa-calendar-clock"></i> Agendado: ' + escHtml(agLbl) + '</span>';
            }
            html += '<div class="chamado-ativo-card" data-id="' + escHtml(String(c.id)) + '" style="' + corBorda + '">' +
                '<div class="chamado-ativo-header">' +
                    '<span class="chamado-protocolo"><i class="fas fa-hashtag"></i> ' + escHtml(c.nr_protocolo) + '</span>' +
                    badgePrio + badgeAgendAtivo +
                '</div>' +
                '<div class="chamado-tipo-nome">' +
                    (c.tipo_carga_icone ? '<i class="fas ' + escHtml(c.tipo_carga_icone) + '"></i> ' : '') +
                    escHtml(c.tipo_carga_nome) +
                '</div>' +
                '<div class="chamado-rota">' +
                    '<i class="fas fa-map-marker-alt"></i> ' + escHtml(c.setor_origem_nome) +
                    ' <i class="fas fa-arrow-right"></i> ' + escHtml(c.destino_nome) +
                    (c.destino_complemento ? ' — ' + escHtml(c.destino_complemento) : '') +
                '</div>' +
                '<div class="chamado-ativo-acoes">';

            if (c.requer_lista_itens) {
                html += '<button class="btn-acao btn-itens" data-id="' + c.id + '">' +
                    '<i class="fas fa-list-ul"></i> Itens</button>';
            }
            if (c.requer_assinatura) {
                html += '<button class="btn-acao btn-entregar-assin" data-id="' + c.id +
                    '" data-foto="' + escHtml(c.foto_carga || '') + '">' +
                    '<i class="fas fa-signature"></i> Entregar</button>';
            } else {
                html += '<button class="btn-acao btn-entregar" data-id="' + c.id +
                    '" data-foto="' + escHtml(c.foto_carga || '') + '">' +
                    '<i class="fas fa-box-open"></i> Entregar</button>';
            }
            html += '<button class="btn-acao btn-cancelar-chamado" data-id="' + c.id + '">' +
                '<i class="fas fa-times"></i> Cancelar</button>';
            html += '</div></div>';
        }
        lista.innerHTML = html;

        // Eventos
        var btnsItens = lista.querySelectorAll('.btn-itens');
        for (var j = 0; j < btnsItens.length; j++) {
            btnsItens[j].addEventListener('click', function () {
                verItens(parseInt(this.getAttribute('data-id'), 10));
            });
        }
        var btnsEntr = lista.querySelectorAll('.btn-entregar');
        for (var k = 0; k < btnsEntr.length; k++) {
            btnsEntr[k].addEventListener('click', function () {
                abrirEntrega(parseInt(this.getAttribute('data-id'), 10),
                             this.getAttribute('data-foto') || null);
            });
        }
        var btnsEntrAssin = lista.querySelectorAll('.btn-entregar-assin');
        for (var l = 0; l < btnsEntrAssin.length; l++) {
            btnsEntrAssin[l].addEventListener('click', function () {
                abrirEntregaAssinatura(parseInt(this.getAttribute('data-id'), 10),
                                       this.getAttribute('data-foto') || null);
            });
        }
        var btnsCancelActivo = lista.querySelectorAll('.btn-cancelar-chamado');
        for (var m = 0; m < btnsCancelActivo.length; m++) {
            btnsCancelActivo[m].addEventListener('click', function () {
                abrirCancelar(parseInt(this.getAttribute('data-id'), 10));
            });
        }
    }

    // ── renderizar fila ───────────────────────────────────

    function renderizarFila() {
        var lista = document.getElementById('fila-lista');
        var vazia = document.getElementById('fila-vazia');
        var total = document.getElementById('fila-total');
        if (!lista) return;

        if (total) total.textContent = Estado.fila.length + ' chamado(s)';

        if (Estado.fila.length === 0) {
            lista.innerHTML = '';
            if (vazia) vazia.style.display = '';
            atualizarBarraSelecao();
            return;
        }
        if (vazia) vazia.style.display = 'none';

        var html = '';
        for (var i = 0; i < Estado.fila.length; i++) {
            var c = Estado.fila[i];
            var selecionado = Estado.selecionados.indexOf(c.id) !== -1;
            var corBorda = c.tipo_carga_cor ? 'border-left:4px solid ' + escHtml(c.tipo_carga_cor) + ';' : '';
            var badgePrio = c.prioridade === 'urgente'
                ? '<span class="badge-urgente"><i class="fas fa-exclamation-triangle"></i> URGENTE</span>' : '';
            var badgeAgend = '';
            if (c.tipo_solicitacao === 'agendado' && c.dt_agendamento) {
                var dtAgend = new Date(c.dt_agendamento);
                var agendLabel = dtAgend.toLocaleDateString('pt-BR') + ' ' +
                    dtAgend.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
                var agora = new Date();
                var diffMin = Math.round((dtAgend - agora) / 60000);
                var agendColor = diffMin < 0 ? '#dc3545' : (diffMin < 60 ? '#fd7e14' : '#0d6efd');
                badgeAgend = '<span class="badge-agendado" style="background:' + agendColor + ';">' +
                    '<i class="fas fa-calendar-clock"></i> ' + escHtml(agendLabel) + '</span>';
            }
            var mins = c.minutos_espera != null ? (' | <i class="fas fa-clock"></i> ' + escHtml(String(c.minutos_espera)) + ' min') : '';

            html += '<div class="fila-card' + (selecionado ? ' fila-card-selecionado' : '') +
                '" data-id="' + escHtml(String(c.id)) + '" style="' + corBorda + '">' +
                '<label class="fila-card-check-label">' +
                    '<input type="checkbox" class="fila-checkbox" data-id="' + escHtml(String(c.id)) + '"' +
                        (selecionado ? ' checked' : '') + '>' +
                    '<div class="fila-card-body">' +
                        '<div class="fila-card-header">' +
                            '<span class="chamado-protocolo"><i class="fas fa-hashtag"></i> ' + escHtml(c.nr_protocolo) + '</span>' +
                            badgePrio + badgeAgend +
                        '</div>' +
                        '<div class="chamado-tipo-nome">' +
                            (c.tipo_carga_icone ? '<i class="fas ' + escHtml(c.tipo_carga_icone) + '"></i> ' : '') +
                            escHtml(c.tipo_carga_nome) +
                        '</div>' +
                        '<div class="chamado-rota">' +
                            '<i class="fas fa-map-marker-alt"></i> ' + escHtml(c.setor_origem_nome) +
                            ' <i class="fas fa-arrow-right"></i> ' + escHtml(c.destino_nome) +
                            (c.destino_complemento ? ' — ' + escHtml(c.destino_complemento) : '') +
                        '</div>' +
                        '<div class="chamado-meta" style="font-size:12px;color:#888;">' +
                            '<i class="fas fa-user"></i> ' + escHtml(c.solicitante_nome) + mins +
                        '</div>' +
                    '</div>' +
                '</label>' +
                '</div>';
        }
        lista.innerHTML = html;

        // Eventos nos checkboxes
        var checks = lista.querySelectorAll('.fila-checkbox');
        for (var j = 0; j < checks.length; j++) {
            checks[j].addEventListener('change', function () {
                var id = parseInt(this.getAttribute('data-id'), 10);
                var idx = Estado.selecionados.indexOf(id);
                if (this.checked) {
                    if (idx === -1) Estado.selecionados.push(id);
                } else {
                    if (idx !== -1) Estado.selecionados.splice(idx, 1);
                }
                var card = this.closest ? this.closest('.fila-card') : null;
                if (!card) {
                    card = this.parentNode;
                    while (card && !card.classList.contains('fila-card')) card = card.parentNode;
                }
                if (card) {
                    if (this.checked) card.classList.add('fila-card-selecionado');
                    else card.classList.remove('fila-card-selecionado');
                }
                atualizarBarraSelecao();
            });
        }
        atualizarBarraSelecao();
    }

    function atualizarBarraSelecao() {
        var barra = document.getElementById('barra-selecao');
        var count = document.getElementById('barra-selecao-count');
        if (!barra) return;
        var n = Estado.selecionados.length;
        // Só mostra a barra se não há chamados ativos OU se está no modo fila
        if (n > 0 && Estado.chamadosAtivos.length === 0) {
            barra.style.display = 'flex';
            if (count) count.textContent = n + ' selecionado(s)';
        } else {
            barra.style.display = 'none';
        }
    }

    // ── histórico ────────────────────────────────────────

    function carregarHistorico() {
        var motId = Estado.motoristaSelecionado ? Estado.motoristaSelecionado.id : '';
        if (!motId) return;
        fetch(CONFIG.api + '/historico-hoje?motorista_id=' + motId, { credentials: 'same-origin' })
            .then(function (r) { return r.json(); })
            .then(function (data) {
                if (!data.success) return;
                var lista = document.getElementById('historico-lista');
                if (!lista) return;
                if (!data.chamados || data.chamados.length === 0) {
                    lista.innerHTML = '<div class="historico-vazio">Nenhum registro hoje</div>';
                    return;
                }
                var html = '';
                for (var i = 0; i < data.chamados.length; i++) {
                    var c = data.chamados[i];
                    var statusCls = c.status === 'entregue' ? 'status-entregue' :
                                    c.status === 'cancelado' ? 'status-cancelado' : 'status-andamento';
                    var parcialBadge = c.entrega_parcial
                        ? '<span class="badge-parcial"><i class="fas fa-exclamation-triangle"></i> Parcial</span>' : '';
                    html += '<div class="historico-item">' +
                        '<div class="historico-item-header">' +
                            '<span class="historico-protocolo">' + escHtml(c.nr_protocolo) + '</span>' +
                            '<span class="historico-status ' + statusCls + '">' + escHtml(c.status) + '</span>' +
                            parcialBadge +
                        '</div>' +
                        '<div class="historico-rota">' +
                            escHtml(c.setor_origem_nome) + ' → ' + escHtml(c.destino_nome) +
                        '</div>' +
                        (c.nm_destinatario ? '<div class="historico-dest"><i class="fas fa-user-check"></i> ' + escHtml(c.nm_destinatario) + '</div>' : '') +
                        '</div>';
                }
                lista.innerHTML = html;
            })
            .catch(function () {});
    }

    // ── Iniciar Viagem ────────────────────────────────────

    // Estado dos itens na viagem: { chamadoId: [ {id, descricao, aceito, motivo} ] }
    var _itensViagem = {};

    function abrirIniciarViagem() {
        if (Estado.selecionados.length === 0) {
            toast('Selecione pelo menos um chamado.', 'warning'); return;
        }

        // Verificar flags dos tipos selecionados
        Estado.requerFotoInicio = false;
        Estado.requerAssinaturaMotorista = false;
        var chamadosComItens = [];
        for (var i = 0; i < Estado.fila.length; i++) {
            var c = Estado.fila[i];
            if (Estado.selecionados.indexOf(c.id) === -1) continue;
            if (c.requer_foto_inicio)           Estado.requerFotoInicio = true;
            if (c.requer_assinatura_motorista)  Estado.requerAssinaturaMotorista = true;
            if (c.requer_lista_itens)           chamadosComItens.push(c);
        }

        // Resetar estado de itens
        _itensViagem = {};

        // Calcular numeração dos passos
        var passoBase = 1;
        var itensSecao  = document.getElementById('viagem-itens-secao');
        var passoItens  = document.getElementById('viagem-passo-itens-num');
        var fotoSecao   = document.getElementById('viagem-foto-secao');
        var passoAssin  = document.getElementById('viagem-passo-assin-num');

        if (chamadosComItens.length > 0) {
            if (itensSecao) itensSecao.style.display = '';
            if (passoItens) passoItens.textContent = String(passoBase++);
        } else {
            if (itensSecao) itensSecao.style.display = 'none';
        }
        if (Estado.requerFotoInicio) {
            if (fotoSecao) {
                fotoSecao.style.display = '';
                var passoFotoSpan = fotoSecao.querySelector('.viagem-passo-num');
                if (passoFotoSpan) passoFotoSpan.textContent = String(passoBase++);
            }
        } else {
            if (fotoSecao) fotoSecao.style.display = 'none';
        }

        var assinSecao = document.getElementById('viagem-assinatura-secao');
        if (Estado.requerAssinaturaMotorista) {
            if (assinSecao) assinSecao.style.display = '';
            if (passoAssin) passoAssin.textContent = String(passoBase);
        } else {
            if (assinSecao) assinSecao.style.display = 'none';
        }

        // Montar resumo dos chamados selecionados
        var resumoEl = document.getElementById('viagem-resumo');
        if (resumoEl) {
            var html = '<div class="viagem-resumo-titulo"><i class="fas fa-clipboard-list"></i> Chamados selecionados (' +
                Estado.selecionados.length + ')</div><ul class="viagem-resumo-lista">';
            for (var j = 0; j < Estado.fila.length; j++) {
                var cf = Estado.fila[j];
                if (Estado.selecionados.indexOf(cf.id) !== -1) {
                    html += '<li><i class="fas fa-hashtag"></i> ' + escHtml(cf.nr_protocolo) +
                        ' — ' + escHtml(cf.tipo_carga_nome) +
                        ' → ' + escHtml(cf.destino_nome) + '</li>';
                }
            }
            html += '</ul>';
            resumoEl.innerHTML = html;
        }

        // Resetar foto e assinatura
        Estado.fotoInicioCapturada = null;
        var prevFoto = document.getElementById('viagem-foto-preview');
        var btnFoto  = document.getElementById('viagem-btn-tirar-foto');
        if (prevFoto) prevFoto.style.display = 'none';
        if (btnFoto)  btnFoto.style.display  = '';
        if (Estado.signaturePadMotorista) Estado.signaturePadMotorista.clear();

        abrirModal('modal-iniciar-viagem');
        inicializarPadMotorista();

        // Carregar itens de cada chamado com lista
        if (chamadosComItens.length > 0) {
            carregarItensViagem(chamadosComItens);
        }
    }

    function carregarItensViagem(chamadosComItens) {
        var lista = document.getElementById('viagem-itens-lista');
        if (!lista) return;
        lista.innerHTML = '<div class="loading-inline"><div class="loading-spinner-sm"></div> Carregando itens...</div>';

        var resultados = {};
        var pendentes  = chamadosComItens.length;

        function renderTodos() {
            var html = '';
            for (var ci = 0; ci < chamadosComItens.length; ci++) {
                var chamado = chamadosComItens[ci];
                var itens   = resultados[chamado.id] || [];
                if (itens.length === 0) continue;
                html += '<div class="viagem-itens-chamado">';
                html += '<div class="viagem-itens-chamado-titulo">' +
                    '<i class="fas fa-hashtag"></i> ' + escHtml(chamado.nr_protocolo) +
                    ' — ' + escHtml(chamado.tipo_carga_nome) +
                    ' → ' + escHtml(chamado.destino_nome) +
                    '</div>';
                for (var ii = 0; ii < itens.length; ii++) {
                    var it = itens[ii];
                    var uid = 'item-' + chamado.id + '-' + it.id;
                    html += '<div class="viagem-item-row" id="row-' + uid + '">' +
                        '<label class="viagem-item-check-label">' +
                            '<input type="checkbox" class="viagem-item-check" checked' +
                                ' data-chamado="' + chamado.id + '" data-item="' + it.id + '"' +
                                ' id="chk-' + uid + '">' +
                            '<div class="viagem-item-info">' +
                                '<span class="viagem-item-desc">' + escHtml(it.descricao) + '</span>' +
                                '<span class="viagem-item-det">' +
                                    escHtml(String(it.quantidade)) + ' ' + escHtml(it.unidade) +
                                    (it.nr_identificador ? ' | ' + escHtml(it.nr_identificador) : '') +
                                '</span>' +
                            '</div>' +
                        '</label>' +
                        '<div class="viagem-item-recusa" id="recusa-' + uid + '" style="display:none;">' +
                            '<input type="text" class="viagem-item-motivo" placeholder="Motivo da recusa (obrigatorio)..."' +
                                ' data-chamado="' + chamado.id + '" data-item="' + it.id + '" maxlength="200">' +
                        '</div>' +
                        '</div>';
                }
                html += '</div>';
            }
            if (!html) {
                lista.innerHTML = '<div class="historico-vazio">Nenhum item encontrado.</div>';
                return;
            }
            lista.innerHTML = html;

            // Eventos nos checkboxes
            var checks = lista.querySelectorAll('.viagem-item-check');
            for (var k = 0; k < checks.length; k++) {
                checks[k].addEventListener('change', function () {
                    var uid2 = 'item-' + this.getAttribute('data-chamado') + '-' + this.getAttribute('data-item');
                    var recusaDiv = document.getElementById('recusa-' + uid2);
                    var rowDiv    = document.getElementById('row-'    + uid2);
                    if (!this.checked) {
                        if (recusaDiv) recusaDiv.style.display = '';
                        if (rowDiv)    rowDiv.classList.add('viagem-item-recusado');
                    } else {
                        if (recusaDiv) recusaDiv.style.display = 'none';
                        if (rowDiv)    rowDiv.classList.remove('viagem-item-recusado');
                    }
                });
            }
        }

        for (var idx = 0; idx < chamadosComItens.length; idx++) {
            (function (chamado) {
                fetch(CONFIG.api + '/chamados/' + chamado.id + '/itens', { credentials: 'same-origin' })
                    .then(function (r) { return r.json(); })
                    .then(function (data) {
                        resultados[chamado.id] = data.success ? (data.itens || []) : [];
                        pendentes--;
                        if (pendentes === 0) renderTodos();
                    })
                    .catch(function () {
                        resultados[chamado.id] = [];
                        pendentes--;
                        if (pendentes === 0) renderTodos();
                    });
            })(chamadosComItens[idx]);
        }
    }

    function coletarItensRecusados() {
        var lista = document.getElementById('viagem-itens-lista');
        if (!lista) return [];
        var recusados = [];
        var checks = lista.querySelectorAll('.viagem-item-check');
        for (var i = 0; i < checks.length; i++) {
            var chk = checks[i];
            if (!chk.checked) {
                var chamadoId = chk.getAttribute('data-chamado');
                var itemId    = chk.getAttribute('data-item');
                var uid = 'item-' + chamadoId + '-' + itemId;
                var recusaDiv = document.getElementById('recusa-' + uid);
                var motivo = '';
                if (recusaDiv) {
                    var input = recusaDiv.querySelector('.viagem-item-motivo');
                    if (input) motivo = (input.value || '').trim();
                }
                if (!motivo) {
                    toast('Informe o motivo da recusa do item desmarcado.', 'warning');
                    return null;  // sinaliza erro de validação
                }
                recusados.push({ id: parseInt(itemId, 10), motivo: motivo });
            }
        }
        return recusados;
    }

    function inicializarPadMotorista() {
        var canvas = document.getElementById('canvas-motorista');
        if (!canvas || !window.SignaturePad) return;
        if (Estado.signaturePadMotorista) {
            Estado.signaturePadMotorista.clear();
            return;
        }
        Estado.signaturePadMotorista = new SignaturePad(canvas, {
            backgroundColor: 'rgb(255,255,255)',
            penColor: 'rgb(0,0,0)',
            minWidth: 1.5,
            maxWidth: 3
        });
        function ajustarCanvas() {
            var ratio = window.devicePixelRatio || 1;
            canvas.width  = canvas.offsetWidth  * ratio;
            canvas.height = canvas.offsetHeight * ratio;
            canvas.getContext('2d').scale(ratio, ratio);
            Estado.signaturePadMotorista.clear();
        }
        ajustarCanvas();
    }

    function confirmarIniciarViagem() {
        var btn = document.getElementById('btn-confirmar-viagem');

        // Coletar itens recusados (null = erro de validação)
        var itensRecusados = coletarItensRecusados();
        if (itensRecusados === null) return;

        // Validar foto se obrigatório
        if (Estado.requerFotoInicio && !Estado.fotoInicioCapturada) {
            toast('Foto do material e obrigatoria para iniciar a viagem.', 'warning'); return;
        }

        // Validar assinatura do motorista (apenas se exigido pelo tipo de carga)
        var assinaturaMotorista = null;
        if (Estado.requerAssinaturaMotorista) {
            if (!Estado.signaturePadMotorista || Estado.signaturePadMotorista.isEmpty()) {
                toast('Assinatura do motorista e obrigatoria para este tipo de carga.', 'warning'); return;
            }
            assinaturaMotorista = Estado.signaturePadMotorista.toDataURL('image/png');
        }

        // Verificar chamados agendados com início antecipado (> 60 min antes)
        var agora = new Date();
        for (var si = 0; si < Estado.selecionados.length; si++) {
            var selId = Estado.selecionados[si];
            for (var fi = 0; fi < Estado.fila.length; fi++) {
                var fc = Estado.fila[fi];
                if (fc.id === selId && fc.tipo_solicitacao === 'agendado' && fc.dt_agendamento) {
                    var dtPrev = new Date(fc.dt_agendamento);
                    var diffMin = Math.round((dtPrev - agora) / 60000);
                    if (diffMin > 60) {
                        var dtLabel = dtPrev.toLocaleDateString('pt-BR') + ' às ' +
                            dtPrev.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
                        var confirmou = window.confirm(
                            'Atenção: o chamado ' + fc.nr_protocolo + ' está agendado para ' + dtLabel + '.\n' +
                            'Você está iniciando ' + diffMin + ' minutos antes do horário previsto.\n\n' +
                            'Deseja iniciar mesmo assim?'
                        );
                        if (!confirmou) return;
                        break;
                    }
                }
            }
        }

        var payload = {
            motorista_id:         Estado.motoristaSelecionado.id,
            veiculo_id:           Estado.veiculoId,
            veiculo_placa:        Estado.veiculoPlaca || null,
            chamado_ids:          Estado.selecionados,
            assinatura_motorista: assinaturaMotorista,
            foto_inicio:          Estado.fotoInicioCapturada || null,
            itens_recusados:      itensRecusados
        };

        setLoading(btn, true);
        fetch(CONFIG.api + '/viagem/iniciar', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'same-origin',
            body: JSON.stringify(payload)
        })
        .then(function (r) { return r.json(); })
        .then(function (data) {
            setLoading(btn, false);
            if (data.success) {
                toast(data.message || 'Viagem iniciada!', 'success');
                Estado.selecionados = [];
                fecharModal('modal-iniciar-viagem');
                carregarFila();
            } else {
                toast(data.error || 'Erro ao iniciar viagem.', 'error');
            }
        })
        .catch(function () { setLoading(btn, false); toast('Erro de conexao.', 'error'); });
    }

    // ── Foto início de viagem ─────────────────────────────

    function inicializarFotoViagem() {
        var inputFoto  = document.getElementById('viagem-input-foto');
        var btnTirar   = document.getElementById('viagem-btn-tirar-foto');
        var btnRemover = document.getElementById('viagem-btn-remover-foto');
        if (!inputFoto || !btnTirar) return;

        btnTirar.addEventListener('click', function () { inputFoto.click(); });
        inputFoto.addEventListener('change', function () {
            var file = inputFoto.files && inputFoto.files[0];
            if (!file) return;
            comprimirImagem(file, function (base64) {
                Estado.fotoInicioCapturada = base64;
                var preview = document.getElementById('viagem-foto-preview');
                var img     = document.getElementById('viagem-foto-img');
                if (img)     img.src            = base64;
                if (preview) preview.style.display = '';
                btnTirar.style.display = 'none';
            });
        });
        if (btnRemover) {
            btnRemover.addEventListener('click', function () {
                Estado.fotoInicioCapturada = null;
                var preview = document.getElementById('viagem-foto-preview');
                var img     = document.getElementById('viagem-foto-img');
                if (img)     img.src            = '';
                if (preview) preview.style.display = 'none';
                btnTirar.style.display = '';
            });
        }
    }

    // ── Entregar ─────────────────────────────────────────

    function abrirEntrega(chamadoId, fotoBase64) {
        Estado.chamadoAcaoId = chamadoId;
        Estado.fotoCargaAtual = fotoBase64 || null;
        _mostrarFotoModal('entregar-foto-wrap', 'entregar-foto-img');
        var dest = document.getElementById('entregar-destinatario');
        var cpf  = document.getElementById('entregar-cpf');
        var nasc = document.getElementById('entregar-nascimento');
        var obs  = document.getElementById('entregar-obs');
        var chk  = document.getElementById('entregar-parcial');
        var obsW = document.getElementById('entregar-parcial-obs-wrap');
        var obsT = document.getElementById('entregar-parcial-obs');
        if (dest) dest.value = '';
        if (cpf)  cpf.value  = '';
        if (nasc) nasc.value = '';
        if (obs)  obs.value  = '';
        if (chk)  { chk.checked = false; }
        if (obsW) obsW.style.display = 'none';
        if (obsT) obsT.value = '';
        abrirModal('modal-entregar');
    }

    function confirmarEntrega() {
        var btn       = document.getElementById('btn-confirmar-entrega');
        var dest      = (document.getElementById('entregar-destinatario').value || '').trim();
        var cpf       = (document.getElementById('entregar-cpf').value || '').trim();
        var nasc      = (document.getElementById('entregar-nascimento').value || '').trim();
        var obs       = (document.getElementById('entregar-obs').value || '').trim();
        var parcial   = document.getElementById('entregar-parcial').checked;
        var obsParcial = (document.getElementById('entregar-parcial-obs').value || '').trim();
        if (!dest) { toast('Informe o nome do destinatario.', 'warning'); return; }

        setLoading(btn, true);
        fetch(CONFIG.api + '/chamados/' + Estado.chamadoAcaoId + '/entregar', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'same-origin',
            body: JSON.stringify({
                motorista_id:                Estado.motoristaSelecionado.id,
                nm_destinatario:             dest,
                cpf_destinatario:            cpf || null,
                dt_nascimento_destinatario:  nasc || null,
                observacao_entrega:          obs,
                veiculo_id:                  Estado.veiculoId,
                veiculo_placa:               Estado.veiculoPlaca || null,
                entrega_parcial:             parcial,
                obs_entrega_parcial:         obsParcial || null
            })
        })
        .then(function (r) { return r.json(); })
        .then(function (data) {
            setLoading(btn, false);
            if (data.success) {
                toast('Entrega registrada!', 'success');
                fecharModal('modal-entregar');
                carregarFila();
            } else {
                toast(data.error || 'Erro ao registrar entrega.', 'error');
            }
        })
        .catch(function () { setLoading(btn, false); toast('Erro de conexao.', 'error'); });
    }

    // ── Entregar com Assinatura ───────────────────────────

    function abrirEntregaAssinatura(chamadoId, fotoBase64) {
        Estado.chamadoAcaoId = chamadoId;
        Estado.fotoCargaAtual = fotoBase64 || null;
        _mostrarFotoModal('assin-foto-wrap', 'assin-foto-img');
        var dest = document.getElementById('assin-destinatario');
        var cpf  = document.getElementById('assin-cpf');
        var nasc = document.getElementById('assin-nascimento');
        var pin  = document.getElementById('assin-pin');
        var obs  = document.getElementById('assin-obs');
        var chk  = document.getElementById('assin-parcial');
        var obsW = document.getElementById('assin-parcial-obs-wrap');
        var obsT = document.getElementById('assin-parcial-obs');
        var pinSt = document.getElementById('pin-status');
        if (dest)  dest.value  = '';
        if (cpf)   cpf.value   = '';
        if (nasc)  nasc.value  = '';
        if (pin)   pin.value   = '';
        if (obs)   obs.value   = '';
        if (chk)   chk.checked = false;
        if (obsW)  obsW.style.display = 'none';
        if (obsT)  obsT.value  = '';
        if (pinSt) pinSt.textContent = '';
        if (Estado.signaturePadDestinatario) Estado.signaturePadDestinatario.clear();
        abrirModal('modal-assinatura');
        inicializarPadDestinatario();
    }

    function inicializarPadDestinatario() {
        var canvas = document.getElementById('canvas-assinatura');
        if (!canvas || !window.SignaturePad) return;
        if (Estado.signaturePadDestinatario) {
            Estado.signaturePadDestinatario.clear();
            return;
        }
        Estado.signaturePadDestinatario = new SignaturePad(canvas, {
            backgroundColor: 'rgb(255,255,255)',
            penColor: 'rgb(0,0,0)',
            minWidth: 1.5,
            maxWidth: 3
        });
        function ajustar() {
            var ratio = window.devicePixelRatio || 1;
            canvas.width  = canvas.offsetWidth  * ratio;
            canvas.height = canvas.offsetHeight * ratio;
            canvas.getContext('2d').scale(ratio, ratio);
            Estado.signaturePadDestinatario.clear();
        }
        ajustar();
    }

    function confirmarEntregaAssinatura() {
        var btn        = document.getElementById('btn-confirmar-assinatura');
        var dest       = (document.getElementById('assin-destinatario').value || '').trim();
        var cpf        = (document.getElementById('assin-cpf').value || '').trim();
        var nasc       = (document.getElementById('assin-nascimento').value || '').trim();
        var pin        = (document.getElementById('assin-pin').value || '').trim();
        var obs        = (document.getElementById('assin-obs').value || '').trim();
        var parcial    = document.getElementById('assin-parcial').checked;
        var obsParcial = (document.getElementById('assin-parcial-obs').value || '').trim();

        if (!dest) { toast('Informe o nome do destinatario.', 'warning'); return; }
        if (!pin)  { toast('Informe o PIN do motorista.', 'warning'); return; }
        if (!Estado.signaturePadDestinatario || Estado.signaturePadDestinatario.isEmpty()) {
            toast('Assinatura do destinatario e obrigatoria.', 'warning'); return;
        }

        var assinaturaImg = Estado.signaturePadDestinatario.toDataURL('image/png');

        setLoading(btn, true);
        fetch(CONFIG.api + '/chamados/' + Estado.chamadoAcaoId + '/entregar-com-assinatura', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'same-origin',
            body: JSON.stringify({
                motorista_pin:               pin,
                nm_destinatario:             dest,
                cpf_destinatario:            cpf || null,
                dt_nascimento_destinatario:  nasc || null,
                assinatura_img:              assinaturaImg,
                observacao_entrega:          obs,
                veiculo_id:                  Estado.veiculoId,
                veiculo_placa:               Estado.veiculoPlaca || null,
                entrega_parcial:             parcial,
                obs_entrega_parcial:         obsParcial || null
            })
        })
        .then(function (r) { return r.json(); })
        .then(function (data) {
            setLoading(btn, false);
            if (data.success) {
                toast('Entrega com assinatura registrada!', 'success');
                fecharModal('modal-assinatura');
                carregarFila();
            } else {
                toast(data.error || 'Erro ao registrar entrega.', 'error');
            }
        })
        .catch(function () { setLoading(btn, false); toast('Erro de conexao.', 'error'); });
    }

    function _mostrarFotoModal(wrapId, imgId) {
        var wrap = document.getElementById(wrapId);
        var img  = document.getElementById(imgId);
        if (!wrap) return;
        if (Estado.fotoCargaAtual && Estado.fotoCargaAtual.startsWith('data:image/')) {
            if (img) img.src = Estado.fotoCargaAtual;
            wrap.style.display = '';
        } else {
            wrap.style.display = 'none';
        }
    }

    // ── Ver Itens ─────────────────────────────────────────

    function verItens(chamadoId) {
        var lista = document.getElementById('itens-lista');
        if (lista) lista.innerHTML = '<div class="loading-inline"><div class="loading-spinner-sm"></div> Carregando...</div>';
        abrirModal('modal-itens');
        fetch(CONFIG.api + '/chamados/' + chamadoId + '/itens', { credentials: 'same-origin' })
            .then(function (r) { return r.json(); })
            .then(function (data) {
                if (!lista) return;
                if (!data.success || !data.itens || data.itens.length === 0) {
                    lista.innerHTML = '<div class="historico-vazio">Nenhum item cadastrado.</div>'; return;
                }
                var html = '';
                for (var i = 0; i < data.itens.length; i++) {
                    var it = data.itens[i];
                    var recusado = it.aceito === false;
                    html += '<div class="item-manifesto' + (recusado ? ' item-manifesto-recusado' : '') + '">' +
                        '<div class="item-manifesto-desc">' +
                            (recusado ? '<span class="badge-recusado"><i class="fas fa-ban"></i> Nao transportado</span> ' : '') +
                            escHtml(it.descricao) +
                        '</div>' +
                        '<div class="item-manifesto-det">' +
                            escHtml(String(it.quantidade)) + ' ' + escHtml(it.unidade) +
                            (it.nr_identificador ? ' | <i class="fas fa-hashtag"></i> ' + escHtml(it.nr_identificador) : '') +
                            (it.observacao ? ' — ' + escHtml(it.observacao) : '') +
                        '</div>' +
                        (recusado && it.motivo_recusa ? '<div class="item-manifesto-motivo"><i class="fas fa-comment-alt"></i> ' + escHtml(it.motivo_recusa) + '</div>' : '') +
                        '</div>';
                }
                lista.innerHTML = html;
            })
            .catch(function () {
                if (lista) lista.innerHTML = '<div class="historico-vazio">Erro ao carregar.</div>';
            });
    }

    // ── Cancelar chamado ──────────────────────────────────

    function abrirCancelar(chamadoId) {
        Estado.chamadoAcaoId = chamadoId;
        var motivo = document.getElementById('cancelar-motivo');
        if (motivo) motivo.value = '';
        abrirModal('modal-cancelar');
    }

    function confirmarCancelar() {
        var btn    = document.getElementById('btn-confirmar-cancelar');
        var motivo = (document.getElementById('cancelar-motivo').value || '').trim();
        if (motivo.length < 10) { toast('Motivo deve ter pelo menos 10 caracteres.', 'warning'); return; }

        setLoading(btn, true);
        fetch(CONFIG.api + '/chamados/' + Estado.chamadoAcaoId + '/cancelar', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'same-origin',
            body: JSON.stringify({
                motorista_id: Estado.motoristaSelecionado.id,
                motivo: motivo
            })
        })
        .then(function (r) { return r.json(); })
        .then(function (data) {
            setLoading(btn, false);
            if (data.success) {
                toast('Chamado cancelado.', 'success');
                fecharModal('modal-cancelar');
                carregarFila();
            } else {
                toast(data.error || 'Erro ao cancelar.', 'error');
            }
        })
        .catch(function () { setLoading(btn, false); toast('Erro de conexao.', 'error'); });
    }

    // ── inicializar ───────────────────────────────────────

    function inicializar() {
        carregarMotoristas();
        carregarVeiculos();
        inicializarFotoViagem();

        // Botoes header/selecao
        var btnEntrar  = document.getElementById('btn-entrar');
        var btnVoltar  = document.getElementById('btn-voltar');
        var btnSair    = document.getElementById('btn-sair-motorista');
        if (btnEntrar) btnEntrar.addEventListener('click', entrar);
        if (btnVoltar) btnVoltar.addEventListener('click', function () { window.history.back(); });
        if (btnSair)   btnSair.addEventListener('click', sair);

        // Iniciar viagem
        var btnIniciarViagem = document.getElementById('btn-iniciar-viagem');
        if (btnIniciarViagem) btnIniciarViagem.addEventListener('click', abrirIniciarViagem);

        // Fechar modal iniciar viagem
        var btnFI  = document.getElementById('btn-fechar-iniciar');
        var btnFI2 = document.getElementById('btn-fechar-iniciar2');
        if (btnFI)  btnFI.addEventListener('click',  function () { fecharModal('modal-iniciar-viagem'); });
        if (btnFI2) btnFI2.addEventListener('click', function () { fecharModal('modal-iniciar-viagem'); });

        // Limpar assinatura motorista
        var btnLimMot = document.getElementById('btn-limpar-motorista');
        if (btnLimMot) btnLimMot.addEventListener('click', function () {
            if (Estado.signaturePadMotorista) Estado.signaturePadMotorista.clear();
        });

        // Confirmar viagem
        var btnConfViagem = document.getElementById('btn-confirmar-viagem');
        if (btnConfViagem) btnConfViagem.addEventListener('click', confirmarIniciarViagem);

        // Modal entrega simples
        var btnFE  = document.getElementById('btn-fechar-entregar');
        var btnFE2 = document.getElementById('btn-fechar-entregar2');
        var btnCE  = document.getElementById('btn-confirmar-entrega');
        if (btnFE)  btnFE.addEventListener('click',  function () { fecharModal('modal-entregar'); });
        if (btnFE2) btnFE2.addEventListener('click', function () { fecharModal('modal-entregar'); });
        if (btnCE)  btnCE.addEventListener('click',  confirmarEntrega);

        // Toggle obs parcial — modal entrega
        var chkParcial = document.getElementById('entregar-parcial');
        if (chkParcial) chkParcial.addEventListener('change', function () {
            var w = document.getElementById('entregar-parcial-obs-wrap');
            if (w) w.style.display = this.checked ? '' : 'none';
        });

        // Modal assinatura destinatario
        var btnFA  = document.getElementById('btn-fechar-assinatura');
        var btnFA2 = document.getElementById('btn-fechar-assinatura2');
        var btnCA  = document.getElementById('btn-confirmar-assinatura');
        var btnLA  = document.getElementById('btn-limpar-canvas');
        if (btnFA)  btnFA.addEventListener('click',  function () { fecharModal('modal-assinatura'); });
        if (btnFA2) btnFA2.addEventListener('click', function () { fecharModal('modal-assinatura'); });
        if (btnCA)  btnCA.addEventListener('click',  confirmarEntregaAssinatura);
        if (btnLA)  btnLA.addEventListener('click',  function () {
            if (Estado.signaturePadDestinatario) Estado.signaturePadDestinatario.clear();
        });

        // Toggle obs parcial — modal assinatura
        var chkAssinParcial = document.getElementById('assin-parcial');
        if (chkAssinParcial) chkAssinParcial.addEventListener('change', function () {
            var w = document.getElementById('assin-parcial-obs-wrap');
            if (w) w.style.display = this.checked ? '' : 'none';
        });

        // Modal itens
        var btnFItens  = document.getElementById('btn-fechar-itens');
        var btnFItens2 = document.getElementById('btn-fechar-itens2');
        if (btnFItens)  btnFItens.addEventListener('click',  function () { fecharModal('modal-itens'); });
        if (btnFItens2) btnFItens2.addEventListener('click', function () { fecharModal('modal-itens'); });

        // Modal cancelar
        var btnFC  = document.getElementById('btn-fechar-cancelar');
        var btnFC2 = document.getElementById('btn-fechar-cancelar2');
        var btnCC  = document.getElementById('btn-confirmar-cancelar');
        if (btnFC)  btnFC.addEventListener('click',  function () { fecharModal('modal-cancelar'); });
        if (btnFC2) btnFC2.addEventListener('click', function () { fecharModal('modal-cancelar'); });
        if (btnCC)  btnCC.addEventListener('click',  confirmarCancelar);

        // Fechar modais clicando no overlay
        document.addEventListener('click', function (e) {
            var modais = ['modal-entregar', 'modal-assinatura', 'modal-itens',
                          'modal-cancelar', 'modal-iniciar-viagem'];
            for (var i = 0; i < modais.length; i++) {
                var el = document.getElementById(modais[i]);
                if (el && e.target === el) fecharModal(modais[i]);
            }
        });
    }

    window.addEventListener('DOMContentLoaded', inicializar);
})();
