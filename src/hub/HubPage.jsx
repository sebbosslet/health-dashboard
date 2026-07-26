import { useMemo } from "react";
import { Link } from "react-router-dom";
import { supabase } from "../lib/supabase";
import "./hub.css";

/* ============================================================
   sebs.health — hub
   Entry point for the three applications.
   ============================================================ */

const APPS = [
  {
    id: "health",
    name: "health",
    href: "/health",
    tagline: "Daily intelligence, sleep and metabolic tracking",
    blurb: "Morning check-in, WHOOP sleep deep-dive, CGM correlation, meals, supplements and goals.",
    accent: "var(--green)",
    stats: [
      { label: "Check-in", value: "daily" },
      { label: "Sources", value: "WHOOP · CGM" },
    ],
    icon: (
      <path d="M4 14h4l2.2-5.5L13 19l2.4-6.5L17.4 14H20" fill="none" strokeWidth="1.8"
        strokeLinecap="round" strokeLinejoin="round" />
    ),
  },
  {
    id: "travel",
    name: "travel",
    href: "/travel",
    tagline: "Trip planning, itineraries and budgets",
    blurb: "Trips, events, costs and budgets in one place — planned ahead, reconciled after.",
    accent: "#3d7f9c",
    stats: [
      { label: "Planning", value: "trips" },
      { label: "Tracks", value: "costs" },
    ],
    icon: (
      <>
        <path d="M12 21s6-5.3 6-10a6 6 0 1 0-12 0c0 4.7 6 10 6 10Z" fill="none" strokeWidth="1.8"
          strokeLinejoin="round" />
        <circle cx="12" cy="11" r="2.2" fill="none" strokeWidth="1.8" />
      </>
    ),
  },
  {
    id: "cashflow",
    name: "cashflow",
    href: "/cashflow",
    tagline: "Checking forecast, cards and wealth",
    blurb: "Daily reconciliation, five-year forecast, card cycles, variable spend and net worth.",
    accent: "#8a6a2f",
    stats: [
      { label: "Horizon", value: "5 years" },
      { label: "Answers", value: "today's balance" },
    ],
    icon: (
      <>
        <path d="M4 16.5 9 11l3.5 3.5L20 7" fill="none" strokeWidth="1.8"
          strokeLinecap="round" strokeLinejoin="round" />
        <path d="M15.5 7H20v4.5" fill="none" strokeWidth="1.8"
          strokeLinecap="round" strokeLinejoin="round" />
      </>
    ),
  },
  {
    id: "attendance",
    name: "attendance",
    href: "/attendance",
    tagline: "Office days, RTO compliance and PTO",
    blurb: "Log each day as office, remote, PTO, sick or holiday; track the 60% target month by month.",
    accent: "#1C1C1E",
    stats: [
      { label: "Target", value: "60% office" },
      { label: "View", value: "month · year" },
    ],
    icon: (
      <>
        <rect x="4" y="5" width="16" height="16" rx="2" fill="none" strokeWidth="1.8" />
        <path d="M4 9h16M8 3v4M16 3v4" fill="none" strokeWidth="1.8" strokeLinecap="round" />
        <rect x="7.5" y="12" width="3" height="3" rx="0.5" fill="currentColor" stroke="none" />
      </>
    ),
  },
  {
    id: "home",
    name: "home",
    href: "/home",
    external: true,
    tagline: "SwitchBot temperature & humidity",
    blurb: "Live readings from the SwitchBot sensors, recent history and comfort status at a glance.",
    accent: "#0284C7",
    stats: [
      { label: "Source", value: "SwitchBot" },
      { label: "Updates", value: "live" },
    ],
    icon: (
      <>
        <path d="M4 12l8-7 8 7" fill="none" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M6 10.5V19h12v-8.5" fill="none" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      </>
    ),
  },
];



function CardBody({ a }) {
  return (
    <>
      <div className="badge">
        <svg width="22" height="22" viewBox="0 0 24 24" stroke={a.accent} fill="none">{a.icon}</svg>
      </div>
      <div className="cname"><b>sebs.</b>{a.name}</div>
      <div className="ctag">{a.tagline}</div>
      <div className="cblurb">{a.blurb}</div>
      <div className="cstats">
        {a.stats.map((s) => (
          <div className="cstat" key={s.label}>
            <div className="l">{s.label}</div>
            <div className="v">{s.value}</div>
          </div>
        ))}
      </div>
      <div className="enter">Open →</div>
    </>
  );
}

export default function HubPage({ session }) {
  const now = useMemo(() => new Date().toLocaleDateString("en-US", {
    weekday: "long", month: "long", day: "numeric", year: "numeric",
  }), []);

  return (
    <div className="hub">
      <div className="hub-inner">
        <header className="hub-head">
          <div className="mark">sebs<span>.</span></div>
          <p className="sub">
            Three applications, one place. Everything is single-user, self-hosted
            and built to answer one question well.
          </p>
          <div className="meta">
            <span>{now}</span>
            <span>React · Supabase · Netlify</span>
          </div>
        </header>

        <div className="cards">
          {APPS.map((a) => (a.external ? (
            <a className="card" key={a.id} href={a.href}><CardBody a={a} /></a>
          ) : (
            <Link className="card" key={a.id} to={a.href}><CardBody a={a} /></Link>
          )))}
        </div>

        <footer className="foot">
          <span>{session?.user?.email}</span>
          <button className="signout" onClick={() => supabase.auth.signOut()}>Sign out</button>
        </footer>
      </div>
    </div>
  );
}
