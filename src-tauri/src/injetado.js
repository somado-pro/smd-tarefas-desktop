// Roda dentro da janela do Somado Tarefas (só no programa da bandeja).
// De 30 em 30 s pergunta ao site o que chegou e repassa pro Windows:
// número de não lidas no ícone e notificação nativa pra cada nova.
(function () {
  if (window.top !== window || location.origin !== "https://tarefas.somado.com.br") return;
  if (window.__smdBandeja) return;
  window.__smdBandeja = true;

  var CHAVE = "smd:bandeja:desde";
  var invoke = function (cmd, args) {
    var t = window.__TAURI_INTERNALS__;
    return t ? t.invoke(cmd, args).catch(function () {}) : Promise.resolve();
  };

  function ler(chave) {
    try { return localStorage.getItem(chave); } catch (e) { return null; }
  }
  function gravar(chave, valor) {
    try { localStorage.setItem(chave, valor); } catch (e) {}
  }

  async function consultar() {
    if (location.pathname.indexOf("/login") === 0) return;
    var desde = ler(CHAVE);
    try {
      var r = await fetch(
        "/api/desktop/notificacoes" + (desde ? "?desde=" + encodeURIComponent(desde) : ""),
        { credentials: "same-origin", cache: "no-store" },
      );
      if (!r.ok || (r.headers.get("content-type") || "").indexOf("json") < 0) return;
      var d = await r.json();
      gravar(CHAVE, d.agora);
      invoke("smd_nao_lidas", { n: d.naoLidas || 0 });
      (d.novas || []).forEach(function (n) {
        invoke("smd_notificar", { titulo: n.titulo, corpo: n.corpo || "", url: n.url });
      });
    } catch (e) {}
  }

  setTimeout(consultar, 3000);
  setInterval(consultar, 30000);
})();
