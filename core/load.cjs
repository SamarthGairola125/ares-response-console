/* Loads the ARES model modules (browser-style scripts) into Node, the same way tests/harness.cjs does in v7. */
const fs = require('fs'), path = require('path'), vm = require('vm');
let A = null;
function loadARES() {
  if (A) return A;
  global.window = global; global.ARES = {}; window.ARES = global.ARES;
  if (typeof global.atob === 'undefined') global.atob = s => Buffer.from(s, 'base64').toString('binary');
  for (const f of ['core.js', 'model.js', 'datapack.js', 'pipeline.js', 'live.js']) vm.runInThisContext(fs.readFileSync(path.join(__dirname, f), 'utf8'), { filename: f });
  A = global.ARES; return A;
}
/* pack loader: serves data/<scenario>/... from a local folder through the v7 fetch-based loader */
function useLocalData(dir) {
  const real = global.__realFetch || (global.__realFetch = global.fetch);
  global.fetch = async (u, opt) => { if (/^https?:/i.test(String(u))) return real(u, opt); const p = path.join(dir, String(u).replace(/^data\//, '')); if (!fs.existsSync(p)) return { ok: false, status: 404 }; return { ok: true, status: 200, json: async () => JSON.parse(fs.readFileSync(p, 'utf8')), text: async () => fs.readFileSync(p, 'utf8'), arrayBuffer: async () => { const b = fs.readFileSync(p); return b.buffer.slice(b.byteOffset, b.byteOffset + b.length); } }; };
}
module.exports = { loadARES, useLocalData };
