(function () {
    'use strict';

    function carregarDados() {
        var P11    = window.P11;
        var Estado = P11.Estado;

        if (Estado.carregando) return;
        Estado.carregando = true;
        P11.atualizarStatus('loading');

        var scrollEstaAtivo = Estado.autoScrollAtivo;
        if (scrollEstaAtivo) P11.pararAutoScroll();

        Promise.all([
            fetch(P11.construirUrl(),           { credentials: 'same-origin' }).then(function (r) { return r.json(); }),
            fetch(P11.construirUrlDashboard(),   { credentials: 'same-origin' }).then(function (r) { return r.json(); })
        ]).then(function (resultados) {
            var listaData = resultados[0];
            var dashData  = resultados[1];

            if (listaData.success) {
                Estado.dados = listaData.data || [];
                P11.renderizarTabela(Estado.dados);
            } else {
                P11.mostrarErro('Erro ao processar dados');
            }

            if (dashData.success) {
                P11.atualizarDashboard(dashData.data);
            }

            P11.atualizarHorario();
            P11.atualizarStatus('online');

            if (scrollEstaAtivo) {
                setTimeout(function () {
                    Estado.autoScrollAtivo = true;
                    P11.atualizarBotaoScroll();
                    P11.iniciarAutoScroll();
                }, 500);
            }

            if (!Estado.autoScrollIniciado && !scrollEstaAtivo) {
                P11.agendarAutoScrollInicial();
            }

            Estado.carregando = false;
        }).catch(function (err) {
            console.error('[P11] Erro ao carregar dados:', err);
            P11.atualizarStatus('offline');
            P11.mostrarErro('Erro de conexao com o servidor');
            Estado.carregando = false;
        });
    }

    window.P11.carregarDados = carregarDados;

})();
