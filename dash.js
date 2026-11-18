// 결과 대시보드 동작(휴대폰 앱·사내 서버판·PC 앱 공통): 모두 펼치기, 원 단추 → 해당 카드 펼치고 이동,
// (PC 앱 안에서만) ‘입력 고치기’ → 화면의 ‘입력’ 탭으로, ‘엑셀 받기’ → 화면 아래의 내려받기 단추를 대신 누름.
(function () {
  if (window.__fpdBound) return;
  window.__fpdBound = true;
  document.addEventListener("click", function (e) {
    var t = e.target;
    if (!t || !t.closest) return;
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
