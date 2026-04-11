// =============================================================================
// PAINEL 31 - SUB-PAGINA PS VOLUME (com tabs)
// =============================================================================

var BASE_URL = window.location.origin;

var CONFIG = {
    apiPrevisoes:     BASE_URL + '/api/paineis/painel31/previsoes/ps_volume',
    apiMetricas:      BASE_URL + '/api/paineis/painel31/metricas/ps_volume',
    apiModelo:        BASE_URL + '/api/paineis/painel31/modelo/ps_volume',
    apiHistoricoReal: BASE_URL + '/api/paineis/painel31/historico-real',
    apiPicosHoje:     BASE_URL + '/api/paineis/painel31/picos-hoje',
    intervaloRefresh: 300000
};

var grafico = null;

function inicializar() {
    console.log('Inicializando PS Volume...');
    configurarBotoes();
    configurarTabs();
    carregarTudo();
    setInterval(carregarTudo, CONFIG.intervaloRefresh);
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', inicializar);
} else {
    inicializar();
}

function configurarBotoes() {
    var btnVoltar = document.getElementById('btn-voltar');
    if (btnVoltar) {
        btnVoltar.addEventListener('click', function() { window.location.href = '/painel/painel31'; });
    }
    var btnRefresh = document.getElementById('btn-refresh');
    if (btnRefresh) {
        btnRefresh.addEventListener('click', function() {
            btnRefresh.classList.add('girando');
            carregarTudo();
            setTimeout(function() { btnRefresh.classList.remove('girando'); }, 600);
        });
    }
}

function configurarTabs() {
    var botoes = document.querySelectorAll('.tab-btn');
    botoes.forEach(function(btn) {
        btn.addEventListener('click', function() {
            var tab = btn.getAttribute('data-tab');
            botoes.forEach(function(b) { b.classList.remove('ativo'); });
            btn.classList.add('ativo');
            var conteudos = document.querySelectorAll('.tab-content');
            conteudos.forEach(function(c) { c.classList.remove('ativo'); });
            var alvo = document.getElementById('tab-' + tab);
            if (alvo) alvo.classList.add('ativo');
        });
    });
}

function carregarTudo() {
    Promise.all([
        fetch(CONFIG.apiPrevisoes,     { credentials: 'include' }).then(function(r) { return r.json(); }),
        fetch(CONFIG.apiMetricas,      { credentials: 'include' }).then(function(r) { return r.json(); }),
        fetch(CONFIG.apiModelo,        { credentials: 'include' }).then(function(r) { return r.json(); }),
        fetch(CONFIG.apiHistoricoReal, { credentials: 'include' }).then(function(r) { return r.json(); }),
        fetch(CONFIG.apiPicosHoje,     { credentials: 'include' }).then(function(r) { return r.json(); })
    ]).then(function(results) {
        var prev = results[0], met = results[1], mod = results[2], hist = results[3], picos = results[4];

        if (prev.success) {
            renderizarDestaqueHoje(prev.previsoes_futuras);
            renderizarComparativo(prev.previsoes_futuras, hist.success ? hist.historico : []);
            renderizarPrevisoesGrid(prev.previsoes_futuras);
            renderizarGrafico(prev.historico_realizado, prev.previsoes_futuras);
        }
        if (hist.success)  renderizarHistoricoGrid(hist.historico);
        if (met.success)   renderizarKPIsMetricas(met);
        if (mod.success)   { renderizarSubtitulo(mod.modelo); renderizarInfoTecnica(mod.modelo); }
        if (picos.success) renderizarPicos(picos);

        atualizarTimestamp();
        var ind = document.getElementById('status-indicator');
        if (ind) ind.className = 'status-indicator status-online';
    }).catch(function(err) { console.error('Erro:', err); });
}

// ----- DESTAQUE HOJE -----
function renderizarDestaqueHoje(futuras) {
    if (!futuras || futuras.length === 0) return;

    var hoje = new Date(); hoje.setHours(0, 0, 0, 0);
    var hojeStr = hoje.getFullYear() + '-' + ('0' + (hoje.getMonth() + 1)).slice(-2) + '-' + ('0' + hoje.getDate()).slice(-2);

    var previsaoHoje = null;
    futuras.forEach(function(f) {
        if (f.dt_alvo === hojeStr || f.dt_alvo.indexOf(hojeStr) === 0) previsaoHoje = f;
    });

    if (!previsaoHoje) previsaoHoje = futuras[0];

    document.getElementById('hoje-valor').textContent = Math.round(previsaoHoje.valor_previsto);
    document.getElementById('hoje-faixa').textContent =
        Math.round(previsaoHoje.intervalo_inferior) + ' a ' + Math.round(previsaoHoje.intervalo_superior);
}

// ----- COMPARATIVO ONTEM/HOJE/AMANHA -----
function renderizarComparativo(futuras, historico) {
    var hoje = new Date(); hoje.setHours(0, 0, 0, 0);
    var ontem = new Date(hoje); ontem.setDate(ontem.getDate() - 1);
    var amanha = new Date(hoje); amanha.setDate(amanha.getDate() + 1);

    var hojeStr = formatarISO(hoje);
    var ontemStr = formatarISO(ontem);
    var amanhaStr = formatarISO(amanha);

    // Ontem (real)
    var ontemValor = '--';
    if (historico && historico.length > 0) {
        historico.forEach(function(h) {
            if (h.data === ontemStr || h.data.indexOf(ontemStr) === 0) {
                ontemValor = h.atendimentos;
            }
        });
    }
    document.getElementById('ontem-valor').textContent = ontemValor;

    // Hoje + Amanha (previsto)
    var hojeValor = '--', amanhaValor = '--';
    if (futuras && futuras.length > 0) {
        futuras.forEach(function(f) {
            if (f.dt_alvo === hojeStr || f.dt_alvo.indexOf(hojeStr) === 0) hojeValor = Math.round(f.valor_previsto);
            if (f.dt_alvo === amanhaStr || f.dt_alvo.indexOf(amanhaStr) === 0) amanhaValor = Math.round(f.valor_previsto);
        });
    }
    document.getElementById('hoje-valor-pequeno').textContent = hojeValor;
    document.getElementById('amanha-valor').textContent = amanhaValor;
}

// ----- PROXIMOS 7 DIAS -----
function renderizarPrevisoesGrid(futuras) {
    var grid = document.getElementById('previsoes-grid');
    if (!grid) return;
    if (!futuras || futuras.length === 0) {
        grid.innerHTML = '<div class="mensagem-vazia"><i class="fas fa-calendar-xmark"></i><p>Sem previsoes disponiveis</p></div>';
        return;
    }

    var dias = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sab'];
    var hoje = new Date(); hoje.setHours(0, 0, 0, 0);
    var amanha = new Date(hoje); amanha.setDate(amanha.getDate() + 1);

    var html = '';
    futuras.forEach(function(f) {
        var d = new Date(f.dt_alvo + 'T00:00:00');
        var nomeDia = dias[d.getDay()];
        var dataStr = ('0' + d.getDate()).slice(-2) + '/' + ('0' + (d.getMonth() + 1)).slice(-2);
        var classe = (d.getTime() === amanha.getTime()) ? 'previsao-dia amanha' : 'previsao-dia';

        html += '<div class="' + classe + '">';
        html += '  <div class="previsao-dia-data">' + dataStr + '</div>';
        html += '  <div class="previsao-dia-nome">' + nomeDia + '</div>';
        html += '  <div class="previsao-dia-valor">' + Math.round(f.valor_previsto) + '</div>';
        html += '  <div class="previsao-dia-unidade">atendimentos</div>';
        html += '  <div class="previsao-dia-faixa">' + Math.round(f.intervalo_inferior) + ' - ' + Math.round(f.intervalo_superior) + '</div>';
        html += '</div>';
    });
    grid.innerHTML = html;
}

// ----- HISTORICO 14 DIAS -----
function renderizarHistoricoGrid(historico) {
    var grid = document.getElementById('historico-grid');
    if (!grid) return;
    if (!historico || historico.length === 0) {
        grid.innerHTML = '<div class="mensagem-vazia"><i class="fas fa-clock"></i><p>Sem historico disponivel</p></div>';
        return;
    }

    var dias = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sab'];
    var html = '';
    historico.forEach(function(h) {
        var d = new Date(h.data + 'T00:00:00');
        var nomeDia = dias[d.getDay()];
        var dataStr = ('0' + d.getDate()).slice(-2) + '/' + ('0' + (d.getMonth() + 1)).slice(-2);

        html += '<div class="historico-dia">';
        html += '  <div class="historico-dia-data">' + dataStr + '</div>';
        html += '  <div class="historico-dia-nome">' + nomeDia + '</div>';
        html += '  <div class="historico-dia-valor">' + h.atendimentos + '</div>';
        html += '  <div class="historico-dia-unidade">atendimentos</div>';
        html += '</div>';
    });
    grid.innerHTML = html;
}


function renderizarPicos(data) {
    var body = document.getElementById('picos-body');
    if (!body) return;

    if (!data.top_picos || data.top_picos.length === 0) {
        body.innerHTML = '<div class="mensagem-vazia"><i class="fas fa-clock"></i><p>Aguardando previsao de hoje</p></div>';
        return;
    }

    var html = '';

    // Banner do proximo pico
    if (data.proximo_pico) {
        var horaFmt = ('0' + data.proximo_pico.hora).slice(-2) + ':00';
        html += '<div class="proximo-pico-banner">';
        html += '  <i class="fas fa-triangle-exclamation"></i>';
        html += '  <span>Proximo pico: <strong>' + horaFmt + '</strong> com ~<strong>' + data.proximo_pico.estimado + '</strong> atendimentos esperados</span>';
        html += '</div>';
    }

    // Top 3 picos do dia
    html += '<div class="picos-lista">';
    data.top_picos.forEach(function(p) {
        var horaFmt = ('0' + p.hora).slice(-2) + 'h';
        html += '<div class="pico-item">';
        html += '  <div class="pico-item-hora">' + horaFmt + '</div>';
        html += '  <div class="pico-item-estimativa">~' + p.estimado + '</div>';
        html += '  <div class="pico-item-label">atendimentos</div>';
        html += '</div>';
    });
    html += '</div>';

    body.innerHTML = html;
}


// ----- ABA TECNICA: KPIs -----
function renderizarKPIsMetricas(data) {
    document.getElementById('kpi-mae-baseline').textContent = data.mae_baseline || '--';
    document.getElementById('kpi-mape-baseline').textContent = data.mape_baseline ? data.mape_baseline + '%' : '--';

    var m30 = data.metricas && data.metricas.janela_30d;
    if (m30) {
        document.getElementById('kpi-mae-30d').textContent = m30.mae;
        var statusEl = document.getElementById('kpi-status-saude');
        var s = m30.status_saude;
        if (s === 'verde') statusEl.textContent = 'Saudavel';
        else if (s === 'amarelo') statusEl.textContent = 'Atencao';
        else if (s === 'vermelho') statusEl.textContent = 'Critico';
        else statusEl.textContent = 'Sem dados';
    } else {
        document.getElementById('kpi-mae-30d').textContent = '--';
        document.getElementById('kpi-status-saude').textContent = 'Aguardando';
    }
}

function renderizarSubtitulo(modelo) {
    var sub = document.getElementById('subtitulo-modelo');
    if (sub) sub.textContent = 'Modelo ' + modelo.algoritmo + ' ' + modelo.versao;
}

// ----- ABA TECNICA: INFO DETALHADA -----
function renderizarInfoTecnica(modelo) {
    var container = document.getElementById('info-modelo-tecnica');
    if (!container) return;

    var html = '<h3><i class="fas fa-circle-info"></i> Detalhes do modelo</h3>';
    html += '<div class="info-grid">';
    html += '  <div class="info-item"><div class="info-item-label">Nome</div><div class="info-item-valor">' + escapeHtml(modelo.nome_modelo) + '</div></div>';
    html += '  <div class="info-item"><div class="info-item-label">Versao</div><div class="info-item-valor">' + escapeHtml(modelo.versao) + '</div></div>';
    html += '  <div class="info-item"><div class="info-item-label">Algoritmo</div><div class="info-item-valor">' + escapeHtml(modelo.algoritmo) + '</div></div>';
    html += '  <div class="info-item"><div class="info-item-label">Categoria</div><div class="info-item-valor">' + escapeHtml(modelo.categoria || '--') + '</div></div>';
    html += '  <div class="info-item"><div class="info-item-label">Status</div><div class="info-item-valor">' + escapeHtml(modelo.status) + '</div></div>';
    html += '  <div class="info-item"><div class="info-item-label">Features</div><div class="info-item-valor">' + (modelo.num_features || '--') + '</div></div>';
    html += '  <div class="info-item"><div class="info-item-label">Amostras de treino</div><div class="info-item-valor">' + (modelo.num_amostras_treino || '--') + '</div></div>';
    html += '  <div class="info-item"><div class="info-item-label">Periodo de treino</div><div class="info-item-valor">' + (modelo.periodo_treino_inicio || '--') + ' a ' + (modelo.periodo_treino_fim || '--') + '</div></div>';
    html += '  <div class="info-item"><div class="info-item-label">RMSE</div><div class="info-item-valor">' + (modelo.rmse_teste || '--') + '</div></div>';
    html += '</div>';
    container.innerHTML = html;
}

// ----- GRAFICO -----
function renderizarGrafico(historico, futuras) {
    var ctx = document.getElementById('grafico-previsao');
    if (!ctx) return;

    var labels = [], realizadoData = [], previstoHistData = [], previstoFuturoData = [], faixaSup = [], faixaInf = [];

    historico.forEach(function(h) {
        labels.push(formatarDataCurta(h.dt_alvo));
        realizadoData.push(h.valor_realizado);
        previstoHistData.push(h.valor_previsto);
        previstoFuturoData.push(null);
        faixaSup.push(null);
        faixaInf.push(null);
    });
    futuras.forEach(function(f) {
        labels.push(formatarDataCurta(f.dt_alvo));
        realizadoData.push(null);
        previstoHistData.push(null);
        previstoFuturoData.push(f.valor_previsto);
        faixaSup.push(f.intervalo_superior);
        faixaInf.push(f.intervalo_inferior);
    });

    if (grafico) grafico.destroy();

    grafico = new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [
                { label: 'Realizado', data: realizadoData, borderColor: '#2c3e50', backgroundColor: 'rgba(44,62,80,0.05)', borderWidth: 2.5, tension: 0.3, pointRadius: 3, spanGaps: false },
                { label: 'Previsto (historico)', data: previstoHistData, borderColor: '#dc3545', borderWidth: 2, borderDash: [4, 4], tension: 0.3, pointRadius: 2, spanGaps: false },
                { label: 'Previsto (futuro)', data: previstoFuturoData, borderColor: '#dc3545', backgroundColor: 'rgba(220,53,69,0.1)', borderWidth: 3, tension: 0.3, pointRadius: 5, pointBackgroundColor: '#dc3545', fill: false, spanGaps: false },
                { label: 'Faixa superior', data: faixaSup, borderColor: 'rgba(220,53,69,0.3)', borderWidth: 1, pointRadius: 0, fill: '+1', backgroundColor: 'rgba(220,53,69,0.08)', tension: 0.3, spanGaps: false },
                { label: 'Faixa inferior', data: faixaInf, borderColor: 'rgba(220,53,69,0.3)', borderWidth: 1, pointRadius: 0, tension: 0.3, spanGaps: false }
            ]
        },
        options: {
            responsive: true, maintainAspectRatio: false,
            interaction: { mode: 'index', intersect: false },
            plugins: {
                legend: { position: 'top', labels: { filter: function(item) { return item.text.indexOf('Faixa') === -1; }, font: { size: 11 } } },
                tooltip: { callbacks: { label: function(ctx) { if (ctx.parsed.y === null) return null; return ctx.dataset.label + ': ' + Math.round(ctx.parsed.y) + ' atendimentos'; } } }
            },
            scales: {
                y: { beginAtZero: false, title: { display: true, text: 'Atendimentos/dia' } },
                x: { ticks: { maxRotation: 45, minRotation: 45 } }
            }
        }
    });
}

// ----- HELPERS -----
function formatarISO(d) {
    return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2);
}

function formatarDataCurta(iso) {
    if (!iso) return '';
    var d = new Date(iso + 'T00:00:00');
    return ('0' + d.getDate()).slice(-2) + '/' + ('0' + (d.getMonth() + 1)).slice(-2);
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

function escapeHtml(text) {
    if (!text) return '';
    return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}