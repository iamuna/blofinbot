from __future__ import annotations
from dataclasses import dataclass

@dataclass(frozen=True)
class RiskPolicy:
    base_risk_pct:float=.25
    max_risk_pct:float=.50
    min_risk_pct:float=.05
    max_portfolio_heat_pct:float=1.25
    max_daily_loss_pct:float=2.0
    max_account_drawdown_pct:float=6.0
    max_concurrent_positions:int=3
    loss_streak_reduce_after:int=3
    loss_streak_stop_after:int=6
    break_even_at_r:float=1.0
    trail_start_r:float=1.5
    trail_atr_mult:float=1.25
    min_stop_atr:float=.65
    max_stop_atr:float=2.5

@dataclass
class PortfolioState:
    equity:float
    high_watermark:float
    day_start_equity:float
    open_risk_usd:float=0.0
    open_positions:int=0
    consecutive_losses:int=0

@dataclass
class TradePlan:
    allowed:bool
    reason:str
    risk_pct:float=0.0
    risk_usd:float=0.0
    qty:float=0.0
    stop:float=0.0
    target:float=0.0
    initial_r:float=0.0

class RiskGovernor:
    def __init__(self,policy:RiskPolicy|None=None):self.policy=policy or RiskPolicy()
    def risk_multiplier(self,confidence:float,regime:str,strategy_health:float=1.0):
        m=max(.25,min(1.25,float(confidence)))*max(.25,min(1.0,float(strategy_health)))
        if regime in {'MIXED','RANGE'}:m*=.65
        if regime=='HIGH_VOLATILITY':m*=.55
        return max(.2,min(1.0,m))
    def plan(self,state:PortfolioState,entry:float,structural_stop:float,atr:float,side:int,confidence:float,regime:str,target_r:float=1.8,strategy_health:float=1.0):
        p=self.policy
        if state.open_positions>=p.max_concurrent_positions:return TradePlan(False,'position cap')
        if state.equity<=state.day_start_equity*(1-p.max_daily_loss_pct/100):return TradePlan(False,'daily loss circuit breaker')
        if state.equity<=state.high_watermark*(1-p.max_account_drawdown_pct/100):return TradePlan(False,'account drawdown circuit breaker')
        if state.consecutive_losses>=p.loss_streak_stop_after:return TradePlan(False,'loss-streak circuit breaker')
        if atr<=0 or entry<=0:return TradePlan(False,'invalid ATR/entry')
        raw=abs(entry-structural_stop);dist=max(p.min_stop_atr*atr,min(p.max_stop_atr*atr,raw if raw>0 else atr));stop=entry-side*dist
        mult=self.risk_multiplier(confidence,regime,strategy_health)
        if state.consecutive_losses>=p.loss_streak_reduce_after:mult*=.5
        risk_pct=max(p.min_risk_pct,min(p.max_risk_pct,p.base_risk_pct*mult));risk_usd=state.equity*risk_pct/100;max_heat=state.equity*p.max_portfolio_heat_pct/100;available=max(0,max_heat-state.open_risk_usd);risk_usd=min(risk_usd,available)
        if risk_usd<=0:return TradePlan(False,'portfolio heat cap')
        qty=risk_usd/dist;target=entry+side*target_r*dist
        return TradePlan(True,'ok',risk_pct,risk_usd,qty,stop,target,dist)
    def trail_stop(self,side:int,entry:float,current:float,current_stop:float,initial_r:float,atr:float,recent_swing:float|None=None):
        p=self.policy;progress=side*(current-entry)/max(initial_r,1e-12);stop=current_stop
        if progress>=p.break_even_at_r:stop=max(stop,entry) if side>0 else min(stop,entry)
        if progress>=p.trail_start_r:
            candidate=current-side*p.trail_atr_mult*atr
            if recent_swing is not None:candidate=max(candidate,recent_swing) if side>0 else min(candidate,recent_swing)
            stop=max(stop,candidate) if side>0 else min(stop,candidate)
        return stop
