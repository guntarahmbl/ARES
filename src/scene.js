import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { TARGETS, STUDY } from "./data.js";
import { cellColor } from "./map.js";
export class TerrainScene {
  constructor(canvas, grid) {
    this.canvas = canvas;
    this.grid = grid;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color("#30372b");
    this.scene.fog = new THREE.Fog("#30372b", 450, 1000);
    this.camera = new THREE.PerspectiveCamera(47, 1, 0.5, 1600);
    this.camera.position.set(210, 230, 330);
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.target.set(0, 0, 0);
    this.controls.enableDamping = true;
    this.controls.maxPolarAngle = Math.PI * 0.48;
    this.controls.minDistance = 15;
    this.controls.maxDistance = 720;
    this.scene.add(new THREE.HemisphereLight("#ffe8c2", "#4f6247", 2.5));
    const sun = new THREE.DirectionalLight("#ffedc8", 3);
    sun.position.set(-170, 230, -120);
    this.scene.add(sun);
    const vertices = [],
      indices = [];
    for (const c of grid.cells) vertices.push(c.x, c.height - grid.datum, c.z);
    for (let z = 0; z < grid.size - 1; z++)
      for (let x = 0; x < grid.size - 1; x++) {
        const i = z * grid.size + x,
          j = i + grid.size;
        if ([i, i + 1, j, j + 1].some((k) => grid.cells[k].nodata)) continue;
        indices.push(i, j, i + 1, i + 1, j, j + 1);
      }
    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(vertices, 3),
    );
    this.geometry.setAttribute(
      "uv",
      new THREE.Float32BufferAttribute(
        grid.cells.flatMap((c) => [
          (c.x + 202.5) / 405,
          1 - (c.z + 202.5) / 405,
        ]),
        2,
      ),
    );
    this.texture = new THREE.TextureLoader().load(STUDY.assets.basemap);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.geometry.setIndex(indices);
    this.geometry.computeVertexNormals();
    this.ground = new THREE.Mesh(
      this.geometry,
      new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 }),
    );
    this.scene.add(this.ground);
    this.routes = new THREE.Group();
    this.scene.add(this.routes);
    this.markers = new THREE.Group();
    this.scene.add(this.markers);
    this.habitat = new THREE.Group();
    this.scene.add(this.habitat);
    this.addMesh(
      new THREE.CylinderGeometry(5, 5, 12, 20),
      "#dfdac6",
      this.habitat,
      0,
      5,
      0,
    ).rotation.x = Math.PI / 2;
    this.addMesh(
      new THREE.BoxGeometry(4, 5, 0.3),
      "#42574c",
      this.habitat,
      0,
      3,
      -6.1,
    );
    this.addMesh(
      new THREE.BoxGeometry(13, 0.4, 9),
      "#334e59",
      this.habitat,
      -15,
      2,
      0,
    ).rotation.z = -0.12;
    this.astronaut = new THREE.Group();
    this.scene.add(this.astronaut);
    this.addMesh(
      new THREE.CapsuleGeometry(1.3, 2.5, 5, 12),
      "#e7e4d6",
      this.astronaut,
      0,
      4,
      0,
    );
    this.addMesh(
      new THREE.BoxGeometry(2.2, 2.8, 1.2),
      "#a5b3a4",
      this.astronaut,
      0,
      4,
      1.3,
    );
    this.addMesh(
      new THREE.SphereGeometry(1.5, 16, 12),
      "#eee9dc",
      this.astronaut,
      0,
      7,
      0,
    );
    const visor = this.addMesh(
      new THREE.SphereGeometry(1.2, 16, 12),
      "#6e512f",
      this.astronaut,
      0,
      7,
      -0.7,
    );
    visor.scale.set(1, 0.8, 0.7);
    visor.material.metalness = 0.7;
    for (const x of [-0.8, 0.8])
      this.addMesh(
        new THREE.CapsuleGeometry(0.5, 1.7, 4, 8),
        "#d9dfcf",
        this.astronaut,
        x,
        1.4,
        0,
      );
    for (const x of [-1.9, 1.9])
      this.addMesh(
        new THREE.CapsuleGeometry(0.4, 1.8, 4, 8),
        "#d9dfcf",
        this.astronaut,
        x,
        4,
        0,
      );
    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(canvas);
    this.resize();
    this.renderer.setAnimationLoop(() => {
      if (canvas.hidden) return;
      this.controls.update();
      this.renderer.render(this.scene, this.camera);
    });
  }
  addMesh(geometry, color, parent, x, y, z) {
    const mesh = new THREE.Mesh(
      geometry,
      new THREE.MeshStandardMaterial({ color, roughness: 0.8 }),
    );
    mesh.position.set(x, y, z);
    parent.add(mesh);
    return mesh;
  }
  resize() {
    const w = this.canvas.clientWidth,
      h = this.canvas.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }
  clear(group) {
    while (group.children.length) {
      const child = group.children[0];
      group.remove(child);
      child.geometry?.dispose();
      child.material?.dispose();
    }
  }
  line(path, color, dashed = false) {
    if (!path) return;
    const points = path.map((i) => {
      const c = this.grid.cells[i];
      return new THREE.Vector3(c.x, c.height - this.grid.datum + 0.9, c.z);
    });
    const line = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(points),
      dashed
        ? new THREE.LineDashedMaterial({ color, dashSize: 4, gapSize: 3 })
        : new THREE.LineBasicMaterial({ color }),
    );
    if (dashed) line.computeLineDistances();
    this.routes.add(line);
  }
  setState(state) {
    const analytical =
      state.layers.elevation ||
      state.layers.geology ||
      state.layers.minerals ||
      state.layers.slope ||
      state.layers.envelope;
    this.ground.material.map =
      state.layers.surface && !analytical ? this.texture : null;
    this.ground.material.needsUpdate = true;
    const colors = [];
    for (const c of this.grid.cells) {
      const rgb =
        this.ground.material.map && !c.nodata && !state.closed.has(c.i)
          ? [255, 255, 255]
          : cellColor(c, state);
      const color = new THREE.Color(`rgb(${rgb.join(",")})`);
      colors.push(color.r, color.g, color.b);
    }
    this.geometry.setAttribute(
      "color",
      new THREE.Float32BufferAttribute(colors, 3),
    );
    this.clear(this.routes);
    this.line(
      state.alternative?.path,
      state.alternative?.feasible ? "#dac595" : "#b8866e",
      true,
    );
    this.line(
      state.route?.path,
      state.route?.feasible ? "#89d1ff" : "#e6a184",
      state.route?.emergency,
    );
    if (state.layers.traverse)
      for (const segment of STUDY.traverse) {
        const points = segment.map((p) => {
          const i =
            Math.round((p.z + 200) / 5) * 81 + Math.round((p.x + 200) / 5);
          return new THREE.Vector3(
            p.x,
            (this.grid.cells[i]?.height ?? this.grid.datum) -
              this.grid.datum +
              0.5,
            p.z,
          );
        });
        this.routes.add(
          new THREE.Line(
            new THREE.BufferGeometry().setFromPoints(points),
            new THREE.LineBasicMaterial({ color: "#ebc981" }),
          ),
        );
      }
    this.clear(this.markers);
    if (state.layers.science)
      for (const t of TARGETS) {
        const c =
            this.grid.cells[
              Math.round((t.z - this.grid.origin) / this.grid.cellSize) *
                this.grid.size +
                Math.round((t.x - this.grid.origin) / this.grid.cellSize)
            ],
          color = state.ids.includes(t.id) ? "#e8cb7b" : "#84947a";
        const pin = this.addMesh(
          new THREE.ConeGeometry(2, 8, 12),
          color,
          this.markers,
          t.x,
          c.height - this.grid.datum + 8,
          t.z,
        );
        pin.rotation.x = Math.PI;
      }
    const home = this.grid.cells[state.home];
    this.habitat.position.set(home.x, home.height - this.grid.datum, home.z);
    const p = this.grid.cells[state.position];
    this.astronaut.position.set(p.x, p.height - this.grid.datum, p.z);
    const next = state.route?.path?.[state.offset + 1];
    if (next !== undefined) {
      const n = this.grid.cells[next];
      this.astronaut.rotation.y = Math.atan2(p.x - n.x, p.z - n.z);
    }
    this.resize();
  }
  fit() {
    this.camera.position.set(210, 230, 330);
    this.controls.target.set(0, 0, 0);
    this.controls.update();
  }
  zoom(factor) {
    this.camera.position
      .sub(this.controls.target)
      .multiplyScalar(1 / factor)
      .add(this.controls.target);
    this.controls.update();
  }
}
