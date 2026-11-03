// Tracing one element through the code: which elements of earlier tensors feed it,
// and which elements of later tensors it feeds. No page layout here.
//
//   TS.trace(tensors, target, idx) -> {
//     back:  Map(tensor -> Set of flat indexes)   elements that feed the target (the target included)
//     wide:  Map(tensor -> [box])   feeding elements kept as boxes because there are too many to list
//     fwd:   Map(tensor -> Set of flat indexes)   elements the target feeds
//     stops: [tensor]  results whose element flow this tool doesn't know (the trace stops there)
//     approx: true if some step's highlighted area is an overestimate
//     capped: true if there were too many elements to follow everything (the trace stops there)
//   }
//   tensors: every tensor of the run (to find what the target feeds).
//
// Each result knows its sources (out.src, see tensor.js): map(outIndex) gives an input
// index, or a box of them (ranges per dimension), or null.
(function () {
  "use strict";
  const TS = window.TS;
  const WORK = 4e6; // element visits in total, so a click never freezes the page
  const BIG = 250000; // a box with more elements than this isn't listed one by one

  const flat = TS.ravel, unflat = TS.unravel;
  const volume = (box) => box.reduce((acc, e) => acc * (typeof e === "number" ? 1 : Math.max(0, e[1] - e[0] + 1)), 1);
  // Calls fn(flatIndex) for every element of a box.
  function eachIn(box, shape, fn) {
    const lo = box.map((e) => (typeof e === "number" ? e : e[0]));
    const hi = box.map((e) => (typeof e === "number" ? e : e[1]));
    if (lo.some((v, i) => v > hi[i])) return;
    const cur = lo.slice();
    for (;;) {
      fn(flat(cur, shape));
      let k = cur.length - 1;
      while (k >= 0 && cur[k] === hi[k]) cur[k] = lo[k--];
      if (k < 0) return;
      cur[k]++;
    }
  }
  const inBox = (pt, box) => box.every((e, i) => (typeof e === "number" ? pt[i] === e : pt[i] >= e[0] && pt[i] <= e[1]));

  TS.trace = function (tensors, target, idx) {
    const res = { back: new Map(), wide: new Map(), fwd: new Map(), stops: [], approx: false, capped: false };
    let work = 0;
    const spend = (n) => {
      if (work + n > WORK) {
        res.capped = true;
        return false;
      }
      work += n;
      return true;
    };

    // Backward: newest first, so a tensor's set is complete before it's passed on
    // (inputs are always made before the results that use them).
    const pending = new Map([[target, new Set([flat(idx, target.shape)])]]);
    while (pending.size) {
      let t = null;
      for (const k of pending.keys()) if (!t || k.uid > t.uid) t = k;
      const set = pending.get(t);
      pending.delete(t);
      res.back.set(t, set);
      if (!t.src) {
        if (t.untracked) res.stops.push(t);
        continue;
      }
      for (const s of t.src) {
        const into = pending.get(s.t) || res.back.get(s.t) || new Set();
        const seen = new Set(); // the same box from many elements (Linear, sums) is added once
        for (const p of set) {
          const box = s.map(unflat(p, t.shape));
          if (!box) continue;
          const key = box.join("|");
          if (seen.has(key)) continue;
          seen.add(key);
          // A huge box (a sum over everything) is kept as a box: it can be drawn, not followed further.
          if (volume(box) > BIG || !spend(volume(box))) {
            if (!res.wide.has(s.t)) res.wide.set(s.t, []);
            res.wide.get(s.t).push(box);
            if (s.t.src) res.capped = true;
            continue;
          }
          eachIn(box, s.t.shape, (q) => into.add(q));
        }
        if (s.approx && (into.size || res.wide.has(s.t))) res.approx = true;
        if (into.size && !res.back.has(s.t)) pending.set(s.t, into);
      }
    }

    // Forward: oldest first. A later element is fed by the target if its box holds a fed element.
    res.fwd.set(target, res.back.get(target));
    const later = tensors.filter((t) => t.uid > target.uid && t.src).sort((a, b) => a.uid - b.uid);
    for (const y of later) {
      const srcs = y.src.filter((s) => res.fwd.has(s.t));
      if (!srcs.length) continue;
      const n = TS.numel(y.shape), hits = new Set();
      for (const s of srcs) {
        const fed = res.fwd.get(s.t);
        const pts = [...fed].map((p) => unflat(p, s.t.shape));
        for (let q = 0; q < n && !res.capped; q++) {
          if (hits.has(q)) continue;
          const box = s.map(unflat(q, y.shape));
          if (!box) continue;
          const v = volume(box);
          // Check whichever is smaller: the box's elements, or the fed elements.
          if (!spend(Math.min(v, pts.length) + 1)) break;
          let hit = false;
          if (v <= pts.length) eachIn(box, s.t.shape, (e) => (hit = hit || fed.has(e)));
          else hit = pts.some((pt) => inBox(pt, box));
          if (hit) hits.add(q);
        }
        if (s.approx && hits.size) res.approx = true;
      }
      if (res.capped) break;
      if (hits.size) res.fwd.set(y, hits);
    }
    res.fwd.delete(target);
    return res;
  };
})();
