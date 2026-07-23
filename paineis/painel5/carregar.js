(function () {
    'use strict';

    function atualizarDashboard(dados) {
        document.getElementById('total-cirurgias').textContent       = parseInt(dados.total_cirurgias)    || 0;
        document.getElementById('cirurgias-previstas').textContent   = parseInt(dados.cirurgias_previstas)  || 0;
        document.getElementById('cirurgias-andamento').textContent   = parseInt(dados.cirurgias_andamento)  || 0;
        document.getElementById('cirurgias-realizadas').textContent  = parseInt(dados.cirurgias_realizadas) || 0;
    }

    function mostrarErro(mensagem) {
        var container = document.getElementById('cirurgias-content');
        if (!container) return;
        container.innerHTML =
            '<div class="empty-message">' +
                '<i class="fas fa-exclamation-triangle" style="color:#dc3545"></i>' +
                '<h3>Erro ao Carregar Dados</h3>' +
                '<p>' + window.P5.escHtml(mensagem) + '</p>' +
                '<button onclick="window.P5.carregarDados()" style="' +
                    'margin-top:15px;padding:10px 20px;background:#dc3545;color:white;' +
                    'border:none;border-radius:8px;cursor:pointer;font-size:0.9rem;font-weight:600">' +
                    '<i class="fas fa-sync-alt"></i> Tentar Novamente' +
                '</button>' +
            '</div>';
    }

    function carregarDados() {
        var P5     = window.P5;
        var CONFIG = P5.CONFIG;
        var Estado = P5.Estado;
        var params = Estado.setorSelecionado === 'hemo' ? '?setor=hemo' : '?setor=cc';

        Promise.all([
            fetch(CONFIG.apiDashboard + params, { credentials: 'same-origin' }),
            fetch(CONFIG.apiCirurgias  + params, { credentials: 'same-origin' })
        ]).then(function (respostas) {
            if (!respostas[0].ok || !respostas[1].ok) throw new Error('Erro ao carregar dados');
            return Promise.all([respostas[0].json(), respostas[1].json()]);
        }).then(function (dados) {
            var dashboardData = dados[0];
            var cirurgiasData = dados[1];

            if (dashboardData.success && cirurgiasData.success) {
                atualizarDashboard(dashboardData.data);
                Estado.dadosCirurgias = cirurgiasData.data;
                P5.renderizarCirurgias(Estado.dadosCirurgias);
                P5.atualizarHoraAtualizacao();

                if (!Estado.autoScrollAtivo && Estado.timeoutAutoScrollInicial === null) {
                    Estado.timeoutAutoScrollInicial = setTimeout(function () {
                        var btnAS = document.getElementById('btn-auto-scroll');
                        if (btnAS) {
                            Estado.autoScrollAtivo = true;
                            btnAS.classList.add('active');
                            btnAS.innerHTML = '<i class="fas fa-pause"></i> Pausar';
                            P5.iniciarAutoScroll();
                        }
                    }, CONFIG.delayInicioAutoScroll);
                }
            } else {
                mostrarErro('Erro ao processar dados');
            }
        }).catch(function (erro) {
            console.error('Erro:', erro);
            mostrarErro('Erro de conexao');
        });
    }

    window.P5.carregarDados     = carregarDados;
    window.P5.atualizarDashboard = atualizarDashboard;
    window.P5.mostrarErro       = mostrarErro;

})();
