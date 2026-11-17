// API des parcours pour Vercel. Les JSON et traces GPX sont dans Vercel Blob privé.
import { del, get, list, put } from "@vercel/blob";
import { randomUUID } from "node:crypto";

const SPORTS = ["velo", "nat", "cap"];
const json = (res, data, status = 200) => {
  res.statusCode = status;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.setHeader("cache-control", "no-store");
  res.end(JSON.stringify(data));
};
const num = (v, min, max, d = 0) => {
  v = Number(v);
  return Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : d;
};
const str = (v, n) => String(v ?? "").slice(0, n);
const uid = () => randomUUID().slice(0, 6);

const cleanTrack = (t) =>
  Array.isArray(t) && t.length >= 2
    ? t.slice(0, 4000).map((p) => [num(p[0], -90, 90), num(p[1], -180, 180), num(p[2], 0, 3000)])
    : null;
const cleanPoints = (a) =>
  (Array.isArray(a) ? a : []).slice(0, 300).map((p) => ({
    id: str(p.id, 16) || uid(),
    name: str(p.name, 80),
    km: num(p.km, 0, 3000),
  }));
const cleanGroups = (a) =>
  (Array.isArray(a) ? a : []).slice(0, 30).map((b) => ({
    id: str(b.id, 16) || uid(),
    name: str(b.name, 60),
    start: /^\d{1,2}:\d{2}$/.test(b.start) ? b.start : "07:00",
    speed: num(b.speed, 0, 90, 25),
    pace: num(b.pace, 0, 3600, 360),
    t: num(b.t, 0, 120, 0),
  }));
const totalKm = (track) => Math.round(track[track.length - 1][2] * 100) / 100;
const cleanGpx = (g) => (typeof g === "string" && g.length <= 3_500_000 && g.includes("<gpx") ? g : null);

const DEF = {
  velo: { km: 40, g: [["Rapide", "07:00", { speed: 45, t: 2 }], ["Moyen", "07:30", { speed: 32, t: 3 }], ["Lent", "08:00", { speed: 22, t: 5 }]] },
  nat: { km: 1.5, g: [["Rapide", "07:00", { pace: 80 }], ["Moyen", "07:05", { pace: 105 }], ["Lent", "07:10", { pace: 135 }]] },
  cap: { km: 10, g: [["Rapide", "10:00", { pace: 240, t: 1 }], ["Moyen", "10:30", { pace: 330, t: 2 }], ["Lent", "11:00", { pace: 420, t: 3 }]] },
};
const endPoints = (km) => [{ id: uid(), name: "Départ", km: 0 }, { id: uid(), name: "Arrivée", km }];
const defaultSport = (k) => ({
  track: null,
  km: DEF[k].km,
  gpx: null,
  points: endPoints(DEF[k].km),
  bikes: DEF[k].g.map(([name, start, r]) => ({ id: uid(), name, start, speed: r.speed ?? 25, pace: r.pace ?? 360, t: r.t ?? 0 })),
});

function normalize(r) {
  const sports = { ...(r.sports || {}) };
  if (!r.sports) {
    sports.velo = { track: r.track || null, km: r.km || 0, gpx: r.gpx || null, points: r.points || [], bikes: cleanGroups(r.bikes) };
  }
  for (const k of SPORTS) if (!sports[k]) sports[k] = defaultSport(k);
  return { id: r.id, name: r.name, updatedAt: r.updatedAt, km: sports.velo.km, sports };
}

function buildSport(prev, b = {}, fresh = false) {
  const s = { ...prev };
  const track = cleanTrack(b.track);
  if (track) {
    s.track = track;
    s.km = totalKm(track);
    if (fresh && !b.points) s.points = endPoints(s.km);
  } else if (b.km !== undefined && !s.track) {
    s.km = num(b.km, 0, 3000, s.km);
  }
  if (b.points) s.points = cleanPoints(b.points);
  if (b.bikes) s.bikes = cleanGroups(b.bikes);
  const gpx = track ? cleanGpx(b.gpx) : null;
  if (gpx) s.gpx = { name: str(b.gpxName, 120) || "parcours.gpx", size: gpx.length, updatedAt: Date.now() };
  return { s, gpx };
}

const routePath = (id) => `routes/${id}.json`;
const gpxPath = (id, sport) => `gpx/${id}/${sport}.gpx`;
async function readJson(path) {
  const blob = await get(path, { access: "private", useCache: false });
  if (!blob || blob.statusCode !== 200 || !blob.stream) return null;
  return JSON.parse(await new Response(blob.stream).text());
}
async function writeBlob(path, body, contentType) {
  return put(path, body, {
    access: "private",
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType,
    cacheControlMaxAge: 60,
  });
}
async function readBody(req) {
  if (req.body && typeof req.body === "object") return req.body;
  if (typeof req.body === "string") return JSON.parse(req.body || "{}");
  return {};
}

function checkRole(req) {
  const adminCode = process.env.ADMIN_CODE || process.env.EDIT_CODE;
  const guestCode = process.env.GUEST_CODE;
  const code = req.headers["x-access-code"] || req.headers["x-edit-code"];
  if (adminCode && code === adminCode) return "admin";
  if (guestCode && code === guestCode) return "guest";
  return null;
}

export default async function handler(req, res) {
  const parts = new URL(req.url, `https://${req.headers.host || "localhost"}`).pathname.split("/").filter(Boolean);
  const id = parts[2] ? parts[2].replace(/[^\w-]/g, "") : null;
  const adminCode = process.env.ADMIN_CODE || process.env.EDIT_CODE;
  const guestCode = process.env.GUEST_CODE;
  if (!adminCode || !guestCode) {
    return json(res, { error: "Configure les variables ADMIN_CODE et GUEST_CODE dans Vercel." }, 503);
  }
  if (adminCode === guestCode) {
    return json(res, { error: "ADMIN_CODE et GUEST_CODE doivent être différents." }, 503);
  }
  if (!process.env.BLOB_STORE_ID && !process.env.BLOB_READ_WRITE_TOKEN) {
    return json(res, { error: "Vercel Blob n’est pas relié à ce projet. Crée un magasin Blob privé et relie-le au projet Vercel." }, 503);
  }
  const role = checkRole(req);
  if (!role) return json(res, { error: "Code d’accès invalide. Utilise le code invité ou le code administrateur." }, 401);
  res.setHeader("x-user-role", role);
  if (role === "guest" && req.method !== "GET") {
    return json(res, { error: "Le compte invité peut consulter les restitutions, mais ne peut pas modifier les parcours." }, 403);
  }

  try {
    if (!id) {
      if (req.method === "GET") {
        const all = [];
        let cursor;
        do {
          const page = await list({ prefix: "routes/", cursor, limit: 1000 });
          const records = await Promise.all(page.blobs.map((blob) => readJson(blob.pathname)));
          all.push(...records.filter(Boolean).map(normalize));
          cursor = page.hasMore ? page.cursor : undefined;
        } while (cursor);
        return json(res, all.map((r) => ({ id: r.id, name: r.name, km: r.km, updatedAt: r.updatedAt })).sort((a, b) => b.updatedAt - a.updatedAt));
      }
      if (req.method === "POST") {
        const b = await readBody(req);
        const rid = randomUUID().slice(0, 8);
        const sports = {};
        const gpxs = {};
        for (const k of SPORTS) {
          const { s, gpx } = buildSport(defaultSport(k), b.sports?.[k], true);
          sports[k] = s;
          if (gpx) gpxs[k] = gpx;
        }
        const r = { id: rid, name: str(b.name, 80) || "Parcours sans nom", km: sports.velo.km, sports, updatedAt: Date.now() };
        await Promise.all(Object.entries(gpxs).map(([k, g]) => writeBlob(gpxPath(rid, k), g, "application/gpx+xml; charset=utf-8")));
        await writeBlob(routePath(rid), JSON.stringify(r), "application/json; charset=utf-8");
        return json(res, r, 201);
      }
      return json(res, { error: "Méthode non supportée" }, 405);
    }

    const raw = await readJson(routePath(id));
    if (!raw) return json(res, { error: "Parcours introuvable" }, 404);
    const cur = normalize(raw);
    if (parts[3] === "gpx") {
      if (req.method !== "GET") return json(res, { error: "Méthode non supportée" }, 405);
      let sport = new URL(req.url, `https://${req.headers.host || "localhost"}`).searchParams.get("sport");
      if (!SPORTS.includes(sport)) sport = "velo";
      const blob = await get(gpxPath(id, sport), { access: "private", useCache: false });
      if (!blob || blob.statusCode !== 200 || !blob.stream) return json(res, { error: "Aucun fichier GPX enregistré" }, 404);
      const fn = (cur.sports[sport].gpx?.name || "parcours.gpx").replace(/[^\w.\- ]/g, "_");
      res.statusCode = 200;
      res.setHeader("content-type", "application/gpx+xml; charset=utf-8");
      res.setHeader("content-disposition", `attachment; filename="${fn}"`);
      res.setHeader("cache-control", "no-store");
      return res.end(Buffer.from(await new Response(blob.stream).arrayBuffer()));
    }
    if (req.method === "GET") return json(res, cur);
    if (req.method === "PUT") {
      const b = await readBody(req);
      const next = { ...cur, name: b.name !== undefined ? str(b.name, 80) || cur.name : cur.name, sports: { ...cur.sports }, updatedAt: Date.now() };
      const writes = [];
      for (const k of SPORTS) {
        if (!b.sports?.[k]) continue;
        const { s, gpx } = buildSport(cur.sports[k], b.sports[k]);
        next.sports[k] = s;
        if (gpx) writes.push(writeBlob(gpxPath(id, k), gpx, "application/gpx+xml; charset=utf-8"));
      }
      next.km = next.sports.velo.km;
      await Promise.all(writes);
      await writeBlob(routePath(id), JSON.stringify(next), "application/json; charset=utf-8");
      return json(res, { id, updatedAt: next.updatedAt, sports: Object.fromEntries(SPORTS.map((k) => [k, { km: next.sports[k].km, gpx: next.sports[k].gpx }])) });
    }
    if (req.method === "DELETE") {
      const { blobs } = await list({ prefix: `gpx/${id}/`, limit: 1000 });
      await del([routePath(id), ...blobs.map((blob) => blob.pathname)]);
      return json(res, { ok: true });
    }
    return json(res, { error: "Méthode non supportée" }, 405);
  } catch (error) {
    console.error("Vercel routes API error:", error);
    return json(res, { error: "Erreur serveur" }, 500);
  }
}
