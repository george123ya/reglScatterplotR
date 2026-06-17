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

  const container = document.createElement("div");
  container.style.width = "100%";
  container.style.height = typeof h === "number" ? h + "px" : h || "500px";
  container.style.position = "relative";
  el.appendChild(container);

  // anywidget output cells can report a zero size on first paint; fall back to
  // sensible defaults and let the ResizeObserver correct things once laid out.
  const w0 = container.clientWidth || el.clientWidth || 700;
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

  return () => {
    ro.disconnect();
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
