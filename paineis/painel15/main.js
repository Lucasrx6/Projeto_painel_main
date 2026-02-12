// ========================================
// PAINEL 15 - GATILHO DE CHAMADOS TI
// Hospital Anchieta Ceilandia
// Mobile-First - Selects de Setor/Local/Problema
// ========================================

(function () {
    'use strict';

    var BASE_URL = window.location.origin;

    var CONFIG = {
        apiAbrir: BASE_URL + '/api/paineis/painel15/abrir',
        apiAcompanhar: BASE_URL + '/api/paineis/painel15/acompanhar',
        apiLocais: BASE_URL + '/api/paineis/painel15/locais',
        apiProblemas: BASE_URL + '/api/paineis/painel15/problemas',
        refreshAcompanhamento: 15000
    };

    var estado = {
        enviando: false,
        ultimoChamadoId: null,
        refreshInterval: null,
        telaAtual: 'principal',
        locais: [],        // Todos os locais carregados da API
        setores: [],       // Lista unica de setores
        problemas: []      // Tipos de problema
    };

    // ========================================
    // INICIALIZACAO
    // ========================================

    function inicializar() {
        console.log('Inicializando Painel 15...');

        configurarNavegacao();
        configurarBotaoEmergencia();
        configurarFormulario();
        configurarConfirmacao();
        configurarAcompanhamento();
        configurarContadorObs();
        carregarLocaisEProblemas();
        atualizarBadgeAtivos();

        console.log('Painel 15 inicializado');
    }

    // ========================================
    // CARREGAR LOCAIS E PROBLEMAS
    // ========================================

    function carregarLocaisEProblemas() {
        // Carregar locais
        fetch(CONFIG.apiLocais)
            .then(function (res) { return res.json(); })
            .then(function (data) {
                if (data.success) {
                    estado.locais = data.locais || [];
                    estado.setores = data.setores || [];
                    popularSetores();
                }
            })
            .catch(function (err) { console.error('Erro ao carregar locais:', err); });

        // Carregar problemas
        fetch(CONFIG.apiProblemas)
            .then(function (res) { return res.json(); })
            .then(function (data) {
                if (data.success) {
                    estado.problemas = data.data || [];
                    popularProblemas();
                }
            })
            .catch(function (err) { console.error('Erro ao carregar problemas:', err); });
    }

    function popularSetores() {
        var select = document.getElementById('select-setor');
        if (!select) return;

        select.innerHTML = '<option value="">Selecione o setor...</option>';
        estado.setores.forEach(function (setor) {
            var opt = document.createElement('option');
            opt.value = setor;
            opt.textContent = setor;
            select.appendChild(opt);
        });
    }

    function popularLocaisPorSetor(setorSelecionado) {
        var select = document.getElementById('select-local');
        if (!select) return;

        select.innerHTML = '<option value="">Selecione o local...</option>';

        if (!setorSelecionado) {
            select.disabled = true;
            select.innerHTML = '<option value="">Selecione o setor primeiro...</option>';
            return;
        }

        var locaisFiltrados = estado.locais.filter(function (loc) {
            return loc.setor === setorSelecionado;
        });

        if (locaisFiltrados.length === 0) {
            select.disabled = true;
            select.innerHTML = '<option value="">Nenhum local neste setor</option>';
            return;
        }

        locaisFiltrados.forEach(function (loc) {
            var opt = document.createElement('option');
            opt.value = loc.id;
            opt.textContent = loc.local;
            select.appendChild(opt);
        });

        select.disabled = false;
    }

    function popularProblemas() {
        var select = document.getElementById('select-problema');
        if (!select) return;

        select.innerHTML = '<option value="">Selecione o problema...</option>';
        estado.problemas.forEach(function (p) {
            var opt = document.createElement('option');
            opt.value = p.id;
            opt.textContent = p.descricao;
            select.appendChild(opt);
        });
    }

    // ========================================
    // NAVEGACAO
    // ========================================

    function configurarNavegacao() {
        var btnVoltar = document.getElementById('btn-voltar');
        if (btnVoltar) btnVoltar.addEventListener('click', function () { window.location.href = '/frontend/dashboard.html'; });
    }

    function mostrarTela(tela) {
        var telas = ['tela-principal', 'tela-formulario', 'tela-confirmacao', 'tela-acompanhamento'];
        telas.forEach(function (id) {
            var el = document.getElementById(id);
            if (el) el.style.display = (id === 'tela-' + tela) ? 'flex' : 'none';
        });
        estado.telaAtual = tela;

        if (tela === 'acompanhamento') {
            carregarAcompanhamento();
            estado.refreshInterval = setInterval(carregarAcompanhamento, CONFIG.refreshAcompanhamento);
        } else {
            if (estado.refreshInterval) { clearInterval(estado.refreshInterval); estado.refreshInterval = null; }
        }

        if (tela === 'formulario') {
            // Recarregar opcoes toda vez que abre o formulario
            carregarLocaisEProblemas();
        }

        var telaEl = document.getElementById('tela-' + tela);
        if (telaEl) telaEl.scrollTop = 0;
    }

    // ========================================
    // BOTAO EMERGENCIA
    // ========================================

    function configurarBotaoEmergencia() {
        var btnEmergencia = document.getElementById('btn-emergencia');
        if (btnEmergencia) {
            btnEmergencia.addEventListener('click', function () {
                if (navigator.vibrate) navigator.vibrate(100);
                mostrarTela('formulario');
                setTimeout(function () {
                    var inputNome = document.getElementById('input-nome');
                    if (inputNome) inputNome.focus();
                }, 300);
            });
        }

        var btnAcompanhar = document.getElementById('btn-acompanhar');
        if (btnAcompanhar) {
            btnAcompanhar.addEventListener('click', function () { mostrarTela('acompanhamento'); });
        }
    }

    // ========================================
    // FORMULARIO
    // ========================================

    function configurarFormulario() {
        var btnVoltarForm = document.getElementById('btn-voltar-form');
        if (btnVoltarForm) btnVoltarForm.addEventListener('click', function () { mostrarTela('principal'); });

        var form = document.getElementById('form-chamado');
        if (form) form.addEventListener('submit', function (e) { e.preventDefault(); enviarChamado(); });

        // Mascara Kora
        var inputKora = document.getElementById('input-kora');
        if (inputKora) inputKora.addEventListener('input', function () { this.value = this.value.replace(/[^0-9]/g, ''); });

        // Cascata: Setor -> Local
        var selectSetor = document.getElementById('select-setor');
        if (selectSetor) {
            selectSetor.addEventListener('change', function () {
                popularLocaisPorSetor(this.value);
            });
        }
    }

    function configurarContadorObs() {
        var inputObs = document.getElementById('input-obs');
        if (inputObs) inputObs.addEventListener('input', function () {
            var c = document.getElementById('count-obs');
            if (c) c.textContent = this.value.length;
        });
    }

    // ========================================
    // ENVIAR CHAMADO
    // ========================================

    function enviarChamado() {
        if (estado.enviando) return;

        var nome = (document.getElementById('input-nome').value || '').trim();
        var localId = document.getElementById('select-local').value;
        var problemaId = document.getElementById('select-problema').value;
        var kora = (document.getElementById('input-kora').value || '').trim();
        var obs = (document.getElementById('input-obs').value || '').trim();

        var erros = [];
        if (!nome) erros.push('Informe seu nome');
        if (!document.getElementById('select-setor').value) erros.push('Selecione o setor');
        else if (!localId) erros.push('Selecione o local do problema');
        if (!problemaId) erros.push('Selecione o tipo de problema');
        if (!kora) erros.push('Informe o numero do chamado Kora');
        else if (!/^[0-9]{6,7}$/.test(kora)) erros.push('Numero Kora deve ter 6 ou 7 digitos');

        if (erros.length > 0) {
            mostrarToast(erros[0], 'erro');
            return;
        }

        estado.enviando = true;
        var btnEnviar = document.getElementById('btn-enviar');
        if (btnEnviar) { btnEnviar.disabled = true; btnEnviar.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Enviando...'; }

        var payload = {
            nome_solicitante: nome,
            local_id: parseInt(localId),
            problema_id: parseInt(problemaId),
            numero_kora: kora,
            observacao: obs || null
        };

        // Guardar textos para a confirmacao
        var setorTexto = document.getElementById('select-setor').value;
        var localTexto = document.getElementById('select-local').selectedOptions[0].textContent;
        var problemaTexto = document.getElementById('select-problema').selectedOptions[0].textContent;

        fetch(CONFIG.apiAbrir, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        })
        .then(function (res) { return res.json(); })
        .then(function (data) {
            if (data.success) {
                if (navigator.vibrate) navigator.vibrate([100, 50, 100]);
                estado.ultimoChamadoId = data.data.id;
                exibirConfirmacao(data.data, {
                    nome_solicitante: nome,
                    setor: setorTexto,
                    local: localTexto,
                    problema: problemaTexto
                });
                limparFormulario();
            } else {
                var msgErro = data.error || (data.errors ? data.errors[0] : 'Erro ao abrir chamado');
                mostrarToast(msgErro, 'erro');
                if (navigator.vibrate) navigator.vibrate([200, 100, 200]);
            }
        })
        .catch(function (err) {
            console.error('Erro ao enviar chamado:', err);
            mostrarToast('Erro de comunicacao com o servidor', 'erro');
        })
        .finally(function () {
            estado.enviando = false;
            if (btnEnviar) { btnEnviar.disabled = false; btnEnviar.innerHTML = '<i class="fas fa-paper-plane"></i> Enviar Chamado Emergencial'; }
        });
    }

    function limparFormulario() {
        document.getElementById('input-nome').value = '';
        document.getElementById('select-setor').value = '';
        popularLocaisPorSetor('');
        document.getElementById('select-problema').value = '';
        document.getElementById('input-kora').value = '';
        document.getElementById('input-obs').value = '';
        var c = document.getElementById('count-obs');
        if (c) c.textContent = '0';
    }

    // ========================================
    // CONFIRMACAO
    // ========================================

    function configurarConfirmacao() {
        document.getElementById('btn-novo-chamado').addEventListener('click', function () {
            mostrarTela('formulario');
            setTimeout(function () { document.getElementById('input-nome').focus(); }, 300);
        });
        document.getElementById('btn-ver-chamados').addEventListener('click', function () { mostrarTela('acompanhamento'); });
        document.getElementById('btn-voltar-inicio').addEventListener('click', function () { mostrarTela('principal'); atualizarBadgeAtivos(); });
    }

    function exibirConfirmacao(dados, info) {
        var detalhes = document.getElementById('confirmacao-detalhes');
        if (detalhes) {
            var dataAbrt = dados.data_abertura ? formatarDataHora(dados.data_abertura) : 'Agora';
            detalhes.innerHTML =
                '<strong>ID:</strong> #' + dados.id + '<br>' +
                '<strong>Kora:</strong> ' + escapeHtml(dados.numero_kora) + '<br>' +
                '<strong>Solicitante:</strong> ' + escapeHtml(info.nome_solicitante) + '<br>' +
                '<strong>Setor:</strong> ' + escapeHtml(info.setor) + '<br>' +
                '<strong>Local:</strong> ' + escapeHtml(info.local) + '<br>' +
                '<strong>Problema:</strong> ' + escapeHtml(info.problema) + '<br>' +
                '<strong>Prioridade:</strong> CRITICA (Emergencial)<br>' +
                '<strong>Abertura:</strong> ' + dataAbrt;
        }
        mostrarTela('confirmacao');
    }

    // ========================================
    // ACOMPANHAMENTO
    // ========================================

    function configurarAcompanhamento() {
        document.getElementById('btn-voltar-acompanhamento').addEventListener('click', function () { mostrarTela('principal'); atualizarBadgeAtivos(); });
        document.getElementById('btn-refresh-acomp').addEventListener('click', function () {
            carregarAcompanhamento();
            mostrarToast('Atualizado', 'info');
            var icon = this.querySelector('i');
            if (icon) { icon.style.transition = 'transform 0.5s'; icon.style.transform = 'rotate(360deg)'; setTimeout(function () { icon.style.transition = ''; icon.style.transform = ''; }, 500); }
        });
    }

    function carregarAcompanhamento() {
        fetch(CONFIG.apiAcompanhar)
            .then(function (res) { return res.json(); })
            .then(function (data) { if (data.success) renderizarAcompanhamento(data.data); })
            .catch(function (err) { console.error('Erro acompanhamento:', err); });
    }

    function renderizarAcompanhamento(chamados) {
        var lista = document.getElementById('lista-acompanhamento');
        var vazio = document.getElementById('vazio-acompanhamento');
        if (!lista) return;

        if (!chamados || chamados.length === 0) {
            lista.innerHTML = '';
            if (vazio) vazio.style.display = 'block';
            return;
        }
        if (vazio) vazio.style.display = 'none';

        lista.innerHTML = chamados.map(function (ch) {
            var dataAbertura = ch.data_abertura ? formatarDataHora(ch.data_abertura) : '--';
            var minutos = parseFloat(ch.minutos_total) || 0;
            var isLongo = minutos > 60;
            var tempoStr = ch.tempo_total_formatado || formatarMinutos(minutos);

            var html = '<div class="acomp-card acomp-' + ch.status + '">';
            html += '<div class="acomp-card-header">';
            html += '  <div class="acomp-card-titulo">';
            html += '    <span class="acomp-kora"><i class="fas fa-ticket-alt"></i> #' + escapeHtml(ch.numero_kora) + '</span>';
            html += '    <span class="acomp-badge acomp-badge-' + ch.status + '">' + formatarStatus(ch.status) + '</span>';
            html += '  </div>';
            html += '  <div class="acomp-tempo' + (isLongo ? ' tempo-longo' : '') + '"><i class="fas fa-stopwatch"></i> ' + tempoStr + '</div>';
            html += '</div>';
            html += '<div class="acomp-card-body">';
            html += '  <div class="acomp-campo"><i class="fas fa-user"></i> <strong>' + escapeHtml(ch.nome_solicitante) + '</strong></div>';
            if (ch.setor) html += '  <div class="acomp-campo"><i class="fas fa-building"></i> ' + escapeHtml(ch.setor) + '</div>';
            html += '  <div class="acomp-campo"><i class="fas fa-map-marker-alt"></i> ' + escapeHtml(ch.local_problema) + '</div>';
            if (ch.problema_descricao) html += '  <div class="acomp-campo"><i class="fas fa-tools"></i> ' + escapeHtml(ch.problema_descricao) + '</div>';
            html += '  <div class="acomp-campo"><i class="fas fa-calendar"></i> ' + dataAbertura + '</div>';
            if (ch.tecnico_atendimento) html += '  <div class="acomp-campo"><i class="fas fa-wrench"></i> Tecnico: <strong>' + escapeHtml(ch.tecnico_atendimento) + '</strong></div>';
            if (ch.status === 'fechado' && ch.data_fechamento) html += '  <div class="acomp-campo"><i class="fas fa-calendar-check"></i> Fechado: ' + formatarDataHora(ch.data_fechamento) + '</div>';
            if (ch.observacao_fechamento) html += '  <div class="acomp-obs"><i class="fas fa-clipboard-check"></i> ' + escapeHtml(ch.observacao_fechamento) + '</div>';
            html += '</div></div>';
            return html;
        }).join('');
    }

    function atualizarBadgeAtivos() {
        fetch(CONFIG.apiAcompanhar)
            .then(function (res) { return res.json(); })
            .then(function (data) {
                if (data.success) {
                    var ativos = (data.data || []).filter(function (ch) { return ch.status === 'aberto' || ch.status === 'em_atendimento'; });
                    var badge = document.getElementById('badge-ativos');
                    if (badge) badge.textContent = ativos.length;
                }
            })
            .catch(function () {});
    }

    // ========================================
    // UTILITARIOS
    // ========================================

    function formatarStatus(s) {
        return { 'aberto': 'Aberto', 'em_atendimento': 'Em Atendimento', 'fechado': 'Fechado', 'inativo': 'Inativo' }[s] || s;
    }

    function formatarDataHora(iso) {
        try {
            var d = new Date(iso);
            return String(d.getDate()).padStart(2, '0') + '/' + String(d.getMonth() + 1).padStart(2, '0')
                + ' ' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
        } catch (e) { return '--'; }
    }

    function formatarMinutos(m) {
        return String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(Math.floor(m % 60)).padStart(2, '0');
    }

    function escapeHtml(t) { if (!t) return ''; var d = document.createElement('div'); d.textContent = t; return d.innerHTML; }

    function mostrarToast(msg, tipo) {
        var c = document.getElementById('toast-container');
        if (!c) return;
        var t = document.createElement('div');
        t.className = 'toast toast-' + (tipo || 'info');
        var i = tipo === 'sucesso' ? '<i class="fas fa-check-circle"></i>' : tipo === 'erro' ? '<i class="fas fa-times-circle"></i>' : '<i class="fas fa-info-circle"></i>';
        t.innerHTML = i + ' ' + escapeHtml(msg);
        c.appendChild(t);
        setTimeout(function () { if (t.parentNode) t.parentNode.removeChild(t); }, 4000);
    }

    if (document.readyState === 'loading') { document.addEventListener('DOMContentLoaded', inicializar); }
    else { inicializar(); }
})();