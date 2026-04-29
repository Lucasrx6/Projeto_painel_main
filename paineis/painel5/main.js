// ========================================
// 📋 PAINEL 5 - CIRURGIAS COM AUTO-SCROLL
// ========================================

const BASE_URL = window.location.origin;

const CONFIG = {
    apiDashboard: `${BASE_URL}/api/paineis/painel5/dashboard`,
    apiCirurgias: `${BASE_URL}/api/paineis/painel5/cirurgias`,
    intervaloRefresh: 130000,
    velocidadeScroll: 0.5,
    delayInicioAutoScroll: 10000,
    pausaFinal: 10000,
    pausaAposReset: 10000
};

let dadosCirurgias = [];
let autoScrollAtivo = false;
let intervaloAutoScroll = null;
let timeoutAutoScrollInicial = null;

// Preferência de privacidade persistida em localStorage
// true = nomes abreviados (LGPD, padrão seguro) | false = nomes completos (uso interno CC)
let nomesAbreviados = localStorage.getItem('painel5_nomes_abreviados') !== 'false';

function inicializar() {
    console.log('🚀 Inicializando Painel de Cirurgias...');
    configurarBotoes();
    carregarDados();
    setInterval(carregarDados, CONFIG.intervaloRefresh);
    console.log('✅ Painel inicializado!');
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', inicializar);
} else {
    inicializar();
}

function configurarBotoes() {
    const btnVoltar = document.getElementById('btn-voltar');
    if (btnVoltar) {
        btnVoltar.addEventListener('click', () => {
            window.location.href = '/frontend/dashboard.html';
        });
    }

    const btnRefresh = document.getElementById('btn-refresh');
    if (btnRefresh) {
        btnRefresh.addEventListener('click', () => {
            carregarDados();
        });
    }

    const btnAutoScroll = document.getElementById('btn-auto-scroll');
    if (btnAutoScroll) {
        btnAutoScroll.addEventListener('click', () => {
            autoScrollAtivo = !autoScrollAtivo;
            if (autoScrollAtivo) {
                btnAutoScroll.classList.add('active');
                btnAutoScroll.innerHTML = '<i class="fas fa-pause"></i> Pausar';
                iniciarAutoScroll();
            } else {
                btnAutoScroll.classList.remove('active');
                btnAutoScroll.innerHTML = '<i class="fas fa-play"></i> Auto Scroll';
                pararAutoScroll();
            }
        });
    }

    configurarBtnPrivacidade();
}

function configurarBtnPrivacidade() {
    const btn = document.getElementById('btn-privacidade');
    if (!btn) return;

    atualizarBotaoPrivacidade(btn);

    btn.addEventListener('click', () => {
        nomesAbreviados = !nomesAbreviados;
        localStorage.setItem('painel5_nomes_abreviados', nomesAbreviados ? 'true' : 'false');
        atualizarBotaoPrivacidade(btn);

        if (dadosCirurgias.length > 0) {
            const scrollAtivo = autoScrollAtivo;
            renderizarCirurgias(dadosCirurgias);
            // Reinicia auto-scroll caso estivesse ativo (novo DOM gerado)
            if (scrollAtivo) iniciarAutoScroll();
        }
    });
}

function atualizarBotaoPrivacidade(btn) {
    if (nomesAbreviados) {
        btn.classList.add('active');
        btn.innerHTML = '<i class="fas fa-user-shield"></i> LGPD';
        btn.title = 'LGPD ativo: nomes abreviados — clique para mostrar nomes completos (uso interno CC)';
    } else {
        btn.classList.remove('active');
        btn.innerHTML = '<i class="fas fa-user"></i> Nome';
        btn.title = 'Nomes completos visíveis — clique para ativar proteção LGPD';
    }
}

async function carregarDados() {
    try {
        console.log('🔄 Carregando dados...');

        const [dashboardRes, cirurgiasRes] = await Promise.all([
            fetch(CONFIG.apiDashboard),
            fetch(CONFIG.apiCirurgias)
        ]);

        if (!dashboardRes.ok || !cirurgiasRes.ok) {
            throw new Error('Erro ao carregar dados');
        }

        const dashboardData = await dashboardRes.json();
        const cirurgiasData = await cirurgiasRes.json();

        if (dashboardData.success && cirurgiasData.success) {
            atualizarDashboard(dashboardData.data);
            dadosCirurgias = cirurgiasData.data;
            renderizarCirurgias(dadosCirurgias);
            atualizarHoraAtualizacao();

            // ✅ Ativa auto-scroll automaticamente após 10s (apenas na primeira vez)
            if (!autoScrollAtivo && timeoutAutoScrollInicial === null) {
                timeoutAutoScrollInicial = setTimeout(() => {
                    console.log('🚀 Ativando auto-scroll automaticamente após 10s...');
                    const btnAutoScroll = document.getElementById('btn-auto-scroll');
                    if (btnAutoScroll) {
                        autoScrollAtivo = true;
                        btnAutoScroll.classList.add('active');
                        btnAutoScroll.innerHTML = '<i class="fas fa-pause"></i> Pausar';
                        iniciarAutoScroll();
                    }
                }, CONFIG.delayInicioAutoScroll);
            }

            console.log('✅ Dados carregados!');
        } else {
            console.error('Erro nos dados:', dashboardData, cirurgiasData);
            mostrarErro('Erro ao processar dados');
        }
    } catch (erro) {
        console.error('❌ Erro:', erro);
        mostrarErro('Erro de conexão');
    }
}

function atualizarDashboard(dados) {
    document.getElementById('total-cirurgias').textContent = parseInt(dados.total_cirurgias) || 0;
    document.getElementById('cirurgias-previstas').textContent = parseInt(dados.cirurgias_previstas) || 0;
    document.getElementById('cirurgias-andamento').textContent = parseInt(dados.cirurgias_andamento) || 0;
    document.getElementById('cirurgias-realizadas').textContent = parseInt(dados.cirurgias_realizadas) || 0;
}

function renderizarCirurgias(gruposDia) {
    const container = document.getElementById('cirurgias-content');

    if (!gruposDia || gruposDia.length === 0) {
        container.innerHTML = `
            <div class="empty-message">
                <i class="fas fa-calendar-times"></i>
                <h3>Nenhuma cirurgia agendada</h3>
                <p>Não há cirurgias previstas para este período</p>
            </div>
        `;
        return;
    }

    let html = '';

    gruposDia.forEach(grupo => {
        const cirurgias = grupo.cirurgias || [];

        html += `
            <div class="grupo-dia">
                <div class="grupo-dia-header">
                    <i class="fas fa-calendar-day"></i>
                    <span>${grupo.grupo || grupo.data}</span>
                    <span class="grupo-dia-badge">${cirurgias.length}</span>
                </div>
                <div class="cirurgias-table-wrapper">
                    <table class="cirurgias-table">
                        <thead>
                            <tr>
                                <th>Status</th>
                                <th>Previsão</th>
                                <th>Início</th>
                                <th>Tempo</th>
                                <th>Sala</th>
                                <th>Paciente</th>
                                <th>Cirurgião</th>
                                <th>Cirurgia</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${cirurgias.map(c => criarLinhaCirurgia(c)).join('')}
                        </tbody>
                    </table>
                </div>
            </div>
        `;
    });

    container.innerHTML = html;
    ajustarAlturaTabelasDinamicamente();
}

function ajustarAlturaTabelasDinamicamente() {
    const container = document.getElementById('cirurgias-content');
    const grupos = container.querySelectorAll('.grupo-dia');

    if (grupos.length === 0) return;

    const containerHeight = container.clientHeight;
    const totalGaps = (grupos.length - 1) * 10;
    const espacoDisponivel = containerHeight - totalGaps;
    const alturaPorGrupo = espacoDisponivel / grupos.length;

    grupos.forEach(grupo => {
        const header = grupo.querySelector('.grupo-dia-header');
        const wrapper = grupo.querySelector('.cirurgias-table-wrapper');
        const thead = grupo.querySelector('.cirurgias-table thead');

        if (!header || !wrapper || !thead) return;

        const headerHeight = header.offsetHeight;
        const theadHeight = thead.offsetHeight;
        const alturaParaTbody = alturaPorGrupo - headerHeight - theadHeight - 4;

        const tbody = grupo.querySelector('.cirurgias-table tbody');
        if (tbody) {
            tbody.style.maxHeight = `${alturaParaTbody}px`;
            tbody.style.display = 'block';
            tbody.style.overflowY = 'auto';
            tbody.style.overflowX = 'hidden';
        }
    });
}

window.addEventListener('resize', () => {
    if (dadosCirurgias.length > 0) {
        setTimeout(ajustarAlturaTabelasDinamicamente, 100);
    }
});

// ========================================
// 🎬 AUTO-SCROLL SIMPLIFICADO E CORRIGIDO
// ========================================

function iniciarAutoScroll() {
    pararAutoScroll();

    const grupos = document.querySelectorAll('.grupo-dia');
    if (grupos.length === 0) {
        console.warn('⚠️ Nenhum grupo encontrado para auto-scroll');
        return;
    }

    let grupoAtualIndex = 0;
    console.log(`🎬 Iniciando auto-scroll em ${grupos.length} grupo(s)...`);

    intervaloAutoScroll = setInterval(() => {
        if (!autoScrollAtivo) {
            pararAutoScroll();
            return;
        }

        const grupoAtual = grupos[grupoAtualIndex];
        if (!grupoAtual) {
            console.warn('⚠️ Grupo não encontrado');
            return;
        }

        const tbody = grupoAtual.querySelector('.cirurgias-table tbody');
        if (!tbody) {
            console.warn('⚠️ Tbody não encontrado');
            return;
        }

        const scrollAtual = tbody.scrollTop;
        const scrollMax = tbody.scrollHeight - tbody.clientHeight;

        // ✅ Se não tem scroll (conteúdo cabe na tela), pula para próximo grupo
        if (scrollMax <= 0) {
            console.log(`⏭️ Grupo ${grupoAtualIndex + 1} não precisa de scroll, avançando...`);
            grupoAtualIndex++;

            if (grupoAtualIndex >= grupos.length) {
                console.log('🏁 Final de todos os grupos - iniciando ciclo de reset');
                pararAutoScroll();

                setTimeout(() => {
                    if (!autoScrollAtivo) return;

                    console.log('🔄 Voltando ao topo...');
                    grupos.forEach((g, idx) => {
                        const tb = g.querySelector('.cirurgias-table tbody');
                        if (tb) tb.scrollTop = 0;
                    });

                    console.log('⏳ Aguardando 10s para recomeçar...');
                    setTimeout(() => {
                        if (autoScrollAtivo) {
                            console.log('▶️ Reiniciando auto-scroll!');
                            iniciarAutoScroll();
                        }
                    }, CONFIG.pausaAposReset);

                }, CONFIG.pausaFinal);
            }
            return;
        }

        // ✅ Verifica se chegou ao final do grupo atual
        if (scrollAtual >= scrollMax - 1) {
            grupoAtualIndex++;
            console.log(`✅ Grupo ${grupoAtualIndex}/${grupos.length} concluído`);

            // ✅ Se chegou no final de todos os grupos
            if (grupoAtualIndex >= grupos.length) {
                console.log('🏁 Final de todos os grupos - iniciando ciclo de reset');
                pararAutoScroll();

                setTimeout(() => {
                    if (!autoScrollAtivo) {
                        console.log('⚠️ Auto-scroll foi desativado durante pausa');
                        return;
                    }

                    console.log('🔄 Voltando ao topo de todos os grupos...');

                    grupos.forEach((g, idx) => {
                        const tb = g.querySelector('.cirurgias-table tbody');
                        if (tb) {
                            tb.scrollTop = 0;
                            console.log(`  ↺ Grupo ${idx + 1} resetado`);
                        }
                    });

                    console.log('⏳ Aguardando 10s para recomeçar...');
                    setTimeout(() => {
                        if (autoScrollAtivo) {
                            console.log('▶️ Reiniciando auto-scroll!');
                            iniciarAutoScroll();
                        } else {
                            console.log('⚠️ Auto-scroll foi desativado');
                        }
                    }, CONFIG.pausaAposReset);

                }, CONFIG.pausaFinal);
            }
            return;
        }

        // ✅ Scroll normal
        tbody.scrollTop += CONFIG.velocidadeScroll;

    }, 50);
}

function pararAutoScroll() {
    if (intervaloAutoScroll) {
        clearInterval(intervaloAutoScroll);
        intervaloAutoScroll = null;
        console.log('🛑 Auto-scroll parado');
    }
}

function formatarNome(nomeCompleto) {
    if (!nomeCompleto || nomeCompleto.trim() === '') return '-';
    const nome = nomeCompleto.trim().toUpperCase();
    if (!nomesAbreviados) return nome;
    const partes = nome.split(/\s+/);
    if (partes.length === 1) return partes[0];
    const iniciais = partes.slice(0, -1).map(parte => parte.charAt(0)).join(' ');
    const ultimoNome = partes[partes.length - 1];
    return `${iniciais} ${ultimoNome}`;
}

// ========================================
// 🆕 FUNÇÕES AUXILIARES PARA NOVOS CAMPOS
// ========================================

function formatarInicioCirurgia(inicio_cirurgia) {
    if (!inicio_cirurgia || inicio_cirurgia === 'null' || inicio_cirurgia.trim() === '') {
        return '-';
    }

    // Formato vem como: "18/01/2026 00:49:38"
    // Vamos exibir apenas a hora: "00:49"
    const partes = inicio_cirurgia.split(' ');
    if (partes.length >= 2) {
        const hora = partes[1].substring(0, 5); // Pega apenas HH:MM
        return hora;
    }

    return '-';
}

function formatarTempo(tempo) {
    if (!tempo || tempo === '::' || tempo === 'null' || tempo.trim() === '') {
        return '-';
    }

    // Formato vem como: "2:30:15" (HH:MM:SS)
    // Vamos exibir no formato mais legível
    const partes = tempo.split(':');
    if (partes.length === 3) {
        const horas = parseInt(partes[0]) || 0;
        const minutos = parseInt(partes[1]) || 0;

        if (horas > 0) {
            return `${horas}h ${minutos}m`;
        } else {
            return `${minutos}m`;
        }
    }

    return tempo;
}

function criarLinhaCirurgia(cirurgia) {
    const statusIcon = obterIconeStatus(cirurgia.evento_codigo, cirurgia.nr_cirurgia);
    const nomePacienteFormatado = formatarNome(cirurgia.nm_paciente_pf);
    const nomeMedicoFormatado = formatarNome(cirurgia.nm_medico);

    // Formatar novos campos
    const inicioFormatado = formatarInicioCirurgia(cirurgia.inicio_cirurgia);
    const tempoFormatado = formatarTempo(cirurgia.tempo);

    return `
        <tr>
            <td>
                <div class="status-container">
                    <div class="status-icon ${statusIcon.classe}" title="${statusIcon.titulo}">
                        <i class="${statusIcon.icone}"></i>
                    </div>
                    <div class="status-texto">${statusIcon.texto}</div>
                </div>
            </td>
            <td>
                <div class="previsao-hora">
                    ${cirurgia.previsao_termino || '-'}
                </div>
            </td>
            <td>
                <div class="inicio-cirurgia" title="${cirurgia.inicio_cirurgia || 'Não iniciada'}">
                    <i class="fas fa-play-circle"></i> ${inicioFormatado}
                </div>
            </td>
            <td>
                <div class="tempo-cirurgia ${cirurgia.cirurgia_em_andamento ? 'tempo-ativo' : ''}"
                     title="Tempo decorrido">
                    <i class="fas fa-hourglass-half"></i> ${tempoFormatado}
                </div>
            </td>
            <td>
                <span class="badge-sala" title="${cirurgia.setor_cirurgia || '-'}">
                    ${cirurgia.setor_cirurgia || '-'}
                </span>
            </td>
            <td>
                <div class="paciente-nome" title="${cirurgia.nm_paciente_pf || '-'}">
                    ${nomePacienteFormatado}
                </div>
                <span class="paciente-info" title="${cirurgia.ds_convenio || '-'} • ${cirurgia.ds_idade_abrev || '-'}">
                    ${cirurgia.ds_convenio || '-'} • ${cirurgia.ds_idade_abrev || '-'}
                </span>
            </td>
            <td>
                <div class="medico-nome" title="${cirurgia.nm_medico || '-'}">
                    ${nomeMedicoFormatado}
                </div>
            </td>
            <td>
                <div class="cirurgia-desc" title="${cirurgia.ds_proc_cir || '-'}">
                    ${cirurgia.ds_proc_cir || '-'}
                </div>
            </td>
        </tr>
    `;
}

// ========================================
//  FUNÇÃO DE STATUS
// ========================================

function obterIconeStatus(eventoCodigo, nr_cirurgia) {
    //  Se não tem cirurgia registrada, está prevista
    if (!nr_cirurgia || nr_cirurgia === null || nr_cirurgia === '' || nr_cirurgia === 'null') {
        return {
            classe: 'status-prevista',
            icone: 'fas fa-calendar-check',
            titulo: 'Cirurgia Prevista',
            texto: 'Previsto'
        };
    }

    //  Converte para número inteiro
    const codigo = parseInt(eventoCodigo);

    //  Se não é número válido, retorna status padrão
    if (isNaN(codigo)) {
        return {
            classe: 'status-sem-status',
            icone: 'fas fa-clock',
            titulo: 'Aguardando Status',
            texto: 'Aguardando'
        };
    }

    // Retorna o status baseado no código do evento
    switch (codigo) {
        case 12: // Entrada Paciente CC
            return {
                classe: 'status-entrada-cc',
                icone: 'fas fa-door-open',
                titulo: 'Entrada Paciente no Centro Cirúrgico',
                texto: 'Entrada CC'
            };

        case 13: // Início da Cirurgia
            return {
                classe: 'status-inicio-cirurgia',
                icone: 'fas fa-procedures',
                titulo: 'Cirurgia em Andamento',
                texto: 'Em Cirurgia'
            };

        case 14: // Entrada no RPA
            return {
                classe: 'status-entrada-rpa',
                icone: 'fas fa-bed',
                titulo: 'Paciente na Recuperação Pós-Anestésica',
                texto: 'RPA'
            };

        case 15: // Saída do RPA
            return {
                classe: 'status-realizada',
                icone: 'fas fa-check-circle',
                titulo: 'Saída da Recuperação',
                texto: 'Saída RPA'
            };

        case 16: // Saída do CC
            return {
                classe: 'status-realizada',
                icone: 'fas fa-check-circle',
                titulo: 'Cirurgia Concluída',
                texto: 'Concluída'
            };

        default: // Código desconhecido
            return {
                classe: 'status-sem-status',
                icone: 'fas fa-question-circle',
                titulo: `Status Desconhecido (Código: ${codigo})`,
                texto: 'Indefinido'
            };
    }
}

function atualizarHoraAtualizacao() {
    const agora = new Date();
    const hora = agora.toLocaleTimeString('pt-BR', {
        hour: '2-digit',
        minute: '2-digit'
    });

    const elemento = document.querySelector('.ultima-atualizacao');
    if (elemento) {
        elemento.textContent = hora;
    }
}

function mostrarErro(mensagem) {
    console.error('❌', mensagem);

    const container = document.getElementById('cirurgias-content');
    container.innerHTML = `
        <div class="empty-message">
            <i class="fas fa-exclamation-triangle" style="color: #dc3545;"></i>
            <h3>Erro ao Carregar Dados</h3>
            <p>${mensagem}</p>
            <button onclick="carregarDados()" style="
                margin-top: 15px;
                padding: 10px 20px;
                background: #dc3545;
                color: white;
                border: none;
                border-radius: 8px;
                cursor: pointer;
                font-size: 0.9rem;
                font-weight: 600;
                transition: all 0.3s ease;
            " onmouseover="this.style.transform='translateY(-2px)'"
               onmouseout="this.style.transform='translateY(0)'">
                <i class="fas fa-sync-alt"></i> Tentar Novamente
            </button>
        </div>
    `;
}