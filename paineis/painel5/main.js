(function () {
    'use strict';

    function atualizarBotaoPrivacidade(btn) {
        var P5 = window.P5;
        if (P5.Estado.nomesAbreviados) {
            btn.classList.add('active');
            btn.innerHTML = '<i class="fas fa-user-shield"></i> LGPD';
            btn.title = 'LGPD ativo: nomes abreviados - clique para mostrar nomes completos';
        } else {
            btn.classList.remove('active');
            btn.innerHTML = '<i class="fas fa-user"></i> Nome';
            btn.title = 'Nomes completos visiveis - clique para ativar protecao LGPD';
        }
    }

    function atualizarBotaoSetor(btn) {
        var texto = document.getElementById('btn-setor-texto');
        if (window.P5.Estado.setorSelecionado === 'hemo') {
            btn.classList.add('hemo-ativo');
            btn.querySelector('i').className = 'fas fa-heartbeat';
            btn.title = 'Exibindo: Hemodinamica - clique para Centro Cirurgico';
            if (texto) texto.textContent = 'Hemodinamica';
        } else {
            btn.classList.remove('hemo-ativo');
            btn.querySelector('i').className = 'fas fa-procedures';
            btn.title = 'Exibindo: Centro Cirurgico - clique para Hemodinamica';
            if (texto) texto.textContent = 'Centro Cirurgico';
        }
    }

    function configurarBtnPrivacidade() {
        var btn = document.getElementById('btn-privacidade');
        if (!btn) return;
        atualizarBotaoPrivacidade(btn);
        btn.addEventListener('click', function () {
            var P5 = window.P5;
            P5.Estado.nomesAbreviados = !P5.Estado.nomesAbreviados;
            localStorage.setItem('painel5_nomes_abreviados', P5.Estado.nomesAbreviados ? 'true' : 'false');
            atualizarBotaoPrivacidade(btn);
            if (P5.Estado.dadosCirurgias.length > 0) {
                var scrollAtivo = P5.Estado.autoScrollAtivo;
                P5.renderizarCirurgias(P5.Estado.dadosCirurgias);
                if (scrollAtivo) P5.iniciarAutoScroll();
            }
        });
    }

    function configurarBtnSetor() {
        var btn = document.getElementById('btn-setor');
        if (!btn) return;
        atualizarBotaoSetor(btn);
        btn.addEventListener('click', function () {
            var P5 = window.P5;
            P5.Estado.setorSelecionado = P5.Estado.setorSelecionado === 'cc' ? 'hemo' : 'cc';
            localStorage.setItem('painel5_setor_selecionado', P5.Estado.setorSelecionado);
            atualizarBotaoSetor(btn);
            P5.carregarDados();
        });
    }

    function inicializar() {
        var P5 = window.P5;

        var btnVoltar = document.getElementById('btn-voltar');
        if (btnVoltar) {
            btnVoltar.addEventListener('click', function () {
                window.location.href = '/frontend/dashboard.html';
            });
        }

        var btnRefresh = document.getElementById('btn-refresh');
        if (btnRefresh) {
            btnRefresh.addEventListener('click', function () {
                P5.carregarDados();
            });
        }

        var btnAutoScroll = document.getElementById('btn-auto-scroll');
        if (btnAutoScroll) {
            btnAutoScroll.addEventListener('click', function () {
                P5.Estado.autoScrollAtivo = !P5.Estado.autoScrollAtivo;
                if (P5.Estado.autoScrollAtivo) {
                    btnAutoScroll.classList.add('active');
                    btnAutoScroll.innerHTML = '<i class="fas fa-pause"></i> Pausar';
                    P5.iniciarAutoScroll();
                } else {
                    btnAutoScroll.classList.remove('active');
                    btnAutoScroll.innerHTML = '<i class="fas fa-play"></i> Auto Scroll';
                    P5.pararAutoScroll();
                }
            });
        }

        configurarBtnPrivacidade();
        configurarBtnSetor();

        P5.carregarDados();
        setInterval(P5.carregarDados, P5.CONFIG.intervaloRefresh);
    }

    window.addEventListener('DOMContentLoaded', inicializar);

})();
