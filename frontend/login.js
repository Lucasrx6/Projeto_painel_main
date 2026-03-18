/**
 * ==============================================================================
 * TELA DE LOGIN - JAVASCRIPT
 * Sistema de Paineis - Hospital Anchieta Ceilandia
 * Versao 3.0 - Auto-login para paineis estáticos (TVs / monitores fixos)
 * ==============================================================================
 *
 * Funcionalidades:
 *   - Login padrão com validação
 *   - Após login, redireciona para ?next=<url> (painel de origem) se presente
 *   - "Salvar acesso": armazena credenciais localmente e faz login automático
 *   - Se sessão já existir e ?next estiver presente, redireciona direto ao painel
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
    redirectPadrao: '/frontend/dashboard.html',
    storageKey: 'painel_acesso_salvo',
    mensagens: {
        camposObrigatorios: 'Preencha todos os campos',
        usuarioInvalido: 'Nome de usuario invalido',
        senhaInvalida: 'Senha deve ter no minimo 4 caracteres',
        erroConexao: 'Erro de conexao com o servidor. Tente novamente.',
        loginSucesso: 'Login realizado com sucesso!',
        entrando: 'Entrando...',
        autoLogin: 'Entrando automaticamente...'
    },
    delays: {
        redirectAfterLogin: 700,
        autoLoginInicio: 300
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
    mensagem: null,
    checkSalvar: null
};

// ==============================================================================
// INICIALIZACAO
// ==============================================================================

document.addEventListener('DOMContentLoaded', function () {
    inicializarElementos();
    configurarEventos();
    registrarServiceWorker();

    // Ordem: verifica sessão → se já logado redireciona
    //        se não logado → tenta auto-login com credenciais salvas
    verificarSessaoExistente();
});

function inicializarElementos() {
    Elementos.form          = document.getElementById('form-login');
    Elementos.inputUsuario  = document.getElementById('usuario');
    Elementos.inputSenha    = document.getElementById('senha');
    Elementos.btnLogin      = document.getElementById('btn-login');
    Elementos.btnLoginTexto = document.getElementById('btn-login-texto');
    Elementos.mensagem      = document.getElementById('mensagem-login');
    Elementos.checkSalvar   = document.getElementById('salvar-acesso');
}

function registrarServiceWorker() {
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('/sw.js')
            .then(function (registration) {
                console.log('[SW] Service Worker registrado:', registration.scope);
            })
            .catch(function (error) {
                console.warn('[SW] Erro ao registrar Service Worker:', error);
            });
    }
}

// ==============================================================================
// PARAMETRO ?next — URL para retornar após o login
// ==============================================================================

function getNextUrl() {
    var params = new URLSearchParams(window.location.search);
    var next = params.get('next');
    // Valida: aceita somente URLs relativas ou do mesmo domínio
    if (next && (next.startsWith('/') || next.startsWith(window.location.origin))) {
        return next;
    }
    return null;
}

function redirecionarAposLogin() {
    var next = getNextUrl();
    window.location.href = next || CONFIG.redirectPadrao;
}

// ==============================================================================
// VERIFICACAO DE SESSAO
// ==============================================================================

function verificarSessaoExistente() {
    fetch(CONFIG.endpoints.verificarSessao, {
        method: 'GET',
        credentials: 'include'
    })
    .then(function (response) { return response.json(); })
    .then(function (data) {
        if (data.autenticado) {
            console.log('[AUTH] Sessão ativa — redirecionando...');
            redirecionarAposLogin();
        } else {
            // Sem sessão: tenta auto-login se houver credenciais salvas
            tentarAutoLogin();
        }
    })
    .catch(function () {
        console.log('[AUTH] Nenhuma sessao ativa');
        tentarAutoLogin();
    });
}

// ==============================================================================
// AUTO-LOGIN (para paineis estáticos / TVs)
// ==============================================================================

function carregarCredenciaisSalvas() {
    try {
        var raw = localStorage.getItem(CONFIG.storageKey);
        if (!raw) return null;
        var dados = JSON.parse(atob(raw));
        if (dados && dados.u && dados.s) return dados;
    } catch (e) {}
    return null;
}

function salvarCredenciais(usuario, senha) {
    try {
        var dados = { u: usuario, s: senha };
        localStorage.setItem(CONFIG.storageKey, btoa(JSON.stringify(dados)));
    } catch (e) {
        console.warn('[ACESSO] Nao foi possivel salvar credenciais no localStorage');
    }
}

function limparCredenciaisSalvas() {
    localStorage.removeItem(CONFIG.storageKey);
}

function tentarAutoLogin() {
    // Se o usuário clicou em "Sair" manualmente, não faz auto-login
    if (sessionStorage.getItem('saiu_manualmente')) {
        sessionStorage.removeItem('saiu_manualmente');
        return;
    }

    var dados = carregarCredenciaisSalvas();
    if (!dados) return;

    console.log('[AUTO-LOGIN] Credenciais salvas encontradas — iniciando login automático...');

    // Preenche o formulário visualmente
    if (Elementos.inputUsuario) Elementos.inputUsuario.value = dados.u;
    if (Elementos.inputSenha)   Elementos.inputSenha.value   = dados.s;
    if (Elementos.checkSalvar)  Elementos.checkSalvar.checked = true;

    mostrarInfo(CONFIG.mensagens.autoLogin);
    setLoadingState(true);

    setTimeout(function () {
        enviarLogin(dados.u, dados.s, true);
    }, CONFIG.delays.autoLoginInicio);
}

// ==============================================================================
// CONFIGURACAO DE EVENTOS
// ==============================================================================

function configurarEventos() {
    if (Elementos.form) {
        Elementos.form.addEventListener('submit', processarLogin);
    }

    if (Elementos.inputUsuario) {
        Elementos.inputUsuario.addEventListener('input', function () {
            limparMensagem();
            this.classList.remove('error');
        });
    }

    if (Elementos.inputSenha) {
        Elementos.inputSenha.addEventListener('input', function () {
            limparMensagem();
            this.classList.remove('error');
        });
        Elementos.inputSenha.addEventListener('keypress', function (e) {
            if (e.key === 'Enter') {
                e.preventDefault();
                Elementos.form.dispatchEvent(new Event('submit'));
            }
        });
    }

    if (Elementos.inputUsuario) {
        Elementos.inputUsuario.focus();
    }
}

// ==============================================================================
// PROCESSAMENTO DO LOGIN
// ==============================================================================

var ultimoSubmit = 0;
var intervaloMinimo = 1000;

function processarLogin(e) {
    e.preventDefault();

    var agora = Date.now();
    if (agora - ultimoSubmit < intervaloMinimo) {
        console.warn('[SECURITY] Submit bloqueado - muito rapido');
        return;
    }
    ultimoSubmit = agora;

    var usuario = Elementos.inputUsuario.value.trim();
    var senha   = Elementos.inputSenha.value;

    if (!usuario || !senha) {
        mostrarErro(CONFIG.mensagens.camposObrigatorios);
        marcarCampoErro(!usuario ? Elementos.inputUsuario : Elementos.inputSenha);
        return;
    }
    if (!validarUsuario(usuario)) {
        mostrarErro(CONFIG.mensagens.usuarioInvalido);
        marcarCampoErro(Elementos.inputUsuario);
        return;
    }
    if (!validarSenha(senha)) {
        mostrarErro(CONFIG.mensagens.senhaInvalida);
        marcarCampoErro(Elementos.inputSenha);
        return;
    }

    setLoadingState(true);
    limparMensagem();
    enviarLogin(usuario, senha, false);
}

function enviarLogin(usuario, senha, isAutoLogin) {
    fetch(CONFIG.endpoints.login, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ usuario: usuario, senha: senha })
    })
    .then(function (response) { return response.json(); })
    .then(function (data) {
        if (data.success) {
            tratarLoginSucesso(usuario, senha, isAutoLogin);
        } else {
            tratarLoginErro(data.error || 'Credenciais invalidas', isAutoLogin);
        }
    })
    .catch(function (erro) {
        console.error('[LOGIN] Erro na requisicao:', erro);
        tratarLoginErro(CONFIG.mensagens.erroConexao, isAutoLogin);
    });
}

function tratarLoginSucesso(usuario, senha, isAutoLogin) {
    // Salva ou limpa credenciais conforme checkbox
    var salvar = Elementos.checkSalvar && Elementos.checkSalvar.checked;
    if (salvar) {
        salvarCredenciais(usuario, senha);
    } else if (!isAutoLogin) {
        // Se o usuário não marcou "salvar" e não é auto-login, limpa qualquer credencial salva anteriormente
        limparCredenciaisSalvas();
    }

    mostrarSucesso(CONFIG.mensagens.loginSucesso);

    setTimeout(function () {
        redirecionarAposLogin();
    }, CONFIG.delays.redirectAfterLogin);
}

function tratarLoginErro(mensagem, isAutoLogin) {
    setLoadingState(false);

    if (isAutoLogin) {
        // Auto-login falhou (senha pode ter sido alterada): limpa credenciais salvas
        limparCredenciaisSalvas();
        mostrarErro('Acesso automático falhou. Por favor, faça login manualmente.');
        if (Elementos.inputSenha) {
            Elementos.inputSenha.value = '';
            Elementos.inputSenha.focus();
        }
    } else {
        mostrarErro(mensagem);
        if (Elementos.inputSenha) {
            Elementos.inputSenha.focus();
            Elementos.inputSenha.select();
        }
    }
}

// ==============================================================================
// VALIDACOES
// ==============================================================================

function validarUsuario(usuario) {
    if (!usuario || usuario.length < 3 || usuario.length > 50) return false;
    return /^[a-zA-Z0-9_.]+$/.test(usuario);
}

function validarSenha(senha) {
    return senha && senha.length >= 4 && senha.length <= 128;
}

// ==============================================================================
// UI - LOADING STATE
// ==============================================================================

function setLoadingState(loading) {
    if (Elementos.btnLogin) {
        Elementos.btnLogin.disabled = loading;
        Elementos.btnLogin.innerHTML = loading
            ? '<i class="fas fa-spinner fa-spin" aria-hidden="true"></i> <span>' + CONFIG.mensagens.entrando + '</span>'
            : '<i class="fas fa-sign-in-alt" aria-hidden="true"></i> <span id="btn-login-texto">Entrar</span>';
    }
    if (Elementos.inputUsuario) Elementos.inputUsuario.disabled = loading;
    if (Elementos.inputSenha)   Elementos.inputSenha.disabled   = loading;
    if (Elementos.checkSalvar)  Elementos.checkSalvar.disabled  = loading;
}

// ==============================================================================
// UI - MENSAGENS
// ==============================================================================

function mostrarErro(mensagem) {
    if (!Elementos.mensagem) return;
    Elementos.mensagem.innerHTML =
        '<i class="fas fa-exclamation-circle" aria-hidden="true"></i> ' + escapeHtml(mensagem);
    Elementos.mensagem.className = 'alert alert-danger';
    Elementos.mensagem.style.display = 'flex';
    Elementos.mensagem.setAttribute('role', 'alert');
}

function mostrarSucesso(mensagem) {
    if (!Elementos.mensagem) return;
    Elementos.mensagem.innerHTML =
        '<i class="fas fa-check-circle" aria-hidden="true"></i> ' + escapeHtml(mensagem);
    Elementos.mensagem.className = 'alert alert-success';
    Elementos.mensagem.style.display = 'flex';
    Elementos.mensagem.setAttribute('role', 'status');
}

function mostrarInfo(mensagem) {
    if (!Elementos.mensagem) return;
    Elementos.mensagem.innerHTML =
        '<i class="fas fa-circle-notch fa-spin" aria-hidden="true"></i> ' + escapeHtml(mensagem);
    Elementos.mensagem.className = 'alert alert-info';
    Elementos.mensagem.style.display = 'flex';
    Elementos.mensagem.setAttribute('role', 'status');
}

function limparMensagem() {
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

// Limpa campos sensiveis ao sair da pagina
window.addEventListener('beforeunload', function () {
    if (Elementos.inputSenha) Elementos.inputSenha.value = '';
});

// Previne carregamento em iframe (clickjacking)
if (window.top !== window.self) {
    console.warn('[SECURITY] Tentativa de carregar em iframe bloqueada');
    window.top.location = window.self.location;
}
