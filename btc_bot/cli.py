from __future__ import annotations
import argparse,json
from datetime import datetime,timezone
from .binance import repair_detected_gaps,sync_to_latest
from .db import candle_bounds,connect,initialize
from .engine import learning_cycle
from .features import build_features
from .ingest import bootstrap_zip,verify_continuity
from .mtf import build_mtf_features,rebuild_mtf
from .outcomes import build_outcomes

def iso(ms):return None if ms is None else datetime.fromtimestamp(ms/1000,tz=timezone.utc).isoformat()

def status(db):
    initialize(db)
    with connect(db) as con:
        n,lo,hi=candle_bounds(con);f=con.execute('SELECT COUNT(*) n,MIN(open_time_ms) lo,MAX(open_time_ms) hi FROM ta_features_1m').fetchone();k=con.execute('SELECT COUNT(*) n FROM knowledge_items WHERE active=1').fetchone()['n'];s=con.execute("SELECT id,version,parameters_json FROM strategy_versions WHERE status='champion' ORDER BY version DESC LIMIT 1").fetchone()
    return {'candles':n,'first':iso(lo),'last':iso(hi),'features':int(f['n']),'features_last':iso(f['hi']),'knowledge_items':int(k),'champion':dict(s) if s else None}

def main():
    ap=argparse.ArgumentParser(prog='btc-bot-data');ap.add_argument('--db',default='data/btc_history.sqlite');sub=ap.add_subparsers(dest='cmd',required=True)
    p=sub.add_parser('bootstrap');p.add_argument('zip')
    sub.add_parser('sync');sub.add_parser('repair-gaps')
    p=sub.add_parser('features');p.add_argument('--rebuild',action='store_true')
    p=sub.add_parser('outcomes');p.add_argument('--rebuild',action='store_true')
    sub.add_parser('mtf');sub.add_parser('verify');sub.add_parser('status')
    p=sub.add_parser('learn');p.add_argument('--seed',type=int,default=1);p.add_argument('--challengers',type=int,default=12)
    a=ap.parse_args()
    if a.cmd=='bootstrap':out=bootstrap_zip(a.db,a.zip)
    elif a.cmd=='sync':out=sync_to_latest(a.db)
    elif a.cmd=='repair-gaps':out=repair_detected_gaps(a.db)
    elif a.cmd=='features':out=build_features(a.db,rebuild=a.rebuild)
    elif a.cmd=='outcomes':out=build_outcomes(a.db,rebuild=a.rebuild)
    elif a.cmd=='mtf':out={'candles':rebuild_mtf(a.db),'features':build_mtf_features(a.db)}
    elif a.cmd=='verify':out={'gaps':verify_continuity(a.db)}
    elif a.cmd=='learn':out=learning_cycle(a.db,a.seed,a.challengers)
    else:out=status(a.db)
    print(json.dumps(out,indent=2,default=str))

if __name__=='__main__':main()
