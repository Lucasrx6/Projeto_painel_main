(function () {
    'use strict';
    var P = window.P35;

    function abrirModalAceitar(btn) {
        if (!P.Estado.padioleiroId) {
            P.toast('Selecione seu nome antes de aceitar um chamado', 'warning');
            return;
        }
        if (P.Estado.chamadoAtivoId) {
            P.toast('Voce ja possui um chamado ativo. Conclua-o primeiro.', 'warning');
            return;
        }

        P.Estado.aceitandoId = btn.dataset.id;

        var body        = document.getElementById('modal-aceitar-body');
        var origemLabel = btn.dataset.setor || '-';
        if (btn.dataset.leito) origemLabel += '  •  Leito ' + btn.dataset.leito;
        body.innerHTML =
            '<div class="modal-chamado-info">' +
            P.criarModalRow('Tipo', btn.dataset.tipo) +
            P.criarModalRow('Paciente', btn.dataset.paciente || 'Nao informado') +
            P.criarModalRow('Setor de Origem', btn.dataset.setor || '-') +
            P.criarModalRow('Leito', btn.dataset.leito || '<span style="color:#aaa;">Nao informado</span>') +
            P.criarModalRow('Destino', btn.dataset.destino) +
            P.criarModalRow('Prioridade', btn.dataset.prio === 'urgente'
                ? '<span style="background:#dc3545;color:white;padding:2px 10px;border-radius:10px;font-size:12px;font-weight:700;">URGENTE</span>'
                : '<span style="background:#d4edda;color:#155724;padding:2px 10px;border-radius:10px;font-size:12px;">Normal</span>') +
            '</div>';

        document.getElementById('modal-aceitar').style.display = '';
    }

    function fecharModalAceitar() {
        document.getElementById('modal-aceitar').style.display = 'none';
        P.Estado.aceitandoId = null;
    }

    function confirmarAceite() {
        var id = P.Estado.aceitandoId;
        if (!id || !P.Estado.padioleiroId) return;

        var btn = document.getElementById('btn-aceitar-sim');
        btn.disabled  = true;
        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Aceitando...';

        fetch(P.CONFIG.api.aceitar.replace('{id}', id), {
            method: 'PUT',
            credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ padioleiro_id: parseInt(P.Estado.padioleiroId) })
        })
        .then(function (r) { return r.json(); })
        .then(function (data) {
            fecharModalAceitar();
            if (data.success) {
                P.toast('Chamado aceito! Va ate o setor.', 'success');
                P.carregarFila();
            } else {
                P.toast(data.error || 'Erro ao aceitar chamado', 'error');
            }
        })
        .catch(function () { P.toast('Erro de conexao', 'error'); })
        .finally(function () {
            btn.disabled  = false;
            btn.innerHTML = '<i class="fas fa-check"></i> Aceitar';
        });
    }

    function abrirModalCancelarPad(id) {
        P.Estado.chamadoCancelarId = id;
        document.getElementById('motivo-cancelamento-pad').value = '';
        document.getElementById('modal-cancelar').style.display = '';
    }

    function fecharModalCancelarPad() {
        document.getElementById('modal-cancelar').style.display = 'none';
        P.Estado.chamadoCancelarId = null;
    }

    function confirmarCancelamentoPad() {
        var id = P.Estado.chamadoCancelarId;
        if (!id) return;
        if (!P.Estado.padioleiroId) {
            P.toast('Selecione seu nome antes de cancelar um chamado', 'warning');
            return;
        }

        var motivo = document.getElementById('motivo-cancelamento-pad').value.trim();
        if (motivo.length < 10) {
            P.toast('O motivo do cancelamento deve ter pelo menos 10 caracteres', 'warning');
            return;
        }

        var btn = document.getElementById('btn-cancelar-pad-sim');
        btn.disabled  = true;
        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Cancelando...';

        fetch(P.CONFIG.api.cancelar.replace('{id}', id), {
            method: 'PUT',
            credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                padioleiro_id: parseInt(P.Estado.padioleiroId),
                motivo: motivo
            })
        })
        .then(function (r) { return r.json(); })
        .then(function (data) {
            fecharModalCancelarPad();
            if (data.success) {
                P.toast('Chamado cancelado com sucesso.', 'success');
                if (id === P.Estado.chamadoAtivoId) P.Estado.chamadoAtivoId = null;
                P.carregarFila();
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

    P.abrirModalAceitar        = abrirModalAceitar;
    P.fecharModalAceitar       = fecharModalAceitar;
    P.confirmarAceite          = confirmarAceite;
    P.abrirModalCancelarPad    = abrirModalCancelarPad;
    P.fecharModalCancelarPad   = fecharModalCancelarPad;
    P.confirmarCancelamentoPad = confirmarCancelamentoPad;
})();
