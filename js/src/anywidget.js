// anywidget (Python) adapter for the reglScatterplot widget.
//
// Strategy: rather than fork the 1,500-line rendering "brain", we load the
// SAME compiled widget the R package uses and drive it directly. The shim
// (imported first) provides a global `HTMLWidgets` so the widget's
// `HTMLWidgets.widget({...})` registration captures its definition; then we
// call `factory(el, w, h).renderValue(spec)` ourselves. The widget already
// runs without Shiny (every Shiny touchpoint is guarded), which is exactly the
// standalone-HTML code path - so behaviour matches the R output.
//
// The Python side (reglscatterpy) produces `spec` with build_payload(), which
// is a byte-for-byte port of the R payload (locked by test_payload_parity).
import "./htmlwidgets-shim.js";
import "./htmlwidget.js"; // registers the widget + assigns window.d3 / regl / etc.

function mount(el, model) {
  const def = window.HTMLWidgets.__widgets["reglScatterplot"];
  if (!def) {
    el.textContent = "reglScatterplot: widget failed to register.";
    return () => {};
  }

  const spec = model.get("_spec") || {};
  const h = model.get("_height");
  const w = model.get("_width");

  const container = document.createElement("div");
  // A positive width => fixed px (like matplotlib / plotly); 0 / null => 100%.
  const fixedW = (typeof w === "number" && w > 0);
  container.style.width = fixedW ? w + "px" : "100%";
  container.style.height = typeof h === "number" ? h + "px" : h || "500px";
  container.style.position = "relative";
  container.style.boxSizing = "border-box";   // keep the border inside the width (no overflow/scrollbars)
  // Render as a clean, self-contained card (like the static iframe) so the live
  // widget doesn't sprawl across the light, full-width ipywidget output area in
  // dark themes. White plot background + a subtle border/rounding.
  container.style.background = spec.backgroundColor || "#ffffff";
  container.style.border = "1px solid rgba(127,127,127,0.25)";
  container.style.borderRadius = "6px";
  // Hug the plot width so the widget's output box doesn't span the full cell.
  if (fixedW) {
    el.style.maxWidth = w + "px";
    el.style.width = "fit-content";
  }
  el.appendChild(container);

  // anywidget output cells can report a zero size on first paint; fall back to
  // sensible defaults and let the ResizeObserver correct things once laid out.
  const w0 = container.clientWidth || ((typeof w === "number" && w > 0) ? w : el.clientWidth || 700);
  const h0 = container.clientHeight || (typeof h === "number" ? h : 500);

  const inst = def.factory(container, w0, h0);
  Promise.resolve(inst.renderValue(spec)).catch((e) =>
    console.error("[reglScatterplot] renderValue failed", e)
  );

  const ro = new ResizeObserver(() => {
    const r = container.getBoundingClientRect();
    if (r.width > 0 && r.height > 0 && typeof inst.resize === "function") {
      inst.resize(r.width, r.height);
    }
  });
  ro.observe(container);

  // Selection round-trip: lasso in the plot -> model._selection (Python reads
  // w.selection); Python sets w.selection -> highlight points in the plot.
  let applyingFromModel = false;
  // Two request counters back a synchronous Python read (w.selection / w.filtered):
  //  - bumpGen: LIGHT interactions (clicks, trait-set filters). Bumped AFTER the
  //    data trait so the kernel's auto-ack can't run before the value is set. The
  //    counter always changes, so the kernel reliably acks even when the selection
  //    value itself didn't change (e.g. deselect when already empty).
  //  - bumpWork: HEAVY async work (a 10M-point lasso / legend filter / deselect /
  //    reset). Bumped BEFORE the work message so the read DETECTS pending work; the
  //    kernel marks it done only AFTER the work finishes, so the read blocks for
  //    completion, not just delivery.
  const bumpGen = () => {
    try { model.set("_sel_gen", (model.get("_sel_gen") || 0) + 1); model.save_changes(); } catch (e) {}
  };
  const bumpWork = () => {
    try { model.set("_work_req", (model.get("_work_req") || 0) + 1); model.save_changes(); } catch (e) {}
  };
  const onSel = (ev) => {
    if (applyingFromModel) return;
    model.set("_selection", ev.detail.indices || []);
    model.save_changes();
    bumpGen();
  };
  container.addEventListener("sp-selection", onSel);

  // Filter round-trip: in-plot filters -> model._filtered (Python reads w.filtered).
  // null indices => no active filter.
  const onFilter = (ev) => {
    const idx = ev.detail.indices;
    model.set("_filtered_on", idx != null);
    model.set("_filtered", idx || []);
    model.save_changes();
    bumpGen();
  };
  container.addEventListener("sp-filter", onFilter);

  // Camera round-trip: the live view -> model._camera so to_html can export the
  // current zoom/pan.
  const onCamera = (ev) => {
    try { model.set("_camera", ev.detail.view || []); model.save_changes(); } catch (e) {}
  };
  container.addEventListener("sp-camera", onCamera);

  // Detail-on-zoom: forward the current viewport to the kernel, which re-renders
  // the cells inside it (full detail when zoomed in). model.send -> widget.on_msg.
  const onViewport = (ev) => {
    // a double-click reset clears the kernel selection too -> bump work FIRST so a
    // read waits for the reset to be applied (a plain pan/zoom doesn't bump).
    if (ev.detail.reset) bumpWork();
    try { model.send({ type: "viewport", bounds: ev.detail.bounds, seq: ev.detail.seq, reset: ev.detail.reset }); } catch (e) {}
  };
  container.addEventListener("sp-viewport", onViewport);

  // Full-region lasso: the polygon goes to the kernel, which selects every cell
  // inside it on the full dataset (not just the drawn subset).
  const onLasso = (ev) => {
    bumpWork();   // BEFORE the lasso message, so a read detects the pending work
    try { model.send({ type: "lasso", polygon: ev.detail.polygon }); } catch (e) {}
  };
  container.addEventListener("sp-lasso", onLasso);

  // Legend category filter -> kernel resolves to original cells + syncs the group.
  const onLegendFilter = (ev) => {
    bumpWork();
    try { model.send({ type: "legend_filter", cats: ev.detail.cats }); } catch (e) {}
  };
  container.addEventListener("sp-legendfilter", onLegendFilter);

  // Range-slider filter (progressive) -> kernel computes the kept set over the FULL
  // dataset (vp["full_filter"]), so w.filtered reflects every in-range cell.
  const onRangeFilter = (ev) => {
    bumpWork();
    try { model.send({ type: "range_filter", ranges: ev.detail.ranges }); } catch (e) {}
  };
  container.addEventListener("sp-rangefilter", onRangeFilter);

  // Progressive deselect: clear the kernel's logical selection in-band (FIFO with
  // viewport messages) and push a clearing vp_select [] to every linked panel, so a
  // queued pan/zoom can't re-apply the just-cleared selection.
  const onDeselect = () => {
    bumpWork();
    try { model.send({ type: "deselect" }); } catch (e) {}
  };
  container.addEventListener("sp-deselect", onDeselect);

  // Kernel pushes new in-view points (detail-on-zoom) -> swap them on the existing
  // plot via plot.draw (no re-render / no spinner). A custom message, NOT a _spec
  // change, so the widget never re-mounts.
  const onMsg = (content, buffers) => {
    if (!content || typeof content.type !== "string") return;
    if (content.type.indexOf("vp_") === 0 && typeof inst.updateData === "function") {
      inst.updateData(content, buffers);   // vp_update / vp_overview / vp_select / vp_noop (+ binary buffers)
    } else if (content.type === "hl" && typeof inst.setHighlight === "function") {
      inst.setHighlight(content);          // persistent highlight (mark points)
    } else if (content.type === "morph" && typeof inst.morphTo === "function") {
      inst.morphTo(content, buffers);      // animate to another embedding (UMAP <-> spatial)
    }
  };
  model.on("msg:custom", onMsg);

  const onModelSel = () => {
    if (typeof inst.setSelection !== "function") return;
    applyingFromModel = true;
    try { inst.setSelection(model.get("_selection") || []); }
    finally { applyingFromModel = false; }
  };
  model.on("change:_selection", onModelSel);
  const initSel = model.get("_selection");
  if (initSel && initSel.length && typeof inst.setSelection === "function") {
    inst.setSelection(initSel);
  }

  return () => {
    ro.disconnect();
    container.removeEventListener("sp-selection", onSel);
    container.removeEventListener("sp-filter", onFilter);
    container.removeEventListener("sp-camera", onCamera);
    container.removeEventListener("sp-viewport", onViewport);
    container.removeEventListener("sp-lasso", onLasso);
    container.removeEventListener("sp-legendfilter", onLegendFilter);
    container.removeEventListener("sp-rangefilter", onRangeFilter);
    container.removeEventListener("sp-deselect", onDeselect);
    model.off("msg:custom", onMsg);
    model.off("change:_selection", onModelSel);
    container.remove();
  };
}

export default {
  render({ model, el }) {
    let cleanup = mount(el, model);
    // Re-render when Python pushes a new spec (e.g. plot.update(...)).
    const onChange = () => {
      if (cleanup) cleanup();
      el.innerHTML = "";
      cleanup = mount(el, model);
    };
    model.on("change:_spec", onChange);
    return () => {
      model.off("change:_spec", onChange);
      if (cleanup) cleanup();
    };
  },
};
