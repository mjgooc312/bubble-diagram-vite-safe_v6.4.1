
import React, { useEffect, useMemo, useRef, useState } from "react";
import * as d3 from "d3";
// App version & changelog banner (top-level)
const APP_VERSION = "6.5.1";
const CHANGELOG_ITEMS = [
  "NEW: Scenes — save/restore positions and zoom.",
  "FIXED: Update-from-list maps by name; correct bubble updates after JSON import.",
  "NEW: Precise label wrapping inside bubbles.",
  "TWEAK: Toolbar organized into clear sections.",
];


/**
 * Bubble Diagram Builder – Force-directed (React + D3)
 * v4.3 — Arrow overlap + Rotation sensitivity + Rounded color pickers
 *
 * What’s new vs your uploaded file:
 *  • Arrow overlap slider: lets link lines/arrowheads extend inside the bubbles.
 *  • Rotation sensitivity slider: adds a gentle tangential “spin” force so bubbles orbit/settle based on sensitivity.
 *  • Color inputs styled as smooth rounded pills (no sharp corners).
 *  • Presets persist arrowOverlap and rotationSensitivity along with the rest.
 *
 * Drop this into your Vite React app (e.g., src/BubbleAdjacencyApp.jsx) and render it.
 */

// ---- Theme (UI chrome only; not the canvas background) ----------------------
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

// Sample list for quick testing
const SAMPLE_TEXT = `Officials / Referees Room, 120
Analyst / Data Room, 80
VOD Review / Theater, 60
Match Admin Room, 90
Competition Manager Office, 45
Briefing / Protest Room, 110
Player Warm-up Pods (Concourse), 130`;

// ----- Utilities -------------------------------------------------------------
const uid = () => Math.random().toString(36).slice(2, 9);

/** Coerce to finite number, else fallback */
function toNumber(v, fallback) {
  const n = typeof v === "string" && v.trim() === "" ? NaN : Number(v);
  return Number.isFinite(n) ? n : fallback;
}
// normalize a label for name-based matching
function norm(s){
  return String(s || "").trim().toLowerCase().replace(/\s+/g, " ");
}


/** Clamp text size into safe range and coerce to number */
function clampTextSize(v) {
  const n = toNumber(v, 12);
  return Math.max(TEXT_MIN, Math.min(TEXT_MAX, n));
}

/** Parse "Name, 120" / "Name - 120" / "Name 120" */
function parseList(text) {
  return text
    .split(/\r? /)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((line) => {
      const m = line.match(/^(.*?)[,|-]?\s*(\d+(?:\.\d+)?)\s*$/);
      return m
        ? { id: uid(), name: m[1].trim(), area: parseFloat(m[2]) }
        : { id: uid(), name: line, area: 20 };
    });
}

/** sqrt(area) → [BASE_R_MIN, BASE_R_MAX] */
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

// ----- Robust download helper (export SVG/PNG/JSON) -------------------------
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
      try { URL.revokeObjectURL(url); } catch {}
    }, 50);
  } catch {
    window.open(url, "_blank");
  }
}

// ----- Arrowheads ------------------------------------------------------------
const HEAD_SHAPES = ["none", "arrow", "circle", "square", "diamond", "bar"];
const sanitizeColorId = (c) => String(c).replace(/[^a-zA-Z0-9]/g, "");
const markerId = (kind, shape, color) => `m-${kind}-${shape}-${sanitizeColorId(color)}`;

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
              points={kind === "end" ? "0 0, 10 3.5, 0 7" : "10 0, 0 3.5, 10 7"}
              fill={st.color}
            />
          )}
          {shape === "circle" && <circle cx={kind === "end" ? 7 : 3} cy={3.5} r={3} fill={st.color} />}
          {shape === "square" && (
            <rect x={kind === "end" ? 3 : 1} y={1} width={6} height={6} fill={st.color} />
          )}
          {shape === "diamond" && (
            <polygon
              points="3.5 0, 7 3.5, 3.5 7, 0 3.5"
              transform={kind === "end" ? "translate(3,0)" : "translate(1,0)"}
              fill={st.color}
            />
          )}
          {shape === "bar" && (
            <rect x={kind === "end" ? 7.5 : 1.5} y={0.5} width={1.5} height={6.5} fill={st.color} />
          )}
        </marker>
      );
    });
  });
  return <defs>{defs}</defs>;
}

// ------------------------- Persistence (localStorage) ------------------------
const LS_KEY = "bubbleBuilder:v1";
function loadPresets() {
  try { return JSON.parse(localStorage.getItem(LS_KEY) || "{}"); } catch { return {}; }
}
function savePresets(obj) {
  try { localStorage.setItem(LS_KEY, JSON.stringify(obj)); } catch {}
}

// ------------------------- Custom spin force ---------------------------------
function makeSpinForce(level /* 0..100 */) {
  let nodes = [];
  const base = 0.0002; // tuning factor for smoothness
  function force(alpha) {
    if (!level) return;
    const k = base * level * alpha;
    for (const n of nodes) {
      const x = n.x || 0, y = n.y || 0;
      // tangential velocity: (-y, x)
      n.vx += -y * k;
      n.vy +=  x * k;
    }
  }
  force.initialize = (ns) => { nodes = ns; };
  return force;
}

// ----- Main App --------------------------------------------------------------
export default function BubbleAdjacencyApp() {
  // Graph data
  const [nodes, setNodes] = useState([]);
  const [links, setLinks] = useState([]);

  // UI state
  const [rawList, setRawList] = useState("");
  const [mode, setMode] = useState("select");
  const [currentLineType, setCurrentLineType] = useState("necessary");
  const [linkSource, setLinkSource] = useState(null);
  const [hoverId, setHoverId] = useState(null);
  const [selectedNodeId, setSelectedNodeId] = useState(null);

  // Layout physics
  const [physics, setPhysics] = useState(true);

  // Buffer between bubbles
  const [buffer, setBuffer] = useState(6);

  // NEW: arrows can overlap into the circles — in pixels
  const [arrowOverlap, setArrowOverlap] = useState(0); // 0..40+

  // NEW: rotation sensitivity (adds a light "spin" force)
  const [rotationSensitivity, setRotationSensitivity] = useState(0); // 0..100

  // Changelog banner show-once per version
  const [showChangelog, setShowChangelog] = useState(false);
  useEffect(() => {
    try {
      const seen = localStorage.getItem("bdb_seen_version");
      if (seen !== APP_VERSION) {
        setShowChangelog(true);
        localStorage.setItem("bdb_seen_version", APP_VERSION);
      }
    } catch {}
  }, []);
  const [showMeasurements, setShowMeasurements] = useState(true);

// --- Scenes (positions + zoom) ---
const SCENES_KEY = "bubbleScenes:v1";
const [scenes, setScenes] = useState(() => {
  try { return JSON.parse(localStorage.getItem(SCENES_KEY) || "[]"); }
  catch { return []; }
});
const [activeSceneId, setActiveSceneId] = useState(null);
useEffect(() => {
  try { localStorage.setItem(SCENES_KEY, JSON.stringify(scenes)); } catch {}
}, [scenes]);
  const [updateAreasFromList, setUpdateAreasFromList] = useState(false);
  const [updateMatchMode, setUpdateMatchMode] = useState("name"); // "name" | "index" // update areas too when applying list

  // Edge style presets (necessary vs ideal)
  const [styles, setStyles] = useState({
    necessary: { color: "#8b5cf6", dashed: false, width: 3, headStart: "arrow", headEnd: "arrow" },
    ideal: { color: "#facc15", dashed: true, width: 3, headStart: "arrow", headEnd: "arrow" },
  });

  // Export background (used for exported image files)
  const [exportBgMode, setExportBgMode] = useState("transparent"); // transparent | white | custom
  const [exportBgCustom, setExportBgCustom] = useState("#ffffff");

  // Live preview background (used for on-screen canvas container)
  const [liveBgMode, setLiveBgMode] = useState("custom");           // transparent | white | custom
  const [liveBgCustom, setLiveBgCustom] = useState(THEME.surface);  // default matches old UI

  // BULK defaults (applied on generate or via "Apply to all")
  const [bulkFill, setBulkFill] = useState("#161625");
  const [bulkFillTransparent, setBulkFillTransparent] = useState(false);
  const [bulkStroke, setBulkStroke] = useState("#2d2d3d");
  const [bulkStrokeWidth, setBulkStrokeWidth] = useState(2);
  const [bulkTextFont, setBulkTextFont] = useState(FONT_STACKS.Outfit);
  const [bulkTextColor, setBulkTextColor] = useState("#e6e6f0");
  const [bulkTextSize, setBulkTextSize] = useState(12);

  // Refs
  const svgRef = useRef(null);
  const simRef = useRef(null);
  const containerRef = useRef(null);
  // File handle for JSON (File System Access API)
  const jsonHandleRef = useRef(null);


  // Zoom / Pan
  const zoomBehaviorRef = useRef(null);
  const [zoomTransform, setZoomTransform] = useState(d3.zoomIdentity);

  // Computed radius scale
  const rOf = useMemo(() => scaleRadius(nodes), [nodes]);

  // ---------------------------- History (Undo/Redo) --------------------------
  const historyRef = useRef([]);
  const futureRef = useRef([]);
  const snapshot = () => ({
    nodes: JSON.parse(JSON.stringify(nodes)),
    links: JSON.parse(JSON.stringify(links)),
    styles: JSON.parse(JSON.stringify(styles)),
    buffer,
    arrowOverlap,
    rotationSensitivity,
  });
  const pushHistory = () => { historyRef.current.push(snapshot()); futureRef.current = []; };
  function undo() {
    if (!historyRef.current.length) return;
    const prev = historyRef.current.pop();
    futureRef.current.push(snapshot());
    setNodes(prev.nodes); setLinks(prev.links); setStyles(prev.styles);
    setBuffer(prev.buffer);
    setArrowOverlap(prev.arrowOverlap ?? 0);
    setRotationSensitivity(prev.rotationSensitivity ?? 0);
  }
  function redo() {
    if (!futureRef.current.length) return;
    const next = futureRef.current.pop();
    historyRef.current.push(snapshot());
    setNodes(next.nodes); setLinks(next.links); setStyles(next.styles);
    setBuffer(next.buffer);
    setArrowOverlap(next.arrowOverlap ?? 0);
    setRotationSensitivity(next.rotationSensitivity ?? 0);
  }

  // ---------------------------- Preset Persistence ---------------------------
  // Load on mount
  useEffect(() => {
    const p = loadPresets();
    if (!p) return;
    if (p.styles) setStyles((s) => ({ ...s, ...p.styles }));
    if (typeof p.buffer === "number") setBuffer(p.buffer);
    if (typeof p.arrowOverlap === "number") setArrowOverlap(p.arrowOverlap);
    if (typeof p.rotationSensitivity === "number") setRotationSensitivity(p.rotationSensitivity);
    if (p.bulk) {
      const b = p.bulk;
      if (typeof b.bulkFill === "string") setBulkFill(b.bulkFill);
      if (typeof b.bulkFillTransparent === "boolean") setBulkFillTransparent(b.bulkFillTransparent);
      if (typeof b.bulkStroke === "string") setBulkStroke(b.bulkStroke);
      if (typeof b.bulkStrokeWidth === "number") setBulkStrokeWidth(Math.max(1, Math.min(12, b.bulkStrokeWidth)));
      if (typeof b.bulkTextFont === "string") setBulkTextFont(b.bulkTextFont);
      if (typeof b.bulkTextColor === "string") setBulkTextColor(b.bulkTextColor);
      if (b.bulkTextSize != null) setBulkTextSize(clampTextSize(b.bulkTextSize));
    }
    if (p.exportBgMode) setExportBgMode(p.exportBgMode);
    if (p.exportBgCustom) setExportBgCustom(p.exportBgCustom);
    if (p.liveBgMode) setLiveBgMode(p.liveBgMode);
    if (p.liveBgCustom) setLiveBgCustom(p.liveBgCustom);
  }, []);

  // Save whenever any preset changes
  useEffect(() => {
    const payload = {
      styles,
      buffer,
      arrowOverlap,
      rotationSensitivity,
      bulk: {
        bulkFill,
        bulkFillTransparent,
        bulkStroke,
        bulkStrokeWidth,
        bulkTextFont,
        bulkTextColor,
        bulkTextSize: clampTextSize(bulkTextSize),
      },
      exportBgMode, exportBgCustom,
      liveBgMode, liveBgCustom,
      scenes,
      activeSceneId,
    };
    savePresets(payload);
  }, [
    styles, buffer, arrowOverlap, rotationSensitivity,
    bulkFill, bulkFillTransparent, bulkStroke, bulkStrokeWidth,
    bulkTextFont, bulkTextColor, bulkTextSize,
    exportBgMode, exportBgCustom,
    liveBgMode, liveBgCustom
  ]);

  // ---------------------------- D3 Force Simulation --------------------------
  useEffect(() => {
    const sim = d3
      .forceSimulation()
      .alphaDecay(0.05)
      .velocityDecay(0.3)
      .force("charge", d3.forceManyBody().strength(-80))
      .force("collide", d3.forceCollide().radius((d) => (d.r || BASE_R_MIN) + buffer))
      .force("center", d3.forceCenter(0, 0))
      .force("spin", makeSpinForce(rotationSensitivity)); // NEW
    simRef.current = sim;
    return () => sim.stop();
  }, []);

  // Re-apply spin force when sensitivity changes
  useEffect(() => {
    const sim = simRef.current;
    if (!sim) return;
    sim.force("spin", makeSpinForce(rotationSensitivity));
    if (physics && rotationSensitivity > 0) sim.alpha(0.5).restart();
  }, [rotationSensitivity, physics]);

  const rafRef = useRef(null);
  useEffect(() => {
    const sim = simRef.current; if (!sim) return;
    const nn = nodes.map((n) => ({ ...n, r: rOf(n.area) }));
    const idMap = new Map(nn.map((n) => [n.id, n]));
    const linkObjs = links.map((l) => ({ ...l, source: idMap.get(l.source), target: idMap.get(l.target), type: l.type }));

    const linkForce = d3.forceLink(linkObjs)
      .id((d) => d.id)
      .distance((l) => {
        const base = (l.source.r || BASE_R_MIN) + (l.target.r || BASE_R_MIN);
        const k = l.type === "necessary" ? 1.1 : 1.0;
        return base * 1.05 * k + 40 + buffer * 1.5;
      })
      .strength((l) => (l.type === "necessary" ? 0.5 : 0.25));

    sim.nodes(nn);
    sim.force("collide", d3.forceCollide().radius((d) => (d.r || BASE_R_MIN) + buffer));
    sim.force("link", linkForce);
    sim.force("x", d3.forceX().strength(0.03));
    sim.force("y", d3.forceY().strength(0.03));

    if (physics) sim.alpha(0.9).restart(); else sim.stop();

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
      if (rafRef.current != null) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
    };
  }, [nodes.length, links, physics, rOf, buffer]);

  // ---------------------------- Generate / Edit -------------------------------
  function onGenerate() {
    pushHistory();
    const parsed = parseList(rawList || SAMPLE_TEXT);
    const angle = (2 * Math.PI) / Math.max(1, parsed.length);
    const R = 260;
    const init = parsed.map((n, i) => ({
      ...n,
      x: Math.cos(i * angle) * R,
      y: Math.sin(i * angle) * R,
      fill: bulkFillTransparent ? "none" : bulkFill,
      stroke: bulkStroke,
      strokeWidth: bulkStrokeWidth,
      textFont: bulkTextFont,
      textColor: bulkTextColor,
      textSize: clampTextSize(bulkTextSize),
    }));
    setNodes(init);
    setLinks([]);
    setMode("select");
    setLinkSource(null);
    setPhysics(true);
    setSelectedNodeId(null);
    // Reset zoom to identity so fresh graph starts centered
    resetZoom();
  }
  
function updateFromList() {
  if (!nodes.length) return;
  const parsed = parseList(rawList || "");
  if (!parsed.length) return;
  pushHistory();

  if (updateMatchMode === "index") {
    setNodes((prev) => prev.map((n, i) => {
      if (i >= parsed.length) return n;
      const src = parsed[i];
      return {
        ...n,
        name: src.name,
        ...(updateAreasFromList ? { area: Math.max(1, +src.area || n.area) } : {}),
      };
    }));
    if (parsed.length > nodes.length) {
      const extras = parsed.slice(nodes.length).map((x) => ({
        id: Math.random().toString(36).slice(2, 9),
        name: x.name,
        area: Math.max(1, +x.area || 20),
        x: (Math.random() - 0.5) * 40,
        y: (Math.random() - 0.5) * 40,
        fill: bulkFillTransparent ? "none" : bulkFill,
        stroke: bulkStroke,
        strokeWidth: bulkStrokeWidth,
        textFont: bulkTextFont,
        textColor: bulkTextColor,
        textSize: clampTextSize(bulkTextSize),
      }));
      setNodes((prev) => [...prev, ...extras]);
    }
    return;
  }

  // default: match by NAME (safer after JSON imports that reorder nodes)
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
          ...(updateAreasFromList ? { area: Math.max(1, +src.area || updated[idx].area) } : {}),
        };
        used.add(idx);
      } else {
        extras.push({
          id: Math.random().toString(36).slice(2, 9),
          name: src.name,
          area: Math.max(1, +src.area || 20),
          x: (Math.random() - 0.5) * 40,
          y: (Math.random() - 0.5) * 40,
          fill: bulkFillTransparent ? "none" : bulkFill,
          stroke: bulkStroke,
          strokeWidth: bulkStrokeWidth,
          textFont: bulkTextFont,
          textColor: bulkTextColor,
          textSize: clampTextSize(bulkTextSize),
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
  }

  function handleConnect(node) {
    if (mode !== "connect") return;
    if (!linkSource) { setLinkSource(node.id); return; }
    if (linkSource === node.id) { setLinkSource(null); return; }
    pushHistory();
    setLinks((p) => [...p, { id: uid(), source: linkSource, target: node.id, type: currentLineType }]);
    setLinkSource(null);
  }

  function applyBulkBubbleStyles() {
    pushHistory();
    setNodes((prev) => prev.map((n) => ({
      ...n,
      fill: bulkFillTransparent ? "none" : bulkFill,
      stroke: bulkStroke,
      strokeWidth: bulkStrokeWidth,
    })));
  }

  function applyBulkTextStyles() {
    pushHistory();
    setNodes((prev) => prev.map((n) => ({
      ...n,
      textFont: bulkTextFont,
      textColor: bulkTextColor,
      textSize: clampTextSize(bulkTextSize),
    })));
  }

  // ---------------------------- Dragging -------------------------------------
  const draggingRef = useRef(null);
  const dragStartSnapshotRef = useRef(null);
  function onPointerDownNode(e, node) {
    e.stopPropagation();
    setSelectedNodeId(node.id);
    draggingRef.current = node.id;
    dragStartSnapshotRef.current = snapshot();
    try { e.currentTarget.setPointerCapture?.(e.pointerId); } catch {}
    simRef.current?.alphaTarget(0.4).restart();
  }
  function svgToLocalPoint(svgEl, clientX, clientY) {
    if (!svgEl) return { x: clientX, y: clientY };
    const pt = svgEl.createSVGPoint(); pt.x = clientX; pt.y = clientY;
    const screenCTM = svgEl.getScreenCTM();
    if (!screenCTM) return { x: clientX, y: clientY };
    const loc = pt.matrixTransform(screenCTM.inverse());
    const inner = svgEl.querySelector("g#zoomable");
    const innerCTM = inner?.getCTM();
    if (!innerCTM) return { x: loc.x, y: loc.y };
    const p = new DOMPoint(loc.x, loc.y).matrixTransform(innerCTM.inverse());
    return { x: p.x, y: p.y };
  }
  function onPointerMove(e) {
    const id = draggingRef.current; if (!id) return;
    const svg = svgRef.current; const { x, y } = svgToLocalPoint(svg, e.clientX, e.clientY);
    setNodes((prev) => prev.map((n) => (n.id === id ? { ...n, x, y, fx: x, fy: y } : n)));
  }
  function onPointerUp() {
    const id = draggingRef.current; if (!id) return; draggingRef.current = null;
    setNodes((prev) => prev.map((n) => (n.id === id ? { ...n, fx: undefined, fy: undefined } : n)));
    if (dragStartSnapshotRef.current) historyRef.current.push(dragStartSnapshotRef.current);
    dragStartSnapshotRef.current = null;
    futureRef.current = [];
    simRef.current?.alphaTarget(0);
  }

  // ---------------------------- Node style setters ---------------------------
  function renameNode(id, val) { pushHistory(); setNodes((p) => p.map((n) => (n.id === id ? { ...n, name: val } : n))); }
  function changeArea(id, v) { pushHistory(); const a = toNumber(v, 1); setNodes((p) => p.map((n) => (n.id === id ? { ...n, area: Math.max(1, a) } : n))); }
  function setNodeFill(id, colorOrNone) { pushHistory(); setNodes((p) => p.map((n) => (n.id === id ? { ...n, fill: colorOrNone } : n))); }
  function setNodeStroke(id, color) { pushHistory(); setNodes((p) => p.map((n) => (n.id === id ? { ...n, stroke: color } : n))); }
  function setNodeStrokeW(id, w) { pushHistory(); const width = Math.max(1, Math.min(12, toNumber(w, 2))); setNodes((p) => p.map((n) => (n.id === id ? { ...n, strokeWidth: width } : n))); }
  function setNodeTextColor(id, c) { pushHistory(); setNodes((p) => p.map((n) => (n.id === id ? { ...n, textColor: c } : n))); }
  function setNodeTextSize(id, s) { pushHistory(); setNodes((p) => p.map((n) => (n.id === id ? { ...n, textSize: clampTextSize(s) } : n))); }
  function setNodeTextFont(id, f) { pushHistory(); setNodes((p) => p.map((n) => (n.id === id ? { ...n, textFont: f } : n))); }

  // ---------------------------- Keyboard Shortcuts ---------------------------
  const lastClickedLinkRef = useRef(null);
  useEffect(() => {
    const onKey = (e) => {
      if (e.ctrlKey || e.metaKey) {
        const k = e.key.toLowerCase();
        if (k === "z") { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return; }
        if (k === "y") { e.preventDefault(); redo(); return; }
        if (k === "s") { e.preventDefault(); saveJSON(); return; }
      }
      if (e.key === "Delete" || e.key === "Backspace") {
        const id = lastClickedLinkRef.current; if (!id) return;
        pushHistory();
        setLinks((p) => p.filter((l) => l.id !== id));
        lastClickedLinkRef.current = null;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  
// ---------------------------- Scenes API ------------------------------------
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
  const s = { id: Math.random().toString(36).slice(2,9), name: nm, ...payload };
  setScenes(prev => [...prev, s]);
  setActiveSceneId(s.id);
}
function applyScene(sceneId) {
  const s = scenes.find(x => x.id === sceneId);
  if (!s) return;
  const { positions, zoom } = s;
  setNodes(prev => prev.map(n => {
    const p = positions[n.id];
    return p ? { ...n, x: p.x, y: p.y, fx: undefined, fy: undefined } : n;
  }));
  try {
    const svg = d3.select(svgRef.current);
    const zoomer = zoomBehaviorRef.current;
    if (svg && zoomer && zoom) {
      svg.transition().duration(250)
         .call(zoomer.transform, d3.zoomIdentity.translate(zoom.x, zoom.y).scale(zoom.k || 1));
    }
  } catch {}
  zeroVelocities();
  simRef.current?.alpha(0.3).restart();
}
function updateScene(sceneId) {
  const idx = scenes.findIndex(x => x.id === sceneId);
  if (idx === -1) return;
  const payload = captureScenePayload();
  setScenes(prev => {
    const next = [...prev];
    next[idx] = { ...next[idx], ...payload };
    return next;
  });
}
function deleteScene(sceneId) {
  setScenes(prev => prev.filter(x => x.id !== sceneId));
  if (activeSceneId === sceneId) setActiveSceneId(null);
}

// ---------------------------- Export helpers -------------------------------
  function getExportBg() {
    if (exportBgMode === "transparent") return null;
    if (exportBgMode === "white") return "#ffffff";
    return exportBgCustom || "#ffffff";
  }

  function exportSVG() {
    const orig = svgRef.current; if (!orig) return;
    const clone = orig.cloneNode(true);
    const vb = orig.getAttribute("viewBox") || "-600 -350 1200 700";
    clone.setAttribute("viewBox", vb);
    clone.querySelectorAll('[data-ignore-export]').forEach((el) => el.remove());
    clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    clone.setAttribute("xmlns:xlink", "http://www.w3.org/1999/xlink");
    clone.setAttribute("width", "1200");
    clone.setAttribute("height", "700");
    const bg = getExportBg();
    if (bg) {
      const vbObj = clone.viewBox?.baseVal || { x: -600, y: -350, width: 1200, height: 700 };
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
    const url = URL.createObjectURL(blob); download(url, `bubble-diagram-${Date.now()}.svg`);
  }

  function exportPNG() {
    const orig = svgRef.current; if (!orig) return;
    const clone = orig.cloneNode(true);
    clone.querySelectorAll('[data-ignore-export]').forEach((el) => el.remove());
    const svgStr = new XMLSerializer().serializeToString(clone);
    const img = new Image();
    const svg64 = btoa(unescape(encodeURIComponent(svgStr)));
    img.onload = () => {
      const canvas = document.createElement("canvas"); canvas.width = 2200; canvas.height = 1400;
      const ctx = canvas.getContext("2d");
      const bg = getExportBg();
      if (bg) { ctx.fillStyle = bg; ctx.fillRect(0, 0, canvas.width, canvas.height); }
      else { ctx.clearRect(0, 0, canvas.width, canvas.height); }
      const scale = Math.min(canvas.width / 1200, canvas.height / 700);
      const dx = (canvas.width - 1200 * scale) / 2; const dy = (canvas.height - 700 * scale) / 2;
      ctx.setTransform(scale, 0, 0, scale, dx, dy);
      ctx.drawImage(img, 0, 0);
      canvas.toBlob((blob) => { if (!blob) return; const url = URL.createObjectURL(blob); download(url, `bubble-diagram-${Date.now()}.png`); });
    };
    img.onerror = () => alert("PNG export failed. Try SVG export if issue persists.");
    img.src = `data:image/svg+xml;base64,${svg64}`;
  }

  
  function buildExportPayload() {
    return {
      nodes, links, styles,
      bulk: {
        bulkFill,
        bulkFillTransparent,
        bulkStroke,
        bulkStrokeWidth,
        bulkTextFont,
        bulkTextColor,
        bulkTextSize: clampTextSize(bulkTextSize),
      },
      buffer,
      arrowOverlap,
      rotationSensitivity,
      showMeasurements,
      exportBgMode, exportBgCustom,
      liveBgMode, liveBgCustom,
    };
  }

  function exportJSON() {
    const blob = new Blob(
      [JSON.stringify({
        nodes, links, styles,
        bulk: {
          bulkFill,
          bulkFillTransparent,
          bulkStroke,
          bulkStrokeWidth,
          bulkTextFont,
          bulkTextColor,
          bulkTextSize: clampTextSize(bulkTextSize),
        },
        buffer,
        arrowOverlap,
        rotationSensitivity,
        exportBgMode, exportBgCustom,
        liveBgMode, liveBgCustom,
      }, null, 2)],
      { type: "application/json" }
    );
    const url = URL.createObjectURL(blob); download(url, `bubble-diagram-${Date.now()}.json`);
  }
  // ---- File System Access API helpers (progressive enhancement) -------------
  async function saveJSON() {
    // Save to the same file if we have a handle; otherwise fall back to Save As
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
    // Fallback
    return saveJSONAs();
  }

  async function saveJSONAs() {
    if (window.showSaveFilePicker) {
      try {
        const handle = await window.showSaveFilePicker({
          suggestedName: "bubble-diagram.json",
          types: [{
            description: "JSON files",
            accept: { "application/json": [".json"] },
          }],
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
    // Fallback: simple download with a prompt for the filename
    let name = typeof window !== "undefined" ? (window.prompt("File name", "bubble-diagram.json") || "bubble-diagram.json") : "bubble-diagram.json";
    const blob = new Blob([JSON.stringify(buildExportPayload(), null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    download(url, name);
  }

  async function openJSON() {
    if (window.showOpenFilePicker) {
      try {
        const [handle] = await window.showOpenFilePicker({
          multiple: false,
          types: [{
            description: "JSON files",
            accept: { "application/json": [".json"] },
          }],
        });
        if (!handle) return;
        const file = await handle.getFile();
        const text = await file.text();
        jsonHandleRef.current = handle; // remember for "Save" back to same file
        parseAndLoadJSON(text);
        return;
      } catch (err) {
        console.warn("Open JSON cancelled or failed.", err);
      }
    }
    // Fallback: trigger the hidden file input (existing Import JSON)
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "application/json";
    input.onchange = (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      jsonHandleRef.current = null; // file input doesn't grant a persistent handle
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
          strokeWidth: Math.max(1, Math.min(12, toNumber(n.strokeWidth, bulkStrokeWidth))),
        }));
        setNodes(normalized);
      }
      if (Array.isArray(d.links)) setLinks(d.links.filter((l) => l.source && l.target));
      if (d.styles) setStyles((s) => ({ ...s, ...d.styles }));
      if (d.bulk) {
        const b = d.bulk;
        if (typeof b.bulkFill === "string") setBulkFill(b.bulkFill);
        if (typeof b.bulkFillTransparent === "boolean") setBulkFillTransparent(b.bulkFillTransparent);
        if (typeof b.bulkStroke === "string") setBulkStroke(b.bulkStroke);
        if (typeof b.bulkStrokeWidth === "number") setBulkStrokeWidth(Math.max(1, Math.min(12, b.bulkStrokeWidth)));
        if (typeof b.bulkTextFont === "string") setBulkTextFont(b.bulkTextFont);
        if (typeof b.bulkTextColor === "string") setBulkTextColor(b.bulkTextColor);
        if (b.bulkTextSize != null) setBulkTextSize(clampTextSize(b.bulkTextSize));
      }
      if (typeof d.buffer === "number") setBuffer(d.buffer);
      if (typeof d.arrowOverlap === "number") setArrowOverlap(d.arrowOverlap);
      if (typeof d.rotationSensitivity === "number") setRotationSensitivity(d.rotationSensitivity);
      if (typeof d.showMeasurements === "boolean") setShowMeasurements(d.showMeasurements);
      if (d.exportBgMode) setExportBgMode(d.exportBgMode);
      if (d.exportBgCustom) setExportBgCustom(d.exportBgCustom);
      if (d.liveBgMode) setLiveBgMode(d.liveBgMode);
      if (d.liveBgCustom) setLiveBgCustom(d.liveBgCustom);
    } catch {
      alert("Invalid JSON file");
    }
  }


  function importJSON(file) {
    const r = new FileReader();
    r.onload = () => {
      try {
        const d = JSON.parse(r.result);
        if (Array.isArray(d.nodes)) {
          const normalized = d.nodes.map((n) => ({
            ...n,
            id: n.id || uid(),
            name: String(n.name ?? "Unnamed"),
            area: Math.max(1, toNumber(n.area, 20)),
            textSize: clampTextSize(n.textSize ?? bulkTextSize),
            strokeWidth: Math.max(1, Math.min(12, toNumber(n.strokeWidth, bulkStrokeWidth))),
          }));
          setNodes(normalized);
        }
        if (Array.isArray(d.links)) setLinks(d.links.filter((l) => l.source && l.target));
        if (d.styles) setStyles((s) => ({ ...s, ...d.styles }));
        if (d.bulk) {
          const b = d.bulk;
          if (typeof b.bulkFill === "string") setBulkFill(b.bulkFill);
          if (typeof b.bulkFillTransparent === "boolean") setBulkFillTransparent(b.bulkFillTransparent);
          if (typeof b.bulkStroke === "string") setBulkStroke(b.bulkStroke);
          if (typeof b.bulkStrokeWidth === "number") setBulkStrokeWidth(Math.max(1, Math.min(12, b.bulkStrokeWidth)));
          if (typeof b.bulkTextFont === "string") setBulkTextFont(b.bulkTextFont);
          if (typeof b.bulkTextColor === "string") setBulkTextColor(b.bulkTextColor);
          if (b.bulkTextSize != null) setBulkTextSize(clampTextSize(b.bulkTextSize));
        }
        if (typeof d.buffer === "number") setBuffer(d.buffer);
        if (typeof d.arrowOverlap === "number") setArrowOverlap(d.arrowOverlap);
        if (typeof d.rotationSensitivity === "number") setRotationSensitivity(d.rotationSensitivity);
        if (d.exportBgMode) setExportBgMode(d.exportBgMode);
        if (d.exportBgCustom) setExportBgCustom(d.exportBgCustom);
        if (d.liveBgMode) setLiveBgMode(d.liveBgMode);
        if (d.liveBgCustom) setLiveBgCustom(d.liveBgCustom);
      } catch {
        alert("Invalid JSON file");
      }
    };
    r.readAsText(file);
  }

  
function zeroVelocities() {
  try {
    const sim = simRef.current;
    if (!sim) return;
    const arr = sim.nodes ? sim.nodes() : [];
    if (Array.isArray(arr)) {
      for (const n of arr) { n.vx = 0; n.vy = 0; }
    }
  } catch {}
}

// ---------------------------- Zoom / Pan / Fit -----------------------------
  useEffect(() => {
    const svg = d3.select(svgRef.current);
    const zoom = d3.zoom()
      .scaleExtent([0.2, 5])
      .on("zoom", (event) => {
        setZoomTransform(event.transform);
      });
    zoomBehaviorRef.current = zoom;
    svg.call(zoom);
    // Double-click to reset zoom
    svg.on("dblclick.zoom", null); // disable default dblclick zoom
    svg.on("dblclick", () => resetZoom());
    return () => svg.on(".zoom", null);
  }, []);

  function resetZoom() {
    const svg = d3.select(svgRef.current);
    const zoom = zoomBehaviorRef.current; if (!zoom) return;
    svg.transition().duration(250).call(zoom.transform, d3.zoomIdentity);
  }
  function zoomIn() {
    const svg = d3.select(svgRef.current);
    const zoom = zoomBehaviorRef.current; if (!zoom) return;
    svg.transition().duration(200).call(zoom.scaleBy, 1.2);
  }
  function zoomOut() {
    const svg = d3.select(svgRef.current);
    const zoom = zoomBehaviorRef.current; if (!zoom) return;
    svg.transition().duration(200).call(zoom.scaleBy, 1 / 1.2);
  }
  function fitToView() {
    if (!nodes.length) return resetZoom();
    // Compute bounds from node centers + radii
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
    const zoom = zoomBehaviorRef.current; if (!zoom) return;
    svg.transition().duration(250).call(zoom.transform, d3.zoomIdentity.translate(tx, ty).scale(k));
  }

  // ---------------------------- Fullscreen -----------------------------------
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

  // ---------------------------- Render ---------------------------------------
  const dashFor = (type) => (styles[type].dashed ? `${styles[type].width * 2} ${styles[type].width * 2}` : undefined);
  const markerUrl = (type, kind) => {
    const st = styles[type];
    const shape = kind === "start" ? st.headStart : st.headEnd;
    if (shape === "none") return undefined;
    return `url(#${markerId(kind, `${shape}-${type}`, st.color)})`;
  };
  const selectedNode = nodes.find((n) => n.id === selectedNodeId) || null;

  const liveBg = (function () {
    if (liveBgMode === "transparent") return "transparent";
    if (liveBgMode === "white") return "#ffffff";
    return liveBgCustom || THEME.surface;
  })();

  return (
    <div
      className="w-full min-h-screen"
      style={{ background: THEME.bg, color: THEME.text }}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
    >
      {/* Global styles to make color inputs smooth rounded pills */}
      <style data-ignore-export>{`
        input[type="color"] {
          -webkit-appearance: none;
          appearance: none;
          border: 1px solid ${THEME.border};
          width: 32px; height: 28px;
          border-radius: 9999px; /* smooth, no sharp corners */
          padding: 0;
          background: transparent;
          cursor: pointer;
        }
        input[type="color"]::-webkit-color-swatch-wrapper {
          padding: 0; border-radius: 9999px;
        }
        input[type="color"]::-webkit-color-swatch {
          border: none; border-radius: 9999px;
        }
        input[type="color"]::-moz-color-swatch {
          border: none; border-radius: 9999px;
        }
      `}</style>

      {/* Toolbar */}
      
      {/* Changelog banner */}
      {showChangelog && (
        <div className="bg-[#0f1b2d] border-b border-[#1f3a5f] py-2">
          <div className="mx-auto max-w-[1400px] px-4 flex items-start gap-3">
            <div className="text-xs font-semibold">
              Bubble Diagram Builder updated to v{APP_VERSION}
            </div>
            <ul className="text-xs list-disc pl-5 space-y-0.5">
              {CHANGELOG_ITEMS.map((t,i)=>(<li key={i}>{t}</li>))}
            </ul>
            <button
              className="ml-auto px-2 py-1 text-xs rounded-md border border-[#2a2a3a] hover:bg-white/5"
              onClick={()=>setShowChangelog(false)}>
              Dismiss
            </button>
          </div>
        </div>
      )}
<div className="sticky top-0 z-10 backdrop-blur bg-black/30 border-b border-[#2a2a3a]">
        <div className="mx-auto max-w-[1400px] px-4 py-3 grid grid-cols-1 md:grid-cols-2 gap-3 auto-rows-min items-start">
          <div className="font-semibold tracking-wide text-sm text-[#9aa0a6]">Bubble Diagram Builder</div>

          <div className="ml-auto flex flex-wrap items-center gap-2">
            
            <div className="col-span-2 text-[10px] uppercase tracking-[0.14em] text-[#9aa0a6]/80 mt-1">Modes & Actions</div>
{/* Modes */}
            <button className={`px-3 py-2 rounded-xl border ${mode === "select" ? "bg-white/10" : ""} border-[#2a2a3a] text-sm`} onClick={() => setMode("select")}>
              Select / Drag
            </button>
            <button className={`px-3 py-2 rounded-xl border ${mode === "connect" ? "bg-white/10" : ""} border-[#2a2a3a] text-sm`} onClick={() => setMode("connect")}>
              Connect
            </button>

            {/* Undo / Redo */}
            <button className="px-3 py-2 rounded-xl border border-[#2a2a3a] text-sm" onClick={undo}>Undo</button>
            <button className="px-3 py-2 rounded-xl border border-[#2a2a3a] text-sm" onClick={redo}>Redo</button>

            {/* Line style controls */}
            {["necessary", "ideal"].map((key) => (
              <div key={key} className="col-span-2 md:col-span-6 lg:col-span-4 flex items-center gap-2 border border-[#2a2a3a] rounded-xl px-3 py-2 text-xs">
                <span className="opacity-70 w-16 capitalize">{key}</span>
                <input type="color" value={styles[key].color} title={`${key} color`} onChange={(e) => setStyles((s) => ({ ...s, [key]: { ...s[key], color: e.target.value } }))} />
                <label className="flex items-center gap-1"><input type="checkbox" checked={styles[key].dashed} onChange={(e) => setStyles((s) => ({ ...s, [key]: { ...s[key], dashed: e.target.checked } }))} /> dashed</label>
                <label className="flex items-center gap-1">w
                  <input type="number" min={1} max={12} value={styles[key].width} className="w-14 bg-transparent border border-[#2a2a3a] rounded px-1 py-0.5" onChange={(e) => setStyles((s) => ({ ...s, [key]: { ...s[key], width: Math.max(1, Math.min(12, +e.target.value || 1)) } }))} />
                </label>
                <select className="bg-transparent border border-[#2a2a3a] rounded px-1 py-0.5" value={styles[key].headStart} onChange={(e) => setStyles((s) => ({ ...s, [key]: { ...s[key], headStart: e.target.value } }))}>
                  {HEAD_SHAPES.map((h) => (<option key={h} value={h}>{h}</option>))}
                </select>
                <span>→</span>
                <select className="bg-transparent border border-[#2a2a3a] rounded px-1 py-0.5" value={styles[key].headEnd} onChange={(e) => setStyles((s) => ({ ...s, [key]: { ...s[key], headEnd: e.target.value } }))}>
                  {HEAD_SHAPES.map((h) => (<option key={h} value={h}>{h}</option>))}
                </select>
                <button className={`ml-2 px-2 py-1 rounded-md border border-[#2a2a3a] ${currentLineType === key ? "bg-white/10" : ""}`} onClick={() => setCurrentLineType(key)}>Use</button>
              </div>
            ))}

            
            <div className="col-span-2 text-[10px] uppercase tracking-[0.14em] text-[#9aa0a6]/80 mt-1">Bubbles</div>
{/* Bubble (node) bulk styles */}
            <div className="col-span-2 md:col-span-6 lg:col-span-4 flex items-center gap-2 border border-[#2a2a3a] rounded-xl px-3 py-2 text-xs">
              <span className="opacity-70">Bubbles:</span>
              <label className="flex items-center gap-1">Fill
                <input type="color" value={bulkFill} onChange={(e) => setBulkFill(e.target.value)} disabled={bulkFillTransparent} />
              </label>
              <label className="flex items-center gap-1"><input type="checkbox" checked={bulkFillTransparent} onChange={(e) => setBulkFillTransparent(e.target.checked)} /> transparent</label>
              <label className="flex items-center gap-1">Border
                <input type="color" value={bulkStroke} onChange={(e) => setBulkStroke(e.target.value)} />
              </label>
              <label className="flex items-center gap-1">w
                <input type="number" min={1} max={12} value={bulkStrokeWidth} className="w-14 bg-transparent border border-[#2a2a3a] rounded px-1 py-0.5" onChange={(e) => setBulkStrokeWidth(Math.max(1, Math.min(12, +e.target.value || 1)))} />
              </label>
              <button className="px-2 py-1 rounded-md border border-[#2a2a3a]" onClick={applyBulkBubbleStyles}>Apply to all</button>
            </div>

            {/* Text (label) bulk styles */}
            <div className="col-span-2 md:col-span-6 lg:col-span-4 flex items-center gap-2 border border-[#2a2a3a] rounded-xl px-3 py-2 text-xs">
              <span className="opacity-70">Labels:</span>
              <select className="bg-transparent border border-[#2a2a3a] rounded px-1 py-0.5" value={bulkTextFont} onChange={(e) => setBulkTextFont(e.target.value)}>
                <option value={FONT_STACKS.Outfit}>Outfit</option>
                <option value={FONT_STACKS.Inter}>Inter</option>
                <option value={FONT_STACKS.Poppins}>Poppins</option>
                <option value={FONT_STACKS.Roboto}>Roboto</option>
                <option value={FONT_STACKS.System}>system-ui</option>
                <option value={FONT_STACKS.HelveticaNowCondensed}>Helvetica Now Condensed (if available)</option>
              </select>
              <input type="color" value={bulkTextColor} onChange={(e) => setBulkTextColor(e.target.value)} />
              <label className="flex items-center gap-1">size
                <input type="number" min={TEXT_MIN} max={TEXT_MAX} value={bulkTextSize} className="w-14 bg-transparent border border-[#2a2a3a] rounded px-1 py-0.5" onChange={(e) => setBulkTextSize(clampTextSize(e.target.value))} />
              </label>
              <button className="px-2 py-1 rounded-md border border-[#2a2a3a]" onClick={applyBulkTextStyles}>Apply to all</button>
            </div>

            
            <div className="col-span-2 text-[10px] uppercase tracking-[0.14em] text-[#9aa0a6]/80 mt-1">Export Background</div>
{/* Export background */}
            <div className="col-span-2 md:col-span-6 lg:col-span-4 flex items-center gap-2 border border-[#2a2a3a] rounded-xl px-3 py-2 text-xs">
              <span className="opacity-70">Export BG:</span>
              <label className="flex items-center gap-1"><input type="radio" name="bg-exp" checked={exportBgMode === "transparent"} onChange={() => setExportBgMode("transparent")} /> transparent</label>
              <label className="flex items-center gap-1"><input type="radio" name="bg-exp" checked={exportBgMode === "white"} onChange={() => setExportBgMode("white")} /> white</label>
              <label className="flex items-center gap-1"><input type="radio" name="bg-exp" checked={exportBgMode === "custom"} onChange={() => setExportBgMode("custom")} /> custom</label>
              <input type="color" value={exportBgCustom} onChange={(e) => setExportBgCustom(e.target.value)} disabled={exportBgMode !== "custom"} />
            </div>

            
            <div className="col-span-2 text-[10px] uppercase tracking-[0.14em] text-[#9aa0a6]/80 mt-1">Live Background</div>
{/* Live background */}
            <div className="col-span-2 md:col-span-6 lg:col-span-4 flex items-center gap-2 border border-[#2a2a3a] rounded-xl px-3 py-2 text-xs">
              <span className="opacity-70">Live BG:</span>
              <label className="flex items-center gap-1"><input type="radio" name="bg-live" checked={liveBgMode === "transparent"} onChange={() => setLiveBgMode("transparent")} /> transparent</label>
              <label className="flex items-center gap-1"><input type="radio" name="bg-live" checked={liveBgMode === "white"} onChange={() => setLiveBgMode("white")} /> white</label>
              <label className="flex items-center gap-1"><input type="radio" name="bg-live" checked={liveBgMode === "custom"} onChange={() => setLiveBgMode("custom")} /> custom</label>
              <input type="color" value={liveBgCustom} onChange={(e) => setLiveBgCustom(e.target.value)} disabled={liveBgMode !== "custom"} />
            </div>

            
            <div className="col-span-2 text-[10px] uppercase tracking-[0.14em] text-[#9aa0a6]/80 mt-1">Spacing & Overlap</div>
{/* Buffer */}
            <div className="col-span-2 md:col-span-6 lg:col-span-4 flex items-center gap-2 border border-[#2a2a3a] rounded-xl px-3 py-2 text-xs">
              <span className="opacity-70">Buffer:</span>
              <input type="range" min={0} max={80} step={1} value={buffer} onChange={(e) => setBuffer(+e.target.value)} />
              <input type="number" min={0} max={80} value={buffer} className="w-16 bg-transparent border border-[#2a2a3a] rounded px-1 py-0.5" onChange={(e) => setBuffer(Math.max(0, Math.min(80, +e.target.value || 0)))} />
              <span className="opacity-70">px</span>
            </div>

            {/* NEW: Arrow Overlap */}
            <div className="col-span-2 md:col-span-6 lg:col-span-4 flex items-center gap-2 border border-[#2a2a3a] rounded-xl px-3 py-2 text-xs">
              <span className="opacity-70">Arrow overlap:</span>
              <input type="range" min={0} max={60} step={1} value={arrowOverlap} onChange={(e) => setArrowOverlap(+e.target.value)} />
              <input type="number" min={0} max={200} value={arrowOverlap} className="w-16 bg-transparent border border-[#2a2a3a] rounded px-1 py-0.5" onChange={(e) => setArrowOverlap(Math.max(0, Math.min(200, +e.target.value || 0)))} />
              <span className="opacity-70">px</span>
            </div>

            {/* NEW: Rotation Sensitivity */}
            <div className="col-span-2 md:col-span-6 lg:col-span-4 flex items-center gap-2 border border-[#2a2a3a] rounded-xl px-3 py-2 text-xs">
              <span className="opacity-70">Rotation sensitivity:</span>
              <input type="range" min={0} max={100} step={1} value={rotationSensitivity} onChange={(e) => setRotationSensitivity(+e.target.value)} />
              <input type="number" min={0} max={100} value={rotationSensitivity} className="w-16 bg-transparent border border-[#2a2a3a] rounded px-1 py-0.5" onChange={(e) => setRotationSensitivity(Math.max(0, Math.min(100, +e.target.value || 0)))} />
              <span className="opacity-70">%</span>
            </div>
            {/* Measurements toggle */}
            <div className="col-span-2 md:col-span-6 lg:col-span-4 flex items-center gap-2 border border-[#2a2a3a] rounded-xl px-3 py-2 text-xs">
              <label className="flex items-center gap-1">
                <input type="checkbox" checked={showMeasurements} onChange={(e) => setShowMeasurements(e.target.checked)} />
                show m² labels
              </label>
            </div>


            {/* Graph actions */}
            <button className="px-3 py-2 rounded-xl border border-[#2a2a3a] text-sm" onClick={() => setPhysics((p) => !p)}>{physics ? "Physics: ON" : "Physics: OFF"}</button>
            <button className="px-3 py-2 rounded-xl border border-[#2a2a3a] text-sm" onClick={() => setNodes([...nodes])}>Re-Layout</button>

            
{/* Scenes */}
<div className="col-span-1 flex items-center gap-2 border border-[#2a2a3a] rounded-xl px-2 py-2 text-xs">
               <div className="col-span-2 text-[10px] uppercase tracking-[0.14em] text-[#9aa0a6]/80 mt-1">Scenes</div>             <span className="opacity-70">Scene:</span>
  <select className="bg-transparent border border-[#2a2a3a] rounded px-1 py-0.5"
          value={activeSceneId || ""}
          onChange={(e) => setActiveSceneId(e.target.value || null)}>
    <option value="">(none)</option>
    {scenes.map((s) => (<option key={s.id} value={s.id}>{s.name}</option>))}
  </select>
  <button className="px-2 py-1 rounded-md border border-[#2a2a3a]" onClick={() => {
    const nm = window.prompt("New scene name", `Scene ${scenes.length + 1}`);
    if (nm != null) addScene(nm);
  }}>Add</button>
  <button className="px-2 py-1 rounded-md border border-[#2a2a3a]" disabled={!activeSceneId} onClick={() => activeSceneId && applyScene(activeSceneId)}>Go</button>
  <button className="px-2 py-1 rounded-md border border-[#2a2a3a]" disabled={!activeSceneId} onClick={() => activeSceneId && updateScene(activeSceneId)}>Update</button>
  <button className="px-2 py-1 rounded-md border border-[#2a2a3a]" disabled={!activeSceneId} onClick={() => activeSceneId && deleteScene(activeSceneId)}>Delete</button>
</div>

            
            <div className="col-span-2 text-[10px] uppercase tracking-[0.14em] text-[#9aa0a6]/80 mt-1">View & Export</div>
{/* Zoom controls */}
            <div className="col-span-1 flex items-center gap-2 border border-[#2a2a3a] rounded-xl px-2 py-2 text-xs">
              <button className="px-2 py-1 rounded-md border border-[#2a2a3a]" onClick={zoomOut}>−</button>
              <button className="px-2 py-1 rounded-md border border-[#2a2a3a]" onClick={resetZoom}>Reset</button>
              <button className="px-2 py-1 rounded-md border border-[#2a2a3a]" onClick={fitToView}>Fit</button>
              <button className="px-2 py-1 rounded-md border border-[#2a2a3a]" onClick={zoomIn}>+</button>
            </div>

            {/* Fullscreen & Export */}
            <button className="px-3 py-2 rounded-xl border border-[#2a2a3a] text-sm" onClick={toggleFullscreen}>{isFullscreen ? "Exit Fullscreen" : "Fullscreen"}</button>
            <button className="px-3 py-2 rounded-xl border border-[#2a2a3a] text-sm" onClick={exportSVG}>Export SVG</button>
            <button className="px-3 py-2 rounded-xl border border-[#2a2a3a] text-sm" onClick={exportPNG}>Export PNG</button>
            <button className="px-3 py-2 rounded-xl border border-[#2a2a3a] text-sm" title="Ctrl/⌘ + S" onClick={saveJSON}>Save JSON</button>
            <button className="px-3 py-2 rounded-xl border border-[#2a2a3a] text-sm" onClick={saveJSONAs}>Save As…</button>
            <button className="px-3 py-2 rounded-xl border border-[#2a2a3a] text-sm" onClick={openJSON}>Open JSON…</button>
            <label className="px-3 py-2 rounded-xl border border-[#2a2a3a] text-sm cursor-pointer">Import JSON (fallback)
              <input className="hidden" type="file" accept="application/json" onChange={(e) => e.target.files && importJSON(e.target.files[0])} />
            </label>
          </div>
        </div>
      </div>

      {/* Panels */}
      <div className="mx-auto max-w-[1400px] px-4 mt-4 grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Input list */}
        <div className="col-span-1 bg-[#121220] rounded-2xl border border-[#2a2a3a] p-4">
          <div className="flex items-center justify-between gap-2 mb-2">
            <h2 className="text-sm font-semibold tracking-wide text-[#9aa0a6]">List of Spaces (name, area m²)</h2>
            <div className="flex gap-2">
              <button className="px-3 py-1.5 rounded-xl border border-[#2a2a3a] text-xs" onClick={() => setRawList(SAMPLE_TEXT)}>Load Sample</button>
              <button className="px-3 py-1.5 rounded-xl border border-[#2a2a3a] text-xs" onClick={onGenerate}>Generate Bubbles</button>
              <button className="px-3 py-1.5 rounded-xl border border-[#2a2a3a] text-xs" onClick={updateFromList}>Update from list</button>
              <label className="flex items-center gap-1 text-xs text-[#9aa0a6]"><input type="checkbox" checked={updateMatchMode==="name"} onChange={(e)=>setUpdateMatchMode(e.target.checked ? "name" : "index")} /> match by name (safer)</label>
              <label className="flex items-center gap-1 text-xs text-[#9aa0a6]">
                <input type="checkbox" checked={updateAreasFromList} onChange={(e)=>setUpdateAreasFromList(e.target.checked)} />
                also update areas
              </label>
            </div>
          </div>
          <textarea className="w-full min-h-[180px] text-sm bg-transparent border rounded-xl border-[#2a2a3a] p-3 outline-none" placeholder={`Example (one per line):
Match Admin Room, 90
VOD Review / Theater, 60`} value={rawList} onChange={(e) => setRawList(e.target.value)} />
          <p className="mt-2 text-xs text-[#9aa0a6]">Formats: <code>name, area</code> • <code>name - area</code> • <code>name area</code></p>
        </div>

        {/* Node Inspector (per-bubble styling) */}
        <div className="col-span-1 bg-[#121220] rounded-2xl border border-[#2a2a3a] p-4">
          <h2 className="text-sm font-semibold tracking-wide text-[#9aa0a6] mb-2">Node Inspector</h2>
          {!selectedNode ? (
            <div className="text-xs text-[#9aa0a6]">Click a bubble in <em>Select/Drag</em> mode to edit per-bubble styles.</div>
          ) : (
            <div className="space-y-3 text-sm">
              <div className="font-medium truncate" title={selectedNode.name}>{selectedNode.name}</div>
              <div className="grid grid-cols-2 gap-2">
                <InlineEditField label="Name" value={selectedNode.name} onChange={(v) => renameNode(selectedNode.id, v)} />
                <InlineEditField label="Area (m²)" value={String(selectedNode.area)} onChange={(v) => changeArea(selectedNode.id, v)} />
              </div>
              <div className="flex items-center gap-3 flex-wrap">
                <label className="flex items-center gap-2">Fill
                  <input type="color" value={selectedNode.fill === "none" ? "#000000" : selectedNode.fill} onChange={(e) => setNodeFill(selectedNode.id, e.target.value)} disabled={selectedNode.fill === "none"} />
                </label>
                <label className="flex items-center gap-2"><input type="checkbox" checked={selectedNode.fill === "none"} onChange={(e) => setNodeFill(selectedNode.id, e.target.checked ? "none" : bulkFill)} /> transparent</label>
                <label className="flex items-center gap-2">Border
                  <input type="color" value={selectedNode.stroke || bulkStroke} onChange={(e) => setNodeStroke(selectedNode.id, e.target.value)} />
                </label>
                <label className="flex items-center gap-1">w
                  <input type="number" min={1} max={12} value={selectedNode.strokeWidth ?? bulkStrokeWidth} className="w-16 bg-transparent border border-[#2a2a3a] rounded px-1 py-0.5" onChange={(e) => setNodeStrokeW(selectedNode.id, e.target.value)} />
                </label>
              </div>
              <div className="flex items-center gap-3 flex-wrap">
                <select className="bg-transparent border border-[#2a2a3a] rounded px-1 py-0.5" value={selectedNode.textFont || bulkTextFont} onChange={(e) => setNodeTextFont(selectedNode.id, e.target.value)}>
                  <option value={FONT_STACKS.Outfit}>Outfit</option>
                  <option value={FONT_STACKS.Inter}>Inter</option>
                  <option value={FONT_STACKS.Poppins}>Poppins</option>
                  <option value={FONT_STACKS.Roboto}>Roboto</option>
                  <option value={FONT_STACKS.System}>system-ui</option>
                  <option value={FONT_STACKS.HelveticaNowCondensed}>Helvetica Now Condensed (if available)</option>
                </select>
                <input type="color" value={selectedNode.textColor || bulkTextColor} onChange={(e) => setNodeTextColor(selectedNode.id, e.target.value)} />
                <label className="flex items-center gap-1">size
                  <input type="number" min={TEXT_MIN} max={TEXT_MAX} value={clampTextSize(selectedNode.textSize ?? bulkTextSize)} className="w-16 bg-transparent border border-[#2a2a3a] rounded px-1 py-0.5" onChange={(e) => setNodeTextSize(selectedNode.id, e.target.value)} />
                </label>
              </div>
              <div className="flex gap-2">
                <button className="px-2 py-1 rounded-md border border-[#2a2a3a] text-xs" onClick={() => setSelectedNodeId(null)}>Done</button>
                <button className="px-2 py-1 rounded-md border border-[#2a2a3a] text-xs" onClick={() => { setNodeFill(selectedNode.id, bulkFillTransparent ? "none" : bulkFill); setNodeStroke(selectedNode.id, bulkStroke); setNodeStrokeW(selectedNode.id, bulkStrokeWidth); setNodeTextFont(selectedNode.id, bulkTextFont); setNodeTextColor(selectedNode.id, bulkTextColor); setNodeTextSize(selectedNode.id, bulkTextSize); }}>Apply bulk defaults to this</button>
              </div>
            </div>
          )}
        </div>

        {/* Graph stats */}
        <div className="col-span-1 bg-[#121220] rounded-2xl border border-[#2a2a3a] p-4">
          <h2 className="text-sm font-semibold tracking-wide text-[#9aa0a6] mb-2">Current Graph</h2>
          <div className="text-xs text-[#9aa0a6]">{nodes.length} nodes • {links.length} links</div>
          <div className="mt-2 grid grid-cols-2 gap-2 text-xs max-h-[220px] overflow-auto">
            {nodes.map((n) => (
              <div key={n.id} className="border border-[#2a2a3a] rounded-lg p-2">
                <div className="truncate font-medium" title={n.name}>{n.name}</div>
                <div className="opacity-70">{n.area} m²</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Canvas */}
      <div className="mx-auto max-w-[1400px] px-4 my-4">
        <div ref={containerRef} className="relative rounded-2xl border border-[#2a2a3a] overflow-hidden" style={{ background: liveBg }}>
          <svg ref={svgRef} width={"100%"} height={700} viewBox={`-600 -350 1200 700`} className="block">
            <MarkerDefs styles={styles} />
            <g id="zoomable" transform={zoomTransform.toString()}>
              {/* Links */}
              {links.map((l) => {
                const s = nodes.find((n) => n.id === l.source); const t = nodes.find((n) => n.id === l.target);
                if (!s || !t) return null;
                const dx = (t.x - s.x), dy = (t.y - s.y); const dist = Math.hypot(dx, dy) || 1; const nx = dx / dist, ny = dy / dist;
                const rs = rOf(s.area), rt = rOf(t.area);

                // NEW: let arrow/line start & end move inside the circle by `arrowOverlap` (clamped per radius)
                const insetS = Math.max(0, Math.min(arrowOverlap, rs - 2));
                const insetT = Math.max(0, Math.min(arrowOverlap, rt - 6));

                const x1 = s.x + nx * (rs + 2 - insetS);
                const y1 = s.y + ny * (rs + 2 - insetS);
                const x2 = t.x - nx * (rt + 6 - insetT);
                const y2 = t.y - ny * (rt + 6 - insetT);

                const st = styles[l.type];
                return (
                  <g key={l.id} onDoubleClick={() => { pushHistory(); setLinks((p) => p.filter((x) => x.id !== l.id)); }} onClick={() => (lastClickedLinkRef.current = l.id)}>
                    <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={st.color} strokeWidth={st.width} strokeDasharray={dashFor(l.type)} markerStart={markerUrl(l.type, "start")} markerEnd={markerUrl(l.type, "end")} opacity={0.98} />
                  </g>
                );
              })}
              {/* Nodes */}
              {nodes.map((n) => {
                const r = rOf(n.area);
                const isSrc = linkSource === n.id && mode === "connect";
                const hi = hoverId === n.id || isSrc;
                const labelFont = n.textFont || bulkTextFont;
                const labelColor = n.textColor || bulkTextColor;
                const labelSize = clampTextSize(n.textSize ?? bulkTextSize);
                const areaSize = Math.max(TEXT_MIN, labelSize - 1);
                return (
                  <g
                    key={n.id}
                    transform={`translate(${n.x || 0},${n.y || 0})`}
                    onPointerDown={(e) => onPointerDownNode(e, n)}
                    onClick={() => handleConnect(n)}
                    onMouseEnter={() => setHoverId(n.id)}
                    onMouseLeave={() => setHoverId(null)}
                    style={{ cursor: mode === "connect" ? "crosshair" : "grab" }}
                  >
                    <circle r={r} fill={n.fill ?? (bulkFillTransparent ? "none" : bulkFill)} stroke={hi ? styles.necessary.color : (n.stroke || bulkStroke)} strokeWidth={n.strokeWidth ?? bulkStrokeWidth} />
                    <circle r={r - 2} fill="none" stroke="#2c2c3c" strokeWidth={1} />
                    
                    <text textAnchor="middle" dominantBaseline="middle" className="select-none"
                          style={{ fill: labelColor, fontSize: labelSize, fontWeight: 600, letterSpacing: 0.4, fontFamily: labelFont }}>
                      {(() => {
                        const pad = 10;
                        const maxW = Math.max(20, (r - pad) * 2);
                        const lines = wrapToWidth(n.name, labelFont, labelSize, maxW, 5);
                        const gap = Math.max(2, Math.round(labelSize * 0.2));
                        const total = lines.length * labelSize + (lines.length - 1) * gap;
                        const startY = -total / 2 + labelSize * 0.8;
                        return lines.map((line, i) => (
                          <tspan key={i} x={0} y={startY + i * (labelSize + gap)}>{line}</tspan>
                        ));
                      })()}
                    </text>

                    {showMeasurements && (


                    

                    <text y={r - 18} textAnchor="middle" style={{ fill: THEME.subtle, fontSize: areaSize, fontFamily: labelFont }}>
                      {n.area} m²
                    </text>


                    )}
                    <foreignObject x={-r} y={-18} width={r * 2} height={36} data-ignore-export>
                      <InlineEdit text={n.name} onChange={(val) => renameNode(n.id, val)} className="mx-auto text-center" />
                    </foreignObject>
                    <foreignObject x={-40} y={r - 22} width={80} height={26} data-ignore-export>
                      <InlineEdit text={`${n.area}`} onChange={(val) => changeArea(n.id, val)} className="text-center" />
                    </foreignObject>
                  </g>
                );
              })}
            </g>
          </svg>

          {/* Status pill (not exported) */}
          <div className="absolute left-3 bottom-3 text-xs text-[#9aa0a6] bg-black/30 rounded-full px-3 py-1" data-ignore-export>
            Mode: <span className="font-semibold text-white">{mode}</span>{mode === "connect" && linkSource && <span> • select a target…</span>}
            {selectedNode && <span> • Editing: <span className="text-white">{selectedNode.name}</span></span>}
          </div>
        </div>
      </div>

      {/* About section */}
      <div className="mx-auto max-w-[1400px] px-4 pb-16">
        <details className="bg-[#121220] rounded-2xl border border-[#2a2a3a] p-4">
          <summary className="cursor-pointer select-none text-sm font-semibold tracking-wide text-[#9aa0a6]">
            About this tool
          </summary>
          <div className="mt-3 text-sm leading-6 text-[#d8d8e2]">
            <p><strong>Authored by:</strong> Mark Jay O. Gooc — Architecture student, Batangas State University – TNEU (ARC‑5108)</p>
            <p className="opacity-80">Bubble Diagram Builder (React + D3). Version 4.3 — arrow overlap, rotation sensitivity, rounded color pickers, preset persistence, live background controls, zoom/pan, fullscreen, and improved exports.</p>
          </div>
        </details>
      </div>
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
        onDoubleClick={(e) => { e.stopPropagation(); setEditing(true); }}
        className={`pointer-events-auto select-none text-[11px] text-white/90 bg-transparent ${className}`}
        style={{ lineHeight: 1.2 }}
      >
        {/* double‑click to edit */}
      </div>
    );
  }
  return (
    <input
      autoFocus
      value={val}
      onChange={(e) => setVal(e.target.value)}
      onBlur={() => { onChange(val.trim()); setEditing(false); }}
      onKeyDown={(e) => {
        if (e.key === "Enter") { onChange(val.trim()); setEditing(false); }
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
        onKeyDown={(e) => { if (e.key === "Enter") onChange(val); }}
        className="bg-transparent border border-[#2a2a3a] rounded px-2 py-1 text-[12px] text-white"
      />
    </label>
  );
}

// Wrap long labels into tspans
function wrapText(text, max = 16) {
  const words = String(text).split(/\s+/); const lines = []; let cur = "";
  for (const w of words) {
    if ((cur + " " + w).trim().length > max) { if (cur) lines.push(cur); cur = w; }
    else { cur = (cur + " " + w).trim(); }
  }
  if (cur) lines.push(cur);
  return lines.slice(0, 5);
}
// --- Precise width-based SVG text wrapping (uses canvas measureText) ---------
const _measureCtx = (() => {
  try {
    const c = document.createElement("canvas");
    return c.getContext("2d");
  } catch { return null; }
})();

function measureWidth(s, fontFamily, fontPx) {
  const ctx = _measureCtx;
  if (!ctx) return String(s).length * fontPx * 0.6; // heuristic fallback
  ctx.font = `${Math.max(8, fontPx)}px ${fontFamily || "system-ui, Arial"}`;
  return ctx.measureText(String(s)).width;
}

/**
 * Wrap a label to a specific max pixel width using canvas text metrics.
 * - Breaks on spaces when possible.
 * - If a single word is too long, it hard-wraps by characters.
 * - Limits lines to maxLines (adds ellipsis if truncated).
 */
function wrapToWidth(label, fontFamily, fontPx, maxWidth, maxLines = 5) {
  const words = String(label).split(/\s+/).filter(Boolean);
  const lines = [];
  let cur = "";

  const pushLine = (s) => { if (s) lines.push(s); };

  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    if (!cur) {
      // If the word alone exceeds width, hard-wrap by chars
      if (measureWidth(w, fontFamily, fontPx) > maxWidth) {
        let buf = "";
        for (const ch of w) {
          if (measureWidth(buf + ch, fontFamily, fontPx) <= maxWidth) buf += ch;
          else { pushLine(buf); buf = ch; }
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

  // Ellipsize if too many words to fit
  if (lines.length > maxLines) {
    return lines.slice(0, maxLines - 1).concat([lines[maxLines - 1] + "…"]);
  }
  return lines;
}


// Smoke tests (console)
(function runSmokeTests() {
  try {
    const parsed = parseList("A, 10\ B 20\ C-30\ NoArea");
    console.assert(parsed.length === 4, "parseList length");
    console.assert(parsed[0].area === 10 && parsed[1].area === 20 && parsed[2].area === 30, "parseList areas");
    const r = scaleRadius(parsed);
    const r10 = r(10), r20 = r(20), r30 = r(30);
    console.assert(r10 <= r20 && r20 <= r30, "scaleRadius monotonic");
    console.assert(wrapText("one two three four five six seven eight nine ten", 4).length <= 5, "wrapText cap");
    console.assert(clampTextSize("16") === 16, "text size string→number");
    console.assert(clampTextSize(5) === TEXT_MIN, "text size min clamp");
    console.assert(clampTextSize(99) === TEXT_MAX, "text size max clamp");
  } catch (e) { console.warn("Smoke tests warning:", e); }
})();
