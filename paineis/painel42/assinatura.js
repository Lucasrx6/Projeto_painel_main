(function () {
    'use strict';

    function abrirAssinaturaDigital(sid, nm, nr, refeicao, dieta) {
        var infoExtra = (refeicao || '');
        if (dieta) infoExtra = dieta + (refeicao ? ' — ' + refeicao : '');
        var url = '/painel/painel48'
            + '?contexto=entrega_refeicao'
            + '&ref_id='          + encodeURIComponent(sid      || '')
            + '&ref_tabela=nutricao_solicitacoes'
            + '&nm_paciente='     + encodeURIComponent(nm       || '')
            + '&nr_atendimento='  + encodeURIComponent(nr       || '')
            + '&info_extra='      + encodeURIComponent(infoExtra);
        window.open(url, 'p48_assin_' + sid, 'width=680,height=700,toolbar=0,menubar=0,location=0,scrollbars=1');
    }

    function confirmarEntregaAssinado(sid, assinaturaId) {
        fetch(window.P42.CONFIG.apiBase + '/solicitacoes/' + sid + '/entregar-assinado', {
            method: 'PUT',
            credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ assinatura_id: assinaturaId })
        })
        .then(function (r) { return r.json(); })
        .then(function (data) {
            if (data.success) {
                window.P42.carregarFila();
                window.P42.carregarHistorico();
            } else {
                alert('Erro ao confirmar entrega assinada: ' + (data.error || ''));
            }
        })
        .catch(function (e) {
            console.error('entregar-assinado', e);
            alert('Falha na conexão ao confirmar entrega assinada.');
        });
    }

    window.P42.abrirAssinaturaDigital    = abrirAssinaturaDigital;
    window.P42.confirmarEntregaAssinado  = confirmarEntregaAssinado;

})();
