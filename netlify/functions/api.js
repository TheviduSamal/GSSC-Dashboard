const DEFAULTS = {
  tl: "https://qat-output-default-rtdb.firebaseio.com/TL%20Hourly.json",
  staff: "https://qat-output-default-rtdb.firebaseio.com/QAT2%20Output.json",
  filtered: "https://qat-output-default-rtdb.firebaseio.com/qat_filtered.json",
  planning: "https://qat-output-default-rtdb.firebaseio.com/planning.json",
  outflow: "https://projectgap-4b7d9-default-rtdb.firebaseio.com/project-gaps.json",
  queue: "https://thevindu-8fe8b-default-rtdb.firebaseio.com/queue_monitor.json",
  cancellation: "https://cancellation-7294a-default-rtdb.firebaseio.com/qat_cancelation_data.json"
};
const GRAFANA_BASE = process.env.GRAFANA_BASE || "https://grafana-server-cd2i.onrender.com";
const GRAFANA_USER = process.env.GRAFANA_USER || "admin";        // change here, or override with a Netlify env var
const GRAFANA_PASS = process.env.GRAFANA_PASS || "password123";  // change here, or override with a Netlify env var
const paths = {
  "tl-hourly": ["TL_FIREBASE_URL", "tl"], "staff": ["STAFF_FIREBASE_URL", "staff"],
  "filtered": ["FILTERED_FIREBASE_URL", "filtered"], "planning": ["PLANNING_FIREBASE_URL", "planning"],
  "outflow": ["OUTFLOW_FIREBASE_URL", "outflow"], "queue": ["QUEUE_FIREBASE_URL", "queue"],
  "cancellation": ["CANCELLATION_FIREBASE_URL", "cancellation"]
};
const headers = { "content-type":"application/json; charset=utf-8", "cache-control":"no-store" };
const reply = (statusCode, body) => ({ statusCode, headers, body: JSON.stringify(body) });
function authorized(event) {
  if (!process.env.AUTH_USER && !process.env.AUTH_PASS) return true; // Set both in Netlify for protected deployment.
  const h = event.headers?.authorization || event.headers?.Authorization || "";
  if (!h.startsWith("Basic ")) return false;
  let raw = ""; try { raw = Buffer.from(h.slice(6), "base64").toString(); } catch {}
  const i = raw.indexOf(":");
  return i >= 0 && raw.slice(0,i) === process.env.AUTH_USER && raw.slice(i+1) === process.env.AUTH_PASS;
}
function endpoint(event) {
  const p = event.path || "";
  return decodeURIComponent(p.split("/").pop() || "").replace(/\/+$/, "");
}
async function fb(url, method="GET", body) {
  const token = process.env.FIREBASE_DATABASE_SECRET;
  const target = new URL(url);
  if (token) target.searchParams.set("auth", token);
  const res = await fetch(target, { method, headers: {"content-type":"application/json"}, ...(body === undefined ? {} : {body:JSON.stringify(body)}) });
  const txt = await res.text();
  if (!res.ok) throw new Error(`Firebase returned ${res.status}: ${txt.slice(0,300)}`);
  return txt ? JSON.parse(txt) : null;
}

// ── Scoped cancellation (only the selected Team Leader / Shift Sup's staff) ──────────────
const normId = (v) => String(v == null ? "" : v).toLowerCase().replace(/[^a-z0-9]/g, "");
const stripOtl = (n) => n.replace(/otl$/, "");

// Reads { scoped, staff_ids, team_leaders } from the POST body (or ?scoped=1&staff_ids=a,b,c).
// Returns null when the request is not scoped (old behaviour is kept).
function readScope(event, q) {
  let b = {};
  if (event.httpMethod === "POST") { try { b = JSON.parse(event.body || "{}"); } catch {} }
  const scoped = b.scoped === true || q.scoped === "1" || q.scoped === "true";
  if (!scoped) return null;
  const list = (v, qv) => Array.isArray(v) ? v : (qv ? String(qv).split(",") : []);
  const idSet = new Set();
  for (const raw of list(b.staff_ids, q.staff_ids)) {
    const n = normId(raw);
    if (n) { idSet.add(n); idSet.add(stripOtl(n)); }
  }
  const tlSet = new Set();
  for (const raw of list(b.team_leaders, q.team_leaders)) {
    const n = normId(raw);
    if (n) { tlSet.add(n); tlSet.add(stripOtl(n)); }
  }
  return { idSet, tlSet };
}

// Walk any response shape ({success,data:[..]}, {rows:[..]}, {pushId:{..row..}}, [..rows..]) and collect the row objects.
function collectRows(node, out = []) {
  if (node == null) return out;
  if (Array.isArray(node)) { node.forEach((n) => collectRows(n, out)); return out; }
  if (typeof node !== "object") return out;
  if (Array.isArray(node.rows)) { if (!node.error) collectRows(node.rows, out); return out; }
  if (node.data !== undefined && node.data !== null && typeof node.data === "object") { collectRows(node.data, out); return out; }
  const vals = Object.values(node);
  if (vals.some((v) => v === null || typeof v !== "object")) { out.push(node); return out; } // a row
  vals.forEach((v) => collectRows(v, out));
  return out;
}

function rowInScope(row, scope) {
  for (const [k, v] of Object.entries(row)) {
    if (v == null || typeof v === "object") continue;
    const n = normId(v);
    if (!n) continue;
    // any field holding one of the in-scope staff ids (e.g. G23339 / G26658-OTL)
    if (scope.idSet.has(n) || scope.idSet.has(stripOtl(n))) return true;
    // team leader name only in TL-looking columns
    if (/tl|team|lead/i.test(k) && (scope.tlSet.has(n) || scope.tlSet.has(stripOtl(n)))) return true;
  }
  return false;
}

// Live Grafana proxy: credentials stay on the server (defined at the top of this file).
async function grafana(route, query, opts) {
  opts = opts || {};
  const doRetry = opts.retry !== false;
  const base = GRAFANA_BASE.replace(/\/+$/, "");
  const qs = new URLSearchParams(query || {}).toString();
  const url = `${base}/${route}${qs ? "?" + qs : ""}`;
  const reqOpts = { headers: { Authorization: "Basic " + Buffer.from(`${GRAFANA_USER}:${GRAFANA_PASS}`).toString("base64"), Accept: "application/json" } };
  let res = await fetch(url, reqOpts);
  // Render free servers answer 502/503/504 while waking up: wait a moment and try once more.
  if (doRetry && [502, 503, 504].includes(res.status)) { await new Promise(r => setTimeout(r, 4000)); res = await fetch(url, reqOpts); }
  const txt = await res.text();
  if (!res.ok) return reply(502, {success:false, upstream_status:res.status, error:`Grafana server (${base}/${route}) returned ${res.status}${res.status === 401 ? " - username/password rejected" : ""}: ${txt.slice(0,300)}`});
  return { statusCode: 200, headers, body: txt };
}
exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return {statusCode:204, headers:{...headers,"access-control-allow-origin":"*","access-control-allow-methods":"GET,POST,DELETE,OPTIONS","access-control-allow-headers":"Content-Type,Authorization"},body:""};
  if (!authorized(event)) return reply(401,{success:false,error:"Unauthorized. Check AUTH_USER/AUTH_PASS."});
  const ep = endpoint(event);
  const q = event.queryStringParameters || {};
  try {
    if (ep === "health" || ep === "api") return reply(200,{success:true,service:"QAT Netlify Serverless API",time:new Date().toISOString(),serverless:true});
    if (ep === "team-leaders" || ep === "staff-ids") return reply(200,{team_leaders:["G26658-OTL","G25883-OTL","G22371-OTL","G23179-OTL"],staff_ids:["G26658-OTL","G25883-OTL","G22371-OTL","G23179-OTL"],count:4});
    if (ep === "staff-lookup") {
      const url = process.env.STAFF_SHEET_URL || "https://docs.google.com/spreadsheets/d/e/2PACX-1vTcJSktGEdHycbjqLx-YD7-V1DUCH462h64XxaiuyKv9iK6n2FXgh6VAYvFEkS83DI76b2HJfppeuzd/pub?gid=1860286382&output=csv";
      const r=await fetch(url); if(!r.ok) throw new Error("Staff sheet fetch failed: "+r.status); return reply(200,{success:true,csv:await r.text()});
    }
    if (ep === "project-task-lookup") {
      const url=process.env.PROJECT_TASK_SHEET_URL;
      if(!url) return reply(400,{success:false,error:"Set PROJECT_TASK_SHEET_URL in Netlify environment variables."});
      const r=await fetch(url); if(!r.ok) throw new Error("Project/task sheet fetch failed: "+r.status);
      return reply(200,{success:true,csv:await r.text()});
    }
    if (ep === "cancellation-columns") return reply(200,{success:true,columns:[],note:"Schema lookup needs the protected BigQuery/Grafana integration; configure it separately."});
    if (ep === "planning" && event.httpMethod === "GET") {
      const data=await fb(process.env.PLANNING_FIREBASE_URL || DEFAULTS.planning);
      return reply(200,{success:true,data:Object.entries(data||{}).map(([id,v])=>({id,...v})),count:Object.keys(data||{}).length});
    }
    if (ep === "planning" && event.httpMethod === "POST") {
      const b=JSON.parse(event.body||"{}"), project_name=String(b.project_name||"").trim(), task_name=String(b.task_name||"").trim(), target=Number(b.target);
      if(!project_name||!task_name||!Number.isFinite(target)||target<0) return reply(400,{success:false,error:"project_name, task_name and target >= 0 are required"});
      const id=Date.now().toString(36)+Math.random().toString(36).slice(2,8);
      const entry={project_name,task_name,target,actual:0,percentage:0,created_at:new Date().toISOString()};
      await fb((process.env.PLANNING_FIREBASE_URL||DEFAULTS.planning).replace(/\.json(?:\?.*)?$/,"/"+id+".json"),"PUT",entry);
      return reply(201,{success:true,id,data:entry});
    }
    if (ep === "planning" && event.httpMethod === "DELETE") {
      if(!q.id) return reply(400,{success:false,error:"id is required"});
      await fb((process.env.PLANNING_FIREBASE_URL||DEFAULTS.planning).replace(/\.json(?:\?.*)?$/,"/"+encodeURIComponent(q.id)+".json"),"DELETE");
      return reply(200,{success:true,id:q.id});
    }
    if (ep === "planning-fetch") return reply(501,{success:false,error:"Actual refresh needs the protected Grafana/BigQuery source integration. Existing saved planning data is available from /planning."});
    if (ep === "fetch-all" || ep === "fetch" || ep === "fetch-filtered") return await grafana(ep, q);
    if (ep === "fetch-outflow" || ep === "fetch-cancellation" || ep === "queue-monitor") {
      // Scoped cancellation request (POST { scoped:true, staff_ids, team_leaders }): return ONLY those staff's rows.
      const scope = ep === "fetch-cancellation" ? readScope(event, q) : null;
      let payload = null;
      let source = "grafana";

      // Try Grafana quickly (no retry); fall back to reading fresh Firebase data.
      try {
        const g = await grafana(ep, q, { retry: false });
        if (g.statusCode === 200) {
          if (!scope) return g;
          try { payload = JSON.parse(g.body); } catch { payload = null; }
        }
      } catch (e) {
        console.warn("Grafana attempt failed for " + ep + ":", e.message);
      }

      if (payload === null) {
        source = "firebase";
        const map = { "fetch-outflow": "outflow", "fetch-cancellation": "cancellation", "queue-monitor": "queue" };
        const cfg = paths[map[ep]];
        payload = await fb(process.env[cfg[0]] || DEFAULTS[cfg[1]]);
      }

      if (scope) {
        const rows = collectRows(payload).filter((r) => rowInScope(r, scope));
        return reply(200, { success: true, source, scoped: true, count: rows.length, fetched_at: new Date().toISOString(), data: rows });
      }
      return reply(200, { success: true, source: "firebase", fetched_at: new Date().toISOString(), data: payload });
    }
    if (event.httpMethod !== "GET") return reply(405,{success:false,error:"Method not allowed"});
    const cfg=paths[ep];
    if (!cfg) return reply(404,{success:false,error:"Unknown endpoint",available:Object.keys(paths)});
    const data=await fb(process.env[cfg[0]] || DEFAULTS[cfg[1]]);
    return reply(200,{success:true,mode:ep,data,updated_at:data?.updated_at||data?.lastUpdated||null});
  } catch(e) {
    console.error("API error",e);
    return reply(500,{success:false,error:process.env.NODE_ENV==="production"?"Request failed. Check Netlify function logs.":e.message});
  }
};