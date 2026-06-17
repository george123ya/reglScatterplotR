// Headless sync check. Loads a 2-plot HTML, pans the first plot, and reports
// whether the second plot's camera followed. Run: node test-sync.mjs <html>
import puppeteer from "puppeteer-core";

const file = process.argv[2] || "/tmp/regl_fixes_sync.html";
const browser = await puppeteer.launch({
  executablePath: "/usr/bin/chromium",
  headless: "new",
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--no-sandbox", "--enable-webgl", "--ignore-gpu-blocklist"],
});
const page = await browser.newPage();
await page.setViewport({ width: 1200, height: 700 });
const logs = [];
page.on("console", (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on("pageerror", (e) => logs.push(`[pageerror] ${e.message}`));

await page.goto("file://" + file, { waitUntil: "networkidle0" });
await new Promise((r) => setTimeout(r, 2500)); // let widgets init (800ms guard + draw)

const canvases = await page.$$("canvas");
console.log("canvases found:", canvases.length);

const cameraState = () =>
  page.evaluate(() => {
    const reg = window.__myScatterplotRegistry;
    if (!reg) return { error: "no registry" };
    const out = {};
    reg.forEach((e, id) => {
      try { out[id] = e.plot.get("cameraView").slice(0, 6); } catch (_) { out[id] = "n/a"; }
    });
    return {
      syncEnabled: reg.globalSyncEnabled,
      groups: Array.from(reg).map(([id, e]) => [id, e.syncGroup ? Array.from(e.syncGroup) : null]),
      cameras: out,
    };
  });

const before = await cameraState();
console.log("BEFORE:", JSON.stringify(before, null, 1));

// Drive a real camera change on p1 through the event path (headless swiftshader
// doesn't reliably deliver synthetic pointer drags to the regl interaction
// layer, so we move the camera via the public API instead - this still emits
// the 'view' event that the sync logic listens to).
await page.evaluate(() => {
  const reg = window.__myScatterplotRegistry;
  const ids = Array.from(reg.keys());
  const p1 = reg.get(ids[0]);
  p1.plot.zoomToArea({ x: -0.4, y: -0.4, width: 0.8, height: 0.8 }, { transition: false });
});
await new Promise((r) => setTimeout(r, 700));

const after = await cameraState();
console.log("AFTER :", JSON.stringify(after, null, 1));

console.log("\n--- console (last 20) ---");
logs.slice(-20).forEach((l) => console.log(l));
await browser.close();
