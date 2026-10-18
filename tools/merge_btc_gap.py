from __future__ import annotations

import argparse
import csv
import hashlib
import io
import json
import zipfile
from collections import deque
from datetime import datetime, timezone
from pathlib import Path

HEADER = [
    "Open time", "Open", "High", "Low", "Close", "Volume", "Close time",
    "Quote asset volume", "Number of trades",
    "Taker buy base asset volume", "Taker buy quote asset volume", "Ignore",
]
INTERVAL_SECONDS = 60


def parse_open(value: str) -> datetime:
    return datetime.strptime(value, "%Y-%m-%d %H:%M:%S").replace(tzinfo=timezone.utc)


def num(value: str) -> float:
    return float(str(value).strip())


def canonical_number(value: str) -> str:
    try:
        return format(float(value), ".15g")
    except Exception:
        return str(value).strip()


def comparable(row: list[str]) -> tuple[str, ...]:
    return tuple(canonical_number(v) for v in row[1:11])


def finalized_extension(provisional: list[str], final: list[str]) -> bool:
    # A source dataset may end with an in-progress candle. A legitimate finalized
    # version must preserve the open, may only expand the high/low range, and must
    # have cumulative activity fields that are >= the provisional snapshot.
    if canonical_number(provisional[1]) != canonical_number(final[1]):
        return False
    if num(final[2]) < num(provisional[2]):  # high cannot shrink
        return False
    if num(final[3]) > num(provisional[3]):  # low cannot rise
        return False
    for idx in (5, 7, 8, 9, 10):
        if num(final[idx]) + 1e-12 < num(provisional[idx]):
            return False
    return True


def read_zip_csv(path: Path):
    z = zipfile.ZipFile(path)
    names = [n for n in z.namelist() if n.lower().endswith(".csv")]
    if len(names) != 1:
        z.close()
        raise RuntimeError(f"{path} must contain exactly one CSV, found {names}")
    raw = z.open(names[0])
    text = io.TextIOWrapper(raw, encoding="utf-8", newline="")
    reader = csv.reader(text)
    header = next(reader)
    if header != HEADER:
        text.close()
        z.close()
        raise RuntimeError(f"unexpected schema in {path}: {header}")
    return z, text, reader, names[0]


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--source", required=True, type=Path)
    ap.add_argument("--gap", required=True, type=Path)
    ap.add_argument("--out-dir", default=Path("output/merged"), type=Path)
    args = ap.parse_args()

    args.out_dir.mkdir(parents=True, exist_ok=True)
    out_csv = args.out_dir / "BTCUSD_1m_Binance_updated.csv"
    out_zip = args.out_dir / "BTCUSD_1m_Binance_updated.zip"
    manifest_path = args.out_dir / "BTCUSD_1m_Binance_updated_manifest.json"

    source_z, source_text, source_reader, _ = read_zip_csv(args.source)
    gap_z, gap_text, gap_reader, _ = read_zip_csv(args.gap)

    source_tail = deque(maxlen=12)
    source_rows = 0
    source_first = None
    source_last = None
    source_last_row = None
    combined_gaps = []
    prev_source_dt = None

    # Stream the source while withholding its final row. That allows us to replace
    # a provisional/in-progress terminal candle with Binance's finalized version.
    with out_csv.open("w", newline="", encoding="utf-8") as fh:
        writer = csv.writer(fh)
        writer.writerow(HEADER)

        pending = None
        for row in source_reader:
            if not row:
                continue
            dt = parse_open(row[0])
            if source_first is None:
                source_first = dt

            if prev_source_dt is not None:
                delta = int((dt - prev_source_dt).total_seconds())
                if delta != INTERVAL_SECONDS:
                    combined_gaps.append(
                        {
                            "section": "source",
                            "after": prev_source_dt.isoformat(),
                            "next": dt.isoformat(),
                            "missing_minutes": max(0, delta // 60 - 1),
                        }
                    )

            if pending is not None:
                writer.writerow(pending)

            pending = row
            source_tail.append(row)
            source_rows += 1
            source_last = dt
            source_last_row = row
            prev_source_dt = dt

        if source_last is None or source_last_row is None or pending is None:
            raise RuntimeError("source ZIP contains no candles")

        source_by_time = {row[0]: row for row in source_tail}
        exact_overlap_verified = 0
        terminal_overlap_verified = False
        terminal_replaced = False
        terminal_row_written = False
        appended = 0
        first_appended = None
        last_appended = None
        prev_out_dt = source_last

        for row in gap_reader:
            if not row:
                continue
            dt = parse_open(row[0])

            if dt < source_last:
                src = source_by_time.get(row[0])
                if src is None:
                    continue
                if comparable(src) != comparable(row):
                    raise RuntimeError(
                        "historical overlap mismatch at "
                        f"{row[0]}\nsource={src}\ngap={row}"
                    )
                exact_overlap_verified += 1
                continue

            if dt == source_last:
                terminal_overlap_verified = True
                if comparable(source_last_row) == comparable(row):
                    writer.writerow(row)
                elif finalized_extension(source_last_row, row):
                    # Replace the source's in-progress terminal snapshot with the
                    # authoritative finalized Binance candle.
                    writer.writerow(row)
                    terminal_replaced = True
                else:
                    raise RuntimeError(
                        "terminal source candle is not a valid provisional prefix of "
                        f"the finalized Binance candle at {row[0]}\n"
                        f"source={source_last_row}\nfinal={row}"
                    )
                terminal_row_written = True
                continue

            if dt > source_last:
                if not terminal_row_written:
                    raise RuntimeError(
                        "gap dataset did not include the source terminal candle needed "
                        "for finalization/verification"
                    )

                delta = int((dt - prev_out_dt).total_seconds())
                if delta != INTERVAL_SECONDS:
                    combined_gaps.append(
                        {
                            "section": "join_or_gap",
                            "after": prev_out_dt.isoformat(),
                            "next": dt.isoformat(),
                            "missing_minutes": max(0, delta // 60 - 1),
                        }
                    )

                writer.writerow(row)
                appended += 1
                first_appended = first_appended or dt
                last_appended = dt
                prev_out_dt = dt

    source_text.close()
    source_z.close()
    gap_text.close()
    gap_z.close()

    if exact_overlap_verified < 2:
        raise RuntimeError(
            f"expected at least 2 exact historical overlap candles, got "
            f"{exact_overlap_verified}"
        )
    if not terminal_overlap_verified:
        raise RuntimeError("source terminal candle was not present in gap dataset")
    if appended <= 0:
        raise RuntimeError("gap dataset contained no candles newer than source")

    with zipfile.ZipFile(out_zip, "w", zipfile.ZIP_DEFLATED, compresslevel=6) as z:
        z.write(out_csv, arcname=out_csv.name)

    manifest = {
        "source_zip": str(args.source),
        "gap_zip": str(args.gap),
        "source_rows": source_rows,
        "source_first_utc": source_first.isoformat() if source_first else None,
        "source_last_utc": source_last.isoformat() if source_last else None,
        "exact_overlap_candles_verified": exact_overlap_verified,
        "terminal_candle_verified": terminal_overlap_verified,
        "terminal_candle_replaced_with_finalized_binance": terminal_replaced,
        "appended_rows": appended,
        "first_appended_utc": first_appended.isoformat() if first_appended else None,
        "last_appended_utc": last_appended.isoformat() if last_appended else None,
        "combined_gap_count": len(combined_gaps),
        "combined_gaps": combined_gaps,
        "combined_rows": source_rows + appended,
        "csv_sha256": hashlib.sha256(out_csv.read_bytes()).hexdigest(),
        "zip_sha256": hashlib.sha256(out_zip.read_bytes()).hexdigest(),
    }
    manifest_path.write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    print(json.dumps(manifest, indent=2))


if __name__ == "__main__":
    main()
