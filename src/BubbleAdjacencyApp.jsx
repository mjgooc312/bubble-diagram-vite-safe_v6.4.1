
import React, { useEffect, useMemo, useRef, useState } from "react";
import * as d3 from "d3";

/**
 * Bubble Diagram Builder – React + D3
 * v4.4 — Physics reset & calmer rotation
 *  • Reset Physics button (zeros velocities; doesn't kick simulation).
 *  • Rotation force re-tuned: slider is much calmer; 0 is truly zero.
 *  • When you toggle Physics OFF→ON, nodes stay still (no auto-restart).
 */

const THEME = { bg:"#0b0b12", surface:"#121220", text:"#e6e6f0", subtle:"#9aa0a6", border:"#2a2a3a" };
const BASE_R_MIN = 36, BASE_R_MAX = 120;
const TEXT_MIN = 9, TEXT_MAX = 28;

const FONT_STACKS = {
  Outfit: "Outfit, Inter, system-ui, Arial, sans-serif",
  Inter: "Inter, system-ui, Arial, sans-serif",
  Poppins: "Poppins, system-ui, Arial, sans-serif",
  Roboto: "Roboto, system-ui, Arial, sans-serif",
  System: "system-ui, Arial, sans-serif",
};

const SAMPLE_TEXT = `Officials / Referees Room, 120
Analyst / Data Room, 80
VOD Review / Theater, 60
Match Admin Room, 90
Competition Manager Office, 45
Briefing / Protest Room, 110
Player Warm-up Pods (Concourse), 130`;

const uid = () => Math.random().toString(36).slice(2, 9);
const toNumber = (v, f) => { const n = typeof v==="string" && v.trim()==="" ? NaN : Number(v); return Number.isFinite(n)?n:f; };
const clampTextSize = (v) => Math.max(TEXT_MIN, Math.min(TEXT_MAX, toNumber(v, 12)));
function parseList(text){
  return text.split(/\r?\n/).map(l=>l.trim()).filter(Boolean).map(line=>{
    const m=line.match(/^(.*?)[,|-]?\s*(\d+(?:\.\d+)?)\s*$/);
    return m?{id:uid(), name:m[1].trim(), area:parseFloat(m[2])}:{id:uid(), name:line, area:20};
  });
}
function scaleRadius(nodes){
  const sqrtAreas = nodes.map(n=>Math.sqrt(Math.max(1, n.area||1)));
  const min=d3.min(sqrtAreas) ?? 1, max=d3.max(sqrtAreas) ?? 1;
  return (area)=>{
    const v=Math.sqrt(Math.max(1, area||1));
    if(max===min) return BASE_R_MIN;
    return BASE_R_MIN + ((v-min)/(max-min))*(BASE_R_MAX-BASE_R_MIN);
  };
}

// -------------------- Calmer spin force --------------------------------------
function makeSpinForce(level /* 0..100 */) {
  let nodes = [];
  const base = 0.000003; // much smaller than before
  function force(alpha) {
    if (!level) return; // zero is truly zero
    const t = Math.max(0, Math.min(100, level)) / 100; // 0..1
    const k = base * (t*t) * alpha; // soft curve
    if (!k) return;
    for (const n of nodes) {
      const x = n.x || 0, y = n.y || 0;
      n.vx += -y * k;
      n.vy +=  x * k;
    }
  }
  force.initialize = (ns) => { nodes = ns; };
  return force;
}

// -------------------- Component ----------------------------------------------
export default function BubbleAdjacencyApp(){
  const [nodes, setNodes] = useState([]);
  const [links, setLinks] = useState([]);
  const [rawList, setRawList] = useState("");
  const [mode, setMode] = useState("select");
  const [currentLineType, setCurrentLineType] = useState("necessary");
  const [linkSource, setLinkSource] = useState(null);
  const [selectedNodeId, setSelectedNodeId] = useState(null);

  const [physics, setPhysics] = useState(true);
  const [buffer, setBuffer] = useState(6);
  const [arrowOverlap, setArrowOverlap] = useState(0);
  const [rotationSensitivity, setRotationSensitivity] = useState(0); // 0 = truly zero

  const [styles, setStyles] = useState({
    necessary: { color: "#8b5cf6", dashed: false, width: 3, headStart: "arrow", headEnd: "arrow" },
    ideal:      { color: "#facc15", dashed: true,  width: 3, headStart: "arrow", headEnd: "arrow" },
  });

  const [liveBgMode, setLiveBgMode] = useState("custom");
  const [liveBgCustom, setLiveBgCustom] = useState(THEME.surface);

  const svgRef = useRef(null);
  const simRef = useRef(null);
  const suppressNextRestartRef = useRef(false);
  const zoomBehaviorRef = useRef(null);
  const [zoomTransform, setZoomTransform] = useState(d3.zoomIdentity);

  const rOf = useMemo(()=>scaleRadius(nodes),[nodes]);

  // Simulation init once
  useEffect(()=>{
    const sim = d3.forceSimulation()
      .alphaDecay(0.05)
      .velocityDecay(0.30)
      .force("charge", d3.forceManyBody().strength(-80))
      .force("collide", d3.forceCollide().radius(d => (d.r || BASE_R_MIN) + buffer))
      .force("center", d3.forceCenter(0, 0))
      .force("spin", makeSpinForce(rotationSensitivity))
      .force("x", d3.forceX().strength(0.01)) // lower center strengths
      .force("y", d3.forceY().strength(0.01));
    simRef.current = sim;
    return ()=> sim.stop();
  }, []);

  // Update spin force when slider changes
  useEffect(()=>{
    const sim = simRef.current; if(!sim) return;
    sim.force("spin", makeSpinForce(rotationSensitivity));
  }, [rotationSensitivity]);

  // Build or update forces on changes
  useEffect(()=>{
    const sim = simRef.current; if(!sim) return;
    const nn = nodes.map(n => ({...n, r: rOf(n.area)}));
    const idMap = new Map(nn.map(n=>[n.id, n]));
    const linkObjs = links.map(l => ({...l, source: idMap.get(l.source), target: idMap.get(l.target)}));

    const linkForce = d3.forceLink(linkObjs)
      .id(d=>d.id)
      .distance(l => {
        const base = (l.source.r || BASE_R_MIN) + (l.target.r || BASE_R_MIN);
        const k = l.type === "necessary" ? 1.1 : 1.0;
        return base * 1.05 * k + 40 + buffer * 1.5;
      })
      .strength(l => l.type === "necessary" ? 0.45 : 0.22);

    sim.nodes(nn);
    sim.force("collide", d3.forceCollide().radius(d => (d.r || BASE_R_MIN) + buffer));
    sim.force("link", linkForce);

    if (physics) {
      if (suppressNextRestartRef.current) {
        suppressNextRestartRef.current = false;
        sim.alpha(0);
      } else {
        sim.alpha(0.5).restart();
      }
    } else {
      sim.stop();
    }

    const onTick = () => {
      setNodes(prev => prev.map(p => ({...p, ...idMap.get(p.id)})));
    };
    sim.on("tick", onTick);
    return () => sim.on("tick", null);
  }, [nodes.length, links, physics, rOf, buffer]);

  // Zoom / Pan
  useEffect(()=>{
    const svg = d3.select(svgRef.current);
    const zoom = d3.zoom().scaleExtent([0.2, 5]).on("zoom", (ev)=> setZoomTransform(ev.transform));
    zoomBehaviorRef.current = zoom;
    svg.call(zoom);
    return ()=> svg.on(".zoom", null);
  }, []);
  const resetZoom = ()=>{
    const svg = d3.select(svgRef.current);
    const zoom = zoomBehaviorRef.current; if(!zoom) return;
    svg.transition().duration(220).call(zoom.transform, d3.zoomIdentity);
  };
  const zoomIn  = ()=>{ const svg=d3.select(svgRef.current); const z=zoomBehaviorRef.current; if(!z) return; svg.transition().duration(200).call(z.scaleBy, 1.2); };
  const zoomOut = ()=>{ const svg=d3.select(svgRef.current); const z=zoomBehaviorRef.current; if(!z) return; svg.transition().duration(200).call(z.scaleBy, 1/1.2); };

  // Generate nodes
  function onGenerate(){
    const parsed = parseList(rawList || SAMPLE_TEXT);
    const angle = (2*Math.PI)/Math.max(1, parsed.length);
    const R = 260;
    const init = parsed.map((n,i)=>({
      ...n,
      x: Math.cos(i*angle)*R,
      y: Math.sin(i*angle)*R,
      fill: "#161625",
      stroke: "#2d2d3d",
      strokeWidth: 2,
      textFont: FONT_STACKS.Outfit,
      textColor: "#e6e6f0",
      textSize: 12,
    }));
    setNodes(init); setLinks([]);
  }

  // Handle connect
  function handleConnect(node){
    if(mode!=="connect") return;
    if(!linkSource) return setLinkSource(node.id);
    if(linkSource===node.id) return setLinkSource(null);
    setLinks(p => [...p, {id:uid(), source:linkSource, target:node.id, type:currentLineType}]);
    setLinkSource(null);
  }

  // Drag
  function onPointerDownNode(e, node){
    e.stopPropagation();
    setSelectedNodeId(node.id);
    try { e.currentTarget.setPointerCapture?.(e.pointerId); } catch {}
    const sim = simRef.current; sim?.alphaTarget(0.3).restart();
    node.fx = node.x; node.fy = node.y;
  }
  function onPointerMove(e){
    const svg = svgRef.current; if(!svg) return;
    if(!selectedNodeId) return;
    const pt = svg.createSVGPoint(); pt.x = e.clientX; pt.y = e.clientY;
    const screenCTM = svg.getScreenCTM(); if(!screenCTM) return;
    const loc = pt.matrixTransform(screenCTM.inverse());
    const inner = svg.querySelector("g#zoomable");
    const innerCTM = inner?.getCTM();
    const p = innerCTM ? new DOMPoint(loc.x, loc.y).matrixTransform(innerCTM.inverse()) : loc;
    setNodes(prev => prev.map(n => n.id===selectedNodeId ? {...n, x:p.x, y:p.y, fx:p.x, fy:p.y} : n));
  }
  function onPointerUp(){
    if(!selectedNodeId) return;
    setNodes(prev => prev.map(n => n.id===selectedNodeId ? {...n, fx:undefined, fy:undefined} : n));
    const sim = simRef.current; sim?.alphaTarget(0);
    setSelectedNodeId(null);
  }

  // Physics toggle with "stay still on enable"
  function togglePhysics(){
    const sim = simRef.current; if(!sim) return;
    if (physics) {
      sim.stop();
      sim.nodes().forEach(n => { n.vx = 0; n.vy = 0; n.fx = undefined; n.fy = undefined; });
      setPhysics(false);
    } else {
      suppressNextRestartRef.current = true;
      setPhysics(true);
      setTimeout(()=>{ sim.alpha(0); }, 0);
    }
  }

  // Reset physics button
  function resetPhysics(){
    const sim = simRef.current; if(!sim) return;
    sim.nodes().forEach(n => { n.vx = 0; n.vy = 0; n.fx = undefined; n.fy = undefined; });
    sim.alpha(0);
    setNodes(prev => prev.map(n => ({...n})));
  }

  // Re-layout (explicit kick)
  function relayout(){
    const sim = simRef.current; if(!sim) return;
    sim.alpha(0.8).restart();
  }

  const liveBg = liveBgMode==="transparent" ? "transparent" : (liveBgMode==="white" ? "#fff" : liveBgCustom);

  const selectedNode = nodes.find(n=>n.id===selectedNodeId) || null;
  const HEAD_SHAPES = ["none","arrow","circle","square","diamond","bar"];
  const sanitize = (c)=>String(c).replace(/[^a-zA-Z0-9]/g,"");
  const markerId = (kind, shape, color, k)=>`m-${k}-${kind}-${shape}-${sanitize(color)}`;

  return (
    <div className="w-full min-h-screen" style={{background:THEME.bg, color:THEME.text}}
      onPointerMove={onPointerMove} onPointerUp={onPointerUp}>
      <style>{`
        input[type="color"]{appearance:none;border:1px solid ${THEME.border};width:32px;height:28px;border-radius:9999px;background:transparent;cursor:pointer}
        input[type="color"]::-webkit-color-swatch-wrapper{padding:0;border-radius:9999px}
        input[type="color"]::-webkit-color-swatch{border:none;border-radius:9999px}
        input[type="color"]::-moz-color-swatch{border:none;border-radius:9999px}
      `}</style>

      <div className="sticky top-0 z-10 backdrop-blur bg-black/30 border-b border-[#2a2a3a]">
        <div className="mx-auto max-w-[1400px] px-4 py-3 flex flex-wrap items-center gap-2">
          <div className="font-semibold tracking-wide text-sm text-[#9aa0a6]">Bubble Diagram Builder v4.4</div>

          <div className="ml-auto flex flex-wrap items-center gap-2">
            <button className={`px-3 py-2 rounded-xl border ${mode==='select'?'bg-white/10':''} border-[#2a2a3a] text-sm`} onClick={()=>setMode('select')}>Select / Drag</button>
            <button className={`px-3 py-2 rounded-xl border ${mode==='connect'?'bg-white/10':''} border-[#2a2a3a] text-sm`} onClick={()=>setMode('connect')}>Connect</button>

            <button className="px-3 py-2 rounded-xl border border-[#2a2a3a] text-sm" onClick={togglePhysics}>
              {physics ? "Physics: ON" : "Physics: OFF"}
            </button>
            <button className="px-3 py-2 rounded-xl border border-[#2a2a3a] text-sm" onClick={resetPhysics}>Reset Physics</button>
            <button className="px-3 py-2 rounded-xl border border-[#2a2a3a] text-sm" onClick={relayout}>Re-Layout</button>

            <div className="flex items-center gap-2 border border-[#2a2a3a] rounded-xl px-3 py-2 text-xs">
              <span className="opacity-70">Buffer:</span>
              <input type="range" min={0} max={80} step={1} value={buffer} onChange={(e)=>setBuffer(+e.target.value)} />
              <input type="number" min={0} max={80} value={buffer} className="w-16 bg-transparent border border-[#2a2a3a] rounded px-1 py-0.5" onChange={(e)=>setBuffer(Math.max(0, Math.min(80, +e.target.value||0)))} />
              <span className="opacity-70">px</span>
            </div>

            <div className="flex items-center gap-2 border border-[#2a2a3a] rounded-xl px-3 py-2 text-xs">
              <span className="opacity-70">Rotation:</span>
              <input type="range" min={0} max={100} step={1} value={rotationSensitivity} onChange={(e)=>setRotationSensitivity(+e.target.value)} />
              <input type="number" min={0} max={100} value={rotationSensitivity} className="w-16 bg-transparent border border-[#2a2a3a] rounded px-1 py-0.5" onChange={(e)=>setRotationSensitivity(Math.max(0, Math.min(100, +e.target.value||0)))} />
              <span className="opacity-70">%</span>
            </div>

            <div className="flex items-center gap-2 border border-[#2a2a3a] rounded-xl px-3 py-2 text-xs">
              <span className="opacity-70">Arrow overlap:</span>
              <input type="range" min={0} max={60} step={1} value={arrowOverlap} onChange={(e)=>setArrowOverlap(+e.target.value)} />
              <input type="number" min={0} max={200} value={arrowOverlap} className="w-16 bg-transparent border border-[#2a2a3a] rounded px-1 py-0.5" onChange={(e)=>setArrowOverlap(Math.max(0, Math.min(200, +e.target.value||0)))} />
              <span className="opacity-70">px</span>
            </div>

            <div className="flex items-center gap-2 border border-[#2a2a3a] rounded-xl px-3 py-2 text-xs">
              <span className="opacity-70">Live BG:</span>
              <label className="flex items-center gap-1"><input type="radio" name="bg-live" checked={liveBgMode==='transparent'} onChange={()=>setLiveBgMode('transparent')} /> transparent</label>
              <label className="flex items-center gap-1"><input type="radio" name="bg-live" checked={liveBgMode==='white'} onChange={()=>setLiveBgMode('white')} /> white</label>
              <label className="flex items-center gap-1"><input type="radio" name="bg-live" checked={liveBgMode==='custom'} onChange={()=>setLiveBgMode('custom')} /> custom</label>
              <input type="color" value={liveBgCustom} onChange={(e)=>setLiveBgCustom(e.target.value)} disabled={liveBgMode!=='custom'} />
            </div>

            <button className="px-3 py-2 rounded-xl border border-[#2a2a3a] text-sm" onClick={onGenerate}>Generate Bubbles</button>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-[1400px] px-4 my-4">
        <div className="relative rounded-2xl border border-[#2a2a3a] overflow-hidden" style={{background: liveBg}}>
          <svg ref={svgRef} width={"100%"} height={700} viewBox="-600 -350 1200 700" className="block">
            <g id="zoomable" transform={zoomTransform.toString()}>
              {links.map(l=>{
                const s = nodes.find(n=>n.id===l.source), t = nodes.find(n=>n.id===l.target);
                if(!s||!t) return null;
                const dx=t.x-s.x, dy=t.y-s.y; const dist=Math.hypot(dx,dy)||1; const nx=dx/dist, ny=dy/dist;
                const rs=rOf(s.area), rt=rOf(t.area);
                const insetS=Math.max(0, Math.min(arrowOverlap, rs-2));
                const insetT=Math.max(0, Math.min(arrowOverlap, rt-6));
                const x1 = s.x + nx*(rs+2-insetS);
                const y1 = s.y + ny*(rs+2-insetS);
                const x2 = t.x - nx*(rt+6-insetT);
                const y2 = t.y - ny*(rt+6-insetT);
                const st = styles[l.type];
                const dash = st.dashed ? `${st.width*2} ${st.width*2}` : undefined;
                return (<line key={l.id} x1={x1} y1={y1} x2={x2} y2={y2} stroke={st.color} strokeWidth={st.width} strokeDasharray={dash}/>);
              })}
              {nodes.map(n=>{
                const r = rOf(n.area);
                return (
                  <g key={n.id} transform={`translate(${n.x||0},${n.y||0})`}
                    onPointerDown={(e)=>onPointerDownNode(e,n)}
                    onClick={()=>handleConnect(n)}
                    style={{cursor: mode==="connect" ? "crosshair" : "grab"}}>
                    <circle r={r} fill={n.fill||"#161625"} stroke={n.stroke||"#2d2d3d"} strokeWidth={n.strokeWidth??2}/>
                    <text textAnchor="middle" dominantBaseline="middle"
                      style={{fill:n.textColor||"#e6e6f0", fontSize:clampTextSize(n.textSize??12), fontWeight:600, fontFamily:n.textFont||FONT_STACKS.Outfit}}>
                      {wrapText(n.name, 16).map((line,i)=>(<tspan key={i} x={0} dy={i===0?-4:(clampTextSize(n.textSize??12)+2)}>{line}</tspan>))}
                    </text>
                    <text y={r-18} textAnchor="middle" style={{fill:THEME.subtle, fontSize:Math.max(TEXT_MIN,(n.textSize??12)-1), fontFamily:n.textFont||FONT_STACKS.Outfit}}>
                      {n.area} m²
                    </text>
                  </g>
                )
              })}
            </g>
          </svg>
          <div className="absolute right-3 bottom-3 flex gap-2">
            <button className="px-2 py-1 rounded-md border border-[#2a2a3a]" onClick={zoomOut}>−</button>
            <button className="px-2 py-1 rounded-md border border-[#2a2a3a]" onClick={resetZoom}>Reset</button>
            <button className="px-2 py-1 rounded-md border border-[#2a2a3a]" onClick={zoomIn}>+</button>
          </div>
        </div>
      </div>
    </div>
  );
}

function wrapText(text, max=16){
  const words=String(text).split(/\s+/); const lines=[]; let cur="";
  for(const w of words){
    if((cur+" "+w).trim().length>max){ if(cur) lines.push(cur); cur=w; }
    else { cur=(cur+" "+w).trim(); }
  }
  if(cur) lines.push(cur);
  return lines.slice(0,5);
}
