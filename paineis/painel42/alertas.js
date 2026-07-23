(function () {
    'use strict';

    var _tituloOriginal = document.title;
    var _tituloTimer    = null;

    function tocarAlerta() {
        try {
            var audio = window.P42.DOM.audioAlerta;
            audio.currentTime = 0;
            audio.play();
        } catch (e) { /* autoplay bloqueado */ }
    }

    function piscarTela() {
        var container = document.querySelector('.painel-container');
        if (!container) return;
        container.classList.remove('notificacao-nova');
        void container.offsetWidth;
        container.classList.add('notificacao-nova');
    }

    function alertarTitulo() {
        if (_tituloTimer) clearTimeout(_tituloTimer);
        document.title = '● NOVA SOLICITAÇÃO — Tela Nutrição';
        _tituloTimer = setTimeout(function () {
            document.title = _tituloOriginal;
            _tituloTimer = null;
        }, 15000);
    }

    function alertarTituloEmPreparo() {
        if (_tituloTimer) clearTimeout(_tituloTimer);
        document.title = 'EM PREPARO - Tela Nutricao';
        _tituloTimer = setTimeout(function () {
            document.title = _tituloOriginal;
            _tituloTimer = null;
        }, 15000);
    }

    function notificarNavegador(titulo, corpo) {
        if (!('Notification' in window) || Notification.permission !== 'granted') return;
        try {
            var n = new Notification(titulo, {
                body:     corpo,
                icon:     '/static/img/favicon.png',
                tag:      'p42-nutricao',
                renotify: true
            });
            setTimeout(function () { n.close(); }, 8000);
        } catch (e) { /* silencioso — pode falhar em kiosk mode */ }
    }

    function atualizarIconeNotif() {
        var DOM = window.P42.DOM;
        if (!DOM.btnNotifToggle || !DOM.iconeNotif) return;
        if (!('Notification' in window)) {
            DOM.btnNotifToggle.style.display = 'none';
            return;
        }
        if (Notification.permission === 'granted') {
            DOM.iconeNotif.className    = 'fa-solid fa-bell';
            DOM.btnNotifToggle.title    = 'Notificacoes ativas — clique para testar';
            DOM.btnNotifToggle.style.color = '#28a745';
        } else if (Notification.permission === 'denied') {
            DOM.iconeNotif.className    = 'fa-solid fa-bell-slash';
            DOM.btnNotifToggle.title    = 'Notificacoes bloqueadas — ative no cadeado da barra de endereco';
            DOM.btnNotifToggle.style.color = '#dc3545';
        } else {
            DOM.iconeNotif.className    = 'fa-solid fa-bell';
            DOM.btnNotifToggle.title    = 'Clique para ativar notificacoes do Windows';
            DOM.btnNotifToggle.style.color = '#6c757d';
        }
    }

    function pedirPermissaoNotif() {
        if (!('Notification' in window)) {
            alert('Este navegador nao suporta notificacoes.');
            return;
        }
        if (Notification.permission === 'granted') {
            notificarNavegador('Notificacoes ativas!', 'Voce ja recebe alertas mesmo com o navegador minimizado.');
            return;
        }
        if (Notification.permission === 'denied') {
            alert('Notificacoes bloqueadas.\n\nPara ativar: clique no cadeado na barra de endereco > Notificacoes > Permitir.');
            return;
        }
        Notification.requestPermission().then(function (perm) {
            atualizarIconeNotif();
            if (perm === 'granted') {
                notificarNavegador('Notificacoes ativas!', 'Voce recebera alertas mesmo com o navegador minimizado.');
            }
        });
    }

    document.addEventListener('visibilitychange', function () {
        if (!document.hidden && _tituloTimer) {
            clearTimeout(_tituloTimer);
            _tituloTimer = null;
            document.title = _tituloOriginal;
        }
    });

    window.P42.tocarAlerta           = tocarAlerta;
    window.P42.piscarTela            = piscarTela;
    window.P42.alertarTitulo         = alertarTitulo;
    window.P42.alertarTituloEmPreparo = alertarTituloEmPreparo;
    window.P42.notificarNavegador    = notificarNavegador;
    window.P42.atualizarIconeNotif   = atualizarIconeNotif;
    window.P42.pedirPermissaoNotif   = pedirPermissaoNotif;

})();
