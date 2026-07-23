(function () {
    'use strict';

    var CONFIG = {
        apiBase: '/api/paineis/painel50',
        refreshInterval: 60000  // 60 segundos
    };

    var Estado = {
        dados: null,
        carregando: false
    };

    var DOM = {};

    // =========================================================
    // INICIALIZACAO
    // =========================================================

    function inicializar() {
        DOM.setoresGrid       = document.getElementById('setores-grid');
        DOM.statEnfermeiros   = document.getElementById('stat-enfermeiros');
        DOM.statTecnicos      = document.getElementById('stat-tecnicos');
        DOM.statAtivos        = document.getElementById('stat-ativos');
        DOM.statSetores       = document.getElementById('stat-setores');
        DOM.statusIndicador   = document.getElementById('status-indicator');
        DOM.ultimaAtualizacao = document.getElementById('ultima-atualizacao');
        DOM.plantaoBadge      = document.getElementById('plantao-badge');
        DOM.plantaoLabel      = document.getElementById('plantao-label');
        DOM.plantaoHorario    = document.getElementById('plantao-horario');
        DOM.btnRefresh        = document.getElementById('btn-refresh');

        DOM.btnRefresh.addEventListener('click', function () {
            DOM.btnRefresh.classList.add('girando');
            carregarDados();
        });

        carregarDados();
        setInterval(carregarDados, CONFIG.refreshInterval);
    }

    // =========================================================
    // BUSCAR DADOS
    // =========================================================

    function carregarDados() {
        if (Estado.carregando) return;
        Estado.carregando = true;
        setStatus('loading');

        fetch(CONFIG.apiBase + '/dados', { credentials: 'same-origin' })
            .then(function (r) { return r.json(); })
            .then(function (data) {
                if (data.success) {
                    Estado.dados = data;
                    renderizarTudo();
                    setStatus('online');
                } else {
                    mostrarErro(data.error || 'Erro desconhecido');
                    setStatus('loading');
                }
            })
            .catch(function () {
                mostrarErro('Sem conexao com o servidor.');
                setStatus('loading');
            })
            .then(function () {
                Estado.carregando = false;
                DOM.btnRefresh.classList.remove('girando');
                DOM.ultimaAtualizacao.textContent = horaAtual();
            });
    }

    // =========================================================
    // RENDERIZACAO PRINCIPAL
    // =========================================================

    function renderizarTudo() {
        var d = Estado.dados;
        renderizarPlantao(d.plantao);
        renderizarResumo(d.totais);
        renderizarSetores(d.setores);
    }

    function renderizarPlantao(p) {
        var isDiurno = p.tipo === 'D';
        DOM.plantaoLabel.textContent = p.label;
        DOM.plantaoHorario.textContent = p.inicio + ' - ' + p.fim + '  ' + p.dt_plantao_display;
        DOM.plantaoBadge.className = 'plantao-badge ' + (isDiurno ? 'diurno' : 'noturno');
        DOM.plantaoBadge.querySelector('i').className = isDiurno ? 'fas fa-sun' : 'fas fa-moon';
    }

    function renderizarResumo(t) {
        DOM.statEnfermeiros.textContent = t.enfermeiros;
        DOM.statTecnicos.textContent    = t.tecnicos;
        DOM.statAtivos.textContent      = t.ativos_agora;
        DOM.statSetores.textContent     = t.setores_com_ativo;
    }

    function renderizarSetores(setores) {
        if (!setores || setores.length === 0) {
            DOM.setoresGrid.innerHTML = '<div class="loading-container"><i class="fas fa-user-nurse" style="font-size:2rem;color:#ccc;"></i><p>Nenhum profissional registrado neste plantao.</p></div>';
            return;
        }

        var html = '';
        for (var i = 0; i < setores.length; i++) {
            html += htmlSetor(setores[i]);
        }
        DOM.setoresGrid.innerHTML = html;
    }

    // =========================================================
    // HTML DE CADA CARD DE SETOR
    // =========================================================

    function htmlSetor(s) {
        var ativos = s.ativos || [];
        var saidos = s.saidos || [];
        var todos  = ativos.concat(saidos);

        // Contar por tipo (apenas ativos para badges)
        var cEnf = 0, cTec = 0, cOut = 0;
        for (var j = 0; j < todos.length; j++) {
            var t = tipoEsp(todos[j].especialidade);
            if (t === 'enfermeiro') cEnf++;
            else if (t === 'tecnico') cTec++;
            else cOut++;
        }

        var badges = '';
        if (cEnf > 0) badges += '<span class="badge-enf"><i class="fas fa-user-nurse"></i> ' + cEnf + ' Enf</span>';
        if (cTec > 0) badges += '<span class="badge-tec"><i class="fas fa-syringe"></i> ' + cTec + ' Tec</span>';
        if (cOut > 0) badges += '<span class="badge-out">' + cOut + ' Out</span>';

        var listaAtivos = '';
        if (ativos.length > 0) {
            for (var a = 0; a < ativos.length; a++) {
                listaAtivos += htmlProfAtivo(ativos[a]);
            }
        } else {
            listaAtivos = '<p class="sem-profissional">Nenhum ativo no momento</p>';
        }

        var listaSaidos = '';
        if (saidos.length > 0) {
            listaSaidos =
                '<p class="grupo-titulo"><i class="fas fa-circle" style="color:#ccc;"></i> Sairam neste plantao</p>';
            for (var b = 0; b < saidos.length; b++) {
                listaSaidos += htmlProfSaido(saidos[b]);
            }
        }

        return '<div class="setor-card">' +
            '<div class="setor-card-header">' +
                '<div class="setor-nome"><i class="' + iconeSetor(s.setor) + '"></i>' + escHtml(s.setor) + '</div>' +
                '<div class="setor-badges">' + badges + '</div>' +
            '</div>' +
            '<div class="setor-card-body">' +
                '<p class="grupo-titulo"><i class="fas fa-circle" style="color:#28a745;"></i> Ativos agora</p>' +
                listaAtivos +
                listaSaidos +
            '</div>' +
        '</div>';
    }

    function htmlProfAtivo(p) {
        var t = tipoEsp(p.especialidade);
        return '<div class="prof-item">' +
            '<div class="prof-info">' +
                '<span class="prof-dot ativo"></span>' +
                '<span class="prof-nome">' + escHtml(nomeResumido(p.nome)) + '</span>' +
            '</div>' +
            '<div style="display:flex;align-items:center;gap:6px;">' +
                '<span class="prof-esp esp-' + t + '">' + labelEsp(t) + '</span>' +
                '<span class="prof-tempo">' + escHtml(p.logon || '') + '</span>' +
            '</div>' +
        '</div>';
    }

    function htmlProfSaido(p) {
        var t = tipoEsp(p.especialidade);
        return '<div class="prof-item prof-saido">' +
            '<div class="prof-info">' +
                '<span class="prof-dot saido"></span>' +
                '<span class="prof-nome">' + escHtml(nomeResumido(p.nome)) + '</span>' +
            '</div>' +
            '<div style="display:flex;align-items:center;gap:6px;">' +
                '<span class="prof-esp esp-' + t + '">' + labelEsp(t) + '</span>' +
                (p.saida ? '<span class="prof-saiu-badge"><i class="fas fa-arrow-right-from-bracket"></i>' + escHtml(p.saida) + '</span>' : '') +
            '</div>' +
        '</div>';
    }

    // =========================================================
    // HELPERS
    // =========================================================

    function nomeResumido(nome) {
        if (!nome) return '-';
        var partes = nome.trim().replace(/\s+/g, ' ').split(' ');
        if (partes.length <= 2) return capitalizar(partes.join(' '));
        // Primeiro nome + ultimo sobrenome
        return capitalizar(partes[0]) + ' ' + capitalizar(partes[partes.length - 1]);
    }

    function capitalizar(str) {
        var ignorar = ['de', 'da', 'do', 'das', 'dos', 'e'];
        return str.toLowerCase().split(' ').map(function (p, i) {
            if (i > 0 && ignorar.indexOf(p) !== -1) return p;
            return p.charAt(0).toUpperCase() + p.slice(1);
        }).join(' ');
    }

    function tipoEsp(esp) {
        var e = (esp || '').toLowerCase();
        if (e.indexOf('enfermeiro') !== -1) return 'enfermeiro';
        if (e.indexOf('tecnico') !== -1 || e.indexOf('técnico') !== -1) return 'tecnico';
        return 'outro';
    }

    function labelEsp(tipo) {
        if (tipo === 'enfermeiro') return 'ENF';
        if (tipo === 'tecnico')    return 'TÉC';
        return 'OUT';
    }

    function iconeSetor(setor) {
        var s = (setor || '').toUpperCase();
        if (s.indexOf('NEO')        !== -1) return 'fas fa-baby';
        if (s.indexOf('PED')        !== -1) return 'fas fa-child';
        if (s.indexOf('MATERNI')    !== -1) return 'fas fa-heart';
        if (s.indexOf('UTI')        !== -1) return 'fas fa-procedures';
        if (s.indexOf('INTERNACAO') !== -1) return 'fas fa-bed';
        return 'fas fa-hospital';
    }

    function escHtml(str) {
        if (!str) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    function horaAtual() {
        var d = new Date();
        return ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2);
    }

    function setStatus(estado) {
        DOM.statusIndicador.className = 'status-indicator status-' + estado;
    }

    function mostrarErro(msg) {
        DOM.setoresGrid.innerHTML =
            '<div class="erro-container">' +
                '<i class="fas fa-exclamation-triangle" style="font-size:2rem;margin-bottom:8px;"></i>' +
                '<p>' + escHtml(msg) + '</p>' +
            '</div>';
    }

    // =========================================================
    // ARRANQUE
    // =========================================================

    window.addEventListener('DOMContentLoaded', inicializar);

})();
