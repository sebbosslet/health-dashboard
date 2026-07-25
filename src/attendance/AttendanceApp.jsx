import { useState, useEffect, useRef } from "react";
import { Link } from "react-router-dom";
import { loadAttendance, saveAttendance } from "./store";

const DAY_TYPES = {
  office: { label: "In Office", color: "#2D6A4F", bg: "#D8F3DC", accent: "#52B788", emoji: "🏢" },
  remote: { label: "Remote", color: "#1565C0", bg: "#DBEAFE", accent: "#3B82F6", emoji: "🏠" },
  pto: { label: "PTO", color: "#7B2D8B", bg: "#F3E8FF", accent: "#A855F7", emoji: "🌴" },
  sick: { label: "Sick Day", color: "#C0392B", bg: "#FEE2E2", accent: "#EF4444", emoji: "🤒" },
  medical: { label: "Medical Leave", color: "#0F766E", bg: "#CCFBF1", accent: "#14B8A6", emoji: "🩺" },
  holiday: { label: "Holiday", color: "#B45309", bg: "#FEF3C7", accent: "#F59E0B", emoji: "🎉" },
  none: { label: "Unlogged", color: "#6B7280", bg: "#F3F4F6", accent: "#D1D5DB", emoji: "" },
};

const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];
const DAYS = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];

function getDaysInMonth(year, month) {
  return new Date(year, month + 1, 0).getDate();
}
function getFirstDayOfMonth(year, month) {
  return new Date(year, month, 1).getDay();
}
function isWeekend(year, month, day) {
  const d = new Date(year, month, day).getDay();
  return d === 0 || d === 6;
}
function toKey(year, month, day) {
  return `${year}-${String(month+1).padStart(2,"0")}-${String(day).padStart(2,"0")}`;
}
function today() {
  const d = new Date();
  return toKey(d.getFullYear(), d.getMonth(), d.getDate());
}

// Returns the observed date (Mon if Sun, Fri if Sat) as a Date
function observed(date) {
  const d = date.getDay();
  if (d === 0) return new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1);
  if (d === 6) return new Date(date.getFullYear(), date.getMonth(), date.getDate() - 1);
  return date;
}
function nthWeekday(year, month, weekday, n) {
  // e.g. 3rd Monday of month
  let count = 0, d = 1;
  while (d <= 31) {
    const date = new Date(year, month, d);
    if (date.getMonth() !== month) break;
    if (date.getDay() === weekday) { count++; if (count === n) return date; }
    d++;
  }
}
function lastWeekday(year, month, weekday) {
  let d = getDaysInMonth(year, month);
  while (d >= 1) {
    const date = new Date(year, month, d);
    if (date.getDay() === weekday) return date;
    d--;
  }
}
function getUSHolidays(year) {
  const holidays = {};
  function add(date, name) {
    const obs = observed(date);
    // Skip if falls on weekend (already handled by observed())
    const key = toKey(obs.getFullYear(), obs.getMonth(), obs.getDate());
    holidays[key] = name;
  }
  // Fixed holidays
  add(new Date(year, 0, 1),   "New Year's Day");
  add(new Date(year, 6, 4),   "Independence Day");
  add(new Date(year, 10, 11), "Veterans Day");
  add(new Date(year, 11, 25), "Christmas Day");
  // Floating holidays
  const mlk    = nthWeekday(year, 0, 1, 3);   // 3rd Mon Jan
  const presidents = nthWeekday(year, 1, 1, 3); // 3rd Mon Feb
  const memorial = lastWeekday(year, 4, 1);     // Last Mon May
  const labor  = nthWeekday(year, 8, 1, 1);    // 1st Mon Sep
  const columbus = nthWeekday(year, 9, 1, 2);  // 2nd Mon Oct
  const thanksgiving = nthWeekday(year, 10, 4, 4); // 4th Thu Nov
  if (mlk) add(mlk, "MLK Day");
  if (presidents) add(presidents, "Presidents' Day");
  if (memorial) add(memorial, "Memorial Day");
  add(new Date(year, 4, 26), ""); // placeholder replaced below
  if (labor) add(labor, "Labor Day");
  if (columbus) add(columbus, "Columbus Day");
  if (thanksgiving) {
    add(thanksgiving, "Thanksgiving");
    // Day after Thanksgiving (not federal but very common)
    const dayAfter = new Date(thanksgiving.getFullYear(), thanksgiving.getMonth(), thanksgiving.getDate() + 1);
    const key = toKey(dayAfter.getFullYear(), dayAfter.getMonth(), dayAfter.getDate());
    holidays[key] = "Day after Thanksgiving";
  }
  // Juneteenth (since 2021)
  if (year >= 2021) add(new Date(year, 5, 19), "Juneteenth");
  // New Year's Eve observed (if Jan 1 falls on Tue, Dec 31 prev year gets observed)
  // Also handle Jan 1 falling on Sat → Dec 31 observed
  const jan1 = new Date(year, 0, 1);
  if (jan1.getDay() === 6) {
    const dec31 = new Date(year - 1, 11, 31);
    const key = toKey(dec31.getFullYear(), dec31.getMonth(), dec31.getDate());
    holidays[key] = "New Year's Day (observed)";
  }
  return holidays;
}

function computeMonthStats(year, month, data) {
  const daysInMonth = getDaysInMonth(year, month);
  let workdays = 0, office = 0, remote = 0, pto = 0, sick = 0, medical = 0, holiday = 0, unlogged = 0;
  for (let d = 1; d <= daysInMonth; d++) {
    if (isWeekend(year, month, d)) continue;
    const key = toKey(year, month, d);
    const type = data[key] || "none";
    if (type === "holiday") { holiday++; continue; }
    workdays++;
    if (type === "office") office++;
    else if (type === "remote") remote++;
    else if (type === "pto") pto++;
    else if (type === "sick") sick++;
    else if (type === "medical") medical++;
    else unlogged++;
  }
  const eligibleDays = workdays - pto - sick - medical;
  const pct = eligibleDays > 0 ? Math.round((office / eligibleDays) * 100) : 0;
  return { workdays, office, remote, pto, sick, medical, holiday, unlogged, eligibleDays, pct };
}

export default function AttendanceApp({ session }) {
  const now = new Date();
  const [view, setView] = useState("calendar");
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth());
  const [data, setData] = useState({});
  const [selectedDay, setSelectedDay] = useState(null);
  const [pickerPos, setPickerPos] = useState({ x: 0, y: 0 });
  const [showImport, setShowImport] = useState(false);
  const [showExport, setShowExport] = useState(false);
  const [exportText, setExportText] = useState("");
  const [exportCopied, setExportCopied] = useState(false);
  const [importText, setImportText] = useState("");
  const [importError, setImportError] = useState("");
  const [importSuccess, setImportSuccess] = useState("");
  const todayKey = today();

  function handleExport() {
    const payload = JSON.stringify({ version: 1, data }, null, 2);
    setExportText(payload);
    setExportCopied(false);
    setShowExport(true);
  }

  function handleCopyExport() {
    try {
      const el = document.getElementById("export-textarea");
      el.select();
      el.setSelectionRange(0, 99999);
      document.execCommand("copy");
      setExportCopied(true);
      setTimeout(() => setExportCopied(false), 2000);
    } catch(e) {
      // fallback: try clipboard API
      navigator.clipboard.writeText(exportText).catch(() => {});
      setExportCopied(true);
      setTimeout(() => setExportCopied(false), 2000);
    }
  }

  async function handleImport() {
    setImportError("");
    setImportSuccess("");
    try {
      const parsed = JSON.parse(importText);
      const incoming = parsed.data || parsed;
      if (typeof incoming !== "object" || Array.isArray(incoming)) throw new Error("Invalid format");
      const validTypes = new Set(Object.keys(DAY_TYPES));
      for (const [k, v] of Object.entries(incoming)) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(k)) throw new Error(`Invalid date key: ${k}`);
        if (!validTypes.has(v)) throw new Error(`Invalid type "${v}" for ${k}`);
      }
      const merged = { ...data, ...incoming };
      setData(merged);
      const count = Object.keys(incoming).length;
      setImportSuccess(`Imported ${count} day${count !== 1 ? "s" : ""} successfully.`);
      setImportText("");
    } catch(e) {
      setImportError(`Could not parse: ${e.message}`);
    }
  }

  // Load from Supabase, then pre-populate US holidays without overwriting anything.
  const loaded = useRef(false);
  useEffect(() => {
    let alive = true;
    async function load() {
      const stored = (await loadAttendance(session.user.id)) || {};
      const thisYear = new Date().getFullYear();
      const merged = {};
      for (let y = thisYear - 1; y <= thisYear + 2; y++) {
        const holidays = getUSHolidays(y);
        Object.entries(holidays).forEach(([key, name]) => {
          if (name && !stored[key]) merged[key] = "holiday";
        });
      }
      if (alive) { setData({ ...merged, ...stored }); loaded.current = true; }
    }
    load();
    return () => { alive = false; };
  }, [session.user.id]);

  const saveTimer = useRef(null);
  useEffect(() => {
    if (!loaded.current) return;
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => saveAttendance(session.user.id, data), 500);
    return () => clearTimeout(saveTimer.current);
  }, [data, session.user.id]);

  function setDayType(key, type) {
    setData((prev) => {
      const newData = { ...prev };
      if (type === "none") delete newData[key];
      else newData[key] = type;
      return newData;
    });
    setSelectedDay(null);
  }

  function handleDayClick(e, day) {
    if (isWeekend(year, month, day)) return;
    const key = toKey(year, month, day);
    const rect = e.currentTarget.getBoundingClientRect();
    const containerRect = e.currentTarget.closest(".cal-container").getBoundingClientRect();
    let x = rect.left - containerRect.left;
    let y = rect.bottom - containerRect.top + 6;
    if (x + 220 > containerRect.width) x = containerRect.width - 224;
    if (y + 260 > containerRect.height + 40) y = rect.top - containerRect.top - 264;
    setPickerPos({ x, y });
    setSelectedDay(selectedDay === key ? null : key);
  }

  const stats = computeMonthStats(year, month, data);
  const daysInMonth = getDaysInMonth(year, month);
  const firstDay = getFirstDayOfMonth(year, month);

  function prevMonth() {
    if (month === 0) { setMonth(11); setYear(y => y - 1); }
    else setMonth(m => m - 1);
    setSelectedDay(null);
  }
  function nextMonth() {
    if (month === 11) { setMonth(0); setYear(y => y + 1); }
    else setMonth(m => m + 1);
    setSelectedDay(null);
  }

  const meetingTarget = stats.pct >= 60;
  const ringColor = meetingTarget ? "#2D6A4F" : stats.pct >= 40 ? "#F59E0B" : "#EF4444";

  // Build year summary
  function getYearStats() {
    const rows = [];
    for (let m = 0; m < 12; m++) {
      const s = computeMonthStats(year, m, data);
      rows.push({ month: MONTHS[m], ...s });
    }
    return rows;
  }

  const yearStats = getYearStats();

  // YTD compliance: only count months/days up to today (for the currently viewed year)
  function computeYTDStats() {
    if (year > now.getFullYear()) return { office: 0, eligible: 0, pct: 0 };
    let office = 0, eligible = 0;
    const maxMonth = year < now.getFullYear() ? 11 : now.getMonth();
    for (let m = 0; m <= maxMonth; m++) {
      const daysInMonth = getDaysInMonth(year, m);
      const maxDay = (year === now.getFullYear() && m === now.getMonth()) ? now.getDate() : daysInMonth;
      for (let d = 1; d <= maxDay; d++) {
        if (isWeekend(year, m, d)) continue;
        const key = toKey(year, m, d);
        const type = data[key] || "none";
        if (type === "holiday") continue;
        eligible++;
        if (type === "pto" || type === "sick" || type === "medical") { eligible--; continue; }
        if (type === "office") office++;
      }
    }
    const pct = eligible > 0 ? Math.round((office / eligible) * 100) : 0;
    return { office, eligible, pct };
  }
  const ytd = computeYTDStats();
  const yearOffice = yearStats.reduce((a,r)=>a+r.office,0);
  const yearEligible = yearStats.reduce((a,r)=>a+r.eligibleDays,0);
  const yearPct = ytd.pct;

  return (
    <div style={{
      fontFamily: "'DM Sans', 'Segoe UI', sans-serif",
      background: "#F8F7F4",
      minHeight: "100vh",
      padding: "0",
      color: "#1C1C1E"
    }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600;700&family=DM+Mono:wght@400;500&display=swap');
        * { box-sizing: border-box; margin: 0; padding: 0; }
        .cal-day:hover { transform: scale(1.04); }
        .cal-day { transition: transform 0.12s ease, box-shadow 0.12s ease; cursor: pointer; }
        .cal-day.weekend { cursor: default; opacity: 0.45; }
        .day-picker-btn:hover { filter: brightness(0.92); }
        .tab-btn { transition: all 0.15s ease; }
        .nav-btn:hover { background: #E5E7EB !important; }
        .ring-track { transform: rotate(-90deg); transform-origin: center; }
        @keyframes fadeIn { from { opacity:0; transform:translateY(6px);} to { opacity:1; transform:translateY(0);} }
        .picker-popup { animation: fadeIn 0.15s ease; }
        @keyframes barGrow { from { width: 0; } to { width: var(--bar-w); } }
        .bar-fill { animation: barGrow 0.6s cubic-bezier(.4,0,.2,1) forwards; }
      `}</style>

      {/* Header */}
      <div style={{ background: "#1C1C1E", padding: "20px 32px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <Link to="/" style={{ position: "absolute", left: 20, top: 24, color: "#6B7280", fontSize: 13, textDecoration: "none", fontFamily: "'DM Sans', sans-serif" }}>← apps</Link>
        <div>
          <div style={{ color: "#F8F7F4", fontSize: 22, fontWeight: 700, letterSpacing: "-0.5px" }}>
            Office Tracker
          </div>
          <div style={{ color: "#9CA3AF", fontSize: 13, marginTop: 2 }}>3-of-5 day in-office requirement</div>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <button onClick={handleExport} style={{
            border: "1px solid #3C3C3E", background: "transparent", borderRadius: 8, padding: "7px 14px",
            cursor: "pointer", fontSize: 12, fontWeight: 600, color: "#9CA3AF", fontFamily: "inherit", display: "flex", alignItems: "center", gap: 6
          }}>⬆ Export</button>
          <button onClick={() => { setShowImport(true); setImportError(""); setImportSuccess(""); }} style={{
            border: "1px solid #3C3C3E", background: "transparent", borderRadius: 8, padding: "7px 14px",
            cursor: "pointer", fontSize: 12, fontWeight: 600, color: "#9CA3AF", fontFamily: "inherit", display: "flex", alignItems: "center", gap: 6
          }}>⬆ Import</button>
          <div style={{ width: 1, height: 24, background: "#3C3C3E" }} />
          <div style={{ display: "flex", gap: 6, background: "#2C2C2E", borderRadius: 10, padding: 4 }}>
            {["calendar","overview"].map(v => (
              <button key={v} className="tab-btn" onClick={() => setView(v)} style={{
                padding: "7px 18px", borderRadius: 7, border: "none", cursor: "pointer", fontSize: 13, fontWeight: 600,
                background: view === v ? "#F8F7F4" : "transparent",
                color: view === v ? "#1C1C1E" : "#9CA3AF",
                fontFamily: "inherit"
              }}>{v === "calendar" ? "📅 Calendar" : "📊 Overview"}</button>
            ))}
          </div>
        </div>
      </div>

      {/* Export Modal */}
      {showExport && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 200, display: "flex", alignItems: "center", justifyContent: "center" }}
          onClick={(e) => e.target === e.currentTarget && setShowExport(false)}>
          <div style={{ background: "white", borderRadius: 18, padding: 28, width: 520, maxWidth: "90vw", boxShadow: "0 20px 60px rgba(0,0,0,0.3)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18 }}>
              <div>
                <div style={{ fontSize: 18, fontWeight: 700 }}>Export Data</div>
                <div style={{ fontSize: 13, color: "#6B7280", marginTop: 2 }}>Copy this JSON and share it with your collaborator</div>
              </div>
              <button onClick={() => setShowExport(false)} style={{ border: "none", background: "#F3F4F6", borderRadius: 8, width: 32, height: 32, cursor: "pointer", fontSize: 18, color: "#6B7280" }}>×</button>
            </div>
            <textarea
              id="export-textarea"
              readOnly
              value={exportText}
              onFocus={e => e.target.select()}
              style={{
                width: "100%", height: 200, borderRadius: 10, border: "1.5px solid #E5E7EB",
                padding: 12, fontFamily: "DM Mono, monospace", fontSize: 11, resize: "none",
                outline: "none", color: "#1C1C1E", background: "#FAFAFA", cursor: "text"
              }}
            />
            <div style={{ display: "flex", gap: 10, marginTop: 16, justifyContent: "flex-end" }}>
              <button onClick={() => setShowExport(false)} style={{
                border: "1.5px solid #E5E7EB", background: "white", borderRadius: 9, padding: "9px 20px",
                cursor: "pointer", fontSize: 13, fontWeight: 600, color: "#6B7280", fontFamily: "inherit"
              }}>Close</button>
              <button onClick={handleCopyExport} style={{
                border: "none", background: exportCopied ? "#2D6A4F" : "#1C1C1E", borderRadius: 9, padding: "9px 20px",
                cursor: "pointer", fontSize: 13, fontWeight: 600, color: "white", fontFamily: "inherit",
                transition: "background 0.2s"
              }}>{exportCopied ? "✓ Copied!" : "Copy to Clipboard"}</button>
            </div>
          </div>
        </div>
      )}

      {/* Import Modal */}
      {showImport && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 200, display: "flex", alignItems: "center", justifyContent: "center" }}
          onClick={(e) => e.target === e.currentTarget && setShowImport(false)}>
          <div style={{ background: "white", borderRadius: 18, padding: 28, width: 480, maxWidth: "90vw", boxShadow: "0 20px 60px rgba(0,0,0,0.3)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18 }}>
              <div>
                <div style={{ fontSize: 18, fontWeight: 700 }}>Import Data</div>
                <div style={{ fontSize: 13, color: "#6B7280", marginTop: 2 }}>Paste exported JSON from your collaborator</div>
              </div>
              <button onClick={() => setShowImport(false)} style={{ border: "none", background: "#F3F4F6", borderRadius: 8, width: 32, height: 32, cursor: "pointer", fontSize: 18, color: "#6B7280" }}>×</button>
            </div>
            <textarea
              value={importText}
              onChange={e => { setImportText(e.target.value); setImportError(""); setImportSuccess(""); }}
              placeholder={'Paste JSON here...\n{\n  "version": 1,\n  "data": { ... }\n}'}
              style={{
                width: "100%", height: 180, borderRadius: 10, border: "1.5px solid #E5E7EB",
                padding: 12, fontFamily: "DM Mono, monospace", fontSize: 12, resize: "vertical",
                outline: "none", color: "#1C1C1E", background: "#FAFAFA"
              }}
            />
            {importError && <div style={{ marginTop: 8, fontSize: 13, color: "#C0392B", fontWeight: 500 }}>⚠ {importError}</div>}
            {importSuccess && <div style={{ marginTop: 8, fontSize: 13, color: "#2D6A4F", fontWeight: 600 }}>✓ {importSuccess}</div>}
            <div style={{ display: "flex", gap: 10, marginTop: 16, justifyContent: "flex-end" }}>
              <button onClick={() => setShowImport(false)} style={{
                border: "1.5px solid #E5E7EB", background: "white", borderRadius: 9, padding: "9px 20px",
                cursor: "pointer", fontSize: 13, fontWeight: 600, color: "#6B7280", fontFamily: "inherit"
              }}>Cancel</button>
              <button onClick={handleImport} disabled={!importText.trim()} style={{
                border: "none", background: importText.trim() ? "#1C1C1E" : "#E5E7EB", borderRadius: 9, padding: "9px 20px",
                cursor: importText.trim() ? "pointer" : "default", fontSize: 13, fontWeight: 600,
                color: importText.trim() ? "white" : "#9CA3AF", fontFamily: "inherit"
              }}>Merge & Import</button>
            </div>
          </div>
        </div>
      )}

      {view === "calendar" && (
        <div style={{ maxWidth: 860, margin: "0 auto", padding: "28px 24px" }}>
          {/* Month nav + stats bar */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
              <button className="nav-btn" onClick={prevMonth} style={{ border: "none", background: "#EBEBEB", borderRadius: 8, width: 34, height: 34, cursor: "pointer", fontSize: 16, display: "flex", alignItems: "center", justifyContent: "center" }}>‹</button>
              <h2 style={{ fontSize: 24, fontWeight: 700, letterSpacing: "-0.5px", minWidth: 220 }}>
                {MONTHS[month]} <span style={{ color: "#9CA3AF", fontWeight: 400 }}>{year}</span>
              </h2>
              <button className="nav-btn" onClick={nextMonth} style={{ border: "none", background: "#EBEBEB", borderRadius: 8, width: 34, height: 34, cursor: "pointer", fontSize: 16, display: "flex", alignItems: "center", justifyContent: "center" }}>›</button>
            </div>
            <button onClick={() => { setYear(now.getFullYear()); setMonth(now.getMonth()); }} style={{
              border: "1.5px solid #D1D5DB", background: "white", borderRadius: 8, padding: "6px 14px",
              cursor: "pointer", fontSize: 12, fontWeight: 600, color: "#6B7280", fontFamily: "inherit"
            }}>Today</button>
          </div>

          {/* Stats chips */}
          <div style={{ display: "flex", gap: 10, marginBottom: 22, flexWrap: "wrap", alignItems: "center" }}>
            {/* Compliance ring */}
            <div style={{
              background: "white", borderRadius: 12, padding: "10px 16px", display: "flex", alignItems: "center", gap: 12,
              border: `2px solid ${meetingTarget ? "#D8F3DC" : "#FEE2E2"}`,
              boxShadow: "0 1px 4px rgba(0,0,0,0.06)"
            }}>
              <svg width={44} height={44} viewBox="0 0 44 44">
                <circle cx={22} cy={22} r={18} fill="none" stroke="#F3F4F6" strokeWidth={5} />
                <circle className="ring-track" cx={22} cy={22} r={18} fill="none" stroke={ringColor} strokeWidth={5}
                  strokeDasharray={`${2 * Math.PI * 18}`}
                  strokeDashoffset={`${2 * Math.PI * 18 * (1 - stats.pct / 100)}`}
                  strokeLinecap="round" style={{ transformOrigin: "22px 22px", transform: "rotate(-90deg)", transition: "stroke-dashoffset 0.5s ease" }}
                />
                <text x={22} y={26} textAnchor="middle" fontSize={11} fontWeight={700} fill={ringColor} fontFamily="DM Mono, monospace">{stats.pct}%</text>
              </svg>
              <div>
                <div style={{ fontSize: 12, color: "#6B7280", fontWeight: 500 }}>Office Compliance</div>
                <div style={{ fontSize: 13, fontWeight: 700, color: meetingTarget ? "#2D6A4F" : "#C0392B" }}>
                  {stats.office}/{stats.eligibleDays} days {meetingTarget ? "✓" : "✗"}
                </div>
              </div>
            </div>
            {[
              { type: "office", val: stats.office },
              { type: "remote", val: stats.remote },
              { type: "pto", val: stats.pto },
              { type: "sick", val: stats.sick },
              { type: "holiday", val: stats.holiday },
            ].map(({ type, val }) => (
              <div key={type} style={{
                background: DAY_TYPES[type].bg, borderRadius: 10, padding: "8px 14px",
                display: "flex", alignItems: "center", gap: 7,
                border: `1.5px solid ${DAY_TYPES[type].accent}33`
              }}>
                <span style={{ fontSize: 15 }}>{DAY_TYPES[type].emoji}</span>
                <div>
                  <div style={{ fontSize: 18, fontWeight: 700, color: DAY_TYPES[type].color, lineHeight: 1, fontFamily: "DM Mono, monospace" }}>{val}</div>
                  <div style={{ fontSize: 10, color: DAY_TYPES[type].color, fontWeight: 500, opacity: 0.8 }}>{DAY_TYPES[type].label}</div>
                </div>
              </div>
            ))}
          </div>

          {/* Calendar grid */}
          <div className="cal-container" style={{ background: "white", borderRadius: 16, padding: 20, boxShadow: "0 2px 12px rgba(0,0,0,0.06)", position: "relative" }}>
            {/* Day headers */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 6, marginBottom: 8 }}>
              {DAYS.map(d => (
                <div key={d} style={{ textAlign: "center", fontSize: 11, fontWeight: 700, color: "#9CA3AF", padding: "4px 0", letterSpacing: "0.05em" }}>{d}</div>
              ))}
            </div>
            {/* Days */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 6 }}>
              {Array.from({ length: firstDay }).map((_, i) => <div key={`e-${i}`} />)}
              {(() => { const yearHolidays = getUSHolidays(year); return Array.from({ length: daysInMonth }).map((_, i) => {
                const day = i + 1;
                const key = toKey(year, month, day);
                const weekend = isWeekend(year, month, day);
                const type = data[key] || "none";
                const isToday = key === todayKey;
                const isSelected = selectedDay === key;
                const dt = DAY_TYPES[type];
                const holidayName = yearHolidays[key];
                return (
                  <div
                    key={day}
                    className={`cal-day${weekend ? " weekend" : ""}`}
                    onClick={(e) => !weekend && handleDayClick(e, day)}
                    title={holidayName || undefined}
                    style={{
                      borderRadius: 10,
                      padding: "8px 6px",
                      minHeight: 58,
                      background: type !== "none" ? dt.bg : (weekend ? "#FAFAFA" : "white"),
                      border: isSelected ? `2.5px solid ${dt.accent || "#6B7280"}` : isToday ? "2.5px solid #1C1C1E" : `1.5px solid ${type !== "none" ? dt.accent + "55" : "#F0F0F0"}`,
                      display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 3,
                      position: "relative",
                      boxShadow: isSelected ? `0 0 0 3px ${(dt.accent || "#6B7280")}33` : "none"
                    }}
                  >
                    <div style={{
                      fontSize: 13, fontWeight: isToday ? 800 : 600,
                      color: type !== "none" ? dt.color : (weekend ? "#C4C4C4" : "#1C1C1E"),
                      fontFamily: "DM Mono, monospace"
                    }}>{day}</div>
                    {type !== "none" && <div style={{ fontSize: 16 }}>{dt.emoji}</div>}
                    {type === "holiday" && holidayName && (
                      <div style={{ fontSize: 8, color: DAY_TYPES.holiday.color, fontWeight: 600, textAlign: "center", lineHeight: 1.2, maxWidth: "90%", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{holidayName}</div>
                    )}
                    {isToday && <div style={{ position: "absolute", top: 4, right: 5, width: 6, height: 6, borderRadius: "50%", background: "#1C1C1E" }} />}
                  </div>
                );
              });})()}
            </div>

            {/* Day type picker popup */}
            {selectedDay && (
              <div className="picker-popup" style={{
                position: "absolute",
                left: pickerPos.x,
                top: pickerPos.y,
                background: "white",
                borderRadius: 14,
                boxShadow: "0 8px 32px rgba(0,0,0,0.16)",
                border: "1px solid #E5E7EB",
                padding: 10,
                zIndex: 100,
                width: 210,
              }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: "#9CA3AF", padding: "2px 8px 8px", letterSpacing: "0.06em" }}>
                  {new Date(year, month, parseInt(selectedDay.split("-")[2])).toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" })}
                </div>
                {Object.entries(DAY_TYPES).map(([key, dt]) => (
                  <button key={key} className="day-picker-btn" onClick={() => setDayType(selectedDay, key)} style={{
                    display: "flex", alignItems: "center", gap: 10,
                    width: "100%", padding: "9px 10px", border: "none", borderRadius: 9,
                    background: data[selectedDay] === key ? dt.bg : "transparent",
                    cursor: "pointer", fontFamily: "inherit", textAlign: "left",
                    outline: data[selectedDay] === key ? `2px solid ${dt.accent}` : "none",
                    marginBottom: 2
                  }}>
                    <span style={{ fontSize: 16, minWidth: 20 }}>{dt.emoji || "○"}</span>
                    <span style={{ fontSize: 13, fontWeight: 600, color: dt.color }}>{dt.label}</span>
                    {data[selectedDay] === key && <span style={{ marginLeft: "auto", fontSize: 12, color: dt.color }}>✓</span>}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Legend */}
          <div style={{ display: "flex", gap: 16, marginTop: 14, flexWrap: "wrap", justifyContent: "center" }}>
            {Object.entries(DAY_TYPES).filter(([k]) => k !== "none").map(([k, dt]) => (
              <div key={k} style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 12, color: "#6B7280" }}>
                <div style={{ width: 10, height: 10, borderRadius: 3, background: dt.accent }} />
                {dt.label}
              </div>
            ))}
          </div>
        </div>
      )}

      {view === "overview" && (
        <div style={{ maxWidth: 860, margin: "0 auto", padding: "28px 24px" }}>
          {/* Year nav */}
          <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 24 }}>
            <button className="nav-btn" onClick={() => setYear(y => y - 1)} style={{ border: "none", background: "#EBEBEB", borderRadius: 8, width: 34, height: 34, cursor: "pointer", fontSize: 16 }}>‹</button>
            <h2 style={{ fontSize: 24, fontWeight: 700, letterSpacing: "-0.5px" }}>{year} <span style={{ color: "#9CA3AF", fontWeight: 400 }}>Overview</span></h2>
            <button className="nav-btn" onClick={() => setYear(y => y + 1)} style={{ border: "none", background: "#EBEBEB", borderRadius: 8, width: 34, height: 34, cursor: "pointer", fontSize: 16 }}>›</button>
          </div>

          {/* Year summary card */}
          <div style={{ background: "#1C1C1E", borderRadius: 16, padding: "20px 24px", marginBottom: 20, display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 16 }}>
            <div>
              <div style={{ color: "#9CA3AF", fontSize: 13, marginBottom: 4 }}>Year-to-date compliance</div>
              <div style={{ color: "white", fontSize: 36, fontWeight: 800, fontFamily: "DM Mono, monospace", letterSpacing: "-1px" }}>{yearPct}<span style={{ fontSize: 20, color: "#9CA3AF" }}>%</span></div>
              <div style={{ color: yearPct >= 60 ? "#52B788" : "#EF4444", fontSize: 13, fontWeight: 600, marginTop: 2 }}>
                {ytd.office} office days / {ytd.eligible} eligible days {yearPct >= 60 ? "— On track ✓" : "— Below target ✗"}
              </div>
            </div>
            <div style={{ display: "flex", gap: 16 }}>
              {[
                { label: "Office", val: yearOffice, color: "#52B788" },
                { label: "Remote", val: yearStats.reduce((a,r)=>a+r.remote,0), color: "#3B82F6" },
                { label: "PTO", val: yearStats.reduce((a,r)=>a+r.pto,0), color: "#A855F7" },
                { label: "Sick", val: yearStats.reduce((a,r)=>a+r.sick,0), color: "#EF4444" },
                { label: "Medical", val: yearStats.reduce((a,r)=>a+r.medical,0), color: "#14B8A6" },
              ].filter(t => t.label !== "Medical" || t.val > 0).map(({ label, val, color }) => (
                <div key={label} style={{ textAlign: "center" }}>
                  <div style={{ color, fontWeight: 800, fontSize: 22, fontFamily: "DM Mono, monospace" }}>{val}</div>
                  <div style={{ color: "#6B7280", fontSize: 11, fontWeight: 500 }}>{label}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Monthly rows */}
          <div style={{ background: "white", borderRadius: 16, overflow: "hidden", boxShadow: "0 2px 12px rgba(0,0,0,0.06)" }}>
            <div style={{ display: "grid", gridTemplateColumns: "120px 1fr 80px 80px 66px 66px 66px 66px 90px", padding: "10px 20px", borderBottom: "1px solid #F3F4F6", gap: 8 }}>
              {["Month", "Compliance", "🏢 Office", "🏠 Remote", "🌴 PTO", "🤒 Sick", "🩺 Med", "🎉 Hols", "Status"].map(h => (
                <div key={h} style={{ fontSize: 11, fontWeight: 700, color: "#9CA3AF", letterSpacing: "0.05em" }}>{h}</div>
              ))}
            </div>
            {yearStats.map((row, idx) => {
              const isCurrentMonth = idx === now.getMonth() && year === now.getFullYear();
              const met = row.pct >= 60;
              // A future month with no user input yet should show as blank, not failing
              const isFutureMonth = year > now.getFullYear() || (year === now.getFullYear() && idx > now.getMonth());
              const autoHolidays = getUSHolidays(year);
              const hasUserInput = isFutureMonth && Object.keys(data).some(k => {
                const [ky, km] = k.split("-").map(Number);
                if (ky !== year || km !== idx + 1) return false;
                // Only count as user input if it's not an auto-holiday entry
                return !(autoHolidays[k] && data[k] === "holiday");
              });
              const showBlank = isFutureMonth && !hasUserInput;
              return (
                <div key={row.month}
                  onClick={() => { setMonth(idx); setView("calendar"); }}
                  style={{
                    display: "grid", gridTemplateColumns: "120px 1fr 80px 80px 66px 66px 66px 66px 90px",
                    padding: "12px 20px", gap: 8, cursor: "pointer",
                    background: isCurrentMonth ? "#F0FDF4" : (idx % 2 === 0 ? "white" : "#FAFAFA"),
                    borderBottom: "1px solid #F3F4F6",
                    alignItems: "center",
                    transition: "background 0.1s",
                    opacity: showBlank ? 0.5 : 1
                  }}
                  onMouseEnter={e => e.currentTarget.style.background = "#F8F7F4"}
                  onMouseLeave={e => e.currentTarget.style.background = isCurrentMonth ? "#F0FDF4" : (idx % 2 === 0 ? "white" : "#FAFAFA")}
                >
                  <div style={{ fontWeight: isCurrentMonth ? 700 : 500, fontSize: 14, color: isCurrentMonth ? "#2D6A4F" : "#1C1C1E" }}>
                    {row.month.slice(0,3)}
                    {isCurrentMonth && <span style={{ marginLeft: 6, fontSize: 10, background: "#D8F3DC", color: "#2D6A4F", borderRadius: 4, padding: "1px 5px", fontWeight: 700 }}>NOW</span>}
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <div style={{ flex: 1, height: 6, background: "#F3F4F6", borderRadius: 3, overflow: "hidden" }}>
                      {!showBlank && <div className="bar-fill" style={{
                        "--bar-w": `${Math.min(row.pct, 100)}%`,
                        width: `${Math.min(row.pct, 100)}%`,
                        height: "100%",
                        background: met ? "#52B788" : row.pct >= 40 ? "#F59E0B" : "#EF4444",
                        borderRadius: 3,
                      }} />}
                    </div>
                    <span style={{ fontSize: 12, fontWeight: 700, color: showBlank ? "#D1D5DB" : met ? "#2D6A4F" : "#C0392B", fontFamily: "DM Mono, monospace", minWidth: 36 }}>{showBlank ? "—" : `${row.pct}%`}</span>
                  </div>
                  <div style={{ fontSize: 14, fontWeight: 600, fontFamily: "DM Mono, monospace", color: "#2D6A4F" }}>{showBlank ? "—" : row.office}</div>
                  <div style={{ fontSize: 14, fontWeight: 600, fontFamily: "DM Mono, monospace", color: "#1565C0" }}>{showBlank ? "—" : row.remote}</div>
                  <div style={{ fontSize: 14, fontWeight: 600, fontFamily: "DM Mono, monospace", color: "#7B2D8B" }}>{showBlank ? "—" : row.pto}</div>
                  <div style={{ fontSize: 14, fontWeight: 600, fontFamily: "DM Mono, monospace", color: "#C0392B" }}>{showBlank ? "—" : row.sick}</div>
                  <div style={{ fontSize: 14, fontWeight: 600, fontFamily: "DM Mono, monospace", color: "#0F766E" }}>{showBlank ? "—" : row.medical}</div>
                  <div style={{ fontSize: 14, fontWeight: 600, fontFamily: "DM Mono, monospace", color: "#B45309" }}>{showBlank ? "—" : row.holiday}</div>
                  <div style={{
                    display: "inline-flex", alignItems: "center", justifyContent: "center",
                    padding: "3px 10px", borderRadius: 20, fontSize: 11, fontWeight: 700,
                    background: showBlank || row.eligibleDays === 0 ? "#F3F4F6" : met ? "#D8F3DC" : "#FEE2E2",
                    color: showBlank || row.eligibleDays === 0 ? "#9CA3AF" : met ? "#2D6A4F" : "#C0392B"
                  }}>
                    {showBlank ? "—" : row.eligibleDays === 0 ? "—" : met ? "✓ Met" : "✗ Below"}
                  </div>
                </div>
              );
            })}
          </div>
          <div style={{ color: "#9CA3AF", fontSize: 12, marginTop: 12, textAlign: "center" }}>
            Click any month row to open its calendar view
          </div>
        </div>
      )}

      {/* Click outside to dismiss picker */}
      {selectedDay && (
        <div style={{ position: "fixed", inset: 0, zIndex: 99 }} onClick={() => setSelectedDay(null)} />
      )}
    </div>
  );
}
