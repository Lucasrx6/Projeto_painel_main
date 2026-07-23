(function () {
    'use strict';

    function escHtml(text) {
        if (!text) return '';
        return String(text)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    function atualizarTimestamp() {
        var el = document.getElementById('ultima-atualizacao');
        if (!el) return;
        var agora = new Date();
        var h = ('0' + agora.getHours()).slice(-2);
        var m = ('0' + agora.getMinutes()).slice(-2);
        el.textContent = h + ':' + m;
    }

    window.P17.escHtml            = escHtml;
    window.P17.atualizarTimestamp = atualizarTimestamp;

})();
