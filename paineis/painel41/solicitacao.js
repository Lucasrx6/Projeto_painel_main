(function () {
    'use strict';

    function mostrarErro(msg) {
        var DOM = window.P41.DOM;
        DOM.erroForm.textContent   = msg;
        DOM.erroForm.style.display = 'block';
    }

    function resetarForm() {
        var DOM    = window.P41.DOM;
        var Estado = window.P41.Estado;
        if (DOM.selTipoDieta) DOM.selTipoDieta.selectedIndex = 0;
        if (DOM.selRefeicao)  DOM.selRefeicao.selectedIndex  = 0;
        if (DOM.inpObs)       DOM.inpObs.value = '';
        if (DOM.erroForm)     DOM.erroForm.style.display = 'none';
        var chks = document.querySelectorAll('.chk-restricao:checked');
        for (var i = 0; i < chks.length; i++) chks[i].checked = false;
        Estado.urgente = false;
        if (DOM.btnUrgente) DOM.btnUrgente.classList.remove('urgente-ativo');
    }

    function toggleUrgente() {
        var DOM    = window.P41.DOM;
        var Estado = window.P41.Estado;
        Estado.urgente = !Estado.urgente;
        if (Estado.urgente) {
            DOM.btnUrgente.classList.add('urgente-ativo');
        } else {
            DOM.btnUrgente.classList.remove('urgente-ativo');
        }
    }

    function mostrarModalSucesso(codigo) {
        var DOM = window.P41.DOM;
        DOM.modalCodigo.textContent        = codigo;
        DOM.modalSucesso.style.display     = 'flex';
    }

    function fecharModalSucesso() {
        var DOM = window.P41.DOM;
        DOM.modalSucesso.style.display = 'none';
        window.P41.limparPaciente();
    }

    function submeterSolicitacao(e) {
        e.preventDefault();
        var DOM    = window.P41.DOM;
        var Estado = window.P41.Estado;
        var CONFIG = window.P41.CONFIG;

        if (Estado.enviando || !Estado.paciente) return;
        DOM.erroForm.style.display = 'none';

        var tipoDietaId = DOM.selTipoDieta.value;
        var refeicaoId  = DOM.selRefeicao.value;

        if (!tipoDietaId) { mostrarErro('Selecione o tipo de dieta.'); return; }
        if (!refeicaoId)  { mostrarErro('Selecione a refeição.'); return; }

        var restricoesIds   = [];
        var restricoesNomes = [];
        var chks = DOM.listaRestricoes.querySelectorAll('.chk-restricao:checked');
        for (var i = 0; i < chks.length; i++) {
            restricoesIds.push(parseInt(chks[i].value, 10));
            restricoesNomes.push(chks[i].getAttribute('data-nome'));
        }

        var body = {
            nr_atendimento: Estado.paciente.nr_atendimento,
            nm_paciente:    Estado.paciente.nm_paciente,
            leito:          Estado.paciente.leito,
            setor_nome:     Estado.paciente.setor_nome,
            cd_unidade:     Estado.paciente.cd_unidade,
            ds_clinica:     Estado.paciente.ds_clinica,
            dt_nascimento:  Estado.paciente.dt_nascimento || null,
            tipo_dieta_id:  parseInt(tipoDietaId, 10),
            refeicao_id:    parseInt(refeicaoId, 10),
            quantidade:     1,
            restricoes_ids: restricoesIds,
            restricoes_txt: restricoesNomes.join(', '),
            observacao:     DOM.inpObs.value.trim(),
            prioridade:     Estado.urgente ? 'urgente' : 'normal'
        };

        Estado.enviando = true;
        DOM.btnSolicitar.disabled   = true;
        DOM.btnSolicitar.innerHTML  = '<i class="fa-solid fa-spinner fa-spin"></i> Enviando...';

        fetch(CONFIG.apiBase + '/solicitar', {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        })
        .then(function (r) { return r.json(); })
        .then(function (data) {
            Estado.enviando = false;
            DOM.btnSolicitar.disabled  = false;
            DOM.btnSolicitar.innerHTML = '<i class="fa-solid fa-paper-plane"></i> Solicitar Dieta';
            if (data.success) {
                mostrarModalSucesso(data.codigo_entrega);
                window.P41.carregarMinhasSolicitacoes();
            } else {
                mostrarErro(data.error || 'Erro ao enviar solicitação.');
            }
        })
        .catch(function (err) {
            Estado.enviando = false;
            DOM.btnSolicitar.disabled  = false;
            DOM.btnSolicitar.innerHTML = '<i class="fa-solid fa-paper-plane"></i> Solicitar Dieta';
            mostrarErro('Falha na conexão. Tente novamente.');
            console.error(err);
        });
    }

    window.P41.toggleUrgente       = toggleUrgente;
    window.P41.submeterSolicitacao = submeterSolicitacao;
    window.P41.resetarForm         = resetarForm;
    window.P41.mostrarModalSucesso = mostrarModalSucesso;
    window.P41.fecharModalSucesso  = fecharModalSucesso;

})();
