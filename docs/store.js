// =====================================================================
// Focinhos - backend estático (roda 100% no navegador, sobre localStorage)
// Replica a API do server.py para a versão publicada no GitHub Pages.
// =====================================================================
(function () {
  const KEY = "focinhos_data";

  function newId() {
    return (
      Math.random().toString(16).slice(2, 10) +
      Math.random().toString(16).slice(2, 6)
    );
  }

  function horaAgora() {
    const d = new Date();
    return (
      String(d.getHours()).padStart(2, "0") +
      ":" +
      String(d.getMinutes()).padStart(2, "0")
    );
  }

  // ---- dados iniciais (espelham o seed do server.py) ----
  function seed() {
    return {
      doadores: [
        { id: "seed-doador-1", nome: "Abrigo Patas Felizes", tipo: "abrigo", contato: "contato@patasfelizes.org" },
        { id: "seed-doador-2", nome: "Mariana Souza", tipo: "pessoa", contato: "mariana@email.com" },
      ],
      animais: [
        {
          id: "seed-an-1", doadorId: "seed-doador-1", nome: "Thor", especie: "Cachorro",
          raca: "Vira-lata caramelo", idade: "2 anos", porte: "Médio",
          energia: "Alta", atencao: "Média", castrado: true, vacinado: true, vermifugado: true,
          saude: "Saudável", precisaCuidadoEspecial: false, cuidadosEspeciais: "",
          temperamento: "Brincalhão e sociável", bomComCriancas: true, bomComAnimais: true,
          descricao: "Cheio de energia, adora correr. Ideal para quem tem quintal e tempo para passeios.",
          foto: "https://place-puppy.com/300x300",
          fotos: ["https://place-puppy.com/300x300", "https://place-puppy.com/305x305", "https://place-puppy.com/310x310"],
        },
        {
          id: "seed-an-2", doadorId: "seed-doador-2", nome: "Mel", especie: "Gato",
          raca: "SRD", idade: "1 ano", porte: "Pequeno",
          energia: "Baixa", atencao: "Baixa", castrado: true, vacinado: true, vermifugado: true,
          saude: "Saudável", precisaCuidadoEspecial: false, cuidadosEspeciais: "",
          temperamento: "Carinhosa e tranquila", bomComCriancas: true, bomComAnimais: true,
          descricao: "Calma e independente. Perfeita para apartamento.",
          foto: "https://placekitten.com/300/300",
          fotos: ["https://placekitten.com/300/300", "https://placekitten.com/302/302"],
        },
        {
          id: "seed-an-3", doadorId: "seed-doador-1", nome: "Bidu", especie: "Cachorro",
          raca: "Beagle", idade: "4 meses", porte: "Pequeno",
          energia: "Alta", atencao: "Alta", castrado: false, vacinado: true, vermifugado: true,
          saude: "Saudável", precisaCuidadoEspecial: false, cuidadosEspeciais: "",
          temperamento: "Filhote agitado, em fase de adestramento", bomComCriancas: true, bomComAnimais: true,
          descricao: "Filhote que exige atenção, treino e companhia. Não fica bem sozinho o dia todo.",
          foto: "https://place-puppy.com/301x301",
          fotos: ["https://place-puppy.com/301x301", "https://place-puppy.com/306x306"],
        },
        {
          id: "seed-an-4", doadorId: "seed-doador-2", nome: "Nina", especie: "Gato",
          raca: "Siamês", idade: "3 anos", porte: "Pequeno",
          energia: "Média", atencao: "Média", castrado: true, vacinado: true, vermifugado: true,
          saude: "Saudável", precisaCuidadoEspecial: false, cuidadosEspeciais: "",
          temperamento: "Independente, mas afetuosa no fim do dia", bomComCriancas: false, bomComAnimais: false,
          descricao: "Prefere ser a única pet da casa. Ótima para quem busca companhia discreta.",
          foto: "https://placekitten.com/301/301",
          fotos: ["https://placekitten.com/301/301", "https://placekitten.com/303/303"],
        },
        {
          id: "seed-an-5", doadorId: "seed-doador-1", nome: "Bono", especie: "Cachorro",
          raca: "Labrador", idade: "6 anos", porte: "Grande",
          energia: "Média", atencao: "Alta", castrado: true, vacinado: true, vermifugado: true,
          saude: "Cego de um olho; toma medicação contínua para artrose",
          precisaCuidadoEspecial: true,
          cuidadosEspeciais: "Remédio diário para articulação e visita ao vet a cada 3 meses",
          temperamento: "Dócil, calmo e muito apegado", bomComCriancas: true, bomComAnimais: true,
          descricao: "Pet especial que precisa de um tutor paciente. Retribui com muito amor.",
          foto: "https://place-puppy.com/302x302",
          fotos: ["https://place-puppy.com/302x302", "https://place-puppy.com/307x307", "https://place-puppy.com/312x312"],
        },
      ],
      adotantes: [],
      likes: [],
      mensagens: [],
    };
  }

  function load() {
    let d = null;
    try { d = JSON.parse(localStorage.getItem(KEY)); } catch (e) {}
    if (!d) { d = seed(); save(d); }
    d.doadores = d.doadores || [];
    d.adotantes = d.adotantes || [];
    d.animais = d.animais || [];
    d.likes = d.likes || [];
    d.mensagens = d.mensagens || [];
    return d;
  }
  function save(d) { localStorage.setItem(KEY, JSON.stringify(d)); }

  // filtro de swipe por preferências (espelha combina_com_preferencias)
  function combinaComPreferencias(animal, ad) {
    const esp = ad.especiePref || "Tanto faz";
    if (esp && esp !== "Tanto faz" && animal.especie !== esp) return false;
    const porte = ad.portePref || "Tanto faz";
    if (porte && porte !== "Tanto faz" && animal.porte !== porte) return false;
    const energia = ad.energiaPref || "Tanto faz";
    if (energia && energia !== "Tanto faz" && animal.energia !== energia) return false;
    if (ad.aceitaCuidadosEspeciais === "Não" && animal.precisaCuidadoEspecial) return false;
    return true;
  }

  // ---- roteador (espelha api_handle) ----
  function handle(method, path, query, body) {
    const data = load();

    if (path === "/api/doadores" && method === "POST") {
      const doador = {
        id: newId(), nome: (body.nome || "").trim(),
        tipo: body.tipo || "pessoa", contato: (body.contato || "").trim(),
      };
      if (!doador.nome) return { erro: "Nome é obrigatório" };
      data.doadores.push(doador); save(data); return doador;
    }

    if (path === "/api/adotantes" && method === "POST") {
      const adotante = {
        id: newId(), nome: (body.nome || "").trim(), idade: body.idade || "",
        profissao: (body.profissao || "").trim(), moradia: body.moradia || "",
        sobre: (body.sobre || "").trim(), contato: (body.contato || "").trim(),
        especiePref: body.especiePref || "Tanto faz", portePref: body.portePref || "Tanto faz",
        energiaPref: body.energiaPref || "Tanto faz", racaPref: (body.racaPref || "").trim(),
        aceitaCuidadosEspeciais: body.aceitaCuidadosEspeciais || "Sim",
      };
      if (!adotante.nome) return { erro: "Nome é obrigatório" };
      data.adotantes.push(adotante); save(data); return adotante;
    }

    if (path === "/api/animais" && method === "POST") {
      const animal = {
        id: newId(), doadorId: body.doadorId || "", nome: (body.nome || "").trim(),
        especie: body.especie || "", raca: (body.raca || "").trim(),
        idade: (body.idade || "").trim(), porte: body.porte || "",
        descricao: (body.descricao || "").trim(),
        energia: body.energia || "Média", atencao: body.atencao || "Média",
        castrado: !!body.castrado, vacinado: !!body.vacinado, vermifugado: !!body.vermifugado,
        saude: (body.saude || "").trim(), precisaCuidadoEspecial: !!body.precisaCuidadoEspecial,
        cuidadosEspeciais: (body.cuidadosEspeciais || "").trim(),
        temperamento: (body.temperamento || "").trim(),
        bomComCriancas: !!body.bomComCriancas, bomComAnimais: !!body.bomComAnimais,
      };
      let fotos = [];
      if (Array.isArray(body.fotos)) {
        fotos = body.fotos.map((f) => String(f).trim()).filter(Boolean);
      } else {
        fotos = String(body.fotos || "").replace(/,/g, "\n").split("\n")
          .map((s) => s.trim()).filter(Boolean);
      }
      const fotoSingle = (body.foto || "").trim();
      if (!fotos.length && fotoSingle) fotos = [fotoSingle];
      animal.fotos = fotos;
      animal.foto = fotos.length ? fotos[0] : "";
      if (!animal.nome || !animal.doadorId) return { erro: "Nome e doadorId são obrigatórios" };
      data.animais.push(animal); save(data); return animal;
    }

    if (path === "/api/animais" && method === "GET") {
      const doadorId = query.doadorId;
      const adotanteId = query.adotanteId;
      let animais = data.animais;
      if (doadorId) {
        animais = animais.filter((a) => a.doadorId === doadorId);
      } else if (adotanteId) {
        const avaliados = new Set(
          data.likes.filter((l) => l.adotanteId === adotanteId).map((l) => l.animalId)
        );
        const adotante = data.adotantes.find((a) => a.id === adotanteId);
        animais = animais.filter((a) => !avaliados.has(a.id));
        if (adotante) animais = animais.filter((a) => combinaComPreferencias(a, adotante));
      }
      return { animais };
    }

    if (path === "/api/likes" && method === "POST") {
      const adotanteId = body.adotanteId || "";
      const animalId = body.animalId || "";
      const decisao = body.decisao || "like";
      if (!adotanteId || !animalId) return { erro: "adotanteId e animalId obrigatórios" };
      const like = {
        id: newId(), adotanteId, animalId, decisao,
        status: decisao === "like" ? "pendente" : "ignorado",
      };
      data.likes.push(like); save(data); return like;
    }

    if (path === "/api/recebidas" && method === "GET") {
      const doadorId = query.doadorId;
      if (!doadorId) return { erro: "doadorId obrigatório" };
      const meusAnimais = {};
      data.animais.filter((a) => a.doadorId === doadorId).forEach((a) => (meusAnimais[a.id] = a));
      const adotantes = {};
      data.adotantes.forEach((a) => (adotantes[a.id] = a));
      const resultado = [];
      data.likes.forEach((l) => {
        if (l.decisao !== "like") return;
        if (!meusAnimais[l.animalId]) return;
        resultado.push({
          likeId: l.id, status: l.status,
          animal: meusAnimais[l.animalId], adotante: adotantes[l.adotanteId],
        });
      });
      return { recebidas: resultado };
    }

    if (path === "/api/decidir" && method === "POST") {
      const status = body.status || "";
      if (status !== "aceito" && status !== "recusado")
        return { erro: "status deve ser 'aceito' ou 'recusado'" };
      const like = data.likes.find((l) => l.id === body.likeId);
      if (!like) return { erro: "like não encontrado" };
      like.status = status; save(data); return like;
    }

    if (path === "/api/matches" && method === "GET") {
      const adotanteId = query.adotanteId;
      const doadorId = query.doadorId;
      const animais = {}; data.animais.forEach((a) => (animais[a.id] = a));
      const adotantes = {}; data.adotantes.forEach((a) => (adotantes[a.id] = a));
      const doadores = {}; data.doadores.forEach((d) => (doadores[d.id] = d));
      const matches = [];
      data.likes.forEach((l) => {
        if (l.status !== "aceito") return;
        const animal = animais[l.animalId];
        if (!animal) return;
        if (adotanteId && l.adotanteId !== adotanteId) return;
        if (doadorId && animal.doadorId !== doadorId) return;
        matches.push({
          likeId: l.id, animal,
          adotante: adotantes[l.adotanteId], doador: doadores[animal.doadorId],
        });
      });
      return { matches };
    }

    if (path === "/api/mensagens" && method === "POST") {
      const likeId = body.likeId || "";
      const autor = body.autor || "";
      const texto = (body.texto || "").trim();
      if (!likeId || (autor !== "adotante" && autor !== "doador") || !texto)
        return { erro: "likeId, autor e texto são obrigatórios" };
      const like = data.likes.find((l) => l.id === likeId);
      if (!like || like.status !== "aceito") return { erro: "conversa não disponível" };
      const msg = { id: newId(), likeId, autor, texto, hora: horaAgora() };
      data.mensagens.push(msg); save(data); return msg;
    }

    if (path === "/api/mensagens" && method === "GET") {
      const likeId = query.likeId;
      return { mensagens: data.mensagens.filter((m) => m.likeId === likeId) };
    }

    return { erro: "Rota não encontrada" };
  }

  // expõe a mesma assinatura que o app espera de api()
  window.localApi = function (path, opts) {
    opts = opts || {};
    const method = opts.method || "GET";
    const [p, qs] = path.split("?");
    const query = {};
    if (qs) {
      qs.split("&").forEach((kv) => {
        const [k, v] = kv.split("=");
        query[decodeURIComponent(k)] = decodeURIComponent(v || "");
      });
    }
    let body = {};
    if (opts.body) body = typeof opts.body === "string" ? JSON.parse(opts.body) : opts.body;
    return Promise.resolve(handle(method, p, query, body));
  };
})();
