"""
🐾 Controle Financeiro — Abrigo de Animais
App Streamlit conectado a uma planilha Google (aba "Lançamentos").

Páginas: Dashboard · Novo Registro (em lote) · Projeção Mensal ·
         Doadores · Reserva · Tendências por categoria.

As funções de análise (seção ANALYTICS) são puras (operam sobre um
DataFrame) e podem ser testadas sem conexão com o Google.
"""

from __future__ import annotations

import datetime as dt
from typing import Optional

import numpy as np
import pandas as pd
import streamlit as st

# ----------------------------------------------------------------------
# CONFIGURAÇÃO
# ----------------------------------------------------------------------
HEADERS = ["ID", "Carimbo", "Data", "Mês", "Tipo", "Valor (R$)",
           "Doador / Fornecedor", "Categoria", "Forma de pagamento",
           "Recorrência", "Observações"]

TIPOS = ["Entrada", "Saída"]
CATEGORIAS = [
    "(Entrada) Doação em dinheiro",
    "(Entrada) Doação de ração/itens",
    "(Entrada) Campanha / Evento",
    "(Saída) Alimentação",
    "(Saída) Higiene / Limpeza",
    "(Saída) Veterinário / Saúde",
    "(Saída) Medicamentos",
    "(Saída) Infraestrutura / Manutenção",
    "(Saída) Funcionários / Serviços",
    "Outros",
]
FORMAS_PGTO = ["Pix", "Dinheiro", "Cartão", "Transferência (TED/DOC)", "Boleto", "Outro"]
RECORRENCIAS = ["Pontual / Eventual", "Semanal", "Quinzenal", "Mensal", "Trimestral", "Outra"]

VERDE = "#2e7d32"
VERDE_ESC = "#1b5e20"
VERMELHO = "#c62828"
AMARELO = "#f9a825"

st.set_page_config(page_title="Abrigo · Controle Financeiro",
                   page_icon="🐾", layout="wide")

# CSS leve para deixar os cartões mais bonitos
st.markdown(
    """
    <style>
      .block-container {padding-top: 2rem;}
      div[data-testid="stMetric"] {
          background: #f1f8f2; border: 1px solid #d7e8d9;
          border-radius: 14px; padding: 16px 18px;
      }
      div[data-testid="stMetricLabel"] {color:#3a5a3c; font-weight:600;}
      h1, h2, h3 {color:#1b5e20;}
    </style>
    """,
    unsafe_allow_html=True,
)


# ----------------------------------------------------------------------
# ANALYTICS (funções puras — testáveis sem Google)
# ----------------------------------------------------------------------
def parse_valor(v) -> float:
    """Converte valores em formato brasileiro (1.234,56) ou número para float."""
    if v is None or (isinstance(v, float) and np.isnan(v)):
        return 0.0
    if isinstance(v, (int, float)):
        return float(v)
    s = str(v).strip()
    if not s:
        return 0.0
    s = "".join(ch for ch in s if ch.isdigit() or ch in ".,-")
    if "," in s:
        s = s.replace(".", "").replace(",", ".")
    try:
        return float(s)
    except ValueError:
        return 0.0


def normalize(df: pd.DataFrame) -> pd.DataFrame:
    """Recebe o DataFrame cru da planilha e devolve colunas tipadas e limpas."""
    if df.empty:
        return pd.DataFrame(columns=["data", "mes", "tipo", "valor", "pessoa",
                                     "categoria", "forma", "recorrencia", "obs"])
    d = pd.DataFrame()
    d["data"] = pd.to_datetime(df.get("Data"), errors="coerce", dayfirst=True)
    d["tipo"] = df.get("Tipo", "").astype(str).str.strip()
    d["valor"] = df.get("Valor (R$)").map(parse_valor) if "Valor (R$)" in df else 0.0
    d["pessoa"] = df.get("Doador / Fornecedor", "").astype(str).str.strip()
    d["categoria"] = df.get("Categoria", "").astype(str).str.strip()
    d["forma"] = df.get("Forma de pagamento", "").astype(str).str.strip()
    d["recorrencia"] = df.get("Recorrência", "").astype(str).str.strip()
    d["obs"] = df.get("Observações", "").astype(str).str.strip()
    d = d.dropna(subset=["data"]).copy()
    d["mes"] = d["data"].dt.strftime("%Y-%m")
    d["tipo"] = d["tipo"].str.lower().map(
        lambda s: "Entrada" if "entrada" in s else ("Saída" if ("saí" in s or "sai" in s) else s)
    )
    return d.sort_values("data").reset_index(drop=True)


def resumo_caixa(d: pd.DataFrame, hoje: Optional[dt.date] = None) -> dict:
    hoje = hoje or dt.date.today()
    mes_atual = hoje.strftime("%Y-%m")
    ent = d.loc[d.tipo == "Entrada", "valor"].sum()
    sai = d.loc[d.tipo == "Saída", "valor"].sum()
    ent_mes = d.loc[(d.tipo == "Entrada") & (d.mes == mes_atual), "valor"].sum()
    sai_mes = d.loc[(d.tipo == "Saída") & (d.mes == mes_atual), "valor"].sum()
    return {"saldo": ent - sai, "ent_mes": ent_mes, "sai_mes": sai_mes,
            "saldo_mes": ent_mes - sai_mes, "tot_ent": ent, "tot_sai": sai}


def serie_mensal(d: pd.DataFrame) -> pd.DataFrame:
    if d.empty:
        return pd.DataFrame(columns=["mes", "entradas", "saidas", "saldo", "acumulado"])
    piv = (d.pivot_table(index="mes", columns="tipo", values="valor",
                         aggfunc="sum", fill_value=0).reset_index())
    for c in ("Entrada", "Saída"):
        if c not in piv:
            piv[c] = 0.0
    piv = piv.rename(columns={"Entrada": "entradas", "Saída": "saidas"})
    piv = piv.sort_values("mes")
    piv["saldo"] = piv["entradas"] - piv["saidas"]
    piv["acumulado"] = piv["saldo"].cumsum()
    return piv[["mes", "entradas", "saidas", "saldo", "acumulado"]].reset_index(drop=True)


def projecao(d: pd.DataFrame, meses_a_frente: int = 3,
             hoje: Optional[dt.date] = None) -> pd.DataFrame:
    """Projeta entradas/saídas usando média e desvio dos meses completos."""
    hoje = hoje or dt.date.today()
    mes_atual = hoje.strftime("%Y-%m")
    hist = serie_mensal(d)
    if hist.empty:
        return pd.DataFrame()
    completos = hist[hist.mes != mes_atual]
    if completos.empty:
        completos = hist
    m_ent, s_ent = completos.entradas.mean(), completos.entradas.std(ddof=1)
    m_sai, s_sai = completos.saidas.mean(), completos.saidas.std(ddof=1)
    s_ent = 0.0 if np.isnan(s_ent) else s_ent
    s_sai = 0.0 if np.isnan(s_sai) else s_sai
    acum = hist.acumulado.iloc[-1]
    linhas = []
    base = dt.date(hoje.year, hoje.month, 1)
    for k in range(1, meses_a_frente + 1):
        mref = (base.replace(day=1) + pd.DateOffset(months=k)).strftime("%Y-%m")
        saldo_esp = m_ent - m_sai
        acum += saldo_esp
        linhas.append({
            "mes": mref,
            "entradas_esp": m_ent, "saidas_esp": m_sai,
            "saldo_esp": saldo_esp,
            "saldo_pess": (m_ent - s_ent) - (m_sai + s_sai),
            "saldo_otim": (m_ent + s_ent) - (m_sai - s_sai),
            "acum_esp": acum,
        })
    return pd.DataFrame(linhas)


def doadores(d: pd.DataFrame, hoje: Optional[dt.date] = None) -> pd.DataFrame:
    hoje = pd.Timestamp(hoje or dt.date.today()).normalize()
    ent = d[d.tipo == "Entrada"]
    out = []
    for nome, g in ent.groupby(ent.pessoa.replace("", "(sem nome)")):
        g = g.sort_values("data")
        datas = g.data.dt.normalize()
        n = len(g)
        ultima = datas.max()
        dias_desde = int((hoje - ultima).days)
        if n >= 2:
            intervalos = datas.diff().dropna().dt.days
            intervalo = float(intervalos.mean())
            prox = ultima + pd.Timedelta(days=intervalo)
            atraso = (hoje - prox).days
            if atraso >= 0:
                status = "🔴 Atrasado"
            elif atraso >= -max(2, intervalo * 0.2):
                status = "🟡 Chegando"
            else:
                status = "🟢 Em dia"
            prox_str = prox.date()
            intervalo_str = round(intervalo)
        else:
            status, prox_str, intervalo_str = "⚪ Doação única", None, None
        out.append({
            "Doador": nome, "Nº doações": n, "Total doado": g.valor.sum(),
            "Média/doação": g.valor.mean(), "Intervalo (dias)": intervalo_str,
            "Última doação": ultima.date(), "Dias desde": dias_desde,
            "Próxima esperada": prox_str, "Status": status,
        })
    df = pd.DataFrame(out)
    if df.empty:
        return df
    ordem = {"🔴 Atrasado": 0, "🟡 Chegando": 1, "🟢 Em dia": 2, "⚪ Doação única": 3}
    df["_o"] = df.Status.map(ordem)
    return df.sort_values(["_o", "Dias desde"], ascending=[True, False]).drop(columns="_o").reset_index(drop=True)


def _is_eventual(row) -> bool:
    if row.tipo != "Saída":
        return False
    rec = str(row.recorrencia).lower()
    cat = str(row.categoria).lower()
    return ("pontual" in rec or "eventual" in rec
            or any(k in cat for k in ("veterin", "saúde", "saude", "medicament")))


def reserva(d: pd.DataFrame) -> dict:
    ev = d[d.apply(_is_eventual, axis=1)].sort_values("data")
    info = {"recomendada": 0.0, "n": len(ev), "intervalo": 0.0, "eventos_mes": 0.0,
            "custo_medio": 0.0, "p90": 0.0, "media_mensal": 0.0,
            "reserva_mensal": 0.0, "reserva_seguranca": 0.0}
    if len(ev) < 2:
        return info
    valores = ev.valor.values
    intervalos = ev.data.dt.normalize().diff().dropna().dt.days
    intervalo = float(intervalos.mean())
    eventos_mes = 30 / intervalo if intervalo > 0 else 0
    p90 = float(np.percentile(valores, 90))
    reserva_mensal = max(eventos_mes, 1) * p90
    por_mes = ev.groupby("mes").valor.sum().values
    media_mensal = float(np.mean(por_mes))
    std_mensal = float(np.std(por_mes, ddof=1)) if len(por_mes) > 1 else 0.0
    reserva_seg = media_mensal + 1.65 * std_mensal
    info.update({
        "recomendada": max(reserva_mensal, reserva_seg),
        "intervalo": intervalo, "eventos_mes": eventos_mes,
        "custo_medio": float(np.mean(valores)), "p90": p90,
        "media_mensal": media_mensal,
        "reserva_mensal": reserva_mensal, "reserva_seguranca": reserva_seg,
    })
    return info


def tendencia_categorias(d: pd.DataFrame) -> pd.DataFrame:
    saidas = d[d.tipo == "Saída"].copy()
    if saidas.empty:
        return pd.DataFrame()
    meses = sorted(saidas.mes.unique())
    out = []
    for cat, g in saidas.groupby(saidas.categoria.replace("", "(sem categoria)")):
        serie = [g.loc[g.mes == m, "valor"].sum() for m in meses]
        total = float(sum(serie))
        media = total / len(meses)
        slope = float(np.polyfit(range(len(serie)), serie, 1)[0]) if len(serie) >= 2 else 0.0
        # variação total prevista ao longo do período, relativa à média mensal
        variacao_total = slope * (len(serie) - 1)
        rel = variacao_total / media if media > 0 else 0.0
        if rel > 0.15 and variacao_total > 50:
            cls = "↑ Crescente"
        elif rel < -0.15 and variacao_total < -50:
            cls = "↓ Decrescente"
        else:
            cls = "→ Estável"
        out.append({"Categoria": cat, "Total": total, "Média/mês": media,
                    "Tendência (R$/mês)": slope, "Classificação": cls})
    return pd.DataFrame(out).sort_values("Total", ascending=False).reset_index(drop=True)


def brl(v: float) -> str:
    return ("R$ " + f"{v:,.2f}").replace(",", "X").replace(".", ",").replace("X", ".")


# ----------------------------------------------------------------------
# CONEXÃO COM A PLANILHA
# ----------------------------------------------------------------------
@st.cache_resource(show_spinner=False)
def _abrir_worksheet():
    import gspread
    from google.oauth2.service_account import Credentials

    escopos = ["https://www.googleapis.com/auth/spreadsheets"]
    info = dict(st.secrets["gcp_service_account"])
    creds = Credentials.from_service_account_info(info, scopes=escopos)
    gc = gspread.authorize(creds)
    sh = gc.open_by_key(st.secrets["sheet_id"])
    try:
        return sh.worksheet("Lançamentos")
    except Exception:
        return sh.sheet1


@st.cache_data(ttl=60, show_spinner="Lendo a planilha…")
def carregar_dados() -> pd.DataFrame:
    ws = _abrir_worksheet()
    registros = ws.get_all_records()  # usa a 1ª linha como cabeçalho
    return pd.DataFrame(registros)


def gravar_lancamentos(linhas: list) -> int:
    """Adiciona várias linhas de uma vez na planilha. Retorna quantas gravou."""
    ws = _abrir_worksheet()
    existentes = len(ws.get_all_values())  # inclui cabeçalho
    base_id = existentes  # próximo ID
    payload = []
    for i, r in enumerate(linhas):
        d = r["data"]
        payload.append([
            base_id + i,
            dt.datetime.now().strftime("%d/%m/%Y %H:%M"),
            d.strftime("%d/%m/%Y"),
            d.strftime("%Y-%m"),
            r["tipo"], r["valor"], r["pessoa"], r["categoria"],
            r["forma"], r["recorrencia"], r["obs"],
        ])
    if payload:
        ws.append_rows(payload, value_input_option="USER_ENTERED")
    return len(payload)


def conectado() -> bool:
    try:
        return "gcp_service_account" in st.secrets and "sheet_id" in st.secrets
    except Exception:
        return False


# ----------------------------------------------------------------------
# UI
# ----------------------------------------------------------------------
def pagina_dashboard(d: pd.DataFrame):
    st.title("🐾 Painel Financeiro — Abrigo de Animais")
    if d.empty:
        st.info("Ainda não há lançamentos. Vá em **Novo Registro** para começar.")
        return
    r = resumo_caixa(d)
    res = reserva(d)
    proj = projecao(d)
    saldo_prox = (proj.saldo_esp.iloc[0] if not proj.empty else 0.0)

    c1, c2, c3 = st.columns(3)
    c1.metric("Saldo atual em caixa", brl(r["saldo"]))
    c2.metric("Entradas no mês", brl(r["ent_mes"]))
    c3.metric("Saídas no mês", brl(r["sai_mes"]))
    c4, c5, c6 = st.columns(3)
    c4.metric("Saldo do mês", brl(r["saldo_mes"]))
    c5.metric("Reserva recomendada", brl(res["recomendada"]),
              help="Quanto manter guardado para emergências (veterinário etc.)")
    c6.metric("Saldo projetado (mês que vem)", brl(saldo_prox))

    st.divider()
    cols = st.columns([3, 2])
    with cols[0]:
        st.subheader("Saldo acumulado")
        hist = serie_mensal(d)
        st.line_chart(hist.set_index("mes")[["acumulado"]], height=280, color=VERDE)
    with cols[1]:
        st.subheader("🔔 Doadores para abordar")
        dd = doadores(d)
        alertas = dd[dd.Status.str.contains("Atrasado|Chegando")] if not dd.empty else dd
        if alertas is not None and not alertas.empty:
            for _, row in alertas.head(8).iterrows():
                st.write(f"**{row['Doador']}** — {row['Status']} "
                         f"(última em {row['Última doação']})")
        else:
            st.caption("Ninguém atrasado por enquanto. 🎉")


def pagina_novo_registro(d: pd.DataFrame):
    st.title("➕ Novo Registro")
    st.caption("Adicione **uma ou várias linhas** de uma vez. Clique em **+** para "
               "mais linhas e em **Registrar** para enviar tudo à planilha.")

    modelo = pd.DataFrame([{
        "Data": dt.date.today(), "Tipo": "Entrada", "Valor (R$)": None,
        "Doador / Fornecedor": "", "Categoria": "", "Forma de pagamento": "",
        "Recorrência": "", "Observações": "",
    } for _ in range(3)])

    edit = st.data_editor(
        modelo, num_rows="dynamic", use_container_width=True, hide_index=True,
        column_config={
            "Data": st.column_config.DateColumn("Data", format="DD/MM/YYYY", required=True),
            "Tipo": st.column_config.SelectboxColumn("Tipo", options=TIPOS, required=True),
            "Valor (R$)": st.column_config.NumberColumn("Valor (R$)", min_value=0.0,
                                                        step=10.0, format="%.2f"),
            "Doador / Fornecedor": st.column_config.TextColumn("Doador / Fornecedor"),
            "Categoria": st.column_config.SelectboxColumn("Categoria", options=CATEGORIAS),
            "Forma de pagamento": st.column_config.SelectboxColumn("Forma", options=FORMAS_PGTO),
            "Recorrência": st.column_config.SelectboxColumn("Recorrência", options=RECORRENCIAS),
            "Observações": st.column_config.TextColumn("Observações"),
        },
        key="editor_registro",
    )

    if st.button("✅ Registrar lançamentos", type="primary"):
        linhas, erros = [], []
        for i, row in edit.iterrows():
            preenchida = any(str(row[c]).strip() not in ("", "None", "nan")
                             for c in edit.columns if c != "Data")
            if not preenchida and pd.isna(row["Valor (R$)"]):
                continue
            problemas = []
            if pd.isna(row["Data"]):
                problemas.append("data")
            if str(row["Tipo"]) not in TIPOS:
                problemas.append("tipo")
            valor = parse_valor(row["Valor (R$)"])
            if valor <= 0:
                problemas.append("valor")
            if problemas:
                erros.append(f"Linha {i + 1}: revise {', '.join(problemas)}")
                continue
            linhas.append({
                "data": pd.Timestamp(row["Data"]).date(), "tipo": str(row["Tipo"]),
                "valor": valor, "pessoa": str(row["Doador / Fornecedor"] or "").strip(),
                "categoria": str(row["Categoria"] or "").strip(),
                "forma": str(row["Forma de pagamento"] or "").strip(),
                "recorrencia": str(row["Recorrência"] or "").strip(),
                "obs": str(row["Observações"] or "").strip(),
            })
        if not linhas and not erros:
            st.warning("Nenhuma linha preenchida.")
        else:
            if linhas:
                n = gravar_lancamentos(linhas)
                st.cache_data.clear()
                st.success(f"✅ {n} lançamento(s) registrado(s) na planilha!")
            if erros:
                st.error("Algumas linhas não foram registradas:\n\n- " + "\n- ".join(erros))


def pagina_projecao(d: pd.DataFrame):
    st.title("📈 Projeção Mensal de Saldo")
    hist = serie_mensal(d)
    if hist.empty:
        st.info("Sem dados ainda.")
        return
    st.subheader("Histórico por mês")
    show = hist.copy()
    for c in ("entradas", "saidas", "saldo", "acumulado"):
        show[c] = show[c].map(brl)
    st.dataframe(show, use_container_width=True, hide_index=True)
    st.bar_chart(hist.set_index("mes")[["entradas", "saidas"]], height=300,
                 color=[VERDE, VERMELHO])

    st.subheader("Previsão — próximos 3 meses")
    proj = projecao(d)
    if proj.empty:
        st.caption("Dados insuficientes para projetar.")
        return
    showp = proj.rename(columns={
        "mes": "Mês", "entradas_esp": "Entradas (esp.)", "saidas_esp": "Saídas (esp.)",
        "saldo_esp": "Saldo esperado", "saldo_pess": "Saldo pessimista",
        "saldo_otim": "Saldo otimista", "acum_esp": "Saldo acum. esperado"})
    for c in showp.columns[1:]:
        showp[c] = showp[c].map(brl)
    st.dataframe(showp, use_container_width=True, hide_index=True)
    st.caption("Cenários: **pessimista** = menos entrada / mais saída · "
               "**otimista** = mais entrada / menos saída (faixa de ±1 desvio-padrão).")


def pagina_doadores(d: pd.DataFrame):
    st.title("🧑‍🤝‍🧑 Doadores — quem está na hora de doar?")
    dd = doadores(d)
    if dd.empty:
        st.info("Sem doações registradas ainda.")
        return
    show = dd.copy()
    show["Total doado"] = show["Total doado"].map(brl)
    show["Média/doação"] = show["Média/doação"].map(brl)
    st.dataframe(show, use_container_width=True, hide_index=True)
    st.caption("🔴 Atrasado · 🟡 Chegando a hora · 🟢 Em dia · ⚪ Doação única. "
               "O intervalo é a média de dias entre as doações de cada pessoa.")


def pagina_reserva(d: pd.DataFrame):
    st.title("🛟 Reserva para Eventualidades")
    res = reserva(d)
    if res["n"] < 2:
        st.info("Registre mais gastos eventuais (veterinário, emergências) "
                "para calcular a reserva.")
        return
    st.metric("👉 Reserva recomendada", brl(res["recomendada"]),
              help="Guarde ao menos isto para imprevistos.")
    c1, c2, c3 = st.columns(3)
    c1.metric("Eventos imprevistos", res["n"])
    c2.metric("Intervalo médio", f"{round(res['intervalo'])} dias")
    c3.metric("Frequência", f"{res['eventos_mes']:.1f}/mês")
    c4, c5, c6 = st.columns(3)
    c4.metric("Custo médio/evento", brl(res["custo_medio"]))
    c5.metric("Pior caso (p90)", brl(res["p90"]))
    c6.metric("Gasto eventual/mês", brl(res["media_mensal"]))
    st.caption(f"Cobertura mensal (p90): {brl(res['reserva_mensal'])} · "
               f"Colchão de segurança (95%): {brl(res['reserva_seguranca'])}. "
               "Considera saídas 'Pontual/Eventual' ou de Veterinário/Saúde/Medicamentos.")


def pagina_categorias(d: pd.DataFrame):
    st.title("📊 Tendência de Gastos por Categoria")
    tc = tendencia_categorias(d)
    if tc.empty:
        st.info("Sem saídas registradas ainda.")
        return
    st.bar_chart(tc.set_index("Categoria")[["Total"]], height=320, color=VERDE)
    show = tc.copy()
    show["Total"] = show["Total"].map(brl)
    show["Média/mês"] = show["Média/mês"].map(brl)
    show["Tendência (R$/mês)"] = show["Tendência (R$/mês)"].map(lambda v: brl(v) + "/mês")
    st.dataframe(show, use_container_width=True, hide_index=True)
    st.caption("Tendência = variação média por mês (regressão linear). "
               "↑ categorias crescentes merecem atenção.")


# ----------------------------------------------------------------------
# APP
# ----------------------------------------------------------------------
def main():
    st.sidebar.title("🐾 Abrigo")
    st.sidebar.caption("Controle financeiro")

    if not conectado():
        st.title("🐾 Controle Financeiro — Abrigo de Animais")
        st.warning("App ainda não conectado à planilha Google.")
        st.markdown(
            "Para conectar, configure os **Secrets** com a conta de serviço do Google "
            "e o ID da planilha (veja o arquivo **INSTRUCOES_DEPLOY.md**). "
            "Enquanto isso, abaixo está uma prévia com dados de exemplo."
        )
        st.divider()
        d = _demo_df()
        pagina_dashboard(d)
        return

    try:
        d = normalize(carregar_dados())
    except Exception as e:  # noqa
        st.error(f"Não consegui ler a planilha. Verifique os Secrets e o "
                 f"compartilhamento.\n\nDetalhe técnico: {e}")
        return

    paginas = {
        "Dashboard": pagina_dashboard,
        "➕ Novo Registro": pagina_novo_registro,
        "📈 Projeção Mensal": pagina_projecao,
        "🧑‍🤝‍🧑 Doadores": pagina_doadores,
        "🛟 Reserva": pagina_reserva,
        "📊 Tendências": pagina_categorias,
    }
    escolha = st.sidebar.radio("Navegação", list(paginas.keys()))
    if st.sidebar.button("🔄 Atualizar dados"):
        st.cache_data.clear()
        st.rerun()
    st.sidebar.caption(f"{len(d)} lançamentos na base")
    paginas[escolha](d)


def _demo_df() -> pd.DataFrame:
    """DataFrame de exemplo só para a prévia quando não há conexão."""
    base = dt.date.today()
    rows = []
    for i in range(11, -1, -1):
        m = (base.replace(day=1) - pd.DateOffset(months=i)).date()
        rows += [
            {"data": m.replace(day=5), "tipo": "Entrada", "valor": 250, "pessoa": "Ana Paula",
             "categoria": "(Entrada) Doação em dinheiro", "forma": "Pix",
             "recorrencia": "Mensal", "obs": ""},
            {"data": m.replace(day=6), "tipo": "Saída", "valor": 600 + (11 - i) * 12,
             "pessoa": "Pet Shop", "categoria": "(Saída) Alimentação", "forma": "Boleto",
             "recorrencia": "Mensal", "obs": ""},
            {"data": m.replace(day=15), "tipo": "Saída", "valor": 400 if i % 3 else 850,
             "pessoa": "VetVida", "categoria": "(Saída) Veterinário / Saúde", "forma": "Cartão",
             "recorrencia": "Pontual / Eventual", "obs": ""},
        ]
    df = pd.DataFrame(rows)
    df["data"] = pd.to_datetime(df["data"])
    df["mes"] = df["data"].dt.strftime("%Y-%m")
    return df


if __name__ == "__main__":
    main()
