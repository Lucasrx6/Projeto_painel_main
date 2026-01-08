let usuarioAtual = null;
let permissoesUsuario = [];

// Verifica autenticação ao carregar
verificarAutenticacao();

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

        usuarioAtual = data;
        document.getElementById('usuario-nome').textContent = `Olá, ${data.usuario}`;

        // Mostrar botões de admin
        if (data.is_admin) {
            document.getElementById('btn-gestao-usuarios').style.display = 'block';
            document.getElementById('btn-admin').style.display = 'block';
        }

        // Carregar permissões e filtrar painéis
        await carregarPermissoes();

    } catch (erro) {
        console.error('Erro ao verificar autenticação:', erro);
        window.location.href = '/login.html';
    }
}

async function carregarPermissoes() {
    try {
        const response = await fetch('/api/minhas-permissoes', {
            credentials: 'include'
        });
        const data = await response.json();

        if (data.success) {
            permissoesUsuario = data.permissoes;

            // ✅ CORREÇÃO: Se for admin, mostrar TODOS os painéis
            if (data.is_admin) {
                mostrarTodosPaineis();
            } else {
                filtrarPaineisVisiveis();
            }
        }

    } catch (erro) {
        console.error('Erro ao carregar permissões:', erro);
    }
}

// ✅ NOVA FUNÇÃO: Mostrar todos os painéis para admins
function mostrarTodosPaineis() {
    const paineis = [
        { nome: 'painel2', selector: '.painel-card[onclick*="painel2"]' },
        { nome: 'painel3', selector: '.painel-card[onclick*="painel3"]' },
        { nome: 'painel4', selector: '.painel-card[onclick*="painel4"]' },
        { nome: 'painel5', selector: '.painel-card[onclick*="painel5"]' },
        { nome: 'painel6', selector: '.painel-card[onclick*="painel6"]' },
        { nome: 'painel7', selector: '.painel-card[onclick*="painel7"]' },
        { nome: 'painel8', selector: '.painel-card[onclick*="painel8"]' },
        { nome: 'painel9', selector: '.painel-card[onclick*="painel9"]' }
    ];

    paineis.forEach(painel => {
        const card = document.querySelector(painel.selector);
        if (card) {
            card.style.display = 'block';
            card.classList.remove('painel-disabled');
            card.style.pointerEvents = 'auto';
            card.style.opacity = '1';
        }
    });

    // Remove mensagem de "sem painéis" se existir
    const mensagemExistente = document.getElementById('mensagem-sem-paineis');
    if (mensagemExistente) {
        mensagemExistente.remove();
    }

    console.log('✅ Admin: Todos os painéis liberados');
}

function filtrarPaineisVisiveis() {
    const paineis = [
        { nome: 'painel2', selector: '.painel-card[onclick*="painel2"]' },
        { nome: 'painel3', selector: '.painel-card[onclick*="painel3"]' },
        { nome: 'painel4', selector: '.painel-card[onclick*="painel4"]' },
        { nome: 'painel5', selector: '.painel-card[onclick*="painel5"]' },
        { nome: 'painel6', selector: '.painel-card[onclick*="painel6"]' },
        { nome: 'painel7', selector: '.painel-card[onclick*="painel7"]' },
        { nome: 'painel8', selector: '.painel-card[onclick*="painel8"]' },
        { nome: 'painel9', selector: '.painel-card[onclick*="painel9"]' }
    ];

    let paineisVisiveis = 0;

    paineis.forEach(painel => {
        const card = document.querySelector(painel.selector);
        if (!card) return;

        const temPermissao = permissoesUsuario.includes(painel.nome);

        if (temPermissao) {
            card.style.display = 'block';
            card.classList.remove('painel-disabled');
            card.style.pointerEvents = 'auto';
            card.style.opacity = '1';
            paineisVisiveis++;
        } else {
            card.style.display = 'none';
        }
    });

    // Mostrar mensagem se não houver painéis
    mostrarMensagemSemPaineis(paineisVisiveis);
}

function mostrarMensagemSemPaineis(quantidade) {
    const grid = document.querySelector('.paineis-grid');
    let mensagemExistente = document.getElementById('mensagem-sem-paineis');

    if (quantidade === 0) {
        // Não tem painéis - mostrar mensagem
        if (!mensagemExistente) {
            const mensagem = document.createElement('div');
            mensagem.id = 'mensagem-sem-paineis';
            mensagem.className = 'mensagem-sem-paineis';
            mensagem.innerHTML = `
                <div class="sem-paineis-icon">
                    <i class="fas fa-lock"></i>
                </div>
                <h2>Nenhum Painel Disponível</h2>
                <p>Você ainda não tem permissão para acessar nenhum painel.</p>
                <p>Entre em contato com o administrador para solicitar acesso.</p>
            `;
            grid.appendChild(mensagem);
        }
    } else {
        // Tem painéis - remover mensagem se existir
        if (mensagemExistente) {
            mensagemExistente.remove();
        }
    }
}

function abrirPainel(nomePainel) {
    // ✅ CORREÇÃO: Admin sempre pode acessar
    if (usuarioAtual.is_admin) {
        window.location.href = `/painel/${nomePainel}`;
        return;
    }

    // Verifica permissão para usuários normais
    if (!permissoesUsuario.includes(nomePainel)) {
        alert('Você não tem permissão para acessar este painel.');
        return;
    }

    window.location.href = `/painel/${nomePainel}`;
}

// Botão Gestão de Usuários
document.getElementById('btn-gestao-usuarios')?.addEventListener('click', () => {
    window.location.href = '/admin/usuarios';
});

// Botão Cadastrar Usuário (modal rápido)
document.getElementById('btn-admin')?.addEventListener('click', () => {
    document.getElementById('modal-cadastro').style.display = 'flex';
});

// Logout
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

// Fechar Modal
function fecharModal() {
    document.getElementById('modal-cadastro').style.display = 'none';
    document.getElementById('form-cadastro').reset();
    document.getElementById('mensagem-cadastro').style.display = 'none';
}

// Cadastrar Usuário
document.getElementById('form-cadastro').addEventListener('submit', async (e) => {
    e.preventDefault();

    const usuario = document.getElementById('novo-usuario').value.trim();
    const email = document.getElementById('novo-email').value.trim();
    const senha = document.getElementById('nova-senha').value;
    const confirmaSenha = document.getElementById('confirma-senha').value;
    const isAdmin = document.getElementById('is-admin').checked;

    if (senha !== confirmaSenha) {
        mostrarMensagem('As senhas não coincidem', 'danger');
        return;
    }

    if (senha.length < 4) {
        mostrarMensagem('A senha deve ter no mínimo 4 caracteres', 'danger');
        return;
    }

    try {
        const response = await fetch('/api/cadastro', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            credentials: 'include',
            body: JSON.stringify({ usuario, email, senha, is_admin: isAdmin })
        });

        const data = await response.json();

        if (data.success) {
            mostrarMensagem('Usuário cadastrado com sucesso!', 'success');
            setTimeout(() => {
                fecharModal();
            }, 2000);
        } else {
            mostrarMensagem(data.error || 'Erro ao cadastrar usuário', 'danger');
        }

    } catch (erro) {
        console.error('Erro no cadastro:', erro);
        mostrarMensagem('Erro de conexão com o servidor', 'danger');
    }
});

function mostrarMensagem(mensagem, tipo) {
    const div = document.getElementById('mensagem-cadastro');
    div.textContent = mensagem;
    div.className = `alert alert-${tipo}`;
    div.style.display = 'block';
}