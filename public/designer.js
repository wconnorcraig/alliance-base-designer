// ============================================================
//  BASE DESIGNER — canvas engine
//  Exposes globals used by app.js: buildings, BUILDING_DEFS,
//  render(), updateCounts(), snapshot(), CELL
// ============================================================
const CELL = 32;
const GRID_SIZE = 1200;

const BUILDING_DEFS = {
  city:   { label:'City',   icon:'🏙️', size:2, color:'#2471a3', immovable:false, cat:'PLAYER BUILDINGS' },
  trap:   { label:'Trap',   icon:'🐻', size:3, color:'#1e8449', immovable:false, cat:'ALLIANCE BUILDINGS' },
  special:{ label:'Special',icon:'⭐', size:2, color:'#d4ac0d', immovable:false, cat:'ALLIANCE BUILDINGS' },
  banner: { label:'Banner', icon:'🏳', size:1, color:'#884ea0', immovable:false, cat:'ALLIANCE BUILDINGS' },
  hq:     { label:'HQ',     icon:'🏰', size:3, color:'#c0392b', immovable:false, cat:'ALLIANCE BUILDINGS' },
  mill:   { label:'Mill',   icon:'🍞', size:2, color:'#7d6608', immovable:true,  cat:'OBSTACLES (IMMOVABLE)' },
  wood:   { label:'Wood',   icon:'🪵', size:2, color:'#5d4037', immovable:true,  cat:'OBSTACLES (IMMOVABLE)' },
  quarry: { label:'Quarry', icon:'🪨', size:2, color:'#616a6b', immovable:true,  cat:'OBSTACLES (IMMOVABLE)' },
  mine:   { label:'Mine',   icon:'⛏️', size:2, color:'#2e4053', immovable:true,  cat:'OBSTACLES (IMMOVABLE)' },
  mtn1:   { label:'Mtn 1',  icon:'🏔️', size:1, color:'#5d5d5d', immovable:true,  cat:'MOUNTAINS' },
  mtn2:   { label:'Mtn 2',  icon:'🏔️', size:2, color:'#5d5d5d', immovable:true,  cat:'MOUNTAINS' },
  mtn3:   { label:'Mtn 3',  icon:'🏔️', size:3, color:'#5d5d5d', immovable:true,  cat:'MOUNTAINS' },
  mtn4:   { label:'Mtn 4',  icon:'🏔️', size:4, color:'#5d5d5d', immovable:true,  cat:'MOUNTAINS' },
  lake1:  { label:'Lake 1', icon:'🌊', size:1, color:'#1a5276', immovable:true,  cat:'LAKES' },
  lake2:  { label:'Lake 2', icon:'🌊', size:2, color:'#1a5276', immovable:true,  cat:'LAKES' },
  lake3:  { label:'Lake 3', icon:'🌊', size:3, color:'#1a5276', immovable:true,  cat:'LAKES' },
  lake4:  { label:'Lake 4', icon:'🌊', size:4, color:'#1a5276', immovable:true,  cat:'LAKES' },
};
const TIER_COLORS = ['#e74c3c','#e67e22','#f1c40f','#2ecc71','#3498db','#9b59b6'];

// ---- state ----
let buildings = [];
let nextId = 1;
let undoStack = [], redoStack = [];
let selectedType = null;
let colorMode = 'regular';
let vpX = 600*CELL - 580, vpY = 600*CELL - 380, zoom = 1.0;
let isPanning=false, panSX, panSY, panVX, panVY;
let isDragging=false, dragB=null, dragDX=0, dragDY=0;
let hoverB=null, mGx=600, mGy=600, clipboard=null;

const canvas = document.getElementById('grid-canvas');
const ctx = canvas.getContext('2d');
const wrap = document.getElementById('canvas-wrap');

function resize(){ canvas.width=wrap.clientWidth; canvas.height=wrap.clientHeight; render(); }
window.addEventListener('resize', resize);

// ---- coords ----
function s2w(sx,sy){ return { x: sx/zoom+vpX, y: sy/zoom+vpY }; }
function s2g(sx,sy){ const w=s2w(sx,sy); return { gx:Math.floor(w.x/CELL), gy:Math.floor(w.y/CELL) }; }
function g2s(gx,gy){ return { x:(gx*CELL-vpX)*zoom, y:(gy*CELL-vpY)*zoom }; }
function centerOn(gx,gy){ vpX=gx*CELL-(canvas.width/zoom)/2; vpY=gy*CELL-(canvas.height/zoom)/2; render(); }

// ---- undo ----
function snapshot(){ undoStack.push(JSON.stringify(buildings)); if(undoStack.length>80)undoStack.shift(); redoStack=[]; }
function undo(){ if(!undoStack.length)return; redoStack.push(JSON.stringify(buildings)); buildings=JSON.parse(undoStack.pop()); updateCounts(); render(); }
function redo(){ if(!redoStack.length)return; undoStack.push(JSON.stringify(buildings)); buildings=JSON.parse(redoStack.pop()); updateCounts(); render(); }

// ---- helpers ----
function bAt(gx,gy){ return buildings.find(b=>{ const d=BUILDING_DEFS[b.type]; return gx>=b.gx&&gx<b.gx+d.size&&gy>=b.gy&&gy<b.gy+d.size; }); }
function overlaps(gx,gy,size,ignoreId){
  for(const b of buildings){ if(b.id===ignoreId)continue; const d=BUILDING_DEFS[b.type];
    if(gx<b.gx+d.size && gx+size>b.gx && gy<b.gy+d.size && gy+size>b.gy) return true; }
  return false;
}
function placeBuilding(type,gx,gy){
  const d=BUILDING_DEFS[type];
  gx=Math.max(0,Math.min(GRID_SIZE-d.size,gx)); gy=Math.max(0,Math.min(GRID_SIZE-d.size,gy));
  if(overlaps(gx,gy,d.size,null)) return false;
  snapshot();
  buildings.push({ id:nextId++, type, gx, gy, label:'', tier:0, color:null });
  updateCounts(); render(); return true;
}

// ---- color resolution ----
function colorFor(b){
  const d=BUILDING_DEFS[b.type];
  if(colorMode==='manual' && b.color) return b.color;
  if(colorMode==='tier' && b.type==='city') return TIER_COLORS[(b.tier||0)%TIER_COLORS.length];
  if(colorMode==='distance' && b.type==='city'){
    const cx=600,cy=600, dist=Math.hypot((b.gx-cx),(b.gy-cy));
    const t=Math.min(1,dist/120); return `hsl(${120-t*120},70%,45%)`;
  }
  return d.color;
}

// ---- render ----
function render(){
  ctx.clearRect(0,0,canvas.width,canvas.height);
  const cs=CELL*zoom;
  // grid
  ctx.strokeStyle='#22304a'; ctx.lineWidth=1;
  const x0=Math.floor(vpX/CELL)*CELL, y0=Math.floor(vpY/CELL)*CELL;
  for(let gx=x0; (gx-vpX)*zoom<canvas.width; gx+=CELL){ const sx=(gx-vpX)*zoom; ctx.beginPath(); ctx.moveTo(sx,0); ctx.lineTo(sx,canvas.height); ctx.stroke(); }
  for(let gy=y0; (gy-vpY)*zoom<canvas.height; gy+=CELL){ const sy=(gy-vpY)*zoom; ctx.beginPath(); ctx.moveTo(0,sy); ctx.lineTo(canvas.width,sy); ctx.stroke(); }
  // buildings
  for(const b of buildings){
    const d=BUILDING_DEFS[b.type]; const p=g2s(b.gx,b.gy); const w=d.size*cs;
    if(p.x>canvas.width||p.y>canvas.height||p.x+w<0||p.y+w<0) continue;
    ctx.fillStyle=colorFor(b); ctx.fillRect(p.x+1,p.y+1,w-2,w-2);
    if(b===hoverB){ ctx.strokeStyle='#fff'; ctx.lineWidth=2; ctx.strokeRect(p.x+1,p.y+1,w-2,w-2); }
    if(b===dragB){ ctx.strokeStyle='#e94560'; ctx.lineWidth=2; ctx.strokeRect(p.x+1,p.y+1,w-2,w-2); }
    if(cs>14){ ctx.fillStyle='#fff'; ctx.font=`${Math.min(w*0.5,18)}px Segoe UI`; ctx.textAlign='center'; ctx.textBaseline='middle';
      ctx.fillText(d.icon,p.x+w/2,p.y+w/2-(cs>26?5:0)); }
    if(cs>26){ const cap=b.label||d.label; ctx.font='bold 9px Segoe UI'; ctx.fillStyle='#fff';
      ctx.fillText(cap.length>10?cap.slice(0,9)+'…':cap, p.x+w/2, p.y+w-8); }
  }
  // ghost preview
  if(selectedType){ const d=BUILDING_DEFS[selectedType]; const p=g2s(mGx,mGy); const w=d.size*cs;
    ctx.globalAlpha=0.4; ctx.fillStyle=overlaps(mGx,mGy,d.size,null)?'#e74c3c':d.color; ctx.fillRect(p.x+1,p.y+1,w-2,w-2); ctx.globalAlpha=1; }
  document.getElementById('stat-coords').textContent=`(${mGx}, ${mGy})`;
  document.getElementById('stat-bldgs').textContent=`${buildings.length} bldgs`;
}

// ---- counts ----
function updateCounts(){
  const c={}; for(const b of buildings) c[b.type]=(c[b.type]||0)+1;
  document.querySelectorAll('.building-btn').forEach(btn=>{
    const t=btn.dataset.type; const el=btn.querySelector('.bcount'); if(el) el.textContent='×'+(c[t]||0);
  });
}

// ---- build sidebar palette ----
function buildPalette(){
  const host=document.getElementById('buildings-section'); host.innerHTML='';
  let lastCat=null;
  for(const [type,d] of Object.entries(BUILDING_DEFS)){
    if(d.cat!==lastCat){ const h=document.createElement('div'); h.className='cat-label'; h.textContent=d.cat; host.appendChild(h); lastCat=d.cat; }
    const btn=document.createElement('button'); btn.className='building-btn'; btn.dataset.type=type;
    btn.innerHTML=`<span class="icon">${d.icon}</span><span><div class="bname">${d.label}</div><div class="bsize">${d.size}²</div></span><span class="bcount">×0</span>`;
    btn.onclick=()=>{ selectedType = selectedType===type ? null : type;
      document.querySelectorAll('.building-btn').forEach(x=>x.classList.remove('selected'));
      if(selectedType) btn.classList.add('selected');
      document.getElementById('stat-sel').textContent = selectedType?`Placing: ${d.label}`:''; };
    host.appendChild(btn);
  }
}

// ---- mouse ----
wrap.addEventListener('mousedown',e=>{
  if(e.target!==canvas) return;
  const r=canvas.getBoundingClientRect(); const sx=e.clientX-r.left, sy=e.clientY-r.top;
  const {gx,gy}=s2g(sx,sy);
  if(e.button===1 || e.shiftKey || (!selectedType && !bAt(gx,gy))){ isPanning=true; panSX=sx; panSY=sy; panVX=vpX; panVY=vpY; wrap.classList.add('grabbing'); return; }
  if(selectedType){ placeBuilding(selectedType,gx,gy); return; }
  const b=bAt(gx,gy); if(b){ const d=BUILDING_DEFS[b.type]; if(!d.immovable){ snapshot(); isDragging=true; dragB=b; dragDX=gx-b.gx; dragDY=gy-b.gy; } }
});
wrap.addEventListener('mousemove',e=>{
  const r=canvas.getBoundingClientRect(); const sx=e.clientX-r.left, sy=e.clientY-r.top;
  const {gx,gy}=s2g(sx,sy); mGx=gx; mGy=gy;
  if(isPanning){ vpX=panVX-(sx-panSX)/zoom; vpY=panVY-(sy-panSY)/zoom; render(); return; }
  if(isDragging&&dragB){ const ng=gx-dragDX, nh=gy-dragDY; const d=BUILDING_DEFS[dragB.type];
    if(!overlaps(ng,nh,d.size,dragB.id)){ dragB.gx=Math.max(0,Math.min(GRID_SIZE-d.size,ng)); dragB.gy=Math.max(0,Math.min(GRID_SIZE-d.size,nh)); } render(); return; }
  const nb=bAt(gx,gy); if(nb!==hoverB){ hoverB=nb; render(); } else if(selectedType){ render(); }
});
window.addEventListener('mouseup',()=>{ isPanning=false; isDragging=false; dragB=null; wrap.classList.remove('grabbing'); });
wrap.addEventListener('wheel',e=>{
  e.preventDefault(); const r=canvas.getBoundingClientRect(); const sx=e.clientX-r.left, sy=e.clientY-r.top;
  const w=s2w(sx,sy); const f=e.deltaY<0?1.1:0.9; zoom=Math.max(0.15,Math.min(4,zoom*f));
  vpX=w.x-sx/zoom; vpY=w.y-sy/zoom; render();
},{passive:false});
wrap.addEventListener('dblclick',e=>{
  const r=canvas.getBoundingClientRect(); const {gx,gy}=s2g(e.clientX-r.left,e.clientY-r.top);
  const b=bAt(gx,gy); if(b){ const n=prompt('Building name:',b.label||''); if(n!==null){ snapshot(); b.label=n; render(); } }
});

// ---- keyboard ----
window.addEventListener('keydown',e=>{
  if(document.activeElement.tagName==='INPUT') return;
  if(e.key==='Delete'||e.key==='Backspace'){ const b=bAt(mGx,mGy); if(b){ snapshot(); buildings=buildings.filter(x=>x!==b); updateCounts(); render(); } }
  if(e.ctrlKey&&e.key==='z'){ e.preventDefault(); undo(); }
  if(e.ctrlKey&&(e.key==='y'||(e.shiftKey&&e.key==='z'))){ e.preventDefault(); redo(); }
  if(e.ctrlKey&&e.key==='c'){ const b=bAt(mGx,mGy); if(b) clipboard={...b}; }
  if(e.ctrlKey&&e.key==='v'&&clipboard){ placeBuilding(clipboard.type,mGx,mGy); }
});

// ---- buttons ----
document.getElementById('btn-undo').onclick=undo;
document.getElementById('btn-redo').onclick=redo;
document.getElementById('btn-clear').onclick=()=>{ if(confirm('Clear all buildings?')){ snapshot(); buildings=[]; updateCounts(); render(); } };
document.getElementById('btn-reset').onclick=()=>{ if(confirm('Reset to default layout?')){ snapshot(); buildings=[]; nextId=1; loadDefault(); } };
document.getElementById('btn-go').onclick=()=>{ centerOn(+document.getElementById('navX').value||600,+document.getElementById('navY').value||600); };
document.getElementById('btn-focus').onclick=()=>{ if(buildings.length){ let sx=0,sy=0; buildings.forEach(b=>{sx+=b.gx;sy+=b.gy;}); centerOn(Math.round(sx/buildings.length),Math.round(sy/buildings.length)); } else centerOn(600,600); };
document.getElementById('pan-up').onclick=()=>{ vpY-=CELL*3; render(); };
document.getElementById('pan-down').onclick=()=>{ vpY+=CELL*3; render(); };
document.getElementById('pan-left').onclick=()=>{ vpX-=CELL*3; render(); };
document.getElementById('pan-right').onclick=()=>{ vpX+=CELL*3; render(); };
document.getElementById('pan-center').onclick=()=>centerOn(600,600);
document.getElementById('zoom-in').onclick=()=>{ zoom=Math.min(4,zoom*1.2); render(); };
document.getElementById('zoom-out').onclick=()=>{ zoom=Math.max(0.15,zoom*0.8); render(); };
document.getElementById('toggle-sidebar-btn').onclick=()=>{ const sb=document.getElementById('sidebar'); sb.classList.toggle('collapsed'); setTimeout(resize,220); };
document.querySelectorAll('.cmode-btn').forEach(btn=>btn.onclick=()=>{
  document.querySelectorAll('.cmode-btn').forEach(x=>x.classList.remove('active')); btn.classList.add('active');
  colorMode=btn.dataset.mode; document.getElementById('stat-mode').textContent='Mode: '+btn.textContent.replace(/^\S+\s/,''); render();
});

// ---- default layout (small starter base) ----
function loadDefault(){
  const add=(t,gx,gy)=>buildings.push({id:nextId++,type:t,gx,gy,label:'',tier:0,color:null});
  add('hq',599,599); add('trap',595,595); add('trap',604,604);
  for(let i=0;i<6;i++){ add('city',590+i*2,590); add('city',590+i*2,610); }
  add('banner',598,588); add('banner',603,612);
  updateCounts(); centerOn(600,600);
}

// ---- init ----
buildPalette(); resize(); loadDefault();
// app.js (loaded after) will overwrite the default with cloud data if present.
// ============================================================ end designer.js
