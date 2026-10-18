from __future__ import annotations

import csv
import hashlib
import json
import os
import time
import urllib.error
import urllib.parse
import urllib.request
import zipfile
from datetime import datetime, timezone
from pathlib import Path

SYMBOL = "BTCUSDT"
INTERVAL = "1m"
INTERVAL_MS = 60_000
# Include the final three candles already present in the user's source ZIP.
OVERLAP_START = datetime(2025, 10, 11, 11, 0, tzinfo=timezone.utc)
START_MS = int(OVERLAP_START.timestamp() * 1000)

API_BASES = [
    "https://data-api.binance.vision",
    "https://api.binance.com",
    "https://api-gcp.binance.com",
]

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


def utc_ms_text(ms: int, milliseconds: bool = False) -> str:
    dt = datetime.fromtimestamp(ms / 1000, tz=timezone.utc)
    if milliseconds:
        return dt.strftime("%Y-%m-%d %H:%M:%S.%f")[:-3]
    return dt.strftime("%Y-%m-%d %H:%M:%S")


def http_json(url: str, retries: int = 5):
    req = urllib.request.Request(url, headers={"User-Agent": "btc-gap-builder/1.0"})
    last = None
    for attempt in range(retries):
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                return json.loads(r.read().decode("utf-8"))
        except Exception as exc:
            last = exc
            time.sleep(min(5.0, 0.5 * (2 ** attempt)))
    raise RuntimeError(f"request failed after {retries} attempts: {url}: {last}")


def fetch_batch(start_ms: int, end_ms: int):
    params = urllib.parse.urlencode(
        {
            "symbol": SYMBOL,
            "interval": INTERVAL,
            "startTime": start_ms,
            "endTime": end_ms,
            "limit": 1000,
        }
    )
    errors = []
    for base in API_BASES:
        url = f"{base}/api/v3/klines?{params}"
        try:
            rows = http_json(url)
            if isinstance(rows, list):
                return rows, base
            errors.append(f"{base}: non-list response")
        except Exception as exc:
            errors.append(f"{base}: {exc}")
    raise RuntimeError("all Binance market-data endpoints failed: " + " | ".join(errors))


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)

    now_ms = int(datetime.now(timezone.utc).timestamp() * 1000)
    # Only include fully closed 1-minute candles.
    end_open_ms = (now_ms // INTERVAL_MS) * INTERVAL_MS - INTERVAL_MS
    if end_open_ms < START_MS:
        raise RuntimeError("end time precedes requested start time")

    cursor = START_MS
    rows_written = 0
    first_open = None
    last_open = None
    prev_open = None
    gaps = []
    endpoints = {}
    seen = set()

    with CSV_PATH.open("w", newline="", encoding="utf-8") as fh:
        writer = csv.writer(fh)
        writer.writerow(HEADER)

        while cursor <= end_open_ms:
            batch, endpoint = fetch_batch(cursor, end_open_ms)
            endpoints[endpoint] = endpoints.get(endpoint, 0) + 1
            if not batch:
                raise RuntimeError(
                    f"Binance returned no candles while cursor {utc_ms_text(cursor)} "
                    f"is before target {utc_ms_text(end_open_ms)}"
                )

            advanced = False
            for k in batch:
                if not isinstance(k, list) or len(k) < 11:
                    raise RuntimeError(f"unexpected kline row: {k!r}")

                open_ms = int(k[0])
                if open_ms < START_MS or open_ms > end_open_ms:
                    continue
                if open_ms in seen:
                    continue
                seen.add(open_ms)

                if prev_open is not None:
                    expected = prev_open + INTERVAL_MS
                    if open_ms != expected:
                        gaps.append(
                            {
                                "after": utc_ms_text(prev_open),
                                "expected": utc_ms_text(expected),
                                "next_present": utc_ms_text(open_ms),
                                "missing_minutes": max(
                                    0, (open_ms - expected) // INTERVAL_MS
                                ),
                            }
                        )

                writer.writerow(
                    [
                        utc_ms_text(open_ms),
                        k[1], k[2], k[3], k[4], k[5],
                        utc_ms_text(int(k[6]), milliseconds=True),
                        k[7],
                        f"{float(k[8]):.1f}",
                        k[9], k[10], "0.0",
                    ]
                )
                rows_written += 1
                first_open = open_ms if first_open is None else first_open
                last_open = open_ms
                prev_open = open_ms
                advanced = True

            if not advanced:
                raise RuntimeError(
                    f"batch did not advance cursor at {utc_ms_text(cursor)}"
                )

            cursor = int(batch[-1][0]) + INTERVAL_MS
            # 1000-candle calls are inexpensive, but a small delay is friendly to
            # the public endpoint and still keeps the job fast.
            time.sleep(0.025)

    if last_open is None:
        raise RuntimeError("no candles were written")

    expected_rows_without_exchange_gaps = (
        (last_open - START_MS) // INTERVAL_MS + 1
    )

    csv_sha = hashlib.sha256(CSV_PATH.read_bytes()).hexdigest()

    with zipfile.ZipFile(ZIP_PATH, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=6) as z:
        z.write(CSV_PATH, arcname=CSV_PATH.name)

    zip_sha = hashlib.sha256(ZIP_PATH.read_bytes()).hexdigest()

    manifest = {
        "symbol": SYMBOL,
        "market": "Binance spot",
        "interval": INTERVAL,
        "source_api_candidates": API_BASES,
        "endpoints_used": endpoints,
        "generated_at_utc": datetime.now(timezone.utc).isoformat(),
        "requested_overlap_start_utc": utc_ms_text(START_MS),
        "first_candle_utc": utc_ms_text(first_open),
        "last_closed_candle_utc": utc_ms_text(last_open),
        "rows": rows_written,
        "expected_rows_if_continuous": expected_rows_without_exchange_gaps,
        "gap_count": len(gaps),
        "gaps": gaps,
        "csv_sha256": csv_sha,
        "zip_sha256": zip_sha,
        "csv_file": CSV_PATH.name,
        "zip_file": ZIP_PATH.name,
        "join_policy": (
            "The first three candles intentionally overlap the source ZIP. "
            "The local merger verifies the older overlap exactly, then treats "
            "the source ZIP's terminal 2025-10-11 11:02 candle as potentially "
            "provisional and replaces it only if the Binance finalized candle "
            "is a valid cumulative extension. New rows begin at 11:03 UTC."
        ),
    }
    MANIFEST_PATH.write_text(json.dumps(manifest, indent=2), encoding="utf-8")

    print(json.dumps(manifest, indent=2))


if __name__ == "__main__":
    main()

# Workflow trigger: diagnostic artifact workflow enabled.
