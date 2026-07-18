import { useEffect, useMemo, useState, type FormEvent } from "react";
import { HubConnectionBuilder } from "@microsoft/signalr";

type Role = "Batsman" | "Bowler" | "All-rounder" | "Wicket-keeper";
type View = "dashboard" | "profile";

type Player = {
  id: number;
  name: string;
  initials: string;
  roles: Role[];
  email: string;
  phone: string;
  runs: number;
  wickets: number;
  catches: number;
  availability: string;
  joinedOn: string;
};

type Match = {
  id: number;
  opponent: string;
  playedOn: string;
  ourScore: number;
  opponentScore: number;
  result: string;
  venue: string;
};

type Session = {
  name: string;
  email: string;
  role: string;
  teamName: string;
};

type Profile = {
  name: string;
  email: string;
  phone: string;
  timezone: string;
};

const roles: Array<{ label: Role; plural: string; icon: string }> = [
  { label: "Batsman", plural: "Batsmen", icon: "◒" },
  { label: "Bowler", plural: "Bowlers", icon: "↘" },
  { label: "All-rounder", plural: "All-rounders", icon: "✦" },
  { label: "Wicket-keeper", plural: "Wicket-keepers", icon: "⌑" },
];

async function api<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    headers: { "Content-Type": "application/json", ...(options?.headers ?? {}) },
    ...options,
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: "Request failed." }));
    throw new Error(error.message ?? "Request failed.");
  }
  return response.json() as Promise<T>;
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en-CA", { day: "numeric", month: "short", year: "numeric" }).format(new Date(value));
}

function StatusDot() {
  return <span className="status-dot" aria-hidden="true" />;
}

function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [loginError, setLoginError] = useState("");
  const [loading, setLoading] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [view, setView] = useState<View>("dashboard");
  const [activeRole, setActiveRole] = useState<Role | "All">("All");
  const [players, setPlayers] = useState<Player[]>([]);
  const [matches, setMatches] = useState<Match[]>([]);
  const [selectedMatchId, setSelectedMatchId] = useState(1);
  const [selectedPlayer, setSelectedPlayer] = useState<Player | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [profileEditing, setProfileEditing] = useState(false);
  const [profileDraft, setProfileDraft] = useState({ phone: "", timezone: "" });
  const [profileMessage, setProfileMessage] = useState("");
  const [passwordModalOpen, setPasswordModalOpen] = useState(false);
  const [passwordForm, setPasswordForm] = useState({ currentPassword: "", newPassword: "", confirmPassword: "" });
  const [passwordMessage, setPasswordMessage] = useState("");
  const [liveMessage, setLiveMessage] = useState("Ready for match day.");

  const selectedMatch = matches.find((match) => match.id === selectedMatchId) ?? matches[0];
  const visiblePlayers = useMemo(
    () => activeRole === "All" ? players : players.filter((player) => player.roles.includes(activeRole)),
    [activeRole, players],
  );

  useEffect(() => {
    if (!session) return;
    Promise.all([api<Player[]>("/api/players"), api<Match[]>("/api/matches/previous")])
      .then(([roster, previousMatches]) => {
        setPlayers(roster);
        setMatches(previousMatches);
        setSelectedMatchId(previousMatches[0]?.id ?? 1);
      })
      .catch((error: Error) => setLiveMessage(error.message));

    const connection = new HubConnectionBuilder().withUrl("/hubs/stats").withAutomaticReconnect().build();
    connection.on("playerUpdated", (updated: Player) => {
      setPlayers((current) => current.map((player) => player.id === updated.id ? updated : player));
      setSelectedPlayer((current) => current?.id === updated.id ? updated : current);
      setLiveMessage(`${updated.name}'s live stats were updated.`);
    });
    connection.start().catch(() => setLiveMessage("Live updates will resume when the API is available."));
    return () => { void connection.stop(); };
  }, [session]);

  async function handleLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setLoginError("");
    try {
      const loggedIn = await api<Session>("/api/auth/login", { method: "POST", body: JSON.stringify({ email, password }) });
      setSession(loggedIn);
      setLiveMessage("Welcome to Fightclub IX.");
    } catch (error) {
      setLoginError(error instanceof Error ? error.message : "Unable to sign in.");
    } finally {
      setLoading(false);
    }
  }

  function signOut() {
    setSession(null);
    setView("dashboard");
    setPlayers([]);
    setMatches([]);
    setProfile(null);
    setLiveMessage("Signed out of Fightclub IX.");
  }

  async function openProfile() {
    setView("profile");
    setProfileMessage("");
    try {
      const loadedProfile = await api<Profile>("/api/profile");
      setProfile(loadedProfile);
      setProfileDraft({ phone: loadedProfile.phone, timezone: loadedProfile.timezone });
    } catch (error) {
      setProfileMessage(error instanceof Error ? error.message : "Unable to load profile.");
    }
  }

  async function saveProfile() {
    try {
      await api("/api/profile", { method: "PUT", body: JSON.stringify(profileDraft) });
      setProfile((current) => current ? { ...current, ...profileDraft } : current);
      setProfileEditing(false);
      setProfileMessage("Profile details saved for this local demo.");
    } catch (error) {
      setProfileMessage(error instanceof Error ? error.message : "Unable to save profile.");
    }
  }

  async function changeStat(stat: "runs" | "wickets" | "catches") {
    if (!selectedPlayer) return;
    try {
      const updated = await api<Player>(`/api/players/${selectedPlayer.id}/stats`, { method: "PUT", body: JSON.stringify({ stat }) });
      setPlayers((current) => current.map((player) => player.id === updated.id ? updated : player));
      setSelectedPlayer(updated);
    } catch (error) {
      setLiveMessage(error instanceof Error ? error.message : "Unable to update the stat.");
    }
  }

  async function submitPassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      const result = await api<{ message: string }>("/api/profile/password", { method: "POST", body: JSON.stringify(passwordForm) });
      setPasswordMessage(result.message);
      setPasswordForm({ currentPassword: "", newPassword: "", confirmPassword: "" });
    } catch (error) {
      setPasswordMessage(error instanceof Error ? error.message : "Unable to update password.");
    }
  }

  if (!session) {
    return (
      <main className="login-layout">
        <section className="login-visual" aria-label="Fightclub IX match-day preview">
          <div className="login-visual-image" aria-hidden="true" />
          <div className="login-visual-shade" aria-hidden="true" />
          <div className="login-visual-content">
            <div className="team-lockup"><span className="brand-mark">FC</span><span><strong>FIGHTCLUB</strong><small>XI · ESTD. 2023</small></span></div>
            <span className="kicker">Cricket manager · Administrator access</span>
            <h1>We fight as XI.<br /><em>We celebrate as a family.</em></h1>
            <p>Bring every player, role, and match moment together in one focused team room.</p>
          </div>
          <div className="login-visual-footer">
            <span><strong>16</strong> players</span><span><strong>04</strong> roles</span><span><strong>01</strong> family</span>
          </div>
        </section>
        <section className="login-panel">
          <div className="login-card">
            <div className="login-card-top"><span className="mini-team-mark">XI</span><span className="secure-pill"><StatusDot /> Secure team room</span></div>
            <div className="login-card-heading"><span><small>Fightclub IX administrator</small><h2>Welcome back, Admin</h2></span></div>
            <p className="login-copy">Sign in to manage your squad, review match day, and keep every player moving together.</p>
            <form onSubmit={handleLogin} className="login-form">
              <label htmlFor="email">Username or email</label>
              <div className="input-wrap"><span aria-hidden="true">@</span><input id="email" type="email" autoComplete="username" placeholder="admin@fightclubix.local" value={email} onChange={(event) => setEmail(event.target.value)} required /></div>
              <div className="field-label-row"><label htmlFor="password">Password</label><button type="button" className="text-link" onClick={() => setPasswordVisible((current) => !current)}>{passwordVisible ? "Hide" : "Show"}</button></div>
              <div className="input-wrap"><span aria-hidden="true">⌁</span><input id="password" type={passwordVisible ? "text" : "password"} autoComplete="current-password" placeholder="Enter your password" value={password} onChange={(event) => setPassword(event.target.value)} required /></div>
              {loginError && <p className="form-message error" role="alert">{loginError}</p>}
              <button className="primary-button login-submit" type="submit" disabled={loading}>{loading ? "Opening team room…" : "Enter Fightclub IX"}<span>→</span></button>
            </form>
            <div className="login-card-footer"><span className="footer-line" /><p>Local administrator demo · Credentials stay in your backend configuration.</p><span className="footer-line" /></div>
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className="app-shell">
      <aside className={`sidebar ${sidebarCollapsed ? "is-collapsed" : ""}`}>
        <div className="sidebar-topline"><span className="sidebar-brand">FC<span>IX</span></span><button className="hamburger" type="button" onClick={() => setSidebarCollapsed((current) => !current)} aria-expanded={!sidebarCollapsed} aria-label={sidebarCollapsed ? "Open navigation" : "Collapse navigation"}><span>☰</span><b>{sidebarCollapsed ? "Open" : "Collapse"}</b></button></div>
        <div className="admin-identity"><span className="avatar avatar-admin">AD</span><span><strong>{session.name}</strong><small>{session.email}</small><b>ADMIN · FIGHTCLUB IX</b></span></div>
        <div className="team-health"><span><StatusDot /> ADMIN SESSION</span><strong>{players.length || 16} players</strong><small>Live squad performance</small></div>
        <nav className="side-nav" aria-label="Team navigation">
          <button className={view === "dashboard" && activeRole === "All" ? "active" : ""} type="button" onClick={() => { setView("dashboard"); setActiveRole("All"); }}><span>⌂</span><b>Team overview</b></button>
          {roles.map((role) => <button className={view === "dashboard" && activeRole === role.label ? "active" : ""} type="button" key={role.label} onClick={() => { setView("dashboard"); setActiveRole(role.label); }}><span>{role.icon}</span><b>{role.plural}</b></button>)}
          <button className={view === "profile" ? "active" : ""} type="button" onClick={openProfile}><span>◉</span><b>Admin profile</b></button>
        </nav>
        <button className="sidebar-signout" type="button" onClick={signOut}><span>↪</span><b>Sign out</b></button>
      </aside>

      <section className="main-panel">
        <header className="app-header"><div><span className="kicker">{view === "profile" ? "Account settings" : "Fightclub IX · Administrator workspace"}</span><h1>{view === "profile" ? "Admin profile" : `Welcome back, ${session.name}`}</h1></div><div className="header-actions"><span className="live-indicator"><StatusDot /> Live sync</span><button className="header-avatar" type="button" onClick={openProfile}>{session.name.slice(0, 2).toUpperCase()}</button></div></header>

        {view === "profile" ? (
          <ProfilePage profile={profile} editing={profileEditing} draft={profileDraft} message={profileMessage} onBack={() => setView("dashboard")} onEdit={() => { if (profile) setProfileDraft({ phone: profile.phone, timezone: profile.timezone }); setProfileEditing(true); }} onCancel={() => setProfileEditing(false)} onSave={saveProfile} onDraftChange={setProfileDraft} onPassword={() => { setPasswordMessage(""); setPasswordModalOpen(true); }} />
        ) : (
          <div className="dashboard-content">
            <section className="match-overview-card">
              <div className="section-label"><span>Previous match overview</span><select value={selectedMatch?.id ?? ""} onChange={(event) => setSelectedMatchId(Number(event.target.value))}>{matches.map((match) => <option key={match.id} value={match.id}>{match.opponent} · {formatDate(match.playedOn)}</option>)}</select></div>
              {selectedMatch ? <div className="match-scoreboard"><div className="team-circle team-ours"><span>OUR TEAM</span><strong>Fightclub IX</strong><b>{selectedMatch.ourScore}</b></div><div className="match-result"><small>{selectedMatch.result}</small><span>VS</span><em>{selectedMatch.venue}</em></div><div className="team-circle team-opponent"><span>OPPONENT</span><strong>{selectedMatch.opponent}</strong><b>{selectedMatch.opponentScore}</b></div></div> : <p className="loading-copy">Loading match history…</p>}
            </section>
            <section className="roster-section"><div className="section-heading"><div><span className="kicker">{activeRole === "All" ? "Full squad" : activeRole + " group"}</span><h2>{activeRole === "All" ? "Your 16 players" : roles.find((role) => role.label === activeRole)?.plural}</h2></div><span className="roster-count">{visiblePlayers.length} players</span></div><p className="section-copy">Select a player to view the stats and duties assigned to their role.</p><div className="player-grid">{visiblePlayers.map((player) => <button className="player-card" type="button" key={player.id} onClick={() => setSelectedPlayer(player)}><span className={`avatar role-${player.roles[0].toLowerCase().replace("-", "")}`}>{player.initials}</span><span className="player-card-copy"><strong>{player.name}</strong><small>{player.roles.join(" · ")}</small></span><span className={`availability ${player.availability.toLowerCase()}`}>{player.availability}</span><span className="player-card-stats"><b>{player.runs}<small>Runs</small></b><b>{player.wickets}<small>Wkts</small></b><b>{player.catches}<small>Catches</small></b></span></button>)}</div></section>
            <p className="sr-only" aria-live="polite">{liveMessage}</p>
          </div>
        )}
      </section>

      {selectedPlayer && <PlayerModal player={selectedPlayer} onClose={() => setSelectedPlayer(null)} onChangeStat={changeStat} />}
      {passwordModalOpen && <PasswordModal form={passwordForm} message={passwordMessage} onClose={() => setPasswordModalOpen(false)} onSubmit={submitPassword} onChange={setPasswordForm} />}
    </main>
  );
}

function ProfilePage({ profile, editing, draft, message, onBack, onEdit, onCancel, onSave, onDraftChange, onPassword }: { profile: Profile | null; editing: boolean; draft: { phone: string; timezone: string }; message: string; onBack: () => void; onEdit: () => void; onCancel: () => void; onSave: () => void; onDraftChange: (draft: { phone: string; timezone: string }) => void; onPassword: () => void }) {
  if (!profile) return <div className="empty-state"><p>Loading admin profile…</p><button className="text-button" type="button" onClick={onBack}>← Back to dashboard</button></div>;
  return <section className="profile-page"><button className="text-button" type="button" onClick={onBack}>← Back to team overview</button><div className="profile-heading"><div><span className="kicker">Admin account</span><h2>Profile &amp; security</h2><p>Manage the account that keeps Fightclub IX match data moving.</p></div><span className="verified-badge"><StatusDot /> Identity verified</span></div><article className="profile-card"><div className="profile-hero"><span className="avatar avatar-admin avatar-large">AD</span><div><span className="kicker">Team administrator</span><h3>{profile.name}</h3><p>{profile.email}</p></div></div><dl className="profile-details"><div><dt>Full name</dt><dd>{profile.name}</dd></div><div><dt>Email address</dt><dd>{profile.email}</dd></div><div><dt>Phone number</dt><dd>{editing ? <input value={draft.phone} type="tel" onChange={(event) => onDraftChange({ ...draft, phone: event.target.value })} /> : profile.phone}</dd></div><div><dt>Time zone</dt><dd>{editing ? <input value={draft.timezone} onChange={(event) => onDraftChange({ ...draft, timezone: event.target.value })} /> : profile.timezone}</dd></div></dl><div className="profile-actions">{editing ? <><button className="primary-button compact" type="button" onClick={onSave}>Save changes</button><button className="secondary-button" type="button" onClick={onCancel}>Cancel</button></> : <><button className="primary-button compact" type="button" onClick={onEdit}>Edit details</button><button className="secondary-button" type="button" onClick={onPassword}>Change password</button></>}{message && <p className="form-message success" role="status">{message}</p>}</div></article></section>;
}

function PlayerModal({ player, onClose, onChangeStat }: { player: Player; onClose: () => void; onChangeStat: (stat: "runs" | "wickets" | "catches") => void }) {
  const [activePlayerRole, setActivePlayerRole] = useState<Role>(player.roles[0]);
  const statName = activePlayerRole === "Batsman" ? "runs" : activePlayerRole === "Bowler" ? "wickets" : "catches";
  const statLabel = statName === "runs" ? "run" : statName === "wickets" ? "wicket" : "catch";
  const roleDescription = activePlayerRole === "Batsman" ? "Build the innings, rotate the strike, and anchor the team score." : activePlayerRole === "Bowler" ? "Set the field, control the run rate, and take wickets at key moments." : activePlayerRole === "All-rounder" ? "Contribute with both bat and ball whenever the team needs balance." : "Lead the gloves, take catches, and organise the field from behind the stumps.";
  return <div className="modal-backdrop" role="presentation" onMouseDown={onClose}><article className="modal-card player-modal" role="dialog" aria-modal="true" aria-labelledby="player-modal-title" onMouseDown={(event) => event.stopPropagation()}><button className="modal-close" type="button" onClick={onClose} aria-label="Close player details">×</button><div className="modal-player-heading"><span className={`avatar avatar-large role-${activePlayerRole.toLowerCase().replace("-", "")}`}>{player.initials}</span><div><span className="kicker">Player profile</span><h2 id="player-modal-title">{player.name}</h2><p>{player.email}</p></div></div><div className="role-tabs" role="tablist" aria-label={`${player.name} roles`}>{player.roles.map((role) => <button className={activePlayerRole === role ? "active" : ""} type="button" role="tab" aria-selected={activePlayerRole === role} key={role} onClick={() => setActivePlayerRole(role)}>{role}</button>)}</div><div className="role-description"><strong>{activePlayerRole} duties</strong><p>{roleDescription}</p></div><div className="modal-stats"><span><b>{player.runs}</b><small>Runs</small></span><span><b>{player.wickets}</b><small>Wickets</small></span><span><b>{player.catches}</b><small>Catches</small></span></div><div className="modal-footer"><span>Joined {formatDate(player.joinedOn)}</span><button className="primary-button compact" type="button" onClick={() => onChangeStat(statName)}>Record {statLabel}</button></div></article></div>;
}

function PasswordModal({ form, message, onClose, onSubmit, onChange }: { form: { currentPassword: string; newPassword: string; confirmPassword: string }; message: string; onClose: () => void; onSubmit: (event: FormEvent<HTMLFormElement>) => void; onChange: (form: { currentPassword: string; newPassword: string; confirmPassword: string }) => void }) {
  return <div className="modal-backdrop" role="presentation" onMouseDown={onClose}><article className="modal-card password-modal" role="dialog" aria-modal="true" aria-labelledby="password-title" onMouseDown={(event) => event.stopPropagation()}><button className="modal-close" type="button" onClick={onClose} aria-label="Close change password">×</button><span className="security-icon">•••</span><span className="kicker">Account security</span><h2 id="password-title">Change password</h2><p>Update the password used by the Fightclub IX administrator account.</p><form className="password-form" onSubmit={onSubmit}><label>Current password<input type="password" value={form.currentPassword} onChange={(event) => onChange({ ...form, currentPassword: event.target.value })} required /></label><label>New password<input type="password" value={form.newPassword} onChange={(event) => onChange({ ...form, newPassword: event.target.value })} required /></label><label>Confirm new password<input type="password" value={form.confirmPassword} onChange={(event) => onChange({ ...form, confirmPassword: event.target.value })} required /></label>{message && <p className="form-message" role="status">{message}</p>}<button className="primary-button" type="submit">Update password</button></form></article></div>;
}

export default App;
