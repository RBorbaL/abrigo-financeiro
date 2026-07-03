// ===================== Focinhos - frontend =====================

const api = async (path, opts = {}) => {
  const res = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...opts,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  return res.json();
};

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

const state = {
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
    role: state.role, adotante: state.adotante, doador: state.doador,
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

function updateNav() {
  const nav = $("#nav");
  if (state.role) {
    nav.classList.remove("hidden");
    const nome = state.role === "adotante"
      ? (state.adotante && state.adotante.nome)
      : (state.doador && state.doador.nome);
    $("#who").textContent = nome ? `${nome} (${state.role})` : state.role;
  } else {
    nav.classList.add("hidden");
  }
}

// ===================== HOME =====================
$$(".role-card").forEach((card) => {
  card.addEventListener("click", () => {
    state.role = card.dataset.role;
    if (state.role === "adotante") {
      if (state.adotante) startAdotante();
      else show("screen-adotante-cadastro");
    } else {
      ensureDoador().then(startDoador);
    }
    updateNav();
    saveSession();
  });
});

$("#btnTrocar").addEventListener("click", () => {
  state.role = null;
  updateNav();
  show("screen-home");
});

// ===================== ADOTANTE =====================
$("#formAdotante").addEventListener("submit", async (e) => {
  e.preventDefault();
  const f = new FormData(e.target);
  const body = Object.fromEntries(f.entries());
  const adotante = await api("/api/adotantes", { method: "POST", body });
  if (adotante.erro) return toast(adotante.erro);
  state.adotante = adotante;
  saveSession();
  updateNav();
  startAdotante();
});

async function startAdotante() {
  show("screen-swipe");
  setupTabs($("#screen-swipe .tabs"), (tab) => {
    if (tab === "meus-matches") loadMeusMatches();
  });
  await loadDeck();
}

async function loadDeck() {
  const data = await api("/api/animais?adotanteId=" + state.adotante.id);
  state.deck = data.animais || [];
  renderDeck();
}

function emojiEspecie(esp) {
  return esp === "Gato" ? "🐱" : esp === "Cachorro" ? "🐶" : "🐾";
}

function selosSaude(a) {
  const selos = [];
  if (a.castrado) selos.push(`<span class="selo selo-ok">✔ Castrado</span>`);
  if (a.vacinado) selos.push(`<span class="selo selo-ok">✔ Vacinado</span>`);
  if (a.vermifugado) selos.push(`<span class="selo selo-ok">✔ Vermifugado</span>`);
  if (a.saude && a.saude.toLowerCase() !== "saudável" && a.saude.toLowerCase() !== "saudavel")
    selos.push(`<span class="selo selo-alerta">🩺 ${escapeHtml(a.saude)}</span>`);
  return selos.join(" ");
}

function renderDeck() {
  const deck = $("#deck");
  deck.innerHTML = "";
  if (state.deck.length === 0) {
    deck.innerHTML = `<div class="empty"><span class="big">🐾</span>
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
          ${animal.energia ? `<span class="tag tag-energia">⚡ Energia ${escapeHtml(animal.energia)}</span>` : ""}
          ${animal.atencao ? `<span class="tag">👀 Atenção ${escapeHtml(animal.atencao)}</span>` : ""}
          ${animal.bomComCriancas ? `<span class="tag tag-ok">👶 Crianças</span>` : ""}
          ${animal.bomComAnimais ? `<span class="tag tag-ok">🐾 Outros pets</span>` : ""}
        </div>
        <div class="selos">${selosSaude(animal)}</div>
        ${animal.precisaCuidadoEspecial ? `<div class="alerta-cuidado">⚠️ Cuidados especiais: ${escapeHtml(animal.cuidadosEspeciais || animal.saude || "sim")}</div>` : ""}
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
  if (decisao === "like") toast(`Você curtiu ${animal.nome}! 💚`);
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
    box.innerHTML = `<div class="empty"><span class="big">💌</span>
      Nenhuma conexão ainda.<br>Quando um doador aceitar seu interesse, aparece aqui.</div>`;
    return;
  }
  box.innerHTML = matches.map((m) => `
    <div class="match-banner">
      <div style="font-size:1.5rem">🎉 Você se conectou com ${escapeHtml(m.animal.nome)}!</div>
      <div>Doado por <strong>${escapeHtml(m.doador ? m.doador.nome : "")}</strong></div>
      <div class="contato">📞 Contato: ${escapeHtml((m.doador && m.doador.contato) || "não informado")}</div>
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
      parceiroEmoji: "🏡",
      contato: m.doador && m.doador.contato,
      ctaLabel: "Abrir conversa",
      onCta: () => openChat(m.likeId,
        `${(m.doador && m.doador.nome) || "Doador"} · ${m.animal.nome}`, "adotante"),
    });
    marcarMatchesVistos(matches.map((x) => x.likeId));
  }
}

// ===================== DOADOR =====================
async function ensureDoador() {
  if (state.doador) return;
  // cria um doador simples na hora (poderia ter form próprio)
  const nome = prompt("Seu nome ou nome do abrigo:", "Meu Lar");
  const tipo = confirm("Você é um ABRIGO? (OK = abrigo, Cancelar = pessoa física)")
    ? "abrigo" : "pessoa";
  const contato = prompt("Contato (e-mail ou telefone):", "") || "";
  const doador = await api("/api/doadores", {
    method: "POST", body: { nome: nome || "Doador", tipo, contato },
  });
  state.doador = doador;
  saveSession();
  updateNav();
}

async function startDoador() {
  show("screen-doador");
  setupTabs($("#screen-doador .tabs"), (tab) => {
    if (tab === "recebidas") loadRecebidas();
    if (tab === "conversas") loadConversasDoador();
    if (tab === "cadastrar") loadMeusAnimais();
  });
  loadMeusAnimais();
  loadRecebidas(); // atualiza badge
}

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
  const f = new FormData(e.target);
  const body = Object.fromEntries(f.entries());
  body.doadorId = state.doador.id;
  // combina fotos enviadas (data URLs) + URLs coladas, enviando como ARRAY
  const urls = (body.fotos || "").split("\n").map((s) => s.trim()).filter(Boolean);
  body.fotos = [...fotosUpload, ...urls];
  const animal = await api("/api/animais", { method: "POST", body });
  if (animal.erro) return toast(animal.erro);
  e.target.reset();
  fotosUpload = [];
  renderPreviews();
  toast(`${animal.nome} publicado! 🐾`);
  loadMeusAnimais();
});

async function loadMeusAnimais() {
  const data = await api("/api/animais?doadorId=" + state.doador.id);
  const box = $("#meusAnimais");
  const animais = data.animais || [];
  if (animais.length === 0) {
    box.innerHTML = `<p class="hint">Nenhum animal publicado ainda.</p>`;
    return;
  }
  box.innerHTML = animais.map((a) => `
    <div class="item">
      <div class="avatar" ${a.foto ? `style="background-image:url('${a.foto}')"` : ""}>
        ${a.foto ? "" : emojiEspecie(a.especie)}</div>
      <div class="body">
        <strong>${escapeHtml(a.nome)}</strong>
        <small>${escapeHtml(a.raca || a.especie)} · ${escapeHtml(a.idade || "")} · ${escapeHtml(a.porte || "")}</small>
        <small>⚡ Energia ${escapeHtml(a.energia || "—")} · 👀 Atenção ${escapeHtml(a.atencao || "—")}</small>
        <div class="selos">${selosSaude(a)}</div>
        ${a.precisaCuidadoEspecial ? `<small class="txt-alerta">⚠️ Cuidados especiais: ${escapeHtml(a.cuidadosEspeciais || a.saude || "sim")}</small>` : ""}
      </div>
    </div>`).join("");
}

async function loadRecebidas() {
  const data = await api("/api/recebidas?doadorId=" + state.doador.id);
  const recebidas = (data.recebidas || []).filter((r) => r.status === "pendente");
  const box = $("#recebidas");
  const badge = $("#badgeRecebidas");
  if (recebidas.length > 0) {
    badge.textContent = recebidas.length;
    badge.classList.remove("hidden");
  } else {
    badge.classList.add("hidden");
  }
  if (recebidas.length === 0) {
    box.innerHTML = `<div class="empty"><span class="big">📭</span>
      Nenhuma curtida pendente.</div>`;
    return;
  }
  box.innerHTML = recebidas.map((r) => {
    const ad = r.adotante || {};
    return `
    <div class="item">
      <div class="avatar">🙋</div>
      <div class="body">
        <strong>${escapeHtml(ad.nome || "Adotante")} ${ad.idade ? "· " + ad.idade + " anos" : ""}</strong>
        <small>💼 ${escapeHtml(ad.profissao || "—")} · 🏠 ${escapeHtml(ad.moradia || "—")}</small>
        <small>❤ Curtiu: <strong>${escapeHtml(r.animal.nome)}</strong></small>
        <small>🩺 Aceita cuidados especiais: <strong>${escapeHtml(ad.aceitaCuidadosEspeciais || "—")}</strong></small>
        ${ad.sobre ? `<small>“${escapeHtml(ad.sobre)}”</small>` : ""}
        ${ad.contato ? `<small>📞 ${escapeHtml(ad.contato)}</small>` : ""}
      </div>
      <div class="actions">
        <button class="btn-aceitar" data-like="${r.likeId}" data-status="aceito">Conversar</button>
        <button class="btn-recusar" data-like="${r.likeId}" data-status="recusado">Recusar</button>
      </div>
    </div>`;
  }).join("");

  box.querySelectorAll("button[data-like]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      await api("/api/decidir", {
        method: "POST",
        body: { likeId: btn.dataset.like, status: btn.dataset.status },
      });
      if (btn.dataset.status === "aceito") {
        const r = recebidas.find((x) => x.likeId === btn.dataset.like) || {};
        const ad = r.adotante || {};
        showMatchOverlay({
          subtitulo: `${ad.nome || "O adotante"} quer dar um lar pro ${r.animal ? r.animal.nome : "pet"}`,
          animalFoto: r.animal && r.animal.foto,
          animalEmoji: r.animal ? emojiEspecie(r.animal.especie) : "🐾",
          parceiroEmoji: "🙋",
          contato: ad.contato,
          ctaLabel: "Abrir conversa",
          onCta: () => openChat(btn.dataset.like,
            `${ad.nome || "Adotante"} · ${r.animal ? r.animal.nome : ""}`, "doador"),
        });
      } else {
        toast("Curtida recusada.");
      }
      loadRecebidas();
    });
  });
}

async function loadConversasDoador() {
  const data = await api("/api/matches?doadorId=" + state.doador.id);
  const box = $("#conversasDoador");
  const matches = data.matches || [];
  if (matches.length === 0) {
    box.innerHTML = `<div class="empty"><span class="big">💬</span>
      Nenhuma conversa iniciada ainda.</div>`;
    return;
  }
  box.innerHTML = matches.map((m) => {
    const ad = m.adotante || {};
    return `
    <div class="item">
      <div class="avatar">🙋</div>
      <div class="body">
        <strong>${escapeHtml(ad.nome || "Adotante")}</strong>
        <small>Interessado(a) em <strong>${escapeHtml(m.animal.nome)}</strong></small>
        <small>📞 ${escapeHtml(ad.contato || "contato não informado")}</small>
      </div>
      <div class="actions">
        <button class="btn-aceitar" data-chat="${m.likeId}"
          data-titulo="${escapeHtml((ad.nome || "Adotante") + " · " + m.animal.nome)}">Abrir conversa</button>
      </div>
    </div>`;
  }).join("");

  box.querySelectorAll("button[data-chat]").forEach((btn) => {
    btn.addEventListener("click", () =>
      openChat(btn.dataset.chat, btn.dataset.titulo, "doador"));
  });
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
        <div class="mo-photo" ${fotoA}>${opts.animalFoto ? "" : (opts.animalEmoji || "🐾")}</div>
        <div class="mo-heart">❤</div>
        <div class="mo-photo mo-emoji">${opts.parceiroEmoji || "🙋"}</div>
      </div>
      ${opts.contato ? `<div class="mo-contato">📞 ${escapeHtml(opts.contato)}</div>` : ""}
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

// ===================== Chat =====================
let chatState = null;     // { likeId, autor }
let chatTimer = null;

async function openChat(likeId, titulo, autor) {
  chatState = { likeId, autor };
  const modal = $("#chatModal");
  modal.innerHTML = `
    <div class="chat-box">
      <div class="chat-header">
        <span>💬 ${escapeHtml(titulo)}</span>
        <button class="chat-close" title="Fechar">✕</button>
      </div>
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
  await loadChatMsgs();
  $("#chatText").focus();
  chatTimer = setInterval(loadChatMsgs, 2500); // recebe msgs do outro lado
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
    : `<div class="chat-empty">Diga olá! 👋<br>Combinem os detalhes da adoção.</div>`;
  box.scrollTop = box.scrollHeight;
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
  // sempre começa na home (usuário escolhe o papel); perfis ficam lembrados
  show("screen-home");
})();
