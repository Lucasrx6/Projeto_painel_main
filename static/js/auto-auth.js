(function () {
    'use strict';

    // Não executa na própria página de login nem na página de setup de TV
    if (window.location.pathname.indexOf('login') !== -1) return;
    if (window.location.pathname.indexOf('/tv/setup') !== -1) return;

    var _fetchOriginal = window.fetch;
    var _redirecionando = false;
    var _reconectando = false;

    // -------------------------------------------------------------------------
    // Monta a URL de login com o parâmetro ?next apontando para o painel atual
    // -------------------------------------------------------------------------
    function getLoginUrl() {
        return '/login?next=' + encodeURIComponent(window.location.href);
    }

    // -------------------------------------------------------------------------
    // Executa o redirecionamento uma única vez (evita loops em caso de race)
    // -------------------------------------------------------------------------
    function redirecionarLogin() {
        if (_redirecionando) return;
        _redirecionando = true;
        console.warn('[AUTO-AUTH] Sessão inativa — redirecionando para login...');
        window.location.href = getLoginUrl();
    }

    // -------------------------------------------------------------------------
    // Tenta reconectar usando token de dispositivo TV armazenado no localStorage.
    // Se não houver token ou o token for inválido/revogado, redireciona ao login.
    // -------------------------------------------------------------------------
    function tentarReconectarTV() {
        if (_reconectando) return;

        var token = localStorage.getItem('tv_device_token');
        if (!token) {
            redirecionarLogin();
            return;
        }

        _reconectando = true;
        console.info('[AUTO-AUTH] Sessão expirada — reconectando terminal TV...');

        _fetchOriginal('/api/tv-login', {
            method: 'POST',
            credentials: 'same-origin',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({token: token})
        })
        .then(function (r) { return r.json(); })
        .then(function (data) {
            if (data.success) {
                console.info('[AUTO-AUTH] Reconectado como TV: ' + data.dispositivo);
                window.location.reload();
            } else {
                console.warn('[AUTO-AUTH] Token TV inválido/revogado — redirecionando...');
                localStorage.removeItem('tv_device_token');
                redirecionarLogin();
            }
        })
        .catch(function () {
            // Servidor indisponível — não redireciona; o painel exibirá seu próprio erro
            _reconectando = false;
        });
    }

    // -------------------------------------------------------------------------
    // Sobrescreve window.fetch para capturar respostas 401 em qualquer chamada
    // -------------------------------------------------------------------------
    window.fetch = function () {
        return _fetchOriginal.apply(this, arguments).then(function (response) {
            if (response.status === 401) {
                tentarReconectarTV();
                // Retorna uma promise que nunca resolve para interromper
                // o processamento do painel sem gerar erros desnecessários
                return new Promise(function () {});
            }
            return response;
        });
        // Erros de rede (servidor offline) não disparam redirecionamento
    };

    // -------------------------------------------------------------------------
    // Verifica sessão ao carregar a página
    // -------------------------------------------------------------------------
    document.addEventListener('DOMContentLoaded', function () {
        _fetchOriginal('/api/verificar-sessao', {
            method: 'GET',
            credentials: 'include'
        })
        .then(function (response) { return response.json(); })
        .then(function (data) {
            if (!data.autenticado) {
                tentarReconectarTV();
            }
        })
        .catch(function () {
            // Servidor indisponível — não redireciona, o painel trata o erro
        });
    });

})();
