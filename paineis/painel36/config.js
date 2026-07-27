(function () {
    'use strict';

    // ── PADIOLEIROS ───────────────────────────────────────────────

    function carregarCfgPadioleiros() {
        var P = window.P36;
        P.cfgFetch(P.CONFIG.api.cfgPadioleiros, 'lista-config-padioleiros', 'padioleiros', renderizarCfgPadioleiros);
    }

    function renderizarCfgPadioleiros(lista) {
        var P         = window.P36;
        var container = document.getElementById('lista-config-padioleiros');
        if (!lista || !lista.length) {
            container.innerHTML = '<div class="tabela-vazio"><i class="fas fa-users"></i><p>Nenhum padioleiro cadastrado</p></div>';
            return;
        }
        var turnos = { todos: 'Todos os turnos', manha: 'Manha', tarde: 'Tarde', noite: 'Noite' };
        container.innerHTML = '<div class="config-lista">' +
            lista.map(function (p) {
                return '<div class="config-item' + (p.ativo ? '' : ' inativo') + '">' +
                    '<i class="fas fa-user-circle" style="font-size:22px;color:' + (p.ativo ? 'var(--cor-primaria)' : '#aaa') + ';flex-shrink:0;"></i>' +
                    '<div class="config-item-info">' +
                        '<div class="config-item-nome">' + P.escHtml(p.nome) + (p.matricula ? ' <small style="color:#aaa;">Mat. ' + P.escHtml(p.matricula) + '</small>' : '') + '</div>' +
                        '<div class="config-item-meta"><i class="fas fa-clock"></i> ' + (turnos[p.turno] || p.turno) + ' — Cadastrado: ' + (p.criado_em || '--') + '</div>' +
                    '</div>' +
                    P.btnAcoes('padioleiro', p.id, p.ativo) +
                '</div>';
            }).join('') + '</div>';
        P.bindConfigEvents(container, 'padioleiro', lista, P.abrirModalPadioleiro);
    }

    function abrirModalPadioleiro(item) {
        var P = window.P36;
        P.Estado.modalContexto = 'padioleiro';
        P.Estado.modalId = item ? item.id : null;
        document.getElementById('modal-edicao-titulo').textContent = item ? 'Editar Padioleiro' : 'Novo Padioleiro';
        document.getElementById('modal-edicao-body').innerHTML =
            '<div class="form-group"><label>Nome *</label><input type="text" id="mf-nome" placeholder="Nome completo" maxlength="200" value="' + P.escHtml(item ? item.nome : '') + '"></div>' +
            '<div class="form-row-2">' +
                '<div class="form-group"><label>Matricula</label><input type="text" id="mf-matricula" placeholder="Opcional" maxlength="50" value="' + P.escHtml(item ? (item.matricula || '') : '') + '"></div>' +
                '<div class="form-group"><label>Turno</label><select id="mf-turno">' +
                    ['todos', 'manha', 'tarde', 'noite'].map(function (t) {
                        return '<option value="' + t + '"' + ((item && item.turno === t) ? ' selected' : '') + '>' +
                            (t === 'todos' ? 'Todos os turnos' : t.charAt(0).toUpperCase() + t.slice(1)) + '</option>';
                    }).join('') +
                '</select></div>' +
            '</div>';
        document.getElementById('modal-edicao').style.display = '';
        setTimeout(function () { var el = document.getElementById('mf-nome'); if (el) el.focus(); }, 50);
    }

    // ── TIPOS DE MOVIMENTO ────────────────────────────────────────

    function carregarCfgTipos() {
        var P = window.P36;
        P.cfgFetch(P.CONFIG.api.cfgTipos, 'lista-config-tipos', 'tipos', function (tipos) {
            P.Estado.tiposMovimento = tipos;
            renderizarCfgTipos(tipos);
            _atualizarFiltroTiposDestino(tipos);
        });
    }

    function renderizarCfgTipos(lista) {
        var P         = window.P36;
        var container = document.getElementById('lista-config-tipos');
        if (!lista || !lista.length) {
            container.innerHTML = '<div class="tabela-vazio"><i class="fas fa-route"></i><p>Nenhum tipo cadastrado</p></div>';
            return;
        }
        container.innerHTML = '<div class="config-lista">' +
            lista.map(function (t) {
                return '<div class="config-item' + (t.ativo ? '' : ' inativo') + '">' +
                    '<div class="tipo-cor-dot" style="background:' + P.escHtml(t.cor) + ';"></div>' +
                    '<i class="fas ' + P.escHtml(t.icone) + '" style="font-size:18px;color:' + P.escHtml(t.cor) + ';flex-shrink:0;"></i>' +
                    '<div class="config-item-info">' +
                        '<div class="config-item-nome">' + P.escHtml(t.nome) + '</div>' +
                        '<div class="config-item-meta">Icone: ' + P.escHtml(t.icone) + ' — Cor: ' + P.escHtml(t.cor) + ' — Ordem: ' + t.ordem + '</div>' +
                    '</div>' +
                    P.btnAcoes('tipo', t.id, t.ativo) +
                '</div>';
            }).join('') + '</div>';
        P.bindConfigEvents(container, 'tipo', lista, P.abrirModalTipo);
    }

    function abrirModalTipo(item) {
        var P = window.P36;
        P.Estado.modalContexto = 'tipo';
        P.Estado.modalId = item ? item.id : null;
        document.getElementById('modal-edicao-titulo').textContent = item ? 'Editar Tipo de Movimento' : 'Novo Tipo de Movimento';
        document.getElementById('modal-edicao-body').innerHTML =
            '<div class="form-group"><label>Nome *</label><input type="text" id="mf-nome" placeholder="Ex: Para Exames" maxlength="100" value="' + P.escHtml(item ? item.nome : '') + '"></div>' +
            '<div class="form-row-2">' +
                '<div class="form-group"><label>Icone FontAwesome</label><input type="text" id="mf-icone" placeholder="Ex: fa-vials" maxlength="50" value="' + P.escHtml(item ? item.icone : 'fa-ambulance') + '"></div>' +
                '<div class="form-group"><label>Cor (hex)</label><input type="color" id="mf-cor" value="' + P.escHtml(item ? item.cor : '#dc3545') + '" style="height:42px;padding:4px;cursor:pointer;"></div>' +
            '</div>' +
            '<div class="form-group"><label>Ordem</label><input type="number" id="mf-ordem" value="' + (item ? item.ordem : 0) + '" min="0" max="99"></div>';
        document.getElementById('modal-edicao').style.display = '';
    }

    // ── DESTINOS ──────────────────────────────────────────────────

    function carregarDestinos() {
        var P      = window.P36;
        var tipoId = document.getElementById('filtro-tipo-destino').value;
        P.cfgFetch(P.CONFIG.api.cfgDestinos + (tipoId ? '?tipo_id=' + tipoId : ''), 'lista-config-destinos', 'destinos', renderizarCfgDestinos);
    }

    function renderizarCfgDestinos(lista) {
        var P         = window.P36;
        var container = document.getElementById('lista-config-destinos');
        if (!lista || !lista.length) {
            container.innerHTML = '<div class="tabela-vazio"><i class="fas fa-map-marker-alt"></i><p>Nenhum destino cadastrado</p></div>';
            return;
        }
        container.innerHTML = '<div class="config-lista">' +
            lista.map(function (d) {
                return '<div class="config-item' + (d.ativo ? '' : ' inativo') + '">' +
                    '<i class="fas fa-map-marker-alt" style="color:' + (d.ativo ? 'var(--cor-primaria)' : '#aaa') + ';font-size:18px;flex-shrink:0;"></i>' +
                    '<div class="config-item-info">' +
                        '<div class="config-item-nome">' + P.escHtml(d.nome) + '</div>' +
                        '<div class="config-item-meta"><i class="fas fa-route"></i> ' + P.escHtml(d.tipo_nome || '-') + ' — Ordem: ' + d.ordem + '</div>' +
                    '</div>' +
                    P.btnAcoes('destino', d.id, d.ativo) +
                '</div>';
            }).join('') + '</div>';
        P.bindConfigEvents(container, 'destino', lista, P.abrirModalDestino);
    }

    function abrirModalDestino(item) {
        var P       = window.P36;
        P.Estado.modalContexto = 'destino';
        P.Estado.modalId = item ? item.id : null;
        document.getElementById('modal-edicao-titulo').textContent = item ? 'Editar Destino' : 'Novo Destino';
        var opsTipo = P.Estado.tiposMovimento.map(function (t) {
            return '<option value="' + t.id + '"' + ((item && String(item.tipo_movimento_id) === String(t.id)) ? ' selected' : '') + '>' + P.escHtml(t.nome) + '</option>';
        }).join('');
        document.getElementById('modal-edicao-body').innerHTML =
            '<div class="form-group"><label>Nome *</label><input type="text" id="mf-nome" placeholder="Ex: Laboratorio Central" maxlength="200" value="' + P.escHtml(item ? item.nome : '') + '"></div>' +
            '<div class="form-group"><label>Tipo de Movimento *</label><select id="mf-tipo-id"><option value="">Selecione...</option>' + opsTipo + '</select></div>' +
            '<div class="form-group"><label>Ordem</label><input type="number" id="mf-ordem" value="' + (item ? item.ordem : 0) + '" min="0" max="99"></div>';
        document.getElementById('modal-edicao').style.display = '';
    }

    // ── ORIGENS ───────────────────────────────────────────────────

    function carregarCfgOrigens() {
        var P = window.P36;
        P.cfgFetch(P.CONFIG.api.cfgOrigens, 'lista-config-origens', 'origens', renderizarCfgOrigens);
    }

    function renderizarCfgOrigens(lista) {
        var P         = window.P36;
        var container = document.getElementById('lista-config-origens');
        if (!lista || !lista.length) {
            container.innerHTML = '<div class="tabela-vazio"><i class="fas fa-location-dot"></i><p>Nenhuma origem cadastrada — o Painel 34 usa os setores do ETL</p></div>';
            return;
        }
        container.innerHTML = '<div class="config-lista">' +
            lista.map(function (o) {
                return '<div class="config-item' + (o.ativo ? '' : ' inativo') + '">' +
                    '<i class="fas fa-location-dot" style="font-size:18px;color:' + (o.ativo ? 'var(--cor-primaria)' : '#aaa') + ';flex-shrink:0;"></i>' +
                    '<div class="config-item-info">' +
                        '<div class="config-item-nome">' + P.escHtml(o.nome) + '</div>' +
                        '<div class="config-item-meta">Ordem: ' + o.ordem + (o.ativo ? '' : ' — Inativo') + '</div>' +
                    '</div>' +
                    P.btnAcoes('origem', o.id, o.ativo) +
                '</div>';
            }).join('') + '</div>';
        P.bindConfigEvents(container, 'origem', lista, P.abrirModalOrigem);
    }

    function abrirModalOrigem(item) {
        var P = window.P36;
        P.Estado.modalContexto = 'origem';
        P.Estado.modalId = item ? item.id : null;
        document.getElementById('modal-edicao-titulo').textContent = item ? 'Editar Origem' : 'Nova Origem';
        document.getElementById('modal-edicao-body').innerHTML =
            '<div class="form-group"><label>Nome *</label><input type="text" id="mf-nome" placeholder="Ex: Central de Internacao" maxlength="200" value="' + P.escHtml(item ? item.nome : '') + '"></div>' +
            '<div class="form-group"><label>Ordem</label><input type="number" id="mf-ordem" value="' + (item ? item.ordem : 0) + '" min="0" max="99"></div>';
        document.getElementById('modal-edicao').style.display = '';
        setTimeout(function () { var el = document.getElementById('mf-nome'); if (el) el.focus(); }, 50);
    }

    // ── FILTRO DE TIPOS PARA DESTINOS ─────────────────────────────

    function _atualizarFiltroTiposDestino(tipos) {
        var P       = window.P36;
        var sel     = document.getElementById('filtro-tipo-destino');
        var atualVal = sel.value;
        sel.innerHTML = '<option value="">Todos os tipos</option>' +
            tipos.map(function (t) {
                return '<option value="' + t.id + '"' + (String(t.id) === atualVal ? ' selected' : '') + '>' + P.escHtml(t.nome) + '</option>';
            }).join('');
    }

    function carregarTiposParaFiltro() {
        var P = window.P36;
        fetch(P.CONFIG.api.cfgTipos, { credentials: 'same-origin' })
            .then(function (r) { return r.json(); })
            .then(function (data) {
                if (!data.success) return;
                P.Estado.tiposMovimento = data.tipos;
                _atualizarFiltroTiposDestino(data.tipos);
            });
    }

    // ── TOGGLE ATIVO ──────────────────────────────────────────────

    function toggleAtivo(ctx, id, atualAtivo) {
        var P      = window.P36;
        var urlMap = {
            padioleiro: P.CONFIG.api.cfgPadioleiros,
            tipo:       P.CONFIG.api.cfgTipos,
            destino:    P.CONFIG.api.cfgDestinos,
            origem:     P.CONFIG.api.cfgOrigens
        };
        fetch(urlMap[ctx] + '/' + id, {
            method: 'PUT',
            credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ativo: !atualAtivo })
        })
        .then(function (r) { return r.json(); })
        .then(function (data) {
            if (data.success) {
                P.toast(atualAtivo ? 'Desativado com sucesso' : 'Ativado com sucesso', 'success');
                P.carregarConfigAtual();
            } else {
                P.toast(data.error || 'Erro', 'error');
            }
        })
        .catch(function () { P.toast('Erro de conexao', 'error'); });
    }

    // ── DISPATCH SUB-ABAS ─────────────────────────────────────────

    function carregarConfigAtual() {
        var sub = window.P36.Estado.subAbaAtual;
        if      (sub === 'padioleiros') carregarCfgPadioleiros();
        else if (sub === 'tipos')       carregarCfgTipos();
        else if (sub === 'destinos')    carregarDestinos();
        else if (sub === 'origens')     carregarCfgOrigens();
    }

    window.P36.carregarCfgPadioleiros  = carregarCfgPadioleiros;
    window.P36.carregarCfgTipos        = carregarCfgTipos;
    window.P36.carregarDestinos        = carregarDestinos;
    window.P36.carregarCfgOrigens      = carregarCfgOrigens;
    window.P36.carregarTiposParaFiltro = carregarTiposParaFiltro;
    window.P36.abrirModalPadioleiro    = abrirModalPadioleiro;
    window.P36.abrirModalTipo          = abrirModalTipo;
    window.P36.abrirModalDestino       = abrirModalDestino;
    window.P36.abrirModalOrigem        = abrirModalOrigem;
    window.P36.toggleAtivo             = toggleAtivo;
    window.P36.carregarConfigAtual     = carregarConfigAtual;

})();
