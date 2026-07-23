(function () {
    'use strict';

    function badgeEnf(status) {
        var mapa = {
            'pendente': ['badge-enf-pendente', 'fa-clock', 'Aguard. Ciência'],
            'ciente':   ['badge-enf-ciente',   'fa-check', 'Ciente'],
            'recusado': ['badge-enf-recusado', 'fa-times', 'Recusado']
        };
        var m = mapa[status] || ['', 'fa-question', status || '?'];
        return '<span class="badge-status ' + m[0] + '"><i class="fas ' + m[1] + '"></i> ' + m[2] + '</span>';
    }

    function badgeTipo(tipo) {
        var cores = {
            'RX':     ['#0d6efd', '#cfe2ff'],
            'RM':     ['#6f42c1', '#e2d9f3'],
            'TC':     ['#0dcaf0', '#cff4fc'],
            'USG':    ['#198754', '#d1e7dd'],
            'MAM':    ['#fd7e14', '#ffe5d0'],
            'OUTROS': ['#6c757d', '#e2e3e5']
        };
        var escHtml = window.P45.escHtml;
        var c = cores[tipo] || cores['OUTROS'];
        return '<span class="badge-tipo" style="background:' + c[1] + ';color:' + c[0] + ';border-color:' + c[0] + '">'
             + escHtml(tipo || 'OUTROS') + '</span>';
    }

    function badgeRadioStatus(s) {
        var mapa = {
            'pendente':   ['badge-radio-pendente', 'fa-hourglass-half', 'Sem horário'],
            'agendado':   ['badge-radio-agendado', 'fa-calendar-check', 'Agendado'],
            'no_local':   ['badge-radio-nolo',     'fa-map-marker-alt', 'No Local'],
            'executando': ['badge-radio-exec',     'fa-spinner',        'Executando'],
            'concluido':  ['badge-radio-conc',     'fa-check-double',   'Concluído']
        };
        var m = mapa[s];
        if (!m) return '';
        return '<span class="badge-status ' + m[0] + '"><i class="fas ' + m[1] + '"></i> ' + m[2] + '</span>';
    }

    window.P45.badgeEnf        = badgeEnf;
    window.P45.badgeTipo       = badgeTipo;
    window.P45.badgeRadioStatus = badgeRadioStatus;

})();
