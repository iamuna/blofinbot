# Portfolio core on the trend sleeve, 2020–2026 (2026-10-24)

Sleeve rules {"capitalShare":0.5,"stopK":8,"riskShare":0.5}; portfolio rules {"portVolTargetPct":0.1,"maxClusterGrossFrac":0.4,"clusterRho":0.7,"ideaRiskPct":0.0025,"riskShare":1}; conductor {"volDays":60,"floor":0.25,"weekLossStopPct":0.025,"weekLossHalvePct":0.04}; config/risk.json as signed.

## research-data (today's top 20)

**Check passed:** through the constructor (caps open) the book is the sleeve's own — 9298 legs, final equity $13951.14 both ways.

| Variant | Sharpe | Return a year | Volatility | Max drawdown | Positive weeks | Positive quarters | Worst week | Hours cut by: vol cap / cluster cap / dial / weekly cap |
|---|---|---|---|---|---|---|---|---|
| sleeve as configured (risk share 0.5) | 1.07 | 5.0% | 4.7% | 5.6% | 47% | 57% | −1.97% | — |
| + volatility cap 10% and cluster cap 40% (ρ 0.7) | 0.85 | 3.3% | 3.9% | 8.4% | 45% | 61% | −1.78% | 4% / 73% / 0% / 0% |
| + both caps + conductor (dial, weekly cap) | 0.85 | 3.3% | 3.9% | 8.4% | 45% | 61% | −1.78% | 4% / 73% / 0% / 0% |
| + conductor only | 1.07 | 5.0% | 4.7% | 5.6% | 47% | 57% | −1.97% | 0% / 0% / 0% / 0% |

## validation-data (30 other coins, dead ones included)

**Check passed:** through the constructor (caps open) the book is the sleeve's own — 8181 legs, final equity $12626.19 both ways.

| Variant | Sharpe | Return a year | Volatility | Max drawdown | Positive weeks | Positive quarters | Worst week | Hours cut by: vol cap / cluster cap / dial / weekly cap |
|---|---|---|---|---|---|---|---|---|
| sleeve as configured (risk share 0.5) | 0.78 | 3.5% | 4.5% | 5.9% | 49% | 61% | −2.16% | — |
| + volatility cap 10% and cluster cap 40% (ρ 0.7) | 0.84 | 3.3% | 4.0% | 5.2% | 50% | 61% | −2.17% | 3% / 59% / 0% / 0% |
| + both caps + conductor (dial, weekly cap) | 0.84 | 3.3% | 4.0% | 5.2% | 50% | 61% | −2.17% | 3% / 59% / 0% / 0% |
| + conductor only | 0.78 | 3.5% | 4.5% | 5.9% | 49% | 61% | −2.16% | 0% / 0% / 0% / 0% |


## Cluster cap and volatility cap settings (both samples)

Each row adds only the portfolio caps named to the sleeve as configured (no conductor).

| Setting | Sample | Sharpe | Return a year | Volatility | Max drawdown | Positive weeks | Positive quarters | Worst week | Hours cut: vol cap / cluster cap |
|---|---|---|---|---|---|---|---|---|---|
| vol cap only (cluster cap off) | top 20 | 1.07 | 5.0% | 4.7% | 5.6% | 47% | 57% | -1.97% | 10% / 0% |
| cluster ρ 0.85, cap 40% | top 20 | 1.03 | 4.7% | 4.6% | 5.4% | 47% | 57% | -1.97% | 9% / 17% |
| cluster cap 60% | top 20 | 0.91 | 3.9% | 4.3% | 8.0% | 46% | 61% | -1.88% | 6% / 48% |
| vol cap 6%, cluster off | top 20 | 1.04 | 4.8% | 4.6% | 5.4% | 48% | 57% | -1.97% | 39% / 0% |
| vol cap only (cluster cap off) | 30 unseen | 0.78 | 3.5% | 4.5% | 5.9% | 49% | 61% | -2.16% | 9% / 0% |
| cluster ρ 0.85, cap 40% | 30 unseen | 0.76 | 3.4% | 4.5% | 6.2% | 49% | 57% | -2.16% | 7% / 17% |
| cluster cap 60% | 30 unseen | 0.78 | 3.3% | 4.2% | 5.5% | 48% | 57% | -2.16% | 5% / 34% |
| vol cap 6%, cluster off | 30 unseen | 0.80 | 3.6% | 4.5% | 5.8% | 48% | 61% | -2.16% | 44% / 0% |

## Verdict

- The constructor path is the sleeve's own book on real data (both samples, every leg, the same final equity).
- The 10% volatility cap and the conductor change nothing for the trend sleeve alone: it already runs at ~4.5% a year and never lost 2.5% in a week. They are the safety net for a book with more sleeves.
- A 40% cluster cap at ρ 0.7 is a coin toss here: Sharpe 1.07 → 0.85 and drawdown 5.6% → 8.4% on today's top 20, 0.78 → 0.84 on the unseen coins. Milder settings (ρ 0.85, a 60% cap) help on neither. **Off** (maxClusterGrossFrac 1) until a second sleeve trades.
