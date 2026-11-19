// 필터프레스 선정·판정 — 설치형 오프라인 앱 껍데기(빌드할 때 314.0.7·["numpy", "pandas", "pyyaml", "jinja2"]가 채워진다).
// 순서: 서비스 워커(앱 파일을 휴대폰에 저장) → 앱 자료(app.bin)를 직원 비밀번호로 풀기 → 휴대폰 속 파이썬(Pyodide) 준비 → 화면.
// 화면 HTML과 엑셀은 파이썬(fpapp.offline.runtime)이 PC 앱과 같은 계산 엔진으로 만든다. 입력·결과는 휴대폰 밖으로 보내지 않는다.
"use strict";
(() => {
  const PYODIDE_DIR = "pyodide/314.0.7/";
  const PACKAGES = ["numpy", "pandas", "pyyaml", "jinja2"];
  const MAGIC = "FPAPP-ENC1\n";
  const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  const $ = (id) => document.getElementById(id);
  const enc = new TextEncoder();
  const st = { rt: null, py: null, hadController: false, lastError: "" };

  // ------------------------------------------------------------------ 표시
  function status(text, frac, hint) {
    $("status").hidden = false;
    $("status-text").textContent = text;
    if (typeof frac === "number") $("progress-bar").style.width = Math.max(4, Math.min(100, frac * 100)).toFixed(0) + "%";
    if (hint !== undefined) $("status-hint").textContent = hint;
  }
  function fail(text, hint) {
    status(text, 1, hint || "");
    $("progress-bar").style.background = "var(--bad)";
  }
  function busy(on, text) {
    $("busy-text").textContent = text || "계산 중…";
    $("busy").hidden = !on;
  }
  function toast(text, btnText, onClick, ms) {
    $("toast-text").textContent = text;
    const b = $("toast-btn");
    b.hidden = !btnText;
    b.textContent = btnText || "";
    b.onclick = onClick || null;
    $("toast").hidden = false;
    clearTimeout(toast.t);
    if (ms !== 0) toast.t = setTimeout(() => { $("toast").hidden = true; }, ms || 4000);
  }
  // 화면에 '계산 중'을 먼저 그린 뒤 계산한다. 화면 갱신이 멈춘 경우(앱이 뒤로 가 있음 등)에도 60ms 뒤에는 넘어간다.
  const frame = () => new Promise((r) => {
    let done = false;
    const go = () => { if (!done) { done = true; setTimeout(r, 0); } };
    requestAnimationFrame(go);
    setTimeout(go, 60);
  });

  // ------------------------------------------------------------------ 이 휴대폰에 열쇠 기억(IndexedDB — 꺼내 볼 수 없는 키 객체로 저장)
  function idb() {
    return new Promise((res, rej) => {
      const r = indexedDB.open("fpapp-phone", 1);
      r.onupgradeneeded = () => r.result.createObjectStore("kv");
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
  }
  async function kv(mode, key, value) {
    try {
      const db = await idb();
      return await new Promise((res, rej) => {
        const tx = db.transaction("kv", mode === "get" ? "readonly" : "readwrite");
        const s = tx.objectStore("kv");
        const q = mode === "get" ? s.get(key) : mode === "put" ? s.put(value, key) : s.delete(key);
        tx.oncomplete = () => res(q.result);
        tx.onerror = () => rej(tx.error);
      });
    } catch (e) {
      return undefined;
    }
  }

  // ------------------------------------------------------------------ 서비스 워커(오프라인 저장·새 판 받기)
  async function setupSW() {
    if (!("serviceWorker" in navigator)) return false;
    let reg;
    try {
      reg = await navigator.serviceWorker.register("sw.js");
    } catch (e) {
      return false;
    }
    st.hadController = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.addEventListener("message", (e) => {
      const d = e.data || {};
      if (d.type === "progress" && !st.rt) status(`앱 파일을 휴대폰에 저장하는 중… ${d.done}/${d.total}`, 0.05 + 0.5 * (d.done / d.total));
    });
    reg.addEventListener("updatefound", () => {
      const w = reg.installing;
      if (!w || !st.hadController) return;
      w.addEventListener("statechange", () => {
        if (w.state === "activated") toast("새 판을 받았습니다. 다시 열면 적용됩니다.", "지금 적용", () => location.reload(), 0);
      });
    });
    if (st.hadController) {
      reg.update().catch(() => {});
      return true;
    }
    if (reg.active && !reg.installing && !reg.waiting) return false;      // 강제 새로고침 등: 이번에는 저장본 없이 연다
    // 처음 여는 경우: 파일을 모두 저장하고 이 화면을 맡을 때까지 기다린다(같은 파일을 두 번 받지 않게)
    status("앱 파일을 휴대폰에 저장하는 중…", 0.05);
    await new Promise((res) => {
      navigator.serviceWorker.addEventListener("controllerchange", res, { once: true });
      const w = reg.installing || reg.waiting;
      if (w) w.addEventListener("statechange", () => { if (w.state === "redundant") res(); });
      setTimeout(res, 240000);
    });
    return !!navigator.serviceWorker.controller;
  }

  // ------------------------------------------------------------------ 앱 자료 풀기(PBKDF2-SHA256 → HMAC-SHA256 확인 → AES-256-CTR)
  const b64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
  function parseBlob(buf) {
    const u8 = new Uint8Array(buf);
    const m = enc.encode(MAGIC);
    if (u8.length < m.length + 36 || m.some((x, i) => u8[i] !== x)) throw new Error("앱 자료 파일(app.bin)이 올바르지 않습니다.");
    const n = new DataView(u8.buffer, u8.byteOffset + m.length, 4).getUint32(0, false);
    const start = m.length + 4 + n;
    const head = JSON.parse(new TextDecoder().decode(u8.subarray(m.length + 4, start)));
    return { u8, head, start, end: u8.length - 32 };
  }
  async function deriveKeys(code, head) {
    const base = await crypto.subtle.importKey("raw", enc.encode(code.normalize("NFC")), "PBKDF2", false, ["deriveBits"]);
    const bits = new Uint8Array(await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: b64(head.salt), iterations: head.iter }, base, 512));
    const keys = {
      salt: head.salt,
      enc: await crypto.subtle.importKey("raw", bits.slice(0, 32), { name: "AES-CTR" }, false, ["decrypt"]),
      mac: await crypto.subtle.importKey("raw", bits.slice(32), { name: "HMAC", hash: "SHA-256" }, false, ["verify"]),
    };
    bits.fill(0);
    return keys;
  }
  async function openBlob(b, keys) {
    const ok = await crypto.subtle.verify("HMAC", keys.mac, b.u8.subarray(b.end), b.u8.subarray(0, b.end));
    if (!ok) return null;
    const plain = await crypto.subtle.decrypt({ name: "AES-CTR", counter: b64(b.head.iv), length: 128 }, keys.enc, b.u8.subarray(b.start, b.end));
    return new Uint8Array(plain);
  }
  function askCode(b, changed) {
    $("lock").hidden = false;
    status("직원 비밀번호를 넣어 주세요.", 0.6, "그동안 계산 엔진을 미리 준비합니다.");
    const msg = $("lock-msg");
    if (changed) {
      msg.textContent = "비밀번호가 바뀌었습니다. 새 비밀번호를 넣어 주세요.";
      msg.hidden = false;
    }
    setTimeout(() => $("code").focus(), 50);
    return new Promise((resolve) => {
      $("lock-form").onsubmit = async (e) => {
        e.preventDefault();
        const code = $("code").value;
        if (!code) return;
        const btn = $("lock-btn");
        btn.disabled = true;
        btn.textContent = "확인 중…";
        let plain = null;
        try {
          const keys = await deriveKeys(code, b.head);
          plain = await openBlob(b, keys);
          if (plain) await kv("put", "keys", keys);
        } catch (err) {
          plain = null;
        }
        btn.disabled = false;
        btn.textContent = "열기";
        if (!plain) {
          msg.textContent = "비밀번호가 맞지 않습니다.";
          msg.hidden = false;
          $("code").select();
          return;
        }
        $("code").value = "";
        $("lock").hidden = true;
        resolve(plain);
      };
    });
  }

  // ------------------------------------------------------------------ 휴대폰 속 파이썬
  async function startPython() {
    const py = await loadPyodide({ indexURL: new URL(PYODIDE_DIR, location.href).href });
    await py.loadPackage(PACKAGES, { messageCallback: () => {} });
    return py;
  }

  // ------------------------------------------------------------------ 화면 이동(#/design?…)
  function parseHash() {
    const h = location.hash.slice(1) || "/";
    const i = h.indexOf("?");
    return { path: i < 0 ? h : h.slice(0, i), query: i < 0 ? "" : h.slice(i + 1) };
  }
  function syncWhen() {
    document.querySelectorAll("#app [data-when]").forEach((el) => {
      const [k, v] = el.dataset.when.split("=");
      const r = document.querySelector(`#app input[name="${k}"]:checked`);
      el.style.display = r && v.split("|").includes(r.value) ? "" : "none";     // data-when="md_mode=flow|ww"
    });
  }
  // 최근 결과(설계·판정 입력)를 이 휴대폰에 기억 — 대시보드 탭·설계/판정 전환·입력 화면 채우기에 쓴다
  function lastGet() {
    try { return JSON.parse(localStorage.getItem("fpapp-last") || "{}"); } catch (e) { return {}; }
  }
  function lastSet(mode, query, newCalc) {
    try {
      const v = lastGet();
      // 새로 계산했으면(입력·예제에서 왔거나 입력이 바뀜) 입력 화면을 다시 그 입력으로 채운다. 대시보드 탭으로 옛 결과를 다시 볼 때는 그대로 둔다
      if (v.fresh && (newCalc || v[mode] !== query)) delete v.fresh[mode];
      v[mode] = query;
      v.mode = mode;
      localStorage.setItem("fpapp-last", JSON.stringify(v));
    } catch (e) { /* 저장이 안 되는 환경이면 기억하지 않는다 */ }
  }
  // 입력 초기화: 마지막 결과(대시보드)는 남기고, 입력 화면만 다음 계산 전까지 비워 둔다
  function freshSet(mode) {
    try {
      const v = lastGet();
      v.fresh = v.fresh || {};
      v.fresh[mode] = true;
      localStorage.setItem("fpapp-last", JSON.stringify(v));
    } catch (e) { /* 저장이 안 되면 이번 화면만 비운다 */ }
  }

  async function route() {
    if (!st.rt) return;
    let { path, query } = parseHash();
    const last = lastGet();
    if (path === "/" && last.mode && last[last.mode]) {             // 대시보드 탭: 최근 결과로
      location.replace("#/dash?" + last[last.mode]);
      return;
    }
    if (path === "/switch") {                                       // 설계 ↔ 판정 전환
      const mode = new URLSearchParams(query).get("mode") === "judge" ? "judge" : "design";
      location.replace(last[mode] ? "#/dash?" + last[mode] : "#/" + mode);
      return;
    }
    if (path === "/design" || path === "/judge") {
      const mode = path.slice(1);
      if (new URLSearchParams(query).has("fresh")) {                // 입력 초기화 → 빈 입력 화면
        freshSet(mode);
        query = "";
        history.replaceState(null, "", "#" + path);                 // 주소에 남기지 않는다(뒤로 가기·새로고침에 다시 지우지 않게)
      } else if (!query && last[mode] && !(last.fresh && last.fresh[mode])) {
        query = last[mode];                                         // 입력 화면은 최근 입력으로 채운다
      }
    }
    if (path === "/logout") {
      if (confirm("이 휴대폰에서 잠글까요? 다시 열려면 직원 비밀번호가 필요합니다.")) {
        await kv("del", "keys");
        location.replace(location.pathname + location.search);   // 주소 끝(#…)을 지우고 처음부터 다시 연다
      } else {
        history.back();
      }
      return;
    }
    if (path.endsWith(".xlsx")) {           // 엑셀 주소로 바로 들어오면 결과 화면으로
      location.replace("#" + path.slice(0, -5) + (query ? "?" + query : ""));
      return;
    }
    if (query) {
      busy(true, path === "/judge" ? "판정 중…" : "계산 중…");
      await frame();
    }
    let html;
    try {
      html = st.rt.render(path, query);
      st.lastError = "";
    } catch (e) {
      console.error(e);
      st.lastError = String((e && e.message) || e);
      html = '<header class="appbar"><div class="row"><a class="back" href="#/home" aria-label="처음 화면으로">‹</a><span class="title">오류</span></div></header><main><section class="card">' +
        '<h2>계산하지 못했습니다</h2><p class="muted">입력을 확인해 주세요. 계속되면 관리자에게 아래 내용을 보내 주세요.</p><pre class="err"></pre></section></main>';
    }
    busy(false);
    const app = $("app");
    app.innerHTML = html;
    const pre = app.querySelector("pre.err");
    if (pre) pre.textContent = st.lastError;
    const t = app.querySelector("title-holder");
    document.title = t ? t.dataset.title : "필터프레스 선정·판정";
    if (path === "/dash" && app.querySelector(".fpd")) {
      const mode = new URLSearchParams(query).get("mode") === "judge" ? "judge" : "design";
      lastSet(mode, query, st.newCalc);
    }
    st.newCalc = false;
    syncWhen();
    window.scrollTo(0, 0);
    // 대시보드 경고의 '입력창' 단추(#/design?…&goto=칸 이름) → 그 칸으로 내려가 깜빡임(dash.js)
    const goto = (path === "/design" || path === "/judge") ? new URLSearchParams(query).get("goto") : null;
    if (goto && window.fpGotoField) window.fpGotoField(goto);
  }

  document.addEventListener("change", (e) => { if (e.target && e.target.type === "radio") syncWhen(); });
  // 입력 양식 제출·예제 결과 단추 = 새 계산(입력 초기화 표시를 푼다)
  document.addEventListener("click", (e) => {
    if (e.target && e.target.closest && e.target.closest('#app a[href^="#/dash?"]')) st.newCalc = true;
  });
  document.addEventListener("submit", (e) => {
    const f = e.target;
    if (!f.closest || !f.closest("#app")) return;
    e.preventDefault();
    st.newCalc = true;
    const qs = new URLSearchParams(new FormData(f)).toString();
    const target = (f.getAttribute("action") || "#/") + (qs ? "?" + qs : "");
    if (location.hash === target) route();
    else location.hash = target;
  });

  // ------------------------------------------------------------------ 엑셀(휴대폰 안에서 만들어 공유·저장)
  async function deliver(file) {
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: file.name });
        return;
      } catch (err) {
        if (err && err.name === "AbortError") return;
      }
    }
    const url = URL.createObjectURL(file);
    const link = document.createElement("a");
    link.href = url;
    link.download = file.name;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }
  function makeExcel(kind, query) {
    const p = st.rt.excel(kind, query);
    try {
      const [bytes, name] = p.toJs();
      return new File([bytes], name, { type: XLSX });
    } finally {
      p.destroy();
    }
  }
  document.addEventListener("click", async (e) => {
    const a = e.target && e.target.closest && e.target.closest("#app a[data-xlsx]");
    if (!a) return;
    e.preventDefault();
    if (a._file) {
      deliver(a._file);
      return;
    }
    const t0 = performance.now();
    busy(true, "엑셀 만드는 중…");
    await frame();
    try {
      a._file = makeExcel(a.dataset.xlsx, a.getAttribute("href").split("?")[1] || "");
    } catch (err) {
      busy(false);
      console.error(err);
      toast("엑셀을 만들지 못했습니다.");
      return;
    }
    busy(false);
    if (performance.now() - t0 < 800) {
      deliver(a._file);
      return;
    }
    a.classList.add("ready");                // 오래 걸리면 한 번 더 눌러야 공유 창이 열린다(휴대폰 보안 규칙)
    a.textContent = "엑셀 준비됨 — 눌러서 저장·공유";
  });

  window.addEventListener("hashchange", route);

  // ------------------------------------------------------------------ 시작
  async function main() {
    if (!window.isSecureContext || !(window.crypto && crypto.subtle)) {
      fail("이 주소에서는 열 수 없습니다.", "https:// 로 시작하는 주소로 열어 주세요.");
      return;
    }
    await setupSW();
    status("앱 자료를 여는 중…", 0.58, "");
    const pyP = startPython();               // 비밀번호를 넣는 동안 파이썬을 미리 준비
    pyP.catch(() => {});
    let b;
    try {
      const r = await fetch("app.bin");
      if (!r.ok) throw new Error(`app.bin ${r.status}`);
      b = parseBlob(await r.arrayBuffer());
    } catch (e) {
      fail("앱 자료를 읽지 못했습니다.", navigator.onLine ? String((e && e.message) || e) : "처음 한 번은 인터넷에 연결된 상태에서 열어야 합니다.");
      return;
    }
    let plain = null;
    const saved = await kv("get", "keys");
    if (saved && saved.salt === b.head.salt) plain = await openBlob(b, saved).catch(() => null);
    if (!plain) plain = await askCode(b, !!saved && saved.salt !== b.head.salt);
    status("계산 엔진을 준비하는 중…", 0.85, "휴대폰 안에서 계산합니다. 몇 초 걸립니다.");
    let py;
    try {
      py = await pyP;
    } catch (e) {
      fail("계산 엔진을 열지 못했습니다.", String((e && e.message) || e));
      return;
    }
    py.unpackArchive(plain, "zip", { extractDir: "/app" });
    plain.fill(0);
    py.runPython("import sys\nif '/app' not in sys.path:\n    sys.path.insert(0, '/app')");
    const rt = py.pyimport("fpapp.offline.runtime");
    rt.init("/app/data");
    st.py = py;
    st.rt = rt;
    $("boot").hidden = true;
    $("app").hidden = false;
    route();
  }
  main().catch((e) => {
    console.error(e);
    fail("앱을 열지 못했습니다.", String((e && e.message) || e));
  });
})();
