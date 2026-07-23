(function () {
    'use strict';

    // ── Equipe ────────────────────────────────────────────────────────────────

    function carregarEquipe() {
        fetch(window.P43.CONFIG.apiBase + '/config/equipe', { credentials: 'same-origin' })
            .then(function (r) { return r.json(); })
            .then(function (data) {
                window.P43.Estado.equipe = data.equipe || [];
                renderEquipe();
            });
    }

    function renderEquipe() {
        var escHtml = window.P43.escHtml;
        var html = '';
        var eq = window.P43.Estado.equipe;
        for (var i = 0; i < eq.length; i++) {
            var m = eq[i];
            html += '<tr>' +
                '<td>' + escHtml(m.nome) + '</td>' +
                '<td>' + escHtml(m.matricula || '--') + '</td>' +
                '<td>' + escHtml(m.funcao) + '</td>' +
                '<td>' + escHtml(m.turno) + '</td>' +
                '<td>' + (m.ativo ? '<span class="tag-ativo">Ativo</span>' : '<span class="tag-inativo">Inativo</span>') + '</td>' +
                '<td style="white-space:nowrap;">' +
                    '<button class="btn-edit" data-recurso="equipe" data-id="' + m.id + '" title="Editar"><i class="fas fa-pen"></i></button> ' +
                    '<button class="btn-toggle-ativo ' + (m.ativo ? 'ativo' : 'inativo') + '" data-recurso="equipe" data-id="' + m.id + '" data-ativo="' + (m.ativo ? '1' : '0') + '" title="' + (m.ativo ? 'Inativar' : 'Ativar') + '">' +
                        '<i class="fas ' + (m.ativo ? 'fa-eye' : 'fa-eye-slash') + '"></i>' +
                    '</button>' +
                '</td>' +
            '</tr>';
        }
        document.getElementById('tbody-equipe').innerHTML = html || '<tr><td colspan="6" class="tabela-vazio">Nenhum membro cadastrado.</td></tr>';
        bindActionBtns();
    }

    // ── Tipos de Dieta ────────────────────────────────────────────────────────

    function carregarTiposDieta() {
        fetch(window.P43.CONFIG.apiBase + '/config/tipos-dieta', { credentials: 'same-origin' })
            .then(function (r) { return r.json(); })
            .then(function (data) {
                window.P43.Estado.tiposDieta = data.dados || [];
                renderTiposDieta();
            });
    }

    function renderTiposDieta() {
        var escHtml = window.P43.escHtml;
        var html = '';
        var td = window.P43.Estado.tiposDieta;
        for (var i = 0; i < td.length; i++) {
            var t = td[i];
            html += '<tr>' +
                '<td>' + escHtml(t.nome) + '</td>' +
                '<td><i class="fas ' + escHtml(t.icone) + '"></i> <code>' + escHtml(t.icone) + '</code></td>' +
                '<td><span class="dot-cor" style="background:' + escHtml(t.cor) + ';"></span> ' + escHtml(t.cor) + '</td>' +
                '<td>' + escHtml(String(t.ordem)) + '</td>' +
                '<td>' + (t.ativo ? '<span class="tag-ativo">Ativo</span>' : '<span class="tag-inativo">Inativo</span>') + '</td>' +
                '<td style="white-space:nowrap;">' +
                    '<button class="btn-edit" data-recurso="tipos-dieta" data-id="' + t.id + '" title="Editar"><i class="fas fa-pen"></i></button> ' +
                    '<button class="btn-toggle-ativo ' + (t.ativo ? 'ativo' : 'inativo') + '" data-recurso="tipos-dieta" data-id="' + t.id + '" data-ativo="' + (t.ativo ? '1' : '0') + '" title="' + (t.ativo ? 'Inativar' : 'Ativar') + '">' +
                        '<i class="fas ' + (t.ativo ? 'fa-eye' : 'fa-eye-slash') + '"></i>' +
                    '</button> ' +
                    '<button class="btn-deletar" data-recurso="tipos-dieta" data-id="' + t.id + '" data-nome="' + escHtml(t.nome) + '" title="Deletar"><i class="fas fa-trash"></i></button>' +
                '</td>' +
            '</tr>';
        }
        document.getElementById('tbody-tipos-dieta').innerHTML = html || '<tr><td colspan="6" class="tabela-vazio">Nenhum tipo cadastrado.</td></tr>';
        bindActionBtns();
    }

    // ── Refeições ─────────────────────────────────────────────────────────────

    function carregarRefeicoes() {
        fetch(window.P43.CONFIG.apiBase + '/config/refeicoes', { credentials: 'same-origin' })
            .then(function (r) { return r.json(); })
            .then(function (data) {
                window.P43.Estado.refeicoes = data.dados || [];
                renderRefeicoes();
            });
    }

    function renderRefeicoes() {
        var escHtml = window.P43.escHtml;
        var html = '';
        var rf = window.P43.Estado.refeicoes;
        for (var i = 0; i < rf.length; i++) {
            var r = rf[i];
            html += '<tr>' +
                '<td>' + escHtml(r.nome) + '</td>' +
                '<td>' + escHtml(r.horario_inicio || '--') + '</td>' +
                '<td>' + escHtml(r.horario_fim    || '--') + '</td>' +
                '<td><i class="fas ' + escHtml(r.icone) + '"></i></td>' +
                '<td>' + escHtml(String(r.ordem)) + '</td>' +
                '<td>' + (r.ativo ? '<span class="tag-ativo">Ativo</span>' : '<span class="tag-inativo">Inativo</span>') + '</td>' +
                '<td style="white-space:nowrap;">' +
                    '<button class="btn-edit" data-recurso="refeicoes" data-id="' + r.id + '" title="Editar"><i class="fas fa-pen"></i></button> ' +
                    '<button class="btn-toggle-ativo ' + (r.ativo ? 'ativo' : 'inativo') + '" data-recurso="refeicoes" data-id="' + r.id + '" data-ativo="' + (r.ativo ? '1' : '0') + '" title="' + (r.ativo ? 'Inativar' : 'Ativar') + '">' +
                        '<i class="fas ' + (r.ativo ? 'fa-eye' : 'fa-eye-slash') + '"></i>' +
                    '</button> ' +
                    '<button class="btn-deletar" data-recurso="refeicoes" data-id="' + r.id + '" data-nome="' + escHtml(r.nome) + '" title="Deletar"><i class="fas fa-trash"></i></button>' +
                '</td>' +
            '</tr>';
        }
        document.getElementById('tbody-refeicoes').innerHTML = html || '<tr><td colspan="7" class="tabela-vazio">Nenhuma refeição cadastrada.</td></tr>';
        bindActionBtns();
    }

    // ── Restrições ────────────────────────────────────────────────────────────

    function carregarRestricoes() {
        fetch(window.P43.CONFIG.apiBase + '/config/restricoes', { credentials: 'same-origin' })
            .then(function (r) { return r.json(); })
            .then(function (data) {
                window.P43.Estado.restricoes = data.dados || [];
                renderRestricoes();
            });
    }

    function renderRestricoes() {
        var escHtml = window.P43.escHtml;
        var html = '';
        var rs = window.P43.Estado.restricoes;
        for (var i = 0; i < rs.length; i++) {
            var r = rs[i];
            html += '<tr>' +
                '<td>' + escHtml(r.nome) + '</td>' +
                '<td><code>' + escHtml(r.sigla || '--') + '</code></td>' +
                '<td><i class="fas ' + escHtml(r.icone) + '"></i></td>' +
                '<td><span class="dot-cor" style="background:' + escHtml(r.cor) + ';"></span></td>' +
                '<td>' + escHtml(String(r.ordem)) + '</td>' +
                '<td>' + (r.ativo ? '<span class="tag-ativo">Ativo</span>' : '<span class="tag-inativo">Inativo</span>') + '</td>' +
                '<td style="white-space:nowrap;">' +
                    '<button class="btn-edit" data-recurso="restricoes" data-id="' + r.id + '" title="Editar"><i class="fas fa-pen"></i></button> ' +
                    '<button class="btn-toggle-ativo ' + (r.ativo ? 'ativo' : 'inativo') + '" data-recurso="restricoes" data-id="' + r.id + '" data-ativo="' + (r.ativo ? '1' : '0') + '" title="' + (r.ativo ? 'Inativar' : 'Ativar') + '">' +
                        '<i class="fas ' + (r.ativo ? 'fa-eye' : 'fa-eye-slash') + '"></i>' +
                    '</button> ' +
                    '<button class="btn-deletar" data-recurso="restricoes" data-id="' + r.id + '" data-nome="' + escHtml(r.nome) + '" title="Deletar"><i class="fas fa-trash"></i></button>' +
                '</td>' +
            '</tr>';
        }
        document.getElementById('tbody-restricoes').innerHTML = html || '<tr><td colspan="7" class="tabela-vazio">Nenhuma restrição cadastrada.</td></tr>';
        bindActionBtns();
    }

    // ── Botões de ação (edit / toggle / deletar) ──────────────────────────────

    function bindActionBtns() {
        var btnsEdit = document.querySelectorAll('.btn-edit');
        for (var i = 0; i < btnsEdit.length; i++) {
            btnsEdit[i].addEventListener('click', function () {
                window.P43.abrirFormEdicao(this.getAttribute('data-recurso'), this.getAttribute('data-id'));
            });
        }
        var btnsToggle = document.querySelectorAll('.btn-toggle-ativo');
        for (var j = 0; j < btnsToggle.length; j++) {
            btnsToggle[j].addEventListener('click', function () {
                toggleAtivo(
                    this.getAttribute('data-recurso'),
                    this.getAttribute('data-id'),
                    this.getAttribute('data-ativo') === '1'
                );
            });
        }
        var btnsDel = document.querySelectorAll('.btn-deletar');
        for (var k = 0; k < btnsDel.length; k++) {
            btnsDel[k].addEventListener('click', function () {
                deletarItem(
                    this.getAttribute('data-recurso'),
                    this.getAttribute('data-id'),
                    this.getAttribute('data-nome')
                );
            });
        }
    }

    function toggleAtivo(recurso, id, ativoAtual) {
        var novoAtivo = !ativoAtual;
        fetch(window.P43.CONFIG.apiBase + '/config/' + recurso + '/' + id, {
            method: 'PUT',
            credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ativo: novoAtivo })
        })
        .then(function (r) { return r.json(); })
        .then(function (data) {
            if (data.success) {
                window.P43.carregarSubabaAtiva();
            } else {
                alert(data.error || 'Erro ao alterar status.');
            }
        })
        .catch(function () { alert('Falha na conexão.'); });
    }

    function deletarItem(recurso, id, nome) {
        if (!window.confirm('Deletar "' + nome + '"?\nEsta ação não pode ser desfeita.')) return;
        fetch(window.P43.CONFIG.apiBase + '/config/' + recurso + '/' + id, {
            method: 'DELETE',
            credentials: 'same-origin'
        })
        .then(function (r) {
            return r.json().then(function (data) {
                return { status: r.status, data: data };
            });
        })
        .then(function (res) {
            if (res.status === 409 && res.data.tem_uso) {
                if (window.confirm(res.data.error + '\n\nDeseja inativar em vez de deletar?')) {
                    toggleAtivo(recurso, id, true);
                }
            } else if (res.data.success) {
                window.P43.carregarSubabaAtiva();
            } else {
                alert(res.data.error || 'Erro ao deletar.');
            }
        })
        .catch(function () { alert('Falha na conexão.'); });
    }

    // ── Dispatcher ────────────────────────────────────────────────────────────

    function carregarConfiguracoes() {
        carregarSubabaAtiva();
    }

    function carregarSubabaAtiva() {
        var sub = window.P43.Estado.subabaAtiva;
        if (sub === 'equipe')      carregarEquipe();
        if (sub === 'tipos-dieta') carregarTiposDieta();
        if (sub === 'refeicoes')   carregarRefeicoes();
        if (sub === 'restricoes')  carregarRestricoes();
        if (sub === 'etiqueta')    window.P43.carregarEtiqueta();
    }

    window.P43.carregarConfiguracoes = carregarConfiguracoes;
    window.P43.carregarSubabaAtiva   = carregarSubabaAtiva;

})();
