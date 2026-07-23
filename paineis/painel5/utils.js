(function () {
    'use strict';

    function escHtml(v) {
        if (v === null || v === undefined) return '';
        var d = document.createElement('div');
        d.textContent = String(v);
        return d.innerHTML;
    }

    function formatarNome(nomeCompleto) {
        if (!nomeCompleto || nomeCompleto.trim() === '') return '-';
        var nome = nomeCompleto.trim().toUpperCase();
        if (!window.P5.Estado.nomesAbreviados) return nome;
        var partes = nome.split(/\s+/);
        if (partes.length === 1) return partes[0];
        var iniciais = '';
        for (var i = 0; i < partes.length - 1; i++) {
            if (i > 0) iniciais += ' ';
            iniciais += partes[i].charAt(0);
        }
        return iniciais + ' ' + partes[partes.length - 1];
    }

    function formatarInicioCirurgia(inicioCirurgia) {
        if (!inicioCirurgia || inicioCirurgia === 'null' || inicioCirurgia.trim() === '') return '-';
        var partes = inicioCirurgia.split(' ');
        if (partes.length >= 2) return partes[1].substring(0, 5);
        return '-';
    }

    function formatarTempo(tempo) {
        if (!tempo || tempo === '::' || tempo === 'null' || tempo.trim() === '') return '-';
        var partes = tempo.split(':');
        if (partes.length === 3) {
            var horas   = parseInt(partes[0]) || 0;
            var minutos = parseInt(partes[1]) || 0;
            if (horas > 0) return horas + 'h ' + minutos + 'm';
            return minutos + 'm';
        }
        return tempo;
    }

    function atualizarHoraAtualizacao() {
        var agora = new Date();
        var hora  = agora.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
        var el = document.querySelector('.ultima-atualizacao');
        if (el) el.textContent = hora;
    }

    window.P5.escHtml                 = escHtml;
    window.P5.formatarNome            = formatarNome;
    window.P5.formatarInicioCirurgia  = formatarInicioCirurgia;
    window.P5.formatarTempo           = formatarTempo;
    window.P5.atualizarHoraAtualizacao = atualizarHoraAtualizacao;

})();
