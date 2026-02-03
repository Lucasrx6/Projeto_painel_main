/**
 * ==============================================================================
 * TELA DE LOGIN - JAVASCRIPT
 * Sistema de Paineis - Hospital Anchieta Ceilandia
 * Versao 2.0 - Seguranca Aprimorada
 * ==============================================================================
 */

'use strict';

// ==============================================================================
// CONFIGURACAO
// ==============================================================================

var CONFIG = {
    endpoints: {
        verificarSessao: '/api/verificar-sessao',
        login: '/api/login'
    },
    redirectUrl: '/frontend/dashboard.html',
    mensagens: {
        camposObrigatorios: 'Preencha todos os campos',
        usuarioInvalido: 'Nome de usuario invalido',
        senhaInvalida: 'Senha deve ter no minimo 4 caracteres',
        erroConexao: 'Erro de conexao com o servidor. Tente novamente.',
        loginSucesso: 'Login realizado com sucesso!',
        entrando: 'Entrando...'
    },
    delays: {
        redirectAfterLogin: 800,
        hideSuccessMessage: 5000
    }
};

// ==============================================================================
// ELEMENTOS DOM
// ==============================================================================

var Elementos = {
    form: null,
    inputUsuario: null,
    inputSenha: null,
    btnLogin: null,
    btnLoginTexto: null,
    mensagem: null
};

// ==============================================================================
// INICIALIZACAO
// ==============================================================================

document.addEventListener('DOMContentLoaded', function() {
    inicializarElementos();
    verificarSessaoExistente();
    configurarEventos();
    registrarServiceWorker();
});

function inicializarElementos() {
    Elementos.form = document.getElementById('form-login');
    Elementos.inputUsuario = document.getElementById('usuario');
    Elementos.inputSenha = document.getElementById('senha');
    Elementos.btnLogin = document.getElementById('btn-login');
    Elementos.btnLoginTexto = document.getElementById('btn-login-texto');
    Elementos.mensagem = document.getElementById('mensagem-login');
}

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
// VERIFICACAO DE SESSAO
// ==============================================================================

function verificarSessaoExistente() {
    fetch(CONFIG.endpoints.verificarSessao, {
        method: 'GET',
        credentials: 'include'
    })
    .then(function(response) {
        return response.json();
    })
    .then(function(data) {
        if (data.autenticado) {
            console.log('[AUTH] Usuario ja autenticado, redirecionando...');
            redirecionarDashboard();
        }
    })
    .catch(function(erro) {
        // Silencioso - usuario nao esta logado
        console.log('[AUTH] Nenhuma sessao ativa');
    });
}

function redirecionarDashboard() {
    window.location.href = CONFIG.redirectUrl;
}

// ==============================================================================
// CONFIGURACAO DE EVENTOS
// ==============================================================================

function configurarEventos() {
    // Submit do formulario
    if (Elementos.form) {
        Elementos.form.addEventListener('submit', processarLogin);
    }

    // Limpar erro ao digitar
    if (Elementos.inputUsuario) {
        Elementos.inputUsuario.addEventListener('input', function() {
            limparErro();
            this.classList.remove('error');
        });
    }

    if (Elementos.inputSenha) {
        Elementos.inputSenha.addEventListener('input', function() {
            limparErro();
            this.classList.remove('error');
        });
    }

    // Enter no campo de senha
    if (Elementos.inputSenha) {
        Elementos.inputSenha.addEventListener('keypress', function(e) {
            if (e.key === 'Enter') {
                e.preventDefault();
                Elementos.form.dispatchEvent(new Event('submit'));
            }
        });
    }

    // Focus automatico no campo usuario
    if (Elementos.inputUsuario) {
        Elementos.inputUsuario.focus();
    }
}

// ==============================================================================
// PROCESSAMENTO DO LOGIN
// ==============================================================================

function processarLogin(e) {
    e.preventDefault();

    var usuario = Elementos.inputUsuario.value.trim();
    var senha = Elementos.inputSenha.value;

    // Validacao de campos vazios
    if (!usuario || !senha) {
        mostrarErro(CONFIG.mensagens.camposObrigatorios);
        marcarCampoErro(!usuario ? Elementos.inputUsuario : Elementos.inputSenha);
        return;
    }

    // Validacao do usuario
    if (!validarUsuario(usuario)) {
        mostrarErro(CONFIG.mensagens.usuarioInvalido);
        marcarCampoErro(Elementos.inputUsuario);
        return;
    }

    // Validacao da senha
    if (!validarSenha(senha)) {
        mostrarErro(CONFIG.mensagens.senhaInvalida);
        marcarCampoErro(Elementos.inputSenha);
        return;
    }

    // Iniciar loading
    setLoadingState(true);
    limparErro();

    // Enviar requisicao
    enviarLogin(usuario, senha);
}

function enviarLogin(usuario, senha) {
    fetch(CONFIG.endpoints.login, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        credentials: 'include',
        body: JSON.stringify({
            usuario: usuario,
            senha: senha
        })
    })
    .then(function(response) {
        return response.json();
    })
    .then(function(data) {
        if (data.success) {
            tratarLoginSucesso();
        } else {
            tratarLoginErro(data.error || 'Credenciais invalidas');
        }
    })
    .catch(function(erro) {
        console.error('[LOGIN] Erro na requisicao:', erro);
        tratarLoginErro(CONFIG.mensagens.erroConexao);
    });
}

function tratarLoginSucesso() {
    mostrarSucesso(CONFIG.mensagens.loginSucesso);

    // Redireciona apos delay
    setTimeout(function() {
        redirecionarDashboard();
    }, CONFIG.delays.redirectAfterLogin);
}

function tratarLoginErro(mensagem) {
    setLoadingState(false);
    mostrarErro(mensagem);

    // Focus no campo de senha e seleciona
    if (Elementos.inputSenha) {
        Elementos.inputSenha.focus();
        Elementos.inputSenha.select();
    }
}

// ==============================================================================
// VALIDACOES
// ==============================================================================

function validarUsuario(usuario) {
    if (!usuario || usuario.length < 3 || usuario.length > 50) {
        return false;
    }
    // Permite letras, numeros, underscore e ponto
    return /^[a-zA-Z0-9_.]+$/.test(usuario);
}

function validarSenha(senha) {
    if (!senha || senha.length < 4 || senha.length > 128) {
        return false;
    }
    return true;
}

// ==============================================================================
// UI - LOADING STATE
// ==============================================================================

function setLoadingState(loading) {
    if (Elementos.btnLogin) {
        Elementos.btnLogin.disabled = loading;
    }

    if (Elementos.btnLoginTexto) {
        if (loading) {
            Elementos.btnLogin.innerHTML =
                '<i class="fas fa-spinner fa-spin" aria-hidden="true"></i> ' +
                '<span>' + CONFIG.mensagens.entrando + '</span>';
        } else {
            Elementos.btnLogin.innerHTML =
                '<i class="fas fa-sign-in-alt" aria-hidden="true"></i> ' +
                '<span id="btn-login-texto">Entrar</span>';
        }
    }

    // Desabilita inputs durante loading
    if (Elementos.inputUsuario) {
        Elementos.inputUsuario.disabled = loading;
    }
    if (Elementos.inputSenha) {
        Elementos.inputSenha.disabled = loading;
    }
}

// ==============================================================================
// UI - MENSAGENS
// ==============================================================================

function mostrarErro(mensagem) {
    if (!Elementos.mensagem) return;

    Elementos.mensagem.innerHTML =
        '<i class="fas fa-exclamation-circle" aria-hidden="true"></i> ' +
        escapeHtml(mensagem);
    Elementos.mensagem.className = 'alert alert-danger';
    Elementos.mensagem.style.display = 'flex';
    Elementos.mensagem.setAttribute('role', 'alert');
}

function mostrarSucesso(mensagem) {
    if (!Elementos.mensagem) return;

    Elementos.mensagem.innerHTML =
        '<i class="fas fa-check-circle" aria-hidden="true"></i> ' +
        escapeHtml(mensagem);
    Elementos.mensagem.className = 'alert alert-success';
    Elementos.mensagem.style.display = 'flex';
    Elementos.mensagem.setAttribute('role', 'status');
}

function limparErro() {
    if (!Elementos.mensagem) return;

    Elementos.mensagem.style.display = 'none';
    Elementos.mensagem.textContent = '';
}

function marcarCampoErro(campo) {
    if (!campo) return;

    campo.classList.add('error');
    campo.focus();
}

// ==============================================================================
// UTILITARIOS
// ==============================================================================

function escapeHtml(texto) {
    if (!texto) return '';

    var div = document.createElement('div');
    div.textContent = texto;
    return div.innerHTML;
}

// ==============================================================================
// PREVENCAO DE ATAQUES
// ==============================================================================

// Previne multiplos submits rapidos (rate limiting client-side)
var ultimoSubmit = 0;
var intervaloMinimo = 1000; // 1 segundo entre submits

var originalProcessarLogin = processarLogin;
processarLogin = function(e) {
    var agora = Date.now();
    if (agora - ultimoSubmit < intervaloMinimo) {
        e.preventDefault();
        console.warn('[SECURITY] Submit bloqueado - muito rapido');
        return;
    }
    ultimoSubmit = agora;
    originalProcessarLogin(e);
};

// Limpa campos sensiveis ao sair da pagina
window.addEventListener('beforeunload', function() {
    if (Elementos.inputSenha) {
        Elementos.inputSenha.value = '';
    }
});

// Previne que a pagina seja carregada em iframe (clickjacking)
if (window.top !== window.self) {
    console.warn('[SECURITY] Tentativa de carregar em iframe bloqueada');
    window.top.location = window.self.location;
}