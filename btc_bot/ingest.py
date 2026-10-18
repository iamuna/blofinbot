from __future__ import annotations

import csv,io,time,zipfile
from datetime import datetime,timezone
from pathlib import Path
from typing import Iterable
from .db import candle_bounds,connect,initialize,set_meta

HEADER=['Open time','Open','High','Low','Close','Volume','Close time','Quote asset volume','Number of trades','Taker buy base asset volume','Taker buy quote asset volume','Ignore']
UPSERT='''INSERT INTO candles_1m(open_time_ms,open,high,low,close,volume,close_time_ms,quote_volume,trades,taker_buy_base,taker_buy_quote,source,is_final)
VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)
ON CONFLICT(open_time_ms) DO UPDATE SET open=excluded.open,high=excluded.high,low=excluded.low,close=excluded.close,volume=excluded.volume,close_time_ms=excluded.close_time_ms,quote_volume=excluded.quote_volume,trades=excluded.trades,taker_buy_base=excluded.taker_buy_base,taker_buy_quote=excluded.taker_buy_quote,source=excluded.source,is_final=MAX(candles_1m.is_final,excluded.is_final)'''

def parse_time_ms(value)->int:
    s=str(value).strip()
    if not s:raise ValueError('empty timestamp')
    if s.isdigit():
        n=int(s)
        if n>10**15:return n//1000
        if n>10**12:return n
        return n*1000
    dt=datetime.fromisoformat(s.replace('Z','+00:00'))
    if dt.tzinfo is None:dt=dt.replace(tzinfo=timezone.utc)
    return int(dt.timestamp()*1000)

def row_to_candle(row,source:str,is_final:int=1):
    if len(row)<11:raise ValueError(f'bad kline row: {row!r}')
    return (parse_time_ms(row[0]),float(row[1]),float(row[2]),float(row[3]),float(row[4]),float(row[5]),parse_time_ms(row[6]),float(row[7]),int(float(row[8])),float(row[9]),float(row[10]),source,int(is_final))

def _open_csv_from_zip(path:Path):
    z=zipfile.ZipFile(path);names=[n for n in z.namelist() if n.lower().endswith('.csv')]
    if len(names)!=1:z.close();raise ValueError(f'{path} must contain exactly one CSV; found {names}')
    raw=z.open(names[0]);text=io.TextIOWrapper(raw,encoding='utf-8',newline='')
    return z,text,csv.reader(text),names[0]

def bootstrap_zip(db_path,zip_path,batch_size=20_000):
    initialize(db_path);z,text,reader,member=_open_csv_from_zip(Path(zip_path));first=next(reader,None)
    if first is None:raise ValueError('empty CSV')
    has_header=first[:5]==HEADER[:5];pending=None if has_header else first;count=0;started=time.time()
    with connect(db_path) as con:
        existing_hi=candle_bounds(con)[2];skipped_existing=0;batch=[]
        def add(row):
            nonlocal count,skipped_existing
            item=row_to_candle(row,'bootstrap_zip',1);count+=1
            if existing_hi is not None and item[0]<=existing_hi:skipped_existing+=1;return
            batch.append(item)
            if len(batch)>=batch_size:con.executemany(UPSERT,batch);con.commit();batch.clear()
        if pending is not None:add(pending)
        for row in reader:
            if row:add(row)
        if batch:con.executemany(UPSERT,batch);con.commit()
        n,lo,hi=candle_bounds(con);set_meta(con,'bootstrap_source',str(Path(zip_path).resolve()));set_meta(con,'bootstrap_member',member);set_meta(con,'bootstrap_rows_read',count);set_meta(con,'last_history_sync_ms',hi);con.commit()
    text.close();z.close()
    return {'rows_read':count,'rows_skipped_existing':skipped_existing,'rows_db':n,'first_ms':lo,'last_ms':hi,'seconds':round(time.time()-started,2)}

def ingest_klines(db_path,rows:Iterable,source='binance_api',final=True):
    initialize(db_path);items=[row_to_candle(r,source,int(final)) for r in rows]
    with connect(db_path) as con:
        con.executemany(UPSERT,items)
        if items:set_meta(con,'last_history_sync_ms',max(x[0] for x in items))
        con.commit()
    return len(items)

def verify_continuity(db_path,start_ms=None,end_ms=None,limit=1000):
    q='SELECT open_time_ms FROM candles_1m';args=[];where=[]
    if start_ms is not None:where.append('open_time_ms>=?');args.append(start_ms)
    if end_ms is not None:where.append('open_time_ms<=?');args.append(end_ms)
    if where:q+=' WHERE '+' AND '.join(where)
    q+=' ORDER BY open_time_ms';gaps=[];prev=None
    with connect(db_path) as con:
        for row in con.execute(q,args):
            t=int(row[0])
            if prev is not None and t!=prev+60_000:
                gaps.append({'after_ms':prev,'next_ms':t,'missing_minutes':max(0,(t-prev)//60_000-1)})
                if len(gaps)>=limit:break
            prev=t
    return gaps
