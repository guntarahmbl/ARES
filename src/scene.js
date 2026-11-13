import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { TARGETS, STUDY } from "./data.js";
import { sampleTerrain } from "./walk.js";
import { cellColor } from "./map.js";
export class TerrainScene {
  constructor(canvas, grid, hooks = {}) {
    this.hooks = hooks;
    this.keys = new Set();
    this.cameraMode = "third";
    this.yaw = 0.65;
    this.pitch = 0.25;
    this.followDistance = 12;
    this.phase = 0;
    this.lastTime = 0;
    this.canvas = canvas;
    this.grid = grid;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color("#b88b68");
    this.scene.fog = new THREE.Fog("#b88b68", 140, 850);
    this.camera = new THREE.PerspectiveCamera(55, 1, 0.1, 1600);
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
    this.legs = [];
    this.arms = [];
    for (const x of [-0.8, 0.8])
      this.legs.push(
        this.addMesh(
          new THREE.CapsuleGeometry(0.5, 1.7, 4, 8),
          "#d9dfcf",
          this.astronaut,
          x,
          1.4,
          0,
        ),
      );
    for (const x of [-1.9, 1.9])
      this.arms.push(
        this.addMesh(
          new THREE.CapsuleGeometry(0.4, 1.8, 4, 8),
          "#d9dfcf",
          this.astronaut,
          x,
          4,
          0,
        ),
      );
    this.astronaut.scale.setScalar(0.28);
    this.installInput();
    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(canvas);
    this.resize();
    this.renderer.setAnimationLoop((now) => {
      const dt = this.lastTime
        ? Math.min((now - this.lastTime) / 1000, 0.1)
        : 0;
      this.lastTime = now;
      if (canvas.hidden) return;
      if (this.walkMode) {
        if (this.cameraMode === "orbit")
          this.yaw = Math.atan2(
            this.camera.position.x - this.astronaut.position.x,
            this.camera.position.z - this.astronaut.position.z,
          );
        const f =
          Number(this.keys.has("w") || this.keys.has("arrowup")) -
          Number(this.keys.has("s") || this.keys.has("arrowdown"));
        const side =
          Number(this.keys.has("d") || this.keys.has("arrowright")) -
          Number(this.keys.has("a") || this.keys.has("arrowleft"));
        this.hooks.tick?.(
          side * Math.cos(this.yaw) - f * Math.sin(this.yaw),
          -f * Math.cos(this.yaw) - side * Math.sin(this.yaw),
          dt,
        );
        this.followCamera(dt);
      } else this.controls.update();
      this.renderer.render(this.scene, this.camera);
    });
  }
  clearInput() {
    this.keys.clear();
    this.drag = null;
  }
  installInput() {
    window.addEventListener("keydown", (e) => {
      if (
        !this.walkMode ||
        document.querySelector("dialog[open]") ||
        ["INPUT", "SELECT", "TEXTAREA", "BUTTON"].includes(
          document.activeElement?.tagName,
        )
      )
        return;
      const k = e.key.toLowerCase();
      if (
        [
          "w",
          "a",
          "s",
          "d",
          "arrowup",
          "arrowdown",
          "arrowleft",
          "arrowright",
        ].includes(k)
      ) {
        e.preventDefault();
        this.keys.add(k);
      }
      if (!e.repeat && k === "e") this.hooks.observe?.();
      if (!e.repeat && k === "c") this.cycleCamera();
      if (!e.repeat && k === "escape") this.hooks.pause?.();
    });
    window.addEventListener("keyup", (e) =>
      this.keys.delete(e.key.toLowerCase()),
    );
    window.addEventListener("blur", () => {
      this.clearInput();
      this.hooks.blur?.();
    });
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) {
        this.clearInput();
        this.hooks.blur?.();
      }
    });
    this.canvas.addEventListener("pointerdown", (e) => {
      if (!this.walkMode || this.cameraMode === "orbit") return;
      this.canvas.focus();
      this.drag = { x: e.clientX, y: e.clientY };
      this.canvas.setPointerCapture(e.pointerId);
    });
    this.canvas.addEventListener("pointermove", (e) => {
      if (!this.drag || !this.walkMode) return;
      this.yaw -= (e.clientX - this.drag.x) * 0.006;
      this.pitch = THREE.MathUtils.clamp(
        this.pitch + (e.clientY - this.drag.y) * 0.004,
        -0.45,
        1,
      );
      this.drag = { x: e.clientX, y: e.clientY };
    });
    for (const name of ["pointerup", "pointercancel", "lostpointercapture"])
      this.canvas.addEventListener(name, () => (this.drag = null));
    this.canvas.addEventListener(
      "wheel",
      (e) => {
        if (this.walkMode && this.cameraMode !== "orbit") {
          e.preventDefault();
          this.followDistance = THREE.MathUtils.clamp(
            this.followDistance + e.deltaY * 0.02,
            5,
            28,
          );
        }
      },
      { passive: false },
    );
  }
  setWalkMode(enabled) {
    this.walkMode = enabled;
    this.clearInput();
    this.cameraMode = "third";
    this.controls.enabled = !enabled;
    if (enabled) {
      this.followCamera(1);
      this.hooks.camera?.("third");
    } else {
      this.astronaut.visible = true;
      this.fit();
    }
  }
  cycleCamera() {
    this.cameraMode =
      this.cameraMode === "third"
        ? "first"
        : this.cameraMode === "first"
          ? "orbit"
          : "third";
    this.controls.enabled = this.cameraMode === "orbit";
    this.clearInput();
    if (this.cameraMode === "orbit") {
      this.controls.target.copy(this.astronaut.position);
      this.camera.position
        .copy(this.astronaut.position)
        .add(new THREE.Vector3(45, 60, 65));
      this.controls.update();
    }
    this.hooks.camera?.(this.cameraMode);
  }
  setPose(p, moved = 0) {
    const h = sampleTerrain(this.grid, p)?.height ?? this.grid.datum;
    const old = this.astronaut.position;
    if (moved > 0)
      this.astronaut.rotation.y = Math.atan2(old.x - p.x, old.z - p.z);
    if (this.walkMode && this.cameraMode === "orbit") {
      const delta = new THREE.Vector3(
        p.x - old.x,
        h - this.grid.datum - old.y,
        p.z - old.z,
      );
      this.camera.position.add(delta);
      this.controls.target.add(delta);
    }
    this.astronaut.position.set(p.x, h - this.grid.datum, p.z);
    this.phase += moved * 2.5;
    this.legs.forEach(
      (leg, i) =>
        (leg.rotation.x = moved
          ? Math.sin(this.phase + i * Math.PI) * 0.45
          : 0),
    );
    this.arms.forEach(
      (arm, i) =>
        (arm.rotation.x = moved
          ? -Math.sin(this.phase + i * Math.PI) * 0.3
          : 0),
    );
  }
  followCamera(dt) {
    this.astronaut.visible = this.cameraMode !== "first";
    if (this.cameraMode === "orbit") {
      this.controls.update();
      return;
    }
    const p = this.astronaut.position;
    const head = new THREE.Vector3(p.x, p.y + 2.05, p.z);
    if (this.cameraMode === "first") {
      this.camera.position.copy(head);
      this.camera.lookAt(
        head.x - Math.sin(this.yaw) * 20,
        head.y - Math.sin(this.pitch) * 20,
        head.z - Math.cos(this.yaw) * 20,
      );
    } else {
      const desired = new THREE.Vector3(
        p.x + Math.sin(this.yaw) * this.followDistance,
        p.y + 4 + this.pitch * this.followDistance,
        p.z + Math.cos(this.yaw) * this.followDistance,
      );
      const cp = {
        x: THREE.MathUtils.clamp(desired.x, -200, 200),
        z: THREE.MathUtils.clamp(desired.z, -200, 200),
      };
      desired.y = Math.max(
        desired.y,
        (sampleTerrain(this.grid, cp)?.height ?? this.grid.datum) -
          this.grid.datum +
          2,
      );
      this.camera.position.lerp(desired, 1 - Math.exp(-dt * 8));
      const at = {
        x: THREE.MathUtils.clamp(this.camera.position.x, -200, 200),
        z: THREE.MathUtils.clamp(this.camera.position.z, -200, 200),
      };
      this.camera.position.y = Math.max(
        this.camera.position.y,
        (sampleTerrain(this.grid, at)?.height ?? this.grid.datum) -
          this.grid.datum +
          1,
      );
      this.camera.lookAt(head);
    }
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
      child.material?.map?.dispose();
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
      (state.layers.envelope && !this.walkMode);
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
    if (state.pose && state.route?.path?.length) {
      const p = state.pose,
        c = this.grid.cells[state.route.path[0]],
        h = sampleTerrain(this.grid, p).height - this.grid.datum;
      this.routes.add(
        new THREE.Line(
          new THREE.BufferGeometry().setFromPoints([
            new THREE.Vector3(p.x, h + 0.3, p.z),
            new THREE.Vector3(c.x, c.height - this.grid.datum + 0.9, c.z),
          ]),
          new THREE.LineBasicMaterial({ color: "#89d1ff" }),
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
          new THREE.ConeGeometry(0.7, 2.5, 12),
          color,
          this.markers,
          t.x,
          c.height - this.grid.datum + 4,
          t.z,
        );
        pin.rotation.x = Math.PI;
        const label = document.createElement("canvas");
        label.width = 256;
        label.height = 64;
        const ctx = label.getContext("2d");
        ctx.fillStyle = "#17221ee8";
        ctx.fillRect(0, 0, 256, 64);
        ctx.font = "500 26px sans-serif";
        ctx.textAlign = "center";
        ctx.fillStyle = color;
        ctx.fillText(`${t.id} / SOL ${t.sol}`, 128, 41);
        const sprite = new THREE.Sprite(
          new THREE.SpriteMaterial({
            map: new THREE.CanvasTexture(label),
            depthTest: true,
          }),
        );
        sprite.position.set(t.x, c.height - this.grid.datum + 6, t.z);
        sprite.scale.set(6, 1.5, 1);
        this.markers.add(sprite);
      }
    const home = this.grid.cells[state.home];
    this.habitat.position.set(
      home.x - 12,
      (sampleTerrain(this.grid, { x: Math.max(-200, home.x - 12), z: home.z })
        ?.height ?? home.height) - this.grid.datum,
      home.z,
    );
    const p = this.grid.cells[state.position];
    this.setPose(state.pose ?? p);
    const next = state.route?.path?.[state.offset + 1];
    if (next !== undefined && !this.walkMode) {
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
