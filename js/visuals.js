/* ARES simulation — per-step 3D visuals */
(function (A) {
'use strict';
const C = A.core, E = A.scene, Mo = A.model, { CLS } = C;
const V = A.vis = {};
let out = null, W = null; const m4 = new THREE.Matrix4(), q0 = new THREE.Quaternion(), sv = new THREE.Vector3(), pv = new THREE.Vector3(), col = new THREE.Color();
V.g = {};
const COL = { thermal: 0xff7a2f, beacon: 0x2f86ff, hidden: 0x8c8c86, accent: 0xd9531e, comm: 0x2b6cb0, ok: 0x2f8a55, crit: 0xc4362c, warn: 0xd59a18 };
V.COL = COL;

function grp(name) { const g = new THREE.Group(); g.name = name; g.visible = false; W.root.add(g); V.g[name] = g; return g; }
function ramp(t, stops) { t = C.clamp(t, 0, 1); const n = stops.length - 1, i = Math.min(n - 1, Math.floor(t * n)), f = t * n - i; return col.setHex(stops[i]).lerp(new THREE.Color(stops[i + 1]), f); }
V.RAMP = { belief: [0xfff3c4, 0xf7c46c, 0xf08a3c, 0xd9531e, 0x8f1f1a], effort: [0xd6f0e0, 0x8fd1b0, 0x3fa58a, 0x1f6f7a, 0x16365a], unc: [0xe8e4f4, 0xb9a9e0, 0x7f63c4, 0x4e2a96, 0x2a1060], sig: [0x3b1f4a, 0x7a2c5e, 0xc6493a, 0xe88a2a, 0xf2d24b, 0xfbf3b0] };
V.rampHex = (t, k) => '#' + ramp(t, V.RAMP[k]).getHexString();

V.build = function (o) {
  out = o; W = E.world; V.g = {}; const T = o.T, S = T.S, d = S / 10, B = o.B, sz = d / 250;
  V.sz = sz; V.asz = 0.32; // aerostat geometry at real scale: hull ≈ 16 m long (assumed class); enlarged on screen by V.symbolic()
  /* 1 alert */
  const ga = grp('alert'); const inc = E.wp(o.M.incident[0], o.M.incident[1], 0.5);
  for (let i = 0; i < 3; i++) { const r = new THREE.Mesh(new THREE.RingGeometry(0.92, 1, 64).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: COL.crit, transparent: true, opacity: 0.6, depthWrite: false, side: THREE.DoubleSide })); r.position.copy(inc); r.userData.ph = i / 3; ga.add(r); }
  const core = new THREE.Mesh(new THREE.SphereGeometry(sz * 1.6, 16, 12), new THREE.MeshBasicMaterial({ color: COL.crit })); core.position.copy(inc); ga.add(core);
  const beam = new THREE.CylinderGeometry(sz * 0.18, sz * 0.18, 1, 6).translate(0, 0.5, 0);
  o.steps.detect.early.forEach(i => { const m = new THREE.Mesh(beam, new THREE.MeshBasicMaterial({ color: COL.beacon, transparent: true, opacity: 0.85 })); m.position.copy(E.wp(o.P.x[i], o.P.y[i])); m.scale.y = d * 0.06; m.userData.beacon = 1; ga.add(m); });
  E.onFrame(t => { if (!ga.visible) return false; ga.children.forEach(m => { if (m.userData.ph != null) { const k = ((t / 2400) + m.userData.ph) % 1, s = d * 0.02 + k * d * 0.16; m.scale.set(s, 1, s); m.material.opacity = 0.7 * (1 - k); } else if (m.userData.beacon) m.material.opacity = 0.45 + 0.4 * Math.sin(t / 220 + m.position.x); }); return true; });
  /* 2 damage columns */
  const gd = grp('damage'); const dc = []; for (let c = 0; c < B.N; c++) if (B.dfrac[c] > 0.04 || (o.M.water != null && B.lam[c] > 0.5 && B.sev[c] > 0.4)) dc.push(c);
  const dim = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0), new THREE.MeshLambertMaterial({ color: 0xffffff, transparent: true, opacity: 0.78 }), Math.max(1, dc.length));
  dc.forEach((c, i) => { dim.setColorAt(i, ramp(B.sev[c], [0xf5c26b, 0xe9822f, 0xd24a24, 0x8f1f1a])); }); dim.count = dc.length; dim.userData = { cells: dc, k: 0 }; gd.add(dim); V.dmgMesh = dim;
  V.setDamage = k => { dc.forEach((c, i) => { pv.copy(E.wp(B.cx[c], B.cy[c])); sv.set(B.cs / 10 * 0.9, Math.max(0.01, k * B.sev[c] * d * 0.05), B.cs / 10 * 0.9); m4.compose(pv, q0, sv); dim.setMatrixAt(i, m4); }); dim.instanceMatrix.needsUpdate = true; };
  V.setDamage(0);
  /* 3/4/10 belief bars */
  const gb = grp('bars'); const bc = []; for (let c = 0; c < B.N; c++) if (B.lam[c] > 0.03 || true) bc.push(c);
  const bars = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0), new THREE.MeshLambertMaterial({ color: 0xffffff }), B.N);
  V.barCur = new Float32Array(B.N); V.barTgt = new Float32Array(B.N); V.barCol = new Float32Array(B.N * 3); V.barColT = new Float32Array(B.N * 3); V.barBase = [];
  for (let c = 0; c < B.N; c++) { V.barBase.push(E.wp(B.cx[c], B.cy[c], -0.05)); bars.setColorAt(c, col.setHex(0xffffff)); }
  gb.add(bars); V.bars = bars; bars.userData.kind = 'bar'; E.pickables.push(bars); writeBars(1);
  /* 5 pins */
  const gp = grp('pins'); const stick = new THREE.CylinderGeometry(sz * 0.12, sz * 0.12, 1, 5).translate(0, 0.5, 0), head = new THREE.SphereGeometry(sz * 0.55, 10, 8);
  const valid = o.sites, rej = o.steps.sites.rejected;
  const mk = (arr, color, hgt) => { const st = new THREE.InstancedMesh(stick, new THREE.MeshLambertMaterial({ color }), Math.max(1, arr.length)), hd = new THREE.InstancedMesh(head, new THREE.MeshLambertMaterial({ color }), Math.max(1, arr.length)); arr.forEach((s, i) => { pv.copy(E.wp(s.x, s.y)); sv.set(1, hgt, 1); m4.compose(pv, q0, sv); st.setMatrixAt(i, m4); pv.y += hgt; sv.set(1, 1, 1); m4.compose(pv, q0, sv); hd.setMatrixAt(i, m4); }); st.count = hd.count = arr.length; gp.add(st, hd); return hd; };
  V.pinValid = mk(valid, COL.ok, sz * 7); V.pinRej = mk(rej, COL.crit, sz * 3.5); V.pinValid.userData.kind = 'site'; V.pinRej.userData.kind = 'rej'; E.pickables.push(V.pinValid, V.pinRej);
  /* 6 candidate cones + LoS rays */
  const gc = grp('cand'); const per = o.steps.coverage.perSite.map((v, j) => [v, j]).sort((a, b) => b[0] - a[0]).slice(0, 10);
  V.candTop = per.map(p => p[1]);
  per.forEach(([v, j], i) => gc.add(coneFor(valid[j], o.p, i === 0 ? 0.16 : 0.07, i === 0 ? COL.accent : 0x9c8f7c)));
  const best = valid[per[0] ? per[0][1] : 0]; if (best) { const hz = best.z0 + o.p.h, top = new THREE.Vector3(best.x / 10, E.Y(hz), -best.y / 10), pts = [], cols = [], rr = Mo.footR(o.p, o.p.h) * 1.7;
    for (let c = 0; c < B.N; c++) { const dd = Math.hypot(B.cx[c] - best.x, B.cy[c] - best.y); if (dd > rr || B.lam[c] < 0.02) continue; const ob = Mo.losObs(T, best.x, best.y, hz, B.cx[c], B.cy[c], B.cz[c], 16); const ok = ob <= 2 && dd <= Mo.footR(o.p, hz - B.cz[c]); const c2 = new THREE.Color(ob > 2 ? COL.crit : ok ? COL.ok : 0xb0a898); const g = E.wp(B.cx[c], B.cy[c], 0.2); pts.push(top.x, top.y, top.z, g.x, g.y, g.z); cols.push(c2.r, c2.g, c2.b, c2.r, c2.g, c2.b); }
    const lg = new THREE.BufferGeometry(); lg.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3)); lg.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3)); gc.add(new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.75 }))); V.raySite = best; }
  /* 7-10 aerostats */
  const gn = grp('nodes'); V.nodeObjs = o.nodes.map((n, i) => makeAerostat(n, i)); V.nodeObjs.forEach(nb => gn.add(nb.g));
  grp('links');
  /* people */
  const gpp = grp('people'); const pm = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 10, 8), new THREE.MeshBasicMaterial({ color: 0xffffff }), o.P.n); V.people = pm; pm.userData.kind = 'person'; sv.setScalar(1e-4); for (let i = 0; i < o.P.n; i++) { pm.setColorAt(i, col.setHex(0xffffff)); m4.compose(personPos(i), q0, sv); pm.setMatrixAt(i, m4); } gpp.add(pm); E.pickables.push(pm); V.pScale = new Float32Array(o.P.n); V.pTgt = new Float32Array(o.P.n);
  const hp = new Float32Array(o.P.n * 3); for (let i = 0; i < o.P.n; i++) { const p = personPos(i); hp[i * 3] = p.x; hp[i * 3 + 1] = p.y; hp[i * 3 + 2] = p.z; }
  const hg = new THREE.BufferGeometry(); hg.setAttribute('position', new THREE.BufferAttribute(hp, 3)); W.heat.add(new THREE.Points(hg, new THREE.PointsMaterial({ color: 0xffe9a8, size: 7, sizeAttenuation: false, transparent: true, blending: THREE.AdditiveBlending, map: dotTex() })));
  /* SOS pulse */
  const gs = grp('sos'); const so = o.steps.update.sos; if (so) { for (let i = 0; i < 2; i++) { const r = new THREE.Mesh(new THREE.RingGeometry(0.9, 1, 48).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: COL.beacon, transparent: true, depthWrite: false, side: THREE.DoubleSide })); r.position.copy(E.wp(so.x, so.y, 0.4)); r.userData.ph = i / 2; gs.add(r); } E.onFrame(t => { if (!gs.visible) return false; gs.children.forEach(m => { const k = ((t / 1800) + m.userData.ph) % 1, s = d * 0.01 + k * d * 0.07; m.scale.set(s, 1, s); m.material.opacity = 0.8 * (1 - k); }); return true; }); }
  /* compare: k-means set */
  const gk = grp('kmeans'); const base = o.steps.optimise.base, kn = base.needKmeans || Math.min(base.kmSets.length - 1, o.steps.optimise.sol.length); V.kmN = kn; V.kmCov = base.kmeans[kn];
  (base.kmSets[kn] || []).forEach(j => { const s = valid[j]; gk.add(coneFor(s, o.p, 0.12, 0x7b4fd6)); const b = new THREE.Mesh(new THREE.SphereGeometry(sz * 1.2, 12, 10), new THREE.MeshLambertMaterial({ color: 0x7b4fd6 })); b.position.set(s.x / 10, E.Y(s.z0 + o.p.h), -s.y / 10); gk.add(b); });
  /* routes */
  grp('routes'); V.buildRoutes();
  /* highlight marker */
  const gh = grp('hl'); const ring = new THREE.Mesh(new THREE.RingGeometry(0.8, 1, 40).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x111111, transparent: true, opacity: 0.9, depthTest: false, side: THREE.DoubleSide })); ring.renderOrder = 9; gh.add(ring);
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(sz * 0.15, sz * 0.15, 1, 6).translate(0, 0.5, 0), new THREE.MeshBasicMaterial({ color: 0x111111, depthTest: false })); pole.renderOrder = 9; gh.add(pole); V.hlRing = ring; V.hlPole = pole;
  E.onFrame(t => { if (gh.visible) { const s = V.hlR * (1 + 0.08 * Math.sin(t / 160)); ring.scale.set(s, 1, s); return true; } });
  E.feedHide = [V.g.nodes, V.g.links, V.g.cand, V.g.pins, V.g.alert, V.g.hl, V.g.kmeans];
  E.onFrame(() => { V.symbolic(); return false; });
};

function dotTex() { const c = document.createElement('canvas'); c.width = c.height = 32; const g = c.getContext('2d'), gr = g.createRadialGradient(16, 16, 0, 16, 16, 16); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.4, 'rgba(255,220,140,0.8)'); gr.addColorStop(1, 'rgba(255,120,40,0)'); g.fillStyle = gr; g.fillRect(0, 0, 32, 32); return new THREE.CanvasTexture(c); }
function personPos(i) { const P = out.P; return new THREE.Vector3(P.x[i] / 10, E.Y(P.g[i]) + P.roofH[i] / 10 * W.T.bvex + V.sz * 0.7, -P.y[i] / 10); }

function drape(x, y, r, n = 72) { const pts = []; for (let i = 0; i <= n; i++) { const a = i / n * Math.PI * 2, px = x + Math.cos(a) * r, py = y + Math.sin(a) * r; pts.push(E.wp(C.clamp(px, -W.T.S / 2, W.T.S / 2), C.clamp(py, -W.T.S / 2, W.T.S / 2), 0.35)); } return new THREE.BufferGeometry().setFromPoints(pts); }
function coneFor(s, p, op, color) {
  const g = new THREE.Group(), hz = s.z0 + p.h, r = Mo.footR(p, p.h), h = E.Y(hz) - E.Y(s.z0);
  const cone = new THREE.Mesh(new THREE.ConeGeometry(1, 1, 48, 1, true), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: op, depthWrite: false, side: THREE.DoubleSide }));
  cone.scale.set(r / 10, h, r / 10); cone.position.set(s.x / 10, E.Y(s.z0) + h / 2, -s.y / 10); g.add(cone);
  g.add(new THREE.Line(drape(s.x, s.y, r), new THREE.LineBasicMaterial({ color, transparent: true, opacity: Math.min(1, op * 6) })));
  return g;
}
function makeAerostat(n, i) {
  const s = out.sites[n.site], p = out.p, sz = V.asz, g = new THREE.Group(), relay = n.role === 'relay';
  const body = new THREE.Group(), env = new THREE.MeshPhongMaterial({ color: 0xf4f2ee, emissive: 0x000000, shininess: 38, specular: 0x555555 });
  const hull = new THREE.Mesh(new THREE.SphereGeometry(1, 28, 18), env); hull.scale.set(2.5 * sz, 1.05 * sz, 1.05 * sz); body.add(hull);
  const nose = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 12), env); nose.scale.set(0.9 * sz, 0.86 * sz, 0.86 * sz); nose.position.x = 1.45 * sz; body.add(nose);
  const bandMat = new THREE.MeshBasicMaterial({ color: relay ? 0x2b6cb0 : n.replan ? 0x6f4bd1 : 0xe0561f });
  const band = new THREE.Mesh(new THREE.TorusGeometry(sz * 1.06, sz * 0.13, 8, 28), bandMat); band.rotation.y = Math.PI / 2; band.position.x = -0.9 * sz; body.add(band);
  const finMat = new THREE.MeshLambertMaterial({ color: 0xd5d1c9 });
  for (let f = 0; f < 3; f++) { const fin = new THREE.Mesh(new THREE.BoxGeometry(sz * 1.15, sz * 0.07, sz * 1.0), finMat); const piv = new THREE.Group(); piv.rotation.x = f * 2.094; fin.position.set(-2.25 * sz, 0, sz * 0.75); piv.add(fin); body.add(piv); }
  const pod = new THREE.Mesh(new THREE.BoxGeometry(sz * 0.62, sz * 0.42, sz * 0.52), new THREE.MeshLambertMaterial({ color: 0x24272a })); pod.position.y = -sz * 1.3; body.add(pod);
  const lens = new THREE.Mesh(new THREE.SphereGeometry(sz * 0.2, 10, 8), new THREE.MeshBasicMaterial({ color: relay ? 0x5d9ce6 : 0xff8a3d })); lens.position.y = -sz * 1.55; body.add(lens);
  body.rotation.y = (out.p.seed * 0.37 + 0.6) % 6.28; g.add(body);
  const ground = E.wp(s.x, s.y), top = new THREE.Vector3(s.x / 10, E.Y(s.z0 + p.h), -s.y / 10);
  const teth = new THREE.Line(new THREE.BufferGeometry().setFromPoints([ground, top]), new THREE.LineBasicMaterial({ color: 0x1f2124, transparent: true, opacity: 0.85 }));
  const r = Mo.footR(p, p.h), h = top.y - ground.y, cc = relay ? COL.comm : n.replan ? 0x6f4bd1 : COL.accent;
  const cone = new THREE.Mesh(new THREE.ConeGeometry(1, 1, 64, 1, true), coneMat(cc, 0.11)); cone.scale.set(r / 10, h, r / 10); cone.position.set(top.x, ground.y + h / 2, top.z);
  const ring = E.drapeLine(ringPts(s.x, s.y, r), { color: cc, width: 1.6, offset: 2.5, opacity: 0.9, order: 6 });
  const anchor = new THREE.Mesh(new THREE.CylinderGeometry(sz * 0.35, sz * 0.35, sz * 0.25, 10), new THREE.MeshLambertMaterial({ color: 0x2b2e31 })); anchor.position.copy(ground);
  const wrap = new THREE.Group(); wrap.add(teth, cone, ring, anchor); if (relay) { cone.visible = false; ring.visible = false; }
  const root = new THREE.Group(); root.add(wrap, g); g.position.copy(top); hull.userData = { kind: 'node', idx: i }; E.pickables.push(hull);
  const lbl = E.addLabel(`<b>${n.id}</b> <span class="u">${p.h} m</span>`, s.x, s.y, 0, 'node' + (relay ? ' relay' : '') + (n.replan ? ' replan' : ''), { pos: top.clone(), group: 'nodes' }); lbl.visible = false;
  return { g: root, body: g, hull, teth, cone, ring, wrap, top, ground, lbl, n, k: 1, planned: false, band };
}
function coneMat(color, op) { // translucent volume brighter at the rim (view-dependent), no depth write
  return new THREE.ShaderMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide, uniforms: { col: { value: new THREE.Color(color) }, op: { value: op } },
    vertexShader: `varying vec3 vN; varying vec3 vV; varying float vY; void main(){ vec4 mv=modelViewMatrix*vec4(position,1.0); vN=normalize(normalMatrix*normal); vV=normalize(-mv.xyz); vY=position.y+0.5; gl_Position=projectionMatrix*mv; }`,
    fragmentShader: `uniform vec3 col; uniform float op; varying vec3 vN; varying vec3 vV; varying float vY; void main(){ float rim=1.0-abs(dot(normalize(vN),vV)); float a=op*(0.45+1.4*pow(rim,2.0))*(0.55+0.45*(1.0-vY)); gl_FragColor=vec4(col, clamp(a,0.0,0.6)); }` });
}
function ringPts(x, y, r, n = 96) { const pts = []; for (let i = 0; i <= n; i++) { const a = i / n * Math.PI * 2; pts.push([C.clamp(x + Math.cos(a) * r, -W.T.S / 2, W.T.S / 2), C.clamp(y + Math.sin(a) * r, -W.T.S / 2, W.T.S / 2)]); } return pts; }
/* symbolic scale: aerostats are ~15 m long in reality (invisible at 6 km); keep them at least ~26 px long on screen. Position and height are exact. */
V.symbolic = function () {
  if (!V.nodeObjs) return; const cam = E.cam, h = E.R3.domElement.clientHeight || 800, k = 2 * Math.tan(cam.fov * Math.PI / 360) / h;
  V.nodeObjs.forEach(nb => { if (!nb.g.visible) return; const d = cam.position.distanceTo(nb.top), px = (2.5 * V.asz * 2) / (d * k), s = Math.max(1, (V.minPx || 30) / px); nb.body.scale.setScalar(s * (V.selIdx === nb.i ? 1.25 : 1)); });
};
E.nodeScreen = () => (V.nodeObjs || []).filter(nb => nb.g.visible && nb.body.visible).map((nb, j) => { const p = E.project(nb.body.getWorldPosition(new THREE.Vector3())); return { x: p.x, y: p.y, hull: nb.hull, idx: nb.hull.userData.idx }; });
V.nodeState = function (i, st) { // st: 'hidden' | 'planned' | 'up'
  const nb = V.nodeObjs[i]; if (!nb) return;
  nb.g.visible = st !== 'hidden'; nb.body.visible = st === 'up'; nb.teth.visible = st === 'up'; nb.lbl.visible = st !== 'hidden'; nb.cone.material.uniforms.op.value = st === 'planned' ? 0.16 : 0.1;
  if (nb.n.role === 'relay') { nb.cone.visible = false; nb.ring.visible = false; }
  E.labelsDirty();
};
V.raise = function (i, delay = 0) {
  const nb = V.nodeObjs[i]; V.nodeState(i, 'up'); const y0 = nb.ground.y, y1 = nb.top.y;
  nb.body.position.y = y0; nb.teth.geometry.setFromPoints([nb.ground, new THREE.Vector3(nb.top.x, y0, nb.top.z)]);
  setTimeout(() => E.tween(1100, k => { const y = y0 + (y1 - y0) * E.ease(k); nb.body.position.y = y; nb.teth.geometry.setFromPoints([nb.ground, new THREE.Vector3(nb.top.x, y, nb.top.z)]); }), delay);
};
V.selectNode = function (i) { V.selIdx = i; V.nodeObjs.forEach((nb, j) => { nb.i = j; nb.hull.material.emissive.setHex(j === i ? 0x3a1a08 : 0); nb.cone.material.uniforms.op.value = j === i ? 0.2 : 0.1; if (nb.ring.material) nb.ring.material.linewidth = j === i ? 2.8 : 1.6; }); V.symbolic(); E.kick(); };
V.drift = function (t) { const d = out.p.drift / 10; V.nodeObjs.forEach((nb, i) => { if (!nb.body.visible) return; nb.body.position.x = nb.top.x + Math.sin(t / 3000 + i) * d * 0.4; nb.body.position.z = nb.top.z + Math.cos(t / 3700 + i * 1.7) * d * 0.4; }); };

/* ---------- bars ---------- */
function writeBars(k) {
  const B = out.B; for (let c = 0; c < B.N; c++) { const h = V.barCur[c]; pv.copy(V.barBase[c]); if (h < 0.02) sv.setScalar(1e-4); else sv.set(B.cs / 10 * 0.78, h, B.cs / 10 * 0.78); m4.compose(pv, q0, sv); V.bars.setMatrixAt(c, m4); col.setRGB(V.barCol[c * 3], V.barCol[c * 3 + 1], V.barCol[c * 3 + 2]); V.bars.setColorAt(c, col); }
  V.bars.instanceMatrix.needsUpdate = true; V.bars.instanceColor.needsUpdate = true;
}
V.setBars = function (vals, rampKey, maxV, dimMask) {
  const B = out.B, H = W.T.S / 10 * 0.075; let mx = maxV || 0; if (!mx) for (let c = 0; c < B.N; c++) mx = Math.max(mx, vals[c]);
  for (let c = 0; c < B.N; c++) { const v = vals[c] / (mx || 1); V.barTgt[c] = v > 0.004 ? Math.sqrt(v) * H * (dimMask && dimMask[c] ? 0.3 : 1) : 0; const cc = ramp(Math.sqrt(v), V.RAMP[rampKey]); let f = dimMask && dimMask[c] ? 0.15 : 1; V.barColT[c * 3] = cc.r * f + (1 - f) * 0.36; V.barColT[c * 3 + 1] = cc.g * f + (1 - f) * 0.62; V.barColT[c * 3 + 2] = cc.b * f + (1 - f) * 0.45; }
  const c0 = V.barCur.slice(), col0 = V.barCol.slice();
  E.tween(750, k => { const e = E.ease(k); for (let c = 0; c < B.N; c++) { V.barCur[c] = c0[c] + (V.barTgt[c] - c0[c]) * e; for (let q = 0; q < 3; q++) V.barCol[c * 3 + q] = col0[c * 3 + q] + (V.barColT[c * 3 + q] - col0[c * 3 + q]) * e; } writeBars(); });
  V.barMax = mx;
};

/* ---------- people ---------- */
V.showPeople = function (mode, animate) { // mode: none | detected | truth
  const P = out.P, n = P.n, base = V.sz * 0.75;
  const order = []; for (let i = 0; i < n; i++) order.push(i); order.sort((a, b) => (P.detBy[a] - P.detBy[b]) || (a - b));
  for (let i = 0; i < n; i++) { const det = P.detBy[i] >= 0; let c = COL.hidden, s = 0; if (det && mode !== 'none') { c = P.via[i] === 'thermal' ? COL.thermal : COL.beacon; s = base * (P.prio[i] === 3 ? 1.35 : 1); } else if (mode === 'truth') { c = 0x9a9a92; s = base * 0.8; } V.people.setColorAt(i, col.setHex(c)); V.pTgt[i] = s; }
  V.people.instanceColor.needsUpdate = true; const s0 = V.pScale.slice(), rank = new Float32Array(n); order.forEach((i, r) => rank[i] = r / n);
  E.tween(animate ? 2400 : 400, k => { for (let i = 0; i < n; i++) { const kk = animate ? C.clamp((k - rank[i] * 0.7) / 0.3, 0, 1) : k; V.pScale[i] = s0[i] + (V.pTgt[i] - s0[i]) * E.ease(kk); const p = personPos(i); sv.setScalar(Math.max(1e-4, V.pScale[i])); m4.compose(p, q0, sv); V.people.setMatrixAt(i, m4); } V.people.instanceMatrix.needsUpdate = true; });
};

/* ---------- links ---------- */
V.setLinks = function (idxs, animate) {
  const con = out.steps.deploy.con, I = E.wp(out.M.icp[0], out.M.icp[1], E.hp(12)), gl = V.g.links, fade = out.p.fade;
  while (gl.children.length) { const c = gl.children.pop(); c.geometry.dispose(); }
  const groups = { strong: [], ok: [], relay: [] };
  idxs.forEach(i => { const nb = V.nodeObjs[i], par = con.par[i]; if (par === -2 || par == null) return; if (par >= 0 && !idxs.includes(par)) return; const a = nb.top, b = par === -1 ? I : V.nodeObjs[par].top, m = con.marg[i] ?? 0; (par >= 0 ? groups.relay : m >= fade + 10 ? groups.strong : groups.ok).push(a.x, a.y, a.z, b.x, b.y, b.z); });
  const mk = (arr, color, w, dashed) => { if (!arr.length) return; const g = new THREE.LineSegmentsGeometry(); g.setPositions(arr); const m = new THREE.LineMaterial({ color, linewidth: w, transparent: true, opacity: 0.8, dashed: !!dashed, dashSize: W.T.S / 10 / 120, gapSize: W.T.S / 10 / 200 }); m.resolution.set(E.R3.domElement.clientWidth, E.R3.domElement.clientHeight); E.lineMats.push(m); const L = new THREE.LineSegments2(g, m); if (dashed) L.computeLineDistances(); L.renderOrder = 8; gl.add(L); if (animate) { g.instanceCount = 0; const n = arr.length / 6; E.tween(1400, k => { g.instanceCount = Math.ceil(n * k); }); } };
  mk(groups.strong, 0x1f6fd1, 1.6); mk(groups.ok, 0x5fa8ff, 1.3); mk(groups.relay, 0x7fd0ff, 1.4, true);
  V.linkCounts = { strong: groups.strong.length / 6, ok: groups.ok.length / 6, relay: groups.relay.length / 6 };
};

/* ---------- routes ---------- */
V.buildRoutes = function () {
  const gr = V.g.routes; while (gr.children.length) { const c = gr.children.pop(); c.traverse(x => x.geometry && x.geometry.dispose()); }
  (out.sectors || []).slice(0, 6).forEach((r, i) => { if (!r.route || r.route.path.length < 2) return; const pts = C.subPL(r.route.path, 0, 1, Math.min(400, r.route.path.length * 3)); const grp = new THREE.Group();
    grp.add(E.drapeLine(pts, { color: 0x1d1b18, width: 4.6, offset: 4, opacity: 0.45, order: 7 })); grp.add(E.drapeLine(pts, { color: r.route.boat ? 0x5fb4ff : 0xf6c33b, width: 2.6, offset: 4.4, opacity: 1, order: 8 })); grr(grp); gr.add(grp); });
  function grr(grp) { grp.userData.lines = grp.children; }
};
V.animateRoutes = function () { const ls = []; V.g.routes.children.forEach(gp => gp.children.forEach(l => ls.push(l))); ls.forEach(l => { l.userData.n = l.geometry.attributes.instanceStart.count; l.geometry.instanceCount = 0; }); E.tween(1800, k => ls.forEach(l => { l.geometry.instanceCount = Math.ceil(l.userData.n * k); })); };

/* ---------- highlight ---------- */
V.highlight = function (x, y, r) { const g = V.g.hl; if (x == null) { g.visible = false; return; } const p = E.wp(x, y, 0.3); V.hlRing.position.copy(p); V.hlPole.position.copy(p); V.hlPole.scale.y = W.T.S / 10 * 0.05; V.hlR = (r || out.B.cs * 0.7) / 10; g.visible = true; };

/* ---------- 2D overlay layers ---------- */
V.overlay = {
  damage: (a) => ({ alpha: a, draw: (g, Wd, S) => { const T = out.T, G = T.G, s = Wd / (G - 1); for (let k = 0; k < G * G; k++) { const c = T.cls[k]; if (!out.M.dmg.includes(c) || c === CLS.WATER && out.M.water == null) continue; const i = k % G, j = (k / G) | 0; g.fillStyle = c === CLS.WATER ? 'rgba(60,110,170,0.55)' : c === CLS.RUBBLE ? '#c4362c' : '#d9531e'; g.fillRect(i * s - s / 2, (1 - j / (G - 1)) * Wd - s / 2, s + 0.5, s + 0.5); } } }),
  cells: (vals, rampKey, a, mx) => ({ alpha: a, draw: (g, Wd, S) => { const B = out.B; let m = mx || 0; if (!m) for (let c = 0; c < B.N; c++) m = Math.max(m, vals[c]); for (let c = 0; c < B.N; c++) { const v = vals[c] / (m || 1); if (v < 0.01) continue; g.fillStyle = V.rampHex(Math.sqrt(v), rampKey); E.cellRect(g, Wd, S, B.cx[c], B.cy[c], B.cs); } } }),
  sectors: (a) => ({ alpha: a, draw: (g, Wd, S) => { const B = out.B, pal = ['#d9531e', '#2b6cb0', '#2f8a55', '#b8860b', '#7b4fd6', '#c2185b', '#00838f', '#6d4c41', '#558b2f', '#5e35b1']; for (let c = 0; c < B.N; c++) { const s = out.sec[c]; if (s === -1) continue; g.fillStyle = s === -2 ? '#8a8a8a' : pal[s % pal.length]; E.cellRect(g, Wd, S, B.cx[c], B.cy[c], B.cs); } g.globalAlpha = 1; g.strokeStyle = 'rgba(20,20,20,0.55)'; g.lineWidth = 1.5; for (let c = 0; c < B.N; c++) { const s = out.sec[c]; if (s === -1) continue; const i = c % B.CB, j = (c / B.CB) | 0; const [px, py] = E.toCanvas(B.cx[c] - B.cs / 2, B.cy[c] + B.cs / 2, Wd, S), w = B.cs / S * Wd; if (i + 1 < B.CB && out.sec[c + 1] !== s) { g.beginPath(); g.moveTo(px + w, py); g.lineTo(px + w, py + w); g.stroke(); } if (j + 1 < B.CB && out.sec[c + B.CB] !== s) { g.beginPath(); g.moveTo(px, py); g.lineTo(px + w, py); g.stroke(); } } } }),
  signal: (sg, a) => ({ alpha: a, draw: (g, Wd) => { const n = sg.n, s = Wd / (n - 1); for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) { const v = sg.g[j * n + i]; if (v <= -98) continue; g.fillStyle = V.rampHex((v + 10) / 60, 'sig'); g.fillRect(i * s - s / 2, (1 - j / (n - 1)) * Wd - s / 2, s + 0.6, s + 0.6); } } }),
  launch: (a) => ({ alpha: a, draw: (g, Wd, S) => { out.steps.sites.rejected.forEach(r => { const [x, y] = E.toCanvas(r.x, r.y, Wd, S); g.fillStyle = 'rgba(196,54,44,0.9)'; g.fillRect(x - 3, y - 3, 6, 6); }); } }),
};
})(window.ARES);
