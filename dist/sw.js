// Service worker do Somado Tarefas.
//
// Ele NÃO é offline: sem internet o app não abre, e isso é de propósito —
// tudo aqui vem do Supabase, e sincronizar edição feita offline seria outro
// projeto. O que ele faz é o mínimo pra o app ser instalável e pra o casco
// (JS, CSS, ícones) não descer de novo a cada abertura.
//
// Regra geral: só GET, e nada de HTML nem de /api no cache. Tela e dados vêm
// sempre da rede, senão o app abriria mostrando tarefa que já mudou.

const VERSAO = "v1";
const CACHE_ESTATICO = `smd-tarefas-estatico-${VERSAO}`;

self.addEventListener("install", (event) => {
  // Assume o controle já na primeira carga, sem esperar a aba fechar.
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const nomes = await caches.keys();
      await Promise.all(
        nomes
          .filter((n) => n.startsWith("smd-tarefas-") && n !== CACHE_ESTATICO)
          .map((n) => caches.delete(n)),
      );
      await self.clients.claim();
    })(),
  );
});

function ehEstatico(url) {
  return (
    url.pathname.startsWith("/_next/static/") ||
    url.pathname.startsWith("/icons/") ||
    url.pathname === "/favicon.ico"
  );
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (!ehEstatico(url)) return; // navegação e /api seguem direto pra rede

  // Arquivo estático do Next tem hash no nome: se está no cache, é o mesmo
  // arquivo. Responde do cache e guarda o que ainda não tem.
  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE_ESTATICO);
      const guardado = await cache.match(req);
      if (guardado) return guardado;

      const resposta = await fetch(req);
      if (resposta.ok) cache.put(req, resposta.clone());
      return resposta;
    })(),
  );
});

// ---------------------------------------------------------------------
// Push: a notificação que chega com o app fechado.
// O servidor manda o corpo pronto (lib/push/enviar.ts). Aqui é só mostrar.
// ---------------------------------------------------------------------
self.addEventListener("push", (event) => {
  let dados = {};
  try {
    dados = event.data ? event.data.json() : {};
  } catch {
    dados = {};
  }

  const titulo = dados.titulo || "Somado Tarefas";
  event.waitUntil(
    self.registration.showNotification(titulo, {
      body: dados.texto || "",
      icon: "/icons/icon-192.png",
      badge: "/icons/icon-192.png",
      // A mesma tag substitui a notificação anterior em vez de empilhar.
      tag: dados.tag || undefined,
      data: { url: dados.url || "/inbox" },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const destino = (event.notification.data && event.notification.data.url) || "/inbox";

  event.waitUntil(
    (async () => {
      const abas = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });
      // Se o app já está aberto, aproveita a janela em vez de abrir outra.
      for (const aba of abas) {
        if (new URL(aba.url).origin === self.location.origin) {
          await aba.focus();
          return aba.navigate(destino);
        }
      }
      return self.clients.openWindow(destino);
    })(),
  );
});
