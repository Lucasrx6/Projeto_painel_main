(function () {
    'use strict';

    function renderSelectMembroModal() {
        var escHtml = window.P42.escHtml;
        var html = '<option value="">Selecione o responsável...</option>';
        var eq = window.P42.Estado.equipe;
        for (var i = 0; i < eq.length; i++) {
            var m = eq[i];
            html += '<option value="' + m.id + '">' + escHtml(m.nome) +
                    ' (' + escHtml(m.funcao) + ')</option>';
        }
        window.P42.DOM.accSelMembro.innerHTML = html;
    }

    function carregarEquipe() {
        fetch(window.P42.CONFIG.apiBase + '/equipe', { credentials: 'same-origin' })
            .then(function (r) { return r.json(); })
            .then(function (data) {
                if (data.success) {
                    window.P42.Estado.equipe = data.equipe || [];
                    renderSelectMembroModal();
                }
            })
            .catch(function (e) { console.error('equipe', e); });
    }

    window.P42.carregarEquipe = carregarEquipe;

})();
