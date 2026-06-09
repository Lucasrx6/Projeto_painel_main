(function() {
    'use strict';

    var CONFIG = {
        urlBase: '/api/paineis/painel26',
        intervaloAtualizacao: 60000,
        prefixoStorage: 'painel26_'
    };

    var Estado = {
        tipos: [],
        especialidades: [],
        destinatarios: [],
        editandoId: null,
        timerAtualizacao: null
    };

    var DOM = {};

    function capturarDOM() {
        DOM.kpiDestinatarios = document.getElementById('kpi-destinatarios');
        DOM.kpiTipos = document.getElementById('kpi-tipos');
        DOM.kpiEnviadosHoje = document.getElementById('kpi-enviados-hoje');
        DOM.kpiErrosHoje = document.getElementById('kpi-erros-hoje');
        DOM.ultimaAtualizacao = document.getElementById('ultima-atualizacao');
        DOM.statusIndicator = document.getElementById('status-indicator');
        DOM.tabelaDestinatarios = document.getElementById('tabela-destinatarios');
        DOM.timelineHistorico = document.getElementById('timeline-historico');
        DOM.contadorHistorico = document.getElementById('contador-historico');
        DOM.filtroTipo = document.getElementById('filtro-tipo');
        DOM.filtroEspecialidade = document.getElementById('filtro-especialidade');
        DOM.filtroAtivo = document.getElementById('filtro-ativo');
        DOM.btnNovo = document.getElementById('btn-novo');
        DOM.btnRefresh = document.getElementById('btn-refresh');
        DOM.btnVoltar = document.getElementById('btn-voltar');
        DOM.modalOverlay = document.getElementById('modal-overlay');
        DOM.modalTitulo = document.getElementById('modal-titulo');
        DOM.modalFechar = document.getElementById('modal-fechar');
        DOM.btnCancelar = document.getElementById('btn-cancelar');
        DOM.btnSalvar = document.getElementById('btn-salvar');
        DOM.campoTipo = document.getElementById('campo-tipo');
        DOM.campoNome = document.getElementById('campo-nome');
        DOM.campoEmail = document.getElementById('campo-email');
        DOM.campoEspecialidadeLista = document.getElementById('campo-especialidade-lista');
        DOM.labelEspecHint = document.getElementById('label-espec-hint');
        DOM.avisoEditEspec = document.getElementById('aviso-edit-espec');
        DOM.campoSetor = document.getElementById('campo-setor');
        DOM.campoCanal = document.getElementById('campo-canal');
        DOM.campoDescricao = document.getElementById('campo-descricao');
    }

    function escapeHtml(texto) {
        if (!texto) return '-';
        var div = document.createElement('div');
        div.appendChild(document.createTextNode(texto));
        return div.innerHTML;
    }

    function atualizarStatus(s) {
        if (!DOM.statusIndicator) return;
        DOM.statusIndicator.className = 'status-indicator';
        if (s === 'online') DOM.statusIndicator.classList.add('status-online');
        else if (s === 'offline') DOM.statusIndicator.classList.add('status-offline');
        else if (s === 'loading') DOM.statusIndicator.classList.add('status-loading');
    }

    function atualizarHorario() {
        if (!DOM.ultimaAtualizacao) return;
        DOM.ultimaAtualizacao.textContent = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    }

    function fetchJSON(url, opcoes) {
        opcoes = opcoes || {};
        opcoes.credentials = 'same-origin';
        opcoes.headers = opcoes.headers || {};
        if (opcoes.body) {
            opcoes.headers['Content-Type'] = 'application/json';
        }
        return fetch(url, opcoes).then(function(resp) {
            return resp.json();
        });
    }

    function carregarDashboard() {
        atualizarStatus('loading');
        fetchJSON(CONFIG.urlBase + '/dashboard').then(function(resp) {
            if (!resp.success) return;
            DOM.kpiDestinatarios.textContent = resp.total_destinatarios || 0;
            DOM.kpiTipos.textContent = resp.total_tipos || 0;
            DOM.kpiEnviadosHoje.textContent = resp.envios_hoje ? resp.envios_hoje.total_hoje : 0;
            DOM.kpiErrosHoje.textContent = resp.envios_hoje ? resp.envios_hoje.erro_hoje : 0;

            var cards = document.querySelectorAll('.resumo-card');
            for (var i = 0; i < cards.length; i++) {
                cards[i].classList.add('atualizando');
                (function(c) { setTimeout(function() { c.classList.remove('atualizando'); }, 300); })(cards[i]);
            }
            atualizarStatus('online');
            atualizarHorario();
        }).catch(function(err) {
            console.error('Erro dashboard:', err);
            atualizarStatus('offline');
        });
    }

    function carregarTipos() {
        fetchJSON(CONFIG.urlBase + '/tipos').then(function(resp) {
            if (!resp.success) return;
            Estado.tipos = resp.data;
            var html = '<option value="">Todos os tipos</option>';
            var htmlModal = '<option value="">Selecione...</option>';
            for (var i = 0; i < resp.data.length; i++) {
                var t = resp.data[i];
                html += '<option value="' + escapeHtml(t.codigo) + '">' + escapeHtml(t.nome) + '</option>';
                htmlModal += '<option value="' + escapeHtml(t.codigo) + '">' + escapeHtml(t.nome) + '</option>';
            }
            DOM.filtroTipo.innerHTML = html;
            DOM.campoTipo.innerHTML = htmlModal;
        });
    }

    function carregarEspecialidades() {
        fetchJSON(CONFIG.urlBase + '/especialidades').then(function(resp) {
            if (!resp.success) return;
            Estado.especialidades = resp.data;
            var html = '<option value="">Todas especialidades</option>';
            for (var i = 0; i < resp.data.length; i++) {
                html += '<option value="' + escapeHtml(resp.data[i]) + '">' + escapeHtml(resp.data[i]) + '</option>';
            }
            DOM.filtroEspecialidade.innerHTML = html;
            renderizarCheckboxesEspecialidade(resp.data);
        });
    }

    function renderizarCheckboxesEspecialidade(lista) {
        var html = '<label class="espec-check-item espec-check-todas"><input type="checkbox" class="espec-checkbox" id="espec-todas" value=""><span>Todas (recebe de todas as especialidades)</span></label>';
        for (var i = 0; i < lista.length; i++) {
            html += '<label class="espec-check-item"><input type="checkbox" class="espec-checkbox" value="' + escapeHtml(lista[i]) + '"><span>' + escapeHtml(lista[i]) + '</span></label>';
        }
        DOM.campoEspecialidadeLista.innerHTML = html;
        vincularLogicaTodas();
    }

    function vincularLogicaTodas() {
        var todasChk = document.getElementById('espec-todas');
        if (!todasChk) return;
        todasChk.addEventListener('change', function() {
            if (this.checked) {
                var outros = DOM.campoEspecialidadeLista.querySelectorAll('.espec-checkbox:not(#espec-todas)');
                for (var i = 0; i < outros.length; i++) outros[i].checked = false;
            }
        });
        var especificos = DOM.campoEspecialidadeLista.querySelectorAll('.espec-checkbox:not(#espec-todas)');
        for (var i = 0; i < especificos.length; i++) {
            especificos[i].addEventListener('change', function() {
                if (this.checked) {
                    var todas = document.getElementById('espec-todas');
                    if (todas) todas.checked = false;
                }
            });
        }
    }

    function desmarcarTodasEspecialidades() {
        if (!DOM.campoEspecialidadeLista) return;
        var checkboxes = DOM.campoEspecialidadeLista.querySelectorAll('.espec-checkbox');
        for (var i = 0; i < checkboxes.length; i++) checkboxes[i].checked = false;
    }

    function marcarEspecialidade(valor) {
        desmarcarTodasEspecialidades();
        if (!DOM.campoEspecialidadeLista) return;
        var checkboxes = DOM.campoEspecialidadeLista.querySelectorAll('.espec-checkbox');
        for (var i = 0; i < checkboxes.length; i++) {
            if (checkboxes[i].value === (valor || '')) { checkboxes[i].checked = true; break; }
        }
    }

    function obterEspecialidadesSelecionadas() {
        var result = [];
        if (!DOM.campoEspecialidadeLista) return result;
        var checkboxes = DOM.campoEspecialidadeLista.querySelectorAll('.espec-checkbox');
        for (var i = 0; i < checkboxes.length; i++) {
            if (checkboxes[i].checked) result.push(checkboxes[i].value);
        }
        return result;
    }

    function carregarDestinatarios() {
        var params = [];
        var tipo = DOM.filtroTipo.value;
        var espec = DOM.filtroEspecialidade.value;
        var ativo = DOM.filtroAtivo.value;
        if (tipo) params.push('tipo_evento=' + encodeURIComponent(tipo));
        if (espec) params.push('especialidade=' + encodeURIComponent(espec));
        if (ativo) params.push('ativo=' + ativo);
        var url = CONFIG.urlBase + '/destinatarios';
        if (params.length > 0) url += '?' + params.join('&');

        fetchJSON(url).then(function(resp) {
            if (!resp.success) return;
            Estado.destinatarios = resp.data;
            renderizarTabela(resp.data);
        }).catch(function(err) {
            console.error('Erro destinatarios:', err);
            DOM.tabelaDestinatarios.innerHTML = '<p class="texto-vazio">Erro ao carregar</p>';
        });
    }

    function renderizarTabela(dados) {
        if (!dados || dados.length === 0) {
            DOM.tabelaDestinatarios.innerHTML = '<p class="texto-vazio">Nenhum destinatario cadastrado</p>';
            return;
        }
        var html = '<table class="tabela-dest"><thead><tr>';
        html += '<th></th><th>Tipo</th><th>Nome</th><th>Email</th><th>Especialidade</th><th>Canal</th><th>Acoes</th>';
        html += '</tr></thead><tbody>';

        for (var i = 0; i < dados.length; i++) {
            var d = dados[i];
            var classeInativo = d.ativo ? '' : ' class="inativo"';
            html += '<tr' + classeInativo + '>';
            html += '<td><span class="badge-status' + (d.ativo ? '' : ' inativo') + '"></span></td>';
            var corTipo = d.tipo_evento_cor || '#dc3545';
            html += '<td><span class="badge-tipo" style="background:' + corTipo + '20; color:' + corTipo + '; border: 1px solid ' + corTipo + '40;">';
            html += '<i class="fas ' + escapeHtml(d.tipo_evento_icone || 'fa-bell') + '"></i> ';
            html += escapeHtml(d.tipo_evento_nome || d.tipo_evento);
            html += '</span></td>';
            html += '<td><strong>' + escapeHtml(d.nome) + '</strong>';
            if (d.descricao) html += '<br><span style="font-size:0.68rem;color:var(--cor-texto-muted);">' + escapeHtml(d.descricao) + '</span>';
            html += '</td>';
            html += '<td>' + escapeHtml(d.email) + '</td>';
            if (d.especialidade) {
                html += '<td><span class="badge-espec">' + escapeHtml(d.especialidade) + '</span></td>';
            } else {
                html += '<td><span class="badge-espec badge-espec-geral">Todas</span></td>';
            }
            var classeCanal = d.canal === 'ntfy' ? ' badge-canal-ntfy' : '';
            html += '<td><span class="badge-canal' + classeCanal + '">' + escapeHtml(d.canal || 'email') + '</span></td>';
            html += '<td><div class="acoes-grupo">';
            html += '<button class="btn-acao btn-editar" onclick="window.P26.editar(' + d.id + ')" title="Editar"><i class="fas fa-pen"></i></button>';
            var classeToggle = d.ativo ? '' : ' inativo';
            var iconeToggle = d.ativo ? 'fa-toggle-on' : 'fa-toggle-off';
            html += '<button class="btn-acao btn-toggle' + classeToggle + '" onclick="window.P26.toggle(' + d.id + ')" title="Ativar/Desativar"><i class="fas ' + iconeToggle + '"></i></button>';
            html += '<button class="btn-acao btn-excluir" onclick="window.P26.excluir(' + d.id + ')" title="Excluir"><i class="fas fa-trash"></i></button>';
            html += '</div></td>';
            html += '</tr>';
        }
        html += '</tbody></table>';
        DOM.tabelaDestinatarios.innerHTML = html;
    }

function carregarHistorico() {
        fetchJSON(CONFIG.urlBase + '/historico?limite=100').then(function(resp) {
            if (!resp.success) return;
            DOM.contadorHistorico.textContent = resp.total + ' envios';
            renderizarTimeline(resp.data);
        }).catch(function(err) { console.error('Erro historico:', err); });
    }

function renderizarTimeline(dados) {
        if (!dados || dados.length === 0) {
            DOM.timelineHistorico.innerHTML = '<p class="texto-vazio">Nenhum envio registrado ainda</p>';
            return;
        }
        var html = '';
        for (var i = 0; i < dados.length; i++) {
            var h = dados[i];
            var classeIcone = h.sucesso ? 'sucesso' : 'erro';
            var icone = h.sucesso ? 'fa-check' : 'fa-times';
            var canalBadge = h.canal === 'email'
                ? '<span style="font-size:0.6rem;background:#e3f2fd;color:#1565c0;padding:1px 5px;border-radius:4px;">email</span>'
                : '<span style="font-size:0.6rem;background:#e8f5e9;color:#2e7d32;padding:1px 5px;border-radius:4px;">ntfy</span>';

            html += '<div class="timeline-item">';
            html += '<div class="timeline-icone ' + classeIcone + '"><i class="fas ' + icone + '"></i></div>';
            html += '<div class="timeline-info">';
            html += '<div class="timeline-titulo">' + escapeHtml(h.titulo || 'Notificacao') + '</div>';
            html += '<div class="timeline-detalhe">';
            html += escapeHtml(h.tipo_evento_nome || h.tipo_evento);
            html += ' ' + canalBadge;
            if (h.qt_destinatarios) html += ' &middot; ' + h.qt_destinatarios + 'x';
            html += '</div>';
            // Erro com detalhe
            if (!h.sucesso && h.erro_mensagem) {
                html += '<div class="timeline-erro-detalhe"><i class="fas fa-exclamation-circle"></i> ' + escapeHtml(h.erro_mensagem) + '</div>';
            }
            // Resposta do servidor (mesmo sucesso, mostra topicos)
            if (h.sucesso && h.detalhe_resposta && h.canal === 'ntfy') {
                html += '<div style="font-size:0.6rem;color:#999;margin-top:2px;">' + escapeHtml(h.detalhe_resposta) + '</div>';
            }
            html += '</div>';
            html += '<div class="timeline-data">' + escapeHtml(h.dt_envio_fmt) + '</div>';
            html += '</div>';
        }
        DOM.timelineHistorico.innerHTML = html;
    }

    function abrirModal(dados) {
        Estado.editandoId = null;
        DOM.campoTipo.value = '';
        DOM.campoNome.value = '';
        DOM.campoEmail.value = '';
        DOM.campoSetor.value = '';
        DOM.campoCanal.value = 'email';
        DOM.campoDescricao.value = '';
        desmarcarTodasEspecialidades();
        DOM.modalTitulo.innerHTML = '<i class="fas fa-user-plus"></i> Novo Destinatario';

        if (dados) {
            Estado.editandoId = dados.id;
            DOM.modalTitulo.innerHTML = '<i class="fas fa-user-edit"></i> Editar Destinatario';
            DOM.campoTipo.value = dados.tipo_evento || '';
            DOM.campoNome.value = dados.nome || '';
            DOM.campoEmail.value = dados.email || '';
            DOM.campoSetor.value = dados.setor || '';
            DOM.campoCanal.value = dados.canal || 'email';
            DOM.campoDescricao.value = dados.descricao || '';
            marcarEspecialidade(dados.especialidade || '');
            if (DOM.labelEspecHint) DOM.labelEspecHint.textContent = '(especialidade atual)';
            if (DOM.avisoEditEspec) DOM.avisoEditEspec.style.display = '';
        } else {
            if (DOM.labelEspecHint) DOM.labelEspecHint.textContent = '(selecione uma ou mais)';
            if (DOM.avisoEditEspec) DOM.avisoEditEspec.style.display = 'none';
        }

        DOM.modalOverlay.classList.add('ativo');
    }

    function fecharModal() {
        DOM.modalOverlay.classList.remove('ativo');
        Estado.editandoId = null;
    }

    function salvar() {
        var tipo = DOM.campoTipo.value;
        var nome = DOM.campoNome.value;
        var email = DOM.campoEmail.value;
        var setor = DOM.campoSetor.value;
        var canal = DOM.campoCanal.value;
        var descricao = DOM.campoDescricao.value;

        if (!tipo || !nome || !email) {
            alert('Preencha os campos obrigatorios: Tipo, Nome e Email');
            return;
        }

        if (Estado.editandoId) {
            var esps = obterEspecialidadesSelecionadas();
            var dadosEdit = {
                tipo_evento: tipo,
                nome: nome,
                email: email,
                especialidade: esps.length > 0 ? esps[0] : '',
                setor: setor,
                canal: canal,
                descricao: descricao
            };
            fetchJSON(CONFIG.urlBase + '/destinatarios/' + Estado.editandoId, {
                method: 'PUT',
                body: JSON.stringify(dadosEdit)
            }).then(function(resp) {
                if (resp.success) { fecharModal(); carregarDestinatarios(); carregarDashboard(); }
                else { alert(resp.error || 'Erro ao salvar'); }
            }).catch(function() { alert('Erro de conexao'); });
            return;
        }

        // Criacao: uma requisicao por especialidade selecionada
        var especialidades = obterEspecialidadesSelecionadas();
        if (especialidades.length === 0) especialidades = [''];

        var pendentes = especialidades.slice();
        var erros = [];
        var sucessos = 0;

        function enviarProximo() {
            if (pendentes.length === 0) {
                if (erros.length > 0) alert('Alguns registros nao foram salvos:\n' + erros.join('\n'));
                if (sucessos > 0) { fecharModal(); carregarDestinatarios(); carregarDashboard(); }
                return;
            }
            var espec = pendentes.shift();
            fetchJSON(CONFIG.urlBase + '/destinatarios', {
                method: 'POST',
                body: JSON.stringify({
                    tipo_evento: tipo,
                    nome: nome,
                    email: email,
                    especialidade: espec,
                    setor: setor,
                    canal: canal,
                    descricao: descricao
                })
            }).then(function(resp) {
                if (resp.success) { sucessos++; }
                else { erros.push(resp.error || ('Erro para ' + (espec || 'Todas'))); }
                enviarProximo();
            }).catch(function() {
                erros.push('Erro de conexao para ' + (espec || 'Todas'));
                enviarProximo();
            });
        }

        enviarProximo();
    }

    function toggleAtivo(id) {
        fetchJSON(CONFIG.urlBase + '/destinatarios/' + id + '/toggle', { method: 'PUT' }).then(function(resp) {
            if (resp.success) { carregarDestinatarios(); carregarDashboard(); }
        });
    }

    function editar(id) {
        for (var i = 0; i < Estado.destinatarios.length; i++) {
            if (Estado.destinatarios[i].id === id) { abrirModal(Estado.destinatarios[i]); break; }
        }
    }

    function excluir(id) {
        if (!confirm('Tem certeza que deseja excluir este destinatario?')) return;
        fetchJSON(CONFIG.urlBase + '/destinatarios/' + id, { method: 'DELETE' }).then(function(resp) {
            if (resp.success) { carregarDestinatarios(); carregarDashboard(); }
            else { alert(resp.error || 'Erro ao excluir'); }
        });
    }

    function registrarEventos() {
        DOM.btnNovo.addEventListener('click', function() { abrirModal(); });
        DOM.modalFechar.addEventListener('click', fecharModal);
        DOM.btnCancelar.addEventListener('click', fecharModal);
        DOM.btnSalvar.addEventListener('click', salvar);
        DOM.modalOverlay.addEventListener('click', function(e) { if (e.target === DOM.modalOverlay) fecharModal(); });
        DOM.filtroTipo.addEventListener('change', carregarDestinatarios);
        DOM.filtroEspecialidade.addEventListener('change', carregarDestinatarios);
        DOM.filtroAtivo.addEventListener('change', carregarDestinatarios);

        if (DOM.btnVoltar) DOM.btnVoltar.addEventListener('click', function() { window.location.href = '/frontend/dashboard.html'; });
        if (DOM.btnRefresh) DOM.btnRefresh.addEventListener('click', function() {
            DOM.btnRefresh.classList.add('girando');
            carregarDashboard();
            carregarDestinatarios();
            carregarHistorico();
            setTimeout(function() { DOM.btnRefresh.classList.remove('girando'); }, 500);
        });

        document.addEventListener('keydown', function(e) {
            if (e.key === 'Escape') fecharModal();
        });


        // Toggle historico
        var toggleHist = document.getElementById('toggle-historico');
        if (toggleHist) {
            toggleHist.addEventListener('click', function() {
                this.classList.toggle('recolhido');
                var content = this.closest('.secao-analise').querySelector('.secao-content');
                if (content) content.classList.toggle('recolhido');
            });
        }
    }

    window.P26 = { editar: editar, toggle: toggleAtivo, excluir: excluir };

    function inicializar() {
        console.log('[P26] Inicializando...');
        capturarDOM();
        registrarEventos();
        carregarTipos();
        carregarEspecialidades();
        carregarDashboard();
        carregarDestinatarios();
        carregarHistorico();

        Estado.timerAtualizacao = setInterval(function() {
            carregarDashboard();
            carregarHistorico();
        }, CONFIG.intervaloAtualizacao);

        console.log('[P26] Inicializado com sucesso');
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', inicializar);
    else inicializar();

})();