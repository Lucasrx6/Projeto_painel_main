var PAINEL_VERSAO = '1.0.28';

(function () {
    'use strict';

    var _previewTimer = null;

    function inicializar() {
        var CONFIG = window.P43.CONFIG;

        // Voltar ao hub
        var btnVoltar = document.getElementById('btn-voltar-hub');
        if (btnVoltar) {
            btnVoltar.addEventListener('click', function () {
                window.location.href = '/painel/painel44';
            });
        }

        // Abas principais
        var abaBtns = document.querySelectorAll('.aba');
        for (var i = 0; i < abaBtns.length; i++) {
            abaBtns[i].addEventListener('click', function () {
                window.P43.trocarAba(this.getAttribute('data-aba'));
            });
        }

        // Sub-abas de configuração
        var subabaBtns = document.querySelectorAll('.sub-aba');
        for (var j = 0; j < subabaBtns.length; j++) {
            subabaBtns[j].addEventListener('click', function () {
                window.P43.trocarSubaba(this.getAttribute('data-subaba'));
            });
        }

        // Aba Etiqueta: oculta para não-admins
        fetch(CONFIG.apiBase + '/etiqueta-admin-check', { credentials: 'same-origin' })
            .then(function (r) {
                if (r.status === 403) {
                    var btnEtq = document.querySelector('.sub-aba[data-subaba="etiqueta"]');
                    if (btnEtq) btnEtq.style.display = 'none';
                }
            })
            .catch(function () {});

        // Botões do header
        var btnRefresh = document.getElementById('btn-refresh');
        if (btnRefresh) btnRefresh.addEventListener('click', window.P43.carregarDashboard);
        document.getElementById('btn-refresh-dash').addEventListener('click', window.P43.carregarDashboard);

        // Botões de relatório
        document.getElementById('btn-filtrar').addEventListener('click', window.P43.carregarRelAbaAtiva);
        document.getElementById('btn-exportar').addEventListener('click', window.P43.exportarCSV);

        var relAbaBtns = document.querySelectorAll('[data-relaba]');
        for (var ri = 0; ri < relAbaBtns.length; ri++) {
            relAbaBtns[ri].addEventListener('click', function () {
                window.P43.trocarRelAba(this.getAttribute('data-relaba'));
            });
        }
        window.P43.initRelDatas();

        // Botões "Adicionar" de configuração
        document.getElementById('btn-add-equipe').addEventListener('click', function () {
            window.P43.abrirFormNovo('equipe');
        });
        document.getElementById('btn-add-tipo-dieta').addEventListener('click', function () {
            window.P43.abrirFormNovo('tipos-dieta');
        });
        document.getElementById('btn-add-refeicao').addEventListener('click', function () {
            window.P43.abrirFormNovo('refeicoes');
        });
        document.getElementById('btn-add-restricao').addEventListener('click', function () {
            window.P43.abrirFormNovo('restricoes');
        });

        // Modal form genérico
        document.getElementById('btn-form-fechar').addEventListener('click', window.P43.fecharModalForm);
        document.getElementById('btn-form-salvar').addEventListener('click', window.P43.salvarForm);
        var btnFecharX = document.getElementById('btn-fechar-modal-form');
        if (btnFecharX) btnFecharX.addEventListener('click', window.P43.fecharModalForm);
        document.getElementById('modal-form').addEventListener('click', function (e) {
            if (e.target === this) window.P43.fecharModalForm();
        });

        // Modal cancelar ativo (dashboard)
        document.getElementById('btn-canc-ativo-conf').addEventListener('click', window.P43.confirmarCancelAativo);
        document.getElementById('btn-canc-ativo-fech').addEventListener('click', function () {
            document.getElementById('modal-canc-ativo').style.display = 'none';
        });

        // Configurações de etiqueta
        document.getElementById('btn-salvar-etiqueta').addEventListener('click', window.P43.salvarEtiqueta);
        document.getElementById('etq-modo').addEventListener('change', window.P43.toggleEtiquetaGrupos);
        document.getElementById('btn-padrao-pdf').addEventListener('click', function () {
            document.getElementById('etq-pdf').value = window.P43.PDF_TEMPLATE_PADRAO;
            window.P43.atualizarPreviewPDF();
        });
        document.getElementById('etq-pdf').addEventListener('input', function () {
            clearTimeout(_previewTimer);
            _previewTimer = setTimeout(window.P43.atualizarPreviewPDF, 450);
        });
        document.getElementById('btn-visualizar-zpl').addEventListener('click', window.P43.atualizarPreviewZPL);
        document.getElementById('btn-padrao-zpl').addEventListener('click', function () {
            document.getElementById('etq-zpl').value = window.P43.ZPL_TEMPLATE_PADRAO;
            window.P43.atualizarPreviewZPL();
        });

        // Carregar dashboard inicial e iniciar polling
        window.P43.carregarDashboard();
        setInterval(window.P43.carregarDashboard, CONFIG.refreshDash);
    }

    window.addEventListener('DOMContentLoaded', inicializar);

})();
