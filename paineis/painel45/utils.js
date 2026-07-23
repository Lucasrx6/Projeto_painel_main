(function () {
    'use strict';

    function pad2(n) { return n < 10 ? '0' + n : '' + n; }

    function hojeISO() {
        var d = new Date();
        return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
    }

    function toast(msg, tipo) {
        var c = document.getElementById('toast-container');
        if (!c) return;
        var el = document.createElement('div');
        el.className = 'toast toast-' + (tipo || 'info');
        el.textContent = msg;
        c.appendChild(el);
        setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 3500);
    }

    function escHtml(t) {
        if (!t) return '';
        var d = document.createElement('div');
        d.textContent = t;
        return d.innerHTML;
    }

    function formatarNome(nome) {
        if (!nome || !nome.trim()) return '-';
        var p = nome.trim().toUpperCase().split(/\s+/);
        if (p.length === 1) return p[0];
        var ini = [];
        for (var i = 0; i < p.length - 1; i++) ini.push(p[i].charAt(0) + '.');
        return ini.join(' ') + ' ' + p[p.length - 1];
    }

    function formatarHora(iso) {
        if (!iso) return '-';
        try {
            var d = new Date(iso);
            return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
        } catch (e) { return iso; }
    }

    function formatarDataHora(iso) {
        if (!iso) return '-';
        try {
            var d    = new Date(iso);
            var hoje = new Date();
            var mesmodia = d.getDate()     === hoje.getDate()
                        && d.getMonth()    === hoje.getMonth()
                        && d.getFullYear() === hoje.getFullYear();
            var h = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
            if (mesmodia) return h;
            return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }) + ' ' + h;
        } catch (e) { return iso; }
    }

    window.P45.pad2            = pad2;
    window.P45.hojeISO         = hojeISO;
    window.P45.toast           = toast;
    window.P45.escHtml         = escHtml;
    window.P45.formatarNome    = formatarNome;
    window.P45.formatarHora    = formatarHora;
    window.P45.formatarDataHora = formatarDataHora;

})();
