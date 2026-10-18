from __future__ import annotations
import csv,zipfile
from datetime import datetime,timezone,timedelta
from pathlib import Path
from btc_bot.ingest import bootstrap_zip,ingest_klines,verify_continuity
from btc_bot.features import build_features
from btc_bot.db import connect
from btc_bot.risk import RiskGovernor,RiskPolicy,PortfolioState
from btc_bot.learning import StrategySpec,mutate

HEADER=['Open time','Open','High','Low','Close','Volume','Close time','Quote asset volume','Number of trades','Taker buy base asset volume','Taker buy quote asset volume','Ignore']

def make_zip(p:Path,n=400):
    csvp=p.with_suffix('.csv');t=datetime(2025,1,1,tzinfo=timezone.utc);price=100000
    with csvp.open('w',newline='') as f:
        w=csv.writer(f);w.writerow(HEADER)
        for i in range(n):
            o=price;c=o+(8 if (i//60)%2==0 else -5)+(i%7-3);h=max(o,c)+10;l=min(o,c)-10;v=10+i%9;ot=t+timedelta(minutes=i);ct=ot+timedelta(seconds=59,milliseconds=999)
            w.writerow([ot.strftime('%Y-%m-%d %H:%M:%S'),o,h,l,c,v,ct.strftime('%Y-%m-%d %H:%M:%S.%f')[:-3],v*c,100+i%10,v*.55,v*.55*c,0]);price=c
    with zipfile.ZipFile(p,'w',zipfile.ZIP_DEFLATED) as z:z.write(csvp,csvp.name)

def test_pipeline(tmp_path):
    z=tmp_path/'h.zip';db=tmp_path/'h.sqlite';make_zip(z);x=bootstrap_zip(db,z);assert x['rows_db']==400;assert not verify_continuity(db);y=build_features(db,rebuild=True);assert y['features_written']>=390
    with connect(db) as con:
        assert con.execute('select count(*) from ta_features_1m').fetchone()[0]>=390
        assert con.execute('select count(*) from pattern_events').fetchone()[0]>0

def test_gap_and_risk(tmp_path):
    z=tmp_path/'h.zip';db=tmp_path/'h.sqlite';make_zip(z,30);bootstrap_zip(db,z)
    with connect(db) as con:last=con.execute('select max(open_time_ms) from candles_1m').fetchone()[0]
    row=[last+60000,'100','101','99','100.5','2',last+119999,'200',10,'1','100','0'];ingest_klines(db,[row]);assert not verify_continuity(db)
    g=RiskGovernor(RiskPolicy());s=PortfolioState(1000,1000,1000);p=g.plan(s,100,99,1,1,.8,'TREND_UP');assert p.allowed and p.risk_usd<=5;s.consecutive_losses=6;assert not g.plan(s,100,99,1,1,.8,'TREND_UP').allowed

def test_mutation_is_bounded():
    xs=mutate(StrategySpec(),42,20);assert len(xs)==20
    assert all(.8<=x.target_r<=4 and .5<=x.stop_atr<=2.5 for x in xs)

def test_mtf(tmp_path):
    from btc_bot.mtf import rebuild_mtf,build_mtf_features,context_at
    z=tmp_path/'h.zip';db=tmp_path/'h.sqlite';make_zip(z,400);bootstrap_zip(db,z);a=rebuild_mtf(db,timeframes=('5m','15m'));b=build_mtf_features(db,timeframes=('5m','15m'));assert a['rows_written']>0 and b['rows_written']>0
    with connect(db) as con:t=con.execute('select max(open_time_ms) from candles_1m').fetchone()[0]
    assert context_at(db,t,('5m','15m'))['5m'] is not None
