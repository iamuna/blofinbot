"""Build the multi-coin research dataset (runs on a GitHub runner; standard library only).

1. Universe: BloFin USDT perpetuals ranked by 24h USDT volume -> top N (BTC and ETH always included).
2. For each coin, from Binance's public archive (USD-M futures first, spot as fallback):
     - 1h candles for the full history (from 2019-09 or listing),
     - 5m candles for the last 24 months,
     - 8h funding rates (futures only).
   Every archive is checked against its published SHA-256 .CHECKSUM.
3. Writes research/<COIN>/{1h,5m}.csv.gz (t_ms,o,h,l,c,v,quote_v,trades,taker_buy_v) and funding.csv.gz,
   plus research/universe.json and research/manifest.json. Missing data is listed, never invented.
"""
from __future__ import annotations

import csv
import gzip
import hashlib
import io
import json
import os
import sys
import time
import urllib.error
import urllib.request
import zipfile
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / os.environ.get("OUT_DIR", "research")
COINS = [c.strip().upper() for c in os.environ.get("COINS", "").split(",") if c.strip()]
TOP_N = int(os.environ.get("TOP_N", "20"))
FIVE_MIN_MONTHS = int(os.environ.get("FIVE_MIN_MONTHS", "24"))
START_1H = date(2019, 9, 1)
ARCH = "https://data.binance.vision/data/{market}/{period}/{kind}/{sym}/{extra}{sym}-{suffix}.zip"
STABLE = {"USDC", "FDUSD", "TUSD", "DAI", "USDE", "USD1", "PYUSD", "BUSD", "USDP"}


def get(url: str, retries: int = 4) -> bytes | None:
    req = urllib.request.Request(url, headers={"User-Agent": "blofinbot-research/1.0"})
    last = None
    for attempt in range(retries):
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                return r.read()
        except urllib.error.HTTPError as exc:
            if exc.code == 404:
                return None
            last = exc
        except Exception as exc:
            last = exc
        time.sleep(min(8.0, 1.0 * 2 ** attempt))
    raise RuntimeError(f"GET failed: {url}: {last}")


def blofin_universe() -> list[dict]:
    body = get("https://openapi.blofin.com/api/v1/market/tickers")
    data = json.loads(body)["data"]
    rows = []
    for t in data:
        inst = t.get("instId", "")
        if not inst.endswith("-USDT"):
            continue
        base = inst[:-5]
        if base in STABLE:
            continue
        last = float(t.get("last") or 0)
        base_vol = float(t.get("volCurrency24h") or 0)
        rows.append({"instId": inst, "base": base, "last": last, "quoteVol24h": round(base_vol * last, 2), "raw_vol24h": t.get("vol24h")})
    rows.sort(key=lambda r: r["quoteVol24h"], reverse=True)
    return rows


def archive(market: str, period: str, kind: str, sym: str, interval: str | None, stamp: str) -> bytes | None:
    extra = f"{interval}/" if interval else ""
    suffix = f"{interval}-{stamp}" if interval else f"{kind}-{stamp}"
    url = ARCH.format(market=market, period=period, kind=kind, sym=sym, extra=extra, suffix=suffix)
    body = get(url)
    if body is None:
        return None
    chk = get(url + ".CHECKSUM")
    if chk is not None and chk.decode().split()[0].strip().lower() != hashlib.sha256(body).hexdigest():
        raise RuntimeError(f"checksum mismatch {url}")
    with zipfile.ZipFile(io.BytesIO(body)) as z:
        name = next(n for n in z.namelist() if n.endswith(".csv"))
        return z.read(name)


def months(a: date, b: date):
    y, m = a.year, a.month
    while (y, m) <= (b.year, b.month):
        yield y, m
        y, m = (y + 1, 1) if m == 12 else (y, m + 1)


def ms(x: str) -> int:
    v = int(float(x))
    return v // 1000 if v > 10 ** 14 else v


def parse_klines(raw: bytes) -> list[list]:
    out = []
    for r in csv.reader(io.StringIO(raw.decode())):
        if not r or not r[0][:1].isdigit():
            continue
        out.append([ms(r[0]), r[1], r[2], r[3], r[4], r[5], r[7], r[8], r[9]])
    return out


def klines(market: str, sym: str, interval: str, first: date, today: date) -> dict[int, list]:
    rows: dict[int, list] = {}
    this_month = date(today.year, today.month, 1)
    holes: list[date] = []
    started = False
    misses = 0
    for y, m in months(first, this_month - timedelta(days=1)):
        raw = archive(market, "monthly", "klines", sym, interval, f"{y:04d}-{m:02d}")
        if raw is None:
            if started:  # a hole after listing: fetch that month day by day
                misses += 1
                if misses >= 3:  # delisted: stop, and drop the holes collected while confirming it
                    holes = holes[: max(0, len(holes) - 2)]
                    break
                holes.append(date(y, m, 1))
            continue
        started = True
        misses = 0
        for k in parse_klines(raw):
            rows[k[0]] = k
    days = []
    for h in holes:
        d = h
        while d.month == h.month:
            days.append(d)
            d += timedelta(days=1)
    d = this_month
    while d < today and misses < 3:
        days.append(d)
        d += timedelta(days=1)
    for d in days:
        raw = archive(market, "daily", "klines", sym, interval, d.isoformat())
        if raw is not None:
            for k in parse_klines(raw):
                rows[k[0]] = k
    return rows


def funding(sym: str, first: date, today: date) -> dict[int, list]:
    rows: dict[int, list] = {}
    for y, m in months(first, today):
        raw = archive("futures/um", "monthly", "fundingRate", sym, None, f"{y:04d}-{m:02d}")
        if raw is None:
            continue
        for r in csv.reader(io.StringIO(raw.decode())):
            if r and r[0][:1].isdigit():
                rows[ms(r[0])] = [ms(r[0]), r[2] if len(r) > 2 else r[1]]
    return rows


def write_gz(path: Path, header: list[str], rows: list[list]):
    path.parent.mkdir(parents=True, exist_ok=True)
    with gzip.open(path, "wt", encoding="utf-8", compresslevel=9) as fh:
        w = csv.writer(fh)
        w.writerow(header)
        w.writerows(rows)


def resolve(base: str, today: date) -> tuple[str, str] | None:
    """Find the Binance symbol/market that has archives for this coin."""
    probes = [(today.replace(day=1) - timedelta(days=1)).strftime("%Y-%m")]
    if COINS:  # explicit list may include delisted coins
        probes += ["2024-06", "2023-01", "2022-04", "2021-06"]
    for market, sym in (("futures/um", f"{base}USDT"), ("futures/um", f"1000{base}USDT"), ("spot", f"{base}USDT")):
        for probe in probes:
            if archive(market, "monthly", "klines", sym, "1h", probe) is not None:
                return market, sym
    return None


def build_coin(row: dict, today: date) -> dict:
    base = row["base"]
    info = {"coin": base, "blofin": row["instId"], "quoteVol24h": row["quoteVol24h"]}
    try:
        res = resolve(base, today)
        if not res:
            info["status"] = "no Binance archive"
            return info
        market, sym = res
        info.update({"binance_market": market, "binance_symbol": sym, "price_scale": 1000 if sym.startswith("1000") else 1})
        h1 = klines(market, sym, "1h", START_1H, today)
        five_from = date(today.year, today.month, 1) - timedelta(days=31 * FIVE_MIN_MONTHS)
        m5 = klines(market, sym, "5m", five_from.replace(day=1), today) if FIVE_MIN_MONTHS > 0 else {}
        hdr = ["t", "o", "h", "l", "c", "v", "qv", "n", "tbv"]
        write_gz(OUT / base / "1h.csv.gz", hdr, [h1[k] for k in sorted(h1)])
        if m5:
            write_gz(OUT / base / "5m.csv.gz", hdr, [m5[k] for k in sorted(m5)])
        for name, rows, step in (("1h", h1, 3_600_000), ("5m", m5, 300_000)):
            if not rows:
                continue
            ts = sorted(rows)
            gaps = sum(1 for a, b in zip(ts, ts[1:]) if b - a != step)
            info[name] = {"rows": len(ts), "first": ts[0] if ts else None, "last": ts[-1] if ts else None, "gaps": gaps}
        if market == "futures/um":
            fr = funding(sym, START_1H, today)
            write_gz(OUT / base / "funding.csv.gz", ["t", "rate"], [fr[k] for k in sorted(fr)])
            info["funding_rows"] = len(fr)
        info["status"] = "ok"
    except Exception as exc:  # keep going; report per coin
        info["status"] = "failed"
        info["error"] = str(exc)[:300]
    return info


def main() -> int:
    OUT.mkdir(parents=True, exist_ok=True)
    today = datetime.now(timezone.utc).date()
    manifest = {"generated_at_utc": datetime.now(timezone.utc).isoformat(), "top_n": TOP_N}
    try:
        if COINS:
            uni = [{"instId": f"{c}-USDT", "base": c, "last": 0, "quoteVol24h": 0} for c in COINS]
            pick = uni
            manifest["explicit_coins"] = COINS
        else:
            uni = blofin_universe()
            manifest["blofin_usdt_perps"] = len(uni)
            pick = [r for r in uni if r["base"] in ("BTC", "ETH")]
            for r in uni:
                if len(pick) >= TOP_N:
                    break
                if r not in pick:
                    pick.append(r)
        (OUT / "universe.json").write_text(json.dumps({"generated_at_utc": manifest["generated_at_utc"], "ranked_top50": uni[:50], "selected": pick}, indent=1))
        with ThreadPoolExecutor(max_workers=6) as ex:
            coins = list(ex.map(lambda r: build_coin(r, today), pick))
        manifest["coins"] = coins
        manifest["status"] = "ok" if all(c.get("status") == "ok" for c in coins) else "partial"
        code = 0
    except Exception as exc:
        manifest["status"] = "failed"
        manifest["error"] = str(exc)[:500]
        code = 1
    (OUT / "manifest.json").write_text(json.dumps(manifest, indent=1))
    print(json.dumps({k: v for k, v in manifest.items() if k != "coins"}, indent=1))
    for c in manifest.get("coins", []):
        print(c.get("coin"), c.get("status"), c.get("binance_symbol"), (c.get("1h") or {}).get("rows"), (c.get("5m") or {}).get("rows"), c.get("error", ""))
    return code


if __name__ == "__main__":
    sys.exit(main())
