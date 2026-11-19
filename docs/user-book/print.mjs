// Prints book.html (built by build.py) to the PDF with a headless Chrome over the DevTools
// protocol, keeping the pages' own 16:9 size.
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";

const dir = new URL(".", import.meta.url).pathname;
const out = process.argv[2] ?? `${dir}Bishnoi-One-Playbook.pdf`;
const page = process.argv[3] ?? "book.html";
const chrome = spawn("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", [
  "--headless=new", "--remote-debugging-port=9334", `--user-data-dir=${dir}.chrome`, "--no-first-run", "about:blank",
], { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let targets = [];
for (let i = 0; i < 40 && !targets.length; i++) {
  try { targets = (await (await fetch("http://127.0.0.1:9334/json")).json()).filter((t) => t.type === "page"); } catch {}
  await sleep(250);
}
const ws = new WebSocket(targets[0].webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener("open", r, { once: true }));
let id = 0;
const waiting = new Map();
ws.addEventListener("message", (event) => {
  const msg = JSON.parse(event.data);
  if (msg.id && waiting.has(msg.id)) { waiting.get(msg.id)(msg); waiting.delete(msg.id); }
});
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const n = ++id;
  waiting.set(n, (msg) => (msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result)));
  ws.send(JSON.stringify({ id: n, method, params }));
});
await send("Page.enable");
await send("Runtime.enable");
await send("Page.navigate", { url: `file://${dir}${page}` });
// Wait for the pages to be fitted (book.html shrinks words that overflow), then name any that still don't fit.
for (let i = 0; i < 120; i++) {
  await sleep(500);
  const done = await send("Runtime.evaluate", { expression: "document.body && document.body.dataset.fitted === '1' ? (document.body.dataset.over || 'none') : ''", returnByValue: true });
  if (done.result.value) { console.log("pages that still overflow:", done.result.value); break; }
}
// node print.mjs <out.pdf> [book.html] [pages, e.g. "1,37-88"]: one part of the book on its own.
const pdf = await send("Page.printToPDF", { printBackground: true, preferCSSPageSize: true, marginTop: 0, marginBottom: 0, marginLeft: 0, marginRight: 0, ...(process.argv[4] ? { pageRanges: process.argv[4] } : {}) });
writeFileSync(out, Buffer.from(pdf.data, "base64"));
console.log("printed", out);
ws.close();
chrome.kill();
process.exit(0);
