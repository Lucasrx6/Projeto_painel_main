const formLogin = document.getElementById('form-login');
const btnLogin = document.getElementById('btn-login');
const mensagemErro = document.getElementById('mensagem-erro');

// Verifica se já está autenticado
verificarSessao();

async function verificarSessao() {
    try {
        const response = await fetch('/api/verificar-sessao', {
            credentials: 'include'
        });
        const data = await response.json();

        if (data.autenticado) {
            window.location.href = '/frontend/dashboard.html';
        }
    } catch (erro) {
        console.error('Erro ao verificar sessão:', erro);
    }
}

formLogin.addEventListener('submit', async (e) => {
    e.preventDefault();

    const usuario = document.getElementById('usuario').value.trim();
    const senha = document.getElementById('senha').value;

    if (!usuario || !senha) {
        mostrarErro('Preencha todos os campos');
        return;
    }

    btnLogin.disabled = true;
    btnLogin.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Entrando...';
    esconderErro();

    try {
        const response = await fetch('/api/login', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            credentials: 'include',
            body: JSON.stringify({ usuario, senha })
        });

        const data = await response.json();

        if (data.success) {
            mostrarSucesso('Login realizado com sucesso!');
            setTimeout(() => {
                window.location.href = '/frontend/dashboard.html';
            }, 1000);
        } else {
            mostrarErro(data.error || 'Erro ao fazer login');
            btnLogin.disabled = false;
            btnLogin.innerHTML = '<i class="fas fa-sign-in-alt"></i> Entrar';
        }

    } catch (erro) {
        console.error('Erro no login:', erro);
        mostrarErro('Erro de conexão com o servidor');
        btnLogin.disabled = false;
        btnLogin.innerHTML = '<i class="fas fa-sign-in-alt"></i> Entrar';
    }
});

function mostrarErro(mensagem) {
    mensagemErro.textContent = mensagem;
    mensagemErro.className = 'alert alert-danger';
    mensagemErro.style.display = 'block';
}

function mostrarSucesso(mensagem) {
    mensagemErro.textContent = mensagem;
    mensagemErro.className = 'alert alert-success';
    mensagemErro.style.display = 'block';
}

function esconderErro() {
    mensagemErro.style.display = 'none';
}