from __future__ import annotations

def candle_pattern(prev,cur):
    o,h,l,c=map(float,(cur['open'],cur['high'],cur['low'],cur['close']));po,pc=float(prev['open']),float(prev['close']);body=abs(c-o);rng=max(h-l,1e-12);upper=h-max(o,c);lower=min(o,c)-l
    if body/rng<=.08:return 'doji',0,.55
    if lower>=body*2.2 and upper<=max(body*.5,rng*.12):return 'hammer',1,.68
    if upper>=body*2.2 and lower<=max(body*.5,rng*.12):return 'shooting_star',-1,.68
    if c>o and pc<po and o<=pc and c>=po:return 'bullish_engulfing',1,.78
    if c<o and pc>po and o>=pc and c<=po:return 'bearish_engulfing',-1,.78
    if h<=float(prev['high']) and l>=float(prev['low']):return 'inside_bar',0,.52
    if h>=float(prev['high']) and l<=float(prev['low']):return 'outside_bar',1 if c>o else -1,.58
    return '',0,0.0

def structure_state(last_highs,last_lows):
    if len(last_highs)<2 or len(last_lows)<2:return 'UNCONFIRMED'
    hh=last_highs[-1][1]>last_highs[-2][1];hl=last_lows[-1][1]>last_lows[-2][1];lh=last_highs[-1][1]<last_highs[-2][1];ll=last_lows[-1][1]<last_lows[-2][1]
    if hh and hl:return 'HH_HL'
    if lh and ll:return 'LH_LL'
    return 'MIXED'

def harmonic_candidates(pivots,tolerance=.08):
    if len(pivots)<5:return []
    vals=[x[1] for x in pivots[-5:]];X,A,B,C,D=vals;XA=A-X;AB=B-A;BC=C-B;CD=D-C;XD=D-X
    if min(abs(XA),abs(AB),abs(BC))<1e-12:return []
    rAB=abs(AB/XA);rBC=abs(BC/AB);rCD=abs(CD/BC);rXD=abs(XD/XA)
    def near(x,target,t=tolerance):return abs(x-target)<=t*max(1,target)
    out=[];templates=[('gartley',.618,(.382,.886),(1.13,1.618),.786),('bat',(.382,.5),(.382,.886),(1.618,2.618),.886),('butterfly',.786,(.382,.886),(1.618,2.618),1.27),('crab',(.382,.618),(.382,.886),(2.24,3.618),1.618)]
    for name,ab,bc,cd,xd in templates:
        abok=near(rAB,ab) if isinstance(ab,float) else ab[0]*(1-tolerance)<=rAB<=ab[1]*(1+tolerance);bcok=bc[0]*(1-tolerance)<=rBC<=bc[1]*(1+tolerance);cdok=cd[0]*(1-tolerance)<=rCD<=cd[1]*(1+tolerance);xdok=near(rXD,xd);score=sum((abok,bcok,cdok,xdok))/4
        if score>=.75:out.append({'pattern':name,'direction':1 if D<C else -1,'confidence':round(.55+.4*score,3),'ratios':{'AB_XA':rAB,'BC_AB':rBC,'CD_BC':rCD,'XD_XA':rXD}})
    ratio=abs(CD/AB)
    if .9<=ratio<=1.1:out.append({'pattern':'abcd','direction':1 if D<C else -1,'confidence':.72,'ratios':{'CD_AB':ratio,'BC_AB':rBC}})
    return out

def elliott_candidates(pivots):
    if len(pivots)<6:return []
    y=[v for _,v,_ in pivots[-6:]];d=[y[i+1]-y[i] for i in range(5)];out=[];up=d[0]>0 and d[1]<0 and d[2]>0 and d[3]<0 and d[4]>0;dn=d[0]<0 and d[1]>0 and d[2]<0 and d[3]>0 and d[4]<0
    if up or dn:
        sign=1 if up else -1;w=[abs(x) for x in d];w2=abs(d[1])<abs(d[0])*1.001;w3=w[2]>=min(w[0],w[4]);w4=y[4]>y[1] if up else y[4]<y[1];score=sum((w2,w3,w4))/3
        if score>=2/3:out.append({'pattern':'elliott_impulse_1_5','direction':sign,'confidence':round(.5+.4*score,3),'rules':{'wave2_retrace_ok':w2,'wave3_not_shortest':w3,'wave4_nonoverlap':w4}})
    q=y[-4:];e=[q[i+1]-q[i] for i in range(3)]
    if (e[0]>0 and e[1]<0 and e[2]>0) or (e[0]<0 and e[1]>0 and e[2]<0):
        ratio=abs(e[2]/e[0]) if e[0] else 0
        if .5<=ratio<=1.618:out.append({'pattern':'elliott_abc','direction':1 if e[2]>0 else -1,'confidence':.62,'ratios':{'C_A':ratio}})
    return out
