let usuarioAtual = null;

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

        if (data.is_admin) {
            document.getElementById('btn-admin').style.display = 'block';
        }

    } catch (erro) {
        console.error('Erro ao verificar autenticação:', erro);
        window.location.href = '/login.html';
    }
}

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

// Abrir Modal de Cadastro
document.getElementById('btn-admin')?.addEventListener('click', () => {
    document.getElementById('modal-cadastro').style.display = 'flex';
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

// Abrir Painel
function abrirPainel(nomePainel) {
    window.location.href = `/painel/${nomePainel}`;
}