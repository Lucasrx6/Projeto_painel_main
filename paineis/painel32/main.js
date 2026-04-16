/* ============================================================
   Painel 32 - Analise Diaria Sentir e Agir com IA
   Hospital Anchieta Ceilandia

   Duas views:
     - Agenda: lista de dias analisados
     - Detalhe: analitico completo de um dia
   ============================================================ */

(function () {
    'use strict';

    var BASE = '/api/paineis/painel32';

    var estado = {
        viewAtual: 'agenda',      // 'agenda' | 'detalhe'
        dataDetalhe: null,        // YYYY-MM-DD da view detalhe
        dadosDetalhe: null,       // dados das visitas carregados
        analiseDetalhe: null      // analise IA do dia
    };

    // ----------------------------------------------------------
    // UTILITARIOS
    // ----------------------------------------------------------

    function esc(str) {
        if (!str) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    function formatarData(str) {
        if (!str) return '--';
        var p = str.split('-');
        return p.length === 3 ? p[2] + '/' + p[1] + '/' + p[0] : str;
    }

    function formatarMarkdown(texto) {
        return texto
            .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
            .replace(/\*(.+?)\*/g, '<em>$1</em>');
    }

    function toast(msg, tipo) {
        var c = document.getElementById('toast-container');
        if (!c) return;
        var t = document.createElement('div');
        var icon = tipo === 'success' ? 'check-circle' : tipo === 'error' ? 'times-circle' : 'info-circle';
        t.className = 'toast toast-' + (tipo || 'info');
        t.innerHTML = '<i class="fas fa-' + icon + '"></i> ' + esc(msg);
        c.appendChild(t);
        setTimeout(function () { if (t.parentNode) t.parentNode.removeChild(t); }, 4000);
    }

    function setLoading(containerId, show, msg) {
        var el = document.getElementById(containerId);
        if (!el) return;
        el.style.display = show ? 'flex' : 'none';
        if (msg) {
            var p = el.querySelector('p');
            if (p) p.textContent = msg;
        }
    }

    function atualizarTimestamp() {
        var ua = document.getElementById('ultima-atualizacao');
        var now = new Date();
        if (ua) ua.textContent = now.getHours().toString().padStart(2, '0') + ':' +
                                  now.getMinutes().toString().padStart(2, '0');
    }

    function nivelSetor(s) {
        if (s.criticos > 0) return 'critico';
        if (s.atencao > 0) return 'atencao';
        return 'adequado';
    }

    function nivelVisita(av) {
        if (av === 'critico') return 'critico';
        if (av === 'atencao') return 'atencao';
        return 'adequado';
    }

    function _diaSemanaFromData(dataStr) {
        var dias = ['Domingo', 'Segunda', 'Terca', 'Quarta', 'Quinta', 'Sexta', 'Sabado'];
        var p = dataStr.split('-');
        if (p.length !== 3) return '';
        var dt = new Date(parseInt(p[0]), parseInt(p[1]) - 1, parseInt(p[2]));
        return dias[dt.getDay()] || '';
    }

    // ----------------------------------------------------------
    // NAVEGACAO ENTRE VIEWS
    // ----------------------------------------------------------

    function mostrarView(view) {
        document.getElementById('view-agenda').style.display = view === 'agenda' ? '' : 'none';
        document.getElementById('view-detalhe').style.display = view === 'detalhe' ? '' : 'none';
        document.getElementById('header-agenda-btns').style.display = view === 'agenda' ? '' : 'none';
        document.getElementById('header-detalhe-btns').style.display = view === 'detalhe' ? '' : 'none';
        estado.viewAtual = view;
        window.scrollTo(0, 0);
    }

    // ----------------------------------------------------------
    // VIEW AGENDA
    // ----------------------------------------------------------

    function carregarAgenda() {
        setLoading('loading-agenda', true);
        document.getElementById('agenda-lista').style.display = 'none';
        document.getElementById('agenda-vazia').style.display = 'none';

        fetch(BASE + '/historico?limite=60')
            .then(function (r) { return r.json(); })
            .then(function (res) {
                setLoading('loading-agenda', false);
                if (!res.success) {
                    toast('Erro ao carregar historico: ' + res.error, 'error');
                    return;
                }
                var dias = res.data;
                if (!dias || dias.length === 0) {
                    document.getElementById('agenda-vazia').style.display = '';
                    return;
                }
                renderizarAgenda(dias);
                atualizarTimestamp();
            })
            .catch(function (e) {
                setLoading('loading-agenda', false);
                toast('Erro de conexao: ' + e.message, 'error');
            });
    }

    function renderizarAgenda(dias) {
        var grid = document.getElementById('agenda-grid');
        var info = document.getElementById('agenda-total-info');
        if (!grid) return;

        if (info) info.textContent = dias.length + ' dia(s) com analise registrada';

        var html = '';
        dias.forEach(function (d) {
            var nivel = d.total_criticos > 0 ? 'critico' : d.total_atencao > 0 ? 'atencao' : 'adequado';
            var partes = d.data ? d.data.split('-') : [];
            var dia  = partes[2] || '--';
            var mes  = partes[1] ? _nomeMes(parseInt(partes[1])) : '--';
            var semana = d.data ? _diaSemanaFromData(d.data) : '';
            var resumoLimpo = (d.sintese || '').replace(/\*\*/g, '').replace(/\*/g, '').trim();
            var fonteClasse = d.gerado_por === 'worker' ? 'fonte-worker' : 'fonte-manual';
            var fonteLabel  = d.gerado_por === 'worker' ? 'Auto' : 'Manual';

            html += '<div class="agenda-card nivel-' + nivel + '" onclick="Painel32.abrirDetalhe(\'' + esc(d.data) + '\')">';

            // Coluna data
            html += '<div class="agenda-card-data">';
            html += '<span class="agenda-data-dia">' + esc(dia) + '</span>';
            html += '<span class="agenda-data-mes">' + esc(mes) + '</span>';
            if (semana) html += '<span class="agenda-data-semana">' + esc(semana) + '</span>';
            html += '</div>';

            // Coluna body
            html += '<div class="agenda-card-body">';
            html += '<div class="agenda-kpis">';
            html += '<span class="agenda-kpi akpi-total"><i class="fas fa-clipboard-list"></i> ' + (d.total_visitas || 0) + ' visitas</span>';
            if (d.total_criticos > 0)
                html += '<span class="agenda-kpi akpi-critico"><i class="fas fa-exclamation-circle"></i> ' + d.total_criticos + ' critico(s)</span>';
            if (d.total_atencao > 0)
                html += '<span class="agenda-kpi akpi-atencao"><i class="fas fa-exclamation-triangle"></i> ' + d.total_atencao + ' atencao</span>';
            html += '<span class="agenda-kpi akpi-setor"><i class="fas fa-hospital"></i> ' + (d.total_setores || 0) + ' setor(es)</span>';
            html += '</div>';
            if (resumoLimpo) {
                html += '<div class="agenda-resumo">' + esc(resumoLimpo) + '</div>';
            }
            html += '</div>';

            // Coluna direita
            html += '<div class="agenda-card-right">';
            html += '<span class="agenda-badge-fonte ' + fonteClasse + '">' + fonteLabel + '</span>';
            html += '<i class="fas fa-chevron-right agenda-chevron"></i>';
            html += '</div>';

            html += '</div>';
        });

        grid.innerHTML = html;
        document.getElementById('agenda-lista').style.display = '';
    }

    function _nomeMes(n) {
        var meses = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];
        return meses[n - 1] || '--';
    }

    // ----------------------------------------------------------
    // VIEW DETALHE
    // ----------------------------------------------------------

    function abrirDetalhe(dataStr) {
        estado.dataDetalhe = dataStr;
        estado.dadosDetalhe = null;
        estado.analiseDetalhe = null;

        // Resetar UI
        document.getElementById('analise-ia-container').style.display = 'none';
        document.getElementById('setores-grid').innerHTML = '';
        document.getElementById('detalhe-sem-visitas').style.display = 'none';
        setLoading('loading-detalhe', false);

        // Atualizar titulo
        document.getElementById('detalhe-data-badge').textContent = formatarData(dataStr);
        document.getElementById('detalhe-dia-semana').textContent = '';
        document.getElementById('detalhe-gerado-por').innerHTML = '';

        // Desabilitar botoes ate carregar
        var btnRegen = document.getElementById('btn-regenerar-analise');
        var btnCSV   = document.getElementById('btn-exportar-csv');
        var btnPDF   = document.getElementById('btn-exportar-pdf');
        if (btnRegen) btnRegen.disabled = true;
        if (btnCSV)   btnCSV.disabled = true;
        if (btnPDF)   btnPDF.disabled = true;

        mostrarView('detalhe');
        setLoading('loading-detalhe', true, 'Carregando dados de ' + formatarData(dataStr) + '...');

        // Carregar visitas e analise em paralelo
        Promise.all([
            fetch(BASE + '/dados?data=' + encodeURIComponent(dataStr)).then(function (r) { return r.json(); }),
            fetch(BASE + '/analise-salva?data=' + encodeURIComponent(dataStr)).then(function (r) { return r.json(); })
        ])
            .then(function (results) {
                setLoading('loading-detalhe', false);
                var resDados   = results[0];
                var resAnalise = results[1];

                if (!resDados.success) {
                    toast('Erro ao carregar dados: ' + resDados.error, 'error');
                    return;
                }

                var dados = resDados.data;
                estado.dadosDetalhe = dados;

                // KPIs
                _atualizarKpisDetalhe(dados);

                // Habilitar botoes
                if (btnRegen) btnRegen.disabled = false;
                if (btnCSV)   btnCSV.disabled = false;
                if (btnPDF)   btnPDF.disabled = false;

                // Setores
                if (dados.total === 0) {
                    document.getElementById('detalhe-sem-visitas').style.display = '';
                } else {
                    _renderizarSetores(dados);
                }

                // Analise salva
                if (resAnalise.success && resAnalise.data) {
                    estado.analiseDetalhe = resAnalise.data;
                    _exibirAnalise(resAnalise.data);
                    _atualizarInfoGerado(resAnalise.data);
                }

                atualizarTimestamp();
            })
            .catch(function (e) {
                setLoading('loading-detalhe', false);
                toast('Erro: ' + e.message, 'error');
            });
    }

    function _atualizarKpisDetalhe(dados) {
        document.getElementById('d-stat-total').textContent    = dados.total || 0;
        document.getElementById('d-stat-criticos').textContent = dados.criticos || 0;
        document.getElementById('d-stat-atencao').textContent  = dados.atencao || 0;
        document.getElementById('d-stat-adequados').textContent = dados.adequados || 0;
        document.getElementById('d-stat-setores').textContent  = dados.total_setores || 0;
    }

    function _atualizarInfoGerado(analiseData) {
        var el = document.getElementById('detalhe-gerado-por');
        if (!el) return;
        var por = analiseData.gerado_por === 'worker' ? 'Worker automatico' : 'Gerado manualmente';
        var quando = '';
        if (analiseData.gerado_em) {
            var dt = new Date(analiseData.gerado_em);
            quando = dt.toLocaleDateString('pt-BR') + ' as ' +
                dt.getHours().toString().padStart(2, '0') + ':' +
                dt.getMinutes().toString().padStart(2, '0');
        }
        el.innerHTML = '<i class="fas fa-' + (analiseData.gerado_por === 'worker' ? 'robot' : 'user') + '"></i> '
            + esc(por) + (quando ? ' &mdash; ' + esc(quando) : '');
    }

    function _exibirAnalise(analiseData) {
        var container = document.getElementById('analise-ia-container');
        var body      = document.getElementById('analise-ia-body');
        var meta      = document.getElementById('analise-meta');
        if (!container || !body) return;

        body.innerHTML = '<div class="sugestao-content">' + formatarMarkdown(esc(analiseData.analise_texto)) + '</div>';

        if (meta) {
            var por = analiseData.gerado_por === 'worker' ? 'Worker automatico' : 'Gerado manualmente';
            var quando = '';
            if (analiseData.gerado_em) {
                var dt = new Date(analiseData.gerado_em);
                quando = dt.toLocaleDateString('pt-BR') + ' as ' +
                    dt.getHours().toString().padStart(2, '0') + ':' +
                    dt.getMinutes().toString().padStart(2, '0');
            }
            meta.innerHTML = '<i class="fas fa-' + (analiseData.gerado_por === 'worker' ? 'robot' : 'user') + '"></i> '
                + esc(por) + (quando ? ' &mdash; ' + esc(quando) : '')
                + ' &nbsp;|&nbsp; <i class="fas fa-microchip"></i> ' + esc(analiseData.modelo || GROQ_MODEL || '');
        }
        container.style.display = '';
    }

    // ----------------------------------------------------------
    // RENDERIZAR SETORES + VISITAS
    // ----------------------------------------------------------

    function _renderizarSetores(dados) {
        var container = document.getElementById('setores-grid');
        if (!container) return;
        var html = '';
        dados.setores.forEach(function (s, idx) {
            s.visitas.forEach(function (v) { v._setor_nome = s.setor_nome; });
            html += _renderSetor(s, idx);
        });
        container.innerHTML = html;

        // Abrir setores criticos automaticamente
        dados.setores.forEach(function (s, idx) {
            if (nivelSetor(s) === 'critico') {
                var card = document.getElementById('sc-' + idx);
                if (card) card.classList.add('aberto');
            }
        });
    }

    function _renderSetor(s, idx) {
        var nivel = nivelSetor(s);
        var badgeLbl = nivel === 'critico' ? 'Critico' : nivel === 'atencao' ? 'Atencao' : 'Adequado';
        var html = '<div class="setor-card nivel-' + nivel + '" id="sc-' + idx + '">';
        html += '<div class="setor-card-header" onclick="Painel32.toggleSetor(' + idx + ')">';
        html += '<div class="setor-nome"><i class="fas fa-hospital"></i>' + esc(s.setor_nome);
        html += '<span class="setor-nivel-badge badge-' + nivel + '">' + badgeLbl + '</span></div>';
        html += '<div class="setor-kpis">';
        html += '<div class="setor-kpi"><span class="setor-kpi-num kpi-total">' + s.total + '</span><span class="setor-kpi-label">Visitas</span></div>';
        if (s.criticos > 0) html += '<div class="setor-kpi"><span class="setor-kpi-num kpi-critico">' + s.criticos + '</span><span class="setor-kpi-label">Crit.</span></div>';
        if (s.atencao > 0)  html += '<div class="setor-kpi"><span class="setor-kpi-num kpi-atencao">' + s.atencao + '</span><span class="setor-kpi-label">Aten.</span></div>';
        html += '<div class="setor-kpi"><span class="setor-kpi-num kpi-adequado">' + s.adequados + '</span><span class="setor-kpi-label">Adeq.</span></div>';
        html += '</div>';
        html += '<i class="fas fa-chevron-down setor-toggle-icon"></i>';
        html += '</div>';

        // Body: lista de pacientes (dois niveis)
        html += '<div class="setor-card-body">';
        s.visitas.forEach(function (v, pacIdx) {
            html += _renderPacienteRow(v, idx, pacIdx);
        });
        html += '</div></div>';
        return html;
    }

    function _renderPacienteRow(v, setorIdx, pacIdx) {
        var nivel = nivelVisita(v.avaliacao_final);
        var id = 'pac-' + setorIdx + '-' + pacIdx;
        var temProblemas = v.itens_problema && v.itens_problema.length > 0;

        var html = '<div class="paciente-row nivel-' + nivel + '" id="' + id + '">';

        // Cabecalho minimizado
        html += '<div class="paciente-row-header" onclick="Painel32.togglePaciente(' + setorIdx + ',' + pacIdx + ')">';
        html += '<span class="paciente-leito"><i class="fas fa-bed"></i> ' + esc(v.leito || '--') + '</span>';
        html += '<span class="paciente-nome">' + esc(v.nm_paciente || '--') + '</span>';
        html += '<div class="paciente-badges">';
        html += '<span class="badge-avaliacao av-' + esc(v.avaliacao_final) + '">' + esc(v.avaliacao_final || '--') + '</span>';
        if (temProblemas) {
            html += '<span class="paciente-problemas-cnt">' + v.itens_problema.length + ' item(s)</span>';
        }
        html += '</div>';
        html += '<i class="fas fa-chevron-down paciente-toggle-icon"></i>';
        html += '</div>';

        // Detalhe expandido
        html += '<div class="paciente-detalhe">';
        if (v.obs_geral) {
            html += '<div class="obs-geral"><i class="fas fa-comment"></i> ' + esc(v.obs_geral) + '</div>';
        }
        if (v.dupla_nome) {
            html += '<div class="paciente-dupla"><i class="fas fa-users"></i> ' + esc(v.dupla_nome) + '</div>';
        }
        if (temProblemas) {
            html += '<div class="itens-problema">';
            v.itens_problema.forEach(function (item) { html += _renderItemProblema(item, v); });
            html += '</div>';
        }
        if (!v.obs_geral && !temProblemas) {
            html += '<div class="paciente-sem-ocorrencias"><i class="fas fa-check-circle"></i> Sem ocorrencias registradas</div>';
        }
        html += '</div>';

        html += '</div>';
        return html;
    }

    function _renderItemProblema(item, visita) {
        var cls = item.resultado === 'critico' ? 'item-critico' : 'item-atencao';
        var bCls = item.resultado === 'critico' ? 'item-badge-critico' : 'item-badge-atencao';
        var lbl = item.resultado === 'critico' ? 'CRITICO' : 'ATENCAO';
        var html = '<div class="item-problema ' + cls + '">';
        html += '<div class="item-header">';
        html += '<span class="item-badge ' + bCls + '">' + lbl + '</span>';
        html += '<span class="item-categoria">' + esc(item.categoria_nome) + '</span>';
        html += '<span class="item-descricao">&mdash; ' + esc(item.item_descricao) + '</span>';
        html += '</div>';
        if (item.obs_item) {
            html += '<div class="item-critica-text"><i class="fas fa-comment-alt"></i> ' + esc(item.obs_item) + '</div>';
        }
        var info = encodeURIComponent(JSON.stringify({
            categoria: item.categoria_nome,
            item: item.item_descricao,
            setor: visita._setor_nome,
            critica: item.obs_item || '',
            avaliacao: item.resultado,
            leito: visita.leito
        }));
        html += '<button class="btn-sugestao" data-info="' + info + '" onclick="Painel32.abrirSugestao(this)">';
        html += '<i class="fas fa-lightbulb"></i> Sugestao de abordagem</button>';
        html += '</div>';
        return html;
    }

    // ----------------------------------------------------------
    // REGENERAR ANALISE IA
    // ----------------------------------------------------------

    function regenerarAnalise() {
        if (!estado.dadosDetalhe || !estado.dataDetalhe) return;
        var btn = document.getElementById('btn-regenerar-analise');
        if (btn) {
            btn.disabled = true;
            btn.innerHTML = '<i class="fas fa-brain"></i> <span class="btn-text">Analisando...</span>';
        }

        document.getElementById('analise-ia-container').style.display = 'none';

        fetch(BASE + '/gerar-analise', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ data: estado.dataDetalhe, setores: estado.dadosDetalhe.setores })
        })
            .then(function (r) { return r.json(); })
            .then(function (res) {
                if (btn) {
                    btn.disabled = false;
                    btn.innerHTML = '<i class="fas fa-brain"></i> <span class="btn-text">Regenerar IA</span>';
                }
                if (!res.success) { toast('Erro IA: ' + res.error, 'error'); return; }
                var ad = { analise_texto: res.data.analise, gerado_por: 'manual', gerado_em: res.data.gerado_em, modelo: res.data.modelo };
                estado.analiseDetalhe = ad;
                _exibirAnalise(ad);
                _atualizarInfoGerado(ad);
                document.getElementById('analise-ia-container').scrollIntoView({ behavior: 'smooth', block: 'start' });
                toast('Analise gerada e salva!', 'success');
            })
            .catch(function (e) {
                if (btn) {
                    btn.disabled = false;
                    btn.innerHTML = '<i class="fas fa-brain"></i> <span class="btn-text">Regenerar IA</span>';
                }
                toast('Erro: ' + e.message, 'error');
            });
    }

    // ----------------------------------------------------------
    // ANALISAR HOJE
    // ----------------------------------------------------------

    function analisarHoje() {
        var hoje = _dataHoje();
        var overlay = document.getElementById('modal-analisar-hoje');
        var body    = document.getElementById('modal-analisar-hoje-body');
        var footer  = document.getElementById('modal-analisar-hoje-footer');
        if (!overlay) return;

        body.innerHTML = '<div class="loading-ia"><div class="loading-spinner"></div><p>Buscando visitas de hoje...</p></div>';
        footer.style.display = 'none';
        overlay.classList.add('ativo');

        // 1. Buscar visitas de hoje
        fetch(BASE + '/dados?data=' + hoje)
            .then(function (r) { return r.json(); })
            .then(function (resDados) {
                if (!resDados.success || resDados.data.total === 0) {
                    body.innerHTML = '<div style="text-align:center;padding:20px;color:#666"><i class="fas fa-calendar-times" style="font-size:2rem;opacity:.3;display:block;margin-bottom:12px"></i><p>Nenhuma visita encontrada para hoje (' + formatarData(hoje) + ').</p></div>';
                    footer.innerHTML = '<button class="btn-cancelar" onclick="document.getElementById(\'modal-analisar-hoje\').classList.remove(\'ativo\')">Fechar</button>';
                    footer.style.display = '';
                    return;
                }

                var dados = resDados.data;
                body.innerHTML = '<div class="loading-ia"><div class="loading-spinner"></div><p>Gerando analise com IA para ' + dados.total + ' visitas...</p></div>';

                // 2. Gerar analise
                return fetch(BASE + '/gerar-analise', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ data: hoje, setores: dados.setores })
                })
                    .then(function (r) { return r.json(); })
                    .then(function (resIA) {
                        if (!resIA.success) {
                            body.innerHTML = '<p style="color:#dc3545;padding:16px">Erro ao gerar analise: ' + esc(resIA.error) + '</p>';
                            footer.innerHTML = '<button class="btn-cancelar" onclick="document.getElementById(\'modal-analisar-hoje\').classList.remove(\'ativo\')">Fechar</button>';
                            footer.style.display = '';
                            return;
                        }
                        body.innerHTML = '<div style="text-align:center;padding:20px;color:#28a745"><i class="fas fa-check-circle" style="font-size:2.5rem;display:block;margin-bottom:12px"></i><p><strong>Analise gerada com sucesso!</strong></p><p style="font-size:0.82rem;color:#666;margin-top:8px">' + dados.total + ' visitas | ' + dados.total_setores + ' setores analisados</p></div>';
                        footer.style.display = '';

                        // Recarregar agenda para incluir o novo dia
                        carregarAgenda();
                    });
            })
            .catch(function (e) {
                body.innerHTML = '<p style="color:#dc3545;padding:16px">Erro: ' + esc(e.message) + '</p>';
                footer.innerHTML = '<button class="btn-cancelar" onclick="document.getElementById(\'modal-analisar-hoje\').classList.remove(\'ativo\')">Fechar</button>';
                footer.style.display = '';
            });

        // Botao "Ver Detalhes" leva direto ao detalhe de hoje
        var btnVer = document.getElementById('btn-ver-detalhe-hoje');
        if (btnVer) {
            btnVer.onclick = function () {
                overlay.classList.remove('ativo');
                abrirDetalhe(hoje);
            };
        }
    }

    // ----------------------------------------------------------
    // SUGESTAO DE ABORDAGEM
    // ----------------------------------------------------------

    function abrirSugestao(btnEl) {
        var infoStr = btnEl.getAttribute('data-info');
        if (!infoStr) return;
        var info;
        try { info = JSON.parse(decodeURIComponent(infoStr)); } catch (e) { return; }

        var overlay = document.getElementById('modal-sugestao');
        var body    = document.getElementById('modal-sugestao-body');
        if (!overlay || !body) return;

        body.innerHTML = '<div class="loading-ia"><div class="loading-spinner"></div><p>Gerando sugestao com IA...</p></div>';
        overlay.classList.add('ativo');

        fetch(BASE + '/sugestao', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(info)
        })
            .then(function (r) { return r.json(); })
            .then(function (res) {
                if (!res.success) { body.innerHTML = '<p style="color:var(--cor-critico)">Erro: ' + esc(res.error) + '</p>'; return; }
                body.innerHTML = '<div class="sugestao-content">' + formatarMarkdown(esc(res.data.sugestao)) + '</div>'
                    + '<div class="sugestao-meta"><strong>Setor:</strong> ' + esc(info.setor)
                    + ' &nbsp;|&nbsp; <strong>Leito:</strong> ' + esc(info.leito)
                    + ' &nbsp;|&nbsp; <strong>Item:</strong> ' + esc(info.categoria) + ' &mdash; ' + esc(info.item) + '</div>';
            })
            .catch(function (e) { body.innerHTML = '<p style="color:var(--cor-critico)">Erro: ' + esc(e.message) + '</p>'; });
    }

    // ----------------------------------------------------------
    // EXPORTAR
    // ----------------------------------------------------------

    function exportarCSV() {
        if (!estado.dataDetalhe) return;
        window.location.href = BASE + '/exportar?data=' + encodeURIComponent(estado.dataDetalhe);
        toast('Download iniciado.', 'success');
    }

    function exportarPDF() {
        if (!estado.dadosDetalhe) return;
        var dados = estado.dadosDetalhe;
        var data  = estado.dataDetalhe;
        var win = window.open('', '_blank');
        if (!win) { toast('Permita popups para exportar PDF.', 'error'); return; }

        var html = '<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8">'
            + '<title>Sentir e Agir - ' + data + '</title>'
            + '<style>body{font-family:Arial,sans-serif;font-size:12px;color:#111;margin:20px}'
            + 'h1{font-size:16px;margin-bottom:4px}h2{font-size:13px;margin:16px 0 6px;border-bottom:1px solid #ccc;padding-bottom:4px}'
            + '.kpis{display:flex;gap:20px;margin:10px 0 16px;font-size:11px}.kpi{background:#f5f5f5;padding:6px 12px;border-radius:4px}.kpi strong{font-size:16px;display:block}'
            + 'table{width:100%;border-collapse:collapse;margin-bottom:14px;font-size:11px}'
            + 'th{background:#333;color:#fff;padding:5px 8px;text-align:left}td{padding:4px 8px;border-bottom:1px solid #ddd}'
            + 'tr:nth-child(even)td{background:#fafafa}.critico{color:#c00;font-weight:bold}.atencao{color:#b45a00;font-weight:bold}'
            + '.obs{font-style:italic;color:#555;font-size:10px}'
            + '@media print{button{display:none}}</style></head><body>';

        html += '<h1>Sentir e Agir &mdash; ' + formatarData(data) + '</h1>';
        html += '<div class="kpis">'
            + '<div class="kpi"><strong>' + dados.total + '</strong>Visitas</div>'
            + '<div class="kpi"><strong style="color:#c00">' + dados.criticos + '</strong>Criticos</div>'
            + '<div class="kpi"><strong style="color:#b45a00">' + dados.atencao + '</strong>Atencao</div>'
            + '<div class="kpi"><strong style="color:#157015">' + dados.adequados + '</strong>Adequados</div>'
            + '<div class="kpi"><strong>' + dados.total_setores + '</strong>Setores</div></div>';

        dados.setores.forEach(function (s) {
            html += '<h2>' + s.setor_nome + ' (' + s.total + ' visitas)</h2>';
            html += '<table><thead><tr><th>Leito</th><th>Paciente</th><th>Avaliacao</th><th>Dupla</th><th>Obs</th><th>Itens Criticos/Atencao</th></tr></thead><tbody>';
            s.visitas.forEach(function (v) {
                var itensStr = (v.itens_problema || []).map(function (i) {
                    return '[' + i.resultado.toUpperCase() + '] ' + i.categoria_nome + ': ' + i.item_descricao + (i.obs_item ? ' (' + i.obs_item + ')' : '');
                }).join('\n');
                var avCls = v.avaliacao_final === 'critico' ? 'critico' : v.avaliacao_final === 'atencao' ? 'atencao' : '';
                html += '<tr><td>' + (v.leito || '--') + '</td><td>' + (v.nm_paciente || '--') + '</td>'
                    + '<td class="' + avCls + '">' + (v.avaliacao_final || '--') + '</td>'
                    + '<td>' + (v.dupla_nome || '--') + '</td>'
                    + '<td class="obs">' + (v.obs_geral || '') + '</td>'
                    + '<td class="obs" style="white-space:pre-line">' + itensStr + '</td></tr>';
            });
            html += '</tbody></table>';
        });

        html += '<p style="font-size:10px;color:#888;margin-top:20px">Gerado em ' + new Date().toLocaleString('pt-BR') + '</p>';
        html += '<script>window.onload=function(){window.print();}<\/script></body></html>';
        var blob = new Blob([html], { type: 'text/html;charset=utf-8' });
        win.location.href = URL.createObjectURL(blob);
    }

    // ----------------------------------------------------------
    // HELPERS
    // ----------------------------------------------------------

    function _dataHoje() {
        var d = new Date();
        return d.getFullYear() + '-'
            + String(d.getMonth() + 1).padStart(2, '0') + '-'
            + String(d.getDate()).padStart(2, '0');
    }

    function toggleSetor(idx) {
        var card = document.getElementById('sc-' + idx);
        if (card) card.classList.toggle('aberto');
    }

    function togglePaciente(setorIdx, pacIdx) {
        var row = document.getElementById('pac-' + setorIdx + '-' + pacIdx);
        if (row) row.classList.toggle('aberto');
    }

    // ----------------------------------------------------------
    // INICIALIZAR
    // ----------------------------------------------------------

    function init() {
        // Carregar agenda ao abrir
        carregarAgenda();

        // Botao analisar hoje
        var btnHoje = document.getElementById('btn-analisar-hoje');
        if (btnHoje) btnHoje.addEventListener('click', analisarHoje);

        // Botao refresh agenda
        var btnRefresh = document.getElementById('btn-refresh-agenda');
        if (btnRefresh) btnRefresh.addEventListener('click', carregarAgenda);

        // Botao voltar para agenda
        var btnVoltar = document.getElementById('btn-voltar-agenda');
        if (btnVoltar) btnVoltar.addEventListener('click', function () {
            mostrarView('agenda');
            carregarAgenda();
        });

        // Botao regenerar analise
        var btnRegen = document.getElementById('btn-regenerar-analise');
        if (btnRegen) btnRegen.addEventListener('click', regenerarAnalise);

        // Botoes exportar
        var btnCSV = document.getElementById('btn-exportar-csv');
        if (btnCSV) btnCSV.addEventListener('click', exportarCSV);
        var btnPDF = document.getElementById('btn-exportar-pdf');
        if (btnPDF) btnPDF.addEventListener('click', exportarPDF);

        // Botao home (voltar ao dashboard)
        var btnHome = document.getElementById('btn-voltar');
        if (btnHome) btnHome.addEventListener('click', function () { history.back(); });

        // Fechar analise IA
        var btnFecharAnalise = document.getElementById('btn-fechar-analise');
        if (btnFecharAnalise) btnFecharAnalise.addEventListener('click', function () {
            document.getElementById('analise-ia-container').style.display = 'none';
        });

        // Modal sugestao
        ['btn-fechar-sugestao', 'btn-cancelar-sugestao'].forEach(function (id) {
            var el = document.getElementById(id);
            if (el) el.addEventListener('click', function () {
                document.getElementById('modal-sugestao').classList.remove('ativo');
            });
        });
        var modalSugestao = document.getElementById('modal-sugestao');
        if (modalSugestao) modalSugestao.addEventListener('click', function (e) {
            if (e.target === modalSugestao) modalSugestao.classList.remove('ativo');
        });

        // Modal analisar hoje
        var btnFecharHoje = document.getElementById('btn-fechar-analisar-hoje');
        if (btnFecharHoje) btnFecharHoje.addEventListener('click', function () {
            document.getElementById('modal-analisar-hoje').classList.remove('ativo');
        });
        var btnCancelarHoje = document.getElementById('btn-cancelar-analisar-hoje');
        if (btnCancelarHoje) btnCancelarHoje.addEventListener('click', function () {
            document.getElementById('modal-analisar-hoje').classList.remove('ativo');
        });
    }

    document.addEventListener('DOMContentLoaded', init);

    // Expor funcoes para uso inline no HTML
    window.Painel32 = {
        abrirDetalhe: abrirDetalhe,
        toggleSetor: toggleSetor,
        togglePaciente: togglePaciente,
        abrirSugestao: abrirSugestao
    };

})();
