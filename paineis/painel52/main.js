/* Painel 52 - Solicitar Transporte de Material — ES5 IIFE */
(function () {
    'use strict';

    var CONFIG = {
        api: '/api/paineis/painel52',
        refreshInterval: 30000
    };

    var Estado = {
        tipos: [],
        tipoCargaId: null,
        tipoCargaNome: '',
        tipoRequerLista: false,
        tipoRequerAssinatura: false,
        origens: [],
        destinos: [],
        itens: [],
        chamadoIdCancelar: null,
        chamadosAtivos: 0
    };

    var DOM = {};

    function escHtml(s) {
        if (s == null) return '';
        return String(s)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function mostrarTela(id) {
        var telas = ['tela-principal', 'tela-formulario', 'tela-confirmacao', 'tela-acompanhamento'];
        for (var i = 0; i < telas.length; i++) {
            var el = document.getElementById(telas[i]);
            if (el) el.style.display = telas[i] === id ? '' : 'none';
        }
        window.scrollTo(0, 0);
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

    /* ── TIPOS DE CARGA ───────────────── */
    function carregarTipos() {
        fetch(CONFIG.api + '/tipos-carga', { credentials: 'same-origin' })
            .then(function (r) { return r.json(); })
            .then(function (data) {
                if (!data.success) return;
                Estado.tipos = data.tipos || [];
                renderizarTipos();
            })
            .catch(function (e) { console.error('Erro tipos:', e); });
    }

    function renderizarTipos() {
        var grid = document.getElementById('tipo-grid');
        if (!grid) return;
        if (!Estado.tipos.length) {
            grid.innerHTML = '<p style="color:#aaa;font-size:13px;">Nenhum tipo cadastrado.</p>';
            return;
        }
        var html = '';
        for (var i = 0; i < Estado.tipos.length; i++) {
            var t = Estado.tipos[i];
            html += '<div class="tipo-card" data-id="' + escHtml(String(t.id)) +
                '" data-nome="' + escHtml(t.nome) +
                '" data-lista="' + (t.requer_lista_itens ? '1' : '0') +
                '" data-assinatura="' + (t.requer_assinatura ? '1' : '0') + '">' +
                '<i class="fas ' + escHtml(t.icone) + '" style="color:' + escHtml(t.cor) + '"></i>' +
                '<span>' + escHtml(t.nome) + '</span></div>';
        }
        grid.innerHTML = html;

        var cards = grid.querySelectorAll('.tipo-card');
        for (var j = 0; j < cards.length; j++) {
            cards[j].addEventListener('click', selecionarTipo);
        }
    }

    function selecionarTipo(e) {
        var card = e.currentTarget;
        var cards = document.querySelectorAll('.tipo-card');
        for (var i = 0; i < cards.length; i++) { cards[i].classList.remove('selecionado'); }
        card.classList.add('selecionado');

        Estado.tipoCargaId = parseInt(card.getAttribute('data-id'), 10);
        Estado.tipoCargaNome = card.getAttribute('data-nome');
        Estado.tipoRequerLista = card.getAttribute('data-lista') === '1';
        Estado.tipoRequerAssinatura = card.getAttribute('data-assinatura') === '1';

        document.getElementById('tipo-carga-id').value = Estado.tipoCargaId;
        document.getElementById('tipo-carga-nome').value = Estado.tipoCargaNome;
        document.getElementById('tipo-requer-lista').value = Estado.tipoRequerLista ? 'true' : 'false';
        document.getElementById('tipo-requer-assinatura').value = Estado.tipoRequerAssinatura ? 'true' : 'false';

        var secaoManifesto = document.getElementById('secao-manifesto');
        if (secaoManifesto) {
            secaoManifesto.style.display = Estado.tipoRequerLista ? '' : 'none';
        }

        carregarDestinos(Estado.tipoCargaId);
    }

    /* ── ORIGENS ──────────────────────── */
    function carregarOrigens() {
        fetch(CONFIG.api + '/origens', { credentials: 'same-origin' })
            .then(function (r) { return r.json(); })
            .then(function (data) {
                if (!data.success) return;
                Estado.origens = data.origens || [];
                var sel = document.getElementById('select-origem');
                if (!sel) return;
                sel.innerHTML = '<option value="">Selecione o setor de origem...</option>';
                for (var i = 0; i < Estado.origens.length; i++) {
                    var opt = document.createElement('option');
                    opt.value = Estado.origens[i].nome;
                    opt.textContent = Estado.origens[i].nome;
                    sel.appendChild(opt);
                }
            })
            .catch(function (e) { console.error('Erro origens:', e); });
    }

    /* ── DESTINOS ─────────────────────── */
    function carregarDestinos(tipoId) {
        var sel = document.getElementById('select-destino');
        if (!sel) return;
        sel.disabled = true;
        sel.innerHTML = '<option value="">Carregando...</option>';

        var url = CONFIG.api + '/destinos';
        if (tipoId) url += '?tipo_id=' + tipoId;

        fetch(url, { credentials: 'same-origin' })
            .then(function (r) { return r.json(); })
            .then(function (data) {
                if (!data.success) return;
                Estado.destinos = data.destinos || [];
                sel.innerHTML = '<option value="">Selecione o destino...</option>';
                for (var i = 0; i < Estado.destinos.length; i++) {
                    var opt = document.createElement('option');
                    opt.value = Estado.destinos[i].nome;
                    opt.textContent = Estado.destinos[i].nome;
                    sel.appendChild(opt);
                }
                sel.disabled = false;
            })
            .catch(function (e) {
                console.error('Erro destinos:', e);
                sel.disabled = false;
                sel.innerHTML = '<option value="">Erro ao carregar</option>';
            });
    }

    /* ── MANIFESTO ────────────────────── */
    function adicionarItem() {
        var idx = Estado.itens.length;
        Estado.itens.push({ descricao: '', quantidade: 1, unidade: 'unidade', observacao: '' });
        renderizarItens();
    }

    function removerItem(idx) {
        Estado.itens.splice(idx, 1);
        renderizarItens();
    }

    function renderizarItens() {
        var lista = document.getElementById('lista-itens');
        var vazio = document.getElementById('manifesto-vazio');
        if (!lista) return;

        if (!Estado.itens.length) {
            lista.innerHTML = '';
            if (vazio) { vazio.style.display = ''; lista.appendChild(vazio); }
            return;
        }
        if (vazio) vazio.style.display = 'none';

        var html = '';
        for (var i = 0; i < Estado.itens.length; i++) {
            var it = Estado.itens[i];
            html += '<div class="item-manifesto" data-idx="' + i + '">' +
                '<div class="item-manifesto-header">' +
                '<span class="item-num">Item ' + (i + 1) + '</span>' +
                '<button type="button" class="btn-remover-item" data-idx="' + i + '">' +
                '<i class="fas fa-trash-alt"></i> Remover</button></div>' +
                '<div class="item-row-3">' +
                '<div class="form-group">' +
                '<input type="text" class="item-descricao" data-idx="' + i + '" placeholder="Descricao *" maxlength="300" value="' + escHtml(it.descricao) + '">' +
                '</div>' +
                '<div class="form-group">' +
                '<input type="number" class="item-quantidade" data-idx="' + i + '" placeholder="Qtd" min="0.01" step="0.01" value="' + escHtml(String(it.quantidade)) + '">' +
                '</div>' +
                '<div class="form-group item-unidade">' +
                '<input type="text" class="item-unidade-input" data-idx="' + i + '" placeholder="Unid." maxlength="50" value="' + escHtml(it.unidade) + '">' +
                '</div></div>' +
                '<input type="text" class="item-obs" data-idx="' + i + '" placeholder="Obs. do item (opcional)" maxlength="300" value="' + escHtml(it.observacao) + '">' +
                '</div>';
        }
        lista.innerHTML = html;

        var btns = lista.querySelectorAll('.btn-remover-item');
        for (var j = 0; j < btns.length; j++) {
            btns[j].addEventListener('click', function (e) {
                removerItem(parseInt(e.currentTarget.getAttribute('data-idx'), 10));
            });
        }

        var inputs = lista.querySelectorAll('.item-descricao, .item-quantidade, .item-unidade-input, .item-obs');
        for (var k = 0; k < inputs.length; k++) {
            inputs[k].addEventListener('change', sincronizarItens);
            inputs[k].addEventListener('input', sincronizarItens);
        }
    }

    function sincronizarItens() {
        var itens = document.querySelectorAll('.item-manifesto');
        for (var i = 0; i < itens.length; i++) {
            var idx = parseInt(itens[i].getAttribute('data-idx'), 10);
            if (idx >= Estado.itens.length) continue;
            var descInput = itens[i].querySelector('.item-descricao');
            var qtdInput  = itens[i].querySelector('.item-quantidade');
            var unInput   = itens[i].querySelector('.item-unidade-input');
            var obsInput  = itens[i].querySelector('.item-obs');
            if (descInput) Estado.itens[idx].descricao  = descInput.value;
            if (qtdInput)  Estado.itens[idx].quantidade = parseFloat(qtdInput.value) || 1;
            if (unInput)   Estado.itens[idx].unidade    = unInput.value || 'unidade';
            if (obsInput)  Estado.itens[idx].observacao = obsInput.value;
        }
    }

    /* ── ENVIAR FORMULARIO ────────────── */
    function enviarFormulario(e) {
        e.preventDefault();

        if (!Estado.tipoCargaId) {
            toast('Selecione o tipo de carga.', 'warning');
            return;
        }

        var origem  = (document.getElementById('select-origem').value || '').trim();
        var destino = (document.getElementById('select-destino').value || '').trim();
        if (!origem) { toast('Selecione o setor de origem.', 'warning'); return; }
        if (!destino) { toast('Selecione o destino.', 'warning'); return; }

        if (Estado.tipoRequerLista) {
            sincronizarItens();
            var itensValidos = Estado.itens.filter(function (it) { return it.descricao.trim(); });
            if (!itensValidos.length) {
                toast('Adicione pelo menos um item ao manifesto.', 'warning');
                return;
            }
        }

        var prioridade = 'normal';
        var radios = document.querySelectorAll('input[name="prioridade"]');
        for (var i = 0; i < radios.length; i++) {
            if (radios[i].checked) { prioridade = radios[i].value; break; }
        }

        var payload = {
            tipo_carga_id:      Estado.tipoCargaId,
            tipo_carga_nome:    Estado.tipoCargaNome,
            descricao:          document.getElementById('input-descricao').value,
            setor_origem_nome:  origem,
            destino_nome:       destino,
            destino_complemento: document.getElementById('input-complemento').value,
            observacao:         document.getElementById('input-obs').value,
            prioridade:         prioridade,
            itens:              Estado.tipoRequerLista ? Estado.itens : []
        };

        var btn = document.getElementById('btn-enviar');
        btn.disabled = true;
        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Enviando...';

        fetch(CONFIG.api + '/solicitar', {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        })
            .then(function (r) { return r.json(); })
            .then(function (data) {
                btn.disabled = false;
                btn.innerHTML = '<i class="fas fa-paper-plane"></i> Enviar Solicitacao';
                if (!data.success) {
                    toast(data.error || 'Erro ao enviar solicitacao.', 'error');
                    return;
                }
                document.getElementById('conf-protocolo').textContent = data.nr_protocolo || '';
                var det = document.getElementById('confirmacao-detalhes');
                det.innerHTML = '<b>Tipo:</b> ' + escHtml(Estado.tipoCargaNome) + '<br>' +
                    '<b>Origem:</b> ' + escHtml(origem) + '<br>' +
                    '<b>Destino:</b> ' + escHtml(destino) + '<br>' +
                    '<b>Prioridade:</b> ' + escHtml(prioridade);
                mostrarTela('tela-confirmacao');
                limparFormulario();
            })
            .catch(function (err) {
                console.error(err);
                btn.disabled = false;
                btn.innerHTML = '<i class="fas fa-paper-plane"></i> Enviar Solicitacao';
                toast('Erro de conexao. Tente novamente.', 'error');
            });
    }

    function limparFormulario() {
        document.getElementById('form-chamado').reset();
        Estado.tipoCargaId = null;
        Estado.tipoCargaNome = '';
        Estado.tipoRequerLista = false;
        Estado.tipoRequerAssinatura = false;
        Estado.itens = [];
        var cards = document.querySelectorAll('.tipo-card');
        for (var i = 0; i < cards.length; i++) { cards[i].classList.remove('selecionado'); }
        var sec = document.getElementById('secao-manifesto');
        if (sec) sec.style.display = 'none';
        renderizarItens();
        var sel = document.getElementById('select-destino');
        if (sel) { sel.disabled = true; sel.innerHTML = '<option value="">Selecione o tipo de carga primeiro...</option>'; }
        document.getElementById('count-desc').textContent = '0';
        document.getElementById('count-obs').textContent = '0';
    }

    /* ── MEUS CHAMADOS ────────────────── */
    function carregarMeusChamados() {
        var lista = document.getElementById('lista-acompanhamento');
        var vazio = document.getElementById('vazio-acompanhamento');
        if (lista) lista.innerHTML = '<div class="loading"><div class="loading-spinner"></div><p>Carregando...</p></div>';

        fetch(CONFIG.api + '/meus-chamados', { credentials: 'same-origin' })
            .then(function (r) { return r.json(); })
            .then(function (data) {
                if (!data.success) { toast(data.error || 'Erro ao buscar chamados.', 'error'); return; }
                var chamados = data.chamados || [];
                Estado.chamadosAtivos = chamados.filter(function (c) {
                    return ['aguardando', 'aceito', 'em_transporte'].indexOf(c.status) >= 0;
                }).length;
                var badge = document.getElementById('badge-ativos');
                if (badge) badge.textContent = Estado.chamadosAtivos;

                if (!lista) return;
                if (!chamados.length) {
                    lista.innerHTML = '';
                    if (vazio) vazio.style.display = '';
                    return;
                }
                if (vazio) vazio.style.display = 'none';
                lista.innerHTML = '';
                for (var i = 0; i < chamados.length; i++) {
                    lista.appendChild(criarCardChamado(chamados[i]));
                }
            })
            .catch(function (err) { console.error(err); toast('Erro ao buscar chamados.', 'error'); });
    }

    var _STATUS_LABEL = {
        'aguardando':    '<i class="fas fa-hourglass-half"></i> Aguardando',
        'aceito':        '<i class="fas fa-check-circle"></i> Aceito',
        'em_transporte': '<i class="fas fa-truck"></i> Em Transporte',
        'entregue':      '<i class="fas fa-box-open"></i> Entregue',
        'cancelado':     '<i class="fas fa-times-circle"></i> Cancelado'
    };

    function criarCardChamado(c) {
        var div = document.createElement('div');
        div.className = 'chamado-card ' + escHtml(c.status) + (c.prioridade === 'urgente' ? ' urgente' : '');

        var statusLabel = _STATUS_LABEL[c.status] || escHtml(c.status);
        var badgeTipo = c.tipo_carga_icone ?
            '<i class="fas ' + escHtml(c.tipo_carga_icone) + '" style="color:' + escHtml(c.tipo_carga_cor || '#666') + '"></i> ' : '';

        var podeCancelar = c.status === 'aguardando' || c.status === 'aceito';

        div.innerHTML = '<div class="chamado-card-header">' +
            '<span class="chamado-badge-tipo">' + badgeTipo + escHtml(c.tipo_carga_nome || '') + '</span>' +
            '<span class="chamado-badge-status status-' + escHtml(c.status) + '">' + statusLabel + '</span>' +
            '</div>' +
            '<div class="chamado-card-body">' +
            '<div class="chamado-protocolo"><i class="fas fa-barcode"></i> ' + escHtml(c.nr_protocolo) + '</div>' +
            (c.prioridade === 'urgente' ? '<span class="badge-urgente"><i class="fas fa-bolt"></i> URGENTE</span> ' : '') +
            '<div class="chamado-info-rota"><i class="fas fa-arrow-right"></i>' +
            escHtml(c.setor_origem_nome) + ' <i class="fas fa-long-arrow-alt-right"></i> ' + escHtml(c.destino_nome) +
            '</div>' +
            '<div class="chamado-info-meta"><i class="fas fa-clock"></i> ' + escHtml(formatarData(c.criado_em)) + '</div>' +
            '</div>' +
            '<div class="chamado-card-footer">' +
            '<span class="chamado-motorista">' + (c.motorista_nome ? '<i class="fas fa-id-card"></i> ' + escHtml(c.motorista_nome) : '<i class="fas fa-user-clock"></i> Aguardando motorista') + '</span>' +
            (podeCancelar ? '<button type="button" class="btn-cancelar-chamado" data-id="' + c.id + '"><i class="fas fa-times"></i> Cancelar</button>' : '') +
            '</div>';

        var btnCancelar = div.querySelector('.btn-cancelar-chamado');
        if (btnCancelar) {
            btnCancelar.addEventListener('click', function (e) {
                Estado.chamadoIdCancelar = parseInt(e.currentTarget.getAttribute('data-id'), 10);
                document.getElementById('motivo-cancelamento').value = '';
                document.getElementById('modal-cancelar').style.display = 'flex';
            });
        }
        return div;
    }

    function formatarData(iso) {
        if (!iso) return '';
        try {
            var d = new Date(iso);
            return d.toLocaleDateString('pt-BR') + ' ' + d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
        } catch (e) { return iso; }
    }

    /* ── CANCELAR ─────────────────────── */
    function confirmarCancelamento() {
        if (!Estado.chamadoIdCancelar) return;
        var motivo = document.getElementById('motivo-cancelamento').value || 'Cancelado pelo solicitante';
        fetch(CONFIG.api + '/chamados/' + Estado.chamadoIdCancelar + '/cancelar', {
            method: 'PUT',
            credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ motivo: motivo })
        })
            .then(function (r) { return r.json(); })
            .then(function (data) {
                document.getElementById('modal-cancelar').style.display = 'none';
                Estado.chamadoIdCancelar = null;
                if (data.success) {
                    toast('Chamado cancelado com sucesso.', 'success');
                    carregarMeusChamados();
                } else {
                    toast(data.error || 'Erro ao cancelar.', 'error');
                }
            })
            .catch(function (err) { console.error(err); toast('Erro de conexao.', 'error'); });
    }

    /* ── INICIALIZAR ──────────────────── */
    function inicializar() {
        DOM.btnNovoChamado  = document.getElementById('btn-novo-chamado');
        DOM.btnAcompanhar   = document.getElementById('btn-acompanhar');
        DOM.btnVoltar       = document.getElementById('btn-voltar');
        DOM.btnVoltarForm   = document.getElementById('btn-voltar-form');
        DOM.btnVoltarAcomp  = document.getElementById('btn-voltar-acompanhamento');
        DOM.btnRefreshAcomp = document.getElementById('btn-refresh-acomp');
        DOM.btnAddItem      = document.getElementById('btn-add-item');
        DOM.btnEnviar       = document.getElementById('btn-enviar');
        DOM.btnNovaSol      = document.getElementById('btn-nova-solicitacao');
        DOM.btnVerChamados  = document.getElementById('btn-ver-chamados');
        DOM.btnInicio       = document.getElementById('btn-inicio');
        DOM.btnCancelarNao  = document.getElementById('btn-cancelar-nao');
        DOM.btnCancelarSim  = document.getElementById('btn-cancelar-sim');

        if (DOM.btnNovoChamado) DOM.btnNovoChamado.addEventListener('click', function () {
            mostrarTela('tela-formulario');
            if (!Estado.tipos.length) carregarTipos();
            carregarOrigens();
        });
        if (DOM.btnAcompanhar) DOM.btnAcompanhar.addEventListener('click', function () {
            mostrarTela('tela-acompanhamento');
            carregarMeusChamados();
        });
        if (DOM.btnVoltar) DOM.btnVoltar.addEventListener('click', function () { history.back(); });
        if (DOM.btnVoltarForm) DOM.btnVoltarForm.addEventListener('click', function () { mostrarTela('tela-principal'); });
        if (DOM.btnVoltarAcomp) DOM.btnVoltarAcomp.addEventListener('click', function () { mostrarTela('tela-principal'); });
        if (DOM.btnRefreshAcomp) DOM.btnRefreshAcomp.addEventListener('click', carregarMeusChamados);
        if (DOM.btnAddItem) DOM.btnAddItem.addEventListener('click', adicionarItem);

        var formChamado = document.getElementById('form-chamado');
        if (formChamado) formChamado.addEventListener('submit', enviarFormulario);

        if (DOM.btnNovaSol) DOM.btnNovaSol.addEventListener('click', function () { mostrarTela('tela-formulario'); });
        if (DOM.btnVerChamados) DOM.btnVerChamados.addEventListener('click', function () { mostrarTela('tela-acompanhamento'); carregarMeusChamados(); });
        if (DOM.btnInicio) DOM.btnInicio.addEventListener('click', function () { mostrarTela('tela-principal'); });
        if (DOM.btnCancelarNao) DOM.btnCancelarNao.addEventListener('click', function () { document.getElementById('modal-cancelar').style.display = 'none'; });
        if (DOM.btnCancelarSim) DOM.btnCancelarSim.addEventListener('click', confirmarCancelamento);

        /* contadores de chars */
        var inputDesc = document.getElementById('input-descricao');
        var inputObs  = document.getElementById('input-obs');
        if (inputDesc) inputDesc.addEventListener('input', function () {
            document.getElementById('count-desc').textContent = this.value.length;
        });
        if (inputObs) inputObs.addEventListener('input', function () {
            document.getElementById('count-obs').textContent = this.value.length;
        });

        /* complemento destino */
        var selDestino = document.getElementById('select-destino');
        if (selDestino) selDestino.addEventListener('change', function () {
            var grp = document.getElementById('grupo-complemento');
            if (grp) grp.style.display = this.value ? '' : 'none';
        });

        /* atualizar badge a cada refresh */
        setInterval(function () {
            fetch(CONFIG.api + '/meus-chamados', { credentials: 'same-origin' })
                .then(function (r) { return r.json(); })
                .then(function (data) {
                    if (!data.success) return;
                    var ativos = (data.chamados || []).filter(function (c) {
                        return ['aguardando', 'aceito', 'em_transporte'].indexOf(c.status) >= 0;
                    }).length;
                    var badge = document.getElementById('badge-ativos');
                    if (badge) badge.textContent = ativos;
                })
                .catch(function () {});
        }, CONFIG.refreshInterval);
    }

    window.addEventListener('DOMContentLoaded', inicializar);
})();
