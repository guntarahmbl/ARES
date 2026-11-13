import { MODEL, TARGETS, STUDY, cellIndex } from "./data.js";
const MINERAL_RANGES = Object.fromEntries(
  Object.entries(STUDY.crism).map(([k, v]) => [
    k,
    [
      Math.min(...v.filter((x) => x !== null)),
      Math.max(...v.filter((x) => x !== null)),
    ],
  ]),
);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const mix = (a, b, t) => a.map((v, i) => v * (1 - t) + b[i] * t);
export function cellColor(cell, state) {
  const { layers, opacity, config, closed, envelope } = state;
  let color = layers.surface
    ? [cell.surfaceGray, cell.surfaceGray, cell.surfaceGray]
    : [41, 47, 38];
  if (layers.elevation) {
    const t = (cell.height + 2548) / 32;
    color = mix(color, [60 + 150 * t, 95 + 90 * t, 130 - 60 * t], opacity);
  }
  if (layers.geology && cell.geology >= 0)
    color = mix(
      color,
      cell.geology === 0 ? [140, 121, 162] : [110, 146, 133],
      opacity,
    );
  if (layers.minerals) {
    const low = MINERAL_RANGES[state.mineralBand][0],
      high = MINERAL_RANGES[state.mineralBand][1];
    const v = cell.minerals[state.mineralBand];
    if (v !== null) {
      const t = clamp((v - low) / (high - low), 0, 1);
      color = mix(
        color,
        [55 + 190 * t, 95 + 80 * (1 - t), 190 - 140 * t],
        opacity,
      );
    }
  }
  if (layers.slope)
    color = mix(
      color,
      cell.slope > config.maxSlope
        ? [216, 92, 65]
        : cell.slope > 12
          ? [224, 174, 86]
          : [105, 156, 111],
      opacity,
    );
  if (layers.envelope && envelope) {
    const code = envelope[cell.i];
    color = mix(
      color,
      code === 3
        ? [91, 151, 110]
        : code === 2
          ? [196, 165, 75]
          : code === 1
            ? [155, 70, 54]
            : [46, 43, 39],
      opacity * 0.65,
    );
  }
  if (layers.hazard && (cell.blocked || closed.has(cell.i)))
    color = mix(color, [161, 71, 53], 0.8);
  if (cell.nodata) color = [33, 39, 32];
  return color.map(Math.round);
}
export class MapView {
  constructor(canvas, onSelect) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.basemap = new Image();
    this.basemap.onload = () => this.draw();
    this.basemap.src = STUDY.assets.basemap;
    this.zoom = 1;
    this.pan = { x: 0, y: 0 };
    this.onSelect = onSelect;
    this.raster = document.createElement("canvas");
    this.pointers = new Map();
    this.observer = new ResizeObserver(() => this.draw());
    this.observer.observe(canvas);
    canvas.addEventListener(
      "wheel",
      (e) => {
        e.preventDefault();
        this.changeZoom(Math.exp(-e.deltaY * 0.001));
      },
      { passive: false },
    );
    canvas.addEventListener("pointerdown", (e) => {
      canvas.focus();
      canvas.setPointerCapture(e.pointerId);
      this.drag = {
        x: e.clientX,
        y: e.clientY,
        startX: e.clientX,
        startY: e.clientY,
        pan: { ...this.pan },
        moved: false,
      };
    });
    canvas.addEventListener("pointermove", (e) => {
      if (!this.drag) return;
      const d = this.drag;
      d.moved ||= Math.hypot(e.clientX - d.startX, e.clientY - d.startY) > 5;
      this.pan = { x: d.pan.x + e.clientX - d.x, y: d.pan.y + e.clientY - d.y };
      this.draw();
    });
    canvas.addEventListener("pointerup", (e) => {
      if (this.drag && !this.drag.moved) {
        const r = canvas.getBoundingClientRect();
        this.onSelect(this.toWorld(e.clientX - r.left, e.clientY - r.top));
      }
      this.drag = null;
    });
    canvas.addEventListener("pointercancel", () => (this.drag = null));
    canvas.addEventListener("keydown", (e) => {
      if (
        [
          "+",
          "=",
          "-",
          "0",
          "ArrowUp",
          "ArrowDown",
          "ArrowLeft",
          "ArrowRight",
        ].includes(e.key)
      ) {
        e.preventDefault();
        if (e.key === "+" || e.key === "=") this.changeZoom(1.3);
        else if (e.key === "-") this.changeZoom(1 / 1.3);
        else if (e.key === "0") this.fit();
        else {
          this.pan.x +=
            e.key === "ArrowLeft" ? 25 : e.key === "ArrowRight" ? -25 : 0;
          this.pan.y +=
            e.key === "ArrowUp" ? 25 : e.key === "ArrowDown" ? -25 : 0;
          this.draw();
        }
      }
    });
  }
  setState(state) {
    this.state = state;
    const { grid } = state;
    this.raster.width = this.raster.height = grid.size;
    const ctx = this.raster.getContext("2d"),
      image = ctx.createImageData(grid.size, grid.size);
    for (const c of grid.cells) {
      const rgb = cellColor(c, state),
        i = c.i * 4;
      image.data[i] = rgb[0];
      image.data[i + 1] = rgb[1];
      image.data[i + 2] = rgb[2];
      const analytical =
        state.layers.elevation ||
        state.layers.geology ||
        state.layers.minerals ||
        state.layers.slope ||
        state.layers.envelope ||
        (state.layers.hazard && (c.blocked || state.closed.has(c.i)));
      image.data[i + 3] =
        state.layers.surface && !analytical && !c.nodata
          ? 0
          : state.layers.surface && !c.nodata
            ? 200
            : 255;
    }
    ctx.putImageData(image, 0, 0);
    this.draw();
  }
  changeZoom(factor) {
    this.zoom = clamp(this.zoom * factor, 0.65, 5);
    this.draw();
  }
  fit() {
    this.zoom = 1;
    this.pan = { x: 0, y: 0 };
    this.draw();
  }
  toScreen(p) {
    return {
      x: this.width / 2 + this.pan.x + p.x * this.scale,
      y: this.height / 2 + this.pan.y + p.z * this.scale,
    };
  }
  toWorld(x, y) {
    return {
      x: (x - this.width / 2 - this.pan.x) / this.scale,
      z: (y - this.height / 2 - this.pan.y) / this.scale,
    };
  }
  drawLine(path, color, width, dashed = false) {
    if (!path?.length) return;
    const ctx = this.ctx;
    ctx.beginPath();
    path.forEach((i, n) => {
      const p = this.toScreen(this.state.grid.cells[i]);
      n ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y);
    });
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.setLineDash(dashed ? [7, 6] : []);
    ctx.stroke();
    ctx.setLineDash([]);
  }
  draw() {
    if (!this.state || this.canvas.hidden) return;
    const { canvas, ctx, state } = this,
      { grid, home, position, route, alternative, layers, closed } = state;
    this.width = canvas.clientWidth;
    this.height = canvas.clientHeight;
    if (!this.width || !this.height) return;
    const dpr = Math.min(devicePixelRatio || 1, 2);
    canvas.width = this.width * dpr;
    canvas.height = this.height * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.scale = (Math.min(this.width, this.height) / 460) * this.zoom;
    ctx.fillStyle = "#252c23";
    ctx.fillRect(0, 0, this.width, this.height);
    const corner = this.toScreen({
        x: grid.origin - grid.cellSize / 2,
        z: grid.origin - grid.cellSize / 2,
      }),
      extent = grid.size * grid.cellSize * this.scale;
    ctx.imageSmoothingEnabled = true;
    if (layers.surface && this.basemap.complete && this.basemap.naturalWidth)
      ctx.drawImage(this.basemap, corner.x, corner.y, extent, extent);
    ctx.drawImage(this.raster, corner.x, corner.y, extent, extent);
    ctx.strokeStyle = "#e6d4b00d";
    ctx.lineWidth = 1;
    for (let n = -200; n <= 200; n += 50) {
      const a = this.toScreen({ x: n, z: -200 }),
        b = this.toScreen({ x: n, z: 200 }),
        c = this.toScreen({ x: -200, z: n }),
        d = this.toScreen({ x: 200, z: n });
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.moveTo(c.x, c.y);
      ctx.lineTo(d.x, d.y);
      ctx.stroke();
    }
    if (layers.hazard)
      for (const c of grid.cells)
        if (c.blocked || closed.has(c.i)) {
          const p = this.toScreen(c),
            s = grid.cellSize * this.scale;
          ctx.strokeStyle = "#ffbc8f66";
          ctx.lineWidth = 0.7;
          if (((c.i % grid.size) + Math.floor(c.i / grid.size)) % 2 === 0) {
            ctx.beginPath();
            ctx.moveTo(p.x - s / 2, p.y + s / 2);
            ctx.lineTo(p.x + s / 2, p.y - s / 2);
            ctx.stroke();
          }
        }
    ctx.strokeStyle = "#e9d3af33";
    ctx.strokeRect(corner.x, corner.y, extent, extent);
    if (layers.traverse) {
      for (const points of STUDY.traverse) {
        ctx.beginPath();
        points.forEach((p, i) => {
          const q = this.toScreen(p);
          i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y);
        });
        ctx.strokeStyle = "#ebc981";
        ctx.lineWidth = 1.5;
        ctx.setLineDash([2, 4]);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }
    if (alternative?.path)
      this.drawLine(
        alternative.path,
        alternative.feasible ? "#e4cf9c88" : "#c9938077",
        1.5,
        true,
      );
    if (route?.path) {
      this.drawLine(route.path, "#121e23bb", 6, route.emergency);
      this.drawLine(
        route.path,
        route.feasible ? "#95d2f5" : "#df9d80",
        2.5,
        route.emergency,
      );
    }
    const h = this.toScreen(grid.cells[home]);
    ctx.fillStyle = "#14251b";
    ctx.strokeStyle = "#d3e5b5";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.roundRect(h.x - 8, h.y - 8, 16, 16, 3);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = "#dfedc6";
    ctx.font = "12px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("⌂", h.x, h.y + 4);
    this.label(h.x, h.y + 24, "HABITAT", "#dce9c6");
    if (layers.science)
      for (const t of TARGETS) {
        const p = this.toScreen(t),
          selected = state.ids.includes(t.id),
          visited = state.visited.includes(t.id);
        ctx.beginPath();
        ctx.arc(p.x, p.y, selected ? 11 : 8, 0, Math.PI * 2);
        ctx.fillStyle = selected ? "#3b3722" : "#263025";
        ctx.fill();
        ctx.strokeStyle = selected ? "#e7cf85" : "#8b9477";
        ctx.lineWidth = 1.5;
        ctx.stroke();
        ctx.fillStyle = selected ? "#f0dda7" : "#acb99a";
        ctx.font = "600 10px sans-serif";
        ctx.textAlign = "center";
        ctx.fillText(visited ? "✓" : t.id, p.x, p.y + 3);
        this.label(
          p.x,
          p.y - 20,
          t.title.toUpperCase(),
          selected ? "#ebd8a5" : "#b2bc9e",
        );
      }
    const p = this.toScreen(state.pose ?? grid.cells[position]);
    ctx.beginPath();
    ctx.arc(p.x, p.y, 13, 0, Math.PI * 2);
    ctx.fillStyle = "#94cceb22";
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(p.x, p.y - 7);
    ctx.lineTo(p.x + 5, p.y + 5);
    ctx.lineTo(p.x, p.y + 3);
    ctx.lineTo(p.x - 5, p.y + 5);
    ctx.closePath();
    ctx.fillStyle = "#edfaff";
    ctx.fill();
    ctx.strokeStyle = "#284047";
    ctx.lineWidth = 1;
    ctx.stroke();
    const scaleWidth = 50 * this.scale;
    ctx.fillStyle = "#eee6cf";
    ctx.strokeStyle = "#eee6cf";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(23, this.height - 95);
    ctx.lineTo(23 + scaleWidth, this.height - 95);
    ctx.stroke();
    ctx.font = "8px sans-serif";
    ctx.textAlign = "left";
    ctx.fillText("50 m", 23, this.height - 103);
    if (grid.cells[cellIndex(grid, { x: -175, z: -175 })]?.nodata) {
      const n = this.toScreen({ x: -177, z: -174 });
      ctx.font = "8px sans-serif";
      ctx.fillStyle = "#87927d";
      ctx.textAlign = "center";
      ctx.fillText("NO DATA", n.x, n.y);
    }
  }
  label(x, y, text, color) {
    const c = this.ctx;
    c.font = "600 8px sans-serif";
    c.textAlign = "center";
    const w = c.measureText(text).width + 12;
    c.fillStyle = "#15201bd9";
    c.beginPath();
    c.roundRect(x - w / 2, y - 9, w, 16, 3);
    c.fill();
    c.fillStyle = color;
    c.fillText(text, x, y + 2);
  }
}
export function drawProfile(canvas, route, offset, grid) {
  const w = canvas.clientWidth,
    h = canvas.clientHeight,
    dpr = Math.min(devicePixelRatio || 1, 2);
  canvas.width = w * dpr;
  canvas.height = h * dpr;
  const c = canvas.getContext("2d");
  c.setTransform(dpr, 0, 0, dpr, 0, 0);
  c.clearRect(0, 0, w, h);
  if (!route?.path) {
    c.fillStyle = "#92a18a";
    c.font = "10px sans-serif";
    c.fillText("No traversable route to profile.", 10, 40);
    return;
  }
  const points = route.metrics.profile,
    min = Math.min(...points.map((p) => p.height)) - 2,
    max = Math.max(...points.map((p) => p.height)) + 3,
    dist = route.metrics.distance || 1;
  const x = (d) => 34 + (d / dist) * (w - 45),
    y = (v) => 12 + ((max - v) / (max - min)) * (h - 30);
  c.font = "8px sans-serif";
  c.textAlign = "right";
  for (let i = 0; i < 3; i++) {
    const v = min + ((max - min) * i) / 2,
      py = y(v);
    c.strokeStyle = "#8fa27b1c";
    c.beginPath();
    c.moveTo(33, py);
    c.lineTo(w, py);
    c.stroke();
    c.fillStyle = "#94a48b";
    c.fillText(`${v.toFixed(0)} m`, 28, py + 3);
  }
  c.beginPath();
  points.forEach((p, i) =>
    i
      ? c.lineTo(x(p.distance), y(p.height))
      : c.moveTo(x(p.distance), y(p.height)),
  );
  c.strokeStyle = "#9cc5a2";
  c.lineWidth = 1.5;
  c.stroke();
  c.lineTo(x(dist), h - 18);
  c.lineTo(x(0), h - 18);
  c.closePath();
  const grad = c.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, "#86ab783a");
  grad.addColorStop(1, "#86ab7803");
  c.fillStyle = grad;
  c.fill();
  const point = points[Math.min(offset, points.length - 1)];
  c.setLineDash([2, 3]);
  c.strokeStyle = "#b5e4f3";
  c.beginPath();
  c.moveTo(x(point.distance), 6);
  c.lineTo(x(point.distance), h - 18);
  c.stroke();
  c.setLineDash([]);
  c.beginPath();
  c.arc(x(point.distance), y(point.height), 3, 0, Math.PI * 2);
  c.fillStyle = "#e1f5ff";
  c.fill();
  c.fillStyle = "#94a48b";
  c.textAlign = "left";
  c.fillText("0 m", 34, h - 3);
  c.textAlign = "right";
  c.fillText(`${dist.toFixed(0)} m`, w - 10, h - 3);
}
