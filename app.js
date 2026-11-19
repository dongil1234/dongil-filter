// 필터프레스 선정·판정 — 설치형 오프라인 앱 껍데기(빌드할 때 314.0.7·["numpy", "pandas", "pyyaml", "jinja2"]가 채워진다).
// 순서: 서비스 워커(앱 파일을 휴대폰에 저장) → 앱 자료(app.bin)를 직원 비밀번호로 풀기 → 휴대폰 속 파이썬(Pyodide) 준비 → 화면.
// 화면 HTML과 엑셀은 파이썬(fpapp.offline.runtime)이 PC 앱과 같은 계산 엔진으로 만든다. 입력·결과는 휴대폰 밖으로 보내지 않는다.
// 2026-11-19: 앱에 들어오면 늘 처음 화면(홈). 입력·결과는 이번 실행 동안만 남고(앱을 나가면 지움), '입력 저장'한 것만 이 휴대폰에 남는다.
// '나가기'·맨 처음 화면에서 뒤로 가기 → '정말 나가시겠습니까?'(입력값이 지워진다는 안내) → 입력을 지우고 '닫아도 됩니다' 화면.
"use strict";
(() => {
  const PYODIDE_DIR = "pyodide/314.0.7/";
  const PACKAGES = ["numpy", "pandas", "pyyaml", "jinja2"];
  const MAGIC = "FPAPP-ENC1\n";
  const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  const $ = (id) => document.getElementById(id);
  const enc = new TextEncoder();
  // curIdx: 지금 화면이 앱을 연 뒤 몇 번째 칸인지, guarded: 뒤로 가기 지킴 칸을 뒀는지, exited: '나가기'를 했는지
  const st = { rt: null, py: null, hadController: false, lastError: "", curIdx: 0, replacing: false, guarded: false, exited: false };

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
  // ------------------------------------------------------------------ 이번 사용 중의 입력·결과(앱을 나가면 지워짐)
  // 2026-11-19 사용자 요청: 앱을 나가면 입력값을 지우고, 다시 들어오면 처음 화면(홈)부터. 그래서 최근 입력·결과는 이번 실행 동안만 남는
  // sessionStorage에 둔다(앱을 닫으면 휴대폰 브라우저가 지운다). 남겨 둘 입력은 '입력 저장'으로 이 휴대폰(localStorage)에 따로 둔다.
  const LAST = "fpapp-last", SAVED = "fpapp-saved", SAVED_MAX = 30;
  function lastGet() {
    try { return JSON.parse(sessionStorage.getItem(LAST) || "{}"); } catch (e) { return {}; }
  }
  function lastPut(v) {
    try { sessionStorage.setItem(LAST, JSON.stringify(v)); } catch (e) { /* 저장이 안 되는 환경이면 기억하지 않는다 */ }
  }
  function lastSet(mode, query, newCalc) {
    const v = lastGet();
    // 새로 계산했으면(입력·예제에서 왔거나 입력이 바뀜) 입력 화면을 다시 그 입력으로 채운다. 결과 탭으로 옛 결과를 다시 볼 때는 그대로 둔다
    if (v.fresh && (newCalc || v[mode] !== query)) delete v.fresh[mode];
    v[mode] = query;
    v.mode = mode;
    lastPut(v);
  }
  // 입력 초기화: 마지막 결과는 남기고, 입력 화면만 다음 계산 전까지 비워 둔다
  function freshSet(mode) {
    const v = lastGet();
    v.fresh = v.fresh || {};
    v.fresh[mode] = true;
    lastPut(v);
  }
  function clearSession() {
    try { sessionStorage.removeItem(LAST); } catch (e) { /* 없으면 그만 */ }
  }

  // ------------------------------------------------------------------ 뒤로 가기 기록: 칸마다 history.state.fp = 0, 1, 2…(0 = 앱을 연 칸)
  // 나갈 때 앱을 연 칸으로 돌아가 두고(안드로이드는 거기서 뒤로 가기 한 번이면 앱이 닫힘), 맨 처음 화면에서 뒤로 가면 '정말 나가시겠습니까?'를 묻는다.
  function stampIdx() {
    const s = history.state;
    if (s && typeof s.fp === "number") {
      st.curIdx = s.fp;                                             // 뒤로·앞으로 돌아온 칸
    } else {                                                        // 새 칸(링크·양식 제출) 또는 바꿔 쓴 칸(location.replace)
      st.curIdx = st.replacing ? st.curIdx : st.curIdx + 1;
      history.replaceState({ fp: st.curIdx }, "", location.href);
    }
    st.replacing = false;
  }
  function goReplace(hash) {
    if (location.hash === hash) { route(); return; }
    st.replacing = true;
    location.replace(hash);
  }
  // 앱을 연 칸(0)에서 뒤로 가기를 누르면 확인 없이 앱이 닫히므로, 처음 누를 때 같은 화면 칸(1)을 하나 더 둔다.
  // 사람이 누르지 않은 때 넣은 칸은 크롬이 뒤로 가기에서 건너뛰므로 꼭 누름·입력 순간에 넣는다.
  function armGuard() {
    if (!st.rt || st.exited || st.guarded || st.curIdx !== 0) return;
    history.pushState({ fp: 1, guard: true }, "", location.href);
    st.curIdx = 1;
    st.guarded = true;
  }
  function rearmGuard() {
    history.pushState({ fp: 1, guard: true }, "", location.href);
    st.curIdx = 1;
    st.guarded = true;
  }

  // ------------------------------------------------------------------ 확인 창(나가기·덮어쓰기·지우기)
  function ask({ title, text, ok = "확인", cancel = "취소", danger = false }) {
    return new Promise((resolve) => {
      const box = $("dialog"), okb = $("dlg-ok"), cb = $("dlg-cancel");
      $("dlg-title").textContent = title;
      $("dlg-text").textContent = text;
      okb.textContent = ok;
      cb.textContent = cancel;
      okb.classList.toggle("danger", danger);
      const done = (v) => {
        box.hidden = true;
        okb.onclick = cb.onclick = box.onclick = null;
        resolve(v);
      };
      okb.onclick = () => done(true);
      cb.onclick = () => done(false);
      box.onclick = (e) => { if (e.target === box) done(false); };      // 바깥을 누르면 취소
      box.hidden = false;
      setTimeout(() => cb.focus(), 30);
    });
  }
  const askExit = () => ask({
    title: "정말 나가시겠습니까?",
    text: "나가면 지금까지 넣은 입력값과 계산 결과가 지워집니다.\n남겨 두려면 ‘취소’를 누르고 설계·판정 입력 화면의 ‘입력 저장’을 먼저 누르세요.",
    ok: "나가기", cancel: "취소", danger: true,
  });

  // ------------------------------------------------------------------ 나가기: 입력값을 지우고 '닫아도 됩니다' 화면
  // 웹앱은 스스로 창을 닫을 수 없어(안드로이드·아이폰 공통) 앱을 연 칸으로 돌아가 안내만 한다.
  function leave() {
    clearSession();
    st.exited = true;
    st.guarded = false;
    $("toast").hidden = true;
    const back = st.curIdx;
    if (back > 0) history.go(-back);                                  // 돌아가면 popstate·route가 안내 화면을 그린다
    else renderBye();
    try { if (history.length <= 1) window.close(); } catch (e) { /* 닫을 수 없는 창이면 안내 화면만 */ }
  }
  function renderBye() {
    busy(false);
    $("app").innerHTML =
      '<header class="appbar"><div class="row"><img class="logo" src="logo.png" alt="DONGIL"><span class="title">필터프레스 선정·판정</span></div></header>' +
      '<main><section class="card bye"><h2>입력값을 지웠습니다</h2>' +
      '<p>이제 앱을 닫아도 됩니다. 안드로이드는 뒤로 가기를 한 번 더 누르면 닫히고, 아이폰은 화면 아래 가장자리를 위로 쓸어 올려 나가세요.</p>' +
      '<p class="muted small">‘입력 저장’으로 남긴 입력은 이 휴대폰에 그대로 있어 다음에 ‘불러오기’로 열 수 있습니다.</p>' +
      '<button class="btn primary block" type="button" data-restart>처음 화면으로</button></section></main>';
    document.title = "필터프레스 선정·판정";
    window.scrollTo(0, 0);
  }
  function restart() {
    st.exited = false;
    history.replaceState({ fp: st.curIdx, root: st.curIdx === 0 }, "", location.pathname + location.search + "#/home");
    route();
  }

  // ------------------------------------------------------------------ 입력 저장·불러오기(이 휴대폰에만 — 앱을 나가도 남는다)
  function savedGet() {
    try { return JSON.parse(localStorage.getItem(SAVED) || "{}"); } catch (e) { return {}; }
  }
  function savedPut(v) {
    try { localStorage.setItem(SAVED, JSON.stringify(v)); return true; } catch (e) { return false; }
  }
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  function stamp(d) {
    const p = (n) => String(n).padStart(2, "0");
    return isNaN(d) ? "" : `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
  }
  async function saveInputs(btn) {
    const form = btn.closest("form");
    if (!form) return;
    const mode = btn.dataset.save === "judge" ? "judge" : "design";
    const q = new URLSearchParams(new FormData(form)).toString();
    const proj = ((form.elements.project && form.elements.project.value) || "").trim();
    const name = proj || `이름 없음 ${stamp(new Date()).slice(5)}`;     // 프로젝트 이름이 없으면 저장 시각으로 구별
    const all = savedGet();
    const list = Array.isArray(all[mode]) ? all[mode] : [];
    const i = list.findIndex((x) => x.name === name);
    if (i >= 0 && !(await ask({ title: "같은 이름으로 저장한 입력이 있습니다", text: `‘${name}’을(를) 지금 입력으로 바꿀까요?`, ok: "바꾸기" }))) return;
    if (i >= 0) list.splice(i, 1);
    list.unshift({ name, at: new Date().toISOString(), q });
    all[mode] = list.slice(0, SAVED_MAX);
    if (!savedPut(all)) {
      toast("저장하지 못했습니다. 휴대폰 저장 공간을 확인해 주세요.");
      return;
    }
    toast(`입력을 저장했습니다 — ${name}. 다음에 ‘불러오기’로 엽니다.`);
  }
  function openSaved(mode) {
    const list = savedGet()[mode] || [];
    $("sheet-title").textContent = mode === "judge" ? "저장한 판정 입력" : "저장한 설계 입력";
    $("sheet-list").innerHTML = list.length
      ? list.map((x, i) => `<li><div class="nm"><b>${esc(x.name)}</b><span>${esc(stamp(new Date(x.at)))}</span></div>` +
          `<div class="sb"><button type="button" data-pick="${i}">불러오기</button><button type="button" class="del" data-del="${i}">지우기</button></div></li>`).join("")
      : '<li class="empty">저장한 입력이 없습니다. 입력 화면 아래 ‘입력 저장’을 누르면 여기에 남습니다.</li>';
    $("sheet").dataset.mode = mode;
    $("sheet").hidden = false;
  }
  $("sheet").addEventListener("click", async (e) => {
    const t = e.target;
    const mode = $("sheet").dataset.mode === "judge" ? "judge" : "design";
    if (t === $("sheet") || t.closest("#sheet-close")) {
      $("sheet").hidden = true;
      return;
    }
    const pick = t.closest("[data-pick]"), del = t.closest("[data-del]");
    const all = savedGet();
    const list = all[mode] || [];
    if (pick) {
      const x = list[Number(pick.dataset.pick)];
      $("sheet").hidden = true;
      if (!x) return;
      const target = "#/" + mode + "?" + x.q;
      if (location.hash === target) route();
      else location.hash = target;
      toast(`‘${x.name}’ 입력을 불러왔습니다.`);
    } else if (del) {
      const i = Number(del.dataset.del), x = list[i];
      if (x && await ask({ title: "저장한 입력 지우기", text: `‘${x.name}’을(를) 지울까요? 되돌릴 수 없습니다.`, ok: "지우기", danger: true })) {
        list.splice(i, 1);
        all[mode] = list;
        savedPut(all);
        openSaved(mode);
      }
    }
  });

  async function route() {
    if (!st.rt) return;
    if (st.exited) {                                                 // 나간 뒤에는 뒤로 가기로 옛 화면(주소에 남은 입력)이 다시 보이지 않게
      renderBye();
      return;
    }
    stampIdx();
    let { path, query } = parseHash();
    const last = lastGet();
    if (path === "/") {                                             // 결과 탭: 이번 실행에서 마지막으로 본 결과로
      if (last.mode && last[last.mode]) {
        goReplace("#/dash?" + last[last.mode]);
      } else {
        goReplace("#/home");
        toast("아직 계산한 결과가 없습니다. 설계·판정에서 계산하면 ‘결과’에 나옵니다.");
      }
      return;
    }
    if (path === "/switch") {                                       // 설계 ↔ 판정 전환
      const mode = new URLSearchParams(query).get("mode") === "judge" ? "judge" : "design";
      goReplace(last[mode] ? "#/dash?" + last[mode] : "#/" + mode);
      return;
    }
    if (path === "/design" || path === "/judge") {
      const mode = path.slice(1);
      if (new URLSearchParams(query).has("fresh")) {                // 입력 초기화 → 빈 입력 화면
        freshSet(mode);
        query = "";
        history.replaceState({ fp: st.curIdx }, "", "#" + path);    // 주소에 남기지 않는다(뒤로 가기·새로고침에 다시 지우지 않게)
      } else if (!query && last[mode] && !(last.fresh && last.fresh[mode])) {
        query = last[mode];                                         // 입력 화면은 이번 실행의 최근 입력으로 채운다
      }
    }
    if (path === "/logout") {
      if (await ask({ title: "이 휴대폰에서 잠글까요?", text: "다시 열려면 직원 비밀번호가 필요합니다. 넣은 입력값도 지워집니다(‘입력 저장’으로 남긴 입력은 남습니다).",
                      ok: "잠그기", danger: true })) {
        await kv("del", "keys");
        clearSession();
        location.replace(location.pathname + location.search);   // 주소 끝(#…)을 지우고 처음부터 다시 연다
      } else {
        history.back();
      }
      return;
    }
    if (path.endsWith(".xlsx")) {           // 엑셀 주소로 바로 들어오면 결과 화면으로
      goReplace("#" + path.slice(0, -5) + (query ? "?" + query : ""));
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
    // 결과 화면 경고의 '입력창' 단추(#/design?…&goto=칸 이름) → 그 칸으로 내려가 깜빡임(dash.js)
    const goto = (path === "/design" || path === "/judge") ? new URLSearchParams(query).get("goto") : null;
    if (goto && window.fpGotoField) window.fpGotoField(goto);
  }

  document.addEventListener("change", (e) => { if (e.target && e.target.type === "radio") syncWhen(); });
  // 입력 양식 제출·예제 결과 단추 = 새 계산(입력 초기화 표시를 푼다)
  document.addEventListener("click", (e) => {
    if (e.target && e.target.closest && e.target.closest('#app a[href^="#/dash?"]')) st.newCalc = true;
  });
  // 처음 누르는 순간 뒤로 가기 지킴 칸을 둔다(위 armGuard). 누른 것이 링크면 그 이동은 지킴 칸 다음에 쌓인다
  document.addEventListener("click", armGuard, true);
  document.addEventListener("keydown", armGuard, true);
  // 나가기·입력 저장·불러오기·처음 화면으로
  document.addEventListener("click", (e) => {
    const t = e.target && e.target.closest ? e.target : null;
    if (!t) return;
    if (t.closest("#app [data-exit]")) {
      e.preventDefault();
      askExit().then((ok) => { if (ok) leave(); });
      return;
    }
    const sv = t.closest("#app [data-save]");
    if (sv) {
      e.preventDefault();
      saveInputs(sv);
      return;
    }
    const ld = t.closest("#app [data-load]");
    if (ld) {
      e.preventDefault();
      openSaved(ld.dataset.load === "judge" ? "judge" : "design");
      return;
    }
    if (t.closest("#app [data-restart]")) {
      e.preventDefault();
      restart();
    }
  });
  // 뒤로 가기로 앱을 연 칸(0)까지 오면 = 앱을 나가려는 것 → 확인 창. 취소하면 지킴 칸을 다시 둔다(취소 누름이 사용자 조작)
  window.addEventListener("popstate", (e) => {
    const s = e.state;
    if (!st.rt || !s || s.fp !== 0) return;
    st.curIdx = 0;
    if (st.exited) {
      renderBye();
      return;
    }
    if (!st.guarded) return;                                         // 지킴 칸을 둔 적이 없으면(앱을 열고 아무것도 안 함) 그대로
    st.guarded = false;
    askExit().then((ok) => {
      if (ok) leave();
      else rearmGuard();
    });
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
    try { localStorage.removeItem(LAST); } catch (e) { /* 예전 판이 이 휴대폰에 남긴 최근 입력 — 이제는 앱을 나가면 지운다 */ }
    // 앱에 들어오면 늘 처음 화면(홈)부터(2026-11-19). 이 칸이 앱을 연 칸(fp 0)이다
    history.replaceState({ fp: 0, root: true }, "", location.pathname + location.search + "#/home");
    st.curIdx = 0;
    $("boot").hidden = true;
    $("app").hidden = false;
    route();
  }
  main().catch((e) => {
    console.error(e);
    fail("앱을 열지 못했습니다.", String((e && e.message) || e));
  });
})();
