(function () {
    'use strict';

    // Não executa na própria página de login
    if (window.location.pathname.indexOf('login') !== -1) return;

    var _fetchOriginal = window.fetch;
    var _redirecionando = false;

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
    // Sobrescreve window.fetch para capturar respostas 401 em qualquer chamada
    // -------------------------------------------------------------------------
    window.fetch = function () {
        return _fetchOriginal.apply(this, arguments).then(function (response) {
            if (response.status === 401) {
                redirecionarLogin();
                // Retorna uma promise que nunca resolve para interromper
                // o processamento do painel sem gerar erros desnecessários
                return new Promise(function () {});
            }
            return response;
        });
        // Erros de rede (servidor offline, sem internet) não disparam
        // redirecionamento — o painel exibirá sua própria mensagem de erro.
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
                redirecionarLogin();
            }
        })
        .catch(function () {
            // Servidor indisponível — não redireciona, o painel trata o erro
        });
    });

})();
