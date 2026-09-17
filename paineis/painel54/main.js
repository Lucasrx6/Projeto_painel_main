/* Painel 54 - Gestao de Transporte de Material — ES5 IIFE */
(function () {
    'use strict';

    var CONFIG = {
        api: '/api/paineis/painel54',
        refreshInterval: 30000,
        analyticsDias: 7
    };

    var Estado = {
        tabAtiva: 'dashboard',
        chamadoIdCancelar: null,
        chamadosCarregados: false,
        analyticsCarregados: false,
        configCarregada: false,
        tipos: []
    };

    function escHtml(s) {
        if (s == null) return '';
        return String(s)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function toast(msg, tipo) {
        var tc = document.getElementById('toast-container');
        if (!tc) return;
        var t = document.createElement('div');
        t.className = 'toast toast-' + (tipo || 'info');
        t.textContent = msg;
        tc.appendChild(t);
        setTimeout(function () { if (t.parentNode) t.parentNode.removeChild(t); }, 3500);
    }

    function fecharModal(id) {
        var m = document.getElementById(id);
        if (m) m.style.display = 'none';
    }

    function abrirModal(id) {
        var m = document.getElementById(id);
        if (m) m.style.display = 'flex';
    }

    function formatarData(iso) {
        if (!iso) return '—';
        try {
            var d = new Date(iso);
            return d.toLocaleDateString('pt-BR') + ' ' + d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
        } catch (e) { return iso; }
    }

    function formatarMin(v) {
        if (v == null) return '—';
        var n = Math.round(parseFloat(v));
        if (n >= 60) return Math.floor(n / 60) + 'h ' + (n % 60) + 'min';
        return n + ' min';
    }

    /* ── TABS ─────────────────────────────────────── */
    function ativarTab(nome) {
        Estado.tabAtiva = nome;
        var tabs = document.querySelectorAll('.tab-btn');
        for (var i = 0; i < tabs.length; i++) {
            tabs[i].classList.toggle('ativa', tabs[i].getAttribute('data-tab') === nome);
        }
        var conteudos = document.querySelectorAll('.tab-content');
        for (var j = 0; j < conteudos.length; j++) {
            conteudos[j].style.display = conteudos[j].id === 'tab-' + nome ? '' : 'none';
        }

        if (nome === 'dashboard') carregarDashboard();
        else if (nome === 'chamados' && !Estado.chamadosCarregados) {
            Estado.chamadosCarregados = true;
            var hoje = new Date();
            var sete = new Date(hoje); sete.setDate(hoje.getDate() - 7);
            document.getElementById('filtro-data-inicio').value = sete.toISOString().slice(0, 10);
            document.getElementById('filtro-data-fim').value    = hoje.toISOString().slice(0, 10);
            carregarChamados();
        }
        else if (nome === 'analytics' && !Estado.analyticsCarregados) {
            Estado.analyticsCarregados = true;
            carregarAnalytics();
        }
        else if (nome === 'config' && !Estado.configCarregada) {
            Estado.configCarregada = true;
            carregarTodasConfigs();
        }
    }

    /* ── DASHBOARD ────────────────────────────────── */
    function carregarDashboard() {
        fetch(CONFIG.api + '/dashboard', { credentials: 'same-origin' })
            .then(function (r) { return r.json(); })
            .then(function (data) {
                if (!data.success) return;
                renderizarStats(data.stats || {});
                renderizarAtivos(data.ativos || []);

                var total = (data.stats.aguardando || 0) + (data.stats.aceito || 0) + (data.stats.em_transporte || 0);
                var badge = document.getElementById('badge-ativos-tab');
                if (badge) badge.textContent = total;
            })
            .catch(function (e) { console.error(e); });
    }

    var _STAT_DEFS = [
        { key: 'aguardando',     label: 'Aguardando',      cls: 'aguardando', icon: 'fa-hourglass-half' },
        { key: 'em_transporte',  label: 'Em Transporte',   cls: 'transporte', icon: 'fa-truck' },
        { key: 'entregues_hoje', label: 'Entregues Hoje',  cls: 'entregue',   icon: 'fa-box-open' },
        { key: 'cancelados_hoje', label: 'Cancelados',     cls: 'cancelado',  icon: 'fa-times' },
        { key: 'urgentes_aguardando', label: 'Urgentes',   cls: 'urgente',    icon: 'fa-bolt' },
        { key: 'tempo_medio_total_hoje', label: 'T.Medio(min)', cls: 'tempo', icon: 'fa-stopwatch', fmt: true }
    ];

    function renderizarStats(stats) {
        var grid = document.getElementById('stats-grid');
        if (!grid) return;
        var html = '';
        for (var i = 0; i < _STAT_DEFS.length; i++) {
            var d = _STAT_DEFS[i];
            var v = stats[d.key];
            var disp = (v == null) ? '—' : (d.fmt ? formatarMin(v) : v);
            html += '<div class="stat-card ' + d.cls + '">' +
                '<div class="stat-valor">' + escHtml(String(disp)) + '</div>' +
                '<div class="stat-label"><i class="fas ' + d.icon + '"></i> ' + d.label + '</div>' +
                '</div>';
        }
        grid.innerHTML = html;
    }

    var _STATUS_BADGE = {
        'aguardando':    'badge-aguardando',
        'aceito':        'badge-aceito',
        'em_transporte': 'badge-em_transporte',
        'entregue':      'badge-entregue',
        'cancelado':     'badge-cancelado'
    };
    var _STATUS_LABEL = {
        'aguardando':    'Aguardando',
        'aceito':        'Aceito',
        'em_transporte': 'Em Transporte',
        'entregue':      'Entregue',
        'cancelado':     'Cancelado'
    };

    function renderizarAtivos(ativos) {
        var lista = document.getElementById('lista-ativos');
        if (!lista) return;
        if (!ativos.length) {
            lista.innerHTML = '<p style="color:#aaa;font-size:13px;padding:8px;">Nenhum chamado ativo no momento.</p>';
            return;
        }
        var html = '<table class="chamados-tabela"><thead><tr>' +
            '<th>Protocolo</th><th>Tipo</th><th>Rota</th><th>Prioridade</th><th>Status</th><th>Solicitante</th><th>Motorista</th><th>Espera</th>' +
            '</tr></thead><tbody>';
        for (var i = 0; i < ativos.length; i++) {
            var c = ativos[i];
            var bc = _STATUS_BADGE[c.status] || '';
            html += '<tr>' +
                '<td class="protocolo-col">' + escHtml(c.nr_protocolo) + '</td>' +
                '<td>' + escHtml(c.tipo_carga_nome || '') + '</td>' +
                '<td>' + escHtml(c.setor_origem_nome) + ' → ' + escHtml(c.destino_nome) + '</td>' +
                '<td>' + (c.prioridade === 'urgente' ? '<span class="badge-urgente-sm">URGENTE</span>' : 'Normal') + '</td>' +
                '<td><span class="badge-status ' + bc + '">' + escHtml(_STATUS_LABEL[c.status] || c.status) + '</span></td>' +
                '<td>' + escHtml(c.solicitante_nome || '') + '</td>' +
                '<td>' + escHtml(c.motorista_nome || '—') + '</td>' +
                '<td>' + formatarMin(c.minutos_espera) + '</td>' +
                '</tr>';
        }
        html += '</tbody></table>';
        lista.innerHTML = html;
    }

    /* ── CHAMADOS ─────────────────────────────────── */
    function carregarChamados() {
        var params = new URLSearchParams();
        var di = document.getElementById('filtro-data-inicio').value;
        var df = document.getElementById('filtro-data-fim').value;
        var st = document.getElementById('filtro-status').value;
        var pr = document.getElementById('filtro-prioridade').value;
        var se = document.getElementById('filtro-setor').value.trim();
        if (di && df) { params.append('data_inicio', di); params.append('data_fim', df); }
        else          { params.append('dias', 7); }
        if (st) params.append('status', st);
        if (pr) params.append('prioridade', pr);
        if (se) params.append('setor', se);

        var tbody = document.getElementById('chamados-tbody');
        var total = document.getElementById('chamados-total');
        if (tbody) tbody.innerHTML = '<tr><td colspan="10" style="text-align:center;padding:20px;"><div class="loading-inline" style="justify-content:center;"><div class="loading-spinner-sm"></div> Carregando...</div></td></tr>';

        fetch(CONFIG.api + '/chamados?' + params.toString(), { credentials: 'same-origin' })
            .then(function (r) { return r.json(); })
            .then(function (data) {
                if (!data.success) { toast(data.error || 'Erro ao buscar chamados.', 'error'); return; }
                var chamados = data.chamados || [];
                if (total) total.textContent = chamados.length + ' chamado(s) encontrado(s)';
                if (!tbody) return;
                if (!chamados.length) {
                    tbody.innerHTML = '<tr><td colspan="10" style="text-align:center;padding:30px;color:#aaa;">Nenhum chamado encontrado com estes filtros.</td></tr>';
                    return;
                }
                var html = '';
                for (var i = 0; i < chamados.length; i++) {
                    var c = chamados[i];
                    var bc = _STATUS_BADGE[c.status] || '';
                    var podeCancelar = ['aguardando', 'aceito', 'em_transporte'].indexOf(c.status) >= 0;
                    html += '<tr>' +
                        '<td class="protocolo-col">' + escHtml(c.nr_protocolo) + '</td>' +
                        '<td>' + escHtml(c.tipo_carga_nome || '') + '</td>' +
                        '<td style="max-width:200px;">' + escHtml(c.setor_origem_nome) + ' → ' + escHtml(c.destino_nome) + '</td>' +
                        '<td>' + (c.prioridade === 'urgente' ? '<span class="badge-urgente-sm">URGENTE</span>' : 'Normal') + '</td>' +
                        '<td><span class="badge-status ' + bc + '">' + escHtml(_STATUS_LABEL[c.status] || c.status) + '</span></td>' +
                        '<td>' + escHtml(c.solicitante_nome || '') + '</td>' +
                        '<td>' + escHtml(c.motorista_nome || '—') + '</td>' +
                        '<td>' + (c.t_total_min != null ? formatarMin(c.t_total_min) : '—') + '</td>' +
                        '<td style="white-space:nowrap;">' + escHtml(formatarData(c.criado_em)) + '</td>' +
                        '<td class="acoes-col">' +
                        (c.tem_assinatura ? '<button class="btn-acao-tabela" data-id="' + c.id + '" data-acao="assinatura"><i class="fas fa-signature"></i></button>' : '') +
                        (podeCancelar ? '<button class="btn-acao-tabela btn-acao-cancelar" data-id="' + c.id + '" data-acao="cancelar"><i class="fas fa-times"></i></button>' : '') +
                        '</td>' +
                        '</tr>';
                }
                tbody.innerHTML = html;

                var btns = tbody.querySelectorAll('.btn-acao-tabela');
                for (var j = 0; j < btns.length; j++) {
                    btns[j].addEventListener('click', function (e) {
                        var id = parseInt(e.currentTarget.getAttribute('data-id'), 10);
                        var acao = e.currentTarget.getAttribute('data-acao');
                        if (acao === 'cancelar') {
                            Estado.chamadoIdCancelar = id;
                            document.getElementById('admin-cancelar-motivo').value = '';
                            abrirModal('modal-cancelar-admin');
                        } else if (acao === 'assinatura') {
                            abrirAssinatura(id);
                        }
                    });
                }
            })
            .catch(function (e) { console.error(e); toast('Erro ao buscar chamados.', 'error'); });
    }

    function cancelarAdmin() {
        var motivo = (document.getElementById('admin-cancelar-motivo').value || '').trim();
        if (motivo.length < 10) { toast('O motivo deve ter pelo menos 10 caracteres.', 'warning'); return; }
        var btn = document.getElementById('btn-confirmar-cancelar-admin');
        btn.disabled = true;
        fetch(CONFIG.api + '/chamados/' + Estado.chamadoIdCancelar + '/cancelar', {
            method: 'PUT', credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ motivo: motivo })
        })
            .then(function (r) { return r.json(); })
            .then(function (data) {
                btn.disabled = false;
                fecharModal('modal-cancelar-admin');
                if (data.success) { toast('Chamado cancelado.', 'success'); carregarChamados(); carregarDashboard(); }
                else { toast(data.error || 'Erro ao cancelar.', 'error'); }
            })
            .catch(function (e) { console.error(e); btn.disabled = false; toast('Erro de conexao.', 'error'); });
    }

    function abrirAssinatura(id) {
        var body = document.getElementById('modal-assinatura-body');
        if (body) body.innerHTML = '<div class="loading-inline"><div class="loading-spinner-sm"></div> Carregando...</div>';
        abrirModal('modal-assinatura');

        fetch(CONFIG.api + '/chamados/' + id + '/assinatura', { credentials: 'same-origin' })
            .then(function (r) { return r.json(); })
            .then(function (data) {
                if (!body) return;
                if (!data.success || !data.assinatura) {
                    body.innerHTML = '<p style="color:#aaa;text-align:center;">Assinatura nao encontrada.</p>';
                    return;
                }
                var a = data.assinatura;
                var html = '';
                if (a.assinatura_img) {
                    html += '<img src="' + escHtml(a.assinatura_img) + '" class="assin-img" alt="Assinatura">';
                }
                html += '<div class="assin-info-row">' +
                    '<span class="assin-info-item"><strong>Protocolo:</strong> ' + escHtml(a.nr_protocolo || '') + '</span>' +
                    '<span class="assin-info-item"><strong>Destinatario:</strong> ' + escHtml(a.nm_destinatario || '') + '</span>' +
                    '</div>' +
                    '<div class="assin-info-row">' +
                    '<span class="assin-info-item"><strong>Entregue em:</strong> ' + escHtml(formatarData(a.dt_entrega)) + '</span>' +
                    '<span class="assin-info-item"><strong>Motorista:</strong> ' + escHtml(a.coletado_por_nome || '') + '</span>' +
                    '</div>';
                body.innerHTML = html;
            })
            .catch(function (e) {
                console.error(e);
                if (body) body.innerHTML = '<p style="color:#dc3545;">Erro ao carregar assinatura.</p>';
            });
    }

    /* ── EXPORTAR ─────────────────────────────────── */
    function exportar() {
        var params = new URLSearchParams();
        var di = document.getElementById('filtro-data-inicio').value;
        var df = document.getElementById('filtro-data-fim').value;
        if (di && df) { params.append('data_inicio', di); params.append('data_fim', df); }
        else          { params.append('dias', 30); }
        var st = document.getElementById('filtro-status').value;
        var pr = document.getElementById('filtro-prioridade').value;
        var se = document.getElementById('filtro-setor').value.trim();
        if (st) params.append('status', st);
        if (pr) params.append('prioridade', pr);
        if (se) params.append('setor', se);
        window.location.href = CONFIG.api + '/exportar?' + params.toString();
    }

    /* ── ANALYTICS ────────────────────────────────── */
    function carregarAnalytics() {
        var dias = CONFIG.analyticsDias;
        var params = 'dias=' + dias;

        fetch(CONFIG.api + '/por-setor?' + params, { credentials: 'same-origin' })
            .then(function (r) { return r.json(); })
            .then(function (data) {
                var tbody = document.getElementById('tbody-por-setor');
                if (!tbody) return;
                if (!data.success || !data.setores || !data.setores.length) {
                    tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;padding:20px;color:#aaa;">Sem dados</td></tr>';
                    return;
                }
                var maxTotal = Math.max.apply(null, data.setores.map(function (s) { return s.total || 0; }));
                var html = '';
                for (var i = 0; i < data.setores.length; i++) {
                    var s = data.setores[i];
                    var pct = maxTotal > 0 ? Math.round((s.total / maxTotal) * 100) : 0;
                    html += '<tr>' +
                        '<td class="nome">' +
                        '<div class="barra-wrapper">' +
                        '<span style="min-width:80px;">' + escHtml(s.setor || '') + '</span>' +
                        '<div class="barra-bg"><div class="barra-fill" style="width:' + pct + '%;"></div></div>' +
                        '</div></td>' +
                        '<td class="num">' + escHtml(String(s.total || 0)) + '</td>' +
                        '<td class="num">' + escHtml(String(s.entregues || 0)) + '</td>' +
                        '<td class="num">' + (s.t_total_min != null ? formatarMin(s.t_total_min) : '—') + '</td>' +
                        '</tr>';
                }
                tbody.innerHTML = html;
            })
            .catch(function (e) { console.error(e); });

        fetch(CONFIG.api + '/por-motorista?' + params, { credentials: 'same-origin' })
            .then(function (r) { return r.json(); })
            .then(function (data) {
                var tbody = document.getElementById('tbody-por-motorista');
                if (!tbody) return;
                if (!data.success || !data.motoristas || !data.motoristas.length) {
                    tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;padding:20px;color:#aaa;">Sem dados</td></tr>';
                    return;
                }
                var html = '';
                for (var i = 0; i < data.motoristas.length; i++) {
                    var m = data.motoristas[i];
                    html += '<tr>' +
                        '<td class="nome">' + escHtml(m.motorista || '') + '</td>' +
                        '<td class="num">' + escHtml(String(m.total || 0)) + '</td>' +
                        '<td class="num">' + escHtml(String(m.entregues || 0)) + '</td>' +
                        '<td class="num">' + (m.t_total_min != null ? formatarMin(m.t_total_min) : '—') + '</td>' +
                        '</tr>';
                }
                tbody.innerHTML = html;
            })
            .catch(function (e) { console.error(e); });
    }

    /* ── CONFIG ───────────────────────────────────── */
    function carregarTodasConfigs() {
        carregarCfgMotoristas();
        carregarCfgTipos();
        carregarCfgDestinos();
        carregarCfgOrigens();
        carregarCfgVeiculos();
    }

    function carregarCfgMotoristas() {
        fetch(CONFIG.api + '/config/motoristas', { credentials: 'same-origin' })
            .then(function (r) { return r.json(); })
            .then(function (data) {
                var lista = document.getElementById('lista-motoristas');
                if (!lista) return;
                if (!data.success || !data.motoristas || !data.motoristas.length) {
                    lista.innerHTML = '<p style="color:#aaa;padding:16px;font-size:13px;">Nenhum motorista cadastrado.</p>';
                    return;
                }
                var html = '';
                for (var i = 0; i < data.motoristas.length; i++) {
                    var m = data.motoristas[i];
                    html += '<div class="config-item">' +
                        '<div class="config-item-info">' +
                        '<div class="config-item-nome">' + escHtml(m.nome) + '</div>' +
                        '<div class="config-item-det">Matricula: ' + escHtml(m.matricula || '—') + ' | Turno: ' + escHtml(m.turno || 'todos') + '</div>' +
                        '</div>' +
                        '<div class="config-item-acoes">' +
                        '<button class="btn-edit-config" data-tipo="motorista" data-id="' + m.id + '"><i class="fas fa-pen"></i> Editar</button>' +
                        '<button class="toggle-ativo ' + (m.ativo ? 'ativo' : 'inativo') + '" data-tipo="motorista" data-id="' + m.id + '" data-ativo="' + (m.ativo ? '1' : '0') + '">' +
                        (m.ativo ? 'ON' : 'OFF') + '</button>' +
                        '</div></div>';
                }
                lista.innerHTML = html;
                ativarBotoesConfig(lista, data.motoristas);
            })
            .catch(function (e) { console.error(e); });
    }

    function carregarCfgTipos() {
        fetch(CONFIG.api + '/config/tipos-carga', { credentials: 'same-origin' })
            .then(function (r) { return r.json(); })
            .then(function (data) {
                Estado.tipos = data.tipos || [];
                var lista = document.getElementById('lista-tipos-carga');
                if (!lista) return;
                if (!data.success || !data.tipos || !data.tipos.length) {
                    lista.innerHTML = '<p style="color:#aaa;padding:16px;font-size:13px;">Nenhum tipo cadastrado.</p>';
                    return;
                }
                var html = '';
                for (var i = 0; i < data.tipos.length; i++) {
                    var t = data.tipos[i];
                    html += '<div class="config-item">' +
                        '<div class="config-item-info">' +
                        '<div class="config-item-nome"><i class="fas ' + escHtml(t.icone || 'fa-box') + '" style="color:' + escHtml(t.cor || '#666') + ';margin-right:6px;"></i>' + escHtml(t.nome) + '</div>' +
                        '<div class="config-item-det">' +
                        (t.requer_lista_itens ? '<span style="color:#6f42c1;font-size:11px;"><i class="fas fa-list"></i> Lista </span>' : '') +
                        (t.requer_assinatura ? '<span style="color:#dc3545;font-size:11px;"><i class="fas fa-signature"></i> Assinatura </span>' : '') +
                        (t.requer_foto ? '<span style="color:#fd7e14;font-size:11px;"><i class="fas fa-camera"></i> Foto' + (t.foto_obrigatoria ? '(obrig.)' : '') + '</span>' : '') +
                        '</div></div>' +
                        '<div class="config-item-acoes">' +
                        '<button class="btn-edit-config" data-tipo="tipo-carga" data-id="' + t.id + '"><i class="fas fa-pen"></i> Editar</button>' +
                        '<button class="toggle-ativo ' + (t.ativo ? 'ativo' : 'inativo') + '" data-tipo="tipo-carga" data-id="' + t.id + '" data-ativo="' + (t.ativo ? '1' : '0') + '">' +
                        (t.ativo ? 'ON' : 'OFF') + '</button>' +
                        '</div></div>';
                }
                lista.innerHTML = html;
                ativarBotoesConfig(lista, data.tipos);
            })
            .catch(function (e) { console.error(e); });
    }

    function carregarCfgDestinos() {
        fetch(CONFIG.api + '/config/destinos', { credentials: 'same-origin' })
            .then(function (r) { return r.json(); })
            .then(function (data) {
                var lista = document.getElementById('lista-destinos');
                if (!lista) return;
                if (!data.success || !data.destinos || !data.destinos.length) {
                    lista.innerHTML = '<p style="color:#aaa;padding:16px;font-size:13px;">Nenhum destino cadastrado.</p>';
                    return;
                }
                var html = '';
                for (var i = 0; i < data.destinos.length; i++) {
                    var d = data.destinos[i];
                    html += '<div class="config-item">' +
                        '<div class="config-item-info">' +
                        '<div class="config-item-nome">' + escHtml(d.nome) + '</div>' +
                        '<div class="config-item-det">' + (d.tipo_nome ? 'Tipo: ' + escHtml(d.tipo_nome) : 'Geral') +
                        (d.km_distancia != null ? ' | <i class="fas fa-road"></i> ' + escHtml(String(d.km_distancia)) + ' km' : '') + '</div>' +
                        '</div>' +
                        '<div class="config-item-acoes">' +
                        '<button class="btn-edit-config" data-tipo="destino" data-id="' + d.id + '"><i class="fas fa-pen"></i> Editar</button>' +
                        '<button class="toggle-ativo ' + (d.ativo ? 'ativo' : 'inativo') + '" data-tipo="destino" data-id="' + d.id + '" data-ativo="' + (d.ativo ? '1' : '0') + '">' +
                        (d.ativo ? 'ON' : 'OFF') + '</button>' +
                        '</div></div>';
                }
                lista.innerHTML = html;
                ativarBotoesConfig(lista, data.destinos);
            })
            .catch(function (e) { console.error(e); });
    }

    function carregarCfgOrigens() {
        fetch(CONFIG.api + '/config/origens', { credentials: 'same-origin' })
            .then(function (r) { return r.json(); })
            .then(function (data) {
                var lista = document.getElementById('lista-origens');
                if (!lista) return;
                if (!data.success || !data.origens || !data.origens.length) {
                    lista.innerHTML = '<p style="color:#aaa;padding:16px;font-size:13px;">Nenhuma origem cadastrada.</p>';
                    return;
                }
                var html = '';
                for (var i = 0; i < data.origens.length; i++) {
                    var o = data.origens[i];
                    html += '<div class="config-item">' +
                        '<div class="config-item-info">' +
                        '<div class="config-item-nome">' + escHtml(o.nome) + '</div>' +
                        (o.km_distancia != null ? '<div class="config-item-det"><i class="fas fa-road"></i> ' + escHtml(String(o.km_distancia)) + ' km</div>' : '') +
                        '</div>' +
                        '<div class="config-item-acoes">' +
                        '<button class="btn-edit-config" data-tipo="origem" data-id="' + o.id + '"><i class="fas fa-pen"></i> Editar</button>' +
                        '<button class="toggle-ativo ' + (o.ativo ? 'ativo' : 'inativo') + '" data-tipo="origem" data-id="' + o.id + '" data-ativo="' + (o.ativo ? '1' : '0') + '">' +
                        (o.ativo ? 'ON' : 'OFF') + '</button>' +
                        '</div></div>';
                }
                lista.innerHTML = html;
                ativarBotoesConfig(lista, data.origens);
            })
            .catch(function (e) { console.error(e); });
    }

    function carregarCfgVeiculos() {
        fetch(CONFIG.api + '/config/veiculos', { credentials: 'same-origin' })
            .then(function (r) { return r.json(); })
            .then(function (data) {
                var lista = document.getElementById('lista-veiculos');
                if (!lista) return;
                if (!data.success || !data.veiculos || !data.veiculos.length) {
                    lista.innerHTML = '<p style="color:#aaa;padding:16px;font-size:13px;">Nenhum veiculo cadastrado.</p>';
                    return;
                }
                var html = '';
                for (var i = 0; i < data.veiculos.length; i++) {
                    var v = data.veiculos[i];
                    var label = v.tipo.charAt(0).toUpperCase() + v.tipo.slice(1);
                    if (v.placa) label += ' - ' + v.placa;
                    html += '<div class="config-item">' +
                        '<div class="config-item-info">' +
                        '<div class="config-item-nome"><i class="fas fa-truck" style="color:#1C5C9B;margin-right:6px;"></i>' + escHtml(label) + '</div>' +
                        '<div class="config-item-det">' + escHtml(v.descricao || '') +
                        (v.km_max_dia != null ? ' | Km/dia: ' + escHtml(String(v.km_max_dia)) : '') + '</div>' +
                        '</div>' +
                        '<div class="config-item-acoes">' +
                        '<button class="btn-edit-config" data-tipo="veiculo" data-id="' + v.id + '"><i class="fas fa-pen"></i> Editar</button>' +
                        '<button class="toggle-ativo ' + (v.ativo ? 'ativo' : 'inativo') + '" data-tipo="veiculo" data-id="' + v.id + '" data-ativo="' + (v.ativo ? '1' : '0') + '">' +
                        (v.ativo ? 'ON' : 'OFF') + '</button>' +
                        '</div></div>';
                }
                lista.innerHTML = html;
                ativarBotoesConfig(lista, data.veiculos);
            })
            .catch(function (e) { console.error(e); });
    }

    function ativarBotoesConfig(container, dados) {
        var btnsEdit = container.querySelectorAll('.btn-edit-config');
        for (var i = 0; i < btnsEdit.length; i++) {
            btnsEdit[i].addEventListener('click', function (e) {
                var tipo = e.currentTarget.getAttribute('data-tipo');
                var id   = parseInt(e.currentTarget.getAttribute('data-id'), 10);
                var reg = null;
                for (var j = 0; j < dados.length; j++) { if (dados[j].id === id) { reg = dados[j]; break; } }
                abrirModalEdicao(tipo, reg);
            });
        }
        var btnsToggle = container.querySelectorAll('.toggle-ativo');
        for (var k = 0; k < btnsToggle.length; k++) {
            btnsToggle[k].addEventListener('click', function (e) {
                var tipo  = e.currentTarget.getAttribute('data-tipo');
                var id    = parseInt(e.currentTarget.getAttribute('data-id'), 10);
                var ativo = e.currentTarget.getAttribute('data-ativo') === '1';
                toggleAtivo(tipo, id, !ativo);
            });
        }
    }

    var _CONFIG_URL = { 'motorista': 'motoristas', 'tipo-carga': 'tipos-carga', 'destino': 'destinos', 'origem': 'origens', 'veiculo': 'veiculos' };
    var _CONFIG_RELOAD = {
        'motorista': function () { carregarCfgMotoristas(); },
        'tipo-carga': function () { carregarCfgTipos(); },
        'destino': function () { carregarCfgDestinos(); },
        'origem': function () { carregarCfgOrigens(); },
        'veiculo': function () { carregarCfgVeiculos(); }
    };

    function toggleAtivo(tipo, id, novoAtivo) {
        fetch(CONFIG.api + '/config/' + _CONFIG_URL[tipo] + '/' + id, {
            method: 'PUT', credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ativo: novoAtivo })
        })
            .then(function (r) { return r.json(); })
            .then(function (data) {
                if (data.success) {
                    if (_CONFIG_RELOAD[tipo]) _CONFIG_RELOAD[tipo]();
                } else {
                    toast(data.error || 'Erro ao atualizar.', 'error');
                }
            })
            .catch(function (e) { console.error(e); toast('Erro de conexao.', 'error'); });
    }

    function abrirModalEdicao(tipo, reg) {
        if (tipo === 'motorista') {
            document.getElementById('modal-motorista-titulo').textContent = reg ? 'Editar Motorista' : 'Novo Motorista';
            document.getElementById('motorista-edit-id').value   = reg ? reg.id : '';
            document.getElementById('motorista-nome').value      = reg ? (reg.nome || '') : '';
            document.getElementById('motorista-matricula').value = reg ? (reg.matricula || '') : '';
            document.getElementById('motorista-turno').value     = reg ? (reg.turno || 'todos') : 'todos';
            var ativoWrap = document.getElementById('motorista-ativo-wrap');
            if (ativoWrap) ativoWrap.style.display = reg ? '' : 'none';
            document.getElementById('motorista-ativo').checked = reg ? !!reg.ativo : true;
            abrirModal('modal-motorista');
        } else if (tipo === 'tipo-carga') {
            document.getElementById('modal-tipo-titulo').textContent = reg ? 'Editar Tipo de Carga' : 'Novo Tipo de Carga';
            document.getElementById('tipo-edit-id').value           = reg ? reg.id : '';
            document.getElementById('tipo-nome').value              = reg ? (reg.nome || '') : '';
            document.getElementById('tipo-icone').value             = reg ? (reg.icone || 'fa-box') : 'fa-box';
            document.getElementById('tipo-cor').value               = reg ? (reg.cor || '#6c757d') : '#6c757d';
            document.getElementById('tipo-ordem').value             = reg ? (reg.ordem || 0) : 0;
            document.getElementById('tipo-requer-lista').checked    = reg ? !!reg.requer_lista_itens : false;
            document.getElementById('tipo-requer-assinatura').checked = reg ? !!reg.requer_assinatura : false;
            document.getElementById('tipo-requer-foto').checked      = reg ? !!reg.requer_foto : false;
            document.getElementById('tipo-foto-obrigatoria').checked  = reg ? !!reg.foto_obrigatoria : false;
            var taWrap = document.getElementById('tipo-ativo-wrap');
            if (taWrap) taWrap.style.display = reg ? '' : 'none';
            document.getElementById('tipo-ativo').checked = reg ? !!reg.ativo : true;
            abrirModal('modal-tipo-carga');
        } else if (tipo === 'destino') {
            document.getElementById('modal-destino-titulo').textContent = reg ? 'Editar Destino' : 'Novo Destino';
            document.getElementById('destino-edit-id').value = reg ? reg.id : '';
            document.getElementById('destino-nome').value    = reg ? (reg.nome || '') : '';
            document.getElementById('destino-km').value      = reg ? (reg.km_distancia != null ? reg.km_distancia : '') : '';
            document.getElementById('destino-ordem').value   = reg ? (reg.ordem || 0) : 0;
            var daWrap = document.getElementById('destino-ativo-wrap');
            if (daWrap) daWrap.style.display = reg ? '' : 'none';
            document.getElementById('destino-ativo').checked = reg ? !!reg.ativo : true;
            var selTipo = document.getElementById('destino-tipo-carga-id');
            if (selTipo) {
                selTipo.innerHTML = '<option value="">Geral (todos os tipos)</option>';
                for (var i = 0; i < Estado.tipos.length; i++) {
                    var opt = document.createElement('option');
                    opt.value = Estado.tipos[i].id;
                    opt.textContent = Estado.tipos[i].nome;
                    if (reg && reg.tipo_carga_id === Estado.tipos[i].id) opt.selected = true;
                    selTipo.appendChild(opt);
                }
            }
            abrirModal('modal-destino');
        } else if (tipo === 'origem') {
            document.getElementById('modal-origem-titulo').textContent = reg ? 'Editar Origem' : 'Nova Origem';
            document.getElementById('origem-edit-id').value = reg ? reg.id : '';
            document.getElementById('origem-nome').value    = reg ? (reg.nome || '') : '';
            document.getElementById('origem-km').value      = reg ? (reg.km_distancia != null ? reg.km_distancia : '') : '';
            document.getElementById('origem-ordem').value   = reg ? (reg.ordem || 0) : 0;
            var oaWrap = document.getElementById('origem-ativo-wrap');
            if (oaWrap) oaWrap.style.display = reg ? '' : 'none';
            document.getElementById('origem-ativo').checked = reg ? !!reg.ativo : true;
            abrirModal('modal-origem');
        } else if (tipo === 'veiculo') {
            document.getElementById('modal-veiculo-titulo').textContent = reg ? 'Editar Veiculo' : 'Novo Veiculo';
            document.getElementById('veiculo-edit-id').value   = reg ? reg.id : '';
            document.getElementById('veiculo-tipo').value      = reg ? (reg.tipo || 'carro') : 'carro';
            document.getElementById('veiculo-placa').value     = reg ? (reg.placa || '') : '';
            document.getElementById('veiculo-descricao').value = reg ? (reg.descricao || '') : '';
            document.getElementById('veiculo-km-max').value    = reg ? (reg.km_max_dia != null ? reg.km_max_dia : '') : '';
            var vaWrap = document.getElementById('veiculo-ativo-wrap');
            if (vaWrap) vaWrap.style.display = reg ? '' : 'none';
            document.getElementById('veiculo-ativo').checked = reg ? !!reg.ativo : true;
            abrirModal('modal-veiculo');
        }
    }

    function salvarMotorista() {
        var id   = document.getElementById('motorista-edit-id').value;
        var nome = (document.getElementById('motorista-nome').value || '').trim();
        if (!nome) { toast('Nome e obrigatorio.', 'warning'); return; }
        var payload = {
            nome:       nome,
            matricula:  document.getElementById('motorista-matricula').value,
            turno:      document.getElementById('motorista-turno').value,
            ativo:      document.getElementById('motorista-ativo').checked
        };
        var url    = CONFIG.api + '/config/motoristas' + (id ? '/' + id : '');
        var method = id ? 'PUT' : 'POST';
        postConfig(url, method, payload, 'modal-motorista', carregarCfgMotoristas);
    }

    function salvarTipo() {
        var id   = document.getElementById('tipo-edit-id').value;
        var nome = (document.getElementById('tipo-nome').value || '').trim();
        if (!nome) { toast('Nome e obrigatorio.', 'warning'); return; }
        var payload = {
            nome: nome, icone: document.getElementById('tipo-icone').value,
            cor: document.getElementById('tipo-cor').value,
            ordem: parseInt(document.getElementById('tipo-ordem').value, 10) || 0,
            requer_lista_itens: document.getElementById('tipo-requer-lista').checked,
            requer_assinatura:  document.getElementById('tipo-requer-assinatura').checked,
            requer_foto:        document.getElementById('tipo-requer-foto').checked,
            foto_obrigatoria:   document.getElementById('tipo-foto-obrigatoria').checked,
            ativo: document.getElementById('tipo-ativo').checked
        };
        var url    = CONFIG.api + '/config/tipos-carga' + (id ? '/' + id : '');
        var method = id ? 'PUT' : 'POST';
        postConfig(url, method, payload, 'modal-tipo-carga', carregarCfgTipos);
    }

    function salvarDestino() {
        var id   = document.getElementById('destino-edit-id').value;
        var nome = (document.getElementById('destino-nome').value || '').trim();
        if (!nome) { toast('Nome e obrigatorio.', 'warning'); return; }
        var tipoCargaId = document.getElementById('destino-tipo-carga-id').value;
        var kmDest = document.getElementById('destino-km').value;
        var payload = {
            nome: nome, tipo_carga_id: tipoCargaId ? parseInt(tipoCargaId, 10) : null,
            km_distancia: kmDest !== '' ? parseFloat(kmDest) : null,
            ordem: parseInt(document.getElementById('destino-ordem').value, 10) || 0,
            ativo: document.getElementById('destino-ativo').checked
        };
        var url    = CONFIG.api + '/config/destinos' + (id ? '/' + id : '');
        var method = id ? 'PUT' : 'POST';
        postConfig(url, method, payload, 'modal-destino', carregarCfgDestinos);
    }

    function salvarOrigem() {
        var id   = document.getElementById('origem-edit-id').value;
        var nome = (document.getElementById('origem-nome').value || '').trim();
        if (!nome) { toast('Nome e obrigatorio.', 'warning'); return; }
        var kmOrig = document.getElementById('origem-km').value;
        var payload = {
            nome: nome,
            km_distancia: kmOrig !== '' ? parseFloat(kmOrig) : null,
            ordem: parseInt(document.getElementById('origem-ordem').value, 10) || 0,
            ativo: document.getElementById('origem-ativo').checked
        };
        var url    = CONFIG.api + '/config/origens' + (id ? '/' + id : '');
        var method = id ? 'PUT' : 'POST';
        postConfig(url, method, payload, 'modal-origem', carregarCfgOrigens);
    }

    function salvarVeiculo() {
        var id   = document.getElementById('veiculo-edit-id').value;
        var tipo = document.getElementById('veiculo-tipo').value;
        var placa = (document.getElementById('veiculo-placa').value || '').trim().toUpperCase() || null;
        var km = document.getElementById('veiculo-km-max').value;
        var payload = {
            tipo: tipo,
            placa: placa,
            descricao: (document.getElementById('veiculo-descricao').value || '').trim() || null,
            km_max_dia: km !== '' ? parseFloat(km) : null,
            ativo: document.getElementById('veiculo-ativo').checked
        };
        var url    = CONFIG.api + '/config/veiculos' + (id ? '/' + id : '');
        var method = id ? 'PUT' : 'POST';
        postConfig(url, method, payload, 'modal-veiculo', carregarCfgVeiculos);
    }

    function postConfig(url, method, payload, modalId, cbSucesso) {
        fetch(url, {
            method: method, credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        })
            .then(function (r) { return r.json(); })
            .then(function (data) {
                if (data.success) {
                    fecharModal(modalId);
                    toast('Salvo com sucesso!', 'success');
                    cbSucesso();
                } else {
                    toast(data.error || 'Erro ao salvar.', 'error');
                }
            })
            .catch(function (e) { console.error(e); toast('Erro de conexao.', 'error'); });
    }

    /* ── INICIALIZAR ──────────────────────────────── */
    function inicializar() {
        /* tabs */
        var tabBtns = document.querySelectorAll('.tab-btn');
        for (var i = 0; i < tabBtns.length; i++) {
            tabBtns[i].addEventListener('click', function (e) {
                ativarTab(e.currentTarget.getAttribute('data-tab'));
            });
        }

        /* header */
        document.getElementById('btn-voltar').addEventListener('click', function () { history.back(); });
        document.getElementById('btn-exportar').addEventListener('click', exportar);

        /* filtros */
        document.getElementById('btn-filtrar').addEventListener('click', carregarChamados);
        document.getElementById('btn-limpar-filtro').addEventListener('click', function () {
            document.getElementById('filtro-status').value = '';
            document.getElementById('filtro-prioridade').value = '';
            document.getElementById('filtro-setor').value = '';
            var hoje = new Date();
            var sete = new Date(hoje); sete.setDate(hoje.getDate() - 7);
            document.getElementById('filtro-data-inicio').value = sete.toISOString().slice(0, 10);
            document.getElementById('filtro-data-fim').value    = hoje.toISOString().slice(0, 10);
        });

        /* cancelar admin */
        document.getElementById('btn-confirmar-cancelar-admin').addEventListener('click', cancelarAdmin);

        /* analytics periodo */
        var periodoBtns = document.querySelectorAll('.periodo-btn');
        for (var j = 0; j < periodoBtns.length; j++) {
            periodoBtns[j].addEventListener('click', function (e) {
                var dias = parseInt(e.currentTarget.getAttribute('data-dias'), 10);
                CONFIG.analyticsDias = dias;
                var btns = document.querySelectorAll('.periodo-btn');
                for (var k = 0; k < btns.length; k++) {
                    btns[k].classList.toggle('ativo', parseInt(btns[k].getAttribute('data-dias'), 10) === dias);
                }
                carregarAnalytics();
            });
        }

        /* config adicionar */
        var btnAdd = document.querySelectorAll('.btn-add-config');
        for (var l = 0; l < btnAdd.length; l++) {
            btnAdd[l].addEventListener('click', function (e) {
                var tipo = e.currentTarget.getAttribute('data-tipo');
                if (tipo === 'destino' && !Estado.tipos.length) {
                    carregarCfgTipos();
                    setTimeout(function () { abrirModalEdicao(tipo, null); }, 300);
                } else {
                    abrirModalEdicao(tipo, null);
                }
            });
        }

        /* fechar modais (data-fecha) */
        document.addEventListener('click', function (e) {
            var fecha = e.target.getAttribute('data-fecha');
            if (fecha) fecharModal(fecha);
        });

        /* salvar configs */
        document.getElementById('btn-salvar-motorista').addEventListener('click', salvarMotorista);
        document.getElementById('btn-salvar-tipo').addEventListener('click', salvarTipo);
        document.getElementById('btn-salvar-destino').addEventListener('click', salvarDestino);
        document.getElementById('btn-salvar-origem').addEventListener('click', salvarOrigem);
        document.getElementById('btn-salvar-veiculo').addEventListener('click', salvarVeiculo);

        /* fechar modal clicando fora */
        var modais = document.querySelectorAll('.modal-overlay');
        for (var m = 0; m < modais.length; m++) {
            modais[m].addEventListener('click', function (e) {
                if (e.target === e.currentTarget) e.currentTarget.style.display = 'none';
            });
        }

        /* carga inicial */
        carregarDashboard();

        /* refresh automatico */
        setInterval(function () {
            if (Estado.tabAtiva === 'dashboard') carregarDashboard();
        }, CONFIG.refreshInterval);
    }

    window.addEventListener('DOMContentLoaded', inicializar);
})();
