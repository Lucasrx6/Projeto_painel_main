// ========================================
// 📋 PAINEL 5 - CIRURGIAS COM AUTO-SCROLL
// ========================================

const BASE_URL = window.location.origin;

const CONFIG = {
    apiDashboard: `${BASE_URL}/api/paineis/painel5/dashboard`,
    apiCirurgias: `${BASE_URL}/api/paineis/painel5/cirurgias`,
    intervaloRefresh: 30000,
    velocidadeScroll: 0.5,
    delayInicioAutoScroll: 10000,
    pausaAntesReset: 5000,
    pausaAposReset: 10000
};

let dadosCirurgias = [];
let autoScrollAtivo = false;
let intervaloAutoScroll = null;

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
                console.log('▶️ Auto-scroll ATIVADO');
                iniciarAutoScrollTodosGrupos();
            } else {
                btnAutoScroll.classList.remove('active');
                btnAutoScroll.innerHTML = '<i class="fas fa-play"></i> Auto Scroll';
                pararAutoScroll();
                console.log('⏸️ Auto-scroll PAUSADO');
            }
        });
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

            if (!autoScrollAtivo && !intervaloAutoScroll) {
                setTimeout(() => {
                    if (!autoScrollAtivo) {
                        console.log('🚀 Ativando auto-scroll automaticamente após 10s...');
                        const btnAutoScroll = document.getElementById('btn-auto-scroll');
                        if (btnAutoScroll) {
                            autoScrollAtivo = true;
                            btnAutoScroll.classList.add('active');
                            btnAutoScroll.innerHTML = '<i class="fas fa-pause"></i> Pausar';
                            iniciarAutoScrollTodosGrupos();
                        }
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
                                <th>Sala</th>
                                <th>Paciente</th>
                                <th>Cirurgião</th>
                                <th>Cirurgia</th>
                                <th>Previsão</th>
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

function iniciarAutoScrollTodosGrupos() {
    pararAutoScroll();

    const grupos = document.querySelectorAll('.grupo-dia');
    if (grupos.length === 0) {
        console.warn('⚠️ Nenhum grupo encontrado para auto-scroll');
        return;
    }

    let grupoAtualIndex = 0;
    let emPausa = false;

    console.log(`🎬 Iniciando auto-scroll em ${grupos.length} grupo(s)...`);

    intervaloAutoScroll = setInterval(() => {
        if (!autoScrollAtivo) {
            pararAutoScroll();
            return;
        }

        if (emPausa) return;

        const grupoAtual = grupos[grupoAtualIndex];
        if (!grupoAtual) {
            console.warn('⚠️ Grupo atual não encontrado, resetando...');
            grupoAtualIndex = 0;
            return;
        }

        const tbody = grupoAtual.querySelector('.cirurgias-table tbody');
        if (!tbody) {
            console.warn('⚠️ Tbody não encontrado no grupo, pulando...');
            grupoAtualIndex++;
            if (grupoAtualIndex >= grupos.length) grupoAtualIndex = 0;
            return;
        }

        const scrollAtual = tbody.scrollTop;
        const scrollMax = tbody.scrollHeight - tbody.clientHeight;

        if (scrollAtual >= scrollMax - 5) {
            console.log(`🏁 Final do grupo ${grupoAtualIndex + 1}/${grupos.length}`);

            if (grupoAtualIndex === grupos.length - 1) {
                console.log('⏸️ Último grupo - pausando 5s...');
                emPausa = true;

                setTimeout(() => {
                    if (!autoScrollAtivo) {
                        console.log('⚠️ Auto-scroll foi desativado, abortando reset');
                        emPausa = false;
                        return;
                    }

                    console.log('🔄 Resetando todos os grupos para o topo...');
                    grupos.forEach((g, idx) => {
                        const tb = g.querySelector('.cirurgias-table tbody');
                        if (tb) {
                            tb.scrollTop = 0;
                            console.log(`  ↺ Grupo ${idx + 1} resetado`);
                        }
                    });

                    grupoAtualIndex = 0;
                    console.log('⏳ Aguardando 10s antes de recomeçar...');

                    setTimeout(() => {
                        if (autoScrollAtivo) {
                            emPausa = false;
                            console.log('▶️ Reiniciando auto-scroll!');
                        } else {
                            console.log('⚠️ Auto-scroll desativado durante pausa');
                        }
                    }, CONFIG.pausaAposReset);

                }, CONFIG.pausaAntesReset);

            } else {
                grupoAtualIndex++;
                console.log(`➡️ Avançando para grupo ${grupoAtualIndex + 1}/${grupos.length}`);
            }

            return;
        }

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
    const partes = nomeCompleto.trim().toUpperCase().split(/\s+/);
    if (partes.length === 1) return partes[0];
    const iniciais = partes.slice(0, -1).map(parte => parte.charAt(0)).join(' ');
    const ultimoNome = partes[partes.length - 1];
    return `${iniciais} ${ultimoNome}`;
}

function criarLinhaCirurgia(cirurgia) {
    const statusIcon = obterIconeStatus(cirurgia.evento, cirurgia.nr_cirurgia);

    // ✅ DEBUG: Mostra evento recebido
    console.log('Evento:', `"${cirurgia.evento}"`, 'nr_cirurgia:', cirurgia.nr_cirurgia, 'Status:', statusIcon.texto);

    const nomePacienteFormatado = formatarNome(cirurgia.nm_paciente_pf);
    const nomeMedicoFormatado = formatarNome(cirurgia.nm_medico);

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
            <td>
                <div class="previsao-hora">
                    ${cirurgia.previsao_termino || '-'}
                </div>
            </td>
        </tr>
    `;
}

// ========================================
// 🎨 OBTER ÍCONE DE STATUS - LÓGICA CORRIGIDA
// ========================================

function obterIconeStatus(evento, nr_cirurgia) {
    // ✅ REGRA 1: Se não tem nr_cirurgia, é PREVISTO
    if (!nr_cirurgia || nr_cirurgia === null || nr_cirurgia === '' || nr_cirurgia === 'null') {
        return {
            classe: 'status-prevista',
            icone: 'fas fa-calendar-check',
            titulo: 'Previsto',
            texto: 'Previsto'
        };
    }

    // ✅ REGRA 2: Status baseado no evento (EXATO do banco)
    const eventoNormalizado = (evento || '').trim();

    // Status 1: Entrada Paciente CC
    if (eventoNormalizado === 'Entrada Paciente CC') {
        return {
            classe: 'status-entrada-cc',
            icone: 'fas fa-door-open',
            titulo: 'Entrada Paciente CC',
            texto: 'Início'
        };
    }

    // Status 2: Início da Cirurgia
    if (eventoNormalizado === 'Inicio da Cirurgia') {
        return {
            classe: 'status-inicio-cirurgia',
            icone: 'fas fa-procedures',
            titulo: 'Início da Cirurgia',
            texto: 'Início da Cirurgia'
        };
    }

    // Status 3: Entrada no RPA
    if (eventoNormalizado === 'Entrada no RPA') {
        return {
            classe: 'status-entrada-rpa',
            icone: 'fas fa-bed',
            titulo: 'Entrada no RPA',
            texto: 'Término de Cirurgia'
        };
    }

    // ✅ Status 4: Saída do RPA = REALIZADA (com acento)
    if (eventoNormalizado === 'Sáida do RPA' || eventoNormalizado === 'Saida do RPA') {
        return {
            classe: 'status-realizada',
            icone: 'fas fa-check-circle',
            titulo: 'Saída do RPA',
            texto: 'Realizada'
        };
    }

    // ✅ Status 5: Saída do CC = REALIZADA
    if (eventoNormalizado === 'Saida do CC') {
        return {
            classe: 'status-realizada',
            icone: 'fas fa-check-circle',
            titulo: 'Saída do CC',
            texto: 'Realizada'
        };
    }

    // Status 6: Sem Status (default)
    return {
        classe: 'status-sem-status',
        icone: 'fas fa-clock',
        titulo: 'Sem Status',
        texto: 'Aguardando'
    };
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