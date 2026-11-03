// Tool logic. Everything for this tool lives in this folder.
// Shared helpers available: UI.el (build DOM safely), Store (saved data), SITE (config).
(function () {
  "use strict";
  const { el } = window.UI;

  const APP_ID = "_template"; // must match the folder name
  const store = Store.open(APP_ID, 1);

  if (!Store.available()) document.getElementById("storage-warning").hidden = false;

  const state = store.load({ count: 0 });

  function render() {
    const root = document.getElementById("app");
    root.replaceChildren(
      el("div", { class: "card" }, [
        el("p", { text: "Saved count: " + state.count }),
        el("button", { class: "button", type: "button", text: "Add one" })
      ])
    );
    root.querySelector("button").addEventListener("click", () => {
      state.count += 1;
      store.save(state);
      render();
    });
  }

  render();
})();
