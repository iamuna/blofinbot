from __future__ import annotations

import json
import sqlite3
from pathlib import Path

SCHEMA_VERSION = 1

SCHEMA = r'''
PRAGMA journal_mode=WAL;
PRAGMA synchronous=NORMAL;
PRAGMA temp_store=MEMORY;
PRAGMA foreign_keys=ON;

CREATE TABLE IF NOT EXISTS meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS candles_1m (
    open_time_ms INTEGER PRIMARY KEY,
    open REAL NOT NULL,
    high REAL NOT NULL,
    low REAL NOT NULL,
    close REAL NOT NULL,
    volume REAL NOT NULL,
    close_time_ms INTEGER NOT NULL,
    quote_volume REAL NOT NULL,
    trades INTEGER NOT NULL,
    taker_buy_base REAL NOT NULL,
    taker_buy_quote REAL NOT NULL,
    source TEXT NOT NULL,
    is_final INTEGER NOT NULL DEFAULT 1,
    ingested_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_candles_close_time ON candles_1m(close_time_ms);

CREATE TABLE IF NOT EXISTS candles_mtf (
    timeframe TEXT NOT NULL,
    open_time_ms INTEGER NOT NULL,
    open REAL NOT NULL,
    high REAL NOT NULL,
    low REAL NOT NULL,
    close REAL NOT NULL,
    volume REAL NOT NULL,
    quote_volume REAL NOT NULL,
    trades INTEGER NOT NULL,
    closed INTEGER NOT NULL DEFAULT 1,
    PRIMARY KEY(timeframe,open_time_ms)
);
CREATE INDEX IF NOT EXISTS idx_candles_mtf_time ON candles_mtf(timeframe,open_time_ms);

CREATE TABLE IF NOT EXISTS ta_features_mtf (
    timeframe TEXT NOT NULL,
    open_time_ms INTEGER NOT NULL,
    ema20 REAL, ema50 REAL, ema200 REAL,
    rsi14 REAL, atr14 REAL,
    trend_score REAL,
    regime TEXT,
    PRIMARY KEY(timeframe,open_time_ms),
    FOREIGN KEY(timeframe,open_time_ms) REFERENCES candles_mtf(timeframe,open_time_ms) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS ta_features_1m (
    open_time_ms INTEGER PRIMARY KEY REFERENCES candles_1m(open_time_ms) ON DELETE CASCADE,
    ema20 REAL, ema50 REAL, ema200 REAL,
    rsi14 REAL, atr14 REAL,
    macd REAL, macd_signal REAL, macd_hist REAL,
    bb_mid REAL, bb_upper REAL, bb_lower REAL, bb_width REAL,
    roc12 REAL, volume_ratio20 REAL,
    trend_score REAL, momentum_score REAL, structure_score REAL,
    regime TEXT,
    candle_pattern TEXT,
    structure_state TEXT,
    swing_high REAL, swing_low REAL,
    feature_json TEXT NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS pattern_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    open_time_ms INTEGER NOT NULL REFERENCES candles_1m(open_time_ms) ON DELETE CASCADE,
    timeframe TEXT NOT NULL DEFAULT '1m',
    family TEXT NOT NULL,
    pattern TEXT NOT NULL,
    direction INTEGER NOT NULL DEFAULT 0,
    confidence REAL NOT NULL DEFAULT 0,
    invalidation REAL,
    target REAL,
    details_json TEXT NOT NULL DEFAULT '{}',
    UNIQUE(open_time_ms,timeframe,family,pattern,details_json)
);
CREATE INDEX IF NOT EXISTS idx_pattern_events_time ON pattern_events(open_time_ms);
CREATE INDEX IF NOT EXISTS idx_pattern_events_family ON pattern_events(family,pattern);

CREATE TABLE IF NOT EXISTS outcome_labels (
    open_time_ms INTEGER PRIMARY KEY REFERENCES candles_1m(open_time_ms) ON DELETE CASCADE,
    ret_1m REAL, ret_3m REAL, ret_5m REAL, ret_10m REAL, ret_15m REAL,
    ret_30m REAL, ret_60m REAL, ret_240m REAL,
    mfe_5m REAL, mae_5m REAL, mfe_15m REAL, mae_15m REAL,
    mfe_60m REAL, mae_60m REAL
);

CREATE TABLE IF NOT EXISTS strategy_versions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    strategy_name TEXT NOT NULL,
    version INTEGER NOT NULL,
    parent_id INTEGER REFERENCES strategy_versions(id),
    status TEXT NOT NULL DEFAULT 'challenger',
    parameters_json TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    retired_at TEXT,
    UNIQUE(strategy_name,version)
);

CREATE TABLE IF NOT EXISTS strategy_trials (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    strategy_version_id INTEGER NOT NULL REFERENCES strategy_versions(id),
    dataset_start_ms INTEGER NOT NULL,
    dataset_end_ms INTEGER NOT NULL,
    phase TEXT NOT NULL,
    trades INTEGER NOT NULL,
    wins INTEGER NOT NULL,
    losses INTEGER NOT NULL,
    net_r REAL NOT NULL,
    expectancy_r REAL NOT NULL,
    profit_factor REAL,
    max_drawdown_r REAL NOT NULL,
    sharpe_like REAL,
    fees_r REAL NOT NULL DEFAULT 0,
    metrics_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_strategy_trials_version ON strategy_trials(strategy_version_id,phase);

CREATE TABLE IF NOT EXISTS trade_experiences (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    strategy_version_id INTEGER REFERENCES strategy_versions(id),
    signal_time_ms INTEGER NOT NULL,
    side INTEGER NOT NULL,
    entry REAL NOT NULL,
    exit REAL,
    initial_stop REAL NOT NULL,
    initial_target REAL,
    realized_r REAL,
    mfe_r REAL,
    mae_r REAL,
    exit_reason TEXT,
    market_state_json TEXT NOT NULL DEFAULT '{}',
    mistake_tags_json TEXT NOT NULL DEFAULT '[]',
    lesson_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS knowledge_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    knowledge_key TEXT NOT NULL UNIQUE,
    kind TEXT NOT NULL,
    statement TEXT NOT NULL,
    conditions_json TEXT NOT NULL DEFAULT '{}',
    evidence_count INTEGER NOT NULL DEFAULT 0,
    contradiction_count INTEGER NOT NULL DEFAULT 0,
    confidence REAL NOT NULL DEFAULT 0.5,
    source TEXT NOT NULL,
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS learning_cycles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    completed_at TEXT,
    champion_before INTEGER REFERENCES strategy_versions(id),
    champion_after INTEGER REFERENCES strategy_versions(id),
    challengers_tested INTEGER NOT NULL DEFAULT 0,
    promoted INTEGER NOT NULL DEFAULT 0,
    summary_json TEXT NOT NULL DEFAULT '{}'
);
'''

def connect(path: str | Path) -> sqlite3.Connection:
    p=Path(path);p.parent.mkdir(parents=True,exist_ok=True)
    con=sqlite3.connect(str(p),timeout=60);con.row_factory=sqlite3.Row
    con.execute('PRAGMA busy_timeout=60000')
    return con

def initialize(path: str | Path) -> None:
    with connect(path) as con:
        con.executescript(SCHEMA)
        con.execute('INSERT INTO meta(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value',('schema_version',str(SCHEMA_VERSION)))
        con.commit()

def set_meta(con: sqlite3.Connection,key: str,value) -> None:
    if not isinstance(value,str):value=json.dumps(value,separators=(',',':'),sort_keys=True)
    con.execute('INSERT INTO meta(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value',(key,value))

def get_meta(con: sqlite3.Connection,key: str,default=None):
    row=con.execute('SELECT value FROM meta WHERE key=?',(key,)).fetchone()
    return default if row is None else row['value']

def candle_bounds(con: sqlite3.Connection):
    row=con.execute('SELECT COUNT(*) n,MIN(open_time_ms) lo,MAX(open_time_ms) hi FROM candles_1m').fetchone()
    return int(row['n']),row['lo'],row['hi']
