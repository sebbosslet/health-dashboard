import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { loadOstree, saveOstree } from "./store";

// ────────────────────────────────────────────────────────────
// Audi Connect — Opportunity Solution Tree
// Route: /ostree
// Status markup persists per-user in Supabase (ostree_state).
// Click any status chip to cycle: idea → planned → doing → tried → idea
// ────────────────────────────────────────────────────────────

function defaultDoc() {
  return {
    outcome: DEFAULT_OUTCOME,
    branches: DEFAULT_TREE.map((b, bi) => ({
      id: b.id, title: b.title, subtitle: b.subtitle, sort: bi + 1,
      opportunities: b.opportunities.map((o, oi) => ({
        id: o.id, problem: o.problem, sort: oi + 1,
        solutions: o.solutions.map((sol, si) => ({
          id: sol.id, label: sol.label, status: sol.seed || "idea", sort: si + 1,
        })),
      })),
    })),
  };
}

const STATUSES = ["idea", "planned", "doing", "tried", "infeasible"];
const STATUS_META = {
  idea:    { label: "Idea",    bg: "#ECEAE4", fg: "#5F5E5A" },
  planned: { label: "Planned", bg: "#DCE9F7", fg: "#185FA5" },
  doing:   { label: "Doing",   bg: "#DFF0E6", fg: "#0F6E56" },
  tried:   { label: "Tried",   bg: "#FAEEDA", fg: "#854F0B" },
  infeasible: { label: "Not feasible", bg: "#F3E4E0", fg: "#9A3B22" },
};

const DEFAULT_OUTCOME = {
  title: "Grow recurring Audi Connect revenue",
  meta: "Prime $36/mo · $360/yr — Plus $49/mo · $490/yr · App + dealer (all used cars) · One-time 6-month trial per VIN · Max 20% discount",
};

const DEFAULT_TREE = [
  {
    id: "sales",
    title: "Increase new sales",
    subtitle: "More first-time purchases across app and dealer channels",
    opportunities: [
      {
        id: "sales-value",
        problem: "\u201CI don't know what Connect does or why I'd pay for it\u201D",
        solutions: [
          { id: "s1", label: "6-month VIN trial as the primary sampling engine", seed: "doing" },
          { id: "s2", label: "Used-car handover script: dealer activates the trial live" },
          { id: "s3", label: "Onboarding email series with tier-specific value stories" },
          { id: "s4", label: "PDP video showing the feature, not the spec sheet" },
        ],
      },
      {
        id: "sales-price",
        problem: "\u201CIt feels expensive next to my phone plan\u201D",
        solutions: [
          { id: "s5", label: "Discount code campaigns", seed: "doing" },
          { id: "s6", label: "PDP steers to annual variant", seed: "doing" },
          { id: "s7", label: "Multi-year plans (e.g. 3-year) with discount baked into price" },
          { id: "s8", label: "Anchor Plus against phone hotspot cost per GB" },
        ],
      },
      {
        id: "sales-dealer",
        problem: "\u201CMy dealer never mentioned it\u201D (used-car channel underperforms)",
        solutions: [
          { id: "s9", label: "Dealer sale attribution + incentive per activation" },
          { id: "s10", label: "POS materials with QR deep link to PDP" },
          { id: "s11", label: "Attach-rate reporting and dealer leaderboard" },
          { id: "s12", label: "Trial-status check in dealer tooling before handover" },
        ],
      },
      {
        id: "sales-friction",
        problem: "\u201CI started buying but gave up\u201D (checkout friction)",
        solutions: [
          { id: "s13", label: "Cart-abandon push with reminder or code" },
          { id: "s14", label: "Fewer steps from PDP to payment confirmation" },
          { id: "s15", label: "Per-step funnel analytics to find the drop-off" },
        ],
      },
    ],
  },
  {
    id: "attrition",
    title: "Reduce attrition",
    subtitle: "Keep active subscribers renewing, especially the one-time cohort",
    opportunities: [
      {
        id: "att-lapse",
        problem: "\u201CI bought one-time and it just expired\u201D (silent lapse)",
        solutions: [
          { id: "a1", label: "Default checkout to auto-renew with easy opt-out" },
          { id: "a2", label: "Pre-expiry reminders (30 / 7 / 1 day) with renew CTA" },
          { id: "a3", label: "One-tap renew from push notification" },
          { id: "a4", label: "Expiry-week offer converting one-time to auto-renew" },
        ],
      },
      {
        id: "att-cancel",
        problem: "\u201CI want to cancel my renewal\u201D",
        solutions: [
          { id: "a5", label: "15% retention discount at cancel intent", seed: "doing" },
          { id: "a6", label: "Offer downgrade Plus \u2192 Prime instead of full cancel" },
          { id: "a7", label: "Pause or skip-a-renewal option" },
          { id: "a8", label: "Cancel-flow reason survey feeding this tree" },
        ],
      },
      {
        id: "att-term",
        problem: "\u201CI renew every year and it's a chore\u201D (term too short)",
        solutions: [
          { id: "a9", label: "3-year plan: attrition structurally deferred, discount in price" },
          { id: "a10", label: "Loyalty pricing: renewal price locks or improves over time" },
        ],
      },
      {
        id: "att-usage",
        problem: "\u201CI'm paying but barely use it\u201D (low engagement = churn risk)",
        solutions: [
          { id: "a11", label: "Usage-triggered tips (WiFi setup, nav features)" },
          { id: "a12", label: "Low-usage risk flag with proactive value email" },
          { id: "a13", label: "Monthly \u201Cyour Connect recap\u201D touchpoint" },
        ],
      },
      {
        id: "att-payment",
        problem: "\u201CMy renewal failed and nobody told me\u201D (involuntary churn)",
        solutions: [
          { id: "a14", label: "Dunning retry sequence with card-update deep link" },
          { id: "a15", label: "Card-expiry warning ahead of the renewal date" },
          { id: "a16", label: "Grace period so service doesn't cut off instantly" },
        ],
      },
    ],
  },
  {
    id: "winback",
    title: "Win back lapsed customers",
    subtitle: "Reactivate expired plans — including second owners of used cars",
    opportunities: [
      {
        id: "win-known",
        problem: "Lapsed customer, contact details known",
        solutions: [
          { id: "w1", label: "Time-boxed winback offer at the 20% ceiling" },
          { id: "w2", label: "\u201CWhat you're missing\u201D recap of past usage" },
          { id: "w3", label: "Triggered sends at 30 / 90 / 180 days post-lapse" },
          { id: "w4", label: "Winback lands on annual or multi-year variant" },
        ],
      },
      {
        id: "win-newowner",
        problem: "Second owner, no contact details, trial already redeemed",
        solutions: [
          { id: "w5", label: "MMI screen notifications", seed: "tried" },
          { id: "w6", label: "Trial reset (or short re-trial) on verified ownership change" },
          { id: "w7", label: "Auto-offer when a new myAudi account pairs to the VIN" },
          { id: "w8", label: "Dealer enrolls new owner at used-car handover" },
          { id: "w9", label: "QR card left in vehicle at trade-in" },
        ],
      },
      {
        id: "win-detect",
        problem: "We can't tell when or why a plan lapsed",
        solutions: [
          { id: "w10", label: "Ownership-change detection from VIN re-pairing events" },
          { id: "w11", label: "Lapsed-cohort segmentation (voluntary / payment / resale)" },
          { id: "w12", label: "Lapse-reason data targets the offers above" },
        ],
      },
    ],
  },
];

function ProblemEditor({ initial, onSave, onCancel }) {
  const [v, setV] = useState(initial);
  return (
    <div className="ost-editor">
      <textarea className="ost-textarea" value={v} autoFocus rows={2}
        onChange={(e) => setV(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Escape") onCancel(); if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) onSave(v); }} />
      <div className="ost-editor-btns">
        <button className="ost-save" onClick={() => onSave(v)}>Save</button>
        <button className="ost-cancel" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}

function SolutionEditor({ initial, onSave, onCancel }) {
  const [v, setV] = useState(initial);
  return (
    <span className="ost-editor inline">
      <input className="ost-input" value={v} autoFocus
        onChange={(e) => setV(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Escape") onCancel(); if (e.key === "Enter") onSave(v); }} />
      <button className="ost-save" onClick={() => onSave(v)}>Save</button>
      <button className="ost-cancel" onClick={onCancel}>Cancel</button>
    </span>
  );
}

export default function OSTree({ session }) {
  const [doc, setDoc] = useState(null);
  const [filter, setFilter] = useState(null);
  const [editingProblem, setEditingProblem] = useState(null);
  const [editingSolution, setEditingSolution] = useState(null);
  const loaded = useRef(false);
  const saveTimer = useRef(null);

  useEffect(() => {
    let alive = true;
    loadOstree(session.user.id).then((stored) => {
      if (!alive) return;
      // A stored doc with branches wins; otherwise fall back to the built-in tree.
      setDoc(stored && stored.branches ? stored : defaultDoc());
      loaded.current = true;
    });
    return () => { alive = false; };
  }, [session.user.id]);

  useEffect(() => {
    if (!loaded.current || !doc) return;
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => saveOstree(session.user.id, doc), 500);
    return () => clearTimeout(saveTimer.current);
  }, [doc, session.user.id]);

  const cycle = (solId) => {
    setDoc((prev) => ({
      ...prev,
      branches: prev.branches.map((b) => ({
        ...b,
        opportunities: b.opportunities.map((o) => ({
          ...o,
          solutions: o.solutions.map((sol) => sol.id === solId
            ? { ...sol, status: STATUSES[(STATUSES.indexOf(sol.status || "idea") + 1) % STATUSES.length] }
            : sol),
        })),
      })),
    }));
  };

  // ---- editing: every change is an immutable update to the doc ----
  const mutate = (fn) => setDoc((prev) => fn(structuredClone(prev)));

  const setStatus = (solId, status) => mutate((d) => {
    for (const b of d.branches) for (const o of b.opportunities)
      for (const sol of o.solutions) if (sol.id === solId) sol.status = status;
    return d;
  });

  const editSolution = (solId, label) => mutate((d) => {
    for (const b of d.branches) for (const o of b.opportunities)
      for (const sol of o.solutions) if (sol.id === solId) sol.label = label;
    return d;
  });

  const deleteSolution = (solId) => mutate((d) => {
    for (const b of d.branches) for (const o of b.opportunities)
      o.solutions = o.solutions.filter((sol) => sol.id !== solId);
    return d;
  });

  const addSolution = (oppId) => mutate((d) => {
    for (const b of d.branches) for (const o of b.opportunities) if (o.id === oppId) {
      const maxSort = Math.max(0, ...o.solutions.map((x) => x.sort ?? 0));
      o.solutions.push({ id: `sol-${Date.now().toString(36)}`, label: "New solution", status: "idea", sort: maxSort + 1 });
    }
    return d;
  });

  const editProblem = (oppId, problem) => mutate((d) => {
    for (const b of d.branches) for (const o of b.opportunities) if (o.id === oppId) o.problem = problem;
    return d;
  });

  const deleteOpportunity = (oppId) => mutate((d) => {
    for (const b of d.branches) b.opportunities = b.opportunities.filter((o) => o.id !== oppId);
    return d;
  });

  const addOpportunity = (branchId) => mutate((d) => {
    for (const b of d.branches) if (b.id === branchId) {
      const maxSort = Math.max(0, ...b.opportunities.map((x) => x.sort ?? 0));
      b.opportunities.push({ id: `opp-${Date.now().toString(36)}`, problem: "New problem statement", sort: maxSort + 1, solutions: [] });
    }
    return d;
  });

  const branches = useMemo(() => {
    if (!doc) return [];
    const bySort = (a, b) => (a.sort ?? 0) - (b.sort ?? 0);
    return [...doc.branches].sort(bySort).map((b) => ({
      ...b,
      opportunities: [...b.opportunities].sort(bySort).map((o) => ({
        ...o, solutions: [...o.solutions].sort(bySort),
      })),
    }));
  }, [doc]);

  const counts = useMemo(() => {
    const c = { idea: 0, planned: 0, doing: 0, tried: 0, infeasible: 0 };
    branches.forEach((b) => b.opportunities.forEach((o) => o.solutions.forEach((s) => {
      c[s.status || "idea"] += 1;
    })));
    return c;
  }, [branches]);

  const exportJson = () => {
    const blob = new Blob([JSON.stringify(doc, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "ostree.json";
    a.click();
    URL.revokeObjectURL(a.href);
  };

  if (!doc) return <div className="ost"><style>{css}</style><p className="ost-meta" style={{ textAlign: "center", marginTop: "3rem" }}>Loading…</p></div>;
  const outcome = doc.outcome || DEFAULT_OUTCOME;

  return (
    <div className="ost">
      <style>{css}</style>
      <div className="ost-inner">

      <header className="ost-header">
        <button className="ost-signout" onClick={() => import("../lib/supabase").then(m => m.supabase.auth.signOut())}>Sign out</button>
        <p className="ost-eyebrow">Opportunity solution tree</p>
        <h1>{outcome.title}</h1>
        <p className="ost-meta">{outcome.meta}</p>
      </header>

      <div className="ost-toolbar" role="toolbar" aria-label="Filter by status">
        {STATUSES.map((s) => (
          <button
            key={s}
            className={`ost-chip ${filter === s ? "is-active" : ""}`}
            style={{ background: STATUS_META[s].bg, color: STATUS_META[s].fg }}
            onClick={() => setFilter(filter === s ? null : s)}
          >
            {STATUS_META[s].label} · {counts[s]}
          </button>
        ))}
        <button className="ost-export" onClick={exportJson}>Export status</button>
      </div>

      <div className="ost-trunk" aria-hidden="true" />

      <div className="ost-branches">
        {branches.map((branch) => (
          <section key={branch.id} className="ost-branch">
            <div className="ost-branch-head">
              <h2>{branch.title}</h2>
              <p>{branch.subtitle}</p>
            </div>

            {branch.opportunities.map((opp) => {
              const visible = filter
                ? opp.solutions.some((s) => (s.status || "idea") === filter)
                : true;
              if (!visible) return null;
              return (
                <div key={opp.id} className="ost-opp">
                  <div className="ost-problem-row">
                    {editingProblem === opp.id ? (
                      <ProblemEditor
                        initial={opp.problem}
                        onSave={(v) => { editProblem(opp.id, v); setEditingProblem(null); }}
                        onCancel={() => setEditingProblem(null)}
                      />
                    ) : (
                      <>
                        <p className="ost-problem">{opp.problem}</p>
                        <div className="ost-rowtools">
                          <button className="ost-icon" title="Edit problem" onClick={() => setEditingProblem(opp.id)}>✎</button>
                          <button className="ost-icon danger" title="Delete problem"
                            onClick={() => { if (confirm("Delete this problem and its solutions?")) deleteOpportunity(opp.id); }}>✕</button>
                        </div>
                      </>
                    )}
                  </div>
                  <ul>
                    {opp.solutions.map((sol) => {
                      const st = sol.status || "idea";
                      const dim = filter && st !== filter;
                      return (
                        <li key={sol.id} className={dim ? "is-dim" : ""}>
                          <select
                            className="ost-select"
                            value={st}
                            onChange={(e) => setStatus(sol.id, e.target.value)}
                            style={{ background: STATUS_META[st].bg, color: STATUS_META[st].fg }}
                            aria-label={`Status for ${sol.label}`}
                          >
                            {STATUSES.map((k) => <option key={k} value={k}>{STATUS_META[k].label}</option>)}
                          </select>
                          {editingSolution === sol.id ? (
                            <SolutionEditor
                              initial={sol.label}
                              onSave={(v) => { editSolution(sol.id, v); setEditingSolution(null); }}
                              onCancel={() => setEditingSolution(null)}
                            />
                          ) : (
                            <>
                              <span className="ost-sol-label">{sol.label}</span>
                              <span className="ost-rowtools">
                                <button className="ost-icon" title="Edit solution" onClick={() => setEditingSolution(sol.id)}>✎</button>
                                <button className="ost-icon danger" title="Delete solution"
                                  onClick={() => { if (confirm("Delete this solution?")) deleteSolution(sol.id); }}>✕</button>
                              </span>
                            </>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                  <button className="ost-add" onClick={() => addSolution(opp.id)}>+ Add solution</button>
                </div>
              );
            })}
            <button className="ost-add ost-add-opp" onClick={() => addOpportunity(branch.id)}>+ Add problem</button>
          </section>
        ))}
      </div>
      </div>
    </div>
  );
}

const css = `
.ost { height: 100%; overflow-y: auto; -webkit-overflow-scrolling: touch; font-family: inherit; color: #2C2C2A; background: #FAF8F3; }
.ost-inner { max-width: 1180px; margin: 0 auto; padding: 2.5rem 1.25rem 4rem; }
.ost-header { text-align: center; margin-bottom: 1.5rem; }
.ost-eyebrow { font-size: 12px; letter-spacing: 0.08em; text-transform: uppercase; color: #888780; margin: 0 0 6px; }
.ost-header h1 { font-size: 26px; font-weight: 600; margin: 0; }
.ost-meta { font-size: 13px; color: #5F5E5A; margin: 8px auto 0; max-width: 640px; }
.ost-toolbar { display: flex; flex-wrap: wrap; gap: 8px; justify-content: center; margin-bottom: 2rem; }
.ost-chip { border: 1px solid transparent; border-radius: 999px; font-size: 13px; padding: 5px 14px; cursor: pointer; }
.ost-chip.is-active { border-color: currentColor; }
.ost-export { border: 1px solid #D3D1C7; background: transparent; border-radius: 999px; font-size: 13px; padding: 5px 14px; cursor: pointer; color: #5F5E5A; }
.ost-trunk { width: 1px; height: 28px; background: #D3D1C7; margin: 0 auto 0; }
.ost-branches { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 20px; border-top: 1px solid #D3D1C7; padding-top: 24px; }
.ost-branch { position: relative; }
.ost-branch::before { content: ""; position: absolute; top: -24px; left: 50%; width: 1px; height: 24px; background: #D3D1C7; }
.ost-branch-head h2 { font-size: 17px; font-weight: 600; margin: 0 0 2px; }
.ost-branch-head p { font-size: 13px; color: #5F5E5A; margin: 0 0 14px; }
.ost-opp { background: #FFFFFF; border: 1px solid #E7E3D9; border-radius: 12px; padding: 14px 16px; margin-bottom: 14px; }
.ost-problem { font-size: 14px; font-weight: 600; margin: 0 0 10px; }
.ost-opp ul { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
.ost-opp li { display: flex; align-items: flex-start; gap: 8px; font-size: 13.5px; line-height: 1.45; color: #444441; transition: opacity 0.15s; }
.ost-opp li.is-dim { opacity: 0.35; }
.ost-signout { position: absolute; right: 1.25rem; top: 2.5rem; border: 1px solid #D3D1C7; background: transparent; border-radius: 999px; font-size: 12px; padding: 4px 12px; cursor: pointer; color: #5F5E5A; }
.ost-status { flex: none; border: none; border-radius: 6px; font-size: 11px; font-weight: 600; padding: 2px 8px; cursor: pointer; margin-top: 1px; }
@media (max-width: 900px) { .ost-branches { grid-template-columns: 1fr; } .ost-branch::before { display: none; } .ost-trunk { display: none; } }

.ost-problem-row { display: flex; align-items: flex-start; justify-content: space-between; gap: 8px; margin-bottom: 10px; }
.ost-problem-row .ost-problem { margin: 0; }
.ost-rowtools { display: inline-flex; gap: 2px; flex: none; opacity: 0; transition: opacity 0.12s; }
.ost-opp:hover .ost-rowtools, .ost-problem-row:hover .ost-rowtools, li:hover .ost-rowtools { opacity: 1; }
.ost-icon { border: none; background: transparent; color: #9C9A92; cursor: pointer; font-size: 13px; padding: 1px 5px; border-radius: 5px; line-height: 1.4; }
.ost-icon:hover { background: #ECEAE4; color: #2C2C2A; }
.ost-icon.danger:hover { background: #FAE3DD; color: #A23B22; }
.ost-select { flex: none; border: none; border-radius: 6px; font-size: 11px; font-weight: 600; padding: 2px 6px; cursor: pointer; margin-top: 1px; font-family: inherit; -webkit-appearance: none; appearance: none; }
.ost-sol-label { flex: 1; }
.ost-add { border: 1px dashed #D3D1C7; background: transparent; color: #7A7970; border-radius: 8px; font-size: 12.5px; padding: 6px 12px; cursor: pointer; margin-top: 4px; width: 100%; }
.ost-add:hover { border-color: #A9A79C; color: #2C2C2A; }
.ost-add-opp { margin-top: 6px; border-style: solid; }
.ost-editor { display: flex; flex-direction: column; gap: 6px; width: 100%; }
.ost-editor.inline { flex-direction: row; align-items: center; flex: 1; }
.ost-textarea, .ost-input { width: 100%; border: 1px solid #C9C7BD; border-radius: 6px; padding: 6px 8px; font-family: inherit; font-size: 13.5px; color: #2C2C2A; background: #fff; resize: vertical; }
.ost-editor-btns { display: flex; gap: 6px; }
.ost-save { border: none; background: #2D6A4F; color: #fff; border-radius: 6px; font-size: 12px; padding: 4px 12px; cursor: pointer; }
.ost-cancel { border: 1px solid #D3D1C7; background: transparent; color: #5F5E5A; border-radius: 6px; font-size: 12px; padding: 4px 12px; cursor: pointer; }
`;
