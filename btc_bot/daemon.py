from __future__ import annotations
import time
from datetime import datetime,timezone
from .binance import sync_to_latest
from .features import build_features

def run_history_daemon(db_path,poll_seconds=20,on_event=print):
    """Keep the historical tape and derived 1m features current while the bot runs."""
    while True:
        try:
            s=sync_to_latest(db_path);f=build_features(db_path);on_event({'time':datetime.now(timezone.utc).isoformat(),'sync':s,'features':f})
        except KeyboardInterrupt:raise
        except Exception as exc:on_event({'time':datetime.now(timezone.utc).isoformat(),'error':str(exc)})
        time.sleep(max(5,poll_seconds))
