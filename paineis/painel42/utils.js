(function () {
    'use strict';

    function escHtml(s) {
        return String(s || '')
            .replace(/&/g, '&amp;').replace(/</g, '&lt;')
            .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    function fmtMin(n) {
        var total = Math.round(Number(n) || 0);
        if (total <= 0) return '0min';
        if (total < 60) return total + 'min';
        var h = Math.floor(total / 60);
        var m = total % 60;
        return m > 0 ? (h + 'h ' + m + 'min') : (h + 'h');
    }

    function badgeStatus(status) {
        var cfg = window.P42.STATUS_CFG[status] || { label: status, cor: '#6C757D' };
        return '<span class="badge-status" style="background:' + cfg.cor + ';">' + escHtml(cfg.label) + '</span>';
    }

    function fecharModal(el) {
        el.style.display = 'none';
    }

    function atualizarTimestamp() {
        var agora = new Date();
        var h = agora.getHours();
        var m = agora.getMinutes();
        var s = agora.getSeconds();
        var el = window.P42.DOM.ultimoUpdate;
        if (el) {
            el.textContent = 'Atualizado: ' +
                (h < 10 ? '0' : '') + h + ':' +
                (m < 10 ? '0' : '') + m + ':' +
                (s < 10 ? '0' : '') + s;
        }
    }

    window.P42.escHtml           = escHtml;
    window.P42.fmtMin            = fmtMin;
    window.P42.badgeStatus       = badgeStatus;
    window.P42.fecharModal       = fecharModal;
    window.P42.atualizarTimestamp = atualizarTimestamp;

})();
