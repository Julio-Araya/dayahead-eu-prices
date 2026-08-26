"""
Sondas adicionales de la Fase 0 (complementan spike_apis.py).

Verifican con datos reales: forward fill A03, días de cambio de hora en las tres
fuentes, alineación de bloques SMARD, paginación de PSE, festivos del BCE y
disponibilidad del día D+1. Guardan las respuestas crudas en /spike/raw.

Uso:
    export ENTSOE_TOKEN=...   (nunca en el repo)
    python spike/spike_probes.py

Resultados del 2026-08-26 en spike/findings-2026-08-26.md.
"""
import os, json, requests, xml.etree.ElementTree as ET
from datetime import datetime, timedelta, timezone, date
from pathlib import Path
from zoneinfo import ZoneInfo
RAW = Path(__file__).parent / "raw"
RAW.mkdir(exist_ok=True)
H = {"User-Agent": "dayahead-spike/0.1"}; T = 60
tok = os.environ["ENTSOE_TOKEN"]

def sec(t): print("\n" + "="*70 + "\n" + t + "\n" + "="*70)

# ---------- A. A03: duplicados consecutivos ----------
sec("A. A03 - ¿hay precios iguales consecutivos entre los puntos presentes?")
for f in ("entsoe_ES_2026-08-25.xml", "entsoe_RO_2026-08-25.xml"):
    root = ET.parse(RAW / f).getroot(); ns = {"ns": root.tag.split("}")[0].strip("{")}
    for i, ts in enumerate(root.findall("ns:TimeSeries", ns)):
        cma = ts.findtext("ns:contract_MarketAgreement.type", namespaces=ns)
        p = ts.find("ns:Period", ns)
        pts = [(int(x.findtext("ns:position", namespaces=ns)), float(x.findtext("ns:price.amount", namespaces=ns))) for x in p.findall("ns:Point", ns)]
        dup_adjacent = [(a, b) for (a, pa), (b, pb) in zip(pts, pts[1:]) if b == a + 1 and pa == pb]
        gaps = [(a, b) for (a, _), (b, _) in zip(pts, pts[1:]) if b > a + 1]
        print(f"{f[7:9]} TS[{i}] cma={cma} pts={len(pts)} pares_consecutivos_iguales={len(dup_adjacent)} huecos_de_posicion={len(gaps)} ej_huecos={gaps[:4]}")
        if dup_adjacent: print("   ejemplo duplicado adyacente:", dup_adjacent[:5])

# ---------- B. ENTSO-E: DST y ventana exacta ----------
def entsoe(country, dom, start, end, tag):
    r = requests.get("https://web-api.tp.entsoe.eu/api", params=dict(documentType="A44", in_Domain=dom, out_Domain=dom,
        periodStart=start.strftime("%Y%m%d%H%M"), periodEnd=end.strftime("%Y%m%d%H%M"), securityToken=tok), headers=H, timeout=T)
    (RAW / f"entsoe_{country}_{tag}.xml").write_bytes(r.content)
    root = ET.fromstring(r.content); ns = {"ns": root.tag.split("}")[0].strip("{")}
    if "Acknowledgement" in root.tag:
        print(f"  {country} {tag}: ACK", root.findtext(".//ns:Reason/ns:text", namespaces=ns)); return
    for i, ts in enumerate(root.findall("ns:TimeSeries", ns)):
        cma = ts.findtext("ns:contract_MarketAgreement.type", namespaces=ns)
        seq = ts.findtext("ns:classificationSequence_AttributeInstanceComponent.position", namespaces=ns)
        for p in ts.findall("ns:Period", ns):
            t0 = p.findtext("ns:timeInterval/ns:start", namespaces=ns); t1 = p.findtext("ns:timeInterval/ns:end", namespaces=ns)
            res = p.findtext("ns:resolution", namespaces=ns); n = len(p.findall("ns:Point", ns))
            a = datetime.strptime(t0, "%Y-%m-%dT%H:%MZ"); b = datetime.strptime(t1, "%Y-%m-%dT%H:%MZ")
            exp = int((b-a).total_seconds()/60/{"PT15M":15,"PT60M":60}[res])
            print(f"  {country} {tag} TS[{i}] cma={cma} seq={seq} {t0}->{t1} res={res} pts={n} esperados={exp}")

sec("B1. ENTSO-E ventana exacta día local Madrid 2026-08-25 (22:00Z->22:00Z)")
entsoe("ES", "10YES-REE------0", datetime(2026,8,24,22,tzinfo=timezone.utc), datetime(2026,8,25,22,tzinfo=timezone.utc), "exact_2026-08-25")
sec("B2. ENTSO-E DST primavera 2026-03-29 (esperado 92) ES y RO")
entsoe("ES", "10YES-REE------0", datetime(2026,3,28,23,tzinfo=timezone.utc), datetime(2026,3,29,22,tzinfo=timezone.utc), "dst_2026-03-29")
entsoe("RO", "10YRO-TEL------P", datetime(2026,3,28,22,tzinfo=timezone.utc), datetime(2026,3,29,21,tzinfo=timezone.utc), "dst_2026-03-29")
sec("B3. ENTSO-E DST otoño 2025-10-26 (esperado 100) ES")
entsoe("ES", "10YES-REE------0", datetime(2025,10,25,22,tzinfo=timezone.utc), datetime(2025,10,26,23,tzinfo=timezone.utc), "dst_2025-10-26")
sec("B4. ENTSO-E día antes de PT15M: 2025-09-15 ES (¿PT60M?)")
entsoe("ES", "10YES-REE------0", datetime(2025,9,14,22,tzinfo=timezone.utc), datetime(2025,9,15,22,tzinfo=timezone.utc), "pre15m_2025-09-15")
sec("B5. ENTSO-E D+2 (2026-08-27, no debería existir aún)")
entsoe("ES", "10YES-REE------0", datetime(2026,8,26,22,tzinfo=timezone.utc), datetime(2026,8,27,22,tzinfo=timezone.utc), "future_2026-08-27")

# ---------- C. SMARD ----------
sec("C. SMARD - alineación de bloques y DST")
idx = json.loads((RAW / "smard_index.json").read_text())["timestamps"]
hours = {}
for t in idx:
    h = datetime.fromtimestamp(t/1000, tz=timezone.utc).hour; hours[h] = hours.get(h, 0) + 1
print("hora UTC de inicio de bloques (conteo):", hours, "| día de semana del último:", datetime.fromtimestamp(idx[-1]/1000, tz=timezone.utc).strftime("%A"))
BER = ZoneInfo("Europe/Berlin")
def smard_day(d):
    ds = datetime(d.year, d.month, d.day, tzinfo=BER); de = ds + timedelta(days=1)
    ds_ms, de_ms = int(ds.timestamp()*1000), int(de.timestamp()*1000)
    bt = max(t for t in idx if t <= ds_ms)
    f = RAW / f"smard_block_{bt}.json"
    if not f.exists():
        r = requests.get(f"https://www.smard.de/app/chart_data/4169/DE/4169_DE_hour_{bt}.json", headers=H, timeout=T); f.write_bytes(r.content)
    s = json.loads(f.read_text())["series"]
    pts = [x for x in s if ds_ms <= x[0] < de_ms]
    print(f"  {d} Berlin {ds.isoformat()}..{de.isoformat()} bloque={datetime.fromtimestamp(bt/1000, tz=timezone.utc).isoformat()} puntos={len(pts)} nulls={sum(1 for x in pts if x[1] is None)} primero={pts[0] if pts else None}")
smard_day(date(2026,8,25)); smard_day(date(2026,3,29)); smard_day(date(2025,10,26))
smard_day(date(2026,8,26)); smard_day(date(2026,8,27)); smard_day(date(2026,8,23))

# ---------- D. PSE ----------
sec("D. PSE - DST, paginación, disponibilidad")
def pse(filt, tag, extra=None):
    p = {"$filter": filt}; p.update(extra or {})
    r = requests.get("https://api.raporty.pse.pl/api/rce-pln", params=p, headers=H, timeout=T)
    (RAW / f"pse_{tag}.json").write_bytes(r.content)
    if r.status_code != 200: print(f"  {tag}: status {r.status_code} {r.text[:200]}"); return None
    d = r.json(); rows = d.get("value", [])
    print(f"  {tag}: status={r.status_code} filas={len(rows)} claves={list(d.keys())} nextLink={[k for k in d if 'next' in k.lower()]}")
    return rows
rows = pse("business_date eq '2026-03-29'", "dst_2026-03-29")
if rows: print("    ", rows[7]["dtime"], rows[7]["dtime_utc"], "|", rows[8]["dtime"], rows[8]["dtime_utc"], "| ultimo", rows[-1]["dtime"], rows[-1]["dtime_utc"])
rows = pse("business_date eq '2025-10-26'", "dst_2025-10-26")
if rows: print("    ", rows[11]["dtime"], rows[11]["dtime_utc"], "|", rows[12]["dtime"], rows[12]["dtime_utc"], "| ultimo", rows[-1]["dtime"], rows[-1]["dtime_utc"])
pse("business_date eq '2026-08-26'", "today_2026-08-26")
pse("business_date eq '2026-08-27'", "tomorrow_2026-08-27")
pse("business_date ge '2026-07-27' and business_date le '2026-08-25'", "range_30d")
pse("business_date eq '2026-08-25'", "top10", {"$top": 10})
pse("business_date eq '2026-08-25'", "select", {"$select": "dtime_utc,rce_pln,business_date", "$top": 2})
r = requests.get("https://api.raporty.pse.pl/api/rce-pln", params={"$filter": "business_date eq '2026-08-25'", "$first": 5}, headers=H, timeout=T)
print("  $first=5 ->", r.status_code, len(r.json().get("value", [])) if r.status_code == 200 else r.text[:120])
row = json.loads((RAW / "pse_2026-08-25.json").read_text())["value"][0]
print("  tipos:", {k: type(v).__name__ for k, v in row.items()})

# ---------- E. BCE ----------
sec("E. BCE - hoy, festivos TARGET, OBS_STATUS")
def ecb(a, b, tag):
    r = requests.get("https://data-api.ecb.europa.eu/service/data/EXR/D.PLN.EUR.SP00.A", params=dict(format="csvdata", startPeriod=a, endPeriod=b), headers=H, timeout=T)
    (RAW / f"ecb_{tag}.csv").write_bytes(r.content)
    lines = r.text.strip().splitlines()
    if r.status_code != 200 or len(lines) < 2: print(f"  {tag}: status={r.status_code} filas=0"); return
    h = lines[0].split(","); it, iv, ist = h.index("TIME_PERIOD"), h.index("OBS_VALUE"), h.index("OBS_STATUS")
    print(f"  {tag}: " + ", ".join(f"{l.split(',')[it]}={l.split(',')[iv]}({l.split(',')[ist]})" for l in lines[1:]))
print("  ahora UTC:", datetime.now(timezone.utc).isoformat())
ecb("2026-08-24", "2026-08-26", "today")
ecb("2026-04-01", "2026-04-07", "easter2026")
ecb("2026-04-30", "2026-05-04", "may1")
ecb("2026-08-13", "2026-08-17", "aug15")
r = requests.get("https://data-api.ecb.europa.eu/service/data/EXR/D.PLN.EUR.SP00.A", params=dict(format="jsondata", startPeriod="2026-08-25", endPeriod="2026-08-25"), headers=H, timeout=T)
print("  jsondata:", r.status_code, list(r.json().keys()) if r.status_code == 200 else r.text[:100])
