// Desenho do cartaz impresso (1 produto por folha). Usado pelo editor (public/impresso/app.js)
// e pela exportação. Tudo em mm: o SVG tem viewBox em mm com (0,0) no canto do CORTE; a
// sangria e as marcas ficam em coordenadas negativas / além da largura.
// O tema guarda as caixas em FRAÇÕES da folha (x,w da largura; y,h da altura), então o mesmo
// tema serve em A3, A4, A5 e personalizado. Mesmo cálculo de formato em lib/impresso/formatos.ts.
(function (root) {
  const NS = 'http://www.w3.org/2000/svg';
  const XL = 'http://www.w3.org/1999/xlink';
  const PAPEIS = { A3: [297, 420], A4: [210, 297], A5: [148, 210] };
  const MARCAS_MM = 10;

  const TEMA_PADRAO = {
    versao: 1,
    fundo: { cor: '#ffffff', imagem: null },
    camadas: [
      { id: 'cab', tipo: 'imagem', nome: 'Cabeçalho', img: null, x: 0, y: 0, w: 1, h: 0.22, ajuste: 'conter' },
      { id: 'validade', tipo: 'texto', nome: 'Validade', campo: 'validade', texto: '', x: 0.05, y: 0.935, w: 0.9, h: 0.035, fonte: 'Montserrat-Bold', cor: '#333333', alinha: 'centro' },
    ],
    nome: { x: 0.06, y: 0.24, w: 0.88, h: 0.15, fonte: 'Montserrat-Black', cor: '#111111', alinha: 'centro', maiusculas: true, linhas_max: 3, entrelinha: 1.0, contorno_cor: '', contorno: 0 },
    fotos: { x: 0.08, y: 0.405, w: 0.84, h: 0.33, espaco: 0.035 },
    preco: { x: 0.1, y: 0.75, w: 0.8, h: 0.17, fundo: null, fundo_cor: '#ffe600', fonte: 'Anton-Regular', cor: '#e30613', rs_cor: '#111111', rs_escala: 0.3, un_cor: '#e30613', un_escala: 0.14, contorno_cor: '', contorno: 0 },
  };

  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function temaCompleto(t) {
    const base = clone(TEMA_PADRAO);
    if (!t || typeof t !== 'object' || !t.versao) return base;
    return {
      versao: 1,
      fundo: { ...base.fundo, ...(t.fundo || {}) },
      camadas: Array.isArray(t.camadas) ? t.camadas : base.camadas,
      nome: { ...base.nome, ...(t.nome || {}) },
      fotos: { ...base.fotos, ...(t.fotos || {}) },
      preco: { ...base.preco, ...(t.preco || {}) },
    };
  }

  function formatoResolvido(e) {
    e = e || {};
    const id = ['A3', 'A4', 'A5', 'personalizado'].includes(e.id) ? e.id : 'A4';
    const orientacao = e.orientacao === 'paisagem' ? 'paisagem' : 'retrato';
    const n = (v, p) => { const x = Number(String(v ?? '').replace(',', '.')); return Number.isFinite(x) && String(v ?? '') !== '' ? x : p; };
    let w, h;
    if (id === 'personalizado') { w = Math.min(1200, Math.max(50, n(e.largura_mm, 210))); h = Math.min(1200, Math.max(50, n(e.altura_mm, 297))); }
    else { [w, h] = PAPEIS[id]; if (orientacao === 'paisagem') [w, h] = [h, w]; }
    const sangria = Math.min(10, Math.max(0, n(e.sangria_mm, 3)));
    const seguranca = Math.min(Math.min(w, h) / 4, Math.max(0, n(e.seguranca_mm, 5)));
    const r1 = v => Math.round(v * 10) / 10;
    return { id, orientacao, largura_mm: r1(w), altura_mm: r1(h), sangria_mm: r1(sangria), seguranca_mm: r1(seguranca) };
  }

  // ------------------------------------------------------------ medir texto (canvas, fontes já carregadas)
  const cv = typeof document !== 'undefined' ? document.createElement('canvas').getContext('2d') : null;
  function largura(txt, fonte, mm) {
    cv.font = `${mm * 10}px '${fonte}', sans-serif`;
    return cv.measureText(txt).width / 10;
  }

  // quebra em linhas que cabem em `w` com tamanho `s`; respeita \n do usuário
  function quebrar(texto, fonte, s, w) {
    const out = [];
    for (const par of String(texto).split('\n')) {
      const pal = par.split(/\s+/).filter(Boolean);
      let atual = '';
      for (const p of pal) {
        const t = atual ? atual + ' ' + p : p;
        if (!atual || largura(t, fonte, s) <= w) atual = t;
        else { out.push(atual); atual = p; }
      }
      out.push(atual);
    }
    return out;
  }

  // maior tamanho em que o nome cabe na caixa com no máximo `max` linhas
  function ajustarNome(texto, cfg, b, escala) {
    const ent = cfg.entrelinha || 1;
    const max = Math.max(1, cfg.linhas_max || 3);
    let s = Math.min(b.h * 0.92, b.h / ent) * (escala || 1);
    for (let i = 0; i < 80 && s > 1; i++) {
      const linhas = quebrar(texto, cfg.fonte, s, b.w);
      const larg = Math.max(...linhas.map(l => largura(l, cfg.fonte, s)));
      const alt = s * 0.92 + (linhas.length - 1) * s * ent;
      if (linhas.length <= max && larg <= b.w + 0.01 && alt <= b.h + 0.01) return { s, linhas };
      s *= 0.96;
    }
    return { s, linhas: quebrar(texto, cfg.fonte, s, b.w) };
  }

  // grade das fotos que deixa elas maiores; última linha centrada
  function arranjarFotos(fotos, b, espaco) {
    const n = fotos.length;
    if (!n) return [];
    const g = Math.min(b.w, b.h) * (espaco ?? 0.035);
    let melhor = null;
    for (let c = 1; c <= n; c++) {
      const r = Math.ceil(n / c);
      const cw = (b.w - (c - 1) * g) / c, ch = (b.h - (r - 1) * g) / r;
      if (cw <= 0 || ch <= 0) continue;
      let area = 0;
      const tam = fotos.map(f => {
        const a = (f.w && f.h) ? f.w / f.h : 1;
        const w = Math.min(cw, ch * a), h = w / a;
        area += w * h;
        return { w, h };
      });
      if (!melhor || area > melhor.area) melhor = { c, r, cw, ch, area, tam };
    }
    const { c, r, cw, ch, tam } = melhor;
    const out = [];
    for (let i = 0; i < n; i++) {
      const lin = Math.floor(i / c), col = i % c;
      const naLinha = lin === r - 1 ? n - lin * c : c;
      const larguraLinha = naLinha * cw + (naLinha - 1) * g;
      const x0 = b.x + (b.w - larguraLinha) / 2 + col * (cw + g);
      const y0 = b.y + (b.h - (r * ch + (r - 1) * g)) / 2 + lin * (ch + g);
      out.push({ x: x0 + (cw - tam[i].w) / 2, y: y0 + (ch - tam[i].h) / 2, w: tam[i].w, h: tam[i].h });
    }
    return out;
  }

  function el(tag, at, pai) {
    const e = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(at || {})) if (v !== undefined && v !== null && v !== '') e.setAttribute(k, v);
    if (pai) pai.appendChild(e);
    return e;
  }
  function img(pai, href, b, ajuste) {
    const par = ajuste === 'cobrir' ? 'xMidYMid slice' : ajuste === 'esticar' ? 'none' : 'xMidYMid meet';
    const i = el('image', { x: b.x, y: b.y, width: b.w, height: b.h, preserveAspectRatio: par }, pai);
    i.setAttribute('href', href); i.setAttributeNS(XL, 'xlink:href', href);
    return i;
  }
  function texto(pai, t, at, cfg) {
    const e = el('text', { ...at, 'font-family': `'${cfg.fonte}'`, fill: cfg.cor || '#000' }, pai);
    if (cfg.contorno_cor && cfg.contorno > 0) {
      e.setAttribute('stroke', cfg.contorno_cor); e.setAttribute('stroke-width', cfg.contorno);
      e.setAttribute('paint-order', 'stroke'); e.setAttribute('stroke-linejoin', 'round');
    }
    e.textContent = t;
    return e;
  }

  const caixa = (c, f) => ({ x: c.x * f.largura_mm, y: c.y * f.altura_mm, w: c.w * f.largura_mm, h: c.h * f.altura_mm });
  const ancora = a => a === 'esquerda' ? 'start' : a === 'direita' ? 'end' : 'middle';
  const xAncora = (a, b) => a === 'esquerda' ? b.x : a === 'direita' ? b.x + b.w : b.x + b.w / 2;

  function separarPreco(v) {
    v = String(v || '').trim().replace(/^R\$\s*/i, '').replace(/\s+/g, '');
    // ponto decimal ("7.99") vira vírgula; ponto de milhar ("1.299,90") fica
    if (/^\d+\.\d{1,2}$/.test(v)) v = v.replace('.', ',');
    if (/^[\d.]+$/.test(v)) v += ',00';
    if (/,\d$/.test(v)) v += '0';
    return v;
  }

  /**
   * Monta a folha de UM produto.
   * o = { tema, formato, produto, validade, url(fonte,arq,'foto'|'tema'), guias, marcas, fotosReais }
   * Devolve { svg, fotos: [{arq, b}] } (b = caixa da foto em mm, pra conferir o DPI).
   */
  function montarFolha(o) {
    const t = temaCompleto(o.tema), f = formatoResolvido(o.formato), p = o.produto || {};
    const aj = p.aj || {};
    const m = f.sangria_mm + (o.marcas ? MARCAS_MM : 0);
    const W = f.largura_mm, H = f.altura_mm;
    const svg = el('svg', { xmlns: NS, viewBox: `${-m} ${-m} ${W + 2 * m} ${H + 2 * m}`, width: `${W + 2 * m}mm`, height: `${H + 2 * m}mm` });
    svg.setAttributeNS('http://www.w3.org/2000/xmlns/', 'xmlns:xlink', XL);
    const s = f.sangria_mm;
    const sangria = { x: -s, y: -s, w: W + 2 * s, h: H + 2 * s };
    if (o.marcas) el('rect', { x: -m, y: -m, width: W + 2 * m, height: H + 2 * m, fill: '#ffffff' }, svg);
    // fundo: cobre corte + sangria
    el('rect', { ...{ x: sangria.x, y: sangria.y, width: sangria.w, height: sangria.h }, fill: t.fundo.cor || '#ffffff' }, svg);
    if (t.fundo.imagem && t.fundo.imagem.k) img(svg, o.url('tema', t.fundo.imagem.k), sangria, 'cobrir');

    const camada = c => {
      const b = caixa(c, f);
      if (c.tipo === 'imagem' && c.img && c.img.k) img(svg, o.url('tema', c.img.k), b, c.ajuste || 'conter');
      else if (c.tipo === 'retangulo') {
        const r = (c.raio || 0) * Math.min(W, H);
        el('rect', { x: b.x, y: b.y, width: b.w, height: b.h, rx: r, ry: r, fill: c.cor || 'none', stroke: c.borda > 0 ? c.borda_cor || '#000' : '', 'stroke-width': c.borda > 0 ? c.borda : '' }, svg);
      } else if (c.tipo === 'texto') {
        const conteudo = c.campo === 'validade' ? (o.validade || '') : (c.texto || '');
        if (!conteudo) return;
        const cfg = { fonte: c.fonte || 'Montserrat-Bold', cor: c.cor, linhas_max: 2, entrelinha: 1.05 };
        const r = ajustarNome(conteudo, cfg, b, 1);
        r.linhas.forEach((l, i) => texto(svg, l, { x: xAncora(c.alinha, b), y: b.y + (b.h - (r.linhas.length - 1) * r.s * 1.05) / 2 + r.s * 0.36 + i * r.s * 1.05, 'font-size': r.s, 'text-anchor': ancora(c.alinha) }, cfg));
      }
    };
    t.camadas.filter(c => !c.acima).forEach(camada);

    // fotos
    const fotos = (p.fotos || []).filter(x => x && (x.arq || x.k));
    const bf = caixa(t.fotos, f);
    const esc = aj.fotos || 1;
    const bfx = { x: bf.x + bf.w * (1 - esc) / 2 + (aj.fx || 0) * bf.w, y: bf.y + bf.h * (1 - esc) / 2 + (aj.fy || 0) * bf.h, w: bf.w * esc, h: bf.h * esc };
    const lugares = arranjarFotos(fotos, bfx, t.fotos.espaco);
    const usadas = [];
    fotos.forEach((ft, i) => { img(svg, o.url('foto', ft), lugares[i], 'conter'); usadas.push({ foto: ft, b: lugares[i] }); });

    // nome
    const bn = caixa(t.nome, f);
    let nome = String(p.nome || '').trim();
    if (t.nome.maiusculas) nome = nome.toLocaleUpperCase('pt-BR');
    if (nome) {
      const r = ajustarNome(nome, t.nome, bn, aj.nome || 1);
      const ent = t.nome.entrelinha || 1;
      const alt = r.s * 0.72 + (r.linhas.length - 1) * r.s * ent;
      const y0 = bn.y + (bn.h - alt) / 2 + r.s * 0.72;
      r.linhas.forEach((l, i) => texto(svg, l, { x: xAncora(t.nome.alinha, bn), y: y0 + i * r.s * ent, 'font-size': r.s, 'text-anchor': ancora(t.nome.alinha) }, t.nome));
    }

    // preço: selo (imagem ou cor) + R$ + valor + unidade
    const P = t.preco, bp = caixa(P, f);
    const valor = separarPreco(p.preco);
    if (valor) {
      if (P.fundo && P.fundo.k) img(svg, o.url('tema', P.fundo.k), bp, 'esticar');
      else if (P.fundo_cor) el('rect', { x: bp.x, y: bp.y, width: bp.w, height: bp.h, rx: bp.h * 0.08, fill: P.fundo_cor }, svg);
      const un = String(p.unidade || '').trim().toUpperCase();
      const esc2 = aj.preco || 1;
      let sz = bp.h * 0.7 * esc2;
      const gap = () => sz * 0.06;
      const medida = () => largura('R$', P.fonte, sz * P.rs_escala) + gap() + largura(valor, P.fonte, sz) + (un ? gap() + largura(un, P.fonte, sz * P.un_escala) : 0);
      const disponivel = bp.w * 0.88;
      if (medida() > disponivel) sz *= disponivel / medida();
      const total = medida();
      let x = bp.x + (bp.w - total) / 2;
      const base = bp.y + bp.h / 2 + sz * 0.36;
      texto(svg, 'R$', { x, y: base - sz * 0.42, 'font-size': sz * P.rs_escala }, { ...P, cor: P.rs_cor });
      x += largura('R$', P.fonte, sz * P.rs_escala) + gap();
      texto(svg, valor, { x, y: base, 'font-size': sz }, P);
      x += largura(valor, P.fonte, sz) + gap();
      if (un) texto(svg, un, { x, y: base, 'font-size': sz * P.un_escala }, { ...P, cor: P.un_cor });
    }

    t.camadas.filter(c => c.acima).forEach(camada);

    if (o.guias) {
      // fora do corte escurece; linhas de corte e de segurança
      const g = el('g', { 'pointer-events': 'none' }, svg);
      el('path', { d: `M${-m} ${-m}h${W + 2 * m}v${H + 2 * m}h${-(W + 2 * m)}z M0 0v${H}h${W}v${-H}z`, fill: 'rgba(0,0,0,.35)', 'fill-rule': 'evenodd' }, g);
      el('rect', { x: 0, y: 0, width: W, height: H, fill: 'none', stroke: '#e11d48', 'stroke-width': 0.35, 'stroke-dasharray': '2 1.2' }, g);
      const sg = f.seguranca_mm;
      if (sg > 0) el('rect', { x: sg, y: sg, width: W - 2 * sg, height: H - 2 * sg, fill: 'none', stroke: '#0284c7', 'stroke-width': 0.3, 'stroke-dasharray': '1 1' }, g);
    }
    if (o.marcas) {
      const g = el('g', { stroke: '#000', 'stroke-width': 0.1, fill: 'none' }, svg);
      const ini = s + 1, fim = m;
      for (const [cx, cy, dx, dy] of [[0, 0, -1, -1], [W, 0, 1, -1], [0, H, -1, 1], [W, H, 1, 1]]) {
        el('line', { x1: cx + dx * ini, y1: cy, x2: cx + dx * fim, y2: cy }, g);
        el('line', { x1: cx, y1: cy + dy * ini, x2: cx, y2: cy + dy * fim }, g);
      }
    }
    return { svg, fotos: usadas, formato: f, margem: m };
  }

  root.Impresso = { TEMA_PADRAO, temaCompleto, formatoResolvido, montarFolha, arranjarFotos, separarPreco, MARCAS_MM, clone };
})(typeof window !== 'undefined' ? window : globalThis);
