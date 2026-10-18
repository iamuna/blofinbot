from __future__ import annotations

import time
from datetime import datetime,timezone
from typing import Iterator
import requests
from .db import candle_bounds,connect,initialize,set_meta
from .ingest import UPSERT,row_to_candle

BASE_URLS=('https://data-api.binance.vision','https://api.binance.com','https://api-gcp.binance.com')
ONE_MINUTE=60_000

class BinancePublicClient:
    def __init__(self,session=None,timeout=20):
        self.session=session or requests.Session();self.timeout=timeout
        self.session.headers.update({'User-Agent':'btc-1m-history-engine/1.0'})
    def klines(self,start_ms:int,end_ms:int|None=None,limit=1000):
        params={'symbol':'BTCUSDT','interval':'1m','startTime':int(start_ms),'limit':min(1000,int(limit))}
        if end_ms is not None:params['endTime']=int(end_ms)
        errors=[]
        for base in BASE_URLS:
            try:
                r=self.session.get(base+'/api/v3/klines',params=params,timeout=self.timeout);r.raise_for_status();data=r.json()
                if isinstance(data,list):return data
                errors.append(f'{base}: non-list response')
            except Exception as exc:errors.append(f'{base}: {exc}')
        raise RuntimeError('all Binance endpoints failed: '+' | '.join(errors))
    def iter_closed(self,start_ms:int,end_ms:int|None=None)->Iterator[list]:
        if end_ms is None:
            now=int(datetime.now(timezone.utc).timestamp()*1000);end_ms=(now//ONE_MINUTE)*ONE_MINUTE-ONE_MINUTE
        cursor=int(start_ms)
        while cursor<=end_ms:
            batch=self.klines(cursor,end_ms,1000)
            if not batch:break
            advanced=False
            for row in batch:
                t=int(row[0])
                if t<cursor or t>end_ms:continue
                yield row;advanced=True
            if not advanced:break
            nxt=int(batch[-1][0])+ONE_MINUTE
            if nxt<=cursor:raise RuntimeError('Binance cursor failed to advance')
            cursor=nxt;time.sleep(.05)

def _is_final_extension(old,new)->bool:
    _,o,h,l,c,v,ct,qv,tr,tbb,tbq,_,_=new;eps=1e-9
    return (abs(float(old['open'])-o)<=eps and h+eps>=float(old['high']) and l-eps<=float(old['low']) and v+eps>=float(old['volume']) and qv+eps>=float(old['quote_volume']) and tr>=int(old['trades']) and tbb+eps>=float(old['taker_buy_base']) and tbq+eps>=float(old['taker_buy_quote']))

def sync_to_latest(db_path,client:BinancePublicClient|None=None,overlap_minutes=3,progress=None):
    initialize(db_path);client=client or BinancePublicClient()
    with connect(db_path) as con:n,lo,hi=candle_bounds(con)
    if not n:raise RuntimeError('bootstrap history before syncing')
    start=max(lo,hi-overlap_minutes*ONE_MINUTE);written=0;corrected_terminal=False;first_new=None;last_new=None
    with connect(db_path) as con:
        batch=[]
        for raw in client.iter_closed(start):
            item=row_to_candle(raw,'binance_api',1);t=item[0];existing=con.execute('SELECT * FROM candles_1m WHERE open_time_ms=?',(t,)).fetchone()
            if existing is not None:
                same=(abs(existing['open']-item[1])<1e-9 and abs(existing['high']-item[2])<1e-9 and abs(existing['low']-item[3])<1e-9 and abs(existing['close']-item[4])<1e-9 and abs(existing['volume']-item[5])<1e-9 and int(existing['trades'])==item[8])
                if not same:
                    if t==hi and _is_final_extension(existing,item):corrected_terminal=True
                    else:raise RuntimeError(f'history overlap mismatch at {t}')
            else:
                first_new=t if first_new is None else first_new;last_new=t
            batch.append(item);written+=1
            if len(batch)>=5000:
                con.executemany(UPSERT,batch);con.commit();batch.clear()
                if progress:progress(last_new or t,written)
        if batch:con.executemany(UPSERT,batch)
        _,_,new_hi=candle_bounds(con);set_meta(con,'last_history_sync_ms',new_hi);set_meta(con,'last_history_sync_utc',datetime.now(timezone.utc).isoformat());con.commit()
    return {'processed':written,'first_new_ms':first_new,'last_new_ms':last_new,'corrected_terminal':corrected_terminal,'last_db_ms':new_hi}

def repair_detected_gaps(db_path,client:BinancePublicClient|None=None,max_gap_minutes=10080,progress=None):
    from .ingest import verify_continuity
    client=client or BinancePublicClient();gaps=verify_continuity(db_path,limit=100000);filled=0;attempted=0
    with connect(db_path) as con:
        for g in gaps:
            start=int(g['after_ms'])+ONE_MINUTE;end=int(g['next_ms'])-ONE_MINUTE;attempted+=1;batch=[]
            for raw in client.iter_closed(start,end):
                batch.append(row_to_candle(raw,'binance_gap_repair',1))
                if len(batch)>=5000:con.executemany(UPSERT,batch);filled+=len(batch);con.commit();batch.clear()
            if batch:con.executemany(UPSERT,batch);filled+=len(batch);con.commit()
            if progress:progress(g,filled)
        con.commit()
    return {'gaps_attempted':attempted,'candles_filled':filled,'remaining_gaps':verify_continuity(db_path,limit=100000)}
