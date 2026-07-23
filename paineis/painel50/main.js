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
        var tipo   = tipoSetor(s.setor);

        // Contagem por especialidade
        var cEnf = 0, cTec = 0, cOut = 0;
        for (var j = 0; j < ativos.length; j++) {
            var t = tipoEsp(ativos[j].especialidade);
            if (t === 'enfermeiro')    cEnf++;
            else if (t === 'tecnico')  cTec++;
            else                       cOut++;
        }

        // Linha de composição
        var comp = '';
        if (cEnf > 0) comp += '<span class="comp-item comp-enf"><i class="fas fa-user-nurse"></i> ' + cEnf + ' ENF</span>';
        if (cTec > 0) {
            if (comp) comp += '<span class="comp-sep">·</span>';
            comp += '<span class="comp-item comp-tec"><i class="fas fa-syringe"></i> ' + cTec + ' TÉC</span>';
        }
        if (cOut > 0) {
            if (comp) comp += '<span class="comp-sep">·</span>';
            comp += '<span class="comp-item comp-out">' + cOut + ' outros</span>';
        }
        if (!comp) comp = '<span class="comp-vazio">Sem profissionais</span>';

        // Lista de ativos
        var lista = '';
        if (ativos.length > 0) {
            for (var a = 0; a < ativos.length; a++) {
                lista += htmlProfItem(ativos[a]);
            }
        } else {
            lista = '<p class="sem-profissional">Nenhum ativo no momento</p>';
        }

        // Saídos no mesmo card (sem título, apenas horário de saída)
        var saidos = s.saidos || [];
        if (saidos.length > 0) {
            lista += '<div class="saidos-divider"></div>';
            for (var b = 0; b < saidos.length; b++) {
                lista += htmlProfSaido(saidos[b]);
            }
        }

        return '<div class="setor-card setor-' + tipo + '">' +
            '<div class="setor-header-band">' +
                '<div class="setor-header-left">' +
                    '<i class="' + iconeSetor(s.setor) + ' setor-icone"></i>' +
                    '<span class="setor-nome-texto">' + escHtml(s.setor) + '</span>' +
                '</div>' +
                '<div class="setor-total-num">' + ativos.length + '</div>' +
            '</div>' +
            '<div class="setor-composicao">' + comp + '</div>' +
            '<div class="setor-lista">' + lista + '</div>' +
        '</div>';
    }

    function htmlProfItem(p) {
        var t     = tipoEsp(p.especialidade);
        var tempo = p.tempo || (p.logon ? 'desde ' + p.logon : '');
        return '<div class="prof-row">' +
            '<div class="prof-left">' +
                '<span class="prof-dot-new ativo"></span>' +
                '<span class="prof-nome-new">' + escHtml(nomeResumido(p.nome)) + '</span>' +
            '</div>' +
            '<div class="prof-right">' +
                '<span class="prof-badge-new ' + t + '">' + labelEsp(t, p.especialidade) + '</span>' +
                (tempo ? '<span class="prof-dur-new">' + escHtml(tempo) + '</span>' : '') +
            '</div>' +
        '</div>';
    }

    function htmlProfSaido(p) {
        return '<div class="prof-row saido">' +
            '<div class="prof-left">' +
                '<span class="prof-dot-new saido"></span>' +
                '<span class="prof-nome-new">' + escHtml(nomeResumido(p.nome)) + '</span>' +
            '</div>' +
            (p.saida ? '<span class="prof-saiu-time">saiu ' + escHtml(p.saida) + '</span>' : '') +
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

    function tipoSetor(nome) {
        var n = (nome || '').toUpperCase();
        if (n.indexOf('NEO')        !== -1) return 'neo';
        if (n.indexOf('PED')        !== -1) return 'ped';
        if (n.indexOf('UTI')        !== -1) return 'uti';
        if (n.indexOf('MATERNI')    !== -1) return 'maternidade';
        if (n.indexOf('INTERNACAO') !== -1 || n.indexOf('INTERNAÇÃO') !== -1) return 'internacao';
        return 'outro';
    }

    function tipoEsp(esp) {
        var e = (esp || '').toLowerCase();
        if (e.indexOf('enfermeiro') !== -1) return 'enfermeiro';
        if (e.indexOf('tecnico') !== -1 || e.indexOf('técnico') !== -1) return 'tecnico';
        return 'outro';
    }

    function labelEsp(tipo, espRaw) {
        if (tipo === 'enfermeiro') return 'ENF';
        if (tipo === 'tecnico')    return 'TÉC';
        if (espRaw) return capitalizar(espRaw.split(' ')[0]);
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
