// ========================================
// PAINEL 6 - PRIORIZAÇÃO CLÍNICA
// Versão Corrigida com Debug
// ========================================

(function () {
  console.log('🚀 Painel 6 inicializando...');

  const el = (id) => document.getElementById(id);

  const state = {
    autoScroll: false,
    autoScrollTimer: null,
    refreshTimer: null,
    isLoading: false,
  };

  const REFRESH_MS = 30_000;
  const CONFIG = {
    velocidadeScroll: 0.5,
    delayInicioAutoScroll: 10000,
    pausaFinal: 10000,
    pausaAposReset: 10000
  };

  // ========================================
  // 🎨 FORMATAÇÃO DE NOMES (PAINEL 5)
  // ========================================
  function formatarNomeIniciais(nomeCompleto) {
    if (!nomeCompleto || typeof nomeCompleto !== 'string') {
      return 'N/A';
    }

    const partes = nomeCompleto.trim().split(/\s+/);

    if (partes.length === 1) {
      return partes[0];
    }

    const iniciais = [];
    const preposicoes = ['de', 'da', 'do', 'dos', 'das', 'e'];

    for (let i = 0; i < partes.length - 1; i++) {
      const parte = partes[i];

      if (preposicoes.includes(parte.toLowerCase())) {
        iniciais.push(parte.charAt(0).toUpperCase());
      } else {
        iniciais.push(parte.charAt(0).toUpperCase());
      }
    }

    const sobrenome = partes[partes.length - 1];

    return `${iniciais.join(' ')} ${sobrenome}`;
  }

  // ========================================
  // 🛠️ UTILITÁRIOS
  // ========================================
  function setUltimaAtualizacao(text) {
    const span = document.querySelector(".ultima-atualizacao");
    if (span) span.textContent = text;
  }

  function fmtDateTime(iso) {
    if (!iso) return "-";
    try {
      const d = new Date(iso);
      return d.toLocaleString("pt-BR");
    } catch {
      return "-";
    }
  }

  function safe(v) {
    if (v === null || v === undefined || v === "") return "-";
    return v;
  }

  function riscoPill(nivel) {
    const n = (nivel || "").toString();
    const norm = n.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

    let cls = "risco-baixo";
    let icon = "fa-shield-heart";
    let label = n || "Baixo";

    if (norm.includes("crit")) {
      cls = "risco-critico";
      icon = "fa-skull-crossbones";
      label = "CRÍTICO";
    }
    else if (norm.includes("alto")) {
      cls = "risco-alto";
      icon = "fa-triangle-exclamation";
      label = "ALTO";
    }
    else if (norm.includes("moder")) {
      cls = "risco-moderado";
      icon = "fa-circle-exclamation";
      label = "MODERADO";
    }
    else if (norm.includes("baixo")) {
      cls = "risco-baixo";
      icon = "fa-shield-heart";
      label = "Baixo";
    }

    return `<span class="risco-pill ${cls}"><i class="fas ${icon}"></i>${label}</span>`;
  }

  // ========================================
  // 🎬 AUTO-SCROLL
  // ========================================
  function startAutoScroll() {
    stopAutoScroll();

    const btn = el("btn-auto-scroll");
    if (btn) {
      btn.classList.add("active");
      btn.innerHTML = `<i class="fas fa-pause"></i> Pausar`;
    }

    state.autoScroll = true;

    const tbody = el("tabela-body");
    if (!tbody) {
      console.warn('⚠️ Tbody não encontrado');
      return;
    }

    console.log('🎬 Auto-scroll ativado');

    state.autoScrollTimer = setInterval(() => {
      if (!state.autoScroll) {
        stopAutoScroll();
        return;
      }

      const scrollAtual = tbody.scrollTop;
      const scrollMax = tbody.scrollHeight - tbody.clientHeight;

      if (scrollMax <= 0) {
        return;
      }

      if (scrollAtual >= scrollMax - 1) {
        console.log('🏁 Final atingido - resetando');
        stopAutoScroll();

        setTimeout(() => {
          if (!state.autoScroll) return;

          tbody.scrollTop = 0;

          setTimeout(() => {
            if (state.autoScroll) {
              startAutoScroll();
            }
          }, CONFIG.pausaAposReset);

        }, CONFIG.pausaFinal);
        return;
      }

      tbody.scrollTop += CONFIG.velocidadeScroll;

    }, 50);
  }

  function stopAutoScroll() {
    const btn = el("btn-auto-scroll");
    if (btn) {
      btn.classList.remove("active");
      btn.innerHTML = `<i class="fas fa-play"></i> Auto Scroll`;
    }

    state.autoScroll = false;

    if (state.autoScrollTimer) {
      clearInterval(state.autoScrollTimer);
      state.autoScrollTimer = null;
      console.log('🛑 Auto-scroll parado');
    }
  }

  function toggleAutoScroll() {
    if (state.autoScroll) stopAutoScroll();
    else startAutoScroll();
  }

  // ========================================
  // 🌐 API FETCH
  // ========================================
  async function fetchJSON(url) {
    console.log(`📡 Buscando: ${url}`);

    try {
      const resp = await fetch(url, {
        credentials: "include",
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json'
        }
      });

      console.log(`📡 Response status: ${resp.status}`);

      if (!resp.ok) {
        throw new Error(`HTTP ${resp.status}: ${resp.statusText}`);
      }

      const data = await resp.json();
      console.log(`📦 Dados recebidos:`, data);

      if (data.success === false) {
        throw new Error(data.error || "Erro ao buscar dados");
      }

      return data;

    } catch (error) {
      console.error(`❌ Erro na requisição ${url}:`, error);
      throw error;
    }
  }

  // ========================================
  // 📊 DASHBOARD
  // ========================================
  async function loadDashboard() {
    const url = `/api/paineis/painel6/dashboard`;

    try {
      const json = await fetchJSON(url);
      const d = json.data || {};

      el("total-pacientes").textContent = safe(d.total || 0);
      el("total-critico").textContent = safe(d.critico || 0);
      el("total-alto").textContent = safe(d.alto || 0);
      el("total-moderado").textContent = safe(d.moderado || 0);

      setUltimaAtualizacao(`Atualizado: ${fmtDateTime(json.timestamp || new Date())}`);

      console.log('✅ Dashboard carregado');

    } catch (error) {
      console.error('❌ Erro ao carregar dashboard:', error);
      // Valores padrão em caso de erro
      el("total-pacientes").textContent = "0";
      el("total-critico").textContent = "0";
      el("total-alto").textContent = "0";
      el("total-moderado").textContent = "0";
    }
  }

  // ========================================
  // 📋 RENDERIZAR TABELA
  // ========================================
  function renderRows(lista) {
    const tbody = el("tabela-body");
    tbody.innerHTML = "";

    console.log(`📋 Renderizando ${lista.length} linhas`);

    for (const r of lista) {
      const nr = r.nr_atendimento;

      // ✅ FORMATA NOME COM INICIAIS
      const nomeCompleto = safe(r.nm_pessoa_fisica);
      const nomeFormatado = formatarNomeIniciais(nomeCompleto);

      const leito = safe(r.cd_unidade);
      const setor = safe(r.nm_setor);

      // ✅ Prioriza campos da view científica
      const risco = safe(
        r.nivel_risco_total ||
        r.nivel_risco_final ||
        r.nivel_criticidade ||
        'BAIXO'
      );

      const score = safe(
        r.score_clinico_total ||
        r.score_final ||
        r.score_ia ||
        0
      );

      // ✅ ANÁLISE (prioriza analise_ia)
      let analise = "";

      if (r.analise_ia && String(r.analise_ia).trim()) {
        const texto = String(r.analise_ia);
        analise = `<div class="analise-ia-badge">🤖 IA</div>${texto}`;
      } else if (r.resumo_clinico_completo && String(r.resumo_clinico_completo).trim()) {
        // Fallback para resumo da view
        analise = `<div class="analise-basica-badge">📊 Automático</div>${String(r.resumo_clinico_completo)}`;
      } else if (r.analise_final && String(r.analise_final).trim()) {
        analise = `<div class="analise-basica-badge">📊 Automático</div>${String(r.analise_final)}`;
      } else {
        analise = "⏳ Aguardando análise...";
      }

      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td class="col-risco">${riscoPill(risco)}</td>
        <td class="col-atendimento">
          <span class="badge-atendimento">${nr}</span>
          <span class="paciente-info">Score: <b>${score}</b></span>
        </td>
        <td class="col-paciente">
          <span class="paciente-nome">${nomeFormatado}</span>
        </td>
        <td class="col-leito">
          <span class="badge-leito">${leito}</span>
          <span class="paciente-info">${setor}</span>
        </td>
        <td class="col-analise">
          <div class="analise-clinica">${analise}</div>
        </td>
      `;

      tbody.appendChild(tr);
    }

    console.log('✅ Tabela renderizada');
  }

  // ========================================
  // 🎭 LOADING / EMPTY
  // ========================================
  function showLoading(show) {
    const loading = el("loading");
    const grupo = el("grupo-unico");
    const empty = el("empty");

    if (show) {
      if (loading) loading.style.display = "flex";
      if (grupo) grupo.style.display = "none";
      if (empty) empty.style.display = "none";
      return;
    }

    if (loading) loading.style.display = "none";
  }

  function showEmpty(show) {
    const empty = el("empty");
    const grupo = el("grupo-unico");
    if (empty) empty.style.display = show ? "block" : "none";
    if (grupo) grupo.style.display = show ? "none" : "flex";
  }

  // ========================================
  // 📥 CARREGAR LISTA
  // ========================================
  async function loadLista() {
    const url = `/api/paineis/painel6/lista?limit=400&offset=0`;

    try {
      const json = await fetchJSON(url);
      const lista = json.data || [];

      console.log(`📊 ${lista.length} pacientes recebidos`);

      el("badge-qtd").textContent = `${lista.length} pacientes`;

      if (!lista.length) {
        showEmpty(true);
        el("tabela-body").innerHTML = "";
        return;
      }

      showEmpty(false);
      renderRows(lista);

    } catch (error) {
      console.error('❌ Erro ao carregar lista:', error);
      throw error;
    }
  }

  // ========================================
  // 🔄 REFRESH GERAL
  // ========================================
  async function refreshAll(opts = { keepLoading: false }) {
    if (state.isLoading) {
      console.log('⚠️ Já está carregando, aguarde...');
      return;
    }

    state.isLoading = true;
    console.log('🔄 Iniciando refresh...');

    const wasScrolling = state.autoScroll;

    if (!opts.keepLoading) showLoading(true);

    try {
      await Promise.all([
        loadDashboard(),
        loadLista(),
      ]);

      if (wasScrolling && opts.keepLoading) {
        setTimeout(() => startAutoScroll(), 500);
      }

      console.log('✅ Refresh completo');

    } catch (e) {
      console.error('❌ Erro no refresh:', e);
      showLoading(false);
      showEmpty(false);

      const tbody = el("tabela-body");
      if (tbody) tbody.innerHTML = "";

      const empty = el("empty");
      if (empty) {
        empty.style.display = "block";
        empty.innerHTML = `
          <i class="fas fa-triangle-exclamation"></i>
          <h3>Erro ao carregar dados</h3>
          <p>${e.message || "Erro desconhecido"}</p>
          <p style="font-size: 0.8rem; margin-top: 10px;">
            Verifique: <br>
            1. Se o backend está rodando<br>
            2. Se a rota /api/paineis/painel6/lista existe<br>
            3. Console do navegador (F12) para mais detalhes
          </p>
        `;
      }
    } finally {
      showLoading(false);
      state.isLoading = false;
    }
  }

  // ========================================
  // ⏰ AGENDA REFRESH
  // ========================================
  function scheduleRefresh() {
    if (state.refreshTimer) clearInterval(state.refreshTimer);
    state.refreshTimer = setInterval(() => {
      console.log('⏰ Refresh automático...');
      refreshAll({ keepLoading: true });
    }, REFRESH_MS);

    console.log(`⏰ Refresh automático agendado (${REFRESH_MS/1000}s)`);
  }

  // ========================================
  // 🎯 EVENTOS
  // ========================================
  function bindEvents() {
    console.log('🎯 Vinculando eventos...');

    const btnVoltar = el("btn-voltar");
    const btnAutoScroll = el("btn-auto-scroll");
    const btnRefresh = el("btn-refresh");

    if (btnVoltar) {


      btnVoltar.addEventListener("click", () => {
        console.log('🔙 Voltando...');
        window.location.href = "/";
      });
    }

    if (btnAutoScroll) {
      btnAutoScroll.addEventListener("click", toggleAutoScroll);
    }

    if (btnRefresh) {
      btnRefresh.addEventListener("click", () => {
        console.log('🔄 Refresh manual');
        stopAutoScroll();
        refreshAll({ keepLoading: false });
      });
    }

    console.log('✅ Eventos vinculados');
  }

  // ========================================
  // 🚀 INICIALIZAÇÃO
  // ========================================
  async function init() {
    console.log('🚀 Iniciando Painel 6...');

    try {
      bindEvents();
      await refreshAll({ keepLoading: false });
      scheduleRefresh();

      // Auto-scroll após 10s
      setTimeout(() => {
        if (!state.autoScroll) {
          console.log('🚀 Ativando auto-scroll automaticamente');
          startAutoScroll();
        }
      }, CONFIG.delayInicioAutoScroll);

      console.log('✅ Painel 6 inicializado com sucesso!');

    } catch (error) {
      console.error('❌ Erro fatal na inicialização:', error);
    }
  }

  // ========================================
  // 🏁 START
  // ========================================
  if (document.readyState === 'loading') {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

  console.log('📄 Script carregado');
})();