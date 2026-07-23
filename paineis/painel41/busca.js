(function () {
    'use strict';

    var _buscaGen = 0;

    function _formatarNascimento(dtNasc) {
        if (!dtNasc) return null;
        var partes = String(dtNasc).split('-');
        if (partes.length !== 3) return dtNasc;
        var hoje = new Date();
        var anos = hoje.getFullYear() - parseInt(partes[0], 10);
        var mes  = hoje.getMonth() + 1 - parseInt(partes[1], 10);
        var dia  = hoje.getDate()  - parseInt(partes[2], 10);
        if (mes < 0 || (mes === 0 && dia < 0)) anos--;
        return partes[2] + '/' + partes[1] + '/' + partes[0] + ' (' + anos + ' anos)';
    }

    function renderListaPacientes(lista) {
        var DOM     = window.P41.DOM;
        var escHtml = window.P41.escHtml;

        if (!lista.length) {
            DOM.listaPacientes.innerHTML =
                '<div class="pac-nenhum">' +
                    '<i class="fas fa-circle-xmark pac-nenhum-icon"></i>' +
                    '<span>Nenhum paciente encontrado para esta busca.</span>' +
                    '<span class="pac-nenhum-dica">Use o botão abaixo para informar manualmente.</span>' +
                '</div>';
            return;
        }
        var html = '';
        for (var i = 0; i < lista.length; i++) {
            var p = lista[i];
            html += '<div class="pac-item" data-idx="' + i + '">' +
                '<div class="pac-item-nome">' + escHtml(p.nm_paciente) + '</div>' +
                '<div class="pac-item-info">' +
                    '<span><i class="fa-solid fa-bed"></i> ' + escHtml(p.leito || '--') + '</span>' +
                    '<span><i class="fa-solid fa-hospital"></i> ' + escHtml(p.setor_nome || '--') + '</span>' +
                '</div>' +
            '</div>';
        }
        DOM.listaPacientes.innerHTML = html;

        var items = DOM.listaPacientes.querySelectorAll('.pac-item');
        for (var j = 0; j < items.length; j++) {
            (function (idx) {
                items[idx].addEventListener('click', function () {
                    selecionarPaciente(lista[idx]);
                });
            })(j);
        }
    }

    function buscarPaciente() {
        var DOM    = window.P41.DOM;
        var CONFIG = window.P41.CONFIG;
        var q      = DOM.inputBusca.value.trim();
        if (q.length < CONFIG.minCharsSearch) {
            DOM.listaPacientes.innerHTML = '';
            DOM.spinnerBusca.style.display = 'none';
            return;
        }
        _buscaGen++;
        var gen = _buscaGen;
        DOM.spinnerBusca.style.display = 'inline-block';

        fetch(CONFIG.apiBase + '/pacientes?q=' + encodeURIComponent(q), { credentials: 'same-origin' })
            .then(function (r) { return r.json(); })
            .then(function (data) {
                if (gen !== _buscaGen) return;
                DOM.spinnerBusca.style.display = 'none';
                renderListaPacientes(data.pacientes || []);
            })
            .catch(function (e) {
                if (gen !== _buscaGen) return;
                DOM.spinnerBusca.style.display = 'none';
                console.error('busca pacientes', e);
            });
    }

    function abrirFormManual() {
        var DOM = window.P41.DOM;
        DOM.formManual.style.display        = 'block';
        DOM.linkManualWrapper.style.display = 'none';
        DOM.listaPacientes.innerHTML        = '';
        DOM.manualNome.value                = '';
        DOM.manualAtend.value               = '';
        DOM.manualLeito.value               = '';
        if (DOM.manualNasc) DOM.manualNasc.value = '';
        DOM.manualSetor.selectedIndex        = 0;
        DOM.manualErro.style.display         = 'none';
        DOM.manualNome.focus();
    }

    function fecharFormManual() {
        var DOM = window.P41.DOM;
        DOM.formManual.style.display        = 'none';
        DOM.linkManualWrapper.style.display = 'block';
    }

    function confirmarManual() {
        var DOM   = window.P41.DOM;
        var nome  = DOM.manualNome.value.trim();
        var atend = DOM.manualAtend.value.trim();
        var nasc  = DOM.manualNasc ? DOM.manualNasc.value.trim() : '';
        var setor = DOM.manualSetor.value.trim();

        if (!nome) {
            DOM.manualErro.textContent = 'Nome do paciente é obrigatório.';
            DOM.manualErro.style.display = 'block';
            DOM.manualNome.focus();
            return;
        }
        if (!atend) {
            DOM.manualErro.textContent = 'Nº de atendimento é obrigatório.';
            DOM.manualErro.style.display = 'block';
            DOM.manualAtend.focus();
            return;
        }
        if (!nasc) {
            DOM.manualErro.textContent = 'Data de nascimento é obrigatória.';
            DOM.manualErro.style.display = 'block';
            if (DOM.manualNasc) DOM.manualNasc.focus();
            return;
        }
        if (!setor) {
            DOM.manualErro.textContent = 'Setor é obrigatório.';
            DOM.manualErro.style.display = 'block';
            DOM.manualSetor.focus();
            return;
        }
        DOM.formManual.style.display = 'none';
        selecionarPaciente({
            nm_paciente:    nome,
            nr_atendimento: atend,
            leito:          DOM.manualLeito.value.trim() || '--',
            setor_nome:     setor,
            cd_unidade:     null,
            ds_clinica:     null,
            dias_internado: null,
            dt_nascimento:  nasc,
            _manual:        true
        });
    }

    function selecionarPaciente(p) {
        var DOM    = window.P41.DOM;
        var Estado = window.P41.Estado;
        Estado.paciente = p;
        DOM.listaPacientes.innerHTML        = '';
        DOM.inputBusca.value                = '';
        DOM.linkManualWrapper.style.display = 'none';
        DOM.formManual.style.display        = 'none';

        DOM.pacNome.textContent  = p.nm_paciente || '--';
        DOM.pacLeito.textContent = p.leito        || '--';
        DOM.pacSetor.textContent = p.setor_nome   || '--';

        var nascFormatado = _formatarNascimento(p.dt_nascimento);
        if (DOM.pacNasc)      DOM.pacNasc.textContent = nascFormatado || '--';
        if (DOM.cardInfoNasc) DOM.cardInfoNasc.style.display = nascFormatado ? '' : 'none';

        if (p._manual) {
            DOM.badgeManual.style.display   = 'inline-block';
            DOM.cardInfoExtra.style.display = 'none';
        } else {
            DOM.badgeManual.style.display   = 'none';
            DOM.cardInfoExtra.style.display = '';
            DOM.pacClinica.textContent = p.ds_clinica    || '--';
            DOM.pacDias.textContent    = p.dias_internado != null ? p.dias_internado : '--';
        }

        DOM.cardPaciente.style.display   = 'block';
        DOM.avisoSelecione.style.display = 'none';
        DOM.formSolicitar.style.display  = 'block';
    }

    function limparPaciente() {
        var DOM    = window.P41.DOM;
        var Estado = window.P41.Estado;
        Estado.paciente = null;
        DOM.cardPaciente.style.display      = 'none';
        DOM.avisoSelecione.style.display    = 'block';
        DOM.formSolicitar.style.display     = 'none';
        DOM.badgeManual.style.display       = 'none';
        DOM.cardInfoExtra.style.display     = '';
        DOM.linkManualWrapper.style.display = 'block';
        DOM.formManual.style.display        = 'none';
        DOM.inputBusca.value                = '';
        DOM.listaPacientes.innerHTML        = '';
        window.P41.resetarForm();
    }

    window.P41.buscarPaciente  = buscarPaciente;
    window.P41.abrirFormManual = abrirFormManual;
    window.P41.fecharFormManual = fecharFormManual;
    window.P41.confirmarManual  = confirmarManual;
    window.P41.selecionarPaciente = selecionarPaciente;
    window.P41.limparPaciente   = limparPaciente;

})();
