// ========================================
// PAINEL 15 - GATILHO DE CHAMADOS TI
// Hospital Anchieta Ceilandia
// Mobile-First - Todos os chamados sao CRITICOS
// ========================================

(function () {
    'use strict';

    var BASE_URL = window.location.origin;

    var CONFIG = {
        apiAbrir: BASE_URL + '/api/paineis/painel15/abrir',
        apiAcompanhar: BASE_URL + '/api/paineis/painel15/acompanhar',
        apiStatus: BASE_URL + '/api/paineis/painel15/status',
        refreshAcompanhamento: 15000
    };

    var estado = {
        enviando: false,
        ultimoChamadoId: null,
        refreshInterval: null,
        telaAtual: 'principal'
    };

    // ========================================
    // INICIALIZACAO
    // ========================================

    function inicializar() {
        console.log('Inicializando Painel 15 - Gatilho de Chamados...');

        configurarNavegacao();
        configurarBotaoEmergencia();
        configurarFormulario();
        configurarConfirmacao();
        configurarAcompanhamento();
        configurarContadorObs();
        atualizarBadgeAtivos();

        console.log('Painel 15 inicializado');
    }

    // ========================================
    // NAVEGACAO ENTRE TELAS
    // ========================================

    function configurarNavegacao() {
        var btnVoltar = document.getElementById('btn-voltar');
        if (btnVoltar) {
            btnVoltar.addEventListener('click', function () {
                window.location.href = '/frontend/dashboard.html';
            });
        }
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
            if (estado.refreshInterval) {
                clearInterval(estado.refreshInterval);
                estado.refreshInterval = null;
            }
        }

        var telaEl = document.getElementById('tela-' + tela);
        if (telaEl) telaEl.scrollTop = 0;
    }

    // ========================================
    // BOTAO DE EMERGENCIA
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
            btnAcompanhar.addEventListener('click', function () {
                mostrarTela('acompanhamento');
            });
        }
    }

    // ========================================
    // FORMULARIO
    // ========================================

    function configurarFormulario() {
        var btnVoltarForm = document.getElementById('btn-voltar-form');
        if (btnVoltarForm) {
            btnVoltarForm.addEventListener('click', function () {
                mostrarTela('principal');
            });
        }

        var form = document.getElementById('form-chamado');
        if (form) {
            form.addEventListener('submit', function (e) {
                e.preventDefault();
                enviarChamado();
            });
        }

        var inputKora = document.getElementById('input-kora');
        if (inputKora) {
            inputKora.addEventListener('input', function () {
                this.value = this.value.replace(/[^0-9]/g, '');
            });
        }
    }

    function configurarContadorObs() {
        var inputObs = document.getElementById('input-obs');
        if (inputObs) {
            inputObs.addEventListener('input', function () {
                var count = document.getElementById('count-obs');
                if (count) count.textContent = this.value.length;
            });
        }
    }

    // ========================================
    // ENVIAR CHAMADO
    // ========================================

    function enviarChamado() {
        if (estado.enviando) return;

        var nome = (document.getElementById('input-nome').value || '').trim();
        var local = (document.getElementById('input-local').value || '').trim();
        var kora = (document.getElementById('input-kora').value || '').trim();
        var obs = (document.getElementById('input-obs').value || '').trim();

        var erros = [];
        if (!nome) erros.push('Informe seu nome');
        if (!local) erros.push('Informe o local do problema');
        if (!kora) erros.push('Informe o numero do chamado Kora');
        else if (!/^[0-9]{6,7}$/.test(kora)) erros.push('Numero Kora deve ter 6 ou 7 digitos');

        if (erros.length > 0) {
            mostrarToast(erros[0], 'erro');
            if (!nome) document.getElementById('input-nome').focus();
            else if (!local) document.getElementById('input-local').focus();
            else document.getElementById('input-kora').focus();
            return;
        }

        estado.enviando = true;
        var btnEnviar = document.getElementById('btn-enviar');
        if (btnEnviar) {
            btnEnviar.disabled = true;
            btnEnviar.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Enviando...';
        }

        var payload = {
            nome_solicitante: nome,
            local_problema: local,
            numero_kora: kora,
            observacao: obs || null
        };

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
                exibirConfirmacao(data.data, payload);
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
            if (navigator.vibrate) navigator.vibrate([200, 100, 200]);
        })
        .finally(function () {
            estado.enviando = false;
            if (btnEnviar) {
                btnEnviar.disabled = false;
                btnEnviar.innerHTML = '<i class="fas fa-paper-plane"></i> Enviar Chamado Emergencial';
            }
        });
    }

    function limparFormulario() {
        document.getElementById('input-nome').value = '';
        document.getElementById('input-local').value = '';
        document.getElementById('input-kora').value = '';
        document.getElementById('input-obs').value = '';
        var count = document.getElementById('count-obs');
        if (count) count.textContent = '0';
    }

    // ========================================
    // CONFIRMACAO
    // ========================================

    function configurarConfirmacao() {
        var btnNovo = document.getElementById('btn-novo-chamado');
        if (btnNovo) {
            btnNovo.addEventListener('click', function () {
                mostrarTela('formulario');
                setTimeout(function () {
                    var input = document.getElementById('input-nome');
                    if (input) input.focus();
                }, 300);
            });
        }

        var btnVer = document.getElementById('btn-ver-chamados');
        if (btnVer) {
            btnVer.addEventListener('click', function () {
                mostrarTela('acompanhamento');
            });
        }

        var btnInicio = document.getElementById('btn-voltar-inicio');
        if (btnInicio) {
            btnInicio.addEventListener('click', function () {
                mostrarTela('principal');
                atualizarBadgeAtivos();
            });
        }
    }

    function exibirConfirmacao(dados, payload) {
        var detalhes = document.getElementById('confirmacao-detalhes');
        if (detalhes) {
            var dataAbrt = dados.data_abertura ? formatarDataHora(dados.data_abertura) : 'Agora';
            detalhes.innerHTML =
                '<strong>ID:</strong> #' + dados.id + '<br>' +
                '<strong>Kora:</strong> ' + escapeHtml(dados.numero_kora) + '<br>' +
                '<strong>Solicitante:</strong> ' + escapeHtml(payload.nome_solicitante) + '<br>' +
                '<strong>Local:</strong> ' + escapeHtml(payload.local_problema) + '<br>' +
                '<strong>Prioridade:</strong> CRITICA (Emergencial)<br>' +
                '<strong>Abertura:</strong> ' + dataAbrt;
        }
        mostrarTela('confirmacao');
    }

    // ========================================
    // ACOMPANHAMENTO
    // ========================================

    function configurarAcompanhamento() {
        var btnVoltar = document.getElementById('btn-voltar-acompanhamento');
        if (btnVoltar) {
            btnVoltar.addEventListener('click', function () {
                mostrarTela('principal');
                atualizarBadgeAtivos();
            });
        }

        var btnRefresh = document.getElementById('btn-refresh-acomp');
        if (btnRefresh) {
            btnRefresh.addEventListener('click', function () {
                carregarAcompanhamento();
                mostrarToast('Atualizado', 'info');
                var icon = this.querySelector('i');
                if (icon) {
                    icon.style.transition = 'transform 0.5s';
                    icon.style.transform = 'rotate(360deg)';
                    setTimeout(function () { icon.style.transition = ''; icon.style.transform = ''; }, 500);
                }
            });
        }
    }

    function carregarAcompanhamento() {
        fetch(CONFIG.apiAcompanhar)
            .then(function (res) { return res.json(); })
            .then(function (data) {
                if (data.success) renderizarAcompanhamento(data.data);
            })
            .catch(function (err) { console.error('Erro ao carregar acompanhamento:', err); });
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
            html += '  <div class="acomp-tempo' + (isLongo ? ' tempo-longo' : '') + '">';
            html += '    <i class="fas fa-stopwatch"></i> ' + tempoStr;
            html += '  </div>';
            html += '</div>';
            html += '<div class="acomp-card-body">';
            html += '  <div class="acomp-campo"><i class="fas fa-user"></i> <strong>' + escapeHtml(ch.nome_solicitante) + '</strong></div>';
            html += '  <div class="acomp-campo"><i class="fas fa-map-marker-alt"></i> ' + escapeHtml(ch.local_problema) + '</div>';
            html += '  <div class="acomp-campo"><i class="fas fa-calendar"></i> ' + dataAbertura + '</div>';
            if (ch.tecnico_atendimento) {
                html += '  <div class="acomp-campo"><i class="fas fa-wrench"></i> Tecnico: <strong>' + escapeHtml(ch.tecnico_atendimento) + '</strong></div>';
            }
            if (ch.status === 'fechado' && ch.data_fechamento) {
                html += '  <div class="acomp-campo"><i class="fas fa-calendar-check"></i> Fechado: ' + formatarDataHora(ch.data_fechamento) + '</div>';
            }
            if (ch.observacao_fechamento) {
                html += '  <div class="acomp-obs"><i class="fas fa-clipboard-check"></i> ' + escapeHtml(ch.observacao_fechamento) + '</div>';
            }
            html += '</div></div>';
            return html;
        }).join('');
    }

    function atualizarBadgeAtivos() {
        fetch(CONFIG.apiAcompanhar)
            .then(function (res) { return res.json(); })
            .then(function (data) {
                if (data.success) {
                    var ativos = (data.data || []).filter(function (ch) {
                        return ch.status === 'aberto' || ch.status === 'em_atendimento';
                    });
                    var badge = document.getElementById('badge-ativos');
                    if (badge) badge.textContent = ativos.length;
                }
            })
            .catch(function () {});
    }

    // ========================================
    // FUNCOES AUXILIARES
    // ========================================

    function formatarStatus(status) {
        var mapa = { 'aberto': 'Aberto', 'em_atendimento': 'Em Atendimento', 'fechado': 'Fechado', 'inativo': 'Inativo' };
        return mapa[status] || status;
    }

    function formatarDataHora(isoString) {
        try {
            var d = new Date(isoString);
            return String(d.getDate()).padStart(2, '0') + '/' + String(d.getMonth() + 1).padStart(2, '0')
                + ' ' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
        } catch (e) { return '--'; }
    }

    function formatarMinutos(minutos) {
        var h = Math.floor(minutos / 60);
        var m = Math.floor(minutos % 60);
        return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0');
    }

    function escapeHtml(text) {
        if (!text) return '';
        var div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    function mostrarToast(mensagem, tipo) {
        var container = document.getElementById('toast-container');
        if (!container) return;
        var toast = document.createElement('div');
        toast.className = 'toast toast-' + (tipo || 'info');
        var icone = '';
        switch (tipo) {
            case 'sucesso': icone = '<i class="fas fa-check-circle"></i>'; break;
            case 'erro': icone = '<i class="fas fa-times-circle"></i>'; break;
            default: icone = '<i class="fas fa-info-circle"></i>';
        }
        toast.innerHTML = icone + ' ' + escapeHtml(mensagem);
        container.appendChild(toast);
        setTimeout(function () { if (toast.parentNode) toast.parentNode.removeChild(toast); }, 4000);
    }

    // ========================================
    // START
    // ========================================

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', inicializar);
    } else {
        inicializar();
    }

})();