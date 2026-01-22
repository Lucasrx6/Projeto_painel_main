// ========================================
// PAINEL 13 - PRESCRIÇÕES DE NUTRIÇÃO COM AUTO-SCROLL
// ========================================

const BASE_URL = window.location.origin;

const CONFIG = {
    apiNutricao: `${BASE_URL}/api/paineis/painel13/nutricao`,
    apiSetores: `${BASE_URL}/api/paineis/painel13/setores`,
    apiStats: `${BASE_URL}/api/paineis/painel13/stats`,
    intervaloRefresh: 195000,
    velocidadeScroll: 0.5,
    delayInicioAutoScroll: 10000,
    pausaFinal: 10000,
    pausaAposReset: 10000,
    watchdogInterval: 5000
};

let dadosNutricao = [];
let setores = [];
let autoScrollAtivo = false;
let intervaloAutoScroll = null;
let intervaloWatchdog = null;
let timeoutAutoScrollInicial = null;
let setorSelecionado = localStorage.getItem('painel13_setor') || '';
let ultimaPosicaoScroll = 0;
let contadorTravamento = 0;

function inicializar() {
    console.log('🚀 Inicializando Painel de Nutrição...');
    configurarBotoes();
    carregarSetores();
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
                console.log('▶️ Auto-scroll ATIVADO manualmente');
                iniciarAutoScroll();
            } else {
                btnAutoScroll.classList.remove('active');
                btnAutoScroll.innerHTML = '<i class="fas fa-play"></i> Auto Scroll';
                pararAutoScroll();
                console.log('⏸️ Auto-scroll PAUSADO');
            }
        });
    }

    const filtroSetor = document.getElementById('filtro-setor');
    if (filtroSetor) {
        filtroSetor.addEventListener('change', (e) => {
            setorSelecionado = e.target.value;
            localStorage.setItem('painel13_setor', setorSelecionado);
            carregarDados();
        });
    }
}

async function carregarSetores() {
    try {
        const res = await fetch(CONFIG.apiSetores);
        const data = await res.json();

        if (data.success) {
            setores = data.setores;
            popularSelectSetores();
            carregarDados();
        }
    } catch (erro) {
        console.error('❌ Erro ao carregar setores:', erro);
    }
}

function popularSelectSetores() {
    const select = document.getElementById('filtro-setor');
    select.innerHTML = '<option value="">Todos os Setores</option>';

    setores.forEach(setor => {
        const option = document.createElement('option');
        option.value = setor.setor;
        option.textContent = setor.setor;
        if (setor.setor === setorSelecionado) {
            option.selected = true;
        }
        select.appendChild(option);
    });
}

async function carregarDados() {
    try {
        console.log('🔄 Carregando dados...');

        const scrollEstaAtivo = autoScrollAtivo;
        if (scrollEstaAtivo) {
            console.log('⏸️ Pausando scroll durante atualização...');
            pararAutoScroll();
        }

        let url = CONFIG.apiNutricao;
        if (setorSelecionado) {
            url += `?setor=${encodeURIComponent(setorSelecionado)}`;
        }

        const [nutricaoRes, statsRes] = await Promise.all([
            fetch(url),
            setorSelecionado ? fetch(`${CONFIG.apiStats}?setor=${encodeURIComponent(setorSelecionado)}`) : fetch(CONFIG.apiStats)
        ]);

        if (!nutricaoRes.ok) {
            throw new Error('Erro ao carregar dados');
        }

        const nutricaoData = await nutricaoRes.json();
        const statsData = statsRes ? await statsRes.json() : null;

        if (nutricaoData.success) {
            dadosNutricao = nutricaoData.data;
            renderizarTabela(dadosNutricao);
            atualizarHoraAtualizacao();

            if (statsData && statsData.success && statsData.stats) {
                atualizarDashboard(statsData.stats);
            }

            if (scrollEstaAtivo) {
                setTimeout(() => {
                    console.log('▶️ Retomando scroll após atualização...');
                    autoScrollAtivo = true;
                    const btnAutoScroll = document.getElementById('btn-auto-scroll');
                    if (btnAutoScroll) {
                        btnAutoScroll.classList.add('active');
                        btnAutoScroll.innerHTML = '<i class="fas fa-pause"></i> Pausar';
                    }
                    iniciarAutoScroll();
                }, 500);
            }

            if (!scrollEstaAtivo && timeoutAutoScrollInicial === null) {
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
            console.error('Erro nos dados:', nutricaoData);
            mostrarErro('Erro ao processar dados');
        }
    } catch (erro) {
        console.error('❌ Erro:', erro);
        mostrarErro('Erro de conexão');
    }
}

function atualizarDashboard(stats) {
    document.getElementById('nome-setor').textContent = setorSelecionado || 'Todos';
    document.getElementById('total-pacientes').textContent = stats.total_pacientes || 0;
    document.getElementById('com-prescricao').textContent = stats.com_prescricao || 0;
    document.getElementById('sem-prescricao').textContent = stats.sem_prescricao || 0;
}

function renderizarTabela(dados) {
    const container = document.getElementById('nutricao-content');

    if (!dados || dados.length === 0) {
        container.innerHTML = `
            <div class="empty-message">
                <i class="fas fa-inbox"></i>
                <h3>Nenhum registro encontrado</h3>
                <p>Não há dados para o setor selecionado</p>
            </div>
        `;
        return;
    }

    let html = `
        <div class="nutricao-table-wrapper">
            <table class="nutricao-table">
                <thead>
                    <tr>
                        <th>Leito</th>
                        <th>Atendimento</th>
                        <th>Paciente</th>
                        <th>Acompanhante</th>
                        <th>Prescritor</th>
                        <th>Médico Responsável</th>
                        <th>Alergia</th>
                    </tr>
                </thead>
                <tbody>
                    ${dados.map(r => criarLinhasPaciente(r)).join('')}
                </tbody>
            </table>
        </div>
    `;

    container.innerHTML = html;
}

function criarLinhasPaciente(registro) {
    const nomeFormatado = formatarNome(registro.nm_paciente);
    const temPrescricao = registro.dieta_limpa && registro.dieta_limpa.trim() !== '';

    const classSemPrescricao = !temPrescricao ? ' sem-prescricao-linha' : '';

    // Linha principal
    let html = `
        <tr class="linha-principal${classSemPrescricao}">
            <td><strong>${registro.leito || '-'}</strong></td>
            <td>${registro.nr_atendimento || '-'}</td>
            <td>
                <div class="paciente-nome">${nomeFormatado}</div>
                <span class="paciente-info">${registro.convenio || '-'} • ${registro.idade || '-'}</span>
            </td>
            <td style="text-align: center;">${getIconeAcompanhante(registro.acompanhante)}</td>
            <td>${getPrescritorFormatado(registro)}</td>
            <td>${registro.nm_medico || '-'}</td>
            <td style="text-align: center;">${getIconeAlergia(registro.alergia)}</td>
        </tr>
    `;

    if (temPrescricao) {
        // ✅ Verifica se a prescrição é do dia anterior
        const dataFormatada = formatarDataPrescricao(registro.dt_prescricao);
        const ehDiaAnterior = verificarDiaAnterior(registro.dt_prescricao);
        const classDesatualizado = ehDiaAnterior ? ' desatualizado' : '';

        // ✅ ÍCONE DO CALENDÁRIO - sempre visível
        const iconeCalendario = ehDiaAnterior ? 'fa-calendar-exclamation' : 'fa-calendar-alt';

        html += `
            <tr class="linha-detalhes linha-prescricao">
                <td colspan="7">
                    <span class="badge-data-prescricao${classDesatualizado}">
                        <i class="fas ${iconeCalendario}"></i>
                        ${dataFormatada}
                    </span>
                    <span class="label-detalhes" style="margin-left: 10px;">
                        <i class="fas fa-book-medical"></i> Prescrição:
                    </span>
                    <strong>${registro.nr_prescricao || '-'}</strong> - ${registro.dieta_limpa || '-'}
                </td>
            </tr>
        `;

        const obsLimpa = registro.obs_limpa ? registro.obs_limpa.trim() : '';

        if (obsLimpa && obsLimpa !== '' && obsLimpa !== '-') {
            html += `
                <tr class="linha-detalhes linha-observacao ultima-linha">
                    <td colspan="7">
                        <span class="label-observacao">
                            <i class="fas fa-comment-medical"></i> Observação:
                        </span>
                        ${obsLimpa}
                    </td>
                </tr>
            `;
        } else {
            html = html.replace('linha-prescricao">', 'linha-prescricao ultima-linha">');
        }
    } else {
        html += `
            <tr class="linha-detalhes ultima-linha">
                <td colspan="7" style="text-align: center;">
                    <span class="sem-prescricao-badge">
                        <i class="fas fa-exclamation-triangle"></i>
                        Sem prescrição de nutrição
                    </span>
                </td>
            </tr>
        `;
    }

    return html;
}

function formatarNome(nomeCompleto) {
    if (!nomeCompleto || nomeCompleto.trim() === '') return '-';
    const partes = nomeCompleto.trim().toUpperCase().split(/\s+/);
    if (partes.length === 1) return partes[0];
    const iniciais = partes.slice(0, -1).map(parte => parte.charAt(0)).join(' ');
    const ultimoNome = partes[partes.length - 1];
    return `${iniciais} ${ultimoNome}`;
}

function formatarDataPrescricao(dataISO) {
    if (!dataISO) return '-';

    try {
        const data = new Date(dataISO);
        const dia = String(data.getDate()).padStart(2, '0');
        const mes = String(data.getMonth() + 1).padStart(2, '0');
        const ano = data.getFullYear();
        const hora = String(data.getHours()).padStart(2, '0');
        const minuto = String(data.getMinutes()).padStart(2, '0');

        return `${dia}/${mes}/${ano} ${hora}:${minuto}`;
    } catch (e) {
        return dataISO;
    }
}

// ✅ Verifica se a prescrição é do dia anterior
function verificarDiaAnterior(dataISO) {
    if (!dataISO) return false;

    try {
        const dataPrescricao = new Date(dataISO);
        const hoje = new Date();

        // Zera as horas para comparar apenas datas
        dataPrescricao.setHours(0, 0, 0, 0);
        hoje.setHours(0, 0, 0, 0);

        // Calcula diferença em dias
        const diferencaDias = Math.floor((hoje - dataPrescricao) / (1000 * 60 * 60 * 24));

        // Retorna true se é do dia anterior (diferença = 1 dia)
        return diferencaDias === 1;

    } catch (e) {
        return false;
    }
}

function getPrescritorFormatado(registro) {
    if (!registro.nm_prescritor || registro.nm_prescritor.trim() === '') {
        return '<span style="color: #adb5bd;">-</span>';
    }

    let icone = '';
    if (registro.tipo_prescritor === 'Nutricionista') {
        icone = '<i class="fas fa-user-md icone-nutricionista" title="Nutricionista"></i>';
    } else if (registro.tipo_prescritor === 'Médico') {
        icone = '<i class="fas fa-stethoscope icone-medico" title="Médico"></i>';
    } else {
        icone = '<i class="fas fa-user icone-medico" title="Outro"></i>';
    }

    return `
        <div class="prescritor-container">
            ${icone}
            <span class="prescritor-nome">${registro.nm_prescritor}</span>
        </div>
    `;
}

// Formatação do ícone de alergia
function getIconeAlergia(alergia) {
    if (alergia === 'Sim') {
        return '<i class="fas fa-exclamation-triangle icone-alergia-sim" title="Paciente com alergia"></i>';
    }
    return '<span class="icone-alergia-nao" title="Sem alergia">-</span>';
}

// Formatação do ícone de acompanhante
function getIconeAcompanhante(acompanhante) {
    if (acompanhante === 'Sim') {
        return '<i class="fas fa-check-circle icone-acompanhante-sim" title="Necessita acompanhante"></i>';
    }
    return '<i class="fas fa-times-circle icone-acompanhante-nao" title="Não necessita acompanhante"></i>';
}

// ========================================
// 🎬 AUTO-SCROLL COM WATCHDOG
// ========================================

function iniciarAutoScroll() {
    pararAutoScroll();

    const tbody = document.querySelector('.nutricao-table tbody');
    if (!tbody) {
        console.warn('⚠️ Tbody não encontrado para auto-scroll');
        return;
    }

    console.log('🎬 Iniciando auto-scroll...');

    ultimaPosicaoScroll = tbody.scrollTop;
    contadorTravamento = 0;

    iniciarWatchdog();

    intervaloAutoScroll = setInterval(() => {
        if (!autoScrollAtivo) {
            pararAutoScroll();
            return;
        }

        const scrollAtual = tbody.scrollTop;
        const scrollMax = tbody.scrollHeight - tbody.clientHeight;

        if (scrollMax <= 0) {
            console.log('⏭️ Conteúdo cabe na tela, sem necessidade de scroll');
            return;
        }

        if (scrollAtual >= scrollMax - 1) {
            console.log('🏁 Chegou ao final - iniciando ciclo de reset');
            pararAutoScroll();

            setTimeout(() => {
                if (!autoScrollAtivo) {
                    console.log('⚠️ Auto-scroll foi desativado durante pausa');
                    return;
                }

                console.log('🔄 Voltando ao topo...');
                tbody.scrollTop = 0;
                ultimaPosicaoScroll = 0;
                contadorTravamento = 0;

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
    pararWatchdog();
}

function iniciarWatchdog() {
    pararWatchdog();

    console.log('🐕 Watchdog iniciado - monitorando travamentos...');

    intervaloWatchdog = setInterval(() => {
        if (!autoScrollAtivo) {
            pararWatchdog();
            return;
        }

        const tbody = document.querySelector('.nutricao-table tbody');
        if (!tbody) return;

        const posicaoAtual = tbody.scrollTop;
        const scrollMax = tbody.scrollHeight - tbody.clientHeight;

        if (Math.abs(posicaoAtual - ultimaPosicaoScroll) < 1 && posicaoAtual < scrollMax - 10) {
            contadorTravamento++;
            console.warn(`⚠️ Possível travamento detectado (${contadorTravamento}/3)`);

            if (contadorTravamento >= 3) {
                console.error('🚨 TRAVAMENTO CONFIRMADO - Reiniciando auto-scroll...');

                const btnAutoScroll = document.getElementById('btn-auto-scroll');
                if (btnAutoScroll) {
                    autoScrollAtivo = true;
                    btnAutoScroll.classList.add('active');
                    btnAutoScroll.innerHTML = '<i class="fas fa-pause"></i> Pausar';
                }

                pararAutoScroll();
                setTimeout(() => {
                    if (autoScrollAtivo) {
                        iniciarAutoScroll();
                    }
                }, 1000);
            }
        } else {
            contadorTravamento = 0;
        }

        ultimaPosicaoScroll = posicaoAtual;

    }, CONFIG.watchdogInterval);
}

function pararWatchdog() {
    if (intervaloWatchdog) {
        clearInterval(intervaloWatchdog);
        intervaloWatchdog = null;
        console.log('🐕 Watchdog parado');
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

    const container = document.getElementById('nutricao-content');
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