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
import hashlib
import secrets
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
    """Estado inicial vazio — apenas animais reais cadastrados pelos usuários."""
    return {
        "doadores": [],
        "animais": [],
        "adotantes": [],
        "likes": [],
        "mensagens": [],
        "contas": [],
    }


# nomes de animais criados durante testes internos (removidos na limpeza)
_ANIMAIS_TESTE = {"AnimalComFoto", "TestePix", "FotoTeste", "Rex Upload",
                  "Rex Real", "Luna Auditoria", "Thor Painel", "Rex", "Mia"}


def limpar_amostra(data):
    """Remove animais/doadores de amostra (ids 'seed-*') e de teste, além de
    likes/mensagens órfãos. Idempotente — seguro rodar a cada boot."""
    data.setdefault("animais", [])
    data.setdefault("doadores", [])
    data.setdefault("likes", [])
    data.setdefault("mensagens", [])
    data["animais"] = [
        a for a in data["animais"]
        if not str(a.get("id", "")).startswith("seed-")
        and a.get("nome") not in _ANIMAIS_TESTE
    ]
    ids_animais = {a["id"] for a in data["animais"]}
    data["doadores"] = [
        d for d in data["doadores"]
        if not str(d.get("id", "")).startswith("seed-")
    ]
    data["likes"] = [l for l in data["likes"] if l.get("animalId") in ids_animais]
    ids_likes = {l["id"] for l in data["likes"]}
    data["mensagens"] = [m for m in data["mensagens"] if m.get("likeId") in ids_likes]
    # doadores que já existiam (antes da verificação) entram como verificados
    for d in data["doadores"]:
        d.setdefault("verificado", True)
    return data


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


def _hash_senha(senha, salt=None):
    """Hash de senha com PBKDF2-SHA256 + salt (nunca guardamos texto puro)."""
    if salt is None:
        salt = secrets.token_hex(16)
    dk = hashlib.pbkdf2_hmac("sha256", senha.encode("utf-8"),
                             salt.encode("utf-8"), 120000)
    return salt, dk.hex()


def _conta_publica(conta):
    """Remove campos sensíveis antes de devolver a conta ao cliente."""
    return {k: v for k, v in conta.items() if k not in ("senha_hash", "salt")}


def _sem_contato(perfil):
    """Remove dados internos (contato direto, CNPJ) ao expor um perfil para a
    OUTRA parte. Comunicação é só pela plataforma; contato/CNPJ ficam para
    controle interno. O endereço do abrigo (local de entrega) é mantido."""
    if not perfil:
        return perfil
    internos = ("contato", "cnpj", "email", "telefone", "contaId")
    return {k: v for k, v in perfil.items() if k not in internos}


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

        # ---- DOADORES (apenas abrigos/ONGs, sujeitos a verificação) ----
        if path == "/api/doadores" and method == "POST":
            doador = {
                "id": new_id(),
                "contaId": body.get("contaId", ""),        # conta que cadastrou
                "nome": body.get("nome", "").strip(),      # nome do abrigo/ONG
                "tipo": "abrigo",
                "cnpj": body.get("cnpj", "").strip(),      # controle interno
                "endereco": body.get("endereco", "").strip(),  # sede: local das adoções
                "email": body.get("email", "").strip().lower(),      # interno
                "telefone": body.get("telefone", "").strip(),        # interno
                "verificado": False,                       # entra "em análise"
            }
            if not doador["nome"] or not doador["email"] or not doador["telefone"]:
                return 400, {"erro": "Nome, e-mail e telefone do abrigo são obrigatórios"}
            data["doadores"].append(doador)
            save_data(data)
            return 201, doador

        # ---- ADOTANTES ----
        if path == "/api/adotantes" and method == "POST":
            adotante = {
                "id": new_id(),
                "contaId": body.get("contaId", ""),
                "nome": body.get("nome", "").strip(),
                "idade": body.get("idade", ""),
                "profissao": body.get("profissao", "").strip(),
                "moradia": body.get("moradia", ""),  # casa, apartamento...
                "sobre": body.get("sobre", "").strip(),
                "contato": body.get("contato", "").strip(),  # controle interno; nunca exposto
                # --- preferências (usadas para filtrar o swipe) ---
                "especiePref": body.get("especiePref", "Tanto faz"),
                "portePref": body.get("portePref", "Tanto faz"),
                "energiaPref": body.get("energiaPref", "Tanto faz"),
                "racaPref": body.get("racaPref", "").strip(),
                "aceitaCuidadosEspeciais": body.get("aceitaCuidadosEspeciais", "Sim"),
                # --- casa e experiência (opcional; ajudam o doador a avaliar) ---
                "experienciaPets": body.get("experienciaPets", "").strip(),
                "outrosAnimais": body.get("outrosAnimais", "").strip(),
                "pessoasCasa": body.get("pessoasCasa", "").strip(),
                "criancasCasa": body.get("criancasCasa", "").strip(),
                "tempoDisponivel": body.get("tempoDisponivel", "").strip(),
                "motivacao": body.get("motivacao", "").strip(),
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
                # só abrigos verificados aparecem no swipe (segurança)
                verificados = {d["id"] for d in data["doadores"]
                               if d.get("verificado")}
                # exclui já avaliados, já adotados e de abrigos não verificados
                animais = [a for a in animais
                           if a["id"] not in avaliados and not a.get("adotado")
                           and a["doadorId"] in verificados]
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
                    "adotante": _sem_contato(adotantes.get(l["adotanteId"])),
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
                # inclui conversas aceitas E adoções já finalizadas
                if l["status"] not in ("aceito", "adotado"):
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
                    "adotante": _sem_contato(adotantes.get(l["adotanteId"])),
                    "doador": _sem_contato(doadores.get(animal["doadorId"])),
                    "adotado": l["status"] == "adotado",
                })
            return 200, {"matches": matches}

        # ---- PAINEL DO DOADOR: seus animais com contadores ----
        if path == "/api/doador/animais" and method == "GET":
            doador_id = query.get("doadorId", [None])[0]
            if not doador_id:
                return 400, {"erro": "doadorId obrigatório"}
            resultado = []
            for a in data["animais"]:
                if a["doadorId"] != doador_id:
                    continue
                likes = [l for l in data["likes"]
                         if l["animalId"] == a["id"] and l["decisao"] == "like"]
                item = dict(a)
                item["curtidas"] = sum(1 for l in likes if l["status"] == "pendente")
                item["conversas"] = sum(1 for l in likes
                                        if l["status"] in ("aceito", "adotado"))
                resultado.append(item)
            return 200, {"animais": resultado}

        # ---- PERFIL DE UM ANIMAL: interessados + conversas ----
        if path == "/api/animal" and method == "GET":
            animal_id = query.get("animalId", [None])[0]
            animal = next((a for a in data["animais"]
                           if a["id"] == animal_id), None)
            if not animal:
                return 404, {"erro": "animal não encontrado"}
            adotantes = {a["id"]: a for a in data["adotantes"]}
            interessados, conversas = [], []
            for l in data["likes"]:
                if l["animalId"] != animal_id or l["decisao"] != "like":
                    continue
                entry = {"likeId": l["id"], "status": l["status"],
                         "adotante": _sem_contato(adotantes.get(l["adotanteId"]))}
                if l["status"] == "pendente":
                    interessados.append(entry)
                elif l["status"] in ("aceito", "adotado"):
                    entry["adotado"] = l["status"] == "adotado"
                    conversas.append(entry)
            return 200, {"animal": animal, "interessados": interessados,
                         "conversas": conversas}

        # ---- CHAT: enviar mensagem ----
        if path == "/api/mensagens" and method == "POST":
            like_id = body.get("likeId", "")
            autor = body.get("autor", "")        # 'adotante' ou 'doador'
            texto = body.get("texto", "").strip()
            if not like_id or autor not in ("adotante", "doador") or not texto:
                return 400, {"erro": "likeId, autor e texto são obrigatórios"}
            like = next((l for l in data["likes"] if l["id"] == like_id), None)
            if not like or like.get("status") not in ("aceito", "adotado"):
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

        # ---- CONTAS: cadastro (email + senha) ----
        if path == "/api/contas" and method == "POST":
            nome = body.get("nome", "").strip()
            email = body.get("email", "").strip().lower()
            senha = body.get("senha", "")
            telefone = body.get("telefone", "").strip()
            if not nome or not email or not senha or not telefone:
                return 400, {"erro": "Nome, e-mail, telefone e senha são obrigatórios"}
            if "@" not in email or "." not in email.split("@")[-1]:
                return 400, {"erro": "E-mail inválido"}
            if len(senha) < 6:
                return 400, {"erro": "A senha precisa de ao menos 6 caracteres"}
            contas = data.setdefault("contas", [])
            if any(c["email"] == email for c in contas):
                return 409, {"erro": "Já existe uma conta com esse e-mail"}
            salt, senha_hash = _hash_senha(senha)
            conta = {
                "id": new_id(), "nome": nome, "email": email,
                "telefone": telefone, "salt": salt, "senha_hash": senha_hash,
                "criadoEm": datetime.now().strftime("%Y-%m-%d"),
            }
            contas.append(conta)
            save_data(data)
            return 201, _conta_publica(conta)

        # ---- LOGIN ----
        if path == "/api/login" and method == "POST":
            email = body.get("email", "").strip().lower()
            senha = body.get("senha", "")
            conta = next((c for c in data.get("contas", [])
                          if c["email"] == email), None)
            if not conta:
                return 401, {"erro": "E-mail ou senha inválidos"}
            _, tentativa = _hash_senha(senha, conta["salt"])
            if not secrets.compare_digest(tentativa, conta["senha_hash"]):
                return 401, {"erro": "E-mail ou senha inválidos"}
            return 200, _conta_publica(conta)

        # ---- TERMO DE RESPONSABILIDADE: status ----
        if path == "/api/termo" and method == "GET":
            like_id = query.get("likeId", [None])[0]
            like = next((l for l in data["likes"] if l["id"] == like_id), None)
            if not like:
                return 404, {"erro": "conversa não encontrada"}
            animal = next((a for a in data["animais"]
                           if a["id"] == like["animalId"]), None)
            return 200, {
                "termo": like.get("termo") or {"adotante": None, "doador": None},
                "status": like.get("status"),
                "adotado": like.get("status") == "adotado",
                "animalNome": animal["nome"] if animal else "",
            }

        # ---- TERMO: assinar (uma das partes) ----
        if path == "/api/termo/assinar" and method == "POST":
            like_id = body.get("likeId", "")
            parte = body.get("parte", "")            # 'adotante' ou 'doador'
            nome = body.get("nome", "").strip()
            if parte not in ("adotante", "doador") or not nome:
                return 400, {"erro": "parte e nome são obrigatórios"}
            like = next((l for l in data["likes"] if l["id"] == like_id), None)
            if not like or like.get("status") not in ("aceito", "adotado"):
                return 400, {"erro": "conversa não disponível para assinatura"}
            termo = like.setdefault("termo", {"adotante": None, "doador": None})
            termo[parte] = {"nome": nome,
                            "data": datetime.now().strftime("%d/%m/%Y %H:%M")}
            finalizado = bool(termo.get("adotante") and termo.get("doador"))
            if finalizado:
                like["status"] = "adotado"
                animal = next((a for a in data["animais"]
                               if a["id"] == like["animalId"]), None)
                if animal:
                    animal["adotado"] = True
            save_data(data)
            return 200, {"termo": termo, "status": like["status"],
                         "finalizado": finalizado}

        # ---- ADMIN: verificação de abrigos (protegido por ADMIN_TOKEN) ----
        if path == "/api/admin/abrigos" and method == "GET":
            admin = os.environ.get("ADMIN_TOKEN", "")
            token = query.get("token", [""])[0]
            if not admin or not secrets.compare_digest(token, admin):
                return 403, {"erro": "não autorizado"}
            return 200, {"abrigos": [
                {"id": d["id"], "nome": d.get("nome"), "cnpj": d.get("cnpj"),
                 "endereco": d.get("endereco"), "email": d.get("email"),
                 "telefone": d.get("telefone"),
                 "verificado": bool(d.get("verificado"))}
                for d in data["doadores"]
            ]}

        # ---- ADMIN: perfil detalhado de uma instituição ----
        if path == "/api/admin/abrigo" and method == "GET":
            admin = os.environ.get("ADMIN_TOKEN", "")
            token = query.get("token", [""])[0]
            if not admin or not secrets.compare_digest(token, admin):
                return 403, {"erro": "não autorizado"}
            doador_id = query.get("doadorId", [""])[0]
            doador = next((d for d in data["doadores"]
                           if d["id"] == doador_id), None)
            if not doador:
                return 404, {"erro": "abrigo não encontrado"}
            conta = next((c for c in data.get("contas", [])
                          if c["id"] == doador.get("contaId")), None)
            animais = []
            for a in data["animais"]:
                if a["doadorId"] != doador_id:
                    continue
                likes = [l for l in data["likes"] if l["animalId"] == a["id"]
                         and l["decisao"] == "like"]
                animais.append({
                    "nome": a["nome"], "especie": a.get("especie"),
                    "adotado": bool(a.get("adotado")),
                    "curtidas": sum(1 for l in likes if l["status"] == "pendente"),
                    "conversas": sum(1 for l in likes
                                     if l["status"] in ("aceito", "adotado")),
                })
            return 200, {
                "doador": doador,   # inclui campos internos (visão admin)
                "conta": _conta_publica(conta) if conta else None,
                "animais": animais,
            }

        if path == "/api/admin/verificar" and method == "POST":
            admin = os.environ.get("ADMIN_TOKEN", "")
            if not admin or not secrets.compare_digest(body.get("token", ""), admin):
                return 403, {"erro": "não autorizado"}
            doador = next((d for d in data["doadores"]
                           if d["id"] == body.get("doadorId")), None)
            if not doador:
                return 404, {"erro": "abrigo não encontrado"}
            doador["verificado"] = bool(body.get("verificado", True))
            save_data(data)
            return 200, {"id": doador["id"], "verificado": doador["verificado"]}

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
    def _boot_dados():
        # garante schema/seed, remove amostra/teste e persiste o grandfather
        # da verificação de abrigos (idempotente)
        d = load_data()
        antes = len(d.get("animais", []))
        limpar_amostra(d)
        save_data(d)
        if len(d.get("animais", [])) != antes:
            print("Limpeza: %d animal(is) de amostra/teste removido(s)." %
                  (antes - len(d["animais"])))
    if not DATABASE_URL:
        _boot_dados()                # modo arquivo
    else:
        try:
            _boot_dados()            # banco (best-effort)
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
