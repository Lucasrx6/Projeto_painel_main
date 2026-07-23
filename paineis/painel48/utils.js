(function () {
    'use strict';

    function escHtml(str) {
        if (str === null || str === undefined) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    function mascaraCpf(v) {
        v = v.replace(/\D/g, '').slice(0, 11);
        if (v.length <= 3) return v;
        if (v.length <= 6) return v.slice(0, 3) + '.' + v.slice(3);
        if (v.length <= 9) return v.slice(0, 3) + '.' + v.slice(3, 6) + '.' + v.slice(6);
        return v.slice(0, 3) + '.' + v.slice(3, 6) + '.' + v.slice(6, 9) + '-' + v.slice(9, 11);
    }

    function lerParams() {
        var q      = (window.location.search || '').replace(/^\?/, '');
        var pares  = q.split('&');
        var resultado = {};
        for (var i = 0; i < pares.length; i++) {
            var kv = pares[i].split('=');
            if (kv.length >= 2) {
                resultado[decodeURIComponent(kv[0])] = decodeURIComponent(kv.slice(1).join('='));
            }
        }
        return resultado;
    }

    function toast(msg, tipo) {
        var container = document.getElementById('toast-container');
        if (!container) return;
        var el = document.createElement('div');
        el.className = 'toast toast-' + (tipo || 'info');
        el.innerHTML = escHtml(msg);
        container.appendChild(el);
        setTimeout(function () { el.classList.add('toast-saindo'); }, 3000);
        setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 3500);
    }

    function mostrarLoading() {
        var mc = document.getElementById('main-content');
        if (mc) {
            mc.innerHTML = '<div class="loading"><div class="loading-spinner"></div><span>Carregando...</span></div>';
        }
    }

    function formatarDataHora(iso) {
        if (!iso) return '-';
        var d = new Date(iso);
        return d.toLocaleDateString('pt-BR') + ' '
             + d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    }

    function nomeContexto(codigo) {
        var mapa = {
            'entrega_refeicao': 'Entrega de Refeição',
            'alta':             'Alta Hospitalar',
            'tcle':             'Termo de Consentimento'
        };
        return mapa[codigo] || codigo;
    }

    function pad2(n) {
        return n < 10 ? '0' + n : String(n);
    }

    window.P48.escHtml          = escHtml;
    window.P48.mascaraCpf       = mascaraCpf;
    window.P48.lerParams        = lerParams;
    window.P48.toast            = toast;
    window.P48.mostrarLoading   = mostrarLoading;
    window.P48.formatarDataHora = formatarDataHora;
    window.P48.nomeContexto     = nomeContexto;
    window.P48.pad2             = pad2;

})();
