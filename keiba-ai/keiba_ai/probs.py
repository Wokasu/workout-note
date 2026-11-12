"""1着確率から、2着・3着までの組み合わせ確率を出す。

素の Harville 式は「人気馬が2・3着にも来やすすぎる」見積りになるので、
2着目・3着目の計算では確率を γ 乗して平らにする（Lo & Bacon-Shone の補正。
γ2≈0.81, γ3≈0.65 がよく使われる値。自分のデータで fit_gammas で合わせ直せる）。
"""

from __future__ import annotations

import numpy as np

G2 = 0.81
G3 = 0.65


def combo_probs(p: np.ndarray, g2: float = G2, g3: float = G3) -> dict[str, np.ndarray]:
    p = np.asarray(p, dtype=float)
    p = p / p.sum()
    n = len(p)
    eye = np.eye(n, dtype=bool)

    q2 = p ** g2
    denom2 = q2.sum() - q2                     # i が1着のとき残りの合計
    ex = p[:, None] * q2[None, :] / denom2[:, None]
    ex[eye] = 0.0                               # ex[i, j] = P(i 1着, j 2着)

    q3 = p ** g3
    s3 = q3.sum()
    denom3 = s3 - q3[:, None] - q3[None, :]     # i, j が抜けた後の合計
    with np.errstate(divide="ignore", invalid="ignore"):
        tri = ex[:, :, None] * q3[None, None, :] / denom3[:, :, None]
    tri = np.nan_to_num(tri)
    idx = np.arange(n)
    tri[idx, :, idx] = 0.0
    tri[:, idx, idx] = 0.0                      # tri[i, j, k] = P(i, j, k の順で1-2-3着)

    m12 = tri.sum(axis=2)
    m13 = tri.sum(axis=1)
    m23 = tri.sum(axis=0)
    wide = m12 + m12.T + m13 + m13.T + m23 + m23.T   # i と j が両方3着以内
    wide[eye] = 0.0
    quinella = ex + ex.T
    place3 = tri.sum(axis=(1, 2)) + tri.sum(axis=(0, 2)) + tri.sum(axis=(0, 1))
    return {"win": p, "exacta": ex, "quinella": quinella, "wide": wide, "place3": place3}
