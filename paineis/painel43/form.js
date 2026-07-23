(function () {
    'use strict';

    var FORMS = {
        'equipe': {
            titulo: 'Membro da Equipe',
            campos: [
                { key: 'nome',      label: 'Nome',      tipo: 'text',     obrig: true },
                { key: 'matricula', label: 'Matrícula', tipo: 'text' },
                { key: 'funcao',    label: 'Função',    tipo: 'select',
                  opts: ['nutricionista', 'tecnico', 'copeira', 'auxiliar'] },
                { key: 'turno',     label: 'Turno',     tipo: 'select',
                  opts: ['todos', 'manhã', 'tarde', 'noite'] },
                { key: 'ativo',     label: 'Ativo',     tipo: 'checkbox' }
            ]
        },
        'tipos-dieta': {
            titulo: 'Tipo de Dieta',
            campos: [
                { key: 'nome',      label: 'Nome',      tipo: 'text',   obrig: true },
                { key: 'descricao', label: 'Descrição', tipo: 'text' },
                { key: 'icone',     label: 'Ícone FA',  tipo: 'text',   placeholder: 'fa-utensils' },
                { key: 'cor',       label: 'Cor (hex)', tipo: 'color' },
                { key: 'ordem',     label: 'Ordem',     tipo: 'number' },
                { key: 'ativo',     label: 'Ativo',     tipo: 'checkbox' }
            ]
        },
        'refeicoes': {
            titulo: 'Refeição',
            campos: [
                { key: 'nome',           label: 'Nome',     tipo: 'text',   obrig: true },
                { key: 'horario_inicio', label: 'Início',   tipo: 'time' },
                { key: 'horario_fim',    label: 'Fim',      tipo: 'time' },
                { key: 'icone',          label: 'Ícone FA', tipo: 'text',   placeholder: 'fa-utensils' },
                { key: 'ordem',          label: 'Ordem',    tipo: 'number' },
                { key: 'ativo',          label: 'Ativo',    tipo: 'checkbox' }
            ]
        },
        'restricoes': {
            titulo: 'Restrição Alimentar',
            campos: [
                { key: 'nome',  label: 'Nome',      tipo: 'text',   obrig: true },
                { key: 'sigla', label: 'Sigla',     tipo: 'text',   placeholder: 'EX: SG' },
                { key: 'icone', label: 'Ícone FA',  tipo: 'text',   placeholder: 'fa-triangle-exclamation' },
                { key: 'cor',   label: 'Cor (hex)', tipo: 'color' },
                { key: 'ordem', label: 'Ordem',     tipo: 'number' },
                { key: 'ativo', label: 'Ativo',     tipo: 'checkbox' }
            ]
        }
    };

    function getListaRecurso(recurso) {
        var E = window.P43.Estado;
        if (recurso === 'equipe')      return E.equipe;
        if (recurso === 'tipos-dieta') return E.tiposDieta;
        if (recurso === 'refeicoes')   return E.refeicoes;
        if (recurso === 'restricoes')  return E.restricoes;
        return [];
    }

    function buildFormHtml(campos, vals) {
        var escHtml = window.P43.escHtml;
        var html = '';
        for (var i = 0; i < campos.length; i++) {
            var c = campos[i];
            var v = vals[c.key] != null ? vals[c.key] : '';
            html += '<div class="form-group-modal">';
            html += '<label>' + escHtml(c.label) + (c.obrig ? ' <span style="color:#DC3545;">*</span>' : '') + '</label>';

            if (c.tipo === 'select') {
                html += '<select name="' + c.key + '" class="form-select-modal">';
                for (var j = 0; j < c.opts.length; j++) {
                    var sel = String(v) === c.opts[j] ? ' selected' : '';
                    html += '<option' + sel + '>' + escHtml(c.opts[j]) + '</option>';
                }
                html += '</select>';
            } else if (c.tipo === 'checkbox') {
                html += '<label style="display:flex;align-items:center;gap:8px;cursor:pointer;">' +
                    '<input type="checkbox" name="' + c.key + '"' + (v ? ' checked' : '') + '>' +
                    ' Sim</label>';
            } else if (c.tipo === 'color') {
                var hexVal = (v && String(v).charAt(0) === '#') ? v : '#17A2B8';
                html += '<input type="color" name="' + c.key + '" value="' + escHtml(hexVal) + '" class="form-select-modal" style="height:40px;padding:2px;">';
            } else {
                html += '<input type="' + c.tipo + '" name="' + c.key + '" value="' + escHtml(String(v)) + '"' +
                    (c.placeholder ? ' placeholder="' + escHtml(c.placeholder) + '"' : '') +
                    ' class="form-select-modal">';
            }
            html += '</div>';
        }
        return html;
    }

    function abrirFormNovo(recurso) {
        var E = window.P43.Estado;
        E.formRecurso = recurso;
        E.formId      = null;
        document.getElementById('modal-form-titulo').textContent = 'Novo ' + FORMS[recurso].titulo;
        document.getElementById('modal-form-erro').style.display = 'none';
        document.getElementById('modal-form-corpo').innerHTML = buildFormHtml(FORMS[recurso].campos, {});
        document.getElementById('modal-form').style.display = 'flex';
    }

    function abrirFormEdicao(recurso, id) {
        var E = window.P43.Estado;
        E.formRecurso = recurso;
        E.formId      = id;
        var lista = getListaRecurso(recurso);
        var item  = null;
        for (var i = 0; i < lista.length; i++) {
            if (String(lista[i].id) === String(id)) { item = lista[i]; break; }
        }
        if (!item) return;
        document.getElementById('modal-form-titulo').textContent = 'Editar ' + FORMS[recurso].titulo;
        document.getElementById('modal-form-erro').style.display = 'none';
        document.getElementById('modal-form-corpo').innerHTML = buildFormHtml(FORMS[recurso].campos, item);
        document.getElementById('modal-form').style.display = 'flex';
    }

    function fecharModalForm() {
        document.getElementById('modal-form').style.display = 'none';
        var E = window.P43.Estado;
        E.formRecurso = null;
        E.formId      = null;
    }

    function salvarForm() {
        var E       = window.P43.Estado;
        var recurso = E.formRecurso;
        var id      = E.formId;
        var campos  = FORMS[recurso].campos;
        var dados   = {};

        var corpo = document.getElementById('modal-form-corpo');
        for (var i = 0; i < campos.length; i++) {
            var c  = campos[i];
            var el = corpo.querySelector('[name="' + c.key + '"]');
            if (!el) continue;
            if (c.tipo === 'checkbox') {
                dados[c.key] = el.checked;
            } else if (c.tipo === 'number') {
                dados[c.key] = parseInt(el.value, 10) || 0;
            } else {
                dados[c.key] = el.value.trim();
            }
        }

        var url    = window.P43.CONFIG.apiBase + '/config/' + recurso;
        var method = id ? 'PUT' : 'POST';
        if (id) url += '/' + id;

        document.getElementById('btn-form-salvar').disabled = true;
        document.getElementById('modal-form-erro').style.display = 'none';

        fetch(url, {
            method: method,
            credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(dados)
        })
        .then(function (r) { return r.json(); })
        .then(function (data) {
            document.getElementById('btn-form-salvar').disabled = false;
            if (data.success) {
                window.P43.fecharModalForm();
                window.P43.carregarSubabaAtiva();
            } else {
                document.getElementById('modal-form-erro').textContent = data.error || 'Erro ao salvar.';
                document.getElementById('modal-form-erro').style.display = 'block';
            }
        })
        .catch(function () {
            document.getElementById('btn-form-salvar').disabled = false;
            document.getElementById('modal-form-erro').textContent = 'Falha na conexão.';
            document.getElementById('modal-form-erro').style.display = 'block';
        });
    }

    window.P43.abrirFormNovo   = abrirFormNovo;
    window.P43.abrirFormEdicao = abrirFormEdicao;
    window.P43.fecharModalForm = fecharModalForm;
    window.P43.salvarForm      = salvarForm;

})();
