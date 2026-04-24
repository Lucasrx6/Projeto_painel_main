// =============================================================================
// PAINEL 31 - SUB-PAGINA INTERNACOES (com tabs)
// =============================================================================

var BASE_URL = window.location.origin;

var CONFIG = {
    apiPrevisoes:     BASE_URL + '/api/paineis/painel31/previsoes/internacoes',
    apiMetricas:      BASE_URL + '/api/paineis/painel31/metricas/internacoes',
    apiModelo:        BASE_URL + '/api/paineis/painel31/modelo/internacoes',
    apiHistoricoReal: BASE_URL + '/api/paineis/painel31/historico-real/internacoes',
    intervaloRefresh: 300000
};

var grafico = null;
var previsoesAtuais = [];
var historicoAtual = [];
var segmentoAtualGrid = 'total';
var segmentoAtualGrafico = 'total';
var diasHistorico = 30;

function inicializar() {
    console.log('Inicializando Internacoes...');
    configurarBotoes();
    configurarTabs();
    configurarSeletorPeriodo();
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

    var segBtns = document.querySelectorAll('.segmento-btn');
    segBtns.forEach(function(btn) {
        btn.addEventListener('click', function() {
            segBtns.forEach(function(b) { b.classList.remove('ativo'); });
            btn.classList.add('ativo');
            segmentoAtualGrid = btn.getAttribute('data-seg');
            renderizarPrevisoesGrid(previsoesAtuais, segmentoAtualGrid);
            renderizarHistoricoGridComAcerto(historicoAtual, segmentoAtualGrid);
        });
    });

    // Tabs de segmento no grafico
    var segBtnsGrafico = document.querySelectorAll('.segmento-btn-grafico');
    segBtnsGrafico.forEach(function(btn) {
        btn.addEventListener('click', function() {
            segBtnsGrafico.forEach(function(b) { b.classList.remove('ativo'); });
            btn.classList.add('ativo');
            segmentoAtualGrafico = btn.getAttribute('data-seg-g');
            renderizarGrafico(historicoAtual, previsoesAtuais, segmentoAtualGrafico);
        });
    });
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

function configurarSeletorPeriodo() {
    var botoes = document.querySelectorAll('.btn-periodo');
    botoes.forEach(function(btn) {
        btn.addEventListener('click', function() {
            var dias = parseInt(btn.getAttribute('data-dias'));
            if (dias === diasHistorico) return;
            diasHistorico = dias;
            botoes.forEach(function(b) { b.classList.remove('ativo'); });
            btn.classList.add('ativo');

            var sub = document.getElementById('grafico-subtitle');
            if (sub) sub.textContent = 'Ultimos ' + dias + ' dias e proximos 7 dias';

            // Recarrega os dados do grafico
            fetch(CONFIG.apiPrevisoes + '?dias=' + dias, { credentials: 'include' })
                .then(function(r) { return r.json(); })
                .then(function(data) {
                    if (data.success) {
                        previsoesAtuais = data.previsoes_futuras;
                        historicoAtual = data.historico_realizado;
                        renderizarGrafico(historicoAtual, previsoesAtuais, segmentoAtualGrafico);
                    }
                });
        });
    });
}

function carregarTudo() {
    Promise.all([
        fetch(CONFIG.apiPrevisoes + '?dias=' + diasHistorico, { credentials: 'include' }).then(function(r) { return r.json(); }),
        fetch(CONFIG.apiMetricas,      { credentials: 'include' }).then(function(r) { return r.json(); }),
        fetch(CONFIG.apiModelo,        { credentials: 'include' }).then(function(r) { return r.json(); }),
        fetch(CONFIG.apiHistoricoReal, { credentials: 'include' }).then(function(r) { return r.json(); })
    ]).then(function(results) {
        var prev = results[0], met = results[1], mod = results[2], hist = results[3];

        if (prev.success) {
            previsoesAtuais = prev.previsoes_futuras;
            historicoAtual = prev.historico_realizado;
            renderizarDestaqueHoje(previsoesAtuais);
            renderizarComparativo(previsoesAtuais, hist.success ? hist.historico : []);
            renderizarPrevisoesGrid(previsoesAtuais, segmentoAtualGrid);
            renderizarGrafico(historicoAtual, previsoesAtuais, segmentoAtualGrafico);
            renderizarHistoricoGridComAcerto(historicoAtual, segmentoAtualGrid);
        }
        if (met.success)   renderizarKPIsMetricas(met);
        if (mod.success)   renderizarInfoTecnica(mod.modelos);

        atualizarTimestamp();
        var ind = document.getElementById('status-indicator');
        if (ind) ind.className = 'status-indicator status-online';
    }).catch(function(err) { console.error('Erro:', err); });
}

// ----- DESTAQUE HOJE -----
function renderizarDestaqueHoje(futuras) {
    if (!futuras || futuras.length === 0) return;

    var hoje = new Date(); hoje.setHours(0, 0, 0, 0);
    var hojeStr = formatarISO(hoje);

    var prevHojeTotal = null, prevHojeUti = null, prevHojeEnf = null;

    futuras.forEach(function(f) {
        if (f.dt_alvo === hojeStr || f.dt_alvo.indexOf(hojeStr) === 0) {
            if (f.segmento === 'total') prevHojeTotal = f;
            if (f.segmento === 'uti') prevHojeUti = f;
            if (f.segmento === 'enfermaria') prevHojeEnf = f;
        }
    });

    if (prevHojeTotal) {
        document.getElementById('hoje-total').textContent = Math.round(prevHojeTotal.valor_previsto);
        document.getElementById('hoje-total-faixa').textContent = Math.round(prevHojeTotal.intervalo_inferior) + ' a ' + Math.round(prevHojeTotal.intervalo_superior);
    }
    if (prevHojeUti) {
        document.getElementById('hoje-uti').textContent = Math.round(prevHojeUti.valor_previsto);
        document.getElementById('hoje-uti-faixa').textContent = Math.round(prevHojeUti.intervalo_inferior) + ' a ' + Math.round(prevHojeUti.intervalo_superior);
    }
    if (prevHojeEnf) {
        document.getElementById('hoje-enf').textContent = Math.round(prevHojeEnf.valor_previsto);
        document.getElementById('hoje-enf-faixa').textContent = Math.round(prevHojeEnf.intervalo_inferior) + ' a ' + Math.round(prevHojeEnf.intervalo_superior);
    }
}

// ----- COMPARATIVO ONTEM/HOJE/AMANHA -----
function renderizarComparativo(futuras, historico) {
    var hoje = new Date(); hoje.setHours(0, 0, 0, 0);
    var ontem = new Date(hoje); ontem.setDate(ontem.getDate() - 1);
    var amanha = new Date(hoje); amanha.setDate(amanha.getDate() + 1);

    var hojeStr = formatarISO(hoje);
    var ontemStr = formatarISO(ontem);
    var amanhaStr = formatarISO(amanha);

    // Ontem (real - total)
    var ontemValor = '--';
    if (historico && historico.length > 0) {
        historico.forEach(function(h) {
            if (h.data === ontemStr || h.data.indexOf(ontemStr) === 0) {
                ontemValor = h.total; // Assumindo que a API retorna 'total'
            }
        });
    }
    document.getElementById('ontem-valor').textContent = ontemValor;

    // Hoje + Amanha (previsto - total)
    var hojeValor = '--', amanhaValor = '--';
    if (futuras && futuras.length > 0) {
        futuras.forEach(function(f) {
            if (f.segmento === 'total') {
                if (f.dt_alvo === hojeStr || f.dt_alvo.indexOf(hojeStr) === 0) hojeValor = Math.round(f.valor_previsto);
                if (f.dt_alvo === amanhaStr || f.dt_alvo.indexOf(amanhaStr) === 0) amanhaValor = Math.round(f.valor_previsto);
            }
        });
    }
    document.getElementById('hoje-valor-pequeno').textContent = hojeValor;
    document.getElementById('amanha-valor').textContent = amanhaValor;
}

// ----- PROXIMOS 7 DIAS -----
function renderizarPrevisoesGrid(futuras, segmento) {
    var grid = document.getElementById('previsoes-grid');
    if (!grid) return;

    var filtradas = futuras.filter(function(f) { return f.segmento === segmento; });

    if (!filtradas || filtradas.length === 0) {
        grid.innerHTML = '<div class="mensagem-vazia"><i class="fas fa-calendar-xmark"></i><p>Sem previsoes disponiveis para ' + segmento + '</p></div>';
        return;
    }

    var dias = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sab'];
    var hoje = new Date(); hoje.setHours(0, 0, 0, 0);
    var amanha = new Date(hoje); amanha.setDate(amanha.getDate() + 1);

    var html = '';
    filtradas.forEach(function(f) {
        var d = new Date(f.dt_alvo + 'T00:00:00');
        var nomeDia = dias[d.getDay()];
        var dataStr = ('0' + d.getDate()).slice(-2) + '/' + ('0' + (d.getMonth() + 1)).slice(-2);
        var classe = (d.getTime() === amanha.getTime()) ? 'previsao-dia amanha' : 'previsao-dia';

        html += '<div class="' + classe + '">';
        html += '  <div class="previsao-dia-data">' + dataStr + '</div>';
        html += '  <div class="previsao-dia-nome">' + nomeDia + '</div>';
        html += '  <div class="previsao-dia-valor">' + Math.round(f.valor_previsto) + '</div>';
        html += '  <div class="previsao-dia-unidade">int.</div>';
        html += '  <div class="previsao-dia-faixa">' + Math.round(f.intervalo_inferior) + ' - ' + Math.round(f.intervalo_superior) + '</div>';
        html += '</div>';
    });
    grid.innerHTML = html;
}

// ----- HISTORICO 14 DIAS COM ACERTO -----
function renderizarHistoricoGridComAcerto(historicoTodos, segmento) {
    var grid = document.getElementById('historico-grid');
    if (!grid) return;

    var historicoApenas = historicoTodos.filter(function(h) { return h.segmento === segmento; }).slice(-14);

    if (!historicoApenas || historicoApenas.length === 0) {
        grid.innerHTML = '<div class="mensagem-vazia"><i class="fas fa-clock"></i><p>Sem historico disponivel para ' + segmento + '</p></div>';
        return;
    }

    var dias = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sab'];
    var html = '';

    historicoApenas.forEach(function(c) {
        if (c.valor_realizado === null) return;

        var d = new Date(c.dt_alvo + 'T00:00:00');
        var nomeDia = dias[d.getDay()];
        var dataStr = ('0' + d.getDate()).slice(-2) + '/' + ('0' + (d.getMonth() + 1)).slice(-2);

        var blocoAcerto = '';
        if (c.valor_previsto !== null && c.erro_percentual !== null) {
            var acerto_pct = Math.max(0, 100 - c.erro_percentual).toFixed(1);
            var status_acerto = 'vermelho';
            if (acerto_pct >= 90) status_acerto = 'verde';
            else if (acerto_pct >= 75) status_acerto = 'amarelo';

            var classeAcerto = 'acerto-' + status_acerto;
            var icone = status_acerto === 'verde' ? 'fa-check-circle' :
                        status_acerto === 'amarelo' ? 'fa-circle-exclamation' : 'fa-triangle-exclamation';

            blocoAcerto =
                '<div class="historico-dia-comparativo">' +
                '  <div class="historico-dia-previsto">Previsto: ' + Math.round(c.valor_previsto) + '</div>' +
                '  <div class="historico-dia-acerto ' + classeAcerto + '">' +
                '    <i class="fas ' + icone + '"></i> ' + acerto_pct + '% acerto' +
                '  </div>' +
                '</div>';
        } else if (c.valor_previsto === null) {
            blocoAcerto = '<div class="historico-dia-comparativo"><div class="historico-dia-semprev">Sem previsao</div></div>';
        }

        html += '<div class="historico-dia">';
        html += '  <div class="historico-dia-data">' + dataStr + '</div>';
        html += '  <div class="historico-dia-nome">' + nomeDia + '</div>';
        html += '  <div class="historico-dia-valor">' + Math.round(c.valor_realizado) + '</div>';
        html += '  <div class="historico-dia-unidade">int.</div>';
        html += blocoAcerto;
        html += '</div>';
    });
    grid.innerHTML = html;
}

// ----- ABA TECNICA: KPIs -----
function renderizarKPIsMetricas(data) {
    if(data.metricas_treino) {
        document.getElementById('kpi-mae-total').textContent = data.metricas_treino.total ? data.metricas_treino.total.mae : '--';
        document.getElementById('kpi-mae-uti').textContent = data.metricas_treino.uti ? data.metricas_treino.uti.mae : '--';
        document.getElementById('kpi-mae-enf').textContent = data.metricas_treino.enfermaria ? data.metricas_treino.enfermaria.mae : '--';
        document.getElementById('kpi-mape-total').textContent = data.metricas_treino.total ? data.metricas_treino.total.mape + '%' : '--';
    }
}

// ----- ABA TECNICA: INFO DETALHADA -----
function renderizarInfoTecnica(modelos) {
    var container = document.getElementById('info-modelo-tecnica');
    if (!container || !modelos) return;

    var html = '<h3><i class="fas fa-circle-info"></i> Detalhes dos Modelos</h3>';

    // Total
    var mt = modelos.total;
    if(mt) {
        html += '<h4>Modelo Total</h4>';
        html += '<div class="info-grid" style="margin-bottom: 20px;">';
        html += '  <div class="info-item"><div class="info-item-label">Nome</div><div class="info-item-valor">' + escapeHtml(mt.nome_modelo) + '</div></div>';
        html += '  <div class="info-item"><div class="info-item-label">Versao</div><div class="info-item-valor">' + escapeHtml(mt.versao) + '</div></div>';
        html += '  <div class="info-item"><div class="info-item-label">Features</div><div class="info-item-valor">' + (mt.num_features || '--') + '</div></div>';
        html += '  <div class="info-item"><div class="info-item-label">RMSE</div><div class="info-item-valor">' + (mt.rmse_teste || '--') + '</div></div>';
        html += '</div>';
    }

    // UTI
    var mu = modelos.uti;
    if(mu) {
        html += '<h4>Modelo UTI</h4>';
        html += '<div class="info-grid" style="margin-bottom: 20px;">';
        html += '  <div class="info-item"><div class="info-item-label">Nome</div><div class="info-item-valor">' + escapeHtml(mu.nome_modelo) + '</div></div>';
        html += '  <div class="info-item"><div class="info-item-label">Versao</div><div class="info-item-valor">' + escapeHtml(mu.versao) + '</div></div>';
        html += '  <div class="info-item"><div class="info-item-label">Features</div><div class="info-item-valor">' + (mu.num_features || '--') + '</div></div>';
        html += '  <div class="info-item"><div class="info-item-label">RMSE</div><div class="info-item-valor">' + (mu.rmse_teste || '--') + '</div></div>';
        html += '</div>';
    }

    // Enfermaria
    var me = modelos.enfermaria;
    if(me) {
        html += '<h4>Modelo Enfermaria</h4>';
        html += '<div class="info-grid">';
        html += '  <div class="info-item"><div class="info-item-label">Nome</div><div class="info-item-valor">' + escapeHtml(me.nome_modelo) + '</div></div>';
        html += '  <div class="info-item"><div class="info-item-label">Versao</div><div class="info-item-valor">' + escapeHtml(me.versao) + '</div></div>';
        html += '  <div class="info-item"><div class="info-item-label">Features</div><div class="info-item-valor">' + (me.num_features || '--') + '</div></div>';
        html += '  <div class="info-item"><div class="info-item-label">RMSE</div><div class="info-item-valor">' + (me.rmse_teste || '--') + '</div></div>';
        html += '</div>';
    }

    container.innerHTML = html;
}

// ----- GRAFICO -----
function renderizarGrafico(historicoTodos, futurasTodas, segmento) {
    var ctx = document.getElementById('grafico-previsao');
    if (!ctx) return;

    var historico = historicoTodos.filter(function(h) { return h.segmento === segmento; });
    var futuras = futurasTodas.filter(function(f) { return f.segmento === segmento; });

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

    var corBase = '#dc3545'; // padrao (total)
    var corFundo = 'rgba(220,53,69,0.1)';
    var corFaixa = 'rgba(220,53,69,0.3)';
    var corFaixaBg = 'rgba(220,53,69,0.08)';

    if (segmento === 'uti') {
        corBase = '#e74c3c';
        corFundo = 'rgba(231,76,60,0.1)';
        corFaixa = 'rgba(231,76,60,0.3)';
        corFaixaBg = 'rgba(231,76,60,0.08)';
    } else if (segmento === 'enfermaria') {
        corBase = '#27ae60';
        corFundo = 'rgba(39,174,96,0.1)';
        corFaixa = 'rgba(39,174,96,0.3)';
        corFaixaBg = 'rgba(39,174,96,0.08)';
    }

    grafico = new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [
                { label: 'Realizado', data: realizadoData, borderColor: '#2c3e50', backgroundColor: 'rgba(44,62,80,0.05)', borderWidth: 2.5, tension: 0.3, pointRadius: 3, spanGaps: false },
                { label: 'Previsto (historico)', data: previstoHistData, borderColor: corBase, borderWidth: 2, borderDash: [4, 4], tension: 0.3, pointRadius: 2, spanGaps: false },
                { label: 'Previsto (futuro)', data: previstoFuturoData, borderColor: corBase, backgroundColor: corFundo, borderWidth: 3, tension: 0.3, pointRadius: 5, pointBackgroundColor: corBase, fill: false, spanGaps: false },
                { label: 'Faixa superior', data: faixaSup, borderColor: corFaixa, borderWidth: 1, pointRadius: 0, fill: '+1', backgroundColor: corFaixaBg, tension: 0.3, spanGaps: false },
                { label: 'Faixa inferior', data: faixaInf, borderColor: corFaixa, borderWidth: 1, pointRadius: 0, tension: 0.3, spanGaps: false }
            ]
        },
        options: {
            responsive: true, maintainAspectRatio: false,
            interaction: { mode: 'index', intersect: false },
            plugins: {
                legend: { position: 'top', labels: { filter: function(item) { return item.text.indexOf('Faixa') === -1; }, font: { size: 11 } } },
                tooltip: {
                    callbacks: {
                        label: function(ctx) {
                            if (ctx.parsed.y === null) return null;
                            return ctx.dataset.label + ': ' + Math.round(ctx.parsed.y) + ' intern.';
                        },
                        afterBody: function(items) {
                            if (items.length < 2) return null;
                            var idx = items[0].dataIndex;
                            var real = realizadoData[idx];
                            var prev = previstoHistData[idx];
                            if (real !== null && prev !== null && real > 0) {
                                var acerto = Math.max(0, Math.min(100, 100 - Math.abs(prev - real) / real * 100));
                                return 'Acerto: ' + acerto.toFixed(1) + '%';
                            }
                            return null;
                        }
                    }
                }
            },
            scales: {
                y: { beginAtZero: true, title: { display: true, text: 'Internacoes/dia' } },
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
