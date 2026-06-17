// Minimal `HTMLWidgets` shim.
//
// The widget code (src/htmlwidget.js) registers itself with a global
// `HTMLWidgets.widget({...})` call - that global is normally provided by the R
// htmlwidgets runtime. Under anywidget (Python) there is no such runtime, so we
// provide just enough of the API for registration to succeed and to capture the
// widget definition. This lets the *unchanged*, already-verified widget run in
// Jupyter / VSCode without forking the rendering code.
//
// This file must be imported BEFORE src/htmlwidget.js so the global exists when
// the registration call executes.
if (typeof window !== "undefined" && !window.HTMLWidgets) {
  window.HTMLWidgets = {
    __widgets: {},
    // Capture the widget definition keyed by name.
    widget(def) {
      this.__widgets[def.name] = def;
    },
    // anywidget drives the factory/renderValue manually, so the htmlwidgets
    // auto-bootstrap (staticRender on DOMContentLoaded) is a no-op here.
    staticRender() {},
    find() {
      return null;
    },
    getAttachmentUrl() {
      return "";
    },
    shinyMode: false,
    viewerMode: false,
  };
}

export {};
