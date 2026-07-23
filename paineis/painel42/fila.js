(function () {
    'use strict';

    function cicloAtualizar() {
        carregarFila();
        window.P42.carregarHistorico();
    }

    function carregarFila() {
        var Estado = window.P42.Estado;
        fetch(window.P42.CONFIG.apiBase + '/fila', { credentials: 'same-origin' })
            .then(function (r) { return r.json(); })
            .then(function (data) {
                if (!data.success) return;

                var novosIds    = [];
                var urgentesIds = [];
                for (var i = 0; i < data.fila.length; i++) {
                    novosIds.push(data.fila[i].id);
                    if (data.fila[i].prioridade === 'urgente') urgentesIds.push(data.fila[i].id);
                }

                if (Estado.idsAnteriores.length > 0) {
                    var _temNovo = false;
                    for (var j = 0; j < novosIds.length; j++) {
                        if (Estado.idsAnteriores.indexOf(novosIds[j]) === -1) {
                            _temNovo = true;
                            break;
                        }
                    }
                    if (_temNovo) {
                        window.P42.tocarAlerta();
                        window.P42.piscarTela();
                        window.P42.alertarTitulo();
                        window.P42.notificarNavegador('Nova Solicitacao - Tela Nutricao', 'Nova dieta solicitada aguardando aceite.');
                    }

                    var aceitoAntes = {};
                    for (var a = 0; a < Estado.fila.length; a++) {
                        if (Estado.fila[a].status === 'aceito') aceitoAntes[Estado.fila[a].id] = true;
                    }
                    var _temPreparo  = false;
                    var _nomePreparo = '';
                    for (var b = 0; b < data.fila.length; b++) {
                        if (data.fila[b].status === 'em_preparo' && aceitoAntes[data.fila[b].id]) {
                            _temPreparo  = true;
                            _nomePreparo = data.fila[b].nm_paciente || '';
                            break;
                        }
                    }
                    if (_temPreparo) {
                        window.P42.tocarAlerta();
                        window.P42.piscarTela();
                        window.P42.alertarTituloEmPreparo();
                        window.P42.notificarNavegador('Em Preparo - Tela Nutricao',
                            'Dieta em preparo' + (_nomePreparo ? ': ' + _nomePreparo : '.'));
                    }
                }

                Estado.idsAnteriores         = novosIds;
                Estado.idsUrgentesAnteriores = urgentesIds;
                Estado.fila                  = data.fila;
                Estado.contadores            = data.contadores;

                window.P42.renderKanban();
                window.P42.renderContadores();
                window.P42.atualizarTimestamp();
            })
            .catch(function (e) { console.error('fila', e); });
    }

    function executarAcao(sid, acao) {
        if (window.P42.Estado.processando) return;
        window.P42.Estado.processando = true;

        fetch(window.P42.CONFIG.apiBase + '/solicitacoes/' + sid + '/' + acao, {
            method: 'PUT',
            credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({})
        })
        .then(function (r) { return r.json(); })
        .then(function (data) {
            window.P42.Estado.processando = false;
            if (data.success) {
                carregarFila();
            } else {
                alert(data.error || 'Erro ao processar ação.');
            }
        })
        .catch(function (e) {
            window.P42.Estado.processando = false;
            console.error(acao, e);
        });
    }

    window.P42.carregarFila  = carregarFila;
    window.P42.cicloAtualizar = cicloAtualizar;
    window.P42.executarAcao  = executarAcao;

})();
