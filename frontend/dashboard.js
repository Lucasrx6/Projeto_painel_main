/**
 * ==============================================================================
 * DASHBOARD PRINCIPAL - JAVASCRIPT
 * Sistema de Paineis - Hospital Anchieta Ceilandia
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
        permissoes: '/api/minhas-permissoes',
        cadastro: '/api/cadastro'
    },
    painelBase: '/painel/',
    adminUrl: '/admin/usuarios',
    loginUrl: '/login.html',
    mensagens: {
        erroConexao: 'Erro de conexao com o servidor',
        erroAutenticacao: 'Sessao expirada. Redirecionando para login...',
        acessoNegado: 'Voce nao tem permissao para acessar este painel.',
        senhasNaoCoincidem: 'As senhas nao coincidem',
        senhaFraca: 'A senha deve ter no minimo 8 caracteres com maiuscula, minuscula, numero e caractere especial',
        usuarioCriado: 'Usuario cadastrado com sucesso!'
    }
};

// ==============================================================================
// ESTADO DA APLICACAO
// ==============================================================================

var Estado = {
    usuarioAtual: null,
    permissoes: [],
    isAdmin: false,
    paineis: [
        'painel2', 'painel3', 'painel4', 'painel5', 'painel6', 'painel7',
        'painel8', 'painel9', 'painel10', 'painel11', 'painel12', 'painel13'
    ]
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

        Estado.usuarioAtual = data;
        Estado.isAdmin = data.is_admin || false;
        
        atualizarNomeUsuario(data.usuario);
        mostrarBotoesAdmin(Estado.isAdmin);
        
        carregarPermissoes();
    })
    .catch(function(erro) {
        console.error('[AUTH] Erro ao verificar autenticacao:', erro);
        redirecionarLogin();
    });
}

function redirecionarLogin() {
    window.location.href = CONFIG.loginUrl;
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

function atualizarNomeUsuario(nome) {
    var elemento = document.getElementById('usuario-nome');
    if (elemento) {
        elemento.textContent = 'Ola, ' + escapeHtml(nome);
    }
}

function mostrarBotoesAdmin(isAdmin) {
    var btnGestao = document.getElementById('btn-gestao-usuarios');
    var btnAdmin = document.getElementById('btn-admin');
    
    if (btnGestao) {
        btnGestao.style.display = isAdmin ? 'inline-flex' : 'none';
    }
    
    if (btnAdmin) {
        btnAdmin.style.display = isAdmin ? 'inline-flex' : 'none';
    }
}

// ==============================================================================
// PERMISSOES
// ==============================================================================

function carregarPermissoes() {
    fetch(CONFIG.endpoints.permissoes, {
        method: 'GET',
        credentials: 'include'
    })
    .then(function(response) {
        return response.json();
    })
    .then(function(data) {
        if (data.success) {
            Estado.permissoes = data.permissoes || [];
            
            // Admin tem acesso a todos os paineis
            if (data.is_admin || Estado.isAdmin) {
                Estado.isAdmin = true;
                mostrarTodosPaineis();
            } else {
                filtrarPaineisVisiveis();
            }
        } else {
            console.error('[PERM] Erro ao carregar permissoes:', data.error);
            filtrarPaineisVisiveis();
        }
    })
    .catch(function(erro) {
        console.error('[PERM] Erro ao carregar permissoes:', erro);
        filtrarPaineisVisiveis();
    });
}

function mostrarTodosPaineis() {
    Estado.paineis.forEach(function(painelNome) {
        var card = document.querySelector('[data-painel="' + painelNome + '"]');
        if (card) {
            card.style.display = 'flex';
            card.classList.remove('painel-disabled');
        }
    });
    
    removerMensagemSemPaineis();
    console.log('[PERM] Admin: Todos os paineis liberados');
}

function filtrarPaineisVisiveis() {
    var paineisVisiveis = 0;
    
    Estado.paineis.forEach(function(painelNome) {
        var card = document.querySelector('[data-painel="' + painelNome + '"]');
        if (!card) return;
        
        var temPermissao = Estado.permissoes.indexOf(painelNome) !== -1;
        
        if (temPermissao) {
            card.style.display = 'flex';
            card.classList.remove('painel-disabled');
            paineisVisiveis++;
        } else {
            card.style.display = 'none';
        }
    });
    
    gerenciarMensagemSemPaineis(paineisVisiveis);
}

function gerenciarMensagemSemPaineis(quantidade) {
    var grid = document.querySelector('.paineis-grid');
    var mensagemExistente = document.getElementById('mensagem-sem-paineis');
    
    if (quantidade === 0) {
        if (!mensagemExistente && grid) {
            var mensagem = document.createElement('div');
            mensagem.id = 'mensagem-sem-paineis';
            mensagem.className = 'mensagem-sem-paineis';
            mensagem.setAttribute('role', 'status');
            mensagem.innerHTML = 
                '<div class="sem-paineis-icon" aria-hidden="true">' +
                    '<i class="fas fa-lock"></i>' +
                '</div>' +
                '<h2>Nenhum Painel Disponivel</h2>' +
                '<p>Voce ainda nao tem permissao para acessar nenhum painel.</p>' +
                '<p>Entre em contato com o administrador para solicitar acesso.</p>';
            grid.appendChild(mensagem);
        }
    } else {
        removerMensagemSemPaineis();
    }
}

function removerMensagemSemPaineis() {
    var mensagemExistente = document.getElementById('mensagem-sem-paineis');
    if (mensagemExistente) {
        mensagemExistente.remove();
    }
}

// ==============================================================================
// NAVEGACAO DE PAINEIS
// ==============================================================================

function abrirPainel(nomePainel) {
    if (!nomePainel) {
        console.warn('[NAV] Nome do painel nao especificado');
        return;
    }
    
    // Valida nome do painel
    if (Estado.paineis.indexOf(nomePainel) === -1) {
        console.warn('[NAV] Painel invalido:', nomePainel);
        return;
    }
    
    // Admin sempre pode acessar
    if (Estado.isAdmin) {
        navegarParaPainel(nomePainel);
        return;
    }
    
    // Verifica permissao
    if (Estado.permissoes.indexOf(nomePainel) === -1) {
        alert(CONFIG.mensagens.acessoNegado);
        return;
    }
    
    navegarParaPainel(nomePainel);
}

function navegarParaPainel(nomePainel) {
    window.location.href = CONFIG.painelBase + nomePainel;
}

// ==============================================================================
// CONFIGURACAO DE EVENTOS
// ==============================================================================

function configurarEventos() {
    // Logout
    var btnLogout = document.getElementById('btn-logout');
    if (btnLogout) {
        btnLogout.addEventListener('click', realizarLogout);
    }
    
    // Gestao de usuarios
    var btnGestao = document.getElementById('btn-gestao-usuarios');
    if (btnGestao) {
        btnGestao.addEventListener('click', function() {
            window.location.href = CONFIG.adminUrl;
        });
    }
    
    // Abrir modal de cadastro
    var btnAdmin = document.getElementById('btn-admin');
    if (btnAdmin) {
        btnAdmin.addEventListener('click', abrirModalCadastro);
    }
    
    // Fechar modal
    var btnFechar = document.getElementById('btn-fechar-modal');
    if (btnFechar) {
        btnFechar.addEventListener('click', fecharModalCadastro);
    }
    
    var btnCancelar = document.getElementById('btn-cancelar-cadastro');
    if (btnCancelar) {
        btnCancelar.addEventListener('click', fecharModalCadastro);
    }
    
    // Formulario de cadastro
    var formCadastro = document.getElementById('form-cadastro');
    if (formCadastro) {
        formCadastro.addEventListener('submit', cadastrarUsuario);
    }
    
    // Eventos dos cards de painel
    configurarEventosPaineis();
    
    // Fechar modal com ESC
    document.addEventListener('keydown', function(e) {
        if (e.key === 'Escape') {
            fecharModalCadastro();
        }
    });
    
    // Fechar modal clicando fora
    var modal = document.getElementById('modal-cadastro');
    if (modal) {
        modal.addEventListener('click', function(e) {
            if (e.target === modal) {
                fecharModalCadastro();
            }
        });
    }
}

function configurarEventosPaineis() {
    var cards = document.querySelectorAll('.painel-card');
    
    cards.forEach(function(card) {
        // Click
        card.addEventListener('click', function() {
            var painelNome = card.getAttribute('data-painel');
            abrirPainel(painelNome);
        });
        
        // Enter/Space para acessibilidade
        card.addEventListener('keydown', function(e) {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                var painelNome = card.getAttribute('data-painel');
                abrirPainel(painelNome);
            }
        });
    });
}

// ==============================================================================
// MODAL DE CADASTRO
// ==============================================================================

function abrirModalCadastro() {
    var modal = document.getElementById('modal-cadastro');
    var form = document.getElementById('form-cadastro');
    
    if (form) {
        form.reset();
    }
    
    ocultarMensagem('mensagem-cadastro');
    
    if (modal) {
        modal.style.display = 'flex';
        modal.classList.add('show');
        document.body.style.overflow = 'hidden';
        
        // Focus no primeiro campo
        var inputUsuario = document.getElementById('novo-usuario');
        if (inputUsuario) {
            setTimeout(function() {
                inputUsuario.focus();
            }, 100);
        }
    }
}

function fecharModalCadastro() {
    var modal = document.getElementById('modal-cadastro');
    
    if (modal) {
        modal.style.display = 'none';
        modal.classList.remove('show');
        document.body.style.overflow = '';
    }
}

function cadastrarUsuario(e) {
    e.preventDefault();
    
    var usuario = document.getElementById('novo-usuario').value.trim();
    var email = document.getElementById('novo-email').value.trim();
    var senha = document.getElementById('nova-senha').value;
    var confirmaSenha = document.getElementById('confirma-senha').value;
    var isAdmin = document.getElementById('is-admin').checked;
    
    // Validacoes
    if (!validarUsuario(usuario)) {
        mostrarMensagemCadastro('Nome de usuario invalido. Use apenas letras, numeros, underscore e ponto.', 'danger');
        return;
    }
    
    if (!validarEmail(email)) {
        mostrarMensagemCadastro('Email invalido.', 'danger');
        return;
    }
    
    if (senha !== confirmaSenha) {
        mostrarMensagemCadastro(CONFIG.mensagens.senhasNaoCoincidem, 'danger');
        return;
    }
    
    if (!validarSenhaForte(senha)) {
        mostrarMensagemCadastro(CONFIG.mensagens.senhaFraca, 'danger');
        return;
    }
    
    var btnEnviar = document.getElementById('btn-enviar-cadastro');
    if (btnEnviar) {
        btnEnviar.disabled = true;
    }
    
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
            mostrarMensagemCadastro(CONFIG.mensagens.usuarioCriado, 'success');
            
            setTimeout(function() {
                fecharModalCadastro();
                if (btnEnviar) btnEnviar.disabled = false;
            }, 2000);
        } else {
            mostrarMensagemCadastro(data.error || 'Erro ao cadastrar usuario', 'danger');
            if (btnEnviar) btnEnviar.disabled = false;
        }
    })
    .catch(function(erro) {
        console.error('[CADASTRO] Erro:', erro);
        mostrarMensagemCadastro(CONFIG.mensagens.erroConexao, 'danger');
        if (btnEnviar) btnEnviar.disabled = false;
    });
}

function mostrarMensagemCadastro(mensagem, tipo) {
    var elemento = document.getElementById('mensagem-cadastro');
    if (!elemento) return;
    
    var icone = '';
    if (tipo === 'success') icone = '<i class="fas fa-check-circle" aria-hidden="true"></i>';
    else if (tipo === 'danger') icone = '<i class="fas fa-exclamation-circle" aria-hidden="true"></i>';
    
    elemento.innerHTML = icone + ' ' + escapeHtml(mensagem);
    elemento.className = 'alert alert-' + tipo;
    elemento.style.display = 'flex';
    
    if (tipo === 'success') {
        setTimeout(function() {
            ocultarMensagem('mensagem-cadastro');
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
// UTILITARIOS
// ==============================================================================

function escapeHtml(texto) {
    if (!texto) return '';
    
    var div = document.createElement('div');
    div.textContent = texto;
    return div.innerHTML;
}

// ==============================================================================
// FUNCOES GLOBAIS (para compatibilidade com onclick inline se necessario)
// ==============================================================================

window.abrirPainel = abrirPainel;
window.fecharModal = fecharModalCadastro;