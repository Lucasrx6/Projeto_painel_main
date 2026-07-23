(function () {
    'use strict';

    function inicializar() {
        var P41    = window.P41;
        var DOM    = P41.DOM;
        var CONFIG = P41.CONFIG;
        var Estado = P41.Estado;

        // ── Referências DOM ───────────────────────────────────────────────────

        DOM.inputBusca        = document.getElementById('input-busca');
        DOM.spinnerBusca      = document.getElementById('spinner-busca');
        DOM.listaPacientes    = document.getElementById('lista-pacientes');
        DOM.linkManualWrapper = document.getElementById('link-manual-wrapper');
        DOM.btnAbrirManual    = document.getElementById('btn-abrir-manual');
        DOM.formManual        = document.getElementById('form-manual');
        DOM.manualNome        = document.getElementById('manual-nome');
        DOM.manualAtend       = document.getElementById('manual-atendimento');
        DOM.manualLeito       = document.getElementById('manual-leito');
        DOM.manualSetor       = document.getElementById('manual-setor');
        DOM.manualErro        = document.getElementById('manual-erro');
        DOM.btnManualConf     = document.getElementById('btn-manual-confirmar');
        DOM.btnManualCanc     = document.getElementById('btn-manual-cancelar');
        DOM.cardPaciente      = document.getElementById('card-paciente');
        DOM.pacNome           = document.getElementById('pac-nome-texto');
        DOM.pacLeito          = document.getElementById('pac-leito');
        DOM.pacSetor          = document.getElementById('pac-setor');
        DOM.pacClinica        = document.getElementById('pac-clinica');
        DOM.pacDias           = document.getElementById('pac-dias');
        DOM.pacNasc           = document.getElementById('pac-nasc');
        DOM.cardInfoNasc      = document.getElementById('card-info-nasc');
        DOM.manualNasc        = document.getElementById('manual-nasc');
        DOM.badgeManual       = document.getElementById('badge-manual');
        DOM.cardInfoExtra     = document.getElementById('card-info-extra');
        DOM.btnLimpar         = document.getElementById('btn-limpar-paciente');
        DOM.avisoSelecione    = document.getElementById('aviso-selecione');
        DOM.formSolicitar     = document.getElementById('form-solicitar');
        DOM.selTipoDieta      = document.getElementById('sel-tipo-dieta');
        DOM.selRefeicao       = document.getElementById('sel-refeicao');
        DOM.listaRestricoes   = document.getElementById('lista-restricoes');
        DOM.inpObs            = document.getElementById('inp-obs');
        DOM.erroForm          = document.getElementById('erro-form');
        DOM.btnSolicitar      = document.getElementById('btn-solicitar');
        DOM.btnUrgente        = document.getElementById('btn-urgente');
        DOM.headerStatus      = document.getElementById('header-status');
        DOM.tbodyMinhas       = document.getElementById('tbody-minhas');
        DOM.tabelaMinhas      = document.getElementById('tabela-minhas');
        DOM.tabelaEmpty       = document.getElementById('tabela-minhas-empty');
        DOM.badgeTotal        = document.getElementById('badge-total');
        DOM.filtroSetor41     = document.getElementById('filtro-setor-41');
        DOM.filtroRefeicao41  = document.getElementById('filtro-refeicao-41');
        DOM.buscaHist41       = document.getElementById('busca-hist-41');
        DOM.btnExportarPdf41  = document.getElementById('btn-exportar-pdf-41');
        DOM.modalSucesso      = document.getElementById('modal-sucesso');
        DOM.modalCodigo       = document.getElementById('modal-codigo');
        DOM.btnModalOk        = document.getElementById('btn-modal-ok');
        DOM.modalCancelar     = document.getElementById('modal-cancelar');
        DOM.modalCancId       = document.getElementById('modal-canc-id');
        DOM.modalCancMotivo   = document.getElementById('modal-canc-motivo');
        DOM.modalCancErro     = document.getElementById('modal-canc-erro');
        DOM.btnCancConfirmar  = document.getElementById('btn-canc-confirmar');
        DOM.btnCancFechar     = document.getElementById('btn-canc-fechar');

        // ── Eventos: navegação ────────────────────────────────────────────────

        var btnVoltar = document.getElementById('btn-voltar-hub');
        if (btnVoltar) {
            btnVoltar.addEventListener('click', function () {
                window.location.href = '/painel/painel44';
            });
        }

        // ── Eventos: busca de paciente ────────────────────────────────────────

        DOM.inputBusca.addEventListener('input', P41.debounce(P41.buscarPaciente, CONFIG.debounceMs));
        DOM.btnLimpar.addEventListener('click', P41.limparPaciente);
        DOM.btnAbrirManual.addEventListener('click', P41.abrirFormManual);
        DOM.btnManualCanc.addEventListener('click', P41.fecharFormManual);
        DOM.btnManualConf.addEventListener('click', P41.confirmarManual);

        // ── Eventos: formulário de solicitação ────────────────────────────────

        DOM.btnUrgente.addEventListener('click', P41.toggleUrgente);
        DOM.formSolicitar.addEventListener('submit', P41.submeterSolicitacao);

        // ── Eventos: modal de sucesso ─────────────────────────────────────────

        DOM.btnModalOk.addEventListener('click', P41.fecharModalSucesso);
        DOM.modalSucesso.addEventListener('click', function (e) {
            if (e.target === DOM.modalSucesso) P41.fecharModalSucesso();
        });

        // ── Eventos: cancelamento ─────────────────────────────────────────────

        DOM.btnCancFechar.addEventListener('click', P41.fecharModalCancelar);
        DOM.btnCancConfirmar.addEventListener('click', P41.confirmarCancelamento);
        DOM.modalCancelar.addEventListener('click', function (e) {
            if (e.target === DOM.modalCancelar) P41.fecharModalCancelar();
        });

        // ── Eventos: filtros de minhas solicitações ───────────────────────────

        if (DOM.btnExportarPdf41) {
            DOM.btnExportarPdf41.addEventListener('click', P41.exportarPDF);
        }

        if (DOM.filtroSetor41) {
            DOM.filtroSetor41.addEventListener('change', P41.renderMinhasSolicitacoes);
        }

        if (DOM.filtroRefeicao41) {
            DOM.filtroRefeicao41.addEventListener('change', function () {
                Estado.filtroRefeicao41 = DOM.filtroRefeicao41.value;
                P41.renderMinhasSolicitacoes();
            });
        }

        if (DOM.buscaHist41) {
            DOM.buscaHist41.addEventListener('input', function () {
                clearTimeout(Estado._debounceHistTimer);
                var val = DOM.buscaHist41.value;
                Estado._debounceHistTimer = setTimeout(function () {
                    Estado.buscaHist = val.trim().toLowerCase();
                    P41.renderMinhasSolicitacoes();
                }, 300);
            });
        }

        // ── Carga inicial ─────────────────────────────────────────────────────

        P41.carregarConfiguracoes();
        P41.carregarMinhasSolicitacoes();
        setInterval(P41.carregarMinhasSolicitacoes, CONFIG.refreshInterval);
    }

    window.addEventListener('DOMContentLoaded', inicializar);

})();
