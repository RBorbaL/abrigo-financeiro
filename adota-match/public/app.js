// ===================== Focinhos - frontend =====================

const api = async (path, opts = {}) => {
  // tempo-limite: evita travar se o servidor grátis estiver "acordando"
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 30000);
  try {
    const res = await fetch(path, {
      headers: { "Content-Type": "application/json" },
      ...opts,
      signal: ctrl.signal,
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
    return res.json();
  } finally {
    clearTimeout(timer);
  }
};

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

const state = {
  conta: null,       // conta logada (email/nome)
  role: null,        // 'adotante' | 'doador'
  adotante: null,    // perfil salvo
  doador: null,
  deck: [],          // animais para swipe
};

// --------- persistência leve no navegador ----------
const LS = "adotamatch";
function loadSession() {
  try { return JSON.parse(localStorage.getItem(LS)) || {}; }
  catch { return {}; }
}
function saveSession() {
  localStorage.setItem(LS, JSON.stringify({
    conta: state.conta, role: state.role,
    adotante: state.adotante, doador: state.doador,
  }));
}

// --------- navegação entre telas ----------
function show(screenId) {
  $$(".screen").forEach((s) => s.classList.add("hidden"));
  $("#" + screenId).classList.remove("hidden");
}
function setTab(container, tabName) {
  container.querySelectorAll(".tab").forEach((t) =>
    t.classList.toggle("active", t.dataset.tab === tabName));
  container.parentElement.querySelectorAll(".tabpane").forEach((p) =>
    p.classList.add("hidden"));
  $("#tab-" + tabName).classList.remove("hidden");
}

function toast(msg) {
  const t = $("#toast");
  t.textContent = msg;
  t.classList.remove("hidden");
  clearTimeout(t._t);
  t._t = setTimeout(() => t.classList.add("hidden"), 2200);
}

// desabilita o botão e mostra "carregando" durante uma ação assíncrona
function setLoading(btn, on, txt) {
  if (!btn) return;
  if (on) {
    if (btn.dataset.orig === undefined) btn.dataset.orig = btn.innerHTML;
    btn.disabled = true;
    btn.classList.add("carregando");
    btn.innerHTML = txt || "Aguarde...";
  } else {
    btn.disabled = false;
    btn.classList.remove("carregando");
    if (btn.dataset.orig !== undefined) { btn.innerHTML = btn.dataset.orig; delete btn.dataset.orig; }
  }
}

function updateNav() {
  const nav = $("#nav");
  if (state.conta) {
    nav.classList.remove("hidden");
    const nome = state.conta.nome || state.conta.email;
    $("#who").textContent = state.role ? `${nome} · ${state.role}` : nome;
  } else {
    nav.classList.add("hidden");
  }
}

// --------- navegação por botões com data-goto ---------
$$("[data-goto]").forEach((btn) => {
  btn.addEventListener("click", () => show(btn.dataset.goto));
});

// --------- logout ---------
$("#btnSair").addEventListener("click", () => {
  if (!confirm("Deseja sair da sua conta?")) return;
  localStorage.removeItem(LS);
  state.conta = state.role = state.adotante = state.doador = null;
  state.deck = [];
  updateNav();
  show("screen-landing");
});

// ===================== HOME (hub: escolher papel) =====================
$$(".role-card").forEach((card) => {
  card.addEventListener("click", () => {
    irParaPapel(card.dataset.role);
  });
});

// leva ao fluxo do papel escolhido (reaproveita perfil se já existir)
function irParaPapel(role) {
  state.role = role;
  if (role === "adotante") {
    if (state.adotante) startAdotante();
    else { prefillDe("formAdotante"); show("screen-adotante-cadastro"); }
  } else {
    if (state.doador) startDoador();
    else { prefillDe("formDoador"); show("screen-doador-cadastro"); }
  }
  updateNav();
  saveSession();
}

// prefill de nome/contato a partir da conta logada
function prefillDe(formId) {
  const form = document.getElementById(formId);
  if (!form || !state.conta) return;
  if (form.nome && !form.nome.value) form.nome.value = state.conta.nome || "";
  if (form.contato && !form.contato.value)
    form.contato.value = state.conta.email || state.conta.telefone || "";
}

$("#btnTrocar").addEventListener("click", () => {
  state.role = null;
  updateNav();
  show("screen-home");
});

// ===================== CONTA / LOGIN =====================
$("#formConta").addEventListener("submit", async (e) => {
  e.preventDefault();
  const role = (e.submitter && e.submitter.dataset.role) || "adotante";
  const f = new FormData(e.target);
  const body = Object.fromEntries(f.entries());
  if (body.senha !== body.senha2) return toast("As senhas não conferem.");
  delete body.senha2;
  const btn = e.submitter;
  setLoading(btn, true, "Criando...");
  try {
    const conta = await api("/api/contas", { method: "POST", body });
    if (conta.erro) return toast(conta.erro);
    state.conta = conta;
    saveSession();
    updateNav();
    toast(`Conta criada! Bem-vindo(a), ${conta.nome}`);
    irParaPapel(role);
  } finally { setLoading(btn, false); }
});

$("#formLogin").addEventListener("submit", async (e) => {
  e.preventDefault();
  const btn = e.target.querySelector("button[type=submit]");
  setLoading(btn, true, "Entrando...");
  try {
    const conta = await api("/api/login", { method: "POST", body: Object.fromEntries(new FormData(e.target).entries()) });
    if (conta.erro) return toast(conta.erro);
    state.conta = conta;
    saveSession();
    updateNav();
    toast(`Olá de novo, ${conta.nome}!`);
    show("screen-home");
  } finally { setLoading(btn, false); }
});

$("#formDoador").addEventListener("submit", async (e) => {
  e.preventDefault();
  const btn = e.target.querySelector("button[type=submit]");
  setLoading(btn, true);
  try {
    const doador = await api("/api/doadores", { method: "POST", body: Object.fromEntries(new FormData(e.target).entries()) });
    if (doador.erro) return toast(doador.erro);
    state.doador = doador;
    saveSession();
    updateNav();
    startDoador();
  } finally { setLoading(btn, false); }
});

// ===================== ADOTANTE =====================
$("#formAdotante").addEventListener("submit", async (e) => {
  e.preventDefault();
  const body = Object.fromEntries(new FormData(e.target).entries());
  const btn = e.target.querySelector("button[type=submit]");
  setLoading(btn, true, "Salvando...");
  try {
    const adotante = await api("/api/adotantes", { method: "POST", body });
    if (adotante.erro) return toast(adotante.erro);
    state.adotante = adotante;
    saveSession();
    updateNav();
    startAdotante();
  } finally { setLoading(btn, false); }
});

async function startAdotante() {
  show("screen-swipe");
  setupTabs($("#screen-swipe .tabs"), (tab) => {
    if (tab === "meus-matches") loadMeusMatches();
  });
  await loadDeck();
}

async function loadDeck() {
  const deck = $("#deck");
  $(".swipe-actions").style.visibility = "hidden";
  deck.innerHTML = `<div class="empty"><span class="big">${ic("paw")}</span>
    Carregando bichinhos...<br><small>(o servidor pode levar alguns segundos para acordar)</small></div>`;
  try {
    const data = await api("/api/animais?adotanteId=" + state.adotante.id);
    state.deck = data.animais || [];
    renderDeck();
  } catch (e) {
    deck.innerHTML = `<div class="empty"><span class="big">${ic("paw")}</span>
      Não consegui carregar agora.<br>O servidor pode estar acordando.<br>
      <button class="primary" id="btnRetryDeck" style="margin-top:16px;width:auto;padding:12px 22px">Tentar de novo</button></div>`;
    const btn = $("#btnRetryDeck");
    if (btn) btn.addEventListener("click", loadDeck);
  }
}

// ícone SVG reutilizável (usa os <symbol> definidos no HTML)
function ic(name, cls) {
  return `<svg class="ic${cls ? " " + cls : ""}"><use href="#ic-${name}"/></svg>`;
}

function emojiEspecie(esp) {
  return ic("paw");  // patinha para todas as espécies (o texto já indica qual)
}

function selosSaude(a) {
  const selos = [];
  if (a.castrado) selos.push(`<span class="selo selo-ok">${ic("check")} Castrado</span>`);
  if (a.vacinado) selos.push(`<span class="selo selo-ok">${ic("check")} Vacinado</span>`);
  if (a.vermifugado) selos.push(`<span class="selo selo-ok">${ic("check")} Vermifugado</span>`);
  if (a.saude && a.saude.toLowerCase() !== "saudável" && a.saude.toLowerCase() !== "saudavel")
    selos.push(`<span class="selo selo-alerta">${ic("health")} ${escapeHtml(a.saude)}</span>`);
  return selos.join(" ");
}

function renderDeck() {
  const deck = $("#deck");
  deck.innerHTML = "";
  if (state.deck.length === 0) {
    deck.innerHTML = `<div class="empty"><span class="big">${ic("paw")}</span>
      Você viu todos os bichinhos por enquanto!<br>Volte mais tarde.</div>`;
    $(".swipe-actions").style.visibility = "hidden";
    return;
  }
  $(".swipe-actions").style.visibility = "visible";
  // renderiza no máx 3 cards empilhados (o topo é o último no DOM)
  const slice = state.deck.slice(0, 3).reverse();
  slice.forEach((animal, i) => {
    const isTop = i === slice.length - 1;
    const card = document.createElement("div");
    card.className = "swipe-card";
    card.style.transform = `scale(${1 - (slice.length - 1 - i) * 0.04}) translateY(${(slice.length - 1 - i) * 8}px)`;
    card.style.zIndex = i;
    const fotos = (animal.fotos && animal.fotos.length)
      ? animal.fotos : (animal.foto ? [animal.foto] : []);
    const primeira = fotos[0] || "";
    const fotoStyle = primeira ? `style="background-image:url('${primeira}')"` : "";
    const bars = fotos.length > 1
      ? `<div class="photo-bars">${fotos.map((_, k) =>
          `<span class="${k === 0 ? "active" : ""}"></span>`).join("")}</div>` : "";
    card.innerHTML = `
      <div class="photo" ${fotoStyle}>
        ${bars}
        ${primeira ? "" : `<div class="fallback">${emojiEspecie(animal.especie)}</div>`}
        <div class="tap tap-left"></div>
        <div class="tap tap-right"></div>
        <div class="stamp like">Quero!</div>
        <div class="stamp nope">Agora não</div>
        <div class="photo-scrim">
          <h3>${escapeHtml(animal.nome)} <span class="idade">${escapeHtml(animal.idade || "")}</span></h3>
          <div class="meta">${emojiEspecie(animal.especie)} ${escapeHtml(animal.raca || animal.especie)}${animal.porte ? " · " + escapeHtml(animal.porte) : ""}</div>
        </div>
      </div>
      <div class="info">
        <div class="tags">
          ${animal.energia ? `<span class="tag tag-energia">${ic("bolt")} Energia ${escapeHtml(animal.energia)}</span>` : ""}
          ${animal.atencao ? `<span class="tag">${ic("eye")} Atenção ${escapeHtml(animal.atencao)}</span>` : ""}
          ${animal.bomComCriancas ? `<span class="tag tag-ok">${ic("smile")} Crianças</span>` : ""}
          ${animal.bomComAnimais ? `<span class="tag tag-ok">${ic("paw")} Outros pets</span>` : ""}
        </div>
        <div class="selos">${selosSaude(animal)}</div>
        ${animal.precisaCuidadoEspecial ? `<div class="alerta-cuidado">${ic("alert")} Cuidados especiais: ${escapeHtml(animal.cuidadosEspeciais || animal.saude || "sim")}</div>` : ""}
        ${animal.temperamento ? `<div class="desc"><strong>Temperamento:</strong> ${escapeHtml(animal.temperamento)}</div>` : ""}
        ${animal.descricao ? `<div class="desc">${escapeHtml(animal.descricao)}</div>` : ""}
      </div>`;
    // trata foto quebrada (1ª foto)
    if (primeira) {
      const img = new Image();
      img.onerror = () => {
        const photo = card.querySelector(".photo");
        photo.style.backgroundImage = "";
        if (!photo.querySelector(".fallback"))
          photo.insertAdjacentHTML("afterbegin",
            `<div class="fallback">${emojiEspecie(animal.especie)}</div>`);
      };
      img.src = primeira;
    }
    deck.appendChild(card);
    if (isTop) {
      enableDrag(card, animal);
      enablePhotoNav(card, fotos);
    }
  });
}

function topAnimal() { return state.deck[0]; }

function enableDrag(card, animal) {
  let startX = 0, currentX = 0, dragging = false;
  const likeStamp = card.querySelector(".stamp.like");
  const nopeStamp = card.querySelector(".stamp.nope");

  const onDown = (x) => { dragging = true; startX = x; card._dragged = false; card.style.transition = "none"; };
  const onMove = (x) => {
    if (!dragging) return;
    currentX = x - startX;
    if (Math.abs(currentX) > 6) card._dragged = true;
    const rot = currentX / 18;
    card.style.transform = `translateX(${currentX}px) rotate(${rot}deg)`;
    likeStamp.style.opacity = currentX > 0 ? Math.min(currentX / 100, 1) : 0;
    nopeStamp.style.opacity = currentX < 0 ? Math.min(-currentX / 100, 1) : 0;
  };
  const onUp = () => {
    if (!dragging) return;
    dragging = false;
    card.style.transition = "transform .3s ease";
    if (currentX > 110) decide("like", animal, card, 1);
    else if (currentX < -110) decide("pass", animal, card, -1);
    else { card.style.transform = ""; likeStamp.style.opacity = 0; nopeStamp.style.opacity = 0; }
    currentX = 0;
  };

  card.addEventListener("mousedown", (e) => onDown(e.clientX));
  window.addEventListener("mousemove", (e) => onMove(e.clientX));
  window.addEventListener("mouseup", onUp);
  card.addEventListener("touchstart", (e) => onDown(e.touches[0].clientX), { passive: true });
  card.addEventListener("touchmove", (e) => onMove(e.touches[0].clientX), { passive: true });
  card.addEventListener("touchend", onUp);
}

// navegação entre fotos do card (toque/clique nas laterais)
function enablePhotoNav(card, fotos) {
  if (!fotos || fotos.length <= 1) return;
  let idx = 0;
  const photo = card.querySelector(".photo");
  const barras = card.querySelectorAll(".photo-bars span");
  const ir = (novo) => {
    idx = (novo + fotos.length) % fotos.length;
    photo.style.backgroundImage = `url('${fotos[idx]}')`;
    barras.forEach((b, k) => b.classList.toggle("active", k === idx));
  };
  const tapL = card.querySelector(".tap-left");
  const tapR = card.querySelector(".tap-right");
  if (tapL) tapL.addEventListener("click", () => { if (!card._dragged) ir(idx - 1); });
  if (tapR) tapR.addEventListener("click", () => { if (!card._dragged) ir(idx + 1); });
}

async function decide(decisao, animal, card, dir) {
  if (card) {
    card.style.transform = `translateX(${dir * 600}px) rotate(${dir * 30}deg)`;
    card.style.opacity = 0;
  }
  state.deck = state.deck.filter((a) => a.id !== animal.id);
  await api("/api/likes", {
    method: "POST",
    body: { adotanteId: state.adotante.id, animalId: animal.id, decisao },
  });
  if (decisao === "like") toast(`Você curtiu ${animal.nome}!`);
  setTimeout(renderDeck, 280);
}

// botões grandes
$("#btnLike").addEventListener("click", () => {
  const a = topAnimal(); if (!a) return;
  const card = $("#deck .swipe-card:last-child");
  decide("like", a, card, 1);
});
$("#btnPass").addEventListener("click", () => {
  const a = topAnimal(); if (!a) return;
  const card = $("#deck .swipe-card:last-child");
  decide("pass", a, card, -1);
});

async function loadMeusMatches() {
  const data = await api("/api/matches?adotanteId=" + state.adotante.id);
  const box = $("#meusMatches");
  const matches = data.matches || [];
  if (matches.length === 0) {
    box.innerHTML = `<div class="empty"><span class="big">${ic("mail")}</span>
      Nenhuma conexão ainda.<br>Quando um doador aceitar seu interesse, aparece aqui.</div>`;
    return;
  }
  box.innerHTML = matches.map((m) => `
    <div class="match-banner">
      <div class="mb-titulo">${m.adotado ? ic("check") + " Adoção concluída!" : ic("sparkle") + " Você se conectou com " + escapeHtml(m.animal.nome) + "!"}</div>
      <div>${m.adotado ? escapeHtml(m.animal.nome) + " · doado por " : "Doado por "}<strong>${escapeHtml(m.doador ? m.doador.nome : "")}</strong></div>
      <div class="contato">${ic("phone")} Contato: ${escapeHtml((m.doador && m.doador.contato) || "não informado")}</div>
      <button class="mo-cta" style="margin-top:12px" data-chat="${m.likeId}"
        data-titulo="${escapeHtml((m.doador ? m.doador.nome : "Doador") + " · " + m.animal.nome)}">Abrir conversa</button>
    </div>`).join("");

  box.querySelectorAll("button[data-chat]").forEach((btn) => {
    btn.addEventListener("click", () =>
      openChat(btn.dataset.chat, btn.dataset.titulo, "adotante"));
  });

  // anima a tela "É um Match!" para matches ainda não vistos
  const vistos = matchesVistos();
  const novos = matches.filter((m) => !vistos.includes(m.likeId));
  if (novos.length) {
    const m = novos[0];
    showMatchOverlay({
      subtitulo: `Você se conectou com ${m.animal.nome}!`,
      animalFoto: m.animal.foto,
      animalEmoji: emojiEspecie(m.animal.especie),
      parceiroEmoji: ic("house"),
      contato: m.doador && m.doador.contato,
      ctaLabel: "Abrir conversa",
      onCta: () => openChat(m.likeId,
        `${(m.doador && m.doador.nome) || "Doador"} · ${m.animal.nome}`, "adotante"),
    });
    marcarMatchesVistos(matches.map((x) => x.likeId));
  }
}

// ===================== DOADOR =====================
async function startDoador() {
  show("screen-doador");
  loadDoadorAnimais();
}

// "+ Cadastrar animal" -> abre o formulário
$("#btnNovoAnimal").addEventListener("click", () => {
  $("#formAnimal").reset();
  fotosUpload = [];
  renderPreviews();
  $("#lblCuidados").classList.add("hidden");
  show("screen-animal-cadastro");
});

// mostra o campo de detalhes só quando "cuidados especiais" está marcado
$("#chkCuidado").addEventListener("change", (e) => {
  $("#lblCuidados").classList.toggle("hidden", !e.target.checked);
});

// ---- upload de fotos: redimensiona no navegador e guarda como data URL ----
let fotosUpload = [];

function redimensionaImagem(file, max = 700, qualidade = 0.65) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        let { width, height } = img;
        if (width > height && width > max) { height = height * max / width; width = max; }
        else if (height > max) { width = width * max / height; height = max; }
        const canvas = document.createElement("canvas");
        canvas.width = width; canvas.height = height;
        canvas.getContext("2d").drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL("image/jpeg", qualidade));
      };
      img.onerror = reject;
      img.src = reader.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function renderPreviews() {
  const box = $("#fotoPreviews");
  box.innerHTML = fotosUpload.map((src, i) =>
    `<div class="foto-thumb" style="background-image:url('${src}')">
       <button type="button" class="foto-remove" data-i="${i}" title="Remover">✕</button>
     </div>`).join("");
  box.querySelectorAll(".foto-remove").forEach((b) =>
    b.addEventListener("click", () => {
      fotosUpload.splice(Number(b.dataset.i), 1);
      renderPreviews();
    }));
}

$("#fotoUpload").addEventListener("change", async (e) => {
  const files = [...e.target.files];
  if (!files.length) return;
  toast("Processando foto(s)...");
  for (const file of files) {
    try { fotosUpload.push(await redimensionaImagem(file)); }
    catch { toast("Não consegui ler uma das imagens."); }
  }
  e.target.value = "";
  renderPreviews();
});

$("#formAnimal").addEventListener("submit", async (e) => {
  e.preventDefault();
  const body = Object.fromEntries(new FormData(e.target).entries());
  body.doadorId = state.doador.id;
  // combina fotos enviadas (data URLs) + URLs coladas, enviando como ARRAY
  const urls = (body.fotos || "").split("\n").map((s) => s.trim()).filter(Boolean);
  body.fotos = [...fotosUpload, ...urls];
  const btn = e.target.querySelector("button[type=submit]");
  setLoading(btn, true, "Publicando...");
  try {
    const animal = await api("/api/animais", { method: "POST", body });
    if (animal.erro) return toast(animal.erro);
    e.target.reset();
    fotosUpload = [];
    renderPreviews();
    toast(`${animal.nome} publicado!`);
    show("screen-doador");
    loadDoadorAnimais();
  } finally { setLoading(btn, false); }
});

// ---- menu de animais do doador (status, curtidas, conversas) ----
async function loadDoadorAnimais() {
  const data = await api("/api/doador/animais?doadorId=" + state.doador.id);
  const box = $("#doadorAnimais");
  const animais = data.animais || [];
  if (animais.length === 0) {
    box.innerHTML = `<div class="empty"><span class="big">${ic("paw")}</span>
      Você ainda não cadastrou nenhum animal.<br>Toque em “Cadastrar animal” para começar.</div>`;
    return;
  }
  box.innerHTML = animais.map((a) => `
    <button class="item animal-item" data-animal="${a.id}">
      <div class="avatar" ${a.foto ? `style="background-image:url('${a.foto}')"` : ""}>${a.foto ? "" : ic("paw")}</div>
      <div class="body">
        <strong>${escapeHtml(a.nome)}
          <span class="status-pill ${a.adotado ? "status-aceito" : "status-pendente"}">${a.adotado ? "Doado" : "Disponível"}</span></strong>
        <small>${escapeHtml(a.raca || a.especie)} · ${escapeHtml(a.idade || "")} · ${escapeHtml(a.porte || "")}</small>
        <small class="animal-contadores">
          <span>${ic("heart")} ${a.curtidas} curtida${a.curtidas === 1 ? "" : "s"}</span>
          <span>${ic("chat")} ${a.conversas} conversa${a.conversas === 1 ? "" : "s"}</span>
        </small>
      </div>
      <span class="chevron">›</span>
    </button>`).join("");
  box.querySelectorAll(".animal-item").forEach((b) =>
    b.addEventListener("click", () => openAnimalPerfil(b.dataset.animal)));
}

// ---- perfil de gestão de um animal: interessados + conversas ----
async function openAnimalPerfil(animalId) {
  show("screen-doador-animal");
  const box = $("#animalPerfil");
  box.innerHTML = `<div class="empty"><span class="big">${ic("paw")}</span>Carregando...</div>`;
  const data = await api("/api/animal?animalId=" + animalId);
  if (data.erro) { box.innerHTML = `<p class="hint">${escapeHtml(data.erro)}</p>`; return; }
  const a = data.animal;
  const interessados = data.interessados || [];
  const conversas = data.conversas || [];
  box.innerHTML = `
    <div class="animal-cabecalho">
      <div class="avatar grande" ${a.foto ? `style="background-image:url('${a.foto}')"` : ""}>${a.foto ? "" : ic("paw")}</div>
      <div>
        <h2>${escapeHtml(a.nome)} <span class="status-pill ${a.adotado ? "status-aceito" : "status-pendente"}">${a.adotado ? "Doado" : "Disponível"}</span></h2>
        <p class="hint">${escapeHtml(a.raca || a.especie)} · ${escapeHtml(a.idade || "")} · ${escapeHtml(a.porte || "")}</p>
      </div>
    </div>

    <h3 class="section-title">${ic("heart")} Interessados (${interessados.length})</h3>
    <div class="list">${interessados.length
      ? interessados.map(renderInteressado).join("")
      : `<p class="hint">Ninguém curtiu este animal ainda.</p>`}</div>

    <h3 class="section-title">${ic("chat")} Conversas (${conversas.length})</h3>
    <div class="list">${conversas.length
      ? conversas.map((c) => renderConversaDoador(c, a.nome)).join("")
      : `<p class="hint">Nenhuma conversa iniciada. Aceite um interessado para começar.</p>`}</div>`;

  // clicar no card do interessado abre o perfil completo do adotante
  box.querySelectorAll(".interessado-card").forEach((card) =>
    card.addEventListener("click", (e) => {
      if (e.target.closest("button")) return; // cliques nos botões não abrem o perfil
      const r = interessados.find((x) => x.likeId === card.dataset.like);
      if (r) abrirPerfilAdotante(r, interessados, a);
    }));
  box.querySelectorAll("button[data-decidir]").forEach((btn) =>
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      decidirInteresse(btn.dataset.like, btn.dataset.status, interessados, a);
    }));
  box.querySelectorAll("button[data-chat]").forEach((btn) =>
    btn.addEventListener("click", () => openChat(btn.dataset.chat, btn.dataset.titulo, "doador")));
}

function renderInteressado(r) {
  const ad = r.adotante || {};
  return `
    <div class="item interessado-card" data-like="${r.likeId}">
      <div class="avatar">${ic("person")}</div>
      <div class="body">
        <strong>${escapeHtml(ad.nome || "Adotante")} ${ad.idade ? "· " + ad.idade + " anos" : ""}</strong>
        <small>${ic("briefcase")} ${escapeHtml(ad.profissao || "—")} · ${ic("house")} ${escapeHtml(ad.moradia || "—")}</small>
        <small>${ic("health")} Aceita cuidados especiais: <strong>${escapeHtml(ad.aceitaCuidadosEspeciais || "—")}</strong></small>
        <span class="ver-perfil">Ver perfil completo →</span>
      </div>
      <div class="actions">
        <button class="btn-aceitar" data-decidir data-like="${r.likeId}" data-status="aceito">Conversar</button>
        <button class="btn-recusar" data-decidir data-like="${r.likeId}" data-status="recusado">Recusar</button>
      </div>
    </div>`;
}

// perfil completo do adotante (para o doador avaliar o lar)
function abrirPerfilAdotante(r, interessados, animal) {
  const ad = r.adotante || {};
  const ov = $("#adotanteOverlay");
  const linha = (icone, rotulo, valor) =>
    `<div class="pa-linha">${ic(icone)}<span>${rotulo}</span><strong>${escapeHtml(valor || "—")}</strong></div>`;
  ov.innerHTML = `
    <div class="perfil-card">
      <div class="perfil-head">
        <div class="avatar">${ic("person")}</div>
        <div class="perfil-nome">
          <h3>${escapeHtml(ad.nome || "Adotante")}</h3>
          <p class="hint">${ad.idade ? escapeHtml(ad.idade) + " anos" : "Idade não informada"}</p>
        </div>
        <button class="chat-close" id="paFechar" title="Fechar">✕</button>
      </div>
      <div class="pa-linhas">
        ${linha("briefcase", "Profissão", ad.profissao)}
        ${linha("house", "Tipo de moradia", ad.moradia)}
        ${linha("phone", "Contato", ad.contato)}
        ${linha("health", "Aceita cuidados especiais", ad.aceitaCuidadosEspeciais)}
      </div>
      <h4 class="pa-sub">O que procura</h4>
      <div class="tags">
        <span class="tag">Espécie: ${escapeHtml(ad.especiePref || "Tanto faz")}</span>
        <span class="tag">Porte: ${escapeHtml(ad.portePref || "Tanto faz")}</span>
        <span class="tag tag-energia">Energia: ${escapeHtml(ad.energiaPref || "Tanto faz")}</span>
        ${ad.racaPref ? `<span class="tag">Raça: ${escapeHtml(ad.racaPref)}</span>` : ""}
      </div>
      ${ad.sobre ? `<h4 class="pa-sub">Sobre</h4><p class="pa-sobre">“${escapeHtml(ad.sobre)}”</p>` : ""}
      <div class="pa-acoes">
        <button class="btn-recusar" id="paRecusar">Recusar</button>
        <button class="btn-aceitar" id="paConversar">Conversar</button>
      </div>
    </div>`;
  ov.classList.remove("hidden");
  const fechar = () => ov.classList.add("hidden");
  $("#paFechar").addEventListener("click", fechar);
  $("#paConversar").addEventListener("click", () => { fechar(); decidirInteresse(r.likeId, "aceito", interessados, animal); });
  $("#paRecusar").addEventListener("click", () => { fechar(); decidirInteresse(r.likeId, "recusado", interessados, animal); });
}

function renderConversaDoador(c, animalNome) {
  const ad = c.adotante || {};
  return `
    <div class="item">
      <div class="avatar">${ic("person")}</div>
      <div class="body">
        <strong>${escapeHtml(ad.nome || "Adotante")} ${c.adotado ? `<span class="badge-adotado">${ic("check")} Adotado</span>` : ""}</strong>
        <small>${ic("phone")} ${escapeHtml(ad.contato || "contato não informado")}</small>
      </div>
      <div class="actions">
        <button class="btn-aceitar" data-chat="${c.likeId}"
          data-titulo="${escapeHtml((ad.nome || "Adotante") + " · " + animalNome)}">Abrir conversa</button>
      </div>
    </div>`;
}

async function decidirInteresse(likeId, status, interessados, animal) {
  toast(status === "aceito" ? "Aceitando..." : "Recusando...");
  await api("/api/decidir", { method: "POST", body: { likeId, status } });
  if (status === "aceito") {
    const r = (interessados || []).find((x) => x.likeId === likeId) || {};
    const ad = r.adotante || {};
    showMatchOverlay({
      subtitulo: `${ad.nome || "O adotante"} quer dar um lar pro ${animal.nome}`,
      animalFoto: animal.foto,
      animalEmoji: emojiEspecie(animal.especie),
      parceiroEmoji: ic("person"),
      contato: ad.contato,
      ctaLabel: "Abrir conversa",
      onCta: () => openChat(likeId, `${ad.nome || "Adotante"} · ${animal.nome}`, "doador"),
    });
  } else {
    toast("Interesse recusado.");
  }
  openAnimalPerfil(animal.id); // recarrega o perfil
}

// ===================== Tela "É um Match!" =====================
function showMatchOverlay(opts) {
  const ov = $("#matchOverlay");
  const fotoA = opts.animalFoto
    ? `style="background-image:url('${opts.animalFoto}')"` : "";
  ov.innerHTML = `
    <div class="mo-inner">
      <div class="mo-title">Vocês se encontraram!</div>
      <div class="mo-sub">${escapeHtml(opts.subtitulo || "")}</div>
      <div class="mo-photos">
        <div class="mo-photo" ${fotoA}>${opts.animalFoto ? "" : (opts.animalEmoji || ic("paw"))}</div>
        <div class="mo-heart">${ic("heart")}</div>
        <div class="mo-photo mo-emoji">${opts.parceiroEmoji || ic("person")}</div>
      </div>
      ${opts.contato ? `<div class="mo-contato">${ic("phone")} ${escapeHtml(opts.contato)}</div>` : ""}
      <button class="mo-cta">${escapeHtml(opts.ctaLabel || "Enviar mensagem")}</button>
      <button class="mo-close">Continuar vendo</button>
    </div>`;
  ov.classList.remove("hidden");
  const fechar = () => ov.classList.add("hidden");
  ov.querySelector(".mo-cta").addEventListener("click", () => {
    fechar();
    if (opts.onCta) opts.onCta();
  });
  ov.querySelector(".mo-close").addEventListener("click", fechar);
}

// matches já mostrados ao adotante (para só animar os novos)
function matchesVistos() {
  try { return JSON.parse(localStorage.getItem("adm_matches_vistos") || "[]"); }
  catch { return []; }
}
function marcarMatchesVistos(ids) {
  localStorage.setItem("adm_matches_vistos", JSON.stringify(ids));
}

// ===================== Chat + Termo de adoção =====================
let chatState = null;     // { likeId, autor }
let chatTimer = null;

// Texto do termo (modelo de protótipo — a responsabilidade é dos usuários)
const TERMO_HTML = `
  <p>Este termo formaliza o acordo de adoção diretamente entre o <strong>adotante</strong> e o <strong>doador</strong>.</p>
  <ol>
    <li>A adoção é um acordo <strong>direto entre as partes</strong>. A plataforma <strong>Focinhos</strong> apenas facilita o contato e <strong>não se responsabiliza</strong> pela adoção, pela entrega do animal, nem por acordos, custos, danos ou obrigações decorrentes.</li>
    <li>A <strong>entrega e a retirada do animal são combinadas e realizadas diretamente entre as partes</strong>, por conta e risco delas.</li>
    <li>O <strong>adotante</strong> declara adotar de forma voluntária e se compromete a cuidar do animal com responsabilidade — alimentação, abrigo, saúde, bem-estar e afeto — por toda a vida do animal.</li>
    <li>O <strong>doador</strong> declara que as informações fornecidas sobre o animal são verdadeiras.</li>
    <li>Ao assinar, ambas as partes declaram ter lido e concordado com estes termos.</li>
  </ol>
  <p class="termo-nota">Modelo para fins de protótipo; não substitui orientação jurídica.</p>`;

async function openChat(likeId, titulo, autor) {
  chatState = { likeId, autor };
  const modal = $("#chatModal");
  modal.innerHTML = `
    <div class="chat-box">
      <div class="chat-header">
        <span>${ic("chat")} ${escapeHtml(titulo)}</span>
        <button class="chat-close" title="Fechar">✕</button>
      </div>
      <div class="termo-bar" id="termoBar"></div>
      <div class="chat-msgs" id="chatMsgs"></div>
      <form class="chat-input" id="chatForm">
        <input id="chatText" placeholder="Escreva uma mensagem..." autocomplete="off" />
        <button type="submit">Enviar</button>
      </form>
    </div>`;
  modal.classList.remove("hidden");
  modal.querySelector(".chat-close").addEventListener("click", closeChat);
  modal.querySelector("#chatForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const input = $("#chatText");
    const texto = input.value.trim();
    if (!texto) return;
    input.value = "";
    await api("/api/mensagens", { method: "POST", body: { likeId, autor, texto } });
    await loadChatMsgs();
  });
  await refreshChat();
  $("#chatText").focus();
  chatTimer = setInterval(refreshChat, 2500); // recebe msgs e status do termo
}

async function refreshChat() {
  await loadChatMsgs();
  await loadTermo();
}

async function loadChatMsgs() {
  if (!chatState) return;
  const data = await api("/api/mensagens?likeId=" + chatState.likeId);
  const box = $("#chatMsgs");
  if (!box) return;
  const msgs = data.mensagens || [];
  box.innerHTML = msgs.length
    ? msgs.map((m) => `
        <div class="bubble ${m.autor === chatState.autor ? "mine" : "theirs"}">
          <span>${escapeHtml(m.texto)}</span><time>${escapeHtml(m.hora || "")}</time>
        </div>`).join("")
    : `<div class="chat-empty">Diga olá!<br>Combinem os detalhes da adoção.</div>`;
  box.scrollTop = box.scrollHeight;
}

async function loadTermo() {
  if (!chatState) return;
  const t = await api("/api/termo?likeId=" + chatState.likeId);
  const bar = $("#termoBar");
  if (!bar || t.erro) return;
  const termo = t.termo || {};
  const meu = termo[chatState.autor];
  const outro = termo[chatState.autor === "adotante" ? "doador" : "adotante"];
  if (t.adotado) {
    bar.className = "termo-bar finalizado";
    bar.innerHTML = `${ic("check")} <strong>Adoção finalizada!</strong> As duas partes assinaram o termo. Combinem a entrega do animal.`;
  } else if (meu) {
    bar.className = "termo-bar";
    bar.innerHTML = `${ic("check")} Você assinou o termo. Aguardando a outra parte assinar...`;
  } else {
    bar.className = "termo-bar acao";
    bar.innerHTML = `<span>${ic("alert")} ${outro
      ? "A outra parte já assinou. Falta você para concluir a adoção."
      : "Para concluir a adoção, as duas partes assinam o termo."}</span>
      <button class="btn-termo" id="btnAbrirTermo">Ver e assinar termo</button>`;
    const b = $("#btnAbrirTermo");
    if (b) b.addEventListener("click", abrirTermoOverlay);
  }
}

function abrirTermoOverlay() {
  const ov = $("#termoOverlay");
  const nome = (state.conta && state.conta.nome) ||
    (chatState.autor === "adotante" ? (state.adotante && state.adotante.nome) : (state.doador && state.doador.nome)) || "";
  ov.innerHTML = `
    <div class="termo-card">
      <h3>Termo de Responsabilidade pela Adoção</h3>
      <div class="termo-texto">${TERMO_HTML}</div>
      <label class="check termo-check"><input type="checkbox" id="termoAceito" /> Li e concordo com o termo acima.</label>
      <label>Assinatura (seu nome completo)<input id="termoNome" value="${escapeHtml(nome)}" /></label>
      <div class="termo-acoes">
        <button class="ghost" id="termoCancelar">Cancelar</button>
        <button class="primary" id="termoAssinar">Assinar termo</button>
      </div>
    </div>`;
  ov.classList.remove("hidden");
  $("#termoCancelar").addEventListener("click", () => ov.classList.add("hidden"));
  $("#termoAssinar").addEventListener("click", assinarTermo);
}

async function assinarTermo() {
  if (!$("#termoAceito").checked) return toast("Marque que leu e concorda com o termo.");
  const nome = $("#termoNome").value.trim();
  if (!nome) return toast("Informe seu nome para assinar.");
  const btn = $("#termoAssinar");
  setLoading(btn, true, "Assinando...");
  try {
    const r = await api("/api/termo/assinar", {
      method: "POST",
      body: { likeId: chatState.likeId, parte: chatState.autor, nome },
    });
    if (r.erro) { toast(r.erro); return; }
    $("#termoOverlay").classList.add("hidden");
    toast(r.finalizado
      ? "Adoção finalizada! Termo assinado pelas duas partes."
      : "Termo assinado! Aguardando a outra parte.");
    await loadTermo();
  } finally { setLoading(btn, false); }
}

function closeChat() {
  $("#chatModal").classList.add("hidden");
  if (chatTimer) clearInterval(chatTimer);
  chatTimer = null;
  chatState = null;
}

// ===================== util =====================
function setupTabs(container, onChange) {
  container.querySelectorAll(".tab").forEach((tab) => {
    tab.onclick = () => {
      setTab(container, tab.dataset.tab);
      onChange && onChange(tab.dataset.tab);
    };
  });
}

function escapeHtml(str) {
  return String(str == null ? "" : str)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

// ===================== init =====================
(function init() {
  const s = loadSession();
  Object.assign(state, s);
  updateNav();
  // sem conta -> landing; com conta -> hub de escolha de papel
  show(state.conta ? "screen-home" : "screen-landing");
})();
