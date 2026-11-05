// Three.js simulation of the physical mirror.
//
// Geometry follows the reference build in docs/: 40 mm tiles on a 44 mm pitch,
// each hinged on a horizontal axle through its centre and driven by a micro
// servo behind the backboard. A key light above the viewer makes tiles that
// tilt UP (top edge away from the viewer) bright and tiles that tilt DOWN
// dark — exactly how the real piece produces an image without any pixels
// emitting light. Shadows between neighbouring tiles are simulated too.

import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

const MM = 0.001;
export const TILE = 40 * MM;
export const PITCH = 44 * MM;
const TILE_T = 4 * MM;

export const MATERIALS = ['wood', 'matte white', 'brushed metal', 'mirror'];

function woodTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#c9a477';
  g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 90; i++) {
    const y = Math.random() * 256;
    g.strokeStyle = `rgba(${90 + Math.random() * 40},${55 + Math.random() * 30},25,${0.08 + Math.random() * 0.18})`;
    g.lineWidth = 0.5 + Math.random() * 2.5;
    g.beginPath();
    g.moveTo(0, y);
    for (let x = 0; x <= 256; x += 16) g.lineTo(x, y + Math.sin(x * 0.03 + i) * 3 + (Math.random() - 0.5) * 2);
    g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

export class MirrorSim {
  constructor(container) {
    this.container = container;
    this.cols = 0;
    this.rows = 0;

    const r = (this.renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true }));
    r.setPixelRatio(Math.min(2, window.devicePixelRatio));
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFShadowMap;
    r.toneMapping = THREE.NeutralToneMapping;
    r.toneMappingExposure = 1.0;
    container.appendChild(r.domElement);

    const s = (this.scene = new THREE.Scene());
    s.background = new THREE.Color(0x15171b);
    const pmrem = new THREE.PMREMGenerator(r);
    s.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    s.environmentIntensity = 0.05;

    this.camera = new THREE.PerspectiveCamera(32, 1, 0.01, 50);
    this.camera.position.set(0.25, 0.05, 1.5);
    this.controls = new OrbitControls(this.camera, r.domElement);
    this.controls.enableDamping = true;
    this.controls.target.set(0, 0, 0);

    s.add(new THREE.HemisphereLight(0xdde6ff, 0x302820, 0.06));

    // Key light: above and slightly in front, like a ceiling spot or window.
    const key = (this.key = new THREE.DirectionalLight(0xfff3e0, 3.6));
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.bias = -0.0004;
    key.shadow.radius = 2;
    key.shadow.normalBias = 0.002;
    s.add(key, key.target);
    this.setLightElevation(55);

    this.textures = { wood: woodTexture() };
    this.materials = {
      wood: new THREE.MeshStandardMaterial({ map: this.textures.wood, roughness: 0.62, metalness: 0 }),
      'matte white': new THREE.MeshStandardMaterial({ color: 0xf2f0ea, roughness: 0.9 }),
      'brushed metal': new THREE.MeshStandardMaterial({ color: 0xc8ccd2, roughness: 0.35, metalness: 0.9 }),
      mirror: new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.04, metalness: 1 }),
    };
    this.edgeMat = new THREE.MeshStandardMaterial({ color: 0x8a6a45, roughness: 0.8 });
    this.boardMat = new THREE.MeshStandardMaterial({ color: 0x1b1c1f, roughness: 0.95 });
    this.frameMat = new THREE.MeshStandardMaterial({ color: 0x2b2118, roughness: 0.55 });
    this.servoMat = new THREE.MeshStandardMaterial({ color: 0x1f4fa8, roughness: 0.5 });
    this.axleMat = new THREE.MeshStandardMaterial({ color: 0x999999, roughness: 0.3, metalness: 0.8 });

    this.group = new THREE.Group();
    s.add(this.group);
    this._dummy = new THREE.Object3D();
    this._onResize = () => this.resize();
    window.addEventListener('resize', this._onResize);
    new ResizeObserver(this._onResize).observe(container);
    this.resize();
  }

  /** Elevation of the key light above the horizontal, in degrees. */
  setLightElevation(deg) {
    const e = THREE.MathUtils.degToRad(deg);
    this.key.position.set(0.3, Math.sin(e) * 3, Math.cos(e) * 3);
    this.key.target.position.set(0, 0, 0);
  }

  setMaterial(name) {
    if (this.tiles) this.tiles.material = [this.edgeMat, this.edgeMat, this.edgeMat, this.edgeMat, this.materials[name], this.edgeMat];
    this.materialName = name;
  }

  setGrid(cols, rows) {
    if (cols === this.cols && rows === this.rows) return;
    this.cols = cols;
    this.rows = rows;
    for (const c of [...this.group.children]) {
      this.group.remove(c);
      c.geometry?.dispose();
    }
    const n = cols * rows;
    const W = cols * PITCH;
    const H = rows * PITCH;

    // Tiles. Box face order: +x,-x,+y,-y,+z(front),-z → front face gets the
    // display material, the edges a plain end-grain material.
    const tileGeo = new THREE.BoxGeometry(TILE, TILE, TILE_T);
    const front = this.materials[this.materialName || 'wood'];
    this.tiles = new THREE.InstancedMesh(tileGeo, [this.edgeMat, this.edgeMat, this.edgeMat, this.edgeMat, front, this.edgeMat], n);
    this.tiles.castShadow = true;
    this.tiles.receiveShadow = true;
    this.tiles.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    // Slight per-tile colour variation, like real timber.
    const col = new THREE.Color();
    for (let i = 0; i < n; i++) {
      const v = 0.9 + Math.random() * 0.12;
      this.tiles.setColorAt(i, col.setRGB(v, v * (0.97 + Math.random() * 0.03), v * (0.94 + Math.random() * 0.06)));
    }
    this.group.add(this.tiles);

    // Axles and servos behind the tiles (static).
    const axleGeo = new THREE.CylinderGeometry(1.2 * MM, 1.2 * MM, TILE * 0.9, 8).rotateZ(Math.PI / 2);
    const servoGeo = new THREE.BoxGeometry(12.5 * MM, 23 * MM, 22 * MM);
    const axles = new THREE.InstancedMesh(axleGeo, this.axleMat, n);
    const servos = new THREE.InstancedMesh(servoGeo, this.servoMat, n);
    const d = this._dummy;
    this.positions = new Float32Array(n * 2);
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const i = y * cols + x;
        const px = (x - (cols - 1) / 2) * PITCH;
        const py = ((rows - 1) / 2 - y) * PITCH; // row 0 = top
        this.positions[i * 2] = px;
        this.positions[i * 2 + 1] = py;
        d.position.set(px, py, -TILE_T);
        d.rotation.set(0, 0, 0);
        d.updateMatrix();
        axles.setMatrixAt(i, d.matrix);
        d.position.set(px + TILE * 0.3, py, -0.034);
        d.updateMatrix();
        servos.setMatrixAt(i, d.matrix);
      }
    }
    servos.castShadow = true;
    this.group.add(axles, servos);

    // Backboard with slots, frame.
    const board = new THREE.Mesh(new THREE.BoxGeometry(W + 0.02, H + 0.02, 0.006), this.boardMat);
    board.position.z = -0.024;
    board.receiveShadow = true;
    this.group.add(board);
    const fw = 0.035;
    const fd = 0.07;
    const mk = (w, h, x, y) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, fd), this.frameMat);
      m.position.set(x, y, -0.02);
      m.castShadow = m.receiveShadow = true;
      this.group.add(m);
    };
    mk(W + 0.02 + fw * 2, fw, 0, H / 2 + 0.01 + fw / 2);
    mk(W + 0.02 + fw * 2, fw, 0, -H / 2 - 0.01 - fw / 2);
    mk(fw, H + 0.02, -W / 2 - 0.01 - fw / 2, 0);
    mk(fw, H + 0.02, W / 2 + 0.01 + fw / 2, 0);

    // Wall behind.
    const wall = new THREE.Mesh(new THREE.PlaneGeometry(8, 5), new THREE.MeshStandardMaterial({ color: 0x3a3c40, roughness: 1 }));
    wall.position.z = -0.06;
    wall.receiveShadow = true;
    this.group.add(wall);

    // Shadow camera tight around the piece for crisp inter-tile shadows.
    const sc = this.key.shadow.camera;
    const ext = Math.max(W, H) * 0.75 + 0.06;
    sc.left = -ext;
    sc.right = ext;
    sc.top = ext;
    sc.bottom = -ext;
    sc.near = 0.5;
    sc.far = 6;
    sc.updateProjectionMatrix();

    // Frame the camera so the whole piece is visible.
    const dist = (Math.max(W, H) * 0.75) / Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2)) + 0.2;
    this.camera.position.set(dist * 0.12, dist * 0.05, dist);
    this.controls.target.set(0, 0, 0);
    this.controls.update();

    this.setAngles(new Float32Array(n));
  }

  /** Angles in degrees, row-major. Positive = top edge tilts away (brighter). */
  setAngles(angles) {
    const d = this._dummy;
    for (let i = 0; i < this.cols * this.rows; i++) {
      d.position.set(this.positions[i * 2], this.positions[i * 2 + 1], 0);
      d.rotation.set(-THREE.MathUtils.degToRad(angles[i] || 0), 0, 0);
      d.updateMatrix();
      this.tiles.setMatrixAt(i, d.matrix);
    }
    this.tiles.instanceMatrix.needsUpdate = true;
  }

  resize() {
    const w = this.container.clientWidth || 1;
    const h = this.container.clientHeight || 1;
    this.renderer.setSize(w, h, false);
    this.renderer.domElement.style.width = '100%';
    this.renderer.domElement.style.height = '100%';
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  render() {
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }
}
