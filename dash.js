// 결과 대시보드 동작(휴대폰 앱·사내 서버판·PC 앱 공통): 모두 펼치기, 원 단추 → 해당 카드 펼치고 이동,
// (PC 앱 안에서만) ‘입력 고치기’ → 화면의 ‘입력’ 탭으로, ‘엑셀 받기’ → 화면 아래의 내려받기 단추를 대신 누름.
// 경고·판정 항목의 ‘입력창’ 단추(2026-11-19) → 그 입력 칸으로 바로 가서 잠깐 주황 테로 알려 준다.

// ---------------------------------------------------------------- 입력창 바로 가기
// 예전 판 스크립트가 이미 붙어 있는 화면(PC 앱을 새로 켜고 브라우저는 그대로)에서도 동작하게 따로 묶는다.
(function () {
  // 긴 거리를 미끄러져 내려가는 동안에도 보이게 주황 테를 2초쯤 유지한 뒤 흐려진다
  var FLASH = "@keyframes fpdGotoFlash { 0%, 55% { box-shadow: 0 0 0 3px #f0a020, 0 0 0 9px rgba(240, 160, 32, .22); background-color: #fff6e6; }" +
              " 100% { box-shadow: 0 0 0 3px rgba(240, 160, 32, 0), 0 0 0 9px rgba(240, 160, 32, 0); background-color: transparent; } }";
  function headerOffset() {
    var bar = document.querySelector('header[data-testid="stHeader"], header.appbar');
    return bar ? bar.getBoundingClientRect().height : 0;
  }
  // PC 앱(Streamlit): 칸 key로 찾아 깜빡임 — Streamlit이 칸을 다시 그려도 지워지지 않게 스타일 규칙으로 건다
  function flashRule(sel) {
    var old = document.getElementById("fpd-goto-flash");
    if (old) old.remove();
    var s = document.createElement("style");
    s.id = "fpd-goto-flash";
    s.textContent = FLASH + " " + sel + " { border-radius: 10px; animation: fpdGotoFlash 3.6s ease-out 1; }";
    document.head.appendChild(s);
    setTimeout(function () { if (s.parentNode) s.remove(); }, 3800);
  }
  function visible(el) { return !!(el && el.offsetParent !== null && el.getClientRects().length); }
  // k: 위젯 key(예 _w_d_vac), x: 입력 묶음(접는 칸) key, tg: 켜야 칸이 나오는 토글 key
  function gotoWidget(k, x, tg) {
    var tabs = document.querySelectorAll('[role="tab"]');
    for (var i = 0; i < tabs.length; i++) {
      if ((tabs[i].innerText || "").trim() === "입력") {
        if (tabs[i].getAttribute("aria-selected") !== "true") tabs[i].click();
        break;
      }
    }
    var t0 = Date.now(), openedSec = false, flipped = false;
    (function step() {
      var el = document.querySelector(".st-key-" + k);
      if (visible(el)) {
        el.style.scrollMarginTop = Math.round(headerOffset() + 16) + "px";
        el.scrollIntoView({ behavior: "smooth", block: "center" });
        flashRule(".st-key-" + k);
        var inp = el.querySelector('input[type="number"], input[type="text"], textarea');
        if (inp) setTimeout(function () { try { inp.focus({ preventScroll: true }); } catch (err) { inp.focus(); } }, 450);
        return;
      }
      var box = x ? document.querySelector(".st-key-" + x) : null;
      var det = box ? box.querySelector("details") : null;
      if (det && !det.open && !openedSec) {              // 접힌 입력 묶음 펼치기
        openedSec = true;
        var sum = det.querySelector("summary");
        if (sum) sum.click(); else det.open = true;
      }
      if (tg && !flipped && (!det || det.open)) {        // 세부 입력 토글이 꺼져 있으면 켠다(Streamlit이 칸을 새로 그린다)
        var cb = document.querySelector(".st-key-" + tg + ' input[type="checkbox"]');
        if (cb) {
          flipped = true;
          if (!cb.checked) cb.click();
        }
      }
      if (Date.now() - t0 > 8000) {                      // 못 찾으면 입력 묶음까지만
        if (visible(box)) { box.scrollIntoView({ behavior: "smooth", block: "start" }); flashRule(".st-key-" + x); }
        return;
      }
      setTimeout(step, 120);
    })();
  }
  // 휴대폰 입력 화면: 주소의 goto=칸 이름 → 그 칸이 든 묶음을 펼치고 칸으로 내려가 깜빡임(키보드는 띄우지 않는다)
  window.fpGotoField = function (name) {
    if (!name || !/^[A-Za-z0-9_]+$/.test(name)) return;
    var inp = document.querySelector('form [name="' + name + '"]');
    if (!inp) return;
    var det = inp.closest("details");
    if (det) det.open = true;
    var box = inp.closest(".seg, .chem, label.f, label.c") || inp;
    if (!visible(box)) return;
    box.style.scrollMarginTop = Math.round(headerOffset() + 12) + "px";
    setTimeout(function () {
      box.scrollIntoView({ behavior: "smooth", block: "center" });
      box.classList.remove("goto-hl");
      void box.offsetWidth;                              // 같은 칸을 다시 눌러도 깜빡이게
      box.classList.add("goto-hl");
      setTimeout(function () { box.classList.remove("goto-hl"); }, 3800);
    }, 80);
  };
  if (window.__fpdGotoBound) return;
  window.__fpdGotoBound = true;
  document.addEventListener("click", function (e) {
    var a = e.target && e.target.closest ? e.target.closest(".fpd a[data-goto]") : null;
    if (!a || !window.__fpdInStreamlit) return;          // 휴대폰은 보통 링크(입력 화면 주소 + goto=칸)
    e.preventDefault();
    gotoWidget(a.getAttribute("data-goto"), a.getAttribute("data-goto-x") || "", a.getAttribute("data-goto-t") || "");
  });
})();

(function () {
  if (window.__fpdBound) return;
  window.__fpdBound = true;
  document.addEventListener("click", function (e) {
    var t = e.target;
    if (!t || !t.closest) return;
    var cf = t.closest("a[data-confirm]");          // 입력 초기화 등: 한 번 묻고 진행
    if (cf) {
      if (!window.confirm(cf.getAttribute("data-confirm"))) e.preventDefault();
      return;
    }
    var all = t.closest(".fpd [data-all]");
    if (all) {
      var ds = all.closest(".fpd").querySelectorAll("details.dc");
      var open = Array.prototype.some.call(ds, function (d) { return !d.open; });
      Array.prototype.forEach.call(ds, function (d) { d.open = open; });
      all.textContent = open ? "모두 접기" : "모두 펼치기";
      return;
    }
    var ob = t.closest(".fpd [data-open]");
    if (ob) {
      e.preventDefault();
      var d = ob.closest(".fpd").querySelector("#" + ob.getAttribute("data-open"));
      if (d) {
        d.open = true;
        // 위에 고정된 머리(PC 앱 메뉴 띠·휴대폰 앱 제목+탭)에 카드 제목이 가리지 않게 그 높이만큼 띄워서 멈춘다
        var bar = document.querySelector('header[data-testid="stHeader"], header.appbar');
        var off = bar ? bar.getBoundingClientRect().height : 0;
        d.style.scrollMarginTop = Math.round(off + 16) + "px";
        d.scrollIntoView({ behavior: "smooth", block: "start" });
      }
      return;
    }
    var ck = t.closest(".fpd [data-click]");
    if (ck && window.__fpdInStreamlit) {
      e.preventDefault();
      var label = ck.getAttribute("data-click");
      var cand = document.querySelectorAll('[data-testid="stDownloadButton"] button, button');
      for (var j = 0; j < cand.length; j++) {
        if (!cand[j].closest(".fpd") && (cand[j].innerText || "").indexOf(label) >= 0) {
          cand[j].click();
          return;
        }
      }
      return;
    }
    var tab = t.closest(".fpd [data-tab]");
    if (tab && window.__fpdInStreamlit) {
      var want = tab.getAttribute("data-tab");
      var btns = document.querySelectorAll('[role="tab"]');
      for (var i = 0; i < btns.length; i++) {
        if ((btns[i].innerText || "").trim() === want) {
          e.preventDefault();
          var box = btns[i].closest('[data-testid="stTabs"]') || btns[i];
          btns[i].click();
          setTimeout(function () { box.scrollIntoView({ behavior: "smooth", block: "start" }); }, 350);
          return;
        }
      }
    }
  });
})();
