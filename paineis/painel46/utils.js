(function () {
    'use strict';

    // ── Toast ─────────────────────────────────────────────────────────────────

    function toast(msg, tipo) {
        var c = document.getElementById('toast-container');
        if (!c) return;
        var el = document.createElement('div');
        el.className = 'toast toast-' + (tipo || 'info');
        el.textContent = msg;
        c.appendChild(el);
        setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 3500);
    }

    // ── Formatação de datas e horas ───────────────────────────────────────────

    function isoParaDisplay(iso) {
        if (!iso || iso.length < 10) return '';
        return iso.slice(8, 10) + '/' + iso.slice(5, 7) + '/' + iso.slice(0, 4);
    }

    function displayParaISO(str) {
        if (!str) return '';
        var p = str.split('/');
        if (p.length !== 3 || p[2].length < 4) return '';
        return p[2] + '-' + ('0' + p[1]).slice(-2) + '-' + ('0' + p[0]).slice(-2);
    }

    function hojeISO() {
        var d = new Date();
        return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2);
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
            var d = new Date(iso);
            return d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
        } catch (e) { return iso; }
    }

    function labelData(iso) {
        try {
            var hoje   = new Date().toISOString().slice(0, 10);
            var amanha = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
            if (iso === hoje)   return 'Hoje';
            if (iso === amanha) return 'Amanhã';
            var p = iso.split('-');
            return p[2] + '/' + p[1];
        } catch (e) { return iso; }
    }

    // ── Utilitários DOM ───────────────────────────────────────────────────────

    function escHtml(t) {
        if (!t) return '';
        var d = document.createElement('div');
        d.textContent = t;
        return d.innerHTML;
    }

    function setStatusDot(offline) {
        var el = document.getElementById('status-dot');
        if (!el) return;
        el.className = offline ? 'status-dot offline' : 'status-dot';
    }

    function abrirModal(modalId) {
        var el = document.getElementById(modalId);
        if (el) el.style.display = 'flex';
    }

    function fecharModal(modalId) {
        var el = document.getElementById(modalId);
        if (el) el.style.display = 'none';
    }

    // ── Badges ────────────────────────────────────────────────────────────────

    function badgeTipoExame(tipo) {
        var cores = {
            'RX':     ['#0d6efd', '#cfe2ff'],
            'RM':     ['#6f42c1', '#e2d9f3'],
            'TC':     ['#0dcaf0', '#cff4fc'],
            'USG':    ['#198754', '#d1e7dd'],
            'MAM':    ['#fd7e14', '#ffe5d0'],
            'OUTROS': ['#6c757d', '#e2e3e5']
        };
        if (!tipo) return '';
        var c = cores[tipo] || cores['OUTROS'];
        return '<span class="badge-tipo-ex" style="background:' + c[1] + ';color:' + c[0] + ';border-color:' + c[0] + '">'
             + escHtml(tipo) + '</span>';
    }

    function badgeStatusEnf(enf) {
        if (!enf || enf === 'pendente')
            return '<span class="badge-enf badge-enf-pendente"><i class="fas fa-clock"></i> Aguard. Ciência</span>';
        if (enf === 'ciente')
            return '<span class="badge-enf badge-enf-ciente"><i class="fas fa-check"></i> Ciente</span>';
        if (enf === 'recusado')
            return '<span class="badge-enf badge-enf-recusado"><i class="fas fa-times"></i> Recusado</span>';
        return '';
    }

    // ── Expor tudo no namespace P46 ───────────────────────────────────────────

    window.P46.toast            = toast;
    window.P46.isoParaDisplay   = isoParaDisplay;
    window.P46.displayParaISO   = displayParaISO;
    window.P46.hojeISO          = hojeISO;
    window.P46.escHtml          = escHtml;
    window.P46.formatarNome     = formatarNome;
    window.P46.formatarHora     = formatarHora;
    window.P46.formatarDataHora = formatarDataHora;
    window.P46.labelData        = labelData;
    window.P46.setStatusDot     = setStatusDot;
    window.P46.abrirModal       = abrirModal;
    window.P46.fecharModal      = fecharModal;
    window.P46.badgeTipoExame   = badgeTipoExame;
    window.P46.badgeStatusEnf   = badgeStatusEnf;

})();
