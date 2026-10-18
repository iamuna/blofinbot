"""ML layer experiment: does a gradient-boosted model on the engine's own daily state beat the plain
vote-based system out of sample?

    python3 lab/mtf/ml_overlay.py research_out/ml/panel_top20.csv research_out/ml/panel_val30.csv research_out/ml

Daily simulation (both systems through the same simulator, costs 5.9 bps per unit turnover, funding ignored
in both): weights per coin → portfolio scaled to 25% vol on trailing 60-day returns (cap 3×), gross ≤ 3.
Walk-forward: for test year Y the model is trained only on days before Y (expanding window), and it is
always evaluated on BOTH coin sets; training on the top-20 and testing on the 30 unseen coins is the
cross-universe check.
"""
import sys, json
import numpy as np
import pandas as pd
from sklearn.ensemble import HistGradientBoostingRegressor

TF_SETUP = ["v_1h", "v_2h", "v_4h", "v_6h", "v_12h"]
TF_STRAT = ["v_1d", "v_3d", "v_1w", "v_1M", "v_3M"]
FEATS = TF_SETUP + TF_STRAT + ["vol", "xsec", "r1", "r7", "r30", "fund3", "btc_strat", "base_pos"]
COST = 0.00059


def load(p):
    d = pd.read_csv(p)
    d["date"] = pd.to_datetime(d["day"], unit="D")
    s = d[TF_SETUP].mean(axis=1, skipna=True)
    t = d[TF_STRAT].mean(axis=1, skipna=True)
    has_s, has_t = d[TF_SETUP].notna().any(axis=1), d[TF_STRAT].notna().any(axis=1)
    pos = (0.6 * t.fillna(0) * has_t + 0.4 * s.fillna(0) * has_s) / (0.6 * has_t + 0.4 * has_s).replace(0, np.nan)
    d["base_pos"] = pos.fillna(0)
    d["y"] = (d["next_ret"] / (d["vol"] / np.sqrt(365))).clip(-5, 5)  # next-day return in units of daily vol
    return d


def base_weight(d, pos):
    scale = np.minimum(2.0, 0.25 / d["vol"])
    tilt = np.where(pos > 0, 1 + 0.5 * d["xsec"], np.where(pos < 0, 1 - 0.5 * d["xsec"], 1.0))
    return pos * scale * tilt / np.maximum(5, d["live"])


def simulate(d, w, start=None, end=None):
    x = d[["date", "coin", "next_ret"]].copy()
    x["w"] = w
    W = x.pivot_table(index="date", columns="coin", values="w", aggfunc="first").fillna(0.0)
    R = x.pivot_table(index="date", columns="coin", values="next_ret", aggfunc="first").reindex_like(W).fillna(0.0)
    R = np.expm1(R)
    raw = (W * R).sum(axis=1)
    # portfolio vol targeting on the strategy's own trailing 60 days (known before the day)
    sd = raw.rolling(60, min_periods=30).std().shift(1) * np.sqrt(365)
    ps = (0.25 / sd).clip(upper=3).fillna(1.0)
    Wp = W.mul(ps, axis=0)
    gross = Wp.abs().sum(axis=1)
    Wp = Wp.div(np.maximum(1.0, gross / 3.0), axis=0)
    turnover = Wp.diff().abs().sum(axis=1).fillna(Wp.abs().sum(axis=1))
    ret = (Wp * R).sum(axis=1) - turnover * COST
    if start is not None:
        ret = ret[(ret.index >= start) & (ret.index < end)]
    if len(ret) < 20:
        return None
    sh = ret.mean() / ret.std() * np.sqrt(365) if ret.std() > 0 else 0
    eq = (1 + ret).cumprod()
    return {"sharpe": round(float(sh), 2), "ret": round(float(eq.iloc[-1] - 1) * 100, 1), "maxDD": round(float((1 - eq / eq.cummax()).max()) * 100, 1), "days": int(len(ret))}


def model():
    return HistGradientBoostingRegressor(max_depth=3, learning_rate=0.04, max_iter=250, min_samples_leaf=300, l2_regularization=1.0, random_state=7)


def main():
    a, b, out = sys.argv[1], sys.argv[2], sys.argv[3]
    T, V = load(a), load(b)
    years = [2023, 2024, 2025, 2026]
    preds = {"T": pd.Series(np.nan, index=T.index), "V": pd.Series(np.nan, index=V.index), "VxT": pd.Series(np.nan, index=V.index)}
    ics = []
    for y in years:
        cut = pd.Timestamp(f"{y}-01-01"); nxt = pd.Timestamp(f"{y + 1}-01-01")
        for key, train, test in (("T", T, T), ("V", V, V), ("VxT", T, V)):
            tr = train[train["date"] < cut].dropna(subset=["y"])
            te = test[(test["date"] >= cut) & (test["date"] < nxt)]
            if len(tr) < 2000 or not len(te):
                continue
            m = model().fit(tr[FEATS], tr["y"])
            preds[key].loc[te.index] = m.predict(te[FEATS])
            p = pd.Series(preds[key].loc[te.index], index=te.index)
            ic = te.assign(p=p).groupby("date").apply(lambda g: g["p"].rank().corr(g["y"].rank()) if len(g) > 4 else np.nan, include_groups=False).mean()
            ics.append({"year": y, "train": "top-20" if key in ("T", "VxT") else "val-30", "test": "top-20" if key == "T" else "val-30", "rankIC": round(float(ic), 4)})
    rows = []
    for name, d, pk in (("top-20", T, "T"), ("val-30 (model trained on val-30 past)", V, "V"), ("val-30 (model trained on top-20 only)", V, "VxT")):
        p = preds[pk]
        z = d.assign(p=p).groupby("date")["p"].transform(lambda s: (s - s.mean()) / (s.std() + 1e-9)).clip(-2, 2)
        variants = {
            "Plain vote system": base_weight(d, d["base_pos"]),
            "ML only (long/short by prediction)": base_weight(d, (p / 2).clip(-1, 1).fillna(0)),
            "Vote system × (1 + 0.5·ML rank)": base_weight(d, d["base_pos"]) * (1 + 0.25 * z.fillna(0)),
            "Vote system, cut where ML disagrees": base_weight(d, d["base_pos"]) * np.where(np.sign(p.fillna(0)) * np.sign(d["base_pos"]) < 0, 0.0, 1.0),
        }
        for vname, w in variants.items():
            r = {"universe": name, "variant": vname}
            for y in years:
                s = simulate(d, w, pd.Timestamp(f"{y}-01-01"), pd.Timestamp(f"{y + 1}-01-01"))
                r[str(y)] = s
            allp = simulate(d, w, pd.Timestamp("2023-01-01"), pd.Timestamp("2027-01-01"))
            r["2023-26"] = allp
            rows.append(r)
            print(f"{name:42s} {vname:38s} 2023-26 Sharpe {allp['sharpe']:5.2f} ret {allp['ret']:6.1f}% dd {allp['maxDD']:5.1f}% | " + " ".join(f"{y}:{r[str(y)]['sharpe'] if r[str(y)] else '-'}" for y in years))
    print("rank IC by year:", ics)
    json.dump({"rows": rows, "rankIC": ics, "features": FEATS}, open(f"{out}/ml_overlay.json", "w"), indent=1, default=str)


if __name__ == "__main__":
    main()
