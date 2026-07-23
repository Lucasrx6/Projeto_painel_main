(function () {
    'use strict';

    // ── Badges de status e transporte ─────────────────────────────────────────

    function badgeStatus(status) {
        var mapa = {
            'pendente':   ['badge-pendente',   'fa-hourglass',      'Pendente'],
            'agendado':   ['badge-agendado',   'fa-calendar-check', 'Agendado'],
            'no_local':   ['badge-no_local',   'fa-map-marker-alt', 'No Local'],
            'executando': ['badge-executando', 'fa-spinner',        'Executando'],
            'concluido':  ['badge-concluido',  'fa-check-double',   'Concluído'],
            'cancelado':  ['badge-cancelado',  'fa-ban',            'Cancelado']
        };
        var m = mapa[status] || ['badge-pendente', 'fa-circle', status || '?'];
        return '<span class="badge-status ' + m[0] + '"><i class="fas ' + m[1] + '"></i> ' + m[2] + '</span>';
    }

    function badgeTransporte(item) {
        if (!item.chamado_id) return '';
        var s = item.chamado_status || '';
        if (s === 'aguardando' || s === 'aceito')
            return '<span class="badge-transp transp-aguardando"><i class="fas fa-clock"></i> Padioleiro a caminho</span>';
        if (s === 'em_transporte')
            return '<span class="badge-transp transp-em-transporte"><i class="fas fa-running"></i> Em transporte</span>';
        if (s === 'concluido')
            return '<span class="badge-transp transp-concluido"><i class="fas fa-flag-checkered"></i> Chegou</span>';
        return '';
    }

    // ── HTML de uma linha na tabela da fila ───────────────────────────────────

    function linhaPacienteHtml(item) {
        var escHtml      = window.P46.escHtml;
        var formatarNome = window.P46.formatarNome;
        var formatarHora = window.P46.formatarHora;
        var badgeEnf     = window.P46.badgeStatusEnf;
        var badgeTipo    = window.P46.badgeTipoExame;

        var urgente = item.prioridade === 'urgente';
        var enfSt   = item.status_enfermagem;
        var rowCls  = 'linha-pac';
        if (urgente)                     rowCls += ' linha-urgente';
        if (item.status === 'concluido') rowCls += ' linha-concluido';
        if (enfSt === 'recusado')        rowCls += ' linha-recusado';

        var html = '<tr class="' + rowCls + '">';

        // Paciente
        html += '<td>';
        if (urgente) html += '<i class="fas fa-bolt" style="color:#dc3545;margin-right:4px;font-size:11px;"></i>';
        html += '<div class="ta-nome">' + escHtml(formatarNome(item.nm_paciente)) + '</div>'
              + '<div class="ta-sub"># ' + escHtml(item.nr_atendimento || '') + '</div>';
        html += '</td>';

        // Exame
        html += '<td><div class="ta-proc">' + escHtml(item.ds_procedimento || '-') + '</div>';
        if (item.tipo_exame) html += badgeTipo(item.tipo_exame);
        if (item.requer_preparo && item.tipo_preparo)
            html += '<div class="ta-sub" style="color:#5a3e00;background:#fff3cd;border-radius:3px;padding:1px 4px;margin-top:2px;">'
                  + '<i class="fas fa-flask"></i> ' + escHtml(item.tipo_preparo) + '</div>';
        html += '</td>';

        // Leito / Setor
        html += '<td>';
        if (item.leito_origem)
            html += '<span class="leito-badge">' + escHtml(item.leito_origem) + '</span><br>';
        if (item.setor_origem_nome)
            html += '<span class="ta-sub">' + escHtml(item.setor_origem_nome) + '</span>';
        html += '</td>';

        // Horário
        html += '<td>';
        if (item.slot_data_hora) {
            html += '<span class="ta-slot">' + formatarHora(item.slot_data_hora) + '</span>';
            if (item.slot_modalidade) html += '<div class="ta-sub">' + escHtml(item.slot_modalidade) + '</div>';
        } else {
            html += '<span class="ta-slot-sem">Sem slot</span>';
        }
        html += '</td>';

        // Status
        html += '<td>' + badgeStatus(item.status);
        if (item.auto_finalizado)
            html += '<br><span class="badge-sistema" title="Concluído automaticamente pelo sistema por falta de ação do usuário"><i class="fas fa-robot"></i> Sistema</span>';
        var trBadge = badgeTransporte(item);
        if (trBadge) html += '<br>' + trBadge;
        html += '</td>';

        // Enfermagem
        html += '<td>';
        if (enfSt === 'ciente' || enfSt === 'recusado') {
            html += badgeEnf(enfSt);
            if (enfSt === 'recusado' && item.motivo_recusa)
                html += ' <span title="' + escHtml(item.motivo_recusa) + '" style="cursor:help;">'
                      + '<i class="fas fa-exclamation-circle" style="color:#842029;"></i></span>';
        } else if (item.status === 'agendado' && enfSt === 'pendente') {
            html += badgeEnf('pendente');
        } else {
            html += '<span style="color:#adb5bd;font-size:11px;">—</span>';
        }
        html += '</td>';

        // Ações
        html += '<td><div class="ta-acoes">';
        if (item.status === 'pendente' || item.status === 'agendado')
            html += '<button class="btn-card-acao btn-no-local" onclick="P46.atualizarStatus(' + item.id + ',\'no_local\')" style="font-size:11px;padding:5px 9px">'
                  + '<i class="fas fa-map-marker-alt"></i> Chegou</button>';
        if (item.status === 'agendado')
            html += '<button class="btn-card-acao btn-agendar-presc" onclick="P46.reagendarDaFila(' + item.id + ')" style="font-size:11px;padding:5px 9px">'
                  + '<i class="fas fa-calendar-alt"></i> Reagendar</button>';
        if (item.status === 'no_local')
            html += '<button class="btn-card-acao btn-executando" onclick="P46.atualizarStatus(' + item.id + ',\'executando\')" style="font-size:11px;padding:5px 9px">'
                  + '<i class="fas fa-play"></i> Iniciar</button>';
        if (item.status === 'executando')
            html += '<button class="btn-card-acao btn-concluir" onclick="P46.atualizarStatus(' + item.id + ',\'concluido\')" style="font-size:11px;padding:5px 9px">'
                  + '<i class="fas fa-check"></i> Concluído</button>';
        if (item.status !== 'concluido' && item.status !== 'cancelado')
            html += '<button class="btn-card-acao btn-cancelar-card" onclick="P46.atualizarStatus(' + item.id + ',\'cancelado\')" style="font-size:11px;padding:5px 9px">'
                  + '<i class="fas fa-times"></i></button>';
        html += '</div></td>';

        html += '</tr>';
        return html;
    }

    // ── Renderizar a aba Fila ─────────────────────────────────────────────────

    function renderizarFila() {
        var E = window.P46.Estado;
        var escHtml      = window.P46.escHtml;

        var agendados = E.fila.agendados;
        var pendentes = E.fila.pendentes;
        var recusados = E.fila.recusados;

        var loading   = document.getElementById('fila-loading');
        var vazio     = document.getElementById('fila-vazia');
        var secAg     = document.getElementById('secao-agendados');
        var secPend   = document.getElementById('secao-pendentes');
        var secRecus  = document.getElementById('secao-recusados');
        var gridAg    = document.getElementById('grid-agendados');
        var gridPend  = document.getElementById('grid-pendentes');
        var gridRecus = document.getElementById('grid-recusados');
        var cntAg     = document.getElementById('count-agendados');
        var cntPend   = document.getElementById('count-pendentes');
        var cntRecus  = document.getElementById('count-recusados');

        if (loading) loading.style.display = 'none';

        if (!agendados.length && !pendentes.length && !recusados.length) {
            if (vazio)    vazio.style.display    = '';
            if (secAg)    secAg.style.display    = 'none';
            if (secPend)  secPend.style.display  = 'none';
            if (secRecus) secRecus.style.display = 'none';
            return;
        }
        if (vazio) vazio.style.display = 'none';

        var THEAD = '<div class="tabela-fila-wrapper"><table class="tabela-fila"><thead><tr>'
                  + '<th>Paciente</th><th>Exame</th><th>Leito / Setor</th>'
                  + '<th>Horário</th><th>Status</th><th>Enf.</th><th>Ações</th>'
                  + '</tr></thead><tbody>';
        var TFOOT = '</tbody></table></div>';

        if (agendados.length) {
            if (cntAg) cntAg.textContent = agendados.length;
            var htmlAg = THEAD;
            for (var i = 0; i < agendados.length; i++) htmlAg += linhaPacienteHtml(agendados[i]);
            htmlAg += TFOOT;
            if (gridAg) gridAg.innerHTML = htmlAg;
            if (secAg)  secAg.style.display = '';
        } else {
            if (secAg) secAg.style.display = 'none';
        }

        if (pendentes.length) {
            if (cntPend) cntPend.textContent = pendentes.length;
            var htmlPend = THEAD;
            for (var j = 0; j < pendentes.length; j++) htmlPend += linhaPacienteHtml(pendentes[j]);
            htmlPend += TFOOT;
            if (gridPend) gridPend.innerHTML = htmlPend;
            if (secPend)  secPend.style.display = '';
        } else {
            if (secPend) secPend.style.display = 'none';
        }

        // Recusados — somente leitura, recolhidos por padrão
        if (recusados.length) {
            if (cntRecus) cntRecus.textContent = recusados.length;
            var htmlRec = '<div class="tabela-fila-wrapper"><table class="tabela-fila tabela-recusados">'
                        + '<thead><tr><th>Paciente</th><th>Exame</th><th>Setor / Leito</th>'
                        + '<th>Recusado em</th><th>Motivo da recusa</th></tr></thead><tbody>';
            for (var k = 0; k < recusados.length; k++) {
                var rec = recusados[k];
                htmlRec += '<tr class="linha-recusado">'
                    + '<td><strong>' + escHtml(rec.nm_paciente || '—') + '</strong></td>'
                    + '<td>' + escHtml(rec.ds_procedimento || '—') + '</td>'
                    + '<td>' + escHtml((rec.setor_origem_nome || '') + (rec.leito_origem ? ' · ' + rec.leito_origem : '')) + '</td>'
                    + '<td style="white-space:nowrap;">' + escHtml(rec.dt_recusa ? new Date(rec.dt_recusa).toLocaleString('pt-BR', {day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'}) : '—') + '</td>'
                    + '<td>' + escHtml(rec.motivo_recusa || '—') + '</td>'
                    + '</tr>';
            }
            htmlRec += '</tbody></table></div>';
            if (gridRecus) {
                gridRecus.innerHTML = htmlRec;
                gridRecus.style.display = E.filaRecusadosAberto ? '' : 'none';
            }
            var iconToggle = document.getElementById('icon-toggle-recusados');
            if (iconToggle) iconToggle.className = E.filaRecusadosAberto ? 'fas fa-chevron-down' : 'fas fa-chevron-right';
            if (secRecus) secRecus.style.display = '';
        } else {
            if (secRecus) secRecus.style.display = 'none';
        }
    }

    // ── Carregar fila da API ──────────────────────────────────────────────────

    function carregarFila() {
        var E = window.P46.Estado;
        if (E.carregandoFila) return;
        E.carregandoFila = true;

        fetch(window.P46.CONFIG.api.fila + '?data=' + E.dataConsulta, { credentials: 'same-origin' })
            .then(function (r) { return r.json(); })
            .then(function (d) {
                if (d.success) {
                    E.fila.agendados = d.agendados || [];
                    E.fila.pendentes = d.pendentes || [];
                    E.fila.recusados = d.recusados || [];
                }
                renderizarFila();
                window.P46.setStatusDot(false);
                var el = document.getElementById('ultima-atualizacao');
                if (el) el.textContent = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
                E.carregandoFila = false;
            })
            .catch(function (e) {
                console.error('[P46]', e);
                window.P46.setStatusDot(true);
                E.carregandoFila = false;
            });
    }

    window.P46.badgeStatus       = badgeStatus;
    window.P46.badgeTransporte   = badgeTransporte;
    window.P46.linhaPacienteHtml = linhaPacienteHtml;
    window.P46.renderizarFila    = renderizarFila;
    window.P46.carregarFila      = carregarFila;

})();
