// Safe, versioned browser storage that every app shares.
//
// Data lives in the visitor's own browser (localStorage) and is never sent anywhere.
// Every call is wrapped so a blocked or full storage can't crash an app.
//
// Usage in an app:
//   const store = Store.open("job-tracker", 1);   // app id, current data version
//   const data = store.load({ jobs: [] });         // fallback if nothing saved yet
//   store.save(data);                              // returns false if it failed
//   store.exportFile(data);                        // downloads a .json backup
//   const restored = await store.importFile(file); // reads a backup back in
//   store.key                                      // raw key, for "storage" events from other tabs
(function () {
  "use strict";

  // Never change this prefix: renaming it would make every saved record disappear.
  const PREFIX = "hub:";

  function available() {
    try {
      const key = PREFIX + "__test";
      localStorage.setItem(key, "1");
      localStorage.removeItem(key);
      return true;
    } catch (e) {
      return false;
    }
  }

  // migrate(oldData, oldVersion) is optional. It runs when saved data is older
  // than `version`, and must return data in the current shape.
  function open(appId, version, migrate) {
    const key = PREFIX + appId;

    function unwrap(record, fallback) {
      if (!record || typeof record !== "object" || !("data" in record)) return fallback;
      if (record.version === version) return record.data;
      if (record.version < version && migrate) return migrate(record.data, record.version);
      return fallback;
    }

    return {
      // The raw localStorage key, for listening to changes made in other tabs.
      key,

      load(fallback) {
        try {
          const raw = localStorage.getItem(key);
          return raw === null ? fallback : unwrap(JSON.parse(raw), fallback);
        } catch (e) {
          console.warn("[storage] could not load", appId, e);
          return fallback;
        }
      },

      save(data) {
        try {
          localStorage.setItem(key, JSON.stringify({ version, savedAt: new Date().toISOString(), data }));
          return true;
        } catch (e) {
          console.warn("[storage] could not save", appId, e);
          return false;
        }
      },

      clear() {
        try {
          localStorage.removeItem(key);
        } catch (e) {
          /* nothing to clear */
        }
      },

      exportFile(data) {
        const record = { app: appId, version, exportedAt: new Date().toISOString(), data };
        const blob = new Blob([JSON.stringify(record, null, 2)], { type: "application/json" });
        const link = document.createElement("a");
        link.href = URL.createObjectURL(blob);
        link.download = appId + "-backup-" + new Date().toISOString().slice(0, 10) + ".json";
        link.click();
        setTimeout(() => URL.revokeObjectURL(link.href), 1000);
      },

      // Resolves with the backup's data, or rejects with a message a person can read.
      async importFile(file) {
        let record;
        try {
          record = JSON.parse(await file.text());
        } catch (e) {
          throw new Error("That file isn't a valid backup (it couldn't be read as JSON).");
        }
        if (!record || record.app !== appId) {
          throw new Error("That backup belongs to a different tool.");
        }
        if (record.version > version) {
          throw new Error("That backup was made by a newer version of this tool. Reload the page and try again.");
        }
        const data = unwrap(record, undefined);
        if (data === undefined) throw new Error("That backup couldn't be converted to the current format.");
        return data;
      }
    };
  }

  window.Store = { open, available };
})();
