// Cloudflare Pages Function — all /api/* routes.
// design save/load · roster save/load · name sync · redeem · captcha · redeem-log

const SECRET_SALT = "mN4!pQs6Jcs9wzib"; // community gift-code sign salt — VERIFY against live API
const GIFT_BASE = "https://kingshot-giftcode.centurygame.com/api";
const DEFAULT_ID = "default";

// err_code → status. VERIFY these numbers with one real redemption.
const REDEEM_CODES = {
  20000: "success", 40008: "already_claimed", 40007: "expired",
  40014: "invalid_code", 40010: "code_capped", 40103: "captcha_required",
  40004: "timeout_retry",
};

export async function onRequest(context) {
  const { request, env, params } = context;
  const path = (params.path || []).join("/");
  const url = new URL(request.url);
  const id = url.searchParams.get("id") || DEFAULT_ID;
  const cors = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,PUT,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Type": "application/json",
  };
  if (request.method === "OPTIONS") return new Response(null, { headers: cors });

  try {
    if (path === "design") {
      if (request.method === "GET")
        return new Response((await env.DESIGNS.get("design:" + id)) || "null", { headers: cors });
      if (request.method === "PUT") {
        await env.DESIGNS.put("design:" + id, await request.text());
        return new Response('{"ok":true}', { headers: cors });
      }
    }

    if (path === "roster") {
      if (request.method === "GET")
        return new Response((await env.ROSTER.get("roster:" + id)) || "[]", { headers: cors });
      if (request.method === "PUT") {
        await env.ROSTER.put("roster:" + id, await request.text());
        return new Response('{"ok":true}', { headers: cors });
      }
    }

    if (path === "sync-names" && request.method === "POST") {
      const { fids } = await request.json();
      const players = [];
      for (const fid of fids) {
        players.push(await lookupPlayer(String(fid)));
        await sleep(250);
      }
      return new Response(JSON.stringify({ players }), { headers: cors });
    }

    if (path === "redeem" && request.method === "POST") {
      const { fid, code, captcha } = await request.json();
      const result = await redeemOne(String(fid), String(code).trim().toUpperCase(), captcha);
      return new Response(JSON.stringify(result), { headers: cors });
    }

    if (path === "captcha" && request.method === "POST") {
      const { fid } = await request.json();
      const time = Date.now();
      const sign = md5(`fid=${fid}&time=${time}${SECRET_SALT}`);
      const res = await fetch(`${GIFT_BASE}/captcha`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: `fid=${fid}&time=${time}&sign=${sign}`,
      });
      let j = {}; try { j = await res.json(); } catch (_) {}
      const img = (j.data && (j.data.img || j.data.image)) || null;
      return new Response(JSON.stringify({ img }), { headers: cors });
    }

    if (path === "redeem-log") {
      const key = "log:" + id;
      if (request.method === "GET")
        return new Response((await env.REDEEMLOG.get(key)) || "[]", { headers: cors });
      if (request.method === "POST") {
        const run = await request.json();
        run.ts = Date.now();
        const existing = JSON.parse((await env.REDEEMLOG.get(key)) || "[]");
        existing.unshift(run);
        await env.REDEEMLOG.put(key, JSON.stringify(existing.slice(0, 100)));
        return new Response('{"ok":true}', { headers: cors });
      }
    }

    return new Response('{"error":"not found"}', { status: 404, headers: cors });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: cors });
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Player lookup. VERIFY field names: data.nickname, data.stove_lv, data.kid
async function lookupPlayer(fid) {
  const time = Date.now();
  const sign = md5(`fid=${fid}&time=${time}${SECRET_SALT}`);
  const res = await fetch(`${GIFT_BASE}/player`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `fid=${fid}&time=${time}&sign=${sign}`,
  });
  let j = {}; try { j = await res.json(); } catch (_) {}
  const d = j.data || {};
  return {
    fid, ok: !!d.nickname, name: d.nickname || null,
    level: d.stove_lv ?? null, kid: d.kid ?? null, avatar: d.avatar_image || null,
  };
}

async function redeemOne(fid, code, captcha) {
  const player = await lookupPlayer(fid);
  if (!player.ok) return { fid, status: "bad_fid", name: null };
  const time = Date.now();
  let raw = `cdk=${code}&fid=${fid}&time=${time}`;
  if (captcha) raw += `&captcha_code=${captcha}`;
  const sign = md5(raw + SECRET_SALT);
  let body = `fid=${fid}&cdk=${code}&time=${time}&sign=${sign}`;
  if (captcha) body += `&captcha_code=${encodeURIComponent(captcha)}`;
  const res = await fetch(`${GIFT_BASE}/gift_code`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  let j = {}; try { j = await res.json(); } catch (_) {}
  return { fid, name: player.name, status: REDEEM_CODES[j.err_code] || "unknown", raw: j.err_code, msg: j.msg || "" };
}

// ---- pure-JS MD5 ----
function md5(s){function rl(n,c){return(n<<c)|(n>>>(32-c));}function au(x,y){var l=(x&0xFFFF)+(y&0xFFFF),m=(x>>16)+(y>>16)+(l>>16);return(m<<16)|(l&0xFFFF);}function cm(q,a,b,x,s,t){return au(rl(au(au(a,q),au(x,t)),s),b);}function ff(a,b,c,d,x,s,t){return cm((b&c)|(~b&d),a,b,x,s,t);}function gg(a,b,c,d,x,s,t){return cm((b&d)|(c&~d),a,b,x,s,t);}function hh(a,b,c,d,x,s,t){return cm(b^c^d,a,b,x,s,t);}function ii(a,b,c,d,x,s,t){return cm(c^(b|~d),a,b,x,s,t);}function tb(s){var n=s.length,a=[];for(var i=0;i<n*8;i+=8)a[i>>5]|=(s.charCodeAt(i/8)&0xFF)<<(i%32);return a;}function rh(n){var s="",j;for(j=0;j<=3;j++)s+=((n>>(j*8+4))&0x0F).toString(16)+((n>>(j*8))&0x0F).toString(16);return s;}function cmh(x){var s="";for(var i=0;i<x.length;i++)s+=rh(x[i]);return s;}var x=tb(s),len=s.length*8;x[len>>5]|=0x80<<(len%32);x[(((len+64)>>>9)<<4)+14]=len;var a=1732584193,b=-271733879,c=-1732584194,d=271733878;for(var i=0;i<x.length;i+=16){var oa=a,ob=b,oc=c,od=d;a=ff(a,b,c,d,x[i],7,-680876936);d=ff(d,a,b,c,x[i+1],12,-389564586);c=ff(c,d,a,b,x[i+2],17,606105819);b=ff(b,c,d,a,x[i+3],22,-1044525330);a=ff(a,b,c,d,x[i+4],7,-176418897);d=ff(d,a,b,c,x[i+5],12,1200080426);c=ff(c,d,a,b,x[i+6],17,-1473231341);b=ff(b,c,d,a,x[i+7],22,-45705983);a=ff(a,b,c,d,x[i+8],7,1770035416);d=ff(d,a,b,c,x[i+9],12,-1958414417);c=ff(c,d,a,b,x[i+10],17,-42063);b=ff(b,c,d,a,x[i+11],22,-1990404162);a=ff(a,b,c,d,x[i+12],7,1804603682);d=ff(d,a,b,c,x[i+13],12,-40341101);c=ff(c,d,a,b,x[i+14],17,-1502002290);b=ff(b,c,d,a,x[i+15],22,1236535329);a=gg(a,b,c,d,x[i+1],5,-165796510);d=gg(d,a,b,c,x[i+6],9,-1069501632);c=gg(c,d,a,b,x[i+11],14,643717713);b=gg(b,c,d,a,x[i],20,-373897302);a=gg(a,b,c,d,x[i+5],5,-701558691);d=gg(d,a,b,c,x[i+10],9,38016083);c=gg(c,d,a,b,x[i+15],14,-660478335);b=gg(b,c,d,a,x[i+4],20,-405537848);a=gg(a,b,c,d,x[i+9],5,568446438);d=gg(d,a,b,c,x[i+14],9,-1019803690);c=gg(c,d,a,b,x[i+3],14,-187363961);b=gg(b,c,d,a,x[i+8],20,1163531501);a=gg(a,b,c,d,x[i+13],5,-1444681467);d=gg(d,a,b,c,x[i+2],9,-51403784);c=gg(c,d,a,b,x[i+7],14,1735328473);b=gg(b,c,d,a,x[i+12],20,-1926607734);a=hh(a,b,c,d,x[i+5],4,-378558);d=hh(d,a,b,c,x[i+8],11,-2022574463);c=hh(c,d,a,b,x[i+11],16,1839030562);b=hh(b,c,d,a,x[i+14],23,-35309556);a=hh(a,b,c,d,x[i+1],4,-1530992060);d=hh(d,a,b,c,x[i+4],11,1272893353);c=hh(c,d,a,b,x[i+7],16,-155497632);b=hh(b,c,d,a,x[i+10],23,-1094730640);a=hh(a,b,c,d,x[i+13],4,681279174);d=hh(d,a,b,c,x[i],11,-358537222);c=hh(c,d,a,b,x[i+3],16,-722521979);b=hh(b,c,d,a,x[i+6],23,76029189);a=hh(a,b,c,d,x[i+9],4,-640364487);d=hh(d,a,b,c,x[i+12],11,-421815835);c=hh(c,d,a,b,x[i+15],16,530742520);b=hh(b,c,d,a,x[i+2],23,-995338651);a=ii(a,b,c,d,x[i],6,-198630844);d=ii(d,a,b,c,x[i+7],10,1126891415);c=ii(c,d,a,b,x[i+14],15,-1416354905);b=ii(b,c,d,a,x[i+5],21,-57434055);a=ii(a,b,c,d,x[i+12],6,1700485571);d=ii(d,a,b,c,x[i+3],10,-1894986606);c=ii(c,d,a,b,x[i+10],15,-1051523);b=ii(b,c,d,a,x[i+1],21,-2054922799);a=ii(a,b,c,d,x[i+8],6,1873313359);d=ii(d,a,b,c,x[i+15],10,-30611744);c=ii(c,d,a,b,x[i+6],15,-1560198380);b=ii(b,c,d,a,x[i+13],21,1309151649);a=ii(a,b,c,d,x[i+4],6,-145523070);d=ii(d,a,b,c,x[i+11],10,-1120210379);c=ii(c,d,a,b,x[i+2],15,718787259);b=ii(b,c,d,a,x[i+9],21,-343485551);a=au(a,oa);b=au(b,ob);c=au(c,oc);d=au(d,od);}return cmh([a,b,c,d]);}
