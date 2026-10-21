// Motor de busca do banco de fotos — port da logica do matcher.py (skill encarte-matcher):
// normaliza acento/pontuacao, gruda numero+unidade ("5 kg" -> "5kg", "2 lt" -> "2l"),
// filtra por medida (tolerancia 10%) e pontua por cobertura de palavras (ordem nao importa).
// Diferenca pro matcher: aceita PREFIXO ("achoc" acha "achocolatado"), porque aqui a pessoa
// esta digitando e a busca roda a cada tecla.
// Roda no painel (window.SomadoBusca) e no Node (require) pro teste.
(function (root) {
  var RE_MEDIDA_TOKEN = /^\d+[,.]?\d*(kg|g|l|ml|un|cm|mm)$/;

  function normalizar(s) {
    s = String(s || '').toLowerCase();
    if (s.normalize) s = s.normalize('NFD').replace(/[̀-ͯ]/g, '');
    s = s.replace(/[-_]/g, ' ');
    s = s.replace(/[^\w\s,.]/g, '');
    // virgula/ponto so ficam entre digitos (1,5l / 2.5kg); resto vira espaco
    s = s.replace(/(\d)[,.](?=\d)/g, '$1\u0001').replace(/[,.]/g, ' ').replace(/\u0001/g, ',');
    s = s.replace(/\s+/g, ' ').trim();
    s = s.replace(/(\d+,?\d*)\s*lts?\b/g, '$1 l');
    s = s.replace(/(\d+,?\d*)\s+(kg|g|l|ml|un|cm|mm)\b/g, '$1$2');
    return s;
  }

  var CONV = { kg: ['peso', 1000], g: ['peso', 1], l: ['volume', 1000], ml: ['volume', 1],
               un: ['unidade', 1], cm: ['comprimento', 10], mm: ['comprimento', 1] };

  // ultima medida do texto -> {cat, val} (peso em g, volume em ml) ou null
  function extrairMedida(norm) {
    var re = /(\d+,?\d*)(kg|g|l|ml|un|cm|mm)\b/g, m, ult = null;
    while ((m = re.exec(norm))) ult = m;
    if (!ult) return null;
    var v = parseFloat(ult[1].replace(',', '.'));
    if (isNaN(v) || v <= 0) return null;
    var c = CONV[ult[2]];
    return { cat: c[0], val: v * c[1] };
  }

  function palavras(tokens) {
    var out = [];
    for (var i = 0; i < tokens.length; i++) if (!RE_MEDIDA_TOKEN.test(tokens[i])) out.push(tokens[i]);
    return out;
  }

  // similaridade tipo fuzz.ratio (Indel normalizado): 2*LCS/(a+b)*100
  function ratio(a, b) {
    if (a === b) return 100;
    var la = a.length, lb = b.length;
    if (!la || !lb) return 0;
    var prev = new Array(lb + 1), cur = new Array(lb + 1), i, j;
    for (j = 0; j <= lb; j++) prev[j] = 0;
    for (i = 1; i <= la; i++) {
      cur[0] = 0;
      for (j = 1; j <= lb; j++) {
        cur[j] = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? prev[j - 1] + 1 : (prev[j] > cur[j - 1] ? prev[j] : cur[j - 1]);
      }
      var t = prev; prev = cur; cur = t;
    }
    return (2 * prev[lb] / (la + lb)) * 100;
  }

  // prepara uma entrada do indice (feito 1x quando o indice carrega)
  function prepararItem(item) {
    var norm = normalizar(item.nome.replace(/\.[^.]+$/, ''));
    var toks = norm ? norm.split(' ') : [];
    item.norm = norm;
    item.toks = toks;
    item.pal = palavras(toks);
    item.medida = extrairMedida(norm);
    return item;
  }

  function prepararQuery(q) {
    var norm = normalizar(q);
    var toks = norm ? norm.split(' ') : [];
    return { norm: norm, pal: palavras(toks), medida: extrairMedida(norm) };
  }

  // sinonimos que o banco e a lista escrevem diferente
  var SINONIMOS = { macarrao: ['massa'], massa: ['macarrao'], refri: ['refrigerante', 'refr'],
                    achoc: ['achocolatado'], bisc: ['biscoito'], sab: ['sabao', 'sabonete'] };

  // quanto de UMA palavra da query aparece no candidato (0..1).
  // cand = TODOS os tokens (inclui medida: "370" digitado casa com "370g" por prefixo)
  function notaPalavra(qt, cand) {
    var melhor = notaDireta(qt, cand), sin = SINONIMOS[qt];
    if (melhor < 1 && sin) for (var s = 0; s < sin.length; s++) melhor = Math.max(melhor, notaDireta(sin[s], cand));
    return melhor;
  }

  function notaDireta(qt, cand) {
    var melhor = 0;
    for (var i = 0; i < cand.length; i++) {
      var ct = cand[i];
      if (ct === qt) return 1;
      if (qt.length >= 2 && ct.indexOf(qt) === 0) { melhor = Math.max(melhor, 0.9); continue; }
      if (qt.length >= 4 && Math.abs(qt.length - ct.length) <= 3) {
        var r = ratio(qt, ct);
        if (r >= 85) melhor = Math.max(melhor, 0.8);
        else if (r >= 70) melhor = Math.max(melhor, 0.4); // "joao" ~ "joca": so desempata
      }
    }
    return melhor;
  }

  // itens: indice preparado; opts: {pasta, limite}
  function buscar(q, itens, opts) {
    opts = opts || {};
    var limite = opts.limite || 80;
    var Q = typeof q === 'string' ? prepararQuery(q) : q;
    if (!Q.pal.length && !Q.medida) return [];
    var out = [];
    for (var i = 0; i < itens.length; i++) {
      var it = itens[i];
      if (opts.pasta && it.pasta !== opts.pasta) continue;

      // 1. filtro de medida (so se os dois tem)
      var medOk = false;
      if (Q.medida && it.medida) {
        if (it.medida.cat !== Q.medida.cat) continue;
        var diff = Math.abs(it.medida.val - Q.medida.val) / Q.medida.val;
        if (diff > 0.10) continue;
        medOk = diff < 0.001;
      }

      // 2. cobertura das palavras da query
      var cob = 1;
      if (Q.pal.length) {
        var soma = 0;
        for (var k = 0; k < Q.pal.length; k++) soma += notaPalavra(Q.pal[k], it.toks);
        cob = soma / Q.pal.length;
        if (cob < 0.5) continue;
      } else if (!it.medida) {
        continue; // query so de medida ("5kg"): so candidato com medida
      }

      // 3. score: cobertura pesa mais, ratio da string inteira desempata
      var score = cob * 70 + ratio(Q.norm, it.norm) * 0.3;
      var extras = it.pal.length - Q.pal.length;
      if (extras > 2) score -= (extras - 2) * 2;
      if (cob >= 0.99) score += 3;
      if (medOk) score += 5;
      out.push({ item: it, score: score, parecido: cob < 0.7 });
    }
    // faixa principal (cobertura >= 70%, igual ao matcher) primeiro; "parecidos" (50-70%)
    // so entram se a principal veio magra — cobre produto que o banco nao tem com esse nome
    // (ex.: "tio joao" -> mostra "tio joca")
    var fortes = [], fracos = [];
    for (var f = 0; f < out.length; f++) (out[f].parecido ? fracos : fortes).push(out[f]);
    var ord = function (a, b) { return b.score - a.score || (a.item.nome < b.item.nome ? -1 : 1); };
    fortes.sort(ord);
    if (fortes.length < 12) { fracos.sort(ord); fortes = fortes.concat(fracos); }
    if (fortes.length > limite) fortes.length = limite;
    return fortes;
  }

  var api = { normalizar: normalizar, extrairMedida: extrairMedida, ratio: ratio,
              prepararItem: prepararItem, prepararQuery: prepararQuery, buscar: buscar };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.SomadoBusca = api;
})(typeof window !== 'undefined' ? window : this);
