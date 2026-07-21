(function () {
    'use strict';

    var CONFIG = {
        apiBase:         '/api/paineis/painel49',
        refreshInterval: 300000   // 5 min
    };

    var Estado = {
        dtInicio:     '',
        dtFim:        '',
        periodoAtivo: '7d',
        secaoAtiva:   'cc',       // 'cc' | 'hemo'
        modoAtivo:    'resumo',   // 'resumo' | 'detalhe'
        resumo:       [],
        detalhe:      []
    };

    var DOM = {};
    var _refreshTimer = null;

    // ── Inicialização ───────────────────────────────────────────

    function inicializar() {
        DOM.btnsPeriodo     = document.querySelectorAll('.btn-periodo-header');
        DOM.filtroCustom    = document.getElementById('filtro-custom');
        DOM.dtInicio        = document.getElementById('dt-inicio');
        DOM.dtFim           = document.getElementById('dt-fim');
        DOM.btnAplicar      = document.getElementById('btn-aplicar');
        DOM.btnSecao        = document.getElementById('btn-secao');
        DOM.btnSecaoTexto   = document.getElementById('btn-secao-texto');
        DOM.btnModo         = document.getElementById('btn-modo');
        DOM.btnModoTexto    = document.getElementById('btn-modo-texto');
        DOM.btnExportar     = document.getElementById('btn-exportar');
        DOM.btnRefresh      = document.getElementById('btn-refresh');
        DOM.conteudo        = document.getElementById('cirurgias-content');
        DOM.statTotal       = document.getElementById('stat-total');
        DOM.statTempo       = document.getElementById('stat-tempo');
        DOM.statOcioso      = document.getElementById('stat-ocioso');
        DOM.statUtil        = document.getElementById('stat-util');
        DOM.ultimaAtualizacao = document.getElementById('ultima-atualizacao');

        for (var i = 0; i < DOM.btnsPeriodo.length; i++) {
            DOM.btnsPeriodo[i].addEventListener('click', onClickPeriodo);
        }
        DOM.btnAplicar.addEventListener('click', onAplicarCustom);
        DOM.btnSecao.addEventListener('click', alternarSecao);
        DOM.btnModo.addEventListener('click', alternarModo);
        DOM.btnExportar.addEventListener('click', exportarExcel);
        DOM.btnRefresh.addEventListener('click', function () { carregarDados(); });

        aplicarPeriodo('7d');
    }

    // ── Períodos ────────────────────────────────────────────────

    function calcularDatas(periodo) {
        var hoje = new Date();
        var ini;
        if (periodo === '7d')  { ini = new Date(hoje.getTime() - 7  * 86400000); }
        if (periodo === '14d') { ini = new Date(hoje.getTime() - 14 * 86400000); }
        if (periodo === '30d') { ini = new Date(hoje.getTime() - 30 * 86400000); }
        if (periodo === 'mes') { ini = new Date(hoje.getFullYear(), hoje.getMonth(), 1); }
        return { inicio: fmtDate(ini), fim: fmtDate(hoje) };
    }

    function fmtDate(d) {
        var y  = d.getFullYear();
        var m  = ('0' + (d.getMonth() + 1)).slice(-2);
        var dd = ('0' + d.getDate()).slice(-2);
        return y + '-' + m + '-' + dd;
    }

    function fmtDateBR(iso) {
        if (!iso) return '-';
        var p = String(iso).split('T')[0].split('-');
        if (p.length < 3) return iso;
        return p[2] + '/' + p[1] + '/' + p[0];
    }

    function fmtDateTimeBR(iso) {
        if (!iso) return '-';
        var d = new Date(iso);
        if (isNaN(d.getTime())) return '-';
        var dd  = ('0' + d.getDate()).slice(-2);
        var mm  = ('0' + (d.getMonth() + 1)).slice(-2);
        var hh  = ('0' + d.getHours()).slice(-2);
        var min = ('0' + d.getMinutes()).slice(-2);
        return dd + '/' + mm + ' ' + hh + ':' + min;
    }

    function minToHM(min) {
        if (min === null || min === undefined) return '-';
        var v = parseFloat(min);
        if (isNaN(v) || v < 0) return '-';
        if (v === 0) return '0min';
        var h = Math.floor(v / 60);
        var m = Math.round(v % 60);
        if (h === 0) return m + 'min';
        return h + 'h' + (m > 0 ? ('0' + m).slice(-2) + 'min' : '');
    }

    function calcUtil(sala, ocio) {
        var s = parseFloat(sala) || 0;
        var o = parseFloat(ocio) || 0;
        var t = s + o;
        if (t <= 0) return 0;
        return Math.round((s / t) * 100);
    }

    function badgeUtil(pct) {
        var cls = pct >= 80 ? 'badge-util-alto' : pct >= 50 ? 'badge-util-medio' : 'badge-util-baixo';
        return '<span class="badge-util ' + cls + '">' + pct + '%</span>';
    }

    function aplicarPeriodo(periodo) {
        Estado.periodoAtivo = periodo;

        for (var i = 0; i < DOM.btnsPeriodo.length; i++) {
            DOM.btnsPeriodo[i].classList.toggle('ativo',
                DOM.btnsPeriodo[i].getAttribute('data-periodo') === periodo);
        }

        if (periodo === 'custom') {
            DOM.filtroCustom.classList.remove('oculto');
            return;
        }

        DOM.filtroCustom.classList.add('oculto');
        var datas = calcularDatas(periodo);
        Estado.dtInicio = datas.inicio;
        Estado.dtFim    = datas.fim;
        carregarDados();
    }

    function onClickPeriodo(e) {
        aplicarPeriodo(e.currentTarget.getAttribute('data-periodo'));
    }

    function onAplicarCustom() {
        var ini = DOM.dtInicio.value;
        var fim = DOM.dtFim.value;
        if (!ini || !fim)  { alert('Selecione as duas datas.'); return; }
        if (ini > fim)     { alert('Data inicial não pode ser maior que a final.'); return; }
        Estado.dtInicio = ini;
        Estado.dtFim    = fim;
        DOM.filtroCustom.classList.add('oculto');
        carregarDados();
    }

    // ── Alternar Seção / Modo ───────────────────────────────────

    function alternarSecao() {
        if (Estado.secaoAtiva === 'cc') {
            Estado.secaoAtiva = 'hemo';
            DOM.btnSecaoTexto.textContent = 'Hemo';
            DOM.btnSecao.classList.add('hemo-ativo');
        } else {
            Estado.secaoAtiva = 'cc';
            DOM.btnSecaoTexto.textContent = 'CC';
            DOM.btnSecao.classList.remove('hemo-ativo');
        }
        renderizar();
    }

    function alternarModo() {
        if (Estado.modoAtivo === 'resumo') {
            Estado.modoAtivo = 'detalhe';
            DOM.btnModoTexto.textContent = 'Detalhe';
            DOM.btnModo.classList.add('detalhe-ativo');
            if (Estado.detalhe.length === 0) {
                carregarDetalhe();
            } else {
                renderizarDetalhe();
            }
        } else {
            Estado.modoAtivo = 'resumo';
            DOM.btnModoTexto.textContent = 'Resumo';
            DOM.btnModo.classList.remove('detalhe-ativo');
            renderizarResumo();
        }
    }

    // ── Carregamento ────────────────────────────────────────────

    function carregarDados() {
        Estado.resumo  = [];
        Estado.detalhe = [];
        mostrarLoading();

        var url = CONFIG.apiBase + '/resumo?dt_inicio=' + Estado.dtInicio + '&dt_fim=' + Estado.dtFim;
        fetch(url, { credentials: 'same-origin' })
            .then(function (r) { return r.json(); })
            .then(function (data) {
                if (!data.success) { mostrarErro('Erro ao carregar resumo.'); return; }
                Estado.resumo = data.dados;
                atualizarMiniDashboard(data.dados);
                if (Estado.modoAtivo === 'resumo') {
                    renderizarResumo();
                } else {
                    carregarDetalhe();
                }
                atualizarTimestamp();
            })
            .catch(function (err) {
                console.error('Erro resumo:', err);
                mostrarErro('Erro de conexão.');
            });

        agendarRefresh();
    }

    function carregarDetalhe() {
        mostrarLoading();
        var url = CONFIG.apiBase + '/detalhe?dt_inicio=' + Estado.dtInicio +
                  '&dt_fim=' + Estado.dtFim + '&tipo=' + Estado.secaoAtiva;
        fetch(url, { credentials: 'same-origin' })
            .then(function (r) { return r.json(); })
            .then(function (data) {
                if (!data.success) { mostrarErro('Erro ao carregar detalhe.'); return; }
                Estado.detalhe = data.dados;
                renderizarDetalhe();
            })
            .catch(function (err) {
                console.error('Erro detalhe:', err);
                mostrarErro('Erro de conexão.');
            });
    }

    function agendarRefresh() {
        if (_refreshTimer) clearTimeout(_refreshTimer);
        _refreshTimer = setTimeout(function () { carregarDados(); }, CONFIG.refreshInterval);
    }

    // ── Mini Dashboard ──────────────────────────────────────────

    function atualizarMiniDashboard(dados) {
        var total     = 0;
        var totSala   = 0;
        var totOcio   = 0;

        for (var i = 0; i < dados.length; i++) {
            total   += parseInt(dados[i].total_cirurgias)        || 0;
            totSala += parseFloat(dados[i].total_sala_min)       || 0;
            totOcio += parseFloat(dados[i].total_ociosidade_min) || 0;
        }

        var pct = calcUtil(totSala, totOcio);

        DOM.statTotal.textContent  = total;
        DOM.statTempo.textContent  = minToHM(totSala);
        DOM.statOcioso.textContent = minToHM(totOcio);
        DOM.statUtil.textContent   = pct + '%';
    }

    // ── Renderização — Resumo ───────────────────────────────────

    function renderizar() {
        if (Estado.modoAtivo === 'resumo') {
            renderizarResumo();
        } else {
            if (Estado.detalhe.length > 0) {
                renderizarDetalhe();
            } else {
                carregarDetalhe();
            }
        }
    }

    function renderizarResumo() {
        var ehCC   = Estado.secaoAtiva === 'cc';
        var salas  = Estado.resumo.filter(function (r) {
            return ehCC ? r.tipo_sala !== 'hemo' : r.tipo_sala === 'hemo';
        });

        var titulo = ehCC ? 'Centro Cirúrgico' : 'Hemodinâmica';
        var icone  = ehCC ? 'fa-hospital'      : 'fa-heartbeat';
        var hdrCls = ehCC ? 'cc-header'        : 'hemo-header';

        if (salas.length === 0) {
            DOM.conteudo.innerHTML =
                '<div class="grupo-secao">' +
                '<div class="grupo-secao-header ' + hdrCls + '">' +
                '<i class="fas ' + icone + '"></i> ' + escHtml(titulo) +
                '</div>' +
                '<div class="empty-message">' +
                '<i class="fas fa-calendar-times"></i>' +
                '<h3>Nenhuma cirurgia concluída</h3>' +
                '<p>Nenhum dado no período selecionado para este setor.</p>' +
                '</div></div>';
            return;
        }

        // Totais da seção
        var totCir  = 0;
        var totSala = 0;
        var totOcio = 0;
        for (var k = 0; k < salas.length; k++) {
            totCir  += parseInt(salas[k].total_cirurgias)        || 0;
            totSala += parseFloat(salas[k].total_sala_min)       || 0;
            totOcio += parseFloat(salas[k].total_ociosidade_min) || 0;
        }

        var html = '';
        html += '<div class="grupo-secao modo-resumo">';
        html += '<div class="grupo-secao-header ' + hdrCls + '">';
        html += '<i class="fas ' + escHtml(icone) + '"></i> ' + escHtml(titulo);
        html += '<span class="grupo-secao-badge">' + salas.length + ' sala' + (salas.length > 1 ? 's' : '') + '</span>';
        html += '</div>';

        html += '<div class="cirurgias-table-wrapper">';
        html += '<table class="cirurgias-table">';
        html += '<thead><tr>';
        html += '<th>Sala</th>';
        html += '<th>Cirurgias</th>';
        html += '<th><i class="fas fa-door-open"></i> T. Sala</th>';
        html += '<th><i class="fas fa-divide"></i> Média/Cir.</th>';
        html += '<th><i class="fas fa-heartbeat"></i> T. Cirurgia</th>';
        html += '<th><i class="fas fa-hourglass-half"></i> Ociosidade 24h</th>';
        html += '<th>Utilização</th>';
        html += '<th>Dias</th>';
        html += '</tr></thead>';
        html += '<tbody>';

        for (var i = 0; i < salas.length; i++) {
            var s   = salas[i];
            var pct = parseFloat(s.pct_utilizacao) || 0;
            html += '<tr>';
            html += '<td><span class="badge-sala' + (s.tipo_sala === 'hemo' ? ' badge-sala-hemo' : '') + '">' + escHtml(s.ds_agenda) + '</span></td>';
            html += '<td><span class="num-cirurgias">' + escHtml(String(s.total_cirurgias)) + '</span></td>';
            html += '<td><span class="tempo-cirurgia tempo-sala-valor"><i class="fas fa-clock"></i>' + minToHM(s.total_sala_min) + '</span></td>';
            html += '<td><span class="tempo-cirurgia">' + minToHM(s.avg_sala_min) + '</span></td>';
            html += '<td><span class="tempo-cirurgia tempo-cir-valor"><i class="fas fa-heartbeat"></i>' + minToHM(s.total_real_min) + '</span></td>';
            html += '<td><span class="' + (parseFloat(s.total_ociosidade_min) > 0 ? 'ocio-valor' : 'ocio-zero') + '">' + minToHM(s.total_ociosidade_min) + '</span></td>';
            html += '<td>' + badgeUtil(pct) + '</td>';
            html += '<td>' + escHtml(String(s.dias_com_cirurgia)) + '</td>';
            html += '</tr>';
        }

        // Linha de total
        var pctTotal = calcUtil(totSala, totOcio);
        html += '<tr class="tr-total">';
        html += '<td>TOTAL</td>';
        html += '<td><span class="num-cirurgias">' + totCir + '</span></td>';
        html += '<td><span class="tempo-cirurgia tempo-sala-valor"><i class="fas fa-clock"></i>' + minToHM(totSala) + '</span></td>';
        html += '<td>-</td>';
        html += '<td>-</td>';
        html += '<td><span class="' + (totOcio > 0 ? 'ocio-valor' : 'ocio-zero') + '">' + minToHM(totOcio) + '</span></td>';
        html += '<td>' + badgeUtil(pctTotal) + '</td>';
        html += '<td>-</td>';
        html += '</tr>';

        html += '</tbody></table></div></div>';
        DOM.conteudo.innerHTML = html;
        ajustarAlturaTbody();
    }

    // ── Renderização — Detalhe ──────────────────────────────────

    function renderizarDetalhe() {
        var ehCC   = Estado.secaoAtiva === 'cc';
        var titulo = ehCC ? 'Centro Cirúrgico' : 'Hemodinâmica';
        var icone  = ehCC ? 'fa-hospital'      : 'fa-heartbeat';
        var hdrCls = ehCC ? 'cc-header'        : 'hemo-header';

        var lista = Estado.detalhe.filter(function (r) {
            return ehCC ? r.tipo_sala !== 'hemo' : r.tipo_sala === 'hemo';
        });

        var html = '';
        html += '<div class="grupo-secao modo-detalhe">';
        html += '<div class="grupo-secao-header ' + hdrCls + '">';
        html += '<i class="fas ' + escHtml(icone) + '"></i> ' + escHtml(titulo) + ' — Detalhe';
        html += '<span class="grupo-secao-badge">' + lista.length + ' registro' + (lista.length !== 1 ? 's' : '') + '</span>';
        html += '</div>';

        if (lista.length === 0) {
            html += '<div class="empty-message"><i class="fas fa-calendar-times"></i>';
            html += '<h3>Nenhuma cirurgia</h3><p>Nenhum registro no período para este setor.</p></div>';
        } else {
            html += '<div class="cirurgias-table-wrapper">';
            html += '<table class="cirurgias-table">';
            html += '<thead><tr>';
            html += '<th>Status</th>';
            html += '<th>Data</th>';
            html += '<th>Hr.Prev.</th>';
            html += '<th>Entrada CC</th>';
            html += '<th>T. Sala</th>';
            html += '<th>T. Cir.</th>';
            html += '<th title="Tempo de sala parada antes desta cirurgia">Espera ant.</th>';
            html += '<th>Sala</th>';
            html += '<th>Paciente</th>';
            html += '<th>Médico</th>';
            html += '<th>Procedimento</th>';
            html += '</tr></thead><tbody>';

            for (var i = 0; i < lista.length; i++) {
                var r = lista[i];
                html += '<tr>';
                html += '<td>' + renderizarStatusIcon(r.status_calculado) + '</td>';
                html += '<td><span class="previsao-hora">' + escHtml(fmtDateBR(r.dt_agenda)) + '</span></td>';
                html += '<td><span class="previsao-hora">' + escHtml(r.hr_inicio || '-') + '</span></td>';
                html += '<td><span class="inicio-cirurgia">' + fmtDateTimeBR(r.dt_entrada_cc) + '</span></td>';
                html += '<td><span class="tempo-cirurgia tempo-sala-valor"><i class="fas fa-clock"></i>' + minToHM(r.duracao_sala_min) + '</span></td>';
                html += '<td><span class="tempo-cirurgia tempo-cir-valor"><i class="fas fa-heartbeat"></i>' + minToHM(r.duracao_real_min) + '</span></td>';
                html += '<td><span class="' + (parseFloat(r.ociosidade_antes_min) > 0 ? 'ocio-valor' : 'ocio-zero') + '"><i class="fas fa-hourglass-half"></i> ' + minToHM(r.ociosidade_antes_min) + '</span></td>';
                html += '<td><span class="badge-sala' + (r.tipo_sala === 'hemo' ? ' badge-sala-hemo' : '') + '">' + escHtml(r.ds_agenda || '-') + '</span></td>';
                html += '<td>' +
                    '<span class="paciente-nome">' + escHtml(r.nm_paciente_pf || '-') + '</span>' +
                    (r.ds_convenio ? '<span class="paciente-info">' + escHtml(r.ds_convenio) + '</span>' : '') +
                    '</td>';
                html += '<td><span class="medico-nome">' + escHtml(r.nm_medico || '-') + '</span></td>';
                html += '<td><span class="cirurgia-desc">' + escHtml(r.ds_proc_cir || '-') + '</span></td>';
                html += '</tr>';
            }

            html += '</tbody></table></div>';
        }

        html += '</div>';
        DOM.conteudo.innerHTML = html;
        ajustarAlturaTbody();
    }

    function renderizarStatusIcon(status) {
        var cls, icone, texto;
        if (status === 'concluida') {
            cls = 'status-concluida'; icone = 'fa-check-circle'; texto = 'Realizada';
        } else if (status === 'em_andamento') {
            cls = 'status-em-andamento'; icone = 'fa-heartbeat'; texto = 'Em andamento';
        } else {
            cls = 'status-prevista'; icone = 'fa-clock'; texto = 'Prevista';
        }
        return '<div class="status-container">' +
            '<span class="status-icon ' + cls + '"><i class="fas ' + icone + '"></i></span>' +
            '<span class="status-texto">' + texto + '</span>' +
            '</div>';
    }

    // ── Ajuste dinâmico da altura do tbody ───────────────────────

    function ajustarAlturaTbody() {
        var tbodies = DOM.conteudo.querySelectorAll('.cirurgias-table tbody');
        for (var i = 0; i < tbodies.length; i++) {
            var wrapper = tbodies[i].closest('.cirurgias-table-wrapper');
            if (!wrapper) continue;
            var thead   = wrapper.querySelector('thead');
            var theadH  = thead ? thead.offsetHeight : 0;
            var wrapperH = wrapper.offsetHeight;
            tbodies[i].style.height = (wrapperH - theadH) + 'px';
        }
    }

    // ── Auxiliares ──────────────────────────────────────────────

    function mostrarLoading() {
        DOM.conteudo.innerHTML =
            '<div class="loading-container">' +
            '<div class="loading-spinner"></div>' +
            '<p>Carregando dados...</p>' +
            '</div>';
    }

    function mostrarErro(msg) {
        DOM.conteudo.innerHTML =
            '<div class="empty-message">' +
            '<i class="fas fa-exclamation-triangle"></i>' +
            '<h3>Erro</h3><p>' + escHtml(msg) + '</p>' +
            '</div>';
    }

    function atualizarTimestamp() {
        var agora = new Date();
        var hh  = ('0' + agora.getHours()).slice(-2);
        var min = ('0' + agora.getMinutes()).slice(-2);
        DOM.ultimaAtualizacao.textContent = 'Atualizado ' + hh + ':' + min;
    }

    function escHtml(str) {
        if (str === null || str === undefined) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    // ── Exportação Excel (SheetJS) ──────────────────────────────

    function exportarExcel() {
        if (typeof XLSX === 'undefined') {
            alert('SheetJS não carregado. Verifique a conexão.');
            return;
        }
        if (Estado.resumo.length === 0) {
            alert('Carregue os dados antes de exportar.');
            return;
        }

        var wb  = XLSX.utils.book_new();
        var cc  = Estado.resumo.filter(function (r) { return r.tipo_sala !== 'hemo'; });
        var hemo = Estado.resumo.filter(function (r) { return r.tipo_sala === 'hemo'; });

        adicionarAbaResumo(wb, 'Resumo CC',   cc);
        adicionarAbaResumo(wb, 'Resumo Hemo', hemo);

        if (Estado.detalhe.length > 0) {
            var dCC  = Estado.detalhe.filter(function (r) { return r.tipo_sala !== 'hemo'; });
            var dHemo = Estado.detalhe.filter(function (r) { return r.tipo_sala === 'hemo'; });
            adicionarAbaDetalhe(wb, 'Detalhe CC',   dCC);
            adicionarAbaDetalhe(wb, 'Detalhe Hemo', dHemo);
        }

        var nomeArq = 'Salas_Cirurgicas_' + Estado.dtInicio + '_a_' + Estado.dtFim + '.xlsx';
        XLSX.writeFile(wb, nomeArq);
    }

    function adicionarAbaResumo(wb, nome, dados) {
        var rows = [['Sala', 'Cirurgias', 'T.Sala (min)', 'Média/Cir. (min)',
                     'T.Cirurgia (min)', 'Ociosidade 24h (min)', 'Utilização %', 'Dias c/ cirurgia']];
        for (var i = 0; i < dados.length; i++) {
            var s = dados[i];
            rows.push([
                s.ds_agenda,
                parseInt(s.total_cirurgias)       || 0,
                parseFloat(s.total_sala_min)       || 0,
                parseFloat(s.avg_sala_min)         || 0,
                parseFloat(s.total_real_min)       || 0,
                parseFloat(s.total_ociosidade_min) || 0,
                calcUtil(s.total_sala_min, s.total_ociosidade_min),
                parseInt(s.dias_com_cirurgia)      || 0
            ]);
        }
        var ws = XLSX.utils.aoa_to_sheet(rows);
        ws['!cols'] = [{wch:28},{wch:10},{wch:14},{wch:14},{wch:14},{wch:14},{wch:12},{wch:16}];
        XLSX.utils.book_append_sheet(wb, ws, nome);
    }

    function adicionarAbaDetalhe(wb, nome, dados) {
        var rows = [['Data', 'Sala', 'Ordem', 'Hr.Previsto',
                     'Entrada CC', 'Fim Cirurgia',
                     'T.Sala (min)', 'T.Cirurgia (min)', 'Espera ant. (min)',
                     'Status', 'Paciente', 'Médico', 'Procedimento', 'Convênio']];
        for (var i = 0; i < dados.length; i++) {
            var r = dados[i];
            rows.push([
                r.dt_agenda ? String(r.dt_agenda).split('T')[0] : '',
                r.ds_agenda    || '',
                r.ordem_na_sala || '',
                r.hr_inicio    || '',
                r.dt_entrada_cc   ? String(r.dt_entrada_cc).replace('T',' ').slice(0,16)   : '',
                r.dt_fim_cirurgia ? String(r.dt_fim_cirurgia).replace('T',' ').slice(0,16) : '',
                parseFloat(r.duracao_sala_min)      || '',
                parseFloat(r.duracao_real_min)      || '',
                parseFloat(r.ociosidade_antes_min)  || '',
                r.status_calculado || '',
                r.nm_paciente_pf   || '',
                r.nm_medico        || '',
                r.ds_proc_cir      || '',
                r.ds_convenio      || ''
            ]);
        }
        var ws = XLSX.utils.aoa_to_sheet(rows);
        ws['!cols'] = [
            {wch:12},{wch:26},{wch:6},{wch:10},
            {wch:16},{wch:16},{wch:12},{wch:14},{wch:14},
            {wch:14},{wch:30},{wch:28},{wch:40},{wch:22}
        ];
        XLSX.utils.book_append_sheet(wb, ws, nome);
    }

    window.addEventListener('DOMContentLoaded', inicializar);
    window.addEventListener('resize', function () { ajustarAlturaTbody(); });
})();
