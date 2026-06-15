// ============================================================================
// CarShine Red Sea - Three.js Hero Scene
// WebGL animated background for hero section
// ============================================================================

import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

let frameId = null;
let composer = null;
let renderer = null;
let scene = null;
let camera = null;
let group = null;
let materials = [];
let clock = null;

export function initHero() {
  const canvas = document.getElementById('heroCanvas');
  if (!canvas) return;

  // Clean up any existing instance
  cleanup();

  // Scene setup
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x000000);

  camera = new THREE.PerspectiveCamera(58, 1, 1, 900);
  camera.position.set(0, 16, 112);
  camera.lookAt(0, 12, -70);

  renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    alpha: false,
    powerPreference: 'high-performance'
  });
  renderer.toneMapping = THREE.LinearToneMapping;
  renderer.toneMappingExposure = 2.2;

  composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  composer.addPass(new UnrealBloomPass(new THREE.Vector2(1, 1), 0.28, 0.24, 0.04));
  composer.addPass(new OutputPass());

  // Create animated trails
  createTrails();

  // Floor
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(420, 320, 1, 1),
    new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.72, side: THREE.DoubleSide })
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(0, -1.5, -40);
  scene.add(floor);

  clock = new THREE.Clock();

  // Resize handler
  function resize() {
    const rect = canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 1.6);
    renderer.setPixelRatio(dpr);
    renderer.setSize(rect.width, rect.height, false);
    composer.setSize(rect.width, rect.height);
    camera.aspect = rect.width / rect.height;
    camera.position.z = rect.width < 700 ? 142 : 112;
    camera.position.y = rect.width < 700 ? 20 : 16;
    camera.updateProjectionMatrix();
  }

  // Animation loop
  function animate() {
    const elapsed = clock.getElapsedTime();
    materials.forEach((material) => {
      material.uniforms.uTime.value = elapsed;
    });
    group.rotation.y = Math.sin(elapsed * 0.08) * 0.035;
    composer.render();
    frameId = requestAnimationFrame(animate);
  }

  // Initialize
  resize();
  animate();
  window.addEventListener('resize', resize, { passive: true });

  // Handle pause/resume
  window.addEventListener('app:pause', () => cancelAnimationFrame(frameId));
  window.addEventListener('app:resume', () => animate());
}

function createTrails() {
  group = new THREE.Group();
  scene.add(group);

  const colors = [0x12a8ff, 0x2e89ff, 0xff2638, 0xff8a00, 0xffd166];
  const lanes = 64;

  const vertexShader = `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `;

  const fragmentShader = `
    varying vec2 vUv;
    uniform float uTime;
    uniform vec3 uColor;
    uniform float uSpeed;
    uniform float uOffset;
    uniform float uDensity;
    void main() {
      float head = fract(uTime * uSpeed + uOffset);
      float dist = fract(head - vUv.x + 1.0);
      float tail = smoothstep(.62, 0.0, dist);
      float core = pow(tail, 3.0);
      float dash = step(.82, fract((vUv.x - uTime * uSpeed * 0.55 + uOffset) * uDensity));
      float sideFade = smoothstep(0.0, .18, vUv.y) * smoothstep(1.0, .82, vUv.y);
      float alpha = (tail * .44 + core * .62 + dash * tail * .34) * sideFade;
      vec3 color = uColor * (tail * 1.05 + core * 1.8 + dash * .9);
      gl_FragColor = vec4(color, alpha);
    }
  `;

  for (let i = 0; i < lanes; i++) {
    const norm = (i / (lanes - 1)) * 2 - 1;
    const x = Math.sign(norm) * Math.pow(Math.abs(norm), 1.25) * 82 + (Math.random() - 0.5) * 1.8;
    const curve = new TrailCurve(x, norm * -16, 92 + Math.random() * 46);
    const geometry = new THREE.TubeGeometry(curve, 160, Math.random() * 0.13 + 0.055, 6, false);
    const material = new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uTime: { value: 0 },
        uColor: { value: new THREE.Color(colors[i % colors.length]) },
        uSpeed: { value: Math.random() * 0.06 + 0.024 },
        uOffset: { value: Math.random() },
        uDensity: { value: Math.random() * 32 + 28 }
      }
    });
    materials.push(material);
    group.add(new THREE.Mesh(geometry, material));
  }
}

class TrailCurve extends THREE.Curve {
  constructor(x, bend, height) {
    super();
    this.x = x;
    this.bend = bend;
    this.height = height;
  }
  getPoint(t, target = new THREE.Vector3()) {
    const z = 90 - t * 245;
    const turn = Math.max(0, (t - 0.58) / 0.42);
    const ease = turn * turn * (3 - 2 * turn);
    const y = ease * this.height;
    const x = this.x + Math.sin(t * Math.PI * 1.15) * this.bend * ease;
    return target.set(x, y, z);
  }
}

function cleanup() {
  if (frameId) {
    cancelAnimationFrame(frameId);
    frameId = null;
  }
  if (renderer) {
    renderer.dispose();
    renderer = null;
  }
  if (composer) {
    composer.dispose();
    composer = null;
  }
  if (scene) {
    scene.traverse(obj => {
      if (obj.geometry) obj.geometry.dispose();
      if (obj.material) {
        if (Array.isArray(obj.material)) {
          obj.material.forEach(m => m.dispose());
        } else {
          obj.material.dispose();
        }
      }
    });
    scene = null;
  }
  materials = [];
  group = null;
  scene = null;
  camera = null;
  clock = null;
}