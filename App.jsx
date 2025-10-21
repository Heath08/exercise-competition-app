import React, { useEffect, useMemo, useRef, useState } from "react";
import { initializeApp, getApps } from "firebase/app";
import { getFirestore, doc, onSnapshot, setDoc, serverTimestamp } from "firebase/firestore";
import { getAuth, signInAnonymously } from "firebase/auth";

const Button = ({ className = "", ...props }) => (
  <button className={`px-4 py-2 rounded-2xl shadow hover:opacity-90 transition ${className}`} {...props} />
);
const Card = ({ className = "", ...props }) => (
  <div className={`rounded-3xl shadow p-4 ${className}`} {...props} />
);
const Input = ({ className = "", ...props }) => (
  <input className={`px-3 py-2 rounded-xl outline-none shadow-inner ${className}`} {...props} />
);
const Select = ({ className = "", children, ...props }) => (
  <select className={`px-3 py-2 rounded-xl shadow-inner ${className}`} {...props}>{children}</select>
);

const STORAGE_KEY = "exercise_challenge_mvp_v2";
const niceDate = (d) => new Date(d).toLocaleString();
const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
const uid = () => Math.random().toString(36).slice(2);
const deviceId = (() => {
  try {
    const k = "exercise_device_id";
    const v = localStorage.getItem(k) || uid();
    localStorage.setItem(k, v);
    return v;
  } catch {
    return uid();
  }
})();

const debounce = (fn, ms = 500) => {
  let t; return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
};

const theme = {
  bg: "#0f172a", panel: "#111827", card: "#0b1220", text: "#e5e7eb", subtext: "#9ca3af",
  accent: "#22d3ee", accent2: "#a78bfa", success: "#34d399", warn: "#f59e0b", danger: "#ef4444",
};

const DEFAULT_CONFIG = {
  seasonName: "October Throwdown",
  weeklyPointCap: 400,
  weightPointsPerLb: 4,
  awardStreakAfterDays: 3,
  points: { workout: 20, steps5k: 10, active10Min: 1, pr: 5, streakDaily: 5 },
  bannedWords: ["stupid", "idiot", "trash", "hate"],
  rewardIdeas: [
    "Winner picks dinner",
    "Loser buys coffee",
    "Winner gets Friday night off bedtime routine",
    "Loser does dishes for a week",
    "Winner controls playlist on next drive",
  ],
};

const DEFAULT_STATE = {
  players: [
    { id: "p1", name: "You", startWeight: null, currentWeight: null, points: 0, history: [], activities: [] },
    { id: "p2", name: "Friend", startWeight: null, currentWeight: null, points: 0, history: [], activities: [] },
  ],
  chat: [],
  config: DEFAULT_CONFIG,
  startedAt: Date.now(),
  seasonIndex: 1,
  _meta: { updatedAt: Date.now(), updatedBy: deviceId, version: 1 },
};

const AUTO_CONNECT = import.meta.env.VITE_AUTO_CONNECT === "true";
const DEFAULT_ROOM_ID = import.meta.env.VITE_DEFAULT_ROOM_ID || "";
let FIREBASE_CONFIG = null;
try {
  FIREBASE_CONFIG = import.meta.env.VITE_FIREBASE_CONFIG
    ? JSON.parse(import.meta.env.VITE_FIREBASE_CONFIG)
    : null;
} catch {
  FIREBASE_CONFIG = null;
}

function useLocalState(initial) {
  const [state, setState] = useState(() => {
    try { const raw = localStorage.getItem(STORAGE_KEY); return raw ? JSON.parse(raw) : initial; } catch { return initial; }
  });
  useEffect(() => { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }, [state]);
  return [state, setState];
}

function ScoreBadge({ value }) {
  return (
    <span style={{ background: theme.accent2, color: "#0b0b0b" }} className="rounded-full px-3 py-1 text-sm font-semibold">{value} pts</span>
  );
}

function Header({ season }) {
  return (
    <div className="flex items-center justify-between">
      <div>
        <h1 className="text-2xl md:text-3xl font-bold" style={{ color: theme.text }}>🏆 Exercise Competition</h1>
        <p className="text-sm" style={{ color: theme.subtext }}>{season}</p>
      </div>
      <div className="text-xs md:text-sm" style={{ color: theme.subtext }}>Friendly trash talk encouraged — keep it kind.</div>
    </div>
  );
}

function Leaderboard({ players }) {
  const sorted = [...players].sort((a, b) => b.points - a.points);
  return (
    <Card className="mt-4" style={{ background: theme.card }}>
      <h2 className="text-xl font-semibold mb-3" style={{ color: theme.text }}>Leaderboard</h2>
      <div className="grid grid-cols-1 gap-3">
        {sorted.map((p, i) => (
          <div key={p.id} className="flex items-center justify-between rounded-2xl px-4 py-3" style={{ background: i === 0 ? "#0c162b" : "#0d1424" }}>
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full flex items-center justify-center text-lg font-bold" style={{ background: i === 0 ? theme.accent : theme.accent2, color: "#0b0b0b" }}>{i + 1}</div>
              <div>
                <div className="font-semibold" style={{ color: theme.text }}>{p.name}</div>
                <div className="text-xs" style={{ color: theme.subtext }}>{p.currentWeight ? `${p.currentWeight} lb` : "no weight set"}</div>
              </div>
            </div>
            <ScoreBadge value={p.points} />
          </div>
        ))}
      </div>
    </Card>
  );
}
function PointsConfig({ config, onUpdate }) {
  const [local, setLocal] = useState(config);
  useEffect(() => setLocal(config), [config]);
  return (
    <Card className="mt-4" style={{ background: theme.card }}>
      <h3 className="text-lg font-semibold" style={{ color: theme.text }}>Scoring Rules</h3>
      <div className="grid sm:grid-cols-2 gap-3 mt-3 text-sm">
        <label className="flex items-center gap-2" style={{ color: theme.subtext }}>
          Season Name
          <Input value={local.seasonName} onChange={(e) => setLocal({ ...local, seasonName: e.target.value })} className="flex-1 bg-black/30 text-gray-100" />
        </label>
        <label className="flex items-center gap-2" style={{ color: theme.subtext }}>
          Weekly Point Cap
          <Input type="number" value={local.weeklyPointCap} onChange={(e) => setLocal({ ...local, weeklyPointCap: +e.target.value })} className="flex-1 bg-black/30 text-gray-100" />
        </label>
        <label className="flex items-center gap-2" style={{ color: theme.subtext }}>
          Points per lb lost
          <Input type="number" value={local.weightPointsPerLb} onChange={(e) => setLocal({ ...local, weightPointsPerLb: +e.target.value })} className="flex-1 bg-black/30 text-gray-100" />
        </label>
        <label className="flex items-center gap-2" style={{ color: theme.subtext }}>
          Streak bonus starts after days
          <Input type="number" value={local.awardStreakAfterDays} onChange={(e) => setLocal({ ...local, awardStreakAfterDays: +e.target.value })} className="flex-1 bg-black/30 text-gray-100" />
        </label>
      </div>
      <div className="grid sm:grid-cols-3 gap-3 mt-3 text-sm" style={{ color: theme.subtext }}>
        {Object.entries(local.points).map(([k, v]) => (
          <label key={k} className="flex items-center gap-2">
            {k}
            <Input type="number" value={v} onChange={(e) => setLocal({ ...local, points: { ...local.points, [k]: +e.target.value } })} className="flex-1 bg-black/30 text-gray-100" />
          </label>
        ))}
      </div>
      <div className="mt-4 flex gap-2">
        <Button style={{ background: theme.accent, color: "#0b0b0b" }} onClick={() => onUpdate(local)}>Save Rules</Button>
        <Button style={{ background: theme.accent2, color: "#0b0b0b" }} onClick={() => onUpdate(DEFAULT_CONFIG)}>Reset</Button>
      </div>
    </Card>
  );
}

function PlayerSetup({ players, onUpdate }) {
  const [local, setLocal] = useState(players);
  useEffect(() => setLocal(players), [players]);
  const updateField = (id, field, value) => setLocal((prev) => prev.map((p) => (p.id === id ? { ...p, [field]: value } : p)));
  return (
    <Card className="mt-4" style={{ background: theme.card }}>
      <h3 className="text-lg font-semibold" style={{ color: theme.text }}>Players</h3>
      <div className="grid md:grid-cols-2 gap-3 mt-3">
        {local.map((p) => (
          <div key={p.id} className="rounded-2xl p-3" style={{ background: "#0c162b" }}>
            <div className="text-sm" style={{ color: theme.subtext }}>Name</div>
            <Input className="w-full bg-black/30 text-gray-100" value={p.name} onChange={(e) => updateField(p.id, "name", e.target.value)} />
            <div className="grid grid-cols-2 gap-2 mt-2">
              <div>
                <div className="text-sm" style={{ color: theme.subtext }}>Start Weight (lb)</div>
                <Input type="number" className="w-full bg-black/30 text-gray-100" value={p.startWeight ?? ""} onChange={(e) => updateField(p.id, "startWeight", e.target.value ? +e.target.value : null)} />
              </div>
              <div>
                <div className="text-sm" style={{ color: theme.subtext }}>Current Weight (lb)</div>
                <Input type="number" className="w-full bg-black/30 text-gray-100" value={p.currentWeight ?? ""} onChange={(e) => updateField(p.id, "currentWeight", e.target.value ? +e.target.value : null)} />
              </div>
            </div>
          </div>
        ))}
      </div>
      <div className="mt-3 flex gap-2">
        <Button style={{ background: theme.accent, color: "#0b0b0b" }} onClick={() => onUpdate(local)}>Save Players</Button>
        <Button style={{ background: theme.accent2, color: "#0b0b0b" }} onClick={() => onUpdate(DEFAULT_STATE.players)}>Reset</Button>
      </div>
    </Card>
  );
}
function ActivityLogger({ players, config, onLog }) {
  const [who, setWho] = useState(players[0]?.id || "p1");
  const [type, setType] = useState("workout");
  const [value, setValue] = useState(0);
  const [note, setNote] = useState("");
  const calcPoints = () => {
    if (type === "workout") return config.points.workout;
    if (type === "steps5k") return config.points.steps5k * value;
    if (type === "active10Min") return config.points.active10Min * value;
    if (type === "pr") return config.points.pr;
    return 0;
  };
  return (
    <Card className="mt-4" style={{ background: theme.card }}>
      <h3 className="text-lg font-semibold" style={{ color: theme.text }}>Log Activity</h3>
      <div className="grid sm:grid-cols-4 gap-3 mt-3 text-sm">
        <label className="flex flex-col gap-1" style={{ color: theme.subtext }}>
          Player
          <Select value={who} onChange={(e) => setWho(e.target.value)} className="bg-black/30 text-gray-100">
            {players.map((p) => (<option key={p.id} value={p.id}>{p.name}</option>))}
          </Select>
        </label>
        <label className="flex flex-col gap-1" style={{ color: theme.subtext }}>
          Type
          <Select value={type} onChange={(e) => setType(e.target.value)} className="bg-black/30 text-gray-100">
            <option value="workout">Workout</option>
            <option value="steps5k">Steps (per 5k)</option>
            <option value="active10Min">Active Minutes (per 10min)</option>
            <option value="pr">PR Bonus</option>
          </Select>
        </label>
        {(type === "steps5k" || type === "active10Min") && (
          <label className="flex flex-col gap-1" style={{ color: theme.subtext }}>
            Count
            <Input type="number" value={value} onChange={(e) => setValue(+e.target.value)} className="bg-black/30 text-gray-100" />
          </label>
        )}
        <label className="flex flex-col gap-1 sm:col-span-2" style={{ color: theme.subtext }}>
          Note (optional)
          <Input value={note} onChange={(e) => setNote(e.target.value)} className="bg-black/30 text-gray-100" />
        </label>
      </div>
      <div className="mt-3 flex items-center gap-3">
        <Button style={{ background: theme.accent, color: "#0b0b0b" }} onClick={() => { const pts = calcPoints(); onLog({ who, type, value, note, points: pts, when: Date.now() }); setValue(0); setNote(""); }}>Add +{calcPoints()} pts</Button>
        <div className="text-sm" style={{ color: theme.subtext }}>Weekly cap: {config.weeklyPointCap} pts (to keep things healthy)</div>
      </div>
    </Card>
  );
}

function WeighIn({ players, config, onWeigh }) {
  const [who, setWho] = useState(players[0]?.id || "p1");
  const [weight, setWeight] = useState("");
  return (
    <Card className="mt-4" style={{ background: theme.card }}>
      <h3 className="text-lg font-semibold" style={{ color: theme.text }}>Weigh-In</h3>
      <div className="grid sm:grid-cols-3 gap-3 mt-3 text-sm">
        <label className="flex flex-col gap-1" style={{ color: theme.subtext }}>
          Player
          <Select value={who} onChange={(e) => setWho(e.target.value)} className="bg-black/30 text-gray-100">
            {players.map((p) => (<option key={p.id} value={p.id}>{p.name}</option>))}
          </Select>
        </label>
        <label className="flex flex-col gap-1" style={{ color: theme.subtext }}>
          Current Weight (lb)
          <Input type="number" value={weight} onChange={(e) => setWeight(e.target.value)} className="bg-black/30 text-gray-100" />
        </label>
      </div>
      <div className="mt-3 flex items-center gap-3">
        <Button style={{ background: theme.success, color: "#0b0b0b" }} onClick={() => {
          const w = parseFloat(weight); if (Number.isNaN(w)) return; onWeigh({ who, weight: w, when: Date.now() }); setWeight("");
        }}>Save Weigh-In</Button>
        <div className="text-sm" style={{ color: theme.subtext }}>{config.weightPointsPerLb} pts per lb lost from your start weight (no points for gains).</div>
      </div>
    </Card>
  );
}

function Rewards({ ideas, onAdd }) {
  const [value, setValue] = useState("");
  return (
    <Card className="mt-4" style={{ background: theme.card }}>
      <h3 className="text-lg font-semibold" style={{ color: theme.text }}>Rewards & Stakes</h3>
      <ul className="list-disc ml-5 text-sm" style={{ color: theme.subtext }}>
        {ideas.map((r, i) => (<li key={i}>{r}</li>))}
      </ul>
      <div className="flex gap-2 mt-3">
        <Input className="flex-1 bg-black/30 text-gray-100" placeholder="Add a custom reward..." value={value} onChange={(e) => setValue(e.target.value)} />
        <Button style={{ background: theme.accent2, color: "#0b0b0b" }} onClick={() => { if (!value.trim()) return; onAdd(value.trim()); setValue(""); }}>Add</Button>
      </div>
    </Card>
  );
}

function SmackTalk({ chat, onSend, bannedWords }) {
  const [msg, setMsg] = useState("");
  const [from, setFrom] = useState("You");
  const filterMsg = (t) => {
    let clean = t; bannedWords.forEach((w) => { const re = new RegExp(`\\b${w}\\b`, "gi"); clean = clean.replace(re, "✨"); }); return clean;
  };
  return (
    <Card className="mt-4" style={{ background: theme.card }}>
      <h3 className="text-lg font-semibold" style={{ color: theme.text }}>Smack Talk (nice edition)</h3>
      <div className="max-h-64 overflow-auto rounded-2xl p-3 mt-2" style={{ background: "#0c162b" }}>
        {chat.length === 0 && (<div className="text-sm" style={{ color: theme.subtext }}>No messages yet. Start the banter 👇</div>)}
        {chat.map((c, idx) => (
          <div key={idx} className="mb-2">
            <div className="text-xs" style={{ color: theme.subtext }}>{c.from} • {niceDate(c.when)}</div>
            <div style={{ color: theme.text }}>{c.text}</div>
          </div>
        ))}
      </div>
      <div className="flex gap-2 mt-3">
        <Select value={from} onChange={(e) => setFrom(e.target.value)} className="bg-black/30 text-gray-100">
          <option>You</option>
          <option>Friend</option>
        </Select>
        <Input className="flex-1 bg-black/30 text-gray-100" placeholder="Playful jab..." value={msg} onChange={(e) => setMsg(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { if (!msg.trim()) return; onSend({ from, text: filterMsg(msg), when: Date.now() }); setMsg(""); } }} />
        <Button style={{ background: theme.accent, color: "#0b0b0b" }} onClick={() => { if (!msg.trim()) return; onSend({ from, text: filterMsg(msg), when: Date.now() }); setMsg(""); }}>Send</Button>
      </div>
      <div className="text-xs mt-2" style={{ color: theme.subtext }}>Tip: Keep it playful. The app will ✨-out spicy words.</div>
    </Card>
  );
}
// PWA
function usePWA() {
  useEffect(() => {
    const manifest = {
      name: "Exercise Competition",
      short_name: "ExerciseComp",
      start_url: ".",
      display: "standalone",
      background_color: "#0f172a",
      theme_color: "#22d3ee",
      icons: [
        { src: "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><rect width='100' height='100' fill='%2322d3ee'/><text x='50' y='60' font-size='60' text-anchor='middle' fill='black'>🏆</text></svg>", sizes: "192x192", type: "image/svg+xml" }
      ]
    };
    const blob = new Blob([JSON.stringify(manifest)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("link");
    link.rel = "manifest"; link.href = url; document.head.appendChild(link);

    if ("serviceWorker" in navigator) {
      const swCode = `
        const CACHE = 'exercise-comp-v1';
        const CORE = self.__CORE || ['.'];
        self.addEventListener('install', e => {
          e.waitUntil(caches.open(CACHE).then(c => c.addAll(CORE)).then(()=>self.skipWaiting()));
        });
        self.addEventListener('activate', e => { e.waitUntil(self.clients.claim()); });
        self.addEventListener('fetch', e => {
          const req = e.request;
          e.respondWith(
            caches.match(req).then(cached => cached || fetch(req).then(res => {
              const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); return res;
            }).catch(()=>cached))
          );
        });`;
      const blobSW = new Blob([swCode], { type: "text/javascript" });
      const swUrl = URL.createObjectURL(blobSW);
      navigator.serviceWorker.register(swUrl).catch(() => {});
    }
  }, []);
}

function SyncPanel({ sync, setSync, onConnect, onDisconnect }) {
  const [room, setRoom] = useState(sync.roomId || "");
  const [cfg, setCfg] = useState(sync.firebaseConfigString || "");
  return (
    <Card className="mt-4" style={{ background: theme.card }}>
      <h3 className="text-lg font-semibold" style={{ color: theme.text }}>Live Sync (Optional)</h3>
      <ol className="list-decimal ml-5 text-sm" style={{ color: theme.subtext }}>
        <li>Create a Firebase project → Firestore (test or prod) → enable Anonymous Auth.</li>
        <li>Copy the Firebase web config JSON and paste below.</li>
        <li>Pick a Room ID (e.g., <code>oct-throwdown-2025</code>). Share it with your friend.</li>
      </ol>
      <div className="grid gap-3 mt-3 text-sm">
        <label style={{ color: theme.subtext }}>Room ID
          <Input className="w-full bg-black/30 text-gray-100" placeholder="your-room-id" value={room} onChange={(e) => setRoom(e.target.value)} />
        </label>
        <label style={{ color: theme.subtext }}>Firebase Config (paste JSON from console)
          <textarea className="w-full bg-black/30 text-gray-100 rounded-xl p-2" rows={5} value={cfg} onChange={(e) => setCfg(e.target.value)} placeholder='{"apiKey":"...","authDomain":"...","projectId":"...","appId":"..."}' />
        </label>
      </div>
      <div className="flex gap-2 mt-3 items-center">
        {sync.connected ? (
          <>
            <Button style={{ background: theme.warn, color: "#0b0b0b" }} onClick={onDisconnect}>Disconnect</Button>
            <div className="text-xs" style={{ color: theme.subtext }}>Status: {sync.status}</div>
          </>
        ) : (
          <Button style={{ background: theme.accent, color: "#0b0b0b" }} onClick={() => onConnect({ roomId: room.trim(), firebaseConfigString: cfg.trim() })}>Connect</Button>
        )}
      </div>
      {sync.error && <div className="text-xs mt-2" style={{ color: theme.danger }}>Error: {String(sync.error)}</div>}
    </Card>
  );
}

export default function App() {
  usePWA();
  const [state, setState] = useLocalState(DEFAULT_STATE);
  const { players, config, chat, seasonIndex } = state;

  const [sync, setSync] = useState(() => {
    try {
      const raw = localStorage.getItem("exercise_sync_cfg");
      return raw ? JSON.parse(raw) : { connected: false, status: "idle", roomId: "", firebaseConfigString: "" };
    } catch {
      return { connected: false, status: "idle", roomId: "", firebaseConfigString: "" };
    }
  });
  useEffect(() => { localStorage.setItem("exercise_sync_cfg", JSON.stringify(sync)); }, [sync]);
  const firestoreRef = useRef(null);
  const unsubRef = useRef(null);
  const pushingRef = useRef(false);
  const lastRemoteAtRef = useRef(0);

  const currentWeekKey = useMemo(() => {
    const d = new Date(); const first = new Date(d.getFullYear(), 0, 1);
    const days = Math.floor((d - first) / 86400000); const week = Math.ceil((d.getDay() + 1 + days) / 7);
    return `${d.getFullYear()}-W${week}`;
  }, []);

  const weeklyTotals = useMemo(() => {
    const map = Object.fromEntries(players.map((p) => [p.id, 0]));
    players.forEach((p) => { p.activities.forEach((a) => { const k = a.weekKey || currentWeekKey; if (k === currentWeekKey) map[p.id] += a.points; }); });
    return map;
  }, [players, currentWeekKey]);

  const markUpdated = (draft) => ({
    ...draft,
    _meta: { updatedAt: Date.now(), updatedBy: deviceId, version: (draft?._meta?.version || 0) + 1 },
  });

  const addPoints = (playerId, pts, activity) => {
    const weekUsed = weeklyTotals[playerId] || 0; const remaining = config.weeklyPointCap - weekUsed; const grant = Math.max(0, Math.min(pts, Math.max(0, remaining)));
    setState((prev) => markUpdated({
      ...prev,
      players: prev.players.map((p) => p.id !== playerId ? p : { ...p, points: p.points + grant, activities: [...p.activities, { ...activity, points: grant, weekKey: currentWeekKey }] }),
    }));
  };

  const handleLogActivity = ({ who, type, value, note, points, when }) => addPoints(who, points, { type, value, note, when });

  const handleWeigh = ({ who, weight, when }) => {
    setState((prev) => {
      const target = prev.players.find((p) => p.id === who);
      const start = target?.startWeight ?? weight; const prevWeight = target?.currentWeight ?? start;
      const updPlayers = prev.players.map((p) => p.id !== who ? p : { ...p, startWeight: p.startWeight ?? start, currentWeight: weight, history: [...p.history, { when, weight }] });
      return markUpdated({ ...prev, players: updPlayers });
    });
    setTimeout(() => {
      const player = state.players.find((p) => p.id === who) || { startWeight: weight };
      const start = player.startWeight ?? weight; const totalLoss = Math.max(0, start - weight);
      const alreadyAwarded = (player.activities || []).filter((a) => a.type === "weigh-in-total").reduce((s, a) => s + a.points, 0);
      const toGrant = Math.max(0, Math.floor(totalLoss * state.config.weightPointsPerLb) - alreadyAwarded);
      if (toGrant > 0) addPoints(who, toGrant, { type: "weigh-in-total", value: totalLoss, when });
    }, 0);
  };

  const handleSendChat = (c) => setState((prev) => markUpdated({ ...prev, chat: [...prev.chat, c] }));
  const handleSaveConfig = (cfg) => setState((prev) => markUpdated({ ...prev, config: cfg }));
  const handleSavePlayers = (pl) => setState((prev) => markUpdated({ ...prev, players: pl }));

  const resetSeason = () => setState((prev) => markUpdated({ ...DEFAULT_STATE, config: prev.config, seasonIndex: prev.seasonIndex + 1, players: prev.players.map((p) => ({ ...p, points: 0, activities: [], history: [] })), startedAt: Date.now() }));
  const addReward = (r) => setState((prev) => markUpdated({ ...prev, config: { ...prev.config, rewardIdeas: [...prev.config.rewardIdeas, r] } }));

  const connect = async ({ roomId, firebaseConfigString }) => {
    if (!roomId) return setSync((s) => ({ ...s, error: "Room ID required" }));
    try {
      const cfg = JSON.parse(firebaseConfigString);
      const app = getApps().length ? getApps()[0] : initializeApp(cfg);
      const db = getFirestore(app);
      const auth = getAuth(app);
      await signInAnonymously(auth);
      firestoreRef.current = { db, docRef: doc(db, "rooms", roomId) };
      setSync({ connected: true, status: "connected", roomId, firebaseConfigString, error: null });
      if (unsubRef.current) unsubRef.current();
      unsubRef.current = onSnapshot(firestoreRef.current.docRef, (snap) => {
        const data = snap.data();
        if (!data) return;
        const remote = data.state;
        const remoteMeta = remote?._meta?.updatedAt || 0;
        if (remote._meta?.updatedBy === deviceId) return;
        if (remoteMeta <= lastRemoteAtRef.current) return;
        lastRemoteAtRef.current = remoteMeta;
        setState(remote);
      });
      await setDoc(firestoreRef.current.docRef, { state }, { merge: true });
    } catch (e) {
      setSync({ connected: false, status: "error", roomId: "", firebaseConfigString, error: e.message || String(e) });
    }
  };

  const disconnect = () => {
    if (unsubRef.current) { unsubRef.current(); unsubRef.current = null; }
    firestoreRef.current = null; setSync((s) => ({ ...s, connected: false, status: "idle" }));
  };

  const pushRemote = useRef(((fn, ms = 600) => {
    let t; return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
  })(async (next) => {
    try {
      if (!firestoreRef.current || !sync.connected) return;
      await setDoc(firestoreRef.current.docRef, { state: next, updatedAt: serverTimestamp() }, { merge: true });
    } catch (e) { /* ignore */ }
  })).current;

  useEffect(() => {
    if (!sync.connected) return;
    pushRemote(state);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, sync.connected]);

  // Auto-connect via env
  useEffect(() => {
    if (!AUTO_CONNECT || !FIREBASE_CONFIG || !DEFAULT_ROOM_ID) return;
    if (!sync.connected) {
      connect({ roomId: DEFAULT_ROOM_ID, firebaseConfigString: JSON.stringify(FIREBASE_CONFIG) });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [AUTO_CONNECT, DEFAULT_ROOM_ID, FIREBASE_CONFIG]);

  return (
    <div style={{ background: theme.bg, minHeight: "100vh" }} className="p-4 md:p-8">
      <div className="max-w-5xl mx-auto">
        <Header season={`${state.config.seasonName} • S${seasonIndex}`} />

        <div className="grid lg:grid-cols-3 gap-4 mt-4">
          <div className="lg:col-span-2">
            <Leaderboard players={players} />
            <div className="grid md:grid-cols-2 gap-4">
              <ActivityLogger players={players} config={config} onLog={handleLogActivity} />
              <WeighIn players={players} config={config} onWeigh={handleWeigh} />
            </div>
            <Rewards ideas={config.rewardIdeas} onAdd={addReward} />
            <SmackTalk chat={chat} onSend={handleSendChat} bannedWords={config.bannedWords} />
          </div>

          <div>
            <PlayerSetup players={players} onUpdate={handleSavePlayers} />
            <PointsConfig config={config} onUpdate={handleSaveConfig} />

            <Card className="mt-4" style={{ background: theme.card }}>
              <h3 className="text-lg font-semibold" style={{ color: theme.text }}>Season Tools</h3>
              <div className="flex gap-2 mt-3 flex-wrap">
                <Button style={{ background: theme.warn, color: "#0b0b0b" }} onClick={() => setState({ ...DEFAULT_STATE, config: state.config, seasonIndex: state.seasonIndex + 1, players: state.players.map(p => ({ ...p, points: 0, activities: [], history: [] })), startedAt: Date.now() })}>Start New Season</Button>
                <Button style={{ background: theme.accent, color: "#0b0b0b" }} onClick={() => navigator.clipboard?.writeText(btoa(JSON.stringify(state)))}>Copy Share Code</Button>
                <Button style={{ background: theme.accent2, color: "#0b0b0b" }} onClick={() => { const raw = prompt("Paste Share Code"); if (!raw) return; try { const parsed = JSON.parse(atob(raw)); setState(parsed); } catch { alert("Invalid code"); } }}>Import</Button>
              </div>
              <div className="text-xs mt-2" style={{ color: theme.subtext }}>
                Local-only by default. Use Live Sync below for instant cross-device updates. PWA is enabled — Add to Home Screen for an app-like feel.
              </div>
            </Card>

            <SyncPanel sync={sync} setSync={setSync} onConnect={connect} onDisconnect={() => { if (unsubRef.current) unsubRef.current(); unsubRef.current = null; setSync(s => ({ ...s, connected: false, status: "idle" })); }} />
          </div>
        </div>

        <footer className="mt-8 text-xs text-center" style={{ color: theme.subtext }}>
          Built for friendly rivalry. 💪
        </footer>
      </div>
    </div>
  );
}
