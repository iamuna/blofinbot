from __future__ import annotations
from collections import deque
from .db import connect,initialize,set_meta

TF_MINUTES={'3m':3,'5m':5,'15m':15,'30m':30,'1h':60,'4h':240,'1d':1440}

def rebuild_mtf(db_path,timeframes=None,batch_size=10000):
    initialize(db_path);tfs=timeframes or tuple(TF_MINUTES);sizes={tf:TF_MINUTES[tf]*60_000 for tf in tfs};state={tf:None for tf in tfs};out=[];written=0
    def flush_bucket(tf,b):
        nonlocal written
        if b is None:return
        out.append((tf,b['t'],b['o'],b['h'],b['l'],b['c'],b['v'],b['qv'],b['trades'],1));written+=1
    with connect(db_path) as con:
        for tf in tfs:con.execute('DELETE FROM candles_mtf WHERE timeframe=?',(tf,))
        rows=con.execute('SELECT open_time_ms,open,high,low,close,volume,quote_volume,trades FROM candles_1m ORDER BY open_time_ms')
        for r in rows:
            t=int(r['open_time_ms'])
            for tf,size in sizes.items():
                bt=(t//size)*size;b=state[tf]
                if b is None or b['t']!=bt:
                    flush_bucket(tf,b);state[tf]={'t':bt,'o':float(r['open']),'h':float(r['high']),'l':float(r['low']),'c':float(r['close']),'v':float(r['volume']),'qv':float(r['quote_volume']),'trades':int(r['trades'])}
                else:
                    b['h']=max(b['h'],float(r['high']));b['l']=min(b['l'],float(r['low']));b['c']=float(r['close']);b['v']+=float(r['volume']);b['qv']+=float(r['quote_volume']);b['trades']+=int(r['trades'])
            if len(out)>=batch_size:con.executemany('INSERT OR REPLACE INTO candles_mtf VALUES(?,?,?,?,?,?,?,?,?,?)',out);con.commit();out.clear()
        for tf,b in state.items():flush_bucket(tf,b)
        if out:con.executemany('INSERT OR REPLACE INTO candles_mtf VALUES(?,?,?,?,?,?,?,?,?,?)',out)
        set_meta(con,'mtf_timeframes',list(tfs));con.commit()
    return {'timeframes':list(tfs),'rows_written':written}

def build_mtf_features(db_path,timeframes=None,batch_size=10000):
    initialize(db_path);tfs=timeframes or tuple(TF_MINUTES);total=0
    with connect(db_path) as con:
        for tf in tfs:
            con.execute('DELETE FROM ta_features_mtf WHERE timeframe=?',(tf,));rows=con.execute('SELECT * FROM candles_mtf WHERE timeframe=? ORDER BY open_time_ms',(tf,))
            e20=e50=e200=None;prev=None;g=deque(maxlen=14);lo=deque(maxlen=14);trs=deque(maxlen=14);batch=[]
            for r in rows:
                c=float(r['close']);h=float(r['high']);l=float(r['low'])
                def E(old,n):return c if old is None else 2/(n+1)*c+(1-2/(n+1))*old
                e20=E(e20,20);e50=E(e50,50);e200=E(e200,200)
                if prev is not None:d=c-prev;g.append(max(d,0));lo.append(max(-d,0));trs.append(max(h-l,abs(h-prev),abs(l-prev)))
                else:trs.append(h-l)
                rsi=None
                if len(g)==14:ag=sum(g)/14;al=sum(lo)/14;rsi=100 if al==0 else 100-100/(1+ag/al)
                atr=sum(trs)/14 if len(trs)==14 else None;score=(30 if c>e20 else -30)+(30 if e20>e50 else -30)+(40 if e50>e200 else -40);regime='TREND_UP' if score>=65 else ('TREND_DOWN' if score<=-65 else 'MIXED')
                batch.append((tf,int(r['open_time_ms']),e20,e50,e200,rsi,atr,score,regime));total+=1;prev=c
                if len(batch)>=batch_size:con.executemany('INSERT OR REPLACE INTO ta_features_mtf VALUES(?,?,?,?,?,?,?,?,?)',batch);con.commit();batch.clear()
            if batch:con.executemany('INSERT OR REPLACE INTO ta_features_mtf VALUES(?,?,?,?,?,?,?,?,?)',batch);con.commit()
    return {'rows_written':total,'timeframes':list(tfs)}

def context_at(db_path,open_time_ms,timeframes=('5m','15m','1h','4h')):
    out={}
    with connect(db_path) as con:
        for tf in timeframes:
            r=con.execute('SELECT * FROM ta_features_mtf WHERE timeframe=? AND open_time_ms<=? ORDER BY open_time_ms DESC LIMIT 1',(tf,int(open_time_ms))).fetchone();out[tf]=dict(r) if r else None
    return out
