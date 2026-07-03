# 🐾 Focinhos

App de adoção de animais no estilo "deslize para combinar" — protótipo rodando em **localhost**, feito em **Python puro** (só biblioteca padrão, sem `pip install`) + frontend HTML/CSS/JS.

## Como rodar

```bash
cd adota-match
python server.py
```

Abra **http://localhost:8000** no navegador.

> Para usar outra porta: `PORT=3000 python server.py` (ou no Windows PowerShell: `$env:PORT=3000; python server.py`).

## Como funciona

Dois fluxos, escolhidos na tela inicial:

### 🙋 Quero adotar
1. Cria seu perfil com dados pessoais (idade, profissão, moradia) **e suas preferências**:
   espécie desejada, porte, **nível de energia que comporta**, preferência de raça e se
   **aceita um pet com cuidados especiais**.
2. O swipe mostra **apenas os animais compatíveis** com essas preferências — cards estilo
   Tinder: arraste para a direita (ou ❤) para curtir, esquerda (ou ✖) para passar.
3. Aba **Meus matches**: quando um doador aceita sua curtida, o contato dele aparece aqui.

### 🏠 Quero doar (pessoa física ou abrigo)
1. **Cadastrar animal** com a ficha completa:
   - **Básico**: nome, espécie, raça, idade, porte, foto (URL).
   - **Temperamento/necessidades**: nível de energia, nível de atenção exigido, temperamento,
     se é bom com crianças e com outros animais.
   - **Saúde** 🩺: castrado / vacinado / vermifugado, estado de saúde e — se for o caso —
     **cuidados especiais** (medicação contínua, dieta, mobilidade etc.).
2. **Curtidas recebidas**: vê o perfil de quem curtiu seus animais (incluindo se o adotante
   aceita cuidados especiais) e decide — **Conversar** (inicia o match) ou **Recusar**.
3. **Conversas**: lista dos matches confirmados; abra o **chat** para combinar a adoção.

### 💬 Match e conversa
- Quando o doador aceita (ou o adotante descobre um novo match), aparece a tela cheia
  **"É um Match!"** com o gradiente do app.
- A partir do match, os dois lados têm um **chat real** (mensagens persistidas no backend,
  atualizadas a cada poucos segundos). Abra pela tela de match, pela aba **Conversas**
  (doador) ou em **Meus matches** (adotante).

### Como funciona o match por preferências
A fila de swipe do adotante filtra os animais por **espécie**, **porte**, **nível de energia**
e oculta pets que **precisam de cuidados especiais** caso o adotante tenha marcado que não
aceita. A preferência de raça é informativa (texto livre), não restringe a lista.

## Estrutura

```
adota-match/
├── server.py          # servidor HTTP + API JSON (stdlib)
├── data.json          # banco de dados (criado no 1º run, com dados de exemplo)
└── public/
    ├── index.html
    ├── styles.css
    └── app.js
```

## API (resumo)

| Método | Rota | Descrição |
|--------|------|-----------|
| POST | `/api/adotantes` | cria perfil de adotante |
| POST | `/api/doadores` | cria perfil de doador |
| POST | `/api/animais` | publica um animal |
| GET  | `/api/animais?adotanteId=` | fila de swipe (exclui já avaliados) |
| GET  | `/api/animais?doadorId=` | animais de um doador |
| POST | `/api/likes` | adotante curte/passa um animal |
| GET  | `/api/recebidas?doadorId=` | curtidas recebidas pelo doador |
| POST | `/api/decidir` | doador aceita/recusa uma curtida |
| GET  | `/api/matches?adotanteId=` ou `?doadorId=` | matches confirmados |
| POST | `/api/mensagens` | envia mensagem no chat (só se o match foi aceito) |
| GET  | `/api/mensagens?likeId=` | histórico da conversa |

> Os dados ficam em `data.json`. Para zerar tudo, basta apagar esse arquivo.

## Observações

- Protótipo **sem autenticação** — o "login" é só lembrado no `localStorage` do navegador. Para testar os dois lados, use **duas abas/janelas** (ou aba anônima) e escolha papéis diferentes.
- As fotos de exemplo vêm de serviços públicos na web; se não carregarem, o card mostra um emoji do bichinho.
