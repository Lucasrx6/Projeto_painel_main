/**
 * TELA DE LOGIN - JAVASCRIPT
 * Sistema de Paineis - Hospital Anchieta Ceilandia
 * Versao 4.0 - Com Reset de Senha via PIN
 */

'use strict';

var CONFIG = {
    endpoints: {
        verificarSessao: '/api/verificar-sessao',
        login: '/api/login',
        resetSolicitar: '/api/reset-senha/solicitar',
        resetVerificar: '/api/reset-senha/verificar',
        resetConfirmar: '/api/reset-senha/confirmar',
        forceReset: '/api/reset-senha/force'
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
        autoLogin: 'Entrando automaticamente...',
        senhaFraca: 'A senha deve ter no minimo 8 caracteres com maiuscula, minuscula, numero e caractere especial',
        senhasNaoCoincidem: 'As senhas nao coincidem'
    },
    delays: { redirectAfterLogin: 700, autoLoginInicio: 300 }
};

var Elementos = {
    form: null, inputUsuario: null, inputSenha: null,
    btnLogin: null, btnLoginTexto: null, mensagem: null, checkSalvar: null
};

// Estado do reset
var ResetState = { usuario: '', pin: '', timerInterval: null, timerSeconds: 60 };

// ==============================================================================
// INICIALIZACAO
// ==============================================================================

document.addEventListener('DOMContentLoaded', function () {
    inicializarElementos();
    configurarEventos();
    configurarPinInputs();
    registrarServiceWorker();
    verificarSessaoExistente();
});

function inicializarElementos() {
    Elementos.form = document.getElementById('form-login');
    Elementos.inputUsuario = document.getElementById('usuario');
    Elementos.inputSenha = document.getElementById('senha');
    Elementos.btnLogin = document.getElementById('btn-login');
    Elementos.btnLoginTexto = document.getElementById('btn-login-texto');
    Elementos.mensagem = document.getElementById('mensagem-login');
    Elementos.checkSalvar = document.getElementById('salvar-acesso');
}

function registrarServiceWorker() {
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('/sw.js').catch(function () {});
    }
}

// ==============================================================================
// SESSAO E REDIRECT
// ==============================================================================

function getNextUrl() {
    var params = new URLSearchParams(window.location.search);
    var next = params.get('next');
    if (next && (next.startsWith('/') || next.startsWith(window.location.origin))) return next;
    return null;
}

function redirecionarAposLogin() {
    window.location.href = getNextUrl() || CONFIG.redirectPadrao;
}

function verificarSessaoExistente() {
    fetch(CONFIG.endpoints.verificarSessao, { method: 'GET', credentials: 'include' })
    .then(function (r) { return r.json(); })
    .then(function (data) {
        if (data.autenticado) {
            if (data.force_reset) { mostrarForceReset(); return; }
            redirecionarAposLogin();
        } else { tentarAutoLogin(); }
    })
    .catch(function () { tentarAutoLogin(); });
}

// ==============================================================================
// AUTO-LOGIN
// ==============================================================================

function carregarCredenciaisSalvas() {
    try { var raw = localStorage.getItem(CONFIG.storageKey); if (!raw) return null;
        var dados = JSON.parse(atob(raw)); if (dados && dados.u && dados.s) return dados;
    } catch (e) {} return null;
}
function salvarCredenciais(u, s) {
    try { localStorage.setItem(CONFIG.storageKey, btoa(JSON.stringify({ u: u, s: s }))); } catch (e) {}
}
function limparCredenciaisSalvas() { localStorage.removeItem(CONFIG.storageKey); }

function tentarAutoLogin() {
    if (sessionStorage.getItem('saiu_manualmente')) { sessionStorage.removeItem('saiu_manualmente'); return; }
    var dados = carregarCredenciaisSalvas(); if (!dados) return;
    if (Elementos.inputUsuario) Elementos.inputUsuario.value = dados.u;
    if (Elementos.inputSenha) Elementos.inputSenha.value = dados.s;
    if (Elementos.checkSalvar) Elementos.checkSalvar.checked = true;
    mostrarInfo(CONFIG.mensagens.autoLogin); setLoadingState(true);
    setTimeout(function () { enviarLogin(dados.u, dados.s, true); }, CONFIG.delays.autoLoginInicio);
}

// ==============================================================================
// EVENTOS
// ==============================================================================

function configurarEventos() {
    if (Elementos.form) Elementos.form.addEventListener('submit', processarLogin);
    if (Elementos.inputUsuario) {
        Elementos.inputUsuario.addEventListener('input', function () { limparMensagem(); this.classList.remove('error'); });
    }
    if (Elementos.inputSenha) {
        Elementos.inputSenha.addEventListener('input', function () { limparMensagem(); this.classList.remove('error'); });
        Elementos.inputSenha.addEventListener('keypress', function (e) {
            if (e.key === 'Enter') { e.preventDefault(); Elementos.form.dispatchEvent(new Event('submit')); }
        });
    }
    if (Elementos.inputUsuario) Elementos.inputUsuario.focus();
}

// ==============================================================================
// LOGIN
// ==============================================================================

var ultimoSubmit = 0;
function processarLogin(e) {
    e.preventDefault();
    if (Date.now() - ultimoSubmit < 1000) return; ultimoSubmit = Date.now();
    var usuario = Elementos.inputUsuario.value.trim();
    var senha = Elementos.inputSenha.value;
    if (!usuario || !senha) { mostrarErro(CONFIG.mensagens.camposObrigatorios); return; }
    if (!validarUsuario(usuario)) { mostrarErro(CONFIG.mensagens.usuarioInvalido); marcarCampoErro(Elementos.inputUsuario); return; }
    if (!validarSenha(senha)) { mostrarErro(CONFIG.mensagens.senhaInvalida); marcarCampoErro(Elementos.inputSenha); return; }
    setLoadingState(true); limparMensagem();
    enviarLogin(usuario, senha, false);
}

function enviarLogin(usuario, senha, isAutoLogin) {
    fetch(CONFIG.endpoints.login, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        credentials: 'include', body: JSON.stringify({ usuario: usuario, senha: senha })
    })
    .then(function (r) { return r.json(); })
    .then(function (data) {
        if (data.success) {
            if (data.force_reset) {
                setLoadingState(false);
                mostrarForceReset();
            } else {
                tratarLoginSucesso(usuario, senha, isAutoLogin);
            }
        } else { tratarLoginErro(data.error || 'Credenciais invalidas', isAutoLogin); }
    })
    .catch(function () { tratarLoginErro(CONFIG.mensagens.erroConexao, isAutoLogin); });
}

function tratarLoginSucesso(usuario, senha, isAutoLogin) {
    var salvar = Elementos.checkSalvar && Elementos.checkSalvar.checked;
    if (salvar) salvarCredenciais(usuario, senha);
    else if (!isAutoLogin) limparCredenciaisSalvas();
    mostrarSucesso(CONFIG.mensagens.loginSucesso);
    setTimeout(function () { redirecionarAposLogin(); }, CONFIG.delays.redirectAfterLogin);
}

function tratarLoginErro(mensagem, isAutoLogin) {
    setLoadingState(false);
    if (isAutoLogin) {
        limparCredenciaisSalvas();
        mostrarErro('Acesso automatico falhou. Por favor, faca login manualmente.');
        if (Elementos.inputSenha) { Elementos.inputSenha.value = ''; Elementos.inputSenha.focus(); }
    } else {
        mostrarErro(mensagem);
        if (Elementos.inputSenha) { Elementos.inputSenha.focus(); Elementos.inputSenha.select(); }
    }
}

// ==============================================================================
// RESET DE SENHA — NAVEGACAO
// ==============================================================================

function mostrarFormReset() {
    document.getElementById('form-login').style.display = 'none';
    document.getElementById('link-esqueci-senha').parentElement.style.display = 'none';
    document.getElementById('login-footer').style.display = 'none';
    document.getElementById('login-subtitle').textContent = '';
    document.getElementById('reset-step-1').style.display = 'block';
    document.getElementById('reset-step-2').style.display = 'none';
    document.getElementById('reset-step-3').style.display = 'none';
    document.getElementById('force-reset-container').style.display = 'none';
    limparMensagem();
    var inp = document.getElementById('reset-usuario');
    if (inp) { inp.value = ''; inp.focus(); }
}

function voltarParaLogin() {
    document.getElementById('form-login').style.display = 'block';
    document.getElementById('link-esqueci-senha').parentElement.style.display = 'block';
    document.getElementById('login-footer').style.display = 'block';
    document.getElementById('login-subtitle').textContent = 'Faca login para continuar';
    document.getElementById('reset-step-1').style.display = 'none';
    document.getElementById('reset-step-2').style.display = 'none';
    document.getElementById('reset-step-3').style.display = 'none';
    document.getElementById('force-reset-container').style.display = 'none';
    if (ResetState.timerInterval) { clearInterval(ResetState.timerInterval); ResetState.timerInterval = null; }
    limparMensagem();
    if (Elementos.inputUsuario) Elementos.inputUsuario.focus();
}

// ==============================================================================
// RESET — ETAPA 1: Solicitar PIN
// ==============================================================================

function solicitarPinReset() {
    var usuario = document.getElementById('reset-usuario').value.trim();
    if (!usuario) { mostrarAlertaReset(1, 'Informe seu usuario', 'danger'); return; }
    var btn = document.getElementById('btn-enviar-pin');
    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> <span>Enviando...</span>';
    ResetState.usuario = usuario;

    fetch(CONFIG.endpoints.resetSolicitar, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ usuario: usuario })
    })
    .then(function (r) { return r.json(); })
    .then(function (data) {
        btn.disabled = false;
        btn.innerHTML = '<i class="fas fa-paper-plane"></i> <span>Enviar Codigo</span>';
        if (data.success) {
            document.getElementById('reset-email-mascarado').textContent = data.email_mascarado || '***@***';
            document.getElementById('reset-step-1').style.display = 'none';
            document.getElementById('reset-step-2').style.display = 'block';
            limparPinInputs(); iniciarTimerReenvio();
            document.getElementById('pin-1').focus();
        } else {
            mostrarAlertaReset(1, data.error || 'Erro ao enviar codigo', 'danger');
        }
    })
    .catch(function () {
        btn.disabled = false;
        btn.innerHTML = '<i class="fas fa-paper-plane"></i> <span>Enviar Codigo</span>';
        mostrarAlertaReset(1, CONFIG.mensagens.erroConexao, 'danger');
    });
}

// ==============================================================================
// RESET — ETAPA 2: Verificar PIN
// ==============================================================================

function verificarPinReset() {
    var pin = obterPinCompleto();
    if (pin.length !== 4) { mostrarAlertaReset(2, 'Digite os 4 digitos do codigo', 'danger'); marcarPinErro(); return; }
    ResetState.pin = pin;
    var btn = document.getElementById('btn-verificar-pin');
    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> <span>Verificando...</span>';

    fetch(CONFIG.endpoints.resetVerificar, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ usuario: ResetState.usuario, pin: pin })
    })
    .then(function (r) { return r.json(); })
    .then(function (data) {
        btn.disabled = false;
        btn.innerHTML = '<i class="fas fa-check-circle"></i> <span>Verificar Codigo</span>';
        if (data.success) {
            if (ResetState.timerInterval) clearInterval(ResetState.timerInterval);
            document.getElementById('reset-step-2').style.display = 'none';
            document.getElementById('reset-step-3').style.display = 'block';
            document.getElementById('reset-nova-senha').focus();
        } else {
            mostrarAlertaReset(2, data.error || 'Codigo invalido', 'danger'); marcarPinErro();
        }
    })
    .catch(function () {
        btn.disabled = false;
        btn.innerHTML = '<i class="fas fa-check-circle"></i> <span>Verificar Codigo</span>';
        mostrarAlertaReset(2, CONFIG.mensagens.erroConexao, 'danger');
    });
}

// ==============================================================================
// RESET — ETAPA 3: Nova Senha
// ==============================================================================

function confirmarResetSenha() {
    var nova = document.getElementById('reset-nova-senha').value;
    var confirma = document.getElementById('reset-confirma-senha').value;
    if (!nova || !confirma) { mostrarAlertaReset(3, CONFIG.mensagens.camposObrigatorios, 'danger'); return; }
    if (nova !== confirma) { mostrarAlertaReset(3, CONFIG.mensagens.senhasNaoCoincidem, 'danger'); return; }
    if (!validarSenhaForte(nova)) { mostrarAlertaReset(3, CONFIG.mensagens.senhaFraca, 'danger'); return; }

    var btn = document.getElementById('btn-confirmar-reset');
    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> <span>Salvando...</span>';

    fetch(CONFIG.endpoints.resetConfirmar, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ usuario: ResetState.usuario, pin: ResetState.pin, nova_senha: nova })
    })
    .then(function (r) { return r.json(); })
    .then(function (data) {
        btn.disabled = false;
        btn.innerHTML = '<i class="fas fa-save"></i> <span>Alterar Senha</span>';
        if (data.success) {
            mostrarAlertaReset(3, 'Senha alterada com sucesso! Redirecionando...', 'success');
            setTimeout(function () { voltarParaLogin(); }, 2000);
        } else { mostrarAlertaReset(3, data.error || 'Erro ao alterar senha', 'danger'); }
    })
    .catch(function () {
        btn.disabled = false;
        btn.innerHTML = '<i class="fas fa-save"></i> <span>Alterar Senha</span>';
        mostrarAlertaReset(3, CONFIG.mensagens.erroConexao, 'danger');
    });
}

// ==============================================================================
// FORCE RESET
// ==============================================================================

function mostrarForceReset() {
    document.getElementById('form-login').style.display = 'none';
    document.getElementById('link-esqueci-senha').parentElement.style.display = 'none';
    document.getElementById('login-footer').style.display = 'none';
    document.getElementById('login-subtitle').textContent = '';
    document.getElementById('reset-step-1').style.display = 'none';
    document.getElementById('reset-step-2').style.display = 'none';
    document.getElementById('reset-step-3').style.display = 'none';
    document.getElementById('force-reset-container').style.display = 'block';
    document.getElementById('force-nova-senha').focus();
}

function confirmarForceReset() {
    var nova = document.getElementById('force-nova-senha').value;
    var confirma = document.getElementById('force-confirma-senha').value;
    if (!nova || !confirma) { mostrarAlertaId('mensagem-force-reset', CONFIG.mensagens.camposObrigatorios, 'danger'); return; }
    if (nova !== confirma) { mostrarAlertaId('mensagem-force-reset', CONFIG.mensagens.senhasNaoCoincidem, 'danger'); return; }
    if (!validarSenhaForte(nova)) { mostrarAlertaId('mensagem-force-reset', CONFIG.mensagens.senhaFraca, 'danger'); return; }

    var btn = document.getElementById('btn-force-reset');
    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> <span>Salvando...</span>';

    fetch(CONFIG.endpoints.forceReset, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        credentials: 'include', body: JSON.stringify({ nova_senha: nova })
    })
    .then(function (r) { return r.json(); })
    .then(function (data) {
        btn.disabled = false;
        btn.innerHTML = '<i class="fas fa-save"></i> <span>Definir Nova Senha</span>';
        if (data.success) {
            mostrarAlertaId('mensagem-force-reset', 'Senha definida com sucesso! Redirecionando...', 'success');
            setTimeout(function () { redirecionarAposLogin(); }, 1500);
        } else { mostrarAlertaId('mensagem-force-reset', data.error || 'Erro', 'danger'); }
    })
    .catch(function () {
        btn.disabled = false;
        btn.innerHTML = '<i class="fas fa-save"></i> <span>Definir Nova Senha</span>';
        mostrarAlertaId('mensagem-force-reset', CONFIG.mensagens.erroConexao, 'danger');
    });
}

// ==============================================================================
// PIN INPUTS — Auto-advance + comportamento
// ==============================================================================

function configurarPinInputs() {
    for (var i = 1; i <= 4; i++) {
        (function (idx) {
            var inp = document.getElementById('pin-' + idx);
            if (!inp) return;
            inp.addEventListener('input', function () {
                this.value = this.value.replace(/[^0-9]/g, '');
                if (this.value.length === 1) {
                    this.classList.add('filled'); this.classList.remove('error');
                    if (idx < 4) document.getElementById('pin-' + (idx + 1)).focus();
                    else { var pin = obterPinCompleto(); if (pin.length === 4) verificarPinReset(); }
                }
            });
            inp.addEventListener('keydown', function (e) {
                if (e.key === 'Backspace' && !this.value && idx > 1) {
                    var prev = document.getElementById('pin-' + (idx - 1));
                    prev.value = ''; prev.classList.remove('filled'); prev.focus();
                }
            });
            inp.addEventListener('paste', function (e) {
                e.preventDefault();
                var paste = (e.clipboardData || window.clipboardData).getData('text').replace(/[^0-9]/g, '').substring(0, 4);
                for (var j = 0; j < paste.length && j < 4; j++) {
                    var el = document.getElementById('pin-' + (j + 1));
                    el.value = paste[j]; el.classList.add('filled');
                }
                if (paste.length === 4) verificarPinReset();
                else if (paste.length > 0) document.getElementById('pin-' + Math.min(paste.length + 1, 4)).focus();
            });
        })(i);
    }
}

function obterPinCompleto() {
    return (document.getElementById('pin-1').value || '') +
           (document.getElementById('pin-2').value || '') +
           (document.getElementById('pin-3').value || '') +
           (document.getElementById('pin-4').value || '');
}

function limparPinInputs() {
    for (var i = 1; i <= 4; i++) {
        var el = document.getElementById('pin-' + i);
        el.value = ''; el.classList.remove('filled', 'error');
    }
}

function marcarPinErro() {
    for (var i = 1; i <= 4; i++) document.getElementById('pin-' + i).classList.add('error');
}

// ==============================================================================
// TIMER REENVIO
// ==============================================================================

function iniciarTimerReenvio() {
    ResetState.timerSeconds = 60;
    document.getElementById('timer-texto').style.display = 'inline';
    document.getElementById('link-reenviar').style.display = 'none';
    document.getElementById('timer-contagem').textContent = ResetState.timerSeconds;
    if (ResetState.timerInterval) clearInterval(ResetState.timerInterval);
    ResetState.timerInterval = setInterval(function () {
        ResetState.timerSeconds--;
        document.getElementById('timer-contagem').textContent = ResetState.timerSeconds;
        if (ResetState.timerSeconds <= 0) {
            clearInterval(ResetState.timerInterval);
            document.getElementById('timer-texto').style.display = 'none';
            document.getElementById('link-reenviar').style.display = 'inline';
        }
    }, 1000);
}

function reenviarPin() {
    document.getElementById('reset-step-2').style.display = 'none';
    document.getElementById('reset-step-1').style.display = 'block';
    document.getElementById('reset-usuario').value = ResetState.usuario;
    solicitarPinReset();
}

// ==============================================================================
// VALIDACOES
// ==============================================================================

function validarUsuario(u) { return u && u.length >= 3 && u.length <= 50 && /^[a-zA-Z0-9_.]+$/.test(u); }
function validarSenha(s) { return s && s.length >= 4 && s.length <= 128; }
function validarSenhaForte(s) {
    if (!s || s.length < 8) return false;
    return /[A-Z]/.test(s) && /[a-z]/.test(s) && /[0-9]/.test(s) && /[!@#$%^&*(),.?":{}|<>\-_=+\[\]\\;'`~]/.test(s);
}

// ==============================================================================
// UI
// ==============================================================================

function setLoadingState(loading) {
    if (Elementos.btnLogin) {
        Elementos.btnLogin.disabled = loading;
        Elementos.btnLogin.innerHTML = loading
            ? '<i class="fas fa-spinner fa-spin"></i> <span>' + CONFIG.mensagens.entrando + '</span>'
            : '<i class="fas fa-sign-in-alt"></i> <span id="btn-login-texto">Entrar</span>';
    }
    if (Elementos.inputUsuario) Elementos.inputUsuario.disabled = loading;
    if (Elementos.inputSenha) Elementos.inputSenha.disabled = loading;
    if (Elementos.checkSalvar) Elementos.checkSalvar.disabled = loading;
}

function mostrarErro(msg) { _mostrarMsg(Elementos.mensagem, msg, 'alert-danger', 'fa-exclamation-circle'); }
function mostrarSucesso(msg) { _mostrarMsg(Elementos.mensagem, msg, 'alert-success', 'fa-check-circle'); }
function mostrarInfo(msg) { _mostrarMsg(Elementos.mensagem, msg, 'alert-info', 'fa-circle-notch fa-spin'); }
function limparMensagem() { if (Elementos.mensagem) { Elementos.mensagem.style.display = 'none'; Elementos.mensagem.textContent = ''; } }
function marcarCampoErro(campo) { if (campo) { campo.classList.add('error'); campo.focus(); } }

function _mostrarMsg(el, msg, cls, icon) {
    if (!el) return;
    el.innerHTML = '<i class="fas ' + icon + '"></i> ' + escapeHtml(msg);
    el.className = 'alert ' + cls; el.style.display = 'flex';
}

function mostrarAlertaReset(step, msg, tipo) { mostrarAlertaId('mensagem-reset-' + step, msg, tipo); }

function mostrarAlertaId(id, msg, tipo) {
    var el = document.getElementById(id); if (!el) return;
    var icon = tipo === 'success' ? 'fa-check-circle' : 'fa-exclamation-circle';
    el.innerHTML = '<i class="fas ' + icon + '"></i> ' + escapeHtml(msg);
    el.className = 'alert alert-' + (tipo === 'success' ? 'success' : 'danger');
    el.style.display = 'flex';
}

function escapeHtml(t) { if (!t) return ''; var d = document.createElement('div'); d.textContent = t; return d.innerHTML; }

window.addEventListener('beforeunload', function () { if (Elementos.inputSenha) Elementos.inputSenha.value = ''; });
if (window.top !== window.self) { window.top.location = window.self.location; }
