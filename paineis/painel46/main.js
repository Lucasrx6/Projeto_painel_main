(function () {
    'use strict';

    // ── Inicializar — conecta todos os eventos da página ──────────────────────

    function inicializar() {
        var E     = window.P46.Estado;
        var toast = window.P46.toast;

        // Ref ao label de data na barra de navegação
        window.P46.DOM.labelData = document.getElementById('label-data');
        if (window.P46.DOM.labelData)
            window.P46.DOM.labelData.textContent = window.P46.labelData(E.dataConsulta);

        // Restaurar preferência de visualização
        E.visualizacaoExames = localStorage.getItem('p46_view_exames') || 'cards';

        // Pills de tipo de exame e de modalidade
        window.P46.inicializarPillsTipo();
        window.P46.inicializarPillsAgenda();

        // ── Abas ──────────────────────────────────────────────────────────────
        var abasBtns = document.querySelectorAll('.aba');
        for (var i = 0; i < abasBtns.length; i++) {
            (function (btn) {
                btn.addEventListener('click', function () {
                    window.P46.mudarTab(btn.getAttribute('data-aba'));
                });
            })(abasBtns[i]);
        }

        // ── Fechar modais via atributo data-fecha ──────────────────────────────
        var fechaBtns = document.querySelectorAll('[data-fecha]');
        for (var j = 0; j < fechaBtns.length; j++) {
            (function (btn) {
                btn.addEventListener('click', function () {
                    window.P46.fecharModal(btn.getAttribute('data-fecha'));
                });
            })(fechaBtns[j]);
        }

        // Fechar modal ao clicar no overlay
        var overlays = document.querySelectorAll('.modal-overlay');
        for (var k = 0; k < overlays.length; k++) {
            (function (ov) {
                ov.addEventListener('click', function (e) {
                    if (e.target === ov) ov.style.display = 'none';
                });
            })(overlays[k]);
        }

        // ── Navegação de data (aba Agenda) ────────────────────────────────────
        var btnAnt  = document.getElementById('btn-dia-anterior');
        var btnProx = document.getElementById('btn-dia-proximo');
        if (btnAnt) btnAnt.addEventListener('click', function () {
            var d = new Date(E.dataConsulta + 'T12:00:00');
            d.setDate(d.getDate() - 1);
            E.dataConsulta = d.toISOString().slice(0, 10);
            if (window.P46.DOM.labelData) window.P46.DOM.labelData.textContent = window.P46.labelData(E.dataConsulta);
            window.P46.carregarSlots();
        });
        if (btnProx) btnProx.addEventListener('click', function () {
            var d = new Date(E.dataConsulta + 'T12:00:00');
            d.setDate(d.getDate() + 1);
            E.dataConsulta = d.toISOString().slice(0, 10);
            if (window.P46.DOM.labelData) window.P46.DOM.labelData.textContent = window.P46.labelData(E.dataConsulta);
            window.P46.carregarSlots();
        });

        // ── Toggle de visualização: cards / tabela (aba Exames) ───────────────
        var btnExCards  = document.getElementById('exames-btn-cards');
        var btnExTabela = document.getElementById('exames-btn-tabela');
        function atualizarBotoesViewEx() {
            if (btnExCards)  btnExCards.className  = 'btn-view' + (E.visualizacaoExames === 'cards'  ? ' ativo' : '');
            if (btnExTabela) btnExTabela.className = 'btn-view' + (E.visualizacaoExames === 'tabela' ? ' ativo' : '');
        }
        atualizarBotoesViewEx();
        if (btnExCards)  btnExCards.addEventListener('click', function () {
            E.visualizacaoExames = 'cards';
            localStorage.setItem('p46_view_exames', 'cards');
            atualizarBotoesViewEx();
            window.P46.renderizarExamesRadio();
        });
        if (btnExTabela) btnExTabela.addEventListener('click', function () {
            E.visualizacaoExames = 'tabela';
            localStorage.setItem('p46_view_exames', 'tabela');
            atualizarBotoesViewEx();
            window.P46.renderizarExamesRadio();
        });

        // ── Filtro "sem controle" (exames sem registro de radiologia) ─────────
        var toggleSemCtrl = document.getElementById('exames-toggle-sem-controle');
        if (toggleSemCtrl) toggleSemCtrl.addEventListener('change', function () {
            E.filtroSemControle = this.checked;
            window.P46.renderizarExamesRadio();
        });

        // ── Toggle mostrar todos / apenas pendentes ───────────────────────────
        var btnToggleTodos = document.getElementById('btn-toggle-todos-exames');
        if (btnToggleTodos) btnToggleTodos.addEventListener('click', function () {
            E.mostrarTodosExames = !E.mostrarTodosExames;
            window.P46.renderizarExamesRadio();
        });

        // ── Toggle seção recusados (recolher/expandir) ────────────────────────
        var btnToggleRecus = document.getElementById('btn-toggle-recusados');
        if (btnToggleRecus) btnToggleRecus.addEventListener('click', function () {
            E.filaRecusadosAberto = !E.filaRecusadosAberto;
            var grid = document.getElementById('grid-recusados');
            var icon = document.getElementById('icon-toggle-recusados');
            if (grid) grid.style.display = E.filaRecusadosAberto ? '' : 'none';
            if (icon) icon.className = 'fas ' + (E.filaRecusadosAberto ? 'fa-chevron-down' : 'fa-chevron-right');
        });

        // ── Botões do cabeçalho ───────────────────────────────────────────────
        var btnR = document.getElementById('btn-refresh');
        if (btnR) btnR.addEventListener('click', window.P46.carregarTudo);
        var btnV = document.getElementById('btn-voltar');
        if (btnV) btnV.addEventListener('click', function () { window.history.back(); });

        // ── Máscaras de horário HH:MM ─────────────────────────────────────────
        var idsHora = ['lote-inicio', 'lote-fim', 'avulso-hora'];
        for (var hi = 0; hi < idsHora.length; hi++) {
            (function (id) {
                var el = document.getElementById(id);
                if (!el) return;
                el.addEventListener('input', function () {
                    var digits = this.value.replace(/\D/g, '').slice(0, 4);
                    this.value = digits.length > 2 ? digits.slice(0, 2) + ':' + digits.slice(2) : digits;
                });
                el.addEventListener('blur', function () {
                    var m = this.value.match(/^(\d{1,2}):?(\d{2})$/);
                    if (m) this.value = ('0' + m[1]).slice(-2) + ':' + m[2];
                });
            })(idsHora[hi]);
        }

        // ── Máscaras de data DD/MM/AAAA ───────────────────────────────────────
        var idsDatas = ['lote-data', 'avulso-data', 'ag-data'];
        for (var di = 0; di < idsDatas.length; di++) {
            (function (id) {
                var el = document.getElementById(id);
                if (!el) return;
                el.addEventListener('input', function () {
                    var digits = this.value.replace(/\D/g, '').slice(0, 8);
                    var res = digits;
                    if (digits.length > 2) res = digits.slice(0, 2) + '/' + digits.slice(2);
                    if (digits.length > 4) res = digits.slice(0, 2) + '/' + digits.slice(2, 4) + '/' + digits.slice(4);
                    this.value = res;
                });
                // Campo de data do modal de agendamento: busca automática ao completar 10 chars
                if (id === 'ag-data') {
                    el.addEventListener('input', function () {
                        if (this.value.length === 10) window.P46.buscarSlotsPorTipo();
                    });
                }
            })(idsDatas[di]);
        }

        // ── Modal criar lote de vagas ─────────────────────────────────────────
        var btnLote = document.getElementById('btn-criar-lote');
        if (btnLote) btnLote.addEventListener('click', function () {
            var el = document.getElementById('lote-data');
            if (el) el.value = window.P46.isoParaDisplay(E.dataConsulta || window.P46.hojeISO());
            window.P46.abrirModal('modal-lote');
        });
        var btnLoteOk = document.getElementById('modal-lote-confirmar');
        if (btnLoteOk) btnLoteOk.addEventListener('click', window.P46.criarLote);

        // ── Modal criar vaga avulsa ───────────────────────────────────────────
        var btnAv = document.getElementById('btn-criar-avulso');
        if (btnAv) btnAv.addEventListener('click', function () {
            var el = document.getElementById('avulso-data');
            if (el) el.value = window.P46.isoParaDisplay(E.dataConsulta || window.P46.hojeISO());
            window.P46.abrirModal('modal-avulso');
        });
        var btnAvOk = document.getElementById('modal-avulso-confirmar');
        if (btnAvOk) btnAvOk.addEventListener('click', window.P46.criarAvulso);

        var btnNovaVagaAg = document.getElementById('btn-nova-vaga-ag');
        if (btnNovaVagaAg) btnNovaVagaAg.addEventListener('click', window.P46.abrirAvulsoParaAgendamento);

        // ── Modal agendar prescrição ──────────────────────────────────────────
        var btnAgOk = document.getElementById('modal-ag-confirmar');
        if (btnAgOk) btnAgOk.addEventListener('click', window.P46.confirmarAgendamento);

        // ── Modal irmãos ──────────────────────────────────────────────────────
        var btnIrmaosOk = document.getElementById('modal-irmaos-confirmar');
        if (btnIrmaosOk) btnIrmaosOk.addEventListener('click', window.P46.confirmarIrmaos);

        // ── Toggle de preparo (Sim/Não) ───────────────────────────────────────
        var btnPreparoNao = document.getElementById('btn-preparo-nao');
        var btnPreparoSim = document.getElementById('btn-preparo-sim');
        var preparoGrupo  = document.getElementById('ag-preparo-grupo');
        var preparoTexto  = document.getElementById('ag-preparo-texto');
        var preparoHint   = document.getElementById('ag-preparo-hint');

        function atualizarPreparoHint() {
            if (!preparoHint || !preparoTexto) return;
            var len = preparoTexto.value.length;
            preparoHint.textContent = len + ' / 15 mínimo' + (len >= 15 ? ' ✓' : '');
            preparoHint.style.color = len >= 15 ? '#198754' : '#6c757d';
        }
        if (btnPreparoNao) btnPreparoNao.addEventListener('click', function () {
            btnPreparoNao.className = 'btn-preparo btn-preparo-nao ativo';
            if (btnPreparoSim) btnPreparoSim.className = 'btn-preparo btn-preparo-sim';
            if (preparoGrupo) preparoGrupo.style.display = 'none';
        });
        if (btnPreparoSim) btnPreparoSim.addEventListener('click', function () {
            btnPreparoSim.className = 'btn-preparo btn-preparo-sim ativo';
            if (btnPreparoNao) btnPreparoNao.className = 'btn-preparo btn-preparo-nao';
            if (preparoGrupo) preparoGrupo.style.display = '';
            if (preparoTexto) preparoTexto.focus();
        });
        if (preparoTexto) preparoTexto.addEventListener('input', atualizarPreparoHint);

        // ── Exportação ────────────────────────────────────────────────────────
        var btnPDF   = document.getElementById('btn-export-pdf');
        var btnExcel = document.getElementById('btn-export-excel');
        if (btnPDF)   btnPDF.addEventListener('click', window.P46.gerarAgendaPDF);
        if (btnExcel) btnExcel.addEventListener('click', window.P46.exportarAgendaExcel);

        // ── Carga inicial e polling ───────────────────────────────────────────
        window.P46.carregarFila();
        setInterval(window.P46.carregarTudo, window.P46.CONFIG.intervalo);
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', inicializar);
    else inicializar();

})();
