from __future__ import annotations

import hashlib,json,random
from dataclasses import dataclass,asdict
from .db import connect,initialize

@dataclass(frozen=True)
class StrategySpec:
    trend_min:float=55
    momentum_min:float=20
    min_volume_ratio:float=.75
    rsi_long_min:float=48
    rsi_long_max:float=75
    rsi_short_min:float=25
    rsi_short_max:float=52
    target_r:float=1.8
    stop_atr:float=1.0
    allow_range:bool=False
    require_candle_confirmation:bool=False
    def signal(self,f):
        regime=str(f['regime'] or '')
        if not self.allow_range and regime=='RANGE':return 0
        vr=f['volume_ratio20']
        if vr is not None and float(vr)<self.min_volume_ratio:return 0
        t=float(f['trend_score'] or 0);m=float(f['momentum_score'] or 0);r=f['rsi14'];pat=str(f['candle_pattern'] or '')
        if r is None:return 0
        if t>=self.trend_min and m>=self.momentum_min and self.rsi_long_min<=r<=self.rsi_long_max:
            if self.require_candle_confirmation and pat not in {'bullish_engulfing','hammer','outside_bar'}:return 0
            return 1
        if t<=-self.trend_min and m<=-self.momentum_min and self.rsi_short_min<=r<=self.rsi_short_max:
            if self.require_candle_confirmation and pat not in {'bearish_engulfing','shooting_star','outside_bar'}:return 0
            return -1
        return 0

def mutate(parent:StrategySpec,seed:int,count=12):
    rnd=random.Random(seed);out=[];base=asdict(parent)
    for _ in range(count):
        x=dict(base);x['trend_min']=max(25,min(85,x['trend_min']+rnd.uniform(-12,12)));x['momentum_min']=max(5,min(60,x['momentum_min']+rnd.uniform(-10,10)));x['min_volume_ratio']=max(.2,min(2.5,x['min_volume_ratio']*rnd.uniform(.75,1.3)));x['target_r']=max(.8,min(4,x['target_r']+rnd.uniform(-.45,.45)));x['stop_atr']=max(.5,min(2.5,x['stop_atr']+rnd.uniform(-.3,.3)))
        if rnd.random()<.2:x['allow_range']=not x['allow_range']
        if rnd.random()<.2:x['require_candle_confirmation']=not x['require_candle_confirmation']
        out.append(StrategySpec(**x))
    return out

def load_feature_rows(db_path,start_ms=None,end_ms=None):
    q='''SELECT f.open_time_ms,f.rsi14,f.atr14,f.trend_score,f.momentum_score,f.regime,f.candle_pattern,f.volume_ratio20,c.high,c.low,c.close FROM ta_features_1m f JOIN candles_1m c USING(open_time_ms)''';args=[];w=[]
    if start_ms is not None:w.append('f.open_time_ms>=?');args.append(int(start_ms))
    if end_ms is not None:w.append('f.open_time_ms<=?');args.append(int(end_ms))
    if w:q+=' WHERE '+' AND '.join(w)
    q+=' ORDER BY f.open_time_ms'
    with connect(db_path) as con:return [dict(r) for r in con.execute(q,args)]

def backtest_rows(rows,spec:StrategySpec,fee_bps=4.0,slippage_bps=1.0):
    trades=[];pos=None;cost=(fee_bps+slippage_bps)/10000
    for r in rows:
        if pos is not None:
            side=pos['side'];hi=float(r['high']);lo=float(r['low']);stop=pos['stop'];target=pos['target'];stop_hit=lo<=stop if side>0 else hi>=stop;target_hit=hi>=target if side>0 else lo<=target
            if stop_hit or target_hit:
                exitp=stop if stop_hit else target;rr=side*(exitp-pos['entry'])/pos['risk'];rr-=cost*pos['entry']/pos['risk']*2;trades.append(rr);pos=None
            continue
        side=spec.signal(r)
        if not side:continue
        atr=float(r['atr14'] or 0)
        if atr<=0:continue
        entry=float(r['close']);risk=spec.stop_atr*atr;pos={'side':side,'entry':entry,'risk':risk,'stop':entry-side*risk,'target':entry+side*spec.target_r*risk}
    wins=[x for x in trades if x>0];losses=[x for x in trades if x<0];gp=sum(wins);gl=-sum(losses);eq=peak=dd=0.0
    for x in trades:eq+=x;peak=max(peak,eq);dd=max(dd,peak-eq)
    exp=sum(trades)/len(trades) if trades else -999;pf=gp/gl if gl>0 else (999 if gp>0 else 0)
    return {'trades':len(trades),'wins':len(wins),'losses':len(losses),'net_r':sum(trades),'expectancy_r':exp,'profit_factor':pf,'max_drawdown_r':dd,'fees_r':0.0}

def score_metrics(m,min_trades=40):
    if m['trades']<min_trades:return -1e9
    return m['expectancy_r']*2+min(5,m['profit_factor'])*.25-m['max_drawdown_r']*.05

def walk_forward_rows(rows,spec,windows=4,min_trades=40):
    if not rows:return -1e9,[]
    n=len(rows);metrics=[]
    for i in range(windows):
        a=i*n//windows;b=(i+1)*n//windows;metrics.append(backtest_rows(rows[a:b],spec))
    if sum(x['trades'] for x in metrics)<min_trades:return -1e9,metrics
    valid=[x for x in metrics if x['trades']>0];negative=sum(1 for x in valid if x['expectancy_r']<=0);worst=max((x['max_drawdown_r'] for x in valid),default=999)
    return sum(x['expectancy_r'] for x in valid)/max(1,len(valid))*2+sum(min(5,x['profit_factor']) for x in valid)/max(1,len(valid))*.25-worst*.05-negative*.75,metrics

def failure_tags(m):
    tags=[]
    if m['trades']<40:tags.append('insufficient_sample')
    if m['expectancy_r']<=0:tags.append('negative_expectancy')
    if m['profit_factor']<1:tags.append('profit_factor_below_one')
    if m['max_drawdown_r']>12:tags.append('excessive_drawdown')
    return tags

def record_knowledge(db_path,kind,statement,conditions,source,evidence=1,contradictions=0):
    initialize(db_path);key=hashlib.sha256((kind+'|'+statement+'|'+json.dumps(conditions,sort_keys=True)).encode()).hexdigest()
    with connect(db_path) as con:
        row=con.execute('SELECT * FROM knowledge_items WHERE knowledge_key=?',(key,)).fetchone()
        if row:
            ev=int(row['evidence_count'])+evidence;co=int(row['contradiction_count'])+contradictions;conf=(ev+1)/(ev+co+2);con.execute('UPDATE knowledge_items SET evidence_count=?,contradiction_count=?,confidence=?,updated_at=CURRENT_TIMESTAMP WHERE knowledge_key=?',(ev,co,conf,key))
        else:
            conf=(evidence+1)/(evidence+contradictions+2);con.execute('INSERT INTO knowledge_items(knowledge_key,kind,statement,conditions_json,evidence_count,contradiction_count,confidence,source) VALUES(?,?,?,?,?,?,?,?)',(key,kind,statement,json.dumps(conditions,sort_keys=True),evidence,contradictions,conf,source))
        con.commit()
    return key

def learn_from_trade(db_path,strategy_version_id,signal_time_ms,side,entry,exit_price,initial_stop,initial_target,realized_r,mfe_r,mae_r,exit_reason,market_state):
    tags=[];regime=str(market_state.get('regime',''));vr=market_state.get('volume_ratio20');trend=float(market_state.get('trend_score') or 0)
    if realized_r<0:
        if regime=='RANGE':tags.append('loss_in_range')
        if vr is not None and float(vr)<.7:tags.append('loss_low_volume')
        if side*trend<0:tags.append('loss_against_trend')
        if mae_r is not None and mae_r<=-1 and mfe_r is not None and mfe_r<.25:tags.append('immediate_adverse_move')
    lesson={'outcome':'win' if realized_r>0 else ('loss' if realized_r<0 else 'flat'),'tags':tags,'do_not_generalize_from_single_trade':True}
    with connect(db_path) as con:
        con.execute('''INSERT INTO trade_experiences(strategy_version_id,signal_time_ms,side,entry,exit,initial_stop,initial_target,realized_r,mfe_r,mae_r,exit_reason,market_state_json,mistake_tags_json,lesson_json) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)''',(strategy_version_id,signal_time_ms,side,entry,exit_price,initial_stop,initial_target,realized_r,mfe_r,mae_r,exit_reason,json.dumps(market_state,sort_keys=True),json.dumps(tags),json.dumps(lesson,sort_keys=True)));con.commit()
    for tag in tags:record_knowledge(db_path,'trade_mistake',f'{tag} has appeared in losing trades',{'tag':tag},'trade_experience',evidence=1)
    return lesson
