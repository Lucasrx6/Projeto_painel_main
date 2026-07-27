(function () {
    'use strict';

    function fecharModal() {
        document.getElementById('modal-edicao').style.display = 'none';
        window.P36.Estado.modalContexto = null;
        window.P36.Estado.modalId       = null;
    }

    function salvarModal() {
        var P   = window.P36;
        var E   = P.Estado;
        if (E.salvando) return;
        var ctx  = E.modalContexto;
        var id   = E.modalId;
        var btn  = document.getElementById('btn-modal-salvar');
        var nome = (document.getElementById('mf-nome').value || '').trim();
        var body = {};

        if (ctx === 'padioleiro') {
            if (!nome) { P.toast('Nome e obrigatorio', 'warning'); return; }
            body = { nome: nome, matricula: (document.getElementById('mf-matricula').value || '').trim(), turno: document.getElementById('mf-turno').value };

        } else if (ctx === 'tipo') {
            if (!nome) { P.toast('Nome e obrigatorio', 'warning'); return; }
            body = { nome: nome, icone: (document.getElementById('mf-icone').value || '').trim(), cor: document.getElementById('mf-cor').value, ordem: parseInt(document.getElementById('mf-ordem').value) || 0 };

        } else if (ctx === 'destino') {
            var tipoId = document.getElementById('mf-tipo-id').value;
            if (!nome || !tipoId) { P.toast('Nome e tipo sao obrigatorios', 'warning'); return; }
            body = { nome: nome, tipo_movimento_id: parseInt(tipoId), ordem: parseInt(document.getElementById('mf-ordem').value) || 0 };

        } else if (ctx === 'origem') {
            if (!nome) { P.toast('Nome e obrigatorio', 'warning'); return; }
            body = { nome: nome, ordem: parseInt(document.getElementById('mf-ordem').value) || 0 };
        }

        var urlMap = {
            padioleiro: P.CONFIG.api.cfgPadioleiros,
            tipo:       P.CONFIG.api.cfgTipos,
            destino:    P.CONFIG.api.cfgDestinos,
            origem:     P.CONFIG.api.cfgOrigens
        };
        var url = urlMap[ctx] + (id ? '/' + id : '');

        E.salvando   = true;
        btn.disabled = true;
        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Salvando...';

        fetch(url, {
            method: id ? 'PUT' : 'POST',
            credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        })
        .then(function (r) { return r.json(); })
        .then(function (data) {
            if (data.success) {
                P.toast(id ? 'Atualizado com sucesso' : 'Cadastrado com sucesso', 'success');
                fecharModal();
                P.carregarConfigAtual();
            } else {
                P.toast(data.error || 'Erro ao salvar', 'error');
            }
        })
        .catch(function () { P.toast('Erro de conexao', 'error'); })
        .finally(function () {
            E.salvando   = false;
            btn.disabled = false;
            btn.innerHTML = '<i class="fas fa-save"></i> Salvar';
        });
    }

    function abrirModalCancelarGestao(id) {
        window.P36.Estado.chamadoCancelarId = id;
        document.getElementById('motivo-cancelamento-gestao').value = '';
        document.getElementById('modal-cancelar').style.display = '';
    }

    function fecharModalCancelarGestao() {
        document.getElementById('modal-cancelar').style.display = 'none';
        window.P36.Estado.chamadoCancelarId = null;
    }

    function confirmarCancelamentoGestao() {
        var P  = window.P36;
        var id = P.Estado.chamadoCancelarId;
        if (!id) return;
        var motivo = document.getElementById('motivo-cancelamento-gestao').value.trim();
        if (motivo.length < 10) {
            P.toast('O motivo do cancelamento deve ter pelo menos 10 caracteres', 'warning');
            return;
        }
        var btn = document.getElementById('btn-cancelar-gestao-sim');
        btn.disabled  = true;
        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Cancelando...';

        fetch(P.CONFIG.api.cancelar.replace('{id}', id), {
            method: 'PUT',
            credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ motivo: motivo })
        })
        .then(function (r) { return r.json(); })
        .then(function (data) {
            fecharModalCancelarGestao();
            if (data.success) {
                P.toast('Chamado cancelado com sucesso.', 'success');
                P.carregarAbaAtual();
            } else {
                P.toast(data.error || 'Erro ao cancelar chamado', 'error');
            }
        })
        .catch(function () { P.toast('Erro de conexao', 'error'); })
        .finally(function () {
            btn.disabled  = false;
            btn.innerHTML = '<i class="fas fa-times"></i> Confirmar Cancelamento';
        });
    }

    window.P36.fecharModal                 = fecharModal;
    window.P36.salvarModal                 = salvarModal;
    window.P36.abrirModalCancelarGestao    = abrirModalCancelarGestao;
    window.P36.fecharModalCancelarGestao   = fecharModalCancelarGestao;
    window.P36.confirmarCancelamentoGestao = confirmarCancelamentoGestao;

})();
