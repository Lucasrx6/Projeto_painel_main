(function () {
    'use strict';

    function escHtml(s) {
        return String(s || '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    function badgeStatus(status) {
        var cfg = window.P41.STATUS_CONFIG[status] || { label: status, cor: '#6C757D' };
        return '<span class="badge-status" style="background:' + cfg.cor + ';">' +
               escHtml(cfg.label) + '</span>';
    }

    function debounce(fn, ms) {
        var timer = null;
        return function () {
            var args = arguments;
            clearTimeout(timer);
            timer = setTimeout(function () { fn.apply(null, args); }, ms);
        };
    }

    window.P41.escHtml     = escHtml;
    window.P41.badgeStatus = badgeStatus;
    window.P41.debounce    = debounce;

})();
