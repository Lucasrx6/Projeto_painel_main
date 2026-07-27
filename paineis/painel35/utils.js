(function () {
    'use strict';
    var P = window.P35;

    function escHtml(str) {
        if (!str) return '';
        return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    function toast(msg, tipo) {
        var container = document.getElementById('toast-container');
        var el = document.createElement('div');
        el.className = 'toast toast-' + (tipo || 'info');
        el.textContent = msg;
        container.appendChild(el);
        setTimeout(function () { el.remove(); }, 3500);
    }

    function salvarPadioleiroLocal(id) {
        try { localStorage.setItem('padioleiro_id_selecionado', id || ''); } catch (e) {}
    }

    function carregarPadioleiroLocal() {
        try { return localStorage.getItem('padioleiro_id_selecionado') || null; } catch (e) { return null; }
    }

    function atualizarStatusConexao(online) {
        var el = document.getElementById('status-conexao');
        if (online) { el.className = 'status-online'; el.title = 'Conectado'; }
        else { el.className = 'status-online status-offline'; el.title = 'Sem conexao'; }
    }

    function emitirAlertaSonoro() {
        try {
            var ctx = new (window.AudioContext || window.webkitAudioContext)();
            [440, 550, 660].forEach(function (freq, i) {
                var osc  = ctx.createOscillator();
                var gain = ctx.createGain();
                osc.connect(gain);
                gain.connect(ctx.destination);
                osc.frequency.value = freq;
                gain.gain.setValueAtTime(0.3, ctx.currentTime + i * 0.15);
                gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + i * 0.15 + 0.3);
                osc.start(ctx.currentTime + i * 0.15);
                osc.stop(ctx.currentTime + i * 0.15 + 0.3);
            });
        } catch (e) {}
    }

    function mostrarAlertaNovoChamado(qtd) {
        var alerta = document.createElement('div');
        alerta.className = 'alerta-novo';
        alerta.innerHTML = '<i class="fas fa-bell"></i> ' + qtd + ' novo' + (qtd > 1 ? 's' : '') + ' chamado' + (qtd > 1 ? 's' : '') + ' na fila!';
        document.body.appendChild(alerta);
        setTimeout(function () { alerta.remove(); }, 4000);
    }

    P.escHtml                  = escHtml;
    P.toast                    = toast;
    P.salvarPadioleiroLocal    = salvarPadioleiroLocal;
    P.carregarPadioleiroLocal  = carregarPadioleiroLocal;
    P.atualizarStatusConexao   = atualizarStatusConexao;
    P.emitirAlertaSonoro       = emitirAlertaSonoro;
    P.mostrarAlertaNovoChamado = mostrarAlertaNovoChamado;
})();
