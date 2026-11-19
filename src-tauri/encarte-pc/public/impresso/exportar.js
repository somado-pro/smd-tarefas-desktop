// Baixar para impressão: cada folha é desenhada a 300 DPI neste navegador, com as fotos e as
// imagens do tema no tamanho ORIGINAL e as fontes embutidas.
//   JPG / PNG  → 1 arquivo (ou .zip com todas as folhas)
//   PDF RGB    → PDF com 1 página por folha, TrimBox/BleedBox certos
//   PDF CMYK   → o mesmo PDF vai pra VPS, que converte com o Ghostscript (fila impresso-export)
(function () {
  const $ = s => document.querySelector(s);
  const A = () => window.ImpressoApp;
  const DPI = 300, MM_POL = 25.4;
  const MAX_PX = 140e6; // acima disso o canvas do navegador falha: reduz o DPI e avisa

  // ---------------------------------------------------------------- arquivos
  const blobs = new Map();
  async function blobDe(u) {
    if (blobs.has(u)) return blobs.get(u);
    const r = await fetch(u, { credentials: 'same-origin' });
    if (!r.ok) throw new Error(`imagem não carregou (${r.status})`);
    const b = await r.blob();
    let w = 0, h = 0;
    try { const bm = await createImageBitmap(b); w = bm.width; h = bm.height; bm.close(); } catch { /* sem medida */ }
    const item = { b, w, h };
    blobs.set(u, item);
    return item;
  }
  const paraDataUrl = b => new Promise((res, rej) => { const f = new FileReader(); f.onload = () => res(f.result); f.onerror = rej; f.readAsDataURL(b); });
  const fontesData = new Map();
  async function cssFontes(familias) {
    const { S } = A();
    const out = [];
    for (const fam of new Set(familias)) {
      const u = S.fontesUrl[fam];
      if (!u) continue;
      if (!fontesData.has(fam)) fontesData.set(fam, paraDataUrl(await (await fetch(u, { credentials: 'same-origin' })).blob()));
      out.push(`@font-face{font-family:'${fam}';src:url('${await fontesData.get(fam)}')}`);
    }
    return out.join('\n') + ' text{text-rendering:geometricPrecision}';
  }

  // ---------------------------------------------------------------- folha
  function montar(p, marcas, urlDe) {
    const { S } = A();
    return Impresso.montarFolha({ tema: S.tema, formato: S.ed.formato, produto: p, validade: S.ed.ficha.validade, url: urlDe, guias: false, marcas });
  }
  // todas as imagens que a folha usa (no tamanho original) + a caixa de cada uma
  function imagensDa(p, marcas) {
    const lista = [];
    const r = montar(p, marcas, (t, ref) => { const u = A().url(t, ref, true); lista.push(u); return u; });
    return { urls: [...new Set(lista)], fotos: r.fotos, formato: r.formato, margem: r.margem };
  }

  async function conferir(lista, marcas, status) {
    const linhas = [];
    let erros = 0;
    for (const [i, p] of lista.entries()) {
      status(`conferindo folha ${i + 1} de ${lista.length}…`);
      const { urls, fotos } = imagensDa(p, marcas);
      await Promise.all(urls.map(u => blobDe(u).catch(() => null)));
      const nome = p.nome || `folha ${i + 1}`;
      if (!p.preco) linhas.push(['aviso', `${nome}: sem preço`]);
      if (!fotos.length) linhas.push(['aviso', `${nome}: sem foto`]);
      for (const f of fotos) {
        const it = blobs.get(A().url('foto', f.foto, true));
        if (!it) { linhas.push(['erro', `${nome}: uma foto não carregou`]); erros++; continue; }
        const dpi = Math.round(it.w / (f.b.w / MM_POL));
        if (dpi < 150) { linhas.push(['erro', `${nome}: foto com ${dpi} DPI (mínimo 150, ideal 250+). Vai sair borrada.`]); erros++; }
        else if (dpi < 250) linhas.push(['aviso', `${nome}: foto com ${dpi} DPI (aceitável; ideal 250+)`]);
      }
    }
    // imagens do tema (fundo cobre a folha inteira)
    const { S } = A(), t = Impresso.temaCompleto(S.tema), f = Impresso.formatoResolvido(S.ed.formato);
    if (t.fundo.imagem && t.fundo.imagem.w) {
      const dpi = Math.round(t.fundo.imagem.w / ((f.largura_mm + 2 * f.sangria_mm) / MM_POL));
      if (dpi < 150) linhas.push(['erro', `Fundo do tema com ${dpi} DPI neste formato (mínimo 150).`]), erros++;
      else if (dpi < 250) linhas.push(['aviso', `Fundo do tema com ${dpi} DPI neste formato.`]);
    }
    for (const c of t.camadas) if (c.tipo === 'imagem' && c.img && c.img.w) {
      const dpi = Math.round(c.img.w / ((c.w * f.largura_mm) / MM_POL));
      if (dpi < 150) linhas.push(['erro', `"${c.nome || 'Imagem'}" do tema com ${dpi} DPI (mínimo 150).`]), erros++;
    }
    return { linhas, erros };
  }

  async function renderizar(p, marcas, tipo) {
    const { urls } = imagensDa(p, marcas);
    const datas = new Map();
    for (const u of urls) {
      const it = await blobDe(u).catch(() => null);
      if (it) datas.set(u, await paraDataUrl(it.b));
    }
    const { svg, formato, margem } = montar(p, marcas, (t, ref) => datas.get(A().url(t, ref, true)) || '');
    for (const im of svg.querySelectorAll('image')) if (!im.getAttribute('href')) im.remove();
    const t = Impresso.temaCompleto(A().S.tema);
    const st = document.createElementNS('http://www.w3.org/2000/svg', 'style');
    st.textContent = await cssFontes([t.nome.fonte, t.preco.fonte, ...t.camadas.filter(c => c.tipo === 'texto').map(c => c.fonte)]);
    svg.insertBefore(st, svg.firstChild);
    const wmm = formato.largura_mm + 2 * margem, hmm = formato.altura_mm + 2 * margem;
    let dpi = DPI;
    const area = d => (wmm / MM_POL * d) * (hmm / MM_POL * d);
    while (area(dpi) > MAX_PX) dpi -= 25;
    const W = Math.round(wmm / MM_POL * dpi), H = Math.round(hmm / MM_POL * dpi);
    svg.setAttribute('width', W); svg.setAttribute('height', H);
    const u = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(svg)], { type: 'image/svg+xml' }));
    const img = new Image();
    await new Promise((res, rej) => { img.onload = res; img.onerror = () => rej(new Error('a folha não desenhou')); img.src = u; });
    await new Promise(r => setTimeout(r, 250)); // fonte embutida assenta
    const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    const ctx = cv.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, H);
    ctx.drawImage(img, 0, 0, W, H);
    URL.revokeObjectURL(u);
    const blob = await new Promise(res => cv.toBlob(res, tipo, 0.95));
    cv.width = cv.height = 1;
    return { blob, W, H, wmm, hmm, margem, sangria: formato.sangria_mm, dpi };
  }

  // ---------------------------------------------------------------- PDF (JPEG por página)
  function pdf(paginas) {
    const te = new TextEncoder();
    const partes = [];
    let pos = 0;
    const offs = [];
    const add = x => { const b = typeof x === 'string' ? te.encode(x) : x; partes.push(b); pos += b.length; };
    const obj = (n, corpo) => { offs[n] = pos; add(`${n} 0 obj\n`); corpo(); add('\nendobj\n'); };
    add('%PDF-1.4\n'); add(new Uint8Array([0x25, 0xE2, 0xE3, 0xCF, 0xD3, 0x0A]));
    const pt = mm => +(mm * 72 / MM_POL).toFixed(3);
    const n = paginas.length;
    const kids = paginas.map((_, i) => `${3 + i * 3} 0 R`).join(' ');
    obj(1, () => add('<< /Type /Catalog /Pages 2 0 R >>'));
    obj(2, () => add(`<< /Type /Pages /Kids [${kids}] /Count ${n} >>`));
    paginas.forEach((p, i) => {
      const np = 3 + i * 3, nc = np + 1, ni = np + 2;
      const W = pt(p.wmm), H = pt(p.hmm), m = pt(p.margem), s = pt(p.sangria);
      const trim = [m, m, +(W - m).toFixed(3), +(H - m).toFixed(3)];
      const bleed = [+(m - s).toFixed(3), +(m - s).toFixed(3), +(W - m + s).toFixed(3), +(H - m + s).toFixed(3)];
      obj(np, () => add(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W} ${H}] /TrimBox [${trim.join(' ')}] /BleedBox [${bleed.join(' ')}] /Resources << /XObject << /Im0 ${ni} 0 R >> >> /Contents ${nc} 0 R >>`));
      const cont = `q ${W} 0 0 ${H} 0 0 cm /Im0 Do Q`;
      obj(nc, () => { add(`<< /Length ${cont.length} >>\nstream\n`); add(cont); add('\nendstream'); });
      obj(ni, () => { add(`<< /Type /XObject /Subtype /Image /Width ${p.W} /Height ${p.H} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${p.bytes.length} >>\nstream\n`); add(p.bytes); add('\nendstream'); });
    });
    const total = 3 + n * 3;
    const xref = pos;
    add(`xref\n0 ${total}\n0000000000 65535 f \n`);
    for (let i = 1; i < total; i++) add(String(offs[i]).padStart(10, '0') + ' 00000 n \n');
    add(`trailer\n<< /Size ${total} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
    return new Blob(partes, { type: 'application/pdf' });
  }

  // ---------------------------------------------------------------- ZIP (sem compressão)
  const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  const crc32 = b => { let c = 0xFFFFFFFF; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };
  function zip(arquivos) {
    const te = new TextEncoder(), partes = [], central = [];
    let pos = 0;
    const u16 = v => new Uint8Array([v & 255, (v >> 8) & 255]);
    const u32 = v => new Uint8Array([v & 255, (v >> 8) & 255, (v >> 16) & 255, (v >>> 24) & 255]);
    for (const a of arquivos) {
      const nome = te.encode(a.nome), crc = crc32(a.bytes), tam = a.bytes.length;
      const loc = [u32(0x04034b50), u16(20), u16(0x0800), u16(0), u16(0), u16(0), u32(crc), u32(tam), u32(tam), u16(nome.length), u16(0), nome];
      central.push([u32(0x02014b50), u16(20), u16(20), u16(0x0800), u16(0), u16(0), u16(0), u32(crc), u32(tam), u32(tam), u16(nome.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(pos), nome]);
      for (const x of loc) { partes.push(x); pos += x.length; }
      partes.push(a.bytes); pos += tam;
    }
    const ini = pos; let tamCentral = 0;
    for (const c of central) for (const x of c) { partes.push(x); tamCentral += x.length; }
    partes.push(u32(0x06054b50), u16(0), u16(0), u16(arquivos.length), u16(arquivos.length), u32(tamCentral), u32(ini), u16(0));
    return new Blob(partes, { type: 'application/zip' });
  }

  function baixar(blob, nome) {
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = nome; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 10000);
  }
  function nomeArquivo(saida, folhas) {
    const { S } = A(), f = Impresso.formatoResolvido(S.ed.formato);
    const limpo = (S.ed.titulo || 'Impresso').replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) || 'Impresso';
    const papel = f.id === 'personalizado' ? `${f.largura_mm}x${f.altura_mm}mm` : f.id;
    const tipo = { 'pdf-cmyk': 'CMYK', 'pdf-rgb': 'RGB', jpg: '300dpi', png: '300dpi' }[saida];
    const ext = saida.startsWith('pdf') ? 'pdf' : folhas > 1 ? 'zip' : saida;
    return `${limpo} - ${papel} - ${tipo}.${ext}`;
  }

  // ---------------------------------------------------------------- tela
  let forcar = false, ocupado = false;
  function mostrar(linhas) {
    const box = $('#bx-check'); box.replaceChildren();
    for (const [cls, txt] of linhas) { const d = document.createElement('div'); d.className = cls; d.textContent = (cls === 'erro' ? '✖ ' : cls === 'aviso' ? '⚠ ' : '✔ ') + txt; box.append(d); }
  }
  function abrir() {
    forcar = false; mostrar([]);
    $('#bx-status').textContent = ''; $('#bx-ok').disabled = false; $('#bx-ok').textContent = 'Gerar';
    const n = A().produtos().length;
    if (!n) mostrar([['erro', 'Sem produtos: cole a lista primeiro.']]);
    $('#dlg-baixar').showModal();
  }
  async function gerar() {
    if (ocupado) return;
    const { S } = A();
    const status = t => { $('#bx-status').textContent = t; };
    const saida = document.querySelector('input[name=saida]:checked').value;
    const marcas = $('#bx-marcas').checked;
    const lista = $('#bx-atual').checked ? [A().atual()].filter(Boolean) : A().produtos().slice();
    if (!lista.length) return mostrar([['erro', 'Sem produtos.']]);
    ocupado = true; $('#bx-ok').disabled = true;
    try {
      status('salvando…');
      await A().salvarTema(false); await A().salvar(true);
      await A().garantirFontes();
      if (!forcar) {
        const { linhas, erros } = await conferir(lista, marcas, status);
        mostrar(linhas.length ? linhas : [['ok', 'Fotos e imagens com resolução boa pra impressão.']]);
        if (erros) {
          forcar = true; status('Tem imagem com resolução baixa. Troque a foto ou gere mesmo assim.');
          $('#bx-ok').textContent = 'Gerar mesmo assim'; return;
        }
      }
      const tipo = saida === 'png' ? 'image/png' : 'image/jpeg';
      const paginas = [];
      let dpiMin = DPI;
      for (const [i, p] of lista.entries()) {
        status(`desenhando folha ${i + 1} de ${lista.length} a 300 DPI…`);
        const r = await renderizar(p, marcas, tipo);
        dpiMin = Math.min(dpiMin, r.dpi);
        paginas.push({ ...r, nome: `${String(i + 1).padStart(2, '0')} ${(p.nome || 'folha').replace(/[\\/:*?"<>|\n]+/g, ' ').trim().slice(0, 60)}.${saida === 'png' ? 'png' : 'jpg'}` });
      }
      const nome = nomeArquivo(saida, paginas.length);
      if (saida === 'jpg' || saida === 'png') {
        if (paginas.length === 1) baixar(paginas[0].blob, nome);
        else { status('juntando no .zip…'); baixar(zip(await Promise.all(paginas.map(async p => ({ nome: p.nome, bytes: new Uint8Array(await p.blob.arrayBuffer()) })))), nome); }
        status(`Pronto: ${nome}` + (dpiMin < DPI ? ` (tamanho grande: saiu com ${dpiMin} DPI)` : ''));
        return;
      }
      status('montando o PDF…');
      for (const p of paginas) p.bytes = new Uint8Array(await p.blob.arrayBuffer());
      const arq = pdf(paginas);
      if (saida === 'pdf-rgb') { baixar(arq, nome); status(`Pronto: ${nome}`); return; }
      status(`enviando o PDF pra VPS converter em CMYK (${(arq.size / 1048576).toFixed(1)} MB)…`);
      const { exportacao } = await A().apiJson(`edicoes/${S.ed.id}/exportar?nome=${encodeURIComponent(nome)}&marcas=${marcas ? 1 : 0}`, { method: 'POST', headers: { 'Content-Type': 'application/pdf' }, body: arq });
      await acompanhar(exportacao.id, status);
    } catch (e) {
      status('Erro: ' + e.message);
    } finally { ocupado = false; $('#bx-ok').disabled = false; blobs.clear(); }
  }
  async function acompanhar(id, status) {
    const { S } = A();
    for (let i = 0; i < 400; i++) {
      const { exportacoes } = await A().apiJson(`edicoes/${S.ed.id}/exportar`);
      const e = exportacoes.find(x => x.id === id);
      if (!e) break;
      if (e.status === 'pronto' && e.baixar) {
        status(`Pronto: ${e.nomeArquivo} (${(e.bytes / 1048576).toFixed(1)} MB). Baixando…`);
        location.href = e.baixar; return;
      }
      if (e.status === 'erro') { status('Erro na conversão CMYK: ' + (e.mensagem || 'sem detalhe')); return; }
      status(e.status === 'fila' ? `Na fila da VPS${e.naFrente ? ` (${e.naFrente} na frente)` : ''}…` : `VPS convertendo pra CMYK: ${e.mensagem || '…'}`);
      await new Promise(r => setTimeout(r, 3000));
    }
    status('A conversão está demorando. Abra "Baixar" de novo daqui a pouco.');
  }

  window.ImpressoExportar = { abrir, gerar, pdf, zip };
})();
