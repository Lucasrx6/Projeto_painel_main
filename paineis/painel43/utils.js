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
        var cor   = window.P43.STATUS_COR[status]   || '#6C757D';
        var label = window.P43.STATUS_LABEL[status] || status;
        return '<span class="badge-st" style="background:' + cor + ';">' + escHtml(label) + '</span>';
    }

    window.P43.escHtml     = escHtml;
    window.P43.fmtMin      = fmtMin;
    window.P43.badgeStatus = badgeStatus;

})();
