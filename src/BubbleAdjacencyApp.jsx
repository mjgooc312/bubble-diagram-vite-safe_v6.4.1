// src/BubbleAdjacencyApp.jsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import * as d3 from "d3";

/**
 * Bubble Diagram Builder – Force-directed (React + D3)
 * v4.9.2 — Gradient fills • Floating JSON dock • Auto-connect in conflicts
 *           Key toggles for link type → connect mode • No-overlap even w/ physics OFF
 *           Dynamic label sizing (global scale) with hard OFF reset
 *           Separate fixed area-label size • Drag-lock button on canvas
 *           Drag fix w/ zoom • Spin speed capped
 */

const THEME = {
  bg: "#0b0b12",
  surface: "#121220",
  text: "#e6e6f0",
  subtle: "#9aa0a6",
  border: "#2a2a3a",
};

// Circle radius bounds
const BASE_R_MIN = 36;
const BASE_R_MAX = 120;

// Text-size bounds (px)
const TEXT_MIN = 9;
const TEXT_MAX = 28;

// Font stacks
const FONT_STACKS = {
  Outfit: "Outfit, Inter, system-ui, Arial, sans-serif",
  Inter: "Inter, system-ui, Arial, sans-serif",
  Poppins: "Poppins, system-ui, Arial, sans-serif",
  Roboto: "Roboto, system-ui, Arial, sans-serif",
  System: "system-ui, Arial, sans-serif",
  HelveticaNowCondensed:
    '"Helvetica Now Text Condensed", "Helvetica Now Display Condensed", "Helvetica Now Condensed", "HelveticaNeue-Condensed", "Arial Narrow", Arial, sans-serif',
};

const SAMPLE_TEXT = `Officials / Referees Room, 120
Analyst / Data Room, 80
VOD Review / Theater, 60
Match Admin Room, 90
Competition Manager Office, 45
Briefing / Protest Room, 110
Player Warm-up Pods (Concourse), 130`;

const uid = () => Math.random().toString(36).slice(2, 9);
const pairKey = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`);
function toNumber(v, fallback) {
  const n = typeof v === "string" && v.trim() === "" ? NaN : Number(v);
  return Number.isFinite(n) ? n : fallback;
}
function norm(s) {
  return String(s || "").trim().toLowerCase().replace(/\s+/g, " ");
}
function clampTextSize(v) {
  const n = toNumber(v, 12);
  return Math.max(TEXT_MIN, Math.min(TEXT_MAX, n));
}
function parseList(text) {
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((line) => {
      const m = line.match(/^(.*?)[,|-]?\s*(\d+(?:\.\d+)?)\s*$/);
      return m
        ? { id: uid(), name: m[1].trim(), area: parseFloat(m[2]) }
        : { id: uid(), name: line, area: 20 };
    });
}
function scaleRadius(nodes) {
  const sqrtAreas = nodes.map((n) => Math.sqrt(Math.max(1, n.area || 1)));
  const min = d3.min(sqrtAreas) ?? 1;
  const max = d3.max(sqrtAreas) ?? 1;
  return (area) => {
    const v = Math.sqrt(Math.max(1, area || 1));
    if (max === min) return BASE_R_MIN;
    return BASE_R_MIN + ((v - min) / (max - min)) * (BASE_R_MAX - BASE_R_MIN);
  };
}
function download(url, filename) {
  try {
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.style.display = "none";
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      document.body.removeChild(a);
      try {
        URL.revokeObjectURL(url);
      } catch {}
    }, 50);
  } catch {
    window.open(url, "_blank");
  }
}

// ----- Arrowheads ------------------------------------------------------------
const HEAD_SHAPES = ["none", "arrow", "circle", "square", "diamond", "bar"];
const sanitizeColorId = (c) => String(c).replace(/[^a-zA-Z0-9]/g, "");
const markerId = (kind, shape, color) =>
  `m-${kind}-${shape}-${sanitizeColorId(color)}`;

function MarkerDefs({ styles }) {
  const defs = [];
  ["necessary", "ideal"].forEach((k) => {
    const st = styles[k];
    ["start", "end"].forEach((kind) => {
      const shape = kind === "start" ? st.headStart : st.headEnd;
      if (shape === "none") return;
      const id = markerId(kind, `${shape}-${k}`, st.color);
      defs.push(
        <marker
          key={id}
          id={id}
          markerWidth={10}
          markerHeight={10}
          refX={kind === "end" ? 9 : 1}
          refY={3.5}
          orient="auto"
          markerUnits="strokeWidth"
        >
          {shape === "arrow" && (
            <polygon
              points={
                kind === "end" ? "0 0, 10 3.5, 0 7" : "10 0, 0 3.5, 10 7"
              }
              fill={st.color}
            />
          )}
          {shape === "circle" && (
            <circle cx={kind === "end" ? 7 : 3} cy={3.5} r={3} fill={st.color} />
          )}
          {shape === "square" && (
            <rect
              x={kind === "end" ? 3 : 1}
              y={1}
              width={6}
              height={6}
              fill={st.color}
            />
          )}
          {shape === "diamond" && (
            <polygon
              points="3.5 0, 7 3.5, 3.5 7, 0 3.5"
              transform={kind === "end" ? "translate(3,0)" : "translate(1,0)"}
              fill={st.color}
            />
          )}
          {shape === "bar" && (
            <rect
              x={kind === "end" ? 7.5 : 1.5}
              y={0.5}
              width={1.5}
              height={6.5}
              fill={st.color}
            />
          )}
        </marker>
      );
    });
  });
  return <defs>{defs}</defs>;
}

// ------------------------- Persistence ---------------------------------------
const LS_KEY = "bubbleBuilder:v1";
const AUTOSAVE_KEY = "bubbleBuilder:autosave";
function loadPresets() {
  try {
    return JSON.parse(localStorage.getItem(LS_KEY) || "{}");
  } catch {
    return {};
  }
}
function savePresets(obj) {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(obj));
  } catch {}
}

// ------------------------- Custom spin force ---------------------------------
// Limit spin so the canvas doesn't become dizzying
function makeSpinForce(level /* 0..100 (capped internally) */) {
  let nodes = [];
  const base = 0.0002;
  const maxLevel = 50; // hard cap

  function force(alpha) {
    const lvl = Math.min(maxLevel, Math.max(0, level || 0));
    if (!lvl) return;
    const k = base * lvl * alpha;
    for (const n of nodes) {
      const x = n.x || 0,
        y = n.y || 0;
      n.vx += -y * k;
      n.vy += x * k;
    }
  }
  force.initialize = (ns) => {
    nodes = ns;
  };
  return force;
}

// --- Geometry helpers --------------------------------------------------------
function pointInPolygon(p, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x,
      yi = poly[i].y;
    const xj = poly[j].x,
      yj = poly[j].y;
    const intersect =
      yi > p.y !== yj > p.y &&
      p.x <
        ((xj - xi) * (p.y - yi)) / (yj - yi + (yj === yi ? 1e-9 : 0)) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

// ---------------------------- MAIN APP ---------------------------------------
export default function BubbleAdjacencyApp() {
  // Graph
  const [nodes, setNodes] = useState([]);
  const [links, setLinks] = useState([]);

  // Selection / lasso
  const [selectedIds, setSelectedIds] = useState([]);
  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const [lasso, setLasso] = useState({ active: false, points: [] });

  // Modes
  const [mode, setMode] = useState("select");
  const [currentLineType, setCurrentLineType] = useState("necessary");
  const [linkSource, setLinkSource] = useState(null);

  const [hoverId, setHoverId] = useState(null);
  const [selectedNodeId, setSelectedNodeId] = useState(null);

  // Physics
  const [physics, setPhysics] = useState(true);

  // Canvas drag-lock (prevents node dragging)
  const [canvasLocked, setCanvasLocked] = useState(false);

  // Buffer between bubbles
  const [buffer, setBuffer] = useState(6);

  // Arrow overlap
  const [arrowOverlap, setArrowOverlap] = useState(0);

  // Rotation
  const [rotationSensitivity, setRotationSensitivity] = useState(0);

  // Labels
  const [showMeasurements, setShowMeasurements] = useState(true);
  const [autoLabelSize, setAutoLabelSize] = useState(true);
  const [dynamicTextScale, setDynamicTextScale] = useState(1); // global scale for dynamic labels
  const [areaLabelSize, setAreaLabelSize] = useState(11); // fixed size for area labels

  // A11y
  const [highContrast, setHighContrast] = useState(false);

  // Conflicts
  const [expectedPairsText, setExpectedPairsText] = useState("");
  const [longFactor, setLongFactor] = useState(1.8);

  // Detangle
  const [explodeFactor, setExplodeFactor] = useState(1);
  const explodeTORef = useRef(null);

  // Scenes
  const SCENES_KEY = "bubbleScenes:v1";
  const [scenes, setScenes] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem(SCENES_KEY) || "[]");
    } catch {
      return [];
    }
  });
  const [activeSceneId, setActiveSceneId] = useState(null);
  useEffect(() => {
    try {
      localStorage.setItem(SCENES_KEY, JSON.stringify(scenes));
    } catch {}
  }, [scenes]);

  // Line style presets
  const [styles, setStyles] = useState({
    necessary: {
      color: "#8b5cf6",
      dashed: false,
      width: 3,
      headStart: "arrow",
      headEnd: "arrow",
    },
    ideal: {
      color: "#facc15",
      dashed: true,
      width: 3,
      headStart: "arrow",
      headEnd: "arrow",
    },
  });

  // Export backgrounds
  const [exportBgMode, setExportBgMode] = useState("transparent"); // transparent | white | custom
  const [exportBgCustom, setExportBgCustom] = useState("#ffffff");

  // Live preview background
  const [liveBgMode, setLiveBgMode] = useState("custom"); // transparent | white | custom
  const [liveBgCustom, setLiveBgCustom] = useState(THEME.surface);

  // Bulk bubble/label defaults
  const [bulkFill, setBulkFill] = useState("#161625");
  const [bulkFillTransparent, setBulkFillTransparent] = useState(false);
  const [bulkStroke, setBulkStroke] = useState("#2d2d3d");
  const [bulkStrokeWidth, setBulkStrokeWidth] = useState(2);
  const [bulkTextFont, setBulkTextFont] = useState(FONT_STACKS.Outfit);
  const [bulkTextColor, setBulkTextColor] = useState("#e6e6f0");
  const [bulkTextSize, setBulkTextSize] = useState(12);

  // Bulk gradient controls
  const [bulkGradientEnabled, setBulkGradientEnabled] = useState(false);
  const [bulkGradC1, setBulkGradC1] = useState("#1f1f2f");
  const [bulkGradC2, setBulkGradC2] = useState("#35355a");
  const [bulkGradAngle, setBulkGradAngle] = useState(30); // degrees

  // Input list / updates
  const [rawList, setRawList] = useState("");
  const [updateAreasFromList, setUpdateAreasFromList] = useState(false);
  const [updateMatchMode, setUpdateMatchMode] = useState("name");

  // Refs
  const svgRef = useRef(null);
  const simRef = useRef(null);
  const containerRef = useRef(null);
  const jsonHandleRef = useRef(null);
  const zoomBehaviorRef = useRef(null);
  const [zoomTransform, setZoomTransform] = useState(d3.zoomIdentity);

  const rOf = useMemo(() => scaleRadius(nodes), [nodes]);

  // History
  const historyRef = useRef([]);
  const futureRef = useRef([]);
  const snapshot = () => ({
    nodes: JSON.parse(JSON.stringify(nodes)),
    links: JSON.parse(JSON.stringify(links)),
    styles: JSON.parse(JSON.stringify(styles)),
    buffer,
    arrowOverlap,
    rotationSensitivity,
    autoLabelSize,
    dynamicTextScale,
    areaLabelSize,
  });
  const pushHistory = () => {
    historyRef.current.push(snapshot());
    futureRef.current = [];
  };
  function undo() {
    if (!historyRef.current.length) return;
    const prev = historyRef.current.pop();
    futureRef.current.push(snapshot());
    setNodes(prev.nodes);
    setLinks(prev.links);
    setStyles(prev.styles);
    setBuffer(prev.buffer);
    setArrowOverlap(prev.arrowOverlap ?? 0);
    setRotationSensitivity(prev.rotationSensitivity ?? 0);
    setAutoLabelSize(prev.autoLabelSize ?? true);
    setDynamicTextScale(prev.dynamicTextScale ?? 1);
    setAreaLabelSize(prev.areaLabelSize ?? 11);
  }
  function redo() {
    if (!futureRef.current.length) return;
    const next = futureRef.current.pop();
    historyRef.current.push(snapshot());
    setNodes(next.nodes);
    setLinks(next.links);
    setStyles(next.styles);
    setBuffer(next.buffer);
    setArrowOverlap(next.arrowOverlap ?? 0);
    setRotationSensitivity(next.rotationSensitivity ?? 0);
    setAutoLabelSize(next.autoLabelSize ?? true);
    setDynamicTextScale(next.dynamicTextScale ?? 1);
    setAreaLabelSize(next.areaLabelSize ?? 11);
  }

  // Presets / autosave LOAD
  useEffect(() => {
    const p = loadPresets();
    if (!p) return;
    if (p.styles) setStyles((s) => ({ ...s, ...p.styles }));
    if (typeof p.buffer === "number") setBuffer(p.buffer);
    if (typeof p.arrowOverlap === "number") setArrowOverlap(p.arrowOverlap);
    if (typeof p.rotationSensitivity === "number")
      setRotationSensitivity(Math.max(0, Math.min(50, p.rotationSensitivity)));
    if (typeof p.autoLabelSize === "boolean") setAutoLabelSize(p.autoLabelSize);
    if (typeof p.dynamicTextScale === "number")
      setDynamicTextScale(
        Math.max(0.6, Math.min(1.8, p.dynamicTextScale || 1))
      );
    if (typeof p.areaLabelSize === "number")
      setAreaLabelSize(clampTextSize(p.areaLabelSize));
    if (p.bulk) {
      const b = p.bulk;
      if (typeof b.bulkFill === "string") setBulkFill(b.bulkFill);
      if (typeof b.bulkFillTransparent === "boolean")
        setBulkFillTransparent(b.bulkFillTransparent);
      if (typeof b.bulkStroke === "string") setBulkStroke(b.bulkStroke);
      if (typeof b.bulkStrokeWidth === "number")
        setBulkStrokeWidth(Math.max(1, Math.min(12, b.bulkStrokeWidth)));
      if (typeof b.bulkTextFont === "string") setBulkTextFont(b.bulkTextFont);
      if (typeof b.bulkTextColor === "string") setBulkTextColor(b.bulkTextColor);
      if (b.bulkTextSize != null) setBulkTextSize(clampTextSize(b.bulkTextSize));
      if (typeof b.bulkGradientEnabled === "boolean")
        setBulkGradientEnabled(b.bulkGradientEnabled);
      if (typeof b.bulkGradC1 === "string") setBulkGradC1(b.bulkGradC1);
      if (typeof b.bulkGradC2 === "string") setBulkGradC2(b.bulkGradC2);
      if (typeof b.bulkGradAngle === "number") setBulkGradAngle(b.bulkGradAngle);
    }
    if (p.exportBgMode) setExportBgMode(p.exportBgMode);
    if (p.exportBgCustom) setExportBgCustom(p.exportBgCustom);
    if (p.liveBgMode) setLiveBgMode(p.liveBgMode);
    if (p.liveBgCustom) setLiveBgCustom(p.liveBgCustom);
  }, []);

  // Presets SAVE
  useEffect(() => {
    const payload = {
      styles,
      buffer,
      arrowOverlap,
      rotationSensitivity,
      autoLabelSize,
      dynamicTextScale,
      areaLabelSize,
      bulk: {
        bulkFill,
        bulkFillTransparent,
        bulkStroke,
        bulkStrokeWidth,
        bulkTextFont,
        bulkTextColor,
        bulkTextSize: clampTextSize(bulkTextSize),
        bulkGradientEnabled,
        bulkGradC1,
        bulkGradC2,
        bulkGradAngle,
      },
      exportBgMode,
      exportBgCustom,
      liveBgMode,
      liveBgCustom,
      scenes,
      activeSceneId,
    };
    savePresets(payload);
  }, [
    styles,
    buffer,
    arrowOverlap,
    rotationSensitivity,
    autoLabelSize,
    dynamicTextScale,
    areaLabelSize,
    bulkFill,
    bulkFillTransparent,
    bulkStroke,
    bulkStrokeWidth,
    bulkTextFont,
    bulkTextColor,
    bulkTextSize,
    bulkGradientEnabled,
    bulkGradC1,
    bulkGradC2,
    bulkGradAngle,
    exportBgMode,
    exportBgCustom,
    liveBgMode,
    liveBgCustom,
    scenes,
    activeSceneId,
  ]);

  // Autosave
  useEffect(() => {
    const id = setInterval(() => {
      try {
        const blob = {
          ...buildExportPayload(),
          timestamp: Date.now(),
        };
        localStorage.setItem(AUTOSAVE_KEY, JSON.stringify(blob));
      } catch {}
    }, 45000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    nodes,
    links,
    styles,
    buffer,
    rotationSensitivity,
    arrowOverlap,
    autoLabelSize,
    dynamicTextScale,
    areaLabelSize,
  ]);

  // Crash recovery prompt
  useEffect(() => {
    try {
      const raw = localStorage.getItem(AUTOSAVE_KEY);
      if (!raw) return;
      const saved = JSON.parse(raw);
      if (!saved || !saved.nodes) return;
      const ts = new Date(saved.timestamp || Date.now());
      const ok = window.confirm(
        `A recoverable autosave was found from ${ts.toLocaleString()}. Restore it?`
      );
      if (ok) parseAndLoadJSON(JSON.stringify(saved));
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Simulation
  useEffect(() => {
    const sim = d3
      .forceSimulation()
      .alphaDecay(0.05)
      .velocityDecay(0.3)
      .force("charge", d3.forceManyBody().strength(-80))
      .force(
        "collide",
        d3.forceCollide().radius((d) => (d.r || BASE_R_MIN) + buffer)
      )
      .force("center", d3.forceCenter(0, 0))
      .force("spin", makeSpinForce(rotationSensitivity));
    simRef.current = sim;
    return () => sim.stop();
  }, []);

  useEffect(() => {
    const sim = simRef.current;
    if (!sim) return;
    sim.force("spin", makeSpinForce(rotationSensitivity));
    if (physics && rotationSensitivity > 0) sim.alpha(0.5).restart();
  }, [rotationSensitivity, physics]);

  useEffect(() => {
    const sim = simRef.current;
    if (!sim) return;
    const baseCharge = -80;
    const mult = explodeFactor > 1 ? 1.8 * explodeFactor : 1;
    const charge = sim.force("charge");
    charge && charge.strength(baseCharge * mult);

    sim.force(
      "collide",
      d3
        .forceCollide()
        .radius(
          (d) =>
            (d.r || BASE_R_MIN) +
            buffer +
            Math.max(0, (explodeFactor - 1) * 18)
        )
    );

    if (physics) sim.alpha(0.7).restart();
  }, [explodeFactor, buffer, physics]);

  const rafRef = useRef(null);
  useEffect(() => {
    // lock-fix & radius
    const nn = nodes.map((n) => ({
      ...n,
      r: rOf(n.area),
      fx: n.locked ? (n.fx ?? n.x ?? 0) : n.fx,
      fy: n.locked ? (n.fy ?? n.y ?? 0) : n.fy,
    }));

    // De-dupe links by pair (prefer necessary)
    const byPair = new Map();
    for (const l of links) {
      const k = pairKey(l.source, l.target);
      const prev = byPair.get(k);
      if (!prev) byPair.set(k, l);
      else if (prev.type !== "necessary" && l.type === "necessary") byPair.set(k, l);
    }
    const linkArr = Array.from(byPair.values()).map((l) => ({
      ...l,
      source: nn.find((n) => n.id === l.source),
      target: nn.find((n) => n.id === l.target),
    }));

    const sim = simRef.current;
    if (!sim) return;

    const linkForce = d3
      .forceLink(linkArr)
      .id((d) => d.id)
      .distance((l) => {
        const base = (l.source.r || BASE_R_MIN) + (l.target.r || BASE_R_MIN);
        const k = l.type === "necessary" ? 1.1 : 1.0;
        const d0 = base * 1.05 * k + 40 + buffer * 1.5;
        return d0 * (explodeFactor || 1);
      })
      .strength((l) => (l.type === "necessary" ? 0.5 : 0.25));

    sim.nodes(nn);
    sim.force(
      "collide",
      d3
        .forceCollide()
        .radius(
          (d) =>
            (d.r || BASE_R_MIN) +
            buffer +
            Math.max(0, (explodeFactor - 1) * 18)
        )
    );
    sim.force("link", linkForce);
    sim.force("x", d3.forceX().strength(0.03));
    sim.force("y", d3.forceY().strength(0.03));

    if (physics) sim.alpha(0.9).restart();
    else sim.stop();

    const idMap = new Map(nn.map((n) => [n.id, n]));
    const onTick = () => {
      if (rafRef.current != null) return;
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = null;
        setNodes((prev) => prev.map((p) => ({ ...p, ...idMap.get(p.id) })));
      });
    };
    sim.on("tick", onTick);
    return () => {
      sim.on("tick", null);
      if (rafRef.current != null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodes.length, links, physics, rOf, buffer, explodeFactor]);

  // Generate / Update list
  function onGenerate() {
    pushHistory();
    const parsed = parseList(rawList || SAMPLE_TEXT);
    const angle = (2 * Math.PI) / Math.max(1, parsed.length);
    const R = 260;
    const init = parsed.map((n, i) => ({
      ...n,
      x: Math.cos(i * angle) * R,
      y: Math.sin(i * angle) * R,
      fillType: bulkGradientEnabled ? "gradient" : "solid",
      grad: { c1: bulkGradC1, c2: bulkGradC2, angle: bulkGradAngle },
      fill: bulkFillTransparent ? "none" : bulkFill,
      stroke: bulkStroke,
      strokeWidth: bulkStrokeWidth,
      textFont: bulkTextFont,
      textColor: bulkTextColor,
      textSize: clampTextSize(bulkTextSize),
      textSizeManual: false,
      autoText: true, // per-node auto label size (defaults true)
    }));
    setNodes(init);
    setLinks([]);
    setMode("select");
    setLinkSource(null);
    setPhysics(true);
    setSelectedNodeId(null);
    setSelectedIds([]);
    resetZoom();
  }

  function updateFromList() {
    if (!nodes.length) return;
    const parsed = parseList(rawList || "");
    if (!parsed.length) return;
    pushHistory();

    if (updateMatchMode === "index") {
      setNodes((prev) =>
        prev.map((n, i) => {
          if (i >= parsed.length) return n;
          const src = parsed[i];
          return {
            ...n,
            name: src.name,
            ...(updateAreasFromList
              ? { area: Math.max(1, +src.area || n.area) }
              : {}),
          };
        })
      );
      if (parsed.length > nodes.length) {
        const extras = parsed.slice(nodes.length).map((x) => ({
          id: uid(),
          name: x.name,
          area: Math.max(1, +x.area || 20),
          x: (Math.random() - 0.5) * 40,
          y: (Math.random() - 0.5) * 40,
          fillType: bulkGradientEnabled ? "gradient" : "solid",
          grad: { c1: bulkGradC1, c2: bulkGradC2, angle: bulkGradAngle },
          fill: bulkFillTransparent ? "none" : bulkFill,
          stroke: bulkStroke,
          strokeWidth: bulkStrokeWidth,
          textFont: bulkTextFont,
          textColor: bulkTextColor,
          textSize: clampTextSize(bulkTextSize),
          textSizeManual: false,
          autoText: true,
        }));
        setNodes((prev) => [...prev, ...extras]);
      }
      return;
    }

    // match by name
    setNodes((prev) => {
      const buckets = new Map();
      prev.forEach((n, idx) => {
        const k = norm(n.name);
        const arr = buckets.get(k) || [];
        arr.push(idx);
        buckets.set(k, arr);
      });

      const updated = [...prev];
      const used = new Set();
      const extras = [];

      parsed.forEach((src) => {
        const key = norm(src.name);
        const arr = buckets.get(key);
        let idx = -1;
        if (arr && arr.length) idx = arr.shift();
        if (idx >= 0 && !used.has(idx)) {
          updated[idx] = {
            ...updated[idx],
            name: src.name,
            ...(updateAreasFromList
              ? { area: Math.max(1, +src.area || updated[idx].area) }
              : {}),
          };
          used.add(idx);
        } else {
          extras.push({
            id: uid(),
            name: src.name,
            area: Math.max(1, +src.area || 20),
            x: (Math.random() - 0.5) * 40,
            y: (Math.random() - 0.5) * 40,
            fillType: bulkGradientEnabled ? "gradient" : "solid",
            grad: { c1: bulkGradC1, c2: bulkGradC2, angle: bulkGradAngle },
            fill: bulkFillTransparent ? "none" : bulkFill,
            stroke: bulkStroke,
            strokeWidth: bulkStrokeWidth,
            textFont: bulkTextFont,
            textColor: bulkTextColor,
            textSize: clampTextSize(bulkTextSize),
            textSizeManual: false,
            autoText: true,
          });
        }
      });
      return extras.length ? [...updated, ...extras] : updated;
    });
  }

  function clearAll() {
    pushHistory();
    setNodes([]);
    setLinks([]);
    setLinkSource(null);
    setSelectedNodeId(null);
    setSelectedIds([]);
  }

  // Connect handling
  function handleConnect(node) {
    if (mode !== "connect") return;
    if (!linkSource) {
      setLinkSource(node.id);
      return;
    }
    if (linkSource === node.id) {
      setLinkSource(null);
      return;
    }
    pushHistory();
    setLinks((p) => [
      ...removePairLinks(p, linkSource, node.id),
      { id: uid(), source: linkSource, target: node.id, type: currentLineType },
    ]);
    setLinkSource(null);
  }

  // Bulk appliers
  function applyBulkBubbleStylesToAll() {
    pushHistory();
    setNodes((prev) =>
      prev.map((n) => ({
        ...n,
        fillType: bulkGradientEnabled ? "gradient" : "solid",
        grad: {
          ...(n.grad || {}),
          c1: bulkGradC1,
          c2: bulkGradC2,
          angle: bulkGradAngle,
        },
        fill: bulkFillTransparent ? "none" : bulkFill,
        stroke: bulkStroke,
        strokeWidth: bulkStrokeWidth,
      }))
    );
  }
  function applyBulkTextStylesToAll() {
    // FORCE one uniform size for all and disable per-node auto
    pushHistory();
    setNodes((prev) =>
      prev.map((n) => ({
        ...n,
        textFont: bulkTextFont,
        textColor: bulkTextColor,
        textSize: clampTextSize(bulkTextSize),
        textSizeManual: true,
        autoText: false,
      }))
    );
  }
  function applyBulkBubbleStylesToSelection() {
    if (!selectedIds.length) return;
    pushHistory();
    setNodes((prev) =>
      prev.map((n) =>
        selectedSet.has(n.id)
          ? {
              ...n,
              fillType: bulkGradientEnabled ? "gradient" : "solid",
              grad: {
                ...(n.grad || {}),
                c1: bulkGradC1,
                c2: bulkGradC2,
                angle: bulkGradAngle,
              },
              fill: bulkFillTransparent ? "none" : bulkFill,
              stroke: bulkStroke,
              strokeWidth: bulkStrokeWidth,
            }
          : n
      )
    );
  }
  function applyBulkTextStylesToSelection() {
    if (!selectedIds.length) return;
    pushHistory();
    setNodes((prev) =>
      prev.map((n) =>
        selectedSet.has(n.id)
          ? {
              ...n,
              textFont: bulkTextFont,
              textColor: bulkTextColor,
              textSize: clampTextSize(bulkTextSize),
              textSizeManual: true,
              autoText: false,
            }
          : n
      )
    );
  }

  // Selection helpers
  const selectOnly = (id) => setSelectedIds(id ? [id] : []);
  const toggleSelect = (id) =>
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  const clearSelection = () => setSelectedIds([]);
  const selectAll = () => setSelectedIds(nodes.map((n) => n.id));

  function deleteSelection() {
    if (!selectedIds.length) return;
    pushHistory();
    const set = new Set(selectedIds);
    setNodes((prev) => prev.filter((n) => !set.has(n.id)));
    setLinks((prev) =>
      prev.filter((l) => !set.has(l.source) && !set.has(l.target))
    );
    setSelectedIds([]);
    if (selectedNodeId && set.has(selectedNodeId)) setSelectedNodeId(null);
  }

  // Dragging
  const groupDragRef = useRef(null);
  const dragStartSnapshotRef = useRef(null);

  // Proper conversion of client pointer coords → local graph coords (honors zoom)
  function svgToLocalPoint(svgEl, clientX, clientY) {
    if (!svgEl) return { x: clientX, y: clientY };
    const pt = svgEl.createSVGPoint();
    pt.x = clientX;
    pt.y = clientY;
    const inner = svgEl.querySelector("g#zoomable") || svgEl;
    const ctm = inner.getScreenCTM();
    if (!ctm) return { x: clientX, y: clientY };
    const p = pt.matrixTransform(ctm.inverse());
    return { x: p.x, y: p.y };
  }

  function onPointerDownNode(e, node) {
    e.stopPropagation();

    // If canvas is locked: allow selection but no drag
    if (canvasLocked) {
      if (e.ctrlKey || e.metaKey || e.shiftKey) toggleSelect(node.id);
      else if (!selectedSet.has(node.id)) selectOnly(node.id);
      setSelectedNodeId(node.id);
      return;
    }

    if (mode === "connect") return;

    if (e.ctrlKey || e.metaKey || e.shiftKey) toggleSelect(node.id);
    else if (!selectedSet.has(node.id)) selectOnly(node.id);

    setSelectedNodeId(node.id);

    // start group drag
    const svg = svgRef.current;
    const pt = svgToLocalPoint(svg, e.clientX, e.clientY);
    const ids = selectedSet.has(node.id) ? [...selectedIds] : [node.id];
    const startPos = new Map();
    const dict = new Map(nodes.map((n) => [n.id, n]));
    ids.forEach((id) => {
      const n = dict.get(id);
      startPos.set(id, { x: n?.x || 0, y: n?.y || 0, r: rOf(n.area) });
    });
    groupDragRef.current = { ids, start: pt, startPos };
    dragStartSnapshotRef.current = snapshot();
    try {
      e.currentTarget.setPointerCapture?.(e.pointerId);
    } catch {}
    simRef.current?.alphaTarget(0.4).restart();
  }

  function onPointerMove(e) {
    if (lasso.active) {
      const svg = svgRef.current;
      const p = svgToLocalPoint(svg, e.clientX, e.clientY);
      setLasso((prev) => ({ active: true, points: [...prev.points, p] }));
      return;
    }
    if (canvasLocked) return;

    const drag = groupDragRef.current;
    if (!drag) return;
    const svg = svgRef.current;
    const { x, y } = svgToLocalPoint(svg, e.clientX, e.clientY);
    const dx = x - drag.start.x;
    const dy = y - drag.start.y;

    // Move selected nodes following the cursor
    setNodes((prev) => {
      const next = prev.map((n) =>
        drag.ids.includes(n.id)
          ? {
              ...n,
              x: drag.startPos.get(n.id).x + dx,
              y: drag.startPos.get(n.id).y + dy,
              fx: drag.startPos.get(n.id).x + dx,
              fy: drag.startPos.get(n.id).y + dy,
            }
          : n
      );

      // If physics OFF — resolve overlaps on-the-fly (selected vs all)
      if (!physics) {
        const all = new Map(next.map((n) => [n.id, n]));
        for (const id of drag.ids) {
          const a = all.get(id);
          if (!a) continue;
          const ra = rOf(a.area);
          for (const b of next) {
            if (b.id === id) continue;
            const rb = rOf(b.area);
            const minD = ra + rb + buffer;
            const dx2 = (a.x || 0) - (b.x || 0);
            const dy2 = (a.y || 0) - (b.y || 0);
            let d = Math.hypot(dx2, dy2) || 1e-6;
            if (d < minD) {
              const push = minD - d + 0.5;
              const nx = dx2 / d;
              const ny = dy2 / d;
              a.x = (a.x || 0) + nx * push;
              a.y = (a.y || 0) + ny * push;
              a.fx = a.x;
              a.fy = a.y;
              d = minD;
            }
          }
        }
      }
      return next;
    });
  }

  function onPointerUp() {
    if (lasso.active) {
      finishLasso();
      return;
    }
    if (canvasLocked) return;

    const drag = groupDragRef.current;
    if (!drag) return;
    // release fx/fy unless locked
    setNodes((prev) =>
      prev.map((n) =>
        drag.ids.includes(n.id)
          ? {
              ...n,
              fx: n.locked ? (n.x ?? 0) : undefined,
              fy: n.locked ? (n.y ?? 0) : undefined,
            }
          : n
      )
    );

    // If physics OFF, run a quick single-pass collision resolve
    if (!physics) resolveCollisionsOnce();

    groupDragRef.current = null;
    if (dragStartSnapshotRef.current)
      historyRef.current.push(dragStartSnapshotRef.current);
    dragStartSnapshotRef.current = null;
    simRef.current?.alphaTarget(0);
  }

  // One-shot collision resolution when physics is OFF
  function resolveCollisionsOnce(iterations = 2) {
    setNodes((prev) => {
      const arr = prev.map((n) => ({ ...n }));
      for (let it = 0; it < iterations; it++) {
        for (let i = 0; i < arr.length; i++) {
          for (let j = i + 1; j < arr.length; j++) {
            const a = arr[i],
              b = arr[j];
            const ra = rOf(a.area),
              rb = rOf(b.area);
            const minD = ra + rb + buffer;
            const dx = (b.x || 0) - (a.x || 0);
            const dy = (b.y || 0) - (a.y || 0);
            let d = Math.hypot(dx, dy) || 1e-6;
            if (d < minD) {
              const nx = dx / d,
                ny = dy / d;
              const push = (minD - d) / 2;
              a.x = (a.x || 0) - nx * push;
              a.y = (a.y || 0) - ny * push;
              b.x = (b.x || 0) + nx * push;
              b.y = (b.y || 0) + ny * push;
            }
          }
        }
      }
      return arr;
    });
  }

  // Lasso
  function onPointerDownSvg(e) {
    if (mode !== "select") return;
    if (e.shiftKey) {
      e.preventDefault();
      e.stopPropagation();
      const svg = svgRef.current;
      const p = svgToLocalPoint(svg, e.clientX, e.clientY);
      const sel = d3.select(svg);
      sel.on(".zoom", null); // disable zoom while lassoing
      setLasso({ active: true, points: [p] });
    } else {
      if (!(e.ctrlKey || e.metaKey)) {
        setSelectedIds([]);
        setSelectedNodeId(null);
      }
    }
  }
  function finishLasso() {
    const pts = lasso.points;
    const inside = [];
    for (const n of nodes) {
      const p = { x: n.x || 0, y: n.y || 0 };
      if (pointInPolygon(p, pts)) inside.push(n.id);
    }
    setSelectedIds(inside);
    setLasso({ active: false, points: [] });
    const svg = d3.select(svgRef.current);
    const zoom = zoomBehaviorRef.current;
    if (zoom) svg.call(zoom);
  }

  // Node setters
  function renameNode(id, val) {
    pushHistory();
    setNodes((p) => p.map((n) => (n.id === id ? { ...n, name: val } : n)));
  }
  function changeArea(id, v) {
    pushHistory();
    const a = toNumber(v, 1);
    setNodes((p) =>
      p.map((n) => (n.id === id ? { ...n, area: Math.max(1, a) } : n))
    );
  }
  function setNodeFillTypeGradient(id, flag) {
    pushHistory();
    setNodes((p) =>
      p.map((n) =>
        n.id === id
          ? {
              ...n,
              fillType: flag ? "gradient" : "solid",
              grad: n.grad || { c1: bulkGradC1, c2: bulkGradC2, angle: bulkGradAngle },
            }
          : n
      )
    );
  }
  function setNodeGradC1(id, c) {
    pushHistory();
    setNodes((p) =>
      p.map((n) =>
        n.id === id ? { ...n, grad: { ...(n.grad || {}), c1: c } } : n
      )
    );
  }
  function setNodeGradC2(id, c) {
    pushHistory();
    setNodes((p) =>
      p.map((n) =>
        n.id === id ? { ...n, grad: { ...(n.grad || {}), c2: c } } : n
      )
    );
  }
  function setNodeGradAngle(id, a) {
    pushHistory();
    const ang = Math.max(0, Math.min(360, +a || 0));
    setNodes((p) =>
      p.map((n) =>
        n.id === id ? { ...n, grad: { ...(n.grad || {}), angle: ang } } : n
      )
    );
  }

  function setNodeFill(id, colorOrNone) {
    pushHistory();
    setNodes((p) =>
      p.map((n) => (n.id === id ? { ...n, fill: colorOrNone } : n))
    );
  }
  function setNodeStroke(id, color) {
    pushHistory();
    setNodes((p) =>
      p.map((n) => (n.id === id ? { ...n, stroke: color } : n))
    );
  }
  function setNodeStrokeW(id, w) {
    pushHistory();
    const width = Math.max(1, Math.min(12, toNumber(w, 2)));
    setNodes((p) =>
      p.map((n) => (n.id === id ? { ...n, strokeWidth: width } : n))
    );
  }
  function setNodeTextColor(id, c) {
    pushHistory();
    setNodes((p) =>
      p.map((n) => (n.id === id ? { ...n, textColor: c } : n))
    );
  }
  function setNodeTextSize(id, s) {
    pushHistory();
    setNodes((p) =>
      p.map((n) =>
        n.id === id
          ? {
              ...n,
              textSize: clampTextSize(s),
              textSizeManual: true,
              autoText: false,
            }
          : n
      )
    );
  }
  function setNodeTextFont(id, f) {
    pushHistory();
    setNodes((p) =>
      p.map((n) => (n.id === id ? { ...n, textFont: f } : n))
    );
  }
  function setNodeAutoText(id, flag) {
    pushHistory();
    setNodes((p) =>
      p.map((n) =>
        n.id === id
          ? { ...n, autoText: !!flag, textSizeManual: !flag }
          : n
      )
    );
  }
  function setNodeLocked(id, flag) {
    pushHistory();
    setNodes((p) =>
      p.map((n) =>
        n.id === id
          ? {
              ...n,
              locked: !!flag,
              fx: flag ? (n.x ?? 0) : undefined,
              fy: flag ? (n.y ?? 0) : undefined,
            }
          : n
      )
    );
  }
  function pinSelection(flag) {
    if (!selectedIds.length) return;
    pushHistory();
    setNodes((prev) =>
      prev.map((n) =>
        selectedSet.has(n.id)
          ? {
              ...n,
              locked: !!flag,
              fx: flag ? (n.x ?? 0) : undefined,
              fy: flag ? (n.y ?? 0) : undefined,
            }
          : n
      )
    );
  }

  // Keyboard Shortcuts
  const lastClickedLinkRef = useRef(null);
  const [showHelp, setShowHelp] = useState(false);

  useEffect(() => {
    const onKey = (e) => {
      const active = document.activeElement;
      const isTyping =
        active &&
        ((active.tagName === "INPUT" || active.tagName === "TEXTAREA") ||
          active.isContentEditable);
      const k = e.key;

      // If typing in an input/textarea/contentEditable, ignore destructive/global keys
      if (isTyping) {
        // Allow Ctrl/⌘+S to save JSON from anywhere
        if ((e.ctrlKey || e.metaKey) && k.toLowerCase() === "s") {
          e.preventDefault();
          saveJSON();
        }
        return;
      }

      // Cheatsheet
      if (k === "?" || (k === "/" && e.shiftKey)) {
        e.preventDefault();
        setShowHelp((v) => !v);
        return;
      }

      // Undo/Redo/Save
      if (e.ctrlKey || e.metaKey) {
        const kk = k.toLowerCase();
        if (kk === "z") {
          e.preventDefault();
          if (e.shiftKey) redo();
          else undo();
          return;
        }
        if (kk === "y") {
          e.preventDefault();
          redo();
          return;
        }
        if (kk === "s") {
          e.preventDefault();
          saveJSON();
          return;
        }
      }

      // Quick link type toggles → connect mode
      if (k === "1" || k.toLowerCase() === "n") {
        e.preventDefault();
        setCurrentLineType("necessary");
        setMode("connect");
        return;
      }
      if (k === "2" || k.toLowerCase() === "i") {
        e.preventDefault();
        setCurrentLineType("ideal");
        setMode("connect");
        return;
      }
      if (k === "Tab") {
        e.preventDefault();
        setCurrentLineType((t) => (t === "necessary" ? "ideal" : "necessary"));
        setMode("connect");
        return;
      }

      // Selection ops
      if (k === "a" && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        selectAll();
        return;
      }
      if (k === "Escape") {
        clearSelection();
        return;
      }

      // Delete: nodes or last-clicked link
      if (k === "Delete" || k === "Backspace") {
        if (selectedIds.length) {
          e.preventDefault();
          deleteSelection();
          return;
        }
        const id = lastClickedLinkRef.current;
        if (id) {
          e.preventDefault();
          pushHistory();
          setLinks((p) => p.filter((l) => l.id !== id));
          lastClickedLinkRef.current = null;
        }
      }

      // Arrow keys nudge selected nodes
      if (
        ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(k) &&
        selectedIds.length
      ) {
        e.preventDefault();
        const step = e.shiftKey ? 20 : 5;
        const dx = k === "ArrowLeft" ? -step : k === "ArrowRight" ? step : 0;
        const dy = k === "ArrowUp" ? -step : k === "ArrowDown" ? step : 0;
        pushHistory();
        setNodes((prev) =>
          prev.map((n) =>
            selectedSet.has(n.id)
              ? {
                  ...n,
                  x: (n.x || 0) + dx,
                  y: (n.y || 0) + dy,
                  fx: n.locked ? (n.x || 0) + dx : n.fx,
                  fy: n.locked ? (n.y || 0) + dy : n.fy,
                }
              : n
          )
        );
        if (!physics) resolveCollisionsOnce();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedIds, selectedSet, physics]);

  // Scenes (kept; not expanded here)
  function captureScenePayload() {
    const pos = {};
    for (const n of nodes) pos[n.id] = { x: n.x || 0, y: n.y || 0 };
    return {
      positions: pos,
      zoom: { k: zoomTransform.k, x: zoomTransform.x, y: zoomTransform.y },
      updatedAt: Date.now(),
    };
  }
  function addScene(name) {
    const nm = String(name || "").trim() || `Scene ${scenes.length + 1}`;
    const payload = captureScenePayload();
    const s = { id: uid(), name: nm, ...payload };
    setScenes((prev) => [...prev, s]);
    setActiveSceneId(s.id);
  }
  function applyScene(sceneId) {
    const s = scenes.find((x) => x.id === sceneId);
    if (!s) return;
    const { positions, zoom } = s;
    setNodes((prev) =>
      prev.map((n) => {
        const p = positions[n.id];
        return p ? { ...n, x: p.x, y: p.y, fx: undefined, fy: undefined } : n;
      })
    );
    try {
      const svg = d3.select(svgRef.current);
      const zoomer = zoomBehaviorRef.current;
      if (svg && zoomer && zoom) {
        svg
          .transition()
          .duration(250)
          .call(
            zoomer.transform,
            d3.zoomIdentity.translate(zoom.x, zoom.y).scale(zoom.k || 1)
          );
      }
    } catch {}
    zeroVelocities();
    simRef.current?.alpha(0.3).restart();
  }
  function updateScene(sceneId) {
    const idx = scenes.findIndex((x) => x.id === sceneId);
    if (idx === -1) return;
    const payload = captureScenePayload();
    setScenes((prev) => {
      const next = [...prev];
      next[idx] = { ...next[idx], ...payload };
      return next;
    });
  }
  function deleteScene(sceneId) {
    setScenes((prev) => prev.filter((x) => x.id !== sceneId));
    if (activeSceneId === sceneId) setActiveSceneId(null);
  }

  // Export helpers
  function getExportBg() {
    if (exportBgMode === "transparent") return null;
    if (exportBgMode === "white") return "#ffffff";
    return exportBgCustom || "#ffffff";
  }
  function exportSVG() {
    const orig = svgRef.current;
    if (!orig) return;
    const clone = orig.cloneNode(true);
    const vb = orig.getAttribute("viewBox") || "-600 -350 1200 700";
    clone.setAttribute("viewBox", vb);
    clone.querySelectorAll("[data-ignore-export]").forEach((el) => el.remove());
    clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    clone.setAttribute("xmlns:xlink", "http://www.w3.org/1999/xlink");
    clone.setAttribute("width", "1200");
    clone.setAttribute("height", "700");
    const bg = getExportBg();
    if (bg) {
      const vbObj = clone.viewBox?.baseVal || {
        x: -600,
        y: -350,
        width: 1200,
        height: 700,
      };
      const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
      rect.setAttribute("x", vbObj.x);
      rect.setAttribute("y", vbObj.y);
      rect.setAttribute("width", vbObj.width);
      rect.setAttribute("height", vbObj.height);
      rect.setAttribute("fill", bg);
      clone.insertBefore(rect, clone.firstChild);
    }
    const svgStr = new XMLSerializer().serializeToString(clone);
    const blob = new Blob([svgStr], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    download(url, `bubble-diagram-${Date.now()}.svg`);
  }
  function exportPNG() {
    const orig = svgRef.current;
    if (!orig) return;
    const clone = orig.cloneNode(true);
    clone.querySelectorAll("[data-ignore-export]").forEach((el) => el.remove());
    const svgStr = new XMLSerializer().serializeToString(clone);
    const img = new Image();
    const svg64 = btoa(unescape(encodeURIComponent(svgStr)));
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = 2200;
      canvas.height = 1400;
      const ctx = canvas.getContext("2d");
      const bg = getExportBg();
      if (bg) {
        ctx.fillStyle = bg;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
      } else {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
      }
      const scale = Math.min(canvas.width / 1200, canvas.height / 700);
      const dx = (canvas.width - 1200 * scale) / 2;
      const dy = (canvas.height - 700 * scale) / 2;
      ctx.setTransform(scale, 0, 0, scale, dx, dy);
      ctx.drawImage(img, 0, 0);
      canvas.toBlob((blob) => {
        if (!blob) return;
        const url = URL.createObjectURL(blob);
        download(url, `bubble-diagram-${Date.now()}.png`);
      });
    };
    img.onerror = () =>
      alert("PNG export failed. Try SVG export if issue persists.");
    img.src = `data:image/svg+xml;base64,${svg64}`;
  }

  function buildExportPayload() {
    return {
      nodes,
      links,
      styles,
      bulk: {
        bulkFill,
        bulkFillTransparent,
        bulkStroke,
        bulkStrokeWidth,
        bulkTextFont,
        bulkTextColor,
        bulkTextSize: clampTextSize(bulkTextSize),
        bulkGradientEnabled,
        bulkGradC1,
        bulkGradC2,
        bulkGradAngle,
      },
      buffer,
      arrowOverlap,
      rotationSensitivity,
      autoLabelSize,
      dynamicTextScale,
      areaLabelSize,
      showMeasurements,
      exportBgMode,
      exportBgCustom,
      liveBgMode,
      liveBgCustom,
      highContrast,
    };
  }

  async function saveJSON() {
    if (window.showSaveFilePicker && jsonHandleRef.current) {
      try {
        const handle = jsonHandleRef.current;
        const writable = await handle.createWritable();
        await writable.write(JSON.stringify(buildExportPayload(), null, 2));
        await writable.close();
        return;
      } catch (err) {
        console.warn("Save JSON failed, falling back to Save As…", err);
      }
    }
    return saveJSONAs();
  }
  async function saveJSONAs() {
    if (window.showSaveFilePicker) {
      try {
        const handle = await window.showSaveFilePicker({
          suggestedName: "bubble-diagram.json",
          types: [
            {
              description: "JSON files",
              accept: { "application/json": [".json"] },
            },
          ],
        });
        jsonHandleRef.current = handle;
        const writable = await handle.createWritable();
        await writable.write(JSON.stringify(buildExportPayload(), null, 2));
        await writable.close();
        return;
      } catch (err) {
        console.warn("Save As cancelled or failed; using download() fallback.", err);
      }
    }
    let name =
      typeof window !== "undefined"
        ? window.prompt("File name", "bubble-diagram.json") ||
          "bubble-diagram.json"
        : "bubble-diagram.json";
    const blob = new Blob([JSON.stringify(buildExportPayload(), null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    download(url, name);
  }
  async function openJSON() {
    if (window.showOpenFilePicker) {
      try {
        const [handle] = await window.showOpenFilePicker({
          multiple: false,
          types: [
            {
              description: "JSON files",
              accept: { "application/json": [".json"] },
            },
          ],
        });
        if (!handle) return;
        const file = await handle.getFile();
        const text = await file.text();
        jsonHandleRef.current = handle;
        parseAndLoadJSON(text);
        return;
      } catch (err) {
        console.warn("Open JSON cancelled or failed.", err);
      }
    }
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "application/json";
    input.onchange = (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      jsonHandleRef.current = null;
      const r = new FileReader();
      r.onload = () => parseAndLoadJSON(String(r.result || ""));
      r.readAsText(file);
    };
    input.click();
  }

  function parseAndLoadJSON(str) {
    try {
      const d = JSON.parse(str);
      if (Array.isArray(d.nodes)) {
        const normalized = d.nodes.map((n) => ({
          ...n,
          id: n.id || uid(),
          name: String(n.name ?? "Unnamed"),
          area: Math.max(1, toNumber(n.area, 20)),
          textSize: clampTextSize(n.textSize ?? bulkTextSize),
          textSizeManual: !!n.textSizeManual,
          autoText: n.autoText !== undefined ? !!n.autoText : true,
          strokeWidth: Math.max(
            1,
            Math.min(12, toNumber(n.strokeWidth, bulkStrokeWidth))
          ),
          fillType: n.fillType || "solid",
          grad: n.grad || { c1: bulkGradC1, c2: bulkGradC2, angle: bulkGradAngle },
        }));
        setNodes(normalized);
      }
      if (Array.isArray(d.links))
        setLinks(d.links.filter((l) => l.source && l.target));
      if (d.styles) setStyles((s) => ({ ...s, ...d.styles }));
      if (d.bulk) {
        const b = d.bulk;
        if (typeof b.bulkFill === "string") setBulkFill(b.bulkFill);
        if (typeof b.bulkFillTransparent === "boolean")
          setBulkFillTransparent(b.bulkFillTransparent);
        if (typeof b.bulkStroke === "string") setBulkStroke(b.bulkStroke);
        if (typeof b.bulkStrokeWidth === "number")
          setBulkStrokeWidth(Math.max(1, Math.min(12, b.bulkStrokeWidth)));
        if (typeof b.bulkTextFont === "string") setBulkTextFont(b.bulkTextFont);
        if (typeof b.bulkTextColor === "string") setBulkTextColor(b.bulkTextColor);
        if (b.bulkTextSize != null) setBulkTextSize(clampTextSize(b.bulkTextSize));
        if (typeof b.bulkGradientEnabled === "boolean")
          setBulkGradientEnabled(b.bulkGradientEnabled);
        if (typeof b.bulkGradC1 === "string") setBulkGradC1(b.bulkGradC1);
        if (typeof b.bulkGradC2 === "string") setBulkGradC2(b.bulkGradC2);
        if (typeof b.bulkGradAngle === "number") setBulkGradAngle(b.bulkGradAngle);
      }
      if (typeof d.buffer === "number") setBuffer(d.buffer);
      if (typeof d.arrowOverlap === "number") setArrowOverlap(d.arrowOverlap);
      if (typeof d.rotationSensitivity === "number")
        setRotationSensitivity(Math.max(0, Math.min(50, d.rotationSensitivity)));
      if (typeof d.autoLabelSize === "boolean")
        setAutoLabelSize(d.autoLabelSize);
      if (typeof d.dynamicTextScale === "number")
        setDynamicTextScale(
          Math.max(0.6, Math.min(1.8, d.dynamicTextScale || 1))
        );
      if (typeof d.areaLabelSize === "number")
        setAreaLabelSize(clampTextSize(d.areaLabelSize));
      if (typeof d.showMeasurements === "boolean")
        setShowMeasurements(d.showMeasurements);
      if (d.exportBgMode) setExportBgMode(d.exportBgMode);
      if (d.exportBgCustom) setExportBgCustom(d.exportBgCustom);
      if (d.liveBgMode) setLiveBgMode(d.liveBgMode);
      if (d.liveBgCustom) setLiveBgCustom(d.liveBgCustom);
      if (typeof d.highContrast === "boolean") setHighContrast(d.highContrast);
    } catch {
      alert("Invalid JSON file");
    }
  }

  function importJSON(file) {
    const r = new FileReader();
    r.onload = () => parseAndLoadJSON(String(r.result || ""));
    r.readAsText(file);
  }

  function zeroVelocities() {
    try {
      const sim = simRef.current;
      if (!sim) return;
      const arr = sim.nodes ? sim.nodes() : [];
      if (Array.isArray(arr)) {
        for (const n of arr) {
          n.vx = 0;
          n.vy = 0;
        }
      }
    } catch {}
  }

  // Detangle pulse
  function detanglePulse() {
    if (explodeTORef.current) clearTimeout(explodeTORef.current);
    setExplodeFactor(2.2);
    simRef.current?.alpha(1).restart();
    explodeTORef.current = setTimeout(() => {
      setExplodeFactor(1);
      simRef.current?.alpha(0.6).restart();
    }, 1200);
  }
  useEffect(() => {
    return () => {
      if (explodeTORef.current) clearTimeout(explodeTORef.current);
    };
  }, []);

  // Global autoLabelSize behaviour:
  // When turned ON: all nodes use autoText = true (dynamic).
  // When turned OFF: all nodes switch autoText=false and textSize = bulkTextSize (uniform).
  useEffect(() => {
    setNodes((prev) =>
      prev.map((n) =>
        autoLabelSize
          ? { ...n, autoText: true }
          : {
              ...n,
              autoText: false,
              textSize: clampTextSize(bulkTextSize),
              textSizeManual: true,
            }
      )
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoLabelSize, bulkTextSize]);

  // Zoom / Pan / Fit
  useEffect(() => {
    const svg = d3.select(svgRef.current);
    const zoom = d3
      .zoom()
      .scaleExtent([0.2, 5])
      .on("zoom", (event) => {
        setZoomTransform(event.transform);
      });
    zoomBehaviorRef.current = zoom;
    svg.call(zoom);
    svg.on("dblclick.zoom", null);
    svg.on("dblclick", () => resetZoom());
    return () => svg.on(".zoom", null);
  }, []);
  function resetZoom() {
    const svg = d3.select(svgRef.current);
    const zoom = zoomBehaviorRef.current;
    if (!zoom) return;
    svg.transition().duration(250).call(zoom.transform, d3.zoomIdentity);
  }
  function zoomIn() {
    const svg = d3.select(svgRef.current);
    const zoom = zoomBehaviorRef.current;
    if (!zoom) return;
    svg.transition().duration(200).call(zoom.scaleBy, 1.2);
  }
  function zoomOut() {
    const svg = d3.select(svgRef.current);
    const zoom = zoomBehaviorRef.current;
    if (!zoom) return;
    svg.transition().duration(200).call(zoom.scaleBy, 1 / 1.2);
  }
  function fitToView() {
    if (!nodes.length) return resetZoom();
    const r = (n) => rOf(n.area);
    const minX = d3.min(nodes, (n) => (n.x || 0) - r(n)) ?? -600;
    const maxX = d3.max(nodes, (n) => (n.x || 0) + r(n)) ?? 600;
    const minY = d3.min(nodes, (n) => (n.y || 0) - r(n)) ?? -350;
    const maxY = d3.max(nodes, (n) => (n.y || 0) + r(n)) ?? 350;
    const bbox = { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
    const view = { x: -600, y: -350, width: 1200, height: 700 };
    const pad = 40;
    const sx = (view.width - pad * 2) / (bbox.width || 1);
    const sy = (view.height - pad * 2) / (bbox.height || 1);
    const k = Math.min(5, Math.max(0.2, Math.min(sx, sy)));
    const tx = view.x + (view.width - bbox.width * k) / 2 - bbox.x * k;
    const ty = view.y + (view.height - bbox.height * k) / 2 - bbox.y * k;
    const svg = d3.select(svgRef.current);
    const zoom = zoomBehaviorRef.current;
    if (!zoom) return;
    svg
      .transition()
      .duration(250)
      .call(zoom.transform, d3.zoomIdentity.translate(tx, ty).scale(k));
  }

  // Fullscreen
  const [isFullscreen, setIsFullscreen] = useState(false);
  useEffect(() => {
    const onFs = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", onFs);
    return () => document.removeEventListener("fullscreenchange", onFs);
  }, []);
  function toggleFullscreen() {
    const el = containerRef.current;
    if (!el) return;
    if (!document.fullscreenElement) {
      el.requestFullscreen?.();
    } else {
      document.exitFullscreen?.();
    }
  }

  // Link helpers
  function removePairLinks(arr, a, b) {
    const k = pairKey(a, b);
    return arr.filter((l) => pairKey(l.source, l.target) !== k);
  }
  function getLinkTypeBetween(a, b) {
    const k = pairKey(a, b);
    const L = links.find((l) => pairKey(l.source, l.target) === k);
    return L ? L.type : "none";
  }
  function setLinkTypeBetween(a, b, type) {
    if (a === b) return;
    pushHistory();
    setLinks((prev) => {
      const base = removePairLinks(prev, a, b);
      if (type === "none") return base;
      return [...base, { id: uid(), source: a, target: b, type }];
    });
  }

  // Conflicts
  const longLinkIds = useMemo(() => {
    const ids = new Set();
    const map = new Map(nodes.map((n) => [n.id, n]));
    for (const l of links) {
      if (l.type !== "necessary") continue;
      const s = map.get(l.source);
      const t = map.get(l.target);
      if (!s || !t) continue;
      const dx = (t.x || 0) - (s.x || 0);
      const dy = (t.y || 0) - (s.y || 0);
      const dist = Math.hypot(dx, dy) || 1;
      const rs = rOf(s.area);
      const rt = rOf(t.area);
      const base = (rs + rt) * 1.05 * 1.1 + 40 + buffer * 1.5;
      if (dist > base * longFactor) ids.add(l.id);
    }
    return ids;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodes, links, buffer, longFactor, rOf]);

  const missingNecessary = useMemo(() => {
    const out = [];
    const nByName = new Map(nodes.map((n) => [norm(n.name), n]));
    const have = new Set(
      links
        .filter((l) => l.type === "necessary")
        .map((l) => pairKey(l.source, l.target))
    );
    const lines = expectedPairsText
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean);
    for (const line of lines) {
      const m = line.match(/^(.*?)\s*[-,]\s*(.*?)$/);
      if (!m) continue;
      const a = nByName.get(norm(m[1]));
      const b = nByName.get(norm(m[2]));
      if (!a || !b) continue;
      const k = pairKey(a.id, b.id);
      if (!have.has(k)) out.push({ a, b });
    }
    return out;
  }, [nodes, links, expectedPairsText]);

  const missingNodeIdSet = useMemo(() => {
    const s = new Set();
    for (const m of missingNecessary) {
      s.add(m.a.id);
      s.add(m.b.id);
    }
    return s;
  }, [missingNecessary]);

  // Dynamic label size calculator (scaled globally)
  function dynamicLabelSizeForNode(n) {
    const r = rOf(n.area);
    const raw = (r / 3.2) * dynamicTextScale;
    const base = Math.round(raw);
    return clampTextSize(base);
  }

  // Render bits
  const dashFor = (type) =>
    styles[type].dashed
      ? `${styles[type].width * 2} ${styles[type].width * 2}`
      : undefined;
  const markerUrl = (type, kind) => {
    const st = styles[type];
    const shape = kind === "start" ? st.headStart : st.headEnd;
    if (shape === "none") return undefined;
    return `url(#${markerId(kind, `${shape}-${type}`, st.color)})`;
  };
  const selectedNode = nodes.find((n) => n.id === selectedNodeId) || null;

  const liveBg =
    liveBgMode === "transparent"
      ? "transparent"
      : liveBgMode === "white"
      ? "#ffffff"
      : liveBgCustom || THEME.surface;

  // When BUFFER changes while physics is OFF, resolve overlaps once
  useEffect(() => {
    if (!physics && nodes.length) resolveCollisionsOnce();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [buffer]);

  return (
    <div
      className={`w-full min-h-screen ${highContrast ? "hc" : ""}`}
      style={{ background: THEME.bg, color: THEME.text }}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
    >
      <style data-ignore-export>{`
        :root { color-scheme: dark; }
        * { scrollbar-width: thin; scrollbar-color: #3a3a4a #121220; }
        *::-webkit-scrollbar { height: 10px; width: 10px; }
        *::-webkit-scrollbar-thumb { background: #3a3a4a; border-radius: 8px; }
        *::-webkit-scrollbar-track { background: #121220; }

        input[type="color"]{
          -webkit-appearance:none; appearance:none;
          border:1px solid ${THEME.border}; width:32px; height:28px; border-radius:9999px;
          padding:0; background:transparent; cursor:pointer;
        }
        input[type="color"]::-webkit-color-swatch-wrapper{ padding:0; border-radius:9999px; }
        input[type="color"]::-webkit-color-swatch{ border:none; border-radius:9999px; }
        input[type="color"]::-moz-color-swatch{ border:none; border-radius:9999px; }

        .ui-select{
          background:#0f0f18; color:#e6e6f0; border:1px solid ${THEME.border};
          border-radius:10px; padding:6px 8px; font-size:13px; line-height:1.2;
          box-shadow:0 6px 18px rgba(0,0,0,.35);
        }
        .ui-select:focus{ outline:3px solid ${highContrast ? "#00D1FF" : "#8b5cf6"}; outline-offset:2px; }
        .ui-select option{ background:#0f0f18; color:#e6e6f0; }

        .card{ background:#121220; border:1px solid ${THEME.border}; border-radius:16px; padding:14px; }
        .group-title{ font-size:12px; letter-spacing:.06em; color:${THEME.subtle}; font-weight:600; }
        .btn{ border:1px solid ${THEME.border}; border-radius:12px; padding:8px 12px; font-size:13px; background:transparent; color:${THEME.text}; }
        .btn:hover{ background:rgba(255,255,255,.06); }
        .btn:focus{ outline:3px solid ${highContrast ? "#00D1FF" : "#8b5cf6"}; outline-offset:2px; }
        .btn-xs{ padding:6px 10px; font-size:12px; border-radius:10px; }
        .dock-btn{ width:38px; height:38px; display:flex; align-items:center; justify-content:center; border-radius:10px; }

        .hc .card{ border-color:#8b5cf6; }
        .hc .btn:hover{ background:rgba(255,255,255,.12); }
      `}</style>

      {/* Command bar */}
      <div className="sticky top-0 z-20 backdrop-blur bg-black/35 border-b border-[#2a2a3a]">
        <div className="mx-auto max-w-[1500px] px-4 py-3 flex items-center gap-3">
          <div className="text-sm font-semibold tracking-wide text-[#d6d6e2] flex items-center gap-2">
            Bubble Diagram Builder <span className="text-[11px] opacity-70">v1.0</span>
          </div>
          <div className="text-xs text-[#9aa0a6]">Design mode:</div>
          <div className="flex items-center gap-1" role="group" aria-label="Mode">
            <button
              className={`btn btn-xs ${mode === "select" ? "bg-white/10" : ""}`}
              onClick={() => setMode("select")}
              aria-pressed={mode === "select"}
            >
              Select/Drag
            </button>
            <button
              className={`btn btn-xs ${mode === "connect" ? "bg-white/10" : ""}`}
              onClick={() => setMode("connect")}
              aria-pressed={mode === "connect"}
            >
              Connect
            </button>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <button className="btn btn-xs" onClick={undo} aria-label="Undo">Undo</button>
            <button className="btn btn-xs" onClick={redo} aria-label="Redo">Redo</button>
            <button className="btn btn-xs" onClick={clearAll} aria-label="Clear all">Clear</button>
            <button
              className={`btn btn-xs ${highContrast ? "bg-white/10" : ""}`}
              onClick={() => setHighContrast((v) => !v)}
              aria-pressed={highContrast}
              title="High-contrast mode"
            >
              HC
            </button>
            <button className="btn btn-xs" onClick={() => setShowHelp(true)} title="Cheatsheet (?)">?</button>
          </div>
        </div>
      </div>

      {/* Layout */}
      <div className="mx-auto max-w-[1500px] px-4 py-4 grid grid-cols-1 xl:grid-cols-12 gap-4">
        {/* Controls */}
        <div className="xl:col-span-5 space-y-4">
          <details open className="card">
            <summary className="cursor-pointer select-none group-title">Spaces (name, area m²)</summary>
            <div className="mt-3 space-y-2">
              <div className="flex flex-wrap gap-2">
                <button className="btn btn-xs" onClick={() => setRawList(SAMPLE_TEXT)}>Load sample</button>
                <button className="btn btn-xs" onClick={onGenerate}>Generate</button>
                <button className="btn btn-xs" onClick={updateFromList}>Update from list</button>
                <label className="text-xs text-[#9aa0a6] flex items-center gap-1">
                  <input type="checkbox"
                    checked={updateMatchMode === "name"}
                    onChange={(e) =>
                      setUpdateMatchMode(e.target.checked ? "name" : "index")
                    } /> match by name
                </label>
                <label className="text-xs text-[#9aa0a6] flex items-center gap-1">
                  <input type="checkbox"
                    checked={updateAreasFromList}
                    onChange={(e) => setUpdateAreasFromList(e.target.checked)} /> also update areas
                </label>
              </div>
              <textarea
                className="w-full min-h-[160px] text-sm bg-transparent border rounded-xl border-[#2a2a3a] p-3 outline-none"
                placeholder={`Example (one per line):\nMatch Admin Room, 90\nVOD Review / Theater, 60`}
                value={rawList}
                onChange={(e) => setRawList(e.target.value)}
              />
              <p className="text-xs text-[#9aa0a6]">Formats: <code>name, area</code> • <code>name - area</code> • <code>name area</code></p>
            </div>
          </details>

          <details open className="card">
            <summary className="cursor-pointer select-none group-title">Styles</summary>
            <div className="mt-3 space-y-3">
              {/* Line styles */}
              {["necessary", "ideal"].map((key) => (
                <div key={key} className="border border-[#2a2a3a] rounded-xl p-2">
                  <div className="text-xs opacity-80 mb-2 flex items-center gap-2">
                    <span className="capitalize">{key}</span>
                    <button
                      className={`btn btn-xs ${currentLineType === key ? "bg-white/10" : ""}`}
                      onClick={() => { setCurrentLineType(key); setMode("connect"); }}
                      title="Set this line style and switch to Connect mode"
                    >
                      Use → Connect
                    </button>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <label className="flex items-center gap-1">Color
                      <input
                        type="color"
                        value={styles[key].color}
                        onChange={(e) =>
                          setStyles((s) => ({
                            ...s,
                            [key]: { ...s[key], color: e.target.value },
                          }))
                        }
                      />
                    </label>
                    <label className="flex items-center gap-1">
                      <input
                        type="checkbox"
                        checked={styles[key].dashed}
                        onChange={(e) =>
                          setStyles((s) => ({
                            ...s,
                            [key]: { ...s[key], dashed: e.target.checked },
                          }))
                        }
                      /> dashed
                    </label>
                    <label className="flex items-center gap-1">w
                      <input
                        type="number"
                        min={1}
                        max={12}
                        value={styles[key].width}
                        className="w-14 bg-transparent border border-[#2a2a3a] rounded px-1 py-0.5"
                        onChange={(e) =>
                          setStyles((s) => ({
                            ...s,
                            [key]: {
                              ...s[key],
                              width: Math.max(1, Math.min(12, +e.target.value || 1)),
                            },
                          }))
                        }
                      />
                    </label>
                    <select
                      className="ui-select"
                      value={styles[key].headStart}
                      onChange={(e) =>
                        setStyles((s) => ({
                          ...s,
                          [key]: { ...s[key], headStart: e.target.value },
                        }))
                      }
                    >
                      {HEAD_SHAPES.map((h) => (
                        <option key={h} value={h}>{h}</option>
                      ))}
                    </select>
                    <span className="opacity-60">→</span>
                    <select
                      className="ui-select"
                      value={styles[key].headEnd}
                      onChange={(e) =>
                        setStyles((s) => ({
                          ...s,
                          [key]: { ...s[key], headEnd: e.target.value },
                        }))
                      }
                    >
                      {HEAD_SHAPES.map((h) => (
                        <option key={h} value={h}>{h}</option>
                      ))}
                    </select>
                  </div>
                </div>
              ))}

              {/* Bubbles & Labels */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="border border-[#2a2a3a] rounded-xl p-2">
                  <div className="text-xs opacity-80 mb-2">Bubbles (bulk)</div>
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <label className="flex items-center gap-1">Fill
                      <input
                        type="color"
                        value={bulkFill}
                        onChange={(e) => setBulkFill(e.target.value)}
                        disabled={bulkFillTransparent}
                      />
                    </label>
                    <label className="flex items-center gap-1">
                      <input
                        type="checkbox"
                        checked={bulkFillTransparent}
                        onChange={(e) => setBulkFillTransparent(e.target.checked)}
                      /> transparent
                    </label>
                    <label className="flex items-center gap-1">Border
                      <input
                        type="color"
                        value={bulkStroke}
                        onChange={(e) => setBulkStroke(e.target.value)}
                      />
                    </label>
                    <label className="flex items-center gap-1">w
                      <input
                        type="number"
                        min={1}
                        max={12}
                        value={bulkStrokeWidth}
                        className="w-14 bg-transparent border border-[#2a2a3a] rounded px-1 py-0.5"
                        onChange={(e) =>
                          setBulkStrokeWidth(Math.max(1, Math.min(12, +e.target.value || 1)))
                        }
                      />
                    </label>
                    <button className="btn btn-xs" onClick={applyBulkBubbleStylesToAll}>
                      Apply to all
                    </button>
                    <button className="btn btn-xs" onClick={applyBulkBubbleStylesToSelection} disabled={!selectedIds.length}>
                      Apply to selection
                    </button>
                  </div>

                  {/* Gradient controls */}
                  <div className="mt-2 border-t border-[#2a2a3a] pt-2 text-xs flex flex-wrap items-center gap-2">
                    <label className="flex items-center gap-1">
                      <input
                        type="checkbox"
                        checked={bulkGradientEnabled}
                        onChange={(e) => setBulkGradientEnabled(e.target.checked)}
                      /> gradient fill
                    </label>
                    <span className="opacity-70">c1</span>
                    <input type="color" value={bulkGradC1} onChange={(e) => setBulkGradC1(e.target.value)} />
                    <span className="opacity-70">c2</span>
                    <input type="color" value={bulkGradC2} onChange={(e) => setBulkGradC2(e.target.value)} />
                    <span className="opacity-70">angle</span>
                    <input
                      type="number"
                      className="w-16 bg-transparent border border-[#2a2a3a] rounded px-1 py-0.5"
                      value={bulkGradAngle}
                      onChange={(e) => setBulkGradAngle(Math.max(0, Math.min(360, +e.target.value || 0)))}
                    />
                    <span className="opacity-70">°</span>
                  </div>
                </div>

                <div className="border border-[#2a2a3a] rounded-xl p-2">
                  <div className="text-xs opacity-80 mb-2">Labels (bulk)</div>
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <select
                      className="ui-select"
                      value={bulkTextFont}
                      onChange={(e) => setBulkTextFont(e.target.value)}
                    >
                      <option value={FONT_STACKS.Outfit}>Outfit</option>
                      <option value={FONT_STACKS.Inter}>Inter</option>
                      <option value={FONT_STACKS.Poppins}>Poppins</option>
                      <option value={FONT_STACKS.Roboto}>Roboto</option>
                      <option value={FONT_STACKS.System}>system-ui</option>
                      <option value={FONT_STACKS.HelveticaNowCondensed}>Helvetica Now Condensed</option>
                    </select>
                    <input
                      type="color"
                      value={bulkTextColor}
                      onChange={(e) => setBulkTextColor(e.target.value)}
                    />
                    <label className="flex items-center gap-1">size
                      <input
                        type="number"
                        min={TEXT_MIN}
                        max={TEXT_MAX}
                        value={bulkTextSize}
                        className="w-16 bg-transparent border border-[#2a2a3a] rounded px-1 py-0.5"
                        onChange={(e) => setBulkTextSize(clampTextSize(e.target.value))}
                      />
                    </label>
                    <label className="flex items-center gap-1 ml-2">
                      <input
                        type="checkbox"
                        checked={autoLabelSize}
                        onChange={(e) => setAutoLabelSize(e.target.checked)}
                      /> Auto label size (global)
                    </label>
                    <button className="btn btn-xs" onClick={applyBulkTextStylesToAll}>
                      Apply to all (fixed)
                    </button>
                    <button className="btn btn-xs" onClick={applyBulkTextStylesToSelection} disabled={!selectedIds.length}>
                      Apply to selection (fixed)
                    </button>
                  </div>
                  <div className="w-full flex items-center gap-2 mt-2 text-xs">
                    <span className={`opacity-70 ${!autoLabelSize ? "line-through" : ""}`}>Dynamic label scale</span>
                    <input
                      type="range"
                      min={0.6}
                      max={1.8}
                      step={0.05}
                      value={dynamicTextScale}
                      onChange={(e) =>
                        setDynamicTextScale(
                          Math.max(0.6, Math.min(1.8, +e.target.value || 1))
                        )
                      }
                      disabled={!autoLabelSize}
                    />
                    <span>{Math.round(dynamicTextScale * 100)}%</span>
                  </div>
                  <div className="w-full flex items-center gap-2 mt-2 text-xs">
                    <span className="opacity-70">Area label size</span>
                    <input
                      type="range"
                      min={8}
                      max={18}
                      step={1}
                      value={areaLabelSize}
                      onChange={(e) =>
                        setAreaLabelSize(
                          Math.max(8, Math.min(18, +e.target.value || 11))
                        )
                      }
                    />
                    <input
                      type="number"
                      min={8}
                      max={18}
                      value={areaLabelSize}
                      className="w-16 bg-transparent border border-[#2a2a3a] rounded px-1 py-0.5"
                      onChange={(e) =>
                        setAreaLabelSize(
                          Math.max(8, Math.min(18, +e.target.value || 11))
                        )
                      }
                    />
                    <span className="opacity-70">px</span>
                  </div>
                </div>
              </div>

              {/* Backgrounds */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="border border-[#2a2a3a] rounded-xl p-2">
                  <div className="text-xs opacity-80 mb-2">Export background</div>
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <label className="flex items-center gap-1">
                      <input
                        type="radio"
                        name="bg-exp"
                        checked={exportBgMode === "transparent"}
                        onChange={() => setExportBgMode("transparent")}
                      /> transparent
                    </label>
                    <label className="flex items-center gap-1">
                      <input
                        type="radio"
                        name="bg-exp"
                        checked={exportBgMode === "white"}
                        onChange={() => setExportBgMode("white")}
                      /> white
                    </label>
                    <label className="flex items-center gap-1">
                      <input
                        type="radio"
                        name="bg-exp"
                        checked={exportBgMode === "custom"}
                        onChange={() => setExportBgMode("custom")}
                      /> custom
                    </label>
                    <input
                      type="color"
                      value={exportBgCustom}
                      onChange={(e) => setExportBgCustom(e.target.value)}
                      disabled={exportBgMode !== "custom"}
                    />
                  </div>
                </div>
                <div className="border border-[#2a2a3a] rounded-xl p-2">
                  <div className="text-xs opacity-80 mb-2">Live background</div>
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <label className="flex items-center gap-1">
                      <input
                        type="radio"
                        name="bg-live"
                        checked={liveBgMode === "transparent"}
                        onChange={() => setLiveBgMode("transparent")}
                      /> transparent
                    </label>
                    <label className="flex items-center gap-1">
                      <input
                        type="radio"
                        name="bg-live"
                        checked={liveBgMode === "white"}
                        onChange={() => setLiveBgMode("white")}
                      /> white
                    </label>
                    <label className="flex items-center gap-1">
                      <input
                        type="radio"
                        name="bg-live"
                        checked={liveBgMode === "custom"}
                        onChange={() => setLiveBgMode("custom")}
                      /> custom
                    </label>
                    <input
                      type="color"
                      value={liveBgCustom}
                      onChange={(e) => setLiveBgCustom(e.target.value)}
                      disabled={liveBgMode !== "custom"}
                    />
                  </div>
                </div>
              </div>
            </div>
          </details>

          {/* Layout & Physics */}
          <details className="card" open>
            <summary className="cursor-pointer select-none group-title">Layout & Physics</summary>
            <div className="mt-3 grid grid-cols-1 gap-3">
              <div className="flex items-center gap-2 text-xs">
                <span className="opacity-70">Buffer</span>
                <input type="range" min={0} max={80} step={1} value={buffer} onChange={(e) => setBuffer(+e.target.value)} />
                <input type="number" min={0} max={80} value={buffer} className="w-16 bg-transparent border border-[#2a2a3a] rounded px-1 py-0.5"
                  onChange={(e) => setBuffer(Math.max(0, Math.min(80, +e.target.value || 0)))} />
                <span className="opacity-70">px</span>
              </div>
              <div className="flex items-center gap-2 text-xs">
                <span className="opacity-70">Arrow overlap</span>
                <input type="range" min={0} max={60} step={1} value={arrowOverlap} onChange={(e) => setArrowOverlap(+e.target.value)} />
                <input type="number" min={0} max={200} value={arrowOverlap} className="w-16 bg-transparent border border-[#2a2a3a] rounded px-1 py-0.5"
                  onChange={(e) => setArrowOverlap(Math.max(0, Math.min(200, +e.target.value || 0)))} />
                <span className="opacity-70">px</span>
              </div>
              <div className="flex items-center gap-2 text-xs">
                <span className="opacity-70">Rotation sensitivity</span>
                <input
                  type="range"
                  min={0}
                  max={50}
                  step={1}
                  value={rotationSensitivity}
                  onChange={(e) =>
                    setRotationSensitivity(
                      Math.max(0, Math.min(50, +e.target.value || 0))
                    )
                  }
                />
                <input
                  type="number"
                  min={0}
                  max={50}
                  value={rotationSensitivity}
                  className="w-16 bg-transparent border border-[#2a2a3a] rounded px-1 py-0.5"
                  onChange={(e) =>
                    setRotationSensitivity(
                      Math.max(0, Math.min(50, +e.target.value || 0))
                    )
                  }
                />
                <span className="opacity-70">%</span>
              </div>
              <div className="flex items-center justify-between">
                <label className="text-xs flex items-center gap-2">
                  <input type="checkbox" checked={showMeasurements} onChange={(e) => setShowMeasurements(e.target.checked)} />
                  show m² labels
                </label>
                <div className="flex items-center gap-2">
                  <button className="btn btn-xs" onClick={() => setPhysics((p) => !p)}>{physics ? "Physics: ON" : "Physics: OFF"}</button>
                  <button className="btn btn-xs" onClick={() => setNodes([...nodes])}>Re-layout</button>
                  <button className="btn btn-xs" onClick={detanglePulse}>De-tangle</button>
                </div>
              </div>
              {selectedIds.length > 0 && (
                <div className="flex items-center justify-between text-xs">
                  <div className="opacity-80">{selectedIds.length} selected</div>
                  <div className="flex gap-2">
                    <button className="btn btn-xs" onClick={() => pinSelection(true)}>Pin selection</button>
                    <button className="btn btn-xs" onClick={() => pinSelection(false)}>Unpin</button>
                    <button className="btn btn-xs" onClick={deleteSelection}>Delete selection</button>
                  </div>
                </div>
              )}
            </div>
          </details>

          {/* Matrix */}
          <details className="card">
            <summary className="cursor-pointer select-none group-title">Adjacency Matrix (editable)</summary>
            <div className="mt-3 text-xs">
              <div className="overflow-auto max-h-[320px] border border-[#2a2a3a] rounded-lg">
                <table className="min-w-full text-[11px]">
                  <thead className="sticky top-0 bg-[#151526]">
                    <tr>
                      <th className="p-2 text-left">Space \\ Space</th>
                      {nodes.map((c) => (
                        <th key={c.id} className="p-2 text-left whitespace-nowrap">{c.name}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {nodes.map((r) => (
                      <tr key={r.id} className="odd:bg-[#0f0f18] even:bg-[#121220]">
                        <td className="p-2 font-medium whitespace-nowrap">{r.name}</td>
                        {nodes.map((c) => {
                          if (r.id === c.id) return <td key={c.id} className="p-2 text-center opacity-40">—</td>;
                          const t = getLinkTypeBetween(r.id, c.id);
                          return (
                            <td key={c.id} className="p-1">
                              <select
                                className="ui-select w-full"
                                value={t}
                                onChange={(e) => setLinkTypeBetween(r.id, c.id, e.target.value)}
                              >
                                <option value="none">none</option>
                                <option value="ideal">ideal</option>
                                <option value="necessary">necessary</option>
                              </select>
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="mt-2 opacity-70">Editing any cell creates/removes a <i>single</i> undirected link for that pair.</p>
            </div>
          </details>

          {/* Conflicts */}
          <details className="card" open>
            <summary className="cursor-pointer select-none group-title">Conflict Detector</summary>
            <div className="mt-3 grid gap-3 text-sm">
              <div className="text-xs text-[#9aa0a6]">
                <b>Missing "necessary" adjacencies</b>: paste expected pairs (one per line) like <code>A - B</code> or <code>A, B</code>.
              </div>
              <textarea
                className="w-full min-h-[90px] text-sm bg-transparent border rounded-xl border-[#2a2a3a] p-3 outline-none"
                value={expectedPairsText}
                onChange={(e) => setExpectedPairsText(e.target.value)}
                placeholder={`Example:\nEvent Control Room - Broadcast & Media Core\nTech & Asset Management - Engineering & IT`}
              />
              <div className="text-xs">
                {missingNecessary.length === 0 ? (
                  <div className="text-green-400">No missing necessary pairs (based on your list).</div>
                ) : (
                  <div>
                    <div className="text-red-400">{missingNecessary.length} missing:</div>
                    <ul className="list-disc pl-5">
                      {missingNecessary.slice(0, 12).map((m, i) => (
                        <li key={i}>{m.a.name} — {m.b.name}</li>
                      ))}
                    </ul>
                    {missingNecessary.length > 12 && <div className="opacity-60">…and more</div>}
                  </div>
                )}
              </div>
              <div className="text-xs flex items-center gap-2">
                <span className="opacity-70">Long link tolerance</span>
                <input type="range" min={1.0} max={3.0} step={0.1} value={longFactor}
                  onChange={(e) => setLongFactor(+e.target.value)} />
                <span>{longFactor.toFixed(1)}× ideal</span>
              </div>
              <div className="text-xs flex items-center gap-2">
                <span className="opacity-70">Long necessary links flagged:</span>{" "}
                <b>{longLinkIds.size}</b>
              </div>

              {missingNecessary.length > 0 && (
                <button
                  className="btn btn-xs"
                  onClick={() => {
                    pushHistory();
                    setLinks((prev) => {
                      const added = [];
                      const have = new Set(prev.map((l) => pairKey(l.source, l.target)));
                      for (const m of missingNecessary) {
                        const k = pairKey(m.a.id, m.b.id);
                        if (!have.has(k)) {
                          added.push({ id: uid(), source: m.a.id, target: m.b.id, type: "necessary" });
                          have.add(k);
                        }
                      }
                      return [...prev, ...added];
                    });
                  }}
                >
                  Auto-connect all missing necessary pairs
                </button>
              )}
            </div>
          </details>

          {/* Files */}
          <details className="card">
            <summary className="cursor-pointer select-none group-title">Files & Export</summary>
            <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
              <button className="btn btn-xs" onClick={exportSVG}>Export SVG</button>
              <button className="btn btn-xs" onClick={exportPNG}>Export PNG</button>
              <button className="btn btn-xs" title="Ctrl/⌘ + S" onClick={saveJSON}>Save JSON</button>
              <button className="btn btn-xs" onClick={saveJSONAs}>Save As…</button>
              <button className="btn btn-xs" onClick={openJSON}>Open JSON…</button>
              <label className="btn btn-xs cursor-pointer">Import JSON
                <input className="hidden" type="file" accept="application/json" onChange={(e) => e.target.files && importJSON(e.target.files[0])} />
              </label>
              <button
                className="btn btn-xs"
                onClick={() => {
                  try {
                    const raw = localStorage.getItem(AUTOSAVE_KEY);
                    if (!raw) return alert("No autosave found.");
                    const saved = JSON.parse(raw);
                    parseAndLoadJSON(JSON.stringify(saved));
                  } catch {
                    alert("Failed to restore autosave.");
                  }
                }}
              >
                Restore autosave
              </button>
            </div>
          </details>

          {/* Inspector */}
          <details className="card" open>
            <summary className="cursor-pointer select-none group-title">Inspector & Stats</summary>
            <div className="mt-3 space-y-3">
              <div className="text-xs text-[#9aa0a6]">
                {nodes.length} nodes • {links.length} links • {selectedIds.length} selected
              </div>
              <div className="border border-[#2a2a3a] rounded-xl p-3">
                <div className="text-xs opacity-80 mb-2">Node Inspector</div>
                {!selectedNode ? (
                  <div className="text-xs text-[#9aa0a6]">
                    Click a bubble in <em>Select/Drag</em> mode to edit styles. Multi-select supports group pin/delete/style.
                  </div>
                ) : (
                  <div className="space-y-3 text-sm">
                    <div className="font-medium truncate" title={selectedNode.name}>
                      {selectedNode.name}
                      {selectedNode.locked && <span className="ml-2 text-[11px] opacity-80">📌 pinned</span>}
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <InlineEditField label="Name" value={selectedNode.name} onChange={(v) => renameNode(selectedNode.id, v)} />
                      <InlineEditField label="Area (m²)" value={String(selectedNode.area)} onChange={(v) => changeArea(selectedNode.id, v)} />
                    </div>

                    {/* Bubble visual */}
                    <div className="flex items-center gap-3 flex-wrap">
                      <label className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={(selectedNode.fillType || "solid") === "gradient"}
                          onChange={(e) => setNodeFillTypeGradient(selectedNode.id, e.target.checked)}
                        /> gradient
                      </label>
                      {(selectedNode.fillType || "solid") === "gradient" ? (
                        <>
                          <span className="opacity-70 text-xs">c1</span>
                          <input
                            type="color"
                            value={selectedNode.grad?.c1 || bulkGradC1}
                            onChange={(e) => setNodeGradC1(selectedNode.id, e.target.value)}
                          />
                          <span className="opacity-70 text-xs">c2</span>
                          <input
                            type="color"
                            value={selectedNode.grad?.c2 || bulkGradC2}
                            onChange={(e) => setNodeGradC2(selectedNode.id, e.target.value)}
                          />
                          <span className="opacity-70 text-xs">angle</span>
                          <input
                            type="number"
                            className="w-16 bg-transparent border border-[#2a2a3a] rounded px-1 py-0.5"
                            value={selectedNode.grad?.angle ?? bulkGradAngle}
                            onChange={(e) => setNodeGradAngle(selectedNode.id, e.target.value)}
                          />
                          <span className="opacity-70 text-xs">°</span>
                        </>
                      ) : (
                        <>
                          <label className="flex items-center gap-2">Fill
                            <input
                              type="color"
                              value={selectedNode.fill === "none" ? "#000000" : (selectedNode.fill || bulkFill)}
                              onChange={(e) => setNodeFill(selectedNode.id, e.target.value)}
                              disabled={selectedNode.fill === "none"}
                            />
                          </label>
                          <label className="flex items-center gap-2">
                            <input
                              type="checkbox"
                              checked={selectedNode.fill === "none"}
                              onChange={(e) =>
                                setNodeFill(
                                  selectedNode.id,
                                  e.target.checked ? "none" : bulkFill
                                )
                              }
                            /> transparent
                          </label>
                        </>
                      )}
                      <label className="flex items-center gap-2">Border
                        <input
                          type="color"
                          value={selectedNode.stroke || bulkStroke}
                          onChange={(e) => setNodeStroke(selectedNode.id, e.target.value)}
                        />
                      </label>
                      <label className="flex items-center gap-1">w
                        <input
                          type="number"
                          min={1}
                          max={12}
                          value={selectedNode.strokeWidth ?? bulkStrokeWidth}
                          className="w-16 bg-transparent border border-[#2a2a3a] rounded px-1 py-0.5"
                          onChange={(e) => setNodeStrokeW(selectedNode.id, e.target.value)}
                        />
                      </label>
                    </div>

                    {/* Labels */}
                    <div className="flex items-center gap-3 flex-wrap">
                      <select
                        className="ui-select"
                        value={selectedNode.textFont || bulkTextFont}
                        onChange={(e) => setNodeTextFont(selectedNode.id, e.target.value)}
                      >
                        <option value={FONT_STACKS.Outfit}>Outfit</option>
                        <option value={FONT_STACKS.Inter}>Inter</option>
                        <option value={FONT_STACKS.Poppins}>Poppins</option>
                        <option value={FONT_STACKS.Roboto}>Roboto</option>
                        <option value={FONT_STACKS.System}>system-ui</option>
                        <option value={FONT_STACKS.HelveticaNowCondensed}>Helvetica Now Condensed (if available)</option>
                      </select>
                      <input
                        type="color"
                        value={selectedNode.textColor || bulkTextColor}
                        onChange={(e) => setNodeTextColor(selectedNode.id, e.target.value)}
                      />
                      <label className="flex items-center gap-1">size
                        <input
                          type="number"
                          min={TEXT_MIN}
                          max={TEXT_MAX}
                          value={clampTextSize(selectedNode.textSize ?? bulkTextSize)}
                          className="w-16 bg-transparent border border-[#2a2a3a] rounded px-1 py-0.5"
                          onChange={(e) => setNodeTextSize(selectedNode.id, e.target.value)}
                          disabled={selectedNode.autoText && autoLabelSize}
                        />
                      </label>
                      <label className="flex items-center gap-1">
                        <input
                          type="checkbox"
                          checked={!!selectedNode.autoText}
                          onChange={(e) => setNodeAutoText(selectedNode.id, e.target.checked)}
                        /> Auto
                      </label>
                    </div>

                    <div className="flex gap-2 flex-wrap">
                      <button className="btn btn-xs" onClick={() => setSelectedNodeId(null)}>Done</button>
                      <button
                        className="btn btn-xs"
                        onClick={() => {
                          setNodeFill(selectedNode.id, bulkFillTransparent ? "none" : bulkFill);
                          setNodeStroke(selectedNode.id, bulkStroke);
                          setNodeStrokeW(selectedNode.id, bulkStrokeWidth);
                          setNodeTextFont(selectedNode.id, bulkTextFont);
                          setNodeTextColor(selectedNode.id, bulkTextColor);
                          setNodeTextSize(selectedNode.id, bulkTextSize);
                          setNodeAutoText(selectedNode.id, autoLabelSize);
                          setNodeFillTypeGradient(selectedNode.id, bulkGradientEnabled);
                          setNodeGradC1(selectedNode.id, bulkGradC1);
                          setNodeGradC2(selectedNode.id, bulkGradC2);
                          setNodeGradAngle(selectedNode.id, bulkGradAngle);
                        }}
                      >
                        Apply bulk defaults
                      </button>
                      <button className="btn btn-xs" onClick={() => setNodeLocked(selectedNode.id, !selectedNode.locked)}>
                        {selectedNode.locked ? "Unpin" : "Pin"}
                      </button>
                    </div>
                  </div>
                )}
              </div>

              <div className="grid grid-cols-2 gap-2 text-xs max-h-[220px] overflow-auto">
                {nodes.map((n) => (
                  <div
                    key={n.id}
                    className={`border border-[#2a2a3a] rounded-lg p-2 cursor-pointer ${selectedSet.has(n.id) ? "bg-white/10" : ""}`}
                    onClick={(e) => {
                      if (e.ctrlKey || e.metaKey || e.shiftKey) toggleSelect(n.id);
                      else selectOnly(n.id);
                      setSelectedNodeId(n.id);
                    }}
                  >
                    <div className="truncate font-medium" title={n.name}>{n.name}</div>
                    <div className="opacity-70">{n.area} m²</div>
                    {n.locked && <div className="opacity-70 mt-1">📌 Pinned</div>}
                  </div>
                ))}
              </div>
            </div>
          </details>
        </div>

        {/* Canvas */}
        <div className="xl:col-span-7">
          <div
            ref={containerRef}
            className="relative rounded-2xl border border-[#2a2a3a] overflow-hidden"
            style={{ background: liveBg }}
          >
            <svg
              ref={svgRef}
              width={"100%"}
              height={700}
              viewBox={`-600 -350 1200 700`}
              className="block"
              onPointerDown={onPointerDownSvg}
            >
              <MarkerDefs styles={styles} />
              <g id="zoomable" transform={zoomTransform.toString()}>
                {/* LASSO */}
                {lasso.active && lasso.points.length > 1 && (
                  <polyline
                    points={lasso.points.map((p) => `${p.x},${p.y}`).join(" ")}
                    fill="none"
                    stroke="#22c55e"
                    strokeWidth={2}
                    opacity={0.9}
                  />
                )}
                {lasso.active && lasso.points.length > 2 && (
                  <polygon
                    points={lasso.points.map((p) => `${p.x},${p.y}`).join(" ")}
                    fill="#22c55e22"
                    stroke="none"
                  />
                )}

                {/* BUBBLES (under) */}
                {nodes.map((n) => {
                  const r = rOf(n.area);
                  const isSrc = linkSource === n.id && mode === "connect";
                  const hi = hoverId === n.id || isSrc || selectedSet.has(n.id);
                  const labelFont = n.textFont || bulkTextFont;
                  const labelColor = n.textColor || bulkTextColor;

                  // Use dynamic only if global auto is ON and node autoText is true
                  const useDynamic = autoLabelSize && n.autoText;
                  const labelSize = useDynamic
                    ? dynamicLabelSizeForNode(n)
                    : clampTextSize(n.textSize ?? bulkTextSize);

                  const areaSize = clampTextSize(areaLabelSize);
                  const warnMissing = missingNodeIdSet.has(n.id);

                  // gradient coords from angle
                  const angle = (n.grad?.angle ?? bulkGradAngle) * (Math.PI / 180);
                  const gx = Math.cos(angle),
                    gy = Math.sin(angle);
                  const x1 = -gx * r,
                    y1 = -gy * r,
                    x2 = gx * r,
                    y2 = gy * r;

                  const fillType = n.fillType || "solid";
                  const solidFill = n.fill ?? (bulkFillTransparent ? "none" : bulkFill);
                  const useGradient = fillType === "gradient";

                  return (
                    <g
                      key={n.id}
                      transform={`translate(${n.x || 0},${n.y || 0})`}
                      onPointerDown={(e) => onPointerDownNode(e, n)}
                      onClick={() => handleConnect(n)}
                      onMouseEnter={() => setHoverId(n.id)}
                      onMouseLeave={() => setHoverId(null)}
                      style={{ cursor: mode === "connect" ? "crosshair" : canvasLocked ? "default" : "grab" }}
                    >
                      {/* per-node gradient defs */}
                      {useGradient && (
                        <defs>
                          <linearGradient
                            id={`grad-${n.id}`}
                            x1={x1}
                            y1={y1}
                            x2={x2}
                            y2={y2}
                            gradientUnits="userSpaceOnUse"
                          >
                            <stop offset="0%" stopColor={n.grad?.c1 || bulkGradC1} />
                            <stop offset="100%" stopColor={n.grad?.c2 || bulkGradC2} />
                          </linearGradient>
                        </defs>
                      )}

                      {/* selection ring */}
                      {selectedSet.has(n.id) && (
                        <circle
                          r={r + 5}
                          fill="none"
                          stroke="#60a5fa"
                          strokeWidth={2}
                          strokeDasharray="5 4"
                          opacity={0.9}
                        />
                      )}

                      {/* conflict halo */}
                      {warnMissing && (
                        <circle
                          r={r + 9}
                          fill="none"
                          stroke="#ef4444"
                          strokeWidth={2}
                          strokeDasharray="3 3"
                          opacity={0.9}
                        />
                      )}

                      {/* bubble */}
                      <circle
                        r={r}
                        fill={useGradient ? `url(#grad-${n.id})` : solidFill}
                        stroke={hi ? styles.necessary.color : (n.stroke || bulkStroke)}
                        strokeWidth={n.strokeWidth ?? bulkStrokeWidth}
                      />
                      <circle r={r - 2} fill="none" stroke="#2c2c3c" strokeWidth={1} />

                      {n.locked && <circle r={3} cx={r - 10} cy={-r + 10} fill="#22d3ee" />}

                      {/* NAME LABEL (dynamic size) */}
                      <text
                        textAnchor="middle"
                        dominantBaseline="middle"
                        className="select-none"
                        style={{
                          fill: labelColor,
                          fontSize: labelSize,
                          fontWeight: 600,
                          letterSpacing: 0.4,
                          fontFamily: labelFont,
                        }}
                      >
                        {(() => {
                          const pad = 10;
                          const maxW = Math.max(20, (r - pad) * 2);
                          const lines = wrapToWidth(
                            n.name,
                            labelFont,
                            labelSize,
                            maxW,
                            5
                          );
                          const gap = Math.max(2, Math.round(labelSize * 0.2));
                          const total =
                            lines.length * labelSize + (lines.length - 1) * gap;
                          const startY = -total / 2 + labelSize * 0.8;
                          return lines.map((line, i) => (
                            <tspan key={i} x={0} y={startY + i * (labelSize + gap)}>
                              {line}
                            </tspan>
                          ));
                        })()}
                      </text>

                      {/* AREA LABEL — fixed text size, fully independent from dynamic */}
                      {showMeasurements && (
                        <text
                          y={r - 18}
                          textAnchor="middle"
                          style={{
                            fill: THEME.subtle,
                            fontSize: areaSize,
                            fontFamily: labelFont,
                          }}
                        >
                          {n.area} m²
                        </text>
                      )}

                      {/* inline editors (disabled in connect mode) */}
                      <foreignObject
                        x={-r}
                        y={-18}
                        width={r * 2}
                        height={36}
                        data-ignore-export
                        style={{ pointerEvents: mode === "connect" ? "none" : "auto" }}
                      >
                        <InlineEdit
                          text={n.name}
                          onChange={(val) => renameNode(n.id, val)}
                          className="mx-auto text-center"
                        />
                      </foreignObject>
                      <foreignObject
                        x={-40}
                        y={r - 22}
                        width={80}
                        height={26}
                        data-ignore-export
                        style={{ pointerEvents: mode === "connect" ? "none" : "auto" }}
                      >
                        <InlineEdit
                          text={`${n.area}`}
                          onChange={(val) => changeArea(n.id, val)}
                          className="text-center"
                        />
                      </foreignObject>
                    </g>
                  );
                })}

                {/* LINKS (above bubbles) */}
                {links.map((l) => {
                  const s = nodes.find((n) => n.id === l.source);
                  const t = nodes.find((n) => n.id === l.target);
                  if (!s || !t) return null;
                  const dx = t.x - s.x,
                    dy = t.y - s.y;
                  const dist = Math.hypot(dx, dy) || 1;
                  const nx = dx / dist,
                    ny = dy / dist;
                  const rs = rOf(s.area),
                    rt = rOf(t.area);

                  const insetS = Math.max(0, Math.min(arrowOverlap, rs - 2));
                  const insetT = Math.max(0, Math.min(arrowOverlap, rt - 6));

                  const x1 = s.x + nx * (rs + 2 - insetS);
                  const y1 = s.y + ny * (rs + 2 - insetS);
                  const x2 = t.x - nx * (rt + 6 - insetT);
                  const y2 = t.y - ny * (rt + 6 - insetT);

                  const st = styles[l.type];
                  const isLong = longLinkIds.has(l.id);

                  return (
                    <g
                      key={l.id}
                      onDoubleClick={() => {
                        pushHistory();
                        setLinks((p) => p.filter((x) => x.id !== l.id));
                      }}
                      onClick={() => (lastClickedLinkRef.current = l.id)}
                    >
                      <line
                        x1={x1}
                        y1={y1}
                        x2={x2}
                        y2={y2}
                        stroke={st.color}
                        strokeWidth={st.width}
                        strokeDasharray={dashFor(l.type)}
                        markerStart={markerUrl(l.type, "start")}
                        markerEnd={markerUrl(l.type, "end")}
                        opacity={0.98}
                      />
                      {isLong && l.type === "necessary" && (
                        <line
                          x1={x1}
                          y1={y1}
                          x2={x2}
                          y2={y2}
                          stroke="#ef4444"
                          strokeWidth={Math.max(2, st.width + 1)}
                          strokeDasharray="6 3"
                          opacity={0.9}
                          data-ignore-export
                        />
                      )}
                    </g>
                  );
                })}
              </g>
            </svg>

            {/* Floating dock (zoom/physics/export/json/lock) */}
            <div className="absolute right-3 top-3 flex flex-col gap-2" data-ignore-export>
              <div className="bg-black/35 backdrop-blur p-2 rounded-xl border border-[#2a2a3a] flex flex-col gap-2">
                <button className="dock-btn btn" title="Zoom out" onClick={zoomOut} aria-label="Zoom out">−</button>
                <button className="dock-btn btn" title="Reset view" onClick={resetZoom} aria-label="Reset view">⟲</button>
                <button className="dock-btn btn" title="Fit to view" onClick={fitToView} aria-label="Fit to view">⤢</button>
                <button className="dock-btn btn" title="Zoom in" onClick={zoomIn} aria-label="Zoom in">＋</button>
              </div>
              <div className="bg-black/35 backdrop-blur p-2 rounded-xl border border-[#2a2a3a] flex flex-col gap-2">
                <button
                  className={`dock-btn btn ${canvasLocked ? "bg-white/10" : ""}`}
                  onClick={() => setCanvasLocked((v) => !v)}
                  title="Lock/unlock dragging bubbles (layout lock)"
                  aria-label="Lock layout"
                >
                  {canvasLocked ? "🔒" : "🔓"}
                </button>
                <button className="dock-btn btn" onClick={() => setPhysics((p) => !p)} title="Toggle physics" aria-label="Toggle physics">
                  {physics ? "⏸" : "▶"}
                </button>
                <button className="dock-btn btn" onClick={detanglePulse} title="De-tangle" aria-label="De-tangle">✺</button>
                <button className="dock-btn btn" onClick={toggleFullscreen} title="Fullscreen" aria-label="Fullscreen">{isFullscreen ? "⤢" : "⤢"}</button>
              </div>
              <div className="bg-black/35 backdrop-blur p-2 rounded-xl border border-[#2a2a3a] flex flex-col gap-2">
                <button className="dock-btn btn" onClick={exportSVG} aria-label="Export SVG">SVG</button>
                <button className="dock-btn btn" onClick={exportPNG} aria-label="Export PNG">PNG</button>
              </div>
              {/* floating JSON controls */}
              <div className="bg-black/35 backdrop-blur p-2 rounded-xl border border-[#2a2a3a] flex flex-col gap-2">
                <button className="dock-btn btn" onClick={openJSON} aria-label="Open JSON">OPEN</button>
                <button className="dock-btn btn" onClick={saveJSON} aria-label="Save JSON">SAVE</button>
                <button className="dock-btn btn" onClick={saveJSONAs} aria-label="Save As JSON">S-AS</button>
              </div>
            </div>

            {/* Floating conflicts action */}
            {missingNecessary.length > 0 && (
              <div className="absolute left-3 top-3 bg-red-500/20 text-red-200 border border-red-600/40 px-3 py-2 rounded-lg text-xs flex items-center gap-2" data-ignore-export>
                <span>Missing necessary: {missingNecessary.length}</span>
                <button
                  className="btn btn-xs"
                  onClick={() => {
                    pushHistory();
                    setLinks((prev) => {
                      const added = [];
                      const have = new Set(prev.map((l) => pairKey(l.source, l.target)));
                      for (const m of missingNecessary) {
                        const k = pairKey(m.a.id, m.b.id);
                        if (!have.has(k)) {
                          added.push({ id: uid(), source: m.a.id, target: m.b.id, type: "necessary" });
                          have.add(k);
                        }
                      }
                      return [...prev, ...added];
                    });
                  }}
                >
                  Auto-connect
                </button>
              </div>
            )}

            {/* Status pill */}
            <div className="absolute left-3 bottom-3 text-xs text-[#9aa0a6] bg-black/30 rounded-full px-3 py-1" data-ignore-export>
              Mode: <span className="font-semibold text-white">{mode}</span>
              {mode === "connect" && linkSource && <span> • select a target…</span>}
              {selectedNode && <span> • Editing: <span className="text-white">{selectedNode.name}</span></span>}
              <span> • Line: <span className="text-white capitalize">{currentLineType}</span></span>
              <span> • AutoText: <span className="text-white">{autoLabelSize ? "ON" : "OFF"}</span></span>
              <span> • DynScale: <span className="text-white">{Math.round(dynamicTextScale * 100)}%</span></span>
              <span> • Lock: <span className="text-white">{canvasLocked ? "ON" : "OFF"}</span></span>
            </div>
          </div>

          {/* About */}
          <div className="mt-3 card">
            <div className="text-sm">
              <p><strong>Authored by:</strong> Mark Jay O. Gooc — Architecture student, Batangas State University – TNEU.</p>
              <p className="opacity-70 text-xs mt-1">All Rights Reserve 2025.</p>
            </div>
          </div>
        </div>
      </div>

      {/* Keyboard Cheatsheet Modal */}
      {showHelp && (
        <div
          className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-50"
          role="dialog"
          aria-modal="true"
          onClick={() => setShowHelp(false)}
          data-ignore-export
        >
          <div className="card max-w-xl w-full" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-2">
              <div className="text-lg font-semibold">Keyboard Cheatsheet</div>
              <button className="btn btn-xs" onClick={() => setShowHelp(false)} aria-label="Close">Close</button>
            </div>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <div><b>?</b> (or Shift+/): Toggle cheatsheet</div>
                <div><b>Ctrl/⌘+Z</b>: Undo</div>
                <div><b>Ctrl/⌘+Y</b>: Redo</div>
                <div><b>Ctrl/⌘+S</b>: Save JSON</div>
                <div><b>Delete/Backspace</b>: Delete selection / last link</div>
              </div>
              <div>
                <div><b>Ctrl/⌘+A</b>: Select all</div>
                <div><b>Esc</b>: Clear selection</div>
                <div><b>Arrows</b>: Nudge selected (Shift for x4)</div>
                <div><b>Shift+Drag</b>: Lasso select</div>
                <div><b>1</b> or <b>N</b>: Necessary • <b>2</b> or <b>I</b>: Ideal • <b>Tab</b>: Toggle → Connect</div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ----- Small components ------------------------------------------------------
function InlineEdit({ text, onChange, className }) {
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(text);
  useEffect(() => setVal(text), [text]);
  if (!editing) {
    return (
      <div
        onDoubleClick={(e) => {
          e.stopPropagation();
          setEditing(true);
        }}
        className={`pointer-events-auto select-none text-[11px] text-white/90 bg-transparent ${className}`}
        style={{ lineHeight: 1.2 }}
      >
        {text}
      </div>
    );
  }
  return (
    <input
      autoFocus
      value={val}
      onChange={(e) => setVal(e.target.value)}
      onBlur={() => {
        onChange(val.trim());
        setEditing(false);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          onChange(val.trim());
          setEditing(false);
        }
        if (e.key === "Escape") setEditing(false);
      }}
      className={`w-full pointer-events-auto bg-[#0f0f18] border border-[#2a2a3a] rounded-md px-2 py-1 text-[12px] text-white ${className}`}
    />
  );
}

function InlineEditField({ label, value, onChange }) {
  const [val, setVal] = useState(value);
  useEffect(() => setVal(value), [value]);
  return (
    <label className="text-xs text-[#9aa0a6] grid gap-1">
      <span>{label}</span>
      <input
        value={val}
        onChange={(e) => setVal(e.target.value)}
        onBlur={() => onChange(val)}
        onKeyDown={(e) => {
          if (e.key === "Enter") onChange(val);
        }}
        className="bg-transparent border border-[#2a2a3a] rounded px-2 py-1 text-[12px] text-white"
      />
    </label>
  );
}

// --- Text measure & wrap -----------------------------------------------------
const _measureCtx = (() => {
  try {
    const c = document.createElement("canvas");
    return c.getContext("2d");
  } catch {
    return null;
  }
})();

function measureWidth(s, fontFamily, fontPx) {
  const ctx = _measureCtx;
  if (!ctx) return String(s).length * fontPx * 0.6;
  ctx.font = `${Math.max(8, fontPx)}px ${fontFamily || "system-ui, Arial"}`;
  return ctx.measureText(String(s)).width;
}

/** Wrap a label to a specific max pixel width using canvas text metrics. */
function wrapToWidth(label, fontFamily, fontPx, maxWidth, maxLines = 5) {
  const words = String(label).split(/\s+/).filter(Boolean);
  const lines = [];
  let cur = "";

  const pushLine = (s) => { if (s) lines.push(s); };

  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    if (!cur) {
      if (measureWidth(w, fontFamily, fontPx) > maxWidth) {
        let buf = "";
        for (const ch of w) {
          if (measureWidth(buf + ch, fontFamily, fontPx) <= maxWidth) buf += ch;
          else {
            pushLine(buf);
            buf = ch;
          }
          if (lines.length >= maxLines) break;
        }
        cur = buf;
      } else {
        cur = w;
      }
    } else {
      if (measureWidth(cur + " " + w, fontFamily, fontPx) <= maxWidth) {
        cur += " " + w;
      } else {
        pushLine(cur);
        cur = w;
      }
    }
    if (lines.length >= maxLines) break;
  }
  if (lines.length < maxLines && cur) pushLine(cur);

  if (lines.length > maxLines) {
    return lines.slice(0, maxLines - 1).concat([lines[maxLines - 1] + "…"]);
  }
  return lines;
}

// ---------------- Smoke tests (console) --------------------------------------
(function runSmokeTests() {
  try {
    const parsed = parseList("A, 10\nB 20\nC-30\nNoArea");
    console.assert(parsed.length === 4, "parseList length");
    console.assert(
      parsed[0].area === 10 && parsed[1].area === 20 && parsed[2].area === 30,
      "parseList areas"
    );
    const r = scaleRadius(parsed);
    const r10 = r(10), r20 = r(20), r30 = r(30);
    console.assert(r10 <= r20 && r20 <= r30, "scaleRadius monotonic");
    console.assert(clampTextSize("16") === 16, "text size string→number");
    console.assert(clampTextSize(5) === TEXT_MIN, "text size min clamp");
    console.assert(clampTextSize(99) === TEXT_MAX, "text size max clamp");
  } catch (e) {
    console.warn("Smoke tests warning:", e);
  }
})();
