// ========================================
// PAINEL 28 - HUB CENTRALIZADOR
// Hospital Anchieta Ceilandia
// ========================================

(function () {
    'use strict';

    var BASE_URL = window.location.origin;

    var CONFIG = {
        apiServicos: BASE_URL + '/api/paineis/painel28/servicos'
    };

    // ========================================
    // INICIALIZACAO
    // ========================================

    function inicializar() {
        console.log('Inicializando Painel 28 - Hub Centralizador...');

        configurarNavegacao();
        montarSaudacao();
        carregarServicos();

        console.log('Painel 28 Hub inicializado');
    }

    // ========================================
    // NAVEGACAO
    // ========================================

    function configurarNavegacao() {
        var btnVoltar = document.getElementById('btn-voltar');
        if (btnVoltar) {
            btnVoltar.addEventListener('click', function () {
                window.location.href = '/frontend/dashboard.html';
            });
        }
    }

    // ========================================
    // SAUDACAO DINAMICA
    // ========================================

    function montarSaudacao() {
        var el = document.getElementById('saudacao-texto');
        if (!el) return;

        var hora = new Date().getHours();
        var saudacao = 'Bem-vindo!';

        if (hora >= 5 && hora < 12) {
            saudacao = 'Bom dia!';
        } else if (hora >= 12 && hora < 18) {
            saudacao = 'Boa tarde!';
        } else {
            saudacao = 'Boa noite!';
        }

        el.textContent = saudacao;
    }

    // ========================================
    // CARREGAR SERVICOS
    // ========================================

    function carregarServicos() {
        var grid = document.getElementById('servicos-grid');
        var loading = document.getElementById('loading-servicos');
        var vazio = document.getElementById('servicos-vazio');

        fetch(CONFIG.apiServicos)
            .then(function (res) { return res.json(); })
            .then(function (data) {
                if (loading) loading.style.display = 'none';

                if (data.success && data.data && data.data.length > 0) {
                    renderizarServicos(data.data);
                } else {
                    if (grid) grid.style.display = 'none';
                    if (vazio) vazio.style.display = 'block';
                }
            })
            .catch(function (err) {
                console.error('Erro ao carregar servicos:', err);
                if (loading) loading.style.display = 'none';
                if (grid) grid.style.display = 'none';
                if (vazio) {
                    vazio.style.display = 'block';
                    var p = vazio.querySelector('p');
                    if (p) p.textContent = 'Erro ao carregar servicos';
                }
                mostrarToast('Erro ao carregar servicos', 'erro');
            });
    }

    // ========================================
    // RENDERIZAR CARDS DE SERVICOS
    // ========================================

    function renderizarServicos(servicos) {
        var grid = document.getElementById('servicos-grid');
        if (!grid) return;

        grid.innerHTML = servicos.map(function (srv) {
            var cor = srv.cor || '#dc3545';
            var icone = srv.icone || 'fas fa-cube';
            var url = srv.url_destino || '';
            var descricao = srv.descricao || '';

            var html = '<div class="servico-card" ';
            html += 'style="--servico-cor: ' + escapeAttr(cor) + ';" ';
            html += 'data-url="' + escapeAttr(url) + '" ';
            html += 'onclick="window.HUB.navegarServico(this)" ';
            html += 'role="button" tabindex="0">';
            html += '  <div class="servico-icone" style="background: ' + escapeAttr(cor) + ';">';
            html += '    <i class="' + escapeAttr(icone) + '"></i>';
            html += '  </div>';
            html += '  <div class="servico-nome">' + escapeHtml(srv.nome) + '</div>';
            if (descricao) {
                html += '  <div class="servico-descricao">' + escapeHtml(descricao) + '</div>';
            }
            html += '</div>';

            return html;
        }).join('');

        // Acessibilidade: Enter/Space nos cards
        var cards = grid.querySelectorAll('.servico-card');
        for (var i = 0; i < cards.length; i++) {
            cards[i].addEventListener('keydown', function (e) {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    window.HUB.navegarServico(this);
                }
            });
        }
    }

    // ========================================
    // NAVEGACAO PARA SERVICO
    // ========================================

    function navegarServico(cardEl) {
        var url = cardEl.getAttribute('data-url');
        if (!url || url === '#' || url === '') {
            mostrarToast('Servico em desenvolvimento', 'info');
            return;
        }

        // Feedback visual ao clicar
        cardEl.style.opacity = '0.6';
        setTimeout(function () {
            window.location.href = url;
        }, 150);
    }

    // ========================================
    // UTILITARIOS
    // ========================================

    function escapeHtml(text) {
        if (!text) return '';
        var div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    function escapeAttr(text) {
        if (!text) return '';
        return text
            .replace(/&/g, '&amp;')
            .replace(/'/g, '&#39;')
            .replace(/"/g, '&quot;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');
    }

    function mostrarToast(msg, tipo) {
        var c = document.getElementById('toast-container');
        if (!c) return;
        var t = document.createElement('div');
        t.className = 'toast toast-' + (tipo || 'info');
        var icone = '';
        switch (tipo) {
            case 'sucesso': icone = '<i class="fas fa-check-circle"></i>'; break;
            case 'erro': icone = '<i class="fas fa-times-circle"></i>'; break;
            default: icone = '<i class="fas fa-info-circle"></i>';
        }
        t.innerHTML = icone + ' ' + escapeHtml(msg);
        c.appendChild(t);
        setTimeout(function () {
            if (t.parentNode) t.parentNode.removeChild(t);
        }, 4000);
    }

    // ========================================
    // EXPOR FUNCOES GLOBAIS
    // ========================================

    window.HUB = {
        navegarServico: navegarServico
    };

    // ========================================
    // START
    // ========================================

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', inicializar);
    } else {
        inicializar();
    }

})();