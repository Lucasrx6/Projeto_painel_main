// =============================================================================
// PAINEL 31 - HUB DA CENTRAL DE ML
// =============================================================================

var BASE_URL = window.location.origin;

var CONFIG = {
    apiModelos: BASE_URL + '/api/paineis/painel31/modelos',
    intervaloRefresh: 60000
};

function inicializar() {
    console.log('Inicializando Hub Central de ML...');
    configurarBotoes();
    carregarModelos();
    setInterval(carregarModelos, CONFIG.intervaloRefresh);
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', inicializar);
} else {
    inicializar();
}

function configurarBotoes() {
    var btnVoltar = document.getElementById('btn-voltar');
    if (btnVoltar) {
        btnVoltar.addEventListener('click', function() {
            window.location.href = '/frontend/dashboard.html';
        });
    }
    var btnRefresh = document.getElementById('btn-refresh');
    if (btnRefresh) {
        btnRefresh.addEventListener('click', function() {
            btnRefresh.classList.add('girando');
            carregarModelos();
            setTimeout(function() { btnRefresh.classList.remove('girando'); }, 600);
        });
    }
}

function carregarModelos() {
    fetch(CONFIG.apiModelos, { credentials: 'include' })
        .then(function(r) { return r.json(); })
        .then(function(data) {
            if (data.success) {
                renderizarKPIs(data.modelos);
                renderizarModelos(data.modelos);
                atualizarTimestamp();
                var ind = document.getElementById('status-indicator');
                if (ind) ind.className = 'status-indicator status-online';
            }
        })
        .catch(function(err) {
            console.error('Erro:', err);
            var grid = document.getElementById('modelos-grid');
            if (grid) grid.innerHTML = '<div class="mensagem-vazia"><i class="fas fa-exclamation-triangle"></i><p>Erro ao carregar modelos</p></div>';
        });
}

function renderizarKPIs(modelos) {
    var totalModelos = modelos.length;
    var emProducao = 0;
    var totalPredicoes = 0;
    var verdes = 0, total_status = 0;

    modelos.forEach(function(m) {
        if (m.status === 'producao') emProducao++;
        totalPredicoes += (m.total_predicoes || 0);
        if (m.status_saude && m.status_saude !== 'sem_dados') {
            total_status++;
            if (m.status_saude === 'verde') verdes++;
        }
    });

    var saudeGeral = '--';
    if (total_status > 0) {
        var pct = (verdes / total_status) * 100;
        saudeGeral = Math.round(pct) + '%';
    }

    document.getElementById('kpi-total-modelos').textContent = totalModelos;
    document.getElementById('kpi-em-producao').textContent = emProducao;
    document.getElementById('kpi-total-predicoes').textContent = totalPredicoes.toLocaleString('pt-BR');
    document.getElementById('kpi-saude-geral').textContent = saudeGeral;
}

function renderizarModelos(modelos) {
    var grid = document.getElementById('modelos-grid');
    if (!grid) return;

    if (!modelos || modelos.length === 0) {
        grid.innerHTML = '<div class="mensagem-vazia"><i class="fas fa-cube"></i><p>Nenhum modelo registrado</p></div>';
        return;
    }

    var html = '';
    modelos.forEach(function(m) {
        var saudeClasse = 'cinza';
        var saudeIcone = 'fa-question-circle';
        var saudeTexto = 'Sem dados';
        if (m.status_saude === 'verde') { saudeClasse = 'verde'; saudeIcone = 'fa-check-circle'; saudeTexto = 'Saudavel'; }
        else if (m.status_saude === 'amarelo') { saudeClasse = 'amarelo'; saudeIcone = 'fa-exclamation-circle'; saudeTexto = 'Atencao'; }
        else if (m.status_saude === 'vermelho') { saudeClasse = 'vermelho'; saudeIcone = 'fa-exclamation-triangle'; saudeTexto = 'Critico'; }

        var statusClasse = m.status || 'desenvolvimento';
        var ultimaExec = m.ultima_execucao ? formatarDataHora(m.ultima_execucao) : 'Nunca';

        html += '<div class="modelo-card" onclick="abrirModelo(\'' + escapeHtml(m.nome_modelo) + '\')">';
        html += '  <div class="modelo-card-header">';
        html += '    <span class="modelo-card-titulo">' + escapeHtml(m.nome_modelo) + '</span>';
        html += '    <span class="modelo-card-versao">' + escapeHtml(m.versao) + '</span>';
        html += '  </div>';
        html += '  <div class="modelo-card-body">';
        html += '    <p class="modelo-card-desc">' + escapeHtml(m.descricao || 'Sem descricao') + '</p>';
        html += '    <div class="modelo-metricas-row">';
        html += '      <div class="modelo-metrica"><span class="modelo-metrica-valor">' + (m.mae_teste || '--') + '</span><span class="modelo-metrica-label">MAE</span></div>';
        html += '      <div class="modelo-metrica"><span class="modelo-metrica-valor">' + (m.mape_teste ? m.mape_teste + '%' : '--') + '</span><span class="modelo-metrica-label">MAPE</span></div>';
        html += '      <div class="modelo-metrica"><span class="modelo-metrica-valor">' + (m.num_features || '--') + '</span><span class="modelo-metrica-label">Features</span></div>';
        html += '    </div>';
        html += '    <span class="badge-status ' + statusClasse + '">' + statusClasse + '</span>';
        html += '  </div>';
        html += '  <div class="modelo-card-footer">';
        html += '    <span><i class="fas fa-clock"></i> Ultima exec: ' + ultimaExec + '</span>';
        html += '    <span class="badge-saude ' + saudeClasse + '"><i class="fas ' + saudeIcone + '"></i> ' + saudeTexto + '</span>';
        html += '  </div>';
        html += '</div>';
    });
    grid.innerHTML = html;
}

function abrirModelo(nome) {
    window.location.href = '/painel/painel31/' + nome;
}

function atualizarTimestamp() {
    var el = document.getElementById('ultima-atualizacao');
    if (el) {
        var d = new Date();
        var h = d.getHours().toString(); if (h.length < 2) h = '0' + h;
        var m = d.getMinutes().toString(); if (m.length < 2) m = '0' + m;
        el.textContent = h + ':' + m;
    }
}

function formatarDataHora(iso) {
    if (!iso) return '--';
    var d = new Date(iso);
    var dia = d.getDate().toString(); if (dia.length < 2) dia = '0' + dia;
    var mes = (d.getMonth() + 1).toString(); if (mes.length < 2) mes = '0' + mes;
    var h = d.getHours().toString(); if (h.length < 2) h = '0' + h;
    var min = d.getMinutes().toString(); if (min.length < 2) min = '0' + min;
    return dia + '/' + mes + ' ' + h + ':' + min;
}

function escapeHtml(text) {
    if (!text) return '';
    return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}