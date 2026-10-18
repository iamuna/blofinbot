from __future__ import annotations
import json
from dataclasses import asdict
from .db import connect,initialize
from .learning import StrategySpec,backtest_rows,failure_tags,load_feature_rows,mutate,record_knowledge,score_metrics,walk_forward_rows

def ensure_baseline(db_path):
    initialize(db_path)
    with connect(db_path) as con:
        row=con.execute("SELECT * FROM strategy_versions WHERE strategy_name='adaptive_scalp' AND status='champion' ORDER BY version DESC LIMIT 1").fetchone()
        if row:return int(row['id'])
        con.execute("INSERT INTO strategy_versions(strategy_name,version,status,parameters_json) VALUES('adaptive_scalp',1,'champion',?)",(json.dumps(asdict(StrategySpec()),sort_keys=True),));con.commit();return int(con.execute('SELECT last_insert_rowid()').fetchone()[0])

def _store_trial(con,vid,a,b,phase,m):
    con.execute('''INSERT INTO strategy_trials(strategy_version_id,dataset_start_ms,dataset_end_ms,phase,trades,wins,losses,net_r,expectancy_r,profit_factor,max_drawdown_r,fees_r,metrics_json) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)''',(vid,a,b,phase,m['trades'],m['wins'],m['losses'],m['net_r'],m['expectancy_r'],m['profit_factor'],m['max_drawdown_r'],m['fees_r'],json.dumps(m,sort_keys=True)))

def learning_cycle(db_path,seed=1,challengers=12,min_trades=40,lookback_days=180):
    champion_id=ensure_baseline(db_path)
    with connect(db_path) as con:
        ch=con.execute('SELECT * FROM strategy_versions WHERE id=?',(champion_id,)).fetchone();hi=con.execute('SELECT MAX(open_time_ms) m FROM ta_features_1m').fetchone()['m'];maxver=con.execute("SELECT COALESCE(MAX(version),0) v FROM strategy_versions WHERE strategy_name='adaptive_scalp'").fetchone()['v']
    if hi is None:raise RuntimeError('build features before learning')
    lo=max(0,int(hi)-int(lookback_days)*86_400_000);rows=load_feature_rows(db_path,lo,hi)
    if len(rows)<1000:raise RuntimeError('not enough feature history')
    n=len(rows);i60=int(n*.60);i80=int(n*.80);train=rows[:i60];val_rows=rows[i60:i80];test_rows=rows[i80:]
    parent=StrategySpec(**json.loads(ch['parameters_json']));parent_val=backtest_rows(val_rows,parent);parent_test=backtest_rows(test_rows,parent);parent_val_score=score_metrics(parent_val,min_trades);parent_test_score=score_metrics(parent_test,min_trades)
    candidate_rows=[]
    for spec in mutate(parent,seed,challengers):
        train_score,_=walk_forward_rows(train,spec,4,min_trades);val=backtest_rows(val_rows,spec);vs=score_metrics(val,min_trades);candidate_rows.append((train_score+vs,spec,train_score,val,vs))
    candidate_rows.sort(key=lambda x:x[0],reverse=True);promoted=False;new_id=champion_id;failure_notes=[]
    with connect(db_path) as con:
        persisted=[]
        for idx,(_,spec,train_score,val,vs) in enumerate(candidate_rows,start=1):
            ver=int(maxver)+idx;con.execute("INSERT INTO strategy_versions(strategy_name,version,parent_id,status,parameters_json) VALUES('adaptive_scalp',?,?, 'challenger',?)",(ver,champion_id,json.dumps(asdict(spec),sort_keys=True)));vid=int(con.execute('SELECT last_insert_rowid()').fetchone()[0]);persisted.append((vid,spec,val,vs));_store_trial(con,vid,int(val_rows[0]['open_time_ms']),int(val_rows[-1]['open_time_ms']),'validation',val)
        if persisted:
            best_vid,best_spec,best_val,best_val_score=persisted[0];best_test=backtest_rows(test_rows,best_spec);best_test_score=score_metrics(best_test,min_trades);_store_trial(con,best_vid,int(test_rows[0]['open_time_ms']),int(test_rows[-1]['open_time_ms']),'test',best_test)
            promote=(best_val['expectancy_r']>0 and best_test['expectancy_r']>0 and best_val['profit_factor']>1 and best_test['profit_factor']>1 and best_val_score>=parent_val_score+.10 and best_test_score>=parent_test_score+.10)
            if promote:
                con.execute("UPDATE strategy_versions SET status='retired',retired_at=CURRENT_TIMESTAMP WHERE id=?",(champion_id,));con.execute("UPDATE strategy_versions SET status='champion' WHERE id=?",(best_vid,));new_id=best_vid;promoted=True
            con.execute("UPDATE strategy_versions SET status='retired',retired_at=CURRENT_TIMESTAMP WHERE status='challenger' AND id<>?",(new_id,))
            for vid,spec,v,vs in persisted:
                if vid!=new_id:
                    tags=failure_tags(v)
                    if tags:failure_notes.append((vid,tags))
            summary={'lookback_days':lookback_days,'rows':n,'champion_validation':parent_val,'champion_test':parent_test,'best_validation':best_val,'best_test':best_test,'promoted':promoted}
        else:summary={'promoted':False,'reason':'no challengers'}
        con.execute('INSERT INTO learning_cycles(completed_at,champion_before,champion_after,challengers_tested,promoted,summary_json) VALUES(CURRENT_TIMESTAMP,?,?,?,?,?)',(champion_id,new_id,challengers,int(promoted),json.dumps(summary,sort_keys=True)));con.commit()
    for vid,tags in failure_notes:record_knowledge(db_path,'strategy_failure','A challenger failed promotion gates',{'strategy_version_id':vid,'tags':tags},'learning_cycle',evidence=1)
    return {'promoted':promoted,'champion_before':champion_id,'champion_after':new_id,'summary':summary}
