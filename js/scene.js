/* ARES simulation — 3D engine (v4)
   Real-data terrain: Copernicus DEM geometry, Sentinel-2 imagery drape (pre/post), context terrain from the same DEM,
   relief lighting matched to the Sun position of the imagery, baked horizon shadow + AO, hazard glow from the observed
   change mask, scientific colour modes, draped fat lines, camera presets/collision/tour, demand-driven rendering, aerostat feed.
   World units: 1 unit = 10 m. Vertical exaggeration (T.vex) is display-only; the model always uses true metres. */
(function (A) {
'use strict';
const C = A.core, { CLS, mulberry32 } = C;
const E = A.scene = {};
let R3, scene, cam, ctl, heatScene, feedR, feedCam, irMat, container, labelsEl, world = null, sky = null;
const tweens = [], frameHooks = [];
const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
let needsLabel = true, lastCamKey = '', kickUntil = 0, lastAmbient = 0, lastFeed = 0;
let SUN = { az: 150, alt: 50 };
E.lineMats = [];
E.reduce = reduce;

E.ease = t => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
E.tween = (dur, fn, done) => { const tw = { t0: performance.now(), dur: reduce ? 1 : dur, fn, done }; tweens.push(tw); return tw; };
E.cancelTween = tw => { const i = tweens.indexOf(tw); if (i >= 0) tweens.splice(i, 1); };
E.onFrame = (fn, persistent) => { fn.persistent = !!persistent; frameHooks.push(fn); };
E.kick = (ms = 1200) => { kickUntil = Math.max(kickUntil, performance.now() + ms); };

/* ---------- coordinates ---------- */
E.Y = e => (e - world.T.base) / 10 * world.T.vex;
E.H = (x, y) => { const T = world.T, h = T.S / 2; if (Math.abs(x) <= h && Math.abs(y) <= h) return C.elevAt(T, x, y); return ctxH(x, y); };
E.wp = (x, y, zOff = 0) => new THREE.Vector3(x / 10, E.Y(E.H(x, y)) + zOff, -y / 10);
E.hp = h => h / 10 * world.T.vex;
function sunVec() { const sa = SUN.az * Math.PI / 180, se = SUN.alt * Math.PI / 180; return new THREE.Vector3(Math.sin(sa) * Math.cos(se), Math.sin(se), -Math.cos(sa) * Math.cos(se)).normalize(); }

/* ---------- init ---------- */
E.init = function (el, feedCanvas) {
  container = el; labelsEl = el.querySelector('.labels');
  R3 = new THREE.WebGLRenderer({ canvas: el.querySelector('canvas.gl'), antialias: true, powerPreference: 'high-performance', preserveDrawingBuffer: false });
  R3.setPixelRatio(Math.min(devicePixelRatio || 1, 1.75));
  scene = new THREE.Scene(); heatScene = new THREE.Scene();
  cam = new THREE.PerspectiveCamera(36, 1, 1, 40000);
  ctl = new THREE.OrbitControls(cam, R3.domElement); ctl.enableDamping = true; ctl.dampingFactor = 0.085; ctl.rotateSpeed = 0.5; ctl.zoomSpeed = 0.9; ctl.panSpeed = 0.8; ctl.maxPolarAngle = Math.PI * 0.47; ctl.screenSpacePanning = false;
  ctl.addEventListener('change', () => { needsLabel = true; E.kick(400); });
  E.hemi = new THREE.HemisphereLight(0xf3efe6, 0x5c5446, 0.78); scene.add(E.hemi);
  E.sunDir = sunVec(); E.sun = new THREE.DirectionalLight(0xfff4e2, 0.85); E.sun.position.copy(E.sunDir); scene.add(E.sun);
  feedR = new THREE.WebGLRenderer({ canvas: feedCanvas, antialias: false, powerPreference: 'high-performance' }); feedR.setPixelRatio(1);
  feedCam = new THREE.PerspectiveCamera(70, 1.6, 0.5, 8000);
  irMat = new THREE.ShaderMaterial({ uniforms: { sun: { value: E.sunDir } }, vertexShader: `varying vec3 vN; varying float vH; void main(){ vN=normalize(normalMatrix*normal); vec4 w=modelMatrix*vec4(position,1.0); vH=w.y; gl_Position=projectionMatrix*viewMatrix*w; }`,
    fragmentShader: `varying vec3 vN; varying float vH; void main(){ float l=0.35+0.65*max(vN.y,0.0); vec3 c=mix(vec3(0.06,0.02,0.16),vec3(0.36,0.12,0.52),l*0.8); gl_FragColor=vec4(c,1.0); }` });
  ['pointerdown', 'wheel', 'keydown', 'input', 'change', 'click', 'touchstart'].forEach(ev => addEventListener(ev, () => E.kick(1500), { passive: true, capture: true }));
  ['pointerdown', 'wheel', 'touchstart'].forEach(ev => R3.domElement.addEventListener(ev, () => { if (E.touring) E.stopTour(); else if (E.camTween) { E.cancelTween(E.camTween); E.camTween = null; } }, { passive: true }));
  new ResizeObserver(E.resize).observe(el); E.resize();
  requestAnimationFrame(loop);
  E.R3 = R3; E.cam = cam; E.ctl = ctl; E.scene = scene; E.heatScene = heatScene;
};
E.resize = function () {
  const w = container.clientWidth, h = container.clientHeight; if (!w || !h) return; R3.setSize(w, h, false); cam.aspect = w / h; cam.updateProjectionMatrix(); needsLabel = true; E.kick();
  const pr = R3.getPixelRatio(); if (E.terrainMat) E.terrainMat.uniforms.res.value.set(w * pr, h * pr); E.lineMats.forEach(m => m.resolution.set(w, h));
};

/* ---------- shared textures ---------- */
let speckle = null;
function speckleTex() {
  if (speckle) return speckle; const n = 256, c = document.createElement('canvas'); c.width = c.height = n; const g = c.getContext('2d'), im = g.createImageData(n, n), N = C.makeNoise(3), R = mulberry32(5);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) { const k = (j * n + i) * 4;
    const u = i / n * 6.283, v = j / n * 6.283, x = Math.cos(u) * 2, y = Math.sin(u) * 2, z = Math.cos(v) * 2, w = Math.sin(v) * 2; // tileable (torus)
    const r = 0.5 + 0.9 * (N.n2(x * 3 + z * 1.7, y * 3 + w * 1.3) * 0.6 + N.n2(x * 9 + w * 4, z * 9 - y * 4) * 0.4), gg = 0.5 + 0.9 * N.fbm((x + z * 0.5) * 0.8, (y + w * 0.5) * 0.8, 4);
    im.data[k] = C.clamp(r * 255, 0, 255); im.data[k + 1] = C.clamp(gg * 255, 0, 255); im.data[k + 2] = R() * 255; im.data[k + 3] = 255; }
  g.putImageData(im, 0, 0); speckle = new THREE.CanvasTexture(c); speckle.wrapS = speckle.wrapT = THREE.RepeatWrapping; speckle.anisotropy = 4; return speckle;
}
const blankTex = (() => { const t = new THREE.DataTexture(new Uint8Array([128, 128, 128, 255]), 1, 1, THREE.RGBAFormat); t.needsUpdate = true; return t; })();
const texLoader = new THREE.TextureLoader();
E.loadTex = url => new Promise(res => { if (!url) return res(null); texLoader.load(url, t => { t.anisotropy = 8; t.minFilter = THREE.LinearMipmapLinearFilter; res(t); }, undefined, () => res(null)); });

/* ---------- terrain material (shared by analysis area and context terrain) ---------- */
function terrainMaterial(T) {
  return new THREE.ShaderMaterial({
    uniforms: { ov: { value: null }, hz: { value: null }, sc: { value: blankTex }, spk: { value: speckleTex() }, sat: { value: blankTex }, satPre: { value: blankTex }, satCtx: { value: blankTex }, hasSat: { value: 0 }, hasPre: { value: 0 }, hasCtx: { value: 0 }, ctxF: { value: 5 },
      ovOn: { value: 1 }, hazOn: { value: 1 }, hazType: { value: 0 }, pulse: { value: 0 }, mode: { value: 0 }, sun: { value: E.sunDir.clone() }, sunSin: { value: Math.sin(SUN.alt * Math.PI / 180) }, topo: { value: 0 }, contour: { value: 0.0 }, ci: { value: 20 },
      split: { value: -1 }, res: { value: new THREE.Vector2(1, 1) }, fogC: { value: new THREE.Color(0xd9d4c9) }, fogF: { value: 3000 }, ctxOn: { value: 1 }, edgeR: { value: new THREE.Vector2(1e5, 2e5) }, imgPre: { value: 0 }, vex: { value: T.vex }, grade: { value: new THREE.Vector4(1.12, 1.06, 0.92, 0.04) }, detail: { value: 1 } },
    vertexShader: `attribute vec3 color2; attribute float elev; attribute vec2 aLight; attribute float aVeg;
      varying vec3 vC; varying vec3 vC2; varying vec3 vN; varying vec3 vW; varying vec2 vUv; varying vec2 vL; varying float vE; varying float vD; varying float vVeg;
      void main(){ vC=color; vC2=color2; vN=normal; vUv=uv; vE=elev; vL=aLight; vVeg=aVeg; vec4 wp=modelMatrix*vec4(position,1.0); vW=wp.xyz; vec4 mv=viewMatrix*wp; vD=-mv.z; gl_Position=projectionMatrix*mv; }`,
    fragmentShader: `uniform sampler2D ov; uniform sampler2D hz; uniform sampler2D sc; uniform sampler2D spk; uniform sampler2D sat; uniform sampler2D satPre; uniform sampler2D satCtx; uniform float hasSat; uniform float hasPre; uniform float hasCtx; uniform float ctxF;
      uniform float ovOn; uniform float hazOn; uniform float hazType; uniform float pulse; uniform float mode; uniform vec3 sun; uniform float sunSin; uniform float topo; uniform float contour; uniform float ci; uniform float split; uniform vec2 res; uniform vec3 fogC; uniform float fogF; uniform float ctxOn; uniform vec2 edgeR; uniform float imgPre; uniform vec4 grade; uniform float detail;
      varying vec3 vC; varying vec3 vC2; varying vec3 vN; varying vec3 vW; varying vec2 vUv; varying vec2 vL; varying float vE; varying float vD; varying float vVeg;
      float lum(vec3 c){ return dot(c, vec3(0.299,0.587,0.114)); }
      vec3 ramp4(float t, vec3 a, vec3 b, vec3 c, vec3 d){ t=clamp(t,0.0,1.0); return t<0.333 ? mix(a,b,t/0.333) : (t<0.667 ? mix(b,c,(t-0.333)/0.334) : mix(c,d,(t-0.667)/0.333)); }
      vec3 ylorrd(float t){ return ramp4(t, vec3(1.0,0.95,0.70), vec3(0.99,0.70,0.30), vec3(0.89,0.29,0.13), vec3(0.50,0.0,0.15)); }
      vec3 ironbow(float t){ return t<0.5 ? ramp4(t*2.0, vec3(0.03,0.01,0.10), vec3(0.20,0.03,0.40), vec3(0.47,0.06,0.50), vec3(0.75,0.18,0.42)) : ramp4((t-0.5)*2.0, vec3(0.75,0.18,0.42), vec3(0.94,0.40,0.16), vec3(0.99,0.70,0.12), vec3(1.0,0.97,0.78)); }
      vec3 gradeImg(vec3 c){ c = pow(max(c,0.0), vec3(1.0/grade.x)); float l=lum(c); c = mix(vec3(l), c, grade.z); c = c*grade.y + grade.w*vec3(1.0,0.9,0.72); return c; }
      void main(){
        bool inA = vUv.x>=0.0 && vUv.x<=1.0 && vUv.y>=0.0 && vUv.y<=1.0;
        if(!inA && ctxOn<0.5) discard;
        vec3 n=normalize(vN); float ndl=max(dot(n,sun),0.0); float sh=vL.x; float ao=vL.y;
        bool pre = split>0.0 && gl_FragCoord.x < split*res.x;
        bool usePre = (pre || imgPre>0.5) && hasPre>0.5;
        vec3 base = (pre ? vC2 : vC);
        float s1=texture2D(spk, vW.xz*0.07).r; float s2=texture2D(spk, vW.xz*0.016+0.37).g;
        float near = 1.0 - smoothstep(60.0, 420.0, vD);
        bool img = false;
        if(inA && hasSat>0.5){ base = gradeImg(usePre ? texture2D(satPre, vUv).rgb : texture2D(sat, vUv).rgb); img = true; }
        else if(!inA && hasCtx>0.5){ vec2 cu=(vUv-0.5)/ctxF+0.5; base = gradeImg(texture2D(satCtx, cu).rgb); img = true; }
        if(!img){ base *= 0.9 + 0.14*s1 + 0.1*(s2-0.5); base = mix(base, base*vec3(0.52,0.64,0.42), vVeg*smoothstep(0.58,0.74,s1)*0.6); }
        else { base *= 1.0 + detail*near*(0.10*(s1-0.5) + 0.06*(s2-0.5)); }
        // relief lighting relative to flat ground under the same sun (imagery already contains its own shading, so this only enhances relief)
        float rel = (ndl*mix(1.0, sh, 0.75)) / max(sunSin, 0.25);
        float shade = img ? mix(1.0, rel, 0.72) : (0.16 + 0.34*ao + 0.82*ndl*sh)/0.9;
        vec3 lit = base * shade * (img ? (0.9 + 0.1*ao) : 1.0);
        vec3 c = lit;
        float h=vE/ci; float w=fwidth(h); float f=abs(fract(h-0.5)-0.5)/max(w,1e-4); float line=1.0-clamp(f,0.0,1.0); float major=1.0-step(0.5,abs(mod(floor(h+0.5),5.0)));
        vec4 hv = (inA && !pre) ? texture2D(hz, vUv) : vec4(0.0);
        float sv = (inA && !pre) ? texture2D(sc, vUv).r : 0.0;
        float relief = clamp(0.16 + 0.36*ao + 0.62*ndl*sh/max(sunSin,0.25)*0.62, 0.0, 1.25);
        if(mode<0.5){
          if(hazOn>0.5){ float core=hv.r, glow=hv.g, edge=hv.b; float pl = 0.85+0.15*pulse;
            if(hazType<0.5){ // debris / scour: darkened scar, warm interior, glowing amber rim
              vec3 scar = vec3(lum(lit))*vec3(0.70,0.47,0.38)+vec3(0.05,0.012,0.0);
              c = mix(c, scar, core*0.80);
              c += vec3(0.92,0.30,0.08)*core*(0.05+0.07*s1)*pl;
              c += vec3(1.0,0.40,0.10)*edge*0.66*pl + vec3(1.0,0.28,0.05)*clamp(glow-core,0.0,1.0)*0.16*pl;
            } else if(hazType<1.5){ // flood: observed new water + bright rim
              c = mix(c, mix(vec3(0.13,0.30,0.42), vec3(0.30,0.52,0.62), s2*0.6), core*0.72);
              c += vec3(0.60,0.88,1.0)*edge*0.40 + vec3(1.0,0.62,0.20)*edge*0.22*pl;
            } else { // modelled collapse zone (hypothetical)
              c = mix(c, c*vec3(1.0,0.66,0.56), core*0.45); c += vec3(1.0,0.38,0.12)*edge*0.6*pl;
            } }
          c = mix(c, c*0.62, line*contour*(0.3+0.5*major));
        } else if(mode<1.5){
          float g = 0.20+0.85*relief*0.8; c = vec3(g)*vec3(1.0,0.985,0.96);
          c = mix(c, ylorrd(sv), smoothstep(0.02,0.08,sv)*0.86);
          c = mix(c, c*0.6, line*(0.18+0.32*major));
        } else if(mode<2.5){
          float rl = pow(clamp(relief,0.0,1.3), 1.25);
          c = vec3(0.025,0.008,0.075) + vec3(0.30,0.10,0.46)*rl;
          float sq = sqrt(clamp(sv,0.0,1.0));
          c = mix(c, ironbow(0.16+0.84*sq), smoothstep(0.04,0.2,sq)*0.95);
          c += vec3(1.0,0.45,0.75)*hv.b*0.22;
          c = mix(c, c*0.7, line*(0.15+0.25*major));
        } else {
          float g = 0.06 + 0.92*relief*0.85; c = vec3(g)*vec3(0.985,0.985,1.0);
          c = mix(c, c*0.42, line*(0.35+0.5*major));
          if(hazOn>0.5) c = mix(c, c*vec3(1.0,0.74,0.62), hv.r*0.4) + vec3(1.0,0.5,0.2)*hv.b*0.25;
        }
        vec3 tc = mix(vec3(0.95,0.94,0.90), base, 0.35)*(0.86+0.22*ndl); tc = mix(tc, tc*0.55, line*(0.4+0.5*major)); c = mix(c, tc, topo);
        if(inA && !pre){ vec4 o=texture2D(ov,vUv); c=mix(c,o.rgb,o.a*ovOn); }
        if(!inA) c = mix(c, vec3(lum(c))*vec3(1.02,1.0,0.97), 0.04);
        float fg = 1.0-exp(-pow(vD/fogF,1.6)); fg = max(fg, smoothstep(edgeR.x, edgeR.y, length(vW.xz))); c = mix(c, fogC, clamp(fg,0.0,1.0)*(1.0-topo)*0.92);
        if(split>0.0 && abs(gl_FragCoord.x-split*res.x)<1.5) c=vec3(1.0);
        gl_FragColor=vec4(c,1.0); }`,
    vertexColors: true, extensions: { derivatives: true }
  });
}

/* ---------- land-cover colours (fallback albedo when imagery is unavailable) ---------- */
function hexRGB(h) { const c = new THREE.Color(h); return [c.r, c.g, c.b]; }
function colorFor(sc, pal, c, slope, elev, x, y, N) {
  let b = pal[c] || pal[0], r = b[0], g = b[1], bl = b[2]; const rock = pal[CLS.ROCK];
  const n = 0.9 + 0.2 * N.fbm(x / 140, y / 140, 3) + 0.07 * N.n2(x / 25, y / 25);
  if (c === CLS.OPEN || c === CLS.FARM || c === CLS.FOREST) { const s = C.clamp((slope - 0.55) / 0.7, 0, 0.7); r += (rock[0] - r) * s; g += (rock[1] - g) * s; bl += (rock[2] - bl) * s; }
  if (sc.id === 'nepal' && c !== CLS.SNOW) { const a = C.clamp((elev - 2900) / 600, 0, 0.6); r += (rock[0] - r) * a; g += (rock[1] - g) * a; bl += (rock[2] - bl) * a; }
  return [r * n, g * n, bl * n];
}
const VEG = c => c === CLS.FOREST ? 1 : c === CLS.FARM ? 0.55 : c === CLS.OPEN ? 0.3 : 0;

/* ---------- context terrain (outside the analysis area: real DEM when a data pack is loaded; display only) ---------- */
let ctx = null;
function ctxH(x, y) { if (!ctx) return world.T.base; const n = ctx.n, fx = C.clamp((x - ctx.x0) / ctx.dx, 0, n - 1.001), fy = C.clamp((y - ctx.x0) / ctx.dx, 0, n - 1.001), i = fx | 0, j = fy | 0, u = fx - i, v = fy - j, k = j * n + i, e = ctx.h; return (e[k] * (1 - u) + e[k + 1] * u) * (1 - v) + (e[k + n] * (1 - u) + e[k + n + 1] * u) * v; }
function buildContext(sc, T, M) {
  const real = !!M.ctx, n = 161, ext = real ? M.ctx.ext : T.S * 5, x0 = -ext / 2, dx = ext / (n - 1), h = new Float32Array(n * n), half = T.S / 2;
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const x = x0 + i * dx, y = x0 + j * dx, cx = C.clamp(x, -half, half), cy = C.clamp(y, -half, half), dOut = Math.hypot(x - cx, y - cy);
    const eIn = C.elevAt(T, cx, cy), eOut = real ? M.ctx.h[j * n + i] : M.elevFn(x, y);
    h[j * n + i] = dOut < 1 ? eIn : eIn + (eOut - eIn) * C.smooth(0, real ? dx * 1.5 : T.S * 0.18, dOut); // blend only across the seam
  }
  ctx = { n, x0, dx, h, real };
}

/* ---------- baked lighting: sun visibility (soft horizon shadow) + ambient occlusion ---------- */
function bake(xs, ys, hs, vex) {
  const n = xs.length, out = new Float32Array(n * 2), sa = SUN.az * Math.PI / 180, ux = Math.sin(sa), uy = Math.cos(sa), tanA = Math.tan(SUN.alt * Math.PI / 180);
  const dirs = []; for (let a = 0; a < 8; a++) dirs.push([Math.cos(a * Math.PI / 4), Math.sin(a * Math.PI / 4)]);
  for (let k = 0; k < n; k++) {
    const x = xs[k], y = ys[k], h0 = hs[k] * vex; let occ = 0, d = 25;
    for (let s = 0; s < 26 && d < 8000; s++) { const hh = E.H(x + ux * d, y + uy * d) * vex, o = hh - (h0 + d * tanA); if (o > occ) occ = o; d *= 1.24; }
    const shadow = 1 - 0.8 * C.smooth(0, 30, occ);
    let ao = 0; for (const r of [60, 200]) for (const [cx, cy] of dirs) { const dh = E.H(x + cx * r, y + cy * r) * vex - h0; ao += Math.max(0, Math.atan(dh / r)); }
    out[k * 2] = shadow; out[k * 2 + 1] = C.clamp(1 - ao / 16 * 1.4, 0.3, 1);
  }
  return out;
}

/* ---------- world build ---------- */
function disposeTree(o) { o.traverse(n => { if (n.geometry) n.geometry.dispose(); if (n.material) { (Array.isArray(n.material) ? n.material : [n.material]).forEach(m => { if (m.map && m.map !== speckle) m.map.dispose(); m.dispose(); }); } }); }
E.clearWorld = function () {
  if (!world) return; scene.remove(world.root); heatScene.remove(world.heat); disposeTree(world.root); disposeTree(world.heat);
  [E.ovTex, E.hzTex, E.scTex].forEach(t => t && t !== blankTex && t.dispose()); (world.texs || []).forEach(t => t && t.dispose());
  E.lineMats.length = 0; labelsEl.innerHTML = ''; world = null; ctx = null;
  for (let i = frameHooks.length - 1; i >= 0; i--) if (!frameHooks[i].persistent) frameHooks.splice(i, 1);
};

E.buildWorld = function (sc, T, M, tex = {}) {
  E.clearWorld();
  const P = M.pack, sunRec = P && P.aoi.sun && (P.aoi.sun.s2_post || P.aoi.sun.s2_pre);
  SUN = sunRec && sunRec.azimuth != null ? { az: sunRec.azimuth, alt: C.clamp(sunRec.elevation, 25, 65) } : { az: 315, alt: 36 };
  E.sunDir = sunVec(); E.sun.position.copy(E.sunDir); E.sunInfo = sunRec ? `Sun az ${SUN.az.toFixed(0)}°, el ${SUN.alt.toFixed(0)}° (from the imagery acquisition)` : 'Illustrative sun (no imagery)';
  const root = new THREE.Group(), heat = new THREE.Group(); scene.add(root); heatScene.add(heat);
  world = { sc, T, M, root, heat, groups: {}, labels: [], texs: [tex.post, tex.pre, tex.ctx, tex.preVV, tex.postVV].filter(Boolean) }; E.world = world;
  const G = T.G, N = C.makeNoise(7), S = T.S, pal = C.PAL[sc.id].map(hexRGB);
  buildContext(sc, T, M);
  E.ovCanvas = document.createElement('canvas'); E.ovCanvas.width = E.ovCanvas.height = 1024; E.ovCtx = E.ovCanvas.getContext('2d');
  E.ovTex = new THREE.CanvasTexture(E.ovCanvas); E.ovTex.anisotropy = 4;
  E.hzTex = hazardTexture(T, M); E.scTex = null;
  const mat = terrainMaterial(T); E.terrainMat = mat; const u = mat.uniforms; u.ov.value = E.ovTex; u.hz.value = E.hzTex;
  u.hazType.value = M.flood ? 1 : (M.hazard === 'quake' || sc.id === 'delhi') ? 2 : 0;
  E.tex = tex; E.imagery = tex.post ? 'post' : tex.pre ? 'pre' : 'off'; applyImagery();
  if (tex.ctx) { u.satCtx.value = tex.ctx; u.hasCtx.value = 1; u.ctxF.value = (M.ctx ? M.ctx.ext : S * 5) / S; }
  u.sun.value.copy(E.sunDir); u.sunSin.value = Math.sin(SUN.alt * Math.PI / 180); u.vex.value = T.vex;
  // --- analysis-area mesh
  const pos = new Float32Array(G * G * 3), uv = new Float32Array(G * G * 2), el = new Float32Array(G * G), col = new Float32Array(G * G * 3), col2 = new Float32Array(G * G * 3), veg = new Float32Array(G * G), xs = new Float32Array(G * G), ys = new Float32Array(G * G);
  C.forEachV(T, (i, j, x, y, k) => {
    pos[k * 3] = x / 10; pos[k * 3 + 1] = (T.elev[k] - T.base) / 10 * T.vex; pos[k * 3 + 2] = -y / 10; uv[k * 2] = i / (G - 1); uv[k * 2 + 1] = j / (G - 1); el[k] = T.elev[k]; xs[k] = x; ys[k] = y;
    const a = colorFor(sc, pal, T.cls[k], T.slope[k], T.elev[k], x, y, N), b = colorFor(sc, pal, T.preCls[k], T.slope[k], T.pre[k], x, y, N); col.set(a, k * 3); col2.set(b, k * 3); veg[k] = VEG(T.cls[k]);
  });
  const idx = new Uint32Array((G - 1) * (G - 1) * 6); let q = 0;
  for (let j = 0; j < G - 1; j++) for (let i = 0; i < G - 1; i++) { const a = j * G + i, b = a + 1, c = a + G, d = c + 1; idx[q++] = a; idx[q++] = b; idx[q++] = c; idx[q++] = b; idx[q++] = d; idx[q++] = c; }
  const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(pos, 3)); geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2)); geo.setAttribute('elev', new THREE.BufferAttribute(el, 1)); geo.setIndex(new THREE.BufferAttribute(idx, 1));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3)); geo.setAttribute('color2', new THREE.BufferAttribute(col2, 3)); geo.setAttribute('aVeg', new THREE.BufferAttribute(veg, 1));
  geo.setAttribute('aLight', new THREE.BufferAttribute(bake(xs, ys, T.elev, T.vex), 2)); geo.computeVertexNormals();
  const terrain = new THREE.Mesh(geo, mat); terrain.name = 'terrain'; root.add(terrain); world.terrain = terrain;
  // --- context mesh (hole over the analysis area)
  const n = ctx.n, cpos = new Float32Array(n * n * 3), cuv = new Float32Array(n * n * 2), cel = new Float32Array(n * n), ccol = new Float32Array(n * n * 3), cveg = new Float32Array(n * n), cxs = new Float32Array(n * n), cys = new Float32Array(n * n), half = S / 2, cslope = new Float32Array(n * n);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) { const k = j * n + i, i0 = Math.max(0, i - 1), i1 = Math.min(n - 1, i + 1), j0 = Math.max(0, j - 1), j1 = Math.min(n - 1, j + 1); cslope[k] = Math.hypot((ctx.h[j * n + i1] - ctx.h[j * n + i0]) / ((i1 - i0) * ctx.dx), (ctx.h[j1 * n + i] - ctx.h[j0 * n + i]) / ((j1 - j0) * ctx.dx)); }
  const WC = { 10: CLS.FOREST, 20: CLS.OPEN, 30: CLS.OPEN, 40: CLS.FARM, 50: CLS.SETTLE, 60: CLS.ROCK, 70: CLS.SNOW, 80: CLS.WATER };
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const k = j * n + i, x = ctx.x0 + i * ctx.dx, y = ctx.x0 + j * ctx.dx, e = ctx.h[k];
    cpos[k * 3] = x / 10; cpos[k * 3 + 1] = (e - T.base) / 10 * T.vex - 0.05; cpos[k * 3 + 2] = -y / 10; cuv[k * 2] = (x + half) / S; cuv[k * 2 + 1] = (y + half) / S; cel[k] = e; cxs[k] = x; cys[k] = y;
    let c = CLS.OPEN; if (M.ctx && M.ctx.lc) c = WC[M.ctx.lc[k]] ?? CLS.OPEN; else if (M.water != null && e < M.water) c = CLS.WATER; else if (cslope[k] > 1.0) c = CLS.ROCK; else if (N.fbm(x / 420 + 9, y / 420 - 2, 4) > -0.08) c = CLS.FOREST;
    ccol.set(colorFor(sc, pal, c, cslope[k], e, x, y, N), k * 3); cveg[k] = VEG(c);
  }
  const cidx = []; for (let j = 0; j < n - 1; j++) for (let i = 0; i < n - 1; i++) { const xa = ctx.x0 + i * ctx.dx, ya = ctx.x0 + j * ctx.dx; if (xa >= -half - 1 && xa + ctx.dx <= half + 1 && ya >= -half - 1 && ya + ctx.dx <= half + 1) continue; const a = j * n + i, b = a + 1, c = a + n, d = c + 1; cidx.push(a, b, c, b, d, c); }
  const cg = new THREE.BufferGeometry(); cg.setAttribute('position', new THREE.BufferAttribute(cpos, 3)); cg.setAttribute('uv', new THREE.BufferAttribute(cuv, 2)); cg.setAttribute('elev', new THREE.BufferAttribute(cel, 1)); cg.setAttribute('color', new THREE.BufferAttribute(ccol, 3)); cg.setAttribute('color2', new THREE.BufferAttribute(ccol, 3)); cg.setAttribute('aVeg', new THREE.BufferAttribute(cveg, 1)); cg.setAttribute('aLight', new THREE.BufferAttribute(bake(cxs, cys, cel, T.vex), 2)); cg.setIndex(cidx); cg.computeVertexNormals();
  const ctxMesh = new THREE.Mesh(cg, mat); ctxMesh.name = 'context'; root.add(ctxMesh); world.context = ctxMesh; world.ctxSlope = cslope;
  // seam skirt under the analysis edge
  const sk = [], bot = -6; const edge = fn => { for (let t = 0; t < G - 1; t++) { const [k1, k2] = fn(t); const p1 = [pos[k1 * 3], pos[k1 * 3 + 1], pos[k1 * 3 + 2]], p2 = [pos[k2 * 3], pos[k2 * 3 + 1], pos[k2 * 3 + 2]]; sk.push(...p1, p1[0], p1[1] + bot, p1[2], ...p2, ...p2, p1[0], p1[1] + bot, p1[2], p2[0], p2[1] + bot, p2[2]); } };
  edge(t => [t, t + 1]); edge(t => [(G - 1) * G + t + 1, (G - 1) * G + t]); edge(t => [(t + 1) * G, t * G]); edge(t => [t * G + G - 1, (t + 1) * G + G - 1]);
  const skg = new THREE.BufferGeometry(); skg.setAttribute('position', new THREE.Float32BufferAttribute(sk, 3)); skg.computeVertexNormals(); root.add(new THREE.Mesh(skg, new THREE.MeshLambertMaterial({ color: 0x6f6252, side: THREE.DoubleSide })));
  // procedural-fallback flood plane (only when no observed data are loaded)
  if (M.water != null && !M.real) {
    const wm = new THREE.ShaderMaterial({ transparent: true, depthWrite: false, uniforms: { split: u.split, res: u.res, t: { value: 0 }, col: { value: new THREE.Color(0x6f7a72) }, fogC: u.fogC, fogF: u.fogF },
      vertexShader: `varying vec2 vP; varying float vD; void main(){ vP=position.xz; vec4 mv=modelViewMatrix*vec4(position,1.0); vD=-mv.z; gl_Position=projectionMatrix*mv; }`,
      fragmentShader: `uniform float split; uniform vec2 res; uniform float t; uniform vec3 col; uniform vec3 fogC; uniform float fogF; varying vec2 vP; varying float vD; void main(){ if(split>0.0 && gl_FragCoord.x < split*res.x) discard; float r = 0.035*sin(vP.x*0.08+t)+0.035*sin(vP.y*0.11-t*1.3); vec3 c=col*(0.95+r); float fg=1.0-exp(-pow(vD/fogF,1.7)); gl_FragColor=vec4(mix(c,fogC,clamp(fg,0.0,1.0)*0.9),0.84); }` });
    const w = new THREE.Mesh(new THREE.PlaneGeometry(S * 5 / 10, S * 5 / 10, 1, 1).rotateX(-Math.PI / 2), wm); w.position.y = E.Y(M.water); w.renderOrder = 2; root.add(w); world.water = w;
    E.onFrame(t => { wm.uniforms.t.value = t / 900; return true; });
  }
  buildTrees(sc, T, M, root); buildBuildings(sc, T, M, root); buildICP(M, root);
  M.labels.forEach(l => E.addLabel(l.t, l.x, l.y, 30, l.k));
  // highest point in the analysis area (from the DEM) — like a summit marker on a topo map
  { let km = 0; for (let k = 1; k < G * G; k++) if (T.elev[k] > T.elev[km]) km = k; const x = -S / 2 + (km % G) * T.cell, y = -S / 2 + ((km / G) | 0) * T.cell; if (sc.id !== 'delhi' && sc.id !== 'assam') E.addLabel(`▲ ${Math.round(T.elev[km]).toLocaleString('en-IN')} m`, x, y, 15, 'peak'); }
  E.addLabel('ICP · Command post', M.icp[0], M.icp[1], 40, 'icp');
  const aoi = [[-half, -half], [half, -half], [half, half], [-half, half], [-half, -half]];
  world.aoiLine = E.drapeLine(aoi, { color: 0xffffff, width: 1.2, dashed: true, dash: S / 10 / 70, gap: S / 10 / 110, offset: 3, opacity: 0.55, step: S / 160 }); root.add(world.aoiLine);
  // camera framing: look along the hazard's principal axis from its downslope side, terrain filling the frame
  const range = T.top - T.base, d = S / 10;
  mat.uniforms.ci.value = range > 1500 ? 100 : range > 600 ? 50 : range > 150 ? 20 : range > 30 ? 5 : 1;
  const fr = framing(T, M); E.focus = fr;
  const tgt = E.wp(fr.cx, fr.cy, 0); tgt.y = Math.max(tgt.y * 0.75, 0);
  const pit = (sc.id === 'assam' ? 31 : sc.id === 'delhi' ? 34 : sc.id === 'nepal' ? 31 : 21) * Math.PI / 180, dist = C.clamp(fr.R * 2.0 / 10, d * 0.45, d * 1.0), az = fr.az;
  E.home = { pos: new THREE.Vector3(tgt.x + Math.sin(az) * Math.cos(pit) * dist, tgt.y + Math.sin(pit) * dist, tgt.z + Math.cos(az) * Math.cos(pit) * dist), tgt };
  cam.near = d / 400; cam.far = d * 16; cam.updateProjectionMatrix(); ctl.minDistance = d * 0.025; ctl.maxDistance = d * 2.6;
  cam.position.copy(E.home.pos); ctl.target.copy(E.home.tgt); ctl.update();
  mat.uniforms.fogF.value = d * 2.6; mat.uniforms.edgeR.value.set(d * 2.0, d * 2.9); scene.fog = new THREE.Fog(0xd9d4c9, d * 1.6, d * 3.4); buildSky(d);
  E.resize(); needsLabel = true; E.kick(2000); return world;
};
/* framing: centroid and principal axis of the observed hazard (or of the expected-exposure buildings for the hypothetical case) */
function framing(T, M) {
  // frame the hazard AND where people are expected (top belief cells) AND the command post; look along the principal axis from the downhill side
  const G = T.G, h = T.S / 2, pts = [], hz = [], mask = M.hazMask;
  if (mask && mask.some(v => v)) for (let k = 0; k < G * G; k += 2) if (mask[k]) { const p = [-h + (k % G) * T.cell, -h + ((k / G) | 0) * T.cell]; pts.push(p); hz.push(p); }
  M.buildings.forEach((b, i) => { if (b.collapsed || b.flood || (b.occ > 0 && i % 3 === 0)) pts.push([b.x, b.y]); });
  if (M.icp) for (let r = 0; r < 20; r++) pts.push(M.icp);
  if (pts.length < 5) return { cx: 0, cy: 0, az: -16 * Math.PI / 180, R: T.S / 2, bearing: 0 };
  let cx = 0, cy = 0; pts.forEach(p => { cx += p[0]; cy += p[1]; }); cx /= pts.length; cy /= pts.length;
  const ax0 = hz.length > 20 ? hz : pts; let mx = 0, my = 0; ax0.forEach(p => { mx += p[0]; my += p[1]; }); mx /= ax0.length; my /= ax0.length;
  let sxx = 0, syy = 0, sxy = 0; ax0.forEach(p => { const dx = p[0] - mx, dy = p[1] - my; sxx += dx * dx; syy += dy * dy; sxy += dx * dy; });
  const th = 0.5 * Math.atan2(2 * sxy, sxx - syy); let ax = Math.cos(th), ay = Math.sin(th);
  const e1 = C.elevAt(T, C.clamp(cx + ax * 800, -h, h), C.clamp(cy + ay * 800, -h, h)), e0 = C.elevAt(T, C.clamp(cx - ax * 800, -h, h), C.clamp(cy - ay * 800, -h, h)); if (e1 < e0) { ax = -ax; ay = -ay; }
  const ds = pts.map(p => Math.hypot(p[0] - cx, p[1] - cy)).sort((a, b) => a - b), R = ds[Math.floor(ds.length * 0.88)] || T.S / 3;
  const view = Math.atan2(ax, ay) + 0.52;
  cx = C.clamp(cx, -h * 0.6, h * 0.6); cy = C.clamp(cy, -h * 0.6, h * 0.6);
  return { cx, cy, az: Math.atan2(-Math.sin(view), Math.cos(view)), ax, ay, bearing: view, R };
}

function hazardTexture(T, M) {
  const G = T.G, n = 512, src = new Float32Array(G * G), mask = M.hazMask;
  for (let k = 0; k < G * G; k++) src[k] = mask ? (mask[k] ? 1 : 0) : (C.isFlood(M) ? (T.cls[k] === CLS.WATER && T.preCls[k] !== CLS.WATER ? 1 : 0) : (M.dmg.includes(T.cls[k]) ? 1 : 0));
  const core = new Float32Array(n * n);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) { const fx = i / (n - 1) * (G - 1), fy = j / (n - 1) * (G - 1), i0 = Math.min(G - 2, fx | 0), j0 = Math.min(G - 2, fy | 0), u = fx - i0, v = fy - j0, k = j0 * G + i0; core[j * n + i] = (src[k] * (1 - u) + src[k + 1] * u) * (1 - v) + (src[k + G] * (1 - u) + src[k + G + 1] * u) * v; }
  const blur = (s, r, passes) => { let a = s.slice(), b = new Float32Array(n * n); for (let p = 0; p < passes; p++) { for (let j = 0; j < n; j++) { let t = 0; for (let i = -r; i <= r; i++) t += a[j * n + C.clamp(i, 0, n - 1)]; for (let i = 0; i < n; i++) { b[j * n + i] = t / (2 * r + 1); t += a[j * n + Math.min(n - 1, i + r + 1)] - a[j * n + Math.max(0, i - r)]; } } for (let i = 0; i < n; i++) { let t = 0; for (let j = -r; j <= r; j++) t += b[C.clamp(j, 0, n - 1) * n + i]; for (let j = 0; j < n; j++) { a[j * n + i] = t / (2 * r + 1); t += b[Math.min(n - 1, j + r + 1) * n + i] - b[Math.max(0, j - r) * n + i]; } } } return a; };
  const soft = blur(core, 1, 2), glow = blur(core, 6, 3), data = new Uint8Array(n * n * 4);
  for (let k = 0; k < n * n; k++) { const s = C.smooth(0.35, 0.65, soft[k]), e = C.clamp(4 * soft[k] * (1 - soft[k]) * 1.25, 0, 1); data[k * 4] = s * 255; data[k * 4 + 1] = Math.min(1, glow[k] * 1.8) * 255; data[k * 4 + 2] = e * 255; data[k * 4 + 3] = 255; }
  const t = new THREE.DataTexture(data, n, n, THREE.RGBAFormat); t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearFilter; t.needsUpdate = true; return t;
}
function buildSky(d) {
  if (sky) { scene.remove(sky); sky.geometry.dispose(); sky.material.dispose(); }
  sky = new THREE.Mesh(new THREE.SphereGeometry(d * 14, 32, 16), new THREE.ShaderMaterial({ side: THREE.BackSide, depthWrite: false, fog: false, uniforms: { top: { value: new THREE.Color(0x9fb3c4) }, hor: { value: new THREE.Color(0xd9d4c9) } },
    vertexShader: `varying vec3 vP; void main(){ vP=normalize(position); gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
    fragmentShader: `uniform vec3 top; uniform vec3 hor; varying vec3 vP; void main(){ float t=clamp(vP.y*2.4,0.0,1.0); gl_FragColor=vec4(mix(hor,top,pow(t,0.65)),1.0); }` }));
  sky.renderOrder = -10; scene.add(sky); E.applySky();
}
E.skyCols = { top: 0x9fb3c4, hor: 0xd9d4c9 };
E.setSky = (top, hor) => { E.skyCols = { top, hor }; E.applySky(); };
E.applySky = () => { if (sky) { sky.material.uniforms.top.value.set(E.skyCols.top); sky.material.uniforms.hor.value.set(E.skyCols.hor); } if (E.terrainMat) E.terrainMat.uniforms.fogC.value.set(E.skyCols.hor); if (scene.fog) scene.fog.color.set(E.skyCols.hor); scene.background = new THREE.Color(E.skyCols.hor); E.kick(); };
E.setBackground = (hex) => { scene.background = new THREE.Color(hex); E.kick(); };

/* ---------- imagery: post-event / pre-event / off (land-cover shading) ---------- */
function applyImagery() {
  const u = E.terrainMat.uniforms, t = E.tex || {};
  const post = t.post || t.postVV, pre = t.pre || t.preVV;
  u.sat.value = (E.imagery === 'pre' ? pre : post) || pre || blankTex; u.hasSat.value = (E.imagery !== 'off' && (post || pre)) ? 1 : 0;
  u.satPre.value = pre || blankTex; u.hasPre.value = pre ? 1 : 0; u.imgPre.value = 0;
  const radar = (E.imagery === 'pre' ? !t.pre && t.preVV : !t.post && t.postVV);
  u.grade.value.set(radar ? 1.0 : 1.34, radar ? 1.0 : 1.12, radar ? 0 : 0.84, radar ? 0.0 : 0.06);
  E.kick();
}
E.setImagery = function (w) { E.imagery = w; applyImagery(); };
E.imageryAvail = () => { const t = E.tex || {}; return { post: !!(t.post || t.postVV), pre: !!(t.pre || t.preVV), postRadar: !t.post && !!t.postVV, preRadar: !t.pre && !!t.preVV }; };

function buildTrees(sc, T, M, root) {
  const R = mulberry32(42), pts = [], G = T.G, wc = T.wc;
  for (let k = 0; k < G * G; k++) { const c = T.cls[k]; const p = c === CLS.FOREST ? (wc ? 0.55 : 0.42) : (c === CLS.OPEN && sc.id !== 'delhi' ? 0.04 : (c === CLS.FARM && sc.id === 'assam' ? 0.02 : 0)); if (R() < p) { const i = k % G, j = (k / G) | 0; const n = c === CLS.FOREST ? 1 + (R() < 0.5 ? 1 : 0) : 1; for (let q = 0; q < n; q++) pts.push([-T.S / 2 + (i + R() - 0.5) * T.cell, -T.S / 2 + (j + R() - 0.5) * T.cell, c === CLS.FOREST]); } }
  (M.trees || []).forEach(p => pts.push([p[0], p[1], false]));
  const cap = 26000; while (pts.length > cap) pts.splice(Math.floor(R() * pts.length), 1);
  const geoC = new THREE.ConeGeometry(1, 1, 7).translate(0, 0.5, 0), geoS = new THREE.SphereGeometry(1, 7, 5).translate(0, 1, 0);
  const mat = new THREE.MeshLambertMaterial({ color: 0xffffff });
  const nC = pts.filter((_, i) => i % 3 !== 0).length, imC = new THREE.InstancedMesh(geoC, mat, Math.max(1, nC)), imS = new THREE.InstancedMesh(geoS, mat, Math.max(1, pts.length - nC));
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), col = new THREE.Color();
  const greens = sc.id === 'wayanad' ? [0x2c5527, 0x37622f, 0x274c22, 0x456f37] : sc.id === 'nepal' ? [0x34502b, 0x3e5a33, 0x2c4526, 0x4a6038] : [0x3e5a31, 0x486638, 0x34502b, 0x56703d];
  let ic = 0, is = 0;
  pts.forEach(([x, y, forest], i) => { const h = (12 + R() * 14) * (forest ? 1 : 0.7), r = h * (0.24 + R() * 0.08); const sink = forest && M.real ? h * 0.55 : 0.5;
    p.set(x / 10, E.Y(E.H(x, y)) - sink / 10 * T.vex, -y / 10); col.setHex(greens[i % 4]).multiplyScalar(0.8 + R() * 0.35);
    if (i % 3 !== 0) { s.set(r / 10, h / 10 * Math.min(T.vex, 1.4), r / 10); m4.compose(p, q, s); imC.setMatrixAt(ic, m4); imC.setColorAt(ic++, col); }
    else { const rr = h * 0.32; s.set(rr / 10, rr / 10 * 1.15 * Math.min(T.vex, 1.4), rr / 10); m4.compose(p, q, s); imS.setMatrixAt(is, m4); imS.setColorAt(is++, col); } });
  imC.count = ic; imS.count = is; [imC, imS].forEach(m => { m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true; });
  const g = new THREE.Group(); g.add(imC, imS); root.add(g); world.trees = g; world.trees.material = mat;
}
function buildBuildings(sc, T, M, root) {
  const B = M.buildings, geo = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0), mat = new THREE.MeshLambertMaterial({ color: 0xffffff });
  const im = new THREE.InstancedMesh(geo, mat, Math.max(1, B.length)), m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), s = new THREE.Vector3(), p = new THREE.Vector3(), col = new THREE.Color(), R = mulberry32(9);
  const roofs = sc.id === 'delhi' ? [0xd8cfbf, 0xcbbfab, 0xbdb29f, 0xd6c6aa, 0xc4b8a6, 0xe0d8c8] : [0xdcd6c8, 0xb7bec3, 0xc7a88c, 0xc9c2b4, 0xa9b4bb, 0xd2cabb];
  B.forEach((b, i) => { e.set(b.collapsed ? (R() - 0.5) * 0.2 : 0, b.rot, b.collapsed ? (R() - 0.5) * 0.2 : 0); q.setFromEuler(e); p.set(b.x / 10, E.Y(b.base) - 0.15, -b.y / 10); s.set(b.w / 10, Math.max(0.25, b.h / 10 * world.T.bvex), b.d / 10); m4.compose(p, q, s); im.setMatrixAt(i, m4); im.setColorAt(i, col.setHex(b.collapsed ? 0x7a4636 : b.damaged ? 0xa8764c : b.flood ? 0x8fa3ad : roofs[i % roofs.length]).multiplyScalar(0.92 + R() * 0.12)); });
  im.instanceMatrix.needsUpdate = true; if (im.instanceColor) im.instanceColor.needsUpdate = true; root.add(im); world.bldg = im;
}
function buildICP(M, root) {
  const g = new THREE.Group(), d = world.T.S / 10 / 300;
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.15 * d, 0.15 * d, 6 * d, 6), new THREE.MeshLambertMaterial({ color: 0x3a3d40 })); mast.position.y = 3 * d; g.add(mast);
  const tent = new THREE.Mesh(new THREE.ConeGeometry(2.4 * d, 1.8 * d, 4), new THREE.MeshLambertMaterial({ color: 0xe0e4e8 })); tent.position.set(1.8 * d, 0.9 * d, 0); tent.rotation.y = Math.PI / 4; g.add(tent);
  const flag = new THREE.Mesh(new THREE.PlaneGeometry(1.4 * d, 0.9 * d), new THREE.MeshBasicMaterial({ color: 0xd9531e, side: THREE.DoubleSide })); flag.position.set(0.7 * d, 5.5 * d, 0); g.add(flag);
  g.position.copy(E.wp(M.icp[0], M.icp[1])); root.add(g); world.icp = g;
}

/* ---------- visualization modes ---------- */
E.MODES = ['natural', 'hazard', 'thermal', 'gray'];
E.setMode = function (m) {
  const i = Math.max(0, E.MODES.indexOf(m)), u = E.terrainMat.uniforms; u.mode.value = i; E.mode = m;
  const tint = [0xffffff, 0xd9d7d2, 0x2a1840, 0xa9a9a9][i];
  if (world.trees) { world.trees.material.color.setHex(tint); world.trees.visible = i !== 2 && !E.mode2d && E.treesWanted !== false; }
  if (world.bldg) world.bldg.material.color.setHex(i === 2 ? 0x3c2860 : i === 3 ? 0xd0d0d0 : i === 1 ? 0xe8e6e2 : 0xffffff);
  if (world.water) world.water.material.uniforms.col.value.setHex(i === 2 ? 0x150a2a : i === 3 ? 0x8a8a8a : 0x6f7a72);
  E.kick();
};
E.setScalar = function (vals, CB, mx) {
  const data = new Uint8Array(CB * CB * 4); let m = mx || 0; if (!m) for (const v of vals) m = Math.max(m, v); m = m || 1;
  for (let c = 0; c < CB * CB; c++) { data[c * 4] = C.clamp(vals[c] / m, 0, 1) * 255; data[c * 4 + 3] = 255; }
  const t = new THREE.DataTexture(data, CB, CB, THREE.RGBAFormat); t.magFilter = E.gridded ? THREE.NearestFilter : THREE.LinearFilter; t.minFilter = THREE.LinearFilter; t.needsUpdate = true;
  if (E.scTex) E.scTex.dispose(); E.scTex = t; E.terrainMat.uniforms.sc.value = t; E.kick(); return m;
};

/* ---------- draped fat lines ---------- */
E.drapeLine = function (pts, o = {}) {
  const step = o.step || world.T.cell * 0.75, off = E.hp(o.offset ?? 4), out = [];
  for (let i = 0; i < pts.length - 1; i++) { const [ax, ay] = pts[i], [bx, by] = pts[i + 1], L = Math.hypot(bx - ax, by - ay), n = Math.max(1, Math.ceil(L / step)); for (let s = 0; s < n; s++) { const t = s / n, x = ax + (bx - ax) * t, y = ay + (by - ay) * t; out.push(x / 10, E.Y(E.H(x, y) + (o.surf ? C.surfAt(world.T, x, y) - C.elevAt(world.T, x, y) : 0)) + off, -y / 10); } }
  const l = pts[pts.length - 1]; out.push(l[0] / 10, E.Y(E.H(l[0], l[1])) + off, -l[1] / 10);
  const g = new THREE.LineGeometry(); g.setPositions(out);
  const m = new THREE.LineMaterial({ color: o.color ?? 0xffffff, linewidth: o.width || 2, transparent: true, opacity: o.opacity ?? 1, dashed: !!o.dashed, dashSize: o.dash || 2, gapSize: o.gap || 1.2, depthTest: o.depthTest ?? true, depthWrite: false });
  m.resolution.set(container.clientWidth, container.clientHeight); E.lineMats.push(m);
  const line = new THREE.Line2(g, m); if (o.dashed) line.computeLineDistances(); line.renderOrder = o.order || 3; return line;
};
E.drapeSegments = function (polys, o = {}) { // many polylines in ONE draw call (LineSegments2)
  const step = o.step || world.T.cell * 0.75, off = E.hp(o.offset ?? 4), out = [];
  for (const pts of polys) { let prev = null; for (let i = 0; i < pts.length - 1; i++) { const [ax, ay] = pts[i], [bx, by] = pts[i + 1], L = Math.hypot(bx - ax, by - ay), n = Math.max(1, Math.ceil(L / step)); for (let s = 0; s <= n; s++) { const t = s / n, x = ax + (bx - ax) * t, y = ay + (by - ay) * t, p = [x / 10, E.Y(E.H(x, y)) + off, -y / 10]; if (prev && s > 0) out.push(...prev, ...p); prev = p; } } }
  const g = new THREE.LineSegmentsGeometry(); g.setPositions(out);
  const m = new THREE.LineMaterial({ color: o.color ?? 0xffffff, linewidth: o.width || 2, transparent: true, opacity: o.opacity ?? 1, depthTest: true, depthWrite: false });
  m.resolution.set(container.clientWidth, container.clientHeight); E.lineMats.push(m);
  const line = new THREE.LineSegments2(g, m); line.renderOrder = o.order || 3; return line;
};
E.marker = function (x, y, o = {}) {
  const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d'); g.shadowColor = 'rgba(0,0,0,.45)'; g.shadowBlur = 6; g.strokeStyle = o.ring || '#f2b632'; g.lineWidth = 7; g.beginPath(); g.arc(32, 32, 22, 0, 6.283); g.stroke(); g.shadowBlur = 0; g.fillStyle = o.fill || '#ffffff'; g.beginPath(); g.arc(32, 32, 12, 0, 6.283); g.fill(); g.fillStyle = o.ring || '#f2b632'; g.beginPath(); g.arc(32, 32, 7, 0, 6.283); g.fill();
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), depthTest: false, sizeAttenuation: false })); sp.scale.setScalar(o.size || 0.024); sp.position.copy(E.wp(x, y, E.hp(o.z ?? 8))); sp.renderOrder = 8; return sp;
};
E.glow = function (x, y, o = {}) {
  const c = document.createElement('canvas'); c.width = c.height = 128; const g = c.getContext('2d'), gr = g.createRadialGradient(64, 64, 0, 64, 64, 64); gr.addColorStop(0, 'rgba(255,250,230,1)'); gr.addColorStop(0.16, 'rgba(255,214,130,0.92)'); gr.addColorStop(0.42, 'rgba(255,128,40,0.38)'); gr.addColorStop(1, 'rgba(255,90,20,0)'); g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true })); sp.scale.setScalar(o.size || world.T.S / 10 * 0.05); sp.position.copy(E.wp(x, y, E.hp(o.z ?? 12))); sp.renderOrder = 7; return sp;
};
E.arrowHead = function (x, y, dx, dy, o = {}) {
  const s = o.size || world.T.S / 10 * 0.0075, g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, s * 1.4, -s * 0.8, 0, -s * 0.5, s * 0.8, 0, -s * 0.5], 3));
  const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: o.color ?? 0xf05a24, side: THREE.DoubleSide, depthTest: true, transparent: true, opacity: 0.95 })); const p = E.wp(x, y, E.hp(o.z ?? 6)); m.position.copy(p); m.lookAt(p.x + dx, p.y, p.z - dy); m.renderOrder = 5; return m;
};

/* ---------- labels (HTML, decluttered) ---------- */
E.addLabel = function (text, x, y, zOff, kind, opts = {}) {
  const el = document.createElement('div'); el.className = 'lbl ' + (kind || ''); el.innerHTML = text; labelsEl.appendChild(el);
  const L = { el, pos: opts.pos || E.wp(x, y, E.hp(zOff || 20)), kind, visible: true, group: opts.group || null, pri: opts.pri ?? ({ icp: 0, mark: 1, event: 1, sector: 2, node: 2, peak: 4, town: 3, water: 5 }[kind] ?? 3) }; world.labels.push(L); needsLabel = true; return L;
};
E.removeLabels = function (group) { world.labels = world.labels.filter(L => { if (L.group === group) { L.el.remove(); return false; } return true; }); };
E.labelsDirty = () => { needsLabel = true; E.kick(); };
const v3 = new THREE.Vector3();
function updateLabels() {
  const w = container.clientWidth, h = container.clientHeight, placed = [], cr = container.getBoundingClientRect();
  // UI controls floating over the map are exclusion zones for labels
  container.querySelectorAll('.vctl,.vtools,.legend,.srcbadge,.stagecap,.compass,.feed:not([hidden])').forEach(el => { if (el.hidden || !el.offsetWidth) return; const r = el.getBoundingClientRect(); placed.push([r.left - cr.left - 4, r.top - cr.top - 4, r.right - cr.left + 4, r.bottom - cr.top + 4]); });
  const order = world.labels.slice().sort((a, b) => a.pri - b.pri);
  for (const L of order) {
    if (!L.visible) { L.el.style.display = 'none'; continue; }
    v3.copy(L.pos).project(cam); let vis = v3.z < 1 && v3.x > -1.05 && v3.x < 1.05 && v3.y > -1.05 && v3.y < 1.05;
    const px = (v3.x + 1) / 2 * w, py = (1 - v3.y) / 2 * h;
    let qx = px;
    if (vis) { if (!L.bw || L.el.style.display !== 'none') { const d0 = L.el.style.display; L.el.style.display = ''; L.bw = L.el.offsetWidth || L.bw || 80; L.bh = L.el.offsetHeight || L.bh || 18; L.el.style.display = d0; } const bw = L.bw, bh = L.bh; qx = C.clamp(px, bw / 2 + 6, w - bw / 2 - 6); const box = [qx - bw / 2, py - bh, qx + bw / 2, py];
      if (L.pri >= 1 && placed.some(b => !(box[2] < b[0] || box[0] > b[2] || box[3] < b[1] || box[1] > b[3]))) vis = false; else placed.push(box); }
    L.el.style.display = vis ? '' : 'none'; if (vis) L.el.style.transform = `translate(${qx.toFixed(1)}px,${py.toFixed(1)}px) translate(-50%,-100%)`;
  }
}
E.project = (p) => { v3.copy(p).project(cam); return { x: (v3.x + 1) / 2 * container.clientWidth, y: (1 - v3.y) / 2 * container.clientHeight, ok: v3.z < 1 }; };

/* ---------- overlay painting ---------- */
E.paintOverlay = function (layers) {
  const g = E.ovCtx, W = 1024, S = world.T.S; g.clearRect(0, 0, W, W);
  for (const L of layers) { if (!L || L.alpha <= 0) continue; g.globalAlpha = L.alpha; L.draw(g, W, S); }
  g.globalAlpha = 1; E.ovTex.needsUpdate = true; E.kick();
};
E.cellRect = (g, W, S, cx, cy, cs) => { const px = (cx - cs / 2 + S / 2) / S * W, py = (1 - (cy + cs / 2 + S / 2) / S) * W, s = cs / S * W; g.fillRect(px, py, s + 0.6, s + 0.6); };
E.toCanvas = (x, y, W, S) => [(x + S / 2) / S * W, (1 - (y + S / 2) / S) * W];

/* ---------- camera ---------- */
E.flyPose = function (pos, tgt, dur = 1400, done) {
  if (E.camTween) E.cancelTween(E.camTween);
  const p0 = cam.position.clone(), t0 = ctl.target.clone(), mid = p0.clone().lerp(pos, 0.5); mid.y = Math.max(mid.y, Math.max(p0.y, pos.y) * 1.04);
  E.camTween = E.tween(dur, k => { const e = E.ease(k), a = p0.clone().lerp(mid, e), b = mid.clone().lerp(pos, e); cam.position.copy(a.lerp(b, e)); ctl.target.lerpVectors(t0, tgt, e); needsLabel = true; }, () => { E.camTween = null; done && done(); });
  return E.camTween;
};
E.poseLooking = function (x, y, distF, pitchDeg = 32, azDeg = null, zOff = 0) {
  const tgt = E.wp(x, y, zOff), d = world.T.S / 10 * distF, cur = cam.position.clone().sub(ctl.target); let az = azDeg != null ? azDeg * Math.PI / 180 : Math.atan2(cur.x, cur.z);
  const pr = pitchDeg * Math.PI / 180; return { pos: new THREE.Vector3(tgt.x + Math.sin(az) * Math.cos(pr) * d, tgt.y + Math.sin(pr) * d, tgt.z + Math.cos(az) * Math.cos(pr) * d), tgt };
};
E.flyTo = function (x, y, distF = 0.35, zOff = 0) {
  if (E.mode2d) { const tgt = E.wp(x, y, zOff); return E.flyPose(new THREE.Vector3(tgt.x, tgt.y + world.T.S / 10 * distF * 1.4, tgt.z + 0.01), tgt, 900); }
  const dir = cam.position.clone().sub(ctl.target); const pitch = Math.max(24, Math.min(55, Math.asin(dir.y / dir.length()) * 57.3)); const p = E.poseLooking(x, y, distF, pitch, null, zOff); return E.flyPose(p.pos, p.tgt, 1100);
};
E.goHome = function () { return E.flyPose(E.home.pos, E.home.tgt, 1300); };
E.set2D = function (on) {
  E.mode2d = on; const u = E.terrainMat.uniforms, p0 = cam.position.clone(), t0 = ctl.target.clone(), d = world.T.S / 10;
  const tgt = on ? new THREE.Vector3(0, 0, 0) : E.home.tgt, pos = on ? new THREE.Vector3(0, d * 1.25, 0.001) : E.home.pos;
  ctl.enableRotate = !on; if (world.trees) world.trees.visible = !on && E.treesWanted !== false; if (world.context) world.context.visible = !on;
  E.tween(800, k => { const e = E.ease(k); cam.position.lerpVectors(p0, pos, e); ctl.target.lerpVectors(t0, tgt, e); u.topo.value = on ? e * 0.0 : 0; });
};
E.zoom = f => { const dir = cam.position.clone().sub(ctl.target); const p0 = cam.position.clone(), p1 = ctl.target.clone().add(dir.multiplyScalar(f)); E.tween(450, k => cam.position.lerpVectors(p0, p1, E.ease(k))); };
E.azimuth = () => ctl.getAzimuthalAngle();
E.metresPerPx = () => { const d = cam.position.distanceTo(ctl.target); return 2 * d * Math.tan(cam.fov * Math.PI / 360) / container.clientHeight * 10; };
E.zoomFactor = () => world ? (world.T.S / 10 * 0.84) / cam.position.distanceTo(ctl.target) : 1;
E.tour = function (poses, onEnd, onStep) {
  E.touring = true; let i = 0; ctl.enabled = false;
  const next = () => { if (!E.touring) return; if (i >= poses.length) { E.stopTour(); onEnd && onEnd(); return; } const p = poses[i++]; onStep && onStep(p, i - 1); E.flyPose(p.pos, p.tgt, p.dur || 3200, () => { E.tourHold = setTimeout(next, p.hold ?? 900); }); };
  next();
};
E.stopTour = function () { if (!E.touring) return; E.touring = false; clearTimeout(E.tourHold); if (E.camTween) { E.cancelTween(E.camTween); E.camTween = null; } ctl.enabled = true; E.onTourEnd && E.onTourEnd(); };

/* ---------- picking (screen-space tolerance for small objects) ---------- */
const ray = new THREE.Raycaster(), mv = new THREE.Vector2(); let downXY = null;
E.pickables = [];
E.enablePick = function (cb, hover) {
  const el = R3.domElement;
  el.addEventListener('pointerdown', e => { downXY = [e.clientX, e.clientY]; });
  el.addEventListener('pointerup', e => { if (!downXY || Math.hypot(e.clientX - downXY[0], e.clientY - downXY[1]) > 5) return; cb(pickAt(e)); });
  if (hover) { let h = 0; el.addEventListener('pointermove', e => { if (e.buttons) return; cancelAnimationFrame(h); h = requestAnimationFrame(() => hover(pickAt(e, true), e)); }); }
};
function pickAt(e, light) {
  const r = R3.domElement.getBoundingClientRect(); mv.set((e.clientX - r.left) / r.width * 2 - 1, -(e.clientY - r.top) / r.height * 2 + 1); ray.setFromCamera(mv, cam);
  // screen-space proximity for aerostats (they are drawn at symbolic scale)
  if (E.nodeScreen) { let best = null, bd = 22; for (const n of E.nodeScreen()) { const d = Math.hypot(n.x - (e.clientX - r.left), n.y - (e.clientY - r.top)); if (d < bd) { bd = d; best = n; } } if (best) return { object: best.hull, node: best.idx }; }
  if (light) return null;
  const objs = E.pickables.filter(o => o.visible && (!o.parent || o.parent.visible)); const hits = ray.intersectObjects(objs, false);
  if (hits.length) return hits[0];
  const t = ray.intersectObject(world.terrain, false)[0]; return t ? { terrain: true, point: t.point } : null;
}

/* ---------- compare & before/after ---------- */
E.compare = null;
E.setSplit = v => { if (E.terrainMat) E.terrainMat.uniforms.split.value = v; E.kick(); };

/* ---------- aerostat feed (nadir camera from the selected aerostat) ---------- */
E.feed = { on: false, node: null, mode: 'EO' };
function renderFeed() {
  const f = E.feed; if (!f.on || !f.node) return;
  const c = feedR.domElement, w = c.clientWidth, h = c.clientHeight; if (!w) return;
  if (c.width !== w || c.height !== h) feedR.setSize(w, h, false);
  feedCam.aspect = w / h; feedCam.fov = Math.min(110, f.fov || 90); feedCam.updateProjectionMatrix();
  const p = f.node.getWorldPosition(new THREE.Vector3()); feedCam.position.set(p.x, p.y - 0.4, p.z); feedCam.up.set(0, 0, -1); feedCam.lookAt(p.x, p.y - 100, p.z);
  const hide = (E.feedHide || []).concat(sky ? [sky] : []); const st = hide.map(o => o.visible); hide.forEach(o => o.visible = false);
  if (f.mode === 'IR') { scene.overrideMaterial = irMat; const bg = scene.background, fog = scene.fog; scene.background = new THREE.Color(0x0b0616); scene.fog = null; feedR.render(scene, feedCam); scene.overrideMaterial = null; scene.background = bg; scene.fog = fog; feedR.autoClear = false; feedR.render(heatScene, feedCam); feedR.autoClear = true; }
  else feedR.render(scene, feedCam);
  hide.forEach((o, i) => o.visible = st[i]);
}

/* ---------- loop (demand-driven) ---------- */
function keepAboveGround() {
  if (!world) return; const x = cam.position.x * 10, y = -cam.position.z * 10, g = E.Y(E.H(x, y)) + world.T.S / 10 * 0.01;
  if (cam.position.y < g) { cam.position.y = g; }
}
E.stats = { frames: 0, rendered: 0, last: 0, ms: [] };
function loop(t) {
  requestAnimationFrame(loop);
  const hadTween = tweens.length > 0;
  for (let i = tweens.length - 1; i >= 0; i--) { const tw = tweens[i]; if (!tw) continue; const k = Math.min(1, (t - tw.t0) / tw.dur); tw.fn(k); if (k >= 1) { tweens.splice(i, 1); tw.done && tw.done(); } }
  if (!world || !container.clientWidth) return;
  const moved = ctl.update(); keepAboveGround();
  const ambientDue = t - lastAmbient > 66; let ambient = false;
  if (ambientDue) { for (const fn of frameHooks) if (fn(t)) ambient = true; if (E.terrainMat) E.terrainMat.uniforms.pulse.value = reduce ? 0.5 : 0.5 + 0.5 * Math.sin(t / 700); lastAmbient = t; }
  const active = hadTween || moved || t < kickUntil || (ambient && ambientDue) || E.touring;
  const key = cam.position.x.toFixed(2) + cam.position.y.toFixed(2) + cam.position.z.toFixed(2) + ctl.target.x.toFixed(2) + ctl.target.z.toFixed(2);
  if (key !== lastCamKey) { needsLabel = true; lastCamKey = key; }
  E.stats.frames++;
  if (active || needsLabel) {
    const t0 = performance.now();
    if (E.compare) {
      const w = container.clientWidth, h = container.clientHeight; R3.setScissorTest(true); cam.aspect = (w / 2) / h; cam.updateProjectionMatrix();
      const L = E.compare.left, Rr = E.compare.right;
      L.forEach(o => o.visible = true); Rr.forEach(o => o.visible = false); R3.setViewport(0, 0, w / 2, h); R3.setScissor(0, 0, w / 2, h); R3.render(scene, cam);
      L.forEach(o => o.visible = false); Rr.forEach(o => o.visible = true); R3.setViewport(w / 2, 0, w / 2, h); R3.setScissor(w / 2, 0, w / 2, h); R3.render(scene, cam);
      L.forEach(o => o.visible = true); R3.setScissorTest(false); R3.setViewport(0, 0, w, h); cam.aspect = w / h; cam.updateProjectionMatrix();
    } else R3.render(scene, cam);
    E.stats.rendered++; E.stats.ms.push(performance.now() - t0); if (E.stats.ms.length > 120) E.stats.ms.shift();
  }
  if (needsLabel) { updateLabels(); needsLabel = false; if (world.trees) { const near = cam.position.distanceTo(ctl.target) < world.T.S / 10 * 0.42; const want = E.treesWanted !== false && !E.mode2d && E.mode !== 'thermal'; if (world.trees.visible !== (want && near)) { world.trees.visible = want && near; E.kick(200); } } E.onCamera && E.onCamera(); }
  if (E.feed.on && t - lastFeed > 66) { renderFeed(); lastFeed = t; }
}
})(window.ARES);
