"""
AdotaMatch - "Tinder" de adoção de animais.

Servidor HTTP em Python puro (somente biblioteca padrão).
- Serve os arquivos estáticos da pasta ./public
- Expõe uma API JSON em /api/*
- Persiste os dados em ./data.json

Rodar:
    python server.py
Depois abra http://localhost:8000
"""

import json
import os
import uuid
import threading
from datetime import datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
PUBLIC_DIR = os.path.join(BASE_DIR, "public")
DATA_FILE = os.path.join(BASE_DIR, "data.json")

# Persistência: se DATABASE_URL estiver definido (ex.: Neon/Postgres no Render),
# o estado é guardado no banco; caso contrário, cai no arquivo local (dev).
DATABASE_URL = os.environ.get("DATABASE_URL", "").strip()

_lock = threading.Lock()

# --------------------------------------------------------------------------
# Armazenamento (arquivo JSON)
# --------------------------------------------------------------------------

def _seed():
    """Dados iniciais para o app já nascer com animais para dar swipe."""
    return {
        "doadores": [
            {"id": "seed-doador-1", "nome": "Abrigo Patas Felizes",
             "tipo": "abrigo", "contato": "contato@patasfelizes.org"},
            {"id": "seed-doador-2", "nome": "Mariana Souza",
             "tipo": "pessoa", "contato": "mariana@email.com"},
        ],
        "animais": [
            {"id": "seed-an-1", "doadorId": "seed-doador-1",
             "nome": "Thor", "especie": "Cachorro", "raca": "Vira-lata caramelo",
             "idade": "2 anos", "porte": "Médio",
             "energia": "Alta", "atencao": "Média",
             "castrado": True, "vacinado": True, "vermifugado": True,
             "saude": "Saudável", "precisaCuidadoEspecial": False, "cuidadosEspeciais": "",
             "temperamento": "Brincalhão e sociável",
             "bomComCriancas": True, "bomComAnimais": True,
             "descricao": "Cheio de energia, adora correr. Ideal para quem tem quintal e tempo para passeios.",
             "foto": "https://place-puppy.com/300x300",
             "fotos": ["https://place-puppy.com/300x300", "https://place-puppy.com/305x305", "https://place-puppy.com/310x310"]},
            {"id": "seed-an-2", "doadorId": "seed-doador-2",
             "nome": "Mel", "especie": "Gato", "raca": "SRD",
             "idade": "1 ano", "porte": "Pequeno",
             "energia": "Baixa", "atencao": "Baixa",
             "castrado": True, "vacinado": True, "vermifugado": True,
             "saude": "Saudável", "precisaCuidadoEspecial": False, "cuidadosEspeciais": "",
             "temperamento": "Carinhosa e tranquila",
             "bomComCriancas": True, "bomComAnimais": True,
             "descricao": "Calma e independente. Perfeita para apartamento.",
             "foto": "https://placekitten.com/300/300",
             "fotos": ["https://placekitten.com/300/300", "https://placekitten.com/302/302"]},
            {"id": "seed-an-3", "doadorId": "seed-doador-1",
             "nome": "Bidu", "especie": "Cachorro", "raca": "Beagle",
             "idade": "4 meses", "porte": "Pequeno",
             "energia": "Alta", "atencao": "Alta",
             "castrado": False, "vacinado": True, "vermifugado": True,
             "saude": "Saudável", "precisaCuidadoEspecial": False, "cuidadosEspeciais": "",
             "temperamento": "Filhote agitado, em fase de adestramento",
             "bomComCriancas": True, "bomComAnimais": True,
             "descricao": "Filhote que exige atenção, treino e companhia. Não fica bem sozinho o dia todo.",
             "foto": "https://place-puppy.com/301x301",
             "fotos": ["https://place-puppy.com/301x301", "https://place-puppy.com/306x306"]},
            {"id": "seed-an-4", "doadorId": "seed-doador-2",
             "nome": "Nina", "especie": "Gato", "raca": "Siamês",
             "idade": "3 anos", "porte": "Pequeno",
             "energia": "Média", "atencao": "Média",
             "castrado": True, "vacinado": True, "vermifugado": True,
             "saude": "Saudável", "precisaCuidadoEspecial": False, "cuidadosEspeciais": "",
             "temperamento": "Independente, mas afetuosa no fim do dia",
             "bomComCriancas": False, "bomComAnimais": False,
             "descricao": "Prefere ser a única pet da casa. Ótima para quem busca companhia discreta.",
             "foto": "https://placekitten.com/301/301",
             "fotos": ["https://placekitten.com/301/301", "https://placekitten.com/303/303"]},
            {"id": "seed-an-5", "doadorId": "seed-doador-1",
             "nome": "Bono", "especie": "Cachorro", "raca": "Labrador",
             "idade": "6 anos", "porte": "Grande",
             "energia": "Média", "atencao": "Alta",
             "castrado": True, "vacinado": True, "vermifugado": True,
             "saude": "Cego de um olho; toma medicação contínua para artrose",
             "precisaCuidadoEspecial": True,
             "cuidadosEspeciais": "Remédio diário para articulação e visita ao vet a cada 3 meses",
             "temperamento": "Dócil, calmo e muito apegado",
             "bomComCriancas": True, "bomComAnimais": True,
             "descricao": "Pet especial que precisa de um tutor paciente. Retribui com muito amor.",
             "foto": "https://place-puppy.com/302x302",
             "fotos": ["https://place-puppy.com/302x302", "https://place-puppy.com/307x307", "https://place-puppy.com/312x312"]},
        ],
        "adotantes": [],
        "likes": [],
        "mensagens": [],
    }


def _db_connect():
    import psycopg2
    # connect_timeout evita que o boot/uma requisição trave indefinidamente
    # se o banco estiver inacessível.
    return psycopg2.connect(DATABASE_URL, connect_timeout=10)


def _db_ensure_schema(cur):
    cur.execute(
        "CREATE TABLE IF NOT EXISTS app_state "
        "(id int PRIMARY KEY, data jsonb NOT NULL)"
    )


def load_data():
    if DATABASE_URL:
        from psycopg2.extras import Json
        conn = _db_connect()
        try:
            with conn:
                with conn.cursor() as cur:
                    _db_ensure_schema(cur)  # cria a tabela se ainda não existir
                    cur.execute("SELECT data FROM app_state WHERE id = 1")
                    row = cur.fetchone()
                    if row is None:
                        seed = _seed()
                        cur.execute(
                            "INSERT INTO app_state (id, data) VALUES (1, %s)",
                            [Json(seed)],
                        )
                        return seed
                    data = row[0]
                    return json.loads(data) if isinstance(data, str) else data
        finally:
            conn.close()
    # fallback: arquivo local (desenvolvimento)
    if not os.path.exists(DATA_FILE):
        save_data(_seed())
    with open(DATA_FILE, "r", encoding="utf-8") as f:
        return json.load(f)


def save_data(data):
    if DATABASE_URL:
        from psycopg2.extras import Json
        conn = _db_connect()
        try:
            with conn:
                with conn.cursor() as cur:
                    _db_ensure_schema(cur)
                    cur.execute(
                        "INSERT INTO app_state (id, data) VALUES (1, %s) "
                        "ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data",
                        [Json(data)],
                    )
        finally:
            conn.close()
        return
    # fallback: arquivo local (desenvolvimento)
    tmp = DATA_FILE + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    os.replace(tmp, DATA_FILE)


def new_id():
    return uuid.uuid4().hex[:12]


def combina_com_preferencias(animal, adotante):
    """Filtra a fila de swipe segundo as preferências do adotante.

    Filtros 'duros' quando o adotante escolhe um valor específico:
    espécie, porte e energia. Animais que precisam de cuidados especiais
    são ocultados se o adotante declarou não aceitar. Raça é apenas
    informativa (texto livre), não filtra.
    """
    esp = adotante.get("especiePref", "Tanto faz")
    if esp and esp != "Tanto faz" and animal.get("especie") != esp:
        return False
    porte = adotante.get("portePref", "Tanto faz")
    if porte and porte != "Tanto faz" and animal.get("porte") != porte:
        return False
    energia = adotante.get("energiaPref", "Tanto faz")
    if energia and energia != "Tanto faz" and animal.get("energia") != energia:
        return False
    if adotante.get("aceitaCuidadosEspeciais") == "Não" \
            and animal.get("precisaCuidadoEspecial"):
        return False
    return True


# --------------------------------------------------------------------------
# Lógica da API
# --------------------------------------------------------------------------

def api_handle(method, path, query, body):
    """Retorna (status_code, dict). Levanta nada; sempre devolve JSON."""
    with _lock:
        data = load_data()

        # ---- DOADORES ----
        if path == "/api/doadores" and method == "POST":
            doador = {
                "id": new_id(),
                "nome": body.get("nome", "").strip(),
                "tipo": body.get("tipo", "pessoa"),  # 'pessoa' ou 'abrigo'
                "contato": body.get("contato", "").strip(),
            }
            if not doador["nome"]:
                return 400, {"erro": "Nome é obrigatório"}
            data["doadores"].append(doador)
            save_data(data)
            return 201, doador

        # ---- ADOTANTES ----
        if path == "/api/adotantes" and method == "POST":
            adotante = {
                "id": new_id(),
                "nome": body.get("nome", "").strip(),
                "idade": body.get("idade", ""),
                "profissao": body.get("profissao", "").strip(),
                "moradia": body.get("moradia", ""),  # casa, apartamento...
                "sobre": body.get("sobre", "").strip(),
                "contato": body.get("contato", "").strip(),
                # --- preferências (usadas para filtrar o swipe) ---
                "especiePref": body.get("especiePref", "Tanto faz"),
                "portePref": body.get("portePref", "Tanto faz"),
                "energiaPref": body.get("energiaPref", "Tanto faz"),
                "racaPref": body.get("racaPref", "").strip(),
                "aceitaCuidadosEspeciais": body.get("aceitaCuidadosEspeciais", "Sim"),
            }
            if not adotante["nome"]:
                return 400, {"erro": "Nome é obrigatório"}
            data["adotantes"].append(adotante)
            save_data(data)
            return 201, adotante

        # ---- ANIMAIS ----
        if path == "/api/animais" and method == "POST":
            animal = {
                "id": new_id(),
                "doadorId": body.get("doadorId", ""),
                "nome": body.get("nome", "").strip(),
                "especie": body.get("especie", ""),
                "raca": body.get("raca", "").strip(),
                "idade": body.get("idade", "").strip(),
                "porte": body.get("porte", ""),
                "descricao": body.get("descricao", "").strip(),
                # --- ficha / especificações do animal ---
                "energia": body.get("energia", "Média"),
                "atencao": body.get("atencao", "Média"),
                "castrado": bool(body.get("castrado")),
                "vacinado": bool(body.get("vacinado")),
                "vermifugado": bool(body.get("vermifugado")),
                "saude": body.get("saude", "").strip(),
                "precisaCuidadoEspecial": bool(body.get("precisaCuidadoEspecial")),
                "cuidadosEspeciais": body.get("cuidadosEspeciais", "").strip(),
                "temperamento": body.get("temperamento", "").strip(),
                "bomComCriancas": bool(body.get("bomComCriancas")),
                "bomComAnimais": bool(body.get("bomComAnimais")),
            }
            # fotos: aceita lista, ou texto com uma URL por linha/vírgula
            fotos_raw = body.get("fotos", "")
            if isinstance(fotos_raw, list):
                fotos = [str(f).strip() for f in fotos_raw if str(f).strip()]
            else:
                parts = str(fotos_raw).replace(",", "\n").split("\n")
                fotos = [p.strip() for p in parts if p.strip()]
            foto_single = body.get("foto", "").strip()
            if not fotos and foto_single:
                fotos = [foto_single]
            animal["fotos"] = fotos
            animal["foto"] = fotos[0] if fotos else ""
            if not animal["nome"] or not animal["doadorId"]:
                return 400, {"erro": "Nome e doadorId são obrigatórios"}
            data["animais"].append(animal)
            save_data(data)
            return 201, animal

        if path == "/api/animais" and method == "GET":
            doador_id = query.get("doadorId", [None])[0]
            adotante_id = query.get("adotanteId", [None])[0]
            animais = data["animais"]
            if doador_id:
                # animais de um doador específico
                animais = [a for a in animais if a["doadorId"] == doador_id]
            elif adotante_id:
                # fila de swipe: remove os já avaliados e aplica preferências
                avaliados = {
                    l["animalId"] for l in data["likes"]
                    if l["adotanteId"] == adotante_id
                }
                adotante = next((a for a in data["adotantes"]
                                 if a["id"] == adotante_id), None)
                animais = [a for a in animais if a["id"] not in avaliados]
                if adotante:
                    animais = [a for a in animais
                               if combina_com_preferencias(a, adotante)]
            return 200, {"animais": animais}

        # ---- LIKES (adotante curte um animal) ----
        if path == "/api/likes" and method == "POST":
            adotante_id = body.get("adotanteId", "")
            animal_id = body.get("animalId", "")
            decisao = body.get("decisao", "like")  # 'like' ou 'pass'
            if not adotante_id or not animal_id:
                return 400, {"erro": "adotanteId e animalId obrigatórios"}
            like = {
                "id": new_id(),
                "adotanteId": adotante_id,
                "animalId": animal_id,
                "decisao": decisao,
                # status do lado do doador: pendente / aceito / recusado
                "status": "pendente" if decisao == "like" else "ignorado",
            }
            data["likes"].append(like)
            save_data(data)
            return 201, like

        # ---- CURTIDAS RECEBIDAS (doador vê quem curtiu seus animais) ----
        if path == "/api/recebidas" and method == "GET":
            doador_id = query.get("doadorId", [None])[0]
            if not doador_id:
                return 400, {"erro": "doadorId obrigatório"}
            meus_animais = {a["id"]: a for a in data["animais"]
                            if a["doadorId"] == doador_id}
            adotantes = {a["id"]: a for a in data["adotantes"]}
            resultado = []
            for l in data["likes"]:
                if l["decisao"] != "like":
                    continue
                if l["animalId"] not in meus_animais:
                    continue
                resultado.append({
                    "likeId": l["id"],
                    "status": l["status"],
                    "animal": meus_animais[l["animalId"]],
                    "adotante": adotantes.get(l["adotanteId"]),
                })
            return 200, {"recebidas": resultado}

        # ---- DOADOR DECIDE (aceita = inicia conversa, ou recusa) ----
        if path == "/api/decidir" and method == "POST":
            like_id = body.get("likeId", "")
            status = body.get("status", "")  # 'aceito' ou 'recusado'
            if status not in ("aceito", "recusado"):
                return 400, {"erro": "status deve ser 'aceito' ou 'recusado'"}
            for l in data["likes"]:
                if l["id"] == like_id:
                    l["status"] = status
                    save_data(data)
                    return 200, l
            return 404, {"erro": "like não encontrado"}

        # ---- MATCHES (conversas iniciadas) ----
        if path == "/api/matches" and method == "GET":
            adotante_id = query.get("adotanteId", [None])[0]
            doador_id = query.get("doadorId", [None])[0]
            animais = {a["id"]: a for a in data["animais"]}
            adotantes = {a["id"]: a for a in data["adotantes"]}
            doadores = {d["id"]: d for d in data["doadores"]}
            matches = []
            for l in data["likes"]:
                if l["status"] != "aceito":
                    continue
                animal = animais.get(l["animalId"])
                if not animal:
                    continue
                if adotante_id and l["adotanteId"] != adotante_id:
                    continue
                if doador_id and animal["doadorId"] != doador_id:
                    continue
                matches.append({
                    "likeId": l["id"],
                    "animal": animal,
                    "adotante": adotantes.get(l["adotanteId"]),
                    "doador": doadores.get(animal["doadorId"]),
                })
            return 200, {"matches": matches}

        # ---- CHAT: enviar mensagem ----
        if path == "/api/mensagens" and method == "POST":
            like_id = body.get("likeId", "")
            autor = body.get("autor", "")        # 'adotante' ou 'doador'
            texto = body.get("texto", "").strip()
            if not like_id or autor not in ("adotante", "doador") or not texto:
                return 400, {"erro": "likeId, autor e texto são obrigatórios"}
            like = next((l for l in data["likes"] if l["id"] == like_id), None)
            if not like or like.get("status") != "aceito":
                return 400, {"erro": "conversa não disponível para este match"}
            msg = {
                "id": new_id(),
                "likeId": like_id,
                "autor": autor,
                "texto": texto[:1000],
                "hora": datetime.now().strftime("%H:%M"),
            }
            data.setdefault("mensagens", []).append(msg)
            save_data(data)
            return 201, msg

        # ---- CHAT: histórico de uma conversa ----
        if path == "/api/mensagens" and method == "GET":
            like_id = query.get("likeId", [None])[0]
            msgs = [m for m in data.get("mensagens", []) if m["likeId"] == like_id]
            return 200, {"mensagens": msgs}

        return 404, {"erro": "Rota não encontrada"}


# --------------------------------------------------------------------------
# Servidor HTTP
# --------------------------------------------------------------------------

CONTENT_TYPES = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml",
}


class Handler(BaseHTTPRequestHandler):
    def _send_json(self, status, payload):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _serve_static(self, path):
        if path == "/" or path == "":
            path = "/index.html"
        # impede path traversal
        safe = os.path.normpath(path).lstrip("\\/")
        full = os.path.join(PUBLIC_DIR, safe)
        if not full.startswith(PUBLIC_DIR) or not os.path.isfile(full):
            self.send_error(404, "Arquivo não encontrado")
            return
        ext = os.path.splitext(full)[1]
        ctype = CONTENT_TYPES.get(ext, "application/octet-stream")
        with open(full, "rb") as f:
            content = f.read()
        self.send_response(200)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(content)))
        self.end_headers()
        self.wfile.write(content)

    def do_GET(self):
        parsed = urlparse(self.path)
        if parsed.path == "/api/health":
            # diagnóstico: informa o modo de persistência e se o banco responde
            mode = "postgres" if DATABASE_URL else "arquivo"
            db_ok = None
            if DATABASE_URL:
                try:
                    conn = _db_connect()
                    conn.close()
                    db_ok = True
                except Exception:
                    db_ok = False
            self._send_json(200, {"ok": True, "mode": mode, "db_ok": db_ok})
            return
        if parsed.path.startswith("/api/"):
            query = parse_qs(parsed.query)
            status, payload = api_handle("GET", parsed.path, query, {})
            self._send_json(status, payload)
        else:
            self._serve_static(parsed.path)

    def do_POST(self):
        parsed = urlparse(self.path)
        length = int(self.headers.get("Content-Length", 0))
        raw = self.rfile.read(length) if length else b""
        try:
            body = json.loads(raw.decode("utf-8")) if raw else {}
        except (json.JSONDecodeError, UnicodeDecodeError):
            self._send_json(400, {"erro": "JSON inválido"})
            return
        if parsed.path.startswith("/api/"):
            status, payload = api_handle("POST", parsed.path, {}, body)
            self._send_json(status, payload)
        else:
            self._send_json(404, {"erro": "Rota não encontrada"})

    def log_message(self, fmt, *args):
        # log enxuto
        print("[%s] %s" % (self.log_date_time_string(), fmt % args))


def main():
    port = int(os.environ.get("PORT", "8000"))
    # Em hospedagem (ex.: Render) o host precisa ser 0.0.0.0 para aceitar
    # conexões externas; localmente 0.0.0.0 também é acessível via localhost.
    host = os.environ.get("HOST", "0.0.0.0")
    # IMPORTANTE: sobe o servidor primeiro (não bloqueia o boot no banco).
    # O schema/seed é preparado sob demanda em load_data/save_data, e falhas
    # de conexão não derrubam o processo — apenas as requisições afetadas.
    if not DATABASE_URL:
        load_data()                  # modo arquivo: garante data.json + seed
    else:
        try:
            load_data()              # prepara schema + seed no banco (best-effort)
        except Exception as e:
            print("Aviso: banco indisponível no boot (%s). Tentarei sob demanda." % e)
    server = ThreadingHTTPServer((host, port), Handler)
    print("=" * 50)
    print("  Focinhos rodando!")
    print("  Persistência: %s" % ("Postgres (DATABASE_URL)" if DATABASE_URL else "arquivo local"))
    print("  Local:  http://localhost:%d" % port)
    print("  (Ctrl+C para parar)")
    print("=" * 50)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nEncerrando...")
        server.shutdown()


if __name__ == "__main__":
    main()
