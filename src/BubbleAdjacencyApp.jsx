// BubbleAdjacencyApp.jsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import * as d3 from "d3";

/**
 * Bubble Diagram Builder – Force-directed (React + D3)
 * v4.8.1 — Framework matrix style integrated + minor fixes
 *
 * • Triangle Adjacency Matrix styled like the reference framework:
 *   angled label tabs on the left + upper-triangle grid with circular markers.
 * • Labels share the same font as the bubble labels (bulkTextFont).
 * • Show/Hide toggle in the dock and in Layout & Physics.
 * • InlineEdit now displays its value when not editing (previously blank).
 * • Links (with arrowheads) render above bubbles.
 */

const THEME = {
  bg: "#0b0b12",
  surface: "#121220",
  text: "#e6e6f0",
  subtle: "#9aa0a6",
  border: "#2a2a3a",
};

const BASE_R_MIN = 36;
const BASE_R_MAX = 120;
const TEXT_MIN = 9;
const TEXT_MAX = 28;

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

// --- Utils -------------------------------------------------------------------
const uid = () => Math.random().toString(36).slice(2, 9);
const pairKey = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`);
const toNumber = (v, fallback) => {
  const n = typeof v === "string" && v.trim() === "" ? NaN : Number(v);
  return Number.isFinite(n) ? n : fallback;
};
const norm = (s) => String(s || "").trim().toLowerCase().replace(/\s+/g, " ");
const clampTextSize = (v) =>
  Math.max(TEXT_MIN, Math.min(TEXT_MAX, Number.isFinite(+v) ? +v : 12));

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

// ---- Arrowheads -------------------------------------------------------------
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

// ---- Persistence ------------------------------------------------------------
const LS_KEY = "bubbleBuilder:v1";
const AUTOSAVE_KEY = "bubbleBuilder:autosave";
const loadPresets = () => {
  try {
    return JSON.parse(localStorage.getItem(LS_KEY) || "{}");
  } catch {
    return {};
  }
};
const savePresets = (obj) => {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(obj));
  } catch {}
};

// ---- Custom spin force ------------------------------------------------------
function makeSpinForce(level /* 0..100 */) {
  let nodes = [];
  const base = 0.0002;
  function force(alpha) {
    if (!level) return;
    const k = base * level * alpha;
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

// ---- Precise width measure for SVG text wrap & label widths -----------------
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

// ---- App --------------------------------------------------------------------
export default function BubbleAdjacencyApp() {
  // Graph
  const [nodes, setNodes] = useState([]);
  const [links, setLinks] = useState([]);

  // Selection
  const [selectedIds, setSelectedIds] = useState([]);
  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const [lasso, setLasso] = useState({ active: false, points: [] });

  // UI
  const [rawList, setRawList] = useState("");
  const [mode, setMode] = useState("select");
  const [currentLineType, setCurrentLineType] = useState("necessary");
  const [linkSource, setLinkSource] = useState(null);
  const [hoverId, setHoverId] = useState(null);
  const [selectedNodeId, setSelectedNodeId] = useState(null);

  // Layout / physics
  const [physics, setPhysics] = useState(true);
  const [buffer, setBuffer] = useState(6);
  const [arrowOverlap, setArrowOverlap] = useState(0);
  const [rotationSensitivity, setRotationSensitivity] = useState(0);
  const [showMeasurements, setShowMeasurements] = useState(true);

  // A11y
  const [highContrast, setHighContrast] = useState(false);

  // Legend
  const [showLegend, setShowLegend] = useState(true);
  const [legendPos, setLegendPos] = useState({ x: -560, y: -320 });
  const legendDragRef = useRef(null);

  // NEW: Triangle Matrix (canvas) toggle
  const [showTriMatrix, setShowTriMatrix] = useState(true);

  // Conflict detector
  const [expectedPairsText, setExpectedPairsText] = useState("");
  const [longFactor, setLongFactor] = useState(1.8);

  // Detangle pulse
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

  const [updateAreasFromList, setUpdateAreasFromList] = useState(false);
  const [updateMatchMode, setUpdateMatchMode] = useState("name");

  // Edge style presets
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

  // Backgrounds
  const [exportBgMode, setExportBgMode] = useState("transparent");
  const [exportBgCustom, setExportBgCustom] = useState("#ffffff");
  const [liveBgMode, setLiveBgMode] = useState("custom");
  const [liveBgCustom, setLiveBgCustom] = useState(THEME.surface);

  // Bulk bubble/label defaults
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
  const jsonHandleRef = useRef(null);

  // Zoom / Pan
  const zoomBehaviorRef = useRef(null);
  const [zoomTransform, setZoomTransform] = useState(d3.zoomIdentity);

  // Radius scale
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
    showLegend,
    legendPos,
    showTriMatrix,
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
    setShowLegend(prev.showLegend ?? true);
    if (prev.legendPos) setLegendPos(prev.legendPos);
    setShowTriMatrix(prev.showTriMatrix ?? true);
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
    setShowLegend(next.showLegend ?? true);
    if (next.legendPos) setLegendPos(next.legendPos);
    setShowTriMatrix(next.showTriMatrix ?? true);
  }

  // Presets load/save + autosave
  useEffect(() => {
    const p = loadPresets();
    if (!p) return;
    if (p.styles) setStyles((s) => ({ ...s, ...p.styles }));
    if (typeof p.buffer === "number") setBuffer(p.buffer);
    if (typeof p.arrowOverlap === "number") setArrowOverlap(p.arrowOverlap);
    if (typeof p.rotationSensitivity === "number")
      setRotationSensitivity(p.rotationSensitivity);
    if (typeof p.showLegend === "boolean") setShowLegend(p.showLegend);
    if (p.legendPos && typeof p.legendPos.x === "number" && typeof p.legendPos.y === "number")
      setLegendPos(p.legendPos);
    if (typeof p.showTriMatrix === "boolean") setShowTriMatrix(p.showTriMatrix);
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
    }
    if (p.exportBgMode) setExportBgMode(p.exportBgMode);
    if (p.exportBgCustom) setExportBgCustom(p.exportBgCustom);
    if (p.liveBgMode) setLiveBgMode(p.liveBgMode);
    if (p.liveBgCustom) setLiveBgCustom(p.liveBgCustom);
  }, []);

  useEffect(() => {
    const payload = {
      styles,
      buffer,
      arrowOverlap,
      rotationSensitivity,
      showLegend,
      legendPos,
      showTriMatrix,
      bulk: {
        bulkFill,
        bulkFillTransparent,
        bulkStroke,
        bulkStrokeWidth,
        bulkTextFont,
        bulkTextColor,
        bulkTextSize: clampTextSize(bulkTextSize),
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
    showLegend,
    legendPos,
    showTriMatrix,
    bulkFill,
    bulkFillTransparent,
    bulkStroke,
    bulkStrokeWidth,
    bulkTextFont,
    bulkTextColor,
    bulkTextSize,
    exportBgMode,
    exportBgCustom,
    liveBgMode,
    liveBgCustom,
    scenes,
    activeSceneId,
  ]);

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
  }, [nodes, links, styles, buffer, rotationSensitivity, arrowOverlap, showLegend, legendPos, showTriMatrix]);

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

  // D3 Simulation
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
    const nn = nodes.map((n) => ({
      ...n,
      r: rOf(n.area),
      fx: n.locked ? (n.fx ?? n.x ?? 0) : n.fx,
      fy: n.locked ? (n.fy ?? n.y ?? 0) : n.fy,
    }));

    const byPair = new Map();
    for (const l of links) {
      const k = pairKey(l.source, l.target);
      const prev = byPair.get(k);
      if (!prev) byPair.set(k, l);
      else if (prev.type !== "necessary" && l.type === "necessary")
        byPair.set(k, l);
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

  // Generate / Update from list
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
    setSelectedIds([]);
  }

  // Style helpers
  const selectOnly = (id) => setSelectedIds(id ? [id] : []);
  const toggleSelect = (id) =>
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  const clearSelection = () => setSelectedIds([]);
  const selectAll = () => setSelectedIds(nodes.map((n) => n.id));
  const deleteSelection = () => {
    if (!selectedIds.length) return;
    pushHistory();
    const set = new Set(selectedIds);
    setNodes((prev) => prev.filter((n) => !set.has(n.id)));
    setLinks((prev) => prev.filter((l) => !set.has(l.source) && !set.has(l.target)));
    setSelectedIds([]);
    if (selectedNodeId && set.has(selectedNodeId)) setSelectedNodeId(null);
  };

  // Dragging (group)
  const groupDragRef = useRef(null);
  const dragStartSnapshotRef = useRef(null);

  function svgToLocalPoint(svgEl, clientX, clientY) {
    if (!svgEl) return { x: clientX, y: clientY };
    const pt = svgEl.createSVGPoint();
    pt.x = clientX;
    pt.y = clientY;
    const screenCTM = svgEl.getScreenCTM();
    if (!screenCTM) return { x: clientX, y: clientY };
    const loc = pt.matrixTransform(screenCTM.inverse());
    const inner = svgEl.querySelector("g#zoomable");
    const innerCTM = inner?.getCTM();
    if (!innerCTM) return { x: loc.x, y: loc.y };
    const p = new DOMPoint(loc.x, loc.y).matrixTransform(innerCTM.inverse());
    return { x: p.x, y: p.y };
  }

  function onPointerDownNode(e, node) {
    e.stopPropagation();
    if (mode === "connect") return;

    if (e.ctrlKey || e.metaKey || e.shiftKey) toggleSelect(node.id);
    else if (!selectedSet.has(node.id)) selectOnly(node.id);

    setSelectedNodeId(node.id);

    const svg = svgRef.current;
    const pt = svgToLocalPoint(svg, e.clientX, e.clientY);
    const ids = selectedSet.has(node.id) ? [...selectedIds] : [node.id];
    const startPos = new Map();
    const dict = new Map(nodes.map((n) => [n.id, n]));
    ids.forEach((id) => {
      const n = dict.get(id);
      startPos.set(id, { x: n?.x || 0, y: n?.y || 0 });
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
    if (legendDragRef.current) {
      const svg = svgRef.current;
      const p = svgToLocalPoint(svg, e.clientX, e.clientY);
      const { offX, offY } = legendDragRef.current;
      setLegendPos({ x: p.x - offX, y: p.y - offY });
      return;
    }
    const drag = groupDragRef.current;
    if (!drag) return;
    const svg = svgRef.current;
    const { x, y } = svgToLocalPoint(svg, e.clientX, e.clientY);
    const dx = x - drag.start.x;
    const dy = y - drag.start.y;
    setNodes((prev) =>
      prev.map((n) =>
        drag.ids.includes(n.id)
          ? {
              ...n,
              x: drag.startPos.get(n.id).x + dx,
              y: drag.startPos.get(n.id).y + dy,
              fx: drag.startPos.get(n.id).x + dx,
              fy: drag.startPos.get(n.id).y + dy,
            }
          : n
      )
    );
  }

  function onPointerUp() {
    if (lasso.active) {
      finishLasso();
      return;
    }
    if (legendDragRef.current) {
      legendDragRef.current = null;
      return;
    }
    const drag = groupDragRef.current;
    if (!drag) return;
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
    groupDragRef.current = null;
    if (dragStartSnapshotRef.current)
      historyRef.current.push(dragStartSnapshotRef.current);
    dragStartSnapshotRef.current = null;
    simRef.current?.alphaTarget(0);
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
      sel.on(".zoom", null);
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
      p.map((n) => (n.id === id ? { ...n, textSize: clampTextSize(s) } : n))
    );
  }
  function setNodeTextFont(id, f) {
    pushHistory();
    setNodes((p) =>
      p.map((n) => (n.id === id ? { ...n, textFont: f } : n))
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

  // Keyboard shortcuts (undo, etc.)
  const lastClickedLinkRef = useRef(null);
  const [showHelp, setShowHelp] = useState(false);
  useEffect(() => {
    const onKey = (e) => {
      const k = e.key;
      if (k === "?" || (k === "/" && e.shiftKey)) {
        e.preventDefault();
        setShowHelp((v) => !v);
        return;
      }
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
      if (k === "a" && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        selectAll();
        return;
      }
      if (k === "Escape") {
        clearSelection();
        return;
      }
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
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedIds, selectedSet]);

  // Scenes (unchanged API)
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
  const getExportBg = () => {
    if (exportBgMode === "transparent") return null;
    if (exportBgMode === "white") return "#ffffff";
    return exportBgCustom || "#ffffff";
  };
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
      const rect = document.createElementNS(
        "http://www.w3.org/2000/svg",
        "rect"
      );
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
      },
      buffer,
      arrowOverlap,
      rotationSensitivity,
      showMeasurements,
      showLegend,
      legendPos,
      showTriMatrix,
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
          types: [{ description: "JSON files", accept: { "application/json": [".json"] } }],
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
          types: [{ description: "JSON files", accept: { "application/json": [".json"] } }],
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
          strokeWidth: Math.max(1, Math.min(12, toNumber(n.strokeWidth, bulkStrokeWidth))),
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
      }
      if (typeof d.buffer === "number") setBuffer(d.buffer);
      if (typeof d.arrowOverlap === "number") setArrowOverlap(d.arrowOverlap);
      if (typeof d.rotationSensitivity === "number")
        setRotationSensitivity(d.rotationSensitivity);
      if (typeof d.showMeasurements === "boolean")
        setShowMeasurements(d.showMeasurements);
      if (typeof d.showLegend === "boolean") setShowLegend(d.showLegend);
      if (d.legendPos && typeof d.legendPos.x === "number" && typeof d.legendPos.y === "number")
        setLegendPos(d.legendPos);
      if (typeof d.showTriMatrix === "boolean") setShowTriMatrix(d.showTriMatrix);
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
  useEffect(() => () => explodeTORef.current && clearTimeout(explodeTORef.current), []);

  // Zoom / Pan / Fit
  useEffect(() => {
    const svg = d3.select(svgRef.current);
    const zoom = d3
      .zoom()
      .scaleExtent([0.2, 5])
      .on("zoom", (event) => setZoomTransform(event.transform));
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
  function cycleLinkType(a, b) {
    const cur = getLinkTypeBetween(a, b);
    const next = cur === "none" ? "ideal" : cur === "ideal" ? "necessary" : "none";
    setLinkTypeBetween(a, b, next);
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

  // Render helpers
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
      : (liveBgCustom || THEME.surface);

  // Legend drag
  function onLegendPointerDown(e) {
    e.stopPropagation();
    const svg = svgRef.current;
    const p = svgToLocalPoint(svg, e.clientX, e.clientY);
    legendDragRef.current = { offX: p.x - legendPos.x, offY: p.y - legendPos.y };
    try {
      e.currentTarget.setPointerCapture?.(e.pointerId);
    } catch {}
  }

  return (
    <div
      className={`w-full min-h-screen ${highContrast ? "hc" : ""}`}
      style={{ background: THEME.bg, color: THEME.text }}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
    >
      {/* Global styles */}
      <style data-ignore-export>{`
        :root { color-scheme: dark; }
        * { scrollbar-width: thin; scrollbar-color: #3a3a4a #121220; }
        *::-webkit-scrollbar { height: 10px; width: 10px; }
        *::-webkit-scrollbar-thumb { background: #3a3a4a; border-radius: 8px; }
        *::-webkit-scrollbar-track { background: #121220; }

        input[type="color"] {
          -webkit-appearance: none; appearance: none;
          border: 1px solid ${THEME.border};
          width: 32px; height: 28px; border-radius: 9999px; padding: 0; background: transparent; cursor: pointer;
        }
        input[type="color"]::-webkit-color-swatch-wrapper { padding: 0; border-radius: 9999px; }
        input[type="color"]::-webkit-color-swatch, input[type="color"]::-moz-color-swatch { border: none; border-radius: 9999px; }

        .ui-select{
          background:#0f0f18; color:#e6e6f0; border:1px solid ${THEME.border};
          border-radius:10px; padding:6px 8px; font-size:13px; line-height:1.2; box-shadow:0 6px 18px rgba(0,0,0,.35);
        }
        .ui-select:focus{ outline:3px solid ${highContrast ? "#00D1FF" : "#8b5cf6"}; outline-offset:2px; }
        .ui-select option{ background:#0f0f18; color:#e6e6f0; }
        .ui-select option:checked, .ui-select option:hover{ background:#1b1b2a !important; color:#fff !important; }

        .card { background:#121220; border:1px solid ${THEME.border}; border-radius:16px; padding:14px; }
        .group-title { font-size:12px; letter-spacing:.06em; color:${THEME.subtle}; font-weight:600; }
        .btn {
          border:1px solid ${THEME.border}; border-radius:12px; padding:8px 12px; font-size:13px;
          background:transparent; color:${THEME.text};
        }
        .btn:hover { background:rgba(255,255,255,.06); }
        .btn:focus { outline:3px solid ${highContrast ? "#00D1FF" : "#8b5cf6"}; outline-offset:2px; }
        .btn-xs { padding:6px 10px; font-size:12px; border-radius:10px; }
        .dock-btn { width:38px; height:38px; display:flex; align-items:center; justify-content:center; border-radius:10px; }
        .hc .card { border-color:#8b5cf6; }
        .hc .btn:hover { background:rgba(255,255,255,.12); }
      `}</style>

      {/* Command bar */}
      <div className="sticky top-0 z-20 backdrop-blur bg-black/35 border-b border-[#2a2a3a]">
        <div className="mx-auto max-w-[1500px] px-4 py-3 flex items-center gap-3">
          <div className="text-sm font-semibold tracking-wide text-[#d6d6e2] flex items-center gap-2">
            Bubble Diagram Builder <span className="text-[11px] opacity-70">v1.0</span>
          </div>
          <div className="text-xs text-[#9aa0a6]">Design mode:</div>
          <div className="flex items-center gap-1" role="group" aria-label="Mode">
            <button className={`btn btn-xs ${mode === "select" ? "bg-white/10" : ""}`} onClick={() => setMode("select")} aria-pressed={mode === "select"}>Select/Drag</button>
            <button className={`btn btn-xs ${mode === "connect" ? "bg-white/10" : ""}`} onClick={() => setMode("connect")} aria-pressed={mode === "connect"}>Connect</button>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <button className="btn btn-xs" onClick={undo} aria-label="Undo">Undo</button>
            <button className="btn btn-xs" onClick={redo} aria-label="Redo">Redo</button>
            <button className="btn btn-xs" onClick={clearAll} aria-label="Clear all">Clear</button>
            <button className={`btn btn-xs ${highContrast ? "bg-white/10" : ""}`} onClick={() => setHighContrast((v) => !v)} aria-pressed={highContrast} title="High-contrast mode">HC</button>
            <button className="btn btn-xs" onClick={() => setShowHelp(true)} title="Cheatsheet (?)">?</button>
          </div>
        </div>
      </div>

      {/* Layout */}
      <div className="mx-auto max-w-[1500px] px-4 py-4 grid grid-cols-1 xl:grid-cols-12 gap-4">
        {/* Controls */}
        <div className="xl:col-span-5 space-y-4">
          <details open className="card">
            <summary className="cursor-pointer select-none group-title">Instructions</summary>
            <div className="mt-3 text-sm leading-6 text-[#d9d9e6]">
              <ol className="list-decimal pl-5 space-y-2">
                <li><b>Paste your spaces</b> in “Spaces” as <code>Name, area</code> then <b>Generate</b>.</li>
                <li><b>Select</b> a bubble to edit. <b>Ctrl/⌘-click</b> or <b>Shift-click</b> to multi-select; <b>Shift+drag</b> lasso.</li>
                <li>Use <b>Matrix</b> (triangle or table) to add/remove adjacencies. Clicking a cell cycles types.</li>
                <li>Arrows render <b>above</b> bubbles; export SVG/PNG includes legend + triangle matrix (if visible).</li>
              </ol>
            </div>
          </details>

          {/* Spaces */}
          <details open className="card">
            <summary className="cursor-pointer select-none group-title">Spaces (name, area m²)</summary>
            <div className="mt-3 space-y-2">
              <div className="flex flex-wrap gap-2">
                <button className="btn btn-xs" onClick={() => setRawList(SAMPLE_TEXT)}>Load sample</button>
                <button className="btn btn-xs" onClick={onGenerate}>Generate</button>
                <button className="btn btn-xs" onClick={updateFromList}>Update from list</button>
                <label className="text-xs text-[#9aa0a6] flex items-center gap-1">
                  <input type="checkbox" checked={updateMatchMode === "name"} onChange={(e) => setUpdateMatchMode(e.target.checked ? "name" : "index")} /> match by name
                </label>
                <label className="text-xs text-[#9aa0a6] flex items-center gap-1">
                  <input type="checkbox" checked={updateAreasFromList} onChange={(e) => setUpdateAreasFromList(e.target.checked)} /> also update areas
                </label>
              </div>
              <textarea
                className="w-full min-h-[160px] text-sm bg-transparent border rounded-xl border-[#2a2a3a] p-3 outline-none"
                placeholder={`Example (one per line):\nMatch Admin Room, 90\nVOD Review / Theater, 60`}
                value={rawList}
                onChange={(e) => setRawList(e.target.value)}
              />
            </div>
          </details>

          {/* Styles */}
          <details open className="card">
            <summary className="cursor-pointer select-none group-title">Styles</summary>
            <div className="mt-3 space-y-3">
              {["necessary", "ideal"].map((key) => (
                <div key={key} className="border border-[#2a2a3a] rounded-xl p-2">
                  <div className="text-xs opacity-80 mb-2 flex items-center gap-2">
                    <span className="capitalize">{key}</span>
                    <button className={`btn btn-xs ${currentLineType === key ? "bg-white/10" : ""}`} onClick={() => setCurrentLineType(key)}>Use</button>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <label className="flex items-center gap-1">Color
                      <input type="color" value={styles[key].color}
                        onChange={(e) => setStyles((s) => ({ ...s, [key]: { ...s[key], color: e.target.value } }))} />
                    </label>
                    <label className="flex items-center gap-1">
                      <input type="checkbox" checked={styles[key].dashed}
                        onChange={(e) => setStyles((s) => ({ ...s, [key]: { ...s[key], dashed: e.target.checked } }))} /> dashed
                    </label>
                    <label className="flex items-center gap-1">w
                      <input type="number" min={1} max={12} value={styles[key].width}
                        className="w-14 bg-transparent border border-[#2a2a3a] rounded px-1 py-0.5"
                        onChange={(e) => setStyles((s) => ({ ...s, [key]: { ...s[key], width: Math.max(1, Math.min(12, +e.target.value || 1)) } }))} />
                    </label>
                    <select className="ui-select" value={styles[key].headStart}
                      onChange={(e) => setStyles((s) => ({ ...s, [key]: { ...s[key], headStart: e.target.value } }))}>
                      {HEAD_SHAPES.map((h) => <option key={h} value={h}>{h}</option>)}
                    </select>
                    <span className="opacity-60">→</span>
                    <select className="ui-select" value={styles[key].headEnd}
                      onChange={(e) => setStyles((s) => ({ ...s, [key]: { ...s[key], headEnd: e.target.value } }))}>
                      {HEAD_SHAPES.map((h) => <option key={h} value={h}>{h}</option>)}
                    </select>
                  </div>
                </div>
              ))}

              {/* Bubbles & Labels (bulk) */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="border border-[#2a2a3a] rounded-xl p-2">
                  <div className="text-xs opacity-80 mb-2">Bubbles (bulk)</div>
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <label className="flex items-center gap-1">Fill
                      <input type="color" value={bulkFill}
                        onChange={(e) => setBulkFill(e.target.value)}
                        disabled={bulkFillTransparent} />
                    </label>
                    <label className="flex items-center gap-1">
                      <input type="checkbox" checked={bulkFillTransparent} onChange={(e) => setBulkFillTransparent(e.target.checked)} /> transparent
                    </label>
                    <label className="flex items-center gap-1">Border
                      <input type="color" value={bulkStroke} onChange={(e) => setBulkStroke(e.target.value)} />
                    </label>
                    <label className="flex items-center gap-1">w
                      <input type="number" min={1} max={12} value={bulkStrokeWidth}
                        className="w-14 bg-transparent border border-[#2a2a3a] rounded px-1 py-0.5"
                        onChange={(e) => setBulkStrokeWidth(Math.max(1, Math.min(12, +e.target.value || 1)))} />
                    </label>
                    <button
                      className="btn btn-xs"
                      onClick={() => {
                        setNodes((prev) =>
                          prev.map((n) => ({
                            ...n,
                            fill: bulkFillTransparent ? "none" : bulkFill,
                            stroke: bulkStroke,
                            strokeWidth: bulkStrokeWidth,
                          }))
                        );
                      }}
                    >
                      Apply to all
                    </button>
                  </div>
                </div>
                <div className="border border-[#2a2a3a] rounded-xl p-2">
                  <div className="text-xs opacity-80 mb-2">Labels (bulk)</div>
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <select className="ui-select" value={bulkTextFont} onChange={(e) => setBulkTextFont(e.target.value)}>
                      <option value={FONT_STACKS.Outfit}>Outfit</option>
                      <option value={FONT_STACKS.Inter}>Inter</option>
                      <option value={FONT_STACKS.Poppins}>Poppins</option>
                      <option value={FONT_STACKS.Roboto}>Roboto</option>
                      <option value={FONT_STACKS.System}>system-ui</option>
                      <option value={FONT_STACKS.HelveticaNowCondensed}>Helvetica Now Condensed</option>
                    </select>
                    <input type="color" value={bulkTextColor} onChange={(e) => setBulkTextColor(e.target.value)} />
                    <label className="flex items-center gap-1">size
                      <input type="number" min={TEXT_MIN} max={TEXT_MAX} value={bulkTextSize}
                        className="w-14 bg-transparent border border-[#2a2a3a] rounded px-1 py-0.5"
                        onChange={(e) => setBulkTextSize(clampTextSize(e.target.value))} />
                    </label>
                  </div>
                </div>
              </div>

              {/* Backgrounds */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="border border-[#2a2a2a] rounded-xl p-2">
                  <div className="text-xs opacity-80 mb-2">Export background</div>
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <label className="flex items-center gap-1"><input type="radio" name="bg-exp" checked={exportBgMode === "transparent"} onChange={() => setExportBgMode("transparent")} /> transparent</label>
                    <label className="flex items-center gap-1"><input type="radio" name="bg-exp" checked={exportBgMode === "white"} onChange={() => setExportBgMode("white")} /> white</label>
                    <label className="flex items-center gap-1"><input type="radio" name="bg-exp" checked={exportBgMode === "custom"} onChange={() => setExportBgMode("custom")} /> custom</label>
                    <input type="color" value={exportBgCustom} onChange={(e) => setExportBgCustom(e.target.value)} disabled={exportBgMode !== "custom"} />
                  </div>
                </div>
                <div className="border border-[#2a2a3a] rounded-xl p-2">
                  <div className="text-xs opacity-80 mb-2">Live background</div>
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <label className="flex items-center gap-1"><input type="radio" name="bg-live" checked={liveBgMode === "transparent"} onChange={() => setLiveBgMode("transparent")} /> transparent</label>
                    <label className="flex items-center gap-1"><input type="radio" name="bg-live" checked={liveBgMode === "white"} onChange={() => setLiveBgMode("white")} /> white</label>
                    <label className="flex items-center gap-1"><input type="radio" name="bg-live" checked={liveBgMode === "custom"} onChange={() => setLiveBgMode("custom")} /> custom</label>
                    <input type="color" value={liveBgCustom} onChange={(e) => setLiveBgCustom(e.target.value)} disabled={liveBgMode !== "custom"} />
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
                <input type="range" min={0} max={100} step={1} value={rotationSensitivity} onChange={(e) => setRotationSensitivity(+e.target.value)} />
                <input type="number" min={0} max={100} value={rotationSensitivity} className="w-16 bg-transparent border border-[#2a2a3a] rounded px-1 py-0.5"
                  onChange={(e) => setRotationSensitivity(Math.max(0, Math.min(100, +e.target.value || 0)))} />
                <span className="opacity-70">%</span>
              </div>

              {/* Legend + Triangle toggles */}
              <div className="flex items-center justify-between">
                <label className="text-xs flex items-center gap-2">
                  <input type="checkbox" checked={showLegend} onChange={(e) => setShowLegend(e.target.checked)} />
                  show legend (exportable)
                </label>
                <button className="btn btn-xs" onClick={() => setLegendPos({ x: -560, y: -320 })}>Reset legend position</button>
              </div>

              <div className="flex items-center justify-between">
                <label className="text-xs flex items-center gap-2">
                  <input type="checkbox" checked={showTriMatrix} onChange={(e) => setShowTriMatrix(e.target.checked)} />
                  show triangle matrix (canvas)
                </label>
                <label className="text-xs flex items-center gap-2">
                  <input type="checkbox" checked={showMeasurements} onChange={(e) => setShowMeasurements(e.target.checked)} />
                  show m² labels
                </label>
              </div>

              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <button className="btn btn-xs" onClick={() => setPhysics((p) => !p)}>{physics ? "Physics: ON" : "Physics: OFF"}</button>
                  <button className="btn btn-xs" onClick={() => setNodes([...nodes])}>Re-layout</button>
                  <button className="btn btn-xs" onClick={detanglePulse}>De-tangle</button>
                </div>
                {selectedIds.length > 0 && (
                  <div className="flex gap-2 text-xs">
                    <button className="btn btn-xs" onClick={() => pinSelection(true)}>Pin selection</button>
                    <button className="btn btn-xs" onClick={() => pinSelection(false)}>Unpin</button>
                    <button className="btn btn-xs" onClick={deleteSelection}>Delete selection</button>
                  </div>
                )}
              </div>
            </div>
          </details>

          {/* Editable MATRIX table */}
          <details className="card">
            <summary className="cursor-pointer select-none group-title">Adjacency Matrix (editable table)</summary>
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
                              <select className="ui-select w-full" value={t}
                                onChange={(e) => setLinkTypeBetween(r.id, c.id, e.target.value)}>
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
            </div>
          </details>

          {/* Conflicts */}
          <details className="card">
            <summary className="cursor-pointer select-none group-title">Conflict Detector</summary>
            <div className="mt-3 grid gap-3 text-sm">
              <div className="text-xs text-[#9aa0a6]">
                <b>Missing "necessary" adjacencies</b>: paste pairs <code>A - B</code> or <code>A, B</code>.
              </div>
              <textarea
                className="w-full min-h-[90px] text-sm bg-transparent border rounded-xl border-[#2a2a3a] p-3 outline-none"
                value={expectedPairsText}
                onChange={(e) => setExpectedPairsText(e.target.value)}
                placeholder={`Example:\nEvent Control Room - Broadcast & Media Core\nTech & Asset Management - Engineering & IT`}
              />
              <div className="text-xs flex items-center gap-2">
                <span className="opacity-70">Long link tolerance</span>
                <input type="range" min={1.0} max={3.0} step={0.1} value={longFactor} onChange={(e) => setLongFactor(+e.target.value)} />
                <span>{longFactor.toFixed(1)}× ideal</span>
              </div>
              <div className="text-xs"><span className="opacity-70">Long necessary links flagged:</span> <b>{longLinkIds.size}</b></div>
            </div>
          </details>

          {/* Export / Files */}
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
              <button className="btn btn-xs" onClick={() => {
                try {
                  const raw = localStorage.getItem(AUTOSAVE_KEY);
                  if (!raw) return alert("No autosave found.");
                  const saved = JSON.parse(raw);
                  parseAndLoadJSON(JSON.stringify(saved));
                } catch {
                  alert("Failed to restore autosave.");
                }
              }}>Restore autosave</button>
            </div>
          </details>
        </div>

        {/* Canvas */}
        <div className="xl:col-span-7">
          <div ref={containerRef} className="relative rounded-2xl border border-[#2a2a3a] overflow-hidden" style={{ background: liveBg }}>
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
                {/* Lasso */}
                {lasso.active && lasso.points.length > 1 && (
                  <polyline points={lasso.points.map((p) => `${p.x},${p.y}`).join(" ")} fill="none" stroke="#22c55e" strokeWidth={2} opacity={0.9} />
                )}
                {lasso.active && lasso.points.length > 2 && (
                  <polygon points={lasso.points.map((p) => `${p.x},${p.y}`).join(" ")} fill="#22c55e22" stroke="none" />
                )}

                {/* Bubbles under */}
                {nodes.map((n) => {
                  const r = rOf(n.area);
                  const isSrc = linkSource === n.id && mode === "connect";
                  const hi = hoverId === n.id || isSrc || selectedSet.has(n.id);
                  const labelFont = n.textFont || bulkTextFont;
                  const labelColor = n.textColor || bulkTextColor;
                  const labelSize = clampTextSize(n.textSize ?? bulkTextSize);
                  const areaSize = Math.max(TEXT_MIN, labelSize - 1);
                  const warnMissing = missingNodeIdSet.has(n.id);
                  return (
                    <g
                      key={n.id}
                      transform={`translate(${n.x || 0},${n.y || 0})`}
                      onPointerDown={(e) => onPointerDownNode(e, n)}
                      onClick={() => {
                        if (mode === "connect") {
                          if (!linkSource) setLinkSource(n.id);
                          else if (linkSource === n.id) setLinkSource(null);
                          else {
                            pushHistory();
                            setLinks((p) => [
                              ...removePairLinks(p, linkSource, n.id),
                              { id: uid(), source: linkSource, target: n.id, type: currentLineType },
                            ]);
                            setLinkSource(null);
                          }
                        }
                      }}
                      onMouseEnter={() => setHoverId(n.id)}
                      onMouseLeave={() => setHoverId(null)}
                      style={{ cursor: mode === "connect" ? "crosshair" : "grab" }}
                    >
                      {selectedSet.has(n.id) && (
                        <circle r={r + 5} fill="none" stroke="#60a5fa" strokeWidth={2} strokeDasharray="5 4" opacity={0.9} />
                      )}
                      {warnMissing && (
                        <circle r={r + 9} fill="none" stroke="#ef4444" strokeWidth={2} strokeDasharray="3 3" opacity={0.9} />
                      )}
                      <circle
                        r={r}
                        fill={n.fill ?? (bulkFillTransparent ? "none" : bulkFill)}
                        stroke={hi ? styles.necessary.color : (n.stroke || bulkStroke)}
                        strokeWidth={n.strokeWidth ?? bulkStrokeWidth}
                      />
                      <circle r={r - 2} fill="none" stroke="#2c2c3c" strokeWidth={1} />
                      {n.locked && <circle r={3} cx={r - 10} cy={-r + 10} fill="#22d3ee" />}

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
                          const lines = wrapToWidth(n.name, labelFont, labelSize, maxW, 5);
                          const gap = Math.max(2, Math.round(labelSize * 0.2));
                          const total = lines.length * labelSize + (lines.length - 1) * gap;
                          const startY = -total / 2 + labelSize * 0.8;
                          return lines.map((line, i) => (
                            <tspan key={i} x={0} y={startY + i * (labelSize + gap)}>
                              {line}
                            </tspan>
                          ));
                        })()}
                      </text>

                      {showMeasurements && (
                        <text y={r - 18} textAnchor="middle"
                          style={{ fill: THEME.subtle, fontSize: areaSize, fontFamily: labelFont }}>
                          {n.area} m²
                        </text>
                      )}

                      {/* Area inline editor */}
                      <foreignObject x={-40} y={r - 22} width={80} height={26} data-ignore-export
                        style={{ pointerEvents: mode === "connect" ? "none" : "auto" }}>
                        <InlineEdit text={`${n.area}`} onChange={(val) => changeArea(n.id, val)} className="text-center" />
                      </foreignObject>
                    </g>
                  );
                })}

                {/* LINKS above bubbles */}
                {links.map((l) => {
                  const s = nodes.find((n) => n.id === l.source);
                  const t = nodes.find((n) => n.id === l.target);
                  if (!s || !t) return null;
                  const dx = t.x - s.x, dy = t.y - s.y;
                  const dist = Math.hypot(dx, dy) || 1;
                  const nx = dx / dist, ny = dy / dist;
                  const rs = rOf(s.area), rt = rOf(t.area);

                  const insetS = Math.max(0, Math.min(arrowOverlap, rs - 2));
                  const insetT = Math.max(0, Math.min(arrowOverlap, rt - 6));

                  const x1 = s.x + nx * (rs + 2 - insetS);
                  const y1 = s.y + ny * (rs + 2 - insetS);
                  const x2 = t.x - nx * (rt + 6 - insetT);
                  const y2 = t.y - ny * (rt + 6 - insetT);

                  const st = styles[l.type];
                  const isLong = longLinkIds.has(l.id);

                  return (
                    <g key={l.id} onDoubleClick={() => {
                        pushHistory();
                        setLinks((p) => p.filter((x) => x.id !== l.id));
                      }}
                      onClick={() => (lastClickedLinkRef.current = l.id)}
                    >
                      <line
                        x1={x1} y1={y1} x2={x2} y2={y2}
                        stroke={st.color} strokeWidth={st.width}
                        strokeDasharray={dashFor(l.type)}
                        markerStart={markerUrl(l.type, "start")}
                        markerEnd={markerUrl(l.type, "end")}
                        opacity={0.98}
                      />
                      {isLong && l.type === "necessary" && (
                        <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="#ef4444"
                          strokeWidth={Math.max(2, st.width + 1)} strokeDasharray="6 3" opacity={0.9} data-ignore-export />
                      )}
                    </g>
                  );
                })}

                {/* Legend inside SVG */}
                {showLegend && (
                  <g transform={`translate(${legendPos.x},${legendPos.y})`} onPointerDown={onLegendPointerDown} style={{ cursor: "move" }}>
                    <rect x={0} y={0} width={260} height={84} rx={8} ry={8} fill="#0b0b12" opacity="0.85" stroke={THEME.border} />
                    <text x={12} y={18} fill="#e6e6f0" fontSize={12} fontWeight={600} fontFamily={bulkTextFont}>Legend</text>
                    <line x1={14} y1={36} x2={150} y2={36} stroke={styles.necessary.color} strokeWidth={styles.necessary.width}
                      strokeDasharray={dashFor("necessary")} markerStart={markerUrl("necessary", "start")} markerEnd={markerUrl("necessary", "end")} />
                    <text x={160} y={39} fill="#e6e6f0" fontSize={12} fontFamily={bulkTextFont}>Necessary</text>
                    <line x1={14} y1={62} x2={150} y2={62} stroke={styles.ideal.color} strokeWidth={styles.ideal.width}
                      strokeDasharray={dashFor("ideal")} markerStart={markerUrl("ideal", "start")} markerEnd={markerUrl("ideal", "end")} />
                    <text x={160} y={65} fill="#e6e6f0" fontSize={12} fontFamily={bulkTextFont}>Ideal</text>
                  </g>
                )}

                {/* Triangle Adjacency Matrix (framework style) */}
                {showTriMatrix && nodes.length > 1 && (
                  <TriMatrix
                    nodes={nodes}
                    getLinkTypeBetween={getLinkTypeBetween}
                    onCycle={(a, b) => cycleLinkType(a, b)}
                    liveBg={liveBg}
                    styles={styles}
                    fontFamily={bulkTextFont}
                    theme={THEME}
                  />
                )}
              </g>
            </svg>

            {/* Canvas dock (not exported) */}
            <div className="absolute right-3 top-3 flex flex-col gap-2" data-ignore-export>
              <div className="bg-black/35 backdrop-blur p-2 rounded-xl border border-[#2a2a3a] flex flex-col gap-2">
                <button className="dock-btn btn" title="Zoom out" onClick={zoomOut} aria-label="Zoom out">−</button>
                <button className="dock-btn btn" title="Reset view" onClick={resetZoom} aria-label="Reset view">⟲</button>
                <button className="dock-btn btn" title="Fit to view" onClick={fitToView} aria-label="Fit to view">⤢</button>
                <button className="dock-btn btn" title="Zoom in" onClick={zoomIn} aria-label="Zoom in">＋</button>
              </div>
              <div className="bg-black/35 backdrop-blur p-2 rounded-xl border border-[#2a2a3a] flex flex-col gap-2">
                <button className="dock-btn btn" onClick={() => setPhysics((p) => !p)} title="Toggle physics" aria-label="Toggle physics">{physics ? "⏸" : "▶"}</button>
                <button className="dock-btn btn" onClick={detanglePulse} title="De-tangle" aria-label="De-tangle">✺</button>
                <button className="dock-btn btn" onClick={() => setShowLegend((v) => !v)} title="Toggle legend" aria-label="Toggle legend">{showLegend ? "Lgnd✓" : "Lgnd"}</button>
                <button className="dock-btn btn" onClick={() => setShowTriMatrix((v) => !v)} title="Toggle triangle matrix" aria-label="Toggle triangle matrix">{showTriMatrix ? "△✓" : "△"}</button>
              </div>
              <div className="bg-black/35 backdrop-blur p-2 rounded-xl border border-[#2a2a3a] flex flex-col gap-2">
                <button className="dock-btn btn" onClick={exportSVG} aria-label="Export SVG">SVG</button>
                <button className="dock-btn btn" onClick={exportPNG} aria-label="Export PNG">PNG</button>
              </div>
            </div>

            {/* Status pill */}
            <div className="absolute left-3 bottom-3 text-xs text-[#9aa0a6] bg-black/30 rounded-full px-3 py-1" data-ignore-export>
              Mode: <span className="font-semibold text-white">{mode}</span>
              {mode === "connect" && linkSource && <span> • select a target…</span>}
              {selectedNode && <span> • Editing: <span className="text-white">{selectedNode.name}</span></span>}
              <span> • Line: <span className="text-white capitalize">{currentLineType}</span></span>
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

      {/* Cheatsheet */}
      {showHelp && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-50"
          role="dialog" aria-modal="true" onClick={() => setShowHelp(false)} data-ignore-export>
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
                <div><b>Double-click background</b>: Reset zoom</div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// --- Triangle Matrix component (angled labels + upper-tri grid) --------------
function TriMatrix({ nodes, getLinkTypeBetween, onCycle, liveBg, styles, fontFamily, theme }) {
  // Layout constants (tuned to match the framework reference)
  const cell = 24;          // square size
  const labelH = 22;        // label tab height
  const fs = 12;            // label font size
  const leftLine = 28;      // short line before label
  const padX = 12;          // gap between label tab and grid
  const start = { x: -560, y: 160 }; // anchor (below bubbles)

  // measure label widths (same font as bubbles)
  const widths = nodes.map((n) =>
    Math.max(72, Math.min(260, Math.round(measureWidth(n.name, fontFamily, fs) + 18)))
  );
  const maxW = widths.length ? Math.max(...widths) : 120;

  const gridX0 = start.x + leftLine + maxW + padX;
  const gridY0 = start.y;

  const N = nodes.length;

  return (
    <g>
      {/* Title on the right */}
      <text
        x={gridX0 + (N - 1) * cell + 18}
        y={gridY0 - 10}
        fill={theme.text}
        fontSize={14}
        fontFamily={fontFamily}
      >
        Adjacency Matrix
      </text>

      {/* Rows: left line + angled label tab + name; then upper-triangle cells */}
      {nodes.map((row, i) => {
        const y = gridY0 + i * cell;
        const tabW = widths[i];
        const tabY = y + cell / 2 - labelH / 2;

        return (
          <g key={row.id}>
            {/* short line before label */}
            <line
              x1={start.x}
              y1={tabY + labelH / 2}
              x2={start.x + leftLine}
              y2={tabY + labelH / 2}
              stroke={theme.text}
              strokeWidth={1}
              opacity={0.6}
            />
            {/* angled label tab (polygon) */}
            <path
              d={`M${start.x + leftLine},${tabY}
                 H${start.x + leftLine + tabW}
                 L${start.x + leftLine + tabW + 12},${tabY + labelH / 2}
                 L${start.x + leftLine + tabW},${tabY + labelH}
                 H${start.x + leftLine}
                 Z`}
              fill={liveBg}
              stroke={theme.border}
            />
            {/* label text */}
            <text
              x={start.x + leftLine + 8}
              y={tabY + labelH / 2}
              fill={theme.text}
              fontSize={fs}
              fontFamily={fontFamily}
              dominantBaseline="middle"
            >
              {row.name}
            </text>

            {/* upper-triangle cells: j > i */}
            {nodes.map((col, j) => {
              if (j <= i) return null;
              const x = gridX0 + j * cell - cell; // shift so first used column is at j=1
              const t = getLinkTypeBetween(row.id, col.id);
              const color =
                t === "necessary"
                  ? styles.necessary.color
                  : t === "ideal"
                  ? styles.ideal.color
                  : theme.subtle;

              const isNone = t === "none";
              const r = Math.floor(cell * 0.33);

              return (
                <g key={`${row.id}-${col.id}`} style={{ cursor: "pointer" }}
                   onClick={() => onCycle(row.id, col.id)}>
                  {/* cell square */}
                  <rect
                    x={x}
                    y={y}
                    width={cell}
                    height={cell}
                    fill="none"
                    stroke={theme.border}
                  />
                  {/* center marker circle */}
                  <circle
                    cx={x + cell / 2}
                    cy={y + cell / 2}
                    r={r}
                    fill={isNone ? "none" : color}
                    stroke={isNone ? theme.subtle : "none"}
                    strokeWidth={isNone ? 1.6 : 0}
                  />
                </g>
              );
            })}
          </g>
        );
      })}
    </g>
  );
}

// --- Small components --------------------------------------------------------
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
        style={{ lineHeight: 1.2, padding: "2px 4px", borderRadius: 6, border: "1px dashed transparent" }}
        title="Double-click to edit"
      >
        {String(val)}
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

function wrapToWidth(label, fontFamily, fontPx, maxWidth, maxLines = 5) {
  const words = String(label).split(/\s+/).filter(Boolean);
  const lines = [];
  let cur = "";
  const pushLine = (s) => s && lines.push(s);

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
