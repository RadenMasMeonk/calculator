import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

// ---------- basic calculator state ----------
let current = '0';
let previous = null;
let operator = null;
let justEvaluated = false;

const expr2d = document.getElementById('expr2d');
const toast = document.getElementById('toast');
let toastTimer;
function showToast(msg) {
  toast.textContent = msg;
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), 1600);
}
function update2D() {
  let t = '';
  if (previous !== null) t += previous + ' ' + (operatorSymbol(operator) || '') + ' ';
  t += current;
  expr2d.textContent = t;
}
function operatorSymbol(op) {
  return { '+': '+', '-': '−', '*': '×', '/': '÷' }[op] || '';
}
function inputDigit(d) {
  if (justEvaluated) { current = d === '.' ? '0.' : d; justEvaluated = false; }
  else if (d === '.') { if (!current.includes('.')) current += '.'; }
  else { current = current === '0' ? d : (current.replace('-', '').length < 12 ? current + d : current); }
  updateDisplay();
}
function setOperator(op) {
  if (operator && !justEvaluated) equals(false);
  previous = current;
  operator = op;
  justEvaluated = false;
  current = '0';
  updateDisplay();
}
function equals(show = true) {
  if (operator === null || previous === null) return;
  const a = parseFloat(previous);
  const b = parseFloat(current);
  let r;
  if (operator === '+') r = a + b;
  if (operator === '-') r = a - b;
  if (operator === '*') r = a * b;
  if (operator === '/') {
    if (b === 0) { showToast('Cannot divide by zero'); return; }
    r = a / b;
  }
  r = Math.round(r * 1e10) / 1e10;
  current = String(r);
  previous = null;
  operator = null;
  justEvaluated = true;
  updateDisplay();
  if (show) popDisplay();
}
function clearAll() { current = '0'; previous = null; operator = null; justEvaluated = false; updateDisplay(); }
function backspace() {
  if (justEvaluated) { clearAll(); return; }
  current = current.length > 1 ? current.slice(0, -1) : '0';
  if (current === '-' || current === '') current = '0';
  updateDisplay();
}
function percent() { current = String((parseFloat(current) || 0) / 100); updateDisplay(); }
function negate() {
  if (current === '0') return;
  current = current.startsWith('-') ? current.slice(1) : '-' + current;
  updateDisplay();
}

// ---------- three.js scene ----------
const canvas = document.getElementById('scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0x05070e, 14, 30);

const camera = new THREE.PerspectiveCamera(42, innerWidth / innerHeight, 0.1, 100);
const HOME_POS = new THREE.Vector3(0, 2.6, 12.5);
const HOME_TGT = new THREE.Vector3(0, 0.4, 0);
camera.position.copy(HOME_POS);

const controls = new OrbitControls(camera, renderer.domElement);
controls.target.copy(HOME_TGT);
controls.enableDamping = true;
controls.minDistance = 7;
controls.maxDistance = 20;
controls.maxPolarAngle = Math.PI * 0.55;
controls.autoRotate = true;
controls.autoRotateSpeed = 0.7;

// lights
scene.add(new THREE.HemisphereLight(0x8ea2ff, 0x0b0e1a, 0.9));
const key = new THREE.DirectionalLight(0xffffff, 1.6);
key.position.set(5, 8, 7);
key.castShadow = true;
key.shadow.mapSize.set(2048, 2048);
scene.add(key);
const rim = new THREE.DirectionalLight(0xa78bfa, 1.1);
rim.position.set(-6, 4, -6);
scene.add(rim);
const under = new THREE.PointLight(0x22d3ee, 12, 12);
under.position.set(0, -1.5, 3);
scene.add(under);

// ground + grid
const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(60, 60),
  new THREE.ShadowMaterial({ opacity: 0.35 })
);
ground.rotation.x = -Math.PI / 2;
ground.position.y = -4.6;
ground.receiveShadow = true;
scene.add(ground);

const grid = new THREE.GridHelper(40, 40, 0x334155, 0x1e293b);
grid.position.y = -4.59;
grid.material.transparent = true;
grid.material.opacity = 0.35;
scene.add(grid);

// stars
{
  const g = new THREE.BufferGeometry();
  const N = 400;
  const pos = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) {
    pos[i * 3] = (Math.random() - 0.5) * 50;
    pos[i * 3 + 1] = Math.random() * 20 - 4;
    pos[i * 3 + 2] = -Math.random() * 25 - 2;
  }
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  scene.add(new THREE.Points(g, new THREE.PointsMaterial({ color: 0x93c5fd, size: 0.06, transparent: true, opacity: 0.8 })));
}

// calculator group
const calc = new THREE.Group();
calc.rotation.x = -0.08;
scene.add(calc);

const body = new THREE.Mesh(
  new RoundedBoxGeometry(6.4, 8.6, 0.9, 6, 0.28),
  new THREE.MeshStandardMaterial({ color: 0x111827, roughness: 0.35, metalness: 0.55 })
);
body.castShadow = true;
body.receiveShadow = true;
calc.add(body);

// glow edge
const edge = new THREE.Mesh(
  new RoundedBoxGeometry(6.55, 8.75, 0.5, 4, 0.3),
  new THREE.MeshBasicMaterial({ color: 0x22d3ee, transparent: true, opacity: 0.14 })
);
edge.position.z = -0.22;
calc.add(edge);

// display canvas texture
const dispCanvas = document.createElement('canvas');
dispCanvas.width = 1024;
dispCanvas.height = 300;
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
  dctx.strokeStyle = 'rgba(34,211,238,0.35)';
  dctx.lineWidth = 6;
  dctx.strokeRect(8, 8, w - 16, h - 16);

  let main = current;
  if (main.length > 12) main = parseFloat(main).toExponential(5);
  dctx.textAlign = 'right';
  dctx.fillStyle = '#e2e8f0';
  dctx.font = '700 120px Inter, Arial';
  dctx.fillText(main, w - 50, 185);

  dctx.fillStyle = '#67e8f9';
  dctx.font = '500 44px Inter, Arial';
  const sub = previous !== null ? `${previous} ${operatorSymbol(operator)}` : '3D • READY';
  dctx.fillText(sub, w - 50, 250);
  dispTex.needsUpdate = true;
}

const screen = new THREE.Mesh(
  new THREE.PlaneGeometry(5.4, 1.58),
  new THREE.MeshBasicMaterial({ map: dispTex })
);
screen.position.set(0, 2.95, 0.47);
calc.add(screen);

const screenGlass = new THREE.Mesh(
  new RoundedBoxGeometry(5.7, 1.9, 0.12, 3, 0.08),
  new THREE.MeshStandardMaterial({ color: 0x000000, roughness: 0.15, metalness: 0.2 })
);
screenGlass.position.set(0, 2.95, 0.4);
calc.add(screenGlass);

function updateDisplay() {
  update2D();
  drawDisplay();
}

// buttons
const LABELS = [
  ['C', 'fn'], ['+/-', 'fn'], ['%', 'fn'], ['÷', 'op'],
  ['7', 'n'], ['8', 'n'], ['9', 'n'], ['×', 'op'],
  ['4', 'n'], ['5', 'n'], ['6', 'n'], ['−', 'op'],
  ['1', 'n'], ['2', 'n'], ['3', 'n'], ['+', 'op'],
  ['0', 'n'], ['.', 'n'], ['⌫', 'fn'], ['=', 'eq'],
];
const COLORS = {
  n: 0x1f2a44, fn: 0x334155, op: 0xf59e0b, eq: 0x22d3ee,
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
  if (kind === 'op' && text !== '=') x.fillStyle = '#fff7ed';
  x.font = `800 ${text.length > 2 ? 72 : 120}px Inter, Arial`;
  x.textAlign = 'center';
  x.textBaseline = 'middle';
  x.shadowColor = 'rgba(0,0,0,0.45)';
  x.shadowBlur = 12;
  x.fillText(text, 128, 138);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const btnGeo = new RoundedBoxGeometry(1.18, 1.02, 0.42, 4, 0.12);
LABELS.forEach(([label, kind], i) => {
  const col = i % 4, row = Math.floor(i / 4);
  const mat = new THREE.MeshStandardMaterial({
    color: COLORS[kind],
    roughness: 0.32,
    metalness: 0.35,
    emissive: kind === 'eq' ? 0x0e7490 : 0x000000,
    emissiveIntensity: kind === 'eq' ? 0.55 : 0,
  });
  const m = new THREE.Mesh(btnGeo, mat);
  const x = (col - 1.5) * 1.38;
  const y = 1.35 - row * 1.22;
  m.position.set(x, y, 0.55);
  m.castShadow = true;
  m.userData = { label, kind, baseZ: 0.55, press: 0 };
  const face = new THREE.Mesh(
    new THREE.PlaneGeometry(1.0, 0.85),
    new THREE.MeshBasicMaterial({ map: makeLabelTexture(label, kind), transparent: true })
  );
  face.position.z = 0.215;
  m.add(face);
  calc.add(m);
  pressables.push(m);
});

function popDisplay() {
  screen.scale.set(1.06, 1.06, 1);
  setTimeout(() => screen.scale.set(1, 1, 1), 120);
}

function press(mesh) {
  mesh.userData.press = 1;
  handleKey(mesh.userData.label);
  // click flash light
  under.intensity = 22;
  setTimeout(() => (under.intensity = 12), 120);
}

function handleKey(label) {
  if (/^[0-9]$/.test(label)) inputDigit(label);
  else if (label === '.') inputDigit('.');
  else if (label === '+') setOperator('+');
  else if (label === '−' || label === '-') setOperator('-');
  else if (label === '×' || label === '*') setOperator('*');
  else if (label === '÷' || label === '/') setOperator('/');
  else if (label === '=') equals(true);
  else if (label === 'C') clearAll();
  else if (label === '⌫') backspace();
  else if (label === '%') percent();
  else if (label === '+/-') negate();
}

function pick(ev) {
  const r = renderer.domElement.getBoundingClientRect();
  pointer.x = ((ev.clientX - r.left) / r.width) * 2 - 1;
  pointer.y = -((ev.clientY - r.top) / r.height) * 2 + 1;
  raycaster.setFromCamera(pointer, camera);
  const hit = raycaster.intersectObjects(pressables, false)[0];
  return hit ? hit.object : null;
}

let downAt = 0;
renderer.domElement.addEventListener('pointerdown', (e) => {
  downAt = performance.now();
  controls.autoRotate = false;
  document.getElementById('btn-spin').textContent = 'Auto-rotate: off';
  const m = pick(e);
  if (m) press(m);
});
renderer.domElement.addEventListener('wheel', () => {}, { passive: true });

addEventListener('keydown', (e) => {
  if (/^[0-9]$/.test(e.key)) { inputDigit(e.key); flash(e.key); }
  else if (e.key === '.') { inputDigit('.'); flash('.'); }
  else if (e.key === '+') { setOperator('+'); flash('+'); }
  else if (e.key === '-') { setOperator('-'); flash('−'); }
  else if (e.key === '*' || e.key.toLowerCase() === 'x') { setOperator('*'); flash('×'); }
  else if (e.key === '/') { e.preventDefault(); setOperator('/'); flash('÷'); }
  else if (e.key === 'Enter' || e.key === '=') { equals(true); flash('='); }
  else if (e.key === 'Backspace') backspace();
  else if (e.key.toLowerCase() === 'c' || e.key === 'Escape') clearAll();
  else if (e.key === '%') percent();
});
function flash(label) {
  const m = pressables.find((b) => b.userData.label === label);
  if (m) m.userData.press = 1;
}

// buttons overlay
document.getElementById('btn-spin').onclick = (e) => {
  controls.autoRotate = !controls.autoRotate;
  e.target.textContent = `Auto-rotate: ${controls.autoRotate ? 'on' : 'off'}`;
};
document.getElementById('btn-reset').onclick = () => {
  camera.position.copy(HOME_POS);
  controls.target.copy(HOME_TGT);
};

// float + press animation
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

updateDisplay();
tick();
