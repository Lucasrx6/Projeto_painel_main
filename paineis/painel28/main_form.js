// ========================================
// PAINEL 28 - FORMULARIO SENTIR E AGIR
// Hospital Anchieta Ceilandia
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
        apiProximoPaciente: BASE_URL + '/api/paineis/painel28/proximo-paciente'
    };

    var estado = {
        rondaId: null,
        duplaId: null,
        dataRonda: null,
        duplas: [],
        setores: [],
        categorias: [],
        avaliacaoFinal: null,
        imagensParaEnviar: [],
        enviando: false,
        configServidor: {}
    };

    // ========================================
    // INICIALIZACAO
    // ========================================

    function inicializar() {
        console.log('Inicializando Formulario Sentir e Agir...');

        configurarNavegacao();
        configurarFormulario();
        configurarConfirmacao();
        configurarResumo();
        configurarModais();
        configurarUpload();
        configurarContadores();
        configurarMascaraData();
        configurarGerenciarDuplas();
        carregarDadosIniciais();

        // Data padrao: hoje em dd/mm/aaaa
        var inputData = document.getElementById('input-data-ronda');
        if (inputData) {
            var hoje = new Date();
            inputData.value = String(hoje.getDate()).padStart(2, '0') + '/' +
                String(hoje.getMonth() + 1).padStart(2, '0') + '/' +
                hoje.getFullYear();
        }

        console.log('Formulario inicializado');
    }

    // ========================================
    // MASCARA DE DATA DD/MM/AAAA
    // ========================================

    function configurarMascaraData() {
        var input = document.getElementById('input-data-ronda');
        if (!input) return;

        input.addEventListener('input', function () {
            var val = this.value.replace(/\D/g, '');
            if (val.length > 8) val = val.substring(0, 8);

            var formatado = '';
            if (val.length > 0) formatado = val.substring(0, Math.min(2, val.length));
            if (val.length > 2) formatado += '/' + val.substring(2, Math.min(4, val.length));
            if (val.length > 4) formatado += '/' + val.substring(4, 8);

            this.value = formatado;
        });

        input.addEventListener('keydown', function (e) {
            // Permitir backspace, delete, tab, escape, setas
            var permitidas = [8, 9, 27, 46, 37, 38, 39, 40];
            if (permitidas.indexOf(e.keyCode) !== -1) return;
            // Permitir Ctrl+A, Ctrl+C, Ctrl+V
            if ((e.ctrlKey || e.metaKey) && [65, 67, 86].indexOf(e.keyCode) !== -1) return;
            // Permitir numeros
            if ((e.keyCode >= 48 && e.keyCode <= 57) || (e.keyCode >= 96 && e.keyCode <= 105)) return;
            e.preventDefault();
        });
    }

    function converterDataParaISO(dataBR) {
        // dd/mm/aaaa -> aaaa-mm-dd
        if (!dataBR || dataBR.length !== 10) return null;
        var partes = dataBR.split('/');
        if (partes.length !== 3) return null;
        var dia = parseInt(partes[0], 10);
        var mes = parseInt(partes[1], 10);
        var ano = parseInt(partes[2], 10);
        if (isNaN(dia) || isNaN(mes) || isNaN(ano)) return null;
        if (dia < 1 || dia > 31 || mes < 1 || mes > 12 || ano < 2020) return null;
        return ano + '-' + String(mes).padStart(2, '0') + '-' + String(dia).padStart(2, '0');
    }

    // ========================================
    // CARREGAR DADOS INICIAIS
    // ========================================

    function carregarDadosIniciais() {
        Promise.all([
            fetch(CONFIG.apiDuplas).then(function (r) { return r.json(); }),
            fetch(CONFIG.apiCategorias).then(function (r) { return r.json(); }),
            fetch(CONFIG.apiConfig).then(function (r) { return r.json(); })
        ]).then(function (resultados) {
            if (resultados[0].success) {
                estado.duplas = resultados[0].data || [];
                popularDuplas();
            }
            if (resultados[1].success) {
                estado.categorias = resultados[1].data || [];
                renderizarCategorias();
            }
            if (resultados[2].success) {
                estado.configServidor = resultados[2].data || {};
                aplicarConfig();
            }
        }).catch(function (err) {
            console.error('Erro ao carregar dados iniciais:', err);
            mostrarToast('Erro ao carregar dados', 'erro');
        });
    }

    // ========================================
    // FILA AUTOMATICA DE PACIENTES
    // ========================================

    function carregarProximoPaciente() {
        var loadingEl = document.getElementById('paciente-loading');
        var dadosEl = document.getElementById('paciente-dados');
        var vazioEl = document.getElementById('paciente-vazio');

        if (loadingEl) loadingEl.style.display = '';
        if (dadosEl) dadosEl.style.display = 'none';
        if (vazioEl) vazioEl.style.display = 'none';

        fetch(CONFIG.apiProximoPaciente)
            .then(function (r) { return r.json(); })
            .then(function (d) {
                if (loadingEl) loadingEl.style.display = 'none';
                if (!d.success) {
                    mostrarToast(d.error || 'Erro ao buscar paciente', 'erro');
                    return;
                }
                if (!d.data) {
                    if (vazioEl) vazioEl.style.display = '';
                    return;
                }
                var pac = d.data;

                // Preencher inputs hidden para envio
                var elSetorId = document.getElementById('input-setor-id');
                var elLeito = document.getElementById('input-leito');
                var elAtend = document.getElementById('input-atendimento');
                if (elSetorId) elSetorId.value = pac.setor_id || '';
                if (elLeito) elLeito.value = pac.cd_leito || '';
                if (elAtend) elAtend.value = pac.nr_atendimento || '';

                // Preencher displays
                var setDisplay = function (id, val) { var el = document.getElementById(id); if (el) el.textContent = val || '--'; };
                setDisplay('display-setor', pac.nm_setor);
                setDisplay('display-leito', pac.cd_leito);
                setDisplay('display-paciente', pac.nm_paciente);
                setDisplay('display-atendimento', pac.nr_atendimento);

                if (dadosEl) dadosEl.style.display = '';
            })
            .catch(function (err) {
                console.error('Erro ao buscar próximo paciente:', err);
                if (loadingEl) loadingEl.style.display = 'none';
                if (vazioEl) {
                    vazioEl.style.display = '';
                    vazioEl.querySelector('p') && (vazioEl.querySelector('p').textContent = 'Erro ao buscar paciente. Tente novamente.');
                }
                mostrarToast('Erro ao buscar próximo paciente', 'erro');
            });
    }

    function popularDuplas() {
        var select = document.getElementById('select-dupla');
        if (!select) return;
        select.innerHTML = '<option value="">Selecione a dupla...</option>';
        estado.duplas.forEach(function (d) {
            var opt = document.createElement('option');
            opt.value = d.id;
            opt.textContent = d.nome_visitante_1 + ' e ' + d.nome_visitante_2;
            select.appendChild(opt);
        });
    }

    function popularSetores() {
        var select = document.getElementById('select-setor');
        if (!select) return;
        select.innerHTML = '<option value="">Selecione...</option>';
        estado.setores.forEach(function (s) {
            var opt = document.createElement('option');
            opt.value = s.id;
            opt.textContent = s.nome;
            select.appendChild(opt);
        });
    }

    function aplicarConfig() {
        var maxImg = estado.configServidor.max_imagens_por_visita || '5';
        var limitEl = document.getElementById('upload-limite');
        if (limitEl) limitEl.textContent = 'Maximo: ' + maxImg + ' imagens';
    }

    // ========================================
    // GERENCIAR DUPLAS (CRUD)
    // ========================================

    function configurarGerenciarDuplas() {
        var btnAbrir = document.getElementById('btn-gerenciar-duplas');
        if (btnAbrir) {
            btnAbrir.addEventListener('click', function () {
                abrirModal('modal-duplas');
                carregarDuplasGerenciar();
            });
        }

        var btnFechar = document.getElementById('btn-modal-fechar-duplas');
        if (btnFechar) btnFechar.addEventListener('click', function () { fecharModal('modal-duplas'); });

        var btnFecharBottom = document.getElementById('btn-fechar-duplas');
        if (btnFecharBottom) btnFecharBottom.addEventListener('click', function () { fecharModal('modal-duplas'); });

        var btnAdd = document.getElementById('btn-add-dupla');
        if (btnAdd) {
            btnAdd.addEventListener('click', function () {
                var nome1 = (document.getElementById('g-dupla-nome1').value || '').trim();
                var nome2 = (document.getElementById('g-dupla-nome2').value || '').trim();
                if (!nome1 || !nome2) {
                    mostrarToast('Informe os dois nomes', 'erro');
                    return;
                }
                fetch(CONFIG.apiDuplas, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ nome_visitante_1: nome1, nome_visitante_2: nome2 })
                })
                .then(function (r) { return r.json(); })
                .then(function (d) {
                    if (d.success) {
                        mostrarToast('Dupla adicionada', 'sucesso');
                        document.getElementById('g-dupla-nome1').value = '';
                        document.getElementById('g-dupla-nome2').value = '';
                        carregarDuplasGerenciar();
                        recarregarDuplas();
                    } else {
                        mostrarToast(d.error || 'Erro', 'erro');
                    }
                })
                .catch(function () { mostrarToast('Erro de comunicacao', 'erro'); });
            });
        }
    }

    function carregarDuplasGerenciar() {
        var lista = document.getElementById('duplas-lista');
        if (!lista) return;
        lista.innerHTML = '<div class="loading"><div class="loading-spinner"></div></div>';

        fetch(CONFIG.apiDuplas + '?todas=1')
            .then(function (r) { return r.json(); })
            .then(function (d) {
                if (d.success) {
                    renderizarDuplasGerenciar(d.data || []);
                }
            })
            .catch(function () {
                lista.innerHTML = '<p style="text-align:center;color:#999;padding:20px;">Erro ao carregar</p>';
            });
    }

    function renderizarDuplasGerenciar(duplas) {
        var lista = document.getElementById('duplas-lista');
        if (!lista) return;

        if (duplas.length === 0) {
            lista.innerHTML = '<p style="text-align:center;color:#999;padding:20px;">Nenhuma dupla cadastrada</p>';
            return;
        }

        lista.innerHTML = duplas.map(function (d) {
            var cls = d.ativo ? 'dupla-item' : 'dupla-item dupla-inativa';
            var html = '<div class="' + cls + '" data-id="' + d.id + '">';
            html += '<div class="dupla-info">';
            html += '  <strong>' + escapeHtml(d.nome_visitante_1) + '</strong>';
            html += '  <span class="dupla-e">e</span>';
            html += '  <strong>' + escapeHtml(d.nome_visitante_2) + '</strong>';
            if (!d.ativo) html += ' <span class="dupla-tag-inativa">inativa</span>';
            html += '</div>';
            html += '<div class="dupla-acoes">';
            html += '  <button class="g-btn g-btn-editar" onclick="window.FORM.editarDupla(' + d.id + ',\'' + escapeAttr(d.nome_visitante_1) + '\',\'' + escapeAttr(d.nome_visitante_2) + '\')"><i class="fas fa-edit"></i></button>';
            html += '  <button class="g-btn g-btn-toggle ' + (d.ativo ? 'ativo' : '') + '" onclick="window.FORM.toggleDupla(' + d.id + ')" title="' + (d.ativo ? 'Desativar' : 'Reativar') + '"><i class="fas fa-' + (d.ativo ? 'toggle-on' : 'toggle-off') + '"></i></button>';
            html += '</div></div>';
            return html;
        }).join('');
    }

    function editarDupla(id, nome1, nome2) {
        var item = document.querySelector('.dupla-item[data-id="' + id + '"]');
        if (!item) return;

        var infoDiv = item.querySelector('.dupla-info');
        var acoesDiv = item.querySelector('.dupla-acoes');
        if (!infoDiv || !acoesDiv) return;

        infoDiv.innerHTML =
            '<input type="text" value="' + escapeAttr(nome1) + '" id="ge-nome1-' + id + '" placeholder="Visitante 1" style="flex:1;padding:4px 8px;border:2px solid #ffc107;border-radius:4px;font-size:0.78rem;">' +
            '<span class="dupla-e">e</span>' +
            '<input type="text" value="' + escapeAttr(nome2) + '" id="ge-nome2-' + id + '" placeholder="Visitante 2" style="flex:1;padding:4px 8px;border:2px solid #ffc107;border-radius:4px;font-size:0.78rem;">';

        acoesDiv.innerHTML =
            '<button class="g-btn g-btn-salvar" onclick="window.FORM.salvarDupla(' + id + ')"><i class="fas fa-check"></i></button>' +
            '<button class="g-btn g-btn-cancelar-edit" onclick="window.FORM.carregarDuplasG()"><i class="fas fa-times"></i></button>';
    }

    function salvarDupla(id) {
        var nome1 = (document.getElementById('ge-nome1-' + id).value || '').trim();
        var nome2 = (document.getElementById('ge-nome2-' + id).value || '').trim();
        if (!nome1 || !nome2) {
            mostrarToast('Informe os dois nomes', 'erro');
            return;
        }

        fetch(CONFIG.apiDuplas + '/' + id, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ nome_visitante_1: nome1, nome_visitante_2: nome2 })
        })
        .then(function (r) { return r.json(); })
        .then(function (d) {
            if (d.success) {
                mostrarToast('Dupla atualizada', 'sucesso');
                carregarDuplasGerenciar();
                recarregarDuplas();
            } else {
                mostrarToast(d.error || 'Erro', 'erro');
            }
        })
        .catch(function () { mostrarToast('Erro de comunicacao', 'erro'); });
    }

    function toggleDupla(id) {
        fetch(CONFIG.apiDuplas + '/' + id + '/toggle', {
            method: 'PUT'
        })
        .then(function (r) { return r.json(); })
        .then(function (d) {
            if (d.success) {
                mostrarToast(d.message || 'Status alterado', 'sucesso');
                carregarDuplasGerenciar();
                recarregarDuplas();
            } else {
                mostrarToast(d.error || 'Erro', 'erro');
            }
        })
        .catch(function () { mostrarToast('Erro de comunicacao', 'erro'); });
    }

    function recarregarDuplas() {
        fetch(CONFIG.apiDuplas)
            .then(function (r) { return r.json(); })
            .then(function (d) {
                if (d.success) {
                    estado.duplas = d.data || [];
                    popularDuplas();
                }
            })
            .catch(function () {});
    }

    // ========================================
    // RENDERIZAR CATEGORIAS COM SEMAFOROS
    // ========================================

    function renderizarCategorias() {
        var container = document.getElementById('categorias-container');
        if (!container) return;

        container.innerHTML = estado.categorias.map(function (cat) {
            var corHeader = cat.cor || '#dc3545';
            var html = '<div class="form-card" data-categoria-id="' + cat.id + '">';
            html += '<div class="form-card-header" style="background: ' + escapeAttr(corHeader) + ';">';
            html += '  ' + escapeHtml(cat.icone || '') + ' ' + escapeHtml(cat.nome);
            html += '</div>';
            html += '<div class="form-card-body">';

            cat.itens.forEach(function (item) {
                html += '<div class="item-avaliacao" data-item-id="' + item.id + '">';
                html += '  <div class="item-descricao">' + escapeHtml(item.descricao) + '</div>';

                if (item.tipo_resposta === 'sim_nao') {
                    // Botoes Sim/Nao: SIM = adequado, NAO = atencao
                    html += '  <div class="item-semaforo item-simnao">';
                    html += '    <button type="button" class="btn-semaforo btn-simnao sim" data-item="' + item.id + '" data-valor="adequado" onclick="window.FORM.selecionarSemaforo(this)">';
                    html += '      <i class="fas fa-check"></i> Sim';
                    html += '    </button>';
                    html += '    <button type="button" class="btn-semaforo btn-simnao nao" data-item="' + item.id + '" data-valor="atencao" onclick="window.FORM.selecionarSemaforo(this)">';
                    html += '      <i class="fas fa-times"></i> Não';
                    html += '    </button>';
                    html += '  </div>';
                } else {
                    html += '  <div class="item-semaforo">';
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
                    html += '  </div>';
                }

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
            botoes[i].classList.remove('selecionado');
        }
        btn.classList.add('selecionado');
        calcularAvaliacaoFinal();
    }

    // ========================================
    // AVALIACAO FINAL AUTOMATICA
    // ========================================

    function calcularAvaliacaoFinal() {
        var itens = document.querySelectorAll('.item-avaliacao');
        var temCritico = false, temAtencao = false, todosRespondidos = (itens.length > 0);

        for (var i = 0; i < itens.length; i++) {
            var sel = itens[i].querySelector('.btn-semaforo.selecionado');
            if (!sel) { todosRespondidos = false; continue; }
            var val = sel.getAttribute('data-valor');
            if (val === 'critico') temCritico = true;
            else if (val === 'atencao') temAtencao = true;
        }

        var pendente = document.getElementById('avaliacao-auto-pendente');
        var resultado = document.getElementById('avaliacao-auto-resultado');
        var badge = document.getElementById('avaliacao-auto-badge');

        if (!todosRespondidos) {
            estado.avaliacaoFinal = null;
            if (pendente) pendente.style.display = '';
            if (resultado) resultado.style.display = 'none';
            return;
        }

        if (temCritico) {
            estado.avaliacaoFinal = 'critico';
        } else if (temAtencao) {
            estado.avaliacaoFinal = 'atencao';
        } else {
            estado.avaliacaoFinal = 'adequado';
        }

        if (pendente) pendente.style.display = 'none';
        if (resultado) resultado.style.display = '';
        if (badge) {
            badge.className = 'btn-semaforo-final ' + estado.avaliacaoFinal;
            badge.innerHTML = '<i class="fas fa-circle"></i> ' + formatarResultado(estado.avaliacaoFinal);
        }
    }

    // ========================================
    // NAVEGACAO ENTRE TELAS
    // ========================================

    function configurarNavegacao() {
        var btnVoltar = document.getElementById('btn-voltar');
        if (btnVoltar) {
            btnVoltar.addEventListener('click', function () {
                window.location.href = '/painel/painel28';
            });
        }

        var btnGestao = document.getElementById('btn-gestao');
        if (btnGestao) {
            btnGestao.addEventListener('click', function () {
                window.location.href = '/painel/painel29';
            });
        }
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
        if (btnIniciar) {
            btnIniciar.addEventListener('click', function () {
                iniciarRonda();
            });
        }

        var btnVoltarRonda = document.getElementById('btn-voltar-ronda');
        if (btnVoltarRonda) {
            btnVoltarRonda.addEventListener('click', function () {
                mostrarTela('ronda');
            });
        }

        var form = document.getElementById('form-visita');
        if (form) {
            form.addEventListener('submit', function (e) {
                e.preventDefault();
                enviarVisita();
            });
        }
    }

    function iniciarRonda() {
        var duplaId = document.getElementById('select-dupla').value;
        var dataBR = document.getElementById('input-data-ronda').value;

        if (!duplaId) {
            mostrarToast('Selecione a dupla de visitantes', 'erro');
            return;
        }
        if (!dataBR || dataBR.length !== 10) {
            mostrarToast('Informe a data no formato dd/mm/aaaa', 'erro');
            return;
        }

        var dataISO = converterDataParaISO(dataBR);
        if (!dataISO) {
            mostrarToast('Data invalida', 'erro');
            return;
        }

        var btnIniciar = document.getElementById('btn-iniciar-ronda');
        if (btnIniciar) {
            btnIniciar.disabled = true;
            btnIniciar.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Iniciando...';
        }

        fetch(CONFIG.apiRondas, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ dupla_id: parseInt(duplaId), data_ronda: dataISO })
        })
        .then(function (res) { return res.json(); })
        .then(function (data) {
            if (data.success) {
                estado.rondaId = data.data.id;
                estado.duplaId = parseInt(duplaId);
                estado.dataRonda = dataISO;

                var badge = document.getElementById('ronda-info-badge');
                if (badge) {
                    badge.textContent = 'Ronda #' + estado.rondaId;
                }

                if (data.data.existente) {
                    mostrarToast('Ronda existente carregada', 'info');
                    carregarVisitasRonda();
                } else {
                    mostrarToast('Ronda criada com sucesso', 'sucesso');
                }

                limparFormularioVisita();
                mostrarTela('formulario');
                carregarProximoPaciente();
            } else {
                var msg = data.error || (data.errors ? data.errors[0] : 'Erro ao criar ronda');
                mostrarToast(msg, 'erro');
            }
        })
        .catch(function (err) {
            console.error('Erro:', err);
            mostrarToast('Erro de comunicacao', 'erro');
        })
        .finally(function () {
            if (btnIniciar) {
                btnIniciar.disabled = false;
                btnIniciar.innerHTML = '<i class="fas fa-play-circle"></i> Iniciar Ronda';
            }
        });
    }

    // ========================================
    // ENVIAR VISITA
    // ========================================

    function enviarVisita() {
        if (estado.enviando) return;

        var setorId = document.getElementById('input-setor-id').value;
        var leito = (document.getElementById('input-leito').value || '').trim();
        var nrAtendimento = (document.getElementById('input-atendimento').value || '').trim();
        var observacoes = (document.getElementById('input-observacoes').value || '').trim();

        var erros = [];
        if (!setorId) erros.push('Dados do paciente não carregados. Aguarde o preenchimento automático.');
        if (!leito) erros.push('Leito não disponível. Aguarde o preenchimento automático.');
        if (!estado.avaliacaoFinal) erros.push('Avalie todos os itens para calcular a nota final automaticamente');

        var avaliacoes = [];
        var todosItens = document.querySelectorAll('.item-avaliacao');
        var itensSemResposta = [];

        for (var i = 0; i < todosItens.length; i++) {
            var itemEl = todosItens[i];
            var itemId = itemEl.getAttribute('data-item-id');
            var selecionado = itemEl.querySelector('.btn-semaforo.selecionado');

            if (!selecionado) {
                var descEl = itemEl.querySelector('.item-descricao');
                itensSemResposta.push(descEl ? descEl.textContent : 'Item ' + itemId);
            } else {
                avaliacoes.push({
                    item_id: parseInt(itemId),
                    resultado: selecionado.getAttribute('data-valor')
                });
            }
        }

        if (itensSemResposta.length > 0) {
            erros.push('Avalie todos os itens. Faltam: ' + itensSemResposta.length + ' item(ns)');
        }

        if (erros.length > 0) {
            mostrarToast(erros[0], 'erro');
            if (itensSemResposta.length > 0) {
                var primeiroSemResposta = null;
                for (var k = 0; k < todosItens.length; k++) {
                    if (!todosItens[k].querySelector('.btn-semaforo.selecionado')) {
                        primeiroSemResposta = todosItens[k];
                        break;
                    }
                }
                if (primeiroSemResposta) {
                    primeiroSemResposta.scrollIntoView({ behavior: 'smooth', block: 'center' });
                }
            }
            return;
        }

        estado.enviando = true;
        var btnEnviar = document.getElementById('btn-enviar-visita');
        if (btnEnviar) {
            btnEnviar.disabled = true;
            btnEnviar.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Registrando...';
        }

        var payload = {
            ronda_id: estado.rondaId,
            setor_id: parseInt(setorId),
            leito: leito,
            nr_atendimento: nrAtendimento || null,
            observacoes: observacoes || null,
            avaliacao_final: estado.avaliacaoFinal,
            avaliacoes: avaliacoes
        };

        var setorTexto = (document.getElementById('display-setor').textContent || '').trim();

        fetch(CONFIG.apiVisitas, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        })
        .then(function (res) { return res.json(); })
        .then(function (data) {
            if (data.success) {
                var visitaId = data.data.id;
                if (estado.imagensParaEnviar.length > 0) {
                    enviarImagensSequencial(visitaId, 0, function () {
                        exibirConfirmacao(visitaId, setorTexto, leito, avaliacoes);
                    });
                } else {
                    exibirConfirmacao(visitaId, setorTexto, leito, avaliacoes);
                }
            } else {
                var msg = data.error || (data.errors ? data.errors[0] : 'Erro ao registrar');
                mostrarToast(msg, 'erro');
            }
        })
        .catch(function (err) {
            console.error('Erro:', err);
            mostrarToast('Erro de comunicacao', 'erro');
        })
        .finally(function () {
            estado.enviando = false;
            if (btnEnviar) {
                btnEnviar.disabled = false;
                btnEnviar.innerHTML = '<i class="fas fa-paper-plane"></i> Registrar Visita';
            }
        });
    }

    // ========================================
    // UPLOAD DE IMAGENS
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
                    if (estado.imagensParaEnviar.length >= maxImg) {
                        mostrarToast('Limite de ' + maxImg + ' imagens atingido', 'erro');
                        break;
                    }
                    var arquivo = arquivos[i];
                    if (arquivo.size > maxMb * 1024 * 1024) {
                        mostrarToast('Imagem ' + arquivo.name + ' excede ' + maxMb + 'MB', 'erro');
                        continue;
                    }
                    estado.imagensParaEnviar.push(arquivo);
                }
                renderizarPreviews();
                this.value = '';
            });
        }
    }

    function renderizarPreviews() {
        var container = document.getElementById('preview-imagens');
        if (!container) return;
        container.innerHTML = '';
        estado.imagensParaEnviar.forEach(function (arquivo, index) {
            var div = document.createElement('div');
            div.className = 'preview-item';
            var img = document.createElement('img');
            img.src = URL.createObjectURL(arquivo);
            img.alt = arquivo.name;
            div.appendChild(img);
            var btnRemover = document.createElement('button');
            btnRemover.type = 'button';
            btnRemover.className = 'preview-remover';
            btnRemover.innerHTML = '<i class="fas fa-times"></i>';
            btnRemover.setAttribute('data-index', index);
            btnRemover.addEventListener('click', function () {
                estado.imagensParaEnviar.splice(parseInt(this.getAttribute('data-index')), 1);
                renderizarPreviews();
            });
            div.appendChild(btnRemover);
            container.appendChild(div);
        });
    }

    function enviarImagensSequencial(visitaId, index, callback) {
        if (index >= estado.imagensParaEnviar.length) { callback(); return; }
        var formData = new FormData();
        formData.append('visita_id', visitaId);
        formData.append('arquivo', estado.imagensParaEnviar[index]);
        fetch(CONFIG.apiImagens, { method: 'POST', body: formData })
            .then(function (r) { return r.json(); })
            .then(function () { enviarImagensSequencial(visitaId, index + 1, callback); })
            .catch(function () { enviarImagensSequencial(visitaId, index + 1, callback); });
    }

    // ========================================
    // CONFIRMACAO
    // ========================================

    function configurarConfirmacao() {
        var btnNovoLeito = document.getElementById('btn-novo-leito');
        if (btnNovoLeito) {
            btnNovoLeito.addEventListener('click', function () {
                limparFormularioVisita();
                mostrarTela('formulario');
                carregarProximoPaciente();
            });
        }
        var btnConcluir = document.getElementById('btn-concluir-ronda');
        if (btnConcluir) {
            btnConcluir.addEventListener('click', function () { abrirModalConcluir(); });
        }
        var btnVerResumo = document.getElementById('btn-ver-resumo');
        if (btnVerResumo) {
            btnVerResumo.addEventListener('click', function () {
                mostrarTela('resumo');
                carregarResumo();
            });
        }
    }

    function exibirConfirmacao(visitaId, setor, leito, avaliacoes) {
        var detalhes = document.getElementById('confirmacao-detalhes');
        if (detalhes) {
            var qtdC = 0, qtdA = 0, qtdAd = 0;
            avaliacoes.forEach(function (a) {
                if (a.resultado === 'critico') qtdC++;
                else if (a.resultado === 'atencao') qtdA++;
                else if (a.resultado === 'adequado') qtdAd++;
            });
            detalhes.innerHTML =
                '<strong>Leito:</strong> ' + escapeHtml(leito) + '<br>' +
                '<strong>Setor:</strong> ' + escapeHtml(setor) + '<br>' +
                '<strong>Avaliacao Final:</strong> ' + escapeHtml(formatarResultado(estado.avaliacaoFinal)) + '<br>' +
                '<strong>Itens avaliados:</strong> ' + avaliacoes.length + '<br>' +
                '<span style="color:#dc3545;">&#9679;</span> Criticos: ' + qtdC +
                ' | <span style="color:#ffc107;">&#9679;</span> Atencao: ' + qtdA +
                ' | <span style="color:#28a745;">&#9679;</span> Adequados: ' + qtdAd +
                (estado.imagensParaEnviar.length > 0 ? '<br><strong>Imagens:</strong> ' + estado.imagensParaEnviar.length : '');
        }
        if (navigator.vibrate) navigator.vibrate([100, 50, 100]);
        mostrarTela('confirmacao');
    }

    // ========================================
    // RESUMO DA RONDA
    // ========================================

    function configurarResumo() {
        var btnVoltarResumo = document.getElementById('btn-voltar-resumo');
        if (btnVoltarResumo) btnVoltarResumo.addEventListener('click', function () { mostrarTela('formulario'); });
        var btnRefresh = document.getElementById('btn-refresh-resumo');
        if (btnRefresh) btnRefresh.addEventListener('click', function () { carregarResumo(); mostrarToast('Atualizado', 'info'); });
        var btnAdicionar = document.getElementById('btn-adicionar-leito');
        if (btnAdicionar) btnAdicionar.addEventListener('click', function () { limparFormularioVisita(); mostrarTela('formulario'); carregarProximoPaciente(); });
        var btnConcluirResumo = document.getElementById('btn-concluir-ronda-resumo');
        if (btnConcluirResumo) btnConcluirResumo.addEventListener('click', function () { abrirModalConcluir(); });
    }

    function carregarResumo() {
        if (!estado.rondaId) return;
        fetch(CONFIG.apiRondas + '/' + estado.rondaId + '/visitas')
            .then(function (r) { return r.json(); })
            .then(function (d) { if (d.success) renderizarResumo(d.data || []); })
            .catch(function () {
                var lista = document.getElementById('resumo-lista');
                if (lista) lista.innerHTML = '<p style="text-align:center;color:#999;padding:20px;">Erro ao carregar</p>';
            });
    }

    function carregarVisitasRonda() {
        if (!estado.rondaId) return;
        fetch(CONFIG.apiRondas + '/' + estado.rondaId + '/visitas')
            .then(function (r) { return r.json(); })
            .then(function (d) { if (d.success && d.data && d.data.length > 0) renderizarVisitasMiniResumo(d.data); })
            .catch(function () {});
    }

    function renderizarVisitasMiniResumo(visitas) {
        var resumoEl = document.getElementById('visitas-resumo');
        var listaEl = document.getElementById('visitas-resumo-lista');
        var badgeEl = document.getElementById('badge-total-visitas');
        if (!resumoEl || !listaEl) return;
        resumoEl.style.display = 'block';
        if (badgeEl) badgeEl.textContent = visitas.length;
        listaEl.innerHTML = visitas.map(function (v) {
            return '<div class="visita-mini-card mini-' + v.avaliacao_final + '">' +
                '<span><strong>' + escapeHtml(v.setor_sigla || v.setor_nome) + ' - ' + escapeHtml(v.leito) + '</strong></span>' +
                '<span>' + escapeHtml(formatarResultado(v.avaliacao_final)) + '</span></div>';
        }).join('');
    }

    function renderizarResumo(visitas) {
        var lista = document.getElementById('resumo-lista');
        var vazio = document.getElementById('resumo-vazio');
        var total = visitas.length, criticos = 0, atencao = 0, adequados = 0;
        visitas.forEach(function (v) {
            if (v.avaliacao_final === 'critico') criticos++;
            else if (v.avaliacao_final === 'atencao') atencao++;
            else if (v.avaliacao_final === 'adequado') adequados++;
        });
        setTexto('kpi-total', total);
        setTexto('kpi-criticos', criticos);
        setTexto('kpi-atencao', atencao);
        setTexto('kpi-adequados', adequados);
        if (!lista) return;
        if (total === 0) { lista.innerHTML = ''; if (vazio) vazio.style.display = 'block'; return; }
        if (vazio) vazio.style.display = 'none';
        lista.innerHTML = visitas.map(function (v) {
            var html = '<div class="resumo-card avaliacao-' + v.avaliacao_final + '" onclick="window.FORM.abrirDetalhe(' + v.id + ')">';
            html += '<div class="resumo-card-header">';
            html += '  <span class="resumo-card-leito"><i class="fas fa-bed"></i> ' + escapeHtml(v.setor_sigla || v.setor_nome) + ' - ' + escapeHtml(v.leito) + '</span>';
            html += '  <span class="resumo-card-badge badge-' + v.avaliacao_final + '">' + escapeHtml(formatarResultado(v.avaliacao_final)) + '</span>';
            html += '</div><div class="resumo-card-body">';
            if (v.qtd_critico > 0) html += '<span class="resumo-card-stat stat-critico"><i class="fas fa-circle"></i> ' + v.qtd_critico + '</span>';
            if (v.qtd_atencao > 0) html += '<span class="resumo-card-stat stat-atencao"><i class="fas fa-circle"></i> ' + v.qtd_atencao + '</span>';
            if (v.qtd_adequado > 0) html += '<span class="resumo-card-stat stat-adequado"><i class="fas fa-circle"></i> ' + v.qtd_adequado + '</span>';
            if (v.qtd_imagens > 0) html += '<span class="resumo-card-stat stat-imagens"><i class="fas fa-camera"></i> ' + v.qtd_imagens + '</span>';
            html += '</div></div>';
            return html;
        }).join('');
    }

    // ========================================
    // DETALHE DE VISITA (MODAL)
    // ========================================

    function abrirDetalhe(visitaId) {
        var body = document.getElementById('modal-detalhe-body');
        if (body) body.innerHTML = '<div class="loading"><div class="loading-spinner"></div><p>Carregando...</p></div>';
        abrirModal('modal-detalhe');
        fetch(CONFIG.apiVisitas + '/' + visitaId)
            .then(function (r) { return r.json(); })
            .then(function (d) { if (d.success) renderizarDetalhe(d.data); else if (body) body.innerHTML = '<p style="color:#dc3545;">Erro ao carregar</p>'; })
            .catch(function () { if (body) body.innerHTML = '<p style="color:#dc3545;">Erro de comunicacao</p>'; });
    }

    function renderizarDetalhe(visita) {
        var body = document.getElementById('modal-detalhe-body');
        if (!body) return;
        var html = '<div style="margin-bottom:14px;">';
        html += '<strong>' + escapeHtml(visita.setor_nome) + ' - Leito ' + escapeHtml(visita.leito) + '</strong><br>';
        html += '<span style="font-size:0.78rem;color:#666;">' + escapeHtml(visita.dupla_nome) + ' | ' + formatarData(visita.data_ronda) + '</span>';
        if (visita.nr_atendimento) html += '<br><span style="font-size:0.78rem;color:#666;">Atendimento: ' + escapeHtml(visita.nr_atendimento) + '</span>';
        html += '<br><span class="detalhe-resultado resultado-' + visita.avaliacao_final + '">' + escapeHtml(formatarResultado(visita.avaliacao_final)) + '</span></div>';
        if (visita.categorias) {
            visita.categorias.forEach(function (cat) {
                html += '<div class="detalhe-categoria"><div class="detalhe-cat-nome">' + escapeHtml(cat.icone || '') + ' ' + escapeHtml(cat.nome) + '</div>';
                cat.itens.forEach(function (item) {
                    html += '<div class="detalhe-item"><span class="detalhe-item-desc">' + escapeHtml(item.descricao) + '</span>';
                    html += '<span class="detalhe-resultado resultado-' + item.resultado + '">' + escapeHtml(formatarResultado(item.resultado)) + '</span></div>';
                });
                html += '</div>';
            });
        }
        if (visita.observacoes) {
            html += '<div class="detalhe-secao"><div class="detalhe-secao-titulo"><i class="fas fa-comment-dots"></i> Observacoes</div>';
            html += '<div class="detalhe-obs">' + escapeHtml(visita.observacoes) + '</div></div>';
        }
        if (visita.imagens && visita.imagens.length > 0) {
            html += '<div class="detalhe-secao"><div class="detalhe-secao-titulo"><i class="fas fa-camera"></i> Imagens (' + visita.imagens.length + ')</div><div class="detalhe-imagens">';
            visita.imagens.forEach(function (img) {
                html += '<div class="detalhe-img" onclick="window.open(\'' + escapeAttr(img.url) + '\', \'_blank\')"><img src="' + escapeAttr(img.url) + '" alt="' + escapeAttr(img.nome_original || 'Imagem') + '"></div>';
            });
            html += '</div></div>';
        }
        body.innerHTML = html;
    }

    // ========================================
    // CONCLUIR RONDA
    // ========================================

    function configurarModais() {
        var btnFecharConcluir = document.getElementById('btn-modal-fechar-concluir');
        if (btnFecharConcluir) btnFecharConcluir.addEventListener('click', function () { fecharModal('modal-concluir'); });
        var btnCancelarConcluir = document.getElementById('btn-cancelar-concluir');
        if (btnCancelarConcluir) btnCancelarConcluir.addEventListener('click', function () { fecharModal('modal-concluir'); });
        var btnConfirmarConcluir = document.getElementById('btn-confirmar-concluir');
        if (btnConfirmarConcluir) btnConfirmarConcluir.addEventListener('click', function () { concluirRonda(); });
        var btnFecharDetalhe = document.getElementById('btn-modal-fechar-detalhe');
        if (btnFecharDetalhe) btnFecharDetalhe.addEventListener('click', function () { fecharModal('modal-detalhe'); });
        var btnFecharDetalheBottom = document.getElementById('btn-fechar-detalhe');
        if (btnFecharDetalheBottom) btnFecharDetalheBottom.addEventListener('click', function () { fecharModal('modal-detalhe'); });

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
        var resumo = document.getElementById('modal-concluir-resumo');
        if (resumo) resumo.innerHTML = '<strong>Ronda #' + estado.rondaId + '</strong> | Data: ' + formatarData(estado.dataRonda);
        abrirModal('modal-concluir');
    }

    function concluirRonda() {
        fetch(CONFIG.apiRondas + '/' + estado.rondaId + '/concluir', { method: 'PUT', headers: { 'Content-Type': 'application/json' } })
            .then(function (r) { return r.json(); })
            .then(function (d) {
                if (d.success) {
                    mostrarToast('Ronda concluida com sucesso!', 'sucesso');
                    fecharModal('modal-concluir');
                    estado.rondaId = null;
                    mostrarTela('ronda');
                    var resumoEl = document.getElementById('visitas-resumo');
                    if (resumoEl) resumoEl.style.display = 'none';
                } else { mostrarToast(d.error || 'Erro ao concluir', 'erro'); }
            })
            .catch(function () { mostrarToast('Erro de comunicacao', 'erro'); });
    }

    // ========================================
    // LIMPAR FORMULARIO
    // ========================================

    function limparFormularioVisita() {
        // Limpar inputs hidden de identificação
        var hiddenIds = ['input-setor-id', 'input-leito', 'input-atendimento'];
        hiddenIds.forEach(function (id) { var el = document.getElementById(id); if (el) el.value = ''; });

        // Limpar displays de identificação
        var displayIds = ['display-setor', 'display-leito', 'display-paciente', 'display-atendimento'];
        displayIds.forEach(function (id) { var el = document.getElementById(id); if (el) el.textContent = '--'; });

        // Esconder dados do paciente até o próximo carregamento
        var dadosEl = document.getElementById('paciente-dados');
        var loadingEl = document.getElementById('paciente-loading');
        var vazioEl = document.getElementById('paciente-vazio');
        if (dadosEl) dadosEl.style.display = 'none';
        if (loadingEl) loadingEl.style.display = '';
        if (vazioEl) vazioEl.style.display = 'none';

        // Limpar observações
        var obsEl = document.getElementById('input-observacoes');
        if (obsEl) obsEl.value = '';
        var countObs = document.getElementById('count-obs');
        if (countObs) countObs.textContent = '0';

        // Limpar seleções de semáforo
        var selecionados = document.querySelectorAll('.btn-semaforo.selecionado');
        for (var i = 0; i < selecionados.length; i++) selecionados[i].classList.remove('selecionado');

        // Resetar avaliação final automática
        estado.avaliacaoFinal = null;
        var pendente = document.getElementById('avaliacao-auto-pendente');
        var resultado = document.getElementById('avaliacao-auto-resultado');
        if (pendente) pendente.style.display = '';
        if (resultado) resultado.style.display = 'none';

        estado.imagensParaEnviar = [];
        renderizarPreviews();
    }

    // ========================================
    // CONTADORES
    // ========================================

    function configurarContadores() {
        var obsInput = document.getElementById('input-observacoes');
        if (obsInput) obsInput.addEventListener('input', function () {
            var c = document.getElementById('count-obs');
            if (c) c.textContent = this.value.length;
        });
    }

    // ========================================
    // UTILITARIOS
    // ========================================

    function abrirModal(id) { var m = document.getElementById(id); if (m) m.classList.add('ativo'); }
    function fecharModal(id) { var m = document.getElementById(id); if (m) m.classList.remove('ativo'); }
    function setTexto(id, texto) { var el = document.getElementById(id); if (el) el.textContent = texto; }

    function formatarData(dataStr) {
        if (!dataStr) return '--';
        var partes = dataStr.split('-');
        if (partes.length === 3) return partes[2] + '/' + partes[1] + '/' + partes[0];
        return dataStr;
    }

    function formatarResultado(resultado) {
        return { 'critico': 'Critico', 'atencao': 'Atencao', 'adequado': 'Adequado', 'nao_aplica': 'N/A' }[resultado] || resultado;
    }

    function escapeHtml(t) { if (!t) return ''; var d = document.createElement('div'); d.textContent = t; return d.innerHTML; }
    function escapeAttr(t) { if (!t) return ''; return t.replace(/&/g, '&amp;').replace(/'/g, '&#39;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

    function mostrarToast(msg, tipo) {
        var c = document.getElementById('toast-container');
        if (!c) return;
        var t = document.createElement('div');
        t.className = 'toast toast-' + (tipo || 'info');
        var icone = tipo === 'sucesso' ? '<i class="fas fa-check-circle"></i>' : tipo === 'erro' ? '<i class="fas fa-times-circle"></i>' : '<i class="fas fa-info-circle"></i>';
        t.innerHTML = icone + ' ' + escapeHtml(msg);
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
        carregarDuplasG: carregarDuplasGerenciar
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