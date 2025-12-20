// Painel 6 - Priorização Clínica (padrão painel5)
// Endpoints usados:
//  - GET /api/paineis/painel6/dashboard
//  - GET /api/paineis/painel6/lista?setor=&convenio=&risco=&limit=&offset=
//  - GET /api/paineis/painel6/paciente/<nr_atendimento>

(function () {
  const el = (id) => document.getElementById(id);

  const state = {
    autoScroll: false,
    autoScrollTimer: null,
    refreshTimer: null,
    lastFilters: { setor: "", convenio: "", risco: "" },
    isLoading: false,
  };

  const REFRESH_MS = 30_000;
  const AUTO_SCROLL_STEP = 1;
  const AUTO_SCROLL_MS = 18;

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

  function parseMaybeNumber(v) {
    if (v === null || v === undefined) return null;
    if (typeof v === "number") return v;
    if (typeof v === "string") {
      const s = v.trim().replace(",", ".");
      const n = Number(s);
      return Number.isFinite(n) ? n : null;
    }
    return null;
  }

  function buildKV(items) {
    // items: [{k:'FC', v: 88}, ...]
    const parts = items
      .filter((x) => x.v !== null && x.v !== undefined && x.v !== "")
      .map((x) => `<span><b>${x.k}:</b> ${String(x.v)}</span>`);
    if (!parts.length) return `<span>-</span>`;
    return parts.join("");
  }

  function riscoPill(nivel) {
    const n = (nivel || "").toString();
    const norm = n.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

    let cls = "risco-baixo";
    let icon = "fa-shield-heart";
    let label = n || "Baixo";

    if (norm.includes("crit")) { cls = "risco-critico"; icon = "fa-skull-crossbones"; label = "Crítico"; }
    else if (norm.includes("alto")) { cls = "risco-alto"; icon = "fa-triangle-exclamation"; label = "Alto"; }
    else if (norm.includes("moder")) { cls = "risco-moderado"; icon = "fa-circle-exclamation"; label = "Moderado"; }
    else if (norm.includes("baixo")) { cls = "risco-baixo"; icon = "fa-shield-heart"; label = "Baixo"; }

    return `<span class="risco-pill ${cls}"><i class="fas ${icon}"></i>${label}</span>`;
  }

  function getScrollContainer() {
    // tbody é o scroll container (igual painel5)
    const tbody = el("tabela-body");
    if (!tbody) return null;
    return tbody;
  }

  function startAutoScroll() {
    const btn = el("btn-auto-scroll");
    if (btn) {
      btn.classList.add("active");
      btn.innerHTML = `<i class="fas fa-pause"></i> Auto Scroll`;
    }

    state.autoScroll = true;

    const sc = getScrollContainer();
    if (!sc) return;

    stopAutoScroll(); // limpa anterior
    state.autoScroll = true;

    state.autoScrollTimer = window.setInterval(() => {
      const max = sc.scrollHeight - sc.clientHeight;
      if (max <= 0) return;

      sc.scrollTop = sc.scrollTop + AUTO_SCROLL_STEP;
      if (sc.scrollTop >= max) {
        sc.scrollTop = 0; // volta
      }
    }, AUTO_SCROLL_MS);
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
    }
  }

  function toggleAutoScroll() {
    if (state.autoScroll) stopAutoScroll();
    else startAutoScroll();
  }

  function qsFromFilters(filters) {
    const params = new URLSearchParams();
    if (filters.setor) params.set("setor", filters.setor);
    if (filters.convenio) params.set("convenio", filters.convenio);
    if (filters.risco) params.set("risco", filters.risco);
    params.set("limit", "400");
    params.set("offset", "0");
    return params.toString();
  }

  async function fetchJSON(url) {
    const resp = await fetch(url, { credentials: "include" });
    const data = await resp.json().catch(() => null);
    if (!resp.ok || !data) {
      const msg = (data && data.error) ? data.error : `Erro HTTP ${resp.status}`;
      throw new Error(msg);
    }
    if (data.success === false) {
      throw new Error(data.error || "Erro ao buscar dados");
    }
    return data;
  }

  async function loadDashboard(filters) {
    const params = new URLSearchParams();
    if (filters.setor) params.set("setor", filters.setor);
    if (filters.convenio) params.set("convenio", filters.convenio);

    const url = `/api/paineis/painel6/dashboard?${params.toString()}`;
    const json = await fetchJSON(url);

    const d = json.data || {};
    el("total-pacientes").textContent = safe(d.total);
    el("total-critico").textContent = safe(d.critico);
    el("total-alto").textContent = safe(d.alto);
    el("total-moderado").textContent = safe(d.moderado);

    // última atualização: usa timestamp do backend
    setUltimaAtualizacao(`Atualizado: ${fmtDateTime(json.timestamp)}`);
  }

  function renderRows(lista) {
    const tbody = el("tabela-body");
    tbody.innerHTML = "";

    for (const r of lista) {
      const nr = r.nr_atendimento;
      const nome = safe(r.nm_pessoa_fisica);
      const setor = safe(r.nm_setor);
      const leito = safe(r.cd_unidade);
      const convenio = safe(r.ds_convenio);
      const score = safe(r.score_total);
      const risco = safe(r.nivel_risco_total);

      const vitaisHtml = buildKV([
        { k: "PA", v: (r.qt_pa_sistolica && r.qt_pa_diastolica) ? `${r.qt_pa_sistolica}/${r.qt_pa_diastolica}` : null },
        { k: "PAM", v: r.qt_pam },
        { k: "FC", v: r.qt_freq_cardiaca },
        { k: "FR", v: r.qt_freq_resp },
        { k: "Temp", v: r.qt_temp },
        { k: "SpO₂", v: r.qt_saturacao_o2 },
        { k: "HGT", v: r.qt_glicemia_capilar },
        { k: "Dor", v: r.qt_escala_dor },
      ]);

      const labsHtml = buildKV([
        { k: "Cr", v: r.exm_creatinina },
        { k: "Ureia", v: r.exm_ureia },
        { k: "Na", v: r.exm_sodio },
        { k: "K", v: r.exm_potassio },
        { k: "Lac(A)", v: r.exm_lactato_art },
        { k: "Lac(V)", v: r.exm_lactato_ven },
        { k: "Trop", v: r.exm_troponina },
        { k: "D-D", v: r.exm_dimero_d },
        { k: "Leuco", v: r.exm_leucocitos },
        { k: "Hb", v: r.exm_hemoglobina },
      ]);

      const resumo = (r.resumo_clinico_basico && String(r.resumo_clinico_basico).trim())
        ? String(r.resumo_clinico_basico)
        : "";

      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${riscoPill(risco)}</td>
        <td>
          <span class="paciente-nome" title="${String(nome).replace(/"/g, "&quot;")}">${nome}</span>
          <span class="paciente-info">Atend: <b>${safe(nr)}</b> • Convênio: ${convenio}</span>
        </td>
        <td>
          <span class="badge-setor" title="${String(setor).replace(/"/g, "&quot;")}">${setor}</span>
          <span class="paciente-info">Leito: <b>${leito}</b></span>
        </td>
        <td>
          <span class="badge-score"><i class="fas fa-chart-line"></i> ${score}</span>
          ${resumo ? `<span class="paciente-info" title="${resumo.replace(/"/g, "&quot;")}">${resumo}</span>` : `<span class="paciente-info">-</span>`}
        </td>
        <td><div class="kv">${vitaisHtml}</div></td>
        <td><div class="kv">${labsHtml}</div></td>
      `;

      tr.style.cursor = "pointer";
      tr.addEventListener("click", () => openModal(nr, nome));

      tbody.appendChild(tr);
    }
  }

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

  async function loadLista(filters) {
    const qs = qsFromFilters(filters);
    const url = `/api/paineis/painel6/lista?${qs}`;
    const json = await fetchJSON(url);

    const lista = json.data || [];
    el("badge-qtd").textContent = `${lista.length} pacientes`;

    if (!lista.length) {
      showEmpty(true);
      el("tabela-body").innerHTML = "";
      return;
    }

    showEmpty(false);
    renderRows(lista);
  }

  function readFiltersFromUI() {
    return {
      setor: (el("filtro-setor").value || "").trim(),
      convenio: (el("filtro-convenio").value || "").trim(),
      risco: (el("filtro-risco").value || "").trim(),
    };
  }

  function setFiltersToUI(filters) {
    el("filtro-setor").value = filters.setor || "";
    el("filtro-convenio").value = filters.convenio || "";
    el("filtro-risco").value = filters.risco || "";
  }

  async function refreshAll(opts = { keepLoading: false }) {
    if (state.isLoading) return;
    state.isLoading = true;

    const filters = state.lastFilters;

    if (!opts.keepLoading) showLoading(true);

    try {
      await Promise.all([
        loadDashboard(filters),
        loadLista(filters),
      ]);
    } catch (e) {
      console.error(e);
      showLoading(false);
      showEmpty(false);

      const content = el("painel6-content");
      const tbody = el("tabela-body");
      if (tbody) tbody.innerHTML = "";

      const empty = el("empty");
      if (empty) {
        empty.style.display = "block";
        empty.innerHTML = `
          <i class="fas fa-triangle-exclamation"></i>
          <h3>Erro ao carregar dados</h3>
          <p>${(e && e.message) ? e.message : "Erro desconhecido"}</p>
        `;
      }
    } finally {
      showLoading(false);
      state.isLoading = false;
    }
  }

  function scheduleRefresh() {
    if (state.refreshTimer) clearInterval(state.refreshTimer);
    state.refreshTimer = setInterval(() => refreshAll({ keepLoading: true }), REFRESH_MS);
  }

  function bindEvents() {
    // voltar
    el("btn-voltar").addEventListener("click", () => window.location.href = "/");

    // refresh manual
    el("btn-refresh").addEventListener("click", () => refreshAll({ keepLoading: false }));

    // auto scroll
    el("btn-auto-scroll").addEventListener("click", toggleAutoScroll);

    // filtros
    el("btn-aplicar").addEventListener("click", () => {
      state.lastFilters = readFiltersFromUI();
      refreshAll({ keepLoading: false });
    });

    el("btn-limpar").addEventListener("click", () => {
      state.lastFilters = { setor: "", convenio: "", risco: "" };
      setFiltersToUI(state.lastFilters);
      refreshAll({ keepLoading: false });
    });

    // aplicar com Enter nos inputs
    el("filtro-setor").addEventListener("keydown", (e) => {
      if (e.key === "Enter") el("btn-aplicar").click();
    });
    el("filtro-convenio").addEventListener("keydown", (e) => {
      if (e.key === "Enter") el("btn-aplicar").click();
    });

    // modal
    el("modal-close").addEventListener("click", closeModal);
    el("modal-fechar").addEventListener("click", closeModal);
    el("modal-overlay").addEventListener("click", (e) => {
      if (e.target && e.target.id === "modal-overlay") closeModal();
    });

    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") closeModal();
    });
  }

  function openModal(nrAtendimento, nome) {
    const overlay = el("modal-overlay");
    const body = el("modal-body");
    const title = el("modal-title-text");

    title.textContent = `${safe(nome)} • Atendimento ${safe(nrAtendimento)}`;
    overlay.style.display = "flex";

    body.innerHTML = `
      <div class="loading-container">
        <div class="loading-spinner"></div>
        <p>Carregando detalhes...</p>
      </div>
    `;

    loadDetalhe(nrAtendimento).catch((e) => {
      body.innerHTML = `
        <div class="empty-message">
          <i class="fas fa-triangle-exclamation"></i>
          <h3>Erro ao carregar detalhes</h3>
          <p>${(e && e.message) ? e.message : "Erro desconhecido"}</p>
        </div>
      `;
    });
  }

  function closeModal() {
    const overlay = el("modal-overlay");
    overlay.style.display = "none";
  }

  function detalheKVRow(label, value) {
    return `<div class="kv"><span><b>${label}:</b> ${safe(value)}</span></div>`;
  }

  async function loadDetalhe(nrAtendimento) {
    const url = `/api/paineis/painel6/paciente/${nrAtendimento}`;
    const json = await fetchJSON(url);
    const r = json.data || {};

    const body = el("modal-body");
    const vitais = `
      <div class="card">
        <h4><i class="fas fa-heartbeat"></i> Sinais Vitais</h4>
        <div class="kv">
          ${buildKV([
            { k: "PA", v: (r.qt_pa_sistolica && r.qt_pa_diastolica) ? `${r.qt_pa_sistolica}/${r.qt_pa_diastolica}` : null },
            { k: "PAM", v: r.qt_pam },
            { k: "FC", v: r.qt_freq_cardiaca },
            { k: "FR", v: r.qt_freq_resp },
            { k: "Temp", v: r.qt_temp },
            { k: "SpO₂", v: r.qt_saturacao_o2 },
            { k: "HGT", v: r.qt_glicemia_capilar },
            { k: "Dor", v: r.qt_escala_dor },
            { k: "Peso", v: r.qt_peso },
            { k: "IMC", v: r.qt_imc },
          ])}
        </div>
      </div>
    `;

    const labs = `
      <div class="card">
        <h4><i class="fas fa-flask"></i> Exames</h4>
        <div class="kv">
          ${buildKV([
            { k: "Glicose", v: r.exm_glicose },
            { k: "Creatinina", v: r.exm_creatinina },
            { k: "Ureia", v: r.exm_ureia },
            { k: "Sódio", v: r.exm_sodio },
            { k: "Potássio", v: r.exm_potassio },
            { k: "Ca++(Art)", v: r.exm_ca_art },
            { k: "Ca++(Ven)", v: r.exm_ca_ven },
            { k: "Lactato(Art)", v: r.exm_lactato_art },
            { k: "Lactato(Ven)", v: r.exm_lactato_ven },
            { k: "Troponina", v: r.exm_troponina },
            { k: "Dímero-D", v: r.exm_dimero_d },
            { k: "RNI", v: r.exm_rni },
            { k: "Leucócitos", v: r.exm_leucocitos },
            { k: "Hemoglobina", v: r.exm_hemoglobina },
            { k: "Hematócrito", v: r.exm_hematocrito },
            { k: "Plaquetas", v: r.exm_plaquetas },
            { k: "BT", v: r.exm_bilir_total },
            { k: "BD", v: r.exm_bilir_direta },
            { k: "BI", v: r.exm_bilir_indireta },
            { k: "GGT", v: r.exm_ggt },
          ])}
        </div>
      </div>
    `;

    const score = `
      <div class="card">
        <h4><i class="fas fa-chart-line"></i> Score</h4>
        <div class="kv">
          <span><b>Vital:</b> ${safe(r.score_vital)}</span>
          <span><b>Lab:</b> ${safe(r.score_lab)}</span>
          <span><b>Total:</b> ${safe(r.score_total)}</span>
          <span><b>Risco:</b> ${safe(r.nivel_risco_total)}</span>
        </div>
        <div class="kv" style="margin-top:8px;">
          <span><b>Resumo:</b> ${safe(r.resumo_clinico_basico)}</span>
        </div>
      </div>
    `;

    const ident = `
      <div class="card">
        <h4><i class="fas fa-id-badge"></i> Identificação</h4>
        <div class="kv">
          <span><b>Paciente:</b> ${safe(r.nm_pessoa_fisica)}</span>
          <span><b>Atendimento:</b> ${safe(r.nr_atendimento)}</span>
          <span><b>Setor:</b> ${safe(r.nm_setor)}</span>
          <span><b>Leito:</b> ${safe(r.cd_unidade)}</span>
          <span><b>Convênio:</b> ${safe(r.ds_convenio)}</span>
          <span><b>Sexo:</b> ${safe(r.ie_sexo)}</span>
          <span><b>Nasc:</b> ${safe(r.dt_nascimento)}</span>
          <span><b>Carga:</b> ${safe(r.dt_carga)}</span>
        </div>
      </div>
    `;

    body.innerHTML = `
      <div class="detalhes-grid">
        ${ident}
        ${score}
        ${vitais}
        ${labs}
      </div>
    `;
  }

  async function init() {
    bindEvents();
    state.lastFilters = readFiltersFromUI();
    await refreshAll({ keepLoading: false });
    scheduleRefresh();
  }

  document.addEventListener("DOMContentLoaded", init);
})();