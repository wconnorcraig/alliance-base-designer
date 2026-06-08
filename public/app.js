// ============================================================
//  CLOUD + ROSTER + REDEMPTION + EXPORT layer
//  Depends on globals from designer.js:
//  buildings, BUILDING_DEFS, render, updateCounts, CELL
// ============================================================
const API = "/api";
const ALLIANCE_ID = new URLSearchParams(location.search).get("base") || "default";

// ---------- toast ----------
function toast(msg){
  const t=document.createElement("div");
  t.textContent=msg;
  t.style.cssText="position:fixed;bottom:20px;left:50%;transform:translateX(-50%);background:#16213e;border:1px solid #e94560;color:#fff;padding:10px 18px;border-radius:8px;z-index:9999;font-size:.8rem;max-width:80vw;text-align:center";
  document.body.appendChild(t); setTimeout(()=>t.remove(),3500);
}

// ---------- cloud save / load ----------
async function cloudSave(){
  const payload={ name:document.getElementById("designName").value, buildings };
  await fetch(`${API}/design?id=${encodeURIComponent(ALLIANCE_ID)}`,{ method:"PUT", body:JSON.stringify(payload) });
  toast("Saved ✓  Link: "+location.origin+"/?base="+ALLIANCE_ID);
}
async function cloudLoad(){
  try{
    const d=await (await fetch(`${API}/design?id=${encodeURIComponent(ALLIANCE_ID)}`)).json();
    if(d&&d.buildings){ buildings.length=0; d.buildings.forEach(b=>buildings.push(b));
      document.getElementById("designName").value=d.name||""; updateCounts(); applyRosterToTiles(); render();
      toast("Loaded design from cloud"); }
  }catch(e){ /* no saved design yet — keep default */ }
}

// ---------- roster ----------
let roster=[];
async function rosterLoad(){ try{ roster=await (await fetch(`${API}/roster?id=${ALLIANCE_ID}`)).json(); }catch(e){ roster=[]; } renderRoster(); }
async function rosterSave(){ await fetch(`${API}/roster?id=${ALLIANCE_ID}`,{ method:"PUT", body:JSON.stringify(roster) }); }
function rosterAdd(fid){ fid=String(fid||"").trim(); if(!fid) return; if(roster.some(m=>m.fid===fid)) return toast("FID already in roster");
  roster.push({ fid, name:"(unsynced)", level:null, tileId:null }); renderRoster(); rosterSave(); }
function rosterRemove(fid){ roster=roster.filter(m=>m.fid!==fid); renderRoster(); rosterSave(); render(); }

async function syncNames(){
  if(!roster.length) return toast("Roster is empty");
  toast("Syncing names from Kingshot…");
  const fids=roster.map(m=>m.fid);
  const {players}=await (await fetch(`${API}/sync-names`,{ method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({fids}) })).json();
  for(const p of players){ const m=roster.find(x=>x.fid===p.fid); if(m&&p.ok){ m.name=p.name; m.level=p.level; } }
  applyRosterToTiles(); renderRoster(); rosterSave(); render(); toast("Names synced ✓");
}

function applyRosterToTiles(){
  for(const m of roster){
    if(m.tileId==null) continue;
    const b=buildings.find(x=>x.id===m.tileId && x.type==="city");
    if(b) b.label=m.name+(m.level?` (TC${m.level})`:"");
  }
}
function assignTile(fid,tileId){
  const m=roster.find(x=>x.fid===fid); if(!m) return;
  m.tileId=tileId?Number(tileId):null; applyRosterToTiles(); rosterSave(); render();
}

function renderRoster(){
  const panel=document.getElementById("roster-panel"); if(!panel) return;
  const cityOpts=(sel)=>buildings.filter(b=>b.type==="city")
    .map(b=>`<option value="${b.id}" ${sel===b.id?"selected":""}>City @${b.gx},${b.gy}</option>`).join("");
  panel.innerHTML=`
    <div style="display:flex;gap:4px;margin-bottom:6px">
      <input id="r-fid" class="panel-input" placeholder="Player FID" style="flex:1">
      <button class="go-btn" onclick="rosterAdd(document.getElementById('r-fid').value)">+ Add</button>
    </div>
    <button class="go-btn full" style="margin-bottom:6px" onclick="syncNames()">🔄 Sync Names from Kingshot</button>
    ${roster.length?"":'<div style="color:#666;font-size:.7rem">No members yet.</div>'}
    ${roster.map(m=>`
      <div style="display:flex;gap:4px;align-items:center;font-size:.72rem;padding:3px 0;border-bottom:1px solid #0f3460">
        <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${m.name} <span style="color:#666">#${m.fid}</span></span>
        <select onchange="assignTile('${m.fid}',this.value)" style="background:#0d1b2a;color:#ccc;border:1px solid #1a5276;border-radius:3px;max-width:90px">
          <option value="">— tile —</option>${cityOpts(m.tileId)}
        </select>
        <span style="cursor:pointer;color:#e74c3c" onclick="rosterRemove('${m.fid}')">✕</span>
      </div>`).join("")}
  `;
}

// ---------- gift code redemption ----------
let redeemRunning=false;
let redeemState=JSON.parse(localStorage.getItem("redeemState")||"{}");
function saveRedeemState(){ localStorage.setItem("redeemState",JSON.stringify(redeemState)); }
function isDone(code,fid){ const s=redeemState[code]&&redeemState[code][fid]; return s==="success"||s==="already_claimed"; }

async function postRedeem(fid,code,captcha){
  return (await fetch(`${API}/redeem`,{ method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({fid,code,captcha}) })).json();
}
function addRedeemRow(name,fid,txt){
  const log=document.getElementById("gc-log");
  const el=document.createElement("div");
  el.style.cssText="display:flex;justify-content:space-between;font-size:.72rem;padding:3px 0;border-bottom:1px solid #0f3460";
  el.innerHTML=`<span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${name} <span style="color:#666">#${fid}</span></span><span class="st">${txt}</span>`;
  log.appendChild(el);
  return { set:(t,c)=>{ const s=el.querySelector(".st"); s.textContent=t; s.style.color=c||"#ccc"; } };
}

function solveCaptchaInteractive(fid,name){
  return new Promise(async (resolve)=>{
    let img=null;
    try{ img=(await (await fetch(`${API}/captcha`,{ method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({fid}) })).json()).img; }catch(e){}
    if(!img) return resolve(null);
    const ov=document.createElement("div");
    ov.style.cssText="position:fixed;inset:0;background:#000b;display:flex;align-items:center;justify-content:center;z-index:9999";
    ov.innerHTML=`<div style="background:#16213e;border:1px solid #e94560;border-radius:10px;padding:20px;text-align:center">
      <div style="color:#fff;font-size:.85rem;margin-bottom:8px">CAPTCHA for <b>${name}</b> (#${fid})</div>
      <img src="${img}" style="background:#fff;border-radius:6px;height:60px"><br>
      <input id="cap-ans" placeholder="type the characters" style="margin-top:10px;padding:6px;border-radius:5px;border:1px solid #1a5276;background:#0d1b2a;color:#fff">
      <div style="margin-top:10px;display:flex;gap:6px;justify-content:center">
        <button id="cap-skip" class="go-btn">Skip</button>
        <button id="cap-ok" class="go-btn" style="background:#e94560;color:#fff">Submit</button>
      </div></div>`;
    document.body.appendChild(ov);
    const done=v=>{ ov.remove(); resolve(v); };
    ov.querySelector("#cap-ok").onclick=()=>done(ov.querySelector("#cap-ans").value.trim());
    ov.querySelector("#cap-skip").onclick=()=>done(null);
    ov.querySelector("#cap-ans").focus();
  });
}

async function redeemForAll(retryOnly){
  if(redeemRunning) return;
  const code=document.getElementById("gc-input").value.trim().toUpperCase();
  if(!code) return toast("Enter a gift code first");
  if(!roster.length) return toast("Roster is empty");
  redeemRunning=true;
  redeemState[code]=redeemState[code]||{};
  document.getElementById("gc-log").innerHTML="";
  const queue=roster.filter(m=>!(retryOnly&&isDone(code,m.fid)));
  if(!queue.length){ redeemRunning=false; return toast("Everyone already has this code ✓"); }

  let ok=0,claimed=0,fail=0; const entries=[];
  for(const m of queue){
    const row=addRedeemRow(m.name,m.fid,"redeeming…");
    let res=await postRedeem(m.fid,code,null);
    if(res.status==="captcha_required"){
      const ans=await solveCaptchaInteractive(m.fid,m.name);
      if(ans===null){ row.set("skipped (captcha)","#888"); fail++; entries.push({fid:m.fid,name:m.name,status:"captcha_skipped"}); continue; }
      res=await postRedeem(m.fid,code,ans);
    }
    redeemState[code][m.fid]=res.status;
    switch(res.status){
      case "success": row.set("✓ redeemed","#2ecc71"); ok++; break;
      case "already_claimed": row.set("• already had it","#888"); claimed++; break;
      case "expired": row.set("✗ expired","#e74c3c"); fail++; break;
      case "invalid_code": row.set("✗ invalid code","#e74c3c"); fail++; break;
      case "code_capped": row.set("✗ limit reached","#e67e22"); fail++; break;
      case "bad_fid": row.set("✗ bad FID","#e74c3c"); fail++; break;
      default: row.set("? "+(res.msg||res.status),"#e67e22"); fail++;
    }
    entries.push({fid:m.fid,name:m.name,status:res.status});
    await new Promise(r=>setTimeout(r,600));
  }
  saveRedeemState(); redeemRunning=false;
  try{ await fetch(`${API}/redeem-log?id=${ALLIANCE_ID}`,{ method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({code,entries}) }); }catch(e){}
  toast(`Done: ${ok} redeemed, ${claimed} already had it, ${fail} to retry`);
  renderHistory();
}

async function renderHistory(){
  const box=document.getElementById("gc-history"); if(!box) return;
  let runs=[]; try{ runs=await (await fetch(`${API}/redeem-log?id=${ALLIANCE_ID}`)).json(); }catch(e){}
  if(!runs.length){ box.innerHTML='<div style="color:#666;font-size:.7rem">No redemptions yet.</div>'; return; }
  box.innerHTML=runs.map(run=>{
    const ok=run.entries.filter(e=>e.status==="success").length;
    const had=run.entries.filter(e=>e.status==="already_claimed").length;
    const failed=run.entries.length-ok-had;
    return `<div style="border-bottom:1px solid #0f3460;padding:4px 0;font-size:.72rem">
      <b style="color:#e94560">${run.code}</b> <span style="color:#666">${new Date(run.ts).toLocaleString()}</span><br>
      <span style="color:#2ecc71">${ok}✓</span> · <span style="color:#888">${had} had</span> · <span style="color:#e74c3c">${failed} failed</span>
    </div>`;
  }).join("");
}

// ---------- map export (PNG to clipboard) ----------
async function exportMap(){
  if(!buildings.length) return toast("Nothing to export");
  let minX=1e9,minY=1e9,maxX=-1e9,maxY=-1e9;
  for(const b of buildings){ const s=BUILDING_DEFS[b.type].size;
    minX=Math.min(minX,b.gx); minY=Math.min(minY,b.gy); maxX=Math.max(maxX,b.gx+s); maxY=Math.max(maxY,b.gy+s); }
  const pad=2; minX-=pad; minY-=pad; maxX+=pad; maxY+=pad;
  const cols=maxX-minX, rows=maxY-minY, c=28;
  const cv=document.createElement("canvas"); cv.width=cols*c; cv.height=rows*c+40;
  const g=cv.getContext("2d");
  g.fillStyle="#0d1b2a"; g.fillRect(0,0,cv.width,cv.height);
  g.strokeStyle="#1a3a5a"; g.lineWidth=1;
  for(let x=0;x<=cols;x++){ g.beginPath(); g.moveTo(x*c,0); g.lineTo(x*c,rows*c); g.stroke(); }
  for(let y=0;y<=rows;y++){ g.beginPath(); g.moveTo(0,y*c); g.lineTo(cols*c,y*c); g.stroke(); }
  for(const b of buildings){
    const d=BUILDING_DEFS[b.type], s=d.size, px=(b.gx-minX)*c, py=(b.gy-minY)*c;
    g.fillStyle=d.color; g.fillRect(px+1,py+1,s*c-2,s*c-2);
    g.fillStyle="#fff"; g.textAlign="center"; g.textBaseline="middle";
    g.font=`${Math.min(s*c-4,16)}px Segoe UI`; g.fillText(d.icon,px+s*c/2,py+s*c/2-4);
    const cap=b.label||d.label; g.font="bold 9px Segoe UI";
    g.fillText(cap.length>12?cap.slice(0,11)+"…":cap, px+s*c/2, py+s*c-7);
  }
  g.fillStyle="#16213e"; g.fillRect(0,rows*c,cv.width,40);
  g.fillStyle="#e94560"; g.font="bold 16px Segoe UI"; g.textAlign="left";
  g.fillText((document.getElementById("designName").value||"Alliance Base")+`  ·  ${buildings.length} buildings`,10,rows*c+24);
  cv.toBlob(async blob=>{
    try{ await navigator.clipboard.write([new ClipboardItem({"image/png":blob})]); toast("Map copied ✓ paste into Discord"); }
    catch{ const a=document.createElement("a"); a.href=URL.createObjectURL(blob); a.download="alliance-map.png"; a.click(); toast("Map downloaded ✓"); }
  });
}

// ---------- wire up toolbar ----------
document.getElementById("btn-save").onclick=cloudSave;
document.getElementById("btn-load").onclick=cloudLoad;
document.getElementById("btn-map").onclick=exportMap;
document.getElementById("btn-redeem-all").onclick=()=>redeemForAll(false);
document.getElementById("btn-redeem-retry").onclick=()=>redeemForAll(true);

// ---------- init ----------
window.addEventListener("load",()=>{ cloudLoad(); rosterLoad(); renderHistory(); });
// ============================================================ end app.js
