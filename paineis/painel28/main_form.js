// ========================================
// PAINEL 28 - FORMULARIO SENTIR E AGIR V2
// Hospital Anchieta Ceilandia
// Auto-fila, Sim/Nao, Avaliacao Automatica
// ========================================

(function () {
    'use strict';

    var BASE_URL = window.location.origin;
    var CONFIG = {
        apiDuplas: BASE_URL + '/api/paineis/painel28/duplas',
        apiSetores: BASE_URL + '/api/paineis/painel28/setores',
        apiCategorias: BASE_URL + '/api/paineis/painel28/categorias-itens',
        apiConfig: BASE_URL + '/api/paineis/painel28/config',
        apiRondas: BASE_URL + '/api/paineis/painel28/rondas',
        apiVisitas: BASE_URL + '/api/paineis/painel28/visitas',
        apiImagens: BASE_URL + '/api/paineis/painel28/imagens',
        apiProximoPaciente: BASE_URL + '/api/paineis/painel28/proximo-paciente',
        apiFilaPacientes: BASE_URL + '/api/paineis/painel28/fila-pacientes',
        apiReservar: BASE_URL + '/api/paineis/painel28/reservar-paciente',
        apiLiberar: BASE_URL + '/api/paineis/painel28/liberar-paciente'
    };

    var estado = {
        rondaId: null, duplaId: null, dataRonda: null,
        duplas: [], setores: [], categorias: [],
        pacienteAtual: null,       // Paciente carregado da fila
        filaPacientes: [],          // Fila completa
        filaPosicao: 0,             // Posicao atual na fila
        avaliacaoFinalCalculada: null,
        imagensParaEnviar: [],
        enviando: false,
        configServidor: {},
        rondaEmAndamento: null,    // Ronda em andamento encontrada para a dupla selecionada
        editandoVisitaId: null     // Quando nao-null, formulario esta em modo de edicao
    };

    // ========================================
    // INICIALIZACAO
    // ========================================

    function inicializar() {
        console.log('Inicializando Formulario Sentir e Agir V2...');
        configurarNavegacao();
        configurarFormulario();
        configurarModalImpossibilitada();
        configurarConfirmacao();
        configurarResumo();
        configurarModais();
        configurarUpload();
        configurarContadores();
        configurarMascaraData();
        configurarGerenciarDuplas();
        carregarDadosIniciais();

        var inputData = document.getElementById('input-data-ronda');
        if (inputData) {
            var hoje = new Date();
            inputData.value = String(hoje.getDate()).padStart(2, '0') + '/' +
                String(hoje.getMonth() + 1).padStart(2, '0') + '/' + hoje.getFullYear();
        }

        // Carregar tabela de fila de pacientes
        carregarFilaVisao();
        var btnAtualizarFila = document.getElementById('btn-atualizar-fila-visao');
        if (btnAtualizarFila) btnAtualizarFila.addEventListener('click', carregarFilaVisao);

        console.log('Formulario V2 inicializado');
    }

    // ========================================
    // MASCARA DATA DD/MM/AAAA
    // ========================================

    function configurarMascaraData() {
        var input = document.getElementById('input-data-ronda');
        if (!input) return;
        input.addEventListener('input', function () {
            var val = this.value.replace(/\D/g, '');
            if (val.length > 8) val = val.substring(0, 8);
            var f = '';
            if (val.length > 0) f = val.substring(0, Math.min(2, val.length));
            if (val.length > 2) f += '/' + val.substring(2, Math.min(4, val.length));
            if (val.length > 4) f += '/' + val.substring(4, 8);
            this.value = f;
        });
    }

    function converterDataParaISO(dataBR) {
        if (!dataBR || dataBR.length !== 10) return null;
        var p = dataBR.split('/');
        if (p.length !== 3) return null;
        var dia = parseInt(p[0], 10), mes = parseInt(p[1], 10), ano = parseInt(p[2], 10);
        if (isNaN(dia) || isNaN(mes) || isNaN(ano) || dia < 1 || dia > 31 || mes < 1 || mes > 12 || ano < 2020) return null;
        return ano + '-' + String(mes).padStart(2, '0') + '-' + String(dia).padStart(2, '0');
    }

    // ========================================
    // CARREGAR DADOS INICIAIS
    // ========================================

    function carregarDadosIniciais() {
        Promise.all([
            fetch(CONFIG.apiDuplas).then(function (r) { return r.json(); }),
            fetch(CONFIG.apiSetores).then(function (r) { return r.json(); }),
            fetch(CONFIG.apiCategorias).then(function (r) { return r.json(); }),
            fetch(CONFIG.apiConfig).then(function (r) { return r.json(); })
        ]).then(function (res) {
            if (res[0].success) { estado.duplas = res[0].data || []; popularDuplas(); }
            if (res[1].success) { estado.setores = res[1].data || []; }
            if (res[2].success) { estado.categorias = res[2].data || []; renderizarCategorias(); }
            if (res[3].success) { estado.configServidor = res[3].data || {}; aplicarConfig(); }
        }).catch(function (err) {
            console.error('Erro ao carregar dados:', err);
            mostrarToast('Erro ao carregar dados', 'erro');
        });
    }

    function popularDuplas() {
        var sel = document.getElementById('select-dupla');
        if (!sel) return;
        sel.innerHTML = '<option value="">Selecione a dupla...</option>';
        estado.duplas.forEach(function (d) {
            var opt = document.createElement('option');
            opt.value = d.id;
            opt.textContent = d.nome_visitante_1 + ' e ' + d.nome_visitante_2;
            sel.appendChild(opt);
        });
    }

    function aplicarConfig() {
        var maxImg = estado.configServidor.max_imagens_por_visita || '5';
        var el = document.getElementById('upload-limite');
        if (el) el.textContent = 'Maximo: ' + maxImg + ' imagens';
    }

    // ========================================
    // FILA DE PACIENTES - TABELA VISAO GERAL
    // ========================================

    function carregarFilaVisao() {
        var container = document.getElementById('fila-visao-container');
        var body = document.getElementById('fila-visao-body');
        var total = document.getElementById('fila-visao-total');

        if (!container || !body) return;
        container.style.display = 'block';
        body.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:16px;color:#aaa;"><i class="fas fa-spinner fa-spin"></i> Carregando...</td></tr>';

        fetch(CONFIG.apiFilaPacientes + '?limite=50')
            .then(function (r) { return r.json(); })
            .then(function (data) {
                if (!data.success || !data.data || data.data.length === 0) {
                    body.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:16px;color:#aaa;">Nenhum paciente na fila</td></tr>';
                    if (total) total.textContent = '0 pacientes';
                    return;
                }
                var lista = data.data;
                if (total) total.textContent = lista.length + ' paciente(s)';
                body.innerHTML = lista.map(function (p, idx) {
                    var visitadoHoje = p.ja_visitado_hoje;
                    var emVisita = !!p.dupla_em_visita;
                    var linhaStyle = visitadoHoje
                        ? 'background:#f0fff4;color:#888;'
                        : (emVisita ? 'background:#fff8e1;' : '');
                    var html = '<tr style="border-bottom:1px solid #f0f0f0;' + linhaStyle + '">';
                    html += '<td style="padding:7px 10px;color:#999;">' + (idx + 1) + '</td>';
                    html += '<td style="padding:7px 10px;font-weight:600;max-width:140px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="' + escapeAttr(p.nm_paciente || '') + '">' + escapeHtml(p.nm_paciente || 'N/I') + '</td>';
                    html += '<td style="padding:7px 10px;"><strong>' + escapeHtml(p.leito || '--') + '</strong></td>';
                    html += '<td style="padding:7px 10px;">' + escapeHtml(p.setor_sa_sigla || p.setor_ocupacao || '--') + '</td>';
                    html += '<td style="padding:7px 10px;text-align:center;">' + (p.qt_dia_permanencia || '--') + '</td>';
                    if (emVisita) {
                        html += '<td style="padding:7px 10px;color:#e67e00;font-size:0.73rem;"><i class="fas fa-spinner fa-spin" style="font-size:0.6rem;"></i> ' + escapeHtml(p.dupla_em_visita) + '</td>';
                    } else {
                        html += '<td style="padding:7px 10px;color:#bbb;font-size:0.73rem;">&mdash;</td>';
                    }
                    if (visitadoHoje) {
                        html += '<td style="padding:7px 10px;text-align:center;"><span style="background:#28a745;color:#fff;padding:2px 6px;border-radius:4px;font-size:0.7rem;">Sim</span></td>';
                    } else {
                        html += '<td style="padding:7px 10px;text-align:center;"><span style="color:#ccc;font-size:0.75rem;">&mdash;</span></td>';
                    }
                    html += '</tr>';
                    return html;
                }).join('');
            })
            .catch(function () {
                body.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:16px;color:#dc3545;">Erro ao carregar fila</td></tr>';
            });
    }

    // ========================================
    // FILA DE PACIENTES
    // ========================================

    function carregarProximoPaciente() {
        var loading = document.getElementById('paciente-loading');
        var vazio = document.getElementById('paciente-vazio');
        var dados = document.getElementById('paciente-dados');

        if (loading) loading.style.display = 'block';
        if (vazio) vazio.style.display = 'none';
        if (dados) dados.style.display = 'none';

        fetch(CONFIG.apiFilaPacientes + '?limite=50')
            .then(function (r) { return r.json(); })
            .then(function (data) {
                if (loading) loading.style.display = 'none';

                if (data.success && data.data && data.data.length > 0) {
                    estado.filaPacientes = data.data;
                    estado.filaPosicao = 0;
                    exibirPaciente(estado.filaPacientes[0]);
                } else {
                    estado.filaPacientes = [];
                    estado.pacienteAtual = null;
                    if (vazio) vazio.style.display = 'block';
                }
            })
            .catch(function (err) {
                console.error('Erro fila:', err);
                if (loading) loading.style.display = 'none';
                if (vazio) {
                    vazio.style.display = 'block';
                    var p = vazio.querySelector('p');
                    if (p) p.textContent = 'Erro ao carregar fila';
                }
            });
    }

    function reservarPaciente(nr_atendimento) {
        if (!nr_atendimento || !estado.duplaId) return;
        fetch(CONFIG.apiReservar, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ nr_atendimento: nr_atendimento, dupla_id: estado.duplaId })
        }).catch(function () {});
    }

    function liberarPaciente() {
        var pac = estado.pacienteAtual;
        if (!pac || !pac.nr_atendimento || !estado.duplaId) return;
        fetch(CONFIG.apiLiberar, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ nr_atendimento: pac.nr_atendimento, dupla_id: estado.duplaId })
        }).catch(function () {});
    }

    function exibirPaciente(pac) {
        estado.pacienteAtual = pac;
        reservarPaciente(pac.nr_atendimento);

        var dados = document.getElementById('paciente-dados');
        var vazio = document.getElementById('paciente-vazio');
        if (vazio) vazio.style.display = 'none';
        if (dados) dados.style.display = 'block';

        setTexto('pac-nome', pac.nm_paciente || 'N/I');
        setTexto('pac-atendimento', pac.nr_atendimento || '--');
        setTexto('pac-leito', pac.leito || '--');
        setTexto('pac-setor', (pac.setor_sa_nome || '') + ' (' + (pac.setor_ocupacao || '') + ')');
        setTexto('pac-dias', pac.qt_dia_permanencia !== null ? pac.qt_dia_permanencia + ' dia(s)' : '--');
        setTexto('pac-medico', pac.medico_responsavel || '--');
        setTexto('pac-clinica', pac.ds_clinica || '--');
        setTexto('pac-convenio', pac.ds_convenio || '--');
        setTexto('pac-acomodacao', pac.ds_tipo_acomodacao || '--');

        // Status de visita do dia (sempre visivel)
        var statusVisita = document.getElementById('pac-status-visita');
        if (statusVisita) {
            if (pac.ja_visitado_hoje) {
                var horas = pac.horas_desde_visita_hoje;
                var textoHoras = horas !== null && horas !== undefined
                    ? (horas < 1 ? 'menos de 1h atr\u00e1s' : Math.round(horas) + 'h atr\u00e1s')
                    : 'hoje';
                statusVisita.innerHTML = '<i class="fas fa-exclamation-circle"></i> J\u00e1 visitado hoje (' + textoHoras + ') \u2014 fila recomeçando';
                statusVisita.style.cssText = 'display:flex;align-items:center;gap:6px;margin:5px 0 8px;padding:6px 12px;background:#fff3cd;color:#856404;border:1px solid #ffc107;border-radius:8px;font-size:0.82rem;font-weight:500;';
            } else {
                statusVisita.innerHTML = '<i class="fas fa-circle" style="font-size:0.55rem;color:#28a745;"></i> Aguardando visita hoje';
                statusVisita.style.cssText = 'display:flex;align-items:center;gap:6px;margin:5px 0 8px;padding:6px 12px;background:#e8f5e9;color:#2e7d32;border:1px solid #a5d6a7;border-radius:8px;font-size:0.82rem;font-weight:500;';
            }
        }

        // Restaurar rascunho do localStorage (apenas se nao estiver em modo edicao)
        if (!estado.editandoVisitaId) {
            setTimeout(function () { restaurarRascunho(pac); }, 80);
        }
    }

    function pularPaciente() {
        if (estado.filaPacientes.length === 0) {
            mostrarToast('Nenhum paciente na fila', 'info');
            return;
        }
        liberarPaciente();
        estado.filaPosicao++;
        if (estado.filaPosicao >= estado.filaPacientes.length) {
            estado.filaPosicao = 0;
            mostrarToast('Voltando ao inicio da fila', 'info');
        }
        exibirPaciente(estado.filaPacientes[estado.filaPosicao]);
        limparRespostasCategorias();
        mostrarToast('Paciente ' + (estado.filaPosicao + 1) + ' de ' + estado.filaPacientes.length, 'info');
    }

    // ========================================
    // VISITA IMPOSSIBILITADA
    // ========================================

    function configurarModalImpossibilitada() {
        var els = {
            'btn-modal-fechar-impossibilitada': function () { fecharModal('modal-impossibilitada'); },
            'btn-cancelar-impossibilitada': function () { fecharModal('modal-impossibilitada'); },
            'btn-confirmar-impossibilitada': function () { registrarVisitaImpossibilitada(); }
        };
        for (var id in els) {
            var el = document.getElementById(id);
            if (el) el.addEventListener('click', els[id]);
        }
    }

    function abrirModalImpossibilitada() {
        if (!estado.pacienteAtual) {
            mostrarToast('Nenhum paciente carregado', 'erro');
            return;
        }
        var pac = estado.pacienteAtual;
        var info = document.getElementById('impossibilitada-paciente-info');
        if (info) {
            info.innerHTML =
                '<div class="impossibilitada-pac-nome">' + escapeHtml(pac.nm_paciente || 'N/I') + '</div>' +
                '<div class="impossibilitada-pac-detalhe">' +
                '<i class="fas fa-bed"></i> Leito: <strong>' + escapeHtml(pac.leito || '--') + '</strong>' +
                ' &nbsp;|&nbsp; <i class="fas fa-door-open"></i> ' + escapeHtml(pac.setor_sa_nome || pac.setor_ocupacao || '--') +
                '</div>';
        }
        var obs = document.getElementById('input-obs-impossibilitada');
        if (obs) obs.value = '';
        abrirModal('modal-impossibilitada');
    }

    function registrarVisitaImpossibilitada() {
        if (!estado.pacienteAtual) return;
        if (!estado.rondaId) { mostrarToast('Ronda nao iniciada', 'erro'); return; }

        var pac = estado.pacienteAtual;
        var motivo = document.getElementById('select-motivo-impossibilitada');
        var obsExtra = document.getElementById('input-obs-impossibilitada');
        var motivoTexto = motivo ? motivo.value : 'Motivo nao informado';
        var obsTexto = obsExtra ? (obsExtra.value || '').trim() : '';
        var observacoes = 'Visita impossibilitada - ' + motivoTexto;
        if (obsTexto) observacoes += '. ' + obsTexto;

        var btnConfirmar = document.getElementById('btn-confirmar-impossibilitada');
        if (btnConfirmar) { btnConfirmar.disabled = true; btnConfirmar.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Registrando...'; }

        var payload = {
            ronda_id: estado.rondaId,
            setor_id: pac.setor_sa_id,
            leito: pac.leito,
            nr_atendimento: pac.nr_atendimento,
            nm_paciente: pac.nm_paciente,
            setor_ocupacao: pac.setor_ocupacao,
            qt_dias_internacao: pac.qt_dia_permanencia,
            observacoes: observacoes,
            avaliacao_final: 'impossibilitada',
            avaliacoes: []
        };

        fetch(CONFIG.apiVisitas, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        })
        .then(function (r) { return r.json(); })
        .then(function (data) {
            if (data.success) {
                liberarPaciente();
                fecharModal('modal-impossibilitada');
                mostrarToast('Registrado. Avancando para o proximo paciente.', 'sucesso');
                limparFormularioVisita();
                carregarProximoPaciente();
            } else {
                mostrarToast(data.error || (data.errors ? data.errors[0] : 'Erro ao registrar'), 'erro');
            }
        })
        .catch(function () { mostrarToast('Erro de comunicacao', 'erro'); })
        .finally(function () {
            if (btnConfirmar) { btnConfirmar.disabled = false; btnConfirmar.innerHTML = '<i class="fas fa-check"></i> Confirmar e Avançar'; }
        });
    }

    // ========================================
    // EDITAR VISITA SALVA
    // ========================================

    function editarVisita(visitaId) {
        // Se chamado do banner (sem sessao iniciada), iniciar sessao com a ronda em andamento
        if (!estado.rondaId && estado.rondaEmAndamento) {
            estado.rondaId = estado.rondaEmAndamento.id;
            estado.dataRonda = estado.rondaEmAndamento.data_ronda;
            var duplaVal = document.getElementById('select-dupla').value;
            if (duplaVal) estado.duplaId = parseInt(duplaVal);
            var badge = document.getElementById('ronda-info-badge');
            if (badge) badge.textContent = 'Ronda #' + estado.rondaId;
            ocultarBannerRondaAndamento();
        }

        var loading = document.getElementById('paciente-loading');
        var dados = document.getElementById('paciente-dados');
        if (loading) loading.style.display = 'block';
        if (dados) dados.style.display = 'none';
        mostrarTela('formulario');

        fetch(CONFIG.apiVisitas + '/' + visitaId)
            .then(function (r) { return r.json(); })
            .then(function (res) {
                if (!res.success || !res.data) {
                    mostrarToast('Erro ao carregar visita', 'erro');
                    if (loading) loading.style.display = 'none';
                    return;
                }
                var v = res.data;
                estado.editandoVisitaId = visitaId;

                // Construir objeto paciente a partir dos dados da visita
                var pac = {
                    nr_atendimento: v.nr_atendimento,
                    nm_paciente: v.nm_paciente,
                    leito: v.leito,
                    setor_sa_id: v.setor_id,
                    setor_sa_nome: v.setor_nome,
                    setor_sa_sigla: v.setor_sigla,
                    setor_ocupacao: v.setor_ocupacao,
                    qt_dia_permanencia: v.qt_dias_internacao,
                    ds_tipo_acomodacao: null,
                    medico_responsavel: null,
                    ds_clinica: null,
                    ds_convenio: null
                };
                exibirPaciente(pac); // nao restaura draft pois editandoVisitaId esta definido

                // Pre-preencher semaforo apos renderizacao
                setTimeout(function () {
                    limparRespostasCategorias();
                    if (v.categorias) {
                        v.categorias.forEach(function (cat) {
                            cat.itens.forEach(function (item) {
                                if (!item.item_id) return;
                                var btn = document.querySelector(
                                    '.item-avaliacao[data-item-id="' + item.item_id + '"] .btn-semaforo[data-valor="' + item.resultado + '"]'
                                );
                                if (btn) {
                                    var cont = btn.closest('.item-semaforo');
                                    cont.querySelectorAll('.btn-semaforo').forEach(function (b) { b.classList.remove('selecionado'); });
                                    btn.classList.add('selecionado');
                                }
                            });
                        });
                    }
                    // Pre-preencher observacoes
                    var obs = document.getElementById('input-observacoes');
                    if (obs) {
                        obs.value = v.observacoes || '';
                        var c = document.getElementById('count-obs');
                        if (c) c.textContent = (v.observacoes || '').length;
                    }
                    calcularAvaliacaoFinal();

                    // Mostrar barra de edicao
                    var bar = document.getElementById('edit-mode-bar');
                    var ePac = document.getElementById('edit-mode-pac');
                    if (bar) bar.style.display = 'flex';
                    if (ePac) ePac.textContent = v.nm_paciente || v.leito;

                    // Alterar botao de envio
                    var btnEnviar = document.getElementById('btn-enviar-visita');
                    if (btnEnviar) btnEnviar.innerHTML = '<i class="fas fa-save"></i> Atualizar Visita';

                    // Ocultar upload (nao edita imagens neste modo)
                    var uploadArea = document.getElementById('upload-area');
                    if (uploadArea) uploadArea.style.display = 'none';

                    mostrarToast('Editando visita de ' + escapeHtml(v.nm_paciente || v.leito), 'info');
                }, 100);
            })
            .catch(function () {
                mostrarToast('Erro de comunicacao', 'erro');
                if (loading) loading.style.display = 'none';
            });
    }

    function cancelarEdicao() {
        limparFormularioVisita();
        mostrarTela('ronda');
    }

    // ========================================
    // RONDA EM ANDAMENTO (cross-device cache)
    // ========================================

    function verificarRondaEmAndamento(duplaId) {
        var banner = document.getElementById('ronda-andamento-banner');
        if (!banner) return;
        banner.style.display = 'none';
        estado.rondaEmAndamento = null;

        fetch(CONFIG.apiDuplas + '/' + duplaId + '/ronda-em-andamento')
            .then(function (r) { return r.json(); })
            .then(function (data) {
                if (data.success && data.data) {
                    estado.rondaEmAndamento = data.data;
                    renderizarBannerRondaAndamento(data.data);
                }
            })
            .catch(function () {});
    }

    function ocultarBannerRondaAndamento() {
        var banner = document.getElementById('ronda-andamento-banner');
        if (banner) banner.style.display = 'none';
        estado.rondaEmAndamento = null;
    }

    // ========================================
    // AUTO-SAVE (localStorage) - rascunho do formulario
    // ========================================

    function _chaveDraft(pac) {
        return 'p28_draft_' + (estado.rondaId || '0') + '_' + (pac.nr_atendimento || pac.leito || 'pac');
    }

    function salvarRascunho() {
        if (!estado.rondaId || !estado.pacienteAtual || estado.editandoVisitaId) return;
        var pac = estado.pacienteAtual;
        var avaliacoes = {};
        var obsPorItem = {};
        var itens = document.querySelectorAll('.item-avaliacao');
        for (var i = 0; i < itens.length; i++) {
            var itemId = itens[i].getAttribute('data-item-id');
            var sel = itens[i].querySelector('.btn-semaforo.selecionado');
            if (sel) avaliacoes[itemId] = sel.getAttribute('data-valor');
            var obsDiv = itens[i].querySelector('.item-obs-critico');
            if (obsDiv && obsDiv.style.display !== 'none') {
                var ta = obsDiv.querySelector('.item-obs-critico-textarea');
                if (ta && ta.value.trim()) obsPorItem[itemId] = ta.value.trim();
            }
        }
        var obs = document.getElementById('input-observacoes');
        try {
            localStorage.setItem(_chaveDraft(pac), JSON.stringify({
                paciente: pac,
                avaliacoes: avaliacoes,
                obsPorItem: obsPorItem,
                observacoes: obs ? obs.value : ''
            }));
        } catch (e) {}
    }

    function restaurarRascunho(pac) {
        if (estado.editandoVisitaId) return false;
        try {
            var raw = localStorage.getItem(_chaveDraft(pac));
            if (!raw) return false;
            var draft = JSON.parse(raw);
            if (!draft.avaliacoes || Object.keys(draft.avaliacoes).length === 0) return false;
            var restaurou = false;
            Object.keys(draft.avaliacoes).forEach(function (itemId) {
                var valor = draft.avaliacoes[itemId];
                var btn = document.querySelector('.item-avaliacao[data-item-id="' + itemId + '"] .btn-semaforo[data-valor="' + valor + '"]');
                if (btn) {
                    var container = btn.closest('.item-semaforo');
                    container.querySelectorAll('.btn-semaforo').forEach(function (b) { b.classList.remove('selecionado'); });
                    btn.classList.add('selecionado');
                    // Restaurar obs do item se crítico
                    var itemEl = btn.closest('.item-avaliacao');
                    if (itemEl && (valor === 'critico' || valor === 'nao')) {
                        var obsDiv = itemEl.querySelector('.item-obs-critico');
                        if (obsDiv) {
                            obsDiv.style.display = 'block';
                            if (draft.obsPorItem && draft.obsPorItem[itemId]) {
                                var ta = obsDiv.querySelector('.item-obs-critico-textarea');
                                if (ta) ta.value = draft.obsPorItem[itemId];
                            }
                        }
                    }
                    restaurou = true;
                }
            });
            var obs = document.getElementById('input-observacoes');
            if (obs && draft.observacoes) {
                obs.value = draft.observacoes;
                var c = document.getElementById('count-obs');
                if (c) c.textContent = draft.observacoes.length;
            }
            if (restaurou) {
                calcularAvaliacaoFinal();
                mostrarToast('Rascunho anterior restaurado', 'info');
            }
            return restaurou;
        } catch (e) { return false; }
    }

    function limparRascunho(pac) {
        if (!pac) return;
        try { localStorage.removeItem(_chaveDraft(pac)); } catch (e) {}
    }

    function renderizarBannerRondaAndamento(ronda) {
        var banner = document.getElementById('ronda-andamento-banner');
        if (!banner) return;

        var dataEl = document.getElementById('ronda-andamento-data');
        if (dataEl) dataEl.textContent = formatarData(ronda.data_ronda);

        var visitasEl = document.getElementById('ronda-andamento-visitas');
        if (visitasEl) {
            if (ronda.visitas && ronda.visitas.length > 0) {
                visitasEl.innerHTML = ronda.visitas.map(function (v) {
                    return '<div class="ronda-andamento-item">' +
                        '<span class="ronda-andamento-pac"><i class="fas fa-user"></i> ' + escapeHtml(v.nm_paciente || v.leito) + '</span>' +
                        '<div class="ronda-andamento-item-dir">' +
                        '<span class="badge-mini badge-' + v.avaliacao_final + '">' + formatarResultado(v.avaliacao_final) + '</span>' +
                        '<button class="btn-editar-visita-andamento" onclick="window.FORM.editarVisita(' + v.id + ')" title="Editar visita">' +
                        '<i class="fas fa-edit"></i></button>' +
                        '<button class="btn-excluir-visita-andamento" onclick="window.FORM.excluirVisitaAndamento(' + v.id + ')" title="Remover visita">' +
                        '<i class="fas fa-trash-alt"></i></button>' +
                        '</div></div>';
                }).join('');
            } else {
                visitasEl.innerHTML = '<p class="ronda-andamento-vazia"><i class="fas fa-clipboard"></i> Nenhuma visita registrada ainda</p>';
            }
        }

        banner.style.display = 'block';
    }

    function retomarRonda() {
        if (!estado.rondaEmAndamento) return;
        var inputData = document.getElementById('input-data-ronda');
        if (inputData) {
            var dr = estado.rondaEmAndamento.data_ronda;
            var p = dr.split('-');
            if (p.length === 3) inputData.value = p[2] + '/' + p[1] + '/' + p[0];
        }
        ocultarBannerRondaAndamento();
        iniciarRonda();
    }

    function finalizarRondaEmAndamento() {
        if (!estado.rondaEmAndamento) return;
        var ronda = estado.rondaEmAndamento;
        var nVisitas = ronda.visitas ? ronda.visitas.length : 0;
        var msg = 'Finalizar a ronda de ' + formatarData(ronda.data_ronda) + '?\n\n' +
            nVisitas + ' visita(s) registrada(s).\n\nApós finalizar, não será possível adicionar novas visitas.';
        if (!confirm(msg)) return;

        fetch(CONFIG.apiRondas + '/' + ronda.id + '/concluir', { method: 'PUT' })
            .then(function (r) { return r.json(); })
            .then(function (data) {
                if (data.success) {
                    mostrarToast('Ronda finalizada com sucesso!', 'sucesso');
                    ocultarBannerRondaAndamento();
                } else {
                    mostrarToast(data.error || 'Erro ao finalizar ronda', 'erro');
                }
            })
            .catch(function () { mostrarToast('Erro de comunicação', 'erro'); });
    }

    function excluirVisitaAndamento(visitaId) {
        if (!confirm('Remover esta visita da ronda em andamento?')) return;
        fetch(CONFIG.apiVisitas + '/' + visitaId, { method: 'DELETE' })
            .then(function (r) { return r.json(); })
            .then(function (data) {
                if (data.success) {
                    mostrarToast('Visita removida', 'sucesso');
                    var duplaId = document.getElementById('select-dupla').value;
                    if (duplaId) verificarRondaEmAndamento(parseInt(duplaId));
                } else {
                    mostrarToast(data.error || 'Erro ao remover', 'erro');
                }
            })
            .catch(function () { mostrarToast('Erro de comunicacao', 'erro'); });
    }

    function excluirVisitaSessao(visitaId) {
        if (!confirm('Remover esta visita da ronda?')) return;
        fetch(CONFIG.apiVisitas + '/' + visitaId, { method: 'DELETE' })
            .then(function (r) { return r.json(); })
            .then(function (data) {
                if (data.success) {
                    mostrarToast('Visita removida', 'sucesso');
                    carregarVisitasRonda();
                    var telaResumo = document.getElementById('tela-resumo');
                    if (telaResumo && telaResumo.style.display !== 'none') carregarResumo();
                } else {
                    mostrarToast(data.error || 'Erro ao remover', 'erro');
                }
            })
            .catch(function () { mostrarToast('Erro de comunicacao', 'erro'); });
    }

    // ========================================
    // RENDERIZAR CATEGORIAS (SEMAFORO + SIM/NAO)
    // ========================================

    function renderizarCategorias() {
        var container = document.getElementById('categorias-container');
        if (!container) return;

        container.innerHTML = estado.categorias.map(function (cat) {
            var cor = cat.cor || '#dc3545';
            var html = '<div class="form-card" data-categoria-id="' + cat.id + '">';
            html += '<div class="form-card-header" style="background: ' + escapeAttr(cor) + ';">';
            html += '  ' + escapeHtml(cat.icone || '') + ' ' + escapeHtml(cat.nome);
            html += '</div><div class="form-card-body">';

            cat.itens.forEach(function (item) {
                var tipo = item.tipo || 'semaforo';
                html += '<div class="item-avaliacao" data-item-id="' + item.id + '" data-tipo="' + tipo + '">';
                html += '  <div class="item-descricao">' + escapeHtml(item.descricao) + '</div>';
                var cq = (tipo === 'sim_nao') ? (item.critico_quando || 'nao') : '';
                html += '  <div class="item-semaforo"' + (cq ? ' data-critico-quando="' + cq + '"' : '') + '>';

                if (tipo === 'sim_nao') {
                    html += '    <button type="button" class="btn-semaforo btn-sim" data-item="' + item.id + '" data-valor="sim" onclick="window.FORM.selecionarSemaforo(this)">';
                    html += '      <i class="fas fa-check"></i> Sim';
                    html += '    </button>';
                    html += '    <button type="button" class="btn-semaforo btn-nao" data-item="' + item.id + '" data-valor="nao" onclick="window.FORM.selecionarSemaforo(this)">';
                    html += '      <i class="fas fa-times"></i> Não';
                    html += '    </button>';
                } else {
                    html += '    <button type="button" class="btn-semaforo critico" data-item="' + item.id + '" data-valor="critico" onclick="window.FORM.selecionarSemaforo(this)">';
                    html += '      <i class="fas fa-circle"></i> Critico';
                    html += '    </button>';
                    html += '    <button type="button" class="btn-semaforo atencao" data-item="' + item.id + '" data-valor="atencao" onclick="window.FORM.selecionarSemaforo(this)">';
                    html += '      <i class="fas fa-circle"></i> Atencao';
                    html += '    </button>';
                    html += '    <button type="button" class="btn-semaforo adequado" data-item="' + item.id + '" data-valor="adequado" onclick="window.FORM.selecionarSemaforo(this)">';
                    html += '      <i class="fas fa-circle"></i> Adequado';
                    html += '    </button>';
                    if (cat.permite_nao_aplica) {
                        html += '    <button type="button" class="btn-semaforo nao-aplica" data-item="' + item.id + '" data-valor="nao_aplica" onclick="window.FORM.selecionarSemaforo(this)">';
                        html += '      <i class="fas fa-minus"></i> N/A';
                        html += '    </button>';
                    }
                }
                html += '  </div>';
                // Campo de observação individual para item crítico (aparece ao marcar como crítico/não)
                html += '  <div class="item-obs-critico" style="display:none;">';
                html += '    <label class="item-obs-critico-label"><i class="fas fa-exclamation-circle"></i> Obs. sobre "' + escapeHtml(item.descricao) + '":</label>';
                html += '    <textarea class="item-obs-critico-textarea" placeholder="Descreva o problema identificado neste item..." rows="2" maxlength="500"></textarea>';
                html += '  </div>';
                html += '</div>';
            });
            html += '</div></div>';
            return html;
        }).join('');
    }

    function selecionarSemaforo(btn) {
        var container = btn.closest('.item-semaforo');
        var botoes = container.querySelectorAll('.btn-semaforo');
        for (var i = 0; i < botoes.length; i++) {
            botoes[i].classList.remove('selecionado', 'sel-critico', 'sel-adequado');
        }

        var valor = btn.getAttribute('data-valor');

        // Para itens sim_nao: colorir conforme critico_quando (armazenado no .item-semaforo)
        var semaforo = btn.closest('.item-semaforo');
        var criticoQuando = semaforo ? semaforo.getAttribute('data-critico-quando') : null;
        if (criticoQuando) {
            btn.classList.add('selecionado', valor === criticoQuando ? 'sel-critico' : 'sel-adequado');
        } else {
            btn.classList.add('selecionado');
        }

        // Mostrar/ocultar campo de observação individual para item crítico
        var itemEl = btn.closest('.item-avaliacao');
        if (itemEl) {
            var obsDiv = itemEl.querySelector('.item-obs-critico');
            if (obsDiv) {
                var ehCritico = criticoQuando ? (valor === criticoQuando) : (valor === 'critico');
                obsDiv.style.display = ehCritico ? 'block' : 'none';
                if (!ehCritico) {
                    var ta = obsDiv.querySelector('.item-obs-critico-textarea');
                    if (ta) ta.value = '';
                }
            }
        }

        calcularAvaliacaoFinal();
        salvarRascunho();
    }

    function limparRespostasCategorias() {
        var selecionados = document.querySelectorAll('.btn-semaforo.selecionado');
        for (var i = 0; i < selecionados.length; i++) selecionados[i].classList.remove('selecionado');
        estado.avaliacaoFinalCalculada = null;
        atualizarDisplayAvaliacaoFinal();
    }

    // ========================================
    // AVALIACAO FINAL AUTOMATICA
    // ========================================

    function calcularAvaliacaoFinal() {
        var todosItens = document.querySelectorAll('.item-avaliacao');
        var temCritico = false;
        var temAtencao = false;
        var totalPreenchidos = 0;

        for (var i = 0; i < todosItens.length; i++) {
            var selecionado = todosItens[i].querySelector('.btn-semaforo.selecionado');
            if (selecionado) {
                totalPreenchidos++;
                var valor = selecionado.getAttribute('data-valor');
                if (valor === 'critico') {
                    temCritico = true;
                } else if (valor === 'atencao') {
                    temAtencao = true;
                } else if (valor === 'sim' || valor === 'nao') {
                    // sim_nao: verificar critico_quando do item-semaforo
                    var semF = selecionado.closest('.item-semaforo');
                    var cqF = semF ? semF.getAttribute('data-critico-quando') : 'nao';
                    if (valor === (cqF || 'nao')) temCritico = true;
                }
            }
        }

        if (totalPreenchidos === 0) {
            estado.avaliacaoFinalCalculada = null;
        } else if (temCritico) {
            estado.avaliacaoFinalCalculada = 'critico';
        } else if (temAtencao) {
            estado.avaliacaoFinalCalculada = 'atencao';
        } else {
            estado.avaliacaoFinalCalculada = 'adequado';
        }

        atualizarDisplayAvaliacaoFinal();
    }

    function atualizarDisplayAvaliacaoFinal() {
        var display = document.getElementById('avaliacao-auto-display');
        var detalhe = document.getElementById('avaliacao-auto-detalhe');
        if (!display) return;

        var resultado = estado.avaliacaoFinalCalculada;

        if (!resultado) {
            display.className = 'avaliacao-auto-display';
            display.innerHTML = '<i class="fas fa-minus-circle"></i> <span>Preencha os itens acima</span>';
            if (detalhe) detalhe.innerHTML = '';
            return;
        }

        var mapa = {
            'critico': { cls: 'avaliacao-auto-critico', icone: 'fas fa-exclamation-circle', texto: 'CRITICO', desc: 'Ao menos 1 item foi marcado como Critico ou Nao' },
            'atencao': { cls: 'avaliacao-auto-atencao', icone: 'fas fa-exclamation-triangle', texto: 'ATENCAO', desc: 'Ao menos 1 item foi marcado como Atencao' },
            'adequado': { cls: 'avaliacao-auto-adequado', icone: 'fas fa-check-circle', texto: 'ADEQUADO', desc: 'Todos os itens foram marcados como Adequado ou Sim' }
        };

        var info = mapa[resultado];
        display.className = 'avaliacao-auto-display ' + info.cls;
        display.innerHTML = '<i class="' + info.icone + '"></i> <span>' + info.texto + '</span>';
        if (detalhe) detalhe.innerHTML = '<small>' + info.desc + '</small>';
    }

    // ========================================
    // NAVEGACAO
    // ========================================

    function configurarNavegacao() {
        var btnVoltar = document.getElementById('btn-voltar');
        if (btnVoltar) btnVoltar.addEventListener('click', function () { window.location.href = '/paineis/painel28/sentir-agir.html'; });
        var btnGestao = document.getElementById('btn-gestao');
        if (btnGestao) btnGestao.addEventListener('click', function () { window.location.href = '/painel/painel29'; });
        var btnTratativas = document.getElementById('btn-tratativas');
        if (btnTratativas) btnTratativas.addEventListener('click', function () { window.location.href = '/painel/painel30'; });
    }

    function mostrarTela(tela) {
        var telas = ['tela-ronda', 'tela-formulario', 'tela-confirmacao', 'tela-resumo'];
        telas.forEach(function (id) {
            var el = document.getElementById(id);
            if (el) el.style.display = (id === 'tela-' + tela) ? 'flex' : 'none';
        });
        var telaEl = document.getElementById('tela-' + tela);
        if (telaEl) telaEl.scrollTop = 0;
    }

    // ========================================
    // FORMULARIO: INICIAR RONDA
    // ========================================

    function configurarFormulario() {
        var btnIniciar = document.getElementById('btn-iniciar-ronda');
        if (btnIniciar) btnIniciar.addEventListener('click', function () { iniciarRonda(); });

        var btnVoltarRonda = document.getElementById('btn-voltar-ronda');
        if (btnVoltarRonda) btnVoltarRonda.addEventListener('click', function () { mostrarTela('ronda'); });

        var form = document.getElementById('form-visita');
        if (form) form.addEventListener('submit', function (e) { e.preventDefault(); enviarVisita(); });

        var btnPular = document.getElementById('btn-pular');
        if (btnPular) btnPular.addEventListener('click', function () { pularPaciente(); });

        var btnImpos = document.getElementById('btn-impossibilitada');
        if (btnImpos) btnImpos.addEventListener('click', function () { abrirModalImpossibilitada(); });

        var btnCancelarEd = document.getElementById('btn-cancelar-edicao');
        if (btnCancelarEd) btnCancelarEd.addEventListener('click', function () { cancelarEdicao(); });

        var selDupla = document.getElementById('select-dupla');
        if (selDupla) selDupla.addEventListener('change', function () {
            var duplaId = this.value;
            if (duplaId && !estado.rondaId) {
                verificarRondaEmAndamento(parseInt(duplaId));
            } else {
                ocultarBannerRondaAndamento();
            }
        });
    }

    function iniciarRonda() {
        var duplaId = document.getElementById('select-dupla').value;
        var dataBR = document.getElementById('input-data-ronda').value;
        if (!duplaId) { mostrarToast('Selecione a dupla', 'erro'); return; }
        if (!dataBR || dataBR.length !== 10) { mostrarToast('Informe a data dd/mm/aaaa', 'erro'); return; }
        var dataISO = converterDataParaISO(dataBR);
        if (!dataISO) { mostrarToast('Data invalida', 'erro'); return; }

        var btn = document.getElementById('btn-iniciar-ronda');
        if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Iniciando...'; }

        fetch(CONFIG.apiRondas, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ dupla_id: parseInt(duplaId), data_ronda: dataISO })
        })
        .then(function (r) { return r.json(); })
        .then(function (data) {
            if (data.success) {
                estado.rondaId = data.data.id;
                estado.duplaId = parseInt(duplaId);
                estado.dataRonda = dataISO;
                ocultarBannerRondaAndamento();
                var badge = document.getElementById('ronda-info-badge');
                if (badge) badge.textContent = 'Ronda #' + estado.rondaId;
                if (data.data.existente) {
                    mostrarToast('Ronda existente carregada', 'info');
                    carregarVisitasRonda();
                } else {
                    mostrarToast('Ronda criada', 'sucesso');
                }
                limparFormularioVisita();
                mostrarTela('formulario');
                carregarProximoPaciente();
            } else {
                mostrarToast(data.error || (data.errors ? data.errors[0] : 'Erro'), 'erro');
            }
        })
        .catch(function () { mostrarToast('Erro de comunicacao', 'erro'); })
        .finally(function () {
            if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-play-circle"></i> Iniciar Ronda'; }
        });
    }

    // ========================================
    // ENVIAR VISITA
    // ========================================

    function enviarVisita() {
        if (estado.enviando) return;
        if (!estado.pacienteAtual) { mostrarToast('Nenhum paciente selecionado', 'erro'); return; }
        if (!estado.avaliacaoFinalCalculada) { mostrarToast('Preencha todos os itens de avaliacao', 'erro'); return; }

        var pac = estado.pacienteAtual;
        var erros = [];
        var avaliacoes = [];
        var todosItens = document.querySelectorAll('.item-avaliacao');
        var itensSemResposta = 0;

        for (var i = 0; i < todosItens.length; i++) {
            var itemEl = todosItens[i];
            var itemId = itemEl.getAttribute('data-item-id');
            var selecionado = itemEl.querySelector('.btn-semaforo.selecionado');
            if (!selecionado) {
                itensSemResposta++;
            } else {
                var valor = selecionado.getAttribute('data-valor');
                var obsItem = null;
                var obsDiv = itemEl.querySelector('.item-obs-critico');
                if (obsDiv && obsDiv.style.display !== 'none') {
                    var ta = obsDiv.querySelector('.item-obs-critico-textarea');
                    if (ta) obsItem = ta.value.trim() || null;
                }
                avaliacoes.push({ item_id: parseInt(itemId), resultado: valor, obs_item: obsItem });
            }
        }

        if (itensSemResposta > 0) {
            mostrarToast('Faltam ' + itensSemResposta + ' item(ns) para avaliar', 'erro');
            var primeiro = null;
            for (var k = 0; k < todosItens.length; k++) {
                if (!todosItens[k].querySelector('.btn-semaforo.selecionado')) { primeiro = todosItens[k]; break; }
            }
            if (primeiro) primeiro.scrollIntoView({ behavior: 'smooth', block: 'center' });
            return;
        }

        estado.enviando = true;
        var btnEnviar = document.getElementById('btn-enviar-visita');
        if (btnEnviar) { btnEnviar.disabled = true; btnEnviar.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Registrando...'; }

        var observacoes = (document.getElementById('input-observacoes').value || '').trim();

        var payload = {
            ronda_id: estado.rondaId,
            setor_id: pac.setor_sa_id,
            leito: pac.leito,
            nr_atendimento: pac.nr_atendimento,
            nm_paciente: pac.nm_paciente,
            setor_ocupacao: pac.setor_ocupacao,
            qt_dias_internacao: pac.qt_dia_permanencia,
            observacoes: observacoes || null,
            avaliacao_final: estado.avaliacaoFinalCalculada,
            avaliacoes: avaliacoes
        };

        var editId = estado.editandoVisitaId;
        var metodo = editId ? 'PUT' : 'POST';
        var url = editId ? CONFIG.apiVisitas + '/' + editId : CONFIG.apiVisitas;

        fetch(url, {
            method: metodo,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        })
        .then(function (r) { return r.json(); })
        .then(function (data) {
            if (data.success) {
                liberarPaciente();
                limparRascunho(pac);
                if (editId) {
                    // Modo edicao: voltar para tela-ronda com resumo atualizado
                    limparFormularioVisita();
                    carregarVisitasRonda();
                    mostrarTela('ronda');
                    mostrarToast('Visita atualizada com sucesso!', 'sucesso');
                } else {
                    // Modo normal: fluxo de confirmacao
                    var visitaId = data.data.id;
                    if (estado.imagensParaEnviar.length > 0) {
                        enviarImagensSequencial(visitaId, 0, function () {
                            exibirConfirmacao(pac, avaliacoes);
                        });
                    } else {
                        exibirConfirmacao(pac, avaliacoes);
                    }
                }
            } else {
                mostrarToast(data.error || (data.errors ? data.errors[0] : 'Erro'), 'erro');
            }
        })
        .catch(function () { mostrarToast('Erro de comunicacao', 'erro'); })
        .finally(function () {
            estado.enviando = false;
            if (btnEnviar) {
                btnEnviar.disabled = false;
                btnEnviar.innerHTML = estado.editandoVisitaId
                    ? '<i class="fas fa-save"></i> Atualizar Visita'
                    : '<i class="fas fa-paper-plane"></i> Registrar Visita';
            }
        });
    }

    // ========================================
    // UPLOAD IMAGENS
    // ========================================

    function configurarUpload() {
        var btnUpload = document.getElementById('btn-upload');
        var inputImagem = document.getElementById('input-imagem');
        if (btnUpload && inputImagem) {
            btnUpload.addEventListener('click', function () { inputImagem.click(); });
            inputImagem.addEventListener('change', function () {
                var arquivos = this.files;
                if (!arquivos || arquivos.length === 0) return;
                var maxImg = parseInt(estado.configServidor.max_imagens_por_visita || '5');
                var maxMb = parseFloat(estado.configServidor.tamanho_max_imagem_mb || '10');
                for (var i = 0; i < arquivos.length; i++) {
                    if (estado.imagensParaEnviar.length >= maxImg) { mostrarToast('Limite de ' + maxImg + ' imagens', 'erro'); break; }
                    if (arquivos[i].size > maxMb * 1024 * 1024) { mostrarToast(arquivos[i].name + ' excede ' + maxMb + 'MB', 'erro'); continue; }
                    estado.imagensParaEnviar.push(arquivos[i]);
                }
                renderizarPreviews();
                this.value = '';
            });
        }
    }

    function renderizarPreviews() {
        var c = document.getElementById('preview-imagens');
        if (!c) return;
        c.innerHTML = '';
        estado.imagensParaEnviar.forEach(function (arq, idx) {
            var div = document.createElement('div'); div.className = 'preview-item';
            var img = document.createElement('img'); img.src = URL.createObjectURL(arq); div.appendChild(img);
            var btn = document.createElement('button'); btn.type = 'button'; btn.className = 'preview-remover';
            btn.innerHTML = '<i class="fas fa-times"></i>'; btn.setAttribute('data-index', idx);
            btn.addEventListener('click', function () {
                estado.imagensParaEnviar.splice(parseInt(this.getAttribute('data-index')), 1);
                renderizarPreviews();
            });
            div.appendChild(btn);
            c.appendChild(div);
        });
    }

    function enviarImagensSequencial(visitaId, idx, cb) {
        if (idx >= estado.imagensParaEnviar.length) { cb(); return; }
        var fd = new FormData();
        fd.append('visita_id', visitaId);
        fd.append('arquivo', estado.imagensParaEnviar[idx]);
        fetch(CONFIG.apiImagens, { method: 'POST', body: fd })
            .then(function () { enviarImagensSequencial(visitaId, idx + 1, cb); })
            .catch(function () { enviarImagensSequencial(visitaId, idx + 1, cb); });
    }

    // ========================================
    // CONFIRMACAO
    // ========================================

    function configurarConfirmacao() {
        var btnNovo = document.getElementById('btn-novo-leito');
        if (btnNovo) btnNovo.addEventListener('click', function () {
            limparFormularioVisita();
            mostrarTela('formulario');
            carregarProximoPaciente();
        });
        var btnConcluir = document.getElementById('btn-concluir-ronda');
        if (btnConcluir) btnConcluir.addEventListener('click', function () { abrirModalConcluir(); });
        var btnResumo = document.getElementById('btn-ver-resumo');
        if (btnResumo) btnResumo.addEventListener('click', function () { mostrarTela('resumo'); carregarResumo(); });
    }

    function exibirConfirmacao(pac, avaliacoes) {
        var det = document.getElementById('confirmacao-detalhes');
        if (det) {
            var qC = 0, qA = 0, qAd = 0;
            avaliacoes.forEach(function (a) {
                if (a.resultado === 'critico') { qC++; }
                else if (a.resultado === 'atencao') { qA++; }
                else if (a.resultado === 'adequado') { qAd++; }
                else if (a.resultado === 'sim' || a.resultado === 'nao') {
                    // respeitar critico_quando do item
                    var itemCfg = null;
                    for (var ci = 0; ci < estado.categorias.length && !itemCfg; ci++) {
                        var catI = estado.categorias[ci];
                        if (catI.itens) {
                            for (var ii = 0; ii < catI.itens.length; ii++) {
                                if (catI.itens[ii].id === a.item_id) { itemCfg = catI.itens[ii]; break; }
                            }
                        }
                    }
                    var cqConf = itemCfg ? (itemCfg.critico_quando || 'nao') : 'nao';
                    if (a.resultado === cqConf) qC++; else qAd++;
                }
            });
            det.innerHTML =
                '<strong>Paciente:</strong> ' + escapeHtml(pac.nm_paciente) + '<br>' +
                '<strong>Leito:</strong> ' + escapeHtml(pac.leito) + '<br>' +
                '<strong>Setor:</strong> ' + escapeHtml(pac.setor_sa_nome) + '<br>' +
                '<strong>Avaliacao:</strong> ' + escapeHtml(formatarResultado(estado.avaliacaoFinalCalculada)) + '<br>' +
                '<span style="color:#dc3545;">&#9679;</span> ' + qC +
                ' | <span style="color:#ffc107;">&#9679;</span> ' + qA +
                ' | <span style="color:#28a745;">&#9679;</span> ' + qAd;
        }
        if (navigator.vibrate) navigator.vibrate([100, 50, 100]);
        mostrarTela('confirmacao');
    }

    // ========================================
    // RESUMO DA RONDA
    // ========================================

    function configurarResumo() {
        var btnV = document.getElementById('btn-voltar-resumo');
        if (btnV) btnV.addEventListener('click', function () { mostrarTela('formulario'); });
        var btnR = document.getElementById('btn-refresh-resumo');
        if (btnR) btnR.addEventListener('click', function () { carregarResumo(); mostrarToast('Atualizado', 'info'); });
        var btnA = document.getElementById('btn-adicionar-leito');
        if (btnA) btnA.addEventListener('click', function () { limparFormularioVisita(); mostrarTela('formulario'); carregarProximoPaciente(); });
        var btnC = document.getElementById('btn-concluir-ronda-resumo');
        if (btnC) btnC.addEventListener('click', function () { abrirModalConcluir(); });
    }

    function carregarResumo() {
        if (!estado.rondaId) return;
        fetch(CONFIG.apiRondas + '/' + estado.rondaId + '/visitas')
            .then(function (r) { return r.json(); })
            .then(function (d) { if (d.success) renderizarResumo(d.data || []); })
            .catch(function () { });
    }

    function carregarVisitasRonda() {
        if (!estado.rondaId) return;
        fetch(CONFIG.apiRondas + '/' + estado.rondaId + '/visitas')
            .then(function (r) { return r.json(); })
            .then(function (d) { if (d.success && d.data && d.data.length > 0) renderizarVisitasMiniResumo(d.data); })
            .catch(function () { });
    }

    function renderizarVisitasMiniResumo(visitas) {
        var el = document.getElementById('visitas-resumo');
        var lista = document.getElementById('visitas-resumo-lista');
        var badge = document.getElementById('badge-total-visitas');
        if (!el || !lista) return;
        el.style.display = 'block';
        if (badge) badge.textContent = visitas.length;
        lista.innerHTML = visitas.map(function (v) {
            return '<div class="visita-mini-card mini-' + v.avaliacao_final + '">' +
                '<span><strong>' + escapeHtml(v.nm_paciente || v.leito) + '</strong> - ' + escapeHtml(v.setor_sigla || v.setor_nome) + '</span>' +
                '<div class="mini-card-direita">' +
                '<span>' + escapeHtml(formatarResultado(v.avaliacao_final)) + '</span>' +
                '<button class="btn-editar-mini" onclick="window.FORM.editarVisita(' + v.id + ')" title="Editar"><i class="fas fa-edit"></i></button>' +
                '<button class="btn-excluir-mini" onclick="window.FORM.excluirVisitaSessao(' + v.id + ')" title="Remover"><i class="fas fa-trash-alt"></i></button>' +
                '</div></div>';
        }).join('');
    }

    function renderizarResumo(visitas) {
        var lista = document.getElementById('resumo-lista');
        var vazio = document.getElementById('resumo-vazio');
        var total = visitas.length, crit = 0, aten = 0, adeq = 0;
        visitas.forEach(function (v) {
            if (v.avaliacao_final === 'critico') crit++;
            else if (v.avaliacao_final === 'atencao') aten++;
            else if (v.avaliacao_final !== 'impossibilitada') adeq++;
        });
        setTexto('kpi-total', total); setTexto('kpi-criticos', crit);
        setTexto('kpi-atencao', aten); setTexto('kpi-adequados', adeq);
        if (!lista) return;
        if (total === 0) { lista.innerHTML = ''; if (vazio) vazio.style.display = 'block'; return; }
        if (vazio) vazio.style.display = 'none';
        lista.innerHTML = visitas.map(function (v) {
            return '<div class="resumo-card avaliacao-' + v.avaliacao_final + '" onclick="window.FORM.abrirDetalhe(' + v.id + ')">' +
                '<div class="resumo-card-header"><span class="resumo-card-leito"><i class="fas fa-user"></i> ' +
                escapeHtml(v.nm_paciente || v.leito) + '</span>' +
                '<span class="resumo-card-badge badge-' + v.avaliacao_final + '">' + formatarResultado(v.avaliacao_final) + '</span></div>' +
                '<div class="resumo-card-body">' +
                '<span class="resumo-card-stat"><i class="fas fa-bed"></i> ' + escapeHtml(v.setor_sigla || v.setor_nome) + ' - ' + escapeHtml(v.leito) + '</span>' +
                (v.qtd_critico > 0 ? '<span class="resumo-card-stat stat-critico"><i class="fas fa-circle"></i> ' + v.qtd_critico + '</span>' : '') +
                (v.qtd_atencao > 0 ? '<span class="resumo-card-stat stat-atencao"><i class="fas fa-circle"></i> ' + v.qtd_atencao + '</span>' : '') +
                (v.qtd_adequado > 0 ? '<span class="resumo-card-stat stat-adequado"><i class="fas fa-circle"></i> ' + v.qtd_adequado + '</span>' : '') +
                '</div></div>';
        }).join('');
    }

    // ========================================
    // DETALHE VISITA (MODAL)
    // ========================================

    function abrirDetalhe(visitaId) {
        var body = document.getElementById('modal-detalhe-body');
        if (body) body.innerHTML = '<div class="loading"><div class="loading-spinner"></div><p>Carregando...</p></div>';
        abrirModal('modal-detalhe');
        fetch(CONFIG.apiVisitas + '/' + visitaId)
            .then(function (r) { return r.json(); })
            .then(function (d) { if (d.success) renderizarDetalhe(d.data); })
            .catch(function () { if (body) body.innerHTML = '<p style="color:#dc3545;">Erro</p>'; });
    }

    function renderizarDetalhe(v) {
        var body = document.getElementById('modal-detalhe-body');
        if (!body) return;
        var html = '<div style="margin-bottom:14px;">';
        html += '<strong>' + escapeHtml(v.nm_paciente || 'N/I') + '</strong><br>';
        html += '<span style="font-size:0.78rem;color:#666;">' + escapeHtml(v.setor_nome) + ' - Leito ' + escapeHtml(v.leito) + ' | ' + escapeHtml(v.dupla_nome) + '</span>';
        if (v.nr_atendimento) html += '<br><span style="font-size:0.78rem;color:#666;">Atend: ' + escapeHtml(v.nr_atendimento) + '</span>';
        html += '<br><span class="detalhe-resultado resultado-' + v.avaliacao_final + '">' + formatarResultado(v.avaliacao_final) + '</span></div>';
        if (v.categorias) {
            v.categorias.forEach(function (cat) {
                html += '<div class="detalhe-categoria"><div class="detalhe-cat-nome">' + escapeHtml(cat.icone || '') + ' ' + escapeHtml(cat.nome) + '</div>';
                cat.itens.forEach(function (item) {
                    html += '<div class="detalhe-item"><span class="detalhe-item-desc">' + escapeHtml(item.descricao) + '</span>';
                    html += '<span class="detalhe-resultado resultado-' + item.resultado + '">' + formatarResultado(item.resultado) + '</span></div>';
                });
                html += '</div>';
            });
        }
        if (v.observacoes) html += '<div class="detalhe-secao"><div class="detalhe-secao-titulo"><i class="fas fa-comment-dots"></i> Observacoes</div><div class="detalhe-obs">' + escapeHtml(v.observacoes) + '</div></div>';
        if (v.imagens && v.imagens.length > 0) {
            html += '<div class="detalhe-secao"><div class="detalhe-secao-titulo"><i class="fas fa-camera"></i> Imagens</div><div class="detalhe-imagens">';
            v.imagens.forEach(function (img) { html += '<div class="detalhe-img" onclick="window.open(\'' + escapeAttr(img.url) + '\',\'_blank\')"><img src="' + escapeAttr(img.url) + '"></div>'; });
            html += '</div></div>';
        }
        body.innerHTML = html;
    }

    // ========================================
    // CONCLUIR RONDA
    // ========================================

    function configurarModais() {
        var els = {
            'btn-modal-fechar-concluir': function () { fecharModal('modal-concluir'); },
            'btn-cancelar-concluir': function () { fecharModal('modal-concluir'); },
            'btn-confirmar-concluir': function () { concluirRonda(); },
            'btn-modal-fechar-detalhe': function () { fecharModal('modal-detalhe'); },
            'btn-fechar-detalhe': function () { fecharModal('modal-detalhe'); },
            'btn-modal-fechar-fila': function () { fecharModal('modal-fila'); },
            'btn-fechar-fila': function () { fecharModal('modal-fila'); }
        };
        for (var id in els) {
            var el = document.getElementById(id);
            if (el) el.addEventListener('click', els[id]);
        }
        var modais = document.querySelectorAll('.modal-overlay');
        for (var i = 0; i < modais.length; i++) {
            modais[i].addEventListener('click', function (e) { if (e.target === this) this.classList.remove('ativo'); });
        }
        document.addEventListener('keydown', function (e) {
            if (e.key === 'Escape') {
                var ativos = document.querySelectorAll('.modal-overlay.ativo');
                for (var j = 0; j < ativos.length; j++) ativos[j].classList.remove('ativo');
            }
        });
    }

    function abrirModalConcluir() {
        var r = document.getElementById('modal-concluir-resumo');
        if (r) r.innerHTML = '<strong>Ronda #' + estado.rondaId + '</strong> | Data: ' + formatarData(estado.dataRonda);
        abrirModal('modal-concluir');
    }

    function concluirRonda() {
        fetch(CONFIG.apiRondas + '/' + estado.rondaId + '/concluir', { method: 'PUT', headers: { 'Content-Type': 'application/json' } })
            .then(function (r) { return r.json(); })
            .then(function (d) {
                if (d.success) {
                    mostrarToast('Ronda concluida!', 'sucesso');
                    fecharModal('modal-concluir');
                    estado.rondaId = null;
                    mostrarTela('ronda');
                    var el = document.getElementById('visitas-resumo');
                    if (el) el.style.display = 'none';
                } else { mostrarToast(d.error || 'Erro', 'erro'); }
            }).catch(function () { mostrarToast('Erro de comunicacao', 'erro'); });
    }

    // ========================================
    // GERENCIAR DUPLAS
    // ========================================

    function configurarGerenciarDuplas() {
        var btnAbrir = document.getElementById('btn-gerenciar-duplas');
        if (btnAbrir) btnAbrir.addEventListener('click', function () { abrirModal('modal-duplas'); carregarDuplasGerenciar(); });
        var btnF1 = document.getElementById('btn-modal-fechar-duplas');
        if (btnF1) btnF1.addEventListener('click', function () { fecharModal('modal-duplas'); });
        var btnF2 = document.getElementById('btn-fechar-duplas');
        if (btnF2) btnF2.addEventListener('click', function () { fecharModal('modal-duplas'); });
        var btnAdd = document.getElementById('btn-add-dupla');
        if (btnAdd) btnAdd.addEventListener('click', function () {
            var n1 = (document.getElementById('g-dupla-nome1').value || '').trim();
            var n2 = (document.getElementById('g-dupla-nome2').value || '').trim();
            if (!n1 || !n2) { mostrarToast('Informe os dois nomes', 'erro'); return; }
            fetch(CONFIG.apiDuplas, { method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ nome_visitante_1: n1, nome_visitante_2: n2 }) })
                .then(function (r) { return r.json(); })
                .then(function (d) {
                    if (d.success) { mostrarToast('Dupla adicionada', 'sucesso'); document.getElementById('g-dupla-nome1').value = ''; document.getElementById('g-dupla-nome2').value = ''; carregarDuplasGerenciar(); recarregarDuplas(); }
                    else mostrarToast(d.error || 'Erro', 'erro');
                }).catch(function () { mostrarToast('Erro', 'erro'); });
        });
    }

    function carregarDuplasGerenciar() {
        var lista = document.getElementById('duplas-lista');
        if (!lista) return;
        lista.innerHTML = '<div class="loading"><div class="loading-spinner"></div></div>';
        fetch(CONFIG.apiDuplas + '?todas=1').then(function (r) { return r.json(); })
            .then(function (d) { if (d.success) renderizarDuplasGerenciar(d.data || []); })
            .catch(function () { lista.innerHTML = '<p style="text-align:center;color:#999;padding:20px;">Erro</p>'; });
    }

    function renderizarDuplasGerenciar(duplas) {
        var lista = document.getElementById('duplas-lista');
        if (!lista) return;
        if (duplas.length === 0) { lista.innerHTML = '<p style="text-align:center;color:#999;padding:20px;">Nenhuma dupla</p>'; return; }
        lista.innerHTML = duplas.map(function (d) {
            var cls = d.ativo ? 'dupla-item' : 'dupla-item dupla-inativa';
            return '<div class="' + cls + '" data-id="' + d.id + '">' +
                '<div class="dupla-info"><strong>' + escapeHtml(d.nome_visitante_1) + '</strong><span class="dupla-e">e</span><strong>' + escapeHtml(d.nome_visitante_2) + '</strong>' +
                (!d.ativo ? ' <span class="dupla-tag-inativa">inativa</span>' : '') + '</div>' +
                '<div class="dupla-acoes">' +
                '<button class="g-btn g-btn-editar" onclick="window.FORM.editarDupla(' + d.id + ',\'' + escapeAttr(d.nome_visitante_1) + '\',\'' + escapeAttr(d.nome_visitante_2) + '\')"><i class="fas fa-edit"></i></button>' +
                '<button class="g-btn g-btn-toggle ' + (d.ativo ? 'ativo' : '') + '" onclick="window.FORM.toggleDupla(' + d.id + ')"><i class="fas fa-' + (d.ativo ? 'toggle-on' : 'toggle-off') + '"></i></button>' +
                '</div></div>';
        }).join('');
    }

    function editarDupla(id, n1, n2) {
        var item = document.querySelector('.dupla-item[data-id="' + id + '"]');
        if (!item) return;
        item.querySelector('.dupla-info').innerHTML =
            '<input type="text" value="' + escapeAttr(n1) + '" id="ge-n1-' + id + '" style="flex:1;padding:4px 8px;border:2px solid #ffc107;border-radius:4px;font-size:0.78rem;">' +
            '<span class="dupla-e">e</span>' +
            '<input type="text" value="' + escapeAttr(n2) + '" id="ge-n2-' + id + '" style="flex:1;padding:4px 8px;border:2px solid #ffc107;border-radius:4px;font-size:0.78rem;">';
        item.querySelector('.dupla-acoes').innerHTML =
            '<button class="g-btn g-btn-salvar" onclick="window.FORM.salvarDupla(' + id + ')"><i class="fas fa-check"></i></button>' +
            '<button class="g-btn g-btn-cancelar-edit" onclick="window.FORM.carregarDuplasG()"><i class="fas fa-times"></i></button>';
    }

    function salvarDupla(id) {
        var n1 = (document.getElementById('ge-n1-' + id).value || '').trim();
        var n2 = (document.getElementById('ge-n2-' + id).value || '').trim();
        if (!n1 || !n2) { mostrarToast('Informe os dois nomes', 'erro'); return; }
        fetch(CONFIG.apiDuplas + '/' + id, { method: 'PUT', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ nome_visitante_1: n1, nome_visitante_2: n2 }) })
            .then(function (r) { return r.json(); })
            .then(function (d) { if (d.success) { mostrarToast('Atualizada', 'sucesso'); carregarDuplasGerenciar(); recarregarDuplas(); } else mostrarToast(d.error, 'erro'); })
            .catch(function () { mostrarToast('Erro', 'erro'); });
    }

    function toggleDupla(id) {
        fetch(CONFIG.apiDuplas + '/' + id + '/toggle', { method: 'PUT' })
            .then(function (r) { return r.json(); })
            .then(function (d) { if (d.success) { mostrarToast(d.message, 'sucesso'); carregarDuplasGerenciar(); recarregarDuplas(); } else mostrarToast(d.error, 'erro'); })
            .catch(function () { mostrarToast('Erro', 'erro'); });
    }

    function recarregarDuplas() {
        fetch(CONFIG.apiDuplas).then(function (r) { return r.json(); })
            .then(function (d) { if (d.success) { estado.duplas = d.data || []; popularDuplas(); } }).catch(function () { });
    }

    // ========================================
    // LIMPAR FORMULARIO
    // ========================================

    function limparFormularioVisita() {
        var obs = document.getElementById('input-observacoes');
        if (obs) obs.value = '';
        var count = document.getElementById('count-obs');
        if (count) count.textContent = '0';
        limparRespostasCategorias();
        estado.imagensParaEnviar = [];
        renderizarPreviews();
        // Sair do modo de edicao
        estado.editandoVisitaId = null;
        var bar = document.getElementById('edit-mode-bar');
        if (bar) bar.style.display = 'none';
        var btnEnviar = document.getElementById('btn-enviar-visita');
        if (btnEnviar) btnEnviar.innerHTML = '<i class="fas fa-paper-plane"></i> Registrar Visita';
        // Reabilitar upload de imagens
        var uploadArea = document.getElementById('upload-area');
        if (uploadArea) uploadArea.style.display = '';
    }

    // ========================================
    // CONTADORES
    // ========================================

    function configurarContadores() {
        var obs = document.getElementById('input-observacoes');
        if (obs) obs.addEventListener('input', function () {
            var c = document.getElementById('count-obs');
            if (c) c.textContent = this.value.length;
            salvarRascunho();
        });
    }

    // ========================================
    // UTILITARIOS
    // ========================================

    function abrirModal(id) { var m = document.getElementById(id); if (m) m.classList.add('ativo'); }
    function fecharModal(id) { var m = document.getElementById(id); if (m) m.classList.remove('ativo'); }
    function setTexto(id, t) { var el = document.getElementById(id); if (el) el.textContent = t; }
    function formatarData(s) { if (!s) return '--'; var p = s.split('-'); return p.length === 3 ? p[2] + '/' + p[1] + '/' + p[0] : s; }
    function formatarResultado(r) { return { 'critico': 'Critico', 'atencao': 'Atencao', 'adequado': 'Adequado', 'nao_aplica': 'N/A', 'sim': 'Sim', 'nao': 'Nao', 'impossibilitada': 'Impossibilitada' }[r] || r; }
    function escapeHtml(t) { if (!t) return ''; var d = document.createElement('div'); d.textContent = t; return d.innerHTML; }
    function escapeAttr(t) { if (!t) return ''; return t.replace(/&/g, '&amp;').replace(/'/g, '&#39;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

    function mostrarToast(msg, tipo) {
        var c = document.getElementById('toast-container');
        if (!c) return;
        var t = document.createElement('div');
        t.className = 'toast toast-' + (tipo || 'info');
        var ic = tipo === 'sucesso' ? '<i class="fas fa-check-circle"></i>' : tipo === 'erro' ? '<i class="fas fa-times-circle"></i>' : '<i class="fas fa-info-circle"></i>';
        t.innerHTML = ic + ' ' + escapeHtml(msg);
        c.appendChild(t);
        setTimeout(function () { if (t.parentNode) t.parentNode.removeChild(t); }, 4000);
    }

    // ========================================
    // EXPOR FUNCOES GLOBAIS
    // ========================================

    window.FORM = {
        selecionarSemaforo: selecionarSemaforo,
        abrirDetalhe: abrirDetalhe,
        editarDupla: editarDupla,
        salvarDupla: salvarDupla,
        toggleDupla: toggleDupla,
        carregarDuplasG: carregarDuplasGerenciar,
        retomarRonda: retomarRonda,
        finalizarRondaEmAndamento: finalizarRondaEmAndamento,
        excluirVisitaAndamento: excluirVisitaAndamento,
        excluirVisitaSessao: excluirVisitaSessao,
        editarVisita: editarVisita,
        cancelarEdicao: cancelarEdicao
    };

    if (document.readyState === 'loading') { document.addEventListener('DOMContentLoaded', inicializar); }
    else { inicializar(); }
})();