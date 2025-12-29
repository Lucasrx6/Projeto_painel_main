// ========================================
// 🎯 GESTÃO DE USUÁRIOS - JAVASCRIPT
// ========================================

let usuariosData = [];
let usuariosFiltrados = [];
let usuarioAtual = null;

// ========================================
// 🚀 INICIALIZAÇÃO
// ========================================

document.addEventListener('DOMContentLoaded', () => {
    verificarAutenticacao();
    configurarEventos();
});

async function verificarAutenticacao() {
    try {
        const response = await fetch('/api/verificar-sessao', {
            credentials: 'include'
        });
        const data = await response.json();

        if (!data.autenticado) {
            window.location.href = '/login.html';
            return;
        }

        if (!data.is_admin) {
            alert('Acesso negado! Apenas administradores.');
            window.location.href = '/frontend/dashboard.html';
            return;
        }

        usuarioAtual = data;
        document.getElementById('admin-nome').textContent = `Admin: ${data.usuario}`;

        // Carrega dados
        await Promise.all([
            carregarEstatisticas(),
            carregarUsuarios()
        ]);

    } catch (erro) {
        console.error('Erro ao verificar autenticação:', erro);
        window.location.href = '/login.html';
    }
}

function configurarEventos() {
    // Header
    document.getElementById('btn-voltar-dashboard').addEventListener('click', () => {
        window.location.href = '/frontend/dashboard.html';
    });

    document.getElementById('btn-logout').addEventListener('click', async () => {
        try {
            await fetch('/api/logout', {
                method: 'POST',
                credentials: 'include'
            });
            window.location.href = '/login.html';
        } catch (erro) {
            console.error('Erro no logout:', erro);
        }
    });

    // Controles
    document.getElementById('btn-novo-usuario').addEventListener('click', abrirModalNovoUsuario);
    document.getElementById('btn-refresh').addEventListener('click', carregarUsuarios);
    document.getElementById('search-input').addEventListener('input', filtrarUsuarios);

    // Formulários
    document.getElementById('form-novo-usuario').addEventListener('submit', criarUsuario);
    document.getElementById('form-editar-usuario').addEventListener('submit', salvarEdicaoUsuario);
    document.getElementById('form-reset-senha').addEventListener('submit', salvarResetSenha);
}

// ========================================
// 📊 CARREGAR DADOS
// ========================================

async function carregarEstatisticas() {
    try {
        const response = await fetch('/api/admin/estatisticas', {
            credentials: 'include'
        });
        const data = await response.json();

        if (data.success) {
            const stats = data.estatisticas;
            document.getElementById('stat-total').textContent = stats.total;
            document.getElementById('stat-ativos').textContent = stats.ativos;
            document.getElementById('stat-inativos').textContent = stats.inativos;
            document.getElementById('stat-admins').textContent = stats.admins;
        }
    } catch (erro) {
        console.error('Erro ao carregar estatísticas:', erro);
    }
}

async function carregarUsuarios() {
    try {
        mostrarLoading();

        const response = await fetch('/api/admin/usuarios?incluir_inativos=true', {
            credentials: 'include'
        });
        const data = await response.json();

        if (data.success) {
            usuariosData = data.usuarios;
            usuariosFiltrados = [...usuariosData];
            renderizarTabela();
        } else {
            mostrarErro('Erro ao carregar usuários: ' + data.error);
        }
    } catch (erro) {
        console.error('Erro ao carregar usuários:', erro);
        mostrarErro('Erro de conexão ao carregar usuários');
    }
}

function filtrarUsuarios() {
    const busca = document.getElementById('search-input').value.toLowerCase();

    if (!busca) {
        usuariosFiltrados = [...usuariosData];
    } else {
        usuariosFiltrados = usuariosData.filter(user =>
            user.usuario.toLowerCase().includes(busca) ||
            (user.nome_completo && user.nome_completo.toLowerCase().includes(busca)) ||
            (user.email && user.email.toLowerCase().includes(busca)) ||
            (user.cargo && user.cargo.toLowerCase().includes(busca))
        );
    }

    renderizarTabela();
}

// ========================================
// 📋 RENDERIZAR TABELA
// ========================================

function renderizarTabela() {
    const tbody = document.getElementById('usuarios-tbody');

    if (usuariosFiltrados.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="9" style="text-align: center; padding: 40px; color: #666;">
                    <i class="fas fa-inbox" style="font-size: 3rem; margin-bottom: 10px; display: block;"></i>
                    Nenhum usuário encontrado
                </td>
            </tr>
        `;
        return;
    }

    tbody.innerHTML = usuariosFiltrados.map(user => `
        <tr>
            <td>${user.id}</td>
            <td><strong>${user.usuario}</strong></td>
            <td>${user.nome_completo || '-'}</td>
            <td>${user.email}</td>
            <td>${user.cargo || '-'}</td>
            <td>
                <span class="status-badge ${user.ativo ? 'status-ativo' : 'status-inativo'}">
                    ${user.ativo ? 'Ativo' : 'Inativo'}
                </span>
            </td>
            <td style="text-align: center;">
                ${user.is_admin ? '<i class="fas fa-crown admin-badge" title="Administrador"></i>' : '-'}
            </td>
            <td>${formatarData(user.ultimo_acesso)}</td>
            <td>
                <div style="display: flex; gap: 8px;">
                    <button class="btn-action" onclick="abrirModalEditarUsuario(${user.id})" title="Editar">
                        <i class="fas fa-edit"></i>
                    </button>
                    <button class="btn-action" onclick="abrirModalResetSenha(${user.id}, '${user.usuario}')" title="Reset Senha">
                        <i class="fas fa-key"></i>
                    </button>
                    <button class="btn-action" onclick="abrirModalPermissoes(${user.id}, '${user.usuario}')" title="Permissões">
                        <i class="fas fa-shield-alt"></i>
                    </button>
                    <button class="btn-action" onclick="abrirModalHistorico(${user.id}, '${user.usuario}')" title="Histórico">
                        <i class="fas fa-history"></i>
                    </button>
                    ${user.ativo ?
            `<button class="btn-action btn-danger" onclick="alterarStatusUsuario(${user.id}, false)" title="Desativar">
                            <i class="fas fa-user-times"></i>
                        </button>` :
            `<button class="btn-action btn-success" onclick="alterarStatusUsuario(${user.id}, true)" title="Ativar">
                            <i class="fas fa-user-check"></i>
                        </button>`
        }
                </div>
            </td>
        </tr>
    `).join('');
}

function mostrarLoading() {
    const tbody = document.getElementById('usuarios-tbody');
    tbody.innerHTML = `
        <tr>
            <td colspan="9" class="loading">
                <div class="loading-spinner"></div>
                <div>Carregando usuários...</div>
            </td>
        </tr>
    `;
}

function mostrarErro(mensagem) {
    const tbody = document.getElementById('usuarios-tbody');
    tbody.innerHTML = `
        <tr>
            <td colspan="9" style="text-align: center; padding: 40px; color: #dc3545;">
                <i class="fas fa-exclamation-triangle" style="font-size: 3rem; margin-bottom: 10px; display: block;"></i>
                ${mensagem}
            </td>
        </tr>
    `;
}

// ========================================
// 🎨 FORMATAÇÃO
// ========================================

function formatarData(data) {
    if (!data) return '-';
    try {
        const d = new Date(data);
        return d.toLocaleString('pt-BR', {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });
    } catch {
        return '-';
    }
}

function mostrarMensagem(elementId, mensagem, tipo) {
    const elemento = document.getElementById(elementId);
    elemento.textContent = mensagem;
    elemento.className = `alert alert-${tipo}`;
    elemento.style.display = 'block';

    if (tipo === 'success') {
        setTimeout(() => {
            elemento.style.display = 'none';
        }, 3000);
    }
}

// ========================================
// ➕ CRIAR USUÁRIO
// ========================================

function abrirModalNovoUsuario() {
    document.getElementById('form-novo-usuario').reset();
    document.getElementById('mensagem-novo-usuario').style.display = 'none';
    document.getElementById('modal-novo-usuario').classList.add('show');
}

function fecharModalNovoUsuario() {
    document.getElementById('modal-novo-usuario').classList.remove('show');
}

async function criarUsuario(e) {
    e.preventDefault();

    const dados = {
        usuario: document.getElementById('novo-usuario').value.trim(),
        email: document.getElementById('novo-email').value.trim(),
        senha: document.getElementById('novo-senha').value,
        is_admin: document.getElementById('novo-is-admin').checked
    };

    try {
        const response = await fetch('/api/cadastro', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify(dados)
        });

        const data = await response.json();

        if (data.success) {
            mostrarMensagem('mensagem-novo-usuario', 'Usuário criado com sucesso!', 'success');

            // Atualiza os dados adicionais se fornecidos
            const usuarioResponse = await fetch('/api/admin/usuarios?incluir_inativos=true', {
                credentials: 'include'
            });
            const usuariosData = await usuarioResponse.json();

            if (usuariosData.success) {
                const usuarioCriado = usuariosData.usuarios.find(u => u.usuario === dados.usuario);

                if (usuarioCriado) {
                    const nomeCompleto = document.getElementById('novo-nome-completo').value.trim();
                    const cargo = document.getElementById('novo-cargo').value.trim();

                    if (nomeCompleto || cargo) {
                        await fetch(`/api/admin/usuarios/${usuarioCriado.id}`, {
                            method: 'PUT',
                            headers: { 'Content-Type': 'application/json' },
                            credentials: 'include',
                            body: JSON.stringify({
                                nome_completo: nomeCompleto,
                                cargo: cargo
                            })
                        });
                    }
                }
            }

            setTimeout(() => {
                fecharModalNovoUsuario();
                carregarUsuarios();
                carregarEstatisticas();
            }, 1500);

        } else {
            mostrarMensagem('mensagem-novo-usuario', data.error || 'Erro ao criar usuário', 'danger');
        }

    } catch (erro) {
        console.error('Erro ao criar usuário:', erro);
        mostrarMensagem('mensagem-novo-usuario', 'Erro de conexão', 'danger');
    }
}

// ========================================
// ✏️ EDITAR USUÁRIO
// ========================================

async function abrirModalEditarUsuario(usuarioId) {
    try {
        const response = await fetch(`/api/admin/usuarios/${usuarioId}`, {
            credentials: 'include'
        });
        const data = await response.json();

        if (data.success) {
            const user = data.usuario;

            document.getElementById('editar-usuario-id').value = user.id;
            document.getElementById('editar-usuario-login').value = user.usuario;
            document.getElementById('editar-email').value = user.email || '';
            document.getElementById('editar-nome-completo').value = user.nome_completo || '';
            document.getElementById('editar-cargo').value = user.cargo || '';
            document.getElementById('editar-observacoes').value = user.observacoes || '';
            document.getElementById('editar-is-admin').checked = user.is_admin;

            document.getElementById('mensagem-editar-usuario').style.display = 'none';
            document.getElementById('modal-editar-usuario').classList.add('show');
        }
    } catch (erro) {
        console.error('Erro ao carregar usuário:', erro);
        alert('Erro ao carregar dados do usuário');
    }
}

function fecharModalEditarUsuario() {
    document.getElementById('modal-editar-usuario').classList.remove('show');
}

async function salvarEdicaoUsuario(e) {
    e.preventDefault();

    const usuarioId = document.getElementById('editar-usuario-id').value;
    const dados = {
        email: document.getElementById('editar-email').value.trim(),
        nome_completo: document.getElementById('editar-nome-completo').value.trim(),
        cargo: document.getElementById('editar-cargo').value.trim(),
        observacoes: document.getElementById('editar-observacoes').value.trim(),
        is_admin: document.getElementById('editar-is-admin').checked
    };

    try {
        const response = await fetch(`/api/admin/usuarios/${usuarioId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify(dados)
        });

        const data = await response.json();

        if (data.success) {
            mostrarMensagem('mensagem-editar-usuario', 'Usuário atualizado com sucesso!', 'success');
            setTimeout(() => {
                fecharModalEditarUsuario();
                carregarUsuarios();
                carregarEstatisticas();
            }, 1500);
        } else {
            mostrarMensagem('mensagem-editar-usuario', data.error || 'Erro ao atualizar', 'danger');
        }

    } catch (erro) {
        console.error('Erro ao editar usuário:', erro);
        mostrarMensagem('mensagem-editar-usuario', 'Erro de conexão', 'danger');
    }
}

// ========================================
// 🔑 RESET DE SENHA
// ========================================

function abrirModalResetSenha(usuarioId, usuarioNome) {
    document.getElementById('reset-usuario-id').value = usuarioId;
    document.getElementById('reset-usuario-nome').textContent = usuarioNome;
    document.getElementById('form-reset-senha').reset();
    document.getElementById('mensagem-reset-senha').style.display = 'none';
    document.getElementById('modal-reset-senha').classList.add('show');
}

function fecharModalResetSenha() {
    document.getElementById('modal-reset-senha').classList.remove('show');
}

async function salvarResetSenha(e) {
    e.preventDefault();

    const usuarioId = document.getElementById('reset-usuario-id').value;
    const novaSenha = document.getElementById('reset-nova-senha').value;
    const confirmaSenha = document.getElementById('reset-confirma-senha').value;

    if (novaSenha !== confirmaSenha) {
        mostrarMensagem('mensagem-reset-senha', 'As senhas não coincidem!', 'danger');
        return;
    }

    if (novaSenha.length < 4) {
        mostrarMensagem('mensagem-reset-senha', 'A senha deve ter no mínimo 4 caracteres', 'danger');
        return;
    }

    try {
        const response = await fetch(`/api/admin/usuarios/${usuarioId}/senha`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ nova_senha: novaSenha })
        });

        const data = await response.json();

        if (data.success) {
            mostrarMensagem('mensagem-reset-senha', 'Senha resetada com sucesso!', 'success');
            setTimeout(() => {
                fecharModalResetSenha();
            }, 1500);
        } else {
            mostrarMensagem('mensagem-reset-senha', data.error || 'Erro ao resetar senha', 'danger');
        }

    } catch (erro) {
        console.error('Erro ao resetar senha:', erro);
        mostrarMensagem('mensagem-reset-senha', 'Erro de conexão', 'danger');
    }
}

// ========================================
// 🔄 ATIVAR/DESATIVAR USUÁRIO
// ========================================

async function alterarStatusUsuario(usuarioId, ativo) {
    const acao = ativo ? 'ativar' : 'desativar';
    const confirmacao = confirm(`Deseja realmente ${acao} este usuário?`);

    if (!confirmacao) return;

    try {
        const response = await fetch(`/api/admin/usuarios/${usuarioId}/status`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ ativo })
        });

        const data = await response.json();

        if (data.success) {
            alert(data.message);
            carregarUsuarios();
            carregarEstatisticas();
        } else {
            alert('Erro: ' + data.error);
        }

    } catch (erro) {
        console.error('Erro ao alterar status:', erro);
        alert('Erro de conexão');
    }
}

// ========================================
// 🔐 GERENCIAR PERMISSÕES
// ========================================

async function abrirModalPermissoes(usuarioId, usuarioNome) {
    document.getElementById('permissoes-usuario-id').value = usuarioId;
    document.getElementById('permissoes-usuario-nome').textContent = usuarioNome;
    document.getElementById('mensagem-permissoes').style.display = 'none';

    const listaPaineis = document.getElementById('lista-paineis');
    listaPaineis.innerHTML = `
        <div class="loading-spinner"></div>
        <p>Carregando painéis...</p>
    `;

    document.getElementById('modal-permissoes').classList.add('show');

    try {
        // Carrega painéis disponíveis
        const [paineisResponse, permissoesResponse] = await Promise.all([
            fetch('/api/admin/paineis', { credentials: 'include' }),
            fetch(`/api/admin/usuarios/${usuarioId}/permissoes`, { credentials: 'include' })
        ]);

        const paineisData = await paineisResponse.json();
        const permissoesData = await permissoesResponse.json();

        if (paineisData.success && permissoesData.success) {
            const paineis = paineisData.paineis;
            const permissoes = permissoesData.permissoes.map(p => p.painel);

            listaPaineis.innerHTML = paineis.map(painel => {
                const temPermissao = permissoes.includes(painel.nome);
                return `
                    <div class="painel-item ${temPermissao ? 'ativo' : ''}">
                        <div class="painel-info">
                            <h4>${painel.titulo}</h4>
                            <p>${painel.descricao}</p>
                        </div>
                        <div class="painel-toggle">
                            <label class="switch">
                                <input type="checkbox"
                                       ${temPermissao ? 'checked' : ''}
                                       onchange="togglePermissao(${usuarioId}, '${painel.nome}', this.checked)">
                                <span class="slider"></span>
                            </label>
                        </div>
                    </div>
                `;
            }).join('');
        }

    } catch (erro) {
        console.error('Erro ao carregar permissões:', erro);
        listaPaineis.innerHTML = `
            <div class="alert alert-danger">
                Erro ao carregar permissões
            </div>
        `;
    }
}

function fecharModalPermissoes() {
    document.getElementById('modal-permissoes').classList.remove('show');
}

async function togglePermissao(usuarioId, painelNome, adicionar) {
    try {
        let response;

        if (adicionar) {
            // Adicionar permissão
            response = await fetch(`/api/admin/usuarios/${usuarioId}/permissoes`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ painel_nome: painelNome })
            });
        } else {
            // Remover permissão
            response = await fetch(`/api/admin/usuarios/${usuarioId}/permissoes/${painelNome}`, {
                method: 'DELETE',
                credentials: 'include'
            });
        }

        const data = await response.json();

        if (data.success) {
            mostrarMensagem('mensagem-permissoes', data.message, 'success');

            // Atualiza visualmente o item
            const painelItem = event.target.closest('.painel-item');
            if (adicionar) {
                painelItem.classList.add('ativo');
            } else {
                painelItem.classList.remove('ativo');
            }
        } else {
            mostrarMensagem('mensagem-permissoes', data.error, 'danger');
            // Reverte o switch
            event.target.checked = !adicionar;
        }

    } catch (erro) {
        console.error('Erro ao alterar permissão:', erro);
        mostrarMensagem('mensagem-permissoes', 'Erro de conexão', 'danger');
        // Reverte o switch
        event.target.checked = !adicionar;
    }
}

// ========================================
// 📜 HISTÓRICO
// ========================================

async function abrirModalHistorico(usuarioId, usuarioNome) {
    document.getElementById('historico-usuario-id').value = usuarioId;
    document.getElementById('historico-usuario-nome').textContent = usuarioNome;

    const listaHistorico = document.getElementById('lista-historico');
    listaHistorico.innerHTML = `
        <div class="loading-spinner"></div>
        <p>Carregando histórico...</p>
    `;

    document.getElementById('modal-historico').classList.add('show');

    try {
        const response = await fetch(`/api/admin/usuarios/${usuarioId}/historico?limite=50`, {
            credentials: 'include'
        });
        const data = await response.json();

        if (data.success) {
            if (data.historico.length === 0) {
                listaHistorico.innerHTML = `
                    <div style="text-align: center; padding: 40px; color: #666;">
                        <i class="fas fa-inbox" style="font-size: 3rem; margin-bottom: 10px; display: block;"></i>
                        Nenhum histórico encontrado
                    </div>
                `;
            } else {
                listaHistorico.innerHTML = data.historico.map(item => `
                    <div class="historico-item">
                        <div class="acao">${formatarAcao(item.acao)}</div>
                        <div class="detalhes">${item.detalhes}</div>
                        <div class="meta">
                            <span><i class="fas fa-calendar"></i> ${formatarData(item.data_hora)}</span>
                            <span><i class="fas fa-user"></i> ${item.realizado_por_usuario || 'Sistema'}</span>
                        </div>
                    </div>
                `).join('');
            }
        } else {
            listaHistorico.innerHTML = `
                <div class="alert alert-danger">
                    Erro ao carregar histórico: ${data.error}
                </div>
            `;
        }

    } catch (erro) {
        console.error('Erro ao carregar histórico:', erro);
        listaHistorico.innerHTML = `
            <div class="alert alert-danger">
                Erro de conexão ao carregar histórico
            </div>
        `;
    }
}

function fecharModalHistorico() {
    document.getElementById('modal-historico').classList.remove('show');
}

function formatarAcao(acao) {
    const acoes = {
        'criacao': 'Criação',
        'edicao': 'Edição',
        'reset_senha': 'Reset de Senha',
        'ativacao': 'Ativação',
        'desativacao': 'Desativação',
        'adicao_permissao': 'Permissão Adicionada',
        'remocao_permissao': 'Permissão Removida'
    };
    return acoes[acao] || acao;
}