import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

/* ============================================================
   STATE — full expression model (not just a op b)
   expr examples: "12+7×(3−√(9))+π^2", "50%", "(−5)"
============================================================ */
let expr = '';
let justEvaluated = false;
let lastResult = null;
let memory = 0;
let history = [];
try {
  history = JSON.parse(localStorage.getItem('calc3d-history') || '[]');
} catch { history = []; }

const expr2d = document.getElementById('expr2d');
const preview2d = document.getElementById('preview2d');
const memBadge = document.getElementById('mem-badge');
const ansBadge = document.getElementById('ans-badge');
const historyList = document.getElementById('history-list');
const memValue = document.getElementById('mem-value');
const toast = document.getElementById('toast');
let toastTimer;
function showToast(msg, ok = false) {
  toast.textContent = msg;
  toast.classList.toggle('ok', ok);
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), 1700);
}

/* ---------------- expression engine ---------------- */
const PRETTY = { '*': '×', '/': '÷', '-': '−' };
function pretty(s) {
  return s.replaceAll('*', '×').replaceAll('/', '÷').replace(/(?<!\w)-/g, '−');
}
function fmt(n) {
  if (!isFinite(n)) return 'Error';
  const r = Math.round(n * 1e10) / 1e10;
  if (r === 0) return '0';
  let s = String(r);
  if (s.length > 14) s = r.toExponential(6);
  return s;
}

// Tokenizer: numbers, π, √ func, operators + - * / % ^, parens
function tokenize(src) {
  const tokens = [];
  let i = 0;
  const s = src.replaceAll('×', '*').replaceAll('÷', '/').replaceAll('−', '-');
  while (i < s.length) {
    const c = s[i];
    if (c === ' ' || c === ',') { i++; continue; }
    if (/[0-9.]/.test(c)) {
      let num = '';
      let dots = 0;
      while (i < s.length && /[0-9.]/.test(s[i])) {
        if (s[i] === '.') { dots++; if (dots > 1) throw new Error('Bad number'); }
        num += s[i++];
      }
      if (num === '.') throw new Error('Bad number');
      tokens.push({ t: 'num', v: parseFloat(num) });
      continue;
    }
    if (c === 'π') { tokens.push({ t: 'num', v: Math.PI }); i++; continue; }
    if (c === '√' || c === 's' || c === 'S') {
      // allow √ alone or √( ; normalize: √ always function
      tokens.push({ t: 'func', v: 'sqrt' }); i++; continue;
    }
    if ('+-*/%^()'.includes(c)) {
      tokens.push({ t: c === '(' || c === ')' ? 'paren' : 'op', v: c });
      i++;
      continue;
    }
    throw new Error('Bad token: ' + c);
  }
  return tokens;
}

// Shunting-yard with unary minus + postfix % + func sqrt + right-assoc ^
function toRPN(tokens) {
  const out = [];
  const stack = [];
  const prec = { '+': 2, '-': 2, '*': 3, '/': 3, '%': 4, '^': 5, 'u-': 6 };
  const rightAssoc = new Set(['^', 'u-']);
  let prev = null;
  for (const tok of tokens) {
    if (tok.t === 'num') { out.push(tok); prev = tok; continue; }
    if (tok.t === 'func') { stack.push(tok); prev = tok; continue; }
    if (tok.t === 'paren' && tok.v === '(') { stack.push(tok); prev = tok; continue; }
    if (tok.t === 'paren' && tok.v === ')') {
      while (stack.length && !(stack[stack.length - 1].t === 'paren' && stack[stack.length - 1].v === '(')) {
        out.push(stack.pop());
      }
      if (!stack.length) throw new Error('Mismatched ()');
      stack.pop();
      if (stack.length && stack[stack.length - 1].t === 'func') out.push(stack.pop());
      prev = { t: 'num' };
      continue;
    }
    // operator
    let op = tok.v;
    if (op === '%') { out.push({ t: 'op', v: '%' }); prev = { t: 'num' }; continue; } // postfix
    const isUnary = (op === '-' || op === '+') &&
      (prev === null || (prev.t === 'op' && prev.v !== '%') ||
        (prev.t === 'paren' && prev.v === '(') || prev.t === 'func');
    if (isUnary) {
      if (op === '+') { prev = tok; continue; } // unary plus: ignore
      op = 'u-';
    }
    while (stack.length) {
      const top = stack[stack.length - 1];
      if (top.t === 'func') { out.push(stack.pop()); continue; }
      if (top.t !== 'op') break;
      const pTop = prec[top.v] || 0;
      const pCur = prec[op] || 0;
      if (pTop > pCur || (pTop === pCur && !rightAssoc.has(op))) out.push(stack.pop());
      else break;
    }
    stack.push({ t: 'op', v: op });
    prev = tok;
  }
  while (stack.length) {
    const t = stack.pop();
    if (t.t === 'paren') throw new Error('Mismatched ()');
    out.push(t);
  }
  return out;
}

function evalRPN(rpn) {
  const st = [];
  for (const tok of rpn) {
    if (tok.t === 'num') { st.push(tok.v); continue; }
    if (tok.t === 'func') {
      if (!st.length) throw new Error('Bad √');
      const a = st.pop();
      if (a < 0) throw new Error('√ of negative');
      st.push(Math.sqrt(a));
      continue;
    }
    if (tok.v === '%') {
      if (!st.length) throw new Error('Bad %');
      st.push(st.pop() / 100);
      continue;
    }
    if (tok.v === 'u-') {
      if (!st.length) throw new Error('Bad −');
      st.push(-st.pop());
      continue;
    }
    if (st.length < 2) throw new Error('Incomplete');
    const b = st.pop(), a = st.pop();
    if (tok.v === '+') st.push(a + b);
    else if (tok.v === '-') st.push(a - b);
    else if (tok.v === '*') st.push(a * b);
    else if (tok.v === '/') {
      if (b === 0) throw new Error('Cannot divide by zero');
      st.push(a / b);
    } else if (tok.v === '^') st.push(Math.pow(a, b));
  }
  if (st.length !== 1) throw new Error('Incomplete');
  return st[0];
}

function autoClose(s) {
  const open = (s.match(/\(/g) || []).length - (s.match(/\)/g) || []).length;
  return s + ')'.repeat(Math.max(0, open));
}

function tryEvaluate(raw, closeParens = true) {
  if (!raw || !raw.trim()) return { ok: false };
  try {
    const src = closeParens ? autoClose(raw) : raw;
    const val = evalRPN(toRPN(tokenize(src)));
    return { ok: true, value: Math.round(val * 1e10) / 1e10 };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/* ---------------- input operations ---------------- */
function insertText(t) {
  if (justEvaluated) {
    if (/^[0-9.(√π]/.test(t)) { expr = ''; } // fresh start on number-like
    justEvaluated = false;
  }
  // avoid two binary operators in a row (allow unary minus, ^, √, ()
  const last = expr.slice(-1);
  const binaryOps = '+-*/^';
  if (binaryOps.includes(t) && binaryOps.includes(last) && !(t === '-' && last !== '-')) {
    expr = expr.slice(0, -1) + t; // replace
  } else {
    if (expr.replace(/[^0-9]/g, '').length > 40 && /[0-9.]/.test(t)) {
      showToast('Digit limit reached');
      return;
    }
    expr += t;
  }
  updateDisplay();
}

function backspaceExpr() {
  if (justEvaluated) { clearAll(); return; }
  expr = expr.slice(0, -1);
  updateDisplay();
}

function clearAll() {
  expr = '';
  justEvaluated = false;
  updateDisplay();
}

function negateTail() {
  if (justEvaluated && lastResult !== null) {
    expr = fmt(-lastResult);
    justEvaluated = false;
    updateDisplay();
    return;
  }
  if (!expr) { expr = '-'; updateDisplay(); return; }
  // unwrap (−X) at end
  const unwrap = expr.match(/\(\-([^()]+)\)$/);
  if (unwrap) {
    expr = expr.slice(0, expr.length - unwrap[0].length) + unwrap[1];
    updateDisplay();
    return;
  }
  const m = expr.match(/(\d+\.?\d*|π)$/);
  if (m) {
    const start = expr.length - m[0].length;
    expr = expr.slice(0, start) + '(-' + m[0] + ')';
  } else if (expr.endsWith(')')) {
    expr = '-(' + expr + ')'; // fallback
  } else {
    expr += '(-';
  }
  updateDisplay();
}

function currentValue() {
  const r = tryEvaluate(expr);
  if (r.ok) return r.value;
  if (justEvaluated && lastResult !== null) return lastResult;
  return 0;
}

function doEquals(fromUI = true) {
  if (!expr) return;
  const r = tryEvaluate(expr, true);
  if (!r.ok) { showToast(r.error || 'Invalid expression'); return; }
  const prettyExpr = pretty(autoClose(expr));
  expr = fmt(r.value);
  lastResult = r.value;
  justEvaluated = true;
  pushHistory(prettyExpr, expr);
  updateDisplay();
  if (fromUI) popDisplay();
  blip(660, 0.09);
  setTimeout(() => blip(880, 0.12), 90);
}

/* ---------------- memory ---------------- */
function memOp(op) {
  if (op === 'MC') { memory = 0; showToast('Memory cleared', true); }
  else if (op === 'MR') {
    const s = fmt(memory);
    if (justEvaluated) { expr = s; justEvaluated = false; }
    else expr += s;
  }
  else if (op === 'M+') { memory = Math.round((memory + currentValue()) * 1e10) / 1e10; showToast('M+ → ' + fmt(memory), true); }
  else if (op === 'M-') { memory = Math.round((memory - currentValue()) * 1e10) / 1e10; showToast('M− → ' + fmt(memory), true); }
  updateDisplay();
}

/* ---------------- history ---------------- */
function pushHistory(e, res) {
  history.unshift({ e, res, t: Date.now() });
  history = history.slice(0, 12);
  try { localStorage.setItem('calc3d-history', JSON.stringify(history)); } catch {}
  renderHistory();
}
function renderHistory() {
  historyList.innerHTML = '';
  if (!history.length) {
    const li = document.createElement('li');
    li.className = 'empty';
    li.textContent = 'No calculations yet — try 12+7×(3−1)';
    historyList.appendChild(li);
    return;
  }
  for (const h of history) {
    const li = document.createElement('li');
    li.title = 'Click to reuse';
    const d1 = document.createElement('div');
    d1.className = 'h-expr';
    d1.textContent = h.e;
    const d2 = document.createElement('div');
    d2.className = 'h-res';
    d2.textContent = '= ' + h.res;
    li.append(d1, d2);
    li.onclick = () => { expr = h.res; justEvaluated = true; lastResult = parseFloat(h.res); updateDisplay(); showToast('Recalled ' + h.res, true); };
    historyList.appendChild(li);
  }
}

/* ---------------- HUD display ---------------- */
function updateHUD() {
  expr2d.textContent = expr ? pretty(expr) : '0';
  const live = tryEvaluate(expr, true);
  // only show preview if expression looks complete and not just evaluated single number
  const complete = expr && /[0-9)%π]$/.test(expr) && !justEvaluated;
  preview2d.textContent = live.ok && complete ? '= ' + fmt(live.value) : (justEvaluated ? '= ' + expr : '= —');
  memBadge.textContent = 'M: ' + fmt(memory);
  memValue.textContent = fmt(memory);
  ansBadge.textContent = 'ANS: ' + (lastResult === null ? '—' : fmt(lastResult));
}

/* ============================================================
   THREE.JS SCENE
============================================================ */
const canvas = document.getElementById('scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0x05070e, 16, 34);

const camera = new THREE.PerspectiveCamera(42, innerWidth / innerHeight, 0.1, 100);
const HOME_POS = new THREE.Vector3(0, 3.0, 15.2);
const HOME_TGT = new THREE.Vector3(0, 0.5, 0);
camera.position.copy(HOME_POS);

const controls = new OrbitControls(camera, renderer.domElement);
controls.target.copy(HOME_TGT);
controls.enableDamping = true;
controls.minDistance = 8;
controls.maxDistance = 24;
controls.maxPolarAngle = Math.PI * 0.55;
controls.autoRotate = true;
controls.autoRotateSpeed = 0.7;

// lights
scene.add(new THREE.HemisphereLight(0x8ea2ff, 0x0b0e1a, 0.9));
const key = new THREE.DirectionalLight(0xffffff, 1.6);
key.position.set(5, 9, 7);
key.castShadow = true;
key.shadow.mapSize.set(2048, 2048);
scene.add(key);
const rim = new THREE.DirectionalLight(0xa78bfa, 1.1);
rim.position.set(-6, 4, -6);
scene.add(rim);
const under = new THREE.PointLight(0x22d3ee, 14, 14);
under.position.set(0, -1.5, 3.5);
scene.add(under);

// ground + grid
const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(60, 60),
  new THREE.ShadowMaterial({ opacity: 0.35 })
);
ground.rotation.x = -Math.PI / 2;
ground.position.y = -5.6;
ground.receiveShadow = true;
scene.add(ground);

const grid = new THREE.GridHelper(40, 40, 0x334155, 0x1e293b);
grid.position.y = -5.59;
grid.material.transparent = true;
grid.material.opacity = 0.35;
scene.add(grid);

// stars
{
  const g = new THREE.BufferGeometry();
  const N = 450;
  const pos = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) {
    pos[i * 3] = (Math.random() - 0.5) * 55;
    pos[i * 3 + 1] = Math.random() * 22 - 5;
    pos[i * 3 + 2] = -Math.random() * 28 - 2;
  }
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  scene.add(new THREE.Points(g, new THREE.PointsMaterial({ color: 0x93c5fd, size: 0.06, transparent: true, opacity: 0.8 })));
}

// calculator group
const calc = new THREE.Group();
calc.rotation.x = -0.06;
scene.add(calc);

const bodyMat = new THREE.MeshStandardMaterial({ color: 0x111827, roughness: 0.35, metalness: 0.55 });
const body = new THREE.Mesh(new RoundedBoxGeometry(7.9, 11.2, 0.9, 6, 0.28), bodyMat);
body.castShadow = true;
body.receiveShadow = true;
calc.add(body);

// glow edge (themeable)
const edgeMat = new THREE.MeshBasicMaterial({ color: 0x22d3ee, transparent: true, opacity: 0.14 });
const edge = new THREE.Mesh(new RoundedBoxGeometry(8.05, 11.35, 0.5, 4, 0.3), edgeMat);
edge.position.z = -0.22;
calc.add(edge);

/* ---- extra detail: brand plate, solar panel, screws ---- */
function makePlateTexture() {
  const c = document.createElement('canvas');
  c.width = 1024; c.height = 128;
  const x = c.getContext('2d');
  x.fillStyle = '#0b1226';
  x.fillRect(0, 0, 1024, 128);
  x.fillStyle = '#e2e8f0';
  x.font = '800 52px Inter, Arial';
  x.textAlign = 'left';
  x.textBaseline = 'middle';
  x.fillText('SPARK  FX-3D  SCIENTIFIC', 36, 52);
  x.fillStyle = '#67e8f9';
  x.font = '600 30px Inter, Arial';
  x.fillText('30-KEY  •  EXPRESSION  •  MEMORY  •  HISTORY', 36, 98);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
const plate = new THREE.Mesh(
  new THREE.PlaneGeometry(4.4, 0.55),
  new THREE.MeshBasicMaterial({ map: makePlateTexture(), transparent: true })
);
plate.position.set(-1.1, 5.0, 0.47);
calc.add(plate);

// solar panel with cell lines
{
  const c = document.createElement('canvas');
  c.width = 256; c.height = 128;
  const x = c.getContext('2d');
  x.fillStyle = '#3b2f1e';
  x.fillRect(0, 0, 256, 128);
  x.strokeStyle = 'rgba(0,0,0,0.6)';
  x.lineWidth = 4;
  for (let i = 1; i < 4; i++) { x.beginPath(); x.moveTo((i * 256) / 4, 0); x.lineTo((i * 256) / 4, 128); x.stroke(); }
  x.strokeStyle = 'rgba(255,255,255,0.18)';
  x.lineWidth = 2;
  x.strokeRect(4, 4, 248, 120);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const solar = new THREE.Mesh(
    new RoundedBoxGeometry(1.7, 0.62, 0.08, 2, 0.03),
    new THREE.MeshStandardMaterial({ map: tex, roughness: 0.25, metalness: 0.4 })
  );
  solar.position.set(2.75, 5.0, 0.47);
  calc.add(solar);
}

// corner screws
{
  const geo = new THREE.CylinderGeometry(0.09, 0.09, 0.1, 20);
  const mat = new THREE.MeshStandardMaterial({ color: 0x64748b, roughness: 0.3, metalness: 0.9 });
  [[-3.55, 5.2], [3.55, 5.2], [-3.55, -5.2], [3.55, -5.2]].forEach(([sx, sy]) => {
    const s = new THREE.Mesh(geo, mat);
    s.rotation.x = Math.PI / 2;
    s.position.set(sx, sy, 0.46);
    calc.add(s);
    const slot = new THREE.Mesh(
      new THREE.BoxGeometry(0.11, 0.02, 0.02),
      new THREE.MeshBasicMaterial({ color: 0x0f172a })
    );
    slot.position.set(sx, sy, 0.515);
    slot.rotation.z = sx + sy;
    calc.add(slot);
  });
}

/* ---- display ---- */
const dispCanvas = document.createElement('canvas');
dispCanvas.width = 1024;
dispCanvas.height = 340;
const dctx = dispCanvas.getContext('2d');
const dispTex = new THREE.CanvasTexture(dispCanvas);
dispTex.colorSpace = THREE.SRGBColorSpace;

function drawDisplay() {
  const w = dispCanvas.width, h = dispCanvas.height;
  const grad = dctx.createLinearGradient(0, 0, w, 0);
  grad.addColorStop(0, '#020617');
  grad.addColorStop(1, '#0f172a');
  dctx.fillStyle = grad;
  dctx.fillRect(0, 0, w, h);
  dctx.strokeStyle = 'rgba(34,211,238,0.4)';
  dctx.lineWidth = 6;
  dctx.strokeRect(8, 8, w - 16, h - 16);

  // top status line
  dctx.textAlign = 'left';
  dctx.fillStyle = '#67e8f9';
  dctx.font = '600 30px Inter, Arial';
  dctx.fillText(memory !== 0 ? `M ${fmt(memory)}` : 'M —', 46, 58);
  dctx.textAlign = 'right';
  dctx.fillStyle = '#94a3b8';
  dctx.fillText(lastResult === null ? 'ANS —' : `ANS ${fmt(lastResult)}`, w - 46, 58);
  dctx.fillStyle = '#475569';
  dctx.fillRect(40, 76, w - 80, 2);

  // main line: tail of expression or result
  let main = expr ? pretty(expr) : '0';
  dctx.textAlign = 'right';
  dctx.fillStyle = '#f1f5f9';
  let size = 110;
  if (main.length > 14) size = 84;
  if (main.length > 22) size = 64;
  dctx.font = `700 ${size}px Inter, Arial`;
  const tail = main.length > 26 ? '…' + main.slice(-25) : main;
  dctx.fillText(tail, w - 50, 200);

  // live preview / sub line
  const live = tryEvaluate(expr, true);
  const complete = expr && /[0-9)%π]$/.test(expr) && !justEvaluated;
  dctx.fillStyle = '#67e8f9';
  dctx.font = '500 44px Inter, Arial';
  let sub;
  if (justEvaluated) sub = `${history[0]?.e || ''} =`;
  else if (live.ok && complete) sub = '= ' + fmt(live.value);
  else if (!expr) sub = 'READY • 30 KEYS';
  else sub = '…';
  if (sub.length > 34) sub = sub.slice(-34);
  dctx.fillText(sub, w - 50, 282);
  dispTex.needsUpdate = true;
}

const screenGlass = new THREE.Mesh(
  new RoundedBoxGeometry(7.0, 2.3, 0.12, 3, 0.08),
  new THREE.MeshStandardMaterial({ color: 0x000000, roughness: 0.15, metalness: 0.2 })
);
screenGlass.position.set(0, 3.72, 0.4);
calc.add(screenGlass);

const screen = new THREE.Mesh(
  new THREE.PlaneGeometry(6.7, 2.0),
  new THREE.MeshBasicMaterial({ map: dispTex })
);
screen.position.set(0, 3.72, 0.47);
calc.add(screen);

function updateDisplay() {
  updateHUD();
  drawDisplay();
}

/* ---- buttons: 5 cols x 6 rows = 30 keys ---- */
const LABELS = [
  ['MC', 'mem'], ['MR', 'mem'], ['M+', 'mem'], ['M-', 'mem'], ['C', 'fn'],
  ['(', 'sci'], [')', 'sci'], ['%', 'sci'], ['÷', 'op'], ['⌫', 'fn'],
  ['7', 'n'], ['8', 'n'], ['9', 'n'], ['×', 'op'], ['√', 'sci'],
  ['4', 'n'], ['5', 'n'], ['6', 'n'], ['−', 'op'], ['x²', 'sci'],
  ['1', 'n'], ['2', 'n'], ['3', 'n'], ['+', 'op'], ['xʸ', 'sci'],
  ['0', 'n'], ['.', 'n'], ['+/-', 'fn'], ['π', 'sci'], ['=', 'eq'],
];
const COLORS = {
  n: 0x1f2a44, fn: 0x475569, op: 0xf59e0b, eq: 0x22d3ee,
  mem: 0x6d28d9, sci: 0x0f766e,
};
const pressables = [];
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();

function makeLabelTexture(text, kind) {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const x = c.getContext('2d');
  x.clearRect(0, 0, 256, 256);
  x.fillStyle = kind === 'eq' ? '#06202a' : '#f8fafc';
  if (kind === 'op') x.fillStyle = '#fff7ed';
  if (kind === 'mem') x.fillStyle = '#ede9fe';
  if (kind === 'sci') x.fillStyle = '#ccfbf1';
  x.font = `800 ${text.length > 2 ? 64 : text.length > 1 ? 96 : 118}px Inter, Arial`;
  x.textAlign = 'center';
  x.textBaseline = 'middle';
  x.shadowColor = 'rgba(0,0,0,0.45)';
  x.shadowBlur = 12;
  x.fillText(text, 128, 140);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const btnGeo = new RoundedBoxGeometry(1.28, 1.0, 0.42, 4, 0.12);
LABELS.forEach(([label, kind], i) => {
  const col = i % 5, row = Math.floor(i / 5);
  const mat = new THREE.MeshStandardMaterial({
    color: COLORS[kind],
    roughness: 0.32,
    metalness: 0.35,
    emissive: kind === 'eq' ? 0x0e7490 : kind === 'op' ? 0x7c2d12 : kind === 'mem' ? 0x4c1d95 : kind === 'sci' ? 0x134e4a : 0x000000,
    emissiveIntensity: kind === 'n' || kind === 'fn' ? 0 : 0.45,
  });
  const m = new THREE.Mesh(btnGeo, mat);
  const bx = (col - 2) * 1.44;
  const by = 1.85 - row * 1.18;
  m.position.set(bx, by, 0.55);
  m.castShadow = true;
  m.userData = { label, kind, baseZ: 0.55, press: 0, baseEmissive: mat.emissiveIntensity };
  const face = new THREE.Mesh(
    new THREE.PlaneGeometry(1.1, 0.85),
    new THREE.MeshBasicMaterial({ map: makeLabelTexture(label, kind), transparent: true })
  );
  face.position.z = 0.215;
  m.add(face);
  calc.add(m);
  pressables.push(m);
});

function popDisplay() {
  screen.scale.set(1.05, 1.05, 1);
  setTimeout(() => screen.scale.set(1, 1, 1), 120);
}

/* ---- sound (WebAudio click) ---- */
let soundOn = true;
let audioCtx = null;
function blip(freq = 520, dur = 0.06) {
  if (!soundOn) return;
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    const o = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    o.type = 'triangle';
    o.frequency.value = freq;
    g.gain.setValueAtTime(0.08, audioCtx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + dur);
    o.connect(g).connect(audioCtx.destination);
    o.start();
    o.stop(audioCtx.currentTime + dur);
  } catch {}
}

/* ---- themes ---- */
const THEMES = [
  { name: 'cyan', css: '#22d3ee', hex: 0x22d3ee },
  { name: 'violet', css: '#a78bfa', hex: 0xa78bfa },
  { name: 'amber', css: '#f59e0b', hex: 0xf59e0b },
  { name: 'green', css: '#34d399', hex: 0x34d399 },
];
let themeIdx = 0;
function applyTheme(i) {
  themeIdx = i % THEMES.length;
  const t = THEMES[themeIdx];
  document.documentElement.style.setProperty('--accent', t.css);
  edgeMat.color.setHex(t.hex);
  under.color.setHex(t.hex);
  document.getElementById('btn-theme').textContent = 'Theme: ' + t.name;
}

/* ---- key handling ---- */
function press(mesh) {
  mesh.userData.press = 1;
  handleKey(mesh.userData.label);
  under.intensity = 24;
  setTimeout(() => (under.intensity = 14), 120);
}

function handleKey(label) {
  if (/^[0-9]$/.test(label)) { insertText(label); blip(440 + parseInt(label) * 18); }
  else if (label === '.') { insertText('.'); blip(500); }
  else if (label === '+') insertText('+');
  else if (label === '−' || label === '-') insertText('-');
  else if (label === '×' || label === '*') insertText('*');
  else if (label === '÷' || label === '/') insertText('/');
  else if (label === '%') { insertText('%'); }
  else if (label === '(' || label === ')') insertText(label);
  else if (label === '^' || label === 'xʸ') insertText('^');
  else if (label === 'x²') insertText('^2');
  else if (label === '√') insertText('√(');
  else if (label === 'π') insertText('π');
  else if (label === '=') { doEquals(true); return; }
  else if (label === 'C') { clearAll(); blip(300); return; }
  else if (label === '⌫') { backspaceExpr(); blip(320); return; }
  else if (label === '+/-') { negateTail(); blip(560); return; }
  else if (['MC', 'MR', 'M+', 'M-'].includes(label)) { memOp(label); blip(600); return; }
  else return;
  blip(520, 0.05);
}

function pick(ev) {
  const r = renderer.domElement.getBoundingClientRect();
  pointer.x = ((ev.clientX - r.left) / r.width) * 2 - 1;
  pointer.y = -((ev.clientY - r.top) / r.height) * 2 + 1;
  raycaster.setFromCamera(pointer, camera);
  const hit = raycaster.intersectObjects(pressables, false)[0];
  return hit ? hit.object : null;
}

let hovered = null;
renderer.domElement.addEventListener('pointermove', (e) => {
  const m = pick(e);
  if (hovered && hovered !== m) {
    hovered.material.emissiveIntensity = hovered.userData.baseEmissive;
  }
  hovered = m;
  if (hovered) {
    hovered.material.emissiveIntensity = Math.max(hovered.userData.baseEmissive, 0.9);
    renderer.domElement.style.cursor = 'pointer';
  } else {
    renderer.domElement.style.cursor = 'grab';
  }
});

renderer.domElement.addEventListener('pointerdown', (e) => {
  controls.autoRotate = false;
  document.getElementById('btn-spin').textContent = 'Auto-rotate: off';
  const m = pick(e);
  if (m) press(m);
});

addEventListener('keydown', (e) => {
  if (/^[0-9]$/.test(e.key)) { insertText(e.key); flash(e.key); }
  else if (e.key === '.') { insertText('.'); flash('.'); }
  else if (e.key === '+') { insertText('+'); flash('+'); }
  else if (e.key === '-') { insertText('-'); flash('−'); }
  else if (e.key === '*' || e.key.toLowerCase() === 'x') { insertText('*'); flash('×'); }
  else if (e.key === '/') { e.preventDefault(); insertText('/'); flash('÷'); }
  else if (e.key === '%' || e.key === '^') { insertText(e.key); flash(e.key === '%' ? '%' : 'xʸ'); }
  else if (e.key === '(' || e.key === ')') { insertText(e.key); flash(e.key); }
  else if (e.key.toLowerCase() === 's') { insertText('√('); flash('√'); }
  else if (e.key.toLowerCase() === 'p') { insertText('π'); flash('π'); }
  else if (e.key === 'Enter' || e.key === '=') { doEquals(true); flash('='); }
  else if (e.key === 'Backspace') backspaceExpr();
  else if (e.key.toLowerCase() === 'c' || e.key === 'Escape') clearAll();
  else return;
  blip(520, 0.05);
});
function flash(label) {
  const m = pressables.find((b) => b.userData.label === label);
  if (m) m.userData.press = 1;
}

/* ---- overlay buttons ---- */
document.getElementById('btn-spin').onclick = (e) => {
  controls.autoRotate = !controls.autoRotate;
  e.target.textContent = `Auto-rotate: ${controls.autoRotate ? 'on' : 'off'}`;
};
document.getElementById('btn-reset').onclick = () => {
  camera.position.copy(HOME_POS);
  controls.target.copy(HOME_TGT);
};
document.getElementById('btn-sound').onclick = (e) => {
  soundOn = !soundOn;
  e.target.textContent = `Sound: ${soundOn ? 'on' : 'off'}`;
};
document.getElementById('btn-theme').onclick = () => applyTheme(themeIdx + 1);
document.getElementById('btn-clear-history').onclick = () => {
  history = [];
  try { localStorage.removeItem('calc3d-history'); } catch {}
  renderHistory();
};
document.getElementById('btn-copy-history').onclick = async () => {
  const txt = justEvaluated ? expr : (tryEvaluate(expr, true).ok ? fmt(tryEvaluate(expr, true).value) : expr);
  try { await navigator.clipboard.writeText(txt || '0'); showToast('Copied: ' + (txt || '0'), true); }
  catch { showToast('Copy failed'); }
};
document.getElementById('btn-toggle-panel').onclick = (e) => {
  const p = document.getElementById('history-panel');
  p.classList.toggle('collapsed');
  e.target.textContent = p.classList.contains('collapsed') ? '+' : '–';
};
document.querySelectorAll('[data-mem]').forEach((b) => {
  b.onclick = () => memOp(b.dataset.mem);
});

/* ---- animation ---- */
const clock = new THREE.Clock();
function tick() {
  requestAnimationFrame(tick);
  const t = clock.getElapsedTime();
  calc.position.y = Math.sin(t * 1.1) * 0.12;
  calc.rotation.y = Math.sin(t * 0.4) * 0.06;
  for (const b of pressables) {
    if (b.userData.press > 0) b.userData.press = Math.max(0, b.userData.press - 0.08);
    const p = Math.sin(b.userData.press * Math.PI);
    b.position.z = b.userData.baseZ - p * 0.22;
  }
  controls.update();
  renderer.render(scene, camera);
}

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

applyTheme(0);
renderHistory();
updateDisplay();
tick();
