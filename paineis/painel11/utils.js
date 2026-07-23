(function () {
    'use strict';

    function salvar(key, valor) {
        try {
            localStorage.setItem(
                window.P11.CONFIG.storagePrefix + key,
                typeof valor === 'object' ? JSON.stringify(valor) : valor
            );
        } catch (e) {}
    }

    function recuperar(key) {
        try { return localStorage.getItem(window.P11.CONFIG.storagePrefix + key); } catch (e) { return null; }
    }

    function recuperarArray(key) {
        try {
            var r = localStorage.getItem(window.P11.CONFIG.storagePrefix + key);
            if (r) return JSON.parse(r);
        } catch (e) {}
        return [];
    }

    function atualizarStatus(s) {
        var el = window.P11.DOM.statusIndicator;
        if (!el) return;
        el.className = 'status-indicator';
        if (s === 'online')  { el.classList.add('status-online');  el.title = 'Conectado';    }
        else if (s === 'offline') { el.classList.add('status-offline'); el.title = 'Sem conexao'; }
        else if (s === 'loading') { el.classList.add('status-loading'); el.title = 'Carregando...'; }
    }

    function atualizarHorario() {
        var el = window.P11.DOM.ultimaAtualizacao;
        if (!el) return;
        el.textContent = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    }

    function escapeAttr(t) {
        if (!t) return '';
        return String(t).replace(/"/g, '&quot;').replace(/</g, '&lt;');
    }

    function formatarNome(nomeCompleto) {
        if (!nomeCompleto || nomeCompleto.trim() === '') return '-';
        var partes = nomeCompleto.trim().toUpperCase().split(/\s+/);
        if (partes.length === 1) return partes[0];
        var iniciais = [];
        for (var i = 0; i < partes.length - 1; i++) iniciais.push(partes[i].charAt(0));
        return iniciais.join(' ') + ' ' + partes[partes.length - 1];
    }

    function abreviarTexto(texto, max) {
        if (!texto) return '-';
        return texto.length > max ? texto.substring(0, max) + '...' : texto;
    }

    function extrairTipoVaga(necessidade) {
        if (!necessidade) return 'CLINICA';
        var t = necessidade.toUpperCase();
        if (t.indexOf('UTI') !== -1) return 'UTI';
        if (t.indexOf('CIRURGICA') !== -1) return 'CIRURGICA';
        return 'CLINICA';
    }

    function determinarClasseLinha(tempoMinutos, tipoVaga, status) {
        var CONFIG = window.P11.CONFIG;
        var statusFinais = ['INTERNADO', 'CHAMADO', 'ACOMODADO', 'TRANSFERIDO', 'CANCELADO_NEGADO'];
        if (statusFinais.indexOf(status) !== -1) return '';
        if (tipoVaga === 'UTI') return 'vaga-uti';
        if (tempoMinutos >= CONFIG.minutosCritico) return 'alerta-critico';
        if (tempoMinutos >= CONFIG.minutosAlerta)  return 'alerta-medio';
        return '';
    }

    function formatarDataHora(dataHora) {
        if (!dataHora) return '-';
        try {
            var d = new Date(dataHora);
            if (isNaN(d.getTime())) return dataHora;
            return ('0' + d.getDate()).slice(-2) + '/' + ('0' + (d.getMonth() + 1)).slice(-2)
                + ' ' + ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2);
        } catch (e) { return dataHora; }
    }

    function formatarTempoEspera(minutos) {
        if (!minutos || minutos <= 0) return '-';
        var h = Math.floor(minutos / 60);
        var m = Math.floor(minutos % 60);
        return h > 0 ? h + 'h ' + m + 'm' : m + 'm';
    }

    window.P11.salvar               = salvar;
    window.P11.recuperar            = recuperar;
    window.P11.recuperarArray       = recuperarArray;
    window.P11.atualizarStatus      = atualizarStatus;
    window.P11.atualizarHorario     = atualizarHorario;
    window.P11.escapeAttr           = escapeAttr;
    window.P11.formatarNome         = formatarNome;
    window.P11.abreviarTexto        = abreviarTexto;
    window.P11.extrairTipoVaga      = extrairTipoVaga;
    window.P11.determinarClasseLinha = determinarClasseLinha;
    window.P11.formatarDataHora     = formatarDataHora;
    window.P11.formatarTempoEspera  = formatarTempoEspera;

})();
