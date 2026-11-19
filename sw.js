// 필터프레스 선정·판정 — 설치형 오프라인 앱 서비스 워커(빌드할 때 판 번호·파일 목록이 채워진다).
// 앱 파일 전부를 휴대폰에 저장하고 그다음부터는 저장본으로 연다(인터넷 없이). 웹 공간에 새 판을 올리면 다음에 열 때 바꿔 받는다.
const VERSION = "33d0d94d22e7";
// 저장소 이름은 앱 주소 경로(예: /dongil-filter/)로 나눈다 — 같은 도메인(<조직>.github.io)에 앱이 여럿 있어도 서로의 저장본을 지우지 않게
const SCOPE = new URL(self.registration.scope).pathname;
const PREFIX = "fpapp-phone:" + SCOPE + ":";
const CACHE = PREFIX + VERSION;
const FILES = ["app.bin", "app.css", "app.js", "apple-touch-icon.png", "dash.css", "dash.js", "icon-192.png", "icon-512.png", "icon-maskable-512.png", "index.html", "logo.png", "manifest.webmanifest", "pyodide/314.0.7/jinja2-3.1.6-py3-none-any.whl", "pyodide/314.0.7/markupsafe-3.0.3-cp314-cp314-pyemscripten_2026_0_wasm32.whl", "pyodide/314.0.7/numpy-2.4.6-cp314-cp314-pyemscripten_2026_0_wasm32.whl", "pyodide/314.0.7/pandas-3.0.2-cp314-cp314-pyemscripten_2026_0_wasm32.whl", "pyodide/314.0.7/pyodide-lock.json", "pyodide/314.0.7/pyodide.asm.mjs", "pyodide/314.0.7/pyodide.asm.wasm", "pyodide/314.0.7/pyodide.js", "pyodide/314.0.7/python_dateutil-2.9.0.post0-py2.py3-none-any.whl", "pyodide/314.0.7/python_stdlib.zip", "pyodide/314.0.7/pytz-2026.1.post1-py2.py3-none-any.whl", "pyodide/314.0.7/pyyaml-6.0.3-cp314-cp314-pyemscripten_2026_0_wasm32.whl", "pyodide/314.0.7/six-1.17.0-py2.py3-none-any.whl", "shell.css"];
const REUSE = "pyodide/";     // pyodide/<판>/… 는 이름이 같으면 내용도 같다 → 이전 판 저장본을 다시 쓴다(20 MB를 다시 받지 않게)

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    let done = 0;
    const tell = async () => {
      const cs = await self.clients.matchAll({ includeUncontrolled: true, type: "window" });
      cs.forEach((c) => c.postMessage({ type: "progress", done, total: FILES.length }));
    };
    const queue = FILES.slice();
    const worker = async () => {
      while (queue.length) {
        const f = queue.shift();
        let res = f.startsWith(REUSE) ? await caches.match(f) : undefined;
        if (!res) {
          res = await fetch(new Request(f, { cache: "reload" }));
          if (!res.ok) throw new Error(`${f}: ${res.status}`);
        }
        await cache.put(f, res);
        done += 1;
        tell();
      }
    };
    await Promise.all([worker(), worker(), worker(), worker()]);
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    for (const k of await caches.keys()) {
      if (k.startsWith(PREFIX) && k !== CACHE) {
        await caches.delete(k);                                   // 같은 앱 주소의 예전 판
      } else if (/^fpapp-phone-[0-9a-f]+$/.test(k)) {              // 첫 판(경로 없는 이름): 이 앱 주소의 것이 들어 있으면 지운다
        const reqs = await (await caches.open(k)).keys();
        if (reqs.some((r) => new URL(r.url).pathname.startsWith(SCOPE))) await caches.delete(k);
      }
    }
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const hit = await cache.match(req, { ignoreSearch: true });
    if (hit) return hit;
    if (req.mode === "navigate") {
      const page = await cache.match("index.html");
      if (page) return page;
    }
    return fetch(req);
  })());
});
