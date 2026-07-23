(function () {
    'use strict';

    function escHtml(t) {
        if (!t) return '';
        var d = document.createElement('div');
        d.textContent = t;
        return d.innerHTML;
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

    function formatarNome(nome) {
        if (!nome || !nome.trim()) return '-';
        var p = nome.trim().toUpperCase().split(/\s+/);
        if (p.length === 1) return p[0];
        var ini = [];
        for (var i = 0; i < p.length - 1; i++) ini.push(p[i].charAt(0) + '.');
        return ini.join(' ') + ' ' + p[p.length - 1];
    }

    function formatarDataHora(iso) {
        if (!iso) return '-';
        try {
            var d = new Date(iso);
            return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' })
                 + ' ' + d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
        } catch (e) { return iso; }
    }

    function atualizarHora() {
        var el = document.getElementById('ultima-atualizacao');
        if (el) el.textContent = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    }

    function badgeStatus(status) {
        var mapa = {
            'pendente':   ['badge-pendente',   'fa-hourglass',      'Pendente'],
            'agendado':   ['badge-agendado',   'fa-calendar-check', 'Agendado'],
            'no_local':   ['badge-no_local',   'fa-map-marker-alt', 'No Local'],
            'executando': ['badge-executando', 'fa-spinner',        'Executando'],
            'concluido':  ['badge-concluido',  'fa-check-double',   'Concluído'],
            'cancelado':  ['badge-cancelado',  'fa-ban',            'Cancelado']
        };
        var m = mapa[status] || ['badge-pendente', 'fa-circle', status || '?'];
        return '<span class="badge-status ' + m[0] + '"><i class="fas ' + m[1] + '"></i> ' + m[2] + '</span>';
    }

    function badgeStatusEnf(enf) {
        if (!enf || enf === 'pendente')
            return '<span class="badge-enf badge-enf-pendente"><i class="fas fa-clock"></i> Aguard. Ciência</span>';
        if (enf === 'ciente')
            return '<span class="badge-enf badge-enf-ciente"><i class="fas fa-check"></i> Ciente</span>';
        if (enf === 'recusado')
            return '<span class="badge-enf badge-enf-recusado"><i class="fas fa-times"></i> Recusado Enf.</span>';
        return '';
    }

    function badgeProdStatus(status) {
        if (status === 'LAUDADO')
            return '<span class="badge-status badge-concluido"><i class="fas fa-check-double"></i> Laudado</span>';
        if (status === 'EXECUTADO_SEM_LAUDO')
            return '<span class="badge-status badge-no_local"><i class="fas fa-hourglass-half"></i> Sem Laudo</span>';
        if (status === 'AGUARDANDO')
            return '<span class="badge-status badge-pendente"><i class="fas fa-clock"></i> Aguardando</span>';
        return '<span style="font-size:11px;color:#aaa;">' + escHtml(status || '-') + '</span>';
    }

    window.P47.escHtml        = escHtml;
    window.P47.toast          = toast;
    window.P47.formatarNome   = formatarNome;
    window.P47.formatarDataHora = formatarDataHora;
    window.P47.atualizarHora  = atualizarHora;
    window.P47.badgeStatus    = badgeStatus;
    window.P47.badgeStatusEnf = badgeStatusEnf;
    window.P47.badgeProdStatus = badgeProdStatus;

})();
