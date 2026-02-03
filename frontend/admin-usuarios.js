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
    usuarioAtual: null,
    carregando: false
};

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
    var btnVoltar = document.getElementById('btn-voltar-dashboard');
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
            carregarUsuarios();
        });
    }

    var searchInput = document.getElementById('search-input');
    if (searchInput) {
        searchInput.addEventListener('input', debounce(filtrarUsuarios, CONFIG.debounceDelay));
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
    carregarUsuarios();
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

function carregarUsuarios() {
    if (Estado.carregando) return;
    Estado.carregando = true;

    mostrarLoading();

    fetch(CONFIG.endpoints.usuarios + '?incluir_inativos=true', {
        method: 'GET',
        credentials: 'include'
    })
    .then(function(response) {
        return response.json();
    })
    .then(function(data) {
        Estado.carregando = false;

        if (data.success) {
            Estado.usuarios = data.usuarios || [];
            Estado.usuariosFiltrados = Estado.usuarios.slice();
            renderizarTabela();
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

function filtrarUsuarios() {
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
            '<td>' + user.id + '</td>' +
            '<td><strong>' + escapeHtml(user.usuario) + '</strong></td>' +
            '<td>' + escapeHtml(user.nome_completo || '-') + '</td>' +
            '<td>' + escapeHtml(user.email || '-') + '</td>' +
            '<td>' + escapeHtml(user.cargo || '-') + '</td>' +
            '<td><span class="status-badge ' + statusClass + '">' + statusTexto + '</span></td>' +
            '<td style="text-align: center;">' + adminBadge + '</td>' +
            '<td>' + ultimoAcesso + '</td>' +
            '<td>' + botoesAcao + '</td>' +
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
        is_admin: isAdmin
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
                carregarUsuarios();
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
    // Busca o ID se nao tiver
    if (!usuarioId) {
        fetch(CONFIG.endpoints.usuarios + '?incluir_inativos=true', {
            method: 'GET',
            credentials: 'include'
        })
        .then(function(response) { return response.json(); })
        .then(function(data) {
            if (data.success) {
                var usuarioCriado = data.usuarios.find(function(u) {
                    return u.usuario === usuarioNome;
                });
                if (usuarioCriado) {
                    enviarAtualizacao(usuarioCriado.id, nomeCompleto, cargo);
                }
            }
        })
        .catch(function() {});
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
                carregarUsuarios();
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
        body: JSON.stringify({ nova_senha: novaSenha })
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
            carregarUsuarios();
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
            var paineis = paineisData.paineis || [];
            var permissoes = (permissoesData.permissoes || []).map(function(p) { return p.painel; });

            if (paineis.length === 0) {
                listaPaineis.innerHTML = '<p>Nenhum painel cadastrado.</p>';
                return;
            }

            listaPaineis.innerHTML = paineis.map(function(painel) {
                var temPermissao = permissoes.indexOf(painel.nome) !== -1;
                var classeAtivo = temPermissao ? 'ativo' : '';
                var checked = temPermissao ? 'checked' : '';

                return '<div class="painel-item ' + classeAtivo + '" data-painel="' + escapeHtml(painel.nome) + '">' +
                    '<div class="painel-info">' +
                        '<h4>' + escapeHtml(painel.titulo) + '</h4>' +
                        '<p>' + escapeHtml(painel.descricao || '') + '</p>' +
                    '</div>' +
                    '<div class="painel-toggle">' +
                        '<label class="switch">' +
                            '<input type="checkbox" ' + checked + ' onchange="togglePermissao(' + usuarioId + ', \'' + escapeHtml(painel.nome) + '\', this.checked, this)">' +
                            '<span class="slider"></span>' +
                        '</label>' +
                    '</div>' +
                '</div>';
            }).join('');
        } else {
            listaPaineis.innerHTML = '<div class="alert alert-danger">Erro ao carregar paineis</div>';
        }
    })
    .catch(function(erro) {
        console.error('[PERM] Erro ao carregar permissoes:', erro);
        listaPaineis.innerHTML = '<div class="alert alert-danger">' + CONFIG.mensagens.erroConexao + '</div>';
    });
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

    var options = {
        method: method,
        credentials: 'include'
    };

    if (adicionar) {
        options.headers = { 'Content-Type': 'application/json' };
        options.body = JSON.stringify({ painel_nome: painelNome });
    }

    fetch(url, options)
    .then(function(response) {
        return response.json();
    })
    .then(function(data) {
        if (data.success) {
            mostrarMensagemModal('mensagem-permissoes', data.message || 'Permissao atualizada', 'success');

            var painelItem = checkbox.closest('.painel-item');
            if (painelItem) {
                if (adicionar) {
                    painelItem.classList.add('ativo');
                } else {
                    painelItem.classList.remove('ativo');
                }
            }
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