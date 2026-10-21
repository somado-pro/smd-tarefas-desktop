// Somado Encarte — divisórias da zona: linhas entre os itens que acompanham a grade (Matheus, 17/10/2026,
// SMD-957). Conta pura, sem DOM: o editor de encarte e o construtor carregam este arquivo; o gerador do
// SVG (lib/encarte/divisorias.ts) faz a mesma conta e o teste confere que as duas batem.
//
// cells = casas dos cards da zona [{x, y, w, h}]. Vertical: no meio do vão entre dois cards vizinhos da
// MESMA fileira, da altura em que os dois se sobrepõem. Horizontal: no meio do vão entre um card e o de
// baixo; as do mesmo vão viram uma linha só (3 colunas em cima de 3 = uma linha da largura da zona).
// Linha vertical de fileiras diferentes não junta (cada fileira tem a sua, separada pelo vão).
// recuo = pt tirados de cada ponta. vaoMax = maior vão que ainda conta como vizinho.
'use strict';

function divisoriasDaZona(cells, o = {}) {
  const v = o.v !== false, h = o.h !== false, recuo = Math.max(0, Number(o.recuo) || 0);
  const vaoMax = Number(o.vaoMax) > 0 ? Number(o.vaoMax) : 40;
  const cs = (cells || []).filter(c => c && c.w > 0 && c.h > 0);
  const r2 = n => Math.round(n * 100) / 100;
  const ver = [], hor = [];
  for (const a of cs) for (const b of cs) {
    if (a === b) continue;
    // b à direita de a
    const gx = b.x - (a.x + a.w);
    if (v && gx >= -1 && gx <= vaoMax) {
      const t = Math.max(a.y, b.y), f = Math.min(a.y + a.h, b.y + b.h);
      if (f - t > 0.5 * Math.min(a.h, b.h)) ver.push({ c: a.x + a.w + gx / 2, a: t, b: f });
    }
    // b embaixo de a
    const gy = b.y - (a.y + a.h);
    if (h && gy >= -1 && gy <= vaoMax) {
      const e = Math.max(a.x, b.x), d = Math.min(a.x + a.w, b.x + b.w);
      if (d - e > 0.25 * Math.min(a.w, b.w)) hor.push({ c: a.y + a.h + gy / 2, a: Math.min(a.x, b.x), b: Math.max(a.x + a.w, b.x + b.w) });
    }
  }
  // junta segmentos na mesma reta: vertical só se encostarem; horizontal se o buraco for de até um vão
  const juntar = (segs, folga) => {
    const out = [];
    for (const s of segs.slice().sort((p, q) => p.c - q.c || p.a - q.a)) {
      const u = out.find(x => Math.abs(x.c - s.c) < 1 && s.a <= x.b + folga && s.b >= x.a - folga);
      if (u) { u.a = Math.min(u.a, s.a); u.b = Math.max(u.b, s.b); } else out.push({ ...s });
    }
    return out;
  };
  const res = [];
  const empurra = (div, s) => {
    const a = s.a + recuo, b = s.b - recuo; if (b - a < 4) return;
    res.push(div === 'v' ? { div, x1: r2(s.c), y1: r2(a), x2: r2(s.c), y2: r2(b) } : { div, x1: r2(a), y1: r2(s.c), x2: r2(b), y2: r2(s.c) });
  };
  for (const s of juntar(ver, 0.5)) empurra('v', s);
  for (const s of juntar(hor, vaoMax)) empurra('h', s);
  return res;
}
