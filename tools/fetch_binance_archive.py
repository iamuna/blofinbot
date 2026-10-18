"""Fill the Binance BTCUSDT 1m history gap from Binance's public bulk archive.

The source ZIP ends at 2025-10-11 11:02 UTC. This tool rebuilds everything from
2025-10-11 11:00 UTC (3-candle overlap, same join policy as build_btc_gap.py) up
to the latest closed minute it can obtain:

1. monthly archives  data.binance.vision/data/spot/monthly/klines/BTCUSDT/1m/
2. daily archives    data.binance.vision/data/spot/daily/klines/BTCUSDT/1m/
3. the public REST API (data-api.binance.vision) for the hours after the last
   published daily archive, when reachable.

Every archive is checked against its published SHA-256 .CHECKSUM file.
No candle is invented: missing minutes stay missing and are listed in the
manifest. Output matches tools/build_btc_gap.py so tools/merge_btc_gap.py and
`btc_bot.cli bootstrap` can consume it.

Standard library only. Always writes output/BTCUSDT_1m_gap_manifest.json,
including on failure, so a CI run that cannot be inspected still reports why.
"""
from __future__ import annotations

import csv
import hashlib
import io
import json
import sys
import time
import traceback
import urllib.error
import urllib.parse
import urllib.request
import zipfile
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

SYMBOL = "BTCUSDT"
ARCHIVE = "https://data.binance.vision/data/spot/{period}/klines/BTCUSDT/1m/BTCUSDT-1m-{stamp}.zip"
API = "https://data-api.binance.vision/api/v3/klines"
START = datetime(2025, 10, 11, 11, 0, tzinfo=timezone.utc)
START_MS = int(START.timestamp() * 1000)
MIN_MS = 60_000

HEADER = [
    "Open time", "Open", "High", "Low", "Close", "Volume", "Close time",
    "Quote asset volume", "Number of trades",
    "Taker buy base asset volume", "Taker buy quote asset volume", "Ignore",
]

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "output"
CSV_PATH = OUT / "BTCUSDT_1m_gap_20251011_to_latest.csv"
ZIP_PATH = OUT / "BTCUSDT_1m_gap_20251011_to_latest.zip"
MANIFEST_PATH = OUT / "BTCUSDT_1m_gap_manifest.json"


def utc_text(ms: int, millis: bool = False) -> str:
    dt = datetime.fromtimestamp(ms / 1000, tz=timezone.utc)
    return dt.strftime("%Y-%m-%d %H:%M:%S.%f")[:-3] if millis else dt.strftime("%Y-%m-%d %H:%M:%S")


def to_ms(raw: str) -> int:
    v = int(float(raw))
    if v > 10**14:  # spot archives switched to microseconds on 2025-01-01
        v //= 1000
    return v


def get(url: str, retries: int = 4) -> bytes | None:
    """Return the body, None on 404, raise after retries on anything else."""
    req = urllib.request.Request(url, headers={"User-Agent": "blofinbot-history/1.0"})
    last = None
    for attempt in range(retries):
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                return r.read()
        except urllib.error.HTTPError as exc:
            if exc.code == 404:
                return None
            last = exc
        except Exception as exc:  # network hiccup
            last = exc
        time.sleep(min(8.0, 1.0 * 2 ** attempt))
    raise RuntimeError(f"GET failed after {retries} attempts: {url}: {last}")


def archive_rows(period: str, stamp: str, log: list) -> list[list[str]] | None:
    url = ARCHIVE.format(period=period, stamp=stamp)
    body = get(url)
    if body is None:
        log.append({"archive": url, "status": "not published"})
        return None
    chk = get(url + ".CHECKSUM")
    sha = hashlib.sha256(body).hexdigest()
    if chk is not None:
        expected = chk.decode().split()[0].strip().lower()
        if expected != sha:
            raise RuntimeError(f"checksum mismatch for {url}")
    with zipfile.ZipFile(io.BytesIO(body)) as z:
        name = next(n for n in z.namelist() if n.endswith(".csv"))
        text = z.read(name).decode()
    rows = [r for r in csv.reader(io.StringIO(text)) if r and r[0][:1].isdigit()]
    log.append({"archive": url, "status": "ok", "rows": len(rows), "sha256": sha, "checksum_verified": chk is not None})
    return rows


def api_rows(start_ms: int, end_ms: int, log: list) -> list[list[str]]:
    out: list[list[str]] = []
    cursor = start_ms
    while cursor <= end_ms:
        q = urllib.parse.urlencode({"symbol": SYMBOL, "interval": "1m", "startTime": cursor, "endTime": end_ms, "limit": 1000})
        body = get(f"{API}?{q}")
        if body is None:
            break
        batch = json.loads(body)
        if not isinstance(batch, list) or not batch:
            break
        out.extend([[str(x) for x in k] for k in batch])
        nxt = int(batch[-1][0]) + MIN_MS
        if nxt <= cursor:
            break
        cursor = nxt
        time.sleep(0.05)
    log.append({"api": API, "status": "ok", "rows": len(out)})
    return out


def month_iter(first: date, last: date):
    y, m = first.year, first.month
    while (y, m) <= (last.year, last.month):
        yield y, m
        y, m = (y + 1, 1) if m == 12 else (y, m + 1)


def main() -> int:
    OUT.mkdir(parents=True, exist_ok=True)
    log: list = []
    manifest: dict = {"symbol": SYMBOL, "market": "Binance spot", "interval": "1m", "generated_at_utc": datetime.now(timezone.utc).isoformat(), "sources": log}
    try:
        now = datetime.now(timezone.utc)
        end_ms = (int(now.timestamp() * 1000) // MIN_MS) * MIN_MS - MIN_MS  # last closed minute
        rows: dict[int, list[str]] = {}

        def take(raw_rows):
            for r in raw_rows:
                t = to_ms(r[0])
                if START_MS <= t <= end_ms:
                    rows[t] = r

        this_month = date(now.year, now.month, 1)
        daily_from = this_month
        for y, m in month_iter(START.date(), this_month - timedelta(days=1)):
            got = archive_rows("monthly", f"{y:04d}-{m:02d}", log)
            if got is None:  # monthly not published yet → fall back to that month's daily files
                daily_from = min(daily_from, date(y, m, 1))
                continue
            take(got)
        d = daily_from
        last_daily = None
        while d < now.date():
            got = archive_rows("daily", d.isoformat(), log)
            if got is not None:
                take(got)
                last_daily = d
            d += timedelta(days=1)

        last_have = max(rows) if rows else START_MS - MIN_MS
        if last_have < end_ms:
            try:
                take(api_rows(last_have + MIN_MS, end_ms, log))
            except Exception as exc:  # API may be geo-blocked; archives still stand
                log.append({"api": API, "status": "unavailable", "error": str(exc)[:300]})

        if not rows:
            raise RuntimeError("no candles obtained from archives or API")

        times = sorted(rows)
        gaps = []
        for a, b in zip(times, times[1:]):
            if b - a != MIN_MS:
                gaps.append({"after": utc_text(a), "next_present": utc_text(b), "missing_minutes": (b - a) // MIN_MS - 1})

        with CSV_PATH.open("w", newline="", encoding="utf-8") as fh:
            w = csv.writer(fh)
            w.writerow(HEADER)
            for t in times:
                r = rows[t]
                w.writerow([utc_text(t), r[1], r[2], r[3], r[4], r[5], utc_text(to_ms(r[6]), millis=True), r[7], f"{float(r[8]):.1f}", r[9], r[10], "0.0"])
        csv_sha = hashlib.sha256(CSV_PATH.read_bytes()).hexdigest()
        with zipfile.ZipFile(ZIP_PATH, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as z:
            z.write(CSV_PATH, arcname=CSV_PATH.name)
        CSV_PATH.unlink()
        manifest.update({
            "status": "ok",
            "first_candle_utc": utc_text(times[0]),
            "last_closed_candle_utc": utc_text(times[-1]),
            "rows": len(times),
            "expected_rows_if_continuous": (times[-1] - times[0]) // MIN_MS + 1,
            "gap_count": len(gaps),
            "gaps": gaps[:500],
            "last_daily_archive": last_daily.isoformat() if last_daily else None,
            "csv_sha256": csv_sha,
            "zip_file": ZIP_PATH.name,
            "zip_sha256": hashlib.sha256(ZIP_PATH.read_bytes()).hexdigest(),
            "join_policy": "First three candles overlap the source ZIP (2025-10-11 11:00-11:02). merge_btc_gap.py verifies the overlap and treats the source's terminal 11:02 candle as provisional.",
        })
        code = 0
    except Exception as exc:
        manifest.update({"status": "failed", "error": str(exc), "trace": traceback.format_exc()[-2000:]})
        code = 1
    MANIFEST_PATH.write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    print(json.dumps({k: v for k, v in manifest.items() if k not in ("sources", "gaps", "trace")}, indent=2))
    return code


if __name__ == "__main__":
    sys.exit(main())
