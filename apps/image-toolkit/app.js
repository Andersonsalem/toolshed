// Switches between the two tools. The open one is in the address (#edit or
// #signature), so each can be linked to directly.
(function () {
  "use strict";
  const IT = window.ImageToolkit;
  const TABS = ["edit", "signature"];

  function show() {
    const wanted = location.hash.slice(1);
    const current = TABS.includes(wanted) ? wanted : "edit";
    for (const tab of TABS) {
      const active = tab === current;
      document.getElementById("tab-" + tab).setAttribute("aria-selected", String(active));
      document.getElementById("panel-" + tab).hidden = !active;
    }
    if (current === "signature") IT.showSignature();
  }

  window.addEventListener("hashchange", show);
  show();
})();
