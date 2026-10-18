from __future__ import annotations

import json
from collections import deque
from .db import connect,initialize,set_meta
from .patterns import candle_pattern,elliott_candidates,harmonic_candidates,structure_state

FEATURE_UPSERT='''INSERT INTO ta_features_1m(
open_time_ms,ema20,ema50,ema200,rsi14,atr14,macd,macd_signal,macd_hist,
bb_mid,bb_upper,bb_lower,bb_width,roc12,volume_ratio20,trend_score,momentum_score,
structure_score,regime,candle_pattern,structure_state,swing_high,swing_low,feature_json)
VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
ON CONFLICT(open_time_ms) DO UPDATE SET
ema20=excluded.ema20,ema50=excluded.ema50,ema200=excluded.ema200,rsi14=excluded.rsi14,
atr14=excluded.atr14,macd=excluded.macd,macd_signal=excluded.macd_signal,macd_hist=excluded.macd_hist,
bb_mid=excluded.bb_mid,bb_upper=excluded.bb_upper,bb_lower=excluded.bb_lower,bb_width=excluded.bb_width,
roc12=excluded.roc12,volume_ratio20=excluded.volume_ratio20,trend_score=excluded.trend_score,
momentum_score=excluded.momentum_score,structure_score=excluded.structure_score,regime=excluded.regime,
candle_pattern=excluded.candle_pattern,structure_state=excluded.structure_state,swing_high=excluded.swing_high,
swing_low=excluded.swing_low,feature_json=excluded.feature_json'''

def ema(prev,x,n):return x if prev is None else (2/(n+1))*x+(1-2/(n+1))*prev

def build_features(db_path,start_ms=None,batch_size=10_000,rebuild=False):
    initialize(db_path)
    with connect(db_path) as con:
        if rebuild:con.execute('DELETE FROM ta_features_1m');con.execute('DELETE FROM pattern_events');con.commit()
        if start_ms is None and not rebuild:
            r=con.execute('SELECT MAX(open_time_ms) m FROM ta_features_1m').fetchone();start_ms=r['m']
        warm_start=0 if start_ms is None else max(0,int(start_ms)-240*60_000)
        rows=con.execute('SELECT * FROM candles_1m WHERE open_time_ms>=? ORDER BY open_time_ms',(warm_start,))
        closes=deque(maxlen=250);vols=deque(maxlen=30);trs=deque(maxlen=20);candles=deque(maxlen=9);pivots=deque(maxlen=24);highs=deque(maxlen=8);lows=deque(maxlen=8)
        e20=e50=e200=macd_fast=macd_slow=macd_sig=None;gains=deque(maxlen=14);losses=deque(maxlen=14);prev_close=None;feat_batch=[];event_batch=[];processed=0;emitted=0
        for row in rows:
            t=int(row['open_time_ms']);c=float(row['close']);h=float(row['high']);l=float(row['low']);v=float(row['volume'])
            e20=ema(e20,c,20);e50=ema(e50,c,50);e200=ema(e200,c,200);macd_fast=ema(macd_fast,c,12);macd_slow=ema(macd_slow,c,26);macd=macd_fast-macd_slow;macd_sig=ema(macd_sig,macd,9);mh=macd-macd_sig
            if prev_close is not None:
                d=c-prev_close;gains.append(max(d,0));losses.append(max(-d,0));trs.append(max(h-l,abs(h-prev_close),abs(l-prev_close)))
            else:trs.append(h-l)
            rsi=None
            if len(gains)==14:
                ag=sum(gains)/14;al=sum(losses)/14;rsi=100 if al==0 else 100-100/(1+ag/al)
            atr=sum(trs)/len(trs) if len(trs)>=14 else None
            closes.append(c);vols.append(v);candles.append(dict(row))
            bb_mid=bb_upper=bb_lower=bb_width=None
            if len(closes)>=20:
                arr=list(closes)[-20:];bb_mid=sum(arr)/20;sd=(sum((x-bb_mid)**2 for x in arr)/20)**.5;bb_upper=bb_mid+2*sd;bb_lower=bb_mid-2*sd;bb_width=(bb_upper-bb_lower)/bb_mid*100 if bb_mid else None
            roc12=(c/list(closes)[-13]-1)*100 if len(closes)>=13 and list(closes)[-13] else None
            vr=sum(list(vols)[-20:])/20 if len(vols)>=20 else None;vr=v/vr if vr else None
            trend=(30 if c>e20 else -30)+(30 if e20>e50 else -30)+(40 if e50>e200 else -40)
            momentum=0.0
            if rsi is not None:momentum+=max(-50,min(50,(rsi-50)*1.4))
            momentum+=30 if mh>0 else -30
            if roc12 is not None:momentum+=max(-20,min(20,roc12*8))
            structure=0.0
            if len(candles)>=9:
                recent=list(candles);rh=max(float(x['high']) for x in recent[:-1]);rl=min(float(x['low']) for x in recent[:-1])
                if c>rh:structure=75
                elif c<rl:structure=-75
                else:structure=max(-50,min(50,((c-rl)/max(rh-rl,1e-12)-.5)*100))
            atrp=(atr/c*100) if atr and c else 0;regime='MIXED'
            if abs(trend)>=65 and abs(momentum)>=20 and trend*momentum>0:regime='TREND_UP' if trend>0 else 'TREND_DOWN'
            elif bb_width is not None and bb_width<.5:regime='SQUEEZE'
            elif atrp>1.2:regime='HIGH_VOLATILITY'
            elif abs(trend)<35 and abs(momentum)<30:regime='RANGE'
            pat='';pdir=0;pconf=0
            if len(candles)>=2:pat,pdir,pconf=candle_pattern(candles[-2],candles[-1])
            swing_hi=swing_lo=None
            if len(candles)>=7:
                mid=list(candles)[-4];hs7=[float(x['high']) for x in candles];ls7=[float(x['low']) for x in candles]
                if float(mid['high'])==max(hs7):swing_hi=float(mid['high']);pivots.append((int(mid['open_time_ms']),swing_hi,'H'));highs.append((int(mid['open_time_ms']),swing_hi))
                if float(mid['low'])==min(ls7):swing_lo=float(mid['low']);pivots.append((int(mid['open_time_ms']),swing_lo,'L'));lows.append((int(mid['open_time_ms']),swing_lo))
            st=structure_state(list(highs),list(lows));details={'atr_pct':atrp,'volume_ratio20':vr,'pattern_direction':pdir,'pattern_confidence':pconf}
            if t>=(start_ms or 0):
                feat_batch.append((t,e20,e50,e200,rsi,atr,macd,macd_sig,mh,bb_mid,bb_upper,bb_lower,bb_width,roc12,vr,trend,momentum,structure,regime,pat,st,swing_hi,swing_lo,json.dumps(details,separators=(',',':'))))
                if pat:event_batch.append((t,'1m','candlestick',pat,pdir,pconf,None,None,json.dumps(details,separators=(',',':'))))
                for x in harmonic_candidates(list(pivots)):event_batch.append((t,'1m','harmonic',x['pattern'],x['direction'],x['confidence'],None,None,json.dumps(x,separators=(',',':'),sort_keys=True)))
                for x in elliott_candidates(list(pivots)):event_batch.append((t,'1m','elliott',x['pattern'],x['direction'],x['confidence'],None,None,json.dumps(x,separators=(',',':'),sort_keys=True)))
                emitted+=1
            prev_close=c;processed+=1
            if len(feat_batch)>=batch_size:
                con.executemany(FEATURE_UPSERT,feat_batch);feat_batch.clear()
                if event_batch:con.executemany('INSERT OR IGNORE INTO pattern_events(open_time_ms,timeframe,family,pattern,direction,confidence,invalidation,target,details_json) VALUES(?,?,?,?,?,?,?,?,?)',event_batch);event_batch.clear()
                con.commit()
        if feat_batch:con.executemany(FEATURE_UPSERT,feat_batch)
        if event_batch:con.executemany('INSERT OR IGNORE INTO pattern_events(open_time_ms,timeframe,family,pattern,direction,confidence,invalidation,target,details_json) VALUES(?,?,?,?,?,?,?,?,?)',event_batch)
        set_meta(con,'features_last_built_ms',con.execute('SELECT MAX(open_time_ms) m FROM ta_features_1m').fetchone()['m']);con.commit()
    return {'candles_scanned':processed,'features_written':emitted}
