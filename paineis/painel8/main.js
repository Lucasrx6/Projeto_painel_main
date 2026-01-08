// ========================================
// 📋 PAINEL 8 - ENFERMARIA COM AUTO-SCROLL
// ========================================

const BASE_URL = window.location.origin;

const CONFIG = {
    apiEnfermaria: `${BASE_URL}/api/paineis/painel8/enfermaria`,
    apiSetores: `${BASE_URL}/api/paineis/painel8/setores`,
    apiStats: `${BASE_URL}/api/paineis/painel8/stats`,
    intervaloRefresh: 95000, // 30 segundos
    velocidadeScroll: 0.5,
    delayInicioAutoScroll: 10000,
    pausaFinal: 10000,
    pausaAposReset: 10000,
    watchdogInterval: 5000 // Verifica travamento a cada 5s
};

let dadosEnfermaria = [];
let setores = [];
let autoScrollAtivo = false;
let intervaloAutoScroll = null;
let intervaloWatchdog = null;
let timeoutAutoScrollInicial = null;
let setorSelecionado = localStorage.getItem('painel8_setor') || '';
let ultimaPosicaoScroll = 0;
let contadorTravamento = 0;

function inicializar() {
    console.log('🚀 Inicializando Painel de Enfermaria...');
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
            localStorage.setItem('painel8_setor', setorSelecionado);
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
            carregarDados(); // Carrega dados após ter setores
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
        option.value = setor.nm_setor;
        option.textContent = setor.nm_setor;
        if (setor.nm_setor === setorSelecionado) {
            option.selected = true;
        }
        select.appendChild(option);
    });
}

async function carregarDados() {
    try {
        console.log('🔄 Carregando dados...');

        // ✅ Pausa scroll durante atualização para evitar conflitos
        const scrollEstaAtivo = autoScrollAtivo;
        if (scrollEstaAtivo) {
            console.log('⏸️ Pausando scroll durante atualização...');
            pararAutoScroll();
        }

        let url = CONFIG.apiEnfermaria;
        if (setorSelecionado) {
            url += `?setor=${encodeURIComponent(setorSelecionado)}`;
        }

        const [enfermariaRes, statsRes] = await Promise.all([
            fetch(url),
            setorSelecionado ? fetch(`${CONFIG.apiStats}?setor=${encodeURIComponent(setorSelecionado)}`) : Promise.resolve(null)
        ]);

        if (!enfermariaRes.ok) {
            throw new Error('Erro ao carregar dados');
        }

        const enfermariaData = await enfermariaRes.json();
        const statsData = statsRes ? await statsRes.json() : null;

        if (enfermariaData.success) {
            dadosEnfermaria = enfermariaData.data;
            renderizarTabela(dadosEnfermaria);
            atualizarHoraAtualizacao();

            if (statsData && statsData.success && statsData.stats) {
                atualizarDashboard(statsData.stats);
            }

            // ✅ Reativa scroll após atualização
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

            // ✅ Ativa auto-scroll automaticamente após 10s (apenas na primeira vez)
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
            console.error('Erro nos dados:', enfermariaData);
            mostrarErro('Erro ao processar dados');
        }
    } catch (erro) {
        console.error('❌ Erro:', erro);
        mostrarErro('Erro de conexão');
    }
}

function atualizarDashboard(stats) {
    document.getElementById('nome-setor').textContent = stats.nm_setor || 'Todos';
    document.getElementById('leitos-ocupados').textContent = stats.leitos_ocupados || 0;
    document.getElementById('total-leitos').textContent = stats.total_leitos || 0;
    document.getElementById('leitos-livres').textContent = stats.leitos_livres || 0;
    document.getElementById('percentual-ocupacao').textContent = stats.percentual_ocupacao || 0;
    document.getElementById('pacientes-criticos').textContent = stats.pacientes_criticos || 0;
}

function renderizarTabela(dados) {
    const container = document.getElementById('enfermaria-content');

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
        <div class="enfermaria-table-wrapper">
            <table class="enfermaria-table">
                <thead>
                    <tr>
                        <th>Leito</th>
                        <th>Atendimento</th>
                        <th>Paciente</th>
                        <th>Idade</th>
                        <th>Dias</th>
                        <th>Prescrição</th>
                        <th>Lab</th>
                        <th>Imagem</th>
                        <th>Evolução</th>
                        <th>Parecer</th>
                        <th>Alergia</th>
                        <th>NEWS</th>
                    </tr>
                </thead>
                <tbody>
                    ${dados.map(r => criarLinhaTabela(r)).join('')}
                </tbody>
            </table>
        </div>
    `;

    container.innerHTML = html;
}

function criarLinhaTabela(registro) {
    const isVazio = !registro.atendimento;
    const scoreNews = registro.score_news || 0;

    // ✅ Classifica risco NEWS
    let rowClass = '';
    if (isVazio) {
        rowClass = 'leito-vazio';
    } else if (scoreNews >= 7) {
        rowClass = 'news-alto-risco';
    } else if (scoreNews >= 5) {
        rowClass = 'news-medio-risco';
    }

    const nomeFormatado = formatarNome(registro.paciente);
    const idadeFormatada = registro.idade ? `${registro.idade} anos` : '-';

    // Se leito está vazio, mostrar '-' em todos os campos
    if (isVazio) {
        return `
            <tr class="${rowClass}">
                <td><strong>${registro.leito}</strong></td>
                <td>-</td>
                <td>VAZIO</td>
                <td>-</td>
                <td>-</td>
                <td><span class="texto-neutro">-</span></td>
                <td><span class="texto-neutro">-</span></td>
                <td><span class="texto-neutro">-</span></td>
                <td><span class="texto-neutro">-</span></td>
                <td><span class="texto-neutro">-</span></td>
                <td><span class="texto-neutro">-</span></td>
                <td><span class="texto-neutro">-</span></td>
            </tr>
        `;
    }

    // Leito ocupado - mostrar dados normais
    return `
        <tr class="${rowClass}">
            <td><strong>${registro.leito}</strong></td>
            <td>${registro.atendimento || '-'}</td>
            <td>${nomeFormatado}</td>
            <td>${idadeFormatada}</td>
            <td>${registro.dias_internado || '-'}</td>
            <td>${getIconePrescricao(registro.nr_prescricao)}</td>
            <td>${getIconeLab(registro.prescrito_lab_dia)}</td>
            <td>${getIconeImagem(registro.prescrito_proc_dia)}</td>
            <td>${getIconeEvolucao(registro.evol_medico)}</td>
            <td>${getIconeParecer(registro.parecer_pendente)}</td>
            <td>${getIconeAlergia(registro.alergia)}</td>
            <td>${getBadgeNEWS(scoreNews)}</td>
        </tr>
    `;
}

// ✅ Formatação de nome: "TALITA FERRAZ SCHUENCK DE MOURA" -> "T F S MOURA"
function formatarNome(nomeCompleto) {
    if (!nomeCompleto || nomeCompleto.trim() === '') return 'VAZIO';

    const partes = nomeCompleto.trim().toUpperCase().split(/\s+/);

    if (partes.length === 1) return partes[0];

    // Pega iniciais de todos exceto o último
    const iniciais = partes.slice(0, -1).map(parte => parte.charAt(0)).join(' ');

    // Último nome completo
    const ultimoNome = partes[partes.length - 1];

    return `${iniciais} ${ultimoNome}`;
}

// ========================================
// 🎨 ÍCONES COLORIDOS
// ========================================

function getIconePrescricao(nr_prescricao) {
    if (!nr_prescricao) {
        return '<i class="fas fa-clipboard icone-vermelho" title="Sem prescrição"></i>';
    }
    return '<i class="fas fa-clipboard-check icone-verde" title="Com prescrição"></i>';
}

function getIconeLab(valor) {
    if (valor === 'Sim') {
        return '<i class="fas fa-flask icone-verde" title="Lab prescrito"></i>';
    }

    else if (valor === 'Não') {
        return '<i class="fas fa-flask icone-vermelho" title="Lab prescrito"></i>';
    }
    return '<span class="texto-neutro">-</span>';
}

function getIconeImagem(valor) {
    if (valor === 'Sim') {
        return '<i class="fas fa-x-ray icone-verde" title="Imagem prescrita"></i>';
    }

    else if (valor === 'Não') {
        return '<i class="fas fa-x-ray icone-vermelho" title="Imagem prescrita"></i>';
    }
    return '<span class="texto-neutro">-</span>';
}

function getIconeEvolucao(valor) {
    if (valor === 'Feito') {
        return '<i class="fas fa-file-medical icone-verde" title="Evolução feita"></i>';
    }
    return '<i class="fas fa-file-medical icone-vermelho" title="Evolução pendente"></i>';
}

function getIconeParecer(valor) {
    if (valor === 'Sim') {
        return '<i class="fas fa-clipboard-list icone-vermelho" title="Parecer pendente"></i>';
    }
    return '<span class="texto-neutro">-</span>';
}

function getIconeAlergia(valor) {
    if (valor === 'Sim') {
        return '<i class="fas fa-exclamation-triangle icone-amarelo" title="Paciente com alergia"></i>';
    }
    return '<span class="texto-neutro">-</span>';
}

function getBadgeNEWS(score) {
    // Baixo risco ou vazio: apenas traço
    if (!score || score < 5) {
        return '<span class="texto-neutro">-</span>';
    }

    // Médio risco: ícone amarelo
    if (score >= 5 && score < 7) {
        return '<i class="fas fa-exclamation-circle news-icon-medio" title="Médio Risco (NEWS 5-6)"></i>';
    }

    // Alto risco: ícone vermelho
    return '<i class="fas fa-exclamation-triangle news-icon-alto" title="Alto Risco (NEWS ≥7)"></i>';
}

// ========================================
// 🎬 AUTO-SCROLL COM WATCHDOG
// ========================================

function iniciarAutoScroll() {
    pararAutoScroll();

    const tbody = document.querySelector('.enfermaria-table tbody');
    if (!tbody) {
        console.warn('⚠️ Tbody não encontrado para auto-scroll');
        return;
    }

    console.log('🎬 Iniciando auto-scroll...');

    // Reset contador de travamento
    ultimaPosicaoScroll = tbody.scrollTop;
    contadorTravamento = 0;

    // ✅ Inicia watchdog para detectar travamentos
    iniciarWatchdog();

    intervaloAutoScroll = setInterval(() => {
        if (!autoScrollAtivo) {
            pararAutoScroll();
            return;
        }

        const scrollAtual = tbody.scrollTop;
        const scrollMax = tbody.scrollHeight - tbody.clientHeight;

        // Se não tem scroll (conteúdo cabe na tela)
        if (scrollMax <= 0) {
            console.log('⏭️ Conteúdo cabe na tela, sem necessidade de scroll');
            return;
        }

        // Se chegou ao final
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

        // Scroll normal
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

// ========================================
// 🐕 WATCHDOG - DETECTA E CORRIGE TRAVAMENTOS
// ========================================

function iniciarWatchdog() {
    pararWatchdog();

    console.log('🐕 Watchdog iniciado - monitorando travamentos...');

    intervaloWatchdog = setInterval(() => {
        if (!autoScrollAtivo) {
            pararWatchdog();
            return;
        }

        const tbody = document.querySelector('.enfermaria-table tbody');
        if (!tbody) return;

        const posicaoAtual = tbody.scrollTop;
        const scrollMax = tbody.scrollHeight - tbody.clientHeight;

        // Verifica se a posição mudou
        if (Math.abs(posicaoAtual - ultimaPosicaoScroll) < 1 && posicaoAtual < scrollMax - 10) {
            contadorTravamento++;
            console.warn(`⚠️ Possível travamento detectado (${contadorTravamento}/3)`);

            // Se detectou travamento 3 vezes consecutivas, reinicia o scroll
            if (contadorTravamento >= 3) {
                console.error('🚨 TRAVAMENTO CONFIRMADO - Reiniciando auto-scroll...');

                const btnAutoScroll = document.getElementById('btn-auto-scroll');
                if (btnAutoScroll) {
                    autoScrollAtivo = true;
                    btnAutoScroll.classList.add('active');
                    btnAutoScroll.innerHTML = '<i class="fas fa-pause"></i> Pausar';
                }

                // Reinicia completamente
                pararAutoScroll();
                setTimeout(() => {
                    if (autoScrollAtivo) {
                        iniciarAutoScroll();
                    }
                }, 1000);
            }
        } else {
            // Scroll está funcionando normalmente
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

    const container = document.getElementById('enfermaria-content');
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