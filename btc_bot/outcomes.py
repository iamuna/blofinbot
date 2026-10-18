from __future__ import annotations
from collections import deque
from .db import connect,initialize,set_meta

H=(1,3,5,10,15,30,60,240)
UPSERT='''INSERT OR REPLACE INTO outcome_labels(open_time_ms,ret_1m,ret_3m,ret_5m,ret_10m,ret_15m,ret_30m,ret_60m,ret_240m,mfe_5m,mae_5m,mfe_15m,mae_15m,mfe_60m,mae_60m) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)'''

def build_outcomes(db_path,rebuild=False,batch_size=10000,start_ms=None):
    initialize(db_path)
    with connect(db_path) as con:
        if rebuild:con.execute('DELETE FROM outcome_labels');con.commit()
        if start_ms is None and not rebuild:
            r=con.execute('SELECT MAX(open_time_ms) m FROM outcome_labels').fetchone();last=r['m'];start_ms=max(0,int(last)-240*60_000) if last is not None else 0
        start_ms=int(start_ms or 0);cur=con.execute('SELECT open_time_ms,close,high,low FROM candles_1m WHERE open_time_ms>=? ORDER BY open_time_ms',(start_ms,));window=deque(maxlen=241);out=[];written=0;scanned=0
        for rr in cur:
            window.append((int(rr['open_time_ms']),float(rr['close']),float(rr['high']),float(rr['low'])));scanned+=1
            if len(window)<241:continue
            xs=list(window);t,base,_,_=xs[0]
            rets=[(xs[k][1]/base-1)*100 for k in H]
            def mm(k):
                seg=xs[1:k+1];return (max(x[2] for x in seg)/base-1)*100,(min(x[3] for x in seg)/base-1)*100
            m5,a5=mm(5);m15,a15=mm(15);m60,a60=mm(60);out.append((t,*rets,m5,a5,m15,a15,m60,a60));written+=1
            if len(out)>=batch_size:con.executemany(UPSERT,out);con.commit();out.clear()
        if out:con.executemany(UPSERT,out)
        last=con.execute('SELECT MAX(open_time_ms) m FROM outcome_labels').fetchone()['m'];set_meta(con,'outcomes_last_built_ms',last);con.commit()
    return {'candles_scanned':scanned,'labels_written':written,'last_labeled_ms':last}
