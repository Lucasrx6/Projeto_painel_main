/* ============================================================
   CONFIGURAR FORMULÁRIO - main_config.js
   Gerenciamento de Categorias e Itens do formulário Sentir e Agir
   ============================================================ */

(function () {
    'use strict';

    var CONFIG = {
        apiBase: '/api/paineis/painel28',
        get apiCategorias() { return this.apiBase + '/categorias'; },
        get apiItens()      { return this.apiBase + '/itens'; }
    };

    /* ---- Estado ---- */
    var estado = {
        categorias: [],
        carregando: false
    };

    /* ---- Helpers DOM ---- */
    function $(id)  { return document.getElementById(id); }
    function qs(sel) { return document.querySelector(sel); }

    function escapeHtml(str) {
        if (!str) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    /* ---- Toast ---- */
    function mostrarToast(msg, tipo) {
        var container = $('toast-container');
        if (!container) return;
        var el = document.createElement('div');
        el.className = 'toast ' + (tipo || 'info');
        el.textContent = msg;
        container.appendChild(el);
        setTimeout(function () {
            el.style.opacity = '0';
            el.style.transition = 'opacity 0.3s';
            setTimeout(function () { el.remove(); }, 300);
        }, 3500);
    }

    /* ---- API ---- */
    function apiGet(url) {
        return fetch(url).then(function (r) { return r.json(); });
    }

    function apiPost(url, body) {
        return fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        }).then(function (r) { return r.json(); });
    }

    function apiPut(url, body) {
        return fetch(url, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body || {})
        }).then(function (r) { return r.json(); });
    }

    /* ---- Carregamento ---- */
    function carregarCategorias() {
        estado.carregando = true;
        renderizarLista();
        apiGet(CONFIG.apiCategorias)
            .then(function (data) {
                estado.carregando = false;
                if (data.success) {
                    estado.categorias = data.data || [];
                } else {
                    mostrarToast(data.error || 'Erro ao carregar', 'erro');
                    estado.categorias = [];
                }
                renderizarLista();
            })
            .catch(function () {
                estado.carregando = false;
                mostrarToast('Erro de comunicação', 'erro');
                estado.categorias = [];
                renderizarLista();
            });
    }

    /* ---- Renderização ---- */
    function renderizarLista() {
        var container = $('config-lista');
        if (!container) return;

        if (estado.carregando) {
            container.innerHTML = '<div class="loading-state"><div class="spinner"></div><span>Carregando categorias...</span></div>';
            return;
        }

        if (!estado.categorias.length) {
            container.innerHTML = '<div class="loading-state"><i class="fas fa-layer-group" style="font-size:2rem;color:#ccc;"></i><span style="color:#aaa;">Nenhuma categoria cadastrada.<br>Clique em "+ Nova Categoria" para começar.</span></div>';
            return;
        }

        var html = '';
        estado.categorias.forEach(function (cat) {
            var isInativa = !cat.ativo;
            var itensList = '';

            if (cat.itens && cat.itens.length) {
                cat.itens.forEach(function (item) {
                    var tipoClass = item.tipo === 'sim_nao' ? 'tipo-sim_nao' : 'tipo-semaforo';
                    var criticoLabel = item.tipo === 'sim_nao'
                        ? (item.critico_quando === 'sim' ? ' · crítico: Sim' : ' · crítico: Não') + (item.permite_nao_aplica ? ' · N/A' : '')
                        : '';
                    var tipoLabel = item.tipo === 'sim_nao' ? ('Sim/Não' + criticoLabel) : 'Semáforo';
                    itensList += '<div class="item-row' + (item.ativo ? '' : ' inativo') + '" data-item-id="' + item.id + '">';
                    itensList += '  <span class="item-tipo-badge ' + tipoClass + '">' + tipoLabel + '</span>';
                    itensList += '  <span class="item-descricao">' + escapeHtml(item.descricao) + (item.ativo ? '' : ' <span class="badge-inativo">Inativo</span>') + '</span>';
                    itensList += '  <div class="item-acoes">';
                    itensList += '    <button class="btn-icon" title="Mover para cima" onclick="window.CFG.reordenarItem(' + item.id + ',\'cima\')"><i class="fas fa-chevron-up"></i></button>';
                    itensList += '    <button class="btn-icon" title="Mover para baixo" onclick="window.CFG.reordenarItem(' + item.id + ',\'baixo\')"><i class="fas fa-chevron-down"></i></button>';
                    itensList += '    <button class="btn-icon warning" title="Editar item" onclick="window.CFG.abrirModalItem(\'editar\',' + item.id + ')"><i class="fas fa-pen"></i></button>';
                    itensList += '    <button class="btn-icon ' + (item.ativo ? 'danger' : 'success') + '" title="' + (item.ativo ? 'Desativar' : 'Ativar') + '" onclick="window.CFG.toggleItem(' + item.id + ')">';
                    itensList += '      <i class="fas ' + (item.ativo ? 'fa-eye-slash' : 'fa-eye') + '"></i></button>';
                    itensList += '  </div>';
                    itensList += '</div>';
                });
            } else {
                itensList = '<p class="sem-itens"><i class="fas fa-inbox"></i> Nenhum item nesta categoria.</p>';
            }

            html += '<div class="categoria-card' + (isInativa ? ' inativa' : '') + '" data-cat-id="' + cat.id + '">';

            html += '<div class="categoria-header" onclick="window.CFG.toggleExpansao(' + cat.id + ')">';
            html += '  <div class="categoria-icone" style="background:' + escapeHtml(cat.cor || '#17a2b8') + '">';
            html += '    <i class="fas ' + escapeHtml(cat.icone || 'fa-circle') + '"></i>';
            html += '  </div>';
            html += '  <div class="categoria-info">';
            html += '    <div class="categoria-nome">' + escapeHtml(cat.nome);
            if (isInativa) html += ' <span class="badge-inativo">Inativa</span>';
            html += '    </div>';
            var nItens = cat.itens ? cat.itens.length : 0;
            var nAtivos = cat.itens ? cat.itens.filter(function (i) { return i.ativo; }).length : 0;
            html += '    <div class="categoria-meta">' + nAtivos + ' de ' + nItens + ' iten(s) ativo(s)';
            if (cat.permite_nao_aplica) html += ' · N/A permitido';
            html += '    </div>';
            html += '  </div>';
            html += '  <div class="categoria-acoes" onclick="event.stopPropagation()">';
            html += '    <button class="btn-icon" title="Mover para cima" onclick="window.CFG.reordenarCategoria(' + cat.id + ',\'cima\')"><i class="fas fa-chevron-up"></i></button>';
            html += '    <button class="btn-icon" title="Mover para baixo" onclick="window.CFG.reordenarCategoria(' + cat.id + ',\'baixo\')"><i class="fas fa-chevron-down"></i></button>';
            html += '    <button class="btn-icon warning" title="Editar categoria" onclick="window.CFG.abrirModalCategoria(\'editar\',' + cat.id + ')"><i class="fas fa-pen"></i></button>';
            html += '    <button class="btn-icon ' + (isInativa ? 'success' : 'danger') + '" title="' + (isInativa ? 'Ativar' : 'Desativar') + '" onclick="window.CFG.toggleCategoria(' + cat.id + ')">';
            html += '      <i class="fas ' + (isInativa ? 'fa-eye' : 'fa-eye-slash') + '"></i></button>';
            html += '  </div>';
            html += '  <i class="fas fa-chevron-down categoria-expand-icon"></i>';
            html += '</div>';

            html += '<div class="categoria-body">';
            html += '  <div class="itens-header">';
            html += '    <span class="itens-header-label"><i class="fas fa-list-ul"></i> Itens da categoria</span>';
            html += '    <button class="btn btn-success" style="font-size:0.78rem;padding:5px 12px;" onclick="window.CFG.abrirModalItem(\'criar\',' + cat.id + ')">';
            html += '      <i class="fas fa-plus"></i> Novo Item</button>';
            html += '  </div>';
            html += itensList;
            html += '</div>';

            html += '</div>';
        });

        container.innerHTML = html;
    }

    /* ---- Toggle expansão da categoria ---- */
    function toggleExpansao(catId) {
        var card = document.querySelector('[data-cat-id="' + catId + '"]');
        if (!card) return;
        card.classList.toggle('expandida');
    }

    /* ---- Reordenar categoria ---- */
    function reordenarCategoria(catId, direcao) {
        apiPut(CONFIG.apiCategorias + '/' + catId + '/reordenar', { direcao: direcao })
            .then(function (data) {
                if (data.success) {
                    carregarCategorias();
                } else {
                    mostrarToast(data.error || 'Não é possível reordenar', 'aviso');
                }
            })
            .catch(function () { mostrarToast('Erro de comunicação', 'erro'); });
    }

    /* ---- Toggle categoria ---- */
    function toggleCategoria(catId) {
        apiPut(CONFIG.apiCategorias + '/' + catId + '/toggle')
            .then(function (data) {
                if (data.success) {
                    mostrarToast(data.message, 'sucesso');
                    carregarCategorias();
                } else {
                    mostrarToast(data.error || 'Erro', 'erro');
                }
            })
            .catch(function () { mostrarToast('Erro de comunicação', 'erro'); });
    }

    /* ---- Toggle item ---- */
    function toggleItem(itemId) {
        apiPut(CONFIG.apiItens + '/' + itemId + '/toggle')
            .then(function (data) {
                if (data.success) {
                    mostrarToast(data.message, 'sucesso');
                    carregarCategorias();
                } else {
                    mostrarToast(data.error || 'Erro', 'erro');
                }
            })
            .catch(function () { mostrarToast('Erro de comunicação', 'erro'); });
    }

    /* ---- Reordenar item ---- */
    function reordenarItem(itemId, direcao) {
        apiPut(CONFIG.apiItens + '/' + itemId + '/reordenar', { direcao: direcao })
            .then(function (data) {
                if (data.success) {
                    carregarCategorias();
                } else {
                    mostrarToast(data.error || 'Não é possível reordenar', 'aviso');
                }
            })
            .catch(function () { mostrarToast('Erro de comunicação', 'erro'); });
    }

    /* ============================================================
       MODAL CATEGORIA
       ============================================================ */

    var CORES_PRESET = [
        '#17a2b8', '#28a745', '#dc3545', '#ffc107',
        '#6f42c1', '#fd7e14', '#20c997', '#e83e8c',
        '#6c757d', '#007bff', '#343a40', '#795548'
    ];

    var modalCatMode = 'criar';
    var modalCatId = null;

    function abrirModalCategoria(modo, catId) {
        modalCatMode = modo;
        modalCatId = catId || null;

        var titulo = $('modal-cat-titulo');
        var inputNome = $('modal-cat-nome');
        var inputIcone = $('modal-cat-icone');
        var inputCor = $('modal-cat-cor');
        var toggleNA = $('modal-cat-nao-aplica');

        if (titulo)    titulo.textContent = modo === 'criar' ? 'Nova Categoria' : 'Editar Categoria';
        if (inputNome) inputNome.value = '';
        if (inputIcone) inputIcone.value = 'fa-circle';
        if (inputCor)  inputCor.value = '#17a2b8';
        if (toggleNA)  toggleNA.checked = true;

        if (modo === 'editar' && catId) {
            var cat = estado.categorias.find(function (c) { return c.id === catId; });
            if (cat) {
                if (inputNome) inputNome.value = cat.nome || '';
                if (inputIcone) inputIcone.value = cat.icone || 'fa-circle';
                if (inputCor)  inputCor.value = cat.cor || '#17a2b8';
                if (toggleNA)  toggleNA.checked = !!cat.permite_nao_aplica;
            }
        }

        atualizarPreviewIcone();
        atualizarPresetsAtivo();

        var overlay = $('modal-categoria');
        if (overlay) overlay.classList.add('aberto');
        if (inputNome) setTimeout(function () { inputNome.focus(); }, 80);
    }

    function fecharModalCategoria() {
        var overlay = $('modal-categoria');
        if (overlay) overlay.classList.remove('aberto');
    }

    function atualizarPreviewIcone() {
        var inputIcone = $('modal-cat-icone');
        var preview = $('modal-cat-icone-preview');
        var inputCor = $('modal-cat-cor');
        if (!inputIcone || !preview) return;
        var icone = (inputIcone.value || 'fa-circle').trim();
        var cor = inputCor ? inputCor.value : '#6f42c1';
        preview.style.background = cor;
        var ico = preview.querySelector('i');
        if (ico) {
            ico.className = 'fas ' + icone;
        }
    }

    function atualizarPresetsAtivo() {
        var inputCor = $('modal-cat-cor');
        if (!inputCor) return;
        var corAtual = inputCor.value.toLowerCase();
        document.querySelectorAll('.cor-preset').forEach(function (el) {
            el.classList.toggle('ativo', el.dataset.cor === corAtual);
        });
        atualizarPreviewIcone();
    }

    function confirmarCategoria() {
        var inputNome = $('modal-cat-nome');
        var inputIcone = $('modal-cat-icone');
        var inputCor = $('modal-cat-cor');
        var toggleNA = $('modal-cat-nao-aplica');

        var nome = inputNome ? inputNome.value.trim() : '';
        if (!nome) {
            mostrarToast('Informe o nome da categoria', 'aviso');
            if (inputNome) inputNome.focus();
            return;
        }

        var payload = {
            nome: nome,
            icone: inputIcone ? inputIcone.value.trim() : 'fa-circle',
            cor: inputCor ? inputCor.value : '#17a2b8',
            permite_nao_aplica: toggleNA ? toggleNA.checked : true
        };

        var btn = $('btn-confirmar-categoria');
        if (btn) { btn.disabled = true; btn.textContent = 'Salvando...'; }

        var promise = modalCatMode === 'criar'
            ? apiPost(CONFIG.apiCategorias, payload)
            : apiPut(CONFIG.apiCategorias + '/' + modalCatId, payload);

        promise
            .then(function (data) {
                if (btn) { btn.disabled = false; btn.textContent = 'Salvar'; }
                if (data.success) {
                    mostrarToast(modalCatMode === 'criar' ? 'Categoria criada!' : 'Categoria atualizada!', 'sucesso');
                    fecharModalCategoria();
                    carregarCategorias();
                } else {
                    mostrarToast(data.error || 'Erro ao salvar', 'erro');
                }
            })
            .catch(function () {
                if (btn) { btn.disabled = false; btn.textContent = 'Salvar'; }
                mostrarToast('Erro de comunicação', 'erro');
            });
    }

    /* ============================================================
       MODAL ITEM
       ============================================================ */

    var modalItemMode = 'criar';
    var modalItemId = null;
    var modalItemCatId = null;

    function _atualizarCampoCriticoQuando(tipo) {
        var campo = $('campo-critico-quando');
        if (!campo) return;
        campo.style.display = tipo === 'sim_nao' ? 'block' : 'none';
        var campoNA = $('campo-permite-na');
        if (campoNA) campoNA.style.display = tipo === 'sim_nao' ? 'block' : 'none';
        _atualizarEstiloCriticoQuando();
    }

    function _atualizarEstiloCriticoQuando() {
        var radSim = $('critico-quando-sim');
        var radNao = $('critico-quando-nao');
        var lblSim = $('label-critico-sim');
        var lblNao = $('label-critico-nao');
        if (!radSim || !radNao) return;
        var valor = radSim.checked ? 'sim' : 'nao';
        if (lblSim) lblSim.style.border = valor === 'sim' ? '2px solid #dc3545' : '2px solid #dee2e6';
        if (lblSim) lblSim.style.background = valor === 'sim' ? '#fff5f5' : '';
        if (lblNao) lblNao.style.border = valor === 'nao' ? '2px solid #dc3545' : '2px solid #dee2e6';
        if (lblNao) lblNao.style.background = valor === 'nao' ? '#fff5f5' : '';
    }

    function abrirModalItem(modo, idParam) {
        modalItemMode = modo;

        var inputDesc = $('modal-item-descricao');
        var selectTipo = $('modal-item-tipo');
        var titulo = $('modal-item-titulo');

        if (modo === 'criar') {
            modalItemCatId = idParam;
            modalItemId = null;
            if (titulo) titulo.textContent = 'Novo Item';
            if (inputDesc) inputDesc.value = '';
            if (selectTipo) selectTipo.value = 'semaforo';
            var radNaoC = $('critico-quando-nao');
            if (radNaoC) radNaoC.checked = true;
            var checkNAC = $('item-permite-na');
            if (checkNAC) checkNAC.checked = false;
            _atualizarCampoCriticoQuando('semaforo');
        } else {
            // editar — idParam é o item id
            modalItemId = idParam;
            modalItemCatId = null;
            if (titulo) titulo.textContent = 'Editar Item';

            var itemEncontrado = null;
            for (var ci = 0; ci < estado.categorias.length; ci++) {
                var cat = estado.categorias[ci];
                if (cat.itens) {
                    for (var ii = 0; ii < cat.itens.length; ii++) {
                        if (cat.itens[ii].id === idParam) {
                            itemEncontrado = cat.itens[ii];
                            modalItemCatId = cat.id;
                            break;
                        }
                    }
                }
                if (itemEncontrado) break;
            }

            if (itemEncontrado) {
                if (inputDesc) inputDesc.value = itemEncontrado.descricao || '';
                if (selectTipo) selectTipo.value = itemEncontrado.tipo || 'semaforo';
                var criticoVal = itemEncontrado.critico_quando || 'nao';
                var radSimE = $('critico-quando-sim');
                var radNaoE = $('critico-quando-nao');
                if (radSimE) radSimE.checked = criticoVal === 'sim';
                if (radNaoE) radNaoE.checked = criticoVal === 'nao';
                var checkNAE = $('item-permite-na');
                if (checkNAE) checkNAE.checked = !!itemEncontrado.permite_nao_aplica;
                _atualizarCampoCriticoQuando(itemEncontrado.tipo || 'semaforo');
            }
        }

        var overlay = $('modal-item');
        if (overlay) overlay.classList.add('aberto');
        if (inputDesc) setTimeout(function () { inputDesc.focus(); }, 80);
    }

    function fecharModalItem() {
        var overlay = $('modal-item');
        if (overlay) overlay.classList.remove('aberto');
    }

    function confirmarItem() {
        var inputDesc = $('modal-item-descricao');
        var selectTipo = $('modal-item-tipo');

        var descricao = inputDesc ? inputDesc.value.trim() : '';
        if (!descricao) {
            mostrarToast('Informe a descrição do item', 'aviso');
            if (inputDesc) inputDesc.focus();
            return;
        }

        var btn = $('btn-confirmar-item');
        if (btn) { btn.disabled = true; btn.textContent = 'Salvando...'; }

        var tipoVal = selectTipo ? selectTipo.value : 'semaforo';
        var radSimF = $('critico-quando-sim');
        var criticoQuandoVal = (tipoVal === 'sim_nao' && radSimF && radSimF.checked) ? 'sim' : 'nao';
        var checkNAF = $('item-permite-na');
        var permiteNaVal = tipoVal === 'sim_nao' && checkNAF && checkNAF.checked;

        var promise;
        if (modalItemMode === 'criar') {
            promise = apiPost(CONFIG.apiItens, {
                categoria_id: modalItemCatId,
                descricao: descricao,
                tipo: tipoVal,
                critico_quando: criticoQuandoVal,
                permite_nao_aplica: permiteNaVal
            });
        } else {
            promise = apiPut(CONFIG.apiItens + '/' + modalItemId, {
                descricao: descricao,
                tipo: tipoVal,
                critico_quando: criticoQuandoVal,
                permite_nao_aplica: permiteNaVal
            });
        }

        promise
            .then(function (data) {
                if (btn) { btn.disabled = false; btn.textContent = 'Salvar'; }
                if (data.success) {
                    mostrarToast(modalItemMode === 'criar' ? 'Item criado!' : 'Item atualizado!', 'sucesso');
                    fecharModalItem();
                    carregarCategorias();
                } else {
                    mostrarToast(data.error || 'Erro ao salvar', 'erro');
                }
            })
            .catch(function () {
                if (btn) { btn.disabled = false; btn.textContent = 'Salvar'; }
                mostrarToast('Erro de comunicação', 'erro');
            });
    }

    /* ---- Init ---- */
    function init() {
        // Botões do toolbar
        var btnNovaCat = $('btn-nova-categoria');
        if (btnNovaCat) btnNovaCat.addEventListener('click', function () {
            abrirModalCategoria('criar');
        });

        var btnAtualizar = $('btn-atualizar');
        if (btnAtualizar) btnAtualizar.addEventListener('click', carregarCategorias);

        var btnVoltar = $('btn-voltar');
        if (btnVoltar) btnVoltar.addEventListener('click', function () {
            window.location.href = '/paineis/painel28/sentir-agir.html';
        });

        // Modal categoria
        var btnFecharModalCat = $('btn-fechar-modal-categoria');
        if (btnFecharModalCat) btnFecharModalCat.addEventListener('click', fecharModalCategoria);

        var btnCancelarCat = $('btn-cancelar-categoria');
        if (btnCancelarCat) btnCancelarCat.addEventListener('click', fecharModalCategoria);

        var btnConfirmarCat = $('btn-confirmar-categoria');
        if (btnConfirmarCat) btnConfirmarCat.addEventListener('click', confirmarCategoria);

        var inputIcone = $('modal-cat-icone');
        if (inputIcone) inputIcone.addEventListener('input', atualizarPreviewIcone);

        var inputCor = $('modal-cat-cor');
        if (inputCor) {
            inputCor.addEventListener('input', atualizarPresetsAtivo);
            inputCor.addEventListener('change', atualizarPresetsAtivo);
        }

        // Cores preset
        var presetsContainer = $('cor-presets-container');
        if (presetsContainer) {
            CORES_PRESET.forEach(function (cor) {
                var btn = document.createElement('button');
                btn.type = 'button';
                btn.className = 'cor-preset';
                btn.style.background = cor;
                btn.dataset.cor = cor;
                btn.title = cor;
                btn.addEventListener('click', function () {
                    if (inputCor) {
                        inputCor.value = cor;
                        atualizarPresetsAtivo();
                    }
                });
                presetsContainer.appendChild(btn);
            });
        }

        // Fechar modal categoria ao clicar fora
        var overlayModalCat = $('modal-categoria');
        if (overlayModalCat) {
            overlayModalCat.addEventListener('click', function (e) {
                if (e.target === overlayModalCat) fecharModalCategoria();
            });
        }

        // Modal item — mostrar/ocultar campo critico_quando ao mudar tipo
        var selectTipoEl = $('modal-item-tipo');
        if (selectTipoEl) {
            selectTipoEl.addEventListener('change', function () {
                _atualizarCampoCriticoQuando(this.value);
            });
        }

        // Radio critico_quando — highlight visual
        var radSimEl = $('critico-quando-sim');
        var radNaoEl = $('critico-quando-nao');
        if (radSimEl) radSimEl.addEventListener('change', _atualizarEstiloCriticoQuando);
        if (radNaoEl) radNaoEl.addEventListener('change', _atualizarEstiloCriticoQuando);

        var btnFecharModalItem = $('btn-fechar-modal-item');
        if (btnFecharModalItem) btnFecharModalItem.addEventListener('click', fecharModalItem);

        var btnCancelarItem = $('btn-cancelar-item');
        if (btnCancelarItem) btnCancelarItem.addEventListener('click', fecharModalItem);

        var btnConfirmarItem = $('btn-confirmar-item');
        if (btnConfirmarItem) btnConfirmarItem.addEventListener('click', confirmarItem);

        var overlayModalItem = $('modal-item');
        if (overlayModalItem) {
            overlayModalItem.addEventListener('click', function (e) {
                if (e.target === overlayModalItem) fecharModalItem();
            });
        }

        // Enter nos modais
        document.addEventListener('keydown', function (e) {
            if (e.key === 'Escape') {
                fecharModalCategoria();
                fecharModalItem();
            }
            if (e.key === 'Enter' && e.target && e.target.tagName !== 'TEXTAREA') {
                var modalCat = $('modal-categoria');
                var modalItemEl = $('modal-item');
                if (modalCat && modalCat.classList.contains('aberto')) {
                    confirmarCategoria();
                } else if (modalItemEl && modalItemEl.classList.contains('aberto')) {
                    confirmarItem();
                }
            }
        });

        carregarCategorias();
    }

    /* ---- API pública (para handlers inline no HTML renderizado) ---- */
    window.CFG = {
        toggleExpansao: toggleExpansao,
        reordenarCategoria: reordenarCategoria,
        toggleCategoria: toggleCategoria,
        abrirModalCategoria: abrirModalCategoria,
        abrirModalItem: abrirModalItem,
        reordenarItem: reordenarItem,
        toggleItem: toggleItem
    };

    document.addEventListener('DOMContentLoaded', init);

})();
