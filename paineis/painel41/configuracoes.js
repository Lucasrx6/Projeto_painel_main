(function () {
    'use strict';

    function renderSelectTipos() {
        var DOM   = window.P41.DOM;
        var html  = '<option value="">Selecione o tipo de dieta...</option>';
        var tipos = window.P41.Estado.tipos;
        for (var i = 0; i < tipos.length; i++) {
            var t = tipos[i];
            html += '<option value="' + t.id + '">' + window.P41.escHtml(t.nome) + '</option>';
        }
        DOM.selTipoDieta.innerHTML = html;
    }

    function renderSelectRefeicoes() {
        var DOM      = window.P41.DOM;
        var html     = '<option value="">Selecione a refeição...</option>';
        var refeicoes = window.P41.Estado.refeicoes;
        for (var i = 0; i < refeicoes.length; i++) {
            var r = refeicoes[i];
            var horario = r.horario_inicio ? ' (' + r.horario_inicio + ')' : '';
            html += '<option value="' + r.id + '">' +
                window.P41.escHtml(r.nome) + window.P41.escHtml(horario) + '</option>';
        }
        DOM.selRefeicao.innerHTML = html;
    }

    function renderSelectSetores() {
        var DOM    = window.P41.DOM;
        var html   = '<option value="">Selecione o setor...</option>';
        var setores = window.P41.Estado.setores;
        for (var i = 0; i < setores.length; i++) {
            var nome = setores[i].nome;
            html += '<option value="' + window.P41.escHtml(nome) + '">' +
                window.P41.escHtml(nome) + '</option>';
        }
        DOM.manualSetor.innerHTML = html;
    }

    function renderRestricoes() {
        var DOM       = window.P41.DOM;
        var escHtml   = window.P41.escHtml;
        var restricoes = window.P41.Estado.restricoes;
        if (!restricoes.length) {
            DOM.listaRestricoes.innerHTML = '<span class="carregando-txt">Nenhuma restrição cadastrada.</span>';
            return;
        }
        var html = '';
        for (var i = 0; i < restricoes.length; i++) {
            var r = restricoes[i];
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

    function carregarConfiguracoes() {
        var apiBase = window.P41.CONFIG.apiBase;
        var Estado  = window.P41.Estado;

        fetch(apiBase + '/tipos-dieta', { credentials: 'same-origin' })
            .then(function (r) { return r.json(); })
            .then(function (data) {
                if (data.success) {
                    Estado.tipos = data.tipos;
                    renderSelectTipos();
                }
            })
            .catch(function (e) { console.error('tipos-dieta', e); });

        fetch(apiBase + '/refeicoes', { credentials: 'same-origin' })
            .then(function (r) { return r.json(); })
            .then(function (data) {
                if (data.success) {
                    Estado.refeicoes = data.refeicoes;
                    renderSelectRefeicoes();
                }
            })
            .catch(function (e) { console.error('refeicoes', e); });

        fetch(apiBase + '/restricoes', { credentials: 'same-origin' })
            .then(function (r) { return r.json(); })
            .then(function (data) {
                if (data.success) {
                    Estado.restricoes = data.restricoes;
                    renderRestricoes();
                }
            })
            .catch(function (e) { console.error('restricoes', e); });

        fetch(apiBase + '/setores', { credentials: 'same-origin' })
            .then(function (r) { return r.json(); })
            .then(function (data) {
                if (data.success) {
                    Estado.setores = data.setores;
                    renderSelectSetores();
                }
            })
            .catch(function (e) { console.error('setores', e); });
    }

    window.P41.carregarConfiguracoes = carregarConfiguracoes;

})();
