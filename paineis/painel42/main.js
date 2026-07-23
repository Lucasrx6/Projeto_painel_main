(function () {
    'use strict';

    function inicializar() {
        var P42    = window.P42;
        var DOM    = P42.DOM;
        var CONFIG = P42.CONFIG;
        var Estado = P42.Estado;

        // ── Referências DOM ───────────────────────────────────────────────────

        DOM.selVisualizacao   = document.getElementById('sel-visualizacao');
        DOM.ultimoUpdate      = document.getElementById('ultimo-update');
        DOM.historicoBody     = document.getElementById('historico-body');
        DOM.iconeToggle       = document.getElementById('icone-toggle');
        DOM.tbodyHistorico    = document.getElementById('tbody-historico');
        DOM.histEmpty         = document.getElementById('hist-empty');
        DOM.badgeHistorico    = document.getElementById('badge-historico');
        DOM.filtroSetor42     = document.getElementById('filtro-setor-42');
        DOM.audioAlerta       = document.getElementById('audio-alerta');
        DOM.chkImprimirAceitar = document.getElementById('chk-imprimir-aceitar');
        DOM.btnNotifToggle    = document.getElementById('btn-notif-toggle');
        DOM.iconeNotif        = document.getElementById('icone-notif');

        // modais
        DOM.modalAceitar      = document.getElementById('modal-aceitar');
        DOM.accSid            = document.getElementById('acc-sid');
        DOM.accDesc           = document.getElementById('acc-desc');
        DOM.accSelMembro      = document.getElementById('acc-sel-membro');
        DOM.accErro           = document.getElementById('acc-erro');
        DOM.btnAccConfirmar   = document.getElementById('btn-acc-confirmar');

        DOM.modalEntregar     = document.getElementById('modal-entregar');
        DOM.entrSid           = document.getElementById('entr-sid');
        DOM.entrDesc          = document.getElementById('entr-desc');
        DOM.inpCodigoConfirm  = document.getElementById('inp-codigo-confirm');
        DOM.codigoFeedback    = document.getElementById('codigo-feedback');
        DOM.entrObs           = document.getElementById('entr-obs');
        DOM.entrErro          = document.getElementById('entr-erro');
        DOM.btnEntrConfirmar  = document.getElementById('btn-entr-confirmar');

        DOM.modalEditar       = document.getElementById('modal-editar');
        DOM.editSid           = document.getElementById('edit-sid');
        DOM.editDesc          = document.getElementById('edit-desc');
        DOM.editTipoDieta     = document.getElementById('edit-tipo-dieta');
        DOM.editRefeicao      = document.getElementById('edit-refeicao');
        DOM.editObs           = document.getElementById('edit-obs');
        DOM.editErro          = document.getElementById('edit-erro');
        DOM.btnEditConfirmar  = document.getElementById('btn-edit-confirmar');

        DOM.modalVoltar       = document.getElementById('modal-voltar');
        DOM.voltSid           = document.getElementById('volt-sid');
        DOM.voltDesc          = document.getElementById('volt-desc');
        DOM.voltInfo          = document.getElementById('volt-info');
        DOM.voltMotivo        = document.getElementById('volt-motivo');
        DOM.voltErro          = document.getElementById('volt-erro');
        DOM.btnVoltConfirmar  = document.getElementById('btn-volt-confirmar');

        DOM.modalCancelar     = document.getElementById('modal-cancelar');
        DOM.cancSid           = document.getElementById('canc-sid');
        DOM.cancDesc          = document.getElementById('canc-desc');
        DOM.cancMotivo        = document.getElementById('canc-motivo');
        DOM.cancErro          = document.getElementById('canc-erro');
        DOM.btnCancConfirmar  = document.getElementById('btn-canc-confirmar');

        DOM.modalProtocolo    = document.getElementById('modal-protocolo');
        DOM.protDesc          = document.getElementById('prot-desc');
        DOM.protSetor         = document.getElementById('prot-setor');

        DOM.modalRelatorioHist   = document.getElementById('modal-relatorio-hist');
        DOM.chkIncluirCancelados = document.getElementById('chk-incluir-cancelados');

        DOM.modalDetalheHist  = document.getElementById('modal-detalhe-hist');
        DOM.detalheHistCorpo  = document.getElementById('detalhe-hist-corpo');

        // ── Restaurar preferências locais ─────────────────────────────────────

        var vizSalva = localStorage.getItem('p42_visualizacao');
        if (vizSalva && DOM.selVisualizacao) {
            Estado.visualizacao = vizSalva;
            DOM.selVisualizacao.value = vizSalva;
        }

        var imprimirSalvo = localStorage.getItem('p42_imprimir_aceitar');
        if (DOM.chkImprimirAceitar) {
            DOM.chkImprimirAceitar.checked = (imprimirSalvo === 'true');
        }

        // ── Eventos gerais ────────────────────────────────────────────────────

        document.getElementById('btn-voltar-hub').addEventListener('click', function () {
            window.location.href = '/painel/painel44';
        });

        DOM.selVisualizacao.addEventListener('change', function () {
            Estado.visualizacao = this.value;
            localStorage.setItem('p42_visualizacao', this.value);
            P42.carregarFila();
        });

        if (DOM.chkImprimirAceitar) {
            DOM.chkImprimirAceitar.addEventListener('change', function () {
                localStorage.setItem('p42_imprimir_aceitar', this.checked ? 'true' : 'false');
            });
        }

        DOM.btnNotifToggle.addEventListener('click', function () {
            P42.pedirPermissaoNotif();
        });

        document.getElementById('btn-protocolo').addEventListener('click', function () {
            P42.abrirModalProtocolo();
        });

        // ── Histórico ─────────────────────────────────────────────────────────

        document.getElementById('btn-toggle-historico').addEventListener('click', function (e) {
            if (e.target.closest('#hist-filtro-wrapper')) return;
            P42.toggleHistorico();
        });

        DOM.filtroSetor42.addEventListener('change', function () {
            P42.renderHistorico();
        });

        document.getElementById('btn-relatorio-hist').addEventListener('click', function (e) {
            e.stopPropagation();
            DOM.modalRelatorioHist.style.display = 'flex';
        });

        document.getElementById('btn-rel-confirmar').addEventListener('click', function () {
            P42.fecharModal(DOM.modalRelatorioHist);
            P42.gerarRelatorioHistorico(DOM.chkIncluirCancelados.checked);
        });

        document.getElementById('btn-rel-fechar').addEventListener('click', function () {
            P42.fecharModal(DOM.modalRelatorioHist);
        });

        DOM.modalRelatorioHist.addEventListener('click', function (e) {
            if (e.target === DOM.modalRelatorioHist) P42.fecharModal(DOM.modalRelatorioHist);
        });

        document.getElementById('btn-detalhe-hist-fechar').addEventListener('click', function () {
            P42.fecharModal(DOM.modalDetalheHist);
        });

        DOM.modalDetalheHist.addEventListener('click', function (e) {
            if (e.target === DOM.modalDetalheHist) P42.fecharModal(DOM.modalDetalheHist);
        });

        // ── Modal: Aceitar ────────────────────────────────────────────────────

        DOM.btnAccConfirmar.addEventListener('click', function () {
            P42.confirmarAceitar();
        });

        document.getElementById('btn-acc-fechar').addEventListener('click', function () {
            P42.fecharModal(DOM.modalAceitar);
        });

        DOM.modalAceitar.addEventListener('click', function (e) {
            if (e.target === DOM.modalAceitar) P42.fecharModal(DOM.modalAceitar);
        });

        // ── Modal: Entregar ───────────────────────────────────────────────────

        DOM.inpCodigoConfirm.addEventListener('input', function () {
            P42.validarCodigoInput();
        });

        DOM.btnEntrConfirmar.addEventListener('click', function () {
            P42.confirmarEntrega();
        });

        document.getElementById('btn-entr-fechar').addEventListener('click', function () {
            P42.fecharModal(DOM.modalEntregar);
        });

        DOM.modalEntregar.addEventListener('click', function (e) {
            if (e.target === DOM.modalEntregar) P42.fecharModal(DOM.modalEntregar);
        });

        // ── Modal: Editar ─────────────────────────────────────────────────────

        DOM.btnEditConfirmar.addEventListener('click', function () {
            P42.confirmarEditar();
        });

        document.getElementById('btn-edit-fechar').addEventListener('click', function () {
            P42.fecharModal(DOM.modalEditar);
        });

        DOM.modalEditar.addEventListener('click', function (e) {
            if (e.target === DOM.modalEditar) P42.fecharModal(DOM.modalEditar);
        });

        // ── Modal: Voltar Status ──────────────────────────────────────────────

        DOM.btnVoltConfirmar.addEventListener('click', function () {
            P42.confirmarVoltarStatus();
        });

        document.getElementById('btn-volt-fechar').addEventListener('click', function () {
            P42.fecharModal(DOM.modalVoltar);
        });

        DOM.modalVoltar.addEventListener('click', function (e) {
            if (e.target === DOM.modalVoltar) P42.fecharModal(DOM.modalVoltar);
        });

        // ── Modal: Cancelar ───────────────────────────────────────────────────

        DOM.btnCancConfirmar.addEventListener('click', function () {
            P42.confirmarCancelar();
        });

        document.getElementById('btn-canc-fechar').addEventListener('click', function () {
            P42.fecharModal(DOM.modalCancelar);
        });

        DOM.modalCancelar.addEventListener('click', function (e) {
            if (e.target === DOM.modalCancelar) P42.fecharModal(DOM.modalCancelar);
        });

        // ── Modal: Protocolo ──────────────────────────────────────────────────

        document.getElementById('btn-prot-confirmar').addEventListener('click', function () {
            var setor = DOM.protSetor.value;
            P42.fecharModal(DOM.modalProtocolo);
            P42.gerarProtocolo(setor);
        });

        document.getElementById('btn-prot-fechar').addEventListener('click', function () {
            P42.fecharModal(DOM.modalProtocolo);
        });

        DOM.modalProtocolo.addEventListener('click', function (e) {
            if (e.target === DOM.modalProtocolo) P42.fecharModal(DOM.modalProtocolo);
        });

        // ── Mensagens popup (assinatura digital painel48) ─────────────────────

        window.addEventListener('message', function (evt) {
            if (evt.origin !== window.location.origin) return;
            var msg = evt.data || {};
            if (msg.tipo === 'assinatura_ok' && msg.contexto === 'entrega_refeicao' && msg.ref_id) {
                P42.confirmarEntregaAssinado(msg.ref_id, msg.id);
            }
        });

        // ── Carga inicial ─────────────────────────────────────────────────────

        P42.atualizarIconeNotif();
        P42.carregarEquipe();
        P42.carregarFila();
        P42.carregarHistorico();
        setInterval(P42.cicloAtualizar, CONFIG.refreshInterval);
    }

    window.addEventListener('DOMContentLoaded', inicializar);

})();
