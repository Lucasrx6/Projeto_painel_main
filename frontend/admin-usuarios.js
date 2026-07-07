/**
 * ==============================================================================
 * GESTAO DE USUARIOS - JAVASCRIPT
 * Sistema de Gestao de Usuarios - Hospital Anchieta Ceilandia
 * Versao 2.0 - Seguranca Aprimorada
 * ==============================================================================
 */

'use strict';

// ==============================================================================
// CONFIGURACAO
// ==============================================================================

var CONFIG = {
    apiBase: window.location.origin,
    endpoints: {
        verificarSessao: '/api/verificar-sessao',
        logout: '/api/logout',
        estatisticas: '/api/admin/estatisticas',
        usuarios: '/api/admin/usuarios',
        paineis: '/api/admin/paineis',
        cadastro: '/api/cadastro'
    },
    mensagens: {
        erroConexao: 'Erro de conexao com o servidor',
        erroAutenticacao: 'Sessao expirada. Redirecionando para login...',
        acessoNegado: 'Acesso negado. Apenas administradores.',
        senhasNaoCoincidem: 'As senhas nao coincidem',
        senhaFraca: 'A senha deve ter no minimo 8 caracteres com maiuscula, minuscula, numero e caractere especial',
        confirmarDesativar: 'Deseja realmente desativar este usuario?',
        confirmarAtivar: 'Deseja realmente ativar este usuario?'
    },
    debounceDelay: 300
};

// ==============================================================================
// ESTADO DA APLICACAO
// ==============================================================================

var Estado = {
    usuarios: [],
    usuariosFiltrados: [],
    usuariosCarregados: false,
    usuarioAtual: null,
    carregando: false,
    // estado do modal de permissoes
    permFiltro: 'todos',
    permBusca: '',
    paineisCache: [],
    permissoesCache: []
};

// Categorias de paineis — mapeamento para agrupamento visual no modal
var CATEGORIAS_PAINEIS = [
    { id: 'clinico',       titulo: 'Clinico / PS',                icone: 'fa-stethoscope',  cor: '#0d6efd' },
    { id: 'gestao',        titulo: 'Gestao / Ocupacao',           icone: 'fa-chart-bar',    cor: '#198754' },
    { id: 'ia',            titulo: 'IA / Analytics',              icone: 'fa-brain',         cor: '#6f42c1' },
    { id: 'radiologia',    titulo: 'Radiologia',                  icone: 'fa-x-ray',         cor: '#0dcaf0' },
    { id: 'farmacia',      titulo: 'Farmacia / Nutricao',         icone: 'fa-pills',         cor: '#fd7e14' },
    { id: 'qualidade',     titulo: 'Sentir e Agir / Qualidade',   icone: 'fa-heart',         cor: '#e91e63' },
    { id: 'administrativo',titulo: 'Administrativo',              icone: 'fa-file-invoice',  cor: '#6c757d' },
    { id: 'auxiliar',      titulo: 'Sistemas Auxiliares',         icone: 'fa-cogs',          cor: '#20c997' }
];

// ==============================================================================
// INICIALIZACAO
// ==============================================================================

document.addEventListener('DOMContentLoaded', function() {
    verificarAutenticacao();
    configurarEventos();
    registrarServiceWorker();
});

function registrarServiceWorker() {
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('/sw.js')
            .then(function(registration) {
                console.log('[SW] Service Worker registrado:', registration.scope);
            })
            .catch(function(error) {
                console.warn('[SW] Erro ao registrar Service Worker:', error);
            });
    }
}

// ==============================================================================
// AUTENTICACAO
// ==============================================================================

function verificarAutenticacao() {
    fetch(CONFIG.endpoints.verificarSessao, {
        method: 'GET',
        credentials: 'include'
    })
    .then(function(response) {
        return response.json();
    })
    .then(function(data) {
        if (!data.autenticado) {
            console.warn('[AUTH] Usuario nao autenticado');
            redirecionarLogin();
            return;
        }

        if (!data.is_admin) {
            console.warn('[AUTH] Usuario nao e administrador');
            alert(CONFIG.mensagens.acessoNegado);
            window.location.href = '/frontend/dashboard.html';
            return;
        }

        Estado.usuarioAtual = data;
        document.getElementById('admin-nome').textContent = 'Admin: ' + data.usuario;

        carregarDadosIniciais();
    })
    .catch(function(erro) {
        console.error('[AUTH] Erro ao verificar autenticacao:', erro);
        redirecionarLogin();
    });
}

function redirecionarLogin() {
    window.location.href = '/login.html';
}

function realizarLogout() {
    // Sinaliza que o usuário saiu manualmente — impede o auto-login na tela de login
    sessionStorage.setItem('saiu_manualmente', '1');

    fetch(CONFIG.endpoints.logout, {
        method: 'POST',
        credentials: 'include'
    })
    .then(function() {
        redirecionarLogin();
    })
    .catch(function(erro) {
        console.error('[AUTH] Erro no logout:', erro);
        redirecionarLogin();
    });
}

// ==============================================================================
// CONFIGURACAO DE EVENTOS
// ==============================================================================

function configurarEventos() {
    // Header
    var btnVoltar = document.getElementById('btn-voltar-dashboard-v2');
    if (btnVoltar) {
        btnVoltar.addEventListener('click', function() {
            window.location.href = '/frontend/dashboard.html';
        });
    }

    var btnLogout = document.getElementById('btn-logout');
    if (btnLogout) {
        btnLogout.addEventListener('click', realizarLogout);
    }

    // Controles
    var btnNovoUsuario = document.getElementById('btn-novo-usuario');
    if (btnNovoUsuario) {
        btnNovoUsuario.addEventListener('click', abrirModalNovoUsuario);
    }

    var btnRefresh = document.getElementById('btn-refresh');
    if (btnRefresh) {
        btnRefresh.addEventListener('click', function() {
            carregarEstatisticas();
            Estado.usuariosCarregados = false;
            executarBusca();
        });
    }

    var btnVerTodos = document.getElementById('btn-ver-todos');
    if (btnVerTodos) {
        btnVerTodos.addEventListener('click', function() {
            var searchInput = document.getElementById('search-input');
            if (searchInput) searchInput.value = '';
            executarBusca();
        });
    }

    var btnBuscar = document.getElementById('btn-buscar');
    if (btnBuscar) {
        btnBuscar.addEventListener('click', executarBusca);
    }

    var searchInput = document.getElementById('search-input');
    if (searchInput) {
        // Filtro ao vivo somente se usuarios ja foram carregados; Enter sempre executa busca
        searchInput.addEventListener('input', debounce(function() {
            if (Estado.usuariosCarregados) filtrarUsuarios();
        }, CONFIG.debounceDelay));
        searchInput.addEventListener('keydown', function(e) {
            if (e.key === 'Enter') executarBusca();
        });
    }

    // Formularios
    var formNovo = document.getElementById('form-novo-usuario');
    if (formNovo) {
        formNovo.addEventListener('submit', criarUsuario);
    }

    var formEditar = document.getElementById('form-editar-usuario');
    if (formEditar) {
        formEditar.addEventListener('submit', salvarEdicaoUsuario);
    }

    var formReset = document.getElementById('form-reset-senha');
    if (formReset) {
        formReset.addEventListener('submit', salvarResetSenha);
    }

    // Fechar modais com ESC
    document.addEventListener('keydown', function(e) {
        if (e.key === 'Escape') {
            fecharTodosModais();
        }
    });

    // Fechar modais clicando fora
    var modais = document.querySelectorAll('.modal');
    modais.forEach(function(modal) {
        modal.addEventListener('click', function(e) {
            if (e.target === modal) {
                fecharTodosModais();
            }
        });
    });
}

// ==============================================================================
// CARREGAMENTO DE DADOS
// ==============================================================================

function carregarDadosIniciais() {
    carregarEstatisticas();
    mostrarPromptBusca();
}

function mostrarPromptBusca() {
    var tbody = document.getElementById('usuarios-tbody');
    if (!tbody) return;
    tbody.innerHTML =
        '<tr>' +
            '<td colspan="9" class="search-prompt-state">' +
                '<i class="fas fa-users" aria-hidden="true"></i>' +
                '<p>Pesquise por nome, email ou cargo</p>' +
                '<small>Deixe em branco e clique em <strong>Ver Todos</strong> para listar todos os usuarios</small>' +
            '</td>' +
        '</tr>';
}

function executarBusca() {
    if (Estado.usuariosCarregados) {
        filtrarUsuarios();
    } else {
        carregarEFiltrar();
    }
}

function carregarEFiltrar() {
    if (Estado.carregando) return;
    Estado.carregando = true;
    mostrarLoading();

    fetch(CONFIG.endpoints.usuarios + '?incluir_inativos=true', {
        method: 'GET',
        credentials: 'include'
    })
    .then(function(response) { return response.json(); })
    .then(function(data) {
        Estado.carregando = false;
        if (data.success) {
            Estado.usuarios = data.usuarios || [];
            Estado.usuariosCarregados = true;
            filtrarUsuarios();
        } else {
            mostrarErro('Erro ao carregar usuarios: ' + (data.error || 'Erro desconhecido'));
        }
    })
    .catch(function(erro) {
        Estado.carregando = false;
        console.error('[USERS] Erro ao carregar usuarios:', erro);
        mostrarErro(CONFIG.mensagens.erroConexao);
    });
}

function carregarEstatisticas() {
    fetch(CONFIG.endpoints.estatisticas, {
        method: 'GET',
        credentials: 'include'
    })
    .then(function(response) {
        return response.json();
    })
    .then(function(data) {
        if (data.success) {
            var stats = data.estatisticas;
            document.getElementById('stat-total').textContent = stats.total || 0;
            document.getElementById('stat-ativos').textContent = stats.ativos || 0;
            document.getElementById('stat-inativos').textContent = stats.inativos || 0;
            document.getElementById('stat-admins').textContent = stats.admins || 0;
        }
    })
    .catch(function(erro) {
        console.error('[STATS] Erro ao carregar estatisticas:', erro);
    });
}

function filtrarUsuarios() {
    if (!Estado.usuariosCarregados) {
        mostrarPromptBusca();
        return;
    }

    var busca = document.getElementById('search-input').value.toLowerCase().trim();

    if (!busca) {
        Estado.usuariosFiltrados = Estado.usuarios.slice();
    } else {
        Estado.usuariosFiltrados = Estado.usuarios.filter(function(user) {
            return (user.usuario && user.usuario.toLowerCase().indexOf(busca) !== -1) ||
                   (user.nome_completo && user.nome_completo.toLowerCase().indexOf(busca) !== -1) ||
                   (user.email && user.email.toLowerCase().indexOf(busca) !== -1) ||
                   (user.cargo && user.cargo.toLowerCase().indexOf(busca) !== -1);
        });
    }

    renderizarTabela();
}

// ==============================================================================
// RENDERIZACAO DA TABELA
// ==============================================================================

function renderizarTabela() {
    var tbody = document.getElementById('usuarios-tbody');
    if (!tbody) return;

    if (Estado.usuariosFiltrados.length === 0) {
        tbody.innerHTML =
            '<tr>' +
                '<td colspan="9" class="empty-state">' +
                    '<i class="fas fa-inbox" aria-hidden="true"></i>' +
                    '<p>Nenhum usuario encontrado</p>' +
                '</td>' +
            '</tr>';
        return;
    }

    var html = Estado.usuariosFiltrados.map(function(user) {
        var statusClass = user.ativo ? 'status-ativo' : 'status-inativo';
        var statusTexto = user.ativo ? 'Ativo' : 'Inativo';
        var adminBadge = user.is_admin ?
            '<i class="fas fa-crown admin-badge" title="Administrador" aria-label="Administrador"></i>' :
            '-';
        var ultimoAcesso = formatarData(user.ultimo_acesso);

        var botoesAcao =
            '<div class="acoes-container">' +
                '<button type="button" class="btn-action btn-editar" onclick="abrirModalEditarUsuario(' + user.id + ')" title="Editar" aria-label="Editar usuario">' +
                    '<i class="fas fa-edit" aria-hidden="true"></i>' +
                '</button>' +
                '<button type="button" class="btn-action btn-senha" onclick="abrirModalResetSenha(' + user.id + ', \'' + escapeHtml(user.usuario) + '\')" title="Resetar Senha" aria-label="Resetar senha">' +
                    '<i class="fas fa-key" aria-hidden="true"></i>' +
                '</button>' +
                '<button type="button" class="btn-action btn-permissoes" onclick="abrirModalPermissoes(' + user.id + ', \'' + escapeHtml(user.usuario) + '\')" title="Permissoes" aria-label="Gerenciar permissoes">' +
                    '<i class="fas fa-shield-alt" aria-hidden="true"></i>' +
                '</button>' +
                '<button type="button" class="btn-action btn-historico" onclick="abrirModalHistorico(' + user.id + ', \'' + escapeHtml(user.usuario) + '\')" title="Historico" aria-label="Ver historico">' +
                    '<i class="fas fa-history" aria-hidden="true"></i>' +
                '</button>';

        if (user.ativo) {
            botoesAcao +=
                '<button type="button" class="btn-action btn-danger" onclick="alterarStatusUsuario(' + user.id + ', false)" title="Desativar" aria-label="Desativar usuario">' +
                    '<i class="fas fa-user-times" aria-hidden="true"></i>' +
                '</button>';
        } else {
            botoesAcao +=
                '<button type="button" class="btn-action btn-success" onclick="alterarStatusUsuario(' + user.id + ', true)" title="Ativar" aria-label="Ativar usuario">' +
                    '<i class="fas fa-user-check" aria-hidden="true"></i>' +
                '</button>';
        }

        botoesAcao += '</div>';

        return '<tr>' +
            '<td data-label="ID">' + user.id + '</td>' +
            '<td data-label="Usuario"><strong>' + escapeHtml(user.usuario) + '</strong></td>' +
            '<td data-label="Nome">' + escapeHtml(user.nome_completo || '-') + '</td>' +
            '<td data-label="Email">' + escapeHtml(user.email || '-') + '</td>' +
            '<td data-label="Cargo">' + escapeHtml(user.cargo || '-') + '</td>' +
            '<td data-label="Status"><span class="status-badge ' + statusClass + '">' + statusTexto + '</span></td>' +
            '<td data-label="Admin" style="text-align: center;">' + adminBadge + '</td>' +
            '<td data-label="Ultimo Acesso">' + ultimoAcesso + '</td>' +
            '<td data-label="Acoes">' + botoesAcao + '</td>' +
        '</tr>';
    }).join('');

    tbody.innerHTML = html;
}

function mostrarLoading() {
    var tbody = document.getElementById('usuarios-tbody');
    if (tbody) {
        tbody.innerHTML =
            '<tr>' +
                '<td colspan="9" class="loading">' +
                    '<div class="loading-spinner" aria-hidden="true"></div>' +
                    '<div>Carregando usuarios...</div>' +
                '</td>' +
            '</tr>';
    }
}

function mostrarErro(mensagem) {
    var tbody = document.getElementById('usuarios-tbody');
    if (tbody) {
        tbody.innerHTML =
            '<tr>' +
                '<td colspan="9" class="error-state">' +
                    '<i class="fas fa-exclamation-triangle" aria-hidden="true"></i>' +
                    '<p>' + escapeHtml(mensagem) + '</p>' +
                '</td>' +
            '</tr>';
    }
}

// ==============================================================================
// MODAL: CRIAR USUARIO
// ==============================================================================

function abrirModalNovoUsuario() {
    var form = document.getElementById('form-novo-usuario');
    if (form) form.reset();

    ocultarMensagem('mensagem-novo-usuario');
    abrirModal('modal-novo-usuario');

    var inputUsuario = document.getElementById('novo-usuario');
    if (inputUsuario) inputUsuario.focus();
}

function fecharModalNovoUsuario() {
    fecharModal('modal-novo-usuario');
}

function criarUsuario(e) {
    e.preventDefault();

    var usuario = document.getElementById('novo-usuario').value.trim();
    var email = document.getElementById('novo-email').value.trim();
    var senha = document.getElementById('novo-senha').value;
    var nomeCompleto = document.getElementById('novo-nome-completo').value.trim();
    var cargo = document.getElementById('novo-cargo').value.trim();
    var isAdmin = document.getElementById('novo-is-admin').checked;

    // Validacoes
    if (!validarUsuario(usuario)) {
        mostrarMensagemModal('mensagem-novo-usuario', 'Nome de usuario invalido. Use apenas letras, numeros, underscore e ponto.', 'danger');
        return;
    }

    if (!validarEmail(email)) {
        mostrarMensagemModal('mensagem-novo-usuario', 'Email invalido.', 'danger');
        return;
    }

    if (!validarSenhaForte(senha)) {
        mostrarMensagemModal('mensagem-novo-usuario', CONFIG.mensagens.senhaFraca, 'danger');
        return;
    }

    var btnCriar = document.getElementById('btn-criar-usuario');
    if (btnCriar) btnCriar.disabled = true;

    var dados = {
        usuario: usuario,
        email: email,
        senha: senha,
        is_admin: isAdmin,
        force_reset_senha: document.getElementById('novo-force-reset') ? document.getElementById('novo-force-reset').checked : false
    };

    fetch(CONFIG.endpoints.cadastro, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(dados)
    })
    .then(function(response) {
        return response.json();
    })
    .then(function(data) {
        if (data.success) {
            // Se tiver nome ou cargo, atualiza depois
            if (nomeCompleto || cargo) {
                atualizarDadosAdicionais(data.usuario_id || null, usuario, nomeCompleto, cargo);
            }

            mostrarMensagemModal('mensagem-novo-usuario', 'Usuario criado com sucesso!', 'success');

            setTimeout(function() {
                fecharModalNovoUsuario();
                Estado.usuariosCarregados = false;
                executarBusca();
                carregarEstatisticas();
                if (btnCriar) btnCriar.disabled = false;
            }, 1500);
        } else {
            mostrarMensagemModal('mensagem-novo-usuario', data.error || 'Erro ao criar usuario', 'danger');
            if (btnCriar) btnCriar.disabled = false;
        }
    })
    .catch(function(erro) {
        console.error('[CREATE] Erro ao criar usuario:', erro);
        mostrarMensagemModal('mensagem-novo-usuario', CONFIG.mensagens.erroConexao, 'danger');
        if (btnCriar) btnCriar.disabled = false;
    });
}

function atualizarDadosAdicionais(usuarioId, usuarioNome, nomeCompleto, cargo) {
    if (!usuarioId) {
        // Busca o usuario recem-criado na lista ja carregada (ou via API)
        var encontrado = Estado.usuarios.filter(function(u) { return u.usuario === usuarioNome; });
        if (encontrado.length > 0) {
            enviarAtualizacao(encontrado[0].id, nomeCompleto, cargo);
        } else {
            // Fallback: busca direta na API
            fetch(CONFIG.endpoints.usuarios + '?incluir_inativos=true', { credentials: 'include' })
            .then(function(r) { return r.json(); })
            .then(function(data) {
                if (data.success) {
                    var u = data.usuarios.filter(function(x) { return x.usuario === usuarioNome; });
                    if (u.length > 0) enviarAtualizacao(u[0].id, nomeCompleto, cargo);
                }
            })
            .catch(function() {});
        }
    } else {
        enviarAtualizacao(usuarioId, nomeCompleto, cargo);
    }
}

function enviarAtualizacao(usuarioId, nomeCompleto, cargo) {
    var dados = {};
    if (nomeCompleto) dados.nome_completo = nomeCompleto;
    if (cargo) dados.cargo = cargo;

    fetch(CONFIG.endpoints.usuarios + '/' + usuarioId, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(dados)
    }).catch(function() {});
}

// ==============================================================================
// MODAL: EDITAR USUARIO
// ==============================================================================

function abrirModalEditarUsuario(usuarioId) {
    ocultarMensagem('mensagem-editar-usuario');

    fetch(CONFIG.endpoints.usuarios + '/' + usuarioId, {
        method: 'GET',
        credentials: 'include'
    })
    .then(function(response) {
        return response.json();
    })
    .then(function(data) {
        if (data.success) {
            var user = data.usuario;

            document.getElementById('editar-usuario-id').value = user.id;
            document.getElementById('editar-usuario-login').value = user.usuario || '';
            document.getElementById('editar-email').value = user.email || '';
            document.getElementById('editar-nome-completo').value = user.nome_completo || '';
            document.getElementById('editar-cargo').value = user.cargo || '';
            document.getElementById('editar-observacoes').value = user.observacoes || '';
            document.getElementById('editar-is-admin').checked = user.is_admin || false;

            abrirModal('modal-editar-usuario');
        } else {
            alert('Erro ao carregar dados do usuario: ' + (data.error || 'Erro desconhecido'));
        }
    })
    .catch(function(erro) {
        console.error('[EDIT] Erro ao carregar usuario:', erro);
        alert(CONFIG.mensagens.erroConexao);
    });
}

function fecharModalEditarUsuario() {
    fecharModal('modal-editar-usuario');
}

function salvarEdicaoUsuario(e) {
    e.preventDefault();

    var usuarioId = document.getElementById('editar-usuario-id').value;
    var email = document.getElementById('editar-email').value.trim();

    if (!validarEmail(email)) {
        mostrarMensagemModal('mensagem-editar-usuario', 'Email invalido.', 'danger');
        return;
    }

    var btnSalvar = document.getElementById('btn-salvar-edicao');
    if (btnSalvar) btnSalvar.disabled = true;

    var dados = {
        email: email,
        nome_completo: document.getElementById('editar-nome-completo').value.trim(),
        cargo: document.getElementById('editar-cargo').value.trim(),
        observacoes: document.getElementById('editar-observacoes').value.trim(),
        is_admin: document.getElementById('editar-is-admin').checked
    };

    fetch(CONFIG.endpoints.usuarios + '/' + usuarioId, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(dados)
    })
    .then(function(response) {
        return response.json();
    })
    .then(function(data) {
        if (data.success) {
            mostrarMensagemModal('mensagem-editar-usuario', 'Usuario atualizado com sucesso!', 'success');

            setTimeout(function() {
                fecharModalEditarUsuario();
                Estado.usuariosCarregados = false;
                executarBusca();
                carregarEstatisticas();
                if (btnSalvar) btnSalvar.disabled = false;
            }, 1500);
        } else {
            mostrarMensagemModal('mensagem-editar-usuario', data.error || 'Erro ao atualizar', 'danger');
            if (btnSalvar) btnSalvar.disabled = false;
        }
    })
    .catch(function(erro) {
        console.error('[EDIT] Erro ao editar usuario:', erro);
        mostrarMensagemModal('mensagem-editar-usuario', CONFIG.mensagens.erroConexao, 'danger');
        if (btnSalvar) btnSalvar.disabled = false;
    });
}

// ==============================================================================
// MODAL: RESET SENHA
// ==============================================================================

function abrirModalResetSenha(usuarioId, usuarioNome) {
    document.getElementById('reset-usuario-id').value = usuarioId;
    document.getElementById('reset-usuario-nome').textContent = usuarioNome;

    var form = document.getElementById('form-reset-senha');
    if (form) form.reset();

    ocultarMensagem('mensagem-reset-senha');
    abrirModal('modal-reset-senha');

    var inputSenha = document.getElementById('reset-nova-senha');
    if (inputSenha) inputSenha.focus();
}

function fecharModalResetSenha() {
    fecharModal('modal-reset-senha');
}

function salvarResetSenha(e) {
    e.preventDefault();

    var usuarioId = document.getElementById('reset-usuario-id').value;
    var novaSenha = document.getElementById('reset-nova-senha').value;
    var confirmaSenha = document.getElementById('reset-confirma-senha').value;

    if (novaSenha !== confirmaSenha) {
        mostrarMensagemModal('mensagem-reset-senha', CONFIG.mensagens.senhasNaoCoincidem, 'danger');
        return;
    }

    if (!validarSenhaForte(novaSenha)) {
        mostrarMensagemModal('mensagem-reset-senha', CONFIG.mensagens.senhaFraca, 'danger');
        return;
    }

    var btnReset = document.getElementById('btn-resetar-senha');
    if (btnReset) btnReset.disabled = true;

    fetch(CONFIG.endpoints.usuarios + '/' + usuarioId + '/senha', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
            nova_senha: novaSenha,
            force_reset_senha: document.getElementById('reset-force-reset') ? document.getElementById('reset-force-reset').checked : false
        })
    })
    .then(function(response) {
        return response.json();
    })
    .then(function(data) {
        if (data.success) {
            mostrarMensagemModal('mensagem-reset-senha', 'Senha resetada com sucesso!', 'success');

            setTimeout(function() {
                fecharModalResetSenha();
                if (btnReset) btnReset.disabled = false;
            }, 1500);
        } else {
            mostrarMensagemModal('mensagem-reset-senha', data.error || 'Erro ao resetar senha', 'danger');
            if (btnReset) btnReset.disabled = false;
        }
    })
    .catch(function(erro) {
        console.error('[RESET] Erro ao resetar senha:', erro);
        mostrarMensagemModal('mensagem-reset-senha', CONFIG.mensagens.erroConexao, 'danger');
        if (btnReset) btnReset.disabled = false;
    });
}

// ==============================================================================
// ATIVAR/DESATIVAR USUARIO
// ==============================================================================

function alterarStatusUsuario(usuarioId, ativo) {
    var mensagem = ativo ? CONFIG.mensagens.confirmarAtivar : CONFIG.mensagens.confirmarDesativar;

    if (!confirm(mensagem)) {
        return;
    }

    fetch(CONFIG.endpoints.usuarios + '/' + usuarioId + '/status', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ ativo: ativo })
    })
    .then(function(response) {
        return response.json();
    })
    .then(function(data) {
        if (data.success) {
            alert(data.message || 'Status alterado com sucesso');
            Estado.usuariosCarregados = false;
            executarBusca();
            carregarEstatisticas();
        } else {
            alert('Erro: ' + (data.error || 'Erro desconhecido'));
        }
    })
    .catch(function(erro) {
        console.error('[STATUS] Erro ao alterar status:', erro);
        alert(CONFIG.mensagens.erroConexao);
    });
}

// ==============================================================================
// MODAL: PERMISSOES
// ==============================================================================

function abrirModalPermissoes(usuarioId, usuarioNome) {
    document.getElementById('permissoes-usuario-id').value = usuarioId;
    document.getElementById('permissoes-usuario-nome').textContent = usuarioNome;
    ocultarMensagem('mensagem-permissoes');

    // Resetar estado do modal
    Estado.permFiltro = 'todos';
    Estado.permBusca = '';
    Estado.paineisCache = [];
    Estado.permissoesCache = [];

    var inputBusca = document.getElementById('perm-search');
    if (inputBusca) inputBusca.value = '';

    var filtros = document.querySelectorAll('.perm-filtro');
    filtros.forEach(function(f) { f.classList.remove('ativo'); });
    var filtroTodos = document.querySelector('.perm-filtro[data-filtro="todos"]');
    if (filtroTodos) filtroTodos.classList.add('ativo');

    var listaPaineis = document.getElementById('lista-paineis');
    listaPaineis.innerHTML =
        '<div class="loading">' +
            '<div class="loading-spinner" aria-hidden="true"></div>' +
            '<p>Carregando paineis...</p>' +
        '</div>';

    abrirModal('modal-permissoes');

    Promise.all([
        fetch(CONFIG.endpoints.paineis, { credentials: 'include' }).then(function(r) { return r.json(); }),
        fetch(CONFIG.endpoints.usuarios + '/' + usuarioId + '/permissoes', { credentials: 'include' }).then(function(r) { return r.json(); })
    ])
    .then(function(results) {
        var paineisData = results[0];
        var permissoesData = results[1];

        if (paineisData.success && permissoesData.success) {
            Estado.paineisCache = paineisData.paineis || [];
            Estado.permissoesCache = (permissoesData.permissoes || []).map(function(p) { return p.painel; });
            renderizarPaineisModal(usuarioId);
        } else {
            listaPaineis.innerHTML = '<div class="alert alert-danger">Erro ao carregar paineis</div>';
        }
    })
    .catch(function(erro) {
        console.error('[PERM] Erro ao carregar permissoes:', erro);
        listaPaineis.innerHTML = '<div class="alert alert-danger">' + CONFIG.mensagens.erroConexao + '</div>';
    });
}

function renderizarPaineisModal(usuarioId) {
    var listaPaineis = document.getElementById('lista-paineis');
    if (!listaPaineis) return;

    var busca = Estado.permBusca.toLowerCase();
    var filtro = Estado.permFiltro;

    // Filtrar paineis conforme busca + aba ativa
    var paineisFiltrados = Estado.paineisCache.filter(function(p) {
        var matchBusca = !busca ||
            p.titulo.toLowerCase().indexOf(busca) !== -1 ||
            (p.descricao && p.descricao.toLowerCase().indexOf(busca) !== -1) ||
            p.nome.toLowerCase().indexOf(busca) !== -1;

        var temPermissao = Estado.permissoesCache.indexOf(p.nome) !== -1;
        var matchFiltro = filtro === 'todos' ||
            (filtro === 'com-acesso' && temPermissao) ||
            (filtro === 'sem-acesso' && !temPermissao);

        return matchBusca && matchFiltro;
    });

    if (paineisFiltrados.length === 0) {
        listaPaineis.innerHTML =
            '<div class="perm-empty">' +
                '<i class="fas fa-search" aria-hidden="true"></i>' +
                '<p>Nenhum painel encontrado</p>' +
            '</div>';
        atualizarResumoPerm();
        return;
    }

    // Agrupar por categoria
    var grupos = {};
    paineisFiltrados.forEach(function(p) {
        var cat = p.categoria || 'auxiliar';
        if (!grupos[cat]) grupos[cat] = [];
        grupos[cat].push(p);
    });

    var html = '';
    CATEGORIAS_PAINEIS.forEach(function(cat) {
        if (!grupos[cat.id] || grupos[cat.id].length === 0) return;
        var paineisDoCat = grupos[cat.id];
        var comAcesso = paineisDoCat.filter(function(p) {
            return Estado.permissoesCache.indexOf(p.nome) !== -1;
        }).length;

        html +=
            '<div class="perm-grupo" data-categoria="' + cat.id + '">' +
                '<div class="perm-grupo-header">' +
                    '<div class="perm-grupo-titulo">' +
                        '<span class="perm-cat-icon" style="background:' + cat.cor + '"><i class="fas ' + cat.icone + '" aria-hidden="true"></i></span>' +
                        '<span class="perm-cat-nome">' + cat.titulo + '</span>' +
                        '<span class="perm-cat-badge">' + comAcesso + ' / ' + paineisDoCat.length + '</span>' +
                    '</div>' +
                    '<div class="perm-grupo-acoes">' +
                        '<button type="button" class="btn-perm-grupo" onclick="marcarTodosGrupo(\'' + cat.id + '\', true, ' + usuarioId + ')">Marcar todos</button>' +
                        '<button type="button" class="btn-perm-grupo btn-perm-grupo-clear" onclick="marcarTodosGrupo(\'' + cat.id + '\', false, ' + usuarioId + ')">Limpar</button>' +
                    '</div>' +
                '</div>' +
                '<div class="perm-grupo-body">' +
                    paineisDoCat.map(function(painel) {
                        var temPermissao = Estado.permissoesCache.indexOf(painel.nome) !== -1;
                        return '<div class="painel-item' + (temPermissao ? ' ativo' : '') + '" data-painel="' + escapeHtml(painel.nome) + '">' +
                            '<div class="painel-info">' +
                                '<h4>' + escapeHtml(painel.titulo) + '</h4>' +
                                '<p>' + escapeHtml(painel.descricao || '') + '</p>' +
                            '</div>' +
                            '<div class="painel-toggle">' +
                                '<label class="switch">' +
                                    '<input type="checkbox" ' + (temPermissao ? 'checked' : '') +
                                    ' onchange="togglePermissao(' + usuarioId + ', \'' + escapeHtml(painel.nome) + '\', this.checked, this)">' +
                                    '<span class="slider"></span>' +
                                '</label>' +
                            '</div>' +
                        '</div>';
                    }).join('') +
                '</div>' +
            '</div>';
    });

    listaPaineis.innerHTML = html;
    atualizarResumoPerm();
}

function filtrarPaineisModal() {
    var input = document.getElementById('perm-search');
    Estado.permBusca = input ? input.value.trim() : '';
    var usuarioId = document.getElementById('permissoes-usuario-id').value;
    renderizarPaineisModal(usuarioId);
}

function mudarFiltroPermissao(btn) {
    var filtros = document.querySelectorAll('.perm-filtro');
    filtros.forEach(function(f) { f.classList.remove('ativo'); });
    btn.classList.add('ativo');
    Estado.permFiltro = btn.getAttribute('data-filtro');
    var usuarioId = document.getElementById('permissoes-usuario-id').value;
    renderizarPaineisModal(usuarioId);
}

function marcarTodosGrupo(categoriaId, marcar, usuarioId) {
    var paineisDoCat = Estado.paineisCache.filter(function(p) { return p.categoria === categoriaId; });
    var promessas = [];

    paineisDoCat.forEach(function(painel) {
        var temPermissao = Estado.permissoesCache.indexOf(painel.nome) !== -1;
        if (marcar === temPermissao) return; // ja esta no estado desejado

        var url, options;
        if (marcar) {
            url = CONFIG.endpoints.usuarios + '/' + usuarioId + '/permissoes';
            options = { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ painel_nome: painel.nome }) };
        } else {
            url = CONFIG.endpoints.usuarios + '/' + usuarioId + '/permissoes/' + encodeURIComponent(painel.nome);
            options = { method: 'DELETE', credentials: 'include' };
        }

        promessas.push(
            fetch(url, options).then(function(r) { return r.json(); }).then(function(data) {
                if (data.success) {
                    if (marcar) {
                        if (Estado.permissoesCache.indexOf(painel.nome) === -1) Estado.permissoesCache.push(painel.nome);
                    } else {
                        var idx = Estado.permissoesCache.indexOf(painel.nome);
                        if (idx !== -1) Estado.permissoesCache.splice(idx, 1);
                    }
                }
            })
        );
    });

    if (promessas.length === 0) return;

    Promise.all(promessas).then(function() {
        renderizarPaineisModal(usuarioId);
        mostrarMensagemModal('mensagem-permissoes', (marcar ? 'Permissoes adicionadas' : 'Permissoes removidas') + ' com sucesso', 'success');
    }).catch(function() {
        mostrarMensagemModal('mensagem-permissoes', 'Erro ao alterar algumas permissoes', 'danger');
        renderizarPaineisModal(usuarioId);
    });
}

function atualizarResumoPerm() {
    var resumo = document.getElementById('perm-resumo');
    if (!resumo) return;
    var total = Estado.paineisCache.length;
    var ativos = Estado.permissoesCache.length;
    resumo.textContent = ativos + ' de ' + total + ' paineis com acesso';
}

function fecharModalPermissoes() {
    fecharModal('modal-permissoes');
}

function togglePermissao(usuarioId, painelNome, adicionar, checkbox) {
    var url, method;

    if (adicionar) {
        url = CONFIG.endpoints.usuarios + '/' + usuarioId + '/permissoes';
        method = 'POST';
    } else {
        url = CONFIG.endpoints.usuarios + '/' + usuarioId + '/permissoes/' + encodeURIComponent(painelNome);
        method = 'DELETE';
    }

    var options = { method: method, credentials: 'include' };

    if (adicionar) {
        options.headers = { 'Content-Type': 'application/json' };
        options.body = JSON.stringify({ painel_nome: painelNome });
    }

    fetch(url, options)
    .then(function(response) { return response.json(); })
    .then(function(data) {
        if (data.success) {
            // Sincronizar cache local de permissoes
            if (adicionar) {
                if (Estado.permissoesCache.indexOf(painelNome) === -1) Estado.permissoesCache.push(painelNome);
            } else {
                var idx = Estado.permissoesCache.indexOf(painelNome);
                if (idx !== -1) Estado.permissoesCache.splice(idx, 1);
            }

            mostrarMensagemModal('mensagem-permissoes', data.message || 'Permissao atualizada', 'success');

            var painelItem = checkbox.closest('.painel-item');
            if (painelItem) {
                if (adicionar) painelItem.classList.add('ativo');
                else painelItem.classList.remove('ativo');
            }

            // Atualizar badge do grupo e resumo
            var grupo = checkbox.closest('.perm-grupo');
            if (grupo) {
                var catId = grupo.getAttribute('data-categoria');
                var paineisDoCat = Estado.paineisCache.filter(function(p) { return p.categoria === catId; });
                var comAcesso = paineisDoCat.filter(function(p) { return Estado.permissoesCache.indexOf(p.nome) !== -1; }).length;
                var badge = grupo.querySelector('.perm-cat-badge');
                if (badge) badge.textContent = comAcesso + ' / ' + paineisDoCat.length;
            }
            atualizarResumoPerm();
        } else {
            mostrarMensagemModal('mensagem-permissoes', data.error || 'Erro ao alterar permissao', 'danger');
            checkbox.checked = !adicionar;
        }
    })
    .catch(function(erro) {
        console.error('[PERM] Erro ao alterar permissao:', erro);
        mostrarMensagemModal('mensagem-permissoes', CONFIG.mensagens.erroConexao, 'danger');
        checkbox.checked = !adicionar;
    });
}

// ==============================================================================
// MODAL: HISTORICO
// ==============================================================================

function abrirModalHistorico(usuarioId, usuarioNome) {
    document.getElementById('historico-usuario-id').value = usuarioId;
    document.getElementById('historico-usuario-nome').textContent = usuarioNome;

    var listaHistorico = document.getElementById('lista-historico');
    listaHistorico.innerHTML =
        '<div class="loading">' +
            '<div class="loading-spinner" aria-hidden="true"></div>' +
            '<p>Carregando historico...</p>' +
        '</div>';

    abrirModal('modal-historico');

    fetch(CONFIG.endpoints.usuarios + '/' + usuarioId + '/historico?limite=50', {
        method: 'GET',
        credentials: 'include'
    })
    .then(function(response) {
        return response.json();
    })
    .then(function(data) {
        if (data.success) {
            var historico = data.historico || [];

            if (historico.length === 0) {
                listaHistorico.innerHTML =
                    '<div class="empty-state">' +
                        '<i class="fas fa-inbox" aria-hidden="true"></i>' +
                        '<p>Nenhum historico encontrado</p>' +
                    '</div>';
                return;
            }

            listaHistorico.innerHTML = historico.map(function(item) {
                return '<div class="historico-item">' +
                    '<div class="acao">' + escapeHtml(formatarAcao(item.acao)) + '</div>' +
                    '<div class="detalhes">' + escapeHtml(item.detalhes || '') + '</div>' +
                    '<div class="meta">' +
                        '<span><i class="fas fa-calendar" aria-hidden="true"></i> ' + formatarData(item.data_hora) + '</span>' +
                        '<span><i class="fas fa-user" aria-hidden="true"></i> ' + escapeHtml(item.realizado_por_usuario || 'Sistema') + '</span>' +
                    '</div>' +
                '</div>';
            }).join('');
        } else {
            listaHistorico.innerHTML =
                '<div class="alert alert-danger">Erro ao carregar historico: ' + escapeHtml(data.error || 'Erro desconhecido') + '</div>';
        }
    })
    .catch(function(erro) {
        console.error('[HIST] Erro ao carregar historico:', erro);
        listaHistorico.innerHTML = '<div class="alert alert-danger">' + CONFIG.mensagens.erroConexao + '</div>';
    });
}

function fecharModalHistorico() {
    fecharModal('modal-historico');
}

// ==============================================================================
// UTILITARIOS DE MODAL
// ==============================================================================

function abrirModal(modalId) {
    var modal = document.getElementById(modalId);
    if (modal) {
        modal.classList.add('show');
        document.body.style.overflow = 'hidden';
    }
}

function fecharModal(modalId) {
    var modal = document.getElementById(modalId);
    if (modal) {
        modal.classList.remove('show');
        document.body.style.overflow = '';
    }
}

function fecharTodosModais() {
    var modais = document.querySelectorAll('.modal.show');
    modais.forEach(function(modal) {
        modal.classList.remove('show');
    });
    document.body.style.overflow = '';
}

function mostrarMensagemModal(elementId, mensagem, tipo) {
    var elemento = document.getElementById(elementId);
    if (!elemento) return;

    var icone = '';
    if (tipo === 'success') icone = '<i class="fas fa-check-circle" aria-hidden="true"></i>';
    else if (tipo === 'danger') icone = '<i class="fas fa-exclamation-circle" aria-hidden="true"></i>';
    else if (tipo === 'warning') icone = '<i class="fas fa-exclamation-triangle" aria-hidden="true"></i>';
    else if (tipo === 'info') icone = '<i class="fas fa-info-circle" aria-hidden="true"></i>';

    elemento.innerHTML = icone + ' ' + escapeHtml(mensagem);
    elemento.className = 'alert alert-' + tipo;
    elemento.style.display = 'flex';

    if (tipo === 'success') {
        setTimeout(function() {
            ocultarMensagem(elementId);
        }, 5000);
    }
}

function ocultarMensagem(elementId) {
    var elemento = document.getElementById(elementId);
    if (elemento) {
        elemento.style.display = 'none';
    }
}

// ==============================================================================
// VALIDACOES
// ==============================================================================

function validarUsuario(usuario) {
    if (!usuario || usuario.length < 3 || usuario.length > 50) {
        return false;
    }
    return /^[a-zA-Z][a-zA-Z0-9_.]*$/.test(usuario);
}

function validarEmail(email) {
    if (!email || email.length > 255) {
        return false;
    }
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function validarSenhaForte(senha) {
    if (!senha || senha.length < 8 || senha.length > 128) {
        return false;
    }

    var temMaiuscula = /[A-Z]/.test(senha);
    var temMinuscula = /[a-z]/.test(senha);
    var temNumero = /[0-9]/.test(senha);
    var temEspecial = /[!@#$%^&*(),.?":{}|<>\-_=+\[\]\\;'`~]/.test(senha);

    return temMaiuscula && temMinuscula && temNumero && temEspecial;
}

// ==============================================================================
// FORMATACAO
// ==============================================================================

function formatarData(data) {
    if (!data) return '-';

    try {
        var d = new Date(data);
        if (isNaN(d.getTime())) return '-';

        return d.toLocaleString('pt-BR', {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });
    } catch (e) {
        return '-';
    }
}

function formatarAcao(acao) {
    var acoes = {
        'criacao': 'Criacao',
        'edicao': 'Edicao',
        'reset_senha': 'Reset de Senha',
        'alteracao_senha': 'Alteracao de Senha',
        'ativacao': 'Ativacao',
        'desativacao': 'Desativacao',
        'adicao_permissao': 'Permissao Adicionada',
        'remocao_permissao': 'Permissao Removida',
        'login': 'Login',
        'login_falha': 'Falha de Login',
        'logout': 'Logout'
    };
    return acoes[acao] || acao || '-';
}

function escapeHtml(texto) {
    if (!texto) return '';

    var div = document.createElement('div');
    div.textContent = texto;
    return div.innerHTML;
}

function debounce(func, wait) {
    var timeout;
    return function() {
        var context = this;
        var args = arguments;
        clearTimeout(timeout);
        timeout = setTimeout(function() {
            func.apply(context, args);
        }, wait);
    };
}