(function () {
    'use strict';
    var P = window.P35;

    function renderizarChamadoAtivo(chamado) {
        var secao = document.getElementById('secao-chamado-ativo');
        if (!chamado) {
            secao.style.display = 'none';
            P.Estado.chamadoAtivoId = null;
            return;
        }
        secao.style.display = '';
        P.Estado.chamadoAtivoId = chamado.id;

        var isAceito = chamado.status === 'aceito';
        var isTrans  = chamado.status === 'em_transporte';

        document.getElementById('icone-ativo').className = isAceito
            ? 'fas fa-check-circle' : 'fas fa-person-walking icone-vaivem';
        document.getElementById('titulo-ativo').textContent = isAceito
            ? 'Chamado Aceito' : 'Em Transporte';

        var espera = chamado.minutos_espera ? Math.round(chamado.minutos_espera) + ' min' : '--';

        var html =
            '<div class="ativo-header status-' + chamado.status + '">' +
                '<span class="ativo-status-badge badge-' + chamado.status + '">' +
                    (isAceito ? '<i class="fas fa-check"></i> Aceito' : '<i class="fas fa-running"></i> Em Transporte') +
                '</span>' +
                (chamado.prioridade === 'urgente'
                    ? '<span style="background:#dc3545;color:white;padding:3px 12px;border-radius:12px;font-size:12px;font-weight:700;"><i class="fas fa-bolt"></i> URGENTE</span>'
                    : '<span class="ativo-timer"><i class="fas fa-clock"></i> ' + espera + '</span>') +
            '</div>' +
            '<div class="ativo-body">' +
                '<div class="ativo-tipo">' + P.escHtml(chamado.tipo_movimento_nome || '-') + '</div>' +
                '<div class="ativo-paciente">' +
                    P.escHtml(chamado.nm_paciente || 'Paciente nao informado') +
                    (chamado.leito_origem ? ' <small>Leito ' + P.escHtml(chamado.leito_origem) + '</small>' : '') +
                    (chamado.nr_atendimento ? '<br><small style="color:#aaa;">Atend. ' + P.escHtml(chamado.nr_atendimento) + '</small>' : '') +
                '</div>' +
                '<div class="ativo-rota">' +
                    '<i class="fas fa-map-marker-alt" style="color:#dc3545;"></i>' +
                    '<span class="ativo-rota-origem">' + P.escHtml(chamado.setor_origem_nome || '-') + '</span>' +
                    '<span class="ativo-rota-seta"><i class="fas fa-long-arrow-alt-right"></i></span>' +
                    '<span class="ativo-rota-destino">' + P.escHtml(chamado.destino_nome || '-') + '</span>' +
                    (chamado.destino_complemento ? ' <small>(' + P.escHtml(chamado.destino_complemento) + ')</small>' : '') +
                '</div>' +
                (chamado.observacao ? '<div class="ativo-obs"><i class="fas fa-info-circle"></i> ' + P.escHtml(chamado.observacao) + '</div>' : '') +
                '<div style="font-size:12px;color:#aaa;">Solicitado por: ' + P.escHtml(chamado.solicitante_nome || '-') + '</div>' +
            '</div>' +
            '<div class="ativo-acoes">' +
                (isAceito
                    ? '<button class="btn-acao btn-iniciar" id="btn-iniciar-trans"><i class="fas fa-running"></i> Iniciar Transporte</button>'
                    : '') +
                (isTrans
                    ? '<button class="btn-acao btn-concluir" id="btn-concluir-trans"><i class="fas fa-check-double"></i> Concluir Transporte</button>'
                    : '') +
                '<button class="btn-acao btn-cancelar-pad" id="btn-cancelar-ativo" style="background:var(--danger);color:white;margin-top:10px;"><i class="fas fa-times"></i> Cancelar Chamado</button>' +
            '</div>';

        document.getElementById('chamado-ativo-card').innerHTML = html;

        var btnIniciar  = document.getElementById('btn-iniciar-trans');
        var btnConcluir = document.getElementById('btn-concluir-trans');
        var btnCancelar = document.getElementById('btn-cancelar-ativo');

        if (btnIniciar)  btnIniciar.addEventListener('click',  function () { executarAcao('iniciar',  chamado.id, btnIniciar); });
        if (btnConcluir) btnConcluir.addEventListener('click', function () { executarAcao('concluir', chamado.id, btnConcluir); });
        if (btnCancelar) btnCancelar.addEventListener('click', function () { P.abrirModalCancelarPad(chamado.id); });
    }

    function executarAcao(acao, id, btn) {
        if (P.Estado.agindo) return;
        P.Estado.agindo = true;
        btn.disabled = true;
        var textoOriginal = btn.innerHTML;
        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Aguarde...';

        var url = (acao === 'iniciar' ? P.CONFIG.api.iniciar : P.CONFIG.api.concluir).replace('{id}', id);
        fetch(url, {
            method: 'PUT',
            credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ padioleiro_id: P.Estado.padioleiroId })
        })
        .then(function (r) { return r.json(); })
        .then(function (data) {
            if (data.success) {
                P.toast(data.message || 'Acao realizada com sucesso', 'success');
                if (acao === 'concluir') P.Estado.chamadoAtivoId = null;
                P.carregarFila();
            } else {
                P.toast(data.error || 'Erro na acao', 'error');
                btn.disabled = false;
                btn.innerHTML = textoOriginal;
            }
        })
        .catch(function () {
            P.toast('Erro de conexao', 'error');
            btn.disabled = false;
            btn.innerHTML = textoOriginal;
        })
        .finally(function () { P.Estado.agindo = false; });
    }

    function criarModalRow(label, value) {
        return '<div class="modal-row"><span class="modal-label">' + P.escHtml(label) + '</span><span class="modal-value">' + (value || '-') + '</span></div>';
    }

    P.renderizarChamadoAtivo = renderizarChamadoAtivo;
    P.executarAcao           = executarAcao;
    P.criarModalRow          = criarModalRow;
})();
